# Modo `agents` — MCP por agente e catálogo de agentes

> Plano de implementação. Continua o `docs/agents-mode-plan.md` (que cobre agent + skill). Estado
> persistente: marque as fases em "Progresso" conforme forem feitas. Não reabra as "Decisões" sem o usuário.

## Problema

No modelo atual um agente só tem `tools` (lista de texto livre, sem validação) e `skills`. Não dá para:

1. declarar servidores MCP (Playwright, GitHub, Slack, banco…) e dizer **qual agente usa qual**;
2. configurar o servidor (comando, URL, variáveis, segredos) e escolher quais tools dele o agente pode chamar;
3. partir de um catálogo de agentes prontos (papéis e times) em vez de escrever cada prompt do zero.

## O que os alvos suportam (conferido na documentação oficial em 2026-10-15)

**Claude Code**

- Subagente (`.claude/agents/*.md`) tem o campo `mcpServers`: lista em que cada item é o **nome** de um servidor já
  configurado (compartilha a conexão da sessão) ou uma **definição inline** `{ nome: { type, command/url… } }`
  (conecta quando o subagente começa e desconecta quando termina; as descrições das tools **não entram no contexto da
  conversa principal**). Tipos inline: `stdio`, `http`, `sse`, `ws`.
- `tools` aceita `mcp__<servidor>` ou `mcp__<servidor>__*` (todas as tools do servidor) e `mcp__<servidor>__<tool>`;
  `disallowedTools` também. **Se `tools` for omitido, o subagente herda tudo (inclusive MCP). Se `tools` for uma lista só
  com tools nativas, as tools MCP ficam de fora** — hoje o Archflow gera exatamente essa lista.
- Servidores inline de `.claude/agents/` só carregam depois que a pasta é confiável (trust). Subagentes de **plugin**
  ignoram `mcpServers`.
- Escopo de projeto: `.mcp.json` na raiz, chave `mcpServers`, com `type: stdio | http | sse`, `command`/`args`/`env`
  ou `url`/`headers`, e expansão `${VAR}` / `${VAR:-padrão}` em `command`, `args`, `env`, `url`, `headers`. Sessões
  interativas pedem aprovação do servidor de `.mcp.json`; `claude -p` carrega sem perguntar.
- Subagentes podem criar subagentes (até 3 níveis; `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH`). Já confirmado no teste do
  harness da Farmarcas (orquestrador → content-strategist, `spawnDepth: 2`).

**Cursor**

- `.cursor/mcp.json` (projeto) ou `~/.cursor/mcp.json`: `command`/`args`/`env`/`envFile` ou `url`/`headers`;
  interpolação `${env:NOME}`, `${workspaceFolder}`, `${userHome}`.
- A documentação consultada **não descreve** MCP por subagente. Tratar como "vale para o projeto todo" (igual às skills).

## Decisões propostas (confirmar antes da Fase 1)

1. **MCP vira um papel do nó `agent`**: `AgentRole = "agent" | "skill" | "mcp"`. Um servidor é um nó, não um campo de
   texto — assim aparece no diagrama, no catálogo e no inspetor, como a skill.
2. **Relação nova `uses-mcp`** (agent → mcp, `ConnectionType "dependency"`), com `allow?: string[]` na conexão: tools
   específicas que aquele agente pode chamar (vazio = todas do servidor). Como toda relação do modo agents, leva
   **`usage`** (já implementado em `uses-skill` e `delegates`): COMO o agente usa o servidor — quando chamar, para quê
   e com que cuidado. Vai para o corpo do agente; A018 também cobre `uses-mcp`.
3. **Global** (grupo `global`) vale para todos os agentes: o servidor vai para `.mcp.json` / `.cursor/mcp.json`.
   Fora do Global, com `uses-mcp`:
   - Claude: **definição inline** em `mcpServers` do(s) agente(s) ligado(s) (isolado, não gasta contexto da sessão
     principal). Se o mesmo servidor serve a 2+ agentes, usar `.mcp.json` e **referência por nome** nos agentes.
   - Cursor: vai para `.cursor/mcp.json` (sem isolamento) e o agente só documenta o uso no corpo.
4. **Segredos nunca em texto puro.** O campo `env`/`headers` guarda `${VAR}`; o Archflow lista as variáveis exigidas
   e avisa se estiver faltando. Cursor recebe a sintaxe `${env:VAR}`. Nada de token literal no diagrama nem no `.mcp.json`.
5. **Arquivos compartilhados** (`.mcp.json`, `.cursor/mcp.json`) não pertencem só ao Archflow: o sync faz **merge por
   chave de servidor**, registrando no `archflow.agents.json` quais chaves ele gerencia (mesma proteção de edição
   manual que já existe para os `.md`).
6. **Catálogo de MCP** segue o padrão do catálogo de skills: lista curada embutida + busca no registro público, e
   "colar comando/URL" para qualquer outro. Entradas seedadas só depois de conferidas na fonte.
7. **Catálogo de agentes** com dois níveis: **papel** (um agente: prompt, tools, skills e MCPs sugeridos) e **time**
   (um diagrama pronto, p. ex. «Landing page», «Revisão de PR», «Suporte»). Aplicar um time cria nós e conexões no
   diagrama aberto num único passo de desfazer.
8. Rodar processo para descobrir tools (handshake `tools/list`) **executa o comando do servidor**: só com clique do
   usuário e mostrando o comando antes.

## Vocabulário (schema.ts) — SUPERADO pela seção «Decisão tomada na implementação» abaixo (papel `tool`, relação `uses-tool`)

```typescript
type AgentRole = "agent" | "skill" | "mcp";
type McpTransport = "stdio" | "http" | "sse";
interface McpServerSpec {
  transport: McpTransport;
  command?: string;            // stdio
  args?: string[];             // stdio
  url?: string;                // http | sse
  env?: Record<string, string>;     // valores com ${VAR}; nunca segredo literal
  headers?: Record<string, string>; // idem
  tools?: { name: string; description?: string }[]; // descobertas (Fase 6), para o seletor de allow
  source?: { registry: string; id: string; version?: string }; // ausente = servidor próprio
}
// AgentNodeSpec += mcp?: McpServerSpec            (role "mcp")
// AgentRel      += "uses-mcp"                     (agent -> mcp)
// AgentConnSpec += allow?: string[]               (só em uses-mcp)
```

## Regras de validação novas (A010+)

| Id | Severidade | Regra |
| --- | --- | --- |
| A010 | erro | MCP sem `command` (stdio) ou sem `url` (http/sse) |
| A011 | erro | valor com cara de segredo literal em `env`/`headers` (não é `${VAR}`) |
| A012 | aviso | MCP órfão: sem `uses-mcp` e fora do Global (não entra no harness) |
| A013 | aviso | agente com `tools` explícito e `uses-mcp`: as tools `mcp__…` são adicionadas automaticamente; avisar a mudança |
| A014 | aviso | `uses-mcp` com alvo Cursor: sem isolamento por agente, vale para o projeto |
| A015 | aviso | `allow` cita tool que não está em `tools` descobertas do servidor |
| A016 | aviso | transporte `sse` (obsoleto) |
| A017 | aviso | duas variáveis `${VAR}` exigidas e sem valor conhecido no ambiente (só informativo, no teste de conexão) |

## Geração (agentgen)

- `generateHarness` passa a devolver também `.mcp.json` / `.cursor/mcp.json` (conteúdo só das chaves gerenciadas).
- Frontmatter Claude do agente: `mcpServers:` (inline ou nome) + `tools:` com `mcp__<id>` / `mcp__<id>__<tool>` somados
  às nativas (resolve o problema de "tools explícito esconde o MCP").
- `harnesssync`: novo tipo de arquivo "JSON mesclado". Atualiza só as chaves gerenciadas, preserva as demais e não
  apaga servidores que o usuário adicionou à mão; apaga a chave quando o nó sai do diagrama e o valor ainda é o gravado.

## Decisão tomada na implementação (2026-10-15): componente «Tool»

Em vez de um papel só para MCP, o diagrama ganhou o papel **`tool`**, com dois tipos: **nativa** (`toolType: "native"` +
`toolName`: Read, Write, Edit, Glob, Grep, Bash, WebFetch, WebSearch, NotebookEdit, TodoWrite, Agent) e **servidor MCP**
(`toolType: "mcp"` + `transport`, `command`/`args` ou `url`, `env`/`headers` com `${VAR}`, `mcpTools`). A relação é
**`uses-tool`** (agent → tool) com `usage` e, para MCP, `allow`. O campo de texto `tools` do agente ficou só como legado
(aviso A014 + botão «Converter em componentes»). Regras: A010 (sem command/url), A011 (segredo em texto puro),
A012 (tool órfã), A013 (tool sem tipo/nome), A014 (lista `tools` legada), A015 (`allow` inválido), A016 (sse).

Geração: `tools:` recebe as nativas + `mcp__<servidor>[__<tool>]`; **sem nenhuma nativa o `tools:` é omitido** (herda tudo,
inclusive MCP). MCP de UM agente vira `mcpServers` inline; Global ou 2+ agentes → `.mcp.json` (Claude) e referência por
nome. Cursor: `.cursor/mcp.json` com `${env:VAR}`. O sync mescla `.mcp.json`/`.cursor/mcp.json` por servidor
(`archflow.agents.json` → `servers`), preservando o que o usuário pôs.

## Progresso

- [x] Fases 1 e 3 (e a parte de edição da Fase 4): schema/ops/validação, `agentgen`, `harnesssync` com merge,
      inspetor da Tool (nativa e MCP), seção «Ferramentas» no agente, «Converter em componentes», `allow` na relação,
      arrastar/clicar «Tool» sobre um agente, schema do servidor MCP do Archflow. Testes em `agents.test.ts`,
      `agentgen.test.ts` e `harnesssync.test.ts`; conferido no navegador e com o Claude Code (`claude mcp list` lê o
      `.mcp.json` gerado e avisa da variável `${PW_TOKEN}` ausente).

- [ ] Fase 0 — confirmar as Decisões acima e a lista curada de MCPs (conferir cada entrada na fonte, sem inventar nomes de pacote)
- [x] (ver acima) Fase 1 — schema + ops + validação: `AgentRole "mcp"`, `McpServerSpec`, `uses-mcp` + `allow`, regras A010–A016,
      `describeAgents`/`schemaGuideAgents`/MCP do Archflow (`add_components`/`connect` aceitando `mcp`). Testes em `agents.test.ts`.
- [x] Fase 2 — catálogo de MCP (feito em 2026-10-15; o diálogo da Tool segue o da Skill: buscar nativas + curado + registro oficial, colar config, configurar à mão; asset Tool arrastado abre o diálogo; seção «Servidores MCP do catálogo» na biblioteca): `src/shared/mcpcatalog.ts` (curado, mesmo desenho do `skillcatalog.ts`), busca no registro
      público via bridge (para não esbarrar em CORS), parser de `.mcp.json` / `claude mcp add` colado.
- [x] (ver acima) Fase 3 — agentgen Claude e Cursor + `harnesssync` com merge de JSON; atualizar `agentgen.test.ts` e `harnesssync.test.ts`
      (merge preserva servidor manual; remove só o gerenciado; Cursor sem `mcpServers` no agente).
- [ ] Fase 4 — UI: asset **MCP** na biblioteca; seção «Servidores MCP do catálogo» (arrastar sobre agente = `uses-mcp`,
      sobre o Global = vale para todos); diálogo do servidor (aba Catálogo / aba Configurar: transporte, comando/URL,
      variáveis com indicação de "definida/faltando", seletor de tools permitidas); inspetor da relação `uses-mcp`.
- [ ] Fase 5 — catálogo de agentes: `src/shared/agentcatalog.ts` com papéis e times; aba **Agentes** na biblioteca;
      aplicar papel (cria o nó + sugestões de skills/MCP já ligadas) e aplicar time (vários nós, 1 passo de desfazer).
      Os times partem do que já funciona: o time «Landing page» (orquestrador + 5 agentes) criado em `FarmarcasLandingPage`.
- [ ] Fase 6 — «Testar servidor» (bridge): handshake `initialize` + `tools/list`, confirmação com o comando visível,
      timeout, saída resumida; preenche `tools` descobertas e habilita o seletor `allow`.
- [ ] Fase 7 — e2e: bridge grava `.mcp.json` e o frontmatter; teste headless com `claude -p` num projeto temporário
      (`claude mcp list` mostra o servidor; agente com `mcpServers` inline chama uma tool de servidor de teste local).
      Docs: `PROTOCOL.md` (rotas novas), `SKILL.md` do Archflow, `semantics-score.md` (valores novos).

## Backlog do loop (ordem de execução; marque ao concluir, uma tarefa por iteração)

Critério geral de pronto de TODA tarefa: `npx tsc --noEmit` limpo, `npm test` sem NOVAS falhas (a única falha conhecida é
«exemplos: os arquivos em examples/ estão em dia», anterior a este trabalho), testes novos para a lógica nova, e — se
houver UI — conferido no navegador numa instância isolada (ver `docs/AGENTS_TOOLS_LOOP_PROMPT.md`, seção «Ambiente»).

- [x] T1 (feito) — `mcpVars` em `mcpcatalog.ts`, rota `GET /api/mcp/env-check` (só booleanos), `McpVarsStatus` no inspetor da Tool MCP; testes em `mcpcatalog.test.ts` e `bridge.e2e.test.ts`; conferido no navegador (definida / usa o padrão / faltando). Fora: mostrar no card do diálogo. — **Variáveis do MCP: definida/faltando.** Na Tool MCP (inspetor e diálogo), listar as `${VAR}` usadas em
      `command/args/env/url/headers` e mostrar se cada uma existe no ambiente do bridge (`GET /api/mcp/env-check?names=A,B`
      → `{ A: true, B: false }`, SÓ booleanos, nunca o valor). Regra A017 (aviso) no `validate` do bridge não é possível
      (puro); mostrar só na UI. Testes: função pura que extrai variáveis (com e sem `:-padrão`) + rota do bridge.
- [x] T2 (feito) — `src/shared/placement.ts` (`freeSpotBelow`, `occupied`, 6 testes em `placement.test.ts`) usado por `plugSkill`, `plugTool` e `convertLegacyTools`; conferido no navegador: 5 tools plugadas ao lado de 2 agentes sem nenhuma sobreposição. Fora: o canvas não rola até o nó novo (ele pode nascer fora da tela). — **Posicionamento sem sobreposição.** `plugTool`/`plugSkill`/`convertLegacyTools` hoje empilham sob o agente e
      colidem com nós existentes. Criar `freeSpotBelow(doc, agent, w, h)` em `src/shared` (puro, testado) e usá-lo.
- [x] T3 (feito em 2026-10-15) — aplicado via `POST /api/ops` no diagrama aberto (bridge novo, `GET /api/harness/settings` 200): 20 tools nativas viraram componentes compartilhados, o nó «Tool» MCP vazio virou Playwright (catálogo) ligado ao `qa-reviewer`; o harness foi regravado sozinho (`.claude/agents/*.md` com `mcpServers` inline no QA e `mcp__playwright` em `tools`). Backup do JSON anterior no scratchpad da sessão. Fora: o Claude Code pede aprovação/trust da pasta antes de carregar o servidor inline; conferir o canvas a olho no navegador (não abri a UI). — **Migrar o diagrama da Farmarcas** (`~/Projetos/FarmarcasLandingPage`): só quando o bridge do usuário estiver na
      versão nova (conferir `GET /api/harness/settings` ≠ 404). Converter `tools` em componentes, ligar Playwright ao
      QA, regravar o harness e conferir `.claude/agents/*.md`. Se o bridge estiver antigo, NÃO mexer: registrar o bloqueio.
- [x] T4 (feito) — `src/shared/agentcatalog.ts` (5 papéis + 3 times: Landing page, Revisão de código, Pesquisa e relatório; `applyTemplate`, `searchAgentTemplates`, `findAgentTemplate`) e `agentcatalog.test.ts` (9 testes: validade, ausência de avisos, reaproveitamento de nós, sem sobreposição, determinismo). Skills entram com `source` sem `hash` (A006); MCP vem do `MCP_CATALOG`. Fora: UI (T5); o time da landing é largo (~3000px) porque cada agente reserva até 3 colunas para ferramentas. — **Catálogo de agentes (Fase 5), núcleo puro.** `src/shared/agentcatalog.ts`: `AgentRoleTemplate`
      (id, nome, descrição, prompt, tools nativas sugeridas, skills sugeridas por id do catálogo, MCPs sugeridos por id do
      `mcpcatalog`) e `AgentTeamTemplate` (agentes + relações com `usage` + grupo Global). Função pura
      `applyTemplate(doc, template, at) → Op[]` (ids únicos, sem colidir). Templates iniciais: papéis (orquestrador,
      revisor de código, pesquisador, QA de interface, redator) e o time «Landing page» (o da Farmarcas, sem a marca).
      Testes: todo template gera ops válidas num doc agents vazio, sem avisos A001/A002/A013/A018, e idempotência de ids.
- [x] T5 (feito) — `src/ui/agentcatalog.tsx` (`CatalogAgents` na biblioteca do modo agents + `applyAgentTemplate`: um passo de desfazer, seleciona os agentes, enquadra o resultado com `fitView`, entra abaixo do que já existe ou no ponto do drop) ligado em `panels.tsx` e `Canvas.tsx`; layout do `applyTemplate` compactado (colunas sob cada agente, ferramentas dos agentes-raiz ao lado): time da landing 18 nós em ~1200×660. Conferido no navegador: aplicar, enquadrar e desfazer em 1 passo. Fora: perguntar onde aplicar (decidi por padrão abaixo do conteúdo + arrastar); resolver as skills do catálogo automaticamente (por decisão, só ao abrir a skill). — **Catálogo de agentes, UI.** Aba **Agentes** na biblioteca (modo agents): papéis e times com busca; clicar/arrastar
      aplica num único passo de desfazer; aplicar time pergunta onde (canvas vazio ou ao lado). Skills do catálogo
      sugeridas entram como nós `source` NÃO resolvidos (a UI já resolve ao abrir) — não baixar nada sozinho.
- [x] T6 (feito) — `server/mcpprobe.ts` (`probeMcp` stdio e http/SSE com paginação, timeout, kill, máscara dos valores de `${VAR}`; `parseProbeBody`), rota `POST /api/mcp/probe` (400 sem `confirm: true` booleano; 502 com mensagem segura), servidor falso em `server/fixtures/fake-mcp-server.mjs`, testes em `mcpprobe.test.ts` (11) e `bridge.e2e.test.ts`; UI `McpProbe` no inspetor da Tool MCP (mostra o comando exato, confirma, lista as tools, «Usar como tools conhecidas» → `mcpTools`). Conferido no navegador, sem processo órfão. Fora: sonda dentro do diálogo do catálogo; sondar com a URL já expandida das variáveis no preview. — **Testar servidor MCP (Fase 6).** Bridge: `POST /api/mcp/probe { command,args,env | url,headers }` faz o handshake
      `initialize` + `tools/list` com timeout (10 s), devolve `{ tools:[{name,description}] }` e mata o processo. SÓ executa
      com `confirm: true` no corpo; a UI mostra o comando e pede confirmação. Variáveis `${VAR}` expandidas no bridge, nunca
      devolvidas. Preenche `mcpTools`. Testes com um servidor MCP falso em `server/fixtures` (stdio).
- [x] T7 (feito) — (a) e2e do bridge com Tools (`bridge.e2e.test.ts`: `.mcp.json`, inline vs compartilhado, `.cursor/mcp.json` com `${env:VAR}`, merge preserva servidor do usuário); (b) `server/claude.e2e.test.ts` com o Claude Code REAL (gated por `ARCHFLOW_E2E_CLAUDE=1`): subagente ligado a servidor compartilhado chamou a tool e devolveu `fake-ok:browser_snapshot`; (c) seção «Modo agents» em `skills/archflow/SKILL.md` + `npm run skill`; (d) `docs/PROTOCOL.md` e `docs/semantics-score.md`. ACHADOS: o `.mcp.json` fica «Pending approval» no Claude Code até o usuário aprovar; servidor INLINE só carrega com a pasta confiável (trust); toda tool MCP precisa de `inputSchema`. A UI e a skill avisam disso. Fora: testar o inline de ponta a ponta (exige trust, que mora em `~/.claude.json`). — **Integração (Fase 7).** (a) e2e do bridge: gravar `.mcp.json` + frontmatter a partir de um doc com Tool; (b) teste
      headless com `claude -p` num projeto temporário usando o servidor falso de T6, provando que um agente com
      `mcpServers` inline enxerga a tool (`mcp__<id>__<tool>`); (c) regenerar `src/shared/skill.generated.ts` /
      `skills/archflow/SKILL.md` com Tool e `uses-tool`; (d) `docs/PROTOCOL.md` (rotas `/api/harness/settings`,
      `/api/mcp-registry/search`, `/api/mcp/env-check`, `/api/mcp/probe`) e `docs/semantics-score.md` (role `tool`, rel `uses-tool`).
- [x] T8 (feito em 2026-10-15) — suíte completa: 447/449 passam; 1 falha anterior ao trabalho («exemplos: os arquivos em examples/ estão em dia») e 1 teste ignorado (`claude.e2e`, só com `ARCHFLOW_E2E_CLAUDE=1`, que passou quando rodado). `tsc` limpo. FICOU FORA: T3 (migrar o diagrama da Farmarcas: o bridge do usuário não estava de pé, `localhost:7077` sem resposta); aviso de aprovação do Claude Code também ao gravar o harness (hoje só no diálogo da Tool e na skill); sonda dentro do diálogo do catálogo; status das variáveis nos cards; rolar o canvas até o nó plugado; teste de ponta a ponta do MCP inline (exige trust da pasta). O USUÁRIO PRECISA: reiniciar `npm run dev` (o servidor em execução, quando existir, roda código antigo) e, depois, abrir o diagrama da Farmarcas e usar «Converter em componentes». — **Fechamento.** Rodar a suíte completa, listar o que ficou fora, atualizar «Progresso», e parar o loop.

Pendências que NÃO são do loop (não fazer sem pedir): commits; reiniciar o `npm run dev` do usuário; corrigir a falha
pré-existente dos exemplos.

## Riscos

- Executar comandos de catálogo/colados (Fase 6 e primeira conexão do Claude): sempre mostrar o comando e pedir confirmação.
- `.mcp.json` é versionado: os segredos têm de ficar em variáveis de ambiente e o Archflow não pode gravá-los.
- Cursor sem escopo por agente pode surpreender quem espera isolamento: avisos A014 e texto no corpo do agente.
- A lista curada envelhece: guardar `source.version` e comparar no refresh, como o hash das skills.

## Instrução para o próximo passo

Pegue a primeira fase não marcada. Comece pela Fase 0: apresente ao usuário a lista curada candidata (com a fonte de
cada item) e as decisões 1–8 para confirmação. Só depois escreva código.
