/**
 * Etapas do modo Logic: trechos nomeados do fluxo («Validar o produto», «Preço de partida», «Arredondamento»).
 *
 * Uma etapa é um grupo com `stage`; os passos dela são os nós com `parent` no grupo. Aberta, é uma moldura em volta dos
 * passos. Recolhida, vira um cartão-resumo (o que faz, o que lê, o que escreve, quantos passos, se os exemplos batem) e as
 * setas que entravam ou saíam dos passos passam a ligar o cartão. Com todas recolhidas, o quadro é a visão geral do algoritmo.
 *
 * Nada aqui muda a execução: o fluxo roda pelos passos de verdade. As etapas mudam só o que se vê e o layout.
 */
import { checkExamples, isFlowNode, logicStatus, usageOf, visitedIds } from "./logic";
import type { Issue } from "./domain";
import type { ConnectionEl, Doc, GroupEl, NodeEl } from "./schema";

export const STAGE_W = 360;
export const STAGE_H = 134;

export const isStage = (g: GroupEl | undefined): boolean => !!g?.stage;
export const stageGroups = (doc: Doc): GroupEl[] => doc.groups.filter(isStage);

/** Passos (nós de fluxo) de uma etapa. */
export const stageMembers = (doc: Doc, id: string): NodeEl[] => doc.nodes.filter((n) => n.parent === id && isFlowNode(n));

/** Nó escondido → etapa recolhida que o representa. */
export function hiddenBy(doc: Doc): Map<string, string> {
  const m = new Map<string, string>();
  for (const g of doc.groups) if (g.stage?.collapsed) for (const n of stageMembers(doc, g.id)) m.set(n.id, g.id);
  return m;
}

/** Etapas recolhidas que têm passos (as vazias não viram cartão). */
export const collapsedStages = (doc: Doc): GroupEl[] => doc.groups.filter((g) => g.stage?.collapsed && stageMembers(doc, g.id).length > 0);

/**
 * O quadro como se vê: os passos das etapas recolhidas saem, e as setas que cruzavam a borda passam a ligar o cartão da etapa
 * (setas repetidas para o mesmo destino e pela mesma saída viram uma só; as de dentro somem). Sem etapa recolhida, devolve o próprio doc.
 */
export function projectStages(doc: Doc): Doc {
  const hid = hiddenBy(doc);
  if (!hid.size) return doc;
  const map = (id: string) => hid.get(id) ?? id;
  const seen = new Set<string>();
  const connections: ConnectionEl[] = [];
  for (const c of doc.connections) {
    const from = map(c.from);
    const to = map(c.to);
    if (from === c.from && to === c.to) {
      connections.push(c);
      continue;
    }
    if (from === to) continue; // dentro da etapa (ou volta de laço dentro dela)
    // saindo de uma etapa recolhida, o «sim»/«não» é de uma decisão lá dentro: no resumo, vale uma seta por destino, sem rótulo
    const inner = from !== c.from;
    const key = inner ? `${from}|${to}` : `${from}|${to}|${c.logic?.branch ?? ""}|${c.logic?.case ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    connections.push(inner ? { ...c, from, to, label: "", logic: undefined } : { ...c, from, to });
  }
  const sizes = new Set(collapsedStages(doc).map((g) => g.id));
  return {
    ...doc,
    nodes: doc.nodes.filter((n) => !hid.has(n.id)),
    groups: doc.groups.map((g) => (sizes.has(g.id) ? { ...g, w: STAGE_W, h: STAGE_H } : g)),
    connections,
  };
}

/** Para o layout: o quadro projetado com cada etapa recolhida no lugar de um passo (um cartão do tamanho do resumo). */
export function layoutView(doc: Doc): { doc: Doc; stageIds: Set<string> } {
  const col = collapsedStages(doc);
  if (!col.length) return { doc, stageIds: new Set() };
  const view = projectStages(doc);
  const pseudo: NodeEl[] = col.map((g) => ({ id: g.id, kind: "logic", label: g.label, x: g.x, y: g.y, w: STAGE_W, h: STAGE_H, logic: { role: "rule" } }));
  return { doc: { ...view, nodes: [...view.nodes, ...pseudo] }, stageIds: new Set(col.map((g) => g.id)) };
}

export interface StageSummary {
  steps: number;
  decisions: number;
  actions: number;
  /** dados que a etapa usa e que vêm de antes dela */
  reads: string[];
  /** dados que a etapa escreve */
  writes: string[];
  /** os exemplos dos passos: algum falha, todos batem ou não há */
  status: "ok" | "fail" | "none";
  /** cenários (exemplo a exemplo) que passam por algum passo da etapa */
  scenarios: number;
}

/** O resumo do cartão de uma etapa. `results` evita rodar os exemplos de novo quando já se tem. */
export function stageSummary(doc: Doc, id: string, results = checkExamples(doc), status = logicStatus(doc)): StageSummary {
  const members = stageMembers(doc, id);
  const ids = new Set(members.map((n) => n.id));
  const use = usageOf(doc);
  const reads = new Set<string>();
  const writes = new Set<string>();
  for (const n of members) {
    const u = use.get(n.id);
    if (!u) continue;
    for (const w of u.writes) writes.add(w);
    for (const r of u.reads) reads.add(r);
  }
  const st = members.map((n) => status.get(n.id)).filter((x): x is "ok" | "fail" | "none" => !!x);
  const scenarioIds = new Set(doc.nodes.filter((n) => n.logic?.role === "scenario").map((n) => n.id));
  return {
    steps: members.length,
    decisions: members.filter((n) => n.logic!.role === "decision" || n.logic!.role === "switch").length,
    actions: members.filter((n) => n.logic!.role === "rule").length,
    reads: [...reads].filter((r) => !writes.has(r)).sort(),
    writes: [...writes].sort(),
    status: st.includes("fail") ? "fail" : st.includes("ok") ? "ok" : "none",
    scenarios: results.filter((r) => scenarioIds.has(r.node) && visitedIds(r.run).some((v) => ids.has(v))).length,
  };
}

/** Etapas na ordem em que o fluxo chega nelas (a partir do Start, em largura); as que o fluxo não alcança vão para o fim. */
export function stageOrder(doc: Doc): GroupEl[] {
  const all = stageGroups(doc);
  const first = new Map<string, number>();
  const start = doc.nodes.find((n) => n.logic?.role === "start");
  if (start) {
    const seen = new Set([start.id]);
    const queue = [start.id];
    let i = 0;
    while (queue.length) {
      const id = queue.shift()!;
      const p = doc.nodes.find((n) => n.id === id)?.parent;
      if (p && !first.has(p)) first.set(p, i);
      i++;
      for (const c of doc.connections) if (c.from === id && !seen.has(c.to)) (seen.add(c.to), queue.push(c.to));
    }
  }
  return [...all].sort((a, b) => (first.get(a.id) ?? Infinity) - (first.get(b.id) ?? Infinity));
}

/* ───────── validação e descrição ───────── */

/** Formato de `source`: «arquivo», «arquivo:linha» ou «arquivo:linha-linha». */
export const SOURCE_RE = /^[^\s:]+(?::\d+(?:-\d+)?)?$/;

/** Fluxos grandes sem etapas viram uma parede de cartões: a partir daqui o app sugere separar em etapas. */
export const STAGE_HINT_STEPS = 25;

/** Avisos das etapas e do rastreio até o código (L034–L037). */
export function stageIssues(doc: Doc): Issue[] {
  const out: Issue[] = [];
  const add = (rule: string, severity: Issue["severity"], target: string | undefined, message: string) => out.push({ rule, severity, target, message });
  for (const g of stageGroups(doc)) {
    const members = stageMembers(doc, g.id);
    const where = `«${g.label}»`;
    if (!members.length) {
      add("L034", "dica", g.id, `a etapa ${where} não tem passos: ponha passos do fluxo dentro dela (parent) ou remova a etapa`);
      continue;
    }
    // recolhida, a etapa vira um cartão: mais de uma porta de entrada esconde por onde o fluxo entra
    const ids = new Set(members.map((n) => n.id));
    const entries = new Set(doc.connections.filter((c) => ids.has(c.to) && !ids.has(c.from) && isFlowNode(doc.nodes.find((n) => n.id === c.from) ?? ({} as NodeEl))).map((c) => c.to));
    if (entries.size > 1) add("L035", "aviso", g.id, `a etapa ${where} tem ${entries.size} passos de entrada (${[...entries].join(", ")}): recolhida, não dá para ver por onde o fluxo entra. Uma etapa costuma ter uma entrada só; mova o passo de fora para dentro ou separe em duas etapas`);
  }
  const flow = doc.nodes.filter(isFlowNode);
  if (flow.length > STAGE_HINT_STEPS && !stageGroups(doc).length) add("L036", "dica", undefined, `o fluxo tem ${flow.length} passos e nenhuma etapa: agrupe trechos com um objetivo (validar, calcular, arredondar…) em etapas, para ter a visão geral recolhida`);
  for (const n of doc.nodes) if (n.source !== undefined && !SOURCE_RE.test(n.source)) add("L037", "dica", n.id, `a origem «${n.source}» de «${n.label}» não está no formato «arquivo», «arquivo:linha» ou «arquivo:inicio-fim» (ex.: src/pricing.ts:120-134)`);
  return out;
}

/** Seção «Etapas» do describe: a visão geral em texto, na ordem do fluxo. */
export function describeStages(doc: Doc): string {
  const list = stageOrder(doc);
  if (!list.length) return "";
  const results = checkExamples(doc);
  const status = logicStatus(doc);
  const out = ["## Etapas (visão geral, na ordem do fluxo)", "", "| # | Etapa | O que faz | Passos | Lê de antes | Escreve | Exemplos | Recolhida |", "|---|---|---|---|---|---|---|---|"];
  list.forEach((g, i) => {
    const s = stageSummary(doc, g.id, results, status);
    const cell = (t: string) => t.replace(/\|/g, "\|").replace(/\n/g, " ");
    out.push(`| ${i + 1} | ${cell(g.label)} (\`${g.id}\`) | ${cell(g.stage?.text ?? "")} | ${stageMembers(doc, g.id).map((n) => `\`${n.id}\``).join(", ")} | ${s.reads.join(", ")} | ${s.writes.join(", ")} | ${s.status === "ok" ? "✔" : s.status === "fail" ? "✘" : "—"} | ${g.stage?.collapsed ? "sim" : "não"} |`);
  });
  return out.join("\n");
}
