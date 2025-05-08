const fs = require('fs').promises;
const path = require('path');
const logger = require('../utils/logger');

// Cache directories to clear
const CACHE_DIRS = ['.wwebjs_cache'];

/**
 * Clears WhatsApp Web.js and Puppeteer caches while preserving authentication
 * @param {number} maxAgeInDays - Only clear files older than this many days, or 0 to clear all files
 * @returns {Promise<{clearedFiles: number}>} Number of files cleared
 */
async function performCacheClearing(maxAgeInDays = 5) {
    let clearedFiles = 0;
    const now = Date.now();
    const maxAgeMs = maxAgeInDays * 24 * 60 * 60 * 1000;

    for (const dir of CACHE_DIRS) {
        const dirPath = path.join(__dirname, '..', dir);
        try {
            const files = await fs.readdir(dirPath);
            for (const file of files) {
                const filePath = path.join(dirPath, file);
                try {
                    const stats = await fs.stat(filePath);
                    // Skip auth files
                    if (file.includes('session') || file.includes('auth')) {
                        continue;
                    }

                    // Check file age if maxAgeInDays > 0, otherwise clear all files
                    const shouldClear =
                        maxAgeInDays === 0 || now - stats.mtime.getTime() > maxAgeMs;

                    if (stats.isFile() && shouldClear) {
                        await fs.unlink(filePath);
                        clearedFiles++;
                    }
                } catch (error) {
                    logger.error(`Error deleting cache file ${filePath}:`, error);
                }
            }
        } catch (error) {
            if (error.code !== 'ENOENT') {
                logger.error(`Error accessing cache directory ${dir}:`, error);
            }
        }
    }

    return { clearedFiles };
}

module.exports = {
    performCacheClearing,
};
