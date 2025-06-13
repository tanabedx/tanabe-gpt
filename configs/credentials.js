// credentials.js
require('dotenv').config({ path: './configs/.env' });

const CREDENTIALS = {
    ADMIN_NUMBER: process.env.ADMIN_NUMBER,
    BOT_NUMBER: process.env.BOT_NUMBER,
    ADMIN_WHATSAPP_ID: `${process.env.ADMIN_NUMBER}@c.us`,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    GETIMG_AI_API_KEY: process.env.GETIMG_AI_API_KEY,
    // Add group names and phone numbers
    GROUPS: {
        LF: process.env.GROUP_LF,
        AG: process.env.GROUP_AG,
    },
    PHONES: {
        DS1: process.env.PHONE_DS1,
        DS2: process.env.PHONE_DS2,
    },
    // Add member names - dynamically load all MEMBER_ environment variables
    get MEMBERS() {
        const members = {};

        // Get all environment variables that start with MEMBER_
        Object.keys(process.env).forEach(key => {
            if (key.startsWith('MEMBER_')) {
                // Extract the member identifier (e.g., 'LF1' from 'MEMBER_LF1')
                const memberId = key.substring(7); // Remove 'MEMBER_' prefix
                members[memberId] = process.env[key];
            }
        });

        return members;
    },
};

// Validate that all required environment variables are present
const validateCredentials = () => {
    const requiredVars = [
        'ADMIN_NUMBER',
        'BOT_NUMBER',
        'OPENAI_API_KEY',
        'GETIMG_AI_API_KEY',
        'GROUP_LF_PERSONALITY',
        'WIZARD_WELCOME_MESSAGE',
    ];

    const missingVars = requiredVars.filter(varName => !process.env[varName]);

    if (missingVars.length > 0) {
        throw new Error(`Missing required environment variables: ${missingVars.join(', ')}`);
    }
};

// Run validation on module import
validateCredentials();

module.exports = CREDENTIALS;
