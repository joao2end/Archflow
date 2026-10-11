/**
 * Exemplo mínimo do modo Architecture, para o primeiro uso: uma loja online com web, gateway, serviço de pedidos,
 * banco, cache, fila e um sistema externo de e-mail. Usa só assets genéricos e os tipos de conexão básicos
 * (síncrona, dados, assíncrona), o suficiente para mostrar como o quadro lê.
 */
import { emptyDoc, type Doc } from "./schema";
import { applyOps, type Op } from "./ops";

const OPS: Op[] = [
  { op: "add_node", id: "cliente", asset: "user", label: "Cliente" },
  { op: "add_node", id: "loja-web", asset: "web-app", label: "Loja web" },
  { op: "add_node", id: "gateway", asset: "gateway", label: "API Gateway" },
  { op: "add_node", id: "pedidos", asset: "service", label: "Serviço de pedidos" },
  { op: "add_node", id: "banco", asset: "database", label: "Banco de pedidos" },
  { op: "add_node", id: "cache", asset: "cache", label: "Cache de catálogo" },
  { op: "add_node", id: "fila", asset: "queue", label: "Fila de eventos" },
  { op: "add_node", id: "email", asset: "external", label: "Serviço de e-mail" },
  { op: "add_connection", from: "cliente", to: "loja-web", type: "sync", label: "usa" },
  { op: "add_connection", from: "loja-web", to: "gateway", type: "sync", label: "HTTPS" },
  { op: "add_connection", from: "gateway", to: "pedidos", type: "sync" },
  { op: "add_connection", from: "pedidos", to: "banco", type: "data", label: "grava" },
  { op: "add_connection", from: "pedidos", to: "cache", type: "data", label: "lê catálogo" },
  { op: "add_connection", from: "pedidos", to: "fila", type: "async", label: "pedido criado" },
  { op: "add_connection", from: "fila", to: "email", type: "async", label: "avisa o cliente" },
  { op: "layout" },
];

export function starterDoc(): Doc {
  const doc = emptyDoc("Loja online (exemplo)", "architecture");
  const r = applyOps(doc, OPS);
  const bad = r.results.filter((x) => !x.ok);
  if (bad.length) throw new Error("exemplo de arquitetura inválido: " + JSON.stringify(bad));
  return r.doc;
}
