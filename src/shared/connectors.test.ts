import assert from "node:assert/strict";
import { test } from "node:test";
import { connectionTypeError, relAllows, relEnd, relPairsText, suggestRels } from "./domain";
import { applyOps, validateDetailed, type Op } from "./ops";
import { DDD_REL_KEYS, DDD_REL_PAIRS, DDD_RELS, DDD_ROLE_KEYS, emptyDoc, type DddNodeSpec, type Doc } from "./schema";

const ctx = (id: string): Op => ({ op: "add_group", id, label: id, kind: "context", subdomain: "core" });
const dn = (id: string, ddd: DddNodeSpec, parent = "c"): Op => ({ op: "add_node", id, label: id, ddd, parent });

/** Um exemplar de cada papel, para exercitar a matriz inteira. */
const world = (): Doc => {
  const ops: Op[] = [
    ctx("c"),
    ctx("c2"),
    dn("root", { role: "aggregate-root" }),
    dn("root2", { role: "aggregate-root" }),
    dn("ent", { role: "entity" }),
    dn("vo", { role: "value-object" }),
    dn("cmd", { role: "command" }),
    dn("evt", { role: "domain-event" }),
    dn("pol", { role: "policy" }),
    dn("saga", { role: "process-manager" }),
    dn("rm", { role: "read-model" }),
    dn("uc", { role: "use-case" }),
    dn("dsvc", { role: "domain-service" }),
    dn("asvc", { role: "application-service" }),
    dn("repo", { role: "repository", for: "root" }),
    { op: "add_node", id: "ator", label: "Cliente", kind: "actor", parent: "c" },
    { op: "add_node", id: "ref", label: "Pagamentos", kind: "system", ref: { diagram: "dominio/pagamentos.archflow.json" } },
    { op: "add_node", id: "impl", label: "Orders API", kind: "system", parent: "c", ref: { diagram: "arquitetura.archflow.json", node: "orders-api" } },
  ];
  const r = applyOps(emptyDoc("t", "domain"), ops);
  assert.deepEqual(r.results.filter((x) => !x.ok), []);
  return r.doc;
};
const connect = (doc: Doc, op: { from: string; to: string; type?: Extract<Op, { op: "add_connection" }>["type"]; label?: string; ddd?: Extract<Op, { op: "add_connection" }>["ddd"] }) => applyOps(doc, [{ op: "add_connection", ...op }]);

test("a matriz DDD_REL_PAIRS cobre todas as relações e só cita papéis que existem", () => {
  assert.deepEqual(Object.keys(DDD_REL_PAIRS).sort(), [...DDD_REL_KEYS].sort());
  for (const [rel, pairs] of Object.entries(DDD_REL_PAIRS)) {
    assert.ok(pairs.length > 0, rel);
    for (const p of pairs) for (const e of [...p.from, ...p.to]) assert.ok(e === "context" || DDD_ROLE_KEYS.includes(e), `${rel}: ${e}`);
  }
  assert.equal(relPairsText("emits"), "command|aggregate-root|process-manager → domain-event");
});

test("suggestRels: os pares do dia a dia têm exatamente uma relação; o resto não tem nenhuma", () => {
  const d = world();
  const only: [string, string, string][] = [
    ["cmd", "root", "triggers"],
    ["cmd", "evt", "emits"],
    ["root", "evt", "emits"],
    ["saga", "evt", "emits"],
    ["root", "ent", "contains"],
    ["root", "vo", "contains"],
    ["ent", "vo", "contains"],
    ["ent", "ent", "contains"],
    ["root", "root2", "references-by-id"],
    ["ent", "root2", "references-by-id"],
    ["cmd", "uc", "realizes"],
    ["asvc", "uc", "realizes"],
    ["evt", "pol", "triggers"],
    ["evt", "rm", "triggers"],
    ["evt", "saga", "triggers"],
    ["pol", "cmd", "triggers"],
    ["cmd", "dsvc", "uses"],
    ["cmd", "repo", "uses"],
    ["asvc", "repo", "uses"],
    ["saga", "repo", "uses"],
    ["saga", "cmd", "triggers"],
    ["ref", "ref", "context-relation"],
    ["c", "c2", "context-relation"],
  ];
  for (const [f, t, rel] of only) assert.deepEqual(suggestRels(d, f, t), [rel], `${f} → ${t}`);
  for (const [f, t] of [["ator", "uc"], ["uc", "cmd"], ["vo", "root"], ["evt", "cmd"], ["root", "cmd"], ["vo", "ent"], ["repo", "root"]]) assert.deepEqual(suggestRels(d, f, t), [], `${f} → ${t} não tem relação de domínio`);
  assert.equal(relEnd(d, "ator"), undefined);
  assert.equal(relEnd(d, "ref"), "context");
  assert.equal(relEnd(d, "impl"), undefined, "referência à arquitetura dentro de um contexto não é um contexto");
  assert.deepEqual(suggestRels(d, "impl", "root"), []);
  assert.equal(relEnd(d, "root"), "aggregate-root");
  assert.equal(relAllows("emits", "command", "domain-event"), true);
  assert.equal(relAllows("emits", undefined, "domain-event"), false);
});

test("connectionTypeError: infraestrutura é recusada, o tipo da relação é fixo e os tipos UML são livres", () => {
  for (const t of ["sync", "async", "stream", "data"] as const) assert.match(connectionTypeError(undefined, t)!, /de infraestrutura/);
  for (const t of ["association", "dependency", "inheritance", "realization", "composition", "aggregation"] as const) assert.equal(connectionTypeError(undefined, t), undefined);
  for (const rel of DDD_REL_KEYS) {
    assert.equal(connectionTypeError(rel, DDD_RELS[rel].type), undefined);
    assert.match(connectionTypeError(rel, DDD_RELS[rel].type === "sync" ? "data" : "sync")!, new RegExp(`fixa o type em "${DDD_RELS[rel].type}"`));
  }
  assert.equal(connectionTypeError("emits", undefined), undefined);
});

test("add_connection no modo domain: nasce com a relação quando só uma serve, e o tipo vem dela", () => {
  const d = world();
  const c1 = connect(d, { from: "cmd", to: "evt" }).doc.connections[0];
  assert.deepEqual({ rel: c1.ddd?.rel, type: c1.type, label: c1.label }, { rel: "emits", type: "async", label: "emits" });
  const c2 = connect(d, { from: "root", to: "ent", label: "itens" }).doc.connections[0];
  assert.deepEqual({ rel: c2.ddd?.rel, type: c2.type, label: c2.label }, { rel: "contains", type: "composition", label: "itens" });
  // sem relação possível (ator → caso de uso): conector UML livre, padrão association
  const c3 = connect(d, { from: "ator", to: "uc", label: "executa" }).doc.connections[0];
  assert.deepEqual({ ddd: c3.ddd, type: c3.type }, { ddd: undefined, type: "association" });
  // em architecture o padrão continua sync
  const arch = applyOps(emptyDoc("a"), [{ op: "add_node", id: "x", label: "X" }, { op: "add_node", id: "y", label: "Y" }, { op: "add_connection", from: "x", to: "y" }]).doc.connections[0];
  assert.equal(arch.type, "sync");
  assert.equal(arch.ddd, undefined);
});

test("add_connection no modo domain: recusa infraestrutura e tipo que contradiz a relação, com mensagem acionável", () => {
  const d = world();
  for (const type of ["sync", "async", "stream", "data"] as const) {
    const r = connect(d, { from: "cmd", to: "evt", type });
    assert.equal(r.results[0].ok, false, type);
    assert.match(r.results[0].error!, /de infraestrutura/);
  }
  const bad = connect(d, { from: "cmd", to: "evt", type: "sync", ddd: { rel: "emits" } });
  assert.match(bad.results[0].error!, /a relação "emits" fixa o type em "async" \(recebeu "sync"\)/);
  assert.equal(connect(d, { from: "cmd", to: "evt", type: "async", ddd: { rel: "emits" } }).results[0].ok, true, "tipo coerente com a relação é aceito");
  assert.equal(connect(d, { from: "ator", to: "uc", type: "dependency" }).results[0].ok, true, "tipo UML livre");
  assert.equal(connect(d, { from: "ator", to: "uc", type: "data" }).results[0].ok, false);
});

test("update no modo domain: o tipo acompanha a relação e não pode contradizê-la", () => {
  const base = connect(world(), { from: "cmd", to: "evt" }).doc;
  const id = base.connections[0].id;
  const up = (patch: Record<string, unknown>, doc: Doc = base) => applyOps(doc, [{ op: "update", id, patch }]);
  assert.equal(up({ type: "sync" }).results[0].ok, false, "type isolado contradiz a relação");
  assert.equal(up({ type: "async" }).results[0].ok, true);
  assert.equal(up({ label: "novo" }).results[0].ok, true);
  // remover a relação libera os tipos UML e continua recusando infraestrutura
  const freed = up({ ddd: null }).doc;
  assert.equal(up({ type: "dependency" }, freed).results[0].ok, true);
  assert.equal(up({ type: "sync" }, freed).results[0].ok, false);
  // definir a relação sem dizer o tipo: o tipo vai junto; com tipo errado, recusa
  const noRel = connect(world(), { from: "ator", to: "uc" }).doc;
  const nid = noRel.connections[0].id;
  assert.equal(applyOps(noRel, [{ op: "update", id: nid, patch: { ddd: { rel: "emits" }, type: "sync" } }]).results[0].ok, false);
  const auto = applyOps(noRel, [{ op: "update", id: nid, patch: { ddd: { rel: "realizes" } } }]).doc.connections[0];
  assert.equal(auto.type, "realization");
});

test("D021: combinação de papéis inválida para a relação, com a sugestão do que serve", () => {
  const d = world();
  d.connections.push({ id: "x1", from: "evt", to: "cmd", type: "async", ddd: { rel: "emits" } });
  const i = validateDetailed(d).filter((x) => x.rule === "D021");
  assert.equal(i.length, 1);
  assert.match(i[0].message, /combinação inválida; emits liga command\|aggregate-root\|process-manager → domain-event/);
  assert.equal(i[0].target, "x1");
  // um par válido não gera nada
  const ok = connect(world(), { from: "cmd", to: "evt" }).doc;
  assert.deepEqual(validateDetailed(ok).filter((x) => x.rule === "D021" || x.rule === "D022" || x.rule === "D023"), []);
});

test("D022: conector de infraestrutura ou conexão entre elementos de domínio sem relação", () => {
  const d = world();
  d.connections.push({ id: "i1", from: "cmd", to: "evt", type: "sync" });
  d.connections.push({ id: "i2", from: "root", to: "root2", type: "association" });
  d.connections.push({ id: "i3", from: "evt", to: "cmd", type: "dependency" });
  d.connections.push({ id: "ok1", from: "ator", to: "uc", type: "association" });
  const issues = validateDetailed(d).filter((x) => x.rule === "D022");
  assert.deepEqual(issues.map((x) => x.target).sort(), ["i1", "i2", "i3"]);
  assert.match(issues.find((x) => x.target === "i1")!.message, /o tipo "sync" é de infraestrutura.*para este par: emits/);
  assert.match(issues.find((x) => x.target === "i2")!.message, /sem relação; use: references-by-id/);
  assert.match(issues.find((x) => x.target === "i3")!.message, /nenhuma relação de domínio liga este par/);
});

test("D023: tipo da conexão contradiz a relação (arquivo importado ou editado fora do app)", () => {
  const d = connect(world(), { from: "cmd", to: "evt" }).doc;
  assert.equal(validateDetailed(d).some((x) => x.rule === "D023"), false);
  d.connections[0].type = "sync";
  const i = validateDetailed(d).filter((x) => x.rule === "D023");
  assert.equal(i.length, 1);
  assert.match(i[0].message, /a relação emits usa o tipo "async", mas a conexão está como "sync"/);
});

test("diagramas de arquitetura não passam por estas regras", () => {
  const d = applyOps(emptyDoc("a"), [{ op: "add_node", id: "x", label: "X" }, { op: "add_node", id: "y", label: "Y" }, { op: "add_connection", from: "x", to: "y", type: "data" }]).doc;
  assert.deepEqual(validateDetailed(d).filter((x) => /^D0/.test(x.rule)), []);
});
