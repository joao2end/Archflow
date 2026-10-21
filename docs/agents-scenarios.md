# Modo agents — matriz de cenários e estado da cobertura

Mapa de tudo que o modo `agents` faz, cruzado com onde cada cenário é testado. Atualize quando um cenário
mudar; uma linha só sai de «pendente» com teste que passa (unitário) ou roteiro E2E executado.

Legenda de cobertura: **U** = teste unitário (`src/shared/*.test.ts`) · **E** = E2E no navegador
(Edge via `playwright-core`, ver «Como rodar o E2E») · **—** = sem cobertura.

## 1. Validação de entrada (ops.ts → agents.ts)

| Cenário | Cobertura | Arquivo |
|---|---|---|
| `checkAgentNode`: não-objeto, papel inválido (lista os válidos) | U | agents.scenarios.test.ts |
| Campo de outro papel recusado (ex.: `model` em skill) | U | agents.scenarios.test.ts |
| `undefined` em campo não conta como campo extra | U | agents.scenarios.test.ts |
| Tipos errados: texto, listas, `env`/`headers` | U | agents.scenarios.test.ts |
| `toolType` e `transport` com valores fechados | U | agents.scenarios.test.ts |
| `mcpSource` (catalog, id, version, campos extras) | U | agents.scenarios.test.ts |
| `source` de catálogo (repo `owner/repo`, skillPath, hash) | U | agents.scenarios.test.ts |
| `checkAgentConn`: rel obrigatório, campos, usage, allow só em uses-tool | U | agents.scenarios.test.ts |
| `order`/`mode` só em `step`; order inteiro ≥ 1; mode manual\|auto | U | agents.scenarios.test.ts |
| Conexão com `type` que contradiz a relação | U | agents.test.ts / agents.scenarios.test.ts |
| `update` troca de papel e descarta campos do papel antigo | U | agents.scenarios.test.ts |
| `add_connection` sem `agent` infere a relação quando há um único par possível | U | agents.scenarios.test.ts |
| `add_node` agent em modo ≠ agents recusado com mensagem | U | agents.test.ts |

## 2. Regras de qualidade (agentIssues)

| Regra | Severidade | Cenário | Cobertura |
|---|---|---|---|
| A001 | erro / aviso | agent sem description / description curta | U |
| A002 | erro / aviso | skill (e tool sem native) sem description / curta | U (skill) · tool: — |
| A003 | aviso | skill órfã; dentro do Global não é órfã | U |
| A004 | aviso | uses-skill redundante para skill já global | U |
| A005 | erro | ciclo de delegates (2 e 3 nós); cadeia sem volta não | U |
| A006 | aviso | skill de catálogo sem hash | U |
| A008 | aviso | relação em par inválido, com sugestão quando existe | U |
| A009 | aviso | conexão sem relação; par sem nenhuma relação | U |
| A010 | erro | MCP stdio sem command; http/sse sem url | U |
| A011 | erro | segredo literal em env/headers; `${VAR}` não dispara | U |
| A012 | aviso | tool sem agent; no Global ou com seta não | U |
| A013 | erro / aviso | tool sem toolType; nativa sem toolName; nome desconhecido | U |
| A014 | aviso | campo `tools` em texto no agent | U |
| A015 | aviso | allow citando tool inexistente; allow em tool nativa | U |
| A016 | aviso | transporte sse obsoleto | U |
| A018 | aviso | relação sem usage / usage curto | U |
| A020 | erro | prompt sem text | U |
| A021 | aviso | runs-on para mais de um agente | U |
| A022 | aviso | workflow sem passos | U |

Lacunas de numeração encontradas: **A007, A019 e A023 não existem** no código. Não é bug por si, mas a
documentação de regras (`schemaGuideAgents`, `docs/agents-mode-plan.md`) não diz que os códigos são
esparsos. Decisão pendente: documentar a lacuna ou renumerar (renumerar quebra quem já citou o código).

Regra A002 de **tool** sem description: a condição `!t.toolType` / `toolType !== "native"` faz a tool
nativa não cair nela. Coberto só pelo caminho de skill; caso de tool MCP sem description segue sem teste.

## 3. Descrição, guia e prompts

| Cenário | Cobertura |
|---|---|
| `describeAgents`: agentes, skills, ferramentas, prompts, workflows, avisos com id de regra | U (agents.test.ts) |
| `describeAgents` mostra o «como usa» de cada relação | U |
| `schemaGuide("agents")` lista papéis, relações e fluxo; architecture não muda | U |
| `workflowSteps`: ordem por `order`, fallback para ordem das setas, ignora alvo que não é prompt | U (scenarios) |
| `isOrchestrator` / `testPrompt` (agentprompt.ts) | U (agentprompt.test.ts) |
| Texto do prompt de teste "Use o subagente X para: " | U |

## 4. Escopo global e segredos

| Cenário | Cobertura |
|---|---|
| `inGlobalGroup` em grupo aninhado; id inexistente; pai fantasma não trava | U |
| `looksLikeSecret`: chave sensível, prefixos (sk-, ghp_, AKIA, Bearer), `${VAR}`, valores comuns | U |
| Relação `agent → tool` (`uses-tool`) e `allow` | U |

## 5. Templates, catálogo e harness

| Cenário | Cobertura |
|---|---|
| Templates (`AGENT_TEMPLATES`, `applyTemplate`, busca) | U (agentcatalog.test.ts) |
| Catálogo de skills: busca, parse de URL do GitHub, hash, resolver com fetch mockado (ok, 404, rede, sem fetch), drift | U (skillcatalog.test.ts) |
| Gerador de harness Claude e Cursor (frontmatter `skills:`, `tools:`, `mcpServers`, `.mcp.json`) | U (agentgen.test.ts) |
| Harness sem tool nativa omite `tools:` | U |
| Harness de diagrama fora do modo agents é recusado | U |
| Zip do harness (método store) | U (zip.test.ts) |
| `POST /api/harness` grava `.claude/` ou `.cursor/`; target inválido; diagrama de outro modo | U (bridge.e2e.test.ts) |
| Manifesto `archflow.agents.json`: arquivo que saiu do diagrama é apagado só se ainda é o gravado; editado à mão vira conflito; merge de `.mcp.json` por servidor | U (server/harnesssync.test.ts, 11 casos) |
| Drift: `harnessDiff` e `GET /api/harness/status` | U (harnesssync.test.ts) |
| `harnessToOps`: `.claude/agents` + `.claude/skills` → ops (agente, skill, `uses-skill` pelo `skills:`, prompt pelo corpo) | U (agentimport.test.ts) |
| Ida e volta: `generateHarness` → `harnessToOps` preserva agentes, skills, model e uses-skill | U |
| `POST /api/harness/import`: só leitura, recusa modo ≠ agents e projeto sem pasta; preview não muda o diagrama; aplicar passa por `/api/ops` | U (bridge.e2e.test.ts) |
| Tool MCP `import_harness` (preview; `apply: true` aplica) e documentada na skill | U (mcp.e2e.test.ts, documentação) |
| `import_harness` na UI: botão «Importar do projeto» na aba Harness | E (imp: nó recriado, aviso com o primeiro item que não volta) |
| Importar «como usa», `delegates`, tools e `mcpServers` | U (agentimport.test.ts: vão para `skipped`, não reconstruídos) |

## 6. Interface (E2E)

| Roteiro | Cobertura |
|---|---|
| Abrir o app em `/app` sem erro de console | E (smoke) |
| Seletor de modo (`Agents`) lista e marca o modo ativo do diagrama | E (flow1) |
| Estado vazio do canvas no modo agents mostra a dica de primeiros passos | E (flow1, visual) |
| Abrir biblioteca e adicionar um modelo do time ("Revisor de código"): cria agente + 3 tools com uses-tool | E (r1, 2026-10-17: 4 nós, 3 setas) |
| Criar skill avulso pelo card SKILL da biblioteca (atalho B) | E (r10: nó «Skill», papel skill, subtítulo «Skill») |
| Criar prompt e workflow avulsos pelos cards PROMPT e FLOW | E (r11: nó prompt; r12: nó workflow) |
| Criar agent avulso pelo card AGENT | E (r13: nó agent, técnico «Agent») |
| Ligar agent → skill por seta e ver o `uses-skill` | E (arrow: seta criada como uses-skill) |
| Arrastar skill do card sobre agent (`plugSkill`): cria o nó e liga uses-skill | E (plug: 1 skill nova, 1 seta uses-skill) |
| Abrir o diálogo próprio da skill (Catálogo / Escrever) pelo botão «Escrever do zero» do inspetor | E (r7: diálogo abre na aba Escrever, mostra «Usar estrutura sugerida») |
| Duplo clique no nó da skill abre o diálogo | E (d11: após a correção de D-11, o duplo clique de mouse abre o diálogo) |
| Modal de Agents: abas Harness com prévia e troca de alvo | E (r3: prévia do revisor com frontmatter; troca de alvo não testada) |
| Exportar harness: «Gravar no projeto» cria `.claude/agents/*.md` | E (r4) |
| Sincronização automática com a caixa marcada, em projeto sem configuração | E: nada é gravado (ver D-10) |
| Modal de validação lista os avisos A0xx (A003 em skill solta) | E (r2) |
| Painel «Prompts» do terminal lista o prompt do diagrama | E (term: prompt listado) |
| Terminal: prompt executa com «Use o subagente…» | — (execução exige login do Claude Code; não roteirizada) |

## Como rodar

- Unitário: `npx tsx --test src/shared/agents.scenarios.test.ts src/shared/agents.test.ts src/shared/agentgen.test.ts`
- Suite completa: `npm test` (falha conhecida e anterior: «exemplos: os arquivos em examples/ estão em dia»).
- E2E: Vite isolado (`ARCHFLOW_PORT=7090 ARCHFLOW_CONFIG=… ARCHFLOW_DATA=… npx vite --configLoader runner --port 5190`)
  e um script com `playwright-core` usando `channel: "msedge"` (o MCP Playwright do ambiente espera o Chrome
  em `C:\Users\…\Google\Chrome`, que não está instalado nesta máquina; o Edge está).
