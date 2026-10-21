/**
 * Cenários do modo agents (ver docs/agents-scenarios.md, a matriz completa).
 * Cobre cada regra A0xx com caso positivo e negativo, a validação de entrada das ops e as
 * funções puras de agents.ts. Complementa agents.test.ts (fluxos já existentes) sem repeti-lo.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { applyOps, validateDetailed, type Op } from "./ops";
import { emptyDoc, type AgentNodeSpec, type AgentRel, type Doc } from "./schema";
import {
  agentConnectionTypeError,
  agentIssues,
  agentRelAllows,
  checkAgentConn,
  checkAgentNode,
  inGlobalGroup,
  looksLikeSecret,
  reshapeAgent,
  workflowSteps,
} from "./agents";

/* ───────── helpers ───────── */

const LONG = "Descrição suficientemente longa para o orquestrador decidir quando usar.";
const an = (id: string, agent: AgentNodeSpec, parent?: string): Op => ({ op: "add_node", id, label: id, kind: "agent", agent, ...(parent ? { parent } : {}) });
const rel = (from: string, to: string, r: AgentRel, extra: Record<string, unknown> = {}): Op => ({ op: "add_connection", from, to, agent: { rel: r, ...extra } } as Op);
const group = (id: string, kind: "global" | "group" = "global", parent?: string): Op => ({ op: "add_group", id, label: id, kind, ...(parent ? { parent } : {}) } as Op);

/** Monta um doc do modo agents; falha o teste se algum op não aplicar (fixture inválida). */
function build(ops: Op[]): Doc {
  const { doc, results } = applyOps(emptyDoc("t", "agents"), ops);
  const bad = results.map((r, i) => ({ r, op: ops[i] })).filter((x) => !x.r.ok);
  assert.deepEqual(bad.map((x) => x.r.error), [], "fixture: ops não aplicaram");
  return doc;
}
const rules = (doc: Doc) => validateDetailed(doc).map((i) => `${i.rule}:${i.severity}`);
const ruleOf = (doc: Doc, rule: string) => validateDetailed(doc).filter((i) => i.rule === rule);

/* ───────── validação de entrada: checkAgentNode ───────── */

test("checkAgentNode: aceita um agente, skill, tool, prompt e workflow bem formados", () => {
  assert.equal(checkAgentNode({ role: "agent", description: LONG, model: "sonnet", prompt: "x" }), undefined);
  assert.equal(checkAgentNode({ role: "skill", description: LONG, body: "# s" }), undefined);
  assert.equal(checkAgentNode({ role: "tool", toolType: "native", toolName: "Read" }), undefined);
  assert.equal(checkAgentNode({ role: "prompt", text: "Revise {{arquivo}}" }), undefined);
  assert.equal(checkAgentNode({ role: "workflow" }), undefined);
});

test("checkAgentNode: rejeita não-objeto e papel desconhecido com a lista de válidos", () => {
  assert.match(checkAgentNode(null)!, /deve ser um objeto/);
  assert.match(checkAgentNode("agent")!, /deve ser um objeto/);
  const e = checkAgentNode({ role: "robot" })!;
  assert.match(e, /agent\.role inválido "robot"/);
  assert.match(e, /agent, skill/);
});

test("checkAgentNode: campo de outro papel é rejeitado e a mensagem lista os campos do papel", () => {
  const e = checkAgentNode({ role: "skill", description: LONG, model: "opus" })!;
  assert.match(e, /campo "model" não existe no papel "skill"/);
  assert.match(e, /Campos do papel: description/);
});

test("checkAgentNode: campo com valor undefined é ignorado (não conta como campo extra)", () => {
  assert.equal(checkAgentNode({ role: "skill", description: LONG, model: undefined }), undefined);
});

test("checkAgentNode: tipos errados em texto, listas e objetos", () => {
  assert.match(checkAgentNode({ role: "agent", description: 42 })!, /agent\.description deve ser texto/);
  assert.match(checkAgentNode({ role: "tool", toolType: "native", toolName: ["Read"] })!, /agent\.toolName deve ser texto/);
  assert.match(checkAgentNode({ role: "agent", tools: "Read" })!, /lista de textos/);
  assert.match(checkAgentNode({ role: "agent", tools: ["Read", 3] })!, /lista de textos/);
  assert.match(checkAgentNode({ role: "tool", toolType: "mcp", mcpTools: [1] })!, /lista de textos/);
  assert.match(checkAgentNode({ role: "tool", toolType: "mcp", env: ["A"] })!, /agent\.env deve ser um objeto/);
  assert.match(checkAgentNode({ role: "tool", toolType: "mcp", headers: { A: 1 } })!, /agent\.headers deve ser um objeto/);
});

test("checkAgentNode: toolType e transport têm valores fechados", () => {
  assert.match(checkAgentNode({ role: "tool", toolType: "shell" })!, /toolType deve ser "native"/);
  assert.match(checkAgentNode({ role: "tool", toolType: "mcp", transport: "websocket" })!, /transport inválido "websocket"/);
  assert.equal(checkAgentNode({ role: "tool", toolType: "mcp", transport: "http", url: "https://x" }), undefined);
});

test("checkAgentNode: mcpSource exige catalog válido, id e campos conhecidos", () => {
  const base = { role: "tool", toolType: "mcp" };
  assert.match(checkAgentNode({ ...base, mcpSource: "curated" })!, /objeto \{ catalog, id, version\? \}/);
  assert.match(checkAgentNode({ ...base, mcpSource: { catalog: "npm", id: "x" } })!, /catalog deve ser "curated", "registry" ou "pasted"/);
  assert.match(checkAgentNode({ ...base, mcpSource: { catalog: "curated" } })!, /mcpSource\.id deve ser texto/);
  assert.match(checkAgentNode({ ...base, mcpSource: { catalog: "curated", id: "x", extra: 1 } })!, /não tem o campo "extra"/);
  assert.match(checkAgentNode({ ...base, mcpSource: { catalog: "curated", id: "x", version: 2 } })!, /version deve ser texto/);
  assert.equal(checkAgentNode({ ...base, mcpSource: { catalog: "registry", id: "x", version: "1.0.0" } }), undefined);
});

test("checkAgentNode: source de skill de catálogo exige owner/repo e skillPath", () => {
  const base = { role: "skill", description: LONG };
  assert.match(checkAgentNode({ ...base, source: "anthropics/skills" })!, /source deve ser um objeto/);
  assert.match(checkAgentNode({ ...base, source: { repo: "sem-barra", skillPath: "a" } })!, /owner\/repo/);
  assert.match(checkAgentNode({ ...base, source: { repo: "a/b/c", skillPath: "a" } })!, /owner\/repo/);
  assert.match(checkAgentNode({ ...base, source: { repo: "a/b", skillPath: "  " } })!, /skillPath/);
  assert.match(checkAgentNode({ ...base, source: { repo: "a/b", skillPath: "x", hash: 1 } })!, /hash deve ser texto/);
  assert.match(checkAgentNode({ ...base, source: { repo: "a/b", skillPath: "x", ref: "main" } })!, /não tem o campo "ref"/);
  assert.equal(checkAgentNode({ ...base, source: { repo: "anthropics/skills", skillPath: "skills/pdf", hash: "ab12" } }), undefined);
});

test("checkAgentNode: env e headers aceitam ${VAR} e rejeitam valores não-texto", () => {
  const base = { role: "tool", toolType: "mcp", transport: "http", url: "https://x" };
  assert.equal(checkAgentNode({ ...base, headers: { Authorization: "Bearer ${TOKEN}" } }), undefined);
  assert.match(checkAgentNode({ ...base, env: null })!, /objeto/);
});

/* ───────── validação de entrada: checkAgentConn ───────── */

test("checkAgentConn: rel obrigatório e de vocabulário fechado", () => {
  assert.match(checkAgentConn(null)!, /deve ser um objeto/);
  assert.match(checkAgentConn({})!, /agent\.rel inválido "undefined"/);
  assert.match(checkAgentConn({ rel: "owns" })!, /agent\.rel inválido "owns"/);
  assert.equal(checkAgentConn({ rel: "uses-skill", usage: "quando o diff toca auth" }), undefined);
});

test("checkAgentConn: campos fora da lista são recusados", () => {
  assert.match(checkAgentConn({ rel: "delegates", color: "red" })!, /não tem o campo "color"/);
});

test("checkAgentConn: usage precisa ser texto", () => {
  assert.match(checkAgentConn({ rel: "delegates", usage: 1 })!, /usage deve ser um texto/);
});

test("checkAgentConn: allow só vale em uses-tool e precisa ser lista de textos", () => {
  assert.equal(checkAgentConn({ rel: "uses-tool", allow: ["list_issues"] }), undefined);
  assert.match(checkAgentConn({ rel: "uses-tool", allow: "list_issues" })!, /allow deve ser uma lista/);
  assert.match(checkAgentConn({ rel: "uses-tool", allow: [1] })!, /allow deve ser uma lista/);
  assert.match(checkAgentConn({ rel: "uses-skill", allow: ["x"] })!, /allow só vale em uses-tool/);
});

test("checkAgentConn: order e mode só valem em step; order é inteiro >= 1; mode é manual|auto", () => {
  assert.equal(checkAgentConn({ rel: "step", order: 1, mode: "auto" }), undefined);
  assert.match(checkAgentConn({ rel: "delegates", order: 1 })!, /order só vale em step/);
  assert.match(checkAgentConn({ rel: "delegates", mode: "auto" })!, /mode só vale em step/);
  assert.match(checkAgentConn({ rel: "step", order: 0 })!, /inteiro a partir de 1/);
  assert.match(checkAgentConn({ rel: "step", order: 1.5 })!, /inteiro a partir de 1/);
  assert.match(checkAgentConn({ rel: "step", order: "1" })!, /inteiro a partir de 1/);
  assert.match(checkAgentConn({ rel: "step", mode: "sempre" })!, /"manual" ou "auto"/);
});

/* ───────── papéis e tipos de conexão ───────── */

test("reshapeAgent: troca de papel descarta campos que o novo papel não aceita", () => {
  const old = { role: "agent", description: LONG, model: "opus", prompt: "p" } as AgentNodeSpec;
  const skill = reshapeAgent(old, "skill");
  assert.deepEqual(skill, { role: "skill", description: LONG });
  assert.equal(reshapeAgent(undefined, "prompt").role, "prompt");
});

test("agentRelAllows: pares válidos e papéis desconhecidos", () => {
  assert.equal(agentRelAllows("uses-skill", "agent", "skill"), true);
  assert.equal(agentRelAllows("uses-skill", "skill", "agent"), false);
  assert.equal(agentRelAllows("delegates", "agent", "agent"), true);
  assert.equal(agentRelAllows("delegates", "agent", "skill"), false);
  assert.equal(agentRelAllows("uses-skill", undefined, "skill"), false);
});

test("agentConnectionTypeError: type que contradiz a relação é erro; type igual ou ausente não", () => {
  assert.equal(agentConnectionTypeError("uses-skill", "dependency"), undefined);
  assert.equal(agentConnectionTypeError("uses-skill", undefined), undefined);
  assert.equal(agentConnectionTypeError(undefined, "sync"), undefined);
  assert.match(agentConnectionTypeError("uses-skill", "sync")!, /fixa o type em "dependency"/);
});

/* ───────── escopo global ───────── */

test("inGlobalGroup: detecta grupo global em qualquer profundidade e ignora grupo comum", () => {
  const doc = build([
    group("g1", "global"),
    group("sub", "group", "g1"),
    group("comum", "group"),
    an("skill-fundo", { role: "skill", description: LONG }, "sub"),
    an("skill-comum", { role: "skill", description: LONG }, "comum"),
  ]);
  assert.equal(inGlobalGroup(doc, "skill-fundo"), true);
  assert.equal(inGlobalGroup(doc, "sub"), true);
  assert.equal(inGlobalGroup(doc, "skill-comum"), false);
  assert.equal(inGlobalGroup(doc, "nao-existe"), false);
});

test("inGlobalGroup: pai inexistente não trava nem dá falso positivo", () => {
  const doc = build([an("x", { role: "skill", description: LONG })]);
  doc.nodes[0].parent = "fantasma";
  assert.equal(inGlobalGroup(doc, "x"), false);
});

/* ───────── segredos ───────── */

test("looksLikeSecret: chave sensível com valor literal é segredo; ${VAR} não é", () => {
  assert.equal(looksLikeSecret("GITHUB_TOKEN", "abc123"), true);
  assert.equal(looksLikeSecret("api_key", "xyz"), true);
  assert.equal(looksLikeSecret("Authorization", "Basic xyz"), true);
  assert.equal(looksLikeSecret("GITHUB_TOKEN", "${GITHUB_TOKEN}"), false);
  assert.equal(looksLikeSecret("Authorization", "Bearer ${API}"), false);
});

test("looksLikeSecret: valor com prefixo de provedor é segredo mesmo com chave neutra", () => {
  assert.equal(looksLikeSecret("MEU_VALOR", "sk-proj-abcdef"), true);
  assert.equal(looksLikeSecret("MEU_VALOR", "ghp_0123456789"), true);
  assert.equal(looksLikeSecret("MEU_VALOR", "AKIAIOSFODNN7EXAMPLE"), true);
  assert.equal(looksLikeSecret("MEU_VALOR", "Bearer abcdefgh"), true);
});

test("looksLikeSecret: valores comuns não são segredo", () => {
  assert.equal(looksLikeSecret("LOG_LEVEL", "debug"), false);
  assert.equal(looksLikeSecret("REGION", "sa-east-1"), false);
  assert.equal(looksLikeSecret("MODE", "Bearer x"), false); // curto demais para o padrão de bearer
});

/* ───────── workflows ───────── */

test("workflowSteps: ordena por order, cai para a ordem das setas e ignora alvos que não são prompt", () => {
  const doc = build([
    an("wf", { role: "workflow" }),
    an("p-a", { role: "prompt", text: "A" }),
    an("p-b", { role: "prompt", text: "B" }),
    an("p-c", { role: "prompt", text: "C" }),
    an("ag", { role: "agent", description: LONG }),
    rel("wf", "p-b", "step", { order: 2 }),
    rel("wf", "p-a", "step", { order: 1, mode: "auto" }),
    rel("wf", "p-c", "step"),
    rel("wf", "ag", "step"),
  ]);
  const steps = workflowSteps(doc, "wf");
  assert.deepEqual(steps.map((s) => s.prompt.id), ["p-a", "p-b", "p-c"]);
  assert.equal(steps[0].mode, "auto");
  assert.equal(steps[1].mode, "manual");
});

test("A022: workflow sem passos avisa; com passo não", () => {
  assert.equal(ruleOf(build([an("wf", { role: "workflow" })]), "A022").length, 1);
  const doc = build([an("wf", { role: "workflow" }), an("p", { role: "prompt", text: "x" }), rel("wf", "p", "step")]);
  assert.equal(ruleOf(doc, "A022").length, 0);
});

test("A020: prompt sem text é erro; com text não", () => {
  const vazio = ruleOf(build([an("p", { role: "prompt", text: "   " })]), "A020");
  assert.equal(vazio[0].severity, "erro");
  assert.equal(ruleOf(build([an("p", { role: "prompt", text: "ok" })]), "A020").length, 0);
});

test("A021: runs-on para mais de um agente avisa; para um só não", () => {
  const dois = build([an("p", { role: "prompt", text: "x" }), an("a1", { role: "agent", description: LONG }), an("a2", { role: "agent", description: LONG }), rel("p", "a1", "runs-on"), rel("p", "a2", "runs-on")]);
  assert.equal(ruleOf(dois, "A021").length, 1);
  const um = build([an("p", { role: "prompt", text: "x" }), an("a1", { role: "agent", description: LONG }), rel("p", "a1", "runs-on")]);
  assert.equal(ruleOf(um, "A021").length, 0);
});

/* ───────── regras de agente e skill ───────── */

test("A001: agent sem description é erro; description curta é aviso; longa não avisa", () => {
  const doc = build([an("sem", { role: "agent" }), an("curta", { role: "agent", description: "Revisa código." }), an("ok", { role: "agent", description: LONG })]);
  const hits = agentIssues(doc).filter((i) => i.rule === "A001");
  assert.deepEqual(hits.map((i) => [i.target, i.severity]), [["sem", "erro"], ["curta", "aviso"]]);
});

test("A002: skill sem description é erro (e não repete o aviso de curta)", () => {
  const doc = build([an("s", { role: "skill" })]);
  const hits = agentIssues(doc).filter((i) => i.rule === "A002");
  assert.equal(hits.length, 1);
  assert.equal(hits[0].severity, "erro");
});

test("A006: skill de catálogo sem hash avisa que o body está vazio até resolver", () => {
  const doc = build([an("s", { role: "skill", description: LONG, source: { repo: "anthropics/skills", skillPath: "skills/pdf" } })]);
  assert.equal(ruleOf(doc, "A006").length, 1);
  const resolvida = build([an("s", { role: "skill", description: LONG, source: { repo: "anthropics/skills", skillPath: "skills/pdf", hash: "f00d" } })]);
  assert.equal(ruleOf(resolvida, "A006").length, 0);
});

test("A003: skill órfã avisa; dentro do Global ou com uses-skill não", () => {
  const orfa = build([an("s", { role: "skill", description: LONG })]);
  assert.equal(ruleOf(orfa, "A003").length, 1);
  const global = build([group("g"), an("s", { role: "skill", description: LONG }, "g")]);
  assert.equal(ruleOf(global, "A003").length, 0);
  const ligada = build([an("a", { role: "agent", description: LONG }), an("s", { role: "skill", description: LONG }), rel("a", "s", "uses-skill", { usage: "quando o diff toca auth" })]);
  assert.equal(ruleOf(ligada, "A003").length, 0);
});

test("A004: uses-skill para skill que já está no Global é redundante", () => {
  const doc = build([group("g"), an("a", { role: "agent", description: LONG }), an("s", { role: "skill", description: LONG }, "g"), rel("a", "s", "uses-skill", { usage: "quando o diff toca auth" })]);
  assert.equal(ruleOf(doc, "A004").length, 1);
});

test("A005: ciclo de delegates de três agentes é erro; cadeia sem volta não", () => {
  const ciclo = build([
    an("a", { role: "agent", description: LONG }),
    an("b", { role: "agent", description: LONG }),
    an("c", { role: "agent", description: LONG }),
    rel("a", "b", "delegates", { usage: "quando precisa de testes" }),
    rel("b", "c", "delegates", { usage: "quando precisa de revisão" }),
    rel("c", "a", "delegates", { usage: "quando precisa de docs" }),
  ]);
  const hits = ruleOf(ciclo, "A005");
  assert.equal(hits.length, 1);
  assert.equal(hits[0].severity, "erro");
  const cadeia = build([
    an("a", { role: "agent", description: LONG }),
    an("b", { role: "agent", description: LONG }),
    an("c", { role: "agent", description: LONG }),
    rel("a", "b", "delegates", { usage: "quando precisa de testes" }),
    rel("b", "c", "delegates", { usage: "quando precisa de revisão" }),
  ]);
  assert.equal(ruleOf(cadeia, "A005").length, 0);
});

test("A008/A009: relação em par inválido avisa com sugestão; conexão sem relação avisa", () => {
  const doc = build([an("a", { role: "agent", description: LONG }), an("s", { role: "skill", description: LONG }), rel("s", "a", "uses-skill", { usage: "quando" })]);
  const invalida = ruleOf(doc, "A008");
  assert.equal(invalida.length, 1);
  assert.match(invalida[0].message, /liga agent → skill/);
  assert.doesNotMatch(invalida[0].message, /Para este par use/); // nenhuma relação liga skill → agent
  // skill → skill não tem relação: a conexão nasce sem rel e A009 avisa que nenhuma relação liga o par
  const sem = build([an("s1", { role: "skill", description: LONG }), an("s2", { role: "skill", description: LONG }), { op: "add_connection", from: "s1", to: "s2" }]);
  const a009 = ruleOf(sem, "A009");
  assert.equal(a009.length, 1);
  assert.match(a009[0].message, /nenhuma relação liga este par/);
  // agent → skill sem rel: o op infere uses-skill (único par possível), então não há A009
  const inferida = build([an("a", { role: "agent", description: LONG }), an("s", { role: "skill", description: LONG }), { op: "add_connection", from: "a", to: "s" }]);
  assert.equal(inferida.connections[0].agent?.rel, "uses-skill");
  assert.equal(ruleOf(inferida, "A009").length, 0);
});

test("A018: relação sem usage avisa; usage curto avisa; usage bom não", () => {
  const sem = build([an("a", { role: "agent", description: LONG }), an("s", { role: "skill", description: LONG }), rel("a", "s", "uses-skill")]);
  assert.equal(ruleOf(sem, "A018").length, 1);
  const curto = build([an("a", { role: "agent", description: LONG }), an("s", { role: "skill", description: LONG }), rel("a", "s", "uses-skill", { usage: "auth" })]);
  assert.equal(ruleOf(curto, "A018").length, 1);
  const bom = build([an("a", { role: "agent", description: LONG }), an("s", { role: "skill", description: LONG }), rel("a", "s", "uses-skill", { usage: "quando o diff toca auth" })]);
  assert.equal(ruleOf(bom, "A018").length, 0);
});

test("agentIssues não dispara nenhuma regra de agente num time limpo", () => {
  const doc = build([
    an("revisor", { role: "agent", description: LONG }),
    an("checklist", { role: "skill", description: LONG, body: "# c" }),
    rel("revisor", "checklist", "uses-skill", { usage: "aplica o checklist em cada diff antes de aprovar" }),
  ]);
  assert.deepEqual(agentIssues(doc), []);
});

/* ───────── ferramentas ───────── */

test("A013: tool sem toolType é erro; nativa sem toolName é erro; nome desconhecido é aviso", () => {
  const doc = build([
    an("t1", { role: "tool", description: LONG }),
    an("t2", { role: "tool", toolType: "native", description: LONG }),
    an("t3", { role: "tool", toolType: "native", toolName: "Lerarquivo", description: LONG }),
  ]);
  const hits = ruleOf(doc, "A013");
  assert.deepEqual(hits.map((h) => [h.target, h.severity]), [["t1", "erro"], ["t2", "erro"], ["t3", "aviso"]]);
});

test("A010: MCP stdio sem command é erro; MCP http sem url é erro", () => {
  const doc = build([
    an("stdio", { role: "tool", toolType: "mcp", transport: "stdio", description: LONG }),
    an("http", { role: "tool", toolType: "mcp", transport: "http", description: LONG }),
  ]);
  const hits = ruleOf(doc, "A010");
  assert.deepEqual(hits.map((h) => h.target), ["stdio", "http"]);
});

test("A011: segredo literal em env é erro e a mensagem sugere ${VAR}", () => {
  const doc = build([an("mcp", { role: "tool", toolType: "mcp", transport: "stdio", command: "npx", env: { GITHUB_TOKEN: "ghp_123456789" }, description: LONG })]);
  const hit = ruleOf(doc, "A011")[0];
  assert.equal(hit.severity, "erro");
  assert.match(hit.message, /\$\{GITHUB_TOKEN\}/);
});

test("A011: ${VAR} em env e headers não gera erro", () => {
  const doc = build([an("mcp", { role: "tool", toolType: "mcp", transport: "http", url: "https://x", headers: { Authorization: "Bearer ${TOKEN}" }, description: LONG })]);
  assert.equal(ruleOf(doc, "A011").length, 0);
});

test("A016: transporte sse é obsoleto (aviso)", () => {
  const doc = build([an("mcp", { role: "tool", toolType: "mcp", transport: "sse", url: "https://x", description: LONG })]);
  assert.equal(ruleOf(doc, "A016").length, 1);
});

test("A012: tool sem nenhum agent avisa; com uses-tool ou no Global não", () => {
  const solta = build([an("t", { role: "tool", toolType: "native", toolName: "Read", description: LONG })]);
  assert.equal(ruleOf(solta, "A012").length, 1);
  const ligada = build([an("a", { role: "agent", description: LONG }), an("t", { role: "tool", toolType: "native", toolName: "Read", description: LONG }), rel("a", "t", "uses-tool", { usage: "para ler o diff do PR" })]);
  assert.equal(ruleOf(ligada, "A012").length, 0);
  const global = build([group("g"), an("t", { role: "tool", toolType: "native", toolName: "Read", description: LONG }, "g")]);
  assert.equal(ruleOf(global, "A012").length, 0);
});

test("A015: allow citando tool que o servidor não lista avisa; allow em tool nativa avisa", () => {
  const mcpOk = build([
    an("a", { role: "agent", description: LONG }),
    an("mcp", { role: "tool", toolType: "mcp", transport: "stdio", command: "npx", mcpTools: ["list_issues", "get_issue"], description: LONG }),
    rel("a", "mcp", "uses-tool", { usage: "para listar issues abertas", allow: ["list_issues", "fantasma"] }),
  ]);
  const hit = ruleOf(mcpOk, "A015");
  assert.equal(hit.length, 1);
  assert.match(hit[0].message, /fantasma/);
  const nativa = build([
    an("a", { role: "agent", description: LONG }),
    an("t", { role: "tool", toolType: "native", toolName: "Read", description: LONG }),
    rel("a", "t", "uses-tool", { usage: "para ler o diff do PR", allow: ["x"] }),
  ]);
  assert.equal(ruleOf(nativa, "A015").length, 1);
});

test("A014: campo tools em texto em agente avisa para modelar como componentes Tool", () => {
  const doc = build([an("a", { role: "agent", description: LONG, tools: ["Read"] })]);
  assert.equal(ruleOf(doc, "A014").length, 1);
});

/* ───────── validação de entrada das ops (integração com ops.ts) ───────── */

test("ops: papel de agente só aceita no modo agents; kind agent exige agent", () => {
  const r = applyOps(emptyDoc("t", "agents"), [{ op: "add_node", label: "x", kind: "agent" }]);
  assert.equal(r.results[0].ok, false);
});

test("ops: add_node com agent inválido devolve a mensagem da validação", () => {
  const r = applyOps(emptyDoc("t", "agents"), [an("x", { role: "skill", model: "opus" } as AgentNodeSpec)]);
  assert.equal(r.results[0].ok, false);
  assert.match(r.results[0].error!, /campo "model" não existe no papel "skill"/);
});

test("ops: update troca o papel mantendo só campos válidos (reshapeAgent)", () => {
  const doc = build([an("x", { role: "agent", description: LONG, model: "opus" })]);
  const { doc: next, results } = applyOps(doc, [{ op: "update", id: "x", patch: { agent: { role: "skill", description: LONG } } }]);
  assert.ok(results.every((x) => x.ok), results.find((x) => !x.ok)?.error ?? "");
  assert.deepEqual(next.nodes[0].agent, { role: "skill", description: LONG });
});

test("ops: conexão com rel inválido é recusada; rel válido infere o type", () => {
  const r = applyOps(emptyDoc("t", "agents"), [an("a", { role: "agent", description: LONG }), an("b", { role: "agent", description: LONG }), rel("a", "b", "mentor" as AgentRel)]);
  assert.equal(r.results[2].ok, false);
});

test("validateDetailed: um time limpo não produz erro nem aviso do modo agents", () => {
  const doc = build([
    an("revisor", { role: "agent", description: LONG }),
    an("checklist", { role: "skill", description: LONG, body: "# c" }),
    rel("revisor", "checklist", "uses-skill", { usage: "aplica o checklist em cada diff antes de aprovar" }),
  ]);
  const agentRules = rules(doc).filter((r) => /^A0/.test(r));
  assert.deepEqual(agentRules, []);
});

test("A002 (tool): ferramenta MCP sem description avisa; nativa sem description não avisa", () => {
  const doc = build([
    an("mcp-sem", { role: "tool", toolType: "mcp", transport: "http", url: "https://x" }),
    an("nat-sem", { role: "tool", toolType: "native", toolName: "Read" }),
  ]);
  const hits = ruleOf(doc, "A002");
  assert.deepEqual(hits.map((h) => [h.target, h.severity]), [["mcp-sem", "aviso"]]);
});

test("add_node de agente sem technology herda o nome do papel (o canvas mostra «Skill», não «agent»)", () => {
  const doc = build([an("chk", { role: "skill", description: LONG }), an("ag", { role: "agent", description: LONG }), an("tl", { role: "tool", toolType: "native", toolName: "Read", description: LONG })]);
  assert.equal(doc.nodes.find((n) => n.id === "chk")!.technology, "Skill");
  assert.equal(doc.nodes.find((n) => n.id === "ag")!.technology, "Agent");
  assert.equal(doc.nodes.find((n) => n.id === "tl")!.technology, "Tool");
  const custom = build([{ op: "add_node", id: "x", label: "x", kind: "agent", technology: "Claude Sonnet", agent: { role: "agent", description: LONG } }]);
  assert.equal(custom.nodes[0].technology, "Claude Sonnet");
});
