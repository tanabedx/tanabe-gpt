// VPS Optimization Settings
const logger = require('../utils/logger');

// Check if running in VPS optimized mode
const IS_VPS_OPTIMIZED = process.env.OPTIMIZE_FOR_VPS === 'true';
const IS_DEDICATED_VPS = process.env.DEDICATED_VPS === 'true';

// Apply runtime optimizations if in VPS mode
if (IS_VPS_OPTIMIZED) {
    logger.info(`VPS optimizations enabled (${IS_DEDICATED_VPS ? 'Dedicated' : 'Shared'} mode)`);
    
    // Set UV thread pool size to match CPU cores
    process.env.UV_THREADPOOL_SIZE = '4'; // Increase for dedicated VPS
    
    // Increase concurrent DNS queries for dedicated VPS
    process.env.UV_THREADPOOL_SIZE_DNS = IS_DEDICATED_VPS ? '2' : '1';
    
    // Set Node.js cluster scheduling policy
    process.env.NODE_CLUSTER_SCHED_POLICY = 'rr'; // Round-robin
    
    // Memory pressure handling
    if (global.gc) {
        // Less aggressive GC for dedicated VPS (every 10 minutes instead of 5)
        const gcInterval = IS_DEDICATED_VPS ? 10 * 60 * 1000 : 5 * 60 * 1000;
        setInterval(() => {
            const before = process.memoryUsage().heapUsed / 1024 / 1024;
            global.gc();
            const after = process.memoryUsage().heapUsed / 1024 / 1024;
            logger.debug(`Scheduled GC: freed ${(before - after).toFixed(1)}MB`);
        }, gcInterval);
    }
    
    // Monitor event loop lag - less sensitive for dedicated VPS
    let lastCheck = Date.now();
    const lagThreshold = IS_DEDICATED_VPS ? 200 : 100; // Higher threshold for dedicated
    setInterval(() => {
        const now = Date.now();
        const lag = now - lastCheck - 1000;
        if (lag > lagThreshold) {
            logger.warn(`Event loop lag detected: ${lag}ms`);
        }
        lastCheck = now;
    }, 1000);
    
    // Set process priority (requires root on Linux)
    if (IS_DEDICATED_VPS && process.platform === 'linux') {
        try {
            process.setpriority(-10); // Higher priority
            logger.info('Process priority increased');
        } catch (err) {
            logger.debug('Could not set process priority (requires root)');
        }
    }
}

// VPS-specific configurations
const VPS_CONFIG = {
    // Larger batch sizes for dedicated VPS
    MESSAGE_BATCH_SIZE: IS_DEDICATED_VPS ? 50 : (IS_VPS_OPTIMIZED ? 20 : 50),
    
    // Standard timeouts for dedicated VPS
    REQUEST_TIMEOUT: IS_DEDICATED_VPS ? 30000 : (IS_VPS_OPTIMIZED ? 15000 : 30000),
    
    // Standard caching for dedicated VPS
    CACHE_TTL: IS_VPS_OPTIMIZED ? 7200 : 3600, // 2 hours vs 1 hour
    
    // More concurrent operations for dedicated VPS
    MAX_CONCURRENT_OPERATIONS: IS_DEDICATED_VPS ? 4 : (IS_VPS_OPTIMIZED ? 2 : 5),
    
    // WhatsApp specific - less conservative for dedicated
    WHATSAPP_RETRY_DELAY: IS_DEDICATED_VPS ? 1500 : (IS_VPS_OPTIMIZED ? 3000 : 1000),
    WHATSAPP_MAX_RETRIES: IS_DEDICATED_VPS ? 3 : (IS_VPS_OPTIMIZED ? 2 : 3),
    
    // Dedicated VPS can handle more
    MAX_CHAT_HISTORY: IS_DEDICATED_VPS ? 100 : 50,
    MAX_CONCURRENT_AI_CALLS: IS_DEDICATED_VPS ? 2 : 1,
};

// Log configuration on startup
logger.info('VPS Configuration:', {
    vpsOptimized: IS_VPS_OPTIMIZED,
    dedicatedVps: IS_DEDICATED_VPS,
    messageBatchSize: VPS_CONFIG.MESSAGE_BATCH_SIZE,
    maxConcurrentOps: VPS_CONFIG.MAX_CONCURRENT_OPERATIONS,
    threadPoolSize: process.env.UV_THREADPOOL_SIZE
});

// Export configuration
module.exports = {
    IS_VPS_OPTIMIZED,
    IS_DEDICATED_VPS,
    VPS_CONFIG,
    
    // Helper to get optimized value
    getOptimizedValue: (standard, optimized) => 
        IS_VPS_OPTIMIZED ? optimized : standard
}; 