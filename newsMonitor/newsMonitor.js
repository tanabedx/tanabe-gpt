const NEWS_MONITOR_CONFIG = require('./newsMonitor.config');
const logger = require('../utils/logger');
const twitterApiHandler = require('./twitterApiHandler');
const rssFetcher = require('./rssFetcher');
const twitterFetcher = require('./twitterFetcher');
const webscraperFetcher = require('./webscraperFetcher');
const { runCompletion, extractTextFromImageWithOpenAI } = require('../utils/openaiUtils'); // Added for account-specific prompts
const { readCache, getLastRunTimestamp, updateLastRunTimestamp } = require('./persistentCache'); // Specifically for reading cache for duplication check
const {
    isItemWhitelisted,
    itemContainsBlacklistedKeyword,
    filterByTopicRedundancy,
    filterByEnhancedTopicRedundancy,
} = require('./filteringUtils');
const {
    evaluateItemWithAccountSpecificPrompt,
    evaluateItemFullContent,
} = require('./evaluationUtils');
const {
    generateSummary,
    checkIfDuplicate,
    recordSentItemToCache,
    processLinkContentForShortTweets,
} = require('./contentProcessingUtils');
const { generateNewsCycleDebugReport_core } = require('./debugReportUtils');

const path = require('path');
const axios = require('axios');
const { MessageMedia } = require('whatsapp-web.js');

let newsMonitorIntervalId = null;
let targetGroup = null; // To store the WhatsApp target group

/**
 * Checks if the news monitor is currently in a quiet hours period.
 * @returns {boolean} - true if current time is in quiet hours
 */
function isQuietHours() {
    if (!NEWS_MONITOR_CONFIG.QUIET_HOURS?.ENABLED) return false;
    const timezone = NEWS_MONITOR_CONFIG.QUIET_HOURS?.TIMEZONE || 'UTC';
    const options = { timeZone: timezone, hour: 'numeric', hour12: false };
    const currentHourString = new Intl.DateTimeFormat('en-US', options).format(new Date());
    const currentHour = parseInt(currentHourString, 10);
    const startHour = NEWS_MONITOR_CONFIG.QUIET_HOURS?.START_HOUR || 22;
    const endHour = NEWS_MONITOR_CONFIG.QUIET_HOURS?.END_HOUR || 8;
    if (startHour <= endHour) return currentHour >= startHour && currentHour < endHour;
    else return currentHour >= startHour || currentHour < endHour;
}

/**
 * The main function to be called periodically to fetch, filter, and process news.
 * @param {boolean} [skipPeriodicCheck=false] - If true, skips the twitterApiHandler.periodicCheck().
 */
async function processNewsCycle(skipPeriodicCheck = false) {
    logger.debug('NM: Starting new processing cycle.');

    if (!skipPeriodicCheck) {
        try {
            await twitterApiHandler.periodicCheck();
        } catch (e) {
            logger.error('NM: Error twitterApiHandler.periodicCheck():', e);
        }
    } else {
        logger.debug(
            'NM: Skipping twitterApiHandler.periodicCheck() for this cycle (initial run).'
        );
    }

    if (isQuietHours()) {
        logger.debug('NM: Processing skipped due to quiet hours.');
        return;
    }
    logger.debug('NM: Not in quiet hours, proceeding with fetching and filtering.');
    let allFetchedItems = [];
    try {
        logger.debug('NM: Attempting to fetch Twitter posts...');
        const twitterPosts = await twitterFetcher.fetchAndFormatTweets();
        logger.debug(
            `NM: twitterFetcher.fetchAndFormatTweets returned ${twitterPosts?.length || 0} items.`
        );
        if (twitterPosts?.length) {
            allFetchedItems = allFetchedItems.concat(twitterPosts);
        }

        logger.debug('NM: Attempting to fetch RSS items...');
        const rssItems = await rssFetcher.fetchAndFormatRssFeeds();
        logger.debug(
            `NM: rssFetcher.fetchAndFormatRssFeeds returned ${rssItems?.length || 0} items.`
        );
        if (rssItems?.length) {
            allFetchedItems = allFetchedItems.concat(rssItems);
        }

        logger.debug('NM: Attempting to fetch webscraper items...');
        const webscraperInstance = new webscraperFetcher(NEWS_MONITOR_CONFIG);
        const webscrapedItems = await webscraperInstance.fetchAllSources();
        logger.debug(
            `NM: webscraperFetcher returned ${webscrapedItems?.length || 0} items.`
        );
        if (webscrapedItems?.length) {
            allFetchedItems = allFetchedItems.concat(webscrapedItems);
        }

        logger.debug(
            `NM: Total items in allFetchedItems after fetching: ${allFetchedItems.length}`
        );
    } catch (fetchError) {
        logger.error(
            'NM: Error during source fetching stage:',
            fetchError.message,
            fetchError.stack
        );
    }
    if (!allFetchedItems.length) {
        logger.debug('NM: No items fetched. Ending cycle.');
        return;
    }

    let filteredItems = [...allFetchedItems];
    const itemsBeforeIntervalFilter = [...filteredItems];
    const intervalFilteredOutItems = [];

    // 1. Filter by interval - Use last run timestamp instead of CHECK_INTERVAL
    const lastRunTimestamp = getLastRunTimestamp();
    let cutoffTimestamp;
    
    if (lastRunTimestamp) {
        // Use the last run timestamp as cutoff to include news from quiet hours
        cutoffTimestamp = lastRunTimestamp;
        logger.debug(`NM: Using last run timestamp for filtering: ${new Date(lastRunTimestamp).toISOString()}`);
    } else {
        // Fallback to CHECK_INTERVAL if no last run timestamp is available
        const intervalMs = NEWS_MONITOR_CONFIG.CHECK_INTERVAL;
        cutoffTimestamp = Date.now() - intervalMs;
        logger.debug(`NM: No last run timestamp found, falling back to CHECK_INTERVAL (${intervalMs / 60000} minutes)`);
    }
    
    filteredItems = filteredItems.filter(item => {
        const itemDateString = item.dateTime || item.pubDate;
        if (!itemDateString) return true;
        try {
            const itemDate = new Date(itemDateString);
            const shouldKeep = isNaN(itemDate.getTime()) || itemDate.getTime() >= cutoffTimestamp;
            if (!shouldKeep) {
                intervalFilteredOutItems.push(item);
            }
            return shouldKeep;
        } catch (e) {
            logger.warn(
                `NM: Bad date for "${item.title || item.text?.substring(0, 30)}". Keeping. Err: ${
                    e.message
                }`
            );
            return true;
        }
    });

    if (intervalFilteredOutItems.length > 0) {
        logger.debug(
            `NM: Interval Filter: ${itemsBeforeIntervalFilter.length} before, ${filteredItems.length} after. Filtered out ${intervalFilteredOutItems.length} items:
` +
                intervalFilteredOutItems
                    .map(i => {
                        const originalDateString = i.dateTime || i.pubDate;
                        let formattedDate = originalDateString;
                        try {
                            const dateObj = new Date(originalDateString);
                            if (!isNaN(dateObj.getTime())) {
                                const year = dateObj.getFullYear();
                                const month = String(dateObj.getMonth() + 1).padStart(2, '0');
                                const day = String(dateObj.getDate()).padStart(2, '0');
                                const hours = String(dateObj.getHours()).padStart(2, '0');
                                const minutes = String(dateObj.getMinutes()).padStart(2, '0');
                                formattedDate = `${year}-${month}-${day} ${hours}:${minutes}`;
                            }
                        } catch (e) {
                            // If parsing or formatting fails, originalDateString is already set as fallback
                        }
                        return `  - ${(i.title || i.text || i.id || 'Unknown Item').substring(
                            0,
                            70
                        )}... (Date: ${formattedDate})`;
                    })
                    .join('\n')
        );
    } else {
        logger.debug(
            `NM: Interval Filter: No items filtered out. ${itemsBeforeIntervalFilter.length} before, ${filteredItems.length} after.`
        );
    }

    // 2. Filter RSS articles not in whitelist.
    const itemsBeforeWhitelistFilter = [...filteredItems];
    const whitelistFilteredOutItems = [];
    if (filteredItems.length > 0) {
        const whitelistPaths = NEWS_MONITOR_CONFIG.CONTENT_FILTERING?.WHITELIST_PATHS || [];
        if (whitelistPaths.length === 0) logger.warn('NM: WHITELIST_PATHS is empty.');

        filteredItems = filteredItems.filter(item => {
            const shouldKeep = isItemWhitelisted(item, whitelistPaths);
            if (!shouldKeep) {
                whitelistFilteredOutItems.push(item);
            }
            return shouldKeep;
        });

        if (whitelistFilteredOutItems.length > 0) {
            logger.debug(
                `NM: RSS Whitelist Filter: ${itemsBeforeWhitelistFilter.length} before, ${filteredItems.length} after. Filtered out ${whitelistFilteredOutItems.length} items:\n` +
                    whitelistFilteredOutItems
                        .map(i => {
                            let displayPath = i.link; // Default to full link
                            if (i.link) {
                                try {
                                    const urlObj = new URL(i.link);
                                    let pathname = urlObj.pathname;
                                    const rawSegments = pathname
                                        .split('/')
                                        .filter(seg => seg.length > 0); // Filter out empty segments

                                    if (rawSegments.length > 0) {
                                        displayPath = '/' + rawSegments.slice(0, 5).join('/');
                                    } else {
                                        displayPath = pathname; // Fallback to original pathname if no segments
                                    }
                                } catch (e) {
                                    logger.warn(
                                        `NM: Could not parse URL for whitelist log: ${i.link} - ${e.message}`
                                    );
                                    // displayPath remains the full link as set initially
                                }
                            }
                            return `  - ${(i.title || i.id || 'Unknown Item').substring(
                                0,
                                70
                            )}... (Path: ${displayPath})`;
                        })
                        .join('\n')
            );
        } else {
            logger.debug(
                `NM: RSS Whitelist Filter: No items filtered out. ${itemsBeforeWhitelistFilter.length} before, ${filteredItems.length} after.`
            );
        }
    }

    // 3. Apply blacklist keyword filter.
    const itemsBeforeBlacklistFilter = [...filteredItems];
    const blacklistFilteredOutItems = [];
    if (filteredItems.length > 0) {
        const blacklistKeywords = NEWS_MONITOR_CONFIG.CONTENT_FILTERING?.BLACKLIST_KEYWORDS || [];
        if (blacklistKeywords.length > 0) {
            const itemsPassingBlacklist = [];
            for (const item of filteredItems) {
                let skipThisFilter = false;
                if (item.accountName) {
                    // It's a tweet
                    const sourceConfig = NEWS_MONITOR_CONFIG.sources.find(
                        s => s.type === 'twitter' && s.username === item.accountName
                    );
                    if (sourceConfig && sourceConfig.skipEvaluation) {
                        skipThisFilter = true;
                    }
                }

                if (skipThisFilter) {
                    itemsPassingBlacklist.push(item);
                } else {
                    const shouldExclude = itemContainsBlacklistedKeyword(item, blacklistKeywords);
                    if (shouldExclude) {
                        blacklistFilteredOutItems.push(item);
                    } else {
                        itemsPassingBlacklist.push(item);
                    }
                }
            }
            filteredItems = itemsPassingBlacklist;

            if (blacklistFilteredOutItems.length > 0) {
                logger.debug(
                    `NM: Blacklist Keyword Filter: ${itemsBeforeBlacklistFilter.length} before, ${filteredItems.length} after. Filtered out ${blacklistFilteredOutItems.length} items:
` +
                        blacklistFilteredOutItems
                            .map(
                                i =>
                                    `  - ${(i.title || i.text || i.id || 'Unknown Item').substring(
                                        0,
                                        70
                                    )}...`
                            )
                            .join('\n')
                );
            } else {
                logger.debug(
                    `NM: Blacklist Keyword Filter: No items filtered out. ${itemsBeforeBlacklistFilter.length} before, ${filteredItems.length} after.`
                );
            }
        } else {
            logger.debug('NM: No blacklist keywords. Skipping blacklist filter.');
        }
    }

    // 3.5: Image Text Extraction and `item.text` Update for `mediaOnly` Tweets
    // IMPORTANT: This happens BEFORE content evaluation so that mediaOnly tweets are evaluated using extracted image text
    if (filteredItems.length > 0) {
        logger.debug(
            `NM: Starting image text extraction & update for mediaOnly tweets (before evaluation). Items: ${filteredItems.length}`
        );
        const itemsPostImageTextProcessing = [];
        for (const item of filteredItems) {
            let removeItemDueToImageIssue = false;
            if (item.accountName) {
                // It's a tweet
                const sourceConfig = NEWS_MONITOR_CONFIG.sources.find(
                    s => s.type === 'twitter' && s.username === item.accountName
                );

                if (sourceConfig && sourceConfig.mediaOnly) {
                    item.originalText = item.text; // Preserve original text

                    const photoMedia = item.media?.find(m => m.type === 'photo');

                    if (photoMedia && photoMedia.url) {
                        // Always use the generic image text extraction prompt now
                        const imageTextExtractionPromptName =
                            'PROCESS_IMAGE_TEXT_EXTRACTION_PROMPT';
                        const imageTextExtractionPrompt =
                            NEWS_MONITOR_CONFIG.PROMPTS[imageTextExtractionPromptName];
                        const modelForImageText =
                            NEWS_MONITOR_CONFIG.AI_MODELS[imageTextExtractionPromptName] ||
                            NEWS_MONITOR_CONFIG.AI_MODELS.DEFAULT;

                        if (imageTextExtractionPrompt) {
                            try {
                                logger.debug(
                                    `NM: Extracting image text for @${item.accountName} (tweet ${item.id}) using ${imageTextExtractionPromptName} with model ${modelForImageText}`
                                );
                                const extractedText = await extractTextFromImageWithOpenAI(
                                    photoMedia.url,
                                    imageTextExtractionPrompt,
                                    modelForImageText
                                );

                                // Validate extracted text quality
                                function isValidExtractedText(text) {
                                    if (!text || text.trim() === '') return false;
                                    
                                    const trimmedText = text.trim().toLowerCase();
                                    
                                    // Check for specific "no text" responses
                                    if (trimmedText === 'nenhum texto relevante detectado na imagem.' ||
                                        trimmedText === 'nenhum texto detectado na imagem.') {
                                        return false;
                                    }
                                    
                                    // Check if text is too short to be meaningful (less than 10 characters)
                                    if (trimmedText.length < 10) return false;
                                    
                                    // Check for excessive character repetition (more than 70% same character)
                                    const charCounts = {};
                                    for (const char of trimmedText.replace(/\s/g, '')) {
                                        charCounts[char] = (charCounts[char] || 0) + 1;
                                    }
                                    const maxCount = Math.max(...Object.values(charCounts));
                                    const totalChars = trimmedText.replace(/\s/g, '').length;
                                    if (totalChars > 0 && (maxCount / totalChars) > 0.7) return false;
                                    
                                    // Check if text has reasonable word structure (at least 2 words with 2+ chars each)
                                    const words = trimmedText.split(/\s+/).filter(word => word.length >= 2);
                                    if (words.length < 2) return false;
                                    
                                    // Check for random character sequences (too many consecutive consonants/vowels)
                                    const consecutivePattern = /[bcdfghjklmnpqrstvwxyz]{6,}|[aeiou]{5,}/i;
                                    if (consecutivePattern.test(trimmedText)) return false;
                                    
                                    return true;
                                }

                                if (extractedText && isValidExtractedText(extractedText)) {
                                    item.text = extractedText; // REPLACE item.text
                                    logger.debug(
                                        `NM: item.text for @${item.accountName} (tweet ${
                                            item.id
                                        }) UPDATED with extracted image text: "${extractedText.substring(
                                            0,
                                            100
                                        )}..."`
                                    );
                                } else {
                                    const msg = `NM: Invalid/nonsensical text from image for @${
                                        item.accountName
                                    } (tweet ${
                                        item.id
                                    }). Extracted: "${(extractedText || '').substring(
                                        0,
                                        100
                                    )}...". Using original: "${item.originalText.substring(
                                        0,
                                        100
                                    )}..."`;
                                    logger.debug(msg);
                                    item.text = item.originalText; // Keep original if extraction yields nonsensical text
                                    if (sourceConfig.username === 'SITREP_artorias') {
                                        // SITREP needs meaningful image text
                                        logger.warn(
                                            `NM: SITREP_artorias tweet ${item.id} got nonsensical image text. Marking for removal.`
                                        );
                                        removeItemDueToImageIssue = true;
                                    }
                                }
                            } catch (imgExtractError) {
                                logger.error(
                                    `NM: Error extracting image text for @${item.accountName} (tweet ${item.id}): ${imgExtractError.message}. Using original text.`
                                );
                                item.text = item.originalText;
                                if (sourceConfig.username === 'SITREP_artorias') {
                                    // SITREP needs image text
                                    logger.warn(
                                        `NM: SITREP_artorias tweet ${item.id} failed image extraction. Marking for removal.`
                                    );
                                    removeItemDueToImageIssue = true;
                                }
                            }
                        } else {
                            logger.warn(
                                `NM: The standard image text extraction prompt (${imageTextExtractionPromptName}) is not configured. Cannot process image for @${item.accountName}. Original text kept.`
                            ); // Changed from debug to warn
                            item.text = item.originalText;
                            // If even the standard prompt is missing, SITREP (and potentially others if configured strictly) would fail
                            if (sourceConfig.username === 'SITREP_artorias') {
                                logger.warn(
                                    `NM: SITREP_artorias tweet ${item.id} cannot extract image text due to missing standard prompt. Marking for removal.`
                                );
                                removeItemDueToImageIssue = true;
                            }
                        }
                    } else {
                        // No photo URL found for mediaOnly tweet
                        logger.debug(
                            `NM: mediaOnly tweet @${item.accountName} (tweet ${item.id}) has no photo URL. Original text kept.`
                        );
                        item.text = item.originalText;
                        if (sourceConfig.username === 'SITREP_artorias') {
                            // SITREP MUST have an image
                            logger.warn(
                                `NM: SITREP_artorias tweet ${item.id} missing photo. Marking for removal.`
                            );
                            removeItemDueToImageIssue = true;
                        }
                    }
                }
            }
            if (!removeItemDueToImageIssue) {
                itemsPostImageTextProcessing.push(item);
            }
        }
        const itemsActuallyRemovedCount =
            filteredItems.length - itemsPostImageTextProcessing.length;
        filteredItems = itemsPostImageTextProcessing;
        if (itemsActuallyRemovedCount > 0) {
            logger.debug(
                `NM: Image Text Processing & Update: Removed ${itemsActuallyRemovedCount} items (SITREP/mediaOnly issues). ${filteredItems.length} remaining.`
            );
        } else {
            logger.debug(
                `NM: Image Text Processing & Update: All ${filteredItems.length} items retained or original text kept.`
            );
        }
    }

    // 3.6: Link Content Processing for Short Tweets
    // Process links in short tweets (but not mediaOnly tweets where images take priority)
    // This happens AFTER image extraction but BEFORE content evaluation
    if (filteredItems.length > 0) {
        logger.debug(
            `NM: Starting link content processing for short tweets. Items: ${filteredItems.length}`
        );
        const itemsPostLinkProcessing = [];
        for (const item of filteredItems) {
            if (item.accountName) {
                // It's a tweet - process it for link content if applicable
                const processedItem = await processLinkContentForShortTweets(item, NEWS_MONITOR_CONFIG);
                itemsPostLinkProcessing.push(processedItem);
            } else {
                // Not a tweet - pass through unchanged
                itemsPostLinkProcessing.push(item);
            }
        }
        filteredItems = itemsPostLinkProcessing;
        
        const linkProcessedCount = filteredItems.filter(item => item.linkProcessed).length;
        if (linkProcessedCount > 0) {
            logger.debug(
                `NM: Link Content Processing: Processed links for ${linkProcessedCount} short tweets out of ${filteredItems.length} total items.`
            );
        } else {
            logger.debug(
                `NM: Link Content Processing: No short tweets with links found for processing.`
            );
        }
    }

    // 5. Apply account-specific filters (for Twitter).
    const itemsBeforeAccountSpecificFilter = [...filteredItems];
    const accountSpecificFilteredOutItems = [];
    if (filteredItems.length > 0) {
        const itemsPassingAccountFilter = [];
        for (const item of filteredItems) {
            let passedAccountSpecificEval = true; // Default to pass, especially if not applicable
            if (item.accountName) {
                // It's a tweet
                const sourceConfig = NEWS_MONITOR_CONFIG.sources.find(
                    s => s.type === 'twitter' && s.username === item.accountName
                );
                if (sourceConfig && sourceConfig.skipEvaluation) {
                    // Already set to true, so it passes
                } else {
                    // Only evaluate if not skipping and it's a tweet with a configured account for prompts
                    if (sourceConfig && sourceConfig.promptSpecific) {
                        // Check if promptSpecific is configured
                        passedAccountSpecificEval = await evaluateItemWithAccountSpecificPrompt(
                            item,
                            NEWS_MONITOR_CONFIG
                        );
                    } // else, if no promptSpecific, it implicitly passes this filter stage
                }
            } else {
                // For RSS or other types, they don't have accountName for this filter, so they pass.
                // evaluateItemWithAccountSpecificPrompt itself handles non-applicable items gracefully.
                passedAccountSpecificEval = await evaluateItemWithAccountSpecificPrompt(
                    item,
                    NEWS_MONITOR_CONFIG
                );
            }

            if (passedAccountSpecificEval) {
                itemsPassingAccountFilter.push(item);
            } else {
                accountSpecificFilteredOutItems.push(item);
            }
        }
        filteredItems = itemsPassingAccountFilter;
        if (accountSpecificFilteredOutItems.length > 0) {
            logger.debug(
                `NM: Account-Specific Filter: ${itemsBeforeAccountSpecificFilter.length} before, ${filteredItems.length} after. Filtered out ${accountSpecificFilteredOutItems.length} items:
` +
                    accountSpecificFilteredOutItems
                        .map(
                            i =>
                                `  - @${i.accountName}: ${(
                                    i.text ||
                                    i.id ||
                                    'Unknown Tweet'
                                ).substring(0, 60)}...`
                        )
                        .join('\n')
            );
        } else {
            logger.debug(
                `NM: Account-Specific Filter: No items filtered out. ${itemsBeforeAccountSpecificFilter.length} before, ${filteredItems.length} after.`
            );
        }
    }

    // 6. Perform batch title evaluation for RSS items.
    const itemsBeforeBatchTitleEval = [...filteredItems];
    const batchTitleEvalFilteredOutItems = [];
    if (filteredItems.length > 0) {
        const rssItemsForBatchEval = filteredItems.filter(
            item => item.feedName && item.title && item.title.trim() !== ''
        );
        const nonRssOrNoTitleItems = filteredItems.filter(
            item => !item.feedName || !item.title || item.title.trim() === ''
        );
        let processedRssItems = [];

        if (rssItemsForBatchEval.length > 0) {
            const titlesToEvaluate = rssItemsForBatchEval.map(
                (item, index) => `${index + 1}. ${item.title}`
            );
            const promptTemplate = NEWS_MONITOR_CONFIG.PROMPTS.BATCH_EVALUATE_TITLES;
            const modelName =
                NEWS_MONITOR_CONFIG.AI_MODELS.BATCH_EVALUATE_TITLES ||
                NEWS_MONITOR_CONFIG.AI_MODELS.DEFAULT;
            const formattedPrompt = promptTemplate.replace('{titles}', titlesToEvaluate.join('\n'));

            try {
                logger.debug(
                    `NM: Performing batch title evaluation for ${rssItemsForBatchEval.length} RSS items using model ${modelName}.`
                );
                const result = await runCompletion(
                    formattedPrompt,
                    0.3,
                    modelName, // Pass the derived modelName here
                    'BATCH_EVALUATE_TITLES'
                );

                // Enhanced batch evaluation response validation
                if (!result || typeof result !== 'string') {
                    logger.warn(`NM: Invalid AI response for batch title evaluation: ${result}. Keeping all RSS items.`);
                    processedRssItems = [...rssItemsForBatchEval];
                } else {
                    const cleanedResult = result.trim();

                    // Handle completely unexpected responses (single characters, nonsense)
                    if (cleanedResult.length <= 2 && cleanedResult !== '0') {
                        logger.warn(`NM: Batch title evaluation received unexpected short response: "${result}". Keeping all RSS items.`);
                        processedRssItems = [...rssItemsForBatchEval];
                    } else if (cleanedResult === '0') {
                        // Handle "0" response (no relevant items)
                        logger.debug(`NM: Batch title evaluation marked all items as irrelevant.`);
                        batchTitleEvalFilteredOutItems.push(...rssItemsForBatchEval);
                        processedRssItems = []; // No items pass
                    } else {
                        // Parse the response more robustly
                        let relevantIndices = [];
                        try {
                            relevantIndices = cleanedResult
                                .split(',')
                                .map(numStr => parseInt(numStr.trim(), 10) - 1) // 0-indexed
                                .filter(num => !isNaN(num) && num >= 0 && num < rssItemsForBatchEval.length);
                        } catch (parseError) {
                            logger.warn(`NM: Error parsing batch evaluation response "${cleanedResult}": ${parseError.message}. Keeping all RSS items.`);
                            processedRssItems = [...rssItemsForBatchEval];
                        }

                        // If no valid indices were parsed, keep all items to be safe
                        if (relevantIndices.length === 0 && cleanedResult !== '0') {
                            logger.warn(`NM: Batch evaluation response "${cleanedResult}" produced no valid indices. Keeping all RSS items.`);
                            processedRssItems = [...rssItemsForBatchEval];
                        } else {
                            // Process the items based on relevantIndices
                            rssItemsForBatchEval.forEach((item, index) => {
                                if (relevantIndices.includes(index)) {
                                    processedRssItems.push(item);
                                } else {
                                    batchTitleEvalFilteredOutItems.push(item);
                                }
                            });
                        }
                    }
                }
                logger.debug(
                    `NM: Batch title evaluation kept ${processedRssItems.length} of ${rssItemsForBatchEval.length} RSS items.`
                );
            } catch (error) {
                logger.error(
                    `NM: Error during batch title evaluation: ${error.message}. Keeping all RSS items intended for batch eval.`
                );
                processedRssItems = [...rssItemsForBatchEval]; // Keep all on error
            }
        }
        filteredItems = [...nonRssOrNoTitleItems, ...processedRssItems];
        if (batchTitleEvalFilteredOutItems.length > 0) {
            logger.debug(
                `NM: Batch RSS Title Evaluation: ${itemsBeforeBatchTitleEval.length} before, ${filteredItems.length} after. Filtered out ${batchTitleEvalFilteredOutItems.length} items:
` +
                    batchTitleEvalFilteredOutItems
                        .map(
                            i =>
                                `  - RSS (${i.feedName}): ${(
                                    i.title ||
                                    i.id ||
                                    'Unknown Item'
                                ).substring(0, 70)}...`
                        )
                        .join('\n')
            );
        } else {
            logger.debug(
                `NM: Batch RSS Title Evaluation: No items filtered out. ${itemsBeforeBatchTitleEval.length} before, ${filteredItems.length} after.`
            );
        }
    }

    // 7. Full content evaluation
    const itemsBeforeFullContentEval = [...filteredItems];
    const fullContentEvalFilteredOutItems = [];
    if (filteredItems.length > 0) {
        const itemsPassingFullContentEval = [];
        
        // Get recent news cache for historical context
        let recentNewsCache = [];
        try {
            const cacheData = readCache();
            if (cacheData && Array.isArray(cacheData.items)) {
                recentNewsCache = cacheData.items.slice(-10); // Get last 10 items for context
            }
        } catch (error) {
            logger.warn(`NM: Could not read cache for full content evaluation: ${error.message}`);
            recentNewsCache = [];
        }
        
        for (const item of filteredItems) {
            let passedFullContentEval = true; // Default to pass

            if (item.accountName) {
                // It's a tweet. For mediaOnly tweets, evaluation now uses extracted image text (from step 3.5).
                const sourceConfig = NEWS_MONITOR_CONFIG.sources.find(
                    s => s.type === 'twitter' && s.username === item.accountName
                );
                if (sourceConfig && sourceConfig.skipEvaluation) {
                    item.relevanceJustification = 'Evaluation skipped (Source Config)';
                } else {
                    // evaluateItemFullContent uses item.text which is now extracted image text for mediaOnly tweets
                    passedFullContentEval = await evaluateItemFullContent(
                        item, // item.text is extracted image text for mediaOnly, original text for others
                        NEWS_MONITOR_CONFIG,
                        recentNewsCache // Pass recent news cache for context
                    );
                }
            } else {
                // For RSS items or any other non-Twitter items
                passedFullContentEval = await evaluateItemFullContent(item, NEWS_MONITOR_CONFIG, recentNewsCache);
            }

            if (passedFullContentEval) {
                itemsPassingFullContentEval.push(item);
            } else {
                fullContentEvalFilteredOutItems.push(item);
            }
        }
        filteredItems = itemsPassingFullContentEval;
        if (fullContentEvalFilteredOutItems.length > 0) {
            logger.debug(
                `NM: Full Content Evaluation: ${itemsBeforeFullContentEval.length} before, ${filteredItems.length} after. Filtered out ${fullContentEvalFilteredOutItems.length} items:\n` +
                    fullContentEvalFilteredOutItems
                        .map(
                            i =>
                                `  - ${(i.title || i.text || i.id || 'Unknown Item').substring(
                                    0,
                                    70
                                )}... (AI Justification: ${i.relevanceJustification || 'N/A'})`
                        )
                        .join('\n') // Corrected: was join('\n ') which is likely not intended
            );
        } else {
            logger.debug(
                `NM: Full Content Evaluation: No items filtered out. ${itemsBeforeFullContentEval.length} before, ${filteredItems.length} after.`
            );
        }
    }

    // 8. Check for duplicates against historical cache
    const itemsBeforeDuplicateCheck = [...filteredItems];
    const duplicateCheckFilteredOutItems = [];
    if (
        filteredItems.length > 0 &&
        NEWS_MONITOR_CONFIG.HISTORICAL_CACHE?.ENABLED &&
        NEWS_MONITOR_CONFIG.PROMPTS?.DETECT_DUPLICATE
    ) {
        let cachedItems = [];
        try {
            // Use readCache from persistentCache.js
            const cacheData = readCache(); // readCache() returns the full cache object
            if (cacheData && Array.isArray(cacheData.items)) {
                cachedItems = cacheData.items;
            }
            if (cachedItems.length === 0) {
                logger.debug(
                    `NM: newsCache.json (via readCache) is empty or has no items. No previous items to check for duplicates.`
                );
            }
        } catch (error) {
            logger.error(
                `NM: Error reading or parsing newsCache.json via readCache(): ${error.message}. Treating as empty cache.`
            );
            cachedItems = []; // Ensure it's an array on error
        }

        if (cachedItems.length > 0) {
            const nonDuplicateItems = [];
            for (const item of filteredItems) {
                if (!(await checkIfDuplicate(item, cachedItems, NEWS_MONITOR_CONFIG))) {
                    nonDuplicateItems.push(item);
                } else {
                    duplicateCheckFilteredOutItems.push(item);
                }
            }
            filteredItems = nonDuplicateItems;
            if (duplicateCheckFilteredOutItems.length > 0) {
                logger.debug(
                    `NM: Duplicate Check Filter: ${itemsBeforeDuplicateCheck.length} before, ${filteredItems.length} after. Filtered out ${duplicateCheckFilteredOutItems.length} items:\n` +
                        duplicateCheckFilteredOutItems
                            .map(
                                i =>
                                    `  - ${(i.title || i.text || i.id || 'Unknown Item').substring(
                                        0,
                                        70
                                    )}...`
                            )
                            .join('\n')
                );
            } else {
                logger.debug(
                    `NM: Duplicate Check Filter: No items filtered out. ${itemsBeforeDuplicateCheck.length} before, ${filteredItems.length} after.`
                );
            }
        } else {
            logger.debug(
                'NM: No cached items found or HISTORICAL_CACHE disabled. Skipping duplicate check.'
            );
        }
    }

    // 9. Apply traditional topic redundancy filter for within-batch deduplication with source priority
    if (filteredItems.length > 0 && NEWS_MONITOR_CONFIG.PROMPTS?.DETECT_TOPIC_REDUNDANCY) {
        logger.debug(`NM: Applying traditional topic redundancy filter for within-batch deduplication to ${filteredItems.length} items.`);
        filteredItems = await filterByTopicRedundancy(filteredItems, NEWS_MONITOR_CONFIG);
    }

    // 10. Apply enhanced topic redundancy filter for topic-based filtering against historical content
    if (filteredItems.length > 0 && NEWS_MONITOR_CONFIG.TOPIC_FILTERING?.ENABLED) {
        logger.debug(`NM: Applying enhanced topic redundancy filter for topic-based filtering to ${filteredItems.length} items.`);
        filteredItems = await filterByEnhancedTopicRedundancy(filteredItems, NEWS_MONITOR_CONFIG);
    }

    logger.debug(`NM: Remaining items after all filters: ${filteredItems.length}`);

    if (filteredItems.length > 0 && targetGroup) {
        logger.debug(`NM: Processing ${filteredItems.length} final items for sending.`);
        for (const item of filteredItems) {
            try {
                let messageToSend = '';
                let mediaToSend = null;
                let summaryForMessage = ''; // This will hold the AI-generated summary

                const sourceConfig = item.accountName
                    ? NEWS_MONITOR_CONFIG.sources.find(
                          s => s.type === 'twitter' && s.username === item.accountName
                      )
                    : null;

                if (item.accountName && sourceConfig) {
                    // Twitter Item - ALL KINDS (regular, mediaOnly, SITREP after step 3.5)
                    // item.text is the original tweet text, or image-extracted text from step 3.5
                    // This text is untranslated at this point.
                    logger.debug(
                        `NM: Generating summary for Tweet @${item.accountName} (ID: ${
                            item.id
                        }). Original text: "${(item.text || '').substring(0, 70)}..."`
                    );
                    summaryForMessage = await generateSummary(
                        `Tweet de @${item.accountName}`, // Pass a generic title for tweets
                        item.text || '', // Pass original/image-extracted text
                        NEWS_MONITOR_CONFIG
                    );

                    sentItemCacheData = {
                        id: item.id,
                        type: 'tweet',
                        content: summaryForMessage, // Cache the AI-generated summary
                        timestamp: Date.now(),
                        justification: item.relevanceJustification || 'Relevant (summarized)',
                        username: item.accountName,
                    };

                    if (
                        sourceConfig.skipEvaluation &&
                        sentItemCacheData.justification === 'Relevant (summarized)'
                    ) {
                        sentItemCacheData.justification =
                            'Evaluation skipped (Source Config), summarized';
                    }

                    messageToSend =
                        '*Breaking News* 🗞️' +
                        '\n' +
                        '*Tweet de @' +
                        item.accountName +
                        '*' +
                        '\n\n' +
                        summaryForMessage +
                        '\n\n' +
                        'Fonte: @' +
                        item.accountName +
                        '\n' +
                        'https://twitter.com/' +
                        item.accountName +
                        '/status/' +
                        item.id;

                    // Handle media for tweets (mediaOnly or regular tweets with optional photos)
                    // SITREP_artorias is now text-based by this point due to step 3.5; its media was the source of item.text.
                    // For other mediaOnly, or regular tweets with photos, attach the photo.
                    if (sourceConfig.mediaOnly && item.accountName !== 'SITREP_artorias') {
                        // Non-SITREP mediaOnly
                        const photoMediaObj = item.mediaObjects?.find(m => m.type === 'photo');
                        if (
                            photoMediaObj &&
                            (photoMediaObj.url || photoMediaObj.preview_image_url)
                        ) {
                            try {
                                const imageUrl =
                                    photoMediaObj.url || photoMediaObj.preview_image_url;
                                logger.debug(
                                    `NM: Fetching image ${imageUrl} for mediaOnly tweet @${item.accountName}`
                                );
                                const imageResponse = await axios.get(imageUrl, {
                                    responseType: 'arraybuffer',
                                });
                                const imageName =
                                    path.basename(new URL(imageUrl).pathname) || 'image.jpg';
                                mediaToSend = new MessageMedia(
                                    'image/jpeg',
                                    Buffer.from(imageResponse.data).toString('base64'),
                                    imageName
                                );
                                logger.debug(
                                    `NM: Image prepared for mediaOnly tweet @${item.accountName}`
                                );
                                // Caption is already set via messageToSend using the summary
                            } catch (imgError) {
                                logger.error(
                                    `NM: Error fetching image for mediaOnly tweet @${item.accountName} (${item.id}): ${imgError.message}. Will send summary as text only.`
                                );
                                mediaToSend = null;
                            }
                        } else {
                            logger.warn(
                                `NM: Media-only (non-SITREP) tweet from @${item.accountName} (${item.id}) has no photo. Sending summary as text only.`
                            );
                        }
                    } else if (!sourceConfig.mediaOnly) {
                        // Regular tweet, check for optional photo
                        const photoMediaObj = item.mediaObjects?.find(m => m.type === 'photo');
                        if (
                            photoMediaObj &&
                            (photoMediaObj.url || photoMediaObj.preview_image_url)
                        ) {
                            try {
                                const imageUrl =
                                    photoMediaObj.url || photoMediaObj.preview_image_url;
                                logger.debug(
                                    `NM: Fetching image ${imageUrl} for tweet @${item.accountName}`
                                );
                                const imageResponse = await axios.get(imageUrl, {
                                    responseType: 'arraybuffer',
                                });
                                const imageName =
                                    path.basename(new URL(imageUrl).pathname) || 'image.jpg';
                                mediaToSend = new MessageMedia(
                                    'image/jpeg',
                                    Buffer.from(imageResponse.data).toString('base64'),
                                    imageName
                                );
                                logger.debug(`NM: Image prepared for tweet @${item.accountName}`);
                            } catch (imgError) {
                                logger.error(
                                    `NM: Error fetching image for tweet @${item.accountName} (${item.id}): ${imgError.message}. Sending summary as text only.`
                                );
                                mediaToSend = null;
                            }
                        }
                    }
                    // Note: The complex SITREP_artorias specific image re-extraction and translation block is removed here
                    // as item.text is already populated from image (step 3.5) and generateSummary handles translation.
                } else if (item.feedName) {
                    // RSS Item
                    // item.title and item.content are original, untranslated.
                    logger.debug(
                        `NM: Generating summary for RSS Article: "${(
                            item.title || 'No Title'
                        ).substring(0, 50)}...". Original content: "${(
                            item.content ||
                            item.description ||
                            ''
                        ).substring(0, 70)}..."`
                    );
                    summaryForMessage = await generateSummary(
                        item.title || 'Artigo sem título', // Pass original title
                        item.content || item.description || item.title || '', // Pass original content
                        NEWS_MONITOR_CONFIG
                    );

                    // The title displayed in the message should ideally also be translated.
                    // Since generateSummary's prompt aims to translate both, but only outputs the summary,
                    // we might use the original title here, or assume the summary is comprehensive.
                    // For now, using original item.title in the message header.
                    // If the AI includes a summarized/translated title in its 3 bullets, that's fine.
                    messageToSend =
                        '*Breaking News* 🗞️' +
                        '\n\n' +
                        '*' +
                        (item.title || 'Notícia') +
                        '*' +
                        '\n\n' +
                        summaryForMessage +
                        '\n\n' +
                        'Fonte: ' +
                        item.feedName +
                        '\n' +
                        item.link;

                    sentItemCacheData = {
                        id: item.link,
                        type: 'article',
                        content: summaryForMessage, // Cache the AI-generated summary
                        timestamp: Date.now(),
                        justification: item.relevanceJustification || 'Relevant (summarized)',
                        feedId: item.feedName, // Retain feedId for cache structure
                    };
                } else {
                    logger.warn(
                        `NM: Unknown item type, cannot process for sending: ${JSON.stringify(
                            item
                        ).substring(0, 100)}...`
                    );
                    continue;
                }

                if (messageToSend && targetGroup) {
                    let logTitleOrAccount;
                    let logCacheContentPreview = ` - Summary: "${(
                        sentItemCacheData.content || ''
                    ).substring(0, 50)}..."`;

                    if (sentItemCacheData.type === 'tweet') {
                        logTitleOrAccount = `@${sentItemCacheData.username}`;
                    } else {
                        // article
                        logTitleOrAccount = `RSS: ${item.feedName} - Title: "${(
                            item.title || ''
                        ).substring(0, 50)}..."`;
                    }
                    const logJustification = sentItemCacheData.justification || 'N/A';

                    logger.info(
                        `Sending to group "${targetGroup.name}": ${logTitleOrAccount}${logCacheContentPreview} - Justification: ${logJustification}`
                    );

                    if (mediaToSend) {
                        // This will be true for mediaOnly tweets or regular tweets with images
                        await targetGroup.sendMessage(mediaToSend, { caption: messageToSend });
                    } else {
                        await targetGroup.sendMessage(messageToSend);
                    }
                    await recordSentItemToCache(sentItemCacheData, NEWS_MONITOR_CONFIG);
                } else if (!targetGroup) {
                    logger.warn('NM: Target group not found. Cannot send message.');
                }
            } catch (error) {
                logger.error(
                    `NM: Error processing item ${item.id || item.link} for sending: ${
                        error.message
                    }`,
                    error.stack
                );
            }
        }
    } else if (filteredItems.length > 0 && !targetGroup) {
        logger.warn(
            `NM: ${filteredItems.length} items were ready to be sent, but target group is not available.`
        );
    } else {
        logger.debug('NM: No items to send.');
    }

    // Update last run timestamp for successful runs (excluding quiet hours)
    // This ensures that news published during quiet hours will be considered in the next run
    if (!isQuietHours()) {
        updateLastRunTimestamp(Date.now());
        logger.debug('NM: Updated last run timestamp for successful processing cycle.');
    } else {
        logger.debug('NM: Skipping last run timestamp update due to quiet hours.');
    }

    logger.debug('NM: Processing cycle finished.');
}

/**
 * Gets the current status of the News Monitor for startup reporting.
 * This function provides comprehensive status without triggering initialization.
 * @returns {Object} Object containing news monitor status information
 */
async function getNewsMonitorStartupStatus() {
    const enabledSources = NEWS_MONITOR_CONFIG.sources.filter(source => source.enabled);
    
    // Collect source information by type
    const twitterSources = enabledSources
        .filter(s => s.type === 'twitter')
        .map(s => s.username);
    
    const rssSources = enabledSources
        .filter(s => s.type === 'rss')
        .map(s => s.name || s.id);
    
    const webscraperSources = enabledSources
        .filter(s => s.type === 'webscraper')
        .map(s => s.name);

    // Get target group status - wait for WhatsApp to be ready
    let targetGroupStatus = 'Not found';
    try {
        if (global.client) {
            const targetGroupName = NEWS_MONITOR_CONFIG.TARGET_GROUP;
            if (targetGroupName) {
                try {
                    // Actually check for the target group
                    const chats = await global.client.getChats();
                    const targetGroup = chats.find(chat => chat.name === targetGroupName);
                    
                    if (targetGroup) {
                        targetGroupStatus = `Found: ${targetGroupName}`;
                    } else {
                        targetGroupStatus = `Not found: ${targetGroupName}`;
                    }
                } catch (chatError) {
                    targetGroupStatus = `Error checking: ${targetGroupName} (${chatError.message})`;
                }
            } else {
                targetGroupStatus = 'No target group configured';
            }
        } else {
            targetGroupStatus = 'WhatsApp client not available';
        }
    } catch (error) {
        targetGroupStatus = `Error: ${error.message}`;
    }

    // Get API keys status from twitterApiHandler if available
    let apiKeysStatus = [];
    try {
        // Try to get current API key status
        apiKeysStatus = twitterApiHandler.getApiKeysStatus();
        
        // If no keys returned or all show as unusable, check if they're in cooldown
        if (apiKeysStatus.length === 0 || apiKeysStatus.every(key => key.status === 'unified_api_cooldown')) {
            // Try to get cooldown information from the handler
            const cooldownInfo = twitterApiHandler.getCooldownInfo ? twitterApiHandler.getCooldownInfo() : null;
            if (cooldownInfo && cooldownInfo.isInCooldown) {
                // Calculate minutes remaining
                const waitMinutes = Math.ceil((cooldownInfo.cooldownEndTimestamp - Date.now()) / 60000);
                apiKeysStatus = [{
                    name: 'Keys on cooldown',
                    usage: `Waiting ~${waitMinutes} minute(s) (until ${cooldownInfo.cooldownUntil})`,
                    limit: 'N/A',
                    resetDate: `Until ${cooldownInfo.cooldownUntil}`,
                    status: 'cooldown'
                }];
            } else if (apiKeysStatus.length === 0) {
                apiKeysStatus = [{ name: 'Initializing...', usage: 0, limit: 0, resetDate: 'Pending' }];
            }
        }
    } catch (error) {
        // If not initialized yet, return placeholder
        apiKeysStatus = [{ name: 'Initializing...', usage: 0, limit: 0, resetDate: 'Pending' }];
    }

    return {
        enabled: NEWS_MONITOR_CONFIG.enabled,
        totalSources: enabledSources.length,
        twitterSources: twitterSources.length > 0 ? twitterSources : ['None'],
        rssSources: rssSources.length > 0 ? rssSources : ['None'],
        webscraperSources: webscraperSources.length > 0 ? webscraperSources : ['None'],
        targetGroup: targetGroupStatus,
        apiKeys: apiKeysStatus
    };
}

/**
 * Initializes the News Monitor.
 * Sets up the periodic execution of the news processing cycle.
 * @returns {Promise<boolean>} - True if initialization was successful, false otherwise.
 */
async function initialize() {
    if (!NEWS_MONITOR_CONFIG.enabled) {
        logger.debug('NM: Master toggle disabled. Not starting.');
        return false;
    }
    logger.debug('NM: Initializing...');

    try {
        if (typeof global.client === 'undefined' || !global.client) {
            logger.error('NM: global.client is not available. WhatsApp functionalities will fail.');
            targetGroup = null;
        } else {
            const chats = await global.client.getChats();
            targetGroup = chats.find(chat => chat.name === NEWS_MONITOR_CONFIG.TARGET_GROUP);

            if (!targetGroup) {
                logger.error(
                    `NM: Target group "${NEWS_MONITOR_CONFIG.TARGET_GROUP}" not found during initialization. Sending will fail.`
                );
            } else {
                logger.debug(
                    `NM: Target group "${NEWS_MONITOR_CONFIG.TARGET_GROUP}" found and set.`
                );
            }
        }
    } catch (err) {
        logger.error(
            `NM: Error finding target group: ${err.message}. global.client might not be available or getChats failed.`
        );
        targetGroup = null;
    }

    let twitterApiInitialized = false;
    try {
        const initResult = await twitterApiHandler.initialize();
        if (!initResult) {
            logger.warn(
                'NM: Twitter API Handler failed/no usable keys. Twitter fetching impaired.'
            );
            // twitterApiInitialized remains false
        } else {
            logger.debug('NM: Twitter API Handler initialized successfully.');
            twitterApiInitialized = true;
        }
    } catch (e) {
        logger.error('NM: Critical error during Twitter API Handler initialization:', e);
    }

    // Run the first news cycle immediately after initialization,
    // but only if the Twitter API part was successful enough to proceed.
    // The skipPeriodicCheck=true will prevent it from immediately re-checking Twitter API keys.
    if (twitterApiInitialized) {
        logger.debug(
            'NM: Performing initial news cycle immediately after Twitter API Handler init...'
        );
        try {
            await processNewsCycle(true); // Pass true to skip periodicCheck
        } catch (e) {
            logger.error('NM: Error during initial immediate processNewsCycle():', e);
        }
    } else {
        logger.warn(
            'NM: Skipping initial news cycle due to Twitter API Handler initialization issues.'
        );
    }

    if (newsMonitorIntervalId) clearInterval(newsMonitorIntervalId);
    newsMonitorIntervalId = setInterval(async () => {
        try {
            // Subsequent cycles will call with default skipPeriodicCheck = false
            await processNewsCycle();
        } catch (e) {
            logger.error('NM: Unhandled error scheduled processNewsCycle():', e);
        }
    }, NEWS_MONITOR_CONFIG.CHECK_INTERVAL);
    logger.debug(
        `NM: News Monitor initialized. Subsequent cycles run every ${
            NEWS_MONITOR_CONFIG.CHECK_INTERVAL / 60000
        } mins.`
    );
    return true; // Return true if News Monitor base setup is done, regardless of Twitter API state for now
}

/**
 * Stops the News Monitor's periodic execution.
 */
async function stop() {
    if (newsMonitorIntervalId) {
        clearInterval(newsMonitorIntervalId);
        newsMonitorIntervalId = null;
        logger.debug('NM: Stopped.');
    } else {
        logger.debug('NM: Was not running.');
    }
}

// Wrapper function to call the core debug report generator with dependencies
async function generateNewsCycleDebugReport() {
    const dependencies = {
        logger,
        isQuietHoursFn: isQuietHours, // Pass the function itself
        currentNewsTargetGroup: targetGroup,
        getLastFetchedTweetsCache: twitterFetcher.getLastFetchedTweetsCache, // Corrected access
        rssFetcher, // The module
        webscraperFetcher, // The webscraper module
        filteringUtils: {
            isItemWhitelisted,
            itemContainsBlacklistedKeyword,
            filterByTopicRedundancy,
        }, // The module
        evaluationUtils: {
            evaluateItemWithAccountSpecificPrompt,
            evaluateItemFullContent,
        }, // The module
        contentProcessingUtils: {
            generateSummary,
            checkIfDuplicate,
            recordSentItemToCache,
            processLinkContentForShortTweets,
        }, // The module
        openaiUtils: {
            runCompletion,
            extractTextFromImageWithOpenAI,
        }, // The module
        persistentCache: {
            readCache,
            getLastRunTimestamp,
            updateLastRunTimestamp,
        }, // The module, for readCache inside the debug report if needed
    };
    return generateNewsCycleDebugReport_core(
        NEWS_MONITOR_CONFIG,
        isQuietHours,
        targetGroup,
        dependencies
    );
}

// Function to handle restart requests from admin commands or other modules
async function restartMonitors(restartTwitter = true, restartRss = true) {
    logger.info('NM: Restarting monitors...');
    if (restartTwitter) {
        logger.info('NM: Restarting Twitter monitor...');
        await twitterApiHandler.stop(); // Assuming a stop function exists or can be added
        // Re-initialize Twitter part of the monitor
        if (await twitterApiHandler.initialize()) {
            logger.info('NM: Twitter monitor restarted successfully.');
        } else {
            logger.warn('NM: Twitter monitor failed to restart.');
        }
    }
    // Similar logic for RSS if it has separate start/stop, or re-run full initialize
    // For now, re-running the main initialize which includes RSS setup
    if (restartRss || restartTwitter) {
        // If either was restarted, re-run main init logic
        if (newsMonitorIntervalId) {
            clearInterval(newsMonitorIntervalId);
            newsMonitorIntervalId = null;
        }
        await initialize(); // Re-run the main initialization
        logger.info('NM: News monitor main cycle (re)initialized.');
    } else {
        logger.info('NM: No specific monitor restart requested.');
    }
}

module.exports = {
    processNewsCycle,
    initialize,
    getNewsMonitorStartupStatus,
    generateNewsCycleDebugReport,
    restartMonitors,
};