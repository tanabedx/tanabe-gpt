const logger = require('./logger');
const config = require('../configs');

let messageHistory = new Map();

// Get group names from environment variables
const GROUP_LF = process.env.GROUP_LF;

async function initializeMessageLog() {
    try {
        // Wait for client to be ready
        if (!global.client._isReady) {
            logger.debug('Client not ready yet, waiting for initialization...');
            return;
        }

        const chats = await global.client.getChats();
        for (const chat of chats) {
            const messages = await chat.fetchMessages({ limit: 1 });
            messageHistory.set(chat.name || chat.id._serialized, messages);
            logger.debug(`Message logging initialized for ${chat.name || chat.id._serialized} with ${messages.length} messages`);
        }
    } catch (error) {
        logger.error('Error in getMessageHistory:', error);
    }
}

async function getMessageHistory(groupName = null) {
    try {
        const client = global.client;
        if (!client) {
            logger.error('Client not available for message fetching');
            return '';
        }

        // For admin chat, use the GROUP_LF group's message history
        const adminNumber = config?.CREDENTIALS?.ADMIN_NUMBER;
        const isAdminChat = !groupName || 
                           groupName === `${adminNumber}@c.us` || 
                           groupName.includes(adminNumber);
        
        if (isAdminChat) {
            logger.debug(`Using ${GROUP_LF} group message history for admin chat`);
            groupName = GROUP_LF;
        }

        // Verify the group has access to ChatGPT
        const allowedGroups = config?.COMMANDS?.CHAT_GPT?.permissions?.allowedIn || [];
        const whitelist = config?.COMMAND_WHITELIST?.CHAT_GPT || [];
        
        // Check both the old permissions and the new whitelist
        const isAllowed = allowedGroups.includes(groupName) || 
                         whitelist.includes(groupName) || 
                         allowedGroups === 'all' || 
                         whitelist === 'all';
        
        if (!isAllowed && !isAdminChat) {
            logger.debug(`Group ${groupName} is not allowed to use ChatGPT`);
            return '';
        }

        const chats = await client.getChats();
        const chat = chats.find(c => c.name === groupName);
        
        if (!chat) {
            logger.warn(`Chat ${groupName} not found`);
            return '';
        }

        const maxMessages = config?.COMMANDS?.CHAT_GPT?.maxMessageFetch || 1000;
        // Fetch messages with increased limit to account for invalid messages
        const messages = await chat.fetchMessages({ limit: Math.ceil(maxMessages * 1.5) }); // Fetch 50% more to ensure we get enough valid messages
        
        // Filter and get valid messages
        const validMessages = messages
            .filter(msg => !msg.fromMe && msg.body.trim())
            .slice(0, maxMessages); // Keep only first maxMessages valid messages

        // Format messages
        const formattedMessages = await Promise.all(validMessages.map(async msg => {
            const contact = await msg.getContact();
            const date = new Date(msg.timestamp * 1000);
            const formattedDate = date.toLocaleString('pt-BR', {
                timeZone: 'America/Sao_Paulo',
                day: '2-digit',
                month: '2-digit',
                year: '2-digit',
                hour: '2-digit',
                minute: '2-digit'
            });
            return `[${formattedDate}] >>${contact.name || contact.pushname || contact.number}: ${msg.body}`;
        }));

        return formattedMessages.join('\n');
    } catch (error) {
        logger.error('Error in getMessageHistory:', error);
        return '';
    }
}

module.exports = {
    getMessageHistory,
    initializeMessageLog
};