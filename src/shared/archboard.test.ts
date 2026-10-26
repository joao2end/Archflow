import assert from "node:assert/strict";
import { test } from "node:test";
import { ARCH_EXAMPLES } from "./arch.examples";
import { boardLayout, chamfer, moveOps, simplify, type BoardLayout, type Pt } from "./archboard";
import { applyOps } from "./ops";
import { emptyDoc, type Doc, type NodeEl } from "./schema";

const node = (id: string, x: number, y: number, kind: NodeEl["kind"] = "service", extra: Partial<NodeEl> = {}): NodeEl => ({ id, label: id, kind, x, y, w: 184, h: 72, ...extra });
const doc = (nodes: NodeEl[], conns: [string, string][] = [], groups: Doc["groups"] = []): Doc => ({
  ...emptyDoc("t"),
  nodes,
  groups,
  connections: conns.map(([from, to], i) => ({ id: `c${i}`, from, to, type: "sync" })),
});

/** Segmento (a→b) atravessa o retângulo do componente (com folga de 1px nas bordas, onde as trilhas encostam)? */
function crosses(a: Pt, b: Pt, n: { x: number; y: number; hw: number; hd: number }) {
  const x0 = n.x - n.hw + 1, x1 = n.x + n.hw - 1, y0 = n.y - n.hd + 1, y1 = n.y + n.hd - 1;
  for (let k = 0; k <= 40; k++) {
    const x = a.x + ((b.x - a.x) * k) / 40;
    const y = a.y + ((b.y - a.y) * k) / 40;
    if (x > x0 && x < x1 && y > y0 && y < y1) return true;
  }
  return false;
}

/** Toda trilha: só segmentos horizontais, verticais ou a 45°, e nenhum por cima de um componente. */
function assertClean(l: BoardLayout) {
  for (const t of l.traces) {
    for (let i = 1; i < t.pts.length; i++) {
      const [a, b] = [t.pts[i - 1], t.pts[i]];
      const dx = Math.abs(b.x - a.x);
      const dy = Math.abs(b.y - a.y);
      assert.ok(dx < 0.01 || dy < 0.01 || Math.abs(dx - dy) < 0.01, `${t.id}: segmento fora dos ângulos da placa (${dx}, ${dy})`);
      for (const n of l.nodes.values()) assert.ok(!crosses(a, b, n), `${t.id} passa por cima de ${n.id}`);
    }
  }
}

test("boardLayout: linhas e colunas saem do 2D, num passo fixo", () => {
  const l = boardLayout(doc([node("a", 0, 0), node("b", 300, 10), node("c", 20, 200), node("d", 700, 220)]));
  const cell = (id: string) => [l.nodes.get(id)!.col, l.nodes.get(id)!.row];
  assert.deepEqual([cell("a"), cell("b"), cell("c"), cell("d")], [[0, 0], [1, 0], [0, 1], [2, 1]]);
});

test("boardLayout: dois componentes na mesma célula — o segundo vai para a coluna seguinte", () => {
  const l = boardLayout(doc([node("a", 0, 0), node("b", 30, 20)]));
  assert.notDeepEqual([l.nodes.get("a")!.col, l.nodes.get("a")!.row], [l.nodes.get("b")!.col, l.nodes.get("b")!.row]);
});

test("trilhas: vizinhas, na mesma linha à distância, em linhas e colunas diferentes e na mesma coluna", () => {
  const l = boardLayout(
    doc(
      [node("a", 0, 0), node("b", 300, 0), node("c", 900, 0), node("d", 600, 400), node("e", 0, 800), node("f", 300, 400)],
      [["a", "b"], ["a", "c"], ["a", "d"], ["a", "e"], ["c", "a"], ["f", "b"], ["e", "c"]],
    ),
  );
  assert.equal(l.traces.length, 7);
  assertClean(l);
  // a trilha começa na face do componente de origem voltada para o destino
  const ab = l.traces.find((t) => t.id === "c0")!;
  const a = l.nodes.get("a")!;
  assert.equal(ab.pts[0].x, a.x + a.hw);
});

test("trilhas paralelas no mesmo canal ganham pistas diferentes", () => {
  const l = boardLayout(doc([node("a", 0, 0), node("b", 0, 300), node("x", 600, 0), node("y", 600, 300)], [["a", "y"], ["b", "x"], ["a", "x"]]));
  assertClean(l);
  const xs = l.traces.flatMap((t) => t.pts.slice(1, -1).map((p) => p.x)).filter((x) => Math.abs(x - 170) < 80);
  assert.ok(new Set(xs.map((x) => Math.round(x))).size > 1, "as trilhas do canal entre as colunas não se sobrepõem");
});

test("endpoint: liga pelo dono e fica atrás dele", () => {
  const svc = node("svc", 0, 0);
  const ep = node("svc-get", 0, -60, "endpoint", { owner: "svc", w: 200, h: 44 });
  const l = boardLayout(doc([svc, ep, node("web", 400, 0, "client")], [["web", "svc-get"]]));
  assert.ok(!l.nodes.has("svc-get"));
  assert.equal(l.traces[0].to, "svc-get");
  const e = l.endpoints[0];
  assert.ok(e.y < l.nodes.get("svc")!.y - l.nodes.get("svc")!.hd);
});

test("zonas: cobrem os componentes do grupo; grupo de dentro com recuo maior", () => {
  const groups: Doc["groups"] = [
    { id: "vpc", label: "VPC", kind: "network", x: 0, y: 0, w: 800, h: 400 },
    { id: "k8s", label: "K8s", kind: "cluster", parent: "vpc", x: 0, y: 0, w: 400, h: 200 },
  ];
  const l = boardLayout(doc([node("a", 0, 0, "service", { parent: "k8s" }), node("b", 400, 0, "database", { parent: "vpc" })], [], groups));
  const vpc = l.zones.find((z) => z.id === "vpc")!;
  const k8s = l.zones.find((z) => z.id === "k8s")!;
  const a = l.nodes.get("a")!;
  assert.ok(k8s.x > vpc.x && k8s.y > vpc.y && k8s.x + k8s.w <= vpc.x + vpc.w);
  assert.ok(a.x - a.hw > k8s.x && a.x + a.hw < k8s.x + k8s.w);
  assert.ok(l.nodes.get("b")!.x < vpc.x + vpc.w);
});

test("exemplos de arquitetura: todas as trilhas limpas", () => {
  for (const ex of ARCH_EXAMPLES) {
    const d = ex.doc();
    const l = boardLayout(d);
    assertClean(l);
    assert.ok(l.traces.length > 0, ex.id);
  }
});

test("simplify e chamfer: tira o ponto do meio de um trecho reto e corta o canto a 45°", () => {
  assert.deepEqual(simplify([{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }]), [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }]);
  assert.deepEqual(chamfer([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }], 10), [{ x: 0, y: 0 }, { x: 90, y: 0 }, { x: 100, y: 10 }, { x: 100, y: 100 }]);
});

const cellOf = (d: Doc, id: string) => {
  const b = boardLayout(d).nodes.get(id)!;
  return [b.col, b.row];
};
const moved = (d: Doc, id: string, col: number, row: number) => {
  const r = applyOps(d, moveOps(d, boardLayout(d), id, col, row));
  assert.ok(r.results.every((x) => x.ok), JSON.stringify(r.results));
  return r.doc;
};

test("moveOps: para uma célula vazia, dentro e fora da grade, o componente cai exatamente nela", () => {
  const d = doc([node("a", 0, 0), node("b", 300, 0), node("c", 0, 200), node("d", 300, 200)]);
  assert.deepEqual(cellOf(moved(d, "a", 2, 1), "a"), [2, 1]);
  assert.deepEqual(cellOf(moved(d, "a", 1, 2), "a"), [1, 2]);
  // os outros não saem do lugar
  const m = moved(d, "a", 2, 1);
  assert.deepEqual([cellOf(m, "b"), cellOf(m, "c"), cellOf(m, "d")], [[1, 0], [0, 1], [1, 1]]);
});

test("moveOps: célula ocupada troca os dois de lugar", () => {
  const d = doc([node("a", 0, 0), node("b", 300, 0), node("c", 0, 200)]);
  const m = moved(d, "a", 1, 0);
  assert.deepEqual([cellOf(m, "a"), cellOf(m, "b")], [[1, 0], [0, 0]]);
});

test("moveOps: solto numa zona entra no grupo; fora das zonas fica no grupo dele; endpoints vão junto", () => {
  const groups: Doc["groups"] = [{ id: "g", label: "G", kind: "boundary", x: 280, y: -20, w: 260, h: 300 }];
  const ep = node("a-get", 0, -60, "endpoint", { owner: "a", w: 200, h: 44 });
  const d = doc([node("a", 0, 0), ep, node("b", 300, 0, "service", { parent: "g" }), node("c", 300, 200, "service", { parent: "g" })], [], groups);
  const m = moved(d, "a", 1, 1); // célula de c, dentro da zona g: troca com c e entra no grupo
  assert.equal(m.nodes.find((n) => n.id === "a")!.parent, "g");
  const a0 = d.nodes.find((n) => n.id === "a")!;
  const a1 = m.nodes.find((n) => n.id === "a")!;
  const e1 = m.nodes.find((n) => n.id === "a-get")!;
  assert.deepEqual([e1.x - ep.x, e1.y - ep.y], [a1.x - a0.x, a1.y - a0.y]);
  const out = moved(d, "b", 3, 0); // fora de qualquer zona: continua em g
  assert.equal(out.nodes.find((n) => n.id === "b")!.parent, "g");
});
