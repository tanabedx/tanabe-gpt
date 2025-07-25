// utils/envMapper.js
// Utility for mapping between environment variables and their values
require('dotenv').config({ path: './configs/.env' });
const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

/**
 * Dynamically loads all GROUP_* and PHONE_* mappings from environment variables.
 * @returns {{groups: Map<string, string>, phones: Map<string, string>, all: Map<string, string>}}
 *          An object containing maps for groups, phones, and all combined mappings.
 *          The maps store the mapping from the environment variable key to its value.
 */
function getMappings() {
    const mappings = {
        groups: new Map(),
        phones: new Map(),
        all: new Map(),
    };

    for (const key in process.env) {
        if (key.startsWith('GROUP_') || key.startsWith('PHONE_')) {
            const value = process.env[key];
            if (value) {
                mappings.all.set(key, value);
                if (key.startsWith('GROUP_')) {
                    mappings.groups.set(key, value);
                } else {
                    mappings.phones.set(key, value);
                }
            }
        }
    }
    return mappings;
}

/**
 * Get the actual group/phone name from its environment variable key
 * @param {string} envKey - The environment variable key (e.g., 'GROUP_LF')
 * @returns {string|null} - The actual group name or null if not found
 */
function getGroupName(envKey) {
    const { all } = getMappings();
    return all.get(envKey) || null;
}

/**
 * Get the environment variable key for a group/phone name
 * @param {string} groupName - The actual group name
 * @returns {string|null} - The environment variable key or null if not found
 */
function getGroupKey(groupName) {
    const { all } = getMappings();
    // Handle dm. prefix for groups
    const baseGroupName = groupName.startsWith('dm.') ? groupName.substring(3) : groupName;

    for (const [key, value] of all.entries()) {
        if (value === baseGroupName) {
            return key;
        }
    }
    return null;
}

/**
 * Add a new group mapping to the environment
 * @param {string} groupName - The actual group name
 * @param {string} abbreviation - The abbreviation to use (e.g., 'LF' for 'GROUP_LF')
 * @param {string} type - The type of group ('GROUP' or 'PHONE')
 * @returns {string} - The new environment variable key
 */
function addNewGroup(groupName, abbreviation, type = 'GROUP') {
    // Check if it's a direct message group
    let baseGroupName = groupName;
    if (groupName.startsWith('dm.')) {
        baseGroupName = groupName.substring(3);
    }

    // Check if group already exists
    if (getGroupKey(baseGroupName)) {
        return getGroupKey(baseGroupName);
    }

    // Create new key
    const newKey = `${type}_${abbreviation}`.toUpperCase();

    // No in-memory map to update, changes are reflected via getMappings()
    // which reads process.env directly.

    // Update .env file
    try {
        const envPath = path.resolve('./configs/.env');
        let envContent = fs.readFileSync(envPath, 'utf8');

        // Add new line if it doesn't end with a newline
        if (!envContent.endsWith('\n')) {
            envContent += '\n';
        }

        // Add new environment variable
        envContent += `${newKey}=${baseGroupName}\n`;

        // Write back to file
        fs.writeFileSync(envPath, envContent);

        // Update process.env
        process.env[newKey] = baseGroupName;

        logger.info(`Added new ${type} mapping: ${newKey}=${baseGroupName}`);
        return newKey;
    } catch (error) {
        logger.error(`Failed to update .env file: ${error.message}`);
        return null;
    }
}

/**
 * Remove a group and its related environment variables
 * @param {string} groupName - The name of the group to remove
 * @returns {boolean} - Whether the removal was successful
 */
function removeGroup(groupName) {
    try {
        // Handle dm. prefix
        let baseGroupName = groupName;
        if (groupName.startsWith('dm.')) {
            baseGroupName = groupName.substring(3);
        }

        // Get the environment variable key for the group
        const groupKey = getGroupKey(baseGroupName);
        if (!groupKey) {
            logger.warn(`Group ${baseGroupName} not found in environment variables`);
            return false;
        }

        // Get the abbreviation from the key (e.g., 'LF' from 'GROUP_LF')
        const abbreviation = groupKey.split('_')[1];

        // Find all related environment variables (group, members, etc.)
        const relatedKeys = [];

        // Add the group key itself
        relatedKeys.push(groupKey);

        // Add member keys (MEMBER_XX1, MEMBER_XX2, etc.)
        Object.keys(process.env).forEach(key => {
            if (key.startsWith(`MEMBER_${abbreviation}`)) {
                relatedKeys.push(key);
            }
        });

        // Add personality key if it exists
        if (process.env[`${groupKey}_PERSONALITY`]) {
            relatedKeys.push(`${groupKey}_PERSONALITY`);
        }

        // Update the .env file
        const envPath = path.resolve('./configs/.env');
        let envContent = fs.readFileSync(envPath, 'utf8');

        // Remove each related key from the .env file
        relatedKeys.forEach(key => {
            const regex = new RegExp(`^${key}=.*$\\n?`, 'm');
            envContent = envContent.replace(regex, '');

            // Also remove from process.env and our maps
            delete process.env[key];
        });

        // No in-memory maps to update

        // Write back to file
        fs.writeFileSync(envPath, envContent);

        logger.info(
            `Removed group ${baseGroupName} and ${relatedKeys.length} related environment variables`
        );

        return true;
    } catch (error) {
        logger.error(`Failed to remove group ${groupName}: ${error.message}`);
        return false;
    }
}

/**
 * Get all group names from a specific type
 * @param {string} type - The type prefix ('GROUP' or 'PHONE')
 * @returns {string[]} - Array of actual group names
 */
function getAllGroupsByType(type) {
    const { all } = getMappings();
    return Array.from(all.entries())
        .filter(([key]) => key.startsWith(`${type}_`))
        .map(([, value]) => value);
}

module.exports = {
    getGroupName,
    getGroupKey,
    addNewGroup,
    removeGroup,
    getAllGroupsByType,
};
