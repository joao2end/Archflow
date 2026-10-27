import { useSyncExternalStore } from "react";
import type { FlowMode } from "./flow";
import { applyOps, allAssets, fitGroup, normalizeDoc, uniqueId, type Op, type OpResult } from "../shared/ops";
import { buildCatalog, type CatalogExample } from "../shared/examples.catalog";
import { runFlow, runPipeline, hasFlow, isFlowNode, starterExample, type Run } from "../shared/logic";
import { storyAt, storyOf, type StoryItem } from "../shared/logicdebug";
import { catalogEntryToSource, resolveSkillSource, type SkillCatalogEntry } from "../shared/skillcatalog";
import { generateHarness, type HarnessTarget } from "../shared/agentgen";
import { zip } from "../shared/zip";
import { mcpEntryToSpec, type McpCatalogEntry } from "../shared/mcpcatalog";
import { freeSpotBelow } from "../shared/placement";
import { workflowSteps } from "../shared/agents";
import { AGENT_RELS, NATIVE_TOOL_NAMES, emptyDoc, type AgentToolType, type Asset, type ConnectionType, type Doc, type DocMode, type GroupKind, type LogicNodeSpec, type NodeKind, type NoteFont, type Routing } from "../shared/schema";
/** Estilos padrão dos próximos elementos (padrão Excalidraw), persistidos em prefs. */
export interface ElementDefaults {
  nodeKind: NodeKind;
  fill?: string;
  fillOpacity?: number;
  groupKind: GroupKind;
  groupColor?: string;
  noteColor?: string;
  noteFont: NoteFont;
  connType: ConnectionType;
  connRouting: Routing;
}

export const DEFAULT_ELEMENT_DEFAULTS: ElementDefaults = {
  nodeKind: "service",
  groupKind: "boundary",
  noteFont: "sans",
  connType: "sync",
  connRouting: "curve",
};

const ARCH_KINDS = new Set<NodeKind>(["service", "client", "actor", "database", "cache", "queue", "gateway", "external", "ai", "infra", "library", "system"]);
const GROUP_KIND_SET = new Set<GroupKind>(["boundary", "layer", "cloud", "network", "context", "cluster", "team"]);
const FONT_SET = new Set<NoteFont>(["sans", "serif", "mono"]);
const ROUTING_SET = new Set<Routing>(["curve", "straight", "elbow"]);

function mergeDefaults(p?: Partial<ElementDefaults>): ElementDefaults {
  const base = { ...DEFAULT_ELEMENT_DEFAULTS, ...p };
  return {
    ...base,
    nodeKind: p?.nodeKind && ARCH_KINDS.has(p.nodeKind) ? p.nodeKind : DEFAULT_ELEMENT_DEFAULTS.nodeKind,
    groupKind: p?.groupKind && GROUP_KIND_SET.has(p.groupKind) ? p.groupKind : DEFAULT_ELEMENT_DEFAULTS.groupKind,
    noteFont: p?.noteFont && FONT_SET.has(p.noteFont) ? p.noteFont : "sans",
    connType: (p?.connType as ConnectionType) || "sync",
    connRouting: p?.connRouting && ROUTING_SET.has(p.connRouting) ? p.connRouting : "curve",
  };
}

export type Theme = "system" | "light" | "dark";

/** Reprodução de um exemplo de cenário: `k` é o passo atual do percurso (índice em `run.steps` com id). */
export interface Play {
  scenario: string;
  example: number;
  run: Run;
  k: number;
  playing: boolean;
  /** valores antes do passo atual ficam no próprio run; `given` mostra a entrada */
  given: Record<string, unknown>;
  /** explicar: anda por momentos (etapas, voltas, decisões) e conta em frases · depurar: passo a passo, com o porquê de cada um */
  mode: PlayMode;
  /** os momentos da execução (modo explicar) */
  story: StoryItem[];
}
export type PlayMode = "explain" | "debug";
/** O que o passo atual da apresentação destaca (ids de componentes e conexões). */
export interface Spotlight3D {
  /** componentes do passo atual (brilham) e os de apoio que entram junto */
  nodes: string[];
  extras: string[];
  /** já percorridos (meio apagados) */
  seenNodes: string[];
  /** conexões que levaram ao passo atual (animadas) e as já percorridas */
  conns: string[];
  seenConns: string[];
}
export type Tool = "select" | "hand" | "group" | "note" | "connect" | "pen" | "highlight" | "eraser" | "text" | "list";
/** Abas do modal do modo Logic. */
export type LogicTab = "overview" | "scenarios" | "issues" | "text" | "code";
export type Modal =
  | { type: "asset"; id?: string }
  | { type: "interface"; id: string }
  | { type: "llm" }
  | { type: "domain"; tab?: "issues" | "overview" | "code" }
  | { type: "logic"; tab?: LogicTab }
  | { type: "agents"; tab?: "issues" | "text" | "harness" }
  | { type: "skill"; id: string; tab?: "catalog" | "write" }
  | { type: "tool"; id: string; tab?: "search" | "paste" | "manual" }
  | { type: "ddd-guide" }
  | { type: "mcp" }
  | { type: "help" }
  | { type: "layout"; direction: "LR" | "TB" }
  | { type: "projects" }
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
  /** modo do diagrama (ausente = architecture) */
  mode?: DocMode;
}
export interface FolderNode {
  type: "folder";
  name: string;
  path: string;
  children: (FolderNode | FileNode)[];
}
export interface ProjectInfo {
  id: string;
  name: string;
  path: string;
  exists?: boolean;
}
export interface Workspace {
  project: ProjectInfo;
  configured: boolean;
  projects: ProjectInfo[];
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
  defaults?: Partial<ElementDefaults>;
  actionsHidden?: boolean;
}

export interface State {
  doc: Doc;
  docSource: "local" | "remote";
  sel: string[];
  tool: Tool;
  view: View;
  connType: ConnectionType;
  /** estilos padrão dos próximos elementos (e sincronizados com a seleção) */
  defaults: ElementDefaults;
  panel: "assets" | "files" | "styles" | null;
  /** modo escolhido no switch para filtrar o explorador; null = o do diagrama aberto. Nunca converte o arquivo. */
  modeFilter: DocMode | null;
  /** pedido para o explorador abrir a criação de um diagrama novo deste modo */
  newDiagramFor: DocMode | null;
  /** seção «Exemplos» do explorador: aberta ou não, e a aba (null = a do modo do explorador) */
  examples: { open: boolean; tab: DocMode | null };
  /** modo Logic: reprodução de um cenário (o caminho percorrido no fluxo, passo a passo) */
  play: Play | null;
  /** o debug completo da reprodução (linha do tempo, porquê e variáveis) aberto em tela cheia; sem ele, só a pílula de controles */
  playFull: boolean;
  /** velocidade da reprodução de cenários (1 = um passo a cada 0,85 s); lembrada entre sessões */
  playSpeed: number;
  /** modo da reprodução escolhido por último */
  playMode: PlayMode;
  expanded: Record<string, boolean>;
  modal: Modal;
  theme: Theme;
  animate: boolean;
  snap: boolean;
  /** barra de ações (canto superior direito) recolhida; lembrada entre sessões */
  actionsHidden: boolean;
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
  /** Skills instaladas com `npx skills add` a partir de uma URL. Valem para todos os diagramas deste navegador. */
  skillCatalog: SkillCatalogEntry[];
  past: Doc[];
  future: Doc[];
  focusTick: number;
  /** inspeção de fluxo: mostra só o subgrafo ligado a um componente (efêmero, não é salvo) */
  focus: { id: string; mode: FlowMode } | null;
  /** pilha de diagramas de onde o usuário "entrou" por uma referência (botão Voltar) */
  navBack: string[];
  toast: string | null;
  toastUndo: boolean; // o aviso oferece o botão «Desfazer»
  toastError: boolean; // aviso de erro: destaque visual, anunciado na hora e fica mais tempo
  /** modo apresentação: tela limpa com desenho, laser e cronômetro */
  present: boolean;
  /** visão isométrica 3D do layout "camadas" (modo domain) */
  iso: boolean;
  /** passo atual do passo a passo da apresentação (modo domain), para a visão 3D destacar e animar como o 2D */
  spotlight: Spotlight3D | null;
  /** painel da aula de DDD aberto (quando o diagrama aberto é uma aula) */
  lessonOpen: boolean;
  /** tutorial interativo em andamento (o passo atual); só aparece no diagrama do tutorial */
  tour: { step: number } | null;
  /** painel do terminal do Claude Code (modo agents) */
  termOpen: boolean;
  /** o bridge tem terminal? (undefined = ainda não sabemos); o botão da barra preenche */
  termAvail?: boolean;
  /** pedido de «rodar no terminal»: o painel abre uma sessão do claude com o texto já digitado (sem Enter) */
  termRequest: { n: number; prefill: string; title: string; target: "new" | "active" } | null;
  /** pedido para executar um nó prompt/workflow do diagrama: o painel do terminal abre o formulário dele */
  runNodeRequest: { n: number; id: string } | null;
}

const LS_DOC = "archflow.doc.v1";
const LS_LIB = "archflow.library.v1";
const LS_SKILLS = "archflow.skillcatalog.v1";
const LS_PREFS = "archflow.prefs.v1";
const LS_PLAY_SPEED = "archflow.play-speed.v1";
const LS_PLAY_MODE = "archflow.play-mode.v1";
/** Velocidades oferecidas na reprodução (múltiplos de 1x). */
export const PLAY_SPEEDS = [0.5, 1, 2, 4, 8];
/** 1x: tempo para ler o porquê de um passo; os saltos (mudança, volta) cobrem quem quer ir mais rápido */
export const PLAY_STEP_MS = 2500;
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

function readCatalog(): SkillCatalogEntry[] {
  const raw = read<unknown>(LS_SKILLS);
  if (!Array.isArray(raw)) return [];
  return raw.filter((e): e is SkillCatalogEntry => {
    if (!e || typeof e !== "object") return false;
    const s = e as SkillCatalogEntry;
    return typeof s.id === "string" && typeof s.name === "string" && typeof s.repo === "string" && typeof s.skillPath === "string" && typeof s.description === "string";
  });
}

/** Grava skills instaladas no catálogo local (substitui a mesma fonte, se já existir). */
export function saveCatalogSkills(entries: SkillCatalogEntry[]) {
  let catalog = state.skillCatalog;
  for (const e of entries) catalog = [...catalog.filter((x) => x.repo !== e.repo || x.skillPath !== e.skillPath), e];
  write(LS_SKILLS, catalog);
  set({ skillCatalog: catalog });
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
  const defaults = mergeDefaults(prefs.defaults);
  return {
    doc: saved ? normalizeDoc(saved) : sampleDoc(),
    docSource: "local",
    sel: [],
    tool: "select",
    view: { x: 120, y: 120, z: 1 },
    connType: defaults.connType,
    defaults,
    panel: null,
    modeFilter: null,
    newDiagramFor: null,
    examples: { open: false, tab: null },
    play: null,
    playFull: false,
    playSpeed: PLAY_SPEEDS.includes(read<number>(LS_PLAY_SPEED) ?? 0) ? read<number>(LS_PLAY_SPEED)! : 1,
    playMode: read<PlayMode>(LS_PLAY_MODE) === "debug" ? "debug" : "explain",
    expanded: read<Record<string, boolean>>(LS_TREE) ?? {},
    modal: null,
    theme: prefs.theme ?? "system",
    animate: prefs.animate ?? true,
    snap: prefs.snap ?? true,
    actionsHidden: prefs.actionsHidden ?? false,
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
    skillCatalog: readCatalog(),
    past: [],
    future: [],
    focusTick: 0,
    focus: null,
    navBack: [],
    toast: null,
    toastUndo: false,
    toastError: false,
    present: false,
    iso: false,
    spotlight: null,
    lessonOpen: true,
    tour: null,
    termOpen: false,
    termRequest: null,
    runNodeRequest: null,
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
  // durante a digitação num campo, todas as teclas viram UM único ponto de desfazer
  if (typing && typingPushed) return set({ doc, docSource: source, future: [] });
  if (typing) typingPushed = true;
  set({ doc, docSource: source, past: [...state.past, state.doc].slice(-HISTORY_MAX), future: [] });
}
let typing = false;
let typingPushed = false;
/** Abre/fecha uma sessão de digitação: as alterações feitas entre as duas compartilham um só ponto de desfazer. */
export function beginTyping() {
  typing = true;
  typingPushed = false;
}
export function endTyping() {
  typing = false;
  typingPushed = false;
}
/** Atualização "ao vivo" (arrastar) — sem histórico até endTx. */
export function beginTx() {
  txBase = state.doc;
}
export function live(doc: Doc) {
  // digitação numa nota: a primeira tecla da sessão abre o ponto de desfazer, as demais só atualizam
  if (typing && !typingPushed && !txBase && doc !== state.doc) {
    typingPushed = true;
    return set({ doc, docSource: "local", past: [...state.past, state.doc].slice(-HISTORY_MAX), future: [] });
  }
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

/**
 * Troca o id de um componente (e as conexões que o citam) por um slug livre derivado de `wanted`.
 * O harness usa o id como nome do arquivo e do `name:` da skill, então ele precisa acompanhar o nome real.
 */
export function renameNode(oldId: string, wanted: string): string | undefined {
  const doc = state.doc;
  const node = doc.nodes.find((n) => n.id === oldId);
  if (!node) return undefined;
  const id = uniqueId({ ...doc, nodes: doc.nodes.filter((n) => n.id !== oldId) }, wanted);
  if (id === oldId) return oldId;
  const swap = (v: string) => (v === oldId ? id : v);
  commit({
    ...doc,
    nodes: doc.nodes.map((n) => (n.id === oldId ? { ...n, id } : n)),
    connections: doc.connections.map((c) => ({ ...c, from: swap(c.from), to: swap(c.to) })),
  });
  set({ sel: state.sel.map(swap), ...((state.modal?.type === "skill" || state.modal?.type === "tool") && state.modal.id === oldId ? { modal: { ...state.modal, id } } : {}) });
  return id;
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

let toastSeq = 0;
export function toast(msg: string, undo = false, error = false) {
  const mine = ++toastSeq; // o timer só fecha o aviso que o criou: a mesma mensagem repetida não é fechada pelo timer da anterior
  set({ toast: msg, toastUndo: undo, toastError: error });
  setTimeout(() => toastSeq === mine && set({ toast: null, toastUndo: false, toastError: false }), error ? 6000 : undo ? 7000 : 2600); // erro e ação pedem tempo de leitura
}

/** Aviso de falha: mesmo lugar do toast, mas com destaque e leitura imediata por leitor de tela. */
export function toastError(msg: string) {
  toast(msg, false, true);
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
const LOGIC_PLACEHOLDER: Record<string, LogicNodeSpec> = {
  "logic-decision": { role: "decision", when: "condicao" },
  "logic-loop": { role: "loop", until: "condicao" },
};

export function placeAsset(assetId: string, x: number, y: number, parent?: string, owner?: string) {
  // Decision e Loop não existem sem condição; nascem com a provisória «condicao», que o inspetor mostra e a validação (L002) acusa até ser trocada.
  // Um Cenário nasce com o 1º exemplo já preenchido com as entradas do fluxo e o nome «Caso N» em português (em vez de «Scenario»).
  const isScenario = assetId === "logic-scenario";
  const logic = isScenario ? ({ role: "scenario", examples: [starterExample(state.doc)] } as LogicNodeSpec) : LOGIC_PLACEHOLDER[assetId];
  const label = isScenario ? `Caso ${state.doc.nodes.filter((n) => n.logic?.role === "scenario").length + 1}` : undefined;
  const d = state.defaults;
  const style = { ...(d.fill ? { fill: d.fill } : {}), ...(d.fillOpacity != null && d.fillOpacity !== 1 ? { fillOpacity: d.fillOpacity } : {}) };
  const [r] = run([owner ? { op: "add_node", asset: assetId, owner, ...style } : { op: "add_node", asset: assetId, x, y, parent, ...(logic ? { logic } : {}), ...(label ? { label } : {}), ...style }]);
  if (!r.ok) toastError(`Não deu para adicionar: ${r.error ?? "erro desconhecido"}`);
  if (r.ok && r.id) {
    set({ sel: [r.id], ...(isScenario ? { focusTick: state.focusTick + 1 } : {}) }); // Cenário novo: o campo Nome já vem selecionado para digitar o caso
    if (assetId === "agent-skill") set({ modal: { type: "skill", id: r.id, tab: "catalog" } }); // skill nova: buscar no catálogo ou escrever do zero
    if (assetId === "agent-tool") set({ modal: { type: "tool", id: r.id, tab: "search" } }); // tool nova: buscar (nativas, catálogo MCP, registro) ou configurar à mão
    if (parent) {
      const doc = structuredClone(state.doc);
      fitGroup(doc, parent);
      commit(doc);
    }
  }
}

/**
 * Pluga uma skill num agent (seta `uses-skill`) e/ou num grupo `global`, num único passo de desfazer.
 * Com `entry`, reaproveita o nó que já usa a mesma fonte do catálogo e baixa o SKILL.md em seguida;
 * sem `entry`, cria uma skill vazia e abre o diálogo para buscar ou escrever.
 */
export function plugSkill(opts: { entry?: SkillCatalogEntry; skillId?: string; agentId?: string; groupId?: string; x?: number; y?: number }) {
  const doc = state.doc;
  const agent = opts.agentId ? doc.nodes.find((n) => n.id === opts.agentId && n.agent?.role === "agent") : undefined;
  const source = opts.entry ? { ...catalogEntryToSource(opts.entry), ...(opts.entry.hash ? { hash: opts.entry.hash } : {}) } : undefined;
  const existing = opts.skillId
    ? doc.nodes.find((n) => n.id === opts.skillId && n.agent?.role === "skill")
    : source && doc.nodes.find((n) => n.agent?.role === "skill" && n.agent.source?.repo === source.repo && n.agent.source.skillPath === source.skillPath);
  const ops: Op[] = [];
  let id = existing?.id;
  if (!id) {
    id = uniqueId(doc, opts.entry?.name ?? "skill");
    const spot = agent ? freeSpotBelow(doc, agent) : undefined; // vaga livre sob o agent, sem cair em cima de outro nó
    const x = spot ? spot.x : (opts.x ?? 0);
    const y = spot ? spot.y : (opts.y ?? 0);
    ops.push({
      op: "add_node",
      id,
      asset: "agent-skill",
      ...(opts.entry ? { label: opts.entry.name, agent: { role: "skill", description: opts.entry.description, ...(opts.entry.body ? { body: opts.entry.body } : {}), source } } : {}),
      x: Math.round(x / 8) * 8,
      y: Math.round(y / 8) * 8,
      ...(opts.groupId ? { parent: opts.groupId } : {}),
    });
  } else if (opts.groupId && existing?.parent !== opts.groupId) ops.push({ op: "update", id, patch: { parent: opts.groupId } });
  if (agent && !doc.connections.some((c) => c.from === agent.id && c.to === id && c.agent?.rel === "uses-skill")) {
    ops.push({ op: "add_connection", from: agent.id, to: id, type: AGENT_RELS["uses-skill"].type, agent: { rel: "uses-skill" } });
  }
  if (!ops.length) return toast(`${agent?.label ?? "O agent"} já usa esta skill`);
  const { doc: next, results } = applyOps(doc, ops);
  const bad = results.find((r) => !r.ok);
  if (bad) return toastError(`Não deu para plugar a skill: ${bad.error ?? "erro desconhecido"}`);
  if (opts.groupId) fitGroup(next, opts.groupId);
  commit(next);
  set({ sel: [id] });
  if (agent) toast(existing ? `${existing.label} plugada em ${agent.label}` : `Skill plugada em ${agent.label}`);
  if (!opts.entry && !existing) set({ modal: { type: "skill", id, tab: "catalog" } });
  if (opts.entry && !existing && source && !(opts.entry.body && opts.entry.hash)) {
    const skillId = id;
    resolveSkillSource(source).then((r) => {
      const n = state.doc.nodes.find((x) => x.id === skillId);
      if (!r.ok || !n?.agent?.source || n.agent.source.hash || n.agent.source.repo !== source.repo) return;
      run([{ op: "update", id: skillId, patch: { agent: { ...n.agent, body: r.body, description: r.description ?? n.agent.description, source: { ...n.agent.source, hash: r.hash } } } }]);
    });
  }
}

/**
 * Modo agents: pluga uma ferramenta num agent (seta `uses-tool`) ou a solta num grupo/no canvas.
 * Tool nativa já existente no diagrama é reaproveitada; servidor MCP novo abre pedindo o nome no inspetor.
 */
export function plugTool(opts: { agentId?: string; groupId?: string; toolType?: AgentToolType; toolName?: string; entry?: McpCatalogEntry; x?: number; y?: number; openCatalog?: boolean }): void {
  const doc = state.doc;
  const agent = opts.agentId ? doc.nodes.find((n) => n.id === opts.agentId && n.agent?.role === "agent") : undefined;
  const blank = !opts.entry && !opts.toolType && !opts.toolName; // tool nova sem escolha: abre o diálogo de busca, como a skill
  const toolType: AgentToolType = opts.entry ? "mcp" : opts.toolType ?? "native";
  const existing = opts.entry
    ? doc.nodes.find((n) => n.agent?.role === "tool" && n.agent.mcpSource?.id === opts.entry!.id && n.agent.mcpSource.catalog === opts.entry!.origin)
    : toolType === "native" && opts.toolName ? doc.nodes.find((n) => n.agent?.role === "tool" && n.agent.toolType === "native" && n.agent.toolName === opts.toolName) : undefined;
  const ops: Op[] = [];
  let id = existing?.id;
  if (!id) {
    const label = opts.entry ? opts.entry.name : blank ? "Tool" : toolType === "native" ? opts.toolName ?? "Tool" : "Servidor MCP";
    id = uniqueId(doc, opts.entry ? opts.entry.id : label);
    const spot = agent ? freeSpotBelow(doc, agent) : undefined; // vaga livre sob o agent, sem cair em cima de outro nó
    const x = spot ? spot.x : (opts.x ?? 0);
    const y = spot ? spot.y : (opts.y ?? 0);
    ops.push({
      op: "add_node",
      id,
      asset: "agent-tool",
      label,
      agent: opts.entry ? mcpEntryToSpec(opts.entry) : blank ? { role: "tool" } : { role: "tool", toolType, ...(toolType === "native" && opts.toolName ? { toolName: opts.toolName } : {}), ...(toolType === "mcp" ? { transport: "stdio" as const } : {}) },
      x: Math.round(x / 8) * 8,
      y: Math.round(y / 8) * 8,
      ...(opts.groupId ? { parent: opts.groupId } : {}),
    });
  } else if (opts.groupId && existing?.parent !== opts.groupId) ops.push({ op: "update", id, patch: { parent: opts.groupId } });
  if (agent && !doc.connections.some((c) => c.from === agent.id && c.to === id && c.agent?.rel === "uses-tool")) {
    ops.push({ op: "add_connection", from: agent.id, to: id, type: AGENT_RELS["uses-tool"].type, agent: { rel: "uses-tool" } });
  }
  if (!ops.length) return toast(`${agent?.label ?? "O agent"} já usa esta ferramenta`);
  const { doc: next, results } = applyOps(doc, ops);
  const bad = results.find((r) => !r.ok);
  if (bad) return toastError(`Não deu para plugar a ferramenta: ${bad.error ?? "erro desconhecido"}`);
  if (opts.groupId) fitGroup(next, opts.groupId);
  commit(next);
  set({ sel: [id] });
  if (agent) toast(`${existing?.label ?? opts.entry?.name ?? (toolType === "mcp" ? "Servidor MCP" : opts.toolName ?? "Tool")} plugada em ${agent.label}`);
  if (opts.entry?.requiredVars?.length && !existing) toast(`Defina no ambiente: ${opts.entry.requiredVars.map((v) => v.name).join(", ")}`);
  if ((blank || opts.openCatalog) && !opts.entry && !existing) set({ modal: { type: "tool", id, tab: "search" } });
}

/** Aplica uma entrada do catálogo MCP a um nó Tool existente (nome, id, conexão e origem) num passo de desfazer. */
export function applyMcpEntry(nodeId: string, entry: McpCatalogEntry) {
  const node = state.doc.nodes.find((n) => n.id === nodeId && n.agent?.role === "tool");
  if (!node) return;
  run([{ op: "update", id: nodeId, patch: { label: entry.name, agent: mcpEntryToSpec(entry) } }]);
  renameNode(nodeId, entry.id);
  if (entry.requiredVars?.length) toast(`${entry.name} aplicado. Defina no ambiente: ${entry.requiredVars.map((v) => v.name).join(", ")}`);
  else toast(`${entry.name} aplicado`);
}

/** Faz do nó Tool uma tool nativa (Read, Bash…): nome, id e tipo num passo de desfazer. */
export function applyNativeTool(nodeId: string, toolName: string) {
  const node = state.doc.nodes.find((n) => n.id === nodeId && n.agent?.role === "tool");
  if (!node) return;
  run([{ op: "update", id: nodeId, patch: { label: toolName, agent: { role: "tool", toolType: "native", toolName } } }]);
  renameNode(nodeId, toolName);
  toast(`${toolName} aplicada`);
}

/** Sonda um servidor MCP (executa o comando ou conecta na url). SÓ chamar depois de o usuário confirmar o que será executado. */
export const probeMcpServer = (spec: { transport?: string; command?: string; args?: string[]; url?: string; env?: Record<string, string>; headers?: Record<string, string> }) =>
  call<{ tools: { name: string; description?: string }[]; server?: { name?: string; version?: string } }>("/api/mcp/probe", { ...spec, confirm: true });

/** Quais variáveis de ambiente existem no processo do Archflow (só booleanos). Vazio sem servidor local. */
export const checkMcpEnv = (names: string[]) => (names.length ? call<Record<string, boolean>>(`/api/mcp/env-check?names=${encodeURIComponent(names.join(","))}`) : Promise.resolve({} as Record<string, boolean>));

/** Busca no registro oficial de servidores MCP (via bridge). */
export const searchMcpRegistryApi = (q: string) => call<{ entries: McpCatalogEntry[] }>(`/api/mcp-registry/search?q=${encodeURIComponent(q)}`);

/** Transforma a lista de texto `tools` de um agent em componentes Tool ligados por `uses-tool` (um passo de desfazer). */
export function convertLegacyTools(agentId: string) {
  const doc = state.doc;
  const agent = doc.nodes.find((n) => n.id === agentId && n.agent?.role === "agent");
  const names = agent?.agent?.tools ?? [];
  if (!agent || !names.length) return;
  const ops: Op[] = [];
  let work = doc;
  const keep: string[] = [];
  names.forEach((name) => {
    if (!NATIVE_TOOL_NAMES.includes(name)) return void keep.push(name); // mcp__… e nomes desconhecidos ficam como estão
    let node = work.nodes.find((n) => n.agent?.role === "tool" && n.agent.toolType === "native" && n.agent.toolName === name);
    if (!node) {
      const id = uniqueId(work, name);
      const spot = freeSpotBelow(work, agent);
      const o: Op = { op: "add_node", id, asset: "agent-tool", label: name, agent: { role: "tool", toolType: "native", toolName: name }, x: spot.x, y: spot.y };
      work = applyOps(work, [o]).doc;
      ops.push(o);
      node = work.nodes.find((n) => n.id === id)!;
    }
    ops.push({ op: "add_connection", from: agent.id, to: node.id, type: AGENT_RELS["uses-tool"].type, agent: { rel: "uses-tool" } });
  });
  const rest = { ...agent.agent!, ...(keep.length ? { tools: keep } : {}) };
  if (!keep.length) delete rest.tools;
  ops.push({ op: "update", id: agent.id, patch: { agent: rest } });
  const { doc: next, results } = applyOps(doc, ops);
  const bad = results.find((r) => !r.ok);
  if (bad) return toastError(`Não deu para converter: ${bad.error ?? "erro desconhecido"}`);
  commit(next);
  toast(`${names.length - keep.length} tool(s) viraram componentes${keep.length ? `; ${keep.length} ficaram na lista (${keep.join(", ")})` : ""}`);
}

function writePrefs() {
  write(LS_PREFS, {
    animate: state.animate,
    snap: state.snap,
    theme: state.theme,
    bg: state.bg,
    defaults: state.defaults,
    actionsHidden: state.actionsHidden,
  });
}

export function setPrefs(p: Prefs) {
  const { defaults: dIn, ...rest } = p;
  if (dIn) {
    const defaults = mergeDefaults({ ...state.defaults, ...dIn });
    set({ ...rest, defaults, connType: defaults.connType });
  } else {
    set(rest);
  }
  writePrefs();
  if (p.theme) applyTheme();
}

/** Atualiza os estilos padrão (próximos elementos) e persiste. */
export function setStyleDefaults(p: Partial<ElementDefaults>) {
  const defaults = { ...state.defaults, ...p };
  set({ defaults, ...(p.connType !== undefined ? { connType: p.connType } : {}) });
  writePrefs();
}

/** Aplica estilos à seleção (se houver) e atualiza os defaults — padrão Excalidraw. */
export function applyStyleToSelection(p: Partial<ElementDefaults>) {
  setStyleDefaults(p);
  const { sel, doc } = state;
  if (!sel.length) return;
  const ops: Op[] = [];
  for (const id of sel) {
    const node = doc.nodes.find((n) => n.id === id);
    const group = doc.groups.find((g) => g.id === id);
    const note = doc.notes.find((n) => n.id === id);
    const conn = doc.connections.find((c) => c.id === id);
    const patch: Record<string, unknown> = {};
    if (node) {
      if ("fill" in p) patch.fill = p.fill;
      if ("fillOpacity" in p) patch.fillOpacity = p.fillOpacity;
      if (p.nodeKind && node.kind !== "endpoint" && node.kind !== "domain" && node.kind !== "logic") patch.kind = p.nodeKind;
    } else if (group) {
      if ("fill" in p) patch.fill = p.fill;
      if ("fillOpacity" in p) patch.fillOpacity = p.fillOpacity;
      if (p.groupKind) patch.kind = p.groupKind;
      if ("groupColor" in p) patch.color = p.groupColor;
    } else if (note) {
      if ("noteColor" in p) patch.color = p.noteColor;
      if (p.noteFont) patch.font = p.noteFont === "sans" ? undefined : p.noteFont;
    } else if (conn) {
      if (p.connType) patch.type = p.connType;
      if (p.connRouting) patch.routing = p.connRouting === "curve" ? undefined : p.connRouting;
    }
    if (Object.keys(patch).length) ops.push({ op: "update", id, patch });
  }
  if (ops.length) run(ops);
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


let firstAdopt = true;

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
  if (firstAdopt && source === "file") {
    // primeiro carregamento: o rascunho local não é uma ação do usuário; desfazer não pode voltar a ele
    firstAdopt = false;
    set({ doc: d, docSource: "remote", past: [], future: [] });
    return;
  }
  firstAdopt = false;
  commit(d, "remote");
  if (source === "mcp") toast("Diagrama atualizado pelo agente (MCP)", true);
}

/** `fetch` das rotas /api: servidor local quando disponível; senão, o backend em memória do navegador. */
let localMod: typeof import("./localProject") | null = null;
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
    toastError(e instanceof Error ? e.message : String(e));
  }
};
const flushPush = async () => {
  clearTimeout(pushTimer);
  if (state.online && state.docSource === "local") await pushNow();
};

/** Instala a fonte com `npx skills add` (no projeto em disco) e grava as skills no catálogo local. */
export async function installGithubSkills(repo: string, skillPath: string, force = false): Promise<{ installed: SkillCatalogEntry[]; project?: string }> {
  const j = await call<{ installed?: SkillCatalogEntry[]; project?: string }>("/api/skills/install", { repo, skillPath, force });
  const installed = (j.installed ?? []).filter((e) => e?.id && e.repo && e.skillPath && e.body);
  if (installed.length) saveCatalogSkills(installed);
  return { installed, project: j.project };
}

export interface HubSkill {
  repo: string;
  skillId: string;
  name: string;
  installs: number;
}
/** Busca no catálogo público (skills.sh) via servidor local. */
export const searchSkillsHub = async (q: string) => (await call<{ skills: HubSkill[] }>(`/api/skills/search?q=${encodeURIComponent(q)}`)).skills;

export const topSkillsHub = async () => (await call<{ skills: HubSkill[] }>("/api/skills/top")).skills;

export interface SkillSourceInfo {
  repo: string;
  indexedAt?: string;
  error?: string;
  count: number;
}
/** Fontes de skills (repositórios GitHub) registradas e indexadas no banco local (~/.archflow/skill-sources.json). */
export const listSkillSources = async () => (await call<{ sources: SkillSourceInfo[] }>("/api/skills/sources")).sources;
export const addSkillSource = async (repo: string) => (await call<{ sources: SkillSourceInfo[] }>("/api/skills/sources", { repo })).sources;
export const refreshSkillSources = async (repo?: string) => (await call<{ sources: SkillSourceInfo[] }>("/api/skills/sources/refresh", { repo })).sources;
export const removeSkillSource = async (repo: string) => (await call<{ sources: SkillSourceInfo[] }>("/api/skills/sources/remove", { repo })).sources;
export const indexedSkills = async () => (await call<{ skills: { repo: string; id: string; name: string; skillPath: string; description: string }[] }>("/api/skills/indexed")).skills;

/** Skills já baixadas (banco local do servidor): entram no catálogo como instaladas, sem baixar de novo. */
export async function loadDownloadedSkills() {
  try {
    const j = await call<{ skills?: SkillCatalogEntry[] }>("/api/skills/downloaded");
    const list = (j.skills ?? []).filter((e) => e?.id && e.repo && e.skillPath && e.body);
    if (list.length) saveCatalogSkills(list);
  } catch {
    /* sem servidor ou sem banco: o catálogo local segue valendo */
  }
}

export const fsList = (path?: string) => call<{ path: string; parent: string | null; home: string; dirs: { name: string; path: string; archflow: number; project: boolean }[]; files?: number; project?: boolean }>("/api/fs/list" + (path ? `?path=${encodeURIComponent(path)}` : ""));
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

/** Lê o diagrama completo de outro arquivo do projeto (para o visualizador em modal). */
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

/** Insere, no diagrama atual, um componente que referencia outro diagrama do projeto. */
export function addRefNode(diagram: string, title: string, x?: number, y?: number, node?: string) {
  if (diagram === state.file) return toast("Um diagrama não pode referenciar a si mesmo");
  const [r] = run([{ op: "add_node", asset: "diagram-ref", label: title, ref: { diagram, node }, x, y }]);
  if (r.ok && r.id) set({ sel: [r.id] });
}
/** `blank`: diagrama de domínio sem a estrutura circular (ex.: mapa de contextos). */
export const newDiagram = (title: string, folder = "", mode: DocMode = "architecture", blank = false) => guard(() => reload("/api/diagrams", { title, folder, mode, ...(blank ? { blank } : {}) }));
/**
 * Todos os exemplos da seção «Exemplos» (Arquitetura, Domínio e Lógica). Os algoritmos de Lógica são arquivos de `examples/`
 * carregados só quando a pessoa instala um (cada um vira um pacote separado, fora do principal).
 */
const algorithmFiles = import.meta.glob<Doc>("../../examples/exemplos-algoritmos/*.archflow.json", { import: "default" });
export const exampleCatalog: CatalogExample[] = buildCatalog(async (file) => {
  const load = algorithmFiles[`../../examples/exemplos-algoritmos/${file}.archflow.json`];
  if (!load) throw new Error(`exemplo «${file}» não encontrado`);
  return normalizeDoc(await load());
});

/** Abre o explorador na seção «Exemplos», na aba do modo pedido (sem pedido, a do modo do explorador). */
export const openExamples = (tab: DocMode | null = null) => set({ panel: "files", modal: null, examples: { open: true, tab } });

/**
 * Instala um exemplo no projeto aberto e abre o principal. Não sobrescreve nada: se algum arquivo do exemplo já existir,
 * só abre o que já está lá.
 */
export async function installExample(ex: CatalogExample): Promise<boolean> {
  const have = new Set(state.workspace?.files.map((f) => f.path) ?? []);
  const folder = (path: string) => path.slice(0, path.lastIndexOf("/"));
  if (ex.files.some((f) => have.has(f.path))) {
    await openDiagram(have.has(ex.open) ? ex.open : ex.files.find((f) => have.has(f.path))!.path);
    if (ex.tour) set({ tour: { step: 0 }, lessonOpen: false, panel: null, iso: false, tool: "select" });
    else if (ex.guided) set({ lessonOpen: true, panel: null }); // a aula ocupa a direita: o explorador fecha para o diagrama aparecer
    toast(`O exemplo já está no projeto (${folder(ex.open)}). Apague o arquivo ou a pasta para reinstalar.`);
    return false;
  }
  let toOpen = ex.open;
  for (const f of ex.files) {
    const made = await newDiagram(f.title, folder(f.path), f.mode, true); // o conteúdo vem do exemplo: sem a estrutura vazia
    const name: string | undefined = made?.name;
    if (!name) return false;
    // os diagramas de um exemplo de domínio se referenciam pelo caminho (mapa de contextos → contextos): o caminho tem de ser o previsto
    if (ex.linked && name !== f.path) {
      toastError(`Caminho inesperado para ${f.title}: ${name}. Os vínculos entre diagramas do exemplo não funcionariam.`);
      return false;
    }
    // o diagrama novo chega do servidor de forma assíncrona; só então o conteúdo do exemplo entra nele
    for (let t = 0; t < 60 && state.file !== name; t++) await new Promise((r) => setTimeout(r, 50));
    if (state.file !== name) return false;
    replaceDoc(await f.load());
    if (f.path === ex.open) toOpen = name;
  }
  await openDiagram(toOpen);
  if (ex.tour) set({ tour: { step: 0 }, lessonOpen: false, panel: null, iso: false, tool: "select" }); // o tutorial guia na própria interface
  else if (ex.lesson) set({ lessonOpen: true, iso: true }); // a aula de DDD abre nas camadas 3D, com o painel dos passos
  else if (ex.guided) set({ lessonOpen: true, panel: null }); // a aula do exemplo abre no 2D, no primeiro passo, sem o explorador
  toast(`Exemplo «${ex.title}» instalado em ${folder(ex.open)}`);
  return true;
}

/** Todos os diagramas do projeto (caminho + conteúdo): base da visão geral de domínio. */
export const fetchProjectDocs = () => call<{ files: { path: string; doc: Doc }[] }>("/api/project/docs").then((r) => r.files);
export const duplicateDiagram = (name: string) => guard(() => reload("/api/diagrams/duplicate", { name }));
export const renameDiagram = (name: string, title: string) => guard(() => reload("/api/diagrams/rename", { name, title }));
export const moveDiagram = (name: string, folder: string) => guard(() => reload("/api/diagrams/move", { name, folder }));
export const deleteDiagram = (name: string) => guard(async () => void (await call("/api/diagrams/delete", { name }), toast("Movido para a lixeira do projeto (.archflow/trash)")));
export const createFolder = (path: string) => guard(() => call("/api/folders", { path }));
export const renameFolder = (path: string, name: string) => guard(() => reload("/api/folders/rename", { path, name }));
export const deleteFolder = (path: string) => guard(async () => void (await call("/api/folders/delete", { path }), toast("Pasta movida para a lixeira do projeto")));

export const projectCreate = (name: string, parent: string) =>
  guard(async () => {
    await flushPush();
    await call("/api/projects/create", { name, parent });
    toast(`Projeto «${name}» criado`);
    return true;
  });
export const projectOpen = (path: string) =>
  guard(async () => {
    await flushPush();
    await call("/api/projects/open", { path });
    toast("Projeto aberto");
    return true;
  });
export const projectSwitch = (id: string) =>
  guard(async () => {
    await flushPush();
    await call("/api/projects/switch", { id });
    return true;
  });
export const projectRemove = (id: string) => guard(() => call("/api/projects/remove", { id }));

export function toggleFolder(path: string, force?: boolean) {
  const key = `${state.workspace?.project.id ?? ""}:${path}`;
  const expanded = { ...state.expanded, [key]: force ?? !state.expanded[key] };
  set({ expanded });
  write(LS_TREE, expanded);
}
export const isExpanded = (path: string, ex = state.expanded) => !!ex[`${state.workspace?.project.id ?? ""}:${path}`];

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

  /** Sem servidor local: projetos guardados no IndexedDB deste navegador. */
  const goLocal = async () => {
    try {
      localMod = await import("./localProject");
      set({ storage: "local" });
      await localMod.initLocal((ev, data) => (ev === "doc" ? onDoc(data as never) : onWorkspace(data as Workspace)), state.doc);
      set({ workspace: await call<Workspace>("/api/workspace"), online: true });
      await loadFromBridge();
      if (!localMod.isPersistent()) toast("Este navegador bloqueou o armazenamento: os dados só duram enquanto a aba estiver aberta.");
    } catch (e) {
      set({ storage: null, online: false });
      toastError("Não foi possível iniciar o armazenamento do navegador: " + (e instanceof Error ? e.message : e));
    }
  };

  let everConnected = false;
  const connect = async () => {
    if (state.storage === "local") return;
    try {
      const w = await call<Workspace>("/api/workspace");
      // hospedagem estática responde index.html (200) para /api/*: só vale se vier um workspace de verdade
      if (!w?.project || !Array.isArray(w.files)) throw new Error("sem servidor local");
      everConnected = true;
      set({ workspace: w, storage: "server" });
      await loadFromBridge();
      if (!w.configured && !read<boolean>(LS_WELCOME)) {
        write(LS_WELCOME, true); // primeira execução: oferece criar/abrir um projeto (como o Obsidian)
        set({ modal: { type: "projects" } });
      }
      const es = new EventSource("/api/events");
      es.addEventListener("doc", (ev) => onDoc(JSON.parse((ev as MessageEvent).data)));
      es.addEventListener("workspace", (ev) => onWorkspace(JSON.parse((ev as MessageEvent).data) as Workspace));
      es.addEventListener("hello", () => set({ online: true }));
      es.addEventListener("harness", (ev) => {
        const r = JSON.parse((ev as MessageEvent).data) as { ok: boolean; error?: string; changed?: number; conflicts?: string[] };
        if (!r.ok) return toastError(`Harness não sincronizado: ${r.error}`);
        if (r.conflicts?.length) toastError(`Harness: ${r.conflicts.length} arquivo(s) editado(s) à mão foram preservados (${r.conflicts.slice(0, 2).join(", ")}${r.conflicts.length > 2 ? "…" : ""}). Exporte pelo botão ⬇ para sobrescrever.`);
        else if (r.changed) toast(`Harness atualizado no projeto (${r.changed} arquivo(s))`);
      });
      es.addEventListener("export", (ev) => {
        const req = JSON.parse((ev as MessageEvent).data);
        void import("./export").then((m) => m.answerExport(req));
      });
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

/* ───────── projeto do navegador: backup (exportar/importar) ───────── */

export async function exportLocalProject() {
  if (state.storage !== "local" || !localMod) return;
  const bundle = localMod.exportBundle();
  download(`${localMod.bundleName().replace(/[^\w\-]+/g, "_")}.archflow-project.json`, new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" }));
}
export const importLocalProject = (file: File) =>
  guard(async () => {
    const bundle = JSON.parse(await file.text());
    await flushPush();
    await call("/api/projects/import", { bundle });
    toast("Projeto importado");
    return true;
  });

/** Abre o terminal e digita `prefill` (o usuário confirma com Enter): numa sessão nova do Claude Code ou, com `target: "active"`, na aba ativa. */
let termReqN = 0;
export const runInTerminal = (prefill: string, title: string, target: "new" | "active" = "new") => set({ termOpen: true, termRequest: { n: ++termReqN, prefill, title, target } });

/** «Executar» de um nó prompt/workflow: abre o terminal e o formulário de execução desse nó. */
let runNodeN = 0;
export const runNodeInTerminal = (id: string) => set({ termOpen: true, runNodeRequest: { n: ++runNodeN, id } });

/** Liga o prompt a um agente (seta runs-on), trocando o anterior; `agentId` vazio só desliga. */
export function setPromptAgent(promptId: string, agentId: string) {
  const ops: Op[] = getState().doc.connections.filter((c) => c.from === promptId && c.agent?.rel === "runs-on").map((c) => ({ op: "remove", id: c.id }));
  if (agentId) ops.push({ op: "add_connection", from: promptId, to: agentId, type: AGENT_RELS["runs-on"].type, agent: { rel: "runs-on" } });
  if (ops.length) run(ops);
}

/** Acrescenta um prompt como último passo do workflow (seta step com order). */
export function addWorkflowStep(workflowId: string, promptId: string) {
  const n = workflowSteps(getState().doc, workflowId).length;
  run([{ op: "add_connection", from: workflowId, to: promptId, type: AGENT_RELS.step.type, agent: { rel: "step", order: n + 1 } }]);
}

/** Reescreve a ordem (1..n) dos passos do workflow segundo `connIds`. */
export function reorderWorkflowSteps(workflowId: string, connIds: string[]) {
  const doc = getState().doc;
  run(connIds.flatMap((id, i): Op[] => {
    const c = doc.connections.find((x) => x.id === id);
    return c?.agent && c.from === workflowId ? [{ op: "update", id, patch: { agent: { ...c.agent, order: i + 1 } } }] : [];
  }));
}

/* ───────── modo Agents: exportar o harness ───────── */

export const HARNESS_TARGETS: { id: HarnessTarget; label: string; root: string }[] = [
  { id: "claude", label: "Claude Code", root: ".claude" },
  { id: "cursor", label: "Cursor", root: ".cursor" },
];

/** Alvos que o projeto regrava sozinho a cada edição do diagrama (`.archflow/project.json`). */
export const loadHarnessSync = () => call<{ targets: HarnessTarget[] }>("/api/harness/settings").then((r) => r.targets);
/** Igual a `loadHarnessSync`, mais se o projeto foi configurado (sem isso o bridge não regrava sozinho). */
export const loadHarnessSyncState = () => call<{ targets: HarnessTarget[]; configured: boolean }>("/api/harness/settings");
export const saveHarnessSync = (targets: HarnessTarget[]) =>
  guard(async () => {
    const r = await call<{ targets: HarnessTarget[] }>("/api/harness/settings", { targets });
    toast(r.targets.length ? `Harness sincronizado automaticamente: ${r.targets.join(" + ")}` : "Sincronização automática do harness desligada");
    return r.targets;
  });

/** Os arquivos que o harness do diagrama aberto geraria (vazio fora do modo agents). */
export function harnessFiles(target: HarnessTarget) {
  try {
    return generateHarness(state.doc, target);
  } catch {
    return [];
  }
}

function download(name: string, blob: Blob) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/**
 * Com um projeto em disco aberto, grava o harness dentro dele (`.claude/` ou `.cursor/`), que é onde o
 * Claude Code e o Cursor procuram. Sem servidor local (modo navegador), baixa a mesma árvore em um .zip.
 */
/** Lê o harness de .claude/ do projeto aberto e aplica as ops no diagrama (preview do bridge + run; desfazível). */
export const importHarness = () =>
  guard(async () => {
    if (!(state.storage === "server" && state.online)) return void toastError("Importar do projeto precisa do projeto aberto em disco (npm run dev).");
    const r = await call<{ ops: Op[]; skipped: string[]; read: string[] }>("/api/harness/import", {}).catch((e: Error) => {
      if (/rota não encontrada/.test(e.message)) throw new Error("O servidor local é de uma versão anterior: reinicie o npm run dev e tente de novo.");
      throw e;
    });
    if (!r.ops.length) return void toast("Nada para importar: não há agentes nem skills em .claude/");
    const results = run(r.ops);
    const failed = results.filter((x) => !x.ok).length;
    toast(`Importado de .claude/: ${results.length - failed} de ${results.length} operações aplicadas${failed ? `; ${failed} recusadas` : ""}${r.skipped.length ? `. Não volta: ${r.skipped[0]}${r.skipped.length > 1 ? ` (+${r.skipped.length - 1})` : ""}` : ""}`);
  });

export const exportHarness = (target: HarnessTarget) =>
  guard(async () => {
    const label = HARNESS_TARGETS.find((t) => t.id === target)!;
    if (state.storage === "server" && state.online) {
      const r = await call<{ root: string; files: string[] }>("/api/harness", { target });
      toast(`${r.files.length} arquivo(s) do harness ${label.label} em ${r.root}${r.root.endsWith("/") ? "" : "/"}${label.root}`);
      return true;
    }
    const files = harnessFiles(target);
    if (!files.length) return void toastError("Nada a gerar: o diagrama precisa ter agentes ou skills exportáveis (modo agents).");
    const base = (state.doc.title || "harness").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "harness";
    const entries = files.map((f) => ({ path: f.path, content: f.encoding === "base64" ? Uint8Array.from(atob(f.content), (c) => c.charCodeAt(0)) : f.content }));
    download(`${base}-${target}.zip`, new Blob([zip(entries) as unknown as BlobPart], { type: "application/zip" }));
    toast(`Harness ${label.label} baixado (${files.length} arquivo(s))`);
    return true;
  });

/* ───────── modo Logic: reproduzir um cenário (o caminho percorrido no fluxo) ───────── */

let playTimer: ReturnType<typeof setInterval> | undefined;
const stopTimer = () => {
  if (playTimer) clearInterval(playTimer);
  playTimer = undefined;
};
/** Quantos passos o percurso tem (só os que têm id). */
export const playLength = (p: Play) => p.run.steps.filter((s) => s.rule).length;

/** Roda o exemplo `idx` do cenário e começa a reproduzir o caminho a partir do primeiro passo. */
export function startPlay(scenarioId: string, idx = 0, autoplay = true) {
  const doc = state.doc;
  const n = doc.nodes.find((x) => x.id === scenarioId);
  const ex = n?.logic?.examples?.[idx];
  if (!n || !ex) return toast("Este cenário ainda não tem exemplo para reproduzir");
  stopTimer();
  const run = hasFlow(doc) ? runFlow(doc, ex.given, { trace: true }) : runPipeline(doc, ex.given, { trace: true });
  set({ play: { scenario: scenarioId, example: idx, run, k: 0, playing: false, given: ex.given, mode: state.playMode, story: storyOf(doc, run) }, sel: [scenarioId] });
  if (autoplay) playToggle();
}

export function playGo(k: number) {
  const p = state.play;
  if (!p) return;
  const last = playLength(p) - 1;
  const next = Math.max(0, Math.min(last, k));
  set({ play: { ...p, k: next, playing: p.playing && next < last } });
  if (next >= last) stopTimer();
}

export function playToggle() {
  const p = state.play;
  if (!p) return;
  if (p.playing) {
    stopTimer();
    return set({ play: { ...p, playing: false } });
  }
  const last = playLength(p) - 1;
  const from = p.k >= last ? 0 : p.k;
  set({ play: { ...p, k: from, playing: true } });
  startTimer();
}

/** (Re)liga o relógio da reprodução com a velocidade atual. */
function startTimer() {
  stopTimer();
  const explain = state.play?.mode === "explain";
  playTimer = setInterval(
    () => {
      const cur = state.play;
      if (!cur || !cur.playing) return stopTimer();
      // explicar: de momento em momento (o fim do relógio é o último momento)
      if (cur.mode === "explain") {
        const next = cur.story[storyAt(cur.story, cur.k) + 1];
        if (next) return playGo(next.k);
        stopTimer();
        return set({ play: { ...cur, playing: false } });
      }
      playGo(cur.k + 1);
    },
    Math.round((PLAY_STEP_MS * (explain ? 1.6 : 1)) / state.playSpeed),
  );
}

/** Muda a velocidade da reprodução; vale na hora, mesmo com o cenário tocando. */
export function setPlaySpeed(v: number) {
  if (!PLAY_SPEEDS.includes(v)) return;
  set({ playSpeed: v });
  write(LS_PLAY_SPEED, v);
  if (state.play?.playing) startTimer();
}

/** Troca entre explicar (momentos) e depurar (passo a passo); vale para as próximas reproduções também. */
export function setPlayMode(mode: PlayMode) {
  set({ playMode: mode, ...(state.play ? { play: { ...state.play, mode } } : {}) });
  write(LS_PLAY_MODE, mode);
  if (state.play?.playing) startTimer();
}

export function stopPlay() {
  stopTimer();
  set({ play: null, playFull: false });
}

/* ───────── modo Logic: etapas (recolher num cartão-resumo / abrir os passos) ───────── */

/** Recolhe ou abre uma etapa e refaz o layout (o cartão ocupa o lugar dos passos, e vice-versa). Um Ctrl+Z desfaz. */
export function toggleStage(id: string, collapsed?: boolean) {
  const g = state.doc.groups.find((x) => x.id === id);
  if (!g?.stage) return;
  const next = collapsed ?? !g.stage.collapsed;
  if (!!g.stage.collapsed === next) return;
  run([{ op: "update", id, patch: { stage: { ...g.stage, collapsed: next || undefined } } }, { op: "layout" }]);
}

/** Visão geral (todas as etapas recolhidas) ou todos os passos (todas abertas). */
export function setAllStages(collapsed: boolean) {
  const ops: Op[] = state.doc.groups.filter((g) => g.stage && !!g.stage.collapsed !== collapsed).map((g) => ({ op: "update", id: g.id, patch: { stage: { ...g.stage, collapsed: collapsed || undefined } } }));
  if (!ops.length) return;
  run([...ops, { op: "layout" }]);
}

/** Junta os passos selecionados numa etapa nova (aberta) e a seleciona para dar nome. Dados e cenários ficam de fora. */
export function stageFromSelection() {
  const doc = state.doc;
  const ids = new Set(state.sel);
  const steps = doc.nodes.filter((n) => ids.has(n.id) && isFlowNode(n));
  if (!steps.length) return toast("Selecione os passos do fluxo que formam a etapa");
  const label = `Etapa ${doc.groups.filter((g) => g.stage).length + 1}`;
  const id = uniqueId(doc, label);
  // uma operação só: um Ctrl+Z desfaz a etapa inteira
  run([{ op: "add_group", id, label, stage: {} }, ...steps.map((st): Op => ({ op: "update", id: st.id, patch: { parent: id } })), { op: "layout" }]);
  set({ sel: [id] });
}
