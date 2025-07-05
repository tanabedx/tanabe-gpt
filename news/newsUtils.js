const axios = require('axios');
const cheerio = require('cheerio');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const { runCompletion } = require('../utils/openaiUtils');
const logger = require('../utils/logger');

puppeteer.use(StealthPlugin());

// Function to scrape news
async function scrapeNews() {
    let browser;
    try {
        logger.debug('Launching puppeteer for news scraping with stealth plugin');
        browser = await puppeteer.launch({
            headless: 'new',
            args: ['--no-sandbox', '--disable-setuid-sandbox'],
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
            timeout: 60000,
        });

        logger.debug('Waiting for news content to load, this may take a moment...');
        await page.waitForSelector('div.mr-auto', { visible: true, timeout: 60000 });
        logger.debug('News content is visible, proceeding with scraping.');
        
        const itemHandles = await page.$$('div.mr-auto');
        const newsItems = [];

        logger.debug(`Found ${itemHandles.length} potential news items. Scraping top 5.`);

        for (let i = 0; i < Math.min(itemHandles.length, 5); i++) {
            const itemHandle = itemHandles[i];
            const itemText = await itemHandle.evaluate(el => {
                const headline = el.querySelector('span:first-child')?.textContent || '';
                const source = el.querySelector('span:last-child')?.textContent || '';
                return (headline && source) ? `${headline.trim()} ${source.trim()}` : null;
            });

            if (itemText) {
                newsItems.push(itemText);
            }
            await itemHandle.dispose();
        }

        if (newsItems.length === 0) {
            logger.warn('Could not scrape any news items from the page.');
        } else {
            logger.debug(`Scraped ${newsItems.length} news items successfully`);
        }
        return newsItems;
    } catch (error) {
        logger.error(`An error occurred while scraping news with puppeteer::`, error.message);
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

module.exports = {
    scrapeNews,
    scrapeNews2,
    searchNews,
    translateToPortuguese,
}; 