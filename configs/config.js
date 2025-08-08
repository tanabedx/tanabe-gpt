// configs/config.js
const CREDENTIALS = require('./credentials');
const NEWS_MONITOR = require('../newsMonitor/newsMonitor.config');
const PERIODIC_SUMMARY = require('../periodicSummary/periodicSummary.config');

const config = {
  CREDENTIALS,
  get COMMANDS() {
    // Lazy-load to avoid circular dependency during startup
    const { discoverCommands } = require('../core/commandDiscovery');
    return discoverCommands();
  },
  NEWS_MONITOR,
  PERIODIC_SUMMARY,
  SYSTEM: {
    MAX_LOG_MESSAGES: 1000,
    MESSAGE_DELETE_TIMEOUT: 60000,
    ENABLE_STARTUP_CACHE_CLEARING: true,
    MAX_RECONNECT_ATTEMPTS: 5,
    // Streaming is controlled at the system level for uniform behavior across modules
    STREAMING_ENABLED: false,
    // Web Search lives under CHAT config; Reasoning stays centralized here.
    REASONING: {
      ENABLED: true,
      BY_TIER: {
        MEDIUM: 'low',
        HIGH: 'medium',
      },
      SUMMARY: 'auto',
      RETRY_ON_UNSUPPORTED: true,
      MAX_RETRIES: 1,
      APPLY_TO_VISION: false,
    },
    OPENAI_MODELS: {
        DEFAULT: 'gpt-5-nano',
        VOICE: 'whisper-1',
        VISION_DEFAULT: 'gpt-5-nano',
    },
    AI_MODELS: {
      LOW: 'gpt-5-nano',
      MEDIUM: 'gpt-5-mini',
      HIGH: 'gpt-5',
    },
    ADMIN_NOTIFICATION_CHAT: CREDENTIALS.ADMIN_WHATSAPP_ID,
    PRESERVED_FILES_ON_UPDATE: ['configs/config.js', 'commands/periodicSummary.js'],
  },
};

module.exports = config;
