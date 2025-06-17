// personalities.js
require('dotenv').config({ path: './configs/.env' });
const { getEnvWithEscapes } = require('../utils/envUtils');

// Get group names and personalities with proper escape sequence parsing
const GROUP_LF = process.env.GROUP_LF;
const GROUP_AG = process.env.GROUP_AG;
const LF_PERSONALITY = getEnvWithEscapes('GROUP_LF_PERSONALITY');
const AG_PERSONALITY = getEnvWithEscapes('GROUP_AG_PERSONALITY');

const GROUP_PERSONALITIES = {
    [GROUP_LF]: LF_PERSONALITY,
    [GROUP_AG]: AG_PERSONALITY
};

module.exports = GROUP_PERSONALITIES;
