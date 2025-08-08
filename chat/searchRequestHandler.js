const logger = require('../utils/logger');
const { searchWithContent } = require('./legacy_webSearchUtils');
const { runResponsesWithWebSearch } = require('../utils/openaiUtils');

/**
 * Parse search request from ChatGPT response
 * @param {string} response - ChatGPT response
 * @returns {Object|null} Search request object or null if no request found
 */
function parseSearchRequest(response) {
    if (!response || typeof response !== 'string') {
        return null;
    }

    // Look for the exact pattern: REQUEST_SEARCH: [query]
    const searchRequestPattern = /REQUEST_SEARCH:\s*(.+?)(?:\n|$)/i;
    const match = response.match(searchRequestPattern);

    if (match) {
        const requestedQuery = match[1].trim();
        
        // Validate the query
        if (!requestedQuery || requestedQuery.length < 2) {
            logger.warn('Invalid search request query:', requestedQuery);
            return null;
        }

        // Clean up the query (remove quotes if present)
        const cleanQuery = requestedQuery.replace(/^["']|["']$/g, '').trim();
        
        logger.debug('Search request parsed', {
            originalQuery: requestedQuery,
            cleanQuery: cleanQuery,
            queryLength: cleanQuery.length
        });

        return {
            originalQuery: requestedQuery,
            cleanQuery: cleanQuery,
            isValid: cleanQuery.length >= 2
        };
    }

    return null;
}

/**
 * Check if response is purely a search request (no other content)
 * @param {string} response - ChatGPT response
 * @returns {boolean} True if response contains only search request
 */
function isPureSearchRequest(response) {
    if (!response || typeof response !== 'string') {
        return false;
    }

    // Remove the search request pattern and check if anything meaningful remains
    const searchRequestPattern = /REQUEST_SEARCH:\s*.+?(?:\n|$)/gi;
    const withoutSearchRequest = response.replace(searchRequestPattern, '').trim();
    
    // Consider it pure if only whitespace, punctuation, or very short content remains
    const meaningfulContent = withoutSearchRequest.replace(/[.,!?;:\s\-\n\r]/g, '');
    
    return meaningfulContent.length <= 5; // Allow for small words like "ok", "sim", etc.
}

/**
 * Handle search request from ChatGPT
 * @param {string} response - ChatGPT response containing search request
 * @param {Object} config - Configuration object
 * @returns {Promise<Object>} Search handling result
 */
async function handleSearchRequest(response, config) {
    try {
        const searchRequest = parseSearchRequest(response);
        
        if (!searchRequest) {
            return {
                hasSearchRequest: false,
                searchResults: null,
                query: null,
                error: null
            };
        }

        if (!searchRequest.isValid) {
            return {
                hasSearchRequest: true,
                searchResults: null,
                query: searchRequest.cleanQuery,
                error: 'Invalid search query: too short or empty'
            };
        }

        logger.debug('Handling search request', {
            query: searchRequest.cleanQuery,
            originalQuery: searchRequest.originalQuery
        });

        // Get web search configuration
        const webSearchConfig = config?.COMMANDS?.CHAT?.webSearch || {};
        
        // Check if web search is enabled
        if (webSearchConfig.enabled === false) {
            logger.warn('Web search is disabled in configuration');
            return {
                hasSearchRequest: true,
                searchResults: null,
                query: searchRequest.cleanQuery,
                error: 'Web search is disabled in configuration'
            };
        }

        const useOpenAITool = config?.SYSTEM?.WEB_SEARCH?.USE_OPENAI_TOOL === true;
        let searchResults = null;
        let usedOpenAITool = false;

        if (useOpenAITool) {
            // Use Responses API with web_search tool to directly answer with citations
            usedOpenAITool = true;
            try {
                const assistantMsg = await runResponsesWithWebSearch([
                    { role: 'user', content: `REQUEST_SEARCH: ${searchRequest.cleanQuery}` }
                ], {
                    temperature: 1,
                    model: config?.SYSTEM?.AI_MODELS?.MEDIUM,
                });
                // Return a pseudo search result carrying the assistant content; conversation loop will add it
                searchResults = {
                    results: [],
                    summary: assistantMsg.content || '',
                    searchPerformed: true,
                };
            } catch (e) {
                usedOpenAITool = false;
                const allowFallback = config?.SYSTEM?.WEB_SEARCH?.FALLBACK_TO_LEGACY !== false;
                if (!allowFallback) {
                    return {
                        hasSearchRequest: true,
                        searchResults: null,
                        query: searchRequest.cleanQuery,
                        error: e?.message || 'OpenAI web_search tool failed',
                        isPureRequest: isPureSearchRequest(response)
                    };
                }
            }
        }

        if (!usedOpenAITool) {
            const allowFallback = config?.SYSTEM?.WEB_SEARCH?.FALLBACK_TO_LEGACY !== false;
            if (!allowFallback) {
                return {
                    hasSearchRequest: true,
                    searchResults: null,
                    query: searchRequest.cleanQuery,
                    error: 'OpenAI web_search tool failed and legacy fallback is disabled',
                    isPureRequest: isPureSearchRequest(response)
                };
            }
            const maxResults = webSearchConfig.maxResults || 3;
            // Perform the legacy search
            searchResults = await searchWithContent(
                searchRequest.cleanQuery,
                maxResults,
                true, // Include content
                config
            );
        }

        const result = {
            hasSearchRequest: true,
            searchResults: searchResults,
            query: searchRequest.cleanQuery,
            originalQuery: searchRequest.originalQuery,
            error: null,
            isPureRequest: isPureSearchRequest(response)
        };

        if (!searchResults || !searchResults.results || searchResults.results.length === 0) {
            logger.warn(`No search results found for query: "${searchRequest.cleanQuery}"`);
            result.error = 'No search results found';
        } else {
            logger.debug(`Search completed successfully`, {
                query: searchRequest.cleanQuery,
                resultsCount: searchResults.results.length,
                searchPerformed: searchResults.searchPerformed
            });
        }

        return result;

    } catch (error) {
        logger.error('Error handling search request:', error);
        return {
            hasSearchRequest: true,
            searchResults: null,
            query: null,
            error: error.message,
            isPureRequest: isPureSearchRequest(response)
        };
    }
}

/**
 * Validate search request against limits
 * @param {number} currentSearchRequests - Current number of search requests in conversation
 * @param {Object} config - Configuration object
 * @returns {Object} Validation result
 */
function validateSearchRequest(currentSearchRequests, config) {
    // Use context management limits as a reference, but could have separate limits
    const maxRequests = config?.COMMANDS?.CHAT?.webSearch?.maxSearchRequests || 
                       config?.COMMANDS?.CHAT?.contextManagement?.maxContextRequests || 5;
    
    const searchEnabled = config?.COMMANDS?.CHAT?.webSearch?.enabled !== false;

    if (!searchEnabled) {
        return {
            isValid: false,
            reason: 'Web search is disabled'
        };
    }

    if (currentSearchRequests >= maxRequests) {
        return {
            isValid: false,
            reason: `Maximum search requests reached (${maxRequests})`
        };
    }

    return {
        isValid: true,
        reason: null
    };
}

/**
 * Format search response message for user feedback
 * @param {Object} searchResult - Result from handleSearchRequest
 * @returns {string|null} Formatted message for user or null if no feedback needed
 */
function formatSearchResponse(searchResult) {
    if (!searchResult.hasSearchRequest) {
        return null;
    }

    if (searchResult.error) {
        return `⚠️ Erro na pesquisa: ${searchResult.error}`;
    }

    if (!searchResult.searchResults || !searchResult.searchResults.results || 
        searchResult.searchResults.results.length === 0) {
        return ` Nenhum resultado encontrado para: "${searchResult.query}"`;
    }

    const resultsCount = searchResult.searchResults.results.length;
    return `🌐 Pesquisa realizada: ${resultsCount} resultado(s) encontrado(s) para "${searchResult.query}". Processando...`;
}

module.exports = {
    parseSearchRequest,
    isPureSearchRequest,
    handleSearchRequest,
    validateSearchRequest,
    formatSearchResponse
}; 