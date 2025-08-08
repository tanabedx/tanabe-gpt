// news.config.js
// Configuration for the news commands
function getConfig() {
    // Lazy-load to avoid circular dependency during startup
    // eslint-disable-next-line global-require
    return require('../configs/config');
}

const RESUMO_PROMPT = require('../resumos/resumo.prompt');

// Main NEWS configuration
const NEWS_CONFIG = {
    prefixes: ['#news', '#noticias', '#notícias', '#ayubnews'],
    description:
        'Busca e resume notícias. Use #news para últimas notícias, #news [tema] para buscar sobre um assunto específico, ou envie o sticker de notícias. Links compartilhados são automaticamente resumidos.',
    stickerHash: '2ec460ac4810ace36065b5ef1fe279404ba812b04266ffb376a1c404dbdbd994',
    autoDelete: {
        errorMessages: true,
        commandMessages: false,
        deleteTimeout: 60000,
    },
    errorMessages: {
        noArticles: 'Nenhum artigo encontrado.',
        error: 'Erro ao buscar artigos. Por favor, tente novamente mais tarde.',
        notAllowed: 'Você não tem permissão para usar este comando.',
    },
    useGroupPersonality: true,
    get model() {
        const config = getConfig();
        return config?.SYSTEM?.AI_MODELS?.MEDIUM;
    },
    prompt: RESUMO_PROMPT,
};

module.exports = NEWS_CONFIG;
