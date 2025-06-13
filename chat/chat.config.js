// chat.config.js
// Configuration for the chat command with conversation and context management

const CHAT_GPT_PROMPTS = require('./chatgpt.prompt');

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
    
    // Model selection based on context size
    modelSelection: {
        rules: [
            { maxMessages: 100, model: 'gpt-4o-mini' },   // Lightweight for small contexts
            { maxMessages: 500, model: 'gpt-4o' },        // Advanced for medium contexts
            { maxMessages: 1000, model: 'o4-mini' }        // Advanced for large contexts
        ],
        default: 'gpt-4o-mini' // Default fallback
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
        maintainMemory: true
    },
    
    // Web search settings
    webSearch: {
        enabled: true,
        model: 'gpt-4o',        // Model to use when processing web search results
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
    
    // System prompts reference from chatgpt.prompt.js
    systemPrompts: CHAT_GPT_PROMPTS.SYSTEM_PROMPTS,
    
    // Additional prompt references
    contextPrompts: CHAT_GPT_PROMPTS.CONTEXT_PROMPTS,
    errorPrompts: CHAT_GPT_PROMPTS.ERROR_PROMPTS,
    
    useGroupPersonality: true,
    model: '', // Will be determined dynamically
    maxMessageFetch: 1000, // Legacy compatibility
};

module.exports = CHAT_CONFIG;
