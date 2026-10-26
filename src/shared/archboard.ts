/**
 * Organização da visão 3D do modo architecture, à maneira de uma placa de circuito (só a organização; os objetos são os
 * componentes, não peças eletrônicas):
 *
 * - Grade: cada componente ocupa uma célula. Linhas e colunas saem do 2D (centros agrupados por proximidade), então a
 *   ordem e a vizinhança do desenho se mantêm; o passo da grade é fixo, deixando canais livres entre as células.
 * - Trilhas: cada conexão sai pela face do componente voltada para o destino e corre só pelos canais (nunca por cima de
 *   outro componente), em segmentos horizontais e verticais com os cantos cortados a 45°. Trilhas que dividem um canal
 *   ganham pistas paralelas; as que saem pela mesma face, pinos espalhados ao longo dela.
 * - Zonas: cada grupo vira um retângulo que cobre as células dos seus componentes (os de dentro com recuo maior).
 * - Endpoints ficam atrás do componente dono, em fila.
 *
 * Puro (sem three/DOM). Coordenadas da placa: x para a direita, y para a frente (o y do 2D).
 */
import type { Op } from "./ops";
import type { ConnectionEl, Doc, GroupEl, NodeEl } from "./schema";

/** passo da grade (px da placa) */
export const PITCH_X = 360;
export const PITCH_Y = 340;
/** distância entre pistas paralelas num canal e entre pinos numa face */
const LANE = 14;
const PIN = 16;
/** corte a 45° dos cantos das trilhas */
const CHAMFER = 18;
/** escala dos modelos: 1 unidade do Blender = UNIT px da placa */
export const UNIT = 125;

/** Pegada de cada modelo (largura × profundidade, em unidades do Blender), medida nos arquivos de public/models/arch. */
export const FOOTPRINT: Record<string, [number, number]> = {
  service: [1.2, 1.0],
  database: [1.14, 1.14],
  cache: [1.22, 1.06],
  queue: [1.7, 0.62],
  gateway: [1.36, 0.8],
  client: [1.3, 0.6],
  actor: [0.98, 0.98],
  external: [1.3, 0.85],
  ai: [0.96, 0.96],
  infra: [0.96, 0.92],
  library: [1.0, 0.8],
  system: [1.2, 0.9],
  endpoint: [0.42, 0.26],
};

/** Modelo 3D de um componente (os modos sem modelo próprio caem no de serviço). */
export const modelOf = (n: Pick<NodeEl, "kind">) => (FOOTPRINT[n.kind] ? n.kind : "service");

export interface Pt {
  x: number;
  y: number;
}
export interface BoardNode {
  id: string;
  col: number;
  row: number;
  x: number;
  y: number;
  /** meia largura e meia profundidade da pegada (px) */
  hw: number;
  hd: number;
}
export interface BoardZone {
  id: string;
  label: string;
  color?: string;
  kind: GroupEl["kind"];
  depth: number;
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface BoardTrace {
  id: string;
  from: string;
  to: string;
  /** polilinha da trilha (cantos já cortados a 45°), da face da origem à face do destino */
  pts: Pt[];
}
export interface BoardEndpoint {
  id: string;
  owner: string;
  x: number;
  y: number;
}
export interface BoardLayout {
  nodes: Map<string, BoardNode>;
  zones: BoardZone[];
  traces: BoardTrace[];
  endpoints: BoardEndpoint[];
  /** retângulo da placa (com margem) */
  bounds: { x: number; y: number; w: number; h: number };
}

/** Agrupa valores próximos (ordenados) em faixas; devolve o índice da faixa de cada valor. */
function bands(values: number[], tol: number): (v: number) => number {
  const sorted = [...new Set(values)].sort((a, b) => a - b);
  const starts: number[] = [];
  for (const v of sorted) if (!starts.length || v - starts[starts.length - 1] > tol) starts.push(v);
  return (v) => {
    let i = 0;
    while (i + 1 < starts.length && v >= starts[i + 1]) i++;
    return i;
  };
}

const sign = (v: number) => (v > 0 ? 1 : v < 0 ? -1 : 0);

export function boardLayout(doc: Doc): BoardLayout {
  const comps = doc.nodes.filter((n) => !n.owner || n.kind !== "endpoint");
  const center = (n: NodeEl) => ({ x: n.x + n.w / 2, y: n.y + n.h / 2 });
  const colOf = bands(comps.map((n) => center(n).x), 110);
  const rowOf = bands(comps.map((n) => center(n).y), 56);

  // células: na ordem do 2D (de cima para baixo, da esquerda para a direita); célula ocupada empurra para a direita
  const taken = new Set<string>();
  const nodes = new Map<string, BoardNode>();
  const order = [...comps].sort((a, b) => center(a).y - center(b).y || center(a).x - center(b).x);
  for (const n of order) {
    const c = center(n);
    const row = rowOf(c.y);
    let col = colOf(c.x);
    while (taken.has(`${col},${row}`)) col++;
    taken.add(`${col},${row}`);
    const [w, d] = FOOTPRINT[modelOf(n)];
    nodes.set(n.id, { id: n.id, col, row, x: col * PITCH_X, y: row * PITCH_Y, hw: (w * UNIT) / 2, hd: (d * UNIT) / 2 });
  }

  // endpoints: em fila atrás do dono, na ordem do 2D
  const endpoints: BoardEndpoint[] = [];
  const byOwner = new Map<string, NodeEl[]>();
  for (const n of doc.nodes) if (n.owner && n.kind === "endpoint" && nodes.has(n.owner)) byOwner.set(n.owner, [...(byOwner.get(n.owner) ?? []), n]);
  for (const [owner, eps] of byOwner) {
    const o = nodes.get(owner)!;
    eps.sort((a, b) => a.y - b.y || a.x - b.x);
    const perRow = 5;
    eps.forEach((e, i) => {
      const r = Math.floor(i / perRow);
      const inRow = Math.min(perRow, eps.length - r * perRow);
      endpoints.push({ id: e.id, owner, x: o.x + ((i % perRow) - (inRow - 1) / 2) * 50, y: o.y - o.hd - 34 - r * 34 });
    });
  }

  const zones = groupZones(doc, nodes);
  const traces = routeAll(doc.connections, doc.nodes, nodes);

  const xs = [...nodes.values()].map((n) => n.col);
  const ys = [...nodes.values()].map((n) => n.row);
  const c0 = xs.length ? Math.min(...xs) : 0;
  const c1 = xs.length ? Math.max(...xs) : 0;
  const r0 = ys.length ? Math.min(...ys) : 0;
  const r1 = ys.length ? Math.max(...ys) : 0;
  const m = 60;
  const bounds = { x: (c0 - 0.5) * PITCH_X - m, y: (r0 - 0.5) * PITCH_Y - m, w: (c1 - c0 + 1) * PITCH_X + 2 * m, h: (r1 - r0 + 1) * PITCH_Y + 2 * m };
  return { nodes, zones, traces, endpoints, bounds };
}

/** Zonas dos grupos: cobrem as células dos componentes de dentro (em qualquer nível); quanto mais fundo, mais recuo. */
function groupZones(doc: Doc, nodes: Map<string, BoardNode>): BoardZone[] {
  const groups = new Map(doc.groups.map((g) => [g.id, g]));
  const depthOf = (g: GroupEl): number => {
    let d = 0;
    for (let p = g.parent ? groups.get(g.parent) : undefined; p && d < 20; p = p.parent ? groups.get(p.parent) : undefined) d++;
    return d;
  };
  const inside = (n: NodeEl, gid: string) => {
    for (let p = n.parent, k = 0; p && k < 20; p = groups.get(p)?.parent, k++) if (p === gid) return true;
    return false;
  };
  const out: BoardZone[] = [];
  for (const g of doc.groups) {
    const cells = doc.nodes.filter((n) => nodes.has(n.id) && inside(n, g.id)).map((n) => nodes.get(n.id)!);
    if (!cells.length) continue;
    const depth = depthOf(g);
    const pad = 10 + depth * 16;
    const c0 = Math.min(...cells.map((c) => c.col));
    const c1 = Math.max(...cells.map((c) => c.col));
    const r0 = Math.min(...cells.map((c) => c.row));
    const r1 = Math.max(...cells.map((c) => c.row));
    const x = (c0 - 0.5) * PITCH_X + pad;
    const y = (r0 - 0.5) * PITCH_Y + pad;
    out.push({ id: g.id, label: g.label, color: g.color, kind: g.kind, depth, x, y, w: (c1 + 0.5) * PITCH_X - pad - x, h: (r1 + 0.5) * PITCH_Y - pad - y });
  }
  return out.sort((a, b) => a.depth - b.depth);
}

/** Face de saída de uma trilha num componente. */
type Side = "l" | "r" | "t" | "b";
interface Plan {
  conn: ConnectionEl;
  a: BoardNode;
  b: BoardNode;
  sa: Side;
  sb: Side;
  /** canais usados, em ordem: "v:<x>" (vertical, entre colunas) ou "h:<y>" (horizontal, entre linhas) */
  channels: string[];
}

/**
 * Plano de uma trilha: faces de saída e chegada e os canais por onde ela corre.
 * - Colunas diferentes: sai pela lateral voltada para o destino, desce (ou sobe) pelo canal vertical ao lado da origem
 *   até o canal horizontal junto do destino, corre por ele até o canal vertical ao lado do destino e entra pela lateral.
 * - Mesma coluna: sai por cima ou por baixo e contorna pelo canal vertical à direita da coluna.
 */
function plan(conn: ConnectionEl, a: BoardNode, b: BoardNode): Plan {
  const dc = sign(b.col - a.col);
  const dr = sign(b.row - a.row);
  if (dc) {
    const chA = a.col + dc * 0.5;
    const chB = b.col - dc * 0.5;
    const channels = [`v:${chA}`];
    if (chA !== chB) {
      // a mesma linha: corre pelo canal de baixo; linhas diferentes: pelo canal junto do destino, do lado da origem
      const h = dr ? b.row - dr * 0.5 : a.row + 0.5;
      channels.push(`h:${h}`, `v:${chB}`);
    }
    return { conn, a, b, sa: dc > 0 ? "r" : "l", sb: dc > 0 ? "l" : "r", channels };
  }
  const hA = a.row + dr * 0.5;
  const hB = b.row - dr * 0.5;
  const channels = hA === hB ? [`h:${hA}`] : [`h:${hA}`, `v:${a.col + 0.5}`, `h:${hB}`];
  return { conn, a, b, sa: dr > 0 ? "b" : "t", sb: dr > 0 ? "t" : "b", channels };
}

function routeAll(conns: ConnectionEl[], all: NodeEl[], nodes: Map<string, BoardNode>): BoardTrace[] {
  // um endpoint liga pelo componente dono
  const owner = new Map(all.filter((n) => n.owner && n.kind === "endpoint").map((n) => [n.id, n.owner!]));
  const at = (id: string) => nodes.get(owner.get(id) ?? id);
  const plans: Plan[] = [];
  for (const c of conns) {
    const a = at(c.from);
    const b = at(c.to);
    if (!a || !b || a === b) continue;
    plans.push(plan(c, a, b));
  }

  // pistas: as trilhas de um mesmo canal lado a lado, centradas no meio do canal
  const lanes = new Map<string, Plan[]>();
  for (const p of plans) for (const ch of new Set(p.channels)) lanes.set(ch, [...(lanes.get(ch) ?? []), p]);
  const laneOff = (ch: string, p: Plan) => {
    const list = lanes.get(ch)!;
    return (list.indexOf(p) - (list.length - 1) / 2) * LANE;
  };
  const chPos = (ch: string, p: Plan) => {
    const v = Number(ch.slice(2));
    return (ch[0] === "v" ? v * PITCH_X : v * PITCH_Y) + laneOff(ch, p);
  };

  // pinos: as trilhas que saem pela mesma face, espalhadas ao longo dela (ordenadas pela posição da outra ponta,
  // para não se cruzarem logo na saída)
  const faces = new Map<string, { p: Plan; end: "a" | "b" }[]>();
  for (const p of plans) {
    faces.set(`${p.a.id}|${p.sa}`, [...(faces.get(`${p.a.id}|${p.sa}`) ?? []), { p, end: "a" }]);
    faces.set(`${p.b.id}|${p.sb}`, [...(faces.get(`${p.b.id}|${p.sb}`) ?? []), { p, end: "b" }]);
  }
  const pinOff = new Map<string, number>();
  for (const [key, list] of faces) {
    const [id, side] = key.split("|") as [string, Side];
    const n = nodes.get(id)!;
    const horizontal = side === "l" || side === "r";
    const other = (x: { p: Plan; end: "a" | "b" }) => (x.end === "a" ? x.p.b : x.p.a);
    list.sort((u, v) => (horizontal ? other(u).y - other(v).y : other(u).x - other(v).x) || (u.p.conn.id < v.p.conn.id ? -1 : 1));
    const half = (horizontal ? n.hd : n.hw) * 0.7;
    const step = list.length > 1 ? Math.min(PIN, (2 * half) / (list.length - 1)) : 0;
    list.forEach((x, i) => pinOff.set(`${x.p.conn.id}|${x.end}`, (i - (list.length - 1) / 2) * step));
  }
  const pin = (n: BoardNode, side: Side, off: number): Pt =>
    side === "l" ? { x: n.x - n.hw, y: n.y + off } : side === "r" ? { x: n.x + n.hw, y: n.y + off } : side === "t" ? { x: n.x + off, y: n.y - n.hd } : { x: n.x + off, y: n.y + n.hd };

  return plans.map((p) => {
    const S = pin(p.a, p.sa, pinOff.get(`${p.conn.id}|a`) ?? 0);
    const E = pin(p.b, p.sb, pinOff.get(`${p.conn.id}|b`) ?? 0);
    // anda alternando eixos: cada canal fixa uma coordenada; a saída e a entrada fixam as das pontas
    const pts: Pt[] = [S];
    let cur = { ...S };
    for (const ch of p.channels) {
      const v = chPos(ch, p);
      cur = ch[0] === "v" ? { x: v, y: cur.y } : { x: cur.x, y: v };
      pts.push(cur);
    }
    const last = p.channels[p.channels.length - 1];
    pts.push(last[0] === "v" ? { x: cur.x, y: E.y } : { x: E.x, y: cur.y }, E);
    return { id: p.conn.id, from: p.conn.from, to: p.conn.to, pts: chamfer(simplify(pts)) };
  });
}

/** passo usado no 2D quando a célula de destino fica fora das linhas e colunas que já existem */
const STEP_2D_X = 264;
const STEP_2D_Y = 162;

/**
 * Mover um componente para outra célula da placa, em ops do diagrama (o 3D não tem posição própria: ela sai do 2D).
 * - A posição 2D vem das linhas e colunas existentes (a média dos centros de quem já está nelas), então o componente cai
 *   exatamente naquela célula; fora da grade, um passo além da última.
 * - Célula ocupada: os dois trocam de lugar.
 * - Dentro de uma zona, passa a ser do grupo dela (o mais interno); fora de todas, continua no grupo em que estava.
 * - Os endpoints do componente vão junto.
 */
export function moveOps(doc: Doc, L: BoardLayout, id: string, col: number, row: number): Op[] {
  const me = L.nodes.get(id);
  const node = doc.nodes.find((n) => n.id === id);
  if (!me || !node || (me.col === col && me.row === row)) return [];
  const center = (n: NodeEl) => ({ x: n.x + n.w / 2, y: n.y + n.h / 2 });
  const byId = new Map(doc.nodes.map((n) => [n.id, n]));
  const others = [...L.nodes.values()].filter((b) => b.id !== id);
  const axis = (key: "col" | "row", c: "x" | "y", step: number) => {
    const known = new Map<number, number[]>();
    for (const b of others) known.set(b[key], [...(known.get(b[key]) ?? []), center(byId.get(b.id)!)[c]]);
    const mean = new Map([...known].map(([k, v]) => [k, v.reduce((s, x) => s + x, 0) / v.length]));
    return (i: number) => {
      if (mean.has(i)) return mean.get(i)!;
      const keys = [...mean.keys()].sort((a, b) => a - b);
      const lo = keys.filter((k) => k < i).pop();
      const hi = keys.find((k) => k > i);
      if (lo !== undefined && hi !== undefined) return mean.get(lo)! + ((mean.get(hi)! - mean.get(lo)!) * (i - lo)) / (hi - lo);
      if (lo !== undefined) return mean.get(lo)! + (i - lo) * step;
      if (hi !== undefined) return mean.get(hi)! - (hi - i) * step;
      return center(node)[c];
    };
  };
  const colX = axis("col", "x", STEP_2D_X);
  const rowY = axis("row", "y", STEP_2D_Y);

  // grupo de destino: a zona mais interna que cobre a célula (sem contar a própria zona só dele, que vai junto)
  const px = col * PITCH_X;
  const py = row * PITCH_Y;
  const zone = L.zones.filter((z) => px > z.x && px < z.x + z.w && py > z.y && py < z.y + z.h).sort((a, b) => b.depth - a.depth)[0];
  const parent = zone ? zone.id : node.parent;

  const ops: Op[] = [];
  const place = (n: NodeEl, cx: number, cy: number, parent: string | undefined) => {
    const dx = Math.round(cx - n.w / 2) - n.x;
    const dy = Math.round(cy - n.h / 2) - n.y;
    ops.push({ op: "update", id: n.id, patch: { x: n.x + dx, y: n.y + dy, parent } });
    for (const e of doc.nodes) if (e.owner === n.id) ops.push({ op: "update", id: e.id, patch: { x: e.x + dx, y: e.y + dy } });
  };
  const there = others.find((b) => b.col === col && b.row === row);
  if (there) {
    // troca: quem estava lá vai para o lugar exato (no 2D) de onde o componente saiu, no grupo dele
    const other = byId.get(there.id)!;
    const from = center(node);
    place(other, from.x, from.y, node.parent);
    const to = center(other);
    place(node, to.x, to.y, zone ? zone.id : other.parent);
    return ops;
  }
  place(node, colX(col), rowY(row), parent);
  return ops;
}

/** Tira pontos repetidos e os do meio de trechos retos. */
export function simplify(pts: Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.x - p.x) < 0.01 && Math.abs(last.y - p.y) < 0.01) continue;
    if (out.length >= 2) {
      const a = out[out.length - 2];
      const b = last;
      if ((Math.abs(a.x - b.x) < 0.01 && Math.abs(b.x - p.x) < 0.01) || (Math.abs(a.y - b.y) < 0.01 && Math.abs(b.y - p.y) < 0.01)) out.pop();
    }
    out.push(p);
  }
  return out;
}

/** Corta cada canto a 45° (o corte nunca passa da metade dos trechos vizinhos). */
export function chamfer(pts: Pt[], size = CHAMFER): Pt[] {
  if (pts.length < 3) return pts;
  const out: Pt[] = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) {
    const [a, p, b] = [pts[i - 1], pts[i], pts[i + 1]];
    const la = Math.hypot(a.x - p.x, a.y - p.y);
    const lb = Math.hypot(b.x - p.x, b.y - p.y);
    const c = Math.min(size, la / 2, lb / 2);
    if (c < 0.5) {
      out.push(p);
      continue;
    }
    out.push({ x: p.x + ((a.x - p.x) / la) * c, y: p.y + ((a.y - p.y) / la) * c }, { x: p.x + ((b.x - p.x) / lb) * c, y: p.y + ((b.y - p.y) / lb) * c });
  }
  out.push(pts[pts.length - 1]);
  return out;
}
