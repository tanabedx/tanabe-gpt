// commandList.config.js
// Configuration for the command_list command

const COMMAND_LIST_CONFIG = {
    prefixes: ['#?'],
    description: 'Mostra esta lista de comandos disponíveis no grupo atual.',
    autoDelete: {
        errorMessages: true,
        commandMessages: true,
        deleteTimeout: 300000, // 5 minutes
    },
    errorMessages: {
        error: 'Ocorreu um erro ao listar os comandos.',
        notAllowed: 'Você não tem permissão para usar este comando.',
    },
    useGroupPersonality: false,
    marketingMessage:
        `🤖 *Bem-vindo ao TanabeGPT!*\n\n` +
        `Somos um bot avançado que integra ChatGPT ao WhatsApp, oferecendo diversas funcionalidades personalizadas:\n\n` +
        `• 💬 Conversas inteligentes com ChatGPT\n` +
        `• 📝 Resumo automático de mensagens\n` +
        `• 🎨 Geração de imagens com IA\n` +
        `• 📰 Monitoramento e resumo de notícias\n` +
        `• 🎯 Stickers personalizados\n` +
        `• 🎤 Transcrição de áudio\n` +
        `• E muito mais!\n\n` +
        `Interessado em ter estas funcionalidades em seu grupo? Entre em contato conosco respondendo esta mensagem! Nossa equipe terá prazer em ajudar. 🚀`,
};

module.exports = COMMAND_LIST_CONFIG; 