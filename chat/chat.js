const config = require('../configs/config');
const logger = require('../utils/logger');
const { handleAutoDelete, sendStreamingResponse } = require('../utils/messageUtils');
const { extractLinks, unshortenLink, getPageContent } = require('../utils/linkUtils');
const { formatUserMessage, getPromptTypeFromPrefix } = require('./promptUtils');

// New conversation system imports
const conversationManager = require('./conversationManager');
const { 
    handleContextRequest, 
    validateContextRequest
} = require('./contextRequestHandler');




// Image generation removed - ChatGPT now only supports vision capabilities

// Attachment processing imports
const {
    processAttachments,
    createAttachmentContext,
    generateAttachmentSummary
} = require('./attachmentHandler');

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

        // Process any attachments first (from main message)
        let attachmentData = await processAttachments(message, config);
        
        // Also check quoted message for attachments
        if (message.hasQuotedMsg) {
            const quotedMessage = await message.getQuotedMessage();
            if (quotedMessage.hasMedia) {
                logger.debug('Processing quoted message attachments');
                const quotedAttachmentData = await processAttachments(quotedMessage, config);
                
                // Merge attachment data from quoted message
                if (quotedAttachmentData.hasAttachments) {
                    attachmentData.hasAttachments = true;
                    attachmentData.images.push(...quotedAttachmentData.images);
                    attachmentData.pdfs.push(...quotedAttachmentData.pdfs);
                    attachmentData.audio.push(...quotedAttachmentData.audio);
                    attachmentData.other.push(...quotedAttachmentData.other);
                    
                    if (quotedAttachmentData.textContent) {
                        attachmentData.textContent += `\n[Da mensagem citada]: ${quotedAttachmentData.textContent}`;
                    }
                    
                    // Update summary
                    attachmentData.summary = generateAttachmentSummary(attachmentData);
                }
            }
        }
        
        const attachmentContext = createAttachmentContext(attachmentData);
        
        // Format user message with any available context (including attachments)
        const userMessage = formatUserMessage(name, question, quotedContext, linkContext, attachmentContext);
        
        // Store the original question for context prompts
        const originalQuestion = question;
        
        // Check if we have images to include directly in the message
        const hasImages = attachmentData.images && attachmentData.images.length > 0;
        
        if (hasImages) {
            // For gpt-5 models, include images directly in the conversation
            const imageContent = attachmentData.images.map(img => ({
                type: "input_image",
                image_url: `data:${img.mimeType};base64,${img.imageData}`
            }));
            
            await conversationManager.addUserMessageWithImages(groupName, adminNumber, name, userMessage, imageContent, config);
            
            logger.debug('User message with images added to conversation', {
                name,
                groupName,
                messageLength: userMessage.length,
                imageCount: imageContent.length
            });
        } else {
            // Add regular text-only user message to conversation
            await conversationManager.addUserMessage(groupName, adminNumber, name, userMessage, config);
            
            logger.debug('User message added to conversation', {
                name,
                groupName,
                messageLength: userMessage.length,
                model: 'text-only'
            });
        }

        // Process conversation with a loop for handling tool requests (context)
        let contextRequestCount = 0;

        let loopCount = 0;
        const maxLoops = 10; // Safety limit to prevent infinite loops
        let finalResponse = null;

        while (loopCount < maxLoops) {
            loopCount++;
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



                // Image generation removed - ChatGPT now only supports vision analysis

                // If no tool requests are handled, this is the final response
                finalResponse = aiResponse;
                break;

            } catch (error) {
                logger.error('Error in conversation processing loop:', error);
                finalResponse = command.errorMessages.conversationError || 'Erro ao processar a conversa. Tente novamente.';
                break;
            }
        }

        // Check if we hit the loop limit
        if (loopCount >= maxLoops) {
            logger.warn('Conversation loop hit maximum iterations, preventing infinite loop', {
                loopCount: loopCount,
                contextRequestCount: contextRequestCount,

                imageRequestCount: imageRequestCount,
                failedImageRequestCount: failedImageRequestCount
            });
            finalResponse = finalResponse || 'A conversa ficou muito complexa. Posso ajudar de forma mais direta?';
        }
        
        // --- Send final response honoring STREAMING_ENABLED flag ---
        if (finalResponse && finalResponse.trim()) {
            const cfg = require('../configs/config');
            const streamingEnabled = cfg?.SYSTEM?.STREAMING_ENABLED === true;

            if (streamingEnabled) {
                await sendStreamingResponse(message, finalResponse.trim(), command, '🤖', 50, 100, 25);
                logger.debug('Final ultra-fast stream response sent', {
                    name,
                    groupName,
                    responseLength: finalResponse.trim().length,
                });
            } else {
                const responseMessage = await message.reply(finalResponse.trim());
                await handleAutoDelete(responseMessage, command, false);
                logger.debug('Final non-stream response sent', {
                    name,
                    groupName,
                    responseLength: finalResponse.trim().length,
                });
            }
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
