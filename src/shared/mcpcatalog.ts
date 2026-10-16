/**
 * Catálogo de servidores MCP do modo agents.
 *
 * Três origens, todas viram um `McpCatalogEntry` (que vira o nó Tool do diagrama):
 *  - lista curada embutida (`MCP_CATALOG`): só entradas conferidas na fonte (README do projeto ou registro oficial);
 *  - registro oficial (registry.modelcontextprotocol.io), consultado pelo bridge e convertido por `registryServerToEntry`;
 *  - colar um `.mcp.json` / `{ "mcpServers": … }` ou um comando `claude mcp add …` (`parseMcpInput`).
 *
 * Sem I/O. Segredos nunca entram: valores que parecem segredo viram `${VAR}` e a entrada lista as variáveis exigidas.
 */
import { looksLikeSecret } from "./agents";
import type { AgentNodeSpec, McpTransport } from "./schema";

export interface McpRequiredVar {
  /** nome da variável de ambiente que o usuário precisa definir */
  name: string;
  hint?: string;
}

export interface McpCatalogEntry {
  /** slug estável; vira o id do nó (`mcp__<id>__tool`) */
  id: string;
  name: string;
  description: string;
  tags: string[];
  transport: McpTransport;
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
  headers?: Record<string, string>;
  requiredVars?: McpRequiredVar[];
  /** aviso para o usuário depois de adicionar (ex.: ajustar o diretório permitido) */
  note?: string;
  origin: "curated" | "registry" | "pasted";
  /** onde conferir (README, página do registro) */
  homepage?: string;
  /** versão do registro, quando veio de lá */
  version?: string;
  /** segredos que vieram em texto puro e foram trocados por `${VAR}` (só em `pasted`) */
  replacedSecrets?: string[];
}

/* ───────────────────────── lista curada ───────────────────────── */

/** Conferido em 2026-10-15 nas fontes de `homepage`. Sem inventar nome de pacote: ao incluir um novo, confira o README. */
export const MCP_CATALOG: McpCatalogEntry[] = [
  {
    id: "playwright",
    name: "Playwright",
    description: "Controla um navegador real: navega, clica, preenche formulários e tira screenshots. Para testar a interface construída pelo time.",
    tags: ["navegador", "browser", "teste", "e2e", "playwright", "web"],
    transport: "stdio",
    command: "npx",
    args: ["-y", "@playwright/mcp@latest"],
    note: "Use a flag --headless nos args se não quiser abrir a janela do navegador.",
    origin: "curated",
    homepage: "https://github.com/microsoft/playwright-mcp",
  },
  {
    id: "github",
    name: "GitHub",
    description: "Servidor oficial do GitHub: issues, pull requests, repositórios, Actions e busca de código.",
    tags: ["github", "git", "issues", "pull request", "repositório", "código"],
    transport: "http",
    url: "https://api.githubcopilot.com/mcp/",
    headers: { Authorization: "Bearer ${GITHUB_PERSONAL_ACCESS_TOKEN}" },
    requiredVars: [{ name: "GITHUB_PERSONAL_ACCESS_TOKEN", hint: "Personal access token do GitHub com os escopos que o agente precisa" }],
    origin: "curated",
    homepage: "https://github.com/github/github-mcp-server",
  },
  {
    id: "filesystem",
    name: "Filesystem",
    description: "Lê, escreve e busca arquivos em diretórios permitidos, com controle de acesso por diretório.",
    tags: ["arquivos", "filesystem", "disco", "pastas"],
    transport: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-filesystem", "."],
    note: "O último argumento é o diretório permitido: troque «.» pelos diretórios que o agente pode acessar (um por linha).",
    origin: "curated",
    homepage: "https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem",
  },
  {
    id: "context7",
    name: "Context7",
    description: "Documentação atualizada de bibliotecas e frameworks, direto no contexto do agente.",
    tags: ["documentação", "docs", "biblioteca", "framework", "api"],
    transport: "stdio",
    command: "npx",
    args: ["-y", "@upstash/context7-mcp"],
    origin: "curated",
    homepage: "https://github.com/upstash/context7",
  },
  {
    id: "figma",
    name: "Figma",
    description: "Servidor oficial do Figma: lê frames, componentes e variáveis de design para gerar interface fiel ao design.",
    tags: ["figma", "design", "ui", "interface", "protótipo"],
    transport: "http",
    url: "https://mcp.figma.com/mcp",
    origin: "curated",
    homepage: "https://registry.modelcontextprotocol.io/v0/servers?search=com.figma.mcp",
  },
];

export function findMcpCatalogEntry(id: string, extra: McpCatalogEntry[] = []): McpCatalogEntry | undefined {
  return [...MCP_CATALOG, ...extra].find((e) => e.id === id);
}

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Busca por nome, descrição e tags (todas as palavras precisam casar). Vazio = tudo. */
export function searchMcpCatalog(query: string, extra: McpCatalogEntry[] = []): McpCatalogEntry[] {
  const words = norm(query).split(/\s+/).filter(Boolean);
  const all = [...MCP_CATALOG, ...extra.filter((e) => !MCP_CATALOG.some((c) => c.id === e.id))];
  if (!words.length) return all;
  return all.filter((e) => {
    const hay = norm([e.id, e.name, e.description, e.tags.join(" "), e.command ?? "", e.url ?? ""].join(" "));
    return words.every((w) => hay.includes(w));
  });
}

/** Campos do nó Tool (kind MCP) a partir de uma entrada. */
export function mcpEntryToSpec(e: McpCatalogEntry): AgentNodeSpec {
  return {
    role: "tool",
    toolType: "mcp",
    description: e.description,
    transport: e.transport,
    ...(e.command ? { command: e.command } : {}),
    ...(e.args?.length ? { args: e.args } : {}),
    ...(e.url ? { url: e.url } : {}),
    ...(e.env && Object.keys(e.env).length ? { env: e.env } : {}),
    ...(e.headers && Object.keys(e.headers).length ? { headers: e.headers } : {}),
    mcpSource: { catalog: e.origin, id: e.id, ...(e.version ? { version: e.version } : {}) },
  };
}

/** Variáveis `${VAR}` / `${VAR:-padrão}` usadas por um servidor (command, args, env, url, headers), sem repetir. */
export function mcpVars(spec: Pick<AgentNodeSpec, "command" | "args" | "url" | "env" | "headers">): { name: string; hasDefault: boolean }[] {
  const texts = [spec.command, ...(spec.args ?? []), spec.url, ...Object.values(spec.env ?? {}), ...Object.values(spec.headers ?? {})];
  const found = new Map<string, boolean>();
  for (const t of texts) {
    if (!t) continue;
    for (const m of t.matchAll(/\$\{([A-Za-z_][A-Za-z0-9_]*)(:-[^}]*)?\}/g)) found.set(m[1], (found.get(m[1]) ?? false) || m[2] !== undefined);
  }
  return [...found].map(([name, hasDefault]) => ({ name, hasDefault }));
}

/* ───────────────────────── registro oficial ───────────────────────── */

interface RegistryEnvVar {
  name?: string;
  description?: string;
  isRequired?: boolean;
  isSecret?: boolean;
  default?: string;
  value?: string;
}
interface RegistryHeader extends RegistryEnvVar {}
interface RegistryServer {
  name?: string;
  title?: string;
  description?: string;
  version?: string;
  websiteUrl?: string;
  repository?: { url?: string };
  packages?: {
    registryType?: string;
    identifier?: string;
    version?: string;
    runtimeHint?: string;
    transport?: { type?: string };
    environmentVariables?: RegistryEnvVar[];
  }[];
  remotes?: { type?: string; url?: string; headers?: RegistryHeader[] }[];
  _meta?: Record<string, { title?: string; tags?: string[] } | undefined>;
}

const slugify = (s: string) =>
  norm(s)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "mcp";

const envName = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");

/** Troca `{variavel}` de URLs-modelo do registro por `${VARIAVEL}` e devolve as variáveis. */
function templateVars(url: string): { url: string; vars: string[] } {
  const vars: string[] = [];
  const out = url.replace(/\{([A-Za-z0-9_-]+)\}/g, (_, n: string) => {
    vars.push(envName(n));
    return `\${${envName(n)}}`;
  });
  return { url: out, vars };
}

/**
 * Converte um servidor do registro oficial em entrada do catálogo. Prefere o servidor remoto (http); sem ele usa o
 * primeiro pacote (npm → `npx -y`, pypi → `uvx`, oci → `docker run`). Devolve undefined quando não há como conectar.
 */
export function registryServerToEntry(raw: unknown): McpCatalogEntry | undefined {
  const s = raw as RegistryServer;
  if (!s || typeof s !== "object" || typeof s.name !== "string") return undefined;
  const meta = Object.values(s._meta ?? {}).find((m) => m?.title || m?.tags);
  const short = s.name.split("/").pop() ?? s.name;
  const base: Omit<McpCatalogEntry, "transport"> = {
    id: slugify(short),
    name: s.title ?? meta?.title ?? short,
    description: (s.description ?? "").trim() || short,
    tags: [...(meta?.tags ?? []), ...s.name.split(/[./-]+/).filter((x) => x.length > 2)].slice(0, 8),
    origin: "registry",
    homepage: s.websiteUrl ?? s.repository?.url ?? `https://registry.modelcontextprotocol.io/v0/servers?search=${encodeURIComponent(s.name)}`,
    ...(s.version ? { version: s.version } : {}),
  };
  const required: McpRequiredVar[] = [];
  const addRequired = (name: string, hint?: string) => {
    if (!required.some((r) => r.name === name)) required.push({ name, ...(hint ? { hint } : {}) });
  };

  const remote = s.remotes?.find((r) => r.type === "streamable-http" && r.url) ?? s.remotes?.find((r) => (r.type === "sse" || r.type === "http") && r.url);
  if (remote?.url) {
    const { url, vars } = templateVars(remote.url);
    vars.forEach((v) => addRequired(v));
    const headers: Record<string, string> = {};
    for (const h of remote.headers ?? []) {
      if (!h.name) continue;
      const auth = /^authorization$/i.test(h.name);
      const variable = auth ? `${envName(short)}_TOKEN` : envName(h.name);
      const v = h.value && !h.isSecret && !h.value.includes("{") ? h.value : `\${${variable}}`;
      headers[h.name] = auth && v.startsWith("${") ? `Bearer ${v}` : v;
      if (v.startsWith("${")) addRequired(variable, h.description);
    }
    return { ...base, transport: remote.type === "sse" ? "sse" : "http", url, ...(Object.keys(headers).length ? { headers } : {}), ...(required.length ? { requiredVars: required } : {}) };
  }

  const pkg = s.packages?.find((p) => p.identifier && (p.transport?.type ?? "stdio") === "stdio" && ["npm", "pypi", "oci"].includes(p.registryType ?? ""));
  if (!pkg?.identifier) return undefined;
  const env: Record<string, string> = {};
  for (const v of pkg.environmentVariables ?? []) {
    if (!v.name) continue;
    env[v.name] = v.isSecret || !v.default ? `\${${v.name}}` : `\${${v.name}:-${v.default}}`;
    if (v.isRequired || v.isSecret) addRequired(v.name, v.description);
  }
  const withEnv = { ...(Object.keys(env).length ? { env } : {}), ...(required.length ? { requiredVars: required } : {}) };
  if (pkg.registryType === "npm") return { ...base, transport: "stdio", command: pkg.runtimeHint ?? "npx", args: ["-y", pkg.version ? `${pkg.identifier}@${pkg.version}` : pkg.identifier], ...withEnv };
  if (pkg.registryType === "pypi") return { ...base, transport: "stdio", command: pkg.runtimeHint ?? "uvx", args: [pkg.version ? `${pkg.identifier}==${pkg.version}` : pkg.identifier], ...withEnv };
  const dockerEnv = Object.keys(env).flatMap((k) => ["-e", k]);
  return { ...base, transport: "stdio", command: "docker", args: ["run", "-i", "--rm", ...dockerEnv, pkg.identifier], ...withEnv, note: "Precisa do Docker instalado." };
}

/* ───────────────────────── colar `.mcp.json` ou `claude mcp add` ───────────────────────── */

export interface McpParseResult {
  entries: McpCatalogEntry[];
  error?: string;
}

function entryFromConfig(name: string, cfg: unknown): McpCatalogEntry | string {
  if (!cfg || typeof cfg !== "object" || Array.isArray(cfg)) return `«${name}»: configuração inválida (esperado um objeto)`;
  const c = cfg as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v : undefined);
  const map = (v: unknown): Record<string, string> | undefined =>
    v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([, x]) => typeof x === "string") as [string, string][]) : undefined;
  const type = str(c.type);
  const url = str(c.url);
  const command = str(c.command);
  const transport: McpTransport = type === "sse" ? "sse" : type === "http" || type === "streamable-http" || (!type && url && !command) ? "http" : "stdio";
  if (transport === "stdio" && !command) return `«${name}»: servidor stdio sem "command"`;
  if (transport !== "stdio" && !url) return `«${name}»: servidor ${transport} sem "url"`;
  const replaced: string[] = [];
  const required: McpRequiredVar[] = [];
  const clean = (m: Record<string, string> | undefined, kind: "env" | "headers") => {
    if (!m) return undefined;
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(m)) {
      if (looksLikeSecret(k, v)) {
        const variable = kind === "headers" && /^authorization$/i.test(k) ? `${envName(name)}_TOKEN` : envName(k);
        out[k] = kind === "headers" && /^authorization$/i.test(k) && /^bearer\s/i.test(v) ? `Bearer \${${variable}}` : `\${${variable}}`;
        replaced.push(k);
        if (!required.some((r) => r.name === variable)) required.push({ name: variable, hint: "veio em texto puro e foi trocada por variável" });
      } else out[k] = v;
      for (const mm of v.matchAll(/\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-[^}]*)?\}/g)) if (!/:-/.test(mm[0]) && !required.some((r) => r.name === mm[1])) required.push({ name: mm[1] });
    }
    return out;
  };
  const args = Array.isArray(c.args) ? c.args.filter((a): a is string => typeof a === "string") : undefined;
  const env = clean(map(c.env), "env");
  const headers = clean(map(c.headers), "headers");
  return {
    id: slugify(name),
    name,
    description: `Servidor MCP «${name}» importado.`,
    tags: [],
    transport,
    ...(command ? { command } : {}),
    ...(args?.length ? { args } : {}),
    ...(url ? { url } : {}),
    ...(env && Object.keys(env).length ? { env } : {}),
    ...(headers && Object.keys(headers).length ? { headers } : {}),
    ...(required.length ? { requiredVars: required } : {}),
    origin: "pasted",
    ...(replaced.length ? { replacedSecrets: replaced } : {}),
  };
}

/** Separa uma linha de comando em tokens respeitando aspas simples e duplas. */
export function shellSplit(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quote: string | undefined;
  let has = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quote) {
      if (ch === quote) quote = undefined;
      else if (ch === "\\" && quote === '"' && i + 1 < line.length) cur += line[++i];
      else cur += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      has = true;
    } else if (/\s/.test(ch)) {
      if (cur || has) out.push(cur);
      cur = "";
      has = false;
    } else if (ch === "\\" && line[i + 1] === "\n") i++;
    else cur += ch;
  }
  if (cur || has) out.push(cur);
  return out;
}

function parseClaudeMcpAdd(text: string): McpParseResult {
  const tokens = shellSplit(text.replace(/\\\r?\n/g, " "));
  const i = tokens.findIndex((t, k) => t === "mcp" && (tokens[k + 1] === "add" || tokens[k + 1] === "add-json"));
  if (i < 0) return { entries: [], error: "comando não reconhecido: use `claude mcp add …` ou cole um JSON" };
  const isJson = tokens[i + 1] === "add-json";
  const rest = tokens.slice(i + 2);
  const dash = rest.indexOf("--");
  const head = dash >= 0 ? rest.slice(0, dash) : rest;
  const tail = dash >= 0 ? rest.slice(dash + 1) : [];
  let transport: string | undefined;
  const env: Record<string, string> = {};
  const headers: Record<string, string> = {};
  const pos: string[] = [];
  for (let k = 0; k < head.length; k++) {
    const t = head[k];
    const val = () => head[++k] ?? "";
    if (t === "--transport" || t === "-t") transport = val();
    else if (t === "--scope" || t === "-s") val();
    else if (t === "--env" || t === "-e") {
      const [key, ...v] = val().split("=");
      if (key) env[key] = v.join("=");
    } else if (t === "--header" || t === "-H") {
      const h = val();
      const idx = h.indexOf(":");
      if (idx > 0) headers[h.slice(0, idx).trim()] = h.slice(idx + 1).trim();
    } else if (t.startsWith("--transport=")) transport = t.slice(12);
    else pos.push(t);
  }
  const [name, second, ...others] = pos;
  if (!name) return { entries: [], error: "faltou o nome do servidor" };
  if (isJson) {
    try {
      const r = entryFromConfig(name, JSON.parse(second ?? ""));
      return typeof r === "string" ? { entries: [], error: r } : { entries: [r] };
    } catch {
      return { entries: [], error: "o JSON de `claude mcp add-json` não é válido" };
    }
  }
  const cfg: Record<string, unknown> = dash >= 0 ? { type: "stdio", command: tail[0], args: tail.slice(1), env } : { type: transport ?? "http", url: second, headers };
  if (dash < 0 && others.length) return { entries: [], error: "argumentos sobrando: para servidor stdio use `-- comando args`" };
  if (dash >= 0 && !tail[0]) return { entries: [], error: "faltou o comando depois de `--`" };
  const r = entryFromConfig(name, cfg);
  return typeof r === "string" ? { entries: [], error: r } : { entries: [r] };
}

/** Aceita `{ "mcpServers": { … } }`, um mapa `{ nome: config }`, uma config solta com `command`/`url`, ou `claude mcp add …`. */
export function parseMcpInput(text: string): McpParseResult {
  const t = text.trim();
  if (!t) return { entries: [], error: "cole um .mcp.json ou um comando `claude mcp add`" };
  if (/^(\$\s*)?claude\s+mcp\s/.test(t) || /^(\$\s*)?mcp\s+add/.test(t)) return parseClaudeMcpAdd(t.replace(/^\$\s*/, ""));
  let json: unknown;
  try {
    json = JSON.parse(t);
  } catch {
    // fragmento colado de dentro do arquivo: `"nome": { … }`
    try {
      json = JSON.parse(`{${t.replace(/,\s*$/, "")}}`);
    } catch {
      return { entries: [], error: "não é um JSON válido nem um comando `claude mcp add`" };
    }
  }
  if (!json || typeof json !== "object" || Array.isArray(json)) return { entries: [], error: "esperado um objeto JSON" };
  const o = json as Record<string, unknown>;
  const servers = (o.mcpServers ?? o.servers) as Record<string, unknown> | undefined;
  const map = servers && typeof servers === "object" ? servers : "command" in o || "url" in o ? { servidor: o } : o;
  const entries: McpCatalogEntry[] = [];
  for (const [name, cfg] of Object.entries(map)) {
    const r = entryFromConfig(name, cfg);
    if (typeof r === "string") return { entries: [], error: r };
    entries.push(r);
  }
  return entries.length ? { entries } : { entries: [], error: "nenhum servidor encontrado" };
}
