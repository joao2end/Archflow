/**
 * Desenho à mão via MCP (`draw`): converte primitivas (linha, seta, retângulo, elipse, polígono, mão livre,
 * sublinhado) em traços `InkStroke`, os mesmos da caneta do quadro. Determinístico; só depende de `schema.ts`.
 *
 * O quadro suaviza o traço com curvas entre pontos médios; repetir um vértice deixa o canto vivo.
 */
import type { Doc, InkStroke } from "./schema";

type Pt = { x: number; y: number };
type Box = { x: number; y: number; w: number; h: number };

export const DRAW_KINDS = ["line", "arrow", "rect", "ellipse", "polygon", "freehand", "underline"] as const;
export type DrawKind = (typeof DRAW_KINDS)[number];

export interface DrawSpec {
  type: DrawKind;
  /** line/arrow: [início, fim] (ou mais pontos: polilinha) · polygon: vértices · freehand: o traçado */
  points?: Pt[];
  /** rect/ellipse/underline: a caixa, quando não há `around` */
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  /** rect/ellipse/underline: id de um componente, grupo ou nota; a caixa vem dele (com folga `pad`) */
  around?: string;
  pad?: number;
  color?: string;
  width?: number;
  dash?: "solid" | "dashed" | "dotted";
  /** marca-texto: largo e translúcido */
  highlight?: boolean;
  /** arrow: ponta também no início */
  both?: boolean;
}

const COLOR = /^#[0-9a-f]{3}([0-9a-f]{3})?$/i;
const r1 = (v: number) => Math.round(v * 10) / 10;
const P = (x: number, y: number): Pt => ({ x: r1(x), y: r1(y) });
/** Cantos vivos: cada vértice do meio aparece duas vezes. */
const sharp = (pts: Pt[]) => pts.flatMap((p, i) => (i === 0 || i === pts.length - 1 ? [p] : [p, p]));

/** Caixa de um elemento do diagrama (nó, grupo ou nota). */
export function elementBox(doc: Doc, id: string): Box | undefined {
  const el = [...doc.nodes, ...doc.groups, ...doc.notes].find((e) => e.id === id);
  return el && { x: el.x, y: el.y, w: el.w, h: el.h };
}

function arrowHead(from: Pt, tip: Pt, size: number): Pt[] {
  const a = Math.atan2(tip.y - from.y, tip.x - from.x);
  const s = 0.45;
  return [P(tip.x - size * Math.cos(a - s), tip.y - size * Math.sin(a - s)), tip, P(tip.x - size * Math.cos(a + s), tip.y - size * Math.sin(a + s))];
}

/** Converte uma primitiva num traço. Devolve o erro (acionável) quando falta algo. */
export function drawToInk(doc: Doc, spec: DrawSpec): { stroke: Omit<InkStroke, "id"> } | { error: string } {
  if (!DRAW_KINDS.includes(spec.type)) return { error: `type inválido "${spec.type}". Válidos: ${DRAW_KINDS.join(", ")}` };
  if (spec.color !== undefined && !COLOR.test(spec.color)) return { error: `color deve ser hexadecimal (ex.: "#e5484d")` };
  const hl = !!spec.highlight;
  const width = spec.width ?? (hl ? 22 : 3);
  if (!(width > 0 && width <= 80)) return { error: "width deve estar entre 0 e 80" };
  const base = { kind: (hl ? "highlight" : "pen") as InkStroke["kind"], color: spec.color ?? (hl ? "#facc15" : "#e5484d"), width, ...(spec.dash && spec.dash !== "solid" ? { dash: spec.dash } : {}), opacity: hl ? 0.38 : 1 };
  const pts = (spec.points ?? []).filter((p) => p && Number.isFinite(p.x) && Number.isFinite(p.y)).map((p) => P(p.x, p.y));

  const box = (): Box | string => {
    if (spec.around) {
      const b = elementBox(doc, spec.around);
      if (!b) return `around: elemento "${spec.around}" não existe`;
      const pad = spec.pad ?? (spec.type === "underline" ? 4 : 12);
      return { x: b.x - pad, y: b.y - pad, w: b.w + pad * 2, h: b.h + pad * 2 };
    }
    if ([spec.x, spec.y, spec.w, spec.h].every((v) => typeof v === "number" && Number.isFinite(v)) && spec.w! > 0 && spec.h! > 0) return { x: spec.x!, y: spec.y!, w: spec.w!, h: spec.h! };
    return `${spec.type} precisa de around (id de um elemento) ou de x, y, w, h`;
  };

  switch (spec.type) {
    case "line":
    case "arrow": {
      if (pts.length < 2) return { error: `${spec.type} precisa de points com pelo menos 2 pontos ({x, y})` };
      if (spec.type === "line") return { stroke: { ...base, pts: sharp(pts) } };
      // a ponta vai no mesmo traçado (ida e volta à ponta): um traço, um id
      const size = Math.max(10, width * 4);
      const [l, tip, r] = arrowHead(pts[pts.length - 2], pts[pts.length - 1], size);
      const tail = spec.both ? arrowHead(pts[1], pts[0], size) : undefined;
      const path = [...(tail ? [tail[0], tail[1], tail[2]] : []), ...pts.slice(0, -1), tip, l, tip, r];
      return { stroke: { ...base, pts: sharp(path) } };
    }
    case "polygon":
      if (pts.length < 3) return { error: "polygon precisa de points com pelo menos 3 vértices" };
      return { stroke: { ...base, pts: sharp([...pts, pts[0]]) } };
    case "freehand":
      if (pts.length < 2) return { error: "freehand precisa de points com pelo menos 2 pontos" };
      return { stroke: { ...base, pts } };
    case "rect": {
      const b = box();
      if (typeof b === "string") return { error: b };
      return { stroke: { ...base, pts: sharp([P(b.x, b.y), P(b.x + b.w, b.y), P(b.x + b.w, b.y + b.h), P(b.x, b.y + b.h), P(b.x, b.y)]) } };
    }
    case "ellipse": {
      const b = box();
      if (typeof b === "string") return { error: b };
      // com `around`, a elipse circunscreve a caixa (√2) para não cortar os cantos do elemento
      const k = spec.around ? Math.SQRT2 : 1;
      const cx = b.x + b.w / 2, cy = b.y + b.h / 2, rx = (b.w / 2) * k, ry = (b.h / 2) * k;
      const n = 48;
      // fecha um pouco além do começo, como quem circula à mão
      const ring = Array.from({ length: n + 3 }, (_, i) => P(cx + rx * Math.cos((i / n) * Math.PI * 2 - Math.PI / 2), cy + ry * Math.sin((i / n) * Math.PI * 2 - Math.PI / 2)));
      return { stroke: { ...base, pts: ring } };
    }
    case "underline": {
      const b = box();
      if (typeof b === "string") return { error: b };
      return { stroke: { ...base, pts: [P(b.x, b.y + b.h), P(b.x + b.w, b.y + b.h)] } };
    }
  }
}
