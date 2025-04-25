const fs = require('fs').promises;
const config = require('../configs');

// Log levels
const LOG_LEVELS = {
    ERROR: 'ERROR',
    WARN: 'WARN',
    INFO: 'INFO',
    DEBUG: 'DEBUG',
    SUMMARY: 'SUMMARY',
    PROMPT: 'PROMPT',
    STARTUP: 'STARTUP'
};

// Log file configuration
const LOG_FILE = 'tanabe-gpt.log';
const MAX_LOG_SIZE = 10 * 1024 * 1024; // 10MB
const BACKUP_LOG_FILE = 'tanabe-gpt.old.log';

// ANSI color codes
const COLORS = {
    RED: '\x1b[31m',
    YELLOW: '\x1b[33m',
    GREEN: '\x1b[32m',
    BLUE: '\x1b[34m',
    PURPLE: '\x1b[35m',
    GREY: '\x1b[90m',
    BOLD: '\x1b[1m',
    RESET: '\x1b[0m'
};

// Spinner configuration
const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
let spinnerInterval = null;
let spinnerPosition = 0;
let isSpinnerActive = false;

// Function to check if running under systemd
function isSystemdEnvironment() {
    return process.env.INVOCATION_ID !== undefined || 
           process.env.JOURNAL_STREAM !== undefined ||
           process.env.SYSTEMD_EXEC_PID !== undefined;
}

// Function to start the spinner
function startSpinner() {
    // Don't start spinner in test mode or under systemd
    if (process.env.TEST_MODE === 'true' || isSystemdEnvironment()) return;
    if (spinnerInterval) return;
    isSpinnerActive = true;
    spinnerInterval = setInterval(() => {
        // Clear the spinner line
        process.stdout.write('\r\x1b[K');
        // Write the spinner
        process.stdout.write(`${SPINNER_FRAMES[spinnerPosition]} Bot is running...`);
        spinnerPosition = (spinnerPosition + 1) % SPINNER_FRAMES.length;
    }, 100);
}

// Function to stop the spinner
function stopSpinner() {
    if (spinnerInterval) {
        clearInterval(spinnerInterval);
        spinnerInterval = null;
        isSpinnerActive = false;
        // Clear the spinner line
        process.stdout.write('\r\x1b[K');
    }
}

// Function to temporarily hide spinner for log output
function hideSpinner() {
    // Don't hide/show spinner in test mode or under systemd
    if (process.env.TEST_MODE === 'true' || isSystemdEnvironment()) return;
    if (isSpinnerActive) {
        process.stdout.write('\r\x1b[K');
    }
}

// Function to show spinner again after log output
function showSpinner() {
    // Don't hide/show spinner in test mode or under systemd
    if (process.env.TEST_MODE === 'true' || isSystemdEnvironment()) return;
    if (isSpinnerActive) {
        process.stdout.write(`${SPINNER_FRAMES[spinnerPosition]} Bot is running...`);
    }
}

// Override console.log to handle spinner
const originalConsoleLog = console.log;
console.log = function(...args) {
    hideSpinner();
    originalConsoleLog.apply(console, args);
    showSpinner();
};

// Override console.error to handle spinner
const originalConsoleError = console.error;
console.error = function(...args) {
    hideSpinner();
    originalConsoleError.apply(console, args);
    showSpinner();
};

// Override console.warn to handle spinner
const originalConsoleWarn = console.warn;
console.warn = function(...args) {
    hideSpinner();
    originalConsoleWarn.apply(console, args);
    showSpinner();
};

// Function to format error objects
function formatError(error) {
    if (!error) return 'Unknown error';
    if (typeof error === 'string') return error;
    
    // Get the first line of the stack trace that isn't from node_modules
    const stackLine = error.stack?.split('\n')
        .find(line => line.includes('at') && !line.includes('node_modules'))
        ?.trim()
        ?.split('at ')[1] || 'unknown location';
    
    // Extract just the file name and line number
    const match = stackLine.match(/[^/]*\.js:\d+/);
    const location = match ? match[0] : stackLine;
    
    return `${error.message} (${location})`;
}

// Function to format the log message with timestamp
function formatLogWithTimestamp(level, message, error = null) {
    const now = new Date();
    const timestamp = now.toLocaleString('en-US', {
        month: 'short',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
    });
    
    let prefix = `[${timestamp}] [${level}]`;
    let formattedMessage = message;
    let indent = ' '.repeat(prefix.length + 1); // Calculate indentation based on prefix length
    
    // In test mode, don't use colors
    if (process.env.TEST_MODE === 'true') {
        return `${prefix} ${message}`;
    }
    
    switch(level) {
        case LOG_LEVELS.ERROR:
            prefix = `${COLORS.BOLD}${COLORS.RED}[${timestamp}] [${level}]`;
            formattedMessage = `${message}${COLORS.RESET}`;
            break;
        case LOG_LEVELS.WARN:
            prefix = `${COLORS.YELLOW}[${timestamp}] [${level}]`;
            formattedMessage = `${message}${COLORS.RESET}`;
            break;
        case LOG_LEVELS.INFO:
            prefix = `[${timestamp}] ${COLORS.GREEN}[${level}]${COLORS.RESET}`;
            formattedMessage = message; // Regular white text
            break;
        case LOG_LEVELS.DEBUG:
            prefix = `[${timestamp}] ${COLORS.BLUE}[${level}]${COLORS.RESET}`;
            formattedMessage = `${COLORS.GREY}${message}${COLORS.RESET}`;
            break;
        case LOG_LEVELS.SUMMARY:
            prefix = `[${timestamp}] ${COLORS.PURPLE}[${level}]${COLORS.RESET}`;
            formattedMessage = `${COLORS.GREY}${message}${COLORS.RESET}`;
            break;
        case LOG_LEVELS.PROMPT:
            prefix = `[${timestamp}] ${COLORS.PURPLE}[${level}]${COLORS.RESET}`;
            formattedMessage = `${COLORS.GREY}${message}${COLORS.RESET}`;
            break;
        case LOG_LEVELS.STARTUP:
            prefix = `[${timestamp}] ${COLORS.BOLD}${COLORS.GREEN}[${level}]${COLORS.RESET}`;
            formattedMessage = `${COLORS.BOLD}${COLORS.GREEN}${message}${COLORS.RESET}`;
            break;
    }
    
    // Handle multi-line messages
    if (typeof formattedMessage === 'string') {
        // Remove empty lines and normalize line endings
        formattedMessage = formattedMessage.replace(/\r\n/g, '\n')
            .split('\n')
            .filter(line => line.trim() !== '') // Remove empty lines
            .join('\n');
            
        if (formattedMessage.includes('\n')) {
            const lines = formattedMessage.split('\n');
            formattedMessage = lines.map((line, index) => {
                if (index === 0) return line;
                return `${indent}${line}`;
            }).join('\n');
        }
    }
    
    let logMessage = `${prefix} ${formattedMessage}`;
    
    if (error) {
        logMessage += `: ${formatError(error)}`;
    }
    
    return logMessage;
}

// Function to format admin notification message
function formatAdminMessage(level, message, error = null) {
    // Skip the log level prefix entirely
    let logMessage = message;
    
    if (error) {
        const errorMsg = formatError(error);
        // Only include the error message if it's not already part of the message
        if (!message.includes(errorMsg)) {
            logMessage += `: ${errorMsg}`;
        }
    }
    
    // Remove any double colons that might appear from error formatting
    return logMessage.replace(/:+/g, ':');
}

// Function to check log file size and rotate if needed
async function checkAndRotateLog() {
    try {
        const stats = await fs.stat(LOG_FILE).catch(() => ({ size: 0 }));
        
        if (stats.size >= MAX_LOG_SIZE) {
            // Backup existing log file
            await fs.rename(LOG_FILE, BACKUP_LOG_FILE).catch(() => {});
            // Create new empty log file
            await fs.writeFile(LOG_FILE, '');
        }
    } catch (error) {
        console.error('Error rotating log file:', error);
    }
}

// Function to write to log file
async function writeToLogFile(message) {
    try {
        await checkAndRotateLog();
        await fs.appendFile(LOG_FILE, message + '\n');
    } catch (error) {
        console.error('Error writing to log file:', error);
    }
}

// Functionto notify admin
async function notifyAdmin(message) {
    try {
        if (!global.client) {
            if (!global.pendingAdminNotifications) {
                global.pendingAdminNotifications = [];
            }
            global.pendingAdminNotifications.push(message);
            return;
        }

        const adminContact = `${config.CREDENTIALS.ADMIN_NUMBER}@c.us`;
        
        try {
            await global.client.sendMessage(adminContact, message);
        } catch (error) {
            if (!global.pendingAdminNotifications) {
                global.pendingAdminNotifications = [];
            }
            global.pendingAdminNotifications.push(message);
        }
    } catch (error) {
        console.error(`Failed to process admin notification: ${formatError(error)}`);
    }
}

// Core logging function
async function log(level, message, error = null, shouldNotifyAdmin = false) {
    // Check if this log level is enabled in console settings
    if (!config.SYSTEM?.CONSOLE_LOG_LEVELS || 
        config.SYSTEM.CONSOLE_LOG_LEVELS[level] !== true) {
        return;
    }

    // Format the message for console/file
    const formattedMessage = formatLogWithTimestamp(level, message, error);
    
    // Write to log file
    await writeToLogFile(formattedMessage);
    
    // Use appropriate console method based on level
    switch(level) {
        case LOG_LEVELS.ERROR:
            console.error(formattedMessage);
            break;
        case LOG_LEVELS.WARN:
            console.warn(formattedMessage);
            break;
        case LOG_LEVELS.DEBUG:
            if (typeof message === 'object') {
                console.log(formatLogWithTimestamp(level, JSON.stringify(message, null, 2)));
            } else {
                console.log(formattedMessage);
            }
            if (error) {
                console.log(formatLogWithTimestamp(level, `Error: ${formatError(error)}`));
            }
            break;
        default:
            console.log(formattedMessage);
    }

    // Check if this log level should be sent to admin
    if (shouldNotifyAdmin && config.SYSTEM?.NOTIFICATION_LEVELS && 
        config.SYSTEM.NOTIFICATION_LEVELS[level] === true) {
        const adminMessage = formatAdminMessage(level, message, error);
        await notifyAdmin(adminMessage);
    }
}

// Convenience methods for different log levels
const logger = {
    error: (message, error = null) => log(LOG_LEVELS.ERROR, message, error, true),
    warn: (message, error = null, shouldNotifyAdmin = true) => log(LOG_LEVELS.WARN, message, error, shouldNotifyAdmin),
    info: (message) => log(LOG_LEVELS.INFO, message, null, true),
    debug: (message, obj = null) => {
        // Only proceed if DEBUG is explicitly set to true
        if (!config.SYSTEM?.CONSOLE_LOG_LEVELS || 
            config.SYSTEM.CONSOLE_LOG_LEVELS.DEBUG !== true) {
            return;
        }
        
        if (obj) {
            // If an object is provided, log both the message and the object
            log(LOG_LEVELS.DEBUG, message);
            log(LOG_LEVELS.DEBUG, `Data: ${JSON.stringify(obj, null, 2)}`);
        } else if (typeof message === 'object') {
            // If message is an object, stringify it
            log(LOG_LEVELS.DEBUG, JSON.stringify(message, null, 2));
        } else {
            // Otherwise just log the message
            log(LOG_LEVELS.DEBUG, message);
        }
    },
    summary: (message) => log(LOG_LEVELS.SUMMARY, message, null, true),
    prompt: (message, promptText) => {
        // Only proceed if PROMPT is explicitly set to true
        if (!config.SYSTEM?.CONSOLE_LOG_LEVELS || 
            config.SYSTEM.CONSOLE_LOG_LEVELS.PROMPT !== true) {
            return;
        }
        
        // Handle undefined promptText
        if (promptText === undefined) {
            console.warn(formatLogWithTimestamp('WARN', 'Undefined prompt text received'));
            promptText = 'UNDEFINED PROMPT';
        }
        
        // Format the prompt text to remove extra whitespace and normalize line endings
        promptText = promptText.replace(/\r\n/g, '\n')
            .split('\n')
            .map(line => line.trim())
            .filter(line => line !== '')
            .join('\n');
        
        // Format the prompt header and text together
        const formattedPrompt = formatLogWithTimestamp(LOG_LEVELS.PROMPT, `${message}\n${promptText}`);
        
        // Temporarily disable spinner for prompt output
        hideSpinner();
        console.log(formattedPrompt);
        showSpinner();
        
        // Also write to log file
        writeToLogFile(formattedPrompt)
            .catch(err => console.error('Error writing prompt to log file:', err));
        
        if (config.SYSTEM?.NOTIFICATION_LEVELS && 
            config.SYSTEM.NOTIFICATION_LEVELS.PROMPT === true) {
            notifyAdmin(`[PROMPT] ${message}\n\n${promptText}`).catch(error => 
                console.error('Failed to notify admin of prompt:', formatError(error))
            );
        }
    },
    
    // Specific event loggers
    startup: (message) => {
        log('STARTUP', message, null, true);
        startSpinner();
    },
    shutdown: (message) => {
        stopSpinner();
        log('SHUTDOWN', message, null, true);
    },
    command: (command, user) => log(LOG_LEVELS.INFO, `Command: ${command} by ${user}`, null, true),
    
    // Export notifyAdmin for external use
    notifyAdmin
};

module.exports = logger; 