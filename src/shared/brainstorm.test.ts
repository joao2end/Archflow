import assert from "node:assert/strict";
import { test } from "node:test";
import { atrasoDoc, padariaDoc } from "./brainstorm.example";
import { checkBrainNode, nextStep, reshapeBrain } from "./brainstorm";
import { applyOps, describe, normalizeDoc, schemaGuide, validateDetailed } from "./ops";
import { BRAIN_DATA_HEAD, BRAIN_SHAPE_KEYS, BRAIN_SHAPES, emptyDoc } from "./schema";

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

test("brainstorm: collapsed recolhe o card de dados até o cabeçalho e reabre na altura de antes", () => {
  const { doc, results } = applyOps(brainDoc(), [{ op: "add_node", id: "p", label: "pedido", h: 200, brain: { shape: "json", content: "{}", collapsed: true } as never }]);
  assert.ok(results[0].ok, results[0].error ?? "");
  assert.deepEqual([doc.nodes[0].h, doc.nodes[0].brain?.openH], [BRAIN_DATA_HEAD, 200]);
  // um patch de brain sem collapsed mantém o card recolhido (e a altura guardada)
  const kept = applyOps(doc, [{ op: "update", id: "p", patch: { brain: { shape: "json", content: '{"a": 1}' } } }]).doc;
  assert.deepEqual([kept.nodes[0].h, kept.nodes[0].brain?.openH], [BRAIN_DATA_HEAD, 200]);
  const open = applyOps(kept, [{ op: "update", id: "p", patch: { brain: { shape: "json", content: '{"a": 1}', collapsed: false } } }]).doc;
  assert.deepEqual([open.nodes[0].h, open.nodes[0].brain?.openH], [200, undefined]);
  const bad = applyOps(brainDoc(), [{ op: "add_node", brain: { shape: "box", collapsed: true } as never }]);
  assert.match(bad.results[0].error ?? "", /só vale nas formas de dados/);
});

test("brainstorm: fromSide/toSide fixam o lado da seta; null volta ao automático", () => {
  const base = applyOps(brainDoc(), [{ op: "add_node", id: "a", brain: { shape: "box" } }, { op: "add_node", id: "b", brain: { shape: "box" } }]).doc;
  const { doc, results } = applyOps(base, [{ op: "add_connection", id: "ab", from: "a", to: "b", fromSide: "bottom", toSide: "top" }]);
  assert.ok(results[0].ok, results[0].error ?? "");
  assert.deepEqual([doc.connections[0].fromSide, doc.connections[0].toSide], ["bottom", "top"]);
  const reset = applyOps(doc, [{ op: "update", id: "ab", patch: { toSide: null } }]).doc;
  assert.equal(reset.connections[0].toSide, undefined);
  assert.match(applyOps(base, [{ op: "add_connection", from: "a", to: "b", fromSide: "up" as never }]).results[0].error ?? "", /fromSide inválido/);
});

test("brainstorm: formas de dados guardam o conteúdo em texto, que acompanha a troca entre elas", () => {
  assert.equal(checkBrainNode({ shape: "table", content: "a | b\n1 | 2" }), undefined);
  assert.match(checkBrainNode({ shape: "box", content: "x" }) ?? "", /só vale nas formas de dados/);
  assert.match(checkBrainNode({ shape: "json", content: 3 }) ?? "", /texto/);
  // trechos recolhidos (json/tree) e card recolhido (openH guarda a altura aberta)
  assert.equal(checkBrainNode({ shape: "json", content: "{}", folded: ["$.a"], openH: 190 }), undefined);
  assert.match(checkBrainNode({ shape: "table", folded: ["t1"] }) ?? "", /só vale nas formas "json" e "tree"/);
  assert.match(checkBrainNode({ shape: "box", openH: 80 }) ?? "", /só vale nas formas de dados/);
  assert.match(checkBrainNode({ shape: "list", openH: -1 }) ?? "", /altura/);
  const { doc, results } = applyOps(brainDoc(), [{ op: "add_node", id: "d", asset: "brain-json" }]);
  assert.ok(results[0].ok, results[0].error ?? "");
  assert.match(doc.nodes[0].brain?.content ?? "", /"nome"/, "a forma nasce com um exemplo");
  assert.equal(reshapeBrain({ shape: "list", content: "a\nb" }, "tree").content, "a\nb");
  assert.equal(reshapeBrain({ shape: "list", content: "a\nb" }, "box").content, undefined);
  const text = describe(applyOps(brainDoc(), [{ op: "add_node", label: "Pedido", brain: { shape: "json", content: '{"id": 7}' } }]).doc);
  assert.match(text, /\[JSON\] \*\*Pedido\*\*[\s\S]*\{"id": 7\}/, "o conteúdo entra na descrição para o LLM");
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

test("brainstorm: formas de problema — sentimento com rosto, bloqueio em vermelho e problema solto", () => {
  assert.match(checkBrainNode({ shape: "box", mood: "sad" }) ?? "", /só vale na forma "feeling"/);
  assert.match(checkBrainNode({ shape: "feeling", mood: "furioso" }) ?? "", /mood inválido/);
  const { doc, results } = applyOps(brainDoc(), [
    { op: "add_node", id: "p", brain: { shape: "problem" } },
    { op: "add_node", id: "f", asset: "brain-feeling" },
    { op: "add_node", id: "a", brain: { shape: "stop" } },
    { op: "add_node", id: "m", brain: { shape: "target" } },
    { op: "add_connection", id: "am", from: "a", to: "m", brain: { line: "blocks" } },
  ]);
  assert.ok(results.every((r) => r.ok), results.find((r) => !r.ok)?.error ?? "");
  assert.equal(doc.nodes[1].brain?.mood, "sad");
  assert.equal(doc.connections[0].type, "dependency");
  assert.deepEqual(validateDetailed(doc).map((i) => i.rule), ["B005"]);
  const swapped = applyOps(doc, [{ op: "update", id: "f", patch: { brain: { shape: "box" } } }]);
  assert.ok(swapped.results[0].ok, swapped.results[0].error ?? "");
});

test("brainstorm: exemplo do mapa de problema é válido e a descrição mostra o bloqueio e o humor", () => {
  const doc = atrasoDoc();
  assert.equal(doc.nodes.length, 16);
  assert.equal(validateDetailed(doc).filter((i) => i.severity !== "dica").length, 0);
  const text = describe(doc);
  assert.match(text, /Falta motorista ⊣ Entregar em até 2 dias/);
  assert.match(text, /Sentimento: bravo/);
});

test("brainstorm: modo inferido ao abrir um arquivo sem mode e guia próprio", () => {
  const doc = padariaDoc();
  const { mode: _m, ...raw } = doc;
  assert.equal(normalizeDoc(JSON.parse(JSON.stringify(raw))).mode, "brainstorm");
  assert.match(schemaGuide("brainstorm"), /brain\.shape/);
});
