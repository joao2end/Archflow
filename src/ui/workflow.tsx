/**
 * Workflows de prompts: executa no terminal do Claude Code os workflows desenhados no diagrama (nós `workflow` + setas `step`).
 * Os passos se editam no inspetor do nó; aqui só se preenche as variáveis e se acompanha a execução.
 * Passo manual: o texto é digitado numa sessão interativa e o usuário confirma. Passo automático: `claude -p` numa aba
 * própria, que o runner espera terminar; os passos automáticos compartilham a conversa (`--session-id` / `--resume`).
 * A lógica da execução é a máquina de estados de `shared/workflow.ts`; aqui só se executam os efeitos.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { asBracketedPaste, type PromptLibrary, type Workflow } from "../shared/prompts";
import { available, canGoto, progress, reduce, RESULT_MAX, startRun, workflowVars, type RunEffect, type RunEvent, type WorkflowRun } from "../shared/workflow";
import { conversationExists, lastConversationText } from "./termclient";
import { onTermExit } from "./termevents";
import { PaneHead } from "./panekit";
import { useStore } from "./store";
import { allowableTools, loadAllowed, saveAllowed } from "./toolperms";

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

export function WorkflowsPane({ tabs, lib, projectId, term, focus, onEdit }: { tabs: ReactNode; lib: PromptLibrary; projectId?: string; term: TermApi; /** abre o formulário deste workflow (pedido do inspetor) */ focus?: { n: number; id: string }; /** seleciona o nó no diagrama para editar */ onEdit: (id: string) => void }) {
  const [view, setView] = useState<"list" | "form">("list");
  const [openId, setOpenId] = useState<string>();
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
  // ferramentas liberadas sem perguntar (--allowedTools): escolhidas entre as do diagrama, lembradas por projeto
  const doc = useStore((s) => s.doc);
  const tools = allowableTools(doc);
  const [allowed, setAllowed] = useState<string[]>(() => loadAllowed(projectId));
  useEffect(() => setAllowed(loadAllowed(projectId)), [projectId]);
  const allowedNow = allowed.filter((a) => tools.some((t) => t.name === a));
  const allowedRef = useRef(allowedNow);
  allowedRef.current = allowedNow;
  const toggleAllowed = (name: string) => {
    const next = allowed.includes(name) ? allowed.filter((x) => x !== name) : [...allowed, name];
    setAllowed(next);
    saveAllowed(projectId, next);
  };
  const setRun = useCallback((r: WorkflowRun | null) => {
    runRef.current = r;
    setRunState(r);
  }, []);

  // outro projeto: a execução e o rascunho eram da pasta anterior
  useEffect(() => {
    setRun(null);
    execRef.current = undefined;
    chatRef.current = undefined;
    setOpenId(undefined);
    setView("list");
    setMsg(undefined);
  }, [projectId, setRun]);

  const wf = openId ? lib.workflows.find((w) => w.id === openId) : undefined;
  const vars = wf ? workflowVars(lib, wf.id) : [];
  const hasAuto = !!wf?.steps.some((s) => s.mode === "auto");
  const open = useCallback((w: Workflow) => {
    setOpenId(w.id);
    setValues({});
    setMsg(undefined);
    setView("form");
  }, []);
  // «Executar» do inspetor: abre o formulário do workflow pedido
  const lastFocus = useRef(0);
  useEffect(() => {
    if (!focus || focus.n === lastFocus.current) return;
    lastFocus.current = focus.n;
    const w = lib.workflows.find((x) => x.id === focus.id);
    if (w) open(w);
  }, [focus, lib, open]);

  const doEffect = useCallback(
    async function exec(effect: RunEffect): Promise<void> {
      const r = runRef.current;
      if (!r || effect.type === "none") return;
      if (effect.type === "seq") {
        for (const e of effect.effects) await exec(e);
        return;
      }
      const title = effect.type === "abort" ? r.workflowName : `${r.workflowName} · ${effect.stepIndex + 1}/${r.steps.length}`;
      const perm = [...(permRef.current ? ["--permission-mode", permRef.current] : []), ...(allowedRef.current.length ? ["--allowedTools", allowedRef.current.join(",")] : [])];
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

  /** Guarda na memória do workflow o que o agente respondeu no passo (última resposta da conversa); ignora a que já era de outro passo. */
  const capture = useCallback(async (stepIndex: number) => {
    const r = runRef.current;
    if (!r) return;
    const text = (await lastConversationText(r.sessionId))?.trim().slice(0, RESULT_MAX);
    const now = runRef.current;
    if (!text || !now || now.steps.some((s) => s.result === text)) return;
    dispatchRef.current({ type: "result", stepIndex, text });
  }, []);

  // o passo automático terminou (ou o usuário fechou a aba dele)
  useEffect(
    () =>
      onTermExit((id, code) => {
        if (chatRef.current?.id === id) chatRef.current = undefined; // a aba interativa acabou (o usuário saiu ou fechou)
        const e = execRef.current;
        if (e?.id !== id) return;
        execRef.current = undefined;
        // a resposta entra na memória ANTES de o passo seguinte ser montado (ele pode usar {{anterior}})
        void (code === 0 ? capture(e.stepIndex) : Promise.resolve()).then(() => dispatchRef.current({ type: "autoDone", code }));
      }),
    [capture],
  );
  /** «Próximo passo» de um passo manual: guarda o que o agente respondeu e segue. */
  const advance = async () => {
    const r = runRef.current;
    if (r && r.current >= 0) await capture(r.current);
    dispatch({ type: "next" });
  };

  const begin = (l: PromptLibrary, id: string, vals: Record<string, string>) => {
    const r = startRun(l, id, vals, crypto.randomUUID());
    if (!r.ok) return setMsg(r.error);
    setMsg(undefined);
    setRun(r.run);
    void doEffect(r.effect);
  };
  const start = () => wf && begin(lib, wf.id, values);
  /** ▶ da lista: roda direto; se há variáveis para preencher, abre o formulário. */
  const quickRun = (w: Workflow) => {
    if (workflowVars(lib, w.id).length) return open(w);
    setOpenId(w.id);
    begin(lib, w.id, {});
  };

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
                {canGoto(run, i) && (
                  <button className="btn ghost icon sm" aria-label={`Voltar para o passo ${i + 1}: ${s.name}`} title="Voltar para este passo: ele e os seguintes são refeitos, na mesma conversa" onClick={() => dispatch({ type: "goto", index: i })}>↺</button>
                )}
                {s.result && (
                  <details className="wf-res">
                    <summary title="O que o agente respondeu neste passo. Fica na memória do workflow e pode ser usado nos passos seguintes.">memória · {s.result.length.toLocaleString("pt-BR")} caracteres</summary>
                    <pre>{s.result}</pre>
                    <small className="hint">Nos passos seguintes: <code>{"{{anterior}}"}</code> ou <code>{`{{resultado.${s.promptId}}}`}</code></small>
                    <button className="btn ghost sm" onClick={() => void navigator.clipboard?.writeText(s.result!)}>Copiar</button>
                  </details>
                )}
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
            {av.next && <button className="btn primary sm" onClick={() => void advance()}>Próximo passo</button>}
            {av.retry && <button className="btn primary sm" onClick={() => dispatch({ type: "retry" })}>Tentar de novo</button>}
            {!live && <button className="btn primary sm" onClick={rerun}>Rodar de novo</button>}
            {run.current > 0 && canGoto(run, run.current - 1) && <button className="btn sm" onClick={() => dispatch({ type: "goto", index: run.current - 1 })} title="Refaz o passo anterior e depois os seguintes, na mesma conversa">← Voltar</button>}
            {av.skip && <button className="btn sm" onClick={() => dispatch({ type: "skip" })}>Pular</button>}
            {av.stop && <button className="btn ghost sm" onClick={() => dispatch({ type: "stop" })}>Parar</button>}
            {!live && <button className="btn ghost sm" onClick={closeRun}>Fechar</button>}
          </div>
        </div>
      </>
    );
  }

  // ── lista ──
  if (view === "list" || !wf) {
    return (
      <>
        <div className="prompts-head">{tabs}</div>
        {!lib.workflows.length && (
          <div className="pane-empty">
            <p>Workflows são nós do diagrama: adicione um «Workflow» na paleta e ligue prompts a ele com setas step.</p>
          </div>
        )}
        <div className="prompts-list" role="list" aria-label="Workflows do diagrama">
          {lib.workflows.map((w) => (
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

  // ── formulário de execução ──
  return (
    <>
      <PaneHead title={wf.name} onBack={() => setView("list")} />
      <div className="pane-body">
        <div className="field">
          <span>Passos</span>
          {!wf.steps.length && <small className="hint">Sem passos. Ligue prompts a este workflow com setas step no diagrama.</small>}
          {wf.steps.map((s, i) => {
            const p = lib.prompts.find((x) => x.id === s.promptId);
            return (
              <div key={i} className="wf-step">
                <span className="wf-n">{i + 1}</span>
                <span className="wf-name" title={p?.text}>{p?.name ?? s.promptId}</span>
                <small>{s.mode === "auto" ? "auto" : "manual"}</small>
              </div>
            );
          })}
        </div>
        {vars.map((v) => (
          <label key={v} className="field">
            <span>{v}</span>
            <input className="input" value={values[v] ?? ""} onChange={(e) => setValues({ ...values, [v]: e.target.value })} />
          </label>
        ))}
        {(hasAuto || tools.length > 0) && (
          <details className="pane-more" open={allowedNow.length > 0}>
            <summary>Permissões{allowedNow.length > 0 && ` · ${allowedNow.length} liberada${allowedNow.length > 1 ? "s" : ""}`}</summary>
            {tools.length > 0 && (
              <fieldset className="field" style={{ border: 0, padding: 0, margin: "0 0 8px" }}>
                <legend className="lbl-s">Liberar sem perguntar <small className="opt">(ferramentas do diagrama)</small></legend>
                {tools.map((t) => (
                  <label key={t.name} style={{ display: "flex", gap: 8, alignItems: "center" }} title={t.hint}>
                    <input type="checkbox" checked={allowedNow.includes(t.name)} onChange={() => toggleAllowed(t.name)} />
                    <span>{t.label}</span>
                    <small className="opt">{t.hint}</small>
                  </label>
                ))}
                <small className="hint">Vale para todos os passos desta execução. Bash, Write e Edit não entram aqui: o Bash segue pedindo aprovação no terminal.</small>
              </fieldset>
            )}
            {hasAuto && (
              <>
                <select className="input" aria-label="Modo de permissão dos passos automáticos" value={perm} onChange={(e) => setPerm(e.target.value)}>
                  {PERMS.map((p) => (
                    <option key={p.v} value={p.v}>{p.label}</option>
                  ))}
                </select>
                <small className="hint">Passos automáticos não conseguem pedir aprovação: o que não estiver liberado acima (ou no modo) é negado.</small>
              </>
            )}
          </details>
        )}
        {msg && <div className="pane-msg">{msg}</div>}
      </div>
      <div className="pane-foot">
        <div className="pane-actions">
          <button className="btn primary sm" disabled={!wf.steps.length} onClick={start}>Executar</button>
          <button className="btn sm" onClick={() => onEdit(wf.id)} title="Seleciona o workflow no diagrama; os passos se editam no inspetor">Editar no diagrama</button>
        </div>
      </div>
    </>
  );
}
