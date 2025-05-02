const config = require('../configs');
const { runCompletion } = require('../utils/openaiUtils');
const axios = require('axios');
const logger = require('../utils/logger');
const Parser = require('rss-parser');
const { isLocalNews, formatTwitterApiUsage } = require('../utils/newsUtils');
const { MessageMedia } = require('whatsapp-web.js');

// Initialize RSS parser
const parser = new Parser({
    headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; RSS-Bot/1.0)'
    },
    timeout: 60000, // 60 second timeout
    customFields: {
        item: [
            ['media:content', 'media'],
            ['content:encoded', 'contentEncoded']
        ]
    }
});

// Cache for Twitter API usage data
let twitterApiUsageCache = {
    primary: null,
    fallback: null,
    fallback2: null,
    currentKey: 'primary',
    lastCheck: null,
    // Track rate limit reset times
    resetTimes: {
        primary: null,
        fallback: null,
        fallback2: null
    }
};

// New cache specifically for articles that were sent to the group
let sentArticleCache = new Map();

// New cache for tweets that were sent to the group
let sentTweetCache = new Map();

// References to monitoring intervals for restarts
let twitterIntervalId = null;
let rssIntervalId = null;
let targetGroup = null;

/**
 * Check if quiet hours are in effect
 * @returns {boolean} - true if current time is in quiet hours
 */
function isQuietHour() {
    if (!config.NEWS_MONITOR.QUIET_HOURS?.ENABLED) {
        return false;
    }
    
    // Get current hour in the configured timezone
    const timezone = config.NEWS_MONITOR.QUIET_HOURS?.TIMEZONE || 'UTC';
    const options = { timeZone: timezone, hour: 'numeric', hour12: false };
    const currentHour = parseInt(new Intl.DateTimeFormat('en-US', options).format(new Date()), 10);
    
    // Get configured quiet hours
    const startHour = config.NEWS_MONITOR.QUIET_HOURS?.START_HOUR || 22;
    const endHour = config.NEWS_MONITOR.QUIET_HOURS?.END_HOUR || 8;
    
    // Check if current hour is within quiet hours
    if (startHour <= endHour) {
        // Simple range (e.g., 22 to 8)
        return currentHour >= startHour || currentHour < endHour;
    } else {
        // Overnight range (e.g., 22 to 8)
        return currentHour >= startHour || currentHour < endHour;
    }
}

/**
 * Clean up old entries from the sent article cache based on retention period
 */
function cleanupSentCache() {
    const now = Date.now();
    const retentionMs = (config.NEWS_MONITOR.HISTORICAL_CACHE?.RETENTION_HOURS || 24) * 60 * 60 * 1000;
    
    // Clean article cache
    for (const [key, value] of sentArticleCache.entries()) {
        if (now - value.timestamp > retentionMs) {
            sentArticleCache.delete(key);
        }
    }
    
    // Clean tweet cache
    for (const [key, value] of sentTweetCache.entries()) {
        if (now - value.timestamp > retentionMs) {
            sentTweetCache.delete(key);
        }
    }
}

// Alias for backward compatibility
function cleanupSentArticleCache() {
    cleanupSentCache();
}

/**
 * Record a tweet as sent to the group
 * @param {Object} tweet - The tweet that was sent
 * @param {string} username - The Twitter username
 */
function recordSentTweet(tweet, username) {
    if (!config.NEWS_MONITOR.HISTORICAL_CACHE?.ENABLED) {
        return;
    }
    
    sentTweetCache.set(tweet.id, {
        text: tweet.text,
        timestamp: Date.now(),
        username: username
    });
    
    // Cleanup old entries if needed
    cleanupSentCache();
    logger.debug(`Recorded sent tweet from @${username}`);
}

/**
 * Check if an article has been sent recently
 * @param {Object} article - Article object to check
 * @returns {boolean} - true if a similar article has been sent in the last 24 hours
 */
function isArticleSentRecently(article) {
    if (!config.NEWS_MONITOR.HISTORICAL_CACHE?.ENABLED) {
        return false;
    }
    
    // Clean up old entries first
    cleanupSentArticleCache();
    
    // 1. Check for exact URL match
    const exactMatch = sentArticleCache.has(article.link);
    if (exactMatch) return true;
    
    // 2. Check for title similarity with other sent articles
    const articleTitle = article.title?.toLowerCase() || '';
    if (!articleTitle) return false;
    
    const similarityThreshold = config.NEWS_MONITOR.HISTORICAL_CACHE?.SIMILARITY_THRESHOLD || 0.7;
    
    // Check each sent article for title similarity
    for (const [_, data] of sentArticleCache.entries()) {
        const sentTitle = data.title?.toLowerCase() || '';
        if (!sentTitle) continue;
        
        // Check if titles are related (simple word overlap for now)
        const titleSimilarity = calculateTitleSimilarity(articleTitle, sentTitle);
        if (titleSimilarity >= similarityThreshold) {
            logger.debug(`Article similar to recently sent one: "${article.title}" matches "${data.title}" (similarity: ${titleSimilarity.toFixed(2)})`);
    return true;
        }
    }
    
    return false;
}

/**
 * Calculate similarity between two titles (0-1 scale)
 * @param {string} title1 - First title
 * @param {string} title2 - Second title
 * @returns {number} - Similarity score (0-1)
 */
function calculateTitleSimilarity(title1, title2) {
    // Split titles into words
    const words1 = title1.split(/\s+/).filter(w => w.length > 3);
    const words2 = title2.split(/\s+/).filter(w => w.length > 3);
    
    // Count matching words
    let matchCount = 0;
    for (const word of words1) {
        if (words2.includes(word)) {
            matchCount++;
        }
    }
    
    // Calculate similarity as proportion of matching words
    const totalUniqueWords = new Set([...words1, ...words2]).size;
    return totalUniqueWords > 0 ? matchCount / totalUniqueWords : 0;
}

/**
 * Record an article as sent to the group
 * @param {Object} article - The article that was sent
 */
function recordSentArticle(article) {
    if (!config.NEWS_MONITOR.HISTORICAL_CACHE?.ENABLED) {
        return;
    }
    
    sentArticleCache.set(article.link, {
        title: article.title,
        timestamp: Date.now(),
        feedId: article.feedId || 'unknown'
    });
    
    // Cleanup old entries if needed
    cleanupSentArticleCache();
    logger.debug(`Recorded sent article: "${article.title}"`);
}

/**
 * Check Twitter API usage
 */
async function getTwitterKeyUsage(key) {
    try {
        const url = 'https://api.twitter.com/2/usage/tweets';
        const response = await axios.get(url, {
            headers: {
                'Authorization': `Bearer ${key.bearer_token}`
            },
            params: {
                'usage.fields': 'cap_reset_day,project_usage,project_cap'
            }
        });
        
        if (response.data && response.data.data) {
            const usage = response.data.data;
            
            // Debug log to show raw API response data
            logger.debug('Twitter API usage raw response:', {
                project_usage: usage.project_usage,
                project_cap: usage.project_cap,
                cap_reset_day: usage.cap_reset_day
            });
            
            return {
                usage: usage.project_usage,
                limit: usage.project_cap,
                capResetDay: usage.cap_reset_day, // Add cap_reset_day to the returned object
                status: 'ok'
            };
        }
        throw new Error('Invalid response format from Twitter API');
    } catch (error) {
        if (error.response && error.response.status === 429) {
            // Store rate limit reset time if available
            let resetTime = null;
            if (error.response.headers && error.response.headers['x-rate-limit-reset']) {
                resetTime = parseInt(error.response.headers['x-rate-limit-reset']) * 1000; // Convert to milliseconds
            }
            
            // Return a special indicator for rate limit errors
            return {
                usage: 100,  // Consider it maxed out
                limit: 100,
                capResetDay: null, // Add capResetDay (null for rate-limited keys)
                status: '429',
                resetTime: resetTime
            };
        }
        throw error;
    }
}

async function checkTwitterAPIUsage(forceCheck = false) {
    // If we have cached data and it's less than 15 minutes old, use it
    const now = Date.now();
    if (!forceCheck && twitterApiUsageCache.lastCheck && (now - twitterApiUsageCache.lastCheck) < 15 * 60 * 1000) {
        return {
            primary: twitterApiUsageCache.primary,
            fallback: twitterApiUsageCache.fallback,
            fallback2: twitterApiUsageCache.fallback2,
            currentKey: twitterApiUsageCache.currentKey,
            resetTimes: twitterApiUsageCache.resetTimes
        };
    }

    try {
        const { primary, fallback, fallback2 } = config.CREDENTIALS.TWITTER_API_KEYS;
        const isDebugMode = config.SYSTEM.CONSOLE_LOG_LEVELS.DEBUG === true;
        
        // Initialize with null values
        let primaryUsage = null;
        let fallbackUsage = null;
        let fallback2Usage = null;
        let currentKey = 'primary'; // Default to primary
        
        // Debug mode: Only check what's necessary to find a working key
        if (isDebugMode) {
            logger.debug('Twitter debug: Operating in DEBUG mode - checking keys sequentially');
            
            // Check primary key first
            try {
                primaryUsage = await getTwitterKeyUsage(primary);
                
                // Store reset time if available
                if (primaryUsage.resetTime) {
                    twitterApiUsageCache.resetTimes.primary = primaryUsage.resetTime;
                }
                
                // If primary is not rate limited, use it and don't check others
                if (primaryUsage.status !== '429') {
                    currentKey = 'primary';
                    // Create placeholders for unchecked keys
                    fallbackUsage = { usage: '?', limit: '?', status: 'unchecked' };
                    fallback2Usage = { usage: '?', limit: '?', status: 'unchecked' };
                } else {
                    // Primary is rate limited, try fallback
                    logger.debug('Twitter debug: Primary key is rate limited, trying fallback');
                    try {
                        fallbackUsage = await getTwitterKeyUsage(fallback);
                        
                        // Store reset time if available
                        if (fallbackUsage.resetTime) {
                            twitterApiUsageCache.resetTimes.fallback = fallbackUsage.resetTime;
                        }
                        
                        if (fallbackUsage.status !== '429') {
                            currentKey = 'fallback';
                            // Create placeholder for unchecked fallback2
                            fallback2Usage = { usage: '?', limit: '?', status: 'unchecked' };
                        } else {
                            // Fallback is also rate limited, try fallback2
                            logger.debug('Twitter debug: Fallback key is rate limited, trying fallback2');
                            try {
                                fallback2Usage = await getTwitterKeyUsage(fallback2);
                                
                                // Store reset time if available
                                if (fallback2Usage.resetTime) {
                                    twitterApiUsageCache.resetTimes.fallback2 = fallback2Usage.resetTime;
                                }
                                
                                if (fallback2Usage.status !== '429') {
                                    currentKey = 'fallback2';
                                }
                            } catch (error) {
                                logger.error('Twitter debug: Error checking fallback2 key:', error);
                                fallback2Usage = { usage: '?', limit: '?', status: 'error' };
                            }
                        }
                    } catch (error) {
                        logger.error('Twitter debug: Error checking fallback key:', error);
                        fallbackUsage = { usage: '?', limit: '?', status: 'error' };
                        
                        // Still try fallback2 since fallback failed
                        try {
                            fallback2Usage = await getTwitterKeyUsage(fallback2);
                            
                            // Store reset time if available
                            if (fallback2Usage.resetTime) {
                                twitterApiUsageCache.resetTimes.fallback2 = fallback2Usage.resetTime;
                            }
                            
                            if (fallback2Usage.status !== '429') {
                                currentKey = 'fallback2';
                            }
                        } catch (error) {
                            logger.error('Twitter debug: Error checking fallback2 key:', error);
                            fallback2Usage = { usage: '?', limit: '?', status: 'error' };
                        }
                    }
                }
            } catch (error) {
                logger.error('Twitter debug: Error checking primary key:', error);
                primaryUsage = { usage: '?', limit: '?', status: 'error' };
                
                // Primary failed, try fallback
                try {
                    fallbackUsage = await getTwitterKeyUsage(fallback);
                    
                    // Store reset time if available
                    if (fallbackUsage.resetTime) {
                        twitterApiUsageCache.resetTimes.fallback = fallbackUsage.resetTime;
                    }
                    
                    if (fallbackUsage.status !== '429') {
                        currentKey = 'fallback';
                        // Create placeholder for unchecked fallback2
                        fallback2Usage = { usage: '?', limit: '?', status: 'unchecked' };
                    } else {
                        // Fallback is rate limited, try fallback2
                        try {
                            fallback2Usage = await getTwitterKeyUsage(fallback2);
                            
                            // Store reset time if available
                            if (fallback2Usage.resetTime) {
                                twitterApiUsageCache.resetTimes.fallback2 = fallback2Usage.resetTime;
                            }
                            
                            if (fallback2Usage.status !== '429') {
                                currentKey = 'fallback2';
                            }
                        } catch (error) {
                            logger.error('Twitter debug: Error checking fallback2 key:', error);
                            fallback2Usage = { usage: '?', limit: '?', status: 'error' };
                        }
                    }
                } catch (error) {
                    logger.error('Twitter debug: Error checking fallback key:', error);
                    fallbackUsage = { usage: '?', limit: '?', status: 'error' };
                    
                    // Try fallback2 as last resort
                    try {
                        fallback2Usage = await getTwitterKeyUsage(fallback2);
                        
                        // Store reset time if available
                        if (fallback2Usage.resetTime) {
                            twitterApiUsageCache.resetTimes.fallback2 = fallback2Usage.resetTime;
                        }
                        
                        if (fallback2Usage.status !== '429') {
                            currentKey = 'fallback2';
                        }
                    } catch (error) {
                        logger.error('Twitter debug: Error checking fallback2 key:', error);
                        fallback2Usage = { usage: '?', limit: '?', status: 'error' };
                    }
                }
            }
        } 
        // Normal mode: Check all three keys to get accurate usage info
        else {
            logger.debug('Twitter API: Normal mode - checking all keys for usage info');
            
            // Try to get usage for all three keys
            try {
                primaryUsage = await getTwitterKeyUsage(primary);
            } catch (error) {
                logger.error('Error checking primary Twitter API key:', error);
                primaryUsage = { usage: '?', limit: '?', status: 'error' };
            }
            
            try {
                fallbackUsage = await getTwitterKeyUsage(fallback);
            } catch (error) {
                logger.error('Error checking fallback Twitter API key:', error);
                fallbackUsage = { usage: '?', limit: '?', status: 'error' };
            }
            
            try {
                fallback2Usage = await getTwitterKeyUsage(fallback2);
            } catch (error) {
                logger.error('Error checking fallback2 Twitter API key:', error);
                fallback2Usage = { usage: '?', limit: '?', status: 'error' };
            }
            
            // Determine which key to use based on availability and usage
            if (primaryUsage.status !== '429' && primaryUsage.usage < 100) {
                currentKey = 'primary';
            } else if (fallbackUsage.status !== '429' && fallbackUsage.usage < 100) {
                currentKey = 'fallback';
            } else if (fallback2Usage.status !== '429' && fallback2Usage.usage < 100) {
                currentKey = 'fallback2';
            }
        }
        
        // Ensure we have objects for all keys
        primaryUsage = primaryUsage || { usage: '?', limit: '?', status: 'error' };
        fallbackUsage = fallbackUsage || { usage: '?', limit: '?', status: 'error' };
        fallback2Usage = fallback2Usage || { usage: '?', limit: '?', status: 'error' };
        
        // Update cache with all the information we've gathered
        twitterApiUsageCache = {
            primary: primaryUsage,
            fallback: fallbackUsage,
            fallback2: fallback2Usage,
            currentKey,
            lastCheck: now,
            resetTimes: {
                ...twitterApiUsageCache.resetTimes,
                // Only update reset times that are relevant
                ...(primaryUsage && primaryUsage.resetTime ? { primary: primaryUsage.resetTime } : {}),
                ...(fallbackUsage && fallbackUsage.resetTime ? { fallback: fallbackUsage.resetTime } : {}),
                ...(fallback2Usage && fallback2Usage.resetTime ? { fallback2: fallback2Usage.resetTime } : {})
            }
        };
        
        // Format reset times for logging if available
        const formatResetTime = (keyName) => {
            const resetTime = twitterApiUsageCache.resetTimes[keyName];
            if (resetTime) {
                const resetDate = new Date(resetTime);
                return ` (resets at ${resetDate.toLocaleString()})`;
            }
            return '';
        };
        
        // Format usage statuses for detailed logging
        const primaryStatus = primaryUsage.status === '429' ? 
            `(rate limit${formatResetTime('primary')})` : 
            primaryUsage.status === 'unchecked' ? '(unchecked)' : 
            primaryUsage.status === 'error' ? '(error)' : '';
            
        const fallbackStatus = fallbackUsage.status === '429' ? 
            `(rate limit${formatResetTime('fallback')})` : 
            fallbackUsage.status === 'unchecked' ? '(unchecked)' : 
            fallbackUsage.status === 'error' ? '(error)' : '';
            
        const fallback2Status = fallback2Usage.status === '429' ? 
            `(rate limit${formatResetTime('fallback2')})` : 
            fallback2Usage.status === 'unchecked' ? '(unchecked)' : 
            fallback2Usage.status === 'error' ? '(error)' : '';
        
        // Log detailed object format
        logger.debug('Twitter API usage response', {
            current_key: currentKey,
            primary_usage: `${primaryUsage.usage}/${primaryUsage.limit} ${primaryStatus}`,
            primary_reset_day: primaryUsage.capResetDay,
            fallback_usage: `${fallbackUsage.usage}/${fallbackUsage.limit} ${fallbackStatus}`,
            fallback_reset_day: fallbackUsage.capResetDay,
            fallback2_usage: `${fallback2Usage.usage}/${fallback2Usage.limit} ${fallback2Status}`,
            fallback2_reset_day: fallback2Usage.capResetDay
        });
        
        // Log single-line compact format using utility function
        logger.debug(`Twitter API usage: ${formatTwitterApiUsage(
            { primary: primaryUsage, fallback: fallbackUsage, fallback2: fallback2Usage }, 
            twitterApiUsageCache.resetTimes, 
            currentKey
        )}`);
        
        // Check if all keys are over limit or rate limited
        const allKeysOverLimit = (primaryUsage.status === '429' || primaryUsage.usage >= 100 || primaryUsage.status === 'error') && 
                                (fallbackUsage.status === '429' || fallbackUsage.usage >= 100 || fallbackUsage.status === 'error') && 
                                (fallback2Usage.status === '429' || fallback2Usage.usage >= 100 || fallback2Usage.status === 'error');
        
        if (allKeysOverLimit) {
            // Format message with reset times when available
            const message = `⚠️ Twitter Monitor Disabled: All API keys are over rate limit or returning 429 errors.
${formatTwitterApiUsage(
    { primary: primaryUsage, fallback: fallbackUsage, fallback2: fallback2Usage }, 
    twitterApiUsageCache.resetTimes, 
    currentKey
)}`;
            logger.warn(message);
            
            // Disable Twitter monitor in config
            config.NEWS_MONITOR.TWITTER_ENABLED = false;
            logger.info('Twitter monitor has been disabled due to all API keys being over rate limit or returning 429 errors');
        }
        
        return {
            primary: primaryUsage,
            fallback: fallbackUsage,
            fallback2: fallback2Usage,
            currentKey,
            resetTimes: twitterApiUsageCache.resetTimes
        };
    } catch (error) {
        // If we have cached data, use it even if it's old
        if (twitterApiUsageCache.lastCheck) {
            logger.warn('Failed to check API usage, using cached data', error);
            return {
                primary: twitterApiUsageCache.primary,
                fallback: twitterApiUsageCache.fallback,
                fallback2: twitterApiUsageCache.fallback2,
                currentKey: twitterApiUsageCache.currentKey,
                resetTimes: twitterApiUsageCache.resetTimes
            };
        }
        throw error;
    }
}

function getCurrentTwitterApiKey() {
    const { primary, fallback, fallback2 } = config.CREDENTIALS.TWITTER_API_KEYS;
    const key = twitterApiUsageCache.currentKey === 'primary' ? primary : 
                twitterApiUsageCache.currentKey === 'fallback' ? fallback : 
                fallback2;
    return {
        key,
        name: twitterApiUsageCache.currentKey,
        usage: {
            primary: twitterApiUsageCache.primary,
            fallback: twitterApiUsageCache.fallback,
            fallback2: twitterApiUsageCache.fallback2
        }
    };
}

/**
 * Evaluate content to determine if it's relevant for sharing
 * @param {string} content - Content to evaluate
 * @param {Array<string>} previousContents - Previous contents for context
 * @param {string} source - Source type ('twitter', 'twitter-media', or 'rss')
 * @param {string} username - Username of the content source (for Twitter)
 * @param {boolean} includeJustification - Whether to request and return justification
 * @returns {Promise<object>} - Result with relevance and justification if requested
 */
async function evaluateContent(content, previousContents, source, username = '', includeJustification = false) {
    let formattedPreviousContents = [];
    
    if (source === 'twitter' || source === 'twitter-media') {
        // Start with the provided previous tweets (from the API)
        formattedPreviousContents = [...previousContents];
        
        // If cache is enabled, add previously sent tweets too
        if (config.NEWS_MONITOR.HISTORICAL_CACHE?.ENABLED) {
            // Get up to 5 most recent tweets from sentTweetCache
            const recentTweets = Array.from(sentTweetCache.entries())
                .sort((a, b) => b[1].timestamp - a[1].timestamp)
                .slice(0, 5);
                
            if (recentTweets.length > 0) {
                // Add a marker to separate API tweets from cached tweets
                if (formattedPreviousContents.length > 0) {
                    formattedPreviousContents.push("--- TWEETS PREVIOUSLY SENT TO GROUP ---");
                }
                
                // Add the cached tweets
                for (const [_, data] of recentTweets) {
                    formattedPreviousContents.push(data.text);
                }
                
                logger.debug(`Using ${recentTweets.length} previously sent tweets as additional context`);
            }
        }
        
    } else if (source === 'rss') {
        // For RSS articles, if cache is enabled, use sentArticleCache
        if (config.NEWS_MONITOR.HISTORICAL_CACHE?.ENABLED) {
            // Get up to 5 most recent articles from sentArticleCache
            const recentEntries = Array.from(sentArticleCache.entries())
                .sort((a, b) => b[1].timestamp - a[1].timestamp)
                .slice(0, 5);
                
            if (recentEntries.length > 0) {
                // Format the recent entries for the prompt
                formattedPreviousContents = recentEntries.map(([_, data]) => `Título: ${data.title}`);
                logger.debug(`Using ${recentEntries.length} recently sent articles as context for evaluation`);
            }
        }
    }
    
    // Format the previous content based on the source
    const previousContent = source === 'twitter' || source === 'twitter-media'
        ? formattedPreviousContents.join('\n\n')
        : formattedPreviousContents.join('\n\n---\n\n');

    // Add username information to the content for better context
    const contentWithSource = username 
        ? `Tweet from @${username}:\n${content}` 
        : content;

    let prompt;
    if (source === 'twitter-media') {
        // For backward compatibility, use regular EVALUATE_TWEET for media tweets
        prompt = config.NEWS_MONITOR.PROMPTS.EVALUATE_TWEET
            .replace('{post}', contentWithSource)
            .replace('{previous_posts}', previousContent);
    } else if (source === 'twitter') {
        prompt = config.NEWS_MONITOR.PROMPTS.EVALUATE_TWEET
            .replace('{post}', contentWithSource)
            .replace('{previous_posts}', previousContent);
    } else {
        prompt = config.NEWS_MONITOR.PROMPTS.EVALUATE_ARTICLE
            .replace('{article}', contentWithSource)
            .replace('{previous_articles}', previousContent);
    }

    // If justification is requested, modify the prompt to ask for it
    if (includeJustification) {
        prompt = prompt.replace('Retorne apenas a palavra "null"', 
            'Retorne a palavra "null" seguida por um delimitador "::" e depois uma breve justificativa');
        prompt = prompt.replace('Retorne a palavra "null"', 
            'Retorne a palavra "null" seguida por um delimitador "::" e depois uma breve justificativa');
        prompt = prompt.replace('Retorne a palavra "relevant"', 
            'Retorne a palavra "relevant" seguida por um delimitador "::" e depois uma breve justificativa');
    }

    // Remove duplicate logging - openaiUtils already logs the prompt
    const result = await runCompletion(prompt, 0.3);
    
    // Parse result for relevance and justification
    let relevance, justification;
    if (includeJustification && result.includes('::')) {
        [relevance, justification] = result.split('::').map(s => s.trim());
        relevance = relevance.toLowerCase();
    } else {
        relevance = result.trim().toLowerCase();
        justification = null;
    }
    
    const isRelevant = relevance === 'relevant';
    
    return {
        isRelevant: isRelevant,
        justification: justification
    };
}

/**
 * Generate a bullet point summary 
 */
async function generateSummary(title, content) {
    const prompt = config.NEWS_MONITOR.PROMPTS.SUMMARIZE_CONTENT
        .replace('{title}', title)
        .replace('{content}', content);
    
    // Remove duplicate logging - openaiUtils already logs the prompt
    const summary = await runCompletion(prompt, 0.7);
    
    logger.debug('Generated summary', {
        title: title.substring(0, 80) + (title.length > 80 ? '...' : ''),
        summaryLength: summary.length
    });
    
    return summary;
}

/**
 * Twitter-specific functions
 */
async function fetchTweets(accounts) {
    try {
        const isDebugMode = config.SYSTEM.CONSOLE_LOG_LEVELS.DEBUG === true;
        const { primary, fallback, fallback2 } = config.CREDENTIALS.TWITTER_API_KEYS;
        let { key, name } = getCurrentTwitterApiKey();
        
        // Base URL for fetching user tweets
        let url = `https://api.twitter.com/2/tweets/search/recent?query=`;
        
        // Construct the search query
        const queryParts = accounts.map(account => {
            if (account.mediaOnly) {
                return `(from:${account.username} has:images)`;
            } else {
                return `(from:${account.username})`;
            }
        });
        url += queryParts.join(' OR ');
        
        // Add tweet fields
        url += '&tweet.fields=created_at,attachments';
        
        // Add media fields
        url += '&media.fields=type,url,preview_image_url';
        
        // Add user fields to get usernames
        url += '&user.fields=username';
        
        // Add all expansions in a single parameter
        url += '&expansions=author_id,attachments.media_keys';
        
        // Set the maximum number of tweets to fetch
        url += '&max_results=10';
        
        logger.debug('Twitter debug: Constructed API URL', {
            url: url,
            queryParts: queryParts,
            accounts: accounts.map(a => a.username)
        });
        
        // Log the full URL for debugging purposes
        logger.debug(`Full Twitter API URL: ${url}`);
        
        // Try each key in sequence if in debug mode
        let response;
        let keysToTry = isDebugMode ? [
            { key: primary, name: 'primary' },
            { key: fallback, name: 'fallback' },
            { key: fallback2, name: 'fallback2' }
        ] : [{ key, name }];
        
        let lastError = null;
        
        for (const keyObj of keysToTry) {
            try {
                logger.debug(`Twitter debug: Attempting API call with ${keyObj.name} key`);
                response = await axios.get(url, {
                    headers: {
                        'Authorization': `Bearer ${keyObj.key.bearer_token}`
                    }
                });
                
                logger.debug('Twitter debug: API call successful', {
                    keyUsed: keyObj.name,
                    statusCode: response.status,
                    dataReceived: !!response.data,
                    tweetsReceived: response.data?.data?.length || 0,
                    meta: response.data?.meta || {}
                });
                
                // If successful, log which key we're using
                if (isDebugMode && keyObj.name !== name) {
                    logger.debug(`DEBUG MODE: Switched to ${keyObj.name} key for tweet fetching after 429 error`);
                }
                
                // Successfully got a response, break the loop
                break;
            } catch (error) {
                lastError = error;
                
                logger.debug('Twitter debug: API call error', {
                    keyUsed: keyObj.name,
                    statusCode: error.response?.status,
                    errorMessage: error.message,
                    errorData: error.response?.data || {},
                    errorHeaders: error.response?.headers || {}
                });
                
                // Store rate limit reset time if available
                if (error.response?.headers?.['x-rate-limit-reset']) {
                    const resetTimestamp = parseInt(error.response.headers['x-rate-limit-reset']) * 1000; // Convert to ms
                    twitterApiUsageCache.resetTimes[keyObj.name] = resetTimestamp;
                    
                    // Display rate limit reset time if available and in debug mode
                    if (isDebugMode) {
                        const resetDate = new Date(resetTimestamp);
                        logger.debug(`Twitter API rate limit for ${keyObj.name} key will reset at: ${resetDate.toLocaleString()}`);
                    }
                }
                
                // Only try other keys in debug mode when we get 429 errors
                if (!isDebugMode || error.response?.status !== 429) {
                    throw error;
                }
                
                logger.debug(`DEBUG MODE: Twitter API key ${keyObj.name} returned 429 error, trying next key...`);
            }
        }
        
        // If we tried all keys and still have an error, throw it
        if (!response) {
            if (lastError) {
                throw lastError;
            }
            throw new Error('Failed to fetch tweets with all API keys');
        }
        
        logger.debug('Twitter debug: Response data structure', {
            hasData: !!response.data?.data,
            dataCount: response.data?.data?.length || 0,
            hasIncludes: !!response.data?.includes,
            hasUsers: !!response.data?.includes?.users,
            usersCount: response.data?.includes?.users?.length || 0,
            hasMedia: !!response.data?.includes?.media,
            mediaCount: response.data?.includes?.media?.length || 0
        });
        
        // Show rate limit information in debug mode if available
        if (isDebugMode && response.headers?.['x-rate-limit-reset']) {
            const resetTimestamp = parseInt(response.headers['x-rate-limit-reset']);
            const resetDate = new Date(resetTimestamp * 1000);
            const remaining = response.headers['x-rate-limit-remaining'] || 'unknown';
            const limit = response.headers['x-rate-limit-limit'] || 'unknown';
            logger.debug(`Twitter API rate limits - Remaining: ${remaining}/${limit}, Reset time: ${resetDate.toLocaleString()}`);
        }
        
        // Handle media-only tweets
        if (response.data.data) {
            // Group tweets by username
            const tweetsByUser = {};
            const userMap = new Map();
            
            // Create a map of users by author_id
            if (response.data.includes && response.data.includes.users) {
                response.data.includes.users.forEach(user => {
                    userMap.set(user.id, user);
                    
                    // Initialize the array for this user if it doesn't exist
                    if (!tweetsByUser[user.username]) {
                        tweetsByUser[user.username] = [];
                    }
                });
                
                logger.debug('Twitter debug: Mapped users', {
                    userCount: userMap.size,
                    usernames: Array.from(userMap.values()).map(u => u.username)
                });
            } else {
                logger.debug('Twitter debug: No users found in response includes');
            }
            
            // Create a map of media items by media_key
            const mediaMap = new Map();
            if (response.data.includes && response.data.includes.media) {
                response.data.includes.media.forEach(media => {
                    mediaMap.set(media.media_key, media);
                });
                
                logger.debug('Twitter debug: Mapped media', {
                    mediaCount: mediaMap.size,
                    mediaTypes: Array.from(new Set(Array.from(mediaMap.values()).map(m => m.type)))
                });
            }
            
            // Group tweets by username
            response.data.data.forEach(tweet => {
                logger.debug('Twitter debug: Processing tweet', {
                    id: tweet.id,
                    text: tweet.text?.substring(0, 50) + '...',
                    hasAuthorId: !!tweet.author_id,
                    authorId: tweet.author_id,
                    hasMedia: !!(tweet.attachments?.media_keys?.length > 0),
                    mediaCount: tweet.attachments?.media_keys?.length || 0
                });
                
                if (tweet.author_id) {
                    const user = userMap.get(tweet.author_id);
                    
                    if (!user) {
                        logger.debug('Twitter debug: Could not find user for author_id', {
                            authorId: tweet.author_id,
                            availableUsers: Array.from(userMap.keys())
                        });
                    }
                    
                    if (user && tweetsByUser[user.username]) {
                        const account = accounts.find(acc => acc.username === user.username);
                        
                        if (!account) {
                            logger.debug('Twitter debug: Could not find matching account config', {
                                username: user.username,
                                configuredAccounts: accounts.map(a => a.username)
                            });
                        }
                        
                        // Add media objects to any tweet that has attachments (for all account types)
                        if (tweet.attachments && tweet.attachments.media_keys && tweet.attachments.media_keys.length > 0) {
                            tweet.mediaObjects = tweet.attachments.media_keys
                                .map(key => mediaMap.get(key))
                                .filter(Boolean);
                                
                            logger.debug('Twitter debug: Tweet has media', {
                                tweetId: tweet.id,
                                username: user.username,
                                mediaKeysCount: tweet.attachments.media_keys.length,
                                mediaObjectsFound: tweet.mediaObjects.length,
                                mediaTypes: tweet.mediaObjects.map(m => m.type)
                            });
                                
                            // For media-only accounts, only include tweets with photo media
                            if (account.mediaOnly) {
                                if (tweet.mediaObjects.some(media => media.type === 'photo')) {
                                    tweetsByUser[user.username].push(tweet);
                                    logger.debug('Twitter debug: Added tweet with photo for media-only account', {
                                        username: user.username,
                                        tweetId: tweet.id
                                    });
                                } else {
                                    logger.debug('Twitter debug: Skipped tweet for media-only account (no photos)', {
                                        username: user.username,
                                        tweetId: tweet.id,
                                        mediaTypes: tweet.mediaObjects.map(m => m.type)
                                    });
                                }
                            } else {
                                // For regular accounts, include all tweets regardless of media
                                tweetsByUser[user.username].push(tweet);
                                logger.debug('Twitter debug: Added tweet with media for regular account', {
                                    username: user.username,
                                    tweetId: tweet.id
                                });
                            }
                        } 
                        // For regular accounts with no media, still include the tweets
                        else if (!account.mediaOnly) {
                            tweetsByUser[user.username].push(tweet);
                            logger.debug('Twitter debug: Added tweet without media for regular account', {
                                username: user.username,
                                tweetId: tweet.id
                            });
                        } else {
                            logger.debug('Twitter debug: Skipped tweet for media-only account (no media attachments)', {
                                username: user.username,
                                tweetId: tweet.id
                            });
                        }
                    } else {
                        logger.debug('Twitter debug: Could not match tweet to user', {
                            authorId: tweet.author_id,
                            hasUser: !!user,
                            username: user?.username,
                            hasUserInTweetsByUser: user ? !!tweetsByUser[user.username] : false
                        });
                    }
                } else {
                    logger.debug('Twitter debug: Tweet has no author_id', {
                        tweetId: tweet.id
                    });
                }
            });
            
            logger.debug('Twitter debug: Final tweets by user', {
                userCount: Object.keys(tweetsByUser).length,
                tweetCountByUser: Object.entries(tweetsByUser).map(([username, tweets]) => ({
                    username,
                    tweetCount: tweets.length
                }))
            });
            
            return tweetsByUser;
        }
        
        logger.debug('Twitter debug: No data in response, returning empty object');
        return {};
    } catch (error) {
        logger.error('Error fetching tweets:', error);
        throw error;
    }
}

/**
 * RSS-specific functions
 */
async function fetchRssFeedItems(feed) {
    try {
        // This function just fetches the RSS data with no logging
        // All logging is handled in processRssFeed for sequential consistency
        const feedData = await parser.parseURL(feed.url);
        
        if (!feedData.items || feedData.items.length === 0) {
            return [];
        }
        
        return feedData.items;
    } catch (error) {
        logger.error(`Error fetching RSS feed ${feed.name}:`, error);
        throw error;
    }
}

/**
 * Batch evaluate multiple article titles at once
 * @param {Array} titles - List of article titles to evaluate
 * @returns {Promise<Array>} - Array of booleans indicating relevance for each title
 */
async function batchEvaluateArticleTitles(titles) {
    if (titles.length === 0) return [];
    
    const prompt = config.NEWS_MONITOR.PROMPTS.BATCH_EVALUATE_TITLES
        .replace('{titles}', titles.map((t, i) => `${i+1}. ${t}`).join('\n'));
    
    // Remove duplicate logging - openaiUtils already logs the prompt
    const result = await runCompletion(prompt, 0.3);
    
    // Parse results - expecting a comma-separated list of numbers corresponding to relevant titles
    try {
        // Extract numbers from the response (assumes format like "1, 3, 5" or similar)
        const relevantIndices = result.match(/\d+/g)?.map(num => parseInt(num, 10)) || [];
        
        // Convert to an array of booleans (true for relevant titles)
        return titles.map((_, index) => relevantIndices.includes(index + 1));
    } catch (error) {
        logger.error('Error parsing batch title evaluation result:', error);
        // Default to evaluating all as potentially relevant if parsing fails
        return titles.map(() => true);
    }
}

function extractArticleContent(item) {
    // Try different content fields in order of preference
    return item.contentEncoded || 
           item.content || 
           item['content:encoded'] || 
           item.description || 
           item.summary || 
           item.title || 
           'No content available';
}

/**
 * Translate text to Portuguese
 * @param {string} text - Text to translate
 * @param {string} fromLanguage - Source language (e.g., 'en')
 * @returns {Promise<string>} - Translated text
 */
async function translateToPortuguese(text, fromLanguage) {
    if (fromLanguage === 'pt') {
        return text; // Already in Portuguese
    }
    
    const prompt = `
Translate the following text from ${fromLanguage} to Portuguese:

"${text}"

Provide only the translated text without any additional comments or explanations.`;
    
    // Remove duplicate logging - openaiUtils already logs the prompt
    const translation = await runCompletion(prompt, 0.3);
    
    return translation.trim();
}

/**
 * Restart monitors when settings change
 * Force restart of specific monitors or all if not specified
 * @param {boolean} restartTwitter - Whether to restart Twitter monitor
 * @param {boolean} restartRss - Whether to restart RSS monitor
 */
async function restartMonitors(restartTwitter = true, restartRss = true) {
    try {
        // Clear existing intervals
        if (restartTwitter && twitterIntervalId !== null) {
            clearInterval(twitterIntervalId);
            twitterIntervalId = null;
            logger.info('Twitter monitor interval cleared for restart');
        }
        
        if (restartRss && rssIntervalId !== null) {
            clearInterval(rssIntervalId);
            rssIntervalId = null;
            logger.info('RSS monitor interval cleared for restart');
        }
        
        // Verify target group is still valid
        if (!targetGroup) {
            logger.info('Target group not found, attempting to initialize...');
            const chats = await global.client.getChats();
            targetGroup = chats.find(chat => chat.name === config.NEWS_MONITOR.TARGET_GROUP);
            
            if (!targetGroup) {
                logger.error(`Target group "${config.NEWS_MONITOR.TARGET_GROUP}" not found, skipping monitor restart`);
                return;
            }
            logger.info(`Found target group: ${config.NEWS_MONITOR.TARGET_GROUP}`);
        }
        
        // Initialize Twitter monitor if enabled and restart requested
        if (restartTwitter) {
            if (config.NEWS_MONITOR.TWITTER_ENABLED) {
                try {
                    // Force a fresh API usage check
                    const usage = await checkTwitterAPIUsage(true);
                    
                    // Check if all keys are over limit
                    if (usage.primary.usage >= 100 && usage.fallback.usage >= 100 && usage.fallback2.usage >= 100) {
                        const message = `⚠️ Twitter Monitor Disabled: All API keys are over rate limit.\nPrimary: ${usage.primary.usage}/${usage.primary.limit}\nFallback: ${usage.fallback.usage}/${usage.fallback.limit}\nFallback2: ${usage.fallback2.usage}/${usage.fallback2.limit}`;
                        logger.warn(message);
                        
                        // Disable Twitter monitor in config
                        config.NEWS_MONITOR.TWITTER_ENABLED = false;
                        logger.info('Twitter monitor has been disabled due to all API keys being over rate limit');
                        return; // Exit initialization
                    }
                    
                    // Set up Twitter monitoring interval (slower due to API limits)
                    twitterIntervalId = setInterval(async () => {
                        try {
                            // Check if we're in quiet hours - skip processing if we are
                            if (isQuietHour()) {
                                logger.debug('Twitter monitor check skipped due to quiet hours');
                                return;
                            }
                            
                            // Check API usage before processing (will use cache if check was recent)
                            const usage = await checkTwitterAPIUsage();
                            logger.debug(`Twitter monitor check (${formatTwitterApiUsage(
                                usage,
                                twitterApiUsageCache.resetTimes,
                                usage.currentKey
                            )})`);
                            
                            // Check if current key is over limit and switch if needed
                            if (usage[usage.currentKey].usage >= 100) {
                                logger.warn(`Current Twitter API key (${usage.currentKey}) has reached its limit, attempting to switch keys...`);
                                
                                // Try to switch to a key with available usage
                                if (usage.primary.usage < 100) {
                                    twitterApiUsageCache.currentKey = 'primary';
                                    logger.info('Switched to primary Twitter API key');
                                } else if (usage.fallback.usage < 100) {
                                    twitterApiUsageCache.currentKey = 'fallback';
                                    logger.info('Switched to fallback Twitter API key');
                                } else if (usage.fallback2.usage < 100) {
                                    twitterApiUsageCache.currentKey = 'fallback2';
                                    logger.info('Switched to fallback2 Twitter API key');
                                } else {
                                    // All keys are over limit, disable Twitter monitor
                                    const message = `⚠️ Twitter Monitor Disabled: All API keys are over rate limit.\nPrimary: ${usage.primary.usage}/${usage.primary.limit}\nFallback: ${usage.fallback.usage}/${usage.fallback.limit}\nFallback2: ${usage.fallback2.usage}/${usage.fallback2.limit}`;
                                    logger.warn(message);
                                    
                                    // Disable Twitter monitor in config
                                    config.NEWS_MONITOR.TWITTER_ENABLED = false;
                                    logger.info('Twitter monitor has been disabled due to all API keys being over rate limit');
                                    
                                    // Clear the interval
                                    clearInterval(twitterIntervalId);
                                    twitterIntervalId = null;
                                    return;
                                }
                            }
                            
                            // Process tweets using the search API approach
                            try {
                                // Fetch tweets for all accounts in one call
                                const tweetsByUser = await fetchTweets(config.NEWS_MONITOR.TWITTER_ACCOUNTS);
                                
                                // Process tweets for each account
                            for (const account of config.NEWS_MONITOR.TWITTER_ACCOUNTS) {
                                try {
                                        const tweets = tweetsByUser[account.username] || [];
                                    if (tweets.length === 0) continue;
                                        
                                        // Sort tweets by creation date (newest first)
                                        tweets.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

                                    // Get the latest tweet and previous tweets
                                    const [latestTweet, ...previousTweets] = tweets;
                                    
                                    // Skip if we've already processed this tweet
                                    if (latestTweet.id === account.lastTweetId) continue;

                                        // Special handling for media tweets
                                        if (account.mediaOnly) {
                                            // Process media tweet (with image)
                                            try {
                                                // Check if this account should use an account-specific prompt
                                                if (account.promptSpecific) {
                                                    // Run the account-specific evaluation
                                                    const passed = await evaluateAccountSpecific(latestTweet.text, account.username);
                                                    if (!passed) {
                                                        logger.debug(`Tweet from ${account.username} failed account-specific evaluation, skipping`);
                                                        continue;
                                                    }
                                                    logger.debug(`Tweet from ${account.username} passed account-specific evaluation`);
                                                }
                                                
                                                // Standard evaluation if not skipping
                                                let isRelevant = account.skipEvaluation || false;
                                                
                                                if (!account.skipEvaluation) {
                                                    const evalResult = await evaluateContent(
                                                        latestTweet.text, 
                                                        previousTweets.map(t => t.text), 
                                                        'twitter-media',
                                                        account.username
                                                    );
                                                    isRelevant = evalResult.isRelevant;
                                                }
                                                
                                                if (isRelevant && latestTweet.mediaObjects) {
                                                    // Find the first photo in the media objects
                                                    const photoMedia = latestTweet.mediaObjects.find(media => media.type === 'photo');
                                                    
                                                    if (photoMedia && (photoMedia.url || photoMedia.preview_image_url)) {
                                                        const imageUrl = photoMedia.url || photoMedia.preview_image_url;
                                                        
                                                        // Download the image
                                                        const response = await axios.get(imageUrl, { responseType: 'arraybuffer' });
                                                        const imageBuffer = Buffer.from(response.data);
                                                        
                                                        // Create the media object
                                                        const media = new MessageMedia('image/jpeg', imageBuffer.toString('base64'));
                                                        
                                                        // Format message text
                                                        const caption = `*Breaking News* 🗞️\n\n${latestTweet.text ? `${latestTweet.text}\n\n` : ''}Source: @${account.username}`;
                                                        
                                                        // Send media with caption in a single message
                                                        await targetGroup.sendMessage(media, { caption: caption });
                                                        
                                                        logger.info(`Sent media tweet from ${account.username}: ${latestTweet.text?.substring(0, 50)}...`);
                                        
                                                        // Record that we sent this tweet
                                                        recordSentTweet(latestTweet, account.username);
                                                    }
                                                }
                                } catch (error) {
                                                logger.error(`Error processing media tweet for ${account.username}:`, error);
                                            }
                                        } else {
                                            // Process regular tweet (text-based)
                                            try {
                                                // Check if this account should use an account-specific prompt
                                                if (account.promptSpecific) {
                                                    // Run the account-specific evaluation
                                                    const passed = await evaluateAccountSpecific(latestTweet.text, account.username);
                                                    if (!passed) {
                                                        logger.debug(`Tweet from ${account.username} failed account-specific evaluation, skipping`);
                                                        continue;
                                                    }
                                                    logger.debug(`Tweet from ${account.username} passed account-specific evaluation`);
                                                }
                                                
                                                // Standard evaluation if not skipping
                                                let isRelevant = account.skipEvaluation || false;
                                                
                                                if (!account.skipEvaluation) {
                                                    const evalResult = await evaluateContent(
                                                        latestTweet.text,
                                                        previousTweets.map(t => t.text),
                                                        'twitter',
                                                        account.username
                                                    );
                                                    isRelevant = evalResult.isRelevant;
                                                }
                                                
                                                if (isRelevant) {
                                                    // Create base message
                                                    const message = `*Breaking News* 🗞️\n\n${latestTweet.text}\n\nSource: @${account.username}`;
                                                    
                                                    // Send text message
                                                    await targetGroup.sendMessage(message);
                                                    
                                                    // Check if the tweet has media and attach one media item if available
                                                    if (latestTweet.mediaObjects && latestTweet.mediaObjects.length > 0) {
                                                        // Find the first photo in the media objects
                                                        const photoMedia = latestTweet.mediaObjects.find(media => media.type === 'photo');
                                                        
                                                        if (photoMedia && (photoMedia.url || photoMedia.preview_image_url)) {
                                                            try {
                                                                const imageUrl = photoMedia.url || photoMedia.preview_image_url;
                                                                
                                                                // Download the image
                                                                const response = await axios.get(imageUrl, { responseType: 'arraybuffer' });
                                                                const imageBuffer = Buffer.from(response.data);
                                                                
                                                                // Send just the image (without caption)
                                                                const media = new MessageMedia('image/jpeg', imageBuffer.toString('base64'));
                                                                await targetGroup.sendMessage(media);
                                                                
                                                                logger.info(`Attached media from ${account.username} tweet`);
                                                            } catch (mediaError) {
                                                                logger.error(`Error attaching media for ${account.username}:`, mediaError);
                                                            }
                                                        }
                                                    }
                                                    
                                                    logger.info(`Sent tweet from ${account.username}: ${latestTweet.text.substring(0, 50)}...`);
                                                    
                                                    // Record that we sent this tweet
                                                    recordSentTweet(latestTweet, account.username);
                                                }
                                            } catch (error) {
                                                logger.error(`Error processing tweet for ${account.username}:`, error);
                                            }
                                        }
                                        
                                        // Update last tweet ID in memory
                                        account.lastTweetId = latestTweet.id;
                                    } catch (accountError) {
                                        logger.error(`Error processing account ${account.username}:`, accountError);
                                    }
                                }
                            } catch (error) {
                                logger.error('Error fetching and processing tweets:', error);
                            }
                        } catch (error) {
                            logger.error('Error in Twitter monitor interval:', error);
                        }
                    }, config.NEWS_MONITOR.TWITTER_CHECK_INTERVAL);
                    
                    logger.info(`Twitter monitor restarted (using ${usage.currentKey} key)`);
                } catch (error) {
                    logger.error('Twitter monitor restart failed:', error.message);
                }
            } else {
                logger.info('Twitter monitor disabled in configuration');
            }
        }
        
        // Initialize RSS monitor if enabled and restart requested
        if (restartRss) {
            if (config.NEWS_MONITOR.RSS_ENABLED) {
                if (config.NEWS_MONITOR.FEEDS && config.NEWS_MONITOR.FEEDS.length > 0) {
                    // Set up RSS monitoring interval (hourly batch processing)
                    rssIntervalId = setInterval(async () => {
                        try {
                            // Check if we're in quiet hours - skip processing if we are
                            if (isQuietHour()) {
                                logger.debug('RSS monitor check skipped due to quiet hours');
                                return;
                            }
                            
                            // Verify target group is still valid
                            if (!targetGroup) {
                                logger.error('Target group not found, attempting to reinitialize...');
                                const chats = await global.client.getChats();
                                targetGroup = chats.find(chat => chat.name === config.NEWS_MONITOR.TARGET_GROUP);
                                if (!targetGroup) {
                                    logger.error(`Target group "${config.NEWS_MONITOR.TARGET_GROUP}" not found, skipping RSS processing`);
                                    return;
                                }
                            }

                            for (const feed of config.NEWS_MONITOR.FEEDS) {
                                try {
                                    // Process feed using the sequential processing function
                                    const relevantArticles = await processRssFeed(feed);
                                    
                                    if (relevantArticles.length === 0) {
                                        // No articles to process, continue to next feed
                                        continue;
                                    }
                                    
                                    // Now that we have fully evaluated articles, select up to 2 most relevant
                                    // to send to the group (limiting to avoid sending too many at once)
                                    const articlesToSend = relevantArticles.slice(0, 2);
                                    let articlesSent = 0;
                                        
                                    // Process selected articles
                                    for (const article of articlesToSend) {
                                        try {
                                        // Translate title if needed
                                        let articleTitle = article.title;
                                        if (feed.language !== 'pt') {
                                            articleTitle = await translateToPortuguese(article.title, feed.language);
                                        }
                                        
                                        // Generate summary
                                            const articleContent = extractArticleContent(article);
                                        const summary = await generateSummary(article.title, articleContent);
                                        
                                        // Format message
                                        const message = `*Breaking News* 🗞️\n\n*${articleTitle}*\n\n${summary}\n\nFonte: ${feed.name}\n${article.link}`;
                                        
                                        // Send to group
                                        await targetGroup.sendMessage(message);
                                            
                                            // Record that we sent this article
                                            recordSentArticle(article);
                                        articlesSent++;
                                        
                                        // Log that we sent an article with brief justification
                                        logger.info(`Sent article from ${feed.name}: "${article.title.substring(0, 80)}${article.title.length > 80 ? '...' : ''}" - ${article.relevanceJustification || 'Relevante'}`);
                                        } catch (error) {
                                            logger.error(`Error sending article "${article.title}": ${error.message}`);
                                        }
                                    }
                                    
                                } catch (feedError) {
                                    logger.error(`Error processing feed ${feed.name}:`, feedError);
                                    // Continue with next feed
                                }
                            }
                        } catch (rssError) {
                            logger.error('Error in RSS monitor:', rssError);
                        }
                    }, config.NEWS_MONITOR.RSS_CHECK_INTERVAL);
                    
                    logger.info(`RSS monitor restarted with ${config.NEWS_MONITOR.FEEDS.length} feeds`);
                } else {
                    logger.warn('RSS monitor enabled but no feeds configured');
                }
            } else {
                logger.info('RSS monitor disabled in configuration');
            }
        }
    } catch (error) {
        logger.error('Monitor restart failed:', error.message);
    }
}

/**
 * Initialize the news monitoring system
 */
async function initializeNewsMonitor() {
    try {
        // Clear any existing intervals
        if (twitterIntervalId !== null) {
            clearInterval(twitterIntervalId);
            twitterIntervalId = null;
        }
        
        if (rssIntervalId !== null) {
            clearInterval(rssIntervalId);
            rssIntervalId = null;
        }
        
        // Get target group
        const chats = await global.client.getChats();
        targetGroup = chats.find(chat => chat.name === config.NEWS_MONITOR.TARGET_GROUP);
        
        if (!targetGroup) {
            logger.error(`Target group "${config.NEWS_MONITOR.TARGET_GROUP}" not found, skipping news monitor initialization`);
            return;
        }

        logger.info(`Found target group: ${config.NEWS_MONITOR.TARGET_GROUP}`);

        // Initialize Twitter monitor if enabled
        if (config.NEWS_MONITOR.TWITTER_ENABLED) {
            let attempts = 0;
            const maxAttempts = 3;
            const waitTimes = [0, 6 * 60 * 1000, 10 * 60 * 1000]; // 0, 6 mins, 10 mins

            while (attempts < maxAttempts) {
            try {
                // Initial API usage check
                const usage = await checkTwitterAPIUsage(true);
                
                // Check if all keys are over limit
                if (usage.primary.usage >= 100 && usage.fallback.usage >= 100 && usage.fallback2.usage >= 100) {
                    const message = `⚠️ Twitter Monitor Disabled: All API keys are over rate limit.\nPrimary: ${usage.primary.usage}/${usage.primary.limit}\nFallback: ${usage.fallback.usage}/${usage.fallback.limit}\nFallback2: ${usage.fallback2.usage}/${usage.fallback2.limit}`;
                    logger.warn(message);
                        
                        // Disable Twitter monitor in config
                        config.NEWS_MONITOR.TWITTER_ENABLED = false;
                        logger.info('Twitter monitor has been disabled due to all API keys being over rate limit');
                        break; // Exit retry loop if all keys are over limit
                    }

                    logger.info(`Twitter monitor initialized (${formatTwitterApiUsage(
                        usage, 
                        twitterApiUsageCache.resetTimes, 
                        usage.currentKey
                    )})`);

                    // Set up Twitter monitoring interval (slower due to API limits)
                    twitterIntervalId = setInterval(async () => {
                        try {
                            // Check if we're in quiet hours - skip processing if we are
                            if (isQuietHour()) {
                                logger.debug('Twitter monitor check skipped due to quiet hours');
                                return;
                            }
                            
                            // Check API usage before processing (will use cache if check was recent)
                            const usage = await checkTwitterAPIUsage();
                            logger.debug(`Twitter monitor check (${formatTwitterApiUsage(
                                usage,
                                twitterApiUsageCache.resetTimes,
                                usage.currentKey
                            )})`);
                            
                            // Check if current key is over limit and switch if needed
                            if (usage[usage.currentKey].usage >= 100) {
                                logger.warn(`Current Twitter API key (${usage.currentKey}) has reached its limit, attempting to switch keys...`);
                                
                                // Try to switch to a key with available usage
                                if (usage.primary.usage < 100) {
                                    twitterApiUsageCache.currentKey = 'primary';
                                    logger.info('Switched to primary Twitter API key');
                                } else if (usage.fallback.usage < 100) {
                                    twitterApiUsageCache.currentKey = 'fallback';
                                    logger.info('Switched to fallback Twitter API key');
                                } else if (usage.fallback2.usage < 100) {
                                    twitterApiUsageCache.currentKey = 'fallback2';
                                    logger.info('Switched to fallback2 Twitter API key');
                                } else {
                                    // All keys are over limit, disable Twitter monitor
                                    const message = `⚠️ Twitter Monitor Disabled: All API keys are over rate limit.\nPrimary: ${usage.primary.usage}/${usage.primary.limit}\nFallback: ${usage.fallback.usage}/${usage.fallback.limit}\nFallback2: ${usage.fallback2.usage}/${usage.fallback2.limit}`;
                                    logger.warn(message);
                                    
                                    // Disable Twitter monitor in config
                                    config.NEWS_MONITOR.TWITTER_ENABLED = false;
                                    logger.info('Twitter monitor has been disabled due to all API keys being over rate limit');
                                    
                                    // Clear the interval
                                    clearInterval(twitterIntervalId);
                                    twitterIntervalId = null;
                                    return;
                                }
                            }
                            
                            // Process tweets using the search API approach
                            try {
                                // Fetch tweets for all accounts in one call
                                const tweetsByUser = await fetchTweets(config.NEWS_MONITOR.TWITTER_ACCOUNTS);
                                
                                // Process tweets for each account
                            for (const account of config.NEWS_MONITOR.TWITTER_ACCOUNTS) {
                                try {
                                        const tweets = tweetsByUser[account.username] || [];
                                    if (tweets.length === 0) continue;
                                        
                                        // Sort tweets by creation date (newest first)
                                        tweets.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

                                    // Get the latest tweet and previous tweets
                                    const [latestTweet, ...previousTweets] = tweets;
                                    
                                    // Skip if we've already processed this tweet
                                    if (latestTweet.id === account.lastTweetId) continue;

                                        // Special handling for media tweets
                                        if (account.mediaOnly) {
                                            // Process media tweet (with image)
                                            try {
                                                // Check if this account should use an account-specific prompt
                                                if (account.promptSpecific) {
                                                    // Run the account-specific evaluation
                                                    const passed = await evaluateAccountSpecific(latestTweet.text, account.username);
                                                    if (!passed) {
                                                        logger.debug(`Tweet from ${account.username} failed account-specific evaluation, skipping`);
                                                        continue;
                                                    }
                                                    logger.debug(`Tweet from ${account.username} passed account-specific evaluation`);
                                                }
                                                
                                                // Standard evaluation if not skipping
                                                let isRelevant = account.skipEvaluation || false;
                                                
                                                if (!account.skipEvaluation) {
                                                    const evalResult = await evaluateContent(
                                                        latestTweet.text, 
                                                        previousTweets.map(t => t.text), 
                                                        'twitter-media',
                                                        account.username
                                                    );
                                                    isRelevant = evalResult.isRelevant;
                                                }
                                                
                                                if (isRelevant && latestTweet.mediaObjects) {
                                                    // Find the first photo in the media objects
                                                    const photoMedia = latestTweet.mediaObjects.find(media => media.type === 'photo');
                                                    
                                                    if (photoMedia && (photoMedia.url || photoMedia.preview_image_url)) {
                                                        const imageUrl = photoMedia.url || photoMedia.preview_image_url;
                                                        
                                                        // Download the image
                                                        const response = await axios.get(imageUrl, { responseType: 'arraybuffer' });
                                                        const imageBuffer = Buffer.from(response.data);
                                                        
                                                        // Create the media object
                                                        const media = new MessageMedia('image/jpeg', imageBuffer.toString('base64'));
                                                        
                                                        // Format message text
                                                        const caption = `*Breaking News* 🗞️\n\n${latestTweet.text ? `${latestTweet.text}\n\n` : ''}Source: @${account.username}`;
                                                        
                                                        // Send media with caption in a single message
                                                        await targetGroup.sendMessage(media, { caption: caption });
                                                        
                                                        logger.info(`Sent media tweet from ${account.username}: ${latestTweet.text?.substring(0, 50)}...`);
                                                        
                                                        // Record that we sent this tweet
                                                        recordSentTweet(latestTweet, account.username);
                                                    }
                                                }
                                } catch (error) {
                                                logger.error(`Error processing media tweet for ${account.username}:`, error);
                                            }
                                        } else {
                                            // Process regular tweet (text-based)
                                            try {
                                                // Check if this account should use an account-specific prompt
                                                if (account.promptSpecific) {
                                                    // Run the account-specific evaluation
                                                    const passed = await evaluateAccountSpecific(latestTweet.text, account.username);
                                                    if (!passed) {
                                                        logger.debug(`Tweet from ${account.username} failed account-specific evaluation, skipping`);
                                                        continue;
                                                    }
                                                    logger.debug(`Tweet from ${account.username} passed account-specific evaluation`);
                                                }
                                                
                                                // Standard evaluation if not skipping
                                                let isRelevant = account.skipEvaluation || false;
                                                
                                                if (!account.skipEvaluation) {
                                                    const evalResult = await evaluateContent(
                                                        latestTweet.text,
                                                        previousTweets.map(t => t.text),
                                                        'twitter',
                                                        account.username
                                                    );
                                                    isRelevant = evalResult.isRelevant;
                                                }
                                                
                                                if (isRelevant) {
                                                    // Create base message
                                        const message = `*Breaking News* 🗞️\n\n${latestTweet.text}\n\nSource: @${account.username}`;
                                                    
                                                    // Send text message
                                        await targetGroup.sendMessage(message);
                                                    
                                                    // Check if the tweet has media and attach one media item if available
                                                    if (latestTweet.mediaObjects && latestTweet.mediaObjects.length > 0) {
                                                        // Find the first photo in the media objects
                                                        const photoMedia = latestTweet.mediaObjects.find(media => media.type === 'photo');
                                                        
                                                        if (photoMedia && (photoMedia.url || photoMedia.preview_image_url)) {
                                                            try {
                                                                const imageUrl = photoMedia.url || photoMedia.preview_image_url;
                                                                
                                                                // Download the image
                                                                const response = await axios.get(imageUrl, { responseType: 'arraybuffer' });
                                                                const imageBuffer = Buffer.from(response.data);
                                                                
                                                                // Send just the image (without caption)
                                                                const media = new MessageMedia('image/jpeg', imageBuffer.toString('base64'));
                                                                await targetGroup.sendMessage(media);
                                                                
                                                                logger.info(`Attached media from ${account.username} tweet`);
                                                            } catch (mediaError) {
                                                                logger.error(`Error attaching media for ${account.username}:`, mediaError);
                                                            }
                                                        }
                                                    }
                                                    
                                        logger.info(`Sent tweet from ${account.username}: ${latestTweet.text.substring(0, 50)}...`);
                                        
                                        // Record that we sent this tweet
                                        recordSentTweet(latestTweet, account.username);
                                                }
                                            } catch (error) {
                                                logger.error(`Error processing tweet for ${account.username}:`, error);
                                            }
                                        }
                                        
                                        // Update last tweet ID in memory
                                        account.lastTweetId = latestTweet.id;
                                    } catch (accountError) {
                                        logger.error(`Error processing account ${account.username}:`, accountError);
                                }
                                }
                            } catch (error) {
                                logger.error('Error fetching and processing tweets:', error);
                            }
                        } catch (error) {
                            logger.error('Error in Twitter monitor interval:', error);
                        }
                    }, config.NEWS_MONITOR.TWITTER_CHECK_INTERVAL);
                    
                    // If we get here, initialization was successful
                    break;

            } catch (error) {
                    attempts++;
                    
                    if (error.response && error.response.status === 429) {
                        if (attempts === maxAttempts) {
                            logger.error('Twitter monitor initialization failed after 3 attempts due to rate limiting');
                            break;
                        }
                        
                        const waitTime = waitTimes[attempts];
                        // Only notify admin on the last attempt
                        const isLastAttempt = attempts === maxAttempts - 1;
                        
                        if (isLastAttempt) {
                            // Use error to ensure admin notification
                            logger.warn(`Twitter API rate limit reached (final attempt ${attempts+1}/${maxAttempts}). Waiting ${waitTime/60000} minutes before final retry...`);
                        } else {
                            // Use warn for intermediate attempts
                            logger.warn(`Twitter API rate limit reached (attempt ${attempts+1}/${maxAttempts}). Waiting ${waitTime/60000} minutes before retry...`);
                        }
                        
                        await new Promise(resolve => setTimeout(resolve, waitTime));
                    } else {
                        // If it's not a rate limit error, log and break
                logger.error('Twitter monitor initialization failed:', error.message);
                        break;
                    }
                }
            }
        } else {
            logger.info('Twitter monitor disabled in configuration');
        }
        
        // Initialize RSS monitor if enabled
        if (config.NEWS_MONITOR.RSS_ENABLED) {
            if (config.NEWS_MONITOR.FEEDS && config.NEWS_MONITOR.FEEDS.length > 0) {
                // Set up RSS monitoring interval (hourly batch processing)
                rssIntervalId = setInterval(async () => {
                    try {
                        // Check if we're in quiet hours - skip processing if we are
                        if (isQuietHour()) {
                            logger.debug('RSS monitor check skipped due to quiet hours');
                            return;
                        }
                        
                        // Verify target group is still valid
                        if (!targetGroup) {
                            logger.error('Target group not found, attempting to reinitialize...');
                            const chats = await global.client.getChats();
                            targetGroup = chats.find(chat => chat.name === config.NEWS_MONITOR.TARGET_GROUP);
                            if (!targetGroup) {
                                logger.error(`Target group "${config.NEWS_MONITOR.TARGET_GROUP}" not found, skipping RSS processing`);
                                return;
                            }
                        }

                        for (const feed of config.NEWS_MONITOR.FEEDS) {
                            try {
                                // Process feed using the sequential processing function
                                const relevantArticles = await processRssFeed(feed);
                                
                                if (relevantArticles.length === 0) {
                                    // No articles to process, continue to next feed
                                    continue;
                                }
                                
                                // Now that we have fully evaluated articles, select up to 2 most relevant
                                // to send to the group (limiting to avoid sending too many at once)
                                const articlesToSend = relevantArticles.slice(0, 2);
                                let articlesSent = 0;
                                    
                                // Process selected articles
                                for (const article of articlesToSend) {
                                    try {
                                    // Translate title if needed
                                    let articleTitle = article.title;
                                    if (feed.language !== 'pt') {
                                        articleTitle = await translateToPortuguese(article.title, feed.language);
                                    }
                                    
                                    // Generate summary
                                        const articleContent = extractArticleContent(article);
                                    const summary = await generateSummary(article.title, articleContent);
                                    
                                    // Format message
                                    const message = `*Breaking News* 🗞️\n\n*${articleTitle}*\n\n${summary}\n\nFonte: ${feed.name}\n${article.link}`;
                                    
                                    // Send to group
                                    await targetGroup.sendMessage(message);
                                        
                                        // Record that we sent this article
                                        recordSentArticle(article);
                                    articlesSent++;
                                    
                                    // Log that we sent an article with brief justification
                                    logger.info(`Sent article from ${feed.name}: "${article.title.substring(0, 80)}${article.title.length > 80 ? '...' : ''}"\n- ${article.relevanceJustification || 'Relevante'}`);
                                    } catch (error) {
                                        logger.error(`Error sending article "${article.title}": ${error.message}`);
                                    }
                                }
                                
                            } catch (feedError) {
                                logger.error(`Error processing feed ${feed.name}:`, feedError);
                                // Continue with next feed
                            }
                        }
                    } catch (rssError) {
                        logger.error('Error in RSS monitor:', rssError);
                    }
                }, config.NEWS_MONITOR.RSS_CHECK_INTERVAL);
                
                logger.info(`RSS monitor initialized with ${config.NEWS_MONITOR.FEEDS.length} feeds`);
            } else {
                logger.warn('RSS monitor enabled but no feeds configured');
            }
        } else {
            logger.info('RSS monitor disabled in configuration');
        }

    } catch (error) {
        logger.error('News monitor initialization failed:', error.message);
    }
}

/**
 * Debug function for admin testing Twitter
 */
async function debugTwitterFunctionality(message) {
    try {
        const args = message.body.split(' ').slice(1);
        
        // Check for toggle commands
        if (args.length > 0) {
            const command = args[0].toLowerCase();
            if (command === 'on' || command === 'enable') {
                config.NEWS_MONITOR.TWITTER_ENABLED = true;
                // Restart the Twitter monitor
                await restartMonitors(true, false);
                await message.reply('Twitter monitor has been enabled. Monitor has been restarted.');
                logger.info('Twitter monitor enabled by admin command');
                return;
            } else if (command === 'off' || command === 'disable') {
                config.NEWS_MONITOR.TWITTER_ENABLED = false;
                // Stop the Twitter monitor
                if (twitterIntervalId !== null) {
                    clearInterval(twitterIntervalId);
                    twitterIntervalId = null;
                }
                await message.reply('Twitter monitor has been disabled. Monitor has been stopped.');
                logger.info('Twitter monitor disabled by admin command');
                return;
            } else if (command === 'reset' || command === 'check') {
                // Force a fresh API usage check to get current reset days
                const usage = await checkTwitterAPIUsage(true);
                
                // Format reset days for each key
                const formatResetDay = (keyData, keyName) => {
                    if (!keyData || keyData.status === 'error' || keyData.status === 'unchecked') {
                        return `${keyName}: No data available`;
                    }
                    
                    // Format billing cycle reset day
                    let resetDayInfo = '';
                    if (keyData.capResetDay) {
                        // Get current date to construct full reset date
                        const now = new Date();
                        const currentMonth = now.getMonth();
                        const currentYear = now.getFullYear();
                        
                        // Create date object for the reset day in current month
                        let resetDate = new Date(currentYear, currentMonth, keyData.capResetDay);
                        
                        // If reset day has passed this month, show next month
                        if (now > resetDate) {
                            resetDate = new Date(currentYear, currentMonth + 1, keyData.capResetDay);
                        }
                        
                        resetDayInfo = `Cycle resets on day ${keyData.capResetDay} (${resetDate.toLocaleDateString()})`;
                    } else {
                        resetDayInfo = 'No cycle reset data';
                    }
                    
                    // Format API rate limit info if applicable
                    if (keyData.status === '429' && twitterApiUsageCache.resetTimes[keyName]) {
                        const rateResetDate = new Date(twitterApiUsageCache.resetTimes[keyName]);
                        resetDayInfo += `\nRate limit resets at ${rateResetDate.toLocaleString()}`;
                    }
                    
                    return `${keyName}: ${resetDayInfo}`;
                };
                
                const responseMsg = `Twitter API Key Reset Information:\n\n` +
                    `${formatResetDay(usage.primary, 'Primary')}\n\n` +
                    `${formatResetDay(usage.fallback, 'Fallback')}\n\n` +
                    `${formatResetDay(usage.fallback2, 'Fallback2')}\n\n` +
                    `Current key: ${usage.currentKey}\n` +
                    `Usage: ${formatTwitterApiUsage(usage, twitterApiUsageCache.resetTimes, usage.currentKey)}`;
                
                await message.reply(responseMsg);
                return;
            }
        }
        
        // Check Twitter API credentials
        logger.debug('Twitter debug: Checking Twitter API credentials');
        const { primary, fallback, fallback2 } = config.CREDENTIALS.TWITTER_API_KEYS;
        
        // Log API key details (without exposing full tokens)
        const checkCredential = (credential, name) => {
            if (!credential) {
                logger.debug(`Twitter debug: ${name} key is missing`);
                return false;
            }
            
            if (!credential.bearer_token) {
                logger.debug(`Twitter debug: ${name} key has no bearer_token property`);
                return false;
            }
            
            // Only log first and last few characters of the token
            const tokenLength = credential.bearer_token.length;
            const maskedToken = tokenLength > 10 
                ? `${credential.bearer_token.substring(0, 5)}...${credential.bearer_token.substring(tokenLength - 5)}`
                : '[too short to mask]';
                
            logger.debug(`Twitter debug: ${name} key found with token ${maskedToken} (length: ${tokenLength})`);
            return tokenLength > 20; // Most bearer tokens are significantly longer than 20 chars
        };
        
        const primaryValid = checkCredential(primary, 'Primary');
        const fallbackValid = checkCredential(fallback, 'Fallback');
        const fallback2Valid = checkCredential(fallback2, 'Fallback2');
        
        if (!primaryValid && !fallbackValid && !fallback2Valid) {
            logger.error('Twitter debug: No valid Twitter API credentials found');
            await message.reply('Error: No valid Twitter API credentials found. Check your config.');
            return;
        }
        
        // Get API usage info
        const usage = await checkTwitterAPIUsage();
        logger.debug('Twitter debug: API usage check completed', usage);
        
        if (!config.NEWS_MONITOR.TWITTER_ACCOUNTS || config.NEWS_MONITOR.TWITTER_ACCOUNTS.length === 0) {
            await message.reply('No Twitter accounts configured');
            return;
        }
        
        logger.debug('Twitter debug: Configured accounts', {
            accounts: config.NEWS_MONITOR.TWITTER_ACCOUNTS.map(a => ({
                username: a.username,
                mediaOnly: a.mediaOnly,
                skipEvaluation: a.skipEvaluation,
                lastTweetId: a.lastTweetId
            }))
        });
        
        // Fetch tweets for all accounts in one API call
        logger.debug('Twitter debug: Starting fetchTweets for all accounts');
        const allTweetsByUser = await fetchTweets(config.NEWS_MONITOR.TWITTER_ACCOUNTS);
        logger.debug('Twitter debug: fetchTweets completed', {
            usersWithTweets: Object.keys(allTweetsByUser),
            tweetCounts: Object.entries(allTweetsByUser).map(([username, tweets]) => ({
                username,
                count: tweets?.length || 0
            }))
        });
        
        // Show debug mode status and API info
        const isDebugMode = config.SYSTEM.CONSOLE_LOG_LEVELS.DEBUG === true;
        
        let debugInfo = `Twitter Monitor Debug Summary:
- Debug Mode: ${isDebugMode ? 'Enabled' : 'Disabled'}
- API Status:
  - Primary Key: ${usage.primary.usage}/${usage.primary.limit} ${usage.primary.status === '429' ? '(429 error)' : usage.primary.status === 'unchecked' ? '(unchecked)' : ''}
  - Fallback Key: ${usage.fallback.usage}/${usage.fallback.limit} ${usage.fallback.status === '429' ? '(429 error)' : usage.fallback.status === 'unchecked' ? '(unchecked)' : ''}
  - Fallback2 Key: ${usage.fallback2.usage}/${usage.fallback2.limit} ${usage.fallback2.status === '429' ? '(429 error)' : usage.fallback2.status === 'unchecked' ? '(unchecked)' : ''}
  - Currently Using: ${usage.currentKey} key
- Status: ${config.NEWS_MONITOR.TWITTER_ENABLED ? 'Enabled' : 'Disabled'}
- Running: ${twitterIntervalId !== null ? 'Yes' : 'No'}
- Checking Interval: ${config.NEWS_MONITOR.TWITTER_CHECK_INTERVAL/60000} minutes\n`;
        
        // Information for each account
        let accountInfos = [];
        let imagePromises = [];
        
        for (let i = 0; i < config.NEWS_MONITOR.TWITTER_ACCOUNTS.length; i++) {
            const account = config.NEWS_MONITOR.TWITTER_ACCOUNTS[i];
            const tweets = allTweetsByUser[account.username] || [];
            const tweetCount = tweets.length;
            
            let accountInfo = `\n==== ACCOUNT ${i+1}: @${account.username} ====
- Account Type: ${account.mediaOnly ? 'Media Only' : 'Regular'}
- Skip Evaluation: ${account.skipEvaluation ? 'Yes' : 'No'}
- Account-Specific Prompt: ${account.promptSpecific ? 'Yes' : 'No'}
- Tweets Found: ${tweetCount}
- Last Tweet ID: ${account.lastTweetId || 'Not set'}`;

            if (tweetCount === 0) {
                accountInfo += `\n- Status: No tweets found for this account`;
                accountInfos.push(accountInfo);
                continue;
            }
            
            // Sort tweets by creation date (newest first)
            tweets.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
            
            // Get the latest tweet and previous tweets
            const [latestTweet, ...previousTweets] = tweets;
        
            // Use the appropriate evaluation method based on account type
            const sourceType = account.mediaOnly ? 'twitter-media' : 'twitter';
            
            // Check for account-specific evaluation first
            let accountSpecificResult = null;
            if (account.promptSpecific) {
                // Test the account-specific evaluation
                const passed = await evaluateAccountSpecific(latestTweet.text, account.username);
                accountSpecificResult = {
                    passed: passed,
                    promptName: `${account.username}_PROMPT`
                };
            }
            
            // Skip evaluation if the account is configured to do so
            let evalResult = { isRelevant: account.skipEvaluation, justification: 'Skip evaluation flag is enabled' };
            
            // If not skipping evaluation, actually evaluate the tweet
            if (!account.skipEvaluation) {
                evalResult = await evaluateContent(
                    latestTweet.text, 
                    previousTweets.map(t => t.text), 
                    sourceType, 
                    account.username,
                    true
                );
            }
            
            // Media information
            let mediaInfo = 'No media attached';
            let hasMedia = false;
            let photoMedia = null;
            
            if (latestTweet.mediaObjects && latestTweet.mediaObjects.length > 0) {
                photoMedia = latestTweet.mediaObjects.find(media => media.type === 'photo');
                
                if (photoMedia) {
                    hasMedia = true;
                    mediaInfo = `Has Image: Yes (${photoMedia.type})`;
                    
                    // If result is relevant and we should send this tweet, download the image
                    if (evalResult.isRelevant && latestTweet.id !== account.lastTweetId) {
                        try {
                            const imageUrl = photoMedia.url || photoMedia.preview_image_url;
                            const imagePromise = axios.get(imageUrl, { responseType: 'arraybuffer' })
                                .then(response => {
                                    const imageBuffer = Buffer.from(response.data);
                                    const media = new MessageMedia('image/jpeg', imageBuffer.toString('base64'));
                                    return message.reply(media, null, { 
                                        caption: `(Debug) Image for @${account.username} tweet` 
                                    });
                                })
                                .catch(error => {
                                    logger.error(`Error downloading image for @${account.username}:`, error);
                                });
                            
                            imagePromises.push(imagePromise);
                        } catch (error) {
                            mediaInfo += ` (Error downloading: ${error.message})`;
                        }
                    }
                } else {
                    mediaInfo = `Has Media: Yes (${latestTweet.mediaObjects.map(m => m.type).join(', ')}, but no photos)`;
                }
            }
            
            // Format the message as it would be sent to the group
            let groupMessage;
            if (account.mediaOnly) {
                groupMessage = `*Breaking News* 🗞️`;
                if (latestTweet.text) {
                    groupMessage += `\n\n${latestTweet.text}`;
                }
                groupMessage += `\n\nSource: @${account.username}`;
            } else {
                groupMessage = `*Breaking News* 🗞️\n\n${latestTweet.text}\n\nSource: @${account.username}`;
            }
            
            accountInfo += `
- Latest Tweet: "${latestTweet.text.substring(0, 100)}${latestTweet.text.length > 100 ? '...' : ''}"
- Tweet Creation: ${new Date(latestTweet.created_at).toLocaleString()}
- Tweet ID: ${latestTweet.id}
- Would Process: ${latestTweet.id !== account.lastTweetId ? 'Yes' : 'No (Already Processed)'}
- Media: ${mediaInfo}`;

            // Add account-specific evaluation results if applicable
            if (accountSpecificResult) {
                accountInfo += `
- Account-Specific Evaluation:
  - Prompt: ${accountSpecificResult.promptName}
  - Result: ${accountSpecificResult.passed ? 'PASSED (sim)' : 'FAILED (não)'}
  - Would Continue: ${accountSpecificResult.passed ? 'Yes' : 'No'}`;
            }

            // Add standard evaluation results
            accountInfo += `
- Standard Evaluation Result: ${evalResult.isRelevant ? 'RELEVANT' : 'NOT RELEVANT'}
- Justification: ${evalResult.justification || 'No justification provided'}
- Final Decision: ${(accountSpecificResult ? accountSpecificResult.passed : true) && evalResult.isRelevant && latestTweet.id !== account.lastTweetId ? 'SEND' : 'DO NOT SEND'}

Message that would be sent (if relevant):
${groupMessage}${hasMedia ? '\n[With attached image]' : ''}`;

            accountInfos.push(accountInfo);
        }
        
        // Add each account's info to the debug message
        debugInfo += accountInfos.join('\n');
        
        // Send the complete debug info
        await message.reply(debugInfo);
        
        // Wait for all image promises to complete
        await Promise.all(imagePromises);
        
    } catch (error) {
        logger.error('Error in Twitter debug:', error);
        await message.reply('Error testing Twitter functionality: ' + error.message);
    }
}

/**
 * Debug function for admin testing RSS
 */
async function debugRssFunctionality(message) {
    try {
        const args = message.body.split(' ').slice(1);
        
        // Check for toggle commands
        if (args.length > 0) {
            const command = args[0].toLowerCase();
            if (command === 'on' || command === 'enable') {
                config.NEWS_MONITOR.RSS_ENABLED = true;
                // Restart the RSS monitor
                await restartMonitors(false, true);
                await message.reply('RSS monitor has been enabled. Monitor has been restarted.');
                logger.info('RSS monitor enabled by admin command');
                return;
            } else if (command === 'off' || command === 'disable') {
                config.NEWS_MONITOR.RSS_ENABLED = false;
                // Stop the RSS monitor
                if (rssIntervalId !== null) {
                    clearInterval(rssIntervalId);
                    rssIntervalId = null;
                }
                await message.reply('RSS monitor has been disabled. Monitor has been stopped.');
                logger.info('RSS monitor disabled by admin command');
                return;
            }
        }
        
        if (!config.NEWS_MONITOR.FEEDS || config.NEWS_MONITOR.FEEDS.length === 0) {
            await message.reply('No RSS feeds configured');
            return;
        }

        const feed = config.NEWS_MONITOR.FEEDS[0];
        
        // Stats tracking for each step
        const stats = {
            feedName: feed.name,
            fetchedCount: 0,
            lastIntervalCount: 0,
            localExcludedCount: 0,
            patternExcludedCount: 0,
            historicalExcludedCount: 0,
            duplicatesExcludedCount: 0,
            preliminaryExcludedCount: 0,
            fullContentExcludedCount: 0,
            relevantCount: 0
        };
        
        // Process the feed with stats collection
        logger.debug(`Fetching RSS feed: ${feed.name} (${feed.url})`);
        
        const feedData = await parser.parseURL(feed.url);
        const allArticles = feedData.items || [];
        stats.fetchedCount = allArticles.length;
        
        // Log immediately after fetching
        logger.debug(`Retrieved ${allArticles.length} items from feed: ${feed.name}`);
        
        // Early exit if no articles
        if (allArticles.length === 0) {
            logger.debug(`No items found in feed: ${feed.name}`);
            return [];
        }
        
        // STEP 2: Filter by time - purely synchronous operation
        // Sort by date first (newest first)
        allArticles.sort((a, b) => new Date(b.pubDate || b.isoDate) - new Date(a.pubDate || a.isoDate));
        
        const intervalMs = config.NEWS_MONITOR.RSS_CHECK_INTERVAL;
        const cutoffTime = new Date(Date.now() - intervalMs);
        
        // Create arrays for articles that pass and fail the time filter
        const articlesFromLastCheckInterval = [];
        const olderArticles = [];
        
        // Process each article for time filtering
        for (const article of allArticles) {
            const pubDate = article.pubDate || article.isoDate;
            
            // Default to including if no date
            if (!pubDate) {
                articlesFromLastCheckInterval.push(article);
                continue;
            }
            
            const articleDate = new Date(pubDate);
            
            // Include if date is invalid, in future, or newer than cutoff
            if (isNaN(articleDate) || articleDate > new Date() || articleDate >= cutoffTime) {
                articlesFromLastCheckInterval.push(article);
            } else {
                olderArticles.push(article);
            }
        }
        
        // Log time filter results BEFORE moving to next step
        logger.debug(`Found ${articlesFromLastCheckInterval.length} articles from the last ${intervalMs/60000} minutes`);
        
        // Early exit if no articles from check interval
        if (articlesFromLastCheckInterval.length === 0) {
            logger.debug(`No new articles in the last check interval for feed: ${feed.name}`);
            return [];
        }
        
        // STEP 3: Filter local news
        const nonLocalArticles = [];
        const localArticles = [];
        
        // Check each article
        for (const article of articlesFromLastCheckInterval) {
            if (isLocalNews(article.link)) {
                localArticles.push(article);
            } else {
                nonLocalArticles.push(article);
            }
        }
        
        // Format excluded titles for logging - now showing truncated titles (90 chars)
        const localTitles = localArticles.map(article => 
            `"${article.title?.substring(0, 90) + (article.title?.length > 90 ? '...' : '')}"`
            ).join('\n');
            
        // Log filtered local news results
        if (localArticles.length > 0) {
            // Log the count message with titles
            logger.debug(`Filtered ${localArticles.length} local news articles out of ${articlesFromLastCheckInterval.length} total\n${localTitles}`);
        } else {
            logger.debug(`Filtered ${localArticles.length} local news articles out of ${articlesFromLastCheckInterval.length} total`);
        }
        
        // Early exit if no non-local articles
        if (nonLocalArticles.length === 0) {
            logger.debug(`No non-local articles found in check interval for feed: ${feed.name}`);
            return [];
        }
        
        // STEP 4: Filter articles with low-quality title patterns
        const titlePatterns = config.NEWS_MONITOR.CONTENT_FILTERING.TITLE_PATTERNS || [];
        const filteredByTitleArticles = [];
        const excludedByTitleArticles = [];
        
        // Check each article against title patterns
        for (const article of nonLocalArticles) {
            // Check if the title matches any of the patterns to filter
            const matchesPattern = titlePatterns.some(pattern => 
                article.title && article.title.includes(pattern)
            );
            
            if (matchesPattern) {
                excludedByTitleArticles.push(article);
            } else {
                filteredByTitleArticles.push(article);
            }
        }
        
        // Format excluded titles for logging - now showing truncated titles (90 chars)
        const excludedTitlePatterns = excludedByTitleArticles.map(article => 
            `"${article.title?.substring(0, 90) + (article.title?.length > 90 ? '...' : '')}"`
        ).join('\n');
        
        // Log filtered title pattern results
        if (excludedByTitleArticles.length > 0) {
            // Log the count message with titles
            logger.debug(`Filtered ${excludedByTitleArticles.length} articles with excluded title patterns out of ${nonLocalArticles.length} total\n${excludedTitlePatterns}`);
        } else {
            logger.debug(`Filtered ${excludedByTitleArticles.length} articles with excluded title patterns out of ${nonLocalArticles.length} total`);
        }
        
        // Early exit if no articles passed title filtering
        if (filteredByTitleArticles.length === 0) {
            logger.debug(`No articles passed title pattern filtering`);
            return [];
        }
        
        // STEP 5: Filter out articles similar to ones recently sent
        const notRecentlySentArticles = [];
        const recentlySentArticles = [];
        
        // Add feed ID to each article for caching purposes
        filteredByTitleArticles.forEach(article => {
            article.feedId = feed.id;
        });
        
        // Filter out articles that are similar to ones sent in the last 24h
        for (const article of filteredByTitleArticles) {
            if (isArticleSentRecently(article)) {
                recentlySentArticles.push(article);
            } else {
                notRecentlySentArticles.push(article);
            }
        }
        
        stats.historicalExcludedCount = recentlySentArticles.length;
        
        // Format recently sent article titles for logging - showing truncated titles (90 chars)
        const recentlySentTitles = recentlySentArticles.map(article => 
            `"${article.title?.substring(0, 90) + (article.title?.length > 90 ? '...' : '')}"`
        ).join('\n');
        
        // Log recently sent filter results
        if (recentlySentArticles.length > 0) {
            // Log the count message with titles
            logger.debug(`Filtered ${recentlySentArticles.length} articles similar to recently sent ones\n${recentlySentTitles}`);
        } else {
            logger.debug(`Filtered ${recentlySentArticles.length} articles similar to recently sent ones`);
        }
        
        // Process the remaining articles the same way as in processRssFeed
        // STEP 5.5: Filter similar articles within the current batch
        const sortedByDateArticles = [...notRecentlySentArticles].sort((a, b) => {
            const dateA = new Date(a.pubDate || a.isoDate || 0);
            const dateB = new Date(b.pubDate || b.isoDate || 0);
            return dateA - dateB; // Oldest first
        });
        
        const dedupedArticles = [];
        const duplicateGroups = []; // For tracking which articles were kept vs removed
        const processedTitles = new Map();
        const similarityThreshold = config.NEWS_MONITOR?.HISTORICAL_CACHE?.BATCH_SIMILARITY_THRESHOLD || 0.65;
        
        // Process each article for de-duplication
        for (const article of sortedByDateArticles) {
            const articleTitle = article.title?.toLowerCase() || '';
            if (!articleTitle) {
                // Include articles with no title (should be rare)
                dedupedArticles.push(article);
                continue;
            }
            
            // Check if similar to any already processed article
            let isDuplicate = false;
            let groupIndex = -1;
            
            for (const [processedTitle, info] of processedTitles.entries()) {
                const similarity = calculateTitleSimilarity(articleTitle, processedTitle);
                if (similarity >= similarityThreshold) {
                    isDuplicate = true;
                    groupIndex = info.groupIndex;
                    // Add to existing duplicate group for logging
                    duplicateGroups[groupIndex].duplicates.push({
                        title: article.title,
                        date: article.pubDate || article.isoDate,
                        similarity: similarity
                    });
                    break;
                }
            }
            
            // If not a duplicate, add to deduped list and track the title
            if (!isDuplicate) {
                dedupedArticles.push(article);
                // Create a new group for this article
                groupIndex = duplicateGroups.length;
                duplicateGroups.push({
                    kept: {
                        title: article.title,
                        date: article.pubDate || article.isoDate
                    },
                    duplicates: []
                });
                processedTitles.set(articleTitle, {
                    groupIndex,
                    article
                });
            }
        }
        
        // Count duplicates removed
        const duplicateCount = duplicateGroups.reduce((count, group) => count + group.duplicates.length, 0);
        stats.duplicatesExcludedCount = duplicateCount;
        
        // Log duplicate filtering results
        const groupsWithDuplicates = duplicateGroups.filter(group => group.duplicates.length > 0);
        
        if (groupsWithDuplicates.length > 0) {
            let duplicateLog = `Found and removed ${duplicateCount} duplicate articles in current batch:\n`;
            
            groupsWithDuplicates.forEach((group, index) => {
                const keptDate = new Date(group.kept.date);
                const formattedKeptDate = isNaN(keptDate) ? 'Unknown date' : 
                    keptDate.toISOString().replace('T', ' ').substring(0, 19);
                
                const keptTitle = group.kept.title?.substring(0, 90) + (group.kept.title?.length > 90 ? '...' : '');
                duplicateLog += `KEPT: "${keptTitle}" (${formattedKeptDate})\nDUPLICATES:\n`;
                
                const sortedDuplicates = [...group.duplicates].sort((a, b) => b.similarity - a.similarity);
                
                sortedDuplicates.forEach(dup => {
                    const dupDate = new Date(dup.date);
                    const formattedDupDate = isNaN(dupDate) ? 'Unknown date' : 
                        dupDate.toISOString().replace('T', ' ').substring(0, 19);
                    
                    // Truncate title to 90 chars for logging
                    const dupTitle = dup.title?.substring(0, 90) + (dup.title?.length > 90 ? '...' : '');
                    duplicateLog += `"${dupTitle}" (${formattedDupDate}) - similarity: ${dup.similarity.toFixed(2)}\n`;
                });
                
                // Add double line break between groups, except after the last group
                if (index < groupsWithDuplicates.length - 1) {
                    duplicateLog += `\n\n`;
                }
            });
            
            logger.debug(duplicateLog);
        } else {
            logger.debug(`No duplicate articles found in current batch`);
        }
        
        // STEP 7: Preliminary relevance assessment
        const fullTitles = dedupedArticles.map(article => article.title);
        
        // Perform the batch evaluation 
        const titleRelevanceResults = await batchEvaluateArticleTitles(fullTitles);
        
        // Find articles with relevant titles
        const relevantArticles = [];
        const irrelevantArticles = [];
        
        dedupedArticles.forEach((article, index) => {
            if (titleRelevanceResults[index]) {
                relevantArticles.push(article);
            } else {
                irrelevantArticles.push(article);
            }
        });
        
        stats.preliminaryExcludedCount = irrelevantArticles.length;
        
        // Log results of preliminary relevance assessment - showing truncated titles (90 chars)
        if (irrelevantArticles.length > 0) {
            const irrelevantTitles = irrelevantArticles.map(article => 
                `"${article.title?.substring(0, 90) + (article.title?.length > 90 ? '...' : '')}"`
            ).join('\n');
            logger.debug(`Filtered out ${irrelevantArticles.length} out of ${dedupedArticles.length} irrelevant titles:\n${irrelevantTitles}`);
        }
        
        // Log relevant titles - showing truncated titles (90 chars)
        if (relevantArticles.length > 0) {
            const relevantTitles = relevantArticles.map(article => 
                `"${article.title?.substring(0, 90) + (article.title?.length > 90 ? '...' : '')}"`
            ).join('\n');
        } else {
            logger.debug(`No articles were found to have relevant titles.`);
            return [];
        }
        
        // STEP 8: Evaluate full content of each article individually
        const finalRelevantArticles = [];
        const notRelevantFullContent = [];
        
        // Process each article individually with the EVALUATE_ARTICLE prompt
        for (const article of relevantArticles) {
            const articleContent = extractArticleContent(article);
            
            // We use an empty array for previousArticles since we're evaluating each individually
            const evalResult = await evaluateContent(
                `Título: ${article.title}\n\n${articleContent}`, 
                [], // No previous articles context
                'rss',
                true // Include justification
            );
            
            if (evalResult.isRelevant) {
                // Extract only the key reason from justification (keep it brief)
                let shortJustification = evalResult.justification;
                if (shortJustification && shortJustification.length > 40) {
                    // Try to find common phrases that explain the reason
                    if (shortJustification.includes('notícia global')) {
                        shortJustification = 'Notícia global crítica';
                    } else if (shortJustification.includes('Brasil') || shortJustification.includes('brasileiro')) {
                        shortJustification = 'Relevante para o Brasil';
                    } else if (shortJustification.includes('São Paulo')) {
                        shortJustification = 'Relevante para São Paulo';
                    } else if (shortJustification.includes('científic')) {
                        shortJustification = 'Descoberta científica importante';
                    } else if (shortJustification.includes('esport')) {
                        shortJustification = 'Evento esportivo significativo';
                    } else if (shortJustification.includes('escândalo') || shortJustification.includes('polític')) {
                        shortJustification = 'Escândalo político/econômico';
                    } else if (shortJustification.includes('impacto global')) {
                        shortJustification = 'Grande impacto global';
                    } else {
                        // If none of the above, truncate to first 40 chars
                        shortJustification = shortJustification.substring(0, 40) + '...';
                    }
                }
                
                // Store short justification with the article for later use
                article.relevanceJustification = shortJustification;
                finalRelevantArticles.push(article);
            } else {
                notRelevantFullContent.push({
                    title: article.title
                });
            }
        }
        
        stats.fullContentExcludedCount = notRelevantFullContent.length;
        stats.relevantCount = finalRelevantArticles.length;
        
        // Log results of full content evaluation - showing only titles (90 chars)
        if (notRelevantFullContent.length > 0) {
            let irrelevantLog = `Filtered out ${notRelevantFullContent.length} out of ${relevantArticles.length} after content evaluation:\n`;
            
            notRelevantFullContent.forEach(item => {
                const truncatedTitle = item.title?.substring(0, 90) + (item.title?.length > 90 ? '...' : '');
                irrelevantLog += `"${truncatedTitle}"\n`;
            });
            
            logger.debug(irrelevantLog);
        }
        
        // Log final relevant articles - showing truncated titles (90 chars) with brief justifications
        if (finalRelevantArticles.length > 0) {
            let relevantLog = `Final selection: ${finalRelevantArticles.length} out of ${relevantArticles.length} articles after content evaluation:\n`;
            
            finalRelevantArticles.forEach(article => {
                const truncatedTitle = article.title?.substring(0, 90) + (article.title?.length > 90 ? '...' : '');
                relevantLog += `"${truncatedTitle}"\n${article.relevanceJustification || 'Relevante'}\n\n`;
            });
            
            logger.debug(relevantLog);
        } else {
            logger.debug(`No articles were found to be relevant after full content evaluation.`);
            return [];
        }
        
        // Check the target group
        if (!targetGroup) {
            logger.warn(`The target group "${config.NEWS_MONITOR.TARGET_GROUP}" is not found or not accessible. Messages cannot be sent.`);
        } else {
            logger.debug(`Target group "${config.NEWS_MONITOR.TARGET_GROUP}" is properly configured.`);
        }
        
        // Format an example message for each article
        const formattedExamples = [];
        for (const article of finalRelevantArticles) { // Show all relevant articles
            const formattedMessage = formatNewsArticle(article);
            formattedExamples.push(formattedMessage);
        }
        
        // Prepare and send the formatted debug response
        const currentTime = new Date();
        const isInQuietHour = isQuietHour();
        
        // Format quiet hours
        const startHour = config.NEWS_MONITOR.QUIET_HOURS?.START_HOUR || 22;
        const endHour = config.NEWS_MONITOR.QUIET_HOURS?.END_HOUR || 8;
        const quietHoursPeriod = `${startHour}:00-${endHour}:00`;
        
        // Calculate check interval in minutes
        const checkIntervalMinutes = config.NEWS_MONITOR.RSS_CHECK_INTERVAL / 60000;
        
        // Format the debug response
        const debugResponse = `*RSS Monitor Debug Report*

- RSS monitor enabled: ${config.NEWS_MONITOR.RSS_ENABLED ? 'Yes' : 'No'}
- Check interval: ${checkIntervalMinutes} minutes
- Quiet hours: ${config.NEWS_MONITOR.QUIET_HOURS?.ENABLED ? 'Enabled' : 'Disabled'}
- Quiet hours times: ${quietHoursPeriod}
- Currently in quiet hours: ${isInQuietHour ? 'Yes' : 'No'}
- Daily post limit: 10/10

- RSS feed: ${stats.feedName}
- Fetched: ${stats.fetchedCount}
- Last ${checkIntervalMinutes} minutes: ${stats.lastIntervalCount}
- Local excluded: ${stats.localExcludedCount}/${stats.lastIntervalCount}
- Pattern excluded: ${stats.patternExcludedCount}/${stats.lastIntervalCount - stats.localExcludedCount}
- Historical excluded: ${stats.historicalExcludedCount}/${stats.lastIntervalCount - stats.localExcludedCount - stats.patternExcludedCount}
- Duplicates excluded: ${stats.duplicatesExcludedCount}/${stats.lastIntervalCount - stats.localExcludedCount - stats.patternExcludedCount - stats.historicalExcludedCount}
- Preliminary excluded: ${stats.preliminaryExcludedCount}/${dedupedArticles.length}
- Full content excluded: ${stats.fullContentExcludedCount}/${relevantArticles.length}
- Relevant: ${stats.relevantCount}

${finalRelevantArticles.length > 0 ? formattedExamples.join('\n\n---\n\n') : 'No relevant articles to display'}`;

        await message.reply(debugResponse);
        
    } catch (error) {
        logger.error('Error in RSS debug:', error);
        await message.reply('Error testing RSS functionality: ' + error.message);
    }
}

/**
 * Format a news article for sending to the group
 * @param {Object} article - The news article to format
 * @returns {string} - Formatted message for WhatsApp
 */
function formatNewsArticle(article) {
    const title = article.title || 'No Title';
    const link = article.link || '';
    const justification = article.relevanceJustification || '';
    
    // Format date if available
    let dateStr = '';
    if (article.pubDate || article.isoDate) {
        const pubDate = new Date(article.pubDate || article.isoDate);
        if (!isNaN(pubDate)) {
            dateStr = pubDate.toLocaleDateString('pt-BR', { 
                day: '2-digit', 
                month: '2-digit',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            });
        }
    }
    
    // Build the formatted message with justification always included
    return `📰 *${title}*\n\n${dateStr ? `🕒 ${dateStr}\n\n` : ''}🔍 *Relevância:* ${justification || 'Notícia relevante'}\n\n🔗 ${link}`;
}

/**
 * Status command to check current news monitor status
 */
async function newsMonitorStatus(message) {
    try {
        const currentlyInQuietHours = isQuietHour();
        const isDebugMode = config.SYSTEM.CONSOLE_LOG_LEVELS.DEBUG === true;
        
        // Get Twitter API key usage info
        let twitterApiStatus = "Unknown";
        try {
            const usage = await checkTwitterAPIUsage();
            twitterApiStatus = `Using ${usage.currentKey} key - Primary: ${usage.primary.usage}/${usage.primary.limit}${usage.primary.status === '429' ? ' (429)' : ''}, Fallback: ${usage.fallback.usage}/${usage.fallback.limit}${usage.fallback.status === '429' ? ' (429)' : ''}, Fallback2: ${usage.fallback2.usage}/${usage.fallback2.limit}${usage.fallback2.status === '429' ? ' (429)' : ''}`;
        } catch (error) {
            twitterApiStatus = `Error checking API status: ${error.message}`;
        }
        
        // Prepare detailed Twitter account information
        let twitterAccountsInfo = '';
        if (config.NEWS_MONITOR.TWITTER_ACCOUNTS && config.NEWS_MONITOR.TWITTER_ACCOUNTS.length > 0) {
            config.NEWS_MONITOR.TWITTER_ACCOUNTS.forEach((account, index) => {
                twitterAccountsInfo += `  ${index + 1}. @${account.username} (${account.mediaOnly ? 'Media Only' : 'Regular'}, Eval: ${account.skipEvaluation ? 'Skipped' : 'Required'})\n`;
            });
        } else {
            twitterAccountsInfo = '  No accounts configured\n';
        }
        
        const statusInfo = `News Monitor Status:
- Master Toggle: ${config.NEWS_MONITOR.enabled ? 'Enabled' : 'Disabled'}
- Debug Mode: ${isDebugMode ? 'Enabled' : 'Disabled'}
- Target Group: ${config.NEWS_MONITOR.TARGET_GROUP}
- Quiet Hours: ${config.NEWS_MONITOR.QUIET_HOURS?.ENABLED ? 'Enabled' : 'Disabled'}
- Quiet Hours Period: ${config.NEWS_MONITOR.QUIET_HOURS?.START_HOUR}:00 to ${config.NEWS_MONITOR.QUIET_HOURS?.END_HOUR}:00 (${config.NEWS_MONITOR.QUIET_HOURS?.TIMEZONE || 'UTC'})
- Currently in Quiet Hours: ${currentlyInQuietHours ? 'Yes' : 'No'}
- Sent Article Cache: ${sentArticleCache.size} entries
- Sent Tweet Cache: ${sentTweetCache.size} entries

RSS Monitor:
- Status: ${config.NEWS_MONITOR.RSS_ENABLED ? 'Enabled' : 'Disabled'}
- Running: ${rssIntervalId !== null ? 'Yes' : 'No'}
- Check Interval: ${config.NEWS_MONITOR.RSS_CHECK_INTERVAL/60000} minutes (${config.NEWS_MONITOR.RSS_CHECK_INTERVAL/3600000} hours)
- Feed Count: ${config.NEWS_MONITOR.FEEDS?.length || 0}

Twitter Monitor:
- Status: ${config.NEWS_MONITOR.TWITTER_ENABLED ? 'Enabled' : 'Disabled'}
- Running: ${twitterIntervalId !== null ? 'Yes' : 'No'}
- Check Interval: ${config.NEWS_MONITOR.TWITTER_CHECK_INTERVAL/60000} minutes
- API Status: ${twitterApiStatus}
- Account Count: ${config.NEWS_MONITOR.TWITTER_ACCOUNTS?.length || 0}
- Accounts:
${twitterAccountsInfo}
Commands:
- !rssdebug on/off - Enable/disable RSS monitoring
- !twitterdebug on/off - Enable/disable Twitter monitoring
- !twitterdebug reset - Check all API keys' reset days
- !newsstatus - Show this status information`;

        await message.reply(statusInfo);
    } catch (error) {
        logger.error('Error in news monitor status:', error);
        await message.reply('Error getting news monitor status: ' + error.message);
    }
}

/**
 * Sequentially process an RSS feed for news content
 * @param {Object} feed - The feed configuration object
 * @returns {Promise<Array>} - Array of processed articles ready for evaluation
 */
async function processRssFeed(feed) {
    try {
        // STEP 1: Fetch articles - make sure each operation completes before moving to the next
        logger.debug(`Fetching RSS feed: ${feed.name} (${feed.url})`);
        
        const feedData = await parser.parseURL(feed.url);
        const allArticles = feedData.items || [];
        
        // Log immediately after fetching
        logger.debug(`Retrieved ${allArticles.length} items from feed: ${feed.name}`);
        
        // Early exit if no articles
        if (allArticles.length === 0) {
            logger.debug(`No items found in feed: ${feed.name}`);
            return [];
        }
        
        // STEP 2: Filter by time - purely synchronous operation
        // Sort by date first (newest first)
        allArticles.sort((a, b) => new Date(b.pubDate || b.isoDate) - new Date(a.pubDate || a.isoDate));
        
        const intervalMs = config.NEWS_MONITOR.RSS_CHECK_INTERVAL;
        const cutoffTime = new Date(Date.now() - intervalMs);
        
        // Create arrays for articles that pass and fail the time filter
        const articlesFromLastCheckInterval = [];
        const olderArticles = [];
        
        // Process each article for time filtering
        for (const article of allArticles) {
            const pubDate = article.pubDate || article.isoDate;
            
            // Default to including if no date
            if (!pubDate) {
                articlesFromLastCheckInterval.push(article);
                continue;
            }
            
            const articleDate = new Date(pubDate);
            
            // Include if date is invalid, in future, or newer than cutoff
            if (isNaN(articleDate) || articleDate > new Date() || articleDate >= cutoffTime) {
                articlesFromLastCheckInterval.push(article);
            } else {
                olderArticles.push(article);
            }
        }
        
        // Log time filter results BEFORE moving to next step
        logger.debug(`Found ${articlesFromLastCheckInterval.length} articles from the last ${intervalMs/60000} minutes`);
        
        // Early exit if no articles from check interval
        if (articlesFromLastCheckInterval.length === 0) {
            logger.debug(`No new articles in the last check interval for feed: ${feed.name}`);
            return [];
        }
        
        // STEP 3: Filter local news
        const nonLocalArticles = [];
        const localArticles = [];
        
        // Check each article
        for (const article of articlesFromLastCheckInterval) {
            if (isLocalNews(article.link)) {
                localArticles.push(article);
            } else {
                nonLocalArticles.push(article);
            }
        }
        
        // Format excluded titles for logging - now showing truncated titles (90 chars)
        const localTitles = localArticles.map(article => 
            `"${article.title?.substring(0, 90) + (article.title?.length > 90 ? '...' : '')}"`
            ).join('\n');
            
        // Log filtered local news results
        if (localArticles.length > 0) {
            // Log the count message with titles
            logger.debug(`Filtered ${localArticles.length} local news articles out of ${articlesFromLastCheckInterval.length} total\n${localTitles}`);
        } else {
            logger.debug(`Filtered ${localArticles.length} local news articles out of ${articlesFromLastCheckInterval.length} total`);
        }
        
        // Early exit if no non-local articles
        if (nonLocalArticles.length === 0) {
            logger.debug(`No non-local articles found in check interval for feed: ${feed.name}`);
            return [];
        }
        
        // STEP 4: Filter articles with low-quality title patterns
        const titlePatterns = config.NEWS_MONITOR.CONTENT_FILTERING.TITLE_PATTERNS || [];
        const filteredByTitleArticles = [];
        const excludedByTitleArticles = [];
        
        // Check each article against title patterns
        for (const article of nonLocalArticles) {
            // Check if the title matches any of the patterns to filter
            const matchesPattern = titlePatterns.some(pattern => 
                article.title && article.title.includes(pattern)
            );
            
            if (matchesPattern) {
                excludedByTitleArticles.push(article);
            } else {
                filteredByTitleArticles.push(article);
            }
        }
        
        // Format excluded titles for logging - now showing truncated titles (90 chars)
        const excludedTitlePatterns = excludedByTitleArticles.map(article => 
            `"${article.title?.substring(0, 90) + (article.title?.length > 90 ? '...' : '')}"`
        ).join('\n');
        
        // Log filtered title pattern results
        if (excludedByTitleArticles.length > 0) {
            // Log the count message with titles
            logger.debug(`Filtered ${excludedByTitleArticles.length} articles with excluded title patterns out of ${nonLocalArticles.length} total\n${excludedTitlePatterns}`);
        } else {
            logger.debug(`Filtered ${excludedByTitleArticles.length} articles with excluded title patterns out of ${nonLocalArticles.length} total`);
        }
        
        // Early exit if no articles passed title filtering
        if (filteredByTitleArticles.length === 0) {
            logger.debug(`No articles passed title pattern filtering`);
            return [];
        }
        
        // STEP 5: Filter out articles similar to ones recently sent
        const notRecentlySentArticles = [];
        const recentlySentArticles = [];
        
        // Add feed ID to each article for caching purposes
        filteredByTitleArticles.forEach(article => {
            article.feedId = feed.id;
        });
        
        // Filter out articles that are similar to ones sent in the last 24h
        for (const article of filteredByTitleArticles) {
            if (isArticleSentRecently(article)) {
                recentlySentArticles.push(article);
            } else {
                notRecentlySentArticles.push(article);
            }
        }
        
        // Format recently sent article titles for logging - showing truncated titles (90 chars)
        const recentlySentTitles = recentlySentArticles.map(article => 
            `"${article.title?.substring(0, 90) + (article.title?.length > 90 ? '...' : '')}"`
        ).join('\n');
        
        // Log filtered recently sent results
        if (recentlySentArticles.length > 0) {
            // Log the count message with titles
            logger.debug(`Filtered ${recentlySentArticles.length} articles similar to recently sent ones\n${recentlySentTitles}`);
        } else {
            logger.debug(`Filtered ${recentlySentArticles.length} articles similar to recently sent ones`);
        }
        
        // Early exit if all articles filtered as recently sent
        if (notRecentlySentArticles.length === 0) {
            logger.debug(`No articles remain after filtering out recently sent ones`);
            return [];
        }
        
        // NEW STEP: Filter similar articles within current batch (de-duplication)
        // Sort by date (oldest first) to keep the oldest when similar articles are found
        const sortedByDateArticles = [...notRecentlySentArticles].sort((a, b) => 
            new Date(a.pubDate || a.isoDate) - new Date(b.pubDate || b.isoDate)
        );
        
        const dedupedArticles = [];
        const duplicateGroups = []; // Store groups of similar articles for logging
        const processedTitles = new Map(); // Map to track processed titles
        
        // Use the batch similarity threshold if configured, otherwise fall back to regular threshold
        const similarityThreshold = config.NEWS_MONITOR.HISTORICAL_CACHE?.BATCH_SIMILARITY_THRESHOLD || 
                                   config.NEWS_MONITOR.HISTORICAL_CACHE?.SIMILARITY_THRESHOLD || 
                                   0.7;
        
        // Process each article for de-duplication
        for (const article of sortedByDateArticles) {
            const articleTitle = article.title?.toLowerCase() || '';
            if (!articleTitle) {
                // Include articles with no title (should be rare)
                dedupedArticles.push(article);
                continue;
            }
            
            // Check if similar to any already processed article
            let isDuplicate = false;
            let groupIndex = -1;
            
            for (const [processedTitle, info] of processedTitles.entries()) {
                const similarity = calculateTitleSimilarity(articleTitle, processedTitle);
                if (similarity >= similarityThreshold) {
                    isDuplicate = true;
                    groupIndex = info.groupIndex;
                    // Add to existing duplicate group for logging
                    duplicateGroups[groupIndex].duplicates.push({
                title: article.title,
                        date: article.pubDate || article.isoDate,
                        similarity: similarity
                    });
                    break;
                }
            }
            
            // If not a duplicate, add to deduped list and track the title
            if (!isDuplicate) {
                dedupedArticles.push(article);
                // Create a new group for this article
                groupIndex = duplicateGroups.length;
                duplicateGroups.push({
                    kept: {
                        title: article.title,
                        date: article.pubDate || article.isoDate
                    },
                    duplicates: []
                });
                processedTitles.set(articleTitle, {
                    groupIndex,
                    article
                });
            }
        }
        
        // Log duplicate filtering results - enhanced with groups
        const duplicateCount = duplicateGroups.reduce((count, group) => count + group.duplicates.length, 0);
        
        if (duplicateCount > 0) {
            // Create a detailed log of duplicate groups
            let duplicateLog = `Filtered out ${duplicateCount} of ${sortedByDateArticles.length} duplicate articles:\n`;
            
            // Only show groups that have duplicates
            const groupsWithDuplicates = duplicateGroups.filter(group => group.duplicates.length > 0);
            
            groupsWithDuplicates.forEach((group, index) => {
                // Format date for better readability
                const keptDate = new Date(group.kept.date);
                const formattedKeptDate = isNaN(keptDate) ? 'Unknown date' : 
                    keptDate.toISOString().replace('T', ' ').substring(0, 19);
                
                // Truncate title to 90 chars for logging
                const keptTitle = group.kept.title?.substring(0, 90) + (group.kept.title?.length > 90 ? '...' : '');
                duplicateLog += `KEPT: "${keptTitle}" (${formattedKeptDate})\n`;
        
                // Sort duplicates by similarity (highest first)
                const sortedDuplicates = [...group.duplicates].sort((a, b) => b.similarity - a.similarity);
                
                sortedDuplicates.forEach(dup => {
                    const dupDate = new Date(dup.date);
                    const formattedDupDate = isNaN(dupDate) ? 'Unknown date' : 
                        dupDate.toISOString().replace('T', ' ').substring(0, 19);
                    
                    // Truncate title to 90 chars for logging
                    const dupTitle = dup.title?.substring(0, 90) + (dup.title?.length > 90 ? '...' : '');
                    duplicateLog += `"${dupTitle}" (${formattedDupDate}) - similarity: ${dup.similarity.toFixed(2)}\n`;
                });
                
                // Add double line break between groups, except after the last group
                if (index < groupsWithDuplicates.length - 1) {
                    duplicateLog += `\n\n`;
                }
            });
            
            logger.debug(duplicateLog);
        } else {
            logger.debug(`No duplicate articles found in current batch`);
        }
        
        // Early exit if all articles filtered as duplicates
        if (dedupedArticles.length === 0) {
            logger.debug(`No articles remain after filtering out duplicates`);
            return [];
        }
        
        // STEP 7: Preliminary relevance assessment using batch title evaluation
        
        // Extract full titles for batch evaluation
        const fullTitles = dedupedArticles.map(article => article.title);
        
        // Perform the batch evaluation 
        const titleRelevanceResults = await batchEvaluateArticleTitles(fullTitles);
        
        // Find articles with relevant titles
        const relevantArticles = [];
        const irrelevantArticles = [];
        
        dedupedArticles.forEach((article, index) => {
            if (titleRelevanceResults[index]) {
                relevantArticles.push(article);
            } else {
                irrelevantArticles.push(article);
            }
        });
            
        // Log results of preliminary relevance assessment - showing truncated titles (90 chars)
        if (irrelevantArticles.length > 0) {
            const irrelevantTitles = irrelevantArticles.map(article => 
                `"${article.title?.substring(0, 90) + (article.title?.length > 90 ? '...' : '')}"`
            ).join('\n');
            logger.debug(`Filtered out ${irrelevantArticles.length} out of ${dedupedArticles.length} irrelevant titles:\n${irrelevantTitles}`);
        }
        
        // STEP 8: Evaluate full content of each article individually
        const finalRelevantArticles = [];
        const notRelevantFullContent = [];
        
        // Process each article individually with the EVALUATE_ARTICLE prompt
        for (const article of relevantArticles) {
            const articleContent = extractArticleContent(article);
            
            // We use an empty array for previousArticles since we're evaluating each individually
            const evalResult = await evaluateContent(
                `Título: ${article.title}\n\n${articleContent}`, 
                [], // No previous articles context
                'rss',
                true // Include justification
            );
            
            if (evalResult.isRelevant) {
                // Extract only the key reason from justification (keep it brief)
                let shortJustification = evalResult.justification;
                if (shortJustification && shortJustification.length > 40) {
                    // Try to find common phrases that explain the reason
                    if (shortJustification.includes('notícia global')) {
                        shortJustification = 'Notícia global crítica';
                    } else if (shortJustification.includes('Brasil') || shortJustification.includes('brasileiro')) {
                        shortJustification = 'Relevante para o Brasil';
                    } else if (shortJustification.includes('São Paulo')) {
                        shortJustification = 'Relevante para São Paulo';
                    } else if (shortJustification.includes('científic')) {
                        shortJustification = 'Descoberta científica importante';
                    } else if (shortJustification.includes('esport')) {
                        shortJustification = 'Evento esportivo significativo';
                    } else if (shortJustification.includes('escândalo') || shortJustification.includes('polític')) {
                        shortJustification = 'Escândalo político/econômico';
                    } else if (shortJustification.includes('impacto global')) {
                        shortJustification = 'Grande impacto global';
        } else {
                        // If none of the above, truncate to first 40 chars
                        shortJustification = shortJustification.substring(0, 40) + '...';
                    }
                }
                
                // Store short justification with the article for later use
                article.relevanceJustification = shortJustification;
                finalRelevantArticles.push(article);
            } else {
                notRelevantFullContent.push({
                    title: article.title
                });
            }
        }
        
        // Log results of full content evaluation - showing only titles (90 chars)
        if (notRelevantFullContent.length > 0) {
            let irrelevantLog = `Filtered out ${notRelevantFullContent.length} out of ${relevantArticles.length} after content evaluation:\n`;
            
            notRelevantFullContent.forEach(item => {
                const truncatedTitle = item.title?.substring(0, 90) + (item.title?.length > 90 ? '...' : '');
                irrelevantLog += `"${truncatedTitle}"\n`;
            });
            
            logger.debug(irrelevantLog);
        }
        
        // Log final relevant articles - showing truncated titles (90 chars) with brief justifications
        if (finalRelevantArticles.length > 0) {
            let relevantLog = `Final selection: ${finalRelevantArticles.length} out of ${relevantArticles.length} articles after content evaluation:\n`;
            
            finalRelevantArticles.forEach(article => {
                const truncatedTitle = article.title?.substring(0, 90) + (article.title?.length > 90 ? '...' : '');
                relevantLog += `"${truncatedTitle}"\n${article.relevanceJustification || 'Relevante'}\n\n`;
            });
            
            logger.debug(relevantLog);
        } else {
            logger.debug(`No articles were found to be relevant after full content evaluation.`);
            return [];
        }
        
        return finalRelevantArticles;
    } catch (error) {
        logger.error(`Error processing RSS feed ${feed.name}:`, error);
        return [];
    }
}

/**
 * Evaluate a tweet using an account-specific prompt
 * @param {string} content - The tweet content
 * @param {string} username - The Twitter username
 * @returns {Promise<boolean>} - Whether the tweet passed the account-specific evaluation
 */
async function evaluateAccountSpecific(content, username) {
    try {
        // Check if the account has a specific prompt defined
        const promptName = `${username}_PROMPT`;
        const prompt = config.NEWS_MONITOR.PROMPTS[promptName];
        
        if (!prompt) {
            logger.debug(`No account-specific prompt found for @${username}, skipping account-specific evaluation`);
            return true; // Default to passing if no prompt is defined
        }
        
        // Use the account-specific prompt and replace placeholders
        const formattedPrompt = prompt.replace('{post}', content);
        
        // Run the completion with the account-specific prompt
        const result = await runCompletion(formattedPrompt, 0.3);
        
        // Parse the result (expecting 'sim' or 'não')
        const lowerResult = result.trim().toLowerCase();
        const passed = lowerResult === 'sim';
        
        logger.debug(`Account-specific evaluation for @${username}: ${passed ? 'Passed' : 'Failed'} (response: "${result}")`);
        
        return passed;
    } catch (error) {
        logger.error(`Error in account-specific evaluation for @${username}:`, error);
        return true; // Default to passing in case of error to avoid blocking potentially relevant content
    }
}

module.exports = {
    initializeNewsMonitor,
    debugTwitterFunctionality,
    debugRssFunctionality,
    newsMonitorStatus,
    getCurrentTwitterApiKey,
    restartMonitors,
    // Export for testing
    evaluateContent,
    generateSummary,
    fetchRssFeedItems,
    isQuietHour,
    formatNewsArticle,
    recordSentTweet,
    recordSentArticle,
    evaluateAccountSpecific
}; 