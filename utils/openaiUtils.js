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
        apiKey: config.CREDENTIALS.OPENAI_API_KEY,
    });
}

// Function to run ChatGPT completion
const runCompletion = async (prompt, temperature = 1, model = null, promptType = null) => {
    try {
        // Check if prompt is defined before logging
        if (prompt && config?.SYSTEM?.CONSOLE_LOG_LEVELS?.PROMPT) {
            logger.prompt('ChatGPT Prompt', prompt);
        }

        let modelToUse = model;

        // Model selection priority:
        // 1. Explicitly passed model parameter
        // 2. NEWS_MONITOR.AI_MODELS[promptType] if promptType is specified
        // 3. NEWS_MONITOR.AI_MODELS.DEFAULT as fallback for news monitor functions
        // 4. SYSTEM.OPENAI_MODELS.DEFAULT as final fallback

        if (!modelToUse && promptType && config?.NEWS_MONITOR?.AI_MODELS) {
            // Check if we have a specific model for this prompt type in NEWS_MONITOR.AI_MODELS
            if (config.NEWS_MONITOR.AI_MODELS[promptType]) {
                modelToUse = config.NEWS_MONITOR.AI_MODELS[promptType];
                if (config?.SYSTEM?.CONSOLE_LOG_LEVELS?.DEBUG) {
                    logger.debug(`Using NEWS_MONITOR.AI_MODELS.${promptType}: ${modelToUse}`);
                }
            } else if (config.NEWS_MONITOR.AI_MODELS.DEFAULT) {
                // Fall back to NEWS_MONITOR default if specified prompt type doesn't exist
                modelToUse = config.NEWS_MONITOR.AI_MODELS.DEFAULT;
                if (config?.SYSTEM?.CONSOLE_LOG_LEVELS?.DEBUG) {
                    logger.debug(
                        `Prompt type ${promptType} not found, using NEWS_MONITOR.AI_MODELS.DEFAULT: ${modelToUse}`
                    );
                }
            }
        }

        // If no model is selected yet, use the system default
        if (!modelToUse && config?.SYSTEM?.OPENAI_MODELS?.DEFAULT) {
            modelToUse = config.SYSTEM.OPENAI_MODELS.DEFAULT;
            if (config?.SYSTEM?.CONSOLE_LOG_LEVELS?.DEBUG) {
                logger.debug(`Using SYSTEM.OPENAI_MODELS.DEFAULT: ${modelToUse}`);
            }
        }

        // Final fallback if everything else fails
        if (!modelToUse) {
            modelToUse = 'gpt-4o-mini';
            if (config?.SYSTEM?.CONSOLE_LOG_LEVELS?.DEBUG) {
                logger.debug(
                    `No model configuration found, using hardcoded fallback: ${modelToUse}`
                );
            }
        }

        // Handle temperature restrictions for specific models
        let effectiveTemperature = temperature;
        const modelsRequiringDefaultTemperature = ['gpt-4o-mini', 'o4-mini'];
        
        if (modelsRequiringDefaultTemperature.includes(modelToUse) && temperature !== 1) {
            effectiveTemperature = 1;
            if (config?.SYSTEM?.CONSOLE_LOG_LEVELS?.DEBUG) {
                logger.debug(`Model ${modelToUse} only supports default temperature (1). Adjusting from ${temperature} to 1.`);
            }
        }

        // Log the final model selection before API call
        logger.debug(`OpenAI API Call - Model: ${modelToUse} | Temperature: ${effectiveTemperature} | Type: Single Completion`);

        const openai = getOpenAIClient();
        const completion = await openai.chat.completions.create({
            model: modelToUse,
            messages: [{ role: 'user', content: prompt }],
            temperature: effectiveTemperature,
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

// Function to run ChatGPT completion with conversation history
const runConversationCompletion = async (messages, temperature = 1, model = null, promptType = null) => {
    try {
        // Validate messages format
        if (!Array.isArray(messages) || messages.length === 0) {
            throw new Error('Messages must be a non-empty array');
        }

        // Log the conversation if enabled
        if (config?.SYSTEM?.CONSOLE_LOG_LEVELS?.PROMPT) {
            // Format messages for readable display instead of JSON.stringify
            const formattedMessages = messages.map((msg, index) => {
                return `Message ${index + 1} (${msg.role}):\n${msg.content}\n${'='.repeat(50)}`;
            }).join('\n');
            
            logger.prompt('ChatGPT Conversation Messages', formattedMessages);
        }

        let modelToUse = model;

        // Model selection priority (same as runCompletion)
        if (!modelToUse && promptType && config?.NEWS_MONITOR?.AI_MODELS) {
            if (config.NEWS_MONITOR.AI_MODELS[promptType]) {
                modelToUse = config.NEWS_MONITOR.AI_MODELS[promptType];
                if (config?.SYSTEM?.CONSOLE_LOG_LEVELS?.DEBUG) {
                    logger.debug(`Using NEWS_MONITOR.AI_MODELS.${promptType}: ${modelToUse}`);
                }
            } else if (config.NEWS_MONITOR.AI_MODELS.DEFAULT) {
                modelToUse = config.NEWS_MONITOR.AI_MODELS.DEFAULT;
                if (config?.SYSTEM?.CONSOLE_LOG_LEVELS?.DEBUG) {
                    logger.debug(
                        `Prompt type ${promptType} not found, using NEWS_MONITOR.AI_MODELS.DEFAULT: ${modelToUse}`
                    );
                }
            }
        }

        if (!modelToUse && config?.SYSTEM?.OPENAI_MODELS?.DEFAULT) {
            modelToUse = config.SYSTEM.OPENAI_MODELS.DEFAULT;
            if (config?.SYSTEM?.CONSOLE_LOG_LEVELS?.DEBUG) {
                logger.debug(`Using SYSTEM.OPENAI_MODELS.DEFAULT: ${modelToUse}`);
            }
        }

        if (!modelToUse) {
            modelToUse = 'gpt-4o-mini';
            if (config?.SYSTEM?.CONSOLE_LOG_LEVELS?.DEBUG) {
                logger.debug(
                    `No model configuration found, using hardcoded fallback: ${modelToUse}`
                );
            }
        }

        // Handle temperature restrictions for specific models
        let effectiveTemperature = temperature;
        const modelsRequiringDefaultTemperature = ['gpt-4o-mini', 'o4-mini'];
        
        if (modelsRequiringDefaultTemperature.includes(modelToUse) && temperature !== 1) {
            effectiveTemperature = 1;
            if (config?.SYSTEM?.CONSOLE_LOG_LEVELS?.DEBUG) {
                logger.debug(`Model ${modelToUse} only supports default temperature (1). Adjusting from ${temperature} to 1.`);
            }
        }

        // Log the final model selection before API call
        logger.debug(`OpenAI API Call - Model: ${modelToUse} | Temperature: ${effectiveTemperature} | Type: Conversation Completion`);

        const openai = getOpenAIClient();
        
        // Create the completion request (no tools since web search is not available)
        const completionOptions = {
            model: modelToUse,
            messages: messages,
            temperature: effectiveTemperature,
        };

        const completion = await openai.chat.completions.create(completionOptions);

        const result = completion.choices[0].message.content;

        if (result && config?.SYSTEM?.CONSOLE_LOG_LEVELS?.PROMPT) {
            logger.prompt('ChatGPT Conversation Response', result);
        }

        return {
            content: result,
            usedWebSearch: false, // Web search is not available in API
            searchQueries: [], // No search queries since web search is not supported
            rawResponse: completion
        };
    } catch (error) {
        logger.error('Error in runConversationCompletion:', error);
        throw error;
    }
};

// Legacy function for backward compatibility - returns just the content
const runConversationCompletionLegacy = async (messages, temperature = 1, model = null, promptType = null) => {
    const result = await runConversationCompletion(messages, temperature, model, promptType);
    return result.content;
};

async function extractTextFromImageWithOpenAI(imageUrl, visionPrompt, model = null) {
    try {
        if (!config) {
            throw new Error('Configuration not yet loaded for extractTextFromImageWithOpenAI');
        }

        // Model selection priority for vision tasks:
        // 1. Explicitly passed model parameter
        // 2. NEWS_MONITOR.AI_MODELS.PROCESS_SITREP_IMAGE_PROMPT
        // 3. SYSTEM.OPENAI_MODELS.VISION_DEFAULT
        // 4. Hardcoded fallback to 'gpt-4o-mini'

        let effectiveModel = model;

        if (!effectiveModel && config?.NEWS_MONITOR?.AI_MODELS?.PROCESS_SITREP_IMAGE_PROMPT) {
            effectiveModel = config.NEWS_MONITOR.AI_MODELS.PROCESS_SITREP_IMAGE_PROMPT;
            if (config?.SYSTEM?.CONSOLE_LOG_LEVELS?.DEBUG) {
                logger.debug(
                    `Using NEWS_MONITOR.AI_MODELS.PROCESS_SITREP_IMAGE_PROMPT: ${effectiveModel}`
                );
            }
        } else if (!effectiveModel && config?.SYSTEM?.OPENAI_MODELS?.VISION_DEFAULT) {
            effectiveModel = config.SYSTEM.OPENAI_MODELS.VISION_DEFAULT;
            if (config?.SYSTEM?.CONSOLE_LOG_LEVELS?.DEBUG) {
                logger.debug(`Using SYSTEM.OPENAI_MODELS.VISION_DEFAULT: ${effectiveModel}`);
            }
        }

        // Final fallback
        if (!effectiveModel) {
            effectiveModel = 'gpt-4o-mini';
            if (config?.SYSTEM?.CONSOLE_LOG_LEVELS?.DEBUG) {
                logger.debug(
                    `No vision model configuration found, using hardcoded fallback: ${effectiveModel}`
                );
            }
        }

        if (config?.SYSTEM?.CONSOLE_LOG_LEVELS?.PROMPT) {
            logger.prompt('OpenAI Vision Prompt', visionPrompt);
            logger.prompt('OpenAI Vision Image URL', imageUrl);
        }

        if (config?.SYSTEM?.CONSOLE_LOG_LEVELS?.DEBUG) {
            logger.debug('Sending image URL directly to OpenAI Vision', {
                model: effectiveModel,
                imageUrl,
            });
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
            ...(error.response?.data && { apiErrorData: error.response.data }),
        });
        throw error;
    }
}

module.exports = {
    getOpenAIClient,
    runCompletion,
    runConversationCompletion,
    runConversationCompletionLegacy,
    extractTextFromImageWithOpenAI,
};
