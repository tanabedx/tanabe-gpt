const {
    EVALUATE_CONTENT,
    BATCH_EVALUATE_TITLES,
    SUMMARIZE_CONTENT,
    SITREP_artorias_PROMPT,
    PROCESS_IMAGE_TEXT_EXTRACTION_PROMPT,
    DETECT_DUPLICATE,
    DETECT_TOPIC_REDUNDANCY,
    DETECT_STORY_DEVELOPMENT,
    EVALUATE_CONSEQUENCE_IMPORTANCE,
} = require('./newsMonitor.prompt');

/**
 * Dynamically loads Twitter API keys from environment variables.
 * Looks for variables matching the pattern TWITTER_*_BEARER_TOKEN.
 * For example, TWITTER_PRIMARY_BEARER_TOKEN becomes `primary`.
 * TWITTER_FALLBACK1_BEARER_TOKEN becomes `fallback1`.
 * @returns {Object} - An object containing the loaded Twitter API keys.
 */
function getDynamicTwitterKeys() {
    const twitterKeys = {};
    const keyPattern = /^TWITTER_(.+)_BEARER_TOKEN$/;

    // Keep a predefined order for consistency
    const keyOrder = [
        'PRIMARY',
        'FALLBACK1',
        'FALLBACK2',
        'FALLBACK3',
        'FALLBACK4',
        'FALLBACK5',
        'FALLBACK6',
        'FALLBACK7',
        'FALLBACK8',
        'FALLBACK9',
    ];
    const foundKeys = {};

    for (const envVar in process.env) {
        const match = envVar.match(keyPattern);
        if (match && match[1]) {
            const keyName = match[1]; // e.g., PRIMARY, FALLBACK1
            foundKeys[keyName] = process.env[envVar];
        }
    }

    // Sort found keys based on the predefined order
    keyOrder.forEach(keyName => {
        if (foundKeys[keyName]) {
            const configKeyName = keyName.toLowerCase(); // primary, fallback1
            twitterKeys[configKeyName] = { bearer_token: foundKeys[keyName] };
        }
    });

    return twitterKeys;
}

// Unified News Monitor configuration
const NEWS_MONITOR_CONFIG = {
    enabled: true, // Master toggle for news monitoring
    TARGET_GROUP: process.env.GROUP_LF, // Group to send news updates to
    CHECK_INTERVAL: 960000, // Global check interval for all sources 960000 (16 minutes) 86400000 (24hrs)
    QUIET_HOURS: {
        ENABLED: true,
        START_HOUR: 22,
        END_HOUR: 8,
        TIMEZONE: 'America/Sao_Paulo',
    },
    sources: [
        // Twitter Sources
            // mediaOnly: When mediaOnly=true: Image text extraction happens BEFORE content evaluation
                // - If image extraction fails for mediaOnly tweets, original text is used as fallback
            // skipEvaluation: All evaluation steps (except promptSpecific) use extracted image text instead of original tweet text
            // promptSpecific: Account-specific evaluation always uses original tweet text (before image extraction) - Account-specific evaluation always uses original tweet text (before image extraction)
        {
            type: 'twitter',
            enabled: true,
            username: 'BreakingNews',
            mediaOnly: false,
            skipEvaluation: false,
            promptSpecific: false,
            priority: 8,
            processLinksForShortTweets: true, // Enable link processing for short tweets
            shortTweetThreshold: null, // Use global threshold if null
        },
        {
            type: 'twitter',
            enabled: true,
            username: 'SITREP_artorias',
            mediaOnly: true,        
            skipEvaluation: false,   
            promptSpecific: true,
            priority: 9,
            processLinksForShortTweets: false, // Disabled for mediaOnly accounts (images take priority)
            shortTweetThreshold: null, // Use global threshold if null
        },
        // Example: Account with custom threshold for link processing
        {
            type: 'twitter',
            enabled: false, // Disabled by default - enable when needed
            username: 'example_news_account',
            mediaOnly: false,
            skipEvaluation: false,
            promptSpecific: false,
            priority: 7,
            processLinksForShortTweets: true, // Enable link processing
            shortTweetThreshold: 50, // Custom threshold: process links if tweet is under 50 chars
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
        BLACKLIST_KEYWORDS: ['VÍDEO', 'VÍDEOS', 'Assista', 'FOTOS', 'IMAGENS'],
        EXCLUDED_PATHS: ['podcast'],
        WHITELIST_PATHS: [
            '/mundo/noticia',
            '/economia/noticia',
            '/politica/noticia',
            '/sp/sao-paulo/noticia',
            '/Esportes/Noticias',
        ],
    },

    // Topic filtering configuration
    TOPIC_FILTERING: {
        ENABLED: true,
        COOLING_HOURS: 48, // How long to track related stories
        USE_IMPORTANCE_SCORING: true, // Use AI importance scoring instead of simple counting
        IMPORTANCE_THRESHOLDS: {
            FIRST_CONSEQUENCE: 5,   // Market reactions, standard responses (need 5+ to pass)
            SECOND_CONSEQUENCE: 7,  // Diplomatic developments (need 7+ to pass)
            THIRD_CONSEQUENCE: 9,   // Only game-changing revelations (need 9+ to pass)
        },
        CATEGORY_WEIGHTS: {
            ECONOMIC: 0.8,      // Economic news gets 80% weight (market reactions)
            DIPLOMATIC: 1.0,    // Diplomatic news full weight
            MILITARY: 1.2,      // Military developments 120% weight
            LEGAL: 1.3,         // Legal implications 130% weight
            INTELLIGENCE: 1.3,  // Intelligence revelations 130% weight
            HUMANITARIAN: 1.1,  // Humanitarian impacts 110% weight
            POLITICAL: 1.1,     // Political developments 110% weight
        },
        ESCALATION_THRESHOLD: 8.5, // If consequence scores higher, becomes new core event
        // Legacy settings (fallback)
        MAX_CONSEQUENCES: 3, // Max follow-up stories per topic (if importance scoring disabled)
        REQUIRE_HIGH_IMPORTANCE_FOR_CONSEQUENCES: true,
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

    // Link processing configuration for short tweets
    LINK_PROCESSING: {
        ENABLED: true,
        MIN_CHAR_THRESHOLD: 25, // Process links if non-link text content is under this character count
        MAX_LINK_CONTENT_CHARS: 3000, // Maximum characters to extract from links
        TIMEOUT: 15000, // Timeout for link processing in milliseconds
        RETRY_ATTEMPTS: 2, // Number of retry attempts on failure
        RETRY_DELAY: 1000, // Delay between retries in milliseconds
    },

    // AI model configurations
    AI_MODELS: {
        EVALUATE_CONTENT: 'o4-mini',
        BATCH_EVALUATE_TITLES: 'gpt-4o',
        SUMMARIZE_CONTENT: 'gpt-4o-mini',
        SITREP_artorias_PROMPT: 'gpt-4o-mini',
        PROCESS_IMAGE_TEXT_EXTRACTION_PROMPT: 'gpt-4o-mini',
        DETECT_DUPLICATE: 'gpt-4o',
        DETECT_TOPIC_REDUNDANCY: 'gpt-4o',
        DETECT_STORY_DEVELOPMENT: 'gpt-4o',
        EVALUATE_CONSEQUENCE_IMPORTANCE: 'gpt-4o',
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
        DETECT_STORY_DEVELOPMENT,
        EVALUATE_CONSEQUENCE_IMPORTANCE,
    },

    CREDENTIALS: {
        TWITTER_API_KEYS: getDynamicTwitterKeys(),
        // You can add other credentials here if needed, e.g., OPENAI_API_KEY
        // OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    },
};

module.exports = NEWS_MONITOR_CONFIG;
