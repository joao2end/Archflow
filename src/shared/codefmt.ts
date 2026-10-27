/**
 * Realce e formatação das expressões do modo Logic e dos valores (como o debug mostra), para ler código num cartão:
 * - realce: palavras-chave, funções, dados, campos de objeto, números, textos, lógicos/nulo, operadores e ✔/✘;
 * - formatação: o que cabe na largura fica numa linha; o que não cabe quebra antes de `e`/`ou` do nível de fora e abre
 *   listas, objetos e argumentos de função um item por linha, com recuo (o que couber dentro continua numa linha).
 *
 * Tolerante: aceita o que não é expressão válida (`{ id: "A" }`, `sem valor`, `…`), porque formata também o texto dos
 * valores com os dados trocados.
 */

export type CodeKind = "kw" | "lit" | "fn" | "key" | "id" | "num" | "str" | "op" | "punct" | "ok" | "no" | "txt";
export interface CodeTok {
  k: CodeKind | "ws" | "nl";
  v: string;
}

const KEYWORDS = new Set(["e", "ou", "nao", "não", "se", "entao", "então", "senao", "senão", "em", "travar", "destravar", "and", "or", "not", "para", "cada", "até", "ate", "for", "const", "let", "of", "if", "else", "break", "switch", "while", "return"]);
const LITERALS = new Set(["verdadeiro", "falso", "nulo", "true", "false", "null"]);
const LOGICAL = new Set(["e", "ou", "and", "or"]);
const ID = /[A-Za-z_À-ÿ][\wÀ-ÿ]*(?:\.[A-Za-z_À-ÿ][\wÀ-ÿ]*)*/y;
const NUM = /\d+(?:\.\d+)?%?/y;
const STR = /"(?:[^"\\]|\\.)*"?/y;
const WS = /[ \t]+/y;
const OP = /===|!==|:=|<=|>=|!=|==|<>|&&|\|\||[+\-*/%<>=!?]/y;

/** Divide o texto em pedaços com o tipo de cada um (nunca falha). */
export function tokenize(src: string): CodeTok[] {
  const out: CodeTok[] = [];
  let i = 0;
  const take = (re: RegExp) => {
    re.lastIndex = i;
    const m = re.exec(src);
    return m ? m[0] : undefined;
  };
  while (i < src.length) {
    const c = src[i];
    let v: string | undefined;
    if (c === "\n") (out.push({ k: "nl", v: c }), i++);
    else if ((v = take(WS))) (out.push({ k: "ws", v }), (i += v.length));
    else if (c === '"' && (v = take(STR))) (out.push({ k: "str", v }), (i += v.length));
    else if (/\d/.test(c) && (v = take(NUM))) (out.push({ k: "num", v }), (i += v.length));
    else if ((v = take(ID))) {
      i += v.length;
      const rest = src.slice(i).trimStart();
      const low = v.toLowerCase();
      const k: CodeKind = LITERALS.has(low) ? "lit" : KEYWORDS.has(low) ? "kw" : rest.startsWith("(") ? "fn" : rest.startsWith(":") && !rest.startsWith(":=") ? "key" : "id";
      out.push({ k, v });
    } else if ((v = take(OP))) (out.push({ k: "op", v }), (i += v.length));
    else if ("()[]{},:;.".includes(c)) (out.push({ k: "punct", v: c }), i++);
    else if (c === "✔") (out.push({ k: "ok", v: c }), i++);
    else if (c === "✘") (out.push({ k: "no", v: c }), i++);
    else (out.push({ k: "txt", v: c }), i++);
  }
  return out;
}

type Node = CodeTok | { open: CodeTok; items: Node[]; close?: CodeTok };
const isGroup = (n: Node): n is { open: CodeTok; items: Node[]; close?: CodeTok } => "open" in n;
const OPEN: Record<string, string> = { "(": ")", "[": "]", "{": "}" };

function tree(toks: CodeTok[]): Node[] {
  const root: Node[] = [];
  const stack: { open: CodeTok; items: Node[]; close?: CodeTok }[] = [];
  const here = () => (stack.length ? stack[stack.length - 1].items : root);
  for (const t of toks) {
    if (t.k === "punct" && OPEN[t.v]) {
      const g = { open: t, items: [] as Node[] };
      here().push(g);
      stack.push(g);
    } else if (t.k === "punct" && stack.length && OPEN[stack[stack.length - 1].open.v] === t.v) stack.pop()!.close = t;
    else here().push(t);
  }
  return root;
}

const flat = (ns: Node[]): string => ns.map((n) => (isGroup(n) ? n.open.v + flat(n.items) + (n.close?.v ?? "") : n.v)).join("");
const trimWs = (ns: Node[]) => {
  let a = 0;
  let b = ns.length;
  while (a < b && !isGroup(ns[a]) && (ns[a] as CodeTok).k === "ws") a++;
  while (b > a && !isGroup(ns[b - 1]) && (ns[b - 1] as CodeTok).k === "ws") b--;
  return ns.slice(a, b);
};

/** Formata: devolve os pedaços com quebras de linha e recuos inseridos onde a linha passaria da largura. */
export function formatCode(src: string, width = 48): CodeTok[] {
  const out: CodeTok[] = [];
  const nl = (indent: number) => out.push({ k: "nl", v: "\n" }, ...(indent ? [{ k: "ws" as const, v: " ".repeat(indent) }] : []));
  const emitFlat = (ns: Node[]) => {
    for (const n of ns) {
      if (isGroup(n)) {
        out.push(n.open);
        emitFlat(n.items);
        if (n.close) out.push(n.close);
      } else out.push(n);
    }
  };
  /** uma sequência no recuo `indent`, começando na coluna `col` */
  const seq = (ns: Node[], indent: number, col: number) => {
    if (col + flat(ns).length <= width) return emitFlat(ns);
    // quebra antes de e/ou do nível de fora
    const parts: Node[][] = [[]];
    for (const n of ns) {
      if (!isGroup(n) && ((n.k === "kw" && LOGICAL.has(n.v.toLowerCase())) || (n.k === "op" && (n.v === "&&" || n.v === "||"))) && parts[parts.length - 1].length) parts.push([n]);
      else parts[parts.length - 1].push(n);
    }
    parts.forEach((p, i) => {
      const part = trimWs(p);
      if (i > 0) nl(indent + 2);
      let c = i > 0 ? indent + 2 : col;
      for (const n of part) {
        if (isGroup(n)) group(n, i > 0 ? indent + 2 : indent, c);
        else out.push(n);
        c = lineCol();
      }
    });
  };
  const lineCol = () => {
    let c = 0;
    for (let i = out.length - 1; i >= 0 && out[i].k !== "nl"; i--) c += out[i].v.length;
    return c;
  };
  /** um grupo ( [ {: inteiro se couber; senão um item por linha, com recuo */
  const group = (g: { open: CodeTok; items: Node[]; close?: CodeTok }, indent: number, col: number) => {
    const text = g.open.v + flat(g.items) + (g.close?.v ?? "");
    const items: Node[][] = [[]];
    for (const n of g.items) {
      if (!isGroup(n) && n.k === "punct" && n.v === ",") items.push([]);
      else items[items.length - 1].push(n);
    }
    if (col + text.length <= width || (items.length === 1 && !trimWs(items[0]).length)) {
      out.push(g.open);
      emitFlat(g.items);
      if (g.close) out.push(g.close);
      return;
    }
    out.push(g.open);
    // lista ou objeto de itens simples (sem lista, objeto ou chamada dentro): quantos couberem por linha
    if (g.open.v !== "(" && items.length > 1 && items.every((it) => it.every((n) => !isGroup(n)))) {
      nl(indent + 2);
      let c = indent + 2;
      items.forEach((it, i) => {
        const t = trimWs(it);
        const len = flat(t).length + (i < items.length - 1 ? 1 : 0);
        if (c > indent + 2 && c + 1 + len > width) (nl(indent + 2), (c = indent + 2));
        else if (c > indent + 2) (out.push({ k: "ws", v: " " }), c++);
        emitFlat(t);
        if (i < items.length - 1) out.push({ k: "punct", v: "," });
        c += len;
      });
      if (g.close) (nl(indent), out.push(g.close));
      return;
    }
    items.forEach((it, i) => {
      nl(indent + 2);
      seq(trimWs(it), indent + 2, indent + 2);
      if (i < items.length - 1) out.push({ k: "punct", v: "," });
    });
    if (g.close) {
      nl(indent);
      out.push(g.close);
    }
  };
  // linhas que já vêm separadas continuam separadas
  src.split("\n").forEach((line, i) => {
    if (i > 0) nl(0);
    seq(tree(tokenize(line)), 0, 0);
  });
  return out;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** HTML com realce (`<span class="t-kw">`…) e as quebras do `formatCode`; mostre num elemento com `white-space: pre-wrap`. */
export function codeHtml(src: string, width = 48): string {
  return formatCode(src, width)
    .map((t) => (t.k === "ws" || t.k === "nl" || t.k === "txt" ? esc(t.v) : `<span class="t-${t.k}">${esc(t.v)}</span>`))
    .join("");
}
