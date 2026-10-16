import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";

const CFG = mkdtempSync(join(tmpdir(), "archflow-skills-"));
process.env.ARCHFLOW_CONFIG = CFG;
const { installSkillFromCatalog, listDownloadedSkills, addSkillSource, indexedSkills, listSkillSources, removeSkillSource, searchSkillsHub, topSkillsHub } = await import("./bridge");

const realFetch = globalThis.fetch;
afterEach(() => void (globalThis.fetch = realFetch));
const mockFetch = (routes: Record<string, () => Response>) => {
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    const hit = Object.entries(routes).find(([k]) => url.includes(k));
    if (!hit) throw new Error(`fetch inesperado: ${url}`);
    return hit[1]();
  }) as typeof fetch;
};
const row = (rank: number, repo: string, name: string, installs: string) =>
  `<a class="group grid grid-cols-[auto_1fr_auto]" href="/${repo}/${name}"><div><span>${rank}</span></div><div><h3>${name}</h3><p>${repo}</p></div><div><span>${installs}</span></div></a>`;

test("topSkillsHub: lê o ranking da home do skills.sh (K/M viram número) e ignora duplicatas", async () => {
  mockFetch({ "skills.sh": () => new Response(`<html>${row(1, "vercel-labs/skills", "find-skills", "3.9M")}${row(2, "a/b", "pdf", "227.6K")}${row(3, "a/b", "pdf", "227.6K")}</html>`) });
  const { skills } = await topSkillsHub();
  assert.deepEqual(skills, [
    { repo: "vercel-labs/skills", skillId: "find-skills", name: "find-skills", installs: 3_900_000 },
    { repo: "a/b", skillId: "pdf", name: "pdf", installs: 227_600 },
  ]);
});

test("searchSkillsHub: busca curta não consulta a rede; resultado inválido é filtrado", async () => {
  mockFetch({});
  assert.deepEqual((await searchSkillsHub("a")).skills, []);
  mockFetch({ "api/search": () => Response.json({ skills: [{ source: "x/y", skillId: "ok", name: "ok", installs: 5 }, { source: "../etc", skillId: "bad", installs: 1 }] }) });
  assert.deepEqual((await searchSkillsHub("ok")).skills, [{ repo: "x/y", skillId: "ok", name: "ok", installs: 5 }]);
});

test("fontes de skills: adiciona, indexa o SKILL.md de cada pasta, busca e remove (banco local)", async () => {
  const skill = (n: string) => `---\nname: ${n}\ndescription: Faz ${n}\n---\ncorpo`;
  mockFetch({
    "git/trees": () => Response.json({ tree: [{ path: "skills/pdf/SKILL.md", type: "blob" }, { path: "skills/docx/SKILL.md", type: "blob" }, { path: "README.md", type: "blob" }] }),
    "skills/pdf/SKILL.md": () => new Response(skill("pdf")),
    "skills/docx/SKILL.md": () => new Response(skill("docx")),
  });
  const { sources } = await addSkillSource({ repo: "https://github.com/acme/tools.git" });
  const mine = sources.find((s) => s.repo === "acme/tools");
  assert.equal(mine?.count, 2);
  assert.ok(mine?.indexedAt);
  assert.equal(indexedSkills("").skills.filter((s) => s.repo === "acme/tools").length, 2);
  assert.deepEqual(indexedSkills("faz pdf").skills.map((s) => [s.id, s.skillPath, s.description]), [["pdf", "skills/pdf/SKILL.md", "Faz pdf"]]);
  assert.ok(!listSkillSources().sources.some((s) => s.error));
  removeSkillSource({ repo: "acme/tools" });
  assert.equal(indexedSkills("").skills.filter((s) => s.repo === "acme/tools").length, 0);
});

test("fontes de skills: falha do GitHub vira erro na fonte, sem derrubar nada", async () => {
  mockFetch({ "git/trees": () => new Response("{}", { status: 403 }) });
  const { sources } = await addSkillSource({ repo: "acme/limit" });
  assert.match(sources.find((s) => s.repo === "acme/limit")?.error ?? "", /limite/);
  await assert.rejects(() => addSkillSource({ repo: "nao é repo" }));
});

test("skills baixadas: o banco local evita novo download (acha por caminho ou por slug)", async () => {
  assert.deepEqual(listDownloadedSkills().skills, []);
  mkdirSync(CFG, { recursive: true });
  const row = { id: "pdf", name: "pdf", repo: "acme/tools", skillPath: "skills/pdf/SKILL.md", description: "Faz pdf", body: "corpo", hash: "abc12345", downloadedAt: "2026-10-15T00:00:00.000Z" };
  writeFileSync(join(CFG, "skills-downloaded.json"), JSON.stringify({ version: 1, skills: [row] }));
  assert.equal(listDownloadedSkills().skills.length, 1);
  mockFetch({}); // qualquer rede ou npx seria erro
  const byPath = (await installSkillFromCatalog({ repo: "acme/tools", skillPath: "skills/pdf/SKILL.md" })) as { cached?: boolean; installed: { id: string; body: string }[] };
  assert.equal(byPath.cached, true);
  assert.equal(byPath.installed[0].body, "corpo");
  const bySlug = (await installSkillFromCatalog({ repo: "ACME/tools", skillPath: "outro/caminho/pdf/SKILL.md" })) as { cached?: boolean };
  assert.equal(bySlug.cached, true, "o skills.sh só informa o slug, não o caminho real");
});
