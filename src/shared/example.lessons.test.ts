import assert from "node:assert/strict";
import test from "node:test";
import { ARCH_EXAMPLES, archDocId } from "./arch.examples";
import { EXAMPLE_LESSONS } from "./example.lessons";
import { DDD_EXAMPLES, buildExampleFile, exampleDocId } from "./examples";
import { firstStepIn, guideOfDoc } from "./guides";
import { LESSONS, lessonDocId } from "./lessons";
import type { Doc } from "./schema";

const ids = (doc: Doc) => new Set([...doc.nodes.map((n) => n.id), ...doc.groups.map((g) => g.id)]);

test("todo exemplo de Arquitetura e de Domínio tem aula, e só uma", () => {
  const keys = EXAMPLE_LESSONS.map((l) => l.example);
  assert.equal(new Set(keys).size, keys.length, "dois roteiros para o mesmo exemplo");
  const expected = [...ARCH_EXAMPLES.map((a) => `architecture:${a.id}`), ...DDD_EXAMPLES.map((e) => `domain:${e.id}`)];
  assert.deepEqual([...keys].sort(), [...expected].sort());
});

test("aulas de arquitetura: o diagrama tem id estável e toda peça citada existe nele", () => {
  for (const a of ARCH_EXAMPLES) {
    const doc = a.doc();
    assert.equal(doc.id, archDocId(a.id), a.id);
    assert.equal(a.doc().id, doc.id, `${a.id}: o id muda entre duas montagens`);
    const lesson = EXAMPLE_LESSONS.find((l) => l.example === `architecture:${a.id}`)!;
    const known = ids(doc);
    for (const s of lesson.steps) {
      assert.equal(s.file, undefined, `${a.id} / «${s.title}»: exemplo de um diagrama só não indica arquivo`);
      for (const f of s.focus) assert.ok(known.has(f), `${a.id} / «${s.title}»: "${f}" não existe no diagrama`);
    }
  }
});

test("aulas de domínio: cada passo diz em qual diagrama acontece e toda peça citada existe nele", () => {
  for (const ex of DDD_EXAMPLES) {
    const lesson = EXAMPLE_LESSONS.find((l) => l.example === `domain:${ex.id}`)!;
    const docs = new Map<string, Set<string>>();
    for (const s of lesson.steps) {
      const f = ex.files.find((x) => x.file === s.file);
      assert.ok(f, `${ex.id} / «${s.title}»: arquivo "${s.file}" não é do exemplo`);
      if (!docs.has(f.file)) docs.set(f.file, ids(buildExampleFile(ex, f)));
      for (const id of s.focus) assert.ok(docs.get(f.file)!.has(id), `${ex.id}/${f.file} / «${s.title}»: "${id}" não existe no diagrama`);
    }
    assert.equal(lesson.steps[0].file, "visao-geral", `${ex.id}: a aula começa pelo mapa de contextos`);
  }
});

test("os passos são curtos e completos", () => {
  for (const l of EXAMPLE_LESSONS) {
    assert.ok(l.steps.length >= 5 && l.steps.length <= 12, `${l.example}: ${l.steps.length} passos`);
    assert.ok(l.exercises.length >= 1, `${l.example}: sem exercícios`);
    for (const s of l.steps) {
      assert.ok(s.title.trim() && s.text.trim(), `${l.example}: passo sem título ou texto`);
      assert.ok(s.text.length <= 520, `${l.example} / «${s.title}»: ${s.text.length} caracteres (o painel é estreito: no máximo 520)`);
    }
  }
});

test("o painel acha a aula pelo id do diagrama aberto, em qualquer diagrama do exemplo", () => {
  for (const a of ARCH_EXAMPLES) assert.equal(guideOfDoc(archDocId(a.id))?.key, `architecture:${a.id}`);
  for (const ex of DDD_EXAMPLES) {
    for (const f of ex.files) {
      const g = guideOfDoc(exampleDocId(ex, f.file));
      assert.equal(g?.key, `domain:${ex.id}`, `${ex.id}/${f.file}`);
      // quem entra por um contexto começa no primeiro passo dele (ou no início, se a aula não passa por ele)
      const at = firstStepIn(g, exampleDocId(ex, f.file));
      const s = g.steps[at];
      assert.ok(s.doc!.id === exampleDocId(ex, f.file) || !g.steps.some((x) => x.doc!.id === exampleDocId(ex, f.file)), `${ex.id}/${f.file}`);
    }
  }
  for (const l of LESSONS) assert.equal(guideOfDoc(lessonDocId(l))?.course?.id, l.id);
  assert.equal(guideOfDoc("um-diagrama-qualquer"), undefined);
});
