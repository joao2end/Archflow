/**
 * Layout "agrupar por tipo" para diagramas de modo `domain`.
 *
 * Em cada bounded context, os componentes do mesmo tipo (atores, commands, aggregates, eventos…) ficam juntos em um quadro
 * próprio, e os quadros seguem a ordem do fluxo (ator → caso de uso → command → aggregate → evento → …). Dentro do quadro os
 * componentes formam uma grade curta; quadros que não cabem na largura quebram para a linha de baixo.
 *
 * Determinístico e sem efeitos: devolve posições e retângulos; quem aplica (ops.ts) cria os grupos e roteia as conexões.
 */
import { NODE_H, NODE_W, type Doc, type GroupEl, type NodeEl } from "./schema";

export const TYPE_GROUP_PREFIX = "tipo-";
const PAD = 22;
const TOP = 54;
const GAP_X = 36;
const GAP_Y = 34;
const BOX_GAP = 56;
const BLOCK_GAP = 90;
const MAX_ROWS = 4;
const MAX_COLS = 3;
const MAX_WIDTH = 1900;

const TYPES: { key: string; label: string }[] = [
  { key: "external", label: "Eventos externos" },
  { key: "actor", label: "Atores" },
  { key: "controller", label: "Controllers" },
  { key: "use-case", label: "Casos de uso" },
  { key: "command", label: "Commands" },
  { key: "aggregate-root", label: "Aggregates" },
  { key: "entity", label: "Entities" },
  { key: "value-object", label: "Value objects" },
  { key: "domain-event", label: "Eventos" },
  { key: "policy", label: "Policies" },
  { key: "process-manager", label: "Sagas" },
  { key: "decision", label: "Decisões" },
  { key: "read-model", label: "Read models" },
  { key: "repository", label: "Repositories" },
  { key: "domain-service", label: "Domain services" },
  { key: "application-service", label: "Application services" },
  { key: "other", label: "Outros" },
];

const typeOf = (n: NodeEl): string => {
  const r = n.ddd?.role;
  if (!r) return n.kind === "actor" ? "actor" : "other";
  return r === "domain-event" && n.ddd?.external ? "external" : r;
};

export interface TypeBox {
  id: string;
  label: string;
  /** contexto (ou grupo pai) que contém o quadro; ausente para o que está fora de qualquer contexto */
  parent?: string;
  members: string[];
  rect: { x: number; y: number; w: number; h: number };
}

export interface GroupedResult {
  nodes: Map<string, { x: number; y: number }>;
  boxes: TypeBox[];
  contexts: Map<string, { x: number; y: number; w: number; h: number }>;
}

export function groupedLayout(doc: Doc): GroupedResult {
  const nodes = new Map<string, { x: number; y: number }>();
  const boxes: TypeBox[] = [];
  const contexts = new Map<string, { x: number; y: number; w: number; h: number }>();
  const groups = new Map(doc.groups.map((g) => [g.id, g]));
  // o contexto de um nó é o primeiro ancestral `context`, mesmo que ele já esteja dentro de um quadro de tipo de uma execução anterior
  const contextOf = (n: NodeEl): GroupEl | undefined => {
    let cur = n.parent;
    const seen = new Set<string>();
    while (cur && !seen.has(cur)) {
      seen.add(cur);
      const g = groups.get(cur);
      if (!g) return undefined;
      if (g.kind === "context") return g;
      cur = g.parent;
    }
    return undefined;
  };

  const blocks: { ctx?: GroupEl; list: NodeEl[] }[] = doc.groups.filter((g) => g.kind === "context").map((g) => ({ ctx: g, list: [] as NodeEl[] }));
  const loose: NodeEl[] = [];
  for (const n of doc.nodes) {
    if (n.owner || n.kind === "endpoint") continue;
    const c = contextOf(n);
    (c ? blocks.find((b) => b.ctx === c)!.list : loose).push(n);
  }
  if (loose.length) blocks.push({ list: loose });

  let baseY = 0;
  for (const b of blocks) {
    if (!b.list.length) continue;
    const ctxKey = b.ctx?.id ?? "solto";
    const made: { key: string; label: string; items: NodeEl[]; w: number; h: number; cols: number }[] = [];
    for (const t of TYPES) {
      let items = b.list.filter((n) => typeOf(n) === t.key);
      if (!items.length) continue;
      if (t.key === "command") items = items.map((n, i) => ({ n, i })).sort((a, z) => (a.n.ddd!.step ?? Infinity) - (z.n.ddd!.step ?? Infinity) || a.i - z.i).map((x) => x.n);
      const cols = Math.min(MAX_COLS, Math.ceil(items.length / MAX_ROWS));
      const rows = Math.ceil(items.length / cols);
      made.push({ key: t.key, label: t.label, items, cols, w: PAD * 2 + cols * NODE_W + (cols - 1) * GAP_X, h: TOP + rows * NODE_H + (rows - 1) * GAP_Y + PAD });
    }

    // quadros lado a lado; ao passar da largura máxima, quebra para a faixa de baixo
    let x = PAD;
    let y = TOP;
    let rowH = 0;
    let maxX = 0;
    for (const m of made) {
      if (x > PAD && x + m.w > MAX_WIDTH) {
        x = PAD;
        y += rowH + BOX_GAP;
        rowH = 0;
      }
      const rect = { x, y: baseY + y, w: m.w, h: m.h };
      boxes.push({ id: `${TYPE_GROUP_PREFIX}${ctxKey}-${m.key}`, label: m.label, parent: b.ctx?.id, members: m.items.map((n) => n.id), rect });
      const rows = Math.ceil(m.items.length / m.cols);
      m.items.forEach((n, i) => {
        // preenche coluna por coluna, para a leitura descer no quadro
        const col = Math.floor(i / rows);
        const row = i % rows;
        nodes.set(n.id, { x: rect.x + PAD + col * (NODE_W + GAP_X), y: rect.y + TOP + row * (NODE_H + GAP_Y) });
      });
      x += m.w + BOX_GAP;
      rowH = Math.max(rowH, m.h);
      maxX = Math.max(maxX, x - BOX_GAP);
    }
    const h = y + rowH + PAD;
    if (b.ctx) contexts.set(b.ctx.id, { x: 0, y: baseY, w: Math.max(240, maxX + PAD), h: Math.max(140, h) });
    baseY += h + BLOCK_GAP;
  }
  return { nodes, boxes, contexts };
}
