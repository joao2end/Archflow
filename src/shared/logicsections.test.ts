import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { logicSections, sectionsIndex } from "./logicsections";
import { hiddenBy } from "./logicstages";
import type { Doc } from "./schema";

const preco = (): Doc => JSON.parse(readFileSync("examples/exemplos-logic/precificacao.archflow.json", "utf8"));
const busca = (): Doc => JSON.parse(readFileSync("examples/exemplos-algoritmos/busca-binaria.archflow.json", "utf8"));

test("com etapas: capa, visão geral recolhida, uma seção por etapa (só ela aberta), cenários e dados", () => {
  const doc = preco();
  const s = logicSections(doc);
  assert.deepEqual(s.map((x) => x.kind), ["cover", "overview", "stage", "stage", "stage", "stage", "stage", "stage", "stage", "scenarios", "data"]);
  assert.equal(s[0].file, "01-resumo");
  assert.equal(s[2].file, "03-etapa-validar-o-produto");
  assert.ok(s[1].doc!.groups.filter((g) => g.stage).every((g) => g.stage!.collapsed));
  const arred = s.find((x) => x.title.endsWith("Arredondamento"))!;
  const open = arred.doc!.groups.filter((g) => g.stage && !g.stage.collapsed).map((g) => g.id);
  assert.deepEqual(open, [arred.focus]);
  assert.ok(![...hiddenBy(arred.doc!).keys()].includes("faixa-do-preco"), "os passos da etapa ficam à vista");
  assert.ok(arred.facts!.some((f) => f.startsWith("Escreve: preco")));
  assert.ok(doc.groups.filter((g) => g.stage).every((g) => g.stage!.collapsed), "o doc original não muda");
});

test("sem etapas: o fluxo inteiro numa seção só", () => {
  const s = logicSections(busca());
  assert.deepEqual(s.map((x) => x.kind), ["cover", "flow", "scenarios", "data"]);
  assert.equal(s[1].doc!.nodes.length, busca().nodes.length);
});

test("índice do ZIP: imagens das seções, cenários e contrato", () => {
  const doc = preco();
  const md = sectionsIndex(doc, logicSections(doc));
  assert.match(md, /^# Engine de precificação/);
  assert.match(md, /!\[Visão geral\]\(02-visao-geral\.png\)/);
  assert.match(md, /## Cenários/);
  assert.match(md, /\| `preco` \| Preço \|/);
});
