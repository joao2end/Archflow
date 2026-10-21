/**
 * Importa um harness de Claude Code (`.claude/agents/*.md`, `.claude/skills/<nome>/SKILL.md`) de volta para
 * ops de um diagrama `agents`. Inverso parcial de `agentgen.ts`: agentes, skills, descriptions, model, o campo
 * `skills:` (vira `uses-skill`) e o corpo do agente (vira `prompt`). Sem I/O: quem chama lê os arquivos.
 *
 * O que NÃO volta, e fica registrado em `skipped`: a «como usa» de cada seta (vive no corpo gerado, não tem
 * formato reversível), delegação (`delegates`), tools e `.mcp.json`. Essas arestas aparecem como avisos
 * (A014, A018) no diagrama importado, para o usuário completar.
 */
import type { Op } from "./ops";
import type { AgentNodeSpec } from "./schema";

export interface HarnessFile {
  path: string;
  content: string;
}

export interface ImportResult {
  ops: Op[];
  skipped: string[];
}

/** Lê o frontmatter gerado por `agentgen.ts` (`chave: valor`, listas com `  - item`). */
export function parseFrontmatter(content: string): { data: Record<string, string | string[]>; body: string } | undefined {
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(content.replace(/\r\n/g, "\n"));
  if (!m) return undefined;
  const data: Record<string, string | string[]> = {};
  let key: string | undefined;
  const unquote = (v: string) => (v.startsWith('"') ? (JSON.parse(v) as string) : v);
  for (const line of m[1].split("\n")) {
    const item = /^\s+-\s(.*)$/.exec(line);
    if (item && key && Array.isArray(data[key])) {
      (data[key] as string[]).push(unquote(item[1]));
      continue;
    }
    const kv = /^([A-Za-z_][\w-]*):\s?(.*)$/.exec(line);
    if (!kv) continue;
    key = kv[1];
    if (kv[2] === "") data[key] = [];
    else data[key] = unquote(kv[2]);
  }
  return { data, body: content.slice(m[0].length).trim() };
}

/** Slug válido como id (o mesmo formato que o gerador usa como nome de arquivo). */
const slug = (s: string) => s.replace(/\.md$|\/SKILL\.md$/i, "").split("/").pop()!.toLowerCase();

export function harnessToOps(files: HarnessFile[]): ImportResult {
  const ops: Op[] = [];
  const skipped: string[] = [];
  const skillIds = new Set<string>();

  // skills primeiro: os agentes precisam dos ids para ligar uses-skill
  for (const f of files.filter((x) => /(^|\/)\.claude\/skills\/[^/]+\/SKILL\.md$/.test(x.path))) {
    const fm = parseFrontmatter(f.content);
    const id = f.path.split("/").slice(-2)[0].toLowerCase();
    if (!fm) {
      skipped.push(`${f.path}: sem frontmatter`);
      continue;
    }
    const description = typeof fm.data.description === "string" ? fm.data.description : "";
    const spec: AgentNodeSpec = { role: "skill", description, body: fm.body };
    skillIds.add(id);
    ops.push({ op: "add_node", id, label: typeof fm.data.name === "string" ? fm.data.name : id, kind: "agent", agent: spec });
  }

  for (const f of files.filter((x) => /(^|\/)\.claude\/agents\/[^/]+\.md$/.test(x.path))) {
    const fm = parseFrontmatter(f.content);
    const id = slug(f.path);
    if (!fm) {
      skipped.push(`${f.path}: sem frontmatter`);
      continue;
    }
    const spec: AgentNodeSpec = { role: "agent", description: typeof fm.data.description === "string" ? fm.data.description : "" };
    if (typeof fm.data.model === "string") spec.model = fm.data.model;
    if (fm.body) spec.prompt = fm.body;
    ops.push({ op: "add_node", id, label: typeof fm.data.name === "string" ? fm.data.name : id, kind: "agent", agent: spec });
    if (Array.isArray(fm.data.tools) && fm.data.tools.length) skipped.push(`${f.path}: tools (${fm.data.tools.join(", ")}) ficam como texto; modele como componentes Tool`);
    const listed = Array.isArray(fm.data.skills) ? fm.data.skills : [];
    for (const s of listed) {
      if (skillIds.has(s)) ops.push({ op: "add_connection", from: id, to: s, agent: { rel: "uses-skill" } });
      else skipped.push(`${f.path}: skill "${s}" não está nos arquivos importados`);
    }
    if (fm.data.mcpServers !== undefined) skipped.push(`${f.path}: mcpServers não é importado (servidores MCP viram componentes Tool)`);
  }

  if (!ops.length) skipped.push("nenhum agente ou skill encontrado em .claude/");
  return { ops, skipped };
}
