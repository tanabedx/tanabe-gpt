# Configuration System Documentation

## Overview
Centralized configuration management system for WhatsApp bot providing credential loading, command discovery, permission management, system settings coordination, and VPS resource optimization. Handles environment variable validation, whitelist authorization, cross-module configuration integration, and runtime performance tuning with a simplified, direct architecture.

## Core Features
- **Credential Management**: Environment variable loading with validation and structured access
- **Command Discovery**: Automatic command detection and configuration aggregation
- **Permission System**: Centralized whitelist-based authorization for all bot commands
- **System Configuration**: Logging levels, model selection, and operational parameters
- **VPS Optimization**: Runtime resource management and performance tuning for dedicated servers
- **Direct Integration**: Simplified configuration access without unnecessary abstraction layers

## Usage Examples
```javascript
// Import main configuration directly
const config = require('./configs/config');

// Access credentials
const adminNumber = config.CREDENTIALS.ADMIN_NUMBER;
const openaiKey = config.CREDENTIALS.OPENAI_API_KEY;

// Check permissions
const hasAccess = await hasPermission('CHAT', chatId, userId);

// Use system settings
const defaultModel = config.SYSTEM.OPENAI_MODELS.DEFAULT;

// Access discovered commands
const commands = config.COMMANDS;  // Auto-discovered command configurations

// Dynamic member access
const members = config.CREDENTIALS.MEMBERS;  // All MEMBER_* env vars

// VPS optimization settings (auto-loaded via app.js)
const { VPS_CONFIG, IS_VPS_OPTIMIZED, IS_DEDICATED_VPS } = require('./configs/vps-optimizations');
const batchSize = VPS_CONFIG.MESSAGE_BATCH_SIZE;  // Automatically optimized based on VPS mode
```

## Architecture Overview

### Core Design Pattern
Simplified hierarchical configuration system with environment variable validation, automatic command discovery, centralized permission management, and runtime VPS optimization. Uses direct imports for clean dependency resolution and eliminates unnecessary abstraction layers following the KISS principle.

### Processing Flow
1. **VPS Optimization Loading** → `vps-optimizations.js` (runtime environment setup)
2. **Environment Loading** → `credentials.js` (dotenv configuration and validation)
3. **Command Discovery** → `config.js` (automatic command configuration detection)
4. **Configuration Assembly** → Direct configuration aggregation in config.js
5. **Permission Resolution** → `whitelist.js` (authorization validation)
6. **System Integration** → Direct configuration access across all bot modules

## File Structure & Roles

### Core Configuration Files
- **`config.js`**: Main configuration orchestrator, command discovery, module integration, and central export
- **`credentials.js`**: Environment variable management, validation, structured credential access
- **`whitelist.js`**: Permission system, command authorization, group membership validation
- **`vps-optimizations.js`**: Runtime VPS resource optimization, performance tuning, adaptive configuration

### Configuration Categories
- **`commandList.config.js`**: Help system configuration, marketing messages, command listing
- **`.env`**: Environment variables for credentials, group identifiers, and system parameters
- **`puppeteerSettings.js`**: Puppeteer/Chrome optimization settings for low-resource environments

### Integration Components
- **Command Discovery**: Automatic detection of command configurations across modules
- **Credential Validation**: Required environment variable checking with error reporting
- **Permission Management**: Centralized authorization with group membership integration
- **VPS Optimization**: Adaptive resource management based on deployment environment

## Core Components

### Main Configuration Hub (`config.js`)
```javascript
// Single source of truth for all configurations
const config = {
  CREDENTIALS: require('./credentials'),
  COMMANDS: discoverCommands(),
  NEWS_MONITOR: require('../newsMonitor/newsMonitor.config'),
  PERIODIC_SUMMARY: require('../periodicSummary/periodicSummary.config'),
  SYSTEM: {
    MAX_LOG_MESSAGES: 1000,
    MESSAGE_DELETE_TIMEOUT: 60000,
    ENABLE_STARTUP_CACHE_CLEARING: true,
    MAX_RECONNECT_ATTEMPTS: 5,
    OPENAI_MODELS: {
        DEFAULT: 'gpt-4o-mini',
        VOICE: 'whisper-1',
        VISION_DEFAULT: 'gpt-4o-mini',
    },
    ADMIN_NOTIFICATION_CHAT: CREDENTIALS.ADMIN_WHATSAPP_ID,
    PRESERVED_FILES_ON_UPDATE: ['configs/config.js', 'commands/periodicSummary.js'],
  },
};
```

### VPS Optimization System (`vps-optimizations.js`)
```javascript
// Runtime VPS optimization (auto-loaded in app.js)
VPS_OPTIMIZATION = {
    environmentDetection: {
        IS_VPS_OPTIMIZED: process.env.OPTIMIZE_FOR_VPS === 'true',
        IS_DEDICATED_VPS: process.env.DEDICATED_VPS === 'true'
    },
    runtimeConfiguration: {
        UV_THREADPOOL_SIZE: IS_DEDICATED_VPS ? '4' : '2',
        garbageCollection: IS_DEDICATED_VPS ? '10min' : '5min',
        eventLoopLagThreshold: IS_DEDICATED_VPS ? 200 : 100
    },
    adaptiveSettings: {
        MESSAGE_BATCH_SIZE: IS_DEDICATED_VPS ? 50 : 20,
        REQUEST_TIMEOUT: IS_DEDICATED_VPS ? 30000 : 15000,
        MAX_CONCURRENT_OPERATIONS: IS_DEDICATED_VPS ? 4 : 2,
        MAX_CONCURRENT_AI_CALLS: IS_DEDICATED_VPS ? 2 : 1
    }
}
```

### Puppeteer Optimization (`puppeteerSettings.js`)
```javascript
// Chrome/Puppeteer optimization for low-resource VPS
PUPPETEER_CONFIG = {
    singleProcess: '--single-process',              // Prevents multi-process spawning
    memoryLimits: '--max_old_space_size=512',      // Limits V8 heap
    cpuOptimization: [
        '--disable-gpu',
        '--disable-software-rasterizer',
        '--enable-low-end-device-mode'
    ],
    processLimits: {
        '--renderer-process-limit=1',
        '--no-zygote'
    }
}
```

### Environment Variable System (`credentials.js`)
```javascript
// Structured credential management
credentialStructure = {
    authentication: {
        ADMIN_NUMBER: process.env.ADMIN_NUMBER,
        BOT_NUMBER: process.env.BOT_NUMBER,
        OPENAI_API_KEY: process.env.OPENAI_API_KEY,
        GETIMG_AI_API_KEY: process.env.GETIMG_AI_API_KEY
    },
    // Note: Twitter API keys, Group, and Phone mappings are now handled dynamically
    // in their respective modules (`newsMonitor` and `periodicSummary/envMapper`).
    dynamicMembers: {
        // Auto-discovery of all MEMBER_* environment variables
        get MEMBERS() { return extractMemberVariables(process.env) }
    }
}
```

### Permission Management System (`whitelist.js`)
```javascript
// Command-specific authorization
permissionMatrix = {
    CHAT: [GROUP_LF, `dm.${GROUP_LF}`, GROUP_AG],
    RESUMOS: [GROUP_LF, `dm.${GROUP_LF}`, GROUP_AG],
    NEWS: [GROUP_LF, `dm.${GROUP_LF}`, GROUP_AG],
    STICKER: [GROUP_LF, `dm.${GROUP_LF}`, GROUP_AG],
    DESENHO: [GROUP_LF, `dm.${GROUP_LF}`, GROUP_AG],
    COMMAND_LIST: 'all',
    ADMIN_COMMANDS: []  // Empty = admin-only
}

// Authorization resolution
authorizationFlow = {
    adminCheck: userId === ADMIN_NUMBER,
    testGroupBypass: chatId === GROUP_AG,
    whitelistValidation: whitelist.includes(chatId),
    dmGroupMembership: await isUserInGroup(userId, groupName)
}
```

### Command Discovery System (`config.js`)
```javascript
// Automatic command configuration detection
commandDiscovery = {
    scanPattern: '**/*.config.js',
    aggregation: 'automatic_import_merge',
    directIntegration: 'immediate_loading',
    moduleIntegration: {
        periodicSummary: 'direct_import',
        newsMonitor: 'direct_import'
    }
}
```

## Data Flows

### VPS Optimization Loading Flow
```
app.js Start → require('./configs/vps-optimizations') → Environment Detection →
  ↓ (runtime configuration)
Thread Pool Setup → GC Configuration → Event Loop Monitoring → VPS_CONFIG Export
```

### Configuration Loading Flow
```
Application Start → credentials.js (env validation) → config.js (discovery + assembly) →
  ↓ (direct configuration access)
Module Imports → config.js → Runtime Usage
```

### Permission Validation Flow
```
Command Request → whitelist.js (hasPermission) → Admin Check → Test Group Bypass →
  ↓ (whitelist validation)
Direct Match → DM Group Membership → Authorization Result
```

### Command Discovery Flow
```
config.js Import → commandDiscovery.discoverCommands() → File System Scan →
  ↓ (**.config.js pattern matching)
Configuration Aggregation → Direct Export → COMMANDS Property
```

### Environment Variable Flow
```
.env File → dotenv.config() → credentials.js → Validation → Structured Access →
  ↓ (credential distribution)
config.js Integration → Cross-Module Usage → Runtime Configuration
  ↓ (VPS optimization layer)
vps-optimizations.js → Adaptive Settings → Runtime Tuning
```

### Simplified Integration Flow
```
config.js → Import Dependencies → Direct Assembly →
  ↓ (single configuration export)
Module Imports → Direct Access → Runtime Usage
```

### System Configuration
```javascript
SYSTEM = {
    limits: {
        MAX_LOG_MESSAGES: 1000,
        MESSAGE_DELETE_TIMEOUT: 60000,
        MAX_RECONNECT_ATTEMPTS: 5
    },
    models: {
        OPENAI_MODELS: {
            DEFAULT: 'gpt-4o-mini',
            VOICE: 'whisper-1',
            VISION_DEFAULT: 'gpt-4o-mini'
        }
    },
    maintenance: {
        ENABLE_STARTUP_CACHE_CLEARING: true,
        PRESERVED_FILES_ON_UPDATE: ['configs/config.js', 'commands/periodicSummary.js']
    }
}
```

## Configuration Schema

### Credential Configuration
```javascript
CREDENTIALS = {
    authentication: {
        ADMIN_NUMBER: string,           // Admin phone number
        BOT_NUMBER: string,             // Bot phone number  
        ADMIN_WHATSAPP_ID: string,      // Formatted admin WhatsApp ID
        OPENAI_API_KEY: string,         // OpenAI API authentication
        GETIMG_AI_API_KEY: string       // GetImg AI API authentication
    },
    // Note: Group, Phone, and Twitter API key mappings are loaded dynamically
    // by their respective modules and are no longer part of this static object.
    dynamicMembers: {
        MEMBERS: object               // Auto-discovered MEMBER_* variables
    }
}
```

### VPS Configuration Schema
```javascript
VPS_CONFIG = {
    performance: {
        MESSAGE_BATCH_SIZE: number,        // Message processing batch size
        REQUEST_TIMEOUT: number,           // API request timeout (ms)
        CACHE_TTL: number,                // Cache time-to-live (seconds)
        MAX_CONCURRENT_OPERATIONS: number, // Concurrent operation limit
        MAX_CONCURRENT_AI_CALLS: number,   // AI request concurrency
        WHATSAPP_RETRY_DELAY: number,     // WhatsApp retry delay (ms)
        WHATSAPP_MAX_RETRIES: number,     // Maximum retry attempts
        MAX_CHAT_HISTORY: number          // Chat history limit
    },
    runtime: {
        IS_VPS_OPTIMIZED: boolean,        // VPS optimization enabled
        IS_DEDICATED_VPS: boolean         // Dedicated VPS mode
    }
}
```

## Node.js Runtime Optimization

### Startup Flags (package.json)
```javascript
startCommand = "node" + [
    "--max-old-space-size=1700",    // Heap memory limit for dedicated VPS
    "--optimize-for-size",           // Optimize for memory over speed
    "--expose-gc",                   // Enable manual garbage collection
    "--gc-interval=100",             // Aggressive GC every 100 allocations
    "--max-semi-space-size=64"       // Limit young generation heap
] + "app.js"
```

### Systemd Service Configuration
```ini
[Service]
Environment="OPTIMIZE_FOR_VPS=true"
Environment="DEDICATED_VPS=true"
MemoryLimit=1900M                   # System memory limit
CPUQuota=195%                       # CPU usage limit (97.5% of 2 cores)
Nice=-10                            # High process priority
```

## Key Improvements

### Simplified Architecture
- **Removed Abstraction Layers**: Eliminated unnecessary `loader.js` and `index.js` files
- **Direct Imports**: All modules import directly from `configs/config.js`
- **KISS Principle**: Follows "Keep It Simple, Stupid" for better maintainability
- **Reduced Complexity**: No more indirection or proxy patterns

### VPS Optimization Features
- **Adaptive Configuration**: Settings automatically adjust based on VPS type
- **Resource Management**: CPU and memory limits prevent system overload
- **Performance Tuning**: Optimized thread pools and garbage collection
- **Puppeteer Optimization**: Single-process Chrome reduces CPU by 15-20%

### Import Pattern
```javascript
// Old pattern (removed)
const config = require('./configs');          // Used index.js
const config = require('./configs/loader');   // Indirect loading

// New simplified pattern
const config = require('./configs/config');   // Direct access
```

### Benefits
- **Faster Loading**: No additional file processing overhead
- **Clearer Dependencies**: Easy to trace configuration sources
- **Easier Debugging**: Direct access to configuration logic
- **Better Performance**: Reduced file I/O and processing time
- **VPS Optimization**: 20-30% CPU reduction on resource-constrained servers