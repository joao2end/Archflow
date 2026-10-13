import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { checkDddNode } from "./domain";
import { DDD_ROLES, DDD_ROLE_KEYS, LOGIC_BRANCH_KEYS, LOGIC_BRANCHES, LOGIC_ROLES, LOGIC_ROLE_KEYS, type DddField, type LogicField } from "./schema";

/** Auditoria semântica (docs/SEMANTICS_LOOP_PROMPT.md): cada componente e propriedade tem uma definição só e nenhuma é aceita sem efeito. */

const DDD_FIELDS: DddField[] = ["intent", "invariants", "payload", "properties", "producedBy", "external", "for", "actor", "goal", "realizedBy", "reactsTo", "issues", "compensates", "projectsFrom", "step"];
const LOGIC_FIELDS: LogicField[] = ["order", "text", "when", "then", "on", "until", "falha", "devolve", "max", "foreach", "as", "outcome", "examples", "key", "type", "value"];

test("todo campo declarado em DddNodeSpec/LogicNodeSpec é oferecido por pelo menos um papel", () => {
  const dddUsed = new Set(DDD_ROLE_KEYS.flatMap((r) => DDD_ROLES[r].fields));
  const logicUsed = new Set(LOGIC_ROLE_KEYS.flatMap((r) => LOGIC_ROLES[r].fields));
  for (const f of DDD_FIELDS) assert.ok(dddUsed.has(f), `ddd.${f} não pertence a nenhum papel`);
  for (const f of LOGIC_FIELDS) assert.ok(logicUsed.has(f), `logic.${f} não pertence a nenhum papel`);
  for (const f of dddUsed) assert.ok(DDD_FIELDS.includes(f), `ddd.${f} está num papel mas não no inventário da auditoria`);
  for (const f of logicUsed) assert.ok(LOGIC_FIELDS.includes(f), `logic.${f} está num papel mas não no inventário da auditoria`);
});

test("step só existe onde tem efeito: no command (o evento fica na coluna de quem o produz)", () => {
  const withStep = DDD_ROLE_KEYS.filter((r) => DDD_ROLES[r].fields.includes("step"));
  assert.deepEqual(withStep, ["command"]);
  // diagramas antigos com step em evento continuam abrindo
  assert.equal(checkDddNode({ role: "domain-event", step: 2 }), undefined);
  assert.match(checkDddNode({ role: "entity", step: 2 }) ?? "", /não existe no papel/);
});

test("a dica de cada papel e de cada ramo diz algo além do nome", () => {
  for (const r of DDD_ROLE_KEYS) assert.ok(DDD_ROLES[r].hint.length >= 30 && DDD_ROLES[r].hint !== DDD_ROLES[r].label, `ddd ${r}`);
  for (const r of LOGIC_ROLE_KEYS) assert.ok(LOGIC_ROLES[r].hint.length >= 30, `logic ${r}`);
  for (const b of LOGIC_BRANCH_KEYS) assert.ok(LOGIC_BRANCHES[b].hint.length >= 20, `ramo ${b}`);
});

test("a matriz docs/semantics-score.md tem uma linha para cada papel e campo (inventário fechado)", () => {
  const md = readFileSync(new URL("../../docs/semantics-score.md", import.meta.url), "utf8");
  for (const r of DDD_ROLE_KEYS) assert.ok(md.includes(`\`${r}\``), `matriz sem o papel ddd ${r}`);
  for (const r of LOGIC_ROLE_KEYS) assert.ok(md.includes(`\`${r}\``), `matriz sem o papel logic ${r}`);
  for (const f of DDD_FIELDS) assert.ok(md.includes(`\`ddd.${f}\``), `matriz sem ddd.${f}`);
  for (const f of LOGIC_FIELDS) assert.ok(md.includes(`\`logic.${f}\``), `matriz sem logic.${f}`);
});

test("a Ação não tem condição: `when` saiu dos campos dela e só a Decisão decide", () => {
  assert.ok(!LOGIC_ROLES.rule.fields.includes("when"));
  assert.ok(LOGIC_ROLES.decision.fields.includes("when"));
});

test("arquivo antigo com «só roda se» na Ação abre com uma Decisão antes dela (sim → ação, não → próximo passo)", async () => {
  const { normalizeDoc } = await import("./ops");
  const mk = (id: string, label: string, logic: object) => ({ id, label, kind: "logic", x: 0, y: 0, w: 10, h: 10, logic });
  const edge = (from: string, to: string) => ({ id: `${from}-to-${to}`, from, to, type: "data" });
  const doc = normalizeDoc({
    title: "t", mode: "logic",
    nodes: [
      mk("ini", "Início", { role: "start" }),
      mk("frete", "Frete grátis", { role: "rule", when: "total >= 200", then: ["frete := 0"] }),
      mk("fim", "Fim", { role: "end" }),
    ],
    connections: [edge("ini", "frete"), edge("frete", "fim")],
  });
  const rule = doc.nodes.find((n) => n.id === "frete")!;
  assert.equal(rule.logic?.when, undefined, "a guarda saiu da ação");
  const dec = doc.nodes.find((n) => n.logic?.role === "decision")!;
  assert.equal(dec.logic?.when, "total >= 200");
  const to = (f: string, t: string) => doc.connections.find((c) => c.from === f && c.to === t);
  assert.ok(to("ini", dec.id), "a entrada chega na decisão");
  assert.equal(to(dec.id, "frete")?.logic?.branch, "sim");
  assert.equal(to(dec.id, "fim")?.logic?.branch, "nao");
  assert.ok(!to("ini", "frete"), "ninguém pula a decisão");
  // idempotente: abrir de novo não cria outra decisão
  assert.equal(normalizeDoc(doc).nodes.filter((n) => n.logic?.role === "decision").length, 1);
});

test("Ação com guarda mas sem nenhuma seta fica como está (não há onde encaixar a decisão)", async () => {
  const { normalizeDoc } = await import("./ops");
  const doc = normalizeDoc({ title: "t", mode: "logic", nodes: [{ id: "a", label: "A", kind: "logic", x: 0, y: 0, w: 10, h: 10, logic: { role: "rule", order: 1, when: "x > 1", then: [] } }], connections: [] });
  assert.equal(doc.nodes.length, 1);
  assert.equal(doc.nodes[0].logic?.when, "x > 1");
});

test("escolha por faixas: a condição fica no case da seta e, com faixas que se sobrepõem, ganha a seta criada primeiro", async () => {
  const { applyOps } = await import("./ops");
  const { runFlow } = await import("./logic");
  const { emptyDoc } = await import("./schema");
  const n = (id: string, logic: object) => ({ op: "add_node", id, label: id, logic }) as never;
  const e = (from: string, to: string, logic?: object) => ({ op: "add_connection", from, to, ...(logic ? { logic } : {}) }) as never;
  const mk = (first: string, second: string) =>
    applyOps(emptyDoc("t", "logic"), [
      n("i", { role: "start" }), n("s", { role: "switch" }), n("a", { role: "rule", then: ['f := "A"'] }), n("b", { role: "rule", then: ['f := "B"'] }), n("o", { role: "rule", then: ['f := "O"'] }), n("fim", { role: "end" }),
      e("i", "s"), e("s", "a", { case: first }), e("s", "b", { case: second }), e("s", "o", { branch: "outros" }), e("a", "fim"), e("b", "fim"), e("o", "fim"),
    ]).doc;
  assert.equal(runFlow(mk("total <= 100", "total <= 1000"), { total: 50 }).env.f, "A", "as duas valem: a primeira criada ganha");
  assert.equal(runFlow(mk("total <= 1000", "total <= 100"), { total: 50 }).env.f, "A", "a ordem é a das setas, não a do valor");
  assert.equal(runFlow(mk("total <= 100", "total <= 1000"), { total: 500 }).env.f, "B");
  assert.equal(runFlow(mk("total <= 100", "total <= 1000"), { total: 5000 }).env.f, "O", "nenhuma vale: outros");
});

test("paralelo: ramos que escrevem ou leem o mesmo dado dão L027; ramos independentes não", async () => {
  const { applyOps, validateDetailed } = await import("./ops");
  const { emptyDoc } = await import("./schema");
  const n = (id: string, logic: object) => ({ op: "add_node", id, label: id, logic }) as never;
  const e = (from: string, to: string) => ({ op: "add_connection", from, to }) as never;
  const mk = (a: string, b: string) =>
    applyOps(emptyDoc("t", "logic"), [
      n("i", { role: "start" }), n("p", { role: "fork" }), n("a", { role: "rule", then: [a] }), n("b", { role: "rule", then: [b] }), n("j", { role: "join" }), n("f", { role: "end" }),
      e("i", "p"), e("p", "a"), e("p", "b"), e("a", "j"), e("b", "j"), e("j", "f"),
    ]).doc;
  const l027 = (d: ReturnType<typeof mk>) => validateDetailed(d).filter((i) => i.rule === "L027");
  assert.equal(l027(mk("x := 1", "y := 2")).length, 0, "independentes");
  assert.equal(l027(mk("x := 1", "x := 2")).length, 1, "os dois escrevem x");
  assert.equal(l027(mk("x := 1", "y := x + 1")).length, 1, "um escreve, o outro lê");
});

test("ordem da fila (sem setas) é crescente, sem `order` vai para o fim e o empate segue a criação; travar bloqueia sem dar erro", async () => {
  const { applyOps } = await import("./ops");
  const { runPipeline } = await import("./logic");
  const { emptyDoc } = await import("./schema");
  const n = (id: string, logic: object) => ({ op: "add_node", id, label: id, logic }) as never;
  const doc = applyOps(emptyDoc("t", "logic"), [
    n("sem", { role: "rule", then: ['t := t + "s"'] }),
    n("tres", { role: "rule", order: 3, then: ['t := t + "3"'] }),
    n("um-a", { role: "rule", order: 1, then: ['t := t + "a"'] }),
    n("um-b", { role: "rule", order: 1, then: ['t := t + "b"'] }),
  ]).doc;
  assert.equal(runPipeline(doc, { t: "" }).env.t, "ab3s", "1 (a, b pelo empate), 3, e o sem order no fim");
  const trava = applyOps(emptyDoc("t", "logic"), [
    n("a", { role: "rule", order: 1, then: ["x := 1", "travar x", "x := 2"] }),
    n("b", { role: "rule", order: 2, then: ["x := 3"] }),
    n("c", { role: "rule", order: 3, then: ["destravar x", "x := 4"] }),
  ]).doc;
  const r = runPipeline(trava, { x: 0 });
  assert.equal(r.env.x, 4, "travado vale 1 até o destravar");
  assert.deepEqual(r.steps.map((s) => s.blocked), [["x"], ["x"], []], "as tentativas bloqueadas ficam anotadas, sem erro");
  assert.ok(r.steps.every((s) => !s.error));
});

test("call: falha precisa dar verdadeiro/falso, falha sem a seta erro é erro de execução e sem falha a chamada nunca falha; end sem outcome é ok", async () => {
  const { applyOps } = await import("./ops");
  const { runFlow } = await import("./logic");
  const { emptyDoc } = await import("./schema");
  const n = (id: string, logic: object) => ({ op: "add_node", id, label: id, logic }) as never;
  const e = (from: string, to: string, logic?: object) => ({ op: "add_connection", from, to, ...(logic ? { logic } : {}) }) as never;
  const mk = (falha?: string, erro = true) =>
    applyOps(emptyDoc("t", "logic"), [
      n("i", { role: "start" }), n("c", { role: "call", ...(falha ? { falha } : {}), devolve: ["r := 1"] }), n("fim", { role: "end" }), n("x", { role: "end", outcome: "erro" }),
      e("i", "c"), e("c", "fim"), ...(erro ? [e("c", "x", { branch: "erro" })] : []),
    ]).doc;
  assert.equal(runFlow(mk(), { }).outcome, "ok", "sem falha nunca falha, e end sem outcome é ok");
  assert.equal(runFlow(mk("total > 5"), { total: 9 }).outcome, "erro", "a falha vale: seta erro");
  assert.equal(runFlow(mk("total > 5"), { total: 1 }).env.r, 1, "não falhou: devolve escreve");
  assert.match(runFlow(mk("total > 5", false), { total: 9 }).steps.find((s) => s.error)?.error ?? "", /falta a seta "erro"/);
  assert.match(runFlow(mk("total"), { total: 9 }).steps.find((s) => s.error)?.error ?? "", /verdadeiro ou falso/);
});

test("cada papel do modo logic tem um selo (badge) próprio: nenhum selo repetido nem parecido com outro", () => {
  const badges = LOGIC_ROLE_KEYS.map((r) => LOGIC_ROLES[r].badge);
  assert.equal(new Set(badges).size, badges.length, `selos repetidos: ${badges.join(", ")}`);
  const norm = (s: string) => s.toUpperCase().replace(/[^A-ZÇÃ]/g, "");
  assert.equal(new Set(badges.map(norm)).size, badges.length, "selos que só diferem por pontuação (ex.: CASE × CASE?)");
});

test("exemplos: `given` vale mais que o `value` do fact, dado sem valor dá erro, `expect` confere só as chaves listadas; o guia diz isso e como citar o item em filtrar/mapear", async () => {
  const { applyOps } = await import("./ops");
  const { runFlow, checkExamples, schemaGuideLogic } = await import("./logic");
  const { emptyDoc } = await import("./schema");
  const n = (id: string, logic: object) => ({ op: "add_node", id, label: id, logic }) as never;
  const e = (from: string, to: string) => ({ op: "add_connection", from, to }) as never;
  const doc = applyOps(emptyDoc("t", "logic"), [
    n("p", { role: "input", key: "preco", value: 10 }),
    n("i", { role: "start" }),
    n("a", { role: "rule", then: ["r := preco + 1", "lista := filtrar([1, 2, 3], item > 1)"], examples: [{ name: "só confere r", given: { preco: 50 }, expect: { r: 51 } }] }),
    n("f", { role: "end" }), e("i", "a"), e("a", "f"),
  ]).doc;
  assert.equal(runFlow(doc, {}).env.r, 11, "sem given vale o value do fact");
  assert.equal(runFlow(doc, { preco: 50 }).env.r, 51, "given vence o value");
  assert.ok(checkExamples(doc).every((x) => x.ok), "expect confere só r; as outras chaves ficam livres");
  const sem = applyOps(emptyDoc("t", "logic"), [n("i", { role: "start" }), n("a", { role: "rule", then: ["r := nao_existe + 1"] }), n("f", { role: "end" }), e("i", "a"), e("a", "f")]).doc;
  assert.match(runFlow(sem, {}).steps.find((s) => s.error)?.error ?? "", /não tem valor neste exemplo/);
  const guide = schemaGuideLogic();
  for (const t of ["`item` é o próprio item", "`given` são os dados que ENTRAM", "SÓ as chaves listadas", "sem acento", "resto da divisão", "um efeito por item"]) assert.ok(guide.includes(t), `guia sem: ${t}`);
});

test("domain-service é puro: ligá-lo a um repository é aceito mas gera a dica D033 (command e application-service não)", async () => {
  const { applyOps, validateDetailed } = await import("./ops");
  const { emptyDoc } = await import("./schema");
  const n = (id: string, ddd: object) => ({ op: "add_node", id, label: id, ddd }) as never;
  const uses = (from: string, to: string) => ({ op: "add_connection", from, to, ddd: { rel: "uses" } }) as never;
  const base = [n("agg", { role: "aggregate-root" }), n("repo", { role: "repository", for: "agg" }), n("svc", { role: "domain-service" }), n("app", { role: "application-service" })];
  const d33 = (extra: unknown[]) => validateDetailed(applyOps(emptyDoc("t", "domain"), [...base, ...extra] as never).doc).filter((i) => i.rule === "D033");
  assert.equal(d33([uses("svc", "repo")]).length, 1);
  assert.equal(d33([uses("app", "repo"), uses("app", "svc")]).length, 0);
});

test("campos de id que repetem conexões valem JUNTO com elas (união); id inexistente é D020; o guia do domínio diz isso", async () => {
  const { applyOps, validateDetailed } = await import("./ops");
  const { schemaGuideDomain } = await import("./domain");
  const { emptyDoc } = await import("./schema");
  const n = (id: string, ddd: object) => ({ op: "add_node", id, label: id, ddd }) as never;
  const trig = (from: string, to: string) => ({ op: "add_connection", from, to, ddd: { rel: "triggers" } }) as never;
  const rules = (ops: unknown[]) => validateDetailed(applyOps(emptyDoc("t", "domain"), ops as never).doc).map((i) => i.rule);
  const base = [n("pago", { role: "domain-event", producedBy: "x" }), n("cobrar", { role: "command" })];
  const soCampos = rules([...base, n("saga", { role: "process-manager", reactsTo: ["pago"], issues: ["cobrar"] })]);
  const soSetas = rules([...base, n("saga", { role: "process-manager" }), trig("pago", "saga"), trig("saga", "cobrar")]);
  const misto = rules([...base, n("saga", { role: "process-manager", reactsTo: ["pago"] }), trig("saga", "cobrar")]);
  for (const r of [soCampos, soSetas, misto]) assert.ok(!r.includes("D018"), "campo e seta são equivalentes: a saga tem entrada e saída");
  assert.ok(rules([...base, n("saga", { role: "process-manager", reactsTo: ["nao-existe"], issues: ["cobrar"] })]).includes("D020"), "id inexistente");
  const guide = schemaGuideDomain();
  for (const t of ["Campos que repetem conexões", "ids de nós", "vale tudo o que aparece em qualquer um", "erro D020"]) assert.ok(guide.includes(t), `guia sem: ${t}`);
});

test("guia do domínio descreve intent, invariants (só documental) e step (só command, ordena a timeline)", async () => {
  const { schemaGuideDomain } = await import("./domain");
  const guide = schemaGuideDomain();
  for (const t of ["`intent` (command, policy, domain-service, application-service)", "só DOCUMENTAL", "ordena os commands no `auto_layout` `timeline`", "não existe em evento"]) assert.ok(guide.includes(t), `guia sem: ${t}`);
});

test("a Ação não aceita «se … entao … senao» dentro de um efeito: recusado ao criar e erro L028 ao abrir arquivo antigo", async () => {
  const { applyOps, normalizeDoc, validateDetailed } = await import("./ops");
  const { checkLogicNode } = await import("./logic");
  const { emptyDoc } = await import("./schema");
  assert.match(checkLogicNode({ role: "rule", then: ["cobertura := se total > 0 entao a / total senao 0"] }) ?? "", /a ação não tem condição/);
  assert.match(checkLogicNode({ role: "rule", then: ["n := base + (se novo entao 1 senao 0)"] }) ?? "", /Decisão antes/, "também dentro de uma conta");
  assert.equal(checkLogicNode({ role: "rule", then: ["cobertura := a / total"] }), undefined);
  assert.equal(checkLogicNode({ role: "decision", when: "se a entao b senao c" }), undefined, "a condição da Decisão pode usar se");
  const r = applyOps(emptyDoc("t", "logic"), [{ op: "add_node", id: "a", label: "A", logic: { role: "rule", then: ["x := se y entao 1 senao 2"] } } as never]);
  assert.equal(r.results[0].ok, false);
  const velho = normalizeDoc({ title: "t", mode: "logic", nodes: [{ id: "a", label: "A", kind: "logic", x: 0, y: 0, w: 10, h: 10, logic: { role: "rule", order: 1, then: ["x := se y entao 1 senao 2"] } }], connections: [] });
  assert.ok(validateDetailed(velho).some((i) => i.rule === "L028" && i.severity === "erro"));
});

test("liftRuleConditionals: a condição de dentro da Ação vira uma Decisão e os exemplos continuam valendo", async () => {
  const { normalizeDoc } = await import("./ops");
  const { liftRuleConditionals, checkExamples, runFlow, conditionalEffects } = await import("./logic");
  const mk = (id: string, label: string, logic: object) => ({ id, label, kind: "logic", x: 0, y: 0, w: 10, h: 10, logic });
  const edge = (from: string, to: string) => ({ id: `${from}-to-${to}`, from, to, type: "data" });
  const doc = normalizeDoc({
    title: "t", mode: "logic",
    nodes: [
      mk("ini", "Início", { role: "start" }),
      mk("totais", "Contar lojas e cobertura", {
        role: "rule",
        then: ["clusterizadas := a + b", "total := clusterizadas + c", "cobertura := se total > 0 entao clusterizadas / total senao 0", "fechado := verdadeiro"],
        examples: [
          { name: "3 de 4", given: { a: 1, b: 2, c: 1 }, expect: { total: 4, cobertura: 0.75, fechado: true } },
          { name: "nenhuma", given: { a: 0, b: 0, c: 0 }, expect: { total: 0, cobertura: 0, fechado: true } },
        ],
      }),
      mk("fim", "Fim", { role: "end" }),
      mk("cenario", "Cenário", { role: "scenario", examples: [{ name: "fluxo", given: { a: 1, b: 2, c: 1 }, expect: { cobertura: 0.75, desfecho: "ok" } }] }),
    ],
    connections: [edge("ini", "totais"), edge("totais", "fim")],
  });
  assert.deepEqual(conditionalEffects(doc.nodes.find((n) => n.id === "totais")!.logic!), [2]);
  const antes = runFlow(doc, { a: 1, b: 2, c: 1 }).env;
  const { doc: novo, lifted, failed } = liftRuleConditionals(doc);
  assert.deepEqual(failed, []);
  assert.deepEqual(lifted, ["totais"]);
  const papeis = novo.nodes.filter((n) => n.logic).map((n) => n.logic!.role);
  assert.equal(papeis.filter((p) => p === "decision").length, 1, "uma decisão");
  assert.equal(conditionalEffects(novo.nodes.find((n) => n.id === "totais")!.logic!).length, 0, "a ação de antes não tem mais condição");
  assert.ok(novo.nodes.some((n) => n.logic?.role === "rule" && n.logic.then?.[0] === "cobertura := clusterizadas / total"));
  assert.ok(novo.nodes.some((n) => n.logic?.role === "rule" && n.logic.then?.[0] === "cobertura := 0"));
  assert.ok(novo.nodes.some((n) => n.label.endsWith("(depois)") && n.logic?.then?.[0] === "fechado := verdadeiro"), "o efeito de depois mantém a ordem");
  const depois = runFlow(novo, { a: 1, b: 2, c: 1 }).env;
  for (const k of ["clusterizadas", "total", "cobertura", "fechado"]) assert.deepEqual(depois[k], antes[k], k);
  assert.ok(checkExamples(novo).every((x) => x.ok), "exemplos refeitos nos passos novos, todos passando");
  assert.ok(checkExamples(novo).length > checkExamples(doc).length - 1, "o exemplo de cada caminho foi para o seu passo");
});

test("liftRuleConditionals: cadeia senao-se vira decisões encadeadas; condição dentro de conta troca só o valor; ação sem setas não é convertida", async () => {
  const { normalizeDoc } = await import("./ops");
  const { liftRuleConditionals, runFlow } = await import("./logic");
  const mk = (id: string, label: string, logic: object) => ({ id, label, kind: "logic", x: 0, y: 0, w: 10, h: 10, logic });
  const edge = (from: string, to: string) => ({ id: `${from}-to-${to}`, from, to, type: "data" });
  const base = (then: string[]) => normalizeDoc({ title: "t", mode: "logic", nodes: [mk("ini", "I", { role: "start" }), mk("r", "R", { role: "rule", then }), mk("f", "F", { role: "end" })], connections: [edge("ini", "r"), edge("r", "f")] });
  const cadeia = base(['m := se x < 0 entao "neg" senao (se x = 0 entao "zero" senao "pos")']);
  const c = liftRuleConditionals(cadeia).doc;
  assert.equal(c.nodes.filter((n) => n.logic?.role === "decision").length, 2);
  assert.equal(c.nodes.filter((n) => n.logic?.role === "rule").length, 3);
  for (const [x, m] of [[-1, "neg"], [0, "zero"], [5, "pos"]] as const) assert.equal(runFlow(c, { x }).env.m, m);
  const conta = liftRuleConditionals(base(["n := base + (se novo entao 1 senao 0)"])).doc;
  for (const [novo, n] of [[true, 11], [false, 10]] as const) assert.equal(runFlow(conta, { base: 10, novo }).env.n, n);
  const solta = normalizeDoc({ title: "t", mode: "logic", nodes: [mk("r", "R", { role: "rule", order: 1, then: ["x := se y entao 1 senao 2"] })], connections: [] });
  const r = liftRuleConditionals(solta);
  assert.equal(r.lifted.length, 0);
  assert.match(r.failed[0], /nenhuma seta/);
  assert.equal(r.doc.nodes.length, 1, "nada alterado");
});

test("guia do domínio diz quando usar command, application-service, policy e process-manager, e as regras citadas existem", async () => {
  const { schemaGuideDomain, domainIssues } = await import("./domain");
  const { applyOps } = await import("./ops");
  const { emptyDoc } = await import("./schema");
  const guide = schemaGuideDomain();
  for (const t of ["Qual elemento usar", "exatamente um aggregate-root, D002", "sem `invariants`) nem emite evento (D013)", "SEM estado", "evento de entrada e de um command de saída (D018)"]) assert.ok(guide.includes(t), `guia sem: ${t}`);
  const n = (id: string, ddd: object) => ({ op: "add_node", id, label: id, ddd }) as never;
  const d = applyOps(emptyDoc("t", "domain"), [n("app", { role: "application-service" }), n("uc", { role: "use-case" }), n("saga", { role: "process-manager" })] as never).doc;
  (d.nodes.find((x) => x.id === "app")!.ddd as { invariants?: string[] }).invariants = ["x"]; // só chega por arquivo importado: as ops recusam o campo
  const rules = domainIssues(d).map((i) => i.rule);
  for (const r of ["D001", "D013", "D018"]) assert.ok(rules.includes(r), `${r} não existe mais: o guia cita uma regra fantasma`);
});

test("domain-event: `properties` vence o `payload` (texto legado) na descrição e no código; o payload só vale sozinho", async () => {
  const { applyOps, describe } = await import("./ops");
  const { generateCode } = await import("./codegen");
  const { schemaGuideDomain } = await import("./domain");
  const { emptyDoc } = await import("./schema");
  const base = (ddd: object) =>
    applyOps(emptyDoc("t", "domain"), [
      { op: "add_group", id: "c", label: "C", kind: "context", subdomain: "core" } as never,
      { op: "add_node", id: "ev", label: "Pedido criado", parent: "c", ddd: { role: "domain-event", ...ddd } } as never,
    ]).doc;
  const so = base({ payload: "pedidoId, total" });
  const ambos = base({ payload: "legadoA, legadoB", properties: [{ name: "pedidoId", type: "uuid" }] });
  assert.match(describe(so), /payload: pedidoId, total/);
  assert.match(describe(ambos), /payload: .*pedidoId/, "com properties, o resumo vem das propriedades");
  assert.doesNotMatch(describe(ambos), /legadoA/);
  const codigo = generateCode(ambos).map((f) => f.content).join("\n");
  assert.doesNotMatch(codigo, /legadoA/, "o código ignora o payload quando há properties");
  assert.match(codigo, /pedidoId/);
  assert.match(schemaGuideDomain(), /serve só quando o evento não tem `properties`/);
});

test("guia do domínio: actor (texto, não ligação), external (contexto.evento), subdomain, key só na entity, pattern simétrico; e as regras citadas existem", async () => {
  const { schemaGuideDomain, domainIssues } = await import("./domain");
  const { applyOps } = await import("./ops");
  const { generateCode } = await import("./codegen");
  const { emptyDoc } = await import("./schema");
  const guide = schemaGuideDomain();
  for (const t of ["`actor` (use-case): TEXTO livre", "Não é uma ligação", "o id do grupo `context` do OUTRO diagrama", "`subdomain` (grupo context)", "só muda o código gerado da entity", "sem ele o campo é obrigatório", "a ordem não muda o sentido"]) assert.ok(guide.includes(t), `guia sem: ${t}`);
  const n = (id: string, ddd: object, parent = "c") => ({ op: "add_node", id, label: id, parent, ddd }) as never;
  const props = [{ name: "numero", type: "string", key: true }, { name: "nome", type: "string" }];
  const doc = applyOps(emptyDoc("t", "domain"), [
    { op: "add_group", id: "c", label: "C", kind: "context", subdomain: "generic" } as never,
    n("agg", { role: "aggregate-root" }), n("ent", { role: "entity", properties: props }), n("vo", { role: "value-object", properties: props }),
    { op: "add_connection", from: "agg", to: "ent", ddd: { rel: "contains" } } as never, { op: "add_connection", from: "agg", to: "vo", ddd: { rel: "contains" } } as never,
  ]).doc;
  const code = generateCode(doc).map((f) => f.content).join("\n");
  const classOf = (name: string) => code.slice(code.indexOf(`export class ${name} `));
  assert.match(classOf("Ent").slice(0, 200), /readonly numero: string/, "key vira o id da entity");
  assert.doesNotMatch(classOf("Vo").slice(0, 120), /readonly id: string/, "no value-object o key não cria identidade");
  assert.ok(domainIssues(doc).every((i) => i.rule !== "D014"), "subdomain informado: sem dica D014");
  for (const r of ["D006", "D014", "D015"]) assert.ok(guide.includes(r), `o guia cita ${r}`);
});

test("a Chamada também não tem condição: `se … entao … senao` em devolve é recusado (como na Ação) e vira L028 ao abrir arquivo antigo", async () => {
  const { checkLogicNode } = await import("./logic");
  const { normalizeDoc, validateDetailed } = await import("./ops");
  assert.match(checkLogicNode({ role: "call", devolve: ["cidade := se achou entao a senao b"] }) ?? "", /a chamada não tem condição/);
  assert.equal(checkLogicNode({ role: "call", devolve: ["cidade := a"] }), undefined);
  const velho = normalizeDoc({ title: "t", mode: "logic", nodes: [{ id: "c", label: "C", kind: "logic", x: 0, y: 0, w: 10, h: 10, logic: { role: "call", devolve: ["x := se y entao 1 senao 2"] } }], connections: [] });
  assert.ok(validateDetailed(velho).some((i) => i.rule === "L028" && i.severity === "erro"));
});

test("domínio: reactsTo é a mesma lista em policy e saga (sem «qualquer»/«todos» no app) e quem emite eventos é command, aggregate-root ou process-manager", async () => {
  const { schemaGuideDomain, domainIssues } = await import("./domain");
  const { applyOps } = await import("./ops");
  const { emptyDoc, DDD_REL_PAIRS } = await import("./schema");
  const guide = schemaGuideDomain();
  for (const t of ["só a lista de eventos a que o elemento reage", "não distingue «qualquer um» de «todos»", "Quem emite um evento", "O `application-service` nunca emite (D013)", "o app só documenta isso, não executa nem confere a espera"]) assert.ok(guide.includes(t), `guia sem: ${t}`);
  assert.deepEqual([...DDD_REL_PAIRS.emits[0].from].sort(), ["aggregate-root", "command", "process-manager"]);
  const n = (id: string, ddd: object) => ({ op: "add_node", id, label: id, ddd }) as never;
  const trig = (from: string, to: string) => ({ op: "add_connection", from, to, ddd: { rel: "triggers" } }) as never;
  const ev = [n("e1", { role: "domain-event", external: "x.e1" }), n("e2", { role: "domain-event", external: "x.e2" }), n("k", { role: "command" }), n("a", { role: "aggregate-root" }), trig("k", "a")];
  const rules = (role: string) => domainIssues(applyOps(emptyDoc("t", "domain"), [...ev, n("r", { role, reactsTo: ["e1", "e2"], issues: ["k"] })] as never).doc).map((i) => i.rule);
  for (const role of ["policy", "process-manager"]) assert.ok(!rules(role).includes("D018") && !rules(role).includes("D012"), `${role}: reactsTo + issues bastam, igual nos dois`);
});

test("use-case: realizador pode ser command (rastreio completo) ou serviço (rastreio termina nele); o guia diz isso; o do logic não diz «toda condição é decision»", async () => {
  const { schemaGuideDomain, domainIssues, traceUseCase } = await import("./domain");
  const { schemaGuideLogic } = await import("./logic");
  const { applyOps } = await import("./ops");
  const { emptyDoc } = await import("./schema");
  const g = schemaGuideDomain();
  for (const t of ["precisa de pelo menos um realizador (D001)", "o rastreio termina nele", "não o papel"]) assert.ok(g.includes(t), `guia sem: ${t}`);
  const l = schemaGuideLogic();
  assert.ok(l.includes("Uma condição sim/não é um nó `decision`") && !l.includes("Toda condição é um nó"), "o guia do logic não generaliza a decision");
  const n = (id: string, ddd: object) => ({ op: "add_node", id, label: id, ddd }) as never;
  const d = applyOps(emptyDoc("t", "domain"), [n("uc", { role: "use-case", realizedBy: ["consulta"] }), n("consulta", { role: "application-service" })] as never).doc;
  assert.ok(!domainIssues(d).some((i) => i.rule === "D001"), "realizador de serviço satisfaz o D001");
  const t = traceUseCase(d, "uc");
  assert.deepEqual(t?.problems ?? [], [], "sem problemas de rastreio");
  assert.equal(t?.paths[0]?.length, 2, "o caminho termina no serviço: caso de uso → serviço");
});

test("domínio: condition/foreach/loop são texto livre (não o logic), combináveis, com max 1–1000; compensates lista os compensadores no código; o guia diz isso", async () => {
  const { schemaGuideDomain, checkDddConn } = await import("./domain");
  const { generateCode } = await import("./codegen");
  const { applyOps } = await import("./ops");
  const { emptyDoc } = await import("./schema");
  const g = schemaGuideDomain();
  for (const t of ["são TEXTO livre em linguagem de negócio", "NÃO são as expressões do modo logic", "só para leitura", "inteiro de 1 a 1000 (sem padrão)", "ids dos commands que DESFAZEM", "os compensadores, não os compensados"]) assert.ok(g.includes(t), `guia sem: ${t}`);
  assert.equal(checkDddConn({ rel: "triggers", foreach: "item do pedido", condition: "atraso > 0", loop: { until: "pago", max: 1000 } }), undefined, "os três juntos valem");
  assert.match(checkDddConn({ rel: "triggers", loop: { max: 1001 } }) ?? "", /entre 1 e 1000/);
  assert.match(checkDddConn({ rel: "triggers", condition: "x", otherwise: true }) ?? "", /OU otherwise/);
  const n = (id: string, ddd: object) => ({ op: "add_node", id, label: id, parent: "c", ddd }) as never;
  const d = applyOps(emptyDoc("t", "domain"), [{ op: "add_group", id: "c", label: "C", kind: "context", subdomain: "core" } as never, n("estornar", { role: "command" }), n("saga", { role: "process-manager", reactsTo: [], issues: [], compensates: ["estornar"] })] as never).doc;
  const code = generateCode(d).map((f) => f.content).join("\n");
  assert.match(code, /Desfaz o que já foi feito \(estornar\)/, "compensates vira o método compensate, com os compensadores na documentação");
});

test("bordas das funções: cada comportamento descrito no SYNTAX_GUIDE é executado (o texto não se afasta do motor)", async () => {
  const { evaluate, parseExpr, SYNTAX_GUIDE } = await import("./expr");
  const ok: [string, unknown][] = [
    ["arredondar(2.5, 0)", 3], ["arredondar(-2.5, 0)", -2], ["arredondar(1234, -2)", 1200], ["piso(-1.5)", -2], ["teto(-1.5)", -1],
    ["entre(5, 5, 10)", true], ["entre(10, 5, 10)", true], ["entre(5, 10, 5)", false], ["-7 % 3", -1],
    ['"A" = "a"', false], ['1 = "1"', false], ["[1, 2] = [1, 2]", true], ['"B" < "a"', true],
    ["vazio(nulo)", true], ['vazio("")', true], ["vazio([])", true], ['vazio("  ")', false], ["vazio(0)", false], ["vazio(falso)", false],
    ["soma([])", 0], ["primeiro([])", null], ["ultimo([])", null], ["tamanho(\"abc\")", 3], ["unicos([1, 1, 2])", [1, 2]], ['trocar("a-b-c", "-", "+")', "a+b+c"], ['juntar([], "-")', ""],
    ['numero("0,5")', 0.5], ['numero("0.5")', 0.5], ["texto(nulo)", ""],
    ['dias_entre("2026-01-01", "2026-01-31")', 30], ['dias_entre("2026-01-31", "2026-01-01")', -30], ['somar_dias("2026-01-01", -1)', "2025-12-31"],
  ];
  for (const [src, want] of ok) assert.deepEqual(evaluate(parseExpr(src), {}), want, src);
  const erro = ["media([])", "min([])", "max(\"a\", \"b\")", "7 / 0", 'numero("abc")', 'numero("")', "texto([1, 2])", 'contem("abc", "b")', 'ordenar([3, "a", 1])', 'dias_entre("01/01/2026", "2026-01-31")'];
  for (const src of erro) assert.throws(() => evaluate(parseExpr(src), {}), (e: unknown) => e instanceof Error, src);
  for (const t of ["arredonda o meio para cima", "inclui as duas pontas", "diferencia maiúsculas", "verdadeiro para `nulo`", "`media([])` é erro", "AAAA-MM-DD", "resto com o sinal do dividendo"]) assert.ok(SYNTAX_GUIDE.includes(t), `guia sem: ${t}`);
});

test("origem do valor de um dado: given vence value, sem os dois dá erro ao ler, ação cria dado sem fact (L007) e o type só avisa (L026); o guia diz isso", async () => {
  const { applyOps, validateDetailed } = await import("./ops");
  const { runFlow, schemaGuideLogic } = await import("./logic");
  const { emptyDoc } = await import("./schema");
  const n = (id: string, logic: object) => ({ op: "add_node", id, label: id, logic }) as never;
  const e = (from: string, to: string) => ({ op: "add_connection", from, to }) as never;
  const mk = (extra: unknown[], then: string[]) => applyOps(emptyDoc("t", "logic"), [...extra, n("i", { role: "start" }), n("a", { role: "rule", then }), n("f", { role: "end" }), e("i", "a"), e("a", "f")] as never).doc;
  const preco = (value?: number) => n("p", { role: "input", key: "preco", type: "number", ...(value !== undefined ? { value } : {}) });
  const regras = (d: ReturnType<typeof mk>) => validateDetailed(d).map((i) => i.rule);
  assert.equal(runFlow(mk([preco(10)], ["x := preco"]), {}).env.x, 10, "sem given vale o value");
  assert.equal(runFlow(mk([preco(10)], ["x := preco"]), { preco: 5 }).env.x, 5, "given vence o value");
  assert.equal(runFlow(mk([preco(10)], ["x := preco"]), { preco: null }).env.x, null, "nulo informado conta como valor");
  assert.match(runFlow(mk([preco()], ["x := preco"]), {}).steps.find((s) => s.error)?.error ?? "", /não tem valor neste exemplo/);
  const sem = mk([], ["novo := 1"]);
  assert.equal(runFlow(sem, {}).env.novo, 1, "a ação cria o dado");
  assert.ok(regras(sem).includes("L007"), "e avisa para declarar o fact");
  assert.ok(regras(mk([], ["x := faltando + 1"])).includes("L002"), "dado lido que ninguém declara nem escreve");
  const tipo = mk([preco(10)], ['preco := "abc"']);
  assert.equal(runFlow(tipo, {}).env.preco, "abc", "o tipo não bloqueia a execução");
  assert.ok(regras(tipo).includes("L026"), "só avisa");
  const reescrito = mk([preco(10)], ["preco := 99"]);
  assert.equal(runFlow(reescrito, {}).env.preco, 99, "a ação reescreve o valor");
  assert.ok(regras(reescrito).includes("L029"), "mas num input isso avisa (L029): input só é lido");
  const variavel = mk([n("p", { role: "variable", key: "preco", type: "number", value: 10 })], ["preco := 99"]);
  assert.ok(!regras(variavel).includes("L029"), "numa variable a ação pode reescrever o valor inicial sem aviso");
  const g = schemaGuideLogic();
  for (const t of ["De onde vem o valor de um dado", "`nulo` informado em `given` conta como valor", "o aviso L029 pede para trocar o papel", "aviso L007", "só dão o aviso L026, e a execução segue"]) assert.ok(g.includes(t), `guia sem: ${t}`);
});

test("tipos do fact: number/int/float, português aceita nulo e inglês não, objeto com campo a mais, rótulo não confere; categoria.margem de objeto ou de fact solto; o guia diz isso", async () => {
  const { checkValue, recognize } = await import("./types");
  const { evaluate, parseExpr } = await import("./expr");
  const { schemaGuideLogic } = await import("./logic");
  const ok = (t: string, v: unknown) => {
    const r = recognize(t);
    assert.ok(r?.ok, `${t} é um tipo`);
    return r!.ok ? checkValue(r.type, v as never, "x").length === 0 : false;
  };
  assert.ok(ok("number", 2.5) && ok("number", 3) && !ok("number", null) && !ok("number", "3"));
  assert.ok(ok("int", 3) && ok("int", 3.0) && !ok("int", 2.5));
  assert.ok(ok("float", 3) && ok("float", 2.5) && !ok("float", null));
  for (const t of ["texto", "número", "inteiro", "decimal", "lógico"]) assert.ok(ok(t, null), `${t} aceita nulo`);
  for (const t of ["string", "number", "int", "float", "boolean"]) assert.ok(!ok(t, null), `${t} não aceita nulo`);
  assert.ok(ok("{ preco: number }", { preco: 1, extra: 2 }) && !ok("{ preco: number }", {}) && ok("{ preco?: number }", {}));
  for (const t of ["dinheiro", "numbr", "percentual"]) assert.deepEqual(recognize(t), { ok: false, legacy: true }, `${t} é só rótulo`);
  assert.equal(recognize(""), undefined, "type vazio não confere nada");
  const lê = (env: Record<string, unknown>) => evaluate(parseExpr("categoria.margem"), env as never);
  assert.equal(lê({ categoria: { margem: 0.3 } }), 0.3);
  assert.equal(lê({ "categoria.margem": 0.3 }), 0.3);
  assert.equal(lê({ "categoria.margem": 0.5, categoria: { margem: 0.3 } }), 0.5, "o campo solto vence");
  const g = schemaGuideLogic();
  for (const t of ["Tipos do dado", "`float` é o mesmo que `number`", "Os nomes em inglês NÃO aceitam `nulo`", "vale só como rótulo", "se existirem os dois, vale o campo solto"]) assert.ok(g.includes(t), `guia sem: ${t}`);
});

test("mais bordas: precedência e/ou, + de textos, adicionar não altera, = não é efeito, foreach (vazio, nulo, sem as), when não lógico, destravar sem travar; o guia diz isso", async () => {
  const { evaluate, parseExpr, parseStatement, SYNTAX_GUIDE } = await import("./expr");
  const { applyOps } = await import("./ops");
  const { runFlow, schemaGuideLogic } = await import("./logic");
  const { emptyDoc } = await import("./schema");
  const ev = (s: string, env: Record<string, unknown> = {}) => evaluate(parseExpr(s), env as never);
  assert.equal(ev("falso e falso ou verdadeiro"), true);
  assert.equal(ev("nao falso e falso"), false);
  assert.equal(ev("verdadeiro and falso"), false);
  assert.equal(ev('"a" + "b"'), "ab");
  assert.throws(() => ev('"a" + 1'));
  assert.equal(ev("texto(1.50)"), "1.5");
  const lista = [1];
  assert.deepEqual(ev("adicionar(lista, 2)", { lista }), [1, 2]);
  assert.deepEqual(lista, [1], "a lista original não muda");
  assert.deepEqual(ev('partir("a,,b", ",")'), ["a", "", "b"]);
  assert.deepEqual(ev('partir("", ",")'), [""]);
  assert.deepEqual(ev('partir("abc", "")'), ["a", "b", "c"]);
  assert.throws(() => parseStatement("x = 3"), /dado := expressão/);
  assert.throws(() => ev('"a" em "abc"'));
  const n = (id: string, logic: object) => ({ op: "add_node", id, label: id, logic }) as never;
  const e = (from: string, to: string, logic?: object) => ({ op: "add_connection", from, to, ...(logic ? { logic } : {}) }) as never;
  const laco = (foreach: string, corpo: string) => applyOps(emptyDoc("t", "logic"), [n("i", { role: "start" }), n("l", { role: "loop", foreach }), n("c", { role: "rule", then: [corpo] }), n("f", { role: "end" }), e("i", "l"), e("l", "c", { branch: "repete" }), e("c", "l"), e("l", "f", { branch: "segue" })]).doc;
  assert.equal(runFlow(laco("lista", "n := n + 1"), { lista: [], n: 0 }).env.n, 0, "lista vazia: zero voltas");
  for (const ruim of [null, { a: 1 }, "abc"]) assert.match(runFlow(laco("lista", "n := n + 1"), { lista: ruim as never, n: 0 }).steps.find((s) => s.error)?.error ?? "", /precisa de uma lista/);
  const r = runFlow(laco("lista", "s := s + item"), { lista: [1, 2, 3], s: 0 });
  assert.deepEqual([r.env.s, r.env.item], [6, 3], "sem as o item se chama item e fica com o último valor");
  const dec = (when: string) => applyOps(emptyDoc("t", "logic"), [n("i", { role: "start" }), n("d", { role: "decision", when }), n("a", { role: "rule", then: ["r := 1"] }), n("b", { role: "rule", then: ["r := 2"] }), n("f", { role: "end" }), e("i", "d"), e("d", "a", { branch: "sim" }), e("d", "b", { branch: "nao" }), e("a", "f"), e("b", "f")]).doc;
  assert.match(runFlow(dec("x"), { x: 5 }).steps.find((s) => s.error)?.error ?? "", /verdadeiro ou falso/);
  const solta = applyOps(emptyDoc("t", "logic"), [n("i", { role: "start" }), n("a", { role: "rule", then: ["destravar x", "x := 1"] }), n("f", { role: "end" }), e("i", "a"), e("a", "f")]).doc;
  assert.equal(runFlow(solta, {}).env.x, 1, "destravar sem travar não faz nada");
  const g = schemaGuideLogic();
  for (const t of ["Bordas do laço, da decisão e da trava", "zero voltas", "fica com o último valor depois do laço", "não faz nada e não avisa"]) assert.ok(g.includes(t), `guia sem: ${t}`);
  for (const t of ["`e` antes de `ou`", "junta DOIS textos", "devolve uma lista NOVA", "`x = 3` NÃO é um efeito"]) assert.ok(SYNTAX_GUIDE.includes(t), `SYNTAX sem: ${t}`);
});

test("triagem da iteração 25: %, item.item, expect em dado travado, ramo do fork em end, join sem fork; description e a equivalência campo de id × conexão no guia", async () => {
  const { evaluate, parseExpr, SYNTAX_GUIDE } = await import("./expr");
  const { applyOps } = await import("./ops");
  const { runFlow, checkExamples, schemaGuideLogic } = await import("./logic");
  const { schemaGuideDomain } = await import("./domain");
  const { emptyDoc } = await import("./schema");
  const ev = (s: string, env: Record<string, unknown> = {}) => evaluate(parseExpr(s), env as never);
  assert.equal(ev("10 %5"), 0);
  assert.equal(ev("x%5", { x: 10 }), 0);
  assert.throws(() => ev("10% 5"));
  assert.deepEqual(ev("filtrar(lista, item.item > 1)", { lista: [{ item: 5 }, { item: 0 }] }), [{ item: 5 }]);
  assert.throws(() => ev("filtrar(lista, item > 1)", { lista: [{ item: 5 }] }), "`item` é o item inteiro, não o campo");
  const n = (id: string, logic: object) => ({ op: "add_node", id, label: id, logic }) as never;
  const e = (from: string, to: string) => ({ op: "add_connection", from, to }) as never;
  const trava = applyOps(emptyDoc("t", "logic"), [n("i", { role: "start" }), n("a", { role: "rule", then: ["x := 1", "travar x", "x := 2"], examples: [{ name: "tentou", given: {}, expect: { x: 2 } }, { name: "de fato", given: {}, expect: { x: 1 } }] }), n("f", { role: "end" }), e("i", "a"), e("a", "f")]).doc;
  assert.deepEqual(checkExamples(trava).map((c) => [c.example, c.ok]), [["tentou", false], ["de fato", true]]);
  const fork = applyOps(emptyDoc("t", "logic"), [n("i", { role: "start" }), n("p", { role: "fork" }), n("a", { role: "rule", then: ["a := 1"] }), n("x", { role: "end", outcome: "erro" }), n("j", { role: "join" }), n("f", { role: "end" }), e("i", "p"), e("p", "a"), e("p", "x"), e("a", "j"), e("j", "f")]).doc;
  assert.equal(runFlow(fork, {}).outcome, "erro", "o ramo que chega ao end termina o fluxo com o desfecho dele");
  const semFork = applyOps(emptyDoc("t", "logic"), [n("i", { role: "start" }), n("j", { role: "join" }), n("f", { role: "end" }), e("i", "j"), e("j", "f")]).doc;
  assert.equal(runFlow(semFork, {}).outcome, "ok", "join sem fork só deixa passar");
  for (const t of ["leia o campo com `item.item`", "colado ao FIM de um número literal"]) assert.ok(SYNTAX_GUIDE.includes(t), `SYNTAX sem: ${t}`);
  for (const t of ["DE FATO", "termina o fluxo inteiro com o desfecho desse `end`", "só deixa passar"]) assert.ok(schemaGuideLogic().includes(t), `logic sem: ${t}`);
  const d = schemaGuideDomain();
  for (const t of ["`description` (qualquer componente, de qualquer papel)", "Cada campo de id equivale a uma conexão", "`issues` (policy, saga) = `triggers` do elemento para um command"]) assert.ok(d.includes(t), `domain sem: ${t}`);
});

test("inventário fechado: toda família de vocabulário (modos, tipos de nó/grupo/conexão, protocolos, relações, padrões, saídas) tem uma frase de significado e uma linha na matriz", async () => {
  const S = await import("./schema");
  const md = readFileSync(new URL("../../docs/semantics-score.md", import.meta.url), "utf8");
  const families: [string, Record<string, unknown>, (v: any) => string][] = [
    ["DocMode", S.DOC_MODES, (v) => v.hint],
    ["NodeKind", S.NODE_KINDS, (v) => v],
    ["GroupKind", S.GROUP_KINDS, (v) => v],
    ["ConnectionType", S.CONNECTION_TYPES, (v) => v.semantics],
    ["EndpointProtocol", S.ENDPOINT_PROTOCOLS, (v) => v.semantics],
    ["DddRel", S.DDD_RELS, (v) => v.semantics],
    ["ContextPattern", S.CONTEXT_PATTERNS, (v) => v.hint],
    ["LogicBranch", S.LOGIC_BRANCHES, (v) => v.hint],
  ];
  for (const [nome, mapa, frase] of families)
    for (const [k, v] of Object.entries(mapa)) {
      assert.ok(frase(v).length >= 20, `${nome}.${k} sem frase de significado`);
      assert.ok(md.includes(`\`${k}\``), `matriz sem ${nome}.${k}`);
    }
  assert.ok(!md.includes("| ? |"), "nenhuma linha da matriz ficou sem auditar (`?`)");
});

test("auditor #6: o guia do logic admite o item do foreach como escrita do Loop, e «caso» só nomeia o valor de uma seta do switch (o scenario é «cenário»)", async () => {
  const { LOGIC_ROLES } = await import("./schema");
  const { schemaGuideLogic } = await import("./logic");
  const g = schemaGuideLogic();
  assert.ok(g.includes("(exceto o `devolve` do Call e o item do `foreach`, que o Loop guarda em `as`)"));
  assert.ok(!g.includes("Caso completo"), "o scenario não se chama «caso»");
  assert.match(LOGIC_ROLES.scenario.hint, /^Cenário completo/);
  assert.equal(LOGIC_ROLES.scenario.badge, "TESTE");
});
