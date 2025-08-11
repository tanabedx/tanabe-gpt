// desenho.config.js
// Configuration for the desenho commands
function getConfig() {
    // Lazy-load to avoid circular dependency during startup
    // eslint-disable-next-line global-require
    return require('../configs/config');
}

const DESENHO_PROMPT = require('./desenho.prompt');

const DESENHO_CONFIG = {
    prefixes: ['#desenho'],
    description:
        'Gera imagens com IA. Use #desenho [descrição] para criar uma imagem. A descrição é aprimorada automaticamente para gerar melhores resultados.',
    autoDelete: {
        errorMessages: true,
        commandMessages: false,
        deleteTimeout: 60000,
    },
    errorMessages: {
        noPrompt: 'Por favor, forneça uma descrição após #desenho.',
        generateError: 'Não foi possível gerar as imagens. Tente novamente.',
        notAllowed: 'Você não tem permissão para usar este comando.',
    },
    useGroupPersonality: false,
    get model() {
        const config = getConfig();
        return config?.SYSTEM?.AI_MODELS?.HIGH;
    },
    prompt: DESENHO_PROMPT,
};

// New command: image editing from an attached or quoted image
const DESENHO_EDIT_CONFIG = {
    prefixes: ['#desenhoedit'],
    description:
        'Edit images with AI. Use #desenhoedit [instruction] with an attached image or replying to an image. The instruction is prioritized and automatically enhanced.',
    autoDelete: {
        errorMessages: true,
        commandMessages: false,
        deleteTimeout: 60000,
    },
    errorMessages: {
        noImage: 'Envie uma imagem ou responda a uma imagem com #desenhoedit.',
        noInstruction: 'Forneça uma instrução após #desenhoedit.',
        editError: 'Não foi possível editar a imagem. Tente novamente.',
        notAllowed: 'Você não tem permissão para usar este comando.',
    },
    useGroupPersonality: false,
    get model() {
        const config = getConfig();
        return config?.SYSTEM?.AI_MODELS?.HIGH;
    },
    prompt: DESENHO_PROMPT,
};

// Export in multi-config format for automatic discovery as per CORE.md
module.exports = {
    DESENHO_CONFIG,
    DESENHO_EDIT_CONFIG,
};
