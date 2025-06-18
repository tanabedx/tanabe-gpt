const config = require('../../configs/config');
// NOTE: Configurations are saved to /configs/commandConfigs/periodicSummary.config.js
const { runCompletion } = require('../../utils/openaiUtils');
const { saveConfig } = require('./configUtils');
const logger = require('../../utils/logger');
const defaultPrompt = require('../periodicSummary.prompt').DEFAULT;
const groupManager = require('./groupManager');

// Lazy load nlpProcessor to avoid circular dependency
let nlpProcessor = null;
function getNlpProcessor() {
    if (!nlpProcessor) {
        nlpProcessor = require('../../core/nlpProcessor');
    }
    return nlpProcessor;
}

// Store user states
const userStates = new Map();

// Timer to check for expired sessions
let timeoutCheckInterval = null;

// Helper function to validate time format
function isValidTimeFormat(time) {
    const regex = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/;
    return regex.test(time);
}

// Helper function to validate interval
function isValidInterval(interval) {
    const num = parseInt(interval);
    return !isNaN(num) && num >= 1 && num <= 24;
}

// Helper function to sanitize prompt text
function sanitizePrompt(text) {
    return text
        .replace(/`/g, "'")
        .replace(/\\/g, '\\\\')
        .replace(/\$/g, '\\$')
        .replace(/"/g, '\\"')
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0)
        .map(line => `_${line}_`)
        .join('\n')
        .trim();
}

// Setup timeout checking interval
function setupTimeoutChecker() {
    // Clear any existing interval
    if (timeoutCheckInterval) {
        clearInterval(timeoutCheckInterval);
    }

    // Set up interval to check for expired sessions every minute
    timeoutCheckInterval = setInterval(async () => {
        const now = Date.now();
        const expiredSessions = [];

        // Check all active sessions
        for (const [stateKey, state] of userStates.entries()) {
            if (state.lastActivity && now - state.lastActivity > state.timeoutDuration) {
                // Session has expired, add to list
                const [userId, chatId] = stateKey.split('_');
                expiredSessions.push({ stateKey, userId, chatId, state });
            }
        }

        // Handle expired sessions
        for (const { stateKey, userId, chatId, state } of expiredSessions) {
            try {
                logger.debug('Automatic timeout detected for session', { userId, chatId, state });

                // Only notify if we have the client available
                if (global.client) {
                    try {
                        // Try to get chat and send timeout message
                        const chat = await global.client.getChatById(chatId);
                        await chat.sendMessage(config.COMMANDS.WIZARD.errorMessages.timeout);
                        logger.debug('Sent timeout notification to user', { userId, chatId });
                    } catch (error) {
                        logger.error('Failed to send timeout notification', {
                            userId,
                            chatId,
                            error,
                        });
                    }
                }

                // Remove the expired session from userStates
                userStates.delete(stateKey);

                // Deactivate wizard mode in NLP processor
                getNlpProcessor().setWizardState(userId, chatId, false);
            } catch (error) {
                logger.error('Error handling expired session', { userId, chatId, error });
            }
        }
    }, 60000); // Check every minute

    logger.debug('Wizard timeout checker initialized');
}

// Helper function to get state key based on user and chat
function getStateKey(userId, chatId) {
    return `${userId}_${chatId}`;
}

// Helper function to get user state
function getUserState(userId, chatId) {
    const stateKey = getStateKey(userId, chatId);
    return userStates.get(stateKey) || { state: 'INITIAL' };
}

// Helper function to set user state
function setUserState(userId, chatId, state, data = {}) {
    const stateKey = getStateKey(userId, chatId);
    logger.debug('Setting user state:', {
        userId,
        chatId,
        newState: state,
        oldState: userStates.get(stateKey)?.state,
        data,
    });

    // Set timeout based on state
    let timeoutDuration = config.COMMANDS.WIZARD.wizardTimeout || 300000; // 5 minutes default

    // Activate wizard mode in NLP processor with chat context
    getNlpProcessor().setWizardState(userId, chatId, true);

    userStates.set(stateKey, {
        state,
        ...data,
        lastActivity: Date.now(),
        timeoutDuration: timeoutDuration,
    });
}

// Helper function to clear user state
function clearUserState(userId, chatId, success = false, message = null) {
    const stateKey = getStateKey(userId, chatId);

    // Deactivate wizard mode in NLP processor with chat context
    getNlpProcessor().setWizardState(userId, chatId, false);

    // Clear existing state
    if (userStates.has(stateKey)) {
        userStates.delete(stateKey);
        logger.debug('Wizard state cleared for user', { userId, chatId, success });

        if (message && success) {
            message.reply('Configuração concluída com sucesso!');
        } else if (message) {
            message.reply('❌ Configuração cancelada.');
        }
    }
}

// Helper function to check if wizard is active for a chat
function isWizardActive(userId, chatId) {
    const stateKey = getStateKey(userId, chatId);
    return userStates.has(stateKey);
}

// Helper function to format group configuration for display
function formatGroupConfig(groupName, groupConfig) {
    const defaults = config.PERIODIC_SUMMARY.defaults;

    const formatDeleteAfter = minutes => {
        if (minutes === undefined || minutes === null) return 'Não (padrão)';
        return `${minutes}m`;
    };

    const formatInterval = hours => {
        if (hours === undefined) return `${defaults.intervalHours}h (padrão)`;
        return `${hours}h`;
    };

    const formatQuietTime = quietTime => {
        if (!quietTime || (!quietTime.start && !quietTime.end)) {
            return `${defaults.quietTime.start} às ${defaults.quietTime.end} (padrão)`;
        }
        return `${quietTime.start} às ${quietTime.end}`;
    };

    // Format the prompt with italics for each line
    const promptToShow = groupConfig.prompt
        ? groupConfig.prompt
              .split('\n')
              .map(line => line.trim())
              .filter(line => line.length > 0)
              .map(line => (line.startsWith('_') ? line : `_${line}_`))
              .join('\n')
        : defaultPrompt
              .split('\n')
              .map(line => line.trim())
              .filter(line => line.length > 0)
              .map(line => (line.startsWith('_') ? line : `_${line}_`))
              .join('\n');
    const promptLabel = groupConfig.prompt ? '' : ' (padrão)';

    return (
        `*Configuração atual do grupo "${groupName}":*\n\n` +
        `1️⃣ Ativado: ${groupConfig.enabled === false ? '❌' : '✅'}\n` +
        `2️⃣ Intervalo: ${formatInterval(groupConfig.intervalHours)}\n` +
        `3️⃣ Horário silencioso: ${formatQuietTime(groupConfig.quietTime)}\n` +
        `4️⃣ Exclusão automática: ${formatDeleteAfter(groupConfig.deleteAfter)}\n` +
        `5️⃣ Prompt${promptLabel}:\n` +
        `${promptToShow}\n\n` +
        `6️⃣ Excluir grupo\n\n` +
        `Digite o número da opção que deseja alterar, "voltar" para retornar ou "cancelar" para sair.`
    );
}

// Helper function to list configured groups
function getConfiguredGroups() {
    if (!config.PERIODIC_SUMMARY.groups) return [];
    return Object.entries(config.PERIODIC_SUMMARY.groups).map(([name, config], index) => ({
        name,
        config,
        index: index + 1,
    }));
}

// Main handler function for wizard steps
async function processWizardStep(message) {
    // Get proper chat and contact objects first
    const chat = await message.getChat();
    const contact = await message.getContact();
    
    // Extract IDs correctly
    const userId = contact.id._serialized;
    const chatId = chat.id._serialized;
    
    const userState = getUserState(userId, chatId);
    const messageText = message.body.trim().toLowerCase();

    logger.debug('Wizard called with state:', {
        userId,
        chatId,
        currentState: userState.state,
        messageText,
        fullState: userState,
    });

    // Check for timeout
    const now = Date.now();
    const timeoutDuration =
        userState.timeoutDuration || config.COMMANDS.WIZARD.wizardTimeout;
    if (userState.lastActivity && now - userState.lastActivity > timeoutDuration) {
        logger.debug('Session timeout detected');
        await message.reply(config.COMMANDS.WIZARD.errorMessages.timeout);
        clearUserState(userId, chatId);
        return;
    }

    // Handle cancel option at any point
    if (['cancelar', 'cancel'].includes(messageText)) {
        logger.debug('Cancel command received');
        clearUserState(userId, chatId);
        await message.reply('❌ Configuração cancelada.');
        return;
    }

    // Handle back option
    if (['voltar', 'back'].includes(messageText)) {
        logger.debug('Back command received, current state:', userState.state);

        // Reset timeout to the longer duration when going back
        const resetTimeout = {
            timeoutDuration: config.COMMANDS.WIZARD.wizardTimeout,
        };

        switch (userState.state) {
            case 'AWAITING_GROUP_SELECTION':
                // Already at initial state, just resend the menu
                setUserState(userId, chatId, 'INITIAL', resetTimeout);
                await processWizardStep(message);
                return;
            case 'AWAITING_EDIT_OPTION':
                setUserState(userId, chatId, 'INITIAL', resetTimeout);
                await processWizardStep(message);
                return;
            case 'AWAITING_INTERVAL':
                if (userState.selectedGroup) {
                    setUserState(userId, chatId, 'AWAITING_EDIT_OPTION', {
                        selectedGroup: userState.selectedGroup,
                        config: userState.config,
                        ...resetTimeout,
                    });
                } else {
                    setUserState(userId, chatId, 'INITIAL', resetTimeout);
                }
                await processWizardStep(message);
                return;
            case 'AWAITING_QUIET_START':
                setUserState(
                    userId,
                    chatId,
                    userState.selectedGroup ? 'AWAITING_EDIT_OPTION' : 'AWAITING_INTERVAL',
                    userState
                );
                await processWizardStep(message);
                return;
            case 'AWAITING_QUIET_END':
                setUserState(userId, chatId, 'AWAITING_QUIET_START', userState);
                await processWizardStep(message);
                return;
            case 'AWAITING_AUTO_DELETE_CHOICE':
                setUserState(userId, chatId, 'AWAITING_QUIET_END', userState);
                await processWizardStep(message);
                return;
            case 'AWAITING_AUTO_DELETE_TIME':
                setUserState(userId, chatId, 'AWAITING_AUTO_DELETE_CHOICE', userState);
                await processWizardStep(message);
                return;
            case 'AWAITING_GROUP_INFO':
                setUserState(userId, chatId, 'AWAITING_AUTO_DELETE_TIME', userState);
                await processWizardStep(message);
                return;
            case 'AWAITING_PROMPT_APPROVAL':
                setUserState(userId, chatId, 'AWAITING_GROUP_INFO', userState);
                await processWizardStep(message);
                return;
            case 'AWAITING_CUSTOM_PROMPT':
                setUserState(userId, chatId, 'AWAITING_PROMPT_APPROVAL', userState);
                await processWizardStep(message);
                return;
        }
    }

    try {
        switch (userState.state) {
            case 'INITIAL':
                const groups = getConfiguredGroups();
                let response = '*Grupos Configurados:*\n\n';

                if (groups.length > 0) {
                    groups.forEach(({ name, config: groupConfig, index }) => {
                        response += `${index}. ${name} ${
                            groupConfig.enabled === false ? '❌' : '✅'
                        }\n`;
                    });
                    response +=
                        '\nDigite o número do grupo para editar ou digite o nome *exato* de um novo grupo para criar (respeitando maiúsculas/minúsculas).\n\n' +
                        'Digite "cancelar" para sair.';
                } else {
                    response +=
                        'Nenhum grupo configurado.\n\n' +
                        'Digite o nome *exato* do grupo que deseja configurar (respeitando maiúsculas/minúsculas).\n\n' +
                        'Digite "cancelar" para sair.';
                }

                await message.reply(response);
                setUserState(userId, chatId, 'AWAITING_GROUP_SELECTION');
                break;

            case 'AWAITING_GROUP_SELECTION':
                const groups2 = getConfiguredGroups();
                const groupIndex = parseInt(messageText) - 1;

                // Check if input is a number and matches an existing group
                if (!isNaN(groupIndex) && groupIndex >= 0 && groupIndex < groups2.length) {
                    const selectedGroup = groups2[groupIndex];
                    const groupConfig = selectedGroup.config;

                    await message.reply(formatGroupConfig(selectedGroup.name, groupConfig));
                    setUserState(userId, chatId, 'AWAITING_EDIT_OPTION', {
                        selectedGroup: selectedGroup.name,
                        config: groupConfig,
                    });
                } else {
                    // Treat as new group name
                    const messageTextOriginal = message.body.trim(); // Use original case

                    // Show default config and ask if user wants to use it
                    const defaultConfig = config.PERIODIC_SUMMARY.defaults;
                    const defaultConfigText =
                        `*Configurações Padrão:*\n` +
                        `• Intervalo: ${defaultConfig.intervalHours} horas\n` +
                        `• Horário Silencioso: ${defaultConfig.quietTime.start} - ${defaultConfig.quietTime.end}\n` +
                        `• Exclusão automática: ${
                            defaultConfig.deleteAfter ? defaultConfig.deleteAfter + 'm' : 'Não'
                        }\n` +
                        `• Prompt:\n${defaultPrompt.trim()}\n\n` +
                        `Deseja usar as configurações padrão?\n` +
                        `1️⃣ Sim, usar configurações padrão.\n` +
                        `2️⃣ Não, fazer configuração personalizada.\n\n` +
                        `Digite "voltar" para retornar ou "cancelar" para sair.`;

                    await message.reply(defaultConfigText);
                    setUserState(userId, chatId, 'AWAITING_CONFIG_CHOICE', {
                        groupName: messageTextOriginal,
                        config: {},
                    });
                }
                break;

            case 'AWAITING_CONFIG_CHOICE':
                switch (messageText) {
                    case '1': // Use default config
                        const groupConfig = {
                            enabled: true,
                            quietTime: {
                                start: config.PERIODIC_SUMMARY.defaults.quietTime.start,
                                end: config.PERIODIC_SUMMARY.defaults.quietTime.end,
                            },
                            intervalHours: config.PERIODIC_SUMMARY.defaults.intervalHours,
                            deleteAfter: config.PERIODIC_SUMMARY.defaults.deleteAfter,
                        };

                        // Save config
                        config.PERIODIC_SUMMARY.groups[userState.groupName] = groupConfig;
                        await saveConfig();

                        // Display config
                        await message.reply(
                            `Grupo "${userState.groupName}" configurado com sucesso usando as configurações padrão!\n\n` +
                                `${formatGroupConfig(userState.groupName, groupConfig)}`
                        );
                        // Automatically quit the wizard after successful configuration
                        clearUserState(userId, chatId, true, message);
                        return;

                    case '2': // Custom config
                        await message.reply(
                            'Digite o intervalo em horas entre os resumos (1-24):\n\n' +
                                'Digite "voltar" para retornar ou "cancelar" para sair.'
                        );
                        setUserState(userId, chatId, 'AWAITING_INTERVAL', {
                            groupName: userState.groupName,
                            config: {
                                enabled: true,
                                quietTime: {
                                    start: config.PERIODIC_SUMMARY.defaults.quietTime.start,
                                    end: config.PERIODIC_SUMMARY.defaults.quietTime.end,
                                },
                                deleteAfter: config.PERIODIC_SUMMARY.defaults.deleteAfter,
                            },
                        });
                        return;

                    default:
                        await message.reply(
                            '❌ Opção inválida. Digite 1️⃣ para usar configurações padrão ou 2️⃣ para configuração personalizada.'
                        );
                        return;
                }

            case 'AWAITING_EDIT_OPTION':
                const option = parseInt(messageText);
                const currentConfig = userState.config || {};

                switch (option) {
                    case 1: // Toggle enable/disable
                        const updatedConfig = {
                            ...currentConfig,
                            enabled: !currentConfig.enabled,
                            intervalHours:
                                currentConfig.intervalHours ||
                                config.PERIODIC_SUMMARY.defaults.intervalHours,
                            quietTime:
                                currentConfig.quietTime ||
                                config.PERIODIC_SUMMARY.defaults.quietTime,
                            deleteAfter:
                                currentConfig.deleteAfter ??
                                config.PERIODIC_SUMMARY.defaults.deleteAfter,
                        };
                        // If there's a custom prompt, keep it
                        if (currentConfig.prompt) {
                            updatedConfig.prompt = currentConfig.prompt;
                        }

                        config.PERIODIC_SUMMARY.groups[userState.selectedGroup] = updatedConfig;
                        await saveConfig();
                        await message.reply(
                            `Grupo "${userState.selectedGroup}" ${
                                updatedConfig.enabled ? 'ativado' : 'desativado'
                            } com sucesso!\n\n` +
                                `${formatGroupConfig(userState.selectedGroup, updatedConfig)}`
                        );

                        // Automatically quit when toggling group status
                        clearUserState(userId, chatId, true, message);
                        break;

                    case 2: // Change interval
                        await message.reply(
                            'Digite o novo intervalo em horas (1-24):\n\n' +
                                'Digite "voltar" para retornar ou "cancelar" para sair.'
                        );
                        setUserState(userId, chatId, 'AWAITING_INTERVAL', {
                            selectedGroup: userState.selectedGroup,
                            config: currentConfig,
                        });
                        break;

                    case 3: // Change quiet time
                        await message.reply(
                            'Digite o horário de início do período silencioso (formato HH:MM, exemplo: 21:00):\n\n' +
                                'Digite "voltar" para retornar ou "cancelar" para sair.'
                        );
                        setUserState(userId, chatId, 'AWAITING_QUIET_START', {
                            selectedGroup: userState.selectedGroup,
                            config: currentConfig,
                        });
                        break;

                    case 4: // Change auto-delete
                        await message.reply(
                            'Deseja que os resumos sejam excluídos automaticamente?\n\n' +
                                '1️⃣ Sim\n' +
                                '2️⃣ Não\n\n' +
                                'Digite "voltar" para retornar ou "cancelar" para sair.'
                        );
                        setUserState(userId, chatId, 'AWAITING_AUTO_DELETE_CHOICE', {
                            selectedGroup: userState.selectedGroup,
                            config: currentConfig,
                        });
                        break;

                    case 5: // Change prompt
                        await message.reply(
                            'Descreva o objetivo e contexto do grupo para que eu possa gerar um novo prompt:\n\n' +
                                'Digite "voltar" para retornar ou "cancelar" para sair.'
                        );
                        setUserState(userId, chatId, 'AWAITING_GROUP_INFO', {
                            selectedGroup: userState.selectedGroup,
                            config: currentConfig,
                        });
                        break;

                    case 6: // Delete group
                        // Use the group manager to remove the group
                        const result = groupManager.removeGroup(userState.selectedGroup);

                        if (result.success) {
                            await saveConfig();
                            await message.reply(
                                `Grupo "${userState.selectedGroup}" removido com sucesso!`
                            );
                        } else {
                            await message.reply(`❌ Erro ao remover o grupo: ${result.message}`);
                        }

                        // Automatically quit when deleting a group
                        clearUserState(userId, chatId, true, message);
                        break;

                    default:
                        await message.reply(
                            '❌ Opção inválida. Digite um número de 1️⃣ a 6️⃣, "voltar" para retornar, ou "cancelar" para sair.'
                        );
                        break;
                }
                break;

            case 'AWAITING_INTERVAL':
                if (!isValidInterval(messageText)) {
                    await message.reply('❌ Intervalo inválido. Digite um número entre 1 e 24.');
                    return;
                }

                const interval = parseInt(messageText);

                if (userState.selectedGroup) {
                    config.PERIODIC_SUMMARY.groups[userState.selectedGroup] = {
                        ...userState.config,
                        intervalHours: interval,
                    };
                    await saveConfig();
                    await message.reply(
                        `Intervalo atualizado com sucesso!\n\n` +
                            `${formatGroupConfig(
                                userState.selectedGroup,
                                config.PERIODIC_SUMMARY.groups[userState.selectedGroup]
                            )}`
                    );

                    // Automatically quit when editing an existing group setting
                    clearUserState(userId, chatId, true, message);
                    return;
                }

                // For new group setup, continue with the flow
                await message.reply(
                    'Digite o horário de início do período silencioso (formato HH:MM, exemplo: 21:00):\n\n' +
                        'Digite "voltar" para retornar ou "cancelar" para sair.'
                );
                setUserState(userId, chatId, 'AWAITING_QUIET_START', {
                    groupName: userState.groupName,
                    config: {
                        ...userState.config,
                        intervalHours: interval,
                    },
                });
                break;

            case 'AWAITING_QUIET_START':
                if (!isValidTimeFormat(messageText)) {
                    await message.reply(
                        '❌ Formato de horário inválido. Use o formato HH:MM (exemplo: 09:00).'
                    );
                    return;
                }

                // If we're editing an existing group
                if (userState.selectedGroup) {
                    const updatedConfig = {
                        ...userState.config,
                        quietTime: {
                            ...userState.config.quietTime,
                            start: messageText,
                        },
                    };
                    await message.reply(
                        'Digite o horário de término do período silencioso (exemplo: 09:00):\n\nDigite "voltar" para retornar ou "cancelar" para sair.'
                    );
                    setUserState(userId, chatId, 'AWAITING_QUIET_END', {
                        selectedGroup: userState.selectedGroup,
                        config: updatedConfig,
                    });
                    return;
                }

                // For new group setup
                setUserState(userId, chatId, 'AWAITING_QUIET_END', {
                    groupName: userState.groupName,
                    config: {
                        ...userState.config,
                        quietTime: {
                            start: messageText,
                        },
                    },
                });
                await message.reply(
                    'Digite o horário de término do período silencioso (exemplo: 09:00):\n\nDigite "voltar" para retornar ou "cancelar" para sair.'
                );
                break;

            case 'AWAITING_QUIET_END':
                if (!isValidTimeFormat(messageText)) {
                    await message.reply(
                        '❌ Formato de horário inválido. Use o formato HH:MM (exemplo: 09:00).'
                    );
                    return;
                }

                // If we're editing an existing group
                if (userState.selectedGroup) {
                    const updatedConfig = {
                        ...userState.config,
                        quietTime: {
                            ...userState.config.quietTime,
                            end: messageText,
                        },
                    };
                    config.PERIODIC_SUMMARY.groups[userState.selectedGroup] = updatedConfig;
                    await saveConfig();
                    await message.reply(
                        `Horário silencioso atualizado com sucesso!\n\n` +
                            `${formatGroupConfig(userState.selectedGroup, updatedConfig)}`
                    );

                    // Automatically quit when editing an existing group setting
                    clearUserState(userId, chatId, true, message);
                    return;
                }

                // For new group setup
                setUserState(userId, chatId, 'AWAITING_AUTO_DELETE_CHOICE', {
                    groupName: userState.groupName,
                    config: {
                        ...userState.config,
                        quietTime: {
                            ...userState.config.quietTime,
                            end: messageText,
                        },
                    },
                });
                await message.reply(
                    'Deseja que os resumos sejam excluídos automaticamente?\n\n1️⃣ Sim\n2️⃣ Não\n\nDigite "voltar" para retornar ou "cancelar" para sair.'
                );
                break;

            case 'AWAITING_AUTO_DELETE_CHOICE':
                if (!['1', '2'].includes(messageText)) {
                    await message.reply('❌ Opção inválida. Digite 1️⃣ para Sim ou 2️⃣ para Não.');
                    return;
                }

                // If we're editing an existing group
                if (userState.selectedGroup) {
                    if (messageText === '2') {
                        const updatedConfig = {
                            ...userState.config,
                            deleteAfter: null,
                        };
                        config.PERIODIC_SUMMARY.groups[userState.selectedGroup] = updatedConfig;
                        await saveConfig();
                        await message.reply(
                            `Exclusão automática desativada!\n\n` +
                                `${formatGroupConfig(userState.selectedGroup, updatedConfig)}`
                        );

                        // Automatically quit when editing an existing group setting
                        clearUserState(userId, chatId, true, message);
                        return;
                    }

                    await message.reply(
                        'Digite após quanto tempo o resumo deve ser excluído.\n' +
                            'Exemplos:\n' +
                            '• "30m" para 30 minutos\n' +
                            '• "2h" para 2 horas\n\n' +
                            'Digite "voltar" para retornar ou "cancelar" para sair.'
                    );
                    setUserState(userId, chatId, 'AWAITING_AUTO_DELETE_TIME', {
                        selectedGroup: userState.selectedGroup,
                        config: userState.config,
                    });
                    return;
                }

                // For new group setup
                if (messageText === '2') {
                    setUserState(userId, chatId, 'AWAITING_GROUP_INFO', {
                        groupName: userState.groupName,
                        config: {
                            ...userState.config,
                            deleteAfter: null,
                        },
                    });
                    await message.reply(
                        'Descreva o objetivo e contexto do grupo para que eu possa gerar um prompt personalizado:\n\n' +
                            'Digite "voltar" para retornar ou "cancelar" para sair.'
                    );
                    return;
                }

                await message.reply(
                    'Digite após quanto tempo o resumo deve ser excluído.\n' +
                        'Exemplos:\n' +
                        '• "30m" para 30 minutos\n' +
                        '• "2h" para 2 horas\n\n' +
                        'Digite "voltar" para retornar ou "cancelar" para sair.'
                );
                setUserState(userId, chatId, 'AWAITING_AUTO_DELETE_TIME', {
                    groupName: userState.groupName,
                    config: userState.config,
                });
                break;

            case 'AWAITING_AUTO_DELETE_TIME':
                const timeMatch = messageText.match(/^(\d+)(m|h)$/i);
                if (!timeMatch) {
                    await message.reply(
                        '❌ Formato inválido. Use "30m" para 30 minutos ou "2h" para 2 horas.'
                    );
                    return;
                }

                const [, value, unit] = timeMatch;
                const minutes = unit.toLowerCase() === 'h' ? parseInt(value) * 60 : parseInt(value);

                if (minutes < 1) {
                    await message.reply('❌ O tempo mínimo é 1 minuto.');
                    return;
                }

                // If we're editing an existing group
                if (userState.selectedGroup) {
                    const updatedConfig = {
                        ...userState.config,
                        deleteAfter: minutes,
                    };
                    config.PERIODIC_SUMMARY.groups[userState.selectedGroup] = updatedConfig;
                    await saveConfig();
                    await message.reply(
                        `Tempo de exclusão automática atualizado!\n\n${formatGroupConfig(
                            userState.selectedGroup,
                            updatedConfig
                        )}`
                    );

                    // Automatically quit when editing an existing group setting
                    clearUserState(userId, chatId, true, message);
                    return;
                }

                // For new group setup
                setUserState(userId, chatId, 'AWAITING_GROUP_INFO', {
                    groupName: userState.groupName,
                    config: {
                        ...userState.config,
                        deleteAfter: minutes,
                    },
                });
                await message.reply(
                    'Descreva o objetivo e contexto do grupo para que eu possa gerar um prompt personalizado:\n\nDigite "voltar" para retornar ou "cancelar" para sair.'
                );
                break;

            case 'AWAITING_GROUP_INFO':
                logger.debug('Entering AWAITING_GROUP_INFO state', {
                    messageText: message.body,
                    hasConfig: !!userState.config,
                });

                // Generate prompt using ChatGPT
                const promptTemplate = config.COMMANDS.WIZARD.prompt.GENERATE_TEMPLATE;
                const groupInfo = message.body.trim(); // Use original case

                logger.debug('Preparing to generate prompt', {
                    promptTemplate,
                    groupInfo,
                });

                const promptForGPT = promptTemplate.replace(/{groupInfo}/g, groupInfo);
                logger.debug('Generated prompt for GPT:', promptForGPT);

                try {
                    logger.debug('Calling runCompletion');
                    const generatedPrompt = await runCompletion(promptForGPT);

                    if (!generatedPrompt) {
                        logger.debug('No prompt generated from GPT');
                        throw new Error('Failed to generate prompt');
                    }

                    logger.debug('Successfully generated prompt:', generatedPrompt);

                    // Store the generated prompt and move to AWAITING_PROMPT_APPROVAL state
                    setUserState(userId, chatId, 'AWAITING_PROMPT_APPROVAL', {
                        groupName: userState.groupName,
                        selectedGroup: userState.selectedGroup,
                        config: userState.config,
                        generatedPrompt,
                        groupInfo,
                    });

                    await message.reply(
                        `*Prompt Gerado pelo ChatGPT:*\n\n` +
                            `${generatedPrompt}\n\n` +
                            `Escolha uma opção:\n` +
                            `1️⃣ Aceitar este prompt\n` +
                            `2️⃣ Criar meu próprio prompt\n` +
                            `3️⃣ Usar prompt padrão\n\n` +
                            `Digite "voltar" para retornar ou "cancelar" para sair.`
                    );
                    return;
                } catch (error) {
                    logger.error('Error generating prompt:', error);
                    await message.reply(
                        '❌ Erro ao gerar o prompt. Por favor, tente novamente ou escolha editar manualmente.'
                    );
                    await message.reply(
                        `Escolha uma opção:\n` +
                            `1️⃣ Tentar gerar novamente\n` +
                            `2️⃣ Criar meu próprio prompt\n` +
                            `3️⃣ Usar prompt padrão\n\n` +
                            `Digite "voltar" para retornar ou "cancelar" para sair.`
                    );
                    setUserState(userId, chatId, 'AWAITING_PROMPT_APPROVAL', {
                        groupName: userState.groupName,
                        selectedGroup: userState.selectedGroup,
                        config: userState.config,
                        generatedPrompt: null,
                        groupInfo,
                    });
                    return;
                }

            case 'AWAITING_PROMPT_APPROVAL':
                logger.debug('Processing AWAITING_PROMPT_APPROVAL', {
                    messageText,
                    hasGeneratedPrompt: !!userState.generatedPrompt,
                    hasGroupInfo: !!userState.groupInfo,
                });

                if (!['1', '2', '3'].includes(messageText)) {
                    await message.reply(
                        '❌ Opção inválida. Digite 1️⃣, 2️⃣ ou 3️⃣, "voltar" para retornar, ou "cancelar" para sair.'
                    );
                    return;
                }

                const groupName3 = userState.selectedGroup || userState.groupName;

                if (messageText === '1') {
                    if (!userState.generatedPrompt) {
                        await message.reply(
                            '❌ Erro: Nenhum prompt foi gerado. Por favor, descreva o grupo novamente.'
                        );
                        setUserState(userId, chatId, 'AWAITING_GROUP_INFO', {
                            groupName: userState.groupName,
                            selectedGroup: userState.selectedGroup,
                            config: userState.config,
                        });
                        return;
                    }

                    config.PERIODIC_SUMMARY.groups[groupName3] = {
                        enabled: true,
                        ...userState.config,
                        prompt: sanitizePrompt(userState.generatedPrompt),
                    };
                    await saveConfig();
                    await message.reply(
                        `Configuração salva com sucesso!\n\n` +
                            `${formatGroupConfig(
                                groupName3,
                                config.PERIODIC_SUMMARY.groups[groupName3]
                            )}`
                    );
                    // Automatically quit the wizard after successful configuration
                    clearUserState(userId, chatId, true, message);
                    return;
                }

                if (messageText === '2') {
                    await message.reply(
                        'Digite seu prompt personalizado:\n\nDigite "voltar" para retornar ou "cancelar" para sair.'
                    );
                    setUserState(userId, chatId, 'AWAITING_CUSTOM_PROMPT', {
                        groupName: userState.groupName,
                        selectedGroup: userState.selectedGroup,
                        config: userState.config,
                    });
                    return;
                }

                if (messageText === '3') {
                    const currentConfig = config.PERIODIC_SUMMARY.groups[groupName3] || {};
                    delete currentConfig.prompt; // Remove custom prompt to use default
                    config.PERIODIC_SUMMARY.groups[groupName3] = {
                        ...currentConfig,
                        enabled: true,
                    };
                    await saveConfig();
                    await message.reply(
                        `Configuração salva com sucesso!\n\n` +
                            `${formatGroupConfig(groupName3, {
                                ...config.PERIODIC_SUMMARY.defaults,
                                ...currentConfig,
                                enabled: true,
                            })}`
                    );
                    // Automatically quit the wizard after successful configuration
                    clearUserState(userId, chatId, true, message);
                    return;
                }
                break;

            case 'AWAITING_CUSTOM_PROMPT':
                logger.debug('Processing AWAITING_CUSTOM_PROMPT', {
                    messageText: message.body,
                    config: userState.config,
                });

                const customPrompt = message.body.trim();
                const groupName2 = userState.selectedGroup || userState.groupName;

                config.PERIODIC_SUMMARY.groups[groupName2] = {
                    enabled: true,
                    ...userState.config,
                    prompt: sanitizePrompt(customPrompt),
                };

                await saveConfig();
                await message.reply(
                    `Configuração salva com sucesso!\n\n` +
                        `${formatGroupConfig(
                            groupName2,
                            config.PERIODIC_SUMMARY.groups[groupName2]
                        )}`
                );
                // Automatically quit the wizard after successful configuration
                clearUserState(userId, chatId, true, message);
                break;

            case 'AWAITING_CONFIRMATION':
                if (messageText === '1') {
                    // Save the configuration
                    const groupName = userState.groupName;
                    const config = userState.config;

                    // Use the group manager to add the new group
                    const result = groupManager.addNewGroup(groupName, {
                        enableSummary: true,
                        summaryConfig: config,
                    });

                    if (result.success) {
                        await message.reply(
                            `Configuração salva com sucesso para o grupo "${groupName}"!`
                        );

                        // Clear user state with success message
                        clearUserState(
                            userId,
                            chatId,
                            true,
                            `Configuração para "${groupName}" salva com sucesso.`
                        );
                    } else {
                        await message.reply(`❌ Erro ao salvar a configuração: ${result.message}`);

                        // Clear user state with error message
                        clearUserState(
                            userId,
                            chatId,
                            false,
                            `Erro ao salvar configuração: ${result.message}`
                        );
                    }
                } else {
                    await message.reply('❌ Configuração cancelada.');

                    // Clear user state with cancellation message
                    clearUserState(userId, chatId, false, 'Configuração cancelada pelo usuário.');
                }
                break;

            default:
                logger.debug('Unhandled state:', userState.state);
                await message.reply(
                    '❌ Erro no assistente de configuração. Por favor, tente novamente.'
                );
                clearUserState(userId, chatId);
        }
    } catch (error) {
        logger.error('Error in wizard:', error);
        await message.reply(
            '❌ Ocorreu um erro durante a configuração. Por favor, tente novamente.'
        );
        clearUserState(userId, chatId);
    }
}

// Function to start a new wizard session
async function handleWizard(message) {
    // Get proper chat and contact objects first
    const chat = await message.getChat();
    const contact = await message.getContact();
    
    // Extract IDs correctly
    const userId = contact.id._serialized;
    const chatId = chat.id._serialized;

    logger.debug('handleWizard called', {
        userId,
        chatId,
        messageBody: message.body,
        currentUserStates: Array.from(userStates.keys()),
        hasActiveSession: userStates.has(getStateKey(userId, chatId))
    });

    // Check if user already has an active session
    if (userStates.has(getStateKey(userId, chatId))) {
        logger.debug('Active session detected, sending message', {
            userId,
            chatId,
            stateKey: getStateKey(userId, chatId),
            currentState: userStates.get(getStateKey(userId, chatId))
        });
        
        await message.reply(
            'Você já tem uma sessão de configuração ativa. Digite "cancelar" para encerrar a sessão atual.'
        );
        return;
    }

    // Initialize new session
    setUserState(userId, chatId, 'INITIAL');

    // Start the wizard
    await processWizardStep(message);
}

// Initialize the timeout checker
setupTimeoutChecker();

module.exports = {
    handleWizard,
    getUserState,
    isWizardActive,
    processWizardStep,
};
