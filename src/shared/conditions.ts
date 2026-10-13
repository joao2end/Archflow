/**
 * Condições como linhas, no estilo dos filtros do n8n: dado | operador | valor, combinadas por um grupo TODAS (e) ou QUALQUER (ou).
 * O texto da expressão continua sendo a fonte da verdade (`when`): aqui só se lê esse texto como linhas e se escreve de volta.
 * Funções puras, sem dependência do app.
 */
import { checkExpr, parseExpr, print, type Expr } from "./expr";

export type CondOp = "verdadeiro" | "falso" | "=" | "!=" | "<" | "<=" | ">" | ">=" | "em" | "nao-em" | "vazio" | "nao-vazio" | "contem" | "nao-contem" | "entre" | "nao-entre";

/** `args`: quantos valores o operador pede à direita. `neg`: o operador que diz o contrário (o NÃO vira operador, como no n8n). */
export const COND_OPS: Record<CondOp, { label: string; short: string; args: 0 | 1 | 2; neg: CondOp }> = {
  // para dado lógico (sim/não): a condição é o próprio dado, sem comparar com nada
  verdadeiro: { label: "é verdadeiro (sim)", short: "é sim", args: 0, neg: "falso" },
  falso: { label: "é falso (não)", short: "é não", args: 0, neg: "verdadeiro" },
  "=": { label: "é igual a", short: "=", args: 1, neg: "!=" },
  "!=": { label: "é diferente de", short: "≠", args: 1, neg: "=" },
  "<": { label: "é menor que", short: "<", args: 1, neg: ">=" },
  "<=": { label: "é menor ou igual a", short: "≤", args: 1, neg: ">" },
  ">": { label: "é maior que", short: ">", args: 1, neg: "<=" },
  ">=": { label: "é maior ou igual a", short: "≥", args: 1, neg: "<" },
  em: { label: "está em (lista)", short: "∈", args: 1, neg: "nao-em" },
  "nao-em": { label: "não está em (lista)", short: "∉", args: 1, neg: "em" },
  vazio: { label: "está vazio", short: "vazio", args: 0, neg: "nao-vazio" },
  "nao-vazio": { label: "não está vazio", short: "tem valor", args: 0, neg: "vazio" },
  contem: { label: "(lista) contém", short: "contém", args: 1, neg: "nao-contem" },
  "nao-contem": { label: "(lista) não contém", short: "não contém", args: 1, neg: "contem" },
  entre: { label: "está entre", short: "entre", args: 2, neg: "nao-entre" },
  "nao-entre": { label: "não está entre", short: "fora de", args: 2, neg: "entre" },
};
export const COND_OP_KEYS = Object.keys(COND_OPS) as CondOp[];

/** Uma condição: `left op right` (os operandos são texto de expressão: um dado, um número, uma conta…). */
export interface Cond {
  k: "cond";
  left: string;
  op: CondOp;
  right?: string;
  /** só em "entre": o limite de cima */
  right2?: string;
}
/** Expressão que não cabe numa linha (ex.: `se … entao … senao …`): fica como texto livre. */
export interface Raw {
  k: "raw";
  text: string;
}
export interface Group {
  k: "group";
  mode: "e" | "ou";
  items: (Cond | Raw | Group)[];
  /** o grupo inteiro é negado: `nao (a ou b)` = «nenhuma delas»; `nao (a e b)` = «nem todas» */
  not?: boolean;
}
export type Item = Cond | Raw | Group;

const CMP = new Set(["=", "!=", "<", "<=", ">", ">=", "em", "nao-em"]);

function leaf(e: Expr): Item {
  if (e.t === "un" && e.op === "nao") {
    const c = leaf(e.x);
    return c.k === "cond" ? { ...c, op: COND_OPS[c.op].neg } : { k: "raw", text: print(e) };
  }
  if (e.t === "bin" && CMP.has(e.op)) return { k: "cond", left: print(e.l), op: e.op as CondOp, right: print(e.r) };
  if (e.t === "id") return { k: "cond", left: e.name, op: "verdadeiro" }; // `cluster_existe` sozinho: «cluster_existe é verdadeiro»
  if (e.t === "call") {
    if (e.fn === "vazio") return { k: "cond", left: print(e.args[0]), op: "vazio" };
    if (e.fn === "contem") return { k: "cond", left: print(e.args[0]), op: "contem", right: print(e.args[1]) };
    if (e.fn === "entre") return { k: "cond", left: print(e.args[0]), op: "entre", right: print(e.args[1]), right2: print(e.args[2]) };
  }
  return { k: "raw", text: print(e) };
}

function node(e: Expr): Item {
  // `nao (a e b)` / `nao (a ou b)`: o grupo negado vira UM grupo com `not` (não uma linha de texto)
  if (e.t === "un" && e.op === "nao" && e.x.t === "bin" && (e.x.op === "e" || e.x.op === "ou")) return { ...(node(e.x) as Group), not: true };
  if (e.t === "bin" && (e.op === "e" || e.op === "ou")) {
    const mode = e.op;
    const items: Item[] = [];
    const walk = (x: Expr): void => {
      if (x.t === "bin" && x.op === mode) (walk(x.l), walk(x.r));
      else items.push(node(x));
    };
    walk(e);
    return { k: "group", mode, items };
  }
  return leaf(e);
}

/** Texto da expressão -> grupo de condições. Vazio dá um grupo vazio; texto inválido dá undefined. */
export function fromText(text: string): Group | undefined {
  if (!text.trim()) return { k: "group", mode: "e", items: [] };
  let e: Expr;
  try {
    e = parseExpr(text);
  } catch {
    return undefined;
  }
  const n = node(e);
  return n.k === "group" ? n : { k: "group", mode: "e", items: [n] };
}

/** Operando entre parênteses quando a precedência exigir (um `ou` ou um `nao` dentro de uma comparação). */
function operand(t: string): string {
  const s = t.trim();
  try {
    const e = parseExpr(s);
    const loose = (e.t === "bin" && (e.op === "e" || e.op === "ou" || CMP.has(e.op))) || e.t === "if" || (e.t === "un" && e.op === "nao");
    return loose ? `(${s})` : s;
  } catch {
    return s;
  }
}

/** Grupo -> texto da expressão (o que vai para `when`). Linhas vazias são ignoradas. */
export function toText(g: Item): string {
  if (g.k === "raw") return g.text.trim();
  if (g.k === "cond") {
    const l = operand(g.left);
    if (!l) return "";
    const a = COND_OPS[g.op].args;
    const r = operand(g.right ?? "");
    switch (g.op) {
      case "verdadeiro": return g.left.trim();
      case "falso": return `nao ${l}`;
      case "vazio": return `vazio(${g.left.trim()})`;
      case "nao-vazio": return `nao vazio(${g.left.trim()})`;
      case "contem": return `contem(${g.left.trim()}, ${(g.right ?? "").trim()})`;
      case "nao-contem": return `nao contem(${g.left.trim()}, ${(g.right ?? "").trim()})`;
      case "entre": return `entre(${g.left.trim()}, ${(g.right ?? "").trim()}, ${(g.right2 ?? "").trim()})`;
      case "nao-entre": return `nao entre(${g.left.trim()}, ${(g.right ?? "").trim()}, ${(g.right2 ?? "").trim()})`;
      case "nao-em": return `${l} nao em ${r}`;
      default: return a && !r ? "" : `${l} ${g.op} ${r}`;
    }
  }
  const parts = g.items
    .map((i) => {
      const t = toText(i);
      if (!t) return "";
      if (i.k === "group") return i.not || i.items.filter((x) => toText(x)).length > 1 ? (i.not ? t : `(${t})`) : t;
      if (i.k === "raw") {
        try {
          const e = parseExpr(t);
          return (e.t === "bin" && (e.op === "e" || e.op === "ou")) || e.t === "if" ? `(${t})` : t;
        } catch {
          return t;
        }
      }
      return t;
    })
    .filter(Boolean);
  const inner = parts.join(g.mode === "e" ? " e " : " ou ");
  return g.not && inner ? `nao (${inner})` : inner;
}

/** Mensagem do primeiro campo inválido ou vazio (undefined = pode salvar). */
export function firstProblem(g: Item): string | undefined {
  if (g.k === "group") {
    for (const i of g.items) {
      const p = firstProblem(i);
      if (p) return p;
    }
    return undefined;
  }
  const bad = (t: string | undefined, what: string) => {
    if (!t?.trim()) return `preencha ${what}`;
    return checkExpr(t)?.message;
  };
  if (g.k === "raw") return bad(g.text, "a expressão");
  const a = COND_OPS[g.op].args;
  return bad(g.left, "o dado") ?? (a >= 1 ? bad(g.right, "o valor") : undefined) ?? (a === 2 ? bad(g.right2, "o limite de cima") : undefined);
}

/* ───────────── aspas automáticas ───────────── */

import { recognize, type Type } from "./types";

const takesText = (t: Type): boolean => (t.k === "prim" ? t.n === "string" : t.k === "lit" ? typeof t.v === "string" : t.k === "union" ? t.of.some(takesText) : false);

const quoteOne = (v: string): string => JSON.stringify(v);

/**
 * Valor digitado ao lado de um dado do tipo texto (`string`, `"a" | "b"`): se é uma palavra solta (que não é outro dado do diagrama),
 * vira texto entre aspas. `VIP` → `"VIP"`, `São Paulo` → `"São Paulo"`. Números, `verdadeiro`, contas e dados do diagrama ficam como estão.
 * Em «está em»: `ouro, prata` → `["ouro", "prata"]`. Sem o tipo do dado, nada muda (não adivinha).
 */
export function autoQuote(raw: string, op: CondOp, leftType: string | undefined, facts: ReadonlySet<string>): string {
  const r = recognize(leftType);
  if (!r || !r.ok || !takesText(r.type)) return raw;
  const one = (s: string): string => {
    const v = s.trim();
    if (!v || v.startsWith('"') || v.startsWith("'")) return v;
    try {
      const e = parseExpr(v);
      return e.t === "id" && !facts.has(e.name) ? quoteOne(v) : v;
    } catch {
      return quoteOne(v); // «São Paulo», «a-b»: não é expressão, é texto
    }
  };
  if (op === "em" || op === "nao-em") {
    const v = raw.trim();
    if (!v || v.startsWith("[")) return raw;
    return `[${v.split(",").map(one).filter(Boolean).join(", ")}]`;
  }
  if (COND_OPS[op].args !== 1 || op === "contem" || op === "nao-contem") return raw;
  return one(raw);
}
