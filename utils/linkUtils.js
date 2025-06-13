const axios = require('axios');
const logger = require('./logger');
const config = require('../configs');

function extractLinks(text) {
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    return text.match(urlRegex) || [];
}

/**
 * Extract the actual URL from Google redirect links
 * @param {string} url - The Google redirect URL
 * @returns {string} The actual target URL or original URL if not a Google redirect
 */
function extractGoogleRedirectUrl(url) {
    try {
        // Handle Google AMP redirects like the one in the example
        if (url.includes('google.com/amp/s/')) {
            const match = url.match(/google\.com\/amp\/s\/(.+)/);
            if (match) {
                let targetUrl = match[1];
                // Remove .amp.htm extension if present and replace with .htm
                targetUrl = targetUrl.replace(/\.amp\.htm$/, '.htm');
                return 'https://' + targetUrl;
            }
        }
        
        // Handle other Google redirect patterns
        if (url.includes('google.com') && url.includes('/url?')) {
            const urlParams = new URL(url);
            const targetUrl = urlParams.searchParams.get('url') || urlParams.searchParams.get('q');
            if (targetUrl) {
                return decodeURIComponent(targetUrl);
            }
        }
        
        return url;
    } catch (error) {
        logger.debug('Error parsing Google redirect URL:', error);
        return url;
    }
}

async function unshortenLink(url) {
    try {
        // First, try to extract direct URL from Google redirects
        const directUrl = extractGoogleRedirectUrl(url);
        if (directUrl !== url) {
            logger.debug('Extracted direct URL from Google redirect:', {
                original: url,
                extracted: directUrl
            });
            return directUrl;
        }

        logger.debug('Attempting to unshorten link:', url);
        
        // Try HEAD request first (faster)
        try {
            const headResponse = await axios.head(url, {
                maxRedirects: 10,
                timeout: config.RESUMO?.linkSettings?.timeout || 10000,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                    'Accept-Language': 'en-US,en;q=0.5',
                    'Accept-Encoding': 'gzip, deflate',
                    'Connection': 'keep-alive',
                    'Upgrade-Insecure-Requests': '1',
                }
            });
            
            const finalUrl = headResponse.request.res?.responseUrl || headResponse.config.url || url;
            logger.debug('HEAD request successful, final URL:', finalUrl);
            return finalUrl;
        } catch (headError) {
            // If HEAD fails, try GET request (some servers don't allow HEAD)
            logger.debug('HEAD request failed, trying GET request:', headError.message);
            
            try {
                const getResponse = await axios.get(url, {
                    maxRedirects: 10,
                    timeout: config.RESUMO?.linkSettings?.timeout || 10000,
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                        'Accept-Language': 'en-US,en;q=0.5',
                        'Accept-Encoding': 'gzip, deflate',
                        'Connection': 'keep-alive',
                        'Upgrade-Insecure-Requests': '1',
                    },
                    // Only get headers and partial content to check for redirects
                    responseType: 'stream',
                    maxContentLength: 1024 // Limit to first 1KB
                });
                
                // Destroy the stream to prevent downloading full content
                getResponse.data.destroy();
                
                const finalUrl = getResponse.request.res?.responseUrl || getResponse.config.url || url;
                logger.debug('GET request successful, final URL:', finalUrl);
                return finalUrl;
            } catch (getError) {
                logger.debug('GET request also failed:', getError.message);
                throw getError;
            }
        }
    } catch (error) {
        logger.error('Error unshortening link:', {
            url,
            error: error.message,
            code: error.code,
            status: error.response?.status
        });
        return url; // Return original URL if unshortening fails
    }
}

async function getPageContent(url, attempt = 1) {
    const settings = config.RESUMO?.linkSettings || { 
        maxCharacters: 5000, 
        timeout: 15000, 
        retryAttempts: 2, 
        retryDelay: 1000 
    };
    
    try {
        logger.debug('Fetching page content:', { url, attempt, settings });

        const response = await axios.get(url, {
            timeout: settings.timeout,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
                'Accept-Encoding': 'gzip, deflate',
                'Connection': 'keep-alive',
                'Upgrade-Insecure-Requests': '1',
                'Cache-Control': 'no-cache',
                'Pragma': 'no-cache'
            },
            maxRedirects: 10,
            validateStatus: function (status) {
                return status < 500; // Accept any status code less than 500
            }
        });

        if (response.status === 429) {
            const delay = settings.retryDelay * attempt; // Exponential backoff
            logger.warn(`Rate limited (attempt ${attempt}), waiting ${delay}ms before retry`);
            
            if (attempt <= settings.retryAttempts) {
                await new Promise(resolve => setTimeout(resolve, delay));
                return getPageContent(url, attempt + 1);
            } else {
                throw new Error('Rate limited - max retries exceeded');
            }
        }

        if (response.status >= 400) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        logger.debug('Successfully fetched page content:', {
            status: response.status,
            contentLength: response.data.length,
            contentType: response.headers['content-type'],
            attempt
        });

        // Extract text content from HTML
        let content = response.data
            .toString()
            .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
            .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();

        // Limit content length
        if (content.length > settings.maxCharacters) {
            logger.debug(
                `Trimming content from ${content.length} to ${settings.maxCharacters} characters`
            );
            content = content.substring(0, settings.maxCharacters);
        }

        return content;
    } catch (error) {
        const isRetryableError = (
            error.code === 'ECONNRESET' || 
            error.code === 'ETIMEDOUT' || 
            error.code === 'ENOTFOUND' ||
            (error.response && [429, 502, 503, 504].includes(error.response.status))
        );

        if (isRetryableError && attempt <= settings.retryAttempts) {
            const delay = settings.retryDelay * attempt;
            logger.warn(`Retryable error on attempt ${attempt}, retrying in ${delay}ms:`, {
                url,
                error: error.message,
                code: error.code,
                status: error.response?.status
            });
            
            await new Promise(resolve => setTimeout(resolve, delay));
            return getPageContent(url, attempt + 1);
        }

        logger.error('Error fetching page content:', {
            url,
            error: error.message,
            code: error.code,
            status: error.response?.status,
            attempt,
            maxAttempts: settings.retryAttempts
        });
        throw error;
    }
}

module.exports = {
    extractLinks,
    unshortenLink,
    getPageContent,
    extractGoogleRedirectUrl, // Export for testing
};
