import assert from "node:assert/strict";
import { test } from "node:test";
import { applyOps, type Op } from "./ops";
import { freeSpotBelow, NODE_SIZE } from "./placement";
import { emptyDoc, type Doc } from "./schema";

const build = (ops: Op[]): Doc => {
  const { doc, results } = applyOps(emptyDoc("t", "agents"), ops);
  assert.ok(results.every((r) => r.ok), results.find((r) => !r.ok)?.error ?? "op falhou");
  return doc;
};
const agent = (id: string, x: number, y: number): Op => ({ op: "add_node", id, kind: "agent", agent: { role: "agent", description: "Agente de teste do posicionamento." }, x, y });
const skill = (id: string, x: number, y: number): Op => ({ op: "add_node", id, kind: "agent", agent: { role: "skill", description: "Skill de teste do posicionamento." }, x, y });

test("sem ninguém por perto: alinhado ao agente, 96px abaixo", () => {
  const doc = build([agent("a", 200, 100)]);
  const a = doc.nodes[0];
  assert.deepEqual(freeSpotBelow(doc, a), { x: 200, y: 8 * Math.round((a.y + a.h + 96) / 8) });
});

test("ocupado: anda para a direita, sem sobrepor", () => {
  const base = build([agent("a", 200, 100)]);
  const a = base.nodes[0];
  const first = freeSpotBelow(base, a);
  const doc = build([agent("a", 200, 100), skill("s1", first.x, first.y)]);
  const next = freeSpotBelow(doc, doc.nodes[0]);
  assert.equal(next.y, first.y);
  assert.ok(next.x >= first.x + NODE_SIZE.w, `x ${next.x} não deveria cobrir o nó em ${first.x}`);
});

test("um agente vizinho embaixo bloqueia a vaga dele", () => {
  const doc = build([agent("a", 0, 0), agent("b", 0, 168)]); // b está exatamente onde a skill cairia
  const spot = freeSpotBelow(doc, doc.nodes[0]);
  const b = doc.nodes[1];
  assert.ok(spot.x >= b.x + b.w || spot.y >= b.y + b.h, "a vaga não pode cobrir o agente vizinho");
});

test("linha cheia: desce para a linha seguinte", () => {
  const a = build([agent("a", 0, 0)]).nodes[0];
  const row = Array.from({ length: 12 }, (_, i) => skill(`s${i}`, i * (NODE_SIZE.w + 24), 8 * Math.round((a.y + a.h + 96) / 8)));
  const doc = build([agent("a", 0, 0), ...row]);
  const spot = freeSpotBelow(doc, doc.nodes[0]);
  assert.ok(spot.y > 8 * Math.round((a.y + a.h + 96) / 8));
  assert.equal(spot.x, 0);
});

test("inserções em sequência nunca se sobrepõem", () => {
  let doc = build([agent("a", 0, 0)]);
  const placed: { x: number; y: number }[] = [];
  for (let i = 0; i < 20; i++) {
    const spot = freeSpotBelow(doc, doc.nodes[0]);
    placed.push(spot);
    doc = build([...doc.nodes.map((n): Op => ({ op: "add_node", id: n.id, kind: "agent", agent: n.agent!, x: n.x, y: n.y })), skill(`s${i}`, spot.x, spot.y)]);
  }
  for (let i = 0; i < placed.length; i++) for (let j = i + 1; j < placed.length; j++) {
    const a = placed[i], b = placed[j];
    assert.ok(a.x + NODE_SIZE.w <= b.x || b.x + NODE_SIZE.w <= a.x || a.y + NODE_SIZE.h <= b.y || b.y + NODE_SIZE.h <= a.y, `${i} × ${j}`);
  }
});

test("notas também ocupam espaço", () => {
  const doc = build([agent("a", 0, 0), { op: "add_note", text: "Nota no meio do caminho", x: 0, y: 168, w: 300, h: 100 } as Op]);
  const spot = freeSpotBelow(doc, doc.nodes[0]);
  assert.ok(spot.x >= 300 || spot.y >= 268, JSON.stringify(spot));
});
