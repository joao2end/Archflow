import { test } from "node:test";
import assert from "node:assert/strict";
import { renderMarkdown } from "../ui/markdown";

test("bloco ``` com linguagem recebe realce", () => {
  const html = renderMarkdown('```json\n{ "a": 1 }\n```');
  assert.match(html, /<pre class="md-pre"><span class="md-lang">json<\/span><code class="hljs language-json">/);
  assert.match(html, /hljs-attr/);
  assert.match(html, /hljs-number/);
});

test("linguagem desconhecida só escapa o código", () => {
  const html = renderMarkdown("```zzz\n<b>x</b>\n```");
  assert.match(html, /&lt;b&gt;x&lt;\/b&gt;/);
});

test("HTML cru não é interpretado", () => {
  const html = renderMarkdown('<img src=x onerror="alert(1)">');
  assert.doesNotMatch(html, /<img/);
});

test("markdown completo: títulos, ênfase, citação, tabela", () => {
  const html = renderMarkdown("### t\n**b** *i* ~~s~~ `c`\n\n> q\n\n| a | b |\n|---|---|\n| 1 | 2 |");
  for (const tag of ["<h3>", "<strong>b</strong>", "<em>i</em>", "<s>s</s>", "<code>c</code>", "<blockquote>", "<table>"]) assert.ok(html.includes(tag), tag);
});

test("trechos {@…} viram span com estilo", () => {
  const html = renderMarkdown("a {@c=#ff0000;w=700}b{/} c");
  assert.match(html, /<span style="color:#ff0000;font-weight:700">b<\/span>/);
});

test("{@…} sem par no mesmo bloco não derruba a renderização", () => {
  for (const s of ["{@c=#ff0000}a\n\nb{/}", "- {@c=#ff0000}a\n- b{/}", "{@c=#f00}a\n\n{/}x", "{/} solto", "{@c=#f00}sem fim"]) {
    const html = renderMarkdown(s);
    assert.doesNotMatch(html, /<span style/, s);
  }
  assert.match(renderMarkdown("{@c=#f00}**a{/}**"), /<span style="color:#f00">/);
  assert.match(renderMarkdown("- {@c=#f00}a{/}\n- b"), /<li><span style="color:#f00">a<\/span><\/li>/);
});

test("escapes do formato antigo continuam valendo", () => {
  assert.match(renderMarkdown("\\*não itálico\\*"), /\*não itálico\*/);
});

test("checklist e links", () => {
  const html = renderMarkdown("- [ ] a\n- [x] b\n\nhttps://exemplo.com");
  assert.match(html, /<li class="md-task"><span class="md-box"/);
  assert.match(html, /md-box done/);
  assert.match(html, /<a href="https:\/\/exemplo.com" target="_blank" rel="noopener noreferrer">/);
});
