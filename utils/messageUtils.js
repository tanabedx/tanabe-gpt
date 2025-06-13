const config = require('../configs');
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

module.exports = {
    handleAutoDelete,
    resolveContactName,
};
