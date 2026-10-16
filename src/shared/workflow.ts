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
    lib.workflows.push({ id: n.id, name: n.label, steps: workflowSteps(doc, n.id).map((s) => ({ promptId: s.prompt.id, mode: s.mode })) });
  }
  return lib;
}

export type StepStatus = "pending" | "running" | "waiting" | "done" | "failed" | "skipped";
export type RunState = "running" | "waiting" | "failed" | "done" | "stopped";

/** Limite da resposta guardada por passo (a memória do workflow). */
export const RESULT_MAX = 20_000;

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
  status: StepStatus;
  /** código de saída do passo auto, quando terminou */
  code?: number;
}

export interface WorkflowRun {
  workflowId: string;
  workflowName: string;
  /** conversa do Claude Code compartilhada pelos passos auto (`--session-id` / `--resume`) */
  sessionId: string;
  /** variáveis preenchidas pelo usuário no início */
  values: Record<string, string>;
  steps: RunStep[];
  /** índice do passo atual; -1 quando a execução terminou ou foi parada */
  current: number;
  state: RunState;
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
  /** volta para o passo `index` (refazer daí em diante); os passos a partir dele voltam a pendentes e perdem a resposta */
  | { type: "goto"; index: number }
  /** guarda o que o agente respondeu no passo (lido da conversa); não muda o estado nem gera efeito */
  | { type: "result"; stepIndex: number; text: string };

const NONE: RunEffect = { type: "none" };

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
export function startRun(lib: PromptLibrary, workflowId: string, values: Record<string, string>, sessionId: string): StartResult {
  const wf = lib.workflows.find((w) => w.id === workflowId);
  if (!wf) return { ok: false, error: `workflow «${workflowId}» não existe` };
  if (!wf.steps.length) return { ok: false, error: `o workflow «${wf.name}» está sem passos` };
  const steps: RunStep[] = [];
  const missing: string[] = [];
  for (const s of wf.steps) {
    const p = lib.prompts.find((x) => x.id === s.promptId);
    if (!p) return { ok: false, error: `o prompt «${s.promptId}» do workflow «${wf.name}» não existe mais` };
    const r = renderPrompt(p, values);
    for (const m of r.missing) if (!missing.includes(m)) missing.push(m);
    steps.push({ promptId: p.id, name: p.name, mode: s.mode, raw: p.text, ...(p.agent ? { agent: p.agent } : {}), text: r.text, status: "pending" });
  }
  if (missing.length) return { ok: false, error: `preencha as variáveis: ${missing.join(", ")}`, missing };
  const { run, effect } = enter({ workflowId: wf.id, workflowName: wf.name, sessionId, values, steps, current: -1, state: "running" }, 0);
  return { ok: true, run, effect };
}

const withStep = (run: WorkflowRun, i: number, patch: Partial<RunStep>): WorkflowRun => ({ ...run, steps: run.steps.map((s, j) => (j === i ? { ...s, ...patch } : s)) });

/** Entra no passo `i` (ou termina se não há mais). */
function enter(run: WorkflowRun, i: number, startedBefore?: boolean): { run: WorkflowRun; effect: RunEffect } {
  if (i >= run.steps.length) return { run: { ...run, current: -1, state: "done" }, effect: NONE };
  run = withStep(run, i, { text: renderStep(run, i) });
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
      // «Próximo passo»: só em passo manual esperando
      if (run.state !== "waiting" || cur?.status !== "waiting") return same;
      return enter(withStep(run, i, { status: "done" }), i + 1);
    case "skip":
      // pular: passo manual esperando ou passo que falhou (um auto em andamento precisa ser parado antes)
      if (!cur || (cur.status !== "waiting" && cur.status !== "failed")) return same;
      return enter(withStep(run, i, { status: "skipped" }), i + 1);
    case "autoDone":
      if (run.state !== "running" || cur?.status !== "running") return same;
      if (ev.code === 0) return enter(withStep(run, i, { status: "done", code: 0 }), i + 1);
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
      const reset: WorkflowRun = { ...run, steps: run.steps.map((s, j) => (j >= ev.index ? { ...s, status: "pending", code: undefined, result: undefined } : s)), current: -1, state: "running" };
      const out = enter(reset, ev.index, started);
      return cur?.status === "running" ? { run: out.run, effect: { type: "seq", effects: [{ type: "abort", stepIndex: i }, out.effect] } } : out;
    }
    case "result":
      if (!Number.isInteger(ev.stepIndex) || ev.stepIndex < 0 || ev.stepIndex >= run.steps.length) return same;
      return { run: withStep(run, ev.stepIndex, { result: ev.text.trim() ? ev.text.trim().slice(0, RESULT_MAX) : undefined }), effect: NONE };
    case "restart": {
      const reset: WorkflowRun = { ...run, steps: run.steps.map((s) => ({ ...s, status: "pending", code: undefined })), current: -1, state: "running" };
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
export function available(run: WorkflowRun): { next: boolean; skip: boolean; stop: boolean; retry: boolean; restart: boolean } {
  const cur = run.current >= 0 ? run.steps[run.current] : undefined;
  return {
    next: run.state === "waiting" && cur?.status === "waiting",
    skip: !!cur && (cur.status === "waiting" || cur.status === "failed"),
    stop: run.state === "running" || run.state === "waiting" || run.state === "failed",
    retry: run.state === "failed",
    restart: true,
  };
}
