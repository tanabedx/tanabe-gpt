// resumo.js

const RESUMO = {
    DEFAULT: `
{name} está pedindo para que você resuma {timeDescription}:

INÍCIO DAS MENSAGENS:
{messageTexts}
FIM DAS MENSAGENS.

Deixe claro quantas mensagens ou o período de tempo de mensagens que foram resumidas.

{groupPersonality}
        `,
    LINK_SUMMARY: `Você é um assistente especializado em resumir conteúdo. Por favor, resuma o seguinte texto em português de forma clara e concisa, mantendo os pontos principais. Começe com uma frase resumindo tudo, em seguida no máximo 5 bullet points com informações relevantes:

{pageContent}

Forneça um resumo que capture a essência do conteúdo.`,
    QUOTED_MESSAGE: `
{name} está pedindo para que você resuma a seguinte mensagem:

{quotedText}

{groupPersonality}
        `,
    DOCUMENT_SUMMARY: `Você é um especialista em resumir documentos de forma clara e concisa. Por favor, analise o seguinte texto e crie um resumo que:

1. Capture os pontos principais e ideias centrais
2. Mantenha a estrutura lógica do documento
3. Preserve informações importantes como datas, números e nomes relevantes
4. Seja claro e direto, evitando redundâncias
5. Mantenha o contexto original do documento

Texto para resumir:
{text}

Por favor, forneça um resumo estruturado e coeso.`,
};

module.exports = RESUMO;
