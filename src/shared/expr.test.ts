import assert from "node:assert/strict";
import { test } from "node:test";
import { FUNCTIONS, explainError, findFunctions, checkExpr, evaluate, explain, explainStatement, parseExpr, parseStatement, readsOf } from "./expr";

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

test("funções de texto normalizam, convertem, juntam e partem", () => {
  assert.equal(ev('trocar(maiusculas(aparar(nome)), " ", "-")', { nome: "  ana souza " }), "ANA-SOUZA");
  assert.equal(ev("texto(7)"), "7");
  assert.equal(ev('numero(" 12,5 ")'), 12.5);
  assert.equal(ev("texto(nulo)"), "");
  assert.equal(ev('juntar(partir("a,b,c", ","), "-")'), "a-b-c");
  assert.equal(ev('minusculas("ABC")'), "abc");
});

test("funções de texto dão erro em português", () => {
  assert.throws(() => ev('numero("abc")'), /não é um número/);
  assert.throws(() => ev("aparar(5)"), /precisa de texto/);
  assert.throws(() => ev("texto([1])"), /juntar/);
  assert.equal(explain(parseExpr("maiusculas(nome)"), {}), "nome em maiúsculas");
});

test("funções de lista somam, resumem, ordenam e acrescentam sem mudar a original", () => {
  const env = { v: [3, 1, 2, 3], t: ["b", "a"] };
  assert.equal(ev("soma(v)", env), 9);
  assert.equal(ev("soma([])"), 0);
  assert.equal(ev("media([2, 4])"), 3);
  assert.equal(ev("primeiro(v)", env), 3);
  assert.equal(ev("ultimo(v)", env), 3);
  assert.equal(ev("primeiro([])"), null);
  assert.deepEqual(ev("ordenar(v)", env), [1, 2, 3, 3]);
  assert.deepEqual(ev("ordenar(t)", env), ["a", "b"]);
  assert.deepEqual(ev("unicos(v)", env), [3, 1, 2]);
  assert.deepEqual(ev("adicionar(v, 9)", env), [3, 1, 2, 3, 9]);
  assert.deepEqual(env.v, [3, 1, 2, 3]);
});

test("funções de lista dão erro em português", () => {
  assert.throws(() => ev("soma(5)"), /precisa de uma lista/);
  assert.throws(() => ev('soma([1, "a"])'), /precisa ser número/);
  assert.throws(() => ev("media([])"), /vazia/);
  assert.throws(() => ev('ordenar([1, "a"])'), /só de números ou só de textos/);
  assert.equal(explain(parseExpr("soma(precos)"), {}), "a soma de precos");
});

test("indexação por posição e campo de objeto: itens[0].preco", () => {
  const env = { itens: [{ nome: "caneta", preco: 3, tags: ["a", "b"] }, { nome: "caderno", preco: 12, tags: [] }], pedido: { itens: [{ qtd: 2 }] }, n: 1 };
  assert.equal(ev("itens[0].nome", env), "caneta");
  assert.equal(ev("itens[n].preco * 2", env), 24);
  assert.equal(ev("itens[0].tags[1]", env), "b");
  assert.equal(ev("pedido.itens[0].qtd", env), 2);
  assert.equal(ev("itens[n - 1].preco + itens[n].preco", env), 15);
  assert.equal(ev("[10, 20, 30][2]"), 30);
  assert.equal(ev('"abc"[1]'), "b");
  assert.deepEqual([...readsOf(parseExpr("itens[n].preco"))].sort(), ["itens", "n"]);
  assert.equal(explain(parseExpr("itens[0].nome"), {}), "nome de item 0 de itens");
});

test("indexação dá erro em português", () => {
  const env = { itens: [{ nome: "a" }], x: 5 };
  assert.throws(() => ev("itens[3].nome", env), /posição 3 não existe: a lista tem 1 item/);
  assert.throws(() => ev("itens[-1]", env), /posição -1 não existe/);
  assert.throws(() => ev("itens[0.5]", env), /número inteiro/);
  assert.throws(() => ev("x[0]", env), /só vale para lista ou texto/);
  assert.throws(() => ev("itens[0].preco", env), /"preco" não tem valor/);
  assert.throws(() => ev("x[0].a", env), /só vale/);
  assert.throws(() => ev("itens[0", env), /\]/);
});

test("filtrar e mapear fazem a condição e a conta em cada item, com os campos soltos", () => {
  const env = { itens: [{ preco: 20, qtd: 2 }, { preco: 5, qtd: 10 }, { preco: 10, qtd: 1 }], minimo: 8, nums: [1, 2, 3, 4] };
  assert.equal(ev("soma(mapear(filtrar(itens, preco > 10), preco * qtd))", env), 40);
  assert.equal(ev("tamanho(filtrar(itens, preco >= minimo))", env), 2); // lê um dado de fora dentro da condição
  assert.deepEqual(ev("filtrar(nums, item % 2 = 0)", env), [2, 4]);
  assert.deepEqual(ev("mapear(nums, item * item)", env), [1, 4, 9, 16]);
  assert.deepEqual(ev("filtrar([], preco > 1)"), []);
  assert.deepEqual(env.nums, [1, 2, 3, 4]);
  assert.deepEqual([...readsOf(parseExpr("filtrar(itens, preco > 10)"))], ["itens"]);
});

test("filtrar e mapear dão erro em português", () => {
  assert.throws(() => ev("filtrar(5, item > 1)"), /precisa de uma lista/);
  assert.throws(() => ev("filtrar([1, 2], item + 1)"), /verdadeiro ou falso para cada item/);
  assert.equal(explain(parseExpr("filtrar(itens, preco > 10)"), {}).includes("em que"), true);
});

test("datas: somar dias e diferença, com mês, ano novo e bissexto", () => {
  assert.equal(ev('somar_dias("2026-01-15", 30)'), "2026-02-14");
  assert.equal(ev('somar_dias("2025-12-20", 30)'), "2026-01-19");
  assert.equal(ev('somar_dias("2028-02-10", 30)'), "2028-03-11"); // 2028 é bissexto
  assert.equal(ev('somar_dias("2027-02-10", 30)'), "2027-03-12"); // 2027 não
  assert.equal(ev('somar_dias("2026-03-10", -10)'), "2026-02-28");
  assert.equal(ev('dias_entre("2026-09-12", "2026-10-12")'), 30);
  assert.equal(ev('dias_entre("2028-02-01", "2028-03-03")'), 31);
  assert.equal(ev('dias_entre("2026-10-12", "2026-10-02")'), -10);
  assert.equal(ev('dias_entre("2026-03-28", "2026-03-30")'), 2); // virada de horário de verão não pode contar
  assert.equal(ev('somar_dias("2026-10-31", dias_entre("2026-01-01", "2026-01-31"))'), "2026-11-30");
});

test("datas dão erro em português", () => {
  assert.throws(() => ev('dias_entre("12/10/2026", "2026-10-12")'), /AAAA-MM-DD/);
  assert.throws(() => ev('somar_dias("2026-02-30", 1)'), /não existe no calendário/);
  assert.throws(() => ev('somar_dias("2026-02-01", 1.5)'), /inteiro/);
  assert.throws(() => ev("dias_entre(nulo, \"2026-10-12\")"), /vazio/);
});

test("todo exemplo do catálogo de funções roda sozinho e usa a função que descreve", () => {
  for (const [name, f] of Object.entries(FUNCTIONS)) {
    const e = parseExpr(f.ex);
    assert.ok(f.ex.includes(name + "("), `${name}: o exemplo não usa a própria função`);
    assert.doesNotThrow(() => evaluate(e, {}), `${name}: o exemplo «${f.ex}» não executa`);
    assert.ok(f.doc.length > 8 && f.sig.startsWith(name), `${name}: descrição ou assinatura`);
  }
  assert.equal(ev(FUNCTIONS.soma.ex), 35);
  assert.equal(Object.keys(FUNCTIONS).length, new Set(Object.values(FUNCTIONS).map((f) => f.sig)).size);
});

test("a busca de funções acha pelo verbo, pelo assunto e sem acento", () => {
  assert.deepEqual(findFunctions("somar lista"), ["soma"]);
  assert.ok(findFunctions("somar").includes("somar_dias") && findFunctions("somar").includes("soma"));
  assert.deepEqual(findFunctions("data").sort(), ["dias_entre", "somar_dias"]);
  assert.ok(findFunctions("MAIÚSCULAS").includes("maiusculas"));
  assert.ok(findFunctions("ordenar").includes("ordenar"));
  assert.deepEqual(findFunctions("nenhumaisso"), []);
  assert.equal(findFunctions("").length, Object.keys(FUNCTIONS).length);
});

test("a explicação em português põe parênteses num «e» dentro de um «ou», para não ler de dois jeitos", () => {
  const ex = (s: string) => explain(parseExpr(s), {});
  assert.equal(ex('cupom ou (nivel = "VIP" e total >= 500)'), 'cupom ou (nivel é igual a "VIP" e total é maior ou igual a 500)');
  assert.equal(ex("a e b ou c e d"), "(a e b) ou (c e d)");
  assert.equal(ex("(a ou b) e c"), "(a ou b) e c");
  assert.equal(ex("a e b e c"), "a e b e c"); // sem mistura, sem parênteses
  assert.equal(ex("a ou b ou c"), "a ou b ou c");
});

test("explainError diz onde está o erro de sintaxe", () => {
  const at = (s: string, kind: "expr" | "statement" = "expr") => explainError(s, checkExpr(s, kind)!);
  assert.equal(at("preco <"), "esperava um valor mas veio o fim do texto (falta um dado, número, texto ou conta; ex.: total > 100)");
  assert.equal(at("a + * b"), 'esperava um valor mas veio "*", em «a + ▸* b» (falta um dado, número, texto ou conta; ex.: total > 100)');
  assert.equal(at("(a + b"), 'esperava ")" mas veio o fim do texto');
  assert.ok(at("frete :=", "statement").startsWith("esperava um valor mas veio o fim do texto"));
  assert.match(at("um_nome_muito_comprido_aqui_para_testar_o_corte >"), /depois de «…[^»]{23,24}»/);
});
