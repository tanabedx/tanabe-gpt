const commandManager = require('./CommandManager');
const { handleResumo } = require('../resumos/resumo');
const { handleAyub, handleAyubNewsFut } = require('../ayub/ayub');
const { handleSticker } = require('../sticker/sticker');
const handleDesenho = require('../desenho/desenho');
const {
    handleCacheClear,
    handleTwitterDebug,
    handleRssDebug,
    handleDebugPeriodic,
    handleConfig,
    handleNewsStatus,
    resetNewsCache,
    showCacheStats,
    handleNewsToggle,
    handleNewsDebug,
} = require('../admin/admin');
const { handleChat } = require('../chat/chat');
const { handleTag } = require('../tags/tag');
const { handleAudio } = require('../audio/audio');
const { startWizard } = require('../periodicSummary/wizard/wizard');
const { handleCommandList } = require('./commandList');
const logger = require('../utils/logger');

// Register all command handlers
function registerCommands() {
    logger.debug('Registering command handlers...');

    // Register each command handler
    commandManager.registerHandler('CHAT_GPT', handleChat);
    commandManager.registerHandler('RESUMO', handleResumo);
    commandManager.registerHandler('AYUB', handleAyub);
    commandManager.registerHandler('AYUB_NEWS_FUT', handleAyubNewsFut);
    commandManager.registerHandler('STICKER', handleSticker);
    commandManager.registerHandler('DESENHO', handleDesenho);
    commandManager.registerHandler('CACHE_CLEAR', handleCacheClear);
    commandManager.registerHandler('TWITTER_DEBUG', handleTwitterDebug);
    commandManager.registerHandler('RSS_DEBUG', handleRssDebug);
    commandManager.registerHandler('NEWS_STATUS', handleNewsStatus);
    commandManager.registerHandler('NEWS_TOGGLE', handleNewsToggle);
    commandManager.registerHandler('DEBUG_PERIODIC', handleDebugPeriodic);
    commandManager.registerHandler('CONFIG', handleConfig);
    commandManager.registerHandler('AUDIO', handleAudio);
    commandManager.registerHandler('RESUMO_CONFIG', startWizard);
    commandManager.registerHandler('TAG', handleTag);
    commandManager.registerHandler('COMMANDLIST', handleCommandList);
    commandManager.registerHandler('CACHE_RESET', resetNewsCache);
    commandManager.registerHandler('CACHE_STATS', showCacheStats);
    commandManager.registerHandler('NEWS_DEBUG', handleNewsDebug);

    logger.debug('Command handlers registered successfully');
}

module.exports = {
    registerCommands,
    commandManager,
};
