import assert from "node:assert/strict";
import { test } from "node:test";
import { emptyDoc, type Doc, type LogicNodeSpec } from "./schema";
import { applyOps, validateDetailed, type Op } from "./ops";
import { checkExamples, runFlow } from "./logic";

const node = (id: string, logic: LogicNodeSpec): Op => ({ op: "add_node", id, label: id, logic });
const edge = (from: string, to: string, kase?: string, branch?: "outros"): Op => ({ op: "add_connection", from, to, ...(kase ? { logic: { case: kase } } : branch ? { logic: { branch } } : {}) });
const build = (ops: Op[]): Doc => {
  const r = applyOps(emptyDoc("faixas", "logic"), ops);
  assert.deepEqual(r.results.filter((x) => !x.ok), []);
  return r.doc;
};

/** Faixas de preço: a primeira condição verdadeira, na ordem das setas, escolhe o caminho. */
const faixas = (): Doc =>
  build([
    node("i", { role: "start" }),
    node("s", { role: "switch", text: "Em que faixa está o preço?", examples: [{ name: "barato", given: { preco: 5 }, expect: { caminho: "preco < 10" } }, { name: "caro", given: { preco: 500 }, expect: { caminho: "outros" } }] }),
    node("a", { role: "rule", then: ['faixa := "barata"'] }),
    node("b", { role: "rule", then: ['faixa := "media"'] }),
    node("c", { role: "rule", then: ['faixa := "cara"'] }),
    node("f", { role: "end" }),
    edge("i", "s"),
    edge("s", "a", "preco < 10"),
    edge("s", "b", "preco < 100"),
    edge("s", "c", undefined, "outros"),
    edge("a", "f"),
    edge("b", "f"),
    edge("c", "f"),
  ]);

test("escolha por condições (sem 'on'): vale a primeira seta cuja condição for verdadeira, na ordem das setas", () => {
  const doc = faixas();
  assert.equal(runFlow(doc, { preco: 5 }).env.faixa, "barata", "5 cabe nas duas primeiras: vale a primeira");
  assert.equal(runFlow(doc, { preco: 50 }).env.faixa, "media");
  assert.equal(runFlow(doc, { preco: 500 }).env.faixa, "cara", "nenhuma vale: outros");
  assert.ok(checkExamples(doc).every((r) => r.ok), JSON.stringify(checkExamples(doc).filter((r) => !r.ok).map((r) => r.problems)));
  assert.deepEqual(validateDetailed(doc).filter((i) => i.severity === "erro"), []);
});

test("a seta de uma faixa mostra a condição em português", () => {
  const doc = faixas();
  assert.match(doc.connections.find((c) => c.to === "a")!.label!, /preco < 10|preço < 10/);
});

test("escolha por condições sem 'outros' e sem condição verdadeira vira erro no fluxo, com a mensagem certa", () => {
  const doc = build([node("i", { role: "start" }), node("s", { role: "switch" }), node("a", { role: "rule", then: ["x := 1"] }), node("f", { role: "end" }), edge("i", "s"), edge("s", "a", "preco < 10"), edge("a", "f")]);
  const r = runFlow(doc, { preco: 99 });
  assert.match(r.steps.find((s) => s.error)!.error!, /nenhum caso vale/);
  assert.ok(validateDetailed(doc).some((i) => i.rule === "L016" && /outros/.test(i.message)));
});

test("escolha por valor (com 'on') continua igual: compara o valor com cada caso", () => {
  const doc = build([node("i", { role: "start" }), node("s", { role: "switch", on: "tipo" }), node("a", { role: "rule", then: ["x := 1"] }), node("f", { role: "end" }), edge("i", "s"), edge("s", "a", '"a"'), edge("s", "f", undefined, "outros"), edge("a", "f")]);
  assert.equal(runFlow(doc, { tipo: "a" }).env.x, 1);
  assert.equal(runFlow(doc, { tipo: "z" }).env.x, undefined);
});
