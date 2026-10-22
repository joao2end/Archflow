/**
 * Depuração visual do modo Logic: o que a reprodução de um cenário precisa além do percurso.
 *
 * - o porquê de cada passo, com os valores do momento (`v[meio] < x` → `3 < 4` → sim);
 * - os dados depois de cada passo, para mostrar o valor ao lado de cada dado no quadro;
 * - as voltas de cada laço (com aninhamento), para agrupar a lista de passos e pular de volta em volta;
 * - os saltos: próxima mudança de dado, próxima volta, sair do laço, próxima passagem por um nó.
 *
 * Tudo aqui trabalha sobre os passos com id (`run.steps.filter((s) => s.rule)`), a mesma numeração da reprodução.
 */
import type { Env } from "./expr";
import { evaluate, parseExpr, parseStatement, shortValue, withValues } from "./expr";
import { exitsOf, type Run, type Step } from "./logic";
import type { Doc } from "./schema";

/** Passos com id, na ordem (a numeração da reprodução). */
export const playSteps = (run: Run): Step[] => run.steps.filter((s) => s.rule);

/** Os dados logo depois do passo `k` (precisa de um run com `trace`). */
export function valuesAfter(run: Run, k: number): Env {
  const steps = playSteps(run);
  return steps[k + 1]?.before ?? run.env;
}

/** Os dados que o passo `k` mudou (nome → novo valor). */
export const changedAt = (step: Step | undefined): Set<string> => new Set(step?.changes.map((c) => c.name) ?? []);

export interface WhyLine {
  /** o que está escrito no nó */
  code: string;
  /** a mesma coisa com os valores do momento */
  values?: string;
}
export interface Why {
  lines: WhyLine[];
  /** a resposta em palavras: «sim», «caso "imagem"», «volta 3: item = 7» */
  answer?: string;
}

const tryValues = (src: string, env: Env): string | undefined => {
  try {
    return withValues(parseExpr(src), env);
  } catch {
    return undefined;
  }
};

/** Por que o passo fez o que fez, com os valores de antes dele (e de depois, para o item do laço). */
export function whyOf(doc: Doc, step: Step, after?: Env): Why {
  const n = doc.nodes.find((x) => x.id === step.rule);
  const l = n?.logic;
  const env = step.before;
  if (!l || !env) return { lines: [] };
  switch (l.role) {
    case "decision": {
      if (!l.when) return { lines: [] };
      return { lines: [{ code: l.when, values: tryValues(l.when, env) }], answer: step.branch === "sim" ? "sim" : step.branch === "nao" ? "não" : undefined };
    }
    case "switch": {
      if (l.on) {
        let v: string | undefined;
        try {
          v = shortValue(evaluate(parseExpr(l.on), env));
        } catch {
          v = undefined;
        }
        return { lines: [{ code: l.on, values: v }], answer: step.branch === "outros" ? "nenhum caso: «outros»" : `caso ${step.branch}` };
      }
      if (step.branch && step.branch !== "outros") return { lines: [{ code: step.branch, values: tryValues(step.branch, env) }], answer: "este caso valeu" };
      // nenhum caso valeu: mostra todos, para ver por que cada um falhou
      const cases = exitsOf(doc, step.rule).filter((x) => x.case !== undefined);
      return { lines: cases.map((x) => ({ code: x.case!, values: tryValues(x.case!, env) })), answer: "nenhum caso valeu: «outros»" };
    }
    case "table": {
      // as linhas conferidas até a que valeu (as de baixo nem são olhadas), cada uma com os valores
      const rows = l.rows ?? [];
      const hit = step.branch?.startsWith("linha ") ? Number(step.branch.slice(6)) - 1 : rows.length;
      const lines: WhyLine[] = rows.slice(0, hit + 1).map((r, i) => ({ code: `${r.label ? `${r.label}: ` : ""}${r.when}`, values: `${tryValues(r.when, env) ?? r.when}${i === hit ? "  ✔" : "  ✘"}` }));
      if (step.branch === "senão" && l.otherwise) lines.push({ code: `senão: ${l.otherwise.join("; ")}` });
      return { lines, answer: step.branch === "senão" ? "nenhuma linha valeu: «senão»" : step.branch ? `vale a ${step.branch}` : undefined };
    }
    case "loop": {
      if (l.foreach) {
        const as = l.as ?? "item";
        if (step.branch === "repete") return { lines: [{ code: `para cada ${as} em ${l.foreach}`, values: `${as} = ${shortValue(after?.[as])}` }], answer: `volta ${step.turn}` };
        return { lines: [{ code: `para cada ${as} em ${l.foreach}` }], answer: "a lista acabou: segue" };
      }
      const lines: WhyLine[] = [];
      if (l.until) lines.push({ code: `até ${l.until}`, values: tryValues(l.until, env) });
      if (l.max !== undefined) lines.push({ code: `no máximo ${l.max} voltas` });
      return { lines, answer: step.branch === "repete" ? `ainda não parou: volta ${step.turn}` : "parou: segue" };
    }
    case "rule":
    case "call":
    case "code": {
      const effects = (l.role === "rule" ? l.then : l.devolve) ?? [];
      const lines: WhyLine[] = [];
      for (const src of effects) {
        try {
          const s = parseStatement(src);
          lines.push({ code: src, values: s.t === "assign" ? `${s.name} := ${withValues(s.value, env)}` : undefined });
        } catch {
          lines.push({ code: src });
        }
      }
      return { lines, answer: step.branch === "erro" ? "falhou: segue pela seta «erro»" : undefined };
    }
    default:
      return { lines: [] };
  }
}

/* ───────── voltas de laço ───────── */

export interface Turn {
  /** id do laço */
  loop: string;
  label: string;
  /** número da volta (1, 2, …) */
  turn: number;
  /** primeiro e último passo da volta (o primeiro é o próprio laço dizendo «repete») */
  from: number;
  to: number;
  /** 0 = laço de fora */
  depth: number;
  /** índice da volta que contém esta (laço aninhado) */
  parent?: number;
  /** dados que mudaram durante a volta */
  changed: string[];
}

/** Voltas de todos os laços do percurso, na ordem em que começam, e a volta mais interna de cada passo. */
export function loopTurns(steps: Step[]): { turns: Turn[]; turnOf: (number | undefined)[] } {
  const turns: Turn[] = [];
  const turnOf: (number | undefined)[] = [];
  const open: number[] = [];
  const close = (i: number) => {
    const t = open.pop()!;
    turns[t].to = i;
  };
  steps.forEach((s, i) => {
    if (s.role === "loop") {
      // uma nova volta (ou a saída) deste laço fecha a volta anterior dele e as dos laços de dentro
      const at = open.findIndex((t) => turns[t].loop === s.rule);
      if (at >= 0) while (open.length > at) close(i - 1);
      if (s.branch === "repete") {
        const parent = open.at(-1);
        turns.push({ loop: s.rule, label: s.label, turn: s.turn ?? turns.filter((t) => t.loop === s.rule).length + 1, from: i, to: i, depth: open.length, ...(parent !== undefined ? { parent } : {}), changed: [] });
        open.push(turns.length - 1);
      }
    }
    turnOf[i] = open.at(-1);
  });
  while (open.length) close(steps.length - 1);
  for (const t of turns) {
    const names = new Set<string>();
    for (let i = t.from; i <= t.to; i++) for (const c of steps[i].changes) names.add(c.name);
    t.changed = [...names];
  }
  return { turns, turnOf };
}

/** A volta `t` contém o passo `k`? */
export const turnHas = (t: Turn, k: number) => k >= t.from && k <= t.to;

/* ───────── saltos ───────── */

export interface Jumps {
  prevChange?: number;
  nextChange?: number;
  prevTurn?: number;
  nextTurn?: number;
  /** o passo em que o laço atual termina («segue») */
  exitLoop?: number;
  /** o laço atual (o mais interno que contém o passo) */
  loop?: { id: string; label: string; turn: number; turns: number };
}

const isMoment = (s: Step) => s.changes.length > 0 || !!s.error || s.blocked.length > 0;

/** Para onde dá para pular a partir do passo `k`. */
export function jumpsFrom(steps: Step[], k: number, lt = loopTurns(steps)): Jumps {
  const out: Jumps = {};
  for (let i = k + 1; i < steps.length; i++) if (isMoment(steps[i])) { out.nextChange = i; break; }
  for (let i = k - 1; i >= 0; i--) if (isMoment(steps[i])) { out.prevChange = i; break; }
  const ti = lt.turnOf[k];
  if (ti === undefined) return out;
  const cur = lt.turns[ti];
  const same = lt.turns.filter((t) => t.loop === cur.loop);
  // voltas do mesmo laço na mesma execução dele (num laço aninhado, a volta seguinte do de fora recomeça a contagem)
  const run = same.filter((t) => t.parent === cur.parent);
  const idx = run.indexOf(cur);
  out.nextTurn = run[idx + 1]?.from;
  out.prevTurn = k > cur.from ? cur.from : run[idx - 1]?.from;
  // sem «segue» (o fluxo terminou dentro do laço), não há para onde sair
  for (let i = cur.to + 1; i < steps.length; i++) if (steps[i].rule === cur.loop && steps[i].branch === "segue") { out.exitLoop = i; break; }
  out.loop = { id: cur.loop, label: cur.label, turn: cur.turn, turns: run.length };
  return out;
}

/** A próxima vez que o percurso passa pelo nó `id` depois do passo `k` (volta ao começo se não houver). */
export function nextVisit(steps: Step[], id: string, k: number): number | undefined {
  for (let i = k + 1; i < steps.length; i++) if (steps[i].rule === id) return i;
  const first = steps.findIndex((s) => s.rule === id);
  return first >= 0 ? first : undefined;
}

/** Quantas vezes cada nó foi visitado até o passo `k` (inclusive) e em qual passo foi a última. */
export function visitsUpTo(steps: Step[], k: number): Map<string, { count: number; last: number }> {
  const m = new Map<string, { count: number; last: number }>();
  for (let i = 0; i <= k && i < steps.length; i++) {
    const v = m.get(steps[i].rule) ?? { count: 0, last: i };
    v.count++;
    v.last = i;
    m.set(steps[i].rule, v);
  }
  return m;
}

/* ───────── modo Explicar: a execução contada em momentos ───────── */

export interface StoryItem {
  /** passo onde o momento começa (a reprodução pula para ele) e onde termina */
  k: number;
  end: number;
  kind: "start" | "stage" | "turn" | "decision" | "action" | "end" | "error";
  title: string;
  /** a frase de negócio do momento */
  text: string;
  /** saldo do momento: cada dado, do valor antes ao valor depois (sem os intermediários) */
  changes: { name: string; from: unknown; to: unknown }[];
  /** resposta de uma decisão ou a linha da tabela */
  answer?: string;
}

/** Saldo de um trecho: o primeiro «de» e o último «para» de cada dado que mudou (e voltou ao mesmo valor não conta). */
function netChanges(steps: Step[], a: number, b: number): StoryItem["changes"] {
  const m = new Map<string, { name: string; from: unknown; to: unknown }>();
  for (let i = a; i <= b; i++) for (const c of steps[i].changes) m.set(c.name, { name: c.name, from: m.get(c.name)?.from ?? c.from, to: c.to });
  return [...m.values()].filter((c) => JSON.stringify(c.from) !== JSON.stringify(c.to));
}

/**
 * A execução contada em momentos, para quem quer entender (não depurar): com etapas, um momento por passagem numa etapa
 * (com a frase da etapa e o saldo dos dados); sem etapas, uma volta de laço vira um momento e, fora dos laços, cada decisão
 * e cada ação que mudou algo. O início, o fim e um erro sempre aparecem.
 */
export function storyOf(doc: Doc, run: Run): StoryItem[] {
  const steps = playSteps(run);
  const byId = new Map(doc.nodes.map((n) => [n.id, n]));
  const stageOf = (id: string) => {
    const p = byId.get(id)?.parent;
    const g = p ? doc.groups.find((x) => x.id === p && x.stage) : undefined;
    return g;
  };
  const text = (id: string) => byId.get(id)?.logic?.text ?? "";
  const out: StoryItem[] = [];
  const { turns, turnOf } = loopTurns(steps);
  const hasStages = doc.groups.some((g) => g.stage);
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    if (s.error) {
      out.push({ k: i, end: i, kind: "error", title: s.label, text: s.error, changes: [] });
      continue;
    }
    if (s.role === "start") {
      out.push({ k: i, end: i, kind: "start", title: s.label, text: text(s.rule) || "O fluxo começa com os dados do cenário.", changes: [] });
      continue;
    }
    if (s.role === "end") {
      out.push({ k: i, end: i, kind: "end", title: s.label, text: text(s.rule) || (run.outcome === "erro" ? "O fluxo termina com erro." : "O fluxo termina."), changes: [] });
      continue;
    }
    const g = hasStages ? stageOf(s.rule) : undefined;
    if (g) {
      // a passagem inteira pela etapa vira um momento
      let j = i;
      while (j + 1 < steps.length && stageOf(steps[j + 1].rule)?.id === g.id && !steps[j + 1].error) j++;
      out.push({ k: i, end: j, kind: "stage", title: g.label, text: g.stage?.text ?? "", changes: netChanges(steps, i, j) });
      i = j;
      continue;
    }
    const ti = turnOf[i];
    if (!hasStages && ti !== undefined && turns[ti].depth === 0 && turns[ti].from === i) {
      // uma volta do laço de fora vira um momento (os de dentro ficam dentro dele)
      const t = turns[ti];
      out.push({ k: i, end: t.to, kind: "turn", title: `${t.label} · volta ${t.turn}`, text: text(t.loop), changes: netChanges(steps, t.from, t.to) });
      i = t.to;
      continue;
    }
    if (s.role === "decision" || s.role === "switch" || s.role === "table") {
      out.push({ k: i, end: i, kind: "decision", title: s.label, text: text(s.rule), changes: s.changes, answer: s.branch === "nao" ? "não" : s.branch });
      continue;
    }
    if (s.changes.length) out.push({ k: i, end: i, kind: "action", title: s.label, text: text(s.rule), changes: s.changes });
  }
  return out;
}

/** O momento que contém o passo `k` (o último que começa nele ou antes). */
export const storyAt = (story: StoryItem[], k: number): number => {
  let at = 0;
  story.forEach((it, i) => it.k <= k && (at = i));
  return at;
};
