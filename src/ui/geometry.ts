import { CONNECTION_TYPES, type Box, type ConnectionEl, type Doc, type Routing } from "../shared/schema";

export type Pt = { x: number; y: number };
export type Side = "left" | "right" | "top" | "bottom";

export const center = (b: Box): Pt => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });

export function boxOf(doc: Doc, id: string): Box | undefined {
  return doc.nodes.find((n) => n.id === id) ?? doc.groups.find((g) => g.id === id);
}

export function sidePoint(b: Box, side: Side, offset = 0): Pt {
  switch (side) {
    case "left":
      return { x: b.x, y: b.y + b.h / 2 + offset };
    case "right":
      return { x: b.x + b.w, y: b.y + b.h / 2 + offset };
    case "top":
      return { x: b.x + b.w / 2 + offset, y: b.y };
    case "bottom":
      return { x: b.x + b.w / 2 + offset, y: b.y + b.h };
  }
}

const normal: Record<Side, Pt> = { left: { x: -1, y: 0 }, right: { x: 1, y: 0 }, top: { x: 0, y: -1 }, bottom: { x: 0, y: 1 } };
const opposite: Record<Side, Side> = { left: "right", right: "left", top: "bottom", bottom: "top" };

export function pickSides(a: Box, b: Box): [Side, Side] {
  const ca = center(a);
  const cb = center(b);
  const dx = cb.x - ca.x;
  const dy = cb.y - ca.y;
  // proporção ponderada pelo tamanho para preferir o eixo com mais "folga"
  if (Math.abs(dx) / (a.w + b.w) * 2 >= Math.abs(dy) / (a.h + b.h) * 2) {
    return dx >= 0 ? ["right", "left"] : ["left", "right"];
  }
  return dy >= 0 ? ["bottom", "top"] : ["top", "bottom"];
}

function roundedPoly(pts: Pt[], r = 12): string {
  if (pts.length < 3) return `M${pts[0].x},${pts[0].y} L${pts[pts.length - 1].x},${pts[pts.length - 1].y}`;
  let d = `M${pts[0].x},${pts[0].y}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const p0 = pts[i - 1];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const l1 = Math.hypot(p1.x - p0.x, p1.y - p0.y);
    const l2 = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    const rr = Math.min(r, l1 / 2, l2 / 2);
    const a = { x: p1.x + ((p0.x - p1.x) / (l1 || 1)) * rr, y: p1.y + ((p0.y - p1.y) / (l1 || 1)) * rr };
    const b = { x: p1.x + ((p2.x - p1.x) / (l2 || 1)) * rr, y: p1.y + ((p2.y - p1.y) / (l2 || 1)) * rr };
    d += ` L${a.x},${a.y} Q${p1.x},${p1.y} ${b.x},${b.y}`;
  }
  const last = pts[pts.length - 1];
  return d + ` L${last.x},${last.y}`;
}

export interface EdgeGeom {
  d: string;
  start: Pt;
  end: Pt;
  mid: Pt;
  /** centro do rótulo: `labelT` ao longo do traçado ou, sem ele, o ponto médio */
  label?: Pt;
  /** início, pontos de passagem e fim — base dos puxadores de edição */
  pts?: Pt[];
}

/** Lado do caixa voltado para um ponto qualquer. */
function sideToward(a: Box, p: Pt): Side {
  const c = center(a);
  const dx = p.x - c.x;
  const dy = p.y - c.y;
  if (Math.abs(dx) / a.w >= Math.abs(dy) / a.h) return dx >= 0 ? "right" : "left";
  return dy >= 0 ? "bottom" : "top";
}

/** Spline suave (Catmull-Rom → Bézier cúbica) passando por todos os pontos; tangentes de entrada/saída seguem as normais dos lados. */
function splineThrough(pts: Pt[], na: Pt, nb: Pt): string {
  const first = pts[0];
  const last = pts[pts.length - 1];
  const k0 = Math.max(32, Math.hypot(pts[1].x - first.x, pts[1].y - first.y) * 0.4);
  const k1 = Math.max(32, Math.hypot(last.x - pts[pts.length - 2].x, last.y - pts[pts.length - 2].y) * 0.4);
  // pontos virtuais antes/depois ao longo das normais para definir as tangentes das pontas
  const ext = [{ x: first.x - na.x * k0 * 3, y: first.y - na.y * k0 * 3 }, ...pts, { x: last.x - nb.x * k1 * 3, y: last.y - nb.y * k1 * 3 }];
  let d = `M${first.x},${first.y}`;
  for (let i = 1; i < ext.length - 2; i++) {
    const p0 = ext[i - 1];
    const p1 = ext[i];
    const p2 = ext[i + 1];
    const p3 = ext[i + 2];
    const c1 = { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 };
    const c2 = { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 };
    d += ` C${c1.x},${c1.y} ${c2.x},${c2.y} ${p2.x},${p2.y}`;
  }
  return d;
}

function throughWaypoints(start: Pt, end: Pt, na: Pt, nb: Pt, wps: Pt[], routing: Routing): EdgeGeom {
  const pts = [start, ...wps, end];
  const n = wps.length;
  const mid = n % 2 === 1 ? wps[(n - 1) / 2] : { x: (pts[n / 2].x + pts[n / 2 + 1].x) / 2, y: (pts[n / 2].y + pts[n / 2 + 1].y) / 2 };
  const d = routing === "straight" ? roundedPoly(pts, 0) : routing === "elbow" ? roundedPoly(orthogonal(pts, na), 12) : splineThrough(pts, na, nb);
  return { d, start, end, mid, pts };
}

/** Converte a polilinha em segmentos ortogonais (horizontal/vertical alternados). */
function orthogonal(pts: Pt[], na: Pt): Pt[] {
  const out: Pt[] = [pts[0]];
  let horizontal = na.x !== 0;
  for (let i = 1; i < pts.length; i++) {
    const prev = out[out.length - 1];
    const cur = pts[i];
    if (prev.x !== cur.x && prev.y !== cur.y) out.push(horizontal ? { x: cur.x, y: prev.y } : { x: prev.x, y: cur.y });
    out.push(cur);
    horizontal = !horizontal;
  }
  return out;
}

/** `lane` desloca conexões paralelas entre o mesmo par (em px, perpendicular ao lado). */
export function edgeGeom(a: Box, b: Box, routing: Routing = "curve", lane = 0, waypoints?: Pt[]): EdgeGeom {
  if (waypoints?.length) {
    const sa = sideToward(a, waypoints[0]);
    const sb = sideToward(b, waypoints[waypoints.length - 1]);
    return throughWaypoints(sidePoint(a, sa), sidePoint(b, sb), normal[sa], normal[sb], waypoints, routing);
  }
  const [sa, sb] = pickSides(a, b);
  const start = sidePoint(a, sa, lane);
  const end = sidePoint(b, sb, lane);
  const na = normal[sa];
  const nb = normal[sb];
  return finishGeom(start, end, na, nb, routing);
}

function finishGeom(start: Pt, end: Pt, na: Pt, nb: Pt, routing: Routing): EdgeGeom {
  if (routing === "straight") {
    return { d: `M${start.x},${start.y} L${end.x},${end.y}`, start, end, mid: { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 }, pts: [start, end] };
  }
  if (routing === "elbow") {
    const horizontal = na.x !== 0;
    const pts: Pt[] = [start];
    if (horizontal) {
      const mx = (start.x + end.x) / 2;
      pts.push({ x: mx, y: start.y }, { x: mx, y: end.y });
    } else {
      const my = (start.y + end.y) / 2;
      pts.push({ x: start.x, y: my }, { x: end.x, y: my });
    }
    pts.push(end);
    const mid = horizontal ? { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 } : { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
    return { d: roundedPoly(pts), start, end, mid, pts: [start, end] };
  }
  const dist = Math.hypot(end.x - start.x, end.y - start.y);
  const k = Math.max(48, dist * 0.4);
  const c1 = { x: start.x + na.x * k, y: start.y + na.y * k };
  const c2 = { x: end.x + nb.x * k, y: end.y + nb.y * k };
  // ponto médio da bézier cúbica (t = 0.5)
  const mid = {
    x: 0.125 * start.x + 0.375 * c1.x + 0.375 * c2.x + 0.125 * end.x,
    y: 0.125 * start.y + 0.375 * c1.y + 0.375 * c2.y + 0.125 * end.y,
  };
  return { d: `M${start.x},${start.y} C${c1.x},${c1.y} ${c2.x},${c2.y} ${end.x},${end.y}`, start, end, mid, pts: [start, end] };
}

/** Prévia enquanto arrasta uma conexão de um lado do nó até o cursor. */
export function previewGeom(a: Box, side: Side, to: Pt): EdgeGeom {
  const start = sidePoint(a, side);
  const nb = { x: -normal[side].x, y: -normal[side].y };
  return finishGeom(start, to, normal[side], nb, "curve");
}

export { opposite };

export function contains(b: Box, p: Pt): boolean {
  return p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h;
}

export function intersects(a: Box, b: Box): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

export function normRect(a: Pt, b: Pt): Box {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) };
}

export function contentBounds(doc: Doc): Box | null {
  const all: Box[] = [...doc.nodes, ...doc.groups, ...doc.notes];
  if (!all.length) return null;
  const x1 = Math.min(...all.map((b) => b.x));
  const y1 = Math.min(...all.map((b) => b.y));
  const x2 = Math.max(...all.map((b) => b.x + b.w));
  const y2 = Math.max(...all.map((b) => b.y + b.h));
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

/** Geometria de todas as conexões, com "lanes" para pares repetidos (usada pelo canvas, visualizador e auto-layout). */
export function edgeGeoms(doc: Doc) {
  const pairCount = new Map<string, number>();
  const idx = new Map<string, number>();
  doc.connections.forEach((c) => {
    const k = [c.from, c.to].sort().join("|");
    pairCount.set(k, (pairCount.get(k) ?? 0) + 1);
  });
  return doc.connections.flatMap((c) => {
    const a = boxOf(doc, c.from);
    const b = boxOf(doc, c.to);
    if (!a || !b) return [];
    const k = [c.from, c.to].sort().join("|");
    const i = idx.get(k) ?? 0;
    idx.set(k, i + 1);
    const n = pairCount.get(k)!;
    const lane = n > 1 ? (i - (n - 1) / 2) * 26 : 0;
    const g = edgeGeom(a, b, c.routing, lane, c.waypoints);
    g.label = c.labelT != null ? labelPoint(samplePath(g.d), c.labelT, c.labelOffset) : g.mid;
    return [{ c, g }];
  });
}

/** Texto do rótulo de uma conexão e seu tamanho (compartilhado entre o desenho e o auto-layout). */
export function labelSize(c: ConnectionEl): { text: string; sub?: string; w: number; h: number } | null {
  const text = c.label ?? (c.protocol ? "" : CONNECTION_TYPES[c.type].label);
  const sub = c.protocol;
  if (!(text || sub || c.interface)) return null;
  const w = Math.max(text.length * 6.8, (sub?.length ?? 0) * 5.8) + 22 + (c.interface ? 16 : 0);
  return { text, sub, w, h: sub && text ? 36 : 26 };
}

/** Ponto a `f` (0–1) do comprimento de uma polilinha. */
export function pointAtFraction(pts: Pt[], f: number): Pt {
  if (pts.length < 2) return pts[0] ?? { x: 0, y: 0 };
  const lens = pts.slice(1).map((p, i) => Math.hypot(p.x - pts[i].x, p.y - pts[i].y));
  let want = lens.reduce((s, l) => s + l, 0) * Math.min(1, Math.max(0, f));
  for (let i = 0; i < lens.length; i++) {
    if (want <= lens[i] || i === lens.length - 1) {
      const u = lens[i] ? Math.min(1, want / lens[i]) : 0;
      return { x: pts[i].x + (pts[i + 1].x - pts[i].x) * u, y: pts[i].y + (pts[i + 1].y - pts[i].y) * u };
    }
    want -= lens[i];
  }
  return pts[pts.length - 1];
}

/** Centro do rótulo: ponto a `t` do traçado, deslocado `offset` px na perpendicular. */
export function labelPoint(pts: Pt[], t: number, offset = 0): Pt {
  const p = pointAtFraction(pts, t);
  if (!offset) return p;
  const a = pointAtFraction(pts, Math.max(0, t - 0.02));
  const b = pointAtFraction(pts, Math.min(1, t + 0.02));
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  return { x: p.x - ((b.y - a.y) / len) * offset, y: p.y + ((b.x - a.x) / len) * offset };
}

/** Amostra um path gerado por `edgeGeom` (comandos M, L, C, Q) como polilinha. */
export function samplePath(d: string, steps = 20): Pt[] {
  const out: Pt[] = [];
  const toks = d.match(/[MLCQ]|-?\d*\.?\d+(?:e-?\d+)?/g) ?? [];
  let cmd = "";
  let cur: Pt = { x: 0, y: 0 };
  for (let i = 0; i < toks.length; ) {
    if (/[MLCQ]/.test(toks[i])) cmd = toks[i++];
    const nums = (n: number) => toks.slice(i, (i += n)).map(Number);
    if (cmd === "M" || cmd === "L") {
      const [x, y] = nums(2);
      cur = { x, y };
      out.push(cur);
    } else if (cmd === "Q") {
      const [cx, cy, x, y] = nums(4);
      for (let t = 1; t <= steps; t++) {
        const u = t / steps;
        out.push({ x: (1 - u) ** 2 * cur.x + 2 * (1 - u) * u * cx + u * u * x, y: (1 - u) ** 2 * cur.y + 2 * (1 - u) * u * cy + u * u * y });
      }
      cur = { x, y };
    } else if (cmd === "C") {
      const [c1x, c1y, c2x, c2y, x, y] = nums(6);
      for (let t = 1; t <= steps; t++) {
        const u = t / steps;
        const m = 1 - u;
        out.push({
          x: m ** 3 * cur.x + 3 * m * m * u * c1x + 3 * m * u * u * c2x + u ** 3 * x,
          y: m ** 3 * cur.y + 3 * m * m * u * c1y + 3 * m * u * u * c2y + u ** 3 * y,
        });
      }
      cur = { x, y };
    } else break;
  }
  return out;
}

/** O segmento a→b cruza o retângulo (Liang–Barsky)? */
export function segmentHitsRect(a: Pt, b: Pt, r: Box): boolean {
  let t0 = 0;
  let t1 = 1;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  for (const [p, q] of [
    [-dx, a.x - r.x],
    [dx, r.x + r.w - a.x],
    [-dy, a.y - r.y],
    [dy, r.y + r.h - a.y],
  ]) {
    if (p === 0) {
      if (q < 0) return false;
    } else {
      const t = q / p;
      if (p < 0) {
        if (t > t1) return false;
        if (t > t0) t0 = t;
      } else {
        if (t < t0) return false;
        if (t < t1) t1 = t;
      }
    }
  }
  return true;
}
