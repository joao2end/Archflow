import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { parseExpr, withValues } from "./expr";
import { runFlow } from "./logic";
import { jumpsFrom, loopTurns, nextVisit, playSteps, storyAt, storyOf, valuesAfter, visitsUpTo, whyOf } from "./logicdebug";
import { nodeCases } from "./nodes.cases";
import type { Doc } from "./schema";

const busca = (): Doc => JSON.parse(readFileSync("examples/exemplos-algoritmos/busca-binaria.archflow.json", "utf8"));
const fatorial = () => nodeCases().find((c) => c.id === "fatorial")!.build();

test("a expressão com os valores do momento: índice resolvido, e cada parte de um E/OU marcada", () => {
  assert.equal(withValues(parseExpr("v[meio] < x"), { v: [1, 3, 5], meio: 1, x: 4 }), "3 < 4");
  assert.equal(withValues(parseExpr("a > 0 e b = \"x\""), { a: 2, b: "y" }), '2 > 0 ✔ e "y" = "x" ✘');
  assert.equal(withValues(parseExpr("piso((inicio + fim) / 2)"), { inicio: 0, fim: 5 }), "piso((0 + 5) / 2)");
  assert.equal(withValues(parseExpr("tamanho(v) > 3"), { v: Array.from({ length: 10 }, (_, i) => i) }), "tamanho([0, 1, 2, 3, 4, … (10 itens)]) > 3");
  assert.equal(withValues(parseExpr("nada > 1"), {}), "sem valor > 1", "dado ausente não quebra");
});

test("só a reprodução guarda os dados de antes de cada passo; a validação continua sem cópias", () => {
  const doc = busca();
  assert.equal(runFlow(doc, { v: [1, 3, 5], x: 3 }).steps.some((s) => s.before), false);
  const run = runFlow(doc, { v: [1, 3, 5], x: 3 }, { trace: true });
  const steps = playSteps(run);
  assert.ok(steps.every((s) => s.before));
  const meio = steps.findIndex((s) => s.rule === "acha-meio");
  assert.equal(steps[meio].before!.meio, undefined);
  assert.equal(valuesAfter(run, meio).meio, 1);
  assert.deepEqual(valuesAfter(run, steps.length - 1), run.env);
});

test("o porquê de uma decisão traz a condição com os valores e a resposta", () => {
  const doc = busca();
  const run = runFlow(doc, { v: [1, 3, 5, 7], x: 5 }, { trace: true });
  const steps = playSteps(run);
  const d = steps.find((s) => s.rule === "menor")!;
  const why = whyOf(doc, d);
  assert.equal(why.lines[0].code, "v[meio] < x");
  assert.equal(why.lines[0].values, "5 < 5");
  assert.equal(why.answer, "não");
  const acao = whyOf(doc, steps.find((s) => s.rule === "acha-meio")!);
  assert.equal(acao.lines[0].values, "meio := piso((0 + 4) / 2)");
});

test("o porquê de um laço com parada mostra a condição com os valores e a volta", () => {
  const doc = fatorial();
  const steps = playSteps(runFlow(doc, { n: 3 }, { trace: true }));
  const voltas = steps.filter((s) => s.rule === "volta");
  assert.equal(whyOf(doc, voltas[0]).answer, "ainda não parou: volta 1");
  assert.equal(whyOf(doc, voltas[0]).lines[0].values, "1 > 3");
  assert.equal(whyOf(doc, voltas.at(-1)!).answer, "parou: segue");
});

test("as voltas agrupam os passos, cada uma com o que mudou nela", () => {
  const steps = playSteps(runFlow(fatorial(), { n: 3 }, { trace: true }));
  const { turns, turnOf } = loopTurns(steps);
  assert.deepEqual(turns.map((t) => t.turn), [1, 2, 3]);
  assert.ok(turns.every((t) => t.depth === 0 && t.to === t.from + 1));
  assert.deepEqual(turns[0].changed.sort(), ["i", "resultado"]);
  const sai = steps.findIndex((s) => s.rule === "volta" && s.branch === "segue");
  assert.equal(turnOf[sai], undefined, "a saída do laço já é fora dele");
  assert.equal(turnOf[0], undefined);
});

test("laço dentro de laço: a volta de dentro pertence à de fora e recomeça a contagem", () => {
  const doc = JSON.parse(readFileSync("examples/exemplos-algoritmos/distancia-edicao.archflow.json", "utf8")) as Doc;
  const steps = playSteps(runFlow(doc, { de: "ab", para: "abc" }, { trace: true }));
  const { turns, turnOf } = loopTurns(steps);
  const linhas = turns.filter((t) => t.loop === "l-linhas");
  const colunas = turns.filter((t) => t.loop === "l-colunas");
  assert.equal(linhas.length, 2);
  assert.ok(colunas.length >= 6);
  for (const c of colunas) {
    const pai = turns[c.parent!];
    assert.equal(pai.loop, "l-linhas");
    assert.ok(c.depth === 1 && c.from > pai.from && c.to <= pai.to);
  }
  assert.deepEqual(colunas.filter((c) => c.parent === turns.indexOf(linhas[1])).map((c) => c.turn), [1, 2, 3], "recomeça a cada linha");
  const k = colunas[1].from + 1;
  assert.equal(turnOf[k], turns.indexOf(colunas[1]));
  const j = jumpsFrom(steps, k);
  assert.equal(j.loop?.id, "l-colunas");
  assert.equal(j.loop?.turns, 3, "conta só as voltas desta linha");
  assert.equal(steps[j.exitLoop!].rule, "l-colunas");
});

test("saltos: próxima mudança, próxima volta, sair do laço e próxima passagem por um nó", () => {
  const steps = playSteps(runFlow(fatorial(), { n: 3 }, { trace: true }));
  const primeiraVolta = steps.findIndex((s) => s.rule === "volta");
  const j = jumpsFrom(steps, primeiraVolta);
  assert.equal(steps[j.nextChange!].rule, "multiplica");
  assert.equal(j.loop?.turns, 3);
  assert.equal(j.loop?.turn, 1);
  assert.equal(steps[j.nextTurn!].turn, 2);
  assert.equal(j.prevTurn, undefined);
  assert.equal(steps[j.exitLoop!].branch, "segue");
  const dentro = jumpsFrom(steps, primeiraVolta + 1);
  assert.equal(dentro.prevTurn, primeiraVolta, "do meio da volta, «volta anterior» vai ao começo desta");
  const m = nextVisit(steps, "multiplica", primeiraVolta + 1)!;
  assert.ok(m > primeiraVolta + 1 && steps[m].rule === "multiplica");
  assert.equal(nextVisit(steps, "multiplica", steps.length - 1), primeiraVolta + 1, "depois da última, recomeça");
  const v = visitsUpTo(steps, steps.length - 1).get("volta")!;
  assert.equal(v.count, 4);
});

test("modo Explicar: com etapas, uma passagem por etapa vira um momento com o saldo dos dados", () => {
  const doc = JSON.parse(readFileSync("examples/exemplos-logic/precificacao.archflow.json", "utf8")) as Doc;
  const sc = doc.nodes.find((n) => n.logic?.role === "scenario" && n.label.startsWith("Aumento"))!;
  const run = runFlow(doc, sc.logic!.examples![0].given, { trace: true });
  const story = storyOf(doc, run);
  assert.equal(story[0].kind, "start");
  assert.equal(story.at(-1)!.kind, "end");
  const stages = story.filter((s) => s.kind === "stage").map((s) => s.title);
  assert.deepEqual(stages.slice(0, 3), ["Validar o produto", "Preço de partida", "Piso e variação"]);
  assert.ok(story.length < playSteps(run).length / 2, `${story.length} momentos para ${playSteps(run).length} passos`);
  const arred = story.find((s) => s.title === "Arredondamento")!;
  assert.ok(arred.changes.some((c) => c.name === "preco"));
  assert.ok(arred.changes.every((c) => JSON.stringify(c.from) !== JSON.stringify(c.to)));
  // cada passo cai num momento, e os momentos andam para frente
  assert.ok(story.every((s, i) => i === 0 || s.k > story[i - 1].end));
  assert.equal(storyAt(story, arred.k + 1 <= arred.end ? arred.k + 1 : arred.k), story.indexOf(arred));
});

test("modo Explicar: sem etapas, cada volta do laço de fora vira um momento", () => {
  const steps = runFlow(fatorial(), { n: 3 }, { trace: true });
  const story = storyOf(fatorial(), steps);
  const turns = story.filter((s) => s.kind === "turn");
  assert.equal(turns.length, 3);
  assert.match(turns[1].title, /volta 2/);
  assert.deepEqual(turns[1].changes.map((c) => c.name).sort(), ["i", "resultado"]);
  assert.ok(story.some((s) => s.kind === "action" && s.title === "Preparar"));
});
