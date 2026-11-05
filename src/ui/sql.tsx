import { applyOps } from "../shared/ops";
import { SQL_JOIN_KEYS, SQL_JOIN_TYPES, SQL_REL_KEYS, SQL_RELS, SQL_ROLE_KEYS, SQL_ROLES, emptyDoc, type ConnectionEl, type NodeEl, type SqlField, type SqlNodeSpec, type SqlRel, type SqlRole } from "../shared/schema";
import { reshapeSql, suggestSqlRels } from "../shared/sql";
import { SqlParseError, sqlToOps } from "../shared/sqlgen";
import { Glyph } from "./icons";
import { fitView } from "./keys";
import { TextField } from "./panels";
import { getState, replaceDoc, set, toast, toastError, useStore } from "./store";

type Patch = (p: Record<string, unknown>) => void;

/** Mescla `p` no spec e descarta campos vazios (o validador recusa texto vazio onde espera um valor). */
function mergeSql(sql: SqlNodeSpec, p: Record<string, unknown>): Record<string, unknown> {
  const next: Record<string, unknown> = { ...sql, ...p };
  for (const k of Object.keys(next)) {
    const v = next[k];
    if (v === undefined || v === "" || v === false || (Array.isArray(v) && !v.length)) delete next[k];
  }
  return next;
}

const lines = (v: string) => v.split("\n").map((l) => l.trim()).filter(Boolean);

export const openSqlModal = (tab?: "sql" | "import" | "issues" | "text") => set({ modal: { type: "sql", tab } });

/* ───────── nó: tabela, subconsulta, filtro, agrupamento, ordenação, resultado ───────── */

function ListField({ label, hint, value, placeholder, onCommit }: { label: string; hint?: string; value?: string[]; placeholder: string; onCommit: (v: string[]) => void }) {
  return (
    <label className="field">
      <span>
        {label} {hint && <small style={{ opacity: 0.7 }}>{hint}</small>}
      </span>
      <TextField multiline mono value={(value ?? []).join("\n")} placeholder={placeholder} onCommit={(v) => onCommit(lines(v))} />
    </label>
  );
}

function Switch({ label, on, onChange }: { label: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="toggle">
      {label}
      <button className="switch" role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)} />
    </div>
  );
}

function NumberField({ label, value, placeholder, onChange }: { label: string; value?: number; placeholder: string; onChange: (v: number | undefined) => void }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input
        className="input mono"
        type="number"
        min={0}
        step={1}
        value={value ?? ""}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value === "" ? undefined : Math.max(0, Math.floor(Number(e.target.value))))}
      />
    </label>
  );
}

export function SqlFields({ node, patch }: { node: NodeEl; patch: Patch }) {
  const sql = node.sql!;
  const role = SQL_ROLES[sql.role];
  const upd = (p: Partial<Record<SqlField, unknown>>) => patch({ sql: mergeSql(sql, p) });
  return (
    <>
      <label className="field">
        <span>Papel</span>
        <select className="input" value={sql.role} onChange={(e) => patch({ sql: reshapeSql(sql, e.target.value as SqlRole) })}>
          {SQL_ROLE_KEYS.map((r) => (
            <option key={r} value={r}>
              {SQL_ROLES[r].label}
            </option>
          ))}
        </select>
      </label>
      <div className="callout">{role.hint}</div>
      {sql.role === "table" && (
        <>
          <div className="grid2">
            <label className="field">
              <span>Tabela</span>
              <TextField
                mono
                value={sql.table ?? ""}
                placeholder="vendas.pedidos"
                // o nome do cartão acompanha a tabela enquanto não foi trocado à mão
                onCommit={(v) => patch({ sql: mergeSql(sql, { table: v.trim() }), ...(node.label === (sql.table ?? "") || node.label === SQL_ROLES.table.label ? { label: v.trim().split(".").pop() || node.label } : {}) })}
              />
            </label>
            <label className="field">
              <span>Apelido</span>
              <TextField mono value={sql.alias ?? ""} placeholder="p" onCommit={(v) => upd({ alias: v.trim() })} />
            </label>
          </div>
          <ListField label="Colunas usadas" hint="(uma por linha; só documentação)" value={sql.columns} placeholder={"id\ncliente_id\ntotal"} onCommit={(v) => upd({ columns: v })} />
        </>
      )}
      {sql.role === "subquery" && (
        <>
          <label className="field">
            <span>Apelido</span>
            <TextField mono value={sql.alias ?? ""} placeholder="ativos" onCommit={(v) => upd({ alias: v.trim() })} />
          </label>
          <Switch label="Sai como CTE (WITH … AS)" on={!!sql.cte} onChange={(v) => upd({ cte: v, ...(v ? {} : { name: undefined }) })} />
          {sql.cte && (
            <label className="field">
              <span>
                Nome no WITH <small style={{ opacity: 0.7 }}>(vazio = o apelido)</small>
              </span>
              <TextField mono value={sql.name ?? ""} placeholder={sql.alias || "resumo"} onCommit={(v) => upd({ name: v.trim() })} />
            </label>
          )}
          <label className="field">
            <span>Consulta interna</span>
            <TextField multiline mono value={sql.query ?? ""} placeholder={"SELECT id, nome\nFROM clientes\nWHERE ativo"} onCommit={(v) => upd({ query: v })} />
          </label>
          <ListField label="Colunas de saída" hint="(uma por linha)" value={sql.columns} placeholder={"id\nnome"} onCommit={(v) => upd({ columns: v })} />
        </>
      )}
      {sql.role === "filter" && (
        <label className="field">
          <span>Condição (WHERE)</span>
          <TextField multiline mono value={sql.condition ?? ""} placeholder="p.status = 'pago' AND p.total > 0" onCommit={(v) => upd({ condition: v.trim() })} />
        </label>
      )}
      {sql.role === "aggregate" && (
        <>
          <ListField label="GROUP BY" hint="(uma expressão por linha)" value={sql.groupBy} placeholder={"c.id\nc.nome"} onCommit={(v) => upd({ groupBy: v })} />
          <label className="field">
            <span>HAVING</span>
            <TextField multiline mono value={sql.having ?? ""} placeholder="COUNT(*) > 1" onCommit={(v) => upd({ having: v.trim() })} />
          </label>
        </>
      )}
      {sql.role === "sort" && (
        <>
          <ListField label="ORDER BY" hint="(um item por linha)" value={sql.orderBy} placeholder={"total DESC\nc.nome"} onCommit={(v) => upd({ orderBy: v })} />
          <div className="grid2">
            <NumberField label="LIMIT" value={sql.limit} placeholder="sem limite" onChange={(v) => upd({ limit: v })} />
            <NumberField label="OFFSET" value={sql.offset} placeholder="0" onChange={(v) => upd({ offset: v || undefined })} />
          </div>
        </>
      )}
      {sql.role === "result" && (
        <>
          <ListField label="Colunas (SELECT)" hint="(uma por linha; vazio = *)" value={sql.columns} placeholder={"c.nome\nSUM(p.total) AS total"} onCommit={(v) => upd({ columns: v })} />
          <Switch label="DISTINCT" on={!!sql.distinct} onChange={(v) => upd({ distinct: v })} />
        </>
      )}
      <button className="btn" style={{ width: "100%", justifyContent: "center", marginBottom: 10 }} onClick={() => openSqlModal("sql")}>
        <Glyph name="code" size={16} /> Ver o SQL gerado
      </button>
    </>
  );
}

/* ───────── conexão: join ou flow ───────── */

export function SqlConnFields({ conn, patch }: { conn: ConnectionEl; patch: Patch }) {
  const doc = useStore((s) => s.doc);
  const a = conn.sql;
  const valid = suggestSqlRels(doc, conn.from, conn.to);
  const setRel = (rel: SqlRel | "") => patch({ sql: rel ? { rel, ...(rel === "join" && a?.on ? { on: a.on } : {}), ...(rel === "join" && a?.join ? { join: a.join } : {}) } : null });
  const upd = (p: Record<string, unknown>) => {
    const next: Record<string, unknown> = { ...a, ...p };
    for (const k of Object.keys(next)) if (next[k] === undefined || next[k] === "") delete next[k];
    patch({ sql: next });
  };
  return (
    <>
      <label className="field">
        <span>Relação</span>
        <select className="input" value={a?.rel ?? ""} onChange={(e) => setRel(e.target.value as SqlRel | "")}>
          <option value="">— sem relação —</option>
          {SQL_REL_KEYS.map((r) => (
            <option key={r} value={r} disabled={!valid.includes(r) && a?.rel !== r}>
              {SQL_RELS[r].label}
              {valid.includes(r) ? "" : a?.rel === r ? " (inválida para este par)" : " (não liga este par)"}
            </option>
          ))}
        </select>
      </label>
      {a && <div className="callout">{SQL_RELS[a.rel].semantics}</div>}
      {a?.rel === "join" && (
        <>
          <div className="field">
            <span className="lbl-s">Tipo de join</span>
            <div className="seg" role="radiogroup" aria-label="Tipo de join">
              {SQL_JOIN_KEYS.map((k) => (
                <button key={k} role="radio" aria-checked={(a.join ?? "inner") === k} className={(a.join ?? "inner") === k ? "active" : ""} onClick={() => upd({ join: k === "inner" ? undefined : k })} data-tip={SQL_JOIN_TYPES[k].hint} data-tip-pos="left">
                  {SQL_JOIN_TYPES[k].label}
                </button>
              ))}
            </div>
          </div>
          {(a.join ?? "inner") !== "cross" && (
            <label className="field">
              <span>Condição (ON)</span>
              <TextField mono value={a.on ?? ""} placeholder="p.cliente_id = c.id" onCommit={(v) => upd({ on: v.trim() })} />
            </label>
          )}
        </>
      )}
    </>
  );
}

/* ───────── importar uma consulta ───────── */

/**
 * Monta o quadro a partir de uma consulta: substitui o conteúdo do diagrama aberto (título, id e assets ficam) num só
 * passo de desfazer. Devolve false (e avisa) quando a consulta não dá para ler.
 */
export function importSql(text: string): boolean {
  const s = getState();
  try {
    const { ops, warnings } = sqlToOps(text);
    const base = { ...emptyDoc(s.doc.title, "sql"), id: s.doc.id, description: s.doc.description, customAssets: s.doc.customAssets };
    const { doc, results } = applyOps(base, ops);
    const failed = results.filter((r) => !r.ok);
    if (failed.length) return toastError(`Não deu para montar o quadro: ${failed[0].error}`), false;
    replaceDoc(doc);
    requestAnimationFrame(() => fitView());
    toast(`Consulta diagramada: ${doc.nodes.length} peças${warnings.length ? ` · ${warnings.join(" · ")}` : ""}.`, true);
    return true;
  } catch (e) {
    toastError(e instanceof SqlParseError ? `Não consegui ler a consulta: ${e.message}` : e instanceof Error ? e.message : String(e));
    return false;
  }
}
