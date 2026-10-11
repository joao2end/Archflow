import assert from "node:assert/strict";
import { test } from "node:test";
import { emptyDoc, type Doc, type LogicBranch, type LogicNodeSpec } from "./schema";
import { applyOps, validateDetailed, type Op } from "./ops";
import { checkExamples, edgeIdsOf, recordPaths, relatedTo, runFlow, usageOf, visitedIds } from "./logic";
import { ruleCard } from "./logiccard";

const node = (id: string, logic: LogicNodeSpec, label = id): Op => ({ op: "add_node", id, label, logic });
const edge = (from: string, to: string, branch?: LogicBranch): Op => ({ op: "add_connection", id: `${from}-${to}`, from, to, ...(branch ? { logic: { branch } } : {}) });
const build = (ops: Op[]): Doc => {
  const r = applyOps(emptyDoc("fluxo", "logic"), ops);
  assert.deepEqual(r.results.filter((x) => !x.ok), []);
  return r.doc;
};

const base = (): Op[] => [
  node("preco", { role: "fact", key: "preco" }),
  node("limite", { role: "fact", key: "limite" }),
  node("ini", { role: "start" }),
  node("d", { role: "decision", when: "preco > limite" }),
  node("corta", { role: "rule", then: ["preco := limite"] }),
  node("ok", { role: "end" }),
  edge("ini", "d"),
  edge("d", "corta", "sim"),
  edge("d", "ok", "nao"),
  edge("corta", "ok"),
];

test("o percurso de um cenário lista os passos e as setas usadas, na ordem", () => {
  const doc = build(base());
  const run = runFlow(doc, { preco: 150, limite: 100 });
  assert.deepEqual(visitedIds(run), ["ini", "d", "corta", "ok"]);
  assert.deepEqual(edgeIdsOf(doc, run), ["ini-d", "d-corta", "corta-ok"]);
  const run2 = runFlow(doc, { preco: 50, limite: 100 });
  assert.deepEqual(visitedIds(run2), ["ini", "d", "ok"]);
  assert.deepEqual(edgeIdsOf(doc, run2), ["ini-d", "d-ok"], "pelo 'não', a seta é outra");
});

test("o caminho gravado no cenário é conferido: se o fluxo passa a andar por outro lugar, o exemplo avisa onde divergiu", () => {
  const doc = build([...base(), node("caso", { role: "scenario", examples: [{ name: "corta", given: { preco: 150, limite: 100 }, expect: { preco: 100 } }] })]);
  const gravado = recordPaths(doc);
  const ex = gravado.nodes.find((n) => n.id === "caso")!.logic!.examples![0];
  assert.deepEqual(ex.path, ["ini", "d", "corta", "ok"]);
  assert.ok(checkExamples(gravado).every((r) => r.ok));
  // o fluxo muda: a decisão passa a olhar outra condição e o caminho gravado não bate mais
  gravado.nodes.find((n) => n.id === "d")!.logic!.when = "preco > 1000";
  const r = checkExamples(gravado).find((x) => x.node === "caso")!;
  assert.equal(r.ok, false);
  assert.match(r.problems.join(";"), /caminho diferente no passo 3: esperava "corta", foi por "ok"/);
  assert.ok(validateDetailed(gravado).some((i) => i.rule === "L004"));
});

test("path inválido é recusado pelas ops", () => {
  const r = applyOps(emptyDoc("x", "logic"), [node("c", { role: "scenario", examples: [{ name: "a", given: {}, expect: {}, path: [1] as unknown as string[] }] })]);
  assert.match(r.results[0].error!, /path deve ser uma lista de ids/);
});

test("dados acoplados ao fluxo: quais passos usam um dado e quais dados um passo usa", () => {
  const doc = build(base());
  const u = usageOf(doc);
  assert.deepEqual([...u.get("d")!.reads].sort(), ["limite", "preco"]);
  assert.deepEqual([...u.get("corta")!.writes], ["preco"]);
  assert.deepEqual([...relatedTo(doc, "preco")].sort(), ["corta", "d"]);
  assert.deepEqual([...relatedTo(doc, "corta")].sort(), ["limite", "preco"]);
  assert.deepEqual([...relatedTo(doc, "limite")], ["d", "corta"], "o limite é lido pela decisão e pela regra que corta");
});

test("o cartão da regra mostra os dados como etiquetas: lidos (contorno) e escritos (preenchidos); copias do item do laço viram uma linha", () => {
  const doc = build([
    ...base(),
    node("carrega", { role: "rule", then: ["custo := produto.custo", "margem := produto.margem", "preco := custo * (1 + margem)"] }),
  ]);
  const card = ruleCard(doc.nodes.find((n) => n.id === "carrega")!, { custo: "custo", margem: "margem" });
  const dados = card.sections.find((s) => s.kind === "usa")!;
  const por = new Map(dados.chips!.map((c) => [c.text, c.write]));
  assert.equal(por.get("custo"), true);
  assert.equal(por.get("preco"), true);
  assert.equal(por.has("produto"), true, "o item do laço entra como um dado só, sem uma etiqueta por campo");
  assert.equal(por.get("produto"), false);
  assert.ok(card.sections.find((s) => s.kind === "entao")!.lines.some((l) => l.text.startsWith("traz de produto:")));
  assert.ok(card.h > 80);
});
