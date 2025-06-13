# Test System Documentation

## Overview
Comprehensive automated testing framework for WhatsApp bot functionality providing multi-category test execution, interactive test menus, detailed logging, and authentication management with support for both group and direct message testing scenarios.

## Core Features
- **Multi-Category Testing**: Organized test suites for summary, news, chat, media, and admin functionality with selective execution
- **Interactive Test Menu**: Terminal-based UI for category selection, individual test execution, and results monitoring
- **Dual Authentication**: Separate WhatsApp client authentication for main bot and test client with session management
- **Advanced Logging**: Multi-level logging system with spinner UI, debug capture, and test result formatting
- **Media Testing**: Image, audio, PDF, and sticker testing with attachment handling and response validation

## Usage Examples
```bash
npm test                        # Run all tests with minimal output
npm test -v                     # Run all tests with verbose logging
npm run test:summary            # Run only summary tests
npm run test:chat -v           # Run chat tests with verbose output
npm run test:command "Basic Summary"  # Run specific test by name
npm run test:menu              # Interactive test selection menu
npm run setup                  # Setup authentication directories
```

## Architecture Overview

### Core Design Pattern
Event-driven test orchestration with modular test execution, centralized configuration management, and comprehensive logging infrastructure. Uses dual WhatsApp client architecture for isolated testing and real-time response validation.

### Processing Flow
1. **Authentication Setup** → `setupAuth.js` (directory creation + session management)
2. **Test Initialization** → `runTests.js` (client setup + bot startup)
3. **Test Orchestration** → `botTester.js` (test execution + response monitoring)
4. **Result Processing** → `logger.js` (formatting + file output)
5. **Cleanup Management** → Process termination and cache cleanup

## File Structure & Roles

### Core Test Orchestration Files
- **`runTests.js`**: Unified test runner with command-line interface, process management, and result compilation
- **`botTester.js`**: Main test orchestration engine with WhatsApp client management and test execution logic
- **`botTesterFunctions.js`**: Exported function library for modular test component access by external scripts

### Test Definition & Configuration Files
- **`testCases.js`**: Centralized test case definitions with category organization and execution parameters
- **`config.js`**: Test environment configuration including timing, client settings, and sample file mappings
- **`setupAuth.js`**: Authentication directory management with session cleanup and permission handling

### User Interface & Utility Files
- **`testMenu.js`**: Interactive terminal menu system for test category selection and execution monitoring
- **`logger.js`**: Advanced logging system with spinner UI, multi-level output control, and debug capture
- **`utils.js`**: Shared utility functions for sample file validation, media message creation, and result formatting

### Sample Assets Directory
- **`samples/`**: Test media assets including images, audio, PDFs, and stickers for attachment testing scenarios

## Core Components

### Test Orchestration System (`botTester.js`)
```javascript
// Dual client architecture with session isolation
const testResults = {
    passed: 0,
    failed: 0,
    skipped: 0,
    details: []
};

// WhatsApp client initialization with authentication management
async function initializeClient() {
    const client = new Client({
        authStrategy: new LocalAuth({
            clientId: 'test-client',
            dataPath: path.join(__dirname, '..', 'wwebjs/auth_test')
        }),
        puppeteer: { headless: true, args: [...] }
    });
    return client;
}

// Test execution with response validation and timeout handling
async function runTest(client, group, test) {
    const response = await sendMessageAndWaitForResponse(client, group, test.command, {
        attachment: test.attachment,
        timeout: test.extraDelay ? TIMEOUT + test.extraDelay : TIMEOUT,
        useBotChat: test.useBotChat
    });
    
    // Response validation against expected content
    if (test.expectedResponseContains.length > 0) {
        const responseText = response.body.toLowerCase();
        const foundKeyword = test.expectedResponseContains.some(expected => 
            responseText.includes(expected.toLowerCase())
        );
    }
}
```

### Test Configuration System (`config.js` + `testCases.js`)
```javascript
// Category-based test organization
const TEST_CATEGORIES = {
    SUMMARY: true,    // Summary command tests
    NEWS: true,       // News retrieval tests  
    CHAT: true,       // ChatGPT interaction tests
    MEDIA: true,      // Media processing tests
    ADMIN: true       // Admin-only functionality tests
};

// Test case structure with execution parameters
const testCase = {
    name: 'Basic Summary',
    command: '#resumo',
    expectedResponseContains: ['últimas', 'horas', 'resumo'],
    category: 'SUMMARY',
    extraDelay: 5000,
    attachment: config.SAMPLES.PDF,
    useBotChat: false,
    checkPrompt: false
};
```

### Advanced Logging System (`logger.js`)
```javascript
// Multi-level logging with environment control
const logger = {
    log: (message) => {
        // Conditional output based on SILENT/DEBUG flags
        if (isSilent && !criticalPatterns.some(p => p.test(message))) return;
        if (isDebug) safeLog(message, { prefix: 'DEBUG:', prefixColor: colors.blue });
    },
    
    startTest: (testName) => startSpinner(testName),
    endTest: (success, testName, details) => stopSpinner(success, testName, details)
};

// Spinner-based UI with test progress indication
function startSpinner(testName) {
    spinnerInterval = setInterval(() => {
        process.stdout.write(`Testing: ${testName} ${spinnerChars[i]}`);
        i = (i + 1) % spinnerChars.length;
    }, 100);
}
```

## Data Flows

### Standard Test Execution Flow
```
CLI Command → runTests.js → Config Loading → Authentication Setup →
WhatsApp Client Init → Bot Process Startup → Target Group Discovery →
Test Case Loading → Sequential Test Execution → Result Compilation → Cleanup
```

### Interactive Menu Flow
```
testMenu.js → Category Selection → Test Filtering → botTesterFunctions.js →
Client Initialization → Test Execution → Real-time Progress Display →
Result Summary → Menu Return
```

### Authentication Management Flow
```
setupAuth.js → Directory Creation → Session Path Setup → Permission Setting →
Client Authentication → QR Code Display → Session Storage → Validation
```

### Test Execution with Response Validation Flow
```
Test Definition → Command Sending → Response Monitoring → Content Validation →
Media Attachment Handling → Timeout Management → Result Recording →
Debug Log Capture → Next Test Preparation
```

## Configuration Schema

### Test Execution Configuration
```javascript
module.exports = {
    // Target environment settings
    TARGET_GROUP: 'Test Group Name',
    ADMIN_NUMBER: '5511999999999',
    BOT_NUMBER: '5511999999999',
    
    // Timing configuration
    DELAY_BETWEEN_TESTS: 8000,      // Milliseconds between test execution
    RESPONSE_TIMEOUT: 60000,        // Response wait timeout
    BOT_STARTUP_WAIT: 15000,        // Bot initialization delay
    
    // WhatsApp client configuration
    CLIENT_CONFIG: {
        clientId: 'test-client',
        dataPath: path.join(__dirname, '..', 'wwebjs/auth_test'),
        puppeteerOptions: { headless: true, args: [...] }
    },
    
    // Test category toggles
    TEST_CATEGORIES: {
        SUMMARY: boolean,    // Summary functionality tests
        NEWS: boolean,       // News retrieval tests
        CHAT: boolean,       // ChatGPT interaction tests
        MEDIA: boolean,      // Media processing tests
        ADMIN: boolean       // Admin-only tests
    }
};
```

### Test Case Definition Schema
```javascript
const testCase = {
    name: string,                           // Test identifier
    command: string,                        // Command to execute
    expectedResponseContains: string[],     // Response validation keywords
    description: string,                    // Test description
    category: string,                       // Test category
    
    // Execution modifiers
    extraDelay: number,                     // Additional timeout
    preDelay: number,                       // Pre-execution delay
    useBotChat: boolean,                    // Use direct bot chat
    useAdminChat: boolean,                  // Use admin chat
    adminOnly: boolean,                     // Admin-only test
    
    // Message handling
    preMessage: string,                     // Message to send before command
    preCommand: string,                     // Command to send before main command
    quote: boolean,                         // Quote pre-message
    followUpCommand: string,                // Post-execution command
    followUpDelay: number,                  // Follow-up delay
    
    // Attachment handling
    attachment: string,                     // File to attach
    sendAttachmentFirst: boolean,           // Send attachment before command
    attachWithCommand: boolean,             // Send attachment with command
    isSticker: boolean,                     // Send as sticker
    
    // Response validation
    expectMedia: boolean,                   // Expect media response
    checkPrompt: boolean,                   // Validate prompt content
    checkBotMessageDeletion: boolean        // Test message deletion
};
```

## External Dependencies

### WhatsApp Integration
- **`whatsapp-web.js`**: Primary WhatsApp Web client library for message sending/receiving and authentication
- **`qrcode-terminal`**: QR code generation for WhatsApp authentication in terminal environment
- **`puppeteer`**: Headless browser automation for WhatsApp Web interface control

### Process Management
- **`child_process`**: Bot process spawning, management, and termination with environment variable injection
- **Node.js Process APIs**: Signal handling, environment control, and graceful shutdown management

### File System Operations
- **`fs`**: Sample file validation, test result storage, cache cleanup, and authentication directory management
- **`path`**: Cross-platform path resolution for authentication directories and sample assets

### Terminal Interface
- **`readline`**: Spinner animation control, line clearing, and cursor positioning for test progress display

## Internal Dependencies  

### Cross-Module Dependencies
- **`runTests.js`** ← imports ← `botTester.js`, `config.js`, `testCases.js`, `utils.js`, `logger.js`
- **`botTester.js`** ← imports ← `config.js`, `logger.js` (main test orchestration hub)
- **`botTesterFunctions.js`** ← imports ← `config.js`, `utils.js`, `logger.js` (exported function library)
- **`testMenu.js`** ← imports ← `botTesterFunctions.js`, `config.js`, `testCases.js`, `logger.js`
- **`setupAuth.js`** ← standalone ← no internal dependencies (authentication setup)

### Data Sharing Patterns
- **Test Results**: Centralized in `botTester.js` with getter/setter functions, shared via exports to `runTests.js`
- **Configuration**: Single source in `config.js`, imported by all processing modules for behavior control
- **Logger Instance**: Shared singleton across all modules with environment-based output control
- **Test Definitions**: Centralized in `testCases.js` with category filtering and execution parameter management

### Authentication Architecture
- **Dual Session Management**: Separate authentication directories for main bot (`auth_main`) and test client (`auth_test`)
- **Session Isolation**: Independent Puppeteer instances with isolated browser profiles and data paths
- **Permission Management**: Automated directory creation and permission setting via `setupAuth.js`

### Test Execution Coordination
- **Process Lifecycle**: Bot startup → Client authentication → Test execution → Cleanup with proper resource disposal
- **State Management**: Test results tracking, spinner state, and debug log accumulation across execution phases
- **Resource Cleanup**: Puppeteer process termination, cache directory removal, and session cleanup on completion 