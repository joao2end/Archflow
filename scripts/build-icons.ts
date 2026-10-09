import { readFileSync, writeFileSync } from "node:fs";
import { BUILTIN_ASSETS } from "../src/shared/catalog";

const sets: Record<string, any> = {
  l: JSON.parse(readFileSync("node_modules/@iconify-json/logos/icons.json", "utf8")),
  s: JSON.parse(readFileSync("node_modules/@iconify-json/simple-icons/icons.json", "utf8")),
};
const out: Record<string, { body: string; w: number; h: number }> = {};
const missing: string[] = [];
for (const a of BUILTIN_ASSETS) {
  const m = /^([ls]):(.+)$/.exec(a.icon);
  if (!m || out[a.icon]) continue;
  const set = sets[m[1]];
  let icon = set.icons[m[2]];
  if (!icon && set.aliases?.[m[2]]) icon = set.icons[set.aliases[m[2]].parent];
  if (!icon) { missing.push(a.icon); continue; }
  let body: string = icon.body;
  if (m[1] === "s") body = body.replace(/currentColor/g, a.color);
  out[a.icon] = { body, w: icon.width ?? set.width ?? 24, h: icon.height ?? set.height ?? 24 };
}
writeFileSync("src/shared/icons.generated.json", JSON.stringify(out));
console.log(`icons: ${Object.keys(out).length}, missing: ${missing.join(" ") || "none"}`);
