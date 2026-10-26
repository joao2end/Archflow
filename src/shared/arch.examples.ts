/**
 * Exemplos do modo Architecture para a seção «Exemplos» do app: do mais simples (a loja online do primeiro uso) a um pipeline
 * de dados. Cada exemplo é uma lista de ops, a mesma linguagem que a UI e o MCP usam, então validam como qualquer diagrama.
 *
 * O diagrama de cada exemplo tem um id estável (`arch-<id>`): é por ele que o app reconhece o exemplo aberto e mostra a aula
 * dele (`example.lessons.ts`), inclusive quando a loja entra pelo botão «Ver exemplo pronto» do quadro vazio.
 */
import { applyOps, type Op } from "./ops";
import { emptyDoc, type Doc } from "./schema";

export interface ArchExample {
  id: string;
  title: string;
  level: "iniciante" | "intermediário" | "avançado";
  summary: string;
  /** o que o exemplo ensina a ler ou desenhar */
  teaches: string[];
  doc: () => Doc;
}

/** Id do diagrama de um exemplo de arquitetura. */
export const archDocId = (id: string) => `arch-${id}`;

const build = (id: string, title: string, description: string, ops: Op[]): Doc => {
  const r = applyOps(emptyDoc(title, "architecture"), [...ops, { op: "layout" } as Op]);
  const bad = r.results.filter((x) => !x.ok);
  if (bad.length) throw new Error(`exemplo de arquitetura «${title}» inválido: ${JSON.stringify(bad)}`);
  r.doc.id = archDocId(id);
  r.doc.description = description;
  return r.doc;
};

const node = (id: string, asset: string, label: string, parent?: string, description?: string): Op => ({ op: "add_node", id, asset, label, ...(parent ? { parent } : {}), ...(description ? { description } : {}) });
const group = (id: string, label: string, kind: "cloud" | "network" | "cluster" | "layer" | "boundary" | "team", description?: string): Op => ({ op: "add_group", id, label, kind, ...(description ? { description } : {}) });
const link = (from: string, to: string, type: "sync" | "async" | "stream" | "data", label?: string, protocol?: string): Op => ({ op: "add_connection", from, to, type, ...(label ? { label } : {}), ...(protocol ? { protocol } : {}) });

/** Loja online: o primeiro diagrama, só com assets genéricos e os três tipos básicos de conexão. */
export const lojaOnline = (): Doc =>
  build("loja-online", "Loja online (exemplo)", "Uma loja online pequena: o cliente usa a loja web, que chama a API pelo gateway; o serviço de pedidos grava no banco, lê o catálogo do cache e avisa o cliente por e-mail através de uma fila.", [
    node("cliente", "user", "Cliente", undefined, "Quem compra na loja."),
    node("loja-web", "web-app", "Loja web", undefined, "O site que o cliente usa no navegador."),
    node("gateway", "gateway", "API Gateway", undefined, "Porta de entrada única da API: autentica e encaminha."),
    node("pedidos", "service", "Serviço de pedidos", undefined, "Registra o pedido e avisa que ele foi criado."),
    node("banco", "database", "Banco de pedidos", undefined, "Onde os pedidos ficam guardados."),
    node("cache", "cache", "Cache de catálogo", undefined, "Cópia rápida do catálogo, para não ir ao banco a cada página."),
    node("fila", "queue", "Fila de eventos", undefined, "Guarda as mensagens até alguém processá-las."),
    node("email", "external", "Serviço de e-mail", undefined, "Sistema de fora que envia o e-mail ao cliente."),
    link("cliente", "loja-web", "sync", "usa"),
    link("loja-web", "gateway", "sync", "HTTPS"),
    link("gateway", "pedidos", "sync"),
    link("pedidos", "banco", "data", "grava"),
    link("pedidos", "cache", "data", "lê catálogo"),
    link("pedidos", "fila", "async", "pedido criado"),
    link("fila", "email", "async", "avisa o cliente"),
  ]);

/** API com fila: a resposta ao usuário não espera o envio do e-mail. */
const apiComFila = (): Doc =>
  build("api-com-fila", "API com fila e worker (exemplo)", "Uma API que grava no banco e entrega o trabalho lento (enviar e-mail) a uma fila, para o usuário não esperar. O cache absorve as leituras repetidas.", [
    group("nuvem", "Nuvem", "cloud", "Tudo que a equipe opera."),
    node("usuario", "user", "Cliente", undefined, "Quem faz o pedido."),
    node("web", "web-app", "Aplicação web", undefined, "A tela onde o cliente monta e envia o pedido."),
    node("api", "nestjs", "API de pedidos", "nuvem", "Valida o pedido, grava e publica na fila."),
    node("banco", "postgresql", "Banco de pedidos", "nuvem", "Guarda os pedidos; é a fonte da verdade."),
    node("cache", "redis", "Cache de catálogo", "nuvem", "Responde as leituras repetidas do catálogo sem ir ao banco."),
    node("fila", "aws-sqs", "Fila de e-mails", "nuvem", "Segura os e-mails a enviar até o worker pegar."),
    node("worker", "service", "Worker de e-mails", "nuvem", "Lê a fila e envia, com nova tentativa se falhar."),
    node("email", "external", "Provedor de e-mail", undefined, "Serviço de fora que entrega o e-mail."),
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
  build("microsservicos", "Microsserviços com gateway e eventos (exemplo)", "Cada serviço tem o seu banco e conversa com os outros por eventos num barramento (Kafka); só o gateway recebe tráfego de fora. O pagamento usa um sistema externo.", [
    group("cluster", "Cluster Kubernetes", "cluster", "Os serviços rodam aqui, cada um com o seu deploy."),
    group("dados", "Dados", "layer", "Um banco por serviço: ninguém lê o banco do outro."),
    node("cliente", "user", "Cliente", undefined, "Quem compra."),
    node("app", "web-app", "Aplicação web", undefined, "A loja no navegador."),
    node("auth", "auth0", "Login (Auth0)", undefined, "Sistema de login de fora: entrega o token que o gateway confere."),
    node("gateway", "nginx", "API Gateway", "cluster", "Valida o token e roteia para o serviço certo."),
    node("pedidos", "service", "Serviço de pedidos", "cluster", "Recebe o pedido, grava e publica «pedido criado»."),
    node("pagamentos", "service", "Serviço de pagamentos", "cluster", "Cobra pelo Stripe e publica o resultado."),
    node("estoque", "service", "Serviço de estoque", "cluster", "Reserva os itens quando o pagamento é aprovado."),
    node("avisos", "service", "Serviço de avisos", "cluster", "Avisa o cliente do andamento do pedido."),
    node("bus", "kafka", "Eventos (Kafka)", "cluster", "O barramento: quem publica não sabe quem consome."),
    node("db-pedidos", "postgresql", "Banco de pedidos", "dados", "Só o serviço de pedidos lê e escreve aqui."),
    node("db-pagamentos", "postgresql", "Banco de pagamentos", "dados", "Só o serviço de pagamentos lê e escreve aqui."),
    node("db-estoque", "mongodb", "Banco de estoque", "dados", "Só o serviço de estoque lê e escreve aqui; pode até ser de outra tecnologia."),
    node("stripe", "stripe", "Stripe", undefined, "Gateway de pagamento de fora."),
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
  build("pipeline-de-dados", "Pipeline de dados (exemplo)", "Eventos e dados do banco entram num fluxo contínuo (Kafka), um processador limpa e agrega, o resultado é guardado no data lake e carregado no data warehouse, onde as pessoas de análise montam os painéis.", [
    group("origem", "Origem", "layer", "Onde os dados nascem."),
    group("plataforma", "Plataforma de dados", "cloud", "Ingestão, processamento e armazenamento."),
    node("app", "web-app", "Aplicação", "origem", "Gera eventos de uso."),
    node("oltp", "postgresql", "Banco da aplicação", "origem", "O banco do dia a dia; cada mudança vira evento (CDC)."),
    node("kafka", "kafka", "Fluxo de eventos", "plataforma", "Recebe os eventos sem parar e os entrega a quem consome."),
    node("proc", "service", "Processamento (limpeza e agregação)", "plataforma", "Lê o fluxo, descarta lixo, junta por sessão e grava."),
    node("lake", "aws-s3", "Data lake (arquivos)", "plataforma", "Dado bruto e tratado, barato e durável."),
    node("dw", "gcp-bigquery", "Data warehouse", "plataforma", "Tabelas prontas para consulta."),
    node("painel", "grafana", "Painéis", undefined, "Gráficos montados sobre o data warehouse."),
    node("analista", "user", "Pessoa de análise", undefined, "Quem lê os painéis e toma decisões."),
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
    doc: lojaOnline,
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
