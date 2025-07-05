const config = require('../configs/config');
const logger = require('../utils/logger');
const { handleAutoDelete, sendStreamingResponse } = require('../utils/messageUtils');
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
        const conversation = await conversationManager.initializeConversation(groupName, adminNumber, config, promptType);
        
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
        await conversationManager.addUserMessage(groupName, adminNumber, name, userMessage, config);
        
        logger.debug('User message added to conversation', {
            name,
            groupName,
            messageLength: userMessage.length,
            model: conversation.model
        });

        // Process conversation with a loop for handling tool requests (context, search)
        let contextRequestCount = 0;
        let searchRequestCount = 0;
        let finalResponse = null;

        while (true) {
            try {
                // Get the full AI response without streaming inside the loop
                const aiResponseObject = await conversationManager.getAIResponse(groupName, adminNumber, config);
                const aiResponse = aiResponseObject.content || aiResponseObject;

                // CRITICAL: Add AI response to conversation history immediately
                conversationManager.addRawMessageToConversation(
                    conversationManager.getConversationGroupName(groupName, adminNumber),
                    aiResponseObject,
                    config
                );

                // Handle context requests
                const contextResult = await handleContextRequest(aiResponse, groupName, config);
                if (contextResult.hasContextRequest) {
                    const validation = validateContextRequest(groupName, contextRequestCount, config);
                    if (validation.isValid && contextResult.context) {
                        contextRequestCount++;
                        conversationManager.addContextToConversation(groupName, adminNumber, contextResult.context, config, originalQuestion);
                        continue; // Re-run AI with new context
                    }
                }

                // Handle search requests
                const searchResult = await handleSearchRequest(aiResponse, config);
                if (searchResult.hasSearchRequest) {
                    const searchValidation = validateSearchRequest(searchRequestCount, config);
                    if (searchValidation.isValid && searchResult.searchResults?.summary) {
                        searchRequestCount++;
                        const searchResultsMessage = {
                            role: 'system',
                            content: `Manual search results for "${searchResult.query}":\n${searchResult.searchResults.summary}`
                        };
                        conversationManager.addRawMessageToConversation(
                            conversationManager.getConversationGroupName(groupName, adminNumber),
                            searchResultsMessage,
                            config
                        );
                        continue; // Re-run AI with new search context
                    }
                }

                // If no tool requests are handled, this is the final response
                finalResponse = aiResponse;
                break;

            } catch (error) {
                logger.error('Error in conversation processing loop:', error);
                finalResponse = command.errorMessages.conversationError || 'Erro ao processar a conversa. Tente novamente.';
                break;
            }
        }
        
        // --- Ultra-Fast Streaming for Final Response ---
        if (finalResponse && finalResponse.trim()) {
            await sendStreamingResponse(message, finalResponse.trim(), command, '🤖', 50, 100, 25);
            logger.debug('Final ultra-fast stream response sent', {
                name,
                groupName,
                responseLength: finalResponse.trim().length,
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
