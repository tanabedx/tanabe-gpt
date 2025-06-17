// newsMonitor.js - Prompts for news monitoring system

const NEWS_MONITOR = {
    EVALUATE_CONTENT: `
Você é um assistente do fictício presidente do Brasil e é encarregado de informá-lo sobre notícias importantes. O presidente também lhe disse que é um grande fã de futebol e gosta de estar antenado nas últimas informações sobre o mundo, não só pertinente ao Brasil, e quer notícias relevantes sobre o tema. 

⚠️ **ATENÇÃO CRÍTICA**: O presidente odeia ser acordado durante a madrugada e irá te demitir se você o acordar sem ter algo GENUINAMENTE NOVO E URGENTE para contar. Ele já acompanha as notícias regularmente e você deve ser EXTREMAMENTE seletivo.

🕐 **CONTEXTO**: São 3 da manhã. O presidente já foi informado sobre as seguintes notícias recentes:

**NOTÍCIAS JÁ RECEBIDAS (últimas 72h):**
{recent_news_cache}

**NOVA NOTÍCIA PARA AVALIAÇÃO:**
{content}

**CRITÉRIOS RIGOROSOS:**
**ACORDE O PRESIDENTE APENAS SE:**
- A nova notícia revela informações COMPLETAMENTE NOVAS não mencionadas nas notícias já recebidas
- Representa escalação SIGNIFICATIVA além do que ele já sabe
- Contém detalhes específicos e impactantes que mudam fundamentalmente a situação
- É genuinamente urgente e não pode esperar até o amanhecer

🏆 **EXCEÇÃO FUTEBOL**: Para notícias de futebol, acorde apenas se for:
- Vitórias/derrotas em competições IMPORTANTES (Copa do Mundo, Copa América, Libertadores, Champions League)
- Mudanças SIGNIFICATIVAS em grandes clubes brasileiros (técnicos, jogadores estrela)
- Eventos que impactam o futebol brasileiro nacionalmente
- **NÃO acorde para**: cartões, gols isolados, transferências menores, lesões rotineiras

❌ **NÃO ACORDE SE:**
- É repetição ou variação de informação já recebida
- É consequência previsível de eventos já noticiados
- Adiciona apenas detalhes menores a situações já conhecidas
- Pode esperar algumas horas sem prejuízo

**EM CASO DE DÚVIDA, SEMPRE ESCOLHA "null"**

Resposta obrigatória:
1. Se genuinamente novo e urgente: "relevant::Justificativa específica explicando a novidade"
2. Se não urgente ou repetitivo: "null::Motivo específico da exclusão"

Seja IMPLACAVELMENTE seletivo. O presidente prefere dormir do que receber informações repetidas.
    `,

    SITREP_artorias_PROMPT: `
Tweet de SITREP_artorias para Avaliação:
{post}

Instruções:
Avalie o tweet acima de SITREP_artorias e determine se ele é relacionado a notícias, conflitos ou atualizações militares. Se for algum tipo de anúncio comercial, responda 'não.'  Responda com apenas 'sim' ou 'não,' sem aspas, pontuação, letr ou outros caracteres.
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
{{#if title}}
Título Original: {title}
{{/if}}
Conteúdo Original:
{content}

Instruções Detalhadas:
1.  **Tradução para Português:**
    *   Analise o "Título Original" (se fornecido) e o "Conteúdo Original".
    *   Se estiverem em um idioma comum diferente do Português (ex: Inglês, Espanhol), traduza-os para Português fluente e claro.
    *   Se já estiverem em Português compreensível, utilize-os como estão.
    *   Todo o processamento subsequente deve ser feito sobre as versões em Português.

2.  **Geração de Resumo Conciso:**
    *   Com base no texto em Português (título traduzido/original e conteúdo traduzido/original), gere um resumo conciso em 3 pontos de destaque (formato bullet point).
    *   Se o conteúdo for muito curto (como um tweet), os 3 pontos podem ser mais diretos e extrair a essência da mensagem curta. Se for um artigo mais longo, siga a estrutura de destacar os fatos mais importantes.

3.  **Requisitos para o Resumo:**
    *   Use exatamente 3 pontos (bullet points), cada um iniciando com o símbolo "•".
    *   Cada ponto deve ser curto e objetivo (idealmente 10-20 palavras).
    *   Mantenha a informação puramente factual; evite opiniões ou especulações.
    *   Inclua apenas os fatos/informações mais importantes e impactantes.
    *   Ordene os pontos por relevância ou fluxo lógico.

4.  **Formato da Resposta:**
    *   Sua resposta DEVE CONTER APENAS os 3 bullet points do resumo em Português. Não inclua introduções, saudações, o título traduzido separadamente, ou qualquer outro texto fora dos 3 bullet points.

Exemplo de Saída Esperada (APENAS os bullets):
• Fato principal ou declaração chave do conteúdo.
• Detalhe importante ou consequência do fato principal.
• Informação complementar relevante ou contexto adicional.
    `,

    PROCESS_IMAGE_TEXT_EXTRACTION_PROMPT: `
Analise a imagem no URL {image_url}.
Extraia todo o texto contido nela.
Formate o texto extraído de forma clara, estruturada e em português do Brasil, mantendo a intenção o máximo possível.
Adicione um emoji da bandeira do primeiro país mencionado ao lado do nome do país. 
Caso você for utilizar markdown, o utilize de acordo com os parametros do Whatsapp, somente um duplo asterísco (ex:. *texto*) para negrito e um duplo underline (ex:. _texto_) para itálico. 
Se não houver texto na imagem ou se o texto não for significativo para um "breaking news", responda com "Nenhum texto relevante detectado na imagem.".
Apenas o texto em português formatado deve ser a sua resposta final.
    `,

    DETECT_DUPLICATE: `
Novo Item para Avaliação:
{new_item}

Itens Anteriores:
{previous_items}

Instruções:
Compare o novo item com os itens anteriores para determinar se eles se referem essencialmente ao mesmo evento ou notícia.

SEJA LENIENTE AO EXCLUIR. Em caso de dúvida, prefira considerar como duplicado.

Considere como DUPLICADO quando:
- Trata exatamente do mesmo evento ou desenvolvimento específico
- É obviamente a mesma notícia, mesmo que com títulos ligeiramente diferentes 
- Cobre o mesmo tópico específico sem adicionar novas informações significativas e relevantes
- É uma atualização de uma notícia já publicada
- É minimamente relacionado a uma notícia já publicada

Foque principalmente no conteúdo semântico e não na formulação exata. Dois itens podem parecer diferentes na redação, mas se referir ao mesmo evento.

Responda apenas em um dos seguintes formatos:
1. Se for duplicado: "duplicate::[ID do item similar]::[Breve justificativa de 10-15 palavras]"
2. Se não for duplicado: "unique::Não é duplicado de nenhum item anterior"
3. Não utilize aspas duplas no seu retorno.

Exemplos:
- "duplicate::1921915583668355090::Mesmo anúncio sobre o PKK encerrar luta armada na Turquia"
- "unique::Não é duplicado de nenhum item anterior"
    `,

    DETECT_TOPIC_REDUNDANCY: `
Analise a seguinte lista de notícias e tweets. Cada item é prefixado com seu número original na lista.

Itens para análise:
{items_numbered_list}

Instruções:
Seu objetivo é identificar grupos de itens que cobrem essencialmente o MESMO TÓPICO OU EVENTO PRINCIPAL. Itens podem ser de fontes diferentes ou ter detalhes ligeiramente variados, mas se o núcleo da notícia é o mesmo, eles devem ser agrupados.

Responda APENAS com os números originais dos itens que formam grupos redundantes. 
- Use vírgulas para separar os números dos itens dentro de um mesmo grupo.
- Use um ponto-e-vírgula para separar grupos diferentes.
- Mantenha a ordem original dos itens dentro de cada grupo, se possível (ou seja, o menor número do item primeiro no grupo).

Exemplos de formato de resposta:
- Se os itens 1, 3 e 5 são sobre o mesmo tópico; e os itens 2 e 4 são sobre outro tópico (mas o mesmo entre si); e o item 6 é único, responda: 1,3,5;2,4
- Se apenas um grupo de itens redundantes for encontrado, por exemplo, itens 2, 4, e 6, responda: 2,4,6
- Se todos os itens na lista tratarem de tópicos únicos e não houver redundância, responda com a palavra: NENHUM

Considere o contexto e o evento principal. Por exemplo, duas notícias sobre "terremoto na California" são sobre o mesmo tópico, mesmo que uma mencione "Los Angeles" e outra "San Francisco" como áreas afetadas.
Outro exemplo: se o item 1 é "Presidente anuncia novo plano econômico" e o item 3 é "Detalhes do novo pacote fiscal revelados pelo governo", eles provavelmente cobrem o mesmo tópico.
Não agrupe itens que são apenas vagamente relacionados; eles devem ser sobre o mesmo evento ou desenvolvimento central.
    `,

    DETECT_STORY_DEVELOPMENT: `
Analise a notícia abaixo para determinar se é um evento principal (core) ou uma consequência/desenvolvimento de outros eventos.

Notícia para análise:
{news_content}

Tópicos ativos recentes (últimas 48h):
{active_topics}

Instruções:
Classifique a notícia em uma das seguintes categorias:

1. **CORE** - Evento principal, novo desenvolvimento significativo que merece destaque próprio
   - Exemplos: ataques, anúncios oficiais, desastres naturais, eleições, descobertas científicas

2. **CONSEQUENCE** - Reação, consequência ou desenvolvimento secundário de eventos já cobertos
   - Exemplos: reações do mercado, declarações de políticos sobre eventos já noticiados, análises, impactos econômicos

3. **DEVELOPMENT** - Atualização significativa de um evento já coberto que adiciona informação importante
   - Exemplos: novas vítimas confirmadas, detalhes adicionais importantes, mudanças no status

Responda APENAS em um dos seguintes formatos:
- "CORE::Justificativa breve (5-10 palavras)"
- "CONSEQUENCE::ID_do_tópico_relacionado::Justificativa breve (5-10 palavras)"
- "DEVELOPMENT::ID_do_tópico_relacionado::Justificativa breve (5-10 palavras)"

Se a notícia se relaciona com algum dos tópicos ativos listados, use o ID correspondente.
    `,

    EVALUATE_CONSEQUENCE_IMPORTANCE: `
🚨 **CONTEXTO PRESIDENCIAL**: Você está avaliando se deve INTERROMPER O SONO do presidente às 3h da manhã para informá-lo sobre um desenvolvimento relacionado a um evento que ele já conhece.

**PERFIL DO PRESIDENTE**: Ele é um grande fã de futebol e gosta de estar antenado nas últimas informações sobre o mundo, mas odeia ser acordado sem algo GENUINAMENTE NOVO E URGENTE.

**EVENTO ORIGINAL JÁ INFORMADO:**
{original_event}

**NOTÍCIAS RELACIONADAS JÁ RECEBIDAS PELO PRESIDENTE:**
{related_news_cache}

**NOVO DESENVOLVIMENTO PARA AVALIAÇÃO:**
{consequence_content}

⚠️ **CRITÉRIO PRESIDENCIAL RIGOROSO**: O presidente já está ciente do evento principal e desenvolvimentos relacionados listados acima. Você será DEMITIDO se acordá-lo com informações redundantes ou consequências previsíveis.

**ESCALA DE IMPORTÂNCIA PRESIDENCIAL (1-10):**

**1-3: NÃO ACORDE - Reação Totalmente Previsível**
- Reações de mercado óbvias (subida/queda de ações)
- Declarações diplomáticas padrão já esperadas
- Medidas de segurança rotineiras (bunkers, evacuações)
- Análises de especialistas repetindo informações conhecidas
- **Variações de informações já relatadas**
- **Futebol**: Cartões, gols isolados, transferências menores, lesões rotineiras

**4-6: NÃO ACORDE - Desenvolvimento Previsível**  
- Declarações diplomáticas com posições já antecipadas
- Detalhes técnicos esperados sobre eventos conhecidos
- Reações padrão de países já envolvidos
- Impactos econômicos regionais já antecipados
- **Futebol**: Resultados esperados, mudanças menores em clubes

**7-8: TALVEZ ACORDE - Desenvolvimento Substancial**
- Evidências COMPLETAMENTE NOVAS sobre o evento
- Envolvimento INESPERADO de novos atores importantes
- Escalações militares ALÉM das já conhecidas
- Revelações que MUDAM a narrativa já estabelecida
- **Futebol**: Vitórias/derrotas em competições importantes, mudanças significativas em grandes clubes brasileiros

**9-10: ACORDE IMEDIATAMENTE - Mudança de Jogo Crítica**
- Evidências de crimes de guerra nunca antes reveladas
- Coordenação secreta totalmente inesperada entre potências
- Informações que indicam conflito iminente NOVO
- Descobertas que redefinem completamente alianças conhecidas
- **Futebol**: Eventos que impactam o futebol brasileiro nacionalmente (Copa do Mundo, Copa América, Libertadores finais)

**PERGUNTAS DE VERIFICAÇÃO RIGOROSA:**
1. Esta informação é GENUINAMENTE nova comparada ao que está no cache?
2. Mudaria FUNDAMENTALMENTE a compreensão do presidente sobre a situação?
3. Exige ação presidencial IMEDIATA que não pode esperar 4-5 horas?
4. É algo que o presidente NÃO poderia prever baseado no que já sabe?

**SE QUALQUER RESPOSTA FOR "NÃO", PONTUAÇÃO MÁXIMA = 6**

Responda APENAS: "SCORE::{1-10}::{categoria}::{justificativa_detalhada_mostrando_novidade}"

Categorias: ECONOMIC, DIPLOMATIC, MILITARY, LEGAL, INTELLIGENCE, HUMANITARIAN, POLITICAL, SPORTS

**LEMBRE-SE: Em caso de dúvida, seja CONSERVADOR. O presidente prefere dormir.**
    `,
};

module.exports = NEWS_MONITOR;
