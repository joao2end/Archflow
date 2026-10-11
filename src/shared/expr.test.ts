import assert from "node:assert/strict";
import { test } from "node:test";
import { checkExpr, evaluate, explain, explainStatement, parseExpr, parseStatement, readsOf } from "./expr";

const ev = (src: string, env: Record<string, unknown> = {}) => evaluate(parseExpr(src), env);

test("aritmética respeita a precedência e os parênteses", () => {
  assert.equal(ev("2 + 3 * 4"), 14);
  assert.equal(ev("(2 + 3) * 4"), 20);
  assert.equal(ev("10 - 4 - 3"), 3);
  assert.equal(ev("-5 + 2"), -3);
  assert.equal(ev("5%"), 0.05);
});

test("preço de partida de lucro: custo ÷ (1 − margem)", () => {
  assert.equal(ev("custo / (1 - margem)", { custo: 60, margem: 0.4 }), 100);
  assert.equal(ev("arredondar(custo / (1 - margem), 2)", { custo: 10, margem: 0.3 }), 14.29);
});

test("lógica em português e em inglês, com 'em' e 'nao em'", () => {
  const env = { tipo: "imagem", preco: 8 };
  assert.equal(ev('tipo em ["imagem", "trafego"] e preco < 10', env), true);
  assert.equal(ev('tipo nao em ["imagem"] ou preco > 100', env), false);
  assert.equal(ev("not (preco = 8)", env), false);
  assert.equal(ev("preco >= 8 and preco <= 8", env), true);
});

test("se/entao/senao e funções", () => {
  assert.equal(ev("se preco > 100 entao 99.99 senao preco", { preco: 150 }), 99.99);
  assert.equal(ev("max(preco, piso)", { preco: 5, piso: 7 }), 7);
  assert.equal(ev("min(1, 2, 3)"), 1);
  assert.equal(ev("entre(preco, 10, 20)", { preco: 20 }), true);
  assert.equal(ev("contem(marcas, \"x\")", { marcas: ["x", "y"] }), true);
  assert.equal(ev("vazio(nome)", { nome: null }), true);
  assert.equal(ev("tamanho([1, 2, 3])"), 3);
});

test("nomes com ponto lêem objetos aninhados ou chaves planas", () => {
  assert.equal(ev("categoria.margem * 2", { categoria: { margem: 0.2 } }), 0.4);
  assert.equal(ev("categoria.margem * 2", { "categoria.margem": 0.1 }), 0.2);
});

test("erros de sintaxe dizem o que faltou e onde", () => {
  assert.match(checkExpr("preco >")!.message, /esperava um valor/);
  assert.match(checkExpr("se a entao 1")!.message, /senao/);
  assert.match(checkExpr("foo(1)")!.message, /função desconhecida/);
  assert.match(checkExpr("max()")!.message, /recebe/);
  assert.match(checkExpr("1 2")!.message, /sobrou/);
  assert.match(checkExpr('"aberto')!.message, /aspas/);
  assert.equal(checkExpr("a + b * 2"), undefined);
  assert.equal(checkExpr("a + b * 2 )")!.pos, 10);
});

test("erros de avaliação são claros", () => {
  assert.throws(() => ev("1 / 0"), /divisão por zero/);
  assert.throws(() => ev("x + 1"), /"x" não tem valor/);
  assert.throws(() => ev("preco e verdadeiro", { preco: 3 }), /verdadeiro ou falso/);
  assert.throws(() => ev('"a" * 2'), /número/);
});

test("efeitos: atribuição e trava", () => {
  const a = parseStatement("preco := max(preco, piso)");
  assert.equal(a.t, "assign");
  assert.equal(parseStatement("travar preco").t, "lock");
  assert.equal(parseStatement("destravar preco").t, "unlock");
  assert.match(checkExpr("preco = 1", "statement")!.message, /dado := expressão/);
});

test("readsOf lista os dados lidos", () => {
  assert.deepEqual([...readsOf(parseExpr("custo / (1 - categoria.margem) + max(a, b)"))].sort(), ["a", "b", "categoria.margem", "custo"]);
});

test("explain traduz para português e usa os nomes de negócio", () => {
  assert.equal(explain(parseExpr("custo / (1 - margem_objetivo)")), "custo dividido por (1 menos margem objetivo)");
  assert.equal(explain(parseExpr('tipo em ["imagem", "trafego"] e preco < 10')), 'tipo está em ["imagem", "trafego"] e preco é menor que 10');
  assert.equal(explain(parseExpr("preco_atual >= 100"), { preco_atual: "o preço atual" }), "o preço atual é maior ou igual a 100");
  assert.equal(explain(parseExpr("max(a, b)")), "o maior entre a, b");
  assert.equal(explain(parseExpr("5%")), "5%");
  assert.equal(explainStatement(parseStatement("preco := piso")), "preco passa a ser piso");
  assert.match(explainStatement(parseStatement("travar preco")), /não o reescrevem/);
});

test("o texto explicado de uma expressão volta a ser a mesma conta (precedência preservada)", () => {
  assert.equal(explain(parseExpr("(a + b) * c")), "(a mais b) vezes c");
  assert.equal(explain(parseExpr("a - (b - c)")), "a menos (b menos c)");
});
