# Chat System Documentation

## Overview
Complete ChatGPT integration system for WhatsApp bot providing intelligent conversation management with memory, context fetching from message history, and automatic/manual web search capabilities.

## Core Features
- **Conversation Management**: Persistent conversations with memory across messages, automatic model selection based on context size
- **Context System**: On-demand WhatsApp message history fetching when ChatGPT requests context
- **Web Search Integration**: Automatic detection + manual search tool (`REQUEST_SEARCH: [query]`) with content extraction
- **Multi-Model Support**: Dynamic GPT model selection based on conversation size and search requirements

## Usage Examples
```
#pergunta sobre programação                    # Basic chat
#!conte uma piada                             # Humor mode  
#qual foi a primeira mensagem do João hoje?   # Context-aware (triggers context fetch)
#pesquise informações atuais sobre ChatGPT    # Automatic web search
```

## Architecture Overview

### Core Design Pattern
Event-driven message processing pipeline with modular handlers for different request types (context, search, conversation). Uses centralized configuration for behavior control and persistent conversation state management.

### Processing Flow
1. **Message Reception** → `chat.js` (command detection + routing)
2. **Conversation Initialization** → `conversationManager.js` (state loading/creation)
3. **Request Type Detection** → Parallel handlers for context/search requests
4. **Content Processing** → AI model selection and API calls
5. **Response Delivery** → WhatsApp message formatting and sending

## File Structure & Roles

### Core Processing Files
- **`chat.js`**: Main command processor, message routing, WhatsApp integration
- **`conversationManager.js`**: Conversation state management, OpenAI API calls, model selection logic
- **`contextManager.js`**: WhatsApp message history fetching, chunk-based context loading
- **`promptUtils.js`**: Message formatting, system prompt construction, conversation serialization

### Request Handler Files  
- **`contextRequestHandler.js`**: Parses `REQUEST_CONTEXT: [details]` from AI responses, manages context limits
- **`searchRequestHandler.js`**: Parses `REQUEST_SEARCH: [query]` from AI responses, manages search limits
- **`webSearchUtils.js`**: DuckDuckGo/Google search execution, content scraping, result formatting

### Configuration Files
- **`chat.config.js`**: Model selection rules, web search settings, context management limits
- **`chatgpt.prompt.js`**: System prompts, conversation templates, personality definitions

## Core Components

### Conversation Management (`conversationManager.js`)
```javascript
// Central conversation state with automatic cleanup
conversationState = {
    groupId: { 
        messages: [...],           // Full conversation history
        lastActivity: timestamp,   // For cleanup scheduling
        currentModel: 'gpt-4o'    // Selected based on context size
    }
}

// Model selection logic based on message count
modelSelection: {
    rules: [
        { maxMessages: 100, model: 'gpt-4o-mini' },
        { maxMessages: 500, model: 'gpt-4o' },
        { maxMessages: 1000, model: 'gpt-4o' }
    ]
}
```

### Context System (`contextManager.js` + `contextRequestHandler.js`)
```javascript
// Context request detection and processing
contextRequest = {
    chunkSize: 100,                      // Messages per chunk
    maxTotalChatHistoryMessages: 1000,   // Hard limit
    maxContextRequests: 10               // Per conversation turn
}

// WhatsApp history fetching with message formatting
fetchContext(groupName, messageCount) → {
    messages: [...],     // Formatted WhatsApp messages
    totalFetched: number // Actual count retrieved
}
```

### Web Search System (`webSearchUtils.js` + `searchRequestHandler.js`)
```javascript
// Dual search activation modes
webSearch: {
    automatic: {                         // Keyword-triggered
        activationKeywords: ['pesquisar', 'latest', 'current'],
        model: 'gpt-4o'                 // Model for processing results
    },
    manual: {                           // AI-requested via REQUEST_SEARCH
        maxSearchRequests: 5,           // Per conversation turn
        timeout: 10000                  // Request timeout
    }
}

// Search execution flow
searchExecution: DuckDuckGo → Google(fallback) → ContentScraping → ModelProcessing → ContextInjection
```

## Data Flows

### Standard Chat Flow
```
WhatsApp Message → chat.js → conversationManager.js → OpenAI API → Response Formatting → WhatsApp
```

### Context-Aware Chat Flow  
```
WhatsApp Message → chat.js → conversationManager.js → OpenAI API → 
  ↓ (AI returns REQUEST_CONTEXT)
contextRequestHandler.js → contextManager.js → WhatsApp History Fetch →
  ↓ (context injected)
conversationManager.js → OpenAI API → Response with Context → WhatsApp
```

### Web Search Flow
```
WhatsApp Message → webSearchUtils.js (keyword detection) → Search APIs → Content Scraping →
  ↓ (search results injected as system message)
conversationManager.js → OpenAI API (with webSearch.model) → Response with Current Info → WhatsApp

OR (Manual Search):

WhatsApp Message → conversationManager.js → OpenAI API → 
  ↓ (AI returns REQUEST_SEARCH: [query])
searchRequestHandler.js → webSearchUtils.js → Search APIs → Content Scraping →
  ↓ (search results injected)
conversationManager.js → OpenAI API → Response with Search Data → WhatsApp
```

## Configuration Schema

### Model Selection Rules (`chat.config.js`)
```javascript
modelSelection: {
    rules: [
        { maxMessages: number, model: string }  // Size-based model selection
    ],
    default: string                            // Fallback model
}
```

### Web Search Configuration
```javascript
webSearch: {
    enabled: boolean,                    // Master toggle
    model: string,                      // Model for processing web results
    maxResults: number,                 // Search results to process
    maxSearchRequests: number,          // Manual search limit per turn
    activationKeywords: string[],       // Auto-search triggers
    timeout: number                     // Request timeout (ms)
}
```

### Context Management Configuration
```javascript
contextManagement: {
    chunkSize: number,                      // Messages per context request
    maxTotalChatHistoryMessages: number,    // Total message limit
    maxContextRequests: number,             // Max requests per conversation
    enabled: boolean                        // Context system toggle
}
```

## External Dependencies

### WhatsApp Integration
- **`global.client`**: WhatsApp Web.js client instance for message sending/receiving
- **`chat.getMessages()`**: Message history fetching for context system
- **`message.reply()`**: Response delivery to WhatsApp

### OpenAI API Integration
- **Models Used**: `gpt-4o-mini`, `gpt-4o` (configurable per use case)
- **API Endpoints**: Chat completions for all conversational AI processing
- **Token Management**: Automatic model switching based on context size to optimize costs

### Web Search APIs
- **DuckDuckGo**: Primary search engine via duckduckgo-search npm package
- **Google**: Fallback search engine for redundancy
- **Cheerio**: HTML parsing for content extraction from search results

## Internal Dependencies

### Configuration Dependencies
- **`../configs`**: Core bot configuration access
- **`../utils/logger`**: Centralized logging system for debugging and monitoring

### Cross-Module Dependencies  
- **`conversationManager.js`** ← imports ← `contextRequestHandler.js`, `searchRequestHandler.js`, `promptUtils.js`
- **`contextManager.js`** ← imports ← `contextRequestHandler.js`
- **`webSearchUtils.js`** ← imports ← `searchRequestHandler.js`, `conversationManager.js`
- **`chat.config.js`** ← imports ← All processing modules for behavior configuration

### Data Sharing Patterns
- **Conversation State**: Centralized in `conversationManager.js`, accessed by all handlers
- **Configuration**: Single source of truth in `chat.config.js`, imported by processing modules
- **Request Parsing**: Shared regex patterns and limits across context/search handlers
- **WhatsApp Integration**: Shared client instance and message formatting utilities