const config = require('../configs');
const { runCompletion, extractTextFromImageWithOpenAI } = require('../utils/openaiUtils');
const axios = require('axios');
const logger = require('../utils/logger');
const Parser = require('rss-parser');
const {
    shouldExcludeByWhitelist,
    formatTwitterApiUsage,
    checkTwitterAPIUsage,
    getCurrentTwitterApiKey,
    updateLastFetchedTweetsCache,
    getLastFetchedTweetsCache,
    twitterApiUsageCache,
} = require('../utils/newsUtils');
const { MessageMedia } = require('whatsapp-web.js');
const {
    isArticleSentRecently,
    recordSentTweet,
    recordSentArticle,
    getCacheStats, // Get stats for persistent cache
    getRecentItems,
} = require('../utils/persistentCache');

// Initialize RSS parser
const parser = new Parser({
    headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; RSS-Bot/1.0)',
    },
    timeout: 60000, // 60 second timeout
    customFields: {
        item: [
            ['media:content', 'media'],
            ['content:encoded', 'contentEncoded'],
        ],
    },
});

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
 * Evaluate content for relevance
 */
async function evaluateContent(content, source, username = '', includeJustification = false) {
    // Apply character limit for evaluation to save tokens
    const charLimit = config.NEWS_MONITOR.CONTENT_LIMITS?.EVALUATION_CHAR_LIMIT || 0;
    const limitedContent =
        charLimit > 0 && content.length > charLimit
            ? content.substring(0, charLimit) + '... [content truncated for evaluation]'
            : content;

    // Add username information to the content for better context
    const contentWithSource = username
        ? `Tweet from @${username}:\n${limitedContent}`
        : limitedContent;

    // Determine content type and source information for unified prompt
    let contentType, sourceInfo;

    if (source === 'twitter' || source === 'twitter-media') {
        contentType = 'Tweet';
        sourceInfo = username ? `Fonte: Twitter (@${username})` : 'Fonte: Twitter';
    } else {
        contentType = 'Artigo';
        sourceInfo = 'Fonte: RSS';
    }

    // Use the unified prompt
    const prompt = config.NEWS_MONITOR.PROMPTS.EVALUATE_CONTENT.replace(
        '{content}',
        contentWithSource
    )
        .replace('{content_type}', contentType)
        .replace('{source_info}', sourceInfo);

    // Get the OpenAI response with the EVALUATE_CONTENT prompt type
    const result = await runCompletion(prompt, 0.3, null, 'EVALUATE_CONTENT');

    // Parse result for relevance and justification
    let relevance = 'null',
        justification = '';

    // The new format has the format "relevant::justification" or "null::reason"
    if (result.includes('::')) {
        [relevance, justification] = result.split('::').map(s => s.trim());
        relevance = relevance.toLowerCase();
    } else {
        // Fallback for backward compatibility
        relevance = result.trim().toLowerCase();
        justification = '';
    }

    const isRelevant = relevance === 'relevant';

    // Return only what's needed based on includeJustification parameter
    return includeJustification ? { isRelevant, justification } : { isRelevant };
}

/**
 * Generate a bullet point summary
 */
async function generateSummary(title, content) {
    // For summarization, we don't apply character limits by default (use full content)
    // But still respect the config if it's defined
    const charLimit = config.NEWS_MONITOR.CONTENT_LIMITS?.SUMMARY_CHAR_LIMIT || 0;
    const limitedContent =
        charLimit > 0 && content.length > charLimit
            ? content.substring(0, charLimit) + '... [content truncated for summary]'
            : content;

    const prompt = config.NEWS_MONITOR.PROMPTS.SUMMARIZE_CONTENT.replace('{title}', title).replace(
        '{content}',
        limitedContent
    );

    // Remove duplicate logging - openaiUtils already logs the prompt
    const summary = await runCompletion(prompt, 0.7, null, 'SUMMARIZE_CONTENT');

    logger.debug('Generated summary', {
        title: title.substring(0, 80) + (title.length > 80 ? '...' : ''),
        summaryLength: summary.length,
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

        // Construct the search query with exclusions for retweets and replies
        const queryParts = accounts.map(account => {
            if (account.mediaOnly) {
                return `(from:${account.username} has:images -is:reply -is:retweet)`;
            } else {
                return `(from:${account.username} -is:reply -is:retweet)`;
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
            accounts: accounts.map(a => a.username),
        });

        // Log the full URL for debugging purposes
        logger.debug(`Full Twitter API URL: ${url}`);

        // Try each key in sequence if in debug mode
        let response;
        let keysToTry = isDebugMode
            ? [
                  { key: primary, name: 'primary' },
                  { key: fallback, name: 'fallback' },
                  { key: fallback2, name: 'fallback2' },
              ]
            : [{ key, name }];

        let lastError = null;

        for (const keyObj of keysToTry) {
            try {
                logger.debug(`Twitter debug: Attempting API call with ${keyObj.name} key`);
                response = await axios.get(url, {
                    headers: {
                        Authorization: `Bearer ${keyObj.key.bearer_token}`,
                    },
                });

                logger.debug('Twitter debug: API call successful', {
                    keyUsed: keyObj.name,
                    statusCode: response.status,
                    dataReceived: !!response.data,
                    tweetsReceived: response.data?.data?.length || 0,
                    meta: response.data?.meta || {},
                });

                // If successful, log which key we're using
                if (isDebugMode && keyObj.name !== name) {
                    logger.debug(
                        `DEBUG MODE: Switched to ${keyObj.name} key for tweet fetching after 429 error`
                    );
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
                    errorHeaders: error.response?.headers || {},
                });

                // Only try other keys in debug mode when we get 429 errors
                if (!isDebugMode || error.response?.status !== 429) {
                    throw error;
                }

                logger.debug(
                    `DEBUG MODE: Twitter API key ${keyObj.name} returned 429 error, trying next key...`
                );
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
            mediaCount: response.data?.includes?.media?.length || 0,
        });

        // Show rate limit information in debug mode if available
        if (isDebugMode && response.headers?.['x-rate-limit-reset']) {
            const resetTimestamp = parseInt(response.headers['x-rate-limit-reset']);
            const resetDate = new Date(resetTimestamp * 1000);
            const remaining = response.headers['x-rate-limit-remaining'] || 'unknown';
            const limit = response.headers['x-rate-limit-limit'] || 'unknown';
            logger.debug(
                `Twitter API rate limits - Remaining: ${remaining}/${limit}, Reset time: ${resetDate.toLocaleString()}`
            );
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
                    usernames: Array.from(userMap.values()).map(u => u.username),
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
                    mediaTypes: Array.from(new Set(Array.from(mediaMap.values()).map(m => m.type))),
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
                    mediaCount: tweet.attachments?.media_keys?.length || 0,
                });

                if (tweet.author_id) {
                    const user = userMap.get(tweet.author_id);

                    if (!user) {
                        logger.debug('Twitter debug: Could not find user for author_id', {
                            authorId: tweet.author_id,
                            availableUsers: Array.from(userMap.keys()),
                        });
                    }

                    if (user && tweetsByUser[user.username]) {
                        const account = accounts.find(acc => acc.username === user.username);

                        if (!account) {
                            logger.debug('Twitter debug: Could not find matching account config', {
                                username: user.username,
                                configuredAccounts: accounts.map(a => a.username),
                            });
                        }

                        // Add media objects to any tweet that has attachments (for all account types)
                        if (
                            tweet.attachments &&
                            tweet.attachments.media_keys &&
                            tweet.attachments.media_keys.length > 0
                        ) {
                            tweet.mediaObjects = tweet.attachments.media_keys
                                .map(key => mediaMap.get(key))
                                .filter(Boolean);

                            logger.debug('Twitter debug: Tweet has media', {
                                tweetId: tweet.id,
                                username: user.username,
                                mediaKeysCount: tweet.attachments.media_keys.length,
                                mediaObjectsFound: tweet.mediaObjects.length,
                                mediaTypes: tweet.mediaObjects.map(m => m.type),
                            });

                            // For media-only accounts, only include tweets with photo media
                            if (account.mediaOnly) {
                                if (tweet.mediaObjects.some(media => media.type === 'photo')) {
                                    tweetsByUser[user.username].push(tweet);
                                    logger.debug(
                                        'Twitter debug: Added tweet with photo for media-only account',
                                        {
                                            username: user.username,
                                            tweetId: tweet.id,
                                        }
                                    );
                                } else {
                                    logger.debug(
                                        'Twitter debug: Skipped tweet for media-only account (no photos)',
                                        {
                                            username: user.username,
                                            tweetId: tweet.id,
                                            mediaTypes: tweet.mediaObjects.map(m => m.type),
                                        }
                                    );
                                }
                            } else {
                                // For regular accounts, include all tweets regardless of media
                                tweetsByUser[user.username].push(tweet);
                                logger.debug(
                                    'Twitter debug: Added tweet with media for regular account',
                                    {
                                        username: user.username,
                                        tweetId: tweet.id,
                                    }
                                );
                            }
                        }
                        // For regular accounts with no media, still include the tweets
                        else if (!account.mediaOnly) {
                            tweetsByUser[user.username].push(tweet);
                            logger.debug(
                                'Twitter debug: Added tweet without media for regular account',
                                {
                                    username: user.username,
                                    tweetId: tweet.id,
                                }
                            );
                        } else {
                            logger.debug(
                                'Twitter debug: Skipped tweet for media-only account (no media attachments)',
                                {
                                    username: user.username,
                                    tweetId: tweet.id,
                                }
                            );
                        }
                    } else {
                        logger.debug('Twitter debug: Could not match tweet to user', {
                            authorId: tweet.author_id,
                            hasUser: !!user,
                            username: user?.username,
                            hasUserInTweetsByUser: user ? !!tweetsByUser[user.username] : false,
                        });
                    }
                } else {
                    logger.debug('Twitter debug: Tweet has no author_id', {
                        tweetId: tweet.id,
                    });
                }
            });

            logger.debug('Twitter debug: Final tweets by user', {
                userCount: Object.keys(tweetsByUser).length,
                tweetCountByUser: Object.entries(tweetsByUser).map(([username, tweets]) => ({
                    username,
                    tweetCount: tweets.length,
                })),
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

    const prompt = config.NEWS_MONITOR.PROMPTS.BATCH_EVALUATE_TITLES.replace(
        '{titles}',
        titles.map((t, i) => `${i + 1}. ${t}`).join('\n')
    );

    // Remove duplicate logging - openaiUtils already logs the prompt
    const result = await runCompletion(prompt, 0.3, null, 'BATCH_EVALUATE_TITLES');

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
    return (
        item.contentEncoded ||
        item.content ||
        item['content:encoded'] ||
        item.description ||
        item.summary ||
        item.title ||
        'No content available'
    );
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
    // Using TRANSLATION promptType to ensure proper model selection from NEWS_MONITOR.AI_MODELS
    const translation = await runCompletion(prompt, 0.3, null, 'TRANSLATION');

    return translation.trim();
}

/**
 * Detect if an article is a duplicate using the DETECT_DUPLICATE prompt
 * @param {Object} article - The article to check
 * @param {Array} previousArticles - Array of previously processed articles to compare against
 * @param {String} source - Source of the content ('rss' or 'twitter')
 * @returns {Promise<Object>} - Object with isDuplicate flag and other metadata
 */
async function detectDuplicateWithPrompt(article, previousArticles, source = 'rss') {
    if (!article || !previousArticles || previousArticles.length === 0) {
        return { isDuplicate: false };
    }

    try {
        let newItemContent = '';
        let previousItemsContent = '';

        // For tweets, use the full content; for RSS, just use the title
        if (source === 'twitter') {
            // Format current tweet with full content
            newItemContent = `Título: ${article.title || article.text || 'No title'}\n${
                article.description || article.content || article.text || 'No content'
            }`;

            // Format previous tweets with full content
            previousItemsContent = previousArticles
                .map((prevArticle, index) => {
                    return `[${index + 1}] Título: ${
                        prevArticle.title || prevArticle.text || 'No title'
                    }\n${
                        prevArticle.description ||
                        prevArticle.content ||
                        prevArticle.text ||
                        'No content'
                    }`;
                })
                .join('\n\n---\n\n');
        } else {
            // For RSS articles, use only the title
            newItemContent = `Título: ${article.title || 'No title'}`;

            // Format previous articles - using only titles
            previousItemsContent = previousArticles
                .map((prevArticle, index) => {
                    return `[${index + 1}] Título: ${prevArticle.title || 'No title'}`;
                })
                .join('\n');
        }

        // Get the DETECT_DUPLICATE prompt from config
        const prompt = config.NEWS_MONITOR.PROMPTS.DETECT_DUPLICATE.replace(
            '{new_item}',
            newItemContent
        ).replace('{previous_items}', previousItemsContent);

        // Call OpenAI with the DETECT_DUPLICATE prompt type
        // Note: Allow logging to happen via openaiUtils
        const result = await runCompletion(prompt, 0.3, null, 'DETECT_DUPLICATE');

        // Parse the result
        let isDuplicate = false;
        let duplicateId = null;
        let justification = null;

        // Expected format: "duplicate::[ID]::[Justification]" or "unique::Not duplicated"
        if (result.toLowerCase().startsWith('duplicate::')) {
            isDuplicate = true;
            const parts = result.split('::');
            if (parts.length >= 3) {
                duplicateId = parts[1];
                justification = parts.slice(2).join('::');
            }
        }

        logger.debug(
            `Duplicate detection for ${source === 'twitter' ? 'tweet' : 'article'} "${
                article.title?.substring(0, 50) || article.text?.substring(0, 50)
            }...": ${isDuplicate ? 'DUPLICATE' : 'UNIQUE'}${
                duplicateId ? ` (similar to item ${duplicateId})` : ''
            }`
        );

        return {
            isDuplicate,
            duplicateId,
            justification,
            rawResult: result,
        };
    } catch (error) {
        logger.error(`Error in duplicate detection: ${error.message}`);
        // Default to not a duplicate in case of error
        return { isDuplicate: false, error: error.message };
    }
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
                logger.error(
                    `Target group "${config.NEWS_MONITOR.TARGET_GROUP}" not found, skipping monitor restart`
                );
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
                    if (
                        usage.primary.usage >= 100 &&
                        usage.fallback.usage >= 100 &&
                        usage.fallback2.usage >= 100
                    ) {
                        const message = `Twitter Monitor Disabled: All API keys are have reached 100% usage limit. ${formatTwitterApiUsage(
                            { primary: usage, fallback: usage, fallback2: usage },
                            twitterApiUsageCache.resetTimes,
                            usage.currentKey
                        )}`;
                        logger.warn(message);

                        // Disable Twitter monitor in config
                        config.NEWS_MONITOR.TWITTER_ENABLED = false;
                        logger.info(
                            'Twitter monitor has been disabled due to all API keys reaching usage limit'
                        );
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
                            logger.debug(
                                `Twitter monitor check (${formatTwitterApiUsage(
                                    usage,
                                    twitterApiUsageCache.resetTimes,
                                    usage.currentKey
                                )})`
                            );

                            // Check if current key is over limit and switch if needed
                            if (usage[usage.currentKey].usage >= 100) {
                                logger.warn(
                                    `Current Twitter API key (${usage.currentKey}) has reached its limit, attempting to switch keys...`
                                );

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
                                    const message = `Twitter Monitor Disabled: All API keys are have reached 100% usage limit. ${formatTwitterApiUsage(
                                        { primary: usage, fallback: usage, fallback2: usage },
                                        twitterApiUsageCache.resetTimes,
                                        usage.currentKey
                                    )}`;
                                    logger.warn(message);

                                    // Disable Twitter monitor in config
                                    config.NEWS_MONITOR.TWITTER_ENABLED = false;
                                    logger.info(
                                        'Twitter monitor has been disabled due to all API keys reaching usage limit'
                                    );

                                    // Clear the interval
                                    clearInterval(twitterIntervalId);
                                    twitterIntervalId = null;
                                    return;
                                }
                            }

                            // Process tweets using the search API approach
                            try {
                                // Fetch tweets for all accounts in one call
                                const tweetsByUser = await fetchTweets(
                                    config.NEWS_MONITOR.TWITTER_ACCOUNTS
                                );

                                // Store fetched tweets in the cache for debug purposes
                                updateLastFetchedTweetsCache(tweetsByUser);
                                logger.debug(
                                    `Updated tweet cache with ${
                                        Object.keys(tweetsByUser).length
                                    } accounts`
                                );

                                // One hour ago timestamp for filtering old tweets
                                const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
                                logger.debug(
                                    `Filtering tweets older than ${oneHourAgo.toISOString()}`
                                );

                                // Process tweets for each account
                                for (const account of config.NEWS_MONITOR.TWITTER_ACCOUNTS) {
                                    try {
                                        const tweets = tweetsByUser[account.username] || [];
                                        if (tweets.length === 0) continue;

                                        // Sort tweets by creation date (newest first)
                                        tweets.sort(
                                            (a, b) =>
                                                new Date(b.created_at) - new Date(a.created_at)
                                        );

                                        // Get the latest tweet (first element) only
                                        const latestTweet = tweets[0];

                                        // Skip if we've already processed this tweet
                                        if (latestTweet.id === account.lastTweetId) continue;

                                        // Skip if tweet is older than 1 hour
                                        const tweetDate = new Date(latestTweet.created_at);
                                        if (tweetDate < oneHourAgo) {
                                            logger.debug(
                                                `Skipping tweet from @${account.username} (${
                                                    latestTweet.id
                                                }) - older than 1 hour: ${tweetDate.toISOString()}`
                                            );
                                            continue;
                                        }

                                        // Special handling for media tweets
                                        if (account.mediaOnly) {
                                            if (account.username === 'SITREP_artorias') {
                                                // Specific handling for SITREP_artorias
                                                try {
                                                    let sitrepPassedEvaluation = false;
                                                    if (account.promptSpecific) {
                                                        const passed =
                                                            await evaluateAccountSpecific(
                                                                latestTweet.text,
                                                                account.username
                                                            );
                                                        if (!passed) {
                                                            logger.debug(
                                                                `Tweet from ${account.username} (SITREP_artorias) failed account-specific evaluation, skipping`
                                                            );
                                                            continue;
                                                        }
                                                        logger.debug(
                                                            `Tweet from ${account.username} (SITREP_artorias) passed account-specific evaluation`
                                                        );
                                                        sitrepPassedEvaluation = true;
                                                    } else {
                                                        logger.warn(
                                                            `SITREP_artorias account is mediaOnly but promptSpecific is not true in config. Skipping.`
                                                        );
                                                        continue;
                                                    }

                                                    if (
                                                        sitrepPassedEvaluation &&
                                                        latestTweet.mediaObjects
                                                    ) {
                                                        const photoMedia =
                                                            latestTweet.mediaObjects.find(
                                                                media => media.type === 'photo'
                                                            );
                                                        if (
                                                            photoMedia &&
                                                            (photoMedia.url ||
                                                                photoMedia.preview_image_url)
                                                        ) {
                                                            const imageUrl =
                                                                photoMedia.url ||
                                                                photoMedia.preview_image_url;
                                                            const imageTextExtractionPrompt =
                                                                config.NEWS_MONITOR.PROMPTS
                                                                    .PROCESS_SITREP_IMAGE_PROMPT;

                                                            if (!imageTextExtractionPrompt) {
                                                                logger.error(
                                                                    'PROCESS_SITREP_IMAGE_PROMPT is not defined in config.NEWS_MONITOR.PROMPTS for SITREP_artorias'
                                                                );
                                                                continue;
                                                            }

                                                            logger.info(
                                                                `Processing image for SITREP_artorias tweet: ${latestTweet.id}`
                                                            );
                                                            const extractedImageText =
                                                                await extractTextFromImageWithOpenAI(
                                                                    imageUrl,
                                                                    imageTextExtractionPrompt
                                                                );

                                                            if (
                                                                extractedImageText &&
                                                                extractedImageText
                                                                    .toLowerCase()
                                                                    .trim() !==
                                                                    'nenhum texto relevante detectado na imagem.' &&
                                                                extractedImageText
                                                                    .toLowerCase()
                                                                    .trim() !==
                                                                    'nenhum texto detectado na imagem.'
                                                            ) {
                                                                const tweetLink = `https://twitter.com/${account.username}/status/${latestTweet.id}`;
                                                                const messageCaption = `*Breaking News* 🗞️\n\n${extractedImageText}\n\nFonte: @${account.username}\n${tweetLink}`;

                                                                await targetGroup.sendMessage(
                                                                    messageCaption
                                                                );
                                                                const justification =
                                                                    'Texto extraído da imagem e formatado.';
                                                                logger.info(
                                                                    `Sent processed image text from SITREP_artorias (@${account.username}): "${latestTweet.id}" - Justificação: ${justification}`
                                                                );
                                                                recordSentTweet(
                                                                    latestTweet,
                                                                    account.username,
                                                                    justification
                                                                );
                                                            } else {
                                                                logger.info(
                                                                    `No relevant text extracted from image for SITREP_artorias tweet ${
                                                                        latestTweet.id
                                                                    }. Original text: "${
                                                                        latestTweet.text ||
                                                                        '[no text content in tweet]'
                                                                    }"`
                                                                );
                                                            }
                                                        } else {
                                                            logger.debug(
                                                                `SITREP_artorias tweet ${latestTweet.id} from @${account.username} passed evaluation but no usable photo media found.`
                                                            );
                                                        }
                                                    } else if (sitrepPassedEvaluation) {
                                                        logger.debug(
                                                            `SITREP_artorias tweet ${latestTweet.id} from @${account.username} passed evaluation but no media objects found.`
                                                        );
                                                    }
                                                } catch (error) {
                                                    logger.error(
                                                        `Error processing SITREP_artorias media tweet for ${account.username}:`,
                                                        error
                                                    );
                                                }
                                            } else {
                                                // Original mediaOnly logic for other accounts
                                                try {
                                                    if (account.promptSpecific) {
                                                        const passed =
                                                            await evaluateAccountSpecific(
                                                                latestTweet.text,
                                                                account.username
                                                            );
                                                        if (!passed) {
                                                            logger.debug(
                                                                `Tweet from ${account.username} failed account-specific evaluation, skipping`
                                                            );
                                                            continue;
                                                        }
                                                        logger.debug(
                                                            `Tweet from ${account.username} passed account-specific evaluation`
                                                        );
                                                    }

                                                    let isRelevant =
                                                        account.skipEvaluation || false;
                                                    let evalResult;

                                                    if (!account.skipEvaluation) {
                                                        evalResult = await evaluateContent(
                                                            latestTweet.text,
                                                            'twitter-media',
                                                            account.username
                                                        );
                                                        isRelevant = evalResult.isRelevant;
                                                    }

                                                    if (isRelevant && latestTweet.mediaObjects) {
                                                        const photoMedia =
                                                            latestTweet.mediaObjects.find(
                                                                media => media.type === 'photo'
                                                            );

                                                        if (
                                                            photoMedia &&
                                                            (photoMedia.url ||
                                                                photoMedia.preview_image_url)
                                                        ) {
                                                            const imageUrl =
                                                                photoMedia.url ||
                                                                photoMedia.preview_image_url;
                                                            const response = await axios.get(
                                                                imageUrl,
                                                                { responseType: 'arraybuffer' }
                                                            );
                                                            const imageBuffer = Buffer.from(
                                                                response.data
                                                            );
                                                            const media = new MessageMedia(
                                                                'image/jpeg',
                                                                imageBuffer.toString('base64')
                                                            );
                                                            let translatedText =
                                                                latestTweet.text || '';
                                                            try {
                                                                if (translatedText) {
                                                                    translatedText =
                                                                        await require('../utils/newsUtils').translateToPortuguese(
                                                                            translatedText,
                                                                            'en'
                                                                        );
                                                                    logger.debug(
                                                                        `Translated media tweet from ${account.username}`
                                                                    );
                                                                }
                                                            } catch (translationError) {
                                                                logger.error(
                                                                    `Error translating media tweet for ${account.username}:`,
                                                                    translationError
                                                                );
                                                            }
                                                            const caption = `*Breaking News* 🗞️\n\n${
                                                                translatedText
                                                                    ? `${translatedText}\n\n`
                                                                    : ''
                                                            }Source: @${account.username}`;
                                                            await targetGroup.sendMessage(media, {
                                                                caption: caption,
                                                            });
                                                            const justification =
                                                                evalResult?.justification ||
                                                                (account.skipEvaluation
                                                                    ? 'Skipped Evaluation'
                                                                    : 'Relevante');
                                                            logger.info(
                                                                `Sent media tweet from ${
                                                                    account.username
                                                                }: "${latestTweet.text?.substring(
                                                                    0,
                                                                    80
                                                                )}${
                                                                    latestTweet.text?.length > 80
                                                                        ? '...'
                                                                        : ''
                                                                }" - Justificação: ${justification}`
                                                            );
                                                            recordSentTweet(
                                                                latestTweet,
                                                                account.username,
                                                                justification
                                                            );
                                                        }
                                                    }
                                                } catch (error) {
                                                    logger.error(
                                                        `Error processing media tweet for ${account.username}:`,
                                                        error
                                                    );
                                                }
                                            }
                                        } else {
                                            // Process regular tweet (text-based)
                                            try {
                                                // Check if this account should use an account-specific prompt
                                                if (account.promptSpecific) {
                                                    // Run the account-specific evaluation
                                                    const passed = await evaluateAccountSpecific(
                                                        latestTweet.text,
                                                        account.username
                                                    );
                                                    if (!passed) {
                                                        logger.debug(
                                                            `Tweet from ${account.username} failed account-specific evaluation, skipping`
                                                        );
                                                        continue;
                                                    }
                                                    logger.debug(
                                                        `Tweet from ${account.username} passed account-specific evaluation`
                                                    );
                                                }

                                                // Standard evaluation if not skipping
                                                let isRelevant = account.skipEvaluation || false;

                                                if (!account.skipEvaluation) {
                                                    const evalResult = await evaluateContent(
                                                        latestTweet.text,
                                                        'twitter',
                                                        account.username
                                                    );
                                                    isRelevant = evalResult.isRelevant;
                                                }

                                                if (isRelevant) {
                                                    // Check if we need to translate the tweet
                                                    let translatedText = latestTweet.text;
                                                    try {
                                                        // Assume English as source language for translation
                                                        translatedText =
                                                            await require('../utils/newsUtils').translateToPortuguese(
                                                                latestTweet.text,
                                                                'en'
                                                            );
                                                        logger.debug(
                                                            `Translated tweet from ${account.username}`
                                                        );
                                                    } catch (translationError) {
                                                        logger.error(
                                                            `Error translating tweet for ${account.username}:`,
                                                            translationError
                                                        );
                                                        // Continue with original text if translation fails
                                                    }

                                                    // Check if the tweet has media
                                                    if (
                                                        latestTweet.mediaObjects &&
                                                        latestTweet.mediaObjects.length > 0
                                                    ) {
                                                        // Find the first photo in the media objects
                                                        const photoMedia =
                                                            latestTweet.mediaObjects.find(
                                                                media => media.type === 'photo'
                                                            );

                                                        if (
                                                            photoMedia &&
                                                            (photoMedia.url ||
                                                                photoMedia.preview_image_url)
                                                        ) {
                                                            try {
                                                                const imageUrl =
                                                                    photoMedia.url ||
                                                                    photoMedia.preview_image_url;

                                                                // Download the image
                                                                const response = await axios.get(
                                                                    imageUrl,
                                                                    { responseType: 'arraybuffer' }
                                                                );
                                                                const imageBuffer = Buffer.from(
                                                                    response.data
                                                                );

                                                                // Create media object
                                                                const media = new MessageMedia(
                                                                    'image/jpeg',
                                                                    imageBuffer.toString('base64')
                                                                );

                                                                // Format message text with caption
                                                                const caption = `*Breaking News* 🗞️\n\n${translatedText}\n\nSource: @${account.username}`;

                                                                // Send media with caption in a single message
                                                                await targetGroup.sendMessage(
                                                                    media,
                                                                    { caption: caption }
                                                                );

                                                                // Make sure evalResult is defined before accessing it
                                                                const justification =
                                                                    typeof evalResult !==
                                                                    'undefined'
                                                                        ? evalResult?.justification ||
                                                                          'Relevante'
                                                                        : 'Relevante';
                                                                logger.info(
                                                                    `Sent tweet with media from ${
                                                                        account.username
                                                                    }: "${latestTweet.text.substring(
                                                                        0,
                                                                        80
                                                                    )}${
                                                                        latestTweet.text.length > 80
                                                                            ? '...'
                                                                            : ''
                                                                    }" - Justificação: ${justification}`
                                                                );
                                                            } catch (mediaError) {
                                                                logger.error(
                                                                    `Error attaching media for ${account.username}:`,
                                                                    mediaError
                                                                );

                                                                // Fallback to sending text-only message if media fails
                                                                const message = `*Breaking News* 🗞️\n\n${translatedText}\n\nSource: @${account.username}`;
                                                                await targetGroup.sendMessage(
                                                                    message
                                                                );

                                                                // Make sure evalResult is defined before accessing it
                                                                const justification =
                                                                    typeof evalResult !==
                                                                    'undefined'
                                                                        ? evalResult?.justification ||
                                                                          'Relevante'
                                                                        : 'Relevante';
                                                                logger.info(
                                                                    `Sent text-only tweet from ${
                                                                        account.username
                                                                    }: "${latestTweet.text.substring(
                                                                        0,
                                                                        80
                                                                    )}${
                                                                        latestTweet.text.length > 80
                                                                            ? '...'
                                                                            : ''
                                                                    }" - Justificação: ${justification}`
                                                                );
                                                            }
                                                        } else {
                                                            // No photo media available, send text only
                                                            const message = `*Breaking News* 🗞️\n\n${translatedText}\n\nSource: @${account.username}`;
                                                            await targetGroup.sendMessage(message);

                                                            // Make sure evalResult is defined before accessing it
                                                            const justification =
                                                                typeof evalResult !== 'undefined'
                                                                    ? evalResult?.justification ||
                                                                      'Relevante'
                                                                    : 'Relevante';
                                                            logger.info(
                                                                `Sent text-only tweet from ${
                                                                    account.username
                                                                }: "${latestTweet.text.substring(
                                                                    0,
                                                                    80
                                                                )}${
                                                                    latestTweet.text.length > 80
                                                                        ? '...'
                                                                        : ''
                                                                }" - Justificação: ${justification}`
                                                            );
                                                        }
                                                    } else {
                                                        // No media, send text only
                                                        const message = `*Breaking News* 🗞️\n\n${translatedText}\n\nSource: @${account.username}`;
                                                        await targetGroup.sendMessage(message);

                                                        // Make sure evalResult is defined before accessing it
                                                        const justification =
                                                            typeof evalResult !== 'undefined'
                                                                ? evalResult?.justification ||
                                                                  'Relevante'
                                                                : 'Relevante';
                                                        logger.info(
                                                            `Sent text-only tweet from ${
                                                                account.username
                                                            }: "${latestTweet.text.substring(
                                                                0,
                                                                80
                                                            )}${
                                                                latestTweet.text.length > 80
                                                                    ? '...'
                                                                    : ''
                                                            }" - Justificação: ${justification}`
                                                        );
                                                    }

                                                    // Record that we sent this tweet
                                                    const justification =
                                                        typeof evalResult !== 'undefined'
                                                            ? evalResult?.justification || null
                                                            : null;
                                                    recordSentTweet(
                                                        latestTweet,
                                                        account.username,
                                                        justification
                                                    );
                                                }
                                            } catch (error) {
                                                logger.error(
                                                    `Error processing tweet for ${account.username}:`,
                                                    error
                                                );
                                            }
                                        }

                                        // Update last tweet ID in memory
                                        account.lastTweetId = latestTweet.id;
                                    } catch (accountError) {
                                        logger.error(
                                            `Error processing account ${account.username}:`,
                                            accountError
                                        );
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
                                logger.error(
                                    'Target group not found, attempting to reinitialize...'
                                );
                                const chats = await global.client.getChats();
                                targetGroup = chats.find(
                                    chat => chat.name === config.NEWS_MONITOR.TARGET_GROUP
                                );
                                if (!targetGroup) {
                                    logger.error(
                                        `Target group "${config.NEWS_MONITOR.TARGET_GROUP}" not found, skipping RSS processing`
                                    );
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
                                                articleTitle = await translateToPortuguese(
                                                    article.title,
                                                    feed.language
                                                );
                                            }

                                            // Generate summary
                                            const articleContent = extractArticleContent(article);
                                            const summary = await generateSummary(
                                                article.title,
                                                articleContent
                                            );

                                            // Get justification
                                            const justification =
                                                article.relevanceJustification || 'Relevante';

                                            // Format message
                                            const message = `*Breaking News* 🗞️\n\n*${articleTitle}*\n\n${summary}\n\nFonte: ${feed.name}\n${article.link}`;

                                            // Send to group
                                            await targetGroup.sendMessage(message);

                                            // Record that we sent this article
                                            recordSentArticle(article);
                                            articlesSent++;

                                            // Log that we sent an article with title and justification
                                            logger.info(
                                                `ARTICLE SENT TO GROUP: "${article.title.substring(
                                                    0,
                                                    80
                                                )}${
                                                    article.title.length > 80 ? '...' : ''
                                                }" - Justificativa: ${justification}`
                                            );
                                        } catch (error) {
                                            logger.error(
                                                `Error sending article "${article.title}": ${error.message}`
                                            );
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

                    logger.info(
                        `RSS monitor restarted with ${config.NEWS_MONITOR.FEEDS.length} feeds`
                    );
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
            logger.error(
                `Target group "${config.NEWS_MONITOR.TARGET_GROUP}" not found, skipping news monitor initialization`
            );
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
                    if (
                        usage.primary.usage >= 100 &&
                        usage.fallback.usage >= 100 &&
                        usage.fallback2.usage >= 100
                    ) {
                        // Only disable Twitter monitor if we've exhausted all retry attempts
                        if (attempts === maxAttempts - 1) {
                            const message = `Twitter Monitor Disabled: All API keys are have reached 100% usage limit. ${formatTwitterApiUsage(
                                { primary: usage, fallback: usage, fallback2: usage },
                                twitterApiUsageCache.resetTimes,
                                usage.currentKey
                            )}`;
                            logger.warn(message);

                            // Disable Twitter monitor in config
                            config.NEWS_MONITOR.TWITTER_ENABLED = false;
                            logger.info(
                                'Twitter monitor has been disabled due to all API keys reaching usage limit'
                            );
                            break; // Exit retry loop if all keys are over limit
                        } else {
                            // Try again after waiting
                            attempts++;
                            const waitTime = waitTimes[attempts];
                            logger.warn(
                                `All Twitter API keys over limit (attempt ${
                                    attempts + 1
                                }/${maxAttempts}). Waiting ${
                                    waitTime / 60000
                                } minutes before retry...`
                            );
                            await new Promise(resolve => setTimeout(resolve, waitTime));
                            continue; // Skip to next retry attempt
                        }
                    }

                    logger.info(
                        `Twitter monitor initialized (${formatTwitterApiUsage(
                            usage,
                            twitterApiUsageCache.resetTimes,
                            usage.currentKey
                        )})`
                    );

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
                            logger.debug(
                                `Twitter monitor check (${formatTwitterApiUsage(
                                    usage,
                                    twitterApiUsageCache.resetTimes,
                                    usage.currentKey
                                )})`
                            );

                            // Check if current key is over limit and switch if needed
                            if (usage[usage.currentKey].usage >= 100) {
                                logger.warn(
                                    `Current Twitter API key (${usage.currentKey}) has reached its limit, attempting to switch keys...`
                                );

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
                                    const message = `Twitter Monitor Disabled: All API keys are have reached 100% usage limit. ${formatTwitterApiUsage(
                                        { primary: usage, fallback: usage, fallback2: usage },
                                        twitterApiUsageCache.resetTimes,
                                        usage.currentKey
                                    )}`;
                                    logger.warn(message);

                                    // Disable Twitter monitor in config
                                    config.NEWS_MONITOR.TWITTER_ENABLED = false;
                                    logger.info(
                                        'Twitter monitor has been disabled due to all API keys reaching usage limit'
                                    );

                                    // Clear the interval
                                    clearInterval(twitterIntervalId);
                                    twitterIntervalId = null;
                                    return;
                                }
                            }

                            // Process tweets using the search API approach
                            try {
                                // Fetch tweets for all accounts in one call
                                const tweetsByUser = await fetchTweets(
                                    config.NEWS_MONITOR.TWITTER_ACCOUNTS
                                );

                                // Store fetched tweets in the cache for debug purposes
                                updateLastFetchedTweetsCache(tweetsByUser);
                                logger.debug(
                                    `Updated tweet cache with ${
                                        Object.keys(tweetsByUser).length
                                    } accounts`
                                );

                                // One hour ago timestamp for filtering old tweets
                                const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
                                logger.debug(
                                    `Filtering tweets older than ${oneHourAgo.toISOString()}`
                                );

                                // Process tweets for each account
                                for (const account of config.NEWS_MONITOR.TWITTER_ACCOUNTS) {
                                    try {
                                        const tweets = tweetsByUser[account.username] || [];
                                        if (tweets.length === 0) continue;

                                        // Sort tweets by creation date (newest first)
                                        tweets.sort(
                                            (a, b) =>
                                                new Date(b.created_at) - new Date(a.created_at)
                                        );

                                        // Get the latest tweet (first element) only
                                        const latestTweet = tweets[0];

                                        // Skip if we've already processed this tweet
                                        if (latestTweet.id === account.lastTweetId) continue;

                                        // Skip if tweet is older than 1 hour
                                        const tweetDate = new Date(latestTweet.created_at);
                                        if (tweetDate < oneHourAgo) {
                                            logger.debug(
                                                `Skipping tweet from @${account.username} (${
                                                    latestTweet.id
                                                }) - older than 1 hour: ${tweetDate.toISOString()}`
                                            );
                                            continue;
                                        }

                                        // Special handling for media tweets
                                        if (account.mediaOnly) {
                                            if (account.username === 'SITREP_artorias') {
                                                // Specific handling for SITREP_artorias
                                                try {
                                                    let sitrepPassedEvaluation = false;
                                                    if (account.promptSpecific) {
                                                        const passed =
                                                            await evaluateAccountSpecific(
                                                                latestTweet.text,
                                                                account.username
                                                            );
                                                        if (!passed) {
                                                            logger.debug(
                                                                `Tweet from ${account.username} (SITREP_artorias) failed account-specific evaluation, skipping`
                                                            );
                                                            continue;
                                                        }
                                                        logger.debug(
                                                            `Tweet from ${account.username} (SITREP_artorias) passed account-specific evaluation`
                                                        );
                                                        sitrepPassedEvaluation = true;
                                                    } else {
                                                        logger.warn(
                                                            `SITREP_artorias account is mediaOnly but promptSpecific is not true in config. Skipping.`
                                                        );
                                                        continue;
                                                    }

                                                    if (
                                                        sitrepPassedEvaluation &&
                                                        latestTweet.mediaObjects
                                                    ) {
                                                        const photoMedia =
                                                            latestTweet.mediaObjects.find(
                                                                media => media.type === 'photo'
                                                            );
                                                        if (
                                                            photoMedia &&
                                                            (photoMedia.url ||
                                                                photoMedia.preview_image_url)
                                                        ) {
                                                            const imageUrl =
                                                                photoMedia.url ||
                                                                photoMedia.preview_image_url;
                                                            const imageTextExtractionPrompt =
                                                                config.NEWS_MONITOR.PROMPTS
                                                                    .PROCESS_SITREP_IMAGE_PROMPT;

                                                            if (!imageTextExtractionPrompt) {
                                                                logger.error(
                                                                    'PROCESS_SITREP_IMAGE_PROMPT is not defined in config.NEWS_MONITOR.PROMPTS for SITREP_artorias'
                                                                );
                                                                continue;
                                                            }

                                                            logger.info(
                                                                `Processing image for SITREP_artorias tweet: ${latestTweet.id}`
                                                            );
                                                            const extractedImageText =
                                                                await extractTextFromImageWithOpenAI(
                                                                    imageUrl,
                                                                    imageTextExtractionPrompt
                                                                );

                                                            if (
                                                                extractedImageText &&
                                                                extractedImageText
                                                                    .toLowerCase()
                                                                    .trim() !==
                                                                    'nenhum texto relevante detectado na imagem.' &&
                                                                extractedImageText
                                                                    .toLowerCase()
                                                                    .trim() !==
                                                                    'nenhum texto detectado na imagem.'
                                                            ) {
                                                                const tweetLink = `https://twitter.com/${account.username}/status/${latestTweet.id}`;
                                                                const messageCaption = `*Breaking News* 🗞️\n\n${extractedImageText}\n\nFonte: @${account.username}\n${tweetLink}`;

                                                                await targetGroup.sendMessage(
                                                                    messageCaption
                                                                );
                                                                const justification =
                                                                    'Texto extraído da imagem e formatado.';
                                                                logger.info(
                                                                    `Sent processed image text from SITREP_artorias (@${account.username}): "${latestTweet.id}" - Justificação: ${justification}`
                                                                );
                                                                recordSentTweet(
                                                                    latestTweet,
                                                                    account.username,
                                                                    justification
                                                                );
                                                            } else {
                                                                logger.info(
                                                                    `No relevant text extracted from image for SITREP_artorias tweet ${
                                                                        latestTweet.id
                                                                    }. Original text: "${
                                                                        latestTweet.text ||
                                                                        '[no text content in tweet]'
                                                                    }"`
                                                                );
                                                            }
                                                        } else {
                                                            logger.debug(
                                                                `SITREP_artorias tweet ${latestTweet.id} from @${account.username} passed evaluation but no usable photo media found.`
                                                            );
                                                        }
                                                    } else if (sitrepPassedEvaluation) {
                                                        logger.debug(
                                                            `SITREP_artorias tweet ${latestTweet.id} from @${account.username} passed evaluation but no media objects found.`
                                                        );
                                                    }
                                                } catch (error) {
                                                    logger.error(
                                                        `Error processing SITREP_artorias media tweet for ${account.username}:`,
                                                        error
                                                    );
                                                }
                                            } else {
                                                // Original mediaOnly logic for other accounts
                                                try {
                                                    if (account.promptSpecific) {
                                                        const passed =
                                                            await evaluateAccountSpecific(
                                                                latestTweet.text,
                                                                account.username
                                                            );
                                                        if (!passed) {
                                                            logger.debug(
                                                                `Tweet from ${account.username} failed account-specific evaluation, skipping`
                                                            );
                                                            continue;
                                                        }
                                                        logger.debug(
                                                            `Tweet from ${account.username} passed account-specific evaluation`
                                                        );
                                                    }

                                                    let isRelevant =
                                                        account.skipEvaluation || false;
                                                    let evalResult;

                                                    if (!account.skipEvaluation) {
                                                        evalResult = await evaluateContent(
                                                            latestTweet.text,
                                                            'twitter-media',
                                                            account.username
                                                        );
                                                        isRelevant = evalResult.isRelevant;
                                                    }

                                                    if (isRelevant && latestTweet.mediaObjects) {
                                                        const photoMedia =
                                                            latestTweet.mediaObjects.find(
                                                                media => media.type === 'photo'
                                                            );

                                                        if (
                                                            photoMedia &&
                                                            (photoMedia.url ||
                                                                photoMedia.preview_image_url)
                                                        ) {
                                                            const imageUrl =
                                                                photoMedia.url ||
                                                                photoMedia.preview_image_url;
                                                            const response = await axios.get(
                                                                imageUrl,
                                                                { responseType: 'arraybuffer' }
                                                            );
                                                            const imageBuffer = Buffer.from(
                                                                response.data
                                                            );
                                                            const media = new MessageMedia(
                                                                'image/jpeg',
                                                                imageBuffer.toString('base64')
                                                            );
                                                            let translatedText =
                                                                latestTweet.text || '';
                                                            try {
                                                                if (translatedText) {
                                                                    translatedText =
                                                                        await require('../utils/newsUtils').translateToPortuguese(
                                                                            translatedText,
                                                                            'en'
                                                                        );
                                                                    logger.debug(
                                                                        `Translated media tweet from ${account.username}`
                                                                    );
                                                                }
                                                            } catch (translationError) {
                                                                logger.error(
                                                                    `Error translating media tweet for ${account.username}:`,
                                                                    translationError
                                                                );
                                                            }
                                                            const caption = `*Breaking News* 🗞️\n\n${
                                                                translatedText
                                                                    ? `${translatedText}\n\n`
                                                                    : ''
                                                            }Source: @${account.username}`;
                                                            await targetGroup.sendMessage(media, {
                                                                caption: caption,
                                                            });
                                                            const justification =
                                                                evalResult?.justification ||
                                                                (account.skipEvaluation
                                                                    ? 'Skipped Evaluation'
                                                                    : 'Relevante');
                                                            logger.info(
                                                                `Sent media tweet from ${
                                                                    account.username
                                                                }: "${latestTweet.text?.substring(
                                                                    0,
                                                                    80
                                                                )}${
                                                                    latestTweet.text?.length > 80
                                                                        ? '...'
                                                                        : ''
                                                                }" - Justificação: ${justification}`
                                                            );
                                                            recordSentTweet(
                                                                latestTweet,
                                                                account.username,
                                                                justification
                                                            );
                                                        }
                                                    }
                                                } catch (error) {
                                                    logger.error(
                                                        `Error processing media tweet for ${account.username}:`,
                                                        error
                                                    );
                                                }
                                            }
                                        } else {
                                            // Process regular tweet (text-based)
                                            try {
                                                // Check if this account should use an account-specific prompt
                                                if (account.promptSpecific) {
                                                    // Run the account-specific evaluation
                                                    const passed = await evaluateAccountSpecific(
                                                        latestTweet.text,
                                                        account.username
                                                    );
                                                    if (!passed) {
                                                        logger.debug(
                                                            `Tweet from ${account.username} failed account-specific evaluation, skipping`
                                                        );
                                                        continue;
                                                    }
                                                    logger.debug(
                                                        `Tweet from ${account.username} passed account-specific evaluation`
                                                    );
                                                }

                                                // Standard evaluation if not skipping
                                                let isRelevant = account.skipEvaluation || false;

                                                if (!account.skipEvaluation) {
                                                    const evalResult = await evaluateContent(
                                                        latestTweet.text,
                                                        'twitter',
                                                        account.username
                                                    );
                                                    isRelevant = evalResult.isRelevant;
                                                }

                                                if (isRelevant) {
                                                    // Check if we need to translate the tweet
                                                    let translatedText = latestTweet.text;
                                                    try {
                                                        // Assume English as source language for translation
                                                        translatedText =
                                                            await require('../utils/newsUtils').translateToPortuguese(
                                                                latestTweet.text,
                                                                'en'
                                                            );
                                                        logger.debug(
                                                            `Translated tweet from ${account.username}`
                                                        );
                                                    } catch (translationError) {
                                                        logger.error(
                                                            `Error translating tweet for ${account.username}:`,
                                                            translationError
                                                        );
                                                        // Continue with original text if translation fails
                                                    }

                                                    // Check if the tweet has media
                                                    if (
                                                        latestTweet.mediaObjects &&
                                                        latestTweet.mediaObjects.length > 0
                                                    ) {
                                                        // Find the first photo in the media objects
                                                        const photoMedia =
                                                            latestTweet.mediaObjects.find(
                                                                media => media.type === 'photo'
                                                            );

                                                        if (
                                                            photoMedia &&
                                                            (photoMedia.url ||
                                                                photoMedia.preview_image_url)
                                                        ) {
                                                            try {
                                                                const imageUrl =
                                                                    photoMedia.url ||
                                                                    photoMedia.preview_image_url;

                                                                // Download the image
                                                                const response = await axios.get(
                                                                    imageUrl,
                                                                    { responseType: 'arraybuffer' }
                                                                );
                                                                const imageBuffer = Buffer.from(
                                                                    response.data
                                                                );

                                                                // Create media object
                                                                const media = new MessageMedia(
                                                                    'image/jpeg',
                                                                    imageBuffer.toString('base64')
                                                                );

                                                                // Format message text with caption
                                                                const caption = `*Breaking News* 🗞️\n\n${translatedText}\n\nSource: @${account.username}`;

                                                                // Send media with caption in a single message
                                                                await targetGroup.sendMessage(
                                                                    media,
                                                                    { caption: caption }
                                                                );

                                                                // Make sure evalResult is defined before accessing it
                                                                const justification =
                                                                    typeof evalResult !==
                                                                    'undefined'
                                                                        ? evalResult?.justification ||
                                                                          'Relevante'
                                                                        : 'Relevante';
                                                                logger.info(
                                                                    `Sent tweet with media from ${
                                                                        account.username
                                                                    }: "${latestTweet.text.substring(
                                                                        0,
                                                                        80
                                                                    )}${
                                                                        latestTweet.text.length > 80
                                                                            ? '...'
                                                                            : ''
                                                                    }" - Justificação: ${justification}`
                                                                );
                                                            } catch (mediaError) {
                                                                logger.error(
                                                                    `Error attaching media for ${account.username}:`,
                                                                    mediaError
                                                                );

                                                                // Fallback to sending text-only message if media fails
                                                                const message = `*Breaking News* 🗞️\n\n${translatedText}\n\nSource: @${account.username}`;
                                                                await targetGroup.sendMessage(
                                                                    message
                                                                );

                                                                // Make sure evalResult is defined before accessing it
                                                                const justification =
                                                                    typeof evalResult !==
                                                                    'undefined'
                                                                        ? evalResult?.justification ||
                                                                          'Relevante'
                                                                        : 'Relevante';
                                                                logger.info(
                                                                    `Sent text-only tweet from ${
                                                                        account.username
                                                                    }: "${latestTweet.text.substring(
                                                                        0,
                                                                        80
                                                                    )}${
                                                                        latestTweet.text.length > 80
                                                                            ? '...'
                                                                            : ''
                                                                    }" - Justificação: ${justification}`
                                                                );
                                                            }
                                                        } else {
                                                            // No photo media available, send text only
                                                            const message = `*Breaking News* 🗞️\n\n${translatedText}\n\nSource: @${account.username}`;
                                                            await targetGroup.sendMessage(message);

                                                            // Make sure evalResult is defined before accessing it
                                                            const justification =
                                                                typeof evalResult !== 'undefined'
                                                                    ? evalResult?.justification ||
                                                                      'Relevante'
                                                                    : 'Relevante';
                                                            logger.info(
                                                                `Sent text-only tweet from ${
                                                                    account.username
                                                                }: "${latestTweet.text.substring(
                                                                    0,
                                                                    80
                                                                )}${
                                                                    latestTweet.text.length > 80
                                                                        ? '...'
                                                                        : ''
                                                                }" - Justificação: ${justification}`
                                                            );
                                                        }
                                                    } else {
                                                        // No media, send text only
                                                        const message = `*Breaking News* 🗞️\n\n${translatedText}\n\nSource: @${account.username}`;
                                                        await targetGroup.sendMessage(message);

                                                        // Make sure evalResult is defined before accessing it
                                                        const justification =
                                                            typeof evalResult !== 'undefined'
                                                                ? evalResult?.justification ||
                                                                  'Relevante'
                                                                : 'Relevante';
                                                        logger.info(
                                                            `Sent text-only tweet from ${
                                                                account.username
                                                            }: "${latestTweet.text.substring(
                                                                0,
                                                                80
                                                            )}${
                                                                latestTweet.text.length > 80
                                                                    ? '...'
                                                                    : ''
                                                            }" - Justificação: ${justification}`
                                                        );
                                                    }

                                                    // Record that we sent this tweet
                                                    const justification =
                                                        typeof evalResult !== 'undefined'
                                                            ? evalResult?.justification || null
                                                            : null;
                                                    recordSentTweet(
                                                        latestTweet,
                                                        account.username,
                                                        justification
                                                    );
                                                }
                                            } catch (error) {
                                                logger.error(
                                                    `Error processing tweet for ${account.username}:`,
                                                    error
                                                );
                                            }
                                        }

                                        // Update last tweet ID in memory
                                        account.lastTweetId = latestTweet.id;
                                    } catch (accountError) {
                                        logger.error(
                                            `Error processing account ${account.username}:`,
                                            accountError
                                        );
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
                        // Only exit retry loop if we've exhausted all attempts
                        if (attempts >= maxAttempts) {
                            logger.error(
                                'Twitter monitor initialization failed after all attempts due to rate limiting'
                            );

                            // Disable Twitter monitor in config after exhausting retries
                            config.NEWS_MONITOR.TWITTER_ENABLED = false;
                            logger.info(
                                'Twitter monitor has been disabled due to rate limiting after all retry attempts'
                            );
                            break;
                        }

                        const waitTime = waitTimes[attempts];
                        // Only notify admin on the last attempt
                        const isLastAttempt = attempts === maxAttempts - 1;

                        if (isLastAttempt) {
                            // Use warn to ensure admin notification
                            logger.warn(
                                `Twitter API rate limit reached (final attempt ${
                                    attempts + 1
                                }/${maxAttempts}). Waiting ${
                                    waitTime / 60000
                                } minutes before final retry...`
                            );
                        } else {
                            // Use warn for intermediate attempts
                            logger.warn(
                                `Twitter API rate limit reached (attempt ${
                                    attempts + 1
                                }/${maxAttempts}). Waiting ${
                                    waitTime / 60000
                                } minutes before retry...`
                            );
                        }

                        await new Promise(resolve => setTimeout(resolve, waitTime));
                    } else {
                        // If it's not a rate limit error, log and break
                        logger.error('Twitter monitor initialization failed:', error.message);

                        // Only disable on critical errors, not on temporary failures
                        if (
                            error.code === 'ENOTFOUND' ||
                            error.code === 'ECONNREFUSED' ||
                            error.message.includes('authentication')
                        ) {
                            config.NEWS_MONITOR.TWITTER_ENABLED = false;
                            logger.info(
                                'Twitter monitor has been disabled due to critical API error'
                            );
                        }
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
                            targetGroup = chats.find(
                                chat => chat.name === config.NEWS_MONITOR.TARGET_GROUP
                            );
                            if (!targetGroup) {
                                logger.error(
                                    `Target group "${config.NEWS_MONITOR.TARGET_GROUP}" not found, skipping RSS processing`
                                );
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
                                            articleTitle = await translateToPortuguese(
                                                article.title,
                                                feed.language
                                            );
                                        }

                                        // Generate summary
                                        const articleContent = extractArticleContent(article);
                                        const summary = await generateSummary(
                                            article.title,
                                            articleContent
                                        );

                                        // Get justification
                                        const justification =
                                            article.relevanceJustification || 'Relevante';

                                        // Format message
                                        const message = `*Breaking News* 🗞️\n\n*${articleTitle}*\n\n${summary}\n\nFonte: ${feed.name}\n${article.link}`;

                                        // Send to group
                                        await targetGroup.sendMessage(message);

                                        // Record that we sent this article
                                        recordSentArticle(article);
                                        articlesSent++;

                                        // Log that we sent an article with title and justification
                                        logger.info(
                                            `ARTICLE SENT TO GROUP: "${article.title.substring(
                                                0,
                                                80
                                            )}${
                                                article.title.length > 80 ? '...' : ''
                                            }" - Justificativa: ${justification}`
                                        );
                                    } catch (error) {
                                        logger.error(
                                            `Error sending article "${article.title}": ${error.message}`
                                        );
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

            // If the command includes 'duplicatetest' we'll test the duplicate detection
            if (command === 'duplicatetest' && args.length > 1) {
                // Get the account username
                const username = args[1];
                const account = config.NEWS_MONITOR.TWITTER_ACCOUNTS.find(
                    a => a.username === username
                );

                if (!account) {
                    await message.reply(`Account @${username} not found in configuration.`);
                    return;
                }

                // Get tweets for this account
                const tweets = await fetchTweets([account]);
                const tweetsList = tweets[username];

                if (!tweetsList || tweetsList.length < 2) {
                    await message.reply(
                        `Not enough tweets found for @${username} to test duplicate detection.`
                    );
                    return;
                }

                // Use the latest tweet and test against previous ones
                const [latestTweet, ...previousTweets] = tweetsList;

                // Convert previous tweets to array of objects with needed properties
                const previousArticles = previousTweets.map(tweet => ({
                    title: tweet.text,
                    text: tweet.text,
                    id: tweet.id,
                }));

                // Test duplicate detection
                const duplicateResult = await detectDuplicateWithPrompt(
                    { title: latestTweet.text, text: latestTweet.text, id: latestTweet.id },
                    previousArticles,
                    'twitter'
                );

                // Format the result
                let resultMessage = `Duplicate detection test for @${username}:\n\n`;
                resultMessage += `Latest tweet: "${latestTweet.text.substring(0, 100)}${
                    latestTweet.text.length > 100 ? '...' : ''
                }"\n\n`;
                resultMessage += `Result: ${
                    duplicateResult.isDuplicate ? 'DUPLICATE' : 'UNIQUE'
                }\n`;

                if (duplicateResult.isDuplicate) {
                    const duplicateIdx = parseInt(duplicateResult.duplicateId) - 1;
                    const similarTweet =
                        duplicateIdx >= 0 && duplicateIdx < previousArticles.length
                            ? previousArticles[duplicateIdx]
                            : null;

                    resultMessage += `Similar to tweet: "${similarTweet?.text.substring(0, 100)}${
                        similarTweet?.text.length > 100 ? '...' : ''
                    }"\n`;
                    resultMessage += `Justification: ${duplicateResult.justification}\n`;
                }

                await message.reply(resultMessage);
                return;
            }

            if (command === 'on' || command === 'enable') {
                config.NEWS_MONITOR.TWITTER_ENABLED = true;
                // Restart the Twitter monitor
                await restartMonitors(true, false);
                await message.reply(
                    'Twitter monitor has been enabled. Monitor has been restarted.'
                );
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
                            resetDate = new Date(
                                currentYear,
                                currentMonth + 1,
                                keyData.capResetDay
                            );
                        }

                        resetDayInfo = `Cycle resets on day ${
                            keyData.capResetDay
                        } (${resetDate.toLocaleDateString()})`;
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

                const responseMsg =
                    `Twitter API Key Reset Information:\n\n` +
                    `${formatResetDay(usage.primary, 'Primary')}\n\n` +
                    `${formatResetDay(usage.fallback, 'Fallback')}\n\n` +
                    `${formatResetDay(usage.fallback2, 'Fallback2')}\n\n` +
                    `Current key: ${usage.currentKey}\n` +
                    `Usage: ${formatTwitterApiUsage(
                        usage,
                        twitterApiUsageCache.resetTimes,
                        usage.currentKey
                    )}`;

                await message.reply(responseMsg);
                return;
            } else if (command === 'cache') {
                // Show tweet cache info
                const cachedData = getLastFetchedTweetsCache();
                const cacheInfo = cachedData
                    ? `Tweet cache last updated: ${new Date(
                          cachedData.lastUpdated
                      ).toLocaleString()}\n` +
                      `Accounts in cache: ${Object.keys(cachedData.tweets).length}\n` +
                      `Total tweets: ${Object.values(cachedData.tweets).reduce(
                          (sum, tweets) => sum + tweets.length,
                          0
                      )}\n\n` +
                      `Accounts: ${Object.keys(cachedData.tweets).join(', ')}`
                    : 'Tweet cache is empty';

                await message.reply(cacheInfo);
                return;
            }
        }

        // Show notice if Twitter monitor is disabled but still continue
        if (!config.NEWS_MONITOR.TWITTER_ENABLED) {
            await message.reply(
                '⚠️ WARNING: Twitter monitor is currently DISABLED. Debug info will still be shown, and you can use "!twitterdebug on" to enable it.'
            );
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
            const maskedToken =
                tokenLength > 10
                    ? `${credential.bearer_token.substring(
                          0,
                          5
                      )}...${credential.bearer_token.substring(tokenLength - 5)}`
                    : '[too short to mask]';

            logger.debug(
                `Twitter debug: ${name} key found with token ${maskedToken} (length: ${tokenLength})`
            );
            return tokenLength > 20; // Most bearer tokens are significantly longer than 20 chars
        };

        const primaryValid = checkCredential(primary, 'Primary');
        const fallbackValid = checkCredential(fallback, 'Fallback');
        const fallback2Valid = checkCredential(fallback2, 'Fallback2');

        if (!primaryValid && !fallbackValid && !fallback2Valid) {
            logger.error('Twitter debug: No valid Twitter API credentials found');
            await message.reply(
                'Error: No valid Twitter API credentials found. Check your config.'
            );
            return;
        }

        // Get API usage info
        const usage = await checkTwitterAPIUsage();
        logger.debug('Twitter debug: API usage check completed', usage);

        if (
            !config.NEWS_MONITOR.TWITTER_ACCOUNTS ||
            config.NEWS_MONITOR.TWITTER_ACCOUNTS.length === 0
        ) {
            await message.reply('No Twitter accounts configured');
            return;
        }

        logger.debug('Twitter debug: Configured accounts', {
            accounts: config.NEWS_MONITOR.TWITTER_ACCOUNTS.map(a => ({
                username: a.username,
                mediaOnly: a.mediaOnly,
                skipEvaluation: a.skipEvaluation,
                lastTweetId: a.lastTweetId,
            })),
        });

        // Use cached tweets if available and not too old (last 15 minutes)
        let allTweetsByUser = {};
        const cachedTweets = getLastFetchedTweetsCache();

        if (cachedTweets) {
            // Use cached tweets
            allTweetsByUser = cachedTweets.tweets;
            logger.debug('Twitter debug: Using cached tweets from last fetch', {
                cacheAge: cachedTweets.cacheAge,
                userCount: Object.keys(allTweetsByUser).length,
                totalTweets: Object.values(allTweetsByUser).reduce(
                    (sum, tweets) => sum + tweets.length,
                    0
                ),
            });

            // Add notice that we're using cached data
            await message.reply(
                'Using cached tweets from the last run (within 15 minutes). This avoids hitting API rate limits.'
            );
        } else {
            // Need to fetch tweets for all accounts in one API call
            try {
                logger.debug('Twitter debug: No recent cached tweets, making new API call');
                await message.reply(
                    'Fetching new tweets from Twitter API (no recent cached data available)...'
                );
                allTweetsByUser = await fetchTweets(config.NEWS_MONITOR.TWITTER_ACCOUNTS);

                // Update cache
                updateLastFetchedTweetsCache(allTweetsByUser);

                logger.debug('Twitter debug: fetchTweets completed and cached', {
                    usersWithTweets: Object.keys(allTweetsByUser),
                    tweetCounts: Object.entries(allTweetsByUser).map(([username, tweets]) => ({
                        username,
                        count: tweets?.length || 0,
                    })),
                });
            } catch (error) {
                logger.error('Twitter debug: Error fetching tweets:', error);

                // If we have older cached data, try again with a higher cache age
                const olderCachedTweets = getLastFetchedTweetsCache(60); // Try with 60 minutes max age
                if (olderCachedTweets) {
                    allTweetsByUser = olderCachedTweets.tweets;
                    logger.debug(
                        `Twitter debug: Using older cached tweets (${olderCachedTweets.cacheAge}) as fallback`
                    );
                    await message.reply(
                        `Error fetching tweets: ${error.message}\nUsing older cached tweets (${olderCachedTweets.cacheAge}) as fallback.`
                    );
                } else {
                    await message.reply(
                        `Error fetching tweets: ${error.message}\nNo cached tweets available. Try again later.`
                    );
                    return;
                }
            }
        }

        // Show debug mode status and API info
        const isDebugMode = config.SYSTEM.CONSOLE_LOG_LEVELS.DEBUG === true;

        let debugInfo = `Twitter Monitor Debug Summary:
        - Debug Mode: ${isDebugMode ? 'Enabled' : 'Disabled'}
        - API Status:
        - Primary Key: ${usage.primary.usage}/${usage.primary.limit} ${
            usage.primary.status === '429'
                ? '(429 error)'
                : usage.primary.status === 'unchecked'
                ? '(unchecked)'
                : ''
        }
        - Fallback Key: ${usage.fallback.usage}/${usage.fallback.limit} ${
            usage.fallback.status === '429'
                ? '(429 error)'
                : usage.fallback.status === 'unchecked'
                ? '(unchecked)'
                : ''
        }
        - Fallback2 Key: ${usage.fallback2.usage}/${usage.fallback2.limit} ${
            usage.fallback2.status === '429'
                ? '(429 error)'
                : usage.fallback2.status === 'unchecked'
                ? '(unchecked)'
                : ''
        }
        - Currently Using: ${usage.currentKey} key
        - Status: ${config.NEWS_MONITOR.TWITTER_ENABLED ? 'Enabled' : 'Disabled'}
        - Running: ${twitterIntervalId !== null ? 'Yes' : 'No'}
        - Checking Interval: ${config.NEWS_MONITOR.TWITTER_CHECK_INTERVAL / 60000} minutes
        - Tweet Data: ${
            cachedTweets
                ? 'Using cached tweets from ' + new Date(cachedTweets.lastUpdated).toLocaleString()
                : 'Freshly fetched'
        }\n`;

        // Information for each account
        let accountInfos = [];
        let imagePromises = [];

        for (let i = 0; i < config.NEWS_MONITOR.TWITTER_ACCOUNTS.length; i++) {
            const account = config.NEWS_MONITOR.TWITTER_ACCOUNTS[i];
            const tweets = allTweetsByUser[account.username] || [];
            const tweetCount = tweets.length;

            let accountInfo = `\nACCOUNT ${i + 1}: @${account.username}`;
            let finalDecision = 'DO NOT SEND (default)';
            let groupMessage = 'No message would be sent.';

            if (tweetCount === 0) {
                accountInfo += `\n- Status: No tweets found for this account`;
                accountInfos.push(accountInfo);
                continue;
            }

            tweets.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
            const [latestTweet, ...previousTweets] = tweets;

            accountInfo += `\n- Last Tweet ID (in config): ${account.lastTweetId || 'Not set'}`;
            accountInfo += `\n- Latest Tweet ID (fetched): ${latestTweet.id}`;
            accountInfo += `\n- Tweet Creation: ${new Date(
                latestTweet.created_at
            ).toLocaleString()}`;
            accountInfo += `\n- Latest Tweet Text: "${latestTweet.text?.substring(0, 100)}${
                latestTweet.text?.length > 100 ? '...' : ''
            }"`;
            accountInfo += `\n- Would Process: ${
                latestTweet.id !== account.lastTweetId ? 'Yes' : 'No (Already Processed)'
            }`;

            if (latestTweet.id === account.lastTweetId && !args.includes('force')) {
                // Added force flag bypass
                finalDecision = "DO NOT SEND (Already Processed - use 'force' to re-evaluate)";
                accountInfo += `\n- Final Decision: ${finalDecision}`;
                accountInfo += `\n\nMessage that would be sent:\n${groupMessage}`;
                accountInfos.push(accountInfo);
                continue;
            }

            let mediaInfo = 'No media attached';
            // let hasMedia = false; // Not strictly needed if we just check photoMediaObj
            let photoMediaObj = null;

            if (latestTweet.mediaObjects && latestTweet.mediaObjects.length > 0) {
                photoMediaObj = latestTweet.mediaObjects.find(media => media.type === 'photo');
                if (photoMediaObj) {
                    // hasMedia = true;
                    mediaInfo = `Has Image: Yes (type: ${photoMediaObj.type}, URL: ${
                        photoMediaObj.url || photoMediaObj.preview_image_url
                    })`;
                } else {
                    mediaInfo = `Has Media: Yes (${latestTweet.mediaObjects
                        .map(m => m.type)
                        .join(', ')}, but no photos)`;
                }
            }
            accountInfo += `\n- Media: ${mediaInfo}`;

            //SITREP_artorias Specific Processing
            if (account.username === 'SITREP_artorias' && account.mediaOnly) {
                accountInfo += `\n- Account Type: Media Only (SITREP_artorias - Image to Text Flow)`;
                accountInfo += `\n- Account-Specific Prompt Config: ${
                    account.promptSpecific ? 'Yes' : 'No'
                }`;

                let passedAccountSpecific = false;
                if (account.promptSpecific) {
                    const sitrepPromptName = `${account.username}_PROMPT`;
                    passedAccountSpecific = await evaluateAccountSpecific(
                        latestTweet.text,
                        account.username
                    );
                    accountInfo += `\n- Account-Specific Evaluation (using ${sitrepPromptName}): ${
                        passedAccountSpecific ? 'PASSED' : 'FAILED'
                    }`;
                } else {
                    accountInfo += `\n- Account-Specific Evaluation: Skipped (promptSpecific is false in config)`;
                    passedAccountSpecific = false; // Crucial for SITREP, if not specific, it fails this path.
                }

                if (passedAccountSpecific && photoMediaObj) {
                    const imageTextExtractionPromptLabel = 'PROCESS_SITREP_IMAGE_PROMPT';
                    const imageTextExtractionPrompt =
                        config.NEWS_MONITOR.PROMPTS.PROCESS_SITREP_IMAGE_PROMPT;

                    if (!imageTextExtractionPrompt) {
                        accountInfo += `\n- Image Text Extraction: SKIPPED (${imageTextExtractionPromptLabel} not found in config)`;
                        finalDecision = 'DO NOT SEND (config error for image prompt)';
                    } else {
                        const imageUrl = photoMediaObj.url || photoMediaObj.preview_image_url;
                        accountInfo += `\n- Image Text Extraction: CALLING extractTextFromImageWithOpenAI with ${imageTextExtractionPromptLabel} for image: ${imageUrl}`;
                        try {
                            const actualExtractedText = await extractTextFromImageWithOpenAI(
                                imageUrl,
                                imageTextExtractionPrompt
                            );
                            accountInfo += `\n- Actual Extracted Text: \"${actualExtractedText}\"`;

                            if (
                                actualExtractedText &&
                                actualExtractedText.toLowerCase().trim() !==
                                    'nenhum texto relevante detectado na imagem.' &&
                                actualExtractedText.toLowerCase().trim() !==
                                    'nenhum texto detectado na imagem.'
                            ) {
                                const tweetLink = `https://twitter.com/${account.username}/status/${latestTweet.id}`;
                                groupMessage = `*Breaking News* 🗞️\n\n${actualExtractedText}\n\nFonte: @${account.username}\n${tweetLink}`;
                                finalDecision = 'SEND (processed text from image)';
                            } else {
                                accountInfo += `\n- Image Text Extraction Result: No relevant text detected by AI.`;
                                finalDecision = 'DO NOT SEND (no relevant text from image)';
                            }
                        } catch (error) {
                            logger.error(
                                `Debug: Error calling extractTextFromImageWithOpenAI for @${account.username} tweet ${latestTweet.id}:`,
                                error.message
                            );
                            accountInfo += `\n- Image Text Extraction: FAILED (${error.message})`;
                            finalDecision = 'DO NOT SEND (image extraction API error)';
                        }
                    }
                } else if (passedAccountSpecific && !photoMediaObj) {
                    accountInfo += `\n- Image Text Extraction: Skipped (no photo media found for SITREP_artorias).`;
                    finalDecision = 'DO NOT SEND (SITREP_artorias: no photo for image-to-text)';
                } else if (!passedAccountSpecific) {
                    finalDecision = `DO NOT SEND (SITREP_artorias: failed account-specific eval)`;
                } else {
                    finalDecision = `DO NOT SEND (SITREP_artorias: unknown condition, check logic)`; // Fallback
                }
            } else {
                // Existing logic for other mediaOnly or regular accounts
                accountInfo += `\n- Account Type: ${
                    account.mediaOnly ? 'Media Only (Standard Image Flow)' : 'Regular (Text Flow)'
                }`;
                accountInfo += `\n- Skip Evaluation Config: ${
                    account.skipEvaluation ? 'Yes' : 'No'
                }`;
                accountInfo += `\n- Account-Specific Prompt Config: ${
                    account.promptSpecific ? 'Yes' : 'No'
                }`;

                let accountSpecificPassed = true;
                if (account.promptSpecific) {
                    const specificPromptName = `${account.username}_PROMPT`;
                    accountSpecificPassed = await evaluateAccountSpecific(
                        latestTweet.text,
                        account.username
                    );
                    accountInfo += `\n- Account-Specific Evaluation (using ${specificPromptName}): ${
                        accountSpecificPassed ? 'PASSED' : 'FAILED'
                    }`;
                }

                let standardEvalResult = {
                    isRelevant: account.skipEvaluation,
                    justification: account.skipEvaluation
                        ? 'Evaluation skipped by config'
                        : 'Needs standard evaluation',
                };
                if (!account.skipEvaluation && accountSpecificPassed) {
                    const sourceType = account.mediaOnly ? 'twitter-media' : 'twitter';
                    standardEvalResult = await evaluateContent(
                        latestTweet.text,
                        previousTweets.map(t => t.text),
                        sourceType,
                        account.username,
                        true
                    );
                    accountInfo += `\n- Standard Evaluation: ${
                        standardEvalResult.isRelevant ? 'RELEVANT' : 'NOT RELEVANT'
                    }`;
                    accountInfo += `\n- Justification: ${
                        standardEvalResult.justification || 'No justification provided'
                    }`;
                } else if (account.skipEvaluation) {
                    accountInfo += `\n- Standard Evaluation: Skipped (as per config).`;
                } else if (!accountSpecificPassed) {
                    accountInfo += `\n- Standard Evaluation: Skipped (failed account-specific eval).`;
                }

                const overallRelevance = accountSpecificPassed && standardEvalResult.isRelevant;

                if (overallRelevance) {
                    if (account.mediaOnly && photoMediaObj) {
                        finalDecision = 'SEND (image + caption)';
                        let translatedText = latestTweet.text || '';
                        // translatedText = await require('../utils/newsUtils').translateToPortuguese(translatedText, 'en'); // Simulate for debug
                        groupMessage = `*Breaking News* 🗞️\n\n${
                            translatedText ? `${translatedText}\n\n` : ''
                        }Source: @${account.username}`;
                        groupMessage += `\n\n🔍 *Relevância:* ${
                            standardEvalResult.justification || 'N/A - Skipped or no justification'
                        }`;
                        groupMessage += `\n[With attached image: ${
                            photoMediaObj.url || photoMediaObj.preview_image_url
                        }]`;

                        if (args.includes('sendimage')) {
                            // Command to actually send debug image
                            try {
                                const imageUrl =
                                    photoMediaObj.url || photoMediaObj.preview_image_url;
                                const imagePromise = axios
                                    .get(imageUrl, { responseType: 'arraybuffer' })
                                    .then(response_1 => {
                                        const imageBuffer = Buffer.from(response_1.data);
                                        const media = new MessageMedia(
                                            'image/jpeg',
                                            imageBuffer.toString('base64')
                                        );
                                        return message.reply(media, {
                                            caption: `(Debug Image) For @${account.username} tweet: ${latestTweet.id}`,
                                        });
                                    })
                                    .catch(error => {
                                        logger.error(
                                            `Debug: Error downloading/sending image for @${account.username}:`,
                                            error.message
                                        );
                                        message.reply(
                                            `Debug: Failed to download/send image for @${account.username}: ${error.message}`
                                        );
                                    });
                                imagePromises.push(imagePromise);
                            } catch (error) {
                                accountInfo += `\n- Debug Image Send Error: ${error.message}`;
                            }
                        }
                    } else if (!account.mediaOnly) {
                        finalDecision = 'SEND (text only)';
                        let translatedText = latestTweet.text;
                        // translatedText = await require('../utils/newsUtils').translateToPortuguese(translatedText, 'en'); // Simulate for debug
                        groupMessage = `*Breaking News* 🗞️\n\n${translatedText}\n\nSource: @${account.username}`;
                        groupMessage += `\n\n🔍 *Relevância:* ${
                            standardEvalResult.justification || 'N/A'
                        }`;
                        if (photoMediaObj) {
                            // Text tweet that happens to have an image
                            groupMessage += `\n[Also has image: ${
                                photoMediaObj.url || photoMediaObj.preview_image_url
                            }]`;
                        }
                    } else {
                        // mediaOnly account but no photo, or some other edge case
                        finalDecision =
                            'DO NOT SEND (mediaOnly but no usable photo, or failed eval)';
                    }
                } else {
                    finalDecision = 'DO NOT SEND (failed evaluation or specific check)';
                }
            }

            accountInfo += `\n- Final Decision: ${finalDecision}`;
            accountInfo += `\n\nMessage that would be sent:\n${groupMessage}`;
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
async function debugRssFunctionality(message, feedToDebug = null) {
    // Added feedToDebug parameter
    try {
        const args = message.body.split(' ').slice(1);

        // Check for toggle commands (existing logic)
        if (
            args.length > 0 &&
            (args[0].toLowerCase() === 'on' || args[0].toLowerCase() === 'enable')
        ) {
            config.NEWS_MONITOR.RSS_ENABLED = true;
            await restartMonitors(false, true);
            await message.reply('RSS monitor has been enabled. Monitor has been restarted.');
            logger.info('RSS monitor enabled by admin command');
            return;
        } else if (
            args.length > 0 &&
            (args[0].toLowerCase() === 'off' || args[0].toLowerCase() === 'disable')
        ) {
            config.NEWS_MONITOR.RSS_ENABLED = false;
            if (rssIntervalId !== null) {
                clearInterval(rssIntervalId);
                rssIntervalId = null;
            }
            await message.reply('RSS monitor has been disabled. Monitor has been stopped.');
            logger.info('RSS monitor disabled by admin command');
            return;
        }
        // NOTE: 'list' command is handled in admin.js, debugRssFunctionality is called with specific feed or null.

        if (!config.NEWS_MONITOR.RSS_ENABLED && !feedToDebug) {
            // Allow debug even if main toggle is off if a specific feed is requested
            await message.reply(
                '⚠️ WARNING: RSS monitor is currently DISABLED. Debug info will still be shown for the specified feed. Use "!rssdebug on" to enable it for regular operation.'
            );
        } else if (!config.NEWS_MONITOR.RSS_ENABLED) {
            await message.reply(
                '⚠️ WARNING: RSS monitor is currently DISABLED. Debug info will still be shown. Use "!rssdebug on" to enable it.'
            );
        }

        const feedsToProcess = feedToDebug ? [feedToDebug] : config.NEWS_MONITOR.FEEDS;

        if (!feedsToProcess || feedsToProcess.length === 0) {
            await message.reply('No RSS feeds configured or specified for debugging.');
            return;
        }

        // Stats tracking for each step - will be aggregated
        const stats = {
            feedName: feedsToProcess.map(f => f.name).join(' & ') || 'N/A',
            fetchedCount: 0,
            lastIntervalCount: 0,
            notWhitelistedCount: 0,
            patternExcludedCount: 0,
            preliminaryExcludedCount: 0,
            duplicatesExcludedCount: 0,
            fullContentExcludedCount: 0,
            relevantCount: 0,
        };

        let allArticles = []; // Initialize array to hold all articles from all feeds

        try {
            // STEP 1: Fetch articles from all specified feeds
            for (const currentFeed of feedsToProcess) {
                logger.debug(`Fetching RSS feed: ${currentFeed.name} (${currentFeed.url})`);
                try {
                    const feedData = await parser.parseURL(currentFeed.url);
                    const items = feedData.items || [];
                    if (items.length > 0) {
                        // Add feed source to each article for context, if needed later
                        items.forEach(item => (item.sourceFeedName = currentFeed.name));
                        allArticles = allArticles.concat(items);
                    }
                    logger.debug(`Retrieved ${items.length} items from feed: ${currentFeed.name}`);
                } catch (fetchError) {
                    logger.error(`Error fetching feed ${currentFeed.name}: ${fetchError.message}`);
                    await message.reply(
                        `Error fetching feed "${currentFeed.name}": ${fetchError.message}`
                    );
                    // Continue to the next feed if one fails in a multi-feed debug
                }
            }
            stats.fetchedCount = allArticles.length;
            logger.debug(
                `Total ${stats.fetchedCount} articles fetched from ${feedsToProcess.length} feed(s) for debug process.`
            );

            if (allArticles.length === 0) {
                await message.reply(
                    'No articles found in the specified RSS feed(s) to process for debug.'
                );
                return;
            }

            // Temporarily reduce logging level for URL paths during detailed processing if needed
            const originalLogLevel = logger.level;
            if (
                logger.levels &&
                logger.level &&
                typeof logger.levels[logger.level] !== 'undefined' &&
                typeof logger.levels.DEBUG !== 'undefined' &&
                logger.levels[logger.level] <= logger.levels.DEBUG &&
                feedsToProcess.length > 1 // Only reduce if processing multiple feeds to avoid missing single feed debug details
            ) {
                // logger.level = 'info'; // Decided against changing log level here to keep debug consistent
            }

            // STEP 2: Filter by time (Applied to all fetched articles)
            const intervalMs = config.NEWS_MONITOR.RSS_CHECK_INTERVAL;
            const cutoffTime = new Date(Date.now() - intervalMs);
            let articlesFromLastCheckInterval = [];
            for (const article of allArticles) {
                const pubDate = article.pubDate || article.isoDate;
                if (!pubDate) {
                    articlesFromLastCheckInterval.push(article);
                    continue;
                }
                const articleDate = new Date(pubDate);
                if (isNaN(articleDate) || articleDate > new Date() || articleDate >= cutoffTime) {
                    articlesFromLastCheckInterval.push(article);
                }
            }
            stats.lastIntervalCount = articlesFromLastCheckInterval.length;
            logger.debug(
                `Found ${stats.lastIntervalCount} articles from the last ${
                    intervalMs / 60000
                } minutes across all feeds`
            );

            // STEP 3: Filter by whitelist paths
            let whitelistedArticles = [];
            let notWhitelistedArticles = [];
            for (const article of articlesFromLastCheckInterval) {
                if (shouldExcludeByWhitelist(article.link)) {
                    let pathPreview = '';
                    try {
                        const urlObj = new URL(article.link);
                        const fullPath = urlObj.pathname;
                        const pathSegments = fullPath
                            .split('/')
                            .filter(segment => segment.length > 0);
                        pathPreview =
                            pathSegments.length > 0
                                ? `/${pathSegments
                                      .slice(0, Math.min(3, pathSegments.length))
                                      .join('/')}`
                                : fullPath;
                        article.pathPreview = pathPreview;
                    } catch (e) {
                        article.pathPreview = '(invalid URL)';
                    }
                    notWhitelistedArticles.push(article);
                } else {
                    whitelistedArticles.push(article);
                }
            }
            stats.notWhitelistedCount = notWhitelistedArticles.length;
            const notWhitelistedTitles = notWhitelistedArticles
                .map(
                    article =>
                        `"${
                            article.title?.substring(0, 90) +
                            (article.title?.length > 90 ? '...' : '')
                        }" - Path not in whitelist (${
                            article.pathPreview || '(unknown path)'
                        }) - Source: ${article.sourceFeedName || feed.name}`
                )
                .join('\n');
            if (notWhitelistedArticles.length > 0) {
                logger.debug(
                    `Articles excluded by whitelist filter (${notWhitelistedArticles.length}):\n${notWhitelistedTitles}`
                );
            } else {
                logger.debug(
                    `Filtered ${notWhitelistedArticles.length} articles not in whitelist paths out of ${articlesFromLastCheckInterval.length} total`
                );
            }

            // STEP 4: Filter articles with low-quality title patterns
            const titlePatterns = config.NEWS_MONITOR.CONTENT_FILTERING.TITLE_PATTERNS || [];
            let filteredByTitleArticles = [];
            let excludedByTitleArticles = [];
            for (const article of whitelistedArticles) {
                const matchingPattern = titlePatterns.find(
                    pattern => article.title && article.title.includes(pattern)
                );
                if (matchingPattern) {
                    excludedByTitleArticles.push({ article, pattern: matchingPattern });
                } else {
                    filteredByTitleArticles.push(article);
                }
            }
            stats.patternExcludedCount = excludedByTitleArticles.length;
            if (excludedByTitleArticles.length > 0) {
                const excludedTitles = excludedByTitleArticles
                    .map(
                        (item, index) =>
                            `  ${index + 1}. "${
                                item.article.title?.substring(0, 90) +
                                (item.article.title?.length > 90 ? '...' : '')
                            }" - Matched pattern: "${item.pattern}" - Source: ${
                                item.article.sourceFeedName || feed.name
                            }`
                    )
                    .join('\n');
                logger.debug(
                    `Articles excluded by title pattern filter (${excludedByTitleArticles.length}):\n${excludedTitles}`
                );
            } else {
                logger.debug(
                    `Title pattern filter: No articles excluded (0/${whitelistedArticles.length})`
                );
            }

            filteredByTitleArticles.forEach(article => {
                article.feedId = article.sourceFeedName || feed.id;
            });

            // STEP 5: Preliminary relevance assessment (Batch title evaluation)
            let relevantArticles = [];
            let irrelevantArticles = [];
            if (filteredByTitleArticles.length > 0) {
                const fullTitles = filteredByTitleArticles.map(article => article.title);
                // logger.level = originalLogLevel; // Restore log level if changed earlier
                try {
                    const titleRelevanceResults = await batchEvaluateArticleTitles(fullTitles);
                    filteredByTitleArticles.forEach((article, index) => {
                        if (titleRelevanceResults[index]) relevantArticles.push(article);
                        else irrelevantArticles.push(article);
                    });
                } catch (error) {
                    logger.error('Error in preliminary relevance assessment:', error);
                    relevantArticles = [...filteredByTitleArticles]; // Keep all if eval fails
                }
            }
            stats.preliminaryExcludedCount = irrelevantArticles.length;
            if (irrelevantArticles.length > 0) {
                const excludedTitles = irrelevantArticles
                    .map(
                        (article, index) =>
                            `  ${index + 1}. "${
                                article.title?.substring(0, 90) +
                                (article.title?.length > 90 ? '...' : '')
                            }" - Not relevant by title evaluation - Source: ${
                                article.sourceFeedName || feed.name
                            }`
                    )
                    .join('\n');
                logger.debug(
                    `Articles excluded by preliminary relevance (${irrelevantArticles.length}):\n${excludedTitles}`
                );
            } else if (filteredByTitleArticles.length > 0) {
                logger.debug(
                    `Preliminary relevance filter: No articles excluded (0/${filteredByTitleArticles.length})`
                );
            } else {
                logger.debug(`Preliminary relevance filter: No articles to evaluate (0/0)`);
            }

            // STEP 6: Filter similar articles (Duplicate Detection)
            const sortedByDateRelevantArticles = [...relevantArticles].sort(
                (a, b) =>
                    new Date(a.pubDate || a.isoDate || 0) - new Date(b.pubDate || b.isoDate || 0)
            );
            let dedupedArticles = [];
            const processedForDupCheck = [];
            let duplicateExclusionLog = [];
            const previouslyCachedArticles = getRecentItems(20)
                .filter(item => item.type === 'article')
                .map(item => ({ title: item.content, link: item.id }));
            if (previouslyCachedArticles.length > 0)
                logger.debug(
                    `Including ${previouslyCachedArticles.length} previously cached articles for duplicate detection`
                );

            for (const article of sortedByDateRelevantArticles) {
                if (!article.title) {
                    dedupedArticles.push(article);
                    processedForDupCheck.push(article);
                    continue;
                }
                const articlesToCompareAgainst = [
                    ...previouslyCachedArticles,
                    ...processedForDupCheck,
                ];
                const duplicateResult = await detectDuplicateWithPrompt(
                    article,
                    articlesToCompareAgainst,
                    'rss'
                );
                if (duplicateResult.isDuplicate) {
                    const matchedArticleIndex =
                        parseInt(duplicateResult.duplicateId) - 1 - previouslyCachedArticles.length;
                    const matchedArticle =
                        matchedArticleIndex >= 0 &&
                        matchedArticleIndex < processedForDupCheck.length
                            ? processedForDupCheck[matchedArticleIndex]
                            : null;
                    duplicateExclusionLog.push(
                        `  - "${article.title?.substring(0, 70)}..." (Source: ${
                            article.sourceFeedName || 'N/A'
                        }) was a duplicate of "${
                            matchedArticle?.title?.substring(0, 50) ||
                            duplicateResult.duplicateId ||
                            'N/A'
                        }..." (Reason: ${duplicateResult.justification || 'N/A'})`
                    );
                } else {
                    dedupedArticles.push(article);
                    processedForDupCheck.push(article);
                }
            }
            stats.duplicatesExcludedCount =
                sortedByDateRelevantArticles.length - dedupedArticles.length;
            if (duplicateExclusionLog.length > 0) {
                logger.debug(
                    `Articles excluded as duplicates (${
                        stats.duplicatesExcludedCount
                    }):\n${duplicateExclusionLog.join('\n')}`
                );
            } else {
                logger.debug(
                    `Duplicate detection filter: No duplicates found (0/${sortedByDateRelevantArticles.length})`
                );
            }

            // STEP 7: Evaluate full content of each remaining article
            let finalRelevantArticles = [];
            let notRelevantFullContent = [];
            if (dedupedArticles.length > 0) {
                for (const article of dedupedArticles) {
                    const articleContent = extractArticleContent(article);
                    const evalResult = await evaluateContent(
                        `Título: ${article.title}\n\n${articleContent}`,
                        'rss',
                        '',
                        true
                    );
                    if (evalResult.isRelevant) {
                        let shortJustification = evalResult.justification;
                        if (shortJustification && shortJustification.length > 40) {
                            if (shortJustification.includes('notícia global'))
                                shortJustification = 'Notícia global crítica';
                            else if (
                                shortJustification.includes('Brasil') ||
                                shortJustification.includes('brasileiro')
                            )
                                shortJustification = 'Relevante para o Brasil';
                            else if (shortJustification.includes('São Paulo'))
                                shortJustification = 'Relevante para São Paulo';
                            else if (shortJustification.includes('científic'))
                                shortJustification = 'Descoberta científica importante';
                            else if (shortJustification.includes('esport'))
                                shortJustification = 'Evento esportivo significativo';
                            else if (
                                shortJustification.includes('escândalo') ||
                                shortJustification.includes('polític')
                            )
                                shortJustification = 'Escândalo político/econômico';
                            else if (shortJustification.includes('impacto global'))
                                shortJustification = 'Grande impacto global';
                            else shortJustification = shortJustification.substring(0, 40) + '...';
                        }
                        article.relevanceJustification = shortJustification;
                        finalRelevantArticles.push(article);
                    } else {
                        notRelevantFullContent.push({
                            title: article.title,
                            reason: evalResult.justification || 'Not relevant',
                            sourceFeed: article.sourceFeedName || feed.name,
                        });
                    }
                }
            }
            stats.fullContentExcludedCount = notRelevantFullContent.length;
            stats.relevantCount = finalRelevantArticles.length;
            if (notRelevantFullContent.length > 0) {
                const excludedTitles = notRelevantFullContent
                    .map(
                        (item, index) =>
                            `  ${index + 1}. "${
                                item.title?.substring(0, 90) +
                                (item.title?.length > 90 ? '...' : '')
                            }" (Source: ${item.sourceFeed}) - Reason: ${item.reason}`
                    )
                    .join('\n');
                logger.debug(
                    `Articles excluded by full content evaluation (${notRelevantFullContent.length}):\n${excludedTitles}`
                );
            } else if (dedupedArticles.length > 0) {
                logger.debug(
                    `Full content evaluation filter: No articles excluded (0/${dedupedArticles.length})`
                );
            } else {
                logger.debug(`Full content evaluation filter: No articles to evaluate (0/0)`);
            }

            logger.debug(
                `Final relevant articles: ${finalRelevantArticles.length}/${stats.fetchedCount} total fetched`
            );
            if (finalRelevantArticles.length > 0) {
                const relevantTitlesToLog = finalRelevantArticles
                    .map(
                        (article, index) =>
                            `  ${index + 1}. "${
                                article.title?.substring(0, 90) +
                                (article.title?.length > 90 ? '...' : '')
                            }" (Source: ${article.sourceFeedName || feed.name}) - Justification: ${
                                article.relevanceJustification || 'Relevante'
                            }`
                    )
                    .join('\n');
                logger.debug(
                    `Articles that passed all filters and will be sent:\n${relevantTitlesToLog}`
                );
            }

            // Format messages for all relevant articles for the debug output
            const formattedExamples = [];
            if (finalRelevantArticles.length > 0) {
                for (const article of finalRelevantArticles) {
                    try {
                        let articleTitle = article.title;
                        // Translation is based on original feed language, which is complex here if feedsToProcess > 1
                        // For debug, we'll assume original title is fine or use feed's primary language if single feed
                        if (feedsToProcess.length === 1 && feedsToProcess[0].language !== 'pt') {
                            articleTitle = await translateToPortuguese(
                                article.title,
                                feedsToProcess[0].language
                            );
                        }
                        const articleContent = extractArticleContent(article);
                        const summary = await generateSummary(article.title, articleContent);
                        const justification = article.relevanceJustification || 'Sem justificativa';
                        const messageContent = `*Breaking News* 🗞️\n\n*${articleTitle}*\n\n${summary}\n\n🔍 *Justificativa:* ${justification}\n\nFonte: ${
                            article.sourceFeedName || stats.feedName
                        }\n${article.link}`;
                        formattedExamples.push(messageContent);
                    } catch (error) {
                        logger.error(
                            `Error formatting article "${article.title}" for debug: ${error.message}`
                        );
                        formattedExamples.push(
                            `*${article.title}*\n[Error formatting for debug: ${error.message}]`
                        );
                    }
                }
            }

            const currentTime = new Date();
            const isInQuietHour = isQuietHour();
            const quietHoursStart = config.NEWS_MONITOR.QUIET_HOURS?.START_HOUR || 22;
            const quietHoursEnd = config.NEWS_MONITOR.QUIET_HOURS?.END_HOUR || 8;
            const quietHoursPeriod = `${quietHoursStart}:00-${quietHoursEnd}:00`;
            const checkIntervalMinutes = config.NEWS_MONITOR.RSS_CHECK_INTERVAL / 60000;

            const debugResponseLines = [
                `*RSS Monitor Debug Report* (Generated at ${currentTime.toLocaleString()})`,
                ``,
                `- Feeds Processed: ${stats.feedName}`,
                `- RSS monitor enabled: ${config.NEWS_MONITOR.RSS_ENABLED ? 'Yes' : 'No'}`,
                `- Check interval: ${checkIntervalMinutes} minutes`,
                `- Quiet hours: ${
                    config.NEWS_MONITOR.QUIET_HOURS?.ENABLED ? 'Enabled' : 'Disabled'
                }`,
                `- Quiet hours times: ${quietHoursPeriod} (${
                    config.NEWS_MONITOR.QUIET_HOURS?.TIMEZONE || 'UTC'
                })`,
                `- Currently in quiet hours: ${isInQuietHour ? 'Yes' : 'No'}`,
                `- Whitelist paths: ${
                    config.NEWS_MONITOR.CONTENT_FILTERING.WHITELIST_PATHS?.join(', ') ||
                    'None configured'
                }`,
                `- AI Model Configuration:`,
                `• Evaluation: ${config.NEWS_MONITOR.AI_MODELS?.EVALUATE_CONTENT || 'Default'}`,
                `• Summary: ${config.NEWS_MONITOR.AI_MODELS?.SUMMARIZE_CONTENT || 'Default'}`,
                `• Batch Title: ${
                    config.NEWS_MONITOR.AI_MODELS?.BATCH_EVALUATE_TITLES || 'Default'
                }`,
                `• Duplicate Detection: ${
                    config.NEWS_MONITOR.AI_MODELS?.DETECT_DUPLICATE || 'Default'
                }`,
                ``,
                `*Article Filtering Steps (Applied to ${stats.fetchedCount} fetched articles from all feeds):*`,
                `- Articles from last interval: ${stats.lastIntervalCount}`,
                `- Not in whitelist: ${stats.notWhitelistedCount} (${Math.round(
                    (stats.notWhitelistedCount / stats.lastIntervalCount || 0) * 100
                )}%)`,
                `- Pattern excluded: ${stats.patternExcludedCount} (${Math.round(
                    (stats.patternExcludedCount / whitelistedArticles.length || 0) * 100
                )}%)`,
                `- Preliminary excluded (title eval): ${
                    stats.preliminaryExcludedCount
                } (${Math.round(
                    (stats.preliminaryExcludedCount / filteredByTitleArticles.length || 0) * 100
                )}%)`,
                `- Duplicates excluded: ${stats.duplicatesExcludedCount} (${Math.round(
                    (stats.duplicatesExcludedCount / relevantArticles.length || 0) * 100
                )}%)`,
                `- Full content excluded: ${stats.fullContentExcludedCount} (${Math.round(
                    (stats.fullContentExcludedCount / dedupedArticles.length || 0) * 100
                )}%)`,
                `- Final relevant count: ${stats.relevantCount}`,
                ``,
                `*Filter Flow Summary:*`,
                `${stats.fetchedCount} fetched → ${stats.lastIntervalCount} in interval → ${whitelistedArticles.length} passed whitelist → ${filteredByTitleArticles.length} passed pattern → ${relevantArticles.length} passed prelim relevance → ${dedupedArticles.length} passed duplicate detection → ${finalRelevantArticles.length} final relevant`,
                ``,
                finalRelevantArticles.length > 0
                    ? `*Messages that would be sent (${
                          finalRelevantArticles.length
                      }):*\n\n${formattedExamples.join('\n\n---\n\n')}`
                    : `*No relevant articles found to display based on current filters & debug run.*`,
            ];
            const debugResponse = debugResponseLines.join('\n');
            await message.reply(debugResponse);

            if (logger.level === 'info' && feedsToProcess.length > 1) {
                // logger.level = originalLogLevel; // Restore log level if it was changed
            }
        } catch (error) {
            logger.error(`Error processing feed(s) for debug: ${error.message}`, error);
            await message.reply(`Error processing feed(s) for debug: ${error.message}`);
            // Restore logging level in case of error too
            // if (logger.level === 'info' && feedsToProcess.length > 1) logger.level = originalLogLevel;
        }
    } catch (error) {
        logger.error('Error in RSS debug command execution:', error);
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
    const justification = article.relevanceJustification || article.justification || '';

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
                minute: '2-digit',
            });
        }
    }

    // Build the formatted message without the placeholder text
    // Only include relevance section if we have an actual justification
    const relevanceSection =
        justification && justification.trim() !== '' ? `🔍 *Relevância:* ${justification}\n\n` : '';

    return `📰 *${title}*\n\n${dateStr ? `🕒 ${dateStr}\n\n` : ''}${relevanceSection}🔗 ${link}`;
}

/**
 * Status command to check current news monitor status
 */
async function newsMonitorStatus(message) {
    try {
        const isDebugMode = config.SYSTEM.CONSOLE_LOG_LEVELS?.DEBUG || false;
        const currentlyInQuietHours = isQuietHour();

        // Get Twitter API status
        let twitterApiStatus = 'Not checked';
        try {
            const usage = await checkTwitterAPIUsage();
            twitterApiStatus = formatTwitterApiUsage(
                {
                    primary: usage.primary,
                    fallback: usage.fallback,
                    fallback2: usage.fallback2,
                },
                usage.resetTimes,
                usage.currentKey
            );
        } catch (error) {
            twitterApiStatus = `Error checking API status: ${error.message}`;
        }

        // Get twitter accounts info
        let twitterAccountsInfo = '';
        if (config.NEWS_MONITOR.TWITTER_ACCOUNTS.length > 0) {
            twitterAccountsInfo = config.NEWS_MONITOR.TWITTER_ACCOUNTS.map(
                account => `        - @${account.username}`
            ).join('\n');
        } else {
            twitterAccountsInfo = '        (none configured)';
        }

        // Get persistent cache stats
        const cacheStats = getCacheStats();

        const statusInfo = `News Monitor Status:
        - Master Toggle: ${config.NEWS_MONITOR.enabled ? 'Enabled' : 'Disabled'}
        - Debug Mode: ${isDebugMode ? 'Enabled' : 'Disabled'}
        - Target Group: ${config.NEWS_MONITOR.TARGET_GROUP}
        - Quiet Hours: ${config.NEWS_MONITOR.QUIET_HOURS?.ENABLED ? 'Enabled' : 'Disabled'}
        - Quiet Hours Period: ${config.NEWS_MONITOR.QUIET_HOURS?.START_HOUR}:00 to ${
            config.NEWS_MONITOR.QUIET_HOURS?.END_HOUR
        }:00 (${config.NEWS_MONITOR.QUIET_HOURS?.TIMEZONE || 'UTC'})
        - Currently in Quiet Hours: ${currentlyInQuietHours ? 'Yes' : 'No'}
        - Persistent Cache: ${cacheStats.totalItems} items (${cacheStats.articleCount} articles, ${
            cacheStats.tweetCount
        } tweets)

        RSS Monitor:
        - Status: ${config.NEWS_MONITOR.RSS_ENABLED ? 'Enabled' : 'Disabled'}
        - Running: ${rssIntervalId !== null ? 'Yes' : 'No'}
        - Check Interval: ${config.NEWS_MONITOR.RSS_CHECK_INTERVAL / 60000} minutes (${
            config.NEWS_MONITOR.RSS_CHECK_INTERVAL / 3600000
        } hours)
        - Feed Count: ${config.NEWS_MONITOR.FEEDS?.length || 0}

        Twitter Monitor:
        - Status: ${config.NEWS_MONITOR.TWITTER_ENABLED ? 'Enabled' : 'Disabled'}
        - Running: ${twitterIntervalId !== null ? 'Yes' : 'No'}
        - Check Interval: ${config.NEWS_MONITOR.TWITTER_CHECK_INTERVAL / 60000} minutes
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
        // Initialize all variables that will be used
        let allArticles = [];
        let articlesFromLastCheckInterval = [];
        let whitelistedArticles = [];
        let notWhitelistedArticles = [];
        let filteredByTitleArticles = [];
        let excludedByTitleArticles = [];
        let notRecentlySentArticles = [];
        let recentlySentArticles = [];
        let dedupedArticles = [];
        let relevantArticles = [];
        let irrelevantArticles = [];
        let finalRelevantArticles = [];
        let notRelevantFullContent = [];
        let stats = {
            notWhitelistedCount: 0,
            patternExcludedCount: 0,
            historicalExcludedCount: 0,
            duplicatesExcludedCount: 0,
            preliminaryExcludedCount: 0,
            fullContentExcludedCount: 0,
            relevantCount: 0,
        };

        // STEP 1: Fetch articles - make sure each operation completes before moving to the next
        logger.debug(`Fetching RSS feed: ${feed.name} (${feed.url})`);

        const feedData = await parser.parseURL(feed.url);
        allArticles = feedData.items || [];

        // Log immediately after fetching
        logger.debug(`Retrieved ${allArticles.length} items from feed: ${feed.name}`);

        // Early exit if no articles
        if (allArticles.length === 0) {
            logger.debug(`No items found in feed: ${feed.name}`);
            return [];
        }

        // STEP 2: Filter by time - purely synchronous operation
        // Sort by date first (newest first)
        allArticles.sort(
            (a, b) => new Date(b.pubDate || b.isoDate) - new Date(a.pubDate || a.isoDate)
        );

        const intervalMs = config.NEWS_MONITOR.RSS_CHECK_INTERVAL;
        const cutoffTime = new Date(Date.now() - intervalMs);

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

        // Log time filter results BEFORE moving to next step
        logger.debug(
            `Found ${articlesFromLastCheckInterval.length} articles from the last ${
                intervalMs / 60000
            } minutes`
        );

        // Early exit if no articles from check interval
        if (articlesFromLastCheckInterval.length === 0) {
            logger.debug(`No new articles in the last check interval for feed: ${feed.name}`);
            return [];
        }

        // STEP 3: Filter by whitelist paths
        for (const article of articlesFromLastCheckInterval) {
            if (shouldExcludeByWhitelist(article.link)) {
                // Extract path for logging
                let pathPreview = '';
                try {
                    const urlObj = new URL(article.link);
                    const fullPath = urlObj.pathname;
                    const pathSegments = fullPath.split('/').filter(segment => segment.length > 0);
                    pathPreview =
                        pathSegments.length > 0
                            ? `/${pathSegments
                                  .slice(0, Math.min(3, pathSegments.length))
                                  .join('/')}`
                            : fullPath;
                    // Add path preview to the article object
                    article.pathPreview = pathPreview;
                } catch (e) {
                    article.pathPreview = '(invalid URL)';
                }

                notWhitelistedArticles.push(article);
            } else {
                whitelistedArticles.push(article);
            }
        }

        // Update stats
        stats.notWhitelistedCount = notWhitelistedArticles.length;

        // Format excluded titles for logging
        const notWhitelistedTitles = notWhitelistedArticles
            .map(
                article =>
                    `"${
                        article.title?.substring(0, 90) + (article.title?.length > 90 ? '...' : '')
                    }" - Path not in whitelist (${article.pathPreview || '(unknown path)'})`
            )
            .join('\n');

        // Log filtered whitelist results
        if (notWhitelistedArticles.length > 0) {
            // Log the count message with titles
            logger.debug(
                `Articles excluded by whitelist filter (${notWhitelistedArticles.length}):\n${notWhitelistedTitles}`
            );
        } else {
            logger.debug(
                `Filtered ${notWhitelistedArticles.length} articles not in whitelist paths out of ${articlesFromLastCheckInterval.length} total`
            );
        }

        // Continue processing if we have whitelisted articles
        if (whitelistedArticles.length > 0) {
            // STEP 4: Filter articles with low-quality title patterns
            const titlePatterns = config.NEWS_MONITOR.CONTENT_FILTERING.TITLE_PATTERNS || [];

            // Check each article against title patterns
            for (const article of whitelistedArticles) {
                // Check if the title matches any of the patterns to filter
                const matchesPattern = titlePatterns.some(
                    pattern => article.title && article.title.includes(pattern)
                );

                if (matchesPattern) {
                    excludedByTitleArticles.push(article);
                } else {
                    filteredByTitleArticles.push(article);
                }
            }

            // Update stats
            stats.patternExcludedCount = excludedByTitleArticles.length;

            // Format excluded titles for logging
            const excludedTitlePatterns = excludedByTitleArticles
                .map(
                    article =>
                        `"${
                            article.title?.substring(0, 90) +
                            (article.title?.length > 90 ? '...' : '')
                        }"`
                )
                .join('\n');

            // Log filtered title pattern results
            if (excludedByTitleArticles.length > 0) {
                // Log the count message with titles
                logger.debug(
                    `Filtered ${excludedByTitleArticles.length} articles with excluded title patterns out of ${whitelistedArticles.length} total\n${excludedTitlePatterns}`
                );
            } else {
                logger.debug(
                    `Filtered ${excludedByTitleArticles.length} articles with excluded title patterns out of ${whitelistedArticles.length} total`
                );
            }
        }

        // Continue processing if articles passed title filtering
        if (filteredByTitleArticles.length > 0) {
            // STEP 5: Filter out articles similar to ones recently sent
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

            // Update stats
            stats.historicalExcludedCount = recentlySentArticles.length;

            // Format recently sent article titles for logging
            const recentlySentTitles = recentlySentArticles
                .map(
                    article =>
                        `"${
                            article.title?.substring(0, 90) +
                            (article.title?.length > 90 ? '...' : '')
                        }"`
                )
                .join('\n');

            // Log filtered recently sent results
            if (recentlySentArticles.length > 0) {
                // Log the count message with titles
                logger.debug(
                    `Filtered ${recentlySentArticles.length} articles similar to recently sent ones\n${recentlySentTitles}`
                );
            } else {
                logger.debug(
                    `Filtered ${recentlySentArticles.length} articles similar to recently sent ones`
                );
            }
        }

        // Continue processing the remaining articles
        if (notRecentlySentArticles.length > 0) {
            // Continue with preliminary relevance assessment
            // STEP 6: Preliminary relevance assessment (moved before duplicate detection)
            const fullTitles = notRecentlySentArticles.map(article => article.title);

            try {
                // Perform the batch evaluation
                const titleRelevanceResults = await batchEvaluateArticleTitles(fullTitles);

                // Find articles with relevant titles
                notRecentlySentArticles.forEach((article, index) => {
                    if (titleRelevanceResults[index]) {
                        relevantArticles.push(article);
                    } else {
                        irrelevantArticles.push(article);
                    }
                });

                // Update stats
                stats.preliminaryExcludedCount = irrelevantArticles.length;

                // Log results of preliminary relevance assessment
                if (irrelevantArticles.length > 0) {
                    const irrelevantTitles = irrelevantArticles
                        .map(
                            article =>
                                `"${
                                    article.title?.substring(0, 90) +
                                    (article.title?.length > 90 ? '...' : '')
                                }"`
                        )
                        .join('\n');
                    logger.debug(
                        `Filtered out ${irrelevantArticles.length} out of ${notRecentlySentArticles.length} irrelevant titles:\n${irrelevantTitles}`
                    );
                }

                // Log relevant titles
                if (relevantArticles.length > 0) {
                    const relevantTitles = relevantArticles
                        .map(
                            article =>
                                `"${
                                    article.title?.substring(0, 90) +
                                    (article.title?.length > 90 ? '...' : '')
                                }"`
                        )
                        .join('\n');
                    logger.debug(
                        `Found ${relevantArticles.length} articles with relevant titles:\n${relevantTitles}`
                    );
                } else {
                    logger.debug(`No articles were found to have relevant titles.`);
                }
            } catch (error) {
                logger.error('Error in preliminary relevance assessment:', error);
                // If evaluation fails, keep all articles for duplicate detection
                relevantArticles = notRecentlySentArticles;
                stats.preliminaryExcludedCount = 0;
            }

            // STEP 7: Filter similar articles within the relevant articles using prompt-based duplicate detection
            // Only run duplicate detection if we have relevant articles to process
            if (relevantArticles.length > 0) {
                const sortedByDateArticles = [...relevantArticles].sort((a, b) => {
                    const dateA = new Date(a.pubDate || a.isoDate || 0);
                    const dateB = new Date(b.pubDate || b.isoDate || 0);
                    return dateA - dateB; // Oldest first
                });

                const duplicateGroups = []; // For tracking which articles were kept vs removed
                const processedArticles = []; // Articles we've already decided to keep

                dedupedArticles = [];
                let allDuplicateInfo = []; // Collect all duplicate info for a single log

                // Debug to show which articles are being processed for duplicate detection
                logger.debug(
                    `Processing ${sortedByDateArticles.length} articles for duplicate detection:`
                );
                sortedByDateArticles.forEach((article, idx) => {
                    logger.debug(
                        `  ${idx + 1}. "${article.title?.substring(0, 70)}${
                            article.title?.length > 70 ? '...' : ''
                        }"`
                    );
                });

                // Get previously cached articles for duplicate detection
                const previouslyCachedArticles = getRecentItems(20)
                    .filter(item => item.type === 'article')
                    .map(item => ({
                        title: item.content,
                        link: item.id,
                    }));

                if (previouslyCachedArticles.length > 0) {
                    logger.debug(
                        `Including ${previouslyCachedArticles.length} previously cached articles for duplicate detection`
                    );
                }

                for (const article of sortedByDateArticles) {
                    if (!article.title) {
                        dedupedArticles.push(article);
                        processedArticles.push(article);
                        continue;
                    }

                    // Use the prompt-based duplicate detection with previously cached articles
                    // Combine both processedArticles (articles from current batch) and previouslyCachedArticles
                    const articlesToCompare = [...previouslyCachedArticles, ...processedArticles];
                    const duplicateResult = await detectDuplicateWithPrompt(
                        article,
                        articlesToCompare,
                        'rss'
                    );

                    if (duplicateResult.isDuplicate) {
                        // Article is a duplicate
                        const duplicateIdx = parseInt(duplicateResult.duplicateId) - 1;
                        let groupIndex = -1;

                        // Find which group the duplicate belongs to
                        if (
                            !isNaN(duplicateIdx) &&
                            duplicateIdx >= 0 &&
                            duplicateIdx < processedArticles.length
                        ) {
                            const originalArticle = processedArticles[duplicateIdx];
                            // Find the group index for this original article
                            for (let i = 0; i < duplicateGroups.length; i++) {
                                if (duplicateGroups[i].kept.title === originalArticle.title) {
                                    groupIndex = i;
                                    break;
                                }
                            }
                        }

                        if (groupIndex === -1) {
                            // Fallback if we couldn't find the group
                            groupIndex = 0;
                        }

                        // Add to existing duplicate group for logging
                        duplicateGroups[groupIndex].duplicates.push({
                            title: article.title,
                            date: article.pubDate || article.isoDate,
                            similarity: 0.9, // Estimated similarity
                            justification: duplicateResult.justification,
                        });

                        // Collect info for consolidated log
                        const truncatedTitle =
                            article.title?.substring(0, 90) +
                            (article.title?.length > 90 ? '...' : '');
                        const matchedArticle = processedArticles[duplicateIdx];
                        const truncatedMatchTitle = matchedArticle?.title?.substring(0, 50) + '...';
                        allDuplicateInfo.push(
                            `  ${
                                allDuplicateInfo.length + 1
                            }. "${truncatedTitle}" - Similar to "${truncatedMatchTitle}" - ${
                                duplicateResult.justification || 'Duplicate content'
                            }`
                        );
                    } else {
                        // Article is unique
                        dedupedArticles.push(article);
                        processedArticles.push(article);

                        // Create a new group for this article
                        duplicateGroups.push({
                            kept: {
                                title: article.title,
                                date: article.pubDate || article.isoDate,
                            },
                            duplicates: [],
                        });
                    }
                }

                // After deduplication is complete, log all duplicates at once
                if (allDuplicateInfo.length > 0) {
                    logger.debug(
                        `Articles excluded as duplicates (${
                            allDuplicateInfo.length
                        }):\n${allDuplicateInfo.join('\n')}`
                    );
                } else {
                    logger.debug(
                        `Duplicate detection filter: No duplicates found (0/${sortedByDateArticles.length})`
                    );
                }

                stats.duplicatesExcludedCount =
                    sortedByDateArticles.length - dedupedArticles.length;

                // Log duplicate filtering results - enhanced with groups
                const duplicateCount = duplicateGroups.reduce(
                    (count, group) => count + group.duplicates.length,
                    0
                );

                stats.duplicatesExcludedCount = duplicateCount;

                if (duplicateCount > 0) {
                    // Create a detailed log of duplicate groups
                    let duplicateLog = `Filtered out ${duplicateCount} of ${sortedByDateArticles.length} duplicate articles:\n`;

                    // Only show groups that have duplicates
                    const groupsWithDuplicates = duplicateGroups.filter(
                        group => group.duplicates.length > 0
                    );

                    groupsWithDuplicates.forEach((group, index) => {
                        // Format date for better readability
                        const keptDate = new Date(group.kept.date);
                        const formattedKeptDate = isNaN(keptDate)
                            ? 'Unknown date'
                            : keptDate.toISOString().replace('T', ' ').substring(0, 19);

                        // Truncate title to 90 chars for logging
                        const keptTitle =
                            group.kept.title?.substring(0, 90) +
                            (group.kept.title?.length > 90 ? '...' : '');
                        duplicateLog += `KEPT: "${keptTitle}" (${formattedKeptDate})\n`;

                        // Sort duplicates by similarity (highest first)
                        const sortedDuplicates = [...group.duplicates].sort(
                            (a, b) => b.similarity - a.similarity
                        );

                        sortedDuplicates.forEach(dup => {
                            const dupDate = new Date(dup.date);
                            const formattedDupDate = isNaN(dupDate)
                                ? 'Unknown date'
                                : dupDate.toISOString().replace('T', ' ').substring(0, 19);

                            // Truncate title to 90 chars for logging
                            const dupTitle =
                                dup.title?.substring(0, 90) + (dup.title?.length > 90 ? '...' : '');

                            // Include justification if available
                            const justificationText = dup.justification
                                ? ` - Reason: ${dup.justification}`
                                : '';

                            duplicateLog += `"${dupTitle}" (${formattedDupDate}) - similarity: ${dup.similarity.toFixed(
                                2
                            )}${justificationText}\n`;
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
            } else {
                // No relevant articles to process after title assessment
                dedupedArticles = [];
                logger.debug(
                    'No relevant articles found after title assessment, skipping duplicate detection'
                );
            }
        }

        // Continue with full content evaluation if we have deduped articles
        if (dedupedArticles.length > 0) {
            // STEP 8: Evaluate full content of each article individually
            try {
                // Process each article individually with the EVALUATE_CONTENT prompt
                for (const article of dedupedArticles) {
                    const articleContent = extractArticleContent(article);

                    // Log content length and potential truncation for debugging
                    const evalCharLimit =
                        config.NEWS_MONITOR.CONTENT_LIMITS?.EVALUATION_CHAR_LIMIT || 0;
                    if (evalCharLimit > 0 && articleContent.length > evalCharLimit) {
                        logger.debug(
                            `Article content for evaluation truncated from ${articleContent.length} to ${evalCharLimit} characters`
                        );
                    }

                    // We use an empty array for previousArticles since we're evaluating each individually
                    const evalResult = await evaluateContent(
                        `Título: ${article.title}\n\n${articleContent}`,
                        'rss',
                        '', // No username for RSS
                        true // Include justification
                    );

                    if (evalResult.isRelevant) {
                        // Extract only the key reason from justification (keep it brief)
                        let shortJustification = evalResult.justification;
                        if (shortJustification && shortJustification.length > 40) {
                            // Try to find common phrases that explain the reason
                            if (shortJustification.includes('notícia global')) {
                                shortJustification = 'Notícia global crítica';
                            } else if (
                                shortJustification.includes('Brasil') ||
                                shortJustification.includes('brasileiro')
                            ) {
                                shortJustification = 'Relevante para o Brasil';
                            } else if (shortJustification.includes('São Paulo')) {
                                shortJustification = 'Relevante para São Paulo';
                            } else if (shortJustification.includes('científic')) {
                                shortJustification = 'Descoberta científica importante';
                            } else if (shortJustification.includes('esport')) {
                                shortJustification = 'Evento esportivo significativo';
                            } else if (
                                shortJustification.includes('escândalo') ||
                                shortJustification.includes('polític')
                            ) {
                                shortJustification = 'Escândalo político/econômico';
                            } else if (shortJustification.includes('impacto global')) {
                                shortJustification = 'Grande impacto global';
                            } else {
                                shortJustification = shortJustification.substring(0, 40) + '...';
                            }
                        }

                        // Store short justification with the article for later use
                        article.relevanceJustification = shortJustification;
                        finalRelevantArticles.push(article);
                    } else {
                        notRelevantFullContent.push({
                            title: article.title,
                            reason: evalResult.justification || 'Not relevant',
                        });
                    }
                }

                // Update stats
                stats.fullContentExcludedCount = notRelevantFullContent.length;
                stats.relevantCount = finalRelevantArticles.length;

                // Log results of full content evaluation
                if (notRelevantFullContent.length > 0) {
                    let irrelevantLog = `Filtered out ${notRelevantFullContent.length} out of ${dedupedArticles.length} after content evaluation:\n`;

                    notRelevantFullContent.forEach(item => {
                        const truncatedTitle =
                            item.title?.substring(0, 90) + (item.title?.length > 90 ? '...' : '');
                        irrelevantLog += `"${truncatedTitle}"\n`;
                    });

                    logger.debug(irrelevantLog);
                }

                // Log final relevant articles
                if (finalRelevantArticles.length > 0) {
                    let relevantLog = `Final selection: ${finalRelevantArticles.length} out of ${dedupedArticles.length} articles after content evaluation:\n`;

                    finalRelevantArticles.forEach(article => {
                        const truncatedTitle =
                            article.title?.substring(0, 90) +
                            (article.title?.length > 90 ? '...' : '');
                        relevantLog += `"${truncatedTitle}"\n${
                            article.relevanceJustification || 'Relevante'
                        }\n\n`;
                    });

                    logger.debug(relevantLog);
                } else {
                    logger.debug(
                        `No articles were found to be relevant after full content evaluation.`
                    );
                }
            } catch (error) {
                logger.error('Error in full content evaluation:', error);
                return []; // Return empty array on error
            }
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
            logger.debug(
                `No account-specific prompt found for @${username}, skipping account-specific evaluation`
            );
            return true; // Default to passing if no prompt is defined
        }

        // Use the account-specific prompt and replace placeholders
        const formattedPrompt = prompt.replace('{post}', content);

        // Run the completion with the account-specific prompt
        const result = await runCompletion(formattedPrompt, 0.3, null, promptName);

        // Parse the result (expecting 'sim' or 'não')
        let processedResult = result.trim().toLowerCase();
        // Remove trailing period or single quote
        if (processedResult.endsWith('.') || processedResult.endsWith("'")) {
            processedResult = processedResult.slice(0, -1);
        }
        const passed = processedResult === 'sim';

        logger.debug(
            `Account-specific evaluation for @${username}: ${
                passed ? 'Passed' : 'Failed'
            } (response: "${result}")`
        );

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
    restartMonitors,
    // Export for testing
    evaluateContent,
    generateSummary,
    fetchRssFeedItems,
    isQuietHour,
    formatNewsArticle,
    evaluateAccountSpecific,
    detectDuplicateWithPrompt,
};
