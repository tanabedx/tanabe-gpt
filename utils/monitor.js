/**
 * Simple VPS Memory Monitor for Tanabe-GPT
 *
 * Run with: node monitor.js
 * To run in background: nohup node monitor.js > monitor.log &
 */

const fs = require('fs');
const os = require('os');
const { exec } = require('child_process');
const path = require('path');

// Configuration
const CONFIG = {
    // Monitoring intervals
    CHECK_INTERVAL_MS: 60000, // 1 minute
    LOG_INTERVAL_MS: 300000, // 5 minutes

    // Thresholds (percentage)
    MEMORY_WARNING_THRESHOLD: 85,
    MEMORY_CRITICAL_THRESHOLD: 95,
    SWAP_WARNING_THRESHOLD: 80,

    // Actions
    AUTO_RESTART_ON_CRITICAL: true,
    LOG_FILE: path.join(__dirname, 'logs', 'vps-monitor.log'),

    // Process name in pm2
    PM2_PROCESS_NAME: 'tanabe-gpt',
};

// Ensure logs directory exists
const logsDir = path.join(__dirname, 'logs');
if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
}

// Logger function
function log(message, isError = false) {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] ${message}`;

    console[isError ? 'error' : 'log'](logMessage);

    // Append to log file
    fs.appendFileSync(CONFIG.LOG_FILE, logMessage + '\n');
}

// Get memory usage
function getMemoryUsage() {
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;

    const memoryUsagePercent = (usedMem / totalMem) * 100;

    return {
        total: formatBytes(totalMem),
        free: formatBytes(freeMem),
        used: formatBytes(usedMem),
        percentUsed: memoryUsagePercent.toFixed(2),
    };
}

// Get swap usage
function getSwapInfo(callback) {
    exec('cat /proc/swaps', (err, stdout) => {
        if (err) {
            callback({ error: err.message });
            return;
        }

        const lines = stdout.split('\n');
        // Skip header
        if (lines.length < 2) {
            callback({ error: 'No swap information available' });
            return;
        }

        // Parse swap info
        const swapLine = lines[1].trim().split(/\s+/);
        if (swapLine.length >= 4) {
            const total = parseInt(swapLine[2]);
            const used = parseInt(swapLine[3]);
            const percentUsed = ((used / total) * 100).toFixed(2);

            callback({
                total: formatBytes(total * 1024), // Convert KB to bytes
                used: formatBytes(used * 1024), // Convert KB to bytes
                percentUsed,
            });
        } else {
            callback({ error: 'Failed to parse swap information' });
        }
    });
}

// Get process memory usage
function getProcessInfo(callback) {
    exec('pm2 jlist', (err, stdout) => {
        if (err) {
            callback({ error: err.message });
            return;
        }

        try {
            const processes = JSON.parse(stdout);
            const targetProcess = processes.find(p => p.name === CONFIG.PM2_PROCESS_NAME);

            if (!targetProcess) {
                callback({ error: `Process ${CONFIG.PM2_PROCESS_NAME} not found` });
                return;
            }

            callback({
                pid: targetProcess.pid,
                name: targetProcess.name,
                uptime: formatUptime(targetProcess.pm2_env.pm_uptime),
                memory: formatBytes(targetProcess.monit.memory),
                cpu: `${targetProcess.monit.cpu}%`,
                restarts: targetProcess.pm2_env.restart_time,
            });
        } catch (e) {
            callback({ error: `Failed to parse PM2 output: ${e.message}` });
        }
    });
}

// Restart the application
function restartApp(reason) {
    log(`🔄 Restarting ${CONFIG.PM2_PROCESS_NAME} due to ${reason}...`);

    exec(`pm2 restart ${CONFIG.PM2_PROCESS_NAME}`, (err, stdout) => {
        if (err) {
            log(`Failed to restart: ${err.message}`, true);
            return;
        }
        log(`Application restarted successfully: ${stdout.trim()}`);
    });
}

// Helper functions
function formatBytes(bytes) {
    if (bytes === 0) return '0 B';

    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));

    return parseFloat((bytes / Math.pow(1024, i)).toFixed(2)) + ' ' + sizes[i];
}

function formatUptime(timestamp) {
    const uptime = Date.now() - timestamp;
    const days = Math.floor(uptime / (24 * 60 * 60 * 1000));
    const hours = Math.floor((uptime % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
    const minutes = Math.floor((uptime % (60 * 60 * 1000)) / (60 * 1000));

    return `${days}d ${hours}h ${minutes}m`;
}

// Main monitoring function
function checkSystem() {
    const memInfo = getMemoryUsage();

    getSwapInfo(swapInfo => {
        getProcessInfo(processInfo => {
            // Handle critical conditions
            let isCritical = false;

            if (parseFloat(memInfo.percentUsed) > CONFIG.MEMORY_CRITICAL_THRESHOLD) {
                log(`⚠️ CRITICAL: System memory usage at ${memInfo.percentUsed}%`, true);
                isCritical = true;
            }

            if (
                !swapInfo.error &&
                parseFloat(swapInfo.percentUsed) > CONFIG.SWAP_WARNING_THRESHOLD
            ) {
                log(`⚠️ WARNING: Swap usage high at ${swapInfo.percentUsed}%`, true);
            }

            // Auto-restart if configured and memory usage is critical
            if (isCritical && CONFIG.AUTO_RESTART_ON_CRITICAL) {
                restartApp('critical memory usage');
            }
        });
    });
}

// Periodic comprehensive logging
function logSystemStatus() {
    const memInfo = getMemoryUsage();

    getSwapInfo(swapInfo => {
        getProcessInfo(processInfo => {
            let status = '📊 VPS MONITOR STATUS REPORT\n';
            status += '------------------------------\n';
            status += `🖥️  System Memory: ${memInfo.used}/${memInfo.total} (${memInfo.percentUsed}%)\n`;

            if (!swapInfo.error) {
                status += `💾 Swap Usage: ${swapInfo.used}/${swapInfo.total} (${swapInfo.percentUsed}%)\n`;
            }

            if (!processInfo.error) {
                status += `\n🤖 Bot Process (${processInfo.name}):\n`;
                status += `   - PID: ${processInfo.pid}\n`;
                status += `   - Memory: ${processInfo.memory}\n`;
                status += `   - CPU: ${processInfo.cpu}\n`;
                status += `   - Uptime: ${processInfo.uptime}\n`;
                status += `   - Restarts: ${processInfo.restarts}\n`;
            } else {
                status += `\n❌ Bot Process: ${processInfo.error}\n`;
            }

            status += '------------------------------';
            log(status);
        });
    });
}

// Start monitoring
log('🚀 VPS Monitor started');
logSystemStatus(); // Initial status report

// Schedule regular checks
setInterval(checkSystem, CONFIG.CHECK_INTERVAL_MS);
setInterval(logSystemStatus, CONFIG.LOG_INTERVAL_MS);

// Handle process termination
process.on('SIGINT', () => {
    log('🛑 VPS Monitor stopped');
    process.exit(0);
});
