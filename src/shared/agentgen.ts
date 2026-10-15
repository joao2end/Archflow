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
 */
import { inGlobalGroup } from "./agents";
import type { GeneratedFile } from "./codegen";
import { docMode, type Doc, type NodeEl } from "./schema";

export type HarnessTarget = "claude" | "cursor";

const rootOf = (target: HarnessTarget) => (target === "claude" ? ".claude" : ".cursor");

/** Escalar YAML de uma linha. Aspas quando o texto tem `:`, `#`, quebra ou espaço nas pontas. */
function yamlScalar(s: string): string {
  if (s === "" || s !== s.trim() || /[\n:#]/.test(s) || /^[-?&*!|>%@`'"]/.test(s)) return JSON.stringify(s);
  return s;
}

function frontmatter(fields: [string, string | string[] | undefined][]): string {
  const lines = ["---"];
  for (const [key, value] of fields) {
    if (value === undefined || value === "" || (Array.isArray(value) && !value.length)) continue;
    if (Array.isArray(value)) {
      lines.push(`${key}:`);
      for (const item of value) lines.push(`  - ${yamlScalar(item)}`);
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
  const head = frontmatter([
    ["name", node.id],
    ["description", spec.description],
    ["model", spec.model],
    ["tools", spec.tools],
    ["skills", target === "claude" ? used : undefined],
  ]);
  const parts: string[] = [];
  if (spec.prompt?.trim()) parts.push(spec.prompt.trim());
  if (target === "cursor" && used.length) {
    const lines = used.map((id) => {
      const skill = doc.nodes.find((n) => n.id === id);
      const scope = skill && inGlobalGroup(doc, id) ? " (global)" : "";
      return `- **${id}**${scope}: ${skill?.agent?.description ?? skill?.label ?? id}`;
    });
    parts.push(["## Skills", "", "No Cursor não há campo que isole uma skill a este agente: elas ficam em `.cursor/skills/` e valem para o projeto. Use estas quando a description casar:", "", ...lines].join("\n"));
  }
  if (delegates.length) {
    const lines = delegates.map((d) => `- **${d.id}**: ${d.agent?.description ?? d.label}`);
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
  ];
  return files.sort((a, b) => a.path.localeCompare(b.path));
}
