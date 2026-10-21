/**
 * Histórico de execuções de workflow no disco do projeto (`.archflow/runs/`):
 *  - `<id>.json`: o registro da execução (formato em `src/shared/runs.ts`);
 *  - `<id>/files/<passo>/<caminho>`: cópia dos arquivos que o passo gerou (as saídas esperadas, `expects`), para retomar
 *    uma execução antiga com os arquivos daquela execução, e não com os da última que passou por cima.
 * Só mexe dentro da pasta do projeto: caminhos relativos conferidos segmento a segmento, sem `..` nem caminho absoluto.
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { checkExpects, expandPattern, type FsEntry } from "../src/shared/expects";
import { filesToRestore, normalizeRecord, RUN_ID_RE, RUNS_MAX, summarize, type RunRecord, type RunSummary } from "../src/shared/runs";

/** Arquivo guardado de no máximo 25 MB; um passo guarda no máximo 100 MB e 200 arquivos. */
export const SNAPSHOT_FILE_MAX = 25 * 1024 * 1024;
export const SNAPSHOT_STEP_MAX = 100 * 1024 * 1024;
export const SNAPSHOT_FILES_MAX = 200;

export class RunStoreError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

const runsDir = (dir: string) => join(dir, ".archflow", "runs");
const checkId = (id: unknown): string => {
  if (typeof id !== "string" || !RUN_ID_RE.test(id)) throw new RunStoreError(400, "id de execução inválido");
  return id;
};
const checkStep = (n: unknown): number => {
  if (!Number.isInteger(n) || (n as number) < 0 || (n as number) > 49) throw new RunStoreError(400, "passo inválido");
  return n as number;
};
/** Caminho relativo ao projeto, com /: sem segmento vazio, `.`, `..`, curinga ou caractere de controle. */
export function safeRel(p: unknown): string {
  if (typeof p !== "string" || !p || p.length > 300 || p.includes("\\") || /^[a-zA-Z]:|^\//.test(p) || /[*?<>:"|\x00-\x1f]/.test(p)) throw new RunStoreError(400, `caminho inválido: ${String(p)}`);
  if (p.split("/").some((s) => !s || s === "." || s === "..")) throw new RunStoreError(400, `caminho inválido: ${p}`);
  return p;
}

function atomicWrite(path: string, data: string) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, data);
  renameSync(tmp, path);
}

function readRecord(dir: string, id: string): RunRecord | undefined {
  try {
    return normalizeRecord(JSON.parse(readFileSync(join(runsDir(dir), `${id}.json`), "utf8")));
  } catch {
    return undefined;
  }
}

/** Execuções do projeto (do workflow, se informado), da mais nova para a mais antiga. */
export function listRuns(dir: string, workflowId?: string): RunSummary[] {
  const root = runsDir(dir);
  if (!existsSync(root)) return [];
  const out: RunSummary[] = [];
  for (const f of readdirSync(root)) {
    const id = f.replace(/\.json$/, "");
    if (!f.endsWith(".json") || !RUN_ID_RE.test(id)) continue;
    const r = readRecord(dir, id);
    if (r && (!workflowId || r.workflowId === workflowId)) out.push(summarize(r));
  }
  return out.sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id));
}

export function getRun(dir: string, id: unknown): RunRecord {
  const r = readRecord(dir, checkId(id));
  if (!r) throw new RunStoreError(404, "execução não encontrada");
  return r;
}

/** Grava (ou atualiza) o registro e apaga as execuções mais antigas além de `RUNS_MAX`, com os arquivos guardados delas. */
export function saveRun(dir: string, raw: unknown): { id: string; pruned: string[] } {
  const rec = normalizeRecord(raw);
  if (!rec) throw new RunStoreError(400, "registro de execução inválido");
  atomicWrite(join(runsDir(dir), `${rec.id}.json`), `${JSON.stringify(rec)}\n`);
  const all = listRuns(dir);
  const pruned = all.slice(RUNS_MAX).map((s) => s.id);
  for (const id of pruned) {
    rmSync(join(runsDir(dir), `${id}.json`), { force: true });
    rmSync(join(runsDir(dir), id), { recursive: true, force: true });
  }
  return { id: rec.id, pruned };
}

/** Lista uma pasta do projeto para `expandPattern` (nomes, tipo e data). */
function lister(dir: string) {
  return (rel: string): FsEntry[] => {
    const abs = rel ? join(dir, ...rel.split("/")) : dir;
    try {
      return readdirSync(abs).flatMap((name) => {
        try {
          const st = statSync(join(abs, name));
          return [{ name, dir: st.isDirectory(), mtime: st.mtimeMs }];
        } catch {
          return [];
        }
      });
    } catch {
      return [];
    }
  };
}

/**
 * Guarda os arquivos que o passo `step` gerou: os que casam com `patterns` (as saídas esperadas) e foram modificados desde
 * `since`. Arquivo grande demais é pulado (e listado em `skipped`). Devolve os caminhos guardados, relativos ao projeto.
 */
export function snapshotStep(dir: string, b: { id?: unknown; step?: unknown; patterns?: unknown; since?: unknown }): { files: string[]; skipped: string[] } {
  const id = checkId(b.id);
  const step = checkStep(b.step);
  const err = checkExpects(b.patterns);
  if (err) throw new RunStoreError(400, err);
  const since = Number(b.since) || 0;
  const list = lister(dir);
  const found = new Map<string, number>();
  for (const p of b.patterns as string[]) for (const f of expandPattern(p, list)) if (f.mtime >= since - 1000) found.set(f.path, f.mtime);
  const dest = join(runsDir(dir), id, "files", String(step));
  rmSync(dest, { recursive: true, force: true }); // uma nova tentativa do passo substitui a anterior
  const files: string[] = [];
  const skipped: string[] = [];
  let total = 0;
  for (const rel of [...found.keys()].sort()) {
    safeRel(rel);
    const src = join(dir, ...rel.split("/"));
    const size = statSync(src).size;
    if (size > SNAPSHOT_FILE_MAX || total + size > SNAPSHOT_STEP_MAX || files.length >= SNAPSHOT_FILES_MAX) {
      skipped.push(rel);
      continue;
    }
    const to = join(dest, ...rel.split("/"));
    mkdirSync(dirname(to), { recursive: true });
    copyFileSync(src, to);
    files.push(rel);
    total += size;
  }
  return { files, skipped };
}

/**
 * Prepara a retomada de `from` no passo `upto` como a execução `to`: copia para `to` os arquivos guardados dos passos
 * anteriores e, com `restore`, devolve ao projeto a versão de cada arquivo daquela execução (o passo mais recente vence).
 */
export function resumeFiles(dir: string, b: { from?: unknown; to?: unknown; upto?: unknown; restore?: unknown }): { files: Record<string, string[]>; restored: string[] } {
  const from = getRun(dir, b.from);
  const to = checkId(b.to);
  const upto = checkStep(b.upto);
  const files: Record<string, string[]> = {};
  for (let j = 0; j < upto; j++) {
    const list = (from.files?.[String(j)] ?? []).map(safeRel);
    const kept: string[] = [];
    for (const rel of list) {
      const src = join(runsDir(dir), from.id, "files", String(j), ...rel.split("/"));
      if (!existsSync(src)) continue;
      const dst = join(runsDir(dir), to, "files", String(j), ...rel.split("/"));
      mkdirSync(dirname(dst), { recursive: true });
      copyFileSync(src, dst);
      kept.push(rel);
    }
    if (kept.length) files[String(j)] = kept;
  }
  const restored: string[] = [];
  if (b.restore === true) {
    for (const [rel, j] of Object.entries(filesToRestore({ files }, upto))) {
      const src = join(runsDir(dir), to, "files", String(j), ...rel.split("/"));
      const dst = join(dir, ...safeRel(rel).split("/"));
      mkdirSync(dirname(dst), { recursive: true });
      copyFileSync(src, dst);
      restored.push(rel);
    }
  }
  return { files, restored: restored.sort() };
}
