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
  LOGIC_BRANCHES,
  LOGIC_BRANCH_KEYS,
  LOGIC_ROLES,
  LOGIC_ROLE_KEYS,
  SCHEMA_VERSION,
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
import { EvalError, ExprError, SYNTAX_GUIDE, checkExpr, evaluate, explain, explainStatement, parseExpr, parseStatement, readsOf, type Env, type Statement, type Value } from "./expr";
import type { Issue } from "./domain";

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

/** Valida o objeto `logic` de um nó. Devolve a mensagem de erro (acionável) ou undefined. */
export function checkLogicNode(logic: unknown): string | undefined {
  if (!logic || typeof logic !== "object") return "logic deve ser um objeto { role, ... }";
  const d = logic as Record<string, unknown>;
  const role = d.role as string;
  if (!LOGIC_ROLE_KEYS.includes(role as never)) return `logic.role inválido "${role}". Válidos: ${LOGIC_ROLE_KEYS.join(", ")}`;
  const allowed = new Set<string>(["role", ...LOGIC_ROLES[role as keyof typeof LOGIC_ROLES].fields]);
  for (const k of Object.keys(d)) {
    if (d[k] === undefined) continue;
    if (!allowed.has(k)) return `campo "${k}" não existe no papel "${role}". Campos do papel: ${[...allowed].filter((f) => f !== "role").join(", ")}`;
  }
  if (d.order !== undefined && (typeof d.order !== "number" || !Number.isFinite(d.order))) return "logic.order deve ser um número (1, 2, 3…)";
  if (d.max !== undefined && (typeof d.max !== "number" || !Number.isInteger(d.max) || d.max < 1 || d.max > 1000)) return "logic.max deve ser um inteiro entre 1 e 1000";
  for (const f of ["text", "type"]) if (d[f] !== undefined && typeof d[f] !== "string") return `logic.${f} deve ser texto`;
  if (d.key !== undefined && (typeof d.key !== "string" || !KEY_RE.test(d.key))) return `logic.key deve ter só letras, números, "_" e pontos, sem espaço (ex.: preco_atual, categoria.margem)`;
  if (d.as !== undefined && (typeof d.as !== "string" || !KEY_RE.test(d.as))) return `logic.as deve ser um nome simples (ex.: produto)`;
  if (d.outcome !== undefined && d.outcome !== "ok" && d.outcome !== "erro") return 'logic.outcome deve ser "ok" ou "erro"';
  if (d.value !== undefined && !isValue(d.value)) return "logic.value deve ser texto, número, lógico, vazio ou lista";
  for (const f of ["when", "on", "until", "foreach"]) {
    if (d[f] === undefined) continue;
    if (typeof d[f] !== "string") return `logic.${f} deve ser texto (uma expressão)`;
    const e = checkExpr(d[f] as string);
    if (e) return `logic.${f}: ${e.message} (posição ${e.pos})`;
  }
  if (role === "loop" && d.until === undefined && d.max === undefined && d.foreach === undefined) return "um loop precisa de parada: informe logic.until, logic.max e/ou logic.foreach";
  if (role === "decision" && d.when === undefined) return 'uma decisão precisa de condição (logic.when), ex.: "preco < piso"';
  if (d.then !== undefined) {
    if (!Array.isArray(d.then) || d.then.some((x) => typeof x !== "string")) return 'logic.then deve ser uma lista de efeitos em texto (ex.: ["preco := max(preco, piso)", "travar preco"])';
    for (const [i, s] of (d.then as string[]).entries()) {
      const e = checkExpr(s, "statement");
      if (e) return `logic.then[${i}] "${s}": ${e.message} (posição ${e.pos})`;
    }
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
      const t = explain(parseExpr(kase), factNames(doc), true);
      return t.length > 34 ? t.slice(0, 33) + "…" : t;
    } catch {
      return kase;
    }
  }
  return `= ${kase}`;
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
  return next as unknown as LogicNodeSpec;
}

/* ───────────────────────── leitura do modelo ───────────────────────── */

const logicNodes = (doc: Doc, role?: LogicNodeSpec["role"]) => doc.nodes.filter((n) => n.logic && (!role || n.logic.role === role));

/** Nome usado nas expressões: `key` do fato ou, na falta dele, o id com "_" no lugar de "-". */
export const factKey = (n: NodeEl) => n.logic?.key ?? n.id.replace(/-/g, "_");

/** Papéis que fazem parte do fluxo (os demais são dados e cenários). */
export const FLOW_ROLES: LogicRole[] = ["start", "end", "rule", "decision", "switch", "loop", "fork", "join", "call"];
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
export function factNames(doc: Doc): Record<string, string> {
  const m: Record<string, string> = {};
  for (const f of logicNodes(doc, "fact")) m[factKey(f)] = f.label.toLowerCase();
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
function runEffects(l: LogicNodeSpec, env: Env, locked: Set<string>, step: Step) {
  for (const src of l.then ?? []) {
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

/** Dados fixos declarados nos fatos (constantes), usados quando o exemplo não informa. */
function defaults(doc: Doc): Env {
  const env: Env = {};
  for (const f of logicNodes(doc, "fact")) if (f.logic!.value !== undefined) env[factKey(f)] = f.logic!.value;
  return env;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Roda a fila simples (sem setas) com os dados de entrada: as regras por `order`. */
export function runPipeline(doc: Doc, given: Record<string, LogicValue>): Run {
  const env: Env = { ...defaults(doc), ...given };
  const locked = new Set<string>();
  const steps: Step[] = [];
  for (const r of pipelineRules(doc)) {
    const st = runRule(r, env, locked);
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

/** Roda o fluxo (Start → … → End) seguindo as setas, com os dados de entrada. */
export function runFlow(doc: Doc, given: Record<string, LogicValue>): Run {
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
      const n = byId.get(cur)!;
      const l = n.logic!;
      const outs = exitsOf(doc, cur);
      const only = () => outs[0]?.to.id;
      const record = (st: Step) => {
        steps.push(st);
        return st;
      };
      switch (l.role) {
        case "start":
        case "call":
          record(blank(n));
          cur = only();
          break;
        case "rule": {
          const st = record(runRule(n, env, locked));
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
            const stop = l.foreach ? s.i >= s.list!.length : (l.until !== undefined && evaluate(parseExpr(l.until), env) === true) || (l.max !== undefined && s.n >= l.max);
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
          record(blank(byId.get(joinAt)!));
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

/** Roda só uma regra (exemplos da própria regra). */
export function runSingle(doc: Doc, rule: NodeEl, given: Record<string, LogicValue>): Run {
  const env: Env = { ...defaults(doc), ...given };
  const locked = new Set<string>();
  const st = runRule(rule, env, locked);
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
      for (const f of [l.when, l.on, l.until, l.foreach]) if (f) readsOf(parseExpr(f), u.reads);
      if (l.role === "switch" && !l.on) for (const e of exitsOf(doc, n.id)) if (e.case) readsOf(parseExpr(e.case), u.reads);
      for (const t of l.then ?? []) {
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

/** Os dados (nós `fact`) que um passo usa, ou os passos que usam um dado. */
export function relatedTo(doc: Doc, id: string): Set<string> {
  const out = new Set<string>();
  const n = doc.nodes.find((x) => x.id === id);
  if (!n?.logic) return out;
  const use = usageOf(doc);
  const facts = doc.nodes.filter((f) => f.logic?.role === "fact");
  const touches = (keys: Set<string>, k: string) => [...keys].some((r) => r === k || r.startsWith(k + "."));
  if (n.logic.role === "fact") {
    const k = factKey(n);
    for (const [sid, u] of use) if (touches(u.reads, k) || touches(u.writes, k)) out.add(sid);
  } else {
    const u = use.get(id);
    if (u) for (const f of facts) if (touches(u.reads, factKey(f)) || touches(u.writes, factKey(f))) out.add(f.id);
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
    if (l.role === "rule") for (const ex of l.examples ?? []) check(n, ex, runSingle(doc, n, ex.given));
    else if (l.role === "decision" || l.role === "switch") for (const ex of l.examples ?? []) check(n, ex, runBranch(doc, n, ex.given));
    else if (l.role === "scenario") for (const ex of l.examples ?? []) check(n, ex, flow ? runFlow(doc, ex.given) : runPipeline(doc, ex.given));
  }
  return out;
}

/** Situação de cada passo com exemplos, para o quadro: ok, fail ou none (sem exemplo). */
export function logicStatus(doc: Doc): Map<string, "ok" | "fail" | "none"> {
  const m = new Map<string, "ok" | "fail" | "none">();
  for (const n of logicNodes(doc)) if (["rule", "decision", "switch", "scenario"].includes(n.logic!.role)) m.set(n.id, "none");
  for (const r of checkExamples(doc)) m.set(r.node, r.ok && m.get(r.node) !== "fail" ? "ok" : "fail");
  return m;
}

/* ───────────────────────── regras de validação (L*) ───────────────────────── */

/** Dados lidos por todas as expressões de um nó. */
function readsOfNode(n: NodeEl): Set<string> {
  const l = n.logic!;
  const out = new Set<string>();
  for (const f of [l.when, l.on, l.until, l.foreach]) if (f) readsOf(parseExpr(f), out);
  for (const t of l.then ?? []) {
    const s = parseStatement(t);
    if (s.t === "assign") readsOf(s.value, out);
  }
  return out;
}

export function logicIssues(doc: Doc): Issue[] {
  const issues: Issue[] = [];
  const add = (rule: string, severity: Issue["severity"], target: string | undefined, message: string) => issues.push({ rule, severity, target, message });
  const facts = logicNodes(doc, "fact");
  const steps = doc.nodes.filter(isFlowNode);
  const rules = logicNodes(doc, "rule");
  const flow = hasFlow(doc);
  const keys = new Map<string, NodeEl[]>();
  for (const f of facts) keys.set(factKey(f), [...(keys.get(factKey(f)) ?? []), f]);
  for (const [k, list] of keys) if (list.length > 1) for (const f of list) add("L011", "erro", f.id, `o dado "${k}" está declarado ${list.length} vezes (${list.map((x) => x.label).join(", ")}); cada nome vale para um só`);

  const declared = (name: string) => keys.has(name) || [...keys.keys()].some((k) => name.startsWith(k + ".") || k.startsWith(name + "."));
  const written = new Set<string>();
  const readSet = new Set<string>();
  const loopVars = new Set(logicNodes(doc, "loop").filter((n) => n.logic!.foreach).map((n) => n.logic!.as ?? "item"));
  for (const r of rules)
    for (const src of r.logic!.then ?? []) {
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
        if (!declared(r) && !written.has(r) && !loopVars.has(r.split(".")[0])) add("L002", "aviso", n.id, `${where} lê "${r}", que não é um dado declarado nem escrito por outra regra`);
      }
    if (l.role === "rule")
      for (const src of l.then ?? []) {
        try {
          const s = parseStatement(src);
          if (s.t === "assign" && !declared(s.name)) add("L007", "aviso", n.id, `${where} escreve "${s.name}", que não é um dado declarado; crie um nó "Fact" com key "${s.name}"`);
          else if (s.t !== "assign") readSet.add(s.name);
        } catch {
          /* L001 acima */
        }
      }
    if ((l.role === "rule" || l.role === "decision" || l.role === "switch") && !(l.examples ?? []).length) add("L003", l.role === "rule" ? "aviso" : "dica", n.id, `${where} sem exemplo: sem um caso concreto ninguém confere se está certo`);
    if (l.role === "rule" && !l.text?.trim()) add("L008", "dica", n.id, `${where} sem frase de negócio (campo "text"); a explicação automática cobre, mas a frase do negócio é melhor`);
    if (!flow && l.role === "rule" && l.order === undefined) add("L005", "aviso", n.id, `${where} sem ordem na fila (logic.order)`);
  }
  if (!flow) {
    const byOrder = new Map<number, NodeEl[]>();
    for (const r of rules) if (r.logic!.order !== undefined) byOrder.set(r.logic!.order, [...(byOrder.get(r.logic!.order) ?? []), r]);
    for (const [o, list] of byOrder) if (list.length > 1) for (const r of list) add("L005", "aviso", r.id, `${list.length} regras com a mesma ordem (${o}): a ordem do documento decide, o que é frágil`);
  }

  for (const f of facts) {
    const k = factKey(f);
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
      if (["rule", "start", "call", "join"].includes(l.role) && o.length > 1) add("L024", "aviso", n.id, `${where} tem ${o.length} saídas sem decisão: o fluxo não sabe qual seguir (use uma decisão, escolha ou paralelo)`);
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
  return issues;
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
    case "switch":
      return `${l.text ?? ""} ${l.on ? `conforme ${ex(l.on)}` : "(a primeira condição que valer)"}`.trim();
    case "loop":
      return [l.text, l.foreach ? `para cada ${l.as ?? "item"} em ${ex(l.foreach)}` : "", l.until ? `até ${ex(l.until)}` : "", l.max ? `no máximo ${l.max} vezes` : ""].filter(Boolean).join(" · ");
    case "end":
      return `${l.outcome === "erro" ? "[erro] " : ""}${l.text ?? ""}`.trim();
    default:
      return l.text ?? "";
  }
}

export function describeLogic(doc: Doc, issues: Issue[]): string {
  const names = factNames(doc);
  const out: string[] = [`# ${doc.title} (modo logic)`, ""];
  if (doc.description) out.push(doc.description, "");
  const facts = logicNodes(doc, "fact");
  if (facts.length) {
    out.push("## Dados", "", "| Nome nas expressões | Dado | Tipo | Valor fixo | Significado |", "|---|---|---|---|---|");
    for (const f of facts) out.push(`| \`${factKey(f)}\` | ${cell(f.label)} | ${f.logic!.type ?? ""} | ${f.logic!.value === undefined ? "" : "`" + JSON.stringify(f.logic!.value) + "`"} | ${cell(f.logic!.text ?? f.description ?? "")} |`);
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
      out.push(`- **${LOGIC_ROLES[n.logic!.role].label}** \`${n.id}\` — ${n.label}${t ? `: ${t}` : ""}`);
      for (const e of exitsOf(doc, n.id)) out.push(`  - → ${branchLabel(e.edge.logic) ?? "segue"}: ${e.to.label} (\`${e.to.id}\`)`);
    }
    out.push("");
  }
  const rules = flow ? doc.nodes.filter((n) => n.logic?.role === "rule") : pipelineRules(doc);
  if (rules.length) {
    out.push(flow ? "## Regras (o que cada uma faz)" : "## Fila de regras (roda nesta ordem; cada regra pode reescrever o resultado da anterior)", "");
    for (const r of rules) {
      const l = r.logic!;
      out.push(`### ${flow ? "" : `${l.order ?? "?"}. `}${r.label} (${r.id})`);
      if (l.text) out.push(l.text);
      if (r.description) out.push(r.description);
      try {
        out.push(`- **Quando:** ${l.when ? `\`${l.when}\` — ${explain(parseExpr(l.when), names)}` : "sempre"}`);
      } catch {
        out.push(`- **Quando:** \`${l.when}\` ✘ expressão inválida`);
      }
      for (const t of l.then ?? []) {
        try {
          out.push(`- **Então:** \`${t}\` — ${explainStatement(parseStatement(t), names)}`);
        } catch {
          out.push(`- **Então:** \`${t}\` ✘ efeito inválido`);
        }
      }
      for (const x of results.filter((e) => e.node === r.id)) out.push(`- ${x.ok ? "✔" : "✘"} exemplo "${x.example}"${x.ok ? "" : ": " + x.problems.join("; ")}`);
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
    "Modo para **regras de negócio específicas** como um **fluxo executável**: Start → regras, decisões, escolhas, laços e caminhos paralelos → End, ligados por setas. Negócio lê as frases e a explicação em português; dev e IA usam a expressão exata. O app executa o fluxo com os dados de cada exemplo e confere o resultado.",
    "",
    "## Elementos (`logic.role`, kind `logic`)",
    ...Object.entries(LOGIC_ROLES).map(([k, r]) => `- \`${k}\` (${r.badge}): ${r.hint} Campos: ${r.fields.join(", ")}.`),
    "",
    "## Setas e saídas",
    "- Ligue passo → passo com `connect`. Setas que saem de decisão, escolha ou laço dizem a saída em `logic`:",
    ...Object.entries(LOGIC_BRANCHES).map(([k, b]) => `  - \`logic: { branch: "${k}" }\` (${b.label}): ${b.hint}`),
    '  - escolha: `logic: { case: "\\"lucro\\"" }` (o valor do caso, escrito como expressão) e uma seta `branch: "outros"`.',
    "- Setas entre dados e passos não existem: os dados são lidos pelas expressões.",
    "",
    "## Expressões",
    SYNTAX_GUIDE,
    "",
    "## Como modelar",
    '1. Um nó `start` (o que entra) e um ou mais `end` (o que sai; `outcome: "erro"` para falhas).',
    "2. Um nó `fact` por dado: `key` é o nome nas expressões (`preco_atual`, `categoria.margem`). Constantes levam `value`.",
    "3. Cada regra é um nó `rule` só com efeitos (`then`). **Condições viram nós `decision`** (`when`, com setas sim/não), não `when` dentro da regra, para o desvio aparecer no quadro.",
    "4. Repetições são `loop` (`until`, `max` ou `foreach` + `as`): a seta `repete` volta ao início do corpo, `segue` sai.",
    '5. Para cada regra, decisão e escolha, ao menos um exemplo: `{ name, given: { dado: valor }, expect: { dado: valor } }`. Em decisão e escolha, `expect: { caminho: "sim" }` confere por onde sai. Exemplos de `scenario` rodam o fluxo inteiro (`expect.desfecho` confere "ok" ou "erro").',
    "6. `layout` (padrão no modo logic) organiza o fluxo de cima para baixo; `validate_diagram` roda os exemplos de verdade (L004) e checa o fluxo (L012–L024).",
    "7. **Pergunte os números** (limites, faixas, percentuais) ao usuário; não invente.",
    "",
    "## Semântica do fluxo",
    "- O fluxo anda de seta em seta a partir do `start`, sobre os mesmos dados; `x := ...` atualiza `x` para os passos seguintes.",
    "- `travar x`: nenhum passo seguinte reescreve `x` (a tentativa é registrada, não aplicada); `destravar x` libera.",
    '- Decisão: `when` verdadeiro segue por "sim"; falso, por "não". Escolha: segue pela seta cujo `case` é igual ao valor de `on`, senão "outros".',
    '- Loop: antes de cada volta confere a parada; se não parou, segue por "repete"; ao parar, por "segue". Com `foreach`, cada volta guarda o item em `as`.',
    "- Paralelo (`fork`): roda cada ramo até o `join` e só então continua. Erro (divisão por zero, dado sem valor, saída faltando) interrompe o fluxo e aparece no exemplo.",
    "- Sem setas entre os passos, vale o modo simples: as regras rodam por `order`.",
  ].join("\n");
}
