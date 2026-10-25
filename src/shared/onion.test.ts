import assert from "node:assert/strict";
import { test } from "node:test";
import { applyOps, createDoc, type Op } from "./ops";
import { insideGroupShape, onionPicks } from "./onion";
import { NODE_H, NODE_W, emptyDoc, type DddNodeSpec, type Doc, type GroupEl, type NodeEl } from "./schema";

const dn = (id: string, ddd: DddNodeSpec, parent?: string): Op => ({ op: "add_node", id, label: id, ddd, ...(parent ? { parent } : {}) });
const inside = (a: { x: number; y: number; w: number; h: number }, b: GroupEl) => a.x >= b.x && a.y >= b.y && a.x + a.w <= b.x + b.w && a.y + a.h <= b.y + b.h;
const overlaps = (a: NodeEl, b: NodeEl) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

const pedidos = (): Op[] => [
  { op: "add_group", id: "pedidos", label: "Pedidos", kind: "context", subdomain: "core" },
  dn("pedido", { role: "aggregate-root" }, "pedidos"),
  dn("endereco", { role: "value-object" }, "pedidos"),
  dn("pedido-criado", { role: "domain-event" }, "pedidos"),
  dn("criar-pedido", { role: "command" }, "pedidos"),
  dn("fazer-pedido", { role: "use-case", actor: "Cliente", goal: "comprar" }, "pedidos"),
  dn("enviar-email", { role: "policy" }, "pedidos"),
  dn("pedido-repo", { role: "repository", for: "pedido" }, "pedidos"),
  dn("pedidos-abertos", { role: "read-model" }, "pedidos"),
  { op: "add_node", id: "cliente", label: "Cliente", kind: "actor" },
  { op: "add_node", id: "erp", label: "ERP", kind: "external" },
  { op: "add_connection", from: "cliente", to: "fazer-pedido", type: "association" },
  { op: "add_connection", from: "criar-pedido", to: "pedido", ddd: { rel: "triggers" } },
];

const laid = (ops: Op[], style?: "onion"): Doc => {
  const base = applyOps(emptyDoc("t", "domain"), ops);
  assert.deepEqual(base.results.filter((r) => !r.ok), []);
  const r = applyOps(base.doc, [{ op: "layout", ...(style ? { style } : {}) }]);
  assert.deepEqual(r.results, [{ ok: true }]);
  return r.doc;
};

test("onion: padrão do modo domain; anéis concêntricos Entities ⊂ Use Cases ⊂ Adapters ⊂ contexto ⊂ Drivers", () => {
  const d = laid(pedidos());
  const g = (id: string) => d.groups.find((x) => x.id === id)!;
  const n = (id: string) => d.nodes.find((x) => x.id === id)!;
  const ring = (id: string) => d.groups.find((x) => x.id === n(id).parent)!;
  assert.equal(ring("pedido").id, "anel-pedidos-entities");
  assert.equal(ring("pedido-criado").id, "anel-pedidos-entities");
  assert.equal(ring("criar-pedido").id, "anel-pedidos-usecases");
  assert.equal(ring("enviar-email").id, "anel-pedidos-usecases");
  assert.equal(ring("pedido-repo").label, "Gateways");
  assert.equal(ring("pedidos-abertos").label, "Presenters");
  assert.equal(ring("cliente").label, "Atores");
  assert.equal(ring("erp").label, "Interfaces externas");
  // aninhamento e contenção
  assert.equal(g("anel-pedidos-entities").parent, "anel-pedidos-usecases");
  assert.equal(g("anel-pedidos-usecases").parent, "anel-pedidos-adapters");
  assert.equal(g("anel-pedidos-adapters").parent, "pedidos");
  assert.equal(g("pedidos").parent, "anel-geral-drivers");
  for (const x of d.groups) if (x.parent) assert.ok(inside(x, g(x.parent)), `${x.id} dentro de ${x.parent}`);
  for (const x of d.nodes) if (x.parent) assert.ok(inside(x, g(x.parent)), `${x.id} dentro de ${x.parent}`);
  // círculos: cada componente inteiro dentro do seu anel (ou setor); setores e anéis com o mesmo centro
  for (const x of d.nodes) {
    const p = g(x.parent!);
    if (!p.ring) continue;
    for (const c of [{ x: x.x, y: x.y }, { x: x.x + x.w, y: x.y }, { x: x.x, y: x.y + x.h }, { x: x.x + x.w, y: x.y + x.h }]) assert.ok(insideGroupShape(p, c), `${x.id} dentro do anel ${p.id}`);
  }
  const center = (x: GroupEl) => [x.x + x.w / 2, x.y + x.h / 2];
  for (const id of ["anel-pedidos-usecases", "anel-pedidos-adapters", ring("pedido-repo").id]) assert.deepEqual(center(g(id)), center(g("anel-pedidos-entities")));
  assert.ok(g("anel-pedidos-usecases").ring!.inner >= g("anel-pedidos-entities").w / 2, "anel de fora começa onde o de dentro termina");
  assert.equal(g("anel-pedidos-entities").ring!.inner, 0, "o miolo é um disco");
  assert.ok(g("anel-pedidos-adapters").ring!.frame, "anel com setores só agrupa");
  // a fronteira esquerda/direita: repository à esquerda do miolo, read model à direita
  assert.ok(n("pedido-repo").x + n("pedido-repo").w <= g("anel-pedidos-usecases").x);
  assert.ok(n("pedidos-abertos").x >= g("anel-pedidos-usecases").x + g("anel-pedidos-usecases").w);
  for (let i = 0; i < d.nodes.length; i++) for (let j = i + 1; j < d.nodes.length; j++) assert.equal(overlaps(d.nodes[i], d.nodes[j]), false, `${d.nodes[i].id} × ${d.nodes[j].id}`);
});

test("onion: idempotente; a estrutura existe mesmo vazia; timeline desfaz os anéis e devolve os pais", () => {
  const d = laid(pedidos(), "onion");
  const again = applyOps(d, [{ op: "layout", style: "onion" }]).doc;
  assert.deepEqual(again.nodes.map((n) => [n.id, n.x, n.y, n.parent]), d.nodes.map((n) => [n.id, n.x, n.y, n.parent]));
  assert.equal(again.groups.length, d.groups.length);

  // a estrutura existe sempre: anéis e setores vazios também são criados
  const small = laid([dn("a", { role: "aggregate-root" }), dn("c", { role: "command" })]);
  assert.deepEqual(small.groups.map((g) => g.id).sort(), [
    "anel-geral-adapters", "anel-geral-adapters-left", "anel-geral-adapters-right", "anel-geral-adapters-top",
    "anel-geral-drivers", "anel-geral-drivers-bottom", "anel-geral-drivers-left", "anel-geral-drivers-right", "anel-geral-drivers-top",
    "anel-geral-entities", "anel-geral-usecases",
  ]);
  // componentes de domínio viram círculos que orbitam; o aggregate root fica no centro do miolo
  const core = small.groups.find((g) => g.id === "anel-geral-entities")!;
  const a = small.nodes.find((n) => n.id === "a")!;
  assert.equal(a.w, a.h);
  assert.deepEqual([a.x + a.w / 2, a.y + a.h / 2], [core.x + core.w / 2, core.y + core.h / 2]);
  assert.ok(small.groups.find((g) => g.id === "anel-geral-usecases")!.ring!.orbits?.length, "o anel guarda a órbita para o canvas desenhar");

  const back = applyOps(d, [{ op: "layout", style: "timeline" }]).doc;
  assert.ok(back.groups.every((g) => !g.id.startsWith("anel-")));
  assert.equal(back.nodes.find((n) => n.id === "pedido")!.parent, "pedidos");
  assert.equal(back.nodes.find((n) => n.id === "cliente")!.parent, undefined);
  assert.equal(back.groups.find((g) => g.id === "pedidos")!.parent, undefined);
  assert.deepEqual([back.nodes.find((n) => n.id === "pedido")!.w, back.nodes.find((n) => n.id === "pedido")!.h], [NODE_W, NODE_H], "fora dos anéis volta a ser cartão");
  assert.equal(applyOps(emptyDoc("a"), [{ op: "layout", style: "onion" }]).results[0].ok, false);
});

test("onion: vários contextos ficam lado a lado dentro do anel geral de drivers", () => {
  const d = laid([
    { op: "add_group", id: "a", label: "A", kind: "context" },
    { op: "add_group", id: "b", label: "B", kind: "context" },
    dn("x", { role: "aggregate-root" }, "a"),
    dn("y", { role: "aggregate-root" }, "b"),
    dn("cy", { role: "command" }, "b"),
    { op: "add_node", id: "u", label: "U", kind: "actor" },
  ]);
  const g = (id: string) => d.groups.find((x) => x.id === id)!;
  assert.equal(g("a").parent, "anel-geral-drivers");
  assert.equal(g("b").parent, "anel-geral-drivers");
  const outer = g("anel-geral-drivers");
  const R = outer.w / 2;
  for (const c of [g("a"), g("b")]) for (const [px, py] of [[c.x, c.y], [c.x + c.w, c.y + c.h]]) assert.ok(Math.hypot(px - outer.x - R, py - outer.y - R) <= outer.ring!.inner, `${c.id} dentro do anel geral`);
  assert.ok(g("a").x + g("a").w <= g("b").x || g("b").x + g("b").w <= g("a").x || g("a").y + g("a").h <= g("b").y, "contextos sem sobreposição");
});

test("onion: diagrama de domínio novo já nasce com a estrutura circular; clicar numa área oferece os componentes daquela camada", () => {
  const d = createDoc("Novo", "domain");
  assert.equal(d.nodes.length, 0);
  assert.equal(d.groups.filter((g) => g.ring).length, 11);
  assert.equal(createDoc("Mapa", "domain", { blank: true }).groups.length, 0, "mapa de contextos sem anéis");
  assert.equal(createDoc("Arq", "architecture").groups.length, 0);
  // adicionar pelo menu: o componente cai na área clicada e o layout encaixa
  const core = d.groups.find((g) => g.ring?.layer === "entities")!;
  const pick = onionPicks("entities")[0];
  const r = applyOps(d, [{ op: "add_node", ...pick.node, parent: core.id }, { op: "layout" }]);
  assert.ok(r.results.every((x) => x.ok));
  assert.equal(r.doc.nodes[0].parent, core.id);
  assert.equal(r.doc.groups.filter((g) => g.ring).length, 11, "o layout padrão mantém os anéis no diagrama ainda quase vazio");
  assert.deepEqual(onionPicks("adapters", "left").map((p) => p.node.ddd?.role), ["repository"]);
  assert.deepEqual(onionPicks("adapters", "top").map((p) => p.node.ddd?.role), ["controller"]);
  assert.deepEqual(onionPicks("drivers", "top").map((p) => p.node.kind), ["actor"]);
  // um mapa de contextos (só referências) não fica com anéis ao reorganizar
  const map = applyOps(createDoc("Mapa", "domain"), [{ op: "add_node", id: "s", label: "S", kind: "system" }, { op: "layout" }]).doc;
  assert.ok(map.groups.every((g) => !g.ring));
});
