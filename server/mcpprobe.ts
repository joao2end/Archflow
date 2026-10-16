/**
 * Sonda de servidor MCP: conecta, faz o handshake (`initialize` + `notifications/initialized`) e lê `tools/list`.
 *
 * ATENÇÃO — isto EXECUTA o comando do servidor (stdio) ou conecta numa URL. Quem chama (a rota do bridge) só pode
 * chegar aqui com confirmação explícita do usuário. Garantias que este módulo dá:
 *  - `${VAR}` / `${VAR:-padrão}` são expandidos do ambiente do Archflow, mas o VALOR nunca sai: mensagens de erro e
 *    saída do processo têm os valores trocados de volta por `${VAR}`;
 *  - timeout total (o processo é morto, SIGTERM e depois SIGKILL) e limite de tamanho de saída e de páginas;
 *  - sem shell (no Windows `npx` é um .cmd, então lá usa shell) e o processo não herda stdin do bridge.
 */
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

export interface ProbeSpec {
  transport?: "stdio" | "http" | "sse";
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
  headers?: Record<string, string>;
}

export interface ProbeTool {
  name: string;
  description?: string;
}

export interface ProbeResult {
  tools: ProbeTool[];
  server?: { name?: string; version?: string };
}

export interface ProbeOptions {
  timeoutMs?: number;
  /** ambiente de onde as `${VAR}` são lidas (padrão: process.env) */
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  fetchImpl?: typeof fetch;
}

const PROTOCOL = "2025-06-18";
const MAX_TOOLS = 500;
const MAX_PAGES = 10;
const MAX_BUFFER = 1_000_000;

/** Erro com mensagem já segura para mostrar ao usuário. */
export class ProbeError extends Error {}

/* ───────── variáveis e máscara ───────── */

interface Expander {
  expand: (s: string) => string;
  /** troca de volta os valores expandidos por `${NOME}` */
  mask: (s: string) => string;
}

function expander(env: NodeJS.ProcessEnv): Expander {
  const used = new Map<string, string>();
  const expand = (s: string) =>
    s.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}/g, (_, name: string, def?: string) => {
      const v = env[name];
      if (v) {
        used.set(name, v);
        return v;
      }
      return def ?? "";
    });
  const mask = (s: string) => {
    let out = s;
    for (const [name, value] of used) if (value.length >= 4) out = out.split(value).join(`\${${name}}`);
    return out;
  };
  return { expand, mask };
}

const expandMap = (m: Record<string, string> | undefined, x: Expander) => Object.fromEntries(Object.entries(m ?? {}).map(([k, v]) => [k, x.expand(v)]));

const tail = (s: string, n = 400) => (s.length > n ? `…${s.slice(-n)}` : s).trim();

function parseTools(result: unknown): { tools: ProbeTool[]; next?: string } {
  const r = result as { tools?: { name?: unknown; description?: unknown }[]; nextCursor?: unknown } | undefined;
  const tools = (r?.tools ?? []).filter((t) => typeof t?.name === "string").map((t) => ({ name: t.name as string, ...(typeof t.description === "string" && t.description ? { description: t.description.slice(0, 200) } : {}) }));
  return { tools, next: typeof r?.nextCursor === "string" && r.nextCursor ? r.nextCursor : undefined };
}

/* ───────── stdio ───────── */

async function probeStdio(spec: ProbeSpec, opts: ProbeOptions, x: Expander, deadline: number): Promise<ProbeResult> {
  const command = spec.command?.trim();
  if (!command) throw new ProbeError("servidor stdio sem command");
  const baseEnv = opts.env ?? process.env;
  const env = { ...baseEnv, ...expandMap(spec.env, x) };
  const args = (spec.args ?? []).map((a) => x.expand(a));
  let child: ChildProcessWithoutNullStreams;
  try {
    child = spawn(x.expand(command), args, { env, cwd: opts.cwd, stdio: ["pipe", "pipe", "pipe"], shell: process.platform === "win32", windowsHide: true });
  } catch (e) {
    throw new ProbeError(`não deu para iniciar o comando: ${x.mask(e instanceof Error ? e.message : String(e))}`);
  }
  let stderr = "";
  let exited: { code: number | null; signal: NodeJS.Signals | null } | undefined;
  let spawnError: Error | undefined;
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  const fail = (e: Error) => pending.forEach((p) => p.reject(e));
  child.stderr.on("data", (d: Buffer) => (stderr = (stderr + d.toString()).slice(-4000)));
  child.on("error", (e) => {
    spawnError = e;
    fail(new ProbeError(`não deu para executar «${command}»: ${x.mask(e.message)}`));
  });
  child.on("exit", (code, signal) => {
    exited = { code, signal };
    fail(new ProbeError(`o servidor encerrou antes de responder (código ${code ?? signal})${stderr.trim() ? `: ${x.mask(tail(stderr))}` : ""}`));
  });
  let buf = "";
  child.stdout.on("data", (d: Buffer) => {
    buf += d.toString();
    if (buf.length > MAX_BUFFER) return void (buf = "");
    let i: number;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      try {
        const msg = JSON.parse(line) as { id?: number; result?: unknown; error?: { message?: string } };
        if (typeof msg.id === "number" && pending.has(msg.id)) {
          const p = pending.get(msg.id)!;
          pending.delete(msg.id);
          if (msg.error) p.reject(new ProbeError(`o servidor recusou: ${x.mask(msg.error.message ?? "erro sem mensagem")}`));
          else p.resolve(msg.result);
        }
      } catch {
        /* linha que não é JSON-RPC (log do servidor): ignora */
      }
    }
  });
  const write = (m: object) => void child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", ...m })}\n`);
  let seq = 0;
  const request = (method: string, params?: object) =>
    new Promise<unknown>((resolve, reject) => {
      if (spawnError || exited) return reject(new ProbeError("o servidor já encerrou"));
      const id = ++seq;
      pending.set(id, { resolve, reject });
      write({ id, method, ...(params ? { params } : {}) });
    });
  const timeout = new Promise<never>((_, reject) => {
    const t = setTimeout(() => reject(new ProbeError(`o servidor não respondeu a tempo${stderr.trim() ? `: ${x.mask(tail(stderr))}` : ""}`)), Math.max(50, deadline - Date.now()));
    t.unref();
  });
  const kill = () => {
    try {
      child.stdin.end();
      child.kill("SIGTERM");
      setTimeout(() => child.exitCode === null && child.kill("SIGKILL"), 1500).unref();
    } catch {
      /* já morreu */
    }
  };
  try {
    return await Promise.race([
      (async (): Promise<ProbeResult> => {
        const init = (await request("initialize", { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: "archflow", version: "1" } })) as { serverInfo?: { name?: string; version?: string } } | undefined;
        write({ method: "notifications/initialized" });
        const tools: ProbeTool[] = [];
        let cursor: string | undefined;
        for (let page = 0; page < MAX_PAGES && tools.length < MAX_TOOLS; page++) {
          const r = parseTools(await request("tools/list", cursor ? { cursor } : {}));
          tools.push(...r.tools);
          if (!(cursor = r.next)) break;
        }
        return { tools: tools.slice(0, MAX_TOOLS), ...(init?.serverInfo ? { server: { name: init.serverInfo.name, version: init.serverInfo.version } } : {}) };
      })(),
      timeout,
    ]);
  } finally {
    kill();
  }
}

/* ───────── http ───────── */

/** Lê a resposta JSON-RPC de um POST MCP, que pode vir como JSON ou como SSE (`data: {...}`). */
async function rpcResult(res: Response, id: number, x: Expander): Promise<unknown> {
  const text = await res.text();
  const candidates = (res.headers.get("content-type") ?? "").includes("text/event-stream")
    ? text.split(/\r?\n/).filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim())
    : [text];
  for (const c of candidates) {
    try {
      const msg = JSON.parse(c) as { id?: number; result?: unknown; error?: { message?: string } };
      if (msg.id !== id) continue;
      if (msg.error) throw new ProbeError(`o servidor recusou: ${x.mask(msg.error.message ?? "erro sem mensagem")}`);
      return msg.result;
    } catch (e) {
      if (e instanceof ProbeError) throw e;
    }
  }
  throw new ProbeError("resposta do servidor não é JSON-RPC válido");
}

async function probeHttp(spec: ProbeSpec, opts: ProbeOptions, x: Expander, deadline: number): Promise<ProbeResult> {
  const url = x.expand(spec.url?.trim() ?? "");
  if (!/^https?:\/\//i.test(url)) throw new ProbeError("servidor http precisa de uma url http(s)");
  const doFetch = opts.fetchImpl ?? fetch;
  const headers = expandMap(spec.headers, x);
  let session: string | undefined;
  let seq = 0;
  const post = async (body: object, expectId?: number) => {
    let res: Response;
    try {
      res = await doFetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", "MCP-Protocol-Version": PROTOCOL, ...headers, ...(session ? { "Mcp-Session-Id": session } : {}) },
        body: JSON.stringify({ jsonrpc: "2.0", ...body }),
        signal: AbortSignal.timeout(Math.max(50, deadline - Date.now())),
      });
    } catch (e) {
      const name = e instanceof Error ? e.name : "";
      throw new ProbeError(name === "TimeoutError" || name === "AbortError" ? "o servidor não respondeu a tempo" : `não deu para conectar: ${x.mask(e instanceof Error ? e.message : String(e))}`);
    }
    if (!res.ok) throw new ProbeError(`o servidor respondeu ${res.status}${res.status === 401 || res.status === 403 ? " (confira o token em headers)" : ""}`);
    session = res.headers.get("mcp-session-id") ?? session;
    return expectId === undefined ? undefined : rpcResult(res, expectId, x);
  };
  const init = (await post({ id: ++seq, method: "initialize", params: { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: "archflow", version: "1" } } }, seq)) as { serverInfo?: { name?: string; version?: string } } | undefined;
  await post({ method: "notifications/initialized" });
  const tools: ProbeTool[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < MAX_PAGES && tools.length < MAX_TOOLS; page++) {
    const id = ++seq;
    const r = parseTools(await post({ id, method: "tools/list", params: cursor ? { cursor } : {} }, id));
    tools.push(...r.tools);
    if (!(cursor = r.next)) break;
  }
  return { tools: tools.slice(0, MAX_TOOLS), ...(init?.serverInfo ? { server: { name: init.serverInfo.name, version: init.serverInfo.version } } : {}) };
}

/** Conecta no servidor descrito por `spec` e devolve as tools. Lança `ProbeError` com mensagem segura. */
export async function probeMcp(spec: ProbeSpec, opts: ProbeOptions = {}): Promise<ProbeResult> {
  const x = expander(opts.env ?? process.env);
  const deadline = Date.now() + (opts.timeoutMs ?? 10_000);
  const transport = spec.transport ?? (spec.url && !spec.command ? "http" : "stdio");
  return transport === "stdio" ? probeStdio(spec, opts, x, deadline) : probeHttp(spec, opts, x, deadline);
}

/** Valida o corpo de `POST /api/mcp/probe` e devolve a spec; lança `ProbeError` com a explicação. */
export function parseProbeBody(body: unknown): { spec: ProbeSpec; confirm: boolean } {
  const b = (body ?? {}) as Record<string, unknown>;
  const strMap = (v: unknown, name: string) => {
    if (v === undefined) return undefined;
    if (!v || typeof v !== "object" || Array.isArray(v) || Object.values(v).some((x) => typeof x !== "string")) throw new ProbeError(`${name} deve ser um objeto de textos`);
    return v as Record<string, string>;
  };
  if (b.transport !== undefined && !["stdio", "http", "sse"].includes(b.transport as string)) throw new ProbeError('transport deve ser "stdio", "http" ou "sse"');
  if (b.command !== undefined && typeof b.command !== "string") throw new ProbeError("command deve ser texto");
  if (b.url !== undefined && typeof b.url !== "string") throw new ProbeError("url deve ser texto");
  if (b.args !== undefined && (!Array.isArray(b.args) || b.args.some((a) => typeof a !== "string"))) throw new ProbeError("args deve ser uma lista de textos");
  return {
    confirm: b.confirm === true,
    spec: { transport: b.transport as ProbeSpec["transport"], command: b.command as string | undefined, url: b.url as string | undefined, args: b.args as string[] | undefined, env: strMap(b.env, "env"), headers: strMap(b.headers, "headers") },
  };
}
