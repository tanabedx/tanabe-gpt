// legacyWebSearch.prompt.js
// Archived legacy manual web search instructions extracted from chatgpt.prompt.js
// Kept for reference; not used by runtime prompts.

const LEGACY_WEB_SEARCH_PROMPTS = {
  MANUAL_SEARCH_SECTIONS: {
    initial_when_to_request: `QUANDO SOLICITAR PESQUISA MANUAL:
Use pesquisa manual quando:
- A pesquisa automática não foi ativada mas você precisa de informações atuais
- Precisa de informações específicas que não estão no seu conhecimento base
- O usuário pergunta sobre eventos/dados muito recentes ou específicos
- Precisa verificar informações antes de responder com certeza`,

    initial_how_to_request: `COMO SOLICITAR PESQUISA MANUAL:
Quando precisar de pesquisa, use: REQUEST_SEARCH: [consulta de pesquisa]
- Exemplos: REQUEST_SEARCH: OpenAI GPT-4 latest updates 2024
- Exemplos: REQUEST_SEARCH: Brasil eleições 2024 resultados
- Exemplos: REQUEST_SEARCH: preço bitcoin hoje
- Máximo: 5 pesquisas manuais por conversa
- Use consultas específicas e em português ou inglês`,

    withContext_note: `LEMBRE-SE: O sistema pode fornecer resultados de pesquisa automaticamente para informações muito atuais quando relevante, e você pode solicitar pesquisas manuais com REQUEST_SEARCH: [consulta].`,

    withContext_how_to: `Para pesquisas manuais, use:
REQUEST_SEARCH: [sua consulta de pesquisa]
Você pode fazer até 5 pesquisas manuais por conversa.`,

    humor_caps: `CAPACIDADES: O sistema pode fornecer automaticamente resultados de pesquisa sobre memes atuais, piadas recentes, e eventos engraçados quando relevante para sua resposta. Você também pode solicitar pesquisas manuais.`,

    humor_how_to: `Para pesquisas sobre memes atuais, piadas recentes, ou eventos engraçados, use:
REQUEST_SEARCH: [sua consulta de pesquisa]
- Exemplos: REQUEST_SEARCH: memes brasileiros 2024
- Exemplos: REQUEST_SEARCH: latest internet jokes
- Você pode fazer até 5 pesquisas manuais por conversa`,

    context_auto_info: `INFORMAÇÕES ATUAIS: O sistema pode fornecer resultados de pesquisa automaticamente quando relevante para a pergunta, ou você pode solicitar pesquisas manuais com REQUEST_SEARCH: [consulta].`,
  }
};

module.exports = LEGACY_WEB_SEARCH_PROMPTS;


