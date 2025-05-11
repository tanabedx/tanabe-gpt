// newsMonitor.js - Prompts for news monitoring system

const NEWS_MONITOR = {
    EVALUATE_TWEET: `
Tweet para Avaliação:
{post}

Instruções:
Avalie o tweet acima e determine se ele deve ser enviado para um grupo de WhatsApp. Seja extremamente seletivo para evitar spam de mensagens no grupo.

Resposta obrigatória em uma das seguintes formas:
1. Se relevante: "relevant::Breve justificativa de 5-10 palavras sobre por que é relevante"
2. Se não relevante: "null::Motivo da exclusão em 5-10 palavras"

O tweet é RELEVANTE se atender a pelo menos um dos seguintes critérios:
- Calamidades naturais ou desastres de larga escala
- Notícia global crítica
- Notícias críticas relacionadas ao Brasil ou com impacto significativo e direto ao Brasil
- Eventos de grande impacto global
- Descobertas científicas ou avanços importantes
- Eventos esportivos significativos com relevância internacional

O tweet é IRRELEVANTE (null) nos seguintes casos:
- A notícia já foi mencionada nos tweets anteriores (duplicada ou atualização)
- Não se trata de um evento crítico ou relevante globalmente
- É sobre política dos EUA (a menos que envolva eventos significativos, controvérsias ou mortes)
- É apenas uma atualização sem novas informações substanciais
- Diz respeito a celebridades (a menos que envolva morte ou impacto global)
- É uma notícia local com impacto mínimo no cenário global

Tweets Analisados Anteriormente (para Contexto):
{previous_posts}
    `,

    SITREP_artorias_PROMPT: `
Tweet de SITREP_artorias para Avaliação:
{post}

Instruções:
Avalie o tweet acima de SITREP_artorias e determine se ele é relacionado a notícias, conflitos ou atualizações militares. Responda com apenas 'sim' ou 'não'.
    `,

    EVALUATE_ARTICLE: `
Artigo para Avaliação:
{article}

Instruções:
Avalie o artigo acima e determine se ele deve ser enviado para um grupo de WhatsApp. Seja extremamente seletivo para evitar spam de mensagens no grupo.

Resposta obrigatória em uma das seguintes formas:
1. Se relevante: "relevant::Breve justificativa de 5-10 palavras sobre por que é relevante"
2. Se não relevante: "null::Motivo da exclusão em 5-10 palavras"

O artigo é RELEVANTE se atender a pelo menos um dos seguintes critérios:
- Calamidades naturais ou desastres
- Notícia global crítica
- Notícia crítica relacionada ao Brasil ou com impacto significativo e direto ao Brasil
- Notícia crítica sobre a cidade de São Paulo
- Eventos de grande impacto global
- Descobertas científicas ou avanços importantes
- Eventos esportivos significativos com relevância internacional ou ao Brasil
- Escândalos políticos, econômicos ou de outra natureza

O artigo é IRRELEVANTE (null) nos seguintes casos:
- Não se trata de um evento crítico ou relevante globalmente, à maioria da população brasileira ou à maioria da população da cidade de São Paulo
- A notícia já foi mencionada nos artigos anteriores (duplicada ou atualização)
- É apenas uma atualização sem novas informações substanciais
- É uma notícia local com impacto mínimo no cenário global

Seja especialmente seleto em notícias involvendo a cidade de São Paulo, educação, saúde, ciência, tecnologia e meio ambiente. Somente as marque relevante se tiverem impacto significativo globalmente ou no Brasil inteiro.

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

Seja especialmente seleto em notícias involvendo a cidade de São Paulo, educação, saúde, ciência, tecnologia e meio ambiente. Somente as marque relevante se tiverem impacto significativo globalmente ou no Brasil inteiro.

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
    `,

    PROCESS_SITREP_IMAGE_PROMPT: `
Analise a imagem no URL {image_url}.
Extraia todo o texto contido nela.
Formate o texto extraído de forma clara, estruturada e em português do Brasil, mantendo a intenção o máximo possível.
Adicione um emoji da bandeira do primeiro país mencionado ao lado do nome do país. 
Caso você for utilizar markdown, o utilize de acordo com os parametros do Whatsapp, somente um asterisco ** para negrito e _ para italico. 
Se não houver texto na imagem ou se o texto não for significativo para um "breaking news", responda com "Nenhum texto relevante detectado na imagem.".
Apenas o texto em português formatado deve ser a sua resposta final.
    `,
};

module.exports = NEWS_MONITOR;
