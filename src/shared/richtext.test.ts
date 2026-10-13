import { test } from "node:test";
import assert from "node:assert/strict";
import { isRich, parseInline, parseRich, plainText, serializeRich } from "./richtext";

const roundtrip = (s: string) => serializeRich(parseRich(s));

test("inline: negrito, itálico, riscado e código", () => {
  assert.deepEqual(parseInline("a **b** *c* ~~d~~ `e`"), [{ t: "a " }, { t: "b", b: true }, { t: " " }, { t: "c", i: true }, { t: " " }, { t: "d", s: true }, { t: " " }, { t: "e", c: true }]);
});

test("inline: estilos aninhados", () => {
  assert.deepEqual(parseInline("**a *b* c**"), [{ t: "a ", b: true }, { t: "b", b: true, i: true }, { t: " c", b: true }]);
});

test("asteriscos soltos não viram itálico", () => {
  assert.deepEqual(parseInline("2 * 3 * 4"), [{ t: "2 * 3 * 4" }]);
  assert.equal(isRich("preço * quantidade"), false);
});

test("blocos: título, lista, lista numerada e parágrafo", () => {
  const b = parseRich("# T\n## S\n- a\n1. x\n2. y\ntexto");
  assert.deepEqual(
    b.map((x) => [x.kind, x.n]),
    [["h1", undefined], ["h2", undefined], ["ul", undefined], ["ol", 1], ["ol", 2], ["p", undefined]],
  );
});

test("a numeração segue a do texto", () => {
  assert.deepEqual(parseRich("3. a\n4. b").map((x) => x.n), [3, 4]);
});

test("plainText remove as marcações", () => {
  assert.equal(plainText("# Oi **mundo**\n- um `dois`"), "Oi mundo\num dois");
});

test("escapes: o caractere literal sobrevive", () => {
  assert.equal(plainText("a \\*b\\* c"), "a *b* c");
  assert.equal(isRich("a \\*b\\* c"), false);
});

test("ida e volta preserva o texto guardado", () => {
  for (const s of ["**a** *b* ~~c~~ `d`", "# Título\n- um\n- dois\n1. x\n2. y", "texto \\*literal\\*", "\\- não é lista", "1\\. não é numerada", "", "linha\n\nlinha"]) {
    assert.equal(roundtrip(s), s, JSON.stringify(s));
  }
});

test("serializar escapa o que o usuário digitou", () => {
  assert.equal(serializeRich([{ kind: "p", spans: [{ t: "2 * 3" }] }]), "2 \\* 3");
  assert.equal(serializeRich([{ kind: "p", spans: [{ t: "- item" }] }]), "\\- item");
  assert.equal(serializeRich([{ kind: "p", spans: [{ t: "oi ", b: true }, { t: "x" }] }]), "**oi** x");
});

test("estilos aninhados ficam equivalentes após ida e volta", () => {
  const a = parseRich("**a *b* c**");
  assert.deepEqual(parseRich(serializeRich(a)), a);
});

test("inline: cor, fonte e peso", () => {
  assert.deepEqual(parseInline("{@c=#e5484d;f=serif;w=700}oi{/}"), [{ t: "oi", color: "#e5484d", font: "serif", weight: 700 }]);
  assert.deepEqual(parseInline("{@c=#f00}**x**{/}"), [{ t: "x", b: true, color: "#f00" }]);
  assert.deepEqual(parseInline("**{@c=#2f80ed}y{/}**"), [{ t: "y", b: true, color: "#2f80ed" }]);
});

test("plainText e isRich com estilo", () => {
  assert.equal(plainText("{@c=#e5484d}alerta{/}"), "alerta");
  assert.equal(isRich("{@f=mono}x{/}"), true);
  assert.equal(isRich("texto simples"), false);
});

test("ida e volta preserva cor, fonte e peso", () => {
  for (const s of ["{@c=#e5484d}a{/}", "{@f=serif;w=600}b{/}", "{@c=#2f80ed;f=mono;w=800}**c**{/}", "a {@c=#facc15}b{/} c"]) {
    assert.equal(roundtrip(s), s, JSON.stringify(s));
  }
  const a = parseRich("{@c=#a855f7;f=serif}**x** *y*{/}");
  assert.deepEqual(parseRich(serializeRich(a)), a);
});

test("escapa {@ e {/ literais", () => {
  assert.equal(plainText("\\{@ não é estilo"), "{@ não é estilo");
  assert.equal(serializeRich([{ kind: "p", spans: [{ t: "{@x}y{/}" }] }]), "\\{@x}y\\{/}");
});

test("fence multilinha: ```lang … ```", () => {
  const src = "antes\n```json\n{ \"a\": 1 }\n```\ndepois";
  const b = parseRich(src);
  assert.equal(b[0].kind, "p");
  assert.equal(b[1].kind, "pre");
  assert.equal(b[1].lang, "json");
  assert.equal(b[1].spans[0].t, '{ "a": 1 }');
  assert.equal(b[2].kind, "p");
  assert.equal(plainText(src), 'antes\n{ "a": 1 }\ndepois');
  assert.equal(isRich(src), true);
  assert.equal(roundtrip(src), src);
});

test("fence numa linha: ```json teste ```", () => {
  const src = "```json teste ```";
  const b = parseRich(src);
  assert.equal(b.length, 1);
  assert.equal(b[0].kind, "pre");
  assert.equal(b[0].lang, "json");
  assert.equal(b[0].spans[0].t, "teste ");
  assert.deepEqual(parseRich(roundtrip(src)), b);
  assert.equal(roundtrip(src), "```json\nteste \n```");
});

test("fence sem linguagem", () => {
  const src = "```\nfoo\nbar\n```";
  const b = parseRich(src);
  assert.equal(b[0].kind, "pre");
  assert.equal(b[0].lang, undefined);
  assert.equal(b[0].spans[0].t, "foo\nbar");
  assert.equal(roundtrip(src), src);
});
