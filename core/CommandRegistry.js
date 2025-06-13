const commandManager = require('./CommandManager');
const { discoverHandlers } = require('./handlerDiscovery');
const logger = require('../utils/logger');

// Register all command handlers
function registerCommands() {
    logger.debug('Registering command handlers...');

    const handlers = discoverHandlers();

    for (const [commandName, handler] of Object.entries(handlers)) {
        commandManager.registerHandler(commandName, handler);
    }

    logger.debug('Command handlers registered successfully');
}

module.exports = {
    registerCommands,
    commandManager,
};
