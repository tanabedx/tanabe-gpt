const logger = require('./logger');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

/**
 * Check if dependency synchronization is needed based on git changes
 * @param {Array} changedFiles - Array of changed file paths from git
 * @returns {boolean} True if dependencies need to be synchronized
 */
function needsDependencySync(changedFiles) {
    if (!changedFiles || changedFiles.length === 0) {
        return false;
    }
    
    // Check if package.json or package-lock.json were modified
    const dependencyFiles = ['package.json', 'package-lock.json'];
    const hasDependencyChanges = changedFiles.some(file => 
        dependencyFiles.includes(file.trim())
    );
    
    if (hasDependencyChanges) {
        logger.debug('Dependency files changed:', changedFiles.filter(file => 
            dependencyFiles.includes(file.trim())
        ));
        return true;
    }
    
    return false;
}

/**
 * Check if node_modules is out of sync with package-lock.json
 * @returns {boolean} True if node_modules needs to be synchronized
 */
function isNodeModulesOutOfSync() {
    try {
        const packageLockPath = path.join(process.cwd(), 'package-lock.json');
        const nodeModulesPath = path.join(process.cwd(), 'node_modules');
        
        // If package-lock.json exists but node_modules doesn't, definitely out of sync
        if (fs.existsSync(packageLockPath) && !fs.existsSync(nodeModulesPath)) {
            logger.debug('node_modules missing but package-lock.json exists');
            return true;
        }
        
        // If package-lock.json is newer than node_modules, likely out of sync
        if (fs.existsSync(packageLockPath) && fs.existsSync(nodeModulesPath)) {
            const packageLockStat = fs.statSync(packageLockPath);
            const nodeModulesStat = fs.statSync(nodeModulesPath);
            
            if (packageLockStat.mtime > nodeModulesStat.mtime) {
                logger.debug('package-lock.json is newer than node_modules');
                return true;
            }
        }
        
        return false;
    } catch (error) {
        logger.debug('Error checking node_modules sync status:', error.message);
        return false;
    }
}

/**
 * Perform dependency synchronization using npm ci
 * @returns {Object} Result object with success status and details
 */
async function performDependencySync() {
    try {
        logger.debug('Starting dependency synchronization...');
        
        // Check if package-lock.json exists (required for npm ci)
        const packageLockPath = path.join(process.cwd(), 'package-lock.json');
        if (!fs.existsSync(packageLockPath)) {
            logger.warn('package-lock.json not found, falling back to npm install');
            return await performNpmInstall();
        }
        
        // Use npm ci for production-safe installation
        logger.debug('Running npm ci...');
        const startTime = Date.now();
        
        const output = execSync('npm ci --production --silent', { 
            timeout: 180000, // 3 minutes timeout
            stdio: 'pipe',
            encoding: 'utf8'
        }).toString();
        
        const duration = Math.round((Date.now() - startTime) / 1000);
        logger.debug(`npm ci completed in ${duration} seconds`);
        
        return {
            success: true,
            operation: 'npm ci',
            duration: duration,
            status: 'Dependencies synchronized successfully',
            output: output.trim()
        };
        
    } catch (error) {
        logger.warn('npm ci failed, attempting fallback to npm install:', error.message);
        return await performNpmInstall();
    }
}

/**
 * Fallback dependency installation using npm install
 * @returns {Object} Result object with success status and details
 */
async function performNpmInstall() {
    try {
        logger.debug('Running npm install as fallback...');
        const startTime = Date.now();
        
        const output = execSync('npm install --production --silent', { 
            timeout: 180000, // 3 minutes timeout
            stdio: 'pipe',
            encoding: 'utf8'
        }).toString();
        
        const duration = Math.round((Date.now() - startTime) / 1000);
        logger.debug(`npm install completed in ${duration} seconds`);
        
        return {
            success: true,
            operation: 'npm install (fallback)',
            duration: duration,
            status: 'Dependencies installed successfully',
            output: output.trim()
        };
        
    } catch (error) {
        logger.error('Both npm ci and npm install failed:', error.message);
        return {
            success: false,
            operation: 'failed',
            duration: 0,
            status: 'Dependency synchronization failed',
            error: error.message
        };
    }
}

/**
 * Check current dependency status for startup reporting
 * @returns {Object} Status object with dependency information
 */
function getDependencyStatus() {
    try {
        const packageJsonPath = path.join(process.cwd(), 'package.json');
        const packageLockPath = path.join(process.cwd(), 'package-lock.json');
        const nodeModulesPath = path.join(process.cwd(), 'node_modules');
        
        const status = {
            packageJson: fs.existsSync(packageJsonPath),
            packageLock: fs.existsSync(packageLockPath),
            nodeModules: fs.existsSync(nodeModulesPath),
            outOfSync: isNodeModulesOutOfSync(),
            lastSync: 'Unknown'
        };
        
        // Try to get last sync time from node_modules modification time
        if (status.nodeModules) {
            const nodeModulesStat = fs.statSync(nodeModulesPath);
            status.lastSync = nodeModulesStat.mtime.toISOString();
        }
        
        return status;
    } catch (error) {
        logger.debug('Error getting dependency status:', error.message);
        return {
            packageJson: false,
            packageLock: false,
            nodeModules: false,
            outOfSync: true,
            lastSync: 'Error',
            error: error.message
        };
    }
}

module.exports = {
    needsDependencySync,
    isNodeModulesOutOfSync,
    performDependencySync,
    getDependencyStatus
}; 