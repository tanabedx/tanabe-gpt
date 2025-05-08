const logger = require('./logger');
const { execSync } = require('child_process');

async function performStartupGitPull() {
    try {
        logger.info('Attempting to update bot via git pull...');

        // Log current commit
        try {
            const recentGitLogs = execSync('git log -1 --pretty=format:"%h - %s (%cr)"')
                .toString()
                .trim();
            logger.info('Latest commit before pull:', recentGitLogs);
        } catch (logError) {
            logger.debug(
                'Could not get latest commit info before pull:',
                logError.message.split('\n')[0]
            );
        }

        const output = execSync('git pull').toString().trim();
        if (
            output === '' ||
            output.includes('Already up to date') ||
            output.includes('Already up-to-date')
        ) {
            logger.info('Git pull completed: No changes detected or already up to date.');
        } else {
            logger.info('Git pull result:', output);
            logger.info(
                'Update complete. If critical files were changed, a manual restart might be needed if issues occur.'
            );
        }
    } catch (error) {
        logger.error('Error performing git pull during startup:', error.message.split('\n')[0]);
        logger.warn('Proceeding with current version due to git pull error.');
        // Decide if you want to exit here or continue:
        // process.exit(1); // or throw error;
    }
}

module.exports = { performStartupGitPull };
