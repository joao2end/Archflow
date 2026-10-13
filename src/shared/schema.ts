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
  | "system"
  | "domain"
  | "logic";

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
  domain: "Elemento do modelo de domínio (DDD): o papel (aggregate-root, command, domain-event...) está em `ddd.role`. Só existe em diagramas de modo `domain`",
  logic: "Elemento da lógica de negócio: o papel (action, decision, input, output, variable, scenario…) está em `logic.role`. Só existe em diagramas de modo `logic`",
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


/* ───────── modo domínio (DDD) ───────── */

/** `architecture` (padrão) = infraestrutura e serviços · `domain` = modelo de domínio (DDD). */
export type DocMode = "architecture" | "domain" | "logic";

export const DOC_MODES: Record<DocMode, { label: string; hint: string }> = {
  architecture: { label: "Architecture", hint: "Arquitetura: serviços, bancos, filas, nuvem e rede." },
  domain: { label: "Domain", hint: "Domínio (DDD): bounded contexts, aggregates, commands, eventos e casos de uso." },
  logic: { label: "Logic", hint: "Lógica: regras de negócio em ordem, dados e exemplos que se verificam sozinhos." },
};

export const docMode = (doc: { mode?: DocMode }): DocMode => (doc.mode === "domain" ? "domain" : doc.mode === "logic" ? "logic" : "architecture");

export type DddRole =
  | "aggregate-root"
  | "entity"
  | "value-object"
  | "domain-event"
  | "command"
  | "policy"
  | "repository"
  | "domain-service"
  | "application-service"
  | "use-case"
  | "read-model"
  | "process-manager";

/** Uma propriedade (campo) de entity, value object, aggregate, command, evento ou read model: explica a estrutura do modelo. */
export interface PropertySpec {
  name: string;
  /** tipo em texto livre: "uuid", "Dinheiro", "texto", "Item[]" */
  type?: string;
  /** o campo pode faltar (por padrão é obrigatório) */
  optional?: boolean;
  /** identificador (identidade) do elemento */
  key?: boolean;
  /** o que o campo significa e por que existe */
  description?: string;
  /** valor de exemplo */
  example?: string;
}

/** Campos próprios de um papel, todos textuais/ids para uma LLM ler e escrever sem ambiguidade. */
export interface DddNodeSpec {
  role: DddRole;
  /** command, policy, domain-service, application-service: o que faz, em uma frase */
  intent?: string;
  /** aggregate-root, entity, value-object, command: regras que sempre valem */
  invariants?: string[];
  /** domain-event: dados que o evento carrega */
  /** domain-event (legado): resumo em texto livre dos dados; só vale quando não há `properties` (se houver, `properties` vence) */
  payload?: string;
  /** aggregate-root, entity, value-object, command, domain-event, read-model: campos (nome, tipo, descrição) que explicam a estrutura */
  properties?: PropertySpec[];
  /** domain-event: id do command, aggregate-root ou process-manager que o produz */
  producedBy?: string;
  /** domain-event: "contexto.evento" quando é a cópia local de um evento publicado por outro contexto */
  external?: string;
  /** repository: id do aggregate-root que ele persiste */
  for?: string;
  /** use-case: papel/pessoa que executa */
  actor?: string;
  /** use-case: objetivo de negócio */
  goal?: string;
  /** use-case: ids dos commands (ou serviços) que o realizam */
  realizedBy?: string[];
  /** policy, process-manager: ids dos eventos a que reage */
  reactsTo?: string[];
  /** policy, process-manager: ids dos commands que dispara */
  issues?: string[];
  /** process-manager: ids dos commands de compensação */
  compensates?: string[];
  /** read-model: ids dos eventos que o alimentam */
  projectsFrom?: string[];
  /** command: posição na linha do tempo; ordena os commands no auto_layout `timeline` (o evento fica na coluna de quem o produz). Em domain-event é legado: o arquivo abre, mas não tem efeito */
  step?: number;
}
export type DddField = Exclude<keyof DddNodeSpec, "role">;

export const DDD_ROLES: Record<DddRole, { label: string; hint: string; color: string; fields: DddField[] }> = {
  "aggregate-root": { label: "Aggregate Root", hint: "Ponto de entrada do aggregate: garante as invariantes do conjunto e é a única parte acessada de fora.", color: "#e0a526", fields: ["invariants", "properties"] },
  entity: { label: "Entity", hint: "Objeto com identidade própria dentro de um aggregate.", color: "#d9822b", fields: ["invariants", "properties"] },
  "value-object": { label: "Value Object", hint: "Valor imutável sem identidade, comparado pelo conteúdo (ex.: dinheiro, endereço).", color: "#b8860b", fields: ["invariants", "properties"] },
  "domain-event": { label: "Domain Event", hint: "Fato de negócio que já aconteceu, nomeado no passado (ex.: pedido-criado).", color: "#f2994a", fields: ["payload", "properties", "producedBy", "external"] },
  command: { label: "Command", hint: "Intenção de mudar o estado, nomeada no imperativo (ex.: criar-pedido).", color: "#3b9ddd", fields: ["intent", "properties", "invariants", "step"] },
  policy: { label: "Policy", hint: "Regra sem estado: quando um evento acontece, dispara um command.", color: "#9b6bd6", fields: ["intent", "reactsTo", "issues"] },
  repository: { label: "Repository", hint: "Coleção persistente de um aggregate-root; a interface fica no domínio.", color: "#2f9e8f", fields: ["for"] },
  "domain-service": { label: "Domain Service", hint: "Regra de negócio que não cabe em um aggregate; pura, sem I/O: recebe os dados prontos de quem o chama (command ou application-service) e não busca em repository (ligar a um repository é aceito, mas gera a dica D033).", color: "#5b8def", fields: ["intent"] },
  "application-service": { label: "Application Service", hint: "Orquestra um caso de uso (carrega, chama o domínio, persiste e entrega ao publicador os eventos que o domínio produziu); sem regra de negócio e sem emitir eventos.", color: "#6c7a89", fields: ["intent"] },
  "use-case": { label: "Use Case", hint: "Objetivo de um ator com o sistema; liga o requisito ao command que o realiza.", color: "#4caf7d", fields: ["actor", "goal", "realizedBy"] },
  "read-model": { label: "Read Model", hint: "Projeção otimizada para consulta (CQRS), alimentada por eventos.", color: "#7fb3d5", fields: ["properties", "projectsFrom"] },
  "process-manager": { label: "Process Manager", hint: "Saga: coordena um fluxo longo reagindo a eventos e disparando commands, com compensação.", color: "#c2548b", fields: ["intent", "reactsTo", "issues", "compensates"] },
};
export const DDD_ROLE_KEYS = Object.keys(DDD_ROLES) as DddRole[];
/** Selo curto exibido no canvas e no catálogo (como GET/POST nos endpoints). */
export const DDD_BADGES: Record<DddRole, string> = {
  "aggregate-root": "AGG",
  entity: "ENT",
  "value-object": "VO",
  "domain-event": "EVT",
  command: "CMD",
  policy: "POL",
  repository: "REPO",
  "domain-service": "DS",
  "application-service": "APP",
  "use-case": "UC",
  "read-model": "READ",
  "process-manager": "SAGA",
};

/* ───────── modo lógica (regras de negócio) ───────── */

export type LogicRole = "rule" | "input" | "output" | "variable" | "scenario" | "start" | "end" | "decision" | "switch" | "loop" | "fork" | "join" | "call";

/** Papéis de dado: Input (entra e só é lido), Output (resultado que o fluxo devolve) e Variable (dado intermediário do fluxo). Substituem o antigo `fact`. */
export const DATA_ROLES = ["input", "output", "variable"] as const;
export type DataRole = (typeof DATA_ROLES)[number];
export const isDataRole = (role: string | undefined): role is DataRole => role === "input" || role === "output" || role === "variable";

/** Valor JSON simples usado em dados e exemplos. */
export type LogicValue = string | number | boolean | null | LogicValue[] | { [campo: string]: LogicValue };

/** Um caso concreto: dados de entrada e o que deve valer depois. Fica ao lado da regra e é verificado pelo app. */
export interface LogicExample {
  name: string;
  given: Record<string, LogicValue>;
  /** dados esperados depois. Em decisão/escolha, a chave especial "caminho" confere por onde o fluxo sai ("sim", "nao", valor do caso, "outros") */
  expect: Record<string, LogicValue>;
  /** cenário: o caminho gravado, os ids dos passos na ordem em que o fluxo os percorre. Se o fluxo passar a andar por outro caminho, o exemplo falha */
  path?: string[];
}

export interface LogicNodeSpec {
  role: LogicRole;
  /** rule: posição na fila quando o diagrama não tem setas: crescente (1, 2, 3…); sem `order` vai para o fim; empate: ordem de criação. Com setas, o fluxo manda e `order` é ignorado */
  order?: number;
  /** todos os papéis: o que é, em uma frase de negócio (na decisão, a pergunta) */
  text?: string;
  /** decision: a condição (vale = seta "sim"; não vale = "não"). Na rule é legado: arquivos antigos têm a guarda convertida em uma decision ao abrir */
  when?: string;
  /** rule: efeitos em ordem: "preco := ..." , "travar preco" e "destravar preco" */
  then?: string[];
  /** switch: expressão cujo valor escolhe o caminho (cada seta leva o valor do caso). Sem `on`, cada seta leva uma CONDIÇÃO (faixa) e vale a primeira verdadeira, na ordem das setas */
  on?: string;
  /** loop: condição de parada, conferida antes de cada volta (se já vale ao chegar, não há volta nenhuma) */
  until?: string;
  /** call: condição (verdadeiro/falso) calculada com os dados que o fluxo tem naquele ponto; se vale, o exemplo simula a chamada FALHANDO e o fluxo segue pela seta \"erro\" (sem a seta, é erro de execução). Sem `falha`, a chamada nunca falha na simulação */
  falha?: string;
  /** call: efeitos que rodam quando a chamada DÁ CERTO (os dados que ela devolve), ex.: [\"cidade := cidade_do_servico\"] */
  devolve?: string[];
  /** loop: no máximo N voltas (1 a 1000; sem padrão). Vale junto com `until` e `foreach`: para na primeira que acontecer */
  max?: number;
  /** loop: "para cada" item de uma lista (expressão que devolve a lista) */
  foreach?: string;
  /** loop com foreach: nome do item em cada volta (padrão "item") */
  as?: string;
  /** end: desfecho do fluxo ("ok" ou "erro"; sem informar, é "ok"). No cenário, `expect.desfecho` confere o desfecho do fim alcançado */
  outcome?: "ok" | "erro";
  /** rule, decision, switch: exemplos verificáveis · scenario: exemplos da fila inteira */
  examples?: LogicExample[];
  /** input/output/variable: nome usado nas expressões (letras, números, `_` e pontos): "preco_atual" */
  key?: string;
  /** input/output/variable: tipo na sintaxe do TypeScript (`number`, `int`, `string[]`, `{ preco: number }[]`, `\"a\" | \"b\"`); rótulos antigos ("dinheiro") valem só como texto e não são conferidos */
  type?: string;
  /** input/variable: valor fixo (constante) usado quando o exemplo não informa (na variável, é o valor inicial) */
  value?: LogicValue;
}
export type LogicField = Exclude<keyof LogicNodeSpec, "role">;

export const LOGIC_ROLES: Record<LogicRole, { label: string; hint: string; color: string; badge: string; fields: LogicField[] }> = {
  start: { label: "Start", hint: "Início do fluxo: o que entra e quando a lógica começa (um por diagrama).", color: "#3aa76d", badge: "START", fields: ["text"] },
  end: { label: "End", hint: "Fim do fluxo: o que a lógica devolve. O desfecho (`outcome`) é ok ou erro e, se você não informar, é ok; pode haver vários fins.", color: "#8a6fd0", badge: "END", fields: ["text", "outcome"] },
  rule: { label: "Ação", hint: "Ação: muda dados (ex.: frete := 0), com exemplos que provam. Roda sempre que o fluxo chega nela. Não tem condição, nem «se … entao … senao» dentro dos efeitos: quem escolhe o caminho ou o valor é a Decisão, colocada antes dela (sim → uma ação com um valor, não → outra com o outro).", color: "#706fd3", badge: "AÇÃO", fields: ["order", "text", "then", "examples"] },
  decision: { label: "Decisão", hint: "Decisão sim/não: só pergunta e escolhe por qual das duas setas o fluxo sai, \"sim\" ou \"não\" (quem muda dados é a Ação).", color: "#0e9aa7", badge: "IF", fields: ["text", "when", "examples"] },
  switch: { label: "Switch", hint: "Escolha entre vários caminhos. Com `on`, pelo valor de uma expressão (uma seta por valor). Sem `on`, por condições, como faixas: cada seta leva a sua condição (no `case` da seta) e vale a primeira verdadeira, na ordem em que as setas foram criadas (faixas que se sobrepõem: ganha a mais antiga). Sempre com uma seta \"outros\" para o resto.", color: "#0e9aa7", badge: "SWITCH", fields: ["text", "on", "examples"] },
  loop: { label: "Loop", hint: "Repetição: confere a parada antes de cada volta (pode dar zero voltas) e sai pela seta \"segue\" assim que vale a primeira: a condição `until` ficou verdadeira, já foram `max` voltas ou acabaram os itens do `foreach`; senão volta pela seta \"repete\". Precisa de pelo menos um dos três.", color: "#c2548b", badge: "LOOP", fields: ["text", "until", "max", "foreach", "as"] },
  fork: { label: "Fork", hint: "Paralelo: o fluxo se divide e segue por todas as setas de saída; os ramos são independentes entre si (um não escreve um dado que outro escreve ou lê). O app os simula na ordem das setas, sobre os mesmos dados.", color: "#e0a526", badge: "FORK", fields: ["text"] },
  join: { label: "Join", hint: "Junção: espera todos os caminhos paralelos chegarem antes de seguir.", color: "#e0a526", badge: "JOIN", fields: ["text"] },
  call: { label: "Call", hint: "Chamada a algo de fora (gateway, API, outro diagrama) que pode falhar. Com `falha` (uma condição verdadeiro/falso, calculada com os dados que o fluxo tem ali), o exemplo simula a falha e o fluxo segue pela seta \"erro\" (sem essa seta é erro de execução); sem `falha`, a chamada nunca falha na simulação e segue pela seta normal. Com `devolve` (efeitos como os da Ação), a chamada que dá certo escreve os dados que devolveu. A simulação não entra no que está fora.", color: "#6c7a89", badge: "CALL", fields: ["text", "falha", "devolve"] },
  input: { label: "Input", hint: "Dado que ENTRA no fluxo e só é lido (preço atual, margem, tipo da categoria). Nenhuma ação o escreve; o valor vem do `given` do exemplo ou do `value` (constante). O `key` é o nome usado nas expressões; o `type` é um tipo do TypeScript (number, int, string[], { preco: number }…) que o app confere nos exemplos.", color: "#7fb3d5", badge: "IN", fields: ["key", "type", "text", "value"] },
  output: { label: "Output", hint: "Resultado que o fluxo DEVOLVE (recomendação, preço final, alerta). Alguma ação precisa escrevê-lo; é o que os cenários conferem em `expect`. O `key` é o nome nas expressões e o `type` é um tipo do TypeScript.", color: "#4caf7d", badge: "OUT", fields: ["key", "type", "text"] },
  variable: { label: "Variable", hint: "Dado INTERMEDIÁRIO: criado e reescrito dentro do fluxo para calcular outra coisa (soma parcial, contador, índice). Não entra de fora nem é o resultado final. O `value` é o valor inicial.", color: "#a58fd6", badge: "VAR", fields: ["key", "type", "text", "value"] },
  scenario: { label: "Scenario", hint: "Cenário completo: roda o fluxo inteiro com os dados do exemplo e confere o resultado final.", color: "#4caf7d", badge: "TESTE", fields: ["text", "examples"] },
};
export const LOGIC_ROLE_KEYS = Object.keys(LOGIC_ROLES) as LogicRole[];

/** Saídas de decisão, escolha e laço. */
export type LogicBranch = "sim" | "nao" | "repete" | "segue" | "outros" | "erro";
export const LOGIC_BRANCHES: Record<LogicBranch, { label: string; hint: string; from: LogicRole[] }> = {
  sim: { label: "sim", hint: "Seta da decisão quando a condição vale.", from: ["decision"] },
  nao: { label: "não", hint: "Seta da decisão quando a condição não vale.", from: ["decision"] },
  repete: { label: "repete", hint: "Seta do laço que volta ao início do corpo da repetição.", from: ["loop"] },
  segue: { label: "segue", hint: "Seta do laço quando termina e o fluxo continua.", from: ["loop"] },
  outros: { label: "outros", hint: "Seta da escolha para qualquer valor que nenhum caso cobre.", from: ["switch"] },
  erro: { label: "erro", hint: "Seta da chamada (Call) quando ela falha. A seta sem saída nomeada é o caminho em que deu certo.", from: ["call"] },
};
export const LOGIC_BRANCH_KEYS = Object.keys(LOGIC_BRANCHES) as LogicBranch[];

/** Semântica de uma seta do fluxo: por qual saída ela sai. */
export interface LogicConnSpec {
  branch?: LogicBranch;
  /** switch com `on`: valor deste caso (expressão literal: "lucro", 3, verdadeiro). Switch sem `on`: a CONDIÇÃO desta faixa (ex.: total <= 100); vale a primeira verdadeira, na ordem em que as setas foram criadas */
  case?: string;
}

export type Subdomain = "core" | "supporting" | "generic";
export const SUBDOMAINS: Record<Subdomain, string> = {
  core: "Diferencial competitivo do negócio; onde vale investir no melhor modelo.",
  supporting: "Necessário ao negócio, mas sem diferencial; costuma ser feito sob medida e simples.",
  generic: "Problema comum e resolvido no mercado (auth, e-mail, pagamento); prefira comprar ou usar pronto.",
};

export type DddRel = "emits" | "triggers" | "contains" | "references-by-id" | "realizes" | "uses" | "context-relation";
export const DDD_RELS: Record<DddRel, { label: string; semantics: string; type: ConnectionType }> = {
  emits: { label: "emits", semantics: "command, aggregate-root ou process-manager → domain-event: produz o fato.", type: "async" },
  triggers: { label: "triggers", semantics: "causa: domain-event → policy/process-manager/read-model, policy → command, command → aggregate-root.", type: "dependency" },
  contains: { label: "contains", semantics: "aggregate-root/entity → entity/value-object: parte do mesmo aggregate (ciclo de vida compartilhado).", type: "composition" },
  "references-by-id": { label: "references-by-id", semantics: "aggregate-root/entity → aggregate-root de OUTRO aggregate: referência só por identificador, nunca por objeto.", type: "association" },
  realizes: { label: "realizes", semantics: "command (ou serviço) → use-case: quem concretiza o caso de uso.", type: "realization" },
  uses: { label: "uses", semantics: "dependência de serviço: command, policy, process-manager ou application-service → domain-service ou repository (quem orquestra usa; o aggregate nunca depende de repository). Um domain-service pode usar outro domain-service; usar um repository é aceito, mas ele deveria ser puro (dica D033).", type: "dependency" },
  "context-relation": { label: "context-relation", semantics: "bounded context ↔ bounded context, com `pattern` do Context Map. Nos padrões assimétricos (customer-supplier, conformist, acl, ohs) `from` é o upstream (fornecedor) e `to` o downstream (cliente). Nos demais (shared-kernel, partnership, published-language, separate-ways) a ordem não muda o sentido.", type: "association" },
};
export const DDD_REL_KEYS = Object.keys(DDD_RELS) as DddRel[];

/** Ponta de uma relação: o papel do elemento, ou "context" (grupo context ou componente system com ref). */
export type RelEnd = DddRole | "context";
/**
 * Quem pode ligar a quem em cada relação (fonte única: validação D021, inferência da relação ao conectar, seletor do inspetor e guia da IA).
 * Cada par vale por si: `from` ∈ lista da esquerda E `to` ∈ lista da direita.
 */
export const DDD_REL_PAIRS: Record<DddRel, { from: RelEnd[]; to: RelEnd[] }[]> = {
  emits: [{ from: ["command", "aggregate-root", "process-manager"], to: ["domain-event"] }],
  triggers: [
    { from: ["command"], to: ["aggregate-root"] },
    { from: ["domain-event"], to: ["policy", "process-manager", "read-model"] },
    { from: ["policy", "process-manager"], to: ["command"] },
  ],
  contains: [{ from: ["aggregate-root", "entity"], to: ["entity", "value-object"] }],
  "references-by-id": [{ from: ["aggregate-root", "entity"], to: ["aggregate-root"] }],
  realizes: [{ from: ["command", "domain-service", "application-service"], to: ["use-case"] }],
  uses: [{ from: ["command", "policy", "process-manager", "application-service", "domain-service"], to: ["domain-service", "repository"] }],
  "context-relation": [{ from: ["context"], to: ["context"] }],
};
/** Tipos de conexão de infraestrutura: não existem no modo domain (o tipo vem da relação de domínio). */
export const INFRA_CONNECTION_TYPES: ConnectionType[] = ["sync", "async", "stream", "data"];

export type ContextPattern = "shared-kernel" | "customer-supplier" | "conformist" | "acl" | "ohs" | "published-language" | "partnership" | "separate-ways";
export const CONTEXT_PATTERNS: Record<ContextPattern, { label: string; hint: string }> = {
  "shared-kernel": { label: "Shared Kernel", hint: "Os contextos compartilham um subconjunto do modelo e mudam juntos." },
  "customer-supplier": { label: "Customer/Supplier", hint: "Fornecedor (upstream) atende o cliente (downstream), que influencia o plano." },
  conformist: { label: "Conformist", hint: "O downstream adota o modelo do upstream sem negociar." },
  acl: { label: "Anticorruption Layer", hint: "O downstream traduz o modelo do upstream para proteger o próprio." },
  ohs: { label: "Open Host Service", hint: "O upstream expõe um serviço aberto e estável para vários consumidores." },
  "published-language": { label: "Published Language", hint: "Linguagem de troca documentada e compartilhada (ex.: JSON schema, AsyncAPI)." },
  partnership: { label: "Partnership", hint: "Dois contextos evoluem juntos e coordenam entregas." },
  "separate-ways": { label: "Separate Ways", hint: "Sem integração: cada contexto resolve sozinho." },
};
export const CONTEXT_PATTERN_KEYS = Object.keys(CONTEXT_PATTERNS) as ContextPattern[];

/** Relações que carregam fluxo: só nelas valem condição, ramo padrão, loop e iteração. */
export const FLOW_RELS: DddRel[] = ["triggers", "emits"];

export interface DddConnSpec {
  rel: DddRel;
  /** só com rel "context-relation" */
  pattern?: ContextPattern;
  /** fluxo (triggers, emits): o ramo só segue se a condição valer ("atraso > 0") */
  condition?: string;
  /** fluxo: ramo padrão ("senão"), usado quando nenhuma condição dos irmãos vale; exclui `condition` */
  otherwise?: boolean;
  /** fluxo: esta conexão VOLTA a um passo anterior e repete até a condição de parada e/ou no máximo `max` vezes */
  loop?: { until?: string; max?: number };
  /** fluxo: repete para cada elemento ("item do pedido") */
  foreach?: string;
}

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
  /** valores padrão quando o asset é um papel de domínio (DDD); só entra em diagramas de modo domain */
  ddd?: DddNodeSpec;
  /** valores padrão quando o asset é um papel de lógica; só entra em diagramas de modo logic */
  logic?: LogicNodeSpec;
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
  /** cor de fundo do corpo (hex); undefined = padrão do tema */
  fill?: string;
  /** opacidade do fundo, 0–1 (padrão 1) */
  fillOpacity?: number;
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
  /** modelo de domínio (kind "domain"): papel DDD e campos do papel */
  ddd?: DddNodeSpec;
  /** lógica de negócio (kind "logic"): papel e campos do papel */
  logic?: LogicNodeSpec;
}

export interface GroupEl extends Base, Box {
  kind: GroupKind;
  parent?: string;
  color?: string;
  /** true quando o tamanho deve ser recalculado a partir dos filhos */
  auto?: boolean;
  /** só em grupos kind "context": classificação estratégica do subdomínio */
  subdomain?: Subdomain;
  /** legenda curta no topo do grupo, no lugar do tipo (ex.: DADOS) */
  tag?: string;
}

export type NoteVariant = "note" | "text" | "list";

/** Traço à mão livre (caneta / marca-texto), em coordenadas do quadro. */
export interface InkStroke {
  id: string;
  kind: "pen" | "highlight";
  color: string;
  width: number;
  /** traçado: contínuo (padrão), tracejado ou pontilhado */
  dash?: "solid" | "dashed" | "dotted";
  /** opacidade 0–1 (padrão: 1 caneta, 0.38 marca-texto) */
  opacity?: number;
  pts: { x: number; y: number }[];
}

export interface NoteEl {
  id: string;
  /** "note" = post-it · "text" = texto solto · "list" = lista (uma linha por item; "[ ]" / "[x]" viram caixas) */
  variant?: NoteVariant;
  color?: string;
  /** lista: título exibido no topo */
  title?: string;
  /** lista: true = mostra só o cabeçalho (retraída) */
  collapsed?: boolean;
  /** lista/checklist: texto de apoio sob o título */
  subtitle?: string;
  /** lista: true = todos os itens são tarefas com caixa de seleção (estado em "[x]" / "[ ]" no início da linha) */
  checklist?: boolean;
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
  /** posição do rótulo ao longo do traçado (0–1, por comprimento de arco); o auto-layout a escolhe para não sobrepor nada */
  labelT?: number;
  /** deslocamento do rótulo perpendicular ao traçado, em px (negativo = outro lado) */
  labelOffset?: number;
  animated?: boolean;
  /** semântica de domínio (modo domain): relação DDD e, entre contextos, o padrão do Context Map */
  ddd?: DddConnSpec;
  /** semântica de fluxo (modo logic): por qual saída da decisão, escolha ou laço a seta sai */
  logic?: LogicConnSpec;
}

export interface Doc {
  schema: typeof SCHEMA_VERSION;
  id: string;
  title: string;
  description?: string;
  /** ausente = "architecture" (diagramas anteriores ao modo domínio continuam válidos) */
  mode?: DocMode;
  groups: GroupEl[];
  nodes: NodeEl[];
  notes: NoteEl[];
  connections: ConnectionEl[];
  /** desenhos à mão livre */
  ink?: InkStroke[];
  /** assets personalizados usados neste diagrama */
  customAssets: Asset[];
}

export const ENDPOINT_W = 200;
export const ENDPOINT_H = 44;
export const NODE_W = 184;
export const NODE_H = 72;

export function emptyDoc(title = "Novo diagrama", mode: DocMode = "architecture"): Doc {
  return {
    schema: SCHEMA_VERSION,
    id: "diagram-" + Math.random().toString(36).slice(2, 8),
    title,
    description: "",
    ...(mode === "domain" || mode === "logic" ? { mode } : {}),
    groups: [],
    nodes: [],
    notes: [],
    connections: [],
    customAssets: [],
  };
}
