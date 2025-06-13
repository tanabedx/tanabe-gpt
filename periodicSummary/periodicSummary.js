// const config = require('../configs');
const { runCompletion } = require('../utils/openaiUtils');
const logger = require('../utils/logger');

// Helper function to get group config with defaults
function getGroupConfig(config, groupConfig) {
    const defaults = config.PERIODIC_SUMMARY.defaults;
    return {
        enabled: groupConfig?.enabled ?? true,
        intervalHours: groupConfig?.intervalHours ?? defaults.intervalHours,
        quietTime: groupConfig?.quietTime ?? defaults.quietTime,
        deleteAfter: groupConfig?.deleteAfter ?? defaults.deleteAfter,
        prompt: groupConfig?.prompt ?? defaults.prompt,
        model: groupConfig?.model ?? defaults.model,
    };
}

// Helper function to check if current time is within quiet hours
function isQuietTime(quietTime) {
    const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();
    const currentTime = currentHour * 100 + currentMinute;

    const [startHour, startMinute] = quietTime.start.split(':').map(Number);
    const [endHour, endMinute] = quietTime.end.split(':').map(Number);
    const startTime = startHour * 100 + startMinute;
    const endTime = endHour * 100 + endMinute;

    // Handle cases where quiet time spans across midnight
    if (startTime > endTime) {
        return currentTime >= startTime || currentTime <= endTime;
    }
    return currentTime >= startTime && currentTime <= endTime;
}

// Main periodic summary function
async function runPeriodicSummary(config, groupName, forceRun = false, options = {}) {
    const { returnOnly = false } = options;

    // Only check global enabled status if not forced
    if (!forceRun && !config.PERIODIC_SUMMARY?.enabled) {
        logger.debug('Periodic summary disabled in config');
        return false;
    }

    logger.debug('Running periodic summary for group:', groupName);
    const chats = await global.client.getChats();

    // Get group config
    const rawGroupConfig = config.PERIODIC_SUMMARY.groups[groupName];
    if (!rawGroupConfig) {
        logger.debug(`No config found for group ${groupName}`);
        return false;
    }

    const groupConfig = getGroupConfig(config, rawGroupConfig);
    logger.debug('Group config:', { groupName, config: groupConfig });

    // Only check group enabled status if not forced
    if (!forceRun && !groupConfig.enabled) {
        logger.debug(`Summary disabled for group ${groupName}`);
        return false;
    }

    const chat = chats.find(c => c.name === groupName);
    if (!chat || !chat.isGroup) {
        logger.debug(`Chat not found or not a group: ${groupName}`);
        return false;
    }

    // Check if it's quiet time (but ignore if forced)
    if (!forceRun && groupConfig.quietTime && isQuietTime(groupConfig.quietTime)) {
        logger.debug(`Skipping summary for ${groupName} - currently in quiet time`);
        return false;
    }

    try {
        // Get messages from the last interval
        const intervalMs = groupConfig.intervalHours * 60 * 60 * 1000;
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
            logger.debug(`No valid messages to summarize for ${groupName}`);
            if (returnOnly) {
                return {
                    success: true,
                    summaryText: null,
                    messagesCount: 0,
                    groupConfig: groupConfig,
                    status: 'no_messages',
                    error: null,
                };
            }
            return true; // Original behavior: success, no message sent
        }

        // Format messages for the summary
        const messageTexts = await Promise.all(
            validMessages.map(async message => {
                const contact = await message.getContact();
                const name = contact.pushname || contact.name || contact.number;
                return `>>${name}: ${message.body}.\n`;
            })
        );

        logger.debug(`Formatted ${messageTexts.length} messages for summary in ${groupName}`);

        // Generate summary using OpenAI
        const PERIODIC_SUMMARY = require('./periodicSummary.prompt');
        const promptToUse = groupConfig.prompt || PERIODIC_SUMMARY.DEFAULT;
        const summaryText = await runCompletion(promptToUse + '\n\n' + messageTexts.join(''), 0.7);

        logger.debug(`Generated summary for ${groupName}:`, summaryText);

        // Only send if summary is not null
        if (summaryText.trim().toLowerCase() !== 'null') {
            if (returnOnly) {
                return {
                    success: true,
                    summaryText: summaryText,
                    messagesCount: validMessages.length,
                    groupConfig: groupConfig,
                    status: 'summary_generated',
                    error: null,
                };
            }
            await chat.sendMessage(summaryText);
            logger.debug(`Successfully sent summary to ${groupName}`);
            return true; // Original behavior: success, message sent
        } else {
            logger.debug(`No summary sent for ${groupName} (ChatGPT returned null)`);
            if (returnOnly) {
                return {
                    success: true,
                    summaryText: null,
                    messagesCount: validMessages.length, // Still useful to know messages were processed
                    groupConfig: groupConfig,
                    status: 'ai_returned_null',
                    error: null,
                };
            }
            return true; // Original behavior: success, no message sent (AI null)
        }
    } catch (error) {
        logger.error(`Failed to generate summary for ${groupName}:`, error);
        if (returnOnly) {
            return {
                success: false,
                summaryText: null,
                messagesCount: 0,
                groupConfig: groupConfig, // Return config even on error for context
                status: 'error',
                error: error.message,
            };
        }
        return false; // Original behavior: failure
    }
}

// Import wizard handler
const { handleWizard: wizardHandler } = require('./wizard/wizard');

// Wrapper handler for the WIZARD command
async function handleWizard(message, command, input) {
    return await wizardHandler(message, command, input);
}

// Export the functions
module.exports = { runPeriodicSummary, handleWizard };
