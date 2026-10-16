/**
 * Workflows de prompts: edita a lista de passos e a executa no terminal do Claude Code.
 * Passo manual: o texto é digitado numa sessão interativa e o usuário confirma. Passo automático: `claude -p` numa aba
 * própria, que o runner espera terminar; os passos automáticos compartilham a conversa (`--session-id` / `--resume`).
 * A lógica da execução é a máquina de estados de `shared/workflow.ts`; aqui só se executam os efeitos.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { asBracketedPaste, slugId, uniqueId, type PromptLibrary, type StepMode, type Workflow } from "../shared/prompts";
import { available, progress, reduce, startRun, workflowVars, type RunEffect, type RunEvent, type WorkflowRun } from "../shared/workflow";
import { conversationExists } from "./termclient";
import { onTermExit } from "./termevents";
import { toast } from "./store";
import { MoreMenu, PaneHead } from "./panekit";

export interface TermApi {
  startExec(args: string[], title: string): Promise<{ id: string } | undefined>;
  /** sessão interativa (passo manual); `prefill` é digitado sem Enter quando o claude estiver pronto */
  startInteractive(args: string[], prefill: string, title: string): Promise<{ id: string } | undefined>;
  isAlive(id: string): boolean;
  /** digita `text` numa sessão aberta (sem Enter); false se ela não existe mais */
  sendText(id: string, text: string): boolean;
  activate(id: string): void;
  /** encerra a sessão e fecha a aba dela */
  closeSession(id: string): Promise<void>;
}

const ICON: Record<string, string> = { pending: "○", running: "◐", waiting: "●", done: "✓", failed: "✗", skipped: "–" };
const PERMS = [
  { v: "", label: "Padrão" },
  { v: "acceptEdits", label: "Aceitar edições de arquivos" },
  { v: "plan", label: "Só planejar, sem editar" },
];

interface Draft {
  id?: string;
  name: string;
  steps: Workflow["steps"];
}
const blank = (): Draft => ({ name: "", steps: [] });
const same = (a: Draft, w?: Workflow) => !!w && a.name === w.name && JSON.stringify(a.steps) === JSON.stringify(w.steps);

export function WorkflowsPane({ tabs, lib, persist, projectId, term }: { tabs: ReactNode; lib?: PromptLibrary; persist: (l: PromptLibrary) => Promise<PromptLibrary | undefined>; projectId?: string; term: TermApi }) {
  const [view, setView] = useState<"list" | "edit">("list");
  const [draft, setDraft] = useState<Draft>(blank);
  const [values, setValues] = useState<Record<string, string>>({});
  const [perm, setPerm] = useState("");
  const [msg, setMsg] = useState<string>();
  const [run, setRunState] = useState<WorkflowRun | null>(null);
  const runRef = useRef<WorkflowRun | null>(null);
  const execRef = useRef<{ id: string; stepIndex: number } | undefined>(undefined);
  /** a aba interativa da conversa (passos manuais); fica aberta entre manuais e é fechada antes de um passo automático */
  const chatRef = useRef<{ id: string; sessionId: string } | undefined>(undefined);
  const permRef = useRef(perm);
  permRef.current = perm;
  const setRun = useCallback((r: WorkflowRun | null) => {
    runRef.current = r;
    setRunState(r);
  }, []);

  // outro projeto: a execução e o rascunho eram da pasta anterior
  useEffect(() => {
    setRun(null);
    execRef.current = undefined;
    chatRef.current = undefined;
    setDraft(blank());
    setView("list");
    setMsg(undefined);
  }, [projectId, setRun]);

  const saved = draft.id ? lib?.workflows.find((w) => w.id === draft.id) : undefined;
  const dirty = !same(draft, saved);
  const tmpLib = useMemo<PromptLibrary | undefined>(() => (lib ? { ...lib, workflows: [{ id: "__draft", name: draft.name || "Workflow", steps: draft.steps }] } : undefined), [lib, draft]);
  const vars = useMemo(() => (tmpLib ? workflowVars(tmpLib, "__draft") : []), [tmpLib]);
  const hasAuto = draft.steps.some((s) => s.mode === "auto");
  const hasManual = draft.steps.some((s) => s.mode === "manual");

  const doEffect = useCallback(
    async (effect: RunEffect) => {
      const r = runRef.current;
      if (!r || effect.type === "none") return;
      const title = effect.type === "abort" ? r.workflowName : `${r.workflowName} · ${effect.stepIndex + 1}/${r.steps.length}`;
      const perm = permRef.current ? ["--permission-mode", permRef.current] : [];
      if (effect.type === "abort") {
        const e = execRef.current;
        execRef.current = undefined; // o fim deste processo não é «falha do passo»: foi a gente que parou
        if (e) await term.closeSession(e.id);
        return;
      }
      if (effect.type === "type") {
        const chat = chatRef.current;
        if (chat && term.isAlive(chat.id)) {
          // passos manuais seguidos: a mesma aba continua a conversa
          setRun({ ...r, sessionId: chat.sessionId });
          if (term.sendText(chat.id, asBracketedPaste(effect.text))) return term.activate(chat.id);
        }
        // a primeira chamada de uma conversa usa um id novo (um id de tentativa anterior pode já existir); as seguintes retomam
        // se o passo anterior «concluído» nunca mandou nada ao Claude, a conversa não existe: cria com --session-id em vez de retomar
        const fresh = effect.first || !(await conversationExists(effect.sessionId));
        const sessionId = effect.first ? crypto.randomUUID() : effect.sessionId;
        if (effect.first) setRun({ ...r, sessionId });
        const s = await term.startInteractive([fresh ? "--session-id" : "--resume", sessionId, ...perm], asBracketedPaste(effect.text), title);
        if (!s) return dispatchRef.current({ type: "stop" }); // não abriu (limite, claude ausente…): o erro aparece no painel
        chatRef.current = { id: s.id, sessionId };
        return;
      }
      // passo automático: nunca dois processos na mesma conversa, então a aba interativa é encerrada antes (a conversa fica salva)
      const chat = chatRef.current;
      chatRef.current = undefined;
      if (chat && term.isAlive(chat.id)) {
        await term.closeSession(chat.id);
        await new Promise((ok) => setTimeout(ok, 700)); // dá tempo de o claude terminar de gravar a conversa
      }
      const sessionId = effect.first ? crypto.randomUUID() : (chat?.sessionId ?? effect.sessionId);
      if (effect.first || chat) setRun({ ...(runRef.current ?? r), sessionId });
      const fresh = effect.first || !(await conversationExists(sessionId)); // conversa nunca gravada: --session-id em vez de --resume
      const args = ["-p", fresh ? "--session-id" : "--resume", sessionId, ...perm, "--", effect.text];
      const s = await term.startExec(args, title);
      if (!s) return dispatchRef.current({ type: "autoDone", code: -2 }); // não abriu (limite, claude ausente…): o passo falha
      execRef.current = { id: s.id, stepIndex: effect.stepIndex };
    },
    [term, setRun],
  );
  const dispatch = useCallback(
    (ev: RunEvent) => {
      const cur = runRef.current;
      if (!cur) return;
      const out = reduce(cur, ev);
      setRun(out.run);
      void doEffect(out.effect);
    },
    [doEffect, setRun],
  );
  const dispatchRef = useRef(dispatch);
  dispatchRef.current = dispatch;

  // o passo automático terminou (ou o usuário fechou a aba dele)
  useEffect(
    () =>
      onTermExit((id, code) => {
        if (chatRef.current?.id === id) chatRef.current = undefined; // a aba interativa acabou (o usuário saiu ou fechou)
        if (execRef.current?.id !== id) return;
        execRef.current = undefined;
        dispatchRef.current({ type: "autoDone", code });
      }),
    [],
  );

  const persistWorkflows = async (workflows: Workflow[]) => (lib ? persist({ ...lib, workflows }) : undefined);
  const save = async () => {
    if (!lib || !draft.name.trim()) return;
    const id = draft.id ?? uniqueId(slugId(draft.name), lib.workflows.map((w) => w.id));
    const w: Workflow = { id, name: draft.name.trim(), steps: draft.steps };
    const out = await persistWorkflows(saved ? lib.workflows.map((x) => (x.id === id ? w : x)) : [...lib.workflows, w]);
    const back = out?.workflows.find((x) => x.id === id);
    if (back) setDraft({ id: back.id, name: back.name, steps: back.steps });
  };
  const remove = async () => {
    if (!lib || !saved || !window.confirm(`Apagar o workflow «${saved.name}»?`)) return;
    if (await persistWorkflows(lib.workflows.filter((w) => w.id !== saved.id))) {
      setView("list");
      setDraft(blank());
      toast(`Workflow «${saved.name}» apagado`);
    }
  };
  const duplicate = async () => {
    if (!lib || !saved) return;
    const id = uniqueId(slugId(`${saved.name} cópia`), lib.workflows.map((w) => w.id));
    const out = await persistWorkflows([...lib.workflows, { ...saved, id, name: `${saved.name} (cópia)` }]);
    const copy = out?.workflows.find((w) => w.id === id);
    if (copy) open(copy);
  };

  const begin = (l: PromptLibrary | undefined, id: string, vals: Record<string, string>) => {
    if (!l) return;
    const r = startRun(l, id, vals, crypto.randomUUID());
    if (!r.ok) return setMsg(r.error);
    setMsg(undefined);
    setRun(r.run);
    void doEffect(r.effect);
  };
  const start = () => begin(tmpLib, "__draft", values);
  const open = (w?: Workflow) => {
    setDraft(w ? { id: w.id, name: w.name, steps: w.steps } : blank());
    setValues({});
    setMsg(undefined);
    setView("edit");
  };
  /** ▶ da lista: roda direto; se há variáveis para preencher, abre o editor. */
  const quickRun = (w: Workflow) => {
    if (!lib) return;
    if (workflowVars(lib, w.id).length) return open(w);
    setDraft({ id: w.id, name: w.name, steps: w.steps });
    begin(lib, w.id, {});
  };

  const moveStep = (i: number, d: -1 | 1) => {
    const steps = [...draft.steps];
    const j = i + d;
    if (j < 0 || j >= steps.length) return;
    [steps[i], steps[j]] = [steps[j], steps[i]];
    setDraft({ ...draft, steps });
  };
  const setStep = (i: number, p: Partial<Workflow["steps"][number]>) => setDraft({ ...draft, steps: draft.steps.map((s, j) => (j === i ? { ...s, ...p } : s)) });

  const av = run ? available(run) : undefined;
  const pr = run ? progress(run) : undefined;
  const live = !!run && (run.state === "running" || run.state === "waiting" || run.state === "failed");
  const closeRun = () => setRun(null);
  const rerun = () => dispatch({ type: "restart" });

  // ── execução: o cartão ocupa a lateral inteira ──
  if (run && pr && av) {
    const chip = { done: "Concluído", failed: "Falhou", stopped: "Parado", waiting: "Aguardando você", running: "Rodando" }[run.state];
    return (
      <>
        <PaneHead title={run.workflowName} onBack={closeRun}>
          <span className={`wf-chip ${run.state}`}>{chip}</span>
        </PaneHead>
        <div className="pane-body" aria-live="polite">
          <div className="wf-bar" role="progressbar" aria-label="Progresso do workflow" aria-valuemin={0} aria-valuemax={pr.total} aria-valuenow={pr.done + pr.skipped}><i style={{ width: `${Math.round(pr.fraction * 100)}%` }} /></div>
          <ol className="wf-steps">
            {run.steps.map((s, i) => (
              <li key={i} className={`wf-s ${s.status}${i === run.current ? " cur" : ""}`}>
                <span className="wf-ico" aria-hidden>{ICON[s.status]}</span>
                <span className="wf-sname">{s.name}</span>
                <small>{s.mode === "auto" ? "auto" : "manual"}{s.code !== undefined && s.code !== 0 ? ` · código ${s.code}` : ""}{s.status === "skipped" ? " · pulado" : ""}</small>
              </li>
            ))}
          </ol>
          <p className="hint">
            {run.state === "waiting" && "O texto está no terminal, sem Enter. Complete, confirme e clique em Próximo passo."}
            {run.state === "running" && "Rodando no terminal."}
            {run.state === "failed" && "O passo falhou. A aba dele no terminal mostra o motivo."}
            {run.state === "done" && "Todos os passos foram concluídos. A conversa continua aberta no terminal."}
            {run.state === "stopped" && "Execução parada."}
            {execRef.current && run.state === "running" && <> <button className="link" onClick={() => term.activate(execRef.current!.id)}>Ver aba</button></>}
          </p>
        </div>
        <div className="pane-foot">
          <div className="pane-actions">
            {av.next && <button className="btn primary sm" onClick={() => dispatch({ type: "next" })}>Próximo passo</button>}
            {av.retry && <button className="btn primary sm" onClick={() => dispatch({ type: "retry" })}>Tentar de novo</button>}
            {!live && <button className="btn primary sm" onClick={rerun}>Rodar de novo</button>}
            {av.skip && <button className="btn sm" onClick={() => dispatch({ type: "skip" })}>Pular</button>}
            {av.stop && <button className="btn ghost sm" onClick={() => dispatch({ type: "stop" })}>Parar</button>}
            {!live && <button className="btn ghost sm" onClick={closeRun}>Fechar</button>}
          </div>
        </div>
      </>
    );
  }

  // ── lista ──
  if (view === "list") {
    return (
      <>
        <div className="prompts-head">
          {tabs}
          <button className="btn ghost icon sm" aria-label="Novo workflow" title="Novo workflow" onClick={() => open()}>+</button>
        </div>
        {!lib && <div className="pane-empty">Carregando…</div>}
        {lib && !lib.workflows.length && (
          <div className="pane-empty">
            <p>Encadeie prompts da biblioteca em passos e execute tudo na mesma conversa.</p>
            <button className="btn sm" onClick={() => open()}>Criar o primeiro workflow</button>
          </div>
        )}
        <div className="prompts-list" role="list" aria-label="Workflows salvos">
          {lib?.workflows.map((w) => (
            <div key={w.id} role="listitem" className="prompts-row">
              <button className="prompts-item" onClick={() => open(w)}>
                <span>{w.name}</span>
                <small>{w.steps.length} {w.steps.length === 1 ? "passo" : "passos"}</small>
              </button>
              <button className="btn ghost icon sm run" aria-label={`Executar ${w.name}`} title="Executar" disabled={!w.steps.length} onClick={() => quickRun(w)}>▶</button>
            </div>
          ))}
        </div>
        {msg && <div className="pane-msg">{msg}</div>}
      </>
    );
  }

  // ── editor ──
  return (
    <>
      <PaneHead title={saved ? saved.name : "Novo workflow"} onBack={() => setView("list")}>
        {saved && <MoreMenu items={[{ label: "Duplicar", onClick: () => void duplicate() }, { label: "Apagar", onClick: () => void remove(), danger: true }]} />}
      </PaneHead>
      <div className="pane-body">
        <label className="field">
          <span>Nome</span>
          <input className="input" value={draft.name} maxLength={80} placeholder="Entrega de feature" autoFocus={!saved} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
        </label>
        <div className="field">
          <span>Passos</span>
          {!draft.steps.length && <small className="hint">Adicione prompts da biblioteca. Cada passo continua a conversa do anterior.</small>}
          {draft.steps.map((s, i) => {
            const p = lib?.prompts.find((x) => x.id === s.promptId);
            return (
              <div key={i} className="wf-step">
                <span className="wf-n">{i + 1}</span>
                <span className="wf-name" title={p?.text}>{p?.name ?? s.promptId}</span>
                <div className="tseg sm" role="radiogroup" aria-label={`Modo do passo ${i + 1}`}>
                  <button role="radio" aria-checked={s.mode === "manual"} className={s.mode === "manual" ? "on" : ""} title="Você confirma cada passo no terminal" onClick={() => setStep(i, { mode: "manual" })}>Manual</button>
                  <button role="radio" aria-checked={s.mode === "auto"} className={s.mode === "auto" ? "on" : ""} title="Roda sozinho (claude -p) e segue ao terminar" onClick={() => setStep(i, { mode: "auto" })}>Auto</button>
                </div>
                <MoreMenu label={`Ações do passo ${i + 1}`} items={[{ label: "Mover para cima", onClick: () => moveStep(i, -1), disabled: i === 0 }, { label: "Mover para baixo", onClick: () => moveStep(i, 1), disabled: i === draft.steps.length - 1 }, { label: "Remover", danger: true, onClick: () => setDraft({ ...draft, steps: draft.steps.filter((_, j) => j !== i) }) }]} />
              </div>
            );
          })}
          <select className="input" aria-label="Adicionar passo" value="" disabled={!lib?.prompts.length} onChange={(e) => e.target.value && setDraft({ ...draft, steps: [...draft.steps, { promptId: e.target.value, mode: "manual" }] })}>
            <option value="">{lib?.prompts.length ? "+ Adicionar passo" : "Crie prompts primeiro"}</option>
            {lib?.prompts.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>
        {vars.map((v) => (
          <label key={v} className="field">
            <span>{v}</span>
            <input className="input" value={values[v] ?? ""} onChange={(e) => setValues({ ...values, [v]: e.target.value })} />
          </label>
        ))}
        {hasAuto && (
          <details className="pane-more">
            <summary>Permissões dos passos automáticos</summary>
            <select className="input" aria-label="Permissões dos passos automáticos" value={perm} onChange={(e) => setPerm(e.target.value)}>
              {PERMS.map((p) => (
                <option key={p.v} value={p.v}>{p.label}</option>
              ))}
            </select>
            <small className="hint">Passos automáticos não conseguem pedir aprovação: o que exigir permissão é negado.</small>
          </details>
        )}
        {msg && <div className="pane-msg">{msg}</div>}
      </div>
      <div className="pane-foot">
        <div className="pane-actions">
          <button className="btn primary sm" disabled={!draft.steps.length} onClick={start}>Executar</button>
          <button className="btn sm" disabled={!draft.name.trim() || !dirty || !lib} onClick={() => void save()}>{saved && !dirty ? "Salvo" : "Salvar"}</button>
        </div>
      </div>
    </>
  );
}
