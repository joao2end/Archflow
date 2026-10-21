/**
 * Núcleo do workflow de prompts: uma execução (`WorkflowRun`) é uma máquina de estados pura. Quem a usa (a UI e o
 * terminal) só a alimenta com eventos e executa os efeitos que ela devolve; nada aqui toca em processo, tempo ou rede.
 *
 *  - passo **manual**: o texto é digitado numa sessão interativa (efeito `type`) e o usuário confirma com Enter; o passo
 *    fica `waiting` até o evento `next` («Próximo passo»);
 *  - passo **auto**: o passo roda sozinho (efeito `exec`) e fica `running` até `autoDone`; código 0 avança, outro código
 *    para a execução em `failed` (dá para `retry`, `skip` ou `restart`).
 * TODOS os passos compartilham uma conversa do Claude Code (`sessionId`): quem executa abre cada processo com
 * `--session-id` (o primeiro) ou `--resume` (os seguintes) e nunca deixa dois processos na mesma conversa ao mesmo tempo.
 * Cada passo guarda o texto JÁ renderizado (variáveis preenchidas, prefixo do agente) no início: editar a biblioteca
 * no meio da execução não muda o que está rodando.
 */
import { workflowSteps } from "./agents";
import { emptyLibrary, promptVars, renderPrompt, type PromptLibrary, type StepMode } from "./prompts";
import type { Doc } from "./schema";

/**
 * Biblioteca de execução tirada do diagrama (modo agents): cada nó `prompt` vira um prompt (o `agent` vem da seta runs-on) e
 * cada nó `workflow` vira um workflow cujos passos são as setas step, em ordem. Os ids são os dos nós.
 */
export function libraryFromDoc(doc: Doc): PromptLibrary {
  const lib = emptyLibrary();
  for (const n of doc.nodes) {
    if (n.agent?.role !== "prompt") continue;
    const agent = doc.connections.find((c) => c.from === n.id && c.agent?.rel === "runs-on" && doc.nodes.some((a) => a.id === c.to && a.agent?.role === "agent"))?.to;
    lib.prompts.push({ id: n.id, name: n.label, text: n.agent.text ?? "", ...(agent ? { agent } : {}), ...(n.agent.description ? { notes: n.agent.description } : {}) });
  }
  for (const n of doc.nodes) {
    if (n.agent?.role !== "workflow") continue;
    lib.workflows.push({ id: n.id, name: n.label, steps: workflowSteps(doc, n.id).map((s) => ({ promptId: s.prompt.id, mode: s.mode, ...(s.expects ? { expects: s.expects } : {}) })) });
  }
  return lib;
}

export type StepStatus = "pending" | "running" | "waiting" | "done" | "failed" | "skipped";
/** `step`: ao fim de cada passo automático a execução pausa e espera «Próximo passo»; `run`: segue até o fim (ou até falhar). */
export type Pace = "step" | "run";
export type RunState = "running" | "waiting" | "paused" | "failed" | "done" | "stopped";

/** Limite da resposta guardada por passo (a memória do workflow). */
export const RESULT_MAX = 20_000;
/** Quantas respostas de tentativas anteriores cada passo guarda. */
export const HISTORY_MAX = 5;

/** Refaz o passo: a resposta atual vai para o histórico (não se perde) e a memória do passo fica vazia até a nova resposta. */
const redo = (s: RunStep): RunStep => ({ ...s, status: "pending", code: undefined, result: undefined, denied: undefined, warnings: undefined, missing: undefined, ...(s.result ? { history: [...(s.history ?? []), s.result].slice(-HISTORY_MAX) } : {}) });

export interface RunStep {
  promptId: string;
  name: string;
  mode: StepMode;
  /** texto do prompt, com as variáveis ainda por preencher */
  raw: string;
  /** subagente do prompt (prefixa o texto) */
  agent?: string;
  /** texto final deste passo: renderizado ao ENTRAR no passo, já com as respostas dos passos anteriores (`{{anterior}}`, `{{resultado.id}}`) */
  text: string;
  /** o que o agente respondeu neste passo (memória do workflow); ausente enquanto não houver */
  result?: string;
  /** respostas de tentativas anteriores deste passo (de «Voltar» ou «Rodar de novo»), da mais antiga para a mais nova: histórico, não memória */
  history?: string[];
  status: StepStatus;
  /** código de saída do passo auto, quando terminou */
  code?: number;
  /** ferramentas negadas por falta de permissão neste passo (o processo saiu com 0, mas o trabalho não foi feito) */
  denied?: string[];
  /** negações que o agente contornou: o passo conclui, mas com aviso */
  warnings?: string[];
  /** saídas esperadas (`expects` da seta step, copiadas no início da execução): padrões de arquivo que o passo precisa gravar */
  expects?: string[];
  /** padrões de `expects` sem arquivo gravado durante o passo (o processo saiu com 0, mas não gerou a saída) */
  missing?: string[];
  /** instantes (ms) em que o passo começou e terminou; carimbados pelo chamador (ver `stampRun`), não pelo reducer */
  startedAt?: number;
  endedAt?: number;
}

export interface WorkflowRun {
  workflowId: string;
  workflowName: string;
  /** conversa do Claude Code compartilhada pelos passos auto (`--session-id` / `--resume`) */
  sessionId: string;
  /** variáveis preenchidas pelo usuário no início */
  values: Record<string, string>;
  steps: RunStep[];
  /** índice do passo atual; -1 quando a execução terminou ou foi parada (em `paused`, é o próximo passo, ainda não rodado) */
  current: number;
  state: RunState;
  /** ritmo da execução (ver `Pace`); ausente = `run` */
  pace?: Pace;
  /** entrada do ponto de entrada (canvas): vira `{{entrada}}` no primeiro passo; ausente quando a execução não tem entrypoint */
  entrada?: string;
}

export type RunEffect =
  | { type: "none" }
  /** digitar `text` numa sessão interativa (sem Enter) e esperar o usuário; `first`/`sessionId` como em `exec` */
  | { type: "type"; stepIndex: number; text: string; sessionId: string; first: boolean }
  /** rodar `text` sozinho; `first` = a conversa ainda não existe (usar `--session-id` em vez de `--resume`) */
  | { type: "exec"; stepIndex: number; text: string; sessionId: string; first: boolean }
  /** interromper o processo do passo auto em andamento */
  | { type: "abort"; stepIndex: number }
  /** vários efeitos em sequência (voltar para um passo com um automático rodando: aborta e então entra no passo) */
  | { type: "seq"; effects: RunEffect[] };

export type RunEvent =
  | { type: "next" }
  | { type: "skip" }
  | { type: "stop" }
  | { type: "retry" }
  | { type: "restart" }
  | { type: "autoDone"; code: number }
  /** o passo rodou mas teve ferramentas negadas por permissão: guarda quais (o chamador encerra o passo com `BLOCKED`) */
  | { type: "denied"; stepIndex: number; items: string[]; warnings?: string[] }
  /** o passo saiu com 0 mas não gravou estas saídas esperadas (o chamador encerra o passo com `NO_OUTPUT`) */
  | { type: "missing"; stepIndex: number; items: string[] }
  /** «Executar até o fim»: a execução passa a seguir sem pausa; se estava pausada, retoma já */
  | { type: "run" }
  /** volta para o passo `index` (refazer daí em diante); os passos a partir dele voltam a pendentes e perdem a resposta */
  | { type: "goto"; index: number }
  /** guarda o que o agente respondeu no passo (lido da conversa); não muda o estado nem gera efeito */
  | { type: "result"; stepIndex: number; text: string };

const NONE: RunEffect = { type: "none" };
/** Código de saída sintético: o processo terminou bem, mas ferramentas foram negadas por permissão (o passo conta como falha). */
export const BLOCKED = -3;
/** Código de saída sintético: o processo terminou bem, mas não gravou alguma das saídas esperadas do passo (`expects`). */
export const NO_OUTPUT = -4;

/** Memória visível ao passo `i`: a resposta do passo anterior com resposta e a de cada prompt (a mais recente). */
export function memoryValues(run: WorkflowRun, i: number): Record<string, string> {
  const out: Record<string, string> = {};
  let anterior = "";
  for (let j = 0; j < i; j++) {
    const r = run.steps[j].result;
    if (!r) continue;
    anterior = r;
    out[`resultado.${run.steps[j].promptId}`] = r;
  }
  out.anterior = anterior;
  out.saida_anterior = anterior;
  return out;
}

const renderStep = (run: WorkflowRun, i: number): string => renderPrompt({ text: run.steps[i].raw, agent: run.steps[i].agent }, { ...run.values, ...memoryValues(run, i) }).text;

/**
 * A conversa já existe antes do passo `i`? Existe se algum passo anterior foi concluído (manual: o usuário confirmou que
 * conversou; automático: rodou) ou se um automático chegou a rodar e falhou. Passo pulado não conta.
 */
const conversationStarted = (run: WorkflowRun, i: number) => run.steps.slice(0, i).some((x) => x.status === "done" || (x.mode === "auto" && x.code !== undefined));

/** Variáveis `{{nome}}` que o workflow inteiro pede (união dos passos, sem repetir): um só formulário no início. */
export function workflowVars(lib: PromptLibrary, workflowId: string): string[] {
  const wf = lib.workflows.find((w) => w.id === workflowId);
  const out: string[] = [];
  for (const s of wf?.steps ?? []) {
    const p = lib.prompts.find((x) => x.id === s.promptId);
    for (const v of p ? promptVars(p.text) : []) if (!out.includes(v)) out.push(v);
  }
  return out;
}

export type StartResult = { ok: true; run: WorkflowRun; effect: RunEffect } | { ok: false; error: string; missing?: string[] };

/** Monta a execução e já entra no primeiro passo. Falha (sem lançar) se faltar variável, prompt ou passo. */
export function startRun(lib: PromptLibrary, workflowId: string, values: Record<string, string>, sessionId: string, opts: { pace?: Pace; allAuto?: boolean; entrada?: string } = {}): StartResult {
  const wf = lib.workflows.find((w) => w.id === workflowId);
  if (!wf) return { ok: false, error: `workflow «${workflowId}» não existe` };
  // a entrada do ponto de entrada vale como a variável {{entrada}}
  if (opts.entrada !== undefined) values = { ...values, entrada: opts.entrada };
  if (!wf.steps.length) return { ok: false, error: `o workflow «${wf.name}» está sem passos` };
  const steps: RunStep[] = [];
  const missing: string[] = [];
  for (const s of wf.steps) {
    const p = lib.prompts.find((x) => x.id === s.promptId);
    if (!p) return { ok: false, error: `o prompt «${s.promptId}» do workflow «${wf.name}» não existe mais` };
    const r = renderPrompt(p, values);
    for (const m of r.missing) if (!missing.includes(m)) missing.push(m);
    steps.push({ promptId: p.id, name: p.name, mode: opts.allAuto ? "auto" : s.mode, raw: p.text, ...(p.agent ? { agent: p.agent } : {}), ...(s.expects?.length ? { expects: [...s.expects] } : {}), text: r.text, status: "pending" });
  }
  if (missing.length) return { ok: false, error: `preencha as variáveis: ${missing.join(", ")}`, missing };
  const { run, effect } = enter({ workflowId: wf.id, workflowName: wf.name, sessionId, values, steps, current: -1, state: "running", pace: opts.pace ?? "run", ...(opts.entrada !== undefined ? { entrada: opts.entrada } : {}) }, 0);
  return { ok: true, run, effect };
}

const withStep = (run: WorkflowRun, i: number, patch: Partial<RunStep>): WorkflowRun => ({ ...run, steps: run.steps.map((s, j) => (j === i ? { ...s, ...patch } : s)) });

/** Entra no passo `i` (ou termina se não há mais). */
function enter(run: WorkflowRun, i: number, startedBefore?: boolean): { run: WorkflowRun; effect: RunEffect } {
  if (i >= run.steps.length) return { run: { ...run, current: -1, state: "done" }, effect: NONE };
  run = withStep(run, i, { text: renderStep(run, i), denied: undefined, warnings: undefined, missing: undefined });
  const s = run.steps[i];
  const first = startedBefore === undefined ? !conversationStarted(run, i) : !startedBefore;
  if (s.mode === "auto") {
    return { run: { ...withStep(run, i, { status: "running", code: undefined }), current: i, state: "running" }, effect: { type: "exec", stepIndex: i, text: s.text, sessionId: run.sessionId, first } };
  }
  return { run: { ...withStep(run, i, { status: "waiting", code: undefined }), current: i, state: "waiting" }, effect: { type: "type", stepIndex: i, text: s.text, sessionId: run.sessionId, first } };
}

/** Aplica um evento. Evento que não faz sentido no estado atual é ignorado (devolve a mesma execução, sem efeito). */
export function reduce(run: WorkflowRun, ev: RunEvent): { run: WorkflowRun; effect: RunEffect } {
  const i = run.current;
  const cur = i >= 0 ? run.steps[i] : undefined;
  const same = { run, effect: NONE };
  switch (ev.type) {
    case "next":
      // «Próximo passo»: passo manual esperando, ou execução pausada (passo automático já concluído, o próximo ainda não rodou)
      if (run.state === "paused") return enter(run, run.current);
      if (run.state !== "waiting" || cur?.status !== "waiting") return same;
      return enter(withStep(run, i, { status: "done" }), i + 1);
    case "skip":
      // pular: passo manual esperando ou passo que falhou (um auto em andamento precisa ser parado antes)
      if (!cur || (cur.status !== "waiting" && cur.status !== "failed")) return same;
      return enter(withStep(run, i, { status: "skipped" }), i + 1);
    case "autoDone":
      if (run.state !== "running" || cur?.status !== "running") return same;
      if (ev.code === 0) {
        const done = withStep(run, i, { status: "done", code: 0 });
        // ritmo «passo a passo»: pausa antes do próximo (que já fica com o texto renderizado, com a resposta deste passo)
        if (run.pace === "step" && i + 1 < run.steps.length) {
          const paused: WorkflowRun = { ...done, current: i + 1, state: "paused" };
          return { run: withStep(paused, i + 1, { text: renderStep(paused, i + 1) }), effect: NONE };
        }
        return enter(done, i + 1);
      }
      return { run: { ...withStep(run, i, { status: "failed", code: ev.code }), state: "failed" }, effect: NONE };
    case "retry":
      if (run.state !== "failed" || cur?.status !== "failed") return same;
      return enter(run, i);
    case "stop": {
      if (run.state === "done" || run.state === "stopped") return same;
      const wasRunning = cur?.status === "running";
      const stopped: WorkflowRun = { ...(cur ? withStep(run, i, { status: wasRunning ? "failed" : "pending" }) : run), current: -1, state: "stopped" };
      return { run: stopped, effect: wasRunning ? { type: "abort", stepIndex: i } : NONE };
    }
    case "goto": {
      if (!Number.isInteger(ev.index) || ev.index < 0 || ev.index >= run.steps.length || run.steps[ev.index].status === "pending") return same;
      // a conversa já existe se algum passo (em qualquer posição) concluiu ou um automático chegou a rodar: o passo refeito a retoma
      const started = conversationStarted(run, run.steps.length);
      const reset: WorkflowRun = { ...run, steps: run.steps.map((s, j) => (j >= ev.index ? redo(s) : s)), current: -1, state: "running" };
      const out = enter(reset, ev.index, started);
      return cur?.status === "running" ? { run: out.run, effect: { type: "seq", effects: [{ type: "abort", stepIndex: i }, out.effect] } } : out;
    }
    case "denied":
      if (!Number.isInteger(ev.stepIndex) || ev.stepIndex < 0 || ev.stepIndex >= run.steps.length) return same;
      return { run: withStep(run, ev.stepIndex, { denied: ev.items.length ? ev.items : undefined, warnings: ev.warnings?.length ? ev.warnings : undefined }), effect: NONE };
    case "missing":
      if (!Number.isInteger(ev.stepIndex) || ev.stepIndex < 0 || ev.stepIndex >= run.steps.length) return same;
      return { run: withStep(run, ev.stepIndex, { missing: ev.items.length ? ev.items : undefined }), effect: NONE };
    case "result":
      if (!Number.isInteger(ev.stepIndex) || ev.stepIndex < 0 || ev.stepIndex >= run.steps.length) return same;
      return { run: withStep(run, ev.stepIndex, { result: ev.text.trim() ? ev.text.trim().slice(0, RESULT_MAX) : undefined }), effect: NONE };
    case "run":
      // «Executar até o fim»: muda o ritmo; se estava pausada, segue já
      if (run.state === "paused") return enter({ ...run, pace: "run" }, run.current);
      return run.pace === "run" ? same : { run: { ...run, pace: "run" }, effect: NONE };
    case "restart": {
      const reset: WorkflowRun = { ...run, steps: run.steps.map(redo), current: -1, state: "running" };
      // se havia um auto rodando, o chamador precisa abortá-lo antes (efeito abort) — o restart devolve os dois em sequência
      const out = enter(reset, 0);
      return cur?.status === "running" ? { run: out.run, effect: { type: "abort", stepIndex: i } } : out;
    }
  }
}

/** Dá para voltar para este passo? (qualquer passo que já começou: concluído, pulado, falho ou o atual) */
export const canGoto = (run: WorkflowRun, i: number): boolean => i >= 0 && i < run.steps.length && run.steps[i].status !== "pending";

export interface Progress {
  done: number;
  skipped: number;
  total: number;
  /** 0–1, contando concluídos e pulados */
  fraction: number;
}
export function progress(run: WorkflowRun): Progress {
  const done = run.steps.filter((s) => s.status === "done").length;
  const skipped = run.steps.filter((s) => s.status === "skipped").length;
  const total = run.steps.length;
  return { done, skipped, total, fraction: total ? (done + skipped) / total : 0 };
}

/** O que o usuário pode fazer agora (a UI liga/desliga os botões por aqui). */
export function available(run: WorkflowRun): { next: boolean; run: boolean; skip: boolean; stop: boolean; retry: boolean; restart: boolean } {
  const cur = run.current >= 0 ? run.steps[run.current] : undefined;
  return {
    next: run.state === "paused" || (run.state === "waiting" && cur?.status === "waiting"),
    run: run.state === "paused",
    skip: !!cur && (cur.status === "waiting" || cur.status === "failed"),
    stop: run.state === "running" || run.state === "waiting" || run.state === "paused" || run.state === "failed",
    retry: run.state === "failed",
    restart: true,
  };
}

/** Entrada que o passo `i` recebe: a do ponto de entrada no primeiro passo; nos seguintes, a resposta do anterior (`{{saida_anterior}}`). */
export function stepInput(run: WorkflowRun, i: number): string {
  if (i <= 0) return run.entrada ?? run.values.entrada ?? "";
  return run.steps[i - 1]?.result ?? "";
}

/** Dá para retomar no passo `i`? Todos os anteriores precisam ter terminado (concluídos ou pulados): a resposta deles é a memória. */
export const canResumeAt = (run: WorkflowRun, i: number): boolean => Number.isInteger(i) && i >= 0 && i < run.steps.length && run.steps.slice(0, i).every((s) => s.status === "done" || s.status === "skipped");

/**
 * Retoma uma execução (do histórico) no passo `i`, como uma execução NOVA: os passos anteriores ficam como estavam (com a
 * resposta, que segue valendo em `{{saida_anterior}}` e `{{resultado.…}}`), daí em diante tudo volta a pendente, sem
 * histórico de tentativas. A conversa é outra (`sessionId` novo): a antiga já tem os passos seguintes e confundiria o agente.
 */
export function resumeAt(run: WorkflowRun, i: number, sessionId: string, pace?: Pace): { run: WorkflowRun; effect: RunEffect } | undefined {
  if (!canResumeAt(run, i)) return undefined;
  const fresh = (s: RunStep): RunStep => ({ promptId: s.promptId, name: s.name, mode: s.mode, raw: s.raw, ...(s.agent ? { agent: s.agent } : {}), ...(s.expects ? { expects: s.expects } : {}), text: s.raw, status: "pending" });
  const base: WorkflowRun = { ...run, sessionId, steps: run.steps.map((s, j) => (j < i ? s : fresh(s))), current: -1, state: "running", ...(pace ? { pace } : {}) };
  return enter(base, i, false);
}

/**
 * Carimba o instante de início e de fim dos passos que mudaram de estado entre `prev` e `next` (o reducer é puro e não sabe a hora).
 * Passo que volta a rodar (refeito) ganha um novo início e perde o fim.
 */
export function stampRun(prev: WorkflowRun, next: WorkflowRun, now: number): WorkflowRun {
  return {
    ...next,
    steps: next.steps.map((s, i) => {
      const was = prev.steps[i];
      if (!was || was.status === s.status) return s;
      if (s.status === "running") return { ...s, startedAt: now, endedAt: undefined };
      if (s.status === "done" || s.status === "failed") return { ...s, endedAt: now };
      return s;
    }),
  };
}
