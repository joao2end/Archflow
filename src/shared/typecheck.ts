/**
 * Confere uma atribuição (`dado := expressão`) com o tipo do dado, sem executar nada.
 *
 * Infere o tipo do lado direito só quando tem certeza (literais, contas, comparações, funções conhecidas e dados com tipo declarado).
 * O que não sabe (campo de objeto, índice de lista, dado sem tipo, rótulo antigo) fica sem tipo e NÃO gera aviso: melhor calar
 * do que acusar sem prova. Só avisa; nunca impede salvar.
 */
import { parseStatement, type Expr } from "./expr";
import { printType, type Type } from "./types";

const prim = (n: "string" | "number" | "int" | "boolean" | "null" | "any"): Type => ({ k: "prim", n });
const STRING = prim("string");
const NUMBER = prim("number");
const BOOL = prim("boolean");
const INT = prim("int");

/** O valor é sempre inteiro? (ignora o «sem valor» dos sinônimos em português: conta com vazio já dá erro de execução) */
const isInt = (t?: Type): boolean => !!t && (t.k === "lit" ? typeof t.v === "number" && Number.isInteger(t.v) : t.k === "prim" ? t.n === "int" : t.k === "union" ? t.of.filter((m) => !(m.k === "prim" && m.n === "null")).every(isInt) : false);

const FN_TYPE: Record<string, Type | undefined> = {
  texto: STRING, aparar: STRING, maiusculas: STRING, minusculas: STRING, trocar: STRING, juntar: STRING, somar_dias: STRING,
  numero: NUMBER, soma: NUMBER, media: NUMBER, min: NUMBER, max: NUMBER, abs: NUMBER, arredondar: NUMBER,
  piso: INT, teto: INT, tamanho: INT, dias_entre: INT,
  vazio: BOOL, contem: BOOL, entre: BOOL,
  partir: { k: "arr", of: STRING },
};

const stripNull = (t?: Type): Type | undefined => {
  if (!t) return t;
  if (t.k === "prim" && t.n === "null") return undefined;
  if (t.k !== "union") return t;
  const rest = t.of.filter((m) => !(m.k === "prim" && m.n === "null"));
  return rest.length === 0 ? undefined : rest.length === 1 ? rest[0] : { k: "union", of: rest };
};

/** A condição testa se um dado está vazio? Devolve o dado e em qual ramo ele certamente TEM valor. */
function narrowing(c: Expr): { name: string; nonNullInThen: boolean } | undefined {
  const idOf = (x: Expr) => (x.t === "id" ? x.name : undefined);
  if (c.t === "call" && c.fn === "vazio" && c.args[0] && idOf(c.args[0])) return { name: idOf(c.args[0])!, nonNullInThen: false };
  if (c.t === "un" && c.op === "nao") {
    const inner = narrowing(c.x);
    return inner ? { ...inner, nonNullInThen: !inner.nonNullInThen } : undefined;
  }
  if (c.t === "bin" && (c.op === "=" || c.op === "!=")) {
    const name = c.l.t === "id" && c.r.t === "nul" ? idOf(c.l) : c.r.t === "id" && c.l.t === "nul" ? idOf(c.r) : undefined;
    if (name) return { name, nonNullInThen: c.op === "!=" };
  }
  return undefined;
}

/** O tipo de uma expressão, ou `undefined` quando não dá para ter certeza. */
export function inferType(e: Expr, typeOf: (name: string) => Type | undefined): Type | undefined {
  switch (e.t) {
    case "num": return Number.isInteger(e.v) && !e.pct ? { k: "lit", v: e.v } : NUMBER;
    case "str": return { k: "lit", v: e.v };
    case "bool": return { k: "lit", v: e.v };
    case "nul": return prim("null");
    case "id": return typeOf(e.name);
    case "list": return { k: "arr", of: prim("any") };
    case "un": return e.op === "-" ? (isInt(inferType(e.x, typeOf)) ? INT : NUMBER) : BOOL;
    case "call": {
      if (["min", "max", "abs"].includes(e.fn)) return e.args.every((a) => isInt(inferType(a, typeOf))) ? INT : NUMBER;
      return FN_TYPE[e.fn];
    }
    case "if": {
      // estreitamento: depois de `vazio(x)` ou `x = nulo` o ramo «senão» tem x sem vazio (e o inverso com `nao vazio(x)` / `x != nulo`)
      const n = narrowing(e.c);
      const without = (name: string) => (k: string) => (k === name ? stripNull(typeOf(k)) : typeOf(k));
      const a = inferType(e.a, n && !n.nonNullInThen ? typeOf : n ? without(n.name) : typeOf);
      const b = inferType(e.b, n && n.nonNullInThen ? typeOf : n ? without(n.name) : typeOf);
      return a && b && printType(a) === printType(b) ? a : a && b ? { k: "union", of: [a, b] } : undefined;
    }
    case "bin": {
      if (["=", "!=", "<", "<=", ">", ">=", "em", "nao-em", "e", "ou"].includes(e.op)) return BOOL;
      const l = inferType(e.l, typeOf);
      const r = inferType(e.r, typeOf);
      if (e.op === "+") {
        const isText = (t?: Type) => !!t && (t.k === "lit" ? typeof t.v === "string" : t.k === "prim" && t.n === "string");
        if (isText(l) || isText(r)) return STRING; // «a» + 1 junta texto
      }
      if (!l || !r) return undefined; // dado sem tipo: pode ser texto, decimal ou inteiro; não chuta
      if (e.op === "/") return NUMBER;
      return isInt(l) && isInt(r) ? INT : NUMBER;
    }
    default: return undefined; // idx, field
  }
}

/** `from` cabe em `to`? (`int` cabe em `number`; `number` não cabe em `int`; texto não cabe em literal sem prova.) */
export function assignable(from: Type, to: Type): boolean {
  if (to.k === "prim" && to.n === "any") return true;
  if (from.k === "prim" && from.n === "any") return true;
  if (from.k === "union") return from.of.every((m) => assignable(m, to));
  if (to.k === "union") return to.of.some((m) => assignable(from, m));
  if (from.k === "lit") {
    if (to.k === "lit") return from.v === to.v;
    if (to.k !== "prim") return false;
    if (typeof from.v === "string") return to.n === "string";
    if (typeof from.v === "boolean") return to.n === "boolean";
    return to.n === "number" || to.n === "float" || (to.n === "int" && Number.isInteger(from.v));
  }
  if (from.k === "prim") {
    if (to.k !== "prim") return false;
    if (from.n === to.n) return true;
    if (from.n === "int") return to.n === "number" || to.n === "float";
    return (from.n === "number" && to.n === "float") || (from.n === "float" && to.n === "number");
  }
  if (from.k === "arr") return to.k === "arr" && assignable(from.of, to.of);
  return false; // obj: não infere
}

const describe = (t: Type): string => (t.k === "lit" ? (typeof t.v === "string" ? `o texto ${JSON.stringify(t.v)}` : `o valor ${t.v}`) : t.k === "arr" ? "uma lista" : t.k === "prim" ? (t.n === "string" ? "um texto" : t.n === "boolean" ? "um lógico" : t.n === "null" ? "vazio" : "um número") : printType(t));

/** Mensagem quando a atribuição `src` dá ao dado um valor de tipo incompatível; `undefined` se confere ou não dá para saber. */
export function checkAssignment(src: string, typeOf: (name: string) => Type | undefined): string | undefined {
  let st;
  try {
    st = parseStatement(src);
  } catch {
    return undefined; // erro de sintaxe: outro aviso cuida
  }
  if (st.t !== "assign") return undefined;
  const want = typeOf(st.name);
  if (!want) return undefined;
  const got = inferType(st.value, typeOf);
  if (!got || assignable(got, want)) return undefined;
  return `«${st.name}» é ${printType(want)}, mas recebe ${describe(got)}`;
}
