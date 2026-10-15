# Modo `agents` — plano de implementação

> Gerado pela discussão em chat (ver transcript). Este arquivo é o estado persistente lido/escrito
> por cada tick do loop de implementação. Não apague as seções "Decisões" e "Progresso" — são a
> fonte da verdade entre turnos.

## Decisões fechadas (não reabrir sem o usuário)

- Escopo do MVP: só `agent` + `skill` + relações entre eles (`uses-skill`, `delegates`). Commands,
  hooks, mcp e rules ficam para depois.
- Catálogo: lista curada embutida (estilo `BUILTIN_ASSETS`) + colar `owner/repo` ou URL do skills.sh
  pra qualquer skill fora da lista. Sem API pública do skills.sh — resolve via GitHub direto
  (source/skillPath, mesmo formato do `skills-lock.json` que já existe no projeto).
- Conteúdo de skill baixado é copiado para `.archflow/skills/<nome>/` no projeto (funciona offline).
- Manutenção: manifesto próprio `archflow.agents.json` (hash por arquivo gerado) + compatível com
  `skills-lock.json` pras skills de catálogo.
- "Cofre" é renomeado para "projeto"; um projeto é a pasta aberta, pode ter vários diagramas
  (architecture/domain/logic/agents) e o harness (`.claude/`, `.cursor/`) dentro dela. Dá pra abrir
  vários projetos, só um ativo por vez.
- Global = grupo no canvas (`GroupKind: "global"`). Skill dentro dele vale para todos os agentes,
  sem seta `uses-skill`.
- **Fase 0 resolvida (campos nos alvos):**
  - Claude Code: subagente tem `skills: [nome1, nome2]` no frontmatter — pré-carrega a skill no
    agente. É a materialização nativa de `uses-skill`.
  - Cursor: subagente (`.cursor/agents/*.md`) só tem `name, description, model, readonly,
    is_background` — **sem** campo de skill. `uses-skill` nesse alvo é só documentação (seção no
    corpo do agente); a skill ainda é escrita em `.cursor/skills/<nome>/` e fica disponível ao
    projeto todo, não isolada ao agente.
  - Consequência: o inspetor do nó `agent` precisa avisar essa diferença entre alvos ao usuário.

## Vocabulário (schema.ts)

```typescript
type DocMode = "architecture" | "domain" | "logic" | "agents";
// NodeKind += "agent"
// GroupKind += "global"
type AgentRole = "agent" | "skill";
interface AgentNodeSpec {
  role: AgentRole;
  // role "agent"
  description?: string; // quando o orquestrador deve delegar pra ele
  model?: string;        // "inherit" | alias | id completo
  tools?: string[];
  prompt?: string;       // corpo do system prompt (markdown)
  // role "skill"
  body?: string;         // corpo do SKILL.md (markdown)
  source?: { repo: string; skillPath: string; hash?: string }; // ausente = skill própria
}
type AgentRel = "uses-skill" | "delegates";
// uses-skill: agent -> skill (ConnectionType "dependency")
// delegates:  agent -> agent (ConnectionType "sync")
```

## Progresso

- [x] Fase 0 — campos de skill confirmados nos dois alvos (ver "Decisões" acima)
- [x] Fase 1 — `schema.ts`: `DocMode "agents"`, `NodeKind "agent"`, `GroupKind "global"`,
      `AgentNodeSpec`, `AGENT_ROLES`, `AgentRel`, `AGENT_REL_PAIRS`, `NodeEl.agent`,
      `ConnectionEl.agent`. Commit `85d56f8`.
- [x] Fase 1b — só 3 breakages de verdade (switches exaustivos em `tour.ts` e `files.tsx`; o resto
      do projeto não é exaustivo sobre `NodeKind`/`GroupKind`). Corrigidos + ícone novo
      `mode-agents` em `icons.tsx`. Além disso, achei e corrigi de passagem um bug real: `ops.ts`
      descartava silenciosamente `mode: "agents"` em `normalizeDoc` e rejeitava em `set_meta` — não
      fazia parte do escopo original da fase, mas era a mesma função que o filtro do golden test
      tocava, e deixar quebrado teria escondido o bug até a Fase 3. `npx tsc --noEmit` limpo,
      328/328 testes passando (golden `arch.golden.test.ts` e inventário `semantics.test.ts`
      atualizados — este último exige frase + linha na matriz pra cada valor novo; já documentei
      `agent.role` e `AgentRel` em `docs/semantics-score.md` embora o teste ainda não exija, pra
      não ficar inconsistente com o padrão do arquivo). Commit `85d56f8`.
- [ ] Fase 2 — catálogo curado + resolver `owner/repo` via GitHub (ainda não iniciada; a validação
      do formato `source: { repo, skillPath, hash? }` já existe desde a Fase 3, mas a lista
      curada embutida e o resolver HTTP contra o GitHub seguem pendentes)
- [x] Fase 3 — `src/shared/agents.ts` (checkAgentNode/Conn, agentRelEnd/Allows/suggest,
      agentConnectionTypeError, inGlobalGroup, `agentIssues` A001–A009, `describeAgents`,
      `schemaGuideAgents`) + wiring completo em `ops.ts`: `MODE_KINDS.agents`, `add_node`/
      `add_connection`/`update` aceitando `agent`, dispatch de `validateDetailed` (BASE checks de
      `kind "agent"`, exclusão da regra de "nó isolado" — isolamento é normal num time de agentes
      — e push de `agentIssues`), dispatch de `describe` → `describeAgents`, dispatch de
      `schemaGuide("agents")` → `schemaGuideAgents` (antes caía incorretamente no guia de
      architecture). Regras implementadas: A001 (agent sem/curta description), A002 (skill
      sem/curta description), A003 (skill órfã: sem uses-skill e fora do Global), A004 (seta
      uses-skill redundante p/ skill já global), A005 (ciclo de delegates), A006 (skill de
      catálogo ainda não resolvida, sem hash), A008 (par de papéis inválido pra relação), A009
      (conexão do modo sem relação). Testes novos em `agents.test.ts` (18 casos, cobrindo schema,
      ops, as 7 regras e describe/schemaGuide). `npx tsc --noEmit` limpo, 346/346 testes passando
      (328 + 18 novos). Commit `<preencher no commit>`.
- [ ] Fase 4 — UI: `src/ui/agents.tsx`, aba Skills no painel, drag-to-plug
- [ ] Fase 5 — `src/shared/agentgen.ts`: gera harness pros dois alvos
- [ ] Fase 6 — zip sem dependência, rota de escrita no bridge, `generate_code` modo agents no MCP
- [ ] Fase 7 — manifesto `archflow.agents.json`, `import_harness`, detecção de hash/drift
- [ ] Fase 8 — testes (`agents.test.ts`, `agentgen.test.ts`, `zip.test.ts`, golden, e2e)

## Instrução para o próximo tick do loop

Leia este arquivo. Pegue a primeira fase não marcada em "Progresso". Trabalhe nela até terminar ou
até um ponto seguro de parar (build verde). Marque o checkbox com o que foi feito e o que falta,
rode `npx tsc --noEmit` e `npm test`, comite (mensagem curta em inglês, estilo do `git log`), e só
depois **rearme o próximo tick** (mesmo mecanismo: shell em background com `sleep` + `echo` do
sentinel `AGENT_LOOP_WAKE_agents_mode`, `notify_on_output` com o mesmo padrão) antes de terminar o
turno. Não reabra as "Decisões fechadas" sem perguntar ao usuário. Se travar numa decisão que não
está nas "Decisões fechadas", pare o loop (não rearme) e pergunte.
