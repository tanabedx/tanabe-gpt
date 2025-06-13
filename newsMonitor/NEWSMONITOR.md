# News Monitor System Documentation

## Overview
Automated news monitoring and distribution system for WhatsApp bot with multi-source content fetching, intelligent filtering pipeline, AI-powered content evaluation, and duplicate detection across Twitter and RSS feeds.

## Core Features
- **Multi-Source Fetching**: Twitter and RSS content with intelligent rate limiting and API key management
- **Advanced Filtering Pipeline**: 9-stage content evaluation from interval filtering to topic redundancy detection
- **AI Content Evaluation**: Relevance assessment, summarization, and semantic duplicate detection
- **Dynamic API Management**: Multi-key Twitter API system with automatic failover and usage monitoring

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
2. **Filtering Pipeline** → `filteringUtils.js` (9-stage evaluation process)
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
        priority: number          // Content priority ranking
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
    'intervalFilter',        // Content age validation
    'whitelistFilter',       // RSS path-based filtering
    'blacklistFilter',       // Keyword exclusion
    'promptSpecificFilter',  // Account-specific AI evaluation
    'batchTitleEvaluation', // RSS title relevance (batch)
    'fullContentEvaluation', // Complete AI content analysis
    'imageTextExtraction',   // OCR for media-only content
    'duplicateDetection',    // Semantic similarity check
    'topicRedundancy'       // Topic clustering and selection
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
    DETECT_TOPIC_REDUNDANCY: 'gpt-4o',    // Topic clustering
    PROCESS_IMAGE_TEXT_EXTRACTION: 'gpt-4o-mini' // OCR processing
}
```

## Data Flows

### Standard Processing Cycle
```
newsMonitor.js (timer) → Source Fetchers (parallel) → filteringUtils.js (9 stages) → 
  ↓ (approved content)
contentProcessingUtils.js (summarization) → WhatsApp Distribution → Cache Update
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
Interval Filter → Whitelist Filter → Blacklist Filter → Prompt-Specific Filter →
  ↓ (RSS content)
Batch Title Evaluation → Full Content Evaluation →
  ↓ (Twitter media-only)
Image Text Extraction → Duplicate Detection → Topic Redundancy → Approved Content
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
- **`persistentCache.js`**: Historical content storage for duplicate detection
- **File System**: JSON file-based persistence for API key states and content cache
- **Memory Management**: In-memory caching with periodic cleanup

### Data Sharing Patterns
- **Unified Configuration**: Single source of truth for all source and processing settings
- **Shared API Handler**: Centralized Twitter API key management across all Twitter operations
- **Content Pipeline**: Sequential processing stages with standardized content object format
- **Cache Coordination**: Shared duplicate detection cache across all content sources