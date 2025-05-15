const axios = require('axios');
const logger = require('../utils/logger'); // Assuming logger is in utils
const NEWS_MONITOR_CONFIG = require('./newsMonitor.config');
const persistentCache = require('../utils/persistentCache');

const API_KEYS_CONFIG = NEWS_MONITOR_CONFIG.CREDENTIALS.TWITTER_API_KEYS;

let apiKeyStates = {}; // Stores the live state of each API key
let currentKeyName = null;
let lastFullCheckTimestamp = null; // Timestamp of the last successful full update of all keys from API

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
                usageApiCooldownUntil: pState.usageApiCooldownUntil || null,
                contentApiCooldownUntil: pState.contentApiCooldownUntil || null,
                lastSuccessfulCheckTimestamp: pState.lastSuccessfulCheckTimestamp || null,
                status: pState.status || 'unchecked', // 'ok', 'usage_api_cooldown', 'content_api_cooldown', 'cap_reached', 'error'
            };
        }
    });

    // Set initial currentKeyName to the first valid key found, if any
    const validKeyNames = Object.keys(apiKeyStates);
    if (validKeyNames.length > 0) {
        currentKeyName = validKeyNames[0];
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
 * @param {boolean} forceRemoteCheck - If true, fetches from API even if cache/cooldown allows skipping.
 */
async function _updateAllKeyStates(forceRemoteCheck = false) {
    // Skip full update if a recent one was done, unless forced.
    // The definition of "recent" for this top-level skip is less about individual key success cooldowns
    // and more about overall system load. Individual key cooldowns (incl. after success) are handled below.
    if (
        !forceRemoteCheck &&
        lastFullCheckTimestamp &&
        Date.now() - lastFullCheckTimestamp < COOLDOWN_DURATION_MS
    ) {
        logger.debug(
            'Skipping full Twitter API key state update (overall system). Recent check performed within 16 mins.'
        );
        _selectActiveKey(); // Still re-evaluate active key based on current states
        return false;
    }

    logger.debug('Attempting to update all Twitter API key states...');
    let anApiCallWasMadeAtAll = false; // Tracks if any API call was made in this cycle across all keys

    for (const keyName in apiKeyStates) {
        const currentKeyState = apiKeyStates[keyName];
        let newUsageData = {}; // To store results if _fetchKeyUsageFromApi is called
        let specificApiCallAttemptedForKey = false;

        const timeSinceLastSuccessMs = currentKeyState.lastSuccessfulCheckTimestamp
            ? Date.now() - currentKeyState.lastSuccessfulCheckTimestamp
            : Infinity;

        // Decision logic for fetching API data for this specific key
        if (timeSinceLastSuccessMs < COOLDOWN_DURATION_MS) {
            const minutesSince = Math.floor(timeSinceLastSuccessMs / 60000);
            const minutesRemaining = Math.ceil(
                (COOLDOWN_DURATION_MS - timeSinceLastSuccessMs) / 60000
            );
            logger.debug(
                `Key ${keyName}: Trusting recent successful check (last success ${minutesSince} minute${
                    minutesSince === 1 ? '' : 's'
                } ago). Will re-evaluate usage API in ~${minutesRemaining} minute${
                    minutesRemaining === 1 ? '' : 's'
                }.`
            );
            // If status was 'unchecked' but we have a lastSuccessfulCheckTimestamp, it implies it was 'ok' at that time.
            if (
                currentKeyState.status === 'unchecked' &&
                currentKeyState.lastSuccessfulCheckTimestamp
            ) {
                apiKeyStates[keyName].status = 'ok';
            }
            // No API fetch attempt for this key in this scenario.
        } else {
            // Eligible for API check: >16min since last success OR never successfully checked.
            // `_fetchKeyUsageFromApi` will internally check/respect `currentKeyState.usageApiCooldownUntil` (explicit 429 cooldown).
            logger.debug(
                `Key ${keyName}: Eligible for usage API check (last success >16m ago or never checked). Attempting fetch if not on explicit API cooldown.`
            );
            newUsageData = await _fetchKeyUsageFromApi(currentKeyState);
            specificApiCallAttemptedForKey = true;

            // Track if any API call was truly made (not skipped by _fetchKeyUsageFromApi's internal cooldown)
            if (newUsageData.status === 'ok' || newUsageData.status === 'error') {
                anApiCallWasMadeAtAll = true;
            }
        }

        // Update key state based on newUsageData (if any was populated, i.e., _fetchKeyUsageFromApi was called)
        if (Object.keys(newUsageData).length > 0) {
            if (newUsageData.status === 'ok') {
                apiKeyStates[keyName] = {
                    ...currentKeyState,
                    ...newUsageData, // includes usage, limit, capResetDay, status, lastSuccessfulCheckTimestamp
                    usageApiCooldownUntil: null, // Clear specific API cooldown on success
                };
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
            } else if (newUsageData.status === 'usage_api_cooldown') {
                apiKeyStates[keyName].status = 'usage_api_cooldown';
                apiKeyStates[keyName].usageApiCooldownUntil = newUsageData.usageApiCooldownUntil;
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
                persistentCache.saveTwitterApiKeyStates(statesToPersist); // Save cooldown state
            } else if (newUsageData.status === 'error') {
                apiKeyStates[keyName].status = 'error';
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
        }

        // Log current state after update attempt
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

    if (anApiCallWasMadeAtAll) lastFullCheckTimestamp = Date.now(); // Update timestamp for the overall system check cycle
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
            const isCoolingDownForUsageEndpoint =
                keyState.status === 'usage_api_cooldown' &&
                keyState.usageApiCooldownUntil &&
                Date.now() < keyState.usageApiCooldownUntil;
            const isCoolingDownFromContentFetch429 =
                keyState.status === 'content_api_cooldown' &&
                keyState.contentApiCooldownUntil &&
                Date.now() < keyState.contentApiCooldownUntil;
            const isMonthlyCapReached = keyState.usage >= keyState.limit;

            if (keyState.status === 'ok' && !isMonthlyCapReached) {
                newActiveKeyName = name;
                break;
            }
            // Fallback for keys that might have been in 'usage_api_cooldown' or 'content_api_cooldown' but cooldown expired, or 'unchecked'
            if (
                keyState.status !== 'error' &&
                !isMonthlyCapReached &&
                !isCoolingDownForUsageEndpoint &&
                !isCoolingDownFromContentFetch429
            ) {
                newActiveKeyName = name;
                break;
            }
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
            logger.debug(
                'No available Twitter API key found. All keys might be at limit, in error, or cooling down.'
            );
        }
        currentKeyName = null;
    }
    return currentKeyName;
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

    logger.debug('Initializing Twitter API handler by checking all key states...');
    let attempts = 0;
    const maxAttempts = retryConfig.maxAttempts;

    while (attempts < maxAttempts) {
        logger.debug(
            `Attempt ${attempts + 1}/${maxAttempts} to initialize Twitter keys and check usage.`
        );
        await _updateAllKeyStates(true); // Force remote check for all keys

        if (currentKeyName) {
            const activeKeyState = apiKeyStates[currentKeyName];
            const isMonthlyCapReached = activeKeyState.usage >= activeKeyState.limit;
            const isCoolingDown =
                activeKeyState.usageApiCooldownUntil &&
                Date.now() < activeKeyState.usageApiCooldownUntil;
            const isContentCoolingDown =
                activeKeyState.contentApiCooldownUntil &&
                Date.now() < activeKeyState.contentApiCooldownUntil;

            if (
                (activeKeyState.status === 'ok' || activeKeyState.status === 'unchecked') &&
                !isMonthlyCapReached &&
                !isCoolingDown &&
                !isContentCoolingDown
            ) {
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
                        return `${ks.name}: ${ks.usage}/${ks.limit} (resets ${resetDateStr})`;
                    })
                    .join(', ');
                logger.info(
                    `Twitter monitor initialized (${keyDetails}, using ${currentKeyName} key)`
                );
                return true;
            }
        }

        // Check if all keys are definitively at their monthly cap and not just temporarily cooling down
        const allTrulyCapped = Object.values(apiKeyStates).every(
            s =>
                s.usage >= s.limit &&
                s.status !== 'usage_api_cooldown' &&
                s.status !== 'content_api_cooldown'
        );
        if (allTrulyCapped) {
            logger.error(
                'All Twitter API keys appear to have reached their monthly usage cap. Cannot initialize further.'
            );
            return false;
        }

        attempts++;
        if (attempts < maxAttempts) {
            let delay = 5 * 60 * 1000; // Default 5 min if not dynamic or no cooldowns found
            if (retryConfig.dynamicDelayEnabled) {
                let earliestNextAvailability = Infinity;

                Object.values(apiKeyStates).forEach(ks => {
                    let keySpecificNextTry = Infinity;

                    // Factor 1: Explicit API usage cooldown
                    if (ks.usageApiCooldownUntil && ks.usageApiCooldownUntil > Date.now()) {
                        keySpecificNextTry = Math.min(keySpecificNextTry, ks.usageApiCooldownUntil);
                    }
                    // Factor 2: Explicit content API cooldown
                    if (ks.contentApiCooldownUntil && ks.contentApiCooldownUntil > Date.now()) {
                        keySpecificNextTry = Math.min(
                            keySpecificNextTry,
                            ks.contentApiCooldownUntil
                        );
                    }
                    // Factor 3: 16-min window after last successful check (user's dynamic cooldown)
                    if (ks.lastSuccessfulCheckTimestamp) {
                        const tryAfterSuccess =
                            ks.lastSuccessfulCheckTimestamp + COOLDOWN_DURATION_MS;
                        if (tryAfterSuccess > Date.now()) {
                            keySpecificNextTry = Math.min(keySpecificNextTry, tryAfterSuccess);
                        }
                    }
                    // Factor 4: Monthly cap reset (more complex, involves capResetDay - simplified for now to just consider other cooldowns)
                    // If a key is only limited by monthly cap and has no other cooldowns, earliestNextAvailability might remain Infinity
                    // or be very far in the future, which is handled by the default delay or overall attempt limits.

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
                        `All Twitter API keys over limit or cooling down. Waiting ~${minutesToAvailability} minute${
                            minutesToAvailability === 1 ? '' : 's'
                        } before retry...`
                    );
                } else {
                    // No specific future time found (e.g., all cooldowns passed, or all keys hard-capped without future reset time)
                    const defaultDelayMinutes = Math.round(delay / 60000);
                    logger.warn(
                        `All Twitter API keys unusable. Waiting ${defaultDelayMinutes} minute${
                            defaultDelayMinutes === 1 ? '' : 's'
                        } (default) before retry...`
                    );
                }
            }
            delay = Math.min(delay, 20 * 60 * 1000); // Cap delay at 20 mins
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
    await _updateAllKeyStates(true); // Force remote check for all keys
}

module.exports = {
    initialize,
    getCurrentKey,
    handleRequestOutcome,
    periodicCheck,
    _getApiKeyStates: () => ({ ...apiKeyStates }), // For testing: return a copy
    _getCurrentKeyName: () => currentKeyName, // For testing
};
