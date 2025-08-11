const logger = require('../utils/logger');
const { runCompletion } = require('../utils/openaiUtils');

/**
 * Evaluates a news item using an account-specific prompt if configured.
 * @param {Object} item - The news item to evaluate.
 * @param {Object} config - The NEWS_MONITOR_CONFIG object.
 * @returns {Promise<boolean>} - True if the item passes or the filter doesn't apply, false if it fails evaluation.
 */
async function evaluateItemWithAccountSpecificPrompt(item, config) {
    // If item is not a tweet, or has no text, this filter doesn't apply directly based on accountName.
    // However, the logic allows it to be called for any item; it will pass non-tweets or empty text tweets.
    
    // For mediaOnly tweets, use original text for account-specific evaluation (before image extraction)
    // For regular tweets, use current text (which is the original text)
    const textToEvaluate = item.originalText || item.text;
    
    if (!item.accountName || !textToEvaluate || textToEvaluate.trim() === '') return true;

    const accountConfig = config.sources.find(
        source => source.type === 'twitter' && source.username === item.accountName
    );

    // If no specific config for this Twitter account, or no specific prompt defined, item passes.
    if (!accountConfig || !accountConfig.promptSpecific) return true;

    const promptName = `${item.accountName}_PROMPT`;
    const promptTemplate = config.PROMPTS[promptName];

    if (!promptTemplate) {
        logger.warn(`NM: Account-specific prompt "${promptName}" not found. Item will pass.`);
        return true;
    }

    const modelName = config.AI_MODELS[promptName] || config.AI_MODELS.DEFAULT;
    let formattedPrompt = promptTemplate.includes('{post}')
        ? promptTemplate.replace('{post}', textToEvaluate)
        : promptTemplate.includes('{content}')
        ? promptTemplate.replace('{content}', textToEvaluate)
        : promptTemplate;

    try {
        logger.debug(
            `NM: Evaluating @${item.accountName}'s item with "${promptName}" using model ${modelName}. Using ${item.originalText ? 'original' : 'current'} text.`
        );
        const result = await runCompletion(formattedPrompt, 0.1, modelName, promptName);

        // Enhanced response parsing - support optional justification with delimiter '::'
        if (!result || typeof result !== 'string') {
            logger.warn(`NM: Item from @${item.accountName} received invalid response from AI: ${result}. Item rejected.`);
            return false;
        }

        const raw = result.trim();
        let decisionRaw = raw;
        let justification = '';
        if (raw.includes('::')) {
            const parts = raw.split('::');
            decisionRaw = (parts[0] || '').trim();
            justification = (parts[1] || '').trim();
        }

        const decision = decisionRaw
            .toLowerCase()
            .replace(/[\s\"'`]/g, '')
            .normalize('NFD')
            .replace(/\p{Diacritic}/gu, '');

        // Positive decision
        if (['sim', 'yes', 'si'].includes(decision)) {
            if (justification) {
                item.relevanceJustification = `Account prompt: ${justification}`;
            }
            return true;
        }

        // Negative decision
        if (['nao', 'no'].includes(decision) || decision.startsWith('nao')) {
            if (justification) {
                item.relevanceJustification = `Account prompt rejected: ${justification}`;
            }
            return false;
        }

        // Fallback legacy parsing
        let cleanedResult = raw.toLowerCase().replace(/[.!?",';:()[\]{}]/g, '').trim();
        if (cleanedResult.length <= 2 && !['si', 'no'].includes(cleanedResult)) {
            logger.warn(`NM: Item from @${item.accountName} received unexpected short response: "${result}" (cleaned: "${cleanedResult}"). Item rejected due to ambiguity.`);
            return false;
        }
        if (cleanedResult === 'sim' || cleanedResult === 'yes' || cleanedResult === 'sí' || cleanedResult === 'si') {
            return true;
        }
        if (cleanedResult === 'não' || cleanedResult === 'nao' || cleanedResult === 'no') {
            return false;
        }
        if (cleanedResult.includes('sim') || cleanedResult.includes('yes')) {
            logger.debug(`NM: Item from @${item.accountName} received partial positive match: "${result}". Interpreting as positive.`);
            return true;
        }
        if (cleanedResult.includes('não') || cleanedResult.includes('nao') || cleanedResult.includes('no')) {
            logger.debug(`NM: Item from @${item.accountName} received partial negative match: "${result}". Interpreting as negative.`);
            return false;
        }

        logger.warn(
            `NM: Item from @${item.accountName} FAILED "${promptName}". Unexpected response format: "${result}" (cleaned: "${cleanedResult}"). Item rejected due to parsing ambiguity.`
        );
        return false;
    } catch (error) {
        logger.error(
            `NM: Error during account-specific eval for @${item.accountName}: ${error.message}. Item rejected.`
        );
        return false; // Err on the side of caution, item rejected if evaluation fails
    }
}

/**
 * Evaluates the full content of a news item for relevance.
 * @param {Object} item - The news item to evaluate.
 * @param {Object} config - The NEWS_MONITOR_CONFIG object.
 * @param {Array} recentNewsCache - Recent news items sent to the president (optional).
 * @returns {Promise<boolean>} - True if the item is relevant, false otherwise.
 */
async function evaluateItemFullContent(item, config, recentNewsCache = []) {
    let contentType = '';
    let sourceInfo = '';
    let contentToEvaluate = '';

    if (item.accountName) {
        // Tweet
        contentType = 'Tweet';
        sourceInfo = `Fonte: Twitter (@${item.accountName})`;
        contentToEvaluate = item.text || ''; // Use item.text (original or image-extracted)
    } else if (item.feedName) {
        // RSS Article
        contentType = 'Artigo';
        sourceInfo = `Fonte: ${item.feedName}`;
        // For RSS, item.content is expected to be fuller fetched content.
        // item.description might be a shorter version from the feed itself.
        contentToEvaluate = item.content || item.title || '';
    } else {
        logger.warn('NM: Item type unknown for full content evaluation. Skipping.', item);
        return false; // Cannot evaluate if type is unknown
    }

    if (!contentToEvaluate.trim()) {
        logger.debug(
            `NM: No content to evaluate for item (title: ${
                item.title?.substring(0, 50) || 'N/A'
            }). Marking as not relevant.`
        );
        return false;
    }

    const charLimit = config.CONTENT_LIMITS?.EVALUATION_CHAR_LIMIT || 0;
    const limitedContent =
        charLimit > 0 && contentToEvaluate.length > charLimit
            ? contentToEvaluate.substring(0, charLimit) + '... [content truncated]'
            : contentToEvaluate;

    // Prepare recent news cache for the prompt
    let recentNewsCacheText = 'Nenhuma notícia recente registrada.';
    if (recentNewsCache && recentNewsCache.length > 0) {
        recentNewsCacheText = recentNewsCache.map((news, index) => {
            const timestamp = new Date(news.timestamp).toLocaleString('pt-BR', {
                timeZone: 'America/Sao_Paulo',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit'
            });
            return `${index + 1}. [${timestamp}] ${news.content || news.title || 'Sem conteúdo'} (${news.sourceName || 'Fonte desconhecida'})`;
        }).join('\n');
    }

    const promptTemplate = config.PROMPTS.EVALUATE_CONTENT;
    const modelName = config.AI_MODELS.EVALUATE_CONTENT || config.AI_MODELS.DEFAULT;
    const formattedPrompt = promptTemplate
        .replace('{content}', limitedContent)
        .replace('{recent_news_cache}', recentNewsCacheText)
        .replace('{content_type}', contentType)
        .replace('{source_info}', sourceInfo);

    try {
        logger.debug(
            `NM: Performing full content evaluation for "${(item.title || item.text)?.substring(
                0,
                50
            )}..." using model ${modelName} with ${recentNewsCache.length} cached items.`
        );
        const rawAiResponse = await runCompletion(
            formattedPrompt,
            0.1,
            modelName,
            'EVALUATE_CONTENT'
        );

        // Enhanced response validation
        if (!rawAiResponse || typeof rawAiResponse !== 'string') {
            logger.warn(`NM: Invalid AI response for content evaluation: ${rawAiResponse}. Marking as not relevant.`);
            return false;
        }

        let processedAiResponse = rawAiResponse.trim();

        if (processedAiResponse.startsWith('"') && processedAiResponse.endsWith('"')) {
            processedAiResponse = processedAiResponse.substring(1, processedAiResponse.length - 1);
        }

        // Handle completely unexpected responses (single characters, nonsense)
        if (processedAiResponse.length <= 2) {
            logger.warn(`NM: Item "${(item.title || item.text)?.substring(0, 50)}..." received unexpected short AI response: "${rawAiResponse}". Marking as not relevant.`);
            item.relevanceJustification = `Invalid AI response: "${rawAiResponse}"`;
            return false;
        }

        let relevance = 'null';
        let justification = '';

        if (processedAiResponse.includes('::')) {
            const parts = processedAiResponse.split('::');
            relevance = parts[0].trim().toLowerCase();
            justification = parts.length > 1 ? parts.slice(1).join('::').trim() : '';
        } else {
            relevance = processedAiResponse.toLowerCase().trim();
        }

        // Enhanced relevance parsing with partial matching
        if (relevance === 'relevant' || relevance.includes('relevant')) {
            item.relevanceJustification =
                justification || 'Relevant (no specific justification provided by AI)';
            logger.debug(
                `NM: Item "${(item.title || item.text)?.substring(
                    0,
                    50
                )}..." PASSED full content evaluation. Parsed: [${relevance}] Justification: [${justification}]. Original AI: "${rawAiResponse}"`
            );
            return true;
        }

        // Check for obvious negative responses
        if (relevance === 'null' || relevance === 'not relevant' || relevance === 'irrelevant' || 
            relevance.includes('null') || relevance.includes('not relevant')) {
            item.relevanceJustification = justification || `Not relevant (AI: ${relevance})`;
            logger.debug(
                `NM: Item "${(item.title || item.text)?.substring(
                    0,
                    50
                )}..." FAILED full content evaluation. Parsed: [${relevance}] Justification: [${justification}]. Original AI: "${rawAiResponse}"`
            );
            return false;
        }

        // For ambiguous responses, log warning and mark as not relevant
        logger.warn(
            `NM: Item "${(item.title || item.text)?.substring(
                0,
                50
            )}..." received ambiguous AI response: "${rawAiResponse}". Parsed: [${relevance}]. Marking as not relevant due to parsing ambiguity.`
        );
        item.relevanceJustification = `Ambiguous AI response: "${rawAiResponse}"`;
        return false;

    } catch (error) {
        logger.error(
            `NM: Error during full content evaluation for "${(item.title || item.text)?.substring(
                0,
                50
            )}...": ${error.message}. Marking as not relevant.`
        );
        return false; // Err on the side of caution
    }
}

module.exports = {
    evaluateItemWithAccountSpecificPrompt,
    evaluateItemFullContent,
};
