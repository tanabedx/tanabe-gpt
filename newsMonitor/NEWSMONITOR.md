# News Monitor System Documentation

## Overview
Automated news monitoring and distribution system for WhatsApp bot with multi-source content fetching, intelligent filtering pipeline, AI-powered content evaluation, and duplicate detection across Twitter, RSS feeds, and website scraping sources.

## Core Features
- **Multi-Source Fetching**: Twitter, RSS feeds, and website scraping with intelligent rate limiting and API key management
- **Website Scraping**: Direct pagination-based scraping for sites without RSS feeds (no Puppeteer required)
- **Smart Content Processing**: Link extraction for short tweets with priority-based processing (images → links → original text)
- **Advanced Filtering Pipeline**: 10-stage content evaluation from interval filtering to enhanced topic redundancy detection
- **Strict GPT-5 Guardrails**: Baseline-knowledge prompts, low-temperature completions, and reject-by-default parsing to avoid leniency
- **AI Content Evaluation**: Relevance assessment, summarization, and semantic duplicate detection
- **Importance-Based Topic Filtering**: AI-powered consequence evaluation with dynamic thresholds and category weighting
- **Dynamic API Management**: Multi-key Twitter API system with automatic failover and usage monitoring
- **Quiet Hours Intelligence**: Captures news during quiet hours for evaluation after quiet hours end, ensuring no breaking news is missed

## Usage Examples
```javascript
// Automatic operation every 16 minutes processing all configured sources
NEWS_MONITOR_CONFIG.enabled = true;  // Master toggle
NEWS_MONITOR_CONFIG.CHECK_INTERVAL = 960000;  // 16 minutes

// Manual operations
await generateNewsCycleDebugReport();     // Debug analysis
await restartMonitors(true, true);       // Restart Twitter and RSS
```

## Architecture Overview

### Core Design Pattern
Multi-stage filtering pipeline with parallel source processing, centralized AI evaluation, and persistent cache management. Uses configuration-driven source management with dynamic API key rotation for high availability.

### Processing Flow
1. **Source Fetching** → `twitterFetcher.js` + `rssFetcher.js` + `webscraperFetcher.js` (parallel execution)
2. **Filtering Pipeline** → `filteringUtils.js` (10-stage evaluation process)
3. **AI Evaluation** → `evaluationUtils.js` (content relevance and summarization)
4. **Duplicate Detection** → `contentProcessingUtils.js` (semantic similarity analysis)
5. **Two-Stage Topic Filtering** → Traditional (within-batch priority) + Enhanced (historical context)
6. **Message Distribution** → WhatsApp integration with media support

## Stricter GPT-5 Guardrails (Post-Upgrade)

To counter increased leniency observed after upgrading to GPT-5, several strictness controls were added across prompts, model tiers, and parsing rules:

- **Presidential Baseline Knowledge**: Prompts now presume the president already knows widely reported headlines from major agencies (Reuters/AP/AFP) and portals (G1, Folha, NYT, BBC), and receives ongoing briefings. Only truly novel, specific, and decision-altering updates pass.
- **Default-to-Reject on Ambiguity**: Account-specific evaluations default to rejection when AI responses are invalid, malformed, or ambiguous. Batch title selection also defaults to “0” on doubt.
- **Low Temperature for Decision Prompts**: Key prompts run at a lower temperature (~0.1) to reduce creative drift and enforce consistency.
- **Higher Model Tier for Critical Steps**: `EVALUATE_CONTENT`, `DETECT_STORY_DEVELOPMENT`, and `DETECT_TOPIC_REDUNDANCY` use the HIGH tier model for more conservative and reliable judgments.
- **Stricter Consequence Scoring**: Importance thresholds remain high (7/8/10) and escalation requires ≥9.5 with clear novelty over originals.

Tuning knobs if further strictness is needed:
- Increase thresholds to `FIRST_CONSEQUENCE: 8`, `SECOND_CONSEQUENCE: 9`, keep `THIRD_CONSEQUENCE: 10`.
- Reduce `SPORTS` weight from `1.2` → `1.0` if soccer volume is still high.
- Tighten `CONTENT_FILTERING.WHITELIST_PATHS` by removing broad domains and favoring specific paths.
- Lower `LINK_PROCESSING.MIN_CHAR_THRESHOLD` from `25` → `15` to avoid rescuing very short tweets via link expansion.

These changes make the system significantly more selective while preserving the ability to surface genuinely novel or escalating developments.

## File Structure & Roles

### Core Orchestration
- **`newsMonitor.js`**: Main pipeline orchestrator, cycle management, unified processing coordination
- **`newsMonitor.config.js`**: Master configuration for sources, AI models, filtering rules, credentials

### Content Fetching Layer
- **`twitterFetcher.js`**: Twitter content retrieval, media handling, account-specific filtering
- **`rssFetcher.js`**: RSS feed processing, article extraction, full content scraping
- **`webscraperFetcher.js`**: Website scraping with pagination support, real-time content extraction
- **`twitterApiHandler.js`**: Multi-key management, usage monitoring, rate limit handling

### Processing & Evaluation Layer
- **`filteringUtils.js`**: Multi-stage content filtering pipeline, whitelist/blacklist enforcement
- **`evaluationUtils.js`**: AI-powered relevance assessment, batch title evaluation
- **`contentProcessingUtils.js`**: Content summarization, duplicate detection, topic redundancy filtering

### Utility & Debugging
- **`debugReportUtils.js`**: Cycle analysis, performance reporting, pipeline debugging
- **`newsMonitor.prompt.js`**: AI evaluation prompts, content processing templates

## Core Components

### Source Configuration System (`newsMonitor.config.js`)
```javascript
sources: [
    {
        type: 'twitter',
        enabled: boolean,
        username: string,
        mediaOnly: boolean,        // Image text extraction before evaluation
        skipEvaluation: boolean,   // Skip AI content evaluation
        promptSpecific: boolean,   // Use account-specific prompts
        priority: number,          // Content priority ranking
        processLinksForShortTweets: boolean, // Enable link processing for short tweets
        shortTweetThreshold: number|null,    // Custom threshold or null for global default
    },
    {
        type: 'rss',
        enabled: boolean,
        url: string,
        language: string,
        priority: number
    },
    {
        type: 'webscraper',
        enabled: boolean,
        name: string,
        url: string,
        paginationPattern: string,     // URL pattern for pagination (e.g., 'page-{page}.ghtml')
        scrapeMethod: string,          // 'pagination' for direct URL pagination
        priority: number,
        selectors: {
            container: string,         // Article container selector
            title: string,            // Title selector
            link: string,             // Link selector
            time: string,             // Time/date selector
            content: string           // Content/summary selector
        },
        userAgent: string             // User agent for requests
    }
]
```

### Filtering Pipeline (`filteringUtils.js`)
```javascript
filteringStages = [
    'intervalFilter',        // Last run timestamp or content age validation
    'whitelistFilter',       // Domain/path-based filtering for RSS and webscraper content
    'blacklistFilter',       // Keyword exclusion
    'imageTextExtraction',   // OCR for media-only content (step 3.5)
    'linkContentProcessing', // Link extraction for short tweets (step 3.6)
    'promptSpecificFilter',  // Account-specific AI evaluation (step 5)
    'batchTitleEvaluation', // RSS title relevance - batch (step 6)
    'fullContentEvaluation', // Complete AI content analysis (step 7)
    'duplicateDetection',    // Semantic similarity check (step 8)
    'traditionalTopicRedundancy', // Within-batch deduplication with source priority (step 9)
    'enhancedTopicRedundancy' // Topic-based filtering against historical content (step 10)
]
```

### Twitter API Management (`twitterApiHandler.js`)
```javascript
keyManagement = {
    multiKeySupport: {
        primary: { bearer_token, usage, limit, status },
        fallback1: { bearer_token, usage, limit, status },
        // ... additional keys
    },
    stateManagement: {
        unifiedCooldownUntil: timestamp,     // Coordinated API cooldowns
        lastSuccessfulCheck: timestamp,      // Health monitoring
        status: 'ok|error|cooldown|unchecked' // Current availability
    },
    usageMonitoring: {
        monthlyUsage: number,               // Current API calls used
        monthlyLimit: number,               // API call cap
        capResetDay: number                 // Monthly reset date
    }
}
```

### AI Model Selection (`newsMonitor.config.js`)

The News Monitor uses centralized, tier-based model selection from `config.SYSTEM.AI_MODELS` to keep model management consistent across the project.

```javascript
// Tiers from main config:
// config.SYSTEM.AI_MODELS = { LOW: 'gpt-5-nano', MEDIUM: 'gpt-5-mini', HIGH: 'gpt-5' }

AI_MODELS = {
    // HIGH tier: complex/critical evaluation tasks
    BATCH_EVALUATE_TITLES: config.SYSTEM.AI_MODELS.HIGH,
    EVALUATE_CONSEQUENCE_IMPORTANCE: config.SYSTEM.AI_MODELS.HIGH,
    EVALUATE_CONTENT: config.SYSTEM.AI_MODELS.HIGH,
    DETECT_STORY_DEVELOPMENT: config.SYSTEM.AI_MODELS.HIGH,
    DETECT_TOPIC_REDUNDANCY: config.SYSTEM.AI_MODELS.HIGH,

    // MEDIUM tier: standard processing tasks
    DETECT_DUPLICATE: config.SYSTEM.AI_MODELS.MEDIUM,

    // LOW tier: simpler tasks and fallbacks
    SUMMARIZE_CONTENT: config.SYSTEM.AI_MODELS.LOW,
    SITREP_artorias_PROMPT: config.SYSTEM.AI_MODELS.LOW,
    PROCESS_IMAGE_TEXT_EXTRACTION_PROMPT: config.SYSTEM.AI_MODELS.LOW,
    TRANSLATION: config.SYSTEM.AI_MODELS.LOW,
    DEFAULT: config.SYSTEM.AI_MODELS.LOW,
}
```

This preserves the existing `AI_MODELS[promptType]` interface while centralizing the underlying model names.

### Importance-Based Topic Filtering (`persistentCache.js`, `filteringUtils.js`)
```javascript
TOPIC_FILTERING = {
    ENABLED: true,
    USE_IMPORTANCE_SCORING: true,        // Enable AI importance evaluation
    COOLING_HOURS: 48,                   // How long to track related stories
    IMPORTANCE_THRESHOLDS: {
        FIRST_CONSEQUENCE: 7,            // 1st follow-up needs score ≥7 (stricter)
        SECOND_CONSEQUENCE: 8,           // 2nd follow-up needs score ≥8 (stricter)
        THIRD_CONSEQUENCE: 10,           // 3rd follow-up needs score ≥10 (stricter)
    },
    CATEGORY_WEIGHTS: {
        ECONOMIC: 0.7,                   // Market reactions get reduced weight (stricter)
        DIPLOMATIC: 0.9,                 // Diplomatic news penalized (stricter)
        MILITARY: 1.1,                   // Military developments boosted (reduced)
        LEGAL: 1.2,                      // Legal implications boosted (reduced)
        INTELLIGENCE: 1.2,               // Intelligence revelations boosted (reduced)
        HUMANITARIAN: 1.0,               // Humanitarian impacts standard weight (reduced)
        POLITICAL: 1.0,                  // Political developments standard weight (reduced)
        SPORTS: 1.2,                     // Soccer news boosted due to personal interest
    },
    ESCALATION_THRESHOLD: 9.5,           // Score ≥9.5 becomes new core event (stricter)
    // Legacy fallback settings
    MAX_CONSEQUENCES: 3,
    REQUIRE_HIGH_IMPORTANCE_FOR_CONSEQUENCES: true,
}

activeTopic = {
    topicId: string,                     // Unique topic identifier (e.g., "israelir-2025-06-13")
    entities: string[],                  // Key entities (countries, organizations)
    keywords: string[],                  // Important keywords from content
    startTime: number,                   // Topic creation timestamp
    lastUpdate: number,                  // Last related item timestamp
    cooldownUntil: number,               // When topic expires (startTime + COOLING_HOURS)
    coreEventsSent: number,              // Count of core events for this topic
    consequencesSent: number,            // Count of consequences sent
    consequences: [{                     // Detailed consequence tracking
        title: string,                   // Consequence headline/text
        source: string,                  // Source (G1, SITREP_artorias, etc.)
        timestamp: number,               // When consequence was processed
        importanceScore: number,         // AI-assigned weighted score (1-10)
        category: string,                // ECONOMIC, MILITARY, LEGAL, etc.
        justification: string,           // AI explanation for score
        rawScore: number                 // Original score before category weighting
    }],
    originalItem: {
        title: string,                   // Original core event title
        source: string,                  // Source of core event
        justification: string,           // Why it was considered important
        baseImportance: number           // Assumed importance of core events (default: 8)
    }
}
```

## Link Processing System for Short Tweets

### Overview
The News Monitor implements intelligent link processing for Twitter accounts that share short posts with links. When tweets contain minimal text content but include links, the system automatically extracts and processes the linked content to enable proper evaluation and summarization.

### How It Works

#### Priority-Based Processing
The system follows a clear priority hierarchy for content processing:
1. **Image Text Extraction** (Highest Priority) - For `mediaOnly` accounts
2. **Link Content Processing** (Medium Priority) - For short tweets with links  
3. **Original Tweet Text** (Fallback) - When other methods aren't applicable

#### Character Threshold Logic
```javascript
// Tweet: "🚨 Breaking: https://news.com/major-story-link"
// Total length: 45 characters
// Non-link text: "🚨 Breaking: " = 12 characters
// → Under 25 character threshold → Process link content

// Tweet: "Detailed analysis of economic implications https://example.com"
// Total length: 60 characters  
// Non-link text: "Detailed analysis of economic implications " = 47 characters
// → Over 25 character threshold → Use original text
```

#### Processing Steps
1. **Link Detection**: Extract URLs from tweet text using `linkUtils.js`
2. **Text Calculation**: Remove links and count remaining non-link characters
3. **Threshold Check**: Compare against account-specific or global threshold
4. **Content Extraction**: Fetch and process link content if under threshold
5. **Content Replacement**: Replace `item.text` with extracted link content
6. **Fallback Handling**: Use original text if link processing fails

### Configuration Options

#### Global Configuration (`newsMonitor.config.js`)
```javascript
LINK_PROCESSING: {
    ENABLED: true,                   // Master toggle
    MIN_CHAR_THRESHOLD: 25,          // Process links if non-link text < 25 chars
    MAX_LINK_CONTENT_CHARS: 3000,    // Limit extracted content length
    TIMEOUT: 15000,                  // 15 second timeout for link processing
    RETRY_ATTEMPTS: 2,               // Retry failed requests twice
    RETRY_DELAY: 1000                // 1 second delay between retries
}
```

#### Per-Account Configuration
```javascript
{
    type: 'twitter',
    username: 'BreakingNews',
    processLinksForShortTweets: true,    // Enable link processing
    shortTweetThreshold: null,           // Use global threshold (25 chars)
},
{
    type: 'twitter', 
    username: 'SITREP_artorias',
    mediaOnly: true,
    processLinksForShortTweets: false,   // Disabled - images take priority
    shortTweetThreshold: null,
},
{
    type: 'twitter',
    username: 'example_news_account', 
    processLinksForShortTweets: true,    // Enable link processing
    shortTweetThreshold: 50,             // Custom threshold: 50 characters
}
```

### Key Functions (`contentProcessingUtils.js`)
```javascript
// Main link processing function
processLinkContentForShortTweets(item, config)  // Process links for qualifying tweets

// Integration with existing utilities
extractLinks(text)                              // Extract URLs from text (linkUtils.js)
unshortenLink(url)                             // Resolve shortened URLs (linkUtils.js)  
getPageContent(url)                            // Extract text content (linkUtils.js)
```

### Example Processing Flow
```
Tweet: "🚨 https://breaking-news.com/story"
  ↓
Extract Links: ["https://breaking-news.com/story"]
  ↓
Calculate Non-Link Text: "🚨 " = 2 characters
  ↓
Check Threshold: 2 < 25 → Process Link
  ↓
Fetch Link Content: "Major earthquake hits California causing widespread damage..."
  ↓
Replace Text: item.text = "Major earthquake hits California causing widespread damage..."
  ↓
Continue to Content Evaluation (using link content instead of "🚨 ")
```

### Benefits
- **Enhanced Content Quality**: Short tweets with links get proper evaluation using actual article content
- **Smart Priority System**: Images processed first, then links, with original text as fallback
- **Per-Account Control**: Different thresholds and settings for different Twitter accounts
- **Robust Error Handling**: Graceful degradation if link processing fails
- **Performance Optimized**: Only processes when needed (short tweets with links)

## Website Scraping System

### Overview
The News Monitor implements intelligent website scraping for sources that don't provide RSS feeds. The system uses direct URL pagination without requiring resource-heavy tools like Puppeteer, making it fast and efficient while extracting real publication timestamps.

### How It Works

#### Direct URL Pagination
Instead of JavaScript automation, the webscraper discovers and exploits direct pagination URL patterns:
```javascript
// Example: GE Globo pagination pattern
baseUrl: 'https://ge.globo.com/futebol/'
paginationPattern: 'https://ge.globo.com/futebol/index/feed/pagina-{page}.ghtml'
// Results in: page-2.ghtml, page-3.ghtml, page-4.ghtml, etc.
```

#### Real Timestamp Extraction
- **Brazilian Portuguese Parsing**: Converts relative time expressions ("Há 5 minutos", "Há 2 horas") to actual timestamps
- **Publication Time Recovery**: Extracts real publication times instead of scraping timestamps
- **Timezone Awareness**: Handles Brazilian timezone properly for accurate filtering

#### Processing Steps
1. **Page Fetching**: Start with base URL, then paginate through numbered pages
2. **Content Extraction**: Use CSS selectors to extract article data (title, link, time, content)
3. **Time Normalization**: Parse relative timestamps into absolute ISO dates
4. **Duplicate Detection**: Prevent duplicate articles across pagination pages
5. **Limit Enforcement**: Stop when reaching configured article limit (default: 50)

### Configuration

#### Webscraper Source in Main Sources Array
```javascript
sources: [
    {
        type: 'webscraper',
        enabled: true,
        name: 'GE Globo',
        url: 'https://ge.globo.com/futebol/',
        paginationPattern: 'https://ge.globo.com/futebol/index/feed/pagina-{page}.ghtml',
        scrapeMethod: 'pagination',
        priority: 4,                        // Lower than Twitter/RSS sources
        selectors: {
            container: '.feed-post',         // Article container
            title: '.feed-post-body h2 a',   // Article title
            link: '.feed-post-body h2 a',    // Article link
            time: '.feed-post-metadata',     // Relative time element
            content: '.feed-post-body p'     // Article summary
        },
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
    }
]
```

#### Global Webscraper Settings
```javascript
WEBSCRAPER: {
    MAX_ITEMS_PER_SOURCE: 50,        // Maximum articles per source
    DEFAULT_TIMEOUT: 15000,          // Request timeout in milliseconds
    DEFAULT_RETRY_ATTEMPTS: 2,       // Number of retry attempts
}
```

### Key Functions (`webscraperFetcher.js`)
```javascript
// Main scraping orchestrator
fetchAllSources()                    // Process all enabled webscraper sources

// Core scraping logic
scrapeSource(source)                 // Scrape single source with pagination
scrapeWithPagination(source)         // Handle pagination URL patterns
normalizeScrapedItem(item, source)   // Convert to standard format

// Time processing utilities
parseRelativeTime(timeText)          // Convert "Há 5 minutos" to timestamp
```

### Performance Benefits
- **No Puppeteer Required**: Direct HTTP requests instead of browser automation
- **10x Faster**: Typical scraping completes in <3 seconds vs 30+ seconds with Puppeteer
- **Lower Resource Usage**: No browser overhead or memory consumption
- **High Reliability**: Simple HTTP requests less prone to timeout or crashes
- **Scalable**: Can easily handle multiple webscraper sources simultaneously

### Output Format
The webscraper produces RSS-compatible output that seamlessly integrates with existing filtering pipeline:
```javascript
scrapedArticle = {
    type: 'article',
    sourceName: 'GE Globo',
    feedName: 'GE Globo',           // RSS compatibility
    title: 'Article headline',
    content: 'Article summary',
    link: 'https://absolute-url',   // Converted to absolute URLs
    pubDate: '2024-06-17T15:30:00.000Z', // Real publication time
    dateTime: '2024-06-17T15:30:00.000Z', // Duplicate for compatibility
    timeText: 'Há 5 minutos',       // Original relative time for reference
    scrapedAt: 1718639400000,       // When article was scraped
    scrapeMethod: 'pagination'      // Method used for scraping
}
```

### Integration with Filtering Pipeline
Webscraper output is fully compatible with all 10 filtering stages:
- **Interval Filtering**: Uses real `pubDate` timestamps for time-based filtering
- **Whitelist Filtering**: Subject to domain/path-based whitelist filtering like RSS content
- **Content Evaluation**: AI processes `title` and `content` fields normally
- **Duplicate Detection**: `link` URLs enable proper deduplication
- **Topic Filtering**: Integrates with importance scoring and topic tracking
- **Priority System**: Respects configured priority level vs Twitter/RSS sources

## Enhanced Whitelist Filtering System

### Overview
The News Monitor implements flexible whitelist filtering that applies to both RSS feeds and webscraper content. The system supports both domain-based (most permissive) and path-based (more restrictive) filtering in the same configuration.

### How It Works

#### Dual Filtering Modes
The whitelist system automatically detects entry types based on content:
- **Domain Entries**: No forward slashes (`/`) → Treats as domain whitelist
- **Path Entries**: Contains forward slashes (`/`) → Treats as URL path whitelist

#### Domain-Based Filtering (Most Permissive)
```javascript
WHITELIST_PATHS: [
    'ge.globo.com',           // Allows ALL content from ge.globo.com
    'globo.com',              // Allows ALL content from globo.com or *.globo.com
]

// Examples that pass:
'https://ge.globo.com/futebol/times/flamengo/noticia/...'    Allowed
'https://ge.globo.com/futebol/copa-do-mundo/...'             Allowed  
'https://ge.globo.com/any/path/...'                          Allowed
'https://esporte.globo.com/futebol/...'                      Allowed (subdomain)
```

#### Path-Based Filtering (More Restrictive)
```javascript
WHITELIST_PATHS: [
    '/mundo/noticia',         // Only allows URLs starting with /mundo/noticia
    '/economia/noticia',      // Only allows URLs starting with /economia/noticia
]

// Examples from g1.globo.com:
'https://g1.globo.com/mundo/noticia/2024/...'                Allowed
'https://g1.globo.com/economia/noticia/2024/...'             Allowed
'https://g1.globo.com/entretenimento/cinema/...'             ❌ Blocked
```

#### Mixed Configuration Example
```javascript
CONTENT_FILTERING: {
    WHITELIST_PATHS: [
        // Domain-based (most permissive)
        'ge.globo.com',           // Allow all GE Globo webscraper content
        // Path-based (more restrictive)  
        '/mundo/noticia',         // Allow only specific G1 RSS paths
        '/economia/noticia',
        '/politica/noticia',
    ]
}
```

### Content Type Support
- **RSS Feeds**: All RSS content subject to whitelist filtering
- **Webscraper Content**: All webscraper content subject to whitelist filtering
- **Twitter Content**: Bypasses whitelist filtering (not applicable to tweets)

### Key Functions (`filteringUtils.js`)
```javascript
// Enhanced whitelist filtering
isItemWhitelisted(item, whitelistPaths)  // Apply domain/path-based filtering

// Logic flow:
// 1. Check domain-based entries first (most permissive)
// 2. Check path-based entries if no domain match
// 3. Block item if no matches found
```

### Benefits
- **Flexible Control**: Mix domain and path-based filtering in same configuration
- **Most Permissive Option**: Domain whitelisting allows all content from trusted sources
- **Granular Control**: Path whitelisting for specific content sections
- **Universal Application**: Works for both RSS feeds and webscraper content
- **Simple Configuration**: Automatic detection based on entry format (presence of `/`)

## Data Flows

### Standard Processing Cycle
```
newsMonitor.js (timer) → Source Fetchers: Twitter + RSS + Webscraper (parallel) → filteringUtils.js (10 stages) → 
  ↓ (stage 9: traditional topic filter)
Source Priority + AI Grouping → Within-Batch Deduplication →
  ↓ (stage 10: enhanced topic filter)
Historical Topic Matching + Importance Scoring → Final Content →
  ↓ (approved content)
contentProcessingUtils.js (summarization) → WhatsApp Distribution → 
  ↓ (if not quiet hours)
Cache Update (no ID field) + Last Run Timestamp Update
```

### Quiet Hours Processing Flow
```
newsMonitor.js (timer) → Source Fetchers (parallel) → Content Captured → 
  ↓ (quiet hours detected)
Processing Skipped (no evaluation/sending) → No Timestamp Update →
  ↓ (after quiet hours end)
First Run Uses Old Timestamp → Evaluates All News Since Last Run (including quiet hours)
```

### Twitter API Key Management Flow
```
twitterApiHandler.js:
Initialize → Load Key States → Check Usage → Select Active Key → 
  ↓ (on 429 error)
Set Cooldown → Switch to Next Key → Continue Processing
  ↓ (periodic maintenance)
Update All Key Usage → Refresh Limits → Clear Expired Cooldowns
```

### Content Evaluation Pipeline
```
Raw Content → filteringUtils.js:
Interval Filter (lastRunTimestamp or CHECK_INTERVAL) → Whitelist Filter → Blacklist Filter →
  ↓ (Twitter media-only content)
Image Text Extraction (step 3.5) →
  ↓ (Twitter short tweets with links)  
Link Content Processing (step 3.6) → Prompt-Specific Filter (step 5; rejects by default on ambiguity) →
  ↓ (RSS content)
Batch Title Evaluation (step 6) → Full Content Evaluation (step 7) → Duplicate Detection (step 8) → 
  ↓ (two-stage topic filtering)
Traditional Topic Redundancy (step 9) → Enhanced Topic Redundancy (step 10) → Approved Content
```

### Enhanced Topic Redundancy Processing
```
News Item → filterByEnhancedTopicRedundancy():
Check Active Topics (entity/keyword matching) → 
  ↓ (if related topic found)
AI Importance Evaluation (1-10 score) → Apply Category Weight → Check Dynamic Threshold →
  ↓ (score ≥ threshold)
Allow as Consequence OR
  ↓ (score ≥ escalation threshold)
Create New Core Event → Update Topic Cache → Send to WhatsApp
  ↓ (score < threshold)
Block as Low-Importance Consequence → Log Decision
```

### Duplicate Detection Process
```
New Content → contentProcessingUtils.js:
Extract Key Features → Compare with Historical Cache → 
  ↓ (if similar found)
Semantic Similarity Analysis (AI) → 
  ↓ (if above threshold)
Reject as Duplicate → Update Cache

Two-Stage Topic Filtering:
Current Batch → Traditional Filter (source priority + AI grouping) → 
  ↓ (deduplicated batch)
Enhanced Filter (historical topics + importance scoring) → Final Content
```

## Configuration Schema

### Source Configuration
```javascript
source = {
    type: 'twitter|rss|webscraper',
    enabled: boolean,
    priority: number,              // 1-10 ranking for content importance
    
    // Twitter-specific
    username: string,
    mediaOnly: boolean,           // Process only tweets with media
    skipEvaluation: boolean,      // Bypass AI content evaluation
    promptSpecific: boolean,      // Use account-specific AI prompts
    
    // RSS-specific  
    url: string,
    language: string,
    name: string,
    
    // Webscraper-specific
    name: string,                 // Display name for the source
    url: string,                  // Base URL to scrape
    paginationPattern: string,    // URL pattern for pagination (e.g., 'page-{page}.ghtml')
    scrapeMethod: string,         // 'pagination' for direct URL pagination
    selectors: {
        container: string,        // Article container selector
        title: string,           // Title selector  
        link: string,            // Link selector
        time: string,            // Time/date selector
        content: string          // Content/summary selector
    },
    userAgent: string            // User agent for requests
}
```

### Content Filtering Configuration
```javascript
CONTENT_FILTERING = {
    BLACKLIST_KEYWORDS: string[],    // Content exclusion terms
    EXCLUDED_PATHS: string[],        // RSS path exclusions
    WHITELIST_PATHS: string[],       // Domain/path inclusions for RSS and webscraper content
    EVALUATION_CHAR_LIMIT: number,   // Content truncation for AI
    SUMMARY_CHAR_LIMIT: number       // Summary length limit
}
```

### Link Processing Configuration for Short Tweets
```javascript
LINK_PROCESSING = {
    ENABLED: boolean,                // Master toggle for link processing
    MIN_CHAR_THRESHOLD: number,      // Process links if non-link text < threshold (default: 25)
    MAX_LINK_CONTENT_CHARS: number,  // Maximum characters to extract from links (default: 3000)
    TIMEOUT: number,                 // Link processing timeout in milliseconds (default: 15000)
    RETRY_ATTEMPTS: number,          // Number of retry attempts on failure (default: 2)
    RETRY_DELAY: number              // Delay between retries in milliseconds (default: 1000)
}
```

### Topic Filtering Configuration
```javascript
TOPIC_FILTERING = {
    ENABLED: boolean,                // Master toggle for importance-based filtering
    USE_IMPORTANCE_SCORING: boolean, // Use AI scoring vs simple counting
    COOLING_HOURS: number,           // Active topic lifespan (default: 48)
    IMPORTANCE_THRESHOLDS: {
        FIRST_CONSEQUENCE: number,   // Score threshold for 1st follow-up (default: 7 - stricter)
        SECOND_CONSEQUENCE: number,  // Score threshold for 2nd follow-up (default: 8 - stricter)
        THIRD_CONSEQUENCE: number,   // Score threshold for 3rd follow-up (default: 10 - stricter)
    },
    CATEGORY_WEIGHTS: {
        ECONOMIC: number,            // Weight multiplier for economic news (default: 0.7 - stricter)
        DIPLOMATIC: number,          // Weight multiplier for diplomatic news (default: 0.9 - stricter)
        MILITARY: number,            // Weight multiplier for military news (default: 1.1 - reduced)
        LEGAL: number,               // Weight multiplier for legal news (default: 1.2 - reduced)
        INTELLIGENCE: number,        // Weight multiplier for intelligence news (default: 1.2 - reduced)
        HUMANITARIAN: number,        // Weight multiplier for humanitarian news (default: 1.0 - reduced)
        POLITICAL: number,           // Weight multiplier for political news (default: 1.0 - reduced)
        SPORTS: number,              // Weight multiplier for sports/soccer news (default: 1.2)
    },
    ESCALATION_THRESHOLD: number,    // Score for promoting to new core event (default: 9.5 - stricter)
    // Legacy fallback settings
    MAX_CONSEQUENCES: number,        // Simple counting limit if AI scoring disabled
    REQUIRE_HIGH_IMPORTANCE_FOR_CONSEQUENCES: boolean
}
```

### Historical Cache Configuration
```javascript
HISTORICAL_CACHE = {
    ENABLED: boolean,
    RETENTION_HOURS: number,         // Cache entry lifespan
    RETENTION_DAYS: number,          // Secondary retention period
    SIMILARITY_THRESHOLD: number,    // Duplicate detection sensitivity (0-1)
    BATCH_SIMILARITY_THRESHOLD: number // Batch comparison threshold
}
```

### Webscraper Configuration
```javascript
WEBSCRAPER = {
    MAX_ITEMS_PER_SOURCE: number,    // Maximum articles per webscraper source (default: 50)
    DEFAULT_TIMEOUT: number,         // HTTP request timeout in milliseconds (default: 15000)
    DEFAULT_RETRY_ATTEMPTS: number,  // Number of retry attempts on failure (default: 2)
}
```
```

### Cache Structure (`newsCache.json`)
```javascript
cache = {
    items: [],                       // Historical content for duplicate detection (no IDs - time filtering prevents duplicates)
    activeTopics: [],                // Active topics for importance-based filtering
    twitterApiStates: {              // Multi-key Twitter API management
        primary: { usage, limit, status, lastSuccessfulCheck },
        fallback1: { usage, limit, status, lastSuccessfulCheck }
        // ... additional keys
    },
    lastRunTimestamp: number|null    // Timestamp of last successful run (excluding quiet hours)
}

// Cache item structure (simplified - no redundant ID field)
cacheItem = {
    type: 'tweet|article',           // Content type
    content: string,                 // AI-generated summary
    timestamp: number,               // When item was cached
    justification: string,           // Why item was relevant
    sourceName: string               // Unified source identifier
}
```

### API Credentials Configuration (`.env`)
Twitter API keys are now loaded dynamically from your environment variables (`.env` file). The system automatically discovers any variable that follows the `TWITTER_{KEY_NAME}_BEARER_TOKEN` pattern.

The `{KEY_NAME}` part (e.g., `PRIMARY`, `FALLBACK1`) is used as the identifier and to determine priority.

**Example `.env` configuration:**
```bash
# in your .env file
TWITTER_PRIMARY_BEARER_TOKEN="your_primary_token_here"
TWITTER_FALLBACK1_BEARER_TOKEN="your_first_fallback_token"
TWITTER_FALLBACK2_BEARER_TOKEN="your_second_fallback_token"
# Add as many keys as you need.
```

This dynamic loading is handled within `newsMonitor.config.js`, removing the need for a static `CREDENTIALS` block for Twitter keys in the configuration file.

## Two-Stage Topic Filtering System

### Overview
The News Monitor implements a sophisticated two-stage filtering approach that handles both within-batch deduplication and historical topic redundancy. This ensures optimal content selection while preventing both immediate duplicates and topic flooding.

### Stage 1: Traditional Topic Redundancy Filter (Step 9)
**Purpose**: Within-batch deduplication with source priority

**Function**: `filterByTopicRedundancy()` in `filteringUtils.js`

**Process**:
1. **AI Topic Grouping**: Uses `DETECT_TOPIC_REDUNDANCY` prompt to identify similar topics in current batch
2. **Source Priority Resolution**: When multiple sources cover same topic, selects highest priority source
3. **Same-Source Selection**: When same source has multiple articles, AI picks most important one
4. **Priority Order**: SITREP_artorias (9) > BreakingNews (8) > G1 (6) > others

**Example**:
```
Current Batch:
1. [SITREP_artorias] Israel bombs Iran
2. [BreakingNews] Israeli attack on Iran  
3. [G1] Ataque israelense ao Irã

AI Groups: "1,2,3" (same topic)
Result: Keep #1 (highest priority), remove #2 and #3
```

### Stage 2: Enhanced Topic Redundancy Filter (Step 10) 
**Purpose**: Topic-based filtering against historical content

**Function**: `filterByEnhancedTopicRedundancy()` in `filteringUtils.js`

**Process**:
1. **Source Priority Pre-filtering**: Applies Stage 1 logic to ensure no same-source duplicates
2. **Historical Topic Matching**: Checks against active topics from past 48 hours
3. **AI Importance Scoring**: Evaluates follow-up stories on 1-10 geopolitical importance scale
4. **Dynamic Thresholds**: Progressive scoring requirements (5→7→9) for consequences
5. **Escalation Detection**: High-scoring items (≥9.5) become new core events; must show novelty beyond the original

### Presidential Baseline Knowledge in Prompts
- Prompts for full-content evaluation and consequence scoring explicitly instruct the model to assume awareness of mainstream headlines and prior briefings.
- In case of any uncertainty about novelty or urgency, the model is told to answer with `null` (do not send) and to keep internal reasoning hidden.

### Benefits of Two-Stage Approach
- **No Redundant IDs**: Time filtering prevents duplicate fetches, eliminating need for ID-based tracking
- **Source Priority Enforcement**: Higher priority sources automatically preferred (SITREP_artorias > BreakingNews > G1)
- **Within-Batch Deduplication**: Similar news in same cycle filtered by source priority and AI selection
- **Historical Context Awareness**: Follow-up stories evaluated against 48-hour topic history
- **Intelligent Consequence Filtering**: Only genuinely important developments pass progressive thresholds
- **Escalation Detection**: Major developments become new topics instead of buried consequences

### Key Functions (`filteringUtils.js`)
```javascript
// Stage 1: Traditional filtering
filterByTopicRedundancy(items, config)           // AI grouping + source priority resolution

// Stage 2: Enhanced filtering  
filterByEnhancedTopicRedundancy(items, config)   // Historical context + importance scoring
```

## Importance-Based Topic Filtering System

### Overview
The News Monitor implements an advanced AI-powered consequence evaluation system that prevents topic redundancy while ensuring genuinely important developments are not missed. Instead of simple numerical limits, the system uses geopolitical importance scoring to determine which follow-up stories merit attention.

### How It Works

#### Core Event Detection
1. **New Topics**: First news about a significant event creates an active topic
2. **Entity Extraction**: Identifies key countries, organizations, and events from content
3. **Topic Tracking**: Maintains active topics for configurable cooling periods (default: 48 hours)

#### Consequence Evaluation Process
1. **Relatedness Check**: Incoming news tested against active topics using entity/keyword matching
2. **AI Importance Scoring**: Related items evaluated on 1-10 scale for geopolitical significance
3. **Category Weighting**: Scores adjusted based on content type (economic, military, legal, etc.)
4. **Dynamic Thresholds**: Different score requirements for 1st, 2nd, 3rd consequences
5. **Escalation Detection**: High-scoring consequences (≥8.5) become new core events

#### Importance Scale (1-10)
- **1-3: Predictable Reactions**: Market responses, standard security measures, routine statements
- **4-6: Moderate Developments**: Specific diplomatic positions, technical details, regional impacts
- **7-8: Important Developments**: New evidence, confirmed escalations, narrative changes
- **9-10: Game-Changing Revelations**: War crimes evidence, secret coordination, major alliance shifts

#### Dynamic Threshold System
```javascript
consequenceThresholds = {
    FIRST_CONSEQUENCE: 7,    // Only significant developments (stricter)
    SECOND_CONSEQUENCE: 8,   // Important revelations only (stricter)
    THIRD_CONSEQUENCE: 10,   // Only absolute game-changers (stricter)
}
```

#### Category Weights
```javascript
categoryMultipliers = {
    ECONOMIC: 0.7,       // Market news heavily penalized (-30%) (stricter)
    DIPLOMATIC: 0.9,     // Diplomatic news penalized (-10%) (stricter)
    MILITARY: 1.1,       // Military developments boosted (+10%) (reduced)
    LEGAL: 0.9,          // War crimes/legal issues boosted (-10%) (reduced)
    INTELLIGENCE: 1.1,   // Intelligence revelations boosted (+10%) (reduced)
    HUMANITARIAN: 0.9,   // Humanitarian issues standard weight (-10%) (reduced)
    POLITICAL: 1.0,      // Political developments standard weight (reduced)
    SPORTS: 1.2          // Soccer news boosted (+20%) due to personal interest
}
```

### Example: Israel-Iran Attack Coverage
| Time | News | AI Score | Category | Weighted Score | Threshold | Action |
|------|------|----------|----------|----------------|-----------|--------|
| 08:04 | Israel bombs Iran | 8.0 | MILITARY | 8.8 (8.0×1.1) | - | **Create Topic** |
| 09:09 | Dollar rises | 3.0 | ECONOMIC | 2.1 (3.0×0.7) | 7.0 | ❌ **Block** (below threshold) |
| 09:09 | Politicians in bunkers | 6.0 | DIPLOMATIC | 5.4 (6.0×0.9) | 7.0 | ❌ **Block** (below threshold) |
| 10:44 | US coordination revealed | 9.0 | INTELLIGENCE | 10.8 (9.0×1.2) | 7.0 | **Allow** (above threshold) |
| 11:30 | Iran announces retaliation | 9.5 | MILITARY | 10.45 (9.5×1.1) | 9.5 | **New Core Event** (escalation) |

### Key Functions (`persistentCache.js`)
```javascript
// Enhanced topic management
checkTopicRedundancyWithImportance(item, justification)  // Main filtering function
evaluateConsequenceImportance(topic, item)              // AI importance scoring
addOrUpdateActiveTopic(item, justification, type)       // Topic lifecycle management
getActiveTopicsStats()                                  // Monitoring and debugging
```

### Benefits
- **Quality over Quantity**: Blocks predictable reactions while preserving important revelations
- **Geopolitical Intelligence**: Recognizes war crimes, secret coordination, alliance shifts
- **Adaptive Thresholds**: Higher standards for later consequences prevent noise accumulation
- **Category Awareness**: Reduces financial news weight, boosts intelligence/legal revelations
- **Escalation Detection**: Major developments become new topics instead of buried consequences

## Quiet Hours Intelligence System

### Overview
The News Monitor also implements intelligent quiet hours handling that ensures no breaking news is missed during silent periods. Instead of simply stopping all processing during quiet hours, the system captures content but defers evaluation and sending until after quiet hours end.

### How It Works

#### During Normal Hours
1. **Content Processing**: Full pipeline execution with filtering, evaluation, and distribution
2. **Timestamp Update**: `lastRunTimestamp` is updated after successful processing
3. **Standard Filtering**: Uses `lastRunTimestamp` as cutoff for interval filtering

#### During Quiet Hours  
1. **Content Capture**: Source fetching continues (Twitter and RSS)
2. **Processing Skip**: Evaluation and sending are bypassed
3. **Timestamp Preservation**: `lastRunTimestamp` remains unchanged from before quiet hours

#### First Run After Quiet Hours
1. **Extended Filtering**: Uses the old `lastRunTimestamp` as cutoff
2. **Comprehensive Evaluation**: Processes all content published during quiet hours + new content
3. **Normal Operation**: Resumes standard processing and timestamp updates

### Key Functions (`persistentCache.js`)
```javascript
// Timestamp management for quiet hours intelligence
getLastRunTimestamp()           // Retrieves last successful run timestamp
updateLastRunTimestamp(timestamp) // Updates timestamp (only during non-quiet hours)
```

### Benefits
- **Zero News Loss**: Breaking news during quiet hours is captured and evaluated
- **No Duplicates**: Content is only sent once, never re-processed
- **Intelligent Timing**: First run after quiet hours includes comprehensive coverage
- **Backward Compatible**: Falls back to CHECK_INTERVAL if no timestamp exists

## External Dependencies

### Twitter API Integration
- **Bearer Token Authentication**: Multiple API keys for high availability
- **API Endpoints**: `/2/users/by/username`, `/2/users/:id/tweets`, `/2/usage/tweets`
- **Rate Limits**: 10,000 requests/month per key, automatic usage monitoring
- **Media Handling**: Image downloads and text extraction capabilities

### RSS Feed Processing
- **Feed Parser**: RSS/Atom feed parsing with full article content extraction
- **Web Scraping**: Cheerio-based HTML parsing for article content
- **Content Extraction**: Title, link, description, publication date processing

### Website Scraping
- **Direct HTTP Requests**: Axios-based content fetching without browser automation
- **CSS Selector Parsing**: Cheerio-based HTML element extraction
- **Pagination Support**: URL pattern-based page traversal
- **Timestamp Processing**: Brazilian Portuguese relative time parsing
- **Content Normalization**: RSS-compatible output format

### OpenAI API Integration
- **Model Usage**: Multiple models optimized for different evaluation tasks
- **Prompt Engineering**: Specialized prompts for content evaluation, summarization, duplicate detection
- **Token Optimization**: Efficient model selection based on task complexity

### WhatsApp Integration
- **`global.client`**: WhatsApp Web.js client for message delivery
- **Media Support**: Image attachment capabilities for Twitter media content
- **Message Formatting**: Rich text formatting with source attribution

#### Event Loop Performance and Media Encoding
- Base64 encoding for WhatsApp images is offloaded to worker threads to avoid blocking the Node.js event loop.
- Files: `newsMonitor/workerBase64.js` (pool) and `newsMonitor/workers/base64Encoder.js` (worker).
- Integration: `newsMonitor/newsMonitor.js` uses `encodeBufferToBase64(...)` when preparing Twitter images.
- Benefit: Reduces event loop latency spikes on low-core VPS environments.

## Internal Dependencies

### Configuration Dependencies
- **`../configs`**: Core bot configuration and whitelist management
- **`../utils/logger`**: Centralized logging system for monitoring and debugging
- **`process.env`**: Environment variable access for API credentials

### Cross-Module Dependencies
- **`newsMonitor.js`** ← imports ← All fetcher and processing modules
- **`twitterFetcher.js`** ← imports ← `twitterApiHandler.js`
- **`filteringUtils.js`** ← imports ← `evaluationUtils.js`, `contentProcessingUtils.js`
- **`newsMonitor.config.js`** ← imports ← `newsMonitor.prompt.js`

### Cache System Dependencies
- **`persistentCache.js`**: Historical content storage for duplicate detection and last run timestamp management
- **File System**: JSON file-based persistence for API key states, content cache, and run timestamps
- **Memory Management**: In-memory caching with periodic cleanup
- **Timestamp Management**: Last run tracking for quiet hours intelligence

### Data Sharing Patterns
- **Unified Configuration**: Single source of truth for all source and processing settings
- **Shared API Handler**: Centralized Twitter API key management across all Twitter operations
- **Content Pipeline**: Sequential processing stages with standardized content object format
- **Cache Coordination**: Shared duplicate detection cache across all content sources