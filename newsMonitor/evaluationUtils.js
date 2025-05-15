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
    if (!item.accountName || !item.text || item.text.trim() === '') return true;

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
        ? promptTemplate.replace('{post}', item.text)
        : promptTemplate.includes('{content}')
        ? promptTemplate.replace('{content}', item.text)
        : promptTemplate; // Fallback if no placeholder, though unlikely for this type of prompt

    try {
        logger.debug(
            `NM: Evaluating @${item.accountName}'s item with "${promptName}" using model ${modelName}.`
        );
        const result = await runCompletion(formattedPrompt, 0.3, modelName, promptName);
        const cleanedResult = result.trim().toLowerCase();

        if (cleanedResult === 'sim') return true;

        logger.debug(
            `NM: Item from @${item.accountName} FAILED "${promptName}". Response: "${result}"`
        );
        return false;
    } catch (error) {
        logger.error(
            `NM: Error during account-specific eval for @${item.accountName}: ${error.message}. Item passes.`
        );
        return true; // Err on the side of caution, item passes if evaluation fails
    }
}

/**
 * Evaluates the full content of a news item for relevance.
 * @param {Object} item - The news item to evaluate.
 * @param {Object} config - The NEWS_MONITOR_CONFIG object.
 * @returns {Promise<boolean>} - True if the item is relevant, false otherwise.
 */
async function evaluateItemFullContent(item, config) {
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

    const promptTemplate = config.PROMPTS.EVALUATE_CONTENT;
    const modelName = config.AI_MODELS.EVALUATE_CONTENT || config.AI_MODELS.DEFAULT;
    const formattedPrompt = promptTemplate
        .replace('{content}', limitedContent)
        .replace('{content_type}', contentType)
        .replace('{source_info}', sourceInfo);

    try {
        logger.debug(
            `NM: Performing full content evaluation for "${(item.title || item.text)?.substring(
                0,
                50
            )}..." using model ${modelName}.`
        );
        const rawAiResponse = await runCompletion(
            formattedPrompt,
            0.3,
            modelName,
            'EVALUATE_CONTENT'
        );
        let processedAiResponse = rawAiResponse.trim();

        if (processedAiResponse.startsWith('"') && processedAiResponse.endsWith('"')) {
            processedAiResponse = processedAiResponse.substring(1, processedAiResponse.length - 1);
        }

        let relevance = 'null';
        let justification = '';

        if (processedAiResponse.includes('::')) {
            const parts = processedAiResponse.split('::');
            relevance = parts[0].trim().toLowerCase();
            justification = parts.length > 1 ? parts.slice(1).join('::').trim() : '';
        } else {
            relevance = processedAiResponse.toLowerCase();
        }

        if (relevance === 'relevant') {
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
        // Store justification even if not relevant, for logging/debugging purposes
        item.relevanceJustification = justification || `Not relevant (AI: ${relevance})`;
        logger.debug(
            `NM: Item "${(item.title || item.text)?.substring(
                0,
                50
            )}..." FAILED full content evaluation. Parsed: [${relevance}] Justification: [${justification}]. Original AI: "${rawAiResponse}"`
        );
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
