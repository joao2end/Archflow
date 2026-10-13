import assert from "node:assert/strict";
import { test } from "node:test";
import { emptyDoc, isDataRole, type NodeEl } from "./schema";
import { applyOps, normalizeDoc, validateDetailed, type Op } from "./ops";
import { migrateFacts } from "./logic";

const data = (id: string, role: "input" | "output" | "variable", key: string, extra: object = {}): Op => ({ op: "add_node", id, label: id, logic: { role, key, type: "number", ...extra } });
const step = (id: string, role: "start" | "end" | "rule", extra: object = {}): Op => ({ op: "add_node", id, label: id, logic: { role, ...extra } as never });

test("o papel `fact` foi dividido: input, output e variable existem e `fact` é recusado com a explicação", () => {
  assert.ok(isDataRole("input") && isDataRole("output") && isDataRole("variable") && !isDataRole("rule"));
  const r = applyOps(emptyDoc("t", "logic"), [{ op: "add_node", id: "x", label: "X", logic: { role: "fact" } as never }]);
  assert.equal(r.results[0].ok, false);
  assert.match(r.results[0].error!, /dividido em "input".*"output".*"variable"/);
});

test("output não tem valor fixo; input e variable têm", () => {
  const ok = (op: Op) => applyOps(emptyDoc("t", "logic"), [op]).results[0].ok;
  assert.equal(ok(data("a", "input", "a", { value: 1 })), true);
  assert.equal(ok(data("b", "variable", "b", { value: 0 })), true);
  assert.equal(ok(data("c", "output", "c", { value: 1 })), false);
});

const legacy = (id: string, key: string) => ({ id, label: id, kind: "logic", x: 0, y: 0, w: 10, h: 10, logic: { role: "fact", key, type: "number" } });
const flow = (id: string, logic: object) => ({ id, label: id, kind: "logic", x: 0, y: 0, w: 10, h: 10, logic });

test("arquivo antigo com `fact` abre classificado: nunca escrito = input; conferido no cenário = output; escrito e lido no meio = variable", () => {
  const doc = normalizeDoc({
    title: "t", mode: "logic",
    nodes: [
      legacy("preco", "preco"), legacy("bruto", "bruto"), legacy("total", "total"), legacy("sobra", "sobra"),
      flow("ini", { role: "start" }),
      flow("a", { role: "rule", then: ["bruto := preco * 2"] }),
      flow("b", { role: "rule", then: ["total := bruto + 1", "sobra := 1"] }),
      flow("fim", { role: "end" }),
      flow("cen", { role: "scenario", examples: [{ name: "c", given: { preco: 1 }, expect: { total: 3 } }] }),
    ],
    connections: [{ id: "1", from: "ini", to: "a", type: "data" }, { id: "2", from: "a", to: "b", type: "data" }, { id: "3", from: "b", to: "fim", type: "data" }],
  });
  const role = (id: string) => doc.nodes.find((n: NodeEl) => n.id === id)!.logic!.role;
  assert.equal(role("preco"), "input");
  assert.equal(role("bruto"), "variable"); // escrito pela ação a e lido pela b
  assert.equal(role("total"), "output"); // o cenário confere
  assert.equal(role("sobra"), "output"); // escrito e ninguém lê
  assert.equal(doc.nodes.some((n: NodeEl) => (n.logic as { role: string } | undefined)?.role === "fact"), false);
});

test("migrateFacts não mexe em diagrama sem `fact` e `all` reclassifica pelo uso", () => {
  const nodes = [legacy("x", "x") as unknown as NodeEl];
  nodes[0].logic!.role = "input";
  assert.equal(migrateFacts(nodes, []), nodes);
  assert.equal(migrateFacts(nodes, [], true)[0].logic!.role, "input"); // ninguém escreve: continua input
});

test("L029/L030/L031: entrada escrita, resultado nunca escrito e variável sem valor avisam; o certo não", () => {
  const build = (ops: Op[]) => applyOps(emptyDoc("t", "logic"), ops).doc;
  const ids = (ops: Op[]) => validateDetailed(build(ops)).map((i) => i.rule);
  const flowOps = (then: string[]): Op[] => [step("ini", "start"), step("a", "rule", { then }), step("fim", "end"), { op: "add_connection", from: "ini", to: "a" }, { op: "add_connection", from: "a", to: "fim" }];
  assert.ok(ids([data("x", "input", "x"), ...flowOps(["x := 1"])]).includes("L029"));
  assert.ok(ids([data("y", "output", "y"), ...flowOps(["z := 1"])]).includes("L030"));
  assert.ok(ids([data("v", "variable", "v"), data("o", "output", "o"), ...flowOps(["o := v + 1"])]).includes("L031"));
  const clean = ids([data("ent", "input", "ent"), data("v", "variable", "v", { value: 0 }), data("o", "output", "o"), ...flowOps(["v := ent + 1", "o := v * 2"])]);
  for (const r of ["L029", "L030", "L031"]) assert.ok(!clean.includes(r), r);
});
