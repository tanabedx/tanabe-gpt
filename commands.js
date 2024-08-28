// commands.js
const { MessageMedia } = require('whatsapp-web.js');
const {
    config,
    axios,
    runCompletion,
    extractLinks,
    unshortenLink,
    getPageContent,
    searchGoogleForImage,
    downloadImage,
    deleteFile,
    notifyAdmin,
    scrapeNews,
    translateToPortuguese,
    scrapeNews2,
    parseXML,
    getRelativeTime,
    generateImage
} = require('./dependencies');
const { performCacheClearing } = require('./cacheManagement');
const crypto = require('crypto');

// Helper function to delete messages after a timeout
const messageQueue = [];

async function deleteMessageAfterTimeout(sentMessage, isErrorOrCommandList) {
    if (isErrorOrCommandList) {
        messageQueue.push({ sentMessage, timeout: config.MESSAGE_DELETE_TIMEOUT, timestamp: Date.now() });
    }
}

// Process message queue
setInterval(async () => {
    const now = Date.now();
    while (messageQueue.length > 0 && now - messageQueue[0].timestamp >= messageQueue[0].timeout) {
        const { sentMessage } = messageQueue.shift();
        try {
            const chat = await sentMessage.getChat();
            const messages = await chat.fetchMessages({ limit: 50 });
            const messageToDelete = messages.find(msg => msg.id._serialized === sentMessage.id._serialized);
            if (messageToDelete) {
                await messageToDelete.delete(true);
                console.log('Deleted message:', messageToDelete.body);
            }
        } catch (error) {
            console.error('Failed to delete message:', error);
            await notifyAdmin(`Failed to delete message: ${error.message}`);
        }
    }
}, 60000); // Check every minute

// Command Handlers

async function handleResumoCommand(message, input) {
    console.log('handleResumoCommand activated');
    const chat = await message.getChat();
    await chat.sendStateTyping();
    const limit = parseInt(input[1]);

    if (isNaN(limit)) {
        message.reply('Por favor, forneça um número válido após "#resumo" para definir o limite de mensagens.')
            .catch(error => console.error('Failed to send message:', error));
        return;
    }

    const messages = await chat.fetchMessages({ limit: limit });
    const messagesWithoutMe = messages.slice(0, -1).filter(msg => !msg.fromMe && msg.body.trim() !== '');

    if (messagesWithoutMe.length === 0) {
        message.reply('Não há mensagens suficientes para gerar um resumo')
            .catch(error => console.error('Failed to send message:', error));
        return;
    }

    const messageTexts = await Promise.all(messagesWithoutMe.map(async msg => {
        const contact = await msg.getContact();
        const name = contact.name || 'Unknown';
        return `>>${name}: ${msg.body}.\n`;
    }));

    const contact = await message.getContact();
    const name = contact.name || 'Unknown';
    const prompt = config.PROMPTS.RESUMO_COMMAND
        .replace('{name}', name)
        .replace('{limit}', limit)
        .replace('{messageTexts}', messageTexts.join(' '));

    const result = await runCompletion(prompt, 1);
    message.reply(result.trim())
        .catch(error => console.error('Failed to send message:', error));
}

async function handleStickerMessage(message) {
    const stickerData = await message.downloadMedia();
    const hash = crypto.createHash('sha256').update(stickerData.data).digest('hex');

    if (hash === config.STICKER_HASHES.RESUMO) {
        await handleResumoSticker(message);
    } else if (hash === config.STICKER_HASHES.AYUB) {
        await handleAyubNewsSticker(message);
    } else {
        console.log('Sticker hash does not match any expected hash');
    }
}

async function handleAyubNewsCommand(message, input) {
    console.log('handleAyubNewsCommand activated');
    const chat = await message.getChat();
    await chat.sendStateTyping();

    if (input[1] && input[1].toLowerCase() === 'fut') {
        await handleAyubNewsFut(message);
    } else {
        await handleAyubNewsSearch(message, input);
    }
}

async function handleAyubLinkSummary(message, links) {
    console.log('handleAyubLinkSummary activated');
    const chat = await message.getChat();
    await chat.sendStateTyping();
    const link = links[0];

    try {
        const unshortenedLink = await unshortenLink(link);
        let pageContent = await getPageContent(unshortenedLink);
        
        // Use the character limit from the config file
        const charLimit = config.LINK_SUMMARY_CHAR_LIMIT || 3000;
        
        // Limit the page content to the specified number of characters
        if (pageContent.length > charLimit) {
            pageContent = pageContent.substring(0, charLimit);
        }
        
        const prompt = config.PROMPTS.LINK_SUMMARY.replace('{pageContent}', pageContent);
        const summary = await runCompletion(prompt, 1);
        const sentMessage = await message.reply(summary);
        if (summary.trim() === 'Não consegui acessar o link para gerar um resumo.') {
            await deleteMessageAfterTimeout(sentMessage, true);
        }
    } catch (error) {
        console.error('Error accessing link to generate summary:', error);
        const errorMessage = await message.reply(`Não consegui acessar o link ${link} para gerar um resumo.`);
        await deleteMessageAfterTimeout(errorMessage, true);
        await notifyAdmin(`Error accessing link to generate summary: ${error.message}`);
    }
}

async function handleHashTagCommand(message) {
    console.log('handleHashTagCommand activated');
    const chat = await message.getChat();
    await chat.sendStateTyping();
    const contact = await message.getContact();
    const name = contact.name || 'Unknown';

    let prompt = config.PROMPTS.HASHTAG_COMMAND
        .replace('{name}', name)
        .replace('{question}', message.body.substring(1));

    if (message.hasQuotedMsg) {
        const quotedMessage = await message.getQuotedMessage();
        const quotedText = quotedMessage.body;
        const link = extractLinks(quotedText)[0];

        if (link && typeof link === 'string') {
            try {
                const unshortenedLink = await unshortenLink(link);
                const pageContent = await getPageContent(unshortenedLink);
                prompt += config.PROMPTS.HASHTAG_COMMAND_CONTEXT.replace('{pageContent}', pageContent);
            } catch (error) {
                console.error('Error accessing link for context:', error);
                message.reply('Não consegui acessar o link para fornecer contexto adicional.')
                    .catch(error => console.error('Failed to send message:', error));
                return;
            }
        } else {
            prompt += config.PROMPTS.HASHTAG_COMMAND_QUOTED.replace('{quotedText}', quotedText);
        }
    }

    const result = await runCompletion(prompt, 1);
    message.reply(result.trim())
        .catch(error => console.error('Failed to send message:', error));
}

async function handleCommandList(message) {
    console.log('handleCommandList activated');
    const chat = await message.getChat();
    await chat.sendStateTyping();

    const commandList = `
Comandos disponíveis:
*# [pergunta]* - ChatGPT irá responder sua pergunta. (Se adicionar '!' após '#' ChatGPT irá adicionar humor em sua resposta)
*Sticker Resumo* - Resume a última hora de mensagens (pode ser usado para resumir mensagens e links se enviado como resposta à mensagem a ser resumida)
*#resumo [número]* - Resume as últimas [número] mensagens
*Sticker Ayub News* - Notícias relevantes do dia
*#ayubnews [palavra-chave]* - Notícias sobre a palavra-chave
*#ayubnews fut* - Notícias sobre futebol
*#sticker [palavra-chave]* - Pesquisa uma imagem e transforma em sticker
*@all* - Menciona todos os membros do grupo
*@admin* - Menciona todos os administradores do grupo
*@medicos* - Menciona os médicos no grupo
*@engenheiros* - Menciona os engenheiros no grupo
*@cartola* - Menciona os jogadores de Cartola do grupo
*#?* - Lista de comandos disponíveis
*#desenho [descrição]* - Gera uma imagem com base na descrição fornecida (apenas para grupo1)
*!clearcache* - (Apenas para admin) Limpa o cache do bot
    `;

    try {
        const sentMessage = await message.reply(commandList);
        await deleteMessageAfterTimeout(sentMessage, true);
    } catch (error) {
        console.error('Failed to send command list:', error);
        await notifyAdmin(`Failed to send command list: ${error.message}`);
    }
}

async function handleStickerCreation(message) {
    const quotedMessage = await message.getQuotedMessage();
    if (quotedMessage && quotedMessage.hasMedia) {
        const media = await quotedMessage.downloadMedia();
        if (media) {
            const chat = await message.getChat();
            await chat.sendMessage(media, { sendMediaAsSticker: true });
            return true;
        }
    }
    await message.reply('Please reply to an image with #sticker to create a sticker.');
    return false;
}

// Handle manual cache clear command
async function handleCacheClearCommand(message) {
    if (message.from === `${config.ADMIN_NUMBER}@c.us`) {
        await message.reply('Starting manual cache clearing process...');
        await performCacheClearing();
        await message.reply('Manual cache clearing process completed.');
    } else {
        await message.reply('You are not authorized to use this command.');
    }
}

async function handleResumoSticker(message) {
    const chat = await message.getChat();
    await chat.sendStateTyping();

    let quotedMessage = null;
    let linkToSummarize = null;

    if (message.hasQuotedMsg) {
        quotedMessage = await message.getQuotedMessage();
        const quotedText = quotedMessage.body;
        const links = extractLinks(quotedText);

        if (links.length > 0) {
            linkToSummarize = links[0];
        }
    }

    if (linkToSummarize) {
        try {
            const unshortenedLink = await unshortenLink(linkToSummarize);
            const pageContent = await getPageContent(unshortenedLink);
            const prompt = config.PROMPTS.LINK_SUMMARY.replace('{pageContent}', pageContent);
            const summary = await runCompletion(prompt, 1);
            
            await message.reply(summary);
        } catch (error) {
            await message.reply('Não consegui acessar o link para gerar um resumo.');
        }
    } else if (quotedMessage) {
        const prompt = config.PROMPTS.HOUR_SUMMARY
            .replace('{name}', 'User')
            .replace('{messageTexts}', quotedMessage.body);
        const result = await runCompletion(prompt, 1);
        await message.reply(result.trim());
    } else {
        const messages = await chat.fetchMessages({ limit: 1000 });
        const threeHoursAgo = Date.now() - 3 * 3600 * 1000;
        const messagesLastThreeHours = messages.filter(m => m.timestamp * 1000 > threeHoursAgo && !m.fromMe && m.body.trim() !== '');

        if (messagesLastThreeHours.length === 0) {
            await message.reply('Não há mensagens suficientes para gerar um resumo.');
            return;
        }

        const messageTexts = await Promise.all(messagesLastThreeHours.map(async msg => {
            const contact = await msg.getContact();
            const name = contact.name || 'Unknown';
            return `>>${name}: ${msg.body}.\n`;
        }));

        const contact = await message.getContact();
        const name = contact.name || 'Unknown';
        const prompt = config.PROMPTS.HOUR_SUMMARY
            .replace('{name}', name)
            .replace('{messageTexts}', messageTexts.join(' '));
        const result = await runCompletion(prompt, 1);
        await message.reply(result.trim());
    }
}

async function handleAyubNewsSticker(message) {
    console.log('handleAyubNewsSticker activated');
    const chat = await message.getChat();
    await chat.sendStateTyping();

    try {
        const news = await scrapeNews();
        if (news.length === 0) {
            message.reply('Não há notícias disponíveis no momento.')
                .then(sentMessage => deleteMessageAfterTimeout(sentMessage, true))
                .catch(error => console.error('Failed to send message:', error));
            return;
        }

        const translatedNews = await translateToPortuguese(news);
        const contact = await message.getContact();
        const name = contact.name || 'Unknown';
        let reply = `Aqui estão as notícias mais relevantes de hoje, ${name}:\n\n`;
        translatedNews.forEach((newsItem, index) => {
            reply += `${index + 1}. ${newsItem}\n`;
        });

        message.reply(reply)
            .then(sentMessage => deleteMessageAfterTimeout(sentMessage, true))
            .catch(error => console.error('Failed to send message:', error));
    } catch (error) {
        console.error('Error accessing news:', error);
        message.reply('Não consegui acessar as notícias de hoje.')
            .then(sentMessage => deleteMessageAfterTimeout(sentMessage, true))
            .catch(error => console.error('Failed to send message:', error));
    }
}

async function handleAyubNewsFut(message) {
    console.log('handleAyubNewsFut activated');
    const chat = await message.getChat();
    await chat.sendStateTyping();

    try {
        const news = await scrapeNews2();
        if (news.length > 0) {
            const contact = await message.getContact();
            const name = contact.name || 'Unknown';
            let reply = `Aqui estão as notícias de futebol mais relevantes de hoje, ${name}:\n\n`;
            news.forEach((newsItem, index) => {
                reply += `${index + 1}. ${newsItem.title}\n`;
            });

            message.reply(reply)
                .then(sentMessage => deleteMessageAfterTimeout(sentMessage, true))
                .catch(error => console.error('Failed to send message:', error));
        } else {
            message.reply('Nenhum artigo de futebol encontrado.')
                .then(sentMessage => deleteMessageAfterTimeout(sentMessage, true))
                .catch(error => console.error('Failed to send message:', error));
        }
    } catch (error) {
        console.error('Error accessing football news:', error);
        message.reply('Erro ao buscar artigos de futebol.')
            .then(sentMessage => deleteMessageAfterTimeout(sentMessage, true))
            .catch(error => console.error('Failed to send message:', error));
    }
}

async function handleAyubNewsSearch(message, input) {
    console.log('handleAyubNewsSearch activated');
    const chat = await message.getChat();
    await chat.sendStateTyping();

    const keywords = input.slice(1).join(' ');
    const query = encodeURIComponent(keywords);
    const searchUrl = `https://news.google.com/rss/search?q=${query}&hl=pt-BR&gl=BR&ceid=BR:pt-419&sort=date&dedupe=1`;

    try {
        const response = await axios.get(searchUrl);
        const xmlString = response.data;

        const newsData = parseXML(xmlString).slice(0, 5);

        if (newsData.length > 0) {
            const contact = await message.getContact();
            const name = contact.name || 'Unknown';
            let reply = `Aqui estão os artigos mais recentes e relevantes sobre "${keywords}", ${name}:\n\n`;
            newsData.forEach((item, index) => {
                reply += `${index + 1}. *${item.title}*\nFonte: ${item.source}\nData: ${getRelativeTime(new Date(item.pubDate))}\n\n`;
            });
            await message.reply(reply);
        } else {
            await message.reply(`Nenhum artigo encontrado para "${keywords}".`);
        }
    } catch (error) {
        console.error('An error occurred:', error);
        await message.reply('Erro ao buscar artigos. Por favor, tente novamente mais tarde.');
    }
}

async function handleDesenhoCommand(message, input) {
    console.log('handleDesenhoCommand activated');
    const chat = await message.getChat();
    await chat.sendStateTyping();

    const prompt = input.slice(1).join(' ');
    if (!prompt) {
        message.reply('Por favor, forneça uma descrição após #desenho.')
            .catch(error => console.error('Failed to send message:', error));
        return;
    }

    try {
        const imageUrl = await generateImage(prompt);
        if (imageUrl) {
            const media = await MessageMedia.fromUrl(imageUrl);
            await message.reply(media);
        } else {
            message.reply('Não foi possível gerar a imagem. Tente novamente.')
                .catch(error => console.error('Failed to send message:', error));
        }
    } catch (error) {
        console.error('Error in handleDesenhoCommand:', error);
        message.reply('Ocorreu um erro ao gerar a imagem. Tente novamente mais tarde.')
            .catch(error => console.error('Failed to send message:', error));
    }
}

module.exports = {
    handleResumoCommand,
    handleStickerMessage,
    handleAyubNewsCommand,
    handleAyubLinkSummary,
    handleHashTagCommand,
    handleCommandList,
    handleStickerCreation,
    deleteMessageAfterTimeout,
    handleCacheClearCommand,
    handleResumoSticker,
    handleAyubNewsSticker,
    handleAyubNewsFut,
    handleAyubNewsSearch,
    handleDesenhoCommand
};
