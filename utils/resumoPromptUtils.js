const logger = require('./logger');
const RESUMO = require('../prompts/resumo.prompt');

/**
 * Get a resumo prompt with variables replaced
 * @param {string} promptName - The name of the prompt template
 * @param {Object} variables - Variables to replace in the prompt
 * @returns {string} The prompt with variables replaced
 */
function getResumoPrompt(promptName, variables = {}) {
    const prompt = RESUMO[promptName];
    if (!prompt) {
        throw new Error(`Unknown resumo prompt: ${promptName}`);
    }

    logger.debug('Getting resumo prompt', {
        promptType: promptName,
        variables: Object.keys(variables),
    });

    let processedPrompt = prompt;

    // Replace all variables in the prompt
    for (const [key, value] of Object.entries(variables)) {
        const stringValue = value?.toString() || '';
        logger.debug(`Replacing variable {${key}}`, {
            valueLength: stringValue.length,
            valueSample: stringValue.substring(0, 50) + (stringValue.length > 50 ? '...' : ''),
        });

        // Create a regex that matches the exact variable pattern
        const regex = new RegExp(`\\{${key}\\}`, 'g');
        processedPrompt = processedPrompt.replace(regex, stringValue);
    }

    logger.debug('Final resumo prompt after replacements', {
        length: processedPrompt.length,
        firstChars: processedPrompt.substring(0, 100) + '...',
    });

    return processedPrompt;
}

module.exports = {
    getResumoPrompt,
}; 