// admin.config.js
// Configuration for admin commands

// Cache clear command
const CACHE_CLEAR_CONFIG = {
    prefixes: ['!cacheclear', '!clearcache'],
    description: 'Limpa o cache do bot (apenas admin)',
    permissions: {
        allowedIn: 'all',
        adminOnly: true,
    },
    autoDelete: {
        errorMessages: true,
        commandMessages: false,
        deleteTimeout: 60000,
    },
    errorMessages: {
        notAllowed: 'Você não tem permissão para usar este comando.',
        error: 'Erro ao limpar o cache.',
    },
};

// Twitter debug command
const TWITTER_DEBUG_CONFIG = {
    prefixes: ['!twitterdebug', '!debugtwitter'],
    description: 'Mostra informações de debug do Twitter (apenas admin)',
    permissions: {
        allowedIn: 'all',
        adminOnly: true,
    },
    autoDelete: {
        errorMessages: true,
        commandMessages: false,
        deleteTimeout: 60000,
    },
    errorMessages: {
        notAllowed: 'Você não tem permissão para usar este comando.',
        error: 'Erro ao obter informações de debug do Twitter.',
    },
};

// RSS debug command
const RSS_DEBUG_CONFIG = {
    prefixes: ['!rssdebug', '!debugrss'],
    description: 'Mostra informações de debug dos feeds RSS (apenas admin)',
    permissions: {
        allowedIn: 'all',
        adminOnly: true,
    },
    autoDelete: {
        errorMessages: true,
        commandMessages: false,
        deleteTimeout: 60000,
    },
    errorMessages: {
        notAllowed: 'Você não tem permissão para usar este comando.',
        error: 'Erro ao obter informações de debug dos feeds RSS.',
    },
};

// News Status command
const NEWS_STATUS_CONFIG = {
    prefixes: ['!newsstatus'],
    description: 'Mostra o status atual do monitoramento de notícias (apenas admin)',
    permissions: {
        allowedIn: 'all',
        adminOnly: true,
    },
    autoDelete: {
        errorMessages: true,
        commandMessages: false,
        deleteTimeout: 60000,
    },
    errorMessages: {
        notAllowed: 'Você não tem permissão para usar este comando.',
        error: 'Erro ao obter status do monitoramento de notícias.',
    },
};

// Force summary command
const DEBUG_PERIODIC_CONFIG = {
    prefixes: ['!debugperiodic', '!periodicdebug'],
    description: 'Gera resumos de todos os grupos e os envia para o admin (apenas admin)',
    permissions: {
        allowedIn: 'all',
        adminOnly: true,
    },
    autoDelete: {
        errorMessages: true,
        commandMessages: false,
        deleteTimeout: 60000,
    },
    errorMessages: {
        notAllowed: 'Você não tem permissão para usar este comando.',
        error: 'Erro ao gerar resumos de debug.',
    },
};

// Config command
const CONFIG_CONFIG = {
    prefixes: ['!config'],
    description: 'Configura opções do bot (apenas admin/moderadores)',
    permissions: {
        allowedIn: 'all',
        adminOnly: false,
    },
    autoDelete: {
        errorMessages: true,
        commandMessages: false,
        deleteTimeout: 60000,
    },
    errorMessages: {
        notAllowed: 'Você não tem permissão para usar este comando.',
        error: 'Erro ao configurar o bot.',
    },
};

module.exports = {
    CACHE_CLEAR_CONFIG,
    TWITTER_DEBUG_CONFIG,
    RSS_DEBUG_CONFIG,
    NEWS_STATUS_CONFIG,
    DEBUG_PERIODIC_CONFIG,
    CONFIG_CONFIG,
};
