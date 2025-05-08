const {
    EVALUATE_TWEET,
    EVALUATE_ARTICLE,
    BATCH_EVALUATE_TITLES,
    BATCH_EVALUATE_FULL_CONTENT,
    SUMMARIZE_CONTENT,
    SITREP_artorias_PROMPT,
    PROCESS_SITREP_IMAGE_PROMPT,
} = require('../../prompts/newsMonitor.prompt');

// Unified News Monitor configuration
const NEWS_MONITOR_CONFIG = {
    enabled: true, // Master toggle for news monitoring
    TARGET_GROUP: process.env.GROUP_LF, // Group to send news updates to

    // Twitter-specific configuration
    TWITTER_ENABLED: true, // Toggle for Twitter source
    TWITTER_CHECK_INTERVAL: 960000, // 16 minutes in milliseconds (API rate limit consideration)
    TWITTER_ACCOUNTS: [
        {
            username: 'BreakingNews',
            lastTweetId: '1874590993955123330',
            mediaOnly: false, // Regular news account - pull all tweets
            skipEvaluation: false, // Evaluate these tweets with ChatGPT
            promptSpecific: false, // Use standard EVALUATE_TWEET prompt
        },
        {
            username: 'BrazilianReport',
            lastTweetId: null, // Will be populated after first fetch
            mediaOnly: false, // Regular news account - pull all tweets
            skipEvaluation: false, // Evaluate these tweets with ChatGPT
            promptSpecific: false, // Use standard EVALUATE_TWEET prompt
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
    RSS_CHECK_INTERVAL: 3600000, // 1 hour in milliseconds (batch processing window)
    TWO_STAGE_EVALUATION: true, // Enable two-stage evaluation to optimize token usage
    FEEDS: [
        {
            id: 'g1',
            name: 'G1',
            url: 'https://g1.globo.com/rss/g1/',
            language: 'pt',
        },
    ],

    // Content filtering configuration
    CONTENT_FILTERING: {
        // List of state codes to filter (excluding São Paulo)
        EXCLUDED_STATES: [
            'ac',
            'al',
            'am',
            'ap',
            'ba',
            'ce',
            'df',
            'es',
            'go',
            'ma',
            'mg',
            'ms',
            'mt',
            'pa',
            'pb',
            'pe',
            'pi',
            'pr',
            'rj',
            'rn',
            'ro',
            'rr',
            'rs',
            'sc',
            'se',
            'to',
        ],
        // Special URLs or URL patterns to always include even if they match state filtering
        INCLUDED_SPECIAL_URLS: [
            'g1.globo.com/sp/sao-paulo', // Include São Paulo news
        ],
        // Path segments to always exclude (like podcast content)
        EXCLUDED_PATHS: [
            'podcast', // Exclude podcast content
        ],
        // Title patterns to filter out (considered low-quality or less relevant)
        TITLE_PATTERNS: ['VÍDEO:', 'VÍDEOS:', 'Assista', 'FOTOS:', 'IMAGENS:'],
    },

    // Sent article cache configuration
    HISTORICAL_CACHE: {
        ENABLED: true, // Toggle for historical cache
        RETENTION_HOURS: 24, // How long to remember sent articles (in hours)
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

    // Prompts for content evaluation and summarization
    PROMPTS: {
        EVALUATE_TWEET,
        EVALUATE_ARTICLE,
        BATCH_EVALUATE_TITLES,
        BATCH_EVALUATE_FULL_CONTENT,
        SUMMARIZE_CONTENT,
        SITREP_artorias_PROMPT,
        PROCESS_SITREP_IMAGE_PROMPT,
    },
};

module.exports = NEWS_MONITOR_CONFIG;
