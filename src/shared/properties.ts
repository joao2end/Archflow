/**
 * Propriedades (campos) de Entity, Value Object, Aggregate Root, Command, Domain Event e Read Model.
 *
 * Servem para explicar a estrutura do modelo: nome, tipo, obrigatoriedade e o significado de cada campo.
 * Podem ser escritas na interface (tabela), coladas como JSON / JSON Schema / texto simples, ou enviadas por MCP.
 */
import type { PropertySpec } from "./schema";

export const MAX_PROPERTIES = 100;

const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/** Valida uma lista de propriedades vinda de fora (op/MCP). Mensagem acionável ou undefined. */
export function checkProperties(v: unknown): string | undefined {
  if (!Array.isArray(v)) return "ddd.properties deve ser uma lista de { name, type?, optional?, key?, description?, example? }";
  if (v.length > MAX_PROPERTIES) return `ddd.properties aceita no máximo ${MAX_PROPERTIES} propriedades`;
  const seen = new Set<string>();
  for (const [i, p] of v.entries()) {
    if (!p || typeof p !== "object" || Array.isArray(p)) return `ddd.properties[${i}] deve ser um objeto { name, type?, ... }`;
    const o = p as Record<string, unknown>;
    for (const k of Object.keys(o)) if (!["name", "type", "optional", "key", "description", "example"].includes(k)) return `ddd.properties[${i}] não tem o campo "${k}". Campos: name, type, optional, key, description, example`;
    const name = text(o.name);
    if (!name) return `ddd.properties[${i}].name deve ser um texto não vazio`;
    if (name.length > 80) return `ddd.properties[${i}].name passa de 80 caracteres`;
    if (seen.has(name.toLowerCase())) return `ddd.properties: o nome "${name}" aparece mais de uma vez`;
    seen.add(name.toLowerCase());
    for (const f of ["type", "description", "example"]) if (o[f] !== undefined && typeof o[f] !== "string") return `ddd.properties[${i}].${f} deve ser texto`;
    for (const f of ["optional", "key"]) if (o[f] !== undefined && typeof o[f] !== "boolean") return `ddd.properties[${i}].${f} deve ser true ou false`;
  }
  return undefined;
}

/** Remove vazios e normaliza (texto aparado; `optional`/`key` só quando verdadeiros). */
export function cleanProperties(list: PropertySpec[]): PropertySpec[] {
  const out: PropertySpec[] = [];
  const seen = new Set<string>();
  for (const p of list) {
    const name = text(p.name);
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    const q: PropertySpec = { name };
    if (text(p.type)) q.type = text(p.type);
    if (p.optional) q.optional = true;
    if (p.key) q.key = true;
    if (text(p.description)) q.description = text(p.description);
    if (text(p.example)) q.example = text(p.example);
    out.push(q);
  }
  return out;
}

/** Texto curto: `id: uuid#, total: Dinheiro, nota?: texto` (# = identificador, ? = opcional). */
export const propertiesSummary = (list: PropertySpec[] | undefined) => (list ?? []).map((p) => `${p.name}${p.optional ? "?" : ""}${p.type ? `: ${p.type}` : ""}${p.key ? " #" : ""}`).join(", ");

/** Uma propriedade por linha: `nome[?]: tipo — descrição`, `#` no começo marca o identificador. */
export function propertiesToLines(list: PropertySpec[]): string {
  return list.map((p) => `${p.key ? "#" : ""}${p.name}${p.optional ? "?" : ""}${p.type ? `: ${p.type}` : ""}${p.description ? ` — ${p.description}` : ""}`).join("\n");
}

export const propertiesToJson = (list: PropertySpec[]) => JSON.stringify(list, null, 2);

export type ParseResult = { ok: true; properties: PropertySpec[]; format: string } | { ok: false; error: string };

const fromEntry = (name: string, v: unknown, required?: Set<string>): PropertySpec | undefined => {
  if (typeof v === "string") return { name, type: v };
  if (!v || typeof v !== "object" || Array.isArray(v)) return { name };
  const o = v as Record<string, unknown>;
  const t = o.type;
  const type = typeof t === "string" ? (o.format && typeof o.format === "string" ? `${t} (${o.format})` : t) : Array.isArray(t) ? t.filter((x) => x !== "null").join(" | ") : o.$ref && typeof o.$ref === "string" ? String(o.$ref).split("/").pop() : undefined;
  const items = o.items && typeof o.items === "object" ? (o.items as Record<string, unknown>).type : undefined;
  const optional = o.optional === true || o.required === false || (required ? !required.has(name) : false) || (Array.isArray(t) && t.includes("null"));
  return {
    name,
    ...(type ? { type: type === "array" && typeof items === "string" ? `${items}[]` : type } : {}),
    ...(optional ? { optional: true } : {}),
    ...(o.key === true || o.primaryKey === true || o.id === true ? { key: true } : {}),
    ...(typeof o.description === "string" ? { description: o.description } : {}),
    ...(o.example !== undefined && o.example !== null ? { example: typeof o.example === "string" ? o.example : JSON.stringify(o.example) } : {}),
  };
};

const fromJson = (v: unknown): { list: PropertySpec[]; format: string } | undefined => {
  if (Array.isArray(v)) {
    const list: PropertySpec[] = [];
    for (const it of v) {
      if (typeof it === "string") list.push(...(parseLines(it) ?? []));
      else if (it && typeof it === "object" && typeof (it as { name?: unknown }).name === "string") list.push(fromEntry((it as { name: string }).name, it)!);
      else return undefined;
    }
    return { list, format: "lista JSON" };
  }
  if (!v || typeof v !== "object") return undefined;
  const o = v as Record<string, unknown>;
  // JSON Schema: { properties: { nome: { type } }, required: [...] }
  if (o.properties && typeof o.properties === "object" && !Array.isArray(o.properties)) {
    const req = new Set(Array.isArray(o.required) ? o.required.filter((x): x is string => typeof x === "string") : []);
    return { list: Object.entries(o.properties as Record<string, unknown>).map(([k, x]) => fromEntry(k, x, req.size ? req : undefined)!), format: "JSON Schema" };
  }
  // mapa nome → tipo | { type, description }  ou um exemplo de objeto { id: "abc", total: 10 }
  const entries = Object.entries(o);
  if (!entries.length) return undefined;
  const isMeta = (x: unknown) => typeof x === "string" || (!!x && typeof x === "object" && !Array.isArray(x) && ("type" in x || "description" in x));
  if (entries.every(([, x]) => isMeta(x))) return { list: entries.map(([k, x]) => fromEntry(k, x)!), format: "mapa JSON" };
  return {
    list: entries.map(([k, x]) => ({ name: k, type: Array.isArray(x) ? `${x.length && typeof x[0] !== "object" ? typeof x[0] : "objeto"}[]` : x === null ? undefined : typeof x === "object" ? "objeto" : typeof x === "number" ? (Number.isInteger(x) ? "inteiro" : "número") : typeof x === "boolean" ? "booleano" : "texto" } as PropertySpec)),
    format: "exemplo JSON",
  };
};

function parseLines(src: string): PropertySpec[] | undefined {
  const out: PropertySpec[] = [];
  for (const raw of src.split(/\r?\n/)) {
    let line = raw.trim();
    if (!line || line.startsWith("//")) continue;
    line = line.replace(/^[-*•]\s+/, "");
    const key = line.startsWith("#");
    if (key) line = line.slice(1).trim();
    let description: string | undefined;
    const d = line.match(/\s[—–-]\s/);
    if (d?.index !== undefined) {
      description = line.slice(d.index + d[0].length).trim();
      line = line.slice(0, d.index).trim();
    }
    const colon = line.indexOf(":");
    let name = (colon >= 0 ? line.slice(0, colon) : line).trim();
    const type = colon >= 0 ? line.slice(colon + 1).trim() : "";
    const optional = name.endsWith("?");
    if (optional) name = name.slice(0, -1).trim();
    if (!name || /[\s,;]/.test(name)) return undefined;
    out.push({ name, ...(type ? { type } : {}), ...(optional ? { optional: true } : {}), ...(key ? { key: true } : {}), ...(description ? { description } : {}) });
  }
  return out;
}

/**
 * Lê propriedades de: lista JSON (`[{name,type,...}]` ou `["nome: tipo"]`), JSON Schema, mapa `{nome: tipo}`, exemplo de objeto,
 * ou texto — uma por linha (`nome?: tipo — descrição`) ou separadas por vírgula (`pedidoId, total, criadoEm`).
 */
export function parseProperties(input: string): ParseResult {
  const src = input.trim();
  if (!src) return { ok: true, properties: [], format: "vazio" };
  let list: PropertySpec[] | undefined;
  let format = "texto";
  if (/^[[{]/.test(src)) {
    try {
      const j = fromJson(JSON.parse(src));
      if (!j) return { ok: false, error: "JSON não reconhecido: use uma lista [{ name, type }], um mapa { nome: tipo } ou um JSON Schema com properties." };
      list = j.list;
      format = j.format;
    } catch (e) {
      return { ok: false, error: `JSON inválido: ${(e as Error).message}` };
    }
  } else if (!src.includes("\n") && src.includes(",") && !src.includes(":") && !src.includes("—")) {
    list = src.split(",").map((s) => ({ name: s.trim() })).filter((p) => p.name);
    format = "lista separada por vírgula";
  } else {
    list = parseLines(src);
    if (!list) return { ok: false, error: "Não entendi uma das linhas. Use: nome: tipo — descrição (um por linha), com ? depois do nome se for opcional." };
  }
  const cleaned = cleanProperties(list);
  if (!cleaned.length) return { ok: false, error: "Nenhuma propriedade encontrada." };
  if (cleaned.length > MAX_PROPERTIES) return { ok: false, error: `No máximo ${MAX_PROPERTIES} propriedades.` };
  return { ok: true, properties: cleaned, format };
}

/** Une `base` com `extra`: o que `extra` traz substitui o de mesmo nome; o resto entra no fim. */
export function mergeProperties(base: PropertySpec[], extra: PropertySpec[]): PropertySpec[] {
  const out = [...base];
  for (const p of extra) {
    const i = out.findIndex((x) => x.name.toLowerCase() === p.name.toLowerCase());
    if (i >= 0) out[i] = { ...out[i], ...p, name: out[i].name };
    else out.push(p);
  }
  return out;
}
