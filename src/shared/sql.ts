/**
 * Modo sql (diagramas de consultas SQL): validação de entrada das ops, regras (S001+), descrição para LLMs, guia do
 * modo e o tamanho dos cartões.
 *
 * Só depende de `schema.ts` e de `sqlgen.ts` (`ops.ts` importa este módulo, nunca o contrário). Determinístico:
 * a mesma entrada produz sempre a mesma saída.
 */
import {
  SCHEMA_VERSION,
  SQL_JOIN_KEYS,
  SQL_JOIN_TYPES,
  SQL_REL_KEYS,
  SQL_REL_PAIRS,
  SQL_RELS,
  SQL_ROLE_KEYS,
  SQL_ROLES,
  SQL_SOURCE_ROLES,
  type ConnectionType,
  type Doc,
  type NodeEl,
  type SqlConnSpec,
  type SqlNodeSpec,
  type SqlRel,
  type SqlRole,
} from "./schema";
import type { Issue } from "./domain";
import { generateSql, sqlPipeline } from "./sqlgen";

/* ───────────────────────── validação de entrada das ops ───────────────────────── */

const TEXT_FIELDS = ["table", "alias", "name", "query", "condition", "having"] as const;
const LIST_FIELDS = ["columns", "groupBy", "orderBy"] as const;

/** Valida o objeto `sql` de um nó. Devolve a mensagem de erro (acionável) ou undefined. */
export function checkSqlNode(sql: unknown): string | undefined {
  if (!sql || typeof sql !== "object") return "sql deve ser um objeto { role, ... }";
  const a = sql as Record<string, unknown>;
  const role = a.role as string;
  if (!SQL_ROLE_KEYS.includes(role as never)) return `sql.role inválido "${role}". Válidos: ${SQL_ROLE_KEYS.join(", ")}`;
  const allowed = new Set<string>(["role", ...SQL_ROLES[role as SqlRole].fields]);
  for (const k of Object.keys(a)) {
    if (a[k] === undefined) continue;
    if (!allowed.has(k)) return `campo "${k}" não existe no papel "${role}". Campos do papel: ${[...allowed].filter((f) => f !== "role").join(", ")}`;
  }
  for (const f of TEXT_FIELDS) if (a[f] !== undefined && typeof a[f] !== "string") return `sql.${f} deve ser texto`;
  for (const f of LIST_FIELDS) {
    if (a[f] !== undefined && (!Array.isArray(a[f]) || (a[f] as unknown[]).some((x) => typeof x !== "string"))) return `sql.${f} deve ser uma lista de textos (uma expressão por item)`;
  }
  for (const f of ["limit", "offset"] as const) {
    if (a[f] !== undefined && (typeof a[f] !== "number" || !Number.isInteger(a[f]) || (a[f] as number) < 0)) return `sql.${f} deve ser um inteiro a partir de 0`;
  }
  for (const f of ["cte", "distinct"] as const) if (a[f] !== undefined && typeof a[f] !== "boolean") return `sql.${f} deve ser true ou false`;
  for (const f of ["alias", "name"] as const) {
    const v = a[f];
    if (typeof v === "string" && v.trim() && !/^[A-Za-z_\u00C0-\u024F][\w$\u00C0-\u024F]*$|^"[^"]+"$|^`[^`]+`$|^\[[^\]]+\]$/.test(v.trim())) return `sql.${f} "${v}" não é um identificador SQL (letras, números e _; ou entre aspas)`;
  }
  if (a.name !== undefined && a.cte !== true) return "sql.name só vale numa subquery com cte: true (é o nome no WITH)";
  return undefined;
}

/** Troca o papel de um nó mantendo só os campos que o novo papel aceita. */
export function reshapeSql(old: SqlNodeSpec | undefined, role: SqlRole): SqlNodeSpec {
  const next: Record<string, unknown> = { role };
  for (const f of SQL_ROLES[role].fields) {
    const v = (old as unknown as Record<string, unknown> | undefined)?.[f];
    if (v !== undefined) next[f] = v;
  }
  return next as unknown as SqlNodeSpec;
}

/** Valida o objeto `sql` (`SqlConnSpec`) de uma conexão. */
export function checkSqlConn(sql: unknown): string | undefined {
  if (!sql || typeof sql !== "object") return "sql deve ser um objeto { rel, join?, on? }";
  const a = sql as Record<string, unknown>;
  for (const k of Object.keys(a)) if (!["rel", "join", "on"].includes(k)) return `conexão do modo sql não tem o campo "${k}". Campos: rel, join, on`;
  if (!SQL_REL_KEYS.includes(a.rel as never)) return `sql.rel inválido "${a.rel}". Válidos: ${SQL_REL_KEYS.join(", ")}`;
  if (a.join !== undefined && !SQL_JOIN_KEYS.includes(a.join as never)) return `sql.join inválido "${a.join}". Válidos: ${SQL_JOIN_KEYS.join(", ")}`;
  if (a.on !== undefined && typeof a.on !== "string") return "sql.on deve ser texto: a condição do ON";
  if ((a.join !== undefined || a.on !== undefined) && a.rel !== "join") return `sql.join e sql.on só valem em rel "join" (esta conexão é ${a.rel})`;
  return undefined;
}

/* ───────────────────────── relações ───────────────────────── */

export function sqlRelEnd(doc: Doc, id: string): SqlRole | undefined {
  return doc.nodes.find((n) => n.id === id)?.sql?.role;
}

export const sqlRelAllows = (rel: SqlRel, from: SqlRole | undefined, to: SqlRole | undefined) =>
  !!from && !!to && SQL_REL_PAIRS[rel].some((p) => p.from.includes(from) && p.to.includes(to));

/** Relações possíveis entre duas peças: fonte → fonte só pode ser join; o resto só pode ser flow. */
export function suggestSqlRels(doc: Doc, fromId: string, toId: string): SqlRel[] {
  const f = sqlRelEnd(doc, fromId);
  const t = sqlRelEnd(doc, toId);
  return SQL_REL_KEYS.filter((r) => sqlRelAllows(r, f, t));
}

export const sqlRelPairsText = (rel: SqlRel) => SQL_REL_PAIRS[rel].map((p) => `${p.from.join("|")} → ${p.to.join("|")}`).join(" ; ");

/** Erro de um conector que contradiz a relação; undefined se estiver ok. */
export function sqlConnectionTypeError(rel: SqlRel | undefined, type: ConnectionType | undefined): string | undefined {
  if (!type || !rel) return undefined;
  const want = SQL_RELS[rel].type;
  return type === want ? undefined : `a relação "${rel}" fixa o type em "${want}" (recebeu "${type}"); omita type`;
}

/** Rótulo da seta: «LEFT JOIN · p.cliente_id = c.id» no join; vazio no flow (a ordem já diz tudo). */
export function sqlConnLabel(spec: SqlConnSpec | undefined): string {
  if (!spec || spec.rel !== "join") return "";
  const kw = SQL_JOIN_TYPES[spec.join ?? "inner"].keyword.replace(" OUTER", "");
  return spec.on?.trim() ? `${kw} · ${spec.on.trim()}` : kw;
}

export const isSqlSource = (n: NodeEl | undefined) => !!n?.sql && SQL_SOURCE_ROLES.includes(n.sql.role);

/* ───────────────────────── cartão (tamanho e linhas) ───────────────────────── */

export const SQL_W = 232;
export const SQL_HEAD = 38;
export const SQL_LINE = 17;
export const SQL_MAX_LINES = 8;

/** Linhas de detalhe do cartão: colunas da tabela, a condição do filtro, o GROUP BY etc. */
export function sqlLines(spec: SqlNodeSpec): string[] {
  const list = (xs?: string[]) => (xs ?? []).map((x) => x.trim()).filter(Boolean);
  const wrap = (text: string | undefined) => (text ?? "").split(/\s+(?=\b(?:AND|OR)\b)/i).map((x) => x.trim()).filter(Boolean);
  switch (spec.role) {
    case "table":
      return list(spec.columns);
    case "subquery":
      return list(spec.columns).length ? list(spec.columns) : (spec.query ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
    case "filter":
      return wrap(spec.condition);
    case "aggregate":
      return [...list(spec.groupBy), ...(spec.having?.trim() ? [`HAVING ${spec.having.trim()}`] : [])];
    case "sort":
      return [...list(spec.orderBy), ...(spec.limit != null ? [`LIMIT ${spec.limit}`] : []), ...(spec.offset ? [`OFFSET ${spec.offset}`] : [])];
    case "result":
      return list(spec.columns).length ? list(spec.columns) : ["*"];
  }
}

/** Tamanho do cartão: a altura acompanha as linhas (até SQL_MAX_LINES, depois «+N»). */
export function sqlSize(spec: SqlNodeSpec): { w: number; h: number } {
  const n = sqlLines(spec).length;
  const shown = Math.min(n, SQL_MAX_LINES) + (n > SQL_MAX_LINES ? 1 : 0);
  return { w: SQL_W, h: Math.max(72, SQL_HEAD + 10 + shown * SQL_LINE + (shown ? 4 : 0)) };
}

/** Ajusta o tamanho dos cartões ao conteúdo (depois de editar colunas, condição…). */
export function resizeSql(nodes: NodeEl[]) {
  for (const n of nodes) {
    if (!n.sql || !SQL_ROLES[n.sql.role]) continue;
    const s = sqlSize(n.sql);
    n.w = s.w;
    n.h = s.h;
  }
}

/** Nome mostrado no cartão: «pedidos p» numa tabela com apelido. */
export function sqlTitle(n: NodeEl): string {
  const s = n.sql;
  if (s?.role === "table" && s.table && s.alias && s.alias !== s.table) return `${s.table} ${s.alias}`;
  if (s?.role === "table" && s.table) return s.table;
  if (s?.role === "subquery" && s.name && s.alias && s.name !== s.alias) return `${s.name} ${s.alias}`;
  if (s?.role === "subquery" && (s.name || s.alias)) return (s.name || s.alias)!;
  return n.label;
}

/* ───────────────────────── regras (S001+) ───────────────────────── */

export function sqlIssues(doc: Doc): Issue[] {
  const issues: Issue[] = [];
  const add = (rule: string, severity: Issue["severity"], message: string, target?: string) => issues.push({ rule, severity, message, target });
  const nodes = doc.nodes.filter((n) => n.sql && SQL_ROLES[n.sql.role]);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const quote = (n: NodeEl) => `"${n.label}" (${n.id})`;
  const flowsIn = (id: string) => doc.connections.filter((c) => c.to === id && c.sql?.rel === "flow");
  const flowsOut = (id: string) => doc.connections.filter((c) => c.from === id && c.sql?.rel === "flow");
  const joined = (id: string) => doc.connections.some((c) => c.sql?.rel === "join" && (c.from === id || c.to === id));

  const results = nodes.filter((n) => n.sql!.role === "result");
  if (nodes.length && !results.length) add("S001", "erro", "a consulta não tem Resultado (SELECT): arraste um da biblioteca e ligue a última etapa a ele com uma seta flow", undefined);

  for (const n of nodes) {
    const s = n.sql!;
    if (s.role === "table" && !s.table?.trim()) add("S002", "erro", `${quote(n)}: tabela sem nome (sql.table)`, n.id);
    if (s.role === "subquery") {
      if (!s.alias?.trim()) add("S003", "erro", `${quote(n)}: subconsulta sem apelido — é por ele que o resto da consulta a referencia`, n.id);
      if (!s.query?.trim()) add("S004", "erro", `${quote(n)}: subconsulta sem a consulta interna (sql.query)`, n.id);
    }
    if (s.role === "filter" && !s.condition?.trim()) add("S005", "erro", `${quote(n)}: filtro sem condição — o WHERE ficaria vazio`, n.id);
    if (s.role === "aggregate" && !s.groupBy?.length && !s.having?.trim()) add("S005", "aviso", `${quote(n)}: agrupamento sem GROUP BY nem HAVING; ele não muda nada`, n.id);
    if (s.role === "sort" && !s.orderBy?.length && s.limit == null && !s.offset) add("S005", "aviso", `${quote(n)}: ordenação sem ORDER BY nem LIMIT; ela não muda nada`, n.id);
    if (s.role !== "result" && !SQL_SOURCE_ROLES.includes(s.role) && !flowsIn(n.id).length) add("S006", "aviso", `${quote(n)}: etapa sem entrada — ligue uma fonte (ou a etapa anterior) a ela com uma seta flow`, n.id);
    if (s.role !== "result" && !flowsOut(n.id).length && !(SQL_SOURCE_ROLES.includes(s.role) && joined(n.id))) add("S006", "aviso", `${quote(n)}: ${SQL_SOURCE_ROLES.includes(s.role) ? "fonte que não entra na consulta (sem join nem flow)" : "etapa sem saída — ligue-a à próxima etapa ou ao Resultado"}`, n.id);
    if (s.role === "result" && !flowsIn(n.id).length) add("S006", "aviso", `${quote(n)}: resultado sem fonte — o SELECT sai sem FROM`, n.id);
    if (!SQL_SOURCE_ROLES.includes(s.role) && flowsIn(n.id).length > 1) add("S007", "erro", `${quote(n)}: ${flowsIn(n.id).length} setas flow chegando; cada etapa recebe as linhas de um lugar só (junte as fontes com join)`, n.id);
    if (flowsOut(n.id).length > 1) add("S007", "erro", `${quote(n)}: ${flowsOut(n.id).length} setas flow saindo; o fluxo até o resultado é uma linha só`, n.id);
  }

  // S008 apelidos repetidos: a consulta ficaria ambígua
  const aliases = new Map<string, NodeEl[]>();
  for (const n of nodes.filter((x) => SQL_SOURCE_ROLES.includes(x.sql!.role))) {
    const key = (n.sql!.alias?.trim() || n.sql!.table?.trim() || "").toLowerCase();
    if (key) aliases.set(key, [...(aliases.get(key) ?? []), n]);
  }
  for (const [key, ns] of aliases) if (ns.length > 1) add("S008", "erro", `o nome "${key}" é usado por ${ns.map(quote).join(", ")}; dê apelidos diferentes (sql.alias)`, ns[1].id);

  for (const c of doc.connections) {
    const f = sqlRelEnd(doc, c.from);
    const t = sqlRelEnd(doc, c.to);
    if (!f && !t) continue;
    const where = `${byId.get(c.from) ? quote(byId.get(c.from)!) : c.from} → ${byId.get(c.to) ? quote(byId.get(c.to)!) : c.to}`;
    const rel = c.sql?.rel;
    if (!rel) {
      const s = suggestSqlRels(doc, c.from, c.to);
      add("S009", "aviso", `${where}: conexão sem relação${s.length ? `; use sql: { rel: "${s[0]}" }` : "; nenhuma relação liga este par"}`, c.id);
      continue;
    }
    if (!sqlRelAllows(rel, f, t)) {
      const s = suggestSqlRels(doc, c.from, c.to);
      add("S009", "aviso", `${where}: ${rel} liga ${sqlRelPairsText(rel)}${s.length ? `. Para este par use: ${s.join(", ")}` : ""}`, c.id);
      continue;
    }
    if (rel === "join" && (c.sql!.join ?? "inner") !== "cross" && !c.sql!.on?.trim()) add("S010", "erro", `${where}: join sem condição (sql.on); sem ON vira produto cartesiano — se é isso, use join "cross"`, c.id);
    if (rel === "join" && c.sql!.join === "cross" && c.sql!.on?.trim()) add("S010", "aviso", `${where}: CROSS JOIN não tem ON; a condição é ignorada (use inner)`, c.id);
  }

  // S011 ordem das etapas: WHERE antes de GROUP BY antes de ORDER BY
  const rank: Partial<Record<SqlRole, number>> = { filter: 1, aggregate: 2, sort: 3, result: 4 };
  for (const c of doc.connections.filter((x) => x.sql?.rel === "flow")) {
    const f = sqlRelEnd(doc, c.from);
    const t = sqlRelEnd(doc, c.to);
    if (f && t && rank[f] && rank[t] && rank[f]! > rank[t]!) add("S011", "aviso", `${byId.get(c.from)!.label} → ${byId.get(c.to)!.label}: ${SQL_ROLES[f].label} vem depois de ${SQL_ROLES[t].label} no SQL; o gerador emite na ordem do SQL (WHERE → GROUP BY → ORDER BY)`, c.id);
  }

  // S012 ciclo de joins: a mesma fonte entraria duas vezes
  const parent = new Map<string, string>();
  const find = (x: string): string => (parent.get(x) ?? x) === x ? x : find(parent.get(x)!);
  for (const c of doc.connections.filter((x) => x.sql?.rel === "join" && byId.has(x.from) && byId.has(x.to))) {
    const a = find(c.from);
    const b = find(c.to);
    if (a === b) add("S012", "aviso", `${c.from} ⋈ ${c.to}: este join fecha um ciclo; as fontes já estão ligadas por outro caminho e a condição dele vira AND no ON`, c.id);
    else parent.set(a, b);
  }

  // S013 resultado agregado sem GROUP BY (SUM/COUNT junto de coluna solta)
  for (const r of results) {
    const p = sqlPipeline(doc, r.id);
    const cols = r.sql!.columns ?? [];
    const agg = cols.filter((x) => /\b(count|sum|avg|min|max)\s*\(/i.test(x));
    if (agg.length && agg.length < cols.length && !p.steps.some((s) => s.sql!.role === "aggregate")) add("S013", "aviso", `${quote(r)}: mistura agregações (${agg.join(", ")}) com colunas soltas sem GROUP BY; a maioria dos bancos recusa — adicione um Agrupamento`, r.id);
  }
  return issues;
}

/* ───────────────────────── descrição e guia ───────────────────────── */

export function describeSql(doc: Doc, issues: Issue[]): string {
  const L: string[] = [`# ${doc.title}`, doc.description ?? "", ""];
  const sources = doc.nodes.filter((n) => isSqlSource(n));
  L.push("## Fontes");
  if (!sources.length) L.push("(nenhuma)");
  for (const n of sources) {
    const s = n.sql!;
    if (s.role === "table") L.push(`- **${s.table ?? "(sem nome)"}**${s.alias ? ` AS ${s.alias}` : ""} (${n.id})${s.columns?.length ? ` — colunas: ${s.columns.join(", ")}` : ""}${n.description ? ` — ${n.description}` : ""}`);
    else L.push(`- **${s.name ?? s.alias ?? "(sem apelido)"}**${s.name && s.alias && s.alias !== s.name ? ` AS ${s.alias}` : ""} (${n.id}) — ${s.cte ? "CTE" : "subconsulta no FROM"}: \`${(s.query ?? "").replace(/\s+/g, " ").trim()}\``);
  }
  const joins = doc.connections.filter((c) => c.sql?.rel === "join");
  L.push("", "## Joins");
  if (!joins.length) L.push("(nenhum)");
  const name = (id: string) => {
    const n = doc.nodes.find((x) => x.id === id);
    return n ? sqlTitle(n) : id;
  };
  for (const c of joins) L.push(`- ${name(c.from)} ${SQL_JOIN_TYPES[c.sql!.join ?? "inner"].keyword} ${name(c.to)}${c.sql!.on ? ` ON ${c.sql!.on}` : ""}`);
  L.push("", "## Fluxo até o resultado");
  const results = doc.nodes.filter((n) => n.sql?.role === "result");
  if (!results.length) L.push("(sem Resultado)");
  for (const r of results) {
    const p = sqlPipeline(doc, r.id);
    const chain = [p.source ? name(p.source.id) : "(sem fonte)", ...p.steps.map((s) => `${SQL_ROLES[s.sql!.role].badge} ${s.label}`), `SELECT ${r.label}`];
    L.push(`- ${chain.join(" → ")}`);
  }
  const sql = generateSql(doc);
  if (sql) L.push("", "## SQL gerado", "```sql", sql, "```");
  if (issues.length) L.push("", "## Avisos", ...issues.map((i) => `- [${i.rule} ${i.severity}] ${i.message}`));
  return L.join("\n");
}

export function schemaGuideSql(): string {
  return [
    `# Archflow ${SCHEMA_VERSION} — modo sql (consultas SQL)`,
    "",
    "O diagrama é UMA consulta SELECT desenhada na ordem lógica em que o banco a executa: as fontes (tabelas e subconsultas) se juntam por setas `join`; daí as linhas seguem por setas `flow` pelas etapas até o Resultado.",
    "Todo nó é `kind: \"sql\"` com `sql.role`. O app gera o SQL a partir do quadro (generate_code) e monta o quadro a partir de uma consulta (import_sql).",
    "",
    "## Papéis (`sql.role`) e campos",
    ...SQL_ROLE_KEYS.map((r) => `- \`${r}\` (${SQL_ROLES[r].label}): ${SQL_ROLES[r].hint} Campos: ${SQL_ROLES[r].fields.map((f) => `\`${f}\``).join(", ")}`),
    "",
    "## Relações (`sql.rel` na conexão; o `type` vem da relação — não informe)",
    ...SQL_REL_KEYS.map((r) => `- \`${r}\` (${sqlRelPairsText(r)}): ${SQL_RELS[r].semantics}`),
    "- `sql.join`: " + SQL_JOIN_KEYS.map((k) => `\`${k}\` = ${SQL_JOIN_TYPES[k].hint}`).join(" · "),
    "- Omitindo `sql` no connect, a relação é deduzida do par (fonte → fonte = join; o resto = flow).",
    "",
    "## Fluxo recomendado",
    "1. Tem a consulta em texto? `import_sql { query }` monta o quadro inteiro (tabelas com as colunas usadas, joins, WHERE, GROUP BY, ORDER BY, SELECT).",
    "2. Do zero: `add_components` com uma `table` por tabela (`table`, `alias`, `columns`), `connect` as tabelas com `sql: { rel: \"join\", join: \"left\", on: \"p.cliente_id = c.id\" }`.",
    "3. Ligue a tabela principal (a do FROM) à primeira etapa com `flow`: filter (`condition`) → aggregate (`groupBy`, `having`) → sort (`orderBy`, `limit`) → result (`columns`, `distinct`). Etapas que não existem na consulta ficam de fora.",
    "4. `auto_layout`, `validate_diagram` e `generate_code` para conferir o SQL gerado.",
    "",
    "Use os apelidos (`p.total`) nas condições e colunas; o gerador não reescreve expressões.",
  ].join("\n");
}
