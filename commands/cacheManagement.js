const fs = require('fs').promises;
const path = require('path');
const logger = require('../utils/logger');

// Cache directories to clear
const CACHE_DIRS = ['.wwebjs_cache'];

// Memory management settings
const MEMORY_CHECK_INTERVAL = 5 * 60 * 1000; // 5 minutes
const MEMORY_THRESHOLD_MB = 300; // Trigger GC when memory usage exceeds this
const MAX_MEMORY_LOGS = 10;
let memoryUsageLog = [];
let memoryMonitorInterval = null;

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

/**
 * Logs memory usage and performs garbage collection if needed
 */
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

    // Check if memory usage exceeds threshold
    if (memoryInfo.heapUsed > MEMORY_THRESHOLD_MB) {
        logger.warn(
            `Memory threshold exceeded: ${memoryInfo.heapUsed}MB > ${MEMORY_THRESHOLD_MB}MB. Forcing garbage collection.`
        );
        forceGarbageCollection();
    }

    // Also check if memory usage is increasing rapidly
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

    // Perform cache clearing if memory is getting high
    if (memoryInfo.rss > MEMORY_THRESHOLD_MB * 1.5) {
        logger.info(`High memory usage detected (${memoryInfo.rss}MB). Clearing old caches...`);
        performCacheClearing(3)
            .then(({ clearedFiles }) => {
                if (clearedFiles > 0) {
                    logger.info(`Cleared ${clearedFiles} cache files`);
                }
            })
            .catch(err => {
                logger.error(`Failed to clear caches: ${err.message}`);
            });
    }
}

/**
 * Forces garbage collection if available
 */
function forceGarbageCollection() {
    try {
        if (global.gc) {
            const beforeGC = process.memoryUsage().heapUsed / 1024 / 1024;
            global.gc();
            const afterGC = process.memoryUsage().heapUsed / 1024 / 1024;
            logger.info(
                `Garbage collection complete: freed ${Math.round(
                    beforeGC - afterGC
                )}MB. Current heap: ${Math.round(afterGC)}MB`
            );
        } else {
            logger.warn('Garbage collection not available. Run with --expose-gc flag.');
        }
    } catch (error) {
        logger.error('Error during garbage collection:', error);
    }
}

/**
 * Starts periodic memory monitoring
 */
function startMemoryMonitoring() {
    if (memoryMonitorInterval) {
        clearInterval(memoryMonitorInterval);
    }

    // Log initial memory usage
    logMemoryUsage();

    // Set up regular monitoring interval
    memoryMonitorInterval = setInterval(() => {
        logMemoryUsage();

        // Force GC every hour regardless of memory usage
        if (global.gc && Date.now() % (60 * 60 * 1000) < MEMORY_CHECK_INTERVAL) {
            logger.debug('Performing scheduled garbage collection');
            forceGarbageCollection();
        }
    }, MEMORY_CHECK_INTERVAL);

    logger.info(
        `Memory monitoring started (interval: ${MEMORY_CHECK_INTERVAL / 1000 / 60} minutes)`
    );
    return memoryMonitorInterval;
}

/**
 * Stops the memory monitoring
 */
function stopMemoryMonitoring() {
    if (memoryMonitorInterval) {
        clearInterval(memoryMonitorInterval);
        memoryMonitorInterval = null;
        logger.info('Memory monitoring stopped');
    }
}

module.exports = {
    performCacheClearing,
    startMemoryMonitoring,
    stopMemoryMonitoring,
    forceGarbageCollection,
};
