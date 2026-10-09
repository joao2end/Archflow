import type { Box, Doc } from "../shared/schema";

/** Sentido da inspeção: tudo o que o componente aciona e quem o aciona, só o que ele aciona ou só quem depende dele. */
export type FlowMode = "both" | "down" | "up";

export interface Flow {
  /** componentes (e grupos ligados por conexão) que fazem parte do fluxo */
  nodes: Set<string>;
  conns: Set<string>;
  /** grupos que contêm algum componente do fluxo (o enquadramento mantém o contexto) */
  groups: Set<string>;
  /** quantos componentes há a jusante e a montante (sem contar o ponto de partida) */
  down: number;
  up: number;
}

/**
 * Subgrafo do fluxo de `start`: o fecho transitivo a jusante (para onde os dados/chamadas vão)
 * e/ou a montante (de onde vêm), seguindo o sentido das conexões. Endpoints entram pelo serviço dono:
 * inspecionar um serviço também segue as conexões dos seus endpoints.
 */
export function flowOf(doc: Doc, start: string, mode: FlowMode): Flow {
  const byId = new Map(doc.nodes.map((n) => [n.id, n]));
  const endpointsOf = new Map<string, string[]>();
  for (const n of doc.nodes) if (n.owner) endpointsOf.set(n.owner, [...(endpointsOf.get(n.owner) ?? []), n.id]);
  const heads = (id: string) => [id, ...(endpointsOf.get(id) ?? [])];

  const walk = (dir: "down" | "up") => {
    const seen = new Set<string>([start]);
    const conns = new Set<string>();
    const queue = [start];
    while (queue.length) {
      const cur = queue.shift()!;
      const mine = new Set(heads(cur));
      for (const c of doc.connections) {
        const [here, there] = dir === "down" ? [c.from, c.to] : [c.to, c.from];
        if (!mine.has(here)) continue;
        conns.add(c.id);
        if (!seen.has(there)) {
          seen.add(there);
          queue.push(there);
        }
      }
    }
    return { seen, conns };
  };

  const down = walk("down");
  const up = walk("up");
  const nodes = new Set<string>([start]);
  const conns = new Set<string>();
  if (mode !== "up") {
    down.seen.forEach((i) => nodes.add(i));
    down.conns.forEach((i) => conns.add(i));
  }
  if (mode !== "down") {
    up.seen.forEach((i) => nodes.add(i));
    up.conns.forEach((i) => conns.add(i));
  }
  // endpoints do ponto de partida e donos dos endpoints alcançados aparecem como contexto
  for (const e of endpointsOf.get(start) ?? []) if (doc.connections.some((c) => (c.from === e || c.to === e) && conns.has(c.id))) nodes.add(e);
  for (const id of [...nodes]) {
    const owner = byId.get(id)?.owner;
    if (owner) nodes.add(owner);
  }

  const groups = new Set<string>();
  const parentOf = (id: string) => byId.get(id)?.parent ?? doc.groups.find((g) => g.id === id)?.parent;
  for (const id of nodes) {
    let cur = parentOf(id);
    for (let i = 0; cur && i < 30 && !groups.has(cur); i++) {
      groups.add(cur);
      cur = doc.groups.find((g) => g.id === cur)?.parent;
    }
  }
  return { nodes, conns, groups, down: down.seen.size - 1, up: up.seen.size - 1 };
}

/** Caixas dos componentes do fluxo (para enquadrar a tela). */
export function flowBoxes(doc: Doc, flow: Flow): Box[] {
  return [...doc.nodes.filter((n) => flow.nodes.has(n.id)), ...doc.groups.filter((g) => flow.nodes.has(g.id))];
}
