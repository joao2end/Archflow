/**
 * Histórico de execuções de workflow (como as «Executions» do n8n): cada execução do canvas vira um registro gravado no
 * projeto (`.archflow/runs/<id>.json`), com o estado inteiro da máquina de `workflow.ts` — entrada, prompt renderizado,
 * resposta, tempo e status de cada passo — e, por passo, a lista dos arquivos guardados das saídas esperadas
 * (`.archflow/runs/<id>/files/<passo>/…`). Retomar uma execução num passo cria OUTRA execução (a antiga não muda), que
 * aponta para a de origem em `resumedFrom`.
 * Puro: quem grava e lê os arquivos é o bridge (`server/runstore.ts`).
 */
import type { PromptLibrary } from "./prompts";
import type { RunState, RunStep, WorkflowRun } from "./workflow";

export const RUN_SCHEMA = "archflow-run/1";
/** `run-20261018-134501-a1b2`: data e hora (UTC) para ordenar pelo nome, mais um sufixo para não colidir. */
export const RUN_ID_RE = /^run-\d{8}-\d{6}-[a-z0-9]{4}$/;
/** Quantas execuções o projeto guarda; as mais antigas saem (com os arquivos guardados). */
export const RUNS_MAX = 50;

export interface RunRecord {
  schema: typeof RUN_SCHEMA;
  id: string;
  workflowId: string;
  workflowName: string;
  /** nó Entrypoint que disparou */
  entryId?: string;
  createdAt: number;
  updatedAt: number;
  /** execução de origem e passo (índice) em que esta foi retomada */
  resumedFrom?: { id: string; step: number };
  run: WorkflowRun;
  /** arquivos guardados de cada passo (índice → caminhos relativos ao projeto) */
  files?: Record<string, string[]>;
}

export interface RunSummary {
  id: string;
  workflowId: string;
  workflowName: string;
  createdAt: number;
  updatedAt: number;
  state: RunState;
  entrada?: string;
  /** passos concluídos ou pulados / total */
  done: number;
  total: number;
  /** passo (índice) em que parou com falha, quando parou */
  failedAt?: number;
  resumedFrom?: { id: string; step: number };
  /** quantos arquivos guardados, somando os passos */
  files: number;
}

const two = (n: number) => String(n).padStart(2, "0");
export function newRunId(now = new Date(), rand: () => number = Math.random): string {
  const d = `${now.getUTCFullYear()}${two(now.getUTCMonth() + 1)}${two(now.getUTCDate())}`;
  const t = `${two(now.getUTCHours())}${two(now.getUTCMinutes())}${two(now.getUTCSeconds())}`;
  const suf = Array.from({ length: 4 }, () => "abcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(rand() * 36)]).join("");
  return `run-${d}-${t}-${suf}`;
}

export function createRecord(run: WorkflowRun, o: { id: string; now: number; entryId?: string; resumedFrom?: { id: string; step: number }; files?: Record<string, string[]> }): RunRecord {
  return {
    schema: RUN_SCHEMA,
    id: o.id,
    workflowId: run.workflowId,
    workflowName: run.workflowName,
    ...(o.entryId ? { entryId: o.entryId } : {}),
    createdAt: o.now,
    updatedAt: o.now,
    ...(o.resumedFrom ? { resumedFrom: o.resumedFrom } : {}),
    run,
    ...(o.files && Object.keys(o.files).length ? { files: o.files } : {}),
  };
}

export function summarize(r: RunRecord): RunSummary {
  const steps = r.run.steps;
  const failedAt = steps.findIndex((s) => s.status === "failed");
  return {
    id: r.id,
    workflowId: r.workflowId,
    workflowName: r.workflowName,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    state: r.run.state,
    ...(r.run.entrada !== undefined ? { entrada: r.run.entrada } : {}),
    done: steps.filter((s) => s.status === "done" || s.status === "skipped").length,
    total: steps.length,
    ...(failedAt >= 0 ? { failedAt } : {}),
    ...(r.resumedFrom ? { resumedFrom: r.resumedFrom } : {}),
    files: Object.values(r.files ?? {}).reduce((n, l) => n + l.length, 0),
  };
}

/**
 * Execução que ficou «rodando» no disco mas não está viva nesta página (o app fechou, o servidor reiniciou): o passo em
 * andamento vira falha com código -1 (sessão interrompida) e a execução fica parada. Só para exibir e retomar.
 */
export function settleRun(run: WorkflowRun): WorkflowRun {
  if (run.state !== "running" && run.state !== "waiting" && run.state !== "paused") return run;
  return {
    ...run,
    state: run.state === "paused" ? "stopped" : "failed",
    steps: run.steps.map((s) => (s.status === "running" || s.status === "waiting" ? { ...s, status: "failed", code: -1 } : s)),
  };
}

const STEP_STATUS = ["pending", "running", "waiting", "done", "failed", "skipped"];
const RUN_STATES = ["running", "waiting", "paused", "failed", "done", "stopped"];
const str = (v: unknown, max = 200_000): string | undefined => (typeof v === "string" ? v.slice(0, max) : undefined);
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const strs = (v: unknown): string[] | undefined => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, 200) : undefined);

/** Registro lido do disco ou recebido da página: confere o formato e descarta o que não for de uma execução. */
export function normalizeRecord(raw: unknown): RunRecord | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const o = raw as Record<string, unknown>;
  const id = str(o.id, 64);
  const r = o.run as Record<string, unknown> | undefined;
  if (o.schema !== RUN_SCHEMA || !id || !RUN_ID_RE.test(id) || !r || typeof r !== "object" || !Array.isArray(r.steps)) return undefined;
  const steps: RunStep[] = [];
  for (const x of r.steps.slice(0, 50) as Record<string, unknown>[]) {
    if (!x || typeof x !== "object" || typeof x.promptId !== "string" || !STEP_STATUS.includes(x.status as string)) return undefined;
    const s: RunStep = { promptId: x.promptId, name: str(x.name, 200) ?? x.promptId, mode: x.mode === "manual" ? "manual" : "auto", raw: str(x.raw) ?? "", text: str(x.text) ?? "", status: x.status as RunStep["status"] };
    const extra: Partial<RunStep> = { agent: str(x.agent, 200), result: str(x.result), code: num(x.code), startedAt: num(x.startedAt), endedAt: num(x.endedAt), history: strs(x.history), denied: strs(x.denied), warnings: strs(x.warnings), missing: strs(x.missing), expects: strs(x.expects) };
    for (const [k, v] of Object.entries(extra)) if (v !== undefined) (s as unknown as Record<string, unknown>)[k] = v;
    steps.push(s);
  }
  const state = r.state as RunState;
  if (!RUN_STATES.includes(state)) return undefined;
  const values: Record<string, string> = {};
  if (r.values && typeof r.values === "object") for (const [k, v] of Object.entries(r.values as Record<string, unknown>)) if (typeof v === "string") values[k] = v.slice(0, 20_000);
  const run: WorkflowRun = {
    workflowId: str(r.workflowId, 200) ?? "",
    workflowName: str(r.workflowName, 200) ?? "",
    sessionId: str(r.sessionId, 64) ?? "",
    values,
    steps,
    current: num(r.current) ?? -1,
    state,
    ...(r.pace === "step" || r.pace === "run" ? { pace: r.pace } : {}),
    ...(typeof r.entrada === "string" ? { entrada: r.entrada.slice(0, 20_000) } : {}),
  };
  const rf = o.resumedFrom as Record<string, unknown> | undefined;
  const files: Record<string, string[]> = {};
  if (o.files && typeof o.files === "object") for (const [k, v] of Object.entries(o.files as Record<string, unknown>)) if (/^\d{1,2}$/.test(k) && strs(v)?.length) files[k] = strs(v)!;
  return {
    schema: RUN_SCHEMA,
    id,
    workflowId: str(o.workflowId, 200) ?? run.workflowId,
    workflowName: str(o.workflowName, 200) ?? run.workflowName,
    ...(str(o.entryId, 200) ? { entryId: str(o.entryId, 200) } : {}),
    createdAt: num(o.createdAt) ?? 0,
    updatedAt: num(o.updatedAt) ?? num(o.createdAt) ?? 0,
    ...(rf && typeof rf.id === "string" && RUN_ID_RE.test(rf.id) && num(rf.step) !== undefined ? { resumedFrom: { id: rf.id, step: num(rf.step)! } } : {}),
    run,
    ...(Object.keys(files).length ? { files } : {}),
  };
}

/**
 * Arquivos que precisam voltar ao projeto para retomar no passo `i`: os guardados dos passos anteriores, o mais recente
 * vencendo quando dois passos gravaram o mesmo caminho. Devolve caminho → passo de onde copiar.
 */
export function filesToRestore(rec: Pick<RunRecord, "files">, i: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (let j = 0; j < i; j++) for (const p of rec.files?.[String(j)] ?? []) out[p] = j;
  return out;
}

/**
 * Para retomar com os prompts ATUAIS do diagrama (o caso comum: corrigir o prompt que falhou e refazer dali): os passos a
 * partir de `from` pegam texto, subagente e saídas esperadas da biblioteca, desde que o workflow ainda tenha o mesmo prompt
 * naquela posição. Se a estrutura mudou (passo removido, trocado ou reordenado), fica tudo como estava na execução.
 */
export function refreshFromLibrary(run: WorkflowRun, lib: PromptLibrary, from: number): { run: WorkflowRun; refreshed: boolean } {
  const wf = lib.workflows.find((w) => w.id === run.workflowId);
  if (!wf || wf.steps.length !== run.steps.length || wf.steps.some((s, i) => s.promptId !== run.steps[i].promptId)) return { run, refreshed: false };
  let changed = false;
  const steps = run.steps.map((s, i) => {
    if (i < from) return s;
    const p = lib.prompts.find((x) => x.id === s.promptId);
    if (!p) return s;
    const expects = wf.steps[i].expects;
    const next: RunStep = { ...s, raw: p.text, name: p.name, ...(p.agent ? { agent: p.agent } : { agent: undefined }), ...(expects?.length ? { expects } : { expects: undefined }) };
    if (next.raw !== s.raw || next.agent !== s.agent || next.name !== s.name || JSON.stringify(next.expects) !== JSON.stringify(s.expects)) changed = true;
    return next;
  });
  return { run: { ...run, steps }, refreshed: changed };
}
