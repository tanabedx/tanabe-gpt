# Configuration System Documentation

## Overview
Centralized configuration management system for WhatsApp bot providing credential loading, command discovery, permission management, and system settings coordination. Handles environment variable validation, whitelist authorization, and cross-module configuration integration.

## Core Features
- **Credential Management**: Environment variable loading with validation and structured access
- **Command Discovery**: Automatic command detection and configuration aggregation
- **Permission System**: Centralized whitelist-based authorization for all bot commands
- **System Configuration**: Logging levels, model selection, and operational parameters
- **Cross-Module Integration**: Configuration distribution and dependency management

## Usage Examples
```javascript
// Import main configuration
const config = require('./configs');

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
```

## Architecture Overview

### Core Design Pattern
Hierarchical configuration system with environment variable validation, automatic command discovery, and centralized permission management. Uses lazy loading for circular dependency resolution and dynamic property access for extensible configuration.

### Processing Flow
1. **Environment Loading** → `credentials.js` (dotenv configuration and validation)
2. **Command Discovery** → `config.js` (automatic command configuration detection)
3. **Configuration Assembly** → Cross-module configuration aggregation
4. **Permission Resolution** → `whitelist.js` (authorization validation)
5. **System Integration** → Configuration distribution to all bot modules

## File Structure & Roles

### Core Configuration Files
- **`config.js`**: Main configuration orchestrator, command discovery, module integration
- **`credentials.js`**: Environment variable management, validation, structured credential access
- **`whitelist.js`**: Permission system, command authorization, group membership validation
- **`index.js`**: Backward compatibility export wrapper

### Configuration Categories
- **`commandList.config.js`**: Help system configuration, marketing messages, command listing
- **`.env`**: Environment variables for credentials, group identifiers, and system parameters

### Integration Components
- **Command Discovery**: Automatic detection of command configurations across modules
- **Credential Validation**: Required environment variable checking with error reporting
- **Permission Management**: Centralized authorization with group membership integration

## Core Components

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
    circularDependencyHandling: 'lazy_loading',
    moduleIntegration: {
        periodicSummary: 'setTimeout_delayed_import',
        newsMonitor: 'direct_import'
    }
}
```

### System Configuration Schema (`config.js`)
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

## Data Flows

### Configuration Loading Flow
```
Application Start → credentials.js (env validation) → config.js (discovery + assembly) →
  ↓ (configuration distribution)
Module Imports → Specific Configurations → Runtime Usage
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
Configuration Aggregation → Module Integration → COMMANDS Export
```

### Environment Variable Flow
```
.env File → dotenv.config() → credentials.js → Validation → Structured Access →
  ↓ (credential distribution)
Cross-Module Usage → Dynamic Member Discovery → Runtime Configuration
```

### Cross-Module Integration Flow
```
config.js → Import Dependencies → Circular Dependency Resolution (setTimeout) →
  ↓ (configuration assembly)
Export Aggregation → Module Distribution → Runtime Access
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