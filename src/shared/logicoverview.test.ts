import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { dataContract, edgeCoverage, logicSummary, pairs, scenarioMatrix } from "./logicoverview";
import type { Doc } from "./schema";

const preco = (): Doc => JSON.parse(readFileSync("examples/exemplos-logic/precificacao.archflow.json", "utf8"));
const busca = (): Doc => JSON.parse(readFileSync("examples/exemplos-algoritmos/busca-binaria.archflow.json", "utf8"));

test("contrato: entradas, resultados e variáveis com o nome das expressões", () => {
  const c = dataContract(busca());
  assert.deepEqual(c.inputs.map((x) => x.key), ["v", "x"]);
  assert.deepEqual(c.outputs.map((x) => x.key), ["indice"]);
  assert.deepEqual(c.variables.map((x) => x.key).sort(), ["fim", "inicio", "meio"]);
  assert.equal(c.inputs[0].type, "lista");
});

test("matriz: um exemplo de cenário por linha, com o que saiu e as etapas por onde passou", () => {
  const m = scenarioMatrix(preco());
  assert.ok(m.length >= 10);
  assert.ok(m.every((r) => r.ok));
  const falha = m.filter((r) => r.failure);
  assert.ok(falha.length >= 3 && falha.every((r) => r.outcome === "erro"));
  const lucro = m.find((r) => r.label.startsWith("Lucro"))!;
  assert.deepEqual(lucro.got, lucro.expect, "o que saiu bate com o esperado");
  assert.deepEqual(lucro.stages.slice(0, 2), ["Validar o produto", "Preço de partida"]);
  assert.ok(!lucro.stages.some((s, i) => s === lucro.stages[i - 1]), "sem repetir etapas seguidas");
});

test("cobertura por seta: conta cenários por saída de decisão; seta sem cenário fica com 0", () => {
  const doc = busca();
  const cov = edgeCoverage(doc);
  assert.equal(cov.get("ini-to-prepara"), undefined, "seta sem escolha não entra");
  assert.ok((cov.get("enquanto-to-acha-meio") ?? 0) >= 2);
  assert.equal(cov.get("dentro-to-achou"), 2);
  assert.ok([...cov.values()].every((v) => v >= 0));
});

test("resumo: entradas, saídas, etapas e placar", () => {
  const s = logicSummary(preco());
  assert.equal(s.title, "Engine de precificação");
  assert.equal(s.stages.length, 7);
  assert.equal(s.stages[0].label, "Validar o produto");
  assert.equal(s.scenarios.ok, s.scenarios.total);
  assert.ok(s.outputs.includes("preco"));
  assert.equal(pairs({ a: 1, b: "x", desfecho: "ok" }, ["desfecho"]), 'a = 1 · b = "x"');
});
