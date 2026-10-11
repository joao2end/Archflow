import assert from "node:assert/strict";
import { test } from "node:test";
import { truncate, wrapLabel } from "./text";

test("truncate: só corta o que passa do limite", () => {
  assert.equal(truncate("curto", 10), "curto");
  assert.equal(truncate("abcdefghij", 10), "abcdefghij");
  assert.equal(truncate("abcdefghijk", 10), "abcdefghi…");
  assert.equal(truncate("abc", 0), "…");
});

test("wrapLabel: nome que cabe fica numa linha", () => {
  assert.deepEqual(wrapLabel("Criar pedido", 15, 3), ["Criar pedido"]);
  assert.deepEqual(wrapLabel("", 15, 3), [""]);
  assert.deepEqual(wrapLabel("   ", 15, 3), [""]);
});

test("wrapLabel: quebra em espaços e hífens, sem perder palavras, quando cabe nas linhas", () => {
  assert.deepEqual(wrapLabel("Servico de processamento de pagamentos", 15, 3), ["Servico de", "processamento", "de pagamentos"]);
  assert.deepEqual(wrapLabel("pedido-criado-com-pagamento", 14, 3), ["pedido-criado-", "com-pagamento"]);
  const joined = wrapLabel("Aggregate de cobranca recorrente", 16, 3).join(" ");
  assert.equal(joined, "Aggregate de cobranca recorrente");
});

test("wrapLabel: só a última linha leva reticências e o limite de linhas é respeitado", () => {
  const l = wrapLabel("Servico de processamento de pagamentos internacionais", 15, 3);
  assert.equal(l.length, 3);
  assert.ok(l[2].endsWith("…"));
  assert.ok(l.slice(0, 2).every((x) => !x.endsWith("…")));
  assert.ok(l.every((x) => x.length <= 15));
  assert.equal(wrapLabel("a b c d e f g h", 3, 2).length, 2);
});

test("wrapLabel: palavra maior que a linha é cortada em vez de estourar", () => {
  const l = wrapLabel("Supercalifragilisticoexpialidocious", 10, 3);
  assert.ok(l.every((x) => x.length <= 10));
  assert.equal(l.length, 3);
  assert.ok(l[2].endsWith("…"));
});

test("wrapLabel: em duas linhas fixas continua dentro do limite", () => {
  for (const t of ["Pedido", "Item do Pedido", "Aggregate de cobranca recorrente com fidelidade", "x".repeat(60)]) {
    const l = wrapLabel(t, 14, 2);
    assert.ok(l.length >= 1 && l.length <= 2 && l.every((x) => x.length <= 14), `${t} → ${JSON.stringify(l)}`);
  }
});
