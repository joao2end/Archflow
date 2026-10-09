import { boxOf, edgeGeoms, samplePath, segmentHitsRect } from "../ui/geometry";
import { BUILTIN_ASSETS, searchAssets } from "./catalog";
import {
  CONNECTION_TYPES,
  ENDPOINT_H,
  ENDPOINT_W,
  GROUP_KINDS,
  NODE_H,
  ENDPOINT_PROTOCOLS,
  NODE_KINDS,
  NODE_W,
  SCHEMA_VERSION,
  emptyDoc,
  endpointBadge,
  endpointLabel,
  type Asset,
  type ConnectionEl,
  type ConnectionType,
  type DiagramRef,
  type Doc,
  type EndpointProtocol,
  type EndpointSpec,
  type GroupEl,
  type GroupKind,
  type InterfaceSpec,
  type NodeEl,
  type NodeKind,
  type Routing,
} from "./schema";

/* ───────────────────────── operações semânticas (UI e MCP usam as mesmas) ───────────────────────── */

export type Op =
  | { op: "add_node"; id?: string; asset?: string; label?: string; kind?: NodeKind; description?: string; technology?: string; parent?: string; props?: Record<string, string>; endpoint?: EndpointSpec; owner?: string; ref?: DiagramRef; x?: number; y?: number }
  | { op: "add_endpoint"; id?: string; owner: string; protocol?: EndpointProtocol; method?: string; path?: string; request?: string; response?: string; auth?: string; label?: string; description?: string }
  | { op: "add_group"; id?: string; label: string; kind?: GroupKind; description?: string; parent?: string; color?: string; x?: number; y?: number; w?: number; h?: number }
  | { op: "add_note"; id?: string; text: string; x?: number; y?: number }
  | { op: "add_connection"; id?: string; from: string; to: string; type?: ConnectionType; label?: string; protocol?: string; description?: string; interface?: InterfaceSpec; routing?: Routing; waypoints?: { x: number; y: number }[]; animated?: boolean }
  | { op: "update"; id: string; patch: Record<string, unknown> }
  | { op: "remove"; id: string }
  | { op: "add_asset"; asset: Partial<Asset> & { name: string } }
  | { op: "layout"; direction?: "LR" | "TB"; spacing?: Spacing; minGap?: number }
  | { op: "set_meta"; title?: string; description?: string }
  | { op: "clear" };

export interface OpResult {
  ok: boolean;
  id?: string;
  error?: string;
}

export function allAssets(doc: Doc): Asset[] {
  const custom = new Map(doc.customAssets.map((a) => [a.id, a]));
  return [...custom.values(), ...BUILTIN_ASSETS.filter((a) => !custom.has(a.id))];
}

export function findAsset(doc: Doc, id?: string): Asset | undefined {
  return id ? allAssets(doc).find((a) => a.id === id) : undefined;
}

export function slug(s: string): string {
  return (
    s
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "item"
  );
}

export function allIds(doc: Doc): Set<string> {
  return new Set([
    ...doc.nodes.map((n) => n.id),
    ...doc.groups.map((n) => n.id),
    ...doc.notes.map((n) => n.id),
    ...doc.connections.map((n) => n.id),
  ]);
}

export function uniqueId(doc: Doc, wanted: string): string {
  const ids = allIds(doc);
  const base = slug(wanted);
  if (!ids.has(base)) return base;
  let i = 2;
  while (ids.has(`${base}-${i}`)) i++;
  return `${base}-${i}`;
}

type Rect = { x: number; y: number; w: number; h: number };
const overlaps = (a: Rect, b: Rect, gap = 24) =>
  a.x < b.x + b.w + gap && a.x + a.w + gap > b.x && a.y < b.y + b.h + gap && a.y + a.h + gap > b.y;

function findFreeSpot(doc: Doc, w: number, h: number, origin = { x: 0, y: 0 }, cols = 4): { x: number; y: number } {
  const taken: Rect[] = [...doc.nodes, ...doc.notes, ...doc.groups.filter((g) => !g.parent)];
  const sx = NODE_W + 56;
  const sy = NODE_H + 56;
  for (let i = 0; i < 400; i++) {
    const c = { x: origin.x + (i % cols) * sx, y: origin.y + Math.floor(i / cols) * sy, w, h };
    if (!taken.some((t) => overlaps(c, t))) return { x: c.x, y: c.y };
  }
  return origin;
}

const PAD = 28;
const TOP = 54;
const EP_GAP = 8;
const EP_INDENT = 28;

/** Endpoints de um serviço, na ordem em que aparecem empilhados abaixo dele. */
export const endpointsOf = (doc: Doc, ownerId: string) => doc.nodes.filter((n) => n.owner === ownerId);
/** Altura extra que a pilha de endpoints ocupa abaixo do serviço. */
export const stackHeight = (doc: Doc, ownerId: string) => {
  const k = endpointsOf(doc, ownerId).length;
  return k ? 10 + k * (ENDPOINT_H + EP_GAP) : 0;
};
function stackPos(doc: Doc, owner: NodeEl): { x: number; y: number } {
  const k = endpointsOf(doc, owner.id).length;
  return { x: owner.x + EP_INDENT, y: owner.y + owner.h + 10 + k * (ENDPOINT_H + EP_GAP) };
}
/** Reposiciona os endpoints de um serviço (usado por layout e ao mover). */
export function restack(doc: Doc, owner: NodeEl) {
  endpointsOf(doc, owner.id).forEach((e, i) => {
    e.x = owner.x + EP_INDENT;
    e.y = owner.y + owner.h + 10 + i * (ENDPOINT_H + EP_GAP);
  });
}

/** Recalcula o retângulo de um grupo `auto` para conter os filhos (e propaga para os ancestrais). */
export function fitGroup(doc: Doc, id: string | undefined) {
  while (id) {
    const g = doc.groups.find((x) => x.id === id);
    if (!g) return;
    const kids: Rect[] = [
      ...doc.nodes.filter((n) => n.parent === id),
      ...doc.groups.filter((n) => n.parent === id),
    ];
    if (g.auto && kids.length) {
      const x1 = Math.min(...kids.map((k) => k.x)) - PAD;
      const y1 = Math.min(...kids.map((k) => k.y)) - TOP;
      const x2 = Math.max(...kids.map((k) => k.x + k.w)) + PAD;
      const y2 = Math.max(...kids.map((k) => k.y + k.h)) + PAD;
      g.x = x1;
      g.y = y1;
      g.w = Math.max(240, x2 - x1);
      g.h = Math.max(140, y2 - y1);
    }
    id = g.parent;
  }
}

export function isContainerOf(doc: Doc, ancestor: string, id: string): boolean {
  let cur = doc.nodes.find((n) => n.id === id)?.parent ?? doc.groups.find((n) => n.id === id)?.parent;
  const guard = new Set<string>();
  while (cur && !guard.has(cur)) {
    if (cur === ancestor) return true;
    guard.add(cur);
    cur = doc.groups.find((n) => n.id === cur)?.parent;
  }
  return false;
}

export function applyOps(input: Doc, ops: Op[]): { doc: Doc; results: OpResult[] } {
  const doc: Doc = structuredClone(input);
  const results: OpResult[] = [];
  const touched = new Set<string>();

  for (const op of ops) {
    try {
      results.push(applyOne(doc, op, touched));
    } catch (e) {
      results.push({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  }
  touched.forEach((g) => fitGroup(doc, g));
  return { doc, results };
}

function applyOne(doc: Doc, op: Op, touched: Set<string>): OpResult {
  switch (op.op) {
    case "add_node": {
      const asset = findAsset(doc, op.asset);
      if (op.asset && !asset) {
        const hint = searchAssets(allAssets(doc), op.asset).slice(0, 5).map((a) => a.id).join(", ");
        return { ok: false, error: `asset "${op.asset}" não existe.${hint ? ` Parecidos: ${hint}.` : ""} Use search_assets ou omita "asset".` };
      }
      if (op.parent && !doc.groups.some((g) => g.id === op.parent)) return { ok: false, error: `parent "${op.parent}" não é um grupo existente` };
      const endpoint: EndpointSpec | undefined = op.endpoint ?? (asset?.endpoint ? { ...asset.endpoint } : undefined);
      const owner = op.owner ? doc.nodes.find((n) => n.id === op.owner) : undefined;
      if (op.owner && !owner) return { ok: false, error: `owner "${op.owner}" não é um componente existente` };
      if (owner && owner.kind === "endpoint") return { ok: false, error: "um endpoint não pode ser dono de outro endpoint" };
      if (op.ref && !op.ref.diagram) return { ok: false, error: "ref.diagram é obrigatório (caminho relativo ao cofre)" };
      const label = op.label ?? (endpoint ? endpointLabel(endpoint) : asset?.name) ?? "Componente";
      const id = uniqueId(doc, op.id ?? (endpoint && owner ? `${owner.id}-${label}` : label));
      const parent = owner ? owner.parent : op.parent && doc.groups.some((g) => g.id === op.parent) ? op.parent : undefined;
      const kind: NodeKind = op.kind ?? (endpoint ? "endpoint" : op.ref ? "system" : asset?.kind ?? "service");
      const isEp = kind === "endpoint";
      const w = isEp ? ENDPOINT_W : NODE_W;
      const h = isEp ? ENDPOINT_H : NODE_H;
      let pos = op.x != null && op.y != null ? { x: op.x, y: op.y } : undefined;
      if (!pos && owner && isEp) pos = stackPos(doc, owner);
      if (!pos) {
        const pg = doc.groups.find((g) => g.id === parent);
        pos = findFreeSpot(doc, w, h, pg ? { x: pg.x + PAD, y: pg.y + TOP } : { x: 0, y: 0 }, pg ? 3 : 4);
      }
      const node: NodeEl = {
        id,
        label,
        kind,
        asset: asset?.id,
        technology: op.technology ?? (!isEp && asset && asset.name !== label && asset.category !== "Genéricos" ? asset.name : undefined),
        description: op.description,
        parent,
        props: op.props,
        endpoint: isEp ? endpoint ?? { protocol: "rest", method: "GET", path: "/resource" } : undefined,
        owner: owner?.id,
        ref: op.ref,
        x: pos.x,
        y: pos.y,
        w,
        h,
      };
      doc.nodes.push(node);
      if (parent) touched.add(parent);
      return { ok: true, id };
    }
    case "add_endpoint": {
      const { op: _o, owner, protocol, method, path, request, response, auth, ...rest } = op;
      return applyOne(doc, { op: "add_node", owner, kind: "endpoint", endpoint: { protocol: protocol ?? "rest", method, path, request, response, auth }, ...rest }, touched);
    }
    case "add_group": {
      if (op.parent && !doc.groups.some((g) => g.id === op.parent)) return { ok: false, error: `parent "${op.parent}" não é um grupo existente` };
      const id = uniqueId(doc, op.id ?? op.label);
      const sized = op.w != null && op.h != null;
      const pos = op.x != null && op.y != null ? { x: op.x, y: op.y } : findFreeSpot(doc, 320, 200, { x: 0, y: 0 }, 3);
      const g: GroupEl = {
        id,
        label: op.label,
        kind: op.kind ?? "boundary",
        description: op.description,
        parent: op.parent,
        color: op.color,
        x: pos.x,
        y: pos.y,
        w: op.w ?? 320,
        h: op.h ?? 200,
        auto: !sized,
      };
      doc.groups.push(g);
      if (op.parent) touched.add(op.parent);
      return { ok: true, id };
    }
    case "add_note": {
      const id = uniqueId(doc, op.id ?? "note");
      const pos = op.x != null && op.y != null ? { x: op.x, y: op.y } : findFreeSpot(doc, 200, 110);
      doc.notes.push({ id, text: op.text, x: pos.x, y: pos.y, w: 200, h: 110 });
      return { ok: true, id };
    }
    case "add_connection": {
      const exists = (id: string) => doc.nodes.some((n) => n.id === id) || doc.groups.some((g) => g.id === id);
      if (!exists(op.from)) return { ok: false, error: `"from" ${op.from} não existe` };
      if (!exists(op.to)) return { ok: false, error: `"to" ${op.to} não existe` };
      const type = op.type ?? "sync";
      if (!CONNECTION_TYPES[type]) return { ok: false, error: `type inválido "${type}". Válidos: ${Object.keys(CONNECTION_TYPES).join(", ")}` };
      const id = uniqueId(doc, op.id ?? `${op.from}-to-${op.to}`);
      const c: ConnectionEl = {
        id,
        from: op.from,
        to: op.to,
        type,
        label: op.label,
        protocol: op.protocol,
        description: op.description,
        interface: op.interface,
        routing: op.routing ?? "curve",
        ...(op.waypoints?.length ? { waypoints: op.waypoints } : {}),
        animated: op.animated ?? true,
      };
      doc.connections.push(c);
      return { ok: true, id };
    }
    case "update": {
      const el: any = [...doc.nodes, ...doc.groups, ...doc.notes, ...doc.connections].find((e) => e.id === op.id);
      if (!el) return { ok: false, error: `elemento "${op.id}" não existe` };
      const { id: _ignore, ...patch } = op.patch as Record<string, unknown>;
      const before = el.parent;
      Object.assign(el, patch);
      if ("parent" in patch) {
        if (el.parent && (!doc.groups.some((g) => g.id === el.parent) || el.parent === el.id || isContainerOf(doc, el.id, el.parent))) {
          el.parent = before;
          return { ok: false, error: "parent inválido" };
        }
        touched.add(el.parent);
        touched.add(before);
      }
      return { ok: true, id: op.id };
    }
    case "remove": {
      const has = allIds(doc).has(op.id);
      if (!has) return { ok: false, error: `elemento "${op.id}" não existe` };
      const gone = new Set([op.id]);
      // endpoints pertencem ao serviço: somem junto com ele
      doc.nodes.filter((n) => n.owner === op.id).forEach((n) => gone.add(n.id));
      const grp = doc.groups.find((g) => g.id === op.id);
      // remover grupo: filhos sobem para o pai do grupo (não apaga conteúdo)
      if (grp) {
        doc.nodes.forEach((n) => n.parent === op.id && (n.parent = grp.parent));
        doc.groups.forEach((g) => g.parent === op.id && (g.parent = grp.parent));
        touched.add(grp.parent as string);
      }
      doc.nodes = doc.nodes.filter((n) => !gone.has(n.id));
      doc.groups = doc.groups.filter((n) => !gone.has(n.id));
      doc.notes = doc.notes.filter((n) => !gone.has(n.id));
      doc.connections = doc.connections.filter((c) => !gone.has(c.id) && !gone.has(c.from) && !gone.has(c.to));
      return { ok: true, id: op.id };
    }
    case "add_asset": {
      const a = op.asset;
      const id = a.id ? slug(a.id) : uniqueId(doc, a.name);
      const asset: Asset = {
        id,
        name: a.name,
        category: a.category ?? "Personalizados",
        vendor: a.vendor,
        kind: a.kind ?? "service",
        icon: a.icon ?? `t:${a.name.slice(0, 3).toUpperCase()}`,
        color: a.color ?? "#706fd3",
        problem: a.problem ?? "",
        description: a.description ?? "",
        tags: a.tags ?? [],
      };
      doc.customAssets = [...doc.customAssets.filter((x) => x.id !== id), asset];
      return { ok: true, id };
    }
    case "layout":
      autoLayout(doc, op.direction ?? "LR", { spacing: op.spacing, minGap: op.minGap });
      return { ok: true };
    case "set_meta":
      if (op.title != null) doc.title = op.title;
      if (op.description != null) doc.description = op.description;
      return { ok: true };
    case "clear": {
      const fresh = emptyDoc(doc.title);
      doc.groups = fresh.groups;
      doc.nodes = fresh.nodes;
      doc.notes = fresh.notes;
      doc.connections = fresh.connections;
      return { ok: true };
    }
  }
}

/* ───────────────────────── auto-layout em camadas ───────────────────────── */

export type Spacing = "compact" | "comfortable" | "spacious";
/** Distância mínima (px) entre componentes vizinhos da mesma camada; entre camadas é o dobro. */
export const SPACING_GAP: Record<Spacing, number> = { compact: 44, comfortable: 80, spacious: 120 };

export function autoLayout(doc: Doc, dir: "LR" | "TB" = "LR", opts: { spacing?: Spacing; minGap?: number } = {}) {
  const GAP_ITEM = Math.max(16, opts.minGap ?? SPACING_GAP[opts.spacing ?? "comfortable"]);
  const GAP_RANK = GAP_ITEM * 2;
  const parentOf = (id: string) => doc.nodes.find((n) => n.id === id)?.parent ?? doc.groups.find((g) => g.id === id)?.parent;
  const rel = new Map<string, { x: number; y: number }>();
  const size = new Map<string, { w: number; h: number }>();

  const members = (pid?: string) => [
    ...doc.groups.filter((g) => g.parent === pid).map((g) => g.id),
    ...doc.nodes.filter((n) => n.parent === pid && !n.owner).map((n) => n.id), // endpoints seguem o serviço dono
  ];
  const ancestorAt = (id: string, level: Set<string>): string | undefined => {
    let cur: string | undefined = doc.nodes.find((n) => n.id === id)?.owner ?? id; // endpoint → serviço dono
    const guard = new Set<string>();
    while (cur && !guard.has(cur)) {
      if (level.has(cur)) return cur;
      guard.add(cur);
      cur = parentOf(cur);
    }
    return undefined;
  };

  function measure(pid?: string): { w: number; h: number } {
    const ids = members(pid);
    for (const id of ids) {
      const g = doc.groups.find((x) => x.id === id);
      if (g) {
        const s = measure(g.id);
        size.set(id, { w: Math.max(240, s.w + PAD * 2), h: Math.max(140, s.h + PAD + TOP) });
      } else {
        const n = doc.nodes.find((x) => x.id === id)!;
        size.set(id, { w: n.w, h: n.h + stackHeight(doc, id) });
      }
    }
    if (!ids.length) return { w: 0, h: 0 };
    const level = new Set(ids);
    const succ = new Map<string, Set<string>>(ids.map((i) => [i, new Set()]));
    for (const c of doc.connections) {
      const a = ancestorAt(c.from, level);
      const b = ancestorAt(c.to, level);
      if (a && b && a !== b) succ.get(a)!.add(b);
    }
    // remove arestas de retorno (DFS) para ranquear em DAG
    const state = new Map<string, number>();
    const dag = new Map<string, string[]>(ids.map((i) => [i, []]));
    const dfs = (u: string) => {
      state.set(u, 1);
      for (const v of succ.get(u)!) {
        if (state.get(v) === 1) continue;
        dag.get(u)!.push(v);
        if (!state.has(v)) dfs(v);
      }
      state.set(u, 2);
    };
    ids.forEach((i) => !state.has(i) && dfs(i));
    const rank = new Map<string, number>(ids.map((i) => [i, 0]));
    for (let it = 0; it < ids.length; it++)
      for (const [u, vs] of dag) for (const v of vs) if (rank.get(v)! < rank.get(u)! + 1) rank.set(v, rank.get(u)! + 1);

    const maxRank = Math.max(...rank.values());
    const cols: string[][] = Array.from({ length: maxRank + 1 }, () => []);
    ids.forEach((i) => cols[rank.get(i)!].push(i));
    // ordenação por baricentro dos predecessores
    const pos = new Map<string, number>();
    cols.forEach((col, r) => {
      if (r > 0) {
        const bary = (id: string) => {
          const preds = ids.filter((p) => dag.get(p)!.includes(id) && pos.has(p));
          return preds.length ? preds.reduce((s, p) => s + pos.get(p)!, 0) / preds.length : 1e9;
        };
        col.sort((a, b) => bary(a) - bary(b));
      }
      col.forEach((id, i) => pos.set(id, i));
    });

    const horizontal = dir === "LR";
    const main = (id: string) => (horizontal ? size.get(id)!.w : size.get(id)!.h);
    const cross = (id: string) => (horizontal ? size.get(id)!.h : size.get(id)!.w);
    const colCross = cols.map((col) => col.reduce((s, id) => s + cross(id), 0) + GAP_ITEM * Math.max(0, col.length - 1));
    const totalCross = Math.max(...colCross);
    let m = 0;
    cols.forEach((col, r) => {
      const colMain = Math.max(...col.map(main));
      let c = (totalCross - colCross[r]) / 2;
      for (const id of col) {
        rel.set(id, horizontal ? { x: m + (colMain - main(id)) / 2, y: c } : { x: c, y: m + (colMain - main(id)) / 2 });
        c += cross(id) + GAP_ITEM;
      }
      m += colMain + GAP_RANK;
    });
    m -= GAP_RANK;
    return horizontal ? { w: m, h: totalCross } : { w: totalCross, h: m };
  }

  function assign(pid: string | undefined, ox: number, oy: number) {
    for (const id of members(pid)) {
      const r = rel.get(id)!;
      const s = size.get(id)!;
      const x = Math.round(ox + r.x);
      const y = Math.round(oy + r.y);
      const g = doc.groups.find((q) => q.id === id);
      if (g) {
        Object.assign(g, { x, y, w: s.w, h: s.h, auto: true });
        assign(id, x + PAD, y + TOP);
      } else {
        const n = doc.nodes.find((q) => q.id === id)!;
        n.x = x;
        n.y = y;
        restack(doc, n);
      }
    }
  }

  measure(undefined);
  assign(undefined, 0, 0);
  avoidCollisions(doc);
}

type Pt = { x: number; y: number };

/**
 * Garante que nenhuma conexão atravesse componentes ou notas que não sejam suas pontas.
 * Pontos de passagem manuais ficam obsoletos após reorganizar, então são recalculados: a rota
 * padrão é mantida quando já está livre; senão procura o menor desvio com 1 ou 2 waypoints.
 */
export function avoidCollisions(doc: Doc, margin = 14) {
  for (const c of doc.connections) delete c.waypoints;
  const isInside = (id: string, ancestor: string) => {
    let cur: string | undefined = id;
    for (let i = 0; cur && i < 30; i++) {
      if (cur === ancestor) return true;
      cur = doc.nodes.find((n) => n.id === cur)?.parent ?? doc.groups.find((g) => g.id === cur)?.parent;
    }
    return false;
  };
  const grow = (r: Rect, m: number): Rect => ({ x: r.x - m, y: r.y - m, w: r.w + m * 2, h: r.h + m * 2 });
  const lengthOf = (pts: Pt[]) => pts.reduce((s, p, i) => (i ? s + Math.hypot(p.x - pts[i - 1].x, p.y - pts[i - 1].y) : 0), 0);

  for (const c of doc.connections) {
    const a = boxOf(doc, c.from);
    const b = boxOf(doc, c.to);
    if (!a || !b) continue;
    const obstacles: Rect[] = [...doc.nodes.filter((n) => n.id !== c.from && n.id !== c.to && !isInside(n.id, c.from) && !isInside(n.id, c.to)), ...doc.notes].map((o) => grow(o, margin));
    if (!obstacles.length) continue;
    const probe = (wps?: Pt[]) => {
      c.waypoints = wps;
      const g = edgeGeoms(doc).find((e) => e.c.id === c.id)!.g; // inclui as lanes de pares repetidos
      c.waypoints = undefined;
      const pts = samplePath(g.d);
      return { hits: obstacles.filter((o) => pts.some((p, i) => i > 0 && segmentHitsRect(pts[i - 1], p, o))), len: lengthOf(pts) };
    };
    const base = probe();
    if (!base.hits.length) continue;

    const ca = { x: a.x + a.w / 2, y: a.y + a.h / 2 };
    const cb = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
    const detour = (p: Pt) => Math.hypot(p.x - ca.x, p.y - ca.y) + Math.hypot(p.x - cb.x, p.y - cb.y);
    const free = (p: Pt) => !obstacles.some((o) => p.x > o.x && p.x < o.x + o.w && p.y > o.y && p.y < o.y + o.h);
    const near = (os: Rect[], limit: number) =>
      os
        .flatMap((o) => {
          const m = 28;
          return [
            { x: o.x - m, y: o.y - m },
            { x: o.x + o.w + m, y: o.y - m },
            { x: o.x - m, y: o.y + o.h + m },
            { x: o.x + o.w + m, y: o.y + o.h + m },
          ];
        })
        .filter(free)
        .sort((p, q) => detour(p) - detour(q))
        .slice(0, limit);

    let best: { wps: Pt[]; len: number } | undefined;
    const consider = (wps: Pt[]) => {
      const r = probe(wps);
      if (!r.hits.length && (!best || r.len < best.len)) best = { wps, len: r.len };
    };
    // 1 waypoint nos cantos dos obstáculos que bloqueiam → 2 waypoints → amplia a busca a todos os obstáculos
    for (const pool of [near(base.hits, 12), near(obstacles, 24)]) {
      for (const p of pool) consider([p]);
      if (best) break;
      for (const p of pool) for (const q of pool) if (p !== q) consider([p, q]);
      if (best) break;
    }
    if (best) c.waypoints = (best as { wps: Pt[] }).wps.map((p) => ({ x: Math.round(p.x), y: Math.round(p.y) }));
  }
}

/* ───────────────────────── validação e descrição para LLMs ───────────────────────── */

export function validate(doc: Doc): string[] {
  const issues: string[] = [];
  const endpoints = new Set([...doc.nodes.map((n) => n.id), ...doc.groups.map((g) => g.id)]);
  const groups = new Set(doc.groups.map((g) => g.id));
  for (const c of doc.connections) {
    if (!endpoints.has(c.from)) issues.push(`connection ${c.id}: "from" ${c.from} não existe`);
    if (!endpoints.has(c.to)) issues.push(`connection ${c.id}: "to" ${c.to} não existe`);
  }
  for (const e of [...doc.nodes, ...doc.groups]) if (e.parent && !groups.has(e.parent)) issues.push(`${e.id}: parent ${e.parent} não existe`);
  const connected = new Set(doc.connections.flatMap((c) => [c.from, c.to]));
  const ids = new Set(doc.nodes.map((n) => n.id));
  for (const n of doc.nodes) {
    if (n.owner && !ids.has(n.owner)) issues.push(`${n.id}: owner ${n.owner} não existe`);
    if (n.kind === "endpoint" && !n.endpoint) issues.push(`${n.id}: endpoint sem definição (protocol/method/path)`);
    if (n.kind === "system" && !n.ref) issues.push(`${n.id}: componente "system" sem ref (aponte para outro diagrama)`);
    if (n.owner || n.kind === "endpoint") continue; // endpoints são expostos pelo serviço dono
    if (!connected.has(n.id)) issues.push(`${n.id}: componente sem nenhuma conexão (isolado)`);
  }
  return issues;
}

const q = (s: string) => s.replace(/"/g, "'");

export function toMermaid(doc: Doc): string {
  const mid = (id: string) => "n_" + id.replace(/[^a-zA-Z0-9]/g, "_");
  const lines = ["flowchart LR"];
  const emit = (pid: string | undefined, indent: string) => {
    for (const g of doc.groups.filter((x) => x.parent === pid)) {
      lines.push(`${indent}subgraph ${mid(g.id)}["${q(g.label)}"]`);
      emit(g.id, indent + "  ");
      lines.push(`${indent}end`);
    }
    for (const n of doc.nodes.filter((x) => x.parent === pid)) {
      const t = n.technology ? `<br/><i>${q(n.technology)}</i>` : "";
      const shape = n.kind === "database" || n.kind === "cache" ? ["[(", ")]"] : n.kind === "queue" || n.kind === "system" ? ["[[", "]]"] : n.kind === "actor" || n.kind === "endpoint" ? ["([", "])"] : ["[", "]"];
      const name = n.kind === "system" && n.ref ? `↗ ${n.label}` : n.label;
      lines.push(`${indent}${mid(n.id)}${shape[0]}"${q(name)}${t}"${shape[1]}`);
    }
  };
  emit(undefined, "  ");
  for (const n of doc.nodes) if (n.owner) lines.push(`  ${mid(n.owner)} -.- ${mid(n.id)}`);
  for (const c of doc.connections) {
    const txt = q([c.label, c.protocol].filter(Boolean).join(" · ") || CONNECTION_TYPES[c.type].label);
    const arrow = c.type === "async" || c.type === "dependency" || c.type === "realization" ? "-.->" : c.type === "stream" ? "==>" : c.type === "association" ? "---" : "-->";
    lines.push(`  ${mid(c.from)} ${arrow}|"${txt}"| ${mid(c.to)}`);
  }
  return lines.join("\n");
}

/** Descrição textual determinística do diagrama — o formato que um LLM deve ler. */
export function describe(doc: Doc): string {
  const L: string[] = [];
  L.push(`# ${doc.title}`);
  if (doc.description) L.push("", doc.description);
  L.push("", `> schema ${SCHEMA_VERSION} · ${doc.nodes.length} componentes · ${doc.groups.length} grupos · ${doc.connections.length} conexões`);

  const label = (id: string) => doc.nodes.find((n) => n.id === id)?.label ?? doc.groups.find((g) => g.id === id)?.label ?? id;

  if (doc.groups.length) {
    L.push("", "## Grupos");
    for (const g of doc.groups) {
      L.push(`- \`${g.id}\` **${g.label}** (${g.kind}: ${GROUP_KINDS[g.kind]})${g.parent ? ` dentro de \`${g.parent}\`` : ""}${g.description ? ` — ${g.description}` : ""}`);
    }
  }
  L.push("", "## Componentes");
  const epLine = (n: NodeEl, indent: string) => {
    const e = n.endpoint;
    if (!e) return;
    const bits = [`${indent}- endpoint \`${endpointLabel(e)}\` (${e.protocol}) id: \`${n.id}\``];
    if (n.description) bits.push(n.description);
    if (e.request) bits.push(`entrada: ${e.request}`);
    if (e.response) bits.push(`saída: ${e.response}`);
    if (e.auth) bits.push(`auth: ${e.auth}`);
    L.push(bits.join(" · "));
  };
  for (const n of doc.nodes) {
    if (n.owner && doc.nodes.some((o) => o.id === n.owner)) continue; // listado sob o dono
    const a = findAsset(doc, n.asset);
    const bits = [`\`${n.id}\` **${n.label}**`, `[${n.kind}]`];
    if (n.technology) bits.push(`tecnologia: ${n.technology}`);
    if (n.parent) bits.push(`em \`${n.parent}\``);
    if (n.ref) bits.push(`REFERENCIA o diagrama \`${n.ref.diagram}\`${n.ref.node ? ` (componente \`${n.ref.node}\`)` : ""}`);
    L.push(`- ${bits.join(" · ")}${n.description ? ` — ${n.description}` : ""}`);
    if (n.kind === "endpoint") epLine(n, "  ");
    if (a?.problem && n.kind !== "endpoint") L.push(`  - papel da tecnologia: ${a.problem}`);
    if (n.props) for (const [k, v] of Object.entries(n.props)) L.push(`  - ${k}: ${v}`);
    doc.nodes.filter((e) => e.owner === n.id).forEach((e) => epLine(e, "  "));
  }
  if (doc.notes.length) {
    L.push("", "## Notas");
    doc.notes.forEach((n) => L.push(`- ${n.text.replace(/\n/g, " ")}`));
  }
  L.push("", "## Conexões");
  for (const c of doc.connections) {
    const t = CONNECTION_TYPES[c.type];
    L.push(`- \`${c.from}\` (${label(c.from)}) **—${c.type}→** \`${c.to}\` (${label(c.to)})${c.label ? ` : "${c.label}"` : ""}${c.protocol ? ` · protocolo ${c.protocol}` : ""}`);
    L.push(`  - semântica: ${t.semantics}`);
    if (c.description) L.push(`  - ${c.description}`);
    if (c.interface) {
      L.push(`  - interface \`${c.interface.name}\` (${c.interface.kind})${c.interface.contract ? ` contrato: ${c.interface.contract}` : ""}`);
      for (const o of c.interface.operations) {
        const sig = [o.method, o.path].filter(Boolean).join(" ");
        L.push(`    - ${o.name}${sig ? ` — \`${sig}\`` : ""}${o.request ? ` · req: ${o.request}` : ""}${o.response ? ` · res: ${o.response}` : ""}${o.description ? ` · ${o.description}` : ""}`);
      }
    }
  }
  const issues = validate(doc);
  if (issues.length) L.push("", "## Avisos", ...issues.map((i) => `- ${i}`));
  L.push("", "## Mermaid", "```mermaid", toMermaid(doc), "```");
  return L.join("\n");
}

export function schemaGuide(): string {
  return [
    `# Archflow ${SCHEMA_VERSION} — guia para LLMs`,
    "",
    "Você edita diagramas de arquitetura de software. Pense em **componentes, grupos e conexões**, nunca em pixels:",
    "o app calcula posições (use a operação `layout`).",
    "",
    "## Tipos de componente (`kind`)",
    ...Object.entries(NODE_KINDS).map(([k, v]) => `- \`${k}\`: ${v}`),
    "",
    "## Tipos de grupo (`kind`)",
    ...Object.entries(GROUP_KINDS).map(([k, v]) => `- \`${k}\`: ${v}`),
    "",
    "## Tipos de conexão (`type`)",
    ...Object.entries(CONNECTION_TYPES).map(([k, v]) => `- \`${k}\` (${v.label}): ${v.semantics}`),
    "",
    "## Endpoints (componentes de comunicação)",
    "Um serviço EXPÕE endpoints. Use `add_endpoints` com `owner` = id do serviço (o endpoint fica preso a ele):",
    ...Object.entries(ENDPOINT_PROTOCOLS).map(([k, v]) => `- \`${k}\`: ${v.semantics}${v.methods.length ? ` method: ${v.methods.join("|")}` : ""}`),
    "`connect` aceita o id de um endpoint em from/to — conecte clientes ao endpoint específico.",
    "",
    "## Referências entre diagramas",
    'Um componente `kind: "system"` com `ref: { diagram, node? }` aponta para OUTRO diagrama do cofre (e opcionalmente para um componente dele).',
    "Use `list_diagrams` e `get_diagram_outline` para descobrir caminhos e ids antes de referenciar.",
    "",
    "## Fluxo recomendado",
    "1. `search_assets` para achar o `asset` certo (ex.: `laravel`, `postgresql`, `aws-sqs`).",
    "2. `add_groups` (fronteiras/camadas) e `add_components` (use `parent` = id do grupo).",
    "3. `connect` com `type`, `label`, `protocol` e, quando relevante, `interface` (operações, payloads).",
    "4. `auto_layout`, depois `get_diagram` (markdown) para revisar os avisos.",
    "",
    "Ids são slugs estáveis (`orders-api`). Reutilize-os em `parent`, `from` e `to`.",
  ].join("\n");
}

export function normalizeDoc(raw: any): Doc {
  const d = emptyDoc(raw?.title ?? "Importado");
  return {
    ...d,
    ...raw,
    schema: SCHEMA_VERSION,
    groups: Array.isArray(raw?.groups) ? raw.groups : [],
    nodes: Array.isArray(raw?.nodes) ? raw.nodes : [],
    notes: Array.isArray(raw?.notes) ? raw.notes : [],
    connections: Array.isArray(raw?.connections) ? raw.connections : [],
    customAssets: Array.isArray(raw?.customAssets) ? raw.customAssets : [],
  };
}
