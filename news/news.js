const config = require('../configs/config');
const logger = require('../utils/logger');
const { handleAutoDelete } = require('../utils/messageUtils');
const { runCompletion } = require('../utils/openaiUtils');
const { extractLinks, unshortenLink, getPageContent } = require('../utils/linkUtils');
const {
    scrapeNews,
    searchNews,
    translateToPortuguese,
    scrapeNews2,
} = require('./newsUtils');
const RESUMO = require('../resumos/resumo.prompt');

// Get group and member names from environment variables
const GROUP_LF = process.env.GROUP_LF;
const MEMBER_LF10 = process.env.MEMBER_LF10;

async function processLinkSummary(message) {
    logger.debug('processLinkSummary activated');
    const chat = await message.getChat();
    const contact = await message.getContact();

    // Get admin number from config
    const adminNumber = config.CREDENTIALS.ADMIN_NUMBER;
    const contactNumber = contact.id.user; // This gets just the number without @c.us

    // Check conditions:
    // 1. Admin's links are only summarized in admin DM chat
    // 2. Ayub's links are only summarized in 'GROUP_LF' group
    const isAdminInDM = contactNumber === adminNumber && chat.isGroup === false;
    const isAyubInTargetGroup = chat.name === GROUP_LF && contact.name === MEMBER_LF10;

    logger.debug('Link summary check', {
        isAdminInDM,
        isAyubInTargetGroup,
        chatName: chat.name,
        contactName: contact.name,
        contactId: contact.id._serialized,
        contactNumber,
        adminNumber,
        isGroup: chat.isGroup,
        messageBody: message.body,
    });

    if (!isAdminInDM && !isAyubInTargetGroup) {
        logger.debug('Message does not meet criteria for auto-summary, skipping');
        return;
    }

    const links = extractLinks(message.body);
    if (!links || links.length === 0) {
        logger.debug('No links found in message');
        return;
    }

    logger.info(
        `Processing link summary for ${isAdminInDM ? 'admin in DM' : 'Ayub in target group'}`
    );
    const link = links[0];
    try {
        logger.debug(`Unshortening link: ${link}`);
        const unshortenedLink = await unshortenLink(link);
        logger.debug(`Getting content from: ${unshortenedLink}`);
        let pageContent = await getPageContent(unshortenedLink);

        const charLimit = config.LINK_SUMMARY_CHAR_LIMIT || 3000;
        if (pageContent.length > charLimit) {
            logger.debug(
                `Content length ${pageContent.length} exceeds limit ${charLimit}, truncating`
            );
            pageContent = pageContent.substring(0, charLimit);
        }

        logger.debug('Generating summary with ChatGPT');
        const prompt = RESUMO.LINK_SUMMARY.replace('{pageContent}', pageContent);
        const summary = await runCompletion(prompt, 1);

        if (!summary || summary.trim().length === 0) {
            logger.error('Received empty summary from ChatGPT');
            const errorMessage = await message.reply('Não consegui gerar um resumo do conteúdo.');
            await handleAutoDelete(errorMessage, true);
            return;
        }

        logger.debug('Sending summary response');
        const sentMessage = await message.reply(summary);
        if (summary.trim() === 'Não consegui acessar o link para gerar um resumo.') {
            await handleAutoDelete(sentMessage, true);
        }
    } catch (error) {
        logger.error(`Error accessing link to generate summary:`, error);
        const errorMessage = await message.reply(
            `Não consegui acessar o link ${link} para gerar um resumo.`
        );
        await handleAutoDelete(errorMessage, true);
        logger.error(`Link summary error: ${error.message}`);
    }
}

async function processNewsSticker(message, command) {
    try {
        const news = await scrapeNews();
        if (!news || news.length === 0) {
            const errorMessage = await message.reply(command.errorMessages.noArticles);
            await handleAutoDelete(errorMessage, command, true);
            return;
        }

        const translatedNews = await translateToPortuguese(news);
        if (!translatedNews || translatedNews.length === 0) {
            const errorMessage = await message.reply(command.errorMessages.error);
            await handleAutoDelete(errorMessage, command, true);
            return;
        }

        const contact = await message.getContact();
        const name =  contact.name || contact.pushname || 'Unknown';
        let reply = `Aqui estão as notícias mais relevantes de hoje, ${name}:\n\n`;
        translatedNews.forEach((newsItem, index) => {
            reply += `${index + 1}. ${newsItem}\n`;
        });

        const response = await message.reply(reply);
        await handleAutoDelete(response, command);
    } catch (error) {
        logger.error('[ERROR] Error in processNewsSticker:', error.message);
        const errorMessage = await message.reply(command.errorMessages.error);
        await handleAutoDelete(errorMessage, command, true);
    }
}

async function processNewsSearch(message, command, searchTerm) {
    try {
        if (!searchTerm) {
            const errorMessage = await message.reply(command.errorMessages.noArticles);
            await handleAutoDelete(errorMessage, command, true);
            return;
        }

        const news = await searchNews(searchTerm);

        if (!news || news.length === 0) {
            const errorMessage = await message.reply(command.errorMessages.noArticles);
            await handleAutoDelete(errorMessage, command, true);
            return;
        }

        const translatedNews = await translateToPortuguese(news);
        if (!translatedNews || translatedNews.length === 0) {
            const errorMessage = await message.reply(command.errorMessages.error);
            await handleAutoDelete(errorMessage, command, true);
            return;
        }

        const contact = await message.getContact();
        const name = contact.name || contact.pushname || 'Unknown';
        let reply = `Aqui estão as notícias sobre "${searchTerm}", ${name}:\n\n`;
        translatedNews.forEach((newsItem, index) => {
            reply += `${index + 1}. ${newsItem}\n`;
        });

        const response = await message.reply(reply);
        await handleAutoDelete(response, command);
    } catch (error) {
        logger.error('[ERROR] Error in processNewsSearch:', error.message);
        const errorMessage = await message.reply(command.errorMessages.error);
        await handleAutoDelete(errorMessage, command, true);
    }
}

// Handle football news
async function processNewsFut(msg) {
    try {
        logger.debug('Handling football news command');
        const news = await scrapeNews2();

        if (news.length === 0) {
            await msg.reply('Não foi possível encontrar notícias de futebol no momento.');
            return;
        }

        let reply = '*🏆 Últimas Notícias de Futebol 🏆*\n\n';

        news.forEach((item, index) => {
            reply += `*${index + 1}. ${item.title}*\n`;
            if (item.summary) {
                reply += `${item.summary}\n`;
            }
            reply += `${item.link}\n\n`;
        });

        await msg.reply(reply);
        logger.debug('Football news sent successfully');
    } catch (error) {
        logger.error('Error handling football news command:', error);
        await msg.reply('Ocorreu um erro ao buscar notícias de futebol.');
    }
}

const handleNews = async (message, command, input) => {
    try {
        logger.debug('Handling NEWS command', { input });

        // Special case for football news
        if (input && input.trim().toLowerCase() === 'fut') {
            logger.debug('Detected football news command');
            return await processNewsFut(message);
        }

        // If there's input, it's a search query
        if (input && input.trim()) {
            return await processNewsSearch(message, command, input.trim());
        }

        // If there's a quoted message with a link, summarize it
        if (message.hasQuotedMsg) {
            const quotedMsg = await message.getQuotedMessage();
            if (quotedMsg.body && extractLinks(quotedMsg.body).length > 0) {
                return await processLinkSummary(quotedMsg);
            }
        }

        // If the message itself has a link, summarize it
        if (message.body && extractLinks(message.body).length > 0) {
            return await processLinkSummary(message);
        }

        // Otherwise, get the latest news
        return await processNewsSticker(message, command);
    } catch (error) {
        logger.error('Error in handleNews:', error);
        await message.reply('Ocorreu um erro ao processar o comando. Por favor, tente novamente.');
    }
};

module.exports = {
    handleNews,
    processLinkSummary,
    processNewsSticker,
    processNewsSearch,
    processNewsFut,
};
