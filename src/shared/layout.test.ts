import assert from "node:assert/strict";
import { test } from "node:test";
import { isotonicPlace, layeredLayout, shelfPack } from "./layout";
import { applyOps, type Op } from "./ops";
import { emptyDoc, type Doc } from "./schema";
import { STORM_MAX_COLS } from "./storm";

const sz = () => 72;

test("isotonicPlace: respeita a distância mínima e fica o mais perto possível do desejado", () => {
  assert.deepEqual(isotonicPlace([0, 100, 200], [50, 50]), [0, 100, 200]);
  const p = isotonicPlace([100, 100, 100], [80, 80]);
  assert.ok(p[1] - p[0] >= 80 && p[2] - p[1] >= 80);
  assert.equal(p[1], 100); // o do meio fica onde queria, os vizinhos se afastam
});

test("layeredLayout: reordena para eliminar cruzamentos", () => {
  // a1→b2 e a2→b1 na ordem de declaração cruzariam
  const r = layeredLayout(["a1", "a2", "b1", "b2"], [["a1", "b2"], ["a2", "b1"]], sz, 40);
  assert.equal(r.crossings, 0);
  assert.equal(r.rank.get("b1"), 1);
});

test("layeredLayout: aresta de retorno (ciclo) não inverte o fluxo", () => {
  const r = layeredLayout(["a", "b", "c"], [["a", "b"], ["b", "c"], ["c", "a"]], sz, 40);
  assert.deepEqual([r.rank.get("a"), r.rank.get("b"), r.rank.get("c")], [0, 1, 2]);
});

test("layeredLayout: fonte é puxada para junto do destino em vez de ficar na coluna 0", () => {
  const r = layeredLayout(["x", "y", "z", "w"], [["x", "y"], ["y", "z"], ["w", "z"]], sz, 40);
  assert.equal(r.rank.get("w"), 1);
});

test("layeredLayout: pai alinhado à altura média dos filhos e sem sobreposição", () => {
  const r = layeredLayout(["p", "c1", "c2", "c3"], [["p", "c1"], ["p", "c2"], ["p", "c3"]], sz, 40);
  const mid = (id: string) => r.cross.get(id)! + 36;
  assert.equal(mid("p"), mid("c2"));
  const ys = ["c1", "c2", "c3"].map((i) => r.cross.get(i)!).sort((a, b) => a - b);
  assert.ok(ys[1] - ys[0] >= 72 + 40 && ys[2] - ys[1] >= 72 + 40);
});

test("layeredLayout: aresta longa não faz componentes se sobreporem e o resultado é determinístico", () => {
  const ids = ["a", "b", "c", "d", "e"];
  const edges: Array<[string, string]> = [["a", "b"], ["b", "c"], ["c", "d"], ["a", "d"], ["a", "e"], ["e", "d"]];
  const r1 = layeredLayout(ids, edges, sz, 40);
  const r2 = layeredLayout(ids, edges, sz, 40);
  assert.deepEqual([...r1.cross], [...r2.cross]);
  for (const col of r1.layers) {
    const ys = col.map((i) => r1.cross.get(i)!).sort((a, b) => a - b);
    ys.slice(1).forEach((y, i) => assert.ok(y - ys[i] >= 72 + 40));
  }
});

test("shelfPack: quebra em linhas dentro da largura", () => {
  const items = Array.from({ length: 6 }, (_, i) => ({ id: `i${i}`, w: 100, h: 50 }));
  const r = shelfPack(items, 330, 10);
  assert.equal(r.w, 320);
  assert.equal(r.at.get("i3")!.y, 60);
  assert.equal(r.h, 110);
});

const arch = (extra: Op[]): Doc => applyOps(emptyDoc("t"), [...extra, { op: "layout", direction: "LR" }]).doc;
const overlaps = (doc: Doc) => {
  const ns = doc.nodes;
  let c = 0;
  for (let i = 0; i < ns.length; i++)
    for (let j = i + 1; j < ns.length; j++) {
      const a = ns[i];
      const b = ns[j];
      if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) c++;
    }
  return c;
};

test("autoLayout: componentes sem conexão viram uma grade, não uma coluna", () => {
  const ops: Op[] = [{ op: "add_node", id: "a", label: "A" }, { op: "add_node", id: "b", label: "B" }, { op: "add_connection", from: "a", to: "b", type: "sync" }];
  for (let i = 0; i < 9; i++) ops.push({ op: "add_node", id: `s${i}`, label: `Solto ${i}` });
  const d = arch(ops);
  assert.equal(overlaps(d), 0);
  const xs = new Set(d.nodes.filter((n) => n.id.startsWith("s")).map((n) => n.x));
  assert.ok(xs.size >= 2, "mais de uma coluna de soltos");
  const ys = d.nodes.map((n) => n.y + n.h);
  const xe = d.nodes.map((n) => n.x + n.w);
  assert.ok(Math.max(...ys) < Math.max(...xe) * 1.5, "proporção razoável");
});

test("autoLayout: diagrama em camadas sem sobreposição e sem cruzar quando há solução", () => {
  const d = arch([
    ...["web", "api", "auth", "db", "cache", "q", "worker"].map((id): Op => ({ op: "add_node", id, label: id })),
    ...([["web", "api"], ["api", "auth"], ["api", "db"], ["api", "cache"], ["api", "q"], ["q", "worker"], ["worker", "db"]] as const).map(([from, to]): Op => ({ op: "add_connection", from, to, type: "sync" })),
  ]);
  assert.equal(overlaps(d), 0);
  const x = (id: string) => d.nodes.find((n) => n.id === id)!.x;
  assert.ok(x("web") < x("api") && x("api") < x("q") && x("q") < x("worker"));
});

test("timeline: contexto que alimenta o outro fica acima dele", () => {
  const ctx = (id: string): Op => ({ op: "add_group", id, label: id, kind: "context", subdomain: "core" });
  const base = applyOps(emptyDoc("t", "domain"), [
    ctx("cobranca"),
    ctx("pedidos"),
    { op: "add_node", id: "criar", label: "criar", ddd: { role: "command" }, parent: "pedidos" },
    { op: "add_node", id: "cobrar", label: "cobrar", ddd: { role: "command" }, parent: "cobranca" },
    { op: "add_connection", from: "criar", to: "cobrar", type: "dependency" },
  ]);
  const d = applyOps(base.doc, [{ op: "layout", style: "timeline" }]).doc;
  const y = (id: string) => d.groups.find((g) => g.id === id)!.y;
  assert.ok(y("pedidos") < y("cobranca"));
});

test("timeline: contexto largo quebra em faixas de no máximo STORM_MAX_COLS colunas", () => {
  const ops: Op[] = [{ op: "add_group", id: "c", label: "c", kind: "context", subdomain: "core" }];
  for (let i = 0; i < 12; i++) ops.push({ op: "add_node", id: `cmd${i}`, label: `cmd${i}`, ddd: { role: "command", step: i }, parent: "c" });
  const base = applyOps(emptyDoc("t", "domain"), ops);
  const d = applyOps(base.doc, [{ op: "layout", style: "timeline" }]).doc;
  const xs = new Set(d.nodes.map((n) => n.x));
  assert.equal(xs.size, STORM_MAX_COLS);
  assert.equal(new Set(d.nodes.map((n) => n.y)).size, 2);
  const g = d.groups[0];
  for (const n of d.nodes) assert.ok(n.x >= g.x && n.x + n.w <= g.x + g.w && n.y + n.h <= g.y + g.h);
});
