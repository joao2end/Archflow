import assert from "node:assert/strict";
import { test } from "node:test";
import { emptyDoc, type Doc, type LogicNodeSpec } from "./schema";
import { applyOps, type Op } from "./ops";
import { dataNodes, logicIssues } from "./logic";
import { declareDataOp, missingData } from "./logicquick";

const node = (id: string, logic: LogicNodeSpec, x = 0, y = 0): Op => ({ op: "add_node", id, label: id, x, y, logic });
const build = (ops: Op[]): Doc => {
  const r = applyOps(emptyDoc("frete", "logic"), ops);
  assert.deepEqual(r.results.filter((x) => !x.ok), []);
  return r.doc;
};

test("efeito com dado novo: o escrito vira Output com o tipo do valor; o lido vira Input com o tipo da conta", () => {
  const doc = build([node("i", { role: "start" })]);
  assert.deepEqual(missingData(doc, "frete := total * 0.1", "statement"), [
    { name: "frete", role: "output", type: "number" },
    { name: "total", role: "input", type: "number" },
  ]);
  assert.deepEqual(missingData(doc, 'nivel := "ouro"', "statement"), [{ name: "nivel", role: "output", type: "string" }]);
});

test("condição: o tipo vem do valor comparado; dado lógico solto em E/OU é boolean; sem pista fica sem tipo", () => {
  const doc = build([node("i", { role: "start" })]);
  assert.deepEqual(missingData(doc, "total >= 200", "expr"), [{ name: "total", role: "input", type: "number" }]);
  assert.deepEqual(missingData(doc, 'vip e nivel = "ouro"', "expr"), [
    { name: "vip", role: "input", type: "boolean" },
    { name: "nivel", role: "input", type: "string" },
  ]);
  assert.deepEqual(missingData(doc, "a = b", "expr"), [
    { name: "a", role: "input" },
    { name: "b", role: "input" },
  ]);
});

test("nome declarado, sintaxe quebrada ou campo de objeto não são oferecidos", () => {
  const doc = build([node("total", { role: "input", key: "total", type: "number" })]);
  assert.deepEqual(missingData(doc, "total >= 200", "expr"), []);
  assert.deepEqual(missingData(doc, "total >= ", "expr"), []);
  assert.deepEqual(missingData(doc, "pedido.valor > 1", "expr"), []);
  // erro de digitação: a sugestão vem junto (a interface oferece trocar OU criar)
  assert.deepEqual(missingData(doc, "totl > 1", "expr"), [{ name: "totl", role: "input", type: "number", suggestion: "total" }]);
});

test("declarar o dado tira o aviso L007/L002 e o novo nasce embaixo do último dado", () => {
  let doc = build([
    node("i", { role: "start" }, 300, 0),
    node("r", { role: "rule", then: ["frete := 0"] }, 300, 120),
    node("total", { role: "input", key: "total", type: "number" }, 0, 0),
    { op: "add_connection", from: "i", to: "r" },
  ]);
  const warns = (d: Doc) => logicIssues(d).filter((p) => p.rule === "L007" && p.message.includes("frete"));
  assert.equal(warns(doc).length, 1);
  const [m] = missingData(doc, "frete := 0", "statement");
  doc = applyOps(doc, [declareDataOp(doc, m)]).doc;
  assert.equal(warns(doc).length, 0);
  const frete = dataNodes(doc).find((n) => n.logic!.key === "frete")!;
  const total = doc.nodes.find((n) => n.id === "total")!;
  assert.equal(frete.logic!.role, "output");
  assert.equal(frete.logic!.type, "number");
  assert.equal(frete.x, total.x);
  assert.ok(frete.y >= total.y + total.h, "não cai em cima do dado de cima");
});
