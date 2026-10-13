/**
 * JEV aplicado aos CENÁRIOS (criação e posicionamento), em cima dos diagramas Logic.
 *
 *   npm run eval:scenario                    # exemplos + cofre (examples/exemplos-logic, diagrams)
 *   npm run eval:scenario -- <arquivo|pasta> # só o que for passado
 *
 *  - Executor: cada pergunta/atrito que quem cria ou lê um cenário teria (campos vazios, nome genérico, entrada faltando).
 *  - Verificador: o exemplo do cenário passa no fluxo? (checkExamples)
 *  - Juiz: nota de facilidade 0–10 = 10 − 1,5 × atritos − 1 × inconsistências de posição; esforço de criação = campos a digitar.
 *
 * Aceite: facilidade ≥ 8 em todo diagrama e 0 exemplos falhando. Sai com 1 se algum não for adequado.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { checkExamples, isFlowNode, usageOf, dataKey } from "../src/shared/logic";
import { normalizeDoc } from "../src/shared/ops";
import { docMode, type Doc, type NodeEl } from "../src/shared/schema";

const collect = (p: string): string[] => (!existsSync(p) ? [] : statSync(p).isDirectory() ? readdirSync(p).flatMap((f) => (f === "trash" || f === ".archflow" || f === "node_modules" ? [] : collect(join(p, f)))) : p.endsWith(".archflow.json") ? [p] : []);
const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const verbose = process.argv.includes("--verbose");
const roots = args.length ? args : ["examples/exemplos-logic", "diagrams"];
const GENERIC = /^((cen[aá]rio|scenario|caso|exemplo|teste)|(novo|nova)\s+(cen[aá]rio|caso|exemplo))\s*\d*$/i;

interface Friction {
  where: string;
  kind: "criação" | "leitura" | "posição" | "verificação";
  msg: string;
}

function scenarioFrictions(doc: Doc): { frictions: Friction[]; scenarios: number; effort: number } {
  const out: Friction[] = [];
  const add = (n: NodeEl, kind: Friction["kind"], msg: string) => out.push({ where: n.label || n.id, kind, msg });
  const scenarios = doc.nodes.filter((n) => n.logic?.role === "scenario");
  const written = new Set<string>();
  for (const u of usageOf(doc).values()) for (const w of u.writes) written.add(w);
  const inputs = doc.nodes.filter((n) => n.logic?.role === "input").filter((n) => n.logic!.value === undefined).map(dataKey).filter((k) => !written.has(k)); // dado com valor padrão não precisa ser informado
  const flow = doc.nodes.filter(isFlowNode);
  const bounds = flow.length ? { x0: Math.min(...flow.map((n) => n.x)), y0: Math.min(...flow.map((n) => n.y)), x1: Math.max(...flow.map((n) => n.x + n.w)), y1: Math.max(...flow.map((n) => n.y + n.h)) } : undefined;
  let effort = 0;
  const results = checkExamples(doc);

  for (const n of scenarios) {
    const l = n.logic!;
    const exs = l.examples ?? [];
    if (!exs.length) add(n, "criação", "sem exemplo: o cenário não toca nem confere nada");
    if (GENERIC.test(n.label.trim())) add(n, "criação", "nome genérico: diga o caso (ex.: «Pedido grande»)");
    if (!(l.text ?? "").trim()) add(n, "leitura", "falta a frase do cenário");
    for (const e of exs) {
      const given = Object.keys(e.given ?? {});
      const expect = Object.keys(e.expect ?? {});
      effort += 2 + given.length + expect.length; // nome + frase + linhas digitadas
      if (!given.length) add(n, "criação", `«${e.name}» não informa nenhum dado de entrada`);
      else {
        const miss = inputs.filter((k) => !given.includes(k));
        // entrada omitida só atrapalha quando o exemplo falha: se passa, o caminho não a lê (é de outro ramo)
        const failing = results.some((r) => r.node === n.id && r.example === e.name && !r.ok);
        if (failing && miss.length && miss.length < inputs.length) add(n, "criação", `«${e.name}» não informa: ${miss.slice(0, 3).join(", ")}`);
      }
      if (!expect.length) add(n, "criação", `«${e.name}» não diz o que espera`);
      if (GENERIC.test(e.name.trim())) add(n, "leitura", `exemplo «${e.name}» com nome genérico`);
    }
    const names = exs.map((e) => e.name);
    if (new Set(names).size !== names.length) add(n, "leitura", "exemplos com nomes repetidos");
    // posição: cartão de cenário não pode cobrir o fluxo nem ficar longe dele
    if (bounds && (n.x !== 0 || n.y !== 0)) {
      const overlaps = flow.some((f) => n.x < f.x + f.w && f.x < n.x + n.w && n.y < f.y + f.h && f.y < n.y + n.h);
      if (overlaps) add(n, "posição", "o cartão cobre um passo do fluxo");
      const dx = Math.max(bounds.x0 - (n.x + n.w), n.x - bounds.x1, 0);
      const dy = Math.max(bounds.y0 - (n.y + n.h), n.y - bounds.y1, 0);
      if (Math.hypot(dx, dy) > 360) add(n, "posição", `longe do fluxo (${Math.round(Math.hypot(dx, dy))}px)`);
    }
  }
  // alinhamento: cenários deveriam formar uma coluna/linha só (um eixo com pouca variação)
  const placed = scenarios.filter((n) => n.x !== 0 || n.y !== 0);
  if (placed.length >= 3) {
    const spread = (v: number[]) => Math.max(...v) - Math.min(...v);
    const xs = spread(placed.map((n) => n.x));
    const ys = spread(placed.map((n) => n.y));
    if (Math.min(xs, ys) > 120) add(placed[0], "posição", `cenários espalhados (${Math.round(xs)}×${Math.round(ys)}px): alinhe em uma fileira`);
  }
  for (const r of results.filter((x) => !x.ok)) {
    const n = doc.nodes.find((x) => x.id === r.node);
    if (n?.logic?.role === "scenario") add(n, "verificação", `«${r.example}» falha: ${r.problems.join("; ")}`);
  }
  return { frictions: out, scenarios: scenarios.length, effort };
}

let failed = 0;
let totalEffort = 0;
let totalScenarios = 0;
const byKind: Record<string, number> = {};
for (const f of roots.flatMap(collect)) {
  const doc = normalizeDoc(JSON.parse(readFileSync(f, "utf8")));
  if (docMode(doc) !== "logic") continue;
  const { frictions, scenarios, effort } = scenarioFrictions(doc);
  if (!scenarios) continue;
  const pos = frictions.filter((x) => x.kind === "posição").length;
  const ease = Math.max(0, Math.round((10 - 1.5 * (frictions.length - pos) - pos) * 10) / 10);
  const ok = ease >= 8 && !frictions.some((x) => x.kind === "verificação");
  if (!ok) failed++;
  totalEffort += effort;
  totalScenarios += scenarios;
  for (const x of frictions) byKind[x.kind] = (byKind[x.kind] ?? 0) + 1;
  console.log(`${ok ? "✔" : "✘"} ${f}: facilidade ${ease} · ${scenarios} cenário(s) · ${frictions.length} atrito(s) · esforço ${effort} campos`);
  if (!ok || verbose) for (const x of frictions) console.log(`    [${x.kind}] ${x.where}: ${x.msg}`);
}
console.log(`\n${totalScenarios} cenário(s) · esforço médio ${totalScenarios ? (totalEffort / totalScenarios).toFixed(1) : 0} campos por cenário · atritos: ${JSON.stringify(byKind)}`);
process.exit(failed ? 1 : 0);
