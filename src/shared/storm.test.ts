import assert from "node:assert/strict";
import { test } from "node:test";
import { applyOps, type Op } from "./ops";
import { emptyDoc, type DddNodeSpec, type DddRel, type Doc, type NodeEl } from "./schema";
import { STORM_COL_W, STORM_LANE_H } from "./storm";

const ctx = (id: string): Op => ({ op: "add_group", id, label: id, kind: "context", subdomain: "core" });
const dn = (id: string, ddd: DddNodeSpec, parent?: string): Op => ({ op: "add_node", id, label: id, ddd, ...(parent ? { parent } : {}) });
const rel = (from: string, to: string, r: DddRel): Op => ({ op: "add_connection", from, to, ddd: { rel: r } });

/** Dois commands, declarados fora de ordem em relação a `step`, mais todo o resto do vocabulário. */
const pedidos = (): Op[] => [
  ctx("pedidos"),
  dn("criar-pedido", { role: "command", step: 2 }, "pedidos"),
  dn("pagar-pedido", { role: "command", step: 1 }, "pedidos"),
  dn("pedido", { role: "aggregate-root" }, "pedidos"),
  dn("item-pedido", { role: "entity" }, "pedidos"),
  dn("endereco", { role: "value-object" }, "pedidos"),
  dn("pedido-repo", { role: "repository", for: "pedido" }, "pedidos"),
  dn("pedido-criado", { role: "domain-event" }, "pedidos"),
  dn("pedido-pago", { role: "domain-event" }, "pedidos"),
  dn("enviar-email", { role: "policy", reactsTo: ["pedido-criado"], issues: [] }, "pedidos"),
  dn("pedidos-abertos", { role: "read-model", projectsFrom: ["pedido-criado"] }, "pedidos"),
  dn("fazer-pedido", { role: "use-case", actor: "Cliente", goal: "comprar", realizedBy: ["criar-pedido"] }, "pedidos"),
  { op: "add_node", id: "cliente", label: "Cliente", kind: "actor", parent: "pedidos" },
  rel("criar-pedido", "pedido", "triggers"),
  rel("pagar-pedido", "pedido", "triggers"),
  rel("criar-pedido", "pedido-criado", "emits"),
  rel("pagar-pedido", "pedido-pago", "emits"),
  rel("pedido", "item-pedido", "contains"),
  rel("pedido", "endereco", "contains"),
  { op: "add_connection", from: "cliente", to: "fazer-pedido", type: "association", label: "executa" },
];

const laid = (ops: Op[], routing?: "straight" | "curve" | "elbow"): Doc => {
  const base = applyOps(emptyDoc("t", "domain"), ops);
  assert.deepEqual(base.results.filter((r) => !r.ok), []);
  const r = applyOps(base.doc, [{ op: "layout", style: "timeline", ...(routing ? { routing } : {}) }]);
  assert.deepEqual(r.results, [{ ok: true }]);
  return r.doc;
};
const get = (d: Doc, id: string): NodeEl => d.nodes.find((n) => n.id === id)!;
const overlaps = (a: NodeEl, b: NodeEl) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

test("timeline: cada papel vai para a sua raia, de cima para baixo na ordem do fluxo", () => {
  const d = laid(pedidos());
  const y = (id: string) => get(d, id).y;
  const order = ["cliente", "fazer-pedido", "criar-pedido", "pedido", "pedido-criado", "enviar-email", "pedidos-abertos", "item-pedido"];
  for (let i = 1; i < order.length; i++) assert.ok(y(order[i - 1]) < y(order[i]), `${order[i - 1]} acima de ${order[i]}`);
  assert.equal(y("criar-pedido"), y("pagar-pedido"), "commands na mesma raia");
  assert.equal(y("item-pedido"), y("endereco"), "estrutura na mesma raia");
  assert.equal(y("pedido-criado"), y("pedido-pago"), "eventos na mesma raia");
});

test("timeline: commands seguem ddd.step e o resto fica na coluna de quem o origina", () => {
  const d = laid(pedidos());
  const x = (id: string) => get(d, id).x;
  assert.ok(x("pagar-pedido") < x("criar-pedido"), "step 1 antes de step 2, apesar da ordem do documento");
  assert.equal(x("pagar-pedido") + STORM_COL_W, x("criar-pedido"));
  assert.equal(x("pedido-criado"), x("criar-pedido"), "evento sob o command que o emite");
  assert.equal(x("pedido-pago"), x("pagar-pedido"));
  assert.equal(x("fazer-pedido"), x("criar-pedido"), "caso de uso na coluna do command que o realiza");
  assert.equal(x("cliente"), x("fazer-pedido"), "ator na coluna do caso de uso");
  assert.equal(x("enviar-email"), x("pedido-criado") + STORM_COL_W, "policy uma coluna depois do evento");
  assert.equal(x("pedidos-abertos"), x("pedido-criado"), "read model na coluna do evento que o alimenta");
  assert.equal(x("pedido"), x("pagar-pedido"), "aggregate na coluna do primeiro command que o aciona");
  // estrutura sob o aggregate: a primeira coluna livre a partir da do aggregate, na ordem do documento
  assert.deepEqual([x("item-pedido"), x("endereco"), x("pedido-repo")], [x("pedido"), x("pedido") + STORM_COL_W, x("pedido") + 2 * STORM_COL_W]);
});

test("timeline: nada se sobrepõe, tudo cabe no contexto e a raia vazia é comprimida", () => {
  const d = laid(pedidos());
  for (let i = 0; i < d.nodes.length; i++) for (let j = i + 1; j < d.nodes.length; j++) assert.equal(overlaps(d.nodes[i], d.nodes[j]), false, `${d.nodes[i].id} × ${d.nodes[j].id}`);
  const g = d.groups.find((x) => x.id === "pedidos")!;
  for (const n of d.nodes) assert.ok(n.x >= g.x && n.y >= g.y && n.x + n.w <= g.x + g.w && n.y + n.h <= g.y + g.h, `${n.id} dentro do contexto`);
  const lanes = new Set(d.nodes.map((n) => n.y));
  assert.equal(lanes.size, 8, "as 8 raias usadas");
  const small = laid([ctx("c"), dn("cmd", { role: "command" }, "c"), dn("a", { role: "aggregate-root" }, "c"), rel("cmd", "a", "triggers")]);
  assert.equal(new Set(small.nodes.map((n) => n.y)).size, 2, "sem raias vazias entre command e aggregate");
  assert.equal(get(small, "a").y - get(small, "cmd").y, STORM_LANE_H);
});

test("timeline: contextos viram blocos empilhados sem se tocar; o que está fora vai para um bloco próprio", () => {
  const d = laid([...pedidos(), ctx("pagamentos"), dn("pagar", { role: "command" }, "pagamentos"), dn("pagamento", { role: "aggregate-root" }, "pagamentos"), rel("pagar", "pagamento", "triggers"), dn("solto", { role: "domain-service" })]);
  const a = d.groups.find((g) => g.id === "pedidos")!;
  const b = d.groups.find((g) => g.id === "pagamentos")!;
  assert.ok(b.y >= a.y + a.h, "segundo contexto abaixo do primeiro");
  assert.ok(get(d, "solto").y >= b.y + b.h, "nó fora de contexto abaixo dos blocos");
  for (const n of d.nodes.filter((n) => n.parent === "pagamentos")) assert.ok(n.y >= b.y && n.y + n.h <= b.y + b.h);
});

test("timeline: determinístico, idempotente e limpa a posição manual dos rótulos", () => {
  const first = laid(pedidos());
  first.connections[0].labelT = 0.3;
  first.connections[0].labelOffset = 12;
  const again = applyOps(first, [{ op: "layout", style: "timeline" }]).doc;
  assert.deepEqual(again.nodes.map((n) => [n.id, n.x, n.y]), first.nodes.map((n) => [n.id, n.x, n.y]));
  assert.deepEqual(again.groups.map((g) => [g.id, g.x, g.y, g.w, g.h]), first.groups.map((g) => [g.id, g.x, g.y, g.w, g.h]));
  assert.notEqual(again.connections[0].labelOffset, 12);
});

test("timeline: aplica o traçado pedido e só existe no modo domain", () => {
  const d = laid(pedidos(), "straight");
  assert.ok(d.connections.every((c) => c.routing === "straight"));
  const arch = applyOps(emptyDoc("a"), [{ op: "layout", style: "timeline" }]);
  assert.equal(arch.results[0].ok, false);
  assert.match(arch.results[0].error!, /modo "domain"/);
  // "flow" continua sendo o layout de sempre, também em diagramas de domínio
  const flow = applyOps(emptyDoc("d", "domain"), [{ op: "layout", style: "flow" }]);
  assert.equal(flow.results[0].ok, true);
});

test("timeline: eventos de outros contextos ficam na raia de entrada, sobre quem reage a eles, sem alargar o diagrama", () => {
  const d = laid([
    ctx("c"),
    dn("ext-a", { role: "domain-event", external: "outro.a" }, "c"),
    dn("ext-b", { role: "domain-event", external: "outro.b" }, "c"),
    dn("cmd", { role: "command" }, "c"),
    dn("agg", { role: "aggregate-root" }, "c"),
    dn("pol", { role: "policy", reactsTo: ["ext-a"], issues: ["cmd"] }, "c"),
    dn("saga", { role: "process-manager", reactsTo: ["ext-a", "ext-b"], issues: ["cmd"] }, "c"),
    dn("rm", { role: "read-model", projectsFrom: ["ext-b"] }, "c"),
    rel("cmd", "agg", "triggers"),
    rel("ext-a", "pol", "triggers"),
    rel("pol", "cmd", "triggers"),
    rel("ext-a", "saga", "triggers"),
    rel("ext-b", "saga", "triggers"),
    rel("saga", "cmd", "triggers"),
    rel("ext-b", "rm", "triggers"),
  ]);
  const y = (id: string) => get(d, id).y;
  const x = (id: string) => get(d, id).x;
  assert.ok(y("ext-a") < y("cmd") && y("ext-b") < y("cmd"), "entradas acima de tudo");
  assert.equal(y("ext-a"), y("ext-b"), "mesma raia");
  assert.equal(x("ext-a"), x("pol"), "evento externo sobre quem reage a ele");
  assert.notEqual(x("ext-a"), x("ext-b"), "sem sobreposição na raia");
  const cols = new Set(d.nodes.map((n) => n.x)).size;
  assert.ok(cols <= 4, `largura contida (${cols} colunas)`);
  for (let i = 0; i < d.nodes.length; i++) for (let j = i + 1; j < d.nodes.length; j++) assert.equal(overlaps(d.nodes[i], d.nodes[j]), false, `${d.nodes[i].id} × ${d.nodes[j].id}`);
});

test("timeline: casos de borda (diagrama vazio, só ator, command sem step e sem aggregate)", () => {
  assert.deepEqual(applyOps(emptyDoc("d", "domain"), [{ op: "layout", style: "timeline" }]).results, [{ ok: true }]);
  const solo = laid([{ op: "add_node", id: "a", label: "A", kind: "actor" }]);
  assert.deepEqual([get(solo, "a").x, get(solo, "a").y >= 0], [28, true]);
  const two = laid([ctx("c"), dn("b", { role: "command" }, "c"), dn("a", { role: "command" }, "c")]);
  assert.ok(get(two, "b").x < get(two, "a").x, "sem step vale a ordem do documento");
  assert.equal(get(two, "b").y, get(two, "a").y);
});
