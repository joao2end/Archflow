import test from "node:test";
import assert from "node:assert/strict";
import { starterExample } from "./logic";
import { jevCases } from "./jev.cases";

test("starterExample: entradas do fluxo preenchidas, saídas fora, desfecho ok", () => {
  const frete = jevCases()[0].doc; // total entra; frete é escrito por uma ação
  const ex = starterExample(frete);
  assert.deepEqual(Object.keys(ex.given), ["total"]);
  assert.equal(ex.given.total, 0);
  assert.deepEqual(ex.expect, { desfecho: "ok" });
});
