import assert from "node:assert/strict";
import { test } from "node:test";
import { applyOps } from "./ops";
import { emptyDoc } from "./schema";

test("add_node aplica fill e fillOpacity", () => {
  const { doc, results } = applyOps(emptyDoc("t"), [{ op: "add_node", id: "api", label: "API", kind: "service", fill: "#eef2f7", fillOpacity: 0.5 }]);
  assert.equal(results[0].ok, true);
  const n = doc.nodes.find((x) => x.id === "api")!;
  assert.equal(n.fill, "#eef2f7");
  assert.equal(n.fillOpacity, 0.5);
});

test("add_group aplica kind, color, fill", () => {
  const { doc, results } = applyOps(emptyDoc("t"), [{ op: "add_group", id: "g1", label: "Borda", kind: "cloud", color: "#706fd3", fill: "#ffffff", fillOpacity: 0.8 }]);
  assert.equal(results[0].ok, true);
  const g = doc.groups.find((x) => x.id === "g1")!;
  assert.equal(g.kind, "cloud");
  assert.equal(g.color, "#706fd3");
  assert.equal(g.fill, "#ffffff");
  assert.equal(g.fillOpacity, 0.8);
});

test("add_note aplica color e font", () => {
  const { doc, results } = applyOps(emptyDoc("t"), [{ op: "add_note", id: "n1", text: "Oi", color: "#e5484d", font: "serif", variant: "text" }]);
  assert.equal(results[0].ok, true);
  const n = doc.notes.find((x) => x.id === "n1")!;
  assert.equal(n.color, "#e5484d");
  assert.equal(n.font, "serif");
  assert.equal(n.variant, "text");
});

test("add_note omite font sans (padrão)", () => {
  const { doc } = applyOps(emptyDoc("t"), [{ op: "add_note", id: "n2", text: "Oi", font: "sans" }]);
  const n = doc.notes.find((x) => x.id === "n2")!;
  assert.equal(n.font, undefined);
});

test("add_connection aceita routing", () => {
  const { doc } = applyOps(emptyDoc("t"), [
    { op: "add_node", id: "a", label: "A" },
    { op: "add_node", id: "b", label: "B" },
    { op: "add_connection", id: "c1", from: "a", to: "b", type: "async", routing: "elbow" },
  ]);
  const c = doc.connections.find((x) => x.id === "c1")!;
  assert.equal(c.type, "async");
  assert.equal(c.routing, "elbow");
});
