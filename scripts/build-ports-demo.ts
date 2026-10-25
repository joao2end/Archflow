/**
 * Gera um diagrama de domínio de exemplo com portas (inversão de dependência), para ver como elas aparecem no 2D e no 3D.
 *
 * Fluxo de pedidos enxuto, com quatro portas: dois commands usam o repository pela interface RepositorioDePedidos, o
 * pagamento passa por GatewayDePagamento, a notificação por NotificadorDeClientes e o cálculo de frete (um domain
 * service, em Entities) cota nos Correios por TabelaDeFrete — sem a porta, esta última feriria a regra de camadas.
 *
 * Uso: npx tsx scripts/build-ports-demo.ts [arquivo]   (padrão: diagrams/exemplos-3d/pedidos-com-portas.archflow.json)
 * Não sobrescreve: se o arquivo já existir, para sem gravar.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { applyOps, createDoc, type Op } from "../src/shared/ops";
import type { DddNodeSpec, DddRel, PortSpec } from "../src/shared/schema";

const out = process.argv[2] ?? "diagrams/exemplos-3d/pedidos-com-portas.archflow.json";
if (existsSync(out)) {
  console.error(`já existe: ${out} (não sobrescrevo; apague ou passe outro caminho)`);
  process.exit(1);
}

const dn = (id: string, label: string, ddd: DddNodeSpec, description?: string): Op => ({ op: "add_node", id, label, ddd, ...(description ? { description } : {}) });
const kn = (id: string, label: string, kind: "actor" | "system" | "external", description?: string): Op => ({ op: "add_node", id, label, kind, ...(description ? { description } : {}) });
const rel = (from: string, to: string, r: DddRel, port?: PortSpec): Op => ({ op: "add_connection", from, to, ddd: { rel: r }, ...(port ? { port } : {}) });
const assoc = (from: string, to: string, label: string, port?: PortSpec): Op => ({ op: "add_connection", from, to, type: "association", label, ...(port ? { port } : {}) });

const repo: PortSpec = { name: "RepositorioDePedidos", operations: ["salvar(pedido)", "buscarPorId(id)"] };

const ops: Op[] = [
  // Entities
  dn("pedido", "Pedido", { role: "aggregate-root", invariants: ["total >= 0", "pedido pago não muda itens"] }),
  dn("item-pedido", "Item do pedido", { role: "entity" }),
  dn("dinheiro", "Dinheiro", { role: "value-object" }),
  dn("pedido-criado", "Pedido criado", { role: "domain-event", payload: "pedidoId, clienteId, total" }),
  dn("pedido-pago", "Pedido pago", { role: "domain-event", payload: "pedidoId, valor" }),
  dn("calculo-frete", "Cálculo de frete", { role: "domain-service", intent: "cotar o frete do pedido" }, "Regra de frete do domínio; a cotação vem por uma porta, sem conhecer os Correios."),
  // Use Cases
  dn("uc-comprar", "Fazer pedido", { role: "use-case", actor: "Cliente", goal: "comprar" }),
  dn("uc-pagar", "Pagar pedido", { role: "use-case", actor: "Cliente", goal: "pagar" }),
  dn("cmd-criar", "Criar pedido", { role: "command", intent: "registrar o pedido do cliente" }),
  dn("cmd-pagar", "Confirmar pagamento", { role: "command", intent: "cobrar e marcar o pedido como pago" }),
  dn("pol-notificar", "Notificar cliente", { role: "policy", intent: "avisar o cliente quando o pedido for pago" }),
  // Interface Adapters
  dn("repo-pedido", "Pedidos (repo)", { role: "repository", for: "pedido" }, "Implementa RepositorioDePedidos (ex.: Postgres)."),
  dn("rm-pedidos", "Pedidos do cliente", { role: "read-model" }),
  // Frameworks & Drivers
  kn("ator-cliente", "Cliente", "actor"),
  kn("ext-pagamento", "Gateway de pagamento", "external", "Ex.: Stripe; implementa GatewayDePagamento."),
  kn("ext-email", "Gateway de e-mail", "external", "Ex.: SES; implementa NotificadorDeClientes."),
  kn("ext-correios", "Correios", "external", "API de cotação; implementa TabelaDeFrete."),

  // fluxo
  assoc("ator-cliente", "uc-comprar", "executa"),
  assoc("ator-cliente", "uc-pagar", "executa"),
  rel("cmd-criar", "uc-comprar", "realizes"),
  rel("cmd-pagar", "uc-pagar", "realizes"),
  rel("cmd-criar", "pedido", "triggers"),
  rel("cmd-pagar", "pedido", "triggers"),
  rel("cmd-criar", "pedido-criado", "emits"),
  rel("cmd-pagar", "pedido-pago", "emits"),
  rel("pedido", "item-pedido", "contains"),
  rel("pedido", "dinheiro", "contains"),
  rel("cmd-criar", "calculo-frete", "uses"),
  rel("pedido-pago", "pol-notificar", "triggers"),
  rel("pedido-criado", "rm-pedidos", "triggers"),
  rel("pedido-pago", "rm-pedidos", "triggers"),

  // portas (inversão de dependência): a interface é da camada da origem; o destino, mais externo, a implementa
  rel("cmd-criar", "repo-pedido", "uses", repo),
  rel("cmd-pagar", "repo-pedido", "uses", repo),
  assoc("cmd-pagar", "ext-pagamento", "cobra", { name: "GatewayDePagamento", operations: ["cobrar(pedidoId, valor)"] }),
  assoc("pol-notificar", "ext-email", "envia e-mail", { name: "NotificadorDeClientes", operations: ["enviar(clienteId, mensagem)"] }),
  assoc("calculo-frete", "ext-correios", "cota", { name: "TabelaDeFrete", operations: ["cotar(cep, peso)"] }),
  { op: "layout" },
];

const doc = createDoc("Pedidos com portas (inversão de dependência)", "domain");
const r = applyOps(doc, ops);
const failed = r.results.map((x, i) => ({ x, op: ops[i] })).filter((y) => !y.x.ok);
for (const f of failed) console.log(`✗ ${JSON.stringify(f.op).slice(0, 90)} → ${f.x.error}`);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(r.doc, null, 2));
console.log(`gravado: ${out} (${r.doc.nodes.length} componentes, ${r.doc.connections.length} conexões, ${r.doc.connections.filter((c) => c.port).length} porta(s), ${failed.length} falha(s))`);
