import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeLibrary, type PromptLibrary } from "./prompts";
import { createRecord, filesToRestore, newRunId, normalizeRecord, refreshFromLibrary, RUN_ID_RE, settleRun, summarize } from "./runs";
import { canResumeAt, memoryValues, reduce, resumeAt, startRun, type RunEvent, type WorkflowRun } from "./workflow";

const lib = (): PromptLibrary =>
  normalizeLibrary({
    prompts: [
      { id: "roteiro", name: "Roteiro", text: "Roteiro sobre {{entrada}}" },
      { id: "arte", name: "Arte", text: "Arte para: {{saida_anterior}}" },
      { id: "revisar", name: "Revisar", text: "Revise: {{saida_anterior}}" },
    ],
    workflows: [{ id: "post", name: "Post", steps: [{ promptId: "roteiro", mode: "auto" }, { promptId: "arte", mode: "auto" }, { promptId: "revisar", mode: "auto" }] }],
  }).library;
const apply = (run: WorkflowRun, ev: RunEvent) => reduce(run, ev).run;
/** execução que rodou os passos 1 e 2 (com resposta) e falhou no 3 */
function failedAtThree(): WorkflowRun {
  const r = startRun(lib(), "post", {}, "sess-a", { allAuto: true, entrada: "AGI" });
  assert.ok(r.ok);
  let run = r.ok ? r.run : (undefined as never);
  run = apply(run, { type: "result", stepIndex: 0, text: "ROTEIRO" });
  run = apply(run, { type: "autoDone", code: 0 });
  run = apply(run, { type: "result", stepIndex: 1, text: "ARTE" });
  run = apply(run, { type: "autoDone", code: 0 });
  return apply(run, { type: "autoDone", code: 1 });
}

test("newRunId: ordena pelo nome (data e hora UTC) e casa com RUN_ID_RE", () => {
  const id = newRunId(new Date(Date.UTC(2026, 9, 18, 13, 45, 1)), () => 0);
  assert.equal(id, "run-20261018-134501-aaaa");
  assert.match(newRunId(), RUN_ID_RE);
});

test("canResumeAt: só depois de passos concluídos ou pulados", () => {
  const run = failedAtThree();
  assert.deepEqual([0, 1, 2, 3].map((i) => canResumeAt(run, i)), [true, true, true, false]);
  const fresh = startRun(lib(), "post", {}, "s", { allAuto: true, entrada: "x" });
  assert.ok(fresh.ok);
  assert.equal(fresh.ok && canResumeAt(fresh.run, 2), false, "passo anterior ainda não rodou");
});

test("resumeAt: mantém a memória dos passos anteriores, refaz daí em diante numa conversa nova", () => {
  const old = failedAtThree();
  const out = resumeAt(old, 2, "sess-b");
  assert.ok(out);
  const { run, effect } = out!;
  assert.equal(run.sessionId, "sess-b");
  assert.deepEqual(run.steps.map((s) => s.status), ["done", "done", "running"]);
  assert.equal(run.steps[1].result, "ARTE", "a resposta do passo 2 continua valendo");
  assert.equal(run.steps[2].code, undefined);
  assert.equal(run.steps[2].text, "Revise: ARTE", "o passo retomado recebe {{saida_anterior}} da execução antiga");
  assert.equal(effect.type, "exec");
  assert.equal(effect.type === "exec" && effect.first, true, "conversa nova: --session-id");
  assert.equal(old.steps[2].status, "failed", "a execução antiga não muda");
});

test("resumeAt no meio: os passos seguintes voltam a pendentes, sem resposta nem histórico", () => {
  const old = failedAtThree();
  const out = resumeAt(old, 1, "sess-c", "step");
  assert.ok(out);
  assert.deepEqual(out!.run.steps.map((s) => s.status), ["done", "running", "pending"]);
  assert.equal(out!.run.steps[1].result, undefined);
  assert.equal(out!.run.steps[1].history, undefined);
  assert.equal(out!.run.pace, "step");
  assert.equal(memoryValues(out!.run, 1).saida_anterior, "ROTEIRO");
  assert.equal(resumeAt(old, 3, "x"), undefined, "passo inexistente / anterior não concluído");
});

test("summarize: estado, progresso, onde falhou e arquivos guardados", () => {
  const rec = createRecord(failedAtThree(), { id: "run-20261018-134501-aaaa", now: 10, entryId: "tema", files: { "0": ["post/copy.md"], "1": ["post/a.png", "post/b.png"] } });
  const s = summarize(rec);
  assert.equal(s.state, "failed");
  assert.equal(s.done, 2);
  assert.equal(s.total, 3);
  assert.equal(s.failedAt, 2);
  assert.equal(s.entrada, "AGI");
  assert.equal(s.files, 3);
});

test("settleRun: execução «rodando» que não está viva fica interrompida (passo atual falha com -1)", () => {
  const r = startRun(lib(), "post", {}, "s", { allAuto: true, entrada: "x" });
  assert.ok(r.ok);
  const settled = settleRun(r.ok ? r.run : (undefined as never));
  assert.equal(settled.state, "failed");
  assert.equal(settled.steps[0].status, "failed");
  assert.equal(settled.steps[0].code, -1);
  const done = failedAtThree();
  assert.equal(settleRun(done), done, "execução já terminada não muda");
});

test("normalizeRecord: aceita o que createRecord grava (ida e volta por JSON) e recusa lixo", () => {
  const rec = createRecord(failedAtThree(), { id: "run-20261018-134501-aaaa", now: 10, resumedFrom: { id: "run-20261017-100000-zzzz", step: 1 }, files: { "1": ["post/x.png"] } });
  const json = JSON.parse(JSON.stringify(rec));
  assert.deepEqual(normalizeRecord(json), json, "o que vai para o disco volta igual");
  assert.equal(normalizeRecord({ ...rec, id: "../../etc" }), undefined, "id fora do formato");
  assert.equal(normalizeRecord({ ...rec, schema: "outro" }), undefined);
  assert.equal(normalizeRecord({ ...rec, run: { ...rec.run, state: "voando" } }), undefined);
  assert.equal(normalizeRecord(null), undefined);
  const odd = normalizeRecord({ ...rec, files: { "1": ["ok.png", 3], "../x": ["a"] } });
  assert.deepEqual(odd?.files, { "1": ["ok.png"] }, "chave de passo inválida e item não-texto saem");
});

test("filesToRestore: arquivos dos passos anteriores, o mais recente vence", () => {
  const rec = { files: { "0": ["post/copy.md"], "1": ["post/index.html", "post/copy.md"], "2": ["post/slides/a.png"] } };
  assert.deepEqual(filesToRestore(rec, 2), { "post/copy.md": 1, "post/index.html": 1 });
  assert.deepEqual(filesToRestore(rec, 0), {});
  assert.deepEqual(filesToRestore({}, 3), {});
});

test("refreshFromLibrary: retomar usa o prompt corrigido do diagrama a partir do passo retomado", () => {
  const old = failedAtThree();
  const l = lib();
  l.prompts = l.prompts.map((p) => (p.id === "revisar" ? { ...p, text: "Revise com cuidado: {{saida_anterior}}" } : p.id === "roteiro" ? { ...p, text: "MUDOU" } : p));
  const { run, refreshed } = refreshFromLibrary(old, l, 2);
  assert.equal(refreshed, true);
  assert.equal(run.steps[2].raw, "Revise com cuidado: {{saida_anterior}}");
  assert.equal(run.steps[0].raw, "Roteiro sobre {{entrada}}", "passo antes do retomado fica como foi executado");
  const out = resumeAt(run, 2, "s2");
  assert.equal(out?.run.steps[2].text, "Revise com cuidado: ARTE");
});

test("refreshFromLibrary: estrutura do workflow mudou → fica como estava na execução", () => {
  const old = failedAtThree();
  const l = lib();
  l.workflows = l.workflows.map((w) => ({ ...w, steps: [w.steps[1], w.steps[0], w.steps[2]] }));
  assert.equal(refreshFromLibrary(old, l, 2).refreshed, false);
  assert.equal(refreshFromLibrary(old, l, 2).run, old);
  assert.equal(refreshFromLibrary(old, { ...lib(), workflows: [] }, 0).run, old, "workflow removido do diagrama");
});
