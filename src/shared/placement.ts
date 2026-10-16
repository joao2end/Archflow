/**
 * Posição livre para um nó novo plugado sob um agente (skills, tools, MCP).
 *
 * Antes o novo nó ia sempre para `agente.x + n * 208`, na linha abaixo do agente, e caía em cima de quem já estava
 * ali (outro agente, outra skill, uma nota). Aqui varremos a linha de baixo para a direita e, se não couber, descemos.
 * Puro: só lê o documento.
 */
import type { Doc } from "./schema";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const NODE_SIZE = { w: 184, h: 72 } as const;

const overlaps = (a: Rect, b: Rect, gap: number) => a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.y < b.y + b.h + gap && b.y < a.y + a.h + gap;
const snap = (v: number) => Math.round(v / 8) * 8;

/** Retângulos que um nó novo não pode cobrir: nós e notas do documento. */
export function occupied(doc: Doc, extra: Rect[] = []): Rect[] {
  return [
    ...doc.nodes.map((n) => ({ x: n.x, y: n.y, w: n.w || NODE_SIZE.w, h: n.h || NODE_SIZE.h })),
    ...doc.notes.map((n) => ({ x: n.x, y: n.y, w: n.w, h: n.h })),
    ...extra,
  ];
}

/**
 * Primeira posição livre sob `from`: começa 96px abaixo do agente, alinhada à esquerda dele, e anda para a direita
 * (uma coluna = largura do nó + `gap`); se a linha estiver cheia (12 colunas), desce uma linha.
 */
export function freeSpotBelow(doc: Doc, from: Rect, size: { w: number; h: number } = NODE_SIZE, gap = 24, extra: Rect[] = []): { x: number; y: number } {
  const taken = occupied(doc, extra);
  const colW = size.w + gap;
  for (let row = 0; row < 40; row++) {
    const y = snap(from.y + from.h + 96 + row * (size.h + gap));
    for (let col = 0; col < 12; col++) {
      const x = snap(from.x + col * colW);
      if (!taken.some((r) => overlaps({ x, y, ...size }, r, gap / 2))) return { x, y };
    }
  }
  return { x: snap(from.x), y: snap(from.y + from.h + 96) };
}
