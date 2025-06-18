const logger = require('./logger');
const { execSync } = require('child_process');

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
                commitInfo: recentCommitInfo
            };
        } else {
            // Log the result of the pull for debug purposes
            logger.debug('Git pull result:', output);

            // Get the new commit info after pull
            try {
                const newCommitInfo = execSync('git log -1 --pretty=format:"%h - %s (%cr)"')
                    .toString()
                    .trim();
                return {
                    hasChanges: true,
                    gitStatus: 'Updated successfully',
                    commitInfo: newCommitInfo
                };
            } catch (logError) {
                return {
                    hasChanges: true,
                    gitStatus: 'Updated (restart may be needed)',
                    commitInfo: recentCommitInfo
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
            commitInfo: 'Unknown'
        };
    }
}

module.exports = { performStartupGitPull };
