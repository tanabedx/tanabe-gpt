const config = require('../configs');
const logger = require('../utils/logger');
const nlpProcessor = require('../commands/nlpProcessor');
const whitelist = require('../configs/whitelist');

class CommandManager {
    constructor() {
        this.commandHandlers = new Map();
        this.messageQueue = [];
        this.setupAutoDelete();
    }

    // Register a command handler
    registerHandler(commandName, handler) {
        this.commandHandlers.set(commandName, handler);
    }

    // Parse command from message
    async parseCommand(messageBody, mentions = []) {
        if (!messageBody) return { command: null, input: '' };

        // First, normalize the message: trim it and handle # followed by spaces
        let trimmedBody = messageBody.trim();

        // Handle case where message starts with # followed by spaces
        if (trimmedBody.match(/^#\s+/)) {
            // Replace "# command" with "#command"
            const normalizedBody = trimmedBody.replace(/^#\s+/, '#');
            logger.debug('Normalized message with spaces after #', {
                original: trimmedBody,
                normalized: normalizedBody,
            });
            trimmedBody = normalizedBody;
        }

        logger.debug('Parsing command from message', {
            messageBody: trimmedBody,
            hasMentions: mentions.length > 0,
        });

        // Check if the bot is mentioned
        if (mentions && mentions.length > 0) {
            try {
                const botNumber = config.CREDENTIALS.BOT_NUMBER;
                const isBotMentioned = mentions.some(id => id === `${botNumber}@c.us`);

                if (isBotMentioned) {
                    logger.debug('Bot was mentioned, processing with NLP');
                    // Remove the bot mention from the message body for cleaner NLP processing
                    const cleanedBody = trimmedBody
                        .replace(new RegExp(`@${botNumber}\\s*`, 'i'), '')
                        .trim();

                    // Process the cleaned message with NLP
                    const nlpResult = await nlpProcessor.processNaturalLanguage({
                        body: cleanedBody,
                        hasQuotedMsg: false,
                        mentionedIds: mentions,
                        getChat: async () => ({ isGroup: true }),
                        getContact: async () => ({ id: { _serialized: 'unknown' } }),
                    });

                    if (nlpResult && nlpResult.startsWith('#')) {
                        // Handle whitespace after # prefix
                        const cleanedResult = nlpResult.replace(/^#\s*/, '').trim();
                        const [commandName, ...inputParts] = cleanedResult.split(/\s+/);

                        // Map command prefixes to command names
                        const commandPrefixMap = {
                            ayubnews: 'AYUB_NEWS',
                            resumo: 'RESUMO',
                            sticker: 'STICKER',
                            desenho: 'DESENHO',
                            '?': 'COMMAND_LIST',
                            audio: 'AUDIO',
                            ferramentaresumo: 'RESUMO_CONFIG',
                            twitterdebug: 'TWITTER_DEBUG',
                            rssdebug: 'RSS_DEBUG',
                            debugperiodic: 'DEBUG_PERIODIC',
                            clearcache: 'CACHE_CLEAR',
                        };

                        // Get the command name from the prefix map or use the original
                        const commandKey =
                            commandPrefixMap[commandName.toLowerCase()] ||
                            commandName.toUpperCase();
                        const command = config.COMMANDS[commandKey];

                        if (command) {
                            // Special case for AYUB_NEWS_FUT
                            if (
                                commandKey === 'AYUB_NEWS' &&
                                inputParts.length > 0 &&
                                inputParts[0].toLowerCase() === 'fut'
                            ) {
                                const futCommand = config.COMMANDS['AYUB_NEWS_FUT'];
                                if (futCommand) {
                                    logger.debug(
                                        'NLP detected AYUB_NEWS_FUT command from bot mention',
                                        {
                                            commandPrefix: commandName.toLowerCase(),
                                            commandKey: 'AYUB_NEWS_FUT',
                                            input: inputParts.slice(1).join(' '), // Remove 'fut' from input
                                        }
                                    );
                                    return {
                                        command: { ...futCommand, name: 'AYUB_NEWS_FUT' },
                                        input: inputParts.slice(1).join(' '), // Remove 'fut' from input
                                    };
                                }
                            }

                            logger.debug('NLP detected command from bot mention', {
                                commandPrefix: commandName.toLowerCase(),
                                commandKey,
                                input: inputParts.join(' '),
                            });
                            return {
                                command: { ...command, name: commandKey },
                                input: inputParts.join(' '),
                            };
                        }
                    } else if (nlpResult && nlpResult.startsWith('@')) {
                        // Handle tag commands from NLP
                        logger.debug('NLP detected tag command from bot mention', {
                            tag: nlpResult,
                        });
                        const tagCommand = config.COMMANDS.TAG;
                        if (tagCommand) {
                            // Use the NLP result as the input, not the original message
                            return { command: { ...tagCommand, name: 'TAG' }, input: nlpResult };
                        }
                    }

                    // If NLP didn't produce a valid result, return null
                    return { command: null, input: '' };
                }
            } catch (error) {
                logger.error('Error processing bot mention:', error);
            }
        }

        // Check if the message is a tag command (but not a bot mention)
        if (trimmedBody.startsWith('@') && !mentions.length) {
            const tagPart = trimmedBody.split(' ')[0].toLowerCase();
            logger.debug('Detected potential tag command', { tag: tagPart });

            // Check if it's a valid tag
            const tagCommand = config.COMMANDS.TAG;
            if (tagCommand) {
                // Check special tags (case insensitive)
                const specialTags = Object.keys(tagCommand.specialTags).map(t => t.toLowerCase());
                if (specialTags.includes(tagPart)) {
                    logger.debug('Found matching special tag', { tag: tagPart });
                    return { command: { ...tagCommand, name: 'TAG' }, input: trimmedBody };
                }

                // Check group-specific tags for each group
                for (const [groupName, groupTags] of Object.entries(tagCommand.groupTags)) {
                    const groupTagKeys = Object.keys(groupTags).map(t => t.toLowerCase());
                    if (groupTagKeys.includes(tagPart)) {
                        logger.debug('Found matching group tag', {
                            tag: tagPart,
                            group: groupName,
                        });
                        return { command: { ...tagCommand, name: 'TAG' }, input: trimmedBody };
                    }
                }
            }

            // If we get here, it's a tag but not one we recognize
            // Don't return a command for invalid tags
            logger.debug('Tag not recognized in configuration', { tag: tagPart });
            return { command: null, input: '' };
        }

        // Check each command's prefixes
        for (const [commandName, command] of Object.entries(config.COMMANDS)) {
            if (!command.prefixes || !Array.isArray(command.prefixes)) {
                logger.debug('Skipping command without prefixes', { commandName });
                continue;
            }

            logger.debug('Checking command prefixes', {
                commandName,
                prefixes: command.prefixes,
                messageBody: trimmedBody,
            });

            for (const prefix of command.prefixes) {
                // Add detailed logging for # commands
                if (prefix.startsWith('#') && trimmedBody.startsWith('#')) {
                    logger.debug('Checking # command match details', {
                        commandName,
                        prefix,
                        trimmedBody,
                        prefixLower: prefix.toLowerCase(),
                        messageBodyLower: trimmedBody.toLowerCase(),
                        startsWithPrefix: trimmedBody
                            .toLowerCase()
                            .startsWith(prefix.toLowerCase()),
                        startsWithPrefixSpace: trimmedBody
                            .toLowerCase()
                            .startsWith(prefix.toLowerCase() + ' '),
                    });
                }

                // Check for exact match first (case insensitive)
                if (trimmedBody.toLowerCase() === prefix.toLowerCase()) {
                    logger.debug('Found exact command match', {
                        command: commandName,
                        prefix,
                        input: '',
                    });
                    return { command: { ...command, name: commandName }, input: '' };
                }

                // Then check for prefix with additional content (case insensitive)
                if (
                    trimmedBody.toLowerCase().startsWith(prefix.toLowerCase() + ' ') ||
                    trimmedBody.toLowerCase().startsWith(prefix.toLowerCase())
                ) {
                    // Special handling for RESUMO command
                    if (commandName === 'RESUMO') {
                        const input = trimmedBody.slice(prefix.length).trim();
                        logger.debug('Processing RESUMO command', {
                            input,
                            commandName,
                        });
                        return { command: { ...command, name: commandName }, input };
                    }

                    // For other commands, check if they start with the prefix followed by a space
                    if (trimmedBody.toLowerCase().startsWith(prefix.toLowerCase() + ' ')) {
                        const input = trimmedBody.slice(prefix.length).trim();
                        logger.debug('Found command with input', {
                            command: commandName,
                            prefix,
                            input,
                        });
                        return { command: { ...command, name: commandName }, input };
                    }
                }
            }
        }

        // If we get here and message starts with #, treat as ChatGPT
        if (trimmedBody.startsWith('#')) {
            // Clean the command by removing # and any leading whitespace
            const cleanedCommand = trimmedBody.replace(/^#\s*/, '').trim();

            // If there's content after #
            if (cleanedCommand.length > 0) {
                // Extract the command part (first word after # and any whitespace)
                const commandPart = cleanedCommand.split(/\s+/)[0].toLowerCase();

                logger.debug('Parsing command with prefix #', {
                    originalMessage: trimmedBody,
                    cleanedCommand,
                    commandPart,
                });

                // First check if this is a known command prefix
                // Try to match against all known command prefixes
                let foundSpecificCommand = false;
                for (const [cmdName, cmd] of Object.entries(config.COMMANDS)) {
                    if (cmd.prefixes && Array.isArray(cmd.prefixes)) {
                        // Check if any of the prefixes match our command part
                        for (const cmdPrefix of cmd.prefixes) {
                            if (
                                cmdPrefix.startsWith('#') &&
                                cmdPrefix.substring(1).toLowerCase() === commandPart.toLowerCase()
                            ) {
                                // This is a known command, but we already checked it earlier and it didn't match
                                // So this is likely a malformed command, log it
                                logger.debug('Detected malformed command', {
                                    commandPart,
                                    matchingPrefix: cmdPrefix,
                                    command: cmdName,
                                });
                                foundSpecificCommand = true;
                                break;
                            }
                        }
                        if (foundSpecificCommand) break;
                    }
                }

                // If this matches a known command prefix but didn't match our earlier checks,
                // treat it as that command with empty input rather than defaulting to ChatGPT
                if (foundSpecificCommand) {
                    logger.debug('Treating as malformed specific command instead of ChatGPT');
                    // Continue to check command prefix map below
                }

                // Map command prefixes to command names
                const commandPrefixMap = {
                    ayubnews: 'AYUB_NEWS',
                    resumo: 'RESUMO',
                    sticker: 'STICKER',
                    desenho: 'DESENHO',
                    '?': 'COMMAND_LIST',
                    audio: 'AUDIO',
                    ferramentaresumo: 'RESUMO_CONFIG',
                    twitterdebug: 'TWITTER_DEBUG',
                    rssdebug: 'RSS_DEBUG',
                    debugperiodic: 'DEBUG_PERIODIC',
                    clearcache: 'CACHE_CLEAR',
                };

                // Check if the command part matches any known command prefix
                const commandKey = commandPrefixMap[commandPart];
                if (commandKey && config.COMMANDS[commandKey]) {
                    // Extract input by removing the command part
                    const input = cleanedCommand.substring(commandPart.length).trim();

                    // Special case for AYUB_NEWS_FUT
                    if (
                        commandKey === 'AYUB_NEWS' &&
                        input.trim().toLowerCase().startsWith('fut')
                    ) {
                        const futCommand = config.COMMANDS['AYUB_NEWS_FUT'];
                        if (futCommand) {
                            logger.debug(`Found AYUB_NEWS_FUT command`, {
                                commandKey: 'AYUB_NEWS_FUT',
                                input: input.slice(3).trim(), // Remove 'fut' from input
                            });
                            return {
                                command: { ...futCommand, name: 'AYUB_NEWS_FUT' },
                                input: input.slice(3).trim(), // Remove 'fut' from input
                            };
                        }
                    }

                    logger.debug(`Found command match for ${commandPart}`, {
                        commandKey,
                        input,
                    });
                    return {
                        command: { ...config.COMMANDS[commandKey], name: commandKey },
                        input,
                    };
                }
            }

            // If no specific command matched, fall back to ChatGPT
            const chatGptCommand = config.COMMANDS.CHAT_GPT;
            if (this.validateCommand('CHAT_GPT', chatGptCommand)) {
                logger.debug('Treating as ChatGPT command', {
                    input: cleanedCommand,
                });
                return {
                    command: { ...chatGptCommand, name: 'CHAT_GPT' },
                    input: cleanedCommand,
                };
            }
        }

        logger.debug('No command match found', { messageBody: trimmedBody });
        return { command: null, input: '' };
    }

    // Validate command configuration
    validateCommand(commandName, commandConfig) {
        if (!commandConfig) {
            logger.error(
                `Invalid command configuration for ${commandName}: configuration is missing`
            );
            return false;
        }

        // Check required properties
        if (!commandConfig.errorMessages || typeof commandConfig.errorMessages !== 'object') {
            logger.error(
                `Invalid command configuration for ${commandName}: errorMessages is missing or invalid`
            );
            return false;
        }

        // Check permissions if defined
        if (commandConfig.permissions) {
            if (
                commandConfig.permissions.allowedIn !== 'all' &&
                !Array.isArray(commandConfig.permissions.allowedIn)
            ) {
                logger.error(
                    `Invalid command configuration for ${commandName}: permissions.allowedIn must be 'all' or an array`
                );
                return false;
            }
        }

        return true;
    }

    // Check if command is allowed in chat
    async isCommandAllowedInChat(command, chatId, userId = null) {
        const commandName = command.name;

        // Format user identifier consistently
        const userPhone = userId?.endsWith('@c.us') ? userId.split('@')[0] : userId;
        const locationStr = chatId.endsWith('@g.us') ? 'in group chat' : 'in DM';

        logger.debug('Checking command permissions', {
            command: commandName,
            chatId,
            user: `User (${userPhone})`,
            location: locationStr,
        });

        // Check if user is admin (direct check)
        const adminNumber = config.CREDENTIALS.ADMIN_NUMBER;
        const isAdmin = userId === `${adminNumber}@c.us` || userId === adminNumber;

        if (isAdmin) {
            logger.debug(
                `Admin access granted for command ${commandName} to User (${userPhone}) ${locationStr}`
            );
            return true;
        }

        // Get chat name for group chats
        let chatName = chatId;
        if (chatId.endsWith('@g.us')) {
            try {
                const chat = await global.client.getChatById(chatId);
                chatName = chat.name;
            } catch (error) {
                logger.error('Error getting chat name:', error);
            }
        }

        // Use the whitelist's hasPermission function
        const isAllowed = await whitelist.hasPermission(commandName, chatName, userId);

        // Debug log only (removed warning logs to avoid duplication)
        logger.debug('Permission check result', {
            command: commandName,
            chatLocation: chatId.endsWith('@g.us') ? `in ${chatName}` : 'in DM',
            user: `User (${userPhone})`,
            isAllowed,
        });

        return isAllowed;
    }

    // Handle auto-deletion of messages
    async handleAutoDelete(message, commandConfig, isError = false) {
        const shouldDelete = isError
            ? commandConfig.autoDelete?.errorMessages
            : commandConfig.autoDelete?.commandMessages;

        if (shouldDelete) {
            this.messageQueue.push({
                message,
                timeout: config.MESSAGE_DELETE_TIMEOUT,
                timestamp: Date.now(),
            });
        }
    }

    // Setup auto-delete interval
    setupAutoDelete() {
        setInterval(async () => {
            const now = Date.now();
            while (
                this.messageQueue.length > 0 &&
                now - this.messageQueue[0].timestamp >= this.messageQueue[0].timeout
            ) {
                const { message } = this.messageQueue.shift();
                try {
                    const chat = await message.getChat();
                    const messages = await chat.fetchMessages({ limit: 50 });
                    const messageToDelete = messages.find(
                        msg => msg.id._serialized === message.id._serialized
                    );
                    if (messageToDelete) {
                        await messageToDelete.delete(true);
                        logger.debug(`Deleted message:`, messageToDelete.body);
                    }
                } catch (error) {
                    logger.error(`Failed to delete message:`, error);
                }
            }
        }, 60000);
    }

    // Main command processing function
    async processCommand(message, nlpInput = null) {
        try {
            // Parse the command from the message
            const mentions = message.mentionedIds || [];
            const { command, input } = await this.parseCommand(message.body, mentions);

            if (!command) return false;

            const chat = await message.getChat();
            const contact = await message.getContact();

            // Use NLP input if provided (for tag commands)
            const finalInput = nlpInput || input;

            // Get chat ID and user ID
            const chatId = chat.id._serialized;
            const userId = contact.id._serialized;

            // Check if the user is in wizard mode in this chat
            // If they are, we should not process other commands
            if (nlpProcessor.isWizardActive(userId, chatId)) {
                logger.debug('User is in wizard mode, skipping normal command processing', {
                    userId,
                    chatId,
                    command: command.name,
                });
                return false;
            }

            // Check if command is allowed in this chat for this user
            const isAllowed = await this.isCommandAllowedInChat(command, chatId, userId);
            if (!isAllowed) {
                const { isBot, isDM, isAdmin, isOwner, isUser } = isAllowed;

                logger.warn(`Command ${command.name} blocked due to permissions`, {
                    command: command.name,
                    isBot,
                    isDM,
                    isAdmin,
                    isOwner,
                    isUser,
                });

                if (isBot && command.errorMessages?.bot) {
                    await message.reply(command.errorMessages.bot);
                } else if (!isDM && command.errorMessages?.group) {
                    await message.reply(command.errorMessages.group);
                } else if (!isAdmin && command.errorMessages?.admin) {
                    await message.reply(command.errorMessages.admin);
                } else if (!isOwner && command.errorMessages?.owner) {
                    await message.reply(command.errorMessages.owner);
                } else if (!isUser && command.errorMessages?.user) {
                    await message.reply(command.errorMessages.user);
                } else if (command.errorMessages?.permission) {
                    await message.reply(command.errorMessages.permission);
                }

                return false;
            }

            const userPhone = userId.endsWith('@c.us') ? userId.split('@')[0] : userId;
            const userName = contact.pushname || contact.name || userPhone;
            const userIdentifier = `${userName} (${userPhone})`;
            // Location format: "in DM" or "in Group Name"
            const locationStr = chat.isGroup ? `in ${chat.name}` : 'in DM';

            let logMessage;
            if (message.hasMedia) {
                logMessage = `Executing command: ${command.name} by ${userIdentifier} ${locationStr} with media attachment`;
            } else if (message.hasQuotedMsg) {
                logMessage = `Executing command: ${command.name} by ${userIdentifier} ${locationStr} with quoted message`;
            } else if (finalInput && finalInput.length > 0) {
                logMessage = `Executing command: ${command.name} by ${userIdentifier} ${locationStr} with input: ${finalInput}`;
            } else {
                logMessage = `Executing command: ${command.name} by ${userIdentifier} ${locationStr}`;
            }

            logger.info(logMessage);

            logger.debug('Processing command', {
                command: command.name,
                input: finalInput,
                chatId: message.chat?.id?._serialized,
                hasQuoted: message.hasQuotedMsg,
                hasMedia: message.hasMedia,
            });

            // Validate the command
            if (!this.validateCommand(command.name, command)) {
                logger.warn(`Invalid command configuration for ${command.name}`);
                return false;
            }

            // Get the handler for this command
            const handler = this.commandHandlers.get(command.name);
            if (!handler) {
                logger.warn(`No handler registered for command ${command.name}`);
                return false;
            }

            try {
                // Execute the command with the final input
                await handler(message, command, finalInput);
                return true;
            } catch (error) {
                // Format user identifier consistently
                const userPhone = userId.endsWith('@c.us') ? userId.split('@')[0] : userId;
                // Format location consistently
                const locationStr = chat.isGroup ? `in ${chat.name}` : 'in DM';

                logger.error(
                    `Error executing command ${command.name} by ${userPhone} ${locationStr}:`,
                    error
                );
                if (command.errorMessages?.error) {
                    await message.reply(command.errorMessages.error);
                }
                return false;
            }
        } catch (error) {
            logger.error('Error processing command:', error);
            return false;
        }
    }

    // Check if a tag is valid (exists in config)
    async checkValidTag(potentialTags, chat) {
        try {
            // Get the tag command configuration
            const tagCommand = config.COMMANDS.TAG;
            if (!tagCommand) {
                return { isValidTag: false, validTag: null };
            }

            // Get all special tags (case insensitive)
            const specialTags = Object.keys(tagCommand.specialTags).map(t => t.toLowerCase());

            // Get group-specific tags if this is a group chat
            let groupTags = [];
            if (chat.isGroup && tagCommand.groupTags[chat.name]) {
                groupTags = Object.keys(tagCommand.groupTags[chat.name]).map(t => t.toLowerCase());
            }

            // Check each potential tag against our valid tags
            for (const tag of potentialTags) {
                const lowerTag = tag.toLowerCase();

                // Check if it's a special tag
                if (specialTags.includes(lowerTag)) {
                    logger.debug('Found valid special tag', { tag });
                    return { isValidTag: true, validTag: tag };
                }

                // Check if it's a group-specific tag
                if (groupTags.includes(lowerTag)) {
                    logger.debug('Found valid group tag', { tag, group: chat.name });
                    return { isValidTag: true, validTag: tag };
                }
            }

            // If we get here, no valid tags were found
            logger.debug('No valid tags found', {
                potentialTags,
                availableSpecialTags: Object.keys(tagCommand.specialTags),
                availableGroupTags:
                    chat.isGroup && tagCommand.groupTags[chat.name]
                        ? Object.keys(tagCommand.groupTags[chat.name])
                        : [],
            });
            return { isValidTag: false, validTag: null };
        } catch (error) {
            logger.error('Error checking valid tag:', error);
            return { isValidTag: false, validTag: null };
        }
    }
}

module.exports = new CommandManager();
