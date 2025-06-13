# Utils System Documentation

## Overview
Comprehensive utility library providing command discovery, environment management, Git integration, link processing, advanced logging, message handling, and OpenAI API integration with centralized configuration and cross-module shared infrastructure for the WhatsApp bot system.

## Core Features
- **Command Discovery**: Automatic scanning and loading of command configurations from `.config.js` files across project directories
- **Environment Management**: Environment variable parsing with escape sequence handling and configuration templating
- **Git Integration**: Startup git pull functionality with commit tracking and update notifications
- **Link Processing**: URL extraction, unshortening, content fetching with retry logic and rate limiting
- **Advanced Logging**: Multi-level logging system with console/file output, admin notifications, and spinner UI
- **Message Management**: Auto-delete functionality, contact name resolution, and message formatting utilities
- **OpenAI Integration**: ChatGPT completions, conversation handling, vision API, and model selection logic

## Usage Examples
```javascript
// Command Discovery
const { discoverCommands } = require('./utils/commandDiscovery');
const commands = discoverCommands(); // Auto-discover all command configs

// Environment Utilities
const { getEnvWithEscapes } = require('./utils/envUtils');
const message = getEnvWithEscapes('WELCOME_MESSAGE', 'Default message\nWith newlines');

// Git Operations
const { performStartupGitPull } = require('./utils/gitUtils');
await performStartupGitPull(); // Update bot on startup

// Link Processing
const { extractLinks, getPageContent } = require('./utils/linkUtils');
const links = extractLinks(messageText);
const content = await getPageContent(links[0]);

// Logging
const logger = require('./utils/logger');
logger.info('Bot started successfully');
logger.debug('Processing message', { user, command });

// OpenAI Integration
const { runCompletion } = require('./utils/openaiUtils');
const response = await runCompletion(prompt, 1, 'gpt-4o', 'CHAT');
```

## Architecture Overview

### Core Design Pattern
Modular utility architecture with centralized configuration dependency, shared logging infrastructure, and external API abstraction layers. Uses function-based exports with lazy configuration loading to avoid circular dependencies.

### Processing Flow
1. **Initialization** → Configuration loading + command discovery + logging setup
2. **Runtime Operations** → Utility function calls with shared logger and config access
3. **External Integrations** → OpenAI API calls + HTTP requests + Git operations
4. **State Management** → Log rotation + admin notifications + error handling
5. **Cleanup Operations** → File cleanup + process management + resource disposal

## File Structure & Roles

### Configuration & Discovery Files
- **`commandDiscovery.js`**: Automatic command configuration scanning with recursive directory traversal and config validation
- **`envUtils.js`**: Environment variable processing with escape sequence parsing and template message handling
- **`gitUtils.js`**: Git operation utilities with commit tracking and startup update functionality

### Content Processing Files
- **`linkUtils.js`**: URL processing utilities with link extraction, unshortening, content fetching, and retry logic
- **`messageUtils.js`**: Message handling utilities with auto-delete functionality and contact name resolution

### Infrastructure & Integration Files
- **`logger.js`**: Advanced logging infrastructure with multi-level output, file rotation, admin notifications, and spinner UI
- **`openaiUtils.js`**: OpenAI API integration with model selection, conversation handling, and vision processing

## Core Components

### Command Discovery System (`commandDiscovery.js`)
```javascript
// Recursive directory scanning with config validation
function discoverCommands() {
    const commands = {};
    const rootDir = path.resolve(__dirname, '..');
    
    // Special name mappings for non-standard patterns
    const nameMapping = {
        'CHAT': 'CHAT_GPT',
        'AYUB': 'AYUB_NEWS',
        'WIZARD': 'RESUMO_CONFIG'
    };
    
    // Recursive scanning with depth control
    function scanDirectory(dirPath, maxDepth = 2, currentDepth = 0) {
        const files = fs.readdirSync(dirPath);
        const configFiles = files.filter(file => file.endsWith('.config.js'));
        
        // Process each config file with error handling
        for (const configFile of configFiles) {
            try {
                const config = require(relativePath);
                const commandName = nameMapping[baseCommandName] || baseCommandName;
                commands[commandName] = config;
            } catch (error) {
                configFailures.push(`Failed to load ${configFile}: ${error.message}`);
            }
        }
    }
    
    return commands;
}
```

### Advanced Logging System (`logger.js`)
```javascript
// Multi-level logging with environment control and admin notifications
const logger = {
    error: (message, error = null) => log('ERROR', message, error, true),
    warn: (message, error = null, shouldNotifyAdmin = true) => log('WARN', message, error, shouldNotifyAdmin),
    info: message => log('INFO', message, null, true),
    debug: (message, obj = null) => log('DEBUG', message, obj, false),
    prompt: (message, promptText) => log('PROMPT', message + '\n' + promptText, null, false)
};

// Spinner UI with console override protection
function startSpinner() {
    if (!isSystemdEnvironment() && process.env.TEST_MODE !== 'true') {
        spinnerInterval = setInterval(() => {
            process.stdout.write(`\r\x1b[K${SPINNER_FRAMES[spinnerPosition]} Bot is running...`);
            spinnerPosition = (spinnerPosition + 1) % SPINNER_FRAMES.length;
        }, 100);
    }
}

// Log file rotation with size management
async function checkAndRotateLog() {
    const stats = await fs.stat(LOG_FILE).catch(() => ({ size: 0 }));
    if (stats.size >= MAX_LOG_SIZE) {
        await fs.rename(LOG_FILE, BACKUP_LOG_FILE).catch(() => {});
        await fs.writeFile(LOG_FILE, '');
    }
}
```

### OpenAI Integration System (`openaiUtils.js`)
```javascript
// Model selection with priority hierarchy
const runCompletion = async (prompt, temperature = 1, model = null, promptType = null) => {
    let modelToUse = model ||
        config?.NEWS_MONITOR?.AI_MODELS?.[promptType] ||
        config?.NEWS_MONITOR?.AI_MODELS?.DEFAULT ||
        config?.SYSTEM?.OPENAI_MODELS?.DEFAULT ||
        'gpt-4o-mini';
    
    // Temperature restrictions for specific models
    let effectiveTemperature = temperature;
    if (['gpt-4o-mini', 'o4-mini'].includes(modelToUse) && temperature !== 1) {
        effectiveTemperature = 1;
    }
    
    const openai = getOpenAIClient();
    const completion = await openai.chat.completions.create({
        model: modelToUse,
        messages: [{ role: 'user', content: prompt }],
        temperature: effectiveTemperature
    });
    
    return completion.choices[0].message.content;
};

// Conversation handling with message validation
const runConversationCompletion = async (messages, temperature = 1, model = null, promptType = null) => {
    if (!Array.isArray(messages) || messages.length === 0) {
        throw new Error('Messages must be a non-empty array');
    }
    
    const completion = await openai.chat.completions.create({
        model: modelToUse,
        messages: messages,
        temperature: effectiveTemperature
    });
    
    return {
        content: completion.choices[0].message.content,
        usedWebSearch: false,
        searchQueries: [],
        rawResponse: completion
    };
};
```

### Link Processing System (`linkUtils.js`)
```javascript
// URL extraction and unshortening with retry logic
async function unshortenLink(url) {
    // Extract direct URLs from Google redirects
    const directUrl = extractGoogleRedirectUrl(url);
    if (directUrl !== url) return directUrl;
    
    // Try HEAD request first (faster)
    try {
        const headResponse = await axios.head(url, {
            maxRedirects: 10,
            timeout: config.RESUMO?.linkSettings?.timeout || 10000,
            headers: { 'User-Agent': '...' }
        });
        return headResponse.request.res?.responseUrl || url;
    } catch (headError) {
        // Fallback to GET request if HEAD fails
        const getResponse = await axios.get(url, { responseType: 'stream' });
        getResponse.data.destroy(); // Prevent full download
        return getResponse.request.res?.responseUrl || url;
    }
}

// Content fetching with retry and rate limiting
async function getPageContent(url, attempt = 1) {
    const settings = config.RESUMO?.linkSettings || { 
        maxCharacters: 5000, timeout: 15000, retryAttempts: 2, retryDelay: 1000 
    };
    
    try {
        const response = await axios.get(url, { timeout: settings.timeout });
        
        // Handle rate limiting with exponential backoff
        if (response.status === 429 && attempt <= settings.retryAttempts) {
            const delay = settings.retryDelay * attempt;
            await new Promise(resolve => setTimeout(resolve, delay));
            return getPageContent(url, attempt + 1);
        }
        
        // Extract and limit content
        let content = response.data
            .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
            
        if (content.length > settings.maxCharacters) {
            content = content.substring(0, settings.maxCharacters);
        }
        
        return content;
    } catch (error) {
        // Retry logic for specific error types
        const isRetryableError = ['ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND'].includes(error.code) ||
            [429, 502, 503, 504].includes(error.response?.status);
            
        if (isRetryableError && attempt <= settings.retryAttempts) {
            await new Promise(resolve => setTimeout(resolve, settings.retryDelay * attempt));
            return getPageContent(url, attempt + 1);
        }
        throw error;
    }
}
```

## Data Flows

### Command Discovery Flow
```
Startup → commandDiscovery.js → Directory Scanning → Config File Detection →
Module Loading → Name Mapping → Validation → Error Collection → Command Registry
```

### Logging Flow
```
Log Call → Level Check → Message Formatting → Console Output → File Writing →
Admin Notification Check → Spinner Management → Error Handling
```

### OpenAI API Flow
```
Function Call → Model Selection → Temperature Adjustment → API Request →
Response Processing → Error Handling → Result Return
```

### Link Processing Flow
```
URL Extraction → Google Redirect Detection → Unshortening → Content Fetching →
Rate Limit Handling → Retry Logic → Content Cleaning → Length Limiting
```

## Configuration Schema

### Logging Configuration
```javascript
const logConfig = {
    SYSTEM: {
        CONSOLE_LOG_LEVELS: {
            ERROR: boolean,     // Error messages
            WARN: boolean,      // Warning messages
            INFO: boolean,      // Information messages
            DEBUG: boolean,     // Debug messages
            PROMPT: boolean,    // OpenAI prompt/response logs
            STARTUP: boolean    // Startup messages
        },
        NOTIFICATION_LEVELS: {
            ERROR: boolean,     // Send errors to admin
            WARN: boolean,      // Send warnings to admin
            INFO: boolean,      // Send info to admin
            PROMPT: boolean     // Send prompts to admin
        }
    }
};
```

### OpenAI Configuration
```javascript
const openaiConfig = {
    SYSTEM: {
        OPENAI_MODELS: {
            DEFAULT: string,        // Default model for general use
            VISION_DEFAULT: string  // Default model for vision tasks
        }
    },
    NEWS_MONITOR: {
        AI_MODELS: {
            DEFAULT: string,                     // Default for news operations
            PROCESS_SITREP_IMAGE_PROMPT: string, // Vision model for image processing
            [promptType]: string                 // Specific models per prompt type
        }
    }
};
```

### Link Processing Configuration
```javascript
const linkConfig = {
    RESUMO: {
        linkSettings: {
            maxCharacters: number,  // Maximum content length
            timeout: number,        // Request timeout in milliseconds
            retryAttempts: number,  // Number of retry attempts
            retryDelay: number      // Base delay between retries
        }
    }
};
```

## External Dependencies

### OpenAI Integration
- **`openai`**: Official OpenAI API client for ChatGPT completions, conversation handling, and vision processing
- **API Endpoints**: Chat completions for text generation, vision API for image analysis

### HTTP Operations
- **`axios`**: HTTP client for link processing, content fetching, and web requests with retry logic
- **Request Features**: Redirects, timeouts, headers, rate limiting, and response streaming

### File System Operations
- **`fs`**: File operations for log rotation, config discovery, and directory scanning
- **`fs.promises`**: Async file operations for non-blocking I/O in logging system

### Process Management
- **`child_process.execSync`**: Git operations execution for startup updates and version tracking
- **Process APIs**: Environment variable access, signal handling, and system detection

### Terminal Operations
- **`readline`**: Cursor control and line clearing for spinner animation in logging system

## Internal Dependencies

### Cross-Module Dependencies
- **`logger.js`** ← imported by ← ALL utility modules (centralized logging infrastructure)
- **`../configs`** ← imported by ← `logger.js`, `openaiUtils.js`, `linkUtils.js`, `messageUtils.js` (configuration access)
- **`commandDiscovery.js`** ← imported by ← main application (command registration)
- **`openaiUtils.js`** ← imported by ← chat system, summary system, news system (AI processing)
- **`linkUtils.js`** ← imported by ← summary system, chat system (content processing)

### Data Sharing Patterns
- **Logger Instance**: Singleton pattern across all modules with shared configuration and state management
- **Configuration Access**: Lazy loading pattern to avoid circular dependencies with setTimeout wrapper
- **OpenAI Client**: Factory pattern with configuration-based initialization and model selection
- **Command Registry**: Centralized discovery with error collection and validation reporting

### Error Handling Architecture
- **Graceful Degradation**: Failed config loads don't stop discovery, missing models fall back to defaults
- **Retry Logic**: Network operations implement exponential backoff with configurable retry limits
- **Error Propagation**: Structured error objects with context preservation and admin notification triggers
- **Resource Cleanup**: File handle management, stream destruction, and interval clearing on errors

### Configuration Integration
- **Hierarchical Model Selection**: Multiple configuration layers with clear precedence rules
- **Environment-Based Behavior**: Development vs production logging levels and output formatting
- **Dynamic Configuration**: Runtime configuration updates without requiring restarts
- **Validation and Fallbacks**: Configuration validation with sensible default values for missing settings 