/**
 * Embute skills/archflow/SKILL.md em src/shared/skill.generated.ts, para que a UI, o bridge
 * e o servidor MCP empacotado (exe) entreguem a skill sem depender de arquivos em disco.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const md = readFileSync(join(root, "skills", "archflow", "SKILL.md"), "utf8").replace(/\r\n/g, "\n");
const out = `// GERADO por scripts/build-skill.ts a partir de skills/archflow/SKILL.md — não edite à mão.\nexport const SKILL_MD = ${JSON.stringify(md)};\n`;
writeFileSync(join(root, "src", "shared", "skill.generated.ts"), out);
console.log(`skill.generated.ts · ${md.length} caracteres`);
