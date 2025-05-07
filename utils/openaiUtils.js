const OpenAI = require('openai');
const logger = require('./logger');

let config;
setTimeout(() => {
    config = require('../configs');
}, 0);

// Initialize OpenAI with a getter function
function getOpenAIClient() {
    if (!config) {
        throw new Error('Configuration not yet loaded');
    }
    return new OpenAI({
        apiKey: config.CREDENTIALS.OPENAI_API_KEY
    });
}

// Function to run ChatGPT completion
const runCompletion = async (prompt, temperature = 1, model = null) => {
    try {
        // Check if prompt is defined before logging
        if (prompt && config?.SYSTEM?.CONSOLE_LOG_LEVELS?.PROMPT) {
            logger.prompt('ChatGPT Prompt', prompt);
        }

        const openai = getOpenAIClient();
        const completion = await openai.chat.completions.create({
            model: model || config.SYSTEM.OPENAI_MODELS.DEFAULT,
            messages: [{ role: 'user', content: prompt }],
            temperature: temperature
        });

        const result = completion.choices[0].message.content;

        // Check if result is defined before logging
        if (result && config?.SYSTEM?.CONSOLE_LOG_LEVELS?.PROMPT) {
            logger.prompt('ChatGPT Response', result);
        }

        return result;
    } catch (error) {
        logger.error('Error in runCompletion:', error);
        throw error;
    }
};

async function extractTextFromImageWithOpenAI(imageUrl, visionPrompt, model = null) {
    try {
        if (!config) {
            throw new Error('Configuration not yet loaded for extractTextFromImageWithOpenAI');
        }

        const effectiveModel = model || config.SYSTEM.OPENAI_MODELS.VISION_DEFAULT || 'gpt-4o-mini';

        if (config?.SYSTEM?.CONSOLE_LOG_LEVELS?.PROMPT) {
            logger.prompt('OpenAI Vision Prompt', visionPrompt);
            logger.prompt('OpenAI Vision Image URL', imageUrl);
        }

        if (config?.SYSTEM?.CONSOLE_LOG_LEVELS?.DEBUG) {
            logger.debug('Sending image URL directly to OpenAI Vision', { model: effectiveModel, imageUrl });
        }

        const openai = getOpenAIClient();
        const completion = await openai.chat.completions.create({
            model: effectiveModel,
            messages: [
                {
                    role: 'user',
                    content: [
                        { type: 'text', text: visionPrompt },
                        {
                            type: 'image_url',
                            image_url: {
                                url: imageUrl,
                            },
                        },
                    ],
                },
            ],
            // max_tokens: 1500 // Max tokens can be adjusted if needed
        });

        const result = completion.choices[0].message.content;

        if (result && config?.SYSTEM?.CONSOLE_LOG_LEVELS?.PROMPT) {
            logger.prompt('OpenAI Vision Response', result);
        }

        return result;
    } catch (error) {
        // Simplified error logging slightly as download error is removed
        logger.error('Error in extractTextFromImageWithOpenAI (using URL):', {
            message: error.message,
            // stack: error.stack, // Stack might be less relevant now, optional
            ...(error.response?.data && { apiErrorData: error.response.data })
        });
        throw error;
    }
}

module.exports = {
    getOpenAIClient,
    runCompletion,
    extractTextFromImageWithOpenAI
}; 