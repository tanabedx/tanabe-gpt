const logger = require('../utils/logger');
const { handleAutoDelete, sendStreamingResponse } = require('../utils/messageUtils');
const { transcribeAudio } = require('./audioUtils');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

async function handleAudio(message, command) {
    let audioPath = null;
    try {
        let targetMessage = message;

        // If message has quoted message, check if it's an audio
        if (message.hasQuotedMsg) {
            const quotedMsg = await message.getQuotedMessage();
            if (['audio', 'ptt'].includes(quotedMsg.type) && quotedMsg.hasMedia) {
                targetMessage = quotedMsg;
            }
        }

        // Check if target message has media and is audio/voice
        if (!targetMessage.hasMedia || !['audio', 'ptt'].includes(targetMessage.type)) {
            logger.debug('Invalid audio message type', { type: targetMessage.type });
            const errorMessage = await message.reply(command.errorMessages.invalidFormat);
            await handleAutoDelete(errorMessage, command, true);
            return;
        }

        // Download the audio
        const media = await targetMessage.downloadMedia();
        if (!media || !media.data) {
            logger.error('Failed to download audio');
            const errorMessage = await message.reply(command.errorMessages.downloadError);
            await handleAutoDelete(errorMessage, command, true);
            return;
        }

        logger.debug('Audio media info:', {
            mimetype: media.mimetype,
            filename: media.filename,
        });

        // Save audio to temporary file in parent directory
        const randomName = crypto.randomBytes(16).toString('hex');
        audioPath = path.join(__dirname, '..', `${randomName}.ogg`);

        // Write audio data to file
        fs.writeFileSync(audioPath, Buffer.from(media.data, 'base64'));

        logger.debug('Saved audio file:', { path: audioPath });

        // Get transcription using Whisper
        const transcription = await transcribeAudio(audioPath);
        if (!transcription) {
            logger.error('Empty transcription received');
            const errorMessage = await message.reply(command.errorMessages.transcriptionError);
            await handleAutoDelete(errorMessage, command, true);
            return;
        }

        // Send the transcription with formatting using streaming response
        const formattedResponse = `Transcrição:\n_${transcription}_`;
        await sendStreamingResponse(message, formattedResponse, command, '🤖', 60, 120, 25);
    } catch (error) {
        logger.error('Error in AUDIO command:', error, {
            mediaType: message.type,
            hasMedia: message.hasMedia,
        });
        const errorMessage = await message.reply(command.errorMessages.error);
        await handleAutoDelete(errorMessage, command, true);
    } finally {
        // Clean up temp file
        if (audioPath && fs.existsSync(audioPath)) {
            fs.unlinkSync(audioPath);
            logger.debug('Cleaned up audio file:', { path: audioPath });
        }
    }
}

module.exports = {
    handleAudio,
};
