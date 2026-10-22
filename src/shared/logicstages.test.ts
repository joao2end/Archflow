import assert from "node:assert/strict";
import { test } from "node:test";
import { checkExamples, runFlow } from "./logic";
import { STAGE_H, STAGE_W, hiddenBy, projectStages, stageOrder, stageSummary } from "./logicstages";
import { applyOps, type Op } from "./ops";
import { emptyDoc, type Doc, type LogicBranch, type LogicNodeSpec } from "./schema";

const node = (id: string, logic: LogicNodeSpec, parent?: string): Op => ({ op: "add_node", id, label: id, logic, ...(parent ? { parent } : {}) });
const edge = (from: string, to: string, branch?: LogicBranch): Op => ({ op: "add_connection", id: `${from}-${to}`, from, to, ...(branch ? { logic: { branch } } : {}) });
const build = (ops: Op[]): Doc => {
  const r = applyOps(emptyDoc("frete", "logic"), ops);
  assert.deepEqual(r.results.filter((x) => !x.ok), []);
  return r.doc;
};

// início → [etapa «Frete»: decisão → grátis | fixo] → [etapa «Total»: soma] → fim
const frete = (collapsed = false): Doc =>
  build([
    { op: "add_group", id: "e-frete", label: "Frete", stage: { text: "Decide o frete pelo total", collapsed } },
    { op: "add_group", id: "e-total", label: "Total", stage: {} },
    node("total", { role: "input", key: "total" }),
    node("frete", { role: "variable", key: "frete" }),
    node("pagar", { role: "output", key: "pagar" }),
    node("ini", { role: "start" }),
    node("d", { role: "decision", when: "total >= 200", examples: [{ name: "a", given: { total: 300 }, expect: { caminho: "sim" } }] }, "e-frete"),
    node("gratis", { role: "rule", then: ["frete := 0"] }, "e-frete"),
    node("fixo", { role: "rule", then: ["frete := 15"] }, "e-frete"),
    node("soma", { role: "rule", then: ["pagar := total + frete"] }, "e-total"),
    node("fim", { role: "end" }),
    node("caso", { role: "scenario", examples: [{ name: "grande", given: { total: 250 }, expect: { pagar: 250 } }] }),
    edge("ini", "d"),
    edge("d", "gratis", "sim"),
    edge("d", "fixo", "nao"),
    edge("gratis", "soma"),
    edge("fixo", "soma"),
    edge("soma", "fim"),
    { op: "layout" },
  ]);

test("etapa recolhida: os passos somem do quadro e as setas que cruzavam a borda passam a ligar o cartão", () => {
  const doc = frete(true);
  assert.deepEqual([...hiddenBy(doc).keys()].sort(), ["d", "fixo", "gratis"]);
  const view = projectStages(doc);
  assert.ok(!view.nodes.some((n) => n.parent === "e-frete"));
  const pairs = view.connections.map((c) => `${c.from}>${c.to}`).sort();
  // gratis→soma e fixo→soma viram uma seta só do cartão; as de dentro (d→gratis, d→fixo) somem
  assert.deepEqual(pairs, ["e-frete>soma", "ini>e-frete", "soma>fim"]);
  const g = view.groups.find((x) => x.id === "e-frete")!;
  assert.equal(g.w, STAGE_W);
  assert.equal(g.h, STAGE_H);
  const aberta = frete(false);
  assert.equal(projectStages(aberta), aberta, "sem etapa recolhida, o próprio doc");
});

test("o layout trata a etapa recolhida como um passo e a aberta como moldura dos passos", () => {
  const fechada = frete(true);
  const g = fechada.groups.find((x) => x.id === "e-frete")!;
  const ini = fechada.nodes.find((n) => n.id === "ini")!;
  const soma = fechada.nodes.find((n) => n.id === "soma")!;
  assert.equal(g.auto, false);
  assert.ok(g.y > ini.y && g.y + g.h < soma.y, "o cartão fica entre o início e o passo seguinte");
  const aberta = applyOps(fechada, [{ op: "update", id: "e-frete", patch: { stage: { text: "Decide o frete pelo total", collapsed: false } } }, { op: "layout" }]).doc;
  const ga = aberta.groups.find((x) => x.id === "e-frete")!;
  for (const id of ["d", "gratis", "fixo"]) {
    const n = aberta.nodes.find((x) => x.id === id)!;
    assert.ok(n.x >= ga.x && n.y >= ga.y && n.x + n.w <= ga.x + ga.w && n.y + n.h <= ga.y + ga.h, `${id} dentro da moldura`);
  }
});

test("recolher não muda a execução nem os exemplos", () => {
  const a = frete(false);
  const b = frete(true);
  assert.deepEqual(runFlow(a, { total: 120 }).env, runFlow(b, { total: 120 }).env);
  assert.ok(checkExamples(b).every((r) => r.ok));
});

test("resumo da etapa: passos, o que lê de fora, o que escreve, exemplos e cenários que passam", () => {
  const doc = frete(true);
  const s = stageSummary(doc, "e-frete");
  assert.equal(s.steps, 3);
  assert.equal(s.decisions, 1);
  assert.equal(s.actions, 2);
  assert.deepEqual(s.reads, ["total"]);
  assert.deepEqual(s.writes, ["frete"]);
  assert.equal(s.status, "ok");
  assert.equal(s.scenarios, 1);
  assert.deepEqual(stageSummary(doc, "e-total").reads, ["frete", "total"]);
});

test("etapas na ordem em que o fluxo chega nelas", () => {
  assert.deepEqual(stageOrder(frete()).map((g) => g.id), ["e-frete", "e-total"]);
});

test("stage só existe no modo logic e só em grupos, com text e collapsed", () => {
  const arch = applyOps(emptyDoc("x"), [{ op: "add_group", label: "A", stage: {} }]);
  assert.match(arch.results[0].error!, /modo "logic"/);
  const doc = frete();
  const bad = applyOps(doc, [
    { op: "update", id: "e-frete", patch: { stage: { collapsed: "sim" } } },
    { op: "update", id: "d", patch: { stage: {} } },
    { op: "update", id: "e-frete", patch: { stage: { cor: 1 } } },
  ]);
  assert.match(bad.results[0].error!, /collapsed/);
  assert.match(bad.results[1].error!, /só vale em grupos/);
  assert.match(bad.results[2].error!, /"cor"/);
  assert.equal(doc.groups.find((g) => g.id === "e-frete")!.tag, "ETAPA");
});
