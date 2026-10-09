/**
 * Archflow Diagram Schema (archflow/1)
 *
 * Desenhado para ser lido e escrito por LLMs:
 *  - ids semânticos (slugs): "orders-api", não UUIDs
 *  - relações explícitas (`parent`, `from`/`to`) em vez de inferidas por geometria
 *  - vocabulário fechado para tipos de nós/conexões (ver CONNECTION_TYPES)
 *  - coordenadas são opcionais: o servidor/ app faz auto-layout
 */

export const SCHEMA_VERSION = "archflow/1";

export type NodeKind =
  | "service"
  | "client"
  | "actor"
  | "database"
  | "cache"
  | "queue"
  | "gateway"
  | "external"
  | "ai"
  | "infra"
  | "library"
  | "endpoint"
  | "system";

export const NODE_KINDS: Record<NodeKind, string> = {
  service: "Serviço / API / aplicação backend",
  client: "Cliente (web, mobile, desktop, CLI)",
  actor: "Pessoa ou papel que usa o sistema",
  database: "Banco de dados ou storage persistente",
  cache: "Cache / armazenamento em memória",
  queue: "Fila, broker ou stream de eventos",
  gateway: "API gateway, proxy, load balancer",
  external: "Sistema externo / SaaS de terceiros",
  ai: "Modelo ou serviço de IA",
  infra: "Infraestrutura, plataforma, CI/CD, observabilidade",
  library: "Biblioteca, framework ou linguagem",
  endpoint: "Ponto de comunicação de um serviço (endpoint REST, canal WebSocket, operação GraphQL, método gRPC, webhook, evento)",
  system: "Sistema descrito em OUTRO diagrama do cofre (referência, campo `ref`)",
};

export type GroupKind =
  | "boundary"
  | "layer"
  | "cloud"
  | "network"
  | "context"
  | "cluster"
  | "team";

export const GROUP_KINDS: Record<GroupKind, string> = {
  boundary: "Fronteira de sistema / container",
  layer: "Camada lógica (apresentação, domínio, dados)",
  cloud: "Provedor de nuvem / região",
  network: "Rede / VPC / subnet / zona de segurança",
  context: "Bounded context (DDD)",
  cluster: "Cluster / namespace / node pool",
  team: "Time ou dono do conjunto",
};

export type ConnectionType =
  | "sync"
  | "async"
  | "stream"
  | "data"
  | "dependency"
  | "inheritance"
  | "realization"
  | "composition"
  | "aggregation"
  | "association";

export interface ConnectionTypeInfo {
  label: string;
  /** Descrição curta para LLMs e tooltips */
  semantics: string;
  color: string;
  dash?: string;
  /** marcador no destino */
  head: "arrow" | "open" | "triangle" | "none";
  /** marcador na origem */
  tail: "diamond" | "diamond-open" | "none";
  /** animação visual */
  motion: "flow" | "pulse" | "stream" | "none";
}

export const CONNECTION_TYPES: Record<ConnectionType, ConnectionTypeInfo> = {
  sync: {
    label: "Síncrona",
    semantics: "Chamada request/response bloqueante (HTTP/REST, gRPC, GraphQL, RPC). Origem espera a resposta.",
    color: "var(--c-sync)",
    head: "arrow",
    tail: "none",
    motion: "flow",
  },
  async: {
    label: "Assíncrona",
    semantics: "Mensagem/evento fire-and-forget via fila ou broker (pub/sub, SQS, Kafka, webhooks). Origem não espera.",
    color: "var(--c-async)",
    dash: "7 6",
    head: "arrow",
    tail: "none",
    motion: "pulse",
  },
  stream: {
    label: "Streaming",
    semantics: "Fluxo contínuo de dados/eventos (WebSocket, SSE, Kafka stream, CDC, vídeo).",
    color: "var(--c-stream)",
    head: "arrow",
    tail: "none",
    motion: "stream",
  },
  data: {
    label: "Acesso a dados",
    semantics: "Leitura/escrita em banco, cache ou storage (SQL, query, get/put).",
    color: "var(--c-data)",
    head: "arrow",
    tail: "none",
    motion: "flow",
  },
  dependency: {
    label: "Dependência",
    semantics: "UML dependency: origem usa/depende do destino (import, SDK, uso temporário).",
    color: "var(--c-dep)",
    dash: "5 5",
    head: "open",
    tail: "none",
    motion: "none",
  },
  inheritance: {
    label: "Herança",
    semantics: "UML generalization: origem é um tipo especializado do destino (extends).",
    color: "var(--c-inh)",
    head: "triangle",
    tail: "none",
    motion: "none",
  },
  realization: {
    label: "Implementa",
    semantics: "UML realization: origem implementa a interface/contrato do destino (implements).",
    color: "var(--c-inh)",
    dash: "6 5",
    head: "triangle",
    tail: "none",
    motion: "none",
  },
  composition: {
    label: "Composição",
    semantics: "UML composition: origem contém o destino e controla seu ciclo de vida (parte-de forte).",
    color: "var(--c-comp)",
    head: "none",
    tail: "diamond",
    motion: "none",
  },
  aggregation: {
    label: "Agregação",
    semantics: "UML aggregation: origem agrega o destino, que pode existir independentemente.",
    color: "var(--c-comp)",
    head: "none",
    tail: "diamond-open",
    motion: "none",
  },
  association: {
    label: "Associação",
    semantics: "UML association: relação genérica sem direção de dependência definida.",
    color: "var(--c-dep)",
    head: "none",
    tail: "none",
    motion: "none",
  },
};

export const CONNECTION_TYPE_KEYS = Object.keys(CONNECTION_TYPES) as ConnectionType[];

export type InterfaceKind = "rest" | "graphql" | "grpc" | "event" | "sql" | "websocket" | "file" | "custom";

export interface InterfaceOperation {
  /** nome da operação: "createOrder", "order.created" */
  name: string;
  /** GET/POST/... ou SEND/PUBLISH/SUBSCRIBE, query/mutation, rpc */
  method?: string;
  /** path, tópico, fila, tabela */
  path?: string;
  /** descrição do payload de entrada (texto livre ou JSON schema resumido) */
  request?: string;
  /** descrição do payload de saída */
  response?: string;
  description?: string;
}

export interface InterfaceSpec {
  name: string;
  kind: InterfaceKind;
  /** link/ref para contrato formal (OpenAPI, AsyncAPI, .proto) */
  contract?: string;
  operations: InterfaceOperation[];
}

export interface IconRef {
  /** "l:aws-lambda" (iconify logos) | "s:laravel" (simple-icons) | "g:database" (glifo) | "t:PHP" (texto) | URL/data URI */
  value: string;
}

/* ───────── componentes de comunicação (endpoints) ───────── */

export type EndpointProtocol = "rest" | "graphql" | "websocket" | "grpc" | "webhook" | "sse" | "event";

export interface EndpointSpec {
  protocol: EndpointProtocol;
  /** REST: GET/POST/PUT/PATCH/DELETE · GraphQL: query/mutation/subscription · evento: PUBLISH/SUBSCRIBE */
  method?: string;
  /** REST/webhook/SSE/WebSocket: caminho · GraphQL: campo/operação · gRPC: Service/Método · evento: tópico */
  path?: string;
  request?: string;
  response?: string;
  auth?: string;
}

export const ENDPOINT_PROTOCOLS: Record<EndpointProtocol, { label: string; semantics: string; methods: string[] }> = {
  rest: { label: "REST", semantics: "Endpoint HTTP: método + caminho (GET /orders/{id}).", methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"] },
  graphql: { label: "GraphQL", semantics: "Operação de um schema GraphQL: query, mutation ou subscription.", methods: ["query", "mutation", "subscription"] },
  websocket: { label: "WebSocket", semantics: "Canal bidirecional persistente (ws://…); mensagens em ambos os sentidos.", methods: [] },
  grpc: { label: "gRPC", semantics: "Método RPC tipado (Service/Method) definido em .proto.", methods: ["unary", "server-stream", "client-stream", "bidi"] },
  webhook: { label: "Webhook", semantics: "URL que RECEBE chamadas de sistemas externos (push de eventos).", methods: ["POST", "GET", "PUT"] },
  sse: { label: "SSE", semantics: "Server-Sent Events: stream unidirecional servidor → cliente sobre HTTP.", methods: [] },
  event: { label: "Evento", semantics: "Tópico/fila que o serviço publica ou consome.", methods: ["PUBLISH", "SUBSCRIBE"] },
};

const METHOD_COLORS: Record<string, string> = { GET: "#14a38b", POST: "#2f80ed", PUT: "#e08a1e", PATCH: "#7a5af8", DELETE: "#d6453d", HEAD: "#7a7a8c", OPTIONS: "#7a7a8c" };
const PROTO_COLORS: Record<EndpointProtocol, string> = { rest: "#2f80ed", graphql: "#e10098", websocket: "#0ea5a5", grpc: "#3b6a7a", webhook: "#f97316", sse: "#0891b2", event: "#e08a1e" };

export function endpointBadge(e: EndpointSpec): string {
  switch (e.protocol) {
    case "rest":
      return (e.method ?? "GET").toUpperCase();
    case "webhook":
      return "HOOK";
    case "graphql":
      return ({ query: "QUERY", mutation: "MUT", subscription: "SUB" } as Record<string, string>)[(e.method ?? "query").toLowerCase()] ?? "GQL";
    case "websocket":
      return "WS";
    case "grpc":
      return "RPC";
    case "sse":
      return "SSE";
    case "event":
      return e.method === "SUBSCRIBE" ? "SUB" : "PUB";
  }
}
export function endpointColor(e: EndpointSpec): string {
  if (e.protocol === "rest" || e.protocol === "webhook") return METHOD_COLORS[(e.method ?? (e.protocol === "webhook" ? "POST" : "GET")).toUpperCase()] ?? PROTO_COLORS[e.protocol];
  return PROTO_COLORS[e.protocol];
}
export function endpointLabel(e: EndpointSpec): string {
  return `${endpointBadge(e)} ${e.path ?? ""}`.trim();
}

export interface Asset {
  id: string;
  name: string;
  category: string;
  vendor?: string;
  kind: NodeKind;
  /** valores padrão quando o asset é um componente de comunicação */
  endpoint?: EndpointSpec;
  icon: string;
  color: string;
  /** Qual problema a tecnologia resolve */
  problem: string;
  /** O que é / quando usar */
  description: string;
  tags: string[];
  builtin?: boolean;
}

interface Base {
  id: string;
  label: string;
  description?: string;
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface DiagramRef {
  /** caminho do diagrama relativo ao cofre, ex.: "pagamentos/checkout.archflow.json" */
  diagram: string;
  /** id de um componente dentro do diagrama referenciado */
  node?: string;
}

export interface NodeEl extends Base, Box {
  asset?: string;
  kind: NodeKind;
  /** tecnologia/stack em texto: "Laravel 11 / PHP 8.3" */
  technology?: string;
  /** id do grupo que contém este nó */
  parent?: string;
  /** ponto de comunicação (kind "endpoint") */
  endpoint?: EndpointSpec;
  /** id do serviço que EXPÕE este endpoint; ele é desenhado preso ao serviço */
  owner?: string;
  /** referência a outro diagrama do cofre (kind "system"), opcionalmente a um componente dele */
  ref?: DiagramRef;
  /** metadados livres chave→valor (porta, versão, SLA, ...) */
  props?: Record<string, string>;
}

export interface GroupEl extends Base, Box {
  kind: GroupKind;
  parent?: string;
  color?: string;
  /** true quando o tamanho deve ser recalculado a partir dos filhos */
  auto?: boolean;
}

export interface NoteEl {
  id: string;
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export type Routing = "curve" | "straight" | "elbow";

export interface ConnectionEl {
  id: string;
  from: string;
  to: string;
  type: ConnectionType;
  label?: string;
  /** "HTTPS/REST", "AMQP", "gRPC", "TCP/5432" */
  protocol?: string;
  description?: string;
  interface?: InterfaceSpec;
  routing?: Routing;
  /** pontos de passagem (coordenadas do mundo) que moldam o traçado; definidos arrastando a conexão na UI */
  waypoints?: { x: number; y: number }[];
  animated?: boolean;
}

export interface Doc {
  schema: typeof SCHEMA_VERSION;
  id: string;
  title: string;
  description?: string;
  groups: GroupEl[];
  nodes: NodeEl[];
  notes: NoteEl[];
  connections: ConnectionEl[];
  /** assets personalizados usados neste diagrama */
  customAssets: Asset[];
}

export const ENDPOINT_W = 200;
export const ENDPOINT_H = 44;
export const NODE_W = 184;
export const NODE_H = 72;

export function emptyDoc(title = "Novo diagrama"): Doc {
  return {
    schema: SCHEMA_VERSION,
    id: "diagram-" + Math.random().toString(36).slice(2, 8),
    title,
    description: "",
    groups: [],
    nodes: [],
    notes: [],
    connections: [],
    customAssets: [],
  };
}
