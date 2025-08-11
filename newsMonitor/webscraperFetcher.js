const axios = require('axios');
const cheerio = require('cheerio');
const logger = require('../utils/logger');

class WebscraperFetcher {
    constructor(config) {
        this.config = config;
        // Filter webscraper sources from the main sources array
        this.sources = config.sources?.filter(source => 
            source.type === 'webscraper' && source.enabled
        ) || [];
    }

    async fetchAllSources() {
        const allArticles = [];
        
        for (const source of this.sources) {
            try {
                logger.debug(`Starting webscraper for: ${source.name}`);
                const sourceArticles = await this.scrapeSource(source);
                allArticles.push(...sourceArticles);
                logger.debug(`${source.name}: ${sourceArticles.length} articles scraped`);
            } catch (error) {
                logger.error(`Error scraping ${source.name}:`, error.message);
            }
        }
        
        return allArticles;
    }

    async scrapeSource(source) {
        if (source.scrapeMethod === 'pagination') {
            return await this.scrapeWithPagination(source);
        } else {
            return await this.scrapeWithCheerio(source);
        }
    }

    async scrapeWithPagination(source) {
        const allArticles = [];
        const maxItems = this.config.WEBSCRAPER?.MAX_ITEMS_PER_SOURCE || 50;
        let totalScraped = 0;
        
        logger.debug(`Using pagination scraping for ${source.name}`);
        
        // Start with page 1 (main page)
        const remainingForPage1 = Math.max(0, maxItems - totalScraped);
        const page1Articles = await this.scrapePage(source.url, source, remainingForPage1);
        allArticles.push(...page1Articles);
        totalScraped += page1Articles.length;
        
        logger.debug(`Page 1: ${page1Articles.length} articles`);
        
        // Continue with pagination pages
        let currentPage = 2;
        const maxPages = 20; // Safety limit to prevent infinite loops
        
        while (totalScraped < maxItems && currentPage <= maxPages) {
            const pageUrl = source.paginationPattern.replace('{page}', currentPage);
            
            try {
                const remainingForPage = Math.max(0, maxItems - totalScraped);
                const pageArticles = await this.scrapePage(pageUrl, source, remainingForPage);
                
                if (pageArticles.length === 0) {
                    logger.debug(`Page ${currentPage}: No articles found, stopping pagination`);
                    break;
                }
                
                const articlesToAdd = pageArticles.slice(0, maxItems - totalScraped);
                allArticles.push(...articlesToAdd);
                totalScraped += articlesToAdd.length;
                
                logger.debug(`Page ${currentPage}: ${articlesToAdd.length} articles (total: ${totalScraped})`);
                
                if (articlesToAdd.length < pageArticles.length) {
                    logger.debug(`Reached max items limit (${maxItems}), stopping pagination`);
                    break;
                }
                
                currentPage++;
                
                // Small delay to be respectful and yield the event loop
                await new Promise(resolve => setTimeout(resolve, 50));
                
            } catch (error) {
                logger.warn(`⚠️ Error scraping page ${currentPage}: ${error.message}`);
                break;
            }
        }
        
        logger.debug(`Total articles scraped from ${source.name}: ${totalScraped}`);
        return allArticles;
    }

    async scrapePage(url, source, maxToCollect = Infinity) {
        try {
            const response = await axios.get(url, {
                headers: {
                    'User-Agent': source.userAgent || 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
                    'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
                    'Accept-Encoding': 'gzip, deflate, br',
                    'Cache-Control': 'no-cache'
                },
                timeout: 10000
            });

            const $ = cheerio.load(response.data);
            const articles = [];

            const containers = $(source.selectors.container).slice(0, isFinite(maxToCollect) ? maxToCollect : undefined).toArray();

            for (let i = 0; i < containers.length; i++) {
                const element = containers[i];
                try {
                    const article = this.extractArticleData($, $(element), source);
                    if (article && article.title && article.link) {
                        articles.push(article);
                    }
                } catch (error) {
                    logger.debug(`Error extracting article ${i}:`, error.message);
                }
                // Cooperative yield every 20 items to avoid long event-loop stalls
                if (i > 0 && i % 20 === 0) {
                    // eslint-disable-next-line no-await-in-loop
                    await new Promise(resolve => setImmediate(resolve));
                }
                if (articles.length >= maxToCollect) break;
            }

            return articles;
        } catch (error) {
            logger.error(`Error fetching ${url}:`, error.message);
            throw error;
        }
    }

    async scrapeWithCheerio(source) {
        logger.debug(`Using Cheerio scraping for ${source.name}`);
        return await this.scrapePage(source.url, source);
    }

    extractArticleData($, $element, source) {
        // Extract basic article data
        const titleElement = $element.find(source.selectors.title);
        const linkElement = $element.find(source.selectors.link);
        const timeElement = $element.find(source.selectors.time);
        const contentElement = $element.find(source.selectors.content);

        const title = titleElement.text().trim();
        let link = linkElement.attr('href');
        const timeText = timeElement.text().trim();
        const content = contentElement.text().trim();

        if (!title || !link) {
            return null;
        }

        // Convert relative URLs to absolute
        if (link && !link.startsWith('http')) {
            const baseUrl = new URL(source.url).origin;
            link = new URL(link, baseUrl).href;
        }

        // Parse relative time to actual timestamp
        const pubDate = this.parseRelativeTime(timeText);

        return this.normalizeScrapedItem({
            title,
            link,
            content: content || title,
            pubDate,
            timeText,
            source: source.name,
            sourceUrl: source.url
        });
    }

    parseRelativeTime(timeText) {
        if (!timeText) {
            return new Date().toISOString();
        }

        const now = new Date();
        const lowerText = timeText.toLowerCase();

        // Brazilian Portuguese time patterns
        const patterns = [
            { regex: /há (\d+) minutos?/i, unit: 'minutes' },
            { regex: /há (\d+) horas?/i, unit: 'hours' },
            { regex: /há (\d+) dias?/i, unit: 'days' },
            { regex: /(\d+)h(\d+)?/i, unit: 'time' }, // Format like "2h30"
        ];

        for (const pattern of patterns) {
            const match = lowerText.match(pattern.regex);
            if (match) {
                const value = parseInt(match[1]);
                
                if (pattern.unit === 'minutes') {
                    now.setMinutes(now.getMinutes() - value);
                } else if (pattern.unit === 'hours') {
                    now.setHours(now.getHours() - value);
                } else if (pattern.unit === 'days') {
                    now.setDate(now.getDate() - value);
                } else if (pattern.unit === 'time') {
                    // Handle format like "2h30" (2 hours 30 minutes ago)
                    now.setHours(now.getHours() - value);
                    if (match[2]) {
                        now.setMinutes(now.getMinutes() - parseInt(match[2]));
                    }
                }
                
                return now.toISOString();
            }
        }

        // If no pattern matches, return current time
        return new Date().toISOString();
    }

    normalizeScrapedItem(item) {
        return {
            type: 'webscraper',
            feedName: item.source,
            title: item.title,
            link: item.link,
            content: item.content,
            pubDate: item.pubDate,
            dateTime: item.pubDate,
            sourceName: item.source,
            sourceUrl: item.sourceUrl,
            scrapedAt: new Date().toISOString(),
            scrapeMethod: 'pagination',
            timeText: item.timeText
        };
    }
}

module.exports = WebscraperFetcher; 