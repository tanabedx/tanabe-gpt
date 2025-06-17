const commandManager = require('./CommandManager');
const { discoverHandlers } = require('./handlerDiscovery');
const { discoverCommands } = require('./commandDiscovery');
const logger = require('../utils/logger');

function validateHandlers(commands, handlers) {
    const commandNames = Object.keys(commands);
    const handlerNames = Object.keys(handlers);
    let allValid = true;

    logger.debug('Validating command and handler alignment...');

    // Check for commands without handlers
    for (const commandName of commandNames) {
        if (!handlers[commandName]) {
            logger.warn(`⚠️ Command '${commandName}' has a configuration but no registered handler.`);
            allValid = false;
        }
    }

    // Check for handlers without commands
    for (const handlerName of handlerNames) {
        if (!commands[handlerName]) {
            logger.warn(`⚠️ Handler for '${handlerName}' is registered but has no command configuration.`);
            allValid = false;
        }
    }

    if (allValid) {
        logger.debug('All commands and handlers are correctly aligned.');
    } else {
        logger.warn('⚠️ Some commands and handlers are misaligned. Bot will continue but some commands may not work properly.');
    }

    return allValid;
}

// Register all command handlers
function registerCommands() {
    logger.debug('Registering command handlers...');

    const handlers = discoverHandlers();
    const commands = discoverCommands();

    validateHandlers(commands, handlers);

    for (const [commandName, handler] of Object.entries(handlers)) {
        commandManager.registerHandler(commandName, handler);
    }

    logger.debug('Command handlers registered successfully');
}

module.exports = {
    registerCommands,
    commandManager,
};
