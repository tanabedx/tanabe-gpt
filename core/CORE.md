# Core System Documentation

## Overview
Central orchestration system for WhatsApp bot providing command management, message processing, natural language processing, and event handling. Serves as the main coordination layer between WhatsApp events and bot functionality with intelligent message routing and permission management.

## Core Features
- **Dynamic Command Discovery**: Fully automated command and handler discovery using convention-over-configuration
- **Command Management**: Centralized command parsing, validation, registration, and execution with auto-delete functionality
- **Natural Language Processing**: OpenAI-powered message interpretation with context-aware command detection
- **Event Handling**: Comprehensive WhatsApp event processing including messages, reactions, stickers, and media
- **Permission System**: Integrated authorization with whitelist validation and user context management
- **Wizard State Management**: Multi-user configuration wizard coordination with chat-specific state tracking

## Usage Examples
```javascript
// Command processing flow
const commandManager = require('./core/CommandManager');
await commandManager.processCommand(message);

// Command registration (now fully automatic)
const { registerCommands } = require('./core/CommandRegistry');
registerCommands();

// Event listener setup
const { setupListeners } = require('./core/listener');
setupListeners(client);

// NLP processing
const nlpProcessor = require('./core/nlpProcessor');
const command = await nlpProcessor.processNaturalLanguage(message, chat);

// Dynamic command list generation
const { handleCommandList } = require('./core/commandList');
await handleCommandList(message, command);
```

## Architecture Overview

### Core Design Pattern
Event-driven orchestration system with centralized command management, intelligent message routing, and modular component integration. Uses **convention-over-configuration** for automatic discovery of commands and handlers, and dependency injection for state management.

### Processing Flow
1. **Event Reception** → `listener.js` (WhatsApp event handling and initial routing)
2. **Message Analysis** → `nlpProcessor.js` (natural language interpretation and context analysis)
3. **Command Resolution** → `CommandManager.js` (parsing, validation, and permission checking)
4. **Handler Execution** → `CommandRegistry.js` (dynamic handler lookup and execution)
5. **Response Management** → Auto-delete handling and message lifecycle management

## File Structure & Roles

### Core Orchestration Files
- **`listener.js`**: Main WhatsApp event handler, message routing, sticker processing, audio handling, wizard integration
- **`CommandManager.js`**: Central command processing engine, parsing logic, permission validation, auto-delete management
- **`nlpProcessor.js`**: Natural language processing, OpenAI integration, wizard state management, user authorization
- **`CommandRegistry.js`**: Orchestrates automated registration of commands and handlers using discovery modules.

### Utility & Support Files
- **`commandList.js`**: Dynamic command list generation, permission-aware command display, tag information aggregation
- **`commandProcessor.prompt.js`**: OpenAI prompt configuration for natural language command interpretation and user intent analysis
- **`commandDiscovery.js`**: Automatic command configuration discovery and loading from `.config.js` files based on file naming conventions.
- **`handlerDiscovery.js`**: Automatic command handler discovery and loading from module files based on function naming conventions.

### Integration Components
- **Command Registration**: Automatic handler mapping for all bot commands
- **Permission Integration**: Whitelist system coordination with multi-level authorization
- **State Management**: Wizard state tracking across users and chats

## Core Components

### Command Processing Engine (`CommandManager.js`)
```javascript
// Central command parsing and execution
commandProcessing = {
    parseCommand: {
        normalizeMessage: 'handle # followed by spaces',
        botMentionProcessing: 'NLP integration for mentions',
        tagCommandDetection: '@tag pattern matching',
        traditionalCommands: '# and ! prefix handling',
        fallbackToChatGPT: 'unknown # commands → ChatGPT'
    },
    permissionValidation: {
        adminCheck: 'direct admin number comparison',
        whitelistIntegration: 'whitelist.hasPermission() calls',
        chatContextValidation: 'group vs DM authorization'
    },
    autoDeleteSystem: {
        messageQueue: 'scheduled deletion management',
        configurationDriven: 'per-command auto-delete settings',
        errorHandling: 'separate deletion for error messages'
    }
}
```

### Natural Language Processing System (`nlpProcessor.js`)
```javascript
// AI-powered message interpretation
nlpProcessing = {
    messageAnalysis: {
        shouldProcessMessage: 'permission and context validation',
        messageContext: 'quoted messages, media, mention handling',
        patternMatching: 'common phrase detection before API calls'
    },
    openaiIntegration: {
        model: 'gpt-3.5-turbo',
        commandMapping: 'natural language → structured commands (dynamic discovery)',
        contextAware: 'chat-specific command interpretation',
        promptTemplates: 'structured prompts from commandProcessor.prompt.js'
    },
    stateManagement: {
        wizardStates: 'per-user per-chat wizard tracking',
        welcomeMessages: 'unauthorized user message throttling',
        sessionPersistence: 'in-memory state management'
    }
}
```

### OpenAI Prompt Configuration (`commandProcessor.prompt.js`)
```javascript
// Centralized prompt configuration for NLP processing
promptConfiguration = {
    commandAnalysis: {
        instructionTemplate: 'structured command analysis prompt',
        contextVariables: 'commandList and messageContext injection',
        responseFormatting: 'specific command format requirements'
    },
    commandMapping: {
        dynamicDiscovery: 'automatic prefix mapping from discovered commands',
        traditionalCommands: '# and ! prefix handling',
        tagCommands: '@tag pattern recognition',
        chatGptFallback: 'general conversation handling',
        specialHandling: 'admin tags, group-specific tags, command list requests'
    },
    responseRules: {
        tagCommandsOnly: 'return only the tag name for tagging',
        commandFormatting: 'structured parameter passing',
        contextualInference: 'quoted messages and media handling'
    }
}
```

### Event Handling System (`listener.js`)
```javascript
// Comprehensive WhatsApp event processing
eventHandling = {
    messageProcessing: {
        startupFilter: 'ignore messages before bot startup',
        messageTypeRouting: 'stickers, audio, links, text',
        userContextValidation: 'wizard users, admin detection',
        automaticLinkSummary: 'conditional link processing'
    },
    reactionHandling: {
        prayerEmojiDeletion: '🙏 emoji → message deletion',
        botMessageDeletion: 'only delete bot messages',
        messageHistory: 'search through chat history'
    },
    integrationCoordination: {
        wizardMode: 'configuration wizard state management',
        nlpProcessing: 'natural language interpretation',
        commandRouting: 'traditional command processing'
    }
}
```

### Command Registration System (`CommandRegistry.js`)
```javascript
// Dynamic handler registration using discovery
commandRegistration = {
    discoveryMechanism: {
        handlerSource: '`handlerDiscovery.discoverHandlers()`',
        commandSource: '`commandDiscovery.discoverCommands()`'
    },
    registrationProcess: '`commandManager.registerHandler()` calls for each discovered handler',
    automation: 'Fully automatic, no manual mapping required'
}
```

### Dynamic Command List Generation (`commandList.js`)
```javascript
// Permission-aware command display
commandListGeneration = {
    permissionFiltering: {
        whitelistValidation: 'per-command permission checking',
        doubleValidation: 'CommandManager permission verification',
        chatContextAware: 'group vs DM command availability'
    },
    contentGeneration: {
        commandDescriptions: 'prefix + description formatting',
        tagInformation: 'special tags + group-specific tags',
        dynamicContent: 'chat-specific tag display'
    }
}
```

### Command Discovery System (`commandDiscovery.js`)
```javascript
// Automatic discovery of command configurations
commandDiscovery = {
    scanMechanism: {
        recursiveSearch: 'scan directories for .config.js files',
        skipDirectories: 'ignore node_modules, .git, etc.',
        maxDepth: 'limit recursion depth for performance'
    },
    configLoading: {
        dynamicRequire: 'load configurations using require()',
        errorHandling: 'handle and log loading failures gracefully',
        multiConfigSupport: 'support for files exporting multiple configs'
    },
    nameConvention: {
        rule: 'command name is the uppercase version of the config filename',
        example: '`sticker.config.js` → `STICKER` command'
    }
}
```

### Handler Discovery System (`handlerDiscovery.js`)
```javascript
// Automatic discovery of command handlers
handlerDiscovery = {
    scanMechanism: {
        directorySearch: 'scans module directories for corresponding .js files',
        example: 'looks for `sticker/sticker.js` for the `sticker` module'
    },
    handlerLoading: {
        dynamicRequire: 'loads handlers using require()',
        errorHandling: 'logs and skips files that fail to load'
    },
    nameConvention: {
        rule: 'handler function name must start with "handle" followed by the PascalCase command name',
        example: 'function `handleSticker()` maps to `STICKER` command'
    }
}
```

## Data Flows

### Standard Message Processing Flow
```
WhatsApp Message → listener.js (event routing) → Message Type Detection →
  ↓ (command message)
CommandManager.js (parsing + validation) → CommandRegistry.js (handler lookup) →
  ↓ (handler execution)
Command Handler → Response Generation → Auto-Delete Management
```

### Command Discovery Flow
```
Application Startup → commandDiscovery.discoverCommands() → File System Scan →
  ↓ (found .config.js)
Derive Command Name from Filename → Load Config → Add to Command List →
  ↓ (scan complete)
Return All Commands → Used for command validation and list generation
```

### Handler Discovery Flow
```
Application Startup → handlerDiscovery.discoverHandlers() → File System Scan →
  ↓ (found handler file)
Derive Command Name from Function Name → Load Handler → Add to Handler Map →
  ↓ (scan complete)
Return All Handlers → CommandRegistry Registration
```

### Natural Language Processing Flow
```
Bot Mention/DM → nlpProcessor.js (shouldProcessMessage) → OpenAI API Call →
  ↓ (command interpretation)
Command Generation → CommandManager.js (synthetic command processing) → Handler Execution
```

### Sticker Command Flow
```
Sticker Message → listener.js (sticker detection) → Hash Calculation →
  ↓ (hash matching)
Command Configuration Lookup → Synthetic Command Message → Standard Command Processing
```

### Permission Validation Flow
```
Command Request → CommandManager.js (isCommandAllowedInChat) → Admin Check →
  ↓ (non-admin)
whitelist.hasPermission() → Chat Context Resolution → Authorization Result
```

### Wizard State Flow
```
Wizard Command → nlpProcessor.js (setWizardState) → State Storage →
  ↓ (subsequent messages)
listener.js (wizard detection) → wizard.handleWizard() → State Management
```

### Auto-Delete Flow
```
Message Response → CommandManager.js (handleAutoDelete) → Message Queue →
  ↓ (timeout reached)
Periodic Cleanup → Message History Search → Message Deletion
```

## Configuration Schema

### Command Processing Configuration
```javascript
commandConfig = {
    parsing: {
        normalizeSpaces: boolean,           // Handle "# command" → "#command"
        fallbackToChatGPT: boolean,         // Unknown # commands → ChatGPT
        tagDetection: boolean,              // @tag pattern recognition
        mentionProcessing: boolean          // Bot mention → NLP processing
    },
    autoDelete: {
        errorMessages: boolean,             // Auto-delete error responses
        commandMessages: boolean,           // Auto-delete command triggers
        deleteTimeout: number,              // Deletion delay (ms)
        cleanupInterval: number             // Queue processing interval
    }
}
```

### NLP Processing Configuration
```javascript
nlpConfig = {
    openai: {
        model: 'gpt-3.5-turbo',            // AI model for NLP
        apiKey: string,                     // OpenAI API credentials
        temperature: number                 // Response creativity level
    },
    stateManagement: {
        wizardStates: Map,                  // User wizard state tracking
        welcomeMessages: Map,               // Welcome message throttling
        welcomeThreshold: 10800000          // 3-hour welcome message interval
    },
    processing: {
        patternMatching: boolean,           // Pre-API pattern detection
        contextBuilding: boolean,           // Message context for AI
        permissionChecking: boolean         // Authorization validation
    }
}
```

### Event Handling Configuration
```javascript
eventConfig = {
    messageFiltering: {
        ignoreBeforeStartup: boolean,       // Filter pre-startup messages
        skipBotMessages: boolean,           // Ignore bot's own messages
        mediaProcessing: boolean            // Handle media messages
    },
    reactionHandling: {
        deletionEmoji: '🙏',               // Emoji for message deletion
        onlyBotMessages: boolean,           // Only delete bot messages
        searchLimit: 200                   // Message history search limit
    },
    integrations: {
        newsMonitorInit: boolean,           // Initialize news monitoring
        wizardMode: boolean,                // Configuration wizard support
        linkSummary: boolean                // Automatic link summarization
    }
}
```

## External Dependencies

### OpenAI Integration
- **`openai`**: GPT model access for natural language processing and command interpretation
- **Model Usage**: `gpt-3.5-turbo` for efficient command analysis and pattern recognition
- **API Features**: Chat completions for contextual command understanding

### WhatsApp Web.js Integration
- **`global.client`**: WhatsApp client instance for message handling and chat operations
- **Event System**: Message, reaction, state change, and disconnection event handling
- **Media Handling**: Sticker processing, audio transcription triggers, and file operations
- **Chat Management**: Group membership validation, message history, and participant management

### Cryptographic Operations
- **`crypto`**: SHA-256 hash generation for sticker identification and unique file naming
- **Hash Matching**: Sticker command mapping based on cryptographic fingerprints

### File System Operations
- **Temporary File Management**: Audio file creation and cleanup for transcription processing
- **Configuration Loading**: Dynamic configuration file discovery and loading

## Internal Dependencies

### Configuration Dependencies
- **`../configs`**: Central configuration access for credentials, commands, and system settings
- **`../configs/whitelist`**: Permission validation system for command authorization
- **`../utils/logger`**: Centralized logging for debugging and monitoring across all core components
- **`./commandProcessor.prompt`**: OpenAI prompt templates for natural language processing and command interpretation

### Cross-Module Command Integration
- **`../chat/chat`**: ChatGPT conversation handling
- **`../resumos/resumos`**: Message summarization functionality
- **`../news/news`**: News aggregation and link summarization
- **`../sticker/sticker`**: Custom sticker generation
- **`../desenho/desenho`**: AI image generation
- **`../audio/audio`**: Voice message transcription
- **`../tags/tags`**: User tagging and notification system
- **`../admin/admin`**: Administrative command handling
- **`../periodicSummary/wizard/wizard`**: Configuration wizard system

### Utility Dependencies
- **`../utils/messageUtils`**: Auto-delete functionality and message lifecycle management
- **`../utils/envUtils`**: Environment variable access and welcome message generation
- **`./commandDiscovery`**: Automatic command configuration detection based on file naming.
- **`./handlerDiscovery`**: Automatic command handler detection based on function naming.

### State Management Dependencies
- **Wizard System**: Multi-user configuration state tracking across chats
- **NLP State**: Welcome message throttling and user interaction history
- **Permission System**: Dynamic authorization with chat context validation

### Data Sharing Patterns
- **Command Registry**: Centralized handler mapping accessible to command manager
- **Permission Matrix**: Shared authorization system across all command processing
- **State Synchronization**: Wizard state coordination between NLP processor and event listener
- **Configuration Propagation**: Unified configuration distribution to all core components 