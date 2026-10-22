/**
 * Exportação do modo Logic em seções: em vez de um arquivo só com dezenas de cartões, uma sequência que se lê em ordem:
 * capa (resumo), visão geral (etapas recolhidas), uma seção por etapa (só os passos dela, abertos), os cenários e os dados.
 *
 * Aqui só se decide O QUE vai em cada seção (e o diagrama de cada uma, com as etapas recolhidas ou abertas e o layout
 * refeito); desenhar e empacotar (PDF, ZIP de imagens) é com a interface.
 */
import { checkExamples } from "./logic";
import { dataContract, logicSummary, pairs, scenarioMatrix } from "./logicoverview";
import { stageMembers, stageOrder, stageSummary } from "./logicstages";
import { applyOps, slug, type Op } from "./ops";
import type { Doc } from "./schema";

export type SectionKind = "cover" | "overview" | "stage" | "flow" | "scenarios" | "data";

export interface Section {
  kind: SectionKind;
  /** nome do arquivo, sem extensão: «02-etapa-precos» */
  file: string;
  title: string;
  subtitle?: string;
  /** linhas curtas de contexto (o que lê, o que escreve, quantos passos) */
  facts?: string[];
  /** o diagrama desta seção (visão geral, etapa ou o fluxo inteiro) */
  doc?: Doc;
  /** etapa a enquadrar: a imagem recorta só a moldura dela */
  focus?: string;
}

/** O doc com cada etapa aberta ou recolhida conforme `open`, e o layout refeito para esse estado. */
function withStages(doc: Doc, open: (id: string) => boolean): Doc {
  const ops: Op[] = doc.groups.filter((g) => g.stage).map((g) => ({ op: "update", id: g.id, patch: { stage: { ...g.stage, collapsed: open(g.id) ? undefined : true } } }));
  return applyOps(doc, [...ops, { op: "layout" }]).doc;
}

/** As seções, na ordem de leitura. Sem etapas, o fluxo inteiro vira uma seção só (e a capa sugere criar etapas). */
export function logicSections(doc: Doc): Section[] {
  const results = checkExamples(doc);
  const stages = stageOrder(doc).filter((g) => stageMembers(doc, g.id).length);
  const out: Section[] = [];
  const n = () => String(out.length + 1).padStart(2, "0");
  const s = logicSummary(doc, results);
  out.push({ kind: "cover", file: `${n()}-resumo`, title: doc.title, subtitle: doc.description, facts: [`Entra: ${s.inputs.join(", ") || "—"}`, `Sai: ${s.outputs.join(", ") || "—"}`, `${s.steps} passos${stages.length ? ` em ${stages.length} etapas` : ""}`, s.scenarios.total ? `${s.scenarios.ok}/${s.scenarios.total} cenários batem` : "sem cenários"] });
  if (stages.length) {
    out.push({ kind: "overview", file: `${n()}-visao-geral`, title: "Visão geral", subtitle: "Cada etapa recolhida num cartão: o que faz, o que lê e o que escreve.", doc: withStages(doc, () => false) });
    for (const [i, g] of stages.entries()) {
      const sum = stageSummary(doc, g.id, results);
      out.push({
        kind: "stage",
        file: `${n()}-etapa-${slug(g.label)}`,
        title: `Etapa ${i + 1}: ${g.label}`,
        subtitle: g.stage?.text,
        facts: [`${sum.steps} passos (${sum.decisions} ${sum.decisions === 1 ? "decisão" : "decisões"}, ${sum.actions} ${sum.actions === 1 ? "ação" : "ações"})`, `Lê: ${sum.reads.join(", ") || "—"}`, `Escreve: ${sum.writes.join(", ") || "—"}`, `${sum.scenarios} cenários passam por ela`],
        doc: withStages(doc, (id) => id === g.id),
        focus: g.id,
      });
    }
  } else out.push({ kind: "flow", file: `${n()}-fluxo`, title: "O fluxo", subtitle: "Do início ao fim. Para separar em partes, agrupe trechos em etapas.", doc });
  if (doc.nodes.some((x) => x.logic?.role === "scenario")) out.push({ kind: "scenarios", file: `${n()}-cenarios`, title: "Cenários", subtitle: "Cada caso com números reais: o que entra, o que se espera, o que saiu e por onde passou." });
  if (doc.nodes.some((x) => x.logic && ["input", "output", "variable"].includes(x.logic.role))) out.push({ kind: "data", file: `${n()}-dados`, title: "Dados", subtitle: "O contrato do fluxo: o que entra, o que sai e o que ele usa no meio." });
  return out;
}

const cell = (t: string) => t.replace(/\|/g, "\\|").replace(/\n/g, " ");

/** O índice do ZIP (README.md): as seções com as imagens, o resumo, a matriz de cenários e o contrato de dados. */
export function sectionsIndex(doc: Doc, sections: Section[], ext = "png"): string {
  const out = [`# ${doc.title}`, ""];
  if (doc.description) out.push(doc.description, "");
  const cover = sections.find((x) => x.kind === "cover");
  if (cover?.facts) out.push(...cover.facts.map((f) => `- ${f}`), "");
  out.push("## Seções", "");
  for (const s of sections) {
    if (s.doc) out.push(`### ${s.title}`, "", ...(s.subtitle ? [s.subtitle, ""] : []), ...(s.facts ?? []).map((f) => `- ${f}`), ...(s.facts?.length ? [""] : []), `![${s.title}](${s.file}.${ext})`, "");
  }
  const m = scenarioMatrix(doc);
  if (m.length) {
    out.push("## Cenários", "", "| | Cenário | Entra | Espera | Saiu | Passa por |", "|---|---|---|---|---|---|");
    for (const r of m) out.push(`| ${r.ok ? "✔" : "✘"} | ${cell(r.label)}${r.failure ? " (falha esperada)" : ""} | \`${cell(pairs(r.given))}\` | \`${cell(pairs(r.expect))}\` | ${r.ok ? "igual ao esperado" : `\`${cell(pairs(r.got))}\``} | ${cell(r.stages.join(" → ")) || `${r.steps} passos`}${r.rounds > 1 ? ` (${r.rounds} voltas)` : ""} |`);
    out.push("");
  }
  const c = dataContract(doc);
  const table = (title: string, items: typeof c.inputs) => {
    if (!items.length) return;
    out.push(`## ${title}`, "", "| Nome | Dado | Tipo | Significado |", "|---|---|---|---|");
    for (const d of items) out.push(`| \`${d.key}\` | ${cell(d.label)} | ${d.type ? `\`${cell(d.type)}\`` : ""} | ${cell(d.text ?? "")} |`);
    out.push("");
  };
  table("Entradas", c.inputs);
  table("Resultados", c.outputs);
  table("Variáveis", c.variables);
  return out.join("\n");
}
