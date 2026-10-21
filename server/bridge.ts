/**
 * Archflow Bridge — projetos de diagramas em disco + ponte navegador ↔ MCP.
 *
 * Um PROJETO é uma pasta qualquer; dentro dela, diagramas `*.archflow.json` em subpastas livres e, no modo agents,
 * o harness exportado (`.claude/`, `.cursor/`). A pasta oculta `.archflow/` guarda `project.json` e a lixeira
 * (como o `.obsidian/` do Obsidian).
 *
 *   GET  /api/health | GET /api/doc | PUT /api/doc | POST /api/ops
 *   GET  /api/workspace                         → { project, configured, projects[], current, tree, files[] }
 *   GET  /api/projects                          → { projects[], active }
 *   POST /api/projects/create  { name, parent }   cria pasta nova e a abre como projeto
 *   POST /api/projects/open    { path }           abre uma pasta existente como projeto
 *   POST /api/projects/switch  { id }
 *   POST /api/projects/remove  { id }             só tira da lista (não apaga nada)
 *   POST /api/diagrams          { title, folder? }
 *   POST /api/diagrams/open|rename|duplicate|delete|move
 *   POST /api/folders | /api/folders/rename | /api/folders/delete
 *   GET  /api/fs/list?path=  · POST /api/fs/mkdir   (navegador de pastas)
 *   GET/POST /api/skills/sources[/refresh|/remove]  fontes de skills (repos GitHub) indexadas em ~/.archflow/skill-sources.json
 *   GET  /api/skills/indexed?q=           skills das fontes registradas
 *   GET  /api/skills/top                  ranking da home do skills.sh
 *   GET  /api/skills/search?q=            busca no catálogo público skills.sh
 *   POST /api/skills/install { repo, skillPath }  `npx skills add` no projeto aberto + conteúdo do SKILL.md
 *   GET  /api/term/info                         { token, max, sessions[], cwd } (token só legível na mesma origem)
 *   POST /api/term/start { program?, args?, title?, cols?, rows?, prefill? }  PTY do `claude` na pasta do projeto (header x-archflow-term)
 *   POST /api/project/outputs { patterns[], since } { missing[] } saídas esperadas de um passo sem arquivo modificado desde `since` (ms; só leitura)
 *   GET  /api/runs?workflow=<id>          { runs[] } histórico de execuções de workflow do projeto (.archflow/runs/), do mais novo ao mais antigo
 *   GET  /api/runs/get?id=<id>            registro completo de uma execução
 *   POST /api/runs { record }             grava/atualiza uma execução (guarda as últimas 50)
 *   POST /api/runs/snapshot { id, step, patterns, since }  guarda os arquivos que o passo gerou (saídas esperadas)
 *   POST /api/runs/resume-files { from, to, upto, restore }  retomar: copia os arquivos dos passos anteriores e, com restore, devolve ao projeto
 *   POST /api/term/conversation/last { id }      { text|null } última resposta do agente na conversa (memória dos workflows)
 *   POST /api/term/conversation/denials { id, since } { denials[] } ferramentas negadas por permissão desde `since` (ms), com subagentes
 *   GET  /api/term/conversation?id=<uuid>       { exists } a conversa do Claude Code já foi gravada? (base do --resume dos workflows)
 *   POST /api/term/kill { id }
 *   WS   /api/term?session=&token=              terminal interativo (mesma origem + token; ver server/terminal.ts)
 *   GET/PUT /api/prompts                        { library, dropped[] } prompts e workflows do projeto (`.archflow/prompts.json`)
 *   GET  /api/harness/status?target=claude     { applicable, stale[], owner, current, foreign } (só leitura)
 *   POST /api/harness { target }               grava o harness do diagrama agents aberto na pasta do projeto
 *   POST /api/export { format, name?, out?, background?, scale?, padding? }  SVG/PNG renderizado pela janela do app
 *   GET  /api/events                            SSE: hello | doc | workspace | export
 * Caminhos de diagrama são relativos ao projeto, com "/" (ex.: "backend/orders.archflow.json").
 */
import { spawn, spawnSync } from "node:child_process";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import {
  existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, watch, writeFileSync, type FSWatcher,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, extname, isAbsolute, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { generateHarness, type HarnessTarget } from "../src/shared/agentgen";
import { parseProbeBody, probeMcp, ProbeError } from "./mcpprobe";
import { searchMcpRegistry } from "./mcpregistry";
import { assertToken, conversationExists, lastAssistantText, permissionDenials, detectClaude, handleUpgrade, killAll, killSession, startSession, terminalEnabled, termInfo, TermError } from "./terminal";
import { harnessDiff, syncHarness, type HarnessSyncResult, readManifest } from "./harnesssync";
import { harnessToOps } from "../src/shared/agentimport";
import { checkExpects, missingOutputs, type FsEntry } from "../src/shared/expects";
import { getRun, listRuns, resumeFiles, RunStoreError, saveRun, snapshotStep } from "./runstore";
import { applyOps, describe, normalizeDoc, schemaGuide, slug, type Op } from "../src/shared/ops";
import { normalizeLibrary } from "../src/shared/prompts";
import { docMode, emptyDoc, type Doc, type DocMode } from "../src/shared/schema";
import { SKILL_MD } from "../src/shared/skill.generated";
import { hashSkillContent, parseSkillMarkdown, skillInstallSlug } from "../src/shared/skillcatalog";

export const DEFAULT_PORT = Number(process.env.ARCHFLOW_PORT ?? 7077);
const HOST = process.env.ARCHFLOW_HOST ?? "127.0.0.1";
const CONFIG_DIR = process.env.ARCHFLOW_CONFIG ?? join(homedir(), ".archflow");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");
const DEFAULT_DIR = resolve(process.env.ARCHFLOW_DATA ?? "diagrams");
const DIST = resolve(process.env.ARCHFLOW_DIST ?? "dist");
const EXT = ".archflow.json";
const META = ".archflow";
/**
 * Modo público (ARCHFLOW_PUBLIC=1): só serve o app estático. Nenhuma rota /api existe e nada é gravado no
 * servidor — cada visitante usa o projeto do próprio navegador (IndexedDB), sem login e sem ver dados alheios.
 */
const PUBLIC_MODE = process.env.ARCHFLOW_PUBLIC === "1";
const SEG_BAD = /[\\/:*?"<>|\0]/;

interface Project {
  id: string;
  name: string;
  path: string;
}
interface Config {
  projects?: Project[];
  active?: string;
  lastOpened?: Record<string, string>;
  workspace?: string; // legado (pasta única)
  vaults?: Project[]; // legado (quando «projeto» se chamava «cofre»)
}

function readConfig(): Config {
  try {
    return JSON.parse(readFileSync(CONFIG_FILE, "utf8"));
  } catch {
    return {};
  }
}
function writeConfig(patch: Config) {
  try {
    mkdirSync(CONFIG_DIR, { recursive: true });
    writeFileSync(CONFIG_FILE, JSON.stringify({ ...readConfig(), ...patch }, null, 2));
  } catch (e) {
    console.error("[bridge] não foi possível gravar config", e);
  }
}

/* ───────── estado ───────── */

let project: Project = { id: "default", name: "Projeto padrão", path: DEFAULT_DIR };
let dir = "";
let configured = false;
let current = ""; // caminho relativo do diagrama aberto
let doc: Doc = emptyDoc();
let rev = 0;
let pristine = false;
let lastWrittenMtime = 0;
let dirty = false;
let saveTimer: NodeJS.Timeout | undefined;
let watcher: FSWatcher | undefined;
let watchTimer: NodeJS.Timeout | undefined;
const clients = new Set<ServerResponse>();

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/* ───────── caminhos seguros ───────── */

function segments(rel: string, allowEmpty = false): string[] {
  const parts = String(rel ?? "").split("/").filter(Boolean);
  if (!parts.length && !allowEmpty) throw new HttpError(400, "caminho vazio");
  for (const s of parts) if (SEG_BAD.test(s) || s === "." || s === ".." || s.startsWith(".")) throw new HttpError(400, `nome inválido: ${s}`);
  return parts;
}
const pathIn = (rel: string, allowEmpty = false) => join(dir, ...segments(rel, allowEmpty));

/** Saídas esperadas de um passo de workflow (`expects`) sem nenhum arquivo modificado desde `since`: só lê nomes e datas. */
function projectOutputs(b: { patterns?: unknown; since?: unknown }): { missing: string[] } {
  if (!dir) throw new HttpError(409, "abra um projeto antes");
  const err = checkExpects(b.patterns);
  if (err) throw new HttpError(400, err);
  const list = (rel: string): FsEntry[] => {
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
  return { missing: missingOutputs(b.patterns as string[], list, Number(b.since) || 0) };
}
function diagramPath(rel: string): string {
  const parts = segments(rel);
  if (!parts[parts.length - 1].endsWith(EXT)) throw new HttpError(400, "arquivo deve terminar em .archflow.json");
  return join(dir, ...parts);
}
const folderOf = (rel: string) => rel.split("/").slice(0, -1).join("/");
const relOf = (folder: string, name: string) => (folder ? `${folder}/${name}` : name);

function atomicWrite(path: string, data: string) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = path + ".tmp";
  writeFileSync(tmp, data);
  renameSync(tmp, path);
}

function saveNow() {
  clearTimeout(saveTimer);
  if (!dirty || !current) return;
  try {
    const p = diagramPath(current);
    atomicWrite(p, JSON.stringify(doc, null, 2));
    lastWrittenMtime = statSync(p).mtimeMs;
    dirty = false;
  } catch (e) {
    console.error("[bridge] falha ao salvar", e);
  }
}
function scheduleSave() {
  dirty = true;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 250);
}

function uniqueFile(title: string, folder = "", ignoreRel?: string): string {
  const base = slug(title) || "diagrama";
  let name = base + EXT;
  for (let i = 2; existsSync(pathIn(relOf(folder, name))) && relOf(folder, name) !== ignoreRel; i++) name = `${base}-${i}${EXT}`;
  return relOf(folder, name);
}
const readDoc = (rel: string): Doc => normalizeDoc(JSON.parse(readFileSync(diagramPath(rel), "utf8")));

function trashDir() {
  const t = join(dir, META, "trash");
  mkdirSync(t, { recursive: true });
  return t;
}

/* ───────── árvore do projeto ───────── */

interface FileNode {
  type: "file";
  name: string;
  path: string;
  title: string;
  updatedAt: number;
  size: number;
  nodes: number;
  connections: number;
  /** diagramas que este arquivo referencia (nós "system" com ref) */
  refs: string[];
  /** modo do diagrama (explorador: ícone e filtro) */
  mode: DocMode;
}
interface FolderNode {
  type: "folder";
  name: string;
  path: string;
  children: (FolderNode | FileNode)[];
}

function buildTree(abs: string, rel: string, depth: number, budget: { n: number }): FolderNode {
  const node: FolderNode = { type: "folder", name: rel ? basename(rel) : project.name, path: rel, children: [] };
  if (depth > 10 || !existsSync(abs)) return node;
  let entries: import("node:fs").Dirent[] = [];
  try {
    entries = readdirSync(abs, { withFileTypes: true });
  } catch {
    return node;
  }
  for (const e of entries) {
    if (budget.n <= 0) break;
    if (e.name.startsWith(".") || e.name === "node_modules") continue;
    const childRel = relOf(rel, e.name);
    if (e.isDirectory()) {
      budget.n--;
      node.children.push(buildTree(join(abs, e.name), childRel, depth + 1, budget));
    } else if (e.isFile() && e.name.endsWith(EXT)) {
      budget.n--;
      try {
        const st = statSync(join(abs, e.name));
        let title = e.name.replace(EXT, "");
        let nodes = 0;
        let connections = 0;
        let refs: string[] = [];
        let mode: DocMode = "architecture";
        try {
          const d = childRel === current ? doc : JSON.parse(readFileSync(join(abs, e.name), "utf8"));
          title = d.title || title;
          mode = docMode(d);
          nodes = d.nodes?.length ?? 0;
          connections = d.connections?.length ?? 0;
          refs = Array.from(new Set<string>((d.nodes ?? []).filter((x: any) => x?.ref?.diagram).map((x: any) => String(x.ref.diagram))));
        } catch {
          title += " (inválido)";
        }
        node.children.push({ type: "file", name: e.name, path: childRel, title, updatedAt: st.mtimeMs, size: st.size, nodes, connections, refs, mode });
      } catch {
        /* sumiu durante a leitura */
      }
    }
  }
  node.children.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true }) : a.type === "folder" ? -1 : 1));
  return node;
}

/** Atualiza `ref.diagram` em todos os diagramas do projeto quando um caminho muda. */
function rewriteRefs(map: (p: string) => string | undefined) {
  const apply = (d: any) => {
    let changed = false;
    for (const n of d?.nodes ?? []) {
      const m = n?.ref?.diagram ? map(String(n.ref.diagram)) : undefined;
      if (m && m !== n.ref.diagram) {
        n.ref = { ...n.ref, diagram: m };
        changed = true;
      }
    }
    return changed;
  };
  if (apply(doc)) {
    dirty = true;
    saveNow();
    rev++;
    broadcast("doc", { rev, doc, source: "file", file: current });
  }
  for (const f of flatten(buildTree(dir, "", 0, { n: 3000 }))) {
    if (f.path === current) continue;
    try {
      const p = diagramPath(f.path);
      const d = JSON.parse(readFileSync(p, "utf8"));
      if (apply(d)) atomicWrite(p, JSON.stringify(d, null, 2));
    } catch {
      /* arquivo inválido: ignora */
    }
  }
}

/** Resumo de outro diagrama (para o usuário/agente escolher o que referenciar). */
function outlineOf(name: string) {
  const d = name === current ? doc : readDoc(name);
  return {
    name,
    title: d.title,
    description: d.description,
    groups: d.groups.map((g) => ({ id: g.id, label: g.label, kind: g.kind })),
    nodes: d.nodes.map((n) => ({ id: n.id, label: n.label, kind: n.kind, technology: n.technology, owner: n.owner, endpoint: n.endpoint })),
    connections: d.connections.length,
  };
}

const flatten = (n: FolderNode): FileNode[] => n.children.flatMap((c) => (c.type === "file" ? [c] : flatten(c)));

function projectList() {
  const cfg = readConfig();
  return (cfg.projects ?? []).map((v) => ({ ...v, exists: existsSync(v.path) }));
}

function workspaceInfo() {
  const tree = buildTree(dir, "", 0, { n: 3000 });
  const files = flatten(tree).sort((a, b) => b.updatedAt - a.updatedAt);
  return { project: { id: project.id, name: project.name, path: project.path }, configured, projects: projectList(), current, tree, files };
}

function broadcast(event: string, data: unknown) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  clients.forEach((c) => c.write(msg));
}
const sendWorkspace = () => broadcast("workspace", workspaceInfo());
function publishDoc(source: string) {
  rev++;
  pristine = false;
  scheduleSave();
  scheduleHarnessSync();
  broadcast("doc", { rev, doc, source, file: current });
  sendWorkspace();
}

/* ───────── projetos ───────── */

function initProject(path: string, name?: string) {
  mkdirSync(join(path, META), { recursive: true });
  const meta = join(path, META, "project.json");
  if (existsSync(meta)) return;
  const legacy = join(path, META, "vault.json"); // pastas criadas quando «projeto» se chamava «cofre»
  if (existsSync(legacy)) return void renameSync(legacy, meta);
  writeFileSync(meta, JSON.stringify({ name: name ?? basename(path), createdAt: new Date().toISOString(), schema: "archflow-project/1" }, null, 2));
}

function openFile(rel: string, source = "file") {
  saveNow();
  doc = readDoc(rel);
  current = rel;
  dirty = false;
  lastWrittenMtime = statSync(diagramPath(rel)).mtimeMs;
  const cfg = readConfig();
  writeConfig({ lastOpened: { ...cfg.lastOpened, [dir]: rel } });
  pristine = false;
  rev++;
  broadcast("doc", { rev, doc, source, file: current });
  sendWorkspace();
}

function createDiagram(title: string, folder = "", source = "file", mode: DocMode = "architecture"): string {
  saveNow();
  segments(folder, true);
  const rel = uniqueFile(title, folder);
  atomicWrite(diagramPath(rel), JSON.stringify(emptyDoc(title, mode), null, 2));
  openFile(rel, source);
  return rel;
}

function watchDir() {
  watcher?.close();
  try {
    watcher = watch(dir, { persistent: false, recursive: true }, (_ev, f) => {
      if (f && String(f).split(/[\\/]/).some((p) => p.startsWith(".") && p !== "")) return; // ignora .archflow/
      clearTimeout(watchTimer);
      watchTimer = setTimeout(onDirChange, 300);
    });
    watcher.on("error", () => undefined);
  } catch {
    /* sistema sem watch recursivo */
  }
}

function firstFile(): string | undefined {
  return workspaceInfo().files[0]?.path;
}

function onDirChange() {
  if (!current) return;
  let p: string;
  try {
    p = diagramPath(current);
  } catch {
    return;
  }
  if (!existsSync(p)) {
    const f = firstFile();
    if (f) openFile(f);
    else createDiagram("Novo diagrama");
    return;
  }
  const m = statSync(p).mtimeMs;
  if (m !== lastWrittenMtime && !dirty) {
    try {
      const d = readDoc(current);
      lastWrittenMtime = m;
      if (JSON.stringify(d) !== JSON.stringify(doc)) {
        doc = d;
        rev++;
        broadcast("doc", { rev, doc, source: "file", file: current });
      }
    } catch {
      /* escrita parcial por outro programa */
    }
  }
  sendWorkspace();
}

function activateProject(v: Project, persist: boolean) {
  saveNow();
  if (v.id === "default") mkdirSync(v.path, { recursive: true });
  if (!existsSync(v.path) || !statSync(v.path).isDirectory()) throw new HttpError(404, "a pasta do projeto não existe mais");
  initProject(v.path, v.name);
  project = v;
  dir = v.path;
  configured = persist;
  if (persist) writeConfig({ active: v.id });
  watchDir();
  const last = readConfig().lastOpened?.[dir];
  const pick = last && existsSync(join(dir, ...last.split("/"))) ? last : firstFile();
  current = "";
  if (pick) openFile(pick);
  else {
    createDiagram("Novo diagrama");
    pristine = true;
  }
}

function registerProject(path: string, name?: string): Project {
  const cfg = readConfig();
  const projects = cfg.projects ?? [];
  const abs = resolve(path);
  let v = projects.find((x) => resolve(x.path) === abs);
  if (!v) {
    v = { id: `${slug(name ?? basename(abs))}-${Math.random().toString(36).slice(2, 6)}`, name: name ?? basename(abs), path: abs };
    projects.push(v);
    writeConfig({ projects });
  }
  return v;
}

function boot() {
  // migração: a lista de «cofres» vira a lista de projetos (as pastas e os ids continuam os mesmos)
  const old = readConfig();
  if (old.vaults?.length && !(old.projects ?? []).length) writeConfig({ projects: old.vaults, vaults: undefined });
  const cfg = readConfig();
  // migração: antiga "pasta de trabalho" única vira um projeto
  if (cfg.workspace && !(cfg.projects ?? []).length && existsSync(cfg.workspace)) {
    const v = registerProject(cfg.workspace);
    writeConfig({ active: v.id, workspace: undefined });
  }
  const c = readConfig();
  const active = (c.projects ?? []).find((v) => v.id === c.active && existsSync(v.path));
  try {
    if (active) activateProject(active, true);
    else activateProject({ id: "default", name: "Projeto padrão", path: DEFAULT_DIR }, false);
  } catch (e) {
    console.error("[bridge] projeto inválido, usando padrão", e);
    activateProject({ id: "default", name: "Projeto padrão", path: DEFAULT_DIR }, false);
  }
  rev = 0;
}

function createProject(name: string, parent: string) {
  const n = String(name ?? "").trim();
  if (!n || SEG_BAD.test(n) || n.startsWith(".")) throw new HttpError(400, "nome de projeto inválido");
  if (!isAbsolute(String(parent))) throw new HttpError(400, "informe o local (caminho absoluto)");
  const target = resolve(parent, n);
  if (existsSync(target)) throw new HttpError(409, "já existe uma pasta com esse nome nesse local");
  mkdirSync(target, { recursive: true });
  const v = registerProject(target, n);
  activateProject(v, true);
}

/* ───────── seletor de pastas ───────── */

/** `vault.json` é o nome antigo de `project.json`; pastas criadas antes da renomeação continuam valendo como projeto. */
const isProjectDir = (p: string) => existsSync(join(p, META, "project.json")) || existsSync(join(p, META, "vault.json"));

function listDir(path?: string) {
  if (!path) {
    if (process.platform === "win32") {
      const drives = "CDEFGHIJKLMNOPQRSTUVWXYZ".split("").map((l) => `${l}:\\`).filter((d) => existsSync(d));
      return { path: "", parent: null, home: homedir(), dirs: drives.map((d) => ({ name: d, path: d, archflow: 0, project: false })) };
    }
    path = homedir();
  }
  const p = resolve(path);
  if (!existsSync(p) || !statSync(p).isDirectory()) throw new HttpError(404, "pasta não encontrada");
  const dirs: { name: string; path: string; archflow: number; project: boolean }[] = [];
  for (const e of readdirSync(p, { withFileTypes: true })) {
    if (!e.isDirectory() || e.name.startsWith(".") || e.name.startsWith("$") || e.name === "node_modules") continue;
    const full = join(p, e.name);
    let archflow = 0;
    try {
      archflow = readdirSync(full).filter((n) => n.endsWith(EXT)).length;
    } catch {
      continue;
    }
    dirs.push({ name: e.name, path: full, archflow, project: isProjectDir(full) });
    if (dirs.length >= 800) break;
  }
  dirs.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  const up = dirname(p);
  const parent = up === p ? (process.platform === "win32" ? "" : null) : up;
  return { path: p, parent, home: homedir(), dirs, project: isProjectDir(p), files: readdirSync(p).filter((n) => n.endsWith(EXT)).length };
}

/* ───────── integração MCP (exe / dev) ───────── */

interface McpLaunch {
  command: string;
  args: string[];
  cwd?: string;
}

/** Raiz do código do Archflow, achada pela localização deste arquivo (server/ ou dist-mcp/) — nunca pela pasta atual do
 *  processo, que muda conforme quem iniciou o servidor (ex.: uma pasta temporária) e quebrava o caminho gravado nos clientes. */
function appRoot(): string {
  if (process.env.ARCHFLOW_ROOT) return resolve(process.env.ARCHFLOW_ROOT);
  try {
    return resolve(dirname(fileURLToPath(import.meta.url)), "..");
  } catch {
    return process.cwd(); // bundle CJS do Electron (sem import.meta); lá o exe é usado e este caminho não é gravado
  }
}

/** O bundle só serve se for mais novo que o código-fonte que ele empacota. */
function bundleFresh(root: string, bundle: string): boolean {
  try {
    const t = statSync(bundle).mtimeMs;
    // só o que entra no bundle (server/mcp-install.ts, por exemplo, não entra)
    const sources = [join(root, "server", "mcp.ts"), join(root, "server", "bridge.ts"), ...readdirSync(join(root, "src", "shared")).filter((f) => f.endsWith(".ts")).map((f) => join(root, "src", "shared", f))];
    return sources.every((f) => statSync(f).mtimeMs <= t);
  } catch {
    return false;
  }
}

/**
 * Como um cliente MCP deve iniciar o servidor. Sempre com caminhos absolutos e `node` direto (sem npx, que no Windows
 * depende do PATH e de .cmd): o exe instalado (--mcp); em dev, o bundle (se em dia) ou o tsx local do projeto.
 */
export function mcpLaunch(): McpLaunch {
  const exe = process.env.ARCHFLOW_EXE;
  if (exe) return { command: exe, args: ["--mcp"] };
  const root = appRoot();
  const fwd = (p: string) => p.split("\\").join("/");
  const bundle = join(root, "dist-mcp", "archflow-mcp.mjs");
  const src = join(root, "server", "mcp.ts");
  const tsxCli = join(root, "node_modules", "tsx", "dist", "cli.mjs");
  if (existsSync(bundle) && bundleFresh(root, bundle)) return { command: "node", args: [fwd(bundle)] };
  if (existsSync(tsxCli) && existsSync(src)) return { command: "node", args: [fwd(tsxCli), fwd(src)] };
  return { command: "npx", args: ["tsx", fwd(src)] };
}

export type McpClientId = "claude-desktop" | "claude-code" | "cursor" | "windsurf";
export const MCP_CLIENTS: Record<McpClientId, { label: string; file: () => string }> = {
  "claude-desktop": {
    label: "Claude Desktop",
    file: () =>
      process.platform === "win32"
        ? join(process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"), "Claude", "claude_desktop_config.json")
        : process.platform === "darwin"
          ? join(homedir(), "Library", "Application Support", "Claude", "claude_desktop_config.json")
          : join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "Claude", "claude_desktop_config.json"),
  },
  // Claude Code: usa a própria CLI (`claude mcp add`), que cuida da concorrência no arquivo de estado dele
  "claude-code": { label: "Claude Code", file: () => join(homedir(), ".claude.json") },
  cursor: { label: "Cursor", file: () => join(homedir(), ".cursor", "mcp.json") },
  windsurf: { label: "Windsurf", file: () => join(homedir(), ".codeium", "windsurf", "mcp_config.json") },
};
const SKILL_DIR = () => join(homedir(), ".claude", "skills", "archflow");

function readJsonFile(p: string): any | undefined {
  if (!existsSync(p)) return undefined;
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch {
    throw new HttpError(422, `${p} não é um JSON válido — corrija ou remova o arquivo e tente de novo (nada foi alterado)`);
  }
}

export function mcpInfo() {
  const clients = (Object.keys(MCP_CLIENTS) as McpClientId[]).map((id) => {
    const file = MCP_CLIENTS[id].file();
    let installed = false;
    try {
      installed = !!readJsonFile(file)?.mcpServers?.archflow;
    } catch {
      /* arquivo inválido: aparece como não instalado; o erro sai ao instalar */
    }
    return { id, label: MCP_CLIENTS[id].label, file, exists: existsSync(file), installed };
  });
  const skillFile = join(SKILL_DIR(), "SKILL.md");
  return { packaged: !!process.env.ARCHFLOW_EXE, launch: { ...mcpLaunch(), cwd: undefined }, clients, skill: { file: skillFile, installed: existsSync(skillFile) } };
}

/** Executável `claude` (Claude Code) no PATH, se houver. */
function claudeCli(): string | undefined {
  const r = spawnSync("claude", ["--version"], { encoding: "utf8", shell: false, timeout: 8000 });
  return r.error || r.status !== 0 ? undefined : "claude";
}

export function installMcp(id: string) {
  const c = MCP_CLIENTS[id as McpClientId];
  if (!c) throw new HttpError(400, "cliente desconhecido");
  const file = c.file();
  const launch = mcpLaunch();
  const entry = { command: launch.command, args: launch.args };
  if (id === "claude-code") {
    const cli = claudeCli();
    if (!cli) throw new HttpError(422, "Claude Code não encontrado no PATH. Abra o terminal e rode o comando da aba “Claude Code”.");
    spawnSync(cli, ["mcp", "remove", "--scope", "user", "archflow"], { encoding: "utf8", timeout: 15000 }); // troca uma entrada antiga/quebrada
    const r = spawnSync(cli, ["mcp", "add", "--scope", "user", "archflow", "--", entry.command, ...entry.args], { encoding: "utf8", timeout: 20000 });
    if (r.status !== 0) throw new HttpError(500, `claude mcp add falhou: ${(r.stderr || r.stdout || "sem detalhes").trim()}`);
    return { file, label: c.label };
  }
  const cfg = readJsonFile(file) ?? {};
  if (typeof cfg !== "object" || Array.isArray(cfg)) throw new HttpError(422, `${file} tem formato inesperado`);
  if (existsSync(file)) writeFileSync(file + ".bak", readFileSync(file));
  cfg.mcpServers = { ...(cfg.mcpServers ?? {}), archflow: entry };
  mkdirSync(dirname(file), { recursive: true });
  atomicWrite(file, JSON.stringify(cfg, null, 2));
  return { file, label: c.label };
}

export interface McpCheck {
  ok: boolean;
  /** o que está errado, em português, já com a correção sugerida */
  problems: string[];
  command?: string;
  tools?: number;
  ms?: number;
  /** últimas linhas que o servidor escreveu em stderr (a causa real quando ele morre ao iniciar) */
  stderr?: string;
}

const looksLikePath = (a: string) => /^[A-Za-z]:[\\/]/.test(a) || a.startsWith("/") || a.startsWith("\\\\");

/** Resolve um comando como o cliente faria: caminho absoluto existente ou executável no PATH. */
function resolveCommand(cmd: string): string | undefined {
  if (looksLikePath(cmd) || cmd.includes("/") || cmd.includes("\\")) return existsSync(cmd) ? cmd : undefined;
  const r = spawnSync(process.platform === "win32" ? "where" : "which", [cmd], { encoding: "utf8", timeout: 8000 });
  return r.status === 0 ? r.stdout.split(/\r?\n/)[0].trim() || cmd : undefined;
}

/**
 * Testa de verdade o que está gravado no cliente: confere comando e arquivos, inicia o processo igual ao cliente e
 * faz o handshake MCP (initialize + tools/list). É o mesmo caminho que o Cursor/Claude seguem — se passa aqui, conecta lá.
 */
export async function checkMcp(id: string): Promise<McpCheck> {
  const c = MCP_CLIENTS[id as McpClientId];
  if (!c) throw new HttpError(400, "cliente desconhecido");
  let entry: { command?: string; args?: string[]; env?: Record<string, string> } | undefined;
  try {
    entry = readJsonFile(c.file())?.mcpServers?.archflow;
  } catch (e) {
    return { ok: false, problems: [e instanceof Error ? e.message : String(e)] };
  }
  if (!entry?.command) return { ok: false, problems: [`O Archflow ainda não está configurado no ${c.label}. Clique em “Instalar”.`] };
  const command = entry.command;
  const args = entry.args ?? [];
  const problems: string[] = [];
  const found = resolveCommand(command);
  if (!found) problems.push(`O comando “${command}” não foi encontrado. Instale o Node.js 20+ (ou use o Archflow.exe) e reinstale.`);
  for (const a of args.filter((x) => !x.startsWith("-") && looksLikePath(x))) {
    if (!existsSync(a)) problems.push(`O arquivo não existe: ${a} — o caminho gravado ficou desatualizado (pasta movida ou temporária). Clique em “Reinstalar”.`);
  }
  if (problems.length) return { ok: false, problems, command };

  const t0 = Date.now();
  const useShell = process.platform === "win32" && !/\.exe$/i.test(command) && command !== "node"; // npx/.cmd precisam de shell no Windows
  const child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, ...(entry.env ?? {}) }, shell: useShell, windowsHide: true });
  let stderr = "";
  let out = "";
  child.stderr.on("data", (d) => (stderr = (stderr + d).slice(-1500)));
  const send = (m: object) => child.stdin.write(JSON.stringify(m) + "\n");
  return new Promise<McpCheck>((done) => {
    const finish = (r: Omit<McpCheck, "command" | "stderr" | "ms">) => {
      clearTimeout(timer);
      child.kill();
      done({ ...r, command, ms: Date.now() - t0, stderr: stderr.trim() || undefined });
    };
    const timer = setTimeout(() => finish({ ok: false, problems: ["O servidor não respondeu em 25 s. Reinicie o cliente e tente de novo (a primeira execução pode demorar)."] }), 25000);
    child.on("error", (e) => finish({ ok: false, problems: [`Não foi possível iniciar o comando: ${e.message}`] }));
    child.on("exit", (code) => finish({ ok: false, problems: [`O servidor encerrou ao iniciar (código ${code}). É o erro “Connection closed” do cliente — veja o detalhe abaixo.`] }));
    child.stdout.on("data", (d) => {
      out += d;
      let i: number;
      while ((i = out.indexOf("\n")) >= 0) {
        const line = out.slice(0, i).trim();
        out = out.slice(i + 1);
        if (!line) continue;
        try {
          const m = JSON.parse(line);
          if (m.id === 1 && m.result) {
            send({ jsonrpc: "2.0", method: "notifications/initialized" });
            send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
          } else if (m.id === 2 && m.result) {
            const tools = (m.result.tools ?? []).length;
            finish(tools ? { ok: true, problems: [], tools } : { ok: false, problems: ["O servidor conectou, mas não expôs nenhuma ferramenta."], tools });
          } else if (m.error) finish({ ok: false, problems: [`O servidor respondeu com erro: ${m.error.message ?? JSON.stringify(m.error)}`] });
        } catch {
          /* linha que não é JSON (log): ignora */
        }
      }
    });
    send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "archflow-check", version: "1" } } });
  });
}

/* ───────── exportação de imagem ─────────
 * Quem desenha é a janela do app: o bridge pede pelo SSE, a janela renderiza e devolve em /api/export/result. */

type ImageFormat = "svg" | "png";
interface ExportReply {
  data?: string;
  encoding?: "utf8" | "base64";
  w?: number;
  h?: number;
  error?: string;
}
const pendingExports = new Map<string, (r: ExportReply) => void>();
const EXPORT_TIMEOUT = 45000;

function requestRender(format: ImageFormat, opts: { background?: string; scale?: number; padding?: number }): Promise<ExportReply> {
  const id = `exp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  return new Promise((ok, fail) => {
    const timer = setTimeout(() => {
      pendingExports.delete(id);
      fail(new HttpError(504, "a janela do Archflow não respondeu a tempo. Deixe o app aberto (de preferência visível) e tente de novo."));
    }, EXPORT_TIMEOUT);
    pendingExports.set(id, (r) => {
      clearTimeout(timer);
      pendingExports.delete(id);
      ok(r);
    });
    broadcast("export", { id, format, file: current, ...opts });
  });
}

/** Sem `out`: ao lado do diagrama. Relativo = dentro do projeto. */
function exportTarget(format: ImageFormat, out?: string): string {
  const ext = `.${format}`;
  if (!out) return diagramPath(current).slice(0, -EXT.length) + ext;
  const abs = isAbsolute(out) ? resolve(out) : resolve(dir, out);
  if (!isAbsolute(out) && !abs.startsWith(resolve(dir) + sep)) throw new HttpError(400, "caminho relativo deve ficar dentro do projeto");
  const isDir = /[\\/]$/.test(out) || (existsSync(abs) && statSync(abs).isDirectory());
  if (isDir) return join(abs, basename(current).slice(0, -EXT.length) + ext);
  return extname(abs).toLowerCase() === ext ? abs : abs + ext;
}

async function exportImage(b: { format?: string; name?: string; out?: string; background?: string; scale?: number; padding?: number }) {
  const format = b.format as ImageFormat;
  if (format !== "svg" && format !== "png") throw new HttpError(400, `format inválido "${b.format}". Válidos: svg, png`);
  if (b.background != null && !["board", "solid", "transparent"].includes(b.background)) throw new HttpError(400, `background inválido "${b.background}". Válidos: board, solid, transparent`);
  if (!clients.size) throw new HttpError(409, "nenhuma janela do Archflow está aberta: a imagem é renderizada pelo app. Abra o Archflow e tente de novo.");
  if (b.name && b.name !== current) {
    if (!existsSync(diagramPath(b.name))) throw new HttpError(404, "diagrama não encontrado");
    openFile(b.name, "mcp");
  }
  const target = exportTarget(format, b.out);
  const r = await requestRender(format, { background: b.background, scale: b.scale, padding: b.padding });
  if (r.error || !r.data) throw new HttpError(500, `a janela não conseguiu exportar: ${r.error ?? "resposta vazia"}`);
  const bytes = Buffer.from(r.data, r.encoding === "base64" ? "base64" : "utf8");
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, bytes);
  return { file: target, diagram: current, format, bytes: bytes.length, width: r.w, height: r.h, ...(format === "png" ? { base64: r.data } : {}) };
}

function installSkill() {
  const file = join(SKILL_DIR(), "SKILL.md");
  atomicWrite(file, SKILL_MD);
  return { file };
}

/**
 * Grava o harness do diagrama `agents` aberto na pasta do projeto (`.claude/` ou `.cursor/`), que é onde o
 * Claude Code e o Cursor procuram subagentes e skills. Sobrescreve os arquivos gerados antes.
 */
/**
 * Lê o harness Claude de `.claude/` na pasta do projeto e devolve as ops que o recriariam no diagrama aberto.
 * Só leitura: quem aplica é o `/api/ops` (assim o desfazer e a validação continuam os de sempre).
 */
function readHarnessForImport() {
  if (!dir) throw new HttpError(422, "nenhum projeto em disco está aberto");
  if (docMode(doc) !== "agents") throw new HttpError(422, `o diagrama aberto está em modo "${docMode(doc)}"; o harness importa para um diagrama modo agents`);
  const files: { path: string; content: string }[] = [];
  const walk = (rel: string, pick: (name: string) => boolean) => {
    const abs = join(dir!, ...rel.split("/"));
    if (!existsSync(abs)) return;
    for (const e of readdirSync(abs, { withFileTypes: true })) {
      if (e.isDirectory()) walk(`${rel}/${e.name}`, () => true);
      else if (pick(e.name)) files.push({ path: `${rel}/${e.name}`, content: readFileSync(join(abs, e.name), "utf8") });
    }
  };
  walk(".claude/agents", (n) => n.endsWith(".md"));
  walk(".claude/skills", (n) => n === "SKILL.md");
  const { ops, skipped } = harnessToOps(files);
  return { ops, skipped, read: files.map((f) => f.path) };
}

function writeHarness(input: { target?: unknown; force?: unknown }) {
  const target = String(input.target ?? "claude");
  if (target !== "claude" && target !== "cursor") throw new HttpError(400, `target inválido "${target}". Válidos: claude, cursor`);
  if (docMode(doc) !== "agents") throw new HttpError(422, `o diagrama aberto está em modo "${docMode(doc)}"; o harness sai de um diagrama modo agents`);
  if (!dir) throw new HttpError(422, "nenhum projeto em disco está aberto");
  let files;
  try {
    files = generateHarness(doc, target);
  } catch (e) {
    throw new HttpError(422, e instanceof Error ? e.message : String(e));
  }
  if (!files.length) throw new HttpError(422, "nada a gerar: o diagrama não tem agentes nem skills exportáveis");
  // pedido explícito: o diagrama manda (sobrescreve edições manuais), a menos que `force: false`
  const r = syncHarness(dir, files, rootsOf(target as HarnessTarget), current, input.force !== false);
  return { target, root: dir, files: files.map((f) => f.path), ...r };
}

/**
 * Quais variáveis de ambiente existem (e não estão vazias) no processo do Archflow. SÓ booleanos: o valor nunca sai.
 * Atenção: o Claude Code resolve `${VAR}` no ambiente dele; isto é uma dica de configuração, não uma garantia.
 */
function envCheck(names: string | null): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const n of (names ?? "").split(",").slice(0, 50)) {
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(n)) out[n] = !!process.env[n];
  }
  return out;
}

/* ───────── prompts e workflows do projeto ───────── */

const promptsFile = () => join(dir, META, "prompts.json");

/** Biblioteca de prompts do projeto aberto; arquivo ausente ou corrompido vira biblioteca vazia. */
function readPrompts() {
  if (!dir) throw new HttpError(422, "nenhum projeto em disco está aberto");
  try {
    return normalizeLibrary(JSON.parse(readFileSync(promptsFile(), "utf8")));
  } catch {
    return normalizeLibrary(undefined);
  }
}

function writePrompts(input: { library?: unknown }) {
  if (!dir) throw new HttpError(422, "nenhum projeto em disco está aberto");
  if (!input || typeof input.library !== "object" || input.library === null) throw new HttpError(400, "informe { library }");
  const out = normalizeLibrary(input.library);
  atomicWrite(promptsFile(), `${JSON.stringify(out.library, null, 2)}\n`);
  return out;
}

/** O harness gravado no projeto está em dia com o diagrama aberto? (só leitura; base do aviso do terminal) */
function harnessStatus(target: string | null) {
  const t: HarnessTarget = target === "cursor" ? "cursor" : "claude";
  if (!dir || !current || docMode(doc) !== "agents") return { applicable: false, stale: [] as string[], owner: undefined, current };
  let files;
  try {
    files = generateHarness(doc, t);
  } catch {
    return { applicable: false, stale: [] as string[], owner: undefined, current };
  }
  const owner = readManifest(dir).diagram;
  return { applicable: files.length > 0, stale: files.length ? harnessDiff(dir, files, rootsOf(t)) : [], owner, current, foreign: !!owner && owner !== current };
}

/* ───────── harness automático ───────── */

const HARNESS_TARGETS: HarnessTarget[] = ["claude", "cursor"];
/** Pastas/arquivos que cada alvo administra: o Claude Code lê servidores MCP do `.mcp.json` na raiz. */
const rootsOf = (t: HarnessTarget) => (t === "claude" ? [".claude", ".mcp.json"] : [".cursor"]);

/** Alvos que o projeto mantém sincronizados sozinhos (`.archflow/project.json` → `harness.targets`). Padrão: só Claude Code. */
function harnessTargets(): HarnessTarget[] {
  try {
    const meta = JSON.parse(readFileSync(join(dir, META, "project.json"), "utf8"));
    const t = meta?.harness?.targets;
    if (Array.isArray(t)) return HARNESS_TARGETS.filter((x) => t.includes(x));
  } catch {
    /* sem metadados: padrão */
  }
  return ["claude"];
}

function setHarnessTargets(input: { targets?: unknown }) {
  if (!dir) throw new HttpError(422, "nenhum projeto em disco está aberto");
  if (!Array.isArray(input.targets) || input.targets.some((t) => !HARNESS_TARGETS.includes(t as HarnessTarget))) throw new HttpError(400, "targets deve ser uma lista com claude e/ou cursor");
  const path = join(dir, META, "project.json");
  let meta: Record<string, unknown> = {};
  try {
    meta = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    /* recria */
  }
  const targets = HARNESS_TARGETS.filter((t) => (input.targets as string[]).includes(t));
  atomicWrite(path, JSON.stringify({ ...meta, harness: { targets } }, null, 2));
  scheduleHarnessSync(0);
  return { targets };
}

let harnessTimer: ReturnType<typeof setTimeout> | undefined;
/** Regrava o harness depois de uma edição do diagrama agents; some em silêncio quando não se aplica. */
function scheduleHarnessSync(delay = 800) {
  clearTimeout(harnessTimer);
  harnessTimer = setTimeout(() => {
    if (!dir || !configured || !current || docMode(doc) !== "agents") return;
    const targets = harnessTargets();
    if (!targets.length) return;
    const owner = readManifest(dir).diagram;
    if (owner && owner !== current) return; // o harness do projeto pertence a outro diagrama agents; só o botão explícito troca
    const results: Record<string, HarnessSyncResult> = {};
    try {
      for (const target of targets) {
        const files = generateHarness(doc, target);
        results[target] = syncHarness(dir, files, rootsOf(target), current);
      }
    } catch (e) {
      return broadcast("harness", { ok: false, error: e instanceof Error ? e.message : String(e) });
    }
    const all = Object.values(results);
    const changed = all.reduce((n, r) => n + r.written.length + r.removed.length, 0);
    const conflicts = all.flatMap((r) => r.conflicts);
    if (changed || conflicts.length) broadcast("harness", { ok: true, targets, changed, conflicts });
  }, delay);
}

interface LockSkill {
  source?: string;
  skillPath?: string;
}

/** Entradas do `skills-lock.json` na raiz do projeto, gravado pelo próprio `npx skills add`. */
function readSkillLock(): Record<string, LockSkill> {
  try {
    const lock = JSON.parse(readFileSync(join(dir, "skills-lock.json"), "utf8"));
    return lock?.skills && typeof lock.skills === "object" ? lock.skills : {};
  } catch {
    return {};
  }
}

const stripAnsi = (s: string) => s.replace(/\u001b\[[0-9;]*m/g, "").replace(/\r/g, "");

/* ───────── skills baixadas (banco local) ───────── */

interface DownloadedSkill {
  id: string;
  name: string;
  repo: string;
  skillPath: string;
  description: string;
  body: string;
  hash: string;
  tags?: string;
  downloadedAt: string;
}
/** Skills já baixadas ficam em ~/.archflow/skills-downloaded.json: valem para qualquer projeto e não repetem o `npx skills add`. */
const DOWNLOADED_FILE = () => join(CONFIG_DIR, "skills-downloaded.json");
const readDownloaded = (): DownloadedSkill[] => {
  const j = readJsonFile(DOWNLOADED_FILE());
  return Array.isArray(j?.skills) ? j.skills : [];
};
export const listDownloadedSkills = () => ({ skills: readDownloaded() });
function saveDownloaded(entries: Omit<DownloadedSkill, "downloadedAt">[]) {
  const all = readDownloaded();
  for (const e of entries) {
    const i = all.findIndex((d) => d.repo.toLowerCase() === e.repo.toLowerCase() && d.id.toLowerCase() === e.id.toLowerCase());
    const row = { ...e, downloadedAt: new Date().toISOString() };
    if (i >= 0) all[i] = row;
    else all.push(row);
  }
  atomicWrite(DOWNLOADED_FILE(), JSON.stringify({ version: 1, skills: all }, null, 2));
}
function findDownloaded(repo: string, skillPath: string, slug: string | undefined) {
  return readDownloaded().find((d) => d.repo.toLowerCase() === repo.toLowerCase() && (d.skillPath === skillPath || (!!slug && d.id.toLowerCase() === slug.toLowerCase())));
}

/** Roda `npx skills …` no projeto aberto sem travar o servidor (o clone do repositório pode levar um minuto). */
function runSkills(args: string[]): Promise<{ stdout: string; stderr: string; status: number | null }> {
  const cmd = process.platform === "win32" ? "npx.cmd" : "npx";
  return new Promise((ok, fail) => {
    const child = spawn(cmd, args, { cwd: dir, shell: process.platform === "win32", windowsHide: true });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      child.kill();
      if (settled) return;
      settled = true;
      fail(new HttpError(504, "npx skills add excedeu 3 minutos"));
    }, 180_000);
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr = (stderr + d).slice(-4000)));
    child.on("error", (e) => finish(() => fail(new HttpError(502, `não deu para rodar npx skills add: ${e.message}`))));
    child.on("close", (status) => finish(() => ok({ stdout, stderr, status })));
  });
}

interface CliSkill {
  name?: string;
  status?: string;
  error?: string;
  path?: string;
}

/** O CLI imprime um quadro e, no fim, um JSON. Pega o array. */
function parseCliSkills(stdout: string): CliSkill[] | undefined {
  const start = stdout.search(/\[\s*\{/);
  if (start < 0) return undefined;
  try {
    const v = JSON.parse(stdout.slice(start));
    return Array.isArray(v) ? v : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Instala skill(s) de um repositório GitHub com `npx skills add` (CLI `skills`, hub skills.sh) dentro
 * do projeto aberto: `.agents/skills/<slug>/`, links em `.claude/skills/` e `.cursor/skills/`, e
 * `skills-lock.json`. Sem slug (URL do repositório, não de uma skill) instala todas as que o CLI achar.
 * O hash devolvido é o do app (`hashSkillContent`), para o drift bater com o fetch do catálogo curado;
 * o `computedHash` do lock continua sendo o sha256 do CLI.
 */
export async function installSkillFromCatalog(input: { repo?: unknown; skillPath?: unknown; force?: unknown }) {
  const repo = String(input.repo ?? "").trim();
  const skillPath = String(input.skillPath ?? "").trim();
  if (!/^[^/\s]+\/[^/\s]+$/.test(repo)) throw new HttpError(400, 'repo deve ser "owner/repo"');
  if (!skillPath) throw new HttpError(400, "skillPath vazio");
  const slug = skillInstallSlug(skillPath);
  const cached = input.force ? undefined : findDownloaded(repo, skillPath, slug);
  if (cached) return { installed: [{ ...cached, tags: "instalada" }], project: project?.name, cached: true };
  if (!dir) throw new HttpError(422, "nenhum projeto em disco está aberto");
  const args = ["--yes", "skills", "add", repo, "-a", "claude-code", "-a", "cursor", "-y", "--json"];
  if (slug) args.splice(4, 0, "-s", slug);
  const r = await runSkills(args);
  const parsed = parseCliSkills(r.stdout);
  const failed = parsed?.filter((e) => e.status === "failed") ?? [];
  const okOnes = parsed?.filter((e) => e.status !== "failed" && e.path && e.name) ?? [];
  if (!okOnes.length) {
    const detail = failed.find((e) => e.error)?.error ?? stripAnsi(r.stderr || r.stdout || "sem detalhes").trim().slice(-800);
    throw new HttpError(502, `npx skills add ${repo} falhou: ${detail}`);
  }
  const lock = readSkillLock();
  const installed = [];
  for (const entry of okOnes) {
    const name = String(entry.name);
    const file = join(String(entry.path), "SKILL.md");
    if (!existsSync(file)) continue;
    const raw = readFileSync(file, "utf8");
    const md = parseSkillMarkdown(raw);
    const locked = lock[name] ?? Object.entries(lock).find(([k]) => k.toLowerCase() === name.toLowerCase())?.[1];
    const path = locked?.skillPath || (slug ? skillPath : undefined);
    if (!path) continue;
    installed.push({ id: name, name: md.name || name, repo, skillPath: path, description: md.description ?? "", body: md.body, hash: hashSkillContent(raw), tags: "instalada" });
  }
  if (!installed.length) throw new HttpError(502, `npx skills add ${repo} instalou, mas o SKILL.md não foi encontrado`);
  saveDownloaded(installed);
  return { installed, project: project.name };
}

/** Busca no catálogo público skills.sh (o mesmo do `npx skills find`); feita aqui para não esbarrar em CORS. */
export async function searchSkillsHub(q: unknown) {
  const query = String(q ?? "").trim().slice(0, 100);
  if (query.length < 2) return { skills: [] };
  let res: Response;
  try {
    res = await fetch(`https://skills.sh/api/search?q=${encodeURIComponent(query)}&limit=20`, { signal: AbortSignal.timeout(10_000) });
  } catch (e) {
    throw new HttpError(502, `não deu para consultar o skills.sh: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!res.ok) throw new HttpError(502, `skills.sh respondeu ${res.status}`);
  const j = (await res.json().catch(() => ({}))) as { skills?: { source?: unknown; skillId?: unknown; name?: unknown; installs?: unknown }[] };
  const skills = (j.skills ?? [])
    .filter((e) => typeof e.source === "string" && /^\w[\w.-]*\/\w[\w.-]*$/.test(e.source) && typeof e.skillId === "string" && /^[\w.-]+$/.test(e.skillId))
    .map((e) => ({ repo: e.source as string, skillId: e.skillId as string, name: String(e.name ?? e.skillId), installs: Number(e.installs) || 0 }));
  return { skills };
}

/* ───────── fontes de skills (índice local) ───────── */

interface IndexedSkill {
  id: string;
  name: string;
  skillPath: string;
  description: string;
}
interface SkillSource {
  repo: string;
  indexedAt?: string;
  error?: string;
  skills: IndexedSkill[];
}
const SOURCES_FILE = () => join(CONFIG_DIR, "skill-sources.json");
/** Fontes iniciais (repositórios públicos com várias skills); o usuário pode remover e adicionar as dele. */
const DEFAULT_SOURCES = ["anthropics/skills", "mattpocock/skills", "wshobson/agents", "vercel-labs/agent-skills"];

function readSources(): SkillSource[] {
  const j = readJsonFile(SOURCES_FILE());
  if (Array.isArray(j?.sources)) return j.sources;
  return DEFAULT_SOURCES.map((repo) => ({ repo, skills: [] }));
}
const writeSources = (sources: SkillSource[]) => atomicWrite(SOURCES_FILE(), JSON.stringify({ version: 1, sources }, null, 2));
const sourceSummary = (s: SkillSource) => ({ repo: s.repo, indexedAt: s.indexedAt, error: s.error, count: s.skills.length });

function ghHeaders(): Record<string, string> {
  const h: Record<string, string> = { Accept: "application/vnd.github+json", "User-Agent": "archflow" };
  if (process.env.GITHUB_TOKEN) h.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  return h;
}

/** Lista os SKILL.md do repositório (1 chamada à API do GitHub) e lê name/description de cada um no raw. */
async function indexSource(repo: string): Promise<SkillSource> {
  const prev: SkillSource = { repo, skills: [] };
  try {
    const res = await fetch(`https://api.github.com/repos/${repo}/git/trees/HEAD?recursive=1`, { headers: ghHeaders(), signal: AbortSignal.timeout(20_000) });
    if (res.status === 403 || res.status === 429) throw new Error("limite da API do GitHub atingido (defina GITHUB_TOKEN ou tente mais tarde)");
    if (!res.ok) throw new Error(`GitHub respondeu ${res.status} para ${repo}`);
    const tree = ((await res.json()) as { tree?: { path: string; type: string }[] }).tree ?? [];
    const paths = tree.filter((t) => t.type === "blob" && /(^|\/)SKILL\.md$/i.test(t.path) && !/(^|\/)(node_modules|\.git)\//.test(t.path)).map((t) => t.path).slice(0, 300);
    const skills: IndexedSkill[] = [];
    let next = 0;
    const worker = async () => {
      while (next < paths.length) {
        const skillPath = paths[next++];
        const slug = skillInstallSlug(skillPath) ?? repo.split("/")[1];
        try {
          const r = await fetch(`https://raw.githubusercontent.com/${repo}/HEAD/${skillPath}`, { signal: AbortSignal.timeout(15_000) });
          const md = r.ok ? parseSkillMarkdown(await r.text()) : undefined;
          skills.push({ id: slug, name: md?.name || slug, skillPath, description: md?.description ?? "" });
        } catch {
          skills.push({ id: slug, name: slug, skillPath, description: "" });
        }
      }
    };
    await Promise.all(Array.from({ length: 6 }, worker));
    skills.sort((a, b) => a.skillPath.localeCompare(b.skillPath));
    return { repo, indexedAt: new Date().toISOString(), skills };
  } catch (e) {
    return { ...prev, error: e instanceof Error ? e.message : String(e) };
  }
}

const checkRepo = (v: unknown) => {
  const repo = String(v ?? "").trim().replace(/^https?:\/\/(www\.)?github\.com\//i, "").replace(/\.git$/i, "").replace(/\/+$/, "");
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new HttpError(400, 'fonte deve ser "owner/repo" ou a URL do repositório no GitHub');
  return repo;
};

export const listSkillSources = () => ({ sources: readSources().map(sourceSummary) });

/** Skills indexadas de todas as fontes (busca opcional por texto). */
export function indexedSkills(q: unknown) {
  const query = String(q ?? "").trim().toLowerCase();
  const out = readSources().flatMap((s) => s.skills.map((k) => ({ repo: s.repo, ...k })));
  return { skills: query ? out.filter((k) => `${k.id} ${k.name} ${k.repo} ${k.description}`.toLowerCase().includes(query)) : out };
}

export async function addSkillSource(input: { repo?: unknown }) {
  const repo = checkRepo(input.repo);
  const all = readSources();
  const idx = all.findIndex((s) => s.repo.toLowerCase() === repo.toLowerCase());
  const fresh = await indexSource(repo);
  if (idx >= 0) all[idx] = fresh;
  else all.push(fresh);
  writeSources(all);
  return listSkillSources();
}

/** Reindexa uma fonte (ou todas, sem `repo`). */
export async function refreshSkillSources(input: { repo?: unknown }) {
  const all = readSources();
  const only = input.repo ? checkRepo(input.repo).toLowerCase() : undefined;
  for (let i = 0; i < all.length; i++) {
    if (only && all[i].repo.toLowerCase() !== only) continue;
    const fresh = await indexSource(all[i].repo);
    all[i] = fresh.error && all[i].skills.length ? { ...all[i], error: fresh.error } : fresh; // mantém o índice antigo se falhar
  }
  writeSources(all);
  return listSkillSources();
}

export function removeSkillSource(input: { repo?: unknown }) {
  const repo = checkRepo(input.repo).toLowerCase();
  writeSources(readSources().filter((s) => s.repo.toLowerCase() !== repo));
  return listSkillSources();
}

let topCache: { at: number; skills: { repo: string; skillId: string; name: string; installs: number }[] } | undefined;

/**
 * Ranking da página inicial do skills.sh (all time). Não há API JSON para isso, então lê o HTML
 * renderizado no servidor; cache de 10 min. Se o site mudar o markup, devolve erro e a UI cai na busca.
 */
export async function topSkillsHub() {
  if (topCache && Date.now() - topCache.at < 10 * 60_000) return { skills: topCache.skills };
  let html: string;
  try {
    const res = await fetch("https://www.skills.sh/", { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    html = await res.text();
  } catch (e) {
    throw new HttpError(502, `não deu para consultar o skills.sh: ${e instanceof Error ? e.message : String(e)}`);
  }
  const mult: Record<string, number> = { K: 1e3, M: 1e6, B: 1e9 };
  const skills: { repo: string; skillId: string; name: string; installs: number }[] = [];
  const seen = new Set<string>();
  for (const m of html.matchAll(/<a class="group grid[^>]*href="\/([^"\/]+\/[^"\/]+)\/([^"\/]+)">([\s\S]*?)<\/a>/g)) {
    const [, repo, skillId, inner] = m;
    const text = inner.replace(/<[^>]+>/g, "|").split("|").map((t) => t.trim()).filter(Boolean);
    const inst = /^([\d.]+)([KMB])?$/.exec(text[text.length - 1] ?? "");
    if (!inst || seen.has(`${repo}/${skillId}`)) continue;
    seen.add(`${repo}/${skillId}`);
    skills.push({ repo, skillId, name: text[1] ?? skillId, installs: Math.round(Number(inst[1]) * (mult[inst[2]] ?? 1)) });
  }
  if (!skills.length) throw new HttpError(502, "não consegui ler o ranking do skills.sh");
  topCache = { at: Date.now(), skills };
  return { skills };
}

/* ───────── HTTP ───────── */

const ALLOWED_HOSTS = (process.env.ARCHFLOW_ALLOWED_HOSTS ?? "").split(",").map((h) => h.trim().toLowerCase()).filter(Boolean);
const isLocalHost = (h?: string) => !!h && (/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(h) || ALLOWED_HOSTS.includes(h.toLowerCase()));
function originOk(req: IncomingMessage): boolean {
  if (!isLocalHost(req.headers.host)) return false; // anti DNS-rebinding
  const o = req.headers.origin;
  if (!o) return true;
  try {
    return isLocalHost(new URL(o).host);
  } catch {
    return false;
  }
}
function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}
function readBody(req: IncomingMessage, max = 20e6): Promise<any> {
  return new Promise((ok, fail) => {
    let s = "";
    req.on("data", (d) => {
      s += d;
      if (s.length > max) fail(new HttpError(413, "payload grande demais"));
    });
    req.on("end", () => {
      try {
        ok(s ? JSON.parse(s) : {});
      } catch {
        fail(new HttpError(400, "JSON inválido"));
      }
    });
  });
}
const MIME: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".json": "application/json", ".woff2": "font/woff2", ".woff": "font/woff", ".png": "image/png" };

const body = async (req: IncomingMessage) => readBody(req);
const ws = (res: ServerResponse, extra: object = {}) => json(res, 200, { ...extra, ...workspaceInfo() });

async function handler(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? "/", "http://x");
  const path = url.pathname;
  const m = req.method;
  if (!originOk(req)) return json(res, 403, { error: "origem não permitida" });
  if (m === "OPTIONS") return void res.writeHead(204).end();
  if (PUBLIC_MODE && path.startsWith("/api/")) return json(res, 404, { error: "indisponível no modo público" });
  try {
    if (path === "/api/health") return json(res, 200, { ok: true, rev, title: doc.title });
    if (path === "/api/doc" && m === "GET") return json(res, 200, { rev, doc, file: current, pristine });
    if (path === "/api/doc" && m === "PUT") {
      const b = await body(req);
      if (b.file && b.file !== current) throw new HttpError(409, `o diagrama ativo agora é ${current}`);
      doc = normalizeDoc(b.doc);
      publishDoc(b.source ?? "ui");
      return json(res, 200, { rev });
    }
    if (path === "/api/ops" && m === "POST") {
      const b = await body(req);
      const out = applyOps(doc, (b.ops ?? []) as Op[]);
      if (out.results.some((r) => r.ok)) {
        doc = out.doc;
        publishDoc(b.source ?? "mcp");
      }
      return json(res, 200, { rev, results: out.results, file: current });
    }

    /* projetos */
    if (path === "/api/workspace" && m === "GET") return ws(res);
    if (path === "/api/projects" && m === "GET") return json(res, 200, { projects: projectList(), active: project.id });
    if (path === "/api/projects/create" && m === "POST") {
      const b = await body(req);
      createProject(b.name, b.parent);
      return ws(res);
    }
    if (path === "/api/projects/open" && m === "POST") {
      const b = await body(req);
      if (!isAbsolute(String(b.path))) throw new HttpError(400, "informe um caminho absoluto");
      const abs = resolve(b.path);
      if (!existsSync(abs) || !statSync(abs).isDirectory()) throw new HttpError(404, "pasta não encontrada");
      activateProject(registerProject(abs), true);
      return ws(res);
    }
    if (path === "/api/projects/switch" && m === "POST") {
      const b = await body(req);
      const v = (readConfig().projects ?? []).find((x) => x.id === b.id);
      if (!v) throw new HttpError(404, "projeto não encontrado");
      activateProject(v, true);
      return ws(res);
    }
    if (path === "/api/projects/remove" && m === "POST") {
      const b = await body(req);
      if (b.id === project.id && configured) throw new HttpError(400, "feche o projeto (abra outro) antes de removê-lo da lista");
      writeConfig({ projects: (readConfig().projects ?? []).filter((x) => x.id !== b.id) });
      return ws(res);
    }

    /* diagramas */
    if (path === "/api/diagrams" && m === "POST") {
      const b = await body(req);
      if (b.mode != null && b.mode !== "architecture" && b.mode !== "domain" && b.mode !== "logic" && b.mode !== "agents") throw new HttpError(400, `mode inválido "${b.mode}". Válidos: architecture, domain, logic, agents`);
      const rel = createDiagram(String(b.title || "Novo diagrama"), String(b.folder ?? ""), b.source ?? "file", b.mode === "domain" || b.mode === "logic" || b.mode === "agents" ? b.mode : "architecture");
      return ws(res, { name: rel });
    }
    if (path === "/api/diagrams/open" && m === "POST") {
      const b = await body(req);
      if (!existsSync(diagramPath(b.name))) throw new HttpError(404, "diagrama não encontrado");
      openFile(b.name);
      return ws(res);
    }
    if (path === "/api/diagrams/rename" && m === "POST") {
      const b = await body(req);
      const title = String(b.title || "").trim();
      if (!title) throw new HttpError(400, "título vazio");
      const from = diagramPath(b.name);
      if (!existsSync(from)) throw new HttpError(404, "diagrama não encontrado");
      saveNow();
      const next = uniqueFile(title, folderOf(b.name), b.name);
      if (next !== b.name) renameSync(from, diagramPath(next));
      const oldName = b.name as string;
      if (b.name === current) {
        current = next;
        doc = { ...doc, title };
        dirty = true;
        saveNow();
        writeConfig({ lastOpened: { ...readConfig().lastOpened, [dir]: next } });
        rev++;
        broadcast("doc", { rev, doc, source: b.source ?? "file", file: current });
      } else {
        atomicWrite(diagramPath(next), JSON.stringify({ ...readDoc(next), title }, null, 2));
      }
      if (next !== oldName) rewriteRefs((p) => (p === oldName ? next : undefined));
      sendWorkspace();
      return ws(res, { name: next });
    }
    if (path === "/api/diagrams/read" && m === "GET") {
      const name = url.searchParams.get("name") ?? "";
      if (!existsSync(diagramPath(name))) throw new HttpError(404, "diagrama não encontrado");
      return json(res, 200, { name, doc: name === current ? doc : readDoc(name) });
    }
    if (path === "/api/diagrams/outline" && m === "GET") {
      const name = url.searchParams.get("name") ?? "";
      if (!existsSync(diagramPath(name))) throw new HttpError(404, "diagrama não encontrado");
      return json(res, 200, outlineOf(name));
    }
    if (path === "/api/diagrams/duplicate" && m === "POST") {
      const b = await body(req);
      saveNow();
      const src = readDoc(b.name);
      const title = `${src.title} (cópia)`;
      const rel = uniqueFile(title, folderOf(b.name));
      atomicWrite(diagramPath(rel), JSON.stringify({ ...src, id: "diagram-" + Math.random().toString(36).slice(2, 8), title }, null, 2));
      openFile(rel);
      return ws(res, { name: rel });
    }
    if (path === "/api/diagrams/move" && m === "POST") {
      const b = await body(req);
      const from = diagramPath(b.name);
      if (!existsSync(from)) throw new HttpError(404, "diagrama não encontrado");
      segments(b.folder ?? "", true);
      if (folderOf(b.name) === (b.folder ?? "")) return ws(res);
      saveNow();
      const next = uniqueFile(readDoc(b.name).title, b.folder ?? "");
      mkdirSync(dirname(diagramPath(next)), { recursive: true });
      renameSync(from, diagramPath(next));
      if (b.name === current) {
        current = next;
        lastWrittenMtime = statSync(diagramPath(next)).mtimeMs;
        writeConfig({ lastOpened: { ...readConfig().lastOpened, [dir]: next } });
      }
      rewriteRefs((p) => (p === b.name ? next : undefined));
      sendWorkspace();
      return ws(res, { name: next });
    }
    if (path === "/api/diagrams/delete" && m === "POST") {
      const b = await body(req);
      const p = diagramPath(b.name);
      if (!existsSync(p)) throw new HttpError(404, "diagrama não encontrado");
      if (b.name === current) {
        clearTimeout(saveTimer);
        dirty = false;
      }
      renameSync(p, join(trashDir(), `${Date.now()}-${basename(b.name)}`));
      if (b.name === current) {
        const next = firstFile();
        if (next) openFile(next);
        else createDiagram("Novo diagrama");
      } else sendWorkspace();
      return ws(res);
    }

    /* pastas do projeto */
    if (path === "/api/folders" && m === "POST") {
      const b = await body(req);
      segments(b.path);
      mkdirSync(pathIn(b.path), { recursive: true });
      sendWorkspace();
      return ws(res);
    }
    if (path === "/api/folders/rename" && m === "POST") {
      const b = await body(req);
      const name = String(b.name ?? "").trim();
      segments(name);
      if (name.includes("/")) throw new HttpError(400, "nome inválido");
      const from = pathIn(b.path);
      if (!existsSync(from)) throw new HttpError(404, "pasta não encontrada");
      const parent = folderOf(b.path);
      const to = pathIn(relOf(parent, name));
      if (existsSync(to)) throw new HttpError(409, "já existe uma pasta com esse nome");
      saveNow();
      renameSync(from, to);
      if (current.startsWith(b.path + "/")) {
        current = relOf(relOf(parent, name), current.slice(b.path.length + 1));
        lastWrittenMtime = statSync(diagramPath(current)).mtimeMs;
        writeConfig({ lastOpened: { ...readConfig().lastOpened, [dir]: current } });
      }
      const newBase = relOf(parent, name);
      rewriteRefs((p) => (p.startsWith(b.path + "/") ? newBase + p.slice(b.path.length) : undefined));
      sendWorkspace();
      return ws(res);
    }
    if (path === "/api/folders/delete" && m === "POST") {
      const b = await body(req);
      const p = pathIn(b.path);
      if (!existsSync(p)) throw new HttpError(404, "pasta não encontrada");
      const inside = current.startsWith(b.path + "/");
      if (inside) {
        clearTimeout(saveTimer);
        dirty = false;
      }
      renameSync(p, join(trashDir(), `${Date.now()}-${basename(b.path)}`));
      if (inside) {
        const next = firstFile();
        if (next) openFile(next);
        else createDiagram("Novo diagrama");
      } else sendWorkspace();
      return ws(res);
    }

    if (path === "/api/fs/list" && m === "GET") return json(res, 200, listDir(url.searchParams.get("path") || undefined));
    if (path === "/api/fs/mkdir" && m === "POST") {
      const b = await body(req);
      if (!isAbsolute(String(b.path))) throw new HttpError(400, "informe um caminho absoluto");
      mkdirSync(resolve(b.path), { recursive: true });
      return json(res, 200, listDir(dirname(resolve(b.path))));
    }
    if (path === "/api/project/docs" && m === "GET") {
      // todos os diagramas do projeto (caminho + conteúdo): base da visão geral de domínio e da checagem de referências
      const files = flatten(buildTree(dir, "", 0, { n: 3000 })).flatMap((f) => {
        try {
          return [{ path: f.path, doc: f.path === current ? doc : readDoc(f.path) }];
        } catch {
          return []; // arquivo inválido: ignora
        }
      });
      return json(res, 200, { files });
    }
    if (path === "/api/project/outputs" && m === "POST") return json(res, 200, projectOutputs(await body(req)));
    if (path.startsWith("/api/runs")) {
      // histórico de execuções de workflow do projeto aberto (.archflow/runs/)
      if (!dir) throw new HttpError(409, "abra um projeto antes");
      if (path === "/api/runs" && m === "GET") return json(res, 200, { runs: listRuns(dir, url.searchParams.get("workflow") ?? undefined) });
      if (path === "/api/runs/get" && m === "GET") return json(res, 200, getRun(dir, url.searchParams.get("id")));
      if (path === "/api/runs" && m === "POST") return json(res, 200, saveRun(dir, (await body(req)).record));
      if (path === "/api/runs/snapshot" && m === "POST") return json(res, 200, snapshotStep(dir, await body(req)));
      if (path === "/api/runs/resume-files" && m === "POST") return json(res, 200, resumeFiles(dir, await body(req)));
    }
    if (path === "/api/describe") {
      res.writeHead(200, { "Content-Type": "text/markdown; charset=utf-8" });
      const paths = new Set(flatten(buildTree(dir, "", 0, { n: 3000 })).map((f) => f.path));
      return void res.end(describe(doc, { exists: (p) => paths.has(p) }));
    }
    if (path === "/api/mcp/info" && m === "GET") return json(res, 200, mcpInfo());
    if (path === "/api/mcp/install" && m === "POST") return json(res, 200, installMcp((await body(req)).client));
    if (path === "/api/mcp/check" && m === "POST") return json(res, 200, await checkMcp((await body(req)).client));
    if (path === "/api/skill" && m === "GET") {
      res.writeHead(200, { "Content-Type": "text/markdown; charset=utf-8" });
      return void res.end(SKILL_MD);
    }
    if (path === "/api/skill/install" && m === "POST") return json(res, 200, installSkill());
    if (path === "/api/skills/sources" && m === "GET") return json(res, 200, listSkillSources());
    if (path === "/api/skills/sources" && m === "POST") return json(res, 200, await addSkillSource(await body(req)));
    if (path === "/api/skills/sources/refresh" && m === "POST") return json(res, 200, await refreshSkillSources(await body(req)));
    if (path === "/api/skills/sources/remove" && m === "POST") return json(res, 200, removeSkillSource(await body(req)));
    if (path === "/api/skills/indexed" && m === "GET") return json(res, 200, indexedSkills(url.searchParams.get("q")));
    if (path === "/api/skills/top" && m === "GET") return json(res, 200, await topSkillsHub());
    if (path === "/api/skills/search" && m === "GET") return json(res, 200, await searchSkillsHub(url.searchParams.get("q")));
    if (path === "/api/skills/downloaded" && m === "GET") return json(res, 200, listDownloadedSkills());
    if (path === "/api/skills/install" && m === "POST") return json(res, 200, await installSkillFromCatalog(await body(req)));
    if (path === "/api/mcp/env-check" && m === "GET") return json(res, 200, envCheck(url.searchParams.get("names")));
    if (path === "/api/mcp/probe" && m === "POST") {
      // EXECUTA o comando (stdio) ou conecta na URL: só com confirmação explícita vinda de um clique do usuário
      let parsed;
      try {
        parsed = parseProbeBody(await body(req));
      } catch (e) {
        throw new HttpError(400, e instanceof Error ? e.message : String(e));
      }
      if (!parsed.confirm) throw new HttpError(400, "testar o servidor executa o comando (ou conecta na url): envie confirm: true depois de mostrar ao usuário o que será executado");
      try {
        return json(res, 200, await probeMcp(parsed.spec, { cwd: dir || undefined }));
      } catch (e) {
        throw new HttpError(e instanceof ProbeError ? 502 : 500, e instanceof ProbeError ? e.message : "falha inesperada ao testar o servidor");
      }
    }
    if (path === "/api/mcp-registry/search" && m === "GET") {
      try {
        return json(res, 200, await searchMcpRegistry(url.searchParams.get("q")));
      } catch (e) {
        throw new HttpError(502, e instanceof Error ? e.message : String(e));
      }
    }
    if (path.startsWith("/api/term")) {
      if (!terminalEnabled(HOST)) throw new HttpError(404, "terminal desabilitado (ARCHFLOW_TERM=0 ou host não é loopback)");
      try {
        if (path === "/api/term/info" && m === "GET") return json(res, 200, { ...termInfo(dir), cwd: dir, claude: await detectClaude({ refresh: url.searchParams.get("refresh") === "1" }) });
        if (path === "/api/term/conversation" && m === "GET") return json(res, 200, { exists: conversationExists(url.searchParams.get("id") ?? "") });
        assertToken(req);
        if (path === "/api/term/conversation/denials" && m === "POST") {
          const b = await body(req);
          const r = permissionDenials(String(b.id ?? ""), Number(b.since) || 0, dir);
          return json(res, 200, { denials: r.blocking, warnings: r.warnings });
        }
        if (path === "/api/term/conversation/last" && m === "POST") return json(res, 200, { text: lastAssistantText(String((await body(req)).id ?? "")) ?? null });
        if (path === "/api/term/start" && m === "POST") {
          if (!dir) throw new HttpError(409, "abra um projeto antes de iniciar o terminal");
          const b = await body(req);
          const args = Array.isArray(b.args) ? b.args.filter((a: unknown) => typeof a === "string") : [];
          return json(res, 200, await startSession({ cwd: dir, program: b.program, args, title: b.title, cols: b.cols, rows: b.rows, prefill: typeof b.prefill === "string" ? b.prefill : undefined }));
        }
        if (path === "/api/term/kill" && m === "POST") return json(res, 200, { ok: killSession(String((await body(req)).id)) });
      } catch (e) {
        if (e instanceof TermError) throw new HttpError(e.status, e.message);
        throw e;
      }
    }
    if (path === "/api/harness/settings" && m === "GET") return json(res, 200, { targets: dir ? harnessTargets() : [], configured: !!configured });
    if (path === "/api/harness/settings" && m === "POST") return json(res, 200, setHarnessTargets(await body(req)));
    if (path === "/api/prompts" && m === "GET") return json(res, 200, readPrompts());
    if (path === "/api/prompts" && m === "PUT") return json(res, 200, writePrompts(await readBody(req, 6e6)));
    if (path === "/api/harness/status" && m === "GET") return json(res, 200, harnessStatus(url.searchParams.get("target")));
    if (path === "/api/harness" && m === "POST") return json(res, 200, writeHarness(await body(req)));
    if (path === "/api/harness/import" && m === "POST") return json(res, 200, readHarnessForImport());
    if (path === "/api/export" && m === "POST") return json(res, 200, await exportImage(await body(req)));
    if (path === "/api/export/result" && m === "POST") {
      const b = await readBody(req, 120e6);
      pendingExports.get(String(b.id))?.(b);
      return json(res, 200, { ok: true });
    }
    if (path === "/api/schema") {
      res.writeHead(200, { "Content-Type": "text/markdown; charset=utf-8" });
      const wanted = url.searchParams.get("mode");
      return void res.end(schemaGuide(wanted === "domain" || wanted === "logic" || wanted === "agents" || wanted === "architecture" ? wanted : docMode(doc)));
    }
    if (path === "/api/events") {
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
      res.write(`event: hello\ndata: ${JSON.stringify({ rev })}\n\n`);
      clients.add(res);
      const ping = setInterval(() => res.write(": ping\n\n"), 20000);
      req.on("close", () => {
        clearInterval(ping);
        clients.delete(res);
      });
      return;
    }
    if (path.startsWith("/api/")) throw new HttpError(404, "rota não encontrada");
    if (existsSync(DIST)) {
      let f = normalize(join(DIST, path === "/" ? "index.html" : path));
      if (!f.startsWith(DIST + sep) && f !== DIST) f = join(DIST, "index.html");
      if (!existsSync(f) || statSync(f).isDirectory()) f = join(DIST, "index.html");
      res.writeHead(200, { "Content-Type": MIME[extname(f)] ?? "application/octet-stream" });
      return void res.end(readFileSync(f));
    }
    json(res, 404, { error: "not found" });
  } catch (e) {
    const status = e instanceof HttpError || e instanceof RunStoreError ? e.status : e instanceof SyntaxError ? 400 : 500;
    json(res, status, { error: e instanceof Error ? e.message : String(e) });
  }
}

let booted = false;
let server: ReturnType<typeof createServer> | undefined;
/** Sobe o bridge; se a porta já estiver ocupada por outro bridge, apenas reutiliza. */
export function ensureBridge(port = DEFAULT_PORT): Promise<"started" | "existing"> {
  return new Promise((ok, fail) => {
    const srv = createServer(handler);
    server = srv;
    srv.on("upgrade", (req, socket, head) => {
      if (PUBLIC_MODE || !isLocalHost(req.headers.host) || !handleUpgrade(req, socket, head, terminalEnabled(HOST))) socket.destroy();
    });
    srv.once("error", (e: NodeJS.ErrnoException) => (e.code === "EADDRINUSE" ? ok("existing") : fail(e)));
    srv.listen(port, HOST, () => {
      if (!booted) {
        booted = true;
        if (!PUBLIC_MODE) boot();
      }
      console.error(PUBLIC_MODE ? `[bridge] http://${HOST}:${port}  modo público (somente estático)` : `[bridge] http://${HOST}:${port}  projeto: ${project.name} (${dir})`);
      ok("started");
    });
  });
}

/** Fecha a porta, o watcher e as conexões SSE — o processo pode terminar (usado pelos testes). */
export function stopBridge() {
  killAll();
  saveNow();
  clearTimeout(saveTimer);
  clearTimeout(watchTimer);
  watcher?.close();
  clients.forEach((c) => c.end());
  clients.clear();
  server?.close();
  server = undefined;
}

for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => (saveNow(), process.exit(0)));
process.on("exit", () => (killAll(), saveNow()));

if (process.argv[1] && /bridge\.(ts|js)$/.test(process.argv[1])) {
  ensureBridge().then((r) => r === "existing" && console.error(`[bridge] porta ${DEFAULT_PORT} já em uso — bridge existente`));
}
