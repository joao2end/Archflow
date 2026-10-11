import assert from "node:assert/strict";
import { test } from "node:test";
import { emptyDoc, type Doc, type LogicNodeSpec } from "./schema";
import { applyOps, describe, schemaGuide, validateDetailed, type Op } from "./ops";
import { checkExamples, runPipeline } from "./logic";

const node = (id: string, label: string, logic: LogicNodeSpec): Op => ({ op: "add_node", id, label, logic });

/** Um recorte da engine de precificação (passos 1 a 4, 7 e 8): serve de caso de aceitação do modo. */
function pricing(): Doc {
  const doc = emptyDoc("Engine de precificação", "logic");
  const ops: Op[] = [
    node("custo", "Custo", { role: "fact", type: "dinheiro" }),
    node("preco-atual", "Preço atual", { role: "fact", type: "dinheiro" }),
    node("preco", "Preço", { role: "fact", type: "dinheiro", text: "o preço que a engine está calculando" }),
    node("margem-objetivo", "Margem objetivo", { role: "fact", type: "percentual" }),
    node("preco-fixo", "Preço fixo", { role: "fact", type: "dinheiro" }),
    node("marca-propria", "Marca própria", { role: "fact", type: "lógico" }),
    node("preco-partida", "Preço de partida (lucro)", {
      role: "rule",
      order: 1,
      text: "No grupo de lucro, o preço parte do custo e da margem objetivo da categoria.",
      then: ["preco := custo / (1 - margem_objetivo)"],
      examples: [{ name: "custo 60, margem 40%", given: { custo: 60, margem_objetivo: 0.4, preco_atual: 90 }, expect: { preco: 100 } }],
    }),
    node("arredondar", "Arredondamento", {
      role: "rule",
      order: 2,
      text: "Só se o preço mudou: acima de R$ 100 até R$ 200 termina em 99,99.",
      when: "preco != preco_atual e preco > 100 e preco <= 200",
      then: ["preco := 99.99"],
      examples: [
        { name: "mudou e está na faixa", given: { preco: 150, preco_atual: 120 }, expect: { preco: 99.99 } },
        { name: "não mudou: fica como está", given: { preco: 150, preco_atual: 150 }, expect: { preco: 150 } },
      ],
    }),
    node("marca", "Marca própria ancora no preço atual", {
      role: "rule",
      order: 3,
      text: "Marca própria volta ao preço atual e fica travada.",
      when: "marca_propria",
      then: ["preco := preco_atual", "travar preco"],
      examples: [{ name: "volta e trava", given: { preco: 80, preco_atual: 70, marca_propria: true }, expect: { preco: 70 } }],
    }),
    node("fixo", "Preço fixo", {
      role: "rule",
      order: 4,
      text: "Se houver preço fixo maior que zero, ele vence o que veio antes (a menos que já esteja travado).",
      when: "preco_fixo > 0",
      then: ["preco := preco_fixo", "travar preco"],
      examples: [{ name: "fixo vence", given: { preco: 80, preco_fixo: 55 }, expect: { preco: 55 } }],
    }),
    node("caso-marca", "Marca própria com preço fixo", {
      role: "scenario",
      text: "Marca própria já travou o preço no passo 3; o preço fixo do passo 4 não o reescreve.",
      examples: [{ name: "travado ganha", given: { custo: 60, margem_objetivo: 0.4, preco_atual: 90, marca_propria: true, preco_fixo: 55 }, expect: { preco: 90 } }],
    }),
    // a fila lê/escreve estes dados
    { op: "add_connection", from: "custo", to: "preco-partida" },
    { op: "add_connection", from: "margem-objetivo", to: "preco-partida" },
    { op: "add_connection", from: "preco-partida", to: "preco" },
  ];
  const r = applyOps(doc, ops);
  assert.ok(r.results.every((x) => x.ok), JSON.stringify(r.results.filter((x) => !x.ok)));
  return r.doc;
}

test("a fila roda em ordem e a trava impede que o preço fixo reescreva a marca própria", () => {
  const doc = pricing();
  const run = runPipeline(doc, { custo: 60, margem_objetivo: 0.4, preco_atual: 90, marca_propria: true, preco_fixo: 55 });
  assert.equal(run.env.preco, 90);
  assert.deepEqual(run.locked, ["preco"]);
  const fixo = run.steps.find((s) => s.rule === "fixo")!;
  assert.ok(fixo.applied);
  assert.deepEqual(fixo.blocked, ["preco"]);
  assert.deepEqual(run.steps.map((s) => s.rule), ["preco-partida", "arredondar", "marca", "fixo"]);
});

test("sem a marca própria, o preço fixo vence tudo o que veio antes", () => {
  const run = runPipeline(pricing(), { custo: 60, margem_objetivo: 0.4, preco_atual: 90, marca_propria: false, preco_fixo: 55 });
  assert.equal(run.env.preco, 55);
});

test("todos os exemplos do caso passam e a validação não acusa erro", () => {
  const doc = pricing();
  const bad = checkExamples(doc).filter((e) => !e.ok);
  assert.deepEqual(bad.map((b) => `${b.example}: ${b.problems}`), []);
  assert.deepEqual(validateDetailed(doc).filter((i) => i.severity === "erro"), []);
});

test("L004: exemplo que não bate vira erro com a diferença", () => {
  const doc = pricing();
  doc.nodes.find((n) => n.id === "preco-partida")!.logic!.examples![0].expect.preco = 101;
  const l004 = validateDetailed(doc).filter((i) => i.rule === "L004");
  assert.equal(l004.length, 1);
  assert.match(l004[0].message, /preco: esperava 101, deu 100/);
});

test("L001/L002/L003/L005/L007: sintaxe, dado desconhecido, sem exemplo, ordem repetida", () => {
  const { doc } = applyOps(emptyDoc("t", "logic"), [
    node("a", "A", { role: "rule", order: 1, when: "x > 1", then: [] }),
    node("b", "B", { role: "rule", order: 1, then: ["y := w + z"] }),
    node("f", "F", { role: "fact", key: "z" }),
  ]);
  doc.nodes.find((n) => n.id === "a")!.logic!.when = "x >"; // só chega por arquivo importado: as ops já recusam
  const rules = validateDetailed(doc).map((i) => i.rule);
  for (const r of ["L001", "L002", "L003", "L005", "L007"]) assert.ok(rules.includes(r), `faltou ${r}: ${rules}`);
});

test("as ops recusam logic fora do modo logic e campos fora do papel, com mensagem acionável", () => {
  const arch = emptyDoc("a");
  const r1 = applyOps(arch, [node("x", "X", { role: "fact" })]);
  assert.match(r1.results[0].error!, /modo "logic"/);
  const doc = emptyDoc("l", "logic");
  const r2 = applyOps(doc, [node("x", "X", { role: "fact", when: "1 = 1" } as LogicNodeSpec)]);
  assert.match(r2.results[0].error!, /não existe no papel "fact"/);
  const r3 = applyOps(doc, [node("y", "Y", { role: "rule", then: ["preco = 1"] })]);
  assert.match(r3.results[0].error!, /dado := expressão/);
});

test("describe mostra a fila com a explicação em português e o schema guide do modo", () => {
  const doc = pricing();
  const text = describe(doc);
  assert.match(text, /Fila de regras/);
  assert.match(text, /preço atual/); // nome de negócio do dado
  assert.match(text, /✔ exemplo/);
  assert.match(schemaGuide("logic"), /travar x/);
});

test("exemplo de precificação: fluxograma com decisões, escolha, laço e fins; todos os exemplos batem, sem erros nem avisos", async () => {
  const { pricingDoc, renderLogicExample } = await import("./logic.example");
  const doc = pricingDoc();
  const count = (r: string) => doc.nodes.filter((n) => n.logic?.role === r).length;
  assert.equal(count("start"), 1);
  assert.equal(count("end"), 3, "um fim ok e dois fins com erro");
  const falhas = doc.nodes.filter((n) => n.logic?.role === "scenario" && n.logic.examples?.some((e) => e.expect.desfecho === "erro"));
  assert.ok(falhas.length >= 4, "o exemplo tem cenários de falha, não só de sucesso");
  assert.ok(doc.groups.some((g) => g.id === "cenarios-falha"), "os cenários de falha ficam num grupo próprio");
  assert.equal(count("loop"), 1);
  assert.equal(count("switch"), 2, "o tipo do grupo (por valor) e a faixa do arredondamento (por condições)");
  assert.ok(count("decision") >= 10, "os desvios são decisões no quadro");
  assert.ok(count("rule") >= 15);
  assert.ok(doc.connections.some((c) => c.logic?.branch === "sim") && doc.connections.some((c) => c.logic?.branch === "nao"));
  const results = checkExamples(doc);
  assert.ok(results.length >= 50);
  assert.deepEqual(results.filter((r) => !r.ok).map((r) => `${r.example}: ${r.problems}`), []);
  assert.deepEqual(validateDetailed(doc).filter((i) => i.severity !== "dica"), []);
  const files = renderLogicExample();
  assert.deepEqual(files.map((f) => f.path), ["exemplos-logic/precificacao.archflow.json", "exemplos-logic/modelo.md"]);
});

test("arquivos de examples/exemplos-logic estão em dia (rode: npx tsx scripts/build-logic-example.ts)", async () => {
  const { renderLogicExample } = await import("./logic.example");
  const { readFileSync, existsSync } = await import("node:fs");
  for (const f of renderLogicExample()) {
    const p = new URL(`../../examples/${f.path}`, import.meta.url);
    assert.ok(existsSync(p), `falta examples/${f.path}`);
    assert.equal(readFileSync(p, "utf8").replace(/\r\n/g, "\n"), f.content, `desatualizado: examples/${f.path}`);
  }
});

test("layout pipeline: coordenadas finitas, fila em ordem e nenhum elemento sobreposto", () => {
  const doc = pricing();
  applyOps(doc, []);
  const { doc: laid } = applyOps(doc, [{ op: "layout" }]);
  const ys = ["preco-partida", "arredondar", "marca", "fixo"].map((id) => laid.nodes.find((n) => n.id === id)!.y);
  assert.deepEqual([...ys].sort((a, b) => a - b), ys, "a fila desce na ordem de execução");
  for (const n of laid.nodes) assert.ok(Number.isFinite(n.x) && Number.isFinite(n.y), `${n.id} sem posição`);
  for (const [i, a] of laid.nodes.entries())
    for (const b of laid.nodes.slice(i + 1)) assert.ok(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y, `${a.id} sobrepõe ${b.id}`);
  const arch = applyOps(emptyDoc("a"), [{ op: "layout", style: "pipeline" }]);
  assert.match(arch.results[0].error!, /modo "logic"/);
});

test("domain e logic só carregam componentes compatíveis com o modo", () => {
  const rejected = (mode: "domain" | "logic", op: Op) => applyOps(emptyDoc("m", mode), [op]).results[0];
  // logic: nada de infraestrutura nem de DDD
  assert.match(rejected("logic", { op: "add_node", kind: "service", label: "API" }).error!, /não existe no modo logic.*logic, system/);
  assert.match(rejected("logic", { op: "add_node", asset: "ddd-command" }).error!, /só existem em diagramas de modo "domain"|não existe no modo logic/);
  assert.equal(rejected("logic", { op: "add_node", asset: "logic-rule" }).ok, true);
  // domain: nada de infraestrutura nem de lógica
  assert.match(rejected("domain", { op: "add_node", kind: "database", label: "DB" }).error!, /não existe no modo domain/);
  assert.match(rejected("domain", { op: "add_node", asset: "logic-rule" }).error!, /só existem em diagramas de modo "logic"|não existe no modo domain/);
  assert.equal(rejected("domain", { op: "add_node", asset: "ddd-command" }).ok, true);
  assert.equal(rejected("domain", { op: "add_node", kind: "actor", label: "Cliente" }).ok, true);
  // architecture continua aceitando infraestrutura
  assert.equal(applyOps(emptyDoc("a"), [{ op: "add_node", kind: "service", label: "API" }]).results[0].ok, true);
});
