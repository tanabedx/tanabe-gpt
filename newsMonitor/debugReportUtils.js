const logger = require('../utils/logger'); // Direct import, though it will also be in dependencies for consistency

/**
 * Generates a detailed debug report for a simulated news processing cycle.
 * This function mirrors the logic of processNewsCycle but collects data for a report
 * instead of sending messages or writing to cache.
 * @param {Object} config - The NEWS_MONITOR_CONFIG object.
 * @param {Function} isQuietHoursFn - The isQuietHours function.
 * @param {Object | null} currentNewsTargetGroup - The current targetGroup object (or null).
 * @param {Object} utilities - An object containing various utility functions and modules.
 * @returns {Promise<string>} - A formatted string containing the debug report.
 */
async function generateNewsCycleDebugReport_core(
    config,
    isQuietHoursFn,
    currentNewsTargetGroup,
    utilities
) {
    const report = [];
    const startTime = Date.now();
    utilities.logger.debug('NM_DEBUG: Starting debug report generation (core)...');
    report.push('*📢 Relatório de Debug do Ciclo de Notícias*');
    report.push(
        `Gerado em: ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`
    );

    // --- Configuration & Initial State ---
    report.push('\n*⚙️ Configurações e Estado Inicial:*');
    report.push(`- Intervalo de Verificação: ${config.CHECK_INTERVAL / 60000} minutos`);
    const quietHoursEnabled = config.QUIET_HOURS?.ENABLED;
    report.push(`- Horas de Silêncio Ativadas: ${quietHoursEnabled ? 'Sim' : 'Não'}`);
    if (quietHoursEnabled) {
        report.push(
            `  - Período: ${config.QUIET_HOURS?.START_HOUR}:00 - ${
                config.QUIET_HOURS?.END_HOUR
            }:00 (${config.QUIET_HOURS?.TIMEZONE || 'UTC'})`
        );
        const currentlyQuiet = isQuietHoursFn();
        report.push(`  - Está em Horas de Silêncio AGORA: ${currentlyQuiet ? 'Sim' : 'Não'}`);
        if (currentlyQuiet) {
            report.push(
                '  - SIMULAÇÃO PARADA: Processamento normal seria interrompido devido às horas de silêncio.'
            );
        }
    }
    report.push(`- Target Group Configurado: ${config.TARGET_GROUP || 'N/A'}`);
    if (!currentNewsTargetGroup) {
        report.push(
            '- ATENÇÃO: Target group não está definido/encontrado no momento. Envios falhariam.'
        );
    } else {
        report.push(`- Target Group Encontrado: ${currentNewsTargetGroup.name}`);
    }

    // --- Fetching Stage ---
    report.push('\n*📥 Fase de Coleta de Itens:*');
    let allFetchedItems = [];
    let twitterFetchedStats = 'Twitter: ';
    let rssFetchedStats = 'RSS: ';
    let twitterPosts = [];

    const cachedTwitterData = utilities.getLastFetchedTweetsCache(
        config.DEBUG_CACHE_MAX_AGE_MINUTES || 15
    );
    if (
        cachedTwitterData &&
        cachedTwitterData.tweets &&
        Object.keys(cachedTwitterData.tweets).length > 0
    ) {
        utilities.logger.info(
            `NM_DEBUG: Using cached Twitter data, ${
                cachedTwitterData.cacheAge || 'age not specified'
            } old.`
        );
        report.push(
            `- Twitter: Usando dados do cache (aproximadamente ${
                cachedTwitterData.cacheAge || 'N/A'
            } de idade).`
        );

        const rawTweetsByUser = cachedTwitterData.tweets;
        for (const username in rawTweetsByUser) {
            if (rawTweetsByUser[username] && rawTweetsByUser[username].length > 0) {
                rawTweetsByUser[username].forEach(rawTweet => {
                    const formattedTweet = {
                        id: rawTweet.id,
                        text: rawTweet.text,
                        accountName: username,
                        dateTime: rawTweet.created_at,
                        mediaObjects: [],
                    };
                    if (
                        rawTweet.attachments &&
                        rawTweet.attachments.media_keys &&
                        rawTweet.attachments.media_keys.length > 0
                    ) {
                        formattedTweet.debug_media_keys = rawTweet.attachments.media_keys;
                    }
                    twitterPosts.push(formattedTweet);
                });
            }
        }
        if (twitterPosts.length > 0) {
            allFetchedItems = allFetchedItems.concat(twitterPosts);
            const countsByAccount = twitterPosts.reduce((acc, item) => {
                acc[item.accountName] = (acc[item.accountName] || 0) + 1;
                return acc;
            }, {});
            twitterFetchedStats += `${twitterPosts.length} tweets do cache. (${
                Object.entries(countsByAccount)
                    .map(([acc, num]) => `@${acc}: ${num}`)
                    .join(', ') || 'Nenhuma conta específica no cache'
            })`;
        } else {
            twitterFetchedStats += '0 tweets encontrados no cache.';
        }
    } else {
        utilities.logger.info(
            'NM_DEBUG: No suitable cached Twitter data found. Skipping live Twitter fetch for debug report to save API quota.'
        );
        twitterFetchedStats +=
            'Coleta de tweets ao vivo PULADA para economizar API (nenhum cache adequado encontrado).';
    }
    report.push(twitterFetchedStats);

    try {
        const rssItems = await utilities.rssFetcher.fetchAndFormatRssFeeds();
        if (rssItems?.length) {
            allFetchedItems = allFetchedItems.concat(rssItems);
            const countsByFeed = rssItems.reduce((acc, item) => {
                acc[item.feedName] = (acc[item.feedName] || 0) + 1;
                return acc;
            }, {});
            rssFetchedStats += `${rssItems.length} artigos. (${
                Object.entries(countsByFeed)
                    .map(([feed, num]) => `${feed}: ${num}`)
                    .join(', ') || 'Nenhum feed específico retornou artigos'
            })`;
        } else {
            rssFetchedStats += '0 artigos.';
        }
    } catch (e) {
        rssFetchedStats += `Erro na coleta: ${e.message}`;
        utilities.logger.error(`NM_DEBUG: Error fetching RSS for report: ${e.message}`);
    }
    report.push(rssFetchedStats);
    report.push(`- Total de Itens Coletados: ${allFetchedItems.length}`);

    if (allFetchedItems.length === 0) {
        report.push('\nSIMULAÇÃO PARADA: Nenhum item coletado.');
        return report.join('\n');
    }

    let filteredItems = [...allFetchedItems];
    let currentTotal = filteredItems.length;
    let prevCount = currentTotal; // For logging before/after counts consistently

    report.push('\n*🔍 Fase de Filtragem:*');

    // Use the same logic as the main newsMonitor for interval filtering
    let cutoffTimestamp;
    let filterDescription;
    
    try {
        const lastRunTimestamp = utilities.persistentCache?.getLastRunTimestamp?.() || null;
        
        if (lastRunTimestamp) {
            cutoffTimestamp = lastRunTimestamp;
            const lastRunDate = new Date(lastRunTimestamp);
            filterDescription = `Last Run (${lastRunDate.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })})`;
        } else {
            const intervalMs = config.CHECK_INTERVAL;
            cutoffTimestamp = Date.now() - intervalMs;
            filterDescription = `${intervalMs / 60000} min`;
        }
    } catch (error) {
        // Fallback to CHECK_INTERVAL if there's any error
        const intervalMs = config.CHECK_INTERVAL;
        cutoffTimestamp = Date.now() - intervalMs;
        filterDescription = `${intervalMs / 60000} min (fallback)`;
    }
    
    const beforeInterval = currentTotal;
    filteredItems = filteredItems.filter(item => {
        const itemDateString = item.dateTime || item.pubDate;
        if (!itemDateString) return true;
        try {
            const itemDate = new Date(itemDateString);
            return isNaN(itemDate.getTime()) || itemDate.getTime() >= cutoffTimestamp;
        } catch (e) {
            return true;
        }
    });
    report.push(
        `- Filtro de Intervalo (${filterDescription}): ${
            beforeInterval - filteredItems.length
        } removidos (${filteredItems.length}/${beforeInterval} restantes)`
    );
    currentTotal = filteredItems.length;
    prevCount = currentTotal;

    if (currentTotal > 0) {
        const beforeWhitelist = currentTotal;
        const whitelistPaths = config.CONTENT_FILTERING?.WHITELIST_PATHS || [];
        filteredItems = filteredItems.filter(item =>
            utilities.filteringUtils.isItemWhitelisted(item, whitelistPaths)
        );
        report.push(
            `- Filtro de Whitelist (RSS g1): ${beforeWhitelist - filteredItems.length} removidos (${
                filteredItems.length
            }/${beforeWhitelist} restantes)`
        );
        currentTotal = filteredItems.length;
        prevCount = currentTotal;
    }

    if (currentTotal > 0) {
        const beforeBlacklist = currentTotal;
        const blacklistKeywords = config.CONTENT_FILTERING?.BLACKLIST_KEYWORDS || [];
        if (blacklistKeywords.length > 0) {
            const itemsPassingBlacklist = [];
            for (const item of filteredItems) {
                let skipThisFilter = false;
                if (item.accountName) {
                    const sourceConfig = config.sources.find(
                        s => s.type === 'twitter' && s.username === item.accountName
                    );
                    if (sourceConfig && sourceConfig.skipEvaluation) skipThisFilter = true;
                }
                if (skipThisFilter) itemsPassingBlacklist.push(item);
                else if (
                    !utilities.filteringUtils.itemContainsBlacklistedKeyword(
                        item,
                        blacklistKeywords
                    )
                )
                    itemsPassingBlacklist.push(item);
            }
            filteredItems = itemsPassingBlacklist;
        }
        report.push(
            `- Filtro de Palavras-Chave (Blacklist): ${
                beforeBlacklist - filteredItems.length
            } removidos (${filteredItems.length}/${beforeBlacklist} restantes)`
        );
        currentTotal = filteredItems.length;
        prevCount = currentTotal;
    }

    if (currentTotal > 0) {
        const beforeAccountSpecific = currentTotal;
        const itemsPassingAccountFilter = [];
        for (const item of filteredItems) {
            let passed = true;
            if (item.accountName) {
                const sourceConfig = config.sources.find(
                    s => s.type === 'twitter' && s.username === item.accountName
                );
                if (sourceConfig && sourceConfig.promptSpecific && !sourceConfig.skipEvaluation) {
                    passed = await utilities.evaluationUtils.evaluateItemWithAccountSpecificPrompt(
                        item,
                        config
                    );
                }
            } else {
                passed = await utilities.evaluationUtils.evaluateItemWithAccountSpecificPrompt(
                    item,
                    config
                );
            }
            if (passed) itemsPassingAccountFilter.push(item);
        }
        filteredItems = itemsPassingAccountFilter;
        report.push(
            `- Filtro de Prompts Específicos por Conta: ${
                beforeAccountSpecific - filteredItems.length
            } removidos (${filteredItems.length}/${beforeAccountSpecific} restantes)`
        );
        currentTotal = filteredItems.length;
        prevCount = currentTotal;
    }

    const itemsBeforeBatchTitleEval_report = [...filteredItems];
    const batchTitleEvalFilteredOutItems_report = [];
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
            const promptTemplate = config.PROMPTS.BATCH_EVALUATE_TITLES;
            const modelName = config.AI_MODELS.BATCH_EVALUATE_TITLES || config.AI_MODELS.DEFAULT;
            const formattedPrompt = promptTemplate.replace('{titles}', titlesToEvaluate.join('\n'));

            try {
                utilities.logger.debug(
                    `NM_DEBUG: Performing batch title evaluation for ${rssItemsForBatchEval.length} RSS items using model ${modelName}.`
                );
                const result = await utilities.openaiUtils.runCompletion(
                    formattedPrompt,
                    0.3,
                    modelName,
                    'BATCH_EVALUATE_TITLES'
                );
                const cleanedResult = result.trim();
                const relevantIndices = cleanedResult
                    .split(',')
                    .map(numStr => parseInt(numStr.trim(), 10) - 1)
                    .filter(num => !isNaN(num) && num >= 0 && num < rssItemsForBatchEval.length);

                rssItemsForBatchEval.forEach((item, index) => {
                    if (relevantIndices.includes(index)) {
                        processedRssItems.push(item);
                    } else {
                        batchTitleEvalFilteredOutItems_report.push(item);
                    }
                });
            } catch (error) {
                utilities.logger.error(
                    `NM_DEBUG: Error during batch title evaluation: ${error.message}. Keeping all for report.`
                );
                processedRssItems = [...rssItemsForBatchEval];
            }
        }
        filteredItems = [...nonRssOrNoTitleItems, ...processedRssItems];
    }
    report.push(
        `- Avaliação de Títulos em Lote (RSS): ${batchTitleEvalFilteredOutItems_report.length} removidos (${filteredItems.length}/${itemsBeforeBatchTitleEval_report.length} restantes)`
    );
    currentTotal = filteredItems.length;
    prevCount = currentTotal;

    const itemsBeforeFullContentEval_report = [...filteredItems];
    const fullContentEvalFilteredOutItems_report = []; // Renamed to avoid conflict
    if (filteredItems.length > 0) {
        const itemsPassingFullContentEval = [];
        for (const item of filteredItems) {
            let passed = true;
            if (item.accountName) {
                const sourceConfig = config.sources.find(
                    s => s.type === 'twitter' && s.username === item.accountName
                );
                if (sourceConfig && sourceConfig.skipEvaluation) {
                    item.relevanceJustification = 'Avaliação pulada (Config da Fonte)';
                } else {
                    passed = await utilities.evaluationUtils.evaluateItemFullContent(item, config);
                }
            } else {
                passed = await utilities.evaluationUtils.evaluateItemFullContent(item, config);
            }
            if (passed) itemsPassingFullContentEval.push(item);
            else fullContentEvalFilteredOutItems_report.push(item);
        }
        filteredItems = itemsPassingFullContentEval;
    }
    report.push(
        `- Avaliação de Conteúdo Completo: ${fullContentEvalFilteredOutItems_report.length} removidos (${filteredItems.length}/${itemsBeforeFullContentEval_report.length} restantes)`
    );
    currentTotal = filteredItems.length;
    prevCount = currentTotal;

    // NOTE: Step 6.5 (Image Text Extraction) from newsMonitor.js is complex to replicate here
    // without significant refactoring of extractTextFromImageWithOpenAI and its direct use in the main loop.
    // For this debug report, we will assume item.text is already as it would be after this step.
    // This simplification is acceptable as the primary goal is to debug the filtering flow.
    report.push(
        '- Extração de Texto de Imagem (Tweets mediaOnly): Simulado (usa item.text existente para relatório)'
    );

    // Duplicate Check (Historical Cache)
    // This part requires reading the actual cache file, which is fine for a debug report.
    if (currentTotal > 0 && config.HISTORICAL_CACHE?.ENABLED && config.PROMPTS?.DETECT_DUPLICATE) {
        const beforeDupCheck = currentTotal;
        let actualCachedItems = [];
        try {
            // Simulate reading cache as it would happen in newsMonitor.js
            // persistentCache.js (utils) handles the direct file reading.
            // We assume contentProcessingUtils.checkIfDuplicate expects items array directly.
            const cacheData = utilities.persistentCache.readCache(); // Assuming persistentCache is passed in utilities with readCache
            if (cacheData && Array.isArray(cacheData.items)) {
                actualCachedItems = cacheData.items;
            }
        } catch (error) {
            utilities.logger.error(
                `NM_DEBUG: Error reading cache for report's duplicate check: ${error.message}`
            );
        }

        if (actualCachedItems.length > 0) {
            const nonDuplicateItems = [];
            const duplicateFilteredOutItems = [];
            for (const item of filteredItems) {
                if (
                    !(await utilities.contentProcessingUtils.checkIfDuplicate(
                        item,
                        actualCachedItems,
                        config
                    ))
                ) {
                    nonDuplicateItems.push(item);
                } else {
                    duplicateFilteredOutItems.push(item);
                }
            }
            filteredItems = nonDuplicateItems;
            report.push(
                `- Verificação de Duplicatas (Cache Histórico): ${duplicateFilteredOutItems.length} removidos (${filteredItems.length}/${beforeDupCheck} restantes)`
            );
        } else {
            report.push(
                `- Verificação de Duplicatas (Cache Histórico): 0 removidos (cache vazio ou não habilitado) (${filteredItems.length}/${beforeDupCheck} restantes)`
            );
        }
        currentTotal = filteredItems.length;
        prevCount = currentTotal;
    }

    if (currentTotal > 0 && config.PROMPTS?.DETECT_TOPIC_REDUNDANCY) {
        const beforeTopicRedundancy = currentTotal;
        filteredItems = await utilities.filteringUtils.filterByTopicRedundancy(
            filteredItems,
            config
        );
        report.push(
            `- Filtro de Redundância de Tópicos: ${
                beforeTopicRedundancy - filteredItems.length
            } removidos (${filteredItems.length}/${beforeTopicRedundancy} restantes)`
        );
        currentTotal = filteredItems.length;
    }

    report.push(`- Total de Itens APÓS TODOS OS FILTROS: ${currentTotal}`);

    report.push('\n*📬 Mensagens Finais (Simulação - Não Enviadas):*');
    if (currentTotal > 0) {
        let count = 0;
        for (const item of filteredItems) {
            count++;
            report.push(`\n--- Item ${count} / ${currentTotal} ---`);
            let messageToSend = 'Erro ao formatar mensagem para debug.';
            let mediaInfo = 'Nenhuma mídia.';

            const sourceConfig = item.accountName
                ? config.sources.find(s => s.type === 'twitter' && s.username === item.accountName)
                : null;

            try {
                if (item.accountName && sourceConfig) {
                    // Twitter - using item.text which is assumed to be post-image-extraction if applicable
                    const summary = await utilities.contentProcessingUtils.generateSummary(
                        `Tweet de @${item.accountName}`,
                        item.text || '',
                        config
                    );
                    messageToSend =
                        `*Breaking News* 🗞️\n\n` +
                        `*Tweet de @${item.accountName}*\n\n` +
                        `${summary}\n\n` +
                        `Fonte: @${item.accountName}\n` +
                        `https://twitter.com/${item.accountName}/status/${item.id}`;

                    if (item.debug_media_keys) {
                        // From cached data primarily
                        mediaInfo = `Mídia referenciada no cache (chaves: ${item.debug_media_keys.join(
                            ', '
                        )}). Detalhes completos de mídia não simulados no relatório de cache.`;
                    } else if (sourceConfig.mediaOnly) {
                        mediaInfo = `(mediaOnly @${item.accountName} - Detalhes completos de mídia não simulados no relatório).`;
                    }
                } else if (item.feedName) {
                    // RSS
                    let articleTitle = item.title || 'Sem Título';
                    const articleContent = item.content || item.description || item.title || '';
                    const summary = await utilities.contentProcessingUtils.generateSummary(
                        articleTitle,
                        articleContent,
                        config
                    );
                    messageToSend =
                        `*Breaking News* 🗞️\n\n` +
                        `*${articleTitle}*\n\n` +
                        `${summary}\n\n` +
                        `Fonte: ${item.feedName}\n` +
                        `${item.link}`;
                }
                report.push(
                    `Tipo: ${item.accountName ? 'Tweet' : 'Artigo RSS'} (${
                        item.accountName || item.feedName
                    })`
                );
                report.push(`ID/Link: ${item.id || item.link}`);
                report.push(`Mídia: ${mediaInfo}`);
                report.push(`Justificativa de Relevância: ${item.relevanceJustification || 'N/A'}`);
                report.push(`Mensagem Formatada:\n${messageToSend.replace(/\n/g, '\n ')}`);
            } catch (e) {
                report.push(`Erro ao formatar item para debug: ${e.message}`);
                utilities.logger.error(
                    `NM_DEBUG: Error formatting item ${item.id || item.link} for report: ${
                        e.message
                    }`
                );
            }
        }
    } else {
        report.push('Nenhum item passou por todos os filtros para ser enviado.');
    }

    const endTime = Date.now();
    report.push(`\nTempo de geração do relatório: ${(endTime - startTime) / 1000} segundos.`);
    utilities.logger.debug('NM_DEBUG: Debug report generation (core) finished.');
    return report.join('\n');
}

module.exports = {
    generateNewsCycleDebugReport_core,
};
