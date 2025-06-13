# Ayub News System Documentation

## Overview
Comprehensive news aggregation and summarization system for WhatsApp bot providing multi-source news scraping, link summarization, search capabilities, and AI-powered content translation. Features automatic link processing for specific users and multiple news source integration.

## Core Features
- **Multi-Source News Aggregation**: Scraping from newsminimalist.com, ge.globo.com, and Google News RSS
- **Automatic Link Summarization**: Context-aware link processing for admin and specific users
- **News Search & Translation**: Query-based news search with AI-powered Portuguese translation
- **Specialized Content**: Dedicated football news scraping and formatting
- **Sticker Integration**: News delivery via WhatsApp sticker interaction

## Usage Examples
```javascript
// General news commands
#ayubnews                    // Get latest news summary
#news                        // Alternative prefix for news
#noticias                    // Portuguese news command

// Search-specific news
#ayubnews economia           // Search for economics news
#ayub news tecnologia        // Search for technology news

// Specialized content
#ayubnews fut               // Get football news from ge.globo.com
#ayub news fut              // Alternative football news command

// Automatic link processing
// Admin in DM: Any link → automatic summary
// Specific user in GROUP_LF: Any link → automatic summary

// Sticker interaction
// Send configured news sticker → latest news summary
```

## Architecture Overview

### Core Design Pattern
Multi-handler command system with context-aware processing, source-specific scraping strategies, and conditional automatic link processing. Uses AI translation pipeline for content localization and specialized scrapers for different news sources.

### Processing Flow
1. **Command Detection** → `ayub.js` (prefix matching and input parsing)
2. **Context Analysis** → User/group validation for automatic link processing
3. **Source Selection** → News scraper selection based on command type
4. **Content Processing** → AI translation and summarization pipeline
5. **Response Formatting** → Structured news delivery with source attribution
6. **Auto-Delete Management** → Message lifecycle handling

## File Structure & Roles

### Core Processing Files
- **`ayub.js`**: Main command dispatcher, link detection, user context validation, response coordination
- **`newsUtils.js`**: News scraping utilities, translation services, content processing
- **`ayub.config.js`**: Command configurations, user permissions, error messages

### Command Categories
- **General News**: `handleAyubNewsSticker` (latest news aggregation)
- **Search News**: `handleAyubNewsSearch` (query-based news retrieval)
- **Football News**: `handleAyubNewsFut` (specialized sports content)
- **Link Processing**: `handleAyubLinkSummary` (automatic link summarization)

### News Source Integrations
- **NewsMinimalist**: Puppeteer-based scraping for curated news
- **GE Globo**: Cheerio-based football news extraction
- **Google News**: RSS-based search with relative time processing

## Core Components

### User Context Validation (`ayub.js`)
```javascript
// Conditional automatic link processing
contextValidation = {
    adminInDM: {
        condition: contactNumber === adminNumber && chat.isGroup === false,
        behavior: 'automatic_link_summary'
    },
    specificUserInGroup: {
        condition: chat.name === GROUP_LF && contact.name === MEMBER_LF10,
        behavior: 'automatic_link_summary'
    },
    fallback: 'no_automatic_processing'
}
```

### News Scraping System (`newsUtils.js`)
```javascript
// Multi-source news aggregation
newsScrapingStrategies = {
    newsMinimalist: {
        method: 'puppeteer',
        url: 'https://www.newsminimalist.com/',
        selectors: ['div.mr-auto'],
        contentLimit: 5,
        features: ['headless_browser', 'resource_blocking']
    },
    geGlobo: {
        method: 'cheerio',
        url: 'https://ge.globo.com/futebol/',
        selectors: ['.feed-post-body'],
        extractionFields: ['title', 'summary', 'link']
    },
    googleNews: {
        method: 'rss_xml',
        urlPattern: 'https://news.google.com/rss/search?q={query}&hl=pt-BR',
        parsing: 'xml_regex',
        features: ['relative_time', 'source_attribution']
    }
}
```

### AI Translation Pipeline (`newsUtils.js`)
```javascript
// Intelligent translation system
translationPipeline = {
    arrayTranslation: {
        input: 'string[]',
        prompt: 'batch_translation_with_preservation',
        temperature: 0.3,
        model: 'TRANSLATE_PORTUGUESE_ARRAY'
    },
    singleTranslation: {
        input: 'string',
        languageDetection: 'auto|specified',
        preservationLogic: 'maintain_if_already_portuguese',
        fallbackBehavior: 'return_original_on_error'
    }
}
```

### Configuration Schema (`ayub.config.js`)
```javascript
AYUB_CONFIG = {
    prefixes: string[],                      // Command trigger prefixes
    description: string,                     // Command help text
    stickerHash: string,                     // WhatsApp sticker identifier
    autoDelete: {
        errorMessages: boolean,              // Auto-delete error responses
        commandMessages: boolean,            // Auto-delete command triggers
        deleteTimeout: number                // Deletion delay (ms)
    },
    errorMessages: {
        noArticles: string,                  // No content found message
        error: string,                       // General error message
        notAllowed: string                   // Permission denied message
    },
    useGroupPersonality: boolean,            // Group-specific behavior
    model: string,                          // AI model specification
    prompt: object                          // Reference to resumo prompts
}
```

## Data Flows

### General News Flow
```
Command Detection → ayub.js → newsUtils.scrapeNews() → Puppeteer Scraping →
  ↓ (news items extracted)
translateToPortuguese() → AI Translation → Response Formatting → WhatsApp Delivery
```

### News Search Flow
```
Search Command → Input Parsing → newsUtils.searchNews() → Google News RSS →
  ↓ (XML parsing)
News Items Extraction → Portuguese Translation → Formatted Response → WhatsApp
```

### Automatic Link Processing Flow
```
Message with Link → Context Validation (admin/specific user) → Link Extraction →
  ↓ (link unshortening)
Content Scraping → AI Summarization → Response Delivery → Auto-Delete Management
```

### Football News Flow
```
Football Command → newsUtils.scrapeNews2() → GE Globo Scraping → Cheerio Parsing →
  ↓ (title/summary/link extraction)
Response Formatting → WhatsApp Delivery
```

### Sticker Interaction Flow
```
Sticker Detection → Hash Validation → handleAyubNewsSticker() → Latest News Scraping →
  ↓ (content processing)
Translation Pipeline → User Personalization → Response Delivery
```

## Configuration Schema

### Command Configuration
```javascript
AYUB_CONFIG = {
    prefixes: string[],                      // ['#ayubnews', '#news', '#noticias']
    description: string,                     // Command help documentation
    stickerHash: string,                     // Unique sticker identifier for trigger
    autoDelete: {
        errorMessages: boolean,              // Auto-delete error responses
        commandMessages: boolean,            // Auto-delete command messages
        deleteTimeout: number                // Delay before deletion (ms)
    },
    errorMessages: {
        noArticles: string,                  // No content available message
        error: string,                       // General processing error
        notAllowed: string                   // Authorization failure message
    },
    useGroupPersonality: boolean,            // Enable group-specific responses
    model: string,                          // AI model for processing
    prompt: object                          // External prompt configurations
}
```

### News Source Configuration
```javascript
newsSourceConfig = {
    newsMinimalist: {
        url: 'https://www.newsminimalist.com/',
        scraper: 'puppeteer',
        timeout: 30000,
        resourceBlocking: ['image', 'font', 'media']
    },
    geGlobo: {
        url: 'https://ge.globo.com/futebol/',
        scraper: 'cheerio',
        contentLimit: 5
    },
    googleNews: {
        baseUrl: 'https://news.google.com/rss/search',
        parameters: { hl: 'pt-BR', gl: 'BR', ceid: 'BR:pt-419' },
        resultLimit: 5
    }
}
```

### User Context Configuration
```javascript
contextConfig = {
    automaticLinkProcessing: {
        adminInDM: {
            userCheck: process.env.ADMIN_NUMBER,
            chatType: 'direct_message'
        },
        specificUserInGroup: {
            userCheck: process.env.MEMBER_LF10,
            groupCheck: process.env.GROUP_LF
        }
    }
}
```

## External Dependencies

### Web Scraping Technologies
- **Puppeteer**: Headless browser automation for JavaScript-heavy sites (newsminimalist.com)
- **Cheerio**: Server-side HTML parsing for static content (ge.globo.com)
- **Axios**: HTTP client for RSS feed retrieval and web requests

### AI Integration
- **OpenAI GPT Models**: Content translation and summarization via `runCompletion()`
- **Custom Prompts**: Specialized prompts from `../resumos/resumo.prompt` for content processing
- **Translation Models**: Portuguese translation with language detection and preservation logic

### WhatsApp Integration
- **Link Detection**: Automatic extraction from message content and quoted messages
- **Sticker Recognition**: Hash-based sticker identification for command triggers
- **Media Handling**: Link unshortening and content extraction capabilities

### News Sources
- **NewsMinimalist**: Curated international news aggregation
- **GE Globo**: Brazilian sports news (football focus)
- **Google News RSS**: Search-based news retrieval with temporal information

## Internal Dependencies

### Utility Dependencies
- **`../utils/logger`**: Comprehensive logging for scraping, translation, and error tracking
- **`../utils/openaiUtils`**: OpenAI client management and completion processing
- **`../utils/linkUtils`**: Link extraction, unshortening, and content scraping utilities
- **`../utils/messageUtils`**: Auto-delete functionality and message lifecycle management

### Configuration Dependencies
- **`../configs`**: Core bot configuration including credentials and limits
- **`../resumos/resumo.prompt`**: Shared prompt configurations for content summarization
- **Environment Variables**: User identification and group targeting configuration

### Cross-Module Dependencies
- **`ayub.js`** ← imports ← `newsUtils.js`, utility modules, configuration files
- **`newsUtils.js`** ← imports ← OpenAI utilities, logging system
- **Link Processing Integration**: Shares link utilities with other bot components

### Data Sharing Patterns
- **Translation Services**: Reusable Portuguese translation pipeline across news sources
- **Error Handling**: Consistent error message formatting and auto-delete behavior
- **User Context**: Shared user identification and authorization patterns
- **Content Processing**: Standardized news item formatting and delivery mechanisms 