import assert from "node:assert/strict";
import { test } from "node:test";
import { jevCases } from "./jev.cases";
import { coverageGaps, judge } from "./logiceval";

const get = (nivel: string) => jevCases().find((c) => c.nivel === nivel)!;

test("os três algoritmos de referência são adequados: 0–2 perguntas, clareza ≥ 8, oráculo 100%", () => {
  for (const c of jevCases()) {
    const v = judge(c.doc, c.oraculo);
    assert.deepEqual(v.reasons, [], `${c.nivel}: ${v.questions.map((q) => q.q).join(" | ")}`);
    assert.ok(v.adequate && v.clarity >= 8 && v.representativeness >= 8);
    assert.equal(v.oracle.passed, c.oraculo.length);
  }
});

test("controle negativo: um diagrama sem frases, sem tipos e sem descrição gera muitas perguntas e é reprovado", () => {
  const c = get("complexo");
  for (const n of c.doc.nodes) if (n.logic) delete n.logic.text;
  for (const n of c.doc.nodes) if ((n.logic?.role === "input" || n.logic?.role === "output" || n.logic?.role === "variable")) delete n.logic.type;
  delete c.doc.description;
  const v = judge(c.doc, c.oraculo);
  assert.equal(v.adequate, false);
  assert.ok(v.questions.length > 10, `só ${v.questions.length} perguntas`);
  assert.ok(v.clarity < 3, `clareza ${v.clarity}`);
  assert.equal(v.representativeness, 10, "o desenho continua correto: o defeito é de leitura, não de lógica");
});

test("controle negativo: lógica que não representa o enunciado reprova no oráculo mesmo com o desenho limpo", () => {
  const c = get("complexo");
  // o enunciado diz "700 ou mais"; o desenho passa a exigir mais de 700
  for (const e of c.doc.connections) if (e.logic?.case === "score >= 700") e.logic.case = "score > 700";
  const v = judge(c.doc, c.oraculo);
  assert.equal(v.adequate, false);
  assert.ok(v.representativeness < 10);
  assert.ok(v.oracle.failed.some((f) => f.startsWith("score 700 é faixa alta")), v.oracle.failed.join(" | "));
});

test("controle negativo: sem cenário de falha e com um ramo nunca exercitado, o Executor pergunta", () => {
  const c = get("médio");
  c.doc.nodes = c.doc.nodes.filter((n) => n.id !== "caso-recusa" && n.id !== "caso-diretoria");
  delete c.doc.nodes.find((n) => n.id === "diretoria")!.logic!.examples; // o exemplo da própria regra também conta como cobertura
  const v = judge(c.doc, c.oraculo);
  const fontes = v.questions.map((q) => q.q).join(" | ");
  assert.match(fontes, /Fora do prazo/);
  assert.match(fontes, /Aprovação da diretoria/);
  assert.match(fontes, /dá errado/);
  assert.equal(v.adequate, false);
});

test("sem oráculo a representatividade não é verificada e o diagrama não é adequado", () => {
  const c = get("simples");
  const v = judge(c.doc, []);
  assert.equal(v.adequate, false);
  assert.match(v.reasons.join(";"), /sem oráculo/);
});

test("coverageGaps: aponta por nó o que nenhum exemplo ou cenário exercita (a marca «sem cenário» do quadro)", () => {
  const completo = get("médio");
  assert.equal(coverageGaps(completo.doc).size, 0, "o caso de referência cobre tudo");
  const c = get("médio");
  c.doc.nodes = c.doc.nodes.filter((n) => n.id !== "caso-recusa" && n.id !== "caso-diretoria");
  delete c.doc.nodes.find((n) => n.id === "diretoria")!.logic!.examples;
  const gaps = coverageGaps(c.doc);
  assert.match((gaps.get("recusado") ?? []).join(" "), /Fora do prazo/, "o fim «recusado» não é alcançado");
  assert.match((gaps.get("diretoria") ?? []).join(" "), /Aprovação da diretoria/, "a regra da diretoria não roda");
  assert.equal(gaps.has("auto"), false, "o que está coberto não é marcado");
});
