import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { generateCode } from "./codegen";
import { checkDddConn, checkDddNode, composeDddLabel, dddLabelVia, flowText, suggestRels } from "./domain";
import { applyOps, describe, schemaGuide, validateDetailed, type Op } from "./ops";
import { emptyDoc, type DddConnSpec, type DddNodeSpec, type Doc } from "./schema";
import { stormLayout } from "./storm";

const ctx = (id: string): Op => ({ op: "add_group", id, label: id, kind: "context", subdomain: "core" });
const dn = (id: string, ddd: DddNodeSpec, parent = "c"): Op => ({ op: "add_node", id, label: id, ddd, parent });
const conn = (from: string, to: string, ddd: DddConnSpec, label?: string): Op => ({ op: "add_connection", from, to, ddd, ...(label ? { label } : {}) });
const trig = (from: string, to: string, extra: Partial<DddConnSpec> = {}) => conn(from, to, { rel: "triggers", ...extra });
const build = (ops: Op[]): Doc => {
  const r = applyOps(emptyDoc("t", "domain"), ops);
  assert.deepEqual(r.results.filter((x) => !x.ok), []);
  return r.doc;
};
const issues = (doc: Doc, rule: string) => validateDetailed(doc).filter((i) => i.rule === rule);
const has = (doc: Doc, rule: string, target?: string) => issues(doc, rule).some((i) => !target || i.target === target);

/** Retentativa de cobrança: decisão exclusiva com loop e ramo "senão". */
const retry = (): Op[] => [
  ctx("c"),
  dn("pag", { role: "aggregate-root" }),
  dn("cobrar", { role: "command" }),
  dn("desistir", { role: "command" }),
  dn("recusado", { role: "domain-event", external: "pagamentos.recusado" }),
  dn("cobranca-iniciada", { role: "domain-event" }),
  dn("tem-tentativas", { role: "decision", question: "ainda há tentativas?" }),
  trig("cobrar", "pag"),
  trig("desistir", "pag"),
  conn("cobrar", "cobranca-iniciada", { rel: "emits" }),
  trig("recusado", "tem-tentativas"),
  trig("tem-tentativas", "cobrar", { condition: "tentativas < 3", loop: { until: "pagamento aprovado", max: 3 } }),
  trig("tem-tentativas", "desistir", { otherwise: true }),
];

test("fluxo: validação de entrada dos campos de uma conexão (só triggers/emits)", () => {
  assert.equal(checkDddConn({ rel: "triggers", condition: "x > 1" }), undefined);
  assert.equal(checkDddConn({ rel: "emits", otherwise: true, foreach: "item" }), undefined);
  assert.equal(checkDddConn({ rel: "triggers", loop: { until: "ok" } }), undefined);
  assert.equal(checkDddConn({ rel: "triggers", loop: { max: 3 } }), undefined);
  assert.match(checkDddConn({ rel: "contains", condition: "x" })!, /só valem em relações de fluxo \(triggers, emits\)/);
  assert.match(checkDddConn({ rel: "uses", foreach: "x" })!, /só valem em relações de fluxo/);
  assert.match(checkDddConn({ rel: "triggers", condition: "  " })!, /texto não vazio/);
  assert.match(checkDddConn({ rel: "triggers", condition: "x", otherwise: true })!, /OU otherwise/);
  assert.match(checkDddConn({ rel: "triggers", otherwise: "sim" })!, /true ou false/);
  assert.match(checkDddConn({ rel: "triggers", foreach: 3 })!, /foreach deve ser um texto/);
  assert.match(checkDddConn({ rel: "triggers", loop: {} })!, /condição de parada/);
  assert.match(checkDddConn({ rel: "triggers", loop: { max: 0 } })!, /inteiro entre 1 e 1000/);
  assert.match(checkDddConn({ rel: "triggers", loop: { max: 1.5 } })!, /inteiro/);
  assert.match(checkDddConn({ rel: "triggers", loop: { max: 5000 } })!, /inteiro entre 1 e 1000/);
  assert.match(checkDddConn({ rel: "triggers", loop: { until: "" } })!, /texto não vazio/);
  assert.match(checkDddConn({ rel: "triggers", loop: { forever: true, max: 2 } })!, /não tem o campo "forever"/);
  assert.match(checkDddConn({ rel: "triggers", loop: "sempre" })!, /objeto/);
});

test("fluxo: o papel decision aceita question e gate; gate inválido e campos de outros papéis são recusados", () => {
  assert.equal(checkDddNode({ role: "decision", question: "ok?", gate: "parallel" }), undefined);
  assert.equal(checkDddNode({ role: "decision" }), undefined);
  assert.match(checkDddNode({ role: "decision", gate: "xor" })!, /gate inválido "xor". Válidos: exclusive, parallel, join/);
  assert.match(checkDddNode({ role: "decision", intent: "x" })!, /campo "intent" não existe no papel "decision"/);
  assert.match(checkDddNode({ role: "command", gate: "join" })!, /campo "gate" não existe no papel "command"/);
  assert.match(checkDddNode({ role: "decision", question: 3 })!, /question deve ser texto/);
});

test("fluxo: só no modo domain (as ops recusam decisão e fluxo em diagramas de arquitetura)", () => {
  const arch = emptyDoc("a");
  assert.match(applyOps(arch, [dn("d", { role: "decision" }, "")]).results[0].error!, /modo "domain"/);
  const two = applyOps(arch, [{ op: "add_node", id: "x", label: "X" }, { op: "add_node", id: "y", label: "Y" }, conn("x", "y", { rel: "triggers", condition: "a" })]);
  assert.equal(two.results[2].ok, false);
  assert.match(two.results[2].error!, /modo "domain"/);
  assert.equal(applyOps(arch, [{ op: "add_node", id: "y", label: "Y" }, { op: "update", id: "y", patch: { ddd: { role: "decision" }, kind: "domain" } }]).results[1].ok, false);
});

test("fluxo: a matriz liga evento/policy/saga/decisão → decisão → command/policy/saga, e a relação é inferida", () => {
  const d = build(retry());
  assert.deepEqual(suggestRels(d, "recusado", "tem-tentativas"), ["triggers"]);
  assert.deepEqual(suggestRels(d, "tem-tentativas", "cobrar"), ["triggers"]);
  assert.deepEqual(suggestRels(d, "cobrar", "tem-tentativas"), [], "command não alimenta decisão diretamente");
  assert.deepEqual(suggestRels(d, "tem-tentativas", "recusado"), [], "decisão não emite evento");
  const inferred = applyOps(d, [{ op: "add_connection", from: "recusado", to: "tem-tentativas" }]).doc.connections.at(-1)!;
  assert.deepEqual({ rel: inferred.ddd?.rel, type: inferred.type }, { rel: "triggers", type: "dependency" });
});

test("fluxo: rótulo da conexão mostra o fluxo (para cada, se/senão, loop) e o texto livre vem depois", () => {
  assert.equal(flowText({ condition: "atraso > 0" }), "se atraso > 0");
  assert.equal(flowText({ otherwise: true }), "senão");
  assert.equal(flowText({ foreach: "item do pedido" }), "para cada item do pedido");
  assert.equal(flowText({ loop: { until: "pago", max: 3 } }), "repete até pago, máx. 3");
  assert.equal(flowText({ loop: { max: 2 } }), "repete máx. 2");
  assert.equal(flowText({ loop: { until: "pago" } }), "repete até pago");
  assert.equal(flowText({ foreach: "item", condition: "x", loop: { max: 2 } }), "para cada item · se x · repete máx. 2");
  assert.equal(flowText(undefined), "");
  assert.equal(flowText({}), "");
  const d: DddConnSpec = { rel: "triggers", condition: "atraso > 0" };
  assert.equal(composeDddLabel(d), "se atraso > 0");
  assert.equal(composeDddLabel(d, "multar"), "se atraso > 0 · multar");
  assert.equal(composeDddLabel(d, "se atraso > 0 · multar"), "se atraso > 0 · multar", "não duplica o prefixo");
  assert.equal(composeDddLabel({ rel: "triggers" }, "multar"), "multar", "sem fluxo vale o comportamento de antes");
  assert.equal(composeDddLabel({ rel: "triggers" }), "triggers");
  assert.equal(dddLabelVia(d, "se atraso > 0 · multar"), "multar");
  assert.equal(dddLabelVia(d, "se atraso > 0"), undefined);
  assert.equal(dddLabelVia(d, "multar"), "multar");
  // trocar a condição preserva o texto livre
  assert.equal(composeDddLabel({ rel: "triggers", condition: "dias > 5" }, dddLabelVia(d, "se atraso > 0 · multar")), "se dias > 5 · multar");
  // entre contextos o fluxo não se aplica
  assert.equal(composeDddLabel({ rel: "context-relation", pattern: "acl" }, "x"), "Anticorruption Layer · x");
});

test("fluxo: add_connection grava o fluxo e o rótulo; update recompõe o rótulo preservando o texto livre", () => {
  const d = build(retry());
  const c = d.connections.find((x) => x.from === "tem-tentativas" && x.to === "cobrar")!;
  assert.equal(c.label, "se tentativas < 3 · repete até pagamento aprovado, máx. 3");
  assert.deepEqual(c.ddd, { rel: "triggers", condition: "tentativas < 3", loop: { until: "pagamento aprovado", max: 3 } });
  assert.equal(d.connections.find((x) => x.to === "desistir" && x.from === "tem-tentativas")!.label, "senão");
  const withVia = applyOps(d, [{ op: "update", id: c.id, patch: { label: "se tentativas < 3 · repete até pagamento aprovado, máx. 3 · nova cobrança" } }]).doc;
  const changed = applyOps(withVia, [{ op: "update", id: c.id, patch: { ddd: { rel: "triggers", condition: "tentativas < 5", loop: { max: 5 } } } }]).doc.connections.find((x) => x.id === c.id)!;
  assert.equal(changed.label, "se tentativas < 5 · repete máx. 5 · nova cobrança");
  // remover o fluxo volta ao rótulo do texto livre
  const plain = applyOps(withVia, [{ op: "update", id: c.id, patch: { ddd: { rel: "triggers" } } }]).doc.connections.find((x) => x.id === c.id)!;
  assert.equal(plain.label, "nova cobrança");
  // dados inválidos no update são recusados
  assert.equal(applyOps(d, [{ op: "update", id: c.id, patch: { ddd: { rel: "triggers", loop: {} } } }]).results[0].ok, false);
});

test("D024/D025/D026: decisão exclusiva precisa de 2+ ramos, cada um com condição, e de um ramo senão", () => {
  assert.deepEqual(issues(build(retry()), "D024"), []);
  assert.deepEqual(issues(build(retry()), "D025"), []);
  assert.deepEqual(issues(build(retry()), "D026"), []);
  const one = build([ctx("c"), dn("e", { role: "domain-event", external: "x.e" }), dn("d", { role: "decision" }), dn("k", { role: "command" }), dn("a", { role: "aggregate-root" }), trig("k", "a"), trig("e", "d"), trig("d", "k", { condition: "x" })]);
  assert.ok(has(one, "D024", "d"), "um só ramo");
  const noCond = build([ctx("c"), dn("e", { role: "domain-event", external: "x.e" }), dn("d", { role: "decision" }), dn("k1", { role: "command" }), dn("k2", { role: "command" }), dn("a", { role: "aggregate-root" }), trig("k1", "a"), trig("k2", "a"), trig("e", "d"), trig("d", "k1", { condition: "x" }), trig("d", "k2")]);
  assert.ok(has(noCond, "D025"), "ramo sem condição");
  assert.ok(has(noCond, "D026", "d"), "sem ramo senão");
  const twoElse = build([ctx("c"), dn("e", { role: "domain-event", external: "x.e" }), dn("d", { role: "decision" }), dn("k1", { role: "command" }), dn("k2", { role: "command" }), dn("a", { role: "aggregate-root" }), trig("k1", "a"), trig("k2", "a"), trig("e", "d"), trig("d", "k1", { otherwise: true }), trig("d", "k2", { otherwise: true })]);
  assert.equal(issues(twoElse, "D025").some((i) => /2 ramos "senão"/.test(i.message)), true);
});

test("D031: decisão paralela segue todos os ramos; condição nela é aviso. D024 vale para paralela", () => {
  const ops = (cond: boolean): Op[] => [ctx("c"), dn("e", { role: "domain-event", external: "x.e" }), dn("d", { role: "decision", gate: "parallel" }), dn("k1", { role: "command" }), dn("k2", { role: "command" }), dn("a", { role: "aggregate-root" }), trig("k1", "a"), trig("k2", "a"), trig("e", "d"), trig("d", "k1", cond ? { condition: "x" } : {}), trig("d", "k2")];
  assert.equal(has(build(ops(false)), "D031"), false);
  assert.equal(has(build(ops(false)), "D025"), false, "paralela não exige condição");
  assert.equal(has(build(ops(false)), "D026"), false, "paralela não exige senão");
  assert.ok(has(build(ops(true)), "D031"));
});

test("D027: junção precisa de 2+ entradas; decisão sem entrada é aviso", () => {
  const join = (inputs: number): Op[] => [
    ctx("c"),
    dn("a", { role: "aggregate-root" }),
    dn("k", { role: "command" }),
    trig("k", "a"),
    dn("j", { role: "decision", gate: "join" }),
    ...Array.from({ length: inputs }, (_, i) => dn(`e${i}`, { role: "domain-event", external: `x.e${i}` })),
    ...Array.from({ length: inputs }, (_, i) => trig(`e${i}`, "j")),
    trig("j", "k"),
  ];
  assert.ok(has(build(join(1)), "D027", "j"));
  assert.equal(has(build(join(2)), "D027"), false);
  assert.equal(has(build(join(2)), "D024"), false, "junção com uma saída é válida");
  const noOut = build([ctx("c"), dn("e", { role: "domain-event", external: "x.e" }), dn("e2", { role: "domain-event", external: "x.f" }), dn("j", { role: "decision", gate: "join" }), trig("e", "j"), trig("e2", "j")]);
  assert.ok(has(noOut, "D024", "j"), "junção sem saída");
  const noIn = build([ctx("c"), dn("d", { role: "decision" }), dn("k1", { role: "command" }), dn("k2", { role: "command" }), dn("a", { role: "aggregate-root" }), trig("k1", "a"), trig("k2", "a"), trig("d", "k1", { condition: "x" }), trig("d", "k2", { otherwise: true })]);
  assert.ok(issues(noIn, "D027").some((i) => i.severity === "aviso" && i.target === "d"));
});

test("D028/D029/D030: ciclo por decisão sem loop, loop sem parada, loop que não volta", () => {
  // k1 emite ev1, que alimenta a decisão, que volta a k1: um loop real
  const cycle = (loop: DddConnSpec["loop"] | undefined): Op[] => [
    ctx("c"),
    dn("a", { role: "aggregate-root" }),
    dn("k1", { role: "command" }),
    dn("k2", { role: "command" }),
    dn("ev1", { role: "domain-event" }),
    dn("d", { role: "decision" }),
    trig("k1", "a"),
    trig("k2", "a"),
    conn("k1", "ev1", { rel: "emits" }),
    trig("ev1", "d"),
    trig("d", "k1", { condition: "de novo", ...(loop ? { loop } : {}) }),
    trig("d", "k2", { otherwise: true }),
  ];
  assert.ok(has(build(cycle(undefined)), "D028", "d"), "ciclo sem loop declarado");
  const declared = build(cycle({ max: 3 }));
  assert.equal(has(declared, "D028"), false);
  assert.equal(has(declared, "D029"), false);
  assert.equal(has(declared, "D030"), false, "o loop fecha o ciclo");
  // sem parada: só chega por arquivo importado (as ops recusam)
  const noStop = build(cycle({ max: 3 }));
  noStop.connections.find((c) => c.ddd?.loop)!.ddd!.loop = {};
  assert.ok(has(noStop, "D029"));
  // loop marcado em um ramo que não volta
  const flat = build(cycle(undefined));
  flat.connections.find((c) => c.from === "d" && c.to === "k2")!.ddd!.loop = { max: 2 };
  const d30 = issues(flat, "D030");
  assert.equal(d30.length, 1);
  assert.equal(d30[0].severity, "dica");
});

test("D032: fluxo em relação que não é de fluxo (arquivo importado)", () => {
  const d = build([ctx("c"), dn("a", { role: "aggregate-root" }), dn("e", { role: "entity" }), conn("a", "e", { rel: "contains" })]);
  assert.equal(has(d, "D032"), false);
  d.connections[0].ddd!.condition = "x";
  assert.ok(has(d, "D032"));
});

test("D012: decisão isolada é aviso", () => {
  assert.ok(has(build([ctx("c"), dn("d", { role: "decision" })]), "D012", "d"));
});

test("a retentativa de cobrança é um modelo válido, sem erros nem avisos de fluxo", () => {
  const d = build(retry());
  const fluxo = validateDetailed(d).filter((i) => /^D0(2[4-9]|3[0-2])$/.test(i.rule) && i.severity !== "dica");
  assert.deepEqual(fluxo, []);
});

test("describe: decisões com ramos e a seção de fluxo condicional; o guia da IA explica o fluxo", () => {
  const text = describe(build(retry()));
  assert.match(text, /### Decisões\n- `tem-tentativas` \*\*tem-tentativas\*\* \(exclusiva\): ainda há tentativas\? → se tentativas < 3 · repete até pagamento aprovado, máx. 3: `cobrar` ↻; senão: `desistir`/);
  assert.match(text, /## Fluxo condicional, loops e iterações\n- `tem-tentativas` —\[se tentativas < 3 · repete até pagamento aprovado, máx. 3\]→ `cobrar` \(volta a um passo anterior\)/);
  assert.match(text, /—\[senão\]→ `desistir`/);
  const guide = schemaGuide("domain");
  assert.match(guide, /Decisões, condições, loops e iteração \(só no modo domain\)/);
  assert.match(guide, /`exclusive`[\s\S]*`parallel`[\s\S]*`join`/);
  assert.match(guide, /ddd\.loop: \{ until, max \}/);
  assert.doesNotMatch(schemaGuide(), /Decisões, condições/, "o guia de arquitetura não menciona fluxo de domínio");
});

test("timeline: a decisão fica na raia das reações, abaixo dos commands; evento externo que a alimenta entra na raia de cima, na mesma coluna", () => {
  const d = build(retry());
  const r = stormLayout(d);
  const pos = (id: string) => r.nodes.get(id)!;
  assert.equal(pos("tem-tentativas").x, pos("recusado").x, "o evento externo fica sobre quem reage a ele");
  assert.ok(pos("recusado").y < pos("cobrar").y && pos("cobrar").y < pos("tem-tentativas").y, "evento externo, commands, decisão");
  // evento interno: a decisão fica uma coluna depois dele
  const internal = build([ctx("c"), dn("a", { role: "aggregate-root" }), dn("k", { role: "command" }), dn("ev", { role: "domain-event" }), dn("d", { role: "decision" }), dn("k2", { role: "command" }), dn("k3", { role: "command" }), trig("k", "a"), trig("k2", "a"), trig("k3", "a"), conn("k", "ev", { rel: "emits" }), trig("ev", "d"), trig("d", "k2", { condition: "x" }), trig("d", "k3", { otherwise: true })]);
  const ri = stormLayout(internal).nodes;
  assert.equal(ri.get("d")!.x, ri.get("ev")!.x + 240, "uma coluna à frente do evento que a alimenta");
  const nodes = [...r.nodes.entries()];
  for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) assert.ok(nodes[i][1].x !== nodes[j][1].x || nodes[i][1].y !== nodes[j][1].y, `${nodes[i][0]} × ${nodes[j][0]}`);
});

function compiles(files: { path: string; content: string }[]): string {
  const dir = mkdtempSync(join(tmpdir(), "archflow-flow-"));
  try {
    for (const f of files.filter((x) => x.path.endsWith(".ts"))) {
      mkdirSync(dirname(join(dir, f.path)), { recursive: true });
      writeFileSync(join(dir, f.path), f.content);
    }
    writeFileSync(join(dir, "tsconfig.json"), JSON.stringify({ compilerOptions: { target: "ES2022", module: "ESNext", moduleResolution: "Bundler", strict: true, noEmit: true, skipLibCheck: true, types: [], lib: ["ES2022"] }, include: ["**/*.ts"] }));
    const r = spawnSync("npx", ["tsc", "-p", dir], { cwd: process.cwd(), encoding: "utf8", shell: true });
    return r.status === 0 ? "" : `${r.stdout}${r.stderr}`;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("código: decisão exclusiva, paralela e junção viram classes tipadas pelos ramos; loops e iteração entram na documentação; compila", () => {
  const doc = build([
    ...retry(),
    dn("e2", { role: "domain-event", external: "x.e2" }),
    dn("e3", { role: "domain-event", external: "x.e3" }),
    dn("par", { role: "decision", gate: "parallel", question: "o que fazer em paralelo?" }),
    dn("k3", { role: "command" }),
    dn("k4", { role: "command" }),
    dn("j", { role: "decision", gate: "join" }),
    dn("k5", { role: "command" }),
    trig("k3", "pag"),
    trig("k4", "pag"),
    trig("k5", "pag"),
    trig("e2", "par"),
    trig("par", "k3", { foreach: "item do pedido" }),
    trig("par", "k4"),
    trig("e2", "j"),
    trig("e3", "j"),
    trig("j", "k5"),
  ]);
  const files = generateCode(doc);
  const reactions = files.find((f) => f.path === "c/application/reactions.ts")!.content;
  assert.match(reactions, /export class TemTentativas \{\n {2}\/\*\* Escolhe UM ramo[^\n]*\n {2}decide\(event: DomainEvent\): "cobrar" \| "desistir" \{/);
  assert.match(reactions, /Ramo: se tentativas < 3 · repete até pagamento aprovado, máx. 3 → cobrar \(volta a um passo anterior\)/);
  assert.match(reactions, /Ramo: senão → desistir/);
  assert.match(reactions, /Decisão: ainda há tentativas\?/);
  assert.match(reactions, /export class Par \{\n[\s\S]*branches\(event: DomainEvent\): readonly \("k3" \| "k4"\)\[\] \{/);
  assert.match(reactions, /export class J \{\n[\s\S]*canContinue\(arrived: ReadonlySet<string>\): boolean \{/);
  const cobrar = files.find((f) => f.path === "c/application/cobrar-handler.ts")!.content;
  assert.match(cobrar, /Pode ser repetido \(se tentativas < 3 · repete até pagamento aprovado, máx. 3\), disparado por tem-tentativas\./);
  const k3 = files.find((f) => f.path === "c/application/k3-handler.ts")!.content;
  assert.match(k3, /Itera: para cada item do pedido\./);
  assert.equal(compiles(files), "");
});
