/**
 * Modelo JEV (Juiz · Executor · Verificador) sobre os três algoritmos de referência (simples, médio, complexo)
 * ou sobre diagramas Logic do cofre. Critério de aceite: poucas perguntas em aberto e clareza/representatividade ≥ 8.
 *
 *   npm run eval:jev                          # os três casos de referência
 *   npm run eval:jev -- <arquivo|pasta> …     # diagramas do cofre (sem oráculo: só Executor e Juiz)
 *
 * Sai com 1 se algum diagrama não for adequado.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { basename } from "node:path";
import { jevCases } from "../src/shared/jev.cases";
import { JEV_TARGETS as T, judge } from "../src/shared/logiceval";
import { normalizeDoc } from "../src/shared/ops";
import { docMode } from "../src/shared/schema";

const collect = (p: string): string[] => (statSync(p).isDirectory() ? readdirSync(p).flatMap((f) => (f === "trash" || f === "node_modules" ? [] : collect(join(p, f)))).filter((f) => f.endsWith(".archflow.json")) : [p]);
const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const verbose = process.argv.includes("--verbose");

console.log(`aceite: ≤ ${T.maxQuestions} perguntas · clareza ≥ ${T.minClarity} · representatividade ≥ ${T.minRepresentativeness} · 0 erros\n`);
let failed = 0;
const report = (name: string, v: ReturnType<typeof judge>, hasOracle: boolean) => {
  if (!v.adequate) failed++;
  console.log(`${v.adequate ? "✔ ADEQUADO" : "✘ INADEQUADO"}  ${name}: ${v.questions.length} perguntas · clareza ${v.clarity} · representatividade ${hasOracle ? v.representativeness : "?"} (${v.oracle.passed}/${v.oracle.total}) · ${v.crossings} cruzamentos · ${v.overlaps} sobreposições`);
  if (!v.adequate || verbose) {
    for (const r of v.reasons) console.log(`    motivo:    ${r}`);
    for (const q of v.questions) console.log(`    pergunta:  [${q.source}] ${q.q}`);
    for (const f of v.oracle.failed) console.log(`    oráculo:   ${f}`);
  }
};

if (!args.length) for (const c of jevCases()) report(`${c.nivel} — ${c.doc.title}`, judge(c.doc, c.oraculo), true);
else
  for (const f of args.flatMap(collect)) {
    const doc = normalizeDoc(JSON.parse(readFileSync(f, "utf8")));
    if (docMode(doc) !== "logic") continue;
    // oráculo do diagrama, se existir: src/shared/fixtures/oracles/<nome-do-arquivo>.json (casos escritos a partir do enunciado, não do fluxo)
    const oracleFile = join("src", "shared", "fixtures", "oracles", basename(f).replace(/\.archflow\.json$/, "") + ".json");
    const cases = existsSync(oracleFile) ? (JSON.parse(readFileSync(oracleFile, "utf8")).cases ?? []) : [];
    report(f, judge(doc, cases, { requireOracle: false }), cases.length > 0);
  }
process.exit(failed ? 1 : 0);
