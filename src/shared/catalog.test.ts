import assert from "node:assert/strict";
import { test } from "node:test";
import { ASSET_CATEGORIES, BUILTIN_ASSETS, DOMAIN_CATEGORY, assetsForMode, searchAssets } from "./catalog";
import { applyOps } from "./ops";
import { DDD_ROLES, DDD_ROLE_KEYS, emptyDoc, type Asset } from "./schema";

const domainAssets = BUILTIN_ASSETS.filter((a) => a.category === DOMAIN_CATEGORY);

test("catálogo: um asset de domínio por papel DDD, derivado da fonte única", () => {
  assert.deepEqual(domainAssets.map((a) => a.ddd?.role), DDD_ROLE_KEYS);
  for (const a of domainAssets) {
    const role = a.ddd!.role;
    assert.equal(a.id, `ddd-${role}`);
    assert.equal(a.name, DDD_ROLES[role].label);
    assert.equal(a.kind, "domain");
    assert.equal(a.color, DDD_ROLES[role].color);
    assert.equal(a.problem, DDD_ROLES[role].hint, "a dica em pt-BR é a explicação do papel");
    assert.ok(a.icon.startsWith("t:") && a.icon.length > 2);
    assert.equal(a.builtin, true);
  }
});

test("catálogo: ids únicos e a categoria Domain existe", () => {
  const ids = BUILTIN_ASSETS.map((a) => a.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ASSET_CATEGORIES.includes(DOMAIN_CATEGORY));
});

test("assetsForMode: architecture esconde Domain; domain mostra só Domain + Genéricos; all ignora o filtro", () => {
  const arch = assetsForMode(BUILTIN_ASSETS, "architecture");
  assert.equal(arch.some((a) => a.category === DOMAIN_CATEGORY), false);
  assert.equal(arch.length, BUILTIN_ASSETS.length - domainAssets.length);
  const dom = assetsForMode(BUILTIN_ASSETS, "domain");
  assert.deepEqual(dom.map((a) => a.id), [...DDD_ROLE_KEYS.map((r) => `ddd-${r}`), "user", "diagram-ref"], "Domain primeiro, depois ator e referência");
  assert.ok(dom.some((a) => a.id === "user" && a.kind === "actor"), "ator continua disponível");
  assert.ok(dom.some((a) => a.id === "diagram-ref"), "referência a outro diagrama continua disponível");
  assert.equal(dom.some((a) => a.id === "service" || a.id === "database"), false, "genéricos de infraestrutura ficam de fora");
  assert.equal(dom.findIndex((a) => a.category !== DOMAIN_CATEGORY) >= DDD_ROLE_KEYS.length, true, "categoria Domain vem antes");
  assert.equal(assetsForMode(BUILTIN_ASSETS, "domain", true).length, BUILTIN_ASSETS.length);
  const custom: Asset[] = [
    { id: "meu-agg", name: "Meu", category: "Personalizados", kind: "domain", icon: "t:X", color: "#000", problem: "", description: "", tags: [] },
    { id: "meu-svc", name: "Svc", category: "Personalizados", kind: "service", icon: "t:X", color: "#000", problem: "", description: "", tags: [] },
  ];
  assert.deepEqual(assetsForMode(custom, "domain").map((a) => a.id), ["meu-agg"]);
  assert.deepEqual(assetsForMode(custom, "architecture").map((a) => a.id), ["meu-agg", "meu-svc"]);
});

test("busca encontra papéis pelos termos em pt-BR", () => {
  const ids = (q: string) => searchAssets(BUILTIN_ASSETS, q).map((a) => a.id);
  assert.ok(ids("saga").includes("ddd-process-manager"));
  assert.ok(ids("invariante").includes("ddd-aggregate-root"));
  assert.ok(ids("projeção cqrs").includes("ddd-read-model"));
  assert.deepEqual(searchAssets(BUILTIN_ASSETS, "", DOMAIN_CATEGORY).length, DDD_ROLE_KEYS.length);
});

test("add_node com asset de domínio: usa o papel do asset em diagramas domain e rejeita em architecture", () => {
  const dom = applyOps(emptyDoc("d", "domain"), [{ op: "add_node", id: "cmd", asset: "ddd-command" }, { op: "add_node", id: "evt", asset: "ddd-domain-event", label: "Pedido Criado" }]);
  assert.deepEqual(dom.results.map((r) => r.ok), [true, true]);
  const [cmd, evt] = dom.doc.nodes;
  assert.equal(cmd.kind, "domain");
  assert.equal(cmd.label, "Command");
  assert.deepEqual(cmd.ddd, { role: "command" });
  assert.equal(evt.label, "Pedido Criado");
  assert.equal(evt.asset, "ddd-domain-event");

  const arch = applyOps(emptyDoc("a"), [{ op: "add_node", asset: "ddd-command" }]);
  assert.equal(arch.results[0].ok, false);
  assert.match(arch.results[0].error!, /modo "domain"/);

  // o asset não vaza estado entre nós: alterar o ddd de um não afeta o catálogo
  const again = applyOps(emptyDoc("d", "domain"), [{ op: "add_node", id: "x", asset: "ddd-command" }]);
  (again.doc.nodes[0].ddd as { intent?: string }).intent = "mutado";
  assert.deepEqual(BUILTIN_ASSETS.find((a) => a.id === "ddd-command")!.ddd, { role: "command" });
});
