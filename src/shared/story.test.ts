import assert from "node:assert/strict";
import { test } from "node:test";
import { DDD_EXAMPLES, buildExample } from "./examples";
import { buildStories } from "./story";
import { docMode } from "./schema";

const docs = DDD_EXAMPLES.flatMap((ex) => buildExample(ex).map((f) => ({ ex: ex.id, file: f.path, doc: f.doc }))).filter((d) => docMode(d.doc) === "domain");

test("story: todo caso de uso dos exemplos vira uma história que começa no ator ou no caso de uso", () => {
  let total = 0;
  for (const { file, doc } of docs) {
    const ucs = doc.nodes.filter((n) => n.ddd?.role === "use-case");
    const stories = buildStories(doc);
    for (const u of ucs) {
      const s = stories.find((x) => x.id === u.id);
      assert.ok(s, `${file}: história de ${u.id}`);
      assert.ok(s.steps.some((st) => st.id === u.id), "inclui o caso de uso");
      total++;
    }
  }
  assert.ok(total > 0);
});

test("story: ordem causal — command antes do aggregate, aggregate antes do evento, e passos únicos com texto de motivo", () => {
  for (const { file, doc } of docs) {
    for (const s of buildStories(doc)) {
      const ids = s.steps.map((x) => x.id);
      assert.equal(new Set(ids).size, ids.length, `${file}/${s.id}: sem passos repetidos`);
      for (const st of s.steps) {
        assert.ok(st.why.length > 20 && st.what.length > 10, `${file}/${st.id}: tem o quê e o porquê`);
        for (const c of st.connIds) assert.ok(doc.connections.some((x) => x.id === c));
      }
      for (const c of doc.connections) {
        if (c.ddd?.rel !== "triggers" && c.ddd?.rel !== "emits") continue;
        const a = ids.indexOf(c.from);
        const b = ids.indexOf(c.to);
        const walked = a >= 0 && b >= 0 && s.steps[b].connIds.includes(c.id);
        if (walked) assert.ok(a < b, `${file}/${s.id}: ${c.from} antes de ${c.to}`);
      }
    }
  }
});

test("story: o primeiro exemplo cobre command, aggregate e evento em sequência", () => {
  const all = docs.flatMap(({ doc }) => buildStories(doc)).filter((s) => s.id !== "__all");
  const s = all.find((x) => x.steps.some((st) => st.role === "domain-event"))!;
  const roles = s.steps.map((x) => x.role);
  assert.ok(roles.indexOf("command") < roles.indexOf("aggregate-root"));
  assert.ok(roles.indexOf("aggregate-root") < roles.indexOf("domain-event"));
  const ev = s.steps.find((x) => x.role === "domain-event")!;
  assert.ok(ev.because && ev.connIds.length);
});

test("story: a visão completa passa por todos os elementos (menos endpoints) uma única vez", () => {
  for (const { file, doc } of docs) {
    const all = buildStories(doc).find((s) => s.id === "__all");
    assert.ok(all, `${file}: tem visão completa`);
    const ids = all.steps.map((x) => x.id);
    assert.equal(new Set(ids).size, ids.length, `${file}: sem repetição`);
    const want = doc.nodes.filter((n) => !n.owner && n.kind !== "endpoint").map((n) => n.id);
    assert.deepEqual(want.filter((i) => !ids.includes(i)), [], `${file}: elementos fora da história`);
  }
});
