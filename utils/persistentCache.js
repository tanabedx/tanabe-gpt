/**
 * persistentCache.js - Utilities to manage persistent cache for news content
 */
const fs = require('fs');
const path = require('path');
const logger = require('./logger');
const config = require('../configs');

// Constants for cache configuration
const CACHE_DIR = path.join(process.cwd(), 'temp');
const CACHE_FILE = path.join(CACHE_DIR, 'newsCache.json');
const MAX_CACHE_ITEMS = 50; // Maximum number of items in the cache

// In-memory caches for quick access
// Cache for articles that were sent to the group
let sentArticleCache = new Map();
// Set to track URLs of sent articles
let sentArticleUrls = new Set();
// Cache for tweets that were sent to the group
let sentTweetCache = new Map();
// Set to track IDs of sent tweets
let sentTweetIds = new Set();

// Default cache structure
const DEFAULT_CACHE = {
    items: [], // Single array for all content (tweets and articles)
};

/**
 * Ensure the cache directory exists
 */
function ensureCacheDir() {
    try {
        if (!fs.existsSync(CACHE_DIR)) {
            fs.mkdirSync(CACHE_DIR, { recursive: true });
            logger.debug(`Created cache directory: ${CACHE_DIR}`);
        }
    } catch (error) {
        logger.error(`Failed to create cache directory: ${error.message}`);
        // Continue despite error - we'll handle file access errors later
    }
}

/**
 * Initialize the cache file if it doesn't exist
 */
function initializeCacheFile() {
    ensureCacheDir();

    try {
        if (!fs.existsSync(CACHE_FILE)) {
            fs.writeFileSync(CACHE_FILE, JSON.stringify(DEFAULT_CACHE, null, 2));
            logger.debug(`Created empty cache file: ${CACHE_FILE}`);
        }
    } catch (error) {
        logger.error(`Failed to initialize cache file: ${error.message}`);
        // We'll handle this by returning default values when reading
    }
}

/**
 * Get the maximum age in milliseconds
 * @returns {number} Maximum age in milliseconds
 */
function getMaxAgeMs() {
    const retentionDays = config.NEWS_MONITOR?.HISTORICAL_CACHE?.RETENTION_DAYS || 2;
    return retentionDays * 24 * 60 * 60 * 1000; // Convert days to milliseconds
}

/**
 * Clean up old entries from the in-memory cache based on retention period
 * @deprecated This function is kept for backward compatibility but now uses persistent cache
 */
function cleanupSentCache() {
    // This function no longer does anything with in-memory cache
    // The pruning happens at the persistent cache level when reading/writing
    logger.debug('Using persistent cache instead of in-memory cache');
}

/**
 * Alias for backward compatibility
 * @deprecated This function is kept for backward compatibility
 */
function cleanupSentArticleCache() {
    cleanupSentCache();
}

/**
 * Check if an article has been sent recently using cached data
 * @param {Object} article - Article object to check
 * @returns {Promise<boolean>} - true if a similar article has been sent
 */
async function isArticleSentRecently(article) {
    if (!config.NEWS_MONITOR.HISTORICAL_CACHE?.ENABLED) {
        return false;
    }

    // Use persistent cache instead of in-memory cache
    const cache = readCache();
    const matchingItem = cache.items.find(
        item => item.type === 'article' && item.id === article.link
    );

    return !!matchingItem;
}

/**
 * Record a tweet as sent to persistent cache
 * @param {Object} tweet - The tweet that was sent
 * @param {string} username - The Twitter username
 * @param {string} justification - Why this tweet was relevant
 */
function recordSentTweet(tweet, username, justification) {
    try {
        if (!tweet || !tweet.id) {
            logger.warn('Invalid tweet object provided to recordSentTweet');
            return;
        }

        // Save directly to persistent cache
        if (config.NEWS_MONITOR.HISTORICAL_CACHE?.ENABLED) {
            cacheTweet(tweet, username, justification);
            logger.debug(`Added tweet ${tweet.id} to persistent cache`);
        }
    } catch (error) {
        logger.error('Error recording sent tweet:', error);
    }
}

/**
 * Record an article as sent to persistent cache
 * @param {Object} article - The article that was sent
 */
function recordSentArticle(article) {
    try {
        if (!article || !article.link) {
            logger.warn('Invalid article object provided to recordSentArticle');
            return;
        }

        // Save directly to persistent cache
        if (config.NEWS_MONITOR.HISTORICAL_CACHE?.ENABLED) {
            cacheArticle(article);
            logger.debug(
                `Added article to persistent cache: ${article.title?.substring(0, 30)}...`
            );
        }
    } catch (error) {
        logger.error('Error recording sent article:', error);
    }
}

/**
 * Prune old entries from the cache
 * @param {Object} cache - The cache object
 * @returns {Object} - The pruned cache object
 */
function pruneOldEntries(cache) {
    // Safety check for undefined cache
    if (!cache || typeof cache !== 'object' || !Array.isArray(cache.items)) {
        logger.error('Invalid cache object provided to pruneOldEntries');
        return { ...DEFAULT_CACHE };
    }

    const now = Date.now();
    const maxAgeMs = getMaxAgeMs();

    // Filter out items older than the max age
    const originalCount = cache.items.length;
    const prunedCache = {
        items: cache.items.filter(item => {
            return item && item.timestamp && now - item.timestamp < maxAgeMs;
        }),
    };

    // Log if we pruned any entries
    const prunedCount = originalCount - prunedCache.items.length;

    if (prunedCount > 0) {
        const maxAgeDays = maxAgeMs / (24 * 60 * 60 * 1000);
        logger.debug(`Pruned ${prunedCount} items older than ${maxAgeDays} days`);
    }

    return prunedCache;
}

/**
 * Read the cache
 * @returns {Object} The cache object with items array
 */
function readCache() {
    try {
        if (!fs.existsSync(CACHE_FILE)) {
            initializeCacheFile();
            return { ...DEFAULT_CACHE };
        }

        const cacheData = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));

        // Handle different cache formats:
        // 1. New format: { items: [...] }
        // 2. Old format: { tweets: [...], articles: [...] }
        if (!cacheData.items) {
            // Convert old format to new format
            const combinedItems = [];

            // Convert tweets to items format
            if (Array.isArray(cacheData.tweets)) {
                cacheData.tweets.forEach(tweet => {
                    combinedItems.push({
                        type: 'tweet',
                        id: tweet.id,
                        content: tweet.text || '',
                        timestamp: tweet.timestamp || Date.now(),
                        username: tweet.username || 'unknown',
                        justification: tweet.justification || 'Relevante',
                    });
                });
            }

            // Convert articles to items format
            if (Array.isArray(cacheData.articles)) {
                cacheData.articles.forEach(article => {
                    combinedItems.push({
                        type: 'article',
                        id: article.url,
                        content: article.title || 'Unknown title',
                        timestamp: article.timestamp || Date.now(),
                        feedId: article.feedId || 'unknown',
                        justification: article.justification || null,
                    });
                });
            }

            // Sort all items by timestamp (newest first)
            combinedItems.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

            // Create new format
            cacheData.items = combinedItems;

            // Log the conversion
            logger.debug(
                `Converted cache from old format to new format (${combinedItems.length} items)`
            );

            // Write back the converted format
            try {
                writeCache(cacheData);
            } catch (writeError) {
                logger.error(`Failed to write converted cache format: ${writeError.message}`);
                // Continue with the in-memory converted format
            }
        }

        const prunedCache = pruneOldEntries(cacheData);

        return prunedCache;
    } catch (error) {
        logger.error(`Failed to read cache: ${error.message}`);
        return { ...DEFAULT_CACHE }; // Return empty array if there's an error
    }
}

/**
 * Write the cache back to file
 * @param {Object} cacheData - The cache object with items array
 */
function writeCache(cacheData) {
    try {
        ensureCacheDir();

        // Prune old entries before writing
        const prunedCache = pruneOldEntries(cacheData);

        fs.writeFileSync(CACHE_FILE, JSON.stringify(prunedCache, null, 2));
    } catch (error) {
        logger.error(`Failed to write cache: ${error.message}`);
    }
}

/**
 * Add a tweet to the persistent cache
 * @param {Object} tweet - The tweet object to cache
 * @param {string} username - Twitter username
 * @param {string} justification - Why the tweet was sent
 */
function cacheTweet(tweet, username, justification = null) {
    try {
        // Validate parameters
        if (!tweet || !tweet.id) {
            logger.warn('Invalid tweet object provided to cacheTweet');
            return;
        }

        // Read existing cache
        const cache = readCache();

        // Create cache entry
        const cacheEntry = {
            type: 'tweet',
            id: tweet.id,
            content: tweet.text || '',
            timestamp: Date.now(),
            username: username || 'unknown',
            justification: justification || 'Relevante',
        };

        // Add to beginning of array (newest first)
        cache.items.unshift(cacheEntry);

        // Limit cache size
        if (cache.items.length > MAX_CACHE_ITEMS) {
            cache.items = cache.items.slice(0, MAX_CACHE_ITEMS);
        }

        // Write back to file
        writeCache(cache);

        logger.debug(
            `Added tweet from @${username} to persistent cache (total: ${cache.items.length})`
        );
    } catch (error) {
        logger.error(`Failed to add tweet to persistent cache: ${error.message}`);
    }
}

/**
 * Add an article to the persistent cache
 * @param {Object} article - The article object to cache
 */
function cacheArticle(article) {
    try {
        // Validate parameters
        if (!article || !article.link || !article.title) {
            logger.warn('Invalid article object provided to cacheArticle');
            return;
        }

        // Read existing cache
        const cache = readCache();

        // Create cache entry
        const cacheEntry = {
            type: 'article',
            id: article.link,
            content: article.title || 'Unknown title',
            timestamp: Date.now(),
            feedId: article.feedId || 'unknown',
            justification: article.relevanceJustification || null,
        };

        // Add to beginning of array (newest first)
        cache.items.unshift(cacheEntry);

        // Limit cache size
        if (cache.items.length > MAX_CACHE_ITEMS) {
            cache.items = cache.items.slice(0, MAX_CACHE_ITEMS);
        }

        // Write back to file
        writeCache(cache);

        logger.debug(
            `Added article "${article.title?.substring(0, 50)}..." to persistent cache (total: ${
                cache.items.length
            })`
        );
    } catch (error) {
        logger.error(`Failed to add article to persistent cache: ${error.message}`);
    }
}

/**
 * Get recent content for the prompt
 * @param {number} count - Number of items to retrieve (default: 10)
 * @returns {string} Formatted content for the prompt
 */
function getRecentContentForPrompt(count = 10) {
    try {
        const cache = readCache();
        const limitedItems = cache.items.slice(0, count);

        if (limitedItems.length === 0) {
            return '';
        }

        return limitedItems
            .map(item => {
                if (item.type === 'tweet') {
                    return item.content;
                } else if (item.type === 'article') {
                    return `Título: ${item.content}`;
                }
                return ''; // Skip items without recognized type
            })
            .filter(text => text)
            .join('\n\n---\n\n');
    } catch (error) {
        logger.error(`Failed to get recent content for prompt: ${error.message}`);
        return '';
    }
}

/**
 * Get recent tweets for the prompt (alias for compatibility)
 * @param {number} count - Number of tweets to retrieve
 * @returns {string} Formatted tweet content for the prompt
 */
function getRecentTweetsForPrompt(count = 10) {
    return getRecentContentForPrompt(count);
}

/**
 * Get recent articles for the prompt (alias for compatibility)
 * @param {number} count - Number of articles to retrieve
 * @returns {string} Formatted article content for the prompt
 */
function getRecentArticlesForPrompt(count = 10) {
    return getRecentContentForPrompt(count);
}

/**
 * Clear the cache completely
 */
function clearCache() {
    try {
        writeCache({ ...DEFAULT_CACHE });
        logger.debug('Cache cleared');
        return true;
    } catch (error) {
        logger.error(`Failed to clear cache: ${error.message}`);
        return false;
    }
}

/**
 * Get cache statistics
 * @returns {Object} Stats about the cache
 */
function getCacheStats() {
    try {
        const cache = readCache();
        const now = Date.now();

        // Get tweets and articles from the combined array
        const tweets = cache.items.filter(item => item.type === 'tweet');
        const articles = cache.items.filter(item => item.type === 'article');

        // Calculate age statistics for all items
        const itemAges = cache.items.map(item => now - (item.timestamp || 0));

        return {
            totalItems: cache.items.length,
            tweetCount: tweets.length,
            articleCount: articles.length,
            newestItemHours: itemAges.length > 0 ? Math.min(...itemAges) / (1000 * 60 * 60) : 0,
            oldestItemHours: itemAges.length > 0 ? Math.max(...itemAges) / (1000 * 60 * 60) : 0,
            maxCacheAge: getMaxAgeMs() / (1000 * 60 * 60 * 24), // days
            maxCacheItems: MAX_CACHE_ITEMS,
        };
    } catch (error) {
        logger.error(`Failed to get cache stats: ${error.message}`);
        return {
            totalItems: 0,
            tweetCount: 0,
            articleCount: 0,
            error: error.message,
        };
    }
}

/**
 * Get recent items from cache
 * @param {number} count - Maximum number of items to retrieve
 * @returns {Array} Recent items from cache
 */
function getRecentItems(count = 10) {
    try {
        const cache = readCache();

        // Just return the most recent items up to the specified count
        return cache.items.slice(0, count);
    } catch (error) {
        logger.error(`Failed to get recent items from cache: ${error.message}`);
        return [];
    }
}

// Initialize cache file on module load
initializeCacheFile();

module.exports = {
    readCache,
    cacheTweet,
    cacheArticle,
    getRecentTweetsForPrompt,
    getRecentArticlesForPrompt,
    getRecentContentForPrompt,
    getRecentItems,
    clearCache,
    getCacheStats,
    pruneOldEntries,
    // In-memory cache functions (kept for backward compatibility)
    recordSentTweet,
    recordSentArticle,
    isArticleSentRecently,
    cleanupSentCache,
    cleanupSentArticleCache,
    // Removed unused exports
};
