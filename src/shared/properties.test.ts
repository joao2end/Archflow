import assert from "node:assert/strict";
import { test } from "node:test";
import { generateCode } from "./codegen";
import { checkDddNode } from "./domain";
import { applyOps, describe, type Op } from "./ops";
import { checkProperties, cleanProperties, mergeProperties, parseProperties, propertiesSummary, propertiesToLines } from "./properties";
import { emptyDoc } from "./schema";
import { buildStories } from "./story";

const ok = (s: string) => {
  const r = parseProperties(s);
  assert.ok(r.ok, r.ok ? "" : r.error);
  return r.ok ? r : (undefined as never);
};

test("parseProperties: texto, uma por linha, com tipo, opcional, identificador e descrição", () => {
  const r = ok("#id: uuid — identificador\ntotal: dinheiro — soma dos itens\nobservacao?: texto\n// comentário\n- cep");
  assert.deepEqual(r.properties, [
    { name: "id", type: "uuid", key: true, description: "identificador" },
    { name: "total", type: "dinheiro", description: "soma dos itens" },
    { name: "observacao", type: "texto", optional: true },
    { name: "cep" },
  ]);
});

test("parseProperties: lista separada por vírgula", () => {
  assert.deepEqual(ok("pedidoId, total, criadoEm").properties.map((p) => p.name), ["pedidoId", "total", "criadoEm"]);
});

test("parseProperties: lista JSON, mapa, exemplo e JSON Schema", () => {
  assert.deepEqual(ok('[{"name":"id","type":"uuid","key":true},"total: dinheiro"]').properties, [{ name: "id", type: "uuid", key: true }, { name: "total", type: "dinheiro" }]);
  assert.deepEqual(ok('{"id":"uuid","total":{"type":"dinheiro","description":"soma"}}').properties, [{ name: "id", type: "uuid" }, { name: "total", type: "dinheiro", description: "soma" }]);
  assert.deepEqual(ok('{"id":"a1","qtd":3,"preco":9.9,"pago":true,"itens":[1,2]}').properties.map((p) => `${p.name}:${p.type}`), ["id:texto", "qtd:inteiro", "preco:número", "pago:booleano", "itens:number[]"]);
  const schema = ok('{"type":"object","required":["id"],"properties":{"id":{"type":"string","format":"uuid","description":"chave"},"nota":{"type":"string"},"tags":{"type":"array","items":{"type":"string"}}}}');
  assert.equal(schema.format, "JSON Schema");
  assert.deepEqual(schema.properties, [
    { name: "id", type: "string (uuid)", description: "chave" },
    { name: "nota", type: "string", optional: true },
    { name: "tags", type: "string[]", optional: true },
  ]);
});

test("parseProperties: erros claros", () => {
  const bad = parseProperties("{ nao é json");
  assert.ok(!bad.ok && /JSON inválido/.test(bad.error));
  const none = parseProperties("[]");
  assert.ok(!none.ok);
});

test("round-trip: propertiesToLines → parseProperties", () => {
  const list = [{ name: "id", type: "uuid", key: true, description: "chave" }, { name: "nota", type: "texto", optional: true }];
  assert.deepEqual(ok(propertiesToLines(list)).properties, list);
});

test("cleanProperties e mergeProperties: sem duplicados, o novo atualiza o de mesmo nome", () => {
  assert.deepEqual(cleanProperties([{ name: " a ", type: " " }, { name: "A" }, { name: "" }]), [{ name: "a" }]);
  assert.deepEqual(mergeProperties([{ name: "a", type: "texto" }, { name: "b" }], [{ name: "A", type: "inteiro" }, { name: "c" }]), [{ name: "a", type: "inteiro" }, { name: "b" }, { name: "c" }]);
  assert.equal(propertiesSummary([{ name: "id", type: "uuid", key: true }, { name: "n", optional: true }]), "id: uuid #, n?");
});

test("checkProperties / checkDddNode: rejeita estrutura inválida com mensagem acionável", () => {
  assert.match(checkProperties("x")!, /lista/);
  assert.match(checkProperties([{ type: "x" }])!, /name/);
  assert.match(checkProperties([{ name: "a" }, { name: "A" }])!, /mais de uma vez/);
  assert.match(checkProperties([{ name: "a", foo: 1 }])!, /não tem o campo "foo"/);
  assert.equal(checkProperties([{ name: "a", type: "texto", optional: true }]), undefined);
  assert.match(checkDddNode({ role: "entity", properties: "x" })!, /lista/);
  assert.match(checkDddNode({ role: "policy", properties: [] })!, /não existe no papel "policy"/);
});

const ops: Op[] = [
  { op: "add_group", id: "c", label: "C", kind: "context", subdomain: "core" },
  { op: "add_node", id: "cmd", label: "Criar", parent: "c", ddd: { role: "command", step: 1, properties: [{ name: "itens", type: "Item[]" }, { name: "obs", type: "texto", optional: true }] } },
  { op: "add_node", id: "ped", label: "Pedido", parent: "c", ddd: { role: "aggregate-root", properties: [{ name: "id", type: "uuid", key: true }, { name: "total", type: "Dinheiro", description: "soma dos itens" }, { name: "criado", type: "data" }] } },
  { op: "add_node", id: "item", label: "Item", parent: "c", ddd: { role: "entity", properties: [{ name: "sku", type: "texto", key: true }, { name: "qtd", type: "inteiro" }, { name: "nota", type: "texto", optional: true }] } },
  { op: "add_node", id: "din", label: "Dinheiro", parent: "c", ddd: { role: "value-object", properties: [{ name: "valor", type: "inteiro" }, { name: "moeda", type: "texto" }] } },
  { op: "add_node", id: "evt", label: "Criado", parent: "c", ddd: { role: "domain-event", properties: [{ name: "pedidoId", type: "uuid" }, { name: "x", type: "algo estranho" }] } },
  { op: "add_connection", from: "cmd", to: "ped", ddd: { rel: "triggers" } },
  { op: "add_connection", from: "ped", to: "evt", ddd: { rel: "emits" } },
  { op: "add_connection", from: "ped", to: "item", ddd: { rel: "contains" } },
  { op: "add_connection", from: "ped", to: "din", ddd: { rel: "contains" } },
];
const build = () => {
  const r = applyOps(emptyDoc("t", "domain"), ops);
  assert.deepEqual(r.results.filter((x) => !x.ok), []);
  return r.doc;
};

test("ops: o nó aceita properties e rejeita em papel que não tem", () => {
  const bad = applyOps(emptyDoc("t", "domain"), [{ op: "add_node", id: "p", label: "P", ddd: { role: "policy", properties: [{ name: "a" }] } } as Op]);
  assert.ok(!bad.results[0].ok);
});

test("describe e história mostram as propriedades", () => {
  const doc = build();
  const text = describe(doc);
  assert.match(text, /propriedades de `ped`: id: uuid #, total: Dinheiro, criado: data/);
  assert.match(text, /parâmetros: itens: Item\[\], obs\?: texto/);
  const all = buildStories(doc).find((s) => s.id === "__all")!;
  assert.deepEqual(all.steps.find((s) => s.id === "item")!.properties.map((p) => p.name), ["sku", "qtd", "nota"]);
});

test("código gerado usa as propriedades: tipos, opcionais, identificador e referência a outro elemento", () => {
  const files = generateCode(build(), "typescript");
  const f = (end: string) => files.find((x) => x.path.endsWith(end))!.content;
  const agg = f("domain/ped.ts");
  assert.match(agg, /total!: Din;/);
  assert.match(agg, /\/\*\* soma dos itens \*\/\n\s+total!: Din;/);
  assert.match(agg, /criado!: Date;/);
  assert.match(agg, /export class Item \{\s+constructor\(\s+readonly sku: string,\s+readonly qtd: number,\s+readonly nota\?: string,/);
  assert.match(agg, /export class Din \{\s+constructor\(\s+readonly valor: number,\s+readonly moeda: string,/);
  assert.match(agg, /JSON\.stringify\(this\.valor\) === JSON\.stringify\(other\.valor\) && JSON\.stringify\(this\.moeda\)/);
  assert.match(f("domain/events.ts"), /readonly pedidoId: string;/);
  assert.match(f("domain/events.ts"), /readonly x: unknown;/);
  assert.match(f("domain/events.ts"), /tipo no modelo: algo estranho/);
  assert.match(f("application/commands.ts"), /readonly itens: unknown\[\];|readonly itens: Item\[\];/);
  assert.match(f("application/commands.ts"), /readonly obs\?: string;/);
});
