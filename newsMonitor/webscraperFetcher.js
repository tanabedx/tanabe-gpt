const axios = require('axios');
const cheerio = require('cheerio');
const logger = require('../utils/logger');
const { getFirstSeen, recordFirstSeen } = require('./persistentCache');

class WebscraperFetcher {
    constructor(config) {
        this.config = config;
        // Filter webscraper sources from the main sources array
        this.sources = config.sources?.filter(source => 
            source.type === 'webscraper' && source.enabled
        ) || [];
        this.enrichmentConfig = (config.WEBSCRAPER && config.WEBSCRAPER.ENRICHMENT) || {};
        this.enrichmentCounter = 0;
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
                        // Try enrichment when pubDate is missing
                        if (!article.pubDate) {
                            await this.maybeEnrichTimestamp(article);
                        }

                        if (!article.pubDate) {
                            // Use firstSeen + headline heuristic
                            const topN = this.enrichmentConfig.HEADLINE_FALLBACK_TOP_N || 5;
                            let firstSeenTs = getFirstSeen(article.link);
                            if (!firstSeenTs) {
                                firstSeenTs = recordFirstSeen(article.link) || Date.now();
                            }

                            if (i < topN) {
                                // Promote headline with firstSeen timestamp
                                article.pubDate = new Date(firstSeenTs).toISOString();
                                article.dateTime = article.pubDate;
                                article.timeText = article.timeText || 'headline-firstSeen';
                                logger.debug(`Promoting headline without timestamp using firstSeen: ${article.title.substring(0, 60)}...`);
                                articles.push(article);
                            } else {
                                logger.debug(`Skipping non-headline without timestamp: ${article.title.substring(0, 60)}...`);
                            }
                        } else {
                            // Normal flow
                            articles.push(article);
                        }
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
        if (!timeText || typeof timeText !== 'string') {
            return null; // do not default to now; avoid marking old items as new
        }

        const now = new Date();
        const lowerText = timeText.toLowerCase();

        // Absolute date formats commonly used (e.g., 17/06/2024 às 15h30)
        const absMatch = lowerText.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:\s*(?:às|as)?\s*(\d{1,2})h(?:(\d{1,2}))?)?/i);
        if (absMatch) {
            const d = parseInt(absMatch[1], 10);
            const m = parseInt(absMatch[2], 10) - 1;
            let y = parseInt(absMatch[3], 10);
            if (y < 100) y += 2000;
            const hh = absMatch[4] ? parseInt(absMatch[4], 10) : 0;
            const mm = absMatch[5] ? parseInt(absMatch[5], 10) : 0;
            const dt = new Date(Date.UTC(y, m, d, hh, mm, 0));
            return dt.toISOString();
        }

        // Brazilian Portuguese relative patterns (expanded)
        const patterns = [
            { regex: /atualizado\s+há\s+(\d+)\s+minutos?/i, unit: 'minutes' },
            { regex: /atualizado\s+há\s+(\d+)\s+horas?/i, unit: 'hours' },
            { regex: /atualizado\s+há\s+(\d+)\s+dias?/i, unit: 'days' },
            { regex: /há\s+(\d+)\s+minutos?/i, unit: 'minutes' },
            { regex: /há\s+(\d+)\s+horas?/i, unit: 'hours' },
            { regex: /há\s+(\d+)\s+dias?/i, unit: 'days' },
            { regex: /(\d+)\s*min\s*(?:atrás)?/i, unit: 'minutes' },
            { regex: /(\d+)\s*h\s*(?:atrás)?/i, unit: 'hours' },
            { regex: /(\d+)h(\d+)?/i, unit: 'time' }, // Format like "2h30"
            { regex: /ontem/i, unit: 'yesterday' },
            { regex: /hoje/i, unit: 'today' },
        ];

        for (const pattern of patterns) {
            const match = lowerText.match(pattern.regex);
            if (match) {
                const value = match[1] ? parseInt(match[1], 10) : null;

                if (pattern.unit === 'minutes' && Number.isFinite(value)) {
                    const dt = new Date(now.getTime());
                    dt.setMinutes(dt.getMinutes() - value);
                    return dt.toISOString();
                }
                if (pattern.unit === 'hours' && Number.isFinite(value)) {
                    const dt = new Date(now.getTime());
                    dt.setHours(dt.getHours() - value);
                    return dt.toISOString();
                }
                if (pattern.unit === 'days' && Number.isFinite(value)) {
                    const dt = new Date(now.getTime());
                    dt.setDate(dt.getDate() - value);
                    return dt.toISOString();
                }
                if (pattern.unit === 'time') {
                    const dt = new Date(now.getTime());
                    const h = Number.isFinite(value) ? value : 0;
                    dt.setHours(dt.getHours() - h);
                    if (match[2]) {
                        const mins = parseInt(match[2], 10);
                        if (Number.isFinite(mins)) dt.setMinutes(dt.getMinutes() - mins);
                    }
                    return dt.toISOString();
                }
                if (pattern.unit === 'yesterday') {
                    const dt = new Date(now.getTime());
                    dt.setDate(dt.getDate() - 1);
                    return dt.toISOString();
                }
                if (pattern.unit === 'today') {
                    // ambiguous; avoid claiming exact 'now'. Return start of today to be conservative
                    const dt = new Date(now.getFullYear(), now.getMonth(), now.getDate());
                    return dt.toISOString();
                }
            }
        }

        // If no pattern matches, return null to force downstream filters to treat it conservatively
        return null;
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

    async maybeEnrichTimestamp(article) {
        try {
            const enabled = this.enrichmentConfig.ENABLED === true;
            const maxPerCycle = this.enrichmentConfig.MAX_PER_CYCLE || 0;
            if (!enabled) return;
            if (maxPerCycle > 0 && this.enrichmentCounter >= maxPerCycle) return;

            // Perform enrichment
            const timeout = this.enrichmentConfig.TIMEOUT || 8000;
            const retries = this.enrichmentConfig.RETRY_ATTEMPTS || 0;
            const retryDelay = this.enrichmentConfig.RETRY_DELAY || 500;

            logger.debug(`WS: Enrichment attempt for article without timestamp: ${article.link}`);

            let attempt = 0;
            let html = null;
            while (attempt <= retries && !html) {
                try {
                    const resp = await axios.get(article.link, {
                        headers: {
                            'User-Agent': 'Mozilla/5.0 (compatible; WebscraperFetcher/1.0)'
                        },
                        timeout
                    });
                    html = resp.data;
                } catch (e) {
                    attempt++;
                    if (attempt <= retries) {
                        await new Promise(r => setTimeout(r, retryDelay));
                    }
                }
            }
            if (!html) return;
            this.enrichmentCounter++;

            const $ = cheerio.load(html);

            // Meta tags
            const metaCandidates = [
                'meta[property="article:published_time"]',
                'meta[name="article:published_time"]',
                'meta[property="og:published_time"]',
                'meta[name="og:published_time"]',
                'meta[property="og:updated_time"]',
                'meta[name="og:updated_time"]',
                'meta[itemprop="datePublished"]',
                'meta[name="date"]'
            ];
            for (const sel of metaCandidates) {
                const content = $(sel).attr('content');
                if (content) {
                    const d = new Date(content);
                    if (!isNaN(d.getTime())) {
                        article.pubDate = d.toISOString();
                        article.dateTime = article.pubDate;
                        logger.debug(`WS: Enriched timestamp via meta (${sel}) -> ${article.pubDate}`);
                        return;
                    }
                }
            }

            // time[datetime]
            const timeDt = $('time[datetime]').attr('datetime');
            if (timeDt) {
                const d = new Date(timeDt);
                if (!isNaN(d.getTime())) {
                    article.pubDate = d.toISOString();
                    article.dateTime = article.pubDate;
                    logger.debug(`WS: Enriched timestamp via <time datetime> -> ${article.pubDate}`);
                    return;
                }
            }

            // JSON-LD
            const scripts = $('script[type="application/ld+json"]').toArray();
            for (const s of scripts) {
                try {
                    const text = $(s).contents().text();
                    if (!text) continue;
                    const json = JSON.parse(text);
                    const nodes = Array.isArray(json) ? json : [json];
                    for (const node of nodes) {
                        if (node && typeof node === 'object') {
                            const dateStr = node.datePublished || node.dateCreated || node.dateModified;
                            if (dateStr) {
                                const d = new Date(dateStr);
                                if (!isNaN(d.getTime())) {
                                    article.pubDate = d.toISOString();
                                    article.dateTime = article.pubDate;
                                    logger.debug(`WS: Enriched timestamp via JSON-LD -> ${article.pubDate}`);
                                    return;
                                }
                            }
                        }
                    }
                } catch (_) {
                    // ignore JSON parse errors
                }
            }
        } catch (e) {
            logger.debug(`Enrichment failed for ${article.link}: ${e.message}`);
        }
    }
}

module.exports = WebscraperFetcher; 