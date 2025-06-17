// core/commandDiscovery.js
// Automatic command configuration discovery

const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

// Log file configuration
const LOG_FILE = 'tanabe-gpt.log';

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

// Check logging levels from environment variables (to avoid circular dependency)
function shouldLog(level) {
    // In test mode, force certain logs
    if (process.env.TEST_MODE === 'true') {
        return level === 'INFO' || level === 'ERROR' || level === 'WARN';
    }
    
    // Check environment variables for forced logging
    if (process.env.FORCE_DEBUG_LOGS === 'true' && level === 'DEBUG') return true;
    if (process.env.FORCE_PROMPT_LOGS === 'true' && level === 'PROMPT') return true;
    
    // Default levels (matching logger.js defaults)
    const defaultLevels = {
        ERROR: true,
        WARN: true,
        INFO: true,
        DEBUG: false,
        STARTUP: true,
    };
    
    return defaultLevels[level] || false;
}

// Write to log file (matches logger.js format)
async function writeToLogFile(message) {
    try {
        await fs.promises.appendFile(LOG_FILE, message + '\n');
    } catch (error) {
        // Silent fail to avoid recursion
    }
}

// Format timestamp (matches logger.js format)
function formatTimestamp() {
    const now = new Date();
    return now.toLocaleString('en-US', {
        month: 'short',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
    });
}

// Simple logger that matches logger.js style without circular dependency
function log(level, message) {
    if (!shouldLog(level)) return;
    
    const timestamp = formatTimestamp();
    let formattedMessage;
    
    // In test mode, don't use colors
    if (process.env.TEST_MODE === 'true') {
        formattedMessage = `[${timestamp}] [${level}] ${message}`;
    } else {
        switch (level) {
            case 'ERROR':
                formattedMessage = `${COLORS.BOLD}${COLORS.RED}[${timestamp}] [${level}]${COLORS.RESET} ${message}`;
                break;
            case 'WARN':
                formattedMessage = `${COLORS.YELLOW}[${timestamp}] [${level}]${COLORS.RESET} ${message}`;
                break;
            case 'INFO':
                formattedMessage = `[${timestamp}] ${COLORS.GREEN}[${level}]${COLORS.RESET} ${message}`;
                break;
            case 'DEBUG':
                formattedMessage = `[${timestamp}] ${COLORS.BLUE}[${level}]${COLORS.RESET} ${COLORS.GREY}${message}${COLORS.RESET}`;
                break;
            case 'STARTUP':
                formattedMessage = `[${timestamp}] ${COLORS.BOLD}${COLORS.GREEN}[${level}]${COLORS.RESET} ${COLORS.BOLD}${COLORS.GREEN}${message}${COLORS.RESET}`;
                break;
            default:
                formattedMessage = `[${timestamp}] [${level}] ${message}`;
        }
    }
    
    console.log(formattedMessage);
    writeToLogFile(formattedMessage).catch(() => {}); // Silent fail
}

/**
 * @returns {string} - The command name.
 */
function mapFileNameToCommandName(filePath) {
    if (!filePath) {
        return null;
    }

    return path.basename(filePath, '.config.js').toUpperCase();
}

/**
 * Automatically discovers and loads command configurations from .config.js files
 * Scans the parent directory for subdirectories containing .config.js files
 */
function discoverCommands() {
    const commands = {};
    const rootDir = path.resolve(__dirname, '..');
    const configFailures = [];
    
    log('DEBUG', 'Scanning for command configurations...');
    
    // Directories to skip during scanning
    const skipDirs = ['node_modules', '.git', '.wwebjs_cache', 'auth_main', 'auth_test', '.DS_Store'];
    
    /**
     * Recursively scan directories for .config.js files
     */
    function scanDirectory(dirPath, maxDepth = 2, currentDepth = 0) {
        if (currentDepth >= maxDepth) return;
        
        try {
            const files = fs.readdirSync(dirPath);
            const configFiles = files.filter(file => file.endsWith('.config.js'));
            
            // Process config files in current directory
            for (const configFile of configFiles) {
                const configPath = path.join(dirPath, configFile);
                const relativePath = path.relative(__dirname, configPath);
                
                try {
                    const config = require(relativePath);
                    
                    // Determine command name from file name
                    let commandName = mapFileNameToCommandName(configPath);
                    
                    // Handle different config export patterns
                    if (typeof config === 'object' && !config.prefixes && !config.description) {
                        // Multi-config file (like admin.config.js)
                        const configKeys = Object.keys(config);
                        for (const key of configKeys) {
                            if (key.includes('CONFIG') && typeof config[key] === 'object') {
                                const configName = key.replace('_CONFIG', '');
                                commands[configName] = config[key];
                                log('DEBUG', `✓ Discovered command: ${configName} from ${relativePath}`);
                            }
                        }
                    } else if (config.prefixes || config.description) {
                        // Standard single config export
                        commands[commandName] = config;
                        log('DEBUG', `✓ Discovered command: ${commandName} from ${relativePath}`);
                    } else {
                        // Check if it's an object with named configs (like ayub.config.js)
                        for (const [key, val] of Object.entries(config)) {
                            if (typeof val === 'object' && (val.prefixes || val.description)) {
                                let configName = key.replace(/_CONFIG$/, '');
                                commands[configName] = val;
                                log('DEBUG', `✓ Discovered command: ${configName} from ${relativePath}`);
                            }
                        }
                    }
                    
                } catch (error) {
                    const errorMsg = `⚠ Failed to load config ${configPath}: ${error.message}`;
                    log('WARN', errorMsg);
                    configFailures.push(errorMsg);
                    
                    if (error.code === 'MODULE_NOT_FOUND') {
                        log('DEBUG', `Require stack:\n- ${error.requireStack?.join('\n- ') || 'Unknown'}`);
                    }
                }
            }
            
            // Recursively scan subdirectories (skip unwanted directories)
            const subdirs = files.filter(file => {
                if (skipDirs.includes(file)) return false;
                const fullPath = path.join(dirPath, file);
                try {
                    return fs.statSync(fullPath).isDirectory() && !file.startsWith('.');
                } catch (error) {
                    return false;
                }
            });
            
            for (const subdir of subdirs) {
                const subdirPath = path.join(dirPath, subdir);
                scanDirectory(subdirPath, maxDepth, currentDepth + 1);
            }
            
        } catch (error) {
            // Skip directories we can't read
            return;
        }
    }
    
    try {
        // Get all directories in the root
        const entries = fs.readdirSync(rootDir, { withFileTypes: true });
        const directories = entries.filter(entry => 
            entry.isDirectory() && 
            !entry.name.startsWith('.') && 
            !skipDirs.includes(entry.name)
        );
        
        // Scan each top-level directory
        for (const dir of directories) {
            const dirPath = path.join(rootDir, dir.name);
            scanDirectory(dirPath);
        }
        
        // Handle special case: commandList.config.js in configs directory
        try {
            const commandListPath = path.join(rootDir, 'configs', 'commandList.config.js');
            if (fs.existsSync(commandListPath)) {
                const commandListConfig = require(path.resolve(commandListPath));
                commands['COMMAND_LIST'] = commandListConfig;
                log('DEBUG', `✓ Discovered command: COMMAND_LIST from ../configs/commandList.config.js`);
            } else {
                log('WARN', `⚠ File not found: ${commandListPath}`);
            }
        } catch (error) {
            const errorMsg = `⚠ Failed to load config ../configs/commandList.config.js: ${error.message}`;
            log('WARN', errorMsg);
            configFailures.push(errorMsg);
        }
        
    } catch (error) {
        log('ERROR', `❌ Error during command discovery: ${error.message}`);
    }
    
    const commandCount = Object.keys(commands).length;
    log('DEBUG', `Discovered ${commandCount} commands total`);
    
    if (configFailures.length > 0) {
        log('WARN', `⚠️  ${configFailures.length} configuration(s) failed to load`);
    }
    
    return commands;
}

/**
 * Generates a dynamic command prefix mapping from discovered commands.
 * Maps command prefixes (without #) to command names.
 * @returns {Object} - A map of prefixes to command names.
 */
function generateCommandPrefixMap() {
    const commands = discoverCommands();
    const prefixMap = {};
    
    for (const [commandName, commandConfig] of Object.entries(commands)) {
        if (commandConfig.prefixes && Array.isArray(commandConfig.prefixes)) {
            for (const prefix of commandConfig.prefixes) {
                // Remove # from prefix if present
                const cleanPrefix = prefix.startsWith('#') ? prefix.substring(1) : prefix;
                
                // Skip empty prefixes (like '#' -> '') to avoid conflicts
                if (cleanPrefix.trim() !== '') {
                    prefixMap[cleanPrefix.toLowerCase()] = commandName;
                }
            }
        }
    }
    
    logger.debug('Generated dynamic command prefix map', { 
        prefixCount: Object.keys(prefixMap).length,
        prefixes: Object.keys(prefixMap)
    });
    
    return prefixMap;
}

module.exports = { discoverCommands, generateCommandPrefixMap }; 