import { useCallback, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import { DDD_BADGES, DDD_ROLES, type DddRole } from "../shared/schema";
import { Glyph } from "./icons";
import { set } from "./store";

/* ───────── guia rápido de DDD: cenas animadas + passo a passo ───────── */

const LS_SEEN = "archflow.dddguide.seen";
export const dddGuideSeen = () => {
  try {
    return localStorage.getItem(LS_SEEN) === "1";
  } catch {
    return false;
  }
};
const markSeen = () => {
  try {
    localStorage.setItem(LS_SEEN, "1");
  } catch {
    /* opcional */
  }
};
export const openDddGuide = () => set({ modal: { type: "ddd-guide" } });

/** Tempo de uma volta da animação (s) e pausa antes de repetir. */
const LOOP = 8.5;
const PAUSE = 1.8;

const sv = (d: number, extra?: Record<string, string>) => ({ "--d": `${d}s`, ...extra }) as CSSProperties;
const ROLE_COLOR = (r: DddRole) => DDD_ROLES[r].color;
const CTX = "#706fd3";

/* ───────── primitivas SVG ───────── */

function Card({ x, y, w = 118, h = 48, role, label, d = 0, glow }: { x: number; y: number; w?: number; h?: number; role: DddRole; label: string; d?: number; glow?: boolean }) {
  const c = ROLE_COLOR(role);
  return (
    <g transform={`translate(${x} ${y})`}>
      <g className={`gd-in ${glow ? "gd-glow" : ""}`} style={sv(d, { "--c": c })}>
        <rect className="gd-card" width={w} height={h} rx={10} style={{ stroke: c }} />
        <rect width={5} height={h - 14} x={0} y={7} rx={2.5} fill={c} />
        <text className="gd-badge" x={15} y={18} fill={c}>
          {DDD_BADGES[role]}
        </text>
        <text className="gd-label" x={15} y={h - 12}>
          {label}
        </text>
      </g>
    </g>
  );
}

function Boundary({ x, y, w, h, label, d = 0, color = CTX, dashed = true }: { x: number; y: number; w: number; h: number; label: string; d?: number; color?: string; dashed?: boolean }) {
  return (
    <g className="gd-in" style={sv(d)}>
      <rect x={x} y={y} width={w} height={h} rx={16} fill={color} fillOpacity={0.07} stroke={color} strokeWidth={1.8} strokeDasharray={dashed ? "7 5" : undefined} />
      <text className="gd-ctx" x={x + 14} y={y + 20} fill={color}>
        {label}
      </text>
    </g>
  );
}

function Arrow({ x1, y1, x2, y2, d = 0, color = "var(--ink-2)", label, lx = 0, ly = -7, pulse }: { x1: number; y1: number; x2: number; y2: number; d?: number; color?: string; label?: string; lx?: number; ly?: number; pulse?: boolean }) {
  const a = Math.atan2(y2 - y1, x2 - x1);
  const hl = 9;
  const hw = 5;
  const bx = x2 - Math.cos(a) * hl;
  const by = y2 - Math.sin(a) * hl;
  const head = `${x2},${y2} ${bx + Math.sin(a) * hw},${by - Math.cos(a) * hw} ${bx - Math.sin(a) * hw},${by + Math.cos(a) * hw}`;
  return (
    <g>
      <path className="gd-draw" d={`M${x1} ${y1}L${bx} ${by}`} pathLength={1} style={{ ...sv(d), stroke: color }} />
      <polygon className="gd-in" points={head} fill={color} style={sv(d + 0.45)} />
      {label && (
        <text className="gd-cap gd-in" textAnchor="middle" x={(x1 + x2) / 2 + lx} y={(y1 + y2) / 2 + ly} style={sv(d + 0.3)}>
          {label}
        </text>
      )}
      {pulse && <circle className="gd-travel" r={5} cx={x1} cy={y1} fill={color} style={sv(d + 0.7, { "--dx": `${x2 - x1}px`, "--dy": `${y2 - y1}px` })} />}
    </g>
  );
}

function Cap({ x, y, d, children, anchor = "middle", strong }: { x: number; y: number; d: number; children: ReactNode; anchor?: "start" | "middle" | "end"; strong?: boolean }) {
  return (
    <text className={`gd-cap gd-in ${strong ? "strong" : ""}`} x={x} y={y} textAnchor={anchor} style={sv(d)}>
      {children}
    </text>
  );
}

function Actor({ x, y, d, label }: { x: number; y: number; d: number; label: string }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <g className="gd-in" style={sv(d)}>
        <circle cx={20} cy={12} r={10} className="gd-actor" />
        <path d="M2 46c0-12 8-20 18-20s18 8 18 20z" className="gd-actor" />
        <text className="gd-label" x={20} y={64} textAnchor="middle">
          {label}
        </text>
      </g>
    </g>
  );
}

/* ───────── cenas ───────── */

function SceneSubdomains() {
  const cols: { x: number; h: number; c: string; t: string; ex: string; tag: string; d: number; glow?: boolean }[] = [
    { x: 40, h: 150, c: ROLE_COLOR("aggregate-root"), t: "Core", ex: "Precificação e pedidos", tag: "Invista aqui", d: 0.2, glow: true },
    { x: 260, h: 100, c: "#5b8def", t: "Supporting", ex: "Cadastro de clientes", tag: "Mantenha simples", d: 1.1 },
    { x: 480, h: 66, c: "#8a8a99", t: "Generic", ex: "Login · E-mail · Pagamento", tag: "Compre pronto", d: 2 },
  ];
  return (
    <>
      {cols.map((k) => (
        <g key={k.t}>
          <rect className={`gd-grow ${k.glow ? "gd-glow" : ""}`} x={k.x} y={190 - k.h} width={180} height={k.h} rx={12} fill={k.c} fillOpacity={0.16} stroke={k.c} strokeWidth={2} style={sv(k.d, { "--c": k.c })} />
          <text className="gd-title gd-in" x={k.x + 90} y={190 - k.h + 28} textAnchor="middle" fill={k.c} style={sv(k.d + 0.5)}>
            {k.t}
          </text>
          <Cap x={k.x + 90} y={190 - k.h + 48} d={k.d + 0.7}>
            {k.ex}
          </Cap>
          <Cap x={k.x + 90} y={216} d={k.d + 1} strong>
            {k.tag}
          </Cap>
        </g>
      ))}
      <Cap x={350} y={246} d={3.2}>
        Quanto mais alto, mais esforço de modelagem o negócio justifica
      </Cap>
    </>
  );
}

function SceneContexts() {
  return (
    <>
      <g className="gd-in gd-fadeout" style={sv(0.2)}>
        <rect className="gd-chip" x={300} y={104} width={100} height={36} rx={18} />
        <text className="gd-label" x={350} y={127} textAnchor="middle">
          “Cliente”
        </text>
        <Cap x={350} y={168} d={0.4}>
          Mesma palavra…
        </Cap>
      </g>
      <Boundary x={30} y={50} w={300} h={150} label="Vendas" d={2.2} />
      <Boundary x={370} y={50} w={300} h={150} label="Entrega" d={2.2} color="#2f9e8f" />
      <g className="gd-in" style={sv(3)}>
        <rect className="gd-chip" x={56} y={96} width={100} height={36} rx={18} />
        <text className="gd-label" x={106} y={119} textAnchor="middle">
          Cliente
        </text>
      </g>
      <Cap x={168} y={119} d={3.6} anchor="start">
        quem compra
      </Cap>
      <Cap x={56} y={160} d={3.9} anchor="start">
        crédito · histórico · desconto
      </Cap>
      <g className="gd-in" style={sv(4.6)}>
        <rect className="gd-chip" x={396} y={96} width={100} height={36} rx={18} style={{ stroke: "#2f9e8f" }} />
        <text className="gd-label" x={446} y={119} textAnchor="middle">
          Cliente
        </text>
      </g>
      <Cap x={508} y={119} d={5.2} anchor="start">
        onde entregar
      </Cap>
      <Cap x={396} y={160} d={5.5} anchor="start">
        endereço · janela · telefone
      </Cap>
      <Cap x={350} y={236} d={6.4} strong>
        …significados diferentes → contextos diferentes
      </Cap>
    </>
  );
}

function SceneUseCase() {
  return (
    <>
      <Actor x={40} y={92} d={0.2} label="Cliente" />
      <Arrow x1={96} y1={116} x2={196} y2={116} d={0.9} pulse />
      <Card x={200} y={92} w={150} role="use-case" label="Comprar produtos" d={1.5} />
      <Arrow x1={354} y1={116} x2={444} y2={116} d={2.6} pulse label="realizes" ly={-9} />
      <Card x={448} y={92} w={160} role="command" label="criar-pedido" d={3.2} />
      <Cap x={68} y={196} d={1} strong>
        Quem?
      </Cap>
      <Cap x={275} y={176} d={2.1} strong>
        Para quê?
      </Cap>
      <Cap x={275} y={194} d={2.3}>
        objetivo de negócio
      </Cap>
      <Cap x={528} y={176} d={3.8} strong>
        O que pede?
      </Cap>
      <Cap x={528} y={194} d={4}>
        intenção, no imperativo
      </Cap>
      <Cap x={350} y={240} d={5.2}>
        Comece pelo que o ator quer — não pelas tabelas
      </Cap>
    </>
  );
}

function SceneAggregate() {
  const red = "#e5484d";
  const ok = "var(--ok)";
  return (
    <>
      <Boundary x={190} y={22} w={480} h={206} label="Aggregate Pedido" d={0.2} color={ROLE_COLOR("aggregate-root")} />
      <Card x={235} y={56} role="aggregate-root" label="Pedido" d={0.8} glow />
      <Card x={235} y={150} role="entity" label="Item" d={1.6} />
      <Card x={420} y={150} role="value-object" label="Dinheiro" d={2.2} />
      <Arrow x1={294} y1={104} x2={294} y2={150} d={1.8} color={ROLE_COLOR("aggregate-root")} />
      <Arrow x1={330} y1={100} x2={440} y2={150} d={2.4} color={ROLE_COLOR("aggregate-root")} />
      <Cap x={306} y={134} d={2} anchor="start">
        contains
      </Cap>
      <g className="gd-in" style={sv(3)}>
        <rect className="gd-pill" x={420} y={64} width={168} height={32} rx={16} />
        <text className="gd-label" x={504} y={85} textAnchor="middle">
          invariante: total ≥ 0
        </text>
      </g>
      <g transform="translate(20 96)">
        <g className="gd-in" style={sv(3.8)}>
          <rect className="gd-card" width={118} height={56} rx={10} style={{ stroke: "var(--ink-3)" }} />
          <text className="gd-label" x={59} y={34} textAnchor="middle">
            Outro código
          </text>
        </g>
      </g>
      {/* tentativa direta no Item: bloqueada na fronteira */}
      <Arrow x1={140} y1={140} x2={184} y2={166} d={4.4} color={red} />
      <g className="gd-in" style={sv(5.1)}>
        <circle cx={190} cy={169} r={10} fill={red} />
        <path d="M185.5 164.5l9 9M194.5 164.5l-9 9" stroke="#fff" strokeWidth={2.2} strokeLinecap="round" />
      </g>
      <Cap x={78} y={180} d={5.2} anchor="middle">
        direto no Item
      </Cap>
      {/* via raiz: permitido */}
      <Arrow x1={140} y1={108} x2={230} y2={84} d={5.8} color={ok} />
      <g className="gd-in" style={sv(6.5)}>
        <circle cx={150} cy={84} r={10} fill={ok} />
        <path d="M145.5 84.5l3.5 3.5 6-7" fill="none" stroke="#fff" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
      </g>
      <Cap x={78} y={206} d={6.6} anchor="middle" strong>
        sempre pela raiz
      </Cap>
    </>
  );
}

function SceneEvent() {
  return (
    <>
      <Card x={30} y={92} w={150} role="command" label="criar-pedido" d={0.2} />
      <Arrow x1={184} y1={116} x2={254} y2={116} d={0.9} pulse label="triggers" ly={-9} />
      <Card x={258} y={92} w={150} role="aggregate-root" label="Pedido" d={1.5} glow />
      <Arrow x1={412} y1={116} x2={472} y2={116} d={2.6} pulse label="emits" ly={-9} />
      <g className="gd-burst" style={sv(3.3)}>
        <circle cx={540} cy={116} r={34} />
      </g>
      <Card x={476} y={92} w={160} role="domain-event" label="pedido-criado" d={3.2} glow />
      <Cap x={105} y={166} d={0.8} strong>
        pede
      </Cap>
      <Cap x={105} y={184} d={1}>
        “crie o pedido”
      </Cap>
      <Cap x={333} y={166} d={1.8} strong>
        decide
      </Cap>
      <Cap x={333} y={184} d={2}>
        valida as regras e muda o estado
      </Cap>
      <Cap x={556} y={166} d={3.8} strong>
        conta o que houve
      </Cap>
      <Cap x={556} y={184} d={4}>
        fato, no passado
      </Cap>
      <Cap x={350} y={236} d={5.2}>
        Command pede · Aggregate decide · Evento informa
      </Cap>
    </>
  );
}

function SceneReaction() {
  return (
    <>
      <Boundary x={4} y={50} w={150} h={116} label="Pedidos" d={0.1} />
      <Boundary x={166} y={50} w={530} h={116} label="Estoque" d={0.1} color="#2f9e8f" />
      <Card x={18} y={84} w={122} role="domain-event" label="pedido-criado" d={0.4} />
      <Arrow x1={142} y1={108} x2={178} y2={108} d={1.2} pulse />
      <Card x={180} y={84} w={118} role="policy" label="quando criado" d={1.8} />
      <Arrow x1={300} y1={108} x2={328} y2={108} d={2.6} pulse />
      <Card x={330} y={84} w={126} role="command" label="reservar-estoque" d={3.2} />
      <Arrow x1={458} y1={108} x2={484} y2={108} d={4} pulse />
      <Card x={486} y={84} w={90} role="aggregate-root" label="Estoque" d={4.5} />
      <Arrow x1={578} y1={108} x2={600} y2={108} d={5.2} pulse />
      <Card x={602} y={84} w={90} role="domain-event" label="reservado" d={5.7} />
      <Cap x={240} y={192} d={2.2} strong>
        Policy
      </Cap>
      <Cap x={240} y={210} d={2.4}>
        “quando X, faça Y” — sem estado
      </Cap>
      <Cap x={560} y={192} d={6}>
        …e a cadeia continua
      </Cap>
      <Cap x={350} y={244} d={6.6} strong>
        Eventos encadeiam contextos sem que um conheça o outro
      </Cap>
    </>
  );
}

function SceneMap() {
  const sh = "#e0a526";
  return (
    <>
      <Boundary x={20} y={46} w={200} h={130} label="Pagamentos" d={0.2} color="#5b8def" dashed={false} />
      <Boundary x={500} y={46} w={180} h={130} label="Pedidos" d={0.6} />
      <Cap x={120} y={150} d={1} anchor="middle" strong>
        UPSTREAM · fornece
      </Cap>
      <Cap x={590} y={150} d={1.2} anchor="middle" strong>
        DOWNSTREAM · consome
      </Cap>
      <Arrow x1={224} y1={104} x2={496} y2={104} d={1.6} color="var(--ink-3)" />
      {/* mensagem do fornecedor atravessa a camada anticorrupção e chega traduzida */}
      <g className="gd-msg1" style={sv(2.6)}>
        <rect className="gd-chip" x={36} y={84} width={150} height={30} rx={15} style={{ stroke: "#5b8def" }} />
        <text className="gd-cap" x={111} y={103} textAnchor="middle">
          pgto_ok_v2 (DTO)
        </text>
      </g>
      <g className="gd-in" style={sv(2.2)}>
        <path d="M350 62l46 14v34c0 22-20 38-46 48-26-10-46-26-46-48V76z" fill={sh} fillOpacity={0.18} stroke={sh} strokeWidth={2.2} transform="translate(0 -4)" />
        <text className="gd-label" x={350} y={111} textAnchor="middle">
          ACL
        </text>
      </g>
      <g className="gd-msg2" style={sv(2.6)}>
        <rect className="gd-chip" x={514} y={84} width={152} height={30} rx={15} style={{ stroke: CTX }} />
        <text className="gd-cap" x={590} y={103} textAnchor="middle">
          pagamento-aprovado
        </text>
      </g>
      <Cap x={350} y={196} d={3.6} strong>
        Anticorruption Layer
      </Cap>
      <Cap x={350} y={214} d={3.8}>
        o downstream traduz o modelo de fora para o seu
      </Cap>
      <Cap x={350} y={246} d={4.8}>
        Outros padrões: Customer/Supplier · Conformist · Shared Kernel · Partnership
      </Cap>
    </>
  );
}

const RECIPE: [string, DddRole | "context"][] = [
  ["Contexto", "context"],
  ["Use Case", "use-case"],
  ["Command", "command"],
  ["Aggregate", "aggregate-root"],
  ["Evento", "domain-event"],
  ["Policy", "policy"],
  ["Context Map", "context"],
];

function SceneRecipe() {
  return (
    <>
      <path className="gd-draw" d="M70 100H630" pathLength={1} style={{ ...sv(0.4), stroke: "var(--hairline)", strokeWidth: 3, animationDuration: "5s" }} />
      <path className="gd-draw" d="M70 100H630" pathLength={1} style={{ ...sv(0.4), stroke: "var(--primary)", strokeWidth: 3, animationDuration: "5s", animationTimingFunction: "linear" }} />
      {RECIPE.map(([label, role], i) => {
        const x = 70 + i * 93.3;
        const c = role === "context" ? (i === 0 ? CTX : "#2f9e8f") : ROLE_COLOR(role);
        const d = 0.4 + i * 0.75;
        return (
          <g key={label} className="gd-in" style={sv(d)}>
            <circle cx={x} cy={100} r={22} fill="var(--s-solid)" stroke={c} strokeWidth={2.4} />
            <text className="gd-num" x={x} y={106} textAnchor="middle" fill={c}>
              {i + 1}
            </text>
            <text className="gd-label" x={x} y={146} textAnchor="middle">
              {label}
            </text>
          </g>
        );
      })}
      <path className="gd-in" d="M536 76C536 22 257 22 257 76" fill="none" stroke="var(--ink-3)" strokeWidth={1.6} strokeDasharray="5 4" style={sv(5.6)} />
      <polygon className="gd-in" points="257,78 251,67 263,67" fill="var(--ink-3)" style={sv(5.7)} />
      <Cap x={396} y={20} d={5.8}>
        a história se repete para cada reação
      </Cap>
      <Cap x={350} y={216} d={6.4} strong>
        Valide (✓ no topo) · Apresente (P) para contar a história
      </Cap>
    </>
  );
}

/* ───────── conteúdo dos passos ───────── */

interface Step {
  id: string;
  short: string;
  title: string;
  tagline: string;
  points: ReactNode[];
  role?: DddRole;
  tool: ReactNode;
  ask: string;
  scene: () => ReactNode;
}

const B = ({ children }: { children: ReactNode }) => <b>{children}</b>;

const STEPS: Step[] = [
  {
    id: "subdominios",
    short: "Valor",
    title: "Onde está o valor do negócio?",
    tagline: "Nem todo pedaço do sistema merece o mesmo esforço. Classifique antes de modelar.",
    points: [
      <><B>Core</B>: o que diferencia você da concorrência. Modele com o máximo de cuidado.</>,
      <><B>Supporting</B>: necessário, mas sem diferencial. Faça simples e sob medida.</>,
      <><B>Generic</B>: problema que o mercado já resolveu (login, e-mail, pagamento). Use pronto.</>,
    ],
    tool: <>Selecione um grupo <B>context</B> e escolha o <B>Subdomínio</B> no Inspetor.</>,
    ask: "Se um concorrente copiasse isto, o negócio sofreria? Então é Core.",
    scene: SceneSubdomains,
  },
  {
    id: "contextos",
    short: "Contexto",
    title: "Bounded Context: a fronteira da linguagem",
    tagline: "A mesma palavra muda de significado conforme quem fala. Cada contexto tem o seu próprio modelo.",
    points: [
      <>Um contexto = <B>uma linguagem</B> coerente (e, em geral, uma equipe).</>,
      <>Não force um modelo único para a empresa toda — ele nunca fica bom para ninguém.</>,
      <>Comece com poucos contextos e divida quando a linguagem começar a divergir.</>,
    ],
    tool: <>Tecla <B>G</B>, desenhe um grupo do tipo <B>context</B>. Tudo o que ficar dentro pertence a ele.</>,
    ask: "Esta palavra significa a mesma coisa para vendas e para entrega?",
    scene: SceneContexts,
  },
  {
    id: "casos-de-uso",
    short: "Use Case",
    title: "Use Case → Command: o que alguém quer fazer",
    tagline: "Parta da intenção de um ator, não de tabelas de banco.",
    role: "use-case",
    points: [
      <><B>Use Case</B> = ator + objetivo (“Cliente compra produtos”).</>,
      <><B>Command</B> = pedido para mudar algo, no imperativo: <code>criar-pedido</code>.</>,
      <>Cada use case é realizado por um ou mais commands (relação <B>realizes</B>).</>,
    ],
    tool: <>Biblioteca (<B>B</B>) → aba <B>Domain</B>: arraste Use Case e Command e ligue com <B>realizes</B>.</>,
    ask: "Quem quer fazer o quê — e para quê?",
    scene: SceneUseCase,
  },
  {
    id: "aggregate",
    short: "Aggregate",
    title: "Aggregate: o bloco que protege as regras",
    tagline: "Um conjunto de objetos que muda junto e nunca fica inconsistente.",
    role: "aggregate-root",
    points: [
      <>A <B>raiz</B> é a única porta de entrada: de fora, só se fala com ela.</>,
      <><B>Entity</B> tem identidade; <B>Value Object</B> é só valor imutável (dinheiro, endereço).</>,
      <><B>Invariantes</B> são regras que sempre valem. Outros aggregates entram só por <B>id</B>.</>,
    ],
    tool: <>Ligue a raiz às partes com <B>contains</B> e escreva as invariantes no Inspetor.</>,
    ask: "O que jamais pode ficar inconsistente, nem por um segundo?",
    scene: SceneAggregate,
  },
  {
    id: "eventos",
    short: "Evento",
    title: "Domain Event: o fato que aconteceu",
    tagline: "Commands pedem; eventos contam o que já foi feito.",
    role: "domain-event",
    points: [
      <>Nome no <B>passado</B>: <code>pedido-criado</code>, nunca “criar-pedido”.</>,
      <>O caminho é sempre Command → Aggregate → Evento.</>,
      <>Eventos são o que o resto do sistema (e outros contextos) pode ouvir.</>,
    ],
    tool: <>Command → Aggregate com <B>triggers</B>; Aggregate → Evento com <B>emits</B>.</>,
    ask: "O que o resto do negócio precisa saber depois disto?",
    scene: SceneEvent,
  },
  {
    id: "reacoes",
    short: "Policy",
    title: "Policy: quando X acontece, faça Y",
    tagline: "Eventos disparam reações. É assim que as peças se encadeiam, até entre contextos.",
    role: "policy",
    points: [
      <><B>Policy</B>: regra sem estado — “quando este evento, emita este command”.</>,
      <><B>Process Manager</B> (saga) coordena fluxos longos e compensa falhas.</>,
      <><B>Decision</B> escolhe o ramo do fluxo (se / senão / em paralelo).</>,
    ],
    tool: <>Evento → Policy → Command. Depois use o <B>Auto-layout (L)</B> em “Linha do tempo” para ver a história da esquerda para a direita.</>,
    ask: "Quando isto acontecer, quem precisa reagir?",
    scene: SceneReaction,
  },
  {
    id: "context-map",
    short: "Context Map",
    title: "Context Map: como os contextos conversam",
    tagline: "Contextos se relacionam. Decida quem manda e como se proteger.",
    points: [
      <><B>Upstream</B> fornece; <B>downstream</B> consome e sofre as mudanças.</>,
      <><B>ACL</B> (camada anticorrupção): o downstream traduz o modelo de fora para o seu.</>,
      <>Outros: Customer/Supplier, Conformist, Shared Kernel, Partnership, Separate Ways.</>,
    ],
    tool: <>Conecte dois contextos com <B>context-relation</B> e escolha o <B>pattern</B> (a origem é o upstream).</>,
    ask: "Se o outro lado mudar, o meu modelo quebra?",
    scene: SceneMap,
  },
  {
    id: "receita",
    short: "Receita",
    title: "Receita rápida: do zero ao domínio",
    tagline: "Sete passos, sempre nessa ordem. Repita o ciclo para cada novo caso de uso.",
    points: [
      <>Peça ao seu agente via <B>MCP</B>: <code>add_use_cases</code> já monta use case → command → aggregate → evento.</>,
      <>Clique no <B>✓</B> do topo: a validação aponta o que falta e por quê.</>,
      <><B>Apresentar (P)</B> abre o passo a passo: conte o fluxo para quem não conhece o domínio.</>,
    ],
    tool: <>Quer ver pronto? Abra os <B>Exemplos de DDD</B> (banco, loja, clínica, biblioteca).</>,
    ask: "Qual é o primeiro caso de uso que o negócio não vive sem?",
    scene: SceneRecipe,
  },
];

/* ───────── componente ───────── */

const reducedMotion = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

export function DddGuide({ onClose }: { onClose: () => void }) {
  const [i, setI] = useState(0);
  const [run, setRun] = useState(0); // muda a cada volta: reinicia a animação
  const [auto, setAuto] = useState(false);
  const [paused, setPaused] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const step = STEPS[i];
  const last = i === STEPS.length - 1;

  const go = useCallback((n: number) => {
    setI(Math.min(STEPS.length - 1, Math.max(0, n)));
    setRun((r) => r + 1);
  }, []);

  useEffect(() => markSeen(), []);

  // repete a cena; no modo automático, avança ao fim da volta
  useEffect(() => {
    if (reducedMotion() || paused) return;
    const t = setTimeout(() => (auto && !last ? go(i + 1) : setRun((r) => r + 1)), (LOOP + PAUSE) * 1000);
    return () => clearTimeout(t);
  }, [i, run, auto, last, paused, go]);

  const onKey = (e: KeyboardEvent) => {
    if (e.key === "ArrowRight") (e.preventDefault(), go(i + 1));
    else if (e.key === "ArrowLeft") (e.preventDefault(), go(i - 1));
    else return;
    e.stopPropagation();
  };

  const examples = () => set({ modal: { type: "examples" } });

  return (
    <div className="gd" ref={wrap} onKeyDown={onKey}>
      <ol className="gd-steps" aria-label="Passos do guia">
        {STEPS.map((s, n) => (
          <li key={s.id}>
            <button className={`${n === i ? "active" : ""} ${n < i ? "done" : ""}`} onClick={() => go(n)} aria-current={n === i ? "step" : undefined} data-tip={s.title} data-tip-pos="bottom">
              <span>{n + 1}</span>
              <em>{s.short}</em>
            </button>
          </li>
        ))}
      </ol>

      <div className="gd-stage" key={`${step.id}-${run}`}>
        <svg viewBox="0 0 700 260" role="img" aria-label={`Animação: ${step.title}`} className={paused ? "gd-paused" : undefined}>
          {step.scene()}
        </svg>
        <button className="btn ghost icon gd-replay" onClick={() => setPaused((p) => !p)} aria-label={paused ? "Retomar animação" : "Pausar animação"} data-tip={paused ? "Retomar" : "Pausar"} data-tip-pos="left">
          <Glyph name={paused ? "play" : "pause"} size={16} />
        </button>
        <button className="btn ghost icon gd-replay two" onClick={() => (setPaused(false), setRun((r) => r + 1))} aria-label="Repetir animação" data-tip="Repetir" data-tip-pos="left">
          <Glyph name="reset" size={16} />
        </button>
      </div>

      <div className="gd-text">
        <div>
          <h3 className="gd-h">
            {step.role && (
              <span className="gd-tag" style={{ ["--c" as string]: ROLE_COLOR(step.role) }}>
                {DDD_ROLES[step.role].label}
              </span>
            )}
            {step.title}
          </h3>
          <p className="gd-tagline">{step.tagline}</p>
          <ul className="gd-points">
            {step.points.map((p, n) => (
              <li key={n}>{p}</li>
            ))}
          </ul>
        </div>
        <aside>
          <div className="gd-box">
            <small>No Archflow</small>
            <p>{step.tool}</p>
          </div>
          <div className="gd-box ask">
            <small>Pergunte-se</small>
            <p>{step.ask}</p>
          </div>
        </aside>
      </div>

      <div className="gd-foot">
        <label className="gd-auto" data-tip="Avança sozinho ao fim de cada animação" data-tip-pos="top">
          <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} /> Automático
        </label>
        <span className="gd-count">
          {i + 1} / {STEPS.length}
        </span>
        <div className="gd-nav">
          <button className="btn" onClick={() => go(i - 1)} disabled={i === 0}>
            Anterior
          </button>
          {last ? (
            <>
              <button className="btn" onClick={examples}>
                <Glyph name="sparkle" size={16} /> Ver exemplos
              </button>
              <button className="btn primary" onClick={onClose}>
                Começar a modelar
              </button>
            </>
          ) : (
            <button className="btn primary" onClick={() => go(i + 1)}>
              Próximo
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
