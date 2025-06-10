# News Monitor System Documentation

This folder contains the complete automated news monitoring and distribution system for the WhatsApp bot, including multi-source content fetching, intelligent filtering, and AI-powered content evaluation.

## 🏗️ Architecture Overview

The news monitor system is built with a sophisticated multi-stage architecture that provides:
- **Multi-source content fetching** from Twitter and RSS feeds with intelligent rate limiting
- **Advanced filtering pipeline** with multiple evaluation stages and AI-powered relevance detection
- **Intelligent duplicate detection** using AI-based content similarity analysis
- **Dynamic API key management** with automatic failover and cooldown handling
- **Real-time content processing** with image text extraction and translation capabilities
- **Topic redundancy filtering** to prevent spam and ensure content diversity

## 📁 File Structure

```
newsMonitor/
├── NEWSMONITOR.md                # This documentation file
├── newsMonitor.js                # Main orchestrator and processing pipeline
├── newsMonitor.config.js         # Master configuration for all sources and settings
├── newsMonitor.prompt.js         # AI prompts for content evaluation and processing
├── twitterApiHandler.js          # Twitter API key management and rate limiting
├── twitterFetcher.js             # Twitter content fetching and formatting
├── rssFetcher.js                 # RSS feed fetching and content extraction
├── contentProcessingUtils.js     # Content summarization and duplicate detection
├── evaluationUtils.js            # AI-powered content relevance evaluation
├── filteringUtils.js             # Content filtering and redundancy detection
└── debugReportUtils.js          # Debug reporting and cycle analysis
```

## 🚀 Core Features

### 1. Multi-Source Content Fetching
- **Twitter Integration** - Real-time tweet fetching with media support and account-specific filtering
- **RSS Feed Processing** - Automatic article extraction with full content scraping
- **Dynamic Source Management** - Configurable sources with individual settings and priorities
- **Rate Limiting** - Intelligent API usage management with automatic cooldown handling

### 2. Advanced Filtering Pipeline 🔍
The system applies content through multiple filtering stages:

1. **Interval Filtering** - Removes content older than the check interval
2. **Whitelist Filtering** - RSS path-based filtering for specific content categories
3. **Blacklist Keyword Filtering** - Excludes content with unwanted keywords
4. **Account-Specific Filtering** - Custom AI prompts for specific Twitter accounts
5. **Batch Title Evaluation** - AI-powered RSS title relevance assessment
6. **Full Content Evaluation** - Comprehensive AI analysis of complete content
7. **Image Text Extraction** - OCR processing for media-only tweets
8. **Duplicate Detection** - AI-based similarity analysis against historical cache
9. **Topic Redundancy Filtering** - Prevents multiple items on the same topic

### 3. AI-Powered Content Evaluation 🤖
- **Relevance Assessment** - Determines if content is worthy of presidential briefing
- **Content Summarization** - Generates concise 3-point summaries with translation
- **Duplicate Detection** - Semantic analysis to prevent content repetition
- **Topic Clustering** - Groups similar content and selects best representative

### 4. Twitter API Management 🔑
- **Multi-Key Support** - Automatic failover between multiple API keys
- **Usage Monitoring** - Real-time tracking of monthly API limits
- **Cooldown Management** - Handles both usage and content API rate limits
- **Persistent State** - Saves API key states across bot restarts
- **Unified Session Management** - Coordinated usage and content API calls to prevent conflicts
- **Dynamic Key Selection** - Intelligent switching based on availability, usage, and cooldown status

### 5. Content Processing & Distribution 📤
- **Smart Summarization** - AI-generated summaries with automatic translation
- **Media Handling** - Image attachment and text extraction capabilities
- **WhatsApp Integration** - Formatted message delivery with media support
- **Cache Management** - Historical content storage for duplicate prevention

## ⚙️ Configuration

### Source Configuration
```javascript
sources: [
    {
        type: 'twitter',
        enabled: true,
        username: 'BreakingNews',
        mediaOnly: false,
        skipEvaluation: false,
        promptSpecific: false,
        priority: 8,
    },
    {
        type: 'rss',
        enabled: true,
        id: 'g1',
        name: 'G1',
        url: 'https://g1.globo.com/rss/g1/',
        priority: 6,
    }
]
```

### AI Model Selection
```javascript
AI_MODELS: {
    EVALUATE_CONTENT: 'o4-mini',
    BATCH_EVALUATE_TITLES: 'gpt-4o',
    SUMMARIZE_CONTENT: 'gpt-4o-mini',
    DETECT_DUPLICATE: 'gpt-4o',
    DETECT_TOPIC_REDUNDANCY: 'gpt-4o',
    DEFAULT: 'gpt-4o-mini'
}
```

### Content Filtering Rules
```javascript
CONTENT_FILTERING: {
    BLACKLIST_KEYWORDS: ['VÍDEO:', 'VÍDEOS:', 'Assista'],
    WHITELIST_PATHS: ['/mundo/noticia', '/economia/noticia'],
    EVALUATION_CHAR_LIMIT: 2000
}
```

## 🎯 Usage Examples

### Basic Operation
The news monitor runs automatically every 16 minutes, processing all configured sources through the complete filtering pipeline.

### Debug Report Generation
```javascript
// Generate detailed cycle analysis
const report = await generateNewsCycleDebugReport();
console.log(report);
```

### Manual Restart
```javascript
// Restart specific monitors
await restartMonitors(true, true); // Twitter and RSS
```

### Configuration Updates
```javascript
// Modify sources in newsMonitor.config.js
// System automatically picks up changes on next cycle
```

## 🔧 Technical Implementation

### Processing Pipeline Flow
1. **Initialization** → `newsMonitor.js`
2. **Source Fetching** → `twitterFetcher.js` + `rssFetcher.js`
3. **Content Filtering** → `filteringUtils.js` + `evaluationUtils.js`
4. **Content Processing** → `contentProcessingUtils.js`
5. **Message Generation** → AI summarization and formatting
6. **Distribution** → WhatsApp message delivery
7. **Cache Update** → Historical storage for future duplicate detection

### Twitter API Key Management Flow
1. **Initialization** → Load and validate multiple API keys
2. **Usage Monitoring** → Periodic API usage checks
3. **Rate Limit Handling** → Automatic cooldown and key switching
4. **Persistent Storage** → Save key states across restarts
5. **Error Recovery** → Automatic failover to backup keys

### Content Evaluation Process
1. **Content Extraction** → Raw text/media processing
2. **Relevance Analysis** → AI-powered importance assessment
3. **Duplicate Check** → Semantic similarity against cache
4. **Summarization** → AI-generated concise summaries
5. **Translation** → Automatic Portuguese translation when needed

## 🔑 Twitter API Key Management

The news monitor system implements a sophisticated multi-key Twitter API management system that provides automatic failover, intelligent usage monitoring, and persistent state management across bot restarts.

### Key Management Architecture

#### 1. Multi-Key Configuration
```javascript
CREDENTIALS: {
    TWITTER_API_KEYS: {
        primary: { bearer_token: process.env.TWITTER_PRIMARY_BEARER_TOKEN },
        fallback1: { bearer_token: process.env.TWITTER_FALLBACK_BEARER_TOKEN },
        fallback2: { bearer_token: process.env.TWITTER_FALLBACK2_BEARER_TOKEN },
        fallback3: { bearer_token: process.env.TWITTER_FALLBACK3_BEARER_TOKEN },
        fallback4: { bearer_token: process.env.TWITTER_FALLBACK4_BEARER_TOKEN },
    }
}
```

#### 2. Key State Management
Each API key maintains comprehensive state information:

```javascript
keyState = {
    name: 'primary',                           // Key identifier
    bearer_token: 'Bearer_Token_Here',         // API credentials
    usage: 1250,                              // Current monthly usage
    limit: 10000,                             // Monthly usage limit
    capResetDay: 15,                          // Day of month when usage resets
    unifiedCooldownUntil: null,               // Timestamp when cooldown expires
    lastSuccessfulCheckTimestamp: 1640995200, // Last successful API call
    status: 'ok'                              // Current status: 'ok', 'error', 'unified_api_cooldown', 'unchecked'
}
```

### Core Management Functions

#### 1. Initialization Process (`initialize`)
**Purpose**: Bootstrap the API key management system with intelligent cooldown handling

**Process Flow**:
1. **Config Loading** → Load all configured API keys from environment variables
2. **State Restoration** → Restore persistent state from cache (usage, cooldowns, limits)
3. **Cooldown Check** → Wait for any existing cooldowns to expire before first attempt
4. **Usage Validation** → Attempt to fetch current usage for all keys
5. **Key Selection** → Select the best available key as active
6. **Retry Logic** → Dynamic retry with intelligent delay calculation

**Retry Strategy**:
- Uses dynamic delays based on cooldown end times
- Waits for earliest key availability rather than fixed intervals
- Maximum 3 attempts with up to 20-minute delays
- Fails gracefully if all keys are truly exhausted

#### 2. Key Selection Logic (`_selectActiveKey`)
**Purpose**: Intelligently choose the best available API key based on multiple criteria

**Selection Priority** (in order):
1. **Error Status** → Skip keys with `status: 'error'`
2. **Monthly Cap** → Skip keys where `usage >= limit`
3. **Active Cooldown** → Skip keys with `unifiedCooldownUntil > now`
4. **Configuration Order** → Select first available key from config order

**Dynamic Switching**:
- Automatically switches when current key becomes unavailable
- Logs key switches for monitoring
- Sets `currentKeyName = null` when no keys available

#### 3. Usage Monitoring (`_fetchKeyUsageFromApi`)
**Purpose**: Track monthly API usage and detect limit approaching

**API Endpoint**: `https://api.twitter.com/2/usage/tweets`
**Response Data**:
- `project_usage` → Current month's API calls used
- `project_cap` → Monthly limit for this key
- `cap_reset_day` → Day of month when usage resets

**Error Handling**:
- **429 Rate Limit** → Sets unified cooldown (16 minutes default)
- **Other Errors** → Marks key as error status, preserves old usage data
- **Success** → Updates usage, clears cooldowns, saves state

#### 4. Unified Session Management (`performUnifiedApiSession`)
**Purpose**: Coordinate usage and content API calls to prevent individual cooldowns

**Key Innovation**: Calls both APIs simultaneously to prevent timing conflicts

**Process**:
1. **Parallel Execution** → Calls usage and content APIs with `Promise.allSettled`
2. **429 Detection** → Monitors both calls for rate limit responses
3. **Unified Cooldown** → Sets single cooldown affecting both APIs if either hits 429
4. **Header Parsing** → Uses `x-rate-limit-reset` for precise cooldown timing
5. **State Persistence** → Saves all state changes immediately

**Benefits**:
- Prevents API call timing conflicts
- Ensures consistent cooldown handling
- Maximizes API efficiency

#### 5. Error Handling & Recovery (`handleRequestOutcome`)
**Purpose**: Process results from actual Twitter content fetching requests

**Handles Three Scenarios**:

1. **429 Rate Limit**:
   - Extracts reset time from `x-rate-limit-reset` header
   - Sets unified cooldown for the affected key
   - Triggers automatic key switching
   - Logs cooldown duration for monitoring

2. **Other Errors**:
   - Marks key with `status: 'error'`
   - Triggers immediate key switching
   - Preserves error details for debugging

3. **Success**:
   - No immediate action (usage updates handled by periodic checks)
   - Maintains key availability

### Advanced Features

#### 1. Persistent State Management
**Cache Storage**: All key states persist across bot restarts
**Saved Data**:
- Usage counts and limits
- Cooldown timestamps
- Last successful check times
- Error states and status

**Benefits**:
- No usage rechecking on restart
- Preserves cooldown timings
- Maintains API efficiency

#### 2. Intelligent Cooldown Handling
**Unified Cooldown System**:
- Single cooldown affects all API endpoints for a key
- Prevents partial availability confusion
- Eliminates timing conflicts between usage and content APIs

**Dynamic Waiting**:
- Calculates exact wait times from headers
- Uses earliest available key for retry timing
- Minimizes unnecessary delays

#### 3. Monitoring & Logging
**Comprehensive Logging**:
```
Key primary state: Status=ok, Usage=1250/10000, MonthlyResetDay=15, LastGoodCheck=10:30:45
Key fallback1 state: Status=unified_api_cooldown, Usage=8500/10000, UnifiedAPIEndpointCooldown for 12 minutes
```

**Status Indicators**:
- Real-time usage tracking with reset date calculation
- Cooldown timing with minute precision
- Error status with reason tracking
- Key switching notifications

#### 4. Periodic Maintenance (`periodicCheck`)
**Purpose**: Regular health checks and state updates

**Schedule**: Called by main news monitor cycle
**Actions**:
- Updates usage for all non-cooling keys
- Refreshes monthly limits and reset dates
- Clears expired cooldowns
- Maintains accurate key availability

### Configuration Examples

#### Basic Multi-Key Setup
```javascript
TWITTER_API_KEYS: {
    primary: { bearer_token: process.env.TWITTER_PRIMARY },
    backup: { bearer_token: process.env.TWITTER_BACKUP }
}
```

#### Production Setup (5 Keys)
```javascript
TWITTER_API_KEYS: {
    primary: { bearer_token: process.env.TWITTER_PRIMARY_BEARER_TOKEN },
    fallback1: { bearer_token: process.env.TWITTER_FALLBACK_BEARER_TOKEN },
    fallback2: { bearer_token: process.env.TWITTER_FALLBACK2_BEARER_TOKEN },
    fallback3: { bearer_token: process.env.TWITTER_FALLBACK3_BEARER_TOKEN },
    fallback4: { bearer_token: process.env.TWITTER_FALLBACK4_BEARER_TOKEN }
}
```

### Monitoring Commands

#### Debug API Key States
```javascript
// Get current active key
const currentKey = twitterApiHandler.getCurrentKey();

// Get all key states (for debugging)
const allStates = twitterApiHandler._getApiKeyStates();

// Force usage check
await twitterApiHandler.periodicCheck();
```

### Error Scenarios & Recovery

#### 1. All Keys Hit Monthly Limits
**Detection**: All keys show `usage >= limit`
**Behavior**: System waits until next monthly reset
**Recovery**: Automatic on reset day based on `capResetDay`

#### 2. All Keys on Cooldown
**Detection**: All keys have `unifiedCooldownUntil > now`
**Behavior**: System waits for earliest cooldown expiry
**Recovery**: Automatic key switching when cooldown expires

#### 3. API Key Revoked/Invalid
**Detection**: Authentication errors from API calls
**Behavior**: Mark key as `status: 'error'`, switch to backup
**Recovery**: Manual key replacement in environment variables

#### 4. Twitter API Outage
**Detection**: Connection errors, timeouts, 5xx responses
**Behavior**: Preserve existing usage data, retry with backoff
**Recovery**: Automatic when Twitter API becomes available

### Performance Optimization

#### 1. Usage API Efficiency
- Batch updates during periodic checks
- Skip usage calls for cooling keys
- Cache results to minimize API calls

#### 2. Smart Initialization
- Wait for cached cooldowns on startup
- Dynamic retry delays based on key availability
- Parallel key validation when possible

#### 3. Memory Management
- Lightweight key state objects
- Efficient state persistence
- Minimal logging overhead

This robust API key management system ensures maximum Twitter API availability while respecting all rate limits and providing comprehensive monitoring and automatic recovery capabilities.

## 🛡️ Safety & Limits

### Rate Limiting
- **Twitter API**: Automatic usage monitoring and cooldown management
- **OpenAI API**: Intelligent prompt batching and model selection
- **Content Processing**: Configurable character limits for evaluation

### Error Handling
- **Graceful degradation** when sources are unavailable
- **Automatic failover** between multiple Twitter API keys
- **Content validation** to prevent malformed messages
- **Persistent error logging** for debugging and monitoring

### Content Safety
- **Blacklist filtering** for unwanted content types
- **Whitelist enforcement** for trusted content sources
- **AI content validation** before distribution
- **Historical duplicate prevention** to avoid spam

## 🚨 Troubleshooting

### Common Issues

1. **Twitter API Limits Exceeded**
   - Check API key usage in logs
   - Verify multiple backup keys are configured
   - Review monthly usage caps and reset dates

2. **No Content Being Fetched**
   - Verify source configurations are enabled
   - Check API key validity and permissions
   - Review filtering criteria for over-restrictive rules

3. **Content Not Being Sent**
   - Ensure target WhatsApp group is configured correctly
   - Check AI evaluation prompts for appropriate criteria
   - Verify bot has permissions to send to target group

4. **Duplicate Content Issues**
   - Check historical cache file integrity
   - Review duplicate detection prompt effectiveness
   - Verify cache retention settings

### Debug Information
Enable debug logging to see detailed information about:
- API key rotation and usage tracking
- Content filtering at each pipeline stage
- AI evaluation decisions and justifications
- Cache operations and duplicate detection logic

### Log Analysis
Monitor these key log patterns:
- `NM: Interval Filter:` - Content age filtering results
- `NM: Full Content Evaluation:` - AI relevance decisions
- `Key [name] state:` - Twitter API key status updates
- `NM: Sending to group` - Successful content distribution

## 📈 Performance Optimization

### Best Practices
- **Efficient API usage** - Batch operations and intelligent caching
- **Smart content filtering** - Early elimination of irrelevant content
- **Optimized AI calls** - Appropriate model selection for each task
- **Memory management** - Regular cache cleanup and size limits

### Monitoring Metrics
- API call frequency and success rates
- Content filtering effectiveness at each stage
- AI evaluation accuracy and processing time
- Message delivery success rates

### Scaling Considerations
- **API Key Pool Management** - Add more keys for higher throughput
- **Content Source Expansion** - Balance sources with processing capacity
- **Cache Optimization** - Tune retention periods for optimal performance
- **AI Model Selection** - Use appropriate models for cost/quality balance

## 🔄 Maintenance

### Regular Tasks
- **API Key Monitoring** - Track usage and renew before limits
- **Cache Management** - Monitor size and cleanup old entries
- **Content Quality Review** - Validate AI filtering effectiveness
- **Performance Analysis** - Review processing times and bottlenecks

### Configuration Updates
- **Source Management** - Add/remove/modify content sources
- **Filtering Tuning** - Adjust criteria based on content quality
- **AI Prompt Optimization** - Refine prompts for better accuracy
- **Rate Limit Adjustment** - Optimize for cost vs. freshness

## 🤝 Contributing

When modifying the news monitor system:
1. **Test thoroughly** with various content scenarios and edge cases
2. **Document changes** in this README and relevant code comments
3. **Update configurations** if new parameters are introduced
4. **Consider performance** implications of filtering changes
5. **Maintain backwards compatibility** with existing cache structures
6. **Validate AI prompts** with diverse content samples before deployment

This news monitoring system provides a comprehensive, intelligent, and scalable solution for automated content curation and distribution, making it one of the most sophisticated news aggregation bots available for WhatsApp integration. 