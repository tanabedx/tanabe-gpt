#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { execSync } = require('child_process');
const os = require('os');

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
});

// Root directory of the project
const rootDir = path.join(__dirname, '..');
const envFilePath = path.join(rootDir, 'configs', '.env');
const envExamplePath = path.join(rootDir, 'configs', '.env.example');

// Global variable to store user's choice for systemd setup
let userWantsSystemdSetup = false;

// Function to ensure the configs directory exists
function ensureConfigDir() {
    const configDir = path.join(rootDir, 'configs');
    if (!fs.existsSync(configDir)) {
        console.log('Creating configs directory...');
        fs.mkdirSync(configDir, { recursive: true });
    }
}

// Function to check if .env file already exists and handle it
function handleExistingEnvFile() {
    if (fs.existsSync(envFilePath)) {
        console.log('\n.env file already exists at:', envFilePath);
        return new Promise(resolve => {
            rl.question('Do you want to keep the existing file? (y/n): ', answer => {
                if (answer.toLowerCase() === 'y') {
                    console.log('Keeping existing .env file.');
                    resolve(true); // Skip creating new .env
                } else {
                    console.log('Backing up existing .env file...');
                    const backupPath = `${envFilePath}.backup.${Date.now()}`;
                    fs.copyFileSync(envFilePath, backupPath);
                    console.log(`Backup created at: ${backupPath}`);
                    resolve(false); // Proceed with new .env setup
                }
            });
        });
    }
    return Promise.resolve(false); // No existing file, proceed with setup
}

// Function to ask the user if they want to set up systemd service
async function askAboutSystemdServiceSetup() {
    if (process.platform !== 'linux') {
        console.log('\nSkipping systemd service setup option (not on Linux).');
        return Promise.resolve();
    }
    console.log('\n====== Optional: Systemd Service Configuration ======');
    return new Promise(resolve => {
        rl.question(
            'Do you want to set up Tanabe-GPT as a systemd service on this Linux machine? (Requires sudo privileges) (y/n): ',
            answer => {
                if (answer.toLowerCase() === 'y') {
                    userWantsSystemdSetup = true;
                    console.log(
                        'Systemd service setup will be attempted if you confirm and if this script is run with sudo privileges.'
                    );
                } else {
                    console.log('Skipping systemd service setup.');
                }
                resolve();
            }
        );
    });
}

// Function to perform the systemd service setup if requested
function performSystemdServiceSetup() {
    if (!userWantsSystemdSetup || process.platform !== 'linux') {
        if (userWantsSystemdSetup && process.platform !== 'linux') {
            console.log(
                '\nSystemd service setup was requested, but this is not a Linux system. Skipping.'
            );
        }
        return; // User opted out or not on Linux
    }

    console.log('\n====== Setting up Tanabe-GPT Systemd Service ======');

    let serviceFileContent;
    let currentUser;
    try {
        // Prefer the user who invoked sudo, otherwise get current user.
        // This ensures the service runs as the user who owns the files, not root.
        currentUser = process.env.SUDO_USER || os.userInfo().username;
        if (currentUser === 'root' && process.env.SUDO_USER) {
            console.log('Running with sudo, but SUDO_USER is not set. Using current user.');
        }
    } catch (err) {
        console.warn(
            `\nWARNING: Could not determine current user: ${err.message}. Defaulting to 'root' for systemd service user.`
        );
        currentUser = 'root';
    }

    try {
        const templateServiceFilePath = path.join(__dirname, 'tanabe-gpt.service');
        console.log(`Reading systemd service template from: ${templateServiceFilePath}`);
        if (!fs.existsSync(templateServiceFilePath)) {
            console.error(
                `\nERROR: Systemd service template file not found at ${templateServiceFilePath}`
            );
            return;
        }
        const templateContent = fs.readFileSync(templateServiceFilePath, 'utf8');

        // Replace placeholders for WorkingDirectory, User, and Group
        serviceFileContent = templateContent
            .replace('WorkingDirectory=[path]/tanabe-gpt', `WorkingDirectory=${rootDir}`)
            .replace('User=[user]', `User=${currentUser}`)
            .replace('Group=[group]', `Group=${currentUser}`);

        // Verify replacements to prevent accidental root usage
        if (templateContent.includes('User=[user]') && !serviceFileContent.includes(`User=${currentUser}`)) {
            throw new Error('Failed to replace User placeholder in systemd service file.');
        }
        if (templateContent.includes('Group=[group]') && !serviceFileContent.includes(`Group=${currentUser}`)) {
            throw new Error('Failed to replace Group placeholder in systemd service file.');
        }

    } catch (error) {
        console.error(
            `\nERROR: Failed to read or process the systemd service template file: ${error.message}`
        );
        console.error('Skipping systemd service setup.');
        return;
    }

    const serviceFilePath = '/etc/systemd/system/tanabe-gpt.service';

    try {
        if (process.getuid && process.getuid() !== 0) {
            console.warn(
                '\nWARNING: Systemd service setup requires this script to be run with root privileges (e.g., "sudo node services/setup.js").'
            );
            console.warn(`Attempting to write to ${serviceFilePath} and run systemctl commands.`);
            console.warn('This may fail or prompt for a password if not run with sudo.');
        }

        console.log(`Creating systemd service file at ${serviceFilePath}...`);
        fs.writeFileSync(serviceFilePath, serviceFileContent);
        console.log(`Successfully created ${serviceFilePath}.`);

        console.log('Reloading systemd daemon (sudo systemctl daemon-reload)...');
        execSync('sudo systemctl daemon-reload', { stdio: 'inherit' });

        console.log(
            'Enabling Tanabe-GPT service to start on boot (sudo systemctl enable tanabe-gpt.service)...'
        );
        execSync('sudo systemctl enable tanabe-gpt.service', { stdio: 'inherit' });

        console.log('Starting Tanabe-GPT service (sudo systemctl start tanabe-gpt.service)...');
        execSync('sudo systemctl start tanabe-gpt.service', { stdio: 'inherit' });

        console.log('-------------------------------------------------');
        console.log('Tanabe-GPT systemd service has been set up, enabled, and started.');
        console.log('');
        console.log('✅ AUTOMATIC RESTART BEHAVIOR:');
        console.log('   - Bot will automatically restart every 10 seconds if it exits');
        console.log('   - When code changes are detected, bot will restart to apply updates');
        console.log('   - Dependencies will be synchronized automatically on restart');
        console.log('   - No manual intervention required for deployments');
        console.log('');
        console.log('You can manage it using systemctl, e.g.:');
        console.log('  sudo systemctl status tanabe-gpt.service    # Check status');
        console.log('  sudo systemctl stop tanabe-gpt.service      # Stop service');
        console.log('  sudo systemctl restart tanabe-gpt.service   # Manual restart');
        console.log('  sudo systemctl logs -f tanabe-gpt.service   # View logs');
        console.log('  sudo journalctl -u tanabe-gpt.service -f    # View detailed logs');
        console.log('-------------------------------------------------');
    } catch (error) {
        console.error(`\nERROR: Failed to set up systemd service: ${error.message}`);
        console.error(
            'This usually happens if the script was not run with sudo privileges or if systemctl commands failed.'
        );
        console.error(
            'Please try running the setup again with "sudo ./services/setup.js" or "sudo node services/setup.js".'
        );
        console.log('\nIf you want to set it up manually on a Linux system:');
        console.log(`1. Create the file ${serviceFilePath} with the following content:`);
        console.log('------------------------');
        console.log(serviceFileContent);
        console.log('------------------------');
        console.log('2. Then run the following commands:');
        console.log('   sudo systemctl daemon-reload');
        console.log('   sudo systemctl enable tanabe-gpt.service');
        console.log('   sudo systemctl start tanabe-gpt.service');
        console.log('-------------------------------------------------');
    }
}

// Function to create .env file from user input
function createEnvFile() {
    console.log('\n====== Setting up .env file ======');
    console.log('Please paste your entire .env file content below.');
    console.log("If you don't have an .env file prepared, press Enter to use a template.");
    console.log('Press Ctrl+D (Unix) or Ctrl+Z then Enter (Windows) when finished pasting.');
    console.log('------------------------');

    let envContent = '';
    let isFirstLine = true;

    // Create a template in case the user doesn't have their own
    const envTemplate = `# Admin and Bot Numbers
ADMIN_NUMBER=your_admin_number
BOT_NUMBER=your_bot_number

# OpenAI API Keys
OPENAI_API_KEY=your_openai_api_key
GETIMG_AI_API_KEY=your_getimg_ai_key

# Twitter API Keys (Optional)
TWITTER_PRIMARY_BEARER_TOKEN=your_twitter_bearer_token
TWITTER_FALLBACK_BEARER_TOKEN=your_fallback_token
TWITTER_FALLBACK2_BEARER_TOKEN=your_second_fallback_token

# Group Names (for periodic summaries)
GROUP_LF=Group One Name
GROUP_AG=Another Group
GROUP_UN=Unique Name

# Special Messages
WIZARD_WELCOME_MESSAGE="Olá, Mamãe querida!\\n\\nPara configurar um novo grupo para fazer resumos, envie *#ferramentaresumo*.\\n\\nTe amo!"
`;

    return new Promise(resolve => {
        rl.on('line', line => {
            if (isFirstLine && line.trim() === '') {
                // User pressed Enter without pasting content, so use the template
                console.log('Using template .env file...');
                envContent = envTemplate;
                rl.close();
                return;
            }

            isFirstLine = false;
            envContent += line + '\n';
        });

        rl.on('close', () => {
            if (!envContent.trim()) {
                console.log('No input provided. Using template .env file...');
                envContent = envTemplate;
            }

            // Make sure content ends with a newline
            if (!envContent.endsWith('\n')) {
                envContent += '\n';
            }

            // Write the .env file
            fs.writeFileSync(envFilePath, envContent);
            console.log('------------------------');
            console.log(`.env file created successfully at: ${envFilePath}`);
            console.log(
                'IMPORTANT: If you used the template, edit the file with your actual API keys'
            );
            console.log('           before running the application.');
            resolve();
        });
    });
}

// Create .env.example if it doesn't exist
function createEnvExample() {
    if (!fs.existsSync(envExamplePath)) {
        console.log('Creating .env.example file...');
        const exampleContent = `# This is an example configuration file
# Copy this file to .env and edit with your actual values

# Admin and Bot Numbers
ADMIN_NUMBER=1234567890
BOT_NUMBER=1234567890

# OpenAI API Keys
OPENAI_API_KEY=sk-example12345
GETIMG_AI_API_KEY=key-example12345

# Twitter API Keys (Optional)
TWITTER_PRIMARY_BEARER_TOKEN=AAAAexample
TWITTER_FALLBACK_BEARER_TOKEN=AAAAexample
TWITTER_FALLBACK2_BEARER_TOKEN=AAAAexample

# Group Names
GROUP_LF=Group One Name
GROUP_AG=Another Group
GROUP_UN=Unique Name
`;
        fs.writeFileSync(envExamplePath, exampleContent);
    }
}

// Create the necessary directories
function createDirectories() {
    const dirs = [
        path.join(rootDir, 'wwebjs'),
    ];

    for (const dir of dirs) {
        if (!fs.existsSync(dir)) {
            console.log(`Creating directory: ${dir}`);
            fs.mkdirSync(dir, { recursive: true });
        }
    }
}

// Function to install Chromium and its dependencies on Linux
function installChromiumDependencies() {
    if (process.platform === 'linux') {
        console.log('\n====== Installing Chromium Dependencies (Linux) ======');
        try {
            console.log('Updating package list...');
            execSync('sudo apt-get update', { stdio: 'inherit' });
            console.log('Installing Chromium and dependencies...');
            execSync(
                'sudo apt-get install -y libx11-xcb1 libxcomposite1 libxcursor1 libxdamage1 libxi6 libxtst6 libnss3 libcups2 libxss1 libxrandr2 libasound2 libatk1.0-0 libatk-bridge2.0-0 libpangocairo-1.0-0 libgtk-3-0 libgbm1',
                { stdio: 'inherit' }
            );
            console.log('Chromium dependencies installation attempt finished.');
        } catch (error) {
            console.error('Failed to install Chromium dependencies:', error.message);
            console.log(
                'Please try installing them manually. For Debian/Ubuntu, you can try:\nsudo apt-get update && sudo apt-get install -y libx11-xcb1 libxcomposite1 libxcursor1 libxdamage1 libxi6 libxtst6 libnss3 libcups2 libxss1 libxrandr2 libasound2 libatk1.0-0 libatk-bridge2.0-0 libpangocairo-1.0-0 libgtk-3-0 libgbm1'
            );
        }
        console.log('-------------------------------------------------');
    } else {
        console.log('\nSkipping Chromium dependency installation (not on Linux).');
    }
}

// Main function
async function main() {
    console.log('====== Tanabe-GPT Setup ======');

    // Ensure configs directory exists
    ensureConfigDir();

    // Create necessary directories
    createDirectories();

    // Install Chromium dependencies if on Linux
    installChromiumDependencies();

    // Handle existing .env file
    const skipEnvSetup = await handleExistingEnvFile();

    // Ask about systemd service setup (before createEnvFile as it might close readline)
    await askAboutSystemdServiceSetup();

    // Create new .env file if needed
    if (!skipEnvSetup) {
        await createEnvFile();
    }

    // Only create .env.example if no .env file was created during this setup
    if (skipEnvSetup) {
    createEnvExample();
    }

    // Perform systemd service setup if requested (after all readline interactions)
    performSystemdServiceSetup();

    console.log('\n====== Setup Complete ======');
    console.log(
        'To start the application (if not using the systemd service and on Linux), run: npm start'
    );
    console.log('For development mode, run: npm run dev');

    rl.close();
}

// Run the main function
main().catch(err => {
    console.error('Error during setup:', err);
    process.exit(1);
});
