const config = require('../configs/config');
const logger = require('./logger');

async function handleAutoDelete(message, command, isError = false) {
    if (!command.autoDelete) return;

    const shouldDelete = isError
        ? command.autoDelete.errorMessages
        : command.autoDelete.commandMessages;

    if (shouldDelete) {
        const timeout = command.autoDelete.deleteTimeout || config.SYSTEM.MESSAGE_DELETE_TIMEOUT;
        setTimeout(async () => {
            try {
                await message.delete(true);
            } catch (error) {
                logger.error('Error deleting message:', error);
            }
        }, timeout);
    }
}

/**
 * Resolve contact name with proper fallback priority
 * @param {Object} contact - The contact object
 * @returns {string} Resolved name with fallback priority:
 *   1. Saved contact name (contact.name)
 *   2. WhatsApp display name (contact.pushname)
 *   3. Phone number (contact.number or extracted from contact.id)
 *   4. 'Unknown' as last resort
 */
function resolveContactName(contact) {
    // Priority 1: Saved contact name
    if (contact.name && contact.name.trim()) {
        return contact.name.trim();
    }
    
    // Priority 2: WhatsApp display name (pushname)
    if (contact.pushname && contact.pushname.trim()) {
        return contact.pushname.trim();
    }
    
    // Priority 3: Phone number
    if (contact.number && contact.number.trim()) {
        return contact.number.trim();
    }
    
    // Extract phone number from contact ID if available
    if (contact.id && contact.id._serialized) {
        const phoneMatch = contact.id._serialized.match(/^(\d+)@/);
        if (phoneMatch) {
            return phoneMatch[1];
        }
    }
    
    // Priority 4: Unknown as last resort
    return 'Unknown';
}

/**
 * Send a streaming response that simulates typing effect
 * @param {Object} message - The original message to reply to
 * @param {string} finalResponse - The complete response text
 * @param {Object} command - Command configuration for auto-delete
 * @param {string} placeholder - Initial placeholder text (default: '🤖')
 * @param {number} chunkSizeMin - Minimum chunk size for streaming (default: 5)
 * @param {number} chunkSizeMax - Maximum chunk size for streaming (default: 20)
 * @param {number} intervalMs - Interval between chunks in milliseconds (default: 50)
 * @returns {Promise<Object>} The final response message
 */
async function sendStreamingResponse(message, finalResponse, command, placeholder = '🤖', chunkSizeMin = 40, chunkSizeMax = 80, intervalMs = 50) {
    const config = require('../configs/config'); // Load config inside function
    
    // Check master streaming switch
    if (config.SYSTEM?.STREAMING_ENABLED === false) {
        const responseMessage = await message.reply(finalResponse.trim());
        await handleAutoDelete(responseMessage, command);
        return responseMessage;
    }

    try {
        // Send initial placeholder message
        const responseMessage = await message.reply(placeholder);
        
        if (!finalResponse || !finalResponse.trim()) {
            logger.warn('Empty response provided to streaming function');
            await responseMessage.edit('Resposta vazia recebida.');
            await handleAutoDelete(responseMessage, command);
            return responseMessage;
        }

        const responseText = finalResponse.trim();
        let currentIndex = 0;
        let isEditing = false; // Lock to prevent concurrent edits

        const streamInterval = setInterval(async () => {
            if (isEditing) return; // Don't run if an edit is in progress

            isEditing = true;

            try {
                // Random chunk size for more natural feel
                const chunkSize = Math.floor(Math.random() * (chunkSizeMax - chunkSizeMin + 1)) + chunkSizeMin;
                currentIndex += chunkSize;

                if (currentIndex >= responseText.length) {
                    clearInterval(streamInterval);
                    await responseMessage.edit(responseText);
                    await handleAutoDelete(responseMessage, command);
                    logger.debug('Streaming response completed', {
                        responseLength: responseText.length,
                        placeholder: placeholder
                    });
                } else {
                    await responseMessage.edit(responseText.substring(0, currentIndex) + '...');
                }
            } catch (error) {
                logger.error('Error during streaming message edit:', error);
                clearInterval(streamInterval); // Stop streaming on error
                try {
                    await responseMessage.edit(responseText); // Send full response as fallback
                    await handleAutoDelete(responseMessage, command);
                } catch (fallbackError) {
                    logger.error('Fallback edit also failed:', fallbackError);
                }
            } finally {
                isEditing = false; // Release the lock
            }
        }, intervalMs);

        return responseMessage;
    } catch (error) {
        logger.error('Error in sendStreamingResponse:', error);
        // Fallback to regular reply
        const fallbackMessage = await message.reply(finalResponse);
        await handleAutoDelete(fallbackMessage, command);
        return fallbackMessage;
    }
}

module.exports = {
    handleAutoDelete,
    resolveContactName,
    sendStreamingResponse,
};
