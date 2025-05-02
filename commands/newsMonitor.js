const config = require('../configs');
const { runCompletion } = require('../utils/openaiUtils');
const axios = require('axios');
const logger = require('../utils/logger');
const Parser = require('rss-parser');
const { isLocalNews } = require('../utils/newsUtils');

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
    lastCheck: null
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
            return {
                usage: usage.project_usage,
                limit: usage.project_cap
            };
        }
        throw new Error('Invalid response format from Twitter API');
    } catch (error) {
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
            currentKey: twitterApiUsageCache.currentKey
        };
    }

    try {
        const { primary, fallback, fallback2 } = config.CREDENTIALS.TWITTER_API_KEYS;
        
        // Get usage for all keys
        const primaryUsage = await getTwitterKeyUsage(primary);
        const fallbackUsage = await getTwitterKeyUsage(fallback);
        const fallback2Usage = await getTwitterKeyUsage(fallback2);
        
        // Determine which key to use (prioritize primary, then fallback, then fallback2)
        let currentKey = 'fallback2';
        if (primaryUsage.usage < 100) {
            currentKey = 'primary';
        } else if (fallbackUsage.usage < 100) {
            currentKey = 'fallback';
        }
        
        // Update cache
        twitterApiUsageCache = {
            primary: primaryUsage,
            fallback: fallbackUsage,
            fallback2: fallback2Usage,
            currentKey,
            lastCheck: now
        };
        
        logger.debug('Twitter API usage response', {
            current_key: currentKey,
            primary_usage: `${primaryUsage.usage}/${primaryUsage.limit}`,
            fallback_usage: `${fallbackUsage.usage}/${fallbackUsage.limit}`,
            fallback2_usage: `${fallback2Usage.usage}/${fallback2Usage.limit}`
        });
        
        // Check if all keys are over limit
        if (primaryUsage.usage >= 100 && fallbackUsage.usage >= 100 && fallback2Usage.usage >= 100) {
            const message = `⚠️ Twitter Monitor Disabled: All API keys are over rate limit.\nPrimary: ${primaryUsage.usage}/${primaryUsage.limit}\nFallback: ${fallbackUsage.usage}/${fallbackUsage.limit}\nFallback2: ${fallback2Usage.usage}/${fallback2Usage.limit}`;
            logger.warn(message);
            
            // Notify admin via WhatsApp
            const adminChat = await global.client.getChatById(config.CREDENTIALS.ADMIN_NUMBER + '@c.us');
            if (adminChat) {
                await adminChat.sendMessage(message);
            }
            
            // Disable Twitter monitor in config
            config.NEWS_MONITOR.TWITTER_ENABLED = false;
            logger.info('Twitter monitor has been disabled due to all API keys being over rate limit');
            return {
                primary: primaryUsage,
                fallback: fallbackUsage,
                fallback2: fallback2Usage,
                currentKey
            };
        }
        
        return {
            primary: primaryUsage,
            fallback: fallbackUsage,
            fallback2: fallback2Usage,
            currentKey
        };
    } catch (error) {
        // If we have cached data, use it even if it's old
        if (twitterApiUsageCache.lastCheck) {
            logger.warn('Failed to check API usage, using cached data');
            return {
                primary: twitterApiUsageCache.primary,
                fallback: twitterApiUsageCache.fallback,
                fallback2: twitterApiUsageCache.fallback2,
                currentKey: twitterApiUsageCache.currentKey
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
 * @param {string} source - Source type ('twitter' or 'rss')
 * @param {boolean} includeJustification - Whether to request and return justification
 * @returns {Promise<object>} - Result with relevance and justification if requested
 */
async function evaluateContent(content, previousContents, source, includeJustification = false) {
    let formattedPreviousContents = [];
    
    if (source === 'twitter') {
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
    const previousContent = source === 'twitter'
        ? formattedPreviousContents.join('\n\n')
        : formattedPreviousContents.join('\n\n---\n\n');

    let prompt = source === 'twitter' 
        ? config.NEWS_MONITOR.PROMPTS.EVALUATE_TWEET
            .replace('{post}', content)
            .replace('{previous_posts}', previousContent)
        : config.NEWS_MONITOR.PROMPTS.EVALUATE_ARTICLE
            .replace('{article}', content)
            .replace('{previous_articles}', previousContent);

    // If justification is requested, modify the prompt to ask for it
    if (includeJustification) {
        prompt = prompt.replace('Retorne apenas a palavra "null"', 
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
async function fetchLatestTweets(userId) {
    try {
        const { key } = getCurrentTwitterApiKey();
        // Fetch last 5 tweets
        const url = `https://api.twitter.com/2/users/${userId}/tweets?tweet.fields=created_at&max_results=5`;
        const response = await axios.get(url, {
            headers: {
                'Authorization': `Bearer ${key.bearer_token}`
            }
        });
        
        if (!response.data.data) return [];
        return response.data.data;
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
                        
                        // Notify admin via WhatsApp
                        const adminChat = await global.client.getChatById(config.CREDENTIALS.ADMIN_NUMBER + '@c.us');
                        if (adminChat) {
                            await adminChat.sendMessage(message);
                        }
                        
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
                            logger.debug(`Twitter monitor check (Primary: ${usage.primary.usage}/${usage.primary.limit}, Fallback: ${usage.fallback.usage}/${usage.fallback.limit}, Fallback2: ${usage.fallback2.usage}/${usage.fallback2.limit}, using ${usage.currentKey} key)`);
                            
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
                                    
                                    // Notify admin via WhatsApp
                                    const adminChat = await global.client.getChatById(config.CREDENTIALS.ADMIN_NUMBER + '@c.us');
                                    if (adminChat) {
                                        await adminChat.sendMessage(message);
                                    }
                                    
                                    // Disable Twitter monitor in config
                                    config.NEWS_MONITOR.TWITTER_ENABLED = false;
                                    logger.info('Twitter monitor has been disabled due to all API keys being over rate limit');
                                    
                                    // Clear the interval
                                    clearInterval(twitterIntervalId);
                                    twitterIntervalId = null;
                                    return;
                                }
                            }
                            
                            for (const account of config.NEWS_MONITOR.TWITTER_ACCOUNTS) {
                                try {
                                    const tweets = await fetchLatestTweets(account.userId);
                                    if (tweets.length === 0) continue;

                                    // Get the latest tweet and previous tweets
                                    const [latestTweet, ...previousTweets] = tweets;
                                    
                                    // Skip if we've already processed this tweet
                                    if (latestTweet.id === account.lastTweetId) continue;

                                    // Evaluate if tweet should be shared
                                    const evalResult = await evaluateContent(
                                        latestTweet.text, 
                                        previousTweets.map(t => t.text), 
                                        'twitter'
                                    );
                                    
                                    if (evalResult.isRelevant) {
                                        const message = `*Breaking News* 🗞️\n\n${latestTweet.text}\n\nSource: @${account.username}`;
                                        await targetGroup.sendMessage(message);
                                        logger.info(`Sent tweet from ${account.username}: ${latestTweet.text.substring(0, 50)}...`);
                                        
                                        // Record that we sent this tweet
                                        recordSentTweet(latestTweet, account.username);
                                    }

                                    // Update last tweet ID in memory
                                    account.lastTweetId = latestTweet.id;
                                } catch (error) {
                                    if (error.response && error.response.status === 429) {
                                        // If we hit a rate limit, try switching keys
                                        logger.warn(`Rate limit hit for account ${account.username}, attempting to switch API keys...`);
                                        
                                        // Force a fresh API usage check
                                        const newUsage = await checkTwitterAPIUsage(true);
                                        
                                        // Try to switch to a key with available usage
                                        if (newUsage.primary.usage < 100) {
                                            twitterApiUsageCache.currentKey = 'primary';
                                            logger.info('Switched to primary Twitter API key');
                                        } else if (newUsage.fallback.usage < 100) {
                                            twitterApiUsageCache.currentKey = 'fallback';
                                            logger.info('Switched to fallback Twitter API key');
                                        } else if (newUsage.fallback2.usage < 100) {
                                            twitterApiUsageCache.currentKey = 'fallback2';
                                            logger.info('Switched to fallback2 Twitter API key');
                                        } else {
                                            // All keys are over limit, disable Twitter monitor
                                            const message = `⚠️ Twitter Monitor Disabled: All API keys are over rate limit.\nPrimary: ${newUsage.primary.usage}/${newUsage.primary.limit}\nFallback: ${newUsage.fallback.usage}/${newUsage.fallback.limit}\nFallback2: ${newUsage.fallback2.usage}/${newUsage.fallback2.limit}`;
                                            logger.warn(message);
                                            
                                            // Notify admin via WhatsApp
                                            const adminChat = await global.client.getChatById(config.CREDENTIALS.ADMIN_NUMBER + '@c.us');
                                            if (adminChat) {
                                                await adminChat.sendMessage(message);
                                            }
                                            
                                            // Disable Twitter monitor in config
                                            config.NEWS_MONITOR.TWITTER_ENABLED = false;
                                            logger.info('Twitter monitor has been disabled due to all API keys being over rate limit');
                                            
                                            // Clear the interval
                                            clearInterval(twitterIntervalId);
                                            twitterIntervalId = null;
                                            return;
                                        }
                                    } else {
                                        logger.error(`Error processing tweets for account ${account.username}:`, error);
                                    }
                                }
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
                                        const message = `*Breaking News* 🗞️\n\n*${articleTitle}*\n\n${summary}\n\nFonte: ${feed.name} | [Read More](${article.link})`;
                                        
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
                    
                    // Notify admin via WhatsApp
                    const adminChat = await global.client.getChatById(config.CREDENTIALS.ADMIN_NUMBER + '@c.us');
                    if (adminChat) {
                        await adminChat.sendMessage(message);
                    }
                        
                        // Disable Twitter monitor in config
                        config.NEWS_MONITOR.TWITTER_ENABLED = false;
                        logger.info('Twitter monitor has been disabled due to all API keys being over rate limit');
                        break; // Exit retry loop if all keys are over limit
                    }

                    logger.info(`Twitter monitor initialized (Primary: ${usage.primary.usage}/${usage.primary.limit}, Fallback: ${usage.fallback.usage}/${usage.fallback.limit}, Fallback2: ${usage.fallback2.usage}/${usage.fallback2.limit}, using ${usage.currentKey} key)`);

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
                            logger.debug(`Twitter monitor check (Primary: ${usage.primary.usage}/${usage.primary.limit}, Fallback: ${usage.fallback.usage}/${usage.fallback.limit}, Fallback2: ${usage.fallback2.usage}/${usage.fallback2.limit}, using ${usage.currentKey} key)`);
                            
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
                                    
                                    // Notify admin via WhatsApp
                                    const adminChat = await global.client.getChatById(config.CREDENTIALS.ADMIN_NUMBER + '@c.us');
                                    if (adminChat) {
                                        await adminChat.sendMessage(message);
                                    }
                                    
                                    // Disable Twitter monitor in config
                                    config.NEWS_MONITOR.TWITTER_ENABLED = false;
                                    logger.info('Twitter monitor has been disabled due to all API keys being over rate limit');
                                    
                                    // Clear the interval
                                    clearInterval(twitterIntervalId);
                                    twitterIntervalId = null;
                                    return;
                                }
                            }
                            
                            for (const account of config.NEWS_MONITOR.TWITTER_ACCOUNTS) {
                                try {
                                    const tweets = await fetchLatestTweets(account.userId);
                                    if (tweets.length === 0) continue;

                                    // Get the latest tweet and previous tweets
                                    const [latestTweet, ...previousTweets] = tweets;
                                    
                                    // Skip if we've already processed this tweet
                                    if (latestTweet.id === account.lastTweetId) continue;

                                    // Evaluate if tweet should be shared
                                    const evalResult = await evaluateContent(
                                        latestTweet.text, 
                                        previousTweets.map(t => t.text), 
                                        'twitter'
                                    );
                                    
                                    if (evalResult.isRelevant) {
                                        const message = `*Breaking News* 🗞️\n\n${latestTweet.text}\n\nSource: @${account.username}`;
                                        await targetGroup.sendMessage(message);
                                        logger.info(`Sent tweet from ${account.username}: ${latestTweet.text.substring(0, 50)}...`);
                                        
                                        // Record that we sent this tweet
                                        recordSentTweet(latestTweet, account.username);
                                    }

                                    // Update last tweet ID in memory
                                    account.lastTweetId = latestTweet.id;
                                } catch (error) {
                                    logger.error(`Error processing tweets for account ${account.username}:`, error);
                                }
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
                                    const message = `*Breaking News* 🗞️\n\n*${articleTitle}*\n\n${summary}\n\nFonte: ${feed.name} | [Read More](${article.link})`;
                                    
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
            }
        }
        
        const usage = await checkTwitterAPIUsage();
        
        if (!config.NEWS_MONITOR.TWITTER_ACCOUNTS || config.NEWS_MONITOR.TWITTER_ACCOUNTS.length === 0) {
            await message.reply('No Twitter accounts configured');
            return;
        }
        
        const account = config.NEWS_MONITOR.TWITTER_ACCOUNTS[0];
        const tweets = await fetchLatestTweets(account.userId);
        
        if (tweets.length === 0) {
            await message.reply('No tweets found');
            return;
        }

        const [latestTweet, ...previousTweets] = tweets;
        
        // For debugging, explicitly log evaluation results
        logger.info('Twitter debug: Starting evaluation');
        // Evaluate tweet relevance
        const evalResult = await evaluateContent(
            latestTweet.text, 
            previousTweets.map(t => t.text), 
            'twitter', 
            true
        );
        logger.info('Twitter debug: Content evaluation result', {
            decision: evalResult.isRelevant ? 'RELEVANT' : 'NOT RELEVANT',
            justification: evalResult.justification || 'No justification provided'
        });
        
        // Format message that would be sent to the group if relevant
        const groupMessage = `*Breaking News* 🗞️\n\n${latestTweet.text}\n\nFonte: @${account.username}`;
        
        const debugInfo = `Twitter Debug Info:
- Account: @${account.username} (ID: ${account.userId})
- API Status:
  - Primary Key Usage: ${usage.primary.usage}/${usage.primary.limit}
  - Fallback Key Usage: ${usage.fallback.usage}/${usage.fallback.limit}
  - Fallback2 Key Usage: ${usage.fallback2.usage}/${usage.fallback2.limit}
  - Currently Using: ${usage.currentKey} key
- Status: ${config.NEWS_MONITOR.TWITTER_ENABLED ? 'Enabled' : 'Disabled'}
- Running: ${twitterIntervalId !== null ? 'Yes' : 'No'}

Latest Tweet:
${latestTweet.text}

Tweet ID: ${latestTweet.id}
Stored ID: ${account.lastTweetId}
Would Process: ${latestTweet.id !== account.lastTweetId ? 'Yes' : 'No (Already Processed)'}
Evaluation Result: ${evalResult.isRelevant ? 'RELEVANT' : 'NOT RELEVANT'}
Justification: ${evalResult.justification || 'No justification provided'}

Message that would be sent (if relevant):
${groupMessage}

Checking interval: ${config.NEWS_MONITOR.TWITTER_CHECK_INTERVAL/60000} minutes`;
        
        await message.reply(debugInfo);
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
            }
        }
        
        stats.lastIntervalCount = articlesFromLastCheckInterval.length;
        
        // Log time filter results
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
        
        stats.localExcludedCount = localArticles.length;
        
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
        
        stats.patternExcludedCount = excludedByTitleArticles.length;
        
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
        
        const statusInfo = `News Monitor Status:
- Master Toggle: ${config.NEWS_MONITOR.enabled ? 'Enabled' : 'Disabled'}
- Target Group: ${config.NEWS_MONITOR.TARGET_GROUP}
- Quiet Hours: ${config.NEWS_MONITOR.QUIET_HOURS?.ENABLED ? 'Enabled' : 'Disabled'}
- Quiet Hours Period: ${config.NEWS_MONITOR.QUIET_HOURS?.START_HOUR}:00 to ${config.NEWS_MONITOR.QUIET_HOURS?.END_HOUR}:00 (${config.NEWS_MONITOR.QUIET_HOURS?.TIMEZONE || 'UTC'})
- Currently in Quiet Hours: ${currentlyInQuietHours ? 'Yes' : 'No'}
- Sent Article Cache: ${sentArticleCache.size} entries

RSS Monitor:
- Status: ${config.NEWS_MONITOR.RSS_ENABLED ? 'Enabled' : 'Disabled'}
- Running: ${rssIntervalId !== null ? 'Yes' : 'No'}
- Check Interval: ${config.NEWS_MONITOR.RSS_CHECK_INTERVAL/60000} minutes (${config.NEWS_MONITOR.RSS_CHECK_INTERVAL/3600000} hours)
- Feed Count: ${config.NEWS_MONITOR.FEEDS?.length || 0}

Twitter Monitor:
- Status: ${config.NEWS_MONITOR.TWITTER_ENABLED ? 'Enabled' : 'Disabled'}
- Running: ${twitterIntervalId !== null ? 'Yes' : 'No'}
- Check Interval: ${config.NEWS_MONITOR.TWITTER_CHECK_INTERVAL/60000} minutes
- Account Count: ${config.NEWS_MONITOR.TWITTER_ACCOUNTS?.length || 0}

Commands:
- !rssdebug on/off - Enable/disable RSS monitoring
- !twitterdebug on/off - Enable/disable Twitter monitoring
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
    fetchLatestTweets,
    isQuietHour,
    formatNewsArticle,
    recordSentTweet,
    recordSentArticle
}; 