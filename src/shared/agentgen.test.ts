import assert from "node:assert/strict";
import { test } from "node:test";
import { applyOps, type Op } from "./ops";
import { emptyDoc, type AgentNodeSpec, type AgentRel, type Doc } from "./schema";
import { generateHarness } from "./agentgen";

const an = (id: string, agent: AgentNodeSpec, parent?: string): Op => ({ op: "add_node", id, label: id, kind: "agent", agent, ...(parent ? { parent } : {}) });
const rel = (from: string, to: string, r: AgentRel): Op => ({ op: "add_connection", from, to, agent: { rel: r } });

function build(ops: Op[]): Doc {
  const { doc, results } = applyOps(emptyDoc("t", "agents"), ops);
  assert.ok(results.every((r) => r.ok), results.find((r) => !r.ok)?.error ?? "op falhou");
  return doc;
}

const fm = (content: string) => /^---\n([\s\S]*?)\n---/.exec(content)?.[1] ?? "";
const file = (files: { path: string; content: string }[], path: string) => files.find((f) => f.path === path)!;

const team = (): Op[] => [
  an("revisor", { role: "agent", description: "Revisa pull requests: bugs, estilo e segurança.", model: "sonnet", tools: ["Read", "Grep"], prompt: "Você revisa o diff com cuidado." }),
  an("qa", { role: "agent", description: "Escreve e roda testes do que o revisor apontou." }),
  an("checklist", { role: "skill", description: "Checklist de revisão: estilo, testes, segurança.", body: "# Checklist\n\n- estilo" }),
  an("solta", { role: "skill", description: "Skill órfã que não deve ser exportada no harness." }),
  { op: "add_group", id: "glob", label: "Global", kind: "global" },
  an("tom", { role: "skill", description: "Tom de voz do time, vale para todo agente.", body: "Seja direto." }, "glob"),
  rel("revisor", "checklist", "uses-skill"),
  rel("revisor", "qa", "delegates"),
];

test("generateHarness recusa diagrama que não é modo agents", () => {
  assert.throws(() => generateHarness(emptyDoc("a"), "claude"), /modo "agents"/);
});

test("claude: uses-skill vira skills: no frontmatter, global entra em todo agente, órfã fica de fora", () => {
  const files = generateHarness(build(team()), "claude");
  assert.deepEqual(
    files.map((f) => f.path),
    [".claude/agents/qa.md", ".claude/agents/revisor.md", ".claude/skills/checklist/SKILL.md", ".claude/skills/tom/SKILL.md"],
  );
  const revisor = fm(file(files, ".claude/agents/revisor.md").content);
  assert.match(revisor, /^name: revisor$/m);
  assert.match(revisor, /^model: sonnet$/m);
  assert.match(revisor, /skills:\n {2}- checklist\n {2}- tom/);
  assert.match(revisor, /tools:\n {2}- Read\n {2}- Grep/);
  const qa = fm(file(files, ".claude/agents/qa.md").content);
  assert.match(qa, /skills:\n {2}- tom/);
  assert.doesNotMatch(qa, /checklist/);
  assert.ok(files.every((f) => !f.path.includes("solta")));
});

test("claude: o corpo leva o prompt e a delegação; a skill ganha frontmatter em volta do body", () => {
  const files = generateHarness(build(team()), "claude");
  const body = file(files, ".claude/agents/revisor.md").content.split("---").slice(2).join("---");
  assert.match(body, /Você revisa o diff com cuidado/);
  assert.match(body, /## Delegação/);
  assert.match(body, /\*\*qa\*\*/);
  assert.doesNotMatch(body, /## Skills/);
  const skill = file(files, ".claude/skills/checklist/SKILL.md").content;
  assert.match(fm(skill), /^name: checklist$/m);
  assert.match(skill, /# Checklist/);
});

test("cursor: o frontmatter não tem skills; a relação fica documentada no corpo, com a global marcada", () => {
  const files = generateHarness(build(team()), "cursor");
  assert.ok(files.every((f) => f.path.startsWith(".cursor/")));
  const revisor = file(files, ".cursor/agents/revisor.md").content;
  assert.doesNotMatch(fm(revisor), /^skills:/m);
  assert.match(revisor, /## Skills/);
  assert.match(revisor, /\*\*checklist\*\*/);
  assert.match(revisor, /\*\*tom\*\* \(global\)/);
  assert.match(revisor, /## Delegação/);
});

test("skill cujo body já traz frontmatter é copiada como está", () => {
  const doc = build([an("revisor", { role: "agent", description: "Revisa pull requests e aponta problemas." }), an("pronta", { role: "skill", description: "x".repeat(20), body: "---\nname: pronta\ndescription: já pronta\n---\n\n# Pronta\n" }), rel("revisor", "pronta", "uses-skill")]);
  const skill = generateHarness(doc, "claude").find((f) => f.path.endsWith("SKILL.md"))!;
  assert.equal(skill.content, "---\nname: pronta\ndescription: já pronta\n---\n\n# Pronta\n");
});

test("description com dois-pontos sai entre aspas", () => {
  const doc = build([an("revisor", { role: "agent", description: "Use quando: o diff for grande." })]);
  const agent = generateHarness(doc, "cursor")[0].content;
  assert.match(fm(agent), /^description: "Use quando: o diff for grande\."$/m);
});
