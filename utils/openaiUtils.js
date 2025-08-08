const OpenAI = require('openai');
const logger = require('./logger');

let config;
setTimeout(() => {
    config = require('../configs/config');
}, 0);

// Safe accessors for CHAT-level configuration to avoid tight coupling/cycles
function getChatConfigSafe() {
    try {
        // eslint-disable-next-line global-require
        return require('../chat/chat.config');
    } catch (_) {
        return null;
    }
}

function getReasoningConfig() {
    const chatCfg = getChatConfigSafe();
    if (chatCfg && chatCfg.reasoning) {
        const r = chatCfg.reasoning;
        return {
            ENABLED: r.enabled === true,
            BY_TIER: r.byTier || {},
            SUMMARY: r.summary,
            RETRY_ON_UNSUPPORTED: r.retryOnUnsupported !== false,
            MAX_RETRIES: typeof r.maxRetries === 'number' ? r.maxRetries : 1,
            APPLY_TO_VISION: r.applyToVision === true,
        };
    }
    // Fallback to SYSTEM if present
    const sys = config?.SYSTEM?.REASONING || {};
    return {
        ENABLED: sys.ENABLED === true,
        BY_TIER: sys.BY_TIER || {},
        SUMMARY: sys.SUMMARY,
        RETRY_ON_UNSUPPORTED: sys.RETRY_ON_UNSUPPORTED !== false,
        MAX_RETRIES: typeof sys.MAX_RETRIES === 'number' ? sys.MAX_RETRIES : 1,
        APPLY_TO_VISION: sys.APPLY_TO_VISION === true,
    };
}

function getWebSearchConfig() {
    const chatCfg = getChatConfigSafe();
    if (chatCfg && chatCfg.webSearch) {
        const w = chatCfg.webSearch;
        return {
            USE_OPENAI_TOOL: w.useOpenAITool === true,
            TOOL_CHOICE: w.toolChoice || 'auto',
            MAX_RESULTS: typeof w.maxResults === 'number' ? w.maxResults : 5,
            COUNTRY: w.country || 'br',
            LOCALE: w.locale || 'pt_BR',
            ENFORCE_CITATIONS: w.enforceCitations !== false,
            FALLBACK_TO_LEGACY: w.fallbackToLegacy !== false,
        };
    }
    // Fallback to SYSTEM if present
    const sys = config?.SYSTEM?.WEB_SEARCH || {};
    return {
        USE_OPENAI_TOOL: sys.USE_OPENAI_TOOL === true,
        TOOL_CHOICE: sys.TOOL_CHOICE || 'auto',
        MAX_RESULTS: typeof sys.MAX_RESULTS === 'number' ? sys.MAX_RESULTS : 5,
        COUNTRY: sys.COUNTRY || 'br',
        LOCALE: sys.LOCALE || 'pt_BR',
        ENFORCE_CITATIONS: sys.ENFORCE_CITATIONS !== false,
        FALLBACK_TO_LEGACY: sys.FALLBACK_TO_LEGACY !== false,
    };
}

// Resolve 'TIER:LOW'|'TIER:MEDIUM'|'TIER:HIGH' tokens to concrete model IDs using config.SYSTEM.AI_MODELS
function resolveTierToken(modelOrTierToken) {
    try {
        if (typeof modelOrTierToken === 'string' && modelOrTierToken.startsWith('TIER:')) {
            const tier = modelOrTierToken.split(':')[1];
            return config?.SYSTEM?.AI_MODELS?.[tier] || null;
        }
        return modelOrTierToken;
    } catch (_) {
        return null;
    }
}

// Detect if an error indicates that 'temperature' is not supported for this model/API
function isUnsupportedTemperatureError(error) {
    try {
        const dataStr = (error?.response?.data && JSON.stringify(error.response.data)) || '';
        const msg = String(error?.message || dataStr || '').toLowerCase();
        return (
            msg.includes('unsupported') || msg.includes('not supported') || msg.includes('unknown parameter')
        ) && msg.includes('temperature');
    } catch (_) {
        return false;
    }
}

// Wrapper around openai.responses.create that retries once without 'temperature' if the model rejects it
async function responsesCreateHandlingTemperature(openai, args) {
    try {
        return await openai.responses.create(args);
    } catch (e) {
        if (isUnsupportedTemperatureError(e) && Object.prototype.hasOwnProperty.call(args, 'temperature')) {
            const { temperature, ...rest } = args;
            if (config?.SYSTEM?.CONSOLE_LOG_LEVELS?.DEBUG) {
                logger.warn('Responses API: model does not support temperature, retrying without it', {
                    model: args?.model,
                });
            }
            return await openai.responses.create(rest);
        }
        throw e;
    }
}

// Initialize OpenAI with a getter function
function getOpenAIClient() {
    if (!config) {
        throw new Error('Configuration not yet loaded');
    }
    return new OpenAI({
        apiKey: config.CREDENTIALS.OPENAI_API_KEY,
    });
}

/**
 * Extracts assistant text from Responses API output.
 * Supports SDK convenience field `output_text` and raw `output` array format.
 * @param {object} response
 * @returns {string|null}
 */
function extractTextFromResponses(response) {
    try {
        if (!response) return null;
        if (typeof response.output_text === 'string' && response.output_text.length > 0) {
            return response.output_text;
        }
        if (Array.isArray(response.output)) {
            for (const item of response.output) {
                if (item && Array.isArray(item.content)) {
                    for (const contentPart of item.content) {
                        if (contentPart && contentPart.type === 'output_text' && typeof contentPart.text === 'string') {
                            return contentPart.text;
                        }
                    }
                }
            }
        }
        // Fallbacks for any alternative shapes
        if (response?.data && typeof response.data === 'string') return response.data;
        return null;
    } catch (_) {
        return null;
    }
}

/**
 * Extract a reasoning summary if present in Responses API output.
 * Looks for SDK `reasoning` field or a known metadata location.
 * @param {object} response
 * @returns {string|null}
 */
function extractReasoningSummary(response) {
    try {
        // Prefer the Responses API output shape that actually carries summary text
        // { type: 'reasoning', summary: [{ type: 'summary_text', text: '...' }, ...] }
        if (Array.isArray(response?.output)) {
            for (const item of response.output) {
                if (item && item.type === 'reasoning' && Array.isArray(item.summary)) {
                    const texts = item.summary
                        .filter(p => p && typeof p.text === 'string' && p.text.trim().length > 0)
                        .map(p => p.text.trim());
                    if (texts.length > 0) return texts.join('\n\n');
                }
            }
        }

        // Some SDKs might echo back the request setting as a string ('auto'|'concise'|'detailed').
        // Treat those as non-informative and ignore.
        const sentinel = new Set(['auto', 'concise', 'detailed']);

        // SDK style: response.reasoning?.summary (string)
        const summary = response?.reasoning?.summary;
        if (typeof summary === 'string' && summary.length > 0 && !sentinel.has(summary.trim().toLowerCase())) {
            return summary;
        }

        // Metadata fallback
        const meta = response?.metadata?.reasoning?.summary;
        if (typeof meta === 'string' && meta.length > 0 && !sentinel.has(meta.trim().toLowerCase())) {
            return meta;
        }
        return null;
    } catch (_) {
        return null;
    }
}

/**
 * Extract detailed reasoning trace from Responses API output parts.
 * Concatenates any content parts with type 'reasoning'.
 * @param {object} response
 * @returns {string|null}
 */
function extractReasoningTrace(response) {
    try {
        if (!Array.isArray(response?.output)) return null;
        const collected = [];
        for (const item of response.output) {
            if (item && Array.isArray(item.content)) {
                for (const part of item.content) {
                    if (part && part.type === 'reasoning' && typeof part.text === 'string' && part.text.trim().length > 0) {
                        collected.push(part.text.trim());
                    }
                }
            }
        }
        if (collected.length > 0) return collected.join('\n\n');
        return null;
    } catch (_) {
        return null;
    }
}

// Recursively extract URLs found anywhere in the Responses API object tree.
function extractUrlsFromAny(node, acc = new Set()) {
    try {
        if (node == null) return acc;
        if (typeof node === 'string') {
            for (const url of extractUrls(node)) acc.add(url);
            return acc;
        }
        if (Array.isArray(node)) {
            for (const item of node) extractUrlsFromAny(item, acc);
            return acc;
        }
        if (typeof node === 'object') {
            for (const value of Object.values(node)) extractUrlsFromAny(value, acc);
            return acc;
        }
        return acc;
    } catch (_) {
        return acc;
    }
}

// Normalize web_search response text and FONTES section
function normalizeWebSearchResponseText(text, resp, cfg) {
    if (!text || typeof text !== 'string') return text || '';
    try {
        const webCfg = getWebSearchConfig();
        const urlsInText = extractUrls(text);
        const urlsInMeta = Array.from(extractUrlsFromAny(resp));
        const max = Math.min(webCfg.MAX_RESULTS || 5, 10);
        // Strip tracking/query params and dedupe
        const stripQuery = (u) => {
            try {
                const urlObj = new URL(u);
                return `${urlObj.protocol}//${urlObj.host}${urlObj.pathname}`;
            } catch (_) {
                return u.replace(/\?.*$/, '');
            }
        };
        const merged = Array.from(new Set([...(urlsInText || []), ...urlsInMeta].map(stripQuery))).slice(0, max);

        // Remove internal tool id lines like "turn0search0"
        let cleaned = text.replace(/^[\t \-•]*turn\d+\w*\d.*$/gim, '').trim();

        // Remove any existing Fontes/FONTES blocks entirely to avoid duplication
        cleaned = cleaned.replace(/(?:^|\n)\s*F[OÓ]NTES?:[\s\S]*$/i, '').trim();

        if (merged.length > 0 && webCfg.ENFORCE_CITATIONS) {
            const fontes = ['\n\nFONTES:'];
            merged.forEach((u) => fontes.push(`- ${u}`));
            cleaned = `${cleaned}${fontes.join('\n')}`;
        }
        return cleaned.trim();
    } catch (_) {
        return text;
    }
}

/**
 * Extract unique URLs from text.
 * @param {string} text
 * @returns {string[]} unique URLs
 */
function extractUrls(text) {
    if (!text || typeof text !== 'string') return [];
    const urlRegex = /https?:\/\/[^\s)]+/gi;
    const matches = text.match(urlRegex) || [];
    const unique = Array.from(new Set(matches.map(u => u.replace(/[),.]+$/g, ''))));
    return unique;
}

/**
 * Optionally append a FONTES section with citations if configured and helpful.
 * Keeps inline citations intact; appends consolidated list at the end to reduce clutter.
 * @param {string} content
 * @param {object} cfg
 * @returns {string}
 */
function maybeAppendFontesSection(content, cfg) {
    try {
        if (!cfg?.SYSTEM?.WEB_SEARCH?.ENFORCE_CITATIONS) return content;
        if (!content || typeof content !== 'string') return content;
        if (content.includes('FONTES:')) return content; // already present
        const urls = extractUrls(content);
        if (urls.length === 0) return content;
        const fontes = ['\n\nFONTES:'];
        urls.slice(0, cfg.SYSTEM.WEB_SEARCH.MAX_RESULTS || 5).forEach((u, idx) => {
            fontes.push(`- [${idx + 1}] ${u}`);
        });
        return `${content}\n${fontes.join('\n')}`;
    } catch (_) {
        return content;
    }
}

/**
 * Run Responses API with web_search tool enabled for Chat flows.
 * Returns an assistant message object: { role: 'assistant', content: string }.
 * @param {Array<{role:string,content:string}>} messages
 * @param {object} options
 */
async function runResponsesWithWebSearch(messages, options = {}) {
    if (!config) {
        throw new Error('Configuration not yet loaded for runResponsesWithWebSearch');
    }
    const openai = getOpenAIClient();
    const webCfg = getWebSearchConfig();
    const modelToUse = options?.model || (config?.SYSTEM?.AI_MODELS?.MEDIUM || 'gpt-5-mini');
    const temperature = typeof options?.temperature === 'number' ? options.temperature : 1;
    const toolChoice = webCfg.TOOL_CHOICE === 'required' ? { type: 'web_search' } : 'auto';

    // Add a concise citation instruction without disrupting existing system prompt
    const citationHint = {
        role: 'system',
        content: 'Ao usar pesquisa na web: cite no máximo 1-2 referências inline usando [1],[2] ao lado de afirmações-chave. Evite colar URLs completos no corpo. Sempre finalize com uma única seção "FONTES:" contendo até 5 URLs limpos (sem parâmetros). Não duplique a seção de fontes.'
    };
    const inputMessages = Array.isArray(messages) ? [...messages, citationHint] : [citationHint];

    // Per docs, tool settings belong under top-level tool_config; tool list only specifies type
    const tools = [
        { type: 'web_search_preview' }
    ];

    try {
        const formattedMessages = inputMessages.map((m, i) => `Message ${i + 1} (${m.role}):\n${m.content}\n${'='.repeat(50)}`).join('\n');
        logger.prompt('ChatGPT Conversation Messages', formattedMessages);

        // Determine if reasoning should be attached for this model/tier
        const tier = getTierForModel(modelToUse) || null;
        const reasoningParams = buildReasoningParams(tier, modelToUse, false);

        let resp;
        if (reasoningParams.reasoning) {
            logger.debug(`OpenAI Responses API Call (web_search + reasoning) - Model: ${modelToUse} | Temperature: ${temperature} | Reasoning: ${reasoningParams.reasoning.effort}`);
            resp = await createResponsesWithReasoning(openai, {
                model: modelToUse,
                input: inputMessages,
                temperature,
                tools,
                tool_choice: toolChoice,
            }, reasoningParams.reasoning.effort);
            const rs = extractReasoningSummary(resp);
            const rt = extractReasoningTrace(resp);
            const printed = rs && rs.trim().length > 0 ? rs : '(none returned by model)';
            logger.prompt('Reasoning Summary', printed);
            if (rt && rt.trim().length > 0) {
                logger.prompt('Reasoning Trace', rt);
            }
        } else {
            logger.debug(`OpenAI Responses API Call (web_search enabled) - Model: ${modelToUse} | Temperature: ${temperature}`);
            resp = await responsesCreateHandlingTemperature(openai, {
                model: modelToUse,
                input: inputMessages,
                temperature,
                tools,
                tool_choice: toolChoice
            });
        }

        let text = extractTextFromResponses(resp) || '';
        text = normalizeWebSearchResponseText(text, resp, config);
        if (!text) {
            return { role: 'assistant', content: '' };
        }
        logger.prompt('OpenAI Web Search Response', text);
        return { role: 'assistant', content: text };
    } catch (error) {
        const fallback = webCfg.FALLBACK_TO_LEGACY !== false;
        logger.warn('OpenAI web_search tool path failed', {
            message: error?.message,
            fallbackEnabled: fallback,
        });
        if (fallback) {
            // As a fallback, degrade to regular chat completion over the same messages
            const conv = await runConversationCompletion(inputMessages, temperature, modelToUse, null);
            const content = conv?.content || '';
            return { role: 'assistant', content };
        }
        throw error;
    }
}

/**
 * Selects a model based on centrally configured AI model tiers.
 *
 * This provides a smart fallback when no explicit or NEWS_MONITOR-specific
 * model is configured. It maps known prompt types to complexity tiers and then
 * chooses the corresponding model from `config.SYSTEM.AI_MODELS`.
 *
 * Priority for tiers (when mapping a prompt type):
 * - HIGH tier: complex, multi-sample, or importance-scoring tasks
 * - MEDIUM tier: standard evaluation and detection tasks
 * - LOW tier: summarization, translation, and vision/image extraction tasks
 *
 * If the tier is not available in `SYSTEM.AI_MODELS`, this helper returns null,
 * allowing upstream logic to continue with legacy defaults.
 *
 * @param {string|null} promptType - Semantic key for the prompt type; can be null.
 * @returns {string|null} - Model id from tier config or null if not resolvable.
 */
function getTierBasedModel(promptType) {
    try {
        const tierConfig = config?.SYSTEM?.AI_MODELS;
        if (!tierConfig) {
            return null;
        }

        // Map known prompt types to tiers. Keep this conservative; only map
        // well-understood keys to avoid surprising selections.
        const highTierTypes = new Set([
            'BATCH_EVALUATE_TITLES',
            'EVALUATE_CONSEQUENCE_IMPORTANCE',
        ]);

        const mediumTierTypes = new Set([
            'EVALUATE_CONTENT',
            'DETECT_DUPLICATE',
            'DETECT_TOPIC_REDUNDANCY',
            'DETECT_STORY_DEVELOPMENT',
        ]);

        const lowTierTypes = new Set([
            'SUMMARIZE_CONTENT',
            'TRANSLATION',
            'PROCESS_IMAGE_TEXT_EXTRACTION_PROMPT',
            // Vision/image processing catch-all used by helper callers
            'VISION',
        ]);

        let selectedTier = null;
        if (promptType) {
            if (highTierTypes.has(promptType)) {
                selectedTier = 'HIGH';
            } else if (mediumTierTypes.has(promptType)) {
                selectedTier = 'MEDIUM';
            } else if (lowTierTypes.has(promptType)) {
                selectedTier = 'LOW';
            }
        }

        if (!selectedTier) {
            return null;
        }

        const modelFromTier = tierConfig[selectedTier];
        if (modelFromTier && config?.SYSTEM?.CONSOLE_LOG_LEVELS?.DEBUG) {
            logger.debug(
                `Using tier-based selection for promptType ${promptType}: ${selectedTier} → ${modelFromTier}`
            );
        }
        return modelFromTier || null;
    } catch (err) {
        // In case anything goes wrong, we do not block; just return null to continue fallbacks
        return null;
    }
}

/**
 * Determine configured tier name for a given model id using SYSTEM.AI_MODELS mapping.
 * @param {string} modelId
 * @returns {'LOW'|'MEDIUM'|'HIGH'|null}
 */
function getTierForModel(modelId) {
    try {
        const tiers = config?.SYSTEM?.AI_MODELS || {};
        if (!modelId || !tiers) return null;
        if (tiers.HIGH && tiers.HIGH === modelId) return 'HIGH';
        if (tiers.MEDIUM && tiers.MEDIUM === modelId) return 'MEDIUM';
        if (tiers.LOW && tiers.LOW === modelId) return 'LOW';
        return null;
    } catch (_) {
        return null;
    }
}

/**
 * Build optional reasoning payload based on configured tier and flags.
 * Returns { reasoning: { effort } } or {} if not applicable.
 * @param {'LOW'|'MEDIUM'|'HIGH'|null} tier
 * @param {string} modelId
 * @param {boolean} isVision
 */
function buildReasoningParams(tier, modelId, isVision = false) {
    const reasoningCfg = config?.SYSTEM?.REASONING;
    if (!reasoningCfg || reasoningCfg.ENABLED !== true) return {};
    if (isVision && reasoningCfg.APPLY_TO_VISION === false) return {};

    if (tier !== 'MEDIUM' && tier !== 'HIGH') return {};
    const effort = reasoningCfg.BY_TIER?.[tier];
    if (!effort) return {};
    return { reasoning: { effort } };
}

/**
 * Create a Responses API call with reasoning and robust summary fallback handling.
 * Tries configured summary, then 'detailed', then no summary if API rejects value.
 * @param {import('openai').OpenAI} openai
 * @param {{ model:string, input:any, temperature:number }} baseArgs
 * @param {string} effort
 */
async function createResponsesWithReasoning(openai, baseArgs, effort) {
    const summaryPref = config?.SYSTEM?.REASONING?.SUMMARY;
    const argsBase = {
        ...baseArgs,
    };

    // Attempt with configured summary if present
    if (summaryPref) {
        try {
            const resp = await responsesCreateHandlingTemperature(openai, {
                ...argsBase,
                reasoning: { effort, summary: summaryPref },
            });
            if (config?.SYSTEM?.CONSOLE_LOG_LEVELS?.DEBUG) {
                logger.debug('Responses reasoning call succeeded with summary', { summary: summaryPref });
            }
            return resp;
        } catch (e) {
            const msg = (e?.response?.data && JSON.stringify(e.response.data)) || e?.message || '';
            const lower = String(msg).toLowerCase();
            const looksUnsupportedSummary = lower.includes('unsupported value') || lower.includes('not supported');
            if (!looksUnsupportedSummary) throw e;
            if (config?.SYSTEM?.CONSOLE_LOG_LEVELS?.DEBUG) {
                logger.warn('Reasoning summary not supported for model; retrying with detailed', { preferred: summaryPref });
            }
        }
    }

    // Attempt with 'detailed'
    try {
        const resp = await responsesCreateHandlingTemperature(openai, {
            ...argsBase,
            reasoning: { effort, summary: 'detailed' },
        });
        if (config?.SYSTEM?.CONSOLE_LOG_LEVELS?.DEBUG) {
            logger.debug('Responses reasoning call succeeded with summary', { summary: 'detailed' });
        }
        return resp;
    } catch (e2) {
        const msg2 = (e2?.response?.data && JSON.stringify(e2.response.data)) || e2?.message || '';
        const lower2 = String(msg2).toLowerCase();
        const stillSummaryIssue = lower2.includes('unsupported value') || lower2.includes('not supported');
        if (!stillSummaryIssue) throw e2;
        if (config?.SYSTEM?.CONSOLE_LOG_LEVELS?.DEBUG) {
            logger.warn('Reasoning summary still unsupported; retrying without summary');
        }
    }

    // Attempt with no summary
    const resp = await responsesCreateHandlingTemperature(openai, {
        ...argsBase,
        reasoning: { effort },
    });
    if (config?.SYSTEM?.CONSOLE_LOG_LEVELS?.DEBUG) {
        logger.debug('Responses reasoning call succeeded without summary');
    }
    return resp;
}

function shouldRetryWithoutReasoning(error) {
    const reasoningCfg = config?.SYSTEM?.REASONING;
    if (!reasoningCfg || reasoningCfg.RETRY_ON_UNSUPPORTED !== true) return false;
    const status = error?.response?.status;
    const data = (error?.response?.data && JSON.stringify(error.response.data)) || '';
    const lowerData = data.toLowerCase();
    // Only retry on explicit request-argument rejections
    const looksUnsupported =
        status === 400 && (
            lowerData.includes('unrecognized') ||
            lowerData.includes('unknown') ||
            lowerData.includes('does not support') ||
            lowerData.includes('reasoning') ||
            lowerData.includes('invalid')
        );
    return looksUnsupported;
}

// Function to run ChatGPT completion
const runCompletion = async (prompt, temperature = 1, model = null, promptType = null) => {
    try {
        // Log prompt (logger handles its own enable/disable logic)
        if (prompt) {
            logger.prompt('ChatGPT Prompt', prompt);
        }

        // Resolve tier tokens (e.g., 'TIER:MEDIUM') that may be passed directly
        let modelToUse = resolveTierToken(model);

        // Model selection priority:
        // 1. Explicitly passed model parameter
        // 2. NEWS_MONITOR.AI_MODELS[promptType] if promptType is specified
        // 3. NEWS_MONITOR.AI_MODELS.DEFAULT as fallback for news monitor functions
        // 4. SYSTEM.AI_MODELS tier-based selection (LOW/MEDIUM/HIGH)
        // 5. SYSTEM.OPENAI_MODELS.DEFAULT as final legacy fallback

        if (!modelToUse && promptType && config?.NEWS_MONITOR?.AI_MODELS) {
            // Check if we have a specific model for this prompt type in NEWS_MONITOR.AI_MODELS
            if (config.NEWS_MONITOR.AI_MODELS[promptType]) {
                modelToUse = resolveTierToken(config.NEWS_MONITOR.AI_MODELS[promptType]);
                if (config?.SYSTEM?.CONSOLE_LOG_LEVELS?.DEBUG) {
                    logger.debug(`Using NEWS_MONITOR.AI_MODELS.${promptType}: ${modelToUse}`);
                }
            } else if (config.NEWS_MONITOR.AI_MODELS.DEFAULT) {
                // Fall back to NEWS_MONITOR default if specified prompt type doesn't exist
                modelToUse = resolveTierToken(config.NEWS_MONITOR.AI_MODELS.DEFAULT);
                if (config?.SYSTEM?.CONSOLE_LOG_LEVELS?.DEBUG) {
                    logger.debug(
                        `Prompt type ${promptType} not found, using NEWS_MONITOR.AI_MODELS.DEFAULT: ${modelToUse}`
                    );
                }
            }
        }

        // New tier-based selection using the centralized config if still unresolved
        if (!modelToUse && promptType) {
            const tierModel = getTierBasedModel(promptType);
            if (tierModel) {
                modelToUse = tierModel;
            }
        }

        // If no model is selected yet, prefer tier LOW, then DEFAULT
        if (!modelToUse) {
            if (config?.SYSTEM?.AI_MODELS?.LOW) {
                modelToUse = config.SYSTEM.AI_MODELS.LOW;
                if (config?.SYSTEM?.CONSOLE_LOG_LEVELS?.DEBUG) {
                    logger.debug(`Using SYSTEM.AI_MODELS.LOW as fallback: ${modelToUse}`);
                }
            } else if (config?.SYSTEM?.OPENAI_MODELS?.DEFAULT) {
                modelToUse = config.SYSTEM.OPENAI_MODELS.DEFAULT;
                if (config?.SYSTEM?.CONSOLE_LOG_LEVELS?.DEBUG) {
                    logger.debug(`Using SYSTEM.OPENAI_MODELS.DEFAULT: ${modelToUse}`);
                }
            } else {
                // Final conservative fallback
                modelToUse = 'gpt-5-nano';
                if (config?.SYSTEM?.CONSOLE_LOG_LEVELS?.DEBUG) {
                    logger.debug(`No model configuration found, using hardcoded fallback: ${modelToUse}`);
                }
            }
        }

        // Handle temperature restrictions for specific models
        let effectiveTemperature = temperature;
        const modelsRequiringDefaultTemperature = ['gpt-5-nano', 'gpt-5-mini'];
        
        if (modelsRequiringDefaultTemperature.includes(modelToUse) && temperature !== 1) {
            effectiveTemperature = 1;
            if (config?.SYSTEM?.CONSOLE_LOG_LEVELS?.DEBUG) {
                logger.debug(`Model ${modelToUse} only supports default temperature (1). Adjusting from ${temperature} to 1.`);
            }
        }

        // Build payload (with optional reasoning)
        const tier = getTierForModel(modelToUse) || (promptType ? getTierForModel(getTierBasedModel(promptType)) : null);
        const basePayload = {
            model: modelToUse,
            messages: [{ role: 'user', content: prompt }],
            temperature: effectiveTemperature,
        };
        const reasoningParams = buildReasoningParams(tier, modelToUse, false);
        if (reasoningParams.reasoning && config?.SYSTEM?.CONSOLE_LOG_LEVELS?.DEBUG) {
            logger.debug('Reasoning enabled for request', {
                model: modelToUse,
                tier,
                effort: reasoningParams.reasoning.effort,
                operation: 'single',
            });
        }
        const openai = getOpenAIClient();

        logger.debug(`OpenAI API Call - Model: ${modelToUse} | Temperature: ${effectiveTemperature} | Type: Single Completion${reasoningParams.reasoning ? ' | Reasoning: ' + reasoningParams.reasoning.effort : ''}`);

        let finalText = null;
        if (reasoningParams.reasoning) {
            // Prefer Responses API when reasoning is enabled (per OpenAI docs)
            try {
                logger.debug(`OpenAI Responses API Call - Model: ${modelToUse} | Temperature: ${effectiveTemperature} | Type: Single Completion | Reasoning: ${reasoningParams.reasoning.effort}`);
                const resp = await createResponsesWithReasoning(openai, {
                    model: modelToUse,
                    input: [{ role: 'user', content: prompt }],
                    temperature: effectiveTemperature,
                }, reasoningParams.reasoning.effort);
                finalText = extractTextFromResponses(resp);
                const reasoningSummary = extractReasoningSummary(resp);
                const reasoningTrace = extractReasoningTrace(resp);
                const printedSummary = reasoningSummary && reasoningSummary.trim().length > 0
                    ? reasoningSummary
                    : '(none returned by model)';
                logger.prompt('Reasoning Summary', printedSummary);
                if (reasoningTrace && reasoningTrace.trim().length > 0) {
                    logger.prompt('Reasoning Trace', reasoningTrace);
                }
                if (!finalText) {
                    // As a safety net, try chat.completions with reasoning (some models may accept it)
                    const completion = await openai.chat.completions.create({
                        ...basePayload,
                        ...reasoningParams,
                    });
                    finalText = completion?.choices?.[0]?.message?.content || null;
                }
            } catch (err) {
                const maxRetries = config?.SYSTEM?.REASONING?.MAX_RETRIES ?? 1;
                if (maxRetries > 0 && shouldRetryWithoutReasoning(err)) {
                    logger.warn('Reasoning parameter rejected, retrying without reasoning', {
                        model: modelToUse,
                        tier,
                        effort: reasoningParams.reasoning.effort,
                        operation: 'single',
                        error: err.message,
                    });
                    const completion = await openai.chat.completions.create(basePayload);
                    finalText = completion?.choices?.[0]?.message?.content || null;
                } else {
                    throw err;
                }
            }
        } else {
            // Standard Chat Completions path (no reasoning)
            const completion = await openai.chat.completions.create(basePayload);
            finalText = completion?.choices?.[0]?.message?.content || null;
        }

        if (finalText) {
            const usedReasoning = !!reasoningParams.reasoning;
            logger.prompt(
                `ChatGPT Completion Response${usedReasoning ? ' (with reasoning)' : ''}`,
                finalText
            );
        }

        return finalText;

    } catch (error) {
        logger.error('Error getting completion from OpenAI:', {
            error: error.message,
            model: model || 'default',
            prompt: prompt,
            temperature: temperature,
        });
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

        // Log the conversation (logger handles its own enable/disable logic)
        // Format messages for readable display instead of JSON.stringify
        const formattedMessages = messages.map((msg, index) => {
            return `Message ${index + 1} (${msg.role}):\n${msg.content}\n${'='.repeat(50)}`;
        }).join('\n');
        
        logger.prompt('ChatGPT Conversation Messages', formattedMessages);

        // Resolve tier tokens (e.g., 'TIER:MEDIUM') that may be passed directly
        let modelToUse = resolveTierToken(model);

        // Model selection priority (same as runCompletion)
        if (!modelToUse && promptType && config?.NEWS_MONITOR?.AI_MODELS) {
            if (config.NEWS_MONITOR.AI_MODELS[promptType]) {
                modelToUse = resolveTierToken(config.NEWS_MONITOR.AI_MODELS[promptType]);
                if (config?.SYSTEM?.CONSOLE_LOG_LEVELS?.DEBUG) {
                    logger.debug(`Using NEWS_MONITOR.AI_MODELS.${promptType}: ${modelToUse}`);
                }
            } else if (config.NEWS_MONITOR.AI_MODELS.DEFAULT) {
                modelToUse = resolveTierToken(config.NEWS_MONITOR.AI_MODELS.DEFAULT);
                if (config?.SYSTEM?.CONSOLE_LOG_LEVELS?.DEBUG) {
                    logger.debug(
                        `Prompt type ${promptType} not found, using NEWS_MONITOR.AI_MODELS.DEFAULT: ${modelToUse}`
                    );
                }
            }
        }

        // New tier-based selection using the centralized config if still unresolved
        if (!modelToUse && promptType) {
            const tierModel = getTierBasedModel(promptType);
            if (tierModel) {
                modelToUse = tierModel;
            }
        }

        if (!modelToUse) {
            if (config?.SYSTEM?.AI_MODELS?.LOW) {
                modelToUse = config.SYSTEM.AI_MODELS.LOW;
                if (config?.SYSTEM?.CONSOLE_LOG_LEVELS?.DEBUG) {
                    logger.debug(`Using SYSTEM.AI_MODELS.LOW as fallback: ${modelToUse}`);
                }
            } else if (config?.SYSTEM?.OPENAI_MODELS?.DEFAULT) {
                modelToUse = config.SYSTEM.OPENAI_MODELS.DEFAULT;
                if (config?.SYSTEM?.CONSOLE_LOG_LEVELS?.DEBUG) {
                    logger.debug(`Using SYSTEM.OPENAI_MODELS.DEFAULT: ${modelToUse}`);
                }
            } else {
                modelToUse = 'gpt-5-nano';
                if (config?.SYSTEM?.CONSOLE_LOG_LEVELS?.DEBUG) {
                    logger.debug(`No model configuration found, using hardcoded fallback: ${modelToUse}`);
                }
            }
        }

        // Handle temperature restrictions for specific models
        let effectiveTemperature = temperature;
        const modelsRequiringDefaultTemperature = ['gpt-5-nano', 'gpt-5-mini'];
        
        if (modelsRequiringDefaultTemperature.includes(modelToUse) && temperature !== 1) {
            effectiveTemperature = 1;
            if (config?.SYSTEM?.CONSOLE_LOG_LEVELS?.DEBUG) {
                logger.debug(`Model ${modelToUse} only supports default temperature (1). Adjusting from ${temperature} to 1.`);
            }
        }

        // Build payload (with optional reasoning)
        const tier = getTierForModel(modelToUse) || (promptType ? getTierForModel(getTierBasedModel(promptType)) : null);
        const basePayload = {
            model: modelToUse,
            messages: messages,
            temperature: effectiveTemperature,
        };
        const reasoningParams = buildReasoningParams(tier, modelToUse, false);
        if (reasoningParams.reasoning && config?.SYSTEM?.CONSOLE_LOG_LEVELS?.DEBUG) {
            logger.debug('Reasoning enabled for request', {
                model: modelToUse,
                tier,
                effort: reasoningParams.reasoning.effort,
                operation: 'conversation',
            });
        }

        const openai = getOpenAIClient();

        logger.debug(`OpenAI API Call - Model: ${modelToUse} | Temperature: ${effectiveTemperature} | Type: Conversation Completion${reasoningParams.reasoning ? ' | Reasoning: ' + reasoningParams.reasoning.effort : ''}`);

        let finalMessageObj = null;
        if (reasoningParams.reasoning) {
            try {
                logger.debug(`OpenAI Responses API Call - Model: ${modelToUse} | Temperature: ${effectiveTemperature} | Type: Conversation Completion | Reasoning: ${reasoningParams.reasoning.effort}`);
                const resp = await createResponsesWithReasoning(openai, {
                    model: modelToUse,
                    input: messages,
                    temperature: effectiveTemperature,
                }, reasoningParams.reasoning.effort);
                const text = extractTextFromResponses(resp);
                finalMessageObj = { role: 'assistant', content: text || '' };
                const reasoningSummary = extractReasoningSummary(resp);
                const reasoningTrace = extractReasoningTrace(resp);
                const printedSummary = reasoningSummary && reasoningSummary.trim().length > 0
                    ? reasoningSummary
                    : '(none returned by model)';
                logger.prompt('Reasoning Summary', printedSummary);
                if (reasoningTrace && reasoningTrace.trim().length > 0) {
                    logger.prompt('Reasoning Trace', reasoningTrace);
                }
                if (!text) {
                    // Fallback to chat.completions with reasoning params
                    const completion = await openai.chat.completions.create({
                        ...basePayload,
                        ...reasoningParams,
                    });
                    finalMessageObj = completion?.choices?.[0]?.message || null;
                }
            } catch (err) {
                const maxRetries = config?.SYSTEM?.REASONING?.MAX_RETRIES ?? 1;
                if (maxRetries > 0 && shouldRetryWithoutReasoning(err)) {
                    logger.warn('Reasoning parameter rejected, retrying without reasoning', {
                        model: modelToUse,
                        tier,
                        effort: reasoningParams.reasoning.effort,
                        operation: 'conversation',
                        error: err.message,
                    });
                    const completion = await openai.chat.completions.create(basePayload);
                    finalMessageObj = completion?.choices?.[0]?.message || null;
                } else {
                    throw err;
                }
            }
        } else {
            const completion = await openai.chat.completions.create(basePayload);
            finalMessageObj = completion?.choices?.[0]?.message || null;
        }

        if (finalMessageObj?.content) {
            const usedReasoning = !!reasoningParams.reasoning;
            logger.prompt(
                `ChatGPT Conversation Response${usedReasoning ? ' (with reasoning)' : ''}`,
                finalMessageObj.content
            );
        }

        return finalMessageObj;

    } catch (error) {
        logger.error('Error getting conversation completion from OpenAI:', {
            error: error.message,
            model: model || 'default',
            numMessages: messages ? messages.length : 0
        });
        throw error;
    }
};

// Legacy function for backward compatibility - returns just the content
const runConversationCompletionLegacy = async (messages, temperature = 1, model = null, promptType = null) => {
    const result = await runConversationCompletion(messages, temperature, model, promptType, null);
    return result.content;
};

async function extractTextFromImageWithOpenAI(imageUrl, visionPrompt, model = null) {
    try {
        if (!config) {
            throw new Error('Configuration not yet loaded for extractTextFromImageWithOpenAI');
        }

        // Model selection priority for vision tasks:
        // 1. Explicitly passed model parameter
        // 2. NEWS_MONITOR.AI_MODELS.PROCESS_IMAGE_TEXT_EXTRACTION_PROMPT
        // 3. NEWS_MONITOR.AI_MODELS.DEFAULT
        // 4. SYSTEM.AI_MODELS tier-based selection (LOW for vision)
        // 5. SYSTEM.OPENAI_MODELS.VISION_DEFAULT
        // 6. Fallback to SYSTEM tiers/defaults (no hardcoded)

        let effectiveModel = model;

        // Prefer the vision-specific key from NEWS_MONITOR if present
        if (!effectiveModel && config?.NEWS_MONITOR?.AI_MODELS?.PROCESS_IMAGE_TEXT_EXTRACTION_PROMPT) {
            effectiveModel = config.NEWS_MONITOR.AI_MODELS.PROCESS_IMAGE_TEXT_EXTRACTION_PROMPT;
            if (config?.SYSTEM?.CONSOLE_LOG_LEVELS?.DEBUG) {
                logger.debug(
                    `Using NEWS_MONITOR.AI_MODELS.PROCESS_IMAGE_TEXT_EXTRACTION_PROMPT: ${effectiveModel}`
                );
            }
        }

        // Allow fallback to NEWS_MONITOR default if defined
        if (!effectiveModel && config?.NEWS_MONITOR?.AI_MODELS?.DEFAULT) {
            effectiveModel = resolveTierToken(config.NEWS_MONITOR.AI_MODELS.DEFAULT);
            if (config?.SYSTEM?.CONSOLE_LOG_LEVELS?.DEBUG) {
                logger.debug(
                    `Vision model not specified, using NEWS_MONITOR.AI_MODELS.DEFAULT: ${effectiveModel}`
                );
            }
        }

        // New tier-based selection: treat vision/image OCR as LOW tier by default
        if (!effectiveModel) {
            const tierModel = getTierBasedModel('PROCESS_IMAGE_TEXT_EXTRACTION_PROMPT') || getTierBasedModel('VISION');
            if (tierModel) {
                effectiveModel = tierModel;
            }
        }

        // Legacy vision default
        if (!effectiveModel && config?.SYSTEM?.OPENAI_MODELS?.VISION_DEFAULT) {
            effectiveModel = config.SYSTEM.OPENAI_MODELS.VISION_DEFAULT;
            if (config?.SYSTEM?.CONSOLE_LOG_LEVELS?.DEBUG) {
                logger.debug(`Using SYSTEM.OPENAI_MODELS.VISION_DEFAULT: ${effectiveModel}`);
            }
        }

        // Final fallback
        if (!effectiveModel) {
            if (config?.SYSTEM?.AI_MODELS?.LOW) {
                effectiveModel = config.SYSTEM.AI_MODELS.LOW;
                if (config?.SYSTEM?.CONSOLE_LOG_LEVELS?.DEBUG) {
                    logger.debug(`Using SYSTEM.AI_MODELS.LOW for vision fallback: ${effectiveModel}`);
                }
            } else if (config?.SYSTEM?.OPENAI_MODELS?.VISION_DEFAULT) {
                effectiveModel = config.SYSTEM.OPENAI_MODELS.VISION_DEFAULT;
                if (config?.SYSTEM?.CONSOLE_LOG_LEVELS?.DEBUG) {
                    logger.debug(`Using SYSTEM.OPENAI_MODELS.VISION_DEFAULT as vision fallback: ${effectiveModel}`);
                }
            } else if (config?.SYSTEM?.OPENAI_MODELS?.DEFAULT) {
                effectiveModel = config.SYSTEM.OPENAI_MODELS.DEFAULT;
                if (config?.SYSTEM?.CONSOLE_LOG_LEVELS?.DEBUG) {
                    logger.debug(`Using SYSTEM.OPENAI_MODELS.DEFAULT as final fallback: ${effectiveModel}`);
                }
            } else {
                effectiveModel = 'gpt-5-nano';
                if (config?.SYSTEM?.CONSOLE_LOG_LEVELS?.DEBUG) {
                    logger.debug(`No model configuration found, using hardcoded fallback: ${effectiveModel}`);
                }
            }
        }

        logger.prompt('OpenAI Vision Prompt', visionPrompt);
        logger.prompt('OpenAI Vision Image URL', imageUrl);

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

        if (result) {
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
    runResponsesWithWebSearch,
};
