/**
 * Setup Authentication Directories
 * 
 * This script ensures that the authentication directories exist and have the correct permissions.
 * It also cleans up any incorrect directory structures.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Simple logger that respects SILENT and DEBUG environment variables
const logger = {
    info: (msg) => {
        // Always show info messages, even in silent mode
        console.log(msg);
    },
    debug: (msg) => {
        // Only show debug messages if DEBUG is true and SILENT is false
        if (process.env.DEBUG === 'true' && process.env.SILENT !== 'true') {
            console.log(msg);
        }
    },
    error: (msg) => console.error(msg)
};

// Client IDs
const MAIN_CLIENT_ID = 'tanabe-gpt-client';
const TEST_CLIENT_ID = 'test-client';

// Authentication directories (using absolute paths)
const AUTH_DIRS = [
    {
        path: path.join(__dirname, '..', '.wwebjs_auth_main'),
        clientId: MAIN_CLIENT_ID
    },
    {
        path: path.join(__dirname, '..', '.wwebjs_auth_test'),
        clientId: TEST_CLIENT_ID
    }
];

logger.info('Setting up authentication directories...');
logger.debug(`Main auth directory: ${AUTH_DIRS[0].path}`);
logger.debug(`Test auth directory: ${AUTH_DIRS[1].path}`);

// Clean up incorrect directory structures
logger.debug('Cleaning up incorrect directory structures...');
AUTH_DIRS.forEach(dir => {
    const basePath = dir.path;
    const oldSessionPath = path.join(basePath, 'session');
    
    // Remove the incorrect session directory if it exists
    if (fs.existsSync(oldSessionPath)) {
        logger.debug(`Removing incorrect session directory: ${oldSessionPath}`);
        try {
            execSync(`rm -rf "${oldSessionPath}"`);
            logger.debug(`Successfully removed: ${oldSessionPath}`);
        } catch (error) {
            logger.error(`Error removing directory: ${error.message}`);
        }
    } else {
        logger.debug(`No incorrect session directory found at: ${oldSessionPath}`);
    }
});

// Create directories if they don't exist
AUTH_DIRS.forEach(dir => {
    const basePath = dir.path;
    const sessionPath = path.join(basePath, `session-${dir.clientId}`);
    
    // Create base directory
    if (!fs.existsSync(basePath)) {
        logger.debug(`Creating directory: ${basePath}`);
        try {
            fs.mkdirSync(basePath, { recursive: true });
            logger.debug(`Successfully created: ${basePath}`);
        } catch (error) {
            logger.error(`Error creating directory ${basePath}:`, error);
        }
    } else {
        logger.debug(`Directory already exists: ${basePath}`);
    }
    
    // Create session directory with correct naming
    if (!fs.existsSync(sessionPath)) {
        logger.debug(`Creating session directory: ${sessionPath}`);
        try {
            fs.mkdirSync(sessionPath, { recursive: true });
            logger.debug(`Successfully created: ${sessionPath}`);
            
            // Create Default directory inside session directory
            const defaultPath = path.join(sessionPath, 'Default');
            if (!fs.existsSync(defaultPath)) {
                logger.debug(`Creating Default directory: ${defaultPath}`);
                fs.mkdirSync(defaultPath, { recursive: true });
                logger.debug(`Successfully created: ${defaultPath}`);
            }
        } catch (error) {
            logger.error(`Error creating session directory ${sessionPath}:`, error);
        }
    } else {
        logger.debug(`Session directory already exists: ${sessionPath}`);
        
        // Check if Default directory exists
        const defaultPath = path.join(sessionPath, 'Default');
        if (!fs.existsSync(defaultPath)) {
            logger.debug(`Creating missing Default directory: ${defaultPath}`);
            try {
                fs.mkdirSync(defaultPath, { recursive: true });
                logger.debug(`Successfully created: ${defaultPath}`);
            } catch (error) {
                logger.error(`Error creating Default directory ${defaultPath}:`, error);
            }
        } else {
            logger.debug(`Default directory already exists: ${defaultPath}`);
        }
    }
    
    // Set permissions
    try {
        logger.debug(`Setting permissions for: ${basePath}`);
        fs.chmodSync(basePath, 0o755);
        if (fs.existsSync(sessionPath)) {
            fs.chmodSync(sessionPath, 0o755);
            
            // Set permissions for Default directory
            const defaultPath = path.join(sessionPath, 'Default');
            if (fs.existsSync(defaultPath)) {
                fs.chmodSync(defaultPath, 0o755);
            }
        }
        logger.debug(`Successfully set permissions for: ${basePath}`);
    } catch (error) {
        logger.error(`Error setting permissions for ${basePath}:`, error);
    }
});

logger.info('Authentication directories setup complete.');

// Only show this message if we're not already running as part of npm test
if (!process.env.npm_lifecycle_event || process.env.npm_lifecycle_event !== 'pretest') {
    logger.info('You can now run the tests with: npm test');
} 