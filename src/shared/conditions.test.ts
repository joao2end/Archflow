import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluate, parseExpr, print } from "./expr";
import { firstProblem, fromText, toText } from "./conditions";

const SAMPLES = [
  "preco > 10",
  "preco > 10 e preco < 50",
  "preco > 10 e (preco < 50 ou categoria = \"a\")",
  "categoria em [\"imagem\", \"trafego\"] e nao vazio(nome)",
  "nao (preco < 50)",
  "entre(preco, 10, 20) ou contem(tags, \"x\")",
  "nao contem(tags, \"x\") e categoria nao em [\"a\"]",
  "a ou b e c",
  "(preco + 1) * 2 >= limite / 2",
  "se a entao b senao c",
  "nao (a e b)",
];

test("print: o texto impresso lê de volta na mesma árvore", () => {
  for (const t of SAMPLES) assert.deepEqual(parseExpr(print(parseExpr(t))), parseExpr(t), t);
  assert.equal(print(parseExpr("5%")), "5%");
  assert.equal(print(parseExpr("(1 + 2) * 3")), "(1 + 2) * 3");
});

test("condições: texto -> linhas -> texto mantém o significado", () => {
  const envs = [
    { preco: 5, categoria: "a", nome: "x", tags: ["x"], a: true, b: false, c: true, limite: 4 },
    { preco: 20, categoria: "imagem", nome: null, tags: [], a: false, b: true, c: false, limite: 100 },
    { preco: 60, categoria: "trafego", nome: "", tags: ["y"], a: true, b: true, c: true, limite: 1 },
  ];
  for (const t of SAMPLES) {
    const g = fromText(t)!;
    assert.ok(g, t);
    assert.equal(firstProblem(g), undefined, t);
    const back = toText(g);
    for (const env of envs) {
      let a: unknown;
      let b: unknown;
      try { a = evaluate(parseExpr(t), env as never); } catch { a = "erro"; }
      try { b = evaluate(parseExpr(back), env as never); } catch { b = "erro"; }
      assert.equal(b, a, `${t}  =>  ${back}`);
    }
  }
});

test("condições: forma das linhas", () => {
  const g = fromText("preco > 10 e (preco < 50 ou nao preco = 20)")!;
  assert.equal(g.mode, "e");
  assert.equal(g.items.length, 2);
  const sub = g.items[1];
  assert.equal(sub.k, "group");
  if (sub.k === "group") {
    assert.equal(sub.mode, "ou");
    // o NÃO vira o operador contrário
    assert.deepEqual(sub.items[1], { k: "cond", left: "preco", op: "!=", right: "20" });
  }
  assert.equal(fromText("se a entao b senao c")!.items[0].k, "raw");
  assert.deepEqual(fromText("")!.items, []);
  assert.equal(fromText("a >"), undefined);
});

test("condições: linha incompleta não salva", () => {
  assert.match(firstProblem({ k: "group", mode: "e", items: [{ k: "cond", left: "", op: "=", right: "" }] })!, /dado/);
  assert.match(firstProblem({ k: "group", mode: "e", items: [{ k: "cond", left: "a", op: "=", right: "" }] })!, /valor/);
  assert.equal(firstProblem({ k: "group", mode: "e", items: [{ k: "cond", left: "a", op: "vazio" }] }), undefined);
  assert.equal(toText({ k: "group", mode: "ou", items: [{ k: "cond", left: "a", op: "=", right: "1" }, { k: "cond", left: "b", op: "nao-entre", right: "1", right2: "2" }] }), "a = 1 ou nao entre(b, 1, 2)");
});

test("aspas automáticas: palavra solta ao lado de um dado de texto vira texto entre aspas", async () => {
  const { autoQuote } = await import("./conditions");
  const facts = new Set(["nivel", "outro", "total"]);
  const q = (v: string, t: string | undefined, op: "=" | "em" | ">=" = "=") => autoQuote(v, op, t, facts);
  assert.equal(q("VIP", "string"), '"VIP"');
  assert.equal(q("São Paulo", "string"), '"São Paulo"');
  assert.equal(q("ouro", '"ouro" | "prata"'), '"ouro"');
  assert.equal(q("VIP", "texto"), '"VIP"'); // sinônimo em português
  assert.equal(q('"VIP"', "string"), '"VIP"'); // já tem aspas
  assert.equal(q("outro", "string"), "outro"); // é outro dado do diagrama
  assert.equal(q("verdadeiro", "string"), "verdadeiro");
  assert.equal(q("500", "string"), "500");
  assert.equal(q("VIP", "number"), "VIP"); // dado numérico: não mexe
  assert.equal(q("VIP", undefined), "VIP"); // sem tipo: não adivinha
  assert.equal(q("VIP", "dinheiro"), "VIP"); // rótulo antigo: não adivinha
  assert.equal(q("ouro, prata", "string", "em"), '["ouro", "prata"]');
  assert.equal(q('["a", "b"]', "string", "em"), '["a", "b"]');
  assert.equal(q("5", "string", ">="), "5");
});

test("grupo negado: «nenhuma delas» e «nem todas» fazem ida e volta entre texto e linhas", () => {
  const rt = (s: string) => toText(fromText(s)!);
  assert.equal(rt("nao (a ou b)"), "nao (a ou b)");
  assert.equal(rt("nao (preco > 10 e vip = verdadeiro)"), "nao (preco > 10 e vip = verdadeiro)");
  const g = fromText("nao (preco > 10 ou vip = verdadeiro)")!;
  assert.equal(g.not, true);
  assert.equal(g.mode, "ou");
  assert.equal(g.items.length, 2);
  assert.ok(g.items.every((i) => i.k === "cond"));
  // dentro de outro grupo
  const outer = fromText("cupom ou nao (nivel = \"VIP\" e total >= 500)")!;
  assert.equal(outer.mode, "ou");
  assert.deepEqual(outer.items.map((i) => i.k), ["cond", "group"]); // `cupom` sozinho é «cupom é verdadeiro»
  assert.equal(toText(outer), 'cupom ou nao (nivel = "VIP" e total >= 500)');
  // montado pelas linhas
  const built = { k: "group" as const, mode: "ou" as const, not: true, items: [{ k: "cond" as const, left: "a", op: ">" as const, right: "1" }, { k: "cond" as const, left: "b", op: "<" as const, right: "2" }] };
  assert.equal(toText(built), "nao (a > 1 ou b < 2)");
  assert.equal(evaluate(parseExpr(toText(built)), { a: 0, b: 5 }), true); // nenhuma vale
  assert.equal(evaluate(parseExpr(toText(built)), { a: 3, b: 5 }), false);
  // sem negação nada muda; negação de uma só condição continua virando operador
  assert.equal(rt("a ou b"), "a ou b");
  assert.equal(fromText("nao (preco = 5)")!.items[0].k, "cond");
  assert.equal(rt("nao (a e b)") === "nao (a e b)", true);
});

test("dado lógico sozinho vira «é verdadeiro / é falso», com ida e volta exata", () => {
  const rt = (s: string) => toText(fromText(s)!);
  for (const s of ["cluster_existe", "nao cache_existe", "a e nao b", "cupom ou (vip e nao bloqueado)", "pedido.pago", "nao (a ou b)"]) assert.equal(rt(s), s, s);
  const g = fromText("cluster_existe")!;
  assert.deepEqual(g.items[0], { k: "cond", left: "cluster_existe", op: "verdadeiro" });
  assert.deepEqual(fromText("nao cache_existe")!.items[0], { k: "cond", left: "cache_existe", op: "falso" });
  // montado pelas linhas
  assert.equal(toText({ k: "cond", left: "ativo", op: "verdadeiro" }), "ativo");
  assert.equal(toText({ k: "cond", left: "ativo", op: "falso" }), "nao ativo");
  assert.equal(toText({ k: "cond", left: "a > 1", op: "falso" }), "nao (a > 1)"); // expressão solta ganha parênteses
  // sem dado preenchido, é incompleto
  assert.equal(firstProblem({ k: "cond", left: "", op: "verdadeiro" }), "preencha o dado");
  assert.equal(firstProblem({ k: "cond", left: "ativo", op: "verdadeiro" }), undefined);
  // o texto salvo continua significando o mesmo
  assert.equal(evaluate(parseExpr(toText({ k: "cond", left: "ativo", op: "falso" })), { ativo: false }), true);
});
