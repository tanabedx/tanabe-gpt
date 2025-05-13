const {
    EVALUATE_CONTENT,
    BATCH_EVALUATE_TITLES,
    SUMMARIZE_CONTENT,
    SITREP_artorias_PROMPT,
    PROCESS_SITREP_IMAGE_PROMPT,
    DETECT_DUPLICATE,
} = require('../../prompts/newsMonitor.prompt');

// Unified News Monitor configuration
const NEWS_MONITOR_CONFIG = {
    enabled: true, // Master toggle for news monitoring
    TARGET_GROUP: process.env.GROUP_AG, // Group to send news updates to

    // Twitter-specific configuration
    TWITTER_ENABLED: true, // Toggle for Twitter source
    TWITTER_CHECK_INTERVAL: 960000, // 16 minutes in milliseconds (API rate limit consideration)
    TWITTER_ACCOUNTS: [
        {
            username: 'BreakingNews',
            lastTweetId: '1874590993955123330',
            mediaOnly: false, // Regular news account - pull all tweets
            skipEvaluation: false, // Evaluate these tweets with ChatGPT
            promptSpecific: false, // Use unified EVALUATE_CONTENT prompt
        },
        {
            username: 'BrazilianReport',
            lastTweetId: null, // Will be populated after first fetch
            mediaOnly: false, // Regular news account - pull all tweets
            skipEvaluation: false, // Evaluate these tweets with ChatGPT
            promptSpecific: false, // Use unified EVALUATE_CONTENT prompt
        },
        {
            username: 'SITREP_artorias',
            lastTweetId: null, // Will be populated after first fetch
            mediaOnly: true, // Only pull tweets with media attachments
            skipEvaluation: true, // Skip standard evaluation and rely only on account-specific prompt
            promptSpecific: true, // Use account-specific prompt
        },
    ],

    // RSS-specific configuration
    RSS_ENABLED: true, // Toggle for RSS source
    RSS_CHECK_INTERVAL: 86400000, //3600000, // 1 hour in milliseconds (batch processing window)
    TWO_STAGE_EVALUATION: true, // Enable two-stage evaluation to optimize token usage
    FEEDS: [
        {
            id: 'g1',
            name: 'G1',
            url: 'https://g1.globo.com/rss/g1/',
            language: 'pt',
        },
        {
            id: 'ge',
            name: 'Globo Esporte',
            url: 'https://ge.globo.com/Esportes/Rss/0,,AS0-9645,00.xml',
            language: 'pt',
        },
    ],

    // Content filtering configuration
    CONTENT_FILTERING: {
        // Title patterns to filter out (considered low-quality or less relevant)
        TITLE_PATTERNS: ['VÍDEO:', 'VÍDEOS:', 'Assista', 'FOTOS:', 'IMAGENS:'],
        // Path segments to always exclude (like podcast content)
        EXCLUDED_PATHS: [
            'podcast', // Exclude podcast content
        ],
        // Whitelist of G1 paths to include (only these paths will be processed)
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
        ENABLED: true, // Toggle for historical cache
        RETENTION_HOURS: 24, // How long to remember sent articles (in hours)
        RETENTION_DAYS: 2, // How long to keep entries in the persistent cache (in days)
        SIMILARITY_THRESHOLD: 0.7, // Title similarity threshold (0.0-1.0) for considering articles as duplicates
        BATCH_SIMILARITY_THRESHOLD: 0.65, // Threshold for considering articles as duplicates within the same batch (lower than historical for more aggressive de-duplication)
    },

    // Quiet hours configuration
    QUIET_HOURS: {
        ENABLED: true, // Toggle for quiet hours feature
        START_HOUR: 22, // Hour to start quiet period (24-hour format, 0-23)
        END_HOUR: 8, // Hour to end quiet period (24-hour format, 0-23)
        TIMEZONE: 'America/Sao_Paulo', // Timezone for quiet hours calculation
    },

    // Content character limits for prompts (to optimize token usage)
    CONTENT_LIMITS: {
        EVALUATION_CHAR_LIMIT: 2000, // Limit content to 2000 chars for evaluation
        SUMMARY_CHAR_LIMIT: 0, // No limit (0 = unlimited) for summarization
    },

    // AI model configurations for different prompt types
    AI_MODELS: {
        EVALUATE_CONTENT: 'gpt-4o', // Fast model for content relevance evaluation
        BATCH_EVALUATE_TITLES: 'gpt-4o-mini', // Fast model for batch title evaluation
        SUMMARIZE_CONTENT: 'gpt-4o-mini', // More powerful model for high-quality summaries
        SITREP_artorias_PROMPT: 'gpt-4o-mini', // Fast model for SITREP evaluation
        PROCESS_SITREP_IMAGE_PROMPT: 'gpt-4o-mini', // Vision model for image processing
        DETECT_DUPLICATE: 'gpt-4o', // Model for detecting duplicate content
        TRANSLATION: 'gpt-4o-mini', // Model for text translation
        DEFAULT: 'gpt-4o-mini', // Default model if not specified
    },

    // Prompts for content evaluation and summarization
    PROMPTS: {
        EVALUATE_CONTENT,
        BATCH_EVALUATE_TITLES,
        SUMMARIZE_CONTENT,
        SITREP_artorias_PROMPT,
        PROCESS_SITREP_IMAGE_PROMPT,
        DETECT_DUPLICATE,
    },
};

module.exports = NEWS_MONITOR_CONFIG;
