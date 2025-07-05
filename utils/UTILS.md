# Utils System Documentation

## Overview
Comprehensive utility library providing environment management, Git integration, link processing, advanced logging, message handling, and OpenAI API integration with centralized configuration and cross-module shared infrastructure for the WhatsApp bot system.

## Core Features
- **Environment Management**: Environment variable parsing with escape sequence handling and configuration templating
- **Git Integration**: Startup git pull functionality with commit tracking and update notifications
- **Dependency Management**: Automated npm dependency synchronization with change detection and restart signaling
- **Link Processing**: URL extraction, unshortening, content fetching with retry logic and rate limiting
- **Advanced Logging**: Dual-file logging system with console/file output, comprehensive debug capture, admin notifications, and spinner UI
- **Message Management**: Auto-delete functionality, contact name resolution, and message formatting utilities
- **OpenAI Integration**: ChatGPT completions, conversation handling, vision API, and model selection logic

## Usage Examples
```javascript
// Environment Utilities
const { getEnvWithEscapes } = require('./utils/envUtils');
const message = getEnvWithEscapes('WELCOME_MESSAGE', 'Default message\\nWith newlines');

// Git Operations
const { performStartupGitPull, signalSystemdRestart } = require('./utils/gitUtils');
await performStartupGitPull(); // Update bot on startup
signalSystemdRestart('Manual restart requested'); // Signal systemd restart

// Dependency Management
const { performDependencySync, getDependencyStatus, needsDependencySync } = require('./utils/dependencyUtils');
const depStatus = getDependencyStatus(); // Check current dependency status
const needsSync = needsDependencySync(['package.json']); // Check if sync needed
const result = await performDependencySync(); // Synchronize dependencies

// Link Processing
const { extractLinks, getPageContent } = require('./utils/linkUtils');
const links = extractLinks(messageText);
const content = await getPageContent(links[0]);

// Logging
const logger = require('./utils/logger');
logger.info('Bot started successfully');
logger.debug('Processing message', { user, command });
// Debug logs always written to tanabe-gpt-debug.log (if enabled)
// Main logs respect CONSOLE_LOG_LEVELS settings

// Message Management with Streaming
const { handleAutoDelete, resolveContactName, sendStreamingResponse } = require('./utils/messageUtils');
await handleAutoDelete(response, command); // Auto-delete after timeout
const name = resolveContactName(contact); // Get best available name
await sendStreamingResponse(message, finalResponse, command, '🤖'); // Streaming response

// OpenAI Integration
const { runCompletion } = require('./utils/openaiUtils');
const response = await runCompletion(prompt, 1, 'gpt-4o', 'CHAT');
```

## Architecture Overview

### Core Design Pattern
Modular utility architecture with shared logging infrastructure and external API abstraction layers. Most utilities depend on a centralized configuration, while the logger is self-contained. Uses function-based exports with lazy configuration loading to avoid circular dependencies.

### Processing Flow
1. **Initialization** → Configuration loading + logging setup
2. **Runtime Operations** → Utility function calls with shared logger and config access
3. **External Integrations** → OpenAI API calls + HTTP requests + Git operations
4. **State Management** → Log rotation + admin notifications + error handling
5. **Cleanup Operations** → File cleanup + process management + resource disposal

## File Structure & Roles

### Configuration & Discovery Files
- **`envUtils.js`**: Environment variable processing with escape sequence parsing and template message handling
- **`gitUtils.js`**: Git operation utilities with commit tracking, startup update functionality, and systemd restart signaling
- **`dependencyUtils.js`**: Dependency synchronization utilities with change detection and npm ci automation

### Content Processing Files
- **`linkUtils.js`**: URL processing utilities with link extraction, unshortening, content fetching, and retry logic
- **`messageUtils.js`**: Message handling utilities with auto-delete functionality, contact name resolution, and streaming response capabilities

### Infrastructure & Integration Files
- **`logger.js`**: Self-contained, advanced logging infrastructure with multi-level output, file rotation, admin notifications, and spinner UI.
- **`openaiUtils.js`**: OpenAI API integration with model selection, conversation handling, and vision processing

## Core Components

### Advanced Logging System (`logger.js`)
```javascript
// Self-contained, multi-level logging with dual-file system and environment control
const CONSOLE_LOG_LEVELS = {
    ERROR: true, WARN: true, INFO: true, DEBUG: false, PROMPT: false, /* ... */
};

const NOTIFICATION_LEVELS = {
    ERROR: true, WARN: false, INFO: false, /* ... */
};

// Debug file configuration
const DEBUG_FILE_ENABLED = true; // Set to false to disable debug file writing

const logger = {
    error: (message, error = null) => log('ERROR', message, error, true),
    warn: (message, error = null, shouldNotifyAdmin = true) => log('WARN', message, error, shouldNotifyAdmin),
    info: message => log('INFO', message, null, true),
    debug: (message, obj = null) => log('DEBUG', message, obj, false),
    prompt: (message, promptText) => log('PROMPT', message + '\n' + promptText, null, false)
};

// Dual-file logging system
// - Main log (tanabe-gpt.log): Respects CONSOLE_LOG_LEVELS flags
// - Debug log (tanabe-gpt-debug.log): Captures ALL levels when DEBUG_FILE_ENABLED=true
async function log(level, message, error = null, shouldNotifyAdmin = false) {
    // Always write to debug file regardless of console settings (if enabled)
    if (DEBUG_FILE_ENABLED) {
        await logToDebugFile(level, message, error);
    }
    
    // Check console flags for main log and console output
    if (CONSOLE_LOG_LEVELS[level] !== true) return;
    
    // Write to main log file and console only if level is enabled
    await writeToLogFile(formattedMessage);
    console.log(formattedMessage);
}

// Spinner UI with console override protection
function startSpinner() {
    if (!isSystemdEnvironment() && process.env.TEST_MODE !== 'true') {
        spinnerInterval = setInterval(() => {
            process.stdout.write(`\r\x1b[K${SPINNER_FRAMES[spinnerPosition]} Bot is running...`);
            spinnerPosition = (spinnerPosition + 1) % SPINNER_FRAMES.length;
        }, 100);
    }
}

// 24-hour log cleanup (no rotation, only startup cleanup)
async function cleanOldLogs() {
    // Clean main log file
    await cleanLogFile('tanabe-gpt.log');
    
    // Clean debug log file only if enabled
    if (DEBUG_FILE_ENABLED) {
        await cleanLogFile('tanabe-gpt-debug.log');
    }
    
    // Keeps only logs from last 24 hours, runs on startup only
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

### Streaming Response System (`messageUtils.js`)
```javascript
// Simulated streaming response with typing effect
const sendStreamingResponse = async (message, finalResponse, command, placeholder = '🤖', chunkSizeMin = 40, chunkSizeMax = 80, intervalMs = 50) => {
    try {
        // Send initial placeholder message
        const responseMessage = await message.reply(placeholder);
        
        // Stream response with random chunk sizes for natural feel
        let currentIndex = 0;
        let isEditing = false; // Prevent concurrent edits
        
        const streamInterval = setInterval(async () => {
            if (isEditing) return;
            isEditing = true;
            
            try {
                const chunkSize = Math.floor(Math.random() * (chunkSizeMax - chunkSizeMin + 1)) + chunkSizeMin;
                currentIndex += chunkSize;
                
                if (currentIndex >= finalResponse.length) {
                    clearInterval(streamInterval);
                    await responseMessage.edit(finalResponse);
                    await handleAutoDelete(responseMessage, command);
                } else {
                    await responseMessage.edit(finalResponse.substring(0, currentIndex) + '...');
                }
            } catch (error) {
                logger.error('Error during streaming edit:', error);
                clearInterval(streamInterval);
                await responseMessage.edit(finalResponse); // Fallback to complete response
                await handleAutoDelete(responseMessage, command);
            } finally {
                isEditing = false;
            }
        }, intervalMs);
        
        return responseMessage;
    } catch (error) {
        logger.error('Error in streaming response:', error);
        // Fallback to regular reply
        const fallbackMessage = await message.reply(finalResponse);
        await handleAutoDelete(fallbackMessage, command);
        return fallbackMessage;
    }
};

// Usage examples:
// await sendStreamingResponse(message, summary, command, '🤖'); // Default ultra-fast streaming
// await sendStreamingResponse(message, transcription, command, '🤖', 60, 120, 25); // Almost live for audio
// await sendStreamingResponse(message, result, command, '🤖', 50, 100, 30); // Almost live for documents
// await sendStreamingResponse(message, finalResponse, command, '🤖', 50, 100, 25); // Almost live for chat
```
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

### Message Handling System (`messageUtils.js`)
```javascript
// ... existing code ...
```

### Environment Management System (`envUtils.js`)
```javascript
// ... existing code ...
```

### Dependency Management System (`dependencyUtils.js`)
```javascript
// Automated dependency synchronization with change detection
const dependencyManagement = {
    changeDetection: {
        needsDependencySync: 'Check if package.json/package-lock.json changed',
        isNodeModulesOutOfSync: 'Compare modification times for sync status',
        supportedFiles: ['package.json', 'package-lock.json']
    },
    synchronization: {
        primaryMethod: 'npm ci --production --silent (production-safe)',
        fallbackMethod: 'npm install --production --silent',
        timeout: 180000, // 3 minutes
        statusReporting: 'Duration, operation, and success tracking'
    },
    statusTracking: {
        getDependencyStatus: 'Current sync status and file presence',
        lastSyncTime: 'node_modules modification timestamp',
        outOfSyncDetection: 'Automated sync requirement detection'
    }
};

// Example usage in automated deployment
async function handleDependencyUpdate(changedFiles) {
    if (needsDependencySync(changedFiles)) {
        const result = await performDependencySync();
        if (result.success) {
            logger.info(`Dependencies synced: ${result.operation} in ${result.duration}s`);
            return true;
        }
    }
    return false;
}
```

### Enhanced Git Integration System (`gitUtils.js`)
```javascript
// Enhanced git operations with dependency awareness and restart signaling
const gitOperations = {
    changeDetection: {
        performStartupGitPull: 'Enhanced with file change tracking',
        changedFilesAnalysis: 'git diff --name-only HEAD~1',
        dependencyChangeDetection: 'Automatic dependency sync triggering',
        restartRequirement: 'Smart restart detection for code changes'
    },
    systemdIntegration: {
        signalSystemdRestart: 'Graceful process exit for systemd restart',
        restartReason: 'Detailed logging of restart reasons',
        processManagement: 'Clean shutdown with logging completion'
    },
    statusReporting: {
        enhancedResults: 'changedFiles, needsRestart, needsDependencySync',
        commitTracking: 'Before/after commit information',
        errorHandling: 'Graceful fallback with detailed error reporting'
    }
};

// Automated restart flow integration
if (gitResults.hasChanges && gitResults.needsRestart) {
    if (gitResults.needsDependencySync) {
        await performDependencySync();
    }
    signalSystemdRestart('Code changes detected');
}
```

### Git Integration System (`gitUtils.js`)
```javascript
// ... existing code ...
```

## Data Flows

### Automated Deployment Flow
```
Bot Startup → Git Pull (gitUtils.js) → Change Detection →
  ↓ (if changes detected)
Dependency Sync (dependencyUtils.js) → Systemd Restart Signal →
  ↓ (systemd restarts service)
New Process → Git Pull (no changes) → Normal Startup → 
Sync Status Report → Bot Ready with Updated Code & Dependencies
```

### Startup Flow
```
Startup → gitUtils.js → Git Pull →
  ↓ (no changes or post-update)
Logging Initialization → Dependency Status Check → Admin Notification
```

### Standard Logging Flow
```
Log Call → Level Check → Message Formatting → Console Output → File Writing →
Admin Notification Check → Spinner Management → Error Handling
```

### Link Processing Flow
```
URL Extraction → Google Redirect Detection → Unshortening → Content Fetching →
Rate Limit Handling → Retry Logic → Content Cleaning → Length Limiting
```

### OpenAI Completion Flow
```
Function Call → Model Selection → Temperature Adjustment → API Request →
Response Processing → Error Handling → Result Return
```

## Configuration Schema

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

## External Dependencies

- **`axios`**: HTTP requests for link processing and external API calls
- **`ora`**: Spinner UI for console logging
- **`simple-git`**: Git operations for startup updates
- **`openai`**: OpenAI API integration for completions and vision

## Internal Dependencies

### Configuration Dependencies
- **`../configs`**: Centralized configuration access for API keys, system settings, and feature flags, used by most utilities except the logger.

### Cross-Module Dependencies
- **`logger.js`** ← used by ← all other utility modules and core components (self-contained configuration).
- **`openaiUtils.js`** ← used by ← core components requiring AI completions
- **`linkUtils.js`** ← used by ← modules handling links (e.g., `resumo`)
- **`messageUtils.js`** ← used by ← core components for message handling
- **`gitUtils.js`** ← used by ← main application startup sequence 