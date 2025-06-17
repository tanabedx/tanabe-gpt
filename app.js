// app.js

process.removeAllListeners('warning');
process.on('warning', warning => {
    if (warning.name === 'DeprecationWarning' && warning.message.includes('punycode')) {
        return;
    }
    console.warn(warning.name, warning.message);
});

const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const config = require('./configs/config');
const { setupListeners } = require('./core/listener');
const { initializeContextManager } = require('./chat/contextManager');
const { initializeConversationManager } = require('./chat/conversationManager');
const { initialize } = require('./newsMonitor/newsMonitor.js');
const { scheduleNextSummary: schedulePeriodicSummary } = require('./periodicSummary/periodicSummaryUtils');
const { performStartupGitPull } = require('./utils/gitUtils');
const {
    performCacheClearing,
    startMemoryMonitoring,
    forceGarbageCollection,
} = require('./admin/cacheManagement');
const logger = require('./utils/logger');
const path = require('path');
const fs = require('fs');

// Memory management: Setup forced garbage collection
let memoryUsageLog = [];
const MAX_MEMORY_LOGS = 10;

function logMemoryUsage() {
    const memUsage = process.memoryUsage();
    const memoryInfo = {
        timestamp: new Date().toISOString(),
        rss: Math.round(memUsage.rss / 1024 / 1024), // RSS in MB
        heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024), // Heap total in MB
        heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024), // Heap used in MB
        external: Math.round(memUsage.external / 1024 / 1024), // External in MB
    };

    memoryUsageLog.push(memoryInfo);
    if (memoryUsageLog.length > MAX_MEMORY_LOGS) {
        memoryUsageLog.shift();
    }

    logger.debug(
        `Memory usage: RSS: ${memoryInfo.rss}MB, Heap: ${memoryInfo.heapUsed}/${memoryInfo.heapTotal}MB`
    );

    // Check if memory usage is increasing rapidly
    if (memoryUsageLog.length >= 3) {
        const oldUsage = memoryUsageLog[0].heapUsed;
        const currentUsage = memoryInfo.heapUsed;
        const increaseMB = currentUsage - oldUsage;

        if (increaseMB > 50) {
            // If heap increased by more than 50MB
            logger.warn(`Memory increase detected: +${increaseMB}MB. Forcing garbage collection.`);
            forceGarbageCollection();
        }
    }
}

// Set up regular memory monitoring and garbage collection
const MEMORY_CHECK_INTERVAL = 5 * 60 * 1000; // Check every 5 minutes
setInterval(() => {
    logMemoryUsage();
    // Force GC every hour or when memory increases too quickly (handled in logMemoryUsage)
    if (global.gc && Date.now() % (60 * 60 * 1000) < MEMORY_CHECK_INTERVAL) {
        logger.debug('Performing scheduled garbage collection');
        forceGarbageCollection();
    }
}, MEMORY_CHECK_INTERVAL);

// Check if testing environment variables are set and force debug/prompt logging
if (process.env.FORCE_DEBUG_LOGS === 'true' && config.SYSTEM?.CONSOLE_LOG_LEVELS) {
    console.log('Test mode: Forcing DEBUG logs to be enabled');
    config.SYSTEM.CONSOLE_LOG_LEVELS.DEBUG = true;
}

if (process.env.FORCE_PROMPT_LOGS === 'true' && config.SYSTEM?.CONSOLE_LOG_LEVELS) {
    console.log('Test mode: Forcing PROMPT logs to be enabled');
    config.SYSTEM.CONSOLE_LOG_LEVELS.PROMPT = true;
}

// Add global error handlers
process.on('uncaughtException', error => {
    logger.error('Uncaught Exception:', error);
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
    process.exit(1);
});

// Initialize global client
global.client = null;

let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_DELAY = 5000; // 5 seconds

async function reconnectClient() {
    if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
        logger.warn(
            `Attempting to reconnect (attempt ${reconnectAttempts + 1}/${MAX_RECONNECT_ATTEMPTS})`
        );
        try {
            reconnectAttempts++;
            await initializeBot();
        } catch (error) {
            logger.error('Reconnection attempt failed:', error);
            // Wait before trying again
            setTimeout(reconnectClient, RECONNECT_DELAY);
        }
    } else {
        logger.error(
            `Failed to reconnect after ${MAX_RECONNECT_ATTEMPTS} attempts. Shutting down...`
        );
        process.exit(1);
    }
}

// Initialize bot components
async function initializeBot() {
    try {
        // Clear cache if enabled
        if (config.SYSTEM?.ENABLE_STARTUP_CACHE_CLEARING) {
            logger.debug('Cache clearing is enabled, performing cleanup...');
            const { clearedFiles } = await performCacheClearing(0);
            if (clearedFiles > 0) {
                logger.debug(`Cache cleared successfully: ${clearedFiles} files removed`);
            }
        }

        // Initialize WhatsApp client
        logger.debug('Starting WhatsApp client initialization...');

        // Determine auth path and client ID
        const authPath = process.env.USE_AUTH_DIR || path.join(__dirname, 'wwebjs/auth_main');
        const clientId = process.env.USE_CLIENT_ID || 'tanabe-gpt-client';
        logger.debug(`Using authentication path: ${authPath} with client ID: ${clientId}`);

        // Check if the session folder exists
        const sessionFolder = path.join(authPath, `session-${clientId}`);
        if (fs.existsSync(sessionFolder)) {
            logger.debug(`Found existing session folder: ${sessionFolder}`);
        } else {
            logger.warn(`Session folder not found: ${sessionFolder}. A new one will be created.`);
        }

        // Cleanup function to manage browser resources
        const browserCleanup = {
            closePages: async browser => {
                try {
                    if (!browser) return;
                    const pages = await browser.pages();

                    // Keep only the main WhatsApp page, close all others
                    if (pages.length > 1) {
                        logger.debug(`Found ${pages.length} browser pages, cleaning up extras...`);
                        for (let i = 1; i < pages.length; i++) {
                            try {
                                await pages[i].close();
                                logger.debug(`Closed extra page ${i}`);
                            } catch (err) {
                                logger.debug(`Error closing page ${i}: ${err.message}`);
                            }
                        }
                    }
                } catch (err) {
                    logger.warn(`Error during browser page cleanup: ${err.message}`);
                }
            },
        };

        // Enhanced client configuration
        const client = new Client({
            authStrategy: new LocalAuth({
                clientId: clientId,
                dataPath: authPath,
            }),
            puppeteer: {
                headless: true,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-accelerated-2d-canvas',
                    '--no-first-run',
                    '--no-zygote',
                    '--single-process',
                    '--disable-gpu',
                    '--js-flags="--max-old-space-size=128"',
                    '--disable-extensions',
                    '--disable-default-apps',
                    '--disable-translate',
                    '--disable-sync',
                    '--disable-site-isolation-trials',
                    '--mute-audio',
                    '--disable-background-networking',
                    '--disable-background-timer-throttling',
                    '--disable-backgrounding-occluded-windows',
                    '--disable-breakpad',
                    '--disable-component-extensions-with-background-pages',
                    '--disable-features=TranslateUI,BlinkGenPropertyTrees',
                    '--disable-ipc-flooding-protection',
                    '--disable-renderer-backgrounding',
                ],
                defaultViewport: { width: 800, height: 600 },
                ignoreHTTPSErrors: true,
                timeout: 120000,
            },
            restartOnAuthFail: true,
            qrMaxRetries: 5,
            qrTimeoutMs: 60000,
            authTimeoutMs: 60000,
            takeoverOnConflict: true,
            takeoverTimeoutMs: 60000,
        });

        // Store client globally for use in other modules
        global.client = client;
        logger.debug('Storing client globally...');

        // Automatic browser resource management
        let browserInstance = null;
        let pageCleanupInterval = null;

        client.on('ready', async () => {
            try {
                // Store reference to browser instance
                browserInstance = client.pupBrowser;

                // Schedule periodic browser cleanup to prevent memory leaks
                pageCleanupInterval = setInterval(async () => {
                    if (browserInstance) {
                        await browserCleanup.closePages(browserInstance);
                        // Force garbage collection after browser cleanup
                        if (global.gc) {
                            forceGarbageCollection();
                        }
                    }
                }, 30 * 60 * 1000); // Every 30 minutes

                logger.debug('Browser cleanup scheduled every 30 minutes');

                // Start memory monitoring
                startMemoryMonitoring();
            } catch (err) {
                logger.error('Error setting up browser management:', err);
            }
        });

        // Clean up resources on disconnection
        client.on('disconnected', async () => {
            if (pageCleanupInterval) {
                clearInterval(pageCleanupInterval);
                pageCleanupInterval = null;
            }

            try {
                if (browserInstance) {
                    await browserCleanup.closePages(browserInstance);
                    browserInstance = null;
                }
            } catch (err) {
                logger.warn('Error during browser cleanup on disconnection:', err);
            }
        });

        // Set up QR code handling
        let qrAttempts = 0;
        client.on('qr', qr => {
            qrAttempts++;
            logger.info(`QR Code received (attempt ${qrAttempts}/5), scan to authenticate:`);
            qrcode.generate(qr, { small: true });

            // Log additional instructions
            if (qrAttempts === 1) {
                logger.info(
                    'To authenticate: Open WhatsApp on your phone, go to Settings > Linked Devices > Link a Device'
                );
            }
        });

        // Set up detailed event logging
        client.on('loading_screen', (percent, message) => {
            logger.debug('WhatsApp loading screen:', {
                percent,
                message,
            });
        });

        client.on('authenticated', () => {
            logger.debug('Client authenticated successfully');
            qrAttempts = 0;
        });

        client.on('auth_failure', msg => {
            logger.error('Authentication failed:', msg);
            logger.info(
                'Please try again. If the problem persists, delete the wwebjs/auth_main directory and restart.'
            );
            throw new Error(`Authentication failed: ${msg}`);
        });

        client.on('disconnected', reason => {
            logger.error('Client was disconnected:', reason);
            reconnectClient();
        });

        // Create a promise that resolves when the client is ready
        const readyPromise = new Promise((resolve, reject) => {
            // Set a timeout to reject the promise if it takes too long
            const timeout = setTimeout(() => {
                reject(new Error('WhatsApp client initialization timed out after 2 minutes'));
            }, 120000); // 2 minutes timeout

            client.on('ready', () => {
                logger.debug('WhatsApp client is ready and authenticated!');
                clearTimeout(timeout); // Clear the timeout
                resolve(); // Resolve the promise
            });
        });

        // Start the client initialization
        logger.debug('Starting WhatsApp client and waiting for authentication...');

        // Initialize the client (this starts the authentication process)
        await client.initialize().catch(error => {
            logger.error('Error initializing WhatsApp client:', error);
            throw error;
        });

        // Wait for the client to be ready (fully authenticated)
        logger.debug('Waiting for WhatsApp client to be fully ready...');
        await readyPromise;

        logger.debug('WhatsApp client authenticated and initialized successfully!');

        // Now that we're authenticated and ready, set up the rest of the components
        logger.debug('Setting up command handlers and listeners...');

        // Register command handlers
        logger.debug('Registering command handlers...');
        setupListeners(client);
        logger.debug('Command handlers registered successfully');
        logger.debug('All listeners set up successfully');

        // Initialize message logging
        logger.debug('Initializing message logging...');
        initializeContextManager();
        initializeConversationManager();
        logger.debug('Message logging initialized successfully');

        // Initialize news monitor (handles both Twitter and RSS)
        try {
            logger.debug('About to call initializeNewsMonitor...');
            await initialize();
            logger.debug('Returned from initializeNewsMonitor successfully.');
        } catch (error) {
            logger.error('Failed to initialize news monitor (caught in initializeBot):', error);
            // Continue even if news monitor fails
        }

        logger.debug(
            'Proceeding after news monitor block in initializeBot. About to log line 224.'
        );
        logger.info('Bot initialization completed successfully!');
        return client;
    } catch (error) {
        logger.error('Error during bot initialization:', error);
        throw error;
    }
}

// Main function
async function main() {
    try {
        logger.debug('Starting bot...');

        // Perform git pull unconditionally before full initialization
        await performStartupGitPull();

        logger.debug('Initializing bot...');
        // Initialize the bot
        await initializeBot();
        logger.debug('Bot initialization completed.');
        // Start the spinner after initialization is complete
        await logger.startup('🤖 Bot has been started successfully!');

        // Schedule periodic summaries
        schedulePeriodicSummary();
    } catch (error) {
        logger.error('Error in main function:', error);

        // Provide specific guidance based on the error
        if (error.message && error.message.includes('auth')) {
            logger.error('Authentication error detected. Try the following:');
            logger.error('1. Delete the wwebjs/auth_main directory: rm -rf wwebjs/auth_main');
            logger.error('2. Restart the bot: node app.js');
            logger.error('3. Scan the QR code with your WhatsApp');
            logger.info(
                'Authentication error detected. Try deleting the wwebjs/auth_main directory and restarting the bot.'
            );
        } else if (error.message && error.message.includes('timeout')) {
            logger.error('Timeout error detected. Try the following:');
            logger.error('1. Check your internet connection');
        }
    }
}

// Start the bot
main().catch(error => {
    logger.error('UNHANDLED ERROR IN MAIN:', error);
});
