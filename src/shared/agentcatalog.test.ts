import assert from "node:assert/strict";
import { test } from "node:test";
import { AGENT_TEMPLATES, applyTemplate, findAgentTemplate, searchAgentTemplates } from "./agentcatalog";
import { MCP_CATALOG } from "./mcpcatalog";
import { applyOps, validateDetailed } from "./ops";
import { emptyDoc, NATIVE_TOOL_NAMES, type Doc } from "./schema";

const empty = () => emptyDoc("Time", "agents");
const apply = (doc: Doc, id: string, at = { x: 0, y: 0 }) => {
  const r = applyTemplate(doc, findAgentTemplate(id)!, at);
  const out = applyOps(doc, r.ops);
  assert.ok(out.results.every((x) => x.ok), out.results.find((x) => !x.ok)?.error ?? "op falhou");
  return { ...r, doc: out.doc };
};
const rules = (doc: Doc) => validateDetailed(doc).map((i) => i.rule);

test("modelos: ids únicos, tools nativas e MCP existentes, sem ciclo de delegação", () => {
  assert.equal(new Set(AGENT_TEMPLATES.map((t) => t.id)).size, AGENT_TEMPLATES.length);
  for (const t of AGENT_TEMPLATES) {
    assert.ok(t.agents.length > 0 && t.description.length > 20, t.id);
    assert.equal(new Set(t.agents.map((a) => a.key)).size, t.agents.length, `${t.id}: keys repetidas`);
    for (const a of t.agents) {
      for (const tool of a.tools ?? []) assert.ok(NATIVE_TOOL_NAMES.includes(tool.name), `${t.id}: ${tool.name}`);
      for (const m of a.mcps ?? []) assert.ok(MCP_CATALOG.some((e) => e.id === m.id), `${t.id}: MCP ${m.id}`);
    }
    for (const d of t.delegations ?? []) assert.ok(t.agents.some((a) => a.key === d.from) && t.agents.some((a) => a.key === d.to), `${t.id}: delegação ${d.from}→${d.to}`);
    assert.equal(t.kind === "role", t.agents.length === 1, `${t.id}: papel = 1 agente`);
  }
});

test("todo modelo aplica num diagrama agents vazio sem erro nem aviso (só A006: skill do catálogo ainda não resolvida)", () => {
  for (const t of AGENT_TEMPLATES) {
    const { doc, agentIds } = apply(empty(), t.id);
    assert.equal(agentIds.length, t.agents.length, t.id);
    const bad = validateDetailed(doc).filter((i) => i.rule !== "A006");
    assert.deepEqual(bad, [], `${t.id}: ${bad.map((i) => `${i.rule} ${i.message}`).join(" | ")}`);
  }
});

test("time «Landing page»: 6 agentes, 5 delegações em ordem, skills só do catálogo e Playwright no QA", () => {
  const { doc } = apply(empty(), "team-landing-page");
  const agents = doc.nodes.filter((n) => n.agent?.role === "agent");
  assert.equal(agents.length, 6);
  const dels = doc.connections.filter((c) => c.agent?.rel === "delegates");
  assert.deepEqual(dels.map((c) => c.label), ["1. copy", "2. design", "3. código", "4. SEO", "5. QA"]);
  assert.ok(dels.every((c) => (c.agent?.usage ?? "").length > 30));
  const skills = doc.nodes.filter((n) => n.agent?.role === "skill");
  assert.ok(skills.length >= 4 && skills.every((s) => s.agent?.source && !s.agent.source.hash), "skills do catálogo, não resolvidas");
  const qa = doc.nodes.find((n) => n.label === "QA de interface")!;
  const toPlaywright = doc.connections.find((c) => c.from === qa.id && doc.nodes.find((n) => n.id === c.to)?.agent?.mcpSource?.id === "playwright");
  assert.ok(toPlaywright?.agent?.usage);
});

test("dois agentes que usam a mesma tool/skill compartilham o nó (nada duplicado)", () => {
  const { doc } = apply(empty(), "team-landing-page");
  const reads = doc.nodes.filter((n) => n.agent?.toolName === "Read");
  assert.equal(reads.length, 1);
  assert.ok(doc.connections.filter((c) => c.to === reads[0].id).length >= 4);
  const acc = doc.nodes.filter((n) => n.agent?.source?.skillPath === "skills/accessibility/SKILL.md");
  assert.equal(acc.length, 1);
  assert.equal(doc.connections.filter((c) => c.to === acc[0].id).length, 2);
});

test("aplicar de novo reaproveita tools, skills e MCP já existentes e não repete ids", () => {
  const first = apply(empty(), "role-qa-interface");
  const second = apply(first.doc, "role-redator", { x: 0, y: 600 });
  assert.equal(second.reused, 1, "Read já existia");
  const again = apply(second.doc, "role-qa-interface", { x: 800, y: 0 });
  assert.ok(again.reused >= 2, "Read e Playwright reaproveitados");
  const ids = again.doc.nodes.map((n) => n.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(again.doc.nodes.filter((n) => n.label === "QA de interface").length, 2);
  assert.equal(again.doc.nodes.filter((n) => n.agent?.mcpSource?.id === "playwright").length, 1);
});

test("nenhum nó se sobrepõe, mesmo aplicando vários modelos (cada um abaixo do que já existe, como a UI faz)", () => {
  const below = (d: Doc) => ({ x: 0, y: d.nodes.length ? Math.max(...d.nodes.map((n) => n.y + n.h)) + 160 : 0 });
  let doc = empty();
  for (const id of ["team-landing-page", "team-pesquisa-relatorio", "role-revisor-codigo", "team-revisao-codigo"]) doc = apply(doc, id, below(doc)).doc;
  const ns = doc.nodes;
  const clash = ns.flatMap((a, i) => ns.slice(i + 1).filter((b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h).map((b) => `${a.id}×${b.id}`));
  assert.deepEqual(clash, []);
});

test("é determinístico e as ops reproduzem o plano (mesmas ids ao reaplicar no mesmo doc)", () => {
  const a = applyTemplate(empty(), findAgentTemplate("team-landing-page")!, { x: 0, y: 0 });
  const b = applyTemplate(empty(), findAgentTemplate("team-landing-page")!, { x: 0, y: 0 });
  assert.deepEqual(a.ops, b.ops);
  const ids = a.ops.flatMap((o) => (o.op === "add_node" ? [o.id] : []));
  const out = applyOps(empty(), a.ops);
  assert.deepEqual(out.doc.nodes.map((n) => n.id).sort(), [...ids].sort());
});

test("busca por nome, tag e filtro de tipo, sem acento", () => {
  assert.deepEqual(searchAgentTemplates("landing").map((t) => t.id).sort(), ["team-landing-page", "team-landing-vue-motion"]);
  assert.deepEqual(searchAgentTemplates("revisao").map((t) => t.id).sort(), ["role-revisor-codigo", "team-revisao-codigo"]);
  assert.deepEqual(searchAgentTemplates("revisao", "role").map((t) => t.id), ["role-revisor-codigo"]);
  assert.equal(searchAgentTemplates("").length, AGENT_TEMPLATES.length);
  assert.deepEqual(searchAgentTemplates("zzz"), []);
});

test("rules: nada de segredo, e o doc aplicado passa no guia de describe", () => {
  const { doc } = apply(empty(), "team-pesquisa-relatorio");
  assert.ok(!rules(doc).includes("A011"));
  assert.match(JSON.stringify(doc), /context7/);
});

test("modelo «Revisão de código» traz prompts e um workflow executável", async () => {
  const { libraryFromDoc } = await import("./workflow");
  const { doc } = apply(empty(), "team-revisao-codigo");
  const lib = libraryFromDoc(doc);
  assert.equal(lib.prompts.length, 3);
  assert.deepEqual(lib.workflows[0].steps.map((s) => s.mode), ["auto", "manual", "manual"]);
  assert.equal(lib.prompts.find((p) => p.name === "Revisar a mudança")?.agent, "orquestrador");
  assert.equal(rules(doc).filter((r) => r === "A020" || r === "A022").length, 0);
});

test("time «Landing page Vue 3»: 8 agentes, 7 etapas, skills de Vue, assets e motion, e dois workflows", async () => {
  const { libraryFromDoc } = await import("./workflow");
  const { doc } = apply(empty(), "team-landing-vue-motion");
  assert.equal(doc.nodes.filter((n) => n.agent?.role === "agent").length, 8);
  const dels = doc.connections.filter((c) => c.agent?.rel === "delegates");
  assert.deepEqual(dels.map((c) => c.label), ["1. pesquisa", "2. copy", "3. assets", "4. motion", "5. código", "6. SEO", "7. QA"]);
  const skillPaths = doc.nodes.filter((n) => n.agent?.role === "skill").map((n) => n.agent!.source!.skillPath);
  for (const p of ["skills/vue/SKILL.md", "skills/gsap-scrolltrigger/SKILL.md", "skills/canvas-design/SKILL.md", "skills/remotion-best-practices/SKILL.md"]) assert.ok(skillPaths.includes(p), p);
  const lib = libraryFromDoc(doc);
  assert.equal(lib.prompts.length, 9);
  assert.deepEqual(lib.workflows.map((w) => w.steps.length), [9, 3]);
  assert.equal(lib.workflows[0].steps.filter((s) => s.mode === "auto").length, 2);
  assert.ok(lib.prompts.every((p) => p.agent), "todo prompt roda num agente");
  assert.ok(new Set(lib.prompts.map((p) => p.id)).size === 9);
});
