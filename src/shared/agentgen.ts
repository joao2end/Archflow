/**
 * Gera o harness de um diagrama `agents` para Claude Code ou Cursor.
 *
 * Sem I/O: devolve os arquivos; quem chama (Fase 6) decide se grava, zipa ou mostra.
 * O nome de cada arquivo é o id do nó (slug estável).
 *
 * - Skill no grupo `global` vale para todos os agentes.
 * - Skill só ligada por `uses-skill` entra no agente de origem.
 * - Skill sem seta e fora do Global não é exportada (aviso A003).
 * - Claude Code: `uses-skill` vira `skills:` no frontmatter do subagente.
 * - Cursor: o subagente não tem esse campo; a relação fica documentada no corpo.
 * - Tool nativa ligada por `uses-tool` entra em `tools:`. Sem nenhuma tool nativa, `tools:` é omitido (herda tudo,
 *   inclusive MCP) — uma lista só com nativas esconderia o MCP.
 * - Servidor MCP (Claude Code): ligado a UM agente vira `mcpServers` inline do agente; no Global ou usado por 2+
 *   agentes vai para `.mcp.json` e o agente o referencia por nome. Cursor: `.cursor/mcp.json` para o projeto todo.
 */
import { inGlobalGroup } from "./agents";
import type { GeneratedFile } from "./codegen";
import { NATIVE_TOOLS, docMode, type Doc, type NodeEl } from "./schema";

export type HarnessTarget = "claude" | "cursor";

const rootOf = (target: HarnessTarget) => (target === "claude" ? ".claude" : ".cursor");

/** Escalar YAML de uma linha. Aspas quando o texto tem `:`, `#`, quebra ou espaço nas pontas. */
function yamlScalar(s: string): string {
  if (s === "" || s !== s.trim() || /[\n:#]/.test(s) || /^[-?&*!|>%@`'"]/.test(s)) return JSON.stringify(s);
  return s;
}

type FmItem = string | Record<string, unknown>;
/** Itens-objeto saem como mapa de uma linha (JSON é YAML válido): `- {"playwright":{"type":"stdio",…}}`. */
const fmItem = (item: FmItem) => (typeof item === "string" ? yamlScalar(item) : JSON.stringify(item));

function frontmatter(fields: [string, string | FmItem[] | undefined][]): string {
  const lines = ["---"];
  for (const [key, value] of fields) {
    if (value === undefined || value === "" || (Array.isArray(value) && !value.length)) continue;
    if (Array.isArray(value)) {
      lines.push(`${key}:`);
      for (const item of value) lines.push(`  - ${fmItem(item)}`);
    } else lines.push(`${key}: ${yamlScalar(value)}`);
  }
  lines.push("---", "");
  return lines.join("\n");
}

const byId = (a: { id: string }, b: { id: string }) => a.id.localeCompare(b.id);

function skills(doc: Doc): NodeEl[] {
  return doc.nodes.filter((n) => n.agent?.role === "skill").sort(byId);
}

function agents(doc: Doc): NodeEl[] {
  return doc.nodes.filter((n) => n.agent?.role === "agent").sort(byId);
}

/** Skills que entram no harness: globais, ou alvo de alguma seta uses-skill. */
function exportedSkills(doc: Doc): NodeEl[] {
  const linked = new Set(doc.connections.filter((c) => c.agent?.rel === "uses-skill").map((c) => c.to));
  return skills(doc).filter((s) => inGlobalGroup(doc, s.id) || linked.has(s.id));
}

/** Skills de um agente: as globais mais as ligadas a ele por uses-skill. */
function skillsOf(doc: Doc, agentId: string): string[] {
  const global = skills(doc).filter((s) => inGlobalGroup(doc, s.id)).map((s) => s.id);
  const direct = doc.connections.filter((c) => c.from === agentId && c.agent?.rel === "uses-skill" && skills(doc).some((s) => s.id === c.to)).map((c) => c.to);
  return [...new Set([...global, ...direct])].sort();
}

function delegatesOf(doc: Doc, agentId: string): NodeEl[] {
  return doc.connections
    .filter((c) => c.from === agentId && c.agent?.rel === "delegates")
    .map((c) => doc.nodes.find((n) => n.id === c.to && n.agent?.role === "agent"))
    .filter((n): n is NodeEl => !!n)
    .sort(byId);
}

/** «Como usa» escrito na seta `rel` de `from` para `to` (vazio quando não há). */
function usageOf(doc: Doc, from: string, to: string, rel: "uses-skill" | "delegates"): string {
  const text = doc.connections.find((c) => c.from === from && c.to === to && c.agent?.rel === rel)?.agent?.usage ?? "";
  return text.replace(/\s*\n\s*/g, " ").trim();
}

/** `- **id**: como usa — o que o destino faz` (só o que o destino faz, sem «como usa», nas skills globais sem seta). */
function bullet(id: string, what: string, usage: string, tag = ""): string {
  return usage ? `- **${id}**${tag}: ${usage} _(${brief(what)})_` : `- **${id}**${tag}: ${what}`;
}

/** Primeira frase (até 140 caracteres): as descriptions do catálogo são longas e o «como usa» já é o foco. */
function brief(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  const first = /^.*?[.!?](?=\s|$)/.exec(flat)?.[0] ?? flat;
  return first.length > 140 ? `${first.slice(0, 137).trimEnd()}…` : first;
}

/* ───────── ferramentas (tools nativas e servidores MCP) ───────── */

const isTool = (n: NodeEl | undefined): n is NodeEl => n?.agent?.role === "tool";
const isMcp = (n: NodeEl) => n.agent?.toolType === "mcp";
const transportOf = (n: NodeEl) => n.agent?.transport ?? (n.agent?.url ? "http" : "stdio");
/** Servidor com o mínimo para conectar; sem isso (aviso A010) ele não entra no harness. */
const mcpReady = (n: NodeEl) => isMcp(n) && (transportOf(n) === "stdio" ? !!n.agent?.command?.trim() : !!n.agent?.url?.trim());

function tools(doc: Doc): NodeEl[] {
  return doc.nodes.filter(isTool).sort(byId);
}

interface ToolLink {
  node: NodeEl;
  usage: string;
  allow: string[];
  /** vem do grupo Global, sem seta */
  global: boolean;
}

/** Tools de um agente: as ligadas por `uses-tool` mais as do grupo Global. A seta direta vence a global. */
function toolsOf(doc: Doc, agentId: string): ToolLink[] {
  const direct = new Map<string, ToolLink>();
  for (const c of doc.connections) {
    if (c.from !== agentId || c.agent?.rel !== "uses-tool") continue;
    const node = doc.nodes.find((n) => n.id === c.to);
    if (isTool(node)) direct.set(node.id, { node, usage: (c.agent.usage ?? "").replace(/\s*\n\s*/g, " ").trim(), allow: c.agent.allow ?? [], global: false });
  }
  for (const n of tools(doc)) if (!direct.has(n.id) && inGlobalGroup(doc, n.id)) direct.set(n.id, { node: n, usage: "", allow: [], global: true });
  return [...direct.values()].sort((a, b) => byId(a.node, b.node));
}

/** Quantos agentes ligam diretamente este servidor. */
function directUsers(doc: Doc, toolId: string): number {
  return new Set(doc.connections.filter((c) => c.agent?.rel === "uses-tool" && c.to === toolId).map((c) => c.from)).size;
}

/** `${VAR}` / `${VAR:-padrão}` (Claude Code) → `${env:VAR}` (Cursor, que não tem valor padrão). */
const cursorVars = (v: string) => v.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-[^}]*)?\}/g, "${env:$1}");

function serverConfig(n: NodeEl, target: HarnessTarget): Record<string, unknown> {
  const a = n.agent!;
  const conv = (m?: Record<string, string>) => (m && Object.keys(m).length ? Object.fromEntries(Object.entries(m).map(([k, v]) => [k, target === "cursor" ? cursorVars(v) : v])) : undefined);
  const str = (v?: string) => (v === undefined ? v : target === "cursor" ? cursorVars(v) : v);
  const t = transportOf(n);
  const cfg: Record<string, unknown> =
    t === "stdio"
      ? { ...(target === "claude" ? { type: "stdio" } : {}), command: str(a.command), ...(a.args?.length ? { args: a.args.map((x) => str(x)) } : {}), ...(conv(a.env) ? { env: conv(a.env) } : {}) }
      : { ...(target === "claude" ? { type: t } : {}), url: str(a.url), ...(conv(a.headers) ? { headers: conv(a.headers) } : {}) };
  return cfg;
}

/** Servidores que vão para o arquivo compartilhado do alvo. */
function sharedServers(doc: Doc, target: HarnessTarget): NodeEl[] {
  return tools(doc).filter((n) => {
    if (!mcpReady(n)) return false;
    if (inGlobalGroup(doc, n.id)) return true;
    const users = directUsers(doc, n.id);
    return target === "cursor" ? users > 0 : users > 1; // Claude: um único usuário fica inline no agente
  });
}

const MCP_FILE: Record<HarnessTarget, string> = { claude: ".mcp.json", cursor: ".cursor/mcp.json" };

function mcpFile(doc: Doc, target: HarnessTarget): GeneratedFile | undefined {
  const servers = sharedServers(doc, target);
  if (!servers.length) return undefined;
  const mcpServers = Object.fromEntries(servers.map((n) => [n.id, serverConfig(n, target)]));
  return { path: MCP_FILE[target], content: `${JSON.stringify({ mcpServers }, null, 2)}\n` };
}

/** Rótulo de uma ferramenta no corpo do agente: o nome da tool nativa, ou o servidor MCP (com as tools permitidas). */
function toolLabel(l: ToolLink): string {
  return l.node.agent?.toolType === "native" ? l.node.agent.toolName ?? l.node.id : l.node.id;
}
function toolWhat(l: ToolLink): string {
  const a = l.node.agent!;
  const base = a.description ?? (a.toolType === "native" && a.toolName ? NATIVE_TOOLS[a.toolName] : undefined) ?? l.node.label;
  return l.allow.length ? `${base} — só: ${l.allow.join(", ")}` : base;
}

function skillFile(node: NodeEl): string {
  const body = (node.agent?.body ?? "").replace(/\r\n/g, "\n").trim();
  if (body.startsWith("---\n")) return body.endsWith("\n") ? body : `${body}\n`;
  return frontmatter([
    ["name", node.id],
    ["description", node.agent?.description],
  ]) + (body ? `${body}\n` : "");
}

function agentFile(doc: Doc, node: NodeEl, target: HarnessTarget): string {
  const spec = node.agent!;
  const used = skillsOf(doc, node.id);
  const delegates = delegatesOf(doc, node.id);
  const links = toolsOf(doc, node.id).filter((l) => !isMcp(l.node) || mcpReady(l.node));
  // `tools:` é lista de permissão: sem nenhuma tool nativa ela é omitida (herda tudo, inclusive MCP)
  const natives = [...new Set([...(spec.tools ?? []), ...links.filter((l) => !isMcp(l.node) && l.node.agent?.toolName).map((l) => l.node.agent!.toolName!).sort()])];
  const mcp = links.filter((l) => isMcp(l.node));
  const mcpNames = mcp.flatMap((l) => (l.allow.length ? l.allow.map((a) => `mcp__${l.node.id}__${a}`) : [`mcp__${l.node.id}`]));
  const toolList = natives.length ? (target === "claude" ? [...natives, ...mcpNames] : natives) : undefined;
  const inline: FmItem[] =
    target === "claude"
      ? mcp.filter((l) => !l.global).map((l) => (directUsers(doc, l.node.id) > 1 ? l.node.id : { [l.node.id]: serverConfig(l.node, "claude") }))
      : [];
  const head = frontmatter([
    ["name", node.id],
    ["description", spec.description],
    ["model", spec.model],
    ["tools", toolList],
    ["mcpServers", inline],
    ["skills", target === "claude" ? used : undefined],
  ]);
  const parts: string[] = [];
  if (spec.prompt?.trim()) parts.push(spec.prompt.trim());
  const skillLine = (id: string) => {
    const skill = doc.nodes.find((n) => n.id === id);
    const scope = skill && inGlobalGroup(doc, id) ? " (global)" : "";
    return bullet(id, skill?.agent?.description ?? skill?.label ?? id, usageOf(doc, node.id, id, "uses-skill"), scope);
  };
  if (target === "cursor" && used.length) {
    parts.push(["## Skills", "", "No Cursor não há campo que isole uma skill a este agente: elas ficam em `.cursor/skills/` e valem para o projeto. Use estas quando a description casar:", "", ...used.map(skillLine)].join("\n"));
  } else if (target === "claude") {
    // o campo `skills:` só pré-carrega o conteúdo; o «como usar» de cada uma vai no corpo
    const how = used.filter((id) => usageOf(doc, node.id, id, "uses-skill"));
    if (how.length) parts.push(["## Como usar as skills", "", ...how.map(skillLine)].join("\n"));
  }
  if (target === "cursor" && links.length) {
    const lines = links.map((l) => bullet(toolLabel(l), toolWhat(l), l.usage, l.global ? " (global)" : ""));
    const note = mcp.length ? " Os servidores MCP ficam em `.cursor/mcp.json` e valem para o projeto todo (o Cursor não isola MCP por subagente)." : "";
    parts.push(["## Ferramentas", "", `Use estas ferramentas quando a tarefa pedir.${note}`, "", ...lines].join("\n"));
  } else if (target === "claude") {
    const how = links.filter((l) => l.usage);
    if (how.length) parts.push(["## Como usar as ferramentas", "", ...how.map((l) => bullet(toolLabel(l), toolWhat(l), l.usage))].join("\n"));
  }
  if (delegates.length) {
    const lines = delegates.map((d) => bullet(d.id, d.agent?.description ?? d.label, usageOf(doc, node.id, d.id, "delegates")));
    parts.push(["## Delegação", "", "Você pode delegar para:", "", ...lines].join("\n"));
  }
  return head + (parts.length ? `${parts.join("\n\n")}\n` : "");
}

/** Arquivos do harness para um alvo. Ordem estável por caminho. */
export function generateHarness(doc: Doc, target: HarnessTarget): GeneratedFile[] {
  if (docMode(doc) !== "agents") throw new Error(`generateHarness só gera harness de diagramas modo "agents" (este é "${docMode(doc)}")`);
  const root = rootOf(target);
  const files: GeneratedFile[] = [
    ...agents(doc).map((n) => ({ path: `${root}/agents/${n.id}.md`, content: agentFile(doc, n, target) })),
    ...exportedSkills(doc).map((n) => ({ path: `${root}/skills/${n.id}/SKILL.md`, content: skillFile(n) })),
    ...(mcpFile(doc, target) ? [mcpFile(doc, target)!] : []),
  ];
  return files.sort((a, b) => a.path.localeCompare(b.path));
}
