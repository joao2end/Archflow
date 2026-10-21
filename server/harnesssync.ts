/**
 * Sincroniza o harness gerado (`.claude/`, `.cursor/`) com a pasta do projeto.
 *
 * O manifesto `archflow.agents.json` (na raiz do projeto) guarda o hash de cada arquivo que o Archflow
 * gravou. Com ele:
 *  - arquivo que saiu do diagrama é apagado, mas só se ainda for exatamente o que o Archflow gravou;
 *  - arquivo editado à mão depois da gravação não é sobrescrito nem apagado (vira "conflito");
 *  - arquivo que já existia fora do Archflow só é adotado se o conteúdo for idêntico.
 * `force` ignora a proteção e deixa o diagrama mandar.
 *
 * `.mcp.json` e `.cursor/mcp.json` são arquivos COMPARTILHADOS (o usuário e o Claude Code também mexem neles):
 * o Archflow só gerencia as chaves de `mcpServers` que ele mesmo gravou (hash por servidor no manifesto), preserva
 * o resto e apaga o arquivo só quando ele fica vazio.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { GeneratedFile } from "../src/shared/codegen";

export const MANIFEST = "archflow.agents.json";

interface Manifest {
  schema: "archflow-agents/1";
  diagram?: string;
  files: Record<string, string>;
  /** arquivos compartilhados: caminho → nome do servidor → hash do que o Archflow gravou */
  servers?: Record<string, Record<string, string>>;
}

/** Arquivos de configuração MCP, mesclados por servidor em vez de sobrescritos. */
export const MERGE_FILES = [".mcp.json", ".cursor/mcp.json"];

export interface HarnessSyncResult {
  written: string[];
  unchanged: string[];
  removed: string[];
  /** editados à mão (ou já existentes e diferentes): ficaram como estavam */
  conflicts: string[];
}

/** JSON com chaves em ordem fixa, para comparar e dar hash sem depender da ordem do arquivo. */
function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  if (v && typeof v === "object") return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`).join(",")}}`;
  return JSON.stringify(v);
}

const sha = (s: string | Buffer) => createHash("sha256").update(s).digest("hex").slice(0, 16);

/** Bytes que o harness grava: UTF-8 para texto, o binário decodificado para planilha e imagem. */
const bytesOf = (f: GeneratedFile) => Buffer.from(f.content, f.encoding === "base64" ? "base64" : "utf8");

export function readManifest(dir: string): Manifest {
  try {
    const m = JSON.parse(readFileSync(join(dir, MANIFEST), "utf8"));
    if (m && typeof m.files === "object") return { schema: "archflow-agents/1", diagram: typeof m.diagram === "string" ? m.diagram : undefined, files: m.files, servers: m.servers && typeof m.servers === "object" ? m.servers : {} };
  } catch {
    /* sem manifesto ainda */
  }
  return { schema: "archflow-agents/1", files: {} };
}

function write(path: string, data: string | Buffer) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, data);
  renameSync(tmp, path);
}

/** Sobe apagando pastas que ficaram vazias, até a raiz do projeto. */
function pruneEmpty(dir: string, from: string) {
  let d = dirname(join(dir, from));
  while (d.length > dir.length && existsSync(d) && !readdirSync(d).length) {
    rmdirSync(d);
    d = dirname(d);
  }
}

type Servers = Record<string, unknown>;

function readJson(path: string): Record<string, unknown> | undefined {
  try {
    const v = JSON.parse(readFileSync(path, "utf8"));
    return v && typeof v === "object" && !Array.isArray(v) ? v : undefined;
  } catch {
    return undefined;
  }
}

/** Mescla `desired` na chave `mcpServers` do arquivo, tocando só nos servidores gerenciados. */
function mergeServers(dir: string, path: string, desired: Servers, prev: Record<string, string>, force: boolean, out: HarnessSyncResult): Record<string, string> {
  const abs = join(dir, ...path.split("/"));
  const existing = readJson(abs);
  const servers: Servers = { ...((existing?.mcpServers as Servers | undefined) ?? {}) };
  const hashes = { ...prev };
  let changed = false;
  for (const [name, cfg] of Object.entries(desired)) {
    const h = sha(stable(cfg));
    const cur = servers[name];
    if (cur === undefined || force || (prev[name] && prev[name] === sha(stable(cur)))) {
      if (cur === undefined || stable(cur) !== stable(cfg)) {
        servers[name] = cfg;
        changed = true;
        out.written.push(`${path}#${name}`);
      } else out.unchanged.push(`${path}#${name}`);
      hashes[name] = h;
    } else if (stable(cur) === stable(cfg)) {
      out.unchanged.push(`${path}#${name}`);
      hashes[name] = h;
    } else out.conflicts.push(`${path}#${name}`);
  }
  for (const name of Object.keys(prev).filter((n) => !(n in desired))) {
    const cur = servers[name];
    if (cur === undefined) delete hashes[name];
    else if (force || sha(stable(cur)) === prev[name]) {
      delete servers[name];
      delete hashes[name];
      changed = true;
      out.removed.push(`${path}#${name}`);
    } else out.conflicts.push(`${path}#${name}`);
  }
  if (changed) {
    const rest = { ...(existing ?? {}) };
    delete rest.mcpServers;
    if (!Object.keys(servers).length && !Object.keys(rest).length) {
      if (existing) unlinkSync(abs);
      pruneEmpty(dir, path);
    } else write(abs, `${JSON.stringify({ ...rest, ...(Object.keys(servers).length ? { mcpServers: servers } : {}) }, null, 2)}\n`);
  }
  return hashes;
}

/** `roots`: as pastas do harness que esta chamada administra (ex.: [".claude"]); o resto do manifesto fica intacto. */
export function syncHarness(dir: string, files: GeneratedFile[], roots: string[], diagram: string, force = false): HarnessSyncResult {
  const manifest = readManifest(dir);
  const out: HarnessSyncResult = { written: [], unchanged: [], removed: [], conflicts: [] };
  const next: Record<string, string> = { ...manifest.files };
  const inRoots = (p: string) => roots.some((r) => p === r || p.startsWith(`${r}/`));
  const isMerge = (p: string) => MERGE_FILES.includes(p);
  const nextServers: Record<string, Record<string, string>> = { ...(manifest.servers ?? {}) };

  for (const path of MERGE_FILES.filter(inRoots)) {
    const generated = files.find((f) => f.path === path);
    const desired = (generated ? (JSON.parse(generated.content).mcpServers as Servers) : {}) ?? {};
    const hashes = mergeServers(dir, path, desired, manifest.servers?.[path] ?? {}, force, out);
    if (Object.keys(hashes).length) nextServers[path] = hashes;
    else delete nextServers[path];
  }

  for (const f of files.filter((f) => !isMerge(f.path))) {
    const abs = join(dir, ...f.path.split("/"));
    const bytes = bytesOf(f);
    const hash = sha(bytes);
    const disk = existsSync(abs) ? readFileSync(abs) : undefined;
    if (disk?.equals(bytes)) {
      out.unchanged.push(f.path);
      next[f.path] = hash;
    } else if (disk === undefined || force || (manifest.files[f.path] && manifest.files[f.path] === sha(disk))) {
      write(abs, bytes);
      out.written.push(f.path);
      next[f.path] = hash;
    } else out.conflicts.push(f.path);
  }

  const keep = new Set(files.map((f) => f.path));
  for (const path of Object.keys(manifest.files).filter((p) => inRoots(p) && !isMerge(p) && !keep.has(p))) {
    const abs = join(dir, ...path.split("/"));
    if (!existsSync(abs)) delete next[path];
    else if (force || sha(readFileSync(abs)) === manifest.files[path]) {
      unlinkSync(abs);
      pruneEmpty(dir, path);
      out.removed.push(path);
      delete next[path];
    } else out.conflicts.push(path);
  }

  const sorted = Object.fromEntries(Object.entries(next).sort(([a], [b]) => a.localeCompare(b)));
  write(join(dir, MANIFEST), `${JSON.stringify({ schema: "archflow-agents/1", diagram, files: sorted, ...(Object.keys(nextServers).length ? { servers: nextServers } : {}) }, null, 2)}\n`);
  return out;
}

/**
 * Só leitura: o que está diferente entre o harness gerado e a pasta (arquivos ausentes, alterados ou que sobrariam do
 * diagrama). Inclui os que `syncHarness` trataria como conflito: para o usuário, «desatualizado» é tudo que difere.
 * Servidores de `.mcp.json` aparecem como `caminho#servidor`.
 */
export function harnessDiff(dir: string, files: GeneratedFile[], roots: string[]): string[] {
  const manifest = readManifest(dir);
  const inRoots = (p: string) => roots.some((r) => p === r || p.startsWith(`${r}/`));
  const isMerge = (p: string) => MERGE_FILES.includes(p);
  const stale: string[] = [];
  for (const path of MERGE_FILES.filter(inRoots)) {
    const generated = files.find((f) => f.path === path);
    const desired = (generated ? (JSON.parse(generated.content).mcpServers as Servers) : {}) ?? {};
    const have = (readJson(join(dir, ...path.split("/")))?.mcpServers as Servers | undefined) ?? {};
    for (const [name, cfg] of Object.entries(desired)) if (have[name] === undefined || stable(have[name]) !== stable(cfg)) stale.push(`${path}#${name}`);
    for (const name of Object.keys(manifest.servers?.[path] ?? {})) if (!(name in desired) && name in have) stale.push(`${path}#${name}`);
  }
  for (const f of files.filter((f) => !isMerge(f.path))) {
    const abs = join(dir, ...f.path.split("/"));
    if (!existsSync(abs) || !readFileSync(abs).equals(bytesOf(f))) stale.push(f.path);
  }
  const keep = new Set(files.map((f) => f.path));
  for (const path of Object.keys(manifest.files).filter((p) => inRoots(p) && !isMerge(p) && !keep.has(p))) if (existsSync(join(dir, ...path.split("/")))) stale.push(path);
  return stale;
}
