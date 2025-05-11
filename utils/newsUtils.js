const axios = require('axios');
const cheerio = require('cheerio');
const { runCompletion } = require('./openaiUtils');
const logger = require('./logger');
const config = require('../configs');

// Get the whitelist paths
const WHITELIST_PATHS = config.NEWS_MONITOR?.CONTENT_FILTERING?.WHITELIST_PATHS || [];

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
            const isWhitelisted = WHITELIST_PATHS.some(whitelistedPath =>
                fullPath.startsWith(whitelistedPath)
            );

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
                localArticleData.push({
                    title:
                        article.title?.substring(0, 80) + (article.title?.length > 80 ? '...' : ''),
                    path: fullPath,
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
            .map((item, idx) => `  ${idx + 1}. "${item.title}" - Path: ${item.path}`)
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

module.exports = {
    scrapeNews,
    scrapeNews2,
    searchNews,
    translateToPortuguese,
    parseXML,
    getRelativeTime,
    isLocalNews,
    filterOutLocalNews,
    formatCompactDate,
    formatTwitterApiUsage,
};
