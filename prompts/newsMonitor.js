// newsMonitor.js - Prompts for news monitoring system

const NEWS_MONITOR = {
    EVALUATE_TWEET: `
Tweet para Avaliação:
{post}

Instruções:
Avalie o tweet acima e determine se ele deve ser enviado para um grupo de WhatsApp. Seja extremamente seletivo para evitar spam de mensagens no grupo.

Retorne a palavra "relevant" APENAS se o tweet atender a pelo menos um dos seguintes critérios:
- Calamidades naturais ou desastres
- Notícia global crítica
- Relacionada ao Brasil ou com impacto direto no Brasil
- Eventos de grande impacto global
- Descobertas científicas ou avanços importantes
- Eventos esportivos significativos com relevância internacional

Retorne a palavra "null" em todos os outros casos, incluindo:
- A notícia já foi mencionada nos tweets anteriores (duplicada ou atualização)
- Não se trata de um evento crítico ou relevante globalmente
- É sobre política dos EUA (a menos que envolva eventos significativos, controvérsias ou mortes)
- É apenas uma atualização sem novas informações substanciais
- Diz respeito a celebridades (a menos que envolva morte ou impacto global)
- É uma notícia local com impacto mínimo no cenário global

Tweets Analisados Anteriormente (para Contexto):
{previous_posts}
    `,
    
    EVALUATE_ARTICLE: `
Artigo para Avaliação:
{article}

Instruções:
Avalie o artigo acima e determine se ele deve ser enviado para um grupo de WhatsApp. Seja extremamente seletivo para evitar spam de mensagens no grupo.

Retorne a palavra "relevant" APENAS se o artigo atender a pelo menos um dos seguintes critérios:
- Calamidades naturais ou desastres
- Notícia global crítica
- Notícia crítica relacionada ao Brasil ou com impacto direto no Brasil
- Notícia crítica sobre a cidade de São Paulo
- Eventos de grande impacto global
- Descobertas científicas ou avanços importantes
- Eventos esportivos significativos com relevância internacional ou ao Brasil
- Escândalos políticos, econômicos ou de outra natureza

Retorne a palavra "null" em todos os outros casos, incluindo:
- Não se trata de um evento crítico ou relevante globalmente, ao Brasil ou à cidade de São Paulo
- A notícia já foi mencionada nos artigos anteriores (duplicada ou atualização)
- É apenas uma atualização sem novas informações substanciais
- É uma notícia local com impacto mínimo no cenário global

Artigos Analisados Anteriormente (para Contexto):
{previous_articles}
    `,
    
    BATCH_EVALUATE_TITLES: `
Lista de Títulos de Artigos para Avaliação em Lote:
{titles}

Instruções:
Avalie cada título acima para determinar quais têm potencial de serem relevantes. Seja extremamente seletivo para evitar spam de mensagens no grupo de WhatsApp.

Um título é potencialmente RELEVANTE se sugerir:
- Calamidades naturais ou desastres
- Notícia global crítica
- Notícias críticas relacionadas ao Brasil
- Eventos de impacto global
- Descobertas científicas importantes
- Eventos esportivos significativos

Considere IRRELEVANTE qualquer título que claramente sugira:
- Notícia local com impacto mínimo
- Celebridades (exceto mortes ou impacto global)
- Política de EUA (exceto eventos críticos)
- Esportes não significativos

Esta é apenas uma avaliação preliminar para filtrar conteúdo obviamente irrelevante.
Responda apenas com os números dos títulos que você considera RELEVANTES, separados por vírgula. 
Por exemplo: "1, 3, 5" (se os títulos 1, 3 e 5 forem relevantes).
Se nenhum título for relevante, responda com "0".
    `,
    
    SUMMARIZE_CONTENT: `
Título: {title}

Conteúdo:
{content}

Instruções:
Gere um resumo conciso deste conteúdo em 3 pontos de destaque (formato bullet point). 
Cada ponto deve comunicar uma informação factual essencial contida no artigo.

Requisitos:
1. Use 3 pontos apenas (bullet points) com o símbolo "•" no início de cada ponto
2. Cada ponto deve ter no máximo 10-15 palavras (curto e objetivo)
3. Mantenha a informação puramente factual (evite opiniões ou especulações)
4. Inclua apenas os fatos mais importantes e impactantes
5. Ordene os pontos do mais para o menos importante

Exemplos de formato:
• Primeiro ponto importante e factual do artigo.
• Segundo ponto importante comunicando outro aspecto essencial.
• Terceiro ponto com informação complementar relevante.
    `
};

module.exports = NEWS_MONITOR; 