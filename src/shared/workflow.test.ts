import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeLibrary, type PromptLibrary } from "./prompts";
import { available, progress, reduce, startRun, workflowVars, type RunEffect, type WorkflowRun } from "./workflow";

const lib = (): PromptLibrary =>
  normalizeLibrary({
    prompts: [
      { id: "plano", name: "Planejar", text: "Planeje {{tarefa}}", agent: "lider" },
      { id: "impl", name: "Implementar", text: "Implemente o plano em {{arquivo}}" },
      { id: "teste", name: "Testar", text: "Rode os testes" },
    ],
    workflows: [
      { id: "entrega", name: "Entrega", steps: [{ promptId: "plano", mode: "manual" }, { promptId: "impl", mode: "auto" }, { promptId: "teste", mode: "auto" }] },
      { id: "vazio", name: "Vazio", steps: [] },
    ],
  }).library;
const vals = { tarefa: "login", arquivo: "src/a.ts" };
const start = (id = "entrega") => {
  const r = startRun(lib(), id, vals, "sess-1");
  assert.ok(r.ok, r.ok ? "" : r.error);
  return r.ok ? r : (undefined as never);
};
const statuses = (r: WorkflowRun) => r.steps.map((s) => s.status);

test("workflowVars une as variáveis dos passos sem repetir", () => {
  assert.deepEqual(workflowVars(lib(), "entrega"), ["tarefa", "arquivo"]);
  assert.deepEqual(workflowVars(lib(), "vazio"), []);
  assert.deepEqual(workflowVars(lib(), "nao-existe"), []);
});

test("startRun: falhas sem lançar", () => {
  assert.deepEqual(startRun(lib(), "entrega", { tarefa: "x" }, "s"), { ok: false, error: "preencha as variáveis: arquivo", missing: ["arquivo"] });
  assert.match((startRun(lib(), "vazio", {}, "s") as { error: string }).error, /sem passos/);
  assert.match((startRun(lib(), "nao-existe", {}, "s") as { error: string }).error, /não existe/);
  const orfao = lib();
  orfao.prompts = orfao.prompts.filter((p) => p.id !== "impl");
  assert.match((startRun(orfao, "entrega", vals, "s") as { error: string }).error, /«impl»/);
});

test("começa no primeiro passo manual: digita o texto renderizado e espera", () => {
  const { run, effect } = start();
  assert.equal(run.state, "waiting");
  assert.equal(run.current, 0);
  assert.deepEqual(statuses(run), ["waiting", "pending", "pending"]);
  assert.deepEqual(effect, { type: "type", stepIndex: 0, text: "Use o subagente lider para: Planeje login", sessionId: "sess-1", first: true });
  assert.equal(run.steps[1].text, "Implemente o plano em src/a.ts", "texto já renderizado");
});

test("fluxo feliz: manual → next → auto (retoma) → autoDone 0 → auto → done", () => {
  let { run } = start();
  let r = reduce(run, { type: "next" });
  assert.deepEqual(r.effect, { type: "exec", stepIndex: 1, text: "Implemente o plano em src/a.ts", sessionId: "sess-1", first: false }, "o manual concluído já criou a conversa: o auto a retoma");
  assert.equal(r.run.state, "running");
  r = reduce(r.run, { type: "autoDone", code: 0 });
  assert.deepEqual(r.effect, { type: "exec", stepIndex: 2, text: "Rode os testes", sessionId: "sess-1", first: false });
  r = reduce(r.run, { type: "autoDone", code: 0 });
  assert.equal(r.run.state, "done");
  assert.equal(r.run.current, -1);
  assert.deepEqual(statuses(r.run), ["done", "done", "done"]);
  assert.deepEqual(progress(r.run), { done: 3, skipped: 0, total: 3, fraction: 1 });
  run = r.run;
  assert.deepEqual(reduce(run, { type: "next" }).effect, { type: "none" }, "terminado ignora eventos");
});

test("passo auto que falha para a execução; retry roda de novo e skip segue", () => {
  let r = reduce(reduce(start().run, { type: "next" }).run, { type: "autoDone", code: 2 });
  assert.equal(r.run.state, "failed");
  assert.equal(r.run.steps[1].code, 2);
  assert.deepEqual(available(r.run), { next: false, skip: true, stop: true, retry: true, restart: true });
  const retry = reduce(r.run, { type: "retry" });
  assert.equal(retry.effect.type, "exec");
  assert.equal((retry.effect as Extract<RunEffect, { type: "exec" }>).first, false, "o manual anterior já criou a conversa: a nova tentativa retoma");
  assert.equal(retry.run.steps[1].code, undefined);
  const falhou = reduce(retry.run, { type: "autoDone", code: 1 });
  const skip = reduce(falhou.run, { type: "skip" });
  assert.deepEqual(statuses(skip.run), ["done", "skipped", "running"]);
  assert.deepEqual(skip.effect.type, "exec");
});

test("skip num passo manual esperando; não pula um auto em andamento", () => {
  const s = start();
  const sk = reduce(s.run, { type: "skip" });
  assert.deepEqual(statuses(sk.run), ["skipped", "running", "pending"]);
  assert.equal(reduce(sk.run, { type: "skip" }).run, sk.run, "auto em andamento: ignora");
  assert.equal(progress(sk.run).skipped, 1);
});

test("stop: manual vira pendente, auto em andamento pede abort; depois restart recomeça", () => {
  const parado = reduce(start().run, { type: "stop" });
  assert.equal(parado.run.state, "stopped");
  assert.deepEqual(statuses(parado.run), ["pending", "pending", "pending"]);
  assert.deepEqual(parado.effect, { type: "none" });
  const auto = reduce(start().run, { type: "next" });
  const abort = reduce(auto.run, { type: "stop" });
  assert.deepEqual(abort.effect, { type: "abort", stepIndex: 1 });
  assert.equal(abort.run.steps[1].status, "failed");
  const re = reduce(abort.run, { type: "restart" });
  assert.equal(re.run.state, "waiting");
  assert.equal(re.effect.type, "type");
  assert.deepEqual(statuses(re.run), ["waiting", "pending", "pending"]);
  // restart com um auto rodando: aborta antes
  const re2 = reduce(auto.run, { type: "restart" });
  assert.deepEqual(re2.effect, { type: "abort", stepIndex: 1 });
  assert.equal(re2.run.current, 0);
});

test("eventos fora de hora são ignorados e a execução é imutável", () => {
  const { run } = start();
  const snapshot = JSON.stringify(run);
  assert.equal(reduce(run, { type: "autoDone", code: 0 }).run, run, "passo manual não recebe autoDone");
  assert.equal(reduce(run, { type: "retry" }).run, run);
  reduce(run, { type: "next" });
  reduce(run, { type: "stop" });
  assert.equal(JSON.stringify(run), snapshot, "a execução original não muda");
});

test("available e progress acompanham o estado", () => {
  const { run } = start();
  assert.deepEqual(available(run), { next: true, skip: true, stop: true, retry: false, restart: true });
  assert.deepEqual(progress(run), { done: 0, skipped: 0, total: 3, fraction: 0 });
  const auto = reduce(run, { type: "next" }).run;
  assert.deepEqual(available(auto), { next: false, skip: false, stop: true, retry: false, restart: true });
  assert.ok(Math.abs(progress(auto).fraction - 1 / 3) < 1e-9);
});

test("workflow só com passos manuais: next encadeia até terminar", () => {
  const l = normalizeLibrary({ prompts: [{ id: "a", name: "A", text: "a" }, { id: "b", name: "B", text: "b" }], workflows: [{ id: "w", name: "W", steps: [{ promptId: "a" }, { promptId: "b" }] }] }).library;
  const s = startRun(l, "w", {}, "x");
  assert.ok(s.ok);
  const r1 = reduce((s as { run: WorkflowRun }).run, { type: "next" });
  assert.deepEqual(r1.effect, { type: "type", stepIndex: 1, text: "b", sessionId: "x", first: false }, "o manual concluído já iniciou a conversa");
  assert.equal(reduce(r1.run, { type: "next" }).run.state, "done");
});

test("conversa compartilhada: `first` só até o primeiro passo concluído (manual ou automático); pular não conta", () => {
  const l = normalizeLibrary({
    prompts: [{ id: "a", name: "A", text: "a" }, { id: "b", name: "B", text: "b" }, { id: "c", name: "C", text: "c" }],
    workflows: [{ id: "w", name: "W", steps: [{ promptId: "a", mode: "manual" }, { promptId: "b", mode: "auto" }, { promptId: "c", mode: "manual" }] }],
  }).library;
  const s = startRun(l, "w", {}, "S");
  assert.ok(s.ok);
  // manual concluído → o auto seguinte RETOMA a conversa
  let r = reduce((s as { run: WorkflowRun }).run, { type: "next" });
  assert.deepEqual(r.effect, { type: "exec", stepIndex: 1, text: "b", sessionId: "S", first: false });
  // auto concluído → o manual seguinte também retoma
  r = reduce(r.run, { type: "autoDone", code: 0 });
  assert.deepEqual(r.effect, { type: "type", stepIndex: 2, text: "c", sessionId: "S", first: false });
  // se o primeiro manual é PULADO, a conversa ainda não existe: o auto cria
  const sk = reduce((s as { run: WorkflowRun }).run, { type: "skip" });
  assert.deepEqual(sk.effect, { type: "exec", stepIndex: 1, text: "b", sessionId: "S", first: true });
  // auto que rodou e falhou conta como conversa iniciada para o passo seguinte (se for pulado, o próximo retoma)
  const f = reduce(sk.run, { type: "autoDone", code: 2 });
  const f2 = reduce(f.run, { type: "skip" });
  assert.deepEqual(f2.effect, { type: "type", stepIndex: 2, text: "c", sessionId: "S", first: false });
});
