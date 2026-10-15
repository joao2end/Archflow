import assert from "node:assert/strict";
import { test } from "node:test";
import {
  SKILL_CATALOG,
  catalogEntryToSource,
  findSkillCatalogEntry,
  hashSkillContent,
  parseSkillMarkdown,
  resolveSkillSource,
  searchSkillCatalog,
  skillRawUrl,
  skillSourceDrifted,
  type SkillFetcher,
} from "./skillcatalog";

const mdFixture = ["---", "name: Diagnosing Bugs", 'description: "Loop de diagnóstico para bugs difíceis."', "---", "", "# Diagnosing Bugs", "", "Corpo da skill."].join("\n");

/* ───────── catálogo ───────── */

test("SKILL_CATALOG: entradas têm repo owner/repo e skillPath apontando pra um SKILL.md", () => {
  assert.ok(SKILL_CATALOG.length >= 6);
  for (const e of SKILL_CATALOG) {
    assert.match(e.repo, /^[^/\s]+\/[^/\s]+$/, e.id);
    assert.match(e.skillPath, /SKILL\.md$/, e.id);
    assert.ok(e.description.length >= 20, e.id);
  }
  const ids = SKILL_CATALOG.map((e) => e.id);
  assert.equal(new Set(ids).size, ids.length, "ids únicos");
});

test("searchSkillCatalog: busca por texto livre ignora acento e maiúsculas; vazio devolve tudo", () => {
  assert.deepEqual(searchSkillCatalog(""), SKILL_CATALOG);
  assert.ok(searchSkillCatalog("DIAGNÓSTICO").some((e) => e.id === "diagnosing-bugs"));
  assert.ok(searchSkillCatalog("typescript").some((e) => e.id === "typescript-advanced-types"));
  assert.deepEqual(searchSkillCatalog("inexistente-xyz"), []);
});

test("findSkillCatalogEntry e catalogEntryToSource", () => {
  const e = findSkillCatalogEntry("frontend-design")!;
  assert.equal(e.repo, "anthropics/skills");
  assert.deepEqual(catalogEntryToSource(e), { repo: "anthropics/skills", skillPath: "skills/frontend-design/SKILL.md" });
  assert.equal(findSkillCatalogEntry("nao-existe"), undefined);
});

/* ───────── parseSkillMarkdown ───────── */

test("parseSkillMarkdown: separa frontmatter (name/description, com e sem aspas) do corpo", () => {
  const p = parseSkillMarkdown(mdFixture);
  assert.equal(p.name, "Diagnosing Bugs");
  assert.equal(p.description, "Loop de diagnóstico para bugs difíceis.");
  assert.equal(p.body, "# Diagnosing Bugs\n\nCorpo da skill.");
});

test("parseSkillMarkdown: sem frontmatter, tudo é corpo", () => {
  const p = parseSkillMarkdown("# Sem frontmatter\n\nconteúdo");
  assert.equal(p.name, undefined);
  assert.equal(p.description, undefined);
  assert.equal(p.body, "# Sem frontmatter\n\nconteúdo");
});

/* ───────── hash ───────── */

test("hashSkillContent: determinístico, ignora CRLF x LF, muda com o conteúdo", () => {
  assert.equal(hashSkillContent("abc"), hashSkillContent("abc"));
  assert.equal(hashSkillContent("a\r\nb"), hashSkillContent("a\nb"));
  assert.notEqual(hashSkillContent("abc"), hashSkillContent("abd"));
  assert.match(hashSkillContent("abc"), /^[0-9a-f]{8}$/);
});

/* ───────── skillRawUrl ───────── */

test("skillRawUrl: monta a URL raw do GitHub, ref HEAD por padrão", () => {
  const url = skillRawUrl({ repo: "anthropics/skills", skillPath: "skills/frontend-design/SKILL.md" });
  assert.equal(url, "https://raw.githubusercontent.com/anthropics/skills/HEAD/skills/frontend-design/SKILL.md");
  assert.equal(skillRawUrl({ repo: "a/b", skillPath: "x/SKILL.md" }, "main"), "https://raw.githubusercontent.com/a/b/main/x/SKILL.md");
});

/* ───────── resolveSkillSource ───────── */

const okFetch = (body: string): SkillFetcher => async () => ({ ok: true, status: 200, text: async () => body });
const notFoundFetch: SkillFetcher = async () => ({ ok: false, status: 404, text: async () => "" });

test("resolveSkillSource: baixa, separa frontmatter e calcula hash (fetch injetado)", async () => {
  const r = await resolveSkillSource({ repo: "mattpocock/skills", skillPath: "skills/engineering/diagnosing-bugs/SKILL.md" }, okFetch(mdFixture));
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.name, "Diagnosing Bugs");
    assert.equal(r.description, "Loop de diagnóstico para bugs difíceis.");
    assert.equal(r.hash, hashSkillContent(mdFixture));
    assert.equal(r.body, "# Diagnosing Bugs\n\nCorpo da skill.");
  }
});

test("resolveSkillSource: 404 do GitHub vira erro acionável, não exceção", async () => {
  const r = await resolveSkillSource({ repo: "a/b", skillPath: "nope/SKILL.md" }, notFoundFetch);
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.error, /404/);
});

test("resolveSkillSource: fetch que lança (rede fora) vira erro acionável", async () => {
  const boom: SkillFetcher = async () => {
    throw new Error("network down");
  };
  const r = await resolveSkillSource({ repo: "a/b", skillPath: "x/SKILL.md" }, boom);
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.error, /network down/);
});

test("resolveSkillSource: sem fetchImpl e sem fetch global, erro claro (não lança)", async () => {
  const saved = globalThis.fetch;
  // @ts-expect-error simula ambiente sem fetch global
  globalThis.fetch = undefined;
  try {
    const r = await resolveSkillSource({ repo: "a/b", skillPath: "x/SKILL.md" });
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /fetch não está disponível/);
  } finally {
    globalThis.fetch = saved;
  }
});

/* ───────── skillSourceDrifted ───────── */

test("skillSourceDrifted: sem hash prévio não é drift; hash igual não é drift; hash diferente é drift", () => {
  assert.equal(skillSourceDrifted(undefined, "abcd1234"), false);
  assert.equal(skillSourceDrifted({ repo: "a/b", skillPath: "x" }, "abcd1234"), false, "sem source.hash prévio, nada a comparar");
  assert.equal(skillSourceDrifted({ repo: "a/b", skillPath: "x", hash: "abcd1234" }, "abcd1234"), false);
  assert.equal(skillSourceDrifted({ repo: "a/b", skillPath: "x", hash: "abcd1234" }, "ffff0000"), true);
});
