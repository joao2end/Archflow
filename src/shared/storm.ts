/**
 * Layout "linha do tempo" (Event Storming) para diagramas de modo `domain`.
 *
 * Cada bounded context vira um bloco com raias fixas, da esquerda para a direita na ordem em que as coisas acontecem
 * (ordem dos commands por `ddd.step`, depois pela ordem do documento):
 *
 *   evento externo → ator → caso de uso → command → aggregate → evento → policy/saga → read model → estrutura (entity, VO, repository, serviços)
 *
 * Eventos de outros contextos (`ddd.external`) ficam na raia de cima, na coluna de quem reage a eles: são entradas, como os adesivos
 * laranja à esquerda de uma policy no Event Storming, e assim não alargam o diagrama.
 *
 * Determinístico e sem efeitos: devolve posições; quem aplica (ops.ts) ajusta grupos e rótulos.
 */
import { NODE_H, NODE_W, type Doc, type DddRole, type GroupEl, type NodeEl } from "./schema";

export const STORM_COL_W = NODE_W + 56;
export const STORM_LANE_H = NODE_H + 52;
const PAD = 28;
const TOP = 54;
const BAND_GAP = 44;
const BLOCK_GAP = 80;
/** Colunas por faixa: acima disso o contexto quebra em outra faixa de raias, abaixo da primeira, para não virar uma tira de milhares de pixels. */
export const STORM_MAX_COLS = 8;

type Lane = "external" | "actor" | "use-case" | "command" | "aggregate" | "event" | "reaction" | "read" | "structure";
const LANES: Lane[] = ["external", "actor", "use-case", "command", "aggregate", "event", "reaction", "read", "structure"];

const laneOf = (n: NodeEl): Lane => {
  const r: DddRole | undefined = n.ddd?.role;
  if (!r) return n.kind === "actor" ? "actor" : "structure";
  if (r === "use-case") return "use-case";
  if (r === "command") return "command";
  if (r === "aggregate-root") return "aggregate";
  if (r === "domain-event") return n.ddd?.external ? "external" : "event";
  if (r === "policy" || r === "process-manager" || r === "decision") return "reaction";
  if (r === "read-model") return "read";
  return "structure";
};

export interface StormResult {
  nodes: Map<string, { x: number; y: number }>;
  /** retângulo de cada contexto (grupo `context`) calculado a partir do conteúdo */
  contexts: Map<string, { x: number; y: number; w: number; h: number }>;
}

export function stormLayout(doc: Doc): StormResult {
  const nodes = new Map<string, { x: number; y: number }>();
  const contexts = new Map<string, { x: number; y: number; w: number; h: number }>();
  const byId = new Map(doc.nodes.map((n) => [n.id, n]));
  const groups = new Map(doc.groups.map((g) => [g.id, g]));
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
  const outs = (id: string, rel?: string) => doc.connections.filter((c) => c.from === id && (!rel || c.ddd?.rel === rel));
  const ins = (id: string, rel?: string) => doc.connections.filter((c) => c.to === id && (!rel || c.ddd?.rel === rel));

  // blocos: um por contexto (na ordem do documento) + um para o que está fora de qualquer contexto
  const blocks: { ctx?: GroupEl; list: NodeEl[] }[] = doc.groups.filter((g) => g.kind === "context").map((g) => ({ ctx: g, list: [] as NodeEl[] }));
  const loose: NodeEl[] = [];
  for (const n of doc.nodes) {
    if (n.owner || n.kind === "endpoint") continue;
    const c = contextOf(n);
    (c ? blocks.find((b) => b.ctx === c)!.list : loose).push(n);
  }
  if (loose.length) blocks.push({ list: loose });
  orderBlocks(doc, blocks);

  let baseY = 0;
  for (const b of blocks) {
    if (!b.list.length) continue;
    const cell = new Map<string, string>(); // "lane:col" → id
    const col = new Map<string, number>();
    const laneIdx = new Map<string, Lane>();
    let maxCol = -1;
    const place = (n: NodeEl, want: number) => {
      const lane = laneOf(n);
      let c = Math.max(0, want);
      while (cell.has(`${lane}:${c}`)) c++;
      cell.set(`${lane}:${c}`, n.id);
      col.set(n.id, c);
      laneIdx.set(n.id, lane);
      maxCol = Math.max(maxCol, c);
    };
    const inBlock = new Set(b.list.map((n) => n.id));
    const colOf = (id: string | undefined, fallback = -1) => (id && col.has(id) ? col.get(id)! : fallback);
    const nextFree = () => maxCol + 1;
    const ofRole = (...r: DddRole[]) => b.list.filter((n) => n.ddd && r.includes(n.ddd.role));

    // 1. commands, na ordem do tempo
    const cmds = ofRole("command")
      .map((n, i) => ({ n, i }))
      .sort((a, z) => (a.n.ddd!.step ?? Infinity) - (z.n.ddd!.step ?? Infinity) || a.i - z.i)
      .map((x) => x.n);
    cmds.forEach((n, i) => place(n, i));

    // 2. casos de uso na coluna do command que os realiza
    for (const u of ofRole("use-case")) {
      const real = [...(u.ddd!.realizedBy ?? []), ...ins(u.id, "realizes").map((c) => c.from)].find((id) => col.has(id));
      place(u, real ? colOf(real) : nextFree());
    }
    // 3. atores na coluna do primeiro caso de uso que executam
    for (const a of b.list.filter((n) => n.kind === "actor" && !n.ddd)) {
      const uc = doc.connections.filter((c) => c.from === a.id || c.to === a.id).map((c) => (c.from === a.id ? c.to : c.from)).find((id) => laneIdx.get(id) === "use-case");
      place(a, uc ? colOf(uc) : nextFree());
    }
    // 4. aggregates na coluna do primeiro command que os aciona
    for (const g of ofRole("aggregate-root")) {
      const first = cmds.find((c) => outs(c.id, "triggers").some((e) => e.to === g.id));
      place(g, first ? colOf(first.id) : nextFree());
    }
    // 5. eventos próprios na coluna de quem os produz
    for (const e of ofRole("domain-event").filter((x) => !x.ddd!.external)) {
      const producers = [e.ddd!.producedBy, ...ins(e.id, "emits").map((c) => c.from)].filter((x): x is string => !!x);
      const p = producers.find((id) => col.has(id));
      place(e, p ? colOf(p) : nextFree());
    }
    // 6. policies e sagas uma coluna depois do primeiro evento a que reagem
    for (const r of ofRole("policy", "process-manager")) {
      const evs = [...(r.ddd!.reactsTo ?? []), ...ins(r.id, "triggers").map((c) => c.from)].filter((id) => col.has(id));
      const issued = [...(r.ddd!.issues ?? []), ...outs(r.id, "triggers").map((c) => c.to)].find((id) => col.has(id));
      place(r, evs.length ? Math.min(...evs.map((id) => colOf(id))) + 1 : issued ? colOf(issued) : nextFree());
    }
    // 6b. decisões uma coluna depois de quem as alimenta (evento, policy, saga ou outra decisão, na ordem do documento)
    for (let pass = 0; pass < 2; pass++)
      for (const r of ofRole("decision").filter((x) => !col.has(x.id))) {
        const feeds = ins(r.id, "triggers").map((c) => c.from).filter((id) => col.has(id));
        if (!feeds.length && pass === 0) continue;
        const issued = outs(r.id, "triggers").map((c) => c.to).find((id) => col.has(id));
        place(r, feeds.length ? Math.min(...feeds.map((id) => colOf(id))) + 1 : issued ? colOf(issued) : nextFree());
      }
    // 7. read models na coluna do primeiro evento próprio que os alimenta
    for (const r of ofRole("read-model")) {
      const evs = [...(r.ddd!.projectsFrom ?? []), ...ins(r.id, "triggers").map((c) => c.from)].filter((id) => col.has(id));
      place(r, evs.length ? Math.min(...evs.map((id) => colOf(id))) : nextFree());
    }
    // 7b. eventos externos na raia de entrada, na coluna do primeiro que reage a eles
    for (const e of ofRole("domain-event").filter((x) => x.ddd!.external)) {
      const reactors = b.list.filter((r) => r.ddd && ["policy", "process-manager", "read-model", "decision"].includes(r.ddd.role) && col.has(r.id) && ((r.ddd.reactsTo ?? []).includes(e.id) || (r.ddd.projectsFrom ?? []).includes(e.id) || outs(e.id, "triggers").some((c) => c.to === r.id)));
      place(e, reactors.length ? Math.min(...reactors.map((r) => colOf(r.id))) : nextFree());
    }
    // 8. estrutura: entity/VO sob a raiz que as contém, repository sob o aggregate que persiste, o resto ao final
    const structural = b.list.filter((n) => !col.has(n.id));
    for (const n of structural) {
      const root = n.ddd?.role === "repository" ? n.ddd.for : ins(n.id, "contains")[0]?.from;
      const rc = root ? colOf(root) : -1;
      place(n, rc >= 0 ? rc : nextFree());
    }

    // colunas vazias (sem nenhum nó) são removidas e o resto é dividido em faixas de no máximo STORM_MAX_COLS colunas;
    // raias vazias de cada faixa são comprimidas, e cada raia usada ocupa uma linha
    const usedCols = [...new Set(b.list.filter((n) => col.has(n.id)).map((n) => col.get(n.id)!))].sort((a, z) => a - z);
    const slot = new Map(usedCols.map((c, i) => [c, i]));
    const bands = Math.max(1, Math.ceil(usedCols.length / STORM_MAX_COLS));
    const cols = Math.min(usedCols.length, STORM_MAX_COLS);
    let bandY = TOP;
    for (let band = 0; band < bands; band++) {
      const mine = b.list.filter((n) => col.has(n.id) && Math.floor(slot.get(col.get(n.id)!)! / STORM_MAX_COLS) === band);
      const used = LANES.filter((l) => mine.some((n) => laneIdx.get(n.id) === l));
      const row = new Map(used.map((l, i) => [l, i]));
      for (const n of mine) {
        nodes.set(n.id, { x: Math.round(PAD + (slot.get(col.get(n.id)!)! % STORM_MAX_COLS) * STORM_COL_W), y: Math.round(baseY + bandY + row.get(laneIdx.get(n.id)!)! * STORM_LANE_H) });
      }
      bandY += used.length * STORM_LANE_H - (STORM_LANE_H - NODE_H) + (band < bands - 1 ? BAND_GAP : 0);
    }
    const w = PAD * 2 + Math.max(1, cols) * STORM_COL_W - (STORM_COL_W - NODE_W);
    const h = bandY + PAD;
    if (b.ctx) contexts.set(b.ctx.id, { x: 0, y: baseY, w: Math.max(240, w), h: Math.max(140, h) });
    baseY += h + BLOCK_GAP;
  }
  return { nodes, contexts };
}

/**
 * Contextos que alimentam outros ficam acima deles (a seta de integração desce, como na leitura do texto).
 * A dependência vem das conexões entre contextos e dos eventos externos (`ddd.external` = nome do contexto de origem).
 * Estável: sem dependência, vale a ordem do documento; ciclos são quebrados por ela.
 */
function orderBlocks(doc: Doc, blocks: { ctx?: GroupEl; list: NodeEl[] }[]) {
  if (blocks.length < 2) return;
  const byNode = new Map<string, number>();
  blocks.forEach((b, i) => b.list.forEach((n) => byNode.set(n.id, i)));
  const idx = (ref: string) => blocks.findIndex((b) => b.ctx && (b.ctx.id === ref || b.ctx.label.trim().toLowerCase() === ref.trim().toLowerCase()));
  const after = blocks.map(() => new Set<number>());
  const add = (from: number, to: number) => from >= 0 && to >= 0 && from !== to && after[from].add(to);
  for (const c of doc.connections) add(byNode.get(c.from) ?? -1, byNode.get(c.to) ?? -1);
  for (const b of blocks.map((x, i) => ({ x, i })))
    for (const n of b.x.list) if (n.ddd?.external) add(idx(n.ddd.external), b.i);
  const indeg = blocks.map(() => 0);
  after.forEach((s) => s.forEach((t) => indeg[t]++));
  const out: number[] = [];
  const done = new Set<number>();
  while (out.length < blocks.length) {
    let next = blocks.findIndex((_, i) => !done.has(i) && !indeg[i]);
    if (next < 0) next = blocks.findIndex((_, i) => !done.has(i)); // ciclo: segue a ordem do documento
    done.add(next);
    out.push(next);
    after[next].forEach((t) => indeg[t]--);
  }
  const copy = [...blocks];
  out.forEach((o, i) => (blocks[i] = copy[o]));
}
