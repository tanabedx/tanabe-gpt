#!/usr/bin/env node

/**
 * Test Runner Script
 * 
 * This script runs the botTester.js with DEBUG control
 * Usage:
 *   npm test          - Run with minimal output (quiet mode)
 *   npm run test:verbose - Run with full debug output
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const config = require('./config');

// Get command line arguments
const args = process.argv.slice(2);
const isVerbose = args.includes('--verbose') || args.includes('-v');

// Parse category arguments if present
const categories = args.filter(arg => !arg.startsWith('--'));
let categoriesToRun = null;

if (categories.length > 0) {
    categoriesToRun = categories;
    
    // Validate categories
    const validCategories = Object.keys(config.TEST_CATEGORIES);
    const invalidCategories = categories.filter(cat => !validCategories.includes(cat));
    
    if (invalidCategories.length > 0) {
        console.error(`Invalid categories: ${invalidCategories.join(', ')}`);
        console.error(`Valid categories are: ${validCategories.join(', ')}`);
        process.exit(1);
    }
    
    // Update config to only run specified categories
    validCategories.forEach(cat => {
        config.TEST_CATEGORIES[cat] = categories.includes(cat);
    });
}

// Check for required sample files
const samplesDir = path.join(__dirname, 'samples');
if (!fs.existsSync(samplesDir)) {
    console.log('Creating samples directory...');
    fs.mkdirSync(samplesDir, { recursive: true });
}

// Run the tests
console.log(`Starting bot tests in ${isVerbose ? 'verbose' : 'quiet'} mode...`);
if (categoriesToRun) {
    console.log(`Running tests for categories: ${categoriesToRun.join(', ')}`);
} else {
    console.log('Running all test categories');
}

// Run the bot tester with absolute paths
const testProcess = spawn('node', [path.join(__dirname, 'botTester.js')], {
    env: {
        ...process.env,
        DEBUG: isVerbose ? 'true' : 'false',
        SILENT: isVerbose ? 'false' : 'true'
    },
    stdio: 'inherit',
    cwd: path.join(__dirname, '..')  // Set to project root directory
});

testProcess.on('exit', (code) => {
    process.exit(code);
});

// Handle interrupts
process.on('SIGINT', () => {
    console.log('Interrupting tests...');
    testProcess.kill('SIGINT');
});

process.on('SIGTERM', () => {
    console.log('Terminating tests...');
    testProcess.kill('SIGTERM');
}); 