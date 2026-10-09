import type { Pt } from "./geometry";

export const INK_COLORS = [
  { id: "#e5484d", name: "Vermelho" },
  { id: "#f08c00", name: "Laranja" },
  { id: "#facc15", name: "Amarelo" },
  { id: "#14a38b", name: "Verde" },
  { id: "#2f80ed", name: "Azul" },
  { id: "#a855f7", name: "Roxo" },
];

export const PEN_WIDTHS = [2, 4, 8, 14];
export const HL_WIDTHS = [14, 22, 34];
export const DASHES: { id: "solid" | "dashed" | "dotted"; name: string }[] = [
  { id: "solid", name: "Contínuo" },
  { id: "dashed", name: "Tracejado" },
  { id: "dotted", name: "Pontilhado" },
];

/** Atributos SVG de um traço (cor, espessura, traçado, opacidade). */
export function strokeAttrs(k: { kind: "pen" | "highlight"; color: string; width: number; dash?: "solid" | "dashed" | "dotted"; opacity?: number }) {
  const w = k.width;
  return {
    stroke: k.color,
    strokeWidth: w,
    strokeOpacity: k.opacity ?? (k.kind === "highlight" ? 0.38 : 1),
    strokeLinecap: (k.dash === "dotted" || k.kind !== "highlight" ? "round" : "butt") as "round" | "butt",
    strokeLinejoin: "round" as const,
    strokeDasharray: k.dash === "dashed" ? `${w * 3} ${w * 2}` : k.dash === "dotted" ? `0.01 ${w * 2}` : undefined,
  };
}

/** Caminho suave (curvas quadráticas entre pontos médios). */
export function inkPath(pts: Pt[]) {
  if (pts.length === 1) return `M${pts[0].x},${pts[0].y}h0.01`;
  let d = `M${pts[0].x},${pts[0].y}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const m = { x: (pts[i].x + pts[i + 1].x) / 2, y: (pts[i].y + pts[i + 1].y) / 2 };
    d += `Q${pts[i].x},${pts[i].y} ${m.x},${m.y}`;
  }
  const l = pts[pts.length - 1];
  return d + `L${l.x},${l.y}`;
}
