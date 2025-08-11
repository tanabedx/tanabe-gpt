const PROMPTS = require('./newsMonitor.prompt');

// Note: Do NOT require the main config here to avoid circular dependency with `configs/config.js`.
// We express tier intent using tokens (e.g., 'TIER:LOW') that are resolved at runtime in `utils/openaiUtils.js`.
const TIER = { LOW: 'TIER:LOW', MEDIUM: 'TIER:MEDIUM', HIGH: 'TIER:HIGH' };

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
            imageAttachments: { enabled: false, maxImagesPerItem: 1 },
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
            imageAttachments: { enabled: false, maxImagesPerItem: 1 },
        },
        // Example: Account with custom threshold for link processing
        {
            type: 'twitter',
            enabled: true,
            username: 'QuiverQuant',
            mediaOnly: false,
            skipEvaluation: true,
            promptSpecific: true,
            priority: 7,
            processLinksForShortTweets: true,
            shortTweetThreshold: null,
            imageAttachments: { enabled: true, maxImagesPerItem: 1 },
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
        // Webscraper Sources
        {
            type: 'webscraper',
            enabled: true,
            name: 'GE Globo',
            url: 'https://ge.globo.com/',
            paginationPattern: 'https://ge.globo.com/index/feed/pagina-{page}.ghtml',
            scrapeMethod: 'pagination',
            priority: 4, // Lower priority than main news sources
            selectors: {
                container: '.feed-post',
                title: '.feed-post-body h2 a',
                link: '.feed-post-body h2 a',
                time: '.feed-post-metadata',
                content: '.feed-post-body p'
            },
            userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36'
        },
    ],

    // Content filtering configuration
    CONTENT_FILTERING: {
        BLACKLIST_KEYWORDS: ['VÍDEO', 'VÍDEOS', 'Assista', 'FOTOS', 'IMAGENS'],
        EXCLUDED_PATHS: ['podcast'],
        WHITELIST_PATHS: [
            // Domain-based whitelist (most permissive - allows all content from domain)
            'ge.globo.com',
            // Path-based whitelist (more restrictive - specific URL paths only)
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
            FIRST_CONSEQUENCE: 7,   // Increased from 5 - Only significant developments
            SECOND_CONSEQUENCE: 8,  // Increased from 7 - Important revelations only  
            THIRD_CONSEQUENCE: 10,  // Increased from 9 - Only absolute game-changers
        },
        CATEGORY_WEIGHTS: {
            ECONOMIC: 0.7,      // Reduced from 0.8 - Economic news even more penalized
            DIPLOMATIC: 0.9,    // Reduced from 1.0 - Standard diplomatic news penalized
            MILITARY: 1.1,      // Reduced from 1.2 - Military developments less weighted
            LEGAL: 0.9,         // Reduced from 1.3 - Legal implications less weighted
            INTELLIGENCE: 1.1,  // Reduced from 1.3 - Intelligence revelations less weighted
            HUMANITARIAN: 0.9,  // Reduced from 1.1 - Humanitarian impacts standard weight
            POLITICAL: 1.0,     // Reduced from 1.1 - Political developments standard weight
            SPORTS: 1.2,        // Soccer news boosted due to personal interest
        },
        ESCALATION_THRESHOLD: 9.5, // Increased from 8.5 - Much higher bar for new core events
        // Legacy settings (fallback)
        MAX_CONSEQUENCES: 2, // Max follow-up stories per topic (if importance scoring disabled)
        REQUIRE_HIGH_IMPORTANCE_FOR_CONSEQUENCES: true,
    },

    // Sent article cache configuration
    HISTORICAL_CACHE: {
        ENABLED: true,
        RETENTION_DAYS: 5,
        SIMILARITY_THRESHOLD: 0.7,
        BATCH_SIMILARITY_THRESHOLD: 0.65,
    },

    // Content character limits for prompts
    CONTENT_LIMITS: {
        EVALUATION_CHAR_LIMIT: 2000,
        SUMMARY_CHAR_LIMIT: 0,
    },

    // Webscraper configuration
    WEBSCRAPER: {
        MAX_ITEMS_PER_SOURCE: 50,
        DEFAULT_TIMEOUT: 15000,
        DEFAULT_RETRY_ATTEMPTS: 2,
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

    // (deprecated) IMAGE_ATTACHMENTS: per-account settings now live under each twitter source

    // AI model configurations (tier tokens resolved at runtime)
    AI_MODELS: {
        // HIGH tier: complex evaluation tasks
        BATCH_EVALUATE_TITLES: TIER.HIGH,
        EVALUATE_CONSEQUENCE_IMPORTANCE: TIER.HIGH,

        // MEDIUM tier: standard processing tasks
        EVALUATE_CONTENT: TIER.HIGH,
        DETECT_DUPLICATE: TIER.MEDIUM,
        DETECT_STORY_DEVELOPMENT: TIER.HIGH,
        DETECT_TOPIC_REDUNDANCY: TIER.HIGH,

        // LOW tier: simpler tasks and fallbacks
        SUMMARIZE_CONTENT: TIER.LOW,
        SITREP_artorias_PROMPT: TIER.LOW,
        QuiverQuant_PROMPT: TIER.MEDIUM,
        // DETECT_IMAGE_PROMPT intentionally left undefined for now (generic prompt blank)
        QuiverQuant_IMAGE_PROMPT: TIER.MEDIUM,
        PROCESS_IMAGE_TEXT_EXTRACTION_PROMPT: TIER.LOW,
        TRANSLATION: TIER.LOW,
        DEFAULT: TIER.LOW,
    },

    // Prompts for content evaluation and summarization
    PROMPTS: PROMPTS,

    CREDENTIALS: {
        TWITTER_API_KEYS: getDynamicTwitterKeys(),
        // You can add other credentials here if needed, e.g., OPENAI_API_KEY
        // OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    },
};

module.exports = NEWS_MONITOR_CONFIG;
