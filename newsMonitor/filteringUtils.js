const logger = require('../utils/logger');
const { runCompletion } = require('../utils/openaiUtils'); // For filterByTopicRedundancy
const { 
    getActiveTopics, 
    addOrUpdateActiveTopic, 
    checkTopicRedundancy,
    checkTopicRedundancyWithImportance,
    updateActiveTopic
} = require('./persistentCache'); // For enhanced topic filtering

/**
 * Checks if an item (RSS or webscraper) passes the whitelist filter.
 * @param {Object} item - The news item to check.
 * @param {string[]} whitelistPaths - Array of whitelisted URL paths or domains.
 * @returns {boolean} - True if the item should be kept, false otherwise.
 */
function isItemWhitelisted(item, whitelistPaths) {
    if (item.accountName) return true; // Tweets are not subject to this whitelist
    
    // Apply whitelist to both RSS and webscraper content
    if ((item.feedName || item.type === 'webscraper') && item.link) {
        try {
            const urlObj = new URL(item.link);
            const hostname = urlObj.hostname;
            const fullPath = urlObj.pathname;
            
            // Check domain-based whitelist first (most permissive)
            for (const whitelistEntry of whitelistPaths) {
                // If entry contains no slashes, treat as domain whitelist
                if (!whitelistEntry.includes('/')) {
                    if (hostname === whitelistEntry || hostname.endsWith('.' + whitelistEntry)) {
                        return true; // Domain match - allow all content
                    }
                }
            }
            
            // Check path-based whitelist (more restrictive)
            for (const whitelistEntry of whitelistPaths) {
                // If entry contains slashes, treat as path whitelist
                if (whitelistEntry.includes('/')) {
                    if (fullPath.startsWith(whitelistEntry)) {
                        return true; // Path match
                    }
                }
            }
            
            // If no whitelist entries match, block the item
            return false;
        } catch (e) {
            logger.warn(
                `NM: Invalid URL for item "${item.title?.substring(0, 50)}": ${
                    item.link
                }. Keeping.`
            );
            return true; // Keep if URL is invalid
        }
    }
    return true; // Keep if not an RSS/webscraper item with a link
}

/**
 * Checks if an item's title or text contains any blacklisted keywords.
 * @param {Object} item - The news item (tweet or RSS).
 * @param {string[]} blacklistKeywords - Array of keywords to exclude.
 * @returns {boolean} - True if a keyword is matched (item should be excluded), false otherwise.
 */
function itemContainsBlacklistedKeyword(item, blacklistKeywords) {
    if (!blacklistKeywords || blacklistKeywords.length === 0) {
        return false; // No keywords to check against
    }
    // Check title (for RSS primarily) or text (for tweets primarily, or fallback)
    const contentToCheck = item.title || item.text || '';
    const lowerContent = contentToCheck.toLowerCase();
    for (const keyword of blacklistKeywords) {
        if (lowerContent.includes(keyword.toLowerCase())) {
            // logger.debug(`NM: Item "${contentToCheck.substring(0,50)}" matched blacklist keyword "${keyword}".`);
            return true; // Keyword matched, item should be excluded
        }
    }
    return false; // No keywords matched
}

/**
 * Filters items by topic redundancy using an AI prompt and source priorities.
 * @param {Array<Object>} items - The current list of filtered items.
 * @param {Object} config - The NEWS_MONITOR_CONFIG object.
 * @returns {Promise<Array<Object>>} - A new array with redundant items removed based on topic and priority.
 */
async function filterByTopicRedundancy(items, config) {
    if (!items || items.length < 2) {
        logger.debug('NM: Skipping topic redundancy filter, less than 2 items.');
        return items;
    }

    logger.debug(`NM: Starting topic redundancy filter for ${items.length} items.`);

    // Create a mapping from 1-based index (for AI prompt) to original item index
    const itemIndexMap = {};
    const itemsForPrompt = items.map((item, index) => {
        itemIndexMap[index + 1] = index; // Map 1-based to 0-based original index
        const sourceType = item.accountName ? `Tweet @${item.accountName}` : `RSS ${item.feedName}`;
        const contentPreview = (item.text || item.title || '').substring(0, 150); // Max 150 chars for prompt
        return `${index + 1}. [${sourceType}] ${contentPreview}...`;
    });

    const promptTemplate = config.PROMPTS.DETECT_TOPIC_REDUNDANCY;
    const modelName = config.AI_MODELS.DETECT_TOPIC_REDUNDANCY || config.AI_MODELS.DEFAULT;
    const formattedPrompt = promptTemplate.replace(
        '{items_numbered_list}',
        itemsForPrompt.join('\n')
    );

    let finalFilteredItems = [...items];
    const itemsToRemoveIndices = new Set(); // Store original indices of items to remove
    let removedItemsLog = [];

    try {
        logger.debug(
            `NM: Calling DETECT_TOPIC_REDUNDANCY for ${items.length} items using model ${modelName}.`
        );
        const result = await runCompletion(
            formattedPrompt,
            0.3,
            modelName,
            'DETECT_TOPIC_REDUNDANCY'
        );
        const cleanedResult = result.trim().toLowerCase();

        if (cleanedResult === 'nenhum' || cleanedResult === '') {
            logger.debug('NM: AI reported no topic redundancy.');
            return items; // No redundant groups found
        }

        const groupsStr = cleanedResult.split(';').map(s => s.trim());
        logger.debug(`NM: AI identified topic groups: ${groupsStr.join(' | ')}`);

        for (const groupStr of groupsStr) {
            if (!groupStr) continue;
            const groupItemNumbers = groupStr.split(',').map(numStr => parseInt(numStr.trim(), 10));

            if (groupItemNumbers.length < 2) continue; // Not a group of redundant items

            const groupItemsWithDetails = [];
            for (const itemNumber of groupItemNumbers) {
                if (isNaN(itemNumber) || !itemIndexMap[itemNumber]) {
                    logger.warn(
                        `NM: Invalid item number ${itemNumber} from DETECT_TOPIC_REDUNDANCY AI response.`
                    );
                    continue;
                }
                const originalIndex = itemIndexMap[itemNumber];
                const item = items[originalIndex];

                const sourceConfig = item.accountName
                    ? config.sources.find(
                          s => s.type === 'twitter' && s.username === item.accountName
                      )
                    : config.sources.find(
                          s =>
                              s.type === 'rss' && (s.id === item.feedId || s.name === item.feedName)
                      );

                const priority = sourceConfig?.priority || 0; // Default to 0 if no priority
                groupItemsWithDetails.push({
                    item,
                    originalIndex,
                    priority,
                    itemNumberForLog: itemNumber,
                });
            }

            if (groupItemsWithDetails.length < 2) continue;

            // Sort by priority (desc) then by originalIndex (asc) to break ties
            groupItemsWithDetails.sort((a, b) => {
                if (b.priority !== a.priority) {
                    return b.priority - a.priority;
                }
                return a.originalIndex - b.originalIndex;
            });

            const itemToKeep = groupItemsWithDetails[0];
            removedItemsLog.push(
                `  Keeping: #${itemToKeep.itemNumberForLog} "${(
                    itemToKeep.item.title || itemToKeep.item.text
                ).substring(0, 50)}..." (Priority: ${itemToKeep.priority}, Original Index: ${
                    itemToKeep.originalIndex
                })`
            );

            for (let i = 1; i < groupItemsWithDetails.length; i++) {
                const itemToRemove = groupItemsWithDetails[i];
                itemsToRemoveIndices.add(itemToRemove.originalIndex);
                removedItemsLog.push(
                    `    Removing: #${itemToRemove.itemNumberForLog} "${(
                        itemToRemove.item.title || itemToRemove.item.text
                    ).substring(0, 50)}..." (Priority: ${itemToRemove.priority}, Original Index: ${
                        itemToRemove.originalIndex
                    }) due to topic redundancy with #${itemToKeep.itemNumberForLog}`
                );
            }
        }

        if (itemsToRemoveIndices.size > 0) {
            finalFilteredItems = items.filter((_, index) => !itemsToRemoveIndices.has(index));
            logger.debug(
                `NM: Topic Redundancy Filter: ${items.length} before, ${finalFilteredItems.length} after. Details:\n` +
                    removedItemsLog.join('\n')
            );
        } else {
            logger.debug(
                'NM: Topic Redundancy Filter: No items removed based on AI grouping and priority.'
            );
        }
    } catch (error) {
        logger.error(
            `NM: Error during topic redundancy filter: ${error.message}. Proceeding with unfiltered items for this stage.`
        );
        return items; // Return original items on error
    }
    return finalFilteredItems;
}

/**
 * Enhanced filtering function that combines traditional redundancy filtering with active topic tracking
 * @param {Array<Object>} items - The current list of filtered items
 * @param {Object} config - The NEWS_MONITOR_CONFIG object
 * @returns {Promise<Array<Object>>} - A new array with items filtered by enhanced topic redundancy
 */
async function filterByEnhancedTopicRedundancy(items, config) {
    if (!config.TOPIC_FILTERING?.ENABLED || !items || items.length === 0) {
        logger.debug('NM: Enhanced topic filtering disabled or no items to process.');
        return items;
    }

    logger.debug(`NM: Starting enhanced topic redundancy filter for ${items.length} items.`);

    const filteredItems = [];
    const rejectedItems = [];

    for (const item of items) {
        try {
            // Use importance-based redundancy checking
            const redundancyCheck = await checkTopicRedundancyWithImportance(item, 'AI evaluation passed');
            
            if (redundancyCheck.shouldFilter) {
                rejectedItems.push({
                    item,
                    reason: redundancyCheck.reason,
                    relatedTopic: redundancyCheck.relatedTopic,
                    importanceScore: redundancyCheck.importanceScore,
                    category: redundancyCheck.category
                });
                logger.debug(`NM: Filtered item (score: ${redundancyCheck.importanceScore}, category: ${redundancyCheck.category}): "${(item.title || item.text || '').substring(0, 50)}..." - ${redundancyCheck.reason}`);
                continue;
            }

            // Determine story type and importance
            let storyType = 'core';
            let itemType = 'core';
            
            if (redundancyCheck.isNewTopic) {
                storyType = 'CORE';
                itemType = 'core';
            } else if (redundancyCheck.isEscalation) {
                storyType = 'CORE';
                itemType = 'core';
                logger.debug(`NM: Item escalated to new core event (score: ${redundancyCheck.importanceScore}): "${(item.title || item.text || '').substring(0, 50)}..."`);
            } else if (redundancyCheck.isConsequence) {
                storyType = 'CONSEQUENCE';
                itemType = 'consequence';
                logger.debug(`NM: Item accepted as consequence (score: ${redundancyCheck.importanceScore}): "${(item.title || item.text || '').substring(0, 50)}..."`);
            }

            // Add or update the active topic tracking with importance info
            const topicAction = addOrUpdateActiveTopic(
                item, 
                'AI evaluation passed', 
                itemType
            );

            // If we have importance info, update the topic with that data
            if (redundancyCheck.importanceScore && itemType === 'consequence') {
                const activeTopics = getActiveTopics();
                const relatedTopic = activeTopics.find(t => t.topicId === redundancyCheck.relatedTopic);
                if (relatedTopic) {
                    updateActiveTopic(relatedTopic, item, itemType, {
                        importanceScore: redundancyCheck.importanceScore,
                        category: redundancyCheck.category,
                        justification: redundancyCheck.justification,
                        rawScore: redundancyCheck.rawScore || redundancyCheck.importanceScore
                    });
                }
            }

            logger.debug(`NM: Topic action for item: ${topicAction.action} (${topicAction.topicId || 'new'}) - Importance: ${redundancyCheck.importanceScore || 'N/A'}`);

            // Keep the item
            filteredItems.push(item);

        } catch (error) {
            logger.error(`NM: Error in enhanced topic filtering for item: ${error.message}`);
            // On error, keep the item to avoid losing potentially important news
            filteredItems.push(item);
        }
    }

    if (rejectedItems.length > 0) {
        logger.debug(
            `NM: Enhanced Topic Redundancy Filter: ${items.length} before, ${filteredItems.length} after. Filtered ${rejectedItems.length} items:\n` +
            rejectedItems.map(r => 
                `  - "${(r.item.title || r.item.text || '').substring(0, 50)}..." - ${r.reason}`
            ).join('\n')
        );
    } else {
        logger.debug(`NM: Enhanced Topic Redundancy Filter: No items filtered. ${items.length} items processed.`);
    }

    return filteredItems;
}

/**
 * Determine if a news item is a core event, development, or consequence
 * @param {Object} item - News item to analyze
 * @param {Object} config - Configuration object
 * @returns {Promise<Object>} - Object with type and related topic info
 */
async function determineStoryType(item, config) {
    try {
        const activeTopics = getActiveTopics();
        const content = item.title || item.text || '';
        
        // If no active topics, it's likely a core event
        if (activeTopics.length === 0) {
            return { type: 'CORE', relatedTopicId: null };
        }

        // Prepare active topics summary for the prompt
        const topicsSummary = activeTopics.map(topic => 
            `- ${topic.topicId}: ${topic.entities.join(', ')} (desde ${new Date(topic.startTime).toLocaleDateString()})`
        ).join('\n');

        const promptTemplate = config.PROMPTS.DETECT_STORY_DEVELOPMENT;
        const modelName = config.AI_MODELS.DETECT_STORY_DEVELOPMENT || config.AI_MODELS.DEFAULT;
        
        const formattedPrompt = promptTemplate
            .replace('{news_content}', content)
            .replace('{active_topics}', topicsSummary);

        const result = await runCompletion(
            formattedPrompt,
            0.3,
            modelName,
            'DETECT_STORY_DEVELOPMENT'
        );

        const cleanedResult = result.trim();
        
        // Parse the response
        if (cleanedResult.startsWith('CORE::')) {
            return { type: 'CORE', justification: cleanedResult.split('::')[1] };
        } else if (cleanedResult.startsWith('CONSEQUENCE::')) {
            const parts = cleanedResult.split('::');
            return { 
                type: 'CONSEQUENCE', 
                relatedTopicId: parts[1], 
                justification: parts[2] 
            };
        } else if (cleanedResult.startsWith('DEVELOPMENT::')) {
            const parts = cleanedResult.split('::');
            return { 
                type: 'DEVELOPMENT', 
                relatedTopicId: parts[1], 
                justification: parts[2] 
            };
        }

        // Default to CORE if parsing fails
        logger.warn(`NM: Could not parse story type result: ${cleanedResult}. Defaulting to CORE.`);
        return { type: 'CORE', justification: 'Parsing failed, default to core' };

    } catch (error) {
        logger.error(`NM: Error determining story type: ${error.message}`);
        return { type: 'CORE', justification: 'Error in classification, default to core' };
    }
}

module.exports = {
    isItemWhitelisted,
    itemContainsBlacklistedKeyword,
    filterByTopicRedundancy,
    filterByEnhancedTopicRedundancy,
    determineStoryType,
};
