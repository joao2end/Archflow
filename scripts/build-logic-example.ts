/**
 * Grava o exemplo do modo Logic (engine de precificação) em `examples/exemplos-logic/`: o diagrama e o `modelo.md`
 * (a fila como a IA a lê).
 *
 *   npx tsx scripts/build-logic-example.ts            grava
 *   npx tsx scripts/build-logic-example.ts --check    confere se o que está em disco está atualizado
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderLogicExample } from "../src/shared/logic.example";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "examples");
const check = process.argv.includes("--check");
let stale = 0;
for (const f of renderLogicExample()) {
  const target = join(root, f.path);
  const current = existsSync(target) ? readFileSync(target, "utf8").replace(/\r\n/g, "\n") : undefined;
  if (current === f.content) continue;
  stale++;
  if (check) console.error(`desatualizado: examples/${f.path}`);
  else {
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, f.content);
    console.log(`gravado: examples/${f.path}`);
  }
}
if (check && stale) process.exit(1);
console.log(check ? "exemplo em dia" : `${stale} arquivo(s) gravado(s)`);
