/**
 * Modo Logic → TypeScript executável.
 *
 * Um diagrama de lógica vira código de verdade, no estilo de um fluxo do n8n: o fluxo é uma função assíncrona
 * `run(input, deps)` que anda pelos nós (Start → ações, decisões, escolhas, laços, ramos paralelos → End), as chamadas
 * HTTP (Call com `request`) usam `fetch` de verdade e os cenários do diagrama viram testes (`tsx --test`).
 *
 *   <fluxo>/runtime.ts       as funções das expressões (mesma semântica do interpretador do app; sem dependências)
 *   <fluxo>/<fluxo>.ts       tipos de Input/Output e o `run`
 *   <fluxo>/<fluxo>.test.ts  um teste por exemplo de cenário (chamadas HTTP trocadas pelas respostas simuladas)
 *
 * Determinístico e sem I/O: devolve os arquivos, quem chama decide onde gravá-los. O teste `logicgen.test.ts` roda o
 * código gerado e compara com o interpretador do app (`runFlow`) em todos os exemplos.
 */
import type { GeneratedFile } from "./codegen";
import { parseExpr, parseStatement, type Expr } from "./expr";
import { dataKey, dataNodes, effectsOf, exitsOf, hasFlow, isFlowNode, pipelineRules } from "./logic";
import { docMode, type Doc, type LogicNodeSpec, type LogicValue, type NodeEl } from "./schema";
import { recognize, type Type } from "./types";

/* ───────── nomes ───────── */

const slug = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((w) => w.toLowerCase())
    .join("-") || "fluxo";

const q = (s: string) => JSON.stringify(s);
const IDENT = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const prop = (k: string) => (IDENT.test(k) ? k : q(k));
/** Texto de um comentário `//`: uma linha só. */
const note = (s: string) => s.replace(/\s*\n\s*/g, " ").trim();

/* ───────── runtime (arquivo gerado) ───────── */

/** Fonte do `runtime.ts`. Sem crases nem `${}` aqui dentro: é um texto copiado como está. */
export const RUNTIME_SOURCE = String.raw`/**
 * Funções usadas pelas expressões do fluxo. Gerado pelo Archflow: não precisa editar.
 * Mesma semântica do interpretador do app: erros de dados viram FlowError, divisão por zero é erro, e assim por diante.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Data = Record<string, any>;

export class FlowError extends Error {}

export interface HttpRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: Record<string, unknown>;
}
export interface HttpResult {
  /** 0 quando a rede falhou */
  status: number;
  ok: boolean;
  /** JSON, ou o texto da resposta quando não é JSON */
  body: unknown;
  error?: string;
}
export interface Deps {
  /** o fetch usado nas chamadas HTTP (padrão: o do ambiente). */
  fetch?: typeof fetch;
  /** troca a chamada HTTP de um nó (pelo id) por outra função: úteis nos testes. */
  http?: Record<string, (req: HttpRequest) => HttpResult | Promise<HttpResult>>;
  /** chamadas (Call sem request) que o seu código implementa, pelo id do nó. */
  calls?: Record<string, (data: Data) => unknown>;
  /** credenciais lidas por segredo("NOME") nas expressões; sem isso, vale a variável de ambiente de mesmo nome. */
  secrets?: Record<string, string>;
}

/** Credenciais informadas em deps.secrets (o run copia para cá). */
export const secrets: Record<string, string | undefined> = {};

const show = (v: unknown): string => (v === null || v === undefined ? "vazio" : JSON.stringify(v));

export function get(env: Data, name: string): any {
  if (name in env) return env[name];
  let cur: any = env;
  for (const part of name.split(".")) {
    if (cur && typeof cur === "object" && part in cur) cur = cur[part];
    else throw new FlowError('"' + name + '" não tem valor neste exemplo');
  }
  return cur;
}

export const num = (v: unknown, what: string): number => {
  if (typeof v !== "number" || Number.isNaN(v)) throw new FlowError(what + " precisa ser número, mas é " + show(v));
  return v;
};
const list = (v: unknown, what: string): any[] => {
  if (!Array.isArray(v)) throw new FlowError(what + "(lista) precisa de uma lista, mas recebeu " + show(v));
  return v;
};
const str = (v: unknown, what: string): string => {
  if (typeof v !== "string") throw new FlowError(what + " precisa de texto, mas recebeu " + show(v));
  return v;
};
export const truthy = (v: unknown): boolean => {
  if (typeof v !== "boolean") throw new FlowError("esperava verdadeiro ou falso, mas veio " + show(v));
  return v;
};
export const same = (a: unknown, b: unknown): boolean => (Array.isArray(a) || Array.isArray(b) ? JSON.stringify(a) === JSON.stringify(b) : a === b);

export const add = (l: unknown, r: unknown): any => (typeof l === "string" && typeof r === "string" ? l + r : num(l, "o lado esquerdo do +") + num(r, "o lado direito do +"));
export const sub = (l: unknown, r: unknown): number => num(l, "o lado esquerdo do -") - num(r, "o lado direito do -");
export const mul = (l: unknown, r: unknown): number => num(l, "o lado esquerdo do *") * num(r, "o lado direito do *");
export const div = (l: unknown, r: unknown): number => {
  const d = num(r, "o divisor");
  if (d === 0) throw new FlowError("divisão por zero");
  return num(l, "o dividendo") / d;
};
export const mod = (l: unknown, r: unknown): number => {
  const d = num(r, "o divisor");
  if (d === 0) throw new FlowError("divisão por zero");
  return num(l, "o dividendo") % d;
};
export const neg = (v: unknown): number => -num(v, "o valor depois do sinal -");
export const cmp = (op: "<" | "<=" | ">" | ">=", l: unknown, r: unknown): boolean => {
  if (l === null || r === null) return false;
  const text = typeof l === "string" && typeof r === "string";
  const a = text ? l : num(l, "o lado esquerdo da comparação");
  const b = text ? r : num(r, "o lado direito da comparação");
  return op === "<" ? a < b : op === "<=" ? a <= b : op === ">" ? a > b : a >= b;
};
export const isIn = (l: unknown, r: unknown): boolean => {
  if (!Array.isArray(r)) throw new FlowError('depois de "em" vem uma lista, ex.: em ["a", "b"]');
  return r.some((x) => same(x, l));
};
export const idx = (base: unknown, i: unknown): any => {
  if (typeof i !== "number" || !Number.isInteger(i)) throw new FlowError("a posição entre [ ] precisa ser um número inteiro (a primeira é 0), mas é " + show(i));
  if (!Array.isArray(base) && typeof base !== "string") throw new FlowError("[" + i + "] só vale para lista ou texto, mas o valor é " + show(base));
  if (i < 0 || i >= base.length) throw new FlowError("a posição " + i + " não existe: a lista tem " + base.length + " item(ns)");
  return base[i];
};
export const field = (base: unknown, name: string): any => {
  if (!base || typeof base !== "object" || Array.isArray(base)) throw new FlowError("." + name + " só vale para um objeto, mas o valor é " + show(base));
  return get(base as Data, name);
};

const scope = (env: Data, item: unknown): Data => ({ ...env, ...(item && typeof item === "object" && !Array.isArray(item) ? (item as Data) : {}), item });
export const filter = (v: unknown, f: (e: Data) => unknown, env: Data): any[] =>
  list(v, "filtrar").filter((it) => {
    const w = f(scope(env, it));
    if (typeof w !== "boolean") throw new FlowError("a condição de filtrar precisa dar verdadeiro ou falso para cada item, mas deu " + show(w));
    return w;
  });
export const map = (v: unknown, f: (e: Data) => unknown, env: Data): any[] => list(v, "mapear").map((it) => f(scope(env, it)));

const DAY = 86400000;
const dayOf = (v: unknown, what: string): number => {
  const m = typeof v === "string" ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(v) : null;
  if (!m) throw new FlowError(what + " precisa de uma data em texto AAAA-MM-DD (ex.: 2026-10-12), mas recebeu " + show(v));
  const t = Date.UTC(+m[1], +m[2] - 1, +m[3]);
  const d = new Date(t);
  if (d.getUTCFullYear() !== +m[1] || d.getUTCMonth() !== +m[2] - 1 || d.getUTCDate() !== +m[3]) throw new FlowError(what + ": a data " + show(v) + " não existe no calendário");
  return Math.round(t / DAY);
};

export const fn = {
  min: (...a: unknown[]) => Math.min(...a.map((v) => num(v, "min"))),
  max: (...a: unknown[]) => Math.max(...a.map((v) => num(v, "max"))),
  abs: (x: unknown) => Math.abs(num(x, "abs")),
  piso: (x: unknown) => Math.floor(num(x, "piso")),
  teto: (x: unknown) => Math.ceil(num(x, "teto")),
  arredondar: (x: unknown, casas?: unknown) => {
    const f = 10 ** (casas === undefined ? 0 : num(casas, "casas"));
    return Math.round((num(x, "arredondar") + Number.EPSILON) * f) / f;
  },
  entre: (x: unknown, lo: unknown, hi: unknown) => num(x, "entre") >= num(lo, "entre") && num(x, "entre") <= num(hi, "entre"),
  vazio: (x: unknown) => x === null || x === "" || (Array.isArray(x) && x.length === 0),
  contem: (l: unknown, x: unknown) => list(l, "contem").some((y) => same(y, x)),
  tamanho: (x: unknown) => {
    if (Array.isArray(x) || typeof x === "string") return x.length;
    throw new FlowError("tamanho precisa de lista ou texto");
  },
  texto: (x: unknown) => {
    if (x === null) return "";
    if (typeof x === "string") return x;
    if (typeof x === "number" || typeof x === "boolean") return String(x);
    throw new FlowError("texto(x) converte número, lógico ou vazio; uma lista não vira texto (use juntar)");
  },
  numero: (x: unknown) => {
    const t = str(x, "numero").trim().replace(",", ".");
    if (t === "" || !Number.isFinite(Number(t))) throw new FlowError("numero(" + show(x) + "): isso não é um número");
    return Number(t);
  },
  aparar: (x: unknown) => str(x, "aparar").trim(),
  maiusculas: (x: unknown) => str(x, "maiusculas").toUpperCase(),
  minusculas: (x: unknown) => str(x, "minusculas").toLowerCase(),
  trocar: (x: unknown, de: unknown, para: unknown) => str(x, "trocar").split(str(de, "trocar")).join(str(para, "trocar")),
  juntar: (l: unknown, sep: unknown) => list(l, "juntar").map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(str(sep, "juntar")),
  partir: (x: unknown, sep: unknown) => str(x, "partir").split(str(sep, "partir")),
  dias_entre: (a: unknown, b: unknown) => dayOf(b, "dias_entre") - dayOf(a, "dias_entre"),
  somar_dias: (d: unknown, n: unknown) => {
    const k = num(n, "somar_dias");
    if (!Number.isInteger(k)) throw new FlowError("somar_dias: o número de dias precisa ser inteiro");
    return new Date((dayOf(d, "somar_dias") + k) * DAY).toISOString().slice(0, 10);
  },
  soma: (l: unknown) => list(l, "soma").reduce<number>((t, x) => t + num(x, "cada item de soma"), 0),
  media: (l: unknown) => {
    const xs = list(l, "media");
    if (!xs.length) throw new FlowError("media(lista): a lista está vazia");
    return xs.reduce<number>((t, x) => t + num(x, "cada item de media"), 0) / xs.length;
  },
  primeiro: (l: unknown) => list(l, "primeiro")[0] ?? null,
  ultimo: (l: unknown) => {
    const xs = list(l, "ultimo");
    return xs[xs.length - 1] ?? null;
  },
  ordenar: (l: unknown) => {
    const xs = [...list(l, "ordenar")];
    if (xs.every((x) => typeof x === "number")) return xs.sort((x, y) => x - y);
    if (xs.every((x) => typeof x === "string")) return xs.sort((x, y) => (x < y ? -1 : x === y ? 0 : 1));
    throw new FlowError("ordenar(lista) precisa de uma lista só de números ou só de textos");
  },
  unicos: (l: unknown) => list(l, "unicos").filter((x, i, xs) => xs.findIndex((y) => same(x, y)) === i),
  adicionar: (l: unknown, x: unknown) => [...list(l, "adicionar"), x],
  segredo: (nome: unknown) => {
    const k = str(nome, "segredo");
    const v = secrets[k] ?? (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.[k];
    if (v === undefined) throw new FlowError("credencial " + k + " não encontrada: informe em deps.secrets ou na variável de ambiente " + k);
    return v;
  },
};

/** Falta a seta de uma saída: erro de desenho do fluxo, dito na hora em que o fluxo passa por ali. */
export const missing = (label: string, branch: string): never => {
  throw new FlowError('falta a seta "' + branch + '" saindo de "' + label + '"');
};

/** Chamada HTTP no estilo do n8n: nunca lança por causa da rede ou do status; devolve o resultado para o fluxo decidir. */
export async function http(f: typeof fetch, req: HttpRequest): Promise<HttpResult> {
  try {
    const hasBody = req.body !== undefined && Object.keys(req.body).length > 0;
    const res = await f(req.url, {
      method: req.method,
      headers: { ...(hasBody ? { "content-type": "application/json" } : {}), ...req.headers },
      body: hasBody ? JSON.stringify(req.body) : undefined,
    });
    const raw = await res.text();
    let body: unknown = raw;
    try {
      body = raw === "" ? null : JSON.parse(raw);
    } catch {
      /* resposta que não é JSON fica como texto */
    }
    return { status: res.status, ok: res.ok, body };
  } catch (e) {
    return { status: 0, ok: false, body: null, error: e instanceof Error ? e.message : String(e) };
  }
}
`;

/* ───────── expressão → TypeScript ───────── */

/** Compila uma expressão do modo Logic para uma expressão TypeScript que usa `R` (runtime) e o objeto de dados `env`. */
export function exprToTs(e: Expr, env = "d", depth = 0): string {
  const go = (x: Expr) => exprToTs(x, env, depth);
  switch (e.t) {
    case "num": return Object.is(e.v, -0) ? "0" : String(e.v);
    case "str": return q(e.v);
    case "bool": return String(e.v);
    case "nul": return "null";
    case "id": return `R.get(${env}, ${q(e.name)})`;
    case "list": return `[${e.items.map(go).join(", ")}]`;
    case "idx": return `R.idx(${go(e.x)}, ${go(e.i)})`;
    case "field": return `R.field(${go(e.x)}, ${q(e.name)})`;
    case "un": return e.op === "-" ? `R.neg(${go(e.x)})` : `!R.truthy(${go(e.x)})`;
    case "if": return `(R.truthy(${go(e.c)}) ? ${go(e.a)} : ${go(e.b)})`;
    case "bin": {
      const l = go(e.l);
      const r = go(e.r);
      switch (e.op) {
        case "e": return `(R.truthy(${l}) && R.truthy(${r}))`;
        case "ou": return `(R.truthy(${l}) || R.truthy(${r}))`;
        case "+": return `R.add(${l}, ${r})`;
        case "-": return `R.sub(${l}, ${r})`;
        case "*": return `R.mul(${l}, ${r})`;
        case "/": return `R.div(${l}, ${r})`;
        case "%": return `R.mod(${l}, ${r})`;
        case "=": return `R.same(${l}, ${r})`;
        case "!=": return `!R.same(${l}, ${r})`;
        case "<": case "<=": case ">": case ">=": return `R.cmp(${q(e.op)}, ${l}, ${r})`;
        case "em": return `R.isIn(${l}, ${r})`;
        case "nao-em": return `!R.isIn(${l}, ${r})`;
      }
      return "null";
    }
    case "call": {
      if (e.fn === "filtrar" || e.fn === "mapear") {
        const inner = `e${depth + 1}`;
        return `R.${e.fn === "filtrar" ? "filter" : "map"}(${go(e.args[0])}, (${inner}) => ${exprToTs(e.args[1], inner, depth + 1)}, ${env})`;
      }
      return `R.fn.${e.fn}(${e.args.map(go).join(", ")})`;
    }
  }
}

const compile = (src: string, env = "d") => exprToTs(parseExpr(src), env);

/* ───────── tipos ───────── */

/** Tipo do modo Logic em TypeScript. `int` e `float` são `number`; o resto já é a sintaxe do TS. */
export function typeToTs(t: Type): string {
  switch (t.k) {
    case "prim": return t.n === "int" || t.n === "float" ? "number" : t.n === "any" ? "unknown" : t.n;
    case "lit": return typeof t.v === "string" ? q(t.v) : String(t.v);
    case "arr": return t.of.k === "union" ? `(${typeToTs(t.of)})[]` : `${typeToTs(t.of)}[]`;
    case "union": return t.of.map(typeToTs).join(" | ");
    case "obj": return t.fields.length ? `{ ${t.fields.map((f) => `${prop(f.name)}${f.optional ? "?" : ""}: ${typeToTs(f.t)}`).join("; ")} }` : "Record<string, never>";
  }
}

function tsTypeOf(n: NodeEl): string {
  const r = recognize(n.logic!.type);
  return r && r.ok ? typeToTs(r.type) : "unknown";
}

const literal = (v: LogicValue): string => JSON.stringify(v, null, 2).replace(/\n/g, "\n  ");

/* ───────── fluxo ───────── */

const IND = (n: number) => "  ".repeat(n);

/** Efeitos de uma Ação (`then`) ou de uma chamada (`devolve`), uma linha de TS por efeito. */
function effectsTs(l: LogicNodeSpec, ind: number): string[] {
  const out: string[] = [];
  for (const src of effectsOf(l)) {
    const s = parseStatement(src);
    out.push(`${IND(ind)}// ${note(src)}`);
    if (s.t === "lock") out.push(`${IND(ind)}locked.add(${q(s.name)});`);
    else if (s.t === "unlock") out.push(`${IND(ind)}locked.delete(${q(s.name)});`);
    else out.push(`${IND(ind)}if (!locked.has(${q(s.name)})) d[${q(s.name)}] = ${exprToTs(s.value)};`);
  }
  return out;
}

function requestTs(l: LogicNodeSpec, ind: number): string[] {
  const r = l.request!;
  const map = (m: Record<string, string> | undefined, name: string) => {
    const entries = Object.entries(m ?? {});
    return entries.length ? [`${IND(ind + 1)}${name}: {`, ...entries.map(([k, v]) => `${IND(ind + 2)}${q(k)}: ${compile(v)},`), `${IND(ind + 1)}},`] : [];
  };
  return [`method: ${q(r.method)},`, `url: ${compile(r.url)},`]
    .map((x) => IND(ind + 1) + x)
    .concat(map(r.headers, "headers"))
    .concat(r.headers ? [] : [`${IND(ind + 1)}headers: {},`])
    .concat(Object.keys(r.body ?? {}).length ? map(r.body, "body") : []);
}

/** Destino de uma saída do nó, ou uma chamada que explica a seta que falta. */
function target(doc: Doc, n: NodeEl, match: (e: ReturnType<typeof exitsOf>[number]) => boolean, branch: string): string {
  const e = exitsOf(doc, n.id).find(match);
  return e ? q(e.to.id) : `R.missing(${q(n.label)}, ${q(branch)})`;
}

function nodeCase(doc: Doc, n: NodeEl): string[] {
  const l = n.logic!;
  const outs = exitsOf(doc, n.id);
  const next = outs[0] ? q(outs[0].to.id) : "undefined";
  const L: string[] = [`${IND(3)}case ${q(n.id)}: { // ${note(n.label)}${l.role === "rule" ? "" : ` (${l.role})`}`];
  const at = (to: string) => `${IND(4)}at = ${to};`;
  switch (l.role) {
    case "start":
      L.push(at(next));
      break;
    case "rule":
      L.push(...effectsTs(l, 4), at(next));
      break;
    case "table": {
      // a primeira linha verdadeira aplica os efeitos dela; nenhuma, o «senão» (ou erro, como no app)
      (l.rows ?? []).forEach((r, i) => L.push(`${IND(4)}${i ? "} else " : ""}if (R.truthy(${compile(r.when)})) {${r.label ? ` // ${note(r.label)}` : ""}`, ...effectsTs({ ...l, role: "rule", then: r.then }, 5)));
      const none = l.otherwise ? effectsTs({ ...l, role: "rule", then: l.otherwise }, 5) : [`${IND(5)}throw new Error(${q(`nenhuma linha da tabela "${n.label}" valeu`)});`];
      L.push(...((l.rows ?? []).length ? [`${IND(4)}} else {`, ...none, `${IND(4)}}`] : none.map((x) => x.slice(IND(1).length))), at(next));
      break;
    }
    case "decision": {
      const yes = target(doc, n, (x) => x.branch === "sim", "sim");
      const no = target(doc, n, (x) => x.branch === "nao", "não");
      L.push(`${IND(4)}at = R.truthy(${compile(l.when!)}) ? ${yes} : ${no};`);
      break;
    }
    case "switch": {
      const cases = outs.filter((x) => x.case !== undefined);
      const other = target(doc, n, (x) => x.branch === "outros", "outros");
      if (l.on) {
        L.push(`${IND(4)}const v = ${compile(l.on)};`);
        cases.forEach((c, i) => L.push(`${IND(4)}${i ? "else " : ""}if (R.same(v, ${compile(c.case!, "{}")})) at = ${q(c.to.id)};`));
      } else cases.forEach((c, i) => L.push(`${IND(4)}${i ? "else " : ""}if (${compile(c.case!)} === true) at = ${q(c.to.id)};`));
      L.push(cases.length ? `${IND(4)}else at = ${other};` : at(other));
      break;
    }
    case "loop": {
      L.push(
        `${IND(4)}let s = loops.get(${q(n.id)});`,
        `${IND(4)}if (!s) {`,
        `${IND(5)}s = { n: 0, i: 0 };`,
        `${IND(5)}loops.set(${q(n.id)}, s);`,
      );
      if (l.foreach)
        L.push(
          `${IND(5)}const items = ${compile(l.foreach)};`,
          `${IND(5)}if (!Array.isArray(items)) throw new R.FlowError("\\"para cada\\" precisa de uma lista, mas deu " + JSON.stringify(items));`,
          `${IND(5)}s.list = items;`,
        );
      L.push(`${IND(4)}}`);
      const stops = [l.foreach !== undefined ? "s.i >= s.list!.length" : "", l.until !== undefined ? `${compile(l.until)} === true` : "", l.max !== undefined ? `s.n >= ${l.max}` : ""].filter(Boolean);
      L.push(
        `${IND(4)}if (${stops.join(" || ") || "false"}) {`,
        `${IND(5)}loops.delete(${q(n.id)});`,
        `${IND(5)}at = ${target(doc, n, (x) => x.branch === "segue", "segue")};`,
        `${IND(4)}} else {`,
        `${IND(5)}s.n++;`,
      );
      if (l.foreach) L.push(`${IND(5)}d[${q(l.as ?? "item")}] = s.list![s.i++];`);
      L.push(`${IND(5)}at = ${target(doc, n, (x) => x.branch === "repete", "repete")};`, `${IND(4)}}`);
      break;
    }
    case "fork": {
      L.push(
        `${IND(4)}let joinAt: string | undefined;`,
        `${IND(4)}for (const branch of [${outs.map((o) => q(o.to.id)).join(", ")}]) {`,
        `${IND(5)}const r = await walk(branch, true);`,
        `${IND(5)}if (r.stop !== "join") return r; // um ramo terminou o fluxo inteiro`,
        `${IND(5)}joinAt ??= r.at;`,
        `${IND(4)}}`,
        `${IND(4)}if (!joinAt) throw new R.FlowError("os ramos de ${note(n.label)} não chegam a um Join");`,
        `${IND(4)}at = JOINS[joinAt];`,
      );
      break;
    }
    case "join":
      L.push(`${IND(4)}if (inBranch) return { stop: "join", at: ${q(n.id)} };`, at(next));
      break;
    case "end":
      L.push(`${IND(4)}outcome = ${q(l.outcome ?? "ok")};`, `${IND(4)}return { stop: "end" };`);
      break;
    case "code": {
      const erro = target(doc, n, (x) => x.branch === "erro", "erro");
      const ok = target(doc, n, (x) => x.branch !== "erro", "segue");
      L.push(
        `${IND(4)}let failure: unknown;`,
        `${IND(4)}try {`,
        `${IND(5)}d.resultado = await (async (data: R.Data) => {`,
        ...l.code!.replace(/\s+$/, "").split("\n").map((line) => (line.trim() ? `${IND(6)}${line}` : "")),
        `${IND(5)}})(d);`,
        `${IND(4)}} catch (e) {`,
        `${IND(5)}failure = e ?? new R.FlowError("o código de ${note(n.label)} falhou");`,
        `${IND(4)}}`,
        `${IND(4)}const failed = failure !== undefined${l.falha !== undefined ? ` || R.truthy(${compile(l.falha)})` : ""};`,
      );
      // `devolve` lê `resultado`: os efeitos rodam antes de ele sair dos dados
      L.push(`${IND(4)}if (failed) {`, `${IND(5)}delete d.resultado;`, ...(outs.some((o) => o.branch === "erro") ? [] : [`${IND(5)}if (failure !== undefined) throw failure;`]), `${IND(5)}at = ${erro};`, `${IND(4)}} else {`, ...effectsTs(l, 5), `${IND(5)}delete d.resultado;`, `${IND(5)}at = ${ok};`, `${IND(4)}}`);
      break;
    }
    case "call": {
      const erro = target(doc, n, (x) => x.branch === "erro", "erro");
      const ok = target(doc, n, (x) => x.branch !== "erro", "segue");
      if (l.request) {
        L.push(
          `${IND(4)}const req: R.HttpRequest = {`,
          ...requestTs(l, 4),
          `${IND(4)}};`,
          `${IND(4)}const res = await (deps.http?.[${q(n.id)}]?.(req) ?? R.http(deps.fetch ?? fetch, req));`,
          `${IND(4)}d.resposta = res.body;`,
          `${IND(4)}d.status_http = res.status;`,
        );
      } else L.push(`${IND(4)}await deps.calls?.[${q(n.id)}]?.(d);`);
      const falhou = [l.request ? "!res.ok" : "", l.falha !== undefined ? `R.truthy(${compile(l.falha)})` : ""].filter(Boolean).join(" || ") || "false";
      L.push(`${IND(4)}if (${falhou}) {`);
      if (l.request) L.push(`${IND(5)}delete d.resposta;`, `${IND(5)}delete d.status_http;`);
      L.push(`${IND(5)}at = ${erro};`, `${IND(4)}} else {`, ...effectsTs(l, 5));
      if (l.request) L.push(`${IND(5)}delete d.resposta;`, `${IND(5)}delete d.status_http;`);
      L.push(`${IND(5)}at = ${ok};`, `${IND(4)}}`);
      break;
    }
    default:
      L.push(at(next));
  }
  if (l.role !== "end") L.push(`${IND(4)}break;`);
  L.push(`${IND(3)}}`);
  return L;
}

function header(doc: Doc): string[] {
  const inputs = dataNodes(doc).filter((n) => n.logic!.role === "input");
  const outputs = dataNodes(doc).filter((n) => n.logic!.role === "output");
  const field = (n: NodeEl, optional: boolean) => `  ${prop(dataKey(n))}${optional ? "?" : ""}: ${tsTypeOf(n)};${n.logic!.text ? ` // ${note(n.logic!.text)}` : ""}`;
  const defaults = dataNodes(doc).filter((n) => n.logic!.value !== undefined);
  return [
    "import * as R from \"./runtime\";",
    "",
    "/** O que entra no fluxo. */",
    "export interface Input {",
    ...inputs.map((n) => field(n, n.logic!.value !== undefined)),
    "}",
    "",
    "/** O que o fluxo devolve (os dados Output). */",
    "export interface Output {",
    ...outputs.map((n) => field(n, true)),
    "}",
    "",
    "export interface Result {",
    '  outcome: "ok" | "erro";',
    "  output: Output;",
    "  /** todos os dados ao final (entradas, variáveis e resultados) */",
    "  data: R.Data;",
    "  /** dados travados com `travar` */",
    "  locked: string[];",
    "}",
    "",
    ...(defaults.length ? ["const DEFAULTS: R.Data = {", ...defaults.map((n) => `  ${prop(dataKey(n))}: ${literal(n.logic!.value!)},`), "};"] : ["const DEFAULTS: R.Data = {};"]),
    "",
    'export type { Deps } from "./runtime";',
  ];
}

function resultCode(doc: Doc): string[] {
  const outs = dataNodes(doc).filter((n) => n.logic!.role === "output");
  return [
    "  const output: R.Data = {};",
    ...outs.map((n) => `  if (${q(dataKey(n))} in d) output[${q(dataKey(n))}] = d[${q(dataKey(n))}];`),
    "  return { outcome, output: output as Output, data: d, locked: [...locked] };",
  ];
}

/** O gatilho do Start: o que dispara o fluxo (n8n: «Trigger»). Webhook vira um handler da Fetch API; agenda, um cron e uma função. */
function triggerSource(doc: Doc): string[] {
  const t = doc.nodes.find((n) => n.logic?.role === "start")?.logic?.trigger;
  if (!t || t.kind === "manual") return ["", "/** O que dispara este fluxo. */", 'export const trigger = { kind: "manual" } as const;'];
  if (t.kind === "agenda")
    return [
      "",
      "/** O que dispara este fluxo: agende `onSchedule` com este cron (cron do sistema, GitHub Actions, Cloudflare Cron Triggers, node-cron…). */",
      `export const trigger = { kind: "agenda", cron: ${q(t.cron!)} } as const;`,
      `export const schedule = ${q(t.cron!)};`,
      "",
      "/** Roda o fluxo no horário agendado, só com os valores fixos dos dados. */",
      "export async function onSchedule(deps: R.Deps = {}): Promise<Result> {",
      "  return run({} as Input, deps);",
      "}",
    ];
  const method = t.method ?? "POST";
  return [
    "",
    "/** O que dispara este fluxo: uma chamada HTTP a este caminho. */",
    `export const trigger = { kind: "webhook", method: ${q(method)}, path: ${q(t.path!)} } as const;`,
    "",
    "/**",
    " * Recebe a chamada (Fetch API: funciona em Node 18+, Bun, Deno, Cloudflare Workers e route handlers do Next.js) e devolve a resposta:",
    " * 200 com { outcome, output } quando o fluxo termina ok, 422 quando termina em erro, 400 para dados inválidos e 405 para outro método.",
    method === "GET" ? " * Os dados vêm da query string (sempre texto)." : " * Os dados vêm do corpo JSON.",
    " */",
    "export async function handler(req: Request, deps: R.Deps = {}): Promise<Response> {",
    `  if (req.method !== ${q(method)}) return Response.json({ error: "método não permitido" }, { status: 405 });`,
    "  let input: unknown;",
    "  try {",
    method === "GET" ? "    input = Object.fromEntries(new URL(req.url).searchParams);" : "    input = await req.json();",
    "  } catch {",
    '    return Response.json({ error: "corpo JSON inválido" }, { status: 400 });',
    "  }",
    "  try {",
    "    const r = await run(input as Input, deps);",
    '    return Response.json({ outcome: r.outcome, output: r.output }, { status: r.outcome === "ok" ? 200 : 422 });',
    "  } catch (e) {",
    "    if (e instanceof R.FlowError) return Response.json({ error: e.message }, { status: 400 });",
    "    throw e;",
    "  }",
    "}",
  ];
}

/** O código do fluxo (`<fluxo>.ts`). */
function flowSource(doc: Doc): string {
  const flow = hasFlow(doc);
  const L: string[] = [
    `// ${note(doc.title)}: gerado pelo Archflow a partir do modo Logic. Cada passo abaixo é um nó do diagrama (o nome está no comentário).`,
    ...header(doc),
    "",
    `/** ${note(doc.title)}. Roda o fluxo com os dados de entrada e devolve o resultado. Erros de dados e setas faltando viram \`R.FlowError\`. */`,
    "export async function run(input: Input, deps: R.Deps = {}): Promise<Result> {",
    "  if (deps.secrets) Object.assign(R.secrets, deps.secrets);",
    "  const d: R.Data = { ...DEFAULTS, ...input };",
    "  const locked = new Set<string>();",
    '  let outcome: "ok" | "erro" = "ok";',
  ];
  if (!flow) {
    // fila simples (diagrama antigo, sem setas): as ações em ordem de `order`
    L.push("");
    for (const r of pipelineRules(doc)) {
      const l = r.logic!;
      L.push(`  // ${note(r.label)}`);
      if (l.when !== undefined) {
        L.push(`  if (R.truthy(${compile(l.when)})) {`, ...effectsTs(l, 2), "  }");
      } else L.push(...effectsTs(l, 1));
    }
    L.push("", ...resultCode(doc), "}");
    return L.join("\n") + "\n";
  }
  const start = doc.nodes.find((n) => n.logic?.role === "start");
  const steps = doc.nodes.filter(isFlowNode);
  const joins = steps.filter((n) => n.logic!.role === "join");
  L.push(
    "  const loops = new Map<string, { n: number; i: number; list?: unknown[] }>();",
    "  let guard = 0;",
    ...(joins.length ? ["  const JOINS: Record<string, string | undefined> = {", ...joins.map((j) => `    ${q(j.id)}: ${exitsOf(doc, j.id)[0] ? q(exitsOf(doc, j.id)[0].to.id) : "undefined"},`), "  };"] : ["  const JOINS: Record<string, string | undefined> = {};"]),
    "",
    '  /** Anda a partir de um nó até um End (ou, num ramo paralelo, até um Join). */',
    '  const walk = async (from: string, inBranch: boolean): Promise<{ stop: "end" | "join"; at?: string }> => {',
    "    let at: string | undefined = from;",
    "    while (at) {",
    '      if (++guard > 5000) throw new R.FlowError("mais de 5000 passos: o fluxo parece não terminar");',
    "      switch (at) {",
  );
  for (const n of steps) L.push(...nodeCase(doc, n));
  L.push(
    `${IND(3)}default:`,
    `${IND(4)}throw new R.FlowError("passo desconhecido: " + at);`,
    "      }",
    "    }",
    '    return { stop: "end" };',
    "  };",
    "",
    ...(start ? [`  await walk(${q(start.id)}, false);`] : ['  throw new R.FlowError("o fluxo não tem um nó Start");']),
    ...resultCode(doc),
    "}",
    ...triggerSource(doc),
  );
  return L.join("\n") + "\n";
}

/* ───────── testes dos cenários ───────── */

function testSource(doc: Doc, file: string): string | undefined {
  const scenarios = doc.nodes.filter((n) => n.logic?.role === "scenario" && n.logic.examples?.length);
  if (!scenarios.length) return undefined;
  const calls = doc.nodes.filter((n) => n.logic?.role === "call" && n.logic.request);
  const L: string[] = [
    `// Testes gerados dos cenários de "${note(doc.title)}". Cada exemplo (Dado → Esperado) vira um teste: rode com \`npx tsx --test\`.`,
    'import assert from "node:assert/strict";',
    'import { test } from "node:test";',
    `import { run } from "./${file}";`,
    'import type { Deps } from "./runtime";',
    "",
    "const near = (a: unknown, b: unknown) => (typeof a === \"number\" && typeof b === \"number\" ? Math.abs(a - b) < 1e-9 : JSON.stringify(a) === JSON.stringify(b));",
    "",
  ];
  if (calls.length) {
    L.push("/** As chamadas HTTP respondem o `mock` de cada nó, sem rede. */", "const deps: Deps = {", "  http: {");
    for (const c of calls) L.push(`    ${q(c.id)}: () => ({ status: 200, ok: true, body: ${literal((c.logic!.mock ?? null) as LogicValue)} }), // ${note(c.label)}`);
    L.push("  },", "};", "");
  }
  for (const s of scenarios)
    for (const ex of s.logic!.examples!) {
      const { desfecho, ...rest } = ex.expect as Record<string, LogicValue>;
      L.push(`test(${q(`${s.label}: ${ex.name}`)}, async () => {`, `  const r = await run(${literal(ex.given)} as never${calls.length ? ", deps" : ""});`);
      if (desfecho !== undefined) L.push(`  assert.equal(r.outcome, ${q(String(desfecho))});`);
      for (const [k, v] of Object.entries(rest)) L.push(`  assert.ok(near(r.data[${q(k)}], ${literal(v)}), \`${k}: esperava \${JSON.stringify(${literal(v)})}, deu \${JSON.stringify(r.data[${q(k)}])}\`);`);
      L.push("});", "");
    }
  return L.join("\n");
}

/* ───────── entrada ───────── */

/** Gera o TypeScript executável de um diagrama de lógica. Devolve [] se o diagrama não for do modo Logic ou estiver vazio. */
export function generateLogicTypeScript(doc: Doc): GeneratedFile[] {
  if (docMode(doc) !== "logic" || !doc.nodes.some(isFlowNode)) return [];
  const dir = slug(doc.title);
  // o fluxo primeiro (é o que se lê), o runtime por último
  const files: GeneratedFile[] = [{ path: `${dir}/${dir}.ts`, content: flowSource(doc) }];
  const t = testSource(doc, dir);
  if (t) files.push({ path: `${dir}/${dir}.test.ts`, content: t });
  files.push({ path: `${dir}/runtime.ts`, content: RUNTIME_SOURCE });
  return files;
}
