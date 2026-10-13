import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Glyph } from "./icons";
import { LOGIC_BRANCHES, LOGIC_HTTP_METHODS, LOGIC_TRIGGER_KINDS, LOGIC_ROLES, LOGIC_ROLE_KEYS, isDataRole, type ConnectionEl, type LogicBranch, type LogicExample, type LogicNodeSpec, type LogicRequest, type LogicRole, type LogicTrigger, type LogicValue, type NodeEl } from "../shared/schema";
import { printType, recognize } from "../shared/types";
import { checkAssignment } from "../shared/typecheck";
import { FUNCTIONS, explainError, findFunctions, readsOf, checkExpr, evaluate, explain, explainStatement, parseExpr, parseStatement, SYNTAX_GUIDE } from "../shared/expr";
import { COND_OPS, COND_OP_KEYS, autoQuote, firstProblem, fromText, toText, type Cond, type CondOp, type Group, type Item as CItem } from "../shared/conditions";
import { branchLabel, caseLabel, checkExamples, dataNodes, dataTypeOf, nameProblems, outputOf, renameName, dataKey, dataNames, hasFlow, reshapeLogic, starterExample, usageOf, variableTimeline, visitedIds, type VarTrack } from "../shared/logic";
import { TextField } from "./panels";
import { PLAY_SPEEDS, getState, playGo, playLength, playToggle, run as runOps, select as selectNodes, set as setStore, setPlaySpeed, startPlay, stopPlay, toastError, useStore } from "./store";

type Patch = (p: Record<string, unknown>) => void;

/* ───────── valores nos exemplos: "dado = valor" por linha, no mesmo vocabulário das expressões ───────── */

const hasObject = (v: LogicValue | undefined): boolean => (Array.isArray(v) ? v.some(hasObject) : typeof v === "object" && v !== null);

export function showValue(v: LogicValue | undefined): string {
  // objetos não existem na sintaxe das expressões: valem como JSON (e voltam do JSON ao confirmar)
  if (hasObject(v)) return JSON.stringify(v);
  if (v === null || v === undefined) return "nulo";
  if (typeof v === "string") return JSON.stringify(v);
  if (typeof v === "boolean") return v ? "verdadeiro" : "falso";
  if (Array.isArray(v)) return `[${v.map(showValue).join(", ")}]`;
  return String(v);
}

/** Linhas "chave = valor" -> objeto. Erro na primeira linha inválida. */
export function parseValueLines(text: string): { value?: Record<string, LogicValue>; error?: string } {
  const out: Record<string, LogicValue> = {};
  for (const [i, raw] of text.split("\n").entries()) {
    const line = raw.trim();
    if (!line) continue;
    const m = /^([\p{L}_][\p{L}\p{N}_.]*)\s*=\s*(.+)$/u.exec(line);
    if (!m) return { error: `linha ${i + 1}: use "dado = valor" (ex.: total = 10.5)` };
    try {
      out[m[1]] = evaluate(parseExpr(m[2]), {}) as LogicValue;
    } catch (e) {
      try {
        if (!/^[[{]/.test(m[2].trim())) throw e;
        out[m[1]] = JSON.parse(m[2]) as LogicValue; // objeto ou lista de objetos, em JSON
      } catch {
        return { error: `linha ${i + 1}: ${(e as Error).message}` };
      }
    }
  }
  return { value: out };
}

const toLines = (o: Record<string, LogicValue>) =>
  Object.entries(o)
    .map(([k, v]) => `${k} = ${showValue(v)}`)
    .join("\n");

function ValueLines({ label, value, onChange, placeholder }: { label: string; value: Record<string, LogicValue>; onChange: (v: Record<string, LogicValue>) => void; placeholder?: string }) {
  // o que está sendo digitado: a linha inválida é recusada ao confirmar, então o erro aparece antes e ao confirmar (nunca em silêncio)
  const [draft, setDraft] = useState<string | null>(null);
  const draftErr = draft !== null ? parseValueLines(draft).error : undefined;
  return (
    <>
      <label className="field">
        <span>{label}</span>
        <TextField
          multiline
          mono
          value={toLines(value)}
          placeholder={placeholder}
          onDraft={setDraft}
          onCommit={(t, final) => {
            const r = parseValueLines(t);
            if (r.value) {
              onChange(r.value);
              setDraft(null);
            } else if (r.error && final) toastError(`Não salvei «${label}»: ${r.error}`); // o rascunho inválido fica, e o erro com ele, até corrigir
          }}
        />
      </label>
      {draftErr && (
        <div className="callout warn" role="alert">
          Ainda não salvo: {draftErr}
        </div>
      )}
    </>
  );
}

/** De onde veio um resultado que não bate: o último passo que escreveu o dado (ou o fim em que o fluxo parou), para ir direto ao nó. */
function culprits(ex: LogicExample, r: { problems: string[]; run: { steps: { rule: string; label: string; changes: { name: string }[] }[]; endId?: string } }) {
  const out: { key: string; id: string; label: string; verb: string }[] = [];
  const label = (id: string) => r.run.steps.find((s) => s.rule === id)?.label ?? id;
  for (const p of r.problems) {
    const key = p.split(":")[0];
    if (key === "desfecho" && r.run.endId) out.push({ key, id: r.run.endId, label: label(r.run.endId), verb: "O fluxo terminou em" });
    else if (key in ex.expect && key !== "caminho") {
      const st = [...r.run.steps].reverse().find((x) => x.changes.some((c) => c.name === key));
      if (st) out.push({ key, id: st.rule, label: st.label, verb: `«${key}» foi escrito por` });
    }
  }
  return out;
}

function ExamplesEditor({ node, patch }: { node: NodeEl; patch: Patch }) {
  const doc = useStore((s) => s.doc);
  const examples = node.logic!.examples ?? [];
  const results = useMemo(() => checkExamples(doc).filter((r) => r.node === node.id), [doc, node.id]);
  const set = (next: LogicExample[]) => patch({ logic: { ...node.logic, examples: next.length ? next : undefined } });
  const edit = (i: number, p: Partial<LogicExample>) => set(examples.map((x, k) => (k === i ? { ...x, ...p } : x)));
  const isScenario = node.logic!.role === "scenario";
  // sugestão com os dados do próprio diagrama: entradas = dados que nenhuma regra escreve; saídas = os que alguma escreve
  const hint = useMemo(() => {
    const written = new Set<string>();
    for (const u of usageOf(doc).values()) for (const w of u.writes) written.add(w);
    const facts = dataNodes(doc);
    const byKey = new Map(facts.map((f) => [dataKey(f), f]));
    const keys = facts.map(dataKey);
    // regra, decisão ou escolha: o que ESTE passo lê é o que o exemplo precisa informar; o que escreve é o esperado
    const u = usageOf(doc).get(node.id);
    const ins = isScenario ? facts.filter((f) => f.logic!.role === "input" || !written.has(dataKey(f))).map(dataKey).slice(0, 6) : [...(u?.reads ?? [])].slice(0, 3);
    const outs = isScenario ? facts.filter((f) => f.logic!.role === "output" || (f.logic!.role !== "input" && written.has(dataKey(f)))).map(dataKey).slice(0, 2) : [...(u?.writes ?? [])].slice(0, 2);
    // valor inicial de cada entrada: o padrão do dado, ou um neutro pelo tipo (o usuário só ajusta os números)
    const start = (k: string): LogicValue => {
      const f = byKey.get(k)?.logic;
      if (f?.value !== undefined) return f.value;
      const t = (f?.type ?? "").toLowerCase();
      return /bool|sim|flag/.test(t) ? false : /texto|string|text/.test(t) ? "" : /lista|array/.test(t) ? [] : 0;
    };
    const role = node.logic!.role;
    return {
      given: ins.map((k) => `${k} = `).join("\n"),
      expect: isScenario ? [...outs.map((k) => `${k} = `), 'desfecho = "ok"'].join("\n") : role === "rule" ? outs.map((k) => `${k} = `).join("\n") : 'caminho = "sim"',
      // exemplo novo já com as entradas do fluxo preenchidas
      blank: isScenario ? { given: starterExample(doc).given, expect: starterExample(doc).expect } : { given: Object.fromEntries(ins.map((k) => [k, start(k)])), expect: {} as Record<string, LogicValue> },
    };
  }, [doc, node.id, isScenario]);
  return (
    <div className="field">
      <span className="lbl-s">Exemplos {isScenario ? "(o fluxo inteiro)" : node.logic!.role === "rule" ? "(só esta ação)" : "(só este passo; esperado: caminho = \"sim\" ou \"nao\")"}</span>
      {examples.map((ex, i) => {
        const r = results.find((x) => x.example === ex.name);
        const out = r ? outputOf(doc, r) : undefined;
        return (
          <div key={i} className="callout ex-card" style={{ display: "grid", gap: 6 }}>
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <b style={{ color: r ? (r.ok ? "#2f9e6b" : "#d6453d") : undefined }}>{r ? (r.ok ? "✔" : "✘") : "·"}</b>
              <TextField value={ex.name} placeholder="nome do caso" onCommit={(v) => edit(i, { name: v || ex.name })} />
              <button className="btn" onClick={() => set(examples.filter((_, k) => k !== i))} aria-label="Remover exemplo">
                <Glyph name="close" size={16} />
              </button>
            </div>
            <ValueLines label="Dado" value={ex.given} placeholder={hint.given || "dado = valor"} onChange={(v) => edit(i, { given: v })} />
            <ValueLines label="Esperado" value={ex.expect} placeholder={hint.expect || "dado = valor"} onChange={(v) => edit(i, { expect: v })} />
            {out && (Object.keys(out.values).length > 0 || out.note) && (
              <div className="callout" aria-live="polite">
                <div>
                  <b>Saída obtida</b>
                  {Object.keys(out.values).length > 0 ? ": " + Object.entries(out.values).map(([k, v]) => `${k} = ${showValue(v)}`).join(" · ") : ""}
                </div>
                {out.note && <div>{out.note}</div>}
                {Object.keys(out.values).length > 0 && (
                  <button className="btn" disabled={JSON.stringify(out.values) === JSON.stringify(ex.expect)} onClick={() => edit(i, { expect: out.values })} title="Grava esta saída no campo Esperado: o exemplo passa a conferir exatamente isto">
                    Usar como esperado
                  </button>
                )}
              </div>
            )}
            {r && !r.ok && (
              <div className="callout warn">
                {r.problems.join("; ")}
                {culprits(ex, r).map((c) => (
                  <div key={c.key}>
                    <button className="btn" onClick={() => selectNodes([c.id])} title="Selecionar este passo no quadro">
                      {c.verb} «{c.label}»
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
      <button className="btn" onClick={() => set([...examples, { name: `caso ${examples.length + 1}`, given: hint.blank.given, expect: hint.blank.expect }])}>
        + Exemplo
      </button>
    </div>
  );
}

/* ───────── inspetor ───────── */

/** Funções das expressões: busca por nome, assunto ou descrição, com exemplo calculado ao vivo e «Inserir» no campo que estava em edição. */
function FunctionBrowser() {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const last = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const root = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const onIn = (e: FocusEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA") && !root.current?.contains(t) && t.closest(".inspector")) last.current = t as HTMLInputElement | HTMLTextAreaElement;
    };
    document.addEventListener("focusin", onIn);
    return () => document.removeEventListener("focusin", onIn);
  }, []);
  const rows = useMemo(
    () =>
      findFunctions(q).map((k) => {
        const f = FUNCTIONS[k];
        let out = "";
        try {
          out = showValue(evaluate(parseExpr(f.ex), {}));
        } catch {
          out = "?";
        }
        return { k, f, out };
      }),
    [q],
  );
  const insert = (name: string) => {
    const el = last.current;
    if (!el || !document.contains(el)) {
      void navigator.clipboard?.writeText(`${name}()`);
      setNote(`Copiei ${name}(): clique num campo de expressão e cole.`);
      return;
    }
    el.focus();
    document.execCommand("insertText", false, `${name}()`);
    const pos = el.selectionStart ?? 0;
    el.setSelectionRange(pos - 1, pos - 1);
    setNote(`Inseri ${name}() no campo.`);
  };
  return (
    <details className="callout fn-browser" ref={root} open={open} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary>Funções e sintaxe ({Object.keys(FUNCTIONS).length} funções)</summary>
      <input className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar: somar, lista, data, texto…" aria-label="Buscar função" style={{ margin: "8px 0 6px" }} />
      <div className="fn-list" role="list">
        {rows.map(({ k, f, out }) => (
          <div key={k} className="fn-row" role="listitem">
            <div className="fn-head">
              <code>{f.sig}</code>
              <small>{f.cat}</small>
              <button className="btn" onMouseDown={(e) => e.preventDefault()} onClick={() => insert(k)} aria-label={`Inserir ${k} no campo`}>
                Inserir
              </button>
            </div>
            <div className="fn-doc">{f.doc.replace(/`/g, "")}</div>
            <div className="fn-ex">
              <code>{f.ex}</code> → <b>{out}</b>
            </div>
          </div>
        ))}
        {!rows.length && <div className="fn-doc">Nenhuma função com «{q}». Tente «lista», «texto», «data» ou «arredondar».</div>}
      </div>
      <div className="fn-note" aria-live="polite">
        {note}
      </div>
      <pre style={{ whiteSpace: "pre-wrap", margin: "8px 0 0", font: "inherit" }}>{SYNTAX_GUIDE.split("\n").filter((l) => !l.startsWith("Funções:")).join("\n").replace(/`/g, "")}</pre>
    </details>
  );
}

export function LogicFields({ node, patch }: { node: NodeEl; patch: Patch }) {
  const doc = useStore((s) => s.doc);
  const l = node.logic!;
  const role = LOGIC_ROLES[l.role];
  const names = useMemo(() => dataNames(doc), [doc]);
  // exemplos de expressão com um dado do próprio diagrama (nada de precificação em diagrama de outro assunto)
  const sample = useMemo(() => {
    const f = doc.nodes.find((n) => n.logic?.role === "input") ?? dataNodes(doc)[0];
    return f ? dataKey(f) : "total";
  }, [doc]);
  // exemplo de EFEITO: prefere um dado que o fluxo já escreve (o resultado), não a entrada
  const effectSample = useMemo(() => {
    const written = new Set<string>();
    for (const u of usageOf(doc).values()) for (const w of u.writes) written.add(w);
    const f = doc.nodes.find((n) => (n.logic?.role === "output" || n.logic?.role === "variable") && written.has(dataKey(n))) ?? dataNodes(doc).find((n) => written.has(dataKey(n)));
    return f ? dataKey(f) : sample;
  }, [doc, sample]);
  const upd = (p: Record<string, unknown>) => {
    const next: Record<string, unknown> = { ...l, ...p };
    for (const k of Object.keys(next)) {
      const v = next[k];
      if (v === undefined || v === "" || (Array.isArray(v) && !v.length)) delete next[k];
    }
    patch({ logic: next });
  };
  return (
    <>
      <label className="field">
        <span>Papel (Logic)</span>
        <select className="input" value={l.role} onChange={(e) => patch({ logic: reshapeLogic(l, e.target.value as LogicRole), asset: undefined })}>
          {LOGIC_ROLE_KEYS.map((r) => (
            <option key={r} value={r}>
              {LOGIC_ROLES[r].label}
            </option>
          ))}
        </select>
      </label>
      <div className="callout" title={role.hint}>
        {role.hint.split(/(?<=\.)\s/)[0]}
      </div>
      {ROLE_CONTRAST[l.role] && (
        <div className="callout role-contrast">
          <b>{ROLE_CONTRAST[l.role]![0]}</b> {ROLE_CONTRAST[l.role]![1]}
        </div>
      )}
      {l.role === "rule" && (
        <>
          {!hasFlow(doc) && (
          <label className="field">
            <span>Ordem na fila</span>
            <input className="input" type="number" min={1} value={l.order ?? ""} onChange={(e) => upd({ order: e.target.value === "" ? undefined : +e.target.value })} />
          </label>
          )}
          <label className="field">
            <span>Ação em uma frase (para o negócio)</span>
            <TextField multiline value={l.text ?? ""} placeholder="O que esta ação faz, em palavras de negócio." onCommit={(v) => upd({ text: v.trim() || undefined })} />
          </label>
          <StatementsField value={l.then ?? []} example={effectSample} onCommit={(lines) => upd({ then: lines })} />
          {(l.then ?? []).map((t, i) => {
            const err = checkExpr(t, "statement");
            return (
              <div key={i} className={`callout${err ? " warn" : ""}`}>
                {err ? `${t}: ${explainError(t, err)}` : explainStatement(parseStatement(t), names)}
              </div>
            );
          })}
          <ExamplesEditor node={node} patch={patch} />
        </>
      )}
      {isDataRole(l.role) && (
        <>
          <label className="field">
            <span>Nome nas expressões</span>
            <TextField value={l.key ?? ""} placeholder={node.id.replace(/-/g, "_")} onCommit={(v) => upd({ key: v.trim() || undefined })} />
          </label>
          <TypeField value={l.type ?? ""} onCommit={(v) => upd({ type: v })} />
          <label className="field">
            <span>{l.role === "variable" ? "Valor inicial (opcional)" : "Valor fixo (opcional)"}</span>
            <TextField
              value={l.value === undefined ? "" : showValue(l.value)}
              placeholder="0.4"
              onCommit={(v) => {
                if (!v.trim()) return upd({ value: undefined });
                try {
                  upd({ value: evaluate(parseExpr(v), {}) });
                } catch {
                  /* valor inválido: mantém o anterior */
                }
              }}
            />
          </label>
          <label className="field">
            <span>Significado</span>
            <TextField multiline value={l.text ?? ""} placeholder="o que este dado representa" onCommit={(v) => upd({ text: v.trim() || undefined })} />
          </label>
        </>
      )}
      {(l.role === "decision" || l.role === "switch") && (
        <>
          <label className="field">
            <span>{l.role === "decision" ? "A pergunta em uma frase" : "O que decide o caminho (frase)"}</span>
            <TextField multiline value={l.text ?? ""} placeholder={l.role === "decision" ? "O pedido tem R$ 200 ou mais?" : "Qual a forma de pagamento?"} onCommit={(v) => upd({ text: v.trim() || undefined })} />
          </label>
          {l.role === "decision" ? (
            <ConditionField label="Condição (vale = sim)" value={l.when ?? ""} names={names} onCommit={(v) => upd({ when: v })} />
          ) : (
            <ExprField label="Expressão que escolhe o caminho" value={l.on ?? ""} names={names} placeholder={sample} onCommit={(v) => upd({ on: v })} />
          )}
          <div className="callout">
            {l.role === "decision" ? 'Ligue duas setas saindo daqui: uma "sim" e uma "não" (selecione a seta e escolha a saída).' : 'Uma seta por valor (escolha a saída "valor" na seta) e uma "outros" para o resto.'}
          </div>
          <ExamplesEditor node={node} patch={patch} />
        </>
      )}
      {l.role === "loop" && (
        <>
          <label className="field">
            <span>O que se repete (frase)</span>
            <TextField multiline value={l.text ?? ""} placeholder="Para cada item da lista, na ordem em que aparecem." onCommit={(v) => upd({ text: v.trim() || undefined })} />
          </label>
          <ExprField label="Para cada item de (lista)" value={l.foreach ?? ""} names={names} placeholder="itens" onCommit={(v) => upd({ foreach: v, ...(v && l.until === "condicao" ? { until: undefined } : {}) })} />
          {l.foreach && (
            <label className="field">
              <span>Nome do item em cada volta</span>
              <TextField value={l.as ?? ""} placeholder="item" onCommit={(v) => upd({ as: v.trim() || undefined })} />
            </label>
          )}
          <ExprField label="Para quando (condição de parada)" value={l.until ?? ""} names={names} placeholder="tentativas >= 3" onCommit={(v) => upd({ until: v })} />
          <label className="field">
            <span>No máximo (voltas)</span>
            <input className="input" type="number" min={1} max={1000} value={l.max ?? ""} onChange={(e) => upd({ max: e.target.value === "" ? undefined : +e.target.value })} />
          </label>
          <div className="callout">Duas setas saem daqui: "repete" (volta ao corpo, que depois liga de volta a este laço) e "segue" (quando termina).</div>
        </>
      )}
      {(l.role === "start" || l.role === "end" || l.role === "fork" || l.role === "join" || l.role === "call" || l.role === "code") && (
        <>
          <label className="field">
            <span>Em uma frase</span>
            <TextField multiline value={l.text ?? ""} placeholder={l.role === "start" ? "O que entra e quando começa" : l.role === "end" ? "O que a lógica devolve" : "O que acontece aqui"} onCommit={(v) => upd({ text: v.trim() || undefined })} />
          </label>
          {l.role === "start" && <TriggerFields l={l} upd={upd} />}
          {l.role === "code" && (
            <>
              <label className="field">
                <span>Código TypeScript (corpo de async (data) =&gt; {"{ … }"})</span>
                <TextField multiline mono value={l.code ?? ""} placeholder={"const total = data.itens.length;\nreturn { total };"} onCommit={(v) => v.trim() && upd({ code: v })} />
              </label>
              <MockField l={l} upd={upd} label="Resultado simulado nos exemplos (JSON)" placeholder={'{ "total": 3 }'} />
              <ExprField label="Falha simulada quando (opcional)" value={l.falha ?? ""} names={names} placeholder="resultado.total < 0" onCommit={(v) => upd({ falha: v })} />
              <StatementsField value={l.devolve ?? []} example={effectSample} onCommit={(lines) => upd({ devolve: lines })} label="O que fica nos dados (um por linha; resultado é o que o código devolveu)" />
              <div className="callout">
                <b>data</b> são os dados do fluxo e o <b>return</b> vira o dado <b>resultado</b>. Se o código lançar erro, o fluxo segue pela seta "erro". O app não executa TypeScript: nos exemplos vale o resultado simulado; no código gerado (aba Código TypeScript) roda de verdade.
              </div>
            </>
          )}
          {l.role === "call" && (
            <>
              <RequestFields l={l} names={names} upd={upd} />
              <ExprField label="Falha simulada quando (opcional)" value={l.falha ?? ""} names={names} placeholder={`${sample}_falhou`} onCommit={(v) => upd({ falha: v })} />
              <StatementsField value={l.devolve ?? []} example={effectSample} onCommit={(lines) => upd({ devolve: lines })} label="O que devolve quando dá certo (um dado por linha)" />
              <div className="callout">Para testar o caminho de erro: quando esta condição vale no exemplo, o fluxo segue pela seta "erro" (selecione a seta e escolha a saída "erro"). Sem ela, a chamada sempre dá certo.</div>
            </>
          )}
          {l.role === "end" && (
            <label className="field">
              <span>Desfecho</span>
              <select className="input" value={l.outcome ?? "ok"} onChange={(e) => upd({ outcome: e.target.value === "ok" ? undefined : e.target.value })}>
                <option value="ok">ok</option>
                <option value="erro">erro</option>
              </select>
            </label>
          )}
        </>
      )}
      {l.role === "scenario" && (
        <>
          <ScenarioPlay node={node} />
          <label className="field">
            <span>Cenário em uma frase</span>
            <TextField multiline value={l.text ?? ""} placeholder="Descreva o caso em uma frase: o que entra e o que se espera." onCommit={(v) => upd({ text: v.trim() || undefined })} />
          </label>
          <ExamplesEditor node={node} patch={patch} />
        </>
      )}
      <FunctionBrowser />
    </>
  );
}

/** Efeitos de uma ação (um por linha): a linha inválida aparece ao digitar e ao confirmar, em vez de o bloco inteiro ser recusado em silêncio. */
/** Nomes que o texto lê e que não existem no diagrama, com «Trocar por» o parecido (o erro de digitação mais comum: totl por total). */
function NameWarnings({ src, kind, onFix }: { src: string; kind: "expr" | "statement"; onFix: (next: string) => void }) {
  const doc = useStore((s) => s.doc);
  const found = useMemo(() => {
    const reads = new Set<string>();
    for (const line of kind === "statement" ? src.split(/\r?\n/) : [src]) {
      const t = line.trim();
      if (!t) continue;
      try {
        if (kind === "expr") readsOf(parseExpr(t), reads);
        else {
          const st = parseStatement(t);
          if (st.t === "assign") readsOf(st.value, reads);
        }
      } catch {
        return []; // erro de sintaxe: quem avisa é o outro aviso
      }
    }
    return nameProblems(doc, reads);
  }, [src, kind, doc]);
  if (!found.length) return null;
  return (
    <>
      {found.map((p) => (
        <div key={p.name} className="callout warn" role="alert">
          «{p.name}» não é um dado deste diagrama.
          {p.suggestion ? (
            <>
              {" "}
              Quis dizer «{p.suggestion}»?{" "}
              <button className="btn" onClick={() => onFix(renameName(src, p.name, p.suggestion!))}>
                Trocar por {p.suggestion}
              </button>
            </>
          ) : (
            " Declare um dado com esse nome ou corrija o texto."
          )}
        </div>
      ))}
    </>
  );
}

/** Atribuições que dão ao dado um valor de tipo incompatível (`total := "abc"` com `total` number). Só avisa. */
function TypeWarnings({ src }: { src: string }) {
  const doc = useStore((s) => s.doc);
  const found = useMemo(() => {
    const typeOf = dataTypeOf(doc);
    return src
      .split(String.fromCharCode(10))
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => ({ line: l, msg: checkAssignment(l, typeOf) }))
      .filter((x) => x.msg);
  }, [src, doc]);
  if (!found.length) return null;
  return (
    <>
      {found.map((x) => (
        <div key={x.line} className="callout warn" role="alert">
          Tipo: {x.msg}. Troque o valor ou o tipo do dado.
        </div>
      ))}
    </>
  );
}

const NL = String.fromCharCode(10);

function StatementsField({ value, onCommit, label = "Efeitos (um por linha)", example }: { value: string[]; onCommit: (lines: string[]) => void; label?: string; /** um dado do próprio diagrama, para o exemplo do campo */ example: string }) {
  const [draft, setDraft] = useState<string | null>(null);
  const lines = (t: string) => t.split("\n").map((x) => x.trim()).filter(Boolean);
  const firstBad = (t: string) => {
    for (const [i, line] of lines(t).entries()) {
      const e = checkExpr(line, "statement");
      if (e) return `linha ${i + 1} «${line}»: ${explainError(line, e)}`;
    }
    return undefined;
  };
  const bad = draft !== null ? firstBad(draft) : undefined;
  return (
    <>
      <label className="field">
        <span>{label}</span>
        <TextField
          multiline
          value={value.join("\n")}
          placeholder={`${example} := 0\ntravar ${example}`}
          onDraft={setDraft}
          onCommit={(t, final) => {
            const e = firstBad(t);
            if (e) final && toastError(`Não salvei «Efeitos»: ${e}`); // o rascunho inválido fica, e o erro com ele, até corrigir
            else {
              onCommit(lines(t));
              setDraft(null);
            }
          }}
        />
      </label>
      {bad && (
        <div className="callout warn" role="alert">
          Ainda não salvo: {bad}
        </div>
      )}
      {!bad && <NameWarnings src={draft ?? value.join(NL)} kind="statement" onFix={(t) => (onCommit(lines(t)), setDraft(null))} />}
      {!bad && <TypeWarnings src={draft ?? value.join(NL)} />}
    </>
  );
}

/* ───────── condições em linhas (dado | operador | valor), como os filtros do n8n ───────── */

const newCond = (): Cond => ({ k: "cond", left: "", op: "=", right: "" });

/** Campo de uma linha: confirma ao sair (ou Enter); expressão inválida fica marcada em vermelho. */
// «+ Condição» e «+ Grupo» pedem o foco no «Dado» da linha que vai nascer (poupa um clique por linha)
let focusNextDado = false;
const askDadoFocus = () => {
  focusNextDado = true;
  setTimeout(() => (focusNextDado = false), 400);
};

function Cell({ value, onCommit, placeholder, list, label }: { value: string; onCommit: (v: string) => void; placeholder?: string; list?: string; label: string }) {
  const [v, setV] = useState(value);
  const focused = useRef(false);
  const el = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!focused.current) setV(value);
  }, [value]);
  useEffect(() => {
    if (label === "Dado" && focusNextDado) {
      focusNextDado = false;
      el.current?.focus();
    }
  }, []);
  const err = v.trim() ? checkExpr(v)?.message : undefined;
  return (
    <input
      ref={el}
      className={`input cond-cell${err ? " bad" : ""}`}
      value={v}
      placeholder={placeholder}
      list={list}
      title={err}
      aria-label={label}
      aria-invalid={!!err}
      onFocus={() => (focused.current = true)}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => {
        focused.current = false;
        if (v !== value) onCommit(v);
      }}
      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
    />
  );
}

function CondRow({ c, onChange, onRemove, list }: { c: Cond; onChange: (c: Cond) => void; onRemove: () => void; list: string }) {
  const args = COND_OPS[c.op].args;
  const doc = useStore((s) => s.doc);
  // dado de texto + palavra solta no valor: vira texto entre aspas (VIP → "VIP"), pelo tipo do dado
  const quote = (v: string) => {
    const facts = new Set(dataNodes(doc).map(dataKey));
    const f = dataNodes(doc).find((n) => dataKey(n) === c.left.trim());
    return autoQuote(v, c.op, f?.logic?.type, facts);
  };
  return (
    <div className="cond-row">
      <div className="cond-line">
        <Cell label="Dado" value={c.left} placeholder="dado ou expressão" list={list} onCommit={(v) => onChange({ ...c, left: v })} />
        <button className="btn ghost icon sm" onClick={onRemove} aria-label="Remover condição">
          <Glyph name="close" size={14} />
        </button>
      </div>
      <select className="input" value={c.op} aria-label="Operador" onChange={(e) => onChange({ ...c, op: e.target.value as CondOp })}>
        {COND_OP_KEYS.map((k) => (
          <option key={k} value={k}>
            {COND_OPS[k].label}
          </option>
        ))}
      </select>
      {args >= 1 && <Cell label="Valor" value={c.right ?? ""} placeholder={c.op === "em" || c.op === "nao-em" ? '["a", "b"]' : args === 2 ? "mínimo" : "valor ou dado"} list={list} onCommit={(v) => onChange({ ...c, right: quote(v) })} />}
      {args === 2 && <Cell label="Limite de cima" value={c.right2 ?? ""} placeholder="máximo" list={list} onCommit={(v) => onChange({ ...c, right2: v })} />}
    </div>
  );
}

function GroupView({ g, onChange, onRemove, list }: { g: Group; onChange: (g: Group) => void; onRemove?: () => void; list: string }) {
  const setItem = (i: number, it: CItem) => onChange({ ...g, items: g.items.map((x, k) => (k === i ? it : x)) });
  const del = (i: number) => onChange({ ...g, items: g.items.filter((_, k) => k !== i) });
  return (
    <div className={`cond-group${onRemove ? " nested" : ""}`}>
      <div className="cond-head">
        <select
          className="input"
          value={`${g.mode}${g.not ? "-nao" : ""}`}
          aria-label="Como combinar as condições"
          onChange={(e) => {
            const [mode, not] = e.target.value.split("-");
            onChange({ ...g, mode: mode as "e" | "ou", not: not ? true : undefined });
          }}
        >
          <option value="e">Todas (E)</option>
          <option value="ou">Qualquer (OU)</option>
          <option value="ou-nao">Nenhuma delas (NÃO … OU)</option>
          <option value="e-nao">Nem todas (NÃO … E)</option>
        </select>
        {onRemove && (
          <button className="btn ghost icon sm" onClick={onRemove} aria-label="Remover grupo">
            <Glyph name="close" size={14} />
          </button>
        )}
      </div>
      {g.items.map((it, i) =>
        it.k === "group" ? (
          <GroupView key={i} g={it} list={list} onChange={(n) => setItem(i, n)} onRemove={() => del(i)} />
        ) : it.k === "raw" ? (
          <div key={i} className="cond-row">
            <div className="cond-line">
              <Cell label="Expressão" value={it.text} list={list} onCommit={(v) => setItem(i, { k: "raw", text: v })} />
              <button className="btn ghost icon sm" onClick={() => del(i)} aria-label="Remover condição">
                <Glyph name="close" size={14} />
              </button>
            </div>
          </div>
        ) : (
          <CondRow key={i} c={it} list={list} onChange={(n) => setItem(i, n)} onRemove={() => del(i)} />
        ),
      )}
      <div className="cond-add">
        <button className="btn" onClick={() => (askDadoFocus(), onChange({ ...g, items: [...g.items, newCond()] }))}>
          + Condição
        </button>
        <button className="btn" onClick={() => (askDadoFocus(), onChange({ ...g, items: [...g.items, { k: "group", mode: g.mode === "e" ? "ou" : "e", items: [newCond()] }] }))}>
          + Grupo
        </button>
      </div>
    </div>
  );
}

/**
 * Condição em linhas (dado | operador | valor) com um grupo E/OU, como os filtros do n8n. O texto da expressão continua sendo o que
 * se guarda: o editor lê esse texto como linhas e, quando todas estão completas e válidas, escreve o texto de volta.
 * Texto que não dá para ler (erro de sintaxe) cai no campo de texto.
 */
function ConditionField({ label, value, names, onCommit }: { label: string; value: string; names: Record<string, string>; onCommit: (v: string | undefined) => void }) {
  const list = useId();
  const [g, setG] = useState<Group | undefined>(() => fromText(value));
  const sent = useRef(value);
  useEffect(() => {
    if (value !== sent.current) {
      sent.current = value;
      setG(fromText(value));
    }
  }, [value]);
  if (!g) return <ExprField label={label} value={value} names={names} onCommit={onCommit} />;
  const problem = firstProblem(g);
  const change = (n: Group) => {
    setG(n);
    if (firstProblem(n)) return; // incompleta: fica na tela, não entra no diagrama
    const t = toText(n);
    if (t !== sent.current) {
      sent.current = t;
      onCommit(t || undefined);
    }
  };
  const err = value ? checkExpr(value) : undefined;
  return (
    <div className="field">
      <span>{label}</span>
      <datalist id={list}>
        {Object.keys(names).map((k) => (
          <option key={k} value={k} label={names[k]} />
        ))}
      </datalist>
      <GroupView g={g} onChange={change} list={list} />
      {problem && g.items.length > 0 && (
        <div className="callout warn" role="alert">
          Ainda não salvo: {problem}
        </div>
      )}
      {!problem && value && !err && <div className="callout">Em português: {explain(parseExpr(value), names)}</div>}
    </div>
  );
}

/** Campo de expressão com a verificação de sintaxe e a explicação em português logo abaixo. */
/** Ação e Decisão se confundem com facilidade, então cada uma diz o que a outra faz (a confusão mais comum do modo). */
const ROLE_CONTRAST: Partial<Record<LogicRole, [string, string]>> = {
  rule: ["Ação muda dados.", "Roda sempre que o fluxo chega nela e não tem condição, nem «se … entao … senao» dentro dos efeitos: para seguir por caminhos diferentes, pular a ação ou escolher entre dois valores, ponha uma Decisão antes dela."],
  decision: ["Decisão só pergunta.", "Escolhe por qual seta o fluxo sai (sim ou não) e não muda dados: ligue uma Ação em cada saída para isso."],
  switch: ["Escolha é uma Decisão com vários caminhos.", "Também não muda dados; cada saída leva a uma Ação."],
};

const TYPE_CHIPS = ["string", "number", "int", "boolean", "string[]", '"a" | "b"', "{ campo: number }"];

/** Tipo do dado, na sintaxe do TypeScript: confere ao digitar, mostra a forma normalizada e oferece os tipos mais comuns. */
function TypeField({ value, onCommit }: { value: string; onCommit: (v: string | undefined) => void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const r = recognize(draft);
  return (
    <>
      <label className="field">
        <span>Tipo (como no TypeScript)</span>
        <TextField value={value} placeholder="number, string, boolean, int, string[], { preco: number }…" onDraft={setDraft} onCommit={(v) => onCommit(v.trim() || undefined)} />
      </label>
      <div className="type-chips" role="group" aria-label="Tipos comuns">
        {TYPE_CHIPS.map((t) => (
          <button key={t} className="type-chip" aria-pressed={value === t} onClick={() => (setDraft(t), onCommit(t))}>
            <code>{t}</code>
          </button>
        ))}
      </div>
      {r && r.ok && <div className="callout">Tipo: <code>{printType(r.type)}</code>{draft.trim() !== value.trim() ? " (ainda não salvo)" : ""}</div>}
      {r && !r.ok && r.legacy && <div className="callout">«{draft.trim()}» vale só como rótulo e nada é conferido. Para validar os valores dos exemplos, escreva um tipo: number, string, boolean, int, string[]…</div>}
      {r && !r.ok && !r.legacy && (
        <div className="callout warn" role="alert">
          Tipo inválido: {r.error}
        </div>
      )}
    </>
  );
}

/** O valor simulado de um Call HTTP ou de um nó Code (JSON): é o que os exemplos usam no lugar da rede e do TypeScript. */
function MockField({ l, upd, label, placeholder }: { l: LogicNodeSpec; upd: (p: Record<string, unknown>) => void; label: string; placeholder: string }) {
  return (
    <label className="field">
      <span>{label}</span>
      <TextField
        multiline
        mono
        value={l.mock === undefined ? "" : JSON.stringify(l.mock, null, 2)}
        placeholder={placeholder}
        onCommit={(t, final) => {
          if (!t.trim()) return upd({ mock: undefined });
          try {
            upd({ mock: JSON.parse(t) });
          } catch {
            final && toastError("Não salvei: o valor simulado precisa ser um JSON válido.");
          }
        }}
      />
    </label>
  );
}

/** Gatilho do Start (estilo n8n): manual, webhook (método e caminho) ou agenda (cron). */
function TriggerFields({ l, upd }: { l: LogicNodeSpec; upd: (p: Record<string, unknown>) => void }) {
  const t: LogicTrigger = l.trigger ?? { kind: "manual" };
  const set = (next: LogicTrigger) => upd({ trigger: next.kind === "manual" ? undefined : next });
  const kinds = Object.keys(LOGIC_TRIGGER_KINDS) as LogicTrigger["kind"][];
  const cronBad = t.kind === "agenda" && !/^\s*(\S+\s+){4}\S+\s*$/.test(t.cron ?? "");
  return (
    <>
      <label className="field">
        <span>Gatilho (o que dispara o fluxo)</span>
        <select
          className="input"
          value={t.kind}
          onChange={(e) => {
            const kind = e.target.value as LogicTrigger["kind"];
            set(kind === "webhook" ? { kind, method: "POST", path: "/fluxo" } : kind === "agenda" ? { kind, cron: "0 8 * * 1-5" } : { kind });
          }}
        >
          {kinds.map((k) => (
            <option key={k} value={k}>
              {k === "manual" ? "Manual" : k === "webhook" ? "Webhook (chamada HTTP)" : "Agenda (cron)"}
            </option>
          ))}
        </select>
      </label>
      {t.kind === "webhook" && (
        <div className="row" style={{ gap: 8 }}>
          <label className="field" style={{ width: 110 }}>
            <span>Método</span>
            <select className="input" value={t.method ?? "POST"} onChange={(e) => set({ ...t, method: e.target.value as LogicTrigger["method"] })}>
              {LOGIC_HTTP_METHODS.map((m) => (
                <option key={m}>{m}</option>
              ))}
            </select>
          </label>
          <label className="field" style={{ flex: 1 }}>
            <span>Caminho</span>
            <TextField
              value={t.path ?? ""}
              placeholder="/pedidos"
              onCommit={(v, final) => {
                if (!/^\/[A-Za-z0-9_\-/:.]*$/.test(v.trim())) return final && toastError('Não salvei: o caminho começa com "/" (ex.: /pedidos).');
                set({ ...t, path: v.trim() });
              }}
            />
          </label>
        </div>
      )}
      {t.kind === "agenda" && (
        <>
          <label className="field">
            <span>Cron (minuto hora dia mês dia-da-semana)</span>
            <TextField
              mono
              value={t.cron ?? ""}
              placeholder="0 8 * * 1-5"
              onCommit={(v, final) => {
                if (!/^\s*(\S+\s+){4}\S+\s*$/.test(v)) return final && toastError('Não salvei: o cron tem 5 campos separados por espaço (ex.: "0 8 * * 1-5" = dias úteis às 8h).');
                set({ ...t, cron: v.trim() });
              }}
            />
          </label>
          {cronBad && <div className="callout warn">O cron precisa de 5 campos.</div>}
        </>
      )}
      <div className="callout">{LOGIC_TRIGGER_KINDS[t.kind]} O código gerado traz {t.kind === "webhook" ? "o handler(req)" : t.kind === "agenda" ? "o onSchedule()" : "o run(input)"} pronto.</div>
    </>
  );
}

/** Chamada HTTP de verdade (estilo «HTTP Request» do n8n): método, endereço, cabeçalhos, corpo e a resposta simulada dos exemplos. */
function RequestFields({ l, names, upd }: { l: LogicNodeSpec; names: Record<string, string>; upd: (p: Record<string, unknown>) => void }) {
  const r = l.request;
  const setReq = (p: Partial<LogicRequest>) => upd({ request: { ...r!, ...p } });
  if (!r)
    return (
      <div className="callout">
        Esta chamada é só um ponto do fluxo (simulada pelo app).{" "}
        <button className="btn" onClick={() => upd({ request: { method: "GET", url: '"https://api.exemplo.com/"' } })} data-tip="O código gerado (aba Código TypeScript) faz um fetch de verdade; a resposta fica em «resposta» e «status_http».">
          Transformar em chamada HTTP
        </button>
      </div>
    );
  const pairsText = (m?: Record<string, string>) => Object.entries(m ?? {}).map(([k, v]) => `${k}: ${v}`).join("\n");
  const parsePairs = (t: string): Record<string, string> | string => {
    const out: Record<string, string> = {};
    for (const [i, line] of t.split("\n").map((x) => x.trim()).entries()) {
      if (!line) continue;
      const at = line.indexOf(":");
      if (at < 1) return `linha ${i + 1} «${line}»: use nome: expressão`;
      const name = line.slice(0, at).trim();
      const expr = line.slice(at + 1).trim();
      const bad = checkExpr(expr);
      if (bad) return `linha ${i + 1} «${line}»: ${explainError(expr, bad)}`;
      out[name] = expr;
    }
    return out;
  };
  const pairs = (label: string, key: "headers" | "body", placeholder: string) => (
    <label className="field">
      <span>{label}</span>
      <TextField
        multiline
        mono
        value={pairsText(r[key])}
        placeholder={placeholder}
        onCommit={(t, final) => {
          const p = parsePairs(t);
          if (typeof p === "string") return final && toastError(`Não salvei: ${p}`);
          setReq({ [key]: Object.keys(p).length ? p : undefined });
        }}
      />
    </label>
  );
  return (
    <>
      <div className="row" style={{ gap: 8 }}>
        <label className="field" style={{ width: 110 }}>
          <span>Método</span>
          <select className="input" value={r.method} onChange={(e) => setReq({ method: e.target.value as LogicRequest["method"], ...(e.target.value === "GET" || e.target.value === "DELETE" ? { body: undefined } : {}) })}>
            {LOGIC_HTTP_METHODS.map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
        </label>
        <button className="btn ghost" style={{ alignSelf: "end" }} onClick={() => upd({ request: undefined, mock: undefined })} data-tip="Volta a ser uma chamada simulada, sem HTTP">
          Remover HTTP
        </button>
      </div>
      <ExprField label="Endereço (expressão; texto fixo leva aspas)" value={r.url} names={names} placeholder={'"https://api.exemplo.com/clientes/" + cliente_id'} onCommit={(v) => v && setReq({ url: v })} />
      {pairs("Cabeçalhos (nome: expressão, um por linha)", "headers", 'Authorization: "Bearer " + token')}
      {r.method !== "GET" && r.method !== "DELETE" && pairs("Corpo JSON (campo: expressão, um por linha)", "body", "valor: total")}
      <MockField l={l} upd={upd} label="Resposta simulada nos exemplos (JSON)" placeholder={'{ "cidade": "São Paulo" }'} />
      <div className="callout">
        A resposta fica nos dados <b>resposta</b> (o corpo) e <b>status_http</b>. Fora de 2xx ou sem rede, o fluxo segue pela seta "erro". No app a chamada usa a resposta simulada; no código gerado ela é um <code>fetch</code> de verdade.
      </div>
    </>
  );
}

function ExprField({ label, value, names, placeholder, onCommit }: { label: string; value: string; names: Record<string, string>; placeholder?: string; onCommit: (v: string | undefined) => void }) {
  const err = value ? checkExpr(value) : undefined;
  // o que está sendo digitado (ainda não salvo): a expressão inválida é recusada ao confirmar, então o erro tem de aparecer antes
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const draftErr = draft.trim() && draft !== value ? checkExpr(draft) : undefined;
  return (
    <>
      <label className="field">
        <span>{label}</span>
        <TextField
          value={value}
          placeholder={placeholder}
          onDraft={setDraft}
          onCommit={(v, final) => {
            const bad = v.trim() ? checkExpr(v) : undefined;
            if (bad) return final && toastError(`Não salvei: ${explainError(v, bad)}. A expressão continua «${value || "vazia"}».`);
            onCommit(v.trim() || undefined);
          }}
        />
      </label>
      {draftErr ? (
        <div className="callout warn" role="alert">
          Ainda não salvo: {explainError(draft, draftErr)}
        </div>
      ) : (
        <>
          {err && <div className="callout warn">{explainError(value, err)}</div>}
          {value && !err && <div className="callout">Em português: {explain(parseExpr(value), names)}</div>}
          {value && !err && <NameWarnings src={value} kind="expr" onFix={(t) => onCommit(t)} />}
        </>
      )}
    </>
  );
}

/** Seta do fluxo (modo Logic): por qual saída ela sai da decisão, escolha ou laço. */
export function LogicConnFields({ conn, patch }: { conn: ConnectionEl; patch: Patch }) {
  const doc = useStore((s) => s.doc);
  const from = doc.nodes.find((n) => n.id === conn.from);
  const role = from?.logic?.role;
  const names = useMemo(() => dataNames(doc), [doc]);
  const byCondition = role === "switch" && !from?.logic?.on; // sem «o que decide»: cada seta leva uma condição (faixa)
  // a seta recém-criada de uma escolha traz um caso provisório: já abre nele, selecionado, para digitar por cima
  const wrap = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const c = conn.logic?.case;
    if (c === undefined || !/^(condicao\d*|"valor\d*")$/.test(c)) return;
    // o campo só recebe o valor da seta nova depois deste efeito: espera ele aparecer para então selecionar (senão o texto digitado se soma ao provisório)
    let tries = 0;
    const t = window.setInterval(() => {
      const i = wrap.current?.querySelector("input");
      if (i && i.value === c) {
        i.focus();
        i.select();
        window.clearInterval(t);
      } else if (++tries > 20) window.clearInterval(t);
    }, 25);
    return () => window.clearInterval(t);
  }, [conn.id]);
  if (!role) return null;
  const branches = (Object.keys(LOGIC_BRANCHES) as LogicBranch[]).filter((b) => LOGIC_BRANCHES[b].from.includes(role));
  const cur = conn.logic?.case !== undefined ? "case" : conn.logic?.branch ?? "";
  const set = (v: string) => {
    if (!v) return patch({ logic: null, label: "" });
    if (v === "case") return patch({ logic: { case: conn.logic?.case ?? (byCondition ? "condicao" : '"valor"') }, label: undefined });
    patch({ logic: { branch: v }, label: undefined });
  };
  if (!branches.length && role !== "switch") return <div className="callout">Seta simples: o fluxo segue para o próximo passo.</div>;
  return (
    <>
      <label className="field">
        <span>Saída de {LOGIC_ROLES[role].label}</span>
        <select className="input" value={cur} onChange={(e) => set(e.target.value)}>
          <option value="">— seta simples —</option>
          {branches.map((b) => (
            <option key={b} value={b}>
              {LOGIC_BRANCHES[b].label}
            </option>
          ))}
          {role === "switch" && <option value="case">{byCondition ? "condição (faixa)" : "valor (caso)"}</option>}
        </select>
      </label>
      {cur && cur !== "case" && <div className="callout">{LOGIC_BRANCHES[cur as LogicBranch].hint}</div>}
      {cur === "case" && (
        <div ref={wrap}>
          <ExprField
            label={byCondition ? "Condição desta faixa (vale a primeira verdadeira, na ordem em que as setas foram criadas)" : "Valor deste caso"}
            value={conn.logic?.case ?? ""}
            names={names}
            placeholder={byCondition ? "total <= 100" : '"lucro"'}
            onCommit={(v) => v && patch({ logic: { case: v.trim() }, label: undefined })}
          />
        </div>
      )}
      {conn.logic && <div className="callout">Rótulo no quadro: <b>{conn.logic.case !== undefined ? caseLabel(doc, conn.from, conn.logic.case) : branchLabel(conn.logic)}</b></div>}
    </>
  );
}

const fmt = (v: unknown): string => (v === undefined ? "sem valor" : typeof v === "number" ? String(Math.round(v * 1e6) / 1e6).replace(".", ",") : v === null ? "vazio" : typeof v === "boolean" ? (v ? "sim" : "não") : typeof v === "string" ? `"${v}"` : Array.isArray(v) ? `lista de ${v.length}` : "objeto");

/** Painel do modo Logic: reproduz um cenário passo a passo, com o caminho aceso no quadro. */
/** Linha do tempo das variáveis: escolhe uma variável e mostra cada alteração, do valor inicial ao final. */
function VarTimeline({ run, k }: { run: Parameters<typeof variableTimeline>[0]; k: number }) {
  const tracks = useMemo(() => variableTimeline(run), [run]);
  const [pick, setPick] = useState<string>();
  if (!tracks.length) return <div className="lp-empty">Nenhuma variável mudou neste cenário.</div>;
  const t: VarTrack = tracks.find((x) => x.name === pick) ?? tracks[0];
  const nums = [t.initial, ...t.events.map((e) => e.to)].filter((v): v is number => typeof v === "number");
  const allNum = nums.length >= 2 && nums.length === t.events.length + (typeof t.initial === "number" ? 1 : 0);
  const lo = Math.min(...nums);
  const hi = Math.max(...nums);
  const W = 260;
  const H = 44;
  const pts = allNum ? nums.map((v, i) => [nums.length === 1 ? W / 2 : 6 + (i * (W - 12)) / (nums.length - 1), hi === lo ? H / 2 : H - 6 - ((v - lo) / (hi - lo)) * (H - 12)]) : [];
  const off = typeof t.initial === "number" ? 0 : 1; // sem valor inicial, o 1º ponto já é o 1º evento
  const reached = t.events.filter((e) => e.step <= k).length;
  const same = (e: { from: unknown; to: unknown }) => JSON.stringify(e.from) === JSON.stringify(e.to);
  const changes = t.events.filter((e) => !same(e)).length;
  /** valor da variável no passo atual */
  const valueAt = (x: VarTrack) => x.events.filter((e) => e.step <= k).at(-1)?.to ?? x.initial;
  return (
    <div className="lp-vars">
      <div className="lp-chips" role="group" aria-label="Variável">
        {tracks.map((x) => (
          <button key={x.name} aria-pressed={x === t} className={`var-chip${x === t ? " on" : ""}`} onClick={() => setPick(x.name)} data-tip={`${x.events.filter((e) => JSON.stringify(e.from) !== JSON.stringify(e.to)).length} alteração(ões) no cenário`}>
            {x.name.replace(/_/g, " ")} <small>{fmt(valueAt(x))}</small>
          </button>
        ))}
      </div>
      <div className="lp-vsum">
        <div className="lp-vname">{t.name.replace(/_/g, " ")}</div>
        <div className="lp-vflow">
          <code className="vp muted">{fmt(t.initial)}</code>
          <span aria-hidden>→</span>
          <code className="vp">{fmt(t.final)}</code>
          <span className="lp-vcount">
            {changes} {changes === 1 ? "alteração" : "alterações"}
          </span>
        </div>
        {t.blockedAt.length > 0 && <div className="lp-vwarn">{t.blockedAt.length} tentativa(s) bloqueada(s) por trava</div>}
      </div>
      {allNum && (
        <svg className="lp-spark" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Evolução de ${t.name}: de ${fmt(t.initial)} a ${fmt(t.final)}`}>
          <polyline points={pts.map((p) => p.join(",")).join(" ")} fill="none" stroke="currentColor" strokeWidth="1.6" opacity="0.5" />
          {pts.map((p, i) => (
            <circle key={i} cx={p[0]} cy={p[1]} r={3} className={i - (off ? 0 : 1) < reached ? "hit" : ""} />
          ))}
          {pts.length <= 8 &&
            pts.map((p, i) => (
              <text key={`t${i}`} x={p[0]} y={p[1] < 16 ? p[1] + 14 : p[1] - 7} textAnchor={i === 0 ? "start" : i === pts.length - 1 ? "end" : "middle"}>
                {fmt(nums[i])}
              </text>
            ))}
        </svg>
      )}
      <ol className="lp-vlist" aria-label="Alterações">
        <li className="start done">
          <i />
          <span className="lp-vrow">
            <small>valor inicial</small>
            <code className="vp muted">{fmt(t.initial)}</code>
          </span>
        </li>
        {t.events.map((e, i) => (
          <li key={i} className={`${e.step === k ? "on" : ""}${e.step <= k ? " done" : ""}${same(e) ? " same" : ""}`} role="button" tabIndex={0} aria-label={`Ir ao passo ${e.step + 1}`} onClick={() => playGo(e.step)} onKeyDown={(ev) => (ev.key === "Enter" || ev.key === " ") && (ev.preventDefault(), playGo(e.step))}>
            <i />
            <span className="lp-vrow">
              <span className="lp-vchg">
                {same(e) ? (
                  <>
                    <code className="vp">{fmt(e.to)}</code>
                    <em>sem mudança</em>
                  </>
                ) : (
                  <>
                    <code className="vp muted">{fmt(e.from)}</code>
                    <span aria-hidden>→</span>
                    <code className="vp">{fmt(e.to)}</code>
                  </>
                )}
              </span>
              <small>
                passo {e.step + 1} · {e.label}
                {e.turn !== undefined ? ` · volta ${e.turn}` : ""}
              </small>
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function PlayPanel() {
  const play = useStore((s) => s.play);
  const sidePanel = useStore((s) => s.panel === "files" || s.panel === "assets");
  const present = useStore((s) => s.present);
  const hasInspector = useStore((s) => s.sel.length > 0);
  const speed = useStore((s) => s.playSpeed);
  const doc = useStore((s) => s.doc);
  const steps = useMemo(() => (play ? play.run.steps.filter((s) => s.rule) : []), [play]);
  const [tab, setTab] = useState<"steps" | "vars">("steps");
  // recolhido: só os controles e o passo atual, para ver o desenho inteiro
  const [min, setMin] = useState(false);
  const cur = play ? steps[play.k] : undefined;
  const node = cur ? doc.nodes.find((n) => n.id === cur.rule) : undefined;
  // a câmera acompanha o passo atual
  useEffect(() => {
    if (!node) return;
    const svg = document.querySelector("svg.canvas") as SVGSVGElement | null;
    if (!svg) return;
    const r = svg.getBoundingClientRect();
    const z = Math.max(0.55, Math.min(1, getState().view.z));
    // centraliza o passo na área livre acima do painel (altura real), em vez de uma fração fixa da tela
    const panel = document.querySelector(".logic-play-panel")?.getBoundingClientRect();
    const free = panel ? Math.max(160, panel.top - r.top) : r.height * 0.72;
    setStore({ view: { z, x: r.width / 2 - (node.x + node.w / 2) * z, y: free / 2 - (node.y + node.h / 2) * z } });
  }, [node?.id, play?.k, min]);
  // ← → passam os passos (fora de campos de texto); a linha atual acompanha na lista
  const k = play?.k;
  const len = play ? playLength(play) : 0;
  useEffect(() => {
    if (k === undefined) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.altKey || e.ctrlKey || e.metaKey || t?.closest("input, textarea, select, [contenteditable]")) return;
      if (e.key === "ArrowRight" && k < len - 1) (e.preventDefault(), e.stopImmediatePropagation(), playGo(k + 1));
      else if (e.key === "ArrowLeft" && k > 0) (e.preventDefault(), e.stopImmediatePropagation(), playGo(k - 1));
    };
    // captura: antes do atalho global que empurra o nó selecionado com as setas
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [k, len]);
  useEffect(() => {
    document.querySelector(".lp-row.on")?.scrollIntoView({ block: "nearest" });
  }, [k]);
  if (!play || !cur) return null;
  const sc = doc.nodes.find((n) => n.id === play.scenario);
  const ex = sc?.logic?.examples?.[play.example];
  const result = checkExamples(doc).find((r) => r.node === play.scenario && r.example === ex?.name);
  const last = playLength(play) - 1;
  const roleName = (r?: string) => (r === "end" ? "Fim" : r === "start" ? "Início" : r && r in LOGIC_ROLES ? LOGIC_ROLES[r as LogicRole].label : "");
  const role = roleName(node?.logic?.role);
  const roleMark: Record<string, string> = { decision: "◆", switch: "◆", loop: "↻", end: "■", start: "●", call: "↗", code: "{ }" };
  const text = (() => {
    if (cur.error) return `Erro: ${cur.error}`;
    if (cur.role === "decision") return `Respondeu ${cur.branch === "sim" ? "sim" : "não"}: o fluxo segue pela seta "${cur.branch === "sim" ? "sim" : "não"}".`;
    if (cur.role === "switch") return `O valor caiu no caso ${cur.branch === "outros" ? "“outros”" : cur.branch}.`;
    if (cur.role === "loop") return cur.branch === "repete" ? `Volta ${cur.turn}: repete o corpo do laço.` : "Terminou as repetições e segue.";
    if (cur.role === "code") return cur.branch === "erro" ? 'O código falhou: o fluxo segue pela seta "erro".' : "O código rodou: o fluxo segue.";
    if (cur.role === "call") return cur.branch === "erro" ? 'A chamada falhou: o fluxo segue pela seta "erro".' : "A chamada deu certo: o fluxo segue.";
    if (cur.role === "end") return play.run.outcome === "erro" ? "Fim com erro." : "";
    if (cur.role === "start") return "O fluxo começa com os dados do cenário.";
    if (cur.role === "rule" && !cur.applied) return "A condição da ação não valeu: nada mudou.";
    return "";
  })();
  const saved = ex?.path && JSON.stringify(ex.path) === JSON.stringify(visitedIds(play.run));
  return (
    <div className={`glass logic-play-panel${sidePanel ? " beside-panel" : ""}${hasInspector && !present ? " with-inspector" : ""}${present ? " present" : ""}${min ? " min" : ""}`} role="region" aria-label="Reprodução do cenário">
      <div className="lp-head">
        <div className="lp-title">
          {sc?.label}
          {ex?.name && ex.name !== sc?.label && !sc?.label?.includes(ex.name) && <small>{ex.name}</small>}
        </div>
        <div className="lp-ctl">
          <button className="btn ghost" onClick={() => playGo(0)} aria-label="Voltar ao início" data-tip="Início">
            <Glyph name="skip-start" size={16} />
          </button>
          <button className="btn ghost" onClick={() => playGo(play.k - 1)} aria-label="Passo anterior" data-tip="Passo anterior (←)">
            <Glyph name="step-back" size={16} />
          </button>
          <button className="btn primary" onClick={playToggle} aria-label={play.playing ? "Pausar" : "Reproduzir"} data-tip={play.playing ? "Pausar" : "Reproduzir"}>
            <Glyph name={play.playing ? "pause" : "play"} size={16} />
          </button>
          <button className="btn ghost" onClick={() => playGo(play.k + 1)} aria-label="Próximo passo" data-tip="Próximo passo (→)">
            <Glyph name="step-fwd" size={16} />
          </button>
          <button className="btn ghost" onClick={() => playGo(last)} aria-label="Ir ao fim" data-tip="Fim">
            <Glyph name="skip-end" size={16} />
          </button>
        </div>
        <label className="lp-speed" data-tip="Velocidade da reprodução" data-tip-pos="top">
          <span>Velocidade</span>
          <select className="input" value={speed} onChange={(e) => setPlaySpeed(+e.target.value)} aria-label="Velocidade da reprodução">
            {PLAY_SPEEDS.map((v) => (
              <option key={v} value={v}>
                {v === 1 ? "1x (normal)" : `${String(v).replace(".", ",")}x`}
              </option>
            ))}
          </select>
        </label>
        {saved ? (
          <span className="lp-saved" data-tip="Este caminho já está gravado no cenário: se o fluxo mudar e passar por outro lugar, o exemplo avisa">
            ✔ Caminho gravado
          </span>
        ) : (
          <button className="btn" onClick={() => sc && ex && runOps([{ op: "update", id: sc.id, patch: { logic: { ...sc.logic, examples: sc.logic!.examples!.map((e, i) => (i === play.example ? { ...e, path: visitedIds(play.run) } : e)) } } }])} data-tip="Grava este caminho no cenário: se o fluxo mudar e passar por outro lugar, o exemplo avisa">
            Gravar caminho
          </button>
        )}
        <span className="lp-win">
          <button className="btn ghost icon lp-min" onClick={() => setMin(!min)} aria-expanded={!min} aria-label={min ? "Expandir o painel" : "Recolher o painel"} data-tip={min ? "Expandir" : "Recolher: ver o desenho inteiro"}>
            <Glyph name="chevron" size={16} />
          </button>
          <button className="btn ghost icon" onClick={stopPlay} aria-label="Fechar a reprodução" data-tip="Fechar">
            ×
          </button>
        </span>
      </div>
      {last < 60 ? (
        <div className="lp-bar segs" role="group" aria-label={`Progresso: passo ${play.k + 1} de ${last + 1}`}>
          {Array.from({ length: last + 1 }, (_, i) => (
            <button key={i} className={i <= play.k ? "on" : ""} onClick={() => playGo(i)} aria-label={`Ir ao passo ${i + 1}`} aria-current={i === play.k ? "step" : undefined} />
          ))}
        </div>
      ) : (
        <div className="lp-bar" role="progressbar" aria-label="Progresso do cenário" aria-valuemin={1} aria-valuemax={last + 1} aria-valuenow={play.k + 1}>
          <i style={{ width: `${((play.k + 1) / (last + 1)) * 100}%` }} />
        </div>
      )}
      <div className="lp-now" aria-live="polite">
        <b>
          Passo {play.k + 1} de {last + 1} · {role} {cur.label}
        </b>
        {text && <div>{text}</div>}
        {cur.changes.map((c, i) => (
          <span key={i} className="lp-chg">
            {c.name.replace(/_/g, " ")}: {fmt(c.from)} → {fmt(c.to)}
          </span>
        ))}
        {cur.locked.length > 0 && <span className="lp-chg">trava {cur.locked.join(", ")}</span>}
        {cur.blocked.length > 0 && <span className="lp-chg">travado, não mudou: {cur.blocked.join(", ")}</span>}
        {play.k === last && result && <div className={`lp-verdict ${result.ok ? "ok" : "fail"}`}>{result.ok ? "✔ O resultado bate com o esperado." : `✘ ${result.problems.join("; ")}`}</div>}
      </div>
      <div className="play-tabs" role="tablist" aria-label="O que mostrar">
        <button role="tab" aria-selected={tab === "steps"} className={tab === "steps" ? "on" : ""} onClick={() => setTab("steps")}>
          Passos
        </button>
        <button role="tab" aria-selected={tab === "vars"} className={tab === "vars" ? "on" : ""} onClick={() => setTab("vars")} data-tip="Cada variável do valor inicial ao final, com todas as alterações">
          Variáveis
        </button>
      </div>
      <div className="lp-cols">
        <div className={`lp-col${tab === "steps" ? " active" : ""}`}>
          <div className="lp-col-title">Passos</div>
          <div className="lp-list">
            {steps.map((s, i) => (
          <div key={i} className={`lp-row${i === play.k ? " on" : ""}${i < play.k ? " done" : ""}`} role="button" tabIndex={0} aria-current={i === play.k ? "step" : undefined} onClick={() => playGo(i)} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), playGo(i))}>
              <i>{i + 1}</i>
              <span className={`lp-kind ${s.role}`} aria-label={roleName(s.role)} data-tip={roleName(s.role)}>
                {roleMark[s.role] ?? "▪"}
              </span>
              <span>
                {s.label}
                {s.branch && <em className={`lp-ans ${s.branch}`}>{s.branch === "nao" ? "não" : s.branch}</em>}
                {s.changes.length ? ` · ${s.changes.map((c) => `${c.name.replace(/_/g, " ")} ${fmt(c.to)}`).join(", ")}` : ""}
              </span>
            </div>
            ))}
          </div>
          <div className="lp-hint" aria-hidden>
            <kbd>←</kbd> <kbd>→</kbd> passo a passo · clique numa linha para pular até ela
          </div>
        </div>
        <div className={`lp-col${tab === "vars" ? " active" : ""}`}>
          <div className="lp-col-title">Variáveis</div>
          <div className="lp-list">
            <VarTimeline run={play.run} k={play.k} />
          </div>
        </div>
      </div>
    </div>
  );
}

/** Botões de reprodução de um cenário no inspetor. */
export function ScenarioPlay({ node }: { node: NodeEl }) {
  const examples = node.logic?.examples ?? [];
  if (!examples.length) return null;
  return (
    <div className="field">
      <span className="lbl-s">Reproduzir o caminho</span>
      {examples.map((e, i) => (
        <button key={i} className="btn" onClick={() => startPlay(node.id, i)} style={{ justifyContent: "flex-start" }}>
          <Glyph name="play" size={14} /> {e.name}
          {e.path ? ` · ${e.path.length} passos gravados` : ""}
        </button>
      ))}
    </div>
  );
}
