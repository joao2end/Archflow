/**
 * Terminal PTY do bridge: caminho feliz (shell → eco) e as defesas contra WebSocket de outra origem / sem token.
 * Usa o shell do usuário, não o `claude`; tudo em pasta temporária.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import WebSocket from "ws";

const tmp = mkdtempSync(join(tmpdir(), "archflow-term-"));
const freePort = () =>
  new Promise<number>((ok, fail) => {
    const s = createServer();
    s.once("error", fail);
    s.listen(0, "127.0.0.1", () => {
      const p = (s.address() as { port: number }).port;
      s.close(() => ok(p));
    });
  });
const port = await freePort();
process.env.ARCHFLOW_PORT = String(port);
process.env.ARCHFLOW_CONFIG = join(tmp, "cfg");
process.env.ARCHFLOW_DATA = join(tmp, "data");
const { ensureBridge, stopBridge } = await import("./bridge");
await ensureBridge(port);
const BASE = `http://127.0.0.1:${port}`;

after(() => {
  stopBridge();
  rmSync(tmp, { recursive: true, force: true });
});

const info = async () => (await (await fetch(`${BASE}/api/term/info`)).json()) as { token: string; cwd: string };
const post = (path: string, token: string | undefined, body: unknown) =>
  fetch(BASE + path, { method: "POST", headers: { "Content-Type": "application/json", ...(token ? { "x-archflow-term": token } : {}) }, body: JSON.stringify(body) });
const open = (url: string, origin?: string) =>
  new Promise<{ ok: boolean; ws?: WebSocket }>((res) => {
    const ws = new WebSocket(url, origin ? { origin } : undefined);
    ws.once("open", () => res({ ok: true, ws }));
    ws.once("error", () => res({ ok: false }));
    ws.once("unexpected-response", () => res({ ok: false }));
  });

test("iniciar sem token é recusado", async () => {
  assert.equal((await post("/api/term/start", undefined, { program: "shell" })).status, 403);
  assert.equal((await post("/api/term/start", "errado", { program: "shell" })).status, 403);
});

test("shell ecoa pelo WebSocket de mesma origem com token", async () => {
  const { token } = await info();
  const r = await post("/api/term/start", token, { program: "shell" });
  assert.equal(r.status, 200, await r.clone().text());
  const s = (await r.json()) as { id: string };
  const { ok, ws } = await open(`ws://127.0.0.1:${port}/api/term?session=${s.id}&token=${token}`, BASE);
  assert.ok(ok, "deveria conectar");
  const out = await new Promise<string>((res) => {
    let acc = "";
    ws!.on("message", (m) => {
      const j = JSON.parse(String(m));
      if (j.t === "out") acc += j.d;
      if (/ARCHFLOW_3/.test(acc.replace(/echo[^\n]*/g, ""))) res(acc);
    });
    ws!.send(JSON.stringify({ t: "in", d: "echo ARCHFLOW_$((1+2))\r" }));
  });
  assert.match(out, /ARCHFLOW_3/);
  ws!.close();
  assert.equal(((await (await post("/api/term/kill", token, { id: s.id })).json()) as { ok: boolean }).ok, true);
});

test("WebSocket de outra origem, sem origem ou com token errado é recusado", async () => {
  const { token } = await info();
  const s = (await (await post("/api/term/start", token, { program: "shell" })).json()) as { id: string };
  const url = (t: string) => `ws://127.0.0.1:${port}/api/term?session=${s.id}&token=${t}`;
  assert.equal((await open(url(token), "http://evil.example")).ok, false);
  assert.equal((await open(url(token), "http://localhost:9999")).ok, false, "outra porta em localhost também é outra origem");
  assert.equal((await open(url(token))).ok, false, "sem Origin");
  assert.equal((await open(url("errado"), BASE)).ok, false);
  await post("/api/term/kill", token, { id: s.id });
});

test("detectClaude: acha, parseia a versão, cacheia e não acha", async () => {
  const { detectClaude, parseClaudeVersion } = await import("./terminal");
  assert.equal(parseClaudeVersion("2.1.0 (Claude Code)\n"), "2.1.0");
  assert.equal(parseClaudeVersion("sem versão"), undefined);
  let calls = 0;
  const ok = async () => (calls++, { stdout: "2.3.4 (Claude Code)" });
  assert.deepEqual(await detectClaude({ run: ok, refresh: true, now: 1000 }), { found: true, version: "2.3.4" });
  await detectClaude({ run: ok, now: 5000 });
  assert.equal(calls, 1, "dentro do TTL usa o cache");
  await detectClaude({ run: ok, now: 40_000 });
  assert.equal(calls, 2, "depois do TTL consulta de novo");
  const missing = await detectClaude({ run: async () => ({ error: "spawn claude ENOENT" }), refresh: true });
  assert.deepEqual(missing, { found: false, error: "spawn claude ENOENT" });
});

test("/api/term/info traz o status do claude e /api/harness/status responde fora do modo agents", async () => {
  const j = (await (await fetch(`${BASE}/api/term/info?refresh=1`)).json()) as { claude: { found: boolean } };
  assert.equal(typeof j.claude.found, "boolean");
  const st = (await (await fetch(`${BASE}/api/harness/status`)).json()) as { applicable: boolean; stale: string[] };
  assert.equal(st.applicable, false);
  assert.deepEqual(st.stale, []);
});

test("prefillReady: espera a saída parar e não digita em diálogo de confiança", async () => {
  const { prefillReady } = await import("./terminal");
  assert.equal(prefillReady("> ", 200), false, "ainda saindo texto");
  assert.equal(prefillReady("> ", 1200), true);
  assert.equal(prefillReady("Quick safety check ... Yes, I trust this folder", 5000), false, "diálogo de confiança");
  assert.equal(prefillReady("New MCP server found in .mcp.json", 5000), false, "aprovação de MCP");
});

test("prefill é digitado sem Enter na sessão (shell)", async () => {
  const { token } = await info();
  const r = await post("/api/term/start", token, { program: "shell", prefill: "echo PREFILL_SEM_ENTER" });
  const s = (await r.json()) as { id: string };
  const { ws } = await open(`ws://127.0.0.1:${port}/api/term?session=${s.id}&token=${token}`, BASE);
  const out = await new Promise<string>((res) => {
    let acc = "";
    ws!.on("message", (m) => {
      const j = JSON.parse(String(m));
      if (j.t === "out") acc += j.d;
      if (acc.includes("echo PREFILL_SEM_ENTER")) res(acc);
    });
    setTimeout(() => res(acc), 6000);
  });
  assert.ok(out.includes("echo PREFILL_SEM_ENTER"), "texto digitado");
  assert.ok(!/^PREFILL_SEM_ENTER/m.test(out.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "")), "não executou (sem Enter)");
  ws!.close();
  await post("/api/term/kill", token, { id: s.id });
});

test("limite de sessões: a seguinte responde 429 e fechar uma libera vaga", async () => {
  const { token, max } = (await (await fetch(`${BASE}/api/term/info`)).json()) as { token: string; max: number };
  const ids: string[] = [];
  for (let i = 0; i < max; i++) {
    const r = await post("/api/term/start", token, { program: "shell" });
    assert.equal(r.status, 200);
    ids.push(((await r.json()) as { id: string }).id);
  }
  const over = await post("/api/term/start", token, { program: "shell" });
  assert.equal(over.status, 429);
  assert.match(((await over.json()) as { error: string }).error, /no máximo/);
  await post("/api/term/kill", token, { id: ids[0] });
  const again = await post("/api/term/start", token, { program: "shell" });
  assert.equal(again.status, 200);
  ids.push(((await again.json()) as { id: string }).id);
  for (const id of ids.slice(1)) await post("/api/term/kill", token, { id });
});

test("claude fora do PATH: 424 com mensagem clara (e o shell continua funcionando)", async () => {
  const { token } = await info();
  const path = process.env.PATH;
  process.env.PATH = join(tmp, "vazio");
  try {
    await fetch(`${BASE}/api/term/info?refresh=1`); // refaz a detecção (cacheada) já sem o claude no PATH
    const r = await post("/api/term/start", token, { program: "claude" });
    assert.equal(r.status, 424);
    assert.match(((await r.json()) as { error: string }).error, /instalado e no PATH/);
  } finally {
    process.env.PATH = path;
    await fetch(`${BASE}/api/term/info?refresh=1`);
  }
});

test("sessões são do projeto: outro projeto não as vê, e elas voltam ao reabrir o primeiro", async () => {
  const api = async (p: string, body: unknown) => (await (await fetch(BASE + p, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })).json()) as any;
  const a = await api("/api/projects/create", { name: "ProjA", parent: tmp });
  const { token } = await info();
  const s = (await (await post("/api/term/start", token, { program: "shell" })).json()) as { id: string };
  const ids = async () => ((await (await fetch(`${BASE}/api/term/info`)).json()) as { sessions: { id: string }[] }).sessions.map((x) => x.id);
  assert.deepEqual(await ids(), [s.id]);
  await api("/api/projects/create", { name: "ProjB", parent: tmp });
  assert.deepEqual(await ids(), [], "projeto B não vê a sessão do A");
  await api("/api/projects/switch", { id: a.project.id });
  assert.deepEqual(await ids(), [s.id], "ao voltar ao A a sessão (viva) reaparece");
  await post("/api/term/kill", token, { id: s.id });
});

test("sanitizeClaudeArgs: só o formato fixo do passo automático; nada de flags perigosas", async () => {
  const { sanitizeClaudeArgs } = await import("./terminal");
  const id = "123e4567-e89b-42d3-a456-426614174000";
  assert.deepEqual(sanitizeClaudeArgs(undefined), []);
  assert.deepEqual(sanitizeClaudeArgs([]), []);
  assert.deepEqual(sanitizeClaudeArgs(["-p", "--session-id", id, "--", "faça x"]), ["-p", "--session-id", id, "--", "faça x"]);
  assert.deepEqual(sanitizeClaudeArgs(["-p", "--resume", id, "--permission-mode", "acceptEdits", "--", "-começa com hífen"]), ["-p", "--resume", id, "--permission-mode", "acceptEdits", "--", "-começa com hífen"]);
  assert.deepEqual(sanitizeClaudeArgs(["--session-id", id]), ["--session-id", id], "interativo (passo manual)");
  assert.deepEqual(sanitizeClaudeArgs(["--resume", id, "--permission-mode", "plan"]), ["--resume", id, "--permission-mode", "plan"]);
  assert.deepEqual(sanitizeClaudeArgs(["-p", "--resume", id, "--allowedTools", "WebSearch,mcp__playwright", "--", "x"]), ["-p", "--resume", id, "--allowedTools", "WebSearch,mcp__playwright", "--", "x"]);
  for (const t of ["Bash", "Write", "WebSearch,Bash", "Bash(rm:*)", "", "mcp__"]) assert.throws(() => sanitizeClaudeArgs(["-p", "--resume", id, "--allowedTools", t, "--", "x"]), /não permitidos/, t);
  const ruins: string[][] = [
    ["--resume", id, "--", "x"],
    ["--session-id", id, "--dangerously-skip-permissions"],
    ["--resume", id, "--permission-mode", "bypassPermissions"],
    ["--session-id", id, "extra"],
    ["--continue"],
    ["--dangerously-skip-permissions"],
    ["-p", "--session-id", id, "--dangerously-skip-permissions", "--", "x"],
    ["-p", "--session-id", "nao-uuid", "--", "x"],
    ["-p", "--session-id", id, "--permission-mode", "bypassPermissions", "--", "x"],
    ["-p", "--session-id", id, "--permission-mode", "dontAsk", "--", "x"],
    ["-p", "--session-id", id, "--mcp-config", "x.json", "--", "x"],
    ["-p", "--session-id", id, "x"],
    ["-p", "--session-id", id, "--", "   "],
    ["-p", "--session-id", id, "--", "a", "extra"],
    ["-p", "--session-id", id, "--", "x".repeat(40_001)],
    ["--resume", id, "-p", "--", "x"],
  ];
  for (const r of ruins) assert.throws(() => sanitizeClaudeArgs(r), /não permitidos/, JSON.stringify(r).slice(0, 80));
});

test("passo automático: claude (falso) recebe os argumentos e o código de saída chega pelo WebSocket", async () => {
  const { writeFileSync: wf, mkdirSync: mk, chmodSync } = await import("node:fs");
  const bin = join(tmp, "fakebin");
  mk(bin, { recursive: true });
  // o passo automático roda com --output-format stream-json --verbose e manda o texto pelo stdin (withStreamFlags)
  wf(join(bin, "claude"), '#!/bin/sh\nif [ "$1" = "--version" ]; then echo "9.9.9"; exit 0; fi\nt=$(cat)\necho "ARGS:$#:$1:$2:$4:$5:$t"\ncase "$t" in *FALHA*) exit 3;; esac\nexit 0\n');
  chmodSync(join(bin, "claude"), 0o755);
  const oldPath = process.env.PATH;
  process.env.PATH = `${bin}:${oldPath}`;
  try {
    await fetch(`${BASE}/api/term/info?refresh=1`);
    const { token } = await info();
    const id = "123e4567-e89b-42d3-a456-426614174000";
    for (const [texto, code] of [["tudo certo", 0], ["vai dar FALHA", 3]] as const) {
      const r = await post("/api/term/start", token, { program: "claude", args: ["-p", "--session-id", id, "--", texto] });
      assert.equal(r.status, 200, await r.clone().text());
      const s = (await r.json()) as { id: string };
      const { ws } = await open(`ws://127.0.0.1:${port}/api/term?session=${s.id}&token=${token}`, BASE);
      const got = await new Promise<{ out: string; code: number }>((res) => {
        let out = "";
        ws!.on("message", (m) => {
          const j = JSON.parse(String(m));
          if (j.t === "out") out += j.d;
          if (j.t === "exit") res({ out, code: j.code });
        });
        setTimeout(() => res({ out, code: -999 }), 8000);
      });
      assert.match(got.out, new RegExp(`ARGS:6:-p:--session-id:--output-format:stream-json:${texto}`));
      assert.equal(got.code, code);
      ws!.close();
      await post("/api/term/kill", token, { id: s.id });
    }
    const ruim = await post("/api/term/start", token, { program: "claude", args: ["--dangerously-skip-permissions"] });
    assert.equal(ruim.status, 400);
  } finally {
    process.env.PATH = oldPath;
    await fetch(`${BASE}/api/term/info?refresh=1`);
  }
});

/**
 * Passos automáticos de workflow com o Claude Code de verdade: `-p --session-id` e depois `-p --resume` retomando a
 * MESMA conversa. Fora da suíte padrão (precisa da CLI `claude` autenticada, rede, e gasta um pouco de crédito):
 *   ARCHFLOW_E2E_CLAUDE=1 npx tsx --test server/terminal.e2e.test.ts
 */
test("claude real: -p --session-id e -p --resume continuam a mesma conversa", { skip: process.env.ARCHFLOW_E2E_CLAUDE !== "1", timeout: 240_000 }, async () => {
  const { randomUUID } = await import("node:crypto");
  const { token } = await info();
  const id = randomUUID();
  const run = async (args: string[]) => {
    const r = await post("/api/term/start", token, { program: "claude", args });
    assert.equal(r.status, 200, await r.clone().text());
    const s = (await r.json()) as { id: string };
    const { ws } = await open(`ws://127.0.0.1:${port}/api/term?session=${s.id}&token=${token}`, BASE);
    const res = await new Promise<{ out: string; code: number }>((ok) => {
      let out = "";
      ws!.on("message", (m) => {
        const j = JSON.parse(String(m));
        if (j.t === "out") out += j.d;
        if (j.t === "exit") ok({ out, code: j.code });
      });
      setTimeout(() => ok({ out, code: -999 }), 200_000);
    });
    ws!.close();
    await post("/api/term/kill", token, { id: s.id });
    return res;
  };
  const a = await run(["-p", "--session-id", id, "--", "Memorize a palavra-secreta BANANAFLOW. Responda apenas: ok"]);
  assert.equal(a.code, 0, a.out);
  const b = await run(["-p", "--resume", id, "--", "Qual era a palavra-secreta que pedi para memorizar? Responda apenas a palavra."]);
  assert.equal(b.code, 0, b.out);
  assert.match(b.out, /BANANAFLOW/);
});

test("conversationExists: só existe depois de gravada; id inválido nunca", async () => {
  const { conversationExists } = await import("./terminal");
  const { mkdirSync: mk, writeFileSync: wf } = await import("node:fs");
  const cfg = join(tmp, "claude-cfg");
  const id = "123e4567-e89b-42d3-a456-426614174111";
  assert.equal(conversationExists(id, cfg), false, "sem a pasta de conversas");
  mk(join(cfg, "projects", "-pasta-qualquer"), { recursive: true });
  assert.equal(conversationExists(id, cfg), false);
  wf(join(cfg, "projects", "-pasta-qualquer", `${id}.jsonl`), "{}\n");
  assert.equal(conversationExists(id, cfg), true);
  assert.equal(conversationExists("../../etc/passwd", cfg), false);
  const j = (await (await fetch(`${BASE}/api/term/conversation?id=nao-uuid`)).json()) as { exists: boolean };
  assert.equal(j.exists, false);
});
