/**
 * Test Utilities
 */

const fs = require('fs');
const path = require('path');
const { MessageMedia } = require('whatsapp-web.js');

// Sample files paths
const SAMPLES_DIR = path.join(__dirname, 'samples');

// Ensure sample files exist
function checkSampleFiles() {
    const requiredSamples = ['sample.jpg', 'sample.pdf', 'sample.ogg'];
    const missingFiles = [];
    
    for (const file of requiredSamples) {
        const filePath = path.join(SAMPLES_DIR, file);
        if (!fs.existsSync(filePath)) {
            missingFiles.push(file);
        }
    }
    
    if (missingFiles.length > 0) {
        console.warn(`Warning: The following sample files are missing: ${missingFiles.join(', ')}`);
        console.warn(`Please add these files to the ${SAMPLES_DIR} directory before running tests.`);
        return false;
    }
    
    return true;
}

// Create a media message from a sample file
function createMediaMessage(filename) {
    const filePath = path.join(SAMPLES_DIR, filename);
    if (!fs.existsSync(filePath)) {
        throw new Error(`Sample file not found: ${filePath}`);
    }
    
    return MessageMedia.fromFilePath(filePath);
}

// Format test results for display
function formatTestResults(results) {
    const { passed, failed, skipped, details } = results;
    const total = passed + failed + skipped;
    
    // ANSI color codes
    const colors = {
        reset: "\x1b[0m",
        bright: "\x1b[1m",
        green: "\x1b[32m",
        red: "\x1b[31m",
        yellow: "\x1b[33m",
        blue: "\x1b[34m",
        cyan: "\x1b[36m",
        bgGreen: "\x1b[42m",
        bgRed: "\x1b[41m",
        bgYellow: "\x1b[43m",
        black: "\x1b[30m"
    };
    
    // Helper function to create a separator line
    const separator = (char = '=', length = 50) => char.repeat(length);
    
    // Header
    let output = `\n${colors.bright}${separator('=', 60)}${colors.reset}\n`;
    output += `${colors.bright}${colors.cyan}             TEST EXECUTION SUMMARY             ${colors.reset}\n`;
    output += `${colors.bright}${separator('=', 60)}${colors.reset}\n\n`;
    
    // Summary stats with colored backgrounds
    const summaryBox = [
        `${colors.bright}${colors.bgGreen}${colors.black}  PASSED: ${passed.toString().padStart(3, ' ')}  ${colors.reset}`,
        `${colors.bright}${colors.bgRed}${colors.black}  FAILED: ${failed.toString().padStart(3, ' ')}  ${colors.reset}`,
        `${colors.bright}${colors.bgYellow}${colors.black}  SKIPPED: ${skipped.toString().padStart(3, ' ')}  ${colors.reset}`
    ];
    
    output += `TEST RESULTS:  ${summaryBox.join('  ')}  ${colors.bright}TOTAL: ${total}${colors.reset}\n\n`;
    
    // Group by result
    const passedTests = details.filter(d => d.result === 'PASSED');
    const failedTests = details.filter(d => d.result === 'FAILED');
    const skippedTests = details.filter(d => d.result === 'SKIPPED');
    
    if (passedTests.length > 0) {
        output += `${colors.bright}${colors.green}✅ PASSED TESTS:${colors.reset}\n`;
        output += `${colors.green}${separator('-', 40)}${colors.reset}\n`;
        passedTests.forEach((test, index) => {
            output += `  ${colors.green}${index + 1}.${colors.reset} ${test.name}`;
            if (test.details) {
                output += ` - ${test.details}`;
            }
            output += '\n';
        });
        output += '\n';
    }
    
    if (failedTests.length > 0) {
        output += `${colors.bright}${colors.red}❌ FAILED TESTS:${colors.reset}\n`;
        output += `${colors.red}${separator('-', 40)}${colors.reset}\n`;
        failedTests.forEach((test, index) => {
            output += `  ${colors.red}${index + 1}.${colors.reset} ${test.name}\n`;
            output += `     ${colors.red}Error:${colors.reset} ${test.error}\n`;
        });
        output += '\n';
    }
    
    if (skippedTests.length > 0) {
        output += `${colors.bright}${colors.yellow}⏭️ SKIPPED TESTS:${colors.reset}\n`;
        output += `${colors.yellow}${separator('-', 40)}${colors.reset}\n`;
        skippedTests.forEach((test, index) => {
            output += `  ${colors.yellow}${index + 1}.${colors.reset} ${test.name}`;
            if (test.reason) {
                output += ` - ${test.reason}`;
            }
            output += '\n';
        });
        output += '\n';
    }
    
    // Footer
    output += `${colors.bright}${separator('=', 60)}${colors.reset}\n`;
    const timestamp = new Date().toISOString().replace('T', ' ').substr(0, 19);
    output += `${colors.bright}Test completed at: ${timestamp}${colors.reset}\n`;
    
    return output;
}

// Verify group access to commands
async function verifyGroupAccess(client, groupName) {
    try {
        // Check if client is ready
        if (!client.info) {
            console.warn('Client is not fully authenticated yet. Skipping group access verification.');
            return true;
        }
        
        const chats = await client.getChats();
        const group = chats.find(chat => chat.isGroup && chat.name === groupName);
        
        if (!group) {
            console.error(`Group "${groupName}" not found`);
            return false;
        }
        
        // We can't directly check permissions, but we can log a warning
        require('./logger').debug(`Found group "${groupName}". Please ensure this group has access to all commands in the whitelist.`);
        return true;
    } catch (error) {
        console.warn(`Unable to verify group access: ${error.message}`);
        console.warn('Continuing with tests, but some tests may fail if the group does not have proper permissions.');
        return true;
    }
}

module.exports = {
    checkSampleFiles,
    createMediaMessage,
    formatTestResults,
    verifyGroupAccess
}; 