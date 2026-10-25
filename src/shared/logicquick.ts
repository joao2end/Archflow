/**
 * Atalhos para montar um diagrama Logic à mão: em vez de ir à biblioteca, criar um Input/Output, renomear e tipar,
 * o campo onde se digitou o nome oferece «Criar dado» já com o papel e o tipo certos.
 *
 * Papel: o nome escrito (`frete := 0`) vira Output; o nome só lido (`total >= 200`) vira Input.
 * Tipo: só quando há certeza (o valor atribuído, ou a comparação/conta com um valor de tipo conhecido); senão fica sem tipo.
 */
import { dataNodes, dataTypeOf, isFlowNode, nameProblems } from "./logic";
import { parseExpr, parseStatement, readsOf, type Expr } from "./expr";
import { inferType } from "./typecheck";
import { printType, recognize, type Type } from "./types";
import type { Op } from "./ops";
import type { Doc } from "./schema";

export interface MissingData {
  name: string;
  role: "input" | "output";
  /** tipo do TypeScript, quando dá para saber pelo texto */
  type?: string;
  /** nome parecido que já existe (provável erro de digitação) */
  suggestion?: string;
}

/** `0` → `number`, `"VIP"` → `string`: o tipo largo de um literal (o dado vai receber outros valores). */
const widen = (t: Type | undefined): string | undefined => {
  if (!t) return undefined;
  if (t.k === "lit") return typeof t.v === "number" ? "number" : typeof t.v === "string" ? "string" : typeof t.v === "boolean" ? "boolean" : undefined;
  const s = printType(t);
  return s === "null" || s === "any" ? undefined : s;
};

/** O tipo que `name` deve ter pelo jeito que a expressão o usa (`total >= 200` → number; `vip e …` → boolean). */
export function guessReadType(e: Expr, name: string, typeOf: (n: string) => Type | undefined): string | undefined {
  const isName = (x: Expr) => x.t === "id" && x.name === name;
  switch (e.t) {
    case "un":
      if (isName(e.x)) return e.op === "nao" ? "boolean" : "number";
      return guessReadType(e.x, name, typeOf);
    case "bin": {
      if (e.op === "e" || e.op === "ou") {
        if (isName(e.l) || isName(e.r)) return "boolean";
      } else if (["-", "*", "/", "%"].includes(e.op) && (isName(e.l) || isName(e.r))) return "number";
      else if (["<", "<=", ">", ">=", "=", "!=", "+"].includes(e.op)) {
        const other = isName(e.l) ? e.r : isName(e.r) ? e.l : undefined;
        if (other) return widen(inferType(other, typeOf));
      } else if ((e.op === "em" || e.op === "nao-em") && isName(e.r) && e.l.t !== "id") {
        const t = widen(inferType(e.l, typeOf));
        return t ? `${t}[]` : undefined;
      }
      return guessReadType(e.l, name, typeOf) ?? guessReadType(e.r, name, typeOf);
    }
    case "if":
      if (isName(e.c)) return "boolean";
      return guessReadType(e.c, name, typeOf) ?? guessReadType(e.a, name, typeOf) ?? guessReadType(e.b, name, typeOf);
    case "call":
      for (const a of e.args) {
        const t = guessReadType(a, name, typeOf);
        if (t) return t;
      }
      return undefined;
    case "list":
      for (const a of e.items) {
        const t = guessReadType(a, name, typeOf);
        if (t) return t;
      }
      return undefined;
    case "idx":
      return guessReadType(e.x, name, typeOf) ?? guessReadType(e.i, name, typeOf);
    case "field":
      return guessReadType(e.x, name, typeOf);
    default:
      return undefined;
  }
}

/**
 * Dados que o texto usa e que o diagrama não declara, cada um com o papel e o tipo prováveis.
 * `kind` = "expr" (condição, lista, parada…) ou "statement" (um efeito por linha).
 * Texto com erro de sintaxe devolve [] (quem avisa é o outro aviso).
 */
export function missingData(doc: Doc, src: string, kind: "expr" | "statement"): MissingData[] {
  const declaredType = dataTypeOf(doc);
  const declared = new Set(dataNodes(doc).map((n) => n.logic!.key ?? n.id.replace(/-/g, "_")));
  const exprs: Expr[] = [];
  const assigns: { name: string; value: Expr }[] = [];
  try {
    for (const line of kind === "statement" ? src.split(/\r?\n/) : [src]) {
      const t = line.trim();
      if (!t) continue;
      if (kind === "expr") exprs.push(parseExpr(t));
      else {
        const st = parseStatement(t);
        if (st.t !== "assign") continue;
        exprs.push(st.value);
        if (!declared.has(st.name)) assigns.push(st);
      }
    }
  } catch {
    return [];
  }
  // 1º os lidos (o tipo vem do uso), depois os escritos (o tipo vem do valor, já contando com o tipo adivinhado dos lidos)
  const reads = new Set<string>();
  for (const e of exprs) readsOf(e, reads);
  const written = new Set(assigns.map((a) => a.name));
  const inputs: MissingData[] = [];
  for (const p of nameProblems(doc, reads)) {
    if (written.has(p.name) || p.name.includes(".")) continue; // `pedido.total` pede um objeto: melhor declarar `pedido` à mão
    let type: string | undefined;
    for (const e of exprs) if ((type = guessReadType(e, p.name, declaredType))) break;
    inputs.push({ name: p.name, role: "input", ...(type ? { type } : {}), ...(p.suggestion ? { suggestion: p.suggestion } : {}) });
  }
  const guessed = new Map(inputs.filter((m) => m.type).map((m) => [m.name, recognize(m.type)]));
  const typeOf = (n: string): Type | undefined => {
    const g = guessed.get(n);
    return declaredType(n) ?? (g?.ok ? g.type : undefined);
  };
  const out = new Map<string, MissingData>();
  for (const a of assigns) if (!out.has(a.name)) out.set(a.name, { name: a.name, role: "output", ...(widen(inferType(a.value, typeOf)) ? { type: widen(inferType(a.value, typeOf)) } : {}) }); // escrito e não declarado: é o resultado do fluxo
  for (const m of inputs) out.set(m.name, m);
  return [...out.values()];
}

/** Onde o dado novo nasce: embaixo do último dado; sem dados, à esquerda do fluxo. */
export function dataSpot(doc: Doc): { x: number; y: number } {
  const data = dataNodes(doc);
  if (data.length) {
    const last = data.reduce((a, b) => (b.y + b.h > a.y + a.h ? b : a));
    return { x: last.x, y: Math.round((last.y + last.h + 16) / 8) * 8 };
  }
  const flow = doc.nodes.filter(isFlowNode);
  if (!flow.length) return { x: 0, y: 0 };
  const x = Math.min(...flow.map((n) => n.x));
  const y = Math.min(...flow.map((n) => n.y));
  return { x: Math.round((x - 280) / 8) * 8, y: Math.round(y / 8) * 8 };
}

/** A operação que declara o dado (nome = key = rótulo). */
export function declareDataOp(doc: Doc, m: { name: string; role: "input" | "output" | "variable"; type?: string }): Op {
  const { x, y } = dataSpot(doc);
  return { op: "add_node", label: m.name, x, y, logic: { role: m.role, key: m.name, ...(m.type ? { type: m.type } : {}) } };
}
