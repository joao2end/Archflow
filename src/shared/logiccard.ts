/**
 * Aparência dos elementos de lógica no quadro. Fonte única do conteúdo e do tamanho: o canvas desenha daqui e as ops usam o
 * mesmo tamanho (seleção, layout, setas).
 *
 * A regra (Ação) é um cartão só com a composição da ação: os efeitos, sem rótulo e sem área de dados. A decisão, a escolha e o laço são figuras próprias do fluxograma
 * (losango, losango "CASE", cápsula de laço), com a condição escrita em português dentro.
 */
import { COND_OPS, fromText, type CondOp, type Group } from "./conditions";
import { branchesOf, explain, explainStatement, parseExpr, parseStatement, print, readsOf, stripMarks } from "./expr";
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
export const PLAIN_X = 18;
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
  code: ["M8.5 7L3.5 12l5 5", "M15.5 7l5 5-5 5", "M13.5 5l-3 14"],
};

export interface CardLine {
  text: string;
  /** recuo (ramos de uma escolha) */
  indent?: boolean;
  /** linha de condição de um ramo (destacada) */
  cond?: boolean;
}
/** Peça desenhada de uma tabela de condições: célula de dado/valor/expressão, operador, rótulo de grupo E/OU e barra de aninhamento. */
export interface Prim {
  kind: "var" | "lit" | "expr" | "op" | "mode" | "bar";
  x: number;
  y: number;
  w: number;
  h: number;
  /** uma linha por item (células de expressão longa quebram) */
  lines?: string[];
}
export interface BlockLayout {
  w: number;
  h: number;
  /** largura que o conteúdo pede (decide se o cartão pode ser estreito) */
  need: number;
  prims: Prim[];
}
/** Uma linha de texto ou uma tabela, com a altura que ocupa na seção. */
export interface CardItem {
  h: number;
  line?: CardLine;
  block?: BlockLayout;
}

const CHIP_H = 19;
const PITCH = 24;
const OP_W = 46;
const cellH = (lines: number) => (lines <= 1 ? CHIP_H : lines * 13 + 7);

interface Operand {
  kind: "var" | "lit" | "expr";
  text: string;
}
/** Como um operando aparece: dado (nome de negócio), valor literal ou expressão. */
function operandOf(src: string, names: Record<string, string>): Operand {
  try {
    const e = parseExpr(src);
    if (e.t === "id") return { kind: "var", text: names[e.name] ?? (e.name.includes(".") ? e.name : e.name.replace(/_/g, " ")) };
    if (e.t === "num" || e.t === "str" || e.t === "bool" || e.t === "nul" || e.t === "list") return { kind: "lit", text: explain(e, names) };
    return { kind: "expr", text: print(e) };
  } catch {
    return { kind: "expr", text: src };
  }
}

type RowSpec = { left: Operand; op: string; right?: Operand };

type Row = RowSpec | { head: string } | { open: true } | { close: true };

/** Tabela no estilo dos filtros do n8n: colunas dado | operador | valor alinhadas; grupos com TODAS/QUALQUER e barra de recuo. */
function tableLayout(rows: Row[], BW: number): BlockLayout {
  const IND = 12;
  // 1ª passada: o que cada coluna pede e a maior profundidade (as colunas ficam alinhadas entre os níveis)
  let maxL = 0;
  let maxR = 0;
  let maxInd = 0;
  let ind = 0;
  for (const r of rows) {
    if ("open" in r) maxInd = Math.max(maxInd, (ind += IND));
    else if ("close" in r) ind -= IND;
    else if (!("head" in r)) {
      maxL = Math.max(maxL, r.left.text.length * 6.3 + 14);
      maxR = Math.max(maxR, r.right ? r.right.text.length * 6.3 + 14 : 0);
    }
  }
  const hasRight = rows.some((r) => "left" in r && r.right);
  const room = BW - maxInd - OP_W - 8;
  const leftW = hasRight ? Math.max(60, Math.min(Math.ceil(maxL), Math.round(room * 0.55))) : room;
  const leftEnd = maxInd + leftW;
  const rightX = leftEnd + OP_W + 8;
  const rightW = BW - rightX;
  const chars = (w: number) => Math.max(4, Math.floor((w - 14) / 6.3));
  const prims: Prim[] = [];
  const stack: { x: number; y0: number }[] = [];
  let y = 0;
  let x0 = 0;
  for (const r of rows) {
    if ("head" in r) {
      prims.push({ kind: "mode", x: x0, y, w: r.head.length * 6.4 + 16, h: 18, lines: [r.head] });
      y += 22;
    } else if ("open" in r) {
      stack.push({ x: x0, y0: y });
      x0 += IND;
    } else if ("close" in r) {
      const g = stack.pop()!;
      prims.push({ kind: "bar", x: g.x + 3, y: g.y0 - 3, w: 0, h: y - g.y0 });
      x0 = g.x;
    } else {
      const lLines = wrapLabel(r.left.text, chars(leftEnd - x0), 2);
      const rLines = r.right ? wrapLabel(r.right.text, chars(rightW), 3) : [];
      const h = cellH(Math.max(lLines.length, rLines.length));
      prims.push({ kind: r.left.kind, x: x0, y, w: leftEnd - x0, h, lines: lLines });
      if (r.op) prims.push({ kind: "op", x: leftEnd + 4, y, w: OP_W, h: CHIP_H, lines: [r.op] });
      if (r.right) prims.push({ kind: r.right.kind, x: rightX, y, w: rightW, h, lines: rLines });
      y += h + 5;
    }
  }
  return { w: BW, h: Math.max(0, y - 5), need: maxInd + Math.min(maxL, room) + (hasRight ? OP_W + 8 + maxR : OP_W + 8), prims };
}

const OP_SHORT = (op: CondOp) => COND_OPS[op].short;

/** Cartão do SE: a condição como tabela de linhas (dado | operador | valor). */
function conditionRows(g: Group, names: Record<string, string>): Row[] {
  const out: Row[] = [];
  const walk = (grp: Group, top: boolean) => {
    const head = !top || grp.items.length > 1;
    if (head) out.push({ head: grp.mode === "e" ? "TODAS" : "QUALQUER" }, { open: true });
    for (const it of grp.items) {
      if (it.k === "group") walk(it, false);
      else if (it.k === "raw") out.push({ left: operandOf(it.text, names), op: "" });
      else out.push({ left: operandOf(it.left, names), op: OP_SHORT(it.op), right: COND_OPS[it.op].args === 0 ? undefined : { kind: "lit", text: COND_OPS[it.op].args === 2 ? `${operandOf(it.right ?? "", names).text} – ${operandOf(it.right2 ?? "", names).text}` : operandOf(it.right ?? "", names).text } });
    }
    if (head) out.push({ close: true });
  };
  walk(g, true);
  return out;
}

export interface CardSection {
  kind: "se" | "entao";
  label: string;
  lines: CardLine[];
  /** o que se desenha, na ordem: linhas de texto e blocos de expressão */
  items: CardItem[];
}
export interface RuleCard {
  w: number;
  h: number;
  /** onde começa o conteúdo (coluna x) */
  x: number;
  sections: CardSection[];
}

const wrap = (text: string, chars: number, max = 3) => wrapLabel(text, chars, max);
const bad = (s: string): CardLine[] => [{ text: `⚠ ${s}` }];
const lineItem = (line: CardLine): CardItem => ({ h: LINE_H, line });

/** Cartão da regra. Regras curtas ficam mais estreitas, para um leque de ramos (faixas) não ficar largo demais. */
export function ruleCard(n: NodeEl, names: Record<string, string> = {}): RuleCard {
  const X = n.logic?.when ? CARD_X : PLAIN_X;
  const full = buildCard(n, names, RULE_W, Math.floor((RULE_W - X - 20) / 6.4) - 2);
  const longest = Math.max(0, ...full.sections.flatMap((s) => s.items.map((it) => (it.block ? it.block.need / 6.4 : stripMarks(it.line!.text).length + (it.line!.indent ? 3 : 0)))), n.label.length * 1.15);
  // só duas larguras (compacta e cheia): colunas de cartões com larguras quebradas ficam desalinhadas
  const w = longest * 6.4 + X + 20 <= COMPACT_W ? COMPACT_W : RULE_W;
  return w < RULE_W ? buildCard(n, names, w, Math.floor((w - X - 20) / 6.4) - 2, X) : full;
}

function buildCard(n: NodeEl, names: Record<string, string>, RW: number, CH: number, X = n.logic?.when ? CARD_X : PLAIN_X): RuleCard {
  const CHARS = CH;
  const l = n.logic!;
  const sections: CardSection[] = [];
  const reads = new Set<string>();
  const BW = RW - X - 14;

  if (l.when) {
    try {
      const e = parseExpr(l.when);
      readsOf(e, reads);
      const g = fromText(l.when);
      if (!g) throw new Error("condição inválida");
      const block = tableLayout(conditionRows(g, names), BW);
      if (block.prims.length) sections.push({ kind: "se", label: "SE", lines: [], items: [{ h: block.h + 2, block }] });
    } catch {
      sections.push({ kind: "se", label: "SE", lines: bad("condição inválida"), items: bad("condição inválida").map(lineItem) });
    }
  }

  const then: CardLine[] = [];
  const thenItems: CardItem[] = [];
  const pushLine = (...ls: CardLine[]) => {
    then.push(...ls);
    thenItems.push(...ls.map(lineItem));
  };
  const copies: { from: string; names: string[] } | undefined = undefined as { from: string; names: string[] } | undefined;
  let copy = copies;
  const flushCopy = () => {
    if (!copy) return;
    const shown = copy.names.slice(0, 6).join(", ");
    const more = copy.names.length > 6 ? ` e mais ${copy.names.length - 6}` : "";
    wrap(`traz de ${copy.from}: ${shown}${more}`, CHARS, 3).forEach((t) => pushLine({ text: t }));
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
        const br = branchesOf(s.value, names, true);
        const target = `${names[s.name] ?? s.name.replace(/_/g, " ")}`;
        if (br) {
          pushLine({ text: `${target} passa a ser:` });
          for (const b of br) {
            if (b.cond) {
              wrap(`se ${b.cond}`, CHARS - 4, 2).forEach((t, i) => pushLine({ text: t, indent: true, cond: i === 0 }));
              wrap(`→ ${b.then}`, CHARS - 6, 2).forEach((t) => pushLine({ text: t, indent: true }));
            } else wrap(`senão → ${b.then}`, CHARS - 4, 2).forEach((t) => pushLine({ text: t, indent: true, cond: true }));
          }
        } else {
          // uma linha "dado := valor", nas mesmas colunas das condições
          const block = tableLayout([{ left: { kind: "var", text: stripMarks(target) }, op: ":=", right: operandOf(print(s.value), names) }], BW);
          then.push({ text: explainStatement(s, names) });
          thenItems.push({ h: block.h + 2, block });
        }
      } else wrap(explainStatement(s, names, true), CHARS, 2).forEach((t) => pushLine({ text: t }));
    } catch {
      flushCopy();
      pushLine(...bad(`efeito inválido: ${src}`));
    }
  }
  flushCopy();
  if (then.length) sections.push({ kind: "entao", label: l.when ? "ENTÃO" : "", lines: then, items: thenItems });

  const h = HEAD_H + sections.reduce((s, x) => s + Math.max(LINE_H, x.items.reduce((a, it) => a + it.h, 0)) + 14, 0) + 4;
  return { w: RW, h, x: X, sections };
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
  if (l.role === "code") return { title: wrap(n.label, 30, 2), body: wrap([l.text, l.code ? l.code.trim().split("\n")[0] : "", l.devolve?.length ? `devolve ${l.devolve.map((t) => t.split(":=")[0].trim()).join(", ")}` : ""].filter(Boolean).join(" · "), 36, 3) };
  if (l.role === "start" && l.trigger && l.trigger.kind !== "manual") return { title: wrap(n.label, 30, 2), body: wrap([l.text, l.trigger.kind === "webhook" ? `webhook ${l.trigger.method ?? "POST"} ${l.trigger.path ?? "/"}` : `agenda ${l.trigger.cron ?? ""}`].filter(Boolean).join(" · "), 36, 3) };
  if (l.role === "call") return { title: wrap(n.label, 30, 2), body: wrap([l.text, l.request ? `${l.request.method} ${l.request.url.replace(/^"|"$/g, "")}` : "", l.falha ? `falha quando ${ex(l.falha)}` : "", l.devolve?.length ? `devolve ${l.devolve.map((t) => t.split(":=")[0].trim()).join(", ")}` : ""].filter(Boolean).join(" · "), 36, 3) };
  return { title: wrap(n.label, 30, 2), body: wrap(l.text ?? "", 36, 2) };
}

/** Título do cenário em até duas linhas (o texto inteiro vai no tooltip e no inspetor). */
export const scenarioTitle = (n: NodeEl): string[] => wrapLabel(n.label, 31, 2);

/** Cenário de falha: algum exemplo espera que o fluxo termine em erro. */
export const isFailureScenario = (n: NodeEl): boolean => n.logic?.role === "scenario" && (n.logic.examples ?? []).some((e) => e.expect.desfecho === "erro");

/** Altura de cada linha da descrição nos cartões de dado e de cenário. */
export const DESC_LINE_H = 14;
/** Até quantas linhas a descrição completa ocupa (o resto vai no tooltip e no inspetor). */
const DESC_MAX = 12;

/**
 * Descrição de um dado (Input/Output/Variable) ou de um cenário, quebrada para caber no cartão. Fechada, é uma linha só
 * (com reticências); com `full` (botão «Visualizar descrições»), o texto inteiro.
 */
export function descLines(n: NodeEl, full = false): string[] {
  const l = n.logic;
  if (!l || !(isDescRole(l.role))) return [];
  const text = (l.text ?? n.description ?? "").replace(/\s+/g, " ").trim();
  if (!text) return [];
  const chars = l.role === "scenario" ? Math.floor((SCENARIO_W - 58 - 14) / 6.3) : Math.floor((FACT_W - 32 - 12) / 6.3);
  if (!full) return [truncate(text, chars)];
  return wrapLabel(text, chars, DESC_MAX);
}
const isDescRole = (role: string) => role === "input" || role === "output" || role === "variable" || role === "scenario";
const descH = (lines: string[]) => (lines.length ? lines.length * DESC_LINE_H + 4 : 0);

/** Tamanho que um componente de lógica deve ter no quadro. `fullDesc`: descrições completas (Doc.showDescriptions). */
export function logicSize(n: NodeEl, names: Record<string, string> = {}, fullDesc = false): { w: number; h: number } | undefined {
  const l = n.logic;
  if (!l) return undefined;
  switch (l.role) {
    case "rule": {
      const c = ruleCard(n, names);
      return { w: c.w, h: c.h };
    }
    case "input":
    case "output":
    case "variable":
      return { w: FACT_W, h: FACT_H + descH(descLines(n, fullDesc)) };
    case "scenario":
      return { w: SCENARIO_W, h: 40 + scenarioTitle(n).length * 15 + descH(descLines(n, fullDesc)) };
    case "decision":
    case "switch":
    case "loop":
    case "code":
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
