const config = require('../configs/config');
const { performCacheClearing } = require('./cacheManagement');
const logger = require('../utils/logger');
const { getNextSummaryInfo, scheduleNextSummary } = require('../periodicSummary/periodicSummaryUtils');
const { runPeriodicSummary } = require('../periodicSummary/periodicSummary');
const {
    generateNewsCycleDebugReport,
    restartMonitors: newRestartMonitors,
} = require('../newsMonitor/newsMonitor');
const persistentCache = require('../newsMonitor/persistentCache');
const { hasPermission } = require('../configs/whitelist');

// Runtime configuration that can be modified during execution
const runtimeConfig = {
    nlpEnabled: true, // NLP processing is enabled by default
};

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
        const chat = await message.getChat();
        const chatId = chat.name || chat.id._serialized;
        const userId = message.author || message.from;

        if (!(await hasPermission('DEBUG_PERIODIC', chatId, userId))) {
            logger.debug(`Debug periodic summary command rejected: unauthorized in ${chatId}`);
            return;
        }

        const configuredGroupNames = Object.keys(config.PERIODIC_SUMMARY?.groups || {});
        if (configuredGroupNames.length === 0) {
            await message.reply('No groups configured for periodic summaries.');
            return;
        }

        const reportResults = [];
        const errors = [];
        const notFound = [];
        const noMessages = [];

        for (const groupName of configuredGroupNames) {
            try {
                // Check if group actually exists before calling runPeriodicSummary
                const groupChats = await global.client.getChats();
                const groupChat = groupChats.find(c => c.name === groupName);

                if (!groupChat || !groupChat.isGroup) {
                    logger.warn(
                        `Debug Periodic: Group chat "${groupName}" not found or not a group.`
                    );
                    notFound.push(groupName);
                    continue;
                }

                const result = await runPeriodicSummary(config, groupName, true, { returnOnly: true });

                if (result.success) {
                    reportResults.push({
                        groupName,
                        summaryText: result.summaryText,
                        messagesCount: result.messagesCount,
                        status: result.status, // e.g., 'summary_generated', 'no_messages', 'ai_returned_null'
                        groupConfig: result.groupConfig,
                    });
                    if (result.status === 'no_messages') {
                        noMessages.push(groupName);
                    }
                } else {
                    logger.error(
                        `Debug Periodic: Error running summary for ${groupName}: ${result.error}`
                    );
                    errors.push({ groupName, error: result.error });
                }
            } catch (e) {
                logger.error(
                    `Debug Periodic: Critical error processing group ${groupName} for debug: ${e.message}`
                );
                errors.push({ groupName, error: e.message });
            }
        }

        // Build the final message
        let finalMessage = `*RELATÓRIO DE DEBUG DO RESUMO PERIÓDICO*

`;

        const nextSummaryInfo = getNextSummaryInfo();
        if (nextSummaryInfo) {
            finalMessage += `*Próximo resumo agendado:*
`;
            finalMessage += `Grupo: ${nextSummaryInfo.group}
`;
            finalMessage += `Horário: ${new Date(nextSummaryInfo.nextValidTime).toLocaleString(
                'pt-BR',
                {
                    timeZone: 'America/Sao_Paulo',
                }
            )}
`;
            finalMessage += `Intervalo: ${nextSummaryInfo.interval}h\n\n`;
        }

        finalMessage += `*Estatísticas da Simulação:*
`;
        finalMessage += `Total de grupos configurados: ${configuredGroupNames.length}
`;
        finalMessage += `Resumos gerados/tentados: ${reportResults.length}
`;
        finalMessage += `Grupos sem mensagens válidas: ${noMessages.length}
`;
        finalMessage += `Grupos não encontrados: ${notFound.length}
`;
        finalMessage += `Erros durante a geração: ${errors.length}\n\n`;

        if (reportResults.length > 0) {
            finalMessage += `*📝 RESULTADOS POR GRUPO*

`;
            for (const res of reportResults) {
                finalMessage += `*📋 ${res.groupName}*
`;
                finalMessage += `Status: ${res.status}
`;
                finalMessage += `Mensagens Consideradas: ${res.messagesCount} (nas últimas ${res.groupConfig.intervalHours}h)
`;
                finalMessage += `Prompt: ${res.groupConfig.prompt ? 'Customizado' : 'Padrão'}
`;
                if (res.summaryText) {
                    finalMessage += `Resumo Gerado:\n${res.summaryText}\n`;
                }
                finalMessage += `${'─'.repeat(30)}\n\n`;
            }
        }

        if (notFound.length > 0) {
            finalMessage += `*Grupos configurados mas não encontrados:*
`;
            notFound.forEach(group => (finalMessage += `• ${group}\n`));
            finalMessage += `\n`;
        }

        if (errors.length > 0) {
            finalMessage += `*Erros Detalhados:*
`;
            for (const err of errors) {
                finalMessage += `• ${err.groupName}: ${err.error}\n`;
            }
        }

        await message.reply(finalMessage);
        scheduleNextSummary(); // Reschedule the next regular summary run
    } catch (error) {
        logger.error('Error in debug periodic summary command:', error);
        await message.reply(`Error: ${error.message}`);
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
 * Reset the news cache (create empty cache)
 * @param {Object} message - The message triggering the command
 */
async function handleCacheReset(message) {
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

            // Restart both monitors using the new restartMonitors function
            await newRestartMonitors(true, true);

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

/**
 * Handle the news debug command for the main newsMonitor.js pipeline
 */
async function handleNewsDebug(message) {
    logger.debug('News debug command activated for newsMonitor.js pipeline');

    try {
        const chat = await message.getChat();
        const chatId = chat.name || chat.id._serialized;
        const userId = message.author || message.from;

        if (!(await hasPermission('NEWS_DEBUG', chatId, userId))) {
            // Assuming NEWS_DEBUG will be the permission key
            logger.debug(`News debug command rejected: unauthorized in ${chatId}`);
            // Optionally send a message, or just return if no reply on unauthorized is desired
            // await message.reply('Você não tem permissão para usar este comando.');
            return;
        }

        await chat.sendStateTyping();
        // Add a small delay to allow typing state to be sent before long operation
        await new Promise(resolve => setTimeout(resolve, 2000));

        logger.info('Generating news cycle debug report. This may take a moment...');

        const report = await generateNewsCycleDebugReport(); // This function will be in newsMonitor/newsMonitor.js

        if (report) {
            await message.reply(report);
        } else {
            await message.reply('Falha ao gerar o relatório de debug. Verifique os logs.');
        }
    } catch (error) {
        logger.error('Error in news debug command (newsMonitor.js pipeline):', error);
        await message.reply(
            `Erro ao gerar relatório de debug do ciclo de notícias: ${error.message}`
        );
    }
}

module.exports = {
    handleCacheClear,
    handleDebugPeriodic,
    handleConfig,
    runtimeConfig,
    handleCacheReset,
    handleNewsToggle,
    handleNewsDebug,
};
