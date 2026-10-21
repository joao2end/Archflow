#!/usr/bin/env node
/**
 * `claude` de mentira para testar os workflows sem gastar tokens (usado pelo loop de revisão, docs/WORKFLOW_REVIEW_LOOP_PROMPT.md).
 * Imita só o que o Archflow usa:
 *   --version                         → "9.9.9 (fake)"
 *   -p [--session-id|--resume <id>] [--output-format stream-json --verbose] [--allowedTools …] [--permission-mode …] [-- texto]
 *                                     → texto pelo stdin (ou após `--`); emite eventos stream-json e grava a conversa em
 *                                       $CLAUDE_CONFIG_DIR/projects/fake/<id>.jsonl (é de lá que o workflow lê a «memória»)
 *   interativo (sem -p)               → mostra «❯ », responde a cada linha digitada e grava na mesma conversa
 * Controles: FAKE_CLAUDE_DELAY_MS (padrão 300) · texto com «FALHAR» → termina com erro (código 1) ·
 *            texto com «NEGAR» → a ferramenta WebSearch volta «permission denied» quando não estiver em --allowedTools ·
 *            texto com «GRAVAR:<caminho>» (um ou mais) → grava o arquivo, relativo à pasta atual (saídas esperadas, `expects`).
 */
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

const argv = process.argv.slice(2);
if (argv.includes("--version")) {
  console.log("9.9.9 (fake)");
  process.exit(0);
}

const print = argv[0] === "-p";
const flagVal = (f) => {
  const i = argv.indexOf(f);
  return i >= 0 ? argv[i + 1] : undefined;
};
const sessionId = flagVal("--session-id") ?? flagVal("--resume") ?? randomUUID();
const allowed = (flagVal("--allowedTools") ?? "").split(",").filter(Boolean);
const delay = Number(process.env.FAKE_CLAUDE_DELAY_MS ?? 300);
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
const dir = join(process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude"), "projects", "fake");
mkdirSync(dir, { recursive: true });
const file = join(dir, `${sessionId}.jsonl`);
const save = (o) => appendFileSync(file, `${JSON.stringify({ sessionId, ...o })}\n`);
let turn = 0;

/** Uma rodada: grava o pedido, simula uma ferramenta e responde. Devolve false quando o pedido manda falhar. */
async function answer(text, emit) {
  turn++;
  save({ type: "user", message: { role: "user", content: text } });
  const deny = text.includes("NEGAR") && !allowed.includes("WebSearch");
  emit({ type: "assistant", message: { content: [{ type: "tool_use", id: `t${turn}`, name: "WebSearch", input: { query: text.slice(0, 60) } }] } });
  await sleep(delay);
  emit({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: `t${turn}`, is_error: deny, content: deny ? "permission denied: WebSearch" : "3 resultados (fake)" }] } });
  // como o claude real, a negação fica gravada na conversa (é de lá que o canvas descobre o passo bloqueado)
  if (deny) save({ type: "user", timestamp: new Date().toISOString(), message: { role: "user", content: [{ type: "tool_result", tool_use_id: `t${turn}`, is_error: true, content: "permission denied: WebSearch" }] } });
  await sleep(delay);
  if (text.includes("FALHAR")) return false;
  for (const [, rel] of text.matchAll(/GRAVAR:(\S+)/g)) {
    mkdirSync(dirname(join(process.cwd(), rel)), { recursive: true });
    writeFileSync(join(process.cwd(), rel), `gerado pelo fake-claude (turno ${turn})\n`);
  }
  const reply = `RESPOSTA ${turn} (fake): ${text.replace(/\s+/g, " ").slice(0, 160)}${deny ? " [WebSearch negado]" : ""}`;
  save({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: reply }] } });
  emit({ type: "assistant", message: { content: [{ type: "text", text: reply }] } });
  return true;
}

if (print) {
  const dash = argv.indexOf("--");
  let text = dash >= 0 ? (argv[dash + 1] ?? "") : "";
  if (!text) {
    process.stdin.setEncoding("utf8");
    for await (const d of process.stdin) text += d;
  }
  const json = argv.includes("stream-json");
  const out = (o) => (json ? console.log(JSON.stringify({ ...o, session_id: sessionId })) : o.type === "assistant" && o.message.content[0].type === "text" && console.log(o.message.content[0].text));
  out({ type: "system", subtype: "init", model: "fake-claude" });
  const ok = await answer(text.trim(), out);
  out({ type: "result", subtype: ok ? "success" : "error_during_execution", is_error: !ok, result: ok ? "ok" : "falha simulada", duration_ms: delay * 2, total_cost_usd: 0 });
  // sem process.exit: no Windows ele pode cortar o que ainda está na fila do pipe (as últimas linhas sumiriam)
  process.exitCode = ok ? 0 : 1;
} else {

// interativo: cada linha digitada (Enter) é uma mensagem
console.log("Claude Code (fake) — digite uma mensagem");
process.stdout.write("❯ ");
process.stdin.setEncoding("utf8");
let buf = "";
process.stdin.on("data", async (d) => {
  buf += d.replace(/\x1b\[20[01]~/g, "");
  let i;
  while ((i = buf.search(/\r|\n/)) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    await answer(line, (o) => {
      const c = o.message.content[0];
      if (c.type === "tool_use") console.log(`● ${c.name}(${c.input.query})`);
      else if (c.type === "tool_result") console.log(`  ⎿ ${c.content}`);
      else if (c.type === "text") console.log(c.text);
    });
    process.stdout.write("❯ ");
  }
});
}
