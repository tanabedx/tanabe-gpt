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
            // Combine the two log messages when no changes are detected
            logger.info(
                `Git pull completed: No changes detected. Current version: ${recentCommitInfo}`
            );
        } else {
            // Log the result of the pull
            logger.info('Git pull result:', output);

            // Get the new commit info after pull
            try {
                const newCommitInfo = execSync('git log -1 --pretty=format:"%h - %s (%cr)"')
                    .toString()
                    .trim();
                logger.info(`Update complete. New version: ${newCommitInfo}`);
            } catch (logError) {
                logger.info(
                    'Update complete. If critical files were changed, a manual restart might be needed if issues occur.'
                );
            }
        }
    } catch (error) {
        logger.error('Error performing git pull during startup:', error.message.split('\n')[0]);
        logger.warn(`Proceeding with current version due to git pull error.`);
        // Decide if you want to exit here or continue:
        // process.exit(1); // or throw error;
    }
}

module.exports = { performStartupGitPull };
