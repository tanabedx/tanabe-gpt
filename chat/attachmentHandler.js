const logger = require('../utils/logger');
const { extractTextFromImageWithOpenAI } = require('../utils/openaiUtils');
const { downloadAndProcessDocument } = require('../resumos/documentUtils');
const { MessageMedia } = require('whatsapp-web.js');
const fs = require('fs');
const path = require('path');

/**
 * Process attachments from WhatsApp messages for ChatGPT analysis
 * Supports: Images (analysis, OCR), PDFs (text extraction), Audio (transcription)
 * @param {Object} message - WhatsApp message object
 * @param {Object} config - Configuration object
 * @returns {Promise<Object>} Processed attachment data
 */
async function processAttachments(message, config) {
    try {
        const attachmentData = {
            hasAttachments: false,
            images: [],
            pdfs: [],
            audio: [],
            other: [],
            textContent: '',
            summary: ''
        };

        // Check if message has media
        if (!message.hasMedia) {
            return attachmentData;
        }

        logger.debug('Processing message attachment for ChatGPT analysis');

        // Download the media
        const media = await message.downloadMedia();
        if (!media) {
            logger.warn('Failed to download media attachment');
            return attachmentData;
        }

        attachmentData.hasAttachments = true;
        const mimeType = media.mimetype;
        const fileSize = Buffer.byteLength(media.data, 'base64');

        logger.debug('Attachment details', {
            mimeType: mimeType,
            fileSize: `${Math.round(fileSize / 1024)}KB`,
            filename: media.filename || 'unknown'
        });

        // Process based on media type
        if (mimeType.startsWith('image/')) {
            const imageResult = await processImage(media, config);
            attachmentData.images.push(imageResult);
            if (imageResult.textContent) {
                attachmentData.textContent += `\n[Texto extraído da imagem]: ${imageResult.textContent}`;
            }
            if (imageResult.description) {
                attachmentData.textContent += `\n[Descrição da imagem]: ${imageResult.description}`;
            }
        } else if (mimeType === 'application/pdf' || mimeType.includes('document') || mimeType === 'text/plain') {
            const documentResult = await processDocument(media, config);
            attachmentData.pdfs.push(documentResult);
            if (documentResult.textContent) {
                attachmentData.textContent += `\n[Conteúdo do documento]: ${documentResult.textContent}`;
            }
        } else if (mimeType.startsWith('audio/')) {
            const audioResult = await processAudio(media, config);
            attachmentData.audio.push(audioResult);
            if (audioResult.transcription) {
                attachmentData.textContent += `\n[Transcrição do áudio]: ${audioResult.transcription}`;
            }
        } else {
            // Handle other file types
            attachmentData.other.push({
                mimeType: mimeType,
                filename: media.filename || 'unknown',
                size: fileSize,
                message: 'Tipo de arquivo não suportado para análise automática'
            });
            attachmentData.textContent += `\n[Arquivo anexado]: ${media.filename || 'Arquivo'} (${mimeType})`;
        }

        // Generate summary
        attachmentData.summary = generateAttachmentSummary(attachmentData);

        logger.debug('Attachment processing completed', {
            hasContent: !!attachmentData.textContent,
            contentLength: attachmentData.textContent.length,
            imageCount: attachmentData.images.length,
            pdfCount: attachmentData.pdfs.length,
            audioCount: attachmentData.audio.length
        });

        return attachmentData;

    } catch (error) {
        logger.error('Error processing attachments:', error);
        return {
            hasAttachments: false,
            images: [],
            pdfs: [],
            audio: [],
            other: [],
            textContent: '',
            summary: '',
            error: error.message
        };
    }
}

/**
 * Process image attachment - extract text and describe content
 * @param {MessageMedia} media - Image media object
 * @param {Object} config - Configuration object
 * @returns {Promise<Object>} Image processing result
 */
async function processImage(media, config) {
    try {
        logger.debug('Processing image attachment');

        const result = {
            type: 'image',
            mimeType: media.mimetype,
            filename: media.filename || 'image',
            textContent: '',
            description: '',
            imageData: media.data, // Store for potential editing
            processed: true
        };

        // Store image data for ChatGPT to analyze directly (gpt-5 supports image input)
        result.description = '[Imagem anexada para análise pelo ChatGPT]';
        result.textContent = '[Imagem será analisada diretamente pelo ChatGPT]';
        
        logger.debug('Image prepared for direct ChatGPT analysis', {
            mimeType: media.mimetype,
            hasImageData: !!media.data
        });

        return result;

    } catch (error) {
        logger.error('Error processing image:', error);
        return {
            type: 'image',
            mimeType: media.mimetype,
            filename: media.filename || 'image',
            textContent: '',
            description: '',
            imageData: media.data,
            processed: false,
            error: error.message
        };
    }
}

/**
 * Process document attachment - extract text content using existing resumo functionality
 * @param {MessageMedia} media - Document media object
 * @param {Object} config - Configuration object
 * @returns {Promise<Object>} Document processing result
 */
async function processDocument(media, config) {
    try {
        logger.debug('Processing document attachment using resumo functionality');

        const result = {
            type: 'document',
            mimeType: media.mimetype,
            filename: media.filename || 'document',
            textContent: '',
            processed: true
        };

        // Create a temporary message-like object for the documentUtils function
        const tempMessage = {
            downloadMedia: async () => media,
            hasMedia: true,
            type: 'document'
        };

        // Use existing resumo document processing
        const extractedText = await downloadAndProcessDocument(tempMessage);
        result.textContent = extractedText;

        logger.debug('Extracted text from document', {
            textLength: result.textContent.length,
            filename: result.filename
        });

        return result;

    } catch (error) {
        logger.error('Error processing document:', error);
        return {
            type: 'document',
            mimeType: media.mimetype,
            filename: media.filename || 'document',
            textContent: '',
            processed: false,
            error: error.message
        };
    }
}

/**
 * Process audio attachment - transcribe to text
 * @param {MessageMedia} media - Audio media object
 * @param {Object} config - Configuration object
 * @returns {Promise<Object>} Audio processing result
 */
async function processAudio(media, config) {
    const tempDir = path.join(__dirname, '..', 'tmp');
    // WhatsApp commonly sends audio as OGG, so default to that if MIME type is unclear
    let extension = getFileExtension(media.mimetype);
    if (extension === 'audio' || !extension) {
        extension = 'ogg'; // Default to OGG for WhatsApp audio
    }
    const tempPath = path.join(tempDir, `audio_${Date.now()}.${extension}`);
    
    try {
        logger.debug('Processing audio attachment', {
            mimeType: media.mimetype,
            extension: extension,
            filename: media.filename
        });

        const result = {
            type: 'audio',
            mimeType: media.mimetype,
            filename: media.filename || 'audio',
            transcription: '',
            duration: 0,
            processed: true
        };

        // Ensure temp directory exists
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
        }

        // Write audio to temporary file
        const buffer = Buffer.from(media.data, 'base64');
        fs.writeFileSync(tempPath, buffer);

        // Use OpenAI Whisper for transcription
        const openai = require('../utils/openaiUtils').getOpenAIClient();
        
        const transcriptionResponse = await openai.audio.transcriptions.create({
            file: fs.createReadStream(tempPath),
            model: 'whisper-1',
            language: 'pt', // Portuguese
            response_format: 'text'
        });

        result.transcription = transcriptionResponse;

        logger.debug('Transcribed audio', {
            transcriptionLength: result.transcription.length
        });

        return result;

    } catch (error) {
        logger.error('Error processing audio:', error);
        return {
            type: 'audio',
            mimeType: media.mimetype,
            filename: media.filename || 'audio',
            transcription: '',
            duration: 0,
            processed: false,
            error: error.message
        };
    } finally {
        // Cleanup temporary file
        if (fs.existsSync(tempPath)) {
            try {
                fs.unlinkSync(tempPath);
            } catch (cleanupError) {
                logger.warn('Failed to cleanup audio temp file:', cleanupError.message);
            }
        }
    }
}

/**
 * Generate a summary of processed attachments
 * @param {Object} attachmentData - Processed attachment data
 * @returns {string} Summary text
 */
function generateAttachmentSummary(attachmentData) {
    const parts = [];
    
    if (attachmentData.images.length > 0) {
        parts.push(`${attachmentData.images.length} imagem(ns)`);
    }
    
    if (attachmentData.pdfs.length > 0) {
        parts.push(`${attachmentData.pdfs.length} documento(s)`);
    }
    
    if (attachmentData.audio.length > 0) {
        parts.push(`${attachmentData.audio.length} áudio(s)`);
    }
    
    if (attachmentData.other.length > 0) {
        parts.push(`${attachmentData.other.length} outro(s) arquivo(s)`);
    }

    if (parts.length === 0) {
        return 'Nenhum anexo processado';
    }

    return `Anexos processados: ${parts.join(', ')}`;
}

/**
 * Get file extension from MIME type
 * @param {string} mimeType - MIME type
 * @returns {string} File extension
 */
function getFileExtension(mimeType) {
    const mimeToExt = {
        'audio/mpeg': 'mp3',
        'audio/mp3': 'mp3',
        'audio/wav': 'wav',
        'audio/ogg': 'ogg',
        'audio/ogg; codecs=opus': 'ogg',
        'audio/opus': 'ogg',
        'audio/m4a': 'm4a',
        'audio/mp4': 'm4a',
        'audio/aac': 'aac',
        'audio/webm': 'webm',
        'audio/x-wav': 'wav'
    };
    
    return mimeToExt[mimeType] || 'audio';
}

/**
 * Create attachment context for ChatGPT system prompt
 * @param {Object} attachmentData - Processed attachment data
 * @returns {string} Formatted context for ChatGPT
 */
function createAttachmentContext(attachmentData) {
    if (!attachmentData.hasAttachments || !attachmentData.textContent) {
        return '';
    }

    return `\n\nANEXOS DA MENSAGEM:\n${attachmentData.summary}\n${attachmentData.textContent}`;
}

module.exports = {
    processAttachments,
    createAttachmentContext,
    processImage,
    processDocument,
    processAudio,
    generateAttachmentSummary
};
