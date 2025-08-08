// audio.config.js
// Configuration for the audio command
function getConfig() {
    // Lazy-load to avoid circular dependency during startup
    // Always fetch fresh reference to finalized config
    // eslint-disable-next-line global-require
    return require('../configs/config');
}

const AUDIO_CONFIG = {
    prefixes: ['#audio'],
    description: 'Transcreve mensagens de áudio automaticamente.',
    autoDelete: {
        errorMessages: true,
        commandMessages: false,
        deleteTimeout: 60000,
    },
    errorMessages: {
        transcriptionError: 'Desculpe, não consegui transcrever o áudio.',
        downloadError: 'Desculpe, não consegui baixar o áudio.',
        notAllowed: 'Você não tem permissão para usar este comando.',
        invalidFormat: 'Formato de áudio inválido.',
    },
    useGroupPersonality: false,
    get model() {
        const config = getConfig();
        return config?.SYSTEM?.AI_MODELS?.LOW;
    },
};

module.exports = AUDIO_CONFIG;
