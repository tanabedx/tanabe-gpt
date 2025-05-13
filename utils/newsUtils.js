const axios = require('axios');
const cheerio = require('cheerio');
const { runCompletion } = require('./openaiUtils');
const logger = require('./logger');
const config = require('../configs');

// Get the whitelist paths
const WHITELIST_PATHS = config.NEWS_MONITOR?.CONTENT_FILTERING?.WHITELIST_PATHS || [];

// Twitter API usage cache
let twitterApiUsageCache = {
    primary: null,
    fallback: null,
    fallback2: null,
    currentKey: 'primary',
    lastCheck: null,
    // Track rate limit reset times
    resetTimes: {
        primary: null,
        fallback: null,
        fallback2: null,
    },
};

// Twitter last fetched tweets cache
let lastFetchedTweetsCache = {
    tweets: {}, // Format: { username: [tweets] }
    lastUpdated: null,
};

/**
 * Check if an article URL is for local news based on the URL pattern
 * @param {string} url - The article URL to check
 * @returns {boolean} - True if it's a local news article that should be excluded
 */
function isLocalNews(url) {
    try {
        // Skip if URL is missing
        if (!url) return false;

        // Parse the URL to extract path segments
        let urlObj;
        try {
            urlObj = new URL(url);
        } catch (e) {
            logger.error(`Invalid URL: ${e.message}`);
            return false;
        }

        // Only process G1 URLs
        if (!urlObj.hostname.includes('g1.globo.com')) return false;

        // Whitelist approach for G1 URLs
        const fullPath = urlObj.pathname;

        // Check if the path is in the whitelist
        const isWhitelisted = WHITELIST_PATHS.some(whitelistedPath =>
            fullPath.startsWith(whitelistedPath)
        );

        // If the path is in the whitelist, it's NOT local news (return false)
        // If the path is NOT in the whitelist, it IS local news (return true)
        return !isWhitelisted;
    } catch (error) {
        logger.error(`Error checking if URL is local news: ${error.message}`, error);
        return false;
    }
}

/**
 * Filter out local news articles from an array of articles
 * @param {Array} articles - Array of RSS articles
 * @returns {Array} - Articles excluding local news
 */
function filterOutLocalNews(articles) {
    if (!Array.isArray(articles)) return [];

    // Collect all filtered articles and paths for a consolidated log
    const filteredArticles = [];
    const localArticleData = [];
    const whitelistedArticleData = [];

    articles.forEach(article => {
        const url = article.link;
        if (!url) {
            filteredArticles.push(article);
            return;
        }

        try {
            const urlObj = new URL(url);
            const fullPath = urlObj.pathname;

            if (!urlObj.hostname.includes('g1.globo.com')) {
                // Non-G1 URLs are always included
                filteredArticles.push(article);
                return;
            }

            // Check whitelist for G1 URLs
            const isWhitelisted = WHITELIST_PATHS.some(whitelistedPath => {
                // Split the path into segments for more accurate matching
                const whitelistedSegments = whitelistedPath
                    .split('/')
                    .filter(segment => segment.length > 0);
                const fullPathSegments = fullPath.split('/').filter(segment => segment.length > 0);

                // If the whitelist path has more segments than the full path, it can't match
                if (whitelistedSegments.length > fullPathSegments.length) {
                    return false;
                }

                // Check if all segments in the whitelist path match the corresponding segments in the full path
                for (let i = 0; i < whitelistedSegments.length; i++) {
                    if (whitelistedSegments[i] !== fullPathSegments[i]) {
                        return false;
                    }
                }

                return true;
            });

            if (isWhitelisted) {
                // Include article and collect info for log
                filteredArticles.push(article);
                whitelistedArticleData.push({
                    title:
                        article.title?.substring(0, 80) + (article.title?.length > 80 ? '...' : ''),
                    path: fullPath,
                });
            } else {
                // Skip article and collect info for log
                // Extract first three path segments for logging
                const pathSegments = fullPath.split('/').filter(segment => segment.length > 0);
                const pathPreview =
                    pathSegments.length > 0
                        ? `/${pathSegments.slice(0, Math.min(3, pathSegments.length)).join('/')}`
                        : fullPath;

                localArticleData.push({
                    title:
                        article.title?.substring(0, 80) + (article.title?.length > 80 ? '...' : ''),
                    path: fullPath,
                    pathPreview: pathPreview,
                });
            }
        } catch (e) {
            // Keep articles with invalid URLs (will be filtered elsewhere)
            filteredArticles.push(article);
            logger.error(`Invalid URL in article: ${e.message}`);
        }
    });

    // Create consolidated logs for whitelist filtering
    if (localArticleData.length > 0) {
        const localArticlesLog = localArticleData
            .map(
                (item, idx) =>
                    `  ${idx + 1}. "${item.title}" - Path not in whitelist (${item.pathPreview})`
            )
            .join('\n');
        logger.debug(
            `Filtered out ${localArticleData.length} local news articles (paths not in whitelist):\n${localArticlesLog}`
        );
    }

    if (whitelistedArticleData.length > 0) {
        const whitelistedArticlesLog = whitelistedArticleData
            .map((item, idx) => `  ${idx + 1}. "${item.title}" - Path: ${item.path}`)
            .join('\n');
        logger.debug(
            `Included ${whitelistedArticleData.length} articles with paths in whitelist:\n${whitelistedArticlesLog}`
        );
    }

    logger.debug(
        `Whitelist filter summary: ${
            articles.length - filteredArticles.length
        } local news excluded out of ${articles.length} total`
    );
    return filteredArticles;
}

/**
 * Get Twitter API usage for a specific key
 * @param {Object} key - The Twitter API key object
 * @returns {Promise<Object>} - API usage data
 */
async function getTwitterKeyUsage(key) {
    try {
        const url = 'https://api.twitter.com/2/usage/tweets';
        const response = await axios.get(url, {
            headers: {
                Authorization: `Bearer ${key.bearer_token}`,
            },
            params: {
                'usage.fields': 'cap_reset_day,project_usage,project_cap',
            },
        });

        if (response.data && response.data.data) {
            const usage = response.data.data;

            // Debug log to show raw API response data
            logger.debug('Twitter API usage raw response:', {
                project_usage: usage.project_usage,
                project_cap: usage.project_cap,
                cap_reset_day: usage.cap_reset_day,
            });

            return {
                usage: usage.project_usage,
                limit: usage.project_cap,
                capResetDay: usage.cap_reset_day,
                status: 'ok',
            };
        }
        throw new Error('Invalid response format from Twitter API');
    } catch (error) {
        if (error.response && error.response.status === 429) {
            // Store rate limit reset time if available
            let resetTime = null;
            if (error.response.headers && error.response.headers['x-rate-limit-reset']) {
                resetTime = parseInt(error.response.headers['x-rate-limit-reset']) * 1000; // Convert to milliseconds
            }

            // Return a special indicator for rate limit errors
            return {
                usage: 100, // Consider it maxed out
                limit: 100,
                capResetDay: null, // Add capResetDay (null for rate-limited keys)
                status: '429',
                resetTime: resetTime,
            };
        }
        throw error;
    }
}

/**
 * Check Twitter API usage for all keys
 * @param {boolean} forceCheck - Whether to force a fresh check instead of using cache
 * @returns {Promise<Object>} - API usage data for all keys
 */
async function checkTwitterAPIUsage(forceCheck = false) {
    // If we have cached data and it's less than 15 minutes old, use it
    const now = Date.now();
    if (
        !forceCheck &&
        twitterApiUsageCache.lastCheck &&
        now - twitterApiUsageCache.lastCheck < 15 * 60 * 1000
    ) {
        return {
            primary: twitterApiUsageCache.primary,
            fallback: twitterApiUsageCache.fallback,
            fallback2: twitterApiUsageCache.fallback2,
            currentKey: twitterApiUsageCache.currentKey,
            resetTimes: twitterApiUsageCache.resetTimes,
        };
    }

    try {
        const { primary, fallback, fallback2 } = config.CREDENTIALS.TWITTER_API_KEYS;
        const isDebugMode = config.SYSTEM.CONSOLE_LOG_LEVELS.DEBUG === true;

        // Initialize with default values instead of null
        let primaryUsage = { usage: 0, limit: 100, status: 'pending' };
        let fallbackUsage = { usage: 0, limit: 100, status: 'pending' };
        let fallback2Usage = { usage: 0, limit: 100, status: 'pending' };
        let currentKey = 'primary'; // Default to primary

        // Check all keys, regardless of debug mode to ensure accurate data
        // Try primary key
        try {
            primaryUsage = await getTwitterKeyUsage(primary);

            // Store reset time if available
            if (primaryUsage.resetTime) {
                twitterApiUsageCache.resetTimes.primary = primaryUsage.resetTime;
            }

            if (primaryUsage.status !== '429' && primaryUsage.usage < 100) {
                currentKey = 'primary';
            }
        } catch (error) {
            logger.error('Error checking primary Twitter API key:', error.message);
            primaryUsage = {
                usage: error.response?.status === 429 ? 100 : 0,
                limit: 100,
                status: error.response?.status === 429 ? '429' : 'error',
                error: error.message,
            };
        }

        // Try fallback key
        try {
            fallbackUsage = await getTwitterKeyUsage(fallback);

            // Store reset time if available
            if (fallbackUsage.resetTime) {
                twitterApiUsageCache.resetTimes.fallback = fallbackUsage.resetTime;
            }

            if (
                fallbackUsage.status !== '429' &&
                fallbackUsage.usage < 100 &&
                (primaryUsage.status === '429' ||
                    primaryUsage.usage >= 100 ||
                    primaryUsage.status === 'error')
            ) {
                currentKey = 'fallback';
            }
        } catch (error) {
            logger.error('Error checking fallback Twitter API key:', error.message);
            fallbackUsage = {
                usage: error.response?.status === 429 ? 100 : 0,
                limit: 100,
                status: error.response?.status === 429 ? '429' : 'error',
                error: error.message,
            };
        }

        // Try fallback2 key
        try {
            fallback2Usage = await getTwitterKeyUsage(fallback2);

            // Store reset time if available
            if (fallback2Usage.resetTime) {
                twitterApiUsageCache.resetTimes.fallback2 = fallback2Usage.resetTime;
            }

            if (
                fallback2Usage.status !== '429' &&
                fallback2Usage.usage < 100 &&
                (primaryUsage.status === '429' ||
                    primaryUsage.usage >= 100 ||
                    primaryUsage.status === 'error') &&
                (fallbackUsage.status === '429' ||
                    fallbackUsage.usage >= 100 ||
                    fallbackUsage.status === 'error')
            ) {
                currentKey = 'fallback2';
            }
        } catch (error) {
            logger.error('Error checking fallback2 Twitter API key:', error.message);
            fallback2Usage = {
                usage: error.response?.status === 429 ? 100 : 0,
                limit: 100,
                status: error.response?.status === 429 ? '429' : 'error',
                error: error.message,
            };
        }

        // Update cache with all the information we've gathered
        twitterApiUsageCache = {
            primary: primaryUsage,
            fallback: fallbackUsage,
            fallback2: fallback2Usage,
            currentKey,
            lastCheck: now,
            resetTimes: {
                ...twitterApiUsageCache.resetTimes,
                // Only update reset times that are relevant
                ...(primaryUsage && primaryUsage.resetTime
                    ? { primary: primaryUsage.resetTime }
                    : {}),
                ...(fallbackUsage && fallbackUsage.resetTime
                    ? { fallback: fallbackUsage.resetTime }
                    : {}),
                ...(fallback2Usage && fallback2Usage.resetTime
                    ? { fallback2: fallback2Usage.resetTime }
                    : {}),
            },
        };

        // Format reset times for logging if available
        const formatResetTime = keyName => {
            const resetTime = twitterApiUsageCache.resetTimes[keyName];
            if (resetTime) {
                const resetDate = new Date(resetTime);
                return ` (resets at ${resetDate.toLocaleString()})`;
            }
            return '';
        };

        // Log single-line compact format using utility function
        logger.debug(
            `Twitter API usage: ${formatTwitterApiUsage(
                { primary: primaryUsage, fallback: fallbackUsage, fallback2: fallback2Usage },
                twitterApiUsageCache.resetTimes,
                currentKey
            )}`
        );

        return {
            primary: primaryUsage,
            fallback: fallbackUsage,
            fallback2: fallback2Usage,
            currentKey,
            resetTimes: twitterApiUsageCache.resetTimes,
        };
    } catch (error) {
        // If we have cached data, use it even if it's old
        if (twitterApiUsageCache.lastCheck) {
            logger.warn('Failed to check API usage, using cached data', error);
            return {
                primary: twitterApiUsageCache.primary,
                fallback: twitterApiUsageCache.fallback,
                fallback2: twitterApiUsageCache.fallback2,
                currentKey: twitterApiUsageCache.currentKey,
                resetTimes: twitterApiUsageCache.resetTimes,
            };
        }
        throw error;
    }
}

/**
 * Get the current Twitter API key to use based on usage
 * @returns {Object} - Object with key, name, and usage info
 */
function getCurrentTwitterApiKey() {
    const { primary, fallback, fallback2 } = config.CREDENTIALS.TWITTER_API_KEYS;
    const key =
        twitterApiUsageCache.currentKey === 'primary'
            ? primary
            : twitterApiUsageCache.currentKey === 'fallback'
            ? fallback
            : fallback2;
    return {
        key,
        name: twitterApiUsageCache.currentKey,
        usage: {
            primary: twitterApiUsageCache.primary,
            fallback: twitterApiUsageCache.fallback,
            fallback2: twitterApiUsageCache.fallback2,
        },
    };
}

/**
 * Store fetched tweets in the cache for debugging and reuse
 * @param {Object} tweetsByUser - Object with username keys and arrays of tweets as values
 */
function updateLastFetchedTweetsCache(tweetsByUser) {
    lastFetchedTweetsCache = {
        tweets: tweetsByUser,
        lastUpdated: Date.now(),
    };
    logger.debug(`Updated tweet cache with ${Object.keys(tweetsByUser).length} accounts`);
}

/**
 * Get cached tweets from the last fetch
 * @param {number} maxAgeMinutes - Maximum age of cache in minutes before considering it stale
 * @returns {Object} - Object with tweets and metadata, or null if cache is stale or empty
 */
function getLastFetchedTweetsCache(maxAgeMinutes = 15) {
    const cacheMaxAge = maxAgeMinutes * 60 * 1000; // Convert to milliseconds

    if (
        lastFetchedTweetsCache.lastUpdated &&
        Date.now() - lastFetchedTweetsCache.lastUpdated < cacheMaxAge &&
        Object.keys(lastFetchedTweetsCache.tweets).length > 0
    ) {
        return {
            tweets: lastFetchedTweetsCache.tweets,
            lastUpdated: lastFetchedTweetsCache.lastUpdated,
            cacheAge:
                Math.floor((Date.now() - lastFetchedTweetsCache.lastUpdated) / 1000 / 60) +
                ' minutes',
        };
    }

    return null;
}

// Function to scrape news
async function scrapeNews() {
    // Import puppeteer at the top level to avoid loading it unless needed
    const puppeteer = require('puppeteer');
    let browser = null;

    try {
        logger.debug('Launching puppeteer browser for news scraping');

        // Launch browser with minimal resource usage
        browser = await puppeteer.launch({
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--no-first-run',
                '--no-zygote',
                '--single-process',
                '--disable-gpu',
            ],
            defaultViewport: { width: 1280, height: 800 },
        });

        const page = await browser.newPage();

        // Block unnecessary resources to save bandwidth and CPU
        await page.setRequestInterception(true);
        page.on('request', req => {
            const resourceType = req.resourceType();
            if (resourceType === 'image' || resourceType === 'font' || resourceType === 'media') {
                req.abort();
            } else {
                req.continue();
            }
        });

        // Set user agent to appear as a regular browser
        await page.setUserAgent(
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
        );

        logger.debug('Navigating to newsminimalist.com');
        await page.goto('https://www.newsminimalist.com/', {
            waitUntil: 'networkidle2',
            timeout: 30000,
        });

        // Wait for the news content to load
        logger.debug('Waiting for news content to load');
        await page.waitForSelector('div.mr-auto', { timeout: 10000 });

        // Extract the news items
        const news = await page.evaluate(() => {
            const newsItems = [];
            const elements = document.querySelectorAll('div.mr-auto');

            // Get the first 5 news items
            for (let i = 0; i < Math.min(elements.length, 5); i++) {
                const element = elements[i];
                const headline =
                    element.querySelector('span:first-child')?.textContent?.trim() || '';
                const source =
                    element.querySelector('span.text-xs.text-slate-400')?.textContent?.trim() || '';
                newsItems.push(`${headline} ${source}`);
            }

            return newsItems;
        });

        logger.debug(`Scraped ${news.length} news items successfully`);
        return news;
    } catch (error) {
        logger.error(`An error occurred while scraping news with puppeteer:`, error.message);

        if (error.message.includes('timeout')) {
            logger.error('Puppeteer timeout - page may be loading slowly or structure changed');
        }

        // Return empty array on error
        return [];
    } finally {
        // Always close the browser to free resources
        if (browser) {
            logger.debug('Closing puppeteer browser');
            await browser.close();
        }
    }
}

// Function to scrape football news from ge.globo.com
async function scrapeNews2() {
    try {
        logger.debug('Scraping football news from ge.globo.com');
        const url = 'https://ge.globo.com/futebol/';
        const response = await axios.get(url);
        const $ = cheerio.load(response.data);
        const newsElements = $('.feed-post-body');

        const news = [];
        newsElements.each((index, element) => {
            if (index < 5) {
                const title = $(element).find('.feed-post-body-title a').text().trim();
                const summary = $(element).find('.feed-post-body-resumo').text().trim();
                const link = $(element).find('.feed-post-body-title a').attr('href');
                news.push({ title, summary, link });
            }
        });

        logger.debug(`Found ${news.length} football news items`);
        return news;
    } catch (error) {
        logger.error('Error scraping football news:', error);
        return [];
    }
}

// Function to search for specific news
async function searchNews(searchTerm) {
    try {
        const query = encodeURIComponent(searchTerm);
        const url = `https://news.google.com/rss/search?q=${query}&hl=pt-BR&gl=BR&ceid=BR:pt-419`;
        const response = await axios.get(url);
        const xmlString = response.data;
        const newsItems = parseXML(xmlString).slice(0, 5);

        return newsItems.map(item => {
            const date = new Date(item.pubDate);
            const relativeTime = getRelativeTime(date);
            return `${item.title} (${item.source}) - ${relativeTime}`;
        });
    } catch (error) {
        logger.error(`[ERROR] An error occurred in the searchNews function:`, error.message);
        return [];
    }
}

// Function to translate news to Portuguese
async function translateToPortuguese(text, fromLanguage = 'en') {
    // Handle array of news items (backward compatibility)
    if (Array.isArray(text)) {
        if (text.length === 0) {
            return [];
        }

        try {
            const newsText = text.join('\n');
            const prompt = `Translate the following news to Portuguese. Keep the format and any source information in parentheses:\n\n${newsText}`;
            const completion = await runCompletion(prompt, 1);
            return completion
                .trim()
                .split('\n')
                .filter(item => item.trim() !== '');
        } catch (error) {
            logger.error(`[ERROR] Translation failed:`, error.message);
            return text;
        }
    }

    // Handle a single text input
    try {
        if (!text || text.trim() === '') {
            return text;
        }

        // Skip translation if already in Portuguese
        if (fromLanguage === 'pt') {
            return text;
        }

        const prompt = `Translate the following text from ${fromLanguage} to Portuguese. Maintain formatting and any special characters:

${text}

Provide only the translated text without additional commentary.`;

        const translation = await runCompletion(prompt, 0.3);
        return translation.trim();
    } catch (error) {
        logger.error(`[ERROR] Single text translation failed:`, error.message);
        return text;
    }
}

// Helper function to parse XML from Google News
function parseXML(xmlString) {
    const items = xmlString.match(/<item>([\s\S]*?)<\/item>/g) || [];
    return items.map(item => {
        const title = item.match(/<title>(.*?)<\/title>/)?.[1] || '';
        const pubDate = item.match(/<pubDate>(.*?)<\/pubDate>/)?.[1] || '';
        const source = item.match(/<source.*?>(.*?)<\/source>/)?.[1] || '';
        return { title, pubDate, source };
    });
}

// Helper function to get relative time
function getRelativeTime(date) {
    const now = new Date();
    const diffInSeconds = Math.floor((now - date) / 1000);
    const diffInMinutes = Math.floor(diffInSeconds / 60);
    const diffInHours = Math.floor(diffInMinutes / 60);
    const diffInDays = Math.floor(diffInHours / 24);

    if (diffInSeconds < 60) return `${diffInSeconds} segundos atrás`;
    if (diffInMinutes < 60) return `${diffInMinutes} minutos atrás`;
    if (diffInHours < 24) return `${diffInHours} horas atrás`;
    if (diffInDays === 1) return `1 dia atrás`;
    return `${diffInDays} dias atrás`;
}

/**
 * Format a date in a compact way as MM/DD/YY
 * @param {Date} date - The date to format
 * @returns {string} - Formatted date string
 */
function formatCompactDate(date) {
    if (!date || isNaN(date)) return '';
    return `${date.getMonth() + 1}/${date.getDate()}/${String(date.getFullYear()).substring(2)}`;
}

/**
 * Format Twitter API usage information in a compact, single-line format
 * @param {Object} usage - The Twitter API usage data
 * @param {Object} resetTimes - Object containing reset timestamps for each key
 * @param {string} currentKey - The currently active API key
 * @returns {string} - Formatted usage string
 */
function formatTwitterApiUsage(usage, resetTimes, currentKey) {
    if (!usage || !usage.primary) return 'API usage data unavailable';

    // Format API rate limit reset times (from 429 responses)
    const formatRateLimitReset = keyName => {
        const resetTime = resetTimes && resetTimes[keyName];
        if (resetTime) {
            const resetDate = new Date(resetTime);
            return ` (resets ${formatCompactDate(resetDate)})`;
        }
        return '';
    };

    // Format billing cycle reset day (from cap_reset_day)
    const formatBillingReset = keyData => {
        if (keyData && keyData.capResetDay) {
            // Get current date to construct full reset date
            const now = new Date();
            const currentMonth = now.getMonth();
            const currentYear = now.getFullYear();

            // Create date object for the reset day in the current month
            let resetDate = new Date(currentYear, currentMonth, keyData.capResetDay);

            // If reset day has passed this month, show next month
            if (now > resetDate) {
                resetDate = new Date(currentYear, currentMonth + 1, keyData.capResetDay);
            }

            return ` (resets ${formatCompactDate(resetDate)})`;
        }
        return '';
    };

    // Format statuses for each key
    const formatKeyStatus = (keyData, keyName) => {
        if (!keyData) return '?/? (unknown)';

        const usage = keyData.usage || '?';
        const limit = keyData.limit || '?';

        if (keyData.status === '429') {
            return `${usage}/${limit} (rate limit${formatRateLimitReset(keyName)})`;
        } else if (keyData.status === 'unchecked') {
            return `${usage}/${limit} (unchecked)`;
        } else if (keyData.status === 'error') {
            return `${usage}/${limit} (error)`;
        }

        // Add billing cycle reset info for non-error keys
        return `${usage}/${limit}${formatBillingReset(keyData)}`;
    };

    // Create the formatted message
    return (
        `Primary: ${formatKeyStatus(usage.primary, 'primary')}, ` +
        `Fallback: ${formatKeyStatus(usage.fallback, 'fallback')}, ` +
        `Fallback2: ${formatKeyStatus(usage.fallback2, 'fallback2')}, ` +
        `using ${currentKey} key`
    );
}

/**
 * Check if an article URL should be excluded based on the whitelist configuration
 * @param {string} url - The article URL to check
 * @returns {boolean} - True if it should be excluded (not in whitelist)
 */
function shouldExcludeByWhitelist(url) {
    try {
        // Skip if URL is missing
        if (!url) return false;

        // Parse the URL to extract path segments
        let urlObj;
        try {
            urlObj = new URL(url);
        } catch (e) {
            logger.error(`Invalid URL: ${e.message}`);
            return false;
        }

        // Only process G1 URLs
        if (!urlObj.hostname.includes('g1.globo.com')) return false;

        // Whitelist approach for G1 URLs
        const fullPath = urlObj.pathname;

        // Check if the path is in the whitelist
        const isWhitelisted = WHITELIST_PATHS.some(whitelistedPath => {
            // Split the path into segments for more accurate matching
            const whitelistedSegments = whitelistedPath
                .split('/')
                .filter(segment => segment.length > 0);
            const fullPathSegments = fullPath.split('/').filter(segment => segment.length > 0);

            // If the whitelist path has more segments than the full path, it can't match
            if (whitelistedSegments.length > fullPathSegments.length) {
                return false;
            }

            // Check if all segments in the whitelist path match the corresponding segments in the full path
            for (let i = 0; i < whitelistedSegments.length; i++) {
                if (whitelistedSegments[i] !== fullPathSegments[i]) {
                    return false;
                }
            }

            return true;
        });

        // If the path is in the whitelist, it should NOT be excluded (return false)
        // If the path is NOT in the whitelist, it should be excluded (return true)
        return !isWhitelisted;
    } catch (error) {
        logger.error(`Error checking if URL should be excluded: ${error.message}`, error);
        return false;
    }
}

/**
 * Filter articles based on whitelist configuration
 * @param {Array} articles - Array of RSS articles
 * @returns {Array} - Articles that match the whitelist criteria
 */
function applyWhitelistFilter(articles) {
    // Call the original implementation
    return filterOutLocalNews(articles);
}

module.exports = {
    // Export both old and new function names
    shouldExcludeByWhitelist,
    applyWhitelistFilter,
    isLocalNews,
    filterOutLocalNews,
    // Rest of the exports
    checkTwitterAPIUsage,
    getCurrentTwitterApiKey,
    twitterApiUsageCache,
    updateLastFetchedTweetsCache,
    getLastFetchedTweetsCache,
    scrapeNews,
    searchNews,
    translateToPortuguese,
    parseXML,
    getRelativeTime,
    formatCompactDate,
    formatTwitterApiUsage,
    scrapeNews2,
};
