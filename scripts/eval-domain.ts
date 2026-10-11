/**
 * Avalia diagramas de domínio (.archflow.json) contra as metas objetivas do modo Domain:
 * casos de uso rastreados até um evento, erros estruturais de DDD, o que falta corrigir e elementos duplicados.
 * Serve para medir o que uma IA produziu a partir de casos de uso, sem revisão humana.
 *
 *   npm run eval:domain -- diagrama1.archflow.json [diagrama2.archflow.json …]
 *
 * Sai com código 1 se algum diagrama não atingir as metas.
 */
import { readFileSync } from "node:fs";
import { EVAL_TARGETS, evaluateDomain } from "../src/shared/domain";
import { normalizeDoc } from "../src/shared/ops";
import { docMode } from "../src/shared/schema";

const files = process.argv.slice(2);
if (!files.length) {
  console.error("uso: npm run eval:domain -- <arquivo.archflow.json> [...]");
  process.exit(2);
}
console.log(`metas: ≥ ${EVAL_TARGETS.tracedPct}% dos casos de uso rastreados · ${EVAL_TARGETS.structuralErrors} erros estruturais · ≤ ${EVAL_TARGETS.issuesToFix} itens a corrigir · sem duplicados\n`);
let failed = 0;
for (const f of files) {
  const doc = normalizeDoc(JSON.parse(readFileSync(f, "utf8")));
  if (docMode(doc) !== "domain") {
    console.log(`– ${f}: modo ${docMode(doc)} (ignorado)`);
    continue;
  }
  const e = evaluateDomain(doc);
  if (!e.ok) failed++;
  console.log(`${e.ok ? "✔" : "✘"} ${f}: ${e.traced}/${e.useCases} casos de uso rastreados (${e.tracedPct}%) · ${e.structuralErrors} erros estruturais · ${e.issuesToFix} a corrigir${e.duplicates.length ? ` · duplicados: ${e.duplicates.join("; ")}` : ""}`);
}
process.exit(failed ? 1 : 0);
