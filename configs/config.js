// config.js

// Import configurations
const CREDENTIALS = require('./credentials');
const COMMANDS = require('./commandConfigs');
const NEWS_MONITOR = require('./commandConfigs/newsMonitor.config');

// Avoid circular dependency with periodicSummary.config
let PERIODIC_SUMMARY;
setTimeout(() => {
    PERIODIC_SUMMARY = require('./commandConfigs/periodicSummary.config');
}, 0);

// System settings
const SYSTEM = {
    MAX_LOG_MESSAGES: 1000,
    MESSAGE_DELETE_TIMEOUT: 60000,
    ENABLE_STARTUP_CACHE_CLEARING: true,
    MAX_RECONNECT_ATTEMPTS: 5,
    OPENAI_MODELS: {
        DEFAULT: 'gpt-4o-mini',
        VOICE: 'whisper-1', // Model for voice transcription
        VISION_DEFAULT: 'gpt-4o-mini', // Added default vision model
    },
    // Logging and notification settings
    CONSOLE_LOG_LEVELS: {
        ERROR: true,
        WARN: true,
        INFO: true,
        DEBUG: false,
        SUMMARY: true,
        STARTUP: true,
        SHUTDOWN: true,
        PROMPT: false,
        COMMAND: true,
    },
    NOTIFICATION_LEVELS: {
        ERROR: true,
        WARN: false,
        INFO: false,
        DEBUG: false,
        SUMMARY: true,
        STARTUP: true,
        SHUTDOWN: true,
        PROMPT: false,
        COMMAND: false,
    },
    ADMIN_NOTIFICATION_CHAT: CREDENTIALS.ADMIN_WHATSAPP_ID,
    PRESERVED_FILES_ON_UPDATE: ['configs/config.js', 'commands/periodicSummary.js'], // Files to stash before git pull
};

// Export all configurations
module.exports = {
    SYSTEM,
    NEWS_MONITOR,
    COMMANDS,
    get PERIODIC_SUMMARY() {
        return PERIODIC_SUMMARY;
    },
    CREDENTIALS,
};
