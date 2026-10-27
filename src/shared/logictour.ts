/**
 * Tutorial interativo do diagrama lógico: a pessoa monta a regra do frete grátis **na interface**, do zero.
 *
 * Cada passo aponta um elemento real da tela (o botão da Biblioteca, a peça na Biblioteca, um campo do Inspetor, o
 * Conector, um nó do quadro), diz o que fazer e espera: o passo termina quando o estado do app mostra que a ação foi
 * feita (`check`). Quem quiser ver antes usa **Fazer por mim**: o cursor fantasma demonstra o gesto (`motion`) e o passo
 * aplica o resultado (`ops` no diagrama, `ui` na tela).
 *
 * Aqui fica só o que é puro (testável sem navegador): os passos, os alvos, as condições e as mudanças. A sobreposição, o
 * destaque e o cursor animado estão em `src/ui/logictour.tsx`.
 *
 * Alvos: um seletor CSS, ou `@node:<papel>` para um nó do quadro com aquele papel (o primeiro que ainda falta configurar).
 * Um passo pode ter vários alvos em ordem de preferência: se o campo do Inspetor não está na tela (nada selecionado),
 * o tutorial aponta o nó, para a pessoa clicar nele.
 */
import { checkExamples, dataKey } from "./logic";
import type { Op } from "./ops";
import { validateDetailed } from "./ops";
import type { ConnectionEl, Doc, LogicRole, NodeEl } from "./schema";

export interface TourCtx {
  doc: Doc;
  sel: string[];
  panel: string | null;
  tool: string;
  play: boolean;
  iso: boolean;
}

/** Um nó do quadro: o primeiro daquele papel que falta configurar, ou escolhido por uma função. */
export type NodePick = LogicRole | ((doc: Doc) => NodeEl | undefined);

export interface TourUi {
  panel?: "assets" | null;
  tool?: "select" | "connect";
  iso?: boolean;
  /** começa a reprodução do primeiro cenário */
  play?: boolean;
  /** seleciona o nó (para o Inspetor mostrá-lo) */
  select?: NodePick;
  /** seleciona a seta do passo (`conn`), para o Inspetor da seta */
  selectConn?: boolean;
}

export interface TourStep {
  id: string;
  title: string;
  /** a instrução (markdown curto): o que fazer, onde e por quê */
  text: string;
  /**
   * onde apontar, em ordem de preferência: seletor CSS, `@node:<papel>`, `@node` (o nó de `node`) ou `@conn` (a seta de
   * `conn`). Pode depender do progresso: antes de arrastar a peça, a peça na Biblioteca; depois, o campo do Inspetor
   */
  target?: string[] | ((c: TourCtx) => string[]);
  /** o nó que `@node` aponta */
  node?: (doc: Doc) => NodeEl | undefined;
  /** a seta que `@conn` aponta */
  conn?: (doc: Doc) => ConnectionEl | undefined;
  /** o gesto que o cursor fantasma demonstra: clicar no alvo, ou arrastar do alvo até um ponto do quadro ou até um nó */
  motion?: { kind: "click" } | { kind: "drag"; to: { world: (doc: Doc) => { x: number; y: number } } | { node: NodePick } };
  /**
   * o lugar (canto de cima à esquerda, no quadro) de cada peça que o passo pede, por papel: o tutorial o marca com um
   * contorno «Solte aqui» e encaixa ali a peça solta em outro ponto. Sem isto, vale o destino do gesto (`motion`)
   */
  places?: Partial<Record<LogicRole, (doc: Doc) => { x: number; y: number }>>;
  /** o que «Fazer por mim» muda no diagrama */
  ops?: (doc: Doc) => Op[];
  /** o que «Fazer por mim» muda na tela (antes das ops: abrir painel, escolher ferramenta, selecionar) */
  ui?: TourUi;
  /** o passo está feito? (sem `check`, o passo avança pelo botão) */
  check?: (c: TourCtx) => boolean;
}

/* ───────── leitura do diagrama ───────── */

const nodesOf = (doc: Doc, role: LogicRole) => doc.nodes.filter((n) => n.logic?.role === role);
const first = (doc: Doc, role: LogicRole) => nodesOf(doc, role)[0];
const input = (doc: Doc) => nodesOf(doc, "input")[0];
const output = (doc: Doc) => nodesOf(doc, "output")[0];
const writesFrete = (n: NodeEl) => (n.logic?.then ?? []).some((t) => /^\s*frete\s*:=/.test(t));
const edge = (doc: Doc, from?: NodeEl, to?: NodeEl) => !!from && !!to && doc.connections.some((c) => c.from === from.id && c.to === to.id);
const numberish = (t?: string) => !!t && /^(number|int|float|número|numero|decimal|inteiro)$/i.test(t.trim());

/** O nó de uma escolha: pelo papel (`tourNode`) ou pela função. */
export const pickNode = (doc: Doc, p: NodePick): NodeEl | undefined => (typeof p === "function" ? p(doc) : tourNode(doc, p));
/** Os alvos do passo agora. */
export const targetsNow = (s: TourStep, c: TourCtx): string[] => (typeof s.target === "function" ? s.target(c) : s.target ?? []);

/** O nó que um alvo `@node:<papel>` aponta: o primeiro daquele papel que ainda falta configurar (ou o primeiro). */
export function tourNode(doc: Doc, role: LogicRole): NodeEl | undefined {
  const all = nodesOf(doc, role);
  if (role === "rule") return all.find((n) => !writesFrete(n)) ?? all.find((n) => !doc.connections.some((c) => c.from === n.id)) ?? all[0];
  return all[0];
}

/* ───────── lugares: cada aula é uma grade fixa em volta do Início ─────────
   O fluxo desce numa coluna central, alinhado pelo centro das peças; ramos ficam lado a lado; os dados numa coluna à
   esquerda; o cenário à direita. `slotAt(papel, centro x, topo)` dá o canto de cima à esquerda da peça daquele papel com
   o centro em `centro x` (relativo ao centro do Início) e o topo em `topo` (relativo ao topo do Início). */

/** largura com que cada papel nasce no quadro (para alinhar pelo centro) */
export const ROLE_WIDTH: Partial<Record<LogicRole, number>> = { start: 280, end: 280, decision: 330, rule: 330, table: 480, loop: 340, switch: 380, call: 340, fork: 280, join: 280, input: 250, output: 250, variable: 250, scenario: 320 };
export const slotAt = (role: LogicRole, cx: number, top: number) => (doc: Doc) => {
  const s = first(doc, "start");
  const ox = s ? s.x + s.w / 2 : (ROLE_WIDTH.start ?? 280) / 2;
  const oy = s ? s.y : 0;
  return { x: Math.round(ox + cx - (ROLE_WIDTH[role] ?? 300) / 2), y: Math.round(oy + top) };
};
/** O lugar da peça de um papel neste passo: o marcado em `places`, ou o destino do gesto. */
export function slotFor(step: TourStep, doc: Doc, role?: LogicRole): { x: number; y: number } | undefined {
  if (role && step.places?.[role]) return step.places[role]!(doc);
  return step.motion?.kind === "drag" && "world" in step.motion.to ? step.motion.to.world(doc) : undefined;
}

const POS = {
  start: slotAt("start", 0, 0),
  input: slotAt("input", -620, 0),
  output: slotAt("output", -620, 100),
  decisionDrop: slotAt("decision", 460, 0),
  decision: slotAt("decision", 0, 150),
  ruleSim: slotAt("rule", -220, 320),
  ruleNao: slotAt("rule", 220, 320),
  end: slotAt("end", 0, 500),
  scenario: slotAt("scenario", 680, 0),
};
const place = (id: string, role: LogicRole, p: { x: number; y: number }, extra: Record<string, unknown> = {}, label?: string): Op => ({ op: "add_node", id, ...(label ? { label } : {}), x: Math.round(p.x), y: Math.round(p.y), asset: `logic-${role}`, logic: { role, ...extra } as never });
const patchLogic = (n: NodeEl | undefined, p: Record<string, unknown>): Op[] => (n ? [{ op: "update", id: n.id, patch: { logic: { ...n.logic, ...p } } }] : []);

/* ═════════════════════════════ o tutorial ═════════════════════════════ */

export const TOUR_TITLE = "Seu primeiro diagrama lógico";

export const LOGIC_TOUR: TourStep[] = [
  {
    id: "boas-vindas",
    title: "Vamos montar uma regra do zero",
    text:
      "Neste tutorial você monta, **na interface**, a regra *compras a partir de R$ 200 não pagam frete; abaixo disso o frete é R$ 25*.\n\n" +
      "Em cada passo o tutorial aponta onde clicar ou arrastar e espera você fazer. Se quiser ver antes, use **Fazer por mim**: um cursor mostra o gesto e o passo é feito.\n\n" +
      "O diagrama já está no modo **Logic** (o seletor ao lado do título) e vazio.",
  },
  {
    id: "biblioteca",
    title: "Abra a Biblioteca",
    text: "As peças do diagrama ficam na **Biblioteca**. Clique no botão destacado (ou tecle **B**).",
    target: ['[aria-label="Biblioteca"]'],
    motion: { kind: "click" },
    ui: { panel: "assets" },
    check: (c) => c.panel === "assets" || nodesOf(c.doc, "start").length > 0,
  },
  {
    id: "inicio",
    title: "Arraste o Início para o quadro",
    text: "Todo fluxo começa num **Início**. Arraste a peça **Start** da Biblioteca para o quadro (ou clique nela para colocá-la no centro).",
    target: ['[data-asset="logic-start"]'],
    motion: { kind: "drag", to: { world: POS.start } },
    ui: { panel: "assets" },
    ops: (doc) => [place("inicio", "start", POS.start(doc), {}, "Calcular frete")],
    check: (c) => nodesOf(c.doc, "start").length > 0,
  },
  {
    id: "inicio-frase",
    title: "Configure o Início no Inspetor",
    text:
      "A peça nova fica **selecionada** e o **Inspetor** (à direita) mostra os campos dela. Escreva no campo destacado quando a regra começa, por exemplo *O cliente fecha o carrinho*.\n\n" +
      "Se o Inspetor não estiver aberto, clique no Início.",
    target: ['[data-tour="text"]', "@node:start"],
    motion: { kind: "click" },
    ui: { select: "start" },
    ops: (doc) => patchLogic(first(doc, "start"), { text: "O cliente fecha o carrinho" }),
    check: (c) => !!first(c.doc, "start")?.logic?.text?.trim(),
  },
  {
    id: "entrada",
    title: "Arraste uma Entrada",
    text: "Os dados também são peças. A **Entrada** (`Input`) é o que vem de fora e só é lido: aqui, o subtotal da compra. Arraste-a para a esquerda do Início.",
    target: ['[data-asset="logic-input"]'],
    motion: { kind: "drag", to: { world: POS.input } },
    ui: { panel: "assets" },
    ops: (doc) => [place("in-subtotal", "input", POS.input(doc), {}, "Subtotal")],
    check: (c) => !!input(c.doc),
  },
  {
    id: "entrada-config",
    title: "Dê nome e tipo à Entrada",
    text:
      "No Inspetor, escreva o **nome nas expressões**: `subtotal`. É por ele que as condições e os efeitos leem o dado.\n\n" +
      "Logo abaixo, escolha o **tipo** `number` (os botões de tipo ajudam): o app confere os exemplos contra ele.",
    target: ['[data-tour="key"]', "@node:input"],
    motion: { kind: "click" },
    ui: { select: "input" },
    ops: (doc) => patchLogic(input(doc), { key: "subtotal", type: "number", text: "Soma dos itens do carrinho, em reais" }),
    check: (c) => {
      const n = input(c.doc);
      return !!n && dataKey(n) === "subtotal" && numberish(n.logic?.type);
    },
  },
  {
    id: "resultado",
    title: "Arraste um Resultado",
    text: "O **Resultado** (`Output`) é o que a regra devolve: o frete. Arraste-o para baixo da Entrada.",
    target: ['[data-asset="logic-output"]'],
    motion: { kind: "drag", to: { world: POS.output } },
    ui: { panel: "assets" },
    ops: (doc) => [place("out-frete", "output", POS.output(doc), {}, "Frete")],
    check: (c) => !!output(c.doc),
  },
  {
    id: "resultado-config",
    title: "Nome e tipo do Resultado",
    text: "Como na Entrada: nome `frete`, tipo `number`.",
    target: ['[data-tour="key"]', "@node:output"],
    motion: { kind: "click" },
    ui: { select: "output" },
    ops: (doc) => patchLogic(output(doc), { key: "frete", type: "number", text: "Quanto o cliente paga de frete" }),
    check: (c) => {
      const n = output(c.doc);
      return !!n && dataKey(n) === "frete" && numberish(n.logic?.type);
    },
  },
  {
    id: "decisao",
    title: "Arraste uma Decisão",
    text: "A **Decisão** faz uma pergunta sim/não e escolhe por qual seta o fluxo segue. Arraste a peça **Decision** para o quadro.",
    target: ['[data-asset="logic-decision"]'],
    motion: { kind: "drag", to: { world: POS.decisionDrop } },
    ui: { panel: "assets" },
    ops: (doc) => [place("d-gratis", "decision", POS.decisionDrop(doc), { when: "condicao" }, "Ganha frete grátis?")],
    check: (c) => !!first(c.doc, "decision"),
  },
  {
    id: "mover",
    title: "Mova a Decisão para baixo do Início",
    text: "Peças se movem arrastando no quadro. Arraste a Decisão para **logo abaixo do Início**: o fluxo se lê de cima para baixo.",
    target: ["@node:decision"],
    motion: { kind: "drag", to: { world: POS.decision } },
    ops: (doc) => {
      const d = first(doc, "decision");
      const p = POS.decision(doc);
      return d ? [{ op: "update", id: d.id, patch: { x: Math.round(p.x), y: Math.round(p.y) } }] : [];
    },
    check: (c) => {
      const s = first(c.doc, "start");
      const d = first(c.doc, "decision");
      return !!s && !!d && d.y > s.y + s.h - 4 && Math.abs(d.x + d.w / 2 - (s.x + s.w / 2)) < 160;
    },
  },
  {
    id: "condicao",
    title: "Escreva a condição",
    text:
      "Com a Decisão selecionada, monte no Inspetor a **condição** que vale para o *sim*: `subtotal >= 200` (escolha o dado, o operador `>=` e o valor).\n\n" +
      "Abaixo do campo o app mostra a condição em português, para conferir.",
    target: ['[data-tour="when"]', "@node:decision"],
    motion: { kind: "click" },
    ui: { select: "decision" },
    ops: (doc) => patchLogic(first(doc, "decision"), { when: "subtotal >= 200", text: "A compra chega a R$ 200?" }),
    check: (c) => {
      const w = first(c.doc, "decision")?.logic?.when ?? "";
      return /\bsubtotal\b/.test(w) && /(>=|>)\s*\d/.test(w);
    },
  },
  {
    id: "conector",
    title: "Escolha o Conector",
    text: "Setas ligam um passo ao seguinte. Escolha a ferramenta **Conector** (ou tecle **C**).",
    target: ['[aria-label="Conector"]'],
    motion: { kind: "click" },
    ui: { tool: "connect" },
    check: (c) => c.tool === "connect" || edge(c.doc, first(c.doc, "start"), first(c.doc, "decision")),
  },
  {
    id: "ligar-inicio",
    title: "Ligue o Início à Decisão",
    text: "Com o Conector, **arraste do Início até a Decisão**. A seta mostra a ordem: depois do Início vem a pergunta.",
    target: ["@node:start"],
    motion: { kind: "drag", to: { node: "decision" } },
    ui: { tool: "connect" },
    ops: (doc) => {
      const s = first(doc, "start");
      const d = first(doc, "decision");
      return s && d ? [{ op: "add_connection", from: s.id, to: d.id }] : [];
    },
    check: (c) => edge(c.doc, first(c.doc, "start"), first(c.doc, "decision")),
  },
  {
    id: "acoes",
    title: "Arraste duas Ações",
    text: "A **Ação** muda dados. Precisamos de duas: uma para o frete grátis (*sim*) e outra para o frete fixo (*não*). Arraste **Action** duas vezes, abaixo da Decisão.",
    target: ['[data-asset="logic-rule"]'],
    motion: { kind: "drag", to: { world: POS.ruleSim } },
    places: { rule: (doc) => (nodesOf(doc, "rule").length < 1 ? POS.ruleSim(doc) : POS.ruleNao(doc)) },
    ui: { panel: "assets" },
    ops: (doc) => {
      const have = nodesOf(doc, "rule").length;
      return [
        ...(have < 1 ? [place("a-gratis", "rule", POS.ruleSim(doc), {}, "Frete grátis")] : []),
        ...(have < 2 ? [place("a-cobrar", "rule", POS.ruleNao(doc), {}, "Cobrar frete fixo")] : []),
      ];
    },
    check: (c) => nodesOf(c.doc, "rule").length >= 2,
  },
  {
    id: "efeitos",
    title: "Escreva o efeito de cada Ação",
    text:
      "Selecione a primeira Ação e escreva o **efeito** `frete := 0` (o `:=` quer dizer *passa a valer*). Na outra, `frete := 25`.\n\n" +
      "Uma ação não tem condição: quem escolhe qual delas roda é a Decisão.",
    target: ['[data-tour="then"]', "@node:rule"],
    motion: { kind: "click" },
    ui: { select: "rule" },
    ops: (doc) => {
      const [a, b] = nodesOf(doc, "rule");
      return [...patchLogic(a, { then: ["frete := 0"], text: "Compra grande não paga frete" }), ...patchLogic(b, { then: ["frete := 25"], text: "Abaixo de R$ 200 o frete é fixo" })];
    },
    check: (c) => {
      const rs = nodesOf(c.doc, "rule");
      return rs.length >= 2 && rs.every(writesFrete);
    },
  },
  {
    id: "sim-nao",
    title: "Ligue a Decisão às duas Ações",
    text:
      "Com o Conector, arraste **da Decisão até a Ação do frete grátis** e depois **até a do frete fixo**. A primeira seta que sai de uma decisão nasce **sim**, a segunda **não**.\n\n" +
      "Errou a ordem? Clique na seta e troque a saída no Inspetor.",
    target: ["@node:decision"],
    motion: { kind: "drag", to: { node: "rule" } },
    ui: { tool: "connect" },
    ops: (doc) => {
      const d = first(doc, "decision");
      const rs = nodesOf(doc, "rule");
      const zero = rs.find((r) => (r.logic?.then ?? []).some((t) => /:=\s*0\s*$/.test(t))) ?? rs[0];
      const other = rs.find((r) => r !== zero);
      const out = doc.connections.filter((c) => c.from === d?.id);
      if (!d || !zero || !other) return [];
      return [
        ...(out.some((c) => c.logic?.branch === "sim") ? [] : [{ op: "add_connection", from: d.id, to: zero.id, logic: { branch: "sim" } } as Op]),
        ...(out.some((c) => c.logic?.branch === "nao") ? [] : [{ op: "add_connection", from: d.id, to: other.id, logic: { branch: "nao" } } as Op]),
      ];
    },
    check: (c) => {
      const d = first(c.doc, "decision");
      const rs = new Set(nodesOf(c.doc, "rule").map((r) => r.id));
      const out = c.doc.connections.filter((x) => x.from === d?.id && rs.has(x.to));
      return out.some((x) => x.logic?.branch === "sim") && out.some((x) => x.logic?.branch === "nao");
    },
  },
  {
    id: "fim",
    title: "Arraste o Fim",
    text: "O **Fim** é onde a regra termina e devolve o resultado. Arraste **End** para baixo das Ações.",
    target: ['[data-asset="logic-end"]'],
    motion: { kind: "drag", to: { world: POS.end } },
    ui: { panel: "assets" },
    ops: (doc) => [place("fim", "end", POS.end(doc), {}, "Frete calculado")],
    check: (c) => !!first(c.doc, "end"),
  },
  {
    id: "ligar-fim",
    title: "Ligue as Ações ao Fim",
    text: "Com o Conector, arraste de **cada Ação até o Fim**. Repare no canto de baixo: quando o fluxo fecha, a validação para de reclamar de passos sem saída.",
    target: ["@node:rule"],
    motion: { kind: "drag", to: { node: "end" } },
    ui: { tool: "connect" },
    ops: (doc) => {
      const e = first(doc, "end");
      return e ? nodesOf(doc, "rule").filter((r) => !edge(doc, r, e)).map((r): Op => ({ op: "add_connection", from: r.id, to: e.id })) : [];
    },
    check: (c) => {
      const e = first(c.doc, "end");
      const rs = nodesOf(c.doc, "rule");
      return !!e && rs.length >= 2 && rs.every((r) => edge(c.doc, r, e));
    },
  },
  {
    id: "exemplos",
    title: "Prove a Decisão com exemplos",
    text:
      "Volte à ferramenta de seleção (**V** ou **Esc**), clique na Decisão e, no Inspetor, use **+ Exemplo**: *Dado* `subtotal = 250`, *Esperado* `caminho = \"sim\"`. Faça outro com `subtotal = 80` e `caminho = \"nao\"`.\n\n" +
      "O app executa os exemplos o tempo todo: ✔ quando batem, ✘ quando não.",
    target: ['[data-tour="add-example"]', "@node:decision"],
    motion: { kind: "click" },
    ui: { tool: "select", select: "decision" },
    ops: (doc) =>
      patchLogic(first(doc, "decision"), {
        examples: [
          { name: "R$ 250", given: { subtotal: 250 }, expect: { caminho: "sim" } },
          { name: "R$ 80", given: { subtotal: 80 }, expect: { caminho: "nao" } },
        ],
      }),
    check: (c) => {
      const d = first(c.doc, "decision");
      const exs = d?.logic?.examples ?? [];
      const ok = checkExamples(c.doc).filter((r) => r.node === d?.id && r.ok).length;
      return exs.some((e) => e.expect.caminho === "sim") && exs.some((e) => e.expect.caminho === "nao") && ok >= 2;
    },
  },
  {
    id: "cenario",
    title: "Arraste um Cenário",
    text: "O **Cenário** roda a regra **inteira**, do Início ao Fim, e confere o resultado. Arraste **Scenario** para a direita.",
    target: ['[data-asset="logic-scenario"]'],
    motion: { kind: "drag", to: { world: POS.scenario } },
    ui: { panel: "assets" },
    ops: (doc) => [place("sc-frete", "scenario", POS.scenario(doc), {}, "Carrinhos de exemplo")],
    check: (c) => !!first(c.doc, "scenario"),
  },
  {
    id: "cenario-exemplo",
    title: "O caso do Cenário",
    text:
      "O Cenário já nasce com um caso preenchido com as entradas. Ajuste no Inspetor: *Dado* `subtotal = 250`, *Esperado* `frete = 0` e `desfecho = \"ok\"`.\n\n" +
      "Quando o caso bater, aparece o ✔ e a **Saída obtida** logo abaixo.",
    target: ['[data-tour="examples"]', "@node:scenario"],
    motion: { kind: "click" },
    ui: { tool: "select", select: "scenario" },
    ops: (doc) =>
      patchLogic(first(doc, "scenario"), {
        text: "Roda o fluxo inteiro com carrinhos de exemplo",
        examples: [
          { name: "compra grande", given: { subtotal: 250 }, expect: { frete: 0, desfecho: "ok" } },
          { name: "compra pequena", given: { subtotal: 80 }, expect: { frete: 25, desfecho: "ok" } },
        ],
      }),
    check: (c) => {
      const s = first(c.doc, "scenario");
      const rs = checkExamples(c.doc).filter((r) => r.node === s?.id);
      return !!s && (s.logic?.examples ?? []).some((e) => "frete" in e.expect) && rs.length > 0 && rs.every((r) => r.ok);
    },
  },
  {
    id: "testar",
    title: "Teste: veja a regra rodar",
    text: "No Inspetor do Cenário, clique no caso em **Reproduzir o caminho**. O fluxo anda passo a passo, acendendo o caminho e mostrando os valores.",
    target: ['[data-tour="play"]', "@node:scenario"],
    motion: { kind: "click" },
    ui: { tool: "select", select: "scenario", play: true },
    check: (c) => c.play,
  },
  {
    id: "3d",
    title: "Depure no 3D",
    text:
      "Clique em **3D** na barra de baixo. Na visão 3D, cada passo do teste mostra um cartão com a **condição em TypeScript**, os valores e o que mudou; passe o mouse numa peça já percorrida para ver o cartão dela.\n\n" +
      "Para voltar ao 2D: **Esc** ou o mesmo botão.",
    target: [".iso-toggle"],
    motion: { kind: "click" },
    ui: { iso: true },
    check: (c) => c.iso,
  },
  {
    id: "pronto",
    title: "Pronto: sua primeira regra",
    text:
      "Você usou as peças principais: **Início**, **Entrada**, **Resultado**, **Decisão**, **Ação**, **Fim** e **Cenário**; o **Conector**, o **Inspetor**, os **exemplos**, o **teste** e o **debug 3D**.\n\n" +
      "Repare no selo do canto de baixo: ele lista os **avisos** da validação. As duas Ações ainda não têm exemplo; como exercício, dê a cada uma um exemplo (`frete = 0` e `frete = 25`) e veja o selo virar **Tudo certo**.\n\n" +
      "As próximas aulas mostram o resto, montando passo a passo: **Loop**, **Tabela de decisão**, **Escolha**, **etapas** (Aula 2) e **Chamada HTTP**, **Paralelo**, **travar** (Aula 3).",
  },
];

/** O diagrama completo segundo o tutorial está certo? (o teste confere que «Fazer por mim» em todos os passos chega aqui) */
export const tourDone = (doc: Doc) => validateDetailed(doc).filter((i) => i.severity === "erro").length === 0 && checkExamples(doc).every((r) => r.ok);
