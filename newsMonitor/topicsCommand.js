/**
 * Command to view active topics - for debugging and monitoring
 */

const { getActiveTopicsStats, getActiveTopics } = require('./persistentCache');

function formatActiveTopics() {
    try {
        const stats = getActiveTopicsStats();
        const activeTopics = getActiveTopics();
        
        if (stats.totalActiveTopics === 0) {
            return '📰 *Tópicos Ativos*\n\nNenhum tópico ativo no momento.';
        }

        let response = `📰 *Tópicos Ativos* (${stats.totalActiveTopics})\n\n`;

        activeTopics.forEach((topic, index) => {
            const ageHours = Math.round((Date.now() - topic.startTime) / (1000 * 60 * 60));
            const remainingHours = Math.round((topic.cooldownUntil - Date.now()) / (1000 * 60 * 60));
            
            response += `*${index + 1}. ${topic.topicId}*\n`;
            response += `📍 Entidades: ${topic.entities.slice(0, 3).join(', ')}\n`;
            response += `Eventos: ${topic.coreEventsSent} principais, ${topic.consequencesSent}/${topic.maxConsequences} consequências\n`;
            response += `⏰ Idade: ${ageHours}h | Resfria em: ${remainingHours}h\n`;
            response += `🔗 Origem: ${topic.originalItem.source}\n`;
            response += `💬 "${topic.originalItem.title?.substring(0, 80)}..."\n\n`;
        });

        return response;
    } catch (error) {
        return `❌ Erro ao buscar tópicos ativos: ${error.message}`;
    }
}

async function handleTopicsCommand(message) {
    try {
        const response = formatActiveTopics();
        await message.reply(response);
    } catch (error) {
        await message.reply('❌ Erro ao processar comando de tópicos.');
    }
}

module.exports = {
    handleTopicsCommand,
    formatActiveTopics
}; 