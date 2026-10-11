/**
 * Aparência dos elementos de lógica no quadro. Fonte única do conteúdo e do tamanho: o canvas desenha daqui e as ops usam o
 * mesmo tamanho (seleção, layout, setas).
 *
 * A regra é um cartão de ação (ENTÃO + dados que usa). A decisão, a escolha e o laço são figuras próprias do fluxograma
 * (losango, losango "CASE", cápsula de laço), com a condição escrita em português dentro.
 */
import { branchesOf, explain, explainStatement, parseExpr, parseStatement, readsOf } from "./expr";
import type { NodeEl } from "./schema";
import { truncate, wrapLabel } from "./text";

export const RULE_W = 440;
export const COMPACT_W = 330;
export const FACT_W = 250;
export const FACT_H = 46;
export const SCENARIO_W = 320;
export const TERMINAL_W = 280;
export const TERMINAL_H = 60;
export const BAR_W = 280;
export const BAR_H = 26;
export const CALL_W = 260;
export const CALL_H = 64;

const LINE_H = 15;
export const HEAD_H = 54;
/** Onde começa o conteúdo de cada seção (depois da etiqueta SE / ENTÃO / DADOS). */
export const CARD_X = 76;
const CHARS = 52;

/** Ícones (viewBox 24, traço) de cada elemento do fluxo. */
export const LOGIC_ICON: Record<string, string[]> = {
  start: ["M8 5.5v13L19 12z"],
  end: ["M5 12.5l4.5 4.5L19 7.5"],
  "end-erro": ["M6.5 6.5l11 11", "M17.5 6.5l-11 11"],
  rule: ["M13 2.5L5 13.5h6l-1 8 8-11h-6z"],
  decision: ["M9.2 9a3 3 0 1 1 4.4 2.6c-1 .6-1.6 1.1-1.6 2.4", "M12 17.8h.01"],
  switch: ["M12 3.5v6", "M12 9.5L6 15.5", "M12 9.5l6 6", "M6 15.5v5", "M18 15.5v5"],
  loop: ["M17 3l3.5 3.5L17 10", "M3.5 12v-1.5a4 4 0 0 1 4-4H20.5", "M7 21l-3.5-3.5L7 14", "M20.5 12v1.5a4 4 0 0 1-4 4H3.5"],
  fork: ["M12 3.5v6", "M12 9.5L6 16", "M12 9.5l6 6.5"],
  join: ["M6 8l6 6.5", "M18 8l-6 6.5", "M12 14.5v6"],
  call: ["M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1", "M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"],
};

export interface CardLine {
  text: string;
  /** recuo (ramos de uma escolha) */
  indent?: boolean;
  /** linha de condição de um ramo (destacada) */
  cond?: boolean;
}
/** Dado acoplado ao cartão: lido (contorno) ou escrito (preenchido). */
export interface Chip {
  text: string;
  write: boolean;
  x: number;
  w: number;
  row: number;
}
export interface CardSection {
  kind: "se" | "entao" | "usa";
  label: string;
  lines: CardLine[];
  /** seção "usa": os dados como etiquetas, em linhas */
  chips?: Chip[];
  rows?: number;
}
export interface RuleCard {
  w: number;
  h: number;
  sections: CardSection[];
}

const wrap = (text: string, chars: number, max = 3) => wrapLabel(text, chars, max);
const bad = (s: string): CardLine[] => [{ text: `⚠ ${s}` }];

/** Cartão da regra. Regras curtas ficam mais estreitas, para um leque de ramos (faixas) não ficar largo demais. */
export function ruleCard(n: NodeEl, names: Record<string, string> = {}): RuleCard {
  const full = buildCard(n, names, RULE_W, 52);
  const longest = Math.max(0, ...full.sections.flatMap((s) => s.lines.map((l) => l.text.length + (l.indent ? 3 : 0))), ...full.sections.map((s) => (s.chips ? Math.max(...s.chips.map((c) => c.x + c.w)) / 6.4 : 0)), n.label.length * 1.15);
  // só duas larguras (compacta e cheia): colunas de cartões com larguras quebradas ficam desalinhadas
  const w = longest * 6.4 + CARD_X + 20 <= COMPACT_W ? COMPACT_W : RULE_W;
  return w < RULE_W ? buildCard(n, names, w, Math.floor((w - CARD_X - 20) / 6.4)) : full;
}

function buildCard(n: NodeEl, names: Record<string, string>, RW: number, CH: number): RuleCard {
  const CHARS = CH;
  const l = n.logic!;
  const sections: CardSection[] = [];
  const reads = new Set<string>();

  if (l.when) {
    try {
      const e = parseExpr(l.when);
      readsOf(e, reads);
      sections.push({ kind: "se", label: "SE", lines: wrap(explain(e, names), CHARS).map((text) => ({ text })) });
    } catch {
      sections.push({ kind: "se", label: "SE", lines: bad("condição inválida") });
    }
  }

  const then: CardLine[] = [];
  const copies: { from: string; names: string[] } | undefined = undefined as { from: string; names: string[] } | undefined;
  let copy = copies;
  const flushCopy = () => {
    if (!copy) return;
    const shown = copy.names.slice(0, 6).join(", ");
    const more = copy.names.length > 6 ? ` e mais ${copy.names.length - 6}` : "";
    wrap(`traz de ${copy.from}: ${shown}${more}`, CHARS, 3).forEach((t) => then.push({ text: t }));
    copy = undefined;
  };
  for (const src of l.then ?? []) {
    try {
      const s = parseStatement(src);
      if (s.t === "assign" && s.value.t === "id" && s.value.name.endsWith("." + s.name) && s.value.name.split(".").length === 2) {
        readsOf(s.value, reads);
        const from = s.value.name.split(".")[0];
        if (copy && copy.from !== from) flushCopy();
        copy ??= { from, names: [] };
        copy.names.push(names[s.name] ?? s.name.replace(/_/g, " "));
        continue;
      }
      flushCopy();
      if (s.t === "assign") {
        readsOf(s.value, reads);
        const br = branchesOf(s.value, names);
        const target = names[s.name] ?? s.name.replace(/_/g, " ");
        if (br) {
          then.push({ text: `${target} passa a ser:` });
          for (const b of br) {
            if (b.cond) {
              wrap(`se ${b.cond}`, CHARS - 4, 2).forEach((t, i) => then.push({ text: t, indent: true, cond: i === 0 }));
              wrap(`→ ${b.then}`, CHARS - 6, 2).forEach((t) => then.push({ text: t, indent: true }));
            } else wrap(`senão → ${b.then}`, CHARS - 4, 2).forEach((t) => then.push({ text: t, indent: true, cond: true }));
          }
        } else wrap(explainStatement(s, names), CHARS, 3).forEach((t) => then.push({ text: t }));
      } else wrap(explainStatement(s, names), CHARS, 2).forEach((t) => then.push({ text: t }));
    } catch {
      flushCopy();
      then.push(...bad(`efeito inválido: ${src}`));
    }
  }
  flushCopy();
  if (then.length) sections.push({ kind: "entao", label: "ENTÃO", lines: then });

  // dados acoplados: etiquetas dos dados que o passo lê (contorno) e escreve (preenchido)
  const writes = new Set<string>();
  for (const src of l.then ?? []) {
    try {
      const s = parseStatement(src);
      if (s.t === "assign") writes.add(s.name);
    } catch {
      /* já sinalizado acima */
    }
  }
  const root = (k: string) => (k.includes(".") && !(k in names) ? k.split(".")[0] : k);
  const keys = new Map<string, boolean>();
  for (const r of reads) keys.set(root(r), false);
  for (const wk of writes) keys.set(root(wk), true);
  if (keys.size) {
    const chips: Chip[] = [];
    const maxW = RW - CARD_X - 14;
    let row = 0;
    let x = 0;
    for (const [k, write] of keys) {
      const text = names[k] ?? k.replace(/_/g, " ");
      const cw = Math.min(maxW, Math.round(text.length * 6.3 + 20));
      if (x + cw > maxW && x > 0) {
        row++;
        x = 0;
      }
      chips.push({ text: truncate(text, Math.floor((cw - 18) / 6.3)), write, x, w: cw, row });
      x += cw + 6;
    }
    sections.push({ kind: "usa", label: "DADOS", lines: [], chips, rows: row + 1 });
  }

  const h = HEAD_H + sections.reduce((s, x) => s + (x.chips ? x.rows! * 24 + 10 : Math.max(1, x.lines.length) * LINE_H + 14), 0) + 4;
  return { w: RW, h, sections };
}

/** Texto da condição de uma decisão/escolha/laço, em português, quebrado em linhas para caber na figura. */
export function figureText(n: NodeEl, names: Record<string, string> = {}): { title: string[]; body: string[] } {
  const l = n.logic!;
  const ex = (src?: string) => {
    try {
      return src ? explain(parseExpr(src), names) : "";
    } catch {
      return "⚠ expressão inválida";
    }
  };
  if (l.role === "decision") return { title: wrap(n.label, 30, 2), body: wrap(l.text?.trim() ? l.text : ex(l.when), 40, 3) };
  if (l.role === "switch") return { title: wrap(n.label, 38, 2), body: wrap(l.on ? `conforme ${ex(l.on)}` : l.text?.trim() ? l.text : "a primeira condição que valer", 50, 3) };
  if (l.role === "loop") {
    const parts = [l.foreach ? `para cada ${l.as ?? "item"} em ${ex(l.foreach)}` : "", l.until ? `até ${ex(l.until)}` : "", l.max ? `no máximo ${l.max} voltas` : ""].filter(Boolean);
    return { title: wrap(n.label, 32, 2), body: wrap(parts.join(" · "), 42, 3) };
  }
  return { title: wrap(n.label, 30, 2), body: wrap(l.text ?? "", 36, 2) };
}

/** Título do cenário em até duas linhas (o texto inteiro vai no tooltip e no inspetor). */
export const scenarioTitle = (n: NodeEl): string[] => wrapLabel(n.label, 31, 2);

/** Cenário de falha: algum exemplo espera que o fluxo termine em erro. */
export const isFailureScenario = (n: NodeEl): boolean => n.logic?.role === "scenario" && (n.logic.examples ?? []).some((e) => e.expect.desfecho === "erro");

/** Tamanho que um componente de lógica deve ter no quadro. */
export function logicSize(n: NodeEl, names: Record<string, string> = {}): { w: number; h: number } | undefined {
  const l = n.logic;
  if (!l) return undefined;
  switch (l.role) {
    case "rule": {
      const c = ruleCard(n, names);
      return { w: c.w, h: c.h };
    }
    case "fact":
      return { w: FACT_W, h: FACT_H };
    case "scenario":
      return { w: SCENARIO_W, h: 40 + scenarioTitle(n).length * 15 };
    case "decision":
    case "switch":
    case "loop":
    case "call": {
      const f = figureText(n, names);
      return { w: l.role === "switch" ? 380 : l.role === "decision" ? 330 : 340, h: 58 + f.title.length * 15 + f.body.length * 14 };
    }
    case "fork":
    case "join":
      return { w: BAR_W, h: BAR_H };
    case "call":
      return { w: CALL_W, h: CALL_H };
    default:
      return { w: TERMINAL_W, h: TERMINAL_H };
  }
}
