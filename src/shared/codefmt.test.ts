import assert from "node:assert/strict";
import { test } from "node:test";
import { codeHtml, formatCode, tokenize } from "./codefmt";

const kinds = (src: string) => tokenize(src).filter((t) => t.k !== "ws").map((t) => `${t.k}:${t.v}`);
const text = (src: string, w?: number) => formatCode(src, w).map((t) => t.v).join("");

test("realce: palavras-chave, funções, dados, campos, números, textos, lógicos, operadores e marcas", () => {
  assert.deepEqual(kinds('total := arredondar(base * 8%, 2)'), ["id:total", "op::=", "fn:arredondar", "punct:(", "id:base", "op:*", "num:8%", "punct:,", "num:2", "punct:)"]);
  assert.deepEqual(kinds('nao vazio(a.cupom) e x em ["a"]'), ["kw:nao", "fn:vazio", "punct:(", "id:a.cupom", "punct:)", "kw:e", "id:x", "kw:em", "punct:[", 'str:"a"', "punct:]"]);
  assert.deepEqual(kinds('{ id: "A3", pago: verdadeiro, v: nulo }'), ["punct:{", "key:id", "punct::", 'str:"A3"', "punct:,", "key:pago", "punct::", "lit:verdadeiro", "punct:,", "key:v", "punct::", "lit:nulo", "punct:}"]);
  assert.deepEqual(kinds("212.5 >= 300 ✘"), ["num:212.5", "op:>=", "num:300", "no:✘"]);
  assert.equal(tokenize("sem valor > …").map((t) => t.v).join(""), "sem valor > …", "tolerante ao que não é expressão");
});

test("formatação: o que cabe fica numa linha; o resto quebra antes de e/ou e abre listas e objetos com recuo", () => {
  assert.equal(text("x > 1 e y < 2"), "x > 1 e y < 2");
  assert.equal(text('cartao = "recusado" ou (cartao = "instavel" e tentativas < 2)', 30), 'cartao = "recusado"\n  ou (\n    cartao = "instavel"\n      e tentativas < 2\n  )');
  assert.equal(
    text('[{ id: "A1", plano: "basico" }, { id: "A2", plano: "pro" }]', 36),
    '[\n  { id: "A1", plano: "basico" },\n  { id: "A2", plano: "pro" }\n]',
  );
  assert.equal(text("a\nb"), "a\nb", "quebras que já existem ficam");
});

test("o HTML escapa o texto e marca cada pedaço com a classe do tipo", () => {
  assert.equal(codeHtml('a < "<b>"'), '<span class="t-id">a</span> <span class="t-op">&lt;</span> <span class="t-str">&quot;&lt;b&gt;&quot;</span>');
});

test("realce e quebra também na sintaxe do TypeScript", () => {
  assert.deepEqual(kinds('!vazio(a.cupom) && ["SP"].includes(uf) == true'), ["op:!", "fn:vazio", "punct:(", "id:a.cupom", "punct:)", "op:&&", "punct:[", 'str:"SP"', "punct:]", "punct:.", "fn:includes", "punct:(", "id:uf", "punct:)", "op:==", "lit:true"]);
  assert.deepEqual(kinds("for (const a of vencidas)").filter((k) => k.startsWith("kw")), ["kw:for", "kw:const", "kw:of"]);
  assert.equal(text('cartao == "recusado" || cartao == "instavel"', 24), 'cartao == "recusado"\n  || cartao == "instavel"');
});
