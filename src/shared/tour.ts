/**
 * Roteiro de apresentação de um diagrama de arquitetura.
 *
 * Com `doc.tour`, cada passo vira um slide na ordem gravada. Sem roteiro, o app monta um automático:
 * visão geral, um slide por componente na ordem do fluxo e, no fim, as notas.
 *
 * Puro: só lê o Doc.
 */
import { plainText } from "./richtext";
import {
  CONNECTION_TYPES,
  GROUP_KINDS,
  NODE_KINDS,
  endpointLabel,
  type ConnectionEl,
  type Doc,
  type GroupEl,
  type GroupKind,
  type InterfaceSpec,
  type NodeEl,
  type NodeKind,
  type NoteEl,
  type TourStep,
} from "./schema";

export interface TourEndpointLine {
  id: string;
  label: string;
  protocol: string;
  auth?: string;
  request?: string;
  response?: string;
  description?: string;
}

export interface TourProp {
  key: string;
  value: string;
}

export interface TourOperation {
  name: string;
  signature?: string;
  request?: string;
  response?: string;
  description?: string;
}

export interface TourInterface {
  name: string;
  kind: string;
  contract?: string;
  operations: TourOperation[];
}

export interface TourCard {
  id: string;
  role: "component" | "group" | "connection" | "note";
  roleLabel: string;
  title: string;
  context?: string;
  technology?: string;
  responsibility?: string;
  endpoints: TourEndpointLine[];
  props: TourProp[];
  /** "App Web —sync→ Orders API" */
  route?: string;
  protocol?: string;
  iface?: TourInterface;
  noteText?: string;
}

export interface TourSpotlight {
  nodes: string[];
  groups: string[];
  notes: string[];
  conns: string[];
}

export interface TourBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface TourSlide {
  id: string;
  title: string;
  text?: string;
  /** visão geral: o quadro inteiro fica visível */
  overview: boolean;
  cards: TourCard[];
  spotlight: TourSpotlight;
  boxes: TourBox[];
}

export interface Tour {
  /** true quando o diagrama não tem roteiro gravado */
  auto: boolean;
  title: string;
  slides: TourSlide[];
}

const NODE_ROLE: Record<NodeKind, string> = {
  service: "Serviço",
  client: "Cliente",
  actor: "Ator",
  database: "Banco",
  cache: "Cache",
  queue: "Fila",
  gateway: "Gateway",
  external: "Externo",
  ai: "IA",
  infra: "Infra",
  library: "Biblioteca",
  endpoint: "Endpoint",
  system: "Sistema",
  domain: "Domínio",
  logic: "Lógica",
  agent: "Agente",
};

const GROUP_ROLE: Record<GroupKind, string> = {
  boundary: "Fronteira",
  layer: "Camada",
  cloud: "Nuvem",
  network: "Rede",
  context: "Contexto",
  cluster: "Cluster",
  team: "Time",
  global: "Global",
};

const emptySpot = (): TourSpotlight => ({ nodes: [], groups: [], notes: [], conns: [] });

/** Aceita o roteiro gravado no arquivo; descarta passos sem título. */
export function normalizeTour(raw: unknown): TourStep[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const steps: TourStep[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const s = item as Record<string, unknown>;
    if (typeof s.title !== "string" || !s.title.trim()) continue;
    const focus = Array.isArray(s.focus) ? s.focus.filter((id): id is string => typeof id === "string" && id.length > 0) : [];
    steps.push({
      ...(typeof s.id === "string" && s.id ? { id: s.id } : {}),
      title: s.title.trim(),
      ...(typeof s.text === "string" && s.text.trim() ? { text: s.text } : {}),
      focus,
    });
  }
  return steps.length ? steps : undefined;
}

/** Avisos de ids do roteiro que não existem mais. */
export function tourIssues(doc: Doc): string[] {
  if (!doc.tour?.length) return [];
  const known = new Set([...doc.nodes.map((n) => n.id), ...doc.groups.map((g) => g.id), ...doc.notes.map((n) => n.id), ...doc.connections.map((c) => c.id)]);
  const out: string[] = [];
  doc.tour.forEach((s, i) => {
    for (const id of [...new Set(s.focus)]) if (!known.has(id)) out.push(`tour: passo ${i + 1} cita "${id}", que não existe`);
  });
  return out;
}

/** Seção do get_diagram. Vazia quando não há roteiro gravado. */
export function describeTour(doc: Doc): string[] {
  if (!doc.tour?.length) return [];
  const L = ["", "## Roteiro de apresentação"];
  doc.tour.forEach((s, i) => {
    const focus = s.focus.length ? s.focus.map((id) => `\`${id}\``).join(", ") : "visão geral";
    L.push(`${i + 1}. **${s.title}** — ${focus}`);
    if (s.text) L.push(`   ${s.text.replace(/\n/g, " ")}`);
  });
  return L;
}

export function buildTour(doc: Doc): Tour {
  const ctx = index(doc);
  if (doc.tour?.length) {
    return {
      auto: false,
      title: doc.title,
      slides: doc.tour.map((step, i) => slideFrom(ctx, step, `passo-${i + 1}`)),
    };
  }
  return { auto: true, title: doc.title, slides: autoSlides(ctx) };
}

interface Index {
  doc: Doc;
  nodes: Map<string, NodeEl>;
  groups: Map<string, GroupEl>;
  notes: Map<string, NoteEl>;
  conns: Map<string, ConnectionEl>;
}

function index(doc: Doc): Index {
  return {
    doc,
    nodes: new Map(doc.nodes.map((n) => [n.id, n])),
    groups: new Map(doc.groups.map((g) => [g.id, g])),
    notes: new Map(doc.notes.map((n) => [n.id, n])),
    conns: new Map(doc.connections.map((c) => [c.id, c])),
  };
}

function slideFrom(ctx: Index, step: TourStep, id: string): TourSlide {
  const resolved = resolve(ctx, step.focus);
  const overview = resolved.cards.length === 0;
  return {
    id,
    title: step.title,
    ...(step.text ? { text: step.text } : {}),
    overview,
    cards: resolved.cards,
    spotlight: resolved.spotlight,
    boxes: overview ? allBoxes(ctx) : resolved.boxes,
  };
}

function autoSlides(ctx: Index): TourSlide[] {
  const overview: TourStep = { title: ctx.doc.title, ...(ctx.doc.description?.trim() ? { text: ctx.doc.description.trim() } : {}), focus: [] };
  const slides = [slideFrom(ctx, overview, "visao-geral")];
  for (const n of componentOrder(ctx)) {
    const incoming = ctx.doc.connections.filter((c) => componentOf(ctx, c.to) === n.id).map((c) => c.id);
    const step: TourStep = { title: n.label, ...(n.description?.trim() ? { text: n.description.trim() } : {}), focus: [n.id, ...incoming] };
    slides.push(slideFrom(ctx, step, `auto-${n.id}`));
  }
  if (ctx.doc.notes.length) {
    slides.push(slideFrom(ctx, { title: "Observações", focus: ctx.doc.notes.map((n) => n.id) }, "observacoes"));
  }
  return slides;
}

/** Componentes (sem endpoints) na ordem do fluxo; empate pela posição; ciclos no fim, também pela posição. */
function componentOrder(ctx: Index): NodeEl[] {
  const nodes = ctx.doc.nodes.filter((n) => n.kind !== "endpoint");
  const ids = new Set(nodes.map((n) => n.id));
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const indeg = new Map(nodes.map((n) => [n.id, 0]));
  const next = new Map<string, string[]>(nodes.map((n) => [n.id, []]));
  for (const c of ctx.doc.connections) {
    const from = componentOf(ctx, c.from);
    const to = componentOf(ctx, c.to);
    if (!from || !to || from === to || !ids.has(from) || !ids.has(to)) continue;
    if (next.get(from)!.includes(to)) continue;
    next.get(from)!.push(to);
    indeg.set(to, (indeg.get(to) ?? 0) + 1);
  }
  const cmp = (a: NodeEl, b: NodeEl) => a.x - b.x || a.y - b.y || a.id.localeCompare(b.id);
  const ready = nodes.filter((n) => indeg.get(n.id) === 0).sort(cmp);
  const out: NodeEl[] = [];
  const seen = new Set<string>();
  while (ready.length) {
    const n = ready.shift()!;
    if (seen.has(n.id)) continue;
    seen.add(n.id);
    out.push(n);
    for (const id of next.get(n.id) ?? []) {
      indeg.set(id, (indeg.get(id) ?? 1) - 1);
      if (indeg.get(id) === 0) ready.push(byId.get(id)!);
    }
    ready.sort(cmp);
  }
  for (const n of nodes.filter((n) => !seen.has(n.id)).sort(cmp)) out.push(n);
  return out;
}

/** Endpoint aponta para o serviço dono; o próprio componente aponta para si. */
function componentOf(ctx: Index, id: string): string | undefined {
  const n = ctx.nodes.get(id);
  if (!n) return undefined;
  if (n.kind === "endpoint") return n.owner && ctx.nodes.get(n.owner)?.kind !== "endpoint" ? n.owner : undefined;
  return n.id;
}

function resolve(ctx: Index, focus: string[]): { cards: TourCard[]; spotlight: TourSpotlight; boxes: TourBox[] } {
  const cards: TourCard[] = [];
  const spotlight = emptySpot();
  const boxes: TourBox[] = [];
  const seen = new Set<string>();
  const addBox = (b: TourBox | undefined) => {
    if (b) boxes.push(b);
  };
  const addNode = (id: string) => {
    if (!spotlight.nodes.includes(id)) spotlight.nodes.push(id);
  };
  for (const id of focus) {
    if (seen.has(id)) continue;
    seen.add(id);
    const node = ctx.nodes.get(id);
    const group = ctx.groups.get(id);
    const note = ctx.notes.get(id);
    const conn = ctx.conns.get(id);
    if (node) {
      cards.push(componentCard(ctx, node));
      addNode(node.id);
      for (const ep of endpointsOf(ctx, node.id)) {
        addNode(ep.id);
        addBox(box(ep));
      }
      addBox(box(node));
    } else if (group) {
      cards.push(groupCard(ctx, group));
      const desc = descendants(ctx, group.id);
      for (const gid of [group.id, ...desc.groups]) if (!spotlight.groups.includes(gid)) spotlight.groups.push(gid);
      for (const nid of desc.nodes) {
        addNode(nid);
        addBox(box(ctx.nodes.get(nid)!));
        for (const ep of endpointsOf(ctx, nid)) {
          addNode(ep.id);
          addBox(box(ep));
        }
      }
      addBox(box(group));
    } else if (note) {
      cards.push(noteCard(note));
      spotlight.notes.push(note.id);
      addBox(box(note));
    } else if (conn) {
      cards.push(connectionCard(ctx, conn));
      spotlight.conns.push(conn.id);
      for (const end of [conn.from, conn.to]) {
        const n = ctx.nodes.get(end);
        const g = ctx.groups.get(end);
        if (n) {
          addNode(n.id);
          addBox(box(n));
        } else if (g) {
          if (!spotlight.groups.includes(g.id)) spotlight.groups.push(g.id);
          addBox(box(g));
        }
      }
    }
  }
  return { cards, spotlight, boxes };
}

function componentCard(ctx: Index, n: NodeEl): TourCard {
  const eps = endpointsOf(ctx, n.id);
  return {
    id: n.id,
    role: "component",
    roleLabel: n.kind === "endpoint" && n.endpoint ? n.endpoint.protocol.toUpperCase() : (NODE_ROLE[n.kind] ?? NODE_KINDS[n.kind]),
    title: n.label,
    ...(parentLabel(ctx, n.parent) ? { context: parentLabel(ctx, n.parent) } : {}),
    ...(n.technology ? { technology: n.technology } : {}),
    ...(n.description?.trim() ? { responsibility: n.description.trim() } : {}),
    endpoints: eps.map((e) => endpointLine(e)),
    props: Object.entries(n.props ?? {}).map(([key, value]) => ({ key, value })),
  };
}

function groupCard(ctx: Index, g: GroupEl): TourCard {
  return {
    id: g.id,
    role: "group",
    roleLabel: GROUP_ROLE[g.kind] ?? GROUP_KINDS[g.kind],
    title: g.label,
    ...(parentLabel(ctx, g.parent) ? { context: parentLabel(ctx, g.parent) } : {}),
    ...(g.description?.trim() ? { responsibility: g.description.trim() } : {}),
    endpoints: [],
    props: [],
  };
}

function noteCard(n: NoteEl): TourCard {
  const text = plainText(n.text).trim();
  const roleLabel = n.variant === "text" ? "Texto" : n.variant === "list" ? "Lista" : "Nota";
  return {
    id: n.id,
    role: "note",
    roleLabel,
    title: n.title?.trim() || text.split("\n")[0] || roleLabel,
    endpoints: [],
    props: [],
    ...(text ? { noteText: text } : {}),
  };
}

function connectionCard(ctx: Index, c: ConnectionEl): TourCard {
  const from = nameOf(ctx, c.from);
  const to = nameOf(ctx, c.to);
  const route = `${from} —${c.type}→ ${to}`;
  return {
    id: c.id,
    role: "connection",
    roleLabel: CONNECTION_TYPES[c.type]?.label ?? c.type,
    title: c.label?.trim() || route,
    route,
    ...(c.protocol ? { protocol: c.protocol } : {}),
    ...(c.description?.trim() ? { responsibility: c.description.trim() } : {}),
    endpoints: [],
    props: [],
    ...(c.interface ? { iface: ifaceOf(c.interface) } : {}),
  };
}

function ifaceOf(spec: InterfaceSpec): TourInterface {
  return {
    name: spec.name,
    kind: spec.kind,
    ...(spec.contract ? { contract: spec.contract } : {}),
    operations: (spec.operations ?? []).map((o) => {
      const signature = [o.method, o.path].filter(Boolean).join(" ");
      return {
        name: o.name,
        ...(signature ? { signature } : {}),
        ...(o.request ? { request: o.request } : {}),
        ...(o.response ? { response: o.response } : {}),
        ...(o.description ? { description: o.description } : {}),
      };
    }),
  };
}

function endpointLine(n: NodeEl): TourEndpointLine {
  const e = n.endpoint!;
  return {
    id: n.id,
    label: endpointLabel(e),
    protocol: e.protocol,
    ...(e.auth ? { auth: e.auth } : {}),
    ...(e.request ? { request: e.request } : {}),
    ...(e.response ? { response: e.response } : {}),
    ...(n.description?.trim() ? { description: n.description.trim() } : {}),
  };
}

function endpointsOf(ctx: Index, owner: string): NodeEl[] {
  return ctx.doc.nodes.filter((n) => n.owner === owner && n.endpoint);
}

function descendants(ctx: Index, groupId: string): { nodes: string[]; groups: string[] } {
  const nodes: string[] = [];
  const groups: string[] = [];
  const walk = (pid: string) => {
    for (const g of ctx.doc.groups) if (g.parent === pid) (groups.push(g.id), walk(g.id));
    for (const n of ctx.doc.nodes) if (n.parent === pid) nodes.push(n.id);
  };
  walk(groupId);
  return { nodes, groups };
}

function parentLabel(ctx: Index, parent?: string): string | undefined {
  return parent ? ctx.groups.get(parent)?.label : undefined;
}

function nameOf(ctx: Index, id: string): string {
  return ctx.nodes.get(id)?.label ?? ctx.groups.get(id)?.label ?? id;
}

function box(el: { x: number; y: number; w: number; h: number }): TourBox {
  return { x: el.x, y: el.y, w: el.w, h: el.h };
}

function allBoxes(ctx: Index): TourBox[] {
  return [...ctx.doc.groups, ...ctx.doc.nodes, ...ctx.doc.notes].map(box);
}
