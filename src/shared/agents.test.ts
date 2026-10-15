import assert from "node:assert/strict";
import { test } from "node:test";
import { applyOps, describe, schemaGuide, validateDetailed, type Op } from "./ops";
import { emptyDoc, docMode, type AgentNodeSpec, type AgentRel, type Doc } from "./schema";
import { inGlobalGroup } from "./agents";

/* ───────── helpers ───────── */

const an = (id: string, agent: AgentNodeSpec, label?: string, parent?: string): Op => ({ op: "add_node", id, label: label ?? id, kind: "agent", agent, ...(parent ? { parent } : {}) });
const rel = (from: string, to: string, r: AgentRel): Op => ({ op: "add_connection", from, to, agent: { rel: r } });
const global = (id: string): Op => ({ op: "add_group", id, label: id, kind: "global" });

function build(ops: Op[]): Doc {
  const { doc, results } = applyOps(emptyDoc("t", "agents"), ops);
  const failed = results.map((r, i) => ({ r, op: ops[i] })).filter((x) => !x.r.ok);
  assert.deepEqual(failed, [], "ops do fixture devem aplicar sem erro");
  return doc;
}
const issues = (doc: Doc, rule: string) => validateDetailed(doc).filter((i) => i.rule === rule);
const has = (doc: Doc, rule: string, target?: string) => issues(doc, rule).some((i) => !target || i.target === target);
const serious = (doc: Doc) => validateDetailed(doc).filter((i) => i.severity !== "dica");

/** Time pequeno e consistente: um agente, uma skill plugada por seta. Nenhum erro nem aviso. */
const clean = (): Op[] => [
  an("revisor", { role: "agent", description: "Revisa pull requests e aponta bugs de correção e segurança." }, "Code Reviewer"),
  an("review-skill", { role: "skill", description: "Checklist de revisão de código: estilo, testes, segurança.", body: "..." }, "Review Checklist"),
  rel("revisor", "review-skill", "uses-skill"),
];

/* ───────── fase 1: schema ───────── */

test("emptyDoc: agents grava mode e docMode reconhece", () => {
  assert.equal(emptyDoc("a", "agents").mode, "agents");
  assert.equal(docMode(emptyDoc("a", "agents")), "agents");
});

/* ───────── fase 2/3: ops ───────── */

test("modelo limpo aplica e não gera erro nem aviso", () => {
  const doc = build(clean());
  assert.deepEqual(serious(doc), []);
  assert.equal(doc.nodes.find((n) => n.id === "revisor")!.kind, "agent");
});

test("add_connection infere o type a partir do rel", () => {
  const doc = build(clean());
  const c = doc.connections.find((c) => c.from === "revisor" && c.to === "review-skill")!;
  assert.equal(c.type, "dependency");
  const doc2 = build([an("a", { role: "agent", description: "Agente orquestrador que delega para especialistas." }), an("b", { role: "agent", description: "Agente especialista em testes automatizados." }), rel("a", "b", "delegates")]);
  assert.equal(doc2.connections[0].type, "sync");
});

test("ops rejeitam agent fora do modo agents, com mensagem acionável", () => {
  const r = applyOps(emptyDoc("a"), [an("x", { role: "agent", description: "x".repeat(20) })]);
  assert.equal(r.results[0].ok, false);
  assert.match(r.results[0].error!, /modo "agents"/);
  const k = applyOps(emptyDoc("a"), [{ op: "add_node", label: "x", kind: "agent" }]);
  assert.equal(k.results[0].ok, false);
  const c = applyOps(emptyDoc("a", "agents"), [{ op: "add_node", id: "a", label: "A" }, { op: "add_node", id: "b", label: "B" }, rel("a", "b", "delegates")]);
  assert.equal(c.results[2].ok, false);
});

test("ops rejeitam papel inválido, campo fora do papel, kind conflitante e rel inválido", () => {
  const doc = emptyDoc("d", "agents");
  const t = (op: Op) => applyOps(doc, [op]).results[0];
  assert.match(t(an("x", { role: "banana" as never })).error!, /agent\.role inválido/);
  assert.match(t(an("x", { role: "skill", model: "gpt" } as never)).error!, /campo "model" não existe no papel "skill"/);
  assert.match(t({ op: "add_node", label: "x", kind: "service", agent: { role: "agent", description: "x".repeat(20) } }).error!, /kind "agent"/);
  assert.match(t({ op: "add_node", label: "x", kind: "agent" }).error!, /agent deve ser um objeto/);
  const two = applyOps(doc, [an("a", { role: "agent", description: "x".repeat(20) }), an("b", { role: "agent", description: "x".repeat(20) }), { op: "add_connection", from: "a", to: "b", agent: { rel: "nope" as never } }]);
  assert.match(two.results[2].error!, /agent\.rel inválido/);
});

test("source do catálogo exige repo owner/repo e skillPath", () => {
  const doc = emptyDoc("d", "agents");
  const t = (op: Op) => applyOps(doc, [op]).results[0];
  assert.match(t(an("s", { role: "skill", description: "x".repeat(20), source: { repo: "semformato", skillPath: "a/SKILL.md" } })).error!, /owner\/repo/);
  assert.match(t(an("s", { role: "skill", description: "x".repeat(20), source: { repo: "a/b", skillPath: "" } })).error!, /skillPath/);
  assert.equal(t(an("s", { role: "skill", description: "x".repeat(20), source: { repo: "a/b", skillPath: "SKILL.md", hash: "abc" } })).ok, true);
});

test("update valida o patch de agent", () => {
  const doc = build(clean());
  const t = (patch: Record<string, unknown>, id = "revisor") => applyOps(doc, [{ op: "update", id, patch }]);
  assert.equal(t({ agent: { role: "agent", description: "Nova descrição bem detalhada aqui." } }).results[0].ok, true);
  assert.equal(t({ agent: { role: "agent", body: "x" } }).results[0].ok, false, "body não existe no papel agent (só em skill)");
  const removed = t({ agent: null }).doc.nodes.find((n) => n.id === "revisor")!;
  assert.equal("agent" in removed, false);
  assert.equal(applyOps(build([{ op: "add_node", id: "s", label: "S", kind: "system" }]), [{ op: "update", id: "s", patch: { kind: "agent" } }]).results[0].ok, false);
});

test("set_meta aceita e remove o modo agents", () => {
  const dom = applyOps(emptyDoc("a"), [{ op: "set_meta", mode: "agents" }]).doc;
  assert.equal(dom.mode, "agents");
  const back = applyOps(dom, [{ op: "set_meta", mode: "architecture" }]).doc;
  assert.equal("mode" in back, false);
});

/* ───────── fase 3: regras A001–A009 ───────── */

test("A001: agent sem description, ou com description curta demais", () => {
  assert.ok(has(build([an("x", { role: "agent" })]), "A001", "x"));
  assert.ok(has(build([an("x", { role: "agent", description: "curta" })]), "A001", "x"));
  assert.equal(has(build(clean()), "A001"), false);
});

test("A002: skill sem description, e skill de catálogo sem hash avisa A006", () => {
  assert.ok(has(build([an("x", { role: "skill" })]), "A002", "x"));
  const cat = build([an("x", { role: "skill", description: "Skill vinda do catálogo externo aqui.", source: { repo: "a/b", skillPath: "SKILL.md" } })]);
  assert.ok(has(cat, "A006", "x"));
  const resolved = build([an("x", { role: "skill", description: "Skill vinda do catálogo externo aqui.", source: { repo: "a/b", skillPath: "SKILL.md", hash: "abc" } })]);
  assert.equal(has(resolved, "A006"), false);
});

test("A003: skill órfã (sem uses-skill e fora do Global); dentro do Global não é órfã", () => {
  const orphan = build([an("s", { role: "skill", description: "x".repeat(20) })]);
  assert.ok(has(orphan, "A003", "s"));
  const inGlobal = build([global("g"), an("s", { role: "skill", description: "x".repeat(20) }, "S", "g")]);
  assert.equal(has(inGlobal, "A003"), false);
  assert.ok(inGlobalGroup(inGlobal, "s"));
  assert.equal(has(build(clean()), "A003"), false);
});

test("A004: seta uses-skill redundante para skill já global", () => {
  const doc = build([
    global("g"),
    an("a", { role: "agent", description: "x".repeat(20) }),
    an("s", { role: "skill", description: "x".repeat(20) }, "S", "g"),
    rel("a", "s", "uses-skill"),
  ]);
  assert.ok(has(doc, "A004"));
});

test("A005: ciclo de delegates entre agentes", () => {
  const ag = (id: string) => an(id, { role: "agent", description: "x".repeat(20) });
  const cycle = build([ag("a"), ag("b"), rel("a", "b", "delegates"), rel("b", "a", "delegates")]);
  assert.ok(has(cycle, "A005"));
  const line = build([ag("a"), ag("b"), rel("a", "b", "delegates")]);
  assert.equal(has(line, "A005"), false);
});

test("A008/A009: combinação de relação inválida para o par, e conexão sem relação", () => {
  const doc = build([...clean(), an("b", { role: "agent", description: "x".repeat(20) })]);
  // skill -> agent via delegates não é um par válido (delegates é agent -> agent)
  const bad = applyOps(doc, [{ op: "add_connection", from: "review-skill", to: "b", agent: { rel: "delegates" as never } }]);
  assert.equal(bad.results[0].ok, true, "a validação de par é um aviso A008, não bloqueia a op");
  assert.ok(has(bad.doc, "A008"));
});

test("agentsMode não aplica a regra de nó isolado da arquitetura", () => {
  const doc = build([an("solo", { role: "agent", description: "Um agente avulso, sem skills plugadas ainda." })]);
  assert.equal(has(doc, "BASE"), false);
});

/* ───────── describe / guia ───────── */

test("describe do modo agents: agentes, skills, escopo global e avisos com id de regra", () => {
  const doc = build([...clean(), global("g"), an("util", { role: "skill", description: "Skill utilitária disponível para todos." }, "Util", "g")]);
  const text = describe(doc);
  assert.match(text, /## Agentes/);
  assert.match(text, /\*\*Code Reviewer\*\* \(revisor\)/);
  assert.match(text, /usa as skills: Review Checklist/);
  assert.match(text, /## Skills/);
  assert.match(text, /GLOBAL \(todos os agentes\)/);
  assert.match(text, /Skills globais \(grupo "Global"\): Util/);
  assert.match(text, /```mermaid/);
  assert.equal(describe(doc), describe(doc), "determinístico");
});

test("describe: lista avisos com severidade e id de regra quando há problema", () => {
  const doc = build([an("x", { role: "agent" })]);
  const text = describe(doc);
  assert.match(text, /\[A001 erro\]/);
});

test("schemaGuide: modo agents lista papéis, relações e o fluxo recomendado; architecture não muda", () => {
  const g = schemaGuide("agents");
  for (const k of ["agent", "skill", "uses-skill", "delegates", "modo AGENTS", "Global"]) assert.ok(g.includes(k), k);
  const arch = schemaGuide();
  assert.equal(arch, schemaGuide("architecture"));
  assert.ok(!arch.includes("uses-skill"));
});
