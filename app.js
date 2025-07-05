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
const { scheduleNextSummary: schedulePeriodicSummary, getPeriodicSummaryStatus } = require('./periodicSummary/periodicSummaryUtils');
const { performStartupGitPull, signalSystemdRestart } = require('./utils/gitUtils');
const { performDependencySync, getDependencyStatus } = require('./utils/dependencyUtils');
const {
    performCacheClearing,
    startMemoryMonitoring,
    forceGarbageCollection,
} = require('./admin/cacheManagement');
const logger = require('./utils/logger');
const path = require('path');
const fs = require('fs');

// Initial startup message - logged as early as possible (no spinner yet)
logger.info('Initializing...');

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
async function initializeBot(gitResults) {
    try {
        // Track whether Twitter API keys were in cooldown during startup
        let hadCooldownDuringStartup = false;

        // Initialize status tracking objects for comprehensive reporting
        let cacheResults = { clearedFiles: 0 };
        let whatsappStatus = {
            authenticated: false,
            sessionSaved: false
        };
        let coreSystemsStatus = {
            contextManager: false,
            conversationManager: false,
            memoryMonitoring: false
        };

        // Clear cache if enabled - capture results silently
        if (config.SYSTEM?.ENABLE_STARTUP_CACHE_CLEARING) {
            logger.debug('Cache clearing is enabled, performing cleanup...');
            cacheResults = await performCacheClearing(0);
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
                    '--disable-background-timer-throttling',
                    '--disable-backgrounding-occluded-windows',
                    '--disable-renderer-backgrounding',
                    '--disable-features=TranslateUI',
                    '--disable-ipc-flooding-protection',
                ],
                timeout: 60000,
                takeoverTimeoutMs: 60000,
            },
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

                // Start memory monitoring and capture status
                try {
                    startMemoryMonitoring();
                    coreSystemsStatus.memoryMonitoring = true;
                } catch (err) {
                    logger.debug('Memory monitoring failed to start:', err);
                }
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
            whatsappStatus.authenticated = true;
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
                whatsappStatus.sessionSaved = true;
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

        // Register command handlers - capture status silently
        logger.debug('Registering command handlers...');
        setupListeners(client);
        logger.debug('Command handlers registered successfully');

        // Initialize core systems and capture their status
        logger.debug('Initializing core systems...');
        
        try {
            initializeContextManager();
            coreSystemsStatus.contextManager = true;
        } catch (error) {
            logger.debug('Context manager initialization failed:', error);
        }

        try {
            initializeConversationManager();
            coreSystemsStatus.conversationManager = true;
        } catch (error) {
            logger.debug('Conversation manager initialization failed:', error);
        }

        // Simplified newsMonitor initialization - no complex callbacks
        const { getNewsMonitorStartupStatus } = require('./newsMonitor/newsMonitor');
        const NEWS_MONITOR_CONFIG = require('./newsMonitor/newsMonitor.config');
        let newsMonitorStatus = { enabled: false, apiKeys: [], sources: [], targetGroup: 'Not configured' };
        
        // Get initial status before starting newsMonitor
        if (NEWS_MONITOR_CONFIG.enabled) {
            try {
                newsMonitorStatus = await getNewsMonitorStartupStatus();
                logger.debug('Starting newsMonitor initialization...');
                
                // Start newsMonitor in background without waiting
                initialize().catch(error => {
                    logger.error('Failed to initialize news monitor:', error);
                });
                
                // Give it a moment to initialize Twitter API, then get updated status
                await new Promise(resolve => setTimeout(resolve, 3000));
                newsMonitorStatus = await getNewsMonitorStartupStatus();
            } catch (error) {
                logger.error('Error getting newsMonitor status:', error);
                newsMonitorStatus = { 
                    enabled: false, 
                    apiKeys: [{ name: 'Error getting status', status: 'error' }], 
                    sources: [], 
                    targetGroup: 'Error' 
                };
            }
        } else {
            logger.debug('News Monitor is disabled');
        }

        // Determine if Twitter API keys are currently on cooldown (for startup success logic)
        hadCooldownDuringStartup = NEWS_MONITOR_CONFIG.enabled && newsMonitorStatus.apiKeys.some(key =>
            key.status === 'cooldown' || key.name === 'All keys in cooldown' || key.name === 'Keys on cooldown'
        );

        // Collect comprehensive status information for reporting
        const statusData = await collectSystemStatus(gitResults, cacheResults, whatsappStatus, coreSystemsStatus, newsMonitorStatus);
        
        // Display the comprehensive startup report
        await logger.systemStatus(statusData);

        // If News Monitor is disabled OR keys not on cooldown, log startup success now
        if (!NEWS_MONITOR_CONFIG.enabled || !hadCooldownDuringStartup) {
            // Create startup message with sync status
            const dependencyStatus = getDependencyStatus();
            const syncMessage = dependencyStatus.outOfSync ? 
                'Bot has been started successfully! (Dependencies may need sync on next update)' :
                'Bot has been started successfully! ✅ Code and dependencies fully synchronized';
            
            await logger.startup(syncMessage);
        }

        // Post-startup Twitter API status check - only if keys were in cooldown during startup
        if (hadCooldownDuringStartup) {
            // Wait for Twitter API to potentially initialize, then check if it succeeded
            const intervalId = setInterval(async () => {
                try {
                    const { getCurrentKey, getApiKeysStatus } = require('./newsMonitor/twitterApiHandler');
                    const currentKey = getCurrentKey();

                    if (currentKey && currentKey.status === 'ok') {
                        const currentApiStatus = await getApiKeysStatus();

                        if (currentApiStatus && currentApiStatus.length > 0) {
                            const activeKey = currentApiStatus.find(key => key.status === 'active') || currentApiStatus[0];
                            const keyStates = currentApiStatus.map(key => `${key.name}: ${key.usage}` ).join(', ');
                            logger.info(`Twitter API Handler initialized successfully. Active key: ${activeKey.name}. All key states: [${keyStates}]`);

                            // Create startup message with sync status
                            const dependencyStatus = getDependencyStatus();
                            const syncMessage = dependencyStatus.outOfSync ? 
                                'Bot has been started successfully! (Dependencies may need sync on next update)' :
                                'Bot has been started successfully! ✅ Code and dependencies fully synchronized';
                            
                            await logger.startup(syncMessage);
                            clearInterval(intervalId);
                        }
                    }
                } catch (error) {
                    logger.debug('Error checking post-startup Twitter API status:', error);
                }
            }, 60000); // Check every minute until keys are ready
        }

        // Continue with normal operation - newsMonitor is already running in parallel
        return client;
    } catch (error) {
        logger.error('Error during bot initialization:', error);
        throw error;
    }
}

/**
 * Collects comprehensive system status information for startup reporting
 * @param {Object} gitResults - Git pull results
 * @param {Object} cacheResults - Cache clearing results  
 * @param {Object} whatsappStatus - WhatsApp client status
 * @param {Object} coreSystemsStatus - Core systems initialization status
 * @param {Object} newsMonitorStatus - News monitor status (including API keys)
 * @returns {Object} Comprehensive status data object
 */
async function collectSystemStatus(gitResults, cacheResults, whatsappStatus, coreSystemsStatus, newsMonitorStatus) {
    // Import package.json to get version information
    const packageJson = require('./package.json');
    
    // Get periodic summary status
    const periodicSummaryStatus = getPeriodicSummaryStatus();

    // Get dependency status
    const dependencyStatus = getDependencyStatus();

    // Return comprehensive status object
    return {
        version: {
            gitStatus: gitResults.gitStatus,
            commitInfo: gitResults.commitInfo,
            syncStatus: gitResults.hasChanges ? 'Recently updated' : 'Up to date'
        },
        dependencies: {
            status: dependencyStatus.outOfSync ? 'Out of sync' : 'Synchronized',
            packageJson: dependencyStatus.packageJson,
            packageLock: dependencyStatus.packageLock,
            nodeModules: dependencyStatus.nodeModules,
            lastSync: dependencyStatus.lastSync !== 'Unknown' ? 
                new Date(dependencyStatus.lastSync).toLocaleString() : 
                'Unknown'
        },
        newsMonitor: newsMonitorStatus,
        periodicSummary: periodicSummaryStatus,
        coreSystems: {
            whatsapp: whatsappStatus,
            contextManager: coreSystemsStatus.contextManager,
            conversationManager: coreSystemsStatus.conversationManager,
            memoryMonitoring: coreSystemsStatus.memoryMonitoring
        },
        cacheManagement: {
            filesCleared: cacheResults.clearedFiles || 0,
            memory: Math.round(process.memoryUsage().heapUsed / 1024 / 1024)
        }
    };
}

// Main function
async function main() {
    try {
        // Perform git pull and capture results (no separate log needed now)
        const gitResults = await performStartupGitPull();

        // Check if restart is needed due to code or dependency changes
        if (gitResults.hasChanges && gitResults.needsRestart) {
            logger.info('Code changes detected. Processing update...');
            
            // If dependencies need to be synchronized, do it now
            if (gitResults.needsDependencySync) {
                logger.info('Dependency changes detected. Synchronizing dependencies...');
                const depResults = await performDependencySync();
                
                if (depResults.success) {
                    logger.info(`Dependencies synchronized successfully (${depResults.operation}) in ${depResults.duration}s`);
                } else {
                    logger.warn(`Dependency synchronization failed: ${depResults.status}`);
                }
            }
            
            // Signal systemd to restart the service so new code takes effect
            const changedFilesStr = gitResults.changedFiles.length > 0 ? 
                `Changed files: ${gitResults.changedFiles.join(', ')}` : 
                'Files changed';
            
            signalSystemdRestart(`${changedFilesStr}. Restarting to apply updates`);
            
            // Function will exit here, systemd will restart the service
            return;
        }

        // No changes detected, proceed with normal startup
        // Initialize the bot with git results
        await initializeBot(gitResults);
        
        // Schedule periodic summaries
        schedulePeriodicSummary();
        
        // Spinner will be started by logger.startup once bot is fully initialized
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
