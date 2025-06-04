# Chat System Documentation

This folder contains the complete ChatGPT integration system for the WhatsApp bot, including conversation management, context handling, and web search capabilities.

## 🏗️ Architecture Overview

The chat system is built with a modular architecture that provides:
- **Intelligent conversation management** with memory and context
- **Dynamic context fetching** from WhatsApp message history
- **Automatic web search integration** for current information
- **Manual web search tool** that ChatGPT can call when needed
- **Multi-model support** with automatic selection based on context size
- **Group personality support** for customized responses

## 📁 File Structure

```
chat/
├── CHAT.md                    # This documentation file
├── chat.js                     # Main chat handler and command processor
├── chat.config.js              # Configuration for chat command
├── chatgpt.prompt.js           # All system prompts and conversation templates
├── conversationManager.js      # Core conversation state management
├── contextManager.js           # WhatsApp message history context fetching
├── contextRequestHandler.js    # Context request parsing and handling
├── searchRequestHandler.js     # Manual search request parsing and handling
├── promptUtils.js              # Prompt formatting and utilities
└── webSearchUtils.js          # Web search integration utilities
```

## 🚀 Core Features

### 1. Conversation Management
- **Persistent conversations** - Maintains context across multiple messages
- **Automatic memory management** - Cleans up expired conversations
- **Model selection** - Automatically chooses optimal GPT model based on context size
- **Group-specific conversations** - Separate conversation threads per WhatsApp group

### 2. Context System
- **On-demand context fetching** - ChatGPT can request WhatsApp message history when needed
- **Intelligent context detection** - Automatically provides context for historical questions
- **Progressive context loading** - Loads message history in chunks as needed
- **Context validation** - Prevents excessive context requests with built-in limits

### 3. Web Search Integration 🌐
- **Automatic search detection** - Detects when users ask for current information
- **Manual search tool** - ChatGPT can call `REQUEST_SEARCH: [query]` when needed
- **Configurable activation** - Uses keywords from config settings
- **Content extraction** - Scrapes and summarizes actual webpage content
- **Source citations** - Provides proper attribution for web information
- **Model optimization** - Uses dedicated model for processing web results

## 🔍 Web Search Capabilities

### Automatic vs Manual Search

**Automatic Search:**
- Triggered by keywords in user messages
- Happens before ChatGPT processes the request
- Uses predefined activation keywords

**Manual Search Tool:**
- ChatGPT can call `REQUEST_SEARCH: [query]` when it determines search is needed
- Allows ChatGPT to decide when current information is required
- Supplements automatic search when more specific queries are needed
- Limited to 5 requests per conversation turn

### Configuration Settings
Web search behavior is controlled by the `webSearch` section in `chat.config.js`:

```javascript
webSearch: {
    enabled: true,                    // Enable/disable web search
    model: 'gpt-4o',                 // Model to use when processing web results
    maxResults: 5,                   // Maximum search results to process
    maxSearchRequests: 5,            // Maximum manual search requests per conversation turn
    activationKeywords: [            // Keywords that trigger automatic web search
        'pesquisar', 'buscar', 'search', 'find', 
        'como', 'onde', 'quando', 'how', 'where', 'when',
        'latest', 'recent', 'current', 'hoje', 'now'
        // ... and more
    ],
    timeout: 10000                   // Timeout for web search requests (ms)
}
```

### Search Detection Keywords
The system automatically detects web search requests using configurable keywords:

**Portuguese**: `pesquise`, `busque`, `procure`, `informações atuais`
**English**: `search`, `find`, `look up`, `current information`
**Temporal**: `latest`, `recent`, `current`, `hoje`, `now`, `atualmente`
**Question words**: `como`, `onde`, `quando`, `how`, `where`, `when`

### Manual Search Tool Usage
ChatGPT can now request manual searches using:
```
REQUEST_SEARCH: [search query]
```

**Examples:**
- `REQUEST_SEARCH: OpenAI GPT-4 latest updates 2024`
- `REQUEST_SEARCH: Brasil eleições 2024 resultados`
- `REQUEST_SEARCH: preço bitcoin hoje`

**Limits:**
- Maximum 5 manual search requests per conversation turn
- Subject to the same timeout and result limits as automatic searches
- Uses the `webSearch.model` when processing results

### Search Process
1. **Detection** - Analyzes user message for search intent using config keywords OR ChatGPT calls manual search
2. **Query Extraction** - Extracts meaningful search terms
3. **Multi-Engine Search** - Uses DuckDuckGo (primary) and Google (fallback)
4. **Content Scraping** - Downloads and extracts content from top results
5. **Model Selection** - Uses `webSearch.model` for processing web results
6. **Context Injection** - Adds search results to conversation context
7. **AI Response** - ChatGPT responds using current web information

### Example Usage
```
User: "me fale sobre as últimas atualizações do ChatGPT"
Bot: [Automatic search triggers] → [Uses gpt-4o model] → [Provides updated response with sources]

User: "qual é a situação atual da economia brasileira?"
Bot: "REQUEST_SEARCH: economia brasileira situação atual 2024" → [Manual search] → [Response with current data]
```

## ⚙️ Configuration

### Model Selection Rules
```javascript
modelSelection: {
    rules: [
        { maxMessages: 100, model: 'gpt-4o-mini' },   // Lightweight for small contexts
        { maxMessages: 500, model: 'gpt-4o' },        // Advanced for medium contexts
        { maxMessages: 1000, model: 'gpt-4o' }        // Advanced for large contexts
    ],
    default: 'gpt-4o-mini'
}
```

### Web Search Settings
```javascript
webSearch: {
    enabled: true,                    // Toggle web search on/off
    model: 'gpt-4o',                 // Model for processing web results
    maxResults: 5,                   // Maximum search results to fetch
    maxSearchRequests: 5,            // Maximum manual search requests per turn
    activationKeywords: [...],       // Customizable trigger keywords
    timeout: 10000                   // Request timeout in milliseconds
}
```

### Context Management
```javascript
contextManagement: {
    chunkSize: 100,                      // Messages per context request
    maxTotalChatHistoryMessages: 1000,   // Total message limit
    maxContextRequests: 10,              // Max requests per conversation
    enabled: true
}
```

## 🎯 Usage Examples

### Basic Chat
```
#pergunta sobre programação
```

### Humor Mode
```
#!conte uma piada sobre programadores
```

### Context-Aware Questions
```
#qual foi a primeira mensagem do João hoje?
#faça um resumo das conversas de ontem
```

### Automatic Web Search
```
#pesquise informações atuais sobre ChatGPT
#busque na internet sobre clima hoje
#procure notícias recentes sobre tecnologia
#latest news about AI (uses config keywords)
```

### Manual Search Requests (ChatGPT decides)
```
#qual é o preço atual do Bitcoin?
Bot: REQUEST_SEARCH: preço bitcoin atual 2024
→ [Performs search] → [Responds with current data]

#me explique as últimas mudanças na legislação brasileira sobre IA
Bot: REQUEST_SEARCH: legislação brasileira inteligência artificial 2024 mudanças
→ [Performs search] → [Responds with recent legal updates]
```

## 🔧 Technical Implementation

### Conversation Flow
1. **Message Reception** → `chat.js`
2. **Conversation Initialization** → `conversationManager.js`
3. **User Message Processing** → `promptUtils.js`
4. **Automatic Web Search Check** → `webSearchUtils.js` (uses config settings)
5. **Context Request Handling** → `contextRequestHandler.js`
6. **Manual Search Request Handling** → `searchRequestHandler.js`
7. **AI Response Generation** → OpenAI API via `conversationManager.js`
8. **Response Delivery** → WhatsApp

### Context Request Flow
1. **AI Request Detection** → `contextRequestHandler.js`
2. **Context Fetching** → `contextManager.js`
3. **Message Formatting** → WhatsApp history processing
4. **Context Injection** → Added to conversation
5. **Continued Processing** → AI generates response with context

### Manual Search Request Flow
1. **AI Search Request Detection** → `searchRequestHandler.js`
2. **Query Parsing** → Extract search terms from `REQUEST_SEARCH: [query]`
3. **Search Execution** → DuckDuckGo/Google APIs (with config timeout)
4. **Content Extraction** → Web scraping with Cheerio
5. **Result Formatting** → Structured data for AI (limited by config.maxResults)
6. **Model Selection** → Uses `webSearch.model` for processing
7. **Context Injection** → Added as system message
8. **AI Response** → Response with current web information

### Automatic Web Search Flow
1. **Search Detection** → Pattern matching using config keywords
2. **Query Extraction** → Clean search terms from message
3. **Search Execution** → DuckDuckGo/Google APIs (with config timeout)
4. **Content Extraction** → Web scraping with Cheerio
5. **Result Formatting** → Structured data for AI (limited by config.maxResults)
6. **Model Selection** → Uses `webSearch.model` for processing
7. **Context Injection** → Added as system message
8. **AI Response** → Response with current web information

## 🛡️ Safety & Limits

### Configuration-Based Limits
- **Web Search Results**: Controlled by `webSearch.maxResults`
- **Manual Search Requests**: Controlled by `webSearch.maxSearchRequests`
- **Search Timeout**: Controlled by `webSearch.timeout`
- **Activation Control**: `webSearch.enabled` can disable all search features
- **Model Control**: `webSearch.model` ensures appropriate model usage

### Rate Limiting
- **Context Requests**: Max 10 per conversation turn
- **Manual Search Requests**: Max 5 per conversation turn (configurable)
- **Total Messages**: Max 1000 historical messages per interaction
- **Web Search**: Timeout protection and reasonable delays between requests

### Error Handling
- **Graceful degradation** when web search fails
- **Fallback responses** when context unavailable
- **Automatic retry** with exponential backoff
- **Error logging** for debugging and monitoring
- **Search limits** prevent abuse of manual search functionality

### Content Filtering
- **Source validation** for web search results
- **Content length limits** to prevent overwhelming responses
- **Anti-spam protection** with request throttling
- **Query validation** for manual search requests

## 🚨 Troubleshooting

### Common Issues

1. **Manual Search Not Working**
   - Check `webSearch.enabled` in config
   - Verify `webSearch.maxSearchRequests` limit not exceeded
   - Review logs for search request parsing errors
   - Ensure search queries are valid (not too short)

2. **Automatic Search Not Triggering**
   - Check `webSearch.activationKeywords` in config
   - Add custom keywords for your use case
   - Verify search phrases in user messages

3. **Wrong Model Being Used**
   - Check `webSearch.model` setting in config
   - Verify model is available in your OpenAI plan
   - Review logs for model selection decisions

4. **Search Request Limits Hit**
   - Adjust `webSearch.maxSearchRequests` if needed
   - Monitor search usage patterns
   - Check conversation turn limits

5. **Context Not Loading**
   - Ensure WhatsApp client is connected
   - Check group permissions in whitelist
   - Verify message cache is populated

### Debug Information
Enable debug logging to see detailed information about:
- Manual search request parsing and execution
- Search query extraction and validation
- Model selection decisions for web search vs regular responses
- Search request count tracking
- Configuration loading and validation

## 📈 Performance Optimization

### Best Practices
- **Efficient web search** - Configure appropriate `maxResults` and `timeout`
- **Smart model selection** - Use `webSearch.model` for web content processing
- **Request limits** - Set `maxSearchRequests` based on your needs
- **Keyword optimization** - Customize `activationKeywords` for your users
- **Memory management** - Clean up expired conversations

### Configuration Tuning
- Adjust `webSearch.maxResults` based on response quality needs
- Set `webSearch.maxSearchRequests` based on expected usage patterns
- Set `webSearch.timeout` based on your network conditions  
- Customize `activationKeywords` for your user base's language patterns
- Use `webSearch.enabled` to quickly disable features if needed

### Monitoring
- Track manual vs automatic search usage frequency
- Monitor search request patterns and query types
- Log search performance and accuracy
- Measure response times and user satisfaction
- Track model selection decisions

---

## 🤝 Contributing

When modifying the chat system:
1. **Test thoroughly** with various conversation scenarios including manual search requests
2. **Update config settings** when adding new features
3. **Document changes** in this README
4. **Consider performance** implications of changes
5. **Maintain backwards compatibility** when possible
6. **Test search limits** and error handling

This chat system provides a sophisticated, context-aware AI assistant with both automatic and manual web search capabilities, making it one of the most advanced WhatsApp chatbot implementations available with comprehensive search functionality. 