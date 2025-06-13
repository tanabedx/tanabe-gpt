const config = require('../configs');
const { runCompletion } = require('../utils/openaiUtils');
const { extractLinks, unshortenLink, getPageContent } = require('../utils/linkUtils');
const { getResumoPrompt } = require('./resumoPromptUtils');
const logger = require('../utils/logger');
const { handleAutoDelete, resolveContactName } = require('../utils/messageUtils');
const { downloadAndProcessDocument } = require('./documentUtils');

async function handleQuotedMessage(message, command) {
    try {
        const quotedMsg = await message.getQuotedMessage();

        // Check if quoted message has a document
        if (quotedMsg.hasMedia && quotedMsg.type === 'document') {
            logger.debug('Processing quoted document');
            try {
                const text = await downloadAndProcessDocument(quotedMsg);

                // Get prompt template for document summarization
                const prompt = getResumoPrompt('DOCUMENT_SUMMARY', {
                    text,
                });

                const summary = await runCompletion(prompt, 0.7);
                const response = await quotedMsg.reply(summary);

                // Handle auto-deletion if configured
                await handleAutoDelete(response, command);
                await handleAutoDelete(message, command);
                return;
            } catch (error) {
                logger.error('Error processing document:', error);
                const errorMessage = await message.reply(command.errorMessages.documentError);
                await handleAutoDelete(errorMessage, command, true);
                throw error;
            }
        }

        // Handle other quoted message types (links, text, etc.)
        const quotedText = quotedMsg.body;
        const links = extractLinks(quotedText);

        logger.debug('Processing quoted message', {
            hasLinks: links.length > 0,
            quotedTextLength: quotedText.length,
        });

        if (links.length > 0) {
            try {
                logger.debug('Found link in quoted message, processing', { link: links[0] });
                const unshortenedLink = await unshortenLink(links[0]);
                logger.debug('Link unshortened', { original: links[0], unshortened: unshortenedLink });
                
                const pageContent = await getPageContent(unshortenedLink);
                logger.debug('Page content fetched', { 
                    url: unshortenedLink,
                    contentLength: pageContent.length,
                    contentPreview: pageContent.substring(0, 100) + '...'
                });
                
                const prompt = getResumoPrompt('LINK_SUMMARY', {
                    pageContent,
                });
                const summary = await runCompletion(prompt, 1);
                const response = await quotedMsg.reply(summary);
                await handleAutoDelete(response, command);
            } catch (error) {
                logger.error('Error processing link:', {
                    link: links[0],
                    error: error.message,
                    stack: error.stack
                });
                
                // Try to provide a fallback by summarizing the quoted text instead
                logger.debug('Falling back to text summarization due to link processing error');
                try {
                    const contact = await message.getContact();
                    const name = resolveContactName(contact);
                    const prompt = getResumoPrompt('QUOTED_MESSAGE', {
                        name,
                        quotedText: `Link não pôde ser processado: ${links[0]}\n\n${quotedText}`,
                    });
                    const result = await runCompletion(prompt, 1);
                    const response = await quotedMsg.reply(`⚠️ Não consegui processar o link, mas aqui está um resumo do texto:\n\n${result.trim()}`);
                    await handleAutoDelete(response, command);
                } catch (fallbackError) {
                    logger.error('Fallback text summary also failed:', fallbackError);
                    const errorMessage = await message.reply(command.errorMessages.linkError);
                    await handleAutoDelete(errorMessage, command, true);
                }
            }
        } else {
            logger.debug('No links found, summarizing quoted text');
            const contact = await message.getContact();
            const name = resolveContactName(contact);
            const prompt = getResumoPrompt('QUOTED_MESSAGE', {
                name,
                quotedText,
            });
            const result = await runCompletion(prompt, 1);
            const response = await quotedMsg.reply(result.trim());
            await handleAutoDelete(response, command);
        }
    } catch (error) {
        logger.error('Error handling quoted message:', error);
        throw error;
    }
}

async function handleSpecificMessageCount(message, limit) {
    const chat = await message.getChat();

    if (isNaN(limit)) {
        return await message
            .reply(
                'Por favor, forneça um número válido após "#resumo" para definir o limite de mensagens.'
            )
            .catch(error => logger.error('Failed to send message:', error.message));
    }

    let allValidMessages = [];
    let lastMessageId = null;
    const batchSize = Math.min(limit * 2, 100); // Fetch in smaller batches to avoid memory issues

    // Keep fetching until we have enough valid messages
    while (allValidMessages.length < limit) {
        logger.debug('Fetching messages batch', {
            currentValidCount: allValidMessages.length,
            targetCount: limit,
            batchSize,
            hasLastMessageId: !!lastMessageId,
        });

        // Fetch next batch of messages
        const options = { limit: batchSize };
        if (lastMessageId) {
            options.before = lastMessageId;
        }
        const messages = await chat.fetchMessages(options);

        // If no more messages available, break
        if (!messages || messages.length === 0) {
            break;
        }

        // Filter valid messages from this batch
        const validMessagesInBatch = messages.filter(
            msg => !msg.fromMe && msg.body.trim() !== '' && !msg._data.isDeleted // Skip deleted messages
        );

        // Add valid messages to our collection
        allValidMessages = allValidMessages.concat(validMessagesInBatch);

        // Update lastMessageId for next iteration
        lastMessageId = messages[messages.length - 1].id._serialized;

        // If we've fetched all available messages and still don't have enough, break
        if (messages.length < batchSize) {
            break;
        }
    }

    // Take exactly the number of messages requested or all available if less
    const messagesToSummarize = allValidMessages.slice(0, limit);

    if (messagesToSummarize.length === 0) {
        return await message
            .reply('Não há mensagens suficientes para gerar um resumo')
            .catch(error => logger.error('Failed to send message:', error.message));
    }

    // Log if we couldn't get enough messages
    if (messagesToSummarize.length < limit) {
        logger.debug('Could not find enough valid messages', {
            requested: limit,
            found: messagesToSummarize.length,
        });
    }

    const messageTexts = await Promise.all(
        messagesToSummarize.map(async msg => {
            const contact = await msg.getContact();
            const name = resolveContactName(contact);
            return `>>${name}: ${msg.body}.\n`;
        })
    );

    const contact = await message.getContact();
    const name = resolveContactName(contact);
    const prompt = getResumoPrompt('DEFAULT', {
        name,
        messageTexts: messageTexts.join(' '),
        timeDescription: `as últimas ${limit} mensagens desta conversa`,
    });

    const result = await runCompletion(prompt, 1);
    return await message
        .reply(result.trim())
        .catch(error => logger.error('Failed to send message:', error.message));
}

function parseRelativeTime(input) {
    const now = Date.now();
    const inputLower = input.toLowerCase().trim();

    // Handle "hoje" and "hj" (today)
    if (inputLower === 'hoje' || inputLower === 'hj') {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        return { startTime: today.getTime(), timeDescription: 'as mensagens de hoje' };
    }

    // Handle "ontem" (yesterday)
    if (inputLower === 'ontem') {
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        yesterday.setHours(0, 0, 0, 0);
        return { startTime: yesterday.getTime(), timeDescription: 'as mensagens de ontem' };
    }

    // Handle time units with abbreviations and without spaces
    const timeUnits = {
        hora: {
            multiplier: 3600 * 1000,
            singular: 'hora',
            plural: 'horas',
            regex: /(\d+)\s*(?:hora|horas|hr|hrs)/i,
        },
        minuto: {
            multiplier: 60 * 1000,
            singular: 'minuto',
            plural: 'minutos',
            regex: /(\d+)\s*(?:minuto|minutos|min|mins)/i,
        },
    };

    // Try to match time expressions with or without spaces
    for (const [unit, config] of Object.entries(timeUnits)) {
        const match = inputLower.match(config.regex);
        if (match) {
            const number = parseInt(match[1]);
            const timeDescription = number === 1 ? config.singular : config.plural;
            return {
                startTime: now - number * config.multiplier,
                timeDescription: `as mensagens das últimas ${number} ${timeDescription}`,
            };
        }
    }

    // If no time expression found, try to parse as a number of messages
    const numberMatch = inputLower.match(/^\d+$/);
    if (numberMatch) {
        return null; // Return null to indicate this should be handled as a message count
    }

    return null;
}

async function handleTimeBasedSummary(message, timeInfo) {
    const chat = await message.getChat();
    const messages = await chat.fetchMessages({ limit: 1000 });

    const filteredMessages = messages.filter(
        m => m.timestamp * 1000 > timeInfo.startTime && !m.fromMe && m.body.trim() !== ''
    );

    if (filteredMessages.length === 0) {
        return await message.reply('Não há mensagens suficientes para gerar um resumo.');
    }

    const messageTexts = await Promise.all(
        filteredMessages.map(async msg => {
            const contact = await msg.getContact();
            const name = resolveContactName(contact);
            return `>>${name}: ${msg.body}.\n`;
        })
    );

    const contact = await message.getContact();
    const name = resolveContactName(contact);
    const prompt = getResumoPrompt('DEFAULT', {
        name,
        messageTexts: messageTexts.join(' '),
        timeDescription: timeInfo.timeDescription,
    });

    const result = await runCompletion(prompt, 1);
    return await message.reply(result.trim());
}

async function handleResumo(message, command, input) {
    logger.debug('handleResumo activated', {
        hasInput: !!input,
        input: input,
        hasQuoted: message.hasQuotedMsg,
        hasMedia: message.hasMedia,
        messageType: message.type,
    });

    try {
        // If there's a quoted message, handle that first
        if (message.hasQuotedMsg) {
            logger.debug('Processing quoted message');
            return await handleQuotedMessage(message, command);
        }

        // Check if the message has an attachment (document)
        if (message.hasMedia && message.type === 'document') {
            logger.debug('Processing attached document');
            try {
                const text = await downloadAndProcessDocument(message);

                // Get prompt template for document summarization
                const prompt = getResumoPrompt('DOCUMENT_SUMMARY', {
                    text,
                });

                const summary = await runCompletion(prompt, 0.7);
                const response = await message.reply(summary);

                // Handle auto-deletion if configured
                await handleAutoDelete(response, command);
                await handleAutoDelete(message, command);
                return;
            } catch (error) {
                logger.error('Error processing document:', error);
                const errorMessage = await message.reply(command.errorMessages.documentError);
                await handleAutoDelete(errorMessage, command, true);
                throw error;
            }
        }

        // If there's input after #resumo, try to parse it
        if (input) {
            const trimmedInput = input.trim();
            if (trimmedInput) {
                // First try to parse as a relative time
                const timeInfo = parseRelativeTime(trimmedInput);
                if (timeInfo !== null) {
                    logger.debug('Processing time-based summary:', trimmedInput);
                    return await handleTimeBasedSummary(message, timeInfo);
                }

                // Then try to parse as a number
                const limit = parseInt(trimmedInput);
                if (!isNaN(limit)) {
                    logger.debug('Processing specific message count:', limit);
                    return await handleSpecificMessageCount(message, limit);
                }

                // If neither time expression nor number, show error
                logger.debug('Invalid input format:', trimmedInput);
                const errorMessage = await message.reply(command.errorMessages.invalidFormat);
                await handleAutoDelete(errorMessage, command, true);
                return;
            }
        }

        // Default case: no input and no quoted message - show last 3 hours
        logger.debug('No input or quoted message, showing last 3 hours');
        const threeHoursAgo = Date.now() - 3 * 3600 * 1000;
        return await handleTimeBasedSummary(message, {
            startTime: threeHoursAgo,
            timeDescription: 'as mensagens das últimas 3 horas',
        });
    } catch (error) {
        logger.error('Error in handleResumo:', error);
        const errorMessage = await message.reply(command.errorMessages.error);
        await handleAutoDelete(errorMessage, command, true);
    }
}

module.exports = {
    handleResumo,
};
