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
const hasAccess = await hasPermission('CHAT_GPT', chatId, userId);

// Use system settings
const defaultModel = config.SYSTEM.OPENAI_MODELS.DEFAULT;
const logLevels = config.SYSTEM.CONSOLE_LOG_LEVELS;

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
    socialPlatforms: {
        TWITTER_API_KEYS: {
            primary: { bearer_token: process.env.TWITTER_PRIMARY_BEARER_TOKEN },
            fallback: { bearer_token: process.env.TWITTER_FALLBACK_BEARER_TOKEN },
            fallback2: { bearer_token: process.env.TWITTER_FALLBACK2_BEARER_TOKEN }
        }
    },
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
    CHAT_GPT: [GROUP_LF, `dm.${GROUP_LF}`, GROUP_AG],
    RESUMO: [GROUP_LF, `dm.${GROUP_LF}`, GROUP_AG],
    AYUB_NEWS: [GROUP_LF, `dm.${GROUP_LF}`, GROUP_AG],
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
    logging: {
        CONSOLE_LOG_LEVELS: { ERROR: true, WARN: true, INFO: true, DEBUG: false },
        NOTIFICATION_LEVELS: { ERROR: true, WARN: false, SUMMARY: true },
        ADMIN_NOTIFICATION_CHAT: CREDENTIALS.ADMIN_WHATSAPP_ID
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
    socialPlatforms: {
        TWITTER_API_KEYS: {
            primary: { bearer_token: string },
            fallback: { bearer_token: string },
            fallback2: { bearer_token: string }
        }
    },
    groupIdentifiers: {
        GROUPS: { LF: string, AG: string },
        PHONES: { DS1: string, DS2: string }
    },
    dynamicMembers: {
        MEMBERS: object               // Auto-discovered MEMBER_* variables
    }
}
```

### Permission Configuration
```javascript
COMMAND_WHITELIST = {
    [commandName]: string[] | 'all',     // Whitelist entries or universal access
    ADMIN_COMMANDS: [],                  // Empty array = admin-only access
    DM_FORMAT: [`dm.${groupName}`],      // Direct message from group members
    SPECIAL_PERMISSIONS: [phoneNumber]   // Direct user ID permissions
}

ADMIN_ONLY_COMMANDS = string[]           // Commands restricted to admin only
```

### System Configuration
```javascript
SYSTEM = {
    limits: {
        MAX_LOG_MESSAGES: number,
        MESSAGE_DELETE_TIMEOUT: number,
        MAX_RECONNECT_ATTEMPTS: number
    },
    models: {
        OPENAI_MODELS: {
            DEFAULT: string,
            VOICE: string,
            VISION_DEFAULT: string
        }
    },
    logging: {
        CONSOLE_LOG_LEVELS: { [level]: boolean },
        NOTIFICATION_LEVELS: { [level]: boolean },
        ADMIN_NOTIFICATION_CHAT: string
    },
    maintenance: {
        ENABLE_STARTUP_CACHE_CLEARING: boolean,
        PRESERVED_FILES_ON_UPDATE: string[]
    }
}
```

## External Dependencies

### Environment Management
- **`dotenv`**: Environment variable loading from `.env` file with path specification
- **`process.env`**: Node.js environment variable access and validation

### File System Operations
- **Command Discovery**: File system scanning for configuration files across modules
- **Path Resolution**: Cross-platform path handling for configuration file discovery

### WhatsApp Integration
- **`global.client`**: WhatsApp client access for group membership validation
- **Group Membership API**: Participant list access for permission validation

### Module System
- **Dynamic Imports**: Automatic configuration discovery and loading
- **Circular Dependency Resolution**: Lazy loading with setTimeout for complex dependencies

## Internal Dependencies

### Cross-Module Configuration Dependencies
- **`../utils/commandDiscovery`**: Automatic command configuration detection
- **`../newsMonitor/newsMonitor.config`**: News monitoring system configuration
- **`../periodicSummary/periodicSummary.config`**: Periodic summary configuration (lazy-loaded)
- **`../utils/logger`**: Logging system integration (lazy-loaded to avoid circular dependencies)

### Configuration Distribution Pattern
- **`config.js`** ← imports ← All system configurations
- **`credentials.js`** ← imports ← Environment variable access
- **`whitelist.js`** ← imports ← Permission management utilities
- **Module Integration**: Each system module imports relevant configuration sections

### Dependency Resolution Strategies
- **Immediate Loading**: Direct imports for stable dependencies
- **Lazy Loading**: setTimeout-based import for circular dependency resolution
- **Dynamic Properties**: Getter functions for runtime-dependent values
- **Validation Chaining**: Sequential validation with error aggregation

### Data Sharing Patterns
- **Centralized Credentials**: Single source of truth for all authentication
- **Permission Matrix**: Unified authorization system across all commands
- **System Settings**: Shared configuration for logging, models, and operational parameters
- **Command Registry**: Auto-discovered command configurations available to all modules 