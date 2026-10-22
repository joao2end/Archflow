/**
 * Abas «Visão geral» e «Cenários» do modal do modo Logic: o resumo e o contrato de dados, e a matriz de cenários
 * (um caso por linha, com o que entra, o que se espera, o que saiu e as etapas por onde passou).
 */
import { useMemo } from "react";
import { Glyph } from "./icons";
import { shortValue } from "../shared/expr";
import { checkExamples } from "../shared/logic";
import { dataContract, logicSummary, pairs, scenarioMatrix, type ContractItem } from "../shared/logicoverview";
import { select, set, startPlay, useStore } from "./store";

const close = () => set({ modal: null });

function ContractTable({ title, items, empty }: { title: string; items: ContractItem[]; empty: string }) {
  return (
    <section className="lo-section">
      <h3>{title}</h3>
      {items.length ? (
        <table className="lo-table">
          <thead>
            <tr>
              <th>Nome nas expressões</th>
              <th>Dado</th>
              <th>Tipo</th>
              <th>Significado</th>
            </tr>
          </thead>
          <tbody>
            {items.map((d) => (
              <tr key={d.id}>
                <td>
                  <button className="lo-link" onClick={() => (select([d.id]), close())} data-tip="Selecionar no quadro">
                    <code>{d.key}</code>
                  </button>
                </td>
                <td>{d.label}</td>
                <td>
                  <code>{d.type ?? "—"}</code>
                  {d.value !== undefined && <small> · padrão {shortValue(d.value)}</small>}
                </td>
                <td>{d.text ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="lo-empty">{empty}</p>
      )}
    </section>
  );
}

/** Resumo (o que faz, entra, sai, etapas, placar) e o contrato de dados. */
export function OverviewTab() {
  const doc = useStore((s) => s.doc);
  const results = useMemo(() => checkExamples(doc), [doc]);
  const s = useMemo(() => logicSummary(doc, results), [doc, results]);
  const c = useMemo(() => dataContract(doc), [doc]);
  return (
    <div className="lo">
      <section className="lo-hero">
        <h3>{s.title}</h3>
        {s.description && <p>{s.description}</p>}
        <div className="lo-facts">
          <span>
            <b>Entra</b> {s.inputs.join(", ") || "—"}
          </span>
          <span>
            <b>Sai</b> {s.outputs.join(", ") || "—"}
          </span>
          <span>
            <b>{s.steps}</b> passos
          </span>
          <span className={s.scenarios.ok === s.scenarios.total ? "ok" : "fail"}>
            <b>
              {s.scenarios.ok}/{s.scenarios.total}
            </b>{" "}
            cenários batem{s.scenarios.failures ? ` (${s.scenarios.failures} de falha)` : ""}
          </span>
        </div>
      </section>
      {s.stages.length > 0 && (
        <section className="lo-section">
          <h3>Etapas, na ordem do fluxo</h3>
          <ol className="lo-stages">
            {s.stages.map((st, i) => (
              <li key={i}>
                <b>{st.label}</b>
                {st.text && <span> — {st.text}</span>}
              </li>
            ))}
          </ol>
        </section>
      )}
      <ContractTable title="Entradas" items={c.inputs} empty="Nenhuma entrada: o fluxo não recebe dados." />
      <ContractTable title="Resultados" items={c.outputs} empty="Nenhum resultado declarado (Output)." />
      <ContractTable title="Variáveis do fluxo" items={c.variables} empty="Nenhuma variável intermediária." />
    </div>
  );
}

/** Matriz de cenários: o caso inteiro de relance, com ▶ para reproduzir. */
export function ScenarioMatrixTab() {
  const doc = useStore((s) => s.doc);
  const rows = useMemo(() => scenarioMatrix(doc), [doc]);
  if (!rows.length) return <div className="callout">Nenhum cenário ainda. Crie um Scenario (biblioteca, tecla B) com o que entra e o que deve sair: ele prova o fluxo de ponta a ponta.</div>;
  return (
    <div className="lo">
      <table className="lo-table lo-matrix">
        <thead>
          <tr>
            <th aria-label="Resultado" />
            <th>Cenário</th>
            <th>Entra</th>
            <th>Espera</th>
            <th>Saiu</th>
            <th>Passa por</th>
            <th aria-label="Reproduzir" />
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className={`${r.ok ? "ok" : "fail"}${r.failure ? " failure" : ""}`}>
              <td className="lo-mark" data-tip={r.ok ? "Bate com o esperado" : r.problems.join("; ")}>
                {r.ok ? "✔" : "✘"}
              </td>
              <td>
                <button className="lo-link" onClick={() => (select([r.scenario]), close())} data-tip="Selecionar no quadro">
                  {r.label}
                </button>
                {r.failure && <small className="lo-tag">falha esperada</small>}
                {r.exampleName !== r.label && <small> · {r.exampleName}</small>}
              </td>
              <td>
                <code>{pairs(r.given) || "—"}</code>
              </td>
              <td>
                <code>{pairs(r.expect)}</code>
              </td>
              <td>{r.ok ? <span className="lo-same">igual ao esperado</span> : <code className="bad">{pairs(r.got) || (r.outcome ? `desfecho = "${r.outcome}"` : "—")}</code>}</td>
              <td className="lo-path">
                {r.stages.length ? r.stages.join(" → ") : `${r.steps} passos`}
                {r.rounds > 1 && <small> · {r.rounds} voltas</small>}
              </td>
              <td>
                <button className="btn ghost icon" onClick={() => (close(), startPlay(r.scenario, r.example))} aria-label={`Reproduzir ${r.label}`} data-tip="Reproduzir passo a passo">
                  <Glyph name="play" size={15} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
