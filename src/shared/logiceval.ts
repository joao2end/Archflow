/**
 * Avaliação de clareza de diagramas do modo Logic pelo modelo JEV (Juiz · Executor · Verificador).
 *
 *  - Executor: lê só o diagrama, sem o enunciado, e anota cada pergunta que precisaria fazer para entendê-lo
 *    (`questionsFor`: cada defeito de leitura ou de cobertura vira uma pergunta concreta).
 *  - Juiz: dá a nota de clareza de 0 a 10 a partir das perguntas, dos cruzamentos de setas e das sobreposições.
 *  - Verificador: roda o oráculo (casos tirados do ENUNCIADO, independentes do desenho) no fluxo e confere se o diagrama
 *    representa o problema; também exige que os exemplos do próprio diagrama passem.
 *
 * Aceite (`JEV_TARGETS`): no máximo 2 perguntas, clareza ≥ 8, representatividade ≥ 8 (oráculo 100% = 10) e nenhum erro de validação.
 * O julgamento visual (o desenho "parece" claro?) fica com o loop em docs/DIAGRAM_LOOP_PROMPT.md; aqui só entra o que se conta.
 */
import type { Doc, LogicExample, NodeEl } from "./schema";
import { checkExamples, dataKey, dataNodes, flowEdges, hasFlow, isFlowNode, logicIssues, runFlow, runPipeline } from "./logic";
import { logicLayout } from "./logiclayout";

export const JEV_TARGETS = { maxQuestions: 2, minClarity: 8, minRepresentativeness: 8, longRuleLines: 8, fanOut: 4 } as const;

export interface OracleCase {
  name: string;
  given: Record<string, LogicExample["given"][string]>;
  expect: LogicExample["expect"];
}

export interface Question {
  /** de onde veio: validação (L*), cobertura, leitura, dados ou contexto */
  source: "validação" | "cobertura" | "leitura" | "dados" | "contexto";
  q: string;
}

export interface Verdict {
  /** Executor */
  questions: Question[];
  /** Juiz: clareza do desenho, 0–10 */
  clarity: number;
  crossings: number;
  overlaps: number;
  /** Verificador: 0–10 (casos do oráculo que o fluxo reproduz) */
  representativeness: number;
  oracle: { total: number; passed: number; failed: string[] };
  errors: number;
  /** exemplos do próprio diagrama que não passam */
  ownExamplesFailing: number;
  adequate: boolean;
  /** o que falta para ficar adequado, em ordem de ganho */
  reasons: string[];
}

type Pt = { x: number; y: number };
const segCross = (a: Pt, b: Pt, c: Pt, d: Pt) => {
  const o = (p: Pt, q: Pt, r: Pt) => Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));
  return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
};

/**
 * Cruzamentos entre setas do fluxo e cartões sobrepostos, **como o diagrama está desenhado** (posições e pontos de passagem
 * gravados no arquivo: é o que o app mostra). Só quando nada foi posicionado ainda (tudo em 0,0, como nos casos montados por
 * código) usa o layout automático. Linhas retas entre os centros dos cartões: é uma aproximação, confirme olhando.
 */
export function geometry(doc: Doc): { crossings: number; overlaps: number } {
  if (!hasFlow(doc)) return { crossings: 0, overlaps: 0 };
  const flowNodes = doc.nodes.filter(isFlowNode);
  const placed = flowNodes.some((n) => n.x !== 0 || n.y !== 0);
  const plan = placed
    ? {
        pos: new Map(doc.nodes.map((n) => [n.id, { x: n.x, y: n.y }])),
        size: new Map(doc.nodes.map((n) => [n.id, { w: n.w, h: n.h }])),
        waypoints: new Map(doc.connections.filter((c) => c.waypoints?.length).map((c) => [c.id, c.waypoints!])),
      }
    : logicLayout(doc);
  const centre = (id: string): Pt => {
    const p = plan.pos.get(id)!;
    const s = plan.size.get(id)!;
    return { x: p.x + s.w / 2, y: p.y + s.h / 2 };
  };
  const lines = flowEdges(doc)
    .filter((e) => plan.pos.has(e.from) && plan.pos.has(e.to))
    .map((e) => ({ e, pts: [centre(e.from), ...(plan.waypoints.get(e.id) ?? []), centre(e.to)] }));
  let crossings = 0;
  for (let i = 0; i < lines.length; i++)
    for (let j = i + 1; j < lines.length; j++) {
      const A = lines[i];
      const B = lines[j];
      if (A.e.from === B.e.from || A.e.to === B.e.to || A.e.from === B.e.to || A.e.to === B.e.from) continue;
      let hit = false;
      for (let a = 0; a < A.pts.length - 1 && !hit; a++) for (let b = 0; b < B.pts.length - 1 && !hit; b++) hit = segCross(A.pts[a], A.pts[a + 1], B.pts[b], B.pts[b + 1]);
      if (hit) crossings++;
    }
  const ids = doc.nodes.filter((n) => plan.pos.has(n.id) && plan.size.has(n.id)).map((n) => n.id);
  let overlaps = 0;
  for (let i = 0; i < ids.length; i++)
    for (let j = i + 1; j < ids.length; j++) {
      const a = plan.pos.get(ids[i])!, as = plan.size.get(ids[i])!, b = plan.pos.get(ids[j])!, bs = plan.size.get(ids[j])!;
      if (a.x < b.x + bs.w && b.x < a.x + as.w && a.y < b.y + bs.h && b.y < a.y + as.h) overlaps++;
    }
  return { crossings, overlaps };
}

/** O que os exemplos do próprio diagrama (de cenário, regra, decisão ou escolha) exercitam: ramos, regras e fins. */
function uncoveredBy(doc: Doc): { uncovered: string[]; byNode: Map<string, string[]>; noFailureScenario: boolean; noScenario: boolean } {
  const scenarios = doc.nodes.filter((n) => n.logic?.role === "scenario");
  const seenStep = new Set<string>();
  const seenBranch = new Set<string>();
  const seenOutcome = new Set<string>();
  const unq = (v: string | undefined) => (v ?? "").replace(/^"(.*)"$/, "$1");
  for (const { run } of checkExamples(doc)) {
    for (const s of run.steps) {
      if (!s.rule) continue;
      if (s.applied || s.role !== "rule") seenStep.add(s.rule);
      if (s.branch !== undefined) seenBranch.add(`${s.rule}|${unq(s.branch)}`);
    }
    if (run.outcome) seenOutcome.add(run.outcome);
  }
  const uncovered: string[] = [];
  const byNode = new Map<string, string[]>();
  const steps = doc.nodes.filter(isFlowNode);
  for (const n of steps) {
    const gap = (msg: string) => {
      uncovered.push(msg);
      byNode.set(n.id, [...(byNode.get(n.id) ?? []), msg]);
    };
    const role = n.logic!.role;
    if (role === "rule" && !seenStep.has(n.id)) gap(`Quando roda a ação "${n.label}"? Nenhum cenário passa por ela.`);
    else if (role === "end" && !seenStep.has(n.id)) gap(`Em que caso o fluxo termina em "${n.label}"? Nenhum cenário chega lá.`);
    else if (role === "decision") {
      for (const b of ["sim", "nao"] as const) if (!seenBranch.has(`${n.id}|${b}`)) gap(`O que acontece quando a resposta de "${n.label}" é "${b === "sim" ? "sim" : "não"}"? Nenhum cenário mostra.`);
    } else if (role === "call" || role === "code") {
      if (flowEdges(doc).some((x) => x.from === n.id && x.logic?.branch === "erro") && !seenBranch.has(`${n.id}|erro`)) gap(`O que acontece quando "${n.label}" falha? Nenhum cenário mostra a seta "erro".`);
    } else if (role === "switch") {
      for (const e of flowEdges(doc).filter((x) => x.from === n.id)) {
        const k = unq(e.logic?.branch ?? e.logic?.case);
        const hit = seenBranch.has(`${n.id}|${k}`) || (e.logic?.branch === undefined && [...seenBranch].some((s) => s.startsWith(`${n.id}|`) && s.slice(n.id.length + 1) === unq(e.logic?.case)));
        if (!hit) gap(`O que acontece em "${n.label}" quando o caminho é "${k}"? Nenhum cenário mostra.`);
      }
    }
  }
  const hasErrorEnd = steps.some((n) => n.logic!.role === "end" && n.logic!.outcome === "erro");
  return { uncovered, byNode, noFailureScenario: hasErrorEnd && !seenOutcome.has("erro"), noScenario: !scenarios.length };
}

/** O que cada passo tem sem cobertura (nenhum exemplo ou cenário passa por ele ou por um dos seus ramos), para marcar no quadro. */
export function coverageGaps(doc: Doc): Map<string, string[]> {
  return uncoveredBy(doc).byNode;
}

/** Executor: cada coisa que uma pessoa que só vê o diagrama teria de perguntar. */
export function questionsFor(doc: Doc): Question[] {
  const out: Question[] = [];
  const ask = (source: Question["source"], q: string) => out.push({ source, q });
  const T = JEV_TARGETS;

  if (!(doc.description ?? "").trim()) ask("contexto", "Para que serve este diagrama e o que ele decide?");
  for (const i of logicIssues(doc)) if (i.severity !== "dica") ask("validação", `${i.rule}: ${i.message}`);

  const c = uncoveredBy(doc);
  if (c.noScenario) ask("cobertura", "Qual é um caso concreto de uso? Não há nenhum cenário.");
  for (const u of c.uncovered) ask("cobertura", u);
  if (c.noFailureScenario) ask("cobertura", 'O que acontece quando dá errado? Há um fim "erro" sem cenário que chegue a ele.');

  const fan = new Map<string, number>();
  for (const e of flowEdges(doc)) fan.set(e.from, (fan.get(e.from) ?? 0) + 1);
  for (const n of doc.nodes.filter(isFlowNode) as NodeEl[]) {
    const l = n.logic!;
    const t = (l.text ?? "").trim();
    if (l.role === "rule" && (l.then?.length ?? 0) > T.longRuleLines) ask("leitura", `Qual é o ponto de "${n.label}"? Ela faz ${l.then!.length} coisas (> ${T.longRuleLines}).`);
    // o rótulo «Redis configurado?» já é a pergunta: o texto só faz falta quando o rótulo não pergunta nada
    if ((l.role === "decision" || l.role === "switch") && !t && !n.label.trim().endsWith("?")) ask("leitura",`O que "${n.label}" está perguntando? Falta o texto.`);
    if (l.role === "decision" && !n.label.trim().endsWith("?") && !t.endsWith("?")) ask("leitura", `"${n.label}" é uma pergunta? O sim/não responde o quê?`);
    if (l.role === "rule" && !t) ask("leitura", `Em palavras de negócio, o que "${n.label}" faz? Falta a frase.`);
    if (/^(regra|rule|a[cç][aã]o|action|decis[aã]o|decision|passo|step|novo|nova)\s*\d*$/i.test(n.label.trim())) ask("leitura", `O que significa "${n.label}"? O nome é genérico.`);
    if (n.label.trim().length > 40) ask("leitura", `"${n.label.slice(0, 30)}…" diz o quê? O rótulo passa de 40 caracteres.`);
    if (l.role !== "switch" && l.role !== "fork" && (fan.get(n.id) ?? 0) > T.fanOut) ask("leitura", `Qual saída de "${n.label}" vale? Tem ${fan.get(n.id)} (> ${T.fanOut}).`);
  }
  for (const f of dataNodes(doc)) {
    const l = f.logic!;
    if (!(l.type ?? "").trim() || !(l.text ?? "").trim()) ask("dados", `O que é "${f.label}" (${dataKey(f)}) e em que unidade ou tipo?`);
  }
  return out;
}

/** Verificador: roda os casos do enunciado (oráculo) no diagrama, sem tocar nos cenários do autor. */
export function runOracle(doc: Doc, cases: OracleCase[]): Verdict["oracle"] {
  if (!cases.length) return { total: 0, passed: 0, failed: [] };
  const probe = structuredClone(doc);
  probe.nodes.push({
    id: "__oraculo",
    label: "oráculo",
    kind: "logic",
    x: 0,
    y: 0,
    w: 10,
    h: 10,
    logic: { role: "scenario", examples: cases.map((c) => ({ name: c.name, given: c.given, expect: c.expect })) },
  } as NodeEl);
  const res = checkExamples(probe).filter((r) => r.node === "__oraculo");
  const failed = res.filter((r) => !r.ok).map((r) => `${r.example}: ${r.problems.join("; ")}`);
  return { total: cases.length, passed: res.length - failed.length, failed };
}

/** Juiz + decisão: combina perguntas, geometria e oráculo no veredito. */
/** `requireOracle: false` (diagramas do cofre, sem enunciado): só Executor e Juiz decidem; a representatividade fica "não verificada". */
export function judge(doc: Doc, oracleCases: OracleCase[], opts: { requireOracle?: boolean } = {}): Verdict {
  const T = JEV_TARGETS;
  const questions = questionsFor(doc);
  const { crossings, overlaps } = geometry(doc);
  const clarity = Math.max(0, Math.min(10, Math.round((10 - 1.5 * questions.length - 0.5 * crossings - overlaps) * 10) / 10));
  const oracle = runOracle(doc, oracleCases);
  const representativeness = oracle.total ? Math.round((oracle.passed / oracle.total) * 100) / 10 : 0;
  const issues = logicIssues(doc);
  const errors = issues.filter((i) => i.severity === "erro").length;
  const ownExamplesFailing = checkExamples(doc).filter((r) => !r.ok).length;
  const reasons: string[] = [];
  if (questions.length > T.maxQuestions) reasons.push(`${questions.length} perguntas em aberto (máx. ${T.maxQuestions})`);
  if (clarity < T.minClarity) reasons.push(`clareza ${clarity} < ${T.minClarity}`);
  if (opts.requireOracle === false && !oracle.total) {
    /* sem enunciado: nada a verificar */
  } else if (representativeness < T.minRepresentativeness) reasons.push(oracle.total ? `representatividade ${representativeness} < ${T.minRepresentativeness} (${oracle.failed.length} caso(s) do enunciado não reproduzidos)` : "sem oráculo: representatividade não verificada");
  if (errors) reasons.push(`${errors} erro(s) de validação`);
  if (ownExamplesFailing) reasons.push(`${ownExamplesFailing} exemplo(s) do próprio diagrama falham`);
  return { questions, clarity, crossings, overlaps, representativeness, oracle, errors, ownExamplesFailing, adequate: !reasons.length, reasons };
}
