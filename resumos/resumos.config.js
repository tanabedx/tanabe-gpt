// resumo.config.js
// Configuration for the resumo command

const RESUMO_PROMPT = require('./resumo.prompt');

const RESUMOS_CONFIG = {
    prefixes: ['#resumo'],
    description:
        'Resume mensagens do grupo. Use #resumo [número] para resumir X mensagens, cite uma mensagem para resumi-la, envie um link para resumir seu conteúdo, ou cite uma mensagem com documento (PDF/DOCX) para resumir seu conteúdo. Também pode ser ativado com o sticker de resumo.',
    stickerHash: 'ca1b990a37591cf4abe221eedf9800e20df8554000b972fb3c5a474f2112cbaa',
    defaultSummaryHours: 3,
    documentSettings: {
        maxCharacters: 5000,
        supportedFormats: ['.pdf', '.docx', '.doc', '.txt', '.rtf'],
        tempDir: '.',
    },
    linkSettings: {
        maxCharacters: 5000,
        timeout: 15000, // Timeout for fetching links in milliseconds (increased for better reliability)
        retryAttempts: 2, // Number of retry attempts on failure
        retryDelay: 1000, // Delay between retries in milliseconds
    },
    autoDelete: {
        errorMessages: true,
        commandMessages: false,
        deleteTimeout: 60000,
    },
    errorMessages: {
        invalidFormat:
            'Formato inválido. Use #resumo [número] para resumir X mensagens, ou use expressões de tempo como "hoje", "ontem", "1 hora", "30 minutos", etc.',
        noMessages: 'Não há mensagens suficientes para gerar um resumo.',
        notAllowed: 'Você não tem permissão para usar este comando.',
        linkError: 'Não consegui acessar o link para gerar um resumo.',
        documentError: 'Não consegui processar o documento para gerar um resumo.',
        documentUnsupported:
            'Formato de documento não suportado. Formatos suportados: PDF, DOCX, DOC, TXT, RTF.',
        documentTooLarge: 'O documento é muito grande para ser processado.',
        error: 'Ocorreu um erro ao gerar o resumo.',
    },
    useGroupPersonality: true,
    model: '',
    prompt: RESUMO_PROMPT,
};

module.exports = RESUMOS_CONFIG;
