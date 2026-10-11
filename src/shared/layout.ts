/**
 * Núcleo puro do auto-layout em camadas (estilo Sugiyama), sem conhecer o schema do diagrama.
 *
 * Regras de legibilidade aplicadas (ver docs/LAYOUT.md):
 *  1. fluxo numa só direção: arestas de retorno (ciclos) são ignoradas no ranqueamento;
 *  2. arestas curtas: fontes (sem entrada) são puxadas para junto de seus destinos;
 *  3. poucos cruzamentos: varreduras de baricentro (descendo/subindo) + troca de vizinhos, mantendo a melhor ordem;
 *  4. arestas longas ganham "nós virtuais" que reservam corredor, então não empurram componentes para cima delas;
 *  5. alinhamento: cada componente tenta ficar na altura média de seus vizinhos (regressão isotônica por camada),
 *     o que deixa as conexões retas em vez de em degrau;
 *  6. determinismo: mesma entrada, mesmo desenho.
 */

export interface LayeredResult {
  /** camada (0 = primeira) de cada id */
  rank: Map<string, number>;
  /** ids reais por camada, na ordem final */
  layers: string[][];
  /** posição (início) no eixo transversal, normalizada para começar em 0 */
  cross: Map<string, number>;
  /** extensão total no eixo transversal */
  extent: number;
  /** cruzamentos de arestas que sobraram */
  crossings: number;
}

const VIRTUAL_SEP = 24;

/** Regressão isotônica (PAV): posições `p` que minimizam o desvio de `want` respeitando `p[i+1] - p[i] >= dist[i]`. */
export function isotonicPlace(want: number[], dist: number[]): number[] {
  const off: number[] = [0];
  for (let i = 0; i < dist.length; i++) off.push(off[i] + dist[i]);
  const blocks: { sum: number; n: number }[] = [];
  want.forEach((w, i) => {
    blocks.push({ sum: w - off[i], n: 1 });
    while (blocks.length > 1) {
      const b = blocks[blocks.length - 1];
      const a = blocks[blocks.length - 2];
      if (a.sum / a.n <= b.sum / b.n) break;
      blocks.splice(blocks.length - 2, 2, { sum: a.sum + b.sum, n: a.n + b.n });
    }
  });
  const out: number[] = [];
  for (const b of blocks) for (let k = 0; k < b.n; k++) out.push(b.sum / b.n + off[out.length]);
  return out;
}

export function layeredLayout(ids: string[], edges: Array<[string, string]>, crossSize: (id: string) => number, gap: number): LayeredResult {
  const known = new Set(ids);
  const succ = new Map<string, Set<string>>(ids.map((i) => [i, new Set()]));
  const indeg = new Map<string, number>(ids.map((i) => [i, 0]));
  for (const [a, b] of edges) if (a !== b && known.has(a) && known.has(b) && !succ.get(a)!.has(b)) {
    succ.get(a)!.add(b);
    indeg.set(b, indeg.get(b)! + 1);
  }

  // 1. DAG: DFS a partir das fontes (para que o ciclo seja rompido no retorno, não no meio do fluxo)
  const state = new Map<string, number>();
  const dag = new Map<string, string[]>(ids.map((i) => [i, []]));
  const dfs = (u: string) => {
    state.set(u, 1);
    for (const v of succ.get(u)!) {
      if (state.get(v) === 1) continue; // aresta de retorno
      dag.get(u)!.push(v);
      if (!state.has(v)) dfs(v);
    }
    state.set(u, 2);
  };
  for (const i of [...ids.filter((x) => indeg.get(x) === 0), ...ids]) if (!state.has(i)) dfs(i);

  // 2. camadas pelo caminho mais longo (Kahn) + fontes puxadas para junto do destino mais próximo
  const preds = new Map<string, string[]>(ids.map((i) => [i, []]));
  for (const [u, vs] of dag) for (const v of vs) preds.get(v)!.push(u);
  const rank = new Map<string, number>(ids.map((i) => [i, 0]));
  const left = new Map(ids.map((i) => [i, preds.get(i)!.length]));
  const queue = ids.filter((i) => left.get(i) === 0);
  const topo: string[] = [];
  for (let h = 0; h < queue.length; h++) {
    const u = queue[h];
    topo.push(u);
    for (const v of dag.get(u)!) {
      rank.set(v, Math.max(rank.get(v)!, rank.get(u)! + 1));
      left.set(v, left.get(v)! - 1);
      if (left.get(v) === 0) queue.push(v);
    }
  }
  for (const u of [...topo].reverse()) {
    if (preds.get(u)!.length || !dag.get(u)!.length) continue;
    rank.set(u, Math.min(...dag.get(u)!.map((v) => rank.get(v)!)) - 1);
  }
  const lo = Math.min(0, ...rank.values());
  if (lo) for (const [k, v] of rank) rank.set(k, v - lo);

  // 3. camadas com nós virtuais; a ordem inicial vem de uma DFS (boa para árvores)
  const maxRank = Math.max(0, ...rank.values());
  const L: string[][] = Array.from({ length: maxRank + 1 }, () => []);
  const up = new Map<string, string[]>();
  const down = new Map<string, string[]>();
  const link = (a: string, b: string) => {
    (down.get(a) ?? down.set(a, []).get(a)!).push(b);
    (up.get(b) ?? up.set(b, []).get(b)!).push(a);
  };
  const placed = new Set<string>();
  const seen = new Set<string>();
  const visit = (u: string) => {
    if (placed.has(u)) return;
    placed.add(u);
    L[rank.get(u)!].push(u);
    for (const v of dag.get(u)!) {
      const key = `${u}\u0000${v}`;
      if (seen.has(key)) continue;
      seen.add(key);
      let prev = u;
      for (let r = rank.get(u)! + 1; r < rank.get(v)!; r++) {
        const d = `~${u}>${v}#${r}`;
        L[r].push(d);
        link(prev, d);
        prev = d;
      }
      link(prev, v);
      visit(v);
    }
  };
  for (const i of [...ids.filter((x) => !preds.get(x)!.length), ...ids]) visit(i);

  const pos = new Map<string, number>();
  const reindex = () => L.forEach((l) => l.forEach((id, i) => pos.set(id, i)));
  reindex();
  const mean = (xs: string[] | undefined, fallback: number) => (xs?.length ? xs.reduce((s, x) => s + pos.get(x)!, 0) / xs.length : fallback);
  const sortBy = (r: number, nbrs: Map<string, string[]>) => {
    const key = new Map(L[r].map((id, i) => [id, mean(nbrs.get(id), i)]));
    L[r] = L[r].map((id, i) => ({ id, i })).sort((a, b) => key.get(a.id)! - key.get(b.id)! || a.i - b.i).map((x) => x.id);
    reindex();
  };
  const countBetween = (r: number) => {
    const es: [number, number][] = [];
    for (const u of L[r]) for (const v of down.get(u) ?? []) es.push([pos.get(u)!, pos.get(v)!]);
    let c = 0;
    for (let i = 0; i < es.length; i++) for (let j = i + 1; j < es.length; j++) if ((es[i][0] - es[j][0]) * (es[i][1] - es[j][1]) < 0) c++;
    return c;
  };
  const total = () => L.slice(0, -1).reduce((s, _, r) => s + countBetween(r), 0);
  const pair = (a: string, b: string) => {
    // cruzamentos entre as arestas de a e de b quando a está à esquerda de b
    let c = 0;
    for (const nb of [up, down])
      for (const x of nb.get(a) ?? []) for (const y of nb.get(b) ?? []) if (pos.get(x)! > pos.get(y)!) c++;
    return c;
  };
  const transpose = () => {
    for (let pass = 0, improved = true; improved && pass < 8; pass++) {
      improved = false;
      for (const layer of L)
        for (let i = 0; i + 1 < layer.length; i++) {
          const a = layer[i];
          const b = layer[i + 1];
          if (pair(b, a) < pair(a, b)) {
            layer[i] = b;
            layer[i + 1] = a;
            pos.set(b, i);
            pos.set(a, i + 1);
            improved = true;
          }
        }
    }
  };

  const edgeCount = [...down.values()].reduce((s, x) => s + x.length, 0);
  let best = L.map((l) => [...l]);
  let bestScore = total();
  if (maxRank > 0 && bestScore > 0) {
    for (let it = 0; it < 14 && bestScore > 0; it++) {
      if (it % 2 === 0) for (let r = 1; r <= maxRank; r++) sortBy(r, up);
      else for (let r = maxRank - 1; r >= 0; r--) sortBy(r, down);
      if (edgeCount <= 600) transpose();
      const s = total();
      if (s < bestScore) {
        bestScore = s;
        best = L.map((l) => [...l]);
      }
    }
    best.forEach((l, r) => (L[r] = l));
    reindex();
  }

  // 4. coordenada transversal: empacota e depois alinha ao centro dos vizinhos
  const size = (id: string) => (id.startsWith("~") ? 0 : crossSize(id));
  const sep = (a: string, b: string) => (a.startsWith("~") || b.startsWith("~") ? VIRTUAL_SEP : gap);
  const dist = (layer: string[]) => layer.slice(0, -1).map((a, i) => size(a) + sep(a, layer[i + 1]));
  const p = new Map<string, number>();
  const ext = L.map((l) => l.reduce((s, id) => s + size(id), 0) + dist(l).reduce((s, d, i) => s + d - size(l[i]), 0));
  const widest = Math.max(0, ...ext);
  L.forEach((layer, r) => {
    let c = (widest - ext[r]) / 2;
    layer.forEach((id, i) => {
      p.set(id, c);
      c += size(id) + (i + 1 < layer.length ? sep(id, layer[i + 1]) : 0);
    });
  });
  const align = (r: number, nbrs: Array<Map<string, string[]>>) => {
    const layer = L[r];
    const want = layer.map((id) => {
      const ns = nbrs.flatMap((m) => m.get(id) ?? []);
      if (!ns.length) return p.get(id)!;
      return ns.reduce((s, n) => s + p.get(n)! + size(n) / 2, 0) / ns.length - size(id) / 2;
    });
    isotonicPlace(want, dist(layer)).forEach((v, i) => p.set(layer[i], v));
  };
  for (let it = 0; it < 6; it++) {
    for (let r = 1; r <= maxRank; r++) align(r, [up]);
    for (let r = maxRank - 1; r >= 0; r--) align(r, [down]);
  }
  for (let r = 0; r <= maxRank; r++) align(r, [up, down]);

  const real = L.map((l) => l.filter((id) => !id.startsWith("~")));
  const all = real.flat();
  const min = all.length ? Math.min(...all.map((id) => p.get(id)!)) : 0;
  const cross = new Map<string, number>();
  let extent = 0;
  for (const id of all) {
    cross.set(id, Math.round(p.get(id)! - min));
    extent = Math.max(extent, cross.get(id)! + size(id));
  }
  return { rank, layers: real, cross, extent, crossings: bestScore };
}

/**
 * Empacota caixas em linhas ("prateleiras") de largura máxima `width`; devolve a posição de cada uma e o tamanho total.
 * Usado para componentes sem nenhuma conexão, que não devem formar uma coluna interminável.
 */
export function shelfPack(items: Array<{ id: string; w: number; h: number }>, width: number, gap: number) {
  const at = new Map<string, { x: number; y: number }>();
  let x = 0;
  let y = 0;
  let rowH = 0;
  let w = 0;
  for (const it of items) {
    if (x > 0 && x + it.w > width) {
      y += rowH + gap;
      x = 0;
      rowH = 0;
    }
    at.set(it.id, { x, y });
    x += it.w + gap;
    rowH = Math.max(rowH, it.h);
    w = Math.max(w, x - gap);
  }
  return { at, w, h: items.length ? y + rowH : 0 };
}
