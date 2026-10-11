import test from "node:test";
import assert from "node:assert/strict";
import { applyOps, validateDetailed } from "./ops";
import { emptyDoc } from "./schema";

// o minimapa marca nós por `Issue.target`: este teste garante que a validação do modo Logic aponta o id do nó com problema
test("validação do modo Logic traz o id do nó em target (base da marcação do minimapa)", () => {
  const doc = emptyDoc("t", "logic");
  const r = applyOps(doc, [
    { op: "add_node", id: "regra-vazia", label: "Regra sem corpo", logic: { role: "rule" } },
    { op: "add_node", id: "inicio", label: "Início", logic: { role: "start" } },
  ]);
  const issues = validateDetailed(r.doc);
  const targets = issues.filter((i) => i.target).map((i) => i.target);
  assert.ok(issues.length > 0, "esperava ao menos um problema");
  assert.ok(targets.includes("regra-vazia"), `targets: ${JSON.stringify(targets)}`);
});
