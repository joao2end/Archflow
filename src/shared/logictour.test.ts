import assert from "node:assert/strict";
import { test } from "node:test";
import { LOGIC_TOUR, tourDone, tourNode, type TourCtx } from "./logictour";
import { applyOps } from "./ops";
import { emptyDoc } from "./schema";

const blank = (): TourCtx => ({ doc: emptyDoc("Tutorial", "logic"), sel: [], panel: null, tool: "select", play: false, iso: false });

test("tutorial: «Fazer por mim» em cada passo conclui o passo, e o diagrama final é a regra certa", () => {
  let c = blank();
  for (const s of LOGIC_TOUR) {
    if (!s.check) continue;
    assert.equal(s.check(c), false, `«${s.title}» não pode começar feito`);
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
  for (const role of ["start", "input", "output", "decision", "rule", "end", "scenario"] as const) assert.ok(tourNode(c.doc, role), role);
});

test("tutorial: todo passo que espera uma ação aponta um alvo e sabe demonstrar", () => {
  for (const s of LOGIC_TOUR.filter((x) => x.check)) {
    assert.ok(s.target?.length, `«${s.title}» sem alvo`);
    assert.ok(s.motion, `«${s.title}» sem gesto para demonstrar`);
    assert.ok(s.ops || s.ui, `«${s.title}» sem «Fazer por mim»`);
  }
});
