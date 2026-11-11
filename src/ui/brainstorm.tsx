import { useEffect, useState } from "react";
import { brainColor, brainMood, isImageSrc, reshapeBrain } from "../shared/brainstorm";
import { BRAIN_COLORS, BRAIN_DATA_HEAD, BRAIN_DATA_SAMPLES, BRAIN_GROUPS, BRAIN_GROUP_KEYS, BRAIN_LINE_KEYS, BRAIN_LINES, BRAIN_MOOD_KEYS, BRAIN_MOODS, BRAIN_SHAPE_KEYS, BRAIN_SHAPES, brainGroup, isBrainData, type BrainConnSpec, type BrainLine, type BrainMood, type BrainNodeSpec, type BrainShape, type ConnectionEl, type NodeEl } from "../shared/schema";
import { Glyph } from "./icons";

type Patch = (p: Record<string, unknown>) => void;

/* ───────── geometria das formas (coordenadas locais: 0..w × 0..h) ───────── */

export interface BrainGeometry {
  /** contorno principal (preenchido e com traço) */
  body: string;
  /** partes extras preenchidas como o corpo (cabeça da pessoa) */
  extra?: string;
  /** só traço (a borda de cima do cilindro) */
  detail?: string;
  /** dobra do post-it */
  fold?: string;
  /** onde o texto cabe */
  text: { x: number; y: number; w: number; h: number; align?: "left" };
  /** passo numerado / custo: o círculo cheio com o número ou o símbolo */
  num?: { cx: number; cy: number; r: number; text?: string };
  /** selo pequeno na cor da forma (?, !, +, −) */
  badge?: { cx: number; cy: number; r: number; text: string };
  /** imagem: onde a foto é desenhada */
  photo?: { x: number; y: number; w: number; h: number };
}

const f = (v: number) => Math.round(v * 10) / 10;

/** Contorno de cada forma para a caixa w × h; o texto vai no retângulo `text`. */
export function brainGeometry(shape: BrainShape, w: number, h: number, mood: BrainMood = "sad"): BrainGeometry {
  const full = { x: 10, y: 6, w: w - 20, h: h - 12 };
  const box = `M10 0H${f(w - 10)}A10 10 0 0 1 ${w} 10V${f(h - 10)}A10 10 0 0 1 ${f(w - 10)} ${h}H10A10 10 0 0 1 0 ${f(h - 10)}V10A10 10 0 0 1 10 0Z`;
  // ícone redondo à esquerda e o texto ao lado (passo, meta, prazo, custo); o ícone não cresce além de ~64 px
  const r = Math.max(8, Math.min(h / 2 - 2, w * 0.3, 32));
  const icon = { cx: r + 2, cy: h / 2, r };
  const beside = { x: r * 2 + 14, y: 4, w: w - r * 2 - 16, h: h - 8, align: "left" as const };
  // selo à esquerda dentro de uma caixa (dúvida, prós e contras)
  const br = Math.max(8, Math.min(12, h / 2 - 6));
  const badged = (text: string): BrainGeometry => ({ body: box, badge: { cx: br + 9, cy: h / 2, r: br, text }, text: { x: br * 2 + 16, y: 4, w: w - br * 2 - 24, h: h - 8, align: "left" } });
  switch (shape) {
    case "box":
      return { body: box, text: full };
    case "round": {
      const r = Math.min(h, w) / 2;
      return { body: `M${f(r)} 0H${f(w - r)}A${f(r)} ${f(r)} 0 0 1 ${f(w - r)} ${h}H${f(r)}A${f(r)} ${f(r)} 0 0 1 ${f(r)} 0Z`, text: { x: r * 0.6, y: 4, w: w - r * 1.2, h: h - 8 } };
    }
    case "circle":
      return { body: `M0 ${f(h / 2)}A${f(w / 2)} ${f(h / 2)} 0 1 1 ${w} ${f(h / 2)}A${f(w / 2)} ${f(h / 2)} 0 1 1 0 ${f(h / 2)}Z`, text: { x: w * 0.15, y: h * 0.15, w: w * 0.7, h: h * 0.7 } };
    case "diamond":
      return { body: `M${f(w / 2)} 0L${w} ${f(h / 2)}L${f(w / 2)} ${h}L0 ${f(h / 2)}Z`, text: { x: w * 0.2, y: h * 0.22, w: w * 0.6, h: h * 0.56 } };
    case "sticky": {
      const k = Math.min(22, w * 0.18, h * 0.18);
      return {
        body: `M0 0H${w}V${f(h - k)}L${f(w - k)} ${h}H0Z`,
        fold: `M${f(w - k)} ${h}L${f(w - k)} ${f(h - k)}L${w} ${f(h - k)}Z`,
        text: { x: 12, y: 10, w: w - 24, h: h - 20 - k / 2 },
      };
    }
    case "cloud": {
      const P = (x: number, y: number) => `${f(x * w)} ${f(y * h)}`;
      return {
        body: `M${P(0.25, 0.9)}C${P(0.06, 0.9)} ${P(0.0, 0.68)} ${P(0.13, 0.57)}C${P(0.03, 0.4)} ${P(0.16, 0.2)} ${P(0.33, 0.27)}C${P(0.37, 0.06)} ${P(0.63, 0.02)} ${P(0.7, 0.21)}C${P(0.85, 0.12)} ${P(1.0, 0.3)} ${P(0.92, 0.48)}C${P(1.03, 0.62)} ${P(0.95, 0.9)} ${P(0.76, 0.88)}C${P(0.68, 0.99)} ${P(0.4, 0.99)} ${P(0.25, 0.9)}Z`,
        text: { x: w * 0.17, y: h * 0.3, w: w * 0.66, h: h * 0.56 },
      };
    }
    case "person": {
      const fig = Math.max(40, h - 36); // a figura ocupa o alto; o nome vai embaixo
      const r = Math.min(w * 0.2, fig * 0.22);
      const cx = w / 2;
      const s = Math.min(w * 0.42, fig * 0.42); // meia largura dos ombros
      const fb = fig;
      const top = r * 2 + 6;
      return {
        extra: `M${f(cx - r)} ${f(r + 2)}A${f(r)} ${f(r)} 0 1 1 ${f(cx + r)} ${f(r + 2)}A${f(r)} ${f(r)} 0 1 1 ${f(cx - r)} ${f(r + 2)}Z`,
        body: `M${f(cx - s)} ${f(fb)}V${f(Math.max(top + s * 0.6, fb - 4))}A${f(s)} ${f(Math.max(4, fb - top))} 0 0 1 ${f(cx + s)} ${f(Math.max(top + s * 0.6, fb - 4))}V${f(fb)}Z`,
        text: { x: 0, y: fb + 2, w, h: h - fb - 2 },
      };
    }
    case "doc": {
      const wv = Math.min(14, h * 0.16);
      return { body: `M0 0H${w}V${f(h - wv)}C${f(w * 0.75)} ${f(h - wv * 2.4)} ${f(w * 0.3)} ${f(h + wv * 0.6)} 0 ${f(h - wv)}Z`, text: { x: 12, y: 6, w: w - 24, h: h - wv - 10 } };
    }
    case "data": {
      const k = Math.min(24, w * 0.15);
      return { body: `M${f(k)} 0H${w}L${f(w - k)} ${h}H0Z`, text: { x: k + 4, y: 6, w: w - 2 * k - 8, h: h - 12 } };
    }
    case "cylinder": {
      const ry = Math.min(14, h * 0.14);
      return {
        body: `M0 ${f(ry)}A${f(w / 2)} ${f(ry)} 0 0 1 ${w} ${f(ry)}V${f(h - ry)}A${f(w / 2)} ${f(ry)} 0 0 1 0 ${f(h - ry)}Z`,
        detail: `M0 ${f(ry)}A${f(w / 2)} ${f(ry)} 0 0 0 ${w} ${f(ry)}`,
        text: { x: 10, y: ry * 2 + 4, w: w - 20, h: h - ry * 3 - 8 },
      };
    }
    case "star": {
      const cx = w / 2;
      const cy = h * 0.53;
      const pts: string[] = [];
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        const k = i % 2 ? 0.48 : 1;
        pts.push(`${f(cx + Math.cos(a) * (w / 2) * k)} ${f(cy + Math.sin(a) * (h * 0.53) * k)}`);
      }
      return { body: `M${pts.join("L")}Z`, text: { x: w * 0.25, y: h * 0.36, w: w * 0.5, h: h * 0.4 } };
    }
    case "image": {
      // moldura com a foto em cima e a legenda numa faixa embaixo
      const cap = Math.min(34, h * 0.3);
      return { body: box, photo: { x: 6, y: 6, w: w - 12, h: h - cap - 6 }, text: { x: 8, y: h - cap, w: w - 16, h: cap } };
    }
    case "step":
      return { body: "", num: icon, text: beside };
    case "problem": {
      // explosão: pontas irregulares em volta do centro
      const pts: string[] = [];
      for (let i = 0; i < 24; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 12;
        const k = i % 2 ? (i % 4 === 1 ? 0.8 : 0.74) : 1;
        pts.push(`${f(w / 2 + Math.cos(a) * (w / 2) * k)} ${f(h / 2 + Math.sin(a) * (h / 2) * k)}`);
      }
      return { body: `M${pts.join("L")}Z`, text: { x: w * 0.2, y: h * 0.25, w: w * 0.6, h: h * 0.5 } };
    }
    case "warning": {
      const br2 = Math.max(7, Math.min(12, h * 0.09));
      return { body: `M${f(w / 2)} 2L${w} ${h}H0Z`, badge: { cx: w / 2, cy: h * 0.33, r: br2, text: "!" }, text: { x: w * 0.25, y: h * 0.5, w: w * 0.5, h: h * 0.46 } };
    }
    case "stop": {
      const k = Math.min(w, h) * 0.29;
      return { body: `M${f(k)} 0H${f(w - k)}L${w} ${f(k)}V${f(h - k)}L${f(w - k)} ${h}H${f(k)}L0 ${f(h - k)}V${f(k)}Z`, text: { x: 10, y: k * 0.55, w: w - 20, h: h - k * 1.1 } };
    }
    case "question":
      return badged("?");
    case "pro":
      return badged("+");
    case "con":
      return badged("−");
    case "idea": {
      const R = Math.max(10, Math.min(w / 2 - 2, (h - 24) / 1.83));
      const cx = w / 2;
      const cy = R + 1;
      const y1 = cy + R * 0.83;
      return {
        body: `M${f(cx - R * 0.55)} ${f(y1)}A${f(R)} ${f(R)} 0 1 1 ${f(cx + R * 0.55)} ${f(y1)}V${f(y1 + 9)}H${f(cx - R * 0.55)}Z`,
        detail: `M${f(cx - R * 0.42)} ${f(y1 + 15)}H${f(cx + R * 0.42)}M${f(cx - R * 0.26)} ${f(y1 + 20)}H${f(cx + R * 0.26)}`,
        text: { x: cx - R * 0.74, y: cy - R * 0.64, w: R * 1.48, h: R * 1.28 },
      };
    }
    case "target":
      return { body: circ(icon.cx, icon.cy, r), detail: `${circ(icon.cx, icon.cy, r * 0.62)}${circ(icon.cx, icon.cy, r * 0.24)}`, text: beside };
    case "clock":
      return { body: circ(icon.cx, icon.cy, r), detail: `M${f(icon.cx)} ${f(icon.cy - r * 0.62)}V${f(icon.cy)}L${f(icon.cx + r * 0.42)} ${f(icon.cy + r * 0.26)}`, text: beside };
    case "money":
      return { body: "", num: { ...icon, text: "$" }, text: beside };
    case "speech": {
      const hb = h - 16;
      return {
        body: `M14 0H${f(w - 14)}A14 14 0 0 1 ${w} 14V${f(hb - 14)}A14 14 0 0 1 ${f(w - 14)} ${f(hb)}H${f(w * 0.34)}L${f(w * 0.13)} ${h}L${f(w * 0.2)} ${f(hb)}H14A14 14 0 0 1 0 ${f(hb - 14)}V14A14 14 0 0 1 14 0Z`,
        text: { x: 12, y: 4, w: w - 24, h: hb - 8 },
      };
    }
    case "screen": {
      const hs = h - 20;
      return {
        body: `M8 0H${f(w - 8)}A8 8 0 0 1 ${w} 8V${f(hs - 8)}A8 8 0 0 1 ${f(w - 8)} ${f(hs)}H8A8 8 0 0 1 0 ${f(hs - 8)}V8A8 8 0 0 1 8 0Z`,
        detail: `M${f(w / 2)} ${f(hs)}V${f(h - 3)}M${f(w * 0.3)} ${f(h - 2)}H${f(w * 0.7)}`,
        text: { x: 10, y: 6, w: w - 20, h: hs - 12 },
      };
    }
    case "feeling": {
      const R = Math.max(10, Math.min(w / 2 - 2, (h - 28) / 2));
      const cx = w / 2;
      const cy = R + 1;
      const eyes = `M${f(cx - R * 0.34)} ${f(cy - R * 0.3)}V${f(cy - R * 0.1)}M${f(cx + R * 0.34)} ${f(cy - R * 0.3)}V${f(cy - R * 0.1)}`;
      const frown = `M${f(cx - R * 0.42)} ${f(cy + R * 0.52)}Q${f(cx)} ${f(cy + R * 0.1)} ${f(cx + R * 0.42)} ${f(cy + R * 0.52)}`;
      const mouth = {
        happy: `M${f(cx - R * 0.42)} ${f(cy + R * 0.18)}Q${f(cx)} ${f(cy + R * 0.66)} ${f(cx + R * 0.42)} ${f(cy + R * 0.18)}`,
        neutral: `M${f(cx - R * 0.36)} ${f(cy + R * 0.38)}H${f(cx + R * 0.36)}`,
        sad: frown,
        angry: `${frown}M${f(cx - R * 0.58)} ${f(cy - R * 0.5)}L${f(cx - R * 0.16)} ${f(cy - R * 0.32)}M${f(cx + R * 0.58)} ${f(cy - R * 0.5)}L${f(cx + R * 0.16)} ${f(cy - R * 0.32)}`,
      }[mood];
      return { body: circ(cx, cy, R), detail: eyes + mouth, text: { x: 0, y: R * 2 + 4, w, h: h - R * 2 - 4 } };
    }
    case "json":
    case "list":
    case "tree":
    case "table":
      // cartão com cabeçalho: o título em cima e o dado embaixo (desenhado por BrainDataContent)
      return { body: box, detail: `M0 ${BRAIN_DATA_HEAD}H${w}`, badge: { cx: 17, cy: BRAIN_DATA_HEAD / 2, r: 9, text: BRAIN_SHAPES[shape].badge }, text: { x: 32, y: 0, w: w - 42, h: BRAIN_DATA_HEAD, align: "left" } };
  }
}

const circ = (cx: number, cy: number, r: number) => `M${f(cx - r)} ${f(cy)}a${f(r)} ${f(r)} 0 1 0 ${f(2 * r)} 0a${f(r)} ${f(r)} 0 1 0 ${f(-2 * r)} 0Z`;

/** Linhas do texto da forma (nome e, se couber, a descrição), quebradas na largura disponível. */
export function brainText(label: string, description: string | undefined, box: { w: number; h: number }, wrap: (t: string, chars: number, lines: number) => string[]) {
  const maxLines = Math.max(1, Math.floor(box.h / 18));
  const main = label.trim() ? wrap(label, Math.max(3, Math.floor(box.w / 7.8)), Math.min(4, maxLines)) : [];
  const room = maxLines - main.length;
  const desc = description?.trim() && room > 0 ? wrap(description, Math.max(3, Math.floor(box.w / 6.4)), Math.min(2, room)) : [];
  return { main, desc };
}

/* ───────── formas de dados: JSON, lista, árvore e tabela, desenhadas a partir do texto ───────── */

export { BRAIN_DATA_HEAD } from "../shared/schema";
const DLH = 18; // altura de linha do conteúdo
const DCH = 7.3; // largura média de um caractere monoespaçado em 12px
const cut = (t: string, max: number) => (t.length > Math.max(1, max) ? t.slice(0, Math.max(1, max - 1)) + "…" : t);
const indentOf = (l: string) => (l.match(/^[ \t]*/)![0].replace(/\t/g, "  ").length);

/** Área onde o conteúdo é desenhado (abaixo do cabeçalho). */
export const brainDataArea = (w: number, h: number) => ({ x: 10, y: BRAIN_DATA_HEAD + 6, w: Math.max(10, w - 20), h: Math.max(DLH, h - BRAIN_DATA_HEAD - 10) });

/** Uma linha do JSON formatado; `path` marca a abertura de um objeto/array (que pode ser recolhido). */
type JsonRow = { ind: number; text: string; path?: string; open?: boolean };

/** O JSON formatado (um nível de indentação por objeto/array), com os trechos de `folded` recolhidos numa linha só. Texto que não é JSON válido aparece como veio. */
export function jsonRows(content: string, folded: ReadonlySet<string> = new Set()): { rows: JsonRow[]; valid: boolean } {
  let v: unknown;
  try {
    v = JSON.parse(content);
  } catch {
    return { rows: content.split("\n").map((l) => ({ ind: Math.floor(indentOf(l) / 2), text: l.trim() })), valid: !content.trim() };
  }
  const rows: JsonRow[] = [];
  const walk = (x: unknown, key: string | null, path: string, ind: number, comma: boolean) => {
    const pre = key === null ? "" : `${JSON.stringify(key)}: `;
    const c = comma ? "," : "";
    if (!x || typeof x !== "object") return void rows.push({ ind, text: pre + JSON.stringify(x) + c });
    const arr = Array.isArray(x);
    const entries: [string, unknown][] = arr ? x.map((y, i) => [String(i), y]) : Object.entries(x);
    const [o, cl] = arr ? ["[", "]"] : ["{", "}"];
    if (!entries.length) return void rows.push({ ind, text: pre + o + cl + c });
    if (folded.has(path)) {
      const n = entries.length;
      return void rows.push({ ind, text: `${pre}${o} … ${n} ${arr ? (n === 1 ? "item" : "itens") : n === 1 ? "chave" : "chaves"} ${cl}${c}`, path, open: false });
    }
    rows.push({ ind, text: pre + o, path, open: true });
    entries.forEach(([k, y], i) => walk(y, arr ? null : k, arr ? `${path}[${k}]` : `${path}.${k}`, ind + 1, i < entries.length - 1));
    rows.push({ ind, text: cl + c });
  };
  walk(v, null, "$", 0, false);
  return { rows, valid: true };
}

/** Níveis de cada linha da árvore (degraus de 2 espaços; um salto maior que um nível conta como um só). */
function treeDepths(raw: string[]): number[] {
  const base = Math.min(...raw.map(indentOf));
  const depth: number[] = [];
  raw.forEach((l, i) => depth.push(i === 0 ? 0 : Math.min(Math.floor((indentOf(l) - base) / 2), depth[i - 1] + 1)));
  return depth;
}

/** Tudo o que pode ser recolhido numa forma json/tree ("Recolher tudo"); a raiz do JSON fica aberta. */
export function foldablePaths(shape: BrainShape, content: string): string[] {
  if (shape === "json") return jsonRows(content).rows.flatMap((r) => (r.path && r.path !== "$" ? [r.path] : []));
  if (shape !== "tree") return [];
  const raw = content.split("\n").filter((l) => l.trim());
  const d = treeDepths(raw);
  return raw.flatMap((_, i) => (d[i + 1] > d[i] ? [`t${i}`] : []));
}

/** Seta de recolher/expandir um trecho: clicável no quadro (o Canvas trata `data-role="brain-fold"`). */
function FoldToggle({ id, path, open, x, y }: { id: string; path: string; open: boolean; x: number; y: number }) {
  return (
    <g className="brain-toggle" data-role="brain-fold" data-id={id} data-path={path} transform={`translate(${x},${y})`} pointerEvents="all">
      <title>{open ? "Recolher" : "Expandir"}</title>
      <rect x={-7} y={-8} width={14} height={16} fill="transparent" />
      <path d={open ? "M-3.5 -1.8H3.5L0 2.6Z" : "M-1.6 -3.6L2.6 0L-1.6 3.6Z"} />
    </g>
  );
}

const JSON_TOKEN = /("(?:[^"\\]|\\.)*")(\s*:)?|\b(true|false|null)\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g;

function JsonLine({ text, x, y }: { text: string; x: number; y: number }) {
  const parts: { t: string; c?: string }[] = [];
  let last = 0;
  for (const m of text.matchAll(JSON_TOKEN)) {
    if (m.index! > last) parts.push({ t: text.slice(last, m.index) });
    parts.push({ t: m[1] ?? m[0], c: m[1] ? (m[2] ? "k" : "s") : m[3] ? "b" : "n" });
    if (m[2]) parts.push({ t: m[2] });
    last = m.index! + m[0].length;
  }
  if (last < text.length) parts.push({ t: text.slice(last) });
  return (
    <text className="brain-data-text" x={x} y={y}>
      {parts.map((p, i) => (
        <tspan key={i} className={p.c ? `dj-${p.c}` : undefined}>
          {p.t}
        </tspan>
      ))}
    </text>
  );
}

/** Uma tabela a partir do texto: separador detectado na 1ª linha (| tab ; ,); linhas de traços do Markdown são ignoradas. */
export function tableRows(content: string): string[][] {
  const lines = content.split("\n").filter((l) => l.trim() && !/^\s*\|?\s*:?-{2,}/.test(l));
  if (!lines.length) return [];
  const first = lines[0];
  const sep = first.includes("|") ? "|" : first.includes("\t") ? "\t" : first.includes(";") ? ";" : ",";
  return lines.map((l) => {
    let cells = l.split(sep).map((c) => c.trim());
    if (sep === "|") {
      if (cells[0] === "") cells = cells.slice(1);
      if (cells[cells.length - 1] === "") cells = cells.slice(0, -1);
    }
    return cells;
  });
}

/** Seta no canto do cabeçalho que recolhe o card inteiro (só o título) ou o abre de volta. */
export function BrainCollapseToggle({ id, w, collapsed }: { id: string; w: number; collapsed: boolean }) {
  return (
    <g className="brain-toggle" data-role="brain-collapse" data-id={id} transform={`translate(${w - 15},${BRAIN_DATA_HEAD / 2})`} pointerEvents="all">
      <title>{collapsed ? "Expandir o card" : "Recolher o card"}</title>
      <rect x={-10} y={-10} width={20} height={20} rx={5} fill="transparent" />
      <path d={collapsed ? "M-2 -4.5L3 0L-2 4.5Z" : "M-4.5 -2H4.5L0 3Z"} />
    </g>
  );
}

/** Conteúdo de uma forma de dados (coordenadas locais da forma). */
export function BrainDataContent({ id, shape, content, folded, w, h }: { id: string; shape: BrainShape; content: string; folded?: string[]; w: number; h: number }) {
  const fold = new Set(folded);
  const a = brainDataArea(w, h);
  const maxChars = Math.floor(a.w / DCH);
  const fit = Math.max(1, Math.floor(a.h / DLH));
  const more = (n: number, y: number) => (
    <text className="brain-data-more" x={a.x} y={y}>
      … +{n} {n === 1 ? "linha" : "linhas"}
    </text>
  );
  if (!content.trim()) {
    return (
      <text className="brain-data-more" x={a.x} y={a.y + DLH / 2}>
        vazio: dê duplo clique para escrever
      </text>
    );
  }
  if (shape === "json") {
    const { rows, valid } = jsonRows(content, fold);
    const shown = rows.length > fit ? rows.slice(0, fit - 1) : rows;
    const gut = 10; // calha das setas de recolher
    return (
      <g pointerEvents="none">
        {shown.map((r, i) => {
          const x = a.x + gut + r.ind * 2 * DCH;
          const y = a.y + DLH / 2 + i * DLH;
          return (
            <g key={i}>
              {r.path && valid && <FoldToggle id={id} path={r.path} open={!!r.open} x={x - 7} y={y} />}
              <JsonLine text={cut(r.text, maxChars - r.ind * 2 - 2)} x={x} y={y} />
            </g>
          );
        })}
        {rows.length > fit && more(rows.length - shown.length, a.y + DLH / 2 + shown.length * DLH)}
        {!valid && (
          <text className="brain-data-warn" x={w - 30} y={BRAIN_DATA_HEAD / 2}>
            JSON inválido
          </text>
        )}
      </g>
    );
  }
  if (shape === "list") {
    const items = content.split("\n").filter((l) => l.trim());
    const shown = items.length > fit ? items.slice(0, fit - 1) : items;
    return (
      <g pointerEvents="none">
        {shown.map((l, i) => {
          const x = a.x + Math.floor(indentOf(l) / 2) * 14;
          const y = a.y + DLH / 2 + i * DLH;
          const t = l.trim();
          const num = t.match(/^(\d+[.)])\s*(.*)$/);
          const body = num ? num[2] : t.replace(/^[-*•]\s*/, "");
          return (
            <g key={i}>
              {num ? (
                <text className="brain-data-num" x={x} y={y}>
                  {num[1]}
                </text>
              ) : (
                <circle className="brain-data-dot" cx={x + 3} cy={y} r={2.6} />
              )}
              <text className="brain-data-text sans" x={x + (num ? 18 : 12)} y={y}>
                {cut(body, Math.floor((a.w - (x - a.x) - 14) / 6.9))}
              </text>
            </g>
          );
        })}
        {items.length > fit && more(items.length - shown.length, a.y + DLH / 2 + shown.length * DLH)}
      </g>
    );
  }
  if (shape === "tree") {
    const all = content.split("\n").filter((l) => l.trim());
    const allDepth = treeDepths(all);
    // linhas visíveis: os descendentes de um ramo recolhido somem; o ramo mostra quantos esconde
    const vis: { i: number; hidden: number }[] = [];
    for (let i = 0; i < all.length; i++) {
      let j = i + 1;
      while (j < all.length && allDepth[j] > allDepth[i]) j++;
      const folded = fold.has(`t${i}`) && j > i + 1;
      vis.push({ i, hidden: folded ? j - i - 1 : 0 });
      if (folded) i = j - 1;
    }
    const depth = vis.map((v) => allDepth[v.i]);
    const n = Math.min(vis.length, vis.length > fit ? fit - 1 : fit);
    const IND = 16;
    const xs = depth.map((d) => a.x + 6 + d * IND);
    const ys = vis.map((_, k) => a.y + DLH / 2 + k * DLH);
    return (
      <g pointerEvents="none">
        {vis.slice(0, n).map((v, k) => {
          let p = k - 1;
          while (p >= 0 && depth[p] >= depth[k]) p--;
          const parent = allDepth[v.i + 1] > allDepth[v.i];
          const label = all[v.i].trim() + (v.hidden ? ` (+${v.hidden})` : "");
          return (
            <g key={v.i}>
              {p >= 0 && <path className="brain-data-branch" d={`M${xs[p]} ${ys[p] + 5}V${ys[k]}H${xs[k] - 5}`} />}
              {parent ? <FoldToggle id={id} path={`t${v.i}`} open={!v.hidden} x={xs[k]} y={ys[k]} /> : <circle className="brain-data-dot" cx={xs[k]} cy={ys[k]} r={depth[k] === 0 ? 3.4 : 2.6} />}
              <text className={`brain-data-text sans${depth[k] === 0 ? " root" : ""}`} x={xs[k] + 8} y={ys[k]}>
                {cut(label, Math.floor((a.w - (xs[k] - a.x) - 10) / 6.9))}
              </text>
            </g>
          );
        })}
        {vis.length > n && more(vis.length - n, a.y + DLH / 2 + n * DLH)}
      </g>
    );
  }
  // tabela
  const rows = tableRows(content);
  const cols = Math.max(1, ...rows.map((r) => r.length));
  const RH = 22;
  const ty = BRAIN_DATA_HEAD + 4;
  const tw = w - 12;
  const fitRows = Math.max(1, Math.floor((h - ty - 6) / RH));
  const shownRows = rows.length > fitRows ? rows.slice(0, fitRows - 1) : rows;
  // largura de cada coluna proporcional ao texto mais longo dela (entre 3 e 24 caracteres)
  const want = Array.from({ length: cols }, (_, c) => Math.min(24, Math.max(3, ...rows.map((r) => (r[c] ?? "").length))));
  const total = want.reduce((s, v) => s + v, 0);
  const cw = want.map((v) => (v / total) * tw);
  const cx = cw.map((_, c) => 6 + cw.slice(0, c).reduce((s, v) => s + v, 0));
  const bodyH = shownRows.length * RH;
  return (
    <g pointerEvents="none">
      <rect className="brain-data-thead" x={6} y={ty} width={tw} height={RH} rx={4} />
      {shownRows.map((r, i) => (
        <g key={i}>
          {i > 0 && <path className="brain-data-grid" d={`M6 ${ty + i * RH}H${6 + tw}`} />}
          {Array.from({ length: cols }, (_, c) => (
            <text key={c} className={`brain-data-text sans${i === 0 ? " th" : ""}`} x={cx[c] + 6} y={ty + i * RH + RH / 2}>
              {cut(r[c] ?? "", Math.floor((cw[c] - 10) / 6.9))}
            </text>
          ))}
        </g>
      ))}
      {cx.slice(1).map((x, c) => (
        <path key={c} className="brain-data-grid" d={`M${x} ${ty}V${ty + bodyH}`} />
      ))}
      {rows.length > shownRows.length && more(rows.length - shownRows.length, ty + bodyH + RH / 2)}
    </g>
  );
}

/* ───────── Inspetor: forma, cor e número do passo ───────── */

function Swatches({ value, fallback, onPick, label }: { value?: string; fallback: string; onPick: (c: string | undefined) => void; label: string }) {
  const cur = value ?? fallback;
  return (
    <div className="field">
      <span>{label}</span>
      <div className="brain-swatches" role="radiogroup" aria-label={label}>
        {BRAIN_COLORS.map((c) => (
          <button key={c.id} type="button" role="radio" aria-checked={cur.toLowerCase() === c.id} aria-label={c.name} className={`swatch ${cur.toLowerCase() === c.id ? "active" : ""}`} style={{ background: c.id }} onClick={() => onPick(c.id === fallback ? undefined : c.id)} data-tip={c.name} data-tip-pos="top" />
        ))}
      </div>
    </div>
  );
}

/** Imagem: colar uma URL ou escolher um arquivo do computador (embutido no diagrama). */
function ImageSrcField({ brain, set }: { brain: BrainNodeSpec; set: (b: BrainNodeSpec) => void }) {
  const embedded = brain.src?.startsWith("data:");
  const [draft, setDraft] = useState(embedded ? "" : brain.src ?? "");
  const [err, setErr] = useState("");
  useEffect(() => setDraft(brain.src?.startsWith("data:") ? "" : brain.src ?? ""), [brain.src]);
  const apply = (v: string) => {
    const t = v.trim();
    if (!t) return;
    if (!isImageSrc(t)) return setErr("Use uma URL http(s) de imagem");
    setErr("");
    set({ ...brain, src: t });
  };
  const pick = (f: File | undefined) => {
    if (!f) return;
    if (f.size > 8e6) return setErr("Imagem acima de 8 MB");
    const r = new FileReader();
    r.onload = () => (setErr(""), set({ ...brain, src: String(r.result) }));
    r.readAsDataURL(f);
  };
  return (
    <div className="field">
      <span>Imagem{embedded ? " (embutida no diagrama)" : ""}</span>
      <input className="input" type="url" placeholder="https://… (cole a URL e Enter)" value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={() => draft !== (brain.src ?? "") && apply(draft)} onKeyDown={(e) => e.key === "Enter" && apply(draft)} aria-invalid={!!err} />
      <input className="input" type="file" accept="image/*" aria-label="Escolher arquivo de imagem" onChange={(e) => pick(e.target.files?.[0])} />
      {err && <div className="callout">{err}</div>}
    </div>
  );
}

export function BrainFields({ node, patch }: { node: NodeEl; patch: Patch }) {
  const brain = node.brain!;
  const color = brainColor(brain);
  const set = (b: BrainNodeSpec) => patch({ brain: b });
  const pick = (s: BrainShape) => {
    if (s === brain.shape) return;
    // o nome padrão da forma acompanha a troca; um texto escrito à mão fica
    const auto = node.label === BRAIN_SHAPES[brain.shape].label || /^Passo \d+$/.test(node.label);
    patch({ brain: reshapeBrain(brain, s), ...(auto ? { label: s === "step" ? `Passo ${brain.step ?? 1}` : BRAIN_SHAPES[s].label } : {}) });
  };
  return (
    <>
      {BRAIN_GROUP_KEYS.map((g) => (
        <div className="field" key={g}>
          <span>{BRAIN_GROUPS[g].replace("Brain Storm · ", "")}</span>
          <div className="brain-shapes" role="radiogroup" aria-label={`Forma: ${BRAIN_GROUPS[g]}`}>
            {BRAIN_SHAPE_KEYS.filter((s) => brainGroup(s) === g).map((s) => (
              <button key={s} type="button" role="radio" aria-checked={brain.shape === s} className={brain.shape === s ? "active" : ""} onClick={() => pick(s)} data-tip={BRAIN_SHAPES[s].hint} data-tip-pos="left">
                <Glyph name={`bs-${s}`} size={22} style={{ color: brain.shape === s ? color : "var(--ink-2)" }} />
                {BRAIN_SHAPES[s].label.split(" /")[0]}
              </button>
            ))}
          </div>
        </div>
      ))}
      <div className="callout">{BRAIN_SHAPES[brain.shape].hint}</div>
      {brain.shape === "step" && (
        <label className="field">
          <span>Número do passo</span>
          <input className="input mono" type="number" min={0} max={999} step={1} value={brain.step ?? 1} onChange={(e) => set({ ...brain, step: Math.max(0, Math.min(999, Math.floor(Number(e.target.value) || 0))) })} />
        </label>
      )}
      {brain.shape === "feeling" && (
        <div className="field">
          <span>Rosto</span>
          <div className="seg" role="radiogroup" aria-label="Rosto">
            {BRAIN_MOOD_KEYS.map((m: BrainMood) => (
              <button key={m} type="button" role="radio" aria-checked={brainMood(brain) === m} className={brainMood(brain) === m ? "active" : ""} onClick={() => set({ ...brain, mood: m })}>
                {BRAIN_MOODS[m]}
              </button>
            ))}
          </div>
        </div>
      )}
      {brain.shape === "image" && <ImageSrcField brain={brain} set={set} />}
      {isBrainData(brain.shape) && (
        <label className="field">
          <span>Conteúdo</span>
          <textarea className="input mono brain-data-input" rows={7} spellCheck={false} placeholder={BRAIN_DATA_SAMPLES[brain.shape]} value={brain.content ?? ""} onChange={(e) => set({ ...brain, content: e.target.value || undefined })} />
        </label>
      )}
      {(brain.shape === "json" || brain.shape === "tree") && (
        <div className="field">
          <span>Trechos (ou clique nas setas da forma)</span>
          <div className="seg">
            <button type="button" onClick={() => { const all = foldablePaths(brain.shape, brain.content ?? ""); const { folded: _, ...rest } = brain; set(all.length ? { ...rest, folded: all } : rest); }}>
              Recolher tudo
            </button>
            <button type="button" disabled={!brain.folded?.length} onClick={() => { const { folded: _, ...rest } = brain; set(rest); }}>
              Expandir tudo
            </button>
          </div>
        </div>
      )}
      <Swatches label="Cor" value={brain.color} fallback={BRAIN_SHAPES[brain.shape].color} onPick={(c) => { const { color: _, ...rest } = brain; set({ ...rest, ...(c ? { color: c } : {}) }); }} />
    </>
  );
}

/* ───────── Inspetor: estilo do traço ───────── */

export const BRAIN_LINE_INK = "#55606e";

/** Cor efetiva do traço: a escolhida, a do estilo (Bloqueia é vermelho) ou grafite. */
export const brainLineColor = (b: BrainConnSpec) => b.color ?? BRAIN_LINES[b.line].color ?? BRAIN_LINE_INK;

export function BrainConnFields({ conn, patch }: { conn: ConnectionEl; patch: Patch }) {
  const b: BrainConnSpec = conn.brain ?? { line: "arrow" };
  const set = (next: BrainConnSpec) => patch({ brain: next });
  return (
    <>
      <div className="field">
        <span>Traço</span>
        <div className="brain-shapes" role="radiogroup" aria-label="Traço">
          {BRAIN_LINE_KEYS.map((l: BrainLine) => {
            const ln = BRAIN_LINES[l];
            const c = b.line === l ? brainLineColor(b) : "var(--ink-2)";
            return (
              <button key={l} type="button" role="radio" aria-checked={b.line === l} className={b.line === l ? "active" : ""} onClick={() => set({ ...b, line: l })} data-tip={ln.hint} data-tip-pos="left">
                <svg viewBox="0 0 34 22" aria-hidden="true">
                  <path d={ln.bar ? "M5 11H28" : "M5 11H29"} stroke={c} strokeWidth={2} strokeDasharray={ln.dash ? (l === "dotted" ? "1.5 4" : "5 4") : undefined} strokeLinecap="round" fill="none" />
                  {ln.bar ? <path d="M29 5V17" stroke={c} strokeWidth={2.6} strokeLinecap="round" /> : ln.head && <path d="M24 6.5L30 11L24 15.5z" fill={c} />}
                  {ln.tail && <path d="M10 6.5L4 11L10 15.5z" fill={c} />}
                </svg>
                {ln.label}
              </button>
            );
          })}
        </div>
      </div>
      <Swatches label="Cor do traço" value={b.color} fallback={BRAIN_LINES[b.line].color ?? BRAIN_LINE_INK} onPick={(c) => set({ line: b.line, ...(c ? { color: c } : {}) })} />
    </>
  );
}
