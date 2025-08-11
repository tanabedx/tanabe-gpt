const axios = require('axios');
const fs = require('fs');
const path = require('path');
const FormData = require('form-data');
const config = require('../configs/config');
const logger = require('../utils/logger');
const { runCompletion, getOpenAIClient } = require('../utils/openaiUtils');
const DESENHO = require('./desenho.prompt');

async function generateImage(prompt, cfg_scale = 7) {
    try {
        logger.debug('Generating image with GetImg.ai', { promptLength: prompt.length });
        const response = await axios.post(
            'https://api.getimg.ai/v1/essential-v2/text-to-image',
            {
                prompt: prompt,
                style: 'photorealism',
                aspect_ratio: '1:1',
                output_format: 'png',
                cfg_scale: cfg_scale,
            },
            {
                headers: {
                    Authorization: `Bearer ${config.CREDENTIALS.GETIMG_AI_API_KEY}`,
                    'Content-Type': 'application/json',
                },
            }
        );

        if (response.data && response.data.image) {
            logger.debug('Successfully generated image');
            return response.data.image;
        }

        logger.error('No image data in response', response.data);
        return null;
    } catch (error) {
        logger.error(
            'Error generating image:',
            error.response ? error.response.data : error.message
        );
        return null;
    }
}

async function improvePrompt(prompt) {
    try {
        const promptTemplate = DESENHO.IMPROVE_PROMPT.replace('{prompt}', prompt);
        return await runCompletion(promptTemplate, 0.7);
    } catch (error) {
        logger.error('Error improving prompt:', error);
        throw error;
    }
}



module.exports = {
    generateImage,
    improvePrompt,
};

/**
 * Classify whether a user request asks to depict a public figure.
 * Uses gpt-5-nano and expects a strict YES or NO output.
 * @param {string} promptText
 * @returns {Promise<boolean>} true if public figure; false otherwise
 */
async function classifyPublicFigureRequest(promptText) {
    try {
        const classifierPrompt = `Task: Determine if the requested image depicts a public figure (politician, celebrity, notable influencer, or widely recognized person).\n\nUser request: "${promptText}"\n\nRespond with exactly one word: YES or NO.`;
        // Force LOW tier model (gpt-5-nano) via explicit model
        const result = await runCompletion(classifierPrompt, 1, 'gpt-5-nano');
        const answer = String(result || '').trim().toUpperCase();
        return answer.startsWith('Y');
    } catch (error) {
        logger.error('Error classifying public figure request:', error);
        // Conservative default: not a public figure to reduce GetImg usage
        return false;
    }
}

/**
 * Generate an image using OpenAI Images API (gpt-image-1).
 * @param {string} prompt
 * @param {object} options
 * @returns {Promise<string|null>} Base64 PNG
 */
async function generateImageWithOpenAI(prompt, options = {}) {
    try {
        const openai = getOpenAIClient();
        const size = options.size || '1024x1024';
        const resp = await openai.images.generate({
            model: 'dall-e-3',
            prompt,
            size,
            quality: 'standard',
            response_format: 'b64_json',
        });
        
        logger.debug('OpenAI images.generate response structure:', {
            hasData: !!resp?.data,
            dataLength: resp?.data?.length,
            firstItem: resp?.data?.[0] ? Object.keys(resp.data[0]) : 'no first item'
        });
        
        const b64 = resp?.data?.[0]?.b64_json;
        if (b64) return b64;
        
        // Fallback: try URL format and convert to base64
        const url = resp?.data?.[0]?.url;
        if (url) {
            logger.debug('Got URL instead of base64, downloading and converting');
            const imgResp = await axios.get(url, { responseType: 'arraybuffer' });
            return Buffer.from(imgResp.data, 'binary').toString('base64');
        }
        
        logger.error('No base64 image or URL in OpenAI images.generate response', resp?.data);
        return null;
    } catch (error) {
        logger.error('Error generating image with OpenAI:', error);
        return null;
    }
}

/**
 * Edit an image using OpenAI Images API (gpt-image-1). No mask support in V1.
 * @param {string} imageBase64 - Base64 image data without data URI prefix
 * @param {string} prompt - Enhanced instruction
 * @param {object} options
 * @returns {Promise<string|null>} Base64 PNG
 */
async function editImageWithOpenAI(imageBase64, prompt, options = {}) {
    const tempDir = path.join(__dirname, '..', 'tmp');
    const tempPath = path.join(tempDir, `desenho_edit_${Date.now()}.png`);
    try {
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
        }
        // Write image to temp file
        const buffer = Buffer.from(imageBase64, 'base64');
        fs.writeFileSync(tempPath, buffer);

        const form = new FormData();
        form.append('model', 'gpt-image-1');
        form.append('prompt', prompt);
        // Note: OpenAI Images edits API may not support size/style parameters
        form.append('image', fs.createReadStream(tempPath), {
            filename: 'image.png',
            contentType: 'image/png',
        });

        const resp = await axios.post('https://api.openai.com/v1/images/edits', form, {
            headers: {
                Authorization: `Bearer ${config.CREDENTIALS.OPENAI_API_KEY}`,
                ...form.getHeaders(),
            },
            maxContentLength: Infinity,
            maxBodyLength: Infinity,
            timeout: 120000,
        });
        const b64 = resp?.data?.data?.[0]?.b64_json;
        if (b64) return b64;
        logger.error('No base64 image in OpenAI images/edits response');
        return null;
    } catch (error) {
        logger.error('Error editing image with OpenAI (REST images/edits):', {
            message: error.message,
            status: error.response?.status,
            statusText: error.response?.statusText,
            data: error.response?.data,
            url: error.config?.url,
            method: error.config?.method
        });
        return null;
    } finally {
        try { fs.unlinkSync(tempPath); } catch (_) {}
    }
}

module.exports.classifyPublicFigureRequest = classifyPublicFigureRequest;
module.exports.generateImageWithOpenAI = generateImageWithOpenAI;
module.exports.editImageWithOpenAI = editImageWithOpenAI;
