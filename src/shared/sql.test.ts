import assert from "node:assert/strict";
import { test } from "node:test";
import { applyOps, describe, normalizeDoc, schemaGuide, validateDetailed, type Op } from "./ops";
import { SQL_ROLE_KEYS, SQL_ROLES, docMode, emptyDoc, type Doc } from "./schema";
import { checkSqlConn, checkSqlNode, reshapeSql, sqlSize } from "./sql";
import { SQL_EXAMPLES, sqlDocFrom, sqlExampleDoc } from "./sql.example";
import { SqlParseError, generateSql, parseSql, sqlToOps } from "./sqlgen";

const sqlDoc = (ops: Op[]) => {
  const { doc, results } = applyOps(emptyDoc("Consulta", "sql"), ops);
  for (const r of results) assert.ok(r.ok, r.error ?? "");
  return doc;
};
const rules = (doc: Doc) => validateDetailed(doc).map((i) => i.rule);
/** Compara SQL ignorando quebras de linha e espaços repetidos. */
const flat = (s: string) => s.replace(/\s+/g, " ").replace(/\( /g, "(").replace(/ \)/g, ")").replace(/;$/, "").trim();

/* ───────── vocabulário e ops ───────── */

test("cada papel tem dica, selo e só campos que o validador conhece", () => {
  for (const r of SQL_ROLE_KEYS) {
    assert.ok(SQL_ROLES[r].hint.length >= 30, r);
    assert.equal(checkSqlNode(reshapeSql({ role: "table", table: "t", alias: "x", columns: ["a"] }, r)), undefined, r);
  }
  assert.match(checkSqlNode({ role: "filter", table: "x" }) ?? "", /não existe no papel "filter"/);
  assert.match(checkSqlNode({ role: "sort", limit: -1 }) ?? "", /inteiro a partir de 0/);
  assert.match(checkSqlNode({ role: "table", table: "t", alias: "a b" }) ?? "", /identificador/);
  assert.match(checkSqlNode({ role: "subquery", alias: "r", name: "resumo" }) ?? "", /cte: true/);
  assert.match(checkSqlConn({ rel: "flow", on: "a = b" }) ?? "", /só valem em rel "join"/);
  assert.match(checkSqlConn({ rel: "join", join: "outer" }) ?? "", /inválido/);
});

test("peças sql só entram no modo sql, e o modo só aceita peças sql (e referências)", () => {
  const arch = applyOps(emptyDoc("A"), [{ op: "add_node", kind: "sql", sql: { role: "table", table: "t" } }]);
  assert.match(arch.results[0].error ?? "", /modo "sql"/);
  const sql = applyOps(emptyDoc("S", "sql"), [{ op: "add_node", asset: "postgresql" }]);
  assert.equal(sql.results[0].ok, false);
});

test("connect deduz a relação pelo par, fixa o type e rotula o join", () => {
  const doc = sqlDoc([
    { op: "add_node", id: "c", sql: { role: "table", table: "clientes", alias: "c" } },
    { op: "add_node", id: "p", sql: { role: "table", table: "pedidos", alias: "p" } },
    { op: "add_node", id: "r", sql: { role: "result" } },
    { op: "add_connection", from: "c", to: "p", sql: { rel: "join", join: "left", on: "p.cliente_id = c.id" } },
    { op: "add_connection", from: "c", to: "r" },
  ]);
  const [join, flow] = doc.connections;
  assert.equal(join.type, "association");
  assert.equal(join.label, "LEFT JOIN · p.cliente_id = c.id");
  assert.deepEqual(flow.sql, { rel: "flow" });
  assert.equal(flow.type, "data");
  const bad = applyOps(doc, [{ op: "add_connection", from: "c", to: "p", type: "sync", sql: { rel: "join", on: "x" } }]);
  assert.match(bad.results[0].error ?? "", /fixa o type/);
  // trocar o tipo do join leva o rótulo automático junto
  const { doc: d2 } = applyOps(doc, [{ op: "update", id: join.id, patch: { sql: { rel: "join", on: "p.cliente_id = c.id" } } }]);
  assert.equal(d2.connections[0].label, "INNER JOIN · p.cliente_id = c.id");
});

test("o cartão cresce com as linhas e o update o redimensiona", () => {
  const small = sqlSize({ role: "table", table: "t" });
  const big = sqlSize({ role: "table", table: "t", columns: ["a", "b", "c", "d", "e"] });
  assert.ok(big.h > small.h);
  assert.equal(sqlSize({ role: "table", columns: Array.from({ length: 30 }, (_, i) => `c${i}`) }).h, sqlSize({ role: "table", columns: Array.from({ length: 9 }, (_, i) => `c${i}`) }).h, "acima do máximo vira «+N»");
  const doc = sqlDoc([{ op: "add_node", id: "t", sql: { role: "table", table: "t" } }]);
  const h0 = doc.nodes[0].h;
  const { doc: d2 } = applyOps(doc, [{ op: "update", id: "t", patch: { sql: { role: "table", table: "t", columns: ["a", "b", "c"] } } }]);
  assert.ok(d2.nodes[0].h > h0);
});

test("set_meta aceita sql e um arquivo sem mode com peças sql abre no modo sql", () => {
  const { doc, results } = applyOps(emptyDoc("x"), [{ op: "set_meta", mode: "sql" }]);
  assert.ok(results[0].ok);
  assert.equal(docMode(doc), "sql");
  const raw = { title: "t", nodes: [{ id: "a", label: "a", kind: "sql", x: 0, y: 0, w: 10, h: 10, sql: { role: "table", table: "a" } }] };
  assert.equal(docMode(normalizeDoc(raw)), "sql");
  assert.match(applyOps(emptyDoc("x"), [{ op: "set_meta", mode: "nosql" as never }]).results[0].error ?? "", /sql/);
});

/* ───────── regras ───────── */

test("S001 sem Resultado, S002 tabela sem nome, S010 join sem ON, S008 apelido repetido", () => {
  const doc = sqlDoc([
    { op: "add_node", id: "a", sql: { role: "table", table: "a", alias: "x" } },
    { op: "add_node", id: "b", sql: { role: "table", table: "b", alias: "x" } },
    { op: "add_node", id: "c", label: "c", sql: { role: "table" } },
    { op: "add_connection", from: "a", to: "b", sql: { rel: "join" } },
  ]);
  const r = rules(doc);
  for (const rule of ["S001", "S002", "S008", "S010"]) assert.ok(r.includes(rule), `${rule} em ${r.join(",")}`);
  // CROSS JOIN não precisa de ON
  const { doc: d2 } = applyOps(doc, [{ op: "update", id: doc.connections[0].id, patch: { sql: { rel: "join", join: "cross" } } }]);
  assert.ok(!rules(d2).includes("S010"));
});

test("S007 duas fontes chegando por flow na mesma etapa; S013 agregação sem GROUP BY", () => {
  const doc = sqlDoc([
    { op: "add_node", id: "a", sql: { role: "table", table: "a" } },
    { op: "add_node", id: "b", sql: { role: "table", table: "b" } },
    { op: "add_node", id: "r", sql: { role: "result", columns: ["a.x", "COUNT(*)"] } },
    { op: "add_connection", from: "a", to: "r" },
    { op: "add_connection", from: "b", to: "r" },
  ]);
  const r = rules(doc);
  assert.ok(r.includes("S007"), r.join(","));
  assert.ok(r.includes("S013"), r.join(","));
});

/* ───────── SQL → quadro → SQL ───────── */

test("cada exemplo vira um quadro sem erros nem avisos, e o SQL gerado é a consulta de origem", () => {
  for (const ex of SQL_EXAMPLES) {
    const doc = sqlExampleDoc(ex);
    assert.equal(docMode(doc), "sql");
    assert.deepEqual(validateDetailed(doc).map((i) => i.message), [], ex.title);
    assert.equal(flat(generateSql(doc)), flat(ex.query), ex.title);
  }
});

test("a tabela recebe as colunas que a consulta usa dela (pelo apelido)", () => {
  const doc = sqlExampleDoc(SQL_EXAMPLES[0]);
  const pedidos = doc.nodes.find((n) => n.sql?.table === "pedidos")!;
  assert.deepEqual(pedidos.sql!.columns?.sort(), ["cliente_id", "status", "total"]);
});

test("ida e volta: joins de todos os tipos, USING, vírgula, subconsulta no FROM e CTE com apelido", () => {
  const cases = [
    "SELECT * FROM a LEFT JOIN b ON b.a_id = a.id RIGHT JOIN c ON c.b_id = b.id FULL OUTER JOIN d ON d.id = c.d_id CROSS JOIN e",
    "SELECT a.x FROM a INNER JOIN b USING (id)",
    "SELECT DISTINCT a.x, b.y FROM a CROSS JOIN b WHERE a.id = b.a_id",
    "SELECT t.n FROM (SELECT COUNT(*) AS n FROM pedidos) t",
    "WITH resumo AS (SELECT cliente_id, COUNT(*) AS n FROM pedidos GROUP BY cliente_id) SELECT c.nome, r.n FROM clientes c INNER JOIN resumo r ON r.cliente_id = c.id",
    "SELECT x FROM vendas.pedidos p ORDER BY x LIMIT 5 OFFSET 10",
  ];
  for (const q of cases) {
    const doc = sqlDocFrom("t", q);
    assert.equal(flat(generateSql(doc)), flat(q), q);
  }
  // a vírgula no FROM é um produto cartesiano: o quadro a mostra (e devolve) como CROSS JOIN
  assert.equal(flat(generateSql(sqlDocFrom("t", "SELECT a.x FROM a, b WHERE a.id = b.a_id"))), "SELECT a.x FROM a CROSS JOIN b WHERE a.id = b.a_id");
});

test("dialetos: TOP, LIMIT a, b (MySQL) e FETCH FIRST viram LIMIT/OFFSET", () => {
  assert.equal(parseSql("SELECT TOP 5 * FROM t").limit, 5);
  const my = parseSql("SELECT * FROM t LIMIT 20, 10");
  assert.deepEqual([my.offset, my.limit], [20, 10]);
  const ansi = parseSql("SELECT * FROM t ORDER BY id OFFSET 5 ROWS FETCH FIRST 3 ROWS ONLY");
  assert.deepEqual([ansi.offset, ansi.limit], [5, 3]);
});

test("join à direita da condição: a seta parte da fonte que o ON cita", () => {
  const { ops } = sqlToOps("SELECT * FROM a JOIN b ON b.a_id = a.id JOIN c ON c.b_id = b.id");
  const joins = ops.filter((o): o is Extract<Op, { op: "add_connection" }> => o.op === "add_connection" && o.sql?.rel === "join");
  assert.deepEqual(joins.map((j) => `${j.from}>${j.to}`), ["a>b", "b>c"]);
});

test("o que o quadro não representa é recusado com o motivo; comentários e texto com aspas passam", () => {
  const err = (q: string) => {
    try {
      parseSql(q);
      return "";
    } catch (e) {
      assert.ok(e instanceof SqlParseError, String(e));
      return (e as Error).message;
    }
  };
  assert.match(err("SELECT a FROM t UNION SELECT b FROM u"), /UNION/);
  assert.match(err("UPDATE t SET a = 1"), /UPDATE não é uma consulta/);
  assert.match(err("SELECT 1; SELECT 2"), /mais de uma/);
  assert.match(err("SELECT * FROM t WHERE a = 'x"), /aspas/);
  assert.match(err(""), /vazia/);
  const q = parseSql("-- topo\nSELECT a /* meio */ FROM t WHERE nome = 'it''s; ok'");
  assert.equal(q.where, "nome = 'it''s; ok'");
});

test("import com ids já usados não colide", () => {
  const { ops } = sqlToOps("SELECT * FROM clientes", ["clientes", "resultado"]);
  const ids = ops.flatMap((o) => (o.op === "add_node" ? [o.id] : []));
  assert.ok(!ids.includes("clientes") && !ids.includes("resultado"), ids.join(","));
});

/* ───────── texto para IA e guia ───────── */

test("describe traz fontes, joins, o fluxo e o SQL; o guia do modo é o de sql", () => {
  const md = describe(sqlExampleDoc(SQL_EXAMPLES[1]));
  assert.match(md, /## Joins/);
  assert.match(md, /LEFT JOIN produtos/);
  assert.match(md, /```sql/);
  const guide = schemaGuide("sql");
  for (const r of SQL_ROLE_KEYS) assert.ok(guide.includes(`\`${r}\``), r);
  assert.match(guide, /import_sql/);
});
