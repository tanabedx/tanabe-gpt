// Optimized Puppeteer configuration for 2-core, 2GB RAM VPS
const logger = require('../utils/logger');

// Base configuration for minimal resource usage
const BASE_PUPPETEER_CONFIG = {
    headless: true,
    args: [
        // Critical for low-resource VPS
        '--single-process',              // Run Chrome in single process mode
        '--no-sandbox',                  // Required for root/container environments
        '--disable-setuid-sandbox',      // Required for root/container environments
        
        // Memory optimization
        '--max_old_space_size=512',      // Limit V8 heap to 512MB
        '--memory-pressure-off',         // Disable memory pressure handling
        '--disable-dev-shm-usage',       // Use /tmp instead of /dev/shm
        
        // CPU optimization
        '--disable-gpu',                 // Disable GPU hardware acceleration
        '--disable-software-rasterizer', // Disable software rasterizer
        '--disable-web-security',        // Reduce security overhead
        '--disable-features=TranslateUI', // Disable translate
        '--disable-extensions',          // Disable all extensions
        
        // Rendering optimization
        '--disable-accelerated-2d-canvas',
        '--disable-accelerated-video-decode',
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
        
        // Network optimization
        '--disable-background-networking',
        '--disable-default-apps',
        '--disable-sync',
        
        // Process limiting
        '--renderer-process-limit=1',     // Limit renderer processes
        '--max-active-webgl-contexts=1',  // Limit WebGL contexts
        
        // Additional optimizations
        '--no-first-run',
        '--no-zygote',                   // Disable zygote process
        '--mute-audio',                  // Mute audio output
        '--disable-blink-features=AutomationControlled', // Hide automation
        
        // Experimental flags for lower resource usage
        '--enable-low-end-device-mode',  // Enable low-end device optimizations
        '--disable-composited-antialiasing',
        '--disable-font-subpixel-positioning'
    ],
    
    // Additional Puppeteer options
    defaultViewport: {
        width: 1280,
        height: 720,
        isMobile: false
    },
    
    // Slow down operations slightly to reduce CPU spikes
    slowMo: 10,
    
    // Don't download images to save bandwidth and processing
    requestInterception: false
};

// Development configuration (less aggressive)
const DEV_PUPPETEER_CONFIG = {
    headless: true,
    args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-gpu',
        '--disable-dev-shm-usage'
    ],
    defaultViewport: {
        width: 1280,
        height: 720
    }
};

/**
 * Get optimized Puppeteer configuration based on environment
 * @param {string} environment - Environment (production/development)
 * @returns {Object} Puppeteer configuration
 */
function getWhatsAppOptimizedConfig(environment = 'production') {
    const isProduction = environment === 'production';
    const config = isProduction ? BASE_PUPPETEER_CONFIG : DEV_PUPPETEER_CONFIG;
    
    logger.debug('Using optimized Puppeteer configuration', {
        environment,
        singleProcess: isProduction,
        argsCount: config.args.length
    });
    
    return config;
}

// Log memory usage periodically when using Puppeteer
if (process.env.NODE_ENV === 'production') {
    setInterval(() => {
        const usage = process.memoryUsage();
        const heapUsedMB = Math.round(usage.heapUsed / 1024 / 1024);
        const rssMB = Math.round(usage.rss / 1024 / 1024);
        
        if (heapUsedMB > 400 || rssMB > 800) {
            logger.warn('High Puppeteer memory usage detected', {
                heapUsedMB,
                rssMB,
                heapTotal: Math.round(usage.heapTotal / 1024 / 1024)
            });
        }
    }, 60000); // Check every minute
}

module.exports = {
    BASE_PUPPETEER_CONFIG,
    DEV_PUPPETEER_CONFIG,
    getWhatsAppOptimizedConfig
}; 