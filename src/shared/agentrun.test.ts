import assert from "node:assert/strict";
import { test } from "node:test";
import type { Doc, NodeEl } from "./schema";
import { harnessCheck, permissionReport, runMarks, workflowAgents } from "./agentrun";
import { BLOCKED, libraryFromDoc, memoryValues, reduce, startRun, stampRun, stepInput, workflowVars, type RunEvent, type WorkflowRun } from "./workflow";
import { renderPrompt } from "./prompts";

// Diagrama de 3 passos: entrypoint → workflow → 3 prompts, cada um rodado por um agente; o agente 1 usa uma skill.
const node = (id: string, agent: Record<string, unknown>): NodeEl => ({ id, kind: "node", label: id, x: 0, y: 0, w: 100, h: 60, agent }) as unknown as NodeEl;
const conn = (id: string, from: string, to: string, agent: Record<string, unknown>) => ({ id, from, to, type: "sync", agent }) as never;
function doc(): Doc {
  return {
    mode: "agents",
    nodes: [
      node("entry", { role: "entrypoint" }),
      node("wf", { role: "workflow" }),
      node("p1", { role: "prompt", text: "Planeje {{entrada}}" }),
      node("p2", { role: "prompt", text: "Implemente: {{saida_anterior}}" }),
      node("p3", { role: "prompt", text: "Revise: {{saida_anterior}}" }),
      node("a1", { role: "agent", description: "planeja" }),
      node("a2", { role: "agent", description: "implementa" }),
      node("a3", { role: "agent", description: "revisa" }),
      node("sk", { role: "skill", description: "estilo" }),
    ],
    connections: [
      conn("c-start", "entry", "wf", { rel: "start" }),
      conn("s1", "wf", "p1", { rel: "step", order: 1 }),
      conn("s2", "wf", "p2", { rel: "step", order: 2 }),
      conn("s3", "wf", "p3", { rel: "step", order: 3 }),
      conn("r1", "p1", "a1", { rel: "runs-on" }),
      conn("r2", "p2", "a2", { rel: "runs-on" }),
      conn("r3", "p3", "a3", { rel: "runs-on" }),
      conn("u1", "a1", "sk", { rel: "uses-skill" }),
    ],
    groups: [],
  } as unknown as Doc;
}

const begin = (d: Doc, pace: "step" | "run" = "step", entrada = "login"): WorkflowRun => {
  const r = startRun(libraryFromDoc(d), "wf", {}, "sess", { pace, allAuto: true, entrada });
  assert.ok(r.ok, r.ok ? "" : r.error);
  return r.ok ? r.run : (undefined as never);
};
const apply = (run: WorkflowRun, ev: RunEvent) => reduce(run, ev).run;

test("runMarks: sem execução não marca nada", () => {
  assert.deepEqual(runMarks(doc(), null).nodes, {});
});

test("runMarks: passo em andamento acende prompt, agente, skill do agente e a seta runs-on", () => {
  const d = doc();
  const m = runMarks(d, begin(d));
  assert.equal(m.nodes.entry, "active");
  assert.equal(m.nodes.wf, "active");
  assert.equal(m.nodes.p1, "active");
  assert.equal(m.nodes.a1, "active");
  assert.equal(m.nodes.sk, "skill");
  assert.equal(m.nodes.a2, undefined, "agente do passo seguinte ainda apagado");
  assert.deepEqual(m.edges, { "c-start": "flow", r1: "flow" });
});

test("runMarks: passo concluído fica verde e o seguinte acende na ordem", () => {
  const d = doc();
  let run = apply(begin(d), { type: "autoDone", code: 0 }); // passo 1 concluído → pausa antes do 2
  let m = runMarks(d, run);
  assert.equal(m.nodes.p1, "done");
  assert.equal(m.nodes.a1, "done");
  assert.equal(m.nodes.p2, undefined, "pausado: nenhum passo rodando");
  run = apply(run, { type: "next" });
  m = runMarks(d, run);
  assert.equal(m.nodes.p2, "active");
  assert.equal(m.nodes.a2, "active");
  assert.equal(m.nodes.a1, "done");
  assert.equal(m.nodes.sk, undefined, "skill só acende com o agente que a usa ativo");
});

test("runMarks: falha marca o passo em vermelho e para a execução", () => {
  const d = doc();
  let run = apply(begin(d, "run"), { type: "autoDone", code: 0 });
  run = apply(run, { type: "autoDone", code: 1 });
  const m = runMarks(d, run);
  assert.equal(run.state, "failed");
  assert.equal(m.nodes.wf, "failed");
  assert.equal(m.nodes.p2, "failed");
  assert.equal(m.nodes.a2, "failed");
  assert.equal(m.nodes.p1, "done");
});

test("stepInput: a entrada no primeiro passo; nos seguintes, a saída do anterior", () => {
  let run = apply(begin(doc()), { type: "autoDone", code: 0 });
  run = { ...run, steps: run.steps.map((s, i) => (i === 0 ? { ...s, result: "plano pronto" } : s)) };
  assert.equal(stepInput(run, 0), "login");
  assert.equal(stepInput(run, 1), "plano pronto");
});

test("{{saida_anterior}} recebe a saída do passo anterior e não vira variável de formulário", () => {
  const d = doc();
  const l = libraryFromDoc(d);
  assert.deepEqual(workflowVars(l, "wf"), ["entrada"], "saida_anterior é de memória, não pedida no formulário");
  const base = begin(d, "run");
  const run: WorkflowRun = { ...base, steps: base.steps.map((s, i) => (i === 0 ? { ...s, result: "PLANO" } : s)) };
  assert.equal(memoryValues(run, 1).saida_anterior, "PLANO");
  assert.equal(renderPrompt({ text: "Implemente: {{saida_anterior}}" }, memoryValues(run, 1)).text, "Implemente: PLANO");
});

test("ritmo «step» pausa após cada passo; «next» segue; «run» retoma e segue até o fim", () => {
  const d = doc();
  let run = apply(begin(d, "step"), { type: "autoDone", code: 0 });
  assert.equal(run.state, "paused");
  assert.equal(run.current, 1);
  assert.equal(run.steps[1].status, "pending");
  const seg = reduce(run, { type: "next" });
  assert.equal(seg.run.state, "running");
  assert.equal(seg.effect.type, "exec");
  assert.equal(seg.run.pace, "step", "«próximo passo» não muda o ritmo");
  const cont = reduce(run, { type: "run" });
  assert.equal(cont.run.pace, "run");
  assert.equal(cont.run.state, "running");
  assert.equal(cont.effect.type, "exec");
});

test("«run» durante um passo rodando só muda o ritmo; a execução segue sem pausa", () => {
  const d = doc();
  const mid = reduce(begin(d, "step"), { type: "run" });
  assert.equal(mid.run.pace, "run");
  assert.equal(mid.effect.type, "none");
  const after = apply(mid.run, { type: "autoDone", code: 0 });
  assert.equal(after.state, "running", "com ritmo «run» não pausa");
  assert.equal(after.current, 1);
});

test("último passo termina a execução mesmo com ritmo «step»", () => {
  const d = doc();
  let run = apply(begin(d, "step"), { type: "autoDone", code: 0 });
  run = apply(run, { type: "next" });
  run = apply(run, { type: "autoDone", code: 0 });
  run = apply(run, { type: "next" });
  run = apply(run, { type: "autoDone", code: 0 });
  assert.equal(run.state, "done");
  assert.deepEqual(run.steps.map((s) => s.status), ["done", "done", "done"]);
});

test("stampRun carimba início e fim só dos passos que mudaram de estado", () => {
  const d = doc();
  const before = begin(d, "run");
  const after = apply(before, { type: "autoDone", code: 0 });
  const stamped = stampRun(before, after, 1000);
  assert.equal(stamped.steps[0].endedAt, 1000);
  assert.equal(stamped.steps[1].startedAt, 1000);
  assert.equal(stamped.steps[1].endedAt, undefined);
  const again = stampRun(stamped, stamped, 2000);
  assert.equal(again.steps[1].startedAt, 1000, "sem mudança de estado não recarimba");
});

test("evento next fora de pausa ou espera não faz nada", () => {
  const run = begin(doc(), "run");
  assert.equal(reduce(run, { type: "next" }).run, run);
});

test("variáveis do workflow além de {{entrada}}: faltando, startRun lista quais; preenchidas, entram no prompt", () => {
  const d = doc();
  (d.nodes.find((n) => n.id === "p1")!.agent as { text: string }).text = "Landing de {{produto}} para {{publico}}: {{entrada}}";
  const l = libraryFromDoc(d);
  assert.deepEqual(workflowVars(l, "wf"), ["produto", "publico", "entrada"]);
  const bad = startRun(l, "wf", {}, "s", { allAuto: true, entrada: "x" });
  assert.equal(bad.ok, false);
  assert.deepEqual(bad.ok ? [] : bad.missing, ["produto", "publico"]);
  const ok = startRun(l, "wf", { produto: "Archflow", publico: "devs" }, "s", { allAuto: true, entrada: "hero" });
  assert.ok(ok.ok);
  assert.equal(ok.ok && ok.run.steps[0].text, "Use o subagente a1 para: Landing de Archflow para devs: hero");
});

test("workflowAgents: subagentes dos passos, na ordem e sem repetir", () => {
  const run = begin(doc(), "run");
  assert.deepEqual(workflowAgents(run), ["a1", "a2", "a3"]);
  assert.deepEqual(workflowAgents({ steps: [...run.steps, run.steps[0]] }), ["a1", "a2", "a3"]);
});

test("harnessCheck: harness de outro diagrama bloqueia; desatualizado sincroniza; sem harness ou sem agentes segue", () => {
  const agents = ["redator-social"];
  assert.deepEqual(harnessCheck({ applicable: true, stale: [".claude/agents/redator-social.md"], owner: "harness-landing-page.archflow.json", foreign: true }, agents), { kind: "foreign", owner: "harness-landing-page.archflow.json", agents });
  assert.deepEqual(harnessCheck({ applicable: true, stale: [".claude/agents/redator-social.md"], foreign: false }, agents), { kind: "sync" });
  assert.deepEqual(harnessCheck({ applicable: true, stale: [], foreign: false }, agents), { kind: "ok" });
  assert.deepEqual(harnessCheck({ applicable: true, stale: ["x"], foreign: true }, []), { kind: "ok" }, "workflow sem subagentes não depende do harness");
  assert.deepEqual(harnessCheck(undefined, agents), { kind: "ok" }, "sem servidor (memória do navegador): segue");
  assert.deepEqual(harnessCheck({ applicable: false, stale: [] }, agents), { kind: "ok" });
});

// Linhas de conversa no formato do Claude Code: o pedido da ferramenta (assistant/tool_use) e a resposta (user/tool_result).
const base = String.raw`C:\Users\x\proj`;
const abs = (rel: string) => `${base}\\${rel.replace(/\//g, "\\")}`;
const useLine = (id: string, name: string, input: Record<string, unknown>, at = "2026-10-18T01:00:00Z") => JSON.stringify({ type: "assistant", timestamp: at, message: { content: [{ type: "tool_use", id, name, input }] } });
const resLine = (id: string, content: string, opts: { error?: boolean; denial?: boolean; at?: string } = {}) =>
  JSON.stringify({ type: "user", timestamp: opts.at ?? "2026-10-18T01:00:01Z", ...(opts.denial ? { toolDenialKind: "user-rejected" } : {}), message: { content: [{ type: "tool_result", tool_use_id: id, is_error: !!opts.error, content }] } });
const writeDenied = (rel: string) => `Claude requested permissions to write to ${abs(rel)}, but you haven't granted it yet.`;

test("permissionReport: gravação negada de arquivo que nunca foi gravado bloqueia o passo (a 1ª execução do post)", () => {
  const jsonl = [
    useLine("w1", "Write", { file_path: abs("post/copy.md"), content: "x" }),
    resLine("w1", writeDenied("post/copy.md"), { error: true, denial: true }),
    useLine("w2", "Write", { file_path: abs("post/copy.md"), content: "x" }),
    resLine("w2", writeDenied("post/copy.md"), { error: true, denial: true }),
  ].join("\n");
  assert.deepEqual(permissionReport(jsonl, 0, base), { blocking: ["gravar post/copy.md"], warnings: [] });
});

test("permissionReport: comando do Bash recusado e contornado com Edit vira aviso, com a ferramenta e o comando (o caso do carrossel)", () => {
  const jsonl = [
    useLine("b1", "Bash", { command: `f="${abs("post/direcao.md").replace(/\\/g, "/")}"; head -n 160 "$f" > "$f.tmp" && cat >> "$f.tmp"` }),
    resLine("b1", "Parser skipped input between top-level statements", { error: true, denial: true }),
    useLine("e1", "Edit", { file_path: abs("post/direcao.md"), old_string: "a", new_string: "b" }),
    resLine("e1", `The file ${abs("post/direcao.md")} has been updated successfully.`),
  ].join("\n");
  const r = permissionReport(jsonl, 0, base);
  assert.deepEqual(r.blocking, [], "Bash recusado não bloqueia: o agente seguiu e gravou com Edit");
  assert.equal(r.warnings.length, 1);
  assert.match(r.warnings[0], /^Bash: f="post\/direcao\.md"; head -n 160/, "diz a ferramenta e o comando, com o caminho relativo ao projeto");
  assert.match(r.warnings[0], /\(Parser skipped input between top-level statements\)$/, "e o motivo do Claude Code");
});

test("permissionReport: gravação negada e depois feita (outra ferramenta, mesmo arquivo) vira aviso; antes de `since` não conta", () => {
  const jsonl = [
    useLine("w1", "Write", { file_path: abs("post/index.html"), content: "x" }, "2026-10-18T01:00:00Z"),
    resLine("w1", writeDenied("post/index.html"), { error: true, denial: true, at: "2026-10-18T01:00:01Z" }),
    useLine("e1", "Edit", { file_path: abs("post/INDEX.html"), old_string: "a", new_string: "b" }, "2026-10-18T01:00:02Z"),
    resLine("e1", "ok", { at: "2026-10-18T01:00:03Z" }),
    useLine("w9", "Write", { file_path: abs("post/old.md"), content: "x" }, "2026-10-18T00:00:00Z"),
    resLine("w9", writeDenied("post/old.md"), { error: true, denial: true, at: "2026-10-18T00:00:01Z" }),
  ].join("\n");
  assert.deepEqual(permissionReport(jsonl, Date.parse("2026-10-18T00:30:00Z"), base), { blocking: [], warnings: ["gravar post/index.html"] });
});

test("permissionReport: gravado ANTES da negação não resolve; erro comum não é permissão; forma curta", () => {
  const before = [
    useLine("e1", "Edit", { file_path: abs("post/a.md") }),
    resLine("e1", "ok"),
    useLine("w1", "Write", { file_path: abs("post/a.md") }),
    resLine("w1", writeDenied("post/a.md"), { error: true, denial: true }),
  ].join("\n");
  assert.deepEqual(permissionReport(before, 0, base).blocking, ["gravar post/a.md"], "a última versão do arquivo não foi gravada");
  assert.deepEqual(permissionReport([useLine("r1", "Read", { file_path: abs("x") }), resLine("r1", "ENOENT: no such file", { error: true })].join("\n"), 0, base), { blocking: [], warnings: [] });
  assert.deepEqual(permissionReport(resLine("s1", "permission denied: WebSearch", { error: true })), { blocking: [], warnings: ["usar WebSearch"] }, "ferramenta sem arquivo: aviso");
});

test("evento denied guarda as negações; BLOCKED falha o passo; tentar de novo limpa", () => {
  let run = begin(doc(), "run");
  run = apply(run, { type: "denied", stepIndex: 0, items: ["gravar post/copy.md"] });
  run = apply(run, { type: "autoDone", code: BLOCKED });
  assert.equal(run.state, "failed");
  assert.deepEqual(run.steps[0].denied, ["gravar post/copy.md"]);
  run = apply(run, { type: "retry" });
  assert.equal(run.steps[0].status, "running");
  assert.equal(run.steps[0].denied, undefined);
});

test("evento denied só com avisos: o passo conclui normalmente e guarda os avisos", () => {
  let run = begin(doc(), "run");
  run = apply(run, { type: "denied", stepIndex: 0, items: [], warnings: ["Bash: ls (x)"] });
  run = apply(run, { type: "autoDone", code: 0 });
  assert.equal(run.steps[0].status, "done");
  assert.equal(run.steps[0].denied, undefined);
  assert.deepEqual(run.steps[0].warnings, ["Bash: ls (x)"]);
  assert.equal(run.state, "running", "segue para o próximo passo");
});
