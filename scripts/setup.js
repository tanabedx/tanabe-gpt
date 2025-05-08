#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
});

// Root directory of the project
const rootDir = path.join(__dirname, '..');
const envFilePath = path.join(rootDir, 'configs', '.env');
const envExamplePath = path.join(rootDir, 'configs', '.env.example');

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

// Main function
async function main() {
    console.log('====== Tanabe-GPT Setup ======');

    // Ensure configs directory exists
    ensureConfigDir();

    // Create necessary directories
    createDirectories();

    // Handle existing .env file
    const skipEnvSetup = await handleExistingEnvFile();

    // Create new .env file if needed
    if (!skipEnvSetup) {
        await createEnvFile();
    }

    // Create .env.example
    createEnvExample();

    console.log('\n====== Setup Complete ======');
    console.log('To start the application, run: npm start');
    console.log('For development mode, run: npm run dev');

    rl.close();
}

// Run the main function
main().catch(err => {
    console.error('Error during setup:', err);
    process.exit(1);
});
