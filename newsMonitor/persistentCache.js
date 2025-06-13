/**
 * persistentCache.js - Utilities to manage persistent cache for news content
 */
const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');
const NEWS_MONITOR_CONFIG = require('./newsMonitor.config');
const { runCompletion } = require('../utils/openaiUtils'); // For importance evaluation

// Constants for cache configuration
const CACHE_DIR = path.join(process.cwd(), 'newsMonitor');
const CACHE_FILE = path.join(CACHE_DIR, 'newsCache.json');
const MAX_CACHE_ITEMS = 50; // Maximum number of items in the cache

// Constants for topic configuration
const MAX_ACTIVE_TOPICS = 20; // Maximum number of active topics to track
const DEFAULT_TOPIC_COOLING_HOURS = 48; // Default cooling period for topics
const MAX_CONSEQUENCES_PER_TOPIC = 3; // Maximum follow-up stories per topic

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
    activeTopics: [], // Array of active topics for enhanced filtering
    twitterApiStates: {}, // For storing state of Twitter API keys { primary: {...}, fallback: {...}, ...}
    lastRunTimestamp: null, // Timestamp of the last successful run (excluding quiet hours)
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
            logger.debug(`Created empty cache file with default structure: ${CACHE_FILE}`);
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
    const retentionDays = NEWS_MONITOR_CONFIG?.HISTORICAL_CACHE?.RETENTION_DAYS || 2;
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
    if (!NEWS_MONITOR_CONFIG.HISTORICAL_CACHE?.ENABLED) {
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
        if (NEWS_MONITOR_CONFIG.HISTORICAL_CACHE?.ENABLED) {
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
        if (NEWS_MONITOR_CONFIG.HISTORICAL_CACHE?.ENABLED) {
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
    // Safety check for undefined cache or missing items array
    if (!cache || typeof cache !== 'object') {
        logger.error('Invalid cache object provided to pruneOldEntries, returning default.');
        return { ...DEFAULT_CACHE }; // Return a new default structure
    }

    // Ensure items array exists, even if other parts of cache are present
    const itemsToPrune = Array.isArray(cache.items) ? cache.items : [];

    const now = Date.now();
    const maxAgeMs = getMaxAgeMs();

    const originalCount = itemsToPrune.length;
    const prunedItems = itemsToPrune.filter(item => {
        return item && item.timestamp && now - item.timestamp < maxAgeMs;
    });

    const prunedCount = originalCount - prunedItems.length;
    if (prunedCount > 0) {
        const maxAgeDays = maxAgeMs / (24 * 60 * 60 * 1000);
        logger.debug(`Pruned ${prunedCount} items older than ${maxAgeDays} days from items list`);
    }

    // Return a new object with pruned items and other cache parts intact
    return {
        ...cache, // Spread other potential top-level keys like twitterApiStates
        items: prunedItems,
    };
}

/**
 * Read the cache
 * @returns {Object} The cache object with items array
 */
function readCache() {
    try {
        if (!fs.existsSync(CACHE_FILE)) {
            initializeCacheFile(); // This will create it with DEFAULT_CACHE
            return { ...DEFAULT_CACHE };
        }

        let cacheData = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));

        // Ensure basic structure for backward compatibility or corruption
        if (typeof cacheData !== 'object' || cacheData === null) {
            logger.warn('Cache file contained invalid data, reinitializing.');
            initializeCacheFile();
            cacheData = { ...DEFAULT_CACHE };
        }

        // Handle old format conversion if items is missing but tweets/articles exist
        if (!cacheData.items && (cacheData.tweets || cacheData.articles)) {
            const combinedItems = [];
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
            combinedItems.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
            cacheData.items = combinedItems;
            // Remove old top-level keys after conversion
            delete cacheData.tweets;
            delete cacheData.articles;
            logger.debug(
                `Converted old cache format to new items array (${combinedItems.length} items)`
            );
            // No immediate write here, let pruneOldEntries and subsequent write handle it
        }

        // Ensure top-level keys from DEFAULT_CACHE exist
        if (!cacheData.items) {
            cacheData.items = []; // Ensure items array exists
        }
        if (cacheData.twitterApiStates === undefined) {
            // Check for undefined specifically
            cacheData.twitterApiStates = {}; // Ensure twitterApiStates object exists
            logger.debug('Added missing twitterApiStates object to in-memory cache.');
        }

        // Pruning should only affect 'items'
        const prunedCache = pruneOldEntries(cacheData);
        // After pruning items, the prunedCache still contains other top-level keys like twitterApiStates

        return prunedCache; // Return the full cache object, including twitterApiStates
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

        // Prune old entries from the 'items' list before writing
        // The cacheData object might contain other keys like twitterApiStates which should not be pruned by this logic.
        const cacheToWrite = pruneOldEntries(cacheData); // pruneOldEntries now returns the full object with items pruned

        fs.writeFileSync(CACHE_FILE, JSON.stringify(cacheToWrite, null, 2));
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
        const itemsArray = Array.isArray(cache.items) ? cache.items : [];
        const tweets = itemsArray.filter(item => item.type === 'tweet');
        const articles = itemsArray.filter(item => item.type === 'article');

        // Calculate age statistics for all items
        const itemAges = itemsArray.map(item => now - (item.timestamp || 0));

        return {
            totalItems: itemsArray.length,
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

// New functions for managing Twitter API states in persistent cache
/**
 * Gets the persisted states of Twitter API keys.
 * @returns {object} The twitterApiStates object from the cache.
 */
function getTwitterApiStates() {
    const cache = readCache();
    return cache.twitterApiStates || {}; // Ensure an object is returned
}

/**
 * Saves the states of Twitter API keys to persistent cache.
 * @param {object} newApiStates - The new states object for all Twitter keys.
 */
function saveTwitterApiKeyStates(newApiStates) {
    if (typeof newApiStates !== 'object' || newApiStates === null) {
        logger.error('saveTwitterApiKeyStates received invalid states object. Aborting save.');
        return;
    }
    try {
        const cache = readCache(); // Get the full current cache
        cache.twitterApiStates = newApiStates; // Update only the twitterApiStates part
        writeCache(cache); // Write the entire cache object back
        logger.debug('Successfully saved Twitter API key states to persistent cache.');
    } catch (error) {
        logger.error(`Failed to save Twitter API key states: ${error.message}`);
    }
}

/**
 * Get the last run timestamp from cache
 * @returns {number|null} - The timestamp of the last successful run, or null if not set
 */
function getLastRunTimestamp() {
    try {
        const cache = readCache();
        return cache.lastRunTimestamp || null;
    } catch (error) {
        logger.error('Error reading last run timestamp:', error);
        return null;
    }
}

/**
 * Update the last run timestamp in cache
 * @param {number} timestamp - The timestamp to save as the last run time
 */
function updateLastRunTimestamp(timestamp) {
    try {
        const cache = readCache();
        cache.lastRunTimestamp = timestamp;
        writeCache(cache);
        logger.debug(`Updated last run timestamp to: ${new Date(timestamp).toISOString()}`);
    } catch (error) {
        logger.error('Error updating last run timestamp:', error);
    }
}

/**
 * Generate a unique topic ID based on entities and current date
 * @param {string[]} entities - Key entities/keywords for the topic
 * @returns {string} - Unique topic ID
 */
function generateTopicId(entities) {
    const dateStr = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    const entitiesStr = entities.slice(0, 2).join('-').toLowerCase().replace(/[^a-z0-9]/g, '');
    return `${entitiesStr}-${dateStr}`;
}

/**
 * Extract key entities and keywords from news content for topic tracking
 * @param {Object} item - News item (RSS or tweet)
 * @returns {Object} - Object with entities and keywords arrays
 */
function extractTopicSignature(item) {
    const content = item.title || item.text || '';
    const contentLower = content.toLowerCase();
    
    // Common entities to look for (countries, leaders, organizations)
    const entityPatterns = {
        countries: ['israel', 'irã', 'iran', 'brasil', 'eua', 'estados unidos', 'china', 'rússia', 'russia', 'ucrânia', 'ukraine'],
        organizations: ['onu', 'otan', 'nato', 'fed', 'banco central', 'supremo', 'congresso'],
        events: ['ataque', 'bombardeio', 'terremoto', 'eleição', 'copa', 'olimpíadas']
    };
    
    const entities = [];
    const keywords = [];
    
    // Extract entities
    Object.values(entityPatterns).flat().forEach(entity => {
        if (contentLower.includes(entity)) {
            entities.push(entity);
        }
    });
    
    // Extract key phrases and important words
    const importantWords = content.match(/\b[A-Z][a-záàâãéèêíìîóòôõúùûç]+\b/g) || [];
    keywords.push(...importantWords.slice(0, 5)); // Max 5 keywords
    
    return {
        entities: [...new Set(entities)], // Remove duplicates
        keywords: [...new Set(keywords)].slice(0, 10) // Max 10 keywords, remove duplicates
    };
}

/**
 * Check if a news item relates to any active topics
 * @param {Object} item - News item to check
 * @param {Array} activeTopics - Current active topics
 * @returns {Object|null} - Matching topic object or null
 */
function findRelatedActiveTopic(item, activeTopics) {
    const itemSignature = extractTopicSignature(item);
    
    for (const topic of activeTopics) {
        // Check if current time is still within the topic's active period
        if (Date.now() > topic.cooldownUntil) {
            continue; // Topic has cooled down
        }
        
        // Check entity overlap
        const entityOverlap = itemSignature.entities.filter(entity => 
            topic.entities.some(topicEntity => 
                entity.includes(topicEntity) || topicEntity.includes(entity)
            )
        );
        
        // Check keyword overlap
        const keywordOverlap = itemSignature.keywords.filter(keyword =>
            topic.keywords.some(topicKeyword =>
                keyword.toLowerCase().includes(topicKeyword.toLowerCase()) ||
                topicKeyword.toLowerCase().includes(keyword.toLowerCase())
            )
        );
        
        // Consider it related if there's significant overlap
        if (entityOverlap.length >= 1 || keywordOverlap.length >= 2) {
            return topic;
        }
    }
    
    return null;
}

/**
 * Create a new active topic from a news item
 * @param {Object} item - News item that starts the topic
 * @param {string} justification - Why this item was considered important
 * @returns {Object} - New active topic object
 */
function createActiveTopic(item, justification) {
    const signature = extractTopicSignature(item);
    const now = Date.now();
    const coolingHours = NEWS_MONITOR_CONFIG.TOPIC_FILTERING?.COOLING_HOURS || DEFAULT_TOPIC_COOLING_HOURS;
    
    return {
        topicId: generateTopicId(signature.entities),
        entities: signature.entities,
        keywords: signature.keywords,
        startTime: now,
        lastUpdate: now,
        cooldownUntil: now + (coolingHours * 60 * 60 * 1000), // Convert hours to milliseconds
        coreEventsSent: 1,
        consequencesSent: 0,
        maxConsequences: NEWS_MONITOR_CONFIG.TOPIC_FILTERING?.MAX_CONSEQUENCES || MAX_CONSEQUENCES_PER_TOPIC,
        consequences: [], // Track individual consequences with scores
        originalItem: {
            title: item.title || item.text?.substring(0, 100),
            source: item.feedName || item.accountName || 'Unknown',
            justification: justification,
            baseImportance: 8 // Assume core events are highly important
        }
    };
}

/**
 * Update an existing active topic with a new related item
 * @param {Object} topic - Existing active topic
 * @param {Object} item - New related item
 * @param {string} itemType - Type of item: 'core', 'development', 'consequence'
 * @param {Object} importanceInfo - Optional importance scoring information
 */
function updateActiveTopic(topic, item, itemType = 'consequence', importanceInfo = null) {
    topic.lastUpdate = Date.now();
    
    if (itemType === 'core') {
        topic.coreEventsSent++;
    } else {
        topic.consequencesSent++;
        
        // Record consequence details if importance info available
        if (importanceInfo) {
            if (!topic.consequences) topic.consequences = [];
            topic.consequences.push({
                title: item.title || item.text?.substring(0, 100),
                source: item.feedName || item.accountName || 'Unknown',
                timestamp: Date.now(),
                importanceScore: importanceInfo.importanceScore,
                category: importanceInfo.category,
                justification: importanceInfo.justification,
                rawScore: importanceInfo.rawScore
            });
        }
    }
    
    // Extend keywords and entities with new information
    const itemSignature = extractTopicSignature(item);
    topic.entities = [...new Set([...topic.entities, ...itemSignature.entities])].slice(0, 10);
    topic.keywords = [...new Set([...topic.keywords, ...itemSignature.keywords])].slice(0, 15);
}

/**
 * Get all active topics from cache
 * @returns {Array} - Array of active topic objects
 */
function getActiveTopics() {
    try {
        const cache = readCache();
        return Array.isArray(cache.activeTopics) ? cache.activeTopics : [];
    } catch (error) {
        logger.error(`Failed to get active topics: ${error.message}`);
        return [];
    }
}

/**
 * Save active topics to cache
 * @param {Array} activeTopics - Array of active topic objects
 */
function saveActiveTopics(activeTopics) {
    try {
        const cache = readCache();
        cache.activeTopics = activeTopics;
        writeCache(cache);
        logger.debug(`Saved ${activeTopics.length} active topics to cache`);
    } catch (error) {
        logger.error(`Failed to save active topics: ${error.message}`);
    }
}

/**
 * Add or update an active topic
 * @param {Object} item - News item
 * @param {string} justification - Why this item is important
 * @param {string} itemType - Type: 'core', 'development', 'consequence'
 * @returns {Object} - Result object with action taken
 */
function addOrUpdateActiveTopic(item, justification, itemType = 'core') {
    try {
        let activeTopics = getActiveTopics();
        
        // Clean up expired topics first
        const now = Date.now();
        activeTopics = activeTopics.filter(topic => now < topic.cooldownUntil);
        
        // Check if this item relates to an existing topic
        const relatedTopic = findRelatedActiveTopic(item, activeTopics);
        
        if (relatedTopic) {
            // Update existing topic
            updateActiveTopic(relatedTopic, item, itemType);
            saveActiveTopics(activeTopics);
            
            return {
                action: 'updated',
                topicId: relatedTopic.topicId,
                isConsequence: itemType !== 'core',
                consequencesSent: relatedTopic.consequencesSent,
                maxConsequences: relatedTopic.maxConsequences
            };
        } else if (itemType === 'core') {
            // Create new topic only for core events
            const newTopic = createActiveTopic(item, justification);
            activeTopics.push(newTopic);
            
            // Limit number of active topics
            if (activeTopics.length > MAX_ACTIVE_TOPICS) {
                activeTopics.sort((a, b) => b.lastUpdate - a.lastUpdate);
                activeTopics = activeTopics.slice(0, MAX_ACTIVE_TOPICS);
            }
            
            saveActiveTopics(activeTopics);
            
            return {
                action: 'created',
                topicId: newTopic.topicId,
                isConsequence: false,
                consequencesSent: 0,
                maxConsequences: newTopic.maxConsequences
            };
        }
        
        return {
            action: 'none',
            reason: 'No related topic found and item is not a core event'
        };
    } catch (error) {
        logger.error(`Error managing active topic: ${error.message}`);
        return { action: 'error', error: error.message };
    }
}

/**
 * Check if an item should be filtered due to topic redundancy
 * @param {Object} item - News item to check
 * @param {string} justification - AI justification for relevance
 * @returns {Object} - Filtering decision object
 */
function checkTopicRedundancy(item, justification) {
    try {
        const activeTopics = getActiveTopics();
        const relatedTopic = findRelatedActiveTopic(item, activeTopics);
        
        if (!relatedTopic) {
            return {
                shouldFilter: false,
                reason: 'No related active topic found',
                allowSend: true
            };
        }
        
        // Check if we've hit the limit for consequences
        if (relatedTopic.consequencesSent >= relatedTopic.maxConsequences) {
            return {
                shouldFilter: true,
                reason: `Topic "${relatedTopic.topicId}" has reached max consequences (${relatedTopic.maxConsequences})`,
                allowSend: false,
                relatedTopic: relatedTopic.topicId
            };
        }
        
        // Allow with tracking (will be marked as consequence)
        return {
            shouldFilter: false,
            reason: `Related to topic "${relatedTopic.topicId}" but within limits`,
            allowSend: true,
            relatedTopic: relatedTopic.topicId,
            isConsequence: true
        };
    } catch (error) {
        logger.error(`Error checking topic redundancy: ${error.message}`);
        return {
            shouldFilter: false,
            reason: 'Error in filtering logic',
            allowSend: true
        };
    }
}

/**
 * Evaluate the importance of a consequence using AI
 * @param {Object} originalTopic - The original active topic
 * @param {Object} consequenceItem - The new consequence item
 * @returns {Promise<Object>} - Importance evaluation result
 */
async function evaluateConsequenceImportance(originalTopic, consequenceItem) {
    try {
        const promptTemplate = NEWS_MONITOR_CONFIG.PROMPTS.EVALUATE_CONSEQUENCE_IMPORTANCE;
        const modelName = NEWS_MONITOR_CONFIG.AI_MODELS.EVALUATE_CONSEQUENCE_IMPORTANCE || NEWS_MONITOR_CONFIG.AI_MODELS.DEFAULT;
        
        const originalEventText = originalTopic.originalItem.title || originalTopic.originalItem.justification || 'Unknown event';
        const consequenceText = consequenceItem.title || consequenceItem.text || '';
        
        const formattedPrompt = promptTemplate
            .replace('{original_event}', originalEventText)
            .replace('{consequence_content}', consequenceText);

        const result = await runCompletion(
            formattedPrompt,
            0.3,
            modelName,
            'EVALUATE_CONSEQUENCE_IMPORTANCE'
        );

        const cleanedResult = result.trim();
        
        // Parse response: "SCORE::{1-10}::{category}::{justification}"
        if (cleanedResult.includes('SCORE::')) {
            const parts = cleanedResult.split('::');
            if (parts.length >= 4) {
                const rawScore = parseInt(parts[1], 10);
                const category = parts[2].toUpperCase();
                const justification = parts[3];
                
                // Apply category weight
                const categoryWeights = NEWS_MONITOR_CONFIG.TOPIC_FILTERING?.CATEGORY_WEIGHTS || {};
                const weight = categoryWeights[category] || 1.0;
                const weightedScore = Math.round(rawScore * weight * 10) / 10; // Round to 1 decimal
                
                return {
                    rawScore,
                    weightedScore,
                    category,
                    justification,
                    success: true
                };
            }
        }
        
        logger.warn(`NM: Could not parse importance evaluation result: ${cleanedResult}`);
        return {
            rawScore: 5, // Default moderate score
            weightedScore: 5,
            category: 'UNKNOWN',
            justification: 'Parsing failed',
            success: false
        };
        
    } catch (error) {
        logger.error(`NM: Error evaluating consequence importance: ${error.message}`);
        return {
            rawScore: 5, // Default moderate score on error
            weightedScore: 5,
            category: 'ERROR',
            justification: 'Evaluation error',
            success: false
        };
    }
}

/**
 * Enhanced check for topic redundancy using importance scoring
 * @param {Object} item - News item to check
 * @param {string} justification - AI justification for relevance
 * @returns {Promise<Object>} - Enhanced filtering decision object
 */
async function checkTopicRedundancyWithImportance(item, justification) {
    try {
        const activeTopics = getActiveTopics();
        const relatedTopic = findRelatedActiveTopic(item, activeTopics);
        
        if (!relatedTopic) {
            return {
                shouldFilter: false,
                reason: 'No related active topic found',
                allowSend: true,
                isNewTopic: true
            };
        }

        // If importance scoring is disabled, fall back to simple counting
        if (!NEWS_MONITOR_CONFIG.TOPIC_FILTERING?.USE_IMPORTANCE_SCORING) {
            return checkTopicRedundancy(item, justification);
        }

        // Evaluate importance of this consequence
        const importanceEval = await evaluateConsequenceImportance(relatedTopic, item);
        const score = importanceEval.weightedScore;
        
        // Determine which threshold to apply based on consequence count
        const thresholds = NEWS_MONITOR_CONFIG.TOPIC_FILTERING?.IMPORTANCE_THRESHOLDS || {};
        let requiredThreshold;
        
        if (relatedTopic.consequencesSent === 0) {
            requiredThreshold = thresholds.FIRST_CONSEQUENCE || 5;
        } else if (relatedTopic.consequencesSent === 1) {
            requiredThreshold = thresholds.SECOND_CONSEQUENCE || 7;
        } else {
            requiredThreshold = thresholds.THIRD_CONSEQUENCE || 9;
        }

        // Check if this is actually more important than the original (becomes new core event)
        const escalationThreshold = NEWS_MONITOR_CONFIG.TOPIC_FILTERING?.ESCALATION_THRESHOLD || 8.5;
        if (score >= escalationThreshold && score > (relatedTopic.originalItem.baseImportance || 8)) {
            return {
                shouldFilter: false,
                reason: `High importance (${score}) - escalates to new core event`,
                allowSend: true,
                isEscalation: true,
                importanceScore: score,
                category: importanceEval.category,
                justification: importanceEval.justification
            };
        }
        
        // Check if it meets the threshold for consequences
        if (score >= requiredThreshold) {
            return {
                shouldFilter: false,
                reason: `Importance score ${score} meets threshold ${requiredThreshold} for consequence #${relatedTopic.consequencesSent + 1}`,
                allowSend: true,
                relatedTopic: relatedTopic.topicId,
                isConsequence: true,
                importanceScore: score,
                category: importanceEval.category,
                justification: importanceEval.justification
            };
        } else {
            return {
                shouldFilter: true,
                reason: `Importance score ${score} below threshold ${requiredThreshold} for consequence #${relatedTopic.consequencesSent + 1}`,
                allowSend: false,
                relatedTopic: relatedTopic.topicId,
                importanceScore: score,
                category: importanceEval.category,
                justification: importanceEval.justification
            };
        }
        
    } catch (error) {
        logger.error(`Error in enhanced topic redundancy check: ${error.message}`);
        // Fall back to basic check on error
        return checkTopicRedundancy(item, justification);
    }
}

/**
 * Get statistics about active topics
 * @returns {Object} - Statistics object
 */
function getActiveTopicsStats() {
    try {
        const activeTopics = getActiveTopics();
        const now = Date.now();
        
        // Clean expired topics for accurate stats
        const validTopics = activeTopics.filter(topic => now < topic.cooldownUntil);
        
        return {
            totalActiveTopics: validTopics.length,
            topics: validTopics.map(topic => ({
                id: topic.topicId,
                ageHours: Math.round((now - topic.startTime) / (1000 * 60 * 60)),
                coreEvents: topic.coreEventsSent,
                consequences: topic.consequencesSent,
                entities: topic.entities,
                source: topic.originalItem.source,
                consequenceDetails: (topic.consequences || []).map(c => ({
                    score: c.importanceScore,
                    category: c.category,
                    summary: c.title?.substring(0, 50) + '...'
                }))
            }))
        };
    } catch (error) {
        logger.error(`Failed to get active topics stats: ${error.message}`);
        return { totalActiveTopics: 0, topics: [], error: error.message };
    }
}

// Initialize cache file on module load
initializeCacheFile();

module.exports = {
    readCache,
    writeCache,
    cacheTweet,
    cacheArticle,
    getRecentTweetsForPrompt,
    getRecentArticlesForPrompt,
    getRecentContentForPrompt,
    getRecentItems,
    clearCache,
    getCacheStats,
    pruneOldEntries,
    // New functions for Twitter API states
    getTwitterApiStates,
    saveTwitterApiKeyStates,
    // New functions for last run timestamp
    getLastRunTimestamp,
    updateLastRunTimestamp,
    // Active topics management functions
    getActiveTopics,
    saveActiveTopics,
    addOrUpdateActiveTopic,
    updateActiveTopic,
    checkTopicRedundancy,
    checkTopicRedundancyWithImportance,
    evaluateConsequenceImportance,
    getActiveTopicsStats,
    extractTopicSignature,
    findRelatedActiveTopic,
    // In-memory cache functions (kept for backward compatibility)
    recordSentTweet,
    recordSentArticle,
    isArticleSentRecently,
    cleanupSentCache,
    cleanupSentArticleCache,
    // Removed unused exports
};
