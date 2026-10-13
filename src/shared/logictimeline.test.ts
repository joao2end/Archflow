import assert from "node:assert/strict";
import { test } from "node:test";
import { runFlow, variableTimeline } from "./logic";
import { nodeCases } from "./nodes.cases";
import { emptyDoc } from "./schema";
import { applyOps } from "./ops";

test("a linha do tempo lista cada alteração da variável, na ordem, do valor inicial ao final", () => {
  const doc = nodeCases().find((c) => c.id === "fatorial")!.build();
  const tl = variableTimeline(runFlow(doc, { n: 4 }));
  const r = tl.find((t) => t.name === "resultado")!;
  assert.equal(r.events.length, 5); // 1 (preparar) + 4 voltas
  assert.deepEqual(r.events.map((e) => e.to), [1, 1, 2, 6, 24]);
  assert.equal(r.initial, undefined);
  assert.equal(r.final, 24);
  assert.deepEqual(r.events.map((e) => e.turn), [undefined, 1, 2, 3, 4]);
  assert.ok(r.events.every((e, i) => i === 0 || e.step > r.events[i - 1].step));
  assert.equal(tl[0].events.length >= tl[tl.length - 1].events.length, true);
});

test("a linha do tempo registra a tentativa de escrever numa variável travada", () => {
  const ops = [
    { op: "add_node", id: "inicio", label: "Início", logic: { role: "start" } },
    { op: "add_node", id: "a", label: "Fixa", logic: { role: "rule", then: ["preco := 10", "travar preco"] } },
    { op: "add_node", id: "b", label: "Tenta mudar", logic: { role: "rule", then: ["preco := 99"] } },
    { op: "add_node", id: "fim", label: "Fim", logic: { role: "end" } },
    { op: "add_connection", from: "inicio", to: "a" }, { op: "add_connection", from: "a", to: "b" }, { op: "add_connection", from: "b", to: "fim" },
  ];
  const doc = applyOps(emptyDoc("t", "logic"), ops as never).doc;
  const t = variableTimeline(runFlow(doc, {})).find((x) => x.name === "preco")!;
  assert.deepEqual(t.events.map((e) => e.to), [10]);
  assert.equal(t.final, 10);
  assert.equal(t.blockedAt.length, 1);
});
