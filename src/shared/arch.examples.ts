/**
 * Exemplos do modo Architecture para a seção «Exemplos» do app: do mais simples (a loja online do primeiro uso) a um pipeline
 * de dados. Cada exemplo é uma lista de ops, a mesma linguagem que a UI e o MCP usam, então validam como qualquer diagrama.
 */
import { applyOps, type Op } from "./ops";
import { emptyDoc, type Doc } from "./schema";
import { starterDoc } from "./starter.example";

export interface ArchExample {
  id: string;
  title: string;
  level: "iniciante" | "intermediário" | "avançado";
  summary: string;
  /** o que o exemplo ensina a ler ou desenhar */
  teaches: string[];
  doc: () => Doc;
}

const build = (title: string, description: string, ops: Op[]): Doc => {
  const r = applyOps(emptyDoc(title, "architecture"), [...ops, { op: "layout" } as Op]);
  const bad = r.results.filter((x) => !x.ok);
  if (bad.length) throw new Error(`exemplo de arquitetura «${title}» inválido: ${JSON.stringify(bad)}`);
  r.doc.description = description;
  return r.doc;
};

const node = (id: string, asset: string, label: string, parent?: string, description?: string): Op => ({ op: "add_node", id, asset, label, ...(parent ? { parent } : {}), ...(description ? { description } : {}) });
const group = (id: string, label: string, kind: "cloud" | "network" | "cluster" | "layer" | "boundary" | "team", description?: string): Op => ({ op: "add_group", id, label, kind, ...(description ? { description } : {}) });
const link = (from: string, to: string, type: "sync" | "async" | "stream" | "data", label?: string, protocol?: string): Op => ({ op: "add_connection", from, to, type, ...(label ? { label } : {}), ...(protocol ? { protocol } : {}) });

/** API com fila: a resposta ao usuário não espera o envio do e-mail. */
const apiComFila = (): Doc =>
  build("API com fila e worker (exemplo)", "Uma API que grava no banco e entrega o trabalho lento (enviar e-mail) a uma fila, para o usuário não esperar. O cache absorve as leituras repetidas.", [
    group("nuvem", "Nuvem", "cloud", "Tudo que a equipe opera."),
    node("usuario", "user", "Cliente"),
    node("web", "web-app", "Aplicação web"),
    node("api", "nestjs", "API de pedidos", "nuvem", "Valida o pedido, grava e publica na fila."),
    node("banco", "postgresql", "Banco de pedidos", "nuvem"),
    node("cache", "redis", "Cache de catálogo", "nuvem"),
    node("fila", "aws-sqs", "Fila de e-mails", "nuvem"),
    node("worker", "service", "Worker de e-mails", "nuvem", "Lê a fila e envia, com nova tentativa se falhar."),
    node("email", "external", "Provedor de e-mail"),
    link("usuario", "web", "sync", "usa"),
    link("web", "api", "sync", "cria pedido", "HTTPS"),
    link("api", "banco", "data", "grava o pedido"),
    link("api", "cache", "data", "lê catálogo"),
    link("api", "fila", "async", "pedido criado"),
    link("fila", "worker", "async", "entrega a mensagem"),
    link("worker", "email", "sync", "envia", "SMTP"),
  ]);

/** Microsserviços: gateway na frente, um banco por serviço, eventos entre eles. */
const microsservicos = (): Doc =>
  build("Microsserviços com gateway e eventos (exemplo)", "Cada serviço tem o seu banco e conversa com os outros por eventos num barramento (Kafka); só o gateway recebe tráfego de fora. O pagamento usa um sistema externo.", [
    group("cluster", "Cluster Kubernetes", "cluster", "Os serviços rodam aqui, cada um com o seu deploy."),
    group("dados", "Dados", "layer", "Um banco por serviço: ninguém lê o banco do outro."),
    node("cliente", "user", "Cliente"),
    node("app", "web-app", "Aplicação web"),
    node("auth", "auth0", "Login (Auth0)"),
    node("gateway", "nginx", "API Gateway", "cluster", "Valida o token e roteia para o serviço certo."),
    node("pedidos", "service", "Serviço de pedidos", "cluster"),
    node("pagamentos", "service", "Serviço de pagamentos", "cluster"),
    node("estoque", "service", "Serviço de estoque", "cluster"),
    node("avisos", "service", "Serviço de avisos", "cluster"),
    node("bus", "kafka", "Eventos (Kafka)", "cluster"),
    node("db-pedidos", "postgresql", "Banco de pedidos", "dados"),
    node("db-pagamentos", "postgresql", "Banco de pagamentos", "dados"),
    node("db-estoque", "mongodb", "Banco de estoque", "dados"),
    node("stripe", "stripe", "Stripe"),
    link("cliente", "app", "sync", "usa"),
    link("app", "auth", "sync", "faz login", "OIDC"),
    link("app", "gateway", "sync", "chama a API", "HTTPS"),
    link("gateway", "pedidos", "sync", "/pedidos"),
    link("gateway", "estoque", "sync", "/estoque"),
    link("pedidos", "db-pedidos", "data"),
    link("pagamentos", "db-pagamentos", "data"),
    link("estoque", "db-estoque", "data"),
    link("pedidos", "bus", "async", "pedido criado"),
    link("bus", "pagamentos", "async", "cobrar"),
    link("pagamentos", "stripe", "sync", "cobra o cartão", "HTTPS"),
    link("pagamentos", "bus", "async", "pagamento aprovado"),
    link("bus", "estoque", "async", "reservar itens"),
    link("bus", "avisos", "async", "avisar o cliente"),
  ]);

/** Pipeline de dados: da origem ao painel, com o fluxo contínuo separado do que é guardado. */
const pipelineDeDados = (): Doc =>
  build("Pipeline de dados (exemplo)", "Eventos e dados do banco entram num fluxo contínuo (Kafka), um processador limpa e agrega, o resultado é guardado no data lake e carregado no data warehouse, onde as pessoas de análise montam os painéis.", [
    group("origem", "Origem", "layer", "Onde os dados nascem."),
    group("plataforma", "Plataforma de dados", "cloud", "Ingestão, processamento e armazenamento."),
    node("app", "web-app", "Aplicação", "origem", "Gera eventos de uso."),
    node("oltp", "postgresql", "Banco da aplicação", "origem"),
    node("kafka", "kafka", "Fluxo de eventos", "plataforma"),
    node("proc", "service", "Processamento (limpeza e agregação)", "plataforma", "Lê o fluxo, descarta lixo, junta por sessão e grava."),
    node("lake", "aws-s3", "Data lake (arquivos)", "plataforma", "Dado bruto e tratado, barato e durável."),
    node("dw", "gcp-bigquery", "Data warehouse", "plataforma", "Tabelas prontas para consulta."),
    node("painel", "grafana", "Painéis"),
    node("analista", "user", "Pessoa de análise"),
    link("app", "kafka", "stream", "eventos de uso"),
    link("oltp", "kafka", "stream", "mudanças do banco (CDC)"),
    link("kafka", "proc", "stream", "consome"),
    link("proc", "lake", "data", "grava arquivos"),
    link("lake", "dw", "data", "carga diária"),
    link("dw", "painel", "data", "consultas"),
    link("analista", "painel", "sync", "consulta"),
  ]);

export const ARCH_EXAMPLES: ArchExample[] = [
  {
    id: "loja-online",
    title: "Loja online",
    level: "iniciante",
    summary: "O primeiro diagrama: cliente, web, gateway, serviço de pedidos, banco, cache, fila e e-mail.",
    teaches: ["assets genéricos", "conexão síncrona, de dados e assíncrona"],
    doc: starterDoc,
  },
  {
    id: "api-com-fila",
    title: "API com fila e worker",
    level: "intermediário",
    summary: "A API grava e entrega o trabalho lento a uma fila; um worker envia o e-mail. O cache alivia o banco.",
    teaches: ["fila para desacoplar", "grupo de nuvem", "assets reais (NestJS, PostgreSQL, Redis, SQS)"],
    doc: apiComFila,
  },
  {
    id: "microsservicos",
    title: "Microsserviços com gateway e eventos",
    level: "avançado",
    summary: "Gateway na frente, um banco por serviço e eventos entre eles num barramento Kafka; pagamento por um sistema externo.",
    teaches: ["cluster e camada de dados", "banco por serviço", "eventos entre serviços", "login externo"],
    doc: microsservicos,
  },
  {
    id: "pipeline-de-dados",
    title: "Pipeline de dados",
    level: "avançado",
    summary: "Da aplicação ao painel: fluxo contínuo de eventos, processamento, data lake, data warehouse e painéis.",
    teaches: ["conexão de fluxo contínuo (stream)", "origem × plataforma", "armazenar bruto e tratado"],
    doc: pipelineDeDados,
  },
];
