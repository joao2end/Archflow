/**
 * Tira o «se … entao … senao» de dentro das Ações dos diagramas em modo logic: a condição vira uma Decisão (ver
 * liftRuleConditionals). Uso:
 *   npx tsx scripts/refactor-conditionals.ts <pasta-ou-arquivo> [...]          (só mostra o que faria)
 *   npx tsx scripts/refactor-conditionals.ts --write <pasta-ou-arquivo> [...]  (grava; faça backup antes)
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { checkExamples, liftRuleConditionals, recordPaths } from "../src/shared/logic";
import { applyOps, normalizeDoc, validateDetailed } from "../src/shared/ops";

const args = process.argv.slice(2);
const write = args.includes("--write");
const targets = args.filter((a) => a !== "--write");

const walk = (p: string): string[] => {
  if (statSync(p).isFile()) return [p];
  return readdirSync(p, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? (["trash", "node_modules", ".git", ".archflow"].includes(e.name) ? [] : walk(join(p, e.name))) : e.name.endsWith(".archflow.json") ? [join(p, e.name)] : []));
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
  if (raw.mode !== "logic") continue;
  const doc = normalizeDoc(raw);
  const res = liftRuleConditionals(doc);
  if (res.failed.length) console.log(`✘ ${f}\n   ${res.failed.join("\n   ")}`);
  if (!res.lifted.length) continue;
  const errsBefore = validateDetailed(doc).filter((i) => i.severity === "erro").length;
  const exBefore = checkExamples(doc).filter((x) => !x.ok).length;
  let next = applyOps(res.doc, [{ op: "layout", style: "pipeline" }]).doc;
  next = recordPaths(next);
  next = normalizeDoc(next);
  const issues = validateDetailed(next).filter((i) => i.severity === "erro");
  const exAfter = checkExamples(next).filter((x) => !x.ok).length;
  // a recontagem de erros ignora os L028 de antes: o que importa é não ter ganhado outros
  const errsAfter = issues.length;
  const novos = errsAfter > errsBefore - doc.nodes.filter((n) => n.logic?.role === "rule").length * 0 ? issues.filter((i) => i.rule !== "L028") : [];
  console.log(`${exAfter || novos.length ? "⚠" : "✔"} ${f}: ${res.lifted.length} ação(ões) convertida(s) · nós ${doc.nodes.length} → ${next.nodes.length} · exemplos falhando ${exBefore} → ${exAfter} · outros erros ${novos.length}`);
  for (const i of novos.slice(0, 5)) console.log(`     ${i.rule} ${i.message}`);
  if (exAfter || novos.length) continue;
  if (write) {
    const crlf = text.includes("\r\n");
    let out = JSON.stringify(next, null, 2) + "\n";
    if (crlf) out = out.replace(/\n/g, "\r\n");
    writeFileSync(f, out);
  }
  changed++;
}
console.log(`${write ? "gravados" : "a gravar"}: ${changed}`);
