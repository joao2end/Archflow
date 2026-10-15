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
- [ ] Fase 1 — `schema.ts`: tipos, roles, rels, pairs
- [ ] Fase 1b — corrigir switches exaustivos quebrados pelos novos kinds (`ops.ts`, `Canvas.tsx`, `mcp.ts`)
- [ ] Fase 2 — catálogo curado + resolver `owner/repo` via GitHub
- [ ] Fase 3 — `src/shared/agents.ts`: validação (A001+), `MODE_KINDS.agents` em `ops.ts`
- [ ] Fase 4 — UI: `src/ui/agents.tsx`, aba Skills no painel, drag-to-plug
- [ ] Fase 5 — `src/shared/agentgen.ts`: gera harness pros dois alvos
- [ ] Fase 6 — zip sem dependência, rota de escrita no bridge, `generate_code` modo agents no MCP
- [ ] Fase 7 — manifesto `archflow.agents.json`, `import_harness`, detecção de hash/drift
- [ ] Fase 8 — testes (`agents.test.ts`, `agentgen.test.ts`, `zip.test.ts`, golden, e2e)

## Instrução para o próximo tick do loop

Leia este arquivo. Pegue a primeira fase não marcada em "Progresso". Trabalhe nela até terminar ou
até um ponto seguro de parar (build verde, `npm run typecheck` sem erro). Marque o checkbox, rode
`npm run typecheck`, e pare o tick. Não reabra as "Decisões fechadas" sem perguntar ao usuário.
