/**
 * «Prompts» do projeto (modo agents): cadastra prompts reutilizáveis e os executa no terminal do Claude Code.
 * Barra lateral do painel do terminal; os dados ficam em `.archflow/prompts.json` (GET/PUT /api/prompts).
 *
 * Estrutura: lista → editor. A lista só mostra nomes (com ▶ para executar direto); o editor mostra o essencial
 * (nome, texto, variáveis) e deixa subagente e notas sob demanda. Um único botão principal: Executar.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { asBracketedPaste, normalizeLibrary, promptVars, renderPrompt, slugId, uniqueId, type PromptLibrary, type SavedPrompt } from "../shared/prompts";
import { toast, useStore } from "./store";
import { MoreMenu, PaneHead } from "./panekit";
import { WorkflowsPane, type TermApi } from "./workflow";

async function api(method: "GET" | "PUT", body?: unknown): Promise<{ library: PromptLibrary; dropped: string[] }> {
  const r = await fetch("/api/prompts", { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error ?? `erro ${r.status}`);
  return j;
}

interface Draft {
  /** undefined = prompt novo, ainda sem id */
  id?: string;
  name: string;
  text: string;
  agent: string;
  notes: string;
}
const blank = (): Draft => ({ name: "", text: "", agent: "", notes: "" });
const toDraft = (p: SavedPrompt): Draft => ({ id: p.id, name: p.name, text: p.text, agent: p.agent ?? "", notes: p.notes ?? "" });

export type RunTarget = "new" | "active";

export function PromptsSidebar({ projectId, canRunActive, onRun, term }: { projectId?: string; canRunActive: boolean; onRun: (text: string, title: string, target: RunTarget) => void; term: TermApi }) {
  const doc = useStore((s) => s.doc);
  const agentIds = useMemo(() => doc.nodes.filter((n) => n.agent?.role === "agent").map((n) => n.id).sort(), [doc.nodes]);
  const [tab, setTab] = useState<"prompts" | "workflows">("prompts");
  const [lib, setLib] = useState<PromptLibrary>();
  const [view, setView] = useState<"list" | "edit">("list");
  const [draft, setDraft] = useState<Draft>(blank);
  const [values, setValues] = useState<Record<string, string>>({});
  const [dest, setDest] = useState<RunTarget>("active");
  const [msg, setMsg] = useState<string>();
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let dead = false;
    setLib(undefined);
    setView("list");
    setDraft(blank());
    api("GET").then(
      (r) => !dead && setLib(r.library),
      (e) => !dead && setMsg(e instanceof Error ? e.message : String(e)),
    );
    return () => {
      dead = true;
    };
  }, [projectId]);

  const vars = useMemo(() => promptVars(draft.text), [draft.text]);
  const rendered = useMemo(() => renderPrompt({ text: draft.text, agent: draft.agent || undefined }, values), [draft.text, draft.agent, values]);
  const saved = draft.id ? lib?.prompts.find((p) => p.id === draft.id) : undefined;
  const dirty = !saved || saved.name !== draft.name || saved.text !== draft.text || (saved.agent ?? "") !== draft.agent || (saved.notes ?? "") !== draft.notes;
  const canSave = !!draft.name.trim() && !!draft.text.trim();

  const open = (p?: SavedPrompt) => {
    setDraft(p ? toDraft(p) : blank());
    setValues({});
    setMsg(undefined);
    setView("edit");
  };

  const persist = useCallback(async (next: PromptLibrary) => {
    setSaving(true);
    setMsg(undefined);
    try {
      const r = await api("PUT", { library: next });
      setLib(r.library);
      if (r.dropped.length) setMsg(`Alguns itens foram descartados ao salvar: ${r.dropped.join("; ")}`);
      return r.library;
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }, []);

  const save = async () => {
    if (!lib || !canSave) return;
    const id = draft.id ?? uniqueId(slugId(draft.name), lib.prompts.map((p) => p.id));
    const p: SavedPrompt = { id, name: draft.name.trim(), text: draft.text, ...(draft.agent ? { agent: draft.agent } : {}), ...(draft.notes.trim() ? { notes: draft.notes.trim() } : {}) };
    const prompts = saved ? lib.prompts.map((x) => (x.id === id ? p : x)) : [...lib.prompts, p];
    const out = await persist({ ...lib, prompts });
    if (out) setDraft(toDraft(out.prompts.find((x) => x.id === id) ?? p));
  };
  const duplicate = async () => {
    if (!lib || !saved) return;
    const id = uniqueId(slugId(`${saved.name} cópia`), lib.prompts.map((p) => p.id));
    const out = await persist({ ...lib, prompts: [...lib.prompts, { ...saved, id, name: `${saved.name} (cópia)` }] });
    const copy = out?.prompts.find((p) => p.id === id);
    if (copy) open(copy);
  };
  const remove = async () => {
    if (!lib || !saved || !window.confirm(`Apagar o prompt «${saved.name}»? Os workflows que o usam perdem esse passo.`)) return;
    const prompts = lib.prompts.filter((p) => p.id !== saved.id);
    const workflows = lib.workflows.map((w) => ({ ...w, steps: w.steps.filter((s) => s.promptId !== saved.id) }));
    if (await persist({ ...lib, prompts, workflows })) {
      setView("list");
      toast(`Prompt «${saved.name}» apagado`);
    }
  };

  const send = (p: Pick<SavedPrompt, "text" | "agent" | "name">, vals: Record<string, string>) => {
    const r = renderPrompt(p, vals);
    if (r.missing.length) return setMsg(`Preencha: ${r.missing.join(", ")}`);
    if (!r.text.trim()) return;
    setMsg(undefined);
    onRun(asBracketedPaste(r.text), p.name.trim().slice(0, 40) || "Prompt", canRunActive && dest === "active" ? "active" : "new");
  };
  /** ▶ da lista: executa direto; se o prompt tem variáveis, abre o editor para preenchê-las. */
  const quickRun = (p: SavedPrompt) => (promptVars(p.text).length ? open(p) : send(p, {}));

  const unknownAgent = draft.agent && !agentIds.includes(draft.agent);
  const tabs = (
    <div className="prompts-tabs" role="tablist">
      <button role="tab" aria-selected={tab === "prompts"} className={tab === "prompts" ? "on" : ""} onClick={() => setTab("prompts")}>Prompts</button>
      <button role="tab" aria-selected={tab === "workflows"} className={tab === "workflows" ? "on" : ""} onClick={() => setTab("workflows")}>Workflows</button>
    </div>
  );

  return (
    <aside className="prompts-side" aria-label="Prompts e workflows do projeto">
      {tab === "workflows" ? (
        <WorkflowsPane tabs={tabs} lib={lib} persist={persist} projectId={projectId} term={term} />
      ) : view === "list" ? (
        <>
          <div className="prompts-head">
            {tabs}
            <button className="btn ghost icon sm" aria-label="Novo prompt" title="Novo prompt" onClick={() => open()}>+</button>
          </div>
          {!lib && !msg && <div className="pane-empty">Carregando…</div>}
          {lib && !lib.prompts.length && (
            <div className="pane-empty">
              <p>Guarde os prompts que você repete e execute-os no terminal com um clique.</p>
              <button className="btn sm" onClick={() => open()}>Criar o primeiro prompt</button>
            </div>
          )}
          <div className="prompts-list" role="list" aria-label="Prompts salvos">
            {lib?.prompts.map((p) => (
              <div key={p.id} role="listitem" className="prompts-row">
                <button className="prompts-item" onClick={() => open(p)} title={p.notes || p.text}>
                  <span>{p.name}</span>
                  {p.agent && <small>{p.agent}</small>}
                </button>
                <button className="btn ghost icon sm run" aria-label={`Executar ${p.name}`} title={promptVars(p.text).length ? "Preencher as variáveis e executar" : "Executar no terminal"} onClick={() => quickRun(p)}>▶</button>
              </div>
            ))}
          </div>
          {msg && <div className="pane-msg">{msg}</div>}
        </>
      ) : (
        <>
          <PaneHead title={saved ? saved.name : "Novo prompt"} onBack={() => setView("list")}>
            {saved && <MoreMenu items={[{ label: "Duplicar", onClick: () => void duplicate(), disabled: saving }, { label: "Apagar", onClick: () => void remove(), danger: true, disabled: saving }]} />}
          </PaneHead>
          <div className="pane-body">
            <label className="field">
              <span>Nome</span>
              <input className="input" value={draft.name} maxLength={80} placeholder="Revisar PR" autoFocus={!saved} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            </label>
            <label className="field">
              <span>Prompt</span>
              <textarea className="input" rows={5} value={draft.text} maxLength={20000} placeholder="Revise {{arquivo}} e liste os riscos de segurança." onChange={(e) => setDraft({ ...draft, text: e.target.value })} />
              <small className="hint">Use {"{{variável}}"} para o que muda a cada execução.</small>
            </label>
            {vars.map((v) => (
              <label key={v} className="field">
                <span>{v}</span>
                <input className="input" value={values[v] ?? ""} onChange={(e) => setValues({ ...values, [v]: e.target.value })} />
              </label>
            ))}
            <label className="field">
              <span>Subagente <small className="opt">opcional</small></span>
              <select className="input" value={draft.agent} onChange={(e) => setDraft({ ...draft, agent: e.target.value })}>
                <option value="">Conversa normal</option>
                {unknownAgent && <option value={draft.agent}>{draft.agent} (não existe no diagrama)</option>}
                {agentIds.map((a) => (
                  <option key={a} value={a}>{a}</option>
                ))}
              </select>
            </label>
            {draft.text.trim() && (vars.length > 0 || draft.agent) && (
              <div className="pane-preview"><small>Será digitado</small><pre>{rendered.text}</pre></div>
            )}
            <details className="pane-more" open={!!draft.notes}>
              <summary>Notas</summary>
              <input className="input" value={draft.notes} maxLength={2000} placeholder="Só para você" aria-label="Notas" onChange={(e) => setDraft({ ...draft, notes: e.target.value })} />
            </details>
            {msg && <div className="pane-msg">{msg}</div>}
          </div>
          <div className="pane-foot">
            {canRunActive && (
              <div className="tseg" role="radiogroup" aria-label="Onde executar">
                <button role="radio" aria-checked={dest === "active"} className={dest === "active" ? "on" : ""} onClick={() => setDest("active")}>Sessão atual</button>
                <button role="radio" aria-checked={dest === "new"} className={dest === "new" ? "on" : ""} onClick={() => setDest("new")}>Nova sessão</button>
              </div>
            )}
            <div className="pane-actions">
              <button className="btn primary sm" disabled={!canSave} onClick={() => send({ text: draft.text, agent: draft.agent || undefined, name: draft.name }, values)} title="Digita o texto no Claude Code (sem Enter). O harness é sincronizado antes.">Executar</button>
              <button className="btn sm" disabled={!canSave || !dirty || saving || !lib} onClick={() => void save()}>{saved && !dirty ? "Salvo" : "Salvar"}</button>
            </div>
          </div>
        </>
      )}
    </aside>
  );
}
