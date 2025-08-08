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
    
    // Model selection based on context size
    modelSelection: {
        get rules() {
            const config = getConfig();
            return [
                { maxMessages: 100, model: config.SYSTEM.AI_MODELS.LOW },
                { maxMessages: 500, model: config.SYSTEM.AI_MODELS.MEDIUM },
                { maxMessages: 1000, model: config.SYSTEM.AI_MODELS.HIGH }
            ];
        },
        get default() {
            const config = getConfig();
            return config.SYSTEM.AI_MODELS.LOW;
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
        fallbackToLegacy: false, // Keep disabled while testing
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
        activationKeywords: [   // Keywords that trigger automatic web search
            'pesquisar',
            'buscar',
            'procurar',
            'search',
            'find',
            'what is',
            'what are',
            'como fazer',           // More specific than just 'como'
            'como funciona',        // More specific than just 'como'
            'onde encontrar',       // More specific than just 'onde'
            'onde fica',           // More specific than just 'onde'
            'quando aconteceu',     // More specific than just 'quando'
            'quando será',         // More specific than just 'quando'
            'por que aconteceu',   // More specific than just 'por que'
            'porque aconteceu',    // More specific than just 'porque'
            'how to',
            'where is',
            'where can',
            'when did',
            'when will',
            'why did',
            'latest',
            'recent',
            'current',
            'hoje aconteceu',      // More specific than just 'hoje'
            'notícias de hoje',    // More specific for news
            'now happening',
            'atualmente',
            'recente',
            'informações sobre',   // Explicit search intent
            'me fale sobre',       // Explicit search intent
            'quero saber sobre'    // Explicit search intent
        ],
        timeout: 10000          // Timeout for web search requests (ms)
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
