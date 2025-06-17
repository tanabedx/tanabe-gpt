const logger = require('../utils/logger');
const config = require('../configs/config');

// Context state management
let contextCache = new Map(); // groupName -> { allRawMessages: [], formattedMessages: [], lastSentIndex: number, allMessagesLoadedFromSource: boolean, totalRawMessagesProvidedAsContext: number }

// Get group names from environment variables
const GROUP_LF = process.env.GROUP_LF;

/**
 * Initialize context manager
 */
async function initializeContextManager() {
    try {
        // Wait for client to be ready
        if (!global.client._isReady) {
            logger.debug('Client not ready yet, waiting for context manager initialization...');
            return;
        }

        logger.info('Context manager initialized successfully');
    } catch (error) {
        logger.error('Error initializing context manager:', error);
    }
}

/**
 * Clear context cache for a specific group or all groups
 * @param {string|null} groupName - Group name to clear, or null for all
 */
function clearContextCache(groupName = null) {
    if (groupName) {
        contextCache.delete(groupName);
        logger.debug(`Context cache cleared for group: ${groupName}`);
    } else {
        contextCache.clear();
        logger.debug('All context cache cleared');
    }
}

/**
 * Get the appropriate group name for context fetching
 * @param {string|null} originalGroupName - Original group name
 * @returns {string} The group name to use for context
 */
function getContextGroupName(originalGroupName) {
    const adminNumber = config?.CREDENTIALS?.ADMIN_NUMBER;
    const isAdminChat =
        !originalGroupName || 
        originalGroupName === `${adminNumber}@c.us` || 
        (typeof originalGroupName === 'string' && originalGroupName.includes(adminNumber));

    // For admin chat, use the GROUP_LF group's message history
    if (isAdminChat) {
        logger.debug(`Using ${GROUP_LF} group for admin chat context`);
        return GROUP_LF;
    }

    return originalGroupName;
}

/**
 * Check if a group has permission to use ChatGPT
 * @param {string} groupName - Group name to check
 * @returns {boolean} Whether the group is allowed
 */
function isGroupAllowed(groupName) {
    const { COMMAND_WHITELIST } = require('../configs/whitelist');
    
    // Get the CHAT whitelist (context fetching is part of CHAT command functionality)
    const commandWhitelist = COMMAND_WHITELIST.CHAT || [];
    
    // Check if whitelist is 'all'
    if (commandWhitelist === 'all') {
        return true;
    }
    
    // Check if the group name is directly in the whitelist
    if (Array.isArray(commandWhitelist) && commandWhitelist.includes(groupName)) {
        return true;
    }
    
    logger.debug(`Group ${groupName} permission check`, {
        whitelist: commandWhitelist,
        isAllowed: false
    });
    
    return false;
}

/**
 * Fetch messages incrementally from a chat
 * @param {string} groupName - Name of the group/chat
 * @param {number} messageCount - Number of messages to fetch
 * @param {boolean} reset - Whether to reset the context cache
 * @returns {Promise<string>} Formatted messages or empty string
 */
async function fetchContextMessages(groupName, messageCount = 100, reset = false) {
    try {
        const client = global.client;
        if (!client) {
            logger.error('Client not available for message fetching');
            return { context: '', status: 'ERROR_CLIENT_NOT_AVAILABLE', newMessagesCount: 0 };
        }

        const contextGroupName = getContextGroupName(groupName);
        
        const adminNumber = config?.CREDENTIALS?.ADMIN_NUMBER;
        const isAdminChat = !groupName || groupName.includes(adminNumber);
        
        if (!isAdminChat && !isGroupAllowed(contextGroupName)) {
            logger.debug(`Group ${contextGroupName} is not allowed to use ChatGPT`);
            return { context: '', status: 'ERROR_GROUP_NOT_ALLOWED', newMessagesCount: 0 };
        }

        const chats = await client.getChats();
        const chat = chats.find(c => c.name === contextGroupName);

        if (!chat) {
            logger.warn(`Chat ${contextGroupName} not found`);
            return { context: '', status: 'ERROR_CHAT_NOT_FOUND', newMessagesCount: 0 };
        }
        
        const MAX_CHAT_HISTORY_MESSAGES = config?.COMMANDS?.CHAT?.contextManagement?.maxTotalChatHistoryMessages || 1000;

        if (reset || !contextCache.has(contextGroupName)) {
            const initialFetchLimit = config?.COMMANDS?.CHAT?.maxMessageFetch || 1000;
            logger.debug(`Initial fetch or reset for ${contextGroupName}, limit: ${initialFetchLimit}`);
            const allRawMessages = await chat.fetchMessages({ limit: initialFetchLimit });
            
            const rawMessagesToCache = allRawMessages;
            const allLoaded = rawMessagesToCache.length < initialFetchLimit;

            contextCache.set(contextGroupName, {
                allRawMessages: rawMessagesToCache.reverse(),
                // formattedMessages: [], // This can be removed if we only return new chunks
                lastSentIndex: 0, 
                allMessagesLoadedFromSource: allLoaded,
                totalRawMessagesProvidedAsContext: 0, // Reset on new cache/reset
            });
            logger.debug(`Cached ${rawMessagesToCache.length} raw messages for ${contextGroupName}. All loaded: ${allLoaded}`);
        }

        const contextData = contextCache.get(contextGroupName);

        // Check if max total messages limit for this interaction/cache has been reached
        if (contextData.totalRawMessagesProvidedAsContext >= MAX_CHAT_HISTORY_MESSAGES) {
            logger.debug(`Max total chat history messages (${MAX_CHAT_HISTORY_MESSAGES}) already processed for ${contextGroupName}.`);
            return { context: '', status: 'MAX_MESSAGES_LIMIT_REACHED', newMessagesCount: 0 };
        }
        
        const remainingInCache = contextData.allRawMessages.length - contextData.lastSentIndex;
        // Amount we can still provide before hitting the overall limit
        const canProvideBeforeLimit = MAX_CHAT_HISTORY_MESSAGES - contextData.totalRawMessagesProvidedAsContext;
        
        let messagesToSelectCount = Math.min(messageCount, remainingInCache, canProvideBeforeLimit);
        messagesToSelectCount = Math.max(0, messagesToSelectCount); // Ensure not negative


        if (messagesToSelectCount <= 0) {
            logger.debug(`No messages to select for ${contextGroupName}`, { 
                remainingInCache, 
                canProvideBeforeLimit, 
                messageCount,
                totalProvided: contextData.totalRawMessagesProvidedAsContext,
                maxLimit: MAX_CHAT_HISTORY_MESSAGES,
                allLoaded: contextData.allMessagesLoadedFromSource
            });
            if (contextData.totalRawMessagesProvidedAsContext >= MAX_CHAT_HISTORY_MESSAGES) {
                return { context: '', status: 'MAX_MESSAGES_LIMIT_REACHED', newMessagesCount: 0 };
            }
            if (contextData.allMessagesLoadedFromSource) {
                return { context: '', status: 'ALL_MESSAGES_RETRIEVED', newMessagesCount: 0 };
            }
            return { context: '', status: 'NO_NEW_MESSAGES_IN_CACHE', newMessagesCount: 0 };
        }

        logger.debug(`Selecting next ${messagesToSelectCount} messages for ${contextGroupName}`, {
            currentLastSentIndex: contextData.lastSentIndex,
            totalCachedRaw: contextData.allRawMessages.length,
            requested: messageCount,
            totalRawProvided: contextData.totalRawMessagesProvidedAsContext
        });

        const nextRawMessagesBatch = contextData.allRawMessages.slice(
            contextData.lastSentIndex,
            contextData.lastSentIndex + messagesToSelectCount
        );

        const newFormattedMessages = await Promise.all(
            nextRawMessagesBatch.map(async msg => {
                const contact = await msg.getContact();
                const date = new Date(msg.timestamp * 1000);
                const formattedDate = date.toLocaleString('pt-BR', {
                    timeZone: 'America/Sao_Paulo',
                    day: '2-digit',
                    month: '2-digit',
                    year: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit',
                });

                let prefix;
                if (msg.fromMe) {
                    prefix = '<<Você:';
                } else {
                    prefix = `>>${contact.name || contact.pushname || contact.number}:`;
                }

                return `[${formattedDate}] ${prefix} ${msg.body}`;
            })
        );

        contextData.lastSentIndex += messagesToSelectCount;
        contextData.totalRawMessagesProvidedAsContext = contextData.lastSentIndex; // Update total processed

        logger.debug(`Context updated for ${contextGroupName}`, {
            newlyFormattedMessagesCount: newFormattedMessages.length,
            // totalFormattedMessagesInCache: contextData.formattedMessages.length, // If removing this field
            lastSentIndexAdvancedTo: contextData.lastSentIndex,
            totalRawMessagesProvidedThisInteraction: contextData.totalRawMessagesProvidedAsContext
        });

        return { 
            context: formatMessages(newFormattedMessages), 
            status: 'NEW_MESSAGES_SENT', 
            newMessagesCount: newFormattedMessages.length 
        };

    } catch (error) {
        logger.error('Error in fetchContextMessages:', error);
        return { context: '', status: 'ERROR_FETCHING_CONTEXT', newMessagesCount: 0 };
    }
}

/**
 * Format messages for display
 * @param {Array} messages - Array of formatted message strings
 * @returns {string} Formatted message history
 */
function formatMessages(messages) {
    if (!messages || messages.length === 0) {
        return '';
    }
    // Now formats the array of messages passed to it
    return messages.join('\n');
}

/**
 * Get current context stats for a group
 * @param {string} groupName - Group name
 * @returns {Object} Context statistics
 */
function getContextStats(groupName) {
    const contextGroupName = getContextGroupName(groupName);
    const contextData = contextCache.get(contextGroupName);
    
    if (!contextData) {
        return {
            totalMessagesInCache: 0,
            messagesSentCount: 0,
            hasMore: false,
            allMessagesLoadedFromSource: false,
            totalRawMessagesProvidedAsContext: 0
        };
    }
    
    return {
        totalMessagesInCache: contextData.allRawMessages.length,
        messagesSentCount: contextData.lastSentIndex, // This is the count of raw messages processed from allRawMessages
        hasMore: contextData.lastSentIndex < contextData.allRawMessages.length,
        allMessagesLoadedFromSource: contextData.allMessagesLoadedFromSource,
        totalRawMessagesProvidedAsContext: contextData.totalRawMessagesProvidedAsContext
    };
}

module.exports = {
    initializeContextManager,
    fetchContextMessages,
    clearContextCache,
    getContextStats,
    formatMessages,
    getContextGroupName
}; 