const axios = require('axios');
const cheerio = require('cheerio');
const { runCompletion } = require('./openaiUtils');
const logger = require('./logger');
const config = require('../configs');

// Get the excluded states from config or use empty array if not configured
const EXCLUDED_STATES = config.NEWS_MONITOR?.CONTENT_FILTERING?.EXCLUDED_STATES || [];
const INCLUDED_SPECIAL_URLS = config.NEWS_MONITOR?.CONTENT_FILTERING?.INCLUDED_SPECIAL_URLS || [];
// Get additional paths to exclude from config
const EXCLUDED_PATHS = config.NEWS_MONITOR?.CONTENT_FILTERING?.EXCLUDED_PATHS || [];

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
        
        // Split the path into segments
        const pathSegments = urlObj.pathname.split('/').filter(segment => segment.length > 0);
        
        // Check if any segment matches the excluded paths
        if (pathSegments.some(segment => EXCLUDED_PATHS.includes(segment.toLowerCase()))) {
            return true; // Exclude URLs with excluded paths (e.g., podcast)
        }
        
        // Check if the first segment is a Brazilian state code that should be excluded
        if (pathSegments.length > 0) {
            const firstSegment = pathSegments[0].toLowerCase();
            
            // Special case for São Paulo
            if (firstSegment === 'sp') {
                // Check if it's the specific São Paulo city URL we want to allow
                if (pathSegments.length >= 2 && pathSegments[1].toLowerCase() === 'sao-paulo') {
                    // This is the São Paulo city news we DO want to include
                    return false;
                } else {
                    // This is other SP regional news we DON'T want
                    return true;
                }
            }
            
            // For other states, just check if they're in the excluded list
            if (EXCLUDED_STATES.includes(firstSegment)) {
                return true;
            }
        }
        
        // Not in excluded states or paths
        return false;
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
    
    const filteredArticles = articles.filter(article => {
        const url = article.link;
        const isLocal = isLocalNews(url);
        return !isLocal;
    });
    
    logger.debug(`Filtered ${articles.length - filteredArticles.length} local news articles out of ${articles.length} total`);
    return filteredArticles;
}

// Function to scrape news
async function scrapeNews() {
    try {
        const url = 'https://www.newsminimalist.com/';
        const response = await axios.get(url);

        if (response.status !== 200) {
            logger.error(`Failed to load page`);
            return [];
        }

        const $ = cheerio.load(response.data);
        const newsElements = $('div.mr-auto');

        if (!newsElements.length) {
            logger.debug(`No news elements found`);
            return [];
        }

        const news = [];
        newsElements.each((index, element) => {
            if (index < 5) {
                const headline = $(element).find('span').first().text().trim();
                const source = $(element).find('span.text-xs.text-slate-400').text().trim();
                news.push(`${headline} ${source}`);
            }
        });

        return news;
    } catch (error) {
        logger.error(`An error occurred while scraping news:`, error.message);
        return [];
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
async function translateToPortuguese(news) {
    if (!Array.isArray(news) || news.length === 0) {
        return [];
    }

    try {
        const newsText = news.join('\n');
        const prompt = `Translate the following news to Portuguese. Keep the format and any source information in parentheses:\n\n${newsText}`;
        const completion = await runCompletion(prompt, 1);
        return completion.trim().split('\n').filter(item => item.trim() !== '');
    } catch (error) {
        logger.error(`[ERROR] Translation failed:`, error.message);
        return news;
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
    parseXML,
    getRelativeTime,
    isLocalNews,
    filterOutLocalNews
}; 