import assert from "node:assert/strict";
import { test } from "node:test";
import { applyOps, describe, validate, type Op } from "./ops";
import { emptyDoc } from "./schema";
import { buildTour } from "./tour";

const base: Op[] = [
  { op: "set_meta", title: "Pedidos", description: "Checkout de ponta a ponta" },
  { op: "add_group", id: "backend", label: "Backend", kind: "layer" },
  { op: "add_node", id: "web", label: "App Web", kind: "client", x: 0, y: 0 },
  { op: "add_node", id: "orders-api", label: "Orders API", kind: "service", parent: "backend", description: "Cria e consulta pedidos", technology: "Laravel 11", props: { porta: "3000" }, x: 200, y: 0 },
  { op: "add_node", id: "db", label: "Pedidos", kind: "database", parent: "backend", x: 400, y: 0 },
  { op: "add_endpoint", owner: "orders-api", id: "post-orders", protocol: "rest", method: "POST", path: "/orders", request: "{items}", response: "201", auth: "bearer" },
  {
    op: "add_connection",
    id: "web-to-orders-api",
    from: "web",
    to: "orders-api",
    type: "sync",
    label: "POST /orders",
    protocol: "HTTPS/REST",
    description: "Cria o pedido",
    interface: { name: "PedidosAPI", kind: "rest", contract: "openapi.yaml", operations: [{ name: "createOrder", method: "POST", path: "/orders", request: "{items}", response: "201" }] },
  },
  { op: "add_connection", id: "api-to-db", from: "orders-api", to: "db", type: "data", label: "INSERT order" },
  { op: "add_note", id: "adr-fila", text: "Fila para não bloquear o checkout", title: "ADR" },
];

function docOf(extra: Op[] = []) {
  return applyOps(emptyDoc(), [...base, ...extra]).doc;
}

test("roteiro explícito mostra responsabilidade, endpoint, conexão, contrato e nota", () => {
  const doc = docOf([
    {
      op: "set_tour",
      steps: [
        { title: "Visão geral", text: "O caminho do checkout.", focus: [] },
        { title: "Checkout", text: "O app cria o pedido na API.", focus: ["orders-api", "web-to-orders-api", "adr-fila", "fantasma"] },
      ],
    },
  ]);
  const tour = buildTour(doc);
  assert.equal(tour.auto, false);
  assert.equal(tour.slides.length, 2);
  assert.equal(tour.slides[0].overview, true);
  assert.equal(tour.slides[0].text, "O caminho do checkout.");

  const slide = tour.slides[1];
  assert.equal(slide.overview, false);
  const api = slide.cards.find((c) => c.id === "orders-api");
  assert.ok(api);
  assert.equal(api.roleLabel, "Serviço");
  assert.equal(api.context, "Backend");
  assert.equal(api.technology, "Laravel 11");
  assert.equal(api.responsibility, "Cria e consulta pedidos");
  assert.equal(api.endpoints[0].label, "POST /orders");
  assert.equal(api.endpoints[0].auth, "bearer");
  assert.deepEqual(api.props, [{ key: "porta", value: "3000" }]);
  assert.ok(slide.spotlight.nodes.includes("post-orders"), "o endpoint do serviço acende junto");

  const conn = slide.cards.find((c) => c.id === "web-to-orders-api");
  assert.ok(conn);
  assert.equal(conn.route, "App Web —sync→ Orders API");
  assert.equal(conn.protocol, "HTTPS/REST");
  assert.equal(conn.responsibility, "Cria o pedido");
  assert.equal(conn.iface?.name, "PedidosAPI");
  assert.equal(conn.iface?.contract, "openapi.yaml");
  assert.equal(conn.iface?.operations[0].signature, "POST /orders");
  assert.ok(slide.spotlight.conns.includes("web-to-orders-api"));
  assert.ok(slide.spotlight.nodes.includes("web"), "as pontas da conexão acendem");

  const note = slide.cards.find((c) => c.id === "adr-fila");
  assert.equal(note?.roleLabel, "Nota");
  assert.equal(note?.title, "ADR");
  assert.match(note?.noteText ?? "", /não bloquear/);
  assert.equal(slide.cards.some((c) => c.id === "fantasma"), false);

  const issues = validate(doc);
  assert.ok(issues.some((i) => i === 'tour: passo 2 cita "fantasma", que não existe'), issues.join("\n"));
  assert.match(describe(doc), /## Roteiro de apresentação\n1\. \*\*Visão geral\*\* — visão geral\n {3}O caminho do checkout\.\n2\. \*\*Checkout\*\* — `orders-api`, `web-to-orders-api`, `adr-fila`, `fantasma`/);
});

test("sem roteiro, a ordem segue o fluxo e as notas fecham a apresentação", () => {
  const doc = docOf();
  const tour = buildTour(doc);
  assert.equal(tour.auto, true);
  assert.deepEqual(
    tour.slides.map((s) => s.id),
    ["visao-geral", "auto-web", "auto-orders-api", "auto-db", "observacoes"],
  );
  assert.equal(tour.slides[0].title, "Pedidos");
  assert.equal(tour.slides[0].text, "Checkout de ponta a ponta");
  const api = tour.slides[2];
  assert.equal(api.title, "Orders API");
  assert.equal(api.text, "Cria e consulta pedidos");
  assert.deepEqual(
    api.cards.map((c) => c.id),
    ["orders-api", "web-to-orders-api"],
  );
  assert.equal(tour.slides.at(-1)?.title, "Observações");
  assert.equal(tour.slides.at(-1)?.cards[0].id, "adr-fila");
  assert.equal(describe(doc).includes("## Roteiro de apresentação"), false);
});

test("empate de ordem usa a posição e um ciclo não perde componente", () => {
  const { doc } = applyOps(emptyDoc("Ciclo"), [
    { op: "add_node", id: "b", label: "B", kind: "service", x: 100, y: 0 },
    { op: "add_node", id: "a", label: "A", kind: "service", x: 0, y: 0 },
    { op: "add_node", id: "c", label: "C", kind: "service", x: 50, y: 40 },
    { op: "add_connection", from: "c", to: "a", type: "sync" },
    { op: "add_connection", from: "a", to: "c", type: "sync" },
  ]);
  const ids = buildTour(doc).slides.filter((s) => s.id.startsWith("auto-")).map((s) => s.id);
  assert.deepEqual(ids, ["auto-b", "auto-a", "auto-c"]);
});

test("set_tour vazio apaga o roteiro e um passo sem título é recusado", () => {
  const withTour = docOf([{ op: "set_tour", steps: [{ title: "Um", focus: ["web"] }] }]);
  assert.equal(withTour.tour?.length, 1);
  const cleared = applyOps(withTour, [{ op: "set_tour", steps: [] }]).doc;
  assert.equal(cleared.tour, undefined);
  const bad = applyOps(withTour, [{ op: "set_tour", steps: [{ title: "  ", focus: [] }] }]);
  assert.equal(bad.results[0].ok, false);
  assert.match(bad.results[0].error ?? "", /title é obrigatório/);
  assert.equal(bad.doc.tour?.length, 1, "a recusa não troca o roteiro");
});

test("grupo em foco acende a fronteira e os filhos", () => {
  const doc = docOf([{ op: "set_tour", steps: [{ title: "Backend", focus: ["backend"] }] }]);
  const slide = buildTour(doc).slides[0];
  assert.equal(slide.cards[0].roleLabel, "Camada");
  assert.equal(slide.cards[0].responsibility, undefined);
  assert.ok(slide.spotlight.groups.includes("backend"));
  assert.ok(slide.spotlight.nodes.includes("orders-api"));
  assert.ok(slide.spotlight.nodes.includes("db"));
});
