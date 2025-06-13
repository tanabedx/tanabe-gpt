const logger = require('../utils/logger');
const { fetchContextMessages } = require('./contextManager');

/**
 * Parse context request from ChatGPT response
 * @param {string} response - ChatGPT response
 * @returns {Object|null} Context request object or null if no request found
 */
function parseContextRequest(response) {
    if (!response || typeof response !== 'string') {
        return null;
    }

    // Look for the exact pattern: REQUEST_CONTEXT: [number]
    const contextRequestPattern = /REQUEST_CONTEXT:\s*(\d+)/i;
    const match = response.match(contextRequestPattern);

    if (match) {
        const requestedCount = parseInt(match[1], 10);
        
        // Validate the requested count
        if (isNaN(requestedCount) || requestedCount <= 0) {
            logger.warn('Invalid context request count:', match[1]);
            return null;
        }

        // Cap the request to maximum allowed (100)
        const actualCount = Math.min(requestedCount, 100);
        
        logger.debug('Context request parsed', {
            requested: requestedCount,
            actual: actualCount,
            capped: requestedCount > 100
        });

        return {
            requestedCount: requestedCount,
            actualCount: actualCount,
            wasCapped: requestedCount > 100
        };
    }

    return null;
}

/**
 * Check if response is purely a context request (no other content)
 * @param {string} response - ChatGPT response
 * @returns {boolean} True if response contains only context request
 */
function isPureContextRequest(response) {
    if (!response || typeof response !== 'string') {
        return false;
    }

    // Remove the context request pattern and check if anything meaningful remains
    const contextRequestPattern = /REQUEST_CONTEXT:\s*\d+/gi;
    const withoutContextRequest = response.replace(contextRequestPattern, '').trim();
    
    // Consider it pure if only whitespace, punctuation, or very short content remains
    const meaningfulContent = withoutContextRequest.replace(/[.,!?;:\s\-\n\r]/g, '');
    
    return meaningfulContent.length <= 5; // Allow for small words like "ok", "sim", etc.
}

/**
 * Handle context request from ChatGPT
 * @param {string} response - ChatGPT response containing context request
 * @param {string} groupName - Group name for context fetching
 * @param {Object} config - Configuration object
 * @returns {Promise<Object>} Context handling result
 */
async function handleContextRequest(response, groupName, config) {
    try {
        const contextRequest = parseContextRequest(response);
        
        if (!contextRequest) {
            return {
                hasContextRequest: false,
                context: null,
                fetchStatus: 'NO_REQUEST',
                newMessagesCount: 0,
                error: null
            };
        }

        logger.debug('Handling context request', {
            groupName,
            requestedCount: contextRequest.requestedCount,
            actualCount: contextRequest.actualCount
        });

        // Fetch the requested context
        const { 
            context, 
            status: fetchStatus, 
            newMessagesCount 
        } = await fetchContextMessages(
            groupName, 
            contextRequest.actualCount,
            false // Don't reset context cache
        );

        const result = {
            hasContextRequest: true,
            context: context,
            fetchStatus: fetchStatus,
            newMessagesCount: newMessagesCount,
            contextRequest: contextRequest,
            error: null,
            isPureRequest: isPureContextRequest(response)
        };

        if (fetchStatus === 'ERROR_CLIENT_NOT_AVAILABLE' || fetchStatus === 'ERROR_GROUP_NOT_ALLOWED' || fetchStatus === 'ERROR_CHAT_NOT_FOUND' || fetchStatus === 'ERROR_FETCHING_CONTEXT') {
            logger.error(`Context fetching failed with status: ${fetchStatus}`, { groupName });
            result.error = `Error fetching context: ${fetchStatus}`;
        } else if (!context || context.trim().length === 0) {
            // Only warn if this is truly an unexpected empty context situation
            // Don't warn for expected completion states
            if (fetchStatus === 'ALL_MESSAGES_RETRIEVED' || fetchStatus === 'MAX_MESSAGES_LIMIT_REACHED' || fetchStatus === 'NO_NEW_MESSAGES_IN_CACHE') {
                logger.debug(`Context request completed with status: ${fetchStatus}`, { groupName });
            } else {
                logger.warn(`No new context messages content returned by fetchContextMessages or context is empty. Status: ${fetchStatus}`, { groupName });
            }
        } else {
            logger.debug(`Context fetched by fetchContextMessages. Status: ${fetchStatus}`, {
                groupName,
                contextLength: context.length,
                messageLines: context.split('\n').length,
                newMessagesCount: newMessagesCount
            });
        }

        return result;

    } catch (error) {
        logger.error('Error handling context request:', error);
        return {
            hasContextRequest: true,
            context: null,
            fetchStatus: 'EXCEPTION_IN_HANDLER',
            newMessagesCount: 0,
            error: error.message,
            isPureRequest: isPureContextRequest(response)
        };
    }
}

/**
 * Validate context request against limits
 * @param {string} groupName - Group name
 * @param {number} currentRequests - Current number of requests in conversation
 * @param {Object} config - Configuration object
 * @returns {Object} Validation result
 */
function validateContextRequest(groupName, currentRequests, config) {
    const maxRequests = config?.COMMANDS?.CHAT?.contextManagement?.maxContextRequests || 10;
    const contextEnabled = config?.COMMANDS?.CHAT?.contextManagement?.enabled !== false;

    if (!contextEnabled) {
        return {
            isValid: false,
            reason: 'Context management is disabled'
        };
    }

    if (currentRequests >= maxRequests) {
        return {
            isValid: false,
            reason: `Maximum context requests reached (${maxRequests})`
        };
    }

    return {
        isValid: true,
        reason: null
    };
}

/**
 * Format context response message
 * @param {Object} contextResult - Result from handleContextRequest
 * @returns {string} Formatted message for user
 */
function formatContextResponse(contextResult) {
    if (!contextResult.hasContextRequest) {
        return null;
    }

    if (contextResult.error) {
        return `⚠️ Erro ao buscar contexto: ${contextResult.error}`;
    }

    switch (contextResult.fetchStatus) {
        case 'NEW_MESSAGES_SENT':
            if (!contextResult.context || contextResult.context.trim().length === 0) {
                return '📝 Nenhuma nova mensagem de contexto encontrada, mas o processamento continua.';
            }
            const messageCount = contextResult.newMessagesCount;
            const wasCappedByRequest = contextResult.contextRequest?.wasCapped;
            let message = `📋 Contexto carregado: ${messageCount} nova(s) mensagem(ns)`;
            if (wasCappedByRequest) {
                message += ` (limitado a ${contextResult.contextRequest.actualCount} por requisição)`;
            }
            message += '. Processando...';
            return message;
        case 'NO_NEW_MESSAGES_IN_CACHE':
            return '📝 Não há novas mensagens de contexto no cache no momento. O bot usará o que já possui.';
        case 'ALL_MESSAGES_RETRIEVED':
            return '✅ Todo o histórico de mensagens disponível foi carregado.';
        case 'MAX_MESSAGES_LIMIT_REACHED':
            return '🛑 Limite máximo de mensagens de contexto (1000) atingido.';
        case 'ERROR_CLIENT_NOT_AVAILABLE':
        case 'ERROR_GROUP_NOT_ALLOWED':
        case 'ERROR_CHAT_NOT_FOUND':
        case 'ERROR_FETCHING_CONTEXT':
        case 'EXCEPTION_IN_HANDLER':
            return `⚠️ Erro ao processar requisição de contexto (${contextResult.fetchStatus}).`;
        default:
            if (!contextResult.context || contextResult.context.trim().length === 0) {
                return '📝 Não há mensagens disponíveis para contexto.';
            }
            const genericMessageCount = contextResult.context.split('\n').filter(line => line.trim()).length;
            return `📋 Contexto carregado (${genericMessageCount} linhas). Status: ${contextResult.fetchStatus || 'desconhecido'}. Processando...`;
    }
}

/**
 * Check if ChatGPT response indicates it should have requested more context
 * @param {string} response - ChatGPT response
 * @param {string} originalQuestion - Original user question
 * @param {number} contextRequestCount - Number of context requests made so far
 * @param {Object} config - Configuration object
 * @returns {boolean} True if response suggests need for more context
 */
function shouldAutoRequestContext(response, originalQuestion, contextRequestCount, config) {
    if (!response || typeof response !== 'string') {
        return false;
    }

    const maxRequests = config?.COMMANDS?.CHAT?.contextManagement?.maxContextRequests || 10;
    
    // Don't auto-request if we're at the limit
    if (contextRequestCount >= maxRequests) {
        return false;
    }

    const responseLower = response.toLowerCase();
    const questionLower = originalQuestion.toLowerCase();

    // Patterns that indicate ChatGPT should have requested more context
    const needsMoreContextPatterns = [
        /não encontrei informações/,
        /não consegui encontrar/,
        /não há informações/,
        /não localizei/,
        /gostaria que eu verificasse/,
        /quer que eu continue/,
        /posso continuar buscando/,
        /se precisar.*mais contexto/,
        /se você puder fornecer/,
        /preciso de mais contexto/,
        /não registrado.*mensagens/,
        /parece que não encontrei/
    ];

    // Check if response contains patterns suggesting need for more context
    const hasNeedsMorePattern = needsMoreContextPatterns.some(pattern => 
        pattern.test(responseLower)
    );

    // Check if question is about specific dates/times and ChatGPT says it didn't find info
    const questionAboutSpecificDate = /\b(dia|data|ontem|semana|mês|ano|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro|\d{1,2})\b/.test(questionLower);
    const responseIndicatesNotFound = /não.*encontr|não.*consegui|não.*há|não.*localizei/.test(responseLower);

    // Check if question is about "primeira", "segunda", "última" etc.
    const questionAboutOrderedMessages = /\b(primeira?|segunda?|terceira?|última?|primeiro?|segundo?|terceiro?|último?)\s+(mensagem|msg)\b/.test(questionLower);
    
    // Check if question asks for summaries or analysis
    const questionAboutSummary = /\b(resumo|resumir|analis|quantas?|conte|lista)\b/.test(questionLower);

    const shouldRequest = hasNeedsMorePattern || 
                         (questionAboutSpecificDate && responseIndicatesNotFound) ||
                         (questionAboutOrderedMessages && responseIndicatesNotFound) ||
                         (questionAboutSummary && responseIndicatesNotFound);

    if (shouldRequest) {
        logger.debug('Auto context request triggered', {
            originalQuestion,
            hasNeedsMorePattern,
            questionAboutSpecificDate: questionAboutSpecificDate && responseIndicatesNotFound,
            questionAboutOrderedMessages: questionAboutOrderedMessages && responseIndicatesNotFound,
            questionAboutSummary: questionAboutSummary && responseIndicatesNotFound,
            contextRequestCount,
            maxRequests
        });
    }

    return shouldRequest;
}

module.exports = {
    parseContextRequest,
    isPureContextRequest,
    handleContextRequest,
    validateContextRequest,
    formatContextResponse,
    shouldAutoRequestContext
}; 