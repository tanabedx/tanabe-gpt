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

// News toggle command (enable/disable whole news system)
const NEWS_TOGGLE_CONFIG = {
    prefixes: ['!news'],
    description: 'Ativa ou desativa todo o sistema de monitoramento de notícias (apenas admin)',
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
        error: 'Erro ao alterar o status do monitoramento de notícias.',
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

// Add new cache reset config
const CACHE_RESET_CONFIG = {
    prefixes: ['!cachereset', '!resetcache'],
    description: 'Reseta o cache de notícias para um estado vazio (apenas admin)',
    errorMessages: {
        generalError: 'Ocorreu um erro ao resetar o cache de notícias.',
    },
    autoDelete: {
        commandMessages: false,
        errorMessages: false,
    },
    permissions: {
        allowedIn: 'all',
        adminOnly: true,
    },
};

// Add cache stats config
const CACHE_STATS_CONFIG = {
    prefixes: ['!cachestats', '!cacheinfo'],
    description: 'Mostra estatísticas do cache de notícias (apenas admin)',
    errorMessages: {
        generalError: 'Ocorreu um erro ao mostrar estatísticas do cache.',
    },
    autoDelete: {
        commandMessages: false,
        errorMessages: false,
    },
    permissions: {
        allowedIn: 'all',
        adminOnly: true,
    },
};

// News Debug command (for the new newsMonitor.js pipeline)
const NEWS_DEBUG_CONFIG = {
    prefixes: ['!newsdebug', '!debugnews'],
    description:
        'Mostra informações de debug detalhadas do ciclo de processamento de notícias (apenas admin)',
    permissions: {
        allowedIn: 'all',
        adminOnly: true,
    },
    autoDelete: {
        errorMessages: true,
        commandMessages: false,
        deleteTimeout: 120000,
    },
    errorMessages: {
        notAllowed: 'Você não tem permissão para usar este comando.',
        error: 'Erro ao gerar o relatório de debug do ciclo de notícias.',
    },
};

// Export all configs
module.exports = {
    CACHE_CLEAR_CONFIG,
    NEWS_TOGGLE_CONFIG,
    DEBUG_PERIODIC_CONFIG,
    CONFIG_CONFIG,
    CACHE_RESET_CONFIG,
    CACHE_STATS_CONFIG,
    NEWS_DEBUG_CONFIG,
};
