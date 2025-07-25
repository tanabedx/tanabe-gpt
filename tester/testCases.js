/**
 * Test Cases for WhatsApp Bot
 */

const config = require('./config');

// Test cases organized by category
const TEST_CASES = {
    // Summary command tests
    SUMMARY: [
        {
            name: 'Basic Summary',
            command: '#resumo',
            expectedResponseContains: ['últimas', 'horas', 'três', '3', 'hora', 'resumo'],
            description: 'Should summarize the last 3 hours',
            category: 'SUMMARY',
            extraDelay: 5000, // Extra delay for summary commands
            waitForStreaming: true,
        },
        {
            name: 'Summary with Quote',
            command: '#resumo',
            preMessage: 'do not go gentle into that good night by dylan thomas',
            quote: true,
            preDelay: 5000, // Longer wait before sending the preMessage
            expectedResponseContains: ['Dylan', 'Thomas'],
            description: 'Should summarize only the quoted poem',
            category: 'SUMMARY',
            extraDelay: 10000, // Longer delay for processing
            waitForStreaming: true,
        },
        {
            name: 'Summary with Link',
            command: '#resumo',
            preMessage: 'https://www.bbc.com/news/articles/c39v779xpdno',
            quote: true,
            preDelay: 5000, // Longer wait before sending the preMessage
            expectedResponseContains: ['BBC', 'Mark Carney'],
            description: 'Should summarize the quoted link',
            category: 'SUMMARY',
            extraDelay: 15000, // Longer delay for link processing
            waitForStreaming: true,
        },
        {
            name: 'Summary with Specific Count',
            command: '#resumo 10',
            expectedResponseContains: ['últimas', 'mensagens', 'dez', '10', 'resumo'],
            description: 'Should summarize only the last 10 messages',
            category: 'SUMMARY',
            extraDelay: 5000,
            waitForStreaming: true,
        },
        {
            name: 'Summary with Document',
            command: '#resumo',
            attachment: config.SAMPLES.PDF,
            sendAttachmentFirst: true, // Send attachment first, then quote it
            quote: true,
            expectedResponseContains: ['documento', 'pdf', 'Dylan', 'Thomas'],
            description: 'Should summarize the attached PDF document',
            category: 'SUMMARY',
            extraDelay: 15000, // Much longer delay for document processing
            preDelay: 5000, // Wait before sending the command
            waitForStreaming: true,
        },
        {
            name: 'Direct Attachment Summary',
            command: '#resumo',
            attachment: config.SAMPLES.PDF,
            attachWithCommand: true, // Send attachment with the command
            expectedResponseContains: ['documento', 'pdf', 'Dylan', 'Thomas'],
            description: 'Should summarize a document attached directly with the #resumo command',
            category: 'SUMMARY',
            extraDelay: 15000, // Much longer delay for document processing
            waitForStreaming: true,
        },
        {
            name: 'Summary Sticker',
            command: '',
            attachment: config.SAMPLES.RESUMO_STICKER,
            isSticker: true, // Send as sticker
            expectedResponseContains: ['últimas', 'horas', 'hora', 'resumo'],
            description: 'Should summarize using the summary sticker',
            category: 'SUMMARY',
            extraDelay: 5000,
            waitForStreaming: true,
        },
    ],

    // News command tests
    NEWS: [
        {
            name: 'Latest News',
            command: '#ayubnews',
            expectedResponseContains: ['notícias'],
            description: 'Should fetch the latest news',
            category: 'NEWS',
            extraDelay: 5000,
            waitForStreaming: false,
        },
        {
            name: 'Football News',
            command: '#ayubnews fut',
            expectedResponseContains: ['futebol'],
            description: 'Should fetch the latest football news',
            category: 'NEWS',
            extraDelay: 5000,
            waitForStreaming: false,
        },
        {
            name: 'News Search',
            command: '#ayubnews trump',
            expectedResponseContains: ['Trump'],
            description: 'Should search for news about Trump',
            category: 'NEWS',
            extraDelay: 5000,
            waitForStreaming: false,
        },
        {
            name: 'News Sticker',
            command: '',
            attachment: config.SAMPLES.AYUB_STICKER,
            isSticker: true, // Send as sticker
            expectedResponseContains: ['notícias'],
            description: 'Should fetch news using the news sticker',
            category: 'NEWS',
            extraDelay: 5000,
            waitForStreaming: false,
        },
        {
            name: 'Link Auto Summary',
            command: 'https://www.bbc.com/news/articles/c39v779xpdno',
            expectedResponseContains: ['BBC', 'Mark Carney'],
            description: 'Should automatically summarize a shared link',
            category: 'NEWS',
            extraDelay: 15000, // Longer delay for link processing
            useBotChat: true, // Use direct chat with bot for auto summary
            waitForStreaming: false,
        },
    ],

    // Chat command tests
    CHAT: [
        {
            name: 'ChatGPT Basic',
            command: '#chatgpt qual é a capital da França?',
            expectedResponseContains: ['Paris'],
            description: 'Should answer a simple question in Portuguese',
            category: 'CHAT',
            extraDelay: 5000,
            waitForStreaming: true,
        },
        {
            name: 'ChatGPT with Quote',
            command: '#chatgpt explique isso',
            preMessage: 'E = mc²',
            quote: true,
            preDelay: 5000, // Longer wait before sending the preMessage
            expectedResponseContains: ['Einstein', 'energia', 'massa'],
            description: 'Should explain the quoted formula in Portuguese',
            category: 'CHAT',
            extraDelay: 10000, // Longer delay for processing
            waitForStreaming: true,
        },
        {
            name: 'ChatGPT with Personality and History',
            command: '#qual foi a primeira mensagem enviada neste grupo hoje?',
            expectedResponseContains: ['primeira', 'mensagem', 'contexto', 'REQUEST_CONTEXT'],
            description: 'Should use personality and request message history context',
            category: 'CHAT',
            extraDelay: 90000, // Very long delay for full conversation cycle and prompt capture
            useBotChat: false, // Use group chat to have message history
            checkPrompt: true,
            preDelay: 15000, // Longer wait before sending the message to ensure logs are captured
            optional: false, // Make this test required
            waitForStreaming: true,
        },
    ],

    // Media command tests
    MEDIA: [
        {
            name: 'Drawing Generation',
            command: '#desenho um gato sentado na janela',
            expectedResponseContains: [],
            expectMedia: true,
            description: 'Should generate an image of a cat',
            category: 'MEDIA',
            extraDelay: 10000, // Longer delay for image generation
            waitForStreaming: false,
        },
        {
            name: 'Sticker Creation',
            command: '#sticker',
            attachment: config.SAMPLES.IMAGE,
            expectedResponseContains: [],
            expectMedia: true,
            description: 'Should create a sticker from the image',
            category: 'MEDIA',
            extraDelay: 5000,
            waitForStreaming: false,
        },
        {
            name: 'Sticker Search',
            command: '#sticker gato',
            expectedResponseContains: [],
            expectMedia: true,
            description: 'Should search for a cat sticker',
            category: 'MEDIA',
            extraDelay: 5000,
            waitForStreaming: false,
        },
        {
            name: 'Audio Transcription',
            command: '',
            attachment: config.SAMPLES.AUDIO,
            expectedResponseContains: ['transcrição','tudo'],
            description: 'Should transcribe the voice note',
            category: 'MEDIA',
            extraDelay: 10000, // Longer delay for audio processing
            waitForStreaming: true,
        },
    ],

    // Admin command tests
    ADMIN: [
        {
            name: 'Debug Periodic Summary',
            command: '!debugperiodic',
            expectedResponseContains: ['link', 'poema', 'BBC'],
            description: 'Should generate and send summaries to admin for all groups',
            category: 'ADMIN',
            adminOnly: true,
            useAdminChat: true,
            extraDelay: 10000,
            waitForStreaming: false,
        },
        {
            name: 'News Debug',
            command: '!newsdebug',
            expectedResponseContains: ['Relatório'],
            description: 'Should show Twitter debug information',
            category: 'ADMIN',
            adminOnly: true,
            useAdminChat: true,
            extraDelay: 5000,
            waitForStreaming: false,
        },
        {
            name: 'Cache Clear',
            command: '!clearcache',
            expectedResponseContains: ['Cache cleared successfully'],
            description: 'Should clear the cache',
            category: 'ADMIN',
            adminOnly: true,
            useAdminChat: true,
            extraDelay: 2000,
            waitForStreaming: false,
        },
    ],

    // Miscellaneous command tests
    MISC: [
        {
            name: 'Command List',
            command: '#?',
            expectedResponseContains: ['comandos'],
            description: 'Should list all available commands',
            category: 'MISC',
            extraDelay: 3000,
            waitForStreaming: false,
        },
        {
            name: 'Tag Command',
            command: '@todos',
            expectedResponseContains: ['@'],
            description: 'Should tag everyone in the group',
            category: 'MISC',
            extraDelay: 3000,
            waitForStreaming: false,
        },
        {
            name: 'Wizard Command',
            command: '#ferramentaresumo',
            expectedResponseContains: ['grupos', 'configurados'],
            description: 'Should start the configuration wizard',
            category: 'MISC',
            extraDelay: 3000,
            followUpCommand: 'cancelar', // Send "cancelar" after testing the wizard
            followUpDelay: 3000, // Wait 3 seconds before sending the follow-up command
            waitForStreaming: false,
        },
        {
            name: 'Bot Message Reaction Delete',
            command: '#?',
            expectedResponseContains: ['comandos'],
            description: 'Should delete bot message when thumbs up reaction is added',
            category: 'MISC',
            extraDelay: 5000,
            checkBotMessageDeletion: true, // Check if bot's message is deleted on reaction
            waitForStreaming: false,
        },
        {
            name: 'Natural Language Processing',
            command: `@${config.BOT_NUMBER} desenhe um gato para mim`,
            expectedResponseContains: [],
            expectMedia: true,
            description: 'Should process natural language and generate an image',
            category: 'MISC',
            extraDelay: 15000,
            waitForStreaming: false,
            mentions: [`${config.BOT_NUMBER}@c.us`], // Properly mention the bot
        },
    ],
};

// Function to get all test cases or filter by category
function getTestCases(categories = null, includeOptional = false) {
    // If no categories specified, use the enabled categories from config
    if (!categories) {
        categories = Object.entries(config.TEST_CATEGORIES)
            .filter(([_, enabled]) => enabled)
            .map(([category]) => category);
    }

    // Flatten all test cases from enabled categories
    let allTests = [];
    categories.forEach(category => {
        if (TEST_CASES[category]) {
            // Filter out optional tests unless explicitly included
            const tests = includeOptional
                ? TEST_CASES[category]
                : TEST_CASES[category].filter(test => !test.optional);
            allTests = [...allTests, ...tests];
        }
    });

    return allTests;
}

module.exports = {
    TEST_CASES,
    getTestCases,
};
