/**
 * Test Logger
 * 
 * This logger respects SILENT and DEBUG environment variables to control output.
 * - SILENT=true: Only errors and test results will be shown
 * - DEBUG=true: All messages including debug info will be shown
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');

// Determine log level from environment
const isSilent = process.env.SILENT === 'true';
const isDebug = process.env.DEBUG === 'true';
const suppressInitialLogs = process.env.SUPPRESS_INITIAL_LOGS === 'true';

// Store debug logs for test_results.json
let debugLogs = [];
let currentSpinner = null;
let spinnerInterval = null;
let clientsReady = false;

// Spinner characters
const spinnerChars = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

// ANSI color codes
const colors = {
    reset: "\x1b[0m",
    bright: "\x1b[1m",
    dim: "\x1b[2m",
    
    red: "\x1b[31m",
    green: "\x1b[32m",
    yellow: "\x1b[33m",
    blue: "\x1b[34m",
    cyan: "\x1b[36m",
    magenta: "\x1b[35m",
    white: "\x1b[37m",
    gray: "\x1b[90m"
};

// Add these variables at the top with other state variables
let lastWasBotLog = false;
let botLogChainActive = false;

// Signal that clients are ready and tests can begin
function signalClientsReady() {
    clientsReady = true;
}

// Start spinner for a test
function startSpinner(testName) {
    if (currentSpinner) {
        if (spinnerInterval) clearInterval(spinnerInterval);
        readline.clearLine(process.stdout, 0);
        readline.cursorTo(process.stdout, 0);
    }
    
    let i = 0;
    currentSpinner = testName;
    spinnerInterval = setInterval(() => {
        readline.clearLine(process.stdout, 0);
        readline.cursorTo(process.stdout, 0);
        process.stdout.write(`Testing: ${testName} ${spinnerChars[i]}`);
        i = (i + 1) % spinnerChars.length;
    }, 100);
}

// Stop spinner and show result
function stopSpinner(success, testName, details = '') {
    if (currentSpinner) {
        if (spinnerInterval) clearInterval(spinnerInterval);
        readline.clearLine(process.stdout, 0);
        readline.cursorTo(process.stdout, 0);
        currentSpinner = null;
        console.log(`${success ? '✅' : '❌'} ${testName}${details ? ' - ' + details : ''}`);
    }
}

// Critical patterns that should be shown even in silent mode
const criticalPatterns = [
    /^\[TEST\]/,               // Test headers
    /^❌ FAILED/,              // Test failures
    /^✅ PASSED/,              // Test successes
    /^Error:/,                 // Errors
    /^Test results/,           // Test result summary
    /^QR Code received/        // QR code for authentication
];

// Patterns that should be captured but not shown
const capturePatterns = [
    /^Bot stdout:/,
    /^Bot stderr:/,
    /^Loading screen:/,
    /^Client state changed:/,
    /^Found existing session/,
    /^Using authentication path/,
    /^Setting bot to use/,
    /^Found group/,
    /^Fetching chats/,
    /^Found target group/,
    /^Bot started with PID/,
    /^Bot initialization wait completed/,
    /^Client authenticated/,
    /^Client is ready/,
    /^WhatsApp test client initialized/,
    /^Group access verified/,
    /^Bot is not running/,
    /^Starting the bot in the background/,
    /^Waiting for WhatsApp client/,
    /^Setting up prompt capture/,
    /^Preparing to run/,
    /^Authentication directories setup/,
    /^Setting up authentication directories/,
    /^Found existing session folder/,
    /^Created auth path/,
    /^Created session directory/,
    /^Successfully created/,
    /^Successfully set permissions/,
    /^Directory already exists/,
    /^Session directory already exists/,
    /^Default directory already exists/,
    /^Successfully removed/,
    /^No incorrect session directory found/,
    /^Setting permissions for/,
    /^Successfully set permissions for/,
    /^Error creating directory/,
    /^Error creating session directory/,
    /^Error creating Default directory/,
    /^Error setting permissions/,
    /^Error removing directory/,
    /^Failed to create auth path/,
    /^Failed to start bot/,
    /^Bot process exited/,
    /^Client initialization failed/,
    /^Error initializing client/,
    /^Authentication failed/,
    /^Error finding target group/,
    /^Error finding admin chat/,
    /^Unable to find target group/,
    /^Unable to find admin chat/,
    /^Error creating client/,
    /^Session folder not found/,
    /^Auth path does not exist/,
    /^Client is not fully authenticated/,
    /^Admin number not configured/,
    /^Admin chat not found/,
    /^Target group not found/,
    /^Client initialization timed out/,
    /^Prompt capture set up successfully/,
    /^Found group \".*\"/,
    /^\(node:\d+\) \[DEP0040\] DeprecationWarning: The \`punycode\` module is deprecated/,
    /^Use `node --trace-deprecation ...`/,
    /^\[.*\] \[ERROR\]/,         // Error logs from bot
    /^\[.*\] \[DEBUG\]/,         // Debug logs from bot
    /^\[.*\] \[INFO\]/,          // Info logs from bot
    /^\[.*\] \[WARN\]/,          // Warning logs from bot
    /^\[.*\] \[STARTUP\]/,       // Startup logs from bot
    /^\[.*\] \[SHUTDOWN\]/,      // Shutdown logs from bot
    /^\[.*\] \[PROMPT\]/         // Prompt logs from bot
];

// Safely print a log message without interfering with spinner
function safeLog(message, options = {}) {
    const { 
        prefix = '',        // Colored prefix like "DEBUG:" 
        prefixColor = '',   // Color for the prefix
        isOfficial = false, // Whether this is an official log (show in non-verbose mode)
        customColor = '',   // Custom color for the entire message
        preserveIndentation = false, // Whether to preserve message indentation
        isBotLog = false    // Whether this is a bot log
    } = options;
    
    // First, add to debug logs regardless of output
    debugLogs.push(message);
    
    // If we have an active spinner, clear the line first
    if (currentSpinner && spinnerInterval) {
        if (process.stdout.isTTY) {
            readline.clearLine(process.stdout, 0);
            readline.cursorTo(process.stdout, 0);
        }
    }
    
    // Format based on options
    let formattedMessage;
    
    // For bot output, strip any existing ANSI color codes
    if (message.startsWith('Bot stdout:') || message.startsWith('Bot stderr:')) {
        message = message.replace(/\x1b\[[0-9;]*m/g, '');
    }
    
    if (customColor) {
        // Use custom color for entire message
        formattedMessage = `${customColor}${message}${colors.reset}`;
    } else if (isOfficial) {
        // Official logs always in bold white
        formattedMessage = `${colors.bright}${message}${colors.reset}`;
    } else if (prefix) {
        // Format with colored prefix and dim text
        if (preserveIndentation) {
            // For bot logs, preserve the original indentation
            const lines = message.split('\n');
            formattedMessage = lines.map((line, index) => {
                if (index === 0) {
                    // First line gets the prefix
                    return `${prefixColor}${prefix}${colors.reset} ${colors.dim}${line}${colors.reset}`;
                } else {
                    // Subsequent lines maintain the same indentation as the first line
                    // Calculate the total indentation needed (prefix length + 1 for space)
                    const indent = ' '.repeat(prefix.length + 1);
                    // Preserve any existing indentation in the line
                    const existingIndent = line.match(/^\s*/)[0];
                    return `${indent}${existingIndent}${colors.dim}${line.trim()}${colors.reset}`;
                }
            }).join('\n');
        } else {
            formattedMessage = `${prefixColor}${prefix}${colors.reset} ${colors.dim}${message}${colors.reset}`;
        }
    } else {
        // Regular message with dimmed text
        formattedMessage = `${colors.dim}${message}${colors.reset}`;
    }
    
    // Print the message
    console.log(formattedMessage);
    
    // No need to redraw spinner - the interval will handle it
}

// Logger object that all test files will use
const logger = {
    log: function(...args) {
        const message = args[0]?.toString() || '';
        
        // Check if this is a message that should be captured
        const shouldCapture = capturePatterns.some(pattern => pattern.test(message));
        
        // Check if this is a bot log
        const isBotLog = message.startsWith('Bot stdout:') || message.startsWith('Bot stderr:') || 
            message.match(/^\[.*\] \[(DEBUG|INFO|WARN|ERROR|STARTUP|SHUTDOWN|PROMPT)\]/) ||
            message.match(/^\[.*\] (Initializing|Setting up|Registering|Client|Message|Command|All listeners|Processing|Checking|Data:|Skipping|handle|Admin)/);
        
        // In debug/verbose mode
        if (isDebug) {
            // Format bot output specially
            if (isBotLog) {
                // Extract the actual message, preserving indentation
                let botMessage = message;
                if (message.startsWith('Bot stdout:') || message.startsWith('Bot stderr:')) {
                    botMessage = message.replace(/^Bot (stdout|stderr): /, '');
                }
                
                // Strip timestamps from bot messages but preserve indentation
                const cleanMessage = botMessage.replace(/\[[A-Za-z]{3} \d{2}, \d{2}:\d{2}\] /g, '');
                
                // Determine if we need a new BOT> prefix
                const needsNewPrefix = !lastWasBotLog || !botLogChainActive;
                
                // Split into lines and preserve indentation
                const lines = cleanMessage.split('\n');
                const formattedLines = lines.map((line, index) => {
                    // Preserve the original indentation
                    const originalIndent = line.match(/^\s*/)[0];
                    const content = line.trim();
                    
                    if (index === 0) {
                        // First line gets the prefix
                        return `${colors.cyan}${needsNewPrefix ? 'BOT>' : '    '}${colors.reset} ${colors.dim}${originalIndent}${content}${colors.reset}`;
                    } else {
                        // Subsequent lines maintain indentation
                        return `     ${colors.dim}${originalIndent}${content}${colors.reset}`;
                    }
                });
                
                // Print the formatted message
                console.log(formattedLines.join('\n'));
                
                lastWasBotLog = true;
                botLogChainActive = true;
                return;
            } else {
                // This is a tester log, break the bot chain
                lastWasBotLog = false;
                botLogChainActive = false;
                
                // Other captured debug messages
                if (shouldCapture) {
                    // Format with blue prefix and dim text
                    safeLog(message, { prefix: 'DEBUG:', prefixColor: colors.blue });
                    return;
                }
                
                // For non-captured messages in debug mode, show with INFO prefix
                safeLog(message, { prefix: 'INFO:', prefixColor: colors.green });
                return;
            }
        }
        
        // Immediately capture and suppress specific messages we want to hide completely
        if (message === 'Prompt capture set up successfully' || 
            message.startsWith('Found group') ||
            message.includes('DeprecationWarning') ||
            message.includes('node --trace-deprecation')) {
            // Still add to debug logs but don't show in console
            debugLogs.push(message);
            return;
        }
        
        // Handle CLIENTS_READY specially - signal but don't show
        if (message === 'CLIENTS_READY') {
            debugLogs.push(message);
            signalClientsReady();
            // DO NOT print anything to console here
            return;
        }
        
        // In non-debug mode
        if (!isDebug) {
            // Don't show captured messages in non-debug mode
            if (shouldCapture) {
                debugLogs.push(message);
                return;
            }
            
            // If clients are not ready yet, only show critical messages
            if (!clientsReady) {
                const isCritical = criticalPatterns.some(pattern => pattern.test(message));
                if (isCritical) {
                    // Show critical messages in bold
                    safeLog(message, { isOfficial: true });
                }
                return;
            }
            
            // In silent mode, only show critical messages
            if (isSilent) {
                const isCritical = criticalPatterns.some(pattern => pattern.test(message));
                if (isCritical) {
                    // Show critical messages in bold
                    safeLog(message, { isOfficial: true });
                }
                return;
            }
            
            // In normal non-debug mode, show all non-captured messages as official (bold white)
            safeLog(message, { isOfficial: true });
            return;
        }
    },
    
    error: function(...args) {
        const message = args[0]?.toString() || '';
        debugLogs.push(`ERROR: ${message}`);
        
        // Format error messages with red prefix and dim text
        safeLog(message, { prefix: 'ERROR:', prefixColor: colors.red });
    },
    
    warn: function(...args) {
        const message = args[0]?.toString() || '';
        debugLogs.push(`WARN: ${message}`);
        
        // Format warning messages with yellow prefix and dim text
        safeLog(message, { prefix: 'WARNING:', prefixColor: colors.yellow });
    },
    
    debug: function(...args) {
        const message = args[0]?.toString() || '';
        debugLogs.push(`DEBUG: ${message}`);
        
        // Signal clients ready if this is the CLIENTS_READY message
        if (message === 'CLIENTS_READY') {
            signalClientsReady();
        }
        
        // Show debug logs in verbose mode
        if (isDebug) {
            // Format debug messages with blue prefix and dim text
            safeLog(message, { prefix: 'DEBUG:', prefixColor: colors.blue });
        }
    },
    
    startTest: function(testName) {
        startSpinner(testName);
    },
    
    endTest: function(success, testName, details = '') {
        stopSpinner(success, testName, details);
    },
    
    qrCode: function(clientType, qr) {
        console.log(`\nQR Code for ${clientType} authentication:`);
        require('qrcode-terminal').generate(qr, { small: true });
        console.log(`Please scan the QR code with your WhatsApp to authenticate the ${clientType}.`);
    },
    
    saveDebugLogs: function() {
        const resultsPath = path.join(__dirname, 'test_results.json');
        try {
            let results = {};
            if (fs.existsSync(resultsPath)) {
                results = JSON.parse(fs.readFileSync(resultsPath, 'utf8'));
            }
            results.debugLogs = debugLogs;
            fs.writeFileSync(resultsPath, JSON.stringify(results, null, 2));
        } catch (error) {
            console.error('Error saving debug logs:', error);
        }
    }
};

// Save logs when process exits
process.on('exit', logger.saveDebugLogs);
process.on('SIGINT', () => {
    logger.saveDebugLogs();
    process.exit();
});

module.exports = logger; 