const axios = require('axios');
const logger = require('../utils/logger'); // Assuming logger is in utils
const NEWS_MONITOR_CONFIG = require('./newsMonitor.config');
const persistentCache = require('./persistentCache');

let apiKeyStates = {}; // Stores the live state of each API key
let currentKeyName = null;

const COOLDOWN_DURATION_MS = 16 * 60 * 1000; // 16 minutes

/**
 * Initializes the base structure for API key states from config and loads persisted states.
 */
function _initializeKeyObjects() {
    const keyConfigs = NEWS_MONITOR_CONFIG.CREDENTIALS.TWITTER_API_KEYS || {};
    const persistedStates = persistentCache.getTwitterApiStates() || {};

    apiKeyStates = {};
    for (const keyName in keyConfigs) {
        const keyConfig = keyConfigs[keyName];
        if (!keyConfig || !keyConfig.bearer_token) {
            logger.warn(`Twitter API key ${keyName} is missing or has no bearer_token. Skipping.`);
            continue;
        }

        // Load persisted state if available
        const persistedState = persistedStates[keyName] || {};

        apiKeyStates[keyName] = {
            name: keyName,
            bearer_token: keyConfig.bearer_token,
            usage: persistedState.usage || 0,
            limit: persistedState.limit || 100, // Default limit, will be updated from API
            capResetDay: persistedState.capResetDay || null,
            unifiedCooldownUntil: persistedState.unifiedCooldownUntil || null, // Single unified cooldown
            lastSuccessfulCheckTimestamp: persistedState.lastSuccessfulCheckTimestamp || null,
            status: persistedState.status || 'unchecked', // 'unchecked', 'ok', 'error', 'unified_api_cooldown'
        };
    }

    logger.debug(`Initialized ${Object.keys(apiKeyStates).length} Twitter API key states`, {
        keys: Object.keys(apiKeyStates),
        anyWithUnifiedCooldown: Object.values(apiKeyStates).some(k => k.unifiedCooldownUntil && k.unifiedCooldownUntil > Date.now())
    });
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

    if (keyState.unifiedCooldownUntil && Date.now() < keyState.unifiedCooldownUntil) {
        const minutesRemaining = Math.max(
            0,
            Math.round((keyState.unifiedCooldownUntil - Date.now()) / 60000)
        );
        logger.debug(
            `Key ${keyState.name} is on unified API cooldown for ${minutesRemaining} minute${
                minutesRemaining === 1 ? '' : 's'
            }. Skipping fetch.`
        );
        return {
            status: 'unified_api_cooldown',
            unifiedCooldownUntil: keyState.unifiedCooldownUntil,
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
                unifiedCooldownUntil: null,
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
            return { status: 'unified_api_cooldown', unifiedCooldownUntil: cooldownUntil };
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
                    unifiedCooldownUntil: null, // Clear unified API cooldown on success
                };
                const statesToPersist = {};
                for (const name in apiKeyStates) {
                    const key = apiKeyStates[name];
                    statesToPersist[name] = {
                        name: key.name,
                        usage: key.usage,
                        limit: key.limit,
                        capResetDay: key.capResetDay,
                        unifiedCooldownUntil: key.unifiedCooldownUntil,
                        lastSuccessfulCheckTimestamp: key.lastSuccessfulCheckTimestamp,
                        status: key.status,
                    };
                }
                persistentCache.saveTwitterApiKeyStates(statesToPersist);
            } else if (newUsageData.status === 'unified_api_cooldown') {
                apiKeyStates[keyName].status = 'unified_api_cooldown';
                apiKeyStates[keyName].unifiedCooldownUntil = newUsageData.unifiedCooldownUntil;
                const statesToPersist = {};
                for (const name in apiKeyStates) {
                    const key = apiKeyStates[name];
                    statesToPersist[name] = {
                        name: key.name,
                        usage: key.usage,
                        limit: key.limit,
                        capResetDay: key.capResetDay,
                        unifiedCooldownUntil: key.unifiedCooldownUntil,
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
                        unifiedCooldownUntil: key.unifiedCooldownUntil,
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
            unifiedCooldownUntil,
            lastSuccessfulCheckTimestamp,
        } = apiKeyStates[keyName];
        let logMsg = `Key ${keyName} state: Status=${status}, Usage=${usage}/${limit}`;
        if (capResetDay) logMsg += `, MonthlyResetDay=${capResetDay}`;
        if (unifiedCooldownUntil && unifiedCooldownUntil > Date.now()) {
            const minutesRemaining = Math.ceil((unifiedCooldownUntil - Date.now()) / 60000);
            logMsg += `, UnifiedAPIEndpointCooldown for ${minutesRemaining} minute${
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
                keyState.unifiedCooldownUntil && Date.now() < keyState.unifiedCooldownUntil;

            if (
                isError ||
                isMonthlyCapReached ||
                isUsageApiCoolingDown
            ) {
                // This key is not usable now. Log if it was unexpected for an 'ok' status.
                if (
                    keyState.status === 'ok' &&
                    isUsageApiCoolingDown
                ) {
                    logger.debug(
                        `Key ${name} (status 'ok') is on usage API cooldown until ${new Date(
                            keyState.unifiedCooldownUntil
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
            // Its status could be 'ok', 'unchecked', or a cooldown status ('unified_api_cooldown')
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
 * Perform a unified API session that calls both usage and content APIs together
 * This prevents individual API cooldowns from blocking the other API call
 * @param {string} keyName - The key to use for both API calls
 * @param {Function} usageCallback - Function that performs the usage API call
 * @param {Function} contentCallback - Function that performs the content API call
 * @returns {Promise<Object>} Results from both API calls
 */
async function performUnifiedApiSession(keyName, usageCallback, contentCallback) {
    if (!apiKeyStates[keyName]) {
        throw new Error(`Key ${keyName} not found for unified session`);
    }

    const keyState = apiKeyStates[keyName];
    
    logger.debug(`Starting unified API session for key: ${keyName}`);
    
    try {
        // Call both APIs simultaneously
        const [usageResult, contentResult] = await Promise.allSettled([
            usageCallback(),
            contentCallback()
        ]);
        
        // Check if either hit 429
        const usageHit429 = usageResult.status === 'rejected' && 
                           usageResult.reason?.response?.status === 429;
        const contentHit429 = contentResult.status === 'rejected' && 
                             contentResult.reason?.response?.status === 429;
        
        if (usageHit429 || contentHit429) {
            // Set unified cooldown if either API hits rate limit
            let cooldownUntil = Date.now() + COOLDOWN_DURATION_MS;
            
            // Use the longer cooldown if we have reset headers from either
            if (usageHit429 && usageResult.reason?.response?.headers?.['x-rate-limit-reset']) {
                const usageCooldown = parseInt(usageResult.reason.response.headers['x-rate-limit-reset']) * 1000;
                cooldownUntil = Math.max(cooldownUntil, usageCooldown);
            }
            if (contentHit429 && contentResult.reason?.response?.headers?.['x-rate-limit-reset']) {
                const contentCooldown = parseInt(contentResult.reason.response.headers['x-rate-limit-reset']) * 1000;
                cooldownUntil = Math.max(cooldownUntil, contentCooldown);
            }
            
            keyState.unifiedCooldownUntil = cooldownUntil;
            keyState.status = 'unified_api_cooldown';
            
            const minutesRemaining = Math.max(0, Math.round((cooldownUntil - Date.now()) / 60000));
            logger.debug(
                `Key ${keyName} hit 429 in unified session (usage: ${usageHit429}, content: ${contentHit429}). ` +
                `Unified cooldown for ${minutesRemaining} minute${minutesRemaining === 1 ? '' : 's'}.`
            );
            
            // Trigger key switching
            _selectActiveKey();
        } else {
            // Clear any existing unified cooldown on success
            if (keyState.unifiedCooldownUntil) {
                keyState.unifiedCooldownUntil = null;
                if (keyState.status === 'unified_api_cooldown') {
                    keyState.status = 'ok';
                }
            }
        }
        
        return { 
            usageResult, 
            contentResult,
            sessionSuccessful: !usageHit429 && !contentHit429,
            unifiedCooldownSet: usageHit429 || contentHit429
        };
        
    } catch (error) {
        logger.error(`Error in unified API session for key ${keyName}:`, error);
        throw error;
    } finally {
        // Persist state changes
        const statesToPersist = {};
        for (const name in apiKeyStates) {
            const key = apiKeyStates[name];
            statesToPersist[name] = {
                name: key.name,
                usage: key.usage,
                limit: key.limit,
                capResetDay: key.capResetDay,
                unifiedCooldownUntil: key.unifiedCooldownUntil,
                lastSuccessfulCheckTimestamp: key.lastSuccessfulCheckTimestamp,
                status: key.status,
            };
        }
        persistentCache.saveTwitterApiKeyStates(statesToPersist);
        
        logger.debug(`Unified API session completed for key: ${keyName}`);
    }
}

/**
 * Check usage and fetch content in a unified session
 * This is useful during initialization or when both operations are needed together
 * @param {Array} accountsToFetch - Array of account objects for content fetching
 * @returns {Promise<Object>} Results from both operations
 */
async function checkUsageAndFetchContent(accountsToFetch = []) {
    const currentKey = getCurrentKey();
    if (!currentKey) {
        throw new Error('No active API key available for unified session');
    }

    const keyName = currentKey.name;
    const bearerToken = currentKey.bearer_token;

    // Define usage check callback
    const usageCallback = async () => {
        const url = 'https://api.twitter.com/2/usage/tweets';
        return await axios.get(url, {
            headers: { Authorization: `Bearer ${bearerToken}` },
            params: { 'usage.fields': 'cap_reset_day,project_usage,project_cap' },
        });
    };

    // Define content fetch callback
    const contentCallback = async () => {
        if (!accountsToFetch || accountsToFetch.length === 0) {
            // Return a successful empty response if no accounts to fetch
            return { data: { data: [] } };
        }

        let url = `https://api.twitter.com/2/tweets/search/recent?query=`;
        const queryParts = accountsToFetch.map(account => {
            if (account.mediaOnly) {
                return `(from:${account.username} has:images -is:reply -is:retweet)`;
            } else {
                return `(from:${account.username} -is:reply -is:retweet)`;
            }
        });
        url += queryParts.join(' OR ');
        url += '&tweet.fields=created_at,attachments,text,id';
        url += '&media.fields=type,url,preview_image_url,media_key';
        url += '&user.fields=username';
        url += '&expansions=author_id,attachments.media_keys';
        url += '&max_results=10';

        return await axios.get(url, {
            headers: { Authorization: `Bearer ${bearerToken}` },
        });
    };

    // Perform unified session
    const sessionResult = await performUnifiedApiSession(keyName, usageCallback, contentCallback);
    
    // Process results
    let usageData = null;
    let contentData = null;
    let errors = [];

    // Process usage result
    if (sessionResult.usageResult.status === 'fulfilled') {
        const response = sessionResult.usageResult.value;
        if (response.data && response.data.data) {
            const rawUsageData = response.data.data;
            usageData = {
                usage: parseInt(rawUsageData.project_usage, 10),
                limit: parseInt(rawUsageData.project_cap, 10),
                capResetDay: rawUsageData.cap_reset_day,
            };
        }
    } else {
        errors.push(`Usage check failed: ${sessionResult.usageResult.reason?.message || 'Unknown error'}`);
    }

    // Process content result
    if (sessionResult.contentResult.status === 'fulfilled') {
        contentData = sessionResult.contentResult.value.data;
    } else {
        errors.push(`Content fetch failed: ${sessionResult.contentResult.reason?.message || 'Unknown error'}`);
    }

    return {
        sessionSuccessful: sessionResult.sessionSuccessful,
        unifiedCooldownSet: sessionResult.unifiedCooldownSet,
        usageData,
        contentData,
        errors,
        keyUsed: keyName
    };
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
    let hadToWaitForCooldowns = false;
    let maxCooldownEndTime = 0;
    for (const keyName in apiKeyStates) {
        const keyState = apiKeyStates[keyName];
        if (keyState.unifiedCooldownUntil && keyState.unifiedCooldownUntil > Date.now()) {
            maxCooldownEndTime = Math.max(maxCooldownEndTime, keyState.unifiedCooldownUntil);
        }
    }

    if (maxCooldownEndTime > Date.now()) {
        hadToWaitForCooldowns = true;
        const waitDurationMs = maxCooldownEndTime - Date.now() + 500; // +500ms buffer
        const waitMinutes = Math.ceil(waitDurationMs / 60000);
        logger.debug(
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
            // Use INFO level if we had to wait for cooldowns, DEBUG level otherwise
            const logLevel = hadToWaitForCooldowns ? 'info' : 'debug';
            logger[logLevel](
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
                !(s.unifiedCooldownUntil && Date.now() < s.unifiedCooldownUntil) &&
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
                    if (ks.unifiedCooldownUntil && ks.unifiedCooldownUntil > Date.now()) {
                        keySpecificNextTry = Math.min(keySpecificNextTry, ks.unifiedCooldownUntil);
                    }
                    if (keySpecificNextTry < earliestNextAvailability) {
                        earliestNextAvailability = keySpecificNextTry;
                    }
                });

                if (
                    earliestNextAvailability !== Infinity &&
                    earliestNextAvailability > Date.now()
                ) {
                    hadToWaitForCooldowns = true; // Mark that we had to wait for cooldowns
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
        apiKeyStates[keyNameUsed].status = 'unified_api_cooldown';
        apiKeyStates[keyNameUsed].unifiedCooldownUntil = cooldownUntil;
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
            unifiedCooldownUntil: key.unifiedCooldownUntil,
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

/**
 * Gets the status of all configured API keys for startup reporting.
 * @returns {Array} Array of API key status objects
 */
function getApiKeysStatus() {
    return Object.entries(apiKeyStates).map(([name, state]) => ({
        name: name,
        usage: `${state.usage || 0}/${state.limit || 100} (resets day ${state.capResetDay || 'unknown'})`,
        resetTime: state.capResetDay ? `day ${state.capResetDay}` : 'unknown',
        status: state.status || 'unchecked'
    }));
}

/**
 * Gets cooldown information for startup reporting.
 * @returns {Object|null} Cooldown info or null if not in cooldown
 */
function getCooldownInfo() {
    // Check if any keys have unified cooldown
    const keysInCooldown = Object.values(apiKeyStates).filter(state => 
        state.unifiedCooldownUntil && state.unifiedCooldownUntil > Date.now()
    );
    
    if (keysInCooldown.length > 0) {
        // Find the earliest cooldown end time
        const earliestCooldownEnd = Math.min(...keysInCooldown.map(state => state.unifiedCooldownUntil));
        const cooldownEndTime = new Date(earliestCooldownEnd);
        
        return {
            isInCooldown: true,
            cooldownUntil: cooldownEndTime.toLocaleTimeString('en-US', {
                hour: 'numeric',
                minute: '2-digit',
                hour12: true
            }),
            cooldownEndTimestamp: earliestCooldownEnd
        };
    }
    
    return null;
}

module.exports = {
    initialize,
    getCurrentKey,
    handleRequestOutcome,
    periodicCheck,
    performUnifiedApiSession,
    _getApiKeyStates: () => ({ ...apiKeyStates }), // For testing: return a copy
    _getCurrentKeyName: () => currentKeyName, // For testing
    checkUsageAndFetchContent,
    getApiKeysStatus,
    getCooldownInfo,
};
