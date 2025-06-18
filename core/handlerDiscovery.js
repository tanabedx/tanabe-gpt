const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

/**
 * Converts a handler function name to a command name.
 * e.g., handleMyCommand -> MY_COMMAND
 * @param {string} handlerName - The name of the handler function.
 * @returns {string|null} - The generated command name or null.
 */
function handlerNameToCommandName(handlerName) {
    if (!handlerName.startsWith('handle')) {
        return null;
    }
    
    const pascal = handlerName.substring(6);
    return pascal.replace(/([a-z])([A-Z])/g, '$1_$2').toUpperCase();
}

/**
 * Discovers and loads command handlers from the file system.
 * @returns {Object} - A map of command names to handler functions.
 */
function discoverHandlers() {
    const handlers = {};
    const rootDir = path.resolve(__dirname, '..');
    const handlerFailures = [];

    logger.debug(' Scanning for command handlers...');

    // Directories to skip during scanning
    const skipDirs = ['node_modules', '.git', 'wwebjs', 'auth_main', 'auth_test', '.DS_Store', 'configs'];

    try {
        const entries = fs.readdirSync(rootDir, { withFileTypes: true });
        const directories = entries.filter(entry => 
            entry.isDirectory() && 
            !entry.name.startsWith('.') && 
            !skipDirs.includes(entry.name)
        );

        for (const dir of directories) {
            const handlerPath = path.join(rootDir, dir.name, `${dir.name}.js`);
            if (fs.existsSync(handlerPath)) {
                try {
                    const exported = require(handlerPath);
                    for (const [name, func] of Object.entries(exported)) {
                        if (typeof func === 'function') {
                            const commandName = handlerNameToCommandName(name);
                            if (commandName) {
                                if (handlers[commandName]) {
                                    logger.warn(`⚠ Duplicate handler for command ${commandName} found in ${handlerPath}. Overwriting.`);
                                }
                                handlers[commandName] = func;
                                logger.debug(`Discovered handler: ${name} for command: ${commandName}`);
                            }
                        }
                    }
                } catch (error) {
                    const errorMsg = `⚠ Failed to load handlers from ${handlerPath}: ${error.message}`;
                    logger.warn(errorMsg);
                    handlerFailures.push(errorMsg);
                }
            }
        }

        // Special case for commandList handler in core directory
        const commandListHandlerPath = path.join(__dirname, 'commandList.js');
        if (fs.existsSync(commandListHandlerPath)) {
            try {
                const { handleCommandList } = require(commandListHandlerPath);
                if (handleCommandList) {
                    handlers['COMMAND_LIST'] = handleCommandList;
                    handlers['COMMANDLIST'] = handleCommandList; // Also map COMMANDLIST to the same handler
                    logger.debug('Discovered handler: handleCommandList for command: COMMAND_LIST and COMMANDLIST');
                }
            } catch (error) {
                logger.warn(`⚠ Failed to load commandList handler from core: ${error.message}`);
            }
        }

    } catch (error) {
        logger.error(`❌ Error during handler discovery: ${error.message}`);
    }

    const handlerCount = Object.keys(handlers).length;
    logger.debug(`Discovered ${handlerCount} handlers total`);

    if (handlerFailures.length > 0) {
        logger.warn(`⚠️  ${handlerFailures.length} handler file(s) failed to load`);
    }

    return handlers;
}

module.exports = { discoverHandlers }; 