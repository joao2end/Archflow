/**
 * Layout do fluxo do modo Logic: um fluxograma de cima para baixo.
 *
 * Camadas pelo caminho mais longo a partir do Start (a volta de um laço não conta); cada camada é uma linha do quadro e
 * ramos paralelos (escolha, paralelo) ficam lado a lado. Setas que pulam camadas (o "não" de uma decisão) e voltas de laço
 * contornam os cartões por fora, com pontos de passagem. Os dados ficam agrupados nas laterais (entradas à esquerda,
 * resultados e cenários à direita) em vez de soltos. Determinístico e sem efeitos: devolve posições, tamanhos e curvas.
 */
import type { Doc, NodeEl } from "./schema";
import { parseStatement } from "./expr";
import { exitsOf, dataKey, dataNames, flowEdges, isFlowNode, pipelineSequence } from "./logic";
import { isFailureScenario, logicSize } from "./logiccard";

export const LOGIC_GAP_Y = 64;
const GAP_X = 70;
const SIDE_GAP = 120;
const ROW = 12;
const LANE = 46;

export interface LogicPlan {
  pos: Map<string, { x: number; y: number }>;
  size: Map<string, { w: number; h: number }>;
  /** conexões: pontos de passagem para contornar os cartões */
  waypoints: Map<string, { x: number; y: number }[]>;
  groups: { id: string; label: string; tag: string; members: string[] }[];
}

export function logicLayout(doc: Doc): LogicPlan {
  const names = dataNames(doc);
  const pos = new Map<string, { x: number; y: number }>();
  const size = new Map<string, { w: number; h: number }>();
  const waypoints = new Map<string, { x: number; y: number }[]>();
  const dim = (n: NodeEl) => {
    const s = logicSize(n, names) ?? { w: n.w, h: n.h };
    size.set(n.id, s);
    return s;
  };

  const flowNodes = doc.nodes.filter(isFlowNode);
  const edges = flowEdges(doc);
  const chain = edges.length ? [] : pipelineSequence(doc);
  const nodes = edges.length ? flowNodes : chain;
  const ids = new Set(nodes.map((n) => n.id));
  // setas de volta (fecham um ciclo, normalmente de volta a um loop): não entram nas camadas e contornam por fora
  const back = new Set<string>();
  {
    const st = new Map<string, number>();
    const visit = (id: string) => {
      st.set(id, 1);
      for (const e of edges.filter((x) => x.from === id)) {
        const c = st.get(e.to) ?? 0;
        if (c === 1) back.add(e.id);
        else if (c === 0) visit(e.to);
      }
      st.set(id, 2);
    };
    const s0 = nodes.find((n) => n.logic!.role === "start") ?? nodes[0];
    if (s0) visit(s0.id);
    for (const n of nodes) if (!st.has(n.id)) visit(n.id);
  }
  const forward = edges.filter((e) => !back.has(e.id));

  // camadas: caminho mais longo a partir do início (ciclos que não são laço são cortados pelo DFS)
  const level = new Map<string, number>();
  const start = nodes.find((n) => n.logic!.role === "start") ?? nodes[0];
  const succ = (id: string) => (edges.length ? forward.filter((e) => e.from === id).map((e) => e.to) : []);
  if (edges.length) {
    const state = new Map<string, number>();
    const order: string[] = [];
    const dfs = (id: string) => {
      state.set(id, 1);
      for (const t of succ(id)) if (!state.has(t) && ids.has(t)) dfs(t);
      state.set(id, 2);
      order.push(id);
    };
    if (start) dfs(start.id);
    for (const n of nodes) if (!state.has(n.id)) dfs(n.id);
    const topo = order.reverse();
    const idx = new Map(topo.map((id, i) => [id, i]));
    for (const id of topo) level.set(id, level.get(id) ?? 0);
    for (const id of topo) for (const t of succ(id)) if ((idx.get(t) ?? 0) > (idx.get(id) ?? 0)) level.set(t, Math.max(level.get(t) ?? 0, (level.get(id) ?? 0) + 1));
  } else chain.forEach((n, i) => level.set(n.id, i));

  const rows: NodeEl[][] = [];
  for (const n of nodes) (rows[level.get(n.id) ?? 0] ??= []).push(n);
  // dentro da camada: a ordem em que os pais os alcançam ("sim" antes de "não", casos na ordem das setas)
  const rank = (n: NodeEl) => {
    const e = forward.find((x) => x.to === n.id);
    if (!e) return 0;
    const b = e.logic?.branch;
    return b === "sim" ? 0 : b === "nao" ? 2 : b === "outros" ? 3 : 1;
  };
  // e, antes disso, junto do pai: filhos do mesmo pai ficam lado a lado em vez de separados por filhos de outro nó
  // (a posição relativa do pai na própria camada, de 0 a 1, já ordenada porque as camadas vêm de cima para baixo)
  const place = new Map<string, number>();
  const parentSlot = (n: NodeEl) => {
    const ps = forward.filter((x) => x.to === n.id && place.has(x.from)).map((x) => place.get(x.from)!);
    return ps.length ? ps.reduce((s, v) => s + v, 0) / ps.length : 0.5;
  };
  rows.forEach((r) => {
    if (!r) return;
    const slot = new Map(r.map((n) => [n.id, parentSlot(n)]));
    r.sort((a, b) => slot.get(a.id)! - slot.get(b.id)! || rank(a) - rank(b));
    r.forEach((n, i) => place.set(n.id, r.length > 1 ? i / (r.length - 1) : 0.5));
  });

  const widths = rows.map((r) => (r ?? []).reduce((s, n) => s + dim(n).w, 0) + Math.max(0, (r?.length ?? 1) - 1) * GAP_X);
  const maxW = Math.max(300, ...widths);
  const cx = maxW / 2;
  const sideL = 0;
  const flowLeft = 0;
  let y = 0;
  const rowY: number[] = [];
  rows.forEach((r, i) => {
    if (!r?.length) return;
    rowY[i] = y;
    const h = Math.max(...r.map((n) => dim(n).h));
    let x = cx - widths[i] / 2;
    for (const n of r) {
      const s = size.get(n.id)!;
      pos.set(n.id, { x, y: y + (h - s.h) / 2 });
      x += s.w + GAP_X;
    }
    y += h + LOGIC_GAP_Y;
  });
  void sideL;

  // setas que contornam: pulam camadas (ex.: "não") ou voltam (laço)
  const right = (a: number, b: number) => {
    let m = 0;
    for (let i = a; i <= b; i++) for (const n of rows[i] ?? []) m = Math.max(m, (pos.get(n.id)?.x ?? 0) + size.get(n.id)!.w);
    return m;
  };
  const left = (a: number, b: number) => {
    let m = Infinity;
    for (let i = a; i <= b; i++) for (const n of rows[i] ?? []) m = Math.min(m, pos.get(n.id)?.x ?? 0);
    return m;
  };
  const cy = (id: string) => pos.get(id)!.y + size.get(id)!.h / 2;
  let lane = 0;
  for (const e of edges) {
    const a = level.get(e.from) ?? 0;
    const b = level.get(e.to) ?? 0;
    if (!pos.has(e.from) || !pos.has(e.to)) continue;
    if (back.has(e.id)) {
      const lo = Math.min(a, b);
      const hi = Math.max(a, b);
      const x = left(lo, hi) - LANE - (lane++ % 3) * 18;
      waypoints.set(e.id, [{ x, y: cy(e.from) }, { x, y: cy(e.to) }]);
    } else if (b - a > 1) {
      const x = right(a, b) + LANE + (lane++ % 3) * 18;
      const fromSide = pos.get(e.from)!.x + size.get(e.from)!.w;
      void fromSide;
      waypoints.set(e.id, [{ x, y: cy(e.from) }, { x, y: pos.get(e.to)!.y - LOGIC_GAP_Y / 2 }]);
    }
  }

  // dados e cenários, agrupados nas laterais: entradas à esquerda; resultados, variáveis e cenários à direita
  const inputs = doc.nodes.filter((n) => n.logic?.role === "input");
  const outputs = doc.nodes.filter((n) => n.logic?.role === "output");
  const variables = doc.nodes.filter((n) => n.logic?.role === "variable");
  const scenarios = doc.nodes.filter((n) => n.logic?.role === "scenario");
  const flowRight = Math.max(maxW, ...[...pos.entries()].filter(([id]) => ids.has(id)).map(([id, p]) => p.x + size.get(id)!.w)) + 140;
  const flowLeftX = Math.min(flowLeft, ...[...pos.entries()].filter(([id]) => ids.has(id)).map(([, p]) => p.x)) - 160;

  const stack = (list: NodeEl[], x: number, from = 44) => {
    let sy = from;
    for (const n of list) {
      const s = dim(n);
      pos.set(n.id, { x, y: sy });
      sy += s.h + ROW;
    }
    return sy;
  };
  stack(inputs, flowLeftX - 220 - SIDE_GAP + 120);
  const afterOut = stack(outputs, flowRight + 60);
  let sy = afterOut + 60;
  if (variables.length) sy = stack(variables, flowRight + 60, sy) + 60; // as variáveis ficam abaixo dos resultados
  const okScenarios = scenarios.filter((n) => !isFailureScenario(n));
  const failScenarios = scenarios.filter(isFailureScenario);
  for (const list of [okScenarios, failScenarios]) {
    for (const n of list) {
      const s = dim(n);
      pos.set(n.id, { x: flowRight + 60, y: sy });
      sy += s.h + ROW;
    }
    sy += 64; // espaço do título do grupo seguinte
  }
  for (const n of doc.nodes) if (!pos.has(n.id) && !n.owner) pos.set(n.id, { x: n.x, y: n.y });

  const groups = [
    { id: "entradas", label: "Entradas", tag: "Input", members: inputs.map((n) => n.id) },
    { id: "resultados", label: "Resultados", tag: "Output", members: outputs.map((n) => n.id) },
    { id: "variaveis", label: "Variáveis do fluxo", tag: "Variable", members: variables.map((n) => n.id) },
    { id: "cenarios", label: "Cenários que dão certo", tag: "Caminhos de sucesso", members: okScenarios.map((n) => n.id) },
    { id: "cenarios-falha", label: "Cenários que falham", tag: "Caminhos de falha", members: failScenarios.map((n) => n.id) },
  ].filter((g) => g.members.length);
  void exitsOf;
  return { pos, size, waypoints, groups };
}
