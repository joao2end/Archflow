#!/usr/bin/env node
/**
 * Servidor MCP falso (stdio) para os testes da sonda. JSON-RPC por linhas.
 * FAKE_MCP_MODE: ok (padrão) | pages (tools/list em 2 páginas) | hang (não responde) | crash (escreve o segredo no stderr e sai)
 * FAKE_REQUIRED: se definido e diferente de "1", sai com erro (prova que a variável chegou ao processo).
 */
import { createInterface } from "node:readline";

const mode = process.env.FAKE_MCP_MODE ?? "ok";
if (process.env.FAKE_REQUIRED !== undefined && process.env.FAKE_REQUIRED !== "1") {
  process.stderr.write("FAKE_REQUIRED inválida\n");
  process.exit(2);
}
if (mode === "crash") {
  process.stderr.write(`falhou com o token ${process.env.FAKE_SECRET ?? ""}\n`);
  process.exit(3);
}
const send = (m) => process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", ...m })}\n`);
// inputSchema é obrigatório no protocolo: sem ele o Claude Code recusa a lista inteira
const schema = { type: "object", properties: {} };
const tools = [
  { name: "browser_navigate", description: "Navega para uma URL.", inputSchema: schema },
  { name: "browser_click", description: "Clica num elemento da página.", inputSchema: schema },
  { name: "browser_snapshot", inputSchema: schema },
];
createInterface({ input: process.stdin }).on("line", (line) => {
  if (mode === "hang") return;
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }
  if (msg.method === "initialize") send({ id: msg.id, result: { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "fake-mcp", version: "9.9.9" } } });
  else if (msg.method === "tools/list") {
    if (mode === "pages") {
      if (!msg.params?.cursor) send({ id: msg.id, result: { tools: tools.slice(0, 2), nextCursor: "p2" } });
      else send({ id: msg.id, result: { tools: tools.slice(2) } });
    } else send({ id: msg.id, result: { tools } });
  } else if (msg.method === "tools/call") {
    send({ id: msg.id, result: { content: [{ type: "text", text: `fake-ok:${msg.params?.name}` }] } });
  } else if (msg.id !== undefined) send({ id: msg.id, error: { code: -32601, message: "método desconhecido" } });
});
