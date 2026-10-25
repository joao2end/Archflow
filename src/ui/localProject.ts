/**
 * Projetos na MEMÓRIA DO NAVEGADOR (IndexedDB) — usado quando o servidor local (bridge) não está rodando.
 * Implementa as mesmas rotas `/api/...` que o bridge, devolvendo `Response` como o `fetch`,
 * para a UI (explorador, projetos, referências, visualizador) funcionar sem mudanças.
 * Limites: sem pasta em disco, sem MCP e sem edição externa (Git/editor).
 */
import { createDoc, normalizeDoc, slug } from "../shared/ops";
import { docMode, emptyDoc, type Doc, type DocMode } from "../shared/schema";
import type { FileNode, FolderNode } from "./store";

const EXT = ".archflow.json";
const SEG_BAD = /[\\/:*?"<>|\0]/;
const BUNDLE = "archflow-project/1";
/** Pacotes exportados quando «projeto» se chamava «cofre»; o conteúdo é o mesmo. */
const BUNDLE_LEGACY = "archflow-vault/1";

export type LocalEmit = (event: "doc" | "workspace", data: unknown) => void;

interface StoredFile {
  doc: Doc;
  updatedAt: number;
}
interface LocalProject {
  id: string;
  name: string;
  createdAt: number;
  files: Record<string, StoredFile>;
  folders: string[];
  lastOpened?: string;
  trash: { at: number; path: string; files: Record<string, StoredFile> }[];
}
interface Meta {
  projects: { id: string; name: string }[];
  active: string;
}

/* ───────── armazenamento (IndexedDB, com fallback em memória) ───────── */

const memory = new Map<string, unknown>();
let idbOk = true;
let dbp: Promise<IDBDatabase> | null = null;
const db = () =>
  (dbp ??= new Promise<IDBDatabase>((ok, fail) => {
    try {
      const r = indexedDB.open("archflow-local", 1);
      r.onupgradeneeded = () => r.result.createObjectStore("kv");
      r.onsuccess = () => ok(r.result);
      r.onerror = () => fail(r.error);
    } catch (e) {
      fail(e);
    }
  }));

async function kvGet<T>(key: string): Promise<T | undefined> {
  if (!idbOk) return memory.get(key) as T | undefined;
  try {
    const d = await db();
    return await new Promise<T | undefined>((ok, fail) => {
      const q = d.transaction("kv").objectStore("kv").get(key);
      q.onsuccess = () => ok(q.result as T | undefined);
      q.onerror = () => fail(q.error);
    });
  } catch {
    idbOk = false;
    return memory.get(key) as T | undefined;
  }
}
async function kvSet(key: string, value: unknown) {
  memory.set(key, value);
  if (!idbOk) return;
  try {
    const d = await db();
    await new Promise<void>((ok, fail) => {
      const t = d.transaction("kv", "readwrite");
      t.objectStore("kv").put(value, key);
      t.oncomplete = () => ok();
      t.onerror = () => fail(t.error);
    });
  } catch {
    idbOk = false;
  }
}
async function kvDel(key: string) {
  memory.delete(key);
  if (!idbOk) return;
  try {
    const d = await db();
    await new Promise<void>((ok) => {
      const t = d.transaction("kv", "readwrite");
      t.objectStore("kv").delete(key);
      t.oncomplete = () => ok();
      t.onerror = () => ok();
    });
  } catch {
    /* ignora */
  }
}
/** false quando o navegador bloqueia o armazenamento (ex.: janela privada) — dados duram só enquanto a aba existir. */
export const isPersistent = () => idbOk;

/* ───────── estado ───────── */

let meta: Meta = { projects: [], active: "" };
let project: LocalProject;
let current = "";
let rev = 0;
let emit: LocalEmit = () => undefined;
let saveTimer: ReturnType<typeof setTimeout> | undefined;

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    void kvSet("meta", meta);
    void kvSet(`project:${project.id}`, project);
  }, 250);
}
const flush = async () => {
  clearTimeout(saveTimer);
  await kvSet("meta", meta);
  await kvSet(`project:${project.id}`, project);
};

/* ───────── caminhos ───────── */

const parentOf = (p: string) => p.split("/").slice(0, -1).join("/");
const relOf = (folder: string, name: string) => (folder ? `${folder}/${name}` : name);
function segments(rel: string, allowEmpty = false): string[] {
  const parts = String(rel ?? "").split("/").filter(Boolean);
  if (!parts.length && !allowEmpty) throw new HttpError(400, "caminho vazio");
  for (const s of parts) if (SEG_BAD.test(s) || s === "." || s === ".." || s.startsWith(".")) throw new HttpError(400, `nome inválido: ${s}`);
  return parts;
}
const diagramKey = (rel: string) => {
  const parts = segments(rel);
  if (!parts[parts.length - 1].endsWith(EXT)) throw new HttpError(400, "arquivo deve terminar em .archflow.json");
  return parts.join("/");
};
function uniqueFile(title: string, folder = "", ignore?: string): string {
  const base = slug(title) || "diagrama";
  let name = base + EXT;
  for (let i = 2; project.files[relOf(folder, name)] && relOf(folder, name) !== ignore; i++) name = `${base}-${i}${EXT}`;
  return relOf(folder, name);
}
const fileOrThrow = (rel: string): StoredFile => {
  const f = project.files[diagramKey(rel)];
  if (!f) throw new HttpError(404, "diagrama não encontrado");
  return f;
};

/* ───────── árvore ───────── */

function buildTree(): FolderNode {
  const root: FolderNode = { type: "folder", name: project.name, path: "", children: [] };
  const map = new Map<string, FolderNode>([["", root]]);
  const ensure = (p: string): FolderNode => {
    const hit = map.get(p);
    if (hit) return hit;
    const parent = ensure(parentOf(p));
    const n: FolderNode = { type: "folder", name: p.split("/").pop()!, path: p, children: [] };
    parent.children.push(n);
    map.set(p, n);
    return n;
  };
  project.folders.forEach(ensure);
  for (const [path, f] of Object.entries(project.files)) {
    const refs = Array.from(new Set(f.doc.nodes.filter((n) => n.ref?.diagram).map((n) => n.ref!.diagram)));
    ensure(parentOf(path)).children.push({
      type: "file",
      name: path.split("/").pop()!,
      path,
      title: f.doc.title,
      updatedAt: f.updatedAt,
      size: JSON.stringify(f.doc).length,
      nodes: f.doc.nodes.length,
      connections: f.doc.connections.length,
      refs,
      mode: docMode(f.doc),
    });
  }
  const sort = (n: FolderNode) => {
    n.children.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true }) : a.type === "folder" ? -1 : 1));
    n.children.forEach((c) => c.type === "folder" && sort(c));
  };
  sort(root);
  return root;
}
const flatten = (n: FolderNode): FileNode[] => n.children.flatMap((c) => (c.type === "file" ? [c] : flatten(c)));

function workspaceInfo() {
  const tree = buildTree();
  return {
    project: { id: project.id, name: project.name, path: "Memória deste navegador" },
    configured: true,
    projects: meta.projects.map((v) => ({ id: v.id, name: v.name, path: "Memória deste navegador", exists: true })),
    current,
    tree,
    files: flatten(tree).sort((a, b) => b.updatedAt - a.updatedAt),
    storage: "local" as const,
  };
}
const sendWorkspace = () => emit("workspace", workspaceInfo());

/* ───────── operações ───────── */

function openFile(rel: string, source = "file") {
  const f = fileOrThrow(rel);
  current = rel;
  project.lastOpened = rel;
  rev++;
  persist();
  emit("doc", { rev, doc: f.doc, source, file: current });
  sendWorkspace();
}

function createDiagram(title: string, folder = "", mode: DocMode = "architecture", blank = false): string {
  segments(folder, true);
  if (folder && !project.folders.includes(folder)) project.folders.push(folder);
  const rel = uniqueFile(title, folder);
  project.files[rel] = { doc: createDoc(title, mode, { blank }), updatedAt: Date.now() };
  openFile(rel);
  return rel;
}

function firstFile(): string | undefined {
  return Object.entries(project.files).sort((a, b) => b[1].updatedAt - a[1].updatedAt)[0]?.[0];
}

function rewriteRefs(map: (p: string) => string | undefined) {
  for (const [path, f] of Object.entries(project.files)) {
    let changed = false;
    for (const n of f.doc.nodes) {
      const m = n.ref?.diagram ? map(n.ref.diagram) : undefined;
      if (m && m !== n.ref!.diagram) {
        n.ref = { ...n.ref!, diagram: m };
        changed = true;
      }
    }
    if (changed) {
      f.doc = { ...f.doc };
      if (path === current) {
        rev++;
        emit("doc", { rev, doc: f.doc, source: "file", file: current });
      }
    }
  }
}

function trash(path: string, files: Record<string, StoredFile>) {
  project.trash = [{ at: Date.now(), path, files }, ...project.trash].slice(0, 30);
}

async function loadProject(id: string) {
  const v = await kvGet<LocalProject>(`project:${id}`);
  if (!v) throw new HttpError(404, "projeto não encontrado");
  project = v;
  meta.active = id;
  await kvSet("meta", meta);
  const last = project.lastOpened && project.files[project.lastOpened] ? project.lastOpened : firstFile();
  current = "";
  if (last) openFile(last);
  else createDiagram("Novo diagrama");
}

function newProject(name: string, seed?: Doc): LocalProject {
  const id = `${slug(name) || "projeto"}-${Math.random().toString(36).slice(2, 6)}`;
  const v: LocalProject = { id, name, createdAt: Date.now(), files: {}, folders: [], trash: [] };
  const d = seed ?? emptyDoc("Novo diagrama");
  v.files[`${slug(d.title) || "diagrama"}${EXT}`] = { doc: d, updatedAt: Date.now() };
  return v;
}

/* ───────── pacote de exportação/importação ───────── */

export interface ProjectBundle {
  format: typeof BUNDLE | typeof BUNDLE_LEGACY;
  name: string;
  folders: string[];
  files: Record<string, Doc>;
}
export function exportBundle(): ProjectBundle {
  return { format: BUNDLE, name: project.name, folders: project.folders, files: Object.fromEntries(Object.entries(project.files).map(([p, f]) => [p, f.doc])) };
}
export const bundleName = () => project.name;

/* ───────── roteador (imita o bridge) ───────── */

async function route(path: string, method: string, q: URLSearchParams, b: any): Promise<unknown> {
  if (path === "/api/health") return { ok: true, rev, title: project.files[current]?.doc.title };
  if (path === "/api/doc" && method === "GET") return { rev, doc: fileOrThrow(current).doc, file: current, pristine: false };
  if (path === "/api/doc" && method === "PUT") {
    if (b.file && b.file !== current) throw new HttpError(409, `o diagrama ativo agora é ${current}`);
    const f = fileOrThrow(current);
    f.doc = normalizeDoc(b.doc);
    f.updatedAt = Date.now();
    rev++;
    persist();
    sendWorkspace();
    return { rev };
  }
  if (path === "/api/workspace" && method === "GET") return workspaceInfo();

  /* projetos */
  if (path === "/api/projects/create") {
    const name = String(b.name ?? "").trim();
    if (!name) throw new HttpError(400, "nome de projeto inválido");
    if (meta.projects.some((v) => v.name.toLowerCase() === name.toLowerCase())) throw new HttpError(409, "já existe um projeto com esse nome");
    await flush();
    const v = newProject(name);
    meta.projects.push({ id: v.id, name });
    await kvSet(`project:${v.id}`, v);
    await loadProject(v.id);
    return workspaceInfo();
  }
  if (path === "/api/projects/switch") {
    await flush();
    await loadProject(String(b.id));
    return workspaceInfo();
  }
  if (path === "/api/projects/remove") {
    // no modo navegador, "remover" apaga os dados do projeto
    if (b.id === project.id) throw new HttpError(400, "abra outro projeto antes de excluir este");
    meta.projects = meta.projects.filter((v) => v.id !== b.id);
    await kvDel(`project:${b.id}`);
    await kvSet("meta", meta);
    return workspaceInfo();
  }
  if (path === "/api/projects/import") {
    const bundle = b.bundle as ProjectBundle;
    if (!bundle || (bundle.format !== BUNDLE && bundle.format !== BUNDLE_LEGACY) || typeof bundle.files !== "object") throw new HttpError(400, "arquivo de projeto inválido");
    await flush();
    let name = String(bundle.name || "Projeto importado");
    while (meta.projects.some((v) => v.name.toLowerCase() === name.toLowerCase())) name += " (importado)";
    const v: LocalProject = { id: `${slug(name)}-${Math.random().toString(36).slice(2, 6)}`, name, createdAt: Date.now(), files: {}, folders: [...(bundle.folders ?? [])], trash: [] };
    for (const [p, d] of Object.entries(bundle.files)) {
      if (!p.endsWith(EXT)) continue;
      segments(p);
      v.files[p] = { doc: normalizeDoc(d), updatedAt: Date.now() };
    }
    if (!Object.keys(v.files).length) throw new HttpError(400, "o arquivo não contém diagramas");
    meta.projects.push({ id: v.id, name });
    await kvSet(`project:${v.id}`, v);
    await loadProject(v.id);
    return workspaceInfo();
  }
  if (path === "/api/projects/open" || path.startsWith("/api/fs/")) throw new HttpError(400, "Indisponível no modo navegador: não há acesso a pastas do disco. Rode `npm run dev` para usar projetos em disco.");
  if (path === "/api/skills/install") throw new HttpError(400, "Indisponível no modo navegador: não há acesso a disco para rodar o npx skills add. Rode `npm run dev` para instalar skills de verdade.");

  /* diagramas */
  if (path === "/api/diagrams" && method === "POST") {
    if (b.mode != null && b.mode !== "architecture" && b.mode !== "domain" && b.mode !== "logic" && b.mode !== "agents") throw new HttpError(400, `mode inválido "${b.mode}". Válidos: architecture, domain, logic, agents`);
    const rel = createDiagram(String(b.title || "Novo diagrama"), String(b.folder ?? ""), b.mode === "domain" || b.mode === "logic" || b.mode === "agents" ? b.mode : "architecture", b.blank === true);
    return { name: rel, ...workspaceInfo() };
  }
  if (path === "/api/project/docs" && method === "GET") return { files: Object.entries(project.files).map(([p, f]) => ({ path: p, doc: f.doc })) };
  if (path === "/api/diagrams/open") {
    fileOrThrow(b.name);
    openFile(b.name);
    return workspaceInfo();
  }
  if (path === "/api/diagrams/read" && method === "GET") {
    const name = q.get("name") ?? "";
    return { name, doc: fileOrThrow(name).doc };
  }
  if (path === "/api/diagrams/outline" && method === "GET") {
    const name = q.get("name") ?? "";
    const d = fileOrThrow(name).doc;
    return {
      name,
      title: d.title,
      description: d.description,
      groups: d.groups.map((g) => ({ id: g.id, label: g.label, kind: g.kind })),
      nodes: d.nodes.map((n) => ({ id: n.id, label: n.label, kind: n.kind, technology: n.technology, owner: n.owner, endpoint: n.endpoint })),
      connections: d.connections.length,
    };
  }
  if (path === "/api/diagrams/rename") {
    const title = String(b.title || "").trim();
    if (!title) throw new HttpError(400, "título vazio");
    const old = diagramKey(b.name);
    const f = fileOrThrow(old);
    const next = uniqueFile(title, parentOf(old), old);
    f.doc = { ...f.doc, title };
    f.updatedAt = Date.now();
    if (next !== old) {
      delete project.files[old];
      project.files[next] = f;
      rewriteRefs((p) => (p === old ? next : undefined));
    }
    if (old === current) {
      current = next;
      project.lastOpened = next;
      rev++;
      emit("doc", { rev, doc: f.doc, source: b.source ?? "file", file: current });
    }
    persist();
    sendWorkspace();
    return { name: next, ...workspaceInfo() };
  }
  if (path === "/api/diagrams/duplicate") {
    const src = fileOrThrow(b.name);
    const title = `${src.doc.title} (cópia)`;
    const rel = uniqueFile(title, parentOf(diagramKey(b.name)));
    project.files[rel] = { doc: { ...structuredClone(src.doc), id: "diagram-" + Math.random().toString(36).slice(2, 8), title }, updatedAt: Date.now() };
    openFile(rel);
    return { name: rel, ...workspaceInfo() };
  }
  if (path === "/api/diagrams/move") {
    const old = diagramKey(b.name);
    const f = fileOrThrow(old);
    const folder = String(b.folder ?? "");
    segments(folder, true);
    if (parentOf(old) === folder) return workspaceInfo();
    if (folder && !project.folders.includes(folder)) project.folders.push(folder);
    const next = uniqueFile(f.doc.title, folder);
    delete project.files[old];
    project.files[next] = f;
    if (old === current) {
      current = next;
      project.lastOpened = next;
    }
    rewriteRefs((p) => (p === old ? next : undefined));
    persist();
    sendWorkspace();
    return { name: next, ...workspaceInfo() };
  }
  if (path === "/api/diagrams/delete") {
    const old = diagramKey(b.name);
    trash(old, { [old]: fileOrThrow(old) });
    delete project.files[old];
    if (old === current) {
      const next = firstFile();
      if (next) openFile(next);
      else createDiagram("Novo diagrama");
    } else {
      persist();
      sendWorkspace();
    }
    return workspaceInfo();
  }

  /* pastas */
  if (path === "/api/folders") {
    const parts = segments(b.path);
    for (let i = 1; i <= parts.length; i++) {
      const p = parts.slice(0, i).join("/");
      if (!project.folders.includes(p)) project.folders.push(p);
    }
    persist();
    sendWorkspace();
    return workspaceInfo();
  }
  if (path === "/api/folders/rename") {
    const name = String(b.name ?? "").trim();
    segments(name);
    if (name.includes("/")) throw new HttpError(400, "nome inválido");
    segments(b.path);
    const to = relOf(parentOf(b.path), name);
    if (project.folders.includes(to)) throw new HttpError(409, "já existe uma pasta com esse nome");
    const re = (p: string) => (p === b.path ? to : p.startsWith(b.path + "/") ? to + p.slice(b.path.length) : p);
    project.folders = project.folders.map(re);
    project.files = Object.fromEntries(Object.entries(project.files).map(([p, f]) => [re(p), f]));
    current = re(current);
    project.lastOpened = project.lastOpened ? re(project.lastOpened) : undefined;
    rewriteRefs((p) => (re(p) !== p ? re(p) : undefined));
    persist();
    sendWorkspace();
    return workspaceInfo();
  }
  if (path === "/api/folders/delete") {
    segments(b.path);
    const inside = (p: string) => p === b.path || p.startsWith(b.path + "/");
    const removed: Record<string, StoredFile> = {};
    for (const [p, f] of Object.entries(project.files)) if (inside(p)) removed[p] = f;
    trash(b.path, removed);
    for (const p of Object.keys(removed)) delete project.files[p];
    project.folders = project.folders.filter((p) => !inside(p));
    if (inside(current)) {
      const next = firstFile();
      if (next) openFile(next);
      else createDiagram("Novo diagrama");
    } else {
      persist();
      sendWorkspace();
    }
    return workspaceInfo();
  }
  throw new HttpError(404, "rota não disponível no modo navegador");
}

const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** Substitui `fetch` para as rotas `/api/...` quando não há servidor local. */
export async function localFetch(input: string, init?: RequestInit): Promise<Response> {
  try {
    const url = new URL(input, "http://local");
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    return reply(await route(url.pathname, (init?.method ?? "GET").toUpperCase(), url.searchParams, body));
  } catch (e) {
    return reply({ error: e instanceof Error ? e.message : String(e) }, e instanceof HttpError ? e.status : 500);
  }
}

/**
 * Quando «projeto» se chamava «cofre», o IndexedDB guardava `meta.vaults` e as chaves `vault:<id>`.
 * Copia tudo para os nomes novos (os dados antigos ficam onde estão, caso a pessoa volte a uma versão anterior).
 */
async function migrateVaults(): Promise<Meta | undefined> {
  const old = await kvGet<{ vaults?: { id: string; name: string }[]; active?: string }>("meta");
  if (!old?.vaults?.length || (old as Meta).projects?.length) return undefined;
  for (const v of old.vaults) {
    const data = await kvGet<LocalProject>(`vault:${v.id}`);
    if (data) await kvSet(`project:${v.id}`, data);
  }
  const next: Meta = { projects: old.vaults, active: old.active ?? old.vaults[0].id };
  await kvSet("meta", next);
  return next;
}

/**
 * Carrega (ou cria) os projetos do navegador. Na primeira vez, o rascunho atual do app
 * (exemplo ou o último diagrama salvo no navegador) vira o primeiro diagrama do projeto.
 */
export async function initLocal(onEmit: LocalEmit, seed: Doc) {
  emit = onEmit;
  const saved = (await migrateVaults()) ?? (await kvGet<Meta>("meta"));
  if (saved?.projects.length) {
    meta = saved;
    await loadProject(meta.projects.find((v) => v.id === meta.active)?.id ?? meta.projects[0].id);
    return;
  }
  const v = newProject("Projeto do navegador", seed);
  meta = { projects: [{ id: v.id, name: v.name }], active: v.id };
  await kvSet(`project:${v.id}`, v);
  await kvSet("meta", meta);
  await loadProject(v.id);
}
