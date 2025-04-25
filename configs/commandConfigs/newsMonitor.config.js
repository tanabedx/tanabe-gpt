const { EVALUATE_TWEET, EVALUATE_ARTICLE, BATCH_EVALUATE_TITLES, BATCH_EVALUATE_FULL_CONTENT, SUMMARIZE_CONTENT } = require('../../prompts/newsMonitor');

// Unified News Monitor configuration
const NEWS_MONITOR_CONFIG = {
    enabled: true,  // Master toggle for news monitoring
    TARGET_GROUP: process.env.GROUP_LF,  // Group to send news updates to
    
    // Twitter-specific configuration
    TWITTER_ENABLED: true,   // Toggle for Twitter source
    TWITTER_CHECK_INTERVAL: 960000,  // 16 minutes in milliseconds (API rate limit consideration)
    TWITTER_ACCOUNTS: [
        {
            username: 'BreakingNews',
            userId: '6017542',
            lastTweetId: '1874590993955123330'
        }
    ],
    
    // RSS-specific configuration
    RSS_ENABLED: true,       // Toggle for RSS source
    RSS_CHECK_INTERVAL: 3600000,  // 1 hour in milliseconds (batch processing window)
    TWO_STAGE_EVALUATION: true,  // Enable two-stage evaluation to optimize token usage
    FEEDS: [
        {
            id: 'g1',
            name: 'G1',
            url: 'https://g1.globo.com/rss/g1/',
            language: 'pt'
        }
    ],
    
    // Prompts for content evaluation and summarization
    PROMPTS: {
        EVALUATE_TWEET,
        EVALUATE_ARTICLE,
        BATCH_EVALUATE_TITLES,
        BATCH_EVALUATE_FULL_CONTENT,
        SUMMARIZE_CONTENT
    }
};

module.exports = NEWS_MONITOR_CONFIG; 