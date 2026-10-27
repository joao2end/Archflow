/**
 * As aulas do diagrama lógico, todas no modelo de tutorial interativo (`logictour.ts`): o diagrama começa vazio e a pessoa
 * monta a regra na interface; cada passo aponta o elemento da tela, espera a ação e tem «Fazer por mim».
 *
 *  1. Seu primeiro diagrama lógico (simples): Biblioteca, Inspetor, Conector, Início, Entrada, Resultado, Decisão, Ação,
 *     Fim, exemplos, cenário, teste e debug 3D.
 *  2. Pontos de fidelidade (médio): Variável com valor inicial, tipos de lista e união, Loop «para cada», Tabela de
 *     decisão, Escolha (switch) com casos nas setas, fim com erro, etapa e cenários por caminho.
 *  3. Aprovação de crédito (complexo): gatilho webhook, Chamada HTTP com resposta simulada, «devolve» e falha (seta
 *     «erro»), Paralelo e Junção, travar/destravar, etapas e um cenário por desfecho no debug 3D.
 *
 * O «Fazer por mim» de cada passo reaproveita a peça que a pessoa já arrastou e ainda não configurou (a que está «em
 * branco») e só cria o que falta, para nunca duplicar peças. Um teste confere, para cada aula, que o «Fazer por mim» em
 * todos os passos conclui cada passo e chega a uma regra que valida e cujos exemplos e cenários batem.
 */
import { checkExamples, dataKey } from "./logic";
import { LOGIC_TOUR, TOUR_TITLE, type TourCtx, type TourStep } from "./logictour";
import type { Op } from "./ops";
import { emptyDoc, type ConnectionEl, type Doc, type LogicExample, type LogicRole, type NodeEl } from "./schema";

export interface LogicTourDef {
  /** chave no catálogo de exemplos */
  key: string;
  n: number;
  title: string;
  level: "iniciante" | "intermediário" | "avançado";
  summary: string;
  teaches: string[];
  docId: string;
  path: string;
  /** a regra que a aula monta (descrição do diagrama) */
  description: string;
  steps: TourStep[];
  /** chave da aula seguinte */
  next?: string;
}

export const LOGIC_LESSONS_DIR = "exemplos-logic/aulas";

/* ───────── leitura e montagem ───────── */

type Pt = { x: number; y: number };
const nodesOf = (doc: Doc, role: LogicRole) => doc.nodes.filter((n) => n.logic?.role === role);
const dataNode = (doc: Doc, key: string) => doc.nodes.find((n) => (n.logic?.role === "input" || n.logic?.role === "output" || n.logic?.role === "variable") && n.logic.key && dataKey(n) === key);
const out = (doc: Doc, n?: NodeEl) => (n ? doc.connections.filter((c) => c.from === n.id) : []);
const into = (doc: Doc, n?: NodeEl) => (n ? doc.connections.filter((c) => c.to === n.id) : []);
const edgeTo = (doc: Doc, from?: NodeEl, to?: NodeEl, test: (c: ConnectionEl) => boolean = () => true) => !!from && !!to && doc.connections.some((c) => c.from === from.id && c.to === to.id && test(c));
const thenText = (n: NodeEl) => [...(n.logic?.then ?? []), ...(n.logic?.devolve ?? [])].join("\n");
const ruleMatching = (doc: Doc, re: RegExp) => nodesOf(doc, "rule").find((n) => re.test(thenText(n)));

/** A peça ainda «em branco»: acabou de sair da Biblioteca e ninguém a configurou. */
function blank(doc: Doc, n: NodeEl): boolean {
  const l = n.logic!;
  switch (l.role) {
    case "rule":
      return !(l.then ?? []).length;
    case "decision":
      return !l.when || l.when === "condicao";
    case "loop":
      return !l.foreach && (!l.until || l.until === "condicao");
    case "table":
      return !(l.rows ?? []).length;
    case "switch":
      return !l.on;
    case "call":
      return !l.request;
    case "input":
    case "output":
    case "variable":
      return !l.key;
    case "end":
    case "fork":
    case "join":
      return !into(doc, n).length && !out(doc, n).length;
    default:
      return false;
  }
}
const blankOf = (doc: Doc, role: LogicRole) => nodesOf(doc, role).find((n) => blank(doc, n));

const origin = (doc: Doc): Pt => {
  const s = nodesOf(doc, "start")[0];
  return s ? { x: s.x, y: s.y } : { x: 0, y: 0 };
};
const at = (dx: number, dy: number) => (doc: Doc): Pt => {
  const o = origin(doc);
  return { x: o.x + dx, y: o.y + dy };
};
const fresh = (doc: Doc, id: string) => {
  let k = id;
  for (let i = 2; doc.nodes.some((n) => n.id === k) || doc.groups.some((g) => g.id === k); i++) k = `${id}-${i}`;
  return k;
};

/**
 * Garante uma peça: se já existe uma que cumpre `is`, nada; se há uma do mesmo papel em branco, configura essa; senão,
 * cria. Devolve as ops e o id, para as setas do mesmo passo.
 */
function ensure(doc: Doc, o: { id: string; role: LogicRole; label: string; pos: (d: Doc) => Pt; logic: Record<string, unknown>; is: (n: NodeEl) => boolean }): { ops: Op[]; id: string } {
  const have = nodesOf(doc, o.role).find(o.is);
  if (have) return { ops: [], id: have.id };
  const b = blankOf(doc, o.role);
  if (b) return { ops: [{ op: "update", id: b.id, patch: { label: o.label, logic: { role: o.role, ...o.logic } } }], id: b.id };
  const id = fresh(doc, o.id);
  const p = o.pos(doc);
  return { ops: [{ op: "add_node", id, label: o.label, x: Math.round(p.x), y: Math.round(p.y), asset: `logic-${o.role}`, logic: { role: o.role, ...o.logic } as never }], id };
}

/** Garante uma seta (com a saída ou o caso); se já há uma seta entre os dois com outra saída, corrige essa. */
function link(doc: Doc, from: string, to: string, logic?: { branch?: string; case?: string }): Op[] {
  const same = doc.connections.find((c) => c.from === from && c.to === to);
  const ok = (c: ConnectionEl) => (logic?.branch === undefined || c.logic?.branch === logic.branch) && (logic?.case === undefined || c.logic?.case === logic.case);
  if (same && ok(same)) return [];
  if (same && logic) return [{ op: "update", id: same.id, patch: { logic } }];
  return [{ op: "add_connection", from, to, ...(logic ? { logic } : {}) } as Op];
}

/** Aplica, em sequência, montagens que dependem umas das outras (o id de uma peça criada serve à seta seguinte). */
function steps(doc: Doc, parts: ((d: Doc, ids: Record<string, string>) => { ops: Op[]; id?: string; name?: string })[]): Op[] {
  const ids: Record<string, string> = {};
  const all: Op[] = [];
  let d = doc;
  for (const p of parts) {
    const r = p(d, ids);
    if (r.name && r.id) ids[r.name] = r.id;
    all.push(...r.ops);
    d = simulate(d, r.ops);
  }
  return all;
}
/** O diagrama depois das ops (só o que as montagens seguintes precisam ver: peças e setas). */
function simulate(doc: Doc, ops: Op[]): Doc {
  const d: Doc = { ...doc, nodes: [...doc.nodes], connections: [...doc.connections] };
  for (const op of ops) {
    if (op.op === "add_node") d.nodes.push({ id: op.id!, label: op.label ?? "", kind: "logic", x: op.x ?? 0, y: op.y ?? 0, w: 280, h: 60, logic: op.logic } as NodeEl);
    if (op.op === "update") d.nodes = d.nodes.map((n) => (n.id === op.id ? ({ ...n, ...op.patch } as NodeEl) : n));
    if (op.op === "add_connection") d.connections.push({ id: `${op.from}->${op.to}`, from: op.from, to: op.to, type: "sync", logic: (op as { logic?: ConnectionEl["logic"] }).logic } as ConnectionEl);
  }
  return d;
}

/** Garante dados (entradas, resultados, variáveis): cada um com nome, tipo e texto; configura os que estão em branco. */
function dataOps(doc: Doc, role: "input" | "output" | "variable", items: { key: string; type: string; text: string; label: string; value?: unknown; pos: (d: Doc) => Pt }[]): Op[] {
  return steps(
    doc,
    items.map((it) => (d) => ensure(d, { id: `${role === "input" ? "in" : role === "output" ? "out" : "v"}-${it.key.replace(/_/g, "-")}`, role, label: it.label, pos: it.pos, logic: { key: it.key, type: it.type, text: it.text, ...(it.value !== undefined ? { value: it.value } : {}) }, is: (n) => n.logic?.key === it.key })),
  );
}

const squash = (t?: string) => (t ?? "").replace(/\s+/g, "").replace(/'/g, '"').replace(/;(?=})/g, "");
const NUMERIC = /^(number|int|float|número|numero|decimal|inteiro)$/i;
/** O tipo escrito confere com o esperado (sem ligar para espaços, aspas simples ou `;` no fim do objeto). */
const typeLike = (actual: string | undefined, expected: string) => (NUMERIC.test(expected) ? NUMERIC.test((actual ?? "").trim()) && (expected !== "int" || /^(int|inteiro)$/i.test((actual ?? "").trim())) : squash(actual) === squash(expected));

/** Alvo que acompanha o progresso: a peça na Biblioteca até ela existir; depois o campo do Inspetor (ou o nó). */
const pieceOrField = (role: LogicRole, field: string[], pending: (doc: Doc) => NodeEl | undefined) => (c: TourCtx) => (pending(c.doc) ? [...field, "@node"] : [`[data-asset="logic-${role}"]`]);

/** Dados: o primeiro que falta, ou o primeiro em branco para configurar. */
function dataStep(o: { id: string; title: string; text: string; role: "input" | "output" | "variable"; items: { key: string; type: string; text: string; label: string; value?: unknown; pos: (d: Doc) => Pt }[]; field?: string[] }): TourStep {
  const missing = (doc: Doc) => o.items.filter((it) => {
    const n = dataNode(doc, it.key);
    return !n || n.logic!.role !== o.role || !typeLike(n.logic!.type, it.type) || (it.value !== undefined && JSON.stringify(n.logic!.value) !== JSON.stringify(it.value));
  });
  const pending = (doc: Doc) => (missing(doc).length ? nodesOf(doc, o.role).find((n) => blank(doc, n) || o.items.some((it) => it.key === n.logic!.key && missing(doc).includes(it))) : undefined);
  return {
    id: o.id,
    title: o.title,
    text: o.text,
    target: pieceOrField(o.role, o.field ?? ['[data-tour="key"]'], pending),
    node: pending,
    motion: { kind: "drag", to: { world: (d) => (missing(d)[0] ?? o.items[0]).pos(d) } },
    ui: { panel: "assets", select: pending },
    ops: (doc) => dataOps(doc, o.role, o.items),
    check: (c) => missing(c.doc).length === 0,
  };
}

const ex = (name: string, given: Record<string, unknown>, expect: Record<string, unknown>) => ({ name, given, expect }) as LogicExample;
const scenarioOk = (doc: Doc, min: number, extra: (exs: LogicExample[]) => boolean) => {
  const s = nodesOf(doc, "scenario")[0];
  const exs = s?.logic?.examples ?? [];
  const rs = checkExamples(doc).filter((r) => r.node === s?.id);
  return !!s && exs.length >= min && rs.length === exs.length && rs.every((r) => r.ok) && extra(exs);
};

/* ═════════════════════════════ Aula 2 · Pontos de fidelidade ═════════════════════════════ */

const P2 = {
  start: (d: Doc) => (nodesOf(d, "start")[0] ? origin(d) : { x: 0, y: 0 }),
  data: (i: number) => at(-420, i * 110),
  loop: at(0, 150),
  table: at(340, 150),
  somar: at(340, 300),
  sw: at(0, 330),
  dobrar: at(220, 480),
  bloquear: at(-200, 480),
  fimErro: at(-200, 640),
  faixa: at(220, 640),
  fechar: at(220, 800),
  fim: at(220, 960),
  scenario: at(720, 0),
};
const loopOf = (d: Doc) => nodesOf(d, "loop")[0];
const multTable = (d: Doc) => nodesOf(d, "table").find((n) => /\bmult\s*:=/.test(JSON.stringify(n.logic)));
const faixaTable = (d: Doc) => nodesOf(d, "table").find((n) => /diamante/.test(JSON.stringify(n.logic)));
const somar = (d: Doc) => ruleMatching(d, /pontos\s*:=\s*pontos\s*\+/);
const dobrar = (d: Doc) => ruleMatching(d, /pontos\s*:=\s*pontos\s*\*\s*2/);
const bloquear = (d: Doc) => ruleMatching(d, /faixa\s*:=\s*"bloqueado"/);
const fechar = (d: Doc) => ruleMatching(d, /total\s*:=\s*pontos\s*$/m);
const sw2 = (d: Doc) => nodesOf(d, "switch")[0];
const MULT_ROWS = { text: "Quanto cada categoria rende por real gasto", rows: [{ label: "Farmácia", when: 'compra.categoria = "farmacia"', then: ["mult := 2"] }, { label: "Mercado e padaria", when: 'compra.categoria em ["mercado", "padaria"]', then: ["mult := 1.5"] }], otherwise: ["mult := 1"], examples: [ex("farmácia", { compra: { valor: 10, categoria: "farmacia" } }, { mult: 2 }), ex("roupa", { compra: { valor: 10, categoria: "roupa" } }, { mult: 1 })] };
const FAIXA_ROWS = { text: "A faixa pelo total de pontos", rows: [{ label: "1000 ou mais", when: "pontos >= 1000", then: ['faixa := "diamante"'] }, { label: "300 ou mais", when: "pontos >= 300", then: ['faixa := "ouro"'] }], otherwise: ['faixa := "comum"'], examples: [ex("1200", { pontos: 1200 }, { faixa: "diamante" }), ex("299", { pontos: 299 }, { faixa: "comum" })] };
const isCase = (v: string) => (c: ConnectionEl) => c.logic?.case === v;
const provisional = (d: Doc) => out(d, sw2(d)).find((c) => c.logic?.case !== undefined && /^"valor\d*"$/.test(c.logic.case));

const aula2: TourStep[] = [
  {
    id: "abertura",
    title: "Aula 2: laços, tabelas e escolhas",
    text:
      "Você vai montar a regra *cada compra do mês dá pontos conforme a categoria; cliente ouro dobra; o total define a faixa; cliente bloqueado não pontua*.\n\n" +
      "As peças novas desta aula: **Variável**, **Loop**, **Tabela de decisão**, **Escolha** e **etapas**. Como na Aula 1, o tutorial aponta cada clique e espera; **Fazer por mim** mostra o gesto.",
  },
  {
    id: "inicio",
    title: "Comece pelo Início",
    text: "Abra a **Biblioteca** (tecla **B**) e arraste o **Start**. No Inspetor, escreva a frase: *Fim do mês: calcula os pontos do cliente*.",
    target: (c) => (nodesOf(c.doc, "start").length ? ['[data-tour="text"]', "@node:start"] : ['[data-asset="logic-start"]']),
    motion: { kind: "drag", to: { world: P2.start } },
    ui: { panel: "assets", select: "start" },
    ops: (d) => {
      const s = nodesOf(d, "start")[0];
      return s ? [{ op: "update", id: s.id, patch: { label: "Fechar o mês", logic: { ...s.logic, text: "Fim do mês: calcula os pontos do cliente" } } }] : [{ op: "add_node", id: "inicio", label: "Fechar o mês", x: 0, y: 0, asset: "logic-start", logic: { role: "start", text: "Fim do mês: calcula os pontos do cliente" } as never }];
    },
    check: (c) => !!nodesOf(c.doc, "start")[0]?.logic?.text?.trim(),
  },
  dataStep({
    id: "entradas",
    title: "Duas Entradas com tipos ricos",
    text:
      "Arraste duas **Entradas** e configure no Inspetor:\n\n" +
      "- `compras`, tipo `{ valor: number; categoria: string }[]`: uma **lista de objetos**.\n" +
      "- `nivel`, tipo `\"bronze\" | \"prata\" | \"ouro\" | \"bloqueado\"`: só esses quatro textos (uma **união**).\n\n" +
      "Os botões de tipo debaixo do campo ajudam; o app confere os exemplos contra o tipo.",
    role: "input",
    field: ['[data-tour="key"]', '[data-tour="type"]'],
    items: [
      { key: "compras", type: "{ valor: number; categoria: string }[]", text: "Compras do mês", label: "Compras", pos: P2.data(0) },
      { key: "nivel", type: '"bronze" | "prata" | "ouro" | "bloqueado"', text: "Nível no programa de fidelidade", label: "Nível do cliente", pos: P2.data(1) },
    ],
  }),
  dataStep({
    id: "variaveis",
    title: "Variáveis: o que se calcula no caminho",
    text:
      "A **Variável** é um dado intermediário: criado e reescrito dentro do fluxo. Arraste duas:\n\n" +
      "- `pontos`, tipo `int`, **valor inicial** `0` (o campo *Valor inicial*): é o acumulado.\n" +
      "- `mult`, tipo `number`: o multiplicador da compra da vez.",
    role: "variable",
    field: ['[data-tour="key"]', '[data-tour="value"]'],
    items: [
      { key: "pontos", type: "int", text: "Soma dos pontos, volta a volta", label: "Pontos", value: 0, pos: P2.data(2) },
      { key: "mult", type: "number", text: "Pontos por real da categoria", label: "Multiplicador", pos: P2.data(3) },
    ],
  }),
  dataStep({
    id: "resultados",
    title: "Dois Resultados",
    text: "Arraste dois **Resultados**: `total` (tipo `int`) e `faixa` (tipo `string`).",
    role: "output",
    items: [
      { key: "total", type: "int", text: "Pontos do mês", label: "Total de pontos", pos: P2.data(4) },
      { key: "faixa", type: "string", text: "comum, ouro, diamante ou bloqueado", label: "Faixa", pos: P2.data(5) },
    ],
  }),
  {
    id: "loop",
    title: "O Loop: uma volta por compra",
    text:
      "Arraste o **Loop** para baixo do Início. No Inspetor, em **Para cada item de (lista)**, escreva `compras`; em **Nome do item em cada volta**, `compra`.\n\n" +
      "Em cada volta, a compra da vez fica no dado `compra`. Lista vazia dá zero voltas.",
    target: pieceOrField("loop", ['[data-tour="foreach"]'], (d) => (loopOf(d) && loopOf(d)!.logic!.foreach !== "compras" ? loopOf(d) : undefined)),
    node: loopOf,
    motion: { kind: "drag", to: { world: P2.loop } },
    ui: { panel: "assets", select: loopOf },
    ops: (d) => ensure(d, { id: "l-compras", role: "loop", label: "Para cada compra", pos: P2.loop, logic: { text: "Uma volta por compra do mês", foreach: "compras", as: "compra" }, is: (n) => n.logic?.foreach === "compras" }).ops,
    check: (c) => loopOf(c.doc)?.logic?.foreach === "compras" && loopOf(c.doc)?.logic?.as === "compra",
  },
  {
    id: "ligar-loop",
    title: "Ligue o Início ao Loop",
    text: "Com o **Conector** (tecla **C**), arraste do Início até o Loop.",
    target: ['[aria-label="Conector"]', "@node:start"],
    motion: { kind: "drag", to: { node: "loop" } },
    ui: { tool: "connect" },
    ops: (d) => (nodesOf(d, "start")[0] && loopOf(d) ? link(d, nodesOf(d, "start")[0].id, loopOf(d)!.id) : []),
    check: (c) => edgeTo(c.doc, nodesOf(c.doc, "start")[0], loopOf(c.doc)),
  },
  {
    id: "tabela",
    title: "A Tabela de decisão: o multiplicador",
    text:
      "Quando cada caminho só **atribui um valor**, use a **Tabela**. Arraste **Table** para a direita do Loop e, no Inspetor, preencha as linhas em ordem (vale a **primeira** verdadeira):\n\n" +
      "- `compra.categoria = \"farmacia\"` → `mult := 2`\n" +
      "- `compra.categoria em [\"mercado\", \"padaria\"]` → `mult := 1.5`\n" +
      "- **senão** → `mult := 1`",
    target: pieceOrField("table", ['[data-tour="rows"]'], (d) => (multTable(d) ? undefined : blankOf(d, "table"))),
    node: (d) => blankOf(d, "table") ?? multTable(d),
    motion: { kind: "drag", to: { world: P2.table } },
    ui: { panel: "assets", select: (d) => blankOf(d, "table") ?? multTable(d) },
    ops: (d) => ensure(d, { id: "t-mult", role: "table", label: "Pontos por real", pos: P2.table, logic: MULT_ROWS, is: (n) => n === multTable(d) }).ops,
    check: (c) => {
      const t = multTable(c.doc);
      return !!t && (t.logic!.rows ?? []).length >= 2 && (t.logic!.otherwise ?? []).some((x) => /mult\s*:=/.test(x));
    },
  },
  {
    id: "somar",
    title: "A Ação que acumula",
    text: "Arraste uma **Action** para baixo da Tabela, com o efeito `pontos := pontos + piso(compra.valor * mult)`. `piso` tira a fração.",
    target: pieceOrField("rule", ['[data-tour="then"]'], (d) => (somar(d) ? undefined : blankOf(d, "rule"))),
    node: (d) => blankOf(d, "rule") ?? somar(d),
    motion: { kind: "drag", to: { world: P2.somar } },
    ui: { panel: "assets", select: (d) => blankOf(d, "rule") ?? somar(d) },
    ops: (d) => ensure(d, { id: "a-somar", role: "rule", label: "Somar a compra", pos: P2.somar, logic: { text: "Pontos da compra entram no acumulado", then: ["pontos := pontos + piso(compra.valor * mult)"], examples: [ex("50 × 1,5", { pontos: 10, compra: { valor: 50, categoria: "mercado" }, mult: 1.5 }, { pontos: 85 })] }, is: (n) => n === somar(d) }).ops,
    check: (c) => !!somar(c.doc),
  },
  {
    id: "corpo",
    title: "Feche a volta",
    text:
      "Com o Conector: **Loop → Tabela** (a primeira seta de um loop é **repete**: o corpo da volta), **Tabela → Ação** e **Ação → Loop** (volta para a próxima compra).",
    target: ['[aria-label="Conector"]', "@node:loop"],
    motion: { kind: "drag", to: { node: (d) => multTable(d) } },
    ui: { tool: "connect" },
    ops: (d) => {
      const l = loopOf(d);
      const t = multTable(d);
      const a = somar(d);
      return l && t && a ? [...link(d, l.id, t.id, { branch: "repete" }), ...link(d, t.id, a.id), ...link(d, a.id, l.id)] : [];
    },
    check: (c) => edgeTo(c.doc, loopOf(c.doc), multTable(c.doc), (x) => x.logic?.branch === "repete") && edgeTo(c.doc, multTable(c.doc), somar(c.doc)) && edgeTo(c.doc, somar(c.doc), loopOf(c.doc)),
  },
  {
    id: "escolha",
    title: "A Escolha pelo nível",
    text:
      "A **Escolha** (`Switch`) serve quando os caminhos **fazem coisas diferentes**. Arraste-a para baixo do Loop e, em **Expressão que escolhe o caminho**, escreva `nivel`.\n\n" +
      "Depois ligue **Loop → Escolha**: a segunda seta do loop é **segue** (quando as compras acabam).",
    target: pieceOrField("switch", ['[data-tour="on"]'], (d) => (sw2(d) && sw2(d)!.logic!.on === "nivel" ? undefined : sw2(d))),
    node: sw2,
    motion: { kind: "drag", to: { world: P2.sw } },
    ui: { panel: "assets", select: sw2 },
    ops: (d) =>
      steps(d, [
        (x) => ({ ...ensure(x, { id: "sw-nivel", role: "switch", label: "Qual o nível?", pos: P2.sw, logic: { text: "Cada nível segue um caminho", on: "nivel", examples: [ex("ouro", { nivel: "ouro" }, { caminho: "ouro" }), ex("prata", { nivel: "prata" }, { caminho: "outros" })] }, is: (n) => n.logic?.on === "nivel" }), name: "sw" }),
        (x, ids) => ({ ops: loopOf(x) ? link(x, loopOf(x)!.id, ids.sw, { branch: "segue" }) : [] }),
      ]),
    check: (c) => sw2(c.doc)?.logic?.on === "nivel" && edgeTo(c.doc, loopOf(c.doc), sw2(c.doc), (x) => x.logic?.branch === "segue"),
  },
  {
    id: "ouro",
    title: "O caminho do ouro",
    text: "Arraste uma **Action** com o efeito `pontos := pontos * 2`: cliente ouro ganha o dobro.",
    target: pieceOrField("rule", ['[data-tour="then"]'], (d) => (dobrar(d) ? undefined : blankOf(d, "rule"))),
    node: (d) => blankOf(d, "rule") ?? dobrar(d),
    motion: { kind: "drag", to: { world: P2.dobrar } },
    ui: { panel: "assets", select: (d) => blankOf(d, "rule") ?? dobrar(d) },
    ops: (d) => ensure(d, { id: "a-dobrar", role: "rule", label: "Dobrar pontos", pos: P2.dobrar, logic: { text: "Cliente ouro ganha o dobro", then: ["pontos := pontos * 2"], examples: [ex("dobra", { pontos: 300 }, { pontos: 600 })] }, is: (n) => n === dobrar(d) }).ops,
    check: (c) => !!dobrar(c.doc),
  },
  {
    id: "bloqueado",
    title: "O caminho do bloqueado: um Fim com erro",
    text:
      "Arraste uma **Action** com os efeitos `total := 0` e `faixa := \"bloqueado\"` (um por linha), e um **End** abaixo dela. No Inspetor do End, mude o **Desfecho** para **erro**: é um caminho de negócio previsto.\n\n" +
      "Ligue a Ação ao End com o Conector.",
    target: (c) => (!bloquear(c.doc) ? (blankOf(c.doc, "rule") ? ['[data-tour="then"]', "@node"] : ['[data-asset="logic-rule"]']) : !nodesOf(c.doc, "end").some((e) => e.logic?.outcome === "erro") ? (nodesOf(c.doc, "end").length ? ['[data-tour="outcome"]', "@node:end"] : ['[data-asset="logic-end"]']) : ['[aria-label="Conector"]']),
    node: (d) => blankOf(d, "rule") ?? bloquear(d),
    motion: { kind: "drag", to: { world: P2.bloquear } },
    ui: { panel: "assets", select: (d) => blankOf(d, "rule") ?? bloquear(d) },
    ops: (d) =>
      steps(d, [
        (x) => ({ ...ensure(x, { id: "a-bloquear", role: "rule", label: "Não pontuar", pos: P2.bloquear, logic: { text: "Cliente bloqueado não acumula pontos", then: ["total := 0", 'faixa := "bloqueado"'], examples: [ex("zera", {}, { total: 0, faixa: "bloqueado" })] }, is: (n) => /faixa\s*:=\s*"bloqueado"/.test(thenText(n)) }), name: "a" }),
        (x) => ({ ...ensure(x, { id: "fim-bloqueado", role: "end", label: "Cliente bloqueado", pos: P2.fimErro, logic: { outcome: "erro", text: "Não lança pontos" }, is: (n) => n.logic?.outcome === "erro" }), name: "e" }),
        (x, ids) => ({ ops: link(x, ids.a, ids.e) }),
      ]),
    check: (c) => {
      const a = bloquear(c.doc);
      return !!a && out(c.doc, a).some((x) => c.doc.nodes.find((n) => n.id === x.to)?.logic?.outcome === "erro");
    },
  },
  {
    id: "casos",
    title: "Os casos nas setas da Escolha",
    text:
      "Com o Conector, ligue a **Escolha → Dobrar pontos** e a **Escolha → Não pontuar**. Cada seta nova de uma escolha nasce com um caso provisório: clique na seta e, no Inspetor, escreva o valor do caso: `\"ouro\"` e `\"bloqueado\"` (com aspas: são textos).",
    target: (c) => (provisional(c.doc) ? ['[data-tour="case"]', "@conn"] : ['[aria-label="Conector"]', "@node:switch"]),
    conn: provisional,
    motion: { kind: "drag", to: { node: (d) => dobrar(d) } },
    ui: { tool: "connect" },
    ops: (d) => {
      const s = sw2(d);
      const a = dobrar(d);
      const b = bloquear(d);
      return s && a && b ? [...link(d, s.id, a.id, { case: '"ouro"' }), ...link(d, s.id, b.id, { case: '"bloqueado"' })] : [];
    },
    check: (c) => edgeTo(c.doc, sw2(c.doc), dobrar(c.doc), isCase('"ouro"')) && edgeTo(c.doc, sw2(c.doc), bloquear(c.doc), isCase('"bloqueado"')),
  },
  {
    id: "faixa",
    title: "A faixa e o fechamento",
    text:
      "Mais uma **Tabela**, pela faixa: `pontos >= 1000` → `faixa := \"diamante\"`, `pontos >= 300` → `faixa := \"ouro\"`, **senão** `faixa := \"comum\"` (a ordem importa).\n\n" +
      "Abaixo dela, uma **Action** `total := pontos` e um **End** (desfecho ok). Ligue Tabela → Ação → End.",
    target: (c) => (!faixaTable(c.doc) ? (blankOf(c.doc, "table") ? ['[data-tour="rows"]', "@node"] : ['[data-asset="logic-table"]']) : !fechar(c.doc) ? (blankOf(c.doc, "rule") ? ['[data-tour="then"]', "@node"] : ['[data-asset="logic-rule"]']) : ['[data-asset="logic-end"]', '[aria-label="Conector"]']),
    node: (d) => blankOf(d, "table") ?? blankOf(d, "rule"),
    motion: { kind: "drag", to: { world: P2.faixa } },
    ui: { panel: "assets", select: (d) => blankOf(d, "table") ?? blankOf(d, "rule") },
    ops: (d) =>
      steps(d, [
        (x) => ({ ...ensure(x, { id: "t-faixa", role: "table", label: "Faixa do cliente", pos: P2.faixa, logic: FAIXA_ROWS, is: (n) => /diamante/.test(JSON.stringify(n.logic)) }), name: "t" }),
        (x) => ({ ...ensure(x, { id: "a-fechar", role: "rule", label: "Fechar o total", pos: P2.fechar, logic: { text: "O total do mês é o acumulado", then: ["total := pontos"], examples: [ex("copia", { pontos: 305 }, { total: 305 })] }, is: (n) => /total\s*:=\s*pontos\s*$/m.test(thenText(n)) }), name: "a" }),
        (x) => ({ ...ensure(x, { id: "fim", role: "end", label: "Pontos lançados", pos: P2.fim, logic: {}, is: (n) => n.logic?.outcome !== "erro" }), name: "e" }),
        (x, ids) => ({ ops: [...link(x, ids.t, ids.a), ...link(x, ids.a, ids.e)] }),
      ]),
    check: (c) => {
      const a = fechar(c.doc);
      return !!faixaTable(c.doc) && edgeTo(c.doc, faixaTable(c.doc), a) && out(c.doc, a).some((x) => { const e = c.doc.nodes.find((n) => n.id === x.to); return e?.logic?.role === "end" && e.logic.outcome !== "erro"; });
    },
  },
  {
    id: "outros",
    title: "A saída «outros» e o caminho do ouro",
    text:
      "Ligue a **Escolha → Tabela da faixa** e, no Inspetor da seta, mude a **Saída** para **outros** (todo nível que não tem caso: bronze e prata). Ligue também **Dobrar pontos → Tabela da faixa**.\n\n" +
      "Repare: a validação no canto de baixo deixa de reclamar do fluxo.",
    target: (c) => {
      const s = sw2(c.doc);
      const t = faixaTable(c.doc);
      const bad = out(c.doc, s).find((x) => x.to === t?.id && x.logic?.branch !== "outros");
      return bad ? ['[data-tour="branch"]', "@conn"] : ['[aria-label="Conector"]', "@node:switch"];
    },
    conn: (d) => out(d, sw2(d)).find((x) => x.to === faixaTable(d)?.id),
    motion: { kind: "drag", to: { node: (d) => faixaTable(d) } },
    ui: { tool: "connect" },
    ops: (d) => {
      const s = sw2(d);
      const t = faixaTable(d);
      const a = dobrar(d);
      return s && t && a ? [...link(d, s.id, t.id, { branch: "outros" }), ...link(d, a.id, t.id)] : [];
    },
    check: (c) => edgeTo(c.doc, sw2(c.doc), faixaTable(c.doc), (x) => x.logic?.branch === "outros") && edgeTo(c.doc, dobrar(c.doc), faixaTable(c.doc)),
  },
  {
    id: "etapa",
    title: "Uma etapa para o laço",
    text:
      "Fluxos grandes se leem por **etapas**. Volte à seleção (**V**), selecione o **Loop**, a **Tabela do multiplicador** e a **Ação que soma** (Shift+clique em cada) e use **Criar etapa com a seleção** na barra de baixo. Dê o nome *Somar pontos*.\n\n" +
      "O botão **Visão geral** (na mesma barra) recolhe as etapas em cartões-resumo.",
    target: (c) => (c.sel.length > 1 ? ['[aria-label="Criar etapa com a seleção"]'] : ["@node:loop"]),
    motion: { kind: "click" },
    ui: { tool: "select" },
    ops: (d) => {
      const g = fresh(d, "st-somar");
      const ids = [loopOf(d), multTable(d), somar(d)].filter((n): n is NodeEl => !!n).map((n) => n.id);
      return [{ op: "add_group", id: g, label: "Somar pontos", stage: { text: "Percorre as compras e soma os pontos pela categoria" } } as Op, ...ids.map((id): Op => ({ op: "update", id, patch: { parent: g } }))];
    },
    check: (c) => {
      const l = loopOf(c.doc);
      return !!l?.parent && !!c.doc.groups.find((g) => g.id === l.parent)?.stage;
    },
  },
  {
    id: "cenarios",
    title: "Cenários: um por caminho",
    text:
      "Arraste um **Scenario** e, no Inspetor, monte um caso por caminho (use **+ Exemplo**):\n\n" +
      "- bronze com compras `[{ valor: 100, categoria: \"farmacia\" }, { valor: 50, categoria: \"mercado\" }]` → `total = 275`, `faixa = \"comum\"`\n" +
      "- ouro com `[{ valor: 300, categoria: \"farmacia\" }]` → `total = 1200`, `faixa = \"diamante\"`\n" +
      "- bloqueado → `faixa = \"bloqueado\"`, `desfecho = \"erro\"`",
    target: (c) => (nodesOf(c.doc, "scenario").length ? ['[data-tour="examples"]', "@node:scenario"] : ['[data-asset="logic-scenario"]']),
    motion: { kind: "drag", to: { world: P2.scenario } },
    ui: { panel: "assets", select: "scenario" },
    ops: (d) => {
      const examples = [
        ex("bronze", { nivel: "bronze", compras: [{ valor: 100, categoria: "farmacia" }, { valor: 50, categoria: "mercado" }] }, { total: 275, faixa: "comum", desfecho: "ok" }),
        ex("ouro vira diamante", { nivel: "ouro", compras: [{ valor: 300, categoria: "farmacia" }] }, { total: 1200, faixa: "diamante", desfecho: "ok" }),
        ex("sem compras", { nivel: "prata", compras: [] }, { total: 0, faixa: "comum", desfecho: "ok" }),
        ex("bloqueado", { nivel: "bloqueado", compras: [{ valor: 100, categoria: "farmacia" }] }, { total: 0, faixa: "bloqueado", desfecho: "erro" }),
      ];
      const s = nodesOf(d, "scenario")[0];
      if (s) return [{ op: "update", id: s.id, patch: { label: "Clientes de exemplo", logic: { role: "scenario", text: "Um cliente por caminho", examples } } }];
      const p = P2.scenario(d);
      return [{ op: "add_node", id: "sc-pontos", label: "Clientes de exemplo", x: p.x, y: p.y, asset: "logic-scenario", logic: { role: "scenario", text: "Um cliente por caminho", examples } as never }];
    },
    check: (c) => scenarioOk(c.doc, 3, (exs) => exs.some((e) => e.expect.desfecho === "erro")),
  },
  {
    id: "testar",
    title: "Teste e acompanhe as voltas",
    text: "No Inspetor do Cenário, clique num caso em **Reproduzir o caminho** e ande com ← →: repare nas voltas do Loop, na linha da Tabela que valeu e no caso da Escolha. No **3D**, cada passo mostra o cartão com a condição e os valores.",
    target: ['[data-tour="play"]', "@node:scenario"],
    motion: { kind: "click" },
    ui: { tool: "select", select: "scenario", play: true },
    check: (c) => c.play,
  },
  {
    id: "pronto",
    title: "Pronto: laços, tabelas e escolhas",
    text:
      "Você usou **Variável** com valor inicial, tipos de **lista** e **união**, **Loop** com *para cada*, **Tabela de decisão**, **Escolha** com casos e **outros**, **Fim com erro**, **etapa** e cenários que cobrem os caminhos.\n\n" +
      "Na **Aula 3**: gatilho webhook, chamada HTTP que pode falhar, caminhos paralelos e **travar**.",
  },
];

/* ═════════════════════════════ Aula 3 · Aprovação de crédito ═════════════════════════════ */

const P3 = {
  start: (d: Doc) => (nodesOf(d, "start")[0] ? origin(d) : { x: 0, y: 0 }),
  data: (i: number) => at(-440, i * 100),
  vars: (i: number) => at(-780, i * 100),
  valido: at(0, 160),
  invalido: at(380, 160),
  recusado: at(380, 1520),
  bureau: at(0, 320),
  semBureau: at(380, 320),
  revisaoFim: at(720, 320),
  fork: at(0, 480),
  taxa: at(-190, 630),
  limite: at(190, 630),
  join: at(0, 780),
  parcela: at(0, 930),
  negativado: at(0, 1080),
  revisao: at(380, 1080),
  cabe: at(0, 1230),
  aprovar: at(-190, 1380),
  recusar: at(190, 1380),
  fimOk: at(-190, 1530),
  scenario: at(1060, 0),
};
const start3 = (d: Doc) => nodesOf(d, "start")[0];
const valido = (d: Doc) => nodesOf(d, "decision").find((n) => /parcelas/.test(n.logic?.when ?? ""));
const negativado = (d: Doc) => nodesOf(d, "decision").find((n) => /negativado/.test(n.logic?.when ?? ""));
const cabe = (d: Doc) => nodesOf(d, "decision").find((n) => /parcela\s*<=\s*limite/.test(n.logic?.when ?? ""));
const bureau = (d: Doc) => nodesOf(d, "call")[0];
const invalido = (d: Doc) => ruleMatching(d, /prazo inválido/);
const semBureau = (d: Doc) => ruleMatching(d, /bureau indisponível/);
const limiteRule = (d: Doc) => ruleMatching(d, /limite\s*:=/);
const parcelaRule = (d: Doc) => ruleMatching(d, /parcela\s*:=/);
const revisaoRule = (d: Doc) => nodesOf(d, "rule").find((n) => (n.logic?.then ?? []).some((t) => /^\s*travar\s+status/.test(t)));
const aprovar = (d: Doc) => ruleMatching(d, /status\s*:=\s*"aprovado"/);
const recusar = (d: Doc) => nodesOf(d, "rule").find((n) => (n.logic?.then ?? []).some((t) => /^\s*destravar\s+status/.test(t)));
const taxaTable = (d: Doc) => nodesOf(d, "table").find((n) => /taxa\s*:=/.test(JSON.stringify(n.logic)));
const endOk = (d: Doc, n?: NodeEl) => out(d, n).some((x) => { const e = d.nodes.find((m) => m.id === x.to); return e?.logic?.role === "end" && e.logic.outcome !== "erro"; });
const endErro = (d: Doc, n?: NodeEl) => out(d, n).some((x) => d.nodes.find((m) => m.id === x.to)?.logic?.outcome === "erro");
const recusadoEnd = (d: Doc) => nodesOf(d, "end").find((n) => n.logic?.outcome === "erro");

const aula3: TourStep[] = [
  {
    id: "abertura",
    title: "Aula 3: um fluxo de verdade",
    text:
      "A regra: *valida o pedido de crédito, consulta o score do CPF num bureau, calcula taxa e limite e decide entre aprovado, em revisão ou recusado*.\n\n" +
      "As peças novas: **gatilho webhook**, **Chamada HTTP** (com resposta simulada e falha), **Paralelo** e **Junção**, e a **trava** de um dado. São mais passos: use **Fazer por mim** à vontade nos que você já sabe fazer.",
  },
  {
    id: "webhook",
    title: "O Início com gatilho webhook",
    text:
      "Arraste o **Start**. No Inspetor, em **Gatilho**, escolha **Webhook**, método **POST** e caminho `/credito`: o corpo JSON do pedido vira as entradas, e o código gerado traz o `handler(req)` pronto.",
    target: (c) => (start3(c.doc) ? ['[data-tour="trigger"]', "@node:start"] : ['[data-asset="logic-start"]']),
    motion: { kind: "drag", to: { world: P3.start } },
    ui: { panel: "assets", select: "start" },
    ops: (d) => {
      const s = start3(d);
      const logic = { role: "start", text: "O app do banco envia o pedido", trigger: { kind: "webhook", method: "POST", path: "/credito" } };
      return s ? [{ op: "update", id: s.id, patch: { label: "Pedido de crédito", logic } }] : [{ op: "add_node", id: "inicio", label: "Pedido de crédito", x: 0, y: 0, asset: "logic-start", logic: logic as never }];
    },
    check: (c) => start3(c.doc)?.logic?.trigger?.kind === "webhook" && start3(c.doc)?.logic?.trigger?.path === "/credito",
  },
  dataStep({
    id: "entradas",
    title: "As entradas do pedido",
    text: "Cinco **Entradas**: `cpf` (`string`), `renda` (`number`), `valor` (`number`), `parcelas` (`int`) e `negativado` (`boolean`). Você já sabe fazer: se quiser, use **Fazer por mim**.",
    role: "input",
    field: ['[data-tour="key"]', '[data-tour="type"]'],
    items: [
      { key: "cpf", type: "string", text: "CPF do cliente, só números", label: "CPF", pos: P3.data(0) },
      { key: "renda", type: "number", text: "Renda mensal comprovada", label: "Renda", pos: P3.data(1) },
      { key: "valor", type: "number", text: "Quanto o cliente quer emprestado", label: "Valor pedido", pos: P3.data(2) },
      { key: "parcelas", type: "int", text: "Prazo em meses: 6, 12 ou 24", label: "Parcelas", pos: P3.data(3) },
      { key: "negativado", type: "boolean", text: "O cadastro interno tem restrição", label: "Negativado", pos: P3.data(4) },
    ],
  }),
  dataStep({
    id: "resultados",
    title: "Os resultados",
    text: "Dois **Resultados**: `status` (tipo `\"aprovado\" | \"revisao\" | \"recusado\"`) e `motivo` (`string`).",
    role: "output",
    field: ['[data-tour="key"]', '[data-tour="type"]'],
    items: [
      { key: "status", type: '"aprovado" | "revisao" | "recusado"', text: "A decisão", label: "Status", pos: P3.data(5) },
      { key: "motivo", type: "string", text: "Por que não foi aprovado", label: "Motivo", pos: P3.data(6) },
    ],
  }),
  {
    id: "validar",
    title: "Validar antes de gastar",
    text:
      "Arraste uma **Decision** para baixo do Início com a condição `valor > 0 e parcelas em [6, 12, 24]` (no campo da condição, use a forma de texto se preferir) e ligue **Início → Decisão**.\n\n" +
      "Validar cedo evita chamar o bureau, que custa, com um pedido que seria recusado de qualquer jeito.",
    target: (c) => (valido(c.doc) ? ['[aria-label="Conector"]', "@node:start"] : blankOf(c.doc, "decision") ? ['[data-tour="when"]', "@node"] : ['[data-asset="logic-decision"]']),
    node: (d) => blankOf(d, "decision"),
    motion: { kind: "drag", to: { world: P3.valido } },
    ui: { panel: "assets", select: (d) => blankOf(d, "decision") },
    ops: (d) =>
      steps(d, [
        (x) => ({ ...ensure(x, { id: "d-valido", role: "decision", label: "Pedido válido?", pos: P3.valido, logic: { text: "Valor positivo e prazo de 6, 12 ou 24 meses?", when: "valor > 0 e parcelas em [6, 12, 24]", examples: [ex("ok", { valor: 1000, parcelas: 12 }, { caminho: "sim" }), ex("prazo 7", { valor: 1000, parcelas: 7 }, { caminho: "nao" })] }, is: (n) => /parcelas/.test(n.logic?.when ?? "") }), name: "v" }),
        (x, ids) => ({ ops: start3(x) ? link(x, start3(x)!.id, ids.v) : [] }),
      ]),
    check: (c) => !!valido(c.doc) && edgeTo(c.doc, start3(c.doc), valido(c.doc)),
  },
  {
    id: "chamada",
    title: "A Chamada HTTP ao bureau",
    text:
      "Arraste uma **Call** para baixo da Decisão e, no Inspetor, clique em **Transformar em chamada HTTP**. Método **GET**, endereço `\"https://bureau.exemplo.com/score/\" + cpf` (texto fixo leva aspas).\n\n" +
      "Ligue **Decisão → Chamada**: é a primeira seta da decisão, o **sim**.",
    target: (c) => (bureau(c.doc)?.logic?.request ? ['[aria-label="Conector"]', "@node:decision"] : bureau(c.doc) ? ['[data-tour="request"]', "@node:call"] : ['[data-asset="logic-call"]']),
    motion: { kind: "drag", to: { world: P3.bureau } },
    ui: { panel: "assets", select: "call" },
    ops: (d) =>
      steps(d, [
        (x) => ({ ...ensure(x, { id: "c-bureau", role: "call", label: "Consultar score", pos: P3.bureau, logic: { text: "Pergunta o score do CPF ao bureau", request: { method: "GET", url: '"https://bureau.exemplo.com/score/" + cpf', headers: { Authorization: '"Bearer " + segredo("BUREAU_TOKEN")' } } }, is: (n) => !!n.logic?.request }), name: "c" }),
        (x, ids) => ({ ops: valido(x) ? link(x, valido(x)!.id, ids.c, { branch: "sim" }) : [] }),
      ]),
    check: (c) => /cpf/.test(bureau(c.doc)?.logic?.request?.url ?? "") && edgeTo(c.doc, valido(c.doc), bureau(c.doc), (x) => x.logic?.branch === "sim"),
  },
  {
    id: "invalido",
    title: "Pedido inválido: recusar",
    text:
      "Arraste uma **Action** à direita da Decisão com `status := \"recusado\"` e `motivo := \"prazo inválido\"`, e um **End** com desfecho **erro** (*Recusado*). Ligue **Decisão → Ação** (a segunda seta: **não**) e **Ação → End**.",
    target: (c) => (!invalido(c.doc) ? (blankOf(c.doc, "rule") ? ['[data-tour="then"]', "@node"] : ['[data-asset="logic-rule"]']) : !recusadoEnd(c.doc) ? (blankOf(c.doc, "end") ? ['[data-tour="outcome"]', "@node:end"] : ['[data-asset="logic-end"]']) : ['[aria-label="Conector"]']),
    node: (d) => blankOf(d, "rule"),
    motion: { kind: "drag", to: { world: P3.invalido } },
    ui: { panel: "assets", select: (d) => blankOf(d, "rule") },
    ops: (d) =>
      steps(d, [
        (x) => ({ ...ensure(x, { id: "a-invalido", role: "rule", label: "Recusar pedido inválido", pos: P3.invalido, logic: { text: "Fora das regras do produto", then: ['status := "recusado"', 'motivo := "prazo inválido"'], examples: [ex("recusa", {}, { status: "recusado" })] }, is: (n) => /prazo inválido/.test(thenText(n)) }), name: "a" }),
        (x) => ({ ...ensure(x, { id: "fim-recusado", role: "end", label: "Recusado", pos: P3.recusado, logic: { outcome: "erro" }, is: (n) => n.logic?.outcome === "erro" }), name: "e" }),
        (x, ids) => ({ ops: [...(valido(x) ? link(x, valido(x)!.id, ids.a, { branch: "nao" }) : []), ...link(x, ids.a, ids.e)] }),
      ]),
    check: (c) => edgeTo(c.doc, valido(c.doc), invalido(c.doc), (x) => x.logic?.branch === "nao") && endErro(c.doc, invalido(c.doc)),
  },
  {
    id: "resposta",
    title: "Resposta simulada e «devolve»",
    text:
      "O app não acessa a rede: os exemplos usam a **Resposta simulada**. Na Chamada, escreva `{ \"score\": 720 }`. Crie uma **Variável** `score` (`int`) e, em **O que devolve quando dá certo**, escreva `score := resposta.score`.",
    target: (c) => (!dataNode(c.doc, "score") ? (blankOf(c.doc, "variable") ? ['[data-tour="key"]', "@node:variable"] : ['[data-asset="logic-variable"]']) : bureau(c.doc)?.logic?.mock === undefined ? ['[data-tour="mock"]', "@node:call"] : ['[data-tour="devolve"]', "@node:call"]),
    motion: { kind: "click" },
    ui: { select: "call" },
    ops: (d) => {
      const c = bureau(d);
      return [...dataOps(d, "variable", [{ key: "score", type: "int", text: "Score do bureau, de 0 a 1000", label: "Score", pos: P3.vars(0) }]), ...(c ? [{ op: "update", id: c.id, patch: { logic: { ...c.logic, mock: { score: 720 }, devolve: ["score := resposta.score"] } } } as Op] : [])];
    },
    check: (c) => !!dataNode(c.doc, "score") && typeof (bureau(c.doc)?.logic?.mock as { score?: unknown } | undefined)?.score === "number" && /score\s*:=\s*resposta\.score/.test((bureau(c.doc)?.logic?.devolve ?? []).join("\n")),
  },
  {
    id: "paralelo",
    title: "Paralelo e Junção",
    text:
      "Taxa e limite não dependem um do outro. Arraste um **Fork** (Paralelo) para baixo da Chamada e um **Join** (Junção) mais abaixo. Ligue **Chamada → Paralelo**: é a seta normal da chamada, de quando ela dá certo.",
    target: (c) => (!nodesOf(c.doc, "fork").length ? ['[data-asset="logic-fork"]'] : !nodesOf(c.doc, "join").length ? ['[data-asset="logic-join"]'] : ['[aria-label="Conector"]', "@node:call"]),
    motion: { kind: "drag", to: { world: P3.fork } },
    ui: { panel: "assets" },
    ops: (d) =>
      steps(d, [
        (x) => ({ ...ensure(x, { id: "f-calc", role: "fork", label: "Taxa e limite", pos: P3.fork, logic: { text: "A taxa e o limite não dependem um do outro" }, is: () => true }), name: "f" }),
        (x) => ({ ...ensure(x, { id: "j-calc", role: "join", label: "Juntar", pos: P3.join, logic: {}, is: () => true }), name: "j" }),
        (x, ids) => ({ ops: bureau(x) ? link(x, bureau(x)!.id, ids.f) : [] }),
      ]),
    check: (c) => !!nodesOf(c.doc, "join").length && edgeTo(c.doc, bureau(c.doc), nodesOf(c.doc, "fork")[0], (x) => !x.logic?.branch),
  },
  {
    id: "erro",
    title: "Quando a chamada falha: a seta «erro»",
    text:
      "Na Chamada, preencha **Falha simulada quando** com `cpf = \"00000000000\"`: nos exemplos com esse CPF, o fluxo segue pela seta **erro**.\n\n" +
      "Crie uma **Action** `status := \"revisao\"`, `motivo := \"bureau indisponível\"` e um **End** (ok, *Revisão manual*). Ligue **Chamada → Ação**: a segunda seta de uma chamada nasce **erro**. E **Ação → End**.",
    target: (c) => (!bureau(c.doc)?.logic?.falha ? ['[data-tour="falha"]', "@node:call"] : !semBureau(c.doc) ? (blankOf(c.doc, "rule") ? ['[data-tour="then"]', "@node"] : ['[data-asset="logic-rule"]']) : ['[aria-label="Conector"]', "@node:call"]),
    node: (d) => blankOf(d, "rule"),
    motion: { kind: "click" },
    ui: { select: "call" },
    ops: (d) =>
      steps(d, [
        (x) => {
          const c = bureau(x);
          return { ops: c && !c.logic?.falha ? [{ op: "update", id: c.id, patch: { logic: { ...c.logic, falha: 'cpf = "00000000000"' } } } as Op] : [] };
        },
        (x) => ({ ...ensure(x, { id: "a-sem-bureau", role: "rule", label: "Mandar para revisão", pos: P3.semBureau, logic: { text: "Sem score, um analista decide", then: ['status := "revisao"', 'motivo := "bureau indisponível"'], examples: [ex("revisão", {}, { status: "revisao" })] }, is: (n) => /bureau indisponível/.test(thenText(n)) }), name: "a" }),
        (x) => ({ ...ensure(x, { id: "fim-revisao", role: "end", label: "Revisão manual", pos: P3.revisaoFim, logic: { text: "Fila do analista" }, is: (n) => n.logic?.outcome !== "erro" && into(x, n).some((k) => k.from === semBureau(x)?.id) }), name: "e" }),
        (x, ids) => ({ ops: [...(bureau(x) ? link(x, bureau(x)!.id, ids.a, { branch: "erro" }) : []), ...link(x, ids.a, ids.e)] }),
      ]),
    check: (c) => !!bureau(c.doc)?.logic?.falha && edgeTo(c.doc, bureau(c.doc), semBureau(c.doc), (x) => x.logic?.branch === "erro") && endOk(c.doc, semBureau(c.doc)),
  },
  {
    id: "ramos",
    title: "Os dois ramos do paralelo",
    text:
      "Crie as **Variáveis** `taxa` e `limite` (`number`). Ramo 1: uma **Tabela** pelo score (`score >= 800` → `taxa := 1.5%`, `score >= 650` → `taxa := 2.5%`, senão `taxa := 4%`). Ramo 2: uma **Action** `limite := arredondar(renda * 30%, 2)`.\n\n" +
      "Ligue **Paralelo → Tabela**, **Paralelo → Ação**, e as duas à **Junção**. Um ramo não pode escrever o que o outro lê.",
    target: (c) => (!taxaTable(c.doc) ? (blankOf(c.doc, "table") ? ['[data-tour="rows"]', "@node"] : ['[data-asset="logic-table"]']) : !limiteRule(c.doc) ? (blankOf(c.doc, "rule") ? ['[data-tour="then"]', "@node"] : ['[data-asset="logic-rule"]']) : ['[aria-label="Conector"]', "@node:fork"]),
    node: (d) => blankOf(d, "table") ?? blankOf(d, "rule"),
    motion: { kind: "drag", to: { world: P3.taxa } },
    ui: { panel: "assets", select: (d) => blankOf(d, "table") ?? blankOf(d, "rule") },
    ops: (d) =>
      steps(d, [
        (x) => ({ ops: dataOps(x, "variable", [{ key: "taxa", type: "number", text: "Juros simples ao mês", label: "Taxa ao mês", pos: P3.vars(1) }, { key: "limite", type: "number", text: "Até 30% da renda", label: "Limite da parcela", pos: P3.vars(2) }]) }),
        (x) => ({ ...ensure(x, { id: "t-taxa", role: "table", label: "Taxa pelo score", pos: P3.taxa, logic: { text: "Quanto melhor o score, menor a taxa", rows: [{ label: "800 ou mais", when: "score >= 800", then: ["taxa := 1.5%"] }, { label: "650 a 799", when: "score >= 650", then: ["taxa := 2.5%"] }], otherwise: ["taxa := 4%"], examples: [ex("720", { score: 720 }, { taxa: 0.025 })] }, is: (n) => /taxa\s*:=/.test(JSON.stringify(n.logic)) }), name: "t" }),
        (x) => ({ ...ensure(x, { id: "a-limite", role: "rule", label: "Limite da parcela", pos: P3.limite, logic: { text: "A parcela não passa de 30% da renda", then: ["limite := arredondar(renda * 30%, 2)"], examples: [ex("30% de 5000", { renda: 5000 }, { limite: 1500 })] }, is: (n) => /limite\s*:=/.test(thenText(n)) }), name: "l" }),
        (x, ids) => {
          const f = nodesOf(x, "fork")[0];
          const j = nodesOf(x, "join")[0];
          return { ops: f && j ? [...link(x, f.id, ids.t), ...link(x, f.id, ids.l), ...link(x, ids.t, j.id), ...link(x, ids.l, j.id)] : [] };
        },
      ]),
    check: (c) => {
      const f = nodesOf(c.doc, "fork")[0];
      const j = nodesOf(c.doc, "join")[0];
      return !!dataNode(c.doc, "taxa") && !!dataNode(c.doc, "limite") && edgeTo(c.doc, f, taxaTable(c.doc)) && edgeTo(c.doc, f, limiteRule(c.doc)) && edgeTo(c.doc, taxaTable(c.doc), j) && edgeTo(c.doc, limiteRule(c.doc), j);
    },
  },
  {
    id: "parcela",
    title: "A parcela, depois da Junção",
    text: "Crie a **Variável** `parcela` (`number`) e uma **Action** abaixo da Junção: `parcela := arredondar(valor * (1 + taxa * parcelas) / parcelas, 2)`. Ligue **Junção → Ação**: ela usa os dois ramos, por isso vem depois.",
    target: (c) => (!dataNode(c.doc, "parcela") ? ['[data-asset="logic-variable"]', '[data-tour="key"]'] : !parcelaRule(c.doc) ? (blankOf(c.doc, "rule") ? ['[data-tour="then"]', "@node"] : ['[data-asset="logic-rule"]']) : ['[aria-label="Conector"]', "@node:join"]),
    node: (d) => blankOf(d, "rule"),
    motion: { kind: "drag", to: { world: P3.parcela } },
    ui: { panel: "assets", select: (d) => blankOf(d, "rule") },
    ops: (d) =>
      steps(d, [
        (x) => ({ ops: dataOps(x, "variable", [{ key: "parcela", type: "number", text: "Valor de cada parcela", label: "Parcela", pos: P3.vars(3) }]) }),
        (x) => ({ ...ensure(x, { id: "a-parcela", role: "rule", label: "Calcular a parcela", pos: P3.parcela, logic: { text: "Juros simples sobre o valor, dividido pelo prazo", then: ["parcela := arredondar(valor * (1 + taxa * parcelas) / parcelas, 2)"], examples: [ex("6000 em 12x", { valor: 6000, taxa: 0.025, parcelas: 12 }, { parcela: 650 })] }, is: (n) => /parcela\s*:=/.test(thenText(n)) }), name: "p" }),
        (x, ids) => ({ ops: nodesOf(x, "join")[0] ? link(x, nodesOf(x, "join")[0].id, ids.p) : [] }),
      ]),
    check: (c) => !!dataNode(c.doc, "parcela") && edgeTo(c.doc, nodesOf(c.doc, "join")[0], parcelaRule(c.doc)),
  },
  {
    id: "travar",
    title: "Travar: um valor que nada adiante muda",
    text:
      "Cliente **negativado** vai para revisão mesmo que a parcela caiba. Arraste uma **Decision** `negativado` e uma **Action** com `status := \"revisao\"`, `motivo := \"restrição no cadastro\"`, `travar status` e `travar motivo`.\n\n" +
      "Ligue **Parcela → Decisão** e **Decisão → Ação** (o **sim**). Daqui em diante, `status := ...` não muda o valor: o debug mostra a escrita barrada.",
    target: (c) => (!negativado(c.doc) ? (blankOf(c.doc, "decision") ? ['[data-tour="when"]', "@node"] : ['[data-asset="logic-decision"]']) : !revisaoRule(c.doc) ? (blankOf(c.doc, "rule") ? ['[data-tour="then"]', "@node"] : ['[data-asset="logic-rule"]']) : ['[aria-label="Conector"]']),
    node: (d) => blankOf(d, "decision") ?? blankOf(d, "rule"),
    motion: { kind: "drag", to: { world: P3.negativado } },
    ui: { panel: "assets", select: (d) => blankOf(d, "decision") ?? blankOf(d, "rule") },
    ops: (d) =>
      steps(d, [
        (x) => ({ ...ensure(x, { id: "d-negativado", role: "decision", label: "Negativado?", pos: P3.negativado, logic: { text: "O cadastro interno tem restrição?", when: "negativado", examples: [ex("sim", { negativado: true }, { caminho: "sim" }), ex("não", { negativado: false }, { caminho: "nao" })] }, is: (n) => /negativado/.test(n.logic?.when ?? "") }), name: "n" }),
        (x) => ({ ...ensure(x, { id: "a-revisao", role: "rule", label: "Prender em revisão", pos: P3.revisao, logic: { text: "Com restrição, o status fica em revisão", then: ['status := "revisao"', 'motivo := "restrição no cadastro"', "travar status", "travar motivo"], examples: [ex("trava", {}, { status: "revisao" })] }, is: (n) => (n.logic?.then ?? []).some((t) => /^\s*travar\s+status/.test(t)) }), name: "r" }),
        (x, ids) => ({ ops: [...(parcelaRule(x) ? link(x, parcelaRule(x)!.id, ids.n) : []), ...link(x, ids.n, ids.r, { branch: "sim" })] }),
      ]),
    check: (c) => !!revisaoRule(c.doc) && edgeTo(c.doc, parcelaRule(c.doc), negativado(c.doc)) && edgeTo(c.doc, negativado(c.doc), revisaoRule(c.doc), (x) => x.logic?.branch === "sim"),
  },
  {
    id: "decidir",
    title: "A decisão final",
    text:
      "Uma **Decision** `parcela <= limite`, ligada pelo **não** da *Negativado?* e pela saída de *Prender em revisão*. No **sim**, uma **Action** `status := \"aprovado\"`, `motivo := \"\"` e um **End** ok (*Decidido*). No **não**, uma **Action** que **destrava** e recusa: `destravar status`, `destravar motivo`, `status := \"recusado\"`, `motivo := \"parcela acima de 30% da renda\"`, ligada ao End *Recusado*.",
    target: (c) => (!cabe(c.doc) ? (blankOf(c.doc, "decision") ? ['[data-tour="when"]', "@node"] : ['[data-asset="logic-decision"]']) : !aprovar(c.doc) || !recusar(c.doc) ? (blankOf(c.doc, "rule") ? ['[data-tour="then"]', "@node"] : ['[data-asset="logic-rule"]']) : ['[aria-label="Conector"]', "@node:decision"]),
    node: (d) => blankOf(d, "decision") ?? blankOf(d, "rule"),
    motion: { kind: "drag", to: { world: P3.cabe } },
    ui: { panel: "assets", select: (d) => blankOf(d, "decision") ?? blankOf(d, "rule") },
    ops: (d) =>
      steps(d, [
        (x) => ({ ...ensure(x, { id: "d-cabe", role: "decision", label: "A parcela cabe?", pos: P3.cabe, logic: { text: "A parcela fica dentro do limite?", when: "parcela <= limite", examples: [ex("cabe", { parcela: 650, limite: 1500 }, { caminho: "sim" }), ex("não cabe", { parcela: 650, limite: 450 }, { caminho: "nao" })] }, is: (n) => /parcela\s*<=\s*limite/.test(n.logic?.when ?? "") }), name: "c" }),
        (x) => ({ ...ensure(x, { id: "a-aprovar", role: "rule", label: "Aprovar", pos: P3.aprovar, logic: { text: "Tenta aprovar (travado em revisão, continua revisão)", then: ['status := "aprovado"', 'motivo := ""'], examples: [ex("aprova", {}, { status: "aprovado" })] }, is: (n) => /status\s*:=\s*"aprovado"/.test(thenText(n)) }), name: "a" }),
        (x) => ({ ...ensure(x, { id: "a-recusar", role: "rule", label: "Recusar", pos: P3.recusar, logic: { text: "Parcela acima do limite recusa, mesmo em revisão", then: ["destravar status", "destravar motivo", 'status := "recusado"', 'motivo := "parcela acima de 30% da renda"'], examples: [ex("recusa", {}, { status: "recusado" })] }, is: (n) => (n.logic?.then ?? []).some((t) => /^\s*destravar\s+status/.test(t)) }), name: "r" }),
        (x) => ({ ...ensure(x, { id: "fim-ok", role: "end", label: "Decidido", pos: P3.fimOk, logic: { text: "Aprovado ou em revisão" }, is: (n) => n.logic?.outcome !== "erro" && into(x, n).some((k) => k.from === aprovar(x)?.id) }), name: "e" }),
        (x, ids) => {
          const neg = negativado(x);
          const rev = revisaoRule(x);
          const rec = recusadoEnd(x);
          return { ops: [...(neg ? link(x, neg.id, ids.c, { branch: "nao" }) : []), ...(rev ? link(x, rev.id, ids.c) : []), ...link(x, ids.c, ids.a, { branch: "sim" }), ...link(x, ids.c, ids.r, { branch: "nao" }), ...link(x, ids.a, ids.e), ...(rec ? link(x, ids.r, rec.id) : [])] };
        },
      ]),
    check: (c) =>
      edgeTo(c.doc, negativado(c.doc), cabe(c.doc), (x) => x.logic?.branch === "nao") &&
      edgeTo(c.doc, revisaoRule(c.doc), cabe(c.doc)) &&
      edgeTo(c.doc, cabe(c.doc), aprovar(c.doc), (x) => x.logic?.branch === "sim") &&
      edgeTo(c.doc, cabe(c.doc), recusar(c.doc), (x) => x.logic?.branch === "nao") &&
      endOk(c.doc, aprovar(c.doc)) &&
      endErro(c.doc, recusar(c.doc)),
  },
  {
    id: "etapa",
    title: "Uma etapa para os cálculos",
    text: "Selecione o **Paralelo**, a **Tabela da taxa**, a **Ação do limite**, a **Junção** e a **Ação da parcela** (Shift+clique) e use **Criar etapa com a seleção**. Nome: *Taxa e limite*.",
    target: (c) => (c.sel.length > 1 ? ['[aria-label="Criar etapa com a seleção"]'] : ["@node:fork"]),
    motion: { kind: "click" },
    ui: { tool: "select" },
    ops: (d) => {
      const id = fresh(d, "st-calcular");
      const ids = [nodesOf(d, "fork")[0], taxaTable(d), limiteRule(d), nodesOf(d, "join")[0], parcelaRule(d)].filter((n): n is NodeEl => !!n).map((n) => n.id);
      return [{ op: "add_group", id, label: "Taxa e limite", stage: { text: "Taxa pelo score e limite pela renda, ao mesmo tempo; depois a parcela" } } as Op, ...ids.map((n): Op => ({ op: "update", id: n, patch: { parent: id } }))];
    },
    check: (c) => {
      const f = nodesOf(c.doc, "fork")[0];
      return !!f?.parent && !!c.doc.groups.find((g) => g.id === f.parent)?.stage;
    },
  },
  {
    id: "cenarios",
    title: "Um cenário por desfecho",
    text:
      "Arraste um **Scenario** com um caso por caminho: *aprovado* (renda 5000, valor 6000, 12 parcelas → `status = \"aprovado\"`), *negativado* (→ `\"revisao\"`), *parcela não cabe* (renda 1500 → `\"recusado\"`, `desfecho = \"erro\"`), *prazo inválido* (7 parcelas) e *bureau fora do ar* (cpf `\"00000000000\"` → `\"revisao\"`).",
    target: (c) => (nodesOf(c.doc, "scenario").length ? ['[data-tour="examples"]', "@node:scenario"] : ['[data-asset="logic-scenario"]']),
    motion: { kind: "drag", to: { world: P3.scenario } },
    ui: { panel: "assets", select: "scenario" },
    ops: (d) => {
      const base = { cpf: "12345678900", renda: 5000, valor: 6000, parcelas: 12, negativado: false };
      const examples = [
        ex("aprovado", base, { parcela: 650, status: "aprovado", desfecho: "ok" }),
        ex("negativado fica em revisão", { ...base, negativado: true }, { status: "revisao", motivo: "restrição no cadastro", desfecho: "ok" }),
        ex("parcela não cabe", { ...base, renda: 1500 }, { status: "recusado", desfecho: "erro" }),
        ex("prazo inválido", { ...base, parcelas: 7 }, { status: "recusado", motivo: "prazo inválido", desfecho: "erro" }),
        ex("bureau fora do ar", { ...base, cpf: "00000000000" }, { status: "revisao", motivo: "bureau indisponível", desfecho: "ok" }),
      ];
      const s = nodesOf(d, "scenario")[0];
      if (s) return [{ op: "update", id: s.id, patch: { label: "Pedidos de exemplo", logic: { role: "scenario", text: "Um pedido por desfecho", examples } } }];
      const p = P3.scenario(d);
      return [{ op: "add_node", id: "sc-credito", label: "Pedidos de exemplo", x: p.x, y: p.y, asset: "logic-scenario", logic: { role: "scenario", text: "Um pedido por desfecho", examples } as never }];
    },
    check: (c) => scenarioOk(c.doc, 4, (exs) => exs.some((e) => e.given.cpf === "00000000000") && exs.some((e) => e.given.negativado === true)),
  },
  {
    id: "3d",
    title: "Depure no 3D",
    text: "Clique num pedido em **Reproduzir o caminho** e abra o **3D**: escolha *negativado fica em revisão* em **Testar** e ande com ← →. No passo *Aprovar*, o cartão mostra `status` com **🔒 travado: não mudou**.",
    target: (c) => (c.play ? [".iso-toggle"] : ['[data-tour="play"]', "@node:scenario"]),
    motion: { kind: "click" },
    ui: { tool: "select", select: "scenario", play: true, iso: true },
    check: (c) => c.play && c.iso,
  },
  {
    id: "pronto",
    title: "Pronto: um fluxo de verdade",
    text:
      "Você usou **gatilho webhook**, **Chamada HTTP** com resposta simulada, **devolve** e **falha**, **Paralelo** e **Junção**, **travar** e **destravar**, vários **Fins**, **etapa** e um cenário por desfecho.\n\n" +
      "Para levar ao código: peça ao assistente pelo MCP do Archflow (`generate_code`). Sai um TypeScript executável com `run(input)`, o `handler` do webhook, o `fetch` do bureau e um teste por exemplo do cenário.",
  },
];

/* ═════════════════════════════ registro ═════════════════════════════ */

export const LOGIC_TOURS: LogicTourDef[] = [
  {
    key: "logic:aula-tutorial",
    n: 1,
    title: TOUR_TITLE,
    level: "iniciante",
    summary: "Tutorial interativo: você monta a regra do frete grátis na interface, do zero; o tutorial aponta cada clique e espera você fazer.",
    teaches: ["Biblioteca e Inspetor", "Início, Entrada, Resultado, Decisão, Ação e Fim", "Conector e setas sim/não", "exemplos, cenário e teste", "debug no 3D"],
    docId: "aula-logic-tutorial",
    path: `${LOGIC_LESSONS_DIR}/aula-1-seu-primeiro-diagrama-logico.archflow.json`,
    description: "Compras a partir de R$ 200 não pagam frete; abaixo disso o frete é R$ 25.",
    steps: LOGIC_TOUR,
    next: "logic:aula-pontos-de-fidelidade",
  },
  {
    key: "logic:aula-pontos-de-fidelidade",
    n: 2,
    title: "Pontos de fidelidade",
    level: "intermediário",
    summary: "Tutorial interativo: Variável, Loop «para cada», Tabela de decisão, Escolha com casos nas setas, fim com erro, etapa e cenários por caminho.",
    teaches: ["Variável com valor inicial", "Loop «para cada»", "Tabela de decisão", "Escolha (switch) e casos", "fim com erro e etapas"],
    docId: "aula-logic-02-pontos-de-fidelidade", // o mesmo id das primeiras versões da aula: arquivos já instalados continuam reconhecidos
    path: `${LOGIC_LESSONS_DIR}/aula-2-pontos-de-fidelidade.archflow.json`,
    description: "Cada compra dá pontos conforme a categoria; clientes ouro dobram; o total define a faixa. Cliente bloqueado não pontua.",
    steps: aula2,
    next: "logic:aula-aprovacao-de-credito",
  },
  {
    key: "logic:aula-aprovacao-de-credito",
    n: 3,
    title: "Aprovação de crédito",
    level: "avançado",
    summary: "Tutorial interativo: gatilho webhook, Chamada HTTP com resposta simulada e falha, Paralelo e Junção, travar/destravar e um cenário por desfecho.",
    teaches: ["gatilho webhook", "Chamada HTTP e seta «erro»", "Paralelo e Junção", "travar e destravar", "cenários por desfecho e debug 3D"],
    docId: "aula-logic-03-aprovacao-de-credito",
    path: `${LOGIC_LESSONS_DIR}/aula-3-aprovacao-de-credito.archflow.json`,
    description: "Valida o pedido, consulta o score num bureau, calcula taxa e limite em paralelo e decide: aprovado, em revisão ou recusado.",
    steps: aula3,
  },
];

export const tourOfDoc = (docId: string) => LOGIC_TOURS.find((t) => t.docId === docId);
export const tourByKey = (key: string) => LOGIC_TOURS.find((t) => t.key === key);

/** O diagrama com que a aula começa: vazio, no modo Logic, com a regra na descrição. */
export function tourStartDoc(t: LogicTourDef): Doc {
  const doc = emptyDoc(`Aula ${t.n} · ${t.title}`, "logic");
  doc.id = t.docId;
  doc.description = t.description;
  return doc;
}
