module.exports = {
    apps: [
        {
            name: 'tanabe-gpt',
            script: 'index.js',
            instances: 1,
            exec_mode: 'fork',
            max_memory_restart: '350M',
            node_args: '--expose-gc --max-old-space-size=256',
            env: {
                NODE_ENV: 'production',
                // Disable debug logs in production to reduce I/O
                FORCE_DEBUG_LOGS: 'false',
                FORCE_PROMPT_LOGS: 'false',
            },
            exp_backoff_restart_delay: 100,
            watch: false,
            merge_logs: true,
            error_file: 'logs/pm2-error.log',
            out_file: 'logs/pm2-out.log',
            log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
            kill_timeout: 5000,
            // Restart app if it exceeds memory limits
            shutdown_with_message: true,
            listen_timeout: 8000,
            // Cron restart to prevent memory issues (restart daily at 3 AM)
            cron_restart: '0 3 * * *',
        },
    ],
};
