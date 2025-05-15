const {
    EVALUATE_CONTENT,
    BATCH_EVALUATE_TITLES,
    SUMMARIZE_CONTENT,
    SITREP_artorias_PROMPT,
    PROCESS_IMAGE_TEXT_EXTRACTION_PROMPT,
    DETECT_DUPLICATE,
    DETECT_TOPIC_REDUNDANCY,
} = require('../prompts/newsMonitor.prompt');

// Unified News Monitor configuration
const NEWS_MONITOR_CONFIG = {
    enabled: true, // Master toggle for news monitoring
    TARGET_GROUP: process.env.GROUP_AG, // Group to send news updates to
    CHECK_INTERVAL: 960000, // Global check interval for all sources (16 minutes) 86400000, //debug option
    // Quiet hours configuration
    QUIET_HOURS: {
        ENABLED: true,
        START_HOUR: 22,
        END_HOUR: 8,
        TIMEZONE: 'America/Sao_Paulo',
    },
    sources: [
        // Twitter Sources
        {
            type: 'twitter',
            enabled: true,
            username: 'BreakingNews',
            lastTweetId: '1874590993955123330',
            mediaOnly: false,
            skipEvaluation: false,
            promptSpecific: false,
            priority: 8,
        },
        {
            type: 'twitter',
            enabled: true,
            username: 'BrazilianReport',
            lastTweetId: null,
            mediaOnly: false,
            skipEvaluation: false,
            promptSpecific: false,
            priority: 7,
        },
        {
            type: 'twitter',
            enabled: true,
            username: 'SITREP_artorias',
            lastTweetId: null,
            mediaOnly: true,
            skipEvaluation: true,
            promptSpecific: true,
            priority: 9,
        },
        // RSS Sources
        {
            type: 'rss',
            enabled: true,
            id: 'g1',
            name: 'G1',
            url: 'https://g1.globo.com/rss/g1/',
            language: 'pt',
            priority: 6,
        },
        {
            type: 'rss',
            enabled: true,
            id: 'ge',
            name: 'Globo Esporte',
            url: 'https://ge.globo.com/Esportes/Rss/0,,AS0-9645,00.xml',
            language: 'pt',
            priority: 5,
        },
        // Webscraper Source Placeholder
        {
            type: 'webscraper',
            enabled: true,
            name: 'Generic Webscraper',
            url: 'https://example.com/news', // Placeholder URL
            selectorConfig: {
                articleSelector: '.news-item',
                titleSelector: '.title',
                linkSelector: 'a',
                dateSelector: '.date', // Optional
            },
            priority: 3,
        },
    ],

    // Content filtering configuration
    CONTENT_FILTERING: {
        BLACKLIST_KEYWORDS: ['VÍDEO:', 'VÍDEOS:', 'Assista', 'FOTOS:', 'IMAGENS:'],
        EXCLUDED_PATHS: ['podcast'],
        WHITELIST_PATHS: [
            '/mundo/noticia',
            '/economia/noticia',
            '/politica/noticia',
            '/sp/sao-paulo/noticia',
            '/Esportes/Noticias',
        ],
    },

    // Sent article cache configuration
    HISTORICAL_CACHE: {
        ENABLED: true,
        RETENTION_HOURS: 24,
        RETENTION_DAYS: 2,
        SIMILARITY_THRESHOLD: 0.7,
        BATCH_SIMILARITY_THRESHOLD: 0.65,
    },

    // Content character limits for prompts
    CONTENT_LIMITS: {
        EVALUATION_CHAR_LIMIT: 2000,
        SUMMARY_CHAR_LIMIT: 0,
    },

    // AI model configurations
    AI_MODELS: {
        EVALUATE_CONTENT: 'gpt-4o',
        BATCH_EVALUATE_TITLES: 'gpt-4o',
        SUMMARIZE_CONTENT: 'gpt-4o-mini',
        SITREP_artorias_PROMPT: 'gpt-4o-mini',
        PROCESS_IMAGE_TEXT_EXTRACTION_PROMPT: 'gpt-4o-mini',
        DETECT_DUPLICATE: 'gpt-4o',
        DETECT_TOPIC_REDUNDANCY: 'gpt-4o',
        TRANSLATION: 'gpt-4o-mini',
        DEFAULT: 'gpt-4o-mini',
    },

    // Prompts for content evaluation and summarization
    PROMPTS: {
        EVALUATE_CONTENT,
        BATCH_EVALUATE_TITLES,
        SUMMARIZE_CONTENT,
        SITREP_artorias_PROMPT,
        PROCESS_IMAGE_TEXT_EXTRACTION_PROMPT,
        DETECT_DUPLICATE,
        DETECT_TOPIC_REDUNDANCY,
    },

    CREDENTIALS: {
        TWITTER_API_KEYS: {
            // IMPORTANT: Ensure your .env file is loaded (e.g., using dotenv library)
            // so that process.env contains your Twitter bearer tokens.
            primary: { bearer_token: process.env.TWITTER_PRIMARY_BEARER_TOKEN },
            fallback1: { bearer_token: process.env.TWITTER_FALLBACK_BEARER_TOKEN },
            fallback2: { bearer_token: process.env.TWITTER_FALLBACK2_BEARER_TOKEN },
            fallback3: { bearer_token: process.env.TWITTER_FALLBACK3_BEARER_TOKEN},
            // Add more keys here if you have them, following the same pattern:
            // your_key_name: { bearer_token: process.env.YOUR_ENV_VARIABLE_FOR_TOKEN }
        },
        // You can add other credentials here if needed, e.g., OPENAI_API_KEY
        // OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    },
};

module.exports = NEWS_MONITOR_CONFIG;
