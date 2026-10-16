import assert from "node:assert/strict";
import { test } from "node:test";
import { LIMITS, asBracketedPaste, emptyLibrary, libraryIssues, normalizeLibrary, promptVars, renderPrompt, slugId, uniqueId } from "./prompts";

test("slugId e uniqueId", () => {
  assert.equal(slugId("Revisar PR — Segurança!"), "revisar-pr-seguranca");
  assert.equal(slugId("???"), "prompt");
  assert.equal(uniqueId("a", ["a", "a-2"]), "a-3");
  assert.equal(uniqueId("b", ["a"]), "b");
});

test("normalizeLibrary: lixo vira biblioteca vazia, nunca lança", () => {
  for (const raw of [undefined, null, 5, "x", [], { prompts: 3, workflows: "x" }]) assert.deepEqual(normalizeLibrary(raw).library, emptyLibrary());
});

test("normalizeLibrary: valida, resolve ids repetidos, corta textos e limpa passos órfãos", () => {
  const { library, dropped } = normalizeLibrary({
    prompts: [
      { id: "revisar", name: "Revisar", text: "Revise {{arquivo}}", agent: "dev", notes: "  nota " },
      { id: "revisar", name: "Revisar 2", text: "outro" },
      { name: "Sem id", text: "ok" },
      { name: "", text: "sem nome" },
      { name: "Sem texto" },
      { id: "Inválido Id!", name: "Id ruim", text: "t", agent: "Agente Ruim" },
      { name: "x".repeat(500), text: "y".repeat(LIMITS.text + 5) },
    ],
    workflows: [
      { name: "Entrega", steps: [{ promptId: "revisar" }, { promptId: "fantasma", mode: "auto" }, { promptId: "revisar-2", mode: "auto" }, { promptId: "revisar", mode: "xx" }] },
      { steps: [] },
    ],
  });
  assert.deepEqual(library.prompts.map((p) => p.id), ["revisar", "revisar-2", "sem-id", "id-ruim", "x".repeat(60)]);
  assert.equal(library.prompts[0].notes, "nota");
  assert.equal(library.prompts[3].agent, undefined, "agent inválido é descartado");
  assert.equal(library.prompts[4].name.length, LIMITS.name);
  assert.equal(library.prompts[4].text.length, LIMITS.text);
  assert.deepEqual(library.workflows[0].steps, [
    { promptId: "revisar", mode: "manual" },
    { promptId: "revisar-2", mode: "auto" },
    { promptId: "revisar", mode: "manual" },
  ]);
  assert.equal(library.workflows.length, 1, "workflow sem nome cai");
  assert.ok(dropped.some((d) => /sem nome ou texto/.test(d)));
  assert.ok(dropped.some((d) => /não existe/.test(d)));
});

test("normalizeLibrary respeita os limites de quantidade", () => {
  const prompts = Array.from({ length: LIMITS.prompts + 10 }, (_, i) => ({ name: `p${i}`, text: "t" }));
  const { library, dropped } = normalizeLibrary({ prompts });
  assert.equal(library.prompts.length, LIMITS.prompts);
  assert.ok(dropped.some((d) => /além de/.test(d)));
});

test("promptVars lista as variáveis sem repetir, aceita acento e espaços", () => {
  assert.deepEqual(promptVars("Faça {{ tarefa }} em {{arquivo}} e de novo {{tarefa}} {{ação-2}} {{1ruim}} {{}}"), ["tarefa", "arquivo", "ação-2"]);
  assert.deepEqual(promptVars("sem variáveis"), []);
});

test("renderPrompt preenche, prefixa o agente e reporta o que faltou", () => {
  assert.deepEqual(renderPrompt({ text: "Revise {{arquivo}} com foco em {{foco}}", agent: "dev" }, { arquivo: "a.ts" }), { text: "Use o subagente dev para: Revise a.ts com foco em ", missing: ["foco"] });
  assert.deepEqual(renderPrompt({ text: "olá" }), { text: "olá", missing: [] });
  assert.equal(renderPrompt({ text: "{{a}}{{a}}" }, { a: "x" }).text, "xx");
  assert.equal(renderPrompt({ text: "{{a}}" }, { a: "$&" }).text, "$&", "valor é literal, sem padrões de replace");
});

test("asBracketedPaste só envolve texto de várias linhas", () => {
  assert.equal(asBracketedPaste("uma linha"), "uma linha");
  assert.equal(asBracketedPaste("a\nb"), "\x1b[200~a\nb\x1b[201~");
});

test("libraryIssues avisa de agente inexistente e workflow vazio", () => {
  const { library } = normalizeLibrary({ prompts: [{ id: "p", name: "P", text: "t", agent: "dev" }], workflows: [{ name: "W", steps: [] }] });
  assert.deepEqual(libraryIssues(library, new Set(["qa"])).length, 2);
  assert.deepEqual(libraryIssues(library, new Set(["dev"])), ["workflow «W» está sem passos"]);
});
