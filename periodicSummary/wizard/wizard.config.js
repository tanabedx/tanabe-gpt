// wizard.config.js
// Configuration for the WIZARD (wizard) command

// Import the resumo config
const WIZARD = require('../periodicSummary.config');
const WIZARD_PROMPT = require('./periodicSummaryConfig.prompt');

const WIZARD_CONFIG = {
    // Use the configuration from the periodic summary config
    ...WIZARD,
    prefixes: ['#ferramentaresumo'],
    description: 'Configura o resumo periódico do grupo (apenas admin).',
    autoDelete: {
        errorMessages: true,
        commandMessages: false,
        deleteTimeout: 60000,
    },
    errorMessages: {
        error: 'Erro ao configurar o resumo periódico.',
        notAllowed: 'Você não tem permissão para usar este comando.',
        timeout:
            '⏰ A sessão de configuração expirou devido a inatividade. Por favor, inicie novamente.',
    },
    useGroupPersonality: false,
    prompt: WIZARD_PROMPT,
    wizardTimeout: 300000, // 5 minutes default timeout
};

module.exports = WIZARD_CONFIG;
