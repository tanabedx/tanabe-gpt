const config = require('../configs');
const { performCacheClearing } = require('./cacheManagement');
const logger = require('../utils/logger');
const { getNextSummaryInfo, scheduleNextSummary } = require('../utils/periodicSummaryUtils');
const { runPeriodicSummary } = require('./periodicSummary');
const { runCompletion } = require('../utils/openaiUtils');
const {
    debugTwitterFunctionality,
    debugRssFunctionality,
    newsMonitorStatus,
} = require('./newsMonitor');
const persistentCache = require('../utils/persistentCache');
const { hasPermission } = require('../configs/whitelist');

// Runtime configuration that can be modified during execution
const runtimeConfig = {
    nlpEnabled: true, // NLP processing is enabled by default
};

// Helper function to check if message is from admin chat
async function isAdminChat(message) {
    const chat = await message.getChat();
    const contact = await message.getContact();
    return (
        contact.id._serialized === `${config.CREDENTIALS.ADMIN_NUMBER}@c.us` &&
        chat.isGroup === false
    );
}

// Helper function to check if user is admin or moderator
async function isAdminOrModerator(message) {
    try {
        // Check if direct message from admin
        const contact = await message.getContact();
        if (contact.id._serialized === `${config.CREDENTIALS.ADMIN_NUMBER}@c.us`) {
            return true;
        }

        // Check if group message from admin or moderator
        const chat = await message.getChat();
        if (chat.isGroup) {
            // Get participant info
            const participant = chat.participants.find(
                p => p.id._serialized === contact.id._serialized
            );
            if (participant && (participant.isAdmin || participant.isSuperAdmin)) {
                return true;
            }

            // Check if user is in moderators list (if configured)
            if (config.MODERATORS && Array.isArray(config.MODERATORS)) {
                return config.MODERATORS.includes(contact.id.user);
            }
        }

        return false;
    } catch (error) {
        logger.error('Error checking admin/moderator status:', error);
        return false;
    }
}

async function handleCacheClear(message) {
    logger.debug('Cache clear command activated');

    try {
        // Get chat and user information
        const chat = await message.getChat();
        const chatId = chat.name || chat.id._serialized;
        const userId = message.author || message.from;

        // Check permission using whitelist configuration
        if (!(await hasPermission('CACHE_CLEAR', chatId, userId))) {
            logger.debug(`Cache clear command rejected: unauthorized in ${chatId}`);
            return;
        }

        // Pass 0 to clear all files regardless of age
        await performCacheClearing(0);
        await message.reply('Cache cleared successfully');
    } catch (error) {
        logger.error('Error clearing cache', error);
        await message.reply(`Error clearing cache: ${error.message}`);
    }
}

async function handleDebugPeriodic(message) {
    logger.debug('Debug periodic summary command activated');

    try {
        // Get chat and user information
        const chat = await message.getChat();
        const chatId = chat.name || chat.id._serialized;
        const userId = message.author || message.from;

        // Check permission using whitelist configuration
        if (!(await hasPermission('DEBUG_PERIODIC', chatId, userId))) {
            logger.debug(`Debug periodic summary command rejected: unauthorized in ${chatId}`);
            return;
        }

        // Get all configured groups
        const groups = Object.keys(config.PERIODIC_SUMMARY?.groups || {});
        if (groups.length === 0) {
            await message.reply('No groups configured for periodic summaries.');
            return;
        }

        // Create a results object to store all summaries
        const results = {
            nextScheduled: {},
            summaries: {},
            errors: {},
            noMessages: [],
            notFound: [],
        };

        // Get next scheduled summary info for display purposes only
        const nextSummary = getNextSummaryInfo();
        if (nextSummary) {
            results.nextScheduled = {
                group: nextSummary.group,
                time: new Date(nextSummary.nextValidTime).toLocaleString('pt-BR', {
                    timeZone: 'America/Sao_Paulo',
                }),
                interval: nextSummary.interval,
            };
        }

        for (const groupName of groups) {
            try {
                // Get group chats
                const chats = await global.client.getChats();
                const chat = chats.find(c => c.name === groupName);

                if (!chat || !chat.isGroup) {
                    results.notFound.push(groupName);
                    continue;
                }

                const groupConfig = config.PERIODIC_SUMMARY.groups[groupName];
                if (!groupConfig) {
                    results.errors[groupName] = 'No configuration found';
                    continue;
                }

                // Get messages using the same logic as in runPeriodicSummary
                const intervalHours =
                    groupConfig.intervalHours || config.PERIODIC_SUMMARY.defaults.intervalHours;
                const intervalMs = intervalHours * 60 * 60 * 1000;

                logger.debug(`Fetching messages for group ${groupName}`);

                const messages = await chat.fetchMessages({ limit: 1000 });
                logger.debug(`Fetched ${messages.length} messages for group ${groupName}`);

                const cutoffTime = new Date(Date.now() - intervalMs);
                const validMessages = messages.filter(
                    message =>
                        !message.fromMe &&
                        message.body.trim() !== '' &&
                        new Date(message.timestamp * 1000) > cutoffTime
                );

                logger.debug(
                    `Found ${validMessages.length} valid messages within interval for ${groupName}`
                );

                if (validMessages.length === 0) {
                    results.noMessages.push(groupName);
                    continue;
                }

                // Format messages for the summary
                const messageTexts = await Promise.all(
                    validMessages.map(async msg => {
                        const contact = await msg.getContact();
                        const name = contact.pushname || contact.name || contact.number;
                        return `>>${name}: ${msg.body}.\n`;
                    })
                );

                logger.debug(
                    `Formatted ${messageTexts.length} messages for summary in ${groupName}`
                );

                // Generate summary using OpenAI
                const PERIODIC_SUMMARY = require('../prompts/periodicSummary.prompt');
                const promptToUse = groupConfig.prompt || PERIODIC_SUMMARY.DEFAULT;

                const summaryText = await runCompletion(
                    promptToUse + '\n\n' + messageTexts.join(''),
                    0.7
                );

                logger.debug(`Generated summary for ${groupName}:`, summaryText);

                // Add the summary to the results
                if (summaryText.trim().toLowerCase() !== 'null') {
                    results.summaries[groupName] = {
                        summary: summaryText,
                        messagesCount: validMessages.length,
                        intervalHours: intervalHours,
                        promptType: groupConfig.prompt ? 'custom' : 'default',
                    };
                } else {
                    results.errors[groupName] = 'OpenAI returned null response';
                }
            } catch (error) {
                logger.error(`Error generating debug summary for ${groupName}:`, error);
                results.errors[groupName] = error.message;
            }
        }

        // Build the final message
        let finalMessage = `*📊 PERIODIC SUMMARY DEBUG REPORT*\n\n`;

        // Next scheduled summary
        if (results.nextScheduled.group) {
            finalMessage += `*Next scheduled summary:*\n`;
            finalMessage += `Group: ${results.nextScheduled.group}\n`;
            finalMessage += `Time: ${results.nextScheduled.time}\n`;
            finalMessage += `Interval: ${results.nextScheduled.interval}h\n\n`;
        }

        // Stats summary
        finalMessage += `*Summary statistics:*\n`;
        finalMessage += `Total groups: ${groups.length}\n`;
        finalMessage += `Summaries generated: ${Object.keys(results.summaries).length}\n`;
        finalMessage += `Groups with no messages: ${results.noMessages.length}\n`;
        finalMessage += `Groups not found: ${results.notFound.length}\n`;
        finalMessage += `Errors: ${Object.keys(results.errors).length}\n\n`;

        // Summaries section
        if (Object.keys(results.summaries).length > 0) {
            finalMessage += `*📝 SUMMARIES BY GROUP*\n\n`;

            for (const [groupName, data] of Object.entries(results.summaries)) {
                finalMessage += `*📋 ${groupName}*\n`;
                finalMessage += `Messages: ${data.messagesCount} (last ${data.intervalHours}h) | Prompt: ${data.promptType}\n\n`;
                finalMessage += `${data.summary}\n\n`;
                finalMessage += `${'─'.repeat(30)}\n\n`;
            }
        }

        // No messages section
        if (results.noMessages.length > 0) {
            finalMessage += `*Groups with no messages:*\n`;
            results.noMessages.forEach(group => {
                finalMessage += `• ${group}\n`;
            });
            finalMessage += `\n`;
        }

        // Not found section
        if (results.notFound.length > 0) {
            finalMessage += `*Groups not found:*\n`;
            results.notFound.forEach(group => {
                finalMessage += `• ${group}\n`;
            });
            finalMessage += `\n`;
        }

        // Errors section
        if (Object.keys(results.errors).length > 0) {
            finalMessage += `*Errors:*\n`;
            for (const [groupName, errorMsg] of Object.entries(results.errors)) {
                finalMessage += `• ${groupName}: ${errorMsg}\n`;
            }
        }

        // Send the final consolidated message
        await message.reply(finalMessage);

        // Reschedule the next regular summary
        scheduleNextSummary();
    } catch (error) {
        logger.error('Error in debug periodic summary command:', error);
        await message.reply(`Error: ${error.message}`);
    }
}

async function handleTwitterDebug(message) {
    logger.debug('Twitter debug command activated');

    try {
        // Get chat and user information
        const chat = await message.getChat();
        const chatId = chat.name || chat.id._serialized;
        const userId = message.author || message.from;

        // Check permission using whitelist configuration
        if (!(await hasPermission('TWITTER_DEBUG', chatId, userId))) {
            logger.debug(`Twitter debug command rejected: unauthorized in ${chatId}`);
            return;
        }

        await chat.sendStateTyping();

        // Check if Twitter accounts are configured
        if (!config.NEWS_MONITOR.TWITTER_ACCOUNTS || !config.NEWS_MONITOR.TWITTER_ACCOUNTS.length) {
            logger.error('No Twitter accounts configured');
            await message.reply('No Twitter accounts configured in the system.');
            return;
        }

        // Call the Twitter debug function
        await debugTwitterFunctionality(message);
    } catch (error) {
        logger.error('Error in Twitter debug command', error);
        await message.reply(`Debug error: ${error.message}`);
    }
}

async function handleRssDebug(message) {
    logger.debug('RSS debug command activated');

    try {
        // Get chat and user information
        const chat = await message.getChat();
        const chatId = chat.name || chat.id._serialized;
        const userId = message.author || message.from;

        // Check permission using whitelist configuration
        if (!(await hasPermission('RSS_DEBUG', chatId, userId))) {
            logger.debug(`RSS debug command rejected: unauthorized in ${chatId}`);
            return;
        }

        await chat.sendStateTyping();

        // Check if RSS feeds are configured
        if (!config.NEWS_MONITOR.FEEDS || !config.NEWS_MONITOR.FEEDS.length) {
            logger.error('No RSS feeds configured');
            await message.reply('No RSS feeds configured in the system.');
            return;
        }

        // Call the RSS debug function
        await debugRssFunctionality(message);
    } catch (error) {
        logger.error('Error in RSS debug:', error);
        await message.reply('Error testing RSS functionality: ' + error.message);
    }
}

// Handle configuration commands
async function handleConfig(message, _, input) {
    logger.debug('Config command activated', { input });

    // Check if user is admin or moderator
    if (!(await isAdminOrModerator(message))) {
        logger.debug('Config command rejected: not admin or moderator');
        return;
    }

    // Parse the input to get the configuration option and value
    const parts = input.trim().split(/\s+/);
    if (parts.length < 2) {
        await message.reply('Usage: #config [option] [value]\nAvailable options: nlp');
        return;
    }

    const option = parts[0].toLowerCase();
    const value = parts[1].toLowerCase();

    // Handle different configuration options
    switch (option) {
        case 'nlp':
            // Toggle NLP processing
            if (value === 'on' || value === 'true' || value === 'enable') {
                runtimeConfig.nlpEnabled = true;
                await message.reply('NLP processing enabled');
                logger.info('NLP processing enabled by admin command');
            } else if (value === 'off' || value === 'false' || value === 'disable') {
                runtimeConfig.nlpEnabled = false;
                await message.reply('NLP processing disabled');
                logger.info('NLP processing disabled by admin command');
            } else {
                await message.reply('Invalid value for nlp. Use "on" or "off"');
            }
            break;

        default:
            await message.reply(`Unknown configuration option: ${option}\nAvailable options: nlp`);
    }
}

/**
 * Handle the news monitor status command
 */
async function handleNewsStatus(message) {
    logger.debug('News status command activated');

    try {
        // Get chat and user information
        const chat = await message.getChat();
        const chatId = chat.name || chat.id._serialized;
        const userId = message.author || message.from;

        // Check permission using whitelist configuration
        if (!(await hasPermission('NEWS_STATUS', chatId, userId))) {
            logger.debug(`News status command rejected: unauthorized in ${chatId}`);
            return;
        }

        await chat.sendStateTyping();

        // Call the news monitor status function
        await newsMonitorStatus(message);
    } catch (error) {
        logger.error('Error in news status command', error);
        await message.reply(`Error retrieving news monitor status: ${error.message}`);
    }
}

/**
 * Reset the news cache (create empty cache)
 * @param {Object} message - The message triggering the command
 */
async function resetNewsCache(message) {
    try {
        // Get chat and user information
        const chat = await message.getChat();
        const chatId = chat.name || chat.id._serialized;
        const userId = message.author || message.from;

        // Check permission using whitelist configuration
        if (!(await hasPermission('CACHE_RESET', chatId, userId))) {
            logger.debug(`Cache reset command rejected: unauthorized in ${chatId}`);
            return;
        }

        if (persistentCache.clearCache()) {
            await message.reply('News cache has been reset. The cache is now empty.');
        } else {
            await message.reply('Failed to reset news cache. Check the logs for details.');
        }
    } catch (error) {
        logger.error('Error resetting news cache:', error);
        await message.reply(`Error resetting news cache: ${error.message}`);
    }
}

/**
 * Display stats about the persistent cache
 * @param {Object} message - The message triggering the command
 */
async function showCacheStats(message) {
    try {
        // Get chat and user information
        const chat = await message.getChat();
        const chatId = chat.name || chat.id._serialized;
        const userId = message.author || message.from;

        // Check permission using whitelist configuration
        if (!(await hasPermission('CACHE_STATS', chatId, userId))) {
            logger.debug(`Cache stats command rejected: unauthorized in ${chatId}`);
            return;
        }

        const stats = persistentCache.getCacheStats();

        // Format the stats into a readable message
        const statsMessage = `*Persistent Cache Statistics*

- Total cached items: ${stats.totalItems}
- Tweet entries: ${stats.tweetCount}
- Article entries: ${stats.articleCount}
- Maximum cache age: ${stats.maxCacheAge} days
- Maximum cache size: ${stats.maxCacheItems} items

*Age Statistics*
- Newest item: ${stats.newestItemHours.toFixed(1)} hours old
- Oldest item: ${stats.oldestItemHours.toFixed(1)} hours old

*Cache Health*
All entries older than ${stats.maxCacheAge} days are automatically pruned.
Cache is limited to maximum ${stats.maxCacheItems} entries total.

To reset the cache, use !cachereset
To completely clear the cache, use !cacheclear`;

        await message.reply(statsMessage);
    } catch (error) {
        logger.error('Error showing cache stats:', error);
        await message.reply(`Error retrieving cache statistics: ${error.message}`);
    }
}

/**
 * Enable or disable the entire news monitor system
 * @param {Object} message - The message triggering the command
 */
async function handleNewsToggle(message) {
    logger.debug('News toggle command activated');

    try {
        // Get chat and user information
        const chat = await message.getChat();
        const chatId = chat.name || chat.id._serialized;
        const userId = message.author || message.from;

        // Check permission using whitelist configuration
        if (!(await hasPermission('NEWS_TOGGLE', chatId, userId))) {
            logger.debug(`News toggle command rejected: unauthorized in ${chatId}`);
            return;
        }

        // Parse command arguments
        const args = message.body.split(' ').slice(1);
        const command = args.length > 0 ? args[0].toLowerCase() : '';

        // Get current status of news monitors
        const twitterEnabled = config.NEWS_MONITOR.TWITTER_ENABLED;
        const rssEnabled = config.NEWS_MONITOR.RSS_ENABLED;

        // Determine the new state based on arguments or toggle behavior
        let newState;

        if (command === 'on' || command === 'enable') {
            // Explicit enable
            newState = true;
        } else if (command === 'off' || command === 'disable') {
            // Explicit disable
            newState = false;
        } else {
            // Toggle behavior - if at least one is enabled, disable both; otherwise enable both
            newState = !(twitterEnabled || rssEnabled);
        }

        // Apply the new state
        if (newState) {
            // Enable both Twitter and RSS monitoring
            config.NEWS_MONITOR.TWITTER_ENABLED = true;
            config.NEWS_MONITOR.RSS_ENABLED = true;

            // Restart both monitors
            const { restartMonitors } = require('./newsMonitor');
            await restartMonitors(true, true);

            await message.reply(
                'News monitor system has been fully enabled. Both Twitter and RSS monitors have been restarted.'
            );
            logger.info('News monitor system fully enabled by admin command');
        } else {
            // Disable both Twitter and RSS monitoring
            config.NEWS_MONITOR.TWITTER_ENABLED = false;
            config.NEWS_MONITOR.RSS_ENABLED = false;

            // Clear intervals if they exist
            if (global.twitterIntervalId) {
                clearInterval(global.twitterIntervalId);
                global.twitterIntervalId = null;
            }

            if (global.rssIntervalId) {
                clearInterval(global.rssIntervalId);
                global.rssIntervalId = null;
            }

            await message.reply(
                'News monitor system has been fully disabled. Both Twitter and RSS monitors have been stopped.'
            );
            logger.info('News monitor system fully disabled by admin command');
        }
    } catch (error) {
        logger.error('Error in news toggle command:', error);
        await message.reply(`Error toggling news monitor system: ${error.message}`);
    }
}

module.exports = {
    handleCacheClear,
    handleTwitterDebug,
    handleDebugPeriodic,
    handleRssDebug,
    handleConfig,
    handleNewsStatus,
    runtimeConfig,
    resetNewsCache,
    showCacheStats,
    handleNewsToggle,
};
