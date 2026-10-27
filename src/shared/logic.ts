/**
 * Modo Logic: validação, execução do fluxo e dos exemplos, descrição para LLMs e guia do modo.
 *
 * O diagrama é um fluxo: Start → regras, decisões, escolhas, laços e caminhos paralelos → End, ligados por setas.
 * O app executa o fluxo com os dados de cada exemplo e confere o resultado. Sem setas entre os passos, a fila segue a `order`
 * das regras (modo simples, compatível com diagramas antigos).
 *
 * Só depende de `schema.ts`, `expr.ts` e dos tipos de `domain.ts` (ops.ts importa este módulo, nunca o contrário).
 * Determinístico: a mesma entrada produz sempre a mesma saída.
 */
import {
  CODE_RESULT_NAME,
  HTTP_RESPONSE_NAMES,
  isCallLike,
  LOGIC_BRANCHES,
  LOGIC_BRANCH_KEYS,
  LOGIC_HTTP_METHODS,
  LOGIC_TRIGGER_KINDS,
  LOGIC_ROLES,
  LOGIC_ROLE_KEYS,
  SCHEMA_VERSION,
  isDataRole,
  type ConnectionEl,
  type Doc,
  type LogicBranch,
  type LogicConnSpec,
  type LogicExample,
  type LogicNodeSpec,
  type LogicRole,
  type LogicValue,
  type NodeEl,
} from "./schema";
import { EvalError, ExprError, SYNTAX_GUIDE, checkExpr, evaluate, explain, explainStatement, firstConditional, hasConditional, parseExpr, parseStatement, print, readsOf, type Env, type Expr, type Statement, type Value } from "./expr";
import type { Issue } from "./domain";
import { checkValue, printType, recognize, type Type } from "./types";
import { checkAssignment } from "./typecheck";

/* ───────────────────────── validação de entrada das ops ───────────────────────── */

const KEY_RE = /^[\p{L}_][\p{L}\p{N}_]*(\.[\p{L}_][\p{L}\p{N}_]*)*$/u;

const isValue = (v: unknown): v is LogicValue =>
  v === null || ["string", "number", "boolean"].includes(typeof v) || (Array.isArray(v) && v.every(isValue)) || (typeof v === "object" && !Array.isArray(v) && Object.values(v as object).every(isValue));

function checkExample(e: unknown, i: number): string | undefined {
  if (!e || typeof e !== "object") return `logic.examples[${i}] deve ser { name, given, expect }`;
  const x = e as Record<string, unknown>;
  if (typeof x.name !== "string" || !x.name.trim()) return `logic.examples[${i}].name deve ser um texto (o nome do caso)`;
  if (x.path !== undefined && (!Array.isArray(x.path) || x.path.some((p) => typeof p !== "string"))) return `logic.examples[${i}].path deve ser uma lista de ids de passos`;
  for (const f of ["given", "expect"]) {
    const m = x[f];
    if (!m || typeof m !== "object" || Array.isArray(m)) return `logic.examples[${i}].${f} deve ser um objeto { dado: valor }`;
    for (const [k, v] of Object.entries(m)) if (!isValue(v)) return `logic.examples[${i}].${f}.${k} deve ser texto, número, lógico, vazio, lista ou objeto`;
  }
  return undefined;
}

/** O papel se chama «Ação» (`action`); `rule` é o nome antigo e continua sendo o que vai para o arquivo. Aceita os dois na entrada. */
export function normalizeLogicRole<T>(logic: T): T {
  const l = logic as { role?: unknown } | null | undefined;
  return l && typeof l === "object" && l.role === "action" ? ({ ...l, role: "rule" } as T) : logic;
}

/**
 * Arquivos antigos tinham «Só roda se» (`when`) dentro da Ação. Agora condição é da Decisão: cada Ação com guarda ganha uma
 * Decisão antes dela. Entradas passam a chegar na decisão; "sim" leva à Ação; "não" segue para onde a Ação seguia.
 * Ação sem nenhuma seta (fila por `order`) fica como está: não há onde encaixar a decisão.
 */
export function migrateRuleGuards(nodes: NodeEl[], connections: ConnectionEl[]): { nodes: NodeEl[]; connections: ConnectionEl[] } {
  const guarded = nodes.filter((n) => n.logic?.role === "rule" && n.logic.when);
  if (!guarded.length) return { nodes, connections };
  const outNodes = [...nodes];
  let conns = [...connections];
  const ids = new Set<string>([...nodes.map((n) => n.id), ...connections.map((c) => c.id)]);
  const fresh = (base: string) => {
    let id = base, i = 2;
    while (ids.has(id)) id = `${base}-${i++}`;
    ids.add(id);
    return id;
  };
  for (const r of guarded) {
    const ins = conns.filter((c) => c.to === r.id);
    const outs = conns.filter((c) => c.from === r.id);
    if (!ins.length && !outs.length) continue;
    const when = r.logic!.when!;
    const did = fresh(`${r.id}-condicao`);
    const question = `Roda «${r.label}»?`;
    const dec: NodeEl = {
      id: did, label: question, kind: "logic", ...(r.parent ? { parent: r.parent } : {}),
      logic: { role: "decision", when, text: `Só segue para «${r.label}» se a condição valer; senão pula a ação.` },
      ...(typeof r.x === "number" && typeof r.y === "number" ? { x: r.x - 280, y: r.y } : {}),
    } as NodeEl;
    outNodes.splice(outNodes.indexOf(r), 0, dec);
    const mk = (to: string, branch: "sim" | "nao", from = did, type = (ins[0] ?? outs[0]).type): ConnectionEl =>
      ({ id: fresh(`${from}-${branch}-${to}`), from, to, type, label: branch === "sim" ? "sim" : "não", routing: "straight", animated: true, logic: { branch } }) as ConnectionEl;
    conns = conns.map((c) => (c.to === r.id ? { ...c, to: did, id: fresh(`${c.from}-to-${did}`) } : c));
    conns.push(mk(r.id, "sim"));
    for (const o of outs) conns.push(mk(o.to, "nao"));
    const { when: _w, ...rest } = r.logic!;
    outNodes[outNodes.indexOf(r)] = { ...r, logic: rest };
  }
  return { nodes: outNodes, connections: conns };
}

/** A expressão só copia um dado de outro lugar (`x`, `item.preco`, `lista[0]`)? Copiar não faz do destino um resultado nem uma variável. */
const isCopy = (e: Expr): boolean => e.t === "id" || ((e.t === "field" || e.t === "idx") && isCopy(e.x));

/** Dados que algum passo escreve calculando (não só copiando de outro dado): só esses deixam de ser entrada. */
export function computedWrites(doc: Doc): Set<string> {
  const out = new Set<string>();
  for (const n of doc.nodes.filter(isFlowNode))
    for (const t of effectsOf(n.logic!)) {
      try {
        const st = parseStatement(t);
        if (st.t === "assign" && !isCopy(st.value)) out.add(st.name);
      } catch {
        /* a validação reporta */
      }
    }
  return out;
}

/**
 * O papel `fact` foi dividido em Input, Output e Variable. Arquivos antigos têm `fact`: cada um vira
 * - **input** se nenhuma ação o calcula (só entra, ou é copiado de outro dado, e é lido);
 * - **output** se algum passo o escreve e algum cenário o confere em `expect`, ou ninguém o lê depois (é o resultado);
 * - **variable** se algum passo o escreve e outro passo o lê no meio do fluxo.
 */
export function migrateFacts(nodes: NodeEl[], connections: ConnectionEl[], all = false): NodeEl[] {
  // `all`: reclassifica todo nó de dado pelo uso no fluxo (geradores de exemplo que declaram os dados sem se preocupar com o papel)
  const legacy = nodes.filter((n) => (all ? isDataRole(n.logic?.role) : (n.logic as { role?: string } | undefined)?.role === "fact"));
  if (!legacy.length) return nodes;
  const as = (n: NodeEl, role: LogicRole): NodeEl => ({ ...n, logic: { ...n.logic!, role } });
  const probe = { nodes: nodes.map((n) => (legacy.includes(n) ? as(n, "input") : n)), connections } as unknown as Doc;
  const writes = computedWrites(probe); // copiar `item.preco` para `preco` não o tira da condição de entrada
  const reads = new Set<string>();
  for (const u of usageOf(probe).values()) u.reads.forEach((r) => reads.add(r));
  const expected = new Set<string>();
  for (const n of nodes) if (n.logic?.role === "scenario") for (const ex of n.logic.examples ?? []) for (const k of Object.keys(ex.expect ?? {})) expected.add(k); // o resultado é o que os cenários conferem; o `expect` de uma ação só prova o passo
  const touches = (set: Set<string>, k: string) => [...set].some((r) => r === k || r.startsWith(k + ".") || k.startsWith(r + "."));
  return nodes.map((n) => {
    if (!legacy.includes(n)) return n;
    const k = dataKey(n);
    if (!touches(writes, k)) return as(n, "input");
    if (touches(expected, k) || !touches(reads, k)) return as(n, "output");
    return as(n, "variable");
  });
}

/** Posições dos efeitos de uma Ação (`x := …`) que têm «se … entao … senao» dentro. A Ação não tem condição: isso é da Decisão. */
export function conditionalEffects(l: LogicNodeSpec, field: "then" | "devolve" = "then"): number[] {
  const out: number[] = [];
  (l[field] ?? []).forEach((src, i) => {
    try {
      const s = parseStatement(src);
      if (s.t === "assign" && hasConditional(s.value)) out.push(i);
    } catch {
      /* a sintaxe é outra regra */
    }
  });
  return out;
}

type CondTree = { leaf: Expr } | { c: Expr; sim: CondTree; nao: CondTree };
const condTree = (e: Expr): CondTree => {
  const s = firstConditional(e);
  return s ? { c: s.c, sim: condTree(s.sim), nao: condTree(s.nao) } : { leaf: e };
};

/**
 * Tira de cada Ação o «se … entao … senao» de dentro dos efeitos: a condição vira uma Decisão (sim/não) e cada valor possível,
 * uma Ação com um efeito só. Os efeitos de antes e de depois ficam em Ações próprias, na mesma ordem. Os exemplos da Ação
 * original são refeitos nos novos passos (rodando o fluxo novo e conferindo que o resultado final é o mesmo de antes).
 * Se alguma Ação não puder ser convertida (sem nenhuma seta, ou um exemplo que mudaria de resultado), nada é alterado e o motivo vem em `failed`.
 */
export function liftRuleConditionals(input: Doc): { doc: Doc; lifted: string[]; failed: string[] } {
  const orig = structuredClone(input);
  const lifted: string[] = [];
  const failed: string[] = [];
  const roots = orig.nodes.filter((n) => n.logic?.role === "rule" && conditionalEffects(n.logic).length);
  if (!roots.length) return { doc: orig, lifted, failed };
  const names = dataNames(orig);
  const nameOf = (k: string) => names[k] ?? k.replace(/_/g, " ");
  const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

  // o que cada exemplo das Ações originais produzia (para conferir depois)
  const before = new Map<string, { ex: LogicExample; env: Record<string, LogicValue> }[]>();
  for (const r of roots) {
    const rows: { ex: LogicExample; env: Record<string, LogicValue> }[] = [];
    for (const ex of r.logic!.examples ?? []) {
      const run = runSingle(orig, r, ex.given);
      if (!run.steps.some((s) => s.error)) rows.push({ ex, env: run.env as Record<string, LogicValue> });
    }
    before.set(r.id, rows);
  }

  const doc = structuredClone(orig);
  const ids = new Set<string>([...doc.nodes.map((n) => n.id), ...doc.connections.map((c) => c.id)]);
  const fresh = (base: string) => {
    let id = base,
      i = 2;
    while (ids.has(id)) id = `${base}-${i++}`;
    ids.add(id);
    return id;
  };
  const family = new Map<string, { members: Set<string>; start: string }>();
  const owner = new Map<string, string>(); // nó novo -> raiz
  const skipped = new Set<string>();
  const queue = roots.map((r) => r.id);
  for (const r of roots) family.set(r.id, { members: new Set([r.id]), start: r.id });

  while (queue.length) {
    const rid = queue.shift()!;
    const R = doc.nodes.find((n) => n.id === rid);
    if (!R?.logic) continue;
    const root = owner.get(rid) ?? rid;
    if (skipped.has(root)) continue;
    const fam = family.get(root)!;
    const l = R.logic;
    const [k] = conditionalEffects(l);
    if (k === undefined) continue;
    const ins = doc.connections.filter((c) => c.to === R.id);
    const outs = doc.connections.filter((c) => c.from === R.id);
    const proto = ins[0] ?? outs[0];
    if (!proto) {
      skipped.add(root);
      failed.push(`${root}: a ação não tem nenhuma seta (fila por order): não há onde encaixar a decisão`);
      continue;
    }
    const st = parseStatement(l.then![k]) as Extract<Statement, { t: "assign" }>;
    const pre = l.then!.slice(0, k);
    const post = l.then!.slice(k + 1);
    const geo = { x: R.x, y: R.y, w: R.w, h: R.h };
    const mkEdge = (from: string, to: string, extra: Partial<ConnectionEl> = {}): ConnectionEl =>
      ({ id: fresh(`${from}-${extra.logic?.branch ?? "to"}-${to}`), from, to, type: proto.type, routing: "straight", animated: true, ...extra }) as ConnectionEl;
    const add = (n: NodeEl) => {
      doc.nodes.splice(doc.nodes.indexOf(R), 0, n);
      fam.members.add(n.id);
      owner.set(n.id, root);
    };

    doc.connections = doc.connections.filter((c) => c.from !== R.id);
    let tail: string | undefined;
    if (post.length) {
      tail = fresh(`${R.id}-depois`);
      doc.nodes.splice(doc.nodes.indexOf(R) + 1, 0, { id: tail, label: `${R.label} (depois)`, kind: "logic", ...(R.parent ? { parent: R.parent } : {}), logic: { role: "rule", text: l.text, then: post }, ...geo } as NodeEl);
      fam.members.add(tail);
      owner.set(tail, root);
      queue.push(tail);
      for (const o of outs) doc.connections.push({ ...o, id: fresh(`${tail}-to-${o.to}`), from: tail });
    }
    const attach = (leaf: string) => {
      if (tail) doc.connections.push(mkEdge(leaf, tail));
      else for (const o of outs) doc.connections.push({ ...o, id: fresh(`${leaf}-to-${o.to}`), from: leaf });
    };
    const build = (t: CondTree, path: string[] = []): string => {
      if ("leaf" in t) {
        const src = `${st.name} := ${print(t.leaf)}`;
        const id = fresh(`${R.id}-define-${st.name.replace(/[^A-Za-z0-9]+/g, "-")}`);
        add({ id, label: `Definir ${nameOf(st.name)}${path.length ? ` (${path.join(" › ")})` : ""}`, kind: "logic", ...(R.parent ? { parent: R.parent } : {}), logic: { role: "rule", text: explainStatement(parseStatement(src), names), then: [src] }, ...geo } as NodeEl);
        attach(id);
        return id;
      }
      const q = explain(t.c, names);
      const id = fresh(`${R.id}-se`);
      add({ id, label: `${cap(q)}?`.slice(0, 80), kind: "logic", ...(R.parent ? { parent: R.parent } : {}), logic: { role: "decision", when: print(t.c), text: `${cap(q)}?` }, ...geo } as NodeEl);
      const s = build(t.sim, [...path, "sim"]);
      const n = build(t.nao, [...path, "não"]);
      doc.connections.push(mkEdge(id, s, { label: "sim", logic: { branch: "sim" } }), mkEdge(id, n, { label: "não", logic: { branch: "nao" } }));
      return id;
    };
    const entry = build(condTree(st.value));
    if (pre.length) {
      R.logic = { ...l, then: pre };
      doc.connections.push(mkEdge(R.id, entry));
    } else {
      for (const c of ins) c.to = entry;
      doc.nodes.splice(doc.nodes.indexOf(R), 1);
      fam.members.delete(R.id);
      if (fam.start === R.id) fam.start = entry;
    }
  }

  // exemplos: refeitos nos passos novos, rodando o fluxo e conferindo o resultado final contra o de antes
  const dataRoots = (reads: Set<string>, env: Record<string, unknown>) => {
    const g: Record<string, LogicValue> = {};
    for (const r of reads) {
      const k = r in env ? r : r.split(".")[0];
      if (k in env) g[k] = env[k] as LogicValue;
    }
    return g;
  };
  for (const r of roots) {
    if (skipped.has(r.id)) continue;
    const fam = family.get(r.id)!;
    for (const id of fam.members) {
      const n = doc.nodes.find((x) => x.id === id);
      if (n?.logic) n.logic = { ...n.logic, examples: undefined };
    }
    const usage = usageOf(doc);
    let ok = true;
    const perNode = new Map<string, LogicExample[]>();
    for (const { ex, env: expected } of before.get(r.id) ?? []) {
      let cur: Record<string, LogicValue> = { ...ex.given };
      let at: string | undefined = fam.start;
      const mine: [string, LogicExample][] = [];
      let guard = 0;
      while (at && fam.members.has(at) && guard++ < 50) {
        const n = doc.nodes.find((x) => x.id === at)!;
        const given = dataRoots(usage.get(at)?.reads ?? new Set(), cur);
        if (n.logic!.role === "decision") {
          const run = runBranch(doc, n, { ...cur });
          if (run.steps.some((s) => s.error)) {
            ok = false;
            break;
          }
          mine.push([at, { name: ex.name, given, expect: { caminho: run.caminho as LogicValue } }]);
          at = exitsOf(doc, at).find((e) => e.branch === run.caminho)?.to.id;
        } else {
          const run = runSingle(doc, n, { ...cur });
          if (run.steps.some((s) => s.error)) {
            ok = false;
            break;
          }
          const changes = run.steps.flatMap((s) => s.changes);
          mine.push([at, { name: ex.name, given, expect: Object.fromEntries(changes.map((c) => [c.name, c.to as LogicValue])) }]);
          cur = run.env as Record<string, LogicValue>;
          at = exitsOf(doc, at)[0]?.to.id;
        }
      }
      if (ok) for (const k of Object.keys(ex.expect)) if (k !== "caminho" && k !== "desfecho" && !close(cur[k], expected[k])) ok = false;
      if (!ok) break;
      for (const [id, e] of mine) perNode.set(id, [...(perNode.get(id) ?? []), e]);
    }
    if (!ok) {
      failed.push(`${r.id}: um exemplo daria resultado diferente depois da conversão; ação não convertida`);
      skipped.add(r.id);
      continue;
    }
    for (const [id, list] of perNode) {
      const n = doc.nodes.find((x) => x.id === id)!;
      n.logic = { ...n.logic!, examples: list };
    }
    lifted.push(r.id);
  }
  if (skipped.size) return { doc: orig, lifted: [], failed: failed.length ? failed : ["conversão cancelada"] };
  return { doc, lifted, failed };
}

/** Valida `logic.request` de um Call: método e cada texto precisa ser uma expressão válida. */
function checkRequest(r: unknown): string | undefined {
  if (!r || typeof r !== "object" || Array.isArray(r)) return "logic.request deve ser um objeto { method, url, headers?, body? }";
  const d = r as Record<string, unknown>;
  for (const k of Object.keys(d)) if (!["method", "url", "headers", "body"].includes(k)) return `logic.request não tem o campo "${k}". Campos: method, url, headers, body`;
  if (!LOGIC_HTTP_METHODS.includes(d.method as never)) return `logic.request.method inválido "${String(d.method)}". Válidos: ${LOGIC_HTTP_METHODS.join(", ")}`;
  if (typeof d.url !== "string" || !d.url.trim()) return 'logic.request.url deve ser uma expressão com o endereço, ex.: "https://api.exemplo.com/clientes/" + cliente_id (texto fixo leva aspas)';
  const e = checkExpr(d.url);
  if (e) return `logic.request.url: ${e.message} (posição ${e.pos})`;
  for (const f of ["headers", "body"] as const) {
    if (d[f] === undefined) continue;
    if (!d[f] || typeof d[f] !== "object" || Array.isArray(d[f])) return `logic.request.${f} deve ser um objeto nome → expressão, ex.: { "valor": "total" }`;
    for (const [k, v] of Object.entries(d[f] as object)) {
      if (typeof v !== "string") return `logic.request.${f}.${k} deve ser uma expressão em texto`;
      const bad = checkExpr(v);
      if (bad) return `logic.request.${f}.${k}: ${bad.message} (posição ${bad.pos})`;
    }
  }
  if (d.body !== undefined && (d.method === "GET" || d.method === "DELETE") && Object.keys(d.body as object).length) return `uma chamada ${String(d.method)} não leva corpo: use POST, PUT ou PATCH, ou ponha os parâmetros no endereço`;
  return undefined;
}

/** Valida `logic.trigger` de um Start. */
export const CRON_RE = /^\s*(\S+\s+){4}\S+\s*$/;
function checkTrigger(t: unknown): string | undefined {
  if (!t || typeof t !== "object" || Array.isArray(t)) return "logic.trigger deve ser um objeto { kind, path?, method?, cron? }";
  const d = t as Record<string, unknown>;
  for (const k of Object.keys(d)) if (!["kind", "path", "method", "cron"].includes(k)) return `logic.trigger não tem o campo "${k}". Campos: kind, path, method, cron`;
  if (!Object.keys(LOGIC_TRIGGER_KINDS).includes(d.kind as string)) return `logic.trigger.kind inválido "${String(d.kind)}". Válidos: ${Object.keys(LOGIC_TRIGGER_KINDS).join(", ")}`;
  if (d.kind !== "webhook" && (d.path !== undefined || d.method !== undefined)) return `path e method são do gatilho webhook, não de ${String(d.kind)}`;
  if (d.kind !== "agenda" && d.cron !== undefined) return "cron é do gatilho agenda";
  if (d.kind === "webhook") {
    if (typeof d.path !== "string" || !/^\/[A-Za-z0-9_\-/:.]*$/.test(d.path)) return 'o webhook precisa de logic.trigger.path começando com "/", ex.: "/pedidos"';
    if (d.method !== undefined && !LOGIC_HTTP_METHODS.includes(d.method as never)) return `logic.trigger.method inválido "${String(d.method)}". Válidos: ${LOGIC_HTTP_METHODS.join(", ")}`;
  }
  if (d.kind === "agenda" && (typeof d.cron !== "string" || !CRON_RE.test(d.cron))) return 'a agenda precisa de logic.trigger.cron com 5 campos (minuto hora dia mês dia-da-semana), ex.: "0 8 * * 1-5"';
  return undefined;
}

/** Todas as expressões (texto) de um Call com request, para achar os dados que ele lê. */
export const requestExprs = (l: LogicNodeSpec): string[] => (l.request ? [l.request.url, ...Object.values(l.request.headers ?? {}), ...Object.values(l.request.body ?? {})] : []);

/** Dados que o próprio app cria: a resposta de cada chamada HTTP (`resposta`, `status_http`). */
export const builtinWrites = (doc: Doc): string[] => [...(doc.nodes.some((n) => n.logic?.role === "call" && n.logic.request) ? HTTP_RESPONSE_NAMES : []), ...(doc.nodes.some((n) => n.logic?.role === "code") ? [CODE_RESULT_NAME] : [])];

/** Valida o objeto `logic` de um nó. Devolve a mensagem de erro (acionável) ou undefined. */
export function checkLogicNode(logic: unknown): string | undefined {
  if (!logic || typeof logic !== "object") return "logic deve ser um objeto { role, ... }";
  const d = logic as Record<string, unknown>;
  const role = d.role as string;
  if (role === "fact") return 'o papel "fact" foi dividido em "input" (entra e só é lido), "output" (resultado que o fluxo devolve) e "variable" (intermediário do fluxo): escolha um deles';
  if (!LOGIC_ROLE_KEYS.includes(role as never)) return `logic.role inválido "${role}". Válidos: ${LOGIC_ROLE_KEYS.map((k) => (k === "rule" ? "action (ação; também aceito: rule)" : k)).join(", ")}`;
  const allowed = new Set<string>(["role", ...LOGIC_ROLES[role as keyof typeof LOGIC_ROLES].fields]);
  for (const k of Object.keys(d)) {
    if (d[k] === undefined) continue;
    if (k === "when" && role === "rule") continue; // legado: a guarda da Ação vira uma Decisão ao abrir o arquivo (migrateRuleGuards)
    if (!allowed.has(k)) return `campo "${k}" não existe no papel "${role}". Campos do papel: ${[...allowed].filter((f) => f !== "role").join(", ")}`;
  }
  if (d.order !== undefined && (typeof d.order !== "number" || !Number.isFinite(d.order))) return "logic.order deve ser um número (1, 2, 3…)";
  if (d.max !== undefined && (typeof d.max !== "number" || !Number.isInteger(d.max) || d.max < 1 || d.max > 1000)) return "logic.max deve ser um inteiro entre 1 e 1000";
  for (const f of ["text", "type"]) if (d[f] !== undefined && typeof d[f] !== "string") return `logic.${f} deve ser texto`;
  if (d.key !== undefined && (typeof d.key !== "string" || !KEY_RE.test(d.key))) return `logic.key deve ter só letras, números, "_" e pontos, sem espaço (ex.: preco_atual, categoria.margem)`;
  if (d.as !== undefined && (typeof d.as !== "string" || !KEY_RE.test(d.as))) return `logic.as deve ser um nome simples (ex.: produto)`;
  if (d.outcome !== undefined && d.outcome !== "ok" && d.outcome !== "erro") return 'logic.outcome deve ser "ok" ou "erro"';
  if (d.value !== undefined && !isValue(d.value)) return "logic.value deve ser texto, número, lógico, vazio ou lista";
  for (const f of ["when", "on", "until", "foreach", "falha"]) {
    if (d[f] === undefined) continue;
    if (typeof d[f] !== "string") return `logic.${f} deve ser texto (uma expressão)`;
    const e = checkExpr(d[f] as string);
    if (e) return `logic.${f}: ${e.message} (posição ${e.pos})`;
  }
  if (d.request !== undefined) {
    if (role !== "call") return "logic.request só existe no papel call";
    const bad = checkRequest(d.request);
    if (bad) return bad;
  }
  if (d.trigger !== undefined) {
    if (role !== "start") return "logic.trigger só existe no papel start";
    const bad = checkTrigger(d.trigger);
    if (bad) return bad;
  }
  if (d.code !== undefined) {
    if (role !== "code") return "logic.code só existe no papel code";
    if (typeof d.code !== "string" || !d.code.trim()) return "logic.code deve ser o corpo de uma função TypeScript em texto, ex.: \"return { total: data.itens.length };\"";
  }
  if (role === "code" && d.code === undefined) return "um nó code precisa de logic.code (o corpo da função TypeScript; data são os dados do fluxo e o return vira o dado resultado)";
  if (d.mock !== undefined && !isValue(d.mock)) return "logic.mock deve ser texto, número, lógico, vazio, lista ou objeto";
  if (d.mock !== undefined && d.request === undefined && role !== "code") return "logic.mock é a resposta simulada de uma chamada HTTP: informe também logic.request (ou use o papel code)";
  if (role === "loop" && d.until === undefined && d.max === undefined && d.foreach === undefined) return "um loop precisa de parada: informe logic.until, logic.max e/ou logic.foreach";
  if (role === "decision" && d.when === undefined) return 'uma decisão precisa de condição (logic.when), ex.: "preco < piso"';
  for (const field of role === "rule" ? (["then"] as const) : isCallLike(role) ? (["devolve"] as const) : [])
    for (const [i, s] of (Array.isArray(d[field]) ? (d[field] as unknown[]) : []).entries()) {
      if (typeof s !== "string") continue;
      try {
        const st = parseStatement(s);
        if (st.t === "assign" && hasConditional(st.value)) return `logic.${field}[${i}] "${s}": ${role === "rule" ? "a ação" : role === "code" ? "o código" : "a chamada"} não tem condição, e «se … entao … senao» dentro do efeito esconde o desvio. Coloque uma Decisão antes: "sim" leva a ${role === "rule" ? "uma ação" : "um passo"} com um valor e "não" a outra com o outro`;
      } catch {
        /* a sintaxe é conferida logo abaixo */
      }
    }
  for (const f of ["then", "devolve"] as const) {
    if (d[f] === undefined) continue;
    if (!Array.isArray(d[f]) || (d[f] as unknown[]).some((x) => typeof x !== "string")) return `logic.${f} deve ser uma lista de efeitos em texto (ex.: ["preco := max(preco, piso)", "travar preco"])`;
    for (const [i, s] of (d[f] as string[]).entries()) {
      const e = checkExpr(s, "statement");
      if (e) return `logic.${f}[${i}] "${s}": ${e.message} (posição ${e.pos})`;
    }
  }
  if (d.rows !== undefined || d.otherwise !== undefined) {
    const bad = checkTable(d.rows, d.otherwise);
    if (bad) return bad;
  }
  if (d.examples !== undefined) {
    if (!Array.isArray(d.examples)) return "logic.examples deve ser uma lista de { name, given, expect }";
    for (const [i, e] of (d.examples as unknown[]).entries()) {
      const bad = checkExample(e, i);
      if (bad) return bad;
    }
  }
  return undefined;
}

/** Linhas da tabela de decisão: condição válida, efeitos válidos e sem «se … entao … senao» (a linha já é o «se»). */
function checkTable(rows: unknown, otherwise: unknown): string | undefined {
  const effects = (list: unknown, where: string): string | undefined => {
    if (!Array.isArray(list) || list.some((x) => typeof x !== "string")) return `${where} deve ser uma lista de efeitos em texto (ex.: ["frete := 0"])`;
    for (const [i, src] of (list as string[]).entries()) {
      const e = checkExpr(src, "statement");
      if (e) return `${where}[${i}] "${src}": ${e.message} (posição ${e.pos})`;
      const st = parseStatement(src);
      if (st.t === "assign" && hasConditional(st.value)) return `${where}[${i}] "${src}": a linha da tabela já é o «se»; em vez de «se … entao … senao» no efeito, crie outra linha`;
    }
    return undefined;
  };
  if (rows !== undefined) {
    if (!Array.isArray(rows)) return "logic.rows deve ser uma lista de linhas { when, then, label? }";
    for (const [i, r] of (rows as unknown[]).entries()) {
      if (!r || typeof r !== "object" || Array.isArray(r)) return `logic.rows[${i}] deve ser { when, then, label? }`;
      const o = r as Record<string, unknown>;
      const extra = Object.keys(o).filter((k) => !["when", "then", "label"].includes(k));
      if (extra.length) return `logic.rows[${i}] não tem o campo "${extra[0]}"; a linha tem when, then e label`;
      if (typeof o.when !== "string" || !o.when.trim()) return `logic.rows[${i}].when é obrigatório: a condição da linha (ex.: "total >= 200")`;
      const e = checkExpr(o.when);
      if (e) return `logic.rows[${i}].when: ${e.message} (posição ${e.pos})`;
      if (o.label !== undefined && typeof o.label !== "string") return `logic.rows[${i}].label deve ser texto`;
      const bad = effects(o.then, `logic.rows[${i}].then`);
      if (bad) return bad;
    }
  }
  if (otherwise !== undefined) return effects(otherwise, "logic.otherwise");
  return undefined;
}

/** Valida a semântica de fluxo de uma seta (`logic: { branch?, case? }`). */
export function checkLogicConn(logic: unknown): string | undefined {
  if (!logic || typeof logic !== "object" || Array.isArray(logic)) return "logic deve ser um objeto { branch?, case? }";
  const d = logic as { branch?: unknown; case?: unknown };
  for (const k of Object.keys(d)) if (k !== "branch" && k !== "case") return `a seta não tem o campo "${k}". Campos: branch, case`;
  if (d.branch !== undefined && !LOGIC_BRANCH_KEYS.includes(d.branch as never)) return `logic.branch inválido "${String(d.branch)}". Válidos: ${LOGIC_BRANCH_KEYS.join(", ")}`;
  if (d.case !== undefined) {
    if (typeof d.case !== "string" || !d.case.trim()) return 'logic.case deve ser o valor do caso, ex.: "lucro" (com aspas), 3 ou verdadeiro';
    const e = checkExpr(d.case);
    if (e) return `logic.case: ${e.message}`;
    if (d.branch !== undefined) return "uma seta tem branch OU case, não os dois";
  }
  return undefined;
}

/** Rótulo da seta que sai de uma escolha por condições: a condição em português. */
export function caseLabel(doc: Doc, fromId: string, kase: string): string {
  const from = doc.nodes.find((n) => n.id === fromId);
  if (from?.logic?.role === "switch" && !from.logic.on) {
    try {
      const t = explain(parseExpr(kase), dataNames(doc), true);
      return t.length > 34 ? t.slice(0, 33) + "…" : t;
    } catch {
      return kase;
    }
  }
  return `= ${kase}`;
}

/** A saída com que nasce a próxima seta que sai de um passo Logic: decisão sim → não, laço repete → segue, escolha com um caso provisório a preencher, chamada com a 2ª seta «erro». */
export function nextExit(doc: Doc, from: string): LogicConnSpec | undefined {
  const node = doc.nodes.find((n) => n.id === from);
  const outs = doc.connections.filter((c) => c.from === from);
  const used = new Set(outs.map((c) => c.logic?.branch));
  switch (node?.logic?.role) {
    case "decision":
      return !used.has("sim") ? { branch: "sim" } : !used.has("nao") ? { branch: "nao" } : undefined;
    case "loop":
      return !used.has("repete") ? { branch: "repete" } : !used.has("segue") ? { branch: "segue" } : undefined;
    case "switch": {
      const n = outs.filter((c) => c.logic?.case !== undefined).length + 1;
      return { case: node.logic.on ? `"valor${n > 1 ? n : ""}"` : `condicao${n > 1 ? n : ""}` };
    }
    case "call":
    case "code":
      return outs.some((c) => c.logic?.branch !== "erro") && !used.has("erro") ? { branch: "erro" } : undefined;
  }
  return undefined;
}

/** Rótulo automático da seta a partir da saída que ela representa. */
export const branchLabel = (l: LogicConnSpec | undefined): string | undefined => (l?.case !== undefined ? `= ${l.case}` : l?.branch ? LOGIC_BRANCHES[l.branch].label : undefined);

/** Troca o papel de um nó mantendo só os campos que o novo papel aceita. */
export function reshapeLogic(old: LogicNodeSpec | undefined, role: LogicNodeSpec["role"]): LogicNodeSpec {
  const next: Record<string, unknown> = { role };
  for (const f of LOGIC_ROLES[role].fields) {
    const v = (old as unknown as Record<string, unknown> | undefined)?.[f];
    if (v !== undefined) next[f] = v;
  }
  if (role === "code" && next.code === undefined) next.code = "return {};";
  return next as unknown as LogicNodeSpec;
}

/* ───────────────────────── leitura do modelo ───────────────────────── */

const logicNodes = (doc: Doc, role?: LogicNodeSpec["role"]) => doc.nodes.filter((n) => n.logic && (!role || n.logic.role === role));
/** Os dados do diagrama: Input, Output e Variable. */
export const dataNodes = (doc: Doc) => doc.nodes.filter((n) => isDataRole(n.logic?.role));

/** Nome usado nas expressões: `key` do fato ou, na falta dele, o id com "_" no lugar de "-". */
export const dataKey = (n: NodeEl) => n.logic?.key ?? n.id.replace(/-/g, "_");

/** Efeitos de um passo: os `then` da Rule, os `devolve` do Call ou, na tabela, os de todas as linhas e do `otherwise`. */
export const effectsOf = (l: LogicNodeSpec): string[] => (l.role === "table" ? [...(l.rows ?? []).flatMap((r) => r.then), ...(l.otherwise ?? [])] : (isCallLike(l.role) ? l.devolve : l.then) ?? []);

/** Papéis que fazem parte do fluxo (os demais são dados e cenários). */
export const FLOW_ROLES: LogicRole[] = ["start", "end", "rule", "table", "decision", "switch", "loop", "fork", "join", "call", "code"];
export const isFlowNode = (n: NodeEl) => !!n.logic && FLOW_ROLES.includes(n.logic.role);

/** Setas entre passos do fluxo. */
export function flowEdges(doc: Doc): ConnectionEl[] {
  const flow = new Set(doc.nodes.filter(isFlowNode).map((n) => n.id));
  return doc.connections.filter((c) => flow.has(c.from) && flow.has(c.to));
}
export const hasFlow = (doc: Doc) => flowEdges(doc).length > 0;

/** Regras em ordem de execução (as sem `order` vão para o fim, na ordem do documento). */
export function pipelineRules(doc: Doc): NodeEl[] {
  return logicNodes(doc, "rule")
    .map((n, i) => ({ n, i }))
    .sort((a, b) => (a.n.logic!.order ?? Infinity) - (b.n.logic!.order ?? Infinity) || a.i - b.i)
    .map((x) => x.n);
}

/** A fila simples (sem setas): início, regras em ordem, fim. */
export function pipelineSequence(doc: Doc): NodeEl[] {
  return [...logicNodes(doc, "start").slice(0, 1), ...pipelineRules(doc), ...logicNodes(doc, "end").slice(0, 1)];
}

/** Nomes de negócio dos dados, para a explicação em português (usa o rótulo do fato). */
export function dataNames(doc: Doc): Record<string, string> {
  const m: Record<string, string> = {};
  for (const f of dataNodes(doc)) m[dataKey(f)] = f.label.toLowerCase();
  return m;
}

/** Saídas de um passo, com a saída que cada seta representa. */
export function exitsOf(doc: Doc, id: string): { edge: ConnectionEl; to: NodeEl; branch?: LogicBranch; case?: string }[] {
  return flowEdges(doc)
    .filter((c) => c.from === id)
    .map((edge) => ({ edge, to: doc.nodes.find((n) => n.id === edge.to)!, branch: edge.logic?.branch, case: edge.logic?.case }));
}

/* ───────────────────────── execução ───────────────────────── */

export interface Change {
  name: string;
  from: Value | undefined;
  to: Value;
}
export interface Step {
  rule: string;
  label: string;
  role: LogicRole;
  order?: number;
  /** regra: a condição de guarda valeu e os efeitos rodaram. Outros passos: sempre true */
  applied: boolean;
  changes: Change[];
  /** dados que a regra quis escrever, mas estavam travados */
  blocked: string[];
  locked: string[];
  /** decisão, escolha ou laço: por onde o fluxo saiu ("sim", "nao", "repete", "segue", "outros" ou o valor do caso) */
  branch?: string;
  /** laço: número da volta */
  turn?: number;
  error?: string;
  /** só com `trace`: os dados logo antes deste passo (a reprodução mostra o porquê e os valores de cada momento) */
  before?: Env;
}
export interface Run {
  env: Env;
  locked: string[];
  steps: Step[];
  /** fluxo: desfecho do fim alcançado */
  outcome?: "ok" | "erro";
  endId?: string;
}

const blank = (n: NodeEl): Step => ({ rule: n.id, label: n.label, role: n.logic!.role, order: n.logic!.order, applied: true, changes: [], blocked: [], locked: [] });

function blankStep(label: string): Step {
  return { rule: "", label, role: "start", applied: false, changes: [], blocked: [], locked: [] };
}

function fail(step: Step, e: unknown): Step {
  if (e instanceof ExprError || e instanceof EvalError) step.error = e.message;
  else throw e;
  return step;
}

/** Efeitos de uma regra: atribui, trava e destrava. */
function runEffects(l: LogicNodeSpec, env: Env, locked: Set<string>, step: Step, list = effectsOf(l)) {
  for (const src of list) {
    const s: Statement = parseStatement(src);
    if (s.t === "lock") {
      locked.add(s.name);
      step.locked.push(s.name);
    } else if (s.t === "unlock") locked.delete(s.name);
    else if (locked.has(s.name)) step.blocked.push(s.name);
    else {
      const to = evaluate(s.value, env);
      const from = s.name in env ? (env[s.name] as Value) : undefined;
      env[s.name] = to;
      step.changes.push({ name: s.name, from, to });
    }
  }
}

function runRule(rule: NodeEl, env: Env, locked: Set<string>): Step {
  const l = rule.logic!;
  const step = blank(rule);
  try {
    if (l.when !== undefined) {
      const w = evaluate(parseExpr(l.when), env);
      if (w !== true) {
        if (w !== false) throw new EvalError(`a condição precisa dar verdadeiro ou falso, mas deu ${JSON.stringify(w)}`);
        step.applied = false;
        return step;
      }
    }
    runEffects(l, env, locked, step);
  } catch (e) {
    fail(step, e);
  }
  return step;
}

/** Tabela de decisão: a primeira linha que vale aplica os efeitos dela; nenhuma, o `otherwise` (ou erro). `branch` diz qual linha valeu. */
function runTable(n: NodeEl, env: Env, locked: Set<string>): Step {
  const l = n.logic!;
  const step = blank(n);
  try {
    for (const [i, row] of (l.rows ?? []).entries()) {
      const w = evaluate(parseExpr(row.when), env);
      if (typeof w !== "boolean") throw new EvalError(`a condição da linha ${i + 1} (${row.when}) precisa dar verdadeiro ou falso, mas deu ${JSON.stringify(w)}`);
      if (!w) continue;
      step.branch = tableRowName(i);
      runEffects(l, env, locked, step, row.then);
      return step;
    }
    if (!l.otherwise) throw new EvalError(`nenhuma linha da tabela "${n.label}" valeu e ela não tem «senão» (otherwise)`);
    step.branch = TABLE_OTHERWISE;
    runEffects(l, env, locked, step, l.otherwise);
  } catch (e) {
    fail(step, e);
  }
  return step;
}
/** Nome da linha que valeu, como fica em `Step.branch` («linha 2»), e o do «senão». */
export const tableRowName = (i: number) => `linha ${i + 1}`;
export const TABLE_OTHERWISE = "senão";

/** Dados fixos declarados nos fatos (constantes), usados quando o exemplo não informa. */
function defaults(doc: Doc): Env {
  const env: Env = {};
  for (const f of dataNodes(doc)) if (f.logic!.value !== undefined) env[dataKey(f)] = f.logic!.value;
  return env;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Roda a fila simples (sem setas) com os dados de entrada: as regras por `order`. */
export function runPipeline(doc: Doc, given: Record<string, LogicValue>, opts: RunOptions = {}): Run {
  const env: Env = { ...defaults(doc), ...given };
  const locked = new Set<string>();
  const steps: Step[] = [];
  for (const r of pipelineRules(doc)) {
    const before = opts.trace ? snapshot(env) : undefined;
    const st = runRule(r, env, locked);
    if (before) st.before = before;
    steps.push(st);
    if (st.error) break;
  }
  return { env, locked: [...locked], steps };
}

/** Escolha: por valor (com `on`) ou por condições (sem `on`: a primeira que valer, na ordem das setas). */
function pickCase(n: NodeEl, outs: ReturnType<typeof exitsOf>, env: Env) {
  const cases = outs.filter((x) => x.case !== undefined);
  if (n.logic!.on) {
    const v = evaluate(parseExpr(n.logic!.on), env);
    return cases.find((x) => same(evaluate(parseExpr(x.case!), {}), v)) ?? outs.find((x) => x.branch === "outros");
  }
  return cases.find((x) => evaluate(parseExpr(x.case!), env) === true) ?? outs.find((x) => x.branch === "outros");
}
/** Nome da saída de uma escolha: o valor do caso (com `on`) ou a própria condição (sem `on`). */
const branchName = (l: LogicNodeSpec, kase: string) => (l.on ? String(safeEval(kase)) : kase);

const MAX_STEPS = 5000;

export interface RunOptions {
  /** guarda em cada passo os dados de antes dele (`Step.before`); custa uma cópia por passo, por isso só na reprodução */
  trace?: boolean;
}
const snapshot = (env: Env): Env => JSON.parse(JSON.stringify(env));

/** Roda o fluxo (Start → … → End) seguindo as setas, com os dados de entrada. */
export function runFlow(doc: Doc, given: Record<string, LogicValue>, opts: RunOptions = {}): Run {
  const env: Env = { ...defaults(doc), ...given };
  const locked = new Set<string>();
  const steps: Step[] = [];
  const run: Run = { env, locked: [], steps };
  const loops = new Map<string, { n: number; list?: Value[]; i: number }>();
  const byId = new Map(doc.nodes.map((n) => [n.id, n]));
  const start = logicNodes(doc, "start")[0];
  if (!start) {
    steps.push({ ...blankStep("(início)"), error: "o fluxo não tem um nó Start" });
    return run;
  }
  const pick = (id: string, test: (e: ReturnType<typeof exitsOf>[number]) => boolean) => exitsOf(doc, id).find(test);

  /** Anda a partir de `id` até um End (ou, num ramo paralelo, até um Join). Devolve onde parou. */
  const walk = (id: string, inBranch: boolean): { stop: "end" | "join" | "error"; at?: string } => {
    let cur: string | undefined = id;
    while (cur) {
      if (steps.length > MAX_STEPS) {
        steps.push({ ...blankStep("(limite)"), error: `mais de ${MAX_STEPS} passos: o fluxo parece não terminar` });
        return { stop: "error" };
      }
      const n: NodeEl = byId.get(cur)!;
      const l = n.logic!;
      const outs = exitsOf(doc, cur);
      const only = () => outs[0]?.to.id;
      const before = opts.trace ? snapshot(env) : undefined;
      const record = (st: Step) => {
        if (before) st.before = before;
        steps.push(st);
        return st;
      };
      switch (l.role) {
        case "start":
          record(blank(n));
          cur = only();
          break;
        case "call":
        case "code": {
          const st = record(blank(n));
          const created: readonly string[] = l.request ? HTTP_RESPONSE_NAMES : l.role === "code" ? [CODE_RESULT_NAME] : [];
          try {
            if (l.request) {
              env.resposta = (l.mock ?? null) as Value;
              env.status_http = 200;
            } else if (l.role === "code") env[CODE_RESULT_NAME] = (l.mock ?? null) as Value;
            const f = l.falha === undefined ? false : evaluate(parseExpr(l.falha), env);
            if (typeof f !== "boolean") throw new EvalError(`a condição de falha precisa dar verdadeiro ou falso, mas deu ${JSON.stringify(f)}`);
            if (f) {
              st.branch = "erro";
              for (const k of created) delete env[k];
              const e = pick(n.id, (x) => x.branch === "erro");
              if (!e) throw new EvalError(`a chamada "${n.label}" falhou (${l.falha}), mas falta a seta "erro" saindo dela`);
              cur = e.to.id;
            } else {
              runEffects(l, env, locked, st);
              for (const k of created) delete env[k];
              cur = pick(n.id, (x) => x.branch !== "erro")?.to.id;
            }
          } catch (e) {
            fail(st, e);
            return { stop: "error" };
          }
          break;
        }
        case "rule":
        case "table": {
          const st = record(l.role === "table" ? runTable(n, env, locked) : runRule(n, env, locked));
          if (st.error) return { stop: "error" };
          cur = only();
          break;
        }
        case "decision": {
          const st = record(blank(n));
          try {
            const w = evaluate(parseExpr(l.when!), env);
            if (typeof w !== "boolean") throw new EvalError(`a condição precisa dar verdadeiro ou falso, mas deu ${JSON.stringify(w)}`);
            st.branch = w ? "sim" : "nao";
            const e = pick(n.id, (x) => x.branch === st.branch);
            if (!e) throw new EvalError(`falta a seta "${w ? "sim" : "não"}" saindo de "${n.label}"`);
            cur = e.to.id;
          } catch (e) {
            fail(st, e);
            return { stop: "error" };
          }
          break;
        }
        case "switch": {
          const st = record(blank(n));
          try {
            const e = pickCase(n, outs, env);
            st.branch = e?.case !== undefined ? branchName(l, e.case) : "outros";
            if (!e) throw new EvalError(`nenhum caso vale em "${n.label}" e falta a seta "outros"`);
            cur = e.to.id;
          } catch (e) {
            fail(st, e);
            return { stop: "error" };
          }
          break;
        }
        case "loop": {
          const st = record(blank(n));
          try {
            let s = loops.get(n.id);
            if (!s) {
              s = { n: 0, i: 0 };
              loops.set(n.id, s);
              if (l.foreach) {
                const list = evaluate(parseExpr(l.foreach), env);
                if (!Array.isArray(list)) throw new EvalError(`"para cada" precisa de uma lista, mas deu ${JSON.stringify(list)}`);
                s.list = list;
              }
            }
            const stop = (l.foreach !== undefined && s.i >= s.list!.length) || (l.until !== undefined && evaluate(parseExpr(l.until), env) === true) || (l.max !== undefined && s.n >= l.max);
            const dir = stop ? "segue" : "repete";
            const e = pick(n.id, (x) => x.branch === dir);
            if (!e) throw new EvalError(`falta a seta "${dir}" saindo de "${n.label}"`);
            st.branch = dir;
            if (stop) loops.delete(n.id);
            else {
              s.n++;
              st.turn = s.n;
              if (l.foreach) env[l.as ?? "item"] = s.list![s.i++];
            }
            cur = e.to.id;
          } catch (e) {
            fail(st, e);
            return { stop: "error" };
          }
          break;
        }
        case "fork": {
          record(blank(n));
          let joinAt: string | undefined;
          for (const o of outs) {
            const r = walk(o.to.id, true);
            if (r.stop !== "join") return r; // erro, ou um ramo terminou o fluxo inteiro
            joinAt ??= r.at;
          }
          if (!joinAt) return { stop: "error" };
          const join = blank(byId.get(joinAt)!);
          if (opts.trace) join.before = snapshot(env); // depois dos ramos, não antes do fork
          steps.push(join);
          cur = exitsOf(doc, joinAt)[0]?.to.id;
          break;
        }
        case "join":
          if (inBranch) return { stop: "join", at: n.id };
          record(blank(n));
          cur = only();
          break;
        case "end": {
          record(blank(n));
          run.outcome = l.outcome ?? "ok";
          run.endId = n.id;
          return { stop: "end" };
        }
        default:
          cur = only();
      }
    }
    return { stop: "end" };
  };

  walk(start.id, false);
  run.locked = [...locked];
  return run;
}

/* ───────────────────────── linha do tempo das variáveis ───────────────────────── */

/** Uma alteração de uma variável: em que passo, por quem, de quanto para quanto. */
export interface VarEvent {
  /** posição do passo na execução (só passos de nós, como a reprodução numera) */
  step: number;
  nodeId: string;
  label: string;
  /** volta do laço mais próximo antes deste passo, se houver */
  turn?: number;
  from: Value | undefined;
  to: Value;
}
export interface VarTrack {
  name: string;
  /** valor antes da primeira alteração (undefined = a variável ainda não existia) */
  initial: Value | undefined;
  events: VarEvent[];
  final: Value;
  /** passos em que uma regra quis escrever a variável, mas ela estava travada */
  blockedAt: number[];
}

/** Todas as variáveis que mudaram na execução, cada uma com a lista ordenada de alterações (mais alteradas primeiro). */
export function variableTimeline(run: Run): VarTrack[] {
  const tracks = new Map<string, VarTrack>();
  let turn: number | undefined;
  run.steps
    .filter((s) => s.rule)
    .forEach((s, step) => {
      if (s.role === "loop") turn = s.branch === "repete" ? s.turn : undefined;
      for (const c of s.changes) {
        let t = tracks.get(c.name);
        if (!t) tracks.set(c.name, (t = { name: c.name, initial: c.from, events: [], final: c.to, blockedAt: [] }));
        t.events.push({ step, nodeId: s.rule, label: s.label, ...(turn !== undefined ? { turn } : {}), from: c.from, to: c.to });
        t.final = c.to;
      }
      for (const b of s.blocked) {
        let t = tracks.get(b);
        if (!t) tracks.set(b, (t = { name: b, initial: undefined, events: [], final: run.env[b] as Value, blockedAt: [] }));
        t.blockedAt.push(step);
      }
    });
  return [...tracks.values()].sort((a, b) => b.events.length - a.events.length || a.name.localeCompare(b.name));
}

/** Roda só uma regra (exemplos da própria regra). */
export function runSingle(doc: Doc, rule: NodeEl, given: Record<string, LogicValue>): Run {
  const env: Env = { ...defaults(doc), ...given };
  const locked = new Set<string>();
  const st = rule.logic!.role === "table" ? runTable(rule, env, locked) : runRule(rule, env, locked);
  return { env, locked: [...locked], steps: [st] };
}

/** Roda uma decisão ou escolha sozinha: devolve por onde ela sairia. */
function runBranch(doc: Doc, n: NodeEl, given: Record<string, LogicValue>): Run & { caminho?: string } {
  const env: Env = { ...defaults(doc), ...given };
  const st = blank(n);
  const out: Run & { caminho?: string } = { env, locked: [], steps: [st] };
  try {
    if (n.logic!.role === "decision") {
      const w = evaluate(parseExpr(n.logic!.when!), env);
      if (typeof w !== "boolean") throw new EvalError(`a condição precisa dar verdadeiro ou falso, mas deu ${JSON.stringify(w)}`);
      out.caminho = st.branch = w ? "sim" : "nao";
    } else {
      const hit = pickCase(n, exitsOf(doc, n.id), env);
      out.caminho = st.branch = hit?.case !== undefined ? branchName(n.logic!, hit.case) : "outros";
    }
  } catch (e) {
    fail(st, e);
  }
  return out;
}

const close = (a: unknown, b: unknown) => (typeof a === "number" && typeof b === "number" ? Math.abs(a - b) < 1e-9 : JSON.stringify(a) === JSON.stringify(b));
const show = (v: unknown) => (v === undefined ? "sem valor" : JSON.stringify(v));

export interface ExampleResult {
  node: string;
  example: string;
  ok: boolean;
  /** uma linha por divergência */
  problems: string[];
  run: Run;
}

/** Ids dos passos percorridos, na ordem (um id repetido é uma volta de laço). */
export const visitedIds = (run: Run): string[] => run.steps.filter((s) => s.rule).map((s) => s.rule);

/** Id da seta usada para ir do passo `k` ao passo `k+1` do percurso (undefined se não houver seta direta). */
export function edgeIdsOf(doc: Doc, run: Run): (string | undefined)[] {
  const steps = run.steps.filter((s) => s.rule);
  return steps.slice(0, -1).map((a, i) => {
    const b = steps[i + 1];
    const cands = flowEdges(doc).filter((e) => e.from === a.rule && e.to === b.rule);
    if (cands.length <= 1) return cands[0]?.id;
    return (cands.find((e) => (e.logic?.branch ?? "") === a.branch) ?? cands.find((e) => e.logic?.case !== undefined && a.branch !== undefined && (e.logic.case === a.branch || String(safeEval(e.logic.case)) === a.branch)) ?? cands[0]).id;
  });
}
const safeEval = (src: string) => {
  try {
    return evaluate(parseExpr(src), {});
  } catch {
    return undefined;
  }
};

/** Dados lidos e escritos por cada passo (chave do dado), para acoplar os dados ao fluxo. */
export function usageOf(doc: Doc): Map<string, { reads: Set<string>; writes: Set<string> }> {
  const m = new Map<string, { reads: Set<string>; writes: Set<string> }>();
  for (const n of doc.nodes.filter(isFlowNode)) {
    const u = { reads: new Set<string>(), writes: new Set<string>() };
    const l = n.logic!;
    try {
      for (const f of [l.when, l.on, l.until, l.foreach, l.falha, ...requestExprs(l), ...(l.rows ?? []).map((r) => r.when)]) if (f) readsOf(parseExpr(f), u.reads);
      if (l.role === "switch" && !l.on) for (const e of exitsOf(doc, n.id)) if (e.case) readsOf(parseExpr(e.case), u.reads);
      for (const t of effectsOf(l)) {
        const s = parseStatement(t);
        if (s.t === "assign") {
          readsOf(s.value, u.reads);
          u.writes.add(s.name);
        }
      }
    } catch {
      /* a validação reporta */
    }
    m.set(n.id, u);
  }
  return m;
}

/** Exemplo de cenário já com as entradas do fluxo (dados que nenhuma ação escreve) no valor padrão ou neutro pelo tipo; o usuário só ajusta os números. */
export function starterExample(doc: Doc, name = "caso 1"): LogicExample {
  const written = new Set<string>();
  for (const u of usageOf(doc).values()) for (const w of u.writes) written.add(w);
  const given: Record<string, LogicValue> = {};
  for (const f of doc.nodes.filter((n) => n.logic?.role === "input")) {
    const k = dataKey(f);
    if (written.has(k) || Object.keys(given).length >= 6) continue;
    const t = (f.logic!.type ?? "").toLowerCase();
    given[k] = f.logic!.value !== undefined ? f.logic!.value : /bool|sim|flag/.test(t) ? false : /texto|string|text/.test(t) ? "" : /lista|array/.test(t) ? [] : 0;
  }
  return { name, given, expect: { desfecho: "ok" } };
}

/** Os dados (nós Input, Output e Variable) que um passo usa, ou os passos que usam um dado. */
export function relatedTo(doc: Doc, id: string): Set<string> {
  const out = new Set<string>();
  const n = doc.nodes.find((x) => x.id === id);
  if (!n?.logic) return out;
  const use = usageOf(doc);
  const facts = dataNodes(doc);
  const touches = (keys: Set<string>, k: string) => [...keys].some((r) => r === k || r.startsWith(k + "."));
  if (isDataRole(n.logic.role)) {
    const k = dataKey(n);
    for (const [sid, u] of use) if (touches(u.reads, k) || touches(u.writes, k)) out.add(sid);
  } else {
    const u = use.get(id);
    if (u) for (const f of facts) if (touches(u.reads, dataKey(f)) || touches(u.writes, dataKey(f))) out.add(f.id);
  }
  return out;
}

/** Grava o caminho percorrido (e o desfecho) de cada exemplo de cenário a partir da execução atual. */
export function recordPaths(doc: Doc): Doc {
  const out = structuredClone(doc);
  for (const n of out.nodes.filter((x) => x.logic?.role === "scenario"))
    for (const ex of n.logic!.examples ?? []) ex.path = visitedIds(hasFlow(out) ? runFlow(out, ex.given) : runPipeline(out, ex.given));
  return out;
}

/** Roda todos os exemplos do documento e confere o esperado. */
/**
 * O que o passo (ou o fluxo, no cenário) PRODUZIU num exemplo: os dados que escreveu, o caminho (decisão/escolha) e o desfecho.
 * Serve para ver a saída sem ter de adivinhar o «Esperado», e para gravá-la como esperado.
 */
export function outputOf(doc: Doc, r: ExampleResult): { values: Record<string, LogicValue>; note?: string } | undefined {
  if (r.run.steps.some((s) => s.error)) return undefined; // o erro já é a mensagem do exemplo
  const role = doc.nodes.find((n) => n.id === r.node)?.logic?.role;
  const values: Record<string, LogicValue> = {};
  if (role === "decision" || role === "switch") {
    const c = (r.run as Run & { caminho?: string }).caminho;
    if (c !== undefined) values.caminho = c;
    return { values };
  }
  for (const s of r.run.steps) for (const c of s.changes) values[c.name] = c.to as LogicValue;
  if (role === "scenario" && r.run.outcome) values.desfecho = r.run.outcome;
  if (role === "rule" && r.run.steps[0] && !r.run.steps[0].applied) return { values, note: "A condição «Quando vale» não valeu com estes dados: a ação não mudou nada." };
  return { values };
}

export function checkExamples(doc: Doc): ExampleResult[] {
  const out: ExampleResult[] = [];
  const flow = hasFlow(doc);
  const check = (n: NodeEl, ex: LogicExample, run: Run & { caminho?: string }) => {
    const problems: string[] = [];
    const err = run.steps.find((s) => s.error);
    if (err) problems.push(`erro em "${err.label}": ${err.error}`);
    else
      for (const [k, want] of Object.entries(ex.expect)) {
        if (k === "caminho") {
          if (!close(run.caminho, want)) problems.push(`caminho: esperava ${show(want)}, saiu por ${show(run.caminho)}`);
          continue;
        }
        if (k === "desfecho") {
          if (!close(run.outcome, want)) problems.push(`desfecho: esperava ${show(want)}, deu ${show(run.outcome)}`);
          continue;
        }
        const got = k in run.env ? run.env[k] : undefined;
        if (!close(got, want)) problems.push(`${k}: esperava ${show(want)}, deu ${show(got)}`);
      }
    if (!err && ex.path) {
      const got = visitedIds(run);
      const at = ex.path.findIndex((id, i) => got[i] !== id);
      if (at >= 0 || got.length !== ex.path.length) {
        const label = (id?: string) => (id ? doc.nodes.find((x) => x.id === id)?.label ?? id : "o fim do fluxo");
        const k = at >= 0 ? at : Math.min(got.length, ex.path.length);
        problems.push(`caminho diferente no passo ${k + 1}: esperava "${label(ex.path[k])}", foi por "${label(got[k])}"`);
      }
    }
    out.push({ node: n.id, example: ex.name, ok: problems.length === 0, problems, run });
  };
  for (const n of logicNodes(doc)) {
    const l = n.logic!;
    if (l.role === "rule" || l.role === "table") for (const ex of l.examples ?? []) check(n, ex, runSingle(doc, n, ex.given));
    else if (l.role === "decision" || l.role === "switch") for (const ex of l.examples ?? []) check(n, ex, runBranch(doc, n, ex.given));
    else if (l.role === "scenario") for (const ex of l.examples ?? []) check(n, ex, flow ? runFlow(doc, ex.given) : runPipeline(doc, ex.given));
  }
  return out;
}

/** Situação de cada passo com exemplos, para o quadro: ok, fail ou none (sem exemplo). */
export function logicStatus(doc: Doc): Map<string, "ok" | "fail" | "none"> {
  const m = new Map<string, "ok" | "fail" | "none">();
  for (const n of logicNodes(doc)) if (["rule", "table", "decision", "switch", "scenario"].includes(n.logic!.role)) m.set(n.id, "none");
  for (const r of checkExamples(doc)) m.set(r.node, r.ok && m.get(r.node) !== "fail" ? "ok" : "fail");
  return m;
}

/* ───────────────────────── regras de validação (L*) ───────────────────────── */

/** Dados lidos por todas as expressões de um nó. */
function readsOfNode(n: NodeEl): Set<string> {
  const l = n.logic!;
  const out = new Set<string>();
  for (const f of [l.when, l.on, l.until, l.foreach, l.falha, ...requestExprs(l), ...(l.rows ?? []).map((r) => r.when)]) if (f) readsOf(parseExpr(f), out);
  for (const t of effectsOf(l)) {
    const s = parseStatement(t);
    if (s.t === "assign") readsOf(s.value, out);
  }
  return out;
}

export function logicIssues(doc: Doc): Issue[] {
  const issues: Issue[] = [];
  const add = (rule: string, severity: Issue["severity"], target: string | undefined, message: string) => issues.push({ rule, severity, target, message });
  const facts = dataNodes(doc);
  const steps = doc.nodes.filter(isFlowNode);
  const rules = logicNodes(doc, "rule");
  const flow = hasFlow(doc);
  const keys = new Map<string, NodeEl[]>();
  for (const f of facts) keys.set(dataKey(f), [...(keys.get(dataKey(f)) ?? []), f]);
  for (const [k, list] of keys) if (list.length > 1) for (const f of list) add("L011", "erro", f.id, `o dado "${k}" está declarado ${list.length} vezes (${list.map((x) => x.label).join(", ")}); cada nome vale para um só`);

  const declared = (name: string) => keys.has(name) || [...keys.keys()].some((k) => name.startsWith(k + ".") || k.startsWith(name + "."));
  const written = new Set<string>();
  const builtins = new Set(builtinWrites(doc));
  const readSet = new Set<string>();
  const loopVars = new Set(logicNodes(doc, "loop").filter((n) => n.logic!.foreach).map((n) => n.logic!.as ?? "item"));
  for (const r of steps)
    for (const src of effectsOf(r.logic!)) {
      try {
        const st = parseStatement(src);
        if (st.t === "assign") written.add(st.name);
      } catch {
        /* reportado como L001 abaixo */
      }
    }

  for (const n of steps) {
    const l = n.logic!;
    const where = `${LOGIC_ROLES[l.role].label.toLowerCase()} "${n.label}"`;
    let reads: Set<string> | undefined;
    try {
      reads = readsOfNode(n);
    } catch (e) {
      add("L001", "erro", n.id, `${where}: expressão inválida (${(e as Error).message})`);
    }
    if (reads && l.role === "switch" && !l.on)
      for (const e of exitsOf(doc, n.id))
        if (e.case)
          try {
            readsOf(parseExpr(e.case), reads);
          } catch {
            add("L001", "erro", e.edge.id, `condição inválida na seta "${e.case}"`);
          }
    if (reads)
      for (const r of reads) {
        readSet.add(r);
        if (!declared(r) && !written.has(r) && !loopVars.has(r.split(".")[0]) && !builtins.has(r.split(".")[0])) add("L002", "aviso", n.id, `${where} lê "${r}", que não é um dado declarado nem escrito por outra ação`);
      }
    if (l.role === "rule" || l.role === "table" || isCallLike(l.role))
      for (const src of effectsOf(l)) {
        try {
          const s = parseStatement(src);
          if (s.t === "assign" && !declared(s.name)) add("L007", "aviso", n.id, `${where} escreve "${s.name}", que não é um dado declarado; crie um nó Variable (ou Output, se for o resultado) com key "${s.name}"`);
          else if (s.t !== "assign") readSet.add(s.name);
        } catch {
          /* L001 acima */
        }
      }
    if (l.role === "table" && !(l.rows ?? []).length) add("L038", "erro", n.id, `a tabela ${where} não tem linhas: cada linha tem uma condição (when) e os efeitos (then) que valem quando ela é a primeira verdadeira`);
    if (l.role === "table" && (l.rows ?? []).length && !l.otherwise) add("L039", "dica", n.id, `a tabela ${where} não tem «senão» (otherwise): se nenhuma linha valer, o fluxo para com erro. Se isso não pode acontecer, tudo bem; senão, diga o que vale no resto`);
    if ((l.role === "rule" || l.role === "table" || l.role === "decision" || l.role === "switch") && !(l.examples ?? []).length) add("L003", l.role === "rule" || l.role === "table" ? "aviso" : "dica", n.id, `${where} sem exemplo: sem um caso concreto ninguém confere se está certo`);
    if (l.role === "rule" && !l.text?.trim()) add("L008", "dica", n.id, `${where} sem frase de negócio (campo "text"); a explicação automática cobre, mas a frase do negócio é melhor`);
    if (l.role === "rule") for (const i of conditionalEffects(l)) add("L028", "erro", n.id, `${where}: o efeito ${i + 1} (${l.then![i]}) tem «se … entao … senao» dentro, e a ação não tem condição. Coloque uma Decisão antes: "sim" leva a uma ação com um valor e "não" a outra com o outro`);
    if (isCallLike(l.role)) for (const i of conditionalEffects(l, "devolve")) add("L028", "erro", n.id, `${where}: o efeito ${i + 1} de devolve (${l.devolve![i]}) tem «se … entao … senao» dentro, e a chamada não tem condição. Coloque uma Decisão depois dela`);
    if (!flow && l.role === "rule" && l.order === undefined) add("L005", "aviso", n.id, `${where} sem ordem na fila (logic.order)`);
  }
  if (!flow) {
    const byOrder = new Map<number, NodeEl[]>();
    for (const r of rules) if (r.logic!.order !== undefined) byOrder.set(r.logic!.order, [...(byOrder.get(r.logic!.order) ?? []), r]);
    for (const [o, list] of byOrder) if (list.length > 1) for (const r of list) add("L005", "aviso", r.id, `${list.length} ações com a mesma ordem (${o}): a ordem do documento decide, o que é frágil`);
  }

  const writtenK = (k: string) => [...written].some((w) => w === k || w.startsWith(k + ".") || k.startsWith(w + "."));
  const computed = computedWrites(doc);
  const computedK = (k: string) => [...computed].some((w) => w === k || w.startsWith(k + ".") || k.startsWith(w + "."));
  for (const f of facts) {
    const k = dataKey(f);
    const role = f.logic!.role;
    if (role === "input" && computedK(k)) add("L029", "aviso", f.id, `a entrada "${f.label}" (${k}) é calculada por uma ação, mas entrada só é lida (copiar de outro dado vale): troque o papel para Variable (se é intermediário) ou Output (se é o resultado)`);
    if (role === "output" && !writtenK(k) && steps.length) add("L030", "aviso", f.id, `o resultado "${f.label}" (${k}) nunca é escrito por nenhuma ação: o fluxo não o calcula (se ele só entra, troque o papel para Input)`);
    if (role === "variable" && !writtenK(k) && f.logic!.value === undefined && steps.length) add("L031", "aviso", f.id, `a variável "${f.label}" (${k}) nunca recebe valor (nenhuma ação a escreve e não tem valor inicial): se ela vem de fora, troque o papel para Input`);
    if (![...readSet].some((n) => n === k || n.startsWith(k + ".") || k.startsWith(n + ".")) && !written.has(k)) add("L006", "aviso", f.id, `o dado "${f.label}" (${k}) não é lido nem escrito por nenhum passo`);
  }

  /* ── estrutura do fluxo ── */
  if (steps.length) {
    const starts = logicNodes(doc, "start");
    const ends = logicNodes(doc, "end");
    if (!starts.length) add("L012", flow ? "aviso" : "dica", undefined, "o fluxo não tem ponto de início: adicione um nó Start (o que entra e quando a lógica começa)");
    if (!ends.length) add("L013", flow ? "aviso" : "dica", undefined, "o fluxo não tem ponto de fim: adicione um nó End (o que a lógica devolve)");
    if (starts.length > 1) for (const n of starts) add("L014", "aviso", n.id, `há ${starts.length} pontos de início; o fluxo tem um só`);
  }
  if (flow) {
    const edges = flowEdges(doc);
    const out = (id: string) => edges.filter((e) => e.from === id);
    const inn = (id: string) => edges.filter((e) => e.to === id);
    for (const e of edges) {
      const from = doc.nodes.find((n) => n.id === e.from)!;
      const role = from.logic!.role;
      const b = e.logic?.branch;
      if (b && !LOGIC_BRANCHES[b].from.includes(role)) add("L023", "erro", e.id, `a saída "${LOGIC_BRANCHES[b].label}" só existe em ${LOGIC_BRANCHES[b].from.join(" / ")}; "${from.label}" é ${role}`);
      if (e.logic?.case !== undefined && role !== "switch") add("L023", "erro", e.id, `"case" só existe em setas que saem de uma escolha (switch); "${from.label}" é ${role}`);
    }
    for (const n of steps) {
      const l = n.logic!;
      const o = out(n.id);
      const i = inn(n.id);
      const where = `"${n.label}"`;
      const count = (b: LogicBranch) => o.filter((e) => e.logic?.branch === b).length;
      if (l.role !== "end" && !o.length) add("L020", "erro", n.id, `${where} é um beco sem saída: ligue a próxima etapa ou termine em um nó End`);
      if (l.role === "end" && o.length) add("L020", "erro", n.id, `${where} é um fim e não pode ter setas de saída`);
      if (l.role !== "start" && !i.length) add("L019", "aviso", n.id, `${where} não tem nenhuma seta de entrada: o fluxo nunca chega nele`);
      if (l.role === "decision") {
        for (const b of ["sim", "nao"] as const) if (count(b) !== 1) add("L015", "erro", n.id, `a decisão ${where} precisa de exatamente uma seta "${b === "sim" ? "sim" : "não"}" (tem ${count(b)})`);
        if (o.some((e) => !e.logic?.branch)) add("L015", "erro", n.id, `toda seta que sai da decisão ${where} precisa dizer "sim" ou "não"`);
      }
      if (l.role === "switch") {
        if (!o.some((e) => e.logic?.branch === "outros")) add("L016", "aviso", n.id, `a escolha ${where} não tem a seta "outros": um valor sem caso para o fluxo`);
        if (o.some((e) => e.logic?.case === undefined && e.logic?.branch !== "outros")) add("L016", "erro", n.id, `toda seta que sai da escolha ${where} precisa de um valor (case) ou ser "outros"`);
        const seen = new Set<string>();
        for (const c of o.filter((e) => e.logic?.case !== undefined)) {
          if (seen.has(c.logic!.case!)) add("L016", "erro", c.id, `o valor ${c.logic!.case} aparece em mais de uma seta da escolha ${where}`);
          seen.add(c.logic!.case!);
        }
      }
      if (l.role === "loop") for (const b of ["repete", "segue"] as const) if (count(b) !== 1) add("L017", "erro", n.id, `o loop ${where} precisa de exatamente uma seta "${b}" (tem ${count(b)})`);
      if (l.role === "fork" && o.length < 2) add("L018", "erro", n.id, `o paralelo ${where} precisa de 2 ou mais saídas`);
      if (l.role === "join" && i.length < 2) add("L018", "aviso", n.id, `a junção ${where} espera 2 ou mais caminhos, mas recebe ${i.length}`);
      if (l.role === "code" && l.mock === undefined) add("L033", "dica", n.id, `o código ${where} não tem resultado simulado (mock): o app não executa TypeScript, então nos exemplos "resultado" fica vazio e os efeitos que o leem dão erro. Informe o objeto que o código devolveria`);
      if (isCallLike(l.role) && count("erro") > 1) add("L025", "erro", n.id, `a chamada ${where} tem ${count("erro")} setas "erro": só pode haver uma`);
      if (isCallLike(l.role) && l.falha !== undefined && !count("erro")) add("L025", "aviso", n.id, `a chamada ${where} pode falhar (${l.falha}), mas não tem a seta "erro": ligue o que acontece quando falha`);
      if (l.role === "call" && l.request && l.mock === undefined) add("L032", "dica", n.id, `a chamada HTTP ${where} não tem resposta simulada (mock): nos exemplos, "resposta" fica vazia e os efeitos que a leem dão erro. Informe um corpo de exemplo, como o que a API devolve`);
      if (isCallLike(l.role) && l.falha === undefined && l.role !== "code" && count("erro")) add("L025", "dica", n.id, `a chamada ${where} tem seta "erro", mas nenhum exemplo a faz falhar: preencha "Falha simulada quando" para poder testar esse caminho`);
      if (["rule", "table", "start", "call", "code", "join"].includes(l.role) && o.filter((e) => e.logic?.branch !== "erro").length > 1) add("L024", "aviso", n.id, `${where} tem ${o.length} saídas sem decisão: o fluxo não sabe qual seguir (use uma decisão, escolha ou paralelo)`);
    }
    // paralelo: o app simula os ramos um depois do outro, na ordem das setas, sobre os mesmos dados; ramos que se tocam dão resultado que depende da ordem
    const use = usageOf(doc);
    for (const f of logicNodes(doc, "fork")) {
      const perBranch = exitsOf(doc, f.id).map((x) => {
        const seen = new Set<string>();
        const writes = new Set<string>();
        const reads = new Set<string>();
        const todo = [x.to.id];
        while (todo.length) {
          const id = todo.pop()!;
          const nd = doc.nodes.find((q) => q.id === id);
          if (!nd || seen.has(id) || nd.logic?.role === "join") continue;
          seen.add(id);
          const u = use.get(id);
          u?.writes.forEach((w) => writes.add(w));
          u?.reads.forEach((r) => reads.add(r));
          todo.push(...exitsOf(doc, id).map((e) => e.to.id));
        }
        return { writes, reads };
      });
      const clash = new Set<string>();
      perBranch.forEach((a, i) => perBranch.forEach((b, j) => {
        if (i === j) return;
        for (const w of a.writes) if (b.writes.has(w) || b.reads.has(w)) clash.add(w);
      }));
      if (clash.size) add("L027", "aviso", f.id, `o paralelo "${f.label}" tem ramos que escrevem ou leem o mesmo dado (${[...clash].join(", ")}): os ramos rodam na ordem das setas, sobre os mesmos dados, então o resultado depende dessa ordem. Separe os dados de cada ramo ou ligue os passos em sequência`);
    }
    // alcançabilidade e ciclos
    const start = logicNodes(doc, "start")[0];
    if (start) {
      const seen = new Set<string>([start.id]);
      const queue = [start.id];
      while (queue.length) for (const e of out(queue.shift()!)) if (!seen.has(e.to)) (seen.add(e.to), queue.push(e.to));
      for (const n of steps) if (!seen.has(n.id) && inn(n.id).length) add("L019", "aviso", n.id, `"${n.label}" não é alcançável a partir do início`);
    }
    const color = new Map<string, number>();
    const cyc = new Set<string>();
    const dfs = (id: string) => {
      color.set(id, 1);
      for (const e of out(id)) {
        const c = color.get(e.to) ?? 0;
        if (c === 1) {
          if (doc.nodes.find((n) => n.id === e.to)?.logic?.role !== "loop") cyc.add(e.id); // a volta ao loop é permitida
        } else if (c === 0) dfs(e.to);
      }
      color.set(id, 2);
    };
    for (const n of steps) if (!color.get(n.id)) dfs(n.id);
    for (const id of cyc) add("L021", "erro", id, 'esta seta fecha um ciclo sem passar por um loop: o fluxo pode não terminar nunca (use um nó Loop com a saída "repete")');
  }

  for (const r of checkExamples(doc)) {
    if (!r.ok) {
      const n = doc.nodes.find((x) => x.id === r.node)!;
      add("L004", "erro", n.id, `exemplo "${r.example}" de "${n.label}" não bate: ${r.problems.join("; ")}`);
    }
  }
  for (const n of doc.nodes) if (n.kind === "logic" && !n.logic) add("BASE", "erro", n.id, `${n.id}: nó "logic" sem logic.role`);
  issues.push(...typeIssues(doc));
  return issues;
}

/** Troca um nome inteiro dentro de um texto de expressão (não mexe em pedaços de outros nomes nem em texto entre aspas). */
export function renameName(text: string, from: string, to: string): string {
  // texto entre aspas e nomes (com pontos) são «palavras»; só a palavra igual a `from` é trocada
  return text.replace(/"(?:[^"\\]|\\.)*"|[\p{L}_][\p{L}\p{N}_]*(?:\.[\p{L}_][\p{L}\p{N}_]*)*/gu, (m) => (m === from ? to : m));
}

const editDistance = (a: string, b: string): number => {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)] as number[]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
};

/**
 * Nomes que uma expressão lê e que não existem no diagrama (nem como dado, nem escritos por algum passo, nem variável de laço),
 * cada um com o nome parecido que a pessoa provavelmente quis digitar. Mesma regra do aviso L002, mas dita onde se digita.
 */
export function nameProblems(doc: Doc, reads: Iterable<string>): { name: string; suggestion?: string }[] {
  const keys = new Set(dataNodes(doc).map(dataKey));
  const written = new Set<string>();
  const builtins = new Set(builtinWrites(doc));
  for (const n of doc.nodes.filter(isFlowNode)) for (const t of effectsOf(n.logic!)) {
    try {
      const st = parseStatement(t);
      if (st.t === "assign") written.add(st.name);
    } catch {
      /* a validação reporta */
    }
  }
  const loopVars = new Set(logicNodes(doc, "loop").filter((n) => n.logic!.foreach).map((n) => n.logic!.as ?? "item"));
  const known = (name: string) => keys.has(name) || [...keys].some((k) => name.startsWith(k + ".") || k.startsWith(name + ".")) || written.has(name) || loopVars.has(name.split(".")[0]) || builtins.has(name.split(".")[0]);
  const candidates = [...new Set([...keys, ...written, ...loopVars])];
  const out: { name: string; suggestion?: string }[] = [];
  for (const name of new Set(reads)) {
    if (known(name)) continue;
    let best: string | undefined;
    let bestD = Infinity;
    for (const c of candidates) {
      const dist = editDistance(name.toLowerCase(), c.toLowerCase());
      if (dist < bestD) (bestD = dist), (best = c);
    }
    out.push({ name, suggestion: best && bestD <= 2 && bestD < Math.max(2, name.length - 1) ? best : undefined });
  }
  return out;
}

/** O tipo declarado de cada dado (só os escritos em sintaxe de tipo; rótulos antigos não entram). */
export function dataTypeOf(doc: Doc): (name: string) => Type | undefined {
  const m = new Map<string, Type>();
  for (const f of dataNodes(doc)) {
    const r = recognize(f.logic!.type);
    if (r && r.ok) m.set(dataKey(f), r.type);
  }
  return (name) => m.get(name);
}

/** L026 (aviso): tipo mal escrito, valor fixo fora do tipo e exemplos (Dado/Esperado) que não batem com o tipo do dado. */
export function typeIssues(doc: Doc): Issue[] {
  const out: Issue[] = [];
  const types = new Map<string, { type: Type; text: string }>();
  for (const f of dataNodes(doc)) {
    const r = recognize(f.logic!.type);
    if (!r) continue;
    if (!r.ok) {
      if (!r.legacy) out.push({ rule: "L026", severity: "aviso", target: f.id, message: `o tipo "${f.logic!.type}" do dado "${f.label}" não é um tipo válido: ${r.error}` });
      continue;
    }
    types.set(dataKey(f), { type: r.type, text: printType(r.type) });
    if (f.logic!.value !== undefined) for (const p of checkValue(r.type, f.logic!.value, dataKey(f))) out.push({ rule: "L026", severity: "aviso", target: f.id, message: `valor fixo de "${f.label}": ${p}` });
  }
  if (!types.size) return out;
  // efeitos que dão ao dado um valor de tipo incompatível (`total := "abc"` com `total` number)
  const typeOf = (name: string) => types.get(name)?.type;
  for (const n of doc.nodes.filter(isFlowNode)) for (const src of effectsOf(n.logic!)) {
    const m = checkAssignment(src, typeOf);
    if (m) out.push({ rule: "L026", severity: "aviso", target: n.id, message: `efeito «${src}» de "${n.label}": ${m}` });
  }
  for (const n of doc.nodes.filter((x) => x.logic?.examples?.length)) {
    for (const ex of n.logic!.examples!) {
      for (const [side, map] of [["Dado", ex.given], ["Esperado", ex.expect]] as const) {
        for (const [k, v] of Object.entries(map)) {
          const t = types.get(k);
          if (!t) continue;
          for (const p of checkValue(t.type, v, k)) out.push({ rule: "L026", severity: "aviso", target: n.id, message: `exemplo "${ex.name}" de "${n.label}" (${side}): ${p}` });
        }
      }
    }
  }
  return out;
}

/* ───────────────────────── descrição para LLMs ───────────────────────── */

const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");

/** Texto curto do que um passo faz (para o fluxo em lista). */
function stepText(n: NodeEl, names: Record<string, string>): string {
  const l = n.logic!;
  const ex = (src?: string) => {
    try {
      return src ? explain(parseExpr(src), names) : "";
    } catch {
      return `${src} ✘`;
    }
  };
  switch (l.role) {
    case "decision":
      return `${l.text ?? ""} ${ex(l.when)}`.trim();
    case "table":
      return `${l.text ?? ""} (tabela: ${(l.rows ?? []).length} linhas, vale a primeira${l.otherwise ? "; senão, a linha «senão»" : ""})`.trim();
    case "switch":
      return `${l.text ?? ""} ${l.on ? `conforme ${ex(l.on)}` : "(a primeira condição que valer)"}`.trim();
    case "loop":
      return [l.text, l.foreach ? `para cada ${l.as ?? "item"} em ${ex(l.foreach)}` : "", l.until ? `até ${ex(l.until)}` : "", l.max ? `no máximo ${l.max} vezes` : ""].filter(Boolean).join(" · ");
    case "end":
      return `${l.outcome === "erro" ? "[erro] " : ""}${l.text ?? ""}`.trim();
    case "start":
      return [l.text, l.trigger && l.trigger.kind !== "manual" ? (l.trigger.kind === "webhook" ? `gatilho: webhook ${l.trigger.method ?? "POST"} ${l.trigger.path}` : `gatilho: agenda (cron ${l.trigger.cron})`) : ""].filter(Boolean).join(" · ");
    case "code":
      return [l.text, `código TypeScript (${(l.code ?? "").split("\n").filter((x) => x.trim()).length} linhas; o resultado fica em resultado)`, l.falha ? `falha quando ${ex(l.falha)}` : "", l.devolve?.length ? `devolve ${l.devolve.map((t) => { try { return explainStatement(parseStatement(t), names); } catch { return `${t} ✘`; } }).join("; ")}` : ""].filter(Boolean).join(" · ");
    case "call":
      return [l.text, l.request ? `HTTP ${l.request.method} ${ex(l.request.url)}${l.request.body ? ` com corpo { ${Object.entries(l.request.body).map(([k, v]) => `${k}: ${ex(v)}`).join(", ")} }` : ""}; a resposta fica em resposta e status_http` : "", l.falha ? `falha quando ${ex(l.falha)}` : "", l.devolve?.length ? `devolve ${l.devolve.map((t) => { try { return explainStatement(parseStatement(t), names); } catch { return `${t} ✘`; } }).join("; ")}` : ""].filter(Boolean).join(" · ");
    default:
      return l.text ?? "";
  }
}

export function describeLogic(doc: Doc, issues: Issue[]): string {
  const names = dataNames(doc);
  const out: string[] = [`# ${doc.title} (modo logic)`, ""];
  if (doc.description) out.push(doc.description, "");
  const facts = dataNodes(doc);
  if (facts.length) {
    out.push("## Dados", "", "| Nome nas expressões | Dado | Papel | Tipo | Valor fixo | Significado |", "|---|---|---|---|---|---|");
    for (const f of facts) out.push(`| \`${dataKey(f)}\` | ${cell(f.label)} | ${LOGIC_ROLES[f.logic!.role].label} | ${f.logic!.type ?? ""} | ${f.logic!.value === undefined ? "" : "`" + JSON.stringify(f.logic!.value) + "`"} | ${cell(f.logic!.text ?? f.description ?? "")} |`);
    out.push("");
  }
  const results = checkExamples(doc);
  const flow = hasFlow(doc);
  if (flow) {
    out.push("## Fluxo (setas entre os passos)", "");
    const seen = new Set<string>();
    const order: NodeEl[] = [];
    const start = logicNodes(doc, "start")[0];
    const visit = (n: NodeEl) => {
      if (seen.has(n.id)) return;
      seen.add(n.id);
      order.push(n);
      for (const e of exitsOf(doc, n.id)) visit(e.to);
    };
    if (start) visit(start);
    for (const n of doc.nodes.filter(isFlowNode)) visit(n);
    for (const n of order) {
      const t = stepText(n, names);
      out.push(`- **${LOGIC_ROLES[n.logic!.role].label}** \`${n.id}\` — ${n.label}${t ? `: ${t}` : ""}${n.source ? ` (código: \`${n.source}\`)` : ""}`);
      for (const e of exitsOf(doc, n.id)) out.push(`  - → ${branchLabel(e.edge.logic) ?? "segue"}: ${e.to.label} (\`${e.to.id}\`)`);
    }
    out.push("");
  }
  const rules = flow ? doc.nodes.filter((n) => n.logic?.role === "rule") : pipelineRules(doc);
  if (rules.length) {
    out.push(flow ? "## Ações (o que cada uma faz)" : "## Fila de ações (roda nesta ordem; cada ação pode reescrever o resultado da anterior)", "");
    for (const r of rules) {
      const l = r.logic!;
      out.push(`### ${flow ? "" : `${l.order ?? "?"}. `}${r.label} (${r.id})`);
      if (l.text) out.push(l.text);
      if (r.description) out.push(r.description);
      if (l.when) {
        // legado: Ação com guarda que a migração não pôde converter (sem setas)
        try {
          out.push(`- **Quando:** \`${l.when}\` — ${explain(parseExpr(l.when), names)}`);
        } catch {
          out.push(`- **Quando:** \`${l.when}\` ✘ expressão inválida`);
        }
      }
      for (const t of l.then ?? []) {
        try {
          out.push(`- **Efeitos:** \`${t}\` — ${explainStatement(parseStatement(t), names)}`);
        } catch {
          out.push(`- **Efeitos:** \`${t}\` ✘ efeito inválido`);
        }
      }
      for (const x of results.filter((e) => e.node === r.id)) out.push(`- ${x.ok ? "✔" : "✘"} exemplo "${x.example}"${x.ok ? "" : ": " + x.problems.join("; ")}`);
      out.push("");
    }
  }
  const tables = doc.nodes.filter((n) => n.logic?.role === "table");
  if (tables.length) {
    out.push("## Tabelas de decisão (vale a primeira linha verdadeira, de cima para baixo)", "");
    for (const t of tables) {
      const l = t.logic!;
      out.push(`### ${t.label} (${t.id})`);
      if (l.text) out.push(l.text);
      out.push("", "| # | Quando | Então |", "|---|---|---|");
      (l.rows ?? []).forEach((r, i) => out.push(`| ${i + 1} | ${r.label ? `${cell(r.label)}: ` : ""}\`${cell(r.when)}\` | ${r.then.map((x) => `\`${cell(x)}\``).join("; ")} |`));
      if (l.otherwise) out.push(`| senão | (nenhuma linha valeu) | ${l.otherwise.map((x) => `\`${cell(x)}\``).join("; ")} |`);
      out.push("");
      for (const x of results.filter((e) => e.node === t.id)) out.push(`- ${x.ok ? "✔" : "✘"} exemplo "${x.example}"${x.ok ? "" : ": " + x.problems.join("; ")}`);
      out.push("");
    }
  }
  const decisions = doc.nodes.filter((n) => n.logic?.role === "decision" || n.logic?.role === "switch");
  if (decisions.length) {
    out.push("## Decisões e escolhas", "");
    for (const d of decisions) {
      out.push(`- **${d.label}** (\`${d.id}\`): ${stepText(d, names)}`);
      for (const x of results.filter((e) => e.node === d.id)) out.push(`  - ${x.ok ? "✔" : "✘"} exemplo "${x.example}"${x.ok ? "" : ": " + x.problems.join("; ")}`);
    }
    out.push("");
  }
  const scenarios = logicNodes(doc, "scenario");
  if (scenarios.length) {
    out.push("## Cenários (o fluxo inteiro)", "");
    for (const s of scenarios) {
      out.push(`### ${s.label} (${s.id})`);
      if (s.logic!.text) out.push(s.logic!.text);
      for (const x of results.filter((e) => e.node === s.id)) {
        out.push(`- ${x.ok ? "✔" : "✘"} "${x.example}"${x.ok ? "" : ": " + x.problems.join("; ")}${x.run.outcome ? ` (fim: ${x.run.outcome})` : ""}`);
        for (const st of x.run.steps.filter((q) => q.applied && q.role !== "start")) {
          const bits = [
            st.changes.map((c) => `${c.name} ${show(c.from)} → ${show(c.to)}`).join(", ") || undefined,
            st.branch ? `saiu por "${st.branch}"${st.turn ? ` (volta ${st.turn})` : ""}` : undefined,
            st.locked.length ? `trava ${st.locked.join(", ")}` : undefined,
            st.blocked.length ? `não reescreve (travado): ${st.blocked.join(", ")}` : undefined,
          ].filter(Boolean);
          out.push(`  - ${LOGIC_ROLES[st.role].label} ${st.label}${bits.length ? ": " + bits.join(" · ") : ""}`);
        }
      }
      out.push("");
    }
  }
  const rank = { erro: 0, aviso: 1, dica: 2 } as const;
  if (issues.length) {
    out.push("## Avisos", "");
    for (const i of [...issues].sort((a, b) => rank[a.severity] - rank[b.severity])) out.push(`- [${i.rule} ${i.severity}] ${i.message}`);
  } else out.push("## Avisos", "", "Nenhum.");
  return out.join("\n");
}

/* ───────────────────────── guia para a IA ───────────────────────── */

export function schemaGuideLogic(): string {
  return [
    `# Archflow: guia do modo LOGIC (${SCHEMA_VERSION})`,
    "",
    "Modo para **regras de negócio específicas** como um **fluxo executável**: Start → ações, decisões, escolhas, laços e caminhos paralelos → End, ligados por setas. Negócio lê as frases e a explicação em português; dev e IA usam a expressão exata. O app executa o fluxo com os dados de cada exemplo e confere o resultado.",
    "",
    "## Elementos (`logic.role`, kind `logic`)",
    ...Object.entries(LOGIC_ROLES).map(([k, r]) => `- \`${k === "rule" ? "action" : k}\`${k === "rule" ? " (o nome antigo `rule` também vale)" : ""} (${r.badge}): ${r.hint} Campos: ${r.fields.join(", ")}.`),
    "",
    "## Setas e saídas",
    "- Ligue passo → passo com `connect`. Setas que saem de decisão, escolha ou laço dizem a saída em `logic`:",
    ...Object.entries(LOGIC_BRANCHES).map(([k, b]) => `  - \`logic: { branch: "${k}" }\` (${b.label}): ${b.hint}`),
    '  - escolha: `logic: { case: "\\"lucro\\"" }` (o valor do caso, escrito como expressão) e uma seta `branch: "outros"`.',
    "- Setas entre dados e passos não existem: os dados são lidos pelas expressões.",
    "",
    "## Tipos dos dados (`type` do Input, Output e Variable)",
    "Escreva o tipo como no TypeScript; o app confere o valor fixo e os exemplos (Dado/Esperado) com ele e avisa (L026) quando não batem:",
    "- Básicos: `string`, `number`, `int` (inteiro), `float` (decimal), `boolean`, `null`, `any`. Literais e uniões: `\"ouro\" | \"prata\"`, `number | null`.",
    "- Listas: `string[]` ou `Array<number>`. Objetos: `{ nome: string; preco: number; cupom?: string }` (campo opcional com `?`). Lista de objetos: `{ preco: number; qtd: int }[]`.",
    "- Sinônimos em português que aceitam «sem valor»: `texto` = `string | null`, `número`, `inteiro`, `decimal`, `lógico`. Os nomes em inglês são estritos.",
    "- Um texto que não é tipo (ex.: `dinheiro`) continua valendo como rótulo e não é conferido. Objetos com campos a mais ainda servem (como no TypeScript).",
    "",
    "## Expressões",
    SYNTAX_GUIDE,
    "",
    "## Como modelar",
    '1. Um nó `start` (o que entra) e um ou mais `end` (o que sai; `outcome: "erro"` para falhas).',
    "2. Um nó de dado por dado, no papel certo: **`input`** (entra de fora e só é lido; nenhuma ação o escreve), **`output`** (o resultado que o fluxo devolve; é o que os cenários conferem em `expect`) ou **`variable`** (intermediário: criado e reescrito dentro do fluxo para calcular outra coisa). `key` é o nome nas expressões (`preco_atual`, `categoria.margem`). Constantes de entrada levam `value`; na variável, `value` é o valor inicial. O papel antigo `fact` foi dividido nesses três: arquivos antigos são convertidos ao abrir (nunca escrito = input; escrito e conferido nos cenários ou nunca lido = output; escrito e lido no meio do fluxo = variable).",
    "3. Cada **ação** é um nó `action` (o nome antigo `rule` também vale) só com efeitos (`then`) e **sem condição**: ela roda sempre que o fluxo chega nela, e um efeito não pode ter `se … entao … senao` dentro (é recusado, erro L028): para escolher entre dois valores, ponha uma Decisão antes, com uma ação para cada valor. **Uma condição sim/não é um nó `decision`** (`when`, com setas sim/não) colocado antes da ação, para o desvio aparecer no quadro; com 3 ou mais saídas é um `switch`, e a repetição é um `loop` (veja 3b). Só a Ação e a Decisão são os nós básicos para mexer em dados e escolher entre dois caminhos (as exceções estão logo abaixo). A Ação muda dados, a Decisão escolhe o caminho; Switch, Loop, Fork, Join e Call organizam o fluxo e não mudam dados sozinhos (exceto o `devolve` do Call e o item do `foreach`, que o Loop guarda em `as`). Nenhum deles aceita `se … entao … senao` dentro de um efeito.",
    "3b. **Escolha o nó pela forma do desvio**: 2 saídas (sim/não) → `decision`; **3 ou mais saídas** por valor (`on` + uma seta por `case`) ou por faixas (sem `on`: a condição de cada faixa vai em `logic.case` da seta e vale a primeira verdadeira, na ordem em que as setas foram criadas; faixas que se sobrepõem: ganha a mais antiga) → `switch`, nunca uma cadeia de `decision` testando o mesmo dado; passos **independentes** que não dependem do resultado um do outro (ex.: frete e imposto) → `fork` com uma seta por ramo e um `join` que reúne todos antes de seguir; repetição → `loop`; lógica de outro diagrama → `call`. **Se cada caminho de uma escolha só atribui valores** (faixas de preço, tabela de frete, classificação), use uma `table` (tabela de decisão: `rows: [{ when, then, label? }]` em ordem + `otherwise`) no lugar do `switch` + uma ação por caso: a regra inteira vira uma grade num cartão só.",
    "4. Repetições são `loop` (`until`, `max` ou `foreach` + `as`): a seta `repete` volta ao início do corpo, `segue` sai. A parada é conferida ANTES de cada volta, então pode haver zero voltas; o loop sai pela seta `segue` assim que vale a primeira entre: acabaram os itens do `foreach`, a condição `until` ficou verdadeira ou já foram `max` voltas. `max` conta voltas (1 a 1000) e não tem valor padrão: sem `until`, `max` nem `foreach`, o loop é recusado.",
    "4a. **Bordas do laço, da decisão e da trava**: `foreach` de lista vazia dá zero voltas; `nulo`, objeto ou texto no lugar da lista é erro; sem `as` o item se chama `item` e fica com o último valor depois do laço. A `when` da decisão é obrigatória (recusada ao criar) e precisa dar verdadeiro ou falso: número ou nulo é erro de execução, não falso. `destravar` sem `travar` antes não faz nada e não avisa; `travar` num dado que ainda não existe já bloqueia a escrita dele; `expect` confere o valor que o dado tem DE FATO (o travado), não o que a ação tentou escrever. Um ramo do `fork` que chega a um `end` termina o fluxo inteiro com o desfecho desse `end`, e um `join` sem `fork` só deixa passar.",
    "5a. **De onde vem o valor de um dado**: o que entra em `given` (no cenário, o fluxo todo recebe o `given`; no exemplo de um passo, só ele) vale mais que o `value` do dado; sem `given`, vale o `value`; sem os dois, quem LÊ o dado dá o erro «não tem valor neste exemplo» (`nulo` informado em `given` conta como valor). O `value` de uma `variable` é o valor inicial e a ação pode reescrevê-lo sem aviso; o `value` de um `input` é uma constante de entrada: se uma ação o calcula, o aviso L029 pede para trocar o papel para `variable` (intermediário) ou `output` (resultado). Uma ação que escreve um dado sem nó de dado cria o dado na hora (aviso L007: declare um `variable` ou `output`); um dado lido que ninguém declara nem escreve dá o aviso L002. O `type` do dado não bloqueia a execução: valor fixo, `given` ou efeito de tipo incompatível (`preco := \"abc\"` com `preco: number`) só dão o aviso L026, e a execução segue.",
    "5b. **Tipos do dado** (conferidos só nos exemplos e nos valores fixos, com o aviso L026): `number` é qualquer número (`2.5` e `3`); `int` só inteiro (`3` e `3.0` valem, `2.5` não); `float` é o mesmo que `number`; `string`, `boolean`, `string[]`, `{ preco: number }` (campo a mais é aceito, campo que falta não, `?` torna opcional), `\"a\" | \"b\"`, `number | null` e `any` seguem o TypeScript. Os nomes em inglês NÃO aceitam `nulo`; os em português (`texto`, `número`, `inteiro`, `decimal`, `lógico`) são o mesmo tipo mais `nulo`. `type` vazio, ou um texto que não é tipo (`dinheiro`, ou um erro de digitação como `numbr`), não confere nada: vale só como rótulo. Um dado composto pode ser um nó de objeto (`categoria`, tipo `{ margem: number }`) ou um nó por campo (`key: \"categoria.margem\"`): as expressões leem `categoria.margem` dos dois jeitos e, se existirem os dois, vale o campo solto.",
    '5. Para cada ação, decisão e escolha, ao menos um exemplo: `{ name, given: { dado: valor }, expect: { dado: valor } }`. Em decisão e escolha, `expect: { caminho: "sim" }` confere por onde sai (decisão: `"sim"` ou `"nao"`, sem acento; escolha: o valor do caso ou `"outros"`). Exemplos de `scenario` rodam o fluxo inteiro (`expect.desfecho` confere "ok" ou "erro"). `given` são os dados que ENTRAM no passo (na ação, na decisão e na escolha roda só aquele passo; no cenário, o fluxo todo) e valem mais que o `value` do dado; dado sem `given` e sem `value` dá o erro «não tem valor neste exemplo». `expect` confere SÓ as chaves listadas, nos dados depois do passo (para ação: depois dos efeitos).',
    "6. `layout` (padrão no modo logic) organiza o fluxo de cima para baixo; `validate_diagram` roda os exemplos de verdade (L004) e checa o fluxo (L012–L024).",
    "7. **Pergunte os números** (limites, faixas, percentuais) ao usuário; não invente.",
    "8. **Integrações reais (estilo n8n) e código**: um `call` com `request: { method, url, headers?, body? }` é uma chamada HTTP de verdade (`url`, cada cabeçalho e cada campo do `body` são EXPRESSÕES: texto fixo leva aspas, ex.: `url: '\"https://api.exemplo.com/clientes/\" + cliente_id'`; o corpo vai como JSON). A resposta cai nos dados `resposta` (o corpo, JSON ou texto) e `status_http`, que `falha` e `devolve` podem ler (`devolve: [\"cidade := resposta.localidade\"]`). Resposta fora de 2xx ou sem rede segue pela seta `erro`. O app não chama a rede: os exemplos usam `mock` (o corpo simulado, status 200). `generate_code` gera TypeScript EXECUTÁVEL do fluxo (`run(input, deps)`, com `fetch` de verdade nas chamadas, e um teste por exemplo de cenário); declare os `type` dos dados na sintaxe do TypeScript, pois viram as interfaces Input e Output.",
    "9. **Gatilhos, código livre e credenciais (estilo n8n)**: o `start` aceita `trigger`: `{ kind: \"manual\" }` (padrão), `{ kind: \"webhook\", method?, path: \"/pedidos\" }` (o corpo JSON, ou a query em GET, é o input) ou `{ kind: \"agenda\", cron: \"0 8 * * 1-5\" }`; o código gerado exporta `trigger` e `handler(req)` (Fetch API) ou `onSchedule()`. Para o que as expressões não alcançam use um nó `code` com `code`: o CORPO de `async (data) => { ... }` em TypeScript (`data` são os dados do fluxo); o `return` vira o dado `resultado`, lido em `devolve` (`total := resultado.total`); se lançar erro, segue pela seta `erro`. O app NÃO executa TypeScript: nos exemplos vale `mock` (o resultado simulado); no código gerado roda de verdade. Credenciais: `segredo(\"API_TOKEN\")` numa expressão (ex.: cabeçalho `Authorization`) lê `deps.secrets` ou a variável de ambiente no código gerado; no app é um texto de mentira, e o valor nunca fica no diagrama.",
    "",
    "## Diagramas que explicam código complexo (leia antes de traduzir um código)",
    "O objetivo é que uma pessoa entenda a lógica olhando o quadro, não reler o código em cartões. Regras de granularidade:",
    "- **Uma ação por intenção, não por linha**: atribuições seguidas sem desvio entre elas (`inicio := 0`, `fim := tamanho(v)`) são UMA ação com vários efeitos, com uma frase de negócio em `text`.",
    "- **Escolha que só atribui é tabela**: `switch` com N setas para N ações de um efeito cada vira uma `table` (veja 3b).",
    "- **Etapas**: um fluxo com mais de ~12 passos é dividido em ETAPAS, trechos com um objetivo (validar, calcular a partida, arredondar, recomendar). Crie com `add_groups` e `stage: { text }` (a frase do que a etapa faz) e ponha os passos dentro com `parent`. Cada etapa deve ter **uma entrada** (aviso L035) e no máximo ~12 passos. Com `stage.collapsed: true` a etapa vira um cartão-resumo (o que lê, o que escreve, quantos passos, exemplos) e as etapas recolhidas formam a **visão geral**. Diagramas grandes devem ficar com as etapas recolhidas: quem lê abre a etapa que interessa. Fluxo com mais de 25 passos e nenhuma etapa dá a dica L036.",
    "- **Origem no código**: preencha `source` em cada passo (`\"src/precos.ts:120-134\"`, em `add_components`) para ligar o desenho ao código real (o cartão mostra o arquivo e a linha; formato conferido pela dica L037).",
    "- **Cenários cobrem os caminhos**: um `scenario` por caminho importante (incluindo os de erro). As setas de decisão mostram quantos cenários passam por elas; uma seta «sem cenário» é um caminho sem teste.",
    "- **Frases de negócio**: `text` em decisões (a pergunta), ações (o que muda e por quê), tabelas e etapas. O modo Explicar da reprodução conta a execução com essas frases.",
    "",
    "## Semântica do fluxo",
    "- O fluxo anda de seta em seta a partir do `start`, sobre os mesmos dados; `x := ...` atualiza `x` para os passos seguintes.",
    "- `travar x`: daí em diante (na mesma ação, nos passos seguintes, nas voltas de um loop e em todos os ramos) `x := ...` NÃO muda `x` e não dá erro: a tentativa é só anotada no passo e aparece na linha do tempo do dado, marcada como bloqueada; `destravar x` libera. A trava vale até o fim da execução ou até o `destravar`.",
    '- Decisão: `when` verdadeiro segue por "sim"; falso, por "não". Escolha: segue pela seta cujo `case` é igual ao valor de `on`, senão "outros".',
    '- Loop: antes de cada volta confere a parada; se não parou, segue por "repete"; ao parar, por "segue". Com `foreach`, cada volta guarda o item em `as`.',
    "- Paralelo (`fork`): os ramos são **independentes**: o app os simula um depois do outro, na ordem das setas, sobre os MESMOS dados (nada roda de fato ao mesmo tempo); por isso um ramo não deve escrever um dado que outro ramo escreve ou lê (a validação avisa, L027). Roda cada ramo até o `join` e só então continua. Erro (divisão por zero, dado sem valor, saída faltando) interrompe o fluxo e aparece no exemplo.",
    "- Tabela (`table`): confere as linhas de cima para baixo; a primeira com `when` verdadeiro aplica o `then` dela e o fluxo segue pela única seta de saída; nenhuma verdadeira aplica o `otherwise` (sem ele, é erro de execução). Exemplos da tabela são como os da ação (`expect` confere os dados).",
    "- Etapas (`stage`) não mudam a execução: só o que se vê e o layout.",
    "- Sem setas entre os passos, vale o modo simples: as ações rodam em ordem CRESCENTE de `order` (1, 2, 3…); as sem `order` vão para o fim, na ordem em que foram criadas, que também desempata `order` repetido (a validação avisa, L005). Com setas, o fluxo manda e `order` é ignorado.",
  ].join("\n");
}
