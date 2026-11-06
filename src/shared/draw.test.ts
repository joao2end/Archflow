import assert from "node:assert/strict";
import { test } from "node:test";
import { checkBrainNode } from "./brainstorm";
import { applyOps, validateDetailed } from "./ops";
import { emptyDoc } from "./schema";

const brainDoc = () => emptyDoc("Quadro", "brainstorm");

test("draw: seta vira um traço só, com a ponta no fim", () => {
  const { doc, results } = applyOps(brainDoc(), [{ op: "add_ink", draw: { type: "arrow", points: [{ x: 0, y: 0 }, { x: 100, y: 0 }] } }]);
  assert.ok(results[0].ok, results[0].error ?? "");
  assert.equal(doc.ink?.length, 1);
  const k = doc.ink![0];
  assert.match(k.id, /^ink-arrow/);
  assert.equal(k.kind, "pen");
  // a ponta volta ao fim: o ponto (100, 0) aparece mais de uma vez e as farpas ficam atrás dele
  assert.ok(k.pts.filter((p) => p.x === 100 && p.y === 0).length >= 2);
  assert.ok(k.pts.slice(-1)[0].x < 100);
});

test("draw: around circula, emoldura e sublinha um elemento; remove apaga o traço", () => {
  const base = applyOps(brainDoc(), [{ op: "add_node", id: "gargalo", brain: { shape: "box" }, x: 100, y: 100 }]).doc;
  const { doc, results } = applyOps(base, [
    { op: "add_ink", draw: { type: "ellipse", around: "gargalo" } },
    { op: "add_ink", draw: { type: "rect", around: "gargalo", pad: 0, highlight: true } },
    { op: "add_ink", id: "sub", draw: { type: "underline", around: "gargalo" } },
  ]);
  assert.ok(results.every((r) => r.ok), results.find((r) => !r.ok)?.error ?? "");
  const [ell, rect, under] = doc.ink!;
  const n = doc.nodes[0];
  // a elipse passa por fora da caixa toda
  assert.ok(Math.min(...ell.pts.map((p) => p.x)) < n.x && Math.max(...ell.pts.map((p) => p.x)) > n.x + n.w);
  assert.deepEqual(rect.pts[0], { x: n.x, y: n.y });
  assert.equal(rect.kind, "highlight");
  assert.equal(under.id, "ink-sub");
  assert.ok(under.pts.every((p) => p.y === n.y + n.h + 4));
  const gone = applyOps(doc, [{ op: "remove", id: "ink-sub" }]);
  assert.ok(gone.results[0].ok);
  assert.equal(gone.doc.ink?.length, 2);
  assert.equal(gone.doc.nodes.length, 1);
});

test("draw: erros acionáveis", () => {
  const { results } = applyOps(brainDoc(), [
    { op: "add_ink", draw: { type: "line", points: [{ x: 0, y: 0 }] } },
    { op: "add_ink", draw: { type: "ellipse", around: "nada" } },
    { op: "add_ink", draw: { type: "rect" } },
    { op: "add_ink", draw: { type: "line", points: [{ x: 0, y: 0 }, { x: 1, y: 1 }], color: "red" } },
  ]);
  assert.match(results[0].error ?? "", /pelo menos 2/);
  assert.match(results[1].error ?? "", /não existe/);
  assert.match(results[2].error ?? "", /x, y, w, h/);
  assert.match(results[3].error ?? "", /hexadecimal/);
});

test("brainstorm: forma imagem aceita URL ou data URI e respeita o tamanho pedido", () => {
  assert.equal(checkBrainNode({ shape: "image", src: "https://exemplo.com/a.png" }), undefined);
  assert.equal(checkBrainNode({ shape: "image", src: "data:image/png;base64,iVBORw0KGgo=" }), undefined);
  assert.match(checkBrainNode({ shape: "image", src: "javascript:alert(1)" }) ?? "", /URL http/);
  assert.match(checkBrainNode({ shape: "box", src: "https://exemplo.com/a.png" }) ?? "", /só vale na forma "image"/);
  const { doc, results } = applyOps(brainDoc(), [
    { op: "add_node", brain: { shape: "image", src: "https://exemplo.com/a.png" }, label: "Balcão", w: 300, h: 220 },
    { op: "add_node", brain: { shape: "image" }, label: "" },
  ]);
  assert.ok(results.every((r) => r.ok), results.find((r) => !r.ok)?.error ?? "");
  assert.deepEqual([doc.nodes[0].w, doc.nodes[0].h], [300, 220]);
  const issues = validateDetailed(doc);
  assert.ok(issues.some((i) => i.rule === "B006" && i.target === doc.nodes[1].id));
  assert.ok(!issues.some((i) => i.rule === "B001"), "imagem sem legenda não pede texto");
});
