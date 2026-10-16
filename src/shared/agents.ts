/**
 * Modo agents (times de agentes de IA): validação de entrada das ops, regras (A001+), descrição
 * para LLMs e o guia do modo.
 *
 * Só depende de `schema.ts` (`ops.ts` importa este módulo, nunca o contrário). Determinístico:
 * a mesma entrada produz sempre a mesma saída.
 */
import {
  AGENT_REL_KEYS,
  AGENT_REL_PAIRS,
  AGENT_RELS,
  AGENT_ROLE_KEYS,
  AGENT_ROLES,
  MCP_TRANSPORTS,
  NATIVE_TOOL_NAMES,
  NATIVE_TOOLS,
  SCHEMA_VERSION,
  type AgentField,
  type AgentNodeSpec,
  type AgentRel,
  type AgentRelEnd,
  type ConnectionType,
  type Doc,
  type NodeEl,
} from "./schema";
import type { Issue } from "./domain";

/* ───────────────────────── validação de entrada das ops ───────────────────────── */

/** Valida o objeto `agent` de um nó. Devolve a mensagem de erro (acionável) ou undefined. */
export function checkAgentNode(agent: unknown): string | undefined {
  if (!agent || typeof agent !== "object") return "agent deve ser um objeto { role, ... }";
  const a = agent as Record<string, unknown>;
  const role = a.role as string;
  if (!AGENT_ROLE_KEYS.includes(role as never)) return `agent.role inválido "${role}". Válidos: ${AGENT_ROLE_KEYS.join(", ")}`;
  const allowed = new Set<string>(["role", ...AGENT_ROLES[role as keyof typeof AGENT_ROLES].fields]);
  for (const k of Object.keys(a)) {
    if (a[k] === undefined) continue;
    if (!allowed.has(k)) return `campo "${k}" não existe no papel "${role}". Campos do papel: ${[...allowed].filter((f) => f !== "role").join(", ") || "(nenhum)"}`;
  }
  for (const f of ["description", "model", "prompt", "body"] as AgentField[]) {
    if (a[f] !== undefined && typeof a[f] !== "string") return `agent.${f} deve ser texto`;
  }
  for (const f of ["toolName", "command", "url"]) {
    if (a[f] !== undefined && typeof a[f] !== "string") return `agent.${f} deve ser texto`;
  }
  for (const f of ["tools", "args", "mcpTools"]) {
    if (a[f] !== undefined && (!Array.isArray(a[f]) || (a[f] as unknown[]).some((x) => typeof x !== "string"))) return `agent.${f} deve ser uma lista de textos`;
  }
  if (a.toolType !== undefined && a.toolType !== "native" && a.toolType !== "mcp") return 'agent.toolType deve ser "native" (tool do Claude Code) ou "mcp" (servidor MCP)';
  if (a.transport !== undefined && !(a.transport as string in MCP_TRANSPORTS)) return `agent.transport inválido "${a.transport}". Válidos: ${Object.keys(MCP_TRANSPORTS).join(", ")}`;
  if (a.mcpSource !== undefined) {
    const m = a.mcpSource as Record<string, unknown> | null;
    if (!m || typeof m !== "object" || Array.isArray(m)) return "agent.mcpSource deve ser um objeto { catalog, id, version? }";
    for (const k of Object.keys(m)) if (!["catalog", "id", "version"].includes(k)) return `agent.mcpSource não tem o campo "${k}". Campos: catalog, id, version`;
    if (!["curated", "registry", "pasted"].includes(m.catalog as string)) return 'agent.mcpSource.catalog deve ser "curated", "registry" ou "pasted"';
    if (typeof m.id !== "string" || !m.id) return "agent.mcpSource.id deve ser texto";
    if (m.version !== undefined && typeof m.version !== "string") return "agent.mcpSource.version deve ser texto";
  }
  for (const f of ["env", "headers"]) {
    const m = a[f];
    if (m !== undefined && (!m || typeof m !== "object" || Array.isArray(m) || Object.values(m as object).some((v) => typeof v !== "string"))) return `agent.${f} deve ser um objeto { NOME: "valor ou \${VAR}" }`;
  }
  if (a.source !== undefined) {
    if (!a.source || typeof a.source !== "object" || Array.isArray(a.source)) return "agent.source deve ser um objeto { repo, skillPath, hash? }";
    const s = a.source as Record<string, unknown>;
    for (const k of Object.keys(s)) if (k !== "repo" && k !== "skillPath" && k !== "hash") return `agent.source não tem o campo "${k}". Campos: repo, skillPath, hash`;
    if (typeof s.repo !== "string" || !/^[^/\s]+\/[^/\s]+$/.test(s.repo)) return 'agent.source.repo deve ser "owner/repo" (ex.: "anthropics/skills")';
    if (typeof s.skillPath !== "string" || !s.skillPath.trim()) return "agent.source.skillPath deve ser o caminho do SKILL.md no repositório";
    if (s.hash !== undefined && typeof s.hash !== "string") return "agent.source.hash deve ser texto";
  }
  return undefined;
}

/** Troca o papel de um nó mantendo só os campos que o novo papel aceita (não deixa lixo de campos de outro papel). */
export function reshapeAgent(old: AgentNodeSpec | undefined, role: AgentNodeSpec["role"]): AgentNodeSpec {
  const next: Record<string, unknown> = { role };
  for (const f of AGENT_ROLES[role].fields) {
    const v = (old as unknown as Record<string, unknown> | undefined)?.[f];
    if (v !== undefined) next[f] = v;
  }
  return next as unknown as AgentNodeSpec;
}

/** Valida o objeto `agent` (`AgentConnSpec`) de uma conexão. */
export function checkAgentConn(agent: unknown): string | undefined {
  if (!agent || typeof agent !== "object") return "agent deve ser um objeto { rel, usage? }";
  const a = agent as { rel?: string; usage?: unknown; allow?: unknown };
  for (const k of Object.keys(a)) if (k !== "rel" && k !== "usage" && k !== "allow") return `conexão do modo agents não tem o campo "${k}". Campos: rel, usage, allow`;
  if (!AGENT_REL_KEYS.includes(a.rel as never)) return `agent.rel inválido "${a.rel}". Válidos: ${AGENT_REL_KEYS.join(", ")}`;
  if (a.usage !== undefined && typeof a.usage !== "string") return "agent.usage deve ser um texto: como o agente de origem usa o destino";
  if (a.allow !== undefined && (!Array.isArray(a.allow) || a.allow.some((x) => typeof x !== "string"))) return "agent.allow deve ser uma lista com os nomes das tools do servidor MCP que o agente pode chamar";
  if (a.allow !== undefined && a.rel !== "uses-tool") return `agent.allow só vale em uses-tool (esta conexão é ${a.rel})`;
  return undefined;
}

/* ───────────────────────── índice do modelo ───────────────────────── */

/** Ponta de uma conexão para fins de relação: o papel do agent/skill, ou undefined (fora do vocabulário). */
export function agentRelEnd(doc: Doc, id: string): AgentRelEnd | undefined {
  return doc.nodes.find((n) => n.id === id)?.agent?.role;
}

export const agentRelAllows = (rel: AgentRel, from: AgentRelEnd | undefined, to: AgentRelEnd | undefined) =>
  !!from && !!to && AGENT_REL_PAIRS[rel].some((p) => p.from.includes(from) && p.to.includes(to));

/** Relações possíveis entre dois elementos (normalmente uma só: os pares do modo agents não se sobrepõem). */
export function suggestAgentRels(doc: Doc, fromId: string, toId: string): AgentRel[] {
  const f = agentRelEnd(doc, fromId);
  const t = agentRelEnd(doc, toId);
  return AGENT_REL_KEYS.filter((r) => agentRelAllows(r, f, t));
}

/** Combinações válidas de uma relação em texto, para mensagens ("agent → skill"). */
export const agentRelPairsText = (rel: AgentRel) => AGENT_REL_PAIRS[rel].map((p) => `${p.from.join("|")} → ${p.to.join("|")}`).join(" ; ");

/** Erro de um conector que o modo agents não aceita (tipo que contradiz a relação); undefined se estiver ok. */
export function agentConnectionTypeError(rel: AgentRel | undefined, type: ConnectionType | undefined): string | undefined {
  if (!type || !rel) return undefined;
  const want = AGENT_RELS[rel].type;
  return type === want ? undefined : `a relação "${rel}" fixa o type em "${want}" (recebeu "${type}"); omita type ou remova a relação (agent: null) para escolher outro tipo`;
}

/** true quando o id (nó ou grupo) está dentro de um grupo kind "global", em qualquer profundidade. */
export function inGlobalGroup(doc: Doc, id: string): boolean {
  const groups = new Map(doc.groups.map((g) => [g.id, g]));
  let cur = doc.nodes.find((n) => n.id === id)?.parent ?? groups.get(id)?.parent;
  for (let i = 0; i < 50 && cur; i++) {
    const g = groups.get(cur);
    if (!g) return false;
    if (g.kind === "global") return true;
    cur = g.parent;
  }
  return false;
}

/** Valor de `env`/`headers` que parece um segredo escrito em texto puro (deveria ser `${VAR}`). */
export function looksLikeSecret(key: string, value: string): boolean {
  if (value.includes("${")) return false;
  return /key|token|secret|passw|authorization|bearer|credential/i.test(key) || /^(sk-|ghp_|gho_|github_pat_|xox[bap]-|AKIA|Bearer\s+[A-Za-z0-9._-]{8,})/.test(value);
}

/* ───────────────────────── regras (A001+) ───────────────────────── */

export function agentIssues(doc: Doc): Issue[] {
  const issues: Issue[] = [];
  const add = (rule: string, severity: Issue["severity"], message: string, target?: string) => issues.push({ rule, severity, message, target });
  const nodes = doc.nodes.filter((n) => n.agent);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const quote = (n: NodeEl) => `"${n.label}" (${n.id})`;

  for (const n of nodes) {
    const spec = n.agent as AgentNodeSpec;
    const short = (spec.description?.length ?? 0) > 0 && (spec.description as string).length < 20;
    if (spec.role === "agent") {
      if (!spec.description) add("A001", "erro", `${quote(n)}: agent sem description — é ela que diz ao orquestrador quando delegar para este agente`, n.id);
      else if (short) add("A001", "aviso", `${quote(n)}: description curta demais para o orquestrador decidir quando delegar; diga o quando, não só o quê`, n.id);
    }
    if (spec.role === "skill") {
      if (!spec.description) add("A002", "erro", `${quote(n)}: skill sem description — é ela que o agente usa para decidir quando puxar a skill`, n.id);
      else if (short) add("A002", "aviso", `${quote(n)}: description curta demais para o agente decidir quando usar a skill`, n.id);
      if (spec.source && !spec.source.hash) add("A006", "aviso", `${quote(n)}: skill do catálogo (${spec.source.repo}) ainda não foi baixada/resolvida; o conteúdo (body) está vazio até resolver`, n.id);
    }
  }

  // ferramentas: A010–A017
  const toolNodes = nodes.filter((n) => n.agent?.role === "tool");
  const toolUsedBy = new Set(doc.connections.filter((c) => c.agent?.rel === "uses-tool").map((c) => c.to));
  for (const n of toolNodes) {
    const t = n.agent as AgentNodeSpec;
    if (!t.description && t.toolType !== "native") add("A002", "aviso", `${quote(n)}: ferramenta sem description — diga o que ela faz para o agente saber quando usar`, n.id);
    if (!t.toolType) add("A013", "erro", `${quote(n)}: tool sem toolType — escolha "native" (Read, Bash…) ou "mcp" (servidor MCP)`, n.id);
    else if (t.toolType === "native") {
      if (!t.toolName) add("A013", "erro", `${quote(n)}: tool nativa sem toolName (ex.: ${NATIVE_TOOL_NAMES.slice(0, 4).join(", ")})`, n.id);
      else if (!NATIVE_TOOL_NAMES.includes(t.toolName)) add("A013", "aviso", `${quote(n)}: "${t.toolName}" não é uma tool nativa conhecida (${NATIVE_TOOL_NAMES.join(", ")}); confira o nome exato`, n.id);
    } else {
      const transport = t.transport ?? (t.url ? "http" : "stdio");
      if (transport === "stdio" && !t.command?.trim()) add("A010", "erro", `${quote(n)}: servidor MCP stdio sem command (ex.: npx)`, n.id);
      if (transport !== "stdio" && !t.url?.trim()) add("A010", "erro", `${quote(n)}: servidor MCP ${transport} sem url`, n.id);
      if (transport === "sse") add("A016", "aviso", `${quote(n)}: transporte sse é obsoleto; prefira http se o servidor suportar`, n.id);
      for (const [where, map] of [["env", t.env], ["headers", t.headers]] as const) {
        for (const [k, v] of Object.entries(map ?? {})) {
          if (looksLikeSecret(k, v)) add("A011", "erro", `${quote(n)}: ${where}.${k} parece um segredo escrito em texto puro; use uma variável de ambiente, ex.: "\${${k.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}}"`, n.id);
        }
      }
    }
    if (!toolUsedBy.has(n.id) && !inGlobalGroup(doc, n.id)) add("A012", "aviso", `${quote(n)}: ferramenta sem nenhum agent usando (nem seta uses-tool, nem dentro do grupo Global) — não entra em nenhum harness exportado`, n.id);
  }
  for (const c of doc.connections) {
    if (c.agent?.rel !== "uses-tool") continue;
    const to = byId.get(c.to)?.agent;
    if (c.agent.allow?.length && to?.role === "tool") {
      if (to.toolType !== "mcp") add("A015", "aviso", `${c.from} —uses-tool→ ${c.to}: allow só vale para servidor MCP; tools nativas não têm sub-tools`, c.id);
      else if (to.mcpTools?.length) {
        const unknown = c.agent.allow.filter((x) => !to.mcpTools!.includes(x));
        if (unknown.length) add("A015", "aviso", `${c.from} —uses-tool→ ${c.to}: allow cita tool que o servidor não lista (${unknown.join(", ")}); conhecidas: ${to.mcpTools.join(", ")}`, c.id);
      }
    }
  }
  for (const n of nodes.filter((n) => n.agent?.role === "agent" && n.agent.tools?.length)) {
    add("A014", "aviso", `${quote(n)}: usa o campo de texto "tools"; modele como componentes Tool ligados por uses-tool (aparecem no diagrama, aceitam MCP e têm «como usa»)`, n.id);
  }

  // A003 skill órfã: nem uses-skill de algum agent, nem dentro do grupo Global
  const usedBy = new Set(doc.connections.filter((c) => c.agent?.rel === "uses-skill").map((c) => c.to));
  for (const n of nodes.filter((n) => n.agent?.role === "skill")) {
    if (!usedBy.has(n.id) && !inGlobalGroup(doc, n.id)) add("A003", "aviso", `${quote(n)}: skill sem nenhum agent usando (nem seta uses-skill, nem dentro do grupo Global) — não entra em nenhum harness exportado`, n.id);
  }

  // A004 skill global com seta uses-skill redundante
  for (const c of doc.connections) {
    if (c.agent?.rel !== "uses-skill") continue;
    if (inGlobalGroup(doc, c.to)) add("A004", "aviso", `${byId.get(c.from) ? quote(byId.get(c.from)!) : c.from} —uses-skill→ ${byId.get(c.to) ? quote(byId.get(c.to)!) : c.to}: a skill já está no grupo Global (vale para todos); esta seta é redundante`, c.id);
  }

  // A005 ciclo de delegates
  const out = new Map<string, string[]>();
  for (const c of doc.connections) if (c.agent?.rel === "delegates") out.set(c.from, [...(out.get(c.from) ?? []), c.to]);
  const seen = new Set<string>();
  for (const start of out.keys()) {
    if (seen.has(start)) continue;
    const stack = new Set<string>();
    const walk = (id: string): boolean => {
      if (stack.has(id)) return true;
      if (seen.has(id)) return false;
      seen.add(id);
      stack.add(id);
      for (const next of out.get(id) ?? []) if (walk(next)) return true;
      stack.delete(id);
      return false;
    };
    if (walk(start)) add("A005", "erro", `ciclo de delegates envolvendo ${byId.get(start) ? quote(byId.get(start)!) : start}: um agente não pode delegar (direta ou indiretamente) para si mesmo`, start);
  }

  // A018 relação sem «como usa»: o destino só tem a própria description, que não diz como ESTE agente o usa
  for (const c of doc.connections) {
    if (!c.agent?.rel || !agentRelAllows(c.agent.rel, agentRelEnd(doc, c.from), agentRelEnd(doc, c.to))) continue;
    const usage = c.agent.usage?.trim() ?? "";
    const from = byId.get(c.from);
    const to = byId.get(c.to);
    const where = `${from ? quote(from) : c.from} —${c.agent.rel}→ ${to ? quote(to) : c.to}`;
    if (!usage) add("A018", "aviso", `${where}: sem «usage» — descreva como o agente usa ${c.agent.rel === "delegates" ? "o outro agente (o que delega e o que espera de volta)" : "a skill (quando a puxa e para quê)"}; isso vai para o corpo do agente no harness`, c.id);
    else if (usage.length < 15) add("A018", "aviso", `${where}: «usage» curto demais para orientar o agente; diga o quando e o para quê`, c.id);
  }

  // A008/A009 combinação de relação × par de papéis (igual D021/D022 do modo domain, mas sem o conceito de infra)
  for (const c of doc.connections) {
    const f = agentRelEnd(doc, c.from);
    const t = agentRelEnd(doc, c.to);
    if (!f && !t) continue; // conexão fora do vocabulário agents (não deveria existir no modo, mas não é desta regra)
    const rel = c.agent?.rel;
    if (rel) {
      if (f && t && !agentRelAllows(rel, f, t)) {
        const suggestion = suggestAgentRels(doc, c.from, c.to);
        add("A008", "aviso", `${f} —${rel}→ ${t}: combinação inválida; ${rel} liga ${agentRelPairsText(rel)}${suggestion.length ? `. Para este par use: ${suggestion.join(", ")}` : ""}`, c.id);
      }
    } else {
      const suggestion = suggestAgentRels(doc, c.from, c.to);
      add("A009", "aviso", `${f ?? c.from} → ${t ?? c.to}: conexão entre elementos do modo agents sem relação${suggestion.length ? `; use agent: { rel: "${suggestion[0]}" }` : "; nenhuma relação liga este par"}`, c.id);
    }
  }
  return issues;
}

/* ───────────────────────── descrição e guia ───────────────────────── */

const NATIVE_DESC = (spec: AgentNodeSpec) => (spec.toolType === "native" && spec.toolName ? NATIVE_TOOLS[spec.toolName] : undefined);

export function describeAgents(doc: Doc, issues: Issue[]): string {
  const L: string[] = [`# ${doc.title}`, doc.description ?? "", ""];
  const agents = doc.nodes.filter((n) => n.agent?.role === "agent");
  const skills = doc.nodes.filter((n) => n.agent?.role === "skill");
  const linked = (id: string, rel: AgentRel) =>
    doc.connections.flatMap((c) => {
      const n = c.from === id && c.agent?.rel === rel ? doc.nodes.find((x) => x.id === c.to) : undefined;
      return n ? [{ node: n, usage: c.agent?.usage?.trim() }] : [];
    });
  const usesOf = (id: string) => linked(id, "uses-skill");
  const toolsOf = (id: string) => linked(id, "uses-tool");
  const tools = doc.nodes.filter((n) => n.agent?.role === "tool");
  const delegatesOf = (id: string) => linked(id, "delegates");
  const how = (l: { node: NodeEl; usage?: string }) => (l.usage ? `${l.node.label} — ${l.usage}` : l.node.label);
  const globalSkills = skills.filter((n) => inGlobalGroup(doc, n.id));

  L.push("## Agentes");
  if (!agents.length) L.push("(nenhum)");
  for (const a of agents) {
    const spec = a.agent as AgentNodeSpec;
    L.push(`- **${a.label}** (${a.id}): ${spec.description ?? "(sem description)"}`);
    if (spec.model) L.push(`  - model: ${spec.model}`);
    if (spec.tools?.length) L.push(`  - tools: ${spec.tools.join(", ")}`);
    const uses = usesOf(a.id);
    if (uses.length) L.push(`  - usa as skills: ${uses.map(how).join("; ")}`);
    const tl = toolsOf(a.id);
    if (tl.length) L.push(`  - usa as ferramentas: ${tl.map(how).join("; ")}`);
    const dels = delegatesOf(a.id);
    if (dels.length) L.push(`  - delega para: ${dels.map(how).join("; ")}`);
  }
  L.push("", "## Skills");
  if (!skills.length) L.push("(nenhuma)");
  for (const s of skills) {
    const spec = s.agent as AgentNodeSpec;
    const origin = spec.source ? `catálogo: ${spec.source.repo}` : "própria";
    const scope = inGlobalGroup(doc, s.id) ? "GLOBAL (todos os agentes)" : "plugada por seta";
    L.push(`- **${s.label}** (${s.id}): ${spec.description ?? "(sem description)"} — ${origin} · ${scope}`);
  }
  L.push("", "## Ferramentas");
  if (!tools.length) L.push("(nenhuma)");
  for (const t of tools) {
    const spec = t.agent as AgentNodeSpec;
    const what = spec.toolType === "mcp" ? `MCP ${spec.transport ?? (spec.url ? "http" : "stdio")}${spec.command ? ` · ${spec.command} ${(spec.args ?? []).join(" ")}`.trimEnd() : ""}${spec.url ? ` · ${spec.url}` : ""}` : `nativa${spec.toolName ? ` · ${spec.toolName}` : ""}`;
    L.push(`- **${t.label}** (${t.id}): ${spec.description ?? NATIVE_DESC(spec) ?? "(sem description)"} — ${what} · ${inGlobalGroup(doc, t.id) ? "GLOBAL (todos os agentes)" : "ligada por seta"}`);
  }
  if (globalSkills.length) L.push("", `Skills globais (grupo "Global"): ${globalSkills.map((s) => s.label).join(", ")} — valem para todos os agentes do harness, sem precisar de seta.`);
  if (issues.length) L.push("", "## Avisos", ...issues.map((i) => `- [${i.rule} ${i.severity}] ${i.message}`));
  return L.join("\n");
}

export function schemaGuideAgents(): string {
  return [
    `# Archflow: guia do modo AGENTS (${SCHEMA_VERSION})`,
    "",
    "Modo para desenhar um TIME de agentes de IA: subagentes, skills (do catálogo ou próprias) e como se plugam. Exporta como harness para Claude Code ou Cursor (`generate_code`), e volta a ser editável lendo o harness de um projeto existente.",
    "",
    "## Papéis (`agent.role`, kind `agent`)",
    ...Object.entries(AGENT_ROLES).map(([k, r]) => `- \`${k}\` (${r.badge}): ${r.hint} Campos: ${r.fields.join(", ")}.`),
    "",
    "## Relações (`agent.rel` da conexão)",
    ...Object.entries(AGENT_RELS).map(([k, r]) => `- \`${k}\`: ${r.semantics}`),
    "Toda relação leva `usage` (texto): COMO o agente de origem usa o destino — quando, para quê, o que passa e o que espera de volta. Fica no corpo do agente no harness, ao lado da description do destino (que só diz o que o destino faz). Sem `usage`: aviso A018.",
    "",
    "Em `uses-tool`, `allow` (lista de nomes) limita as tools de um servidor MCP que aquele agente pode chamar; vazio = todas.",
    "",
    "## Ferramentas (`agent.role: \"tool\"`)",
    '`toolType: "native"` + `toolName` (Read, Write, Edit, Glob, Grep, Bash, WebFetch, WebSearch, NotebookEdit, TodoWrite, Agent) ou `toolType: "mcp"` com `transport` (stdio: `command` + `args`; http/sse: `url`), `env`/`headers` (segredos SEMPRE como `${VAR}`, aviso/erro A011 se vier em texto puro) e `mcpTools` (tools que o servidor expõe, opcional). O id do nó MCP é o nome do servidor (`mcp__<id>__<tool>`): use um slug estável. Claude Code: nativa vira `tools:` do agente; MCP ligado a UM agente vira `mcpServers` inline (isolado, não gasta contexto da sessão principal); MCP no Global ou usado por 2+ agentes vai para `.mcp.json` (o agente o referencia por nome). Se o agente não tem nenhuma tool nativa, `tools:` é omitido (herda todas, inclusive MCP). Cursor: `.cursor/mcp.json` vale para o projeto todo (sem isolamento por agente).',
    "",
    "## Escopo global",
    'Uma skill DENTRO de um grupo `kind: "global"` vale para TODOS os agentes do harness, sem precisar de seta `uses-skill`. Uma skill fora do Global só é usada pelo(s) agente(s) ligados a ela por essa seta; sem seta e fora do Global, a skill não entra em nenhum harness exportado (aviso A003).',
    "",
    "## Diferença entre os alvos de exportação",
    "- **Claude Code**: o subagente tem o campo nativo `skills: [nome, ...]` no frontmatter — pré-carrega o conteúdo da skill plugada. `uses-skill` vira esse campo.",
    "- **Cursor**: o subagente (`.cursor/agents/*.md`) não tem campo de skill — skills do projeto ficam disponíveis a todos por relevância. `uses-skill` nesse alvo é só documentado no corpo do agente (não isola a skill a ele).",
    "",
    "## Catálogo de skills",
    'Uma skill pode vir do catálogo (campo `source: { repo: "owner/repo", skillPath, hash? }`, resolvido do GitHub) ou ser própria (sem `source`, corpo em `body` editável). "Tornar própria" remove o `source` de uma skill de catálogo para editá-la livremente, sem receber mais atualização.',
    "",
    "## Fluxo recomendado",
    '1. Crie os agentes (`add_components` com `agent: { role: "agent", description, model?, tools?, prompt }`).',
    '2. Crie ou traga do catálogo as skills (`agent: { role: "skill", description, body }` ou com `source`).',
    '3. Ligue com `connect`: `agent: { rel: "uses-skill", usage }` (agent → skill) ou `agent: { rel: "delegates", usage }` (agent → agent). **`usage` diz COMO o agente de origem usa o destino** (quando, para quê, o que passa e o que espera de volta) e vira texto no corpo do agente; a `description` do destino diz só o que ele faz (aviso A018 quando falta). Skills e ferramentas soltas num grupo `global` não precisam de seta (`uses-tool` para ferramentas).',
    "4. `validate_diagram` (A001+) antes de `generate_code` com o alvo (`claude` ou `cursor`).",
    "",
    "Ids são slugs estáveis (`code-reviewer`), reaproveitados como nome do arquivo exportado.",
  ].join("\n");
}
