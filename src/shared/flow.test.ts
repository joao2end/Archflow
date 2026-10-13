import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { generateCode } from "./codegen";
import { checkDddConn, checkDddNode, composeDddLabel, dddLabelVia, flowText, suggestRels } from "./domain";
import { applyOps, describe, normalizeDoc, schemaGuide, validateDetailed, type Op } from "./ops";
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

/** Retentativa de cobrança: policy com ramos condicionais, loop e ramo "senão". */
const retry = (): Op[] => [
  ctx("c"),
  dn("pag", { role: "aggregate-root" }),
  dn("cobrar", { role: "command" }),
  dn("desistir", { role: "command" }),
  dn("recusado", { role: "domain-event", external: "pagamentos.recusado" }),
  dn("cobranca-iniciada", { role: "domain-event" }),
  dn("tem-tentativas", { role: "policy", intent: "ainda há tentativas?" }),
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

test("fluxo: o papel decision não existe no modo domain (é só do modo logic); campos de outros papéis são recusados", () => {
  assert.match(checkDddNode({ role: "decision" })!, /ddd\.role inválido "decision"/);
  assert.match(checkDddNode({ role: "policy", gate: "join" })!, /campo "gate" não existe no papel "policy"/);
  assert.match(checkDddNode({ role: "policy", question: "ok?" })!, /campo "question" não existe no papel "policy"/);
  assert.equal(checkDddNode({ role: "policy", intent: "ok?" }), undefined);
  const r = applyOps(emptyDoc("t", "domain"), [{ op: "add_node", id: "d", label: "D", ddd: { role: "decision" } } as never]);
  assert.equal(r.results[0].ok, false);
});

test("fluxo: arquivo antigo com decision no modo domain é migrado ao abrir (exclusiva e paralela viram policy, junção vira process-manager, encadeadas viram uma só)", () => {
  const mk = (id: string, ddd: object) => ({ id, label: id, kind: "domain", x: 0, y: 0, w: 10, h: 10, ddd });
  const e = (id: string, from: string, to: string, ddd: object) => ({ id, from, to, type: "dependency", ddd });
  const velho = normalizeDoc({
    title: "t", mode: "domain",
    nodes: [
      mk("ev", { role: "domain-event" }), mk("ev2", { role: "domain-event" }),
      mk("d1", { role: "decision", gate: "exclusive", question: "no prazo?" }), mk("d2", { role: "decision", question: "atraso grave?" }),
      mk("par", { role: "decision", gate: "parallel", question: "o que fazer?" }), mk("jun", { role: "decision", gate: "join", question: "pronto e alocado?" }),
      mk("a", { role: "command" }), mk("b", { role: "command" }), mk("c", { role: "command" }), mk("k1", { role: "command" }), mk("k2", { role: "command" }), mk("k3", { role: "command" }),
    ],
    connections: [
      e("1", "ev", "d1", { rel: "triggers" }), e("2", "d1", "a", { rel: "triggers", condition: "no prazo" }), e("3", "d1", "d2", { rel: "triggers", otherwise: true }),
      e("4", "d2", "b", { rel: "triggers", condition: "grave" }), e("5", "d2", "c", { rel: "triggers", otherwise: true }),
      e("6", "ev", "par", { rel: "triggers" }), e("7", "par", "k1", { rel: "triggers", condition: "x" }), e("8", "par", "k2", { rel: "triggers" }),
      e("9", "ev", "jun", { rel: "triggers" }), e("10", "ev2", "jun", { rel: "triggers" }), e("11", "jun", "k3", { rel: "triggers" }),
    ],
  });
  const node = (id: string) => velho.nodes.find((n) => n.id === id);
  assert.equal(node("d1")?.ddd?.role, "policy");
  assert.equal(node("d1")!.ddd!.intent, "no prazo?");
  assert.equal(node("d2"), undefined, "a decisão encadeada foi absorvida pela primeira");
  const saiDeD1 = velho.connections.filter((c) => c.from === "d1").map((c) => [c.to, c.ddd?.condition ?? (c.ddd?.otherwise ? "senão" : "")]);
  assert.deepEqual(saiDeD1, [["a", "no prazo"], ["b", "grave"], ["c", "senão"]]);
  assert.equal(node("par")?.ddd?.role, "policy");
  assert.ok(velho.connections.filter((c) => c.from === "par").every((c) => !c.ddd?.condition && !c.ddd?.otherwise), "paralela: os ramos seguem todos, sem condição");
  assert.equal(node("jun")?.ddd?.role, "process-manager");
  assert.deepEqual(node("jun")!.ddd!.reactsTo, ["ev", "ev2"]);
  assert.deepEqual(node("jun")!.ddd!.issues, ["k3"]);
  assert.ok(!velho.nodes.some((n) => (n.ddd as { role?: string }).role === "decision"), "nenhuma decisão sobra");
  assert.deepEqual(normalizeDoc(velho).nodes.map((n) => n.id), velho.nodes.map((n) => n.id), "idempotente");
});

test("fluxo: só no modo domain (as ops recusam policy e fluxo em diagramas de arquitetura)", () => {
  const arch = emptyDoc("a");
  assert.match(applyOps(arch, [dn("d", { role: "policy" }, "")]).results[0].error!, /modo "domain"/);
  const two = applyOps(arch, [{ op: "add_node", id: "x", label: "X" }, { op: "add_node", id: "y", label: "Y" }, conn("x", "y", { rel: "triggers", condition: "a" })]);
  assert.equal(two.results[2].ok, false);
  assert.match(two.results[2].error!, /modo "domain"/);
  assert.equal(applyOps(arch, [{ op: "add_node", id: "y", label: "Y" }, { op: "update", id: "y", patch: { ddd: { role: "policy" }, kind: "domain" } }]).results[1].ok, false);
});

test("fluxo: a matriz liga evento → policy → command e a relação é inferida", () => {
  const d = build(retry());
  assert.deepEqual(suggestRels(d, "recusado", "tem-tentativas"), ["triggers"]);
  assert.deepEqual(suggestRels(d, "tem-tentativas", "cobrar"), ["triggers"]);
  assert.deepEqual(suggestRels(d, "cobrar", "tem-tentativas"), [], "command não alimenta policy diretamente");
  assert.deepEqual(suggestRels(d, "tem-tentativas", "recusado"), [], "policy não emite evento");
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

test("D025/D026: ramos condicionais de uma policy: cada ramo tem condição ou é o senão, só um senão, e é bom ter um", () => {
  assert.deepEqual(issues(build(retry()), "D025"), []);
  assert.deepEqual(issues(build(retry()), "D026"), []);
  const ramos = (...extras: Partial<DddConnSpec>[]): Doc =>
    build([ctx("c"), dn("e", { role: "domain-event", external: "x.e" }), dn("p", { role: "policy" }), dn("a", { role: "aggregate-root" }),
      ...extras.flatMap((x, i) => [dn(`k${i}`, { role: "command" }), trig(`k${i}`, "a"), trig("p", `k${i}`, x)]), trig("e", "p")]);
  const semCond = ramos({ condition: "x" }, {});
  assert.ok(has(semCond, "D025"), "ramo sem condição entre irmãos condicionais");
  assert.ok(has(semCond, "D026", "p"), "sem ramo senão");
  assert.equal(issues(ramos({ condition: "x" }, { otherwise: true }), "D026").length, 0);
  assert.equal(issues(ramos({ otherwise: true }, { otherwise: true }), "D025").some((i) => /2 ramos "senão"/.test(i.message)), true);
  assert.equal(has(ramos({}, {}), "D025") || has(ramos({}, {}), "D026"), false, "ramos sem nenhuma condição seguem todos (paralelo): sem aviso");
  // `triggers` e `emits` de um command não se misturam: o triggers para o aggregate não é um ramo condicional
  const cmd = build([ctx("c"), dn("a", { role: "aggregate-root" }), dn("k", { role: "command" }), dn("ok", { role: "domain-event" }), dn("no", { role: "domain-event" }), trig("k", "a"), conn("k", "ok", { rel: "emits", condition: "x" }), conn("k", "no", { rel: "emits", otherwise: true })]);
  assert.deepEqual(issues(cmd, "D025"), []);
});

test("D028/D029/D030: ciclo por policy com ramos condicionais sem loop, loop sem parada, loop que não volta", () => {
  // k1 emite ev1, que alimenta a policy, que volta a k1: um loop real
  const cycle = (loop: DddConnSpec["loop"] | undefined): Op[] => [
    ctx("c"),
    dn("a", { role: "aggregate-root" }),
    dn("k1", { role: "command" }),
    dn("k2", { role: "command" }),
    dn("ev1", { role: "domain-event" }),
    dn("d", { role: "policy" }),
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

test("D012: policy isolada é aviso", () => {
  assert.ok(has(build([ctx("c"), dn("d", { role: "policy" })]), "D012", "d"));
});

test("a retentativa de cobrança é um modelo válido, sem erros nem avisos de fluxo", () => {
  const d = build(retry());
  const fluxo = validateDetailed(d).filter((i) => /^D0(2[5-9]|3[0-2])$/.test(i.rule) && i.severity !== "dica");
  assert.deepEqual(fluxo, []);
});

test("describe: policy com ramos condicionais e a seção de fluxo; o guia da IA explica o fluxo e diz que decision é só do modo logic", () => {
  const text = describe(build(retry()));
  assert.match(text, /### Policies\n- `tem-tentativas` \*\*tem-tentativas\*\* — ainda há tentativas\? → se tentativas < 3 · repete até pagamento aprovado, máx. 3: `cobrar` ↻; senão: `desistir`/);
  assert.match(text, /## Fluxo condicional, loops e iterações\n- `tem-tentativas` —\[se tentativas < 3 · repete até pagamento aprovado, máx. 3\]→ `cobrar` \(volta a um passo anterior\)/);
  assert.match(text, /—\[senão\]→ `desistir`/);
  const guide = schemaGuide("domain");
  assert.match(guide, /Condições, loops e iteração \(só no modo domain\)/);
  assert.match(guide, /Não existe `decision` no modo domain/);
  assert.match(guide, /ddd\.loop: \{ until, max \}/);
  assert.doesNotMatch(schemaGuide(), /Condições, loops/, "o guia de arquitetura não menciona fluxo de domínio");
});

test("timeline: a policy com ramos fica na raia das reações, abaixo dos commands, e o evento externo que a alimenta entra na raia de cima", () => {
  const d = build(retry());
  const r = stormLayout(d);
  const pos = (id: string) => r.nodes.get(id)!;
  assert.ok(pos("recusado").y < pos("cobrar").y && pos("cobrar").y < pos("tem-tentativas").y, "evento externo, commands, policy");
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

test("código: policy com ramos e saga de junção entram em reactions.ts, com os ramos, loops e iteração na documentação; compila", () => {
  const doc = build([
    ...retry(),
    dn("e2", { role: "domain-event", external: "x.e2" }),
    dn("e3", { role: "domain-event", external: "x.e3" }),
    dn("par", { role: "policy", intent: "o que fazer em paralelo?" }),
    dn("k3", { role: "command" }),
    dn("k4", { role: "command" }),
    dn("j", { role: "process-manager", intent: "espera os dois eventos", reactsTo: ["e2", "e3"], issues: ["k5"] }),
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
  assert.match(reactions, /export class TemTentativas \{/);
  assert.match(reactions, /Ramo: se tentativas < 3 · repete até pagamento aprovado, máx. 3 → cobrar \(volta a um passo anterior\)/);
  assert.match(reactions, /Ramo: senão → desistir/);
  assert.match(reactions, /Ramo: para cada item do pedido → k3/);
  assert.match(reactions, /export class J \{/);
  assert.match(reactions, /Reage a: e2, e3\./);
  const cobrar = files.find((f) => f.path === "c/application/cobrar-handler.ts")!.content;
  assert.match(cobrar, /Pode ser repetido \(se tentativas < 3 · repete até pagamento aprovado, máx. 3\), disparado por tem-tentativas\./);
  const k3 = files.find((f) => f.path === "c/application/k3-handler.ts")!.content;
  assert.match(k3, /Itera: para cada item do pedido\./);
  assert.equal(compiles(files), "");
});
