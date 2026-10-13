/**
 * Tipos dos dados do modo Logic, na sintaxe do TypeScript.
 *
 *   string · number · int · float · boolean · null · any
 *   "ouro" | "prata"            união de literais (um "enum")
 *   string[]  ·  Array<number>  listas
 *   { nome: string; preco: number; cupom?: string }   objetos (campo opcional com ?)
 *   { preco: number }[]         lista de objetos
 *
 * Acréscimos ao TypeScript, porque regra de negócio pede: `int` (inteiro) e `float` (decimal; aceita inteiro), e sinônimos em
 * português (texto, número, inteiro, decimal, lógico, vazio) para quem não programa. Os sinônimos aceitam «sem valor»:
 * `texto` = `string | null` (é o vocabulário que os diagramas já usam, e «sem valor» é um estado normal nas regras).
 * Os nomes em inglês são estritos, como o TypeScript com strictNullChecks.
 * Tipagem estrutural, como no TypeScript: um objeto com campos a mais ainda serve. Só confere a forma, não executa nada.
 *
 * Um texto que não é tipo (rótulos antigos como "dinheiro", "lista de preços") continua valendo como rótulo: `recognize`
 * devolve `legacy`, e nada é conferido. Só um texto que PARECE tipo e está errado (`number[`, `{ a: }`) vira erro.
 *
 * Só depende de `schema.ts` (tipos). Determinístico.
 */
import type { LogicValue } from "./schema";

export type Prim = "string" | "number" | "int" | "float" | "boolean" | "null" | "any";
export type Type =
  | { k: "prim"; n: Prim }
  | { k: "lit"; v: string | number | boolean }
  | { k: "arr"; of: Type }
  | { k: "obj"; fields: { name: string; optional: boolean; t: Type }[] }
  | { k: "union"; of: Type[] };

export class TypeSyntaxError extends Error {
  constructor(message: string, readonly pos = 0) {
    super(message);
  }
}

const PT_NULLABLE = new Set(["texto", "numero", "número", "inteiro", "decimal", "logico", "lógico", "booleano", "vazio"]);

const PRIMS: Record<string, Prim> = {
  string: "string", texto: "string",
  number: "number", numero: "number", número: "number",
  int: "int", integer: "int", inteiro: "int",
  float: "float", decimal: "float",
  boolean: "boolean", bool: "boolean", booleano: "boolean", logico: "boolean", lógico: "boolean",
  null: "null", nulo: "null", vazio: "null",
  any: "any", unknown: "any", qualquer: "any",
};

type Tok = { k: "id" | "str" | "num" | "p" | "end"; v: string; pos: number };

function lex(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === '"' || c === "'") {
      let j = i + 1;
      let s = "";
      while (j < src.length && src[j] !== c) { if (src[j] === "\\" && j + 1 < src.length) j++; s += src[j++]; }
      if (src[j] !== c) throw new TypeSyntaxError("texto sem aspas de fechamento", i);
      out.push({ k: "str", v: s, pos: i });
      i = j + 1;
      continue;
    }
    if (/[0-9]/.test(c) || (c === "-" && /[0-9]/.test(src[i + 1] ?? ""))) {
      let j = i + 1;
      while (j < src.length && /[0-9.]/.test(src[j])) j++;
      out.push({ k: "num", v: src.slice(i, j), pos: i });
      i = j;
      continue;
    }
    if (/[\p{L}_]/u.test(c)) {
      let j = i;
      while (j < src.length && /[\p{L}\p{N}_]/u.test(src[j])) j++;
      out.push({ k: "id", v: src.slice(i, j), pos: i });
      i = j;
      continue;
    }
    if ("{}[]()<>|:;,?".includes(c)) { out.push({ k: "p", v: c, pos: i }); i++; continue; }
    throw new TypeSyntaxError(`caractere inesperado "${c}"`, i);
  }
  out.push({ k: "end", v: "", pos: src.length });
  return out;
}

class P {
  private i = 0;
  constructor(private t: Tok[]) {}
  private get cur() { return this.t[this.i]; }
  private is(v: string) { return this.cur.k === "p" && this.cur.v === v; }
  private eat(v: string) {
    if (!this.is(v)) throw new TypeSyntaxError(`esperava "${v}" mas veio ${this.cur.k === "end" ? "o fim do texto" : `"${this.cur.v}"`}`, this.cur.pos);
    this.i++;
  }
  parse(): Type {
    const t = this.union();
    if (this.cur.k !== "end") throw new TypeSyntaxError(`sobrou "${this.cur.v}" depois do tipo`, this.cur.pos);
    return t;
  }
  private union(): Type {
    if (this.is("|")) this.i++;
    const of: Type[] = [];
    const add = (t: Type) => (t.k === "union" ? t.of : [t]).forEach((m) => { if (!of.some((x) => printType(x) === printType(m))) of.push(m); });
    add(this.postfix());
    while (this.is("|")) { this.i++; add(this.postfix()); }
    return of.length === 1 ? of[0] : { k: "union", of };
  }
  private postfix(): Type {
    let t = this.primary();
    while (this.is("[")) { this.i++; this.eat("]"); t = { k: "arr", of: t }; }
    return t;
  }
  private primary(): Type {
    const c = this.cur;
    if (c.k === "str") { this.i++; return { k: "lit", v: c.v }; }
    if (c.k === "num") { this.i++; return { k: "lit", v: Number(c.v) }; }
    if (this.is("(")) { this.i++; const t = this.union(); this.eat(")"); return t; }
    if (this.is("{")) return this.object();
    if (c.k === "id") {
      this.i++;
      const w = c.v.toLowerCase();
      if (w === "true" || w === "verdadeiro") return { k: "lit", v: true };
      if (w === "false" || w === "falso") return { k: "lit", v: false };
      if (w === "array" || w === "lista") {
        if (this.is("<")) { this.i++; const of = this.union(); this.eat(">"); return { k: "arr", of }; }
        if (w === "array") throw new TypeSyntaxError('Array precisa do tipo dos itens: Array<number> (ou number[])', c.pos);
        return { k: "arr", of: { k: "prim", n: "any" } };
      }
      const p = PRIMS[w];
      // «texto», «número», «inteiro»…: o vocabulário de negócio aceita «sem valor» (texto = string | null); os nomes em inglês são estritos
      if (p && PT_NULLABLE.has(w) && p !== "null" && p !== "any") return { k: "union", of: [{ k: "prim", n: p }, { k: "prim", n: "null" }] };
      if (!p) throw new TypeSyntaxError(`tipo desconhecido "${c.v}". Use string, number, int, float, boolean, null, "a" | "b", T[] ou { campo: tipo }`, c.pos);
      return { k: "prim", n: p };
    }
    throw new TypeSyntaxError(`esperava um tipo mas veio ${c.k === "end" ? "o fim do texto" : `"${c.v}"`}`, c.pos);
  }
  private object(): Type {
    this.eat("{");
    const fields: { name: string; optional: boolean; t: Type }[] = [];
    while (!this.is("}")) {
      const n = this.cur;
      if (n.k !== "id" && n.k !== "str") throw new TypeSyntaxError(`esperava o nome de um campo mas veio ${n.k === "end" ? "o fim do texto" : `"${n.v}"`}`, n.pos);
      this.i++;
      const optional = this.is("?");
      if (optional) this.i++;
      this.eat(":");
      if (fields.some((f) => f.name === n.v)) throw new TypeSyntaxError(`o campo "${n.v}" aparece duas vezes`, n.pos);
      fields.push({ name: n.v, optional, t: this.union() });
      if (this.is(";") || this.is(",")) this.i++;
      else if (!this.is("}")) throw new TypeSyntaxError(`separe os campos com ";" (ou ","); veio ${this.cur.k === "end" ? "o fim do texto" : `"${this.cur.v}"`}`, this.cur.pos);
    }
    this.eat("}");
    return { k: "obj", fields };
  }
}

/** Texto -> tipo. Lança `TypeSyntaxError` com a posição. */
export function parseType(src: string): Type {
  return new P(lex(src)).parse();
}

export type Recognized = { ok: true; type: Type } | { ok: false; legacy: true } | { ok: false; legacy: false; error: string; pos: number };

/** Um texto de tipo: reconhecido, rótulo antigo (palavras soltas que não são tipo, ex.: "dinheiro") ou erro de sintaxe. */
export function recognize(src: string | undefined): Recognized | undefined {
  const text = (src ?? "").trim();
  if (!text) return undefined;
  try {
    return { ok: true, type: parseType(text) };
  } catch (e) {
    if (!(e instanceof TypeSyntaxError)) throw e;
    // só palavras (sem símbolos de tipo): é um rótulo de negócio, como "dinheiro" ou "lista de preços"
    if (/^[\p{L}\p{N}_ ]+$/u.test(text) && !/\b(array|string|number|int|float|boolean)\b/i.test(text)) return { ok: false, legacy: true };
    return { ok: false, legacy: false, error: e.message, pos: e.pos };
  }
}

/** O tipo escrito de forma normalizada (como o TypeScript o escreveria). */
export function printType(t: Type): string {
  switch (t.k) {
    case "prim": return t.n;
    case "lit": return typeof t.v === "string" ? JSON.stringify(t.v) : String(t.v);
    case "arr": return `${t.of.k === "union" ? `(${printType(t.of)})` : printType(t.of)}[]`;
    case "union": return t.of.map(printType).join(" | ");
    case "obj": return t.fields.length ? `{ ${t.fields.map((f) => `${f.name}${f.optional ? "?" : ""}: ${printType(f.t)}`).join("; ")} }` : "{}";
  }
}

const show = (v: unknown): string => (v === null ? "vazio" : typeof v === "string" ? JSON.stringify(v) : Array.isArray(v) ? `uma lista de ${v.length}` : typeof v === "object" ? "um objeto" : String(v));
const kind = (v: unknown): string => (v === null ? "vazio" : Array.isArray(v) ? "uma lista" : typeof v === "object" ? "um objeto" : typeof v === "string" ? "um texto" : typeof v === "number" ? "um número" : "um lógico");

/** Confere o valor com o tipo. Devolve os problemas (vazio = confere), cada um com o caminho (`itens[1].preco`). */
export function checkValue(t: Type, v: LogicValue | undefined, path = "valor"): string[] {
  const problems: string[] = [];
  const walk = (t: Type, v: unknown, at: string): boolean => {
    switch (t.k) {
      case "prim":
        switch (t.n) {
          case "any": return true;
          case "string": return typeof v === "string" || (problems.push(`${at}: esperava string, mas é ${kind(v)} (${show(v)})`), false);
          case "boolean": return typeof v === "boolean" || (problems.push(`${at}: esperava boolean, mas é ${kind(v)} (${show(v)})`), false);
          case "null": return v === null || (problems.push(`${at}: esperava null (vazio), mas é ${kind(v)} (${show(v)})`), false);
          case "number":
          case "float": return (typeof v === "number" && Number.isFinite(v)) || (problems.push(`${at}: esperava ${t.n}, mas é ${kind(v)} (${show(v)})`), false);
          case "int": return (typeof v === "number" && Number.isInteger(v)) || (problems.push(`${at}: esperava int (inteiro), mas é ${typeof v === "number" ? `o decimal ${v}` : `${kind(v)} (${show(v)})`}`), false);
        }
        return true;
      case "lit": return v === t.v || (problems.push(`${at}: esperava ${printType(t)}, mas é ${show(v)}`), false);
      case "arr": {
        if (!Array.isArray(v)) return (problems.push(`${at}: esperava ${printType(t)}, mas é ${kind(v)} (${show(v)})`), false);
        let ok = true;
        v.forEach((x, i) => { if (!walk(t.of, x, `${at}[${i}]`)) ok = false; });
        return ok;
      }
      case "obj": {
        if (v === null || typeof v !== "object" || Array.isArray(v)) return (problems.push(`${at}: esperava ${printType(t)}, mas é ${kind(v)} (${show(v)})`), false);
        const o = v as Record<string, unknown>;
        let ok = true;
        for (const f of t.fields) {
          if (!(f.name in o)) { if (!f.optional) { problems.push(`${at}: falta o campo "${f.name}" (${printType(f.t)})`); ok = false; } continue; }
          if (!walk(f.t, o[f.name], `${at}.${f.name}`)) ok = false;
        }
        return ok;
      }
      case "union": {
        const before = problems.length;
        for (const m of t.of) {
          const mark = problems.length;
          if (walk(m, v, at)) { problems.length = before; return true; }
          problems.length = mark;
        }
        problems.length = before;
        problems.push(`${at}: esperava ${printType(t)}, mas é ${kind(v)} (${show(v)})`);
        return false;
      }
    }
  };
  walk(t, v, path);
  return problems;
}
