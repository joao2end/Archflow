/**
 * Teste de ponta a ponta com o Claude Code de verdade: um subagente gerado pelo Archflow, ligado a um servidor MCP
 * COMPARTILHADO (`.mcp.json` + referência por nome em `mcpServers`), consegue chamar uma tool desse servidor.
 *
 * O que este teste descobriu (2026-10-15), e que a UI avisa ao usuário:
 *  - o servidor de `.mcp.json` fica «Pending approval» no Claude Code até o usuário aprová-lo (aqui, `--settings`
 *    com `enabledMcpjsonServers`, que vale mesmo em pasta não confiável);
 *  - servidor INLINE no frontmatter do agente só carrega depois que a pasta é confiável (trust): não dá para
 *    testar com uma pasta temporária sem mexer em ~/.claude.json, por isso o teste usa o compartilhado;
 *  - cada tool do servidor precisa de `inputSchema` (o servidor falso do teste tem), senão o Claude recusa a lista.
 *
 * Fora da suíte padrão: precisa da CLI `claude` autenticada, rede e gasta um pouco de crédito. Para rodar:
 *   ARCHFLOW_E2E_CLAUDE=1 npx tsx --test server/claude.e2e.test.ts
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { generateHarness } from "../src/shared/agentgen";
import { applyOps, type Op } from "../src/shared/ops";
import { emptyDoc, type AgentNodeSpec } from "../src/shared/schema";

const fixture = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "fake-mcp-server.mjs");

test("subagente ligado a um servidor MCP compartilhado chama a tool dele (Claude Code real)", { skip: process.env.ARCHFLOW_E2E_CLAUDE !== "1", timeout: 240_000 }, () => {
  const node = (id: string, agent: AgentNodeSpec): Op => ({ op: "add_node", id, kind: "agent", agent });
  const { doc, results } = applyOps(emptyDoc("e2e", "agents"), [
    node("probe", { role: "agent", description: "Chama a tool browser_snapshot do servidor fake e devolve o texto que ela retornar." }),
    node("fake", { role: "tool", toolType: "mcp", transport: "stdio", command: process.execPath, args: [fixture], description: "Servidor MCP falso de teste." }),
    node("outro", { role: "agent", description: "Segundo agente que usa o mesmo servidor, o que o torna compartilhado (.mcp.json)." }),
    { op: "add_connection", from: "probe", to: "fake", agent: { rel: "uses-tool", usage: "Para chamar browser_snapshot e devolver o texto." } },
    { op: "add_connection", from: "outro", to: "fake", agent: { rel: "uses-tool", usage: "Também usa o servidor fake." } },
  ]);
  assert.ok(results.every((r) => r.ok), results.find((r) => !r.ok)?.error ?? "op falhou");

  const dir = mkdtempSync(join(tmpdir(), "archflow-claude-e2e-"));
  try {
    for (const f of generateHarness(doc, "claude")) {
      mkdirSync(dirname(join(dir, f.path)), { recursive: true });
      writeFileSync(join(dir, f.path), f.content);
    }
    const r = spawnSync(
      "claude",
      ["-p", "Use o subagente probe. Peça a ele para chamar a tool mcp__fake__browser_snapshot e responder somente com o texto que a tool devolver. Depois repita esse texto exatamente, sem mais nada.", "--settings", JSON.stringify({ enabledMcpjsonServers: ["fake"] }), "--allowedTools", "mcp__fake__browser_snapshot", "Agent", "--permission-mode", "acceptEdits", "--max-budget-usd", "1", "--output-format", "text"],
      { cwd: dir, encoding: "utf8", timeout: 220_000, input: "" },
    );
    assert.equal(r.status, 0, `claude saiu com ${r.status}: ${r.stderr}`);
    assert.match(r.stdout, /fake-ok:browser_snapshot/, r.stdout);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
