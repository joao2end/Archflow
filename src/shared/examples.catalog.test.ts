import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { ALGORITHMS_DIR, ALGORITHM_EXAMPLES, EXAMPLE_MODES, buildCatalog } from "./examples.catalog";
import { checkExamples } from "./logic";
import { normalizeDoc, validateDetailed } from "./ops";
import { docMode, type Doc } from "./schema";

const ALG_DIR = join("examples", "exemplos-algoritmos");
const readAlgorithm = async (file: string): Promise<Doc> => normalizeDoc(JSON.parse(readFileSync(join(ALG_DIR, `${file}.archflow.json`), "utf8")));
const catalog = () => buildCatalog(readAlgorithm);

test("o catálogo tem exemplos de arquitetura, domínio e lógica, com chaves e caminhos únicos", () => {
  const all = catalog();
  for (const m of EXAMPLE_MODES) assert.ok(all.some((e) => e.mode === m.mode), `sem exemplos de ${m.label}`);
  assert.equal(new Set(all.map((e) => e.key)).size, all.length, "chaves repetidas");
  const paths = all.flatMap((e) => e.files.map((f) => f.path));
  assert.equal(new Set(paths).size, paths.length, "dois exemplos instalariam no mesmo caminho");
  for (const e of all) {
    assert.ok(e.files.some((f) => f.path === e.open), `«${e.title}»: o arquivo a abrir não está entre os do exemplo`);
  }
});

test("todo exemplo de arquitetura valida sem erros nem avisos (os de domínio são testados em examples.test.ts)", async () => {
  for (const e of catalog().filter((x) => x.mode === "architecture")) {
    for (const f of e.files) {
      const doc = await f.load();
      const issues = validateDetailed(doc);
      assert.deepEqual(issues.map((i) => i.message), [], `«${e.title}» / ${f.title}`);
    }
  }
});

test("os algoritmos do catálogo e os arquivos de examples/exemplos-algoritmos são os mesmos", () => {
  const onDisk = readdirSync(ALG_DIR).filter((f) => f.endsWith(".archflow.json")).map((f) => f.replace(".archflow.json", "")).sort();
  assert.deepEqual(ALGORITHM_EXAMPLES.map((a) => a.file).sort(), onDisk);
});

test("cada algoritmo: o título do catálogo é o do diagrama, é Logic, valida e todos os exemplos dele batem", async () => {
  for (const a of ALGORITHM_EXAMPLES) {
    const doc = await readAlgorithm(a.file);
    assert.equal(doc.title, a.title, `${a.file}: título diferente do catálogo`);
    assert.equal(docMode(doc), "logic");
    const erros = validateDetailed(doc).filter((i) => i.severity === "erro");
    assert.deepEqual(erros.map((i) => i.message), [], a.file);
    const falhas = checkExamples(doc).filter((r) => !r.ok);
    assert.equal(falhas.length, 0, `${a.file}: ${falhas.length} exemplo(s) do próprio diagrama não batem`);
  }
});

test("os algoritmos ficam numa pasta própria dentro de exemplos-logic", () => {
  for (const e of catalog().filter((x) => x.key.startsWith("logic:") && x.key !== "logic:precificacao")) assert.ok(e.open.startsWith(`${ALGORITHMS_DIR}/`), e.open);
});
