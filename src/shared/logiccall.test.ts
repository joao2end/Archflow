import assert from "node:assert/strict";
import { test } from "node:test";
import { logicIssues, runFlow } from "./logic";
import { coverageGaps } from "./logiceval";
import { nodeCases } from "./nodes.cases";
import { applyOps } from "./ops";
import { emptyDoc } from "./schema";

const emptyDocLogic = () => emptyDoc("t", "logic");
const cobranca = () => nodeCases().find((c) => c.id === "cobranca-com-falha")!.build();

test("a chamada que falha segue pela seta erro; a que dá certo, pela normal", () => {
  const ok = runFlow(cobranca(), { gateway_falha: false });
  assert.equal(ok.env.status, "paga");
  assert.equal(ok.steps.find((s) => s.role === "call")!.branch, undefined);
  const bad = runFlow(cobranca(), { gateway_falha: true });
  assert.equal(bad.env.status, "pendente");
  assert.equal(bad.steps.find((s) => s.role === "call")!.branch, "erro");
  assert.equal(bad.outcome, "ok");
});

test("falha simulada sem a seta erro é um erro de execução e um aviso de validação", () => {
  const doc = structuredClone(cobranca());
  doc.connections = doc.connections.filter((c) => c.logic?.branch !== "erro");
  const run = runFlow(doc, { gateway_falha: true });
  assert.match(run.steps.find((s) => s.error)!.error!, /falta a seta "erro"/);
  assert.ok(logicIssues(doc).some((i) => i.rule === "L025" && i.severity === "aviso"));
});

test("a seta erro só existe saindo de uma chamada, e o cenário que não a exercita é apontado", () => {
  const doc = structuredClone(cobranca());
  const bad = applyOps(doc, [{ op: "add_connection", from: "paga", to: "fim", logic: { branch: "erro" } } as never]);
  assert.ok(bad.results.some((r) => !r.ok) || logicIssues(bad.doc).some((i) => i.rule === "L023"));
  const gaps = [...coverageGaps(doc).values()].flat();
  assert.ok(gaps.some((g) => /falha/.test(g)), "sem cenário, a falha da chamada fica descoberta");
  const withCase = applyOps(doc, [{ op: "add_node", id: "caso", label: "Gateway fora", logic: { role: "scenario", text: "falha", examples: [{ name: "falha", given: { gateway_falha: true }, expect: { status: "pendente" } }] } } as never]).doc;
  assert.ok(![...coverageGaps(withCase).values()].flat().some((g) => /falha/.test(g)));
});

test("a chamada que dá certo escreve o que devolve; a que falha, não", () => {
  const doc = nodeCases().find((c) => c.id === "consulta-de-cep")!.build();
  const ok = runFlow(doc, { servico_falha: false, cidade_do_servico: "Recife" });
  assert.equal(ok.env.cidade, "Recife");
  assert.deepEqual(ok.steps.find((s) => s.role === "call")!.changes.map((c) => c.name), ["cidade"]);
  const bad = runFlow(doc, { servico_falha: true, cidade_do_servico: "Recife" });
  assert.equal(bad.env.cidade, "desconhecida");
  assert.ok(bad.steps.find((s) => s.role === "call")!.changes.length === 0);
});

test("devolve com efeito inválido é recusado com a posição, e a validação enxerga o dado escrito pela chamada", () => {
  const doc = nodeCases().find((c) => c.id === "consulta-de-cep")!.build();
  const r = applyOps(doc, [{ op: "update", id: "consulta", patch: { logic: { role: "call", devolve: ["cidade ="] } } } as never]);
  assert.match(r.results[0].error ?? "", /logic\.devolve\[0\]/);
  // os dados que a chamada lê (falha, devolve) contam como lidos; sem `devolve`, cidade_do_servico fica sem uso
  const unused = (d: typeof doc) => logicIssues(d).filter((i) => i.rule === "L006").map((i) => i.message);
  assert.deepEqual(unused(doc), []);
  const semDevolve = structuredClone(doc);
  delete (semDevolve.nodes.find((n) => n.id === "consulta")!.logic as { devolve?: string[] }).devolve;
  assert.ok(unused(semDevolve).some((m) => /cidade_do_servico/.test(m)));
});

test("a próxima seta que sai de um passo já nasce com a saída certa", async () => {
  const { nextExit } = await import("./logic");
  const mk = (role: string, extra: Record<string, unknown> = {}) =>
    applyOps(emptyDocLogic(), [
      { op: "add_node", id: "x", label: "X", logic: { role, ...extra } },
      { op: "add_node", id: "a", label: "A", logic: { role: "rule" } },
      { op: "add_node", id: "b", label: "B", logic: { role: "rule" } },
      { op: "add_node", id: "c", label: "C", logic: { role: "rule" } },
    ] as never).doc;
  const add = (doc: ReturnType<typeof mk>, to: string, logic?: object) => applyOps(doc, [{ op: "add_connection", from: "x", to, ...(logic ? { logic } : {}) } as never]).doc;
  let d = mk("decision", { when: "a > 1" });
  assert.deepEqual(nextExit(d, "x"), { branch: "sim" });
  d = add(d, "a", { branch: "sim" });
  assert.deepEqual(nextExit(d, "x"), { branch: "nao" });
  d = add(d, "b", { branch: "nao" });
  assert.equal(nextExit(d, "x"), undefined);
  let l = mk("loop", { max: 3 });
  assert.deepEqual(nextExit(l, "x"), { branch: "repete" });
  l = add(l, "a", { branch: "repete" });
  assert.deepEqual(nextExit(l, "x"), { branch: "segue" });
  let s = mk("switch");
  assert.deepEqual(nextExit(s, "x"), { case: "condicao" });
  s = add(s, "a", { case: "condicao" });
  assert.deepEqual(nextExit(s, "x"), { case: "condicao2" });
  assert.deepEqual(nextExit(mk("switch", { on: "nivel" }), "x"), { case: '"valor"' });
  let c = mk("call", { falha: "f" });
  assert.equal(nextExit(c, "x"), undefined);
  c = add(c, "a");
  assert.deepEqual(nextExit(c, "x"), { branch: "erro" });
  assert.equal(nextExit(mk("rule"), "x"), undefined);
});

test("outputOf mostra o que o passo produziu, sem precisar adivinhar o esperado", async () => {
  const { outputOf, checkExamples } = await import("./logic");
  const doc = applyOps(emptyDocLogic(), [
    { op: "add_node", id: "total", label: "Total", logic: { role: "input", key: "total", type: "number" } },
    { op: "add_node", id: "inicio", label: "Início", logic: { role: "start" } },
    { op: "add_node", id: "frete", label: "Frete", logic: { role: "rule", text: "f", when: "total < 200", then: ["frete := 15", "total := total + 15"], examples: [{ name: "pequeno", given: { total: 50 }, expect: {} }, { name: "grande", given: { total: 300 }, expect: {} }] } },
    { op: "add_node", id: "ok", label: "Total alto?", logic: { role: "decision", when: "total >= 200", examples: [{ name: "alto", given: { total: 300 }, expect: {} }] } },
    { op: "add_node", id: "fim", label: "Fim", logic: { role: "end" } },
    { op: "add_node", id: "caso", label: "Caso", logic: { role: "scenario", examples: [{ name: "pequeno", given: { total: 50 }, expect: {} }] } },
    { op: "add_connection", from: "inicio", to: "frete" }, { op: "add_connection", from: "frete", to: "ok" },
    { op: "add_connection", from: "ok", to: "fim", logic: { branch: "sim" } }, { op: "add_connection", from: "ok", to: "fim", logic: { branch: "nao" } },
  ] as never).doc;
  const res = checkExamples(doc);
  const get = (node: string, ex: string) => outputOf(doc, res.find((r) => r.node === node && r.example === ex)!);
  assert.deepEqual(get("frete", "pequeno"), { values: { frete: 15, total: 65 } });
  assert.match(get("frete", "grande")!.note ?? "", /não valeu/);
  assert.deepEqual(get("ok", "alto"), { values: { caminho: "sim" } });
  assert.deepEqual(get("caso", "pequeno"), { values: { frete: 15, total: 65, desfecho: "ok" } });
});

test("nameProblems aponta o nome que não existe e sugere o parecido", async () => {
  const { nameProblems } = await import("./logic");
  const doc = applyOps(emptyDocLogic(), [
    { op: "add_node", id: "total", label: "Total", logic: { role: "input", key: "total", type: "number" } },
    { op: "add_node", id: "itens", label: "Itens", logic: { role: "input", key: "itens", type: "number[]" } },
    { op: "add_node", id: "inicio", label: "Início", logic: { role: "start" } },
    { op: "add_node", id: "r", label: "R", logic: { role: "rule", text: "r", then: ["frete := total * 2"] } },
    { op: "add_node", id: "cada", label: "Cada", logic: { role: "loop", foreach: "itens" } },
    { op: "add_node", id: "fim", label: "Fim", logic: { role: "end" } },
  ] as never).doc;
  assert.deepEqual(nameProblems(doc, ["totl"]), [{ name: "totl", suggestion: "total" }]);
  assert.deepEqual(nameProblems(doc, ["frte"]), [{ name: "frte", suggestion: "frete" }]); // frete é escrito por uma regra
  assert.deepEqual(nameProblems(doc, ["itm"]), [{ name: "itm", suggestion: "item" }]); // variável do laço
  assert.deepEqual(nameProblems(doc, ["xyzzy"]), [{ name: "xyzzy", suggestion: undefined }]); // nada parecido: não chuta
  assert.deepEqual(nameProblems(doc, ["total", "frete", "item", "total.sub"]), []); // existem (ou são caminho de um dado)
});

test("renameName troca só o nome inteiro, fora de texto entre aspas", async () => {
  const { renameName } = await import("./logic");
  assert.equal(renameName("frete := totl * 2", "totl", "total"), "frete := total * 2");
  assert.equal(renameName('nivel = "totl" e totl > 1', "totl", "total"), 'nivel = "totl" e total > 1');
  assert.equal(renameName("totl2 + subtotl + totl", "totl", "total"), "totl2 + subtotl + total"); // não mexe em pedaços de outros nomes
  assert.equal(renameName("pedido.totl > 1", "pedido.totl", "pedido.total"), "pedido.total > 1");
});

test("só existem Ação e Decisão: `action` é aceito na entrada, `rule` continua no arquivo, e os textos dizem «ação»", async () => {
  const { LOGIC_ROLES } = await import("./schema");
  const { normalizeDoc } = await import("./ops");
  const { schemaGuideLogic, describeLogic, logicIssues, checkLogicNode } = await import("./logic");
  assert.equal(LOGIC_ROLES.rule.label, "Ação");
  assert.equal(LOGIC_ROLES.rule.badge, "AÇÃO");
  assert.equal(LOGIC_ROLES.decision.label, "Decisão");
  // criar com `action`: vai para o arquivo como `rule`
  let doc = applyOps(emptyDocLogic(), [{ op: "add_node", id: "a", label: "Frete grátis", logic: { role: "action", then: ["frete := 0"] } } as never]).doc;
  assert.equal(doc.nodes[0].logic?.role, "rule");
  // `rule` (nome antigo) continua valendo
  doc = applyOps(doc, [{ op: "add_node", id: "b", label: "Frete fixo", logic: { role: "rule", then: ["frete := 15"] } } as never]).doc;
  assert.equal(doc.nodes[1].logic?.role, "rule");
  // trocar o papel com `action` no update
  doc = applyOps(doc, [{ op: "update", id: "b", patch: { logic: { role: "action", then: ["frete := 20"] } } } as never]).doc;
  assert.deepEqual(doc.nodes[1].logic, { role: "rule", then: ["frete := 20"] });
  // documento que já chega com `action` (importação, PUT)
  const imp = normalizeDoc({ title: "x", mode: "logic", nodes: [{ id: "n", label: "N", kind: "logic", x: 0, y: 0, w: 10, h: 10, logic: { role: "action", then: ["a := 1"] } }] });
  assert.equal(imp.nodes[0].logic?.role, "rule");
  // papel inválido: a mensagem lista `action`, não só `rule`
  assert.match(checkLogicNode({ role: "xyz" }) ?? "", /action \(ação; também aceito: rule\)/);
  // o que a IA lê chama de ação
  const guide = schemaGuideLogic();
  assert.match(guide, /`action`.*o nome antigo `rule` também vale/);
  assert.match(guide, /A Ação muda dados, a Decisão escolhe o caminho/);
  assert.match(guide, /3 ou mais saídas.*`switch`.*`fork`.*`join`/s);
  assert.doesNotMatch(guide, /Cada regra é um nó/);
  // validação e descrição falam «ação»
  const msgs = logicIssues(doc).map((i) => i.message).join("\n");
  assert.doesNotMatch(msgs, /\brule\b|\bregra\b/i);
  assert.doesNotMatch(describeLogic(doc, []), /\*\*Rule\*\*|\bRegras\b|Fila de regras/);
});
