/**
 * Grava os exemplos de DDD em `examples/exemplos-ddd/<exemplo>/` (os diagramas .archflow.json e o `modelo.md`, o modelo em texto,
 * como a IA o lê) e as aulas em `examples/aulas-ddd/` (diagramas e README de cada aula; o código das aulas é escrito à mão).
 * Os README.md de cada pasta de exemplo são escritos à mão e não são tocados.
 *
 *   npm run examples:build            grava
 *   npm run examples:build -- --check confere se o que está em disco está atualizado (sai com 1 se não estiver)
 *
 * Para usar um exemplo fora do app, copie a pasta `examples/exemplos-ddd` para dentro de um projeto do Archflow:
 * os vínculos entre diagramas (mapa de contextos → contextos → arquitetura) usam esses caminhos.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderAllExamples } from "../src/shared/examples.render";
import { renderLessons } from "../src/shared/lessons.render";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "examples");
const check = process.argv.includes("--check");
let stale = 0;
for (const f of [...renderAllExamples(), ...renderLessons((p) => readFileSync(join(root, p), "utf8"))]) {
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
if (check && stale) {
  console.error(`${stale} arquivo(s) desatualizado(s): rode npm run examples:build`);
  process.exit(1);
}
console.log(check ? "exemplos em dia" : `${stale} arquivo(s) gravado(s)`);
