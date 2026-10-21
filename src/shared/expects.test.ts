import assert from "node:assert/strict";
import { test } from "node:test";
import { checkAgentConn } from "./agents";
import { checkExpectPattern, checkExpects, expandPattern, matchesPattern, missingOutputs, type FsEntry } from "./expects";
import type { Doc } from "./schema";
import { libraryFromDoc, NO_OUTPUT, reduce, startRun } from "./workflow";

/** Árvore falsa: caminho → mtime (arquivo); as pastas saem dos prefixos. */
function fakeFs(files: Record<string, number>) {
  const listed: string[] = [];
  const list = (d: string): FsEntry[] => {
    listed.push(d);
    const out = new Map<string, FsEntry>();
    for (const [p, mtime] of Object.entries(files)) {
      if (d && !p.startsWith(d + "/")) continue;
      const rest = (d ? p.slice(d.length + 1) : p).split("/");
      out.set(rest[0], rest.length === 1 ? { name: rest[0], dir: false, mtime } : { name: rest[0], dir: true, mtime: 0 });
    }
    return [...out.values()];
  };
  return { list, listed };
}

test("checkExpectPattern: aceita caminho relativo com * e ?; recusa absoluto, .., \\, ** e colchetes", () => {
  for (const ok of ["post/copy.md", "post/slides/slide-*.png", "a?.txt", "index.html"]) assert.equal(checkExpectPattern(ok), undefined, ok);
  for (const bad of ["", "  ", "/etc/passwd", "C:/x", "../fora.md", "post//a.md", "post/./a", "post\\a.md", "post/**/a.png", "post/[ab].md", "post/{a,b}.md"]) assert.ok(checkExpectPattern(bad), bad);
  assert.ok(checkExpectPattern(3));
});

test("checkExpects: lista de padrões válidos; recusa não-lista e item inválido", () => {
  assert.equal(checkExpects(["post/copy.md", "post/slides/*.png"]), undefined);
  assert.equal(checkExpects([]), undefined);
  assert.match(checkExpects("post/copy.md") ?? "", /lista/);
  assert.match(checkExpects(["post/copy.md", "../x"]) ?? "", /\.\./);
  assert.match(checkExpects(Array.from({ length: 21 }, (_, i) => `a${i}.md`)) ?? "", /no máximo/);
});

test("matchesPattern: segmento a segmento, * não atravessa pastas, . é literal", () => {
  assert.ok(matchesPattern("post/slides/slide-*.png", "post/slides/slide-01.png"));
  assert.ok(!matchesPattern("post/slides/slide-*.png", "post/slides/slide-01.jpg"));
  assert.ok(!matchesPattern("post/*.png", "post/slides/a.png"), "* não desce de pasta");
  assert.ok(!matchesPattern("post/a.md", "post/aXmd"), ". é literal");
  assert.ok(matchesPattern("post/a?.md", "post/a1.md"));
  assert.ok(matchesPattern("*/copy.md", "post/copy.md"));
});

test("expandPattern: só lista as pastas do caminho; curinga na pasta; ignora pasta com nome de arquivo", () => {
  const fs = fakeFs({ "post/copy.md": 5, "post/slides/slide-1.png": 7, "post/slides/slide-2.png": 9, "post/slides/capa.png": 9, "outro/copy.md": 3, "node_modules/x/y.js": 1 });
  assert.deepEqual(expandPattern("post/slides/slide-*.png", fs.list).map((f) => f.path), ["post/slides/slide-1.png", "post/slides/slide-2.png"]);
  assert.deepEqual(fs.listed, ["", "post", "post/slides"], "não varre o projeto inteiro");
  assert.deepEqual(expandPattern("*/copy.md", fs.list).map((f) => f.path).sort(), ["outro/copy.md", "post/copy.md"]);
  assert.deepEqual(expandPattern("post/slides", fs.list), [], "pasta não conta como arquivo");
  assert.deepEqual(expandPattern("nada/a.md", fs.list), []);
});

test("missingOutputs: falta o padrão sem arquivo ou com todos os arquivos anteriores a since (o caso do carrossel)", () => {
  const since = 1000;
  // copy.md regravado no passo; index.html de uma execução antiga; nenhum PNG
  const fs = fakeFs({ "post/copy.md": 1500, "post/direcao.md": 1000, "post/index.html": 400, "post/slides/.gitkeep": 1200 });
  assert.deepEqual(missingOutputs(["post/copy.md", "post/direcao.md", "post/index.html", "post/slides/slide-*.png"], fs.list, since), ["post/index.html", "post/slides/slide-*.png"]);
  // basta UM arquivo do glob ter mudado
  const fs2 = fakeFs({ "post/slides/slide-1.png": 10, "post/slides/slide-2.png": 2000 });
  assert.deepEqual(missingOutputs(["post/slides/slide-*.png"], fs2.list, since), []);
  assert.deepEqual(missingOutputs([], fs2.list, since), []);
});

/* ───────── expects na seta step → execução ───────── */

const wfDoc = (expects?: unknown): Doc =>
  ({
    mode: "agents",
    nodes: [
      { id: "wf", kind: "node", label: "Post", x: 0, y: 0, w: 100, h: 60, agent: { role: "workflow" } },
      { id: "p1", kind: "node", label: "Escrever", x: 0, y: 0, w: 100, h: 60, agent: { role: "prompt", text: "Escreva" } },
      { id: "p2", kind: "node", label: "Exportar", x: 0, y: 0, w: 100, h: 60, agent: { role: "prompt", text: "Exporte" } },
    ],
    connections: [
      { id: "s1", from: "wf", to: "p1", type: "sync", agent: { rel: "step", order: 1, ...(expects !== undefined ? { expects } : {}) } },
      { id: "s2", from: "wf", to: "p2", type: "sync", agent: { rel: "step", order: 2 } },
    ],
    groups: [],
  }) as unknown as Doc;

test("checkAgentConn: expects só em step, lista de padrões válidos", () => {
  assert.equal(checkAgentConn({ rel: "step", expects: ["post/copy.md", "post/slides/slide-*.png"] }), undefined);
  assert.match(checkAgentConn({ rel: "runs-on", expects: ["a.md"] }) ?? "", /só vale em step/);
  assert.match(checkAgentConn({ rel: "step", expects: ["../a.md"] }) ?? "", /expects/);
  assert.match(checkAgentConn({ rel: "step", expects: "a.md" }) ?? "", /lista/);
});

test("expects vai da seta para o passo da execução; missing + NO_OUTPUT falha o passo; tentar de novo limpa", () => {
  const lib = libraryFromDoc(wfDoc(["post/copy.md"]));
  assert.deepEqual(lib.workflows[0].steps, [{ promptId: "p1", mode: "manual", expects: ["post/copy.md"] }, { promptId: "p2", mode: "manual" }]);
  const r = startRun(lib, "wf", {}, "sess", { pace: "run", allAuto: true });
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.deepEqual(r.run.steps[0].expects, ["post/copy.md"]);
  assert.equal(r.run.steps[1].expects, undefined);
  let run = reduce(r.run, { type: "missing", stepIndex: 0, items: ["post/copy.md"] }).run;
  run = reduce(run, { type: "autoDone", code: NO_OUTPUT }).run;
  assert.equal(run.state, "failed");
  assert.equal(run.steps[0].status, "failed");
  assert.equal(run.steps[0].code, NO_OUTPUT);
  assert.deepEqual(run.steps[0].missing, ["post/copy.md"]);
  run = reduce(run, { type: "retry" }).run;
  assert.equal(run.steps[0].status, "running");
  assert.equal(run.steps[0].missing, undefined);
  assert.deepEqual(run.steps[0].expects, ["post/copy.md"], "as saídas esperadas continuam no passo");
});
