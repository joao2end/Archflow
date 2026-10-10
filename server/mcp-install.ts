/**
 * Instala o servidor MCP do Archflow nos clientes (Cursor, Claude Desktop, Claude Code, Windsurf) e testa a conexão.
 *
 *   npm run mcp:install               instala em todos os clientes encontrados e testa
 *   npm run mcp:install -- cursor     só em um (cursor | claude-desktop | claude-code | windsurf)
 *   npm run mcp:check                 só testa o que já está instalado (não altera nada)
 */
import { existsSync } from "node:fs";
import { dirname } from "node:path";
import { checkMcp, installMcp, mcpLaunch, MCP_CLIENTS, type McpClientId } from "./bridge";

const args = process.argv.slice(2);
const checkOnly = args.includes("--check");
const wanted = args.filter((a) => !a.startsWith("-"));
const ids = (Object.keys(MCP_CLIENTS) as McpClientId[]).filter((id) => !wanted.length || wanted.includes(id));
if (wanted.length && !ids.length) {
  console.error(`Cliente desconhecido: ${wanted.join(", ")}. Use: ${Object.keys(MCP_CLIENTS).join(" | ")}`);
  process.exit(2);
}

const found = (id: McpClientId) => existsSync(dirname(MCP_CLIENTS[id].file())) || id === "claude-code";
const launch = mcpLaunch();
console.log(`Comando do servidor: ${[launch.command, ...launch.args].join(" ")}\n`);

let failed = 0;
for (const id of ids) {
  const { label } = MCP_CLIENTS[id];
  const file = MCP_CLIENTS[id].file();
  if (!wanted.length && !found(id)) {
    console.log(`– ${label}: não encontrado nesta máquina (pulado)`);
    continue;
  }
  try {
    if (!checkOnly) {
      installMcp(id);
      console.log(`✓ ${label}: configurado (${file})`);
    }
    const r = await checkMcp(id);
    if (r.ok) console.log(`✓ ${label}: conectou em ${r.ms} ms, ${r.tools} ferramentas`);
    else {
      failed++;
      console.log(`✗ ${label}: ${r.problems.join(" ")}`);
      if (r.stderr) console.log(r.stderr.split("\n").map((l) => `    ${l}`).join("\n"));
    }
  } catch (e) {
    failed++;
    console.log(`✗ ${label}: ${e instanceof Error ? e.message : String(e)}`);
  }
}
console.log(failed ? `\n${failed} cliente(s) com erro.` : "\nTudo certo. Reinicie o cliente (ou recarregue o MCP) para ele ler a configuração.");
process.exit(failed ? 1 : 0);
