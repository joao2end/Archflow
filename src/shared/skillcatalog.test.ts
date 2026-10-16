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
  parseSkillGithubUrl,
  skillInstallSlug,
  skillRawUrl,
  skillSourceDrifted,
  type SkillFetcher,
} from "./skillcatalog";

const mdFixture = ["---", "name: Diagnosing Bugs", 'description: "Loop de diagnóstico para bugs difíceis."', "---", "", "# Diagnosing Bugs", "", "Corpo da skill."].join("\n");

/* ───────── catálogo ───────── */

const fixture = { id: "frontend-design", name: "Frontend Design", repo: "anthropics/skills", skillPath: "skills/frontend-design/SKILL.md", description: "Direção visual intencional para UI.", tags: "ui design typescript" };

test("SKILL_CATALOG: não traz skills embutidas; o catálogo vem do skills.sh e das instaladas", () => {
  assert.deepEqual(SKILL_CATALOG, []);
  assert.deepEqual(searchSkillCatalog(""), []);
});

test("searchSkillCatalog: busca por texto livre ignora acento e maiúsculas; vazio devolve tudo", () => {
  assert.deepEqual(searchSkillCatalog("", [fixture]), [fixture]);
  assert.ok(searchSkillCatalog("DIREÇÃO", [fixture]).length === 1);
  assert.ok(searchSkillCatalog("typescript", [fixture]).length === 1);
  assert.deepEqual(searchSkillCatalog("inexistente-xyz", [fixture]), []);
});

test("parseSkillGithubUrl: blob, pasta, raw e owner/repo viram a fonte; o resto é rejeitado", () => {
  const pdf = { repo: "anthropics/skills", skillPath: "skills/pdf/SKILL.md" };
  assert.deepEqual(parseSkillGithubUrl("https://github.com/anthropics/skills/blob/main/skills/pdf/SKILL.md"), pdf);
  assert.deepEqual(parseSkillGithubUrl("https://github.com/anthropics/skills/tree/main/skills/pdf/"), pdf);
  assert.deepEqual(parseSkillGithubUrl("https://raw.githubusercontent.com/anthropics/skills/HEAD/skills/pdf/SKILL.md?token=1"), pdf);
  assert.deepEqual(parseSkillGithubUrl("anthropics/skills"), { repo: "anthropics/skills", skillPath: "SKILL.md" });
  assert.equal(parseSkillGithubUrl("https://github.com/anthropics/skills/issues/12"), undefined);
  assert.equal(parseSkillGithubUrl(""), undefined);
});

test("searchSkillCatalog e skillInstallSlug: skill instalada entra na busca; slug só quando o caminho tem pasta", () => {
  const extra = { id: "find-skills", name: "Find Skills", repo: "vercel-labs/skills", skillPath: "skills/find-skills/SKILL.md", description: "Descobre skills instaláveis.", body: "corpo", hash: "abcd1234" };
  assert.ok(searchSkillCatalog("descobre", [extra]).some((e) => e.id === "find-skills"));
  assert.equal(searchSkillCatalog("").length, SKILL_CATALOG.length);
  assert.equal(searchSkillCatalog("", [extra]).length, SKILL_CATALOG.length + 1);
  assert.equal(findSkillCatalogEntry("find-skills", [extra])?.repo, "vercel-labs/skills");
  assert.equal(skillInstallSlug("skills/pdf/SKILL.md"), "pdf");
  assert.equal(skillInstallSlug("plugins/javascript-typescript/skills/nodejs-backend-patterns/SKILL.md"), "nodejs-backend-patterns");
  assert.equal(skillInstallSlug("SKILL.md"), undefined);
});

test("findSkillCatalogEntry e catalogEntryToSource", () => {
  const e = findSkillCatalogEntry("frontend-design", [fixture])!;
  assert.equal(e.repo, "anthropics/skills");
  assert.deepEqual(catalogEntryToSource(e), { repo: "anthropics/skills", skillPath: "skills/frontend-design/SKILL.md" });
  assert.equal(findSkillCatalogEntry("nao-existe", [fixture]), undefined);
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
