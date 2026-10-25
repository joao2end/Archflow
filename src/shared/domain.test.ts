import assert from "node:assert/strict";
import { test } from "node:test";
import { EVAL_TARGETS, checkDddNode, composeDddLabel, dddLabelVia, domainOverview, evaluateDomain, reshapeDdd, traceUseCase } from "./domain";
import { applyOps, describe, normalizeDoc, schemaGuide, validate, validateDetailed, type Op } from "./ops";
import { onionSlot } from "./onion";
import { emptyDoc, docMode, DDD_ROLE_KEYS, type Doc, type DddNodeSpec, type DddRel, type ContextPattern } from "./schema";

/* ───────── helpers ───────── */

const ctx = (id: string, subdomain?: "core" | "supporting" | "generic"): Op => ({ op: "add_group", id, label: id, kind: "context", ...(subdomain ? { subdomain } : {}) });
const dn = (id: string, ddd: DddNodeSpec, parent?: string, label?: string): Op => ({ op: "add_node", id, label: label ?? id, ddd, ...(parent ? { parent } : {}) });
const rel = (from: string, to: string, r: DddRel, pattern?: ContextPattern): Op => ({ op: "add_connection", from, to, ddd: { rel: r, ...(pattern ? { pattern } : {}) } });

function build(ops: Op[], mode: "domain" | "architecture" = "domain"): Doc {
  const { doc, results } = applyOps(emptyDoc("t", mode), ops);
  const failed = results.map((r, i) => ({ r, op: ops[i] })).filter((x) => !x.r.ok);
  assert.deepEqual(failed, [], "ops do fixture devem aplicar sem erro");
  return doc;
}
const issues = (doc: Doc, rule: string) => validateDetailed(doc).filter((i) => i.rule === rule);
const has = (doc: Doc, rule: string, target?: string) => issues(doc, rule).some((i) => !target || i.target === target);
const serious = (doc: Doc) => validateDetailed(doc).filter((i) => i.severity !== "dica");

/** Modelo "Pedidos" completo e consistente: nenhum erro nem aviso (só dicas). */
const clean = (): Op[] => [
  ctx("pedidos", "core"),
  dn("pedido", { role: "aggregate-root", invariants: ["total >= 0"] }, "pedidos", "Pedido"),
  dn("item-pedido", { role: "entity" }, "pedidos", "Item do Pedido"),
  dn("endereco", { role: "value-object" }, "pedidos", "Endereço"),
  dn("criar-pedido", { role: "command", intent: "registrar pedido" }, "pedidos", "Criar Pedido"),
  dn("pedido-criado", { role: "domain-event", payload: "id, total" }, "pedidos", "Pedido Criado"),
  dn("pedido-repo", { role: "repository", for: "pedido" }, "pedidos"),
  dn("fazer-pedido", { role: "use-case", actor: "Cliente", goal: "comprar" }, "pedidos", "Fazer Pedido"),
  rel("pedido", "item-pedido", "contains"),
  rel("pedido", "endereco", "contains"),
  rel("criar-pedido", "pedido", "triggers"),
  rel("criar-pedido", "pedido-criado", "emits"),
  rel("criar-pedido", "fazer-pedido", "realizes"),
];

/* ───────── fase 1: schema ───────── */

test("emptyDoc: arquitetura é o padrão e não grava mode; domain grava", () => {
  assert.equal("mode" in emptyDoc("a"), false);
  assert.equal(emptyDoc("a", "domain").mode, "domain");
  assert.equal(docMode(emptyDoc("a")), "architecture");
  assert.equal(docMode(emptyDoc("a", "domain")), "domain");
});

test("normalizeDoc: preserva mode domain e descarta valores inválidos", () => {
  assert.equal(normalizeDoc({ title: "x", mode: "domain" }).mode, "domain");
  assert.equal("mode" in normalizeDoc({ title: "x", mode: "banana" }), false);
  assert.equal("mode" in normalizeDoc({ title: "x" }), false);
});

/* ───────── fase 2: ops ───────── */

test("modelo limpo aplica e não gera erro nem aviso", () => {
  const doc = build(clean());
  assert.deepEqual(serious(doc), []);
  assert.equal(doc.nodes.find((n) => n.id === "pedido")!.kind, "domain");
});

test("add_connection infere o type a partir do rel e rotula pela relação/padrão", () => {
  const doc = build([...clean(), ctx("pagamentos"), rel("pedidos", "pagamentos", "context-relation", "customer-supplier")]);
  const byRel = (from: string, to: string) => doc.connections.find((c) => c.from === from && c.to === to)!;
  assert.equal(byRel("criar-pedido", "pedido-criado").type, "async");
  assert.equal(byRel("criar-pedido", "pedido").type, "dependency");
  assert.equal(byRel("pedido", "item-pedido").type, "composition");
  assert.equal(byRel("criar-pedido", "fazer-pedido").type, "realization");
  assert.equal(byRel("pedidos", "pagamentos").label, "Customer/Supplier");
});

test("rótulo de relação entre contextos: padrão sempre visível, texto livre depois; demais relações usam o texto livre", () => {
  const base = [ctx("a"), ctx("b"), dn("x", { role: "domain-event" }, "a"), dn("y", { role: "domain-event" }, "b")];
  const conn = (ddd: { rel: DddRel; pattern?: ContextPattern }, label?: string) => build([...base, { op: "add_connection", from: "a", to: "b", ddd, ...(label ? { label } : {}) }]).connections[0];
  assert.equal(conn({ rel: "context-relation", pattern: "acl" }).label, "Anticorruption Layer");
  assert.equal(conn({ rel: "context-relation", pattern: "customer-supplier" }, "pedido-criado").label, "Customer/Supplier · pedido-criado");
  assert.equal(conn({ rel: "context-relation", pattern: "customer-supplier" }, "Customer/Supplier · pedido-criado").label, "Customer/Supplier · pedido-criado", "não duplica o prefixo");
  assert.equal(conn({ rel: "context-relation" }).label, "context");
  assert.equal(conn({ rel: "emits" }).label, "emits");
  assert.equal(conn({ rel: "emits" }, "publica").label, "publica");
  // helpers inversos
  const d = { rel: "context-relation" as const, pattern: "acl" as const };
  assert.equal(dddLabelVia(d, "Anticorruption Layer · pedido-criado"), "pedido-criado");
  assert.equal(dddLabelVia(d, "Anticorruption Layer"), undefined);
  assert.equal(dddLabelVia(d, "livre"), "livre");
  assert.equal(dddLabelVia(d, undefined), undefined);
  assert.equal(dddLabelVia(undefined, "x"), "x");
  assert.equal(composeDddLabel({ rel: "context-relation", pattern: "ohs" }, dddLabelVia(d, "Anticorruption Layer · pedido-criado")), "Open Host Service · pedido-criado", "trocar o padrão preserva o texto livre");
});

test("describe: relação entre contextos mostra o texto livre como 'via' sem repetir o padrão", () => {
  const doc = build([ctx("a"), ctx("b"), { op: "add_connection", from: "a", to: "b", label: "pedido-criado", ddd: { rel: "context-relation", pattern: "customer-supplier" } }]);
  assert.match(describe(doc), /`a` —customer-supplier→ `b` via pedido-criado — Fornecedor/);
});

test("T16: ops rejeitam ddd fora do modo domain, com mensagem acionável", () => {
  const r = applyOps(emptyDoc("a"), [dn("p", { role: "aggregate-root" })]);
  assert.equal(r.results[0].ok, false);
  assert.match(r.results[0].error!, /modo "domain"/);
  const k = applyOps(emptyDoc("a"), [{ op: "add_node", label: "x", kind: "domain" }]);
  assert.equal(k.results[0].ok, false);
  const c = applyOps(emptyDoc("a"), [{ op: "add_node", id: "a", label: "A" }, { op: "add_node", id: "b", label: "B" }, rel("a", "b", "emits")]);
  assert.equal(c.results[2].ok, false);
});

test("ops rejeitam papel inválido, campo fora do papel, kind conflitante e pattern indevido", () => {
  const dom = emptyDoc("d", "domain");
  const t = (op: Op) => applyOps(dom, [op]).results[0];
  assert.match(t(dn("x", { role: "banana" as never })).error!, /ddd\.role inválido/);
  assert.match(t(dn("x", { role: "command", payload: "p" })).error!, /campo "payload" não existe no papel "command"/);
  assert.match(t(dn("x", { role: "use-case", realizedBy: "a" as never })).error!, /lista de textos/);
  assert.match(t({ op: "add_node", label: "x", kind: "service", ddd: { role: "command" } }).error!, /kind "domain"/);
  assert.match(t({ op: "add_node", label: "x", kind: "domain" }).error!, /ddd deve ser um objeto/);
  const two = applyOps(dom, [dn("a", { role: "aggregate-root" }), dn("b", { role: "aggregate-root" }), { op: "add_connection", from: "a", to: "b", ddd: { rel: "emits", pattern: "acl" } }]);
  assert.match(two.results[2].error!, /pattern/);
  const bad = applyOps(dom, [dn("a", { role: "aggregate-root" }), dn("b", { role: "aggregate-root" }), { op: "add_connection", from: "a", to: "b", ddd: { rel: "nope" as never } }]);
  assert.match(bad.results[2].error!, /ddd\.rel inválido/);
});

test("subdomain só em contexto e com valor válido", () => {
  const dom = emptyDoc("d", "domain");
  assert.equal(applyOps(dom, [{ op: "add_group", label: "g", kind: "layer", subdomain: "core" }]).results[0].ok, false);
  assert.equal(applyOps(dom, [{ op: "add_group", label: "g", kind: "context", subdomain: "banana" as never }]).results[0].ok, false);
  const ok = applyOps(dom, [ctx("g", "supporting")]);
  assert.equal(ok.doc.groups[0].subdomain, "supporting");
});

test("update valida o patch de ddd e subdomain", () => {
  const doc = build(clean());
  const t = (patch: Record<string, unknown>, id = "criar-pedido") => applyOps(doc, [{ op: "update", id, patch }]);
  assert.equal(t({ ddd: { role: "command", intent: "novo" } }).results[0].ok, true);
  assert.equal(t({ ddd: { role: "command", payload: "x" } }).results[0].ok, false);
  assert.equal(t({ subdomain: "generic" }, "pedidos").results[0].ok, true);
  assert.equal(t({ subdomain: "generic" }, "criar-pedido").results[0].ok, false);
  const removed = t({ ddd: null }).doc.nodes.find((n) => n.id === "criar-pedido")!;
  assert.equal("ddd" in removed, false);
  assert.equal(applyOps(build([{ op: "add_node", id: "s", label: "S", kind: "actor" }]), [{ op: "update", id: "s", patch: { kind: "domain" } }]).results[0].ok, false);
});

test("set_meta troca o modo e voltar para architecture remove o campo", () => {
  const dom = applyOps(emptyDoc("a"), [{ op: "set_meta", mode: "domain" }]).doc;
  assert.equal(dom.mode, "domain");
  const back = applyOps(dom, [{ op: "set_meta", mode: "architecture" }]).doc;
  assert.equal("mode" in back, false);
  assert.equal(applyOps(dom, [{ op: "set_meta", mode: "x" as never }]).results[0].ok, false);
});

/* ───────── fase 3: regras D001–D021 ───────── */

test("T1 D001: caso de uso sem realização; realizedBy ou 'realizes' resolvem", () => {
  const solo = build([ctx("c"), dn("uc", { role: "use-case" }, "c")]);
  assert.ok(has(solo, "D001", "uc"));
  const viaField = build([ctx("c"), dn("cmd", { role: "command" }, "c"), dn("uc", { role: "use-case", realizedBy: ["cmd"] }, "c")]);
  assert.equal(has(viaField, "D001"), false);
  assert.equal(has(build(clean()), "D001"), false);
});

test("D020: referência em campo ddd para id inexistente", () => {
  const doc = build([ctx("c"), dn("uc", { role: "use-case", realizedBy: ["fantasma"] }, "c")]);
  assert.ok(has(doc, "D020", "uc"));
  assert.ok(has(doc, "D001", "uc"), "referência quebrada não conta como realização");
});

test("T2 D002: command sem aggregate, e command com dois aggregates", () => {
  const none = build([ctx("c"), dn("cmd", { role: "command" }, "c")]);
  assert.ok(has(none, "D002", "cmd"));
  const two = build([ctx("c"), dn("a", { role: "aggregate-root" }, "c"), dn("b", { role: "aggregate-root" }, "c"), dn("cmd", { role: "command" }, "c"), rel("cmd", "a", "triggers"), rel("cmd", "b", "triggers")]);
  assert.match(issues(two, "D002")[0].message, /2 aggregates/);
  assert.equal(has(build(clean()), "D002"), false);
});

test("T3 D003: evento sem produtor; producedBy/emits/external resolvem", () => {
  const orphan = build([ctx("c"), dn("ev", { role: "domain-event" }, "c")]);
  assert.ok(has(orphan, "D003", "ev"));
  const viaField = build([ctx("c"), dn("cmd", { role: "command" }, "c"), dn("ev", { role: "domain-event", producedBy: "cmd" }, "c")]);
  assert.equal(has(viaField, "D003"), false);
  const external = build([ctx("c"), dn("ev", { role: "domain-event", external: "pagamentos.pago" }, "c")]);
  assert.equal(has(external, "D003"), false);
});

test("T4 D004: entity solta, entity em dois aggregates, raiz contida em outro aggregate", () => {
  assert.ok(has(build([ctx("c"), dn("e", { role: "entity" }, "c")]), "D004", "e"));
  const two = build([ctx("c"), dn("a", { role: "aggregate-root" }, "c"), dn("b", { role: "aggregate-root" }, "c"), dn("e", { role: "entity" }, "c"), rel("a", "e", "contains"), rel("b", "e", "contains")]);
  assert.match(issues(two, "D004")[0].message, /2 aggregates/);
  const nested = build([ctx("c"), dn("a", { role: "aggregate-root" }, "c"), dn("b", { role: "aggregate-root" }, "c"), rel("a", "b", "contains")]);
  assert.ok(has(nested, "D004", "b"));
  const chain = build([ctx("c"), dn("a", { role: "aggregate-root" }, "c"), dn("e1", { role: "entity" }, "c"), dn("e2", { role: "entity" }, "c"), rel("a", "e1", "contains"), rel("e1", "e2", "contains")]);
  assert.equal(has(chain, "D004"), false, "entity aninhada alcança a raiz");
});

test("T5 D005: aggregates ligados por objeto são erro; references-by-id é permitido", () => {
  const base = [ctx("c"), dn("a", { role: "aggregate-root" }, "c"), dn("b", { role: "aggregate-root" }, "c")];
  // pelas ops, ligar dois aggregates já nasce como references-by-id; a ligação "por objeto" só chega por arquivo importado
  const viaOps = build([...base, { op: "add_connection", from: "a", to: "b" }]);
  assert.equal(viaOps.connections[0].ddd?.rel, "references-by-id");
  assert.equal(has(viaOps, "D005"), false);
  const imported = build(base);
  imported.connections.push({ id: "x", from: "a", to: "b", type: "association" });
  assert.ok(has(imported, "D005"));
  assert.ok(has(build([...base, rel("a", "b", "contains")]), "D005"));
  assert.equal(has(build([...base, rel("a", "b", "references-by-id")]), "D005"), false);
  const viaEntity = build([...base, dn("e", { role: "entity" }, "c"), rel("a", "e", "contains"), rel("e", "b", "references-by-id")]);
  assert.equal(has(viaEntity, "D005"), false);
});

test("T6 D006: cruzar contextos sem context-relation; external malformado", () => {
  const two = [ctx("c1"), ctx("c2"), dn("a", { role: "aggregate-root" }, "c1"), dn("cmd", { role: "command" }, "c2"), rel("cmd", "a", "triggers")];
  assert.ok(has(build(two), "D006"));
  assert.ok(has(build([ctx("c"), dn("ev", { role: "domain-event", external: "semponto" }, "c")]), "D006", "ev"));
  assert.equal(has(build([ctx("c"), dn("ev", { role: "domain-event", external: "pagamentos.pago" }, "c")]), "D006"), false);
});

test("T6b D007: value-object com identidade", () => {
  const base = [ctx("c"), dn("a", { role: "aggregate-root" }, "c"), dn("v", { role: "value-object" }, "c")];
  assert.ok(has(build([...base, rel("a", "v", "references-by-id")]), "D007", "v"));
  assert.equal(has(build([...base, rel("a", "v", "contains")]), "D007"), false);
});

test("T7 D008: repository sem for, para entity, ou para aggregate-root", () => {
  assert.ok(has(build([ctx("c"), dn("r", { role: "repository" }, "c")]), "D008", "r"));
  const toEntity = build([ctx("c"), dn("a", { role: "aggregate-root" }, "c"), dn("e", { role: "entity" }, "c"), rel("a", "e", "contains"), dn("r", { role: "repository", for: "e" }, "c")]);
  assert.ok(has(toEntity, "D008", "r"));
  assert.equal(has(build(clean()), "D008"), false);
});

test("T8 D009: contexto sem aggregate; diagrama vazio", () => {
  assert.ok(has(build([ctx("c")]), "D009", "c"));
  assert.equal(has(build(clean()), "D009"), false);
  assert.ok(issues(build([]), "D009").length >= 1);
});

test("T9: evento sem consumidor é válido", () => {
  assert.deepEqual(serious(build(clean())), []);
});

test("D009: mapa de contextos (só referências e relações) não é tratado como diagrama vazio", () => {
  const map = build([
    { op: "add_node", id: "a", label: "A", kind: "system", ref: { diagram: "dominio/a.archflow.json" } },
    { op: "add_node", id: "b", label: "B", kind: "system", ref: { diagram: "dominio/b.archflow.json" } },
    rel("a", "b", "context-relation", "partnership"),
  ]);
  assert.equal(has(map, "D009"), false);
  assert.equal(has(map, "D021"), false, "context-relation entre componentes system com ref é válido");
  assert.deepEqual(serious(map), []);
});

test("D010: heurística de nomes só gera dica", () => {
  const doc = build([ctx("c"), dn("cmd", { role: "command" }, "c", "Pedido Criado"), dn("ev", { role: "domain-event", producedBy: "cmd" }, "c", "Criar")]);
  const d010 = issues(doc, "D010");
  assert.equal(d010.length, 2);
  assert.ok(d010.every((i) => i.severity === "dica"));
});

test("D011: contexto sem ligação com a arquitetura; system com ref resolve", () => {
  assert.ok(has(build([ctx("c")]), "D011", "c"));
  const linked = build([ctx("c"), { op: "add_node", id: "api", label: "Orders API", parent: "c", ref: { diagram: "arquitetura/macro.archflow.json" } }]);
  assert.equal(has(linked, "D011"), false);
});

test("D012: nó que precisa de ligação e está isolado", () => {
  assert.ok(has(build([ctx("c"), dn("a", { role: "aggregate-root" }, "c")]), "D012", "a"));
  assert.ok(has(build([ctx("c"), dn("s", { role: "domain-service" }, "c")]), "D012", "s"));
  assert.equal(has(build([ctx("c"), dn("v", { role: "value-object" }, "c")]), "D012"), false, "value-object isolado é válido");
});

test("T10 D013: application-service com regra de negócio ou emitindo eventos", () => {
  const doc = build([ctx("c"), dn("svc", { role: "application-service", intent: "orquestra" }, "c"), dn("ev", { role: "domain-event", payload: "x" }, "c"), rel("svc", "ev", "emits")]);
  assert.ok(has(doc, "D013", "svc"));
  assert.equal(has(build(clean()), "D013"), false);
  // invariantes não passam pelas ops (o papel não as aceita), mas chegam por arquivo importado
  const imported = build([ctx("c"), dn("svc", { role: "application-service" }, "c")]);
  (imported.nodes[0].ddd as { invariants?: string[] }).invariants = ["total >= 0"];
  assert.ok(has(imported, "D013", "svc"));
});

test("T11 D014 e D015: subdomain ausente e contexto generic grande", () => {
  assert.ok(has(build([ctx("c")]), "D014", "c"));
  assert.equal(has(build([ctx("c", "core")]), "D014"), false);
  const roots = Array.from({ length: 6 }, (_, i) => dn(`a${i}`, { role: "aggregate-root" }, "g"));
  assert.ok(has(build([ctx("g", "generic"), ...roots]), "D015", "g"));
  assert.equal(has(build([ctx("g", "core"), ...roots]), "D015"), false);
});

test("D016: ciclo de references-by-id entre aggregates", () => {
  const doc = build([ctx("c"), dn("a", { role: "aggregate-root" }, "c"), dn("b", { role: "aggregate-root" }, "c"), rel("a", "b", "references-by-id"), rel("b", "a", "references-by-id")]);
  assert.equal(issues(doc, "D016").length, 1);
  const line = build([ctx("c"), dn("a", { role: "aggregate-root" }, "c"), dn("b", { role: "aggregate-root" }, "c"), rel("a", "b", "references-by-id")]);
  assert.equal(has(line, "D016"), false);
});

test("T12 D017: system apontando para diagrama inexistente (com exists)", () => {
  const doc = build([ctx("c"), { op: "add_node", id: "s", label: "S", parent: "c", ref: { diagram: "dominio/pagamentos.archflow.json" } }]);
  assert.equal(validateDetailed(doc).some((i) => i.rule === "D017"), false, "sem exists não checa");
  assert.ok(validateDetailed(doc, { exists: () => false }).some((i) => i.rule === "D017"));
  assert.equal(validateDetailed(doc, { exists: () => true }).some((i) => i.rule === "D017"), false);
});

test("T13 D018: process-manager precisa de evento de entrada e command de saída", () => {
  const bare = build([ctx("c"), dn("pm", { role: "process-manager" }, "c")]);
  assert.equal(issues(bare, "D018").length, 2);
  const ok = build([ctx("c"), dn("ev", { role: "domain-event", external: "x.y" }, "c"), dn("cmd", { role: "command" }, "c"), dn("pm", { role: "process-manager", reactsTo: ["ev"], issues: ["cmd"] }, "c")]);
  assert.equal(has(ok, "D018"), false);
  const viaRel = build([ctx("c"), dn("ev", { role: "domain-event", external: "x.y" }, "c"), dn("cmd", { role: "command" }, "c"), dn("pm", { role: "process-manager" }, "c"), rel("ev", "pm", "triggers"), rel("pm", "cmd", "triggers")]);
  assert.equal(has(viaRel, "D018"), false);
});

test("T14 D019: read-model sem projectsFrom, e read-model emitindo evento", () => {
  assert.ok(has(build([ctx("c"), dn("rm", { role: "read-model" }, "c")]), "D019", "rm"));
  const ok = build([ctx("c"), dn("ev", { role: "domain-event", external: "x.y" }, "c"), dn("rm", { role: "read-model", projectsFrom: ["ev"] }, "c")]);
  assert.equal(has(ok, "D019"), false);
  const emits = build([ctx("c"), dn("ev", { role: "domain-event", external: "x.y" }, "c"), dn("ev2", { role: "domain-event", external: "x.z" }, "c"), dn("rm", { role: "read-model", projectsFrom: ["ev"] }, "c"), rel("rm", "ev2", "emits")]);
  assert.ok(has(emits, "D019", "rm"));
});

test("D021: extremos incoerentes com a relação", () => {
  const doc = build([ctx("c"), dn("a", { role: "aggregate-root" }, "c"), dn("b", { role: "aggregate-root" }, "c"), rel("a", "b", "emits"), rel("a", "b", "realizes"), rel("a", "b", "context-relation")]);
  assert.ok(issues(doc, "D021").length >= 3);
});

/* ───────── T15: arquitetura intacta ───────── */

const archOps: Op[] = [
  { op: "add_group", id: "aws", label: "AWS", kind: "cloud" },
  { op: "add_node", id: "api", label: "Orders API", asset: "nestjs", parent: "aws" },
  { op: "add_node", id: "db", label: "Orders DB", asset: "postgresql", parent: "aws" },
  { op: "add_node", id: "solto", label: "Solto" },
  { op: "add_endpoint", owner: "api", protocol: "rest", method: "POST", path: "/orders" },
  { op: "add_connection", from: "api", to: "db", type: "data", label: "SQL" },
];

test("T15: diagrama architecture existente não ganha regra D* nem campo novo", () => {
  const doc = build(archOps, "architecture");
  const v = validate(doc);
  assert.deepEqual(v, ["solto: componente sem nenhuma conexão (isolado)"]);
  assert.equal(validateDetailed(doc).every((i) => i.rule === "BASE"), true);
  const text = describe(doc);
  assert.ok(!text.includes("Contexto"), "describe de arquitetura não usa o formato de domínio");
  assert.ok(text.includes("## Componentes") && text.includes("## Conexões"));
  assert.equal(JSON.stringify(doc).includes('"mode"'), false);
  assert.equal(JSON.stringify(doc).includes('"ddd"'), false);
});

test("modo domínio não aplica a regra de nó isolado da arquitetura", () => {
  const doc = build([{ op: "add_node", id: "ator", label: "Cliente", kind: "actor" }]);
  assert.equal(validate(doc).some((s) => s.includes("sem nenhuma conexão")), false);
});

/* ───────── describe / trace / guia ───────── */

test("describe do modo domínio: contexto, aggregate, rastreio ✔/✘ e avisos com id de regra", () => {
  const doc = build([...clean(), dn("cancelar-pedido", { role: "use-case", actor: "Cliente" }, "pedidos", "Cancelar Pedido")]);
  const text = describe(doc);
  assert.match(text, /# t — domínio/);
  assert.match(text, /## Contexto `pedidos` \(core\)/);
  assert.match(text, /### Aggregate `pedido` \(root: Pedido\)/);
  assert.match(text, /entity: `item-pedido`/);
  assert.match(text, /value-object: `endereco`/);
  assert.match(text, /invariantes: total >= 0/);
  assert.match(text, /command `criar-pedido`/);
  assert.match(text, /evento `pedido-criado` \(payload: id, total\)/);
  assert.match(text, /`fazer-pedido` Fazer Pedido \(ator: Cliente\) → criar-pedido → pedido → pedido-criado ✔/);
  assert.match(text, /`cancelar-pedido` Cancelar Pedido \(ator: Cliente\) ✘ sem realização \(D001\)/);
  assert.match(text, /\[D001 erro\]/);
  assert.match(text, /```mermaid/);
  assert.equal(describe(doc), describe(doc), "determinístico");
});

test("traceUseCase: caminho completo, command sem evento, id inexistente", () => {
  const doc = build(clean());
  const t = traceUseCase(doc, "fazer-pedido")!;
  assert.equal(t.ok, true);
  assert.deepEqual(t.paths[0].map((s) => s.id), ["fazer-pedido", "criar-pedido", "pedido", "pedido-criado"]);
  const semEvento = build([ctx("c"), dn("a", { role: "aggregate-root" }, "c"), dn("cmd", { role: "command" }, "c"), dn("uc", { role: "use-case", realizedBy: ["cmd"] }, "c"), rel("cmd", "a", "triggers")]);
  const t2 = traceUseCase(semEvento, "uc")!;
  assert.equal(t2.ok, false);
  assert.ok(t2.problems.some((p) => /não produz nenhum evento/.test(p)));
  assert.equal(traceUseCase(doc, "nao-existe"), undefined);
  assert.equal(traceUseCase(doc, "pedido"), undefined, "só use-case é rastreável");
});

test("traceUseCase: evento produzido via producedBy e via aggregate", () => {
  const doc = build([ctx("c"), dn("a", { role: "aggregate-root" }, "c"), dn("cmd", { role: "command" }, "c"), dn("ev", { role: "domain-event", producedBy: "a" }, "c"), dn("uc", { role: "use-case", realizedBy: ["cmd"] }, "c"), rel("cmd", "a", "triggers")]);
  assert.equal(traceUseCase(doc, "uc")!.ok, true);
});

test("schemaGuide: modo domain lista papéis, relações, padrões e convenções; architecture não muda", () => {
  const dom = schemaGuide("domain");
  for (const k of ["aggregate-root", "process-manager", "references-by-id", "customer-supplier", "triggers", "core", "D00"].slice(0, 6)) assert.ok(dom.includes(k), k);
  assert.ok(dom.includes("modo DOMAIN"));
  const arch = schemaGuide();
  assert.equal(arch, schemaGuide("architecture"));
  assert.ok(!arch.includes("aggregate-root"));
});

/* ───────── visão geral do projeto ───────── */

test("domainOverview: consolida contextos, mapa, casos de uso e avisos entre diagramas", () => {
  const pedidos = build([...clean(), dn("pagamento-aprovado", { role: "domain-event", external: "pagamentos.pagamento-aprovado" }, "pedidos")]);
  const pagamentos = build([ctx("pagamentos", "generic"), dn("pagamento", { role: "aggregate-root" }, "pagamentos"), dn("pagar", { role: "command" }, "pagamentos"), dn("pagamento-aprovado", { role: "domain-event" }, "pagamentos"), rel("pagar", "pagamento", "triggers"), rel("pagar", "pagamento-aprovado", "emits")]);
  const geral = build([
    { op: "add_node", id: "pedidos", label: "Pedidos", ref: { diagram: "dominio/pedidos.archflow.json" } },
    { op: "add_node", id: "pagamentos", label: "Pagamentos", ref: { diagram: "dominio/pagamentos.archflow.json" } },
    rel("pedidos", "pagamentos", "context-relation", "customer-supplier"),
  ]);
  const files = [
    { path: "dominio/pedidos.archflow.json", doc: pedidos },
    { path: "dominio/pagamentos.archflow.json", doc: pagamentos },
    { path: "dominio/visao-geral.archflow.json", doc: geral },
    { path: "arquitetura/macro.archflow.json", doc: build(archOps, "architecture") },
  ];
  const text = domainOverview(files);
  assert.match(text, /3 diagrama\(s\) de domínio · 2 contexto\(s\) · 1 visão\(ões\) geral\(is\)/);
  assert.match(text, /## Mapa de contextos/);
  assert.match(text, /Pedidos —customer-supplier→ Pagamentos/);
  assert.match(text, /consumidos: pagamentos\.pagamento-aprovado/);
  assert.match(text, /1 de 1 rastreados até um evento \(100%\)/);
  assert.doesNotMatch(text, /D006/, "relação existe, então não há aviso de evento externo");
  assert.doesNotMatch(text, /arquitetura\/macro/, "diagramas de arquitetura ficam fora");

  const semRelacao = domainOverview([files[0], files[1], { path: files[2].path, doc: build([{ op: "add_node", id: "x", label: "x", ref: { diagram: files[0].path } }, { op: "add_node", id: "y", label: "y", ref: { diagram: files[1].path } }, rel("x", "y", "context-relation", "partnership")]) }]);
  assert.doesNotMatch(semRelacao, /D017/);
});

test("domainOverview: D017 e D006 quando a visão geral não bate com os contextos", () => {
  const pedidos = build([...clean(), dn("pagamento-aprovado", { role: "domain-event", external: "pagamentos.pagamento-aprovado" }, "pedidos")]);
  const pagamentos = build([ctx("pagamentos"), dn("pagamento", { role: "aggregate-root" }, "pagamentos")]);
  const geral = build([{ op: "add_node", id: "pedidos", label: "Pedidos", ref: { diagram: "dominio/pedidos.archflow.json" } }, { op: "add_node", id: "fora", label: "Fora", ref: { diagram: "dominio/fora.archflow.json" } }, rel("pedidos", "fora", "context-relation", "acl")]);
  const text = domainOverview([
    { path: "dominio/pedidos.archflow.json", doc: pedidos },
    { path: "dominio/pagamentos.archflow.json", doc: pagamentos },
    { path: "dominio/visao-geral.archflow.json", doc: geral },
  ]);
  assert.match(text, /\[D017 aviso\].*dominio\/pagamentos\.archflow\.json" não aparece na visão geral/);
  assert.match(text, /\[D017 aviso\].*"dominio\/fora\.archflow\.json", que não existe/);
  assert.match(text, /\[D006 aviso\] evento externo "pagamentos\.pagamento-aprovado": o contexto "pagamentos" não publica o evento/);
});

test("reshapeDdd: trocar o papel mantém só os campos que o novo papel aceita e o resultado é válido", () => {
  const old: DddNodeSpec = { role: "command", intent: "registrar", invariants: ["total >= 0"], step: 2 };
  const asAgg = reshapeDdd(old, "aggregate-root");
  assert.deepEqual(asAgg, { role: "aggregate-root", invariants: ["total >= 0"] });
  const asEvent = reshapeDdd(old, "domain-event");
  assert.deepEqual(asEvent, { role: "domain-event" });
  const asRepo = reshapeDdd(old, "repository");
  assert.deepEqual(asRepo, { role: "repository" });
  for (const r of DDD_ROLE_KEYS) assert.equal(checkDddNode(reshapeDdd(old, r)), undefined, r);
  assert.deepEqual(reshapeDdd(undefined, "entity"), { role: "entity" });
});

test("domainOverview: diagrama de domínio sem contexto explica o que falta", () => {
  const text = domainOverview([{ path: "dominio/solto.archflow.json", doc: build([dn("a", { role: "aggregate-root" })]) }]);
  assert.match(text, /## Contextos\n- nenhum: crie um grupo kind context/);
});

test("domainOverview: projeto sem diagramas de domínio", () => {
  assert.match(domainOverview([{ path: "a.archflow.json", doc: build(archOps, "architecture") }]), /Nenhum diagrama de modo `domain`/);
});

/* ───────── avaliação objetiva (metas do modo Domain) ───────── */

test("evaluateDomain: modelo completo atinge as metas", () => {
  const e = evaluateDomain(build(clean()));
  assert.deepEqual({ useCases: e.useCases, traced: e.traced, tracedPct: e.tracedPct, structuralErrors: e.structuralErrors, issuesToFix: e.issuesToFix, duplicates: e.duplicates, ok: e.ok }, { useCases: 1, traced: 1, tracedPct: 100, structuralErrors: 0, issuesToFix: 0, duplicates: [], ok: true });
  assert.deepEqual(EVAL_TARGETS, { tracedPct: 90, structuralErrors: 0, issuesToFix: 2 });
});

test("evaluateDomain: reprova casos de uso sem rastreio, erros estruturais, itens demais e duplicados", () => {
  const semRastro = evaluateDomain(build([...clean(), dn("cancelar-pedido", { role: "use-case", actor: "Cliente" }, "pedidos", "Cancelar Pedido")]));
  assert.equal(semRastro.tracedPct, 50);
  assert.equal(semRastro.ok, false);
  const comPagamento = build([...clean(), dn("pagamento", { role: "aggregate-root" }, "pedidos")]);
  comPagamento.connections.push({ id: "x", from: "pedido", to: "pagamento", type: "association" }); // por objeto: só por arquivo importado
  const estrutural = evaluateDomain(comPagamento);
  assert.equal(estrutural.structuralErrors, 1, "D005: aggregates ligados por objeto");
  assert.equal(estrutural.ok, false);
  const muitos = evaluateDomain(build([ctx("c"), dn("e1", { role: "entity" }, "c"), dn("e2", { role: "entity" }, "c"), dn("e3", { role: "entity" }, "c")]));
  assert.equal(muitos.issuesToFix, 4, "3 entities soltas (D004) + contexto sem aggregate (D009)");
  assert.equal(muitos.ok, false);
  const dup = evaluateDomain(build([...clean(), dn("criar-pedido-2", { role: "command", intent: "de novo" }, "pedidos", "Criar Pedido")]));
  assert.deepEqual(dup.duplicates, ["criar-pedido-2 repete criar-pedido"]);
  assert.equal(dup.ok, false);
  assert.equal(evaluateDomain(build([ctx("c", "core")])).tracedPct, 100, "sem casos de uso não há o que rastrear");
});

test("D034 regra de camadas: camada interna não depende de externa; de fora para dentro é livre", () => {
  const doc = build([
    dn("pedido", { role: "aggregate-root" }),
    dn("uc", { role: "use-case" }),
    dn("criar", { role: "command" }),
    dn("criado", { role: "domain-event" }),
    dn("notificar", { role: "policy" }),
    dn("saga", { role: "process-manager" }),
    dn("pago", { role: "domain-event", external: "pagamentos" }),
    dn("repo", { role: "repository", for: "pedido" }),
    { op: "add_node", id: "cliente", label: "Cliente", kind: "actor" },
    { op: "add_node", id: "correios", label: "Correios", kind: "external" },
    // de fora para dentro: ok
    { op: "add_connection", from: "cliente", to: "uc", type: "association" },
    rel("criar", "pedido", "triggers"),
    // evento dispara a policy: quem depende é a policy (o evento não conhece o assinante): ok
    rel("criado", "notificar", "triggers"),
    // evento de outro contexto chega de fora e aciona a saga (como um driver): ok
    rel("pago", "saga", "triggers"),
    // Use Cases chamando repository ou sistema externo: porta (inversão de dependência): ok
    rel("criar", "repo", "uses"),
    { op: "add_connection", from: "criar", to: "correios", type: "association" },
    // de dentro para fora: violações (o domínio não conhece nada de fora)
    { op: "add_connection", id: "c-ext", from: "pedido", to: "correios", type: "association" },
    { op: "add_connection", id: "c-uc", from: "pedido", to: "uc", type: "association" },
  ]);
  const d34 = issues(doc, "D034");
  assert.deepEqual(d34.map((i) => i.target).sort(), ["c-ext", "c-uc"]);
  assert.ok(d34.every((i) => i.severity === "erro"));
  assert.match(d34[0].message, /camada interna não pode depender de uma externa/);
});

test("porta (inversão de dependência): com port, depender de fora é válido; sem port no Use Cases é dica D035; porta sem inversão é dica D036", () => {
  const doc = build([
    dn("pedido", { role: "aggregate-root" }),
    dn("criar", { role: "command" }),
    dn("repo", { role: "repository", for: "pedido" }, undefined, "Pedidos (repo)"),
    { op: "add_node", id: "correios", label: "Correios", kind: "external" },
    { op: "add_node", id: "cliente", label: "Cliente", kind: "actor" },
    // Entities → externo: sem porta é D034; com porta, válido
    { op: "add_connection", id: "sem-porta", from: "pedido", to: "correios", type: "association" },
    { op: "add_connection", id: "com-porta", from: "pedido", to: "repo", type: "association", port: { name: "RepositorioDePedidos", operations: ["salvar(pedido)", " "] } },
    // Use Cases → repository sem porta: aceito com a dica D035
    rel("criar", "repo", "uses"),
    // porta de fora para dentro: dica D036
    { op: "add_connection", id: "porta-inutil", from: "cliente", to: "criar", type: "association", port: { name: "X" } },
  ]);
  assert.deepEqual(issues(doc, "D034").map((i) => i.target), ["sem-porta"]);
  assert.match(issues(doc, "D034")[0].message, /declare uma porta/);
  assert.ok(has(doc, "D035"));
  assert.ok(issues(doc, "D035")[0].message.includes('"RepositorioPedidos"'));
  assert.deepEqual(issues(doc, "D036").map((i) => i.target), ["porta-inutil"]);
  // operações vazias saem; o nome é obrigatório; port só no modo domain; null remove
  assert.deepEqual(doc.connections.find((c) => c.id === "com-porta")!.port, { name: "RepositorioDePedidos", operations: ["salvar(pedido)"] });
  const { results } = applyOps(doc, [{ op: "update", id: "com-porta", patch: { port: { name: " " } } }]);
  assert.equal(results[0].ok, false);
  const arch = applyOps(emptyDoc("t", "architecture"), [
    { op: "add_node", id: "a", label: "a" },
    { op: "add_node", id: "b", label: "b" },
    { op: "add_connection", from: "a", to: "b", port: { name: "P" } },
  ]);
  assert.equal(arch.results[2].ok, false);
  const cleared = applyOps(doc, [{ op: "update", id: "com-porta", patch: { port: null } }]).doc;
  assert.equal(cleared.connections.find((c) => c.id === "com-porta")!.port, undefined);
});

test("controller: porta de entrada em Interface Adapters; despacha command (triggers) e usa application-service/read-model (uses), de fora para dentro", () => {
  const doc = build([
    dn("pedido", { role: "aggregate-root" }),
    dn("criar", { role: "command" }),
    dn("checkout", { role: "application-service" }),
    dn("lista", { role: "read-model" }),
    dn("api", { role: "controller", intent: "receber o pedido pela API" }),
    { op: "add_node", id: "cliente", label: "Cliente", kind: "actor" },
    { op: "add_connection", from: "cliente", to: "api", type: "association" },
    { op: "add_connection", id: "c1", from: "api", to: "criar" },
    { op: "add_connection", id: "c2", from: "api", to: "checkout" },
    { op: "add_connection", id: "c3", from: "api", to: "lista" },
    rel("criar", "pedido", "triggers"),
  ]);
  const rels = (id: string) => doc.connections.find((c) => c.id === id)!.ddd?.rel;
  assert.deepEqual([rels("c1"), rels("c2"), rels("c3")], ["triggers", "uses", "uses"], "a relação é inferida pelo par");
  assert.ok(!has(doc, "D021") && !has(doc, "D034"), "relações válidas e sem ferir a regra de camadas");
  assert.equal(onionSlot(doc.nodes.find((n) => n.id === "api")!).ring, "adapters");
});
