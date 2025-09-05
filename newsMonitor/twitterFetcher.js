const axios = require('axios');
const logger = require('../utils/logger');
const twitterApiHandler = require('../newsMonitor/twitterApiHandler');
const NEWS_MONITOR_CONFIG = require('./newsMonitor.config'); // Import the config

// Twitter last fetched tweets cache - MOVED HERE
let lastFetchedTweetsCache = {
    tweets: {}, // Format: { username: [rawTweetObjects] }
    lastUpdated: null,
};

/**
 * Store fetched raw tweets in the cache for debugging and reuse - MOVED HERE (internal)
 * @param {Object} rawTweetsByUser - Object with username keys and arrays of raw tweet objects as values
 */
function updateLastFetchedTweetsCache(rawTweetsByUser) {
    lastFetchedTweetsCache = {
        tweets: rawTweetsByUser,
        lastUpdated: Date.now(),
    };
    // Using a more specific logger message for this context
    logger.debug(
        `TwitterFetcher: Updated internal tweet cache. Accounts with new tweets: [${Object.keys(
            rawTweetsByUser
        ).join(', ')}]. Total: ${Object.keys(rawTweetsByUser).length}.`
    );
}

/**
 * Get cached tweets from the last fetch - MOVED HERE (exported)
 * @param {number} maxAgeMinutes - Maximum age of cache in minutes before considering it stale
 * @returns {Object} - Object with tweets and metadata, or null if cache is stale or empty
 */
function getLastFetchedTweetsCache(maxAgeMinutes = 15) {
    const cacheMaxAge = maxAgeMinutes * 60 * 1000; // Convert to milliseconds

    if (
        lastFetchedTweetsCache.lastUpdated &&
        Date.now() - lastFetchedTweetsCache.lastUpdated < cacheMaxAge &&
        Object.keys(lastFetchedTweetsCache.tweets).length > 0
    ) {
        return {
            tweets: lastFetchedTweetsCache.tweets, // This is expected to be { username: [rawTweets] }
            lastUpdated: lastFetchedTweetsCache.lastUpdated,
            cacheAge:
                Math.floor((Date.now() - lastFetchedTweetsCache.lastUpdated) / 1000 / 60) +
                ' minutes',
        };
    }
    return null;
}

/**
 * Fetches tweets for configured accounts and formats them.
 * No longer accepts accounts as a parameter.
 * @returns {Promise<Array<Object>>} - A promise that resolves to an array of formatted tweet objects.
 */
async function fetchAndFormatTweets(/* accounts no longer a parameter */) {
    const formattedTweets = [];

    // Derive accounts to fetch from the config file
    const accountsToFetch = NEWS_MONITOR_CONFIG.sources
        .filter(source => source.type === 'twitter' && source.enabled)
        .map(source => ({
            username: source.username,
            mediaOnly: source.mediaOnly,
            // Include other properties if needed by the API query construction logic below
        }));

    if (!accountsToFetch || accountsToFetch.length === 0) {
        logger.warn('No enabled Twitter accounts found in config for fetchAndFormatTweets.');
        return formattedTweets;
    }

    try {
        const currentActiveKey = twitterApiHandler.getCurrentKey();

        if (!currentActiveKey || !currentActiveKey.bearer_token) {
            // Downgrade to warn and do NOT notify admin every cycle; the News Monitor will handle one-time admin notification
            logger.warn(
                'No active Twitter API key available (fetchAndFormatTweets). Skipping this cycle.',
                null,
                false
            );
            return formattedTweets;
        }

        const apiKeyName = currentActiveKey.name;
        const bearerToken = currentActiveKey.bearer_token;

        let url = `https://api.twitter.com/2/tweets/search/recent?query=`;
        const queryParts = accountsToFetch.map(account => {
            if (account.mediaOnly) {
                return `(from:${account.username} has:images -is:reply -is:retweet)`;
            } else {
                return `(from:${account.username} -is:reply -is:retweet)`;
            }
        });
        url += queryParts.join(' OR ');
        url += '&tweet.fields=created_at,attachments,text,id';
        url += '&media.fields=type,url,preview_image_url,media_key';
        url += '&user.fields=username';
        url += '&expansions=author_id,attachments.media_keys';
        url += '&max_results=10'; // Max results per API call

        logger.debug('Constructed Twitter API URL for fetchAndFormatTweets', { url });

        let response;
        let requestError = null;

        try {
            logger.debug(
                `Attempting Twitter API call with ${apiKeyName} key for fetchAndFormatTweets`
            );
            response = await axios.get(url, {
                headers: {
                    Authorization: `Bearer ${bearerToken}`,
                },
            });
            logger.debug('Twitter API call successful for fetchAndFormatTweets', {
                keyUsed: apiKeyName,
            });
        } catch (error) {
            requestError = error;
            logger.error(
                `Error fetching tweets with ${apiKeyName} key for fetchAndFormatTweets: ${error.message}`,
                {
                    statusCode: error.response?.status,
                    data: error.response?.data,
                }
            );
        }

        await twitterApiHandler.handleRequestOutcome(apiKeyName, requestError);

        if (requestError && !response) {
            logger.error(
                `Failed to fetch tweets with key ${apiKeyName} after outcome handling. Propagating error or returning empty.`
            );
            return formattedTweets;
        }

        if (!response) {
            logger.error(
                'No response received from Twitter API and no specific error caught previously for fetchAndFormatTweets.'
            );
            return formattedTweets;
        }

        const tweetsData = response.data?.data;
        const includes = response.data?.includes;
        const users = new Map(includes?.users?.map(user => [user.id, user.username]));
        const mediaMap = new Map(includes?.media?.map(m => [m.media_key, m]));

        // Prepare raw tweets for caching
        const rawTweetsForCache = {};

        if (tweetsData && tweetsData.length > 0) {
            for (const tweet of tweetsData) {
                const authorUsername = users.get(tweet.author_id) || 'Unknown';

                // Store raw tweet for caching
                if (authorUsername !== 'Unknown') {
                    if (!rawTweetsForCache[authorUsername]) {
                        rawTweetsForCache[authorUsername] = [];
                    }
                    rawTweetsForCache[authorUsername].push(tweet); // tweet is the raw object from API
                }

                const tweetMedia = [];
                let hasMedia = false;

                if (tweet.attachments && tweet.attachments.media_keys) {
                    hasMedia = true;
                    for (const mediaKey of tweet.attachments.media_keys) {
                        const mediaDetail = mediaMap.get(mediaKey);
                        if (mediaDetail) {
                            tweetMedia.push({
                                type: mediaDetail.type,
                                url: mediaDetail.url || mediaDetail.preview_image_url,
                            });
                        }
                    }
                }

                // Ensure text is present, default to empty string if not
                const tweetText = tweet.text || '';

                formattedTweets.push({
                    accountName: authorUsername,
                    dateTime: tweet.created_at,
                    hasMedia: hasMedia,
                    media: tweetMedia,
                    text: tweetText,
                    link: `https://twitter.com/${authorUsername}/status/${tweet.id}`,
                    id: tweet.id, // Added tweet ID for potential future use
                });
            }
            logger.debug(`Fetched and formatted ${formattedTweets.length} tweets.`);
        } else {
            logger.warn('No new tweets found from the API call for fetchAndFormatTweets.');
        }

        // Update the cache with the raw tweets collected
        if (Object.keys(rawTweetsForCache).length > 0) {
            updateLastFetchedTweetsCache(rawTweetsForCache);
        }
    } catch (error) {
        logger.error('Critical error in fetchAndFormatTweets:', error);
        if (currentActiveKey && currentActiveKey.name) {
            await twitterApiHandler.handleRequestOutcome(currentActiveKey.name, error);
        }
    }

    return formattedTweets;
}

module.exports = {
    fetchAndFormatTweets,
    getLastFetchedTweetsCache, // Export the cache getter
};
