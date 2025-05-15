const Parser = require('rss-parser');
const logger = require('../utils/logger');
const NEWS_MONITOR_CONFIG = require('./newsMonitor.config');

// Initialize RSS parser with similar configurations to commands/newsMonitor.js
const parser = new Parser({
    headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; RSS-Fetcher/1.0)', // Slightly different agent for clarity
    },
    timeout: 60000, // 60 second timeout
    customFields: {
        item: [
            ['media:content', 'media'], // For media content in some feeds
            ['content:encoded', 'contentEncoded'], // Common field for full content
            // Add other custom fields if specific feeds require them
        ],
    },
});

/**
 * Extracts content from an RSS item.
 * Prefers 'contentEncoded', then 'content', then 'description', then 'summary'.
 * @param {object} item - The RSS item object from rss-parser.
 * @returns {string} - The extracted content or a default message.
 */
function extractArticleContentFromRssItem(item) {
    let rawContent =
        item.contentEncoded ||
        item.content ||
        item['content:encoded'] || // Some parsers might output with colon
        item.description || // Often a shorter version or summary
        item.summary || // Another common field for summary
        item.title || // Fallback to title if absolutely no other content
        'No content available';

    // Strip HTML tags and normalize whitespace to get plain text
    if (rawContent && typeof rawContent === 'string') {
        // First, replace <br> and <p> tags with newlines for better readability of paragraphs
        rawContent = rawContent.replace(/<br\s*\/?>/gi, '\n');
        rawContent = rawContent.replace(/<\/p\s*>/gi, '\n');
        // Strip all other HTML tags
        rawContent = rawContent.replace(/<[^>]+>/g, '');
        // Normalize multiple newlines and spaces
        rawContent = rawContent.replace(/(\n\s*)+/g, '\n').trim(); // Consolidate multiple newlines
        rawContent = rawContent.replace(/[ \t]+/g, ' ').trim(); // Consolidate spaces and tabs
    }

    return rawContent;
}

/**
 * Fetches and formats RSS feed items from configured sources.
 * @returns {Promise<Array<Object>>} - A promise that resolves to an array of formatted RSS item objects.
 */
async function fetchAndFormatRssFeeds() {
    const formattedItems = [];
    const enabledRssFeeds = NEWS_MONITOR_CONFIG.sources.filter(
        source => source.type === 'rss' && source.enabled
    );

    if (enabledRssFeeds.length === 0) {
        logger.warn('No enabled RSS feeds found in configuration.');
        return formattedItems;
    }

    logger.debug(`Found ${enabledRssFeeds.length} enabled RSS feeds to process.`);

    for (const feedConfig of enabledRssFeeds) {
        try {
            logger.debug(`Fetching RSS feed: ${feedConfig.name} from ${feedConfig.url}`);
            const feedData = await parser.parseURL(feedConfig.url);

            if (!feedData.items || feedData.items.length === 0) {
                logger.debug(`No items found in RSS feed: ${feedConfig.name}`);
                continue; // Skip to the next feed
            }

            logger.debug(`Retrieved ${feedData.items.length} items from feed: ${feedConfig.name}`);

            for (const item of feedData.items) {
                const content = extractArticleContentFromRssItem(item);

                formattedItems.push({
                    title: item.title || 'No Title',
                    content: content,
                    feedName: feedConfig.name, // Name from the configuration
                    link: item.link || 'No Link',
                    pubDate: item.pubDate || item.isoDate || null, // Publication date
                    categories: item.categories || [],
                    author: item.author || item.creator || null,
                    // Add other potentially useful fields directly from the item if needed
                    // For example: item.enclosure, item.itunes, etc. for specific feed types
                });
            }
        } catch (error) {
            logger.error(
                `Error fetching or processing RSS feed ${feedConfig.name} (${feedConfig.url}): ${error.message}`
            );
            // Continue to the next feed even if one fails
        }
    }

    logger.debug(`Finished processing RSS feeds. Total formatted items: ${formattedItems.length}`);
    return formattedItems;
}

module.exports = {
    fetchAndFormatRssFeeds,
    extractArticleContentFromRssItem, // Exporting for potential direct use or testing
};
