/**
 * Ferramentas que o usuário pode liberar sem perguntar nos workflows (`claude --allowedTools`). As candidatas vêm dos nós
 * `tool` do diagrama; só entram as que o bridge aceita (`SAFE_ALLOWED_TOOLS` em server/terminal.ts + servidores MCP).
 * A escolha é lembrada por projeto no navegador.
 */
import type { Doc } from "../shared/schema";

/** Espelho de SAFE_ALLOWED_TOOLS (server/terminal.ts): o bridge recusa o resto. */
const SAFE_NATIVE = ["Read", "Glob", "Grep", "WebFetch", "WebSearch", "TodoWrite", "Agent"];

export interface AllowableTool {
  /** nome passado ao claude: `WebSearch` ou `mcp__<servidor>` */
  name: string;
  label: string;
  hint: string;
}

export function allowableTools(doc: Doc): AllowableTool[] {
  const out: AllowableTool[] = [];
  for (const n of doc.nodes) {
    const a = n.agent;
    if (a?.role !== "tool") continue;
    if (a.toolType === "native" && a.toolName && SAFE_NATIVE.includes(a.toolName)) out.push({ name: a.toolName, label: a.toolName, hint: "nativa" });
    else if (a.toolType === "mcp" && /^[A-Za-z0-9_-]{1,64}$/.test(n.id)) out.push({ name: `mcp__${n.id}`, label: n.label, hint: "servidor MCP" });
  }
  return out.filter((t, i) => out.findIndex((x) => x.name === t.name) === i);
}

const key = (projectId?: string) => `archflow.wf.allowed.${projectId ?? "-"}`;
export function loadAllowed(projectId?: string): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(key(projectId)) ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}
export function saveAllowed(projectId: string | undefined, names: string[]) {
  try {
    localStorage.setItem(key(projectId), JSON.stringify(names));
  } catch {
    /* sem storage */
  }
}
