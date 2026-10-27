import assert from "node:assert/strict";
import { test } from "node:test";
import { targetsNow, tourDone, type TourCtx } from "./logictour";
import { LOGIC_TOURS, tourByKey, tourOfDoc, tourStartDoc } from "./logictours";
import { applyOps } from "./ops";

for (const t of LOGIC_TOURS) {
  test(`aula ${t.n} · ${t.title}: «Fazer por mim» em cada passo conclui o passo e monta uma regra que valida`, () => {
    const start = tourStartDoc(t);
    assert.equal(start.nodes.length + start.connections.length + start.groups.length, 0, "a aula começa vazia");
    assert.equal(tourOfDoc(start.id), t);
    let c: TourCtx = { doc: start, sel: [], panel: null, tool: "select", play: false, iso: false };
    for (const s of t.steps) {
      if (!s.check) continue;
      assert.equal(s.check(c), false, `«${s.title}» não pode começar feito`);
      assert.ok(targetsNow(s, c).length, `«${s.title}» aponta algum lugar`);
      if (s.ui?.panel !== undefined) c = { ...c, panel: s.ui.panel };
      if (s.ui?.tool) c = { ...c, tool: s.ui.tool };
      if (s.ui?.iso) c = { ...c, iso: true };
      if (s.ui?.play) c = { ...c, play: true };
      const r = applyOps(c.doc, s.ops?.(c.doc) ?? []);
      assert.deepEqual(r.results.filter((x) => !x.ok), [], `«${s.title}»: as mudanças entram sem erro`);
      c = { ...c, doc: r.doc };
      assert.equal(s.check(c), true, `«${s.title}» fica feito depois de «Fazer por mim»`);
    }
    assert.ok(tourDone(c.doc), "o diagrama montado valida e todos os exemplos batem");
  });

  test(`aula ${t.n} · ${t.title}: todo passo que espera uma ação sabe demonstrar; a aula aponta a seguinte`, () => {
    for (const s of t.steps.filter((x) => x.check)) {
      assert.ok(s.target, `«${s.title}» sem alvo`);
      assert.ok(s.motion, `«${s.title}» sem gesto para demonstrar`);
      assert.ok(s.ops || s.ui, `«${s.title}» sem «Fazer por mim»`);
    }
    if (t.next) assert.ok(tourByKey(t.next), t.next);
  });
}

test("aulas: em ordem, do simples ao complexo, com ids, caminhos e chaves únicos", () => {
  assert.deepEqual(LOGIC_TOURS.map((t) => t.n), [1, 2, 3]);
  assert.deepEqual(LOGIC_TOURS.map((t) => t.level), ["iniciante", "intermediário", "avançado"]);
  for (const k of ["key", "docId", "path"] as const) assert.equal(new Set(LOGIC_TOURS.map((t) => t[k])).size, LOGIC_TOURS.length, k);
});
