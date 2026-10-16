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

test("usage: o «como usa» da seta entra no corpo (claude e cursor) ao lado do que o destino faz", () => {
  const ops = team();
  ops[ops.length - 2] = { op: "add_connection", from: "revisor", to: "checklist", agent: { rel: "uses-skill", usage: "Siga o checklist em cada PR antes de aprovar." } };
  ops[ops.length - 1] = { op: "add_connection", from: "revisor", to: "qa", agent: { rel: "delegates", usage: "Passa o diff revisado e recebe a lista de testes que faltam." } };
  const doc = build(ops);
  const claude = file(generateHarness(doc, "claude"), ".claude/agents/revisor.md").content;
  assert.match(claude, /## Como usar as skills\n\n- \*\*checklist\*\*: Siga o checklist em cada PR antes de aprovar\. _\(Checklist de revisão/);
  assert.match(claude, /- \*\*qa\*\*: Passa o diff revisado e recebe a lista de testes que faltam\. _\(Escreve e roda testes/);
  assert.doesNotMatch(claude, /\*\*tom\*\*/, "skill global sem seta não tem «como usa»");
  const cursor = file(generateHarness(doc, "cursor"), ".cursor/agents/revisor.md").content;
  assert.match(cursor, /- \*\*checklist\*\*: Siga o checklist em cada PR antes de aprovar\./);
  assert.match(cursor, /- \*\*tom\*\* \(global\): Tom de voz do time/);
});

test("usage ausente: o corpo continua como antes (sem a seção «Como usar as skills»)", () => {
  const claude = file(generateHarness(build(team()), "claude"), ".claude/agents/revisor.md").content;
  assert.doesNotMatch(claude, /Como usar as skills/);
  assert.match(claude, /- \*\*qa\*\*: Escreve e roda testes/);
});

/* ───────── ferramentas: tools nativas e servidores MCP ───────── */

const tl = (id: string, agent: Partial<AgentNodeSpec>, parent?: string): Op => an(id, { role: "tool", ...agent } as AgentNodeSpec, parent);
const uses = (from: string, to: string, usage?: string, allow?: string[]): Op => ({ op: "add_connection", from, to, agent: { rel: "uses-tool", ...(usage ? { usage } : {}), ...(allow ? { allow } : {}) } });

const toolTeam = (): Op[] => [
  an("dev", { role: "agent", description: "Implementa as mudanças pedidas no código do projeto." }),
  an("qa", { role: "agent", description: "Testa a entrega no navegador e confere o resultado." }),
  tl("bash", { toolType: "native", toolName: "Bash", description: "Executa comandos." }),
  tl("read", { toolType: "native", toolName: "Read" }),
  tl("playwright", { toolType: "mcp", transport: "stdio", command: "npx", args: ["-y", "@playwright/mcp@latest"], description: "Controla um navegador." }),
  tl("github", { toolType: "mcp", transport: "http", url: "https://api.example.com/mcp", headers: { Authorization: "Bearer ${GITHUB_TOKEN}" } }),
  { op: "add_group", id: "glob", label: "Global", kind: "global" },
  tl("docs", { toolType: "mcp", transport: "stdio", command: "npx", args: ["docs-mcp"], env: { DOCS_URL: "${DOCS_URL:-https://docs.example.com}" } }, "glob"),
  tl("quebrado", { toolType: "mcp", transport: "stdio" }),
  uses("dev", "bash", "Só para rodar testes e o linter; nunca comandos destrutivos."),
  uses("dev", "read"),
  uses("dev", "playwright", "Abre a página para conferir o que implementou."),
  uses("dev", "github", undefined, ["create_issue"]),
  uses("qa", "playwright"),
  uses("qa", "github"),
  uses("qa", "quebrado"),
];

test("claude: tools nativas e mcp__ entram em tools:, MCP de um só agente fica inline e o compartilhado vai para .mcp.json", () => {
  const files = generateHarness(build(toolTeam()), "claude");
  const dev = fm(file(files, ".claude/agents/dev.md").content);
  assert.match(dev, /tools:\n  - Bash\n  - Read\n  - mcp__docs\n  - mcp__github__create_issue\n  - mcp__playwright\n/);
  // playwright é usado por dev E qa → referência por nome; github também; docs é global → herdado
  assert.match(dev, /mcpServers:\n  - github\n  - playwright$/);
  assert.doesNotMatch(dev, /"type":"stdio"/);
  const mcp = JSON.parse(file(files, ".mcp.json").content);
  assert.deepEqual(Object.keys(mcp.mcpServers), ["docs", "github", "playwright"]);
  assert.deepEqual(mcp.mcpServers.playwright, { type: "stdio", command: "npx", args: ["-y", "@playwright/mcp@latest"] });
  assert.deepEqual(mcp.mcpServers.github, { type: "http", url: "https://api.example.com/mcp", headers: { Authorization: "Bearer ${GITHUB_TOKEN}" } });
  assert.equal(mcp.mcpServers.docs.env.DOCS_URL, "${DOCS_URL:-https://docs.example.com}");
  assert.equal(mcp.mcpServers.quebrado, undefined, "servidor sem command não entra");
});

test("claude: sem nenhuma tool nativa o tools: é omitido (herda tudo, inclusive MCP)", () => {
  const qa = fm(file(generateHarness(build(toolTeam()), "claude"), ".claude/agents/qa.md").content);
  assert.doesNotMatch(qa, /^tools:/m);
  assert.match(qa, /mcpServers:\n  - github\n  - playwright$/);
});

test("claude: MCP de um único agente vai inline no frontmatter e não aparece em .mcp.json", () => {
  const ops = toolTeam().filter((o) => !(o.op === "add_connection" && o.from === "qa" && o.to === "playwright"));
  const files = generateHarness(build(ops), "claude");
  assert.match(fm(file(files, ".claude/agents/dev.md").content), /- \{"playwright":\{"type":"stdio","command":"npx","args":\["-y","@playwright\/mcp@latest"\]\}\}/);
  assert.deepEqual(Object.keys(JSON.parse(file(files, ".mcp.json").content).mcpServers), ["docs", "github"]);
});

test("claude: o «como usa» das ferramentas vai para o corpo", () => {
  const dev = file(generateHarness(build(toolTeam()), "claude"), ".claude/agents/dev.md").content;
  assert.match(dev, /## Como usar as ferramentas\n\n- \*\*Bash\*\*: Só para rodar testes e o linter; nunca comandos destrutivos\. _\(Executa comandos\.\)_/);
  assert.match(dev, /- \*\*playwright\*\*: Abre a página para conferir o que implementou\./);
});

test("cursor: todo servidor ligado vai para .cursor/mcp.json com ${env:VAR}; o agente só documenta", () => {
  const files = generateHarness(build(toolTeam()), "cursor");
  const mcp = JSON.parse(file(files, ".cursor/mcp.json").content);
  assert.deepEqual(Object.keys(mcp.mcpServers), ["docs", "github", "playwright"]);
  assert.deepEqual(mcp.mcpServers.github, { url: "https://api.example.com/mcp", headers: { Authorization: "Bearer ${env:GITHUB_TOKEN}" } });
  assert.equal(mcp.mcpServers.docs.env.DOCS_URL, "${env:DOCS_URL}");
  assert.equal(mcp.mcpServers.playwright.type, undefined);
  const dev = file(files, ".cursor/agents/dev.md").content;
  assert.doesNotMatch(fm(dev), /mcpServers/);
  assert.match(fm(dev), /tools:\n  - Bash\n  - Read$/);
  assert.match(dev, /## Ferramentas[\s\S]*valem para o projeto todo/);
  assert.match(dev, /- \*\*github\*\*: .* — só: create_issue/);
});

test("sem ferramentas o harness continua igual (nem .mcp.json)", () => {
  assert.ok(!generateHarness(build(team()), "claude").some((f) => f.path.endsWith("mcp.json")));
});
