import MarkdownIt, { type StateInline } from "markdown-it";
import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import csharp from "highlight.js/lib/languages/csharp";
import css from "highlight.js/lib/languages/css";
import diff from "highlight.js/lib/languages/diff";
import dockerfile from "highlight.js/lib/languages/dockerfile";
import go from "highlight.js/lib/languages/go";
import ini from "highlight.js/lib/languages/ini";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import kotlin from "highlight.js/lib/languages/kotlin";
import markdown from "highlight.js/lib/languages/markdown";
import php from "highlight.js/lib/languages/php";
import plaintext from "highlight.js/lib/languages/plaintext";
import python from "highlight.js/lib/languages/python";
import rust from "highlight.js/lib/languages/rust";
import shell from "highlight.js/lib/languages/shell";
import sql from "highlight.js/lib/languages/sql";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";
import { FONT_CSS, parseAttrs } from "../shared/richtext";

/* ───────── markdown das notas: o texto é o markdown cru; aqui vira HTML com realce de código ───────── */

const LANGS = { bash, csharp, css, diff, dockerfile, go, ini, java, javascript, json, kotlin, markdown, php, plaintext, python, rust, shell, sql, typescript, xml, yaml };
for (const [name, lang] of Object.entries(LANGS)) hljs.registerLanguage(name, lang);
hljs.registerAliases(["jsonc", "json5"], { languageName: "json" });
hljs.registerAliases(["text", "txt"], { languageName: "plaintext" });
hljs.registerAliases(["toml", "env"], { languageName: "ini" });
hljs.registerAliases(["vue", "svelte"], { languageName: "xml" });

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const md = new MarkdownIt({
  html: false, // notas também vêm do MCP/LLM: nada de HTML cru
  linkify: true,
  breaks: true,
  typographer: false,
  highlight(code: string, lang: string) {
    const id = lang.trim().toLowerCase();
    const known = id && hljs.getLanguage(id);
    const body = known ? hljs.highlight(code, { language: id, ignoreIllegals: true }).value : esc(code);
    const cls = id ? ` language-${esc(id)}` : "";
    const tag = id ? `<span class="md-lang">${esc(id)}</span>` : "";
    return `<pre class="md-pre">${tag}<code class="hljs${cls}">${body}</code></pre>`;
  },
});

const defaultLink = md.renderer.rules.link_open ?? ((tokens, idx, opts, _env, self) => self.renderToken(tokens, idx, opts));
md.renderer.rules.link_open = (tokens, idx, opts, env, self) => {
  tokens[idx].attrSet("target", "_blank");
  tokens[idx].attrSet("rel", "noopener noreferrer");
  return defaultLink(tokens, idx, opts, env, self);
};

/** Trechos `{@c=#hex;f=serif;w=700}texto{/}` (cor/fonte/peso) do formato anterior continuam valendo. */
function styledSpan(state: StateInline, silent: boolean): boolean {
  const src = state.src;
  const pos = state.pos;
  if (src.charCodeAt(pos) !== 0x7b /* { */) return false;
  const env = state.env as { richDepth?: number };
  if (src.startsWith("{/}", pos)) {
    if (!env.richDepth) return false;
    if (!silent) {
      state.push("rich_close", "span", -1);
      env.richDepth--;
    }
    state.pos += 3;
    return true;
  }
  const m = /^\{@([^}\n]*)\}/.exec(src.slice(pos));
  if (!m) return false;
  if (!silent) {
    const st = parseAttrs(m[1]);
    const css: string[] = [];
    if (st.color) css.push(`color:${st.color}`);
    if (st.font) css.push(`font-family:${FONT_CSS[st.font]}`);
    if (st.weight) css.push(`font-weight:${st.weight}`);
    const tok = state.push("rich_open", "span", 1);
    if (css.length) tok.attrSet("style", css.join(";"));
    env.richDepth = (env.richDepth ?? 0) + 1;
  }
  state.pos += m[0].length;
  return true;
}
md.inline.ruler.before("emphasis", "rich_style", styledSpan);

/** `- [ ] item` / `- [x] item` viram caixas de seleção (só leitura). */
const TASK = /(<li>(?:<p>)?)\[( |x|X)\]\s?/g;

const cache = new Map<string, string>();

export function renderMarkdown(text: string): string {
  const hit = cache.get(text);
  if (hit !== undefined) return hit;
  const html = md
    .render(text, {})
    .replace(TASK, (_: string, open: string, mark: string) => `${open.replace("<li>", '<li class="md-task">')}<span class="md-box${mark === " " ? "" : " done"}" aria-hidden="true"></span>`);
  if (cache.size > 400) cache.clear();
  cache.set(text, html);
  return html;
}
