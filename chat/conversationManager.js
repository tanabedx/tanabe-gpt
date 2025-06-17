const logger = require('../utils/logger');
const { runConversationCompletion } = require('../utils/openaiUtils');
const GROUP_PERSONALITIES = require('./personalities.prompt');
const {
    shouldPerformWebSearch,
    extractSearchQuery,
    searchWithContent
} = require('./webSearchUtils');

// Conversation state management
let conversations = new Map(); // groupName -> { messages: [], messageCount: number, lastActivity: Date, model: string }

// Get group names from environment variables
const GROUP_LF = process.env.GROUP_LF;

/**
 * Initialize conversation manager
 */
function initializeConversationManager() {
    try {
        // Clean up old conversations periodically
        setInterval(() => {
            cleanupExpiredConversations();
        }, 5 * 60 * 1000); // Every 5 minutes

        logger.debug('Conversation manager initialized successfully');
    } catch (error) {
        logger.error('Error initializing conversation manager:', error);
    }
}

/**
 * Clean up expired conversations
 */
function cleanupExpiredConversations() {
    const now = new Date();
    const config = require('../configs/config');
    const timeoutMs = (config?.COMMANDS?.CHAT?.conversation?.timeoutMinutes || 30) * 60 * 1000;

    for (const [groupName, conversation] of conversations.entries()) {
        if (now - conversation.lastActivity > timeoutMs) {
            conversations.delete(groupName);
            logger.debug(`Conversation expired for group: ${groupName}`);
        }
    }
}

/**
 * Get the appropriate group name for conversation
 * @param {string|null} originalGroupName - Original group name
 * @param {string} adminNumber - Admin number
 * @returns {string} The group name to use for conversation
 */
function getConversationGroupName(originalGroupName, adminNumber) {
    const isAdminChat =
        !originalGroupName || 
        originalGroupName === `${adminNumber}@c.us` || 
        (typeof originalGroupName === 'string' && originalGroupName.includes(adminNumber));

    // For admin chat, use the GROUP_LF group
    if (isAdminChat) {
        logger.debug(`Using ${GROUP_LF} group for admin chat conversation`);
        return GROUP_LF;
    }

    return originalGroupName;
}

/**
 * Determine the model to use based on total context messages count
 * @param {number} contextMessageCount - Total context messages provided to the conversation
 * @param {Object} config - Configuration object
 * @returns {string} Model name to use
 */
function selectModel(contextMessageCount, config) {
    const rules = config?.COMMANDS?.CHAT?.modelSelection?.rules || [];
    const defaultModel = config?.COMMANDS?.CHAT?.modelSelection?.default || 'gpt-4o-mini';

    // Find the appropriate model based on context message count
    for (const rule of rules) {
        if (contextMessageCount <= rule.maxMessages) {
            logger.debug(`Selected model ${rule.model} for ${contextMessageCount} context messages`);
            return rule.model;
        }
    }

    logger.debug(`Using default model ${defaultModel} for ${contextMessageCount} context messages`);
    return defaultModel;
}

/**
 * Get system prompt for the conversation
 * @param {Object} config - Configuration object
 * @param {string} groupName - Group name
 * @param {string} promptType - Type of prompt (initial, withContext, humor)
 * @returns {string} System prompt
 */
function getSystemPrompt(config, groupName, promptType = 'initial') {
    let systemPrompt = config?.COMMANDS?.CHAT?.systemPrompts?.[promptType] || '';
    
    // Add group personality if enabled
    if (config?.COMMANDS?.CHAT?.useGroupPersonality && GROUP_PERSONALITIES[groupName]) {
        const personality = GROUP_PERSONALITIES[groupName];
        systemPrompt += `\n\nPersonalidade do grupo:\n ${personality}`;
    }

    return systemPrompt;
}

/**
 * Initialize or get existing conversation
 * @param {string} groupName - Group name
 * @param {string} adminNumber - Admin number
 * @param {Object} config - Configuration object
 * @param {string} promptType - Type of prompt for system message
 * @returns {Object} Conversation object
 */
function initializeConversation(groupName, adminNumber, config, promptType = 'initial') {
    const conversationGroupName = getConversationGroupName(groupName, adminNumber);
    
    if (!conversations.has(conversationGroupName)) {
        const systemPrompt = getSystemPrompt(config, conversationGroupName, promptType);
        
        conversations.set(conversationGroupName, {
            messages: [
                { role: 'system', content: systemPrompt }
            ],
            messageCount: 0,
            totalContextMessages: 0, // Track total context messages provided
            lastActivity: new Date(),
            model: selectModel(0, config) // Start with 0 context messages
        });
        
        logger.debug(`Initialized new conversation for ${conversationGroupName}`, {
            promptType,
            systemPromptLength: systemPrompt.length
        });
    } else {
        // Update last activity
        conversations.get(conversationGroupName).lastActivity = new Date();
    }

    return conversations.get(conversationGroupName);
}

/**
 * Add user message to conversation
 * @param {string} groupName - Group name
 * @param {string} adminNumber - Admin number
 * @param {string} userName - User name
 * @param {string} userMessage - User message (already formatted)
 * @param {Object} config - Configuration object
 * @returns {Object} Conversation object
 */
function addUserMessage(groupName, adminNumber, userName, userMessage, config) {
    const conversation = initializeConversation(groupName, adminNumber, config);
    
    // The userMessage is already formatted by formatUserMessage, so use it directly
    conversation.messages.push({
        role: 'user',
        content: userMessage
    });
    
    conversation.messageCount += 1;
    conversation.lastActivity = new Date();
    
    // Update model based on total context messages provided (not conversation message count)
    conversation.model = selectModel(conversation.totalContextMessages, config);
    
    logger.debug(`Added user message to conversation`, {
        groupName: getConversationGroupName(groupName, adminNumber),
        messageCount: conversation.messageCount,
        totalMessages: conversation.messages.length,
        totalContextMessages: conversation.totalContextMessages,
        model: conversation.model
    });
    
    return conversation;
}

/**
 * Add context to conversation
 * @param {string} groupName - Group name
 * @param {string} adminNumber - Admin number
 * @param {string} context - Context to add
 * @param {Object} config - Configuration object
 * @param {string} originalQuestion - Original user question to reiterate
 * @param {boolean} isAutoInjected - Whether this context was automatically injected
 * @returns {Object} Conversation object
 */
function addContextToConversation(groupName, adminNumber, context, config, originalQuestion = null, isAutoInjected = false) {
    const conversationGroupName = getConversationGroupName(groupName, adminNumber);
    const conversation = conversations.get(conversationGroupName);
    
    if (!conversation) {
        throw new Error('Conversation not found for context addition');
    }
    
    if (context && context.trim()) {
        // Get the appropriate context prompt - use aggressive prompt if auto-injected
        const contextPromptKey = isAutoInjected ? 'autoContextAdded' : 'contextAdded';
        const contextPrompt = config?.COMMANDS?.CHAT?.contextPrompts?.[contextPromptKey] || 
                             'Use as mensagens de contexto do chat anexadas abaixo para responder à pergunta do usuário de forma mais precisa e contextualizada.';
        
        // Structure: Prompt first with original question reminder, then clear separation, then context attachment
        let fullContextMessage = `${contextPrompt}`;

        // Add original question reminder at the top with the prompt
        if (originalQuestion) {
            fullContextMessage += `\n\nLembre-se: A pergunta original do usuário foi: "${originalQuestion}"`;
        }

        fullContextMessage += `

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📋 CONTEXTO DO CHAT - MENSAGENS HISTÓRICAS:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

${context}`;
        
        conversation.messages.push({
            role: 'system',
            content: fullContextMessage
        });
        
        // Count the number of individual messages in the context
        const contextLines = context.split('\n').filter(line => line.trim().length > 0);
        const contextMessageCount = contextLines.filter(line => 
            line.includes('] >>') || line.includes('] <<')
        ).length;
        conversation.totalContextMessages += contextMessageCount;
        
        // Update model selection based on total context messages
        conversation.model = selectModel(conversation.totalContextMessages, config);
        
        logger.debug(`Added context to conversation`, {
            groupName: conversationGroupName,
            contextLength: context.length,
            contextMessagesAdded: contextMessageCount,
            totalContextMessages: conversation.totalContextMessages,
            totalConversationMessages: conversation.messages.length,
            newModel: conversation.model,
            isAutoInjected: isAutoInjected
        });
    }
    
    conversation.lastActivity = new Date();
    return conversation;
}

/**
 * Add raw message to conversation (with specific role and content)
 * @param {string} conversationGroupName - Conversation group name (already processed)
 * @param {Object} message - Message object with role and content
 * @param {Object} config - Configuration object
 * @returns {Object} Conversation object
 */
function addRawMessageToConversation(conversationGroupName, message, config) {
    const conversation = conversations.get(conversationGroupName);
    
    if (!conversation) {
        throw new Error('Conversation not found for raw message addition');
    }
    
    conversation.messages.push(message);
    conversation.lastActivity = new Date();
    
    // Update model selection based on total context messages (not conversation messages)
    conversation.model = selectModel(conversation.totalContextMessages, config);
    
    logger.debug(`Added raw message to conversation`, {
        groupName: conversationGroupName,
        role: message.role,
        contentLength: message.content.length,
        totalConversationMessages: conversation.messages.length,
        totalContextMessages: conversation.totalContextMessages,
        model: conversation.model
    });
    
    return conversation;
}

/**
 * Get AI response from conversation
 * @param {string} groupName - Group name
 * @param {string} adminNumber - Admin number
 * @param {Object} config - Configuration object
 * @returns {Promise<string>} AI response
 */
async function getAIResponse(groupName, adminNumber, config) {
    const conversationGroupName = getConversationGroupName(groupName, adminNumber);
    const conversation = conversations.get(conversationGroupName);
    
    if (!conversation) {
        throw new Error('Conversation not found for AI response');
    }
    
    try {
        logger.debug(`Getting AI response`, {
            groupName: conversationGroupName,
            totalConversationMessages: conversation.messages.length,
            totalContextMessages: conversation.totalContextMessages,
            model: conversation.model
        });
        
        // Check if the last user message requires web search
        const lastUserMessage = conversation.messages
            .slice()
            .reverse()
            .find(msg => msg.role === 'user');
            
        let searchResults = null;
        let modelToUse = conversation.model;
        
        if (lastUserMessage && shouldPerformWebSearch(lastUserMessage.content, config)) {
            const query = extractSearchQuery(lastUserMessage.content);
            if (query && query.length > 2) {
                logger.debug(`Performing web search for query: "${query}"`);
                try {
                    // Use config settings for web search
                    const webSearchConfig = config?.COMMANDS?.CHAT?.webSearch || {};
                    const maxResults = webSearchConfig.maxResults || 3;
                    
                    searchResults = await searchWithContent(query, maxResults, true, config);
                    
                    if (searchResults && searchResults.results && searchResults.results.length > 0) {
                        // Use webSearch.model if available and web search was performed
                        if (webSearchConfig.model) {
                            modelToUse = webSearchConfig.model;
                            logger.debug(`Using web search model: ${modelToUse}`);
                        }
                        
                        // Add search results as a system message
                        const searchResultsMessage = {
                            role: 'system',
                            content: `RESULTADOS DE PESQUISA NA INTERNET:
Consulta: "${query}"
Timestamp: ${new Date().toLocaleString('pt-BR')}

${searchResults.summary}

INSTRUÇÕES: Use essas informações atualizadas da internet para responder à pergunta do usuário. Cite as fontes quando relevante. Se as informações estiverem desatualizadas ou incompletas, mencione isso ao usuário.`
                        };
                        
                        conversation.messages.push(searchResultsMessage);
                        
                        logger.debug(`Added web search results to conversation`, {
                            groupName: conversationGroupName,
                            query,
                            resultsCount: searchResults.results.length,
                            totalConversationMessages: conversation.messages.length,
                            usingWebSearchModel: webSearchConfig.model ? true : false
                        });
                    }
                } catch (searchError) {
                    logger.error('Error performing web search:', searchError);
                    // Continue without search results
                }
            }
        }
        
        const response = await runConversationCompletion(
            conversation.messages,
            1, // temperature
            modelToUse, // Use the determined model (either conversation.model or webSearch.model)
            null // promptType
        );
        
        // Extract the content from the response
        const responseContent = response.content || response;
        
        // Add AI response to conversation
        conversation.messages.push({
            role: 'assistant',
            content: responseContent
        });
        
        // Update model selection based on total context messages (not conversation messages)
        // Note: Only update if web search wasn't used to preserve the original model logic
        if (!searchResults) {
            conversation.model = selectModel(conversation.totalContextMessages, config);
        }
        
        conversation.lastActivity = new Date();
        
        logger.debug(`AI response added to conversation`, {
            groupName: conversationGroupName,
            responseLength: responseContent.length,
            totalConversationMessages: conversation.messages.length,
            totalContextMessages: conversation.totalContextMessages,
            originalModel: conversation.model,
            usedModel: modelToUse,
            usedWebSearch: searchResults ? true : false,
            modelUpdated: !searchResults
        });
        
        return responseContent;
        
    } catch (error) {
        logger.error('Error getting AI response:', error);
        throw error;
    }
}

/**
 * Reset conversation for a group
 * @param {string} groupName - Group name
 * @param {string} adminNumber - Admin number
 */
function resetConversation(groupName, adminNumber) {
    const conversationGroupName = getConversationGroupName(groupName, adminNumber);
    conversations.delete(conversationGroupName);
    logger.debug(`Conversation reset for group: ${conversationGroupName}`);
}

/**
 * Reset all conversations (useful when updating system prompts)
 */
function resetAllConversations() {
    const conversationCount = conversations.size;
    conversations.clear();
    logger.info(`All conversations reset. ${conversationCount} conversations cleared.`);
}

/**
 * Get conversation stats
 * @param {string} groupName - Group name
 * @param {string} adminNumber - Admin number
 * @returns {Object} Conversation statistics
 */
function getConversationStats(groupName, adminNumber) {
    const conversationGroupName = getConversationGroupName(groupName, adminNumber);
    const conversation = conversations.get(conversationGroupName);
    
    if (!conversation) {
        return {
            exists: false,
            messageCount: 0,
            totalContextMessages: 0,
            model: null,
            lastActivity: null
        };
    }
    
    return {
        exists: true,
        messageCount: conversation.messageCount,
        totalContextMessages: conversation.totalContextMessages,
        model: conversation.model,
        lastActivity: conversation.lastActivity,
        totalMessages: conversation.messages.length
    };
}

/**
 * Update model selection for a conversation based on total context messages count
 * @param {string} conversationGroupName - Conversation group name (already processed)
 * @param {Object} config - Configuration object
 * @returns {string} Updated model name
 */
function updateModelForConversation(conversationGroupName, config) {
    const conversation = conversations.get(conversationGroupName);
    
    if (!conversation) {
        throw new Error('Conversation not found for model update');
    }
    
    const previousModel = conversation.model;
    conversation.model = selectModel(conversation.totalContextMessages, config);
    
    if (previousModel !== conversation.model) {
        logger.debug(`Model updated for conversation`, {
            groupName: conversationGroupName,
            previousModel,
            newModel: conversation.model,
            totalContextMessages: conversation.totalContextMessages,
            totalConversationMessages: conversation.messages.length
        });
    }
    
    return conversation.model;
}

module.exports = {
    initializeConversationManager,
    initializeConversation,
    addUserMessage,
    addContextToConversation,
    addRawMessageToConversation,
    updateModelForConversation,
    getAIResponse,
    resetConversation,
    resetAllConversations,
    getConversationStats,
    getConversationGroupName,
    selectModel
}; 