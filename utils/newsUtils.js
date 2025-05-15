const axios = require('axios');
const cheerio = require('cheerio');
const { runCompletion } = require('./openaiUtils');
const logger = require('./logger');

// Function to scrape news
async function scrapeNews() {
    // Import puppeteer at the top level to avoid loading it unless needed
    const puppeteer = require('puppeteer');
    let browser = null;
    try {
        logger.debug('Launching puppeteer browser for news scraping');
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
        await page.setRequestInterception(true);
        page.on('request', req => {
            const resourceType = req.resourceType();
            if (resourceType === 'image' || resourceType === 'font' || resourceType === 'media') {
                req.abort();
            } else {
                req.continue();
            }
        });
        await page.setUserAgent(
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
        );
        logger.debug('Navigating to newsminimalist.com');
        await page.goto('https://www.newsminimalist.com/', {
            waitUntil: 'networkidle2',
            timeout: 30000,
        });
        logger.debug('Waiting for news content to load');
        await page.waitForSelector('div.mr-auto', { timeout: 10000 });
        const news = await page.evaluate(() => {
            const newsItems = [];
            const elements = document.querySelectorAll('div.mr-auto');
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
        return [];
    } finally {
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
async function translateToPortuguese(text, fromLanguage = 'auto') {
    if (Array.isArray(text)) {
        if (text.length === 0) {
            return [];
        }
        try {
            const newsText = text.join('\n');
            const prompt = `Translate the following news items to Portuguese. Each item is on a new line. If an item is already in clear and fluent Portuguese, return it as is. Otherwise, provide the Portuguese translation. Maintain original formatting.\n\n${newsText}`;
            const completion = await runCompletion(prompt, 0.3, null, 'TRANSLATE_PORTUGUESE_ARRAY');
            return completion
                .trim()
                .split('\n')
                .filter(item => item.trim() !== '');
        } catch (error) {
            logger.error(`NM Translate: [ERROR] Array translation failed: ${error.message}`);
            return text;
        }
    }
    try {
        const textAsString = String(text || '');
        if (textAsString.trim() === '') {
            return textAsString;
        }
        const originalTextForLog = textAsString.substring(0, 70);
        if (fromLanguage === 'pt') {
            logger.debug(
                `NM Translate: Skipping translation for text marked as Portuguese: "${originalTextForLog}..."`
            );
            return textAsString;
        }
        let prompt;
        if (fromLanguage && fromLanguage !== 'auto' && fromLanguage !== 'en') {
            prompt = `Translate the following text from '${fromLanguage}' to Portuguese. If the text is already in clear and fluent Portuguese, return the original text. Otherwise, provide the Portuguese translation. Maintain original formatting and special characters as much as possible.\n\nText:\n${textAsString}`;
            logger.debug(
                `NM Translate: Translating from '${fromLanguage}' to Portuguese: "${originalTextForLog}..."`
            );
        } else {
            prompt = `Translate the following text to Portuguese. If the text is already in clear and fluent Portuguese, return the original text. Otherwise, provide the Portuguese translation. Maintain original formatting and special characters as much as possible.\n\nText:\n${textAsString}`;
            logger.debug(
                `NM Translate: Translating (auto-detect/default) to Portuguese: "${originalTextForLog}..."`
            );
        }
        const translation = await runCompletion(prompt, 0.3, null, 'TRANSLATE_PORTUGUESE_SINGLE');
        const trimmedTranslation = translation.trim();
        if (trimmedTranslation !== textAsString) {
            logger.debug(
                `NM Translate: Original: "${originalTextForLog}..." -> Translated: "${trimmedTranslation.substring(
                    0,
                    70
                )}..."`
            );
        } else if (textAsString.length > 50) {
            logger.debug(
                `NM Translate: Translation identical to original (and non-trivial length): "${originalTextForLog}..."`
            );
        }
        return trimmedTranslation;
    } catch (error) {
        logger.error(
            `NM Translate: [ERROR] Single text translation failed for "${String(
                text || ''
            ).substring(0, 70)}...": ${error.message}`
        );
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

module.exports = {
    scrapeNews,
    scrapeNews2,
    searchNews,
    translateToPortuguese,
    parseXML,
    getRelativeTime,
    formatCompactDate,
};
