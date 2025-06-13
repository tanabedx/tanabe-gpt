# News Monitor System Documentation

## Overview
Automated news monitoring and distribution system for WhatsApp bot with multi-source content fetching, intelligent filtering pipeline, AI-powered content evaluation, and duplicate detection across Twitter and RSS feeds.

## Core Features
- **Multi-Source Fetching**: Twitter and RSS content with intelligent rate limiting and API key management
- **Smart Content Processing**: Link extraction for short tweets with priority-based processing (images → links → original text)
- **Advanced Filtering Pipeline**: 10-stage content evaluation from interval filtering to enhanced topic redundancy detection
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
1. **Source Fetching** → `twitterFetcher.js` + `rssFetcher.js` (parallel execution)
2. **Filtering Pipeline** → `filteringUtils.js` (10-stage evaluation process)
3. **AI Evaluation** → `evaluationUtils.js` (content relevance and summarization)
4. **Duplicate Detection** → `contentProcessingUtils.js` (semantic similarity analysis)
5. **Message Distribution** → WhatsApp integration with media support

## File Structure & Roles

### Core Orchestration
- **`newsMonitor.js`**: Main pipeline orchestrator, cycle management, unified processing coordination
- **`newsMonitor.config.js`**: Master configuration for sources, AI models, filtering rules, credentials

### Content Fetching Layer
- **`twitterFetcher.js`**: Twitter content retrieval, media handling, account-specific filtering
- **`rssFetcher.js`**: RSS feed processing, article extraction, full content scraping
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
    }
]
```

### Filtering Pipeline (`filteringUtils.js`)
```javascript
filteringStages = [
    'intervalFilter',        // Last run timestamp or content age validation
    'whitelistFilter',       // RSS path-based filtering
    'blacklistFilter',       // Keyword exclusion
    'imageTextExtraction',   // OCR for media-only content (step 3.5)
    'linkContentProcessing', // Link extraction for short tweets (step 3.6)
    'promptSpecificFilter',  // Account-specific AI evaluation (step 5)
    'batchTitleEvaluation', // RSS title relevance - batch (step 6)
    'fullContentEvaluation', // Complete AI content analysis (step 7)
    'duplicateDetection',    // Semantic similarity check (step 8)
    'enhancedTopicRedundancy' // Importance-based topic filtering with consequence evaluation (step 9)
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
```javascript
AI_MODELS = {
    EVALUATE_CONTENT: 'o4-mini',           // Content relevance assessment
    BATCH_EVALUATE_TITLES: 'gpt-4o',      // RSS title batch processing
    SUMMARIZE_CONTENT: 'gpt-4o-mini',     // Article summarization
    DETECT_DUPLICATE: 'gpt-4o',           // Semantic similarity analysis
    DETECT_TOPIC_REDUNDANCY: 'gpt-4o',    // Basic topic clustering (legacy)
    DETECT_STORY_DEVELOPMENT: 'gpt-4o',   // Story type classification (core/consequence/development)
    EVALUATE_CONSEQUENCE_IMPORTANCE: 'gpt-4o', // AI importance scoring for consequences
    PROCESS_IMAGE_TEXT_EXTRACTION: 'gpt-4o-mini' // OCR processing
}
```

### Importance-Based Topic Filtering (`persistentCache.js`, `filteringUtils.js`)
```javascript
TOPIC_FILTERING = {
    ENABLED: true,
    USE_IMPORTANCE_SCORING: true,        // Enable AI importance evaluation
    COOLING_HOURS: 48,                   // How long to track related stories
    IMPORTANCE_THRESHOLDS: {
        FIRST_CONSEQUENCE: 5,            // 1st follow-up needs score ≥5
        SECOND_CONSEQUENCE: 7,           // 2nd follow-up needs score ≥7
        THIRD_CONSEQUENCE: 9,            // 3rd follow-up needs score ≥9
    },
    CATEGORY_WEIGHTS: {
        ECONOMIC: 0.8,                   // Market reactions get reduced weight
        DIPLOMATIC: 1.0,                 // Diplomatic news normal weight
        MILITARY: 1.2,                   // Military developments boosted
        LEGAL: 1.3,                      // Legal implications boosted
        INTELLIGENCE: 1.3,               // Intelligence revelations boosted
        HUMANITARIAN: 1.1,               // Humanitarian impacts slightly boosted
        POLITICAL: 1.1,                  // Political developments slightly boosted
    },
    ESCALATION_THRESHOLD: 8.5,           // Score ≥8.5 becomes new core event
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

## Data Flows

### Standard Processing Cycle
```
newsMonitor.js (timer) → Source Fetchers (parallel) → filteringUtils.js (9 stages) → 
  ↓ (approved content)
contentProcessingUtils.js (summarization) → WhatsApp Distribution → 
  ↓ (if not quiet hours)
Cache Update + Last Run Timestamp Update
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
Link Content Processing (step 3.6) → Prompt-Specific Filter (step 5) →
  ↓ (RSS content)
Batch Title Evaluation (step 6) → Full Content Evaluation (step 7) → Duplicate Detection (step 8) → Enhanced Topic Redundancy (step 9) → Approved Content
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
Reject as Duplicate OR Select Best Version → Update Cache
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
    selectorConfig: {
        articleSelector: string,
        titleSelector: string,
        linkSelector: string
    }
}
```

### Content Filtering Configuration
```javascript
CONTENT_FILTERING = {
    BLACKLIST_KEYWORDS: string[],    // Content exclusion terms
    EXCLUDED_PATHS: string[],        // RSS path exclusions
    WHITELIST_PATHS: string[],       // RSS path inclusions
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
        FIRST_CONSEQUENCE: number,   // Score threshold for 1st follow-up (default: 5)
        SECOND_CONSEQUENCE: number,  // Score threshold for 2nd follow-up (default: 7)
        THIRD_CONSEQUENCE: number,   // Score threshold for 3rd follow-up (default: 9)
    },
    CATEGORY_WEIGHTS: {
        ECONOMIC: number,            // Weight multiplier for economic news (default: 0.8)
        DIPLOMATIC: number,          // Weight multiplier for diplomatic news (default: 1.0)
        MILITARY: number,            // Weight multiplier for military news (default: 1.2)
        LEGAL: number,               // Weight multiplier for legal news (default: 1.3)
        INTELLIGENCE: number,        // Weight multiplier for intelligence news (default: 1.3)
        HUMANITARIAN: number,        // Weight multiplier for humanitarian news (default: 1.1)
        POLITICAL: number,           // Weight multiplier for political news (default: 1.1)
    },
    ESCALATION_THRESHOLD: number,    // Score for promoting to new core event (default: 8.5)
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

### Cache Structure (`newsCache.json`)
```javascript
cache = {
    items: [],                       // Historical content for duplicate detection
    activeTopics: [],                // Active topics for importance-based filtering
    twitterApiStates: {              // Multi-key Twitter API management
        primary: { usage, limit, status, lastSuccessfulCheck },
        fallback1: { usage, limit, status, lastSuccessfulCheck }
        // ... additional keys
    },
    lastRunTimestamp: number|null    // Timestamp of last successful run (excluding quiet hours)
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
    FIRST_CONSEQUENCE: 5,    // Market reactions blocked (score 3-4 typical)
    SECOND_CONSEQUENCE: 7,   // Standard responses blocked (score 4-6 typical)  
    THIRD_CONSEQUENCE: 9,    // Only major revelations (score 9-10)
}
```

#### Category Weights
```javascript
categoryMultipliers = {
    ECONOMIC: 0.8,       // Market news penalized (-20%)
    INTELLIGENCE: 1.3,   // Intelligence revelations boosted (+30%)
    LEGAL: 1.3,          // War crimes/legal issues boosted (+30%)
    MILITARY: 1.2,       // Military developments boosted (+20%)
    DIPLOMATIC: 1.0,     // Standard weight
    HUMANITARIAN: 1.1,   // Humanitarian issues slightly boosted (+10%)
    POLITICAL: 1.1       // Political developments slightly boosted (+10%)
}
```

### Example: Israel-Iran Attack Coverage
| Time | News | AI Score | Category | Weighted Score | Threshold | Action |
|------|------|----------|----------|----------------|-----------|--------|
| 08:04 | Israel bombs Iran | 8.0 | MILITARY | 9.6 (8.0×1.2) | - | ✅ **Create Topic** |
| 09:09 | Dollar rises | 3.0 | ECONOMIC | 2.4 (3.0×0.8) | 5.0 | ❌ **Block** (below threshold) |
| 09:09 | Politicians in bunkers | 4.0 | DIPLOMATIC | 4.0 (4.0×1.0) | 5.0 | ❌ **Block** (below threshold) |
| 10:44 | US coordination revealed | 9.0 | INTELLIGENCE | 11.7 (9.0×1.3) | 5.0 | ✅ **Allow** (above threshold) |
| 11:30 | Iran announces retaliation | 9.5 | MILITARY | 11.4 (9.5×1.2) | 8.5 | ✅ **New Core Event** (escalation) |

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

### OpenAI API Integration
- **Model Usage**: Multiple models optimized for different evaluation tasks
- **Prompt Engineering**: Specialized prompts for content evaluation, summarization, duplicate detection
- **Token Optimization**: Efficient model selection based on task complexity

### WhatsApp Integration
- **`global.client`**: WhatsApp Web.js client for message delivery
- **Media Support**: Image attachment capabilities for Twitter media content
- **Message Formatting**: Rich text formatting with source attribution

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