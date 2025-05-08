#!/usr/bin/env node

/**
 * Interactive Test Menu Script
 *
 * This script provides an interactive menu to run tests with options:
 * - Run all tests
 * - Select verbose mode
 * - Select test categories
 * - Select specific tests
 */

const { spawn } = require('child_process');
const readline = require('readline');
const fs = require('fs');
const path = require('path');

// Ensure we override console.log before any other imports
const originalConsoleLog = console.log;
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
        message.includes('INITIALIZATION_PROGRESS:')
    ) {
        return;
    }

    // Call the original console.log for all other messages
    originalConsoleLog.apply(console, args);
};

// Try to load config and test cases if they exist
let TEST_CATEGORIES = [];
let ALL_TESTS = [];

try {
    const configPath = path.join(__dirname, 'config.js');
    if (fs.existsSync(configPath)) {
        const config = require('./config');
        if (config.TEST_CATEGORIES) {
            TEST_CATEGORIES = Object.keys(config.TEST_CATEGORIES);
        }
    }

    // Load test cases to show available tests
    const testCasesPath = path.join(__dirname, 'testCases.js');
    if (fs.existsSync(testCasesPath)) {
        const { TEST_CASES } = require('./testCases');
        // Add any categories not already in TEST_CATEGORIES
        Object.keys(TEST_CASES).forEach(category => {
            if (!TEST_CATEGORIES.includes(category)) {
                TEST_CATEGORIES.push(category);
            }

            // Store all tests with their categories
            if (TEST_CASES[category]) {
                TEST_CASES[category].forEach(test => {
                    ALL_TESTS.push({
                        name: test.name,
                        category: category,
                        description: test.description || '',
                    });
                });
            }
        });
    }
} catch (error) {
    console.warn(`Warning: Could not load test categories: ${error.message}`);
}

// Create readline interface
let rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
});

// Verbose mode flag
let isVerboseMode = false;

/**
 * Run a test command and handle the output
 * @param {Array} args - Command line arguments for the test script
 */
function runTestCommand(args) {
    // Make sure we close and recreate the readline interface to prevent ERR_USE_AFTER_CLOSE
    rl.close();

    if (isVerboseMode && !args.includes('--verbose')) {
        args.unshift('--verbose');
    }

    // Add environment variables to suppress spinner and initialization logs
    const env = {
        ...process.env,
        SUPPRESS_SPINNER: 'false', // Show the spinner during initialization
        SILENT: isVerboseMode ? 'false' : 'true',
        DEBUG: isVerboseMode ? 'true' : 'false', // Explicitly set DEBUG based on verbose mode
        SUPPRESS_INITIAL_LOGS: 'true', // Suppress initialization logs
        SHOW_SPINNER: 'true', // Make sure spinner is shown
        NODE_OPTIONS: '--no-deprecation',
        AUTO_EXIT: 'true', // Tell the test runner to exit automatically
    };

    console.log(
        `\nRunning: node --no-deprecation ${path.join(__dirname, 'runTests.js')} ${args.join(
            ' '
        )}\n`
    );

    const testProcess = spawn(
        'node',
        ['--no-deprecation', path.join(__dirname, 'runTests.js'), ...args],
        {
            stdio: 'inherit',
            env: env,
        }
    );

    // Handle process termination
    let processExited = false;

    testProcess.on('close', code => {
        processExited = true;
        // Just exit the test menu process when the test process exits
        process.exit(code);
    });

    // Handle termination signals
    process.on('SIGINT', () => {
        if (!processExited) {
            testProcess.kill('SIGINT');
        }
        // Don't exit immediately, let the close handler deal with cleanup
    });

    process.on('SIGTERM', () => {
        if (!processExited) {
            testProcess.kill('SIGTERM');
        }
        // Don't exit immediately, let the close handler deal with cleanup
    });
}

/**
 * Display a menu and handle user selection
 */
function showMainMenu() {
    console.clear();
    console.log('\n=== WhatsApp Bot Test Menu ===');
    console.log(`Verbose Mode: ${isVerboseMode ? 'ON' : 'OFF'}`);
    console.log('\nOptions:');
    console.log('1. Toggle Verbose Mode');
    console.log('2. Run All Tests');
    console.log('3. Select Tests by Category');
    console.log('4. Select Specific Tests');
    console.log('0. Exit');

    rl.question('\nEnter your choice (or press Enter to run all tests): ', answer => {
        // Default to running all tests if no input is provided
        const choice = answer.trim() || '2';

        switch (choice) {
            case '0':
                console.log('Exiting...');
                rl.close();
                process.exit(0);
                break;

            case '1':
                // Toggle verbose mode
                isVerboseMode = !isVerboseMode;
                console.log(`\nVerbose mode is now ${isVerboseMode ? 'ON' : 'OFF'}`);
                showMainMenu();
                break;

            case '2':
                // Run all tests
                runTestCommand([]);
                break;

            case '3':
                // Show category selection
                showCategorySelectionMenu();
                break;

            case '4':
                // Show specific test selection
                showTestSelectionMenu();
                break;

            default:
                console.log('Invalid choice. Please try again.');
                showMainMenu();
                break;
        }
    });
}

/**
 * Display a menu for selecting multiple categories
 */
function showCategorySelectionMenu() {
    console.clear();
    console.log('\n=== Select Test Categories ===');
    console.log(
        'Enter the numbers of the categories you want to run tests for, separated by spaces.'
    );
    console.log('For example: "1 3 5" will select the 1st, 3rd, and 5th categories.');
    console.log('\nAvailable Categories:');

    if (TEST_CATEGORIES.length === 0) {
        console.log('No test categories found.');
        rl.question('\nPress Enter to return to the main menu: ', () => {
            showMainMenu();
        });
        return;
    }

    TEST_CATEGORIES.forEach((category, index) => {
        console.log(`${index + 1}. ${category}`);
    });
    console.log('0. Back to main menu');

    rl.question('\nEnter category numbers (or "all" for all categories): ', answer => {
        if (answer.trim() === '0') {
            showMainMenu();
            return;
        }

        if (answer.trim().toLowerCase() === 'all') {
            runTestCommand([]);
            return;
        }

        // Parse selected categories
        const selectedIndexes = answer.trim().split(/\s+/).map(Number);
        const selectedCategories = selectedIndexes
            .filter(index => index > 0 && index <= TEST_CATEGORIES.length)
            .map(index => TEST_CATEGORIES[index - 1]);

        if (selectedCategories.length === 0) {
            console.log('No valid categories selected. Please try again.');
            setTimeout(showCategorySelectionMenu, 1500);
            return;
        }

        console.log('\nSelected categories:');
        selectedCategories.forEach(category => console.log(`- ${category}`));

        // Run tests with selected categories
        if (selectedCategories.length === 1) {
            runTestCommand([selectedCategories[0]]);
        } else {
            // For multiple categories, we need to ask if they want to run them sequentially
            rl.question('\nRun tests one by one? (Y/n): ', answer => {
                if (answer.trim().toLowerCase() === 'n') {
                    // Run all selected categories at once
                    runTestCommand(selectedCategories);
                } else {
                    // Run categories sequentially
                    runCategoriesSequentially(selectedCategories);
                }
            });
        }
    });
}

/**
 * Run tests for multiple categories sequentially
 * @param {Array} categories - Array of category names to run
 * @param {Number} index - Current index to run
 */
function runCategoriesSequentially(categories, index = 0) {
    // Close current readline interface to prevent conflicts
    rl.close();

    if (index >= categories.length) {
        console.log('\nAll selected category tests completed!');

        // Recreate readline interface
        rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
        });

        // Ask if user wants to continue testing
        rl.question('\nRun more tests? (Y/n): ', answer => {
            if (answer.trim().toLowerCase() === 'n') {
                rl.close();
                process.exit(0);
            } else {
                showMainMenu();
            }
        });
        return;
    }

    const currentCategory = categories[index];
    console.log(
        `\nRunning tests for category: ${currentCategory} (${index + 1}/${categories.length})`
    );

    const args = [currentCategory];
    if (isVerboseMode) {
        args.unshift('--verbose');
    }

    // Add environment variables to suppress spinner and initialization logs
    const env = {
        ...process.env,
        SUPPRESS_SPINNER: 'false',
        SILENT: isVerboseMode ? 'false' : 'true',
        SUPPRESS_INITIAL_LOGS: 'true',
        SHOW_SPINNER: 'true',
        NODE_OPTIONS: '--no-deprecation',
    };

    const testProcess = spawn(
        'node',
        ['--no-deprecation', path.join(__dirname, 'runTests.js'), ...args],
        {
            stdio: 'inherit',
            env: env,
        }
    );

    let processExited = false;

    testProcess.on('close', code => {
        processExited = true;
        console.log(`\nTest process for ${currentCategory} exited with code ${code}`);

        // Recreate readline interface
        rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
        });

        // Ask if user wants to continue to next category
        if (index < categories.length - 1) {
            rl.question(
                `\nContinue to next category (${categories[index + 1]})? (Y/n): `,
                answer => {
                    if (answer.trim().toLowerCase() === 'n') {
                        showMainMenu();
                    } else {
                        runCategoriesSequentially(categories, index + 1);
                    }
                }
            );
        } else {
            runCategoriesSequentially(categories, index + 1);
        }
    });

    // Handle termination signals
    process.on('SIGINT', () => {
        if (!processExited) {
            testProcess.kill('SIGINT');
        }
        // Don't exit immediately, let the close handler deal with cleanup
    });
}

/**
 * Display a menu for selecting specific tests
 */
function showTestSelectionMenu() {
    console.clear();
    console.log('\n=== Select Specific Tests ===');
    console.log('Enter the numbers of the tests you want to run, separated by spaces.');
    console.log('For example: "1 3 5" will select the 1st, 3rd, and 5th tests.');
    console.log('\nAvailable Tests:');

    if (ALL_TESTS.length === 0) {
        console.log('No tests found.');
        rl.question('\nPress Enter to return to the main menu: ', () => {
            showMainMenu();
        });
        return;
    }

    // Group tests by category
    const testsByCategory = {};
    ALL_TESTS.forEach(test => {
        if (!testsByCategory[test.category]) {
            testsByCategory[test.category] = [];
        }
        testsByCategory[test.category].push(test);
    });

    // Display tests with category headers
    let testIndex = 1;
    const indexToTest = {}; // Map index to test name

    Object.keys(testsByCategory).forEach(category => {
        console.log(`\n[${category}]`);
        testsByCategory[category].forEach(test => {
            console.log(`${testIndex}. ${test.name} - ${test.description}`);
            indexToTest[testIndex] = test.name;
            testIndex++;
        });
    });

    console.log('\n0. Back to main menu');

    rl.question('\nEnter test numbers: ', answer => {
        if (answer.trim() === '0') {
            showMainMenu();
            return;
        }

        // Parse selected tests
        const selectedIndexes = answer.trim().split(/\s+/).map(Number);
        const selectedTests = selectedIndexes
            .filter(index => index > 0 && index < testIndex)
            .map(index => indexToTest[index]);

        if (selectedTests.length === 0) {
            console.log('No valid tests selected. Please try again.');
            setTimeout(showTestSelectionMenu, 1500);
            return;
        }

        console.log('\nSelected tests:');
        selectedTests.forEach(test => console.log(`- ${test}`));

        // Run the selected tests
        runTestCommand(selectedTests);
    });
}

// Set up exit handler to ensure clean exit
process.on('exit', () => {
    if (rl) {
        try {
            rl.close();
        } catch (e) {
            // Ignore errors if readline is already closed
        }
    }
});

// Start the menu
console.clear();
console.log('Welcome to the WhatsApp Bot Test Runner');
console.log('Press Enter at any time to run all tests.');
showMainMenu();
