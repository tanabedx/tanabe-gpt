// desenho.config.js
// Configuration for the desenho command
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

module.exports = DESENHO_CONFIG;
