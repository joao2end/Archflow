import assert from "node:assert/strict";
import { test } from "node:test";
import { applyOps, type Op } from "./ops";
import { emptyDoc, type AgentNodeSpec, type Doc } from "./schema";
import { generateHarness } from "./agentgen";
import { harnessToOps, parseFrontmatter } from "./agentimport";

const LONG = "Revisa pull requests quando o usuário pede review de código.";

function build(ops: Op[]): Doc {
  const { doc, results } = applyOps(emptyDoc("t", "agents"), ops);
  assert.ok(results.every((r) => r.ok), results.find((r) => !r.ok)?.error ?? "");
  return doc;
}

test("parseFrontmatter: lê escalar, texto com aspas JSON e lista", () => {
  const fm = parseFrontmatter('---\nname: revisor\ndescription: "Revisa: bugs # e estilo"\nskills:\n  - "checklist"\n  - pdf\n---\n\ncorpo\n');
  assert.ok(fm);
  assert.equal(fm.data.name, "revisor");
  assert.equal(fm.data.description, "Revisa: bugs # e estilo");
  assert.deepEqual(fm.data.skills, ["checklist", "pdf"]);
  assert.equal(fm.body, "corpo");
});

test("parseFrontmatter: sem bloco devolve undefined", () => {
  assert.equal(parseFrontmatter("# só corpo"), undefined);
});

test("harnessToOps: agente e skill viram nós; skills: vira uses-skill", () => {
  const { ops, skipped } = harnessToOps([
    { path: ".claude/agents/revisor.md", content: `---\nname: Revisor\ndescription: ${LONG}\nmodel: sonnet\nskills:\n  - checklist\n---\n\nVocê revisa o diff.\n` },
    { path: ".claude/skills/checklist/SKILL.md", content: `---\nname: checklist\ndescription: Checklist de revisão de código.\n---\n\n# Checklist\n` },
  ]);
  assert.deepEqual(skipped, []);
  const doc = build(ops);
  const rev = doc.nodes.find((n) => n.id === "revisor")!;
  assert.equal(rev.label, "Revisor");
  assert.equal((rev.agent as AgentNodeSpec).model, "sonnet");
  assert.equal((rev.agent as AgentNodeSpec).prompt, "Você revisa o diff.");
  assert.equal(doc.nodes.find((n) => n.id === "checklist")!.agent?.role, "skill");
  assert.equal(doc.connections[0].agent?.rel, "uses-skill");
});

test("harnessToOps: skill citada que não veio nos arquivos vai para skipped, sem quebrar o resto", () => {
  const { ops, skipped } = harnessToOps([{ path: ".claude/agents/a.md", content: `---\nname: a\ndescription: ${LONG}\nskills:\n  - fantasma\n---\n\nx\n` }]);
  assert.equal(ops.filter((o) => o.op === "add_connection").length, 0);
  assert.match(skipped[0], /skill "fantasma" não está/);
});

test("harnessToOps: tools e mcpServers são reportados como não importados", () => {
  const { skipped } = harnessToOps([{ path: ".claude/agents/a.md", content: `---\nname: a\ndescription: ${LONG}\ntools:\n  - Read\nmcpServers:\n  - {"x":{}}\n---\n\nx\n` }]);
  assert.ok(skipped.some((s) => /tools \(Read\)/.test(s)));
  assert.ok(skipped.some((s) => /mcpServers/.test(s)));
});

test("harnessToOps: arquivo sem frontmatter e pasta vazia são reportados", () => {
  assert.match(harnessToOps([{ path: ".claude/agents/x.md", content: "sem nada" }]).skipped[0], /sem frontmatter/);
  assert.match(harnessToOps([]).skipped[0], /nenhum agente ou skill/);
});

test("ida e volta: o harness gerado volta com os mesmos agentes, skills e ligações", () => {
  const doc = build([
    { op: "add_node", id: "revisor", label: "Revisor", kind: "agent", agent: { role: "agent", description: LONG, model: "opus" } },
    { op: "add_node", id: "checklist", label: "checklist", kind: "agent", agent: { role: "skill", description: "Checklist de revisão de código.", body: "# c" } },
    { op: "add_connection", from: "revisor", to: "checklist", agent: { rel: "uses-skill", usage: "aplica em cada diff antes de aprovar" } },
  ]);
  const files = generateHarness(doc, "claude").map((f) => ({ path: f.path, content: f.content }));
  const { ops, skipped } = harnessToOps(files);
  assert.deepEqual(skipped.filter((s) => /skill|sem frontmatter/.test(s)), []);
  const back = build(ops);
  assert.deepEqual(back.nodes.map((n) => n.id).sort(), ["checklist", "revisor"]);
  assert.equal(back.nodes.find((n) => n.id === "revisor")!.agent?.model, "opus");
  assert.equal(back.connections.find((c) => c.from === "revisor")?.agent?.rel, "uses-skill");
});
