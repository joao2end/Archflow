import assert from "node:assert/strict";
import { test } from "node:test";
import { checkValue, parseType, printType, recognize, TypeSyntaxError } from "./types";
import { typeIssues } from "./logic";
import { nodeCases } from "./nodes.cases";
import { applyOps } from "./ops";
import { emptyDoc } from "./schema";

const ok = (t: string, v: unknown) => checkValue(parseType(t), v as never, "v");

test("tipos primitivos, int e float", () => {
  assert.deepEqual(ok("string", "a"), []);
  assert.deepEqual(ok("number", 1.5), []);
  assert.deepEqual(ok("int", 3), []);
  assert.match(ok("int", 3.5)[0], /esperava int \(inteiro\), mas é o decimal 3.5/);
  assert.deepEqual(ok("float", 3), []); // decimal aceita inteiro, como number
  assert.match(ok("string", 5)[0], /esperava string, mas é um número/);
  assert.match(ok("boolean", "sim")[0], /esperava boolean/);
  assert.deepEqual(ok("null", null), []);
  assert.deepEqual(ok("any", { a: 1 }), []);
});

test("uniões, literais e listas", () => {
  assert.deepEqual(ok('"ouro" | "prata"', "ouro"), []);
  assert.equal(ok('"ouro" | "prata"', "bronze")[0], 'v: esperava "ouro" | "prata", mas é um texto ("bronze")');
  assert.deepEqual(ok("number | null", null), []);
  assert.deepEqual(ok("string[]", ["a", "b"]), []);
  assert.deepEqual(ok("Array<number>", [1, 2]), []);
  assert.match(ok("number[]", [1, "x", 3])[0], /^v\[1\]: esperava number/);
  assert.deepEqual(ok("(string | number)[]", ["a", 1]), []);
});

test("objetos: campo obrigatório, opcional e campos a mais", () => {
  const t = "{ nome: string; preco: number; cupom?: string }";
  assert.deepEqual(ok(t, { nome: "a", preco: 3 }), []);
  assert.deepEqual(ok(t, { nome: "a", preco: 3, cupom: "X", extra: 1 }), []); // tipagem estrutural
  assert.match(ok(t, { nome: "a" })[0], /falta o campo "preco"/);
  assert.match(ok(t, { nome: "a", preco: "3" })[0], /^v\.preco: esperava number/);
  assert.match(ok("{ itens: { qtd: int }[] }", { itens: [{ qtd: 1 }, { qtd: 2.5 }] })[0], /^v\.itens\[1\]\.qtd: esperava int/);
});

test("sinônimos em português e impressão normalizada", () => {
  assert.equal(printType(parseType("texto | número | lógico | vazio")), "string | null | number | boolean");
  assert.equal(printType(parseType("texto")), "string | null"); // o português aceita «sem valor»
  assert.equal(printType(parseType("string")), "string"); // o inglês é estrito
  assert.deepEqual(ok("texto", null), []);
  assert.match(ok("string", null)[0], /esperava string, mas é vazio/);
  assert.equal(printType(parseType("{ preco: decimal; qtd?: inteiro }[]")), "{ preco: float | null; qtd?: int | null }[]");
  assert.equal(printType(parseType("(string | number)[]")), "(string | number)[]");
  assert.equal(printType(parseType("{a:string,b:number}")), "{ a: string; b: number }");
});

test("rótulo antigo não é erro; tipo malformado é", () => {
  assert.deepEqual(recognize("dinheiro"), { ok: false, legacy: true });
  assert.deepEqual(recognize("lista de preços"), { ok: false, legacy: true });
  assert.equal(recognize(""), undefined);
  const bad = recognize("number[");
  assert.ok(bad && !bad.ok && !bad.legacy && /"\]"/.test(bad.error));
  const bad2 = recognize("{ preco: }");
  assert.ok(bad2 && !bad2.ok && !bad2.legacy);
  assert.throws(() => parseType("Array"), TypeSyntaxError);
  assert.throws(() => parseType("{ a: string; a: number }"), /duas vezes/);
});

test("L026: valor fixo, exemplo Dado/Esperado e tipo mal escrito", () => {
  const d = applyOps(emptyDoc("t", "logic"), [
    { op: "add_node", id: "qtd", label: "Quantidade", logic: { role: "input", key: "qtd", type: "int", value: 2.5 } },
    { op: "add_node", id: "nivel", label: "Nível", logic: { role: "input", key: "nivel", type: '"ouro" | "prata"' } },
    { op: "add_node", id: "x", label: "Quebrado", logic: { role: "input", key: "x", type: "number[" } },
    { op: "add_node", id: "ant", label: "Antigo", logic: { role: "input", key: "ant", type: "dinheiro" } },
    { op: "add_node", id: "caso", label: "Caso", logic: { role: "scenario", examples: [{ name: "ruim", given: { nivel: "bronze", ant: "qualquer coisa" }, expect: { qtd: 1 } }] } },
  ] as never).doc;
  const m = typeIssues(d).map((i) => i.message);
  assert.ok(m.some((x) => /valor fixo de "Quantidade": qtd: esperava int/.test(x)));
  assert.ok(m.some((x) => /exemplo "ruim" de "Caso" \(Dado\): nivel: esperava "ouro" \| "prata"/.test(x)));
  assert.ok(m.some((x) => /tipo "number\[" do dado "Quebrado" não é um tipo válido/.test(x)));
  assert.equal(m.filter((x) => /Antigo|ant:/.test(x)).length, 0, "rótulo antigo não é conferido");
  assert.equal(m.filter((x) => /\(Esperado\)/.test(x)).length, 0, "qtd = 1 é inteiro: confere");
});

test("os problemas de referência respeitam os tipos que declaram (o oráculo e os tipos concordam)", () => {
  for (const c of nodeCases()) {
    const doc = c.build();
    for (const o of c.oraculo) {
      const probe = structuredClone(doc);
      probe.nodes.push({ id: "__o", label: "o", kind: "logic", x: 0, y: 0, w: 1, h: 1, logic: { role: "scenario", examples: [{ name: o.name, given: o.given, expect: o.expect }] } } as never);
      const bad = typeIssues(probe).filter((i) => i.target === "__o");
      assert.deepEqual(bad.map((i) => i.message), [], `${c.id}: ${o.name}`);
    }
  }
});

test("checkAssignment: avisa só quando tem certeza de que o tipo não cabe", async () => {
  const { checkAssignment } = await import("./typecheck");
  const types: Record<string, string> = { total: "number", qtd: "int", nome: "string", ativo: "boolean", nivel: '"ouro" | "prata"', antigo: "dinheiro", nulavel: "texto", lista: "number[]" };
  const typeOf = (n: string) => { const r = recognize(types[n]); return r && r.ok ? r.type : undefined; };
  const c = (s: string) => checkAssignment(s, typeOf);
  assert.equal(c("total := 10"), undefined);
  assert.equal(c("total := total * 1.1"), undefined);
  assert.equal(c('total := "abc"'), "«total» é number, mas recebe o texto \"abc\"");
  assert.equal(c("total := verdadeiro"), "«total» é number, mas recebe o valor true");
  assert.match(c("qtd := 2.5")!, /«qtd» é int, mas recebe um número/); // decimal não cabe em int
  assert.equal(c("qtd := 3"), undefined);
  assert.match(c("qtd := total * 2")!, /«qtd» é int/); // number não cabe em int
  assert.equal(c('nome := "Ana"'), undefined);
  assert.match(c("nome := 5")!, /«nome» é string/);
  assert.equal(c('nome := nome + "!"'), undefined);
  assert.equal(c("nome := texto(total)"), undefined);
  assert.match(c("nome := total + 1")!, /«nome» é string, mas recebe um número/);
  assert.match(c("ativo := 1")!, /«ativo» é boolean/);
  assert.equal(c("ativo := total > 5 e nome = \"a\""), undefined);
  assert.equal(c('nivel := "ouro"'), undefined);
  assert.match(c('nivel := "bronze"')!, /«nivel» é "ouro" \| "prata", mas recebe o texto "bronze"/);
  assert.match(c("nivel := nome")!, /«nivel»/); // string solta não cabe em literais
  assert.equal(c("antigo := 5"), undefined); // rótulo antigo: não confere
  assert.equal(c("nulavel := nulo"), undefined); // texto = string | null
  assert.match(c("total := nulo")!, /«total» é number, mas recebe vazio/); // number é estrito
  assert.equal(c("lista := [1, 2]"), undefined);
  assert.equal(c("desconhecido := 5"), undefined); // sem tipo declarado
  assert.equal(c("total := itens[0].preco"), undefined); // não infere campo/índice: cala
  assert.equal(c("travar total"), undefined);
  assert.equal(c("total :="), undefined); // sintaxe: outro aviso
});

test("checkAssignment: conta de inteiros dá inteiro; com desconhecido, cala", async () => {
  const { checkAssignment } = await import("./typecheck");
  const types: Record<string, string> = { qtd: "int", total: "number", lista: "number[]", cont: "inteiro", livre: "any" };
  const typeOf = (n: string) => { const r = recognize(types[n]); return r && r.ok ? r.type : undefined; };
  const c = (s: string) => checkAssignment(s, typeOf);
  assert.equal(c("qtd := qtd + 1"), undefined);
  assert.equal(c("qtd := tamanho(lista)"), undefined);
  assert.equal(c("qtd := cont * 2 - 1"), undefined); // inteiro (português) também conta
  assert.equal(c("qtd := piso(total)"), undefined);
  assert.equal(c("qtd := max(qtd, 3)"), undefined);
  assert.equal(c("qtd := qtd + (se total > 5 entao 1 senao 0)"), undefined);
  assert.match(c("qtd := qtd / 2")!, /«qtd» é int/); // divisão pode dar decimal
  assert.match(c("qtd := total + 1")!, /«qtd» é int/); // number não cabe em int
  assert.equal(c("qtd := semtipo + 1"), undefined); // operando sem tipo: não chuta
  assert.equal(c("qtd := livre"), undefined);
});

test("checkAssignment: depois de testar vazio, o dado tem valor no ramo certo", async () => {
  const { checkAssignment } = await import("./typecheck");
  const types: Record<string, string> = { ic: "number | null", ic_efetivo: "number", origem: "string", origem_informada: "string | null" };
  const typeOf = (n: string) => { const r = recognize(types[n]); return r && r.ok ? r.type : undefined; };
  const c = (s: string) => checkAssignment(s, typeOf);
  assert.equal(c("ic_efetivo := se vazio(ic) entao 0 senao ic"), undefined);
  assert.equal(c('origem := se vazio(origem_informada) entao "physical" senao origem_informada'), undefined);
  assert.equal(c("ic_efetivo := se nao vazio(ic) entao ic senao 0"), undefined);
  assert.equal(c("ic_efetivo := se ic = nulo entao 0 senao ic"), undefined);
  assert.equal(c("ic_efetivo := se ic != nulo entao ic senao 0"), undefined);
  // controle negativo: sem o teste, ou no ramo errado, o vazio continua sendo apontado
  assert.match(c("ic_efetivo := ic")!, /«ic_efetivo» é number, mas recebe number \| null/);
  assert.match(c("ic_efetivo := se vazio(ic) entao ic senao 0")!, /«ic_efetivo» é number/);
  assert.match(c("ic_efetivo := se ic > 5 entao ic senao 0")!, /«ic_efetivo» é number/);
});
