// configs/config.js
const CREDENTIALS = require('./credentials');
const { discoverCommands } = require('../core/commandDiscovery');
const NEWS_MONITOR = require('../newsMonitor/newsMonitor.config');
const PERIODIC_SUMMARY = require('../periodicSummary/periodicSummary.config');

const config = {
  CREDENTIALS,
  COMMANDS: discoverCommands(),
  NEWS_MONITOR,
  PERIODIC_SUMMARY,
  SYSTEM: {
    MAX_LOG_MESSAGES: 1000,
    MESSAGE_DELETE_TIMEOUT: 60000,
    ENABLE_STARTUP_CACHE_CLEARING: true,
    MAX_RECONNECT_ATTEMPTS: 5,
    OPENAI_MODELS: {
        DEFAULT: 'gpt-4o-mini',
        VOICE: 'whisper-1',
        VISION_DEFAULT: 'gpt-4o-mini',
    },
    ADMIN_NOTIFICATION_CHAT: CREDENTIALS.ADMIN_WHATSAPP_ID,
    PRESERVED_FILES_ON_UPDATE: ['configs/config.js', 'commands/periodicSummary.js'],
  },
};

module.exports = config;
