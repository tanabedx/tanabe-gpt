const { handleAutoDelete } = require('../utils/messageUtils');
const { MessageMedia } = require('whatsapp-web.js');
const {
    generateImage,
    improvePrompt,
    classifyPublicFigureRequest,
    generateImageWithOpenAI,
    editImageWithOpenAI,
} = require('./desenhoUtils');
const logger = require('../utils/logger');

async function handleDesenho(message, command, input = []) {
    // Ensure input is an array
    const inputArray = Array.isArray(input) ? input : message.body.split(' ');
    const promptInput = inputArray.slice(1).join(' ');

    if (!promptInput) {
        const errorMessage = await message.reply(command.errorMessages.noPrompt);
        await handleAutoDelete(errorMessage, command, true);
        return;
    }

    try {
        // Route: public figure → GetImg, otherwise → OpenAI
        logger.debug('Classifying whether request depicts a public figure (gpt-5-nano)');
        const isPublicFigure = await classifyPublicFigureRequest(promptInput);
        
        logger.debug('Enhancing prompt for image generation');
        const improvedPrompt = await improvePrompt(promptInput);

        let imageBase64;
        if (isPublicFigure) {
            logger.debug('Public figure detected → using GetImg.ai text-to-image');
            imageBase64 = await generateImage(improvedPrompt);
        } else {
            logger.debug('Not a public figure → using OpenAI Images API');
            imageBase64 = await generateImageWithOpenAI(improvedPrompt, { size: '1024x1024' });
        }

        if (imageBase64) {
            const media = new MessageMedia('image/png', imageBase64, 'generated_image.png');
            logger.debug('Sending generated image');
            const response = await message.reply(media);
            await handleAutoDelete(response, command);
        } else {
            logger.error('Failed to generate image');
            const errorMessage = await message.reply(command.errorMessages.generateError);
            await handleAutoDelete(errorMessage, command, true);
        }
    } catch (error) {
        logger.error('Error in DESENHO command:', error);
        const errorMessage = await message.reply(command.errorMessages.generateError);
        await handleAutoDelete(errorMessage, command, true);
    }
}

module.exports = { handleDesenho };

// New handler: image editing
async function handleDesenhoEdit(message, command, input = []) {
    // Extrair instrução
    const inputArray = Array.isArray(input) ? input : message.body.split(' ');
    const instruction = inputArray.slice(1).join(' ').trim();

    if (!instruction) {
        const errorMessage = await message.reply(command.errorMessages.noInstruction);
        await handleAutoDelete(errorMessage, command, true);
        return;
    }

    // Locate image (current message or quoted message)
    let sourceMsg = message;
    if (!message.hasMedia && message.hasQuotedMsg) {
        try {
            const quoted = await message.getQuotedMessage();
            if (quoted?.hasMedia) sourceMsg = quoted;
        } catch (e) {
            // ignore, will fall through to no image check
        }
    }

    if (!sourceMsg.hasMedia) {
        const errorMessage = await message.reply(command.errorMessages.noImage);
        await handleAutoDelete(errorMessage, command, true);
        return;
    }

    try {
        logger.debug('Downloading media for editing');
        
        // Add timeout for media download to prevent hanging
        const downloadPromise = sourceMsg.downloadMedia();
        const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error('Media download timeout')), 30000); // 30 second timeout
        });
        
        const attachment = await Promise.race([downloadPromise, timeoutPromise]);
        
        if (!attachment || !attachment.data) {
            logger.warn('No attachment data received from media download');
            const errorMessage = await message.reply(command.errorMessages.noImage);
            await handleAutoDelete(errorMessage, command, true);
            return;
        }
        
        logger.debug('Media downloaded successfully, size:', attachment.data.length);

        // Remove data URI prefix if present
        const base64Image = attachment.data.includes('base64,')
            ? attachment.data.split('base64,')[1]
            : attachment.data;

        // Route: All edits → OpenAI Images API (no prompt enhancement for edits)
        logger.debug('Sending request to OpenAI Images API (image edit)');
        const editedBase64 = await editImageWithOpenAI(base64Image, instruction, {
            size: '1024x1024',
            style: 'vivid',
        });

        if (!editedBase64) {
            const errorMessage = await message.reply(command.errorMessages.editError);
            await handleAutoDelete(errorMessage, command, true);
            return;
        }

        const media = new MessageMedia('image/png', editedBase64, 'edited_image.png');
        logger.debug('Sending edited image');
        const response = await message.reply(media);
        await handleAutoDelete(response, command);
    } catch (error) {
        if (error.message === 'Media download timeout') {
            logger.error('Media download timed out after 30 seconds');
            const errorMessage = await message.reply('❌ Tempo limite excedido ao baixar a imagem. Tente novamente com uma imagem menor.');
            await handleAutoDelete(errorMessage, command, true);
        } else {
            logger.error('Error in DESENHO_EDIT command:', error);
            const errorMessage = await message.reply(command.errorMessages.editError);
            await handleAutoDelete(errorMessage, command, true);
        }
    }
}

module.exports.handleDesenhoEdit = handleDesenhoEdit;
