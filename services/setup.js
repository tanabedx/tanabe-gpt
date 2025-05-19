#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { execSync } = require('child_process');

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

    const templateServiceFilePath = path.join(__dirname, 'tanabe-gpt.service');
    let serviceFileContent;

    try {
        console.log(`Reading systemd service template from: ${templateServiceFilePath}`);
        if (!fs.existsSync(templateServiceFilePath)) {
            console.error(
                `\nERROR: Systemd service template file not found at ${templateServiceFilePath}`
            );
            console.error("Please ensure 'tanabe-gpt.service' exists in the 'services' directory.");
            console.error('Skipping systemd service setup.');
            return;
        }
        const templateContent = fs.readFileSync(templateServiceFilePath, 'utf8');
        serviceFileContent = templateContent.replace(
            'WorkingDirectory=[path]/tanabe-gpt',
            `WorkingDirectory=${rootDir}`
        );

        // Check if replacement was successful
        // It's important that the placeholder exactly matches 'WorkingDirectory=[path]/tanabe-gpt' in the template file.
        if (
            templateContent.includes('WorkingDirectory=[path]/tanabe-gpt') &&
            !serviceFileContent.includes(`WorkingDirectory=${rootDir}`)
        ) {
            // This case should ideally not happen if replace worked and rootDir is valid.
            // It implies the placeholder was found, but the resulting string doesn't contain the new working directory.
            // This could be due to an issue with rootDir, but we proceed with a warning.
            console.warn(
                `\nWARNING: Placeholder 'WorkingDirectory=[path]/tanabe-gpt' was found, but the WorkingDirectory might not have been updated correctly in the service file content for ${templateServiceFilePath}. Please verify the generated service file.`
            );
        } else if (!templateContent.includes('WorkingDirectory=[path]/tanabe-gpt')) {
            console.warn(
                `\nWARNING: Could not find exact placeholder 'WorkingDirectory=[path]/tanabe-gpt' in ${templateServiceFilePath}.`
            );
            console.warn(
                'The WorkingDirectory will NOT be dynamically set. The content of the template file will be used as is.'
            );
            console.warn(
                `Ensure that ${templateServiceFilePath} either has the correct WorkingDirectory hardcoded or contains the exact placeholder 'WorkingDirectory=[path]/tanabe-gpt' for dynamic replacement.`
            );
            serviceFileContent = templateContent; // Use template content as is if placeholder is missing
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
        console.log('You can manage it using systemctl, e.g.:');
        console.log('  sudo systemctl status tanabe-gpt.service');
        console.log('  sudo systemctl stop tanabe-gpt.service');
        console.log('  sudo systemctl restart tanabe-gpt.service');
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

# VPS Optimization Settings
OPTIMIZE_FOR_VPS=true
FORCE_DEBUG_LOGS=false
FORCE_PROMPT_LOGS=false
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

            // Add VPS optimization settings if not present
            if (!envContent.includes('OPTIMIZE_FOR_VPS')) {
                envContent += '\n# VPS Optimization Settings\n';
                envContent += 'OPTIMIZE_FOR_VPS=true\n';
                envContent += 'FORCE_DEBUG_LOGS=false\n';
                envContent += 'FORCE_PROMPT_LOGS=false\n';
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

# VPS Optimization Settings
OPTIMIZE_FOR_VPS=true
FORCE_DEBUG_LOGS=false
FORCE_PROMPT_LOGS=false
`;
        fs.writeFileSync(envExamplePath, exampleContent);
    }
}

// Create the necessary directories
function createDirectories() {
    const dirs = [
        path.join(rootDir, 'logs'),
        path.join(rootDir, 'history'),
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

    // Create .env.example
    createEnvExample();

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
