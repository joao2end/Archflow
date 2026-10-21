/**
 * Marcações do canvas durante uma execução de workflow (modo agents): quais nós e setas acendem, dado o estado do `WorkflowRun`.
 * Puro: a UI só pinta o que vem daqui. Regra: o passo em andamento acende o prompt, o agente que o roda (seta runs-on) e as
 * skills que esse agente usa (seta uses-skill); passo concluído fica verde; passo que falhou fica vermelho; o entrypoint
 * e o workflow acendem enquanto a execução roda, e a seta start e a runs-on do passo atual ficam animadas.
 */
import { entrypointOf } from "./agents";
import type { Doc } from "./schema";
import type { WorkflowRun } from "./workflow";

export type NodeMark = "active" | "done" | "failed" | "skill";
export interface RunMarks {
  nodes: Record<string, NodeMark>;
  /** setas animadas (start e runs-on do passo atual) */
  edges: Record<string, "flow">;
}
export const NO_MARKS: RunMarks = { nodes: {}, edges: {} };

/** Prioridade quando um nó aparece em mais de um passo: o que está acontecendo agora vence. */
const RANK: Record<NodeMark, number> = { skill: 0, done: 1, failed: 2, active: 3 };

export function runMarks(doc: Doc, run: WorkflowRun | null): RunMarks {
  if (!run) return NO_MARKS;
  const nodes: Record<string, NodeMark> = {};
  const edges: Record<string, "flow"> = {};
  const set = (id: string, m: NodeMark) => {
    if (!nodes[id] || RANK[m] > RANK[nodes[id]]) nodes[id] = m;
  };
  const agentOf = (promptId: string) => doc.connections.find((c) => c.from === promptId && c.agent?.rel === "runs-on" && doc.nodes.some((n) => n.id === c.to && n.agent?.role === "agent"));
  const entry = entrypointOf(doc, run.workflowId);
  const running = run.state === "running" || run.state === "waiting";
  // o entrypoint e o nó do workflow acompanham a execução inteira
  const whole: NodeMark | undefined = running ? "active" : run.state === "failed" ? "failed" : run.state === "done" ? "done" : undefined;
  if (whole) for (const id of [entry?.id, run.workflowId]) if (id && doc.nodes.some((n) => n.id === id)) set(id, whole);
  if (entry && running) {
    const start = doc.connections.find((c) => c.from === entry.id && c.agent?.rel === "start");
    if (start) edges[start.id] = "flow";
  }
  for (const s of run.steps) {
    const mark: NodeMark | undefined = s.status === "done" ? "done" : s.status === "failed" ? "failed" : s.status === "running" || s.status === "waiting" ? "active" : undefined;
    if (!mark) continue;
    set(s.promptId, mark);
    const agent = agentOf(s.promptId);
    if (!agent) continue;
    set(agent.to, mark);
    if (mark === "active") {
      edges[agent.id] = "flow";
      // skills que o agente ativo usa acendem enquanto ele trabalha
      for (const c of doc.connections) if (c.from === agent.to && c.agent?.rel === "uses-skill") set(c.to, "skill");
    }
  }
  return { nodes, edges };
}

/** Subagentes que os passos do workflow chamam (alvo da seta runs-on de cada prompt), sem repetir, na ordem dos passos. */
export function workflowAgents(run: Pick<WorkflowRun, "steps">): string[] {
  const out: string[] = [];
  for (const s of run.steps) if (s.agent && !out.includes(s.agent)) out.push(s.agent);
  return out;
}

/** O que o harness do projeto (`.claude/`) diz antes de rodar: sem subagentes no workflow ou sem harness aplicável, segue. */
export type HarnessCheck = { kind: "ok" } | { kind: "sync" } | { kind: "foreign"; owner: string; agents: string[] };
export function harnessCheck(status: { applicable: boolean; stale: string[]; owner?: string; foreign?: boolean } | undefined, agents: string[]): HarnessCheck {
  if (!status || !status.applicable || !agents.length) return { kind: "ok" };
  // o .claude/ do projeto é de outro diagrama: os subagentes deste workflow não estão lá (o Claude faria tudo sozinho)
  if (status.foreign) return { kind: "foreign", owner: status.owner ?? "outro diagrama", agents };
  // do próprio diagrama, mas atrás (edição recente ainda não gravada): grava antes de rodar
  if (status.stale.length) return { kind: "sync" };
  return { kind: "ok" };
}

/** Ferramentas que gravam arquivo: uma gravação negada só bloqueia o passo se o arquivo não for gravado depois. */
const WRITERS = ["Write", "Edit", "MultiEdit", "NotebookEdit"];

export interface PermissionReport {
  /** negações que deixaram trabalho por fazer (arquivo que nunca chegou a ser gravado): o passo falha */
  blocking: string[];
  /** negações que o agente contornou (outro caminho deu certo, ou nada dependia delas): o passo conclui com aviso */
  warnings: string[];
}

/**
 * Ferramentas negadas por permissão numa conversa do Claude Code (uma linha JSON por evento, da conversa principal ou de um
 * subagente), a partir de `since` (ms). Num `claude -p` ninguém aprova: a ferramenta volta erro e o agente segue — às vezes
 * contorna (um comando do Bash recusado, refeito com Edit), às vezes sai com 0 sem ter feito o trabalho. Por isso a negação
 * de gravar um arquivo que nunca foi gravado depois bloqueia; o resto vira aviso. Frases curtas, sem repetir.
 */
export function permissionReport(jsonl: string, since = 0, base = ""): PermissionReport {
  const root = base.replace(/\\/g, "/").replace(/\/$/, "");
  const rel = (s: string) => {
    const f = s.replace(/\\/g, "/");
    return root ? f.split(`${root}/`).join("").split(root).join(".") : f;
  };
  const one = (s: string, n: number) => {
    const t = s.replace(/\s+/g, " ").trim();
    return t.length > n ? `${t.slice(0, n - 1)}…` : t;
  };
  const uses = new Map<string, { name: string; input: Record<string, unknown> }>();
  const denials: { item: string; path?: string; at: number }[] = [];
  /** arquivo → posição (ordem dos eventos) da última gravação que deu certo */
  const written = new Map<string, number>();
  let pos = 0;
  for (const line of jsonl.split("\n")) {
    if (!line.startsWith("{")) continue;
    let ev: { timestamp?: string; toolDenialKind?: string; message?: { content?: unknown } };
    try {
      ev = JSON.parse(line);
    } catch {
      continue;
    }
    if (since && ev.timestamp && Date.parse(ev.timestamp) < since) continue;
    const blocks = Array.isArray(ev.message?.content) ? (ev.message!.content as { type?: string; id?: string; name?: string; input?: unknown; tool_use_id?: string; is_error?: boolean; content?: unknown }[]) : [];
    for (const b of blocks) {
      pos++;
      if (b?.type === "tool_use" && b.id && b.name) uses.set(b.id, { name: b.name, input: (b.input && typeof b.input === "object" ? b.input : {}) as Record<string, unknown> });
      if (b?.type !== "tool_result") continue;
      const use = b.tool_use_id ? uses.get(b.tool_use_id) : undefined;
      const file = typeof use?.input.file_path === "string" ? rel(use.input.file_path) : typeof use?.input.notebook_path === "string" ? rel(use.input.notebook_path) : undefined;
      if (b.is_error !== true) {
        if (use && file && WRITERS.includes(use.name)) written.set(file.toLowerCase(), pos);
        continue;
      }
      const text = typeof b.content === "string" ? b.content : Array.isArray(b.content) ? b.content.map((c: { text?: string }) => c?.text ?? "").join(" ") : "";
      const m = /requested permissions? to (write to|edit|read|use) (.+?),? but you haven'?t granted/i.exec(text);
      // forma curta («permission denied: WebSearch»), de outras versões e do claude de teste
      const short = m ? null : /permission denied:?\s*([\w.-]+)/i.exec(text);
      if (!m && !short && !ev.toolDenialKind) continue;
      const verb = m ? ({ "write to": "gravar", edit: "editar", read: "ler", use: "usar" } as Record<string, string>)[m[1].toLowerCase()] : "";
      // o motivo do Claude Code, na primeira frase (ex.: «Parser skipped input between top-level statements»)
      const reason = one(rel(text).split(/(?<=\.)\s/)[0], 70);
      const what = use ? (typeof use.input.command === "string" ? `${use.name}: ${one(rel(use.input.command), 70)}` : file ? `${use.name} ${file}` : use.name) : "";
      const item = m ? `${verb} ${rel(m[2].trim())}` : short ? `usar ${short[1]}` : what ? `${what} (${reason})` : reason;
      const path = m && /write|edit/i.test(m[1]) ? rel(m[2].trim()) : use && WRITERS.includes(use.name) ? file : undefined;
      if (item) denials.push({ item, path, at: pos });
    }
  }
  const out: PermissionReport = { blocking: [], warnings: [] };
  for (const d of denials) {
    const after = d.path ? written.get(d.path.toLowerCase()) : undefined;
    const list = d.path && !(after !== undefined && after > d.at) ? out.blocking : out.warnings;
    if (!list.includes(d.item)) list.push(d.item);
  }
  out.warnings = out.warnings.filter((w) => !out.blocking.includes(w));
  return out;
}
