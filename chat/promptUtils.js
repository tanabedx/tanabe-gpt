const logger = require('../utils/logger');
const GROUP_PERSONALITIES = require('./personalities.prompt');

// Get group names from environment variables
const GROUP_LF = process.env.GROUP_LF;

/**
 * Get the appropriate group name for prompt context
 * @param {string|null} originalGroupName - Original group name
 * @param {string} adminNumber - Admin number
 * @returns {string} The group name to use for prompts
 */
function getPromptGroupName(originalGroupName, adminNumber) {
    const isAdminChat =
        !originalGroupName || 
        originalGroupName === `${adminNumber}@c.us` || 
        (typeof originalGroupName === 'string' && originalGroupName.includes(adminNumber));

    // For admin chat, use the GROUP_LF group
    if (isAdminChat) {
        logger.debug(`Using ${GROUP_LF} group for admin chat prompts`);
        return GROUP_LF;
    }

    return originalGroupName;
}

/**
 * Get group personality for a given group
 * @param {string} groupName - Group name
 * @returns {string} Group personality or empty string
 */
function getGroupPersonality(groupName) {
    if (!groupName || !GROUP_PERSONALITIES[groupName]) {
        return '';
    }
    
    return GROUP_PERSONALITIES[groupName];
}

/**
 * Format user message with context for conversation
 * @param {string} userName - User name
 * @param {string} question - User question
 * @param {string|null} quotedContext - Optional quoted message context
 * @param {string|null} linkContext - Optional link content context
 * @returns {string} Formatted user message
 */
function formatUserMessage(userName, question, quotedContext = null, linkContext = null) {
    const timestamp = new Date().toLocaleString('pt-BR', {
        timeZone: 'America/Sao_Paulo',
        day: '2-digit',
        month: '2-digit',
        year: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
    });

    let message = `[${timestamp}] ${userName} pergunta: ${question}`;

    // Add quoted context if available - with clear separation
    if (quotedContext && quotedContext.trim()) {
        message += `

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
💬 CONTEXTO DA MENSAGEM CITADA:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

${quotedContext}`;
    }

    // Add link context if available - with clear separation
    if (linkContext && linkContext.trim()) {
        message += `

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔗 CONTEXTO DO LINK:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

${linkContext}`;
    }

    return message;
}

/**
 * Create system prompt for conversation initialization
 * @param {Object} config - Configuration object
 * @param {string} groupName - Group name
 * @param {string} promptType - Type of prompt (initial, withContext, humor)
 * @returns {string} System prompt
 */
function createSystemPrompt(config, groupName, promptType = 'initial') {
    let systemPrompt = config?.COMMANDS?.CHAT?.systemPrompts?.[promptType] || '';
    
    // Add group personality if enabled
    if (config?.COMMANDS?.CHAT?.useGroupPersonality) {
        const personality = getGroupPersonality(groupName);
        if (personality) {
            systemPrompt += `\n\nPersonalidade do grupo: ${personality}`;
        }
    }

    logger.debug(`Created system prompt for ${groupName}`, {
        promptType,
        hasPersonality: !!getGroupPersonality(groupName),
        promptLength: systemPrompt.length
    });

    return systemPrompt;
}

/**
 * Determine prompt type based on command prefix
 * @param {string} commandPrefix - Command prefix used (# or #!)
 * @returns {string} Prompt type
 */
function getPromptTypeFromPrefix(commandPrefix) {
    if (commandPrefix === '#!') {
        return 'humor';
    }
    return 'initial';
}

/**
 * Legacy compatibility function - get chat prompt (deprecated)
 * @deprecated Use createSystemPrompt instead
 */
function getChatPrompt() {
    logger.warn('getChatPrompt is deprecated. Use createSystemPrompt instead.');
    return '';
}

/**
 * Legacy compatibility function - get chat prompt with context (deprecated)
 * @deprecated Use conversation system instead
 */
async function getChatPromptWithContext() {
    logger.warn('getChatPromptWithContext is deprecated. Use conversation system instead.');
    return '';
}

module.exports = {
    getPromptGroupName,
    getGroupPersonality,
    formatUserMessage,
    createSystemPrompt,
    getPromptTypeFromPrefix,
    // Legacy compatibility (deprecated)
    getChatPrompt,
    getChatPromptWithContext
}; 