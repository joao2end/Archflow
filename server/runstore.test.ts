import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { normalizeLibrary } from "../src/shared/prompts";
import { createRecord, RUNS_MAX } from "../src/shared/runs";
import { startRun, type WorkflowRun } from "../src/shared/workflow";
import { getRun, listRuns, resumeFiles, RunStoreError, safeRel, saveRun, snapshotStep } from "./runstore";

const lib = normalizeLibrary({
  prompts: [
    { id: "a", name: "A", text: "faça {{entrada}}" },
    { id: "b", name: "B", text: "depois: {{saida_anterior}}" },
  ],
  workflows: [{ id: "wf", name: "WF", steps: [{ promptId: "a", mode: "auto" }, { promptId: "b", mode: "auto" }] }],
}).library;
const run = (): WorkflowRun => {
  const r = startRun(lib, "wf", {}, "s", { allAuto: true, entrada: "x" });
  assert.ok(r.ok);
  return r.ok ? r.run : (undefined as never);
};
const id = (n: number) => `run-20261018-1200${String(n).padStart(2, "0")}-abcd`;
function project() {
  const dir = mkdtempSync(join(tmpdir(), "archflow-runs-"));
  return { dir, done: () => rmSync(dir, { recursive: true, force: true }) };
}
const write = (dir: string, rel: string, text: string, mtime?: number) => {
  const p = join(dir, ...rel.split("/"));
  mkdirSync(join(p, ".."), { recursive: true });
  writeFileSync(p, text);
  if (mtime) utimesSync(p, mtime / 1000, mtime / 1000);
};

test("saveRun / listRuns / getRun: grava, lista do mais novo ao mais antigo e filtra por workflow", () => {
  const { dir, done } = project();
  try {
    saveRun(dir, createRecord(run(), { id: id(1), now: 1000 }));
    saveRun(dir, createRecord(run(), { id: id(2), now: 2000 }));
    saveRun(dir, { ...createRecord(run(), { id: id(3), now: 3000 }), workflowId: "outro" });
    assert.deepEqual(listRuns(dir).map((s) => s.id), [id(3), id(2), id(1)]);
    assert.deepEqual(listRuns(dir, "wf").map((s) => s.id), [id(2), id(1)]);
    assert.equal(getRun(dir, id(2)).createdAt, 2000);
    assert.throws(() => getRun(dir, "../x"), RunStoreError);
    assert.throws(() => getRun(dir, id(9)), /não encontrada/);
    assert.throws(() => saveRun(dir, { lixo: true }), /inválido/);
  } finally {
    done();
  }
});

test("saveRun guarda no máximo RUNS_MAX execuções e apaga os arquivos das que saem", () => {
  const { dir, done } = project();
  try {
    for (let i = 0; i < RUNS_MAX; i++) saveRun(dir, createRecord(run(), { id: `run-20261018-${String(100000 + i)}-abcd`, now: 1000 + i }));
    const oldest = "run-20261018-100000-abcd";
    write(dir, `.archflow/runs/${oldest}/files/0/post/a.md`, "x");
    const r = saveRun(dir, createRecord(run(), { id: "run-20261019-000000-abcd", now: 99999 }));
    assert.deepEqual(r.pruned, [oldest]);
    assert.equal(listRuns(dir).length, RUNS_MAX);
    assert.equal(existsSync(join(dir, ".archflow", "runs", oldest)), false, "a pasta de arquivos da execução apagada sai junto");
  } finally {
    done();
  }
});

test("snapshotStep guarda só os arquivos das saídas esperadas modificados desde o início do passo", () => {
  const { dir, done } = project();
  try {
    const t0 = Date.now() - 60_000;
    write(dir, "post/copy.md", "copy nova");
    write(dir, "post/slides/slide-01.png", "png1");
    write(dir, "post/slides/slide-02.png", "png2");
    write(dir, "post/slides/velho.png", "antigo", t0 - 120_000);
    write(dir, "post/outro.txt", "não pedido");
    const r = snapshotStep(dir, { id: id(1), step: 1, patterns: ["post/copy.md", "post/slides/*.png"], since: t0 });
    assert.deepEqual(r.files, ["post/copy.md", "post/slides/slide-01.png", "post/slides/slide-02.png"]);
    assert.equal(readFileSync(join(dir, ".archflow", "runs", id(1), "files", "1", "post", "copy.md"), "utf8"), "copy nova");
    assert.throws(() => snapshotStep(dir, { id: id(1), step: 1, patterns: ["../fora/*"], since: 0 }), RunStoreError);
  } finally {
    done();
  }
});

test("resumeFiles copia os arquivos dos passos anteriores para a nova execução e os devolve ao projeto", () => {
  const { dir, done } = project();
  try {
    write(dir, "post/copy.md", "copy da execução 1");
    write(dir, "post/index.html", "html da execução 1");
    const old = createRecord(run(), { id: id(1), now: 1000 });
    old.files = {
      "0": snapshotStep(dir, { id: id(1), step: 0, patterns: ["post/copy.md"], since: 0 }).files,
      "1": snapshotStep(dir, { id: id(1), step: 1, patterns: ["post/index.html"], since: 0 }).files,
    };
    saveRun(dir, old);
    // uma execução posterior passou por cima dos arquivos
    write(dir, "post/copy.md", "copy da execução 2");
    write(dir, "post/index.html", "html da execução 2");
    const r = resumeFiles(dir, { from: id(1), to: id(2), upto: 1, restore: true });
    assert.deepEqual(r.files, { "0": ["post/copy.md"] }, "só os passos antes do retomado");
    assert.deepEqual(r.restored, ["post/copy.md"]);
    assert.equal(readFileSync(join(dir, "post", "copy.md"), "utf8"), "copy da execução 1", "o arquivo daquela execução volta");
    assert.equal(readFileSync(join(dir, "post", "index.html"), "utf8"), "html da execução 2", "o do passo retomado em diante não é tocado");
    assert.ok(existsSync(join(dir, ".archflow", "runs", id(2), "files", "0", "post", "copy.md")), "a nova execução tem a própria cópia");
    const keep = resumeFiles(dir, { from: id(1), to: id(3), upto: 2, restore: false });
    assert.deepEqual(keep.restored, []);
    assert.deepEqual(Object.keys(keep.files), ["0", "1"]);
  } finally {
    done();
  }
});

test("safeRel recusa caminho fora do projeto", () => {
  for (const bad of ["../x", "/etc/passwd", "C:/x", "a\\b", "a//b", "a/./b", "*.png", ""]) assert.throws(() => safeRel(bad), RunStoreError, bad);
  assert.equal(safeRel("post/slides/slide-01.png"), "post/slides/slide-01.png");
});
