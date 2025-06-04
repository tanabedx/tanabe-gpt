const axios = require('axios');
const cheerio = require('cheerio');
const https = require('https');
const logger = require('../utils/logger');

/**
 * Clean search query by removing timestamp and user name patterns
 * @param {string} query - Raw search query
 * @returns {string} Cleaned search query
 */
function cleanSearchQuery(query) {
    if (!query || typeof query !== 'string') {
        return '';
    }

    let cleanQuery = query.trim();

    // Remove timestamp patterns like [DD/MM/AA, HH:MM]
    cleanQuery = cleanQuery.replace(/\[\d{1,2}\/\d{1,2}\/\d{2,4},?\s*\d{1,2}:\d{2}\]/g, '');
    
    // Remove user name patterns like "Nome pergunta:" or "Nome:"
    cleanQuery = cleanQuery.replace(/^[A-Za-zÀ-ÿ\s]+\s+(pergunta|question)?:\s*/i, '');
    
    // Remove common WhatsApp message prefixes
    cleanQuery = cleanQuery.replace(/^(>>|<<)\s*[A-Za-zÀ-ÿ\s]+:\s*/i, '');
    
    // Remove extra whitespace and normalize
    cleanQuery = cleanQuery.replace(/\s+/g, ' ').trim();
    
    // Remove REQUEST_SEARCH: prefix if present (shouldn't happen but safety measure)
    cleanQuery = cleanQuery.replace(/^REQUEST_SEARCH:\s*/i, '');
    
    logger.debug(`Cleaned search query: "${query}" → "${cleanQuery}"`);
    return cleanQuery;
}

/**
 * Check if a URL is an ad or unwanted result
 * @param {string} url - URL to check
 * @returns {boolean} True if URL should be filtered out
 */
function isUnwantedUrl(url) {
    if (!url || typeof url !== 'string') {
        return true;
    }

    const unwantedPatterns = [
        // DuckDuckGo ads and tracking (enhanced patterns)
        'duckduckgo.com/y.js',
        'duckduckgo.com/l/',
        '/y.js?ad_domain=',
        'ad_provider=',
        'ad_type=',
        'click_metadata=',
        // Amazon ads
        'amazon.com/s/',
        'amazon.com.br/s/',
        'amazon-adsystem.com',
        // Generic ad domains and tracking
        'googleadservices.com',
        'doubleclick.net',
        'googlesyndication.com',
        // Bing ads
        'bing.com/aclick',
        'msn.com/aclick',
        // Generic ad patterns
        '/aclick',
        'ad_domain=',
        'ad_provider=',
        'ad_type=',
        'click_metadata=',
        // URL shorteners that might be ads
        'bit.ly/',
        'tinyurl.com/',
        't.co/',
        // Additional tracking and redirect patterns
        '&rut=',
        '&u3=',
        'rlid=',
        'vqd=',
        'iurl='
    ];

    return unwantedPatterns.some(pattern => url.includes(pattern));
}

/**
 * Perform a web search using DuckDuckGo with improved error handling and Brazil region bias
 * @param {string} query - Search query
 * @param {number} limit - Maximum number of results (default: 5)
 * @param {number} timeout - Request timeout in ms (default: 10000)
 * @returns {Promise<Array>} Array of search results
 */
async function performWebSearch(query, limit = 5, timeout = 10000) {
    try {
        // Clean the query first
        const cleanQuery = cleanSearchQuery(query);
        if (!cleanQuery) {
            logger.warn('Empty search query after cleaning');
            return [];
        }

        logger.debug(`Performing Brazil-biased web search for: "${cleanQuery}"`);
        
        // Use DuckDuckGo HTML search with Brazil region bias and strict ad blocking
        const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(cleanQuery)}&kl=br-pt&k1=-1`;
        
        const response = await axios.get(searchUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
                'Accept-Encoding': 'gzip, deflate, br',
                'Connection': 'keep-alive',
                'Upgrade-Insecure-Requests': '1',
            },
            timeout: timeout,
            maxRedirects: 3,
            validateStatus: function (status) {
                return status >= 200 && status < 400;
            }
        });

        const $ = cheerio.load(response.data);
        const results = [];

        // Parse DuckDuckGo results with improved filtering
        $('.result').each((index, element) => {
            if (results.length >= limit) return false; // Break when we have enough good results
            
            const titleElement = $(element).find('.result__title a');
            const snippetElement = $(element).find('.result__snippet');
            const urlElement = $(element).find('.result__url');
            
            const title = titleElement.text().trim();
            const snippet = snippetElement.text().trim();
            let url = titleElement.attr('href') || urlElement.text().trim();
            
            // Clean up URL - sometimes DuckDuckGo wraps URLs
            if (url && url.startsWith('/l/?uddg=')) {
                // Extract the actual URL from DuckDuckGo's redirect
                const urlParams = new URLSearchParams(url.split('?')[1]);
                const actualUrl = urlParams.get('uddg');
                if (actualUrl) {
                    url = decodeURIComponent(actualUrl);
                }
            }
            
            // Filter out ads and unwanted URLs
            if (title && url && !isUnwantedUrl(url)) {
                // Additional validation for legitimate results
                if (title.length > 5 && snippet.length > 10 && url.startsWith('http')) {
                    results.push({
                        title,
                        snippet,
                        url,
                        source: 'DuckDuckGo (BR)'
                    });
                    logger.debug(`Added result: ${title} - ${url}`);
                } else {
                    logger.debug(`Filtered low-quality result: ${title} - ${url}`);
                }
            } else {
                logger.debug(`Filtered unwanted URL: ${url}`);
            }
        });

        logger.debug(`Found ${results.length} filtered Brazil-biased search results for: "${cleanQuery}"`);
        return results;
        
    } catch (error) {
        const errorMessage = error.message || '';
        
        if (errorMessage.includes('timeout') || errorMessage.includes('ETIMEDOUT')) {
            logger.debug(`DuckDuckGo search timeout for query: "${query}", trying Google fallback`);
        } else if (errorMessage.includes('403') || errorMessage.includes('blocked')) {
            logger.debug(`DuckDuckGo blocked request for query: "${query}", trying Google fallback`);
        } else {
            logger.debug(`DuckDuckGo search error for query: "${query}": ${errorMessage}, trying Google fallback`);
        }
        
        // Fallback to Google search if DuckDuckGo fails
        try {
            return await performGoogleSearch(query, limit, timeout);
        } catch (fallbackError) {
            logger.warn(`Both DuckDuckGo and Google search failed for query: "${query}"`);
            return [];
        }
    }
}

/**
 * Fallback Google search with improved error handling and Brazil region bias
 * @param {string} query - Search query
 * @param {number} limit - Maximum number of results
 * @param {number} timeout - Request timeout in ms
 * @returns {Promise<Array>} Array of search results
 */
async function performGoogleSearch(query, limit = 5, timeout = 10000) {
    try {
        // Clean the query first
        const cleanQuery = cleanSearchQuery(query);
        if (!cleanQuery) {
            logger.warn('Empty search query after cleaning for Google fallback');
            return [];
        }

        logger.debug(`Performing Brazil-biased Google search fallback for: "${cleanQuery}"`);
        
        // Google search with Brazil region bias
        const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(cleanQuery)}&num=${limit * 2}&gl=br&hl=pt-BR&cr=countryBR`;
        
        const response = await axios.get(searchUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
                'Accept-Encoding': 'gzip, deflate',
                'Connection': 'keep-alive',
                'Upgrade-Insecure-Requests': '1',
            },
            timeout: timeout,
            maxRedirects: 3,
            validateStatus: function (status) {
                return status >= 200 && status < 400;
            }
        });

        const $ = cheerio.load(response.data);
        const results = [];

        // Parse Google results with improved filtering
        $('div.g').each((index, element) => {
            if (results.length >= limit) return false; // Break when we have enough good results
            
            const titleElement = $(element).find('h3');
            const snippetElement = $(element).find('.VwiC3b, .s3v9rd, .st');
            const urlElement = $(element).find('a').first();
            
            const title = titleElement.text().trim();
            const snippet = snippetElement.text().trim();
            let url = urlElement.attr('href');
            
            // Clean up Google URLs that might have tracking
            if (url && url.startsWith('/url?q=')) {
                const urlParams = new URLSearchParams(url.substring(6));
                const actualUrl = urlParams.get('q');
                if (actualUrl) {
                    url = actualUrl;
                }
            }
            
            // Filter out ads and unwanted URLs, and validate quality
            if (title && url && !url.startsWith('/search') && !isUnwantedUrl(url)) {
                if (title.length > 5 && snippet.length > 10 && url.startsWith('http')) {
                    results.push({
                        title,
                        snippet,
                        url,
                        source: 'Google (BR)'
                    });
                    logger.debug(`Added Google result: ${title} - ${url}`);
                } else {
                    logger.debug(`Filtered low-quality Google result: ${title} - ${url}`);
                }
            } else {
                logger.debug(`Filtered unwanted Google URL: ${url}`);
            }
        });

        logger.debug(`Found ${results.length} filtered Brazil-biased Google search results for: "${cleanQuery}"`);
        return results;
        
    } catch (error) {
        const errorMessage = error.message || '';
        
        if (errorMessage.includes('timeout') || errorMessage.includes('ETIMEDOUT')) {
            logger.debug(`Google search timeout for query: "${query}"`);
        } else if (errorMessage.includes('403') || errorMessage.includes('blocked')) {
            logger.debug(`Google blocked request for query: "${query}"`);
        } else {
            logger.debug(`Google search error for query: "${query}": ${errorMessage}`);
        }
        
        return [];
    }
}

/**
 * Get content from a web page with improved error handling and configurable limits
 * @param {string} url - URL to scrape
 * @param {number} maxLength - Maximum content length (default: 2000)
 * @param {number} timeout - Request timeout in ms (default: 15000)
 * @param {Object} config - Configuration object with content extraction settings
 * @returns {Promise<string>} Page content
 */
async function getPageContent(url, maxLength = 2000, timeout = 15000, config = null) {
    try {
        // Get content extraction settings from config
        const webSearchConfig = config?.COMMANDS?.CHAT_GPT?.webSearch?.contentExtraction || {};
        const configMaxLength = webSearchConfig.maxLength || maxLength;
        const fallbackOnError = webSearchConfig.fallbackOnError !== false; // Default true
        const minLength = webSearchConfig.minLength || 50;
        
        logger.debug(`Fetching content from: ${url}`);
        
        const response = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
                'Accept-Encoding': 'gzip, deflate',
                'Connection': 'keep-alive',
                'Upgrade-Insecure-Requests': '1',
            },
            timeout: timeout,
            maxContentLength: 5 * 1024 * 1024, // Allow up to 5MB download to get complete HTML structure
            maxRedirects: 3,
            validateStatus: function (status) {
                return status >= 200 && status < 400;
            },
            // Handle SSL certificate issues gracefully
            httpsAgent: https.Agent({
                rejectUnauthorized: false
            })
        });

        const $ = cheerio.load(response.data);
        
        // Remove unwanted elements
        $('script, style, nav, footer, header, .advertisement, .ads, .social-share').remove();
        
        // Extract main content
        let content = '';
        
        // Try common content selectors
        const contentSelectors = [
            'article',
            '[role="main"]',
            '.main-content',
            '.content',
            '.post-content',
            '.entry-content',
            'main',
            '.article-body',
            '.story-body'
        ];
        
        for (const selector of contentSelectors) {
            const element = $(selector).first();
            if (element.length && element.text().trim().length > 100) {
                content = element.text().trim();
                break;
            }
        }
        
        // Fallback to body if no main content found
        if (!content) {
            content = $('body').text().trim();
        }
        
        // Clean content
        content = content
            .replace(/\s+/g, ' ')
            .replace(/\n\s*\n/g, '\n')
            .trim();
            
        // Truncate to configured length AFTER extraction
        if (content.length > configMaxLength) {
            content = content.substring(0, configMaxLength) + '...';
            logger.debug(`Truncated extracted content from ${url} to ${configMaxLength} characters`);
        }
        
        // Validate minimum content length
        if (content.length >= minLength) {
            logger.debug(`Extracted ${content.length} characters from: ${url}`);
            return content;
        } else {
            logger.debug(`Content too short (${content.length} chars) from: ${url}`);
            return '';
        }
        
    } catch (error) {
        // Handle specific error types gracefully
        const errorMessage = error.message || '';
        
        if (errorMessage.includes('certificate') || errorMessage.includes('SSL') || errorMessage.includes('TLS')) {
            logger.debug(`SSL/Certificate issue for ${url}, skipping content extraction`);
        } else if (errorMessage.includes('maxContentLength') || errorMessage.includes('size') || errorMessage.includes('exceeded')) {
            // For size errors, try to extract what we can if fallback is enabled
            const webSearchConfig = config?.COMMANDS?.CHAT_GPT?.webSearch?.contentExtraction || {};
            const fallbackOnError = webSearchConfig.fallbackOnError !== false;
            
            if (fallbackOnError) {
                logger.debug(`Content size exceeded for ${url}, attempting partial extraction`);
                // Retry with smaller limits for partial extraction
                try {
                    const partialResponse = await axios.get(url, {
                        headers: {
                            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                        },
                        timeout: timeout / 2, // Shorter timeout for partial
                        maxContentLength: 1 * 1024 * 1024, // Smaller 1MB limit for retry
                        maxRedirects: 2,
                        httpsAgent: https.Agent({
                            rejectUnauthorized: false
                        })
                    });
                    
                    // Extract and truncate the content properly
                    const $ = cheerio.load(partialResponse.data);
                    $('script, style, nav, footer, header, .advertisement, .ads, .social-share').remove();
                    
                    let text = $('body').text().replace(/\s+/g, ' ').trim();
                    const maxLength = webSearchConfig.maxLength || 2000;
                    
                    if (text.length > maxLength) {
                        text = text.substring(0, maxLength) + '...';
                    }
                    
                    if (text.length >= (webSearchConfig.minLength || 50)) {
                        logger.debug(`Partial extraction successful for ${url}: ${text.length} characters`);
                        return text;
                    }
                } catch (retryError) {
                    logger.debug(`Partial extraction also failed for ${url}`);
                }
            } else {
                logger.debug(`Content too large for ${url}, fallback disabled`);
            }
        } else if (errorMessage.includes('403') || errorMessage.includes('Forbidden')) {
            logger.debug(`Access forbidden for ${url}, skipping content extraction`);
        } else if (errorMessage.includes('404') || errorMessage.includes('Not Found')) {
            logger.debug(`Page not found for ${url}, skipping content extraction`);
        } else if (errorMessage.includes('timeout') || errorMessage.includes('ETIMEDOUT')) {
            logger.debug(`Timeout accessing ${url}, skipping content extraction`);
        } else if (errorMessage.includes('ECONNREFUSED') || errorMessage.includes('ENOTFOUND')) {
            logger.debug(`Connection issue for ${url}, skipping content extraction`);
        } else {
            // Only log unexpected errors as warnings
            logger.warn(`Unexpected error fetching content from ${url}: ${errorMessage}`);
        }
        
        return ''; // Return empty string instead of throwing
    }
}

/**
 * Perform web search and get detailed content from top results with improved error handling
 * @param {string} query - Search query
 * @param {number} numResults - Number of search results to get (default: 3)
 * @param {boolean} includeContent - Whether to fetch full content from pages (default: true)
 * @param {Object} config - Configuration object with web search settings
 * @returns {Promise<Object>} Search results with content
 */
async function searchWithContent(query, numResults = 3, includeContent = true, config = null) {
    try {
        // Use config settings if available
        const webSearchConfig = config?.COMMANDS?.CHAT_GPT?.webSearch || {};
        const contentConfig = webSearchConfig.contentExtraction || {};
        const maxResults = webSearchConfig.maxResults || numResults;
        const timeout = webSearchConfig.timeout || 10000;
        const minContentLength = contentConfig.minLength || 50;
        const actualNumResults = Math.min(numResults, maxResults);
        
        // Get extra search results to account for failed content fetches
        const searchResultsToFetch = Math.min(actualNumResults * 2, 10); // Get 2x the needed results, max 10
        const searchResults = await performWebSearch(query, searchResultsToFetch, timeout);
        
        if (!searchResults || searchResults.length === 0) {
            return {
                query,
                results: [],
                summary: 'No search results found for this query.'
            };
        }

        const resultsWithContent = [];
        let processedCount = 0;
        
        // Process results and try to get the target number with content
        for (const result of searchResults) {
            if (resultsWithContent.length >= actualNumResults) {
                break; // We have enough results
            }
            
            const resultData = {
                title: result.title,
                url: result.url,
                snippet: result.snippet,
                source: result.source
            };
            
            if (includeContent) {
                const content = await getPageContent(result.url, 2000, timeout, config);
                if (content && content.length >= minContentLength) { // Use config min length
                    resultData.content = content;
                    logger.debug(`Successfully extracted content from: ${result.url}`);
                } else {
                    logger.debug(`No usable content extracted from: ${result.url}, using snippet only`);
                }
            }
            
            // Include the result even if content extraction failed (we still have title, snippet, url)
            resultsWithContent.push(resultData);
            processedCount++;
        }

        // If we still don't have enough results, log it but continue with what we have
        if (resultsWithContent.length < actualNumResults) {
            logger.debug(`Retrieved ${resultsWithContent.length} results instead of requested ${actualNumResults} for query: "${query}"`);
        }

        // Create a summary of findings
        const summary = createSearchSummary(query, resultsWithContent, config);
        
        return {
            query,
            results: resultsWithContent,
            summary,
            searchPerformed: true,
            timestamp: new Date().toISOString(),
            requestedResults: actualNumResults,
            actualResults: resultsWithContent.length
        };
        
    } catch (error) {
        logger.warn(`Search error for query "${query}": ${error.message}`);
        return {
            query,
            results: [],
            summary: `Error performing search: ${error.message}`,
            searchPerformed: false,
            requestedResults: numResults,
            actualResults: 0
        };
    }
}

/**
 * Create a summary of search results with improved handling of missing content
 * @param {string} query - Original search query
 * @param {Array} results - Search results with content
 * @param {Object} config - Configuration object
 * @returns {string} Summary text
 */
function createSearchSummary(query, results, config = null) {
    if (!results || results.length === 0) {
        return `Não foram encontrados resultados para "${query}".`;
    }

    const contentConfig = config?.COMMANDS?.CHAT_GPT?.webSearch?.contentExtraction || {};
    const minContentLength = contentConfig.minLength || 50;

    let summary = `Pesquisa na internet sobre "${query}":\n\n`;
    let resultsWithContent = 0;
    
    results.forEach((result, index) => {
        summary += `${index + 1}. **${result.title}**\n`;
        summary += `   ${result.snippet}\n`;
        summary += `   Fonte: ${result.url}\n`;
        
        if (result.content && result.content.length >= minContentLength) {
            // Include the full extracted content instead of just snippet
            summary += `   Conteúdo completo: ${result.content}\n`;
            resultsWithContent++;
        } else {
            // If no content was extracted, rely on snippet
            summary += `   Resumo: ${result.snippet}\n`;
        }
        
        summary += '\n';
    });
    
    // Add a note about content extraction success rate if some failed
    if (resultsWithContent < results.length && results.length > 1) {
        const failedCount = results.length - resultsWithContent;
        summary += `\nNota: Conteúdo completo foi extraído de ${resultsWithContent} de ${results.length} fontes. ${failedCount} fonte(s) tiveram acesso limitado mas seus resumos estão incluídos.\n`;
    }
    
    return summary;
}

/**
 * Check if a query requires web search
 * @param {string} text - Text to analyze
 * @param {Object} config - Configuration object with web search settings
 * @returns {boolean} True if web search is needed
 */
function shouldPerformWebSearch(text, config = null) {
    if (!text || typeof text !== 'string') {
        return false;
    }

    // Check if web search is enabled in config
    const webSearchConfig = config?.COMMANDS?.CHAT_GPT?.webSearch;
    if (webSearchConfig && webSearchConfig.enabled === false) {
        return false;
    }

    const lowerText = text.toLowerCase();
    
    // Use keywords from config if available, otherwise use defaults
    let searchKeywords = [];
    if (webSearchConfig && webSearchConfig.activationKeywords) {
        searchKeywords = webSearchConfig.activationKeywords;
    } else {
        // Default keywords if config not available
        searchKeywords = [
            'pesquise',
            'pesquisar',
            'busque',
            'buscar',
            'procure',
            'procurar',
            'search',
            'find',
            'lookup',
            'google',
            'bing',
            'internet',
            'web',
            'site',
            'website',
            'online',
            'informações atuais',
            'informações recentes',
            'últimas notícias',
            'recent information',
            'current information',
            'latest news'
        ];
    }

    // Phrases that indicate web search request (keeping these as fallback)
    const searchPhrases = [
        'na internet',
        'no google',
        'online sobre',
        'informações sobre',
        'o que você encontra sobre',
        'me diga sobre',
        'pesquise sobre',
        'busque informações',
        'on the internet',
        'on google',
        'search for',
        'look up'
    ];

    // Check for search keywords
    const hasSearchKeyword = searchKeywords.some(keyword => 
        lowerText.includes(keyword.toLowerCase())
    );

    // Check for search phrases
    const hasSearchPhrase = searchPhrases.some(phrase => 
        lowerText.includes(phrase)
    );

    return hasSearchKeyword || hasSearchPhrase;
}

/**
 * Extract search query from text with improved cleaning
 * @param {string} text - Input text
 * @returns {string} Extracted search query
 */
function extractSearchQuery(text) {
    if (!text || typeof text !== 'string') {
        return '';
    }

    let query = text.trim();

    // Remove common prefixes
    const prefixesToRemove = [
        'pesquise',
        'pesquisar',
        'busque',
        'buscar',
        'procure',
        'procurar',
        'search',
        'find',
        'lookup',
        'google',
        '#'
    ];

    const phrasesToRemove = [
        'na internet sobre',
        'no google sobre',
        'online sobre',
        'informações sobre',
        'me diga sobre',
        'pesquise sobre',
        'busque informações sobre',
        'on the internet about',
        'on google about',
        'search for',
        'look up'
    ];

    // Remove phrases first
    for (const phrase of phrasesToRemove) {
        const regex = new RegExp(phrase, 'gi');
        query = query.replace(regex, '').trim();
    }

    // Remove individual prefixes
    for (const prefix of prefixesToRemove) {
        const regex = new RegExp(`^${prefix}\\s+`, 'gi');
        query = query.replace(regex, '').trim();
    }

    // Clean up the query
    query = query
        .replace(/^(sobre|about)\s+/gi, '')
        .replace(/\s+/g, ' ')
        .trim();

    // Apply the same cleaning logic used in search functions
    const finalQuery = cleanSearchQuery(query || text.trim());
    
    return finalQuery;
}

module.exports = {
    performWebSearch,
    performGoogleSearch,
    getPageContent,
    searchWithContent,
    createSearchSummary,
    shouldPerformWebSearch,
    extractSearchQuery,
    cleanSearchQuery,
    
    // Compatibility functions for existing system
    modelSupportsWebSearch: () => true, // We now support web search
    getWebSearchTools: () => [], // Not using OpenAI tools, using custom implementation
    responseUsedWebSearch: () => false, // Not applicable for our implementation
    extractWebSearchQueries: () => [], // Not applicable for our implementation
    processToolCalls: (toolCalls, messages) => messages // Not applicable for our implementation
}; 