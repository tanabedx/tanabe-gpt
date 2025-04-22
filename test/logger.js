/**
 * Test Logger
 * 
 * This logger respects SILENT and DEBUG environment variables to control output.
 * - SILENT=true: Only errors and test results will be shown
 * - DEBUG=true: All messages including debug info will be shown
 */

// Store the original console methods
const originalConsole = {
    log: console.log,
    error: console.error,
    warn: console.warn,
    debug: console.debug,
    info: console.info
};

// Determine log level from environment
const isSilent = process.env.SILENT === 'true';
const isDebug = process.env.DEBUG === 'true';

// Critical patterns that should be shown even in silent mode
const criticalPatterns = [
    /^\[TEST\]/,               // Test headers
    /^❌ FAILED/,              // Test failures
    /^✅ PASSED/,              // Test successes
    /^Error:/,                 // Errors
    /^Test results/,           // Test result summary
    /^Sent message:/,          // Messages sent during tests
    /^Response received:/,     // Response received during tests
    /^QR Code received/,       // QR code for authentication
    /^Client authenticated/,   // Authentication success
    /^Client is ready/         // Client ready message
];

// Override console methods
console.log = function(...args) {
    // In silent mode, only show critical messages
    if (isSilent) {
        const message = args[0]?.toString() || '';
        const isCritical = criticalPatterns.some(pattern => pattern.test(message));
        
        if (isCritical) {
            originalConsole.log(...args);
        }
        return;
    }
    
    // Not in silent mode, show everything
    originalConsole.log(...args);
};

console.debug = function(...args) {
    // Only show debug messages if DEBUG is true
    if (isDebug) {
        originalConsole.debug(...args);
    }
};

// Always show errors and warnings
console.error = originalConsole.error;
console.warn = originalConsole.warn;

module.exports = {
    isSilent,
    isDebug
}; 