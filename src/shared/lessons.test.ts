import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { evaluateDomain, traceUseCase } from "./domain";
import { buildCatalog } from "./examples.catalog";
import { LESSONS, LESSONS_DIR, buildLessonDoc, codeRegion, lessonCodePath, lessonOfDoc, lessonSlugOk } from "./lessons";
import { renderLessons } from "./lessons.render";
import { validateDetailed } from "./ops";

const EX = join(process.cwd(), "examples");
const read = (p: string) => readFileSync(join(EX, p), "utf8");
const built = LESSONS.map((l) => ({ l, doc: buildLessonDoc(l) }));
const codeFiles = (l: (typeof LESSONS)[number]) => {
  const root = join(EX, LESSONS_DIR, l.id, "codigo");
  return (readdirSync(root, { recursive: true }) as string[]).filter((f) => f.endsWith(".ts")).map((f) => join(root, f));
};

test("aulas: numeradas em ordem, ids únicos e o título do diagrama vira o nome previsto do arquivo", () => {
  assert.deepEqual(LESSONS.map((l) => l.n), LESSONS.map((_, i) => i + 1));
  assert.equal(new Set(LESSONS.map((l) => l.id)).size, LESSONS.length);
  for (const l of LESSONS) {
    assert.ok(lessonSlugOk(l), `${l.id}: slug do título "${l.diagram.title}"`);
    assert.ok(l.steps.length >= 5 && l.exercises.length >= 1, `${l.id}: passos e exercícios`);
  }
});

test("aulas: o diagrama valida sem erros nem avisos, todo caso de uso chega a um evento e abre na visão 3D (camadas)", () => {
  for (const { l, doc } of built) {
    const serious = validateDetailed(doc).filter((i) => i.severity !== "dica");
    assert.deepEqual(serious.map((i) => `${i.rule} ${i.message}`), [], l.id);
    assert.equal(evaluateDomain(doc, {}).ok, true, l.id);
    for (const u of doc.nodes.filter((n) => n.ddd?.role === "use-case")) assert.equal(traceUseCase(doc, u.id)!.ok, true, `${l.id}: ${u.id}`);
    assert.ok(doc.groups.some((g) => g.ring), `${l.id}: sem anéis, a visão 3D não abre`);
    assert.equal(lessonOfDoc(doc), l, `${l.id}: o app não reconheceria o diagrama como aula`);
  }
});

test("aulas: cada passo aponta peças que existem e todo componente do diagrama é explicado em algum passo", () => {
  for (const { l, doc } of built) {
    const ids = new Set([...doc.nodes.map((n) => n.id), ...doc.groups.map((g) => g.id)]);
    for (const s of l.steps) {
      assert.ok(s.focus.length, `${l.id}: «${s.title}» não destaca nada`);
      for (const f of s.focus) assert.ok(ids.has(f), `${l.id}: «${s.title}» aponta ${f}, que não está no diagrama`);
    }
    const covered = new Set(l.steps.flatMap((s) => s.focus));
    assert.deepEqual(doc.nodes.filter((n) => !covered.has(n.id)).map((n) => n.id), [], `${l.id}: componentes sem passo`);
  }
});

test("aulas: todo trecho de código citado existe", () => {
  for (const l of LESSONS)
    for (const s of l.steps.filter((x) => x.code)) {
      const code = codeRegion(read(lessonCodePath(l, s.code!.file)), s.code!.region);
      assert.ok(code && code.split("\n").length >= 3, `${l.id}: «${s.code!.region}» em ${s.code!.file}`);
      assert.doesNotMatch(code!, /#(end)?region/, `${l.id}: região aninhada em ${s.code!.file}`);
    }
});

test("codeRegion: tira os marcadores e a indentação comum", () => {
  const src = "x\n  // #region a\n    foo();\n      bar();\n  // #endregion\ny";
  assert.equal(codeRegion(src, "a"), "foo();\n  bar();");
  assert.equal(codeRegion(src, "b"), undefined);
});

test("aulas: o código compila com tsc --strict e o exemplo roda e imprime o que o texto promete", () => {
  const expected: Record<string, string[]> = {
    "01-tarefas": ["TarefaCriada t1", "TarefaConcluida t1", "recusado: Esta tarefa já foi concluída."],
    "02-carrinho": ["totalEmCentavos: 7980", "recusado: O carrinho já foi fechado."],
    "03-pedidos": ["status: 201", "situacao: 'confirmado'", "status: 422", "status: 400"],
  };
  for (const l of LESSONS) {
    const files = codeFiles(l);
    const tsc = spawnSync("npx", ["tsc", "--ignoreConfig", "--strict", "--noEmit", "--target", "ES2022", "--module", "ESNext", "--moduleResolution", "Bundler", "--skipLibCheck", "--types", "node", "--lib", "ES2022", ...files.map((f) => JSON.stringify(f))], { cwd: process.cwd(), encoding: "utf8", shell: true });
    assert.equal(tsc.status, 0, `${l.id}: ${tsc.stdout}${tsc.stderr}`);
    const run = spawnSync("npx", ["tsx", JSON.stringify(join(EX, lessonCodePath(l, "exemplo.ts")))], { cwd: process.cwd(), encoding: "utf8", shell: true });
    assert.equal(run.status, 0, `${l.id}: ${run.stderr}`);
    for (const line of expected[l.id] ?? []) assert.ok(run.stdout.includes(line), `${l.id}: a saída não tem «${line}»\n${run.stdout}`);
  }
});

test("aulas: os arquivos gerados em examples/aulas-ddd estão em dia (npm run examples:build)", () => {
  for (const f of renderLessons(read)) {
    const target = join(EX, f.path);
    assert.ok(existsSync(target), `falta examples/${f.path}`);
    assert.equal(readFileSync(target, "utf8").replace(/\r\n/g, "\n"), f.content, `desatualizado: examples/${f.path}`);
  }
});

test("aulas: os links dos README apontam para arquivos que existem", () => {
  for (const f of renderLessons(read).filter((x) => x.path.endsWith(".md"))) {
    for (const m of f.content.matchAll(/\]\(([^)\s]+)\)/g)) {
      const href = m[1].split("#")[0];
      if (!href || /^https?:/.test(href)) continue;
      assert.ok(existsSync(join(EX, dirname(f.path), href)), `${f.path}: link quebrado → ${m[1]}`);
    }
  }
});

test("catálogo: as aulas abrem a aba Domínio, na ordem, e cada uma é reconhecida como aula", async () => {
  const domain = buildCatalog(async () => ({}) as never).filter((e) => e.mode === "domain");
  assert.deepEqual(domain.slice(0, LESSONS.length).map((e) => e.lesson), LESSONS.map((l) => l.id));
  for (const e of domain.filter((x) => x.lesson)) {
    assert.equal(e.files.length, 1);
    assert.equal(e.open, e.files[0].path);
    assert.ok(e.open.startsWith(`${LESSONS_DIR}/`));
    assert.ok(lessonOfDoc(await e.files[0].load()), e.key);
  }
});
