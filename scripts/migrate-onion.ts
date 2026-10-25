/**
 * Migra diagramas de domínio para o layout "camadas" (Clean Architecture em círculos concêntricos).
 *
 * Uso:
 *   npx tsx scripts/migrate-onion.ts <pasta>            → só lista o que seria migrado (não grava nada)
 *   npx tsx scripts/migrate-onion.ts <pasta> --write    → grava; antes copia cada original para <pasta>/.archflow/backup-camadas-<data>/
 *
 * Entra: arquivos *.archflow.json em modo domain com algum elemento DDD (papel em `ddd.role`) e que ainda não estão nos anéis.
 * Fica de fora: mapas de contextos (só referências a outros diagramas), outros modos, a lixeira e as pastas internas (.archflow).
 */
import { copyFileSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { applyOps, normalizeDoc } from "../src/shared/ops";
import { docMode } from "../src/shared/schema";

const root = process.argv[2];
const write = process.argv.includes("--write");
if (!root) {
  console.error("informe a pasta: npx tsx scripts/migrate-onion.ts <pasta> [--write]");
  process.exit(1);
}

const files: string[] = [];
const walk = (dir: string) => {
  for (const name of readdirSync(dir)) {
    if (name.startsWith(".") || name === "node_modules") continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (name.endsWith(".archflow.json")) files.push(p);
  }
};
walk(root);

const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
const backup = join(root, ".archflow", `backup-camadas-${stamp}`);
let migrated = 0;
for (const file of files) {
  const rel = relative(root, file);
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    console.log(`  pulado (JSON inválido): ${rel}`);
    continue;
  }
  const doc = normalizeDoc(raw);
  if (docMode(doc) !== "domain") continue;
  if (!doc.nodes.some((n) => n.ddd)) {
    console.log(`  fica como está (mapa de contextos, sem elementos DDD): ${rel}`);
    continue;
  }
  if (doc.groups.some((g) => g.ring)) {
    console.log(`  já está nos anéis: ${rel}`);
    continue;
  }
  const r = applyOps(doc, [{ op: "layout", style: "onion" }]);
  if (!r.results[0]?.ok) {
    console.log(`  ERRO ao migrar ${rel}: ${r.results[0]?.error}`);
    continue;
  }
  migrated++;
  console.log(`${write ? "migrado" : "seria migrado"}: ${rel} (${doc.nodes.length} componentes)`);
  if (!write) continue;
  const dest = join(backup, rel);
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(file, dest);
  writeFileSync(file, JSON.stringify(r.doc, null, 2));
}
console.log(`\n${migrated} diagrama(s) ${write ? `migrado(s); originais em ${backup}` : "a migrar (nada foi gravado; use --write)"}`);
