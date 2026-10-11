import test from "node:test";
import assert from "node:assert/strict";
import { starterDoc } from "./starter.example";
import { validateDetailed } from "./ops";

test("exemplo de arquitetura do primeiro uso monta e não tem erros", () => {
  const doc = starterDoc();
  assert.equal(doc.nodes.length, 8);
  assert.equal(doc.connections.length, 7);
  assert.equal(doc.mode ?? "architecture", "architecture");
  assert.equal(validateDetailed(doc).filter((i) => i.severity === "erro").length, 0);
});
