const axios = require('axios');
const logger = require('../utils/logger'); // Assuming logger is in utils
const NEWS_MONITOR_CONFIG = require('./newsMonitor.config');
const persistentCache = require('../utils/persistentCache');

const API_KEYS_CONFIG = NEWS_MONITOR_CONFIG.CREDENTIALS.TWITTER_API_KEYS;

let apiKeyStates = {}; // Stores the live state of each API key
let currentKeyName = null;

const COOLDOWN_DURATION_MS = 16 * 60 * 1000; // 16 minutes

/**
 * Initializes the base structure for API key states from config and loads persisted states.
 */
function _initializeKeyObjects() {
    const configuredKeyNames = Object.keys(API_KEYS_CONFIG || {});
    const persistedStates = persistentCache.getTwitterApiStates() || {};

    apiKeyStates = {}; // Reset states before populating

    configuredKeyNames.forEach(name => {
        if (API_KEYS_CONFIG[name] && API_KEYS_CONFIG[name].bearer_token) {
            const pState = persistedStates[name] || {};
            apiKeyStates[name] = {
                name: name,
                bearer_token: API_KEYS_CONFIG[name].bearer_token,
                usage: pState.usage ? parseInt(pState.usage, 10) : 0,
                limit: pState.limit ? parseInt(pState.limit, 10) : 100, // Default, updated from API or cache
                capResetDay: pState.capResetDay || null,
                usageApiCooldownUntil: pState.usageApiCooldownUntil
                    ? parseInt(pState.usageApiCooldownUntil, 10)
                    : null,
                contentApiCooldownUntil: pState.contentApiCooldownUntil
                    ? parseInt(pState.contentApiCooldownUntil, 10)
                    : null,
                lastSuccessfulCheckTimestamp: pState.lastSuccessfulCheckTimestamp
                    ? parseInt(pState.lastSuccessfulCheckTimestamp, 10)
                    : null,
                status: pState.status || 'unchecked', // 'ok', 'usage_api_cooldown', 'content_api_cooldown', 'cap_reached', 'error'
            };
        }
    });

    // Set initial currentKeyName to the first valid key found, if any
    const validKeyNames = Object.keys(apiKeyStates);
    if (validKeyNames.length > 0) {
        currentKeyName = validKeyNames[0]; // This will be re-evaluated by _selectActiveKey later
    } else {
        currentKeyName = null;
    }
}

/**
 * Fetches monthly usage data for a single API key from Twitter.
 * @param {object} keyState - The current state object for the key.
 * @returns {Promise<object>} - Parsed usage data or error status.
 */
async function _fetchKeyUsageFromApi(keyState) {
    if (!keyState || !keyState.bearer_token) {
        return { status: 'error', error: 'Missing bearer token' };
    }

    if (keyState.usageApiCooldownUntil && Date.now() < keyState.usageApiCooldownUntil) {
        const minutesRemaining = Math.max(
            0,
            Math.round((keyState.usageApiCooldownUntil - Date.now()) / 60000)
        );
        logger.debug(
            `Key ${keyState.name} is on usage API cooldown for ${minutesRemaining} minute${
                minutesRemaining === 1 ? '' : 's'
            }. Skipping fetch.`
        );
        return {
            status: 'usage_api_cooldown',
            usageApiCooldownUntil: keyState.usageApiCooldownUntil,
        };
    }

    try {
        logger.debug(`Fetching Twitter API usage for key ${keyState.name}`);
        const url = 'https://api.twitter.com/2/usage/tweets';
        const response = await axios.get(url, {
            headers: { Authorization: `Bearer ${keyState.bearer_token}` },
            params: { 'usage.fields': 'cap_reset_day,project_usage,project_cap' },
        });

        if (response.data && response.data.data) {
            const usageData = response.data.data;
            logger.debug(
                `Successfully fetched usage for key ${keyState.name}: Usage=${usageData.project_usage}/${usageData.project_cap}, MonthlyResetDay=${usageData.cap_reset_day}`
            );
            return {
                usage: parseInt(usageData.project_usage, 10),
                limit: parseInt(usageData.project_cap, 10),
                capResetDay: usageData.cap_reset_day,
                status: 'ok',
                usageApiCooldownUntil: null,
                lastSuccessfulCheckTimestamp: Date.now(),
            };
        }
        logger.warn(
            `Invalid response format from Twitter API for key ${keyState.name}`,
            response.data
        );
        return { status: 'error', error: 'Invalid API response format' }; // Keep old usage data on error
    } catch (error) {
        if (error.response && error.response.status === 429) {
            const cooldownUntil = Date.now() + COOLDOWN_DURATION_MS;
            const minutesRemaining = Math.max(0, Math.round((cooldownUntil - Date.now()) / 60000));
            logger.debug(
                `Usage API for ${keyState.name} hit 429. Cooldown for ${minutesRemaining} minute${
                    minutesRemaining === 1 ? '' : 's'
                }.`
            );
            return { status: 'usage_api_cooldown', usageApiCooldownUntil: cooldownUntil };
        }
        logger.error(`Error fetching Twitter API usage for key ${keyState.name}: ${error.message}`);
        return { status: 'error', error: error.message }; // Keep old usage data on other errors
    }
}

/**
 * Updates the state of all configured API keys by fetching their current usage if needed.
 * No longer uses forceRemoteCheck; always attempts to update unless key is on specific usage API cooldown.
 */
async function _updateAllKeyStates() {
    logger.debug('Attempting to update all Twitter API key states by fetching usage...');
    let anApiCallWasMadeAtAll = false; // Tracks if any API call was made in this cycle across all keys

    for (const keyName in apiKeyStates) {
        const currentKeyState = apiKeyStates[keyName];
        let newUsageData = {}; // To store results if _fetchKeyUsageFromApi is called

        logger.debug(
            `Key ${keyName}: Attempting to fetch usage data (if not on explicit API cooldown).`
        );
        newUsageData = await _fetchKeyUsageFromApi(currentKeyState);

        if (newUsageData.status === 'ok' || newUsageData.status === 'error') {
            anApiCallWasMadeAtAll = true;
        }

        if (Object.keys(newUsageData).length > 0) {
            if (newUsageData.status === 'ok') {
                apiKeyStates[keyName] = {
                    ...currentKeyState,
                    ...newUsageData, // includes usage, limit, capResetDay, status, lastSuccessfulCheckTimestamp
                    usageApiCooldownUntil: null, // Clear specific API cooldown on success
                };
                const statesToPersist = {};
                for (const name in apiKeyStates) {
                    const key = apiKeyStates[name];
                    statesToPersist[name] = {
                        name: key.name,
                        usage: key.usage,
                        limit: key.limit,
                        capResetDay: key.capResetDay,
                        usageApiCooldownUntil: key.usageApiCooldownUntil,
                        contentApiCooldownUntil: key.contentApiCooldownUntil,
                        lastSuccessfulCheckTimestamp: key.lastSuccessfulCheckTimestamp,
                        status: key.status,
                    };
                }
                persistentCache.saveTwitterApiKeyStates(statesToPersist);
            } else if (newUsageData.status === 'usage_api_cooldown') {
                apiKeyStates[keyName].status = 'usage_api_cooldown';
                apiKeyStates[keyName].usageApiCooldownUntil = newUsageData.usageApiCooldownUntil;
                const statesToPersist = {};
                for (const name in apiKeyStates) {
                    const key = apiKeyStates[name];
                    statesToPersist[name] = {
                        name: key.name,
                        usage: key.usage,
                        limit: key.limit,
                        capResetDay: key.capResetDay,
                        usageApiCooldownUntil: key.usageApiCooldownUntil,
                        contentApiCooldownUntil: key.contentApiCooldownUntil,
                        lastSuccessfulCheckTimestamp: key.lastSuccessfulCheckTimestamp,
                        status: key.status,
                    };
                }
                persistentCache.saveTwitterApiKeyStates(statesToPersist); // Save cooldown state
            } else if (newUsageData.status === 'error') {
                apiKeyStates[keyName].status = 'error';
                const statesToPersist = {};
                for (const name in apiKeyStates) {
                    const key = apiKeyStates[name];
                    statesToPersist[name] = {
                        name: key.name,
                        usage: key.usage,
                        limit: key.limit,
                        capResetDay: key.capResetDay,
                        usageApiCooldownUntil: key.usageApiCooldownUntil,
                        contentApiCooldownUntil: key.contentApiCooldownUntil,
                        lastSuccessfulCheckTimestamp: key.lastSuccessfulCheckTimestamp,
                        status: key.status,
                    };
                }
                persistentCache.saveTwitterApiKeyStates(statesToPersist);
            }
        }

        const {
            status,
            usage,
            limit,
            capResetDay,
            usageApiCooldownUntil,
            contentApiCooldownUntil,
            lastSuccessfulCheckTimestamp,
        } = apiKeyStates[keyName];
        let logMsg = `Key ${keyName} state: Status=${status}, Usage=${usage}/${limit}`;
        if (capResetDay) logMsg += `, MonthlyResetDay=${capResetDay}`;
        if (usageApiCooldownUntil && usageApiCooldownUntil > Date.now()) {
            const minutesRemaining = Math.ceil((usageApiCooldownUntil - Date.now()) / 60000);
            logMsg += `, UsageAPIEndpointCooldown for ${minutesRemaining} minute${
                minutesRemaining === 1 ? '' : 's'
            }`;
        }
        if (contentApiCooldownUntil && contentApiCooldownUntil > Date.now()) {
            const minutesRemaining = Math.ceil((contentApiCooldownUntil - Date.now()) / 60000);
            logMsg += `, ContentAPIEndpointCooldown for ${minutesRemaining} minute${
                minutesRemaining === 1 ? '' : 's'
            }`;
        }
        if (lastSuccessfulCheckTimestamp) {
            logMsg += `, LastGoodCheck=${new Date(
                lastSuccessfulCheckTimestamp
            ).toLocaleTimeString()}`;
        }
        logger.debug(logMsg);
    }

    _selectActiveKey();
    logger.debug(
        `Finished updating Twitter API key states. Current active key: ${currentKeyName || 'None'}`
    );
    return anApiCallWasMadeAtAll; // Return whether any key attempted an API call in this cycle
}

/**
 * Selects the active API key based on current states and priority.
 */
function _selectActiveKey() {
    const keyPriority = Object.keys(apiKeyStates); // Dynamically get key names in configured order
    let newActiveKeyName = null;

    for (const name of keyPriority) {
        const keyState = apiKeyStates[name];
        if (keyState) {
            // Explicitly check all conditions that make a key unusable right now.
            const isError = keyState.status === 'error';
            const isMonthlyCapReached = keyState.usage >= keyState.limit;

            // Check for active usage API cooldown.
            const isUsageApiCoolingDown =
                keyState.usageApiCooldownUntil && Date.now() < keyState.usageApiCooldownUntil;

            // Check for active content API cooldown.
            const isContentApiCoolingDown =
                keyState.contentApiCooldownUntil && Date.now() < keyState.contentApiCooldownUntil;

            if (
                isError ||
                isMonthlyCapReached ||
                isUsageApiCoolingDown ||
                isContentApiCoolingDown
            ) {
                // This key is not usable now. Log if it was unexpected for an 'ok' status.
                if (
                    keyState.status === 'ok' &&
                    (isUsageApiCoolingDown || isContentApiCoolingDown)
                ) {
                    logger.debug(
                        `Key ${name} (status 'ok') is on ${
                            isUsageApiCoolingDown ? 'usage API cooldown' : 'content API cooldown'
                        } until ${new Date(
                            isUsageApiCoolingDown
                                ? keyState.usageApiCooldownUntil
                                : keyState.contentApiCooldownUntil
                        ).toLocaleTimeString()}. Skipping.`
                    );
                }
                // Log other reasons for skipping if needed for verbosity, or rely on periodic state logs.
                continue; // Try the next key
            }

            // If we are here, the key is:
            // - Not in 'error' state.
            // - Not at its monthly cap.
            // - Not on an active usage API cooldown.
            // - Not on an active content API cooldown.
            // Its status could be 'ok', 'unchecked', or a cooldown status ('usage_api_cooldown', 'content_api_cooldown')
            // where the actual cooldown period has expired.
            // Such a key is considered available.
            newActiveKeyName = name;
            break; // Found a suitable key
        }
    }

    if (newActiveKeyName) {
        if (currentKeyName !== newActiveKeyName) {
            logger.debug(
                `Switched Twitter API key from ${currentKeyName || 'None'} to ${newActiveKeyName}`
            );
            currentKeyName = newActiveKeyName;
        }
    } else {
        if (currentKeyName !== null) {
            // Only log if there was an active key before it became null
            logger.warn(
                // Changed from debug to warn for better visibility of this critical state
                'No available Twitter API key found. All keys might be at limit, in error, or cooling down.'
            );
        }
        currentKeyName = null;
    }
    return currentKeyName; // Return the updated currentKeyName (which might be null)
}

/**
 * Initializes the Twitter API handler.
 */
async function initialize(retryConfig = { maxAttempts: 3, dynamicDelayEnabled: true }) {
    _initializeKeyObjects(); // Load from config and potentially persistent cache

    if (Object.keys(apiKeyStates).length === 0) {
        logger.error('No Twitter API keys configured. Twitter functionality will be disabled.');
        return false;
    }

    // --- NEW: Initial dynamic wait based on cached cooldowns ---
    let maxCooldownEndTime = 0;
    for (const keyName in apiKeyStates) {
        const keyState = apiKeyStates[keyName];
        if (keyState.usageApiCooldownUntil && keyState.usageApiCooldownUntil > Date.now()) {
            maxCooldownEndTime = Math.max(maxCooldownEndTime, keyState.usageApiCooldownUntil);
        }
        if (keyState.contentApiCooldownUntil && keyState.contentApiCooldownUntil > Date.now()) {
            maxCooldownEndTime = Math.max(maxCooldownEndTime, keyState.contentApiCooldownUntil);
        }
    }

    if (maxCooldownEndTime > Date.now()) {
        const waitDurationMs = maxCooldownEndTime - Date.now() + 500; // +500ms buffer
        const waitMinutes = Math.ceil(waitDurationMs / 60000);
        logger.warn(
            `Keys on cooldown from cache. Waiting ~${waitMinutes} minute(s) (until ${new Date(
                maxCooldownEndTime
            ).toLocaleTimeString()}) before first state update attempt.`
        );
        await new Promise(resolve => setTimeout(resolve, waitDurationMs));
    }
    // --- END NEW ---

    logger.debug('Initializing Twitter API handler by checking all key states...');
    let attempts = 0;
    const maxAttempts = retryConfig.maxAttempts;

    while (attempts < maxAttempts) {
        logger.debug(
            `Attempt ${attempts + 1}/${maxAttempts} to initialize Twitter keys and check usage.`
        );
        // Force remote check for all keys AFTER the potential initial wait
        await _updateAllKeyStates();

        // currentKeyName is set by _selectActiveKey (called within _updateAllKeyStates)
        if (currentKeyName) {
            const activeKeyState = apiKeyStates[currentKeyName];
            // _selectActiveKey already ensures the key is not capped, not on cooldown, and not in error.
            // So, if currentKeyName is set, it implies a usable key was found according to _selectActiveKey logic.
            const keyDetails = Object.values(apiKeyStates)
                .map(ks => {
                    let resetDateStr = 'N/A';
                    if (ks.capResetDay) {
                        const now = new Date();
                        let resetYear = now.getFullYear();
                        let resetMonth = now.getMonth(); // 0-indexed
                        if (now.getDate() > ks.capResetDay) {
                            resetMonth += 1;
                            if (resetMonth > 11) {
                                resetMonth = 0;
                                resetYear += 1;
                            }
                        }
                        resetDateStr = `${resetMonth + 1}/${ks.capResetDay}/${String(
                            resetYear
                        ).slice(-2)}`;
                    }
                    return `${ks.name}: ${ks.usage}/${ks.limit} (resets ${resetDateStr}, status ${ks.status})`;
                })
                .join(', ');
            logger.info(
                `Twitter API Handler initialized successfully on attempt ${
                    attempts + 1
                }. Active key: ${currentKeyName}. All key states: [${keyDetails}]`
            );
            return true;
        }

        // If no currentKeyName, it means _selectActiveKey found no suitable key.
        // Proceed with retry logic.

        const allTrulyCappedAndNotCoolingDown = Object.values(apiKeyStates).every(
            s =>
                s.usage >= s.limit &&
                !(s.usageApiCooldownUntil && Date.now() < s.usageApiCooldownUntil) &&
                !(s.contentApiCooldownUntil && Date.now() < s.contentApiCooldownUntil) &&
                s.status !== 'error'
        );

        if (allTrulyCappedAndNotCoolingDown) {
            logger.error(
                'All Twitter API keys appear to have reached their monthly usage cap and are not on temporary cooldowns. Cannot initialize further after attempt ' +
                    (attempts + 1) +
                    '.'
            );
            return false;
        }

        attempts++;
        if (attempts < maxAttempts) {
            let delay = 5 * 60 * 1000; // Default 5 min
            if (retryConfig.dynamicDelayEnabled) {
                let earliestNextAvailability = Infinity;

                Object.values(apiKeyStates).forEach(ks => {
                    let keySpecificNextTry = Infinity;
                    if (ks.usageApiCooldownUntil && ks.usageApiCooldownUntil > Date.now()) {
                        keySpecificNextTry = Math.min(keySpecificNextTry, ks.usageApiCooldownUntil);
                    }
                    if (ks.contentApiCooldownUntil && ks.contentApiCooldownUntil > Date.now()) {
                        keySpecificNextTry = Math.min(
                            keySpecificNextTry,
                            ks.contentApiCooldownUntil
                        );
                    }
                    // During this initialize retry loop (after a full forced update), we only care about explicit API cooldowns.
                    if (keySpecificNextTry < earliestNextAvailability) {
                        earliestNextAvailability = keySpecificNextTry;
                    }
                });

                if (
                    earliestNextAvailability !== Infinity &&
                    earliestNextAvailability > Date.now()
                ) {
                    delay = Math.max(1000, earliestNextAvailability - Date.now() + 500); // Wait until available + 0.5s buffer
                    const minutesToAvailability = Math.ceil(
                        (earliestNextAvailability - Date.now()) / 60000
                    );
                    logger.warn(
                        `TwitterAPI Init Attempt ${attempts}/${maxAttempts}: All keys unusable. Waiting ~${minutesToAvailability} minute(s) (until ${new Date(
                            earliestNextAvailability
                        ).toLocaleTimeString()}) for API cooldowns before retry...`
                    );
                } else {
                    const defaultDelayMinutes = Math.round(delay / 60000);
                    logger.warn(
                        `TwitterAPI Init Attempt ${attempts}/${maxAttempts}: All keys unusable, no specific future API cooldown found. Waiting ${defaultDelayMinutes} minute(s) (default) before retry...`
                    );
                }
            }
            delay = Math.min(delay, 20 * 60 * 1000); // Cap delay at 20 mins
            logger.debug(`Waiting ${delay / 1000} seconds before next initialization attempt.`);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }

    logger.error(
        'Failed to initialize Twitter API handler after all attempts. No usable API key could be confirmed.'
    );
    return false;
}

/**
 * Gets the current active API key configuration.
 */
function getCurrentKey() {
    if (!currentKeyName || !apiKeyStates[currentKeyName]) {
        // Attempt to select a key if none is current, might happen if called before full init or after all keys became unusable
        _selectActiveKey();
        if (!currentKeyName || !apiKeyStates[currentKeyName]) {
            logger.debug('No active Twitter API key available even after re-selection attempt.');
            return null;
        }
    }
    return { ...apiKeyStates[currentKeyName] }; // Return a copy
}

/**
 * Handles the outcome of an actual content fetching API request (e.g., fetching tweets).
 * @param {string} keyNameUsed - The name of the key used for the request.
 * @param {Error | null} error - The error object if the request failed.
 */
async function handleRequestOutcome(keyNameUsed, error) {
    if (!apiKeyStates[keyNameUsed]) {
        logger.error(`handleRequestOutcome called for an unknown key: ${keyNameUsed}`);
        return;
    }

    if (error && error.response && error.response.status === 429) {
        // This 429 is from fetching content, likely the 15-requests-per-15-minutes window for that specific endpoint/key.
        // It's NOT the usage endpoint 429, and NOT necessarily the monthly cap.
        let cooldownUntil = Date.now() + COOLDOWN_DURATION_MS;
        if (error.response.headers && error.response.headers['x-rate-limit-reset']) {
            cooldownUntil = parseInt(error.response.headers['x-rate-limit-reset']) * 1000;
        }
        if (cooldownUntil) {
            const minutesRemaining = Math.max(0, Math.round((cooldownUntil - Date.now()) / 60000));
            logger.debug(
                `Key ${keyNameUsed} hit 429 (content fetch). Cooldown for ${minutesRemaining} minute${
                    minutesRemaining === 1 ? '' : 's'
                }.`
            );
        } else {
            logger.debug(`Key ${keyNameUsed} hit 429 (content fetch). Cooldown duration unknown.`);
        }
        apiKeyStates[keyNameUsed].status = 'content_api_cooldown';
        apiKeyStates[keyNameUsed].contentApiCooldownUntil = cooldownUntil;
        _selectActiveKey(); // Attempt to switch to another key
    } else if (error) {
        logger.error(
            `Request with key ${keyNameUsed} failed: ${error.message}. Marking status as error.`
        );
        apiKeyStates[keyNameUsed].status = 'error';
        _selectActiveKey(); // Attempt to switch
    }
    // On success, no immediate state change is needed here regarding usage caps;
    // periodicCheck will handle updating monthly usage from the usage endpoint.
    // PERSISTENCE CHANGE: Filter what to save
    const statesToPersist = {};
    for (const name in apiKeyStates) {
        const key = apiKeyStates[name];
        statesToPersist[name] = {
            name: key.name,
            usage: key.usage,
            limit: key.limit,
            capResetDay: key.capResetDay,
            usageApiCooldownUntil: key.usageApiCooldownUntil,
            contentApiCooldownUntil: key.contentApiCooldownUntil,
            lastSuccessfulCheckTimestamp: key.lastSuccessfulCheckTimestamp,
            status: key.status,
        };
    }
    persistentCache.saveTwitterApiKeyStates(statesToPersist);
}

/**
 * Periodically updates all key states. Intended for external scheduling.
 */
async function periodicCheck() {
    logger.debug('Performing periodic check of Twitter API key states...');
    await _updateAllKeyStates();
}

module.exports = {
    initialize,
    getCurrentKey,
    handleRequestOutcome,
    periodicCheck,
    _getApiKeyStates: () => ({ ...apiKeyStates }), // For testing: return a copy
    _getCurrentKeyName: () => currentKeyName, // For testing
};
