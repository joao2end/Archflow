/**
 * «Prompts» do projeto (modo agents): executa no terminal do Claude Code os prompts e workflows desenhados no diagrama
 * (nós `prompt` e `workflow`). Barra lateral do painel do terminal; nada é guardado aqui: o texto, o subagente (seta
 * runs-on) e os passos (setas step) são editados no inspetor do nó e saem do próprio diagrama.
 *
 * Estrutura: lista → formulário de execução (variáveis `{{nome}}` e onde digitar). Um único botão principal: Executar.
 * Migração: um `.archflow/prompts.json` de versões antigas, enquanto o diagrama não tem prompts, pode ser importado para nós.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { asBracketedPaste, normalizeLibrary, promptVars, renderPrompt, slugId, uniqueId, type PromptLibrary, type SavedPrompt } from "../shared/prompts";
import { libraryFromDoc } from "../shared/workflow";
import { AGENT_RELS } from "../shared/schema";
import type { Op } from "../shared/ops";
import { run, select, set, toast, useStore } from "./store";
import { PaneHead } from "./panekit";
import { WorkflowsPane, type TermApi } from "./workflow";

export type RunTarget = "new" | "active";

/** Biblioteca antiga do projeto (`GET /api/prompts`); vazia se não existe ou o bridge não responde. */
async function legacyLibrary(): Promise<PromptLibrary | undefined> {
  try {
    const r = await fetch("/api/prompts");
    if (!r.ok) return undefined;
    const lib = normalizeLibrary((await r.json()).library).library;
    return lib.prompts.length || lib.workflows.length ? lib : undefined;
  } catch {
    return undefined;
  }
}

/** Ops que recriam a biblioteca antiga como nós prompt/workflow (ids livres no diagrama) com as setas runs-on e step. */
function importOps(lib: PromptLibrary, taken: Iterable<string>, agentIds: ReadonlySet<string>): Op[] {
  const used = new Set(taken);
  const ids = new Map<string, string>();
  const ops: Op[] = [];
  const claim = (base: string) => {
    const id = uniqueId(slugId(base), used);
    used.add(id);
    return id;
  };
  for (const p of lib.prompts) {
    const id = claim(p.id);
    ids.set(p.id, id);
    ops.push({ op: "add_node", id, asset: "agent-prompt", label: p.name, agent: { role: "prompt", text: p.text, ...(p.notes ? { description: p.notes } : {}) } });
    if (p.agent && agentIds.has(p.agent)) ops.push({ op: "add_connection", from: id, to: p.agent, type: AGENT_RELS["runs-on"].type, agent: { rel: "runs-on" } });
  }
  for (const w of lib.workflows) {
    const id = claim(w.id);
    ops.push({ op: "add_node", id, asset: "agent-workflow", label: w.name, agent: { role: "workflow" } });
    w.steps.forEach((s, i) => {
      const to = ids.get(s.promptId);
      if (to) ops.push({ op: "add_connection", from: id, to, type: AGENT_RELS.step.type, agent: { rel: "step", order: i + 1, ...(s.mode === "auto" ? { mode: "auto" as const } : {}) } });
    });
  }
  return ops;
}

export function PromptsSidebar({ projectId, canRunActive, onRun, term }: { projectId?: string; canRunActive: boolean; onRun: (text: string, title: string, target: RunTarget) => void; term: TermApi }) {
  const doc = useStore((s) => s.doc);
  const request = useStore((s) => s.runNodeRequest);
  const lib = useMemo(() => libraryFromDoc(doc), [doc]);
  const [tab, setTab] = useState<"prompts" | "workflows">("prompts");
  const [openId, setOpenId] = useState<string>();
  const [values, setValues] = useState<Record<string, string>>({});
  const [dest, setDest] = useState<RunTarget>("active");
  const [msg, setMsg] = useState<string>();
  const [legacy, setLegacy] = useState<PromptLibrary>();
  const [wfFocus, setWfFocus] = useState<{ n: number; id: string }>();

  // outro projeto: o formulário aberto era da pasta anterior
  useEffect(() => {
    setOpenId(undefined);
    setMsg(undefined);
    setLegacy(undefined);
  }, [projectId]);

  // biblioteca antiga: só se oferece enquanto o diagrama ainda não tem prompts nem workflows
  const empty = !lib.prompts.length && !lib.workflows.length;
  useEffect(() => {
    let dead = false;
    if (empty) void legacyLibrary().then((l) => !dead && setLegacy(l));
    else setLegacy(undefined);
    return () => {
      dead = true;
    };
  }, [empty, projectId]);

  const p = openId ? lib.prompts.find((x) => x.id === openId) : undefined;
  const vars = useMemo(() => (p ? promptVars(p.text) : []), [p]);
  const rendered = useMemo(() => (p ? renderPrompt(p, values) : undefined), [p, values]);

  const open = (x: SavedPrompt) => {
    setOpenId(x.id);
    setValues({});
    setMsg(undefined);
  };

  // «Executar» do inspetor de um nó prompt/workflow. Só depende do pedido: no StrictMode (dev) os efeitos rodam duas vezes e o
  // efeito de «outro projeto» fecharia o formulário aberto; rodar de novo o reabre (por isso não há guarda de «pedido já tratado»).
  const docRef = useRef(doc);
  docRef.current = doc;
  useEffect(() => {
    if (!request) return;
    const d = docRef.current;
    const node = d.nodes.find((n) => n.id === request.id);
    if (node?.agent?.role === "prompt") {
      const x = libraryFromDoc(d).prompts.find((q) => q.id === node.id);
      setTab("prompts");
      if (x) open(x);
    } else if (node?.agent?.role === "workflow") {
      setTab("workflows");
      setWfFocus({ n: request.n, id: node.id });
    }
    // tratado: limpa depois (não já, para o segundo disparo do StrictMode ainda enxergar o pedido), senão reabrir a barra o repetiria
    const t = setTimeout(() => set({ runNodeRequest: null }), 500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request]);

  const send = (x: Pick<SavedPrompt, "text" | "agent" | "name">, vals: Record<string, string>) => {
    const r = renderPrompt(x, vals);
    if (r.missing.length) return setMsg(`Preencha: ${r.missing.join(", ")}`);
    if (!r.text.trim()) return setMsg("O prompt está sem texto: escreva-o no inspetor do nó.");
    setMsg(undefined);
    onRun(asBracketedPaste(r.text), x.name.trim().slice(0, 40) || "Prompt", canRunActive && dest === "active" ? "active" : "new");
  };
  /** ▶ da lista: executa direto; se o prompt tem variáveis, abre o formulário para preenchê-las. */
  const quickRun = (x: SavedPrompt) => (promptVars(x.text).length ? open(x) : send(x, {}));
  const edit = (id: string) => select([id]);

  const doImport = () => {
    if (!legacy) return;
    const agentIds = new Set(doc.nodes.filter((n) => n.agent?.role === "agent").map((n) => n.id));
    const res = run(importOps(legacy, [...doc.nodes.map((n) => n.id), ...doc.groups.map((g) => g.id)], agentIds));
    const bad = res.find((r) => !r.ok);
    if (bad && !bad.ok) return setMsg(`Não deu para importar: ${bad.error}`);
    setLegacy(undefined);
    toast(`${legacy.prompts.length} prompts e ${legacy.workflows.length} workflows importados para o diagrama`);
  };

  const tabs = (
    <div className="prompts-tabs" role="tablist">
      <button role="tab" aria-selected={tab === "prompts"} className={tab === "prompts" ? "on" : ""} onClick={() => setTab("prompts")}>Prompts</button>
      <button role="tab" aria-selected={tab === "workflows"} className={tab === "workflows" ? "on" : ""} onClick={() => setTab("workflows")}>Workflows</button>
    </div>
  );

  return (
    <aside className="prompts-side" aria-label="Prompts e workflows do diagrama">
      {tab === "workflows" ? (
        <WorkflowsPane tabs={tabs} lib={lib} projectId={projectId} term={term} focus={wfFocus} onEdit={edit} />
      ) : !p ? (
        <>
          <div className="prompts-head">{tabs}</div>
          {legacy && (
            <div className="pane-empty">
              <p>Há {legacy.prompts.length} prompts e {legacy.workflows.length} workflows no <code>.archflow/prompts.json</code> deste projeto. Eles agora são componentes do diagrama.</p>
              <button className="btn sm" onClick={doImport}>Importar para o diagrama</button>
            </div>
          )}
          {!legacy && !lib.prompts.length && (
            <div className="pane-empty">
              <p>Prompts são nós do diagrama: adicione um «Prompt» na paleta, escreva o texto no inspetor e execute aqui com um clique.</p>
            </div>
          )}
          <div className="prompts-list" role="list" aria-label="Prompts do diagrama">
            {lib.prompts.map((x) => (
              <div key={x.id} role="listitem" className="prompts-row">
                <button className="prompts-item" onClick={() => open(x)} title={x.notes || x.text}>
                  <span>{x.name}</span>
                  {x.agent && <small>{x.agent}</small>}
                </button>
                <button className="btn ghost icon sm run" aria-label={`Executar ${x.name}`} title={promptVars(x.text).length ? "Preencher as variáveis e executar" : "Executar no terminal"} disabled={!x.text.trim()} onClick={() => quickRun(x)}>▶</button>
              </div>
            ))}
          </div>
          {msg && <div className="pane-msg">{msg}</div>}
        </>
      ) : (
        <>
          <PaneHead title={p.name} onBack={() => setOpenId(undefined)} />
          <div className="pane-body">
            {vars.map((v) => (
              <label key={v} className="field">
                <span>{v}</span>
                <input className="input" value={values[v] ?? ""} onChange={(e) => setValues({ ...values, [v]: e.target.value })} />
              </label>
            ))}
            <div className="pane-preview"><small>Será digitado</small><pre>{rendered?.text}</pre></div>
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
              <button className="btn primary sm" disabled={!p.text.trim()} onClick={() => send(p, values)} title="Digita o texto no Claude Code (sem Enter). O harness é sincronizado antes.">Executar</button>
              <button className="btn sm" onClick={() => edit(p.id)} title="Seleciona o prompt no diagrama; o texto se edita no inspetor">Editar no diagrama</button>
            </div>
          </div>
        </>
      )}
    </aside>
  );
}
