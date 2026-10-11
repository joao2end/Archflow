import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { applyOps, describe, normalizeDoc, schemaGuide, toMermaid, validate, type Op } from "./ops";
import { emptyDoc } from "./schema";

/**
 * Regressão: a saída para diagramas `architecture` não pode mudar com a chegada do modo domínio.
 * `fixtures/arch-golden.json` foi gerado pelo código ANTERIOR ao modo domínio (commit 351e901),
 * com exatamente estas ops. Qualquer diferença aqui é uma quebra de compatibilidade.
 */
const OPS: Op[] = [
  { op: "set_meta", title: "Plataforma", description: "Demo" },
  { op: "add_group", id: "aws", label: "AWS", kind: "cloud" },
  { op: "add_group", id: "orders-ctx", label: "Orders", kind: "context", parent: "aws", description: "Bounded context" },
  { op: "add_node", id: "web", label: "Web", asset: "react" },
  { op: "add_node", id: "api", label: "Orders API", asset: "nestjs", parent: "orders-ctx", description: "API de pedidos", props: { porta: "3000" } },
  { op: "add_node", id: "db", label: "Orders DB", asset: "postgresql", parent: "orders-ctx" },
  { op: "add_node", id: "q", label: "Fila", asset: "aws-sqs", parent: "aws" },
  { op: "add_node", id: "solto", label: "Solto" },
  { op: "add_node", id: "ref", label: "Pagamentos", ref: { diagram: "pagamentos/checkout.archflow.json" } },
  { op: "add_endpoint", owner: "api", protocol: "rest", method: "POST", path: "/orders", request: "{items}", response: "201" },
  { op: "add_endpoint", owner: "api", protocol: "event", method: "PUBLISH", path: "order.created" },
  { op: "add_connection", from: "web", to: "api", type: "sync", label: "HTTPS", protocol: "REST" },
  { op: "add_connection", from: "api", to: "db", type: "data", label: "SQL" },
  { op: "add_connection", from: "api", to: "q", type: "async", label: "order.created" },
  { op: "add_connection", from: "api", to: "ref", type: "dependency" },
  { op: "add_note", text: "nota", variant: "list", title: "Tarefas", checklist: true },
  { op: "layout", direction: "LR" },
];

test("T15: arquitetura gera exatamente a mesma saída de antes do modo domínio", () => {
  const golden = JSON.parse(readFileSync(new URL("./fixtures/arch-golden.json", import.meta.url), "utf8"));
  const { doc, results } = applyOps(emptyDoc("Plataforma"), OPS);
  const stable = JSON.parse(JSON.stringify(doc));
  stable.id = "X";
  assert.deepEqual(results, golden.results);
  assert.deepEqual(stable, golden.doc);
  assert.deepEqual(validate(doc), golden.validate);
  assert.equal(describe(doc), golden.describe);
  assert.equal(toMermaid(doc), golden.mermaid);
  assert.equal(schemaGuide(), golden.guide);
  assert.deepEqual(Object.keys(normalizeDoc(JSON.parse(JSON.stringify(doc)))), golden.normalized);
});
