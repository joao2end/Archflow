import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { parseProbeBody, probeMcp, ProbeError } from "./mcpprobe";

const fixture = join(fileURLToPath(new URL(".", import.meta.url)), "fixtures", "fake-mcp-server.mjs");
const node = process.execPath;
const stdio = (env: Record<string, string> = {}) => ({ transport: "stdio" as const, command: node, args: [fixture], env });

test("stdio: handshake e tools/list, com o nome e a versão do servidor", async () => {
  const r = await probeMcp(stdio(), { timeoutMs: 5000 });
  assert.deepEqual(r.tools.map((t) => t.name), ["browser_navigate", "browser_click", "browser_snapshot"]);
  assert.equal(r.tools[0].description, "Navega para uma URL.");
  assert.equal(r.tools[2].description, undefined);
  assert.deepEqual(r.server, { name: "fake-mcp", version: "9.9.9" });
});

test("stdio: segue a paginação de tools/list", async () => {
  const r = await probeMcp(stdio({ FAKE_MCP_MODE: "pages" }), { timeoutMs: 5000 });
  assert.equal(r.tools.length, 3);
});

test("stdio: a variável ${VAR} chega ao processo (expandida do ambiente) e o valor não vaza", async () => {
  const env = { PROBE_TESTE_OK: "1" } as NodeJS.ProcessEnv;
  const r = await probeMcp(stdio({ FAKE_REQUIRED: "${PROBE_TESTE_OK}" }), { timeoutMs: 5000, env: { ...process.env, ...env } });
  assert.equal(r.tools.length, 3);
  await assert.rejects(probeMcp(stdio({ FAKE_REQUIRED: "${PROBE_TESTE_AUSENTE:-0}" }), { timeoutMs: 5000 }), /encerrou antes de responder \(código 2\): FAKE_REQUIRED inválida/);
});

test("stdio: o segredo que o servidor imprime no erro é mascarado de volta para ${NOME}", async () => {
  const spec = stdio({ FAKE_MCP_MODE: "crash", FAKE_SECRET: "${PROBE_TESTE_SEGREDO}" });
  const env = { ...process.env, PROBE_TESTE_SEGREDO: "ghp_super_secreto_123" };
  const err = await probeMcp(spec, { timeoutMs: 5000, env }).catch((e) => e as Error);
  assert.ok(err instanceof ProbeError);
  assert.match(err.message, /\$\{PROBE_TESTE_SEGREDO\}/);
  assert.ok(!err.message.includes("ghp_super_secreto_123"), err.message);
});

test("stdio: servidor que não responde estoura o tempo e o processo é encerrado", async () => {
  const t0 = Date.now();
  await assert.rejects(probeMcp(stdio({ FAKE_MCP_MODE: "hang" }), { timeoutMs: 600 }), /não respondeu a tempo/);
  assert.ok(Date.now() - t0 < 3000);
});

test("stdio: comando inexistente e spec incompleta dão mensagens claras", async () => {
  await assert.rejects(probeMcp({ transport: "stdio", command: "comando-que-nao-existe-archflow" }, { timeoutMs: 3000 }), /não deu para executar «comando-que-nao-existe-archflow»/);
  await assert.rejects(probeMcp({ transport: "stdio" }), /sem command/);
});

/* ───────── http ───────── */

const servers: Server[] = [];
after(() => servers.forEach((s) => s.close()));

function httpServer(mode: "json" | "sse", seen: { auth?: string; session?: string[] } = {}): Promise<string> {
  const read = (req: IncomingMessage) => new Promise<string>((ok) => { let b = ""; req.on("data", (d) => (b += d)); req.on("end", () => ok(b)); });
  const s = createServer(async (req, res) => {
    const msg = JSON.parse(await read(req));
    seen.auth = String(req.headers.authorization ?? "");
    (seen.session ??= []).push(String(req.headers["mcp-session-id"] ?? ""));
    if (req.headers.authorization !== "Bearer tok-http-123") return void (res.writeHead(401), res.end());
    if (msg.id === undefined) return void (res.writeHead(202), res.end());
    const result = msg.method === "initialize" ? { serverInfo: { name: "fake-http", version: "1.0.0" } } : { tools: [{ name: "buscar", description: "Busca algo." }] };
    const payload = JSON.stringify({ jsonrpc: "2.0", id: msg.id, result });
    const headers: Record<string, string> = { "mcp-session-id": "sess-1" };
    if (mode === "sse") (res.writeHead(200, { ...headers, "Content-Type": "text/event-stream" }), res.end(`event: message\ndata: ${payload}\n\n`));
    else (res.writeHead(200, { ...headers, "Content-Type": "application/json" }), res.end(payload));
  });
  servers.push(s);
  return new Promise((ok) => s.listen(0, "127.0.0.1", () => ok(`http://127.0.0.1:${(s.address() as { port: number }).port}/mcp`)));
}

for (const mode of ["json", "sse"] as const) {
  test(`http (${mode}): headers expandidos, sessão reaproveitada e tools lidas`, async () => {
    const seen: { auth?: string; session?: string[] } = {};
    const url = await httpServer(mode, seen);
    const r = await probeMcp({ transport: "http", url, headers: { Authorization: "Bearer ${PROBE_HTTP_TOKEN}" } }, { timeoutMs: 5000, env: { ...process.env, PROBE_HTTP_TOKEN: "tok-http-123" } });
    assert.deepEqual(r.tools, [{ name: "buscar", description: "Busca algo." }]);
    assert.deepEqual(r.server, { name: "fake-http", version: "1.0.0" });
    assert.equal(seen.session?.at(-1), "sess-1", "depois do initialize, a sessão volta nos pedidos");
  });
}

test("http: 401 aponta para o token e não mostra o valor", async () => {
  const url = await httpServer("json");
  const err = await probeMcp({ transport: "http", url, headers: { Authorization: "Bearer ${PROBE_HTTP_ERRADO}" } }, { timeoutMs: 5000, env: { ...process.env, PROBE_HTTP_ERRADO: "tok-errado-999" } }).then(
    () => new Error("deveria falhar"),
    (e: Error) => e,
  );
  assert.match(err.message, /respondeu 401 \(confira o token em headers\)/);
  assert.ok(!err.message.includes("tok-errado-999"));
});

test("http: url inválida e servidor fora do ar", async () => {
  await assert.rejects(probeMcp({ transport: "http", url: "ftp://x" }), /url http\(s\)/);
  await assert.rejects(probeMcp({ transport: "http", url: "http://127.0.0.1:1/mcp" }, { timeoutMs: 2000 }), /não deu para conectar/);
});

/* ───────── corpo da rota ───────── */

test("parseProbeBody: valida os campos e só aceita confirm === true", () => {
  assert.equal(parseProbeBody({ command: "npx" }).confirm, false);
  assert.equal(parseProbeBody({ command: "npx", confirm: "true" }).confirm, false);
  assert.equal(parseProbeBody({ command: "npx", args: ["-y"], confirm: true }).confirm, true);
  assert.throws(() => parseProbeBody({ command: 1 }), /command deve ser texto/);
  assert.throws(() => parseProbeBody({ args: "x" }), /args deve ser uma lista/);
  assert.throws(() => parseProbeBody({ env: { A: 1 } }), /env deve ser um objeto de textos/);
  assert.throws(() => parseProbeBody({ transport: "ws" }), /transport deve ser/);
});
