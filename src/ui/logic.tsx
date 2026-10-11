import { useEffect, useMemo } from "react";
import { Glyph } from "./icons";
import { LOGIC_BRANCHES, LOGIC_ROLES, LOGIC_ROLE_KEYS, type ConnectionEl, type LogicBranch, type LogicExample, type LogicRole, type LogicValue, type NodeEl } from "../shared/schema";
import { checkExpr, evaluate, explain, explainStatement, parseExpr, parseStatement, SYNTAX_GUIDE } from "../shared/expr";
import { branchLabel, checkExamples, factNames, reshapeLogic, visitedIds } from "../shared/logic";
import { TextField } from "./panels";
import { PLAY_SPEEDS, getState, playGo, playLength, playToggle, run as runOps, set as setStore, setPlaySpeed, startPlay, stopPlay, useStore } from "./store";

type Patch = (p: Record<string, unknown>) => void;

/* ───────── valores nos exemplos: "dado = valor" por linha, no mesmo vocabulário das expressões ───────── */

export function showValue(v: LogicValue | undefined): string {
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
    if (!m) return { error: `linha ${i + 1}: use "dado = valor" (ex.: preco = 10.5)` };
    try {
      out[m[1]] = evaluate(parseExpr(m[2]), {}) as LogicValue;
    } catch (e) {
      return { error: `linha ${i + 1}: ${(e as Error).message}` };
    }
  }
  return { value: out };
}

const toLines = (o: Record<string, LogicValue>) =>
  Object.entries(o)
    .map(([k, v]) => `${k} = ${showValue(v)}`)
    .join("\n");

function ValueLines({ label, value, onChange, placeholder }: { label: string; value: Record<string, LogicValue>; onChange: (v: Record<string, LogicValue>) => void; placeholder?: string }) {
  return (
    <label className="field">
      <span>{label}</span>
      <TextField
        multiline
        value={toLines(value)}
        placeholder={placeholder}
        onCommit={(t) => {
          const r = parseValueLines(t);
          if (r.value) onChange(r.value);
        }}
      />
    </label>
  );
}

function ExamplesEditor({ node, patch }: { node: NodeEl; patch: Patch }) {
  const doc = useStore((s) => s.doc);
  const examples = node.logic!.examples ?? [];
  const results = useMemo(() => checkExamples(doc).filter((r) => r.node === node.id), [doc, node.id]);
  const set = (next: LogicExample[]) => patch({ logic: { ...node.logic, examples: next.length ? next : undefined } });
  const edit = (i: number, p: Partial<LogicExample>) => set(examples.map((x, k) => (k === i ? { ...x, ...p } : x)));
  const isScenario = node.logic!.role === "scenario";
  return (
    <div className="field">
      <span className="lbl-s">Exemplos {isScenario ? "(o fluxo inteiro)" : node.logic!.role === "rule" ? "(só esta regra)" : "(só este passo; esperado: caminho = \"sim\" ou \"nao\")"}</span>
      {examples.map((ex, i) => {
        const r = results.find((x) => x.example === ex.name);
        return (
          <div key={i} className="callout" style={{ display: "grid", gap: 6 }}>
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <b style={{ color: r ? (r.ok ? "#2f9e6b" : "#d6453d") : undefined }}>{r ? (r.ok ? "✔" : "✘") : "·"}</b>
              <TextField value={ex.name} placeholder="nome do caso" onCommit={(v) => edit(i, { name: v || ex.name })} />
              <button className="btn" onClick={() => set(examples.filter((_, k) => k !== i))} aria-label="Remover exemplo">
                <Glyph name="close" size={16} />
              </button>
            </div>
            <ValueLines label="Dado" value={ex.given} placeholder={"preco = 80\nmarca_propria = verdadeiro"} onChange={(v) => edit(i, { given: v })} />
            <ValueLines label="Esperado" value={ex.expect} placeholder="preco = 70" onChange={(v) => edit(i, { expect: v })} />
            {r && !r.ok && <div className="callout warn">{r.problems.join("; ")}</div>}
          </div>
        );
      })}
      <button className="btn" onClick={() => set([...examples, { name: `caso ${examples.length + 1}`, given: {}, expect: {} }])}>
        + Exemplo
      </button>
    </div>
  );
}

/* ───────── inspetor ───────── */

export function LogicFields({ node, patch }: { node: NodeEl; patch: Patch }) {
  const doc = useStore((s) => s.doc);
  const l = node.logic!;
  const role = LOGIC_ROLES[l.role];
  const names = useMemo(() => factNames(doc), [doc]);
  const upd = (p: Record<string, unknown>) => {
    const next: Record<string, unknown> = { ...l, ...p };
    for (const k of Object.keys(next)) {
      const v = next[k];
      if (v === undefined || v === "" || (Array.isArray(v) && !v.length)) delete next[k];
    }
    patch({ logic: next });
  };
  const whenErr = l.when ? checkExpr(l.when) : undefined;
  let whenText = "";
  if (l.when && !whenErr) whenText = explain(parseExpr(l.when), names);
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
      <div className="callout">{role.hint}</div>
      {l.role === "rule" && (
        <>
          <label className="field">
            <span>Ordem na fila</span>
            <input className="input" type="number" min={1} value={l.order ?? ""} onChange={(e) => upd({ order: e.target.value === "" ? undefined : +e.target.value })} />
          </label>
          <label className="field">
            <span>Regra em uma frase (para o negócio)</span>
            <TextField multiline value={l.text ?? ""} placeholder="Marca própria volta ao preço atual e fica travada." onCommit={(v) => upd({ text: v.trim() || undefined })} />
          </label>
          <label className="field">
            <span>Quando vale (vazio = sempre)</span>
            <TextField value={l.when ?? ""} placeholder='tipo em ["imagem", "trafego"] e preco < 10' onCommit={(v) => upd({ when: v.trim() || undefined })} />
          </label>
          {whenErr && <div className="callout warn">{whenErr.message}</div>}
          {whenText && <div className="callout">Em português: {whenText}</div>}
          <label className="field">
            <span>Então (um efeito por linha)</span>
            <TextField multiline value={(l.then ?? []).join("\n")} placeholder={"preco := max(preco, piso)\ntravar preco"} onCommit={(v) => upd({ then: v.split("\n").map((s) => s.trim()).filter(Boolean) })} />
          </label>
          {(l.then ?? []).map((t, i) => {
            const err = checkExpr(t, "statement");
            return (
              <div key={i} className={`callout${err ? " warn" : ""}`}>
                {err ? `${t}: ${err.message}` : explainStatement(parseStatement(t), names)}
              </div>
            );
          })}
          <ExamplesEditor node={node} patch={patch} />
        </>
      )}
      {l.role === "fact" && (
        <>
          <label className="field">
            <span>Nome nas expressões</span>
            <TextField value={l.key ?? ""} placeholder={node.id.replace(/-/g, "_")} onCommit={(v) => upd({ key: v.trim() || undefined })} />
          </label>
          <label className="field">
            <span>Tipo</span>
            <TextField value={l.type ?? ""} placeholder="dinheiro, texto, percentual…" onCommit={(v) => upd({ type: v.trim() || undefined })} />
          </label>
          <label className="field">
            <span>Valor fixo (opcional)</span>
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
            <TextField multiline value={l.text ?? ""} placeholder={l.role === "decision" ? "O preço de partida deu zero?" : "Qual o tipo do grupo?"} onCommit={(v) => upd({ text: v.trim() || undefined })} />
          </label>
          <ExprField label={l.role === "decision" ? "Condição (vale = sim)" : "Expressão que escolhe o caminho"} value={(l.role === "decision" ? l.when : l.on) ?? ""} names={names} placeholder={l.role === "decision" ? "preco <= 0" : "tipo_grupo"} onCommit={(v) => upd(l.role === "decision" ? { when: v } : { on: v })} />
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
            <TextField multiline value={l.text ?? ""} placeholder="Para cada produto do grupo, da maior receita para a menor." onCommit={(v) => upd({ text: v.trim() || undefined })} />
          </label>
          <ExprField label="Para cada item de (lista)" value={l.foreach ?? ""} names={names} placeholder="grupo" onCommit={(v) => upd({ foreach: v })} />
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
      {(l.role === "start" || l.role === "end" || l.role === "fork" || l.role === "join" || l.role === "call") && (
        <>
          <label className="field">
            <span>Em uma frase</span>
            <TextField multiline value={l.text ?? ""} placeholder={l.role === "start" ? "O que entra e quando começa" : l.role === "end" ? "O que a lógica devolve" : "O que acontece aqui"} onCommit={(v) => upd({ text: v.trim() || undefined })} />
          </label>
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
            <TextField multiline value={l.text ?? ""} placeholder="Marca própria trava o preço antes do preço fixo." onCommit={(v) => upd({ text: v.trim() || undefined })} />
          </label>
          <ExamplesEditor node={node} patch={patch} />
        </>
      )}
      <details className="callout">
        <summary>Sintaxe das expressões</summary>
        <pre style={{ whiteSpace: "pre-wrap", margin: "6px 0 0", font: "inherit" }}>{SYNTAX_GUIDE.replace(/`/g, "")}</pre>
      </details>
    </>
  );
}

/** Campo de expressão com a verificação de sintaxe e a explicação em português logo abaixo. */
function ExprField({ label, value, names, placeholder, onCommit }: { label: string; value: string; names: Record<string, string>; placeholder?: string; onCommit: (v: string | undefined) => void }) {
  const err = value ? checkExpr(value) : undefined;
  return (
    <>
      <label className="field">
        <span>{label}</span>
        <TextField value={value} placeholder={placeholder} onCommit={(v) => onCommit(v.trim() || undefined)} />
      </label>
      {err && <div className="callout warn">{err.message}</div>}
      {value && !err && <div className="callout">Em português: {explain(parseExpr(value), names)}</div>}
    </>
  );
}

/** Seta do fluxo (modo Logic): por qual saída ela sai da decisão, escolha ou laço. */
export function LogicConnFields({ conn, patch }: { conn: ConnectionEl; patch: Patch }) {
  const doc = useStore((s) => s.doc);
  const from = doc.nodes.find((n) => n.id === conn.from);
  const role = from?.logic?.role;
  if (!role) return null;
  const branches = (Object.keys(LOGIC_BRANCHES) as LogicBranch[]).filter((b) => LOGIC_BRANCHES[b].from.includes(role));
  const cur = conn.logic?.case !== undefined ? "case" : conn.logic?.branch ?? "";
  const set = (v: string) => {
    if (!v) return patch({ logic: null, label: "" });
    if (v === "case") return patch({ logic: { case: conn.logic?.case ?? '"valor"' }, label: undefined });
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
          {role === "switch" && <option value="case">valor (caso)</option>}
        </select>
      </label>
      {cur && cur !== "case" && <div className="callout">{LOGIC_BRANCHES[cur as LogicBranch].hint}</div>}
      {cur === "case" && (
        <label className="field">
          <span>Valor deste caso</span>
          <TextField value={conn.logic?.case ?? ""} placeholder={'"lucro"'} onCommit={(v) => v.trim() && !checkExpr(v) && patch({ logic: { case: v.trim() }, label: undefined })} />
        </label>
      )}
      {conn.logic && <div className="callout">Rótulo no quadro: <b>{branchLabel(conn.logic)}</b></div>}
    </>
  );
}

const fmt = (v: unknown): string => (v === undefined ? "sem valor" : typeof v === "number" ? String(Math.round(v * 1e6) / 1e6).replace(".", ",") : v === null ? "vazio" : typeof v === "boolean" ? (v ? "sim" : "não") : typeof v === "string" ? `"${v}"` : Array.isArray(v) ? `lista de ${v.length}` : "objeto");

/** Painel do modo Logic: reproduz um cenário passo a passo, com o caminho aceso no quadro. */
export function PlayPanel() {
  const play = useStore((s) => s.play);
  const speed = useStore((s) => s.playSpeed);
  const doc = useStore((s) => s.doc);
  const steps = useMemo(() => (play ? play.run.steps.filter((s) => s.rule) : []), [play]);
  const cur = play ? steps[play.k] : undefined;
  const node = cur ? doc.nodes.find((n) => n.id === cur.rule) : undefined;
  // a câmera acompanha o passo atual
  useEffect(() => {
    if (!node) return;
    const svg = document.querySelector("svg.canvas") as SVGSVGElement | null;
    if (!svg) return;
    const r = svg.getBoundingClientRect();
    const z = Math.max(0.55, Math.min(1, getState().view.z));
    setStore({ view: { z, x: r.width / 2 - (node.x + node.w / 2) * z, y: r.height * 0.36 - (node.y + node.h / 2) * z } });
  }, [node?.id, play?.k]);
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
  const role = node?.logic ? LOGIC_ROLES[node.logic.role].label : "";
  const text = (() => {
    if (cur.error) return `Erro: ${cur.error}`;
    if (cur.role === "decision") return `Respondeu ${cur.branch === "sim" ? "sim" : "não"}: o fluxo segue pela seta "${cur.branch === "sim" ? "sim" : "não"}".`;
    if (cur.role === "switch") return `O valor caiu no caso ${cur.branch === "outros" ? "“outros”" : cur.branch}.`;
    if (cur.role === "loop") return cur.branch === "repete" ? `Volta ${cur.turn}: repete o corpo do laço.` : "Terminou as repetições e segue.";
    if (cur.role === "end") return `Fim${play.run.outcome === "erro" ? " com erro" : ""}.`;
    if (cur.role === "start") return "O fluxo começa com os dados do cenário.";
    if (cur.role === "rule" && !cur.applied) return "A condição da regra não valeu: nada mudou.";
    return "";
  })();
  const saved = ex?.path && JSON.stringify(ex.path) === JSON.stringify(visitedIds(play.run));
  return (
    <div className="glass logic-play-panel" role="region" aria-label="Reprodução do cenário">
      <div className="lp-head">
        <div className="lp-title">
          ▶ {sc?.label}
          <small>{ex?.name}</small>
        </div>
        <div className="lp-ctl">
          <button className="btn ghost" onClick={() => playGo(0)} aria-label="Voltar ao início" data-tip="Início">
            <Glyph name="skip-start" size={16} />
          </button>
          <button className="btn ghost" onClick={() => playGo(play.k - 1)} aria-label="Passo anterior" data-tip="Passo anterior (←)">
            <Glyph name="step-back" size={16} />
          </button>
          <button className="btn primary" onClick={playToggle} aria-label={play.playing ? "Pausar" : "Reproduzir"}>
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
        <button className="btn" onClick={() => sc && ex && runOps([{ op: "update", id: sc.id, patch: { logic: { ...sc.logic, examples: sc.logic!.examples!.map((e, i) => (i === play.example ? { ...e, path: visitedIds(play.run) } : e)) } } }])} disabled={!!saved} data-tip="Grava este caminho no cenário: se o fluxo mudar e passar por outro lugar, o exemplo avisa">
          {saved ? "Caminho gravado ✔" : "Gravar caminho"}
        </button>
        <button className="btn ghost icon" onClick={stopPlay} aria-label="Fechar a reprodução">
          ×
        </button>
      </div>
      <div className="lp-bar" role="progressbar" aria-label="Progresso do cenário" aria-valuemin={1} aria-valuemax={last + 1} aria-valuenow={play.k + 1}>
        <i style={{ width: `${((play.k + 1) / (last + 1)) * 100}%` }} />
      </div>
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
      <div className="lp-hint" aria-hidden>
        <kbd>←</kbd> <kbd>→</kbd> passo a passo · clique numa linha para pular até ela
      </div>
      <div className="lp-list">
        {steps.map((s, i) => (
          <div key={i} className={`lp-row${i === play.k ? " on" : ""}${i < play.k ? " done" : ""}`} role="button" tabIndex={0} aria-current={i === play.k ? "step" : undefined} onClick={() => playGo(i)} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), playGo(i))}>
            <i>{i + 1}</i>
            <span>
              {s.label}
              {s.branch ? ` → ${s.branch === "nao" ? "não" : s.branch}` : ""}
              {s.changes.length ? ` · ${s.changes.map((c) => `${c.name.replace(/_/g, " ")} ${fmt(c.to)}`).join(", ")}` : ""}
            </span>
          </div>
        ))}
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
