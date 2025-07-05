#!/usr/bin/env node

/**
 * Unified Test Runner Script
 *
 * Usage:
 *   npm test                   - Run all tests with minimal output
 *   npm test -v                - Run all tests with verbose output
 *   npm test:category          - Run tests in a specific category
 *   npm test:category -v       - Run tests in a specific category with verbose output
 *   npm test:command commandName - Run a specific test by name
 */

// Import required modules early so they're available for our overrides
const readline = require('readline');

// Override console.log to suppress specific messages
// Must be done before any imports to catch all messages
const originalConsoleLog = console.log;

// Spinner state
let spinnerActive = false;
let currentSpinnerText = '';
let spinnerCharIndex = 0;
const spinnerChars = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

// Function to clear the spinner line
function clearSpinner() {
    if (spinnerActive) {
        // Only clear if we're in a TTY environment
        if (process.stdout.isTTY) {
            readline.clearLine(process.stdout, 0);
            readline.cursorTo(process.stdout, 0);
        }
    }
}

// Function to draw the spinner
function drawSpinner() {
    if (spinnerActive) {
        // Only draw if we're in a TTY environment
        if (process.stdout.isTTY) {
            process.stdout.write(
                `\x1b[1m${currentSpinnerText} ${spinnerChars[spinnerCharIndex]}\x1b[0m`
            );
        }
    }
}

// Override console.log to handle spinner and logging properly
console.log = function (...args) {
    if (!args.length) return originalConsoleLog.apply(console, args);

    const message = args[0]?.toString() || '';

    // Skip specific unwanted messages
    if (
        message === 'Prompt capture set up successfully' ||
        message.startsWith('Found group') ||
        message === 'CLIENTS_READY' ||
        message.includes('DeprecationWarning') ||
        message.includes('node --trace-deprecation') ||
        message.includes('INIT_STATUS:') ||
        message.includes('INITIALIZATION_PROGRESS:') ||
        message.includes('Found prompt log entry, capturing...')
    ) {
        return;
    }

    // Handle test result messages
    if (message.startsWith('✅') || message.startsWith('❌')) {
        // Clear spinner if active
        if (spinnerActive) {
            clearSpinner();
            spinnerActive = false;
        }
        // Format test result in bold
        originalConsoleLog('\x1b[1m' + message + '\x1b[0m');
        return;
    }

    // If there's an active spinner
    if (spinnerActive) {
        // Clear the spinner line
        clearSpinner();

        // Check if this is a log message that should be preserved
        if (
            message.startsWith('DEBUG:') ||
            message.startsWith('BOT>') ||
            message.startsWith('INFO:') ||
            message.startsWith('WARN:') ||
            message.startsWith('ERROR:')
        ) {
            // Print the log message
            originalConsoleLog.apply(console, args);
        } else {
            // For other messages, print them normally
            originalConsoleLog.apply(console, args);
        }

        // Redraw the spinner on a new line
        drawSpinner();
        return;
    }

    // Call the original console.log for all other messages
    originalConsoleLog.apply(console, args);
};

const path = require('path');
const fs = require('fs');

// Import test modules
const config = require('./config');
const { getTestCases } = require('./testCases');
const { checkSampleFiles, formatTestResults, verifyGroupAccess } = require('./utils');
const logger = require('./logger');

// Import tester functions
const botTester = require('./botTester');

// Get command line arguments
const args = process.argv.slice(2);
const isVerbose = args.includes('--verbose') || args.includes('-v');
const isRemote = args.includes('--remote');

// Remove verbose flags from args to get actual test specifiers
const testSpecifiers = args.filter(
    arg => arg !== '--verbose' && arg !== '-v' && arg !== '--remote'
);

// Check if we have a specific category or test name
let targetTests = null;
let targetCategory = null;

// Check if we're running in npm script context
// Extract the test name/category from the npm_lifecycle_event
if (process.env.npm_lifecycle_event) {
    const npmCommand = process.env.npm_lifecycle_event;
    if (npmCommand !== 'test') {
        // Format: test:xyz
        const parts = npmCommand.split(':');
        if (parts.length === 2) {
            targetCategory = parts[1];
        }
    }
}

// If we have direct command line arguments, they take precedence over npm_lifecycle_event
if (testSpecifiers.length > 0) {
    targetTests = testSpecifiers;
}

// Start spinner for initialization
let i = 0;
let spinnerInterval;

// Only show spinner if not explicitly suppressed
if (process.env.SUPPRESS_SPINNER !== 'true' && process.env.SHOW_SPINNER !== 'false') {
    spinnerActive = true;
    currentSpinnerText = 'Initializing test environment';
    spinnerInterval = setInterval(() => {
        clearSpinner();
        spinnerCharIndex = i;
        drawSpinner();
        i = (i + 1) % spinnerChars.length;
    }, 100);
} else {
    // No spinner, but we might want a simple message
    if (process.env.SILENT !== 'true') {
        console.log('Initializing tests...');
    }
    spinnerActive = false;
    spinnerInterval = null;
}

// Main function to run tests
async function runTests() {
    // Reset test results at the start
    botTester.resetTestResults();

    let client;
    let botProcess;
    let exitCode = 0;
    let resultsPath; // Declare here to make it available in the finally block

    try {
        // Determine which tests to run
        let testsToRun = [];

        if (targetCategory) {
            // Check if it's a known category in config
            if (config.TEST_CATEGORIES && config.TEST_CATEGORIES[targetCategory] !== undefined) {
                // Enable only this category
                Object.keys(config.TEST_CATEGORIES).forEach(cat => {
                    config.TEST_CATEGORIES[cat] = cat === targetCategory;
                });
                testsToRun = getTestCases();
            } else {
                // Try to find tests that match the category name pattern
                const allTests = getTestCases(null, true);
                testsToRun = allTests.filter(
                    test =>
                        test.name.toLowerCase().includes(targetCategory.toLowerCase()) ||
                        (test.category &&
                            test.category.toLowerCase() === targetCategory.toLowerCase())
                );

                if (testsToRun.length === 0) {
                    throw new Error(`No tests found for category: ${targetCategory}`);
                }
            }
        } else if (targetTests && targetTests.length > 0) {
            // Get all tests
            const allTests = getTestCases(null, true);

            // Filter tests by name
            testsToRun = allTests.filter(test => {
                return targetTests.some(
                    name =>
                        test.name.toLowerCase() === name.toLowerCase() ||
                        test.name.toLowerCase().includes(name.toLowerCase())
                );
            });

            if (testsToRun.length === 0) {
                // Show available tests
                throw new Error(
                    `No tests found matching: ${targetTests.join(', ')}\n` +
                        `Available tests:\n${allTests.map(t => `- ${t.name}`).join('\n')}`
                );
            }
        } else {
            // No specific tests, run all based on config
            testsToRun = getTestCases();
        }

        // Check for sample files
        if (!checkSampleFiles()) {
            logger.warn('Some sample files are missing. Some tests may fail.');
        }

        // Initialize client
        try {
            logger.log('Initializing WhatsApp test client...');
            client = await botTester.initializeClient();
            logger.log('WhatsApp test client initialized successfully');
        } catch (error) {
            logger.error('Failed to initialize WhatsApp test client:', error);
            logger.error(
                'Try deleting the wwebjs/auth_test directory and running npm run setup again'
            );
            throw error;
        }

        // Verify group access
        if (config.VERIFY_WHITELIST) {
            logger.log('Verifying group access...');
            try {
                await verifyGroupAccess(client, config.TARGET_GROUP);
                logger.log('Group access verified successfully');
            } catch (error) {
                logger.error('Failed to verify group access:', error);
                throw error;
            }
        }

        if (isRemote) {
            logger.log('Running in remote mode. Assuming bot is already running on VPS.');
        } else {
            // Always kill any existing bot process and start a new one
            logger.log('Killing any existing bot process...');
            try {
                const { exec } = require('child_process');
                await new Promise(resolve => {
                    exec('pkill -f "node app.js"', error => {
                        if (error) {
                            logger.warn('No existing bot process found or error killing it:', error);
                        } else {
                            logger.log('Successfully killed existing bot process');
                        }
                        resolve();
                    });
                });

                // Wait a moment to ensure the process is fully terminated
                await new Promise(resolve => setTimeout(resolve, 2000));

                // Start a new bot instance
                logger.log('Starting new bot instance...');
                botProcess = botTester.startBot();

                // Wait for bot to initialize
                logger.log(
                    `Waiting ${config.BOT_STARTUP_WAIT / 1000} seconds for bot to initialize...`
                );
                await new Promise(resolve => setTimeout(resolve, config.BOT_STARTUP_WAIT));
                logger.log('Bot initialization wait completed');
            } catch (error) {
                logger.error('Failed to start bot:', error);
                throw error;
            }
        }

        // Find target group
        logger.log('Finding target group...');
        let group;
        try {
            group = await botTester.findTargetGroup(client);
            logger.log(`Found target group: ${group.name}`);
        } catch (error) {
            logger.error('Failed to find target group:', error);
            throw error;
        }

        // Clear initialization spinner before starting tests
        if (spinnerInterval) {
            clearInterval(spinnerInterval);
            clearSpinner();
            spinnerActive = false;
            spinnerInterval = null;
        }

        // Show which tests we're running
        console.log('\x1b[1mStarting tests...\x1b[0m');
        logger.log(`Preparing to run ${testsToRun.length} tests...`);

        // Run tests sequentially
        for (const test of testsToRun) {
            const result = await botTester.runTest(client, group, test, { isRemote });

            // Use a shorter delay between tests if the test has already completed
            const delayTime = result && result.needsShortDelay ? 1000 : config.DELAY_BETWEEN_TESTS;
            logger.log(`Waiting ${delayTime / 1000} seconds before next test...`);
            await new Promise(resolve => setTimeout(resolve, delayTime));
        }

        // Print summary
        const testResults = botTester.getTestResults();
        const summary = formatTestResults(testResults);
        console.log(summary);

        // Save results to file
        resultsPath = path.join(__dirname, 'test_results.json');
        fs.writeFileSync(resultsPath, JSON.stringify(testResults, null, 2));
        logger.log(`Test results saved to ${resultsPath}`);

        // Send summary to group
        await group.sendMessage(
            `*Bot Test Results*\n\nTotal: ${
                testResults.passed + testResults.failed + testResults.skipped
            }\nPassed: ${testResults.passed}\nFailed: ${testResults.failed}\nSkipped: ${
                testResults.skipped
            }`
        );
    } catch (error) {
        if (spinnerInterval) {
            clearInterval(spinnerInterval);
            clearSpinner();
            spinnerActive = false;
        }

        // Log error with proper level
        logger.error('Error running tests:', error.message);
        if (error.stack) {
            logger.error('Stack trace:', error.stack);
        }
        exitCode = 1;
    } finally {
        // Stop spinner
        if (spinnerInterval) {
            clearInterval(spinnerInterval);
            spinnerInterval = null;
        }
        clearSpinner();

        // Cleanup
        if (client) {
            try {
                logger.log('Shutting down WhatsApp test client...');
                await client.destroy();
                logger.log('Client shut down successfully.');
            } catch (error) {
                logger.error('Error shutting down client:', error);
            }
        }
        if (botProcess && !botProcess.killed) {
            try {
                logger.log('Stopping bot process...');
                const killed = botProcess.kill('SIGTERM'); // Send SIGTERM for graceful shutdown
                if (killed) {
                    logger.log('Bot process stopped.');
                } else {
                    logger.warn('Failed to stop bot process.');
                }
            } catch (error) {
                logger.error('Error stopping bot process:', error);
            }
        }
        
        await forceKillChromiumProcesses();
        
        logger.log(`\nTest results saved to ${resultsPath}`);

        // Exit with the appropriate code
            process.exit(exitCode);
    }
}

// Function to force kill any remaining Chromium processes
async function forceKillChromiumProcesses() {
    logger.log('Checking for lingering Chromium processes...');

    try {
        const { exec } = require('child_process');

        // Use a different command based on OS
        const cmd =
            process.platform === 'win32'
                ? 'tasklist /FI "IMAGENAME eq chrome.exe" /FI "WINDOWTITLE eq *puppeteer*" /NH'
                : 'ps aux | grep "[c]hromium\\|[c]hrome.*puppeteer" | grep -v grep';

        const findChromeProcesses = () => {
            return new Promise(resolve => {
                exec(cmd, (error, stdout, _) => {
                    if (error) {
                        // If no processes found, that's fine - just return empty array
                        if (error.code === 1) {
                            resolve([]);
                            return;
                        }
                        logger.warn(`Error checking for Chrome processes: ${error.message}`);
                        resolve([]);
                        return;
                    }

                    // Parse the output to get PIDs
                    let pids = [];
                    if (process.platform === 'win32') {
                        // Windows format: chrome.exe PID Session# Mem Usage
                        const lines = stdout.split('\n').filter(line => line.trim().length > 0);
                        lines.forEach(line => {
                            const parts = line.trim().split(/\s+/);
                            if (parts.length > 1 && parts[0] === 'chrome.exe') {
                                pids.push(parts[1]);
                            }
                        });
                    } else {
                        // Unix format: user PID %CPU %MEM etc...
                        const lines = stdout.split('\n').filter(line => line.trim().length > 0);
                        lines.forEach(line => {
                            const parts = line.trim().split(/\s+/);
                            if (parts.length > 1) {
                                pids.push(parts[1]);
                            }
                        });
                    }

                    resolve(pids);
                });
            });
        };

        const killProcesses = async pids => {
            if (pids.length === 0) {
                logger.log('No lingering Chromium processes found');
                return;
            }

            logger.log(`Found ${pids.length} lingering Chromium processes. Killing...`);

            for (const pid of pids) {
                try {
                    const killCmd =
                        process.platform === 'win32' ? `taskkill /F /PID ${pid}` : `kill -9 ${pid}`;

                    await new Promise(resolve => {
                        exec(killCmd, error => {
                            if (error) {
                                logger.warn(`Failed to kill process ${pid}: ${error.message}`);
                            } else {
                                logger.log(`Successfully killed process ${pid}`);
                            }
                            resolve();
                        });
                    });
                } catch (error) {
                    logger.warn(`Error in kill command for process ${pid}: ${error.message}`);
                }
            }

            // Verify processes are gone
            const remainingPids = await findChromeProcesses();
            if (remainingPids.length > 0) {
                logger.warn(`${remainingPids.length} Chrome processes still remain after cleanup`);
            } else {
                logger.log('All Chromium processes successfully terminated');
            }
        };

        const pids = await findChromeProcesses();
        await killProcesses(pids);
    } catch (error) {
        logger.error(`Error in forceKillChromiumProcesses: ${error.message}`);
    }
}

// When running as a script, we directly call runTests
// Otherwise, we export the runTests function for use by other scripts
if (require.main === module) {
    // Set environment variables for the current process
    const isRemote = process.argv.includes('--remote');
    const isVerbose = process.argv.includes('--verbose') || process.argv.includes('-v');

    process.env.DEBUG = isVerbose ? 'true' : 'false';
    process.env.SILENT = isVerbose ? 'false' : 'true';
    process.env.SUPPRESS_INITIAL_LOGS = 'true';
    process.env.SHOW_SPINNER = 'true';
    process.env.FORCE_PROMPT_LOGS = 'true';
    process.env.FORCE_DEBUG_LOGS = 'true';

    // Suppress node deprecation warnings
    process.env.NODE_OPTIONS = '--no-deprecation';

    // Log verbose mode status
    if (isVerbose) {
        console.log('\x1b[1mRunning in verbose mode...\x1b[0m');
    }
    if (isRemote) {
        console.log('\x1b[1mRunning in remote mode...\x1b[0m');
    }

    // Run in main process
    runTests().catch(error => {
        if (spinnerInterval) {
            clearInterval(spinnerInterval);
            clearSpinner();
            spinnerActive = false;
        }
        console.error('Unhandled error:', error);
        process.exit(1);
    });
} else {
    // Export for use as a module
    module.exports = { runTests };
}

// Handle interrupts
process.on('SIGINT', () => {
    if (spinnerInterval) {
        clearInterval(spinnerInterval);
        clearSpinner();
        spinnerActive = false;
    }
    console.log('Interrupting tests...');
    process.exit(0);
});

process.on('SIGTERM', () => {
    if (spinnerInterval) {
        clearInterval(spinnerInterval);
        clearSpinner();
        spinnerActive = false;
    }
    console.log('Terminating tests...');
    process.exit(0);
});
