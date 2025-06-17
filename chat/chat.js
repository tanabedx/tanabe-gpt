const config = require('../configs/config');
const logger = require('../utils/logger');
const { handleAutoDelete } = require('../utils/messageUtils');
const { extractLinks, unshortenLink, getPageContent } = require('../utils/linkUtils');
const { formatUserMessage, getPromptTypeFromPrefix } = require('./promptUtils');

// New conversation system imports
const conversationManager = require('./conversationManager');
const { 
    handleContextRequest, 
    validateContextRequest, 
    formatContextResponse,
    shouldAutoRequestContext
} = require('./contextRequestHandler');

// Manual search request system imports
const {
    handleSearchRequest,
    validateSearchRequest,
    formatSearchResponse
} = require('./searchRequestHandler');

// Temporary flag to reset conversations once after prompt update
let conversationsReset = false;

const CHAT_PROMPTS = require('./chatgpt.prompt');

async function handleChat(message, command, commandPrefix) {
    let name, groupName;
    try {
        // One-time reset of all conversations to use new system prompts
        if (!conversationsReset) {
            conversationManager.resetAllConversations();
            conversationsReset = true;
            logger.info('Conversations reset to use updated system prompts');
        }

        const contact = await message.getContact();
        name = contact.name || contact.pushname || 'Unknown';
        const question = message.body.substring(1);
        const chat = await message.getChat();
        groupName = chat.isGroup ? chat.name : null;
        const adminNumber = config?.CREDENTIALS?.ADMIN_NUMBER;

        logger.debug('Processing ChatGPT command with new conversation system', {
            name,
            question,
            hasQuoted: message.hasQuotedMsg,
            groupName,
            commandPrefix
        });

        // Validate question
        if (!question.trim()) {
            const errorMessage = await message.reply(command.errorMessages.invalidFormat);
            await handleAutoDelete(errorMessage, command, true);
            return;
        }

        // Determine prompt type from command prefix
        const promptType = getPromptTypeFromPrefix(commandPrefix);
        
        // Initialize conversation
        const conversation = conversationManager.initializeConversation(groupName, adminNumber, config, promptType);
        
        // Handle quoted message or link context
        let quotedContext = null;
        let linkContext = null;
        
        if (message.hasQuotedMsg) {
            const quotedMessage = await message.getQuotedMessage();
            const quotedText = quotedMessage.body;
            const link = extractLinks(quotedText)[0];

            if (link) {
                try {
                    const unshortenedLink = await unshortenLink(link);
                    linkContext = await getPageContent(unshortenedLink);
                    logger.debug('Got context from link', {
                        link: unshortenedLink,
                        contentLength: linkContext.length,
                    });
                } catch (error) {
                    logger.warn('Failed to get link context:', error);
                    const errorMessage = await message.reply(
                        'Não consegui acessar o link para fornecer contexto adicional.'
                    );
                    await handleAutoDelete(errorMessage, command, true);
                    return;
                }
            } else {
                quotedContext = quotedText;
                logger.debug('Using quoted message as context', {
                    quotedLength: quotedText.length,
                });
            }
        }

        // Format user message with any available context
        const userMessage = formatUserMessage(name, question, quotedContext, linkContext);
        
        // Store the original question for context prompts
        const originalQuestion = question;
        
        // Add user message to conversation
        conversationManager.addUserMessage(groupName, adminNumber, name, userMessage, config);
        
        logger.debug('User message added to conversation', {
            name,
            groupName,
            messageLength: userMessage.length,
            model: conversation.model
        });

        // Process conversation with context and search handling loop
        let contextRequestCount = 0;
        let searchRequestCount = 0;
        let finalResponse = null;
        let contextFeedbackMessage = null;

        while (true) {
            try {
                const aiResponse = await conversationManager.getAIResponse(groupName, adminNumber, config);
                
                // Handle context requests first
                const contextResult = await handleContextRequest(aiResponse, groupName, config);
                
                // Handle search requests
                const searchResult = await handleSearchRequest(aiResponse, config);

                // Check if no requests were made
                if (!contextResult.hasContextRequest && !searchResult.hasSearchRequest) {
                    // Check if ChatGPT should have automatically requested more context
                    if (shouldAutoRequestContext(aiResponse, originalQuestion, contextRequestCount, config)) {
                        logger.debug('Automatically injecting context request due to response patterns');
                        
                        // Inject an automatic context request
                        const autoContextResult = await handleContextRequest('REQUEST_CONTEXT: 100', groupName, config);
                        
                        if (autoContextResult.hasContextRequest && !autoContextResult.error) {
                            const autoValidation = validateContextRequest(groupName, contextRequestCount, config);
                            
                            if (autoValidation.isValid) {
                                contextRequestCount++;
                                
                                if (autoContextResult.fetchStatus === 'NEW_MESSAGES_SENT' && autoContextResult.context && autoContextResult.context.trim()) {
                                    conversationManager.addContextToConversation(groupName, adminNumber, autoContextResult.context, config, originalQuestion, true);
                                    logger.debug('Auto-injected context added to conversation', {
                                        contextLength: autoContextResult.context.length,
                                        newMessagesCount: autoContextResult.newMessagesCount,
                                        requestNumber: contextRequestCount
                                    });
                                    continue; // Continue the loop to get a new AI response with the added context
                                }
                            }
                        }
                    }
                    
                    finalResponse = aiResponse;
                    logger.debug('AI provided final response, no context or search request.');
                    break;
                }

                // Handle context request if present
                if (contextResult.hasContextRequest) {
                    const validation = validateContextRequest(groupName, contextRequestCount, config);

                    if (!validation.isValid) {
                        logger.warn('Context request validation failed (max requests per turn or disabled). Reason:', validation.reason);
                        const convGroupName = conversationManager.getConversationGroupName(groupName, adminNumber);
                        const limitPrompt = CHAT_PROMPTS.CONTEXT_PROMPTS.contextRequestTurnLimitReached || "Limite de requisições de contexto por turno atingido. Respondendo com o que tenho.";
                        const promptWithOriginalQuery = `${limitPrompt}\n\nLembre-se: A pergunta original do usuário foi: "${originalQuestion}"`;
                        conversationManager.addRawMessageToConversation(
                            convGroupName,
                            { role: 'system', content: promptWithOriginalQuery },
                            config
                        );
                        // Update model selection after adding system message
                        conversationManager.updateModelForConversation(convGroupName, config);
                        finalResponse = await conversationManager.getAIResponse(groupName, adminNumber, config);
                        logger.debug('Max context requests per turn reached or validation failed. Got final AI response.');
                        break;
                    }
                    
                    contextRequestCount++;

                    if (contextResult.error) {
                        logger.error('Context request processing failed in handler:', contextResult.error);
                        const convGroupName = conversationManager.getConversationGroupName(groupName, adminNumber);
                        const errorPrompt = CHAT_PROMPTS.ERROR_PROMPTS.contextError || "Erro ao processar o pedido de contexto.";
                        const promptWithOriginalQuery = `${errorPrompt}\n\nLembre-se: A pergunta original do usuário foi: "${originalQuestion}"`;
                        conversationManager.addRawMessageToConversation(
                            convGroupName,
                            { role: 'system', content: promptWithOriginalQuery },
                            config
                        );
                        // Update model selection after adding system message
                        conversationManager.updateModelForConversation(convGroupName, config);
                        finalResponse = await conversationManager.getAIResponse(groupName, adminNumber, config);
                        logger.debug('Context request failed during processing. Got final AI response.');
                        break;
                    }

                    const fetchStatus = contextResult.fetchStatus;
                    let systemMessageContent = null;

                    if (fetchStatus === 'NEW_MESSAGES_SENT' && contextResult.context && contextResult.context.trim()) {
                        conversationManager.addContextToConversation(groupName, adminNumber, contextResult.context, config, originalQuestion);
                        logger.debug('Context added to conversation', {
                            contextLength: contextResult.context.length,
                            newMessagesCount: contextResult.newMessagesCount,
                            requestNumber: contextRequestCount
                        });
                        continue; 
                    } else {
                        let basePrompt = '';
                        if (fetchStatus === 'MAX_MESSAGES_LIMIT_REACHED') {
                            logger.debug('Max total chat history messages limit reached. Informing AI.');
                            basePrompt = CHAT_PROMPTS.CONTEXT_PROMPTS.maxMessagesLimitReached;
                        } else if (fetchStatus === 'ALL_MESSAGES_RETRIEVED') {
                            logger.debug('All available chat history retrieved. Informing AI.');
                            basePrompt = CHAT_PROMPTS.CONTEXT_PROMPTS.noMoreContextAllRetrieved;
                        } else if (fetchStatus === 'NO_NEW_MESSAGES_IN_CACHE') {
                            logger.debug('AI requested context, but no new messages were available in the current cache slice. Informing AI to answer.');
                            basePrompt = CHAT_PROMPTS.CONTEXT_PROMPTS.noNewContextInCachePleaseAnswer;
                        } else if (fetchStatus && fetchStatus.startsWith('ERROR_')) {
                            logger.warn(`Context fetching ended with error status: ${fetchStatus}. Informing AI to answer with current info.`);
                            basePrompt = CHAT_PROMPTS.ERROR_PROMPTS.contextFetchErrorInformAI || "Houve um problema ao buscar mais contexto. Por favor, responda com as informações atuais.";
                        } else {
                            logger.debug(`Context fetch status: ${fetchStatus}. No new context provided or unhandled status. Informing AI to answer.`);
                            basePrompt = CHAT_PROMPTS.CONTEXT_PROMPTS.noNewContextPleaseAnswer || "Não há novo contexto. Por favor, responda com as informações atuais.";
                        }

                        if (basePrompt) {
                            systemMessageContent = `${basePrompt}\n\nLembre-se: A pergunta original do usuário foi: "${originalQuestion}"`;
                        }

                        if (systemMessageContent) {
                            const convGroupName = conversationManager.getConversationGroupName(groupName, adminNumber);
                            conversationManager.addRawMessageToConversation(
                                convGroupName,
                                { role: 'system', content: systemMessageContent },
                                config
                            );
                            // Update model selection after adding system message
                            conversationManager.updateModelForConversation(convGroupName, config);
                        }
                        finalResponse = await conversationManager.getAIResponse(groupName, adminNumber, config);
                        logger.debug('Proceeding to final AI response after context status: ' + fetchStatus);
                        break;
                    }
                }

                // Handle search request if present
                if (searchResult.hasSearchRequest) {
                    const searchValidation = validateSearchRequest(searchRequestCount, config);

                    if (!searchValidation.isValid) {
                        logger.warn('Search request validation failed. Reason:', searchValidation.reason);
                        const convGroupName = conversationManager.getConversationGroupName(groupName, adminNumber);
                        const limitPrompt = CHAT_PROMPTS.ERROR_PROMPTS.searchRequestLimitReached || "Limite de pesquisas manuais atingido. Respondendo com o que tenho.";
                        const promptWithOriginalQuery = `${limitPrompt}\n\nLembre-se: A pergunta original do usuário foi: "${originalQuestion}"`;
                        conversationManager.addRawMessageToConversation(
                            convGroupName,
                            { role: 'system', content: promptWithOriginalQuery },
                            config
                        );
                        // Update model selection after adding system message
                        conversationManager.updateModelForConversation(convGroupName, config);
                        finalResponse = await conversationManager.getAIResponse(groupName, adminNumber, config);
                        logger.debug('Max search requests reached or validation failed. Got final AI response.');
                        break;
                    }

                    searchRequestCount++;

                    if (searchResult.error) {
                        logger.error('Search request processing failed:', searchResult.error);
                        const convGroupName = conversationManager.getConversationGroupName(groupName, adminNumber);
                        const errorPrompt = CHAT_PROMPTS.ERROR_PROMPTS.searchError || "Erro ao realizar a pesquisa solicitada.";
                        const promptWithOriginalQuery = `${errorPrompt}\n\nLembre-se: A pergunta original do usuário foi: "${originalQuestion}"`;
                        conversationManager.addRawMessageToConversation(
                            convGroupName,
                            { role: 'system', content: promptWithOriginalQuery },
                            config
                        );
                        // Update model selection after adding system message
                        conversationManager.updateModelForConversation(convGroupName, config);
                        finalResponse = await conversationManager.getAIResponse(groupName, adminNumber, config);
                        logger.debug('Search request failed during processing. Got final AI response.');
                        break;
                    }

                    // Add search results to conversation if successful
                    if (searchResult.searchResults && searchResult.searchResults.results && searchResult.searchResults.results.length > 0) {
                        const convGroupName = conversationManager.getConversationGroupName(groupName, adminNumber);
                        
                        // Use webSearch.model if available for manual searches
                        const webSearchConfig = config?.COMMANDS?.CHAT?.webSearch || {};
                        const currentConversation = conversationManager.initializeConversation(groupName, adminNumber, config);
                        let modelToUse = currentConversation.model;
                        if (webSearchConfig.model) {
                            modelToUse = webSearchConfig.model;
                        }

                        const searchResultsMessage = {
                            role: 'system',
                            content: `RESULTADOS DE PESQUISA MANUAL SOLICITADA:
Consulta solicitada: "${searchResult.query}"
Timestamp: ${new Date().toLocaleString('pt-BR')}

${searchResult.searchResults.summary}

INSTRUÇÕES: Use essas informações da pesquisa manual para responder à pergunta do usuário. Cite as fontes adequadamente. Lembre-se: A pergunta original do usuário foi: "${originalQuestion}"`
                        };
                        
                        conversationManager.addRawMessageToConversation(
                            convGroupName,
                            searchResultsMessage,
                            config
                        );
                        
                        // Update model selection after adding search results
                        conversationManager.updateModelForConversation(convGroupName, config);
                        
                        logger.debug('Manual search results added to conversation', {
                            query: searchResult.query,
                            resultsCount: searchResult.searchResults.results.length,
                            requestNumber: searchRequestCount,
                            usingModel: modelToUse
                        });
                        
                        continue; // Continue the loop to get a new AI response with the search results
                    } else {
                        // No search results found, inform AI
                        const convGroupName = conversationManager.getConversationGroupName(groupName, adminNumber);
                        const noResultsPrompt = `Não foram encontrados resultados para a pesquisa manual solicitada: "${searchResult.query}". Responda com base no seu conhecimento base.\n\nLembre-se: A pergunta original do usuário foi: "${originalQuestion}"`;
                        conversationManager.addRawMessageToConversation(
                            convGroupName,
                            { role: 'system', content: noResultsPrompt },
                            config
                        );
                        // Update model selection after adding system message
                        conversationManager.updateModelForConversation(convGroupName, config);
                        finalResponse = await conversationManager.getAIResponse(groupName, adminNumber, config);
                        logger.debug('No search results found. Got final AI response.');
                        break;
                    }
                }

            } catch (error) {
                logger.error('Error in conversation processing loop:', error);
                finalResponse = command.errorMessages.conversationError ||
                              'Erro ao processar a conversa. Tente novamente.';
                break;
            }
        }

        // Clean up context feedback message if we have a final response
        if (contextFeedbackMessage && finalResponse) {
            try {
                await contextFeedbackMessage.delete();
            } catch (error) {
                logger.debug('Could not delete context feedback message:', error);
            }
        }

        // Send final response
        if (finalResponse && finalResponse.trim()) {
            const response = await message.reply(finalResponse.trim());
            await handleAutoDelete(response, command);
            
            logger.debug('Final response sent', {
                name,
                groupName,
                responseLength: finalResponse.length,
                contextRequestsUsed: contextRequestCount,
                searchRequestsUsed: searchRequestCount
            });
        } else {
            // Fallback if no valid response
            const errorMessage = await message.reply(
                CHAT_PROMPTS.ERROR_PROMPTS.generalError || 
                command.errorMessages.error || 
                'An error occurred while processing your request.'
            );
            await handleAutoDelete(errorMessage, command, true);
        }

    } catch (error) {
        logger.error(
            `Error in CHAT handler for ${name || 'Unknown'} in ${groupName || 'DM'}:`,
            error
        );
        
        // Reset conversation on critical error
        const adminNumber = config?.CREDENTIALS?.ADMIN_NUMBER;
        if (adminNumber) {
            conversationManager.resetConversation(groupName, adminNumber);
        }
        
        const errorMessage = await message.reply(
            CHAT_PROMPTS.ERROR_PROMPTS.generalError || 
            command.errorMessages.error || 
            'An error occurred while processing your request.'
        );
        await handleAutoDelete(errorMessage, command, true);
    }
}

module.exports = {
    handleChat,
};
