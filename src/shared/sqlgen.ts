/**
 * Modo sql: do quadro para o SQL (`generateSql`) e do SQL para o quadro (`parseSql` + `sqlToOps`).
 *
 * O parser cobre o SELECT do dia a dia — WITH (CTEs), DISTINCT, FROM com joins (inner, left, right, full, cross,
 * vírgula), subconsultas no FROM, WHERE, GROUP BY, HAVING, ORDER BY, LIMIT/OFFSET, TOP e FETCH FIRST — e recusa com
 * uma mensagem clara o que o quadro não representa (UNION, INSERT…). As expressões (condições, colunas) não são
 * interpretadas: viajam como texto, normalizadas, e o gerador as devolve iguais.
 *
 * Só depende de `schema.ts` (o tipo `Op` é só tipo). Determinístico.
 */
import type { Op } from "./ops";
import { SQL_JOIN_TYPES, SQL_SOURCE_ROLES, type Doc, type NodeEl, type SqlJoinType, type SqlNodeSpec } from "./schema";

/* ───────────────────────── quadro → SQL ───────────────────────── */

/** Caminho até um Resultado: a fonte (a tabela do FROM) e as etapas, na ordem das setas flow. */
export function sqlPipeline(doc: Doc, resultId: string): { source?: NodeEl; steps: NodeEl[] } {
  const steps: NodeEl[] = [];
  const seen = new Set<string>([resultId]);
  let cur = resultId;
  for (;;) {
    const c = doc.connections.find((x) => x.to === cur && x.sql?.rel === "flow" && !seen.has(x.from));
    const prev = c && doc.nodes.find((n) => n.id === c.from && n.sql);
    if (!prev) return { steps };
    if (SQL_SOURCE_ROLES.includes(prev.sql!.role)) return { source: prev, steps };
    steps.unshift(prev);
    seen.add(prev.id);
    cur = prev.id;
  }
}

const indent = (text: string, pad = "  ") => text.split("\n").map((l) => (l.trim() ? pad + l : l)).join("\n");
const flip: Record<SqlJoinType, SqlJoinType> = { inner: "inner", left: "right", right: "left", full: "full", cross: "cross" };

/** Fontes ligadas à do FROM por joins, na ordem em que entram (busca em largura pela ordem das setas). */
function joinPlan(doc: Doc, sourceId: string) {
  const joins = doc.connections.filter((c) => c.sql?.rel === "join");
  const order: { node: NodeEl; type: SqlJoinType; on: string[] }[] = [];
  const at = new Map<string, number>([[sourceId, -1]]);
  const used = new Set<string>();
  for (let progress = true; progress; ) {
    progress = false;
    for (const c of joins) {
      if (used.has(c.id)) continue;
      const fromIn = at.has(c.from);
      const toIn = at.has(c.to);
      if (!fromIn && !toIn) continue;
      used.add(c.id);
      progress = true;
      const on = c.sql!.on?.trim();
      if (fromIn && toIn) {
        // ciclo: a condição soma no ON da fonte que entrou por último
        const k = Math.max(at.get(c.from)!, at.get(c.to)!);
        if (k >= 0 && on) order[k].on.push(on);
        continue;
      }
      const other = doc.nodes.find((n) => n.id === (fromIn ? c.to : c.from) && n.sql);
      if (!other) continue;
      const type = c.sql!.join ?? "inner";
      at.set(other.id, order.length);
      order.push({ node: other, type: fromIn ? type : flip[type], on: on ? [on] : [] });
    }
  }
  return order;
}

/** Uma consulta (a do Resultado `resultId`), formatada uma cláusula por linha. */
export function generateQuery(doc: Doc, resultId: string): string {
  const result = doc.nodes.find((n) => n.id === resultId && n.sql?.role === "result");
  if (!result) return "";
  const { source, steps } = sqlPipeline(doc, resultId);
  const ctes: { name: string; text: string }[] = [];
  const ref = (n: NodeEl) => {
    const s = n.sql!;
    if (s.role === "table") return `${s.table?.trim() || n.label}${s.alias?.trim() && s.alias.trim() !== s.table?.trim() ? ` ${s.alias.trim()}` : ""}`;
    const alias = s.alias?.trim() || n.id.replace(/\W+/g, "_");
    if (s.cte) {
      const name = s.name?.trim() || alias;
      // a mesma CTE usada duas vezes (dois nós, apelidos diferentes) é definida uma vez só
      if (!ctes.some((c) => c.name.toLowerCase() === name.toLowerCase())) ctes.push({ name, text: `${name} AS (\n${indent((s.query ?? "").trim())}\n)` });
      return name === alias ? name : `${name} ${alias}`;
    }
    return `(\n${indent((s.query ?? "").trim())}\n) ${alias}`;
  };
  const L: string[] = [];
  const r = result.sql!;
  const cols = (r.columns ?? []).map((c) => c.trim()).filter(Boolean);
  const head = `SELECT${r.distinct ? " DISTINCT" : ""}`;
  L.push(cols.length > 1 ? `${head}\n${cols.map((c) => `  ${c}`).join(",\n")}` : `${head} ${cols[0] ?? "*"}`);
  if (source) {
    L.push(`FROM ${ref(source)}`);
    for (const j of joinPlan(doc, source.id)) {
      const kw = SQL_JOIN_TYPES[j.type].keyword;
      const using = j.on.length === 1 && /^using\b/i.test(j.on[0]);
      const cond = j.type === "cross" || !j.on.length ? "" : using ? ` ${j.on[0]}` : ` ON ${j.on.length > 1 ? j.on.map((x) => `(${x})`).join(" AND ") : j.on[0]}`;
      L.push(`${kw} ${ref(j.node)}${cond}`);
    }
  }
  const of = (role: SqlNodeSpec["role"]) => steps.filter((s) => s.sql!.role === role).map((s) => s.sql!);
  const where = of("filter").map((f) => f.condition?.trim()).filter(Boolean) as string[];
  if (where.length) L.push(`WHERE ${where.length > 1 ? where.map((w) => (/\bor\b/i.test(w) ? `(${w})` : w)).join("\n  AND ") : where[0]}`);
  const aggs = of("aggregate");
  const group = aggs.flatMap((a) => a.groupBy ?? []).map((g) => g.trim()).filter(Boolean);
  if (group.length) L.push(`GROUP BY ${group.join(", ")}`);
  const having = aggs.map((a) => a.having?.trim()).filter(Boolean) as string[];
  if (having.length) L.push(`HAVING ${having.join(" AND ")}`);
  const sorts = of("sort");
  const order = sorts.flatMap((s) => s.orderBy ?? []).map((o) => o.trim()).filter(Boolean);
  if (order.length) L.push(`ORDER BY ${order.join(", ")}`);
  const limit = [...sorts].reverse().find((s) => s.limit != null)?.limit;
  const offset = [...sorts].reverse().find((s) => s.offset)?.offset;
  if (limit != null) L.push(`LIMIT ${limit}`);
  if (offset) L.push(`OFFSET ${offset}`);
  return (ctes.length ? `WITH ${ctes.map((c) => c.text).join(",\n")}\n` : "") + L.join("\n") + ";";
}

/** O SQL do quadro: uma consulta por Resultado, na ordem do diagrama. Vazio sem Resultado. */
export function generateSql(doc: Doc): string {
  return doc.nodes
    .filter((n) => n.sql?.role === "result")
    .map((n) => generateQuery(doc, n.id))
    .filter(Boolean)
    .join("\n\n");
}

/* ───────────────────────── SQL → quadro ───────────────────────── */

type Tok = { t: "word" | "qid" | "str" | "num" | "punct"; v: string };

export class SqlParseError extends Error {}

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (c === "-" && src[i + 1] === "-") {
      while (i < n && src[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      const end = src.indexOf("*/", i + 2);
      i = end < 0 ? n : end + 2;
      continue;
    }
    if (c === "'") {
      let j = i + 1;
      for (; j < n; j++) if (src[j] === "'") { if (src[j + 1] === "'") j++; else break; }
      if (j >= n) throw new SqlParseError("texto entre aspas simples sem fechar");
      out.push({ t: "str", v: src.slice(i, j + 1) });
      i = j + 1;
      continue;
    }
    if (c === '"' || c === "`" || c === "[") {
      const close = c === "[" ? "]" : c;
      const j = src.indexOf(close, i + 1);
      if (j < 0) throw new SqlParseError(`identificador com ${c} sem fechar`);
      out.push({ t: "qid", v: src.slice(i, j + 1) });
      i = j + 1;
      continue;
    }
    if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(src[i + 1] ?? ""))) {
      const m = /^[0-9]*\.?[0-9]+(?:e[+-]?[0-9]+)?/i.exec(src.slice(i))!;
      out.push({ t: "num", v: m[0] });
      i += m[0].length;
      continue;
    }
    if (/[A-Za-z_À-ɏ@#$]/.test(c)) {
      const m = /^[A-Za-z_À-ɏ@#$][\wÀ-ɏ$#]*/.exec(src.slice(i))!;
      out.push({ t: "word", v: m[0] });
      i += m[0].length;
      continue;
    }
    const two = src.slice(i, i + 2);
    if (["<=", ">=", "<>", "!=", "||", "::", "->"].includes(two)) {
      out.push({ t: "punct", v: two });
      i += 2;
      continue;
    }
    out.push({ t: "punct", v: c });
    i++;
  }
  return out;
}

const KW_UPPER = new Set("select distinct all from where group by having order limit offset fetch first next rows row only top as on using join inner left right full outer cross natural and or not in is null like ilike between exists case when then else end asc desc nulls last with recursive union intersect except over partition true false".split(" "));
/** Palavras depois das quais um "(" leva espaço (não é chamada de função). */
const SPACE_PAREN = new Set("in exists as on and or not using when then else select from where join over values any all some".split(" "));
/** Palavras que não podem ser apelido de uma fonte (encerram o item do FROM). */
const NOT_ALIAS = new Set("where group having order limit offset fetch join inner left right full cross natural on using union intersect except window for".split(" "));

const lower = (t: Tok | undefined) => (t?.t === "word" ? t.v.toLowerCase() : "");

/** Junta os tokens em texto normalizado: palavras-chave em maiúsculas, um espaço entre tokens, sem espaço antes de vírgula. */
function render(toks: Tok[]): string {
  let s = "";
  toks.forEach((t, k) => {
    const prev = toks[k - 1];
    const v = t.t === "word" && KW_UPPER.has(t.v.toLowerCase()) ? t.v.toUpperCase() : t.v;
    const tight = !prev || [",", ")", ".", "::", "]", ";"].includes(t.v) || ["(", ".", "::", "["].includes(prev.v) || (t.v === "(" && (prev.t === "word" || prev.t === "qid") && !SPACE_PAREN.has(prev.v.toLowerCase()));
    s += (tight ? "" : " ") + v;
  });
  return s;
}

/** Índice do ")" que fecha o "(" em `open`. */
function closing(toks: Tok[], open: number): number {
  let d = 0;
  for (let k = open; k < toks.length; k++) {
    if (toks[k].v === "(") d++;
    else if (toks[k].v === ")" && --d === 0) return k;
  }
  throw new SqlParseError("parêntese sem fechar");
}

/** Divide [a, b) nas vírgulas de nível 0. */
function splitCommas(toks: Tok[], a: number, b: number): Tok[][] {
  const parts: Tok[][] = [];
  let cur: Tok[] = [];
  let d = 0;
  for (let k = a; k < b; k++) {
    const t = toks[k];
    if (t.v === "(") d++;
    if (t.v === ")") d--;
    if (t.v === "," && d === 0) {
      parts.push(cur);
      cur = [];
    } else cur.push(t);
  }
  if (cur.length) parts.push(cur);
  return parts;
}

export interface ParsedSource {
  kind: "table" | "subquery";
  /** table: nome (com schema); subquery: undefined */
  table?: string;
  /** CTE usada com outro apelido: o nome no WITH */
  name?: string;
  alias?: string;
  query?: string;
  cte?: boolean;
  columns: string[];
}
export interface ParsedJoin {
  /** índice da fonte (em `sources`) que entra por este join */
  source: number;
  type: SqlJoinType;
  on?: string;
}
export interface ParsedQuery {
  ctes: ParsedSource[];
  sources: ParsedSource[];
  joins: ParsedJoin[];
  distinct: boolean;
  columns: string[];
  where?: string;
  groupBy: string[];
  having?: string;
  orderBy: string[];
  limit?: number;
  offset?: number;
  warnings: string[];
}

/** Nome de saída de uma expressão do SELECT («SUM(x) AS total» → total; «p.nome» → nome). */
export function outputName(expr: string): string {
  const as = /\s+AS\s+("[^"]+"|`[^`]+`|\[[^\]]+\]|[\wÀ-ɏ$]+)\s*$/i.exec(expr);
  if (as) return as[1];
  const q = /(?:^|\.)("[^"]+"|`[^`]+`|[\wÀ-ɏ$]+)$/.exec(expr.trim());
  return q && /^[\w."`À-ɏ$]+$/.test(expr.trim()) ? q[1] : expr.trim();
}

/** Lê UMA consulta SELECT. Lança `SqlParseError` com uma mensagem para o usuário quando não dá. */
export function parseSql(src: string): ParsedQuery {
  const all = tokenize(src);
  while (all.length && all[all.length - 1].v === ";") all.pop();
  if (!all.length) throw new SqlParseError("a consulta está vazia");
  if (all.some((t) => t.v === ";")) throw new SqlParseError("há mais de uma instrução (;) — cole uma consulta por vez");
  const toks = all;
  const q: ParsedQuery = { ctes: [], sources: [], joins: [], distinct: false, columns: [], groupBy: [], orderBy: [], warnings: [] };
  let i = 0;
  const is = (k: number, ...words: string[]) => words.every((w, d) => lower(toks[k + d]) === w);
  const expect = (word: string) => {
    if (!is(i, word)) throw new SqlParseError(`esperava ${word.toUpperCase()}${toks[i] ? ` e veio «${toks[i].v}»` : " e a consulta acabou"}`);
    i++;
  };

  if (is(i, "with")) {
    i++;
    if (is(i, "recursive")) i++, q.warnings.push("WITH RECURSIVE: a CTE recursiva vira uma subconsulta com o texto original");
    for (;;) {
      const name = toks[i];
      if (!name || (name.t !== "word" && name.t !== "qid")) throw new SqlParseError("esperava o nome da CTE depois de WITH");
      i++;
      if (toks[i]?.v === "(") i = closing(toks, i) + 1; // lista de colunas da CTE
      expect("as");
      if (is(i, "materialized") || is(i, "not", "materialized")) i += is(i, "not") ? 2 : 1;
      if (toks[i]?.v !== "(") throw new SqlParseError(`esperava "(" depois de ${name.v} AS`);
      const end = closing(toks, i);
      const body = toks.slice(i + 1, end);
      q.ctes.push({ kind: "subquery", alias: name.v, query: renderQuery(body), cte: true, columns: innerColumns(body) });
      i = end + 1;
      if (toks[i]?.v === ",") i++;
      else break;
    }
  }
  if (!is(i, "select")) {
    const first = lower(toks[i]) || toks[i]?.v;
    throw new SqlParseError(["insert", "update", "delete", "create", "alter", "drop", "merge"].includes(first) ? `${first.toUpperCase()} não é uma consulta: o modo SQL diagrama SELECTs` : `a consulta precisa começar com SELECT (ou WITH); começa com «${toks[i]?.v}»`);
  }
  i++;
  if (is(i, "distinct")) i++, (q.distinct = true);
  else if (is(i, "all")) i++;
  if (is(i, "distinct", "on")) throw new SqlParseError("DISTINCT ON ainda não é suportado");
  if (is(i, "top")) {
    i++;
    const paren = toks[i]?.v === "(";
    const n = toks[i + (paren ? 1 : 0)];
    if (n?.t !== "num") throw new SqlParseError("TOP precisa de um número");
    q.limit = Number(n.v);
    i += paren ? 3 : 1;
  }

  // limites das cláusulas no nível 0
  const at: Record<string, number> = {};
  let d = 0;
  for (let k = i; k < toks.length; k++) {
    const t = toks[k];
    if (t.v === "(") d++;
    if (t.v === ")") d--;
    if (d !== 0) continue;
    const w = lower(t);
    if (["union", "intersect", "except"].includes(w)) throw new SqlParseError(`${w.toUpperCase()} ainda não é suportado: diagrame cada SELECT num quadro`);
    const key = w === "group" && is(k + 1, "by") ? "group" : w === "order" && is(k + 1, "by") ? "order" : ["from", "where", "having", "limit", "offset", "fetch", "window"].includes(w) ? w : "";
    if (key && at[key] === undefined) at[key] = k;
  }
  const bounds = Object.values(at).sort((a, b) => a - b);
  const endOf = (k: number) => bounds.find((b) => b > k) ?? toks.length;
  const selEnd = bounds[0] ?? toks.length;
  q.columns = splitCommas(toks, i, selEnd).map(render);
  if (!q.columns.length) throw new SqlParseError("SELECT sem colunas");
  if (at.window !== undefined) q.warnings.push("WINDOW: a cláusula foi ignorada (as funções de janela nas colunas ficam)");

  if (at.from !== undefined) parseFrom(toks, at.from + 1, endOf(at.from), q);
  if (at.where !== undefined) q.where = render(toks.slice(at.where + 1, endOf(at.where)));
  if (at.group !== undefined) q.groupBy = splitCommas(toks, at.group + 2, endOf(at.group)).map(render);
  if (at.having !== undefined) q.having = render(toks.slice(at.having + 1, endOf(at.having)));
  if (at.order !== undefined) q.orderBy = splitCommas(toks, at.order + 2, endOf(at.order)).map(render);
  const num = (t: Tok | undefined, what: string) => {
    if (t?.t !== "num") throw new SqlParseError(`${what} precisa de um número (parâmetros como ? ou :n não viram diagrama)`);
    return Number(t.v);
  };
  if (at.limit !== undefined) {
    const k = at.limit + 1;
    if (!is(k, "all")) {
      // MySQL: LIMIT deslocamento, quantidade
      if (toks[k + 1]?.v === ",") (q.offset = num(toks[k], "LIMIT")), (q.limit = num(toks[k + 2], "LIMIT"));
      else q.limit = num(toks[k], "LIMIT");
    }
  }
  if (at.offset !== undefined) q.offset = num(toks[at.offset + 1], "OFFSET");
  if (at.fetch !== undefined) q.limit = num(toks[at.fetch + 2], "FETCH FIRST");
  if (q.offset === 0) delete q.offset;

  fillColumns(toks, q);
  return q;
}

/** Texto de uma consulta interna, uma cláusula por linha (é o que aparece no cartão e volta no SQL gerado). */
function renderQuery(body: Tok[]): string {
  const text = render(body);
  return text.replace(/\s+(FROM|WHERE|GROUP BY|HAVING|ORDER BY|LIMIT|OFFSET|(?:INNER |LEFT |RIGHT |FULL OUTER |FULL |CROSS )?JOIN)\b/g, "\n$1");
}

/** Colunas de saída de uma consulta interna (para o cartão da CTE); vazio se não der para ler. */
function innerColumns(body: Tok[]): string[] {
  try {
    return parseSql(body.map((t) => t.v).join(" ")).columns.map(outputName).filter((c) => c !== "*");
  } catch {
    return [];
  }
}

function parseFrom(toks: Tok[], a: number, b: number, q: ParsedQuery) {
  let k = a;
  const is = (x: number, ...words: string[]) => words.every((w, d) => lower(toks[x + d]) === w);
  const item = (): ParsedSource => {
    if (is(k, "lateral")) throw new SqlParseError("LATERAL ainda não é suportado");
    if (toks[k]?.v === "(") {
      const end = closing(toks, k);
      const inner = toks.slice(k + 1, end);
      if (!is(k + 1, "select") && !is(k + 1, "with")) throw new SqlParseError("joins entre parênteses no FROM ainda não são suportados");
      k = end + 1;
      const alias = aliasAt();
      if (!alias) throw new SqlParseError("subconsulta no FROM sem apelido");
      return { kind: "subquery", alias, query: renderQuery(inner), columns: innerColumns(inner) };
    }
    const parts: string[] = [];
    for (;;) {
      const t = toks[k];
      if (!t || (t.t !== "word" && t.t !== "qid")) throw new SqlParseError(`esperava o nome de uma tabela no FROM${t ? ` e veio «${t.v}»` : ""}`);
      parts.push(t.v);
      k++;
      if (toks[k]?.v === ".") k++;
      else break;
    }
    if (toks[k]?.v === "(") throw new SqlParseError(`função de tabela no FROM (${parts.join(".")}(…)) ainda não é suportada`);
    const table = parts.join(".");
    const cte = q.ctes.find((c) => c.alias?.toLowerCase() === table.toLowerCase());
    const alias = aliasAt();
    if (cte) return alias && alias.toLowerCase() !== cte.alias!.toLowerCase() ? { ...cte, columns: [...cte.columns], name: cte.alias, alias } : cte;
    return { kind: "table", table, alias, columns: [] };
  };
  const aliasAt = (): string | undefined => {
    if (is(k, "as")) k++;
    const t = toks[k];
    if (t && (t.t === "qid" || (t.t === "word" && !NOT_ALIAS.has(t.v.toLowerCase())))) {
      k++;
      if (toks[k]?.v === "(") k = closing(toks, k) + 1; // apelido com lista de colunas
      return t.v;
    }
    return undefined;
  };
  const push = (s: ParsedSource) => {
    const idx = q.sources.indexOf(s);
    if (idx >= 0) {
      // a mesma CTE usada duas vezes: a segunda entrada vira uma cópia própria (o quadro tem um nó por uso)
      const copy = { ...s, columns: [...s.columns] };
      q.sources.push(copy);
      return q.sources.length - 1;
    }
    q.sources.push(s);
    return q.sources.length - 1;
  };
  /** Início de um join em k: devolve o tipo e quantos tokens a palavra-chave ocupa. */
  const joinAt = (x: number): { type: SqlJoinType; len: number; natural: boolean } | undefined => {
    let n = 0;
    let natural = false;
    if (is(x, "natural")) (natural = true), n++;
    const w = lower(toks[x + n]);
    const outer = is(x + n + 1, "outer") ? 1 : 0;
    if (w === "join") return { type: "inner", len: n + 1, natural };
    if (w === "inner" && is(x + n + 1, "join")) return { type: "inner", len: n + 2, natural };
    if (w === "cross" && is(x + n + 1, "join")) return { type: "cross", len: n + 2, natural };
    if ((w === "left" || w === "right" || w === "full") && is(x + n + 1 + outer, "join")) return { type: w, len: n + 2 + outer, natural };
    return undefined;
  };
  push(item());
  while (k < b) {
    if (toks[k].v === ",") {
      k++;
      const idx = push(item());
      q.joins.push({ source: idx, type: "cross" });
      continue;
    }
    const j = joinAt(k);
    if (!j) throw new SqlParseError(`não entendi «${render(toks.slice(k, Math.min(b, k + 4)))}» no FROM`);
    k += j.len;
    const idx = push(item());
    let on: string | undefined;
    if (is(k, "on") || is(k, "using")) {
      const using = is(k, "using");
      const start = k + (using ? 0 : 1);
      let d = 0;
      let e = start;
      for (; e < b; e++) {
        if (toks[e].v === "(") d++;
        if (toks[e].v === ")") d--;
        if (d === 0 && (toks[e].v === "," || joinAt(e))) break;
      }
      on = render(toks.slice(start, e));
      k = e;
    }
    if (j.natural) q.warnings.push("NATURAL JOIN: a condição implícita (colunas de mesmo nome) não aparece no quadro; escreva o ON");
    q.joins.push({ source: idx, type: j.type, ...(on ? { on } : {}) });
  }
}

/** Colunas que a consulta usa de cada fonte: «p.total» vai para a fonte de apelido p; sem apelido e com uma fonte só, as colunas simples do SELECT vão para ela. */
function fillColumns(toks: Tok[], q: ParsedQuery) {
  const byName = new Map<string, ParsedSource>();
  for (const s of q.sources) {
    if (s.alias) byName.set(s.alias.toLowerCase(), s);
    if (s.table) {
      byName.set(s.table.toLowerCase(), s);
      byName.set(s.table.split(".").pop()!.toLowerCase(), s);
    }
  }
  const add = (s: ParsedSource, col: string) => !s.columns.some((c) => c.toLowerCase() === col.toLowerCase()) && s.columns.push(col);
  for (let k = 0; k + 2 < toks.length; k++) {
    const a = toks[k];
    if ((a.t !== "word" && a.t !== "qid") || toks[k + 1].v !== "." || toks[k - 1]?.v === ".") continue;
    const col = toks[k + 2];
    if (col.t !== "word" && col.t !== "qid") continue;
    if (toks[k + 3]?.v === ".") continue; // schema.tabela.coluna: o qualificador é a tabela
    if (toks[k + 3]?.v === "(") continue; // schema.funcao(...)
    const s = byName.get(a.v.toLowerCase());
    if (s) add(s, col.v);
  }
  if (q.sources.length === 1 && q.sources[0].kind === "table") {
    for (const expr of [...q.columns, ...q.groupBy]) {
      const base = expr.replace(/\s+AS\s+\S+$/i, "").trim();
      if (/^[A-Za-z_À-ɏ][\wÀ-ɏ$]*$/.test(base) && !KW_UPPER.has(base.toLowerCase())) add(q.sources[0], base);
    }
  }
}

/* ───────────────────────── consulta → ops ───────────────────────── */

const slug = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/["`[\]]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "fonte";

/**
 * Ops que montam o quadro de uma consulta: um nó por fonte (CTEs usadas no FROM entram como subconsulta), as setas join
 * e o fluxo FROM → WHERE → GROUP BY → ORDER BY → SELECT, e um layout no fim. `taken` são ids já usados no diagrama.
 */
export function sqlToOps(src: string, taken: Iterable<string> = []): { ops: Op[]; warnings: string[]; query: ParsedQuery } {
  const q = parseSql(src);
  const used = new Set(taken);
  const id = (base: string) => {
    let s = slug(base);
    for (let k = 2; used.has(s); k++) s = `${slug(base)}-${k}`;
    used.add(s);
    return s;
  };
  const ops: Op[] = [];
  const ids = q.sources.map((s) => {
    const nid = id(s.kind === "table" ? (s.alias && q.sources.filter((x) => x.table === s.table).length > 1 ? `${s.table}-${s.alias}` : s.table!.split(".").pop()!) : (s.name ?? s.alias)!);
    const sql: SqlNodeSpec =
      s.kind === "table"
        ? { role: "table", table: s.table, ...(s.alias ? { alias: s.alias } : {}), ...(s.columns.length ? { columns: s.columns } : {}) }
        : { role: "subquery", alias: s.alias, query: s.query, ...(s.cte ? { cte: true } : {}), ...(s.name ? { name: s.name } : {}), ...(s.columns.length ? { columns: s.columns } : {}) };
    ops.push({ op: "add_node", id: nid, kind: "sql", label: s.kind === "table" ? s.table!.split(".").pop()! : (s.name ?? s.alias)!, sql });
    return nid;
  });
  // as setas join partem da fonte anterior que a condição cita (ou da primeira): «p.cliente_id = c.id» liga c ← p
  q.joins.forEach((j) => {
    const cited = q.sources.slice(0, j.source).map((s, k) => ({ s, k })).reverse().find(({ s }) => {
      const names = [s.alias, s.table, s.table?.split(".").pop()].filter(Boolean).map((x) => x!.toLowerCase());
      return j.on && names.some((n) => new RegExp(`(^|[^\\w.])${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\.`, "i").test(j.on!));
    });
    const from = ids[cited?.k ?? 0];
    ops.push({ op: "add_connection", from, to: ids[j.source], sql: { rel: "join", ...(j.type !== "inner" ? { join: j.type } : {}), ...(j.on ? { on: j.on } : {}) } });
  });
  const chain: string[] = ids.length ? [ids[0]] : [];
  const step = (label: string, sql: SqlNodeSpec) => {
    const nid = id(label);
    ops.push({ op: "add_node", id: nid, kind: "sql", label, sql });
    chain.push(nid);
  };
  if (q.where) step("Filtro", { role: "filter", condition: q.where });
  if (q.groupBy.length || q.having) step("Agrupamento", { role: "aggregate", ...(q.groupBy.length ? { groupBy: q.groupBy } : {}), ...(q.having ? { having: q.having } : {}) });
  if (q.orderBy.length || q.limit != null || q.offset) step("Ordenação", { role: "sort", ...(q.orderBy.length ? { orderBy: q.orderBy } : {}), ...(q.limit != null ? { limit: q.limit } : {}), ...(q.offset ? { offset: q.offset } : {}) });
  const cols = q.columns.filter((c) => c !== "*");
  step("Resultado", { role: "result", ...(cols.length ? { columns: cols } : {}), ...(q.distinct ? { distinct: true } : {}) });
  for (let k = 1; k < chain.length; k++) ops.push({ op: "add_connection", from: chain[k - 1], to: chain[k], sql: { rel: "flow" } });
  ops.push({ op: "layout", direction: "LR" });
  const unused = q.ctes.filter((c) => !q.sources.some((s) => s === c || (s.cte && s.name === c.alias)));
  if (unused.length) q.warnings.push(`CTE sem uso no FROM: ${unused.map((c) => c.alias).join(", ")} (ficou de fora do quadro)`);
  return { ops, warnings: q.warnings, query: q };
}
