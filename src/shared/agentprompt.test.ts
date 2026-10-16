import assert from "node:assert/strict";
import { test } from "node:test";
import { isOrchestrator, testPrompt } from "./agentprompt";
import { applyOps } from "./ops";
import { emptyDoc } from "./schema";

test("orquestrador é quem delega; o prompt usa o id do nó (nome do subagente)", () => {
  const { doc, results } = applyOps(emptyDoc("t", "agents"), [
    { op: "add_node", id: "lider", kind: "agent", agent: { role: "agent", description: "Coordena o time e delega as tarefas." } },
    { op: "add_node", id: "dev", kind: "agent", agent: { role: "agent", description: "Implementa as mudanças pedidas no código." } },
    { op: "add_connection", from: "lider", to: "dev", agent: { rel: "delegates", usage: "Passa a tarefa e recebe o diff." } },
  ]);
  assert.ok(results.every((r) => r.ok), results.find((r) => !r.ok)?.error ?? "op falhou");
  assert.equal(isOrchestrator(doc, "lider"), true);
  assert.equal(isOrchestrator(doc, "dev"), false);
  assert.equal(testPrompt("dev"), "Use o subagente dev para: ");
});
