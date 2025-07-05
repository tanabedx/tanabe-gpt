const logger = require('./logger');
const { execSync } = require('child_process');
const { needsDependencySync } = require('./dependencyUtils');

async function performStartupGitPull() {
    try {
        logger.debug('Attempting to update bot via git pull...');

        // Get current commit info before pull
        let recentCommitInfo = 'Unknown';
        try {
            recentCommitInfo = execSync('git log -1 --pretty=format:"%h - %s (%cr)"')
                .toString()
                .trim();
        } catch (logError) {
            logger.debug('Could not get latest commit info:', logError.message.split('\n')[0]);
        }

        // Perform git pull
        const output = execSync('git pull').toString().trim();

        // Check if there were any changes
        if (
            output === '' ||
            output.includes('Already up to date') ||
            output.includes('Already up-to-date')
        ) {
            // Return structured data for startup report instead of logging directly
            return {
                hasChanges: false,
                gitStatus: 'No changes detected',
                commitInfo: recentCommitInfo,
                changedFiles: [],
                needsRestart: false,
                needsDependencySync: false
            };
        } else {
            // Log the result of the pull for debug purposes
            logger.debug('Git pull result:', output);

            // Get the list of changed files
            let changedFiles = [];
            try {
                const changedFilesOutput = execSync('git diff --name-only HEAD~1')
                    .toString()
                    .trim();
                changedFiles = changedFilesOutput ? changedFilesOutput.split('\n').map(f => f.trim()).filter(f => f) : [];
                logger.debug('Changed files:', changedFiles);
            } catch (diffError) {
                logger.debug('Could not get changed files:', diffError.message.split('\n')[0]);
            }

            // Check if dependencies need to be synchronized
            const dependencyChanges = needsDependencySync(changedFiles);
            
            // Any code changes require restart to take effect
            const needsRestart = true;

            // Get the new commit info after pull
            try {
                const newCommitInfo = execSync('git log -1 --pretty=format:"%h - %s (%cr)"')
                    .toString()
                    .trim();
                return {
                    hasChanges: true,
                    gitStatus: 'Updated successfully',
                    commitInfo: newCommitInfo,
                    changedFiles: changedFiles,
                    needsRestart: needsRestart,
                    needsDependencySync: dependencyChanges
                };
            } catch (logError) {
                return {
                    hasChanges: true,
                    gitStatus: 'Updated (restart may be needed)',
                    commitInfo: recentCommitInfo,
                    changedFiles: changedFiles,
                    needsRestart: needsRestart,
                    needsDependencySync: dependencyChanges
                };
            }
        }
    } catch (error) {
        logger.error('Error performing git pull during startup:', error.message.split('\n')[0]);
        logger.warn(`Proceeding with current version due to git pull error.`);
        
        // Return error status for startup report
        return {
            hasChanges: false,
            gitStatus: 'Git pull failed',
            commitInfo: 'Unknown',
            changedFiles: [],
            needsRestart: false,
            needsDependencySync: false,
            error: error.message
        };
    }
}

/**
 * Signal systemd to restart the service
 * @param {string} reason - Reason for restart (for logging)
 * @returns {boolean} True if restart signal was sent successfully
 */
function signalSystemdRestart(reason = 'Code or dependency changes detected') {
    try {
        logger.info(`${reason}. Signaling systemd for restart...`);
        
        // Exit with code 0 for normal restart
        // systemd will restart the service automatically
        setTimeout(() => {
            logger.info('Initiating graceful restart...');
            process.exit(0);
        }, 2000); // Give time for logging to complete
        
        return true;
    } catch (error) {
        logger.error('Error signaling systemd restart:', error.message);
        return false;
    }
}

module.exports = { performStartupGitPull, signalSystemdRestart };
