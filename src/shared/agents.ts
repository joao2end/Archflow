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
  if (a.tools !== undefined && (!Array.isArray(a.tools) || a.tools.some((x) => typeof x !== "string"))) return "agent.tools deve ser uma lista de textos";
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

/** Valida o objeto `agent` (`AgentConnSpec`) de uma conexão. */
export function checkAgentConn(agent: unknown): string | undefined {
  if (!agent || typeof agent !== "object") return "agent deve ser um objeto { rel }";
  const a = agent as { rel?: string };
  for (const k of Object.keys(a)) if (k !== "rel") return `conexão do modo agents não tem o campo "${k}". Campo: rel`;
  if (!AGENT_REL_KEYS.includes(a.rel as never)) return `agent.rel inválido "${a.rel}". Válidos: ${AGENT_REL_KEYS.join(", ")}`;
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

export function describeAgents(doc: Doc, issues: Issue[]): string {
  const L: string[] = [`# ${doc.title}`, doc.description ?? "", ""];
  const agents = doc.nodes.filter((n) => n.agent?.role === "agent");
  const skills = doc.nodes.filter((n) => n.agent?.role === "skill");
  const usesOf = (id: string) => doc.connections.filter((c) => c.from === id && c.agent?.rel === "uses-skill").map((c) => doc.nodes.find((n) => n.id === c.to)).filter((n): n is NodeEl => !!n);
  const delegatesOf = (id: string) => doc.connections.filter((c) => c.from === id && c.agent?.rel === "delegates").map((c) => doc.nodes.find((n) => n.id === c.to)).filter((n): n is NodeEl => !!n);
  const globalSkills = skills.filter((n) => inGlobalGroup(doc, n.id));

  L.push("## Agentes");
  if (!agents.length) L.push("(nenhum)");
  for (const a of agents) {
    const spec = a.agent as AgentNodeSpec;
    L.push(`- **${a.label}** (${a.id}): ${spec.description ?? "(sem description)"}`);
    if (spec.model) L.push(`  - model: ${spec.model}`);
    if (spec.tools?.length) L.push(`  - tools: ${spec.tools.join(", ")}`);
    const uses = usesOf(a.id);
    if (uses.length) L.push(`  - usa as skills: ${uses.map((s) => s.label).join(", ")}`);
    const dels = delegatesOf(a.id);
    if (dels.length) L.push(`  - delega para: ${dels.map((s) => s.label).join(", ")}`);
  }
  L.push("", "## Skills");
  if (!skills.length) L.push("(nenhuma)");
  for (const s of skills) {
    const spec = s.agent as AgentNodeSpec;
    const origin = spec.source ? `catálogo: ${spec.source.repo}` : "própria";
    const scope = inGlobalGroup(doc, s.id) ? "GLOBAL (todos os agentes)" : "plugada por seta";
    L.push(`- **${s.label}** (${s.id}): ${spec.description ?? "(sem description)"} — ${origin} · ${scope}`);
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
    '3. Ligue com `connect`: `agent: { rel: "uses-skill" }` (agent → skill) ou `agent: { rel: "delegates" }` (agent → agent). Skills soltas num grupo `global` não precisam de seta.',
    "4. `validate_diagram` (A001+) antes de `generate_code` com o alvo (`claude` ou `cursor`).",
    "",
    "Ids são slugs estáveis (`code-reviewer`), reaproveitados como nome do arquivo exportado.",
  ].join("\n");
}
