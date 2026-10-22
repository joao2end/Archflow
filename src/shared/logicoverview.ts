/**
 * Visão de conjunto do modo Logic: o que se lê ANTES de mergulhar nos passos.
 *
 * - resumo: o propósito, o que entra, o que sai, as etapas e o placar dos cenários;
 * - contrato de dados: entradas, resultados e variáveis com tipo e significado (uma tabela, em vez de dezenas de cartões);
 * - matriz de cenários: um cenário por linha, com o que entra, o que se espera, o que saiu e por quais etapas passou;
 * - cobertura por seta: quantos cenários passam por cada saída de decisão, escolha, laço ou chamada (a seta sem nenhum é um caso sem teste).
 *
 * Usado pela interface (aba Visão geral e Cenários, rótulos das setas) e pela exportação em seções.
 */
import { shortValue } from "./expr";
import { checkExamples, dataKey, dataNodes, edgeIdsOf, isFlowNode, outputOf, visitedIds, type ExampleResult } from "./logic";
import { stageOrder } from "./logicstages";
import type { Doc, LogicValue, NodeEl } from "./schema";

export interface ContractItem {
  id: string;
  key: string;
  label: string;
  type?: string;
  value?: LogicValue;
  text?: string;
}
export interface Contract {
  inputs: ContractItem[];
  outputs: ContractItem[];
  variables: ContractItem[];
}

/** Entradas, resultados e variáveis do fluxo, com o nome usado nas expressões. */
export function dataContract(doc: Doc): Contract {
  const item = (n: NodeEl): ContractItem => ({ id: n.id, key: dataKey(n), label: n.label, ...(n.logic!.type ? { type: n.logic!.type } : {}), ...(n.logic!.value !== undefined ? { value: n.logic!.value } : {}), ...(n.logic!.text ? { text: n.logic!.text } : {}) });
  const of = (role: string) => dataNodes(doc).filter((n) => n.logic!.role === role).map(item);
  return { inputs: of("input"), outputs: of("output"), variables: of("variable") };
}

export interface MatrixRow {
  scenario: string;
  label: string;
  /** índice do exemplo dentro do cenário (para reproduzir) */
  example: number;
  exampleName: string;
  ok: boolean;
  /** cenário de falha: espera terminar em erro */
  failure: boolean;
  problems: string[];
  given: Record<string, LogicValue>;
  expect: Record<string, LogicValue>;
  /** o que o fluxo devolveu, nos mesmos dados do esperado */
  got: Record<string, LogicValue>;
  outcome?: "ok" | "erro";
  steps: number;
  /** etapas por onde o cenário passou, na ordem da primeira passagem (cada uma uma vez) */
  stages: string[];
  /** quantas vezes o percurso entrou na primeira etapa (num laço, uma por volta) */
  rounds: number;
}

/** Uma linha por exemplo de cenário: o caso inteiro de relance, sem precisar reproduzir. */
export function scenarioMatrix(doc: Doc, results: ExampleResult[] = checkExamples(doc)): MatrixRow[] {
  const stageOf = new Map<string, string>();
  for (const g of doc.groups) if (g.stage) for (const n of doc.nodes) if (n.parent === g.id) stageOf.set(n.id, g.label);
  const rows: MatrixRow[] = [];
  for (const sc of doc.nodes.filter((n) => n.logic?.role === "scenario")) {
    (sc.logic!.examples ?? []).forEach((ex, i) => {
      const r = results.find((x) => x.node === sc.id && x.example === ex.name);
      if (!r) return;
      const out = outputOf(doc, r)?.values ?? {};
      const got: Record<string, LogicValue> = {};
      for (const k of Object.keys(ex.expect)) if (k in out) got[k] = out[k];
      // etapas na ordem da primeira passagem; um laço que repete o percurso vira «N voltas», não a lista repetida
      const seq: string[] = [];
      for (const id of visitedIds(r.run)) {
        const s = stageOf.get(id);
        if (s && seq.at(-1) !== s) seq.push(s);
      }
      const stages = [...new Set(seq)];
      const rounds = stages.length ? seq.filter((s) => s === stages[0]).length : 0;
      rows.push({ scenario: sc.id, label: sc.label, example: i, exampleName: ex.name, ok: r.ok, failure: ex.expect.desfecho === "erro", problems: r.problems, given: ex.given, expect: ex.expect, got, ...(r.run.outcome ? { outcome: r.run.outcome } : {}), steps: visitedIds(r.run).length, stages, rounds });
    });
  }
  return rows;
}

/** Quantos exemplos de cenário passam por cada seta que sai de um ponto de escolha (decisão, escolha, laço, chamada, código). */
export function edgeCoverage(doc: Doc, results: ExampleResult[] = checkExamples(doc)): Map<string, number> {
  const branching = new Set(doc.nodes.filter((n) => isFlowNode(n) && ["decision", "switch", "loop", "call", "code"].includes(n.logic!.role)).map((n) => n.id));
  const cover = new Map<string, number>();
  for (const c of doc.connections) if (branching.has(c.from) && isFlowNode(doc.nodes.find((n) => n.id === c.to) ?? ({} as NodeEl))) cover.set(c.id, 0);
  const scenarios = new Set(doc.nodes.filter((n) => n.logic?.role === "scenario").map((n) => n.id));
  for (const r of results) {
    if (!scenarios.has(r.node)) continue;
    for (const id of new Set(edgeIdsOf(doc, r.run))) if (id && cover.has(id)) cover.set(id, cover.get(id)! + 1);
  }
  return cover;
}

export interface LogicSummary {
  title: string;
  description?: string;
  inputs: string[];
  outputs: string[];
  stages: { label: string; text?: string }[];
  steps: number;
  scenarios: { ok: number; total: number; failures: number };
}

/** A porta de entrada: o que o fluxo faz, o que entra e sai, as etapas e se os cenários batem. */
export function logicSummary(doc: Doc, results: ExampleResult[] = checkExamples(doc)): LogicSummary {
  const m = scenarioMatrix(doc, results);
  const c = dataContract(doc);
  return {
    title: doc.title,
    ...(doc.description ? { description: doc.description } : {}),
    inputs: c.inputs.map((x) => x.key),
    outputs: c.outputs.map((x) => x.key),
    stages: stageOrder(doc).map((g) => ({ label: g.label, ...(g.stage?.text ? { text: g.stage.text } : {}) })),
    steps: doc.nodes.filter(isFlowNode).length,
    scenarios: { ok: m.filter((r) => r.ok).length, total: m.length, failures: m.filter((r) => r.failure).length },
  };
}

/** «a = 1 · b = "x"» (valores curtos), para células de tabela. */
export const pairs = (o: Record<string, LogicValue>, skip: string[] = []): string =>
  Object.entries(o)
    .filter(([k]) => !skip.includes(k))
    .map(([k, v]) => `${k} = ${shortValue(v)}`)
    .join(" · ");
