// chat.config.js
// Configuration for the chat command with conversation and context management

const CHAT_PROMPTS = require('./chatgpt.prompt');

function getConfig() {
    // Lazy-load to avoid circular dependency during startup
    // eslint-disable-next-line global-require
    return require('../configs/config');
}

const CHAT_CONFIG = {
    prefixes: ['#', '#!'],
    description:
        'Conversa com o ChatGPT usando sistema inteligente de contexto. Mantém conversas, busca contexto sob demanda, e usa modelos otimizados baseados no uso.',
    autoDelete: {
        errorMessages: true,
        commandMessages: false,
        deleteTimeout: 60000,
    },
    errorMessages: {
        invalidFormat: 'Por favor, forneça uma pergunta após #.',
        notAllowed: 'Você não tem permissão para usar este comando.',
        contextError: 'Erro ao buscar contexto adicional.',
        conversationError: 'Erro ao manter a conversa. Tente novamente.',
    },

    // Streaming behavior moved back to SYSTEM.STREAMING_ENABLED
    
    // Model selection based on context size (using MEDIUM as default for better context handling)
    modelSelection: {
        get rules() {
            const config = getConfig();
            return [
                { maxMessages: 50, model: config.SYSTEM.AI_MODELS.MEDIUM },   // Use MEDIUM for small conversations (better context handling)
                { maxMessages: 500, model: config.SYSTEM.AI_MODELS.MEDIUM },  // Continue with MEDIUM for medium conversations  
                { maxMessages: 1000, model: config.SYSTEM.AI_MODELS.HIGH }    // Use HIGH only for very large conversations
            ];
        },
        get default() {
            const config = getConfig();
            return config.SYSTEM.AI_MODELS.MEDIUM;  // Default to MEDIUM instead of LOW for better instruction following
        }
    },
    
    // Context management settings
    contextManagement: {
        chunkSize: 100,          // Messages per context request
        maxMessages: 1000,       // Legacy or other use? Retaining for now.
        maxTotalChatHistoryMessages: 1000, // Maximum total raw WhatsApp messages to process for context across requests
        maxContextRequests: 10,  // Maximum context requests per conversation turn (user query)
        enabled: true
    },
    
    // Conversation settings
    conversation: {
        maxTurns: 20,           // Maximum conversation turns before reset
        timeoutMinutes: 30,     // Conversation timeout
        maintainMemory: true,
        initialHistory: {
            enabled: true,
            messageCount: 10
        }
    },
    
    // Web search settings
    webSearch: {
        enabled: true,
        // OpenAI web_search tool integration (moved from SYSTEM)
        useOpenAITool: true,
        toolChoice: 'auto', // 'auto' | 'required'
        country: 'br',
        locale: 'pt_BR',
        enforceCitations: true, // Append a FONTES block at the end
        get model() {
            const config = getConfig();
            return config.SYSTEM.AI_MODELS.MEDIUM; // Model to use when processing web search results
        },
        maxResults: 5,          // Maximum number of search results to process
        maxSearchRequests: 5,   // Maximum manual search requests per conversation turn
        contentExtraction: {
            maxLength: 2000,        // Maximum characters to extract from each page
            fallbackOnError: true,  // Extract partial content even if page is too large
            minLength: 50          // Minimum characters required for content to be considered valid
        },

        timeout: 10000          // Timeout for web search requests (ms)
    },

    // Image generation settings - DISABLED (use #desenho and #desenhoedit commands instead)
    imageGeneration: {
        enabled: false,                     // Image generation disabled for ChatGPT
        maxImageRequests: 0,                // No image generation allowed
        timeout: 30000,                     // Keep for potential future use
        conversationMemory: {
            enabled: false,                 // No image memory needed
            maxImages: 0,                   // No images to remember
            includeInPrompt: false          // Don't include image memory in prompts
        },
        useExistingRouting: false,          // Not used since generation is disabled
        get defaultModel() {
            const config = getConfig();
            return config.SYSTEM.AI_MODELS.MEDIUM; // Standard model for vision-only conversations
        }
    },

    // Reasoning stays centralized under SYSTEM in configs/config.js
    
    // System prompts reference from chatgpt.prompt.js
    systemPrompts: CHAT_PROMPTS.SYSTEM_PROMPTS,
    
    // Additional prompt references
    contextPrompts: CHAT_PROMPTS.CONTEXT_PROMPTS,
    errorPrompts: CHAT_PROMPTS.ERROR_PROMPTS,
    
    useGroupPersonality: true,
    get model() {
        const config = getConfig();
        return config.SYSTEM.AI_MODELS.LOW; // Default fallback
    },
    maxMessageFetch: 1000, // Legacy compatibility
};

module.exports = CHAT_CONFIG;
