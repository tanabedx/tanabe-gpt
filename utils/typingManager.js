const logger = require('./logger');

/**
 * Manages persistent typing indicators for WhatsApp chats
 * Automatically refreshes typing state until explicitly stopped
 */
class TypingManager {
    constructor() {
        this.activeTyping = new Map(); // chatId -> { chat, intervalId, startTime }
    }

    /**
     * Start persistent typing indicator for a chat
     * @param {Object} chat - WhatsApp chat object
     * @param {string} chatId - Unique chat identifier
     * @param {number} refreshInterval - How often to refresh typing (ms), default 20 seconds
     */
    async startTyping(chat, chatId, refreshInterval = 20000) {
        try {
            // Stop any existing typing for this chat
            this.stopTyping(chatId);

            // Send initial typing state
            await chat.sendStateTyping();
            
            const startTime = Date.now();
            logger.debug('Started persistent typing indicator', { 
                chatId, 
                refreshInterval: refreshInterval / 1000 + 's' 
            });

            // Set up periodic refresh
            const intervalId = setInterval(async () => {
                try {
                    await chat.sendStateTyping();
                    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
                    logger.debug('Refreshed typing indicator', { 
                        chatId, 
                        duration: duration + 's' 
                    });
                } catch (error) {
                    logger.warn('Failed to refresh typing indicator', { 
                        chatId, 
                        error: error.message 
                    });
                    // Stop the interval if sending fails
                    this.stopTyping(chatId);
                }
            }, refreshInterval);

            // Store the typing session
            this.activeTyping.set(chatId, {
                chat,
                intervalId,
                startTime
            });

        } catch (error) {
            logger.error('Failed to start typing indicator', { 
                chatId, 
                error: error.message 
            });
        }
    }

    /**
     * Stop persistent typing indicator for a chat
     * @param {string} chatId - Unique chat identifier
     */
    stopTyping(chatId) {
        const session = this.activeTyping.get(chatId);
        if (session) {
            clearInterval(session.intervalId);
            const duration = ((Date.now() - session.startTime) / 1000).toFixed(1);
            logger.debug('Stopped persistent typing indicator', { 
                chatId, 
                duration: duration + 's' 
            });
            this.activeTyping.delete(chatId);
        }
    }

    /**
     * Stop all active typing indicators
     */
    stopAllTyping() {
        const activeChatIds = Array.from(this.activeTyping.keys());
        logger.debug('Stopping all typing indicators', { 
            activeCount: activeChatIds.length 
        });
        
        activeChatIds.forEach(chatId => {
            this.stopTyping(chatId);
        });
    }

    /**
     * Get information about active typing sessions
     * @returns {Object} Active typing session info
     */
    getActiveTypingInfo() {
        const sessions = {};
        this.activeTyping.forEach((session, chatId) => {
            sessions[chatId] = {
                duration: ((Date.now() - session.startTime) / 1000).toFixed(1) + 's',
                startTime: new Date(session.startTime).toISOString()
            };
        });
        return sessions;
    }

    /**
     * Check if a chat currently has active typing
     * @param {string} chatId - Chat identifier
     * @returns {boolean} Whether typing is active
     */
    isTyping(chatId) {
        return this.activeTyping.has(chatId);
    }
}

// Create a singleton instance
const typingManager = new TypingManager();

// Graceful cleanup on process exit
process.on('SIGINT', () => {
    logger.debug('Cleaning up typing indicators on exit...');
    typingManager.stopAllTyping();
});

process.on('SIGTERM', () => {
    logger.debug('Cleaning up typing indicators on termination...');
    typingManager.stopAllTyping();
});

module.exports = typingManager;
