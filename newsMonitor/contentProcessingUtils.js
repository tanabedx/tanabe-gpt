const logger = require('../utils/logger');
const { runCompletion } = require('../utils/openaiUtils');
const { readCache, writeCache } = require('../utils/persistentCache');
const fs = require('fs'); // Still needed for recordSentItemToCache logic temporarily for path.exists
const path = require('path'); // Still needed for recordSentItemToCache logic temporarily for path.exists

/**
 * Generates a summary for a given title and content.
 * @param {string} title - The title of the content.
 * @param {string} content - The content to summarize.
 * @param {Object} config - The NEWS_MONITOR_CONFIG object.
 * @returns {Promise<string>} - The generated summary.
 */
async function generateSummary(title, content, config) {
    const charLimit = config.CONTENT_LIMITS?.SUMMARY_CHAR_LIMIT || 0;
    const limitedContent =
        charLimit > 0 && content.length > charLimit
            ? content.substring(0, charLimit) + '... [content truncated for summary]'
            : content;

    const promptTemplate = config.PROMPTS.SUMMARIZE_CONTENT;
    const modelName = config.AI_MODELS.SUMMARIZE_CONTENT || config.AI_MODELS.DEFAULT;

    let formattedPrompt;
    const titlePlaceholder = '{{#if title}}\nTítulo Original: {title}\n{{/if}}';

    if (title) {
        const titleSection = `Título Original: ${title}`;
        formattedPrompt = promptTemplate.replace(titlePlaceholder, titleSection);
    } else {
        formattedPrompt = promptTemplate.replace(titlePlaceholder, '');
    }
    formattedPrompt = formattedPrompt.replace('{content}', limitedContent);

    try {
        const logTitlePart = title ? `title "${title.substring(0, 30)}..." and ` : '';
        const logContentPart = `content "${limitedContent.substring(0, 50)}..."`;
        logger.debug(
            `NM: Generating summary for ${logTitlePart}${logContentPart} using model ${modelName}.`
        );
        const summary = await runCompletion(formattedPrompt, 0.7, modelName, 'SUMMARIZE_CONTENT');
        return summary.trim();
    } catch (error) {
        logger.error(
            `NM: Error generating summary for ${
                title ? `title "${title.substring(0, 30)}..."` : 'content'
            } : ${error.message}`
        );
        return `Error generating summary. Original content: ${(content || '').substring(
            0,
            100
        )}...`;
    }
}

// Helper to extract raw content string from an item for duplicate checking
function extractRawContentString(item) {
    if (item.accountName) {
        return item.text || '';
    } else if (item.feedName) {
        return item.content || item.title || '';
    } else if (item.type === 'tweet') {
        return item.content || '';
    } else if (item.type === 'article') {
        return item.content || item.title || '';
    }
    return '';
}

// Helper to trim content for duplicate checking
function trimContent(text, charLimit) {
    if (charLimit > 0 && text && text.length > charLimit) {
        return text.substring(0, charLimit) + '... [content truncated]';
    }
    return text || '';
}

/**
 * Checks if a new item is a duplicate of previously cached items.
 * @param {Object} newItem - The news item to check.
 * @param {Array<Object>} cachedItems - Array of items from newsCache.json.
 * @param {Object} config - The NEWS_MONITOR_CONFIG object.
 * @returns {Promise<boolean>} - True if the item is a duplicate, false otherwise.
 */
async function checkIfDuplicate(newItem, cachedItems, config) {
    if (!cachedItems || cachedItems.length === 0) {
        return false;
    }

    const charLimit = config.CONTENT_LIMITS?.EVALUATION_CHAR_LIMIT || 2000;
    const newItemRawContent = extractRawContentString(newItem);
    const trimmedNewItemContent = trimContent(newItemRawContent, charLimit);
    // Determine sourceName for the new item
    const newItemSourceName =
        newItem.accountName ||
        newItem.feedName ||
        (newItem.type === 'tweet' ? newItem.username : newItem.feedId) ||
        'Unknown Source';
    const newItemString = `Content: ${trimmedNewItemContent}\nSource: ${newItemSourceName}`;

    const previousItemsStrings = cachedItems
        .map((cachedItem, index) => {
            const cachedItemRawContent = extractRawContentString(cachedItem);
            const trimmedCachedItemContent = trimContent(cachedItemRawContent, charLimit);
            // Determine sourceName for the cached item (handling both old and new cache structures)
            const cachedItemSourceName =
                cachedItem.sourceName ||
                cachedItem.username ||
                cachedItem.feedId ||
                'Unknown Source';
            return `${
                index + 1
            }. Content: ${trimmedCachedItemContent}\n   Source: ${cachedItemSourceName}`;
        })
        .join('\n---\n');

    if (!trimmedNewItemContent.trim()) {
        logger.debug('NM: New item has no content for duplicate check. Marking as not duplicate.');
        return false;
    }
    if (!previousItemsStrings.trim()) {
        logger.debug(
            'NM: No valid previous items content for duplicate check. Marking as not duplicate.'
        );
        return false;
    }

    const promptTemplate = config.PROMPTS.DETECT_DUPLICATE;
    const modelName = config.AI_MODELS.DETECT_DUPLICATE || config.AI_MODELS.DEFAULT;
    const formattedPrompt = promptTemplate
        .replace('{new_item}', newItemString)
        .replace('{previous_items}', previousItemsStrings);

    try {
        logger.debug(
            `NM: Checking for duplicates for item "${(
                newItem.title ||
                newItem.text ||
                'Untitled Item'
            ).substring(0, 50)}..." using model ${modelName}.`
        );
        const result = await runCompletion(formattedPrompt, 0.3, modelName, 'DETECT_DUPLICATE');
        const cleanedResult = result.trim().toLowerCase();

        if (cleanedResult.startsWith('duplicate::')) {
            const parts = result.split('::');
            const duplicateId = parts[1] || 'Unknown ID';
            const justification = parts[2] || 'No justification provided.';
            logger.debug(
                `NM: Item "${(newItem.title || newItem.text || 'Untitled Item').substring(
                    0,
                    50
                )}..." identified as DUPLICATE of item ID ${duplicateId}. Justification: ${justification}`
            );
            return true;
        }
        logger.debug(
            `NM: Item "${(newItem.title || newItem.text || 'Untitled Item').substring(
                0,
                50
            )}..." is UNIQUE. AI Response: ${result}`
        );
        return false;
    } catch (error) {
        logger.error(
            `NM: Error during duplicate check for "${(
                newItem.title ||
                newItem.text ||
                'Untitled Item'
            ).substring(0, 50)}...": ${error.message}. Assuming not duplicate.`
        );
        return false;
    }
}

/**
 * Records a sent item to the newsCache.json file using persistentCache utilities.
 * @param {Object} sentItemData - The data of the item that was sent.
 * @param {Object} config - The NEWS_MONITOR_CONFIG object.
 */
async function recordSentItemToCache(sentItemData, config) {
    let cache = readCache(); // Uses readCache from persistentCache.js
    // This handles initialization, parsing, and age-based pruning.

    const sourceName = sentItemData.username || sentItemData.feedId; // Get the source name

    const newItemToCache = {
        id: sentItemData.id,
        type: sentItemData.type,
        content: sentItemData.content, // This is the AI-generated summary
        timestamp: sentItemData.timestamp,
        justification: sentItemData.justification || null,
        sourceName: sourceName, // Unified source name
    };

    // Add the new item to the beginning of the list
    cache.items.unshift(newItemToCache);

    // Prune cache by item count, specific to newsMonitor's requirement
    const maxCacheSize = config.HISTORICAL_CACHE?.MAX_SIZE || 200;
    if (cache.items.length > maxCacheSize) {
        cache.items = cache.items.slice(0, maxCacheSize);
        logger.debug(`NM: Pruned newsCache (in memory) to ${maxCacheSize} items by count.`);
    }

    writeCache(cache); // Uses writeCache from persistentCache.js
    // This handles writing to file and another round of age-based pruning.
    logger.debug(
        `NM: Successfully recorded item ${sentItemData.id} to newsCache.json via persistentCache utils.`
    );
}

module.exports = {
    generateSummary,
    extractRawContentString,
    trimContent,
    checkIfDuplicate,
    recordSentItemToCache,
};
