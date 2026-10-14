/**
 * Archflow Bridge — cofres (vaults) de diagramas em disco + ponte navegador ↔ MCP.
 *
 * Um COFRE é uma pasta qualquer; dentro dela, diagramas `*.archflow.json` em subpastas livres.
 * A pasta oculta `.archflow/` guarda `vault.json` e a lixeira (como o `.obsidian/` do Obsidian).
 *
 *   GET  /api/health | GET /api/doc | PUT /api/doc | POST /api/ops
 *   GET  /api/workspace                         → { vault, configured, vaults[], current, tree, files[] }
 *   GET  /api/vaults                            → { vaults[], active }
 *   POST /api/vaults/create  { name, parent }   cria pasta nova e a abre como cofre
 *   POST /api/vaults/open    { path }           abre uma pasta existente como cofre
 *   POST /api/vaults/switch  { id }
 *   POST /api/vaults/remove  { id }             só tira da lista (não apaga nada)
 *   POST /api/diagrams          { title, folder? }
 *   POST /api/diagrams/open|rename|duplicate|delete|move
 *   POST /api/folders | /api/folders/rename | /api/folders/delete
 *   GET  /api/fs/list?path=  · POST /api/fs/mkdir   (navegador de pastas)
 *   POST /api/export { format, name?, out?, background?, scale?, padding? }  SVG/PNG renderizado pela janela do app
 *   GET  /api/events                            SSE: hello | doc | workspace | export
 * Caminhos de diagrama são relativos ao cofre, com "/" (ex.: "backend/orders.archflow.json").
 */
import { spawn, spawnSync } from "node:child_process";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import {
  existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, watch, writeFileSync, type FSWatcher,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, extname, isAbsolute, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { applyOps, describe, normalizeDoc, schemaGuide, slug, type Op } from "../src/shared/ops";
import { docMode, emptyDoc, type Doc, type DocMode } from "../src/shared/schema";
import { SKILL_MD } from "../src/shared/skill.generated";

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
 * servidor — cada visitante usa o cofre do próprio navegador (IndexedDB), sem login e sem ver dados alheios.
 */
const PUBLIC_MODE = process.env.ARCHFLOW_PUBLIC === "1";
const SEG_BAD = /[\\/:*?"<>|\0]/;

interface Vault {
  id: string;
  name: string;
  path: string;
}
interface Config {
  vaults?: Vault[];
  active?: string;
  lastOpened?: Record<string, string>;
  workspace?: string; // legado (pasta única)
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

let vault: Vault = { id: "default", name: "Cofre padrão", path: DEFAULT_DIR };
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

/* ───────── árvore do cofre ───────── */

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
  const node: FolderNode = { type: "folder", name: rel ? basename(rel) : vault.name, path: rel, children: [] };
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

/** Atualiza `ref.diagram` em todos os diagramas do cofre quando um caminho muda. */
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

function vaultList() {
  const cfg = readConfig();
  return (cfg.vaults ?? []).map((v) => ({ ...v, exists: existsSync(v.path) }));
}

function workspaceInfo() {
  const tree = buildTree(dir, "", 0, { n: 3000 });
  const files = flatten(tree).sort((a, b) => b.updatedAt - a.updatedAt);
  return { vault: { id: vault.id, name: vault.name, path: vault.path }, configured, vaults: vaultList(), current, tree, files };
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
  broadcast("doc", { rev, doc, source, file: current });
  sendWorkspace();
}

/* ───────── cofres ───────── */

function initVault(path: string, name?: string) {
  mkdirSync(join(path, META), { recursive: true });
  const meta = join(path, META, "vault.json");
  if (!existsSync(meta)) writeFileSync(meta, JSON.stringify({ name: name ?? basename(path), createdAt: new Date().toISOString(), schema: "archflow-vault/1" }, null, 2));
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

function activateVault(v: Vault, persist: boolean) {
  saveNow();
  if (v.id === "default") mkdirSync(v.path, { recursive: true });
  if (!existsSync(v.path) || !statSync(v.path).isDirectory()) throw new HttpError(404, "a pasta do cofre não existe mais");
  initVault(v.path, v.name);
  vault = v;
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

function registerVault(path: string, name?: string): Vault {
  const cfg = readConfig();
  const vaults = cfg.vaults ?? [];
  const abs = resolve(path);
  let v = vaults.find((x) => resolve(x.path) === abs);
  if (!v) {
    v = { id: `${slug(name ?? basename(abs))}-${Math.random().toString(36).slice(2, 6)}`, name: name ?? basename(abs), path: abs };
    vaults.push(v);
    writeConfig({ vaults });
  }
  return v;
}

function boot() {
  const cfg = readConfig();
  // migração: antiga "pasta de trabalho" única vira um cofre
  if (cfg.workspace && !(cfg.vaults ?? []).length && existsSync(cfg.workspace)) {
    const v = registerVault(cfg.workspace);
    writeConfig({ active: v.id, workspace: undefined });
  }
  const c = readConfig();
  const active = (c.vaults ?? []).find((v) => v.id === c.active && existsSync(v.path));
  try {
    if (active) activateVault(active, true);
    else activateVault({ id: "default", name: "Cofre padrão", path: DEFAULT_DIR }, false);
  } catch (e) {
    console.error("[bridge] cofre inválido, usando padrão", e);
    activateVault({ id: "default", name: "Cofre padrão", path: DEFAULT_DIR }, false);
  }
  rev = 0;
}

function createVault(name: string, parent: string) {
  const n = String(name ?? "").trim();
  if (!n || SEG_BAD.test(n) || n.startsWith(".")) throw new HttpError(400, "nome de cofre inválido");
  if (!isAbsolute(String(parent))) throw new HttpError(400, "informe o local (caminho absoluto)");
  const target = resolve(parent, n);
  if (existsSync(target)) throw new HttpError(409, "já existe uma pasta com esse nome nesse local");
  mkdirSync(target, { recursive: true });
  const v = registerVault(target, n);
  activateVault(v, true);
}

/* ───────── seletor de pastas ───────── */

function listDir(path?: string) {
  if (!path) {
    if (process.platform === "win32") {
      const drives = "CDEFGHIJKLMNOPQRSTUVWXYZ".split("").map((l) => `${l}:\\`).filter((d) => existsSync(d));
      return { path: "", parent: null, home: homedir(), dirs: drives.map((d) => ({ name: d, path: d, archflow: 0, vault: false })) };
    }
    path = homedir();
  }
  const p = resolve(path);
  if (!existsSync(p) || !statSync(p).isDirectory()) throw new HttpError(404, "pasta não encontrada");
  const dirs: { name: string; path: string; archflow: number; vault: boolean }[] = [];
  for (const e of readdirSync(p, { withFileTypes: true })) {
    if (!e.isDirectory() || e.name.startsWith(".") || e.name.startsWith("$") || e.name === "node_modules") continue;
    const full = join(p, e.name);
    let archflow = 0;
    try {
      archflow = readdirSync(full).filter((n) => n.endsWith(EXT)).length;
    } catch {
      continue;
    }
    dirs.push({ name: e.name, path: full, archflow, vault: existsSync(join(full, META, "vault.json")) });
    if (dirs.length >= 800) break;
  }
  dirs.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  const up = dirname(p);
  const parent = up === p ? (process.platform === "win32" ? "" : null) : up;
  return { path: p, parent, home: homedir(), dirs, vault: existsSync(join(p, META, "vault.json")), files: readdirSync(p).filter((n) => n.endsWith(EXT)).length };
}

/* ───────── integração MCP (exe / dev) ───────── */

interface McpLaunch {
  command: string;
  args: string[];
  cwd?: string;
}

/** Raiz do projeto, achada pela localização deste arquivo (server/ ou dist-mcp/) — nunca pela pasta atual do processo,
 *  que muda conforme quem iniciou o servidor (ex.: uma pasta temporária) e quebrava o caminho gravado nos clientes. */
function projectRoot(): string {
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
  const root = projectRoot();
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

/** Sem `out`: ao lado do diagrama. Relativo = dentro do cofre. */
function exportTarget(format: ImageFormat, out?: string): string {
  const ext = `.${format}`;
  if (!out) return diagramPath(current).slice(0, -EXT.length) + ext;
  const abs = isAbsolute(out) ? resolve(out) : resolve(dir, out);
  if (!isAbsolute(out) && !abs.startsWith(resolve(dir) + sep)) throw new HttpError(400, "caminho relativo deve ficar dentro do cofre");
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

    /* cofres */
    if (path === "/api/workspace" && m === "GET") return ws(res);
    if (path === "/api/vaults" && m === "GET") return json(res, 200, { vaults: vaultList(), active: vault.id });
    if (path === "/api/vaults/create" && m === "POST") {
      const b = await body(req);
      createVault(b.name, b.parent);
      return ws(res);
    }
    if (path === "/api/vaults/open" && m === "POST") {
      const b = await body(req);
      if (!isAbsolute(String(b.path))) throw new HttpError(400, "informe um caminho absoluto");
      const abs = resolve(b.path);
      if (!existsSync(abs) || !statSync(abs).isDirectory()) throw new HttpError(404, "pasta não encontrada");
      activateVault(registerVault(abs), true);
      return ws(res);
    }
    if (path === "/api/vaults/switch" && m === "POST") {
      const b = await body(req);
      const v = (readConfig().vaults ?? []).find((x) => x.id === b.id);
      if (!v) throw new HttpError(404, "cofre não encontrado");
      activateVault(v, true);
      return ws(res);
    }
    if (path === "/api/vaults/remove" && m === "POST") {
      const b = await body(req);
      if (b.id === vault.id && configured) throw new HttpError(400, "feche o cofre (abra outro) antes de removê-lo da lista");
      writeConfig({ vaults: (readConfig().vaults ?? []).filter((x) => x.id !== b.id) });
      return ws(res);
    }

    /* diagramas */
    if (path === "/api/diagrams" && m === "POST") {
      const b = await body(req);
      if (b.mode != null && b.mode !== "architecture" && b.mode !== "domain" && b.mode !== "logic") throw new HttpError(400, `mode inválido "${b.mode}". Válidos: architecture, domain, logic`);
      const rel = createDiagram(String(b.title || "Novo diagrama"), String(b.folder ?? ""), b.source ?? "file", b.mode === "domain" || b.mode === "logic" ? b.mode : "architecture");
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

    /* pastas do cofre */
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
    if (path === "/api/vault/docs" && m === "GET") {
      // todos os diagramas do cofre (caminho + conteúdo): base da visão geral de domínio e da checagem de referências
      const files = flatten(buildTree(dir, "", 0, { n: 3000 })).flatMap((f) => {
        try {
          return [{ path: f.path, doc: f.path === current ? doc : readDoc(f.path) }];
        } catch {
          return []; // arquivo inválido: ignora
        }
      });
      return json(res, 200, { files });
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
    if (path === "/api/export" && m === "POST") return json(res, 200, await exportImage(await body(req)));
    if (path === "/api/export/result" && m === "POST") {
      const b = await readBody(req, 120e6);
      pendingExports.get(String(b.id))?.(b);
      return json(res, 200, { ok: true });
    }
    if (path === "/api/schema") {
      res.writeHead(200, { "Content-Type": "text/markdown; charset=utf-8" });
      const wanted = url.searchParams.get("mode");
      return void res.end(schemaGuide(wanted === "domain" || wanted === "logic" || wanted === "architecture" ? wanted : docMode(doc)));
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
    const status = e instanceof HttpError ? e.status : e instanceof SyntaxError ? 400 : 500;
    json(res, status, { error: e instanceof Error ? e.message : String(e) });
  }
}

let booted = false;
/** Sobe o bridge; se a porta já estiver ocupada por outro bridge, apenas reutiliza. */
export function ensureBridge(port = DEFAULT_PORT): Promise<"started" | "existing"> {
  return new Promise((ok, fail) => {
    const srv = createServer(handler);
    srv.once("error", (e: NodeJS.ErrnoException) => (e.code === "EADDRINUSE" ? ok("existing") : fail(e)));
    srv.listen(port, HOST, () => {
      if (!booted) {
        booted = true;
        if (!PUBLIC_MODE) boot();
      }
      console.error(PUBLIC_MODE ? `[bridge] http://${HOST}:${port}  modo público (somente estático)` : `[bridge] http://${HOST}:${port}  cofre: ${vault.name} (${dir})`);
      ok("started");
    });
  });
}

for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => (saveNow(), process.exit(0)));
process.on("exit", saveNow);

if (process.argv[1] && /bridge\.(ts|js)$/.test(process.argv[1])) {
  ensureBridge().then((r) => r === "existing" && console.error(`[bridge] porta ${DEFAULT_PORT} já em uso — bridge existente`));
}
