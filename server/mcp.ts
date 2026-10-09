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
import { BUILTIN_ASSETS, searchAssets } from "../src/shared/catalog";
import { CONNECTION_TYPE_KEYS, type Doc } from "../src/shared/schema";
import { describe, schemaGuide, toMermaid, validate, type Op } from "../src/shared/ops";
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

server.registerTool(
  "get_schema_guide",
  { description: "Leia primeiro: vocabulário (kinds, tipos de conexão) e fluxo recomendado.", inputSchema: {} },
  async () => text(schemaGuide()),
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
    const all = [...doc.customAssets, ...BUILTIN_ASSETS];
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
    const list = searchAssets([...doc.customAssets, ...BUILTIN_ASSETS], query, category).slice(0, 80);
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
    return text(format === "json" ? JSON.stringify(doc, null, 2) : format === "mermaid" ? toMermaid(doc) : describe(doc));
  },
);

server.registerTool(
  "add_components",
  {
    description: "Adiciona componentes. Use `asset` do catálogo quando existir. Posição é opcional (auto). `parent` = id de um grupo.",
    inputSchema: {
      components: z.array(
        z.object({
          id: z.string().optional().describe("slug estável, ex.: orders-api"),
          label: z.string().optional(),
          asset: z.string().optional(),
          kind: z.enum(["service", "client", "actor", "database", "cache", "queue", "gateway", "external", "ai", "infra", "library", "endpoint", "system"]).optional(),
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
          description: z.string().optional(),
          parent: z.string().optional(),
          color: z.string().optional(),
        }),
      ),
    },
  },
  async ({ groups }) => report((await ops(groups.map((g) => ({ op: "add_group" as const, ...g })))).results),
);

server.registerTool(
  "connect",
  {
    description: "Cria conexões tipadas. type: " + CONNECTION_TYPE_KEYS.join(" | ") + ". Informe `interface` para definir o contrato (operações, payloads).",
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
      direction: z.enum(["LR", "TB"]).optional(),
      spacing: z.enum(["compact", "comfortable", "spacious"]).optional(),
      minGap: z.number().min(16).max(400).optional(),
      gapX: z.number().min(16).max(600).optional(),
      gapY: z.number().min(16).max(600).optional(),
      routing: z.enum(["curve", "elbow", "straight"]).optional(),
    },
  },
  async ({ direction, spacing, minGap, gapX, gapY, routing }) => report((await ops([{ op: "layout", direction, spacing, minGap, gapX, gapY, routing }])).results),
);

server.registerTool(
  "set_diagram_info",
  { description: "Define título e descrição do diagrama.", inputSchema: { title: z.string().optional(), description: z.string().optional() } },
  async (a) => report((await ops([{ op: "set_meta", ...a }])).results),
);

server.registerTool(
  "clear_diagram",
  { description: "Apaga todo o conteúdo do diagrama (destrutivo; o usuário pode desfazer com Ctrl+Z no app).", inputSchema: {} },
  async () => report((await ops([{ op: "clear" }])).results),
);

server.registerTool(
  "validate_diagram",
  { description: "Lista inconsistências (referências quebradas, componentes isolados).", inputSchema: {} },
  async () => {
    const v = validate(await getDoc());
    return text(v.length ? v.join("\n") : "sem problemas");
  },
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

server.registerTool(
  "new_diagram",
  {
    description: "Cria um diagrama novo (.archflow.json) no cofre, opcionalmente numa subpasta, e o abre.",
    inputSchema: { title: z.string(), folder: z.string().optional().describe("subpasta relativa ao cofre, ex.: backend") },
  },
  async ({ title, folder }) => text("criado.\n" + fmtWorkspace(await post("/api/diagrams", { title, folder, source: "mcp" }))),
);

server.registerResource(
  "diagram",
  "archflow://diagram",
  { description: "Diagrama atual em markdown", mimeType: "text/markdown" },
  async (uri) => ({ contents: [{ uri: uri.href, mimeType: "text/markdown", text: describe(await getDoc()) }] }),
);
server.registerResource(
  "schema-guide",
  "archflow://schema",
  { description: "Guia do schema archflow/1", mimeType: "text/markdown" },
  async (uri) => ({ contents: [{ uri: uri.href, mimeType: "text/markdown", text: schemaGuide() }] }),
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
