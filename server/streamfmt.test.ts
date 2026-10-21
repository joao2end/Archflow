import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { createStreamFormatter, formatEvent, summarizeInput } from "./streamfmt";
import { spawnPiped, withStreamFlags } from "./terminal";

// eslint-disable-next-line no-control-regex
const plain = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");
const line = (o: unknown) => `${JSON.stringify(o)}\n`;

test("summarizeInput: primeiro campo conhecido, senão JSON cortado", () => {
  assert.equal(summarizeInput({ file_path: "/a/b.ts", x: 1 }), "/a/b.ts");
  assert.equal(summarizeInput({ query: "vue gsap" }), "vue gsap");
  assert.equal(summarizeInput({ foo: 1 }), '{"foo":1}');
  assert.equal(summarizeInput({}), "");
  assert.equal(summarizeInput(undefined), "");
});

test("formatEvent: texto, tool_use, tool_result e resultado final", () => {
  assert.equal(plain(formatEvent({ type: "system", subtype: "init", model: "claude-x" })), "sessão iniciada · claude-x\r\n");
  assert.equal(plain(formatEvent({ type: "assistant", message: { content: [{ type: "text", text: "Olá\nmundo" }, { type: "tool_use", name: "WebSearch", input: { query: "landing" } }] } })), "Olá\r\nmundo\r\n● WebSearch(landing)\r\n");
  assert.equal(plain(formatEvent({ type: "user", message: { content: [{ type: "tool_result", content: [{ type: "text", text: "a\n b" }] }] } })), "  ⎿ a b\r\n");
  assert.match(plain(formatEvent({ type: "user", message: { content: [{ type: "tool_result", is_error: true, content: "negado" }] } })), /erro: negado/);
  assert.match(plain(formatEvent({ type: "result", subtype: "success", duration_ms: 4200, total_cost_usd: 0.123 })), /✓ concluído em 4s · US\$ 0\.12/);
  assert.match(plain(formatEvent({ type: "result", subtype: "error_max_turns", is_error: true, result: "limite" })), /✗ falhou[\s\S]*limite/);
  assert.equal(formatEvent({ type: "stream_event" }), "");
});

test("createStreamFormatter: junta pedaços, ignora linha vazia e repassa o que não é JSON", () => {
  const f = createStreamFormatter();
  const ev = line({ type: "assistant", message: { content: [{ type: "text", text: "oi" }] } });
  assert.equal(f(ev.slice(0, 20)), "");
  assert.equal(plain(f(ev.slice(20))), "oi\r\n");
  assert.equal(f("\r\n"), "");
  assert.equal(f("Error: algo deu errado\r\n"), "Error: algo deu errado\r\n");
  assert.equal(f("{ quebrado\n"), "{ quebrado\r\n");
});

test("withStreamFlags: stream-json entra nos argumentos e o texto sai do argv (vai pelo stdin)", () => {
  assert.deepEqual(withStreamFlags(["-p", "--resume", "id", "--", "x"]), { args: ["-p", "--resume", "id", "--output-format", "stream-json", "--verbose"], text: "x" });
  assert.deepEqual(withStreamFlags(["-p", "--resume", "id"]).text, "");
});

test("spawnPiped: linhas JSON compridas chegam inteiras e traduzidas, o texto vai pelo stdin e o código de saída volta", async () => {
  const long = "a".repeat(5000);
  const script = `let t="";process.stdin.on("data",d=>t+=d).on("end",()=>{const L=(o)=>console.log(JSON.stringify(o));L({type:"assistant",message:{content:[{type:"text",text:"recebi:"+t+":${long}"}]}});L({type:"result",subtype:"success",duration_ms:1000});process.exit(3)})`;
  const p = spawnPiped(process.execPath, ["-e", script], "olá mundo", process.cwd());
  let out = "";
  p.onData((d) => (out += d));
  const code = await new Promise<number>((ok) => p.onExit((e) => ok(e.exitCode)));
  assert.equal(code, 3);
  assert.ok(plain(out).includes(`recebi:olá mundo:${long}`), "linha longa inteira");
  assert.match(plain(out), /✓ concluído em 1s/);
});

test("lastAssistantText: última resposta de texto do agente principal, sem subagentes nem chamadas de ferramenta", async () => {
  const { lastAssistantText } = await import("./terminal");
  const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const cfg = mkdtempSync(join(tmpdir(), "archflow-cfg-"));
  const id = "123e4567-e89b-42d3-a456-426614174000";
  mkdirSync(join(cfg, "projects", "pasta"), { recursive: true });
  const L = (o: unknown) => JSON.stringify(o);
  writeFileSync(
    join(cfg, "projects", "pasta", `${id}.jsonl`),
    [
      L({ type: "user", message: { content: "oi" } }),
      L({ type: "assistant", message: { content: [{ type: "text", text: "resposta certa" }] } }),
      L({ type: "assistant", isSidechain: true, message: { content: [{ type: "text", text: "do subagente" }] } }),
      L({ type: "assistant", message: { content: [{ type: "tool_use", name: "Read", input: {} }] } }),
      "linha quebrada {",
    ].join("\n"),
  );
  assert.equal(lastAssistantText(id, cfg), "resposta certa");
  assert.equal(lastAssistantText("nao-uuid", cfg), undefined);
  assert.equal(lastAssistantText("00000000-0000-4000-8000-000000000000", cfg), undefined);
  rmSync(cfg, { recursive: true, force: true });
});

test("ARCHFLOW_CLAUDE_BIN: um caminho absoluto existente substitui o claude do PATH; caminho inválido é ignorado", async () => {
  const { resolveClaudeCommand } = await import("./terminal");
  const prev = process.env.ARCHFLOW_CLAUDE_BIN;
  try {
    process.env.ARCHFLOW_CLAUDE_BIN = process.execPath;
    assert.equal(resolveClaudeCommand(), process.execPath);
    process.env.ARCHFLOW_CLAUDE_BIN = "relativo/claude";
    assert.notEqual(resolveClaudeCommand(), "relativo/claude");
    process.env.ARCHFLOW_CLAUDE_BIN = join(process.cwd(), "nao-existe", "claude");
    assert.notEqual(resolveClaudeCommand(), process.env.ARCHFLOW_CLAUDE_BIN);
  } finally {
    if (prev === undefined) delete process.env.ARCHFLOW_CLAUDE_BIN;
    else process.env.ARCHFLOW_CLAUDE_BIN = prev;
  }
});
