/**
 * WhatsApp Bot Automated Test Script
 * 
 * This script automates testing of the WhatsApp bot by:
 * 1. Initializing a WhatsApp client
 * 2. Sending test commands to a specified group
 * 3. Monitoring responses to verify functionality
 */

const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { exec } = require('child_process');

// Import test modules
const config = require('./config');
const { getTestCases } = require('./testCases');
const { 
    checkSampleFiles, 
    verifyGroupAccess 
} = require('../test/utils');
const logger = require('./logger');

// Check if initial logs should be suppressed
const suppressInitialLogs = process.env.SUPPRESS_INITIAL_LOGS === 'true';
const showSpinner = process.env.SHOW_SPINNER === 'true';

// Track test results
const testResults = {
    passed: 0,
    failed: 0,
    skipped: 0,
    details: []
};

// Function to get test results
function getTestResults() {
    return testResults;
}

// Function to reset test results
function resetTestResults() {
    testResults.passed = 0;
    testResults.failed = 0;
    testResults.skipped = 0;
    testResults.details = [];
}

// Print status message for parent process to interpret
function sendStatusMessage(message) {
    if (showSpinner) {
        logger.debug(`INIT_STATUS: ${message}`);
    }
}

// Initialize WhatsApp client
async function initializeClient() {
    sendStatusMessage('Initializing WhatsApp client for testing...');
    
    // Create a client initialization promise with timeout
    const clientInitPromise = new Promise((resolve, reject) => {
        try {
            const testAuthPath = path.join(__dirname, '..', 'wwebjs/auth_test');

            const client = new Client({
                authStrategy: new LocalAuth({
                    clientId: 'test-client',
                    dataPath: testAuthPath
                }),
                puppeteer: {
                    headless: true,
                    args: [
                        '--no-sandbox',
                        '--disable-setuid-sandbox',
                        '--disable-dev-shm-usage',
                        '--disable-accelerated-2d-canvas',
                        '--disable-gpu',
                        '--window-size=1920x1080'
                    ]
                }
            });

            // Store browser instance to ensure proper cleanup
            client.on('ready', () => {
                global.whatsappClient = client;
                sendStatusMessage('Client is ready!');
                logger.log('Client is ready!');
                resolve(client);
            });

            // Set up other event handlers
            client.on('qr', (qr) => {
                logger.qrCode('testing client', qr);
            });

            client.on('authenticated', () => {
                sendStatusMessage('Client authenticated successfully');
                logger.log('Client authenticated successfully');
            });

            client.on('auth_failure', (msg) => {
                logger.error('Authentication failed:', msg);
                reject(new Error(`Authentication failed: ${msg}`));
            });

            // Initialize the client
            client.initialize().catch(error => {
                logger.error('Error initializing client:', error);
                reject(error);
            });
        } catch (error) {
            logger.error('Error creating client:', error);
            reject(error);
        }
    });
    
    // Add a timeout to the client initialization
    const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => {
            reject(new Error('Client initialization timed out after 2 minutes'));
        }, 120000); // 2 minutes timeout
    });
    
    // Race the client initialization against the timeout
    try {
        return await Promise.race([clientInitPromise, timeoutPromise]);
    } catch (error) {
        logger.error('Client initialization failed:', error.message);
        throw error;
    }
}

// Start the bot in the background
function startBot() {
    sendStatusMessage('Starting the bot in the background...');
    logger.log('Starting the bot in the background...');
    const botAuthPath = path.join(__dirname, '..', 'wwebjs/auth_main');
    const botClientId = 'tanabe-gpt-client';
    logger.debug(`Setting bot to use auth path: ${botAuthPath} with client ID: ${botClientId}`);
    
    try {
        const bot = spawn('node', ['index.js'], {
            detached: false,
            stdio: 'pipe',
            env: {
                ...process.env,
                USE_AUTH_DIR: botAuthPath,
                USE_CLIENT_ID: botClientId,
                
                // Force logging settings to ensure visibility
                FORCE_PROMPT_LOGS: 'true',     
                FORCE_DEBUG_LOGS: 'true',      
                
                // Override the bot's logging configuration to show everything
                CONSOLE_LOG_LEVEL_ERROR: 'true',
                CONSOLE_LOG_LEVEL_WARN: 'true',
                CONSOLE_LOG_LEVEL_INFO: 'true',
                CONSOLE_LOG_LEVEL_DEBUG: 'true',
                CONSOLE_LOG_LEVEL_SUMMARY: 'true',
                CONSOLE_LOG_LEVEL_STARTUP: 'true',
                CONSOLE_LOG_LEVEL_SHUTDOWN: 'true',
                CONSOLE_LOG_LEVEL_PROMPT: 'true',
                CONSOLE_LOG_LEVEL_COMMAND: 'true',
                
                // Force test mode to ensure consistent behavior
                TEST_MODE: 'true'
            }
        });
        
        // Log when the bot process exits
        bot.on('exit', (code, signal) => {
            logger.log(`Bot process exited with code ${code} and signal ${signal}`);
        });
        
        // Log stdout for better visibility in verbose mode
        bot.stdout.on('data', (data) => {
            const message = data.toString().trim();
            if (message.includes('Initialized client successfully') || 
                message.includes('Client is ready')) {
                sendStatusMessage('Bot client is ready!');
            }
            
            // Always capture logs for testing, but only show in verbose mode
            if (process.env.DEBUG === 'true' || process.env.VERBOSE === 'true' || process.env.SILENT === 'false') {
            logger.log(`Bot stdout: ${message}`);
            }
            
            // Check for prompt and debug logs regardless of verbose mode
            if (message.includes('DIRETRIZES') || message.includes('[PROMPT]') || 
                message.includes('ChatGPT Prompt') || message.includes('>>')) {
                // Update the last prompt if we find one
                if (message.includes('DIRETRIZES')) {
                    global.lastPrompt = message;
                    global.promptCaptured = true;
                }
                // Add to existing prompt if we find message history
                else if (message.includes('>>') && global.lastPrompt) {
                    global.lastPrompt += '\n' + message;
                }
            }
        });
        
        // Log stderr with proper formatting for visibility in verbose mode
        bot.stderr.on('data', (data) => {
            const message = data.toString().trim();
            if (process.env.DEBUG === 'true' || process.env.VERBOSE === 'true' || process.env.SILENT === 'false') {
                logger.error(`Bot stderr: ${message}`);
            }
        });
        
        sendStatusMessage(`Bot started with PID: ${bot.pid}`);
        logger.log(`Bot started with PID: ${bot.pid}`);
        return bot;
    } catch (error) {
        logger.error(`Failed to start bot: ${error.message}`);
        throw error;
    }
}

// Find the target group
async function findTargetGroup(client) {
    try {
        // Check if client is ready
        if (!client.info) {
            throw new Error('Client is not fully authenticated yet');
        }
        
        logger.log('Fetching chats...');
        const chats = await client.getChats();
        logger.log(`Found ${chats.length} chats`);
        
        // Log all group chats for debugging
        const groupChats = chats.filter(chat => chat.isGroup);
        logger.log(`Found ${groupChats.length} group chats:`);
        
        const targetGroup = chats.find(chat => 
            chat.isGroup && chat.name === config.TARGET_GROUP
        );
        
        if (!targetGroup) {
            throw new Error(`Target group "${config.TARGET_GROUP}" not found`);
        }
        
        logger.log(`Found target group: ${targetGroup.name} (${targetGroup.id._serialized})`);
        return targetGroup;
    } catch (error) {
        logger.error(`Error finding target group: ${error.message}`);
        logger.error('Please make sure:');
        logger.error(`1. The group "${config.TARGET_GROUP}" exists in your WhatsApp`);
        logger.error('2. You are fully authenticated with WhatsApp');
        logger.error('3. The bot has been added to the group');
        
        throw new Error(`Unable to find target group: ${error.message}`);
    }
}

// Find the bot chat
async function findBotChat(client) {
    try {
        // Check if client is ready
        if (!client.info) {
            throw new Error('Client is not fully authenticated yet');
        }
        
        const botNumber = config.BOT_NUMBER;
        if (!botNumber) {
            throw new Error('Bot number not configured');
        }
        
        const chatId = `${botNumber}@c.us`;
        const chat = await client.getChatById(chatId);
        
        if (!chat) {
            throw new Error(`Bot chat not found for number ${botNumber}`);
        }
        
        logger.log(`Found bot chat for number ${botNumber}`);
        return chat;
    } catch (error) {
        logger.error(`Error finding bot chat: ${error.message}`);
        logger.error('Please make sure:');
        logger.error('1. The bot number is correctly configured');
        logger.error('2. You are fully authenticated with WhatsApp');
        
        throw new Error(`Unable to find bot chat: ${error.message}`);
    }
}

// Send a message and wait for response
async function sendMessageAndWaitForResponse(client, group, message, options = {}) {
    const { 
        attachment = null, 
        quote = false, 
        preMessage = null,
        preCommand = null,
        timeout = config.RESPONSE_TIMEOUT,
        useBotChat = false,
        useAdminChat = false, // Kept for backward compatibility
        preDelay = 0,
        expectReactionDelete = false,
        sendAttachmentFirst = false,
        attachWithCommand = false, // New parameter to send attachment with command
        isSticker = false, // New parameter to indicate if the attachment should be sent as a sticker
        checkBotMessageDeletion = false,
        followUpCommand = null,
        followUpDelay = 0
    } = options;
    
    // Use bot chat if specified
    let chat;
    if (useBotChat || useAdminChat) {
        chat = await findBotChat(client);
    } else {
        chat = group;
    }
    
    // Wait for pre-delay if specified
    if (preDelay > 0) {
        logger.log(`Waiting ${preDelay/1000} seconds before sending message...`);
        await new Promise(resolve => setTimeout(resolve, preDelay));
    }
    
    let quotedMessage = null;
    
    // Send pre-message if needed
    if (preMessage) {
        logger.log(`Sending pre-message: ${preMessage}`);
        quotedMessage = await chat.sendMessage(preMessage);
        logger.log('Pre-message sent, waiting before proceeding...');
        await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5 seconds after pre-message
    }
    
    // Send pre-command if specified
    if (preCommand) {
        logger.log(`Sending pre-command: ${preCommand}`);
        await chat.sendMessage(preCommand);
        await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds after pre-command
    }
    
    // For PDF summary, send attachment first, then quote it with the command
    if (sendAttachmentFirst && attachment) {
        logger.log(`Sending attachment first: ${attachment}`);
        const filePath = path.join(__dirname, 'samples', attachment);
        if (!fs.existsSync(filePath)) {
            throw new Error(`Attachment file not found: ${filePath}`);
        }
        
        const media = MessageMedia.fromFilePath(filePath);
        
        // If it's a sticker, use sendMediaAsSticker option
        if (isSticker) {
            logger.log('Sending as sticker...');
            quotedMessage = await chat.sendMessage(media, { sendMediaAsSticker: true });
        } else {
            quotedMessage = await chat.sendMessage(media);
        }
        
        logger.log('Attachment sent, waiting before quoting...');
        await new Promise(resolve => setTimeout(resolve, 3000)); // Wait 3 seconds after sending attachment
    }
    
    // Prepare message options
    const messageOptions = {};
    if (quote && quotedMessage) {
        messageOptions.quotedMessageId = quotedMessage.id._serialized;
    }
    
    // Send attachment if needed (and not already sent)
    let sentMessage;
    if (attachment && !sendAttachmentFirst) {
        const filePath = path.join(__dirname, 'samples', attachment);
        if (!fs.existsSync(filePath)) {
            throw new Error(`Attachment file not found: ${filePath}`);
        }
        
        const media = MessageMedia.fromFilePath(filePath);
        
        // If it's a sticker, use sendMediaAsSticker option
        if (isSticker) {
            logger.log(`Sending attachment as sticker${message ? ' with caption: ' + message : ''}`);
            
            // For stickers, we need to set the caption and then send as sticker
            const stickerOptions = { 
                sendMediaAsSticker: true,
                ...messageOptions
            };
            
            // Add caption if provided and attachWithCommand is true
            if (message && attachWithCommand) {
                stickerOptions.caption = message;
            }
            
            sentMessage = await chat.sendMessage(media, stickerOptions);
        } else {
            // If attachWithCommand is true, send the attachment with the command as caption
            if (attachWithCommand) {
                logger.log(`Sending attachment with command as caption: ${message}`);
                sentMessage = await chat.sendMessage(media, { caption: message, ...messageOptions });
            } else {
                // Otherwise, just send the attachment (with caption if message is provided)
                sentMessage = await chat.sendMessage(media, { caption: message, ...messageOptions });
            }
        }
    } else {
        // Send regular message
        sentMessage = await chat.sendMessage(message, messageOptions);
    }
    
    logger.log(`Sent message: ${message}${useBotChat ? ' (to bot chat)' : useAdminChat ? ' (to admin chat)' : ''}`);
    
    // Wait for response
    const responsePromise = new Promise((resolve) => {
        const responseHandler = (msg) => {
            if (msg.from === chat.id._serialized && msg.fromMe === false) {
                client.removeListener('message', responseHandler);
                resolve(msg);
            }
        };
        
        client.on('message', responseHandler);
        
        // Set timeout
        setTimeout(() => {
            client.removeListener('message', responseHandler);
            resolve(null);
        }, timeout);
    });
    
    // Get the response
    const response = await responsePromise;
    
    // Handle bot message reaction deletion test
    if (checkBotMessageDeletion && response) {
        logger.log('Testing bot message reaction deletion...');
        try {
            // Wait a moment before reacting
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            // React with praying hands emoji (which is the only emoji that triggers deletion)
            await response.react('🙏');
            logger.log('Added praying hands (🙏) reaction to bot message');
            
            // Wait for message to be deleted (with a reasonable timeout)
            const deletionTimeout = 10000; // 10 seconds
            const startTime = Date.now();
            
            // Create a promise that resolves when the message is deleted
            const deletionPromise = new Promise((resolve) => {
                const checkInterval = setInterval(async () => {
                    try {
                        // Try to fetch the message
                        const messages = await chat.fetchMessages({ limit: 10 });
                        const messageExists = messages.some(msg => 
                            msg.id._serialized === response.id._serialized
                        );
                        
                        if (!messageExists) {
                            clearInterval(checkInterval);
                            logger.log('Bot message was deleted after praying hands reaction');
                            resolve({ wasDeleted: true });
                        } else if (Date.now() - startTime > deletionTimeout) {
                            // Timeout reached
                            clearInterval(checkInterval);
                            logger.log('Timeout reached, bot message was not deleted');
                            resolve({ wasDeleted: false });
                        }
                    } catch (error) {
                        // If we can't fetch the message, assume it was deleted
                        clearInterval(checkInterval);
                        logger.log('Error checking message, assuming deleted:', error.message);
                        resolve({ wasDeleted: true });
                    }
                }, 1000);
            });
            
            // Wait for the deletion promise to resolve
            const deletionResult = await deletionPromise;
            
            if (deletionResult.wasDeleted) {
                return { body: 'Message deleted', wasDeleted: true };
            } else {
                throw new Error('Bot message was not deleted after reaction');
            }
        } catch (error) {
            logger.error('Error testing bot message reaction deletion:', error);
            return null;
        }
    }
    
    // Handle follow-up command if specified
    if (followUpCommand && response) {
        logger.log(`Waiting ${followUpDelay/1000} seconds before sending follow-up command...`);
        await new Promise(resolve => setTimeout(resolve, followUpDelay));
        
        logger.log(`Sending follow-up command: ${followUpCommand}`);
        await chat.sendMessage(followUpCommand);
        logger.log('Follow-up command sent');
    }
    
    return response;
}

// Mock the openaiUtils module to capture prompts
function setupPromptCapture() {
    try {
        // Create a variable to store the last prompt
        global.lastPrompt = null;
        global.promptCaptured = false;
        
        // Store the original console.log function
        const originalConsoleLog = console.log;
        
        // Flag to prevent recursion
        let isLogging = false;
        
        // Override console.log to capture prompts from the logs
        console.log = function() {
            // Prevent recursion
            if (isLogging) {
                return originalConsoleLog.apply(console, arguments);
            }
            
            isLogging = true;
            
            // Call the original console.log
            originalConsoleLog.apply(console, arguments);
            
            // Check if this is a prompt log
            const logMessage = Array.from(arguments).join(' ');
            
            // Detect different ways prompts might be logged
            
            // Direct prompt messages or timestamps
            if (logMessage.includes('[PROMPT]') || logMessage.includes('ChatGPT Prompt')) {
                logger.log('Found prompt log entry, capturing...');
                
                // Check if the next line has the actual prompt content
            if (logMessage.includes('DIRETRIZES')) {
                    logger.log('Found prompt with DIRETRIZES, capturing...');
                    global.lastPrompt = logMessage;
                    global.promptCaptured = true;
                }
            }
            // Look for the start of a prompt (DIRETRIZES)
            else if (logMessage.includes('DIRETRIZES')) {
                logger.log('Found prompt with DIRETRIZES, capturing...');
                global.lastPrompt = logMessage;
                global.promptCaptured = true;
            }
            
            // Also capture message history
            if ((logMessage.includes('>>') && logMessage.includes('FIM DAS ÚLTIMAS')) ||
                (logMessage.includes('COMEÇO DAS ÚLTIMAS') && logMessage.includes('MENSAGENS'))) {
                logger.log('Found message history, capturing...');
                if (global.lastPrompt) {
                    global.lastPrompt += '\n' + logMessage;
                } else {
                    global.lastPrompt = logMessage;
                }
                global.promptCaptured = true;
            }
            
            isLogging = false;
        };
        
        // Add a safeguard for when prompts might be on separate lines
        if (process.env.FORCE_PROMPT_LOGS === 'true') {
            logger.log('Setting up advanced prompt capture for test mode');
            
            // Create an array to store consecutive log lines
            let recentLogs = [];
            const MAX_RECENT_LOGS = 50;
            
            // Intercept stdout.write to capture all log lines
            const originalStdoutWrite = process.stdout.write;
            process.stdout.write = function(chunk) {
                const result = originalStdoutWrite.apply(process.stdout, arguments);
                
                // If it's a string, add it to recent logs
                if (typeof chunk === 'string') {
                    recentLogs.push(chunk);
                    if (recentLogs.length > MAX_RECENT_LOGS) {
                        recentLogs.shift(); // Remove oldest entry
                    }
                    
                    // Look for prompt markers in combined recent logs
                    const combinedLogs = recentLogs.join('');
                    if (combinedLogs.includes('DIRETRIZES') && !global.promptCaptured) {
                        logger.log('Found DIRETRIZES in recent logs');
                        global.lastPrompt = combinedLogs;
                        global.promptCaptured = true;
                    }
                    
                    // Look for message history markers
                    if (combinedLogs.includes('FIM DAS ÚLTIMAS') && combinedLogs.includes('>>')) {
                        logger.log('Found message history in recent logs');
                        if (global.lastPrompt) {
                            global.lastPrompt += '\n' + combinedLogs;
                        } else {
                            global.lastPrompt = combinedLogs;
                        }
                        global.promptCaptured = true;
                    }
                }
                
                return result;
            };
        }
        
        logger.debug('Prompt capture set up successfully');
        return true;
    } catch (error) {
        logger.error('Error setting up prompt capture:', error);
        return false;
    }
}

// Check if the prompt contains personality and message history
async function checkPromptContent(prompt) {
    // Wait a bit to ensure the prompt is captured
    logger.log('Waiting for prompt to be fully captured...');
    
    // Wait for the prompt to be captured with a timeout
    const startTime = Date.now();
    const timeout = 30000; // 30 seconds timeout
    
    while (!global.promptCaptured && (Date.now() - startTime) < timeout) {
        logger.log('Waiting for prompt to be captured...');
        await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second
    }
    
    // Use the global lastPrompt if no prompt is provided
    prompt = prompt || global.lastPrompt;
    
    if (!prompt) {
        logger.warn('No prompt captured after waiting. This might be a timing issue or the prompt logs are not enabled.');
        return { 
            hasPersonality: false, 
            hasMessageHistory: false,
            details: 'No prompt captured'
        };
    }
    
    logger.log('Checking captured prompt content...');
    
    // Check for specific markers in the prompt
    const hasPersonality = prompt.includes('DIRETRIZES');
    const hasMessageHistory = prompt.includes('>>');
    
    logger.log('Prompt check results:', {
        hasPersonality,
        hasMessageHistory,
        promptLength: prompt.length
    });
    
    // If either check fails, log more details to help debug
    if (!hasPersonality || !hasMessageHistory) {
        logger.log('Prompt check failed. Detailed analysis:');
        logger.log('- Contains "DIRETRIZES":', hasPersonality);
        logger.log('- Contains ">>":', hasMessageHistory);
        logger.log('First 1000 characters of prompt:');
        logger.log(prompt.substring(0, 1000) + '...');
    } else {
        logger.log('Prompt check passed! Found both "DIRETRIZES" and ">>"');
    }
    
    return {
        hasPersonality,
        hasMessageHistory,
        details: `Personality: ${hasPersonality ? 'Yes' : 'No'}, Message History: ${hasMessageHistory ? 'Yes' : 'No'}, Prompt Length: ${prompt.length} chars`
    };
}

// Run a single test
async function runTest(client, group, test) {
    logger.startTest(test.name);
    
    try {
        // Skip admin-only tests if not running as admin
        if (test.adminOnly && !config.ADMIN_NUMBER) {
            logger.endTest(true, test.name, 'Skipped (Admin-only test)');
            testResults.skipped++;
            testResults.details.push({
                name: test.name,
                result: 'SKIPPED',
                reason: 'Admin-only test'
            });
            return { needsShortDelay: true };
        }
        
        // Reset the last prompt
        global.lastPrompt = null;
        
        // Send the command
        const response = await sendMessageAndWaitForResponse(client, group, test.command, {
            attachment: test.attachment,
            quote: test.quote,
            preMessage: test.preMessage,
            preCommand: test.preCommand,
            timeout: test.extraDelay ? config.RESPONSE_TIMEOUT + test.extraDelay : config.RESPONSE_TIMEOUT,
            useBotChat: test.useBotChat,
            useAdminChat: test.useAdminChat,
            preDelay: test.preDelay,
            sendAttachmentFirst: test.sendAttachmentFirst,
            attachWithCommand: test.attachWithCommand,
            isSticker: test.isSticker,
            checkBotMessageDeletion: test.checkBotMessageDeletion,
            followUpCommand: test.followUpCommand,
            followUpDelay: test.followUpDelay
        });
        
        // Check if we got a response
        if (!response && test.expectedResponseContains.length > 0 && !test.checkBotMessageDeletion) {
            throw new Error('No response received within timeout');
        }
        
        // Special case for bot message deletion test
        if (test.checkBotMessageDeletion) {
            if (!response || !response.wasDeleted) {
                throw new Error('Bot message was not deleted after reaction');
            }
            logger.endTest(true, test.name, 'Message was deleted after reaction');
            testResults.passed++;
            testResults.details.push({
                name: test.name,
                result: 'PASSED',
                details: 'Message was deleted after reaction'
            });
            return { needsShortDelay: true };
        }
        
        // Special case for prompt check
        if (test.checkPrompt) {
            const promptCheck = await checkPromptContent(global.lastPrompt);
            
            if (!promptCheck.hasPersonality || !promptCheck.hasMessageHistory) {
                throw new Error(`Prompt check failed: ${promptCheck.details}`);
            }
            
            logger.endTest(true, test.name, 'Prompt check passed');
            testResults.passed++;
            testResults.details.push({
                name: test.name,
                result: 'PASSED',
                details: promptCheck.details
            });
            return { needsShortDelay: true };
        }
        
        // Check if response contains expected text
        let passed = true;
        if (test.expectedResponseContains.length > 0 && response) {
            const responseText = response.body.toLowerCase();
            
            // Check if at least one of the expected keywords is found
            let foundAnyKeyword = false;
            let missingKeywords = [];
            
            for (const expected of test.expectedResponseContains) {
                const normalizedExpected = expected.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
                const normalizedResponse = responseText.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
                
                if (normalizedResponse.includes(normalizedExpected)) {
                    foundAnyKeyword = true;
                } else {
                    missingKeywords.push(expected);
                }
            }
            
            // Test passes if at least one keyword is found
            if (!foundAnyKeyword) {
                passed = false;
                throw new Error(`Response does not contain any of the expected keywords: ${test.expectedResponseContains.join(', ')}`);
            }
        }
        
        // Check for media if expected
        if (test.expectMedia && response && !response.hasMedia) {
            passed = false;
            throw new Error('Expected media in response but none was received');
        }
        
        logger.endTest(true, test.name);
        testResults.passed++;
        testResults.details.push({
            name: test.name,
            result: 'PASSED'
        });
        
        return { needsShortDelay: true };
    } catch (error) {
        logger.endTest(false, test.name, error.message);
        testResults.failed++;
        testResults.details.push({
            name: test.name,
            result: 'FAILED',
            error: error.message
        });
        
        // Re-throw the error to be caught by the main test runner
        throw error;
    }
}

// Run all tests
async function runAllTests() {
    let client;
    let botProcess;
    let exitCode = 0;
    let startedNewBot = false;
    
    try {
        // Reset test results at the start of a new test run
        resetTestResults();
        
        sendStatusMessage('Starting test sequence...');
        logger.log('Starting test sequence...');
        
        // Check for sample files
        if (!checkSampleFiles()) {
            logger.warn('Some sample files are missing. Some tests may fail.');
        }
        
        // Set up prompt capture
        sendStatusMessage('Setting up prompt capture...');
        logger.log('Setting up prompt capture...');
        setupPromptCapture();
        
        // Initialize client
        sendStatusMessage('Initializing WhatsApp test client...');
        logger.log('Initializing WhatsApp test client...');
        try {
            client = await initializeClient();
            sendStatusMessage('WhatsApp test client initialized successfully');
            logger.log('WhatsApp test client initialized successfully');
        } catch (error) {
            logger.error('Failed to initialize WhatsApp test client:', error);
            logger.error('Try deleting the wwebjs/auth_test directory and running npm run setup again');
            throw error;
        }
        
        // Wait for client to be fully ready
        sendStatusMessage('Waiting for WhatsApp client to be fully ready...');
        logger.log('Waiting for WhatsApp client to be fully ready...');
        
        // Create a promise that resolves when the client is ready
        if (!client.info) {
            logger.log('Client not fully ready, waiting for info...');
            await new Promise((resolve, reject) => {
                const readyCheck = setInterval(() => {
                    if (client.info) {
                        clearInterval(readyCheck);
                        sendStatusMessage('Client is fully authenticated and ready.');
                        logger.log('Client is fully authenticated and ready.');
                        resolve();
                    }
                }, 1000);
                
                // Set a timeout in case authentication takes too long
                setTimeout(() => {
                    clearInterval(readyCheck);
                    logger.warn('Authentication timeout reached. Continuing with tests, but some may fail.');
                    resolve();
                }, 60000); // 1 minute timeout
            });
        } else {
            sendStatusMessage('Client is already fully ready');
            logger.log('Client is already fully ready');
        }
        
        // Verify group access
        if (config.VERIFY_WHITELIST) {
            sendStatusMessage('Verifying group access...');
            logger.log('Verifying group access...');
            try {
                await verifyGroupAccess(client, config.TARGET_GROUP);
                sendStatusMessage('Group access verified successfully');
                logger.log('Group access verified successfully');
            } catch (error) {
                logger.error('Failed to verify group access:', error);
                throw error;
            }
        }
        
        // Check if bot is already running
        sendStatusMessage('Checking if bot is already running...');
        logger.log('Checking if bot is already running...');
        const isRunning = await checkIfBotIsRunning();
        
        if (isRunning) {
            sendStatusMessage('Bot is already running. Using existing bot instance.');
            logger.log('Bot is already running. Using existing bot instance.');
            // We'll use the existing bot
        } else {
            sendStatusMessage('Bot is not running. Starting a new instance...');
            logger.log('Bot is not running. Starting a new instance...');
            // Start the bot
            try {
                botProcess = startBot();
                startedNewBot = true;
                
                // Wait for bot to initialize
                sendStatusMessage(`Waiting ${config.BOT_STARTUP_WAIT/1000} seconds for bot to initialize...`);
                logger.log(`Waiting ${config.BOT_STARTUP_WAIT/1000} seconds for bot to initialize...`);
                await new Promise(resolve => setTimeout(resolve, config.BOT_STARTUP_WAIT));
                sendStatusMessage('Bot initialization wait completed');
                logger.log('Bot initialization wait completed');
            } catch (error) {
                logger.error('Failed to start bot:', error);
                throw error;
            }
        }
        
        // Find target group
        sendStatusMessage('Finding target group...');
        logger.log('Finding target group...');
        let group;
        try {
            group = await findTargetGroup(client);
            sendStatusMessage(`Found target group: ${group.name}`);
            logger.log(`Found target group: ${group.name}`);
        } catch (error) {
            logger.error('Failed to find target group:', error);
            throw error;
        }
        
        // Get test cases based on enabled categories
        const testCases = getTestCases();
        sendStatusMessage(`Preparing to run ${testCases.length} tests...`);
        logger.log(`Preparing to run ${testCases.length} tests...`);
        
        // Signal that clients are ready and tests are about to start
        logger.debug('CLIENTS_READY');
        
        // Small delay to ensure the CLIENTS_READY signal is processed
        await new Promise(resolve => setTimeout(resolve, 100));
        
        // Run tests sequentially
        for (const test of testCases) {
            const result = await runTest(client, group, test);
            
            // Use a shorter delay between tests if the test has already completed
            const delayTime = result && result.needsShortDelay ? 1000 : config.DELAY_BETWEEN_TESTS;
            logger.log(`Waiting ${delayTime/1000} seconds before running next test...`);
            await new Promise(resolve => setTimeout(resolve, delayTime));
        }
        
        // Clean up resources
        if (startedNewBot) {
            sendStatusMessage('Stopping the bot...');
            logger.log('Stopping the bot...');
            try {
                botProcess.kill();
            } catch (error) {
                logger.error('Error stopping the bot:', error);
            }
        }
        
        sendStatusMessage('Test sequence completed successfully');
        logger.log('Test sequence completed successfully');
        
        return {
            passed: testResults.passed,
            failed: testResults.failed,
            skipped: testResults.skipped,
            details: testResults.details
        };
            } catch (error) {
        logger.error('Test sequence failed:', error);
        throw error;
    }
}

// Check if the bot is already running
async function checkIfBotIsRunning() {
    try {
        logger.log('Checking if bot is already running...');
        return new Promise((resolve) => {
            // Use a more specific command to find the bot process
            const cmd = `ps aux | grep "node.*index.js" | grep -v "grep" | grep -v "test"`;
            exec(cmd, (error, stdout, stderr) => {
                if (error) {
                    // Command failed, bot is not running
                    logger.log('Bot is not running (ps command failed)');
                    resolve(false);
                    return;
                }
                
                // Check if there's output (bot is running)
                const isRunning = stdout.trim() !== '';
                if (isRunning) {
                    logger.log('Bot is already running:');
                    logger.log(stdout.trim());
                } else {
                    logger.log('Bot is not running (no matching processes)');
                }
                resolve(isRunning);
            });
        });
    } catch (error) {
        logger.error('Error checking if bot is running:', error);
        return false;
    }
}

// Export the runAllTests function
module.exports = {
    runAllTests,
    initializeClient,
    checkIfBotIsRunning,
    startBot,
    findTargetGroup,
    findBotChat,
    sendMessageAndWaitForResponse,
    setupPromptCapture,
    checkPromptContent,
    runTest,
    getTestResults,
    resetTestResults
};