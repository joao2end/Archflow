import assert from "node:assert/strict";
import { test } from "node:test";
import { padariaDoc } from "./brainstorm.example";
import { checkBrainNode, nextStep } from "./brainstorm";
import { applyOps, describe, normalizeDoc, schemaGuide, validateDetailed } from "./ops";
import { BRAIN_SHAPE_KEYS, BRAIN_SHAPES, emptyDoc } from "./schema";

const brainDoc = () => emptyDoc("Processo", "brainstorm");

test("brainstorm: add_node com brain vira kind shape, com o tamanho e o nome padrão da forma", () => {
  const { doc, results } = applyOps(brainDoc(), [{ op: "add_node", brain: { shape: "diamond" } }]);
  assert.ok(results[0].ok, results[0].error ?? "");
  const n = doc.nodes[0];
  assert.equal(n.kind, "shape");
  assert.equal(n.label, "Decisão");
  assert.deepEqual([n.w, n.h], [BRAIN_SHAPES.diamond.w, BRAIN_SHAPES.diamond.h]);
});

test("brainstorm: o asset da biblioteca cria a forma; passo numerado nasce com o número", () => {
  const { doc, results } = applyOps(brainDoc(), [{ op: "add_node", asset: "brain-step" }, ...BRAIN_SHAPE_KEYS.map((s) => ({ op: "add_node" as const, asset: `brain-${s}` }))]);
  assert.ok(results.every((r) => r.ok), results.find((r) => !r.ok)?.error ?? "");
  assert.equal(doc.nodes[0].brain?.step, 1);
  assert.equal(doc.nodes[0].label, "Passo 1");
  assert.equal(nextStep(doc), 2);
});

test("brainstorm: formas só existem no modo brainstorm; outros componentes não entram nele", () => {
  const arch = applyOps(emptyDoc("A"), [{ op: "add_node", brain: { shape: "box" } }]);
  assert.match(arch.results[0].error ?? "", /modo "brainstorm"/);
  const svc = applyOps(brainDoc(), [{ op: "add_node", kind: "service", label: "API" }]);
  assert.equal(svc.results[0].ok, false);
});

test("brainstorm: validação de entrada da forma", () => {
  assert.match(checkBrainNode({ shape: "hexagon" }) ?? "", /inválido/);
  assert.match(checkBrainNode({ shape: "box", step: 2 }) ?? "", /só vale na forma "step"/);
  assert.match(checkBrainNode({ shape: "box", color: "red" }) ?? "", /hexadecimal/);
  assert.match(checkBrainNode({ shape: "box", size: 3 }) ?? "", /não tem o campo "size"/);
  assert.equal(checkBrainNode({ shape: "step", step: 3, color: "#abc" }), undefined);
});

test("brainstorm: conexão sem estilo vira seta sem animação; o estilo define o type", () => {
  const { doc, results } = applyOps(brainDoc(), [
    { op: "add_node", id: "a", brain: { shape: "box" } },
    { op: "add_node", id: "b", brain: { shape: "box" } },
    { op: "add_connection", id: "ab", from: "a", to: "b" },
    { op: "add_connection", id: "ba", from: "b", to: "a", brain: { line: "line" } },
  ]);
  assert.ok(results.every((r) => r.ok));
  const [ab, ba] = doc.connections;
  assert.deepEqual(ab.brain, { line: "arrow" });
  assert.equal(ab.animated, false);
  assert.equal(ba.type, "association");
  const up = applyOps(doc, [{ op: "update", id: "ab", patch: { brain: { line: "dashed" } } }]);
  assert.equal(up.doc.connections[0].type, "async");
  const bad = applyOps(doc, [{ op: "add_connection", from: "a", to: "b", brain: { line: "zigzag" as never } }]);
  assert.match(bad.results[0].error ?? "", /brain.line inválido/);
});

test("brainstorm: trocar a forma leva o tamanho padrão só se o nó não foi redimensionado", () => {
  const base = applyOps(brainDoc(), [{ op: "add_node", id: "a", brain: { shape: "box" } }, { op: "add_node", id: "b", brain: { shape: "box" } }]).doc;
  const sized = applyOps(base, [{ op: "update", id: "b", patch: { w: 300, h: 200 } }]).doc;
  const out = applyOps(sized, [
    { op: "update", id: "a", patch: { brain: { shape: "circle" } } },
    { op: "update", id: "b", patch: { brain: { shape: "circle" } } },
  ]).doc;
  assert.deepEqual([out.nodes[0].w, out.nodes[0].h], [BRAIN_SHAPES.circle.w, BRAIN_SHAPES.circle.h]);
  assert.deepEqual([out.nodes[1].w, out.nodes[1].h], [300, 200]);
});

test("brainstorm: formas soltas não são erro; dicas para decisão e passos repetidos", () => {
  const { doc } = applyOps(brainDoc(), [
    { op: "add_node", id: "solta", brain: { shape: "sticky" }, label: "Ideia" },
    { op: "add_node", id: "q", brain: { shape: "diamond" }, label: "Tem estoque?" },
    { op: "add_node", id: "x", brain: { shape: "box" }, label: "Envia" },
    { op: "add_node", id: "p1", brain: { shape: "step", step: 1 } },
    { op: "add_node", id: "p2", brain: { shape: "step", step: 1 } },
    { op: "add_connection", from: "q", to: "x" },
  ]);
  const issues = validateDetailed(doc);
  assert.equal(issues.some((i) => i.message.includes("isolado")), false);
  assert.deepEqual([...new Set(issues.map((i) => i.rule))].sort(), ["B002", "B004"]);
});

test("brainstorm: exemplo da padaria é válido e a descrição segue a ordem de leitura", () => {
  const doc = padariaDoc();
  assert.equal(doc.nodes.length, 10);
  assert.equal(doc.connections.length, 8);
  assert.equal(validateDetailed(doc).filter((i) => i.severity !== "dica").length, 0);
  const text = describe(doc);
  assert.ok(text.indexOf("Cliente chega") < text.indexOf("Paga no caixa"));
  assert.match(text, /Tem o pão\? → Separa e embala \(«sim»\)/);
});

test("brainstorm: modo inferido ao abrir um arquivo sem mode e guia próprio", () => {
  const doc = padariaDoc();
  const { mode: _m, ...raw } = doc;
  assert.equal(normalizeDoc(JSON.parse(JSON.stringify(raw))).mode, "brainstorm");
  assert.match(schemaGuide("brainstorm"), /brain\.shape/);
});
