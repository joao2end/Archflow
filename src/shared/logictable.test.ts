import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";
import { checkExamples, logicIssues, runFlow } from "./logic";
import { coverageGaps } from "./logiceval";
import { generateLogicTypeScript } from "./logicgen";
import { applyOps, describe, type Op } from "./ops";
import { emptyDoc, type Doc, type LogicNodeSpec } from "./schema";

const node = (id: string, logic: LogicNodeSpec): Op => ({ op: "add_node", id, label: id, logic });
const edge = (from: string, to: string): Op => ({ op: "add_connection", from, to });
const ARREDONDA: LogicNodeSpec = {
  role: "table",
  text: "Arredonda pela faixa",
  rows: [
    { when: "preco < 0.10", then: ["preco := 0.09"], label: "Abaixo de R$ 0,10" },
    { when: "preco <= 10", then: ["preco := piso(preco * 10) / 10 - 0.01"], label: "Até R$ 10" },
    { when: "preco <= 50", then: ["preco := piso(preco) + 0.49"] },
  ],
  otherwise: ["preco := piso(preco) + 0.99"],
  examples: [{ name: "até 10", given: { preco: 7.34 }, expect: { preco: 7.29 } }],
};
const build = (table: LogicNodeSpec = ARREDONDA, extra: Op[] = []): Doc => {
  const r = applyOps(emptyDoc("arredondar", "logic"), [
    node("preco", { role: "input", key: "preco", type: "number" }),
    node("ini", { role: "start" }),
    node("t", table),
    node("fim", { role: "end" }),
    edge("ini", "t"),
    edge("t", "fim"),
    ...extra,
  ]);
  assert.deepEqual(r.results.filter((x) => !x.ok), []);
  return r.doc;
};

test("vale a primeira linha verdadeira, de cima para baixo; nenhuma, o «senão»", () => {
  const doc = build();
  const run = (preco: number) => runFlow(doc, { preco });
  assert.equal(run(0.05).env.preco, 0.09);
  assert.ok(Math.abs((run(7.34).env.preco as number) - 7.29) < 1e-9, "7,34 cai na 2ª linha (a 3ª também valeria)");
  assert.equal(run(30.2).env.preco, 30.49);
  assert.equal(run(80.5).env.preco, 80.99);
  const st = run(7.34).steps.find((s) => s.rule === "t")!;
  assert.equal(st.branch, "linha 2");
  assert.equal(run(80.5).steps.find((s) => s.rule === "t")!.branch, "senão");
  assert.ok(checkExamples(doc).every((r) => r.ok));
});

test("sem «senão», nenhuma linha valer é erro de execução (e a validação dá a dica)", () => {
  const doc = build({ ...ARREDONDA, otherwise: undefined });
  const r = runFlow(doc, { preco: 80 });
  assert.match(r.steps.find((s) => s.error)!.error!, /nenhuma linha da tabela "t" valeu/);
  assert.ok(logicIssues(doc).some((i) => i.rule === "L039"));
});

test("validação: linha sem condição, efeito inválido, «se» dentro do efeito e tabela vazia", () => {
  const add = (logic: unknown) => applyOps(emptyDoc("x", "logic"), [{ op: "add_node", label: "t", logic } as Op]).results[0];
  assert.match(add({ role: "table", rows: [{ then: ["a := 1"] }] }).error!, /when é obrigatório/);
  assert.match(add({ role: "table", rows: [{ when: "a >", then: [] }] }).error!, /rows\[0\]\.when/);
  assert.match(add({ role: "table", rows: [{ when: "a > 1", then: ["a := se a > 2 entao 1 senao 2"] }] }).error!, /já é o «se»/);
  assert.match(add({ role: "table", rows: [{ when: "a > 1", then: [], cor: 1 }] }).error!, /"cor"/);
  const vazia = build({ role: "table" });
  assert.ok(logicIssues(vazia).some((i) => i.rule === "L038" && i.severity === "erro"));
});

test("a tabela lê as condições e escreve os efeitos de todas as linhas; describe mostra a grade", () => {
  const md = describe(build());
  assert.match(md, /## Tabelas de decisão/);
  assert.match(md, /\| 2 \| Até R\$ 10: `preco <= 10` \| `preco := piso\(preco \* 10\) \/ 10 - 0\.01` \|/);
  assert.match(md, /\| senão \|/);
});

test("cobertura: linha que nenhum cenário exercita vira lacuna", () => {
  const doc = build(ARREDONDA, [node("caso", { role: "scenario", examples: [{ name: "7", given: { preco: 7.34 }, expect: { desfecho: "ok" } }] } as LogicNodeSpec)]);
  const gaps = coverageGaps(doc).get("t") ?? [];
  assert.ok(gaps.some((g) => g.includes("Abaixo de R$ 0,10")));
  assert.ok(gaps.some((g) => g.includes("senão")));
  assert.ok(!gaps.some((g) => g.includes("Até R$ 10")));
});

test("código gerado: a mesma cadeia de linhas, com os mesmos resultados do app", async () => {
  const root = mkdtempSync(join(tmpdir(), "archflow-table-"));
  try {
    const files = generateLogicTypeScript(build());
    for (const f of files) {
      const target = join(root, f.path.split("/").slice(1).join("/"));
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, f.content);
    }
    const main = files.find((f) => !f.path.endsWith("runtime.ts") && !f.path.endsWith(".test.ts"))!;
    const mod = await import(pathToFileURL(join(root, basename(main.path))).href);
    for (const preco of [0.05, 7.34, 30.2, 80.5]) {
      const got = await mod.run({ preco });
      assert.ok(Math.abs(got.data.preco - (runFlow(build(), { preco }).env.preco as number)) < 1e-9, `preço ${preco}`);
    }
    const sem = generateLogicTypeScript(build({ ...ARREDONDA, otherwise: undefined }));
    const dir2 = join(root, "sem");
    for (const f of sem) {
      const target = join(dir2, f.path.split("/").slice(1).join("/"));
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, f.content);
    }
    const mod2 = await import(pathToFileURL(join(dir2, basename(main.path))).href);
    await assert.rejects(mod2.run({ preco: 80 }), /nenhuma linha da tabela/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
