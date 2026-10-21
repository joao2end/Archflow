/**
 * Execução de workflow no canvas (modo agents), no estilo do n8n: o nó Entrypoint dispara o workflow ligado a ele por uma seta
 * start; a entrada digitada aqui vira `{{entrada}}` e a saída de cada passo vira `{{saida_anterior}}` no seguinte.
 * Cada passo roda com `claude -p` numa aba do terminal (todos na mesma conversa), e o canvas acende o prompt, o agente e as
 * skills do passo em andamento. A lógica é a máquina de estados de `shared/workflow.ts` (ritmo «step» ou «run»); as
 * marcações vêm de `shared/agentrun.ts`. Aqui só se executam os efeitos e se mostra o painel de dados.
 * Cada execução fica no histórico do projeto (`.archflow/runs/`, ver `shared/runs.ts`), como as «Executions» do n8n: dá para
 * abrir uma antiga e retomar de um passo — vira uma execução nova, com a memória e os arquivos dos passos anteriores.
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { entrypointOf } from "../shared/agents";
import { harnessCheck, NO_MARKS, runMarks, workflowAgents, type NodeMark, type RunMarks } from "../shared/agentrun";
import { available, BLOCKED, canResumeAt, libraryFromDoc, NO_OUTPUT, reduce, RESULT_MAX, resumeAt, stampRun, startRun, stepInput, workflowVars, type Pace, type RunEffect, type RunEvent, type WorkflowRun } from "../shared/workflow";
import { createRecord, newRunId, refreshFromLibrary, settleRun, type RunRecord, type RunSummary } from "../shared/runs";
import { fetchRun, fetchRuns, resumeRunFiles, saveRunRecord, snapshotRunStep } from "./runsclient";
import { conversationDenials, conversationExists, fetchHarnessStatus, lastConversationText, missingOutputs, syncHarnessNow } from "./termclient";
import { allowableTools, loadAllowed, saveAllowed } from "./toolperms";
import { onTermExit } from "./termevents";
import { useStore } from "./store";
import type { TermApi } from "./workflow";

/* ── marcações para o canvas: um store mínimo fora do React, lido nó a nó ── */
let marks: RunMarks = NO_MARKS;
const subs = new Set<() => void>();
const subscribe = (fn: () => void) => (subs.add(fn), () => void subs.delete(fn));
function publishMarks(m: RunMarks) {
  marks = m;
  for (const fn of subs) fn();
}
export const useNodeRunMark = (id: string): NodeMark | undefined => useSyncExternalStore(subscribe, () => marks.nodes[id]);
export const useEdgeRunMark = (id: string): "flow" | undefined => useSyncExternalStore(subscribe, () => marks.edges[id]);

const ICON: Record<string, string> = { pending: "○", running: "◐", waiting: "●", done: "✓", failed: "✗", skipped: "–" };
const STATUS: Record<string, string> = { pending: "na fila", running: "rodando", waiting: "esperando", done: "concluído", failed: "falhou", skipped: "pulado" };
const CHIP: Record<WorkflowRun["state"] | "interrupted", string> = { running: "Rodando", waiting: "Aguardando", paused: "Pausado", failed: "Falhou", done: "Concluído", stopped: "Parado", interrupted: "Interrompida" };
const when = (ms: number) => new Date(ms).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

/** Modos aceitos pelo bridge (`SAFE_PERMISSION_MODES`); `acceptEdits` é o padrão no canvas porque os passos gravam arquivos. */
const PERM_LABEL: Record<string, string> = { acceptEdits: "Aceitar edições de arquivos", "": "Padrão (gravações negadas)", plan: "Só planejar, sem editar" };

const secs = (ms: number) => (ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`);

export function AgentRunPanel({ term }: { term?: TermApi }) {
  const doc = useStore((s) => s.doc);
  const sel = useStore((s) => s.sel);
  const entries = useMemo(() => doc.nodes.filter((n) => n.agent?.role === "entrypoint"), [doc.nodes]);
  const [entryId, setEntryId] = useState<string>();
  const [input, setInput] = useState("");
  /** demais variáveis {{nome}} dos prompts do workflow (formulário, como no painel de workflows) */
  const [values, setValues] = useState<Record<string, string>>({});
  const [missing, setMissing] = useState<string[]>([]);
  const [open, setOpen] = useState<number>();
  /** modal fechado: abre ao selecionar um Entrypoint no canvas; fechar não para a execução (o canvas segue animando) */
  const [closed, setClosed] = useState(true);
  const [msg, setMsg] = useState<string>();
  /** o .claude/ do projeto é de outro diagrama: a execução espera o usuário decidir (gravar o harness deste ou rodar assim mesmo) */
  const [block, setBlock] = useState<{ owner: string; agents: string[]; pace: Pace }>();
  const [busy, setBusy] = useState(false);
  const [run, setRunState] = useState<WorkflowRun | null>(null);
  const [, tick] = useState(0);
  const runRef = useRef<WorkflowRun | null>(null);
  /** registro desta execução no histórico do projeto (.archflow/runs/); ausente quando não há execução viva */
  const recRef = useRef<{ id: string; createdAt: number; entryId?: string; resumedFrom?: { id: string; step: number }; files: Record<string, string[]> } | undefined>(undefined);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [tab, setTab] = useState<"run" | "history">("run");
  const [history, setHistory] = useState<RunSummary[]>();
  /** execução do histórico aberta para ver e retomar */
  const [viewing, setViewing] = useState<RunRecord | null>(null);
  const [vOpen, setVOpen] = useState<number>();
  const [restoreFiles, setRestoreFiles] = useState(true);
  const execRef = useRef<{ id: string; stepIndex: number } | undefined>(undefined);
  const termRef = useRef(term);
  termRef.current = term;
  const docRef = useRef(doc);
  docRef.current = doc;
  // permissões dos passos: `claude -p` não consegue pedir aprovação, então o que não estiver liberado é negado
  const projectId = useStore((s) => s.workspace?.project.id);
  const [perm, setPerm] = useState("acceptEdits");
  const tools = allowableTools(doc);
  const [allowed, setAllowed] = useState<string[]>(() => loadAllowed(projectId));
  useEffect(() => setAllowed(loadAllowed(projectId)), [projectId]);
  const allowedNow = allowed.filter((a) => tools.some((t) => t.name === a));
  const permArgs = [...(perm ? ["--permission-mode", perm] : []), ...(allowedNow.length ? ["--allowedTools", allowedNow.join(",")] : [])];
  const permRef = useRef(permArgs);
  permRef.current = permArgs;
  const toggleAllowed = (name: string) => {
    const next = allowed.includes(name) ? allowed.filter((x) => x !== name) : [...allowed, name];
    setAllowed(next);
    saveAllowed(projectId, next);
  };

  // entrypoint em foco: o selecionado no canvas, senão o último usado, senão o primeiro
  const selEntry = sel.length === 1 ? entries.find((n) => n.id === sel[0]) : undefined;
  const selEntryId = selEntry?.id;
  useEffect(() => {
    if (!selEntryId) return;
    setClosed(false);
    if (!runRef.current) setEntryId(selEntryId);
  }, [selEntryId]);
  const entry = entries.find((n) => n.id === (run ? entryId : (selEntry?.id ?? entryId))) ?? entries[0];
  const wfId = entry && doc.connections.find((c) => c.from === entry.id && c.agent?.rel === "start")?.to;
  const wf = wfId ? doc.nodes.find((n) => n.id === wfId && n.agent?.role === "workflow") : undefined;

  /** Grava a execução viva no histórico (agrupando mudanças seguidas); falha de rede não atrapalha a execução. */
  const persist = useCallback(() => {
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      const r = runRef.current;
      const m = recRef.current;
      if (!r || !m) return;
      const rec = { ...createRecord(r, { id: m.id, now: m.createdAt, entryId: m.entryId, resumedFrom: m.resumedFrom, files: m.files }), updatedAt: Date.now() };
      void saveRunRecord(rec).catch(() => {});
    }, 400);
  }, []);
  const setRun = useCallback(
    (r: WorkflowRun | null) => {
      runRef.current = r;
      setRunState(r);
      publishMarks(runMarks(docRef.current, r));
      if (r && recRef.current) persist();
    },
    [persist],
  );
  // o diagrama mudou (seta nova, nó apagado): as marcações acompanham
  useEffect(() => publishMarks(runMarks(doc, runRef.current)), [doc]);
  useEffect(() => () => publishMarks(NO_MARKS), []);
  // relógio do passo em andamento
  const live = !!run && (run.state === "running" || run.state === "waiting");
  useEffect(() => {
    if (!live) return;
    const t = setInterval(() => tick((n) => n + 1), 250);
    return () => clearInterval(t);
  }, [live]);

  const dispatchRef = useRef<(ev: RunEvent) => void>(() => {});
  const doEffect = useCallback(async function exec(effect: RunEffect): Promise<void> {
    const r = runRef.current;
    if (!r || effect.type === "none") return;
    if (effect.type === "seq") {
      for (const e of effect.effects) await exec(e);
      return;
    }
    if (effect.type === "abort") {
      const e = execRef.current;
      execRef.current = undefined; // o fim deste processo não é «falha do passo»: foi a gente que parou
      if (e) await termRef.current?.closeSession(e.id);
      return;
    }
    // no canvas todo passo roda sozinho (startRun com allAuto): não há efeito «type»
    if (effect.type !== "exec") return;
    const t = termRef.current;
    if (!t) return dispatchRef.current({ type: "autoDone", code: -2 });
    // conversa já gravada (passo anterior, nova tentativa): retoma; senão cria com este id
    const fresh = !(await conversationExists(effect.sessionId));
    const title = `${r.workflowName} · ${effect.stepIndex + 1}/${r.steps.length}`;
    const s = await t.startExec(["-p", fresh ? "--session-id" : "--resume", effect.sessionId, ...permRef.current, "--", effect.text], title);
    if (!s) return dispatchRef.current({ type: "autoDone", code: -2 }); // não abriu (limite de abas, claude ausente…)
    if (runRef.current?.steps[effect.stepIndex]?.status !== "running") return void (await t.closeSession(s.id)); // parou enquanto abria
    execRef.current = { id: s.id, stepIndex: effect.stepIndex };
  }, []);
  const dispatch = useCallback(
    (ev: RunEvent) => {
      const cur = runRef.current;
      if (!cur) return;
      const out = reduce(cur, ev);
      setRun(stampRun(cur, out.run, Date.now()));
      void doEffect(out.effect);
    },
    [doEffect, setRun],
  );
  dispatchRef.current = dispatch;

  /** Guarda a saída do passo (última resposta da conversa); ignora a que já era de outro passo (o passo não respondeu nada). */
  const capture = useCallback(async (stepIndex: number) => {
    const r = runRef.current;
    if (!r) return;
    const text = (await lastConversationText(r.sessionId))?.trim().slice(0, RESULT_MAX);
    const now = runRef.current;
    if (!text || !now || now.steps.some((s, i) => i !== stepIndex && s.result === text)) return;
    dispatchRef.current({ type: "result", stepIndex, text });
  }, []);

  useEffect(
    () =>
      onTermExit((id, code) => {
        const e = execRef.current;
        if (e?.id !== id) return;
        execRef.current = undefined;
        // a saída entra na memória ANTES do passo seguinte ser montado: ele a recebe em {{saida_anterior}}
        void (async () => {
          if (code !== 0) return dispatchRef.current({ type: "autoDone", code });
          await capture(e.stepIndex);
          // saiu com 0, mas pode ter ficado sem gravar nada: ferramenta negada por permissão conta como falha do passo
          const r = runRef.current;
          // contornada (outro caminho deu certo) vira aviso e o passo conclui; gravação que nunca aconteceu falha o passo
          const step = r?.steps[e.stepIndex];
          const rep = r ? await conversationDenials(r.sessionId, step?.startedAt ?? 0) : { denials: [], warnings: [] };
          // saídas esperadas: cada padrão precisa de um arquivo gravado depois do início do passo
          const miss = step?.expects?.length ? await missingOutputs(step.expects, step.startedAt ?? 0) : [];
          const warnings = miss ? rep.warnings : [...rep.warnings, "não deu para conferir as saídas esperadas (o servidor do Archflow não respondeu)"];
          if (rep.denials.length || warnings.length) dispatchRef.current({ type: "denied", stepIndex: e.stepIndex, items: rep.denials, warnings });
          if (rep.denials.length) return dispatchRef.current({ type: "autoDone", code: BLOCKED });
          if (miss?.length) {
            dispatchRef.current({ type: "missing", stepIndex: e.stepIndex, items: miss });
            return dispatchRef.current({ type: "autoDone", code: NO_OUTPUT });
          }
          // guarda os arquivos que o passo gerou ANTES do próximo começar (ele pode sobrescrevê-los): é o que permite retomar depois
          const m = recRef.current;
          if (m && step?.expects?.length) {
            const snap = await snapshotRunStep(m.id, e.stepIndex, step.expects, step.startedAt ?? 0).catch(() => undefined);
            if (snap && recRef.current?.id === m.id) m.files = { ...m.files, [String(e.stepIndex)]: snap.files };
          }
          dispatchRef.current({ type: "autoDone", code: 0 });
        })();
      }),
    [capture],
  );

  const lib = useMemo(() => libraryFromDoc(doc), [doc]);
  const allVars = wf ? workflowVars(lib, wf.id) : [];
  const usesEntrada = allVars.includes("entrada");
  const vars = allVars.filter((v) => v !== "entrada");

  /** `harness`: "check" confere o .claude/ do projeto antes; "skip" roda direto (o usuário já decidiu). */
  const begin = async (pace: Pace, harness: "check" | "skip" = "check") => {
    if (!entry || !wf || busy) return;
    const vals = Object.fromEntries(vars.map((v) => [v, values[v]?.trim() ?? ""]));
    const r = startRun(lib, wf.id, vals, crypto.randomUUID(), { pace, allAuto: true, entrada: input });
    if (!r.ok) {
      setMissing(r.missing ?? []);
      if (!r.missing?.length) return setMsg(r.error);
      // na ordem em que os campos aparecem: a entrada primeiro
      const order = ["entrada", ...vars].filter((v) => r.missing!.includes(v));
      setMsg(`Preencha ${order.length === 1 ? "o campo" : "os campos"}: ${order.join(", ")}.`);
      return void document.querySelector<HTMLElement>(`.run-panel [data-var="${CSS.escape(order[0])}"]`)?.focus();
    }
    setMissing([]);
    setMsg(undefined);
    setBlock(undefined);
    if (harness === "check") {
      // os prompts dizem «Use o subagente X»: se X não está no .claude/agents do projeto, o Claude faz o trabalho sozinho
      setBusy(true);
      const chk = harnessCheck(await fetchHarnessStatus().catch(() => undefined), workflowAgents(r.run));
      if (chk.kind === "sync") {
        const s = await syncHarnessNow().catch((e: unknown) => setMsg(`Não deu para atualizar o .claude/ do projeto: ${e instanceof Error ? e.message : String(e)}`));
        if (s?.conflicts.length) setMsg(`Arquivos editados à mão no .claude/ ficaram como estavam: ${s.conflicts.join(", ")}.`);
      }
      setBusy(false);
      if (chk.kind === "foreign") return setBlock({ owner: chk.owner, agents: chk.agents, pace });
    }
    setEntryId(entry.id);
    setOpen(undefined);
    recRef.current = { id: newRunId(), createdAt: Date.now(), entryId: entry.id, files: {} };
    setRun(stampRun({ ...r.run, steps: r.run.steps.map((s) => ({ ...s, status: "pending" as const })) }, r.run, Date.now()));
    void doEffect(r.effect);
  };

  /** «Gravar o harness deste diagrama»: o .claude/ do projeto passa a ser deste diagrama e então roda. */
  const takeHarness = async () => {
    if (!block) return;
    setBusy(true);
    try {
      const s = await syncHarnessNow();
      if (s.conflicts.length) setMsg(`Arquivos editados à mão no .claude/ ficaram como estavam: ${s.conflicts.join(", ")}.`);
    } catch (e) {
      setBusy(false);
      return setMsg(`Não deu para gravar o harness: ${e instanceof Error ? e.message : String(e)}`);
    }
    setBusy(false);
    void begin(block.pace, "skip");
  };
  const label = (id: string) => doc.nodes.find((n) => n.id === id)?.label ?? id;

  /* ── histórico ── */
  const openHistory = () => {
    setTab("history");
    setViewing(null);
    setMsg(undefined);
    if (!wf) return setHistory([]);
    fetchRuns(wf.id).then(setHistory, (e: unknown) => (setHistory([]), setMsg(`Não deu para ler o histórico: ${e instanceof Error ? e.message : String(e)}`)));
  };
  const openRecord = (id: string) =>
    fetchRun(id).then(
      (r) => (setViewing(r), setVOpen(undefined)),
      (e: unknown) => setMsg(`Não deu para abrir a execução: ${e instanceof Error ? e.message : String(e)}`),
    );
  /**
   * «Retomar daqui»: execução NOVA a partir do passo `i` de uma do histórico. Os passos anteriores levam a resposta (memória)
   * e, se marcado, os arquivos que geraram naquela execução voltam ao projeto; daí em diante valem os prompts atuais do diagrama.
   */
  const resume = async (rec: RunRecord, i: number) => {
    if (busy || (run && (run.state === "running" || run.state === "waiting"))) return;
    const fresh = refreshFromLibrary(settleRun(rec.run), lib, i);
    const out = resumeAt(fresh.run, i, crypto.randomUUID());
    if (!out) return setMsg("Só dá para retomar num passo cujos anteriores terminaram.");
    setBusy(true);
    setMsg(undefined);
    const chk = harnessCheck(await fetchHarnessStatus().catch(() => undefined), workflowAgents(out.run));
    if (chk.kind === "sync") await syncHarnessNow().catch(() => undefined);
    if (chk.kind === "foreign") {
      setBusy(false);
      return setMsg(`O .claude/ do projeto é do diagrama «${chk.owner.replace(/\.archflow\.json$/, "")}»: os subagentes deste workflow não estão lá. Use Executar na aba Execução para decidir.`);
    }
    const id = newRunId();
    const notes: string[] = [];
    if (fresh.refreshed) notes.push("Os passos refeitos usam os prompts atuais do diagrama.");
    let files: Record<string, string[]> = {};
    try {
      const r = await resumeRunFiles(rec.id, id, i, restoreFiles);
      files = r.files;
      if (r.restored.length) notes.push(`Arquivos daquela execução devolvidos ao projeto: ${r.restored.join(", ")}.`);
    } catch (e) {
      notes.push(`Os arquivos guardados não foram copiados (${e instanceof Error ? e.message : String(e)}).`);
    }
    setBusy(false);
    recRef.current = { id, createdAt: Date.now(), entryId: rec.entryId, resumedFrom: { id: rec.id, step: i }, files };
    if (rec.entryId) setEntryId(rec.entryId);
    setInput(rec.run.entrada ?? "");
    setValues(Object.fromEntries(Object.entries(rec.run.values).filter(([k]) => k !== "entrada")));
    setViewing(null);
    setTab("run");
    setOpen(undefined);
    setHistory(undefined);
    setMsg(notes.join(" ") || undefined);
    const before = { ...out.run, steps: out.run.steps.map((s, j) => (j === i ? { ...s, status: "pending" as const } : s)) };
    setRun(stampRun(before, out.run, Date.now()));
    void doEffect(out.effect);
  };

  if (!entries.length || closed) return null; // sem entrypoint no diagrama (ou fechado), o painel não aparece
  const av = run ? available(run) : undefined;
  const ended = !run || run.state === "done" || run.state === "stopped";
  const agentName = (promptId: string) => {
    const c = doc.connections.find((x) => x.from === promptId && x.agent?.rel === "runs-on");
    return c ? (doc.nodes.find((n) => n.id === c.to)?.label ?? c.to) : undefined;
  };
  const elapsed = (s: WorkflowRun["steps"][number]) => (!s.startedAt ? "" : s.endedAt ? secs(s.endedAt - s.startedAt) : s.status === "running" || s.status === "waiting" ? secs(Date.now() - s.startedAt) : "");

  /** Lista de passos com o painel de dados: a mesma para a execução viva e para uma aberta do histórico. */
  const stepList = (r: WorkflowRun, o: { current: number; open?: number; setOpen: (i: number | undefined) => void; resumedAt?: number; files?: Record<string, string[]>; resume?: (i: number) => void }) => (
    <ol className="run-steps" aria-live="polite">
      {r.steps.map((s, i) => {
        const isOpen = o.open === i || (o.open === undefined && i === o.current);
        const agent = agentName(s.promptId);
        return (
          <li key={i} className={`run-step ${s.status}${i === o.current ? " cur" : ""}`}>
            <button className="run-step-head" aria-expanded={isOpen} onClick={() => o.setOpen(isOpen ? -1 : i)}>
              <span className="wf-ico" aria-hidden>{ICON[s.status]}</span>
              <span className="run-step-name">{i + 1}. {s.name}</span>
              {agent && <small className="run-agent">{agent}</small>}
              <small className="run-time">{elapsed(s)}</small>
              <small className="run-status">{s.code === BLOCKED ? "bloqueado: permissão" : s.code === NO_OUTPUT ? "falhou: não gerou a saída" : STATUS[s.status]}{s.status === "done" && s.warnings ? " · com avisos" : ""}{o.resumedAt !== undefined && i < o.resumedAt ? " · da execução anterior" : ""}{s.status === "failed" && s.code !== undefined && s.code !== BLOCKED && s.code !== NO_OUTPUT ? ` · código ${s.code}` : ""}</small>
            </button>
            {o.resume && canResumeAt(r, i) && (
              <button className="btn ghost sm run-resume" disabled={busy || live} title="Cria uma execução nova a partir deste passo, com a memória e os arquivos dos passos anteriores" onClick={() => o.resume!(i)}>↻ Retomar daqui</button>
            )}
            {isOpen && (
              <dl className="run-data">
                <dt>Entrada</dt>
                <dd><pre>{stepInput(r, i) || "—"}</pre></dd>
                <dt>Prompt renderizado</dt>
                <dd><pre>{s.status === "pending" && i !== o.current ? "(montado quando o passo começar)" : s.text}</pre></dd>
                {s.denied && (
                  <>
                    <dt>Negado por permissão</dt>
                    <dd className="run-denied">
                      <ul>{s.denied.map((d) => <li key={d}>{d}</li>)}</ul>
                      <small className="hint">O agente não conseguiu gravar isso e não achou outro caminho, então o passo não terminou o trabalho. Confira Permissões e clique em Tentar de novo.</small>
                    </dd>
                  </>
                )}
                {s.missing && (
                  <>
                    <dt>Não gerou</dt>
                    <dd className="run-denied">
                      <ul>{s.missing.map((d) => <li key={d}><code>{d}</code></li>)}</ul>
                      <small className="hint">O passo terminou sem gravar estes arquivos (saídas esperadas da seta step). Veja na aba dele no terminal o que deu errado e clique em Tentar de novo.</small>
                    </dd>
                  </>
                )}
                {s.warnings && (
                  <>
                    <dt>Negado, mas contornado</dt>
                    <dd className="run-warned">
                      <ul>{s.warnings.map((d) => <li key={d}>{d}</li>)}</ul>
                      <small className="hint">O agente teve isso negado e seguiu por outro caminho; o passo concluiu. Bash nunca é liberado nos passos do canvas.</small>
                    </dd>
                  </>
                )}
                {o.files?.[String(i)]?.length ? (
                  <>
                    <dt>Arquivos guardados</dt>
                    <dd>
                      <ul className="run-files">{o.files[String(i)].map((f) => <li key={f}><code>{f}</code></li>)}</ul>
                    </dd>
                  </>
                ) : null}
                <dt>Saída</dt>
                <dd><pre>{s.result ?? (s.status === "running" ? "…" : s.status === "failed" ? s.code === NO_OUTPUT ? `O passo não gerou: ${s.missing?.join(", ") ?? "as saídas esperadas"}.` : `O passo falhou${s.code === -2 ? ": a aba do terminal não abriu" : s.code === -1 ? ": a sessão terminou antes do fim (aba fechada ou servidor do Archflow reiniciado); a conversa ficou salva e Tentar de novo a retoma" : ` com código ${s.code}`}. Veja o motivo na aba dele no terminal.` : "—")}</pre></dd>
              </dl>
            )}
          </li>
        );
      })}
    </ol>
  );
  const liveId = recRef.current?.id;
  const settledState = (id: string, st: WorkflowRun["state"]) => (id !== liveId && (st === "running" || st === "waiting" || st === "paused") ? ("interrupted" as const) : st);
  const vrun = viewing ? (viewing.id === liveId && run ? run : settleRun(viewing.run)) : null;
  const historyView =
    viewing && vrun ? (
      <div className="run-view">
        <div className="run-view-head">
          <button className="btn ghost sm" onClick={() => setViewing(null)}>← Histórico</button>
          <strong>{when(viewing.createdAt)}</strong>
          <span className={`wf-chip ${vrun.state}`}>{CHIP[settledState(viewing.id, viewing.run.state) === "interrupted" ? "interrupted" : vrun.state]}</span>
        </div>
        {viewing.run.entrada && <small className="hint">Entrada: {viewing.run.entrada}</small>}
        {viewing.resumedFrom && (
          <small className="hint">
            Retomada do passo {viewing.resumedFrom.step + 1} de <button className="link" onClick={() => void openRecord(viewing.resumedFrom!.id)}>uma execução anterior</button>.
          </small>
        )}
        {Object.keys(viewing.files ?? {}).length > 0 && (
          <label className="run-perm-tool">
            <input type="checkbox" checked={restoreFiles} onChange={(e) => setRestoreFiles(e.target.checked)} />
            <span>Ao retomar, devolver ao projeto os arquivos que esta execução gerou antes do passo</span>
          </label>
        )}
        <small className="hint">Retomar cria uma execução nova a partir do passo escolhido; esta fica como está. Os passos anteriores levam a resposta que tiveram aqui e os refeitos usam os prompts atuais do diagrama.</small>
        {stepList(vrun, { current: -1, open: vOpen, setOpen: setVOpen, resumedAt: viewing.resumedFrom?.step, files: viewing.files, resume: viewing.id === liveId && live ? undefined : (i) => void resume(viewing, i) })}
      </div>
    ) : (
      <div className="run-history">
        {!history ? (
          <small className="hint">Carregando…</small>
        ) : !history.length ? (
          <small className="hint">Nenhuma execução deste workflow ainda.</small>
        ) : (
          <ul>
            {history.map((h) => {
              const st = settledState(h.id, h.state);
              return (
                <li key={h.id}>
                  <button className="run-hist-item" onClick={() => void openRecord(h.id)}>
                    <span className={`wf-chip ${st}`}>{CHIP[st]}</span>
                    <span className="run-hist-when">{when(h.createdAt)}</span>
                    <small>
                      {h.done}/{h.total} passos{h.failedAt !== undefined ? ` · parou no ${h.failedAt + 1}` : ""}
                      {h.resumedFrom ? ` · retomada do passo ${h.resumedFrom.step + 1}` : ""}
                      {h.files ? ` · ${h.files} arquivo${h.files > 1 ? "s" : ""}` : ""}
                    </small>
                    {h.entrada && <small className="run-hist-in">{h.entrada}</small>}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    );

  return (
    <section className="glass run-panel" role="dialog" aria-label="Execução do workflow" onKeyDown={(e) => e.key === "Escape" && (e.stopPropagation(), setClosed(true))}>
      <header className="run-head">
        <span className="run-play" aria-hidden>▶</span>
        <div className="run-title">
          <strong>{entry?.label ?? "Entrypoint"}</strong>
          <small>{wf ? `→ ${wf.label}` : "sem workflow: ligue o entrypoint a um workflow com uma seta start"}</small>
        </div>
        {tab === "run" && run && <span className={`wf-chip ${run.state}`}>{CHIP[run.state]}</span>}
        <button className="btn ghost icon sm run-close" aria-label="Fechar o painel de execução" title={live ? "Fechar (a execução continua; selecione o Entrypoint para reabrir)" : "Fechar (selecione o Entrypoint para reabrir)"} onClick={() => setClosed(true)}>×</button>
      </header>
      <div className="run-tabs" role="tablist" aria-label="Execução atual ou histórico">
        <button role="tab" aria-selected={tab === "run"} className={tab === "run" ? "on" : ""} onClick={() => (setTab("run"), setViewing(null), setMsg(undefined))}>Execução</button>
        <button role="tab" aria-selected={tab === "history"} className={tab === "history" ? "on" : ""} onClick={openHistory}>Histórico</button>
      </div>
      {tab === "run" && (
        <>
      <label className="run-field">
        <span>Entrada{!usesEntrada && wf && <small className="opt"> · opcional, nenhum prompt usa {"{{entrada}}"}</small>}</span>
        <textarea className="input" rows={2} value={input} data-var="entrada" aria-invalid={missing.includes("entrada") || undefined} disabled={!ended} placeholder="Vira {{entrada}} nos prompts" onChange={(e) => setInput(e.target.value)} />
      </label>
      {vars.map((v) => (
        <label key={v} className="run-field">
          <span>{v}</span>
          <input className="input" value={values[v] ?? ""} data-var={v} aria-invalid={missing.includes(v) || undefined} disabled={!ended} placeholder={`Vira {{${v}}} nos prompts`} onChange={(e) => (setValues({ ...values, [v]: e.target.value }), setMissing((m) => m.filter((x) => x !== v)))} />
        </label>
      ))}
      <details className="run-perms" open={perm !== "acceptEdits" || allowedNow.length > 0 || !!run?.steps.some((s) => s.denied)}>
        <summary>Permissões · {PERM_LABEL[perm] ?? perm}{allowedNow.length > 0 && ` · ${allowedNow.length} ferramenta${allowedNow.length > 1 ? "s" : ""} liberada${allowedNow.length > 1 ? "s" : ""}`}</summary>
        <select className="input" aria-label="Modo de permissão dos passos" value={perm} disabled={!ended && !av?.retry} onChange={(e) => setPerm(e.target.value)}>
          {Object.entries(PERM_LABEL).map(([v, l]) => (
            <option key={v} value={v}>{l}</option>
          ))}
        </select>
        {tools.map((t) => (
          <label key={t.name} className="run-perm-tool" title={t.hint}>
            <input type="checkbox" checked={allowedNow.includes(t.name)} onChange={() => toggleAllowed(t.name)} />
            <span>{t.label}</span>
            <small className="opt">{t.hint}</small>
          </label>
        ))}
        <small className="hint">Cada passo roda sem poder pedir aprovação: o que não estiver liberado é negado. Bash nunca é liberado aqui.</small>
      </details>
      <div className="run-actions">
        {ended && !block && (
          <>
            <button className="btn primary sm" disabled={!wf || busy} onClick={() => void begin("step")} title="Roda o primeiro passo e pausa; siga com Próximo passo">Executar</button>
            <button className="btn sm" disabled={!wf || busy} onClick={() => void begin("run")} title="Roda todos os passos em sequência">Executar até o fim</button>
          </>
        )}
        {av?.next && <button className="btn primary sm" onClick={() => dispatch({ type: "next" })}>Próximo passo</button>}
        {av?.run && <button className="btn sm" onClick={() => dispatch({ type: "run" })}>Executar até o fim</button>}
        {av?.retry && <button className="btn primary sm" onClick={() => dispatch({ type: "retry" })}>Tentar de novo</button>}
        {av?.stop && <button className="btn ghost sm" onClick={() => dispatch({ type: "stop" })}>Parar</button>}
        {run && ended && <button className="btn ghost sm" onClick={() => ((recRef.current = undefined), setRun(null))}>Limpar</button>}
      </div>
      {block && (
        <div className="run-warn" role="alert">
          <p>
            Os subagentes deste workflow ({block.agents.map(label).join(", ")}) não estão no <code>.claude/agents</code> do projeto: ele foi gravado pelo diagrama «{block.owner.replace(/\.archflow\.json$/, "")}». Sem eles, o Claude faz cada passo sozinho, sem o prompt, as skills e as ferramentas de cada agente.
          </p>
          <p className="hint">Gravar o harness deste diagrama troca o time do projeto: os subagentes de «{block.owner.replace(/\.archflow\.json$/, "")}» saem do <code>.claude/</code> (arquivos editados à mão ficam).</p>
          <div className="run-actions">
            <button className="btn primary sm" disabled={busy} onClick={() => void takeHarness()}>Gravar o harness deste diagrama e executar</button>
            <button className="btn sm" disabled={busy} onClick={() => void begin(block.pace, "skip")}>Executar sem os subagentes</button>
            <button className="btn ghost sm" disabled={busy} onClick={() => setBlock(undefined)}>Cancelar</button>
          </div>
        </div>
      )}
        </>
      )}
      {msg && <div className="pane-msg" role="alert">{msg}</div>}
      {tab === "run" && run && (
        <>
          {recRef.current?.resumedFrom && <small className="hint run-resumed">Retomada do passo {recRef.current.resumedFrom.step + 1} de uma execução anterior (veja no Histórico).</small>}
          {stepList(run, { current: run.current, open, setOpen, resumedAt: recRef.current?.resumedFrom?.step, files: recRef.current?.files })}
        </>
      )}
      {tab === "history" && historyView}
    </section>
  );
}
