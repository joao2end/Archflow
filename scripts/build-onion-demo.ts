/**
 * Gera um diagrama de domínio de exemplo, grande e bem conectado, para ver o layout "camadas" e a visão 3D.
 *
 * Uso: npx tsx scripts/build-onion-demo.ts [arquivo]   (padrão: diagrams/exemplos-3d/loja-completa.archflow.json)
 * Não sobrescreve: se o arquivo já existir, para sem gravar.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { applyOps, createDoc, type Op } from "../src/shared/ops";
import type { DddNodeSpec, DddRel } from "../src/shared/schema";

const out = process.argv[2] ?? "diagrams/exemplos-3d/loja-completa.archflow.json";
if (existsSync(out)) {
  console.error(`já existe: ${out} (não sobrescrevo; apague ou passe outro caminho)`);
  process.exit(1);
}

const dn = (id: string, label: string, ddd: DddNodeSpec): Op => ({ op: "add_node", id, label, ddd });
const kn = (id: string, label: string, kind: "actor" | "system" | "external"): Op => ({ op: "add_node", id, label, kind });
const rel = (from: string, to: string, r: DddRel, label?: string): Op => ({ op: "add_connection", from, to, ddd: { rel: r }, ...(label ? { label } : {}) });
const assoc = (from: string, to: string, label: string): Op => ({ op: "add_connection", from, to, type: "association", label });

const ops: Op[] = [
  // Entities: aggregates, entities, value objects, serviços de domínio e eventos
  dn("pedido", "Pedido", { role: "aggregate-root", invariants: ["total >= 0", "pedido pago não muda itens"] }),
  dn("cliente", "Cliente", { role: "aggregate-root" }),
  dn("produto", "Produto", { role: "aggregate-root" }),
  dn("carrinho", "Carrinho", { role: "aggregate-root" }),
  dn("item-pedido", "Item do pedido", { role: "entity" }),
  dn("item-carrinho", "Item do carrinho", { role: "entity" }),
  dn("dinheiro", "Dinheiro", { role: "value-object" }),
  dn("endereco", "Endereço", { role: "value-object" }),
  dn("quantidade", "Quantidade", { role: "value-object" }),
  dn("cpf", "CPF", { role: "value-object" }),
  dn("calculo-frete", "Cálculo de frete", { role: "domain-service" }),
  dn("calculo-impostos", "Cálculo de impostos", { role: "domain-service" }),
  dn("pedido-criado", "Pedido criado", { role: "domain-event" }),
  dn("pedido-pago", "Pedido pago", { role: "domain-event" }),
  dn("pedido-enviado", "Pedido enviado", { role: "domain-event" }),
  dn("pedido-cancelado", "Pedido cancelado", { role: "domain-event" }),
  dn("estoque-reservado", "Estoque reservado", { role: "domain-event" }),
  // Use Cases: casos de uso, commands, application services, policies e saga
  dn("uc-comprar", "Fazer pedido", { role: "use-case", actor: "Cliente", goal: "comprar" }),
  dn("uc-pagar", "Pagar pedido", { role: "use-case", actor: "Cliente", goal: "pagar" }),
  dn("uc-cancelar", "Cancelar pedido", { role: "use-case", actor: "Cliente", goal: "desistir" }),
  dn("uc-acompanhar", "Acompanhar pedido", { role: "use-case", actor: "Cliente", goal: "saber onde está" }),
  dn("uc-atender", "Atender cliente", { role: "use-case", actor: "Atendente", goal: "resolver problema" }),
  dn("cmd-criar", "Criar pedido", { role: "command" }),
  dn("cmd-pagar", "Confirmar pagamento", { role: "command" }),
  dn("cmd-cancelar", "Cancelar pedido", { role: "command" }),
  dn("cmd-enviar", "Enviar pedido", { role: "command" }),
  dn("cmd-reservar", "Reservar estoque", { role: "command" }),
  dn("cmd-add-item", "Adicionar item", { role: "command" }),
  dn("app-checkout", "Checkout", { role: "application-service" }),
  dn("app-consulta", "Consulta de pedidos", { role: "application-service" }),
  dn("pol-notificar", "Notificar cliente", { role: "policy" }),
  dn("pol-liberar", "Liberar estoque", { role: "policy" }),
  dn("saga-checkout", "Fluxo de checkout", { role: "process-manager" }),
  // Interface Adapters: repositories e read models
  dn("repo-pedido", "Pedidos (repo)", { role: "repository", for: "pedido" }),
  dn("repo-cliente", "Clientes (repo)", { role: "repository", for: "cliente" }),
  dn("repo-produto", "Produtos (repo)", { role: "repository", for: "produto" }),
  dn("rm-pedidos", "Pedidos do cliente", { role: "read-model" }),
  dn("rm-painel", "Painel de vendas", { role: "read-model" }),
  // Frameworks & Drivers: atores, sistemas, externos
  kn("ator-cliente", "Cliente", "actor"),
  kn("ator-atendente", "Atendente", "actor"),
  kn("sis-pagamentos", "Pagamentos", "system"),
  kn("sis-estoque", "Estoque", "system"),
  kn("ext-correios", "Correios", "external"),
  kn("ext-email", "Gateway de e-mail", "external"),
  dn("pagamento-aprovado", "Pagamento aprovado", { role: "domain-event", external: "pagamentos" }),

  // interações
  assoc("ator-cliente", "uc-comprar", "executa"),
  assoc("ator-cliente", "uc-pagar", "executa"),
  assoc("ator-cliente", "uc-cancelar", "executa"),
  assoc("ator-cliente", "uc-acompanhar", "consulta"),
  assoc("ator-atendente", "uc-atender", "executa"),
  rel("cmd-criar", "uc-comprar", "realizes"),
  rel("cmd-add-item", "uc-comprar", "realizes"),
  rel("cmd-pagar", "uc-pagar", "realizes"),
  rel("cmd-cancelar", "uc-cancelar", "realizes"),
  rel("app-consulta", "uc-acompanhar", "realizes"),
  rel("app-checkout", "uc-comprar", "realizes"),
  rel("cmd-cancelar", "uc-atender", "realizes"),
  rel("cmd-add-item", "carrinho", "triggers"),
  rel("cmd-criar", "pedido", "triggers"),
  rel("cmd-pagar", "pedido", "triggers"),
  rel("cmd-cancelar", "pedido", "triggers"),
  rel("cmd-enviar", "pedido", "triggers"),
  rel("cmd-reservar", "produto", "triggers"),
  rel("cmd-criar", "pedido-criado", "emits"),
  rel("cmd-pagar", "pedido-pago", "emits"),
  rel("cmd-enviar", "pedido-enviado", "emits"),
  rel("cmd-cancelar", "pedido-cancelado", "emits"),
  rel("cmd-reservar", "estoque-reservado", "emits"),
  rel("pedido", "item-pedido", "contains"),
  rel("pedido", "endereco", "contains"),
  rel("pedido", "dinheiro", "contains"),
  rel("carrinho", "item-carrinho", "contains"),
  rel("item-carrinho", "quantidade", "contains"),
  rel("cliente", "cpf", "contains"),
  rel("pedido", "cliente", "references-by-id"),
  rel("cmd-criar", "calculo-frete", "uses"),
  rel("cmd-criar", "calculo-impostos", "uses"),
  rel("cmd-criar", "repo-pedido", "uses"),
  rel("cmd-reservar", "repo-produto", "uses"),
  rel("app-checkout", "repo-cliente", "uses"),
  rel("pedido-criado", "saga-checkout", "triggers"),
  rel("saga-checkout", "cmd-reservar", "triggers"),
  rel("estoque-reservado", "saga-checkout", "triggers"),
  rel("pagamento-aprovado", "saga-checkout", "triggers"),
  rel("saga-checkout", "cmd-pagar", "triggers"),
  rel("pedido-pago", "pol-notificar", "triggers"),
  rel("pedido-enviado", "pol-notificar", "triggers"),
  rel("pedido-cancelado", "pol-liberar", "triggers"),
  rel("pedido-pago", "rm-pedidos", "triggers"),
  rel("pedido-criado", "rm-pedidos", "triggers"),
  rel("pedido-pago", "rm-painel", "triggers"),
  assoc("pol-notificar", "ext-email", "envia e-mail"),
  assoc("cmd-enviar", "ext-correios", "agenda coleta"),
  assoc("cmd-pagar", "sis-pagamentos", "cobra"),
  assoc("cmd-reservar", "sis-estoque", "reserva"),
  { op: "layout" },
];

const doc = createDoc("Loja — domínio completo (exemplo 3D)", "domain");
const r = applyOps(doc, ops);
const failed = r.results.map((x, i) => ({ x, op: ops[i] })).filter((y) => !y.x.ok);
for (const f of failed) console.log(`✗ ${JSON.stringify(f.op).slice(0, 90)} → ${f.x.error}`);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(r.doc, null, 2));
console.log(`gravado: ${out} (${r.doc.nodes.length} componentes, ${r.doc.connections.length} conexões, ${failed.length} falha(s))`);
