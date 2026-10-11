/**
 * Expressões do modo Logic: uma sintaxe pequena, em português, que negócio lê e a máquina verifica.
 *
 *   condição:  categoria.tipo em ["imagem", "trafego"] e preco_atual < piso
 *   cálculo:   custo / (1 - margem_minima)
 *   efeito:    preco := max(preco, piso)        travar preco
 *
 * Sem efeitos colaterais, sem laços, sem acesso a nada fora do ambiente recebido: só dá para ler dados e calcular.
 * Funções puras e sem dependências do app (roda no MCP, no navegador e nos testes).
 */

export type Value = number | string | boolean | null | Value[];

export type Expr =
  | { t: "num"; v: number; pct?: boolean }
  | { t: "str"; v: string }
  | { t: "bool"; v: boolean }
  | { t: "nul" }
  | { t: "id"; name: string }
  | { t: "list"; items: Expr[] }
  | { t: "call"; fn: string; args: Expr[] }
  | { t: "un"; op: "-" | "nao"; x: Expr }
  | { t: "bin"; op: BinOp; l: Expr; r: Expr }
  | { t: "if"; c: Expr; a: Expr; b: Expr };

export type BinOp = "+" | "-" | "*" | "/" | "%" | "=" | "!=" | "<" | "<=" | ">" | ">=" | "em" | "nao-em" | "e" | "ou";

export type Statement = { t: "assign"; name: string; value: Expr } | { t: "lock"; name: string } | { t: "unlock"; name: string };

export class ExprError extends Error {
  constructor(message: string, readonly pos = 0) {
    super(message);
  }
}

/* ───────────── funções permitidas (fonte única: parser, avaliador, explicação e guia da IA) ───────────── */

export const FUNCTIONS: Record<string, { sig: string; doc: string; arity: [number, number] }> = {
  min: { sig: "min(a, b, …)", doc: "o menor dos valores", arity: [1, 99] },
  max: { sig: "max(a, b, …)", doc: "o maior dos valores", arity: [1, 99] },
  abs: { sig: "abs(x)", doc: "valor sem sinal", arity: [1, 1] },
  piso: { sig: "piso(x)", doc: "arredonda para baixo, ao inteiro", arity: [1, 1] },
  teto: { sig: "teto(x)", doc: "arredonda para cima, ao inteiro", arity: [1, 1] },
  arredondar: { sig: "arredondar(x, casas)", doc: "arredonda para o número de casas decimais (padrão 0)", arity: [1, 2] },
  entre: { sig: "entre(x, minimo, maximo)", doc: "verdadeiro se x está na faixa, inclusive nas pontas", arity: [3, 3] },
  vazio: { sig: "vazio(x)", doc: "verdadeiro se x não tem valor", arity: [1, 1] },
  contem: { sig: "contem(lista, x)", doc: "verdadeiro se a lista tem x", arity: [2, 2] },
  tamanho: { sig: "tamanho(lista)", doc: "quantidade de itens (ou de letras, em texto)", arity: [1, 1] },
};

/** Documentação da sintaxe para a IA e para o guia do app. */
export const SYNTAX_GUIDE = [
  "Números: `10`, `0.09` (ponto decimal), `5%` (= 0.05). Texto: `\"imagem\"`. Lógicos: `verdadeiro`, `falso`. Sem valor: `nulo`.",
  "Dados: nomes com letras, números e `_`, podendo ter pontos: `preco_atual`, `categoria.margem`. Listas: `[\"a\", \"b\"]`.",
  "Contas: `+ - * / %` e parênteses. Comparações: `= != < <= > >=`, `em [...]`, `nao em [...]`.",
  "Lógica: `e`, `ou`, `nao` (também `and`, `or`, `not`). Escolha: `se condição entao A senao B`.",
  "Funções: " + Object.values(FUNCTIONS).map((f) => `\`${f.sig}\``).join(", ") + ".",
  "Efeitos (campo `then`): `preco := expressão` (passa a valer), `travar preco` (as regras seguintes não o reescrevem) e `destravar preco` (volta a poder ser reescrito; use em regras que \"vencem tudo\").",
].join("\n");

/* ───────────── léxico ───────────── */

type Tok = { k: "num" | "str" | "id" | "op" | "kw" | "end"; v: string; pos: number; pct?: boolean };

const KEYWORDS: Record<string, string> = {
  e: "e", and: "e", ou: "ou", or: "ou", nao: "nao", não: "nao", not: "nao", em: "em", in: "em",
  se: "se", if: "se", entao: "entao", então: "entao", then: "entao", senao: "senao", senão: "senao", else: "senao",
  verdadeiro: "true", true: "true", falso: "false", false: "false", nulo: "null", null: "null", travar: "travar", destravar: "destravar",
};

const isIdStart = (c: string) => /[\p{L}_]/u.test(c);
const isIdPart = (c: string) => /[\p{L}\p{N}_]/u.test(c);

function lex(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (/[0-9]/.test(c)) {
      let j = i;
      while (j < src.length && /[0-9]/.test(src[j])) j++;
      if (src[j] === "." && /[0-9]/.test(src[j + 1] ?? "")) { j++; while (j < src.length && /[0-9]/.test(src[j])) j++; }
      const raw = src.slice(i, j);
      if (src[j] === "%") { out.push({ k: "num", v: raw, pos: i, pct: true }); j++; } else out.push({ k: "num", v: raw, pos: i });
      i = j;
      continue;
    }
    if (c === '"') {
      let j = i + 1;
      let s = "";
      while (j < src.length && src[j] !== '"') { if (src[j] === "\\" && j + 1 < src.length) j++; s += src[j++]; }
      if (src[j] !== '"') throw new ExprError("texto sem aspas de fechamento", i);
      out.push({ k: "str", v: s, pos: i });
      i = j + 1;
      continue;
    }
    if (isIdStart(c)) {
      let j = i;
      while (j < src.length && (isIdPart(src[j]) || (src[j] === "." && j + 1 < src.length && isIdStart(src[j + 1])))) j++;
      const word = src.slice(i, j);
      const kw = KEYWORDS[word.toLowerCase()];
      out.push(kw && !word.includes(".") ? { k: "kw", v: kw, pos: i } : { k: "id", v: word, pos: i });
      i = j;
      continue;
    }
    const two = src.slice(i, i + 2);
    if (["==", "!=", "<>", "<=", ">=", "&&", "||", ":="].includes(two)) { out.push({ k: "op", v: two, pos: i }); i += 2; continue; }
    if ("+-*/%()[],<>=!".includes(c)) { out.push({ k: "op", v: c, pos: i }); i++; continue; }
    throw new ExprError(`caractere inesperado "${c}"`, i);
  }
  out.push({ k: "end", v: "", pos: src.length });
  return out;
}

/* ───────────── sintaxe ───────────── */

class Parser {
  private p = 0;
  constructor(private toks: Tok[]) {}
  private get cur() { return this.toks[this.p]; }
  private isOp(v: string) { return this.cur.k === "op" && this.cur.v === v; }
  private isKw(v: string) { return this.cur.k === "kw" && this.cur.v === v; }
  private fail(msg: string): never { throw new ExprError(msg, this.cur.pos); }
  private describe(t: Tok) { return t.k === "end" ? "o fim do texto" : `"${t.k === "kw" ? t.v : t.v}"`; }

  atEnd() { return this.cur.k === "end"; }
  expectEnd() { if (!this.atEnd()) this.fail(`sobrou ${this.describe(this.cur)} depois do fim da expressão`); }
  private eatOp(v: string) { if (!this.isOp(v)) this.fail(`esperava "${v}" mas veio ${this.describe(this.cur)}`); this.p++; }

  statement(): Statement {
    if (this.isKw("travar") || this.isKw("destravar")) {
      const t = this.cur.v === "travar" ? "lock" : "unlock";
      this.p++;
      if (this.cur.k !== "id") this.fail(`depois de "${t === "lock" ? "travar" : "destravar"}" vem o nome do dado (ex.: ${t === "lock" ? "travar" : "destravar"} preco)`);
      const name = this.cur.v;
      this.p++;
      return { t, name };
    }
    if (this.cur.k === "id" && this.toks[this.p + 1]?.k === "op" && this.toks[this.p + 1].v === ":=") {
      const name = this.cur.v;
      this.p += 2;
      return { t: "assign", name, value: this.expr() };
    }
    return this.fail('um efeito é "dado := expressão", "travar dado" ou "destravar dado"');
  }

  expr(): Expr {
    if (this.isKw("se")) {
      this.p++;
      const c = this.expr();
      if (!this.isKw("entao")) this.fail('faltou "entao" depois da condição do "se"');
      this.p++;
      const a = this.expr();
      if (!this.isKw("senao")) this.fail('faltou "senao" (todo "se" precisa dos dois caminhos)');
      this.p++;
      return { t: "if", c, a, b: this.expr() };
    }
    return this.or();
  }
  private or(): Expr {
    let l = this.and();
    while (this.isKw("ou") || this.isOp("||")) { this.p++; l = { t: "bin", op: "ou", l, r: this.and() }; }
    return l;
  }
  private and(): Expr {
    let l = this.not();
    while (this.isKw("e") || this.isOp("&&")) { this.p++; l = { t: "bin", op: "e", l, r: this.not() }; }
    return l;
  }
  private not(): Expr {
    if (this.isKw("nao") && !(this.toks[this.p + 1]?.k === "kw" && this.toks[this.p + 1].v === "em")) { this.p++; return { t: "un", op: "nao", x: this.not() }; }
    if (this.isOp("!") ) { this.p++; return { t: "un", op: "nao", x: this.not() }; }
    return this.cmp();
  }
  private cmp(): Expr {
    const l = this.add();
    const ops: Record<string, BinOp> = { "=": "=", "==": "=", "!=": "!=", "<>": "!=", "<": "<", "<=": "<=", ">": ">", ">=": ">=" };
    if (this.cur.k === "op" && ops[this.cur.v]) { const op = ops[this.cur.v]; this.p++; return { t: "bin", op, l, r: this.add() }; }
    if (this.isKw("em")) { this.p++; return { t: "bin", op: "em", l, r: this.add() }; }
    if (this.isKw("nao") && this.toks[this.p + 1]?.k === "kw" && this.toks[this.p + 1].v === "em") { this.p += 2; return { t: "bin", op: "nao-em", l, r: this.add() }; }
    return l;
  }
  private add(): Expr {
    let l = this.mul();
    while (this.isOp("+") || this.isOp("-")) { const op = this.cur.v as "+" | "-"; this.p++; l = { t: "bin", op, l, r: this.mul() }; }
    return l;
  }
  private mul(): Expr {
    let l = this.unary();
    while (this.isOp("*") || this.isOp("/") || this.isOp("%")) { const op = this.cur.v as "*" | "/" | "%"; this.p++; l = { t: "bin", op, l, r: this.unary() }; }
    return l;
  }
  private unary(): Expr {
    if (this.isOp("-")) { this.p++; return { t: "un", op: "-", x: this.unary() }; }
    return this.primary();
  }
  private primary(): Expr {
    const t = this.cur;
    if (t.k === "num") { this.p++; const n = Number(t.v); return t.pct ? { t: "num", v: n / 100, pct: true } : { t: "num", v: n }; }
    if (t.k === "str") { this.p++; return { t: "str", v: t.v }; }
    if (t.k === "kw" && (t.v === "true" || t.v === "false")) { this.p++; return { t: "bool", v: t.v === "true" }; }
    if (t.k === "kw" && t.v === "null") { this.p++; return { t: "nul" }; }
    if (this.isOp("(")) { this.p++; const e = this.expr(); this.eatOp(")"); return e; }
    if (this.isOp("[")) {
      this.p++;
      const items: Expr[] = [];
      if (!this.isOp("]")) { items.push(this.expr()); while (this.isOp(",")) { this.p++; items.push(this.expr()); } }
      this.eatOp("]");
      return { t: "list", items };
    }
    if (t.k === "id") {
      this.p++;
      if (this.isOp("(")) {
        const spec = FUNCTIONS[t.v.toLowerCase()];
        if (!spec) throw new ExprError(`função desconhecida "${t.v}". Disponíveis: ${Object.keys(FUNCTIONS).join(", ")}`, t.pos);
        this.p++;
        const args: Expr[] = [];
        if (!this.isOp(")")) { args.push(this.expr()); while (this.isOp(",")) { this.p++; args.push(this.expr()); } }
        this.eatOp(")");
        if (args.length < spec.arity[0] || args.length > spec.arity[1]) throw new ExprError(`${spec.sig} recebe ${spec.arity[0] === spec.arity[1] ? spec.arity[0] : `${spec.arity[0]} a ${spec.arity[1]}`} valor(es), mas recebeu ${args.length}`, t.pos);
        return { t: "call", fn: t.v.toLowerCase(), args };
      }
      return { t: "id", name: t.v };
    }
    return this.fail(`esperava um valor mas veio ${this.describe(t)}`);
  }
}

export function parseExpr(src: string): Expr {
  const p = new Parser(lex(src));
  const e = p.expr();
  p.expectEnd();
  return e;
}

export function parseStatement(src: string): Statement {
  const p = new Parser(lex(src));
  const s = p.statement();
  p.expectEnd();
  return s;
}

/** Texto -> mensagem de erro (ou undefined se estiver correto), com a posição para a UI marcar. */
export function checkExpr(src: string, kind: "expr" | "statement" = "expr"): { message: string; pos: number } | undefined {
  try {
    if (kind === "expr") parseExpr(src); else parseStatement(src);
    return undefined;
  } catch (e) {
    if (e instanceof ExprError) return { message: e.message, pos: e.pos };
    throw e;
  }
}

/* ───────────── análise estática ───────────── */

/** Dados lidos por uma expressão (nomes completos, ex.: "categoria.margem"). */
export function readsOf(e: Expr, acc = new Set<string>()): Set<string> {
  switch (e.t) {
    case "id": acc.add(e.name); break;
    case "list": e.items.forEach((x) => readsOf(x, acc)); break;
    case "call": e.args.forEach((x) => readsOf(x, acc)); break;
    case "un": readsOf(e.x, acc); break;
    case "bin": readsOf(e.l, acc); readsOf(e.r, acc); break;
    case "if": readsOf(e.c, acc); readsOf(e.a, acc); readsOf(e.b, acc); break;
  }
  return acc;
}

/* ───────────── avaliação ───────────── */

export type Env = Record<string, unknown>;

export class EvalError extends Error {}

function lookup(env: Env, name: string): Value {
  if (name in env) return env[name] as Value;
  let cur: unknown = env;
  for (const part of name.split(".")) {
    if (cur && typeof cur === "object" && part in (cur as object)) cur = (cur as Record<string, unknown>)[part];
    else throw new EvalError(`"${name}" não tem valor neste exemplo`);
  }
  return cur as Value;
}

const num = (v: Value, what: string): number => {
  if (typeof v !== "number" || Number.isNaN(v)) throw new EvalError(`${what} precisa ser número, mas é ${v === null ? "vazio" : JSON.stringify(v)}`);
  return v;
};

const same = (a: Value, b: Value): boolean => (Array.isArray(a) || Array.isArray(b) ? JSON.stringify(a) === JSON.stringify(b) : a === b);

export function evaluate(e: Expr, env: Env): Value {
  switch (e.t) {
    case "num": return e.v;
    case "str": return e.v;
    case "bool": return e.v;
    case "nul": return null;
    case "id": return lookup(env, e.name);
    case "list": return e.items.map((x) => evaluate(x, env));
    case "un": return e.op === "-" ? -num(evaluate(e.x, env), "o valor depois do sinal -") : !truthy(evaluate(e.x, env));
    case "if": return truthy(evaluate(e.c, env)) ? evaluate(e.a, env) : evaluate(e.b, env);
    case "bin": {
      if (e.op === "e") return truthy(evaluate(e.l, env)) && truthy(evaluate(e.r, env));
      if (e.op === "ou") return truthy(evaluate(e.l, env)) || truthy(evaluate(e.r, env));
      const l = evaluate(e.l, env);
      const r = evaluate(e.r, env);
      switch (e.op) {
        case "+": return typeof l === "string" && typeof r === "string" ? l + r : num(l, "o lado esquerdo do +") + num(r, "o lado direito do +");
        case "-": return num(l, "o lado esquerdo do -") - num(r, "o lado direito do -");
        case "*": return num(l, "o lado esquerdo do *") * num(r, "o lado direito do *");
        case "/": { const d = num(r, "o divisor"); if (d === 0) throw new EvalError("divisão por zero"); return num(l, "o dividendo") / d; }
        case "%": { const d = num(r, "o divisor"); if (d === 0) throw new EvalError("divisão por zero"); return num(l, "o dividendo") % d; }
        case "=": return same(l, r);
        case "!=": return !same(l, r);
        case "<": case "<=": case ">": case ">=": {
          if (l === null || r === null) return false;
          const a = typeof l === "string" && typeof r === "string" ? l : num(l, "o lado esquerdo da comparação");
          const b = typeof l === "string" && typeof r === "string" ? r : num(r, "o lado direito da comparação");
          return e.op === "<" ? a < b : e.op === "<=" ? a <= b : e.op === ">" ? a > b : a >= b;
        }
        case "em": case "nao-em": {
          if (!Array.isArray(r)) throw new EvalError('depois de "em" vem uma lista, ex.: em ["a", "b"]');
          const has = r.some((x) => same(x, l));
          return e.op === "em" ? has : !has;
        }
      }
      return null;
    }
    case "call": {
      const a = e.args.map((x) => evaluate(x, env));
      switch (e.fn) {
        case "min": return Math.min(...a.map((v) => num(v, "min")));
        case "max": return Math.max(...a.map((v) => num(v, "max")));
        case "abs": return Math.abs(num(a[0], "abs"));
        case "piso": return Math.floor(num(a[0], "piso"));
        case "teto": return Math.ceil(num(a[0], "teto"));
        case "arredondar": { const f = 10 ** (a[1] === undefined ? 0 : num(a[1], "casas")); return Math.round((num(a[0], "arredondar") + Number.EPSILON) * f) / f; }
        case "entre": return num(a[0], "entre") >= num(a[1], "entre") && num(a[0], "entre") <= num(a[2], "entre");
        case "vazio": return a[0] === null || a[0] === "" || (Array.isArray(a[0]) && a[0].length === 0);
        case "contem": { if (!Array.isArray(a[0])) throw new EvalError("contem(lista, x) precisa de uma lista"); return a[0].some((x) => same(x, a[1])); }
        case "tamanho": return Array.isArray(a[0]) || typeof a[0] === "string" ? a[0].length : (() => { throw new EvalError("tamanho precisa de lista ou texto"); })();
      }
      throw new EvalError(`função "${e.fn}" sem implementação`);
    }
  }
}

function truthy(v: Value): boolean {
  if (typeof v !== "boolean") throw new EvalError(`esperava verdadeiro ou falso, mas veio ${v === null ? "vazio" : JSON.stringify(v)}`);
  return v;
}

/* ───────────── explicação em português ───────────── */

const PREC: Partial<Record<BinOp, number>> = { ou: 1, e: 2, "=": 3, "!=": 3, "<": 3, "<=": 3, ">": 3, ">=": 3, em: 3, "nao-em": 3, "+": 5, "-": 5, "*": 6, "/": 6, "%": 6 };
const CMP_TEXT: Record<string, string> = { "=": "é igual a", "!=": "é diferente de", "<": "é menor que", "<=": "é menor ou igual a", ">": "é maior que", ">=": "é maior ou igual a", em: "está em", "nao-em": "não está em" };
const ARITH_TEXT: Record<string, string> = { "+": "mais", "-": "menos", "*": "vezes", "/": "dividido por", "%": "resto da divisão por" };
/** Forma curta (rótulos de seta): símbolos em vez de palavras. */
const CMP_SHORT: Record<string, string> = { "=": "=", "!=": "≠", "<": "<", "<=": "≤", ">": ">", ">=": "≥", em: "em", "nao-em": "fora de" };
const ARITH_SHORT: Record<string, string> = { "+": "+", "-": "−", "*": "×", "/": "÷", "%": "resto de" };

const fmtNum = (v: number) => String(Math.round(v * 1e9) / 1e9).replace(".", ",");

/** Traduz uma expressão para uma frase em português. `names` troca o nome técnico de um dado pelo nome de negócio. */
export function explain(e: Expr, names: Record<string, string> = {}, short = false): string {
  const CMP = short ? CMP_SHORT : CMP_TEXT;
  const ARITH = short ? ARITH_SHORT : ARITH_TEXT;
  const nm = (n: string) => names[n] ?? (n.includes(".") ? n : n.replace(/_/g, " "));
  const wrap = (x: Expr, parent: number) => (x.t === "bin" && (PREC[x.op] ?? 0) < parent ? `(${go(x)})` : go(x));
  const go = (x: Expr): string => {
    switch (x.t) {
      case "num": return x.pct ? `${fmtNum(x.v * 100)}%` : fmtNum(x.v);
      case "str": return `"${x.v}"`;
      case "bool": return x.v ? "verdadeiro" : "falso";
      case "nul": return "vazio";
      case "id": return nm(x.name);
      case "list": return `[${x.items.map(go).join(", ")}]`;
      case "un": return x.op === "-" ? `-${wrap(x.x, 7)}` : `não (${go(x.x)})`;
      case "if": return `se ${go(x.c)}, então ${go(x.a)}; senão ${go(x.b)}`;
      case "bin": {
        if (x.op === "e") return `${wrap(x.l, 2)} e ${wrap(x.r, 3)}`;
        if (x.op === "ou") return `${wrap(x.l, 1)} ou ${wrap(x.r, 2)}`;
        if (CMP[x.op]) return `${go(x.l)} ${CMP[x.op]} ${go(x.r)}`;
        const p = PREC[x.op]!;
        return `${wrap(x.l, p)} ${ARITH[x.op]} ${wrap(x.r, p + 1)}`;
      }
      case "call": {
        const a = x.args.map(go);
        switch (x.fn) {
          case "min": return `o menor entre ${a.join(", ")}`;
          case "max": return `o maior entre ${a.join(", ")}`;
          case "abs": return `o valor de ${a[0]} sem sinal`;
          case "piso": return short ? `piso(${a[0]})` : `${a[0]} arredondado para baixo`;
          case "teto": return short ? `teto(${a[0]})` : `${a[0]} arredondado para cima`;
          case "arredondar": return a[1] ? `${a[0]} arredondado a ${a[1]} casa(s) decimais` : `${a[0]} arredondado ao inteiro`;
          case "entre": return `${a[0]} está entre ${a[1]} e ${a[2]}`;
          case "vazio": return `${a[0]} está vazio`;
          case "contem": return `${a[0]} contém ${a[1]}`;
          case "tamanho": return `a quantidade de ${a[0]}`;
        }
        return a.join(", ");
      }
    }
  };
  const s = go(e);
  return s;
}

export function explainStatement(s: Statement, names: Record<string, string> = {}): string {
  const nm = (n: string) => names[n] ?? (n.includes(".") ? n : n.replace(/_/g, " "));
  if (s.t === "unlock") return `libera ${nm(s.name)}: volta a poder ser reescrito`;
  return s.t === "lock" ? `trava ${nm(s.name)}: as regras seguintes não o reescrevem` : `${nm(s.name)} passa a ser ${explain(s.value, names)}`;
}

/**
 * Uma escolha "se … entao … senao se … senao …" vira uma lista de ramos (um por linha no quadro).
 * Devolve undefined quando a expressão não é uma escolha. O último ramo, sem condição, é o "senão".
 */
export function branchesOf(e: Expr, names: Record<string, string> = {}): { cond?: string; then: string }[] | undefined {
  if (e.t !== "if") return undefined;
  const out: { cond?: string; then: string }[] = [];
  let cur: Expr = e;
  while (cur.t === "if") {
    out.push({ cond: explain(cur.c, names), then: explain(cur.a, names) });
    cur = cur.b;
  }
  out.push({ then: explain(cur, names) });
  return out;
}
