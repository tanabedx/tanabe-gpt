const fs = require('fs').promises;

// Log levels
const LOG_LEVELS = {
    ERROR: 'ERROR',
    WARN: 'WARN',
    INFO: 'INFO',
    DEBUG: 'DEBUG',
    SUMMARY: 'SUMMARY',
    PROMPT: 'PROMPT',
    STARTUP: 'STARTUP',
};

// --- START OF LOCAL LOGGER CONFIGURATION ---

// Console Log Levels: Determines which log types are written to the console.
const CONSOLE_LOG_LEVELS = {
    ERROR: true,
    WARN: true,
    INFO: true,
    DEBUG: false, // Set to true for detailed debugging logs
    SUMMARY: true,
    STARTUP: true,
    SHUTDOWN: true,
    PROMPT: false, // Set to true to log full AI prompts
    COMMAND: true,
};

// Notification Levels: Determines which log types trigger a WhatsApp notification to the admin.
const NOTIFICATION_LEVELS = {
    ERROR: true,
    WARN: false,
    INFO: false,
    DEBUG: false,
    SUMMARY: true,
    STARTUP: true,
    SHUTDOWN: true,
    PROMPT: false,
    COMMAND: false,
};

// Debug file configuration
const DEBUG_FILE_ENABLED = true; // Set to false to disable debug file writing

// --- END OF LOCAL LOGGER CONFIGURATION ---

// Log file configuration
const LOG_FILE = 'tanabe-gpt.log';
const DEBUG_LOG_FILE = 'tanabe-gpt-debug.log';

// ANSI color codes
const COLORS = {
    RED: '\x1b[31m',
    YELLOW: '\x1b[33m',
    GREEN: '\x1b[32m',
    BLUE: '\x1b[34m',
    PURPLE: '\x1b[35m',
    GREY: '\x1b[90m',
    BOLD: '\x1b[1m',
    RESET: '\x1b[0m',
};

// Spinner configuration
const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
let spinnerInterval = null;
let spinnerPosition = 0;
let isSpinnerActive = false;

// Function to check if running under systemd
function isSystemdEnvironment() {
    return (
        process.env.INVOCATION_ID !== undefined ||
        process.env.JOURNAL_STREAM !== undefined ||
        process.env.SYSTEMD_EXEC_PID !== undefined
    );
}

// Function to check if debug mode is active (for showing location info)
function isDebugMode() {
    return (
        CONSOLE_LOG_LEVELS.DEBUG === true ||
        process.env.FORCE_DEBUG_LOGS === 'true' ||
        process.env.FORCE_PROMPT_LOGS === 'true' ||
        process.env.NODE_ENV === 'development' ||
        process.env.npm_lifecycle_event === 'dev'
    );
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
console.log = function (...args) {
    hideSpinner();
    originalConsoleLog.apply(console, args);
    showSpinner();
};

// Override console.error to handle spinner
const originalConsoleError = console.error;
console.error = function (...args) {
    hideSpinner();
    originalConsoleError.apply(console, args);
    showSpinner();
};

// Override console.warn to handle spinner
const originalConsoleWarn = console.warn;
console.warn = function (...args) {
    hideSpinner();
    originalConsoleWarn.apply(console, args);
    showSpinner();
};

// Function to format error objects
function formatError(error) {
    if (!error) return 'Unknown error';
    if (typeof error === 'string') return error;

    // Get the first line of the stack trace that isn't from node_modules
    const stackLine =
        error.stack
            ?.split('\n')
            .find(line => line.includes('at') && !line.includes('node_modules'))
            ?.trim()
            ?.split('at ')[1] || 'unknown location';

    // Extract just the file name and line number
    const match = stackLine.match(/[^/]*\.js:\d+/);
    const location = match ? match[0] : stackLine;

    return `${error.message} (${location})`;
}

// Function to get the caller's location (file:line)
function getCallerLocation() {
    // Only capture location if debug mode is active
    if (!isDebugMode()) {
        return '';
    }
    
    const error = new Error();
    const stack = error.stack.split('\n');



    // Look for the first line that's not from logger.js and not node internals
    // Start from index 1 to skip the "Error" line
    for (let i = 1; i < stack.length; i++) {
        const line = stack[i];
        
        // Skip lines that are from logger.js, node internals, or empty
        if (!line || 
            line.includes('/logger.js:') ||  // More specific - only skip the actual logger.js file
            line.includes('\\logger.js:') || // Handle Windows paths
            line.includes('node:internal') ||
            line.includes('internal/') ||
            !line.includes('at ')) {
            continue;
        }

        // Extract file path and line number from stack trace
        // Format: "    at functionName (/path/to/file.js:line:col)"
        const match = line.match(/at\s+[^(]*\(([^)]+):(\d+):\d+\)/);
        
        if (!match) {
            continue;
        }

        const fullPath = match[1];
        const lineNumber = match[2];

        // Skip if it's still an internal path or if it's a logger internal function
        if (fullPath.includes('node_modules') || 
            fullPath.includes('internal/') ||
            fullPath.startsWith('node:') ||
            fullPath.endsWith('/logger.js')) {  // Also skip paths ending with /logger.js
            continue;
        }

        // Extract just the filename from the path
        const filename = fullPath.split('/').pop();

        return ` ${COLORS.GREY}[${filename}:${lineNumber}]${COLORS.RESET}`;
    }

    return ` ${COLORS.GREY}[unknown]${COLORS.RESET}`;
}

// Function to format the log message with timestamp
function formatLogWithTimestamp(level, message, error = null, forFile = false, location = null) {
    const now = new Date();
    const timestamp = now.toLocaleString('en-US', {
        month: 'short',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
    });

    let prefix = `[${timestamp}] [${level}]`;
    let formattedMessage = message;
    let indent = ' '.repeat(prefix.length + 1); // Calculate indentation based on prefix length

    // Use provided location or get it once
    if (!location) {
        location = getCallerLocation();
    }

    // For file output or test mode, return clean format without colors and minimal indentation
    // Unless FORCE_COLORS_IN_FILES is set to true
    if ((forFile || process.env.TEST_MODE === 'true') && process.env.FORCE_COLORS_IN_FILES !== 'true') {
        // Strip ANSI color codes from location for file output
        const cleanLocation = location.replace(/\x1b\[[0-9;]*m/g, '');
        
        // Handle multi-line messages for file output
        if (typeof message === 'string' && message.includes('\n')) {
            const lines = message.split('\n');
            const firstLine = `${prefix} ${lines[0]}${error ? `: ${formatError(error)}` : ''}${cleanLocation}`;
            const otherLines = lines.slice(1).map(line => line); // Keep tree structure as-is for files
            return [firstLine, ...otherLines].join('\n');
        }
        return `${prefix} ${message}${error ? `: ${formatError(error)}` : ''}${cleanLocation}`;
    }

    switch (level) {
        case LOG_LEVELS.ERROR:
            prefix = `${COLORS.GREY}[${timestamp}]${COLORS.RESET} ${COLORS.BOLD}${COLORS.RED}[${level}]${COLORS.RESET}`;
            formattedMessage = `${message}${error ? `: ${formatError(error)}` : ''}${location}`;
            break;
        case LOG_LEVELS.WARN:
            prefix = `${COLORS.GREY}[${timestamp}]${COLORS.RESET} ${COLORS.YELLOW}[${level}]${COLORS.RESET}`;
            formattedMessage = `${message}${error ? `: ${formatError(error)}` : ''}${location}`;
            break;
        case LOG_LEVELS.INFO:
            prefix = `${COLORS.GREY}[${timestamp}]${COLORS.RESET} ${COLORS.GREEN}[${level}]${COLORS.RESET}`;
            formattedMessage = `${message}${location}`; // Regular white text
            break;
        case LOG_LEVELS.DEBUG:
            prefix = `${COLORS.GREY}[${timestamp}]${COLORS.RESET} ${COLORS.BLUE}[${level}]${COLORS.RESET}`;
            formattedMessage = `${COLORS.GREY}${message}${COLORS.RESET}${location}`;
            break;
        case LOG_LEVELS.SUMMARY:
            prefix = `${COLORS.GREY}[${timestamp}]${COLORS.RESET} ${COLORS.PURPLE}[${level}]${COLORS.RESET}`;
            formattedMessage = `${COLORS.GREY}${message}${COLORS.RESET}${location}`;
            break;
        case LOG_LEVELS.PROMPT:
            prefix = `${COLORS.GREY}[${timestamp}]${COLORS.RESET} ${COLORS.PURPLE}[${level}]${COLORS.RESET}`;
            formattedMessage = `${COLORS.GREY}${message}${COLORS.RESET}${location}`;
            break;
        case LOG_LEVELS.STARTUP:
            prefix = `${COLORS.GREY}[${timestamp}]${COLORS.RESET} ${COLORS.BOLD}${COLORS.GREEN}[${level}]${COLORS.RESET}`;
            formattedMessage = `${COLORS.BOLD}${COLORS.GREEN}${message}${COLORS.RESET}${location}`;
            break;
    }

    // Handle multi-line messages
    if (typeof formattedMessage === 'string') {
        // Remove empty lines and normalize line endings
        formattedMessage = formattedMessage
            .replace(/\r\n/g, '\n')
            .split('\n')
            .filter(line => line.trim() !== '') // Remove empty lines
            .join('\n');

        if (formattedMessage.includes('\n')) {
            const lines = formattedMessage.split('\n');
            formattedMessage = lines
                .map((line, index) => {
                    if (index === 0) return line;
                    return `${indent}${line}`;
                })
                .join('\n');
        }
    }

    let logMessage = `${prefix} ${formattedMessage}`;

    return logMessage;
}

// Function to format admin notification message
function formatAdminMessage(message, error = null) {
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

// Function to parse log timestamp and return Date object
function parseLogTimestamp(logLine) {
    try {
        // Extract timestamp from log line - handle both formats:
        // Current format: [Dec 20 14:32] [LEVEL]
        // Legacy format: [Dec 20, 14:32] [LEVEL] (with comma)
        const timestampMatch = logLine.match(/^\[([A-Za-z]{3} \d{1,2},? \d{2}:\d{2})\]/);
        if (!timestampMatch) return null;

        let timestampStr = timestampMatch[1];
        const currentYear = new Date().getFullYear();
        
        // Remove comma if present for consistent parsing
        timestampStr = timestampStr.replace(',', '');
        
        // Parse the timestamp and add current year
        const logDate = new Date(`${timestampStr} ${currentYear}`);
        
        // Handle year rollover - if parsed date is in the future, it's from previous year
        if (logDate > new Date()) {
            logDate.setFullYear(currentYear - 1);
        }
        
        return logDate;
    } catch (error) {
        return null;
    }
}

// Function to check if a log line is from the last 24 hours
function isLogFromRecentDays(logLine) {
    const logDate = parseLogTimestamp(logLine);
    if (!logDate) return false;
    
    const now = new Date();
    const twentyFourHoursAgo = new Date(now.getTime() - (24 * 60 * 60 * 1000));
    
    // Check if log timestamp is within the last 24 hours
    return logDate >= twentyFourHoursAgo && logDate <= now;
}

// Function to clean old logs, keeping only logs from the last 24 hours
async function cleanOldLogs() {
    try {
        // Clean main log file
        await cleanLogFile(LOG_FILE);
        
        // Clean debug log file only if enabled
        if (DEBUG_FILE_ENABLED) {
            await cleanLogFile(DEBUG_LOG_FILE);
        }
        
        logger.debug(`Log cleanup completed - kept logs from the last 24 hours only`);
        
    } catch (error) {
        console.error('Error cleaning old logs:', formatError(error));
    }
}

// Function to clean a specific log file
async function cleanLogFile(filePath) {
    try {
        // Read the current log file
        const logContent = await fs.readFile(filePath, 'utf8').catch(() => '');
        if (!logContent.trim()) return;

        // Split into lines and filter to keep only recent logs
        const lines = logContent.split('\n');
        const recentLines = [];
        let inStartupReport = false;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            
            // Check if this line starts a startup report
            if (line.includes('TANABE-GPT STARTUP REPORT')) {
                // Check if the timestamp on this line is recent
                if (isLogFromRecentDays(line)) {
                    recentLines.push(line);
                    inStartupReport = true;
                }
                continue;
            }
            
            // If we're in a startup report, keep all lines until the next timestamp
            if (inStartupReport) {
                if (line.match(/^\[[A-Za-z]{3} \d{1,2},? \d{2}:\d{2}\]/)) {
                    // New timestamped entry, check if it's recent
                    inStartupReport = false;
                    if (isLogFromRecentDays(line)) {
                        recentLines.push(line);
                    }
                } else {
                    // Part of startup report tree structure
                    recentLines.push(line);
                }
                continue;
            }
            
            // Regular filtering for other lines
            if (!line.trim() || !line.match(/^\[[A-Za-z]{3} \d{1,2},? \d{2}:\d{2}\]/)) {
                continue; // Skip empty lines and non-timestamped lines
            }
            
            if (isLogFromRecentDays(line)) {
                recentLines.push(line);
            }
        }

        // Write filtered content back to file
        if (recentLines.length > 0) {
            await fs.writeFile(filePath, recentLines.join('\n') + '\n');
        } else {
            // If no recent logs, create empty file
            await fs.writeFile(filePath, '');
        }
        
    } catch (error) {
        console.error(`Error cleaning log file ${filePath}:`, formatError(error));
    }
}

// Function to write to log file
async function writeToLogFile(message) {
    try {
        await fs.appendFile(LOG_FILE, message + '\n');
    } catch (error) {
        console.error('Error writing to log file:', error);
    }
}

// Function to write to debug log file
async function writeToDebugFile(message) {
    try {
        await fs.appendFile(DEBUG_LOG_FILE, message + '\n');
    } catch (error) {
        console.error('Error writing to debug log file:', error);
    }
}

// Core debug logging function that always logs to debug file regardless of console flags
async function logToDebugFile(level, message, error = null, location = null) {
    // Only write to debug file if enabled
    if (!DEBUG_FILE_ENABLED) {
        return;
    }
    
    // Format the message for debug file (always log everything) with file formatting
    const formattedMessage = formatLogWithTimestamp(level, message, error, true, location);
    
    // Always write to debug file regardless of console settings
    await writeToDebugFile(formattedMessage);
}

// Functionto notify admin
async function notifyAdmin(message) {
    try {
        // Lazy-load credentials only when needed to avoid cycles
        const { ADMIN_NUMBER } = require('../configs/credentials');
        if (!global.client || !ADMIN_NUMBER) {
            if (!global.pendingAdminNotifications) {
                global.pendingAdminNotifications = [];
            }
            global.pendingAdminNotifications.push(message);
            return;
        }

        const adminContact = `${ADMIN_NUMBER}@c.us`;

        try {
            await global.client.sendMessage(adminContact, message);
        } catch (error) {
            // Handle case where client is ready but sending fails
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
    // Capture location once at the beginning
    const location = getCallerLocation();
    
    // Always write to debug file regardless of console settings
    await logToDebugFile(level, message, error, location);
    
    // Check if this log level is enabled in console settings for main log and console output
    if (CONSOLE_LOG_LEVELS[level] !== true) {
        return;
    }

    // Format messages separately for console and file, passing the location
    const consoleMessage = formatLogWithTimestamp(level, message, error, false, location); // With colors and indentation
    const fileMessage = formatLogWithTimestamp(level, message, error, true, location);    // Clean format for files

    // Write to main log file (only if console level is enabled)
    await writeToLogFile(fileMessage);

    // Use appropriate console method based on level
    switch (level) {
        case LOG_LEVELS.ERROR:
            console.error(consoleMessage);
            break;
        case LOG_LEVELS.WARN:
            console.warn(consoleMessage);
            break;
        case LOG_LEVELS.DEBUG:
            if (typeof message === 'object') {
                console.log(formatLogWithTimestamp(level, JSON.stringify(message, null, 2)));
            } else {
                console.log(consoleMessage);
            }
            if (error) {
                console.log(formatLogWithTimestamp(level, `Error: ${formatError(error)}`));
            }
            break;
        default:
            console.log(consoleMessage);
    }

    // Check if this log level should be sent to admin
    if (shouldNotifyAdmin && NOTIFICATION_LEVELS[level] === true) {
        const adminMessage = formatAdminMessage(message, error);
        await notifyAdmin(adminMessage);
    }
}

// Convenience methods for different log levels
const logger = {
    error: (message, error = null) => log(LOG_LEVELS.ERROR, message, error, true),
    warn: (message, error = null, shouldNotifyAdmin = true) =>
        log(LOG_LEVELS.WARN, message, error, shouldNotifyAdmin),
    info: message => log(LOG_LEVELS.INFO, message, null, true),
    debug: (message, obj = null) => {
        // Capture location once for debug calls
        const location = getCallerLocation();
        
        // Always write to debug file regardless of console settings
        if (obj) {
            // If an object is provided, log both the message and the object to debug file
            logToDebugFile(LOG_LEVELS.DEBUG, message, null, location);
            logToDebugFile(LOG_LEVELS.DEBUG, `Data: ${JSON.stringify(obj, null, 2)}`, null, location);
        } else if (typeof message === 'object') {
            // If message is an object, stringify it for debug file
            logToDebugFile(LOG_LEVELS.DEBUG, JSON.stringify(message, null, 2), null, location);
        } else {
            // Otherwise just log the message to debug file
            logToDebugFile(LOG_LEVELS.DEBUG, message, null, location);
        }

        // Only proceed with console/main log output if DEBUG is explicitly set to true OR if forced via environment variable
        if (CONSOLE_LOG_LEVELS.DEBUG !== true && process.env.FORCE_DEBUG_LOGS !== 'true') {
            return;
        }

        // Format the log message for console output (with colors)
        let consoleMessage;
        let fileMessage;
        
        if (obj) {
            // If an object is provided, log both the message and the object
            consoleMessage = formatLogWithTimestamp(LOG_LEVELS.DEBUG, message, null, false, location);
            fileMessage = formatLogWithTimestamp(LOG_LEVELS.DEBUG, message, null, true, location);
            console.log(consoleMessage);
            
            const objConsoleMessage = formatLogWithTimestamp(LOG_LEVELS.DEBUG, `Data: ${JSON.stringify(obj, null, 2)}`, null, false, location);
            const objFileMessage = formatLogWithTimestamp(LOG_LEVELS.DEBUG, `Data: ${JSON.stringify(obj, null, 2)}`, null, true, location);
            console.log(objConsoleMessage);
            
            // Write both messages to file
            writeToLogFile(fileMessage).catch(err => console.error('Error writing log to file:', err));
            writeToLogFile(objFileMessage).catch(err => console.error('Error writing log to file:', err));
        } else if (typeof message === 'object') {
            // If message is an object, stringify it
            const stringifiedMessage = JSON.stringify(message, null, 2);
            consoleMessage = formatLogWithTimestamp(LOG_LEVELS.DEBUG, stringifiedMessage, null, false, location);
            fileMessage = formatLogWithTimestamp(LOG_LEVELS.DEBUG, stringifiedMessage, null, true, location);
            console.log(consoleMessage);
            
            // Write to main log file
            writeToLogFile(fileMessage).catch(err => console.error('Error writing log to file:', err));
        } else {
            // Otherwise just log the message
            consoleMessage = formatLogWithTimestamp(LOG_LEVELS.DEBUG, message, null, false, location);
            fileMessage = formatLogWithTimestamp(LOG_LEVELS.DEBUG, message, null, true, location);
            console.log(consoleMessage);
            
            // Write to main log file
            writeToLogFile(fileMessage).catch(err => console.error('Error writing log to file:', err));
        }
    },
    summary: message => log(LOG_LEVELS.SUMMARY, message, null, true),
    prompt: (message, promptText) => {
        // Capture location once for prompt calls
        const location = getCallerLocation();
        
        // Handle undefined promptText
        if (promptText === undefined) {
            console.warn(formatLogWithTimestamp('WARN', 'Undefined prompt text received', null, false, location));
            promptText = 'UNDEFINED PROMPT';
        }

        // Format the prompt text to remove extra whitespace and normalize line endings
        promptText = promptText
            .replace(/\r\n/g, '\n')
            .split('\n')
            .map(line => line.trim())
            .filter(line => line !== '')
            .join('\n');

        // Always write to debug file regardless of console settings
        logToDebugFile(LOG_LEVELS.PROMPT, `${message}\n${promptText}`, null, location);

        // Only proceed with console/main log output if PROMPT is explicitly set to true OR if forced via environment variable
        if (CONSOLE_LOG_LEVELS.PROMPT !== true && process.env.FORCE_PROMPT_LOGS !== 'true') {
            return;
        }

        // Format the prompt header and text together
        const formattedPrompt = formatLogWithTimestamp(
            LOG_LEVELS.PROMPT,
            `${message}\n${promptText}`,
            null,
            false,
            location
        );

        // Temporarily disable spinner for prompt output
        hideSpinner();
        console.log(formattedPrompt);
        showSpinner();

        // Also write to main log file (with file formatting)
        const formattedPromptFile = formatLogWithTimestamp(
            LOG_LEVELS.PROMPT,
            `${message}\n${promptText}`,
            null,
            true,
            location
        );
        writeToLogFile(formattedPromptFile).catch(err =>
            console.error('Error writing prompt to log file:', err)
        );

        if (NOTIFICATION_LEVELS.PROMPT === true) {
            notifyAdmin(`[PROMPT] ${message}\n\n${promptText}`).catch(error =>
                console.error('Failed to notify admin of prompt:', formatError(error))
            );
        }
    },

    // Specific event loggers
    startup: async message => {
        // Clean old logs first, keeping only logs from the last 24 hours
        await cleanOldLogs();
        
        // Then proceed with normal startup logging
        await log('STARTUP', message, null, true);
        startSpinner();
    },
    shutdown: message => {
        stopSpinner();
        log('SHUTDOWN', message, null, true);
    },
    command: (command, user) => log(LOG_LEVELS.INFO, `Command: ${command} by ${user}`, null, true),

    // Export notifyAdmin for external use
    notifyAdmin,
    
    // Export cleanOldLogs for external use
    cleanOldLogs,
    
    // Export spinner controls for external use
    startSpinner,
    stopSpinner,
    
    // System status logger for comprehensive startup reports
    systemStatus: async (statusData) => {
        // Build tree-style report
        let report = 'TANABE-GPT STARTUP REPORT\n';
        
        // Version Information
        report += '├── Version Information\n';
        report += `│   ├── Git Status: ${statusData.version.gitStatus}\n`;
        report += `│   └── Commit: ${statusData.version.commitInfo}\n`;
        report += '│\n';
        
        // News Monitor
        report += '├── News Monitor\n';
        report += `│   ├── Status: ${statusData.newsMonitor.enabled ? 'Enabled' : 'Disabled'}\n`;
        report += `│   ├── Sources: ${statusData.newsMonitor.totalSources} total\n`;
        
        // Sources breakdown
        if (statusData.newsMonitor.twitterSources && statusData.newsMonitor.twitterSources.length > 0 && statusData.newsMonitor.twitterSources[0] !== 'None') {
            report += `│   │   ├── Twitter: ${statusData.newsMonitor.twitterSources.join(', ')}\n`;
        }
        if (statusData.newsMonitor.rssSources && statusData.newsMonitor.rssSources.length > 0 && statusData.newsMonitor.rssSources[0] !== 'None') {
            report += `│   │   ├── RSS: ${statusData.newsMonitor.rssSources.join(', ')}\n`;
        }
        if (statusData.newsMonitor.webscraperSources && statusData.newsMonitor.webscraperSources.length > 0 && statusData.newsMonitor.webscraperSources[0] !== 'None') {
            report += `│   │   └── Webscraper: ${statusData.newsMonitor.webscraperSources.join(', ')}\n`;
        }
        
        report += `│   ├── Target Group: ${statusData.newsMonitor.targetGroup}\n`;
        report += '│   └── Twitter API Keys\n';
        
        // API Keys
        if (statusData.newsMonitor.apiKeys && statusData.newsMonitor.apiKeys.length > 0) {
            statusData.newsMonitor.apiKeys.forEach((key, index) => {
                const isLast = index === statusData.newsMonitor.apiKeys.length - 1;
                const prefix = isLast ? '└──' : '├──';
                
                // Color the cooldown message in yellow
                if (key.status === 'cooldown' && key.name === 'Keys on cooldown') {
                    report += `│       ${prefix} ${COLORS.YELLOW}${key.name}. ${key.usage}${COLORS.RESET}\n`;
                } else {
                    report += `│       ${prefix} ${key.name}: ${key.usage}\n`;
                }
            });
        }
        
        report += '│\n';
        
        // Periodic Summary
        report += '├── Periodic Summary\n';
        report += `│   ├── Groups: ${statusData.periodicSummary.groupCount} configured\n`;
        
        if (statusData.periodicSummary.groups && statusData.periodicSummary.groups.length > 0) {
            statusData.periodicSummary.groups.forEach((group, index) => {
                const isLast = index === statusData.periodicSummary.groups.length - 1;
                const prefix = isLast ? '└──' : '├──';
                report += `│   │   ${prefix} ${group.name}: ${group.schedule}\n`;
            });
        } else {
            report += '│   │   └── None configured\n';
        }
        
        report += `│   └── Next Summary: ${statusData.periodicSummary.nextSummary}\n`;
        report += '│\n';
        
        // Core Systems
        report += '├── Core Systems\n';
        report += '│   ├── WhatsApp Client\n';
        report += `│   │   ├── Authentication: ${statusData.coreSystems.whatsapp.authenticated ? 'Successful' : 'Failed'}\n`;
        report += `│   │   └── Session: ${statusData.coreSystems.whatsapp.sessionSaved ? 'Saved for future use' : 'Not saved'}\n`;
        report += `│   ├── Context Manager: ${statusData.coreSystems.contextManager ? 'Initialized' : 'Failed'}\n`;
        report += `│   ├── Conversation Manager: ${statusData.coreSystems.conversationManager ? 'Initialized' : 'Failed'}\n`;
        report += `│   └── Memory Monitoring: ${statusData.coreSystems.memoryMonitoring ? 'Started (16 min intervals)' : 'Failed to start'}\n`;
        report += '│\n';
        
        // Maintenance (Cache + Performance)
        report += '└── Maintenance\n';
        report += '    ├── Cache Management\n';
        report += `    │   ├── Files Cleared: ${statusData.cacheManagement.filesCleared}\n`;
        report += `    │   ├── Memory Usage: ${statusData.cacheManagement.memory}MB allocated\n`;
        report += `    │   └── Garbage Collection: ${statusData.optimization.gcEnabled ? `Enabled (${statusData.optimization.gcInterval})` : 'Disabled'}\n`;
        
        // Performance Optimization Status
        if (statusData.optimization) {
            report += '    └── Performance Optimization\n';
            report += `        ├── Mode: ${statusData.optimization.mode}\n`;
            report += `        ├── Puppeteer: ${statusData.optimization.puppeteer}\n`;
            report += `        ├── Thread Pool: ${statusData.optimization.threadPool} threads\n`;
            report += `        └── Memory Limit: ${statusData.optimization.memoryLimit}MB`;
        }
        
        // Log the comprehensive report
        await log(LOG_LEVELS.INFO, report);
    },
};

module.exports = logger;
