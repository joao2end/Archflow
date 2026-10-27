import assert from "node:assert/strict";
import { test } from "node:test";
import { LOGIC_LESSONS, builtUpTo, logicLessonDoc, logicLessonDocId, logicLessonOfDoc, logicLessonPath, logicLessonStart, opsToBuild } from "./logic.lessons";
import { applyOps, validateDetailed } from "./ops";
import { checkExamples } from "./logic";

test("aulas de lógica: em ordem, do médio ao complexo, com ids e caminhos únicos", () => {
  assert.deepEqual(LOGIC_LESSONS.map((l) => l.n), [2, 3], "a Aula 1 é o tutorial interativo");
  assert.deepEqual(LOGIC_LESSONS.map((l) => l.level), ["intermediário", "avançado"]);
  assert.equal(new Set(LOGIC_LESSONS.map(logicLessonPath)).size, LOGIC_LESSONS.length);
  for (const l of LOGIC_LESSONS) assert.equal(logicLessonOfDoc(logicLessonDocId(l.id)), l);
});

for (const l of LOGIC_LESSONS) {
  test(`aula ${l.n} · ${l.title}: começa vazia e, passo a passo, cada passo cria o que cita`, () => {
    let doc = logicLessonStart(l);
    assert.equal(doc.mode, "logic");
    assert.equal(doc.id, logicLessonDocId(l.id));
    assert.equal(doc.nodes.length + doc.groups.length + doc.connections.length, 0, "o diagrama da aula começa vazio");
    assert.equal(builtUpTo(doc, l.steps), l.steps[0].ops?.length ? -1 : 0, "vazio: só um passo de abertura sem peças conta como montado");
    for (const [i, s] of l.steps.entries()) {
      const r = applyOps(doc, opsToBuild(doc, l.steps, i, i));
      assert.deepEqual(r.results.filter((x) => !x.ok), [], `passo ${i + 1} («${s.title}») monta sem erro`);
      doc = r.doc;
      // só as setas que a aula criou: nada ligado sozinho
      const wanted = l.steps.slice(0, i + 1).flatMap((x) => x.ops ?? []).filter((op) => op.op === "add_connection").length;
      assert.equal(doc.connections.length, wanted, `passo ${i + 1}: o diagrama tem só as setas que a aula criou`);
      assert.equal(builtUpTo(doc, l.steps), i, `depois do passo ${i + 1}, o diagrama está montado até ele`);
      const ids = new Set([...doc.nodes.map((n) => n.id), ...doc.groups.map((g) => g.id)]);
      for (const f of s.focus) assert.ok(ids.has(f), `passo «${s.title}» cita «${f}», que ainda não existe`);
    }
    assert.ok(l.steps.length >= 6 && l.exercises.length >= 2);
    assert.deepEqual(opsToBuild(doc, l.steps, 0, l.steps.length - 1), [], "montado inteiro, não falta nada");
  });

  test(`aula ${l.n} · ${l.title}: o diagrama completo valida sem erro e todo exemplo bate`, () => {
    const doc = logicLessonDoc(l);
    assert.deepEqual(validateDetailed(doc).filter((i) => i.severity === "erro"), [], "sem erro de validação");
    assert.deepEqual(checkExamples(doc).filter((r) => !r.ok).map((r) => `${r.node} · ${r.example}: ${r.problems.join("; ")}`), [], "todos os exemplos e cenários batem");
    assert.ok(doc.nodes.some((n) => n.logic?.role === "scenario"), "tem cenário");
  });
}
