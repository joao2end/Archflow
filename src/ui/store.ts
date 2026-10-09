import { useSyncExternalStore } from "react";
import { applyOps, allAssets, fitGroup, normalizeDoc, uniqueId, type Op, type OpResult } from "../shared/ops";
import { emptyDoc, type Asset, type ConnectionType, type Doc } from "../shared/schema";

export type Theme = "system" | "light" | "dark";
export type Tool = "select" | "hand" | "group" | "note" | "connect" | "pen" | "highlight" | "eraser" | "text" | "list";
export type Modal =
  | { type: "asset"; id?: string }
  | { type: "interface"; id: string }
  | { type: "llm" }
  | { type: "mcp" }
  | { type: "help" }
  | { type: "vaults" }
  | { type: "quick" }
  | { type: "diagram-view"; diagram: string; node?: string }
  | { type: "folder"; purpose: "open" | "create"; name?: string }
  | null;

export interface FileNode {
  type: "file";
  name: string;
  path: string;
  title: string;
  updatedAt: number;
  size: number;
  nodes: number;
  connections: number;
  refs: string[];
}
export interface FolderNode {
  type: "folder";
  name: string;
  path: string;
  children: (FolderNode | FileNode)[];
}
export interface VaultInfo {
  id: string;
  name: string;
  path: string;
  exists?: boolean;
}
export interface Workspace {
  vault: VaultInfo;
  configured: boolean;
  vaults: VaultInfo[];
  current: string;
  tree: FolderNode;
  files: FileNode[];
}

export interface View {
  x: number;
  y: number;
  z: number;
}

export type BgPattern = "dots" | "grid" | "lines" | "none";
export interface Background {
  pattern: BgPattern;
  /** cor sólida do papel; undefined = padrão do tema */
  color?: string;
  /** `preset:<id>` (modelo pronto) ou data URL de uma imagem enviada */
  image?: string;
  /** opacidade da imagem, 0–1 (padrão 1) */
  imageOpacity?: number;
}
export const DEFAULT_BG: Background = { pattern: "dots" };

interface Prefs {
  animate?: boolean;
  snap?: boolean;
  theme?: Theme;
  bg?: Background;
}

export interface State {
  doc: Doc;
  docSource: "local" | "remote";
  sel: string[];
  tool: Tool;
  view: View;
  connType: ConnectionType;
  panel: "assets" | "files" | "bg" | null;
  expanded: Record<string, boolean>;
  modal: Modal;
  theme: Theme;
  animate: boolean;
  snap: boolean;
  /** fundo do quadro (preferência local) */
  bg: Background;
  /** cor da caneta / marca-texto */
  inkColor: string;
  /** espessura (px de tela) e opacidade por ferramenta de tinta */
  inkCfg: Record<"pen" | "highlight", { width: number; opacity: number }>;
  inkDash: "solid" | "dashed" | "dotted";
  /** borracha: "ink" apaga só desenhos à mão livre; "all" apaga também componentes, textos, notas e conexões */
  eraseMode: "ink" | "all";
  /** backend de armazenamento ativo: servidor local (disco) ou memória do navegador */
  storage: "server" | "local" | null;
  online: boolean;
  workspace: Workspace | null;
  file: string | null;
  library: Asset[];
  past: Doc[];
  future: Doc[];
  focusTick: number;
  /** pilha de diagramas de onde o usuário "entrou" por uma referência (botão Voltar) */
  navBack: string[];
  toast: string | null;
  /** modo apresentação: tela limpa com desenho, laser e cronômetro */
  present: boolean;
}

const LS_DOC = "archflow.doc.v1";
const LS_LIB = "archflow.library.v1";
const LS_PREFS = "archflow.prefs.v1";
const LS_TREE = "archflow.tree.v1";
const LS_WELCOME = "archflow.welcome.v1";

function read<T>(key: string): T | undefined {
  try {
    const s = localStorage.getItem(key);
    return s ? (JSON.parse(s) as T) : undefined;
  } catch {
    return undefined;
  }
}
function write(key: string, v: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* quota / modo privado */
  }
}

export function sampleDoc(): Doc {
  const base = emptyDoc("Plataforma de Pedidos");
  base.description = "Exemplo: e-commerce com API Laravel, fila de eventos e IA para recomendações. Peça ao seu agente (via MCP) para evoluir este diagrama.";
  const ops: Op[] = [
    { op: "add_node", id: "customer", asset: "user", label: "Cliente" },
    { op: "add_node", id: "storefront", asset: "nextjs", label: "Loja Web", description: "Catálogo, carrinho e checkout (SSR)." },
    { op: "add_group", id: "aws", label: "AWS · sa-east-1", kind: "cloud" },
    { op: "add_group", id: "backend", label: "Orders Context", kind: "context", parent: "aws", description: "Bounded context de pedidos." },
    { op: "add_node", id: "api-gw", asset: "aws-api-gateway", label: "API Gateway", parent: "aws" },
    { op: "add_node", id: "orders-api", asset: "laravel", label: "Orders API", technology: "Laravel 11 / PHP 8.3", description: "Cria e consulta pedidos; publica eventos de domínio.", parent: "backend" },
    { op: "add_node", id: "orders-db", asset: "postgresql", label: "Orders DB", parent: "backend", props: { engine: "PostgreSQL 16", sla: "99.95%" } },
    { op: "add_node", id: "events", asset: "aws-sqs", label: "order-events", parent: "aws" },
    { op: "add_node", id: "recommender", asset: "anthropic-claude", label: "Recomendações", description: "Gera sugestões a partir do histórico do pedido.", parent: "aws" },
    { op: "add_node", id: "payments", asset: "stripe", label: "Stripe" },
    {
      op: "add_connection", from: "customer", to: "storefront", type: "sync", protocol: "HTTPS", label: "navega",
    },
    {
      op: "add_connection", from: "storefront", to: "api-gw", type: "sync", protocol: "HTTPS/REST", label: "POST /orders",
      interface: { name: "Orders API v1", kind: "rest", contract: "openapi: ./openapi/orders.yaml", operations: [{ name: "createOrder", method: "POST", path: "/orders", request: "{ items: [{sku, qty}], customerId }", response: "201 { orderId, status }" }, { name: "getOrder", method: "GET", path: "/orders/{id}", response: "200 Order" }] },
    },
    { op: "add_connection", from: "api-gw", to: "orders-api", type: "sync", protocol: "HTTP", label: "proxy" },
    { op: "add_connection", from: "orders-api", to: "orders-db", type: "data", protocol: "TCP/5432", label: "SQL" },
    { op: "add_connection", from: "orders-api", to: "events", type: "async", label: "OrderCreated", protocol: "SQS", interface: { name: "order.created", kind: "event", operations: [{ name: "OrderCreated", method: "PUBLISH", path: "order-events", request: "{ orderId, total, items[] }" }] } },
    { op: "add_connection", from: "events", to: "recommender", type: "stream", label: "consome" },
    { op: "add_connection", from: "orders-api", to: "payments", type: "sync", protocol: "HTTPS", label: "cobra" },
    { op: "layout", direction: "LR" },
    { op: "add_note", text: "Decisão: eventos via SQS (simples) em vez de Kafka até > 5k msg/s.", x: 280, y: 330 },
  ];
  return applyOps(base, ops).doc;
}

function init(): State {
  const prefs = read<Prefs>(LS_PREFS) ?? {};
  const saved = read<Doc>(LS_DOC);
  return {
    doc: saved ? normalizeDoc(saved) : sampleDoc(),
    docSource: "local",
    sel: [],
    tool: "select",
    view: { x: 120, y: 120, z: 1 },
    connType: "sync",
    panel: "assets",
    expanded: read<Record<string, boolean>>(LS_TREE) ?? {},
    modal: null,
    theme: prefs.theme ?? "system",
    animate: prefs.animate ?? true,
    snap: prefs.snap ?? true,
    bg: { ...DEFAULT_BG, ...prefs.bg },
    inkColor: "#e5484d",
    inkCfg: { pen: { width: 4, opacity: 1 }, highlight: { width: 22, opacity: 0.38 } },
    inkDash: "solid",
    eraseMode: "all",
    storage: null,
    online: false,
    workspace: null,
    file: null,
    library: read<Asset[]>(LS_LIB) ?? [],
    past: [],
    future: [],
    focusTick: 0,
    navBack: [],
    toast: null,
    present: false,
  };
}

let state: State = init();
const listeners = new Set<() => void>();
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};
export const getState = () => state;
export function set(patch: Partial<State>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}
export function useStore<T>(sel: (s: State) => T): T {
  return useSyncExternalStore(subscribe, () => sel(state));
}

/* ───────── documento + histórico ───────── */

const HISTORY_MAX = 100;
let txBase: Doc | null = null;

/** Altera o documento criando um ponto de desfazer. */
export function commit(doc: Doc, source: State["docSource"] = "local") {
  if (doc === state.doc) return;
  set({ doc, docSource: source, past: [...state.past, state.doc].slice(-HISTORY_MAX), future: [] });
}
/** Atualização "ao vivo" (arrastar) — sem histórico até endTx. */
export function beginTx() {
  txBase = state.doc;
}
export function live(doc: Doc) {
  set({ doc, docSource: "local" });
}
export function endTx() {
  if (txBase && txBase !== state.doc) set({ past: [...state.past, txBase].slice(-HISTORY_MAX), future: [] });
  txBase = null;
}
export function undo() {
  const p = state.past;
  if (!p.length) return;
  set({ doc: p[p.length - 1], docSource: "local", past: p.slice(0, -1), future: [state.doc, ...state.future], sel: [] });
}
export function redo() {
  const [f, ...rest] = state.future;
  if (!f) return;
  set({ doc: f, docSource: "local", past: [...state.past, state.doc], future: rest, sel: [] });
}

export function run(ops: Op[]): OpResult[] {
  const { doc, results } = applyOps(state.doc, ops);
  commit(doc);
  return results;
}

export function replaceDoc(doc: Doc) {
  commit(normalizeDoc(doc));
  set({ sel: [] });
}

export function select(ids: string[]) {
  set({ sel: ids });
}

export function toast(msg: string) {
  set({ toast: msg });
  setTimeout(() => state.toast === msg && set({ toast: null }), 2600);
}

export function allKnownAssets(): Asset[] {
  const lib = new Map(state.library.map((a) => [a.id, a]));
  const fromDoc = allAssets(state.doc).filter((a) => !a.builtin);
  fromDoc.forEach((a) => !lib.has(a.id) && lib.set(a.id, a));
  const builtin = allAssets({ ...state.doc, customAssets: [] });
  return [...lib.values(), ...builtin];
}

export function lookupAsset(id?: string): Asset | undefined {
  if (!id) return undefined;
  return state.doc.customAssets.find((a) => a.id === id) ?? state.library.find((a) => a.id === id) ?? allAssets({ ...state.doc, customAssets: [] }).find((a) => a.id === id);
}

/** Cadastra/atualiza asset na biblioteca do usuário (e no doc, para ser portátil). */
export function saveAsset(a: Asset) {
  const library = [...state.library.filter((x) => x.id !== a.id), a];
  write(LS_LIB, library);
  const doc = { ...state.doc, customAssets: [...state.doc.customAssets.filter((x) => x.id !== a.id), a] };
  set({ library });
  commit(doc);
}
export function deleteAsset(id: string) {
  const library = state.library.filter((x) => x.id !== id);
  write(LS_LIB, library);
  set({ library });
}
export function newAssetId(name: string) {
  return uniqueId(state.doc, name);
}

/** `owner`: ao soltar um endpoint sobre um serviço, ele passa a pertencer a esse serviço. */
export function placeAsset(assetId: string, x: number, y: number, parent?: string, owner?: string) {
  const [r] = run([owner ? { op: "add_node", asset: assetId, owner } : { op: "add_node", asset: assetId, x, y, parent }]);
  if (r.ok && r.id) {
    set({ sel: [r.id] });
    if (parent) {
      const d = structuredClone(state.doc);
      fitGroup(d, parent);
      commit(d);
    }
  }
}

export function setPrefs(p: Prefs) {
  set(p);
  write(LS_PREFS, { animate: state.animate, snap: state.snap, theme: state.theme, bg: state.bg });
  if (p.theme) applyTheme();
}

/* ───────── tema ───────── */

const dark = typeof matchMedia === "function" ? matchMedia("(prefers-color-scheme: dark)") : null;
export const resolvedTheme = (t: Theme = state.theme) => (t === "system" ? (dark?.matches ? "dark" : "light") : t);
export function applyTheme() {
  const r = resolvedTheme();
  document.documentElement.dataset.theme = r;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", r === "dark" ? "#2d2a2e" : "#f7f1e3");
}
dark?.addEventListener("change", () => state.theme === "system" && applyTheme());
export function cycleTheme() {
  const next: Theme = state.theme === "system" ? "light" : state.theme === "light" ? "dark" : "system";
  setPrefs({ theme: next });
  toast(next === "system" ? "Tema: automático (segue o sistema)" : next === "dark" ? "Tema escuro" : "Tema claro");
}

/* ───────── persistência local + sincronização com o bridge (MCP) ───────── */

const clientId = "ui-" + Math.random().toString(36).slice(2, 8);
let bridgeRev = 0;
let pushTimer: ReturnType<typeof setTimeout> | undefined;
let lastDoc = state.doc;
let saveTimer: ReturnType<typeof setTimeout> | undefined;


function adoptRemote(doc: Doc, rev: number, source: string, file?: string) {
  bridgeRev = rev;
  const d = normalizeDoc(doc);
  if (file) state = { ...state, file };
  if (d.id !== state.doc.id) {
    // outro diagrama (abrir/novo): histórico e seleção não se aplicam
    set({ doc: d, docSource: "remote", sel: [], past: [], future: [] });
    window.dispatchEvent(new Event("archflow:fit"));
    return;
  }
  const ids = new Set([...d.nodes, ...d.groups, ...d.notes, ...d.connections].map((e) => e.id));
  state = { ...state, sel: state.sel.filter((s) => ids.has(s)) };
  commit(d, "remote");
  if (source === "mcp") toast("Diagrama atualizado pelo agente (MCP) — Ctrl+Z desfaz");
}

/** `fetch` das rotas /api: servidor local quando disponível; senão, o backend em memória do navegador. */
let localMod: typeof import("./localVault") | null = null;
const apiFetch = (path: string, init?: RequestInit) => (state.storage === "local" && localMod ? localMod.localFetch(path, init) : fetch(path, init));

async function pushNow() {
  try {
    const r = await apiFetch("/api/doc", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ doc: state.doc, file: state.file, source: clientId }) });
    if (r.ok) {
      bridgeRev = (await r.json()).rev;
      if (!state.online) set({ online: true });
    } else if (r.status === 409) {
      await loadFromBridge(); // o diagrama ativo mudou em outro lugar
    }
  } catch {
    set({ online: false });
  }
}

async function loadFromBridge() {
  const { rev, doc, file, pristine } = await (await apiFetch("/api/doc")).json();
  set({ online: true, file });
  if (pristine && state.doc.nodes.length) await pushNow(); // pasta nova: semeia com o rascunho local
  else adoptRemote(doc, rev, "file", file);
}

/* ───────── gerenciamento de arquivos (pasta de trabalho) ───────── */

async function call<T = any>(path: string, body?: unknown, method = body === undefined ? "GET" : "POST"): Promise<T> {
  const r = await apiFetch(path, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error ?? `erro ${r.status}`);
  return j as T;
}
const guard = async <T>(fn: () => Promise<T>): Promise<T | undefined> => {
  try {
    return await fn();
  } catch (e) {
    toast(e instanceof Error ? e.message : String(e));
  }
};
const flushPush = async () => {
  clearTimeout(pushTimer);
  if (state.online && state.docSource === "local") await pushNow();
};

export const fsList = (path?: string) => call<{ path: string; parent: string | null; home: string; dirs: { name: string; path: string; archflow: number; vault: boolean }[]; files?: number; vault?: boolean }>("/api/fs/list" + (path ? `?path=${encodeURIComponent(path)}` : ""));
export const fsMkdir = (path: string) => call("/api/fs/mkdir", { path });

const reload = async (path: string, body: unknown) => {
  await flushPush();
  return call(path, body);
};
export const openDiagram = (name: string) =>
  guard(async () => {
    set({ navBack: [] });
    return reload("/api/diagrams/open", { name });
  });

/** Abre o diagrama referenciado por um componente, guardando o atual para "Voltar". */
export const openRef = (name: string) =>
  guard(async () => {
    const from = state.file;
    if (!from || from === name) return;
    set({ navBack: [...state.navBack, from].slice(-20) });
    return reload("/api/diagrams/open", { name });
  });
export const goBack = () =>
  guard(async () => {
    const stack = state.navBack;
    const prev = stack[stack.length - 1];
    if (!prev) return;
    set({ navBack: stack.slice(0, -1) });
    return reload("/api/diagrams/open", { name: prev });
  });

/** Lê o diagrama completo de outro arquivo do cofre (para o visualizador em modal). */
export const fetchDiagram = (name: string) => call<{ name: string; doc: Doc }>(`/api/diagrams/read?name=${encodeURIComponent(name)}`);
export const openViewer = (diagram: string, node?: string) => set({ modal: { type: "diagram-view", diagram, node } });

export interface Outline {
  name: string;
  title: string;
  description?: string;
  groups: { id: string; label: string; kind: string }[];
  nodes: { id: string; label: string; kind: string; technology?: string; owner?: string; endpoint?: { protocol: string; method?: string; path?: string } }[];
  connections: number;
}
export const fetchOutline = (name: string) => call<Outline>(`/api/diagrams/outline?name=${encodeURIComponent(name)}`);

/** Insere, no diagrama atual, um componente que referencia outro diagrama do cofre. */
export function addRefNode(diagram: string, title: string, x?: number, y?: number, node?: string) {
  if (diagram === state.file) return toast("Um diagrama não pode referenciar a si mesmo");
  const [r] = run([{ op: "add_node", asset: "diagram-ref", label: title, ref: { diagram, node }, x, y }]);
  if (r.ok && r.id) set({ sel: [r.id] });
}
export const newDiagram = (title: string, folder = "") => guard(() => reload("/api/diagrams", { title, folder }));
export const duplicateDiagram = (name: string) => guard(() => reload("/api/diagrams/duplicate", { name }));
export const renameDiagram = (name: string, title: string) => guard(() => reload("/api/diagrams/rename", { name, title }));
export const moveDiagram = (name: string, folder: string) => guard(() => reload("/api/diagrams/move", { name, folder }));
export const deleteDiagram = (name: string) => guard(async () => void (await call("/api/diagrams/delete", { name }), toast("Movido para a lixeira do cofre (.archflow/trash)")));
export const createFolder = (path: string) => guard(() => call("/api/folders", { path }));
export const renameFolder = (path: string, name: string) => guard(() => reload("/api/folders/rename", { path, name }));
export const deleteFolder = (path: string) => guard(async () => void (await call("/api/folders/delete", { path }), toast("Pasta movida para a lixeira do cofre")));

export const vaultCreate = (name: string, parent: string) =>
  guard(async () => {
    await flushPush();
    await call("/api/vaults/create", { name, parent });
    toast(`Cofre «${name}» criado`);
    return true;
  });
export const vaultOpen = (path: string) =>
  guard(async () => {
    await flushPush();
    await call("/api/vaults/open", { path });
    toast("Cofre aberto");
    return true;
  });
export const vaultSwitch = (id: string) =>
  guard(async () => {
    await flushPush();
    await call("/api/vaults/switch", { id });
    return true;
  });
export const vaultRemove = (id: string) => guard(() => call("/api/vaults/remove", { id }));

export function toggleFolder(path: string, force?: boolean) {
  const key = `${state.workspace?.vault.id ?? ""}:${path}`;
  const expanded = { ...state.expanded, [key]: force ?? !state.expanded[key] };
  set({ expanded });
  write(LS_TREE, expanded);
}
export const isExpanded = (path: string, ex = state.expanded) => !!ex[`${state.workspace?.vault.id ?? ""}:${path}`];

/** Título do diagrama: com bridge, renomeia o arquivo junto. */
export function setTitle(title: string) {
  const t = title.trim() || "Sem título";
  if (state.online && state.file) void renameDiagram(state.file, t);
  else run([{ op: "set_meta", title: t }]);
}

let started = false;
export function startSync() {
  if (started) return; // StrictMode/HMR chamam o efeito mais de uma vez
  started = true;
  subscribe(() => {
    if (state.doc === lastDoc) return;
    lastDoc = state.doc;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => write(LS_DOC, state.doc), 250);
    if (state.docSource === "local" && state.online) {
      clearTimeout(pushTimer);
      pushTimer = setTimeout(pushNow, 300);
    }
  });

  const onDoc = (m: { rev: number; doc: Doc; source: string; file: string }) => {
    if (m.source === clientId) {
      bridgeRev = Math.max(bridgeRev, m.rev);
      return;
    }
    if (m.rev <= bridgeRev && m.doc.id === state.doc.id) return;
    adoptRemote(m.doc, m.rev, m.source, m.file);
  };
  const onWorkspace = (w: Workspace) => set(w.current ? { workspace: w, file: w.current } : { workspace: w });

  /** Sem servidor local: cofres guardados no IndexedDB deste navegador. */
  const goLocal = async () => {
    try {
      localMod = await import("./localVault");
      set({ storage: "local" });
      await localMod.initLocal((ev, data) => (ev === "doc" ? onDoc(data as never) : onWorkspace(data as Workspace)), state.doc);
      set({ workspace: await call<Workspace>("/api/workspace"), online: true });
      await loadFromBridge();
      if (!localMod.isPersistent()) toast("Este navegador bloqueou o armazenamento: os dados só duram enquanto a aba estiver aberta.");
    } catch (e) {
      set({ storage: null, online: false });
      toast("Não foi possível iniciar o armazenamento do navegador: " + (e instanceof Error ? e.message : e));
    }
  };

  let everConnected = false;
  const connect = async () => {
    if (state.storage === "local") return;
    try {
      const w = await call<Workspace>("/api/workspace");
      // hospedagem estática responde index.html (200) para /api/*: só vale se vier um workspace de verdade
      if (!w?.vault || !Array.isArray(w.files)) throw new Error("sem servidor local");
      everConnected = true;
      set({ workspace: w, storage: "server" });
      await loadFromBridge();
      if (!w.configured && !read<boolean>(LS_WELCOME)) {
        write(LS_WELCOME, true); // primeira execução: oferece criar/abrir um cofre (como o Obsidian)
        set({ modal: { type: "vaults" } });
      }
      const es = new EventSource("/api/events");
      es.addEventListener("doc", (ev) => onDoc(JSON.parse((ev as MessageEvent).data)));
      es.addEventListener("workspace", (ev) => onWorkspace(JSON.parse((ev as MessageEvent).data) as Workspace));
      es.addEventListener("hello", () => set({ online: true }));
      es.onerror = () => {
        set({ online: false });
        es.close();
        setTimeout(connect, 3000);
      };
    } catch {
      if (!everConnected) return void (await goLocal()); // nunca houve servidor nesta sessão → modo navegador
      set({ online: false });
      setTimeout(connect, 4000);
    }
  };
  connect();
}

/* ───────── cofre do navegador: backup (exportar/importar) ───────── */

export async function exportLocalVault() {
  if (state.storage !== "local" || !localMod) return;
  const bundle = localMod.exportBundle();
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" }));
  a.download = `${localMod.bundleName().replace(/[^\w\-]+/g, "_")}.archflow-vault.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
export const importLocalVault = (file: File) =>
  guard(async () => {
    const bundle = JSON.parse(await file.text());
    await flushPush();
    await call("/api/vaults/import", { bundle });
    toast("Cofre importado");
    return true;
  });
