const logger = require('../utils/logger');
const { runCompletion } = require('../utils/openaiUtils'); // For filterByTopicRedundancy

/**
 * Checks if an item (RSS or other) passes the whitelist filter.
 * @param {Object} item - The news item to check.
 * @param {string[]} whitelistPaths - Array of whitelisted URL paths.
 * @returns {boolean} - True if the item should be kept, false otherwise.
 */
function isItemWhitelisted(item, whitelistPaths) {
    if (item.accountName) return true; // Tweets are not subject to this path-based whitelist
    if (item.feedName && item.link) {
        try {
            const urlObj = new URL(item.link);
            // This filter is specifically for 'g1.globo.com' as per original logic
            if (!urlObj.hostname.includes('g1.globo.com')) return true;
            const fullPath = urlObj.pathname;
            return whitelistPaths.some(whitelistedPath => fullPath.startsWith(whitelistedPath));
        } catch (e) {
            logger.warn(
                `NM: Invalid URL for RSS item "${item.title?.substring(0, 50)}": ${
                    item.link
                }. Keeping.`
            );
            return true; // Keep if URL is invalid
        }
    }
    return true; // Keep if not an RSS item with a link or other unspecified cases
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

module.exports = {
    isItemWhitelisted,
    itemContainsBlacklistedKeyword,
    filterByTopicRedundancy,
};
