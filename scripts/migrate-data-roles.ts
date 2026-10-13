/**
 * O papel `fact` foi dividido em Input, Output e Variable (ver migrateFacts). Este script converte os diagramas em modo logic
 * que ainda têm `fact`: classifica cada dado pelo uso no fluxo, reorganiza (as laterais agora são Entradas, Resultados e
 * Variáveis do fluxo), regrava o caminho dos cenários e confere que nenhum exemplo passou a falhar. Uso:
 *   npx tsx scripts/migrate-data-roles.ts <pasta-ou-arquivo> [...]          (só mostra o que faria)
 *   npx tsx scripts/migrate-data-roles.ts --write <pasta-ou-arquivo> [...]  (grava; faça backup antes)
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { checkExamples, recordPaths } from "../src/shared/logic";
import { applyOps, normalizeDoc } from "../src/shared/ops";

const args = process.argv.slice(2);
const write = args.includes("--write");
const targets = args.filter((a) => a !== "--write");

const walk = (p: string): string[] => {
  if (statSync(p).isFile()) return p.endsWith(".archflow.json") ? [p] : [];
  return readdirSync(p, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? (["trash", "node_modules", ".git", ".archflow"].includes(e.name) ? [] : walk(join(p, e.name))) : walk(join(p, e.name))));
};

let changed = 0;
for (const f of targets.flatMap(walk)) {
  const text = readFileSync(f, "utf8");
  let raw: any;
  try {
    raw = JSON.parse(text);
  } catch {
    continue;
  }
  if (raw.mode !== "logic" || !raw.nodes?.some((n: any) => n?.logic?.role === "fact")) continue;
  const before = checkExamples(normalizeDoc(raw));
  const doc = normalizeDoc(raw); // migra fact → input/output/variable
  const roles = { input: 0, output: 0, variable: 0 } as Record<string, number>;
  for (const n of doc.nodes) if (n.logic && n.logic.role in roles) roles[n.logic.role]++;
  // grupos antigos das laterais saem; o layout cria os novos
  doc.groups = doc.groups.filter((g) => !(g.auto && ["entradas", "resultados", "variaveis"].includes(g.id)));
  for (const n of doc.nodes) if (n.parent && ["entradas", "resultados", "variaveis"].includes(n.parent)) delete n.parent;
  let next = applyOps(doc, [{ op: "layout", style: "pipeline" }]).doc;
  next = recordPaths(next);
  next = normalizeDoc(next);
  const after = checkExamples(next);
  const failed = after.filter((x) => !x.ok).length;
  const failedBefore = before.filter((x) => !x.ok).length;
  console.log(`${failed > failedBefore ? "⚠" : "✔"} ${f}: input ${roles.input} · output ${roles.output} · variable ${roles.variable} · exemplos que falham ${failedBefore} → ${failed}`);
  if (failed > failedBefore) continue;
  if (write) {
    const crlf = text.includes("\r\n");
    let out = JSON.stringify(next, null, 2) + "\n";
    if (crlf) out = out.replace(/\n/g, "\r\n");
    writeFileSync(f, out);
  }
  changed++;
}
console.log(`${write ? "gravados" : "a gravar"}: ${changed}`);
