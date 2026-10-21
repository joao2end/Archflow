/**
 * Cliente das rotas do histórico de execuções de workflow (`/api/runs*` no bridge; o projeto é o aberto).
 * Falha de rede vira erro com a mensagem do servidor; quem chama decide se avisa ou segue (o histórico nunca trava uma execução).
 */
import type { RunRecord, RunSummary } from "../shared/runs";

async function call<T>(path: string, init?: { method: "POST"; body: unknown }): Promise<T> {
  const r = await fetch(path, init ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(init.body) } : undefined);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j as { error?: string }).error ?? `erro ${r.status}`);
  return j as T;
}

export const fetchRuns = (workflowId: string) => call<{ runs: RunSummary[] }>(`/api/runs?workflow=${encodeURIComponent(workflowId)}`).then((j) => j.runs);
export const fetchRun = (id: string) => call<RunRecord>(`/api/runs/get?id=${encodeURIComponent(id)}`);
export const saveRunRecord = (record: RunRecord) => call<{ id: string; pruned: string[] }>("/api/runs", { method: "POST", body: { record } });
/** Guarda os arquivos que o passo gerou (as saídas esperadas modificadas desde `since`). */
export const snapshotRunStep = (id: string, step: number, patterns: string[], since: number) => call<{ files: string[]; skipped: string[] }>("/api/runs/snapshot", { method: "POST", body: { id, step, patterns, since } });
/** Retomar: copia para `to` os arquivos dos passos antes de `upto` e, com `restore`, devolve ao projeto a versão de `from`. */
export const resumeRunFiles = (from: string, to: string, upto: number, restore: boolean) => call<{ files: Record<string, string[]>; restored: string[] }>("/api/runs/resume-files", { method: "POST", body: { from, to, upto, restore } });
