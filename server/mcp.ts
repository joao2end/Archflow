/**
 * Archflow MCP server (stdio). Expõe ferramentas semânticas sobre o bridge do app.
 *
 *  - App instalado (exe):  Archflow.exe --mcp          (empacotado em resources/mcp/archflow-mcp.mjs)
 *  - Desenvolvimento:      npx tsx server/mcp.ts
 *
 * No exe, o servidor abre o app Archflow se ele ainda não estiver rodando e conversa com o bridge dele;
 * em dev (ou se o app não abrir) sobe o próprio bridge.
 */
import { spawn } from "node:child_process";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { DEFAULT_PORT, ensureBridge } from "./bridge";
import { BUILTIN_ASSETS, assetsForMode, searchAssets } from "../src/shared/catalog";
import { CONNECTION_TYPE_KEYS, CONTEXT_PATTERN_KEYS, DDD_REL_KEYS, DDD_ROLE_KEYS, DDD_ROLES, SUBDOMAINS, docMode, type Doc, type DocMode } from "../src/shared/schema";
import { describe, schemaGuide, toMermaid, useCaseOps, validate, type Op } from "../src/shared/ops";
import { domainOverview, traceUseCase, type VaultDomainFile } from "../src/shared/domain";
import { CODEGEN_LANGUAGES, filesToMarkdown, generateCode, type CodegenLanguage } from "../src/shared/codegen";
import { SKILL_MD } from "../src/shared/skill.generated";

const BASE = `http://127.0.0.1:${DEFAULT_PORT}`;

const bridgeUp = () =>
  fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(800) })
    .then((r) => r.ok)
    .catch(() => false);

/** Dentro do exe (Electron em modo node) abre o app e espera o bridge; senão, hospeda o bridge aqui. */
async function connectBridge() {
  if (await bridgeUp()) return;
  if (process.versions.electron && process.env.ARCHFLOW_NO_APP !== "1") {
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    spawn(process.execPath, [], { detached: true, stdio: "ignore", env }).unref();
    for (let i = 0; i < 60; i++) {
      if (await bridgeUp()) return;
      await new Promise((r) => setTimeout(r, 500));
    }
    console.error("[mcp] o app Archflow não respondeu em 30s — hospedando o bridge neste processo");
  }
  await ensureBridge();
}
await connectBridge();

type Result = { ok: boolean; id?: string; error?: string };

async function api<T = any>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(BASE + path, { headers: { "Content-Type": "application/json" }, ...init });
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return (r.headers.get("content-type")?.includes("json") ? r.json() : r.text()) as Promise<T>;
}
const getDoc = async () => (await api<{ doc: Doc; rev: number }>("/api/doc")).doc;
/** Todos os diagramas do cofre (caminho + conteúdo): base da visão geral e da checagem de referências. */
const vaultFiles = async () => (await api<{ files: VaultDomainFile[] }>("/api/vault/docs")).files;
const existsIn = (files: VaultDomainFile[]) => {
  const paths = new Set(files.map((f) => f.path));
  return (p: string) => paths.has(p);
};
const ops = (list: Op[]) =>
  api<{ rev: number; results: Result[] }>("/api/ops", { method: "POST", body: JSON.stringify({ ops: list, source: "mcp" }) });
const text = (t: string, isError = false) => ({ content: [{ type: "text" as const, text: t }], isError });
const report = (results: Result[]) => {
  const bad = results.filter((r) => !r.ok);
  return text(
    [`ok: ${results.length - bad.length}/${results.length}`, ...results.map((r, i) => (r.ok ? `#${i} ✓ ${r.id ?? ""}` : `#${i} ✗ ${r.error}`))].join("\n"),
    bad.length === results.length && bad.length > 0,
  );
};

const server = new McpServer(
  { name: "archflow", version: "0.1.0" },
  {
    instructions:
      "Archflow é um quadro branco de arquitetura de software que o usuário vê em tempo real. Trabalhe com componentes, grupos e conexões (nunca pixels). " +
      "Fluxo: get_diagram → list_assets/search_assets (prefira assets do catálogo) → add_groups → add_components → add_endpoints → connect → auto_layout → validate_diagram. " +
      "Diagramas têm modo: `architecture` (padrão) ou `domain` (DDD: contextos, aggregates, commands, eventos, casos de uso) ou `logic` (regras de negócio em ordem, dados e exemplos verificáveis; chame get_schema_guide antes). No modo domain chame get_schema_guide antes: o vocabulário é outro (kind domain + ddd.role) e use add_use_cases, trace e domain_overview. " +
      "No modo architecture, `set_presentation` define a ordem dos slides (responsabilidades, conexões, interfaces e notas). " +
      "Leia o resource archflow://skill (ou get_schema_guide) para o guia completo. Nunca use clear_diagram sem pedido explícito.",
  },
);

const ifaceSchema = z.object({
  name: z.string(),
  kind: z.enum(["rest", "graphql", "grpc", "event", "sql", "websocket", "file", "custom"]),
  contract: z.string().optional().describe("link/ref para OpenAPI, AsyncAPI ou .proto"),
  operations: z.array(
    z.object({
      name: z.string(),
      method: z.string().optional(),
      path: z.string().optional(),
      request: z.string().optional(),
      response: z.string().optional(),
      description: z.string().optional(),
    }),
  ),
});

const modeEnum = z.enum(["architecture", "domain", "logic"]);
const logicValue: z.ZodType = z.lazy(() => z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(logicValue), z.record(z.string(), logicValue)]));
const logicNodeSchema = z
  .object({
    role: z.enum(["start", "end", "action", "rule", "decision", "switch", "loop", "fork", "join", "call", "code", "input", "output", "variable", "scenario"]),
    on: z.string().optional().describe("switch: expressão que escolhe o caminho"),
    until: z.string().optional().describe("loop: condição de parada"),
    max: z.number().int().min(1).max(1000).optional().describe("loop: no máximo N voltas"),
    foreach: z.string().optional().describe("loop: expressão que devolve a lista"),
    devolve: z.array(z.string()).optional().describe("call: efeitos que rodam quando a chamada dá certo (os dados que ela devolve), ex.: [\"cidade := cidade_do_servico\"]"),
    request: z
      .object({
        method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
        url: z.string().describe('expressão com o endereço; texto fixo leva aspas: "https://api.exemplo.com/clientes/" + cliente_id'),
        headers: z.record(z.string(), z.string()).optional().describe("nome → expressão"),
        body: z.record(z.string(), z.string()).optional().describe("corpo JSON: campo → expressão (só POST, PUT, PATCH)"),
      })
      .optional()
      .describe("call: chamada HTTP de verdade (o código gerado faz o fetch). A resposta fica nos dados resposta (corpo) e status_http; fora de 2xx ou sem rede o fluxo segue pela seta erro"),
    mock: logicValue.optional().describe("call com request: a resposta simulada (corpo) que os exemplos do app usam, com status 200 · code: o resultado simulado (o app não executa TypeScript)"),
    code: z.string().optional().describe("code: corpo de uma função TypeScript async (data) => { ... }; data são os dados do fluxo e o return vira o dado resultado (lido em devolve, ex.: \"total := resultado.total\"); se lançar erro, o fluxo segue pela seta erro"),
    trigger: z
      .object({
        kind: z.enum(["manual", "webhook", "agenda"]),
        path: z.string().optional().describe('webhook: caminho começando com "/", ex.: "/pedidos"'),
        method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]).optional().describe("webhook: método (padrão POST)"),
        cron: z.string().optional().describe('agenda: cron de 5 campos, ex.: "0 8 * * 1-5"'),
      })
      .optional()
      .describe("start: o que dispara o fluxo; o código gerado traz handler(req) (webhook) ou onSchedule() (agenda)"),
    falha: z.string().optional().describe("call: condição que simula a chamada falhando no exemplo; o fluxo segue pela seta branch \"erro\""),
    as: z.string().optional().describe("loop com foreach: nome do item"),
    outcome: z.enum(["ok", "erro"]).optional().describe("end: desfecho"),
    order: z.number().optional().describe("action (Ação): posição na fila (1, 2, 3…)"),
    text: z.string().optional().describe("action/scenario/input/output/variable: a frase do negócio"),
    when: z.string().optional().describe("decision: a condição (vale = seta sim), ex.: tipo em [\"imagem\", \"trafego\"] e preco < 10. A action não tem condição: ponha uma decision antes dela"),
    then: z.array(z.string()).optional().describe("action: efeitos, ex.: [\"preco := max(preco, piso)\", \"travar preco\"]"),
    examples: z.array(z.object({ name: z.string(), given: z.record(z.string(), logicValue), expect: z.record(z.string(), logicValue) })).optional().describe("action/decision/switch: exemplos do passo sozinho · scenario: exemplos da fila inteira"),
    key: z.string().optional().describe("input/output/variable: nome nas expressões (preco_atual, categoria.margem)"),
    type: z.string().optional().describe("input/output/variable: tipo na sintaxe do TypeScript (number, int, float, boolean, string, string[], { preco: number; cupom?: string }[], \"a\" | \"b\"). O app confere o valor fixo e os exemplos e avisa (L026)"),
    value: logicValue.optional().describe("input/variable: valor fixo (na variável, o valor inicial)"),
  })
  .describe("modo logic: papel e campos (ver get_schema_guide)");
const dddNodeSchema = z
  .object({
    role: z.enum(DDD_ROLE_KEYS as [string, ...string[]]).describe(DDD_ROLE_KEYS.map((r) => `${r}: ${DDD_ROLES[r].hint}`).join(" · ")),
    intent: z.string().optional().describe("command, policy, domain-service, application-service: o que faz"),
    invariants: z.array(z.string()).optional().describe("aggregate-root, entity, value-object, command: regras que sempre valem"),
    payload: z.string().optional().describe("domain-event: dados que o evento carrega (resumo em texto; prefira `properties`)"),
    properties: z
      .array(
        z.object({
          name: z.string().describe("nome do campo"),
          type: z.string().optional().describe("tipo em texto livre: uuid, texto, dinheiro, Item[] (pode ser o nome de outro value-object)"),
          optional: z.boolean().optional().describe("o campo pode faltar (padrão: obrigatório)"),
          key: z.boolean().optional().describe("é o identificador do elemento"),
          description: z.string().optional().describe("o que o campo significa e por que existe"),
          example: z.string().optional(),
        }),
      )
      .optional()
      .describe("aggregate-root, entity, value-object, command (parâmetros), domain-event (campos) e read-model (colunas): a estrutura do elemento, campo a campo"),
    producedBy: z.string().optional().describe("domain-event: id do command/aggregate-root/process-manager que o produz"),
    external: z.string().optional().describe("domain-event: 'contexto.evento' quando é cópia de evento de outro contexto"),
    for: z.string().optional().describe("repository: id do aggregate-root"),
    actor: z.string().optional().describe("use-case: quem executa"),
    goal: z.string().optional().describe("use-case: objetivo de negócio"),
    realizedBy: z.array(z.string()).optional().describe("use-case: ids dos commands que o realizam"),
    reactsTo: z.array(z.string()).optional().describe("policy, process-manager: ids dos eventos"),
    issues: z.array(z.string()).optional().describe("policy, process-manager: ids dos commands que dispara"),
    compensates: z.array(z.string()).optional().describe("process-manager: ids dos commands de compensação"),
    projectsFrom: z.array(z.string()).optional().describe("read-model: ids dos eventos que o alimentam"),
    step: z.number().optional().describe("command: posição na linha do tempo (ordena os commands no auto_layout timeline)"),
  })
  .describe("modo domain, kind domain: papel DDD e campos do papel (campos fora do papel são rejeitados)");

server.registerTool(
  "get_schema_guide",
  {
    description: "Leia primeiro: vocabulário (kinds, tipos de conexão) e fluxo recomendado. `mode` escolhe o guia (architecture | domain); omitido, usa o modo do diagrama aberto.",
    inputSchema: { mode: modeEnum.optional() },
  },
  async ({ mode }) => text(schemaGuide((mode as DocMode | undefined) ?? docMode(await getDoc()))),
);

server.registerTool(
  "list_assets",
  {
    description:
      "Lista TODO o catálogo de assets (built-in + personalizados do diagrama), agrupado por categoria, com id, nome e kind. Chame ANTES de montar um diagrama para reutilizar os assets existentes em vez de criar componentes do zero. Sem parâmetros retorna tudo; `category` filtra uma categoria; `detailed` inclui o problema que cada asset resolve.",
    inputSchema: {
      category: z.string().optional().describe("nome (ou parte) de uma categoria, ex.: AWS"),
      detailed: z.boolean().optional().describe("inclui o problema que cada asset resolve"),
    },
  },
  async ({ category, detailed }) => {
    const doc = await getDoc();
    const all = assetsForMode([...doc.customAssets, ...BUILTIN_ASSETS], docMode(doc), !!category);
    const cats = Array.from(new Set(all.map((a) => a.category)));
    const wanted = category ? cats.filter((c) => c.toLowerCase().includes(category.toLowerCase())) : cats;
    if (!wanted.length) return text(`categoria "${category}" não existe. Categorias: ${cats.join(", ")}`, true);
    const out = [`${all.length} assets em ${cats.length} categorias. Use o id em add_components.asset.`];
    for (const c of wanted) {
      const items = all.filter((a) => a.category === c);
      out.push("", `## ${c} (${items.length})`);
      for (const a of items) out.push(detailed ? `- ${a.id} | ${a.name} | ${a.kind} | ${a.problem}` : `- ${a.id} | ${a.name} | ${a.kind}`);
    }
    return text(out.join("\n"));
  },
);

server.registerTool(
  "search_assets",
  {
    description:
      "Busca no catálogo de tecnologias (AWS, Laravel, Postgres, Claude...) por palavras (todas devem casar). Cada asset descreve o problema que resolve. Retorna ids para usar em add_components.asset. Para ver tudo, use list_assets.",
    inputSchema: { query: z.string().optional(), category: z.string().optional() },
  },
  async ({ query, category }) => {
    const doc = await getDoc();
    const list = searchAssets(assetsForMode([...doc.customAssets, ...BUILTIN_ASSETS], docMode(doc), !!category), query, category).slice(0, 80);
    return text(list.map((a) => `- ${a.id} | ${a.name} | ${a.category} | ${a.kind} | ${a.problem}`).join("\n") || "nenhum asset encontrado (tente list_assets)");
  },
);

server.registerTool(
  "get_diagram",
  {
    description: "Lê o diagrama atual. format=markdown (padrão, melhor p/ raciocínio), json (estado completo) ou mermaid.",
    inputSchema: { format: z.enum(["markdown", "json", "mermaid"]).optional() },
  },
  async ({ format }) => {
    const doc = await getDoc();
    if (format === "json") return text(JSON.stringify(doc, null, 2));
    if (format === "mermaid") return text(toMermaid(doc));
    return text(describe(doc, docMode(doc) === "domain" ? { exists: existsIn(await vaultFiles()) } : {}));
  },
);

server.registerTool(
  "add_components",
  {
    description: "Adiciona componentes. Use `asset` do catálogo quando existir. Posição é opcional (auto). `parent` = id de um grupo. Em diagramas de modo domain, use `ddd` (kind vira \"domain\") em vez de asset; no modo logic, use `logic` (kind vira \"logic\").",
    inputSchema: {
      components: z.array(
        z.object({
          id: z.string().optional().describe("slug estável, ex.: orders-api"),
          label: z.string().optional(),
          asset: z.string().optional(),
          kind: z.enum(["service", "client", "actor", "database", "cache", "queue", "gateway", "external", "ai", "infra", "library", "endpoint", "system", "domain", "logic"]).optional(),
          ddd: dddNodeSchema.optional(),
          logic: logicNodeSchema.optional(),
          technology: z.string().optional().describe("stack/versão: 'Laravel 11 / PHP 8.3'"),
          description: z.string().optional().describe("responsabilidade do componente"),
          parent: z.string().optional(),
          props: z.record(z.string(), z.string()).optional(),
          ref: z
            .object({ diagram: z.string().describe("caminho do diagrama relativo ao cofre (de list_diagrams)"), node: z.string().optional().describe("id de um componente dentro desse diagrama") })
            .optional()
            .describe("kind system: referencia OUTRO diagrama do cofre"),
        }),
      ),
    },
  },
  async ({ components }) => report((await ops(components.map((c) => ({ op: "add_node" as const, ...c } as Op)))).results),
);

server.registerTool(
  "add_endpoints",
  {
    description:
      "Adiciona endpoints (componentes de comunicação) a um serviço: REST (GET/POST/PUT/PATCH/DELETE), GraphQL (query/mutation/subscription), WebSocket, gRPC, webhook, SSE ou evento. Ficam presos ao serviço `owner` e podem receber conexões.",
    inputSchema: {
      endpoints: z.array(
        z.object({
          owner: z.string().describe("id do serviço que expõe o endpoint"),
          protocol: z.enum(["rest", "graphql", "websocket", "grpc", "webhook", "sse", "event"]).optional().describe("padrão: rest"),
          method: z.string().optional().describe("REST: GET|POST|PUT|PATCH|DELETE · GraphQL: query|mutation|subscription · evento: PUBLISH|SUBSCRIBE"),
          path: z.string().optional().describe("REST: /orders/{id} · GraphQL: campo · gRPC: Service/Method · evento: tópico"),
          request: z.string().optional(),
          response: z.string().optional(),
          auth: z.string().optional().describe("ex.: Bearer JWT, API key"),
          description: z.string().optional(),
          id: z.string().optional(),
        }),
      ),
    },
  },
  async ({ endpoints }) => report((await ops(endpoints.map((e) => ({ op: "add_endpoint" as const, ...e } as Op)))).results),
);

server.registerTool(
  "add_groups",
  {
    description: "Cria grupos/fronteiras (cloud, network, layer, context, cluster, boundary, team). Podem ser aninhados via parent.",
    inputSchema: {
      groups: z.array(
        z.object({
          id: z.string().optional(),
          label: z.string(),
          kind: z.enum(["boundary", "layer", "cloud", "network", "context", "cluster", "team"]).optional(),
          subdomain: z.enum(Object.keys(SUBDOMAINS) as [string, ...string[]]).optional().describe("só em kind context: " + Object.entries(SUBDOMAINS).map(([k, v]) => `${k} = ${v}`).join(" · ")),
          description: z.string().optional(),
          parent: z.string().optional(),
          color: z.string().optional(),
        }),
      ),
    },
  },
  async ({ groups }) => report((await ops(groups.map((g) => ({ op: "add_group" as const, ...g } as Op)))).results),
);

server.registerTool(
  "connect",
  {
    description:
      "Cria conexões tipadas. type: " +
      CONNECTION_TYPE_KEYS.join(" | ") +
      ". Informe `interface` para definir o contrato (operações, payloads). No modo domain NÃO informe type: ele vem de `ddd.rel` (e se você omitir `ddd` e só uma relação servir para o par, a conexão já nasce com ela); sync/async/stream/data são recusados e cada relação só liga certos papéis (ver get_schema_guide).",
    inputSchema: {
      connections: z.array(
        z.object({
          from: z.string(),
          to: z.string(),
          type: z.enum(CONNECTION_TYPE_KEYS as [string, ...string[]]).optional(),
          label: z.string().optional(),
          protocol: z.string().optional(),
          description: z.string().optional(),
          interface: ifaceSchema.optional(),
          routing: z.enum(["curve", "straight", "elbow"]).optional(),
          waypoints: z.array(z.object({ x: z.number(), y: z.number() })).optional().describe("pontos de passagem do traçado (coords do mundo); normalmente definidos pela UI"),
          animated: z.boolean().optional(),
          ddd: z
            .object({
              rel: z.enum(DDD_REL_KEYS as [string, ...string[]]).describe("modo domain; o `type` é inferido da relação"),
              pattern: z.enum(CONTEXT_PATTERN_KEYS as [string, ...string[]]).optional().describe("só com rel context-relation"),
              condition: z.string().optional().describe("fluxo (triggers/emits): o ramo só segue se a condição valer, ex.: 'atraso > 0'"),
              otherwise: z.boolean().optional().describe("fluxo: ramo padrão (senão); não combina com condition"),
              loop: z.object({ until: z.string().optional(), max: z.number().int().min(1).max(1000).optional() }).optional().describe("fluxo: esta conexão VOLTA a um passo anterior; informe until (condição de parada) e/ou max (tentativas)"),
              foreach: z.string().optional().describe("fluxo: repete para cada elemento, ex.: 'item do pedido'"),
            })
            .optional(),
          logic: z
            .object({
              branch: z.enum(["sim", "nao", "repete", "segue", "outros"]).optional().describe("modo logic: saída da decisão (sim/nao), do loop (repete/segue) ou da escolha (outros)"),
              case: z.string().optional().describe('modo logic, seta que sai de uma escolha: o valor do caso como expressão, ex.: "\\"lucro\\"" ou 3'),
            })
            .optional(),
        }),
      ),
    },
  },
  async ({ connections }) =>
    report((await ops(connections.map((c) => ({ op: "add_connection" as const, ...(c as any) })))).results),
);

server.registerTool(
  "update_element",
  {
    description: "Altera campos de um elemento existente (label, description, technology, parent, type, interface, waypoints de conexão — [] ou null para resetar a curva...).",
    inputSchema: { id: z.string(), patch: z.record(z.string(), z.any()) },
  },
  async ({ id, patch }) => report((await ops([{ op: "update", id, patch }])).results),
);

server.registerTool(
  "remove_elements",
  {
    description: "Remove elementos por id (conexões ligadas somem junto; filhos de grupo removido sobem de nível).",
    inputSchema: { ids: z.array(z.string()) },
  },
  async ({ ids }) => report((await ops(ids.map((id) => ({ op: "remove" as const, id })))).results),
);

server.registerTool(
  "add_note",
  { description: "Adiciona uma nota de texto livre (decisões, riscos, TODOs).", inputSchema: { text: z.string() } },
  async ({ text: t }) => report((await ops([{ op: "add_note", text: t }])).results),
);

server.registerTool(
  "add_asset",
  {
    description: "Cadastra um asset personalizado no diagrama (tecnologia interna, SaaS). Informe o problema que resolve.",
    inputSchema: {
      name: z.string(),
      id: z.string().optional(),
      category: z.string().optional(),
      kind: z.string().optional(),
      problem: z.string(),
      description: z.string().optional(),
      color: z.string().optional(),
      icon: z.string().optional().describe("t:ABC (texto), URL de imagem ou data URI"),
      tags: z.array(z.string()).optional(),
    },
  },
  async (a) => report((await ops([{ op: "add_asset", asset: a as any }])).results),
);

server.registerTool(
  "auto_layout",
  {
    description:
      "Reorganiza automaticamente (camadas por fluxo de conexões; grupos dimensionados). `spacing` define a distância mínima entre componentes: compact (44px) | comfortable (80px, padrão) | spacious (120px); entre camadas é o dobro. `minGap` (px) sobrescreve o preset. Se o diagrama parecer apertado, use spacious. `gapX`/`gapY` (px) definem o espaçamento horizontal e vertical separadamente (sobrescrevem spacing/minGap). `routing` define o traçado de TODOS os conectores: curve (curva, padrão) | elbow (ortogonal) | straight (reta); omitido, preserva o traçado de cada conexão.",
    inputSchema: {
      style: z.enum(["flow", "timeline", "pipeline", "grouped"]).optional().describe("flow (padrão): camadas pelo fluxo das conexões. pipeline: só no modo logic (padrão nele): a fila de regras de cima para baixo, entradas à esquerda, resultados à direita, cenários no fim. timeline: só no modo domain; raias de Event Storming (ator → caso de uso → command → aggregate → evento → policy → read model → estrutura), commands em ordem de ddd.step. grouped: só no modo domain; \"agrupar por tipo\", um quadro por tipo de componente (atores, commands, aggregates, eventos…) em cada contexto, ligados por conectores ortogonais que desviam dos componentes"),
      direction: z.enum(["LR", "TB"]).optional(),
      spacing: z.enum(["compact", "comfortable", "spacious"]).optional(),
      minGap: z.number().min(16).max(400).optional(),
      gapX: z.number().min(16).max(600).optional(),
      gapY: z.number().min(16).max(600).optional(),
      routing: z.enum(["curve", "elbow", "straight"]).optional(),
    },
  },
  async ({ style, direction, spacing, minGap, gapX, gapY, routing }) => report((await ops([{ op: "layout", style, direction, spacing, minGap, gapX, gapY, routing }])).results),
);

server.registerTool(
  "set_diagram_info",
  {
    description: "Define título, descrição e modo (architecture | domain) do diagrama.",
    inputSchema: { title: z.string().optional(), description: z.string().optional(), mode: modeEnum.optional().describe("trocar o modo não apaga nada; as regras e o vocabulário mudam") },
  },
  async (a) => report((await ops([{ op: "set_meta", ...a }])).results),
);

server.registerTool(
  "set_presentation",
  {
    description:
      "Modo architecture: grava o roteiro de apresentação (a ordem dos slides). Substitui o roteiro inteiro; `steps` vazio apaga e volta ao roteiro automático. " +
      "Cada passo tem `title`, `text` opcional (o que o apresentador fala) e `focus` (ids de componentes, grupos, conexões ou notas; vazio ou omitido = visão geral). " +
      "Um passo por ideia: comece pela visão geral, siga o caminho da requisição e inclua no focus a nota de decisão ou risco no passo em que ela importa. " +
      "Preencha antes a `description` dos componentes — no slide ela aparece como responsabilidade, junto com endpoints, conexões, interfaces e notas em foco. A tecla P abre a apresentação.",
    inputSchema: {
      steps: z.array(
        z.object({
          id: z.string().optional().describe("slug estável do passo"),
          title: z.string().describe("título do slide"),
          text: z.string().optional().describe("narrativa: o que dizer neste passo"),
          focus: z.array(z.string()).optional().describe("ids em foco; omitido ou vazio = visão geral do diagrama"),
        }),
      ),
    },
  },
  async ({ steps }) => {
    const doc = await getDoc();
    if (docMode(doc) !== "architecture") return text(`o diagrama aberto está em modo "${docMode(doc)}"; o roteiro de apresentação é do modo architecture`, true);
    return report((await ops([{ op: "set_tour", steps: steps.map((s) => ({ ...s, focus: s.focus ?? [] })) }])).results);
  },
);

server.registerTool(
  "clear_diagram",
  { description: "Apaga todo o conteúdo do diagrama (destrutivo; o usuário pode desfazer com Ctrl+Z no app).", inputSchema: {} },
  async () => report((await ops([{ op: "clear" }])).results),
);

server.registerTool(
  "validate_diagram",
  {
    description: "Lista inconsistências (referências quebradas, componentes isolados). No modo domain aplica as regras de DDD (D001–D032), cada aviso com o id da regra e a severidade (erro | aviso | dica).",
    inputSchema: {},
  },
  async () => {
    const doc = await getDoc();
    const v = validate(doc, docMode(doc) === "domain" ? { exists: existsIn(await vaultFiles()) } : {});
    return text(v.length ? v.join("\n") : "sem problemas");
  },
);

server.registerTool(
  "add_use_cases",
  {
    description:
      "Modo domain: cria casos de uso (nó use-case) já ligados ao ator (criado ou reaproveitado pelo nome). Itens com `id` já existente são ignorados (seguro para repetir). Depois realize cada caso de uso com um command (connect ddd.rel realizes) e rode trace.",
    inputSchema: {
      useCases: z.array(
        z.object({
          id: z.string().optional().describe("slug estável, ex.: fazer-pedido"),
          actor: z.string().describe("quem executa, ex.: Cliente"),
          goal: z.string().describe("objetivo de negócio em uma frase"),
          label: z.string().optional(),
          context: z.string().optional().describe("id do grupo (bounded context) que contém o caso de uso"),
          steps: z.array(z.string()).optional(),
        }),
      ),
    },
  },
  async ({ useCases }) => {
    const doc = await getDoc();
    if (docMode(doc) !== "domain") return text(`o diagrama aberto está em modo "${docMode(doc)}"; crie um com new_diagram mode "domain" ou use set_diagram_info mode "domain"`, true);
    const list = useCaseOps(doc, useCases);
    if (!list.length) return text("nada a criar: todos os casos de uso já existem");
    return report((await ops(list)).results);
  },
);

server.registerTool(
  "trace",
  {
    description: "Modo domain: rastreia um caso de uso até o evento (caso de uso → command → aggregate → evento) e lista o que falta. Sem `id`, rastreia todos os casos de uso do diagrama aberto.",
    inputSchema: { id: z.string().optional().describe("id de um use-case") },
  },
  async ({ id }) => {
    const doc = await getDoc();
    const ids = id ? [id] : doc.nodes.filter((n) => n.ddd?.role === "use-case").map((n) => n.id);
    if (!ids.length) return text("nenhum caso de uso neste diagrama");
    const lines: string[] = [];
    let ok = 0;
    for (const uc of ids) {
      const t = traceUseCase(doc, uc);
      if (!t) {
        lines.push(`✘ ${uc}: não é um use-case deste diagrama`);
        continue;
      }
      if (t.ok) ok++;
      lines.push(`${t.ok ? "✔" : "✘"} ${uc}${t.ok ? "" : ` — ${t.problems.join("; ") || "sem caminho até um evento"}`}`);
      for (const p of t.paths) lines.push(`    ${p.map((s) => `${s.id} [${s.role}]`).join(" → ")}`);
    }
    return text([`${ok} de ${ids.length} rastreados até um evento`, ...lines].join("\n"));
  },
);

server.registerTool(
  "generate_code",
  {
    description:
      "Modo logic: gera TypeScript EXECUTÁVEL do fluxo (runtime.ts, <fluxo>.ts com `run(input, deps)` e <fluxo>.test.ts com um teste por exemplo de cenário); Call com `request` vira fetch de verdade. Modo domain: gera o esqueleto de código do diagrama aberto (um diretório por bounded context, application → domain): aggregates com entities e value objects, eventos, interfaces de repository, commands e handlers, policies, sagas, decisões (classes tipadas pelos ramos), read models e use-cases.md com o rastreio. Devolve os arquivos em Markdown (caminho + conteúdo) para você gravar no projeto do usuário; a lógica fica como TODO. Rode validate_diagram antes: o código herda as lacunas do modelo.",
    inputSchema: { language: z.enum(CODEGEN_LANGUAGES).optional().describe("padrão e único hoje: typescript") },
  },
  async ({ language }) => {
    const doc = await getDoc();
    if (docMode(doc) === "architecture") return text(`o diagrama aberto está em modo "${docMode(doc)}"; gere código a partir de um diagrama de domínio ou de lógica`, true);
    const files = generateCode(doc, (language as CodegenLanguage | undefined) ?? "typescript");
    return text(files.length ? `${files.length} arquivo(s)

${filesToMarkdown(files)}` : "nada a gerar: o diagrama não tem elementos de domínio (ou, no modo logic, passos do fluxo)");
  },
);

server.registerTool(
  "domain_overview",
  {
    description: "Modo domain: visão geral consolidada de TODOS os diagramas de domínio do cofre (contextos, aggregates, eventos publicados/consumidos, casos de uso ✔/✘, mapa de contextos e avisos). Somente leitura.",
    inputSchema: {},
  },
  async () => text(domainOverview(await vaultFiles())),
);

const post = (path: string, body: unknown) => api(path, { method: "POST", body: JSON.stringify(body) });
const fmtWorkspace = (w: any) =>
  [`cofre: ${w.vault.name} (${w.vault.path})`, `aberto: ${w.current}`, ...w.files.map((f: any) => `- ${f.path} | ${f.title} | ${f.nodes} componentes, ${f.connections} conexões${f.refs?.length ? ` · referencia: ${f.refs.join(", ")}` : ""}${f.path === w.current ? " (ABERTO)" : ""}`)].join("\n");

server.registerTool(
  "list_diagrams",
  { description: "Lista os diagramas do cofre (vault) do usuário, incluindo subpastas, e indica qual está aberto. As demais tools editam o diagrama aberto.", inputSchema: {} },
  async () => text(fmtWorkspace(await api("/api/workspace"))),
);

server.registerTool(
  "get_diagram_outline",
  {
    description: "Resumo de OUTRO diagrama do cofre (componentes, endpoints, grupos) sem abri-lo. Use antes de criar uma referência (kind system + ref) para escolher o diagrama e o componente certos.",
    inputSchema: { name: z.string().describe("caminho de list_diagrams") },
  },
  async ({ name }) => {
    try {
      const o: any = await api(`/api/diagrams/outline?name=${encodeURIComponent(name)}`);
      const lines = [`# ${o.title} (${o.name})`, o.description ?? "", `${o.nodes.length} componentes · ${o.connections} conexões`];
      for (const n of o.nodes) {
        const ep = n.endpoint ? ` endpoint ${n.endpoint.protocol} ${n.endpoint.method ?? ""} ${n.endpoint.path ?? ""}`.trimEnd() : "";
        lines.push(`- ${n.id} | ${n.label} | ${n.kind}${n.owner ? ` (de ${n.owner})` : ""}${ep}`);
      }
      return text(lines.join("\n"));
    } catch (e) {
      return text(String(e), true);
    }
  },
);

server.registerTool(
  "open_diagram",
  { description: "Abre outro diagrama do cofre (use o caminho de list_diagrams, ex.: backend/orders.archflow.json). O app do usuário troca de diagrama.", inputSchema: { name: z.string() } },
  async ({ name }) => {
    try {
      return text("aberto.\n" + fmtWorkspace(await post("/api/diagrams/open", { name })));
    } catch (e) {
      return text(String(e), true);
    }
  },
);

const PREVIEW_MAX = 1_500_000;

server.registerTool(
  "export_image",
  {
    description:
      "Exporta o diagrama como SVG e/ou PNG idêntico ao que o app mostra (fontes embutidas no SVG, cores do tema, setas, ícones, notas em markdown e o fundo do quadro; sem seleção nem zoom). " +
      "A imagem é renderizada pela janela do Archflow, que precisa estar aberta. Sem `out`, grava ao lado do diagrama (ex.: backend/orders.svg). `name` exporta outro diagrama do cofre (o app troca para ele).",
    inputSchema: {
      format: z.enum(["svg", "png", "both"]).optional().describe("svg (padrão), png ou both"),
      name: z.string().optional().describe("caminho de list_diagrams; omitido = diagrama aberto"),
      out: z.string().optional().describe("arquivo ou pasta de destino; caminho relativo fica dentro do cofre. Sem extensão, recebe .svg/.png"),
      background: z.enum(["board", "solid", "transparent"]).optional().describe("board (padrão: cor + trama do quadro) · solid (só a cor) · transparent"),
      scale: z.number().min(0.5).max(4).optional().describe("PNG: pixels por unidade (padrão 2)"),
      padding: z.number().int().min(0).max(400).optional().describe("margem em volta do conteúdo (padrão 48)"),
    },
  },
  async ({ format, out, name, ...opts }) => {
    const formats = format === "both" ? (["svg", "png"] as const) : ([format ?? "svg"] as const);
    const lines: string[] = [];
    const images: { type: "image"; data: string; mimeType: string }[] = [];
    try {
      for (const f of formats) {
        const dest = out && formats.length > 1 && /\.(svg|png)$/i.test(out) ? out.replace(/\.(svg|png)$/i, `.${f}`) : out;
        const r: any = await post("/api/export", { format: f, out: dest, name: f === formats[0] ? name : undefined, ...opts });
        lines.push(`${f.toUpperCase()} ${r.width}×${r.height}px · ${(r.bytes / 1024).toFixed(1)} KB → ${r.file}`);
        if (r.base64 && r.base64.length <= PREVIEW_MAX) images.push({ type: "image", data: r.base64, mimeType: "image/png" });
      }
      return { content: [{ type: "text" as const, text: `exportado (${formats.length}).\n${lines.join("\n")}` }, ...images] };
    } catch (e) {
      return text([...lines, String(e)].join("\n"), true);
    }
  },
);

server.registerTool(
  "new_diagram",
  {
    description: "Cria um diagrama novo (.archflow.json) no cofre, opcionalmente numa subpasta, e o abre. `mode` domain cria um diagrama de domínio (DDD); depois chame get_schema_guide.",
    inputSchema: { title: z.string(), folder: z.string().optional().describe("subpasta relativa ao cofre, ex.: backend"), mode: modeEnum.optional().describe("architecture (padrão) | domain") },
  },
  async ({ title, folder, mode }) => text("criado.\n" + fmtWorkspace(await post("/api/diagrams", { title, folder, mode, source: "mcp" }))),
);

server.registerResource(
  "diagram",
  "archflow://diagram",
  { description: "Diagrama atual em markdown", mimeType: "text/markdown" },
  async (uri) => {
    const doc = await getDoc();
    return { contents: [{ uri: uri.href, mimeType: "text/markdown", text: describe(doc, docMode(doc) === "domain" ? { exists: existsIn(await vaultFiles()) } : {}) }] };
  },
);
server.registerResource(
  "schema-guide",
  "archflow://schema",
  { description: "Guia do schema archflow/1", mimeType: "text/markdown" },
  async (uri) => ({ contents: [{ uri: uri.href, mimeType: "text/markdown", text: schemaGuide(docMode(await getDoc())) }] }),
);

server.registerResource(
  "skill",
  "archflow://skill",
  { description: "Skill: como usar o Archflow (fluxo, tools, vocabulário, erros comuns)", mimeType: "text/markdown" },
  async (uri) => ({ contents: [{ uri: uri.href, mimeType: "text/markdown", text: SKILL_MD }] }),
);

await server.connect(new StdioServerTransport());
// O cliente MCP encerra fechando o stdin; sem isto o bridge hospedado manteria o processo vivo.
process.stdin.on("close", () => process.exit(0));
console.error(`[mcp] archflow pronto · bridge em ${BASE}`);
