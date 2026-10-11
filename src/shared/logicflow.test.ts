import assert from "node:assert/strict";
import { test } from "node:test";
import { emptyDoc, type Doc, type LogicBranch, type LogicNodeSpec } from "./schema";
import { applyOps, validateDetailed, type Op } from "./ops";
import { runFlow } from "./logic";

const node = (id: string, logic: LogicNodeSpec, label = id): Op => ({ op: "add_node", id, label, logic });
const edge = (from: string, to: string, branch?: LogicBranch, kase?: string): Op => ({ op: "add_connection", from, to, ...(branch || kase ? { logic: branch ? { branch } : { case: kase! } } : {}) });
const build = (ops: Op[]): Doc => {
  const r = applyOps(emptyDoc("fluxo", "logic"), ops);
  assert.deepEqual(r.results.filter((x) => !x.ok), []);
  return r.doc;
};
const rules = (doc: Doc) => validateDetailed(doc).filter((i) => i.rule !== "BASE").map((i) => i.rule);

test("decisão: segue por sim ou não conforme a condição", () => {
  const doc = build([
    node("i", { role: "start" }), node("d", { role: "decision", when: "x > 10" }), node("a", { role: "rule", then: ['r := "alto"'] }), node("b", { role: "rule", then: ['r := "baixo"'] }), node("f", { role: "end" }),
    edge("i", "d"), edge("d", "a", "sim"), edge("d", "b", "nao"), edge("a", "f"), edge("b", "f"),
  ]);
  assert.equal(runFlow(doc, { x: 50 }).env.r, "alto");
  assert.equal(runFlow(doc, { x: 3 }).env.r, "baixo");
  assert.equal(runFlow(doc, { x: 3 }).outcome, "ok");
});

test("escolha: segue pelo caso igual ao valor e, se nenhum, por outros", () => {
  const doc = build([
    node("i", { role: "start" }), node("s", { role: "switch", on: "tipo" }), node("a", { role: "rule", then: ["r := 1"] }), node("b", { role: "rule", then: ["r := 2"] }), node("o", { role: "end", outcome: "erro" }), node("f", { role: "end" }),
    edge("i", "s"), edge("s", "a", undefined, '"x"'), edge("s", "b", undefined, '"y"'), edge("s", "o", "outros"), edge("a", "f"), edge("b", "f"),
  ]);
  assert.equal(runFlow(doc, { tipo: "x" }).env.r, 1);
  assert.equal(runFlow(doc, { tipo: "y" }).env.r, 2);
  const out = runFlow(doc, { tipo: "z" });
  assert.equal(out.outcome, "erro");
  assert.equal(out.env.r, undefined);
});

test("loop com until: repete até a condição de parada e respeita o máximo", () => {
  const mk = (until: string | undefined, max?: number) =>
    build([
      node("i", { role: "start" }), node("l", { role: "loop", ...(until ? { until } : {}), ...(max ? { max } : {}) }), node("c", { role: "rule", then: ["n := n + 1"] }), node("f", { role: "end" }),
      edge("i", "l"), edge("l", "c", "repete"), edge("c", "l"), edge("l", "f", "segue"),
    ]);
  assert.equal(runFlow(mk("n >= 3"), { n: 0 }).env.n, 3);
  assert.equal(runFlow(mk(undefined, 5), { n: 0 }).env.n, 5);
  assert.equal(runFlow(mk("n >= 100", 4), { n: 0 }).env.n, 4, "o máximo corta antes da condição");
  const turns = runFlow(mk("n >= 3"), { n: 0 }).steps.filter((s) => s.role === "loop" && s.branch === "repete").map((s) => s.turn);
  assert.deepEqual(turns, [1, 2, 3]);
});

test("loop com foreach: uma volta por item, com o item no nome escolhido", () => {
  const doc = build([
    node("i", { role: "start" }), node("l", { role: "loop", foreach: "lista", as: "x" }), node("c", { role: "rule", then: ["soma := soma + x"] }), node("f", { role: "end" }),
    edge("i", "l"), edge("l", "c", "repete"), edge("c", "l"), edge("l", "f", "segue"),
  ]);
  assert.equal(runFlow(doc, { lista: [1, 2, 3, 4], soma: 0 }).env.soma, 10);
  assert.equal(runFlow(doc, { lista: [], soma: 7 }).env.soma, 7);
  assert.equal(rules(doc).includes("L021"), false, "a volta ao loop não é ciclo infinito");
});

test("paralelo: roda os dois ramos e só continua na junção", () => {
  const doc = build([
    node("i", { role: "start" }), node("p", { role: "fork" }), node("a", { role: "rule", then: ["a := 1"] }), node("b", { role: "rule", then: ["b := 2"] }), node("j", { role: "join" }), node("c", { role: "rule", then: ["t := a + b"] }), node("f", { role: "end" }),
    edge("i", "p"), edge("p", "a"), edge("p", "b"), edge("a", "j"), edge("b", "j"), edge("j", "c"), edge("c", "f"),
  ]);
  const r = runFlow(doc, {});
  assert.equal(r.env.t, 3);
  assert.equal(r.outcome, "ok");
});

test("erros do fluxo viram resultado, não exceção: seta faltando e fluxo que não termina", () => {
  const semNao = build([node("i", { role: "start" }), node("d", { role: "decision", when: "x > 1" }), node("a", { role: "rule", then: ["r := 1"] }), node("f", { role: "end" }), edge("i", "d"), edge("d", "a", "sim"), edge("a", "f")]);
  assert.match(runFlow(semNao, { x: 0 }).steps.find((s) => s.error)!.error!, /falta a seta "não"/);
  const infinito = build([node("i", { role: "start" }), node("a", { role: "rule", then: ["n := n + 1"] }), edge("i", "a"), edge("a", "a")]);
  assert.match(runFlow(infinito, { n: 0 }).steps.at(-1)!.error!, /não terminar/);
});

test("validação do fluxo: decisão sem não, beco sem saída, sem entrada, ciclo sem loop, switch sem outros", () => {
  const doc = build([
    node("i", { role: "start" }), node("d", { role: "decision", when: "x > 1" }), node("a", { role: "rule", then: ["r := 1"] }), node("b", { role: "rule", then: ["r := 2"] }), node("orfa", { role: "rule", then: ["r := 3"] }),
    node("s", { role: "switch", on: "x" }), node("f", { role: "end" }),
    edge("i", "d"), edge("d", "a", "sim"), edge("a", "b"), edge("b", "a"), edge("a", "s"), edge("s", "f", undefined, "1"),
  ]);
  const r = rules(doc);
  for (const code of ["L015", "L019", "L020", "L021", "L016"]) assert.ok(r.includes(code), `faltou ${code}: ${r}`);
});

test("setas: saída incompatível com o papel e case fora de escolha são recusados", () => {
  const doc = build([node("i", { role: "start" }), node("a", { role: "rule", then: ["r := 1"] }), node("f", { role: "end" }), edge("i", "a"), edge("a", "f")]);
  doc.connections[1].logic = { branch: "sim" };
  assert.ok(rules(doc).includes("L023"));
  const bad = applyOps(emptyDoc("x", "logic"), [node("a", { role: "rule" }), node("b", { role: "end" }), { op: "add_connection", from: "a", to: "b", logic: { branch: "talvez" as LogicBranch } }]);
  assert.match(bad.results[2].error!, /logic.branch inválido/);
  const arch = applyOps(emptyDoc("a"), [{ op: "add_node", id: "x", label: "X" }, { op: "add_node", id: "y", label: "Y" }, { op: "add_connection", from: "x", to: "y", logic: { branch: "sim" } }]);
  assert.match(arch.results[2].error!, /modo "logic"/);
});

test("ops: decisão exige condição, escolha aceita por valor ou por condições, loop exige parada; o rótulo da seta vem da saída", () => {
  const r = applyOps(emptyDoc("x", "logic"), [node("d", { role: "decision" }), node("s", { role: "switch" }), node("l", { role: "loop" }), node("ok", { role: "decision", when: "a" }), node("z", { role: "end" }), { op: "add_connection", from: "ok", to: "z", logic: { branch: "nao" } }]);
  assert.match(r.results[0].error!, /precisa de condição/);
  assert.equal(r.results[1].ok, true, "escolha sem 'on' é por condições (faixas)");
  assert.match(r.results[2].error!, /precisa de parada/);
  assert.equal(r.doc.connections[0].label, "não");
});

test("layout em fluxo: camadas de cima para baixo, setas que pulam contornam por fora, sem sobreposição", () => {
  const doc = build([
    node("i", { role: "start" }), node("d", { role: "decision", when: "x > 1" }), node("a", { role: "rule", then: ["r := 1"] }), node("d2", { role: "decision", when: "x > 2" }), node("f", { role: "end" }),
    node("dado", { role: "fact", key: "x" }),
    edge("i", "d"), edge("d", "a", "sim"), edge("d", "d2", "nao"), edge("a", "d2"), edge("d2", "f", "sim"), edge("d2", "f", "nao"),
  ]);
  const { doc: laid } = applyOps(doc, [{ op: "layout" }]);
  const y = (id: string) => laid.nodes.find((n) => n.id === id)!.y;
  assert.ok(y("i") < y("d") && y("d") < y("a") && y("a") < y("d2") && y("d2") < y("f"));
  const skip = laid.connections.find((c) => c.from === "d" && c.to === "d2")!;
  assert.ok(skip.waypoints?.length, "o 'não' que pula a regra contorna por fora");
  for (const [i, a] of laid.nodes.entries())
    for (const b of laid.nodes.slice(i + 1)) assert.ok(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y, `${a.id} sobrepõe ${b.id}`);
});
