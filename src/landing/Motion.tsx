import { useEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import { BUILTIN_ASSETS } from "../shared/catalog";
import { DDD_BADGES, DDD_ROLES, LOGIC_ROLES, type DddRole, type LogicRole } from "../shared/schema";
import { Glyph, IconSvg } from "../ui/icons";
import "./motion.css";

/**
 * Motion graphics da landing: cada animação é uma função pura do tempo `t ∈ [0,1)`.
 * O relógio só corre enquanto o cartão está visível; com "reduzir movimento" fica
 * parado no quadro final (`rest`), que já conta a história inteira.
 */

const asset = (id: string) => BUILTIN_ASSETS.find((a) => a.id === id)!;
const reduced = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
const style = (v: Record<string, string | number>) => v as CSSProperties;

const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const seg = (t: number, a: number, b: number) => clamp((t - a) / (b - a));
const ease = (p: number) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);
const out = (p: number) => 1 - Math.pow(1 - p, 3);
const lerp = (a: number, b: number, p: number) => a + (b - a) * p;

function useClock(period: number, rest: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [t, setT] = useState(rest);
  useEffect(() => {
    const el = ref.current;
    if (!el || reduced() || typeof IntersectionObserver === "undefined") return;
    let raf = 0;
    let on = false;
    let t0 = 0;
    const loop = (now: number) => {
      if (!t0) t0 = now;
      setT(((now - t0) / period) % 1);
      raf = requestAnimationFrame(loop);
    };
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting && !on) {
          on = true;
          t0 = 0;
          raf = requestAnimationFrame(loop);
        } else if (!e.isIntersecting && on) {
          on = false;
          cancelAnimationFrame(raf);
        }
      },
      { threshold: 0.25 },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [period]);
  return [ref, t] as const;
}

/* ───────── peças de SVG ───────── */

const VW = 400;
const VH = 230;

function Sticker({ x, y, role, label, w = 96, h = 40, o = 1, s = 1, rot = 0, inline = false, hot = 0, fs }: { x: number; y: number; role: DddRole; label: string; w?: number; h?: number; o?: number; s?: number; rot?: number; inline?: boolean; hot?: number; fs?: number }) {
  const c = DDD_ROLES[role].color;
  const badge = DDD_BADGES[role];
  const bw = badge.length * 5.6 + 10;
  return (
    <g transform={`translate(${x} ${y}) translate(${w / 2} ${h / 2}) rotate(${rot}) scale(${s}) translate(${-w / 2} ${-h / 2})`} opacity={o}>
      {hot > 0 && <rect x={-5} y={-5} width={w + 10} height={h + 10} rx={13} fill="none" stroke={c} strokeWidth={2} opacity={hot * 0.55} />}
      <rect width={w} height={h} rx={9} style={{ fill: `color-mix(in srgb, ${c} 24%, var(--s-solid))`, stroke: c }} strokeWidth={1.4} />
      <rect x={6} y={inline ? (h - 12) / 2 : 6} width={bw} height={12} rx={6} fill={c} />
      <text x={6 + bw / 2} y={(inline ? (h - 12) / 2 : 6) + 9} textAnchor="middle" className="mo-badge">
        {badge}
      </text>
      <text x={inline ? 6 + bw + 6 : 8} y={inline ? h / 2 + 3.4 : h - 10} className="mo-t" style={{ fontSize: fs ?? (inline ? 9.6 : 11), fontWeight: 650 }}>
        {label}
      </text>
    </g>
  );
}

/** Polilinha desenhada até a fração `p`, com ponta de seta na extremidade atual. */
function Poly({ pts, color, p = 1, dash, w = 2, head = true }: { pts: [number, number][]; color: string; p?: number; dash?: string; w?: number; head?: boolean }) {
  if (p <= 0.001) return null;
  const lens = pts.slice(1).map((q, i) => Math.hypot(q[0] - pts[i][0], q[1] - pts[i][1]));
  const total = lens.reduce((a, b) => a + b, 0);
  let want = total * clamp(p);
  const draw: [number, number][] = [pts[0]];
  let ang = 0;
  for (let i = 0; i < lens.length; i++) {
    const [a, b] = [pts[i], pts[i + 1]];
    ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
    if (want >= lens[i]) {
      draw.push(b);
      want -= lens[i];
    } else {
      const f = want / lens[i];
      draw.push([lerp(a[0], b[0], f), lerp(a[1], b[1], f)]);
      break;
    }
  }
  const tip = draw[draw.length - 1];
  return (
    <g>
      <polyline points={draw.map((q) => q.join(",")).join(" ")} fill="none" stroke={color} strokeWidth={w} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={dash} />
      {head && <path d="M-9,-5 L1,0 L-9,5 z" fill={color} transform={`translate(${tip[0]} ${tip[1]}) rotate(${(ang * 180) / Math.PI})`} />}
    </g>
  );
}

function Tag({ x, y, text, color, o = 1 }: { x: number; y: number; text: string; color: string; o?: number }) {
  const w = text.length * 5.1 + 14;
  return (
    <g transform={`translate(${x} ${y})`} opacity={o}>
      <rect x={-w / 2} y={-9} width={w} height={18} rx={9} style={{ fill: "var(--s-solid)", stroke: color }} strokeWidth={1.2} />
      <text textAnchor="middle" y={3.4} className="mo-t" style={{ fontSize: 9, fontWeight: 600 }}>
        {text}
      </text>
    </g>
  );
}

/* ───────── moldura do cartão ───────── */

function Frame({ icon, tag, title, text, cap, ok, stageRef, children, wide = false }: { icon: string; tag: string; title: string; text: string; cap: string; ok?: boolean; stageRef: RefObject<HTMLDivElement | null>; children: ReactNode; wide?: boolean }) {
  return (
    <article className={`glass mo-card${wide ? " wide" : ""}`}>
      <header>
        <span className="lp-ico">
          <Glyph name={icon} size={20} />
        </span>
        <span className="mo-tag">{tag}</span>
      </header>
      <h3>{title}</h3>
      <p>{text}</p>
      <div className="mo-stage" ref={stageRef}>
        {children}
      </div>
      <footer className="mo-cap" aria-hidden>
        <i className={ok ? "ok" : ""} /> {cap}
      </footer>
    </article>
  );
}

/* ───────── 1 · Modo Domain ───────── */

function ModeMotion() {
  const [ref, t] = useClock(8000, 0.7);
  const p = clamp(ease(seg(t, 0.3, 0.46)) - ease(seg(t, 0.88, 1)));
  const arch: { id: string; label: string; sub: string }[] = [
    { id: "nextjs", label: "Web", sub: "Next.js" },
    { id: "laravel", label: "Pedidos", sub: "Laravel" },
    { id: "aws-sqs", label: "Eventos", sub: "SQS" },
  ];
  const dom: { role: DddRole; label: string }[] = [
    { role: "command", label: "criar-pedido" },
    { role: "aggregate-root", label: "Pedido" },
    { role: "domain-event", label: "pedido-criado" },
  ];
  const xs = [8, 152, 296];
  const nw = 96;
  const nh = 56;
  const ny = 92;
  const knob = lerp(0, 80, ease(p));
  return (
    <Frame
      stageRef={ref}
      icon="layers"
      tag="Modo Domain"
      title="Do desenho de infraestrutura ao modelo de negócio"
      text="Um selo ao lado do título troca o diagrama entre Arch e Domain. Nada é apagado — Ctrl+Z desfaz — e os elementos viram post-its de Event Storming com papel, relação e validação DDD."
      cap={p > 0.5 ? "Domain · aggregate, command, evento" : "Arch · serviços, bancos, filas"}
      ok={p > 0.5}
    >
      <svg viewBox={`0 0 ${VW} ${VH}`} role="img" aria-label="Um diagrama de arquitetura se transforma em um modelo de domínio com command, aggregate e evento">
        <g transform="translate(120 16)">
          <rect width={160} height={30} rx={15} className="mo-pill" />
          <rect x={3 + knob} y={3} width={74} height={24} rx={12} style={{ fill: "var(--primary-600)" }} />
          <text x={40} y={19.5} textAnchor="middle" className="mo-t" style={{ fontSize: 11.5, fontWeight: 650, fill: p < 0.5 ? "#fff" : "var(--ink-2)" }}>
            Arch
          </text>
          <text x={120} y={19.5} textAnchor="middle" className="mo-t" style={{ fontSize: 11.5, fontWeight: 650, fill: p >= 0.5 ? "#fff" : "var(--ink-2)" }}>
            Domain
          </text>
        </g>

        <Poly pts={[[xs[0] + nw, ny + nh / 2], [xs[1], ny + nh / 2]]} color={p < 0.5 ? "var(--c-sync)" : "var(--c-dep)"} />
        <Poly pts={[[xs[1] + nw, ny + nh / 2], [xs[2], ny + nh / 2]]} color="var(--c-async)" />
        <Tag x={(xs[0] + nw + xs[1]) / 2} y={ny + nh / 2 - 18} text={p < 0.5 ? "sync" : "triggers"} color={p < 0.5 ? "var(--c-sync)" : "var(--c-dep)"} />
        <Tag x={(xs[1] + nw + xs[2]) / 2} y={ny + nh / 2 - 18} text={p < 0.5 ? "async" : "emits"} color="var(--c-async)" />

        {xs.map((x, i) => {
          const a = asset(arch[i].id);
          const d = DDD_ROLES[dom[i].role];
          return (
            <g key={i} transform={`translate(${x} ${ny})`}>
              <g opacity={1 - p}>
                <rect width={nw} height={nh} rx={15} className="mo-node" />
                <rect x={9} y={(nh - 30) / 2} width={30} height={30} rx={10} fill="#fff" fillOpacity={0.9} stroke={a.color} strokeOpacity={0.3} />
                <IconSvg icon={a.icon} color={a.color} name={a.name} size={19} x={14.5} y={(nh - 30) / 2 + 5.5} />
                <text x={47} y={nh / 2 - 2} className="mo-t" style={{ fontSize: 11.5, fontWeight: 650 }}>
                  {arch[i].label}
                </text>
                <text x={47} y={nh / 2 + 12} className="mo-t2" style={{ fontSize: 9.5 }}>
                  {arch[i].sub}
                </text>
              </g>
              <g opacity={p} transform={`translate(${(1 - p) * 0} ${(1 - p) * 6})`}>
                <rect width={nw} height={nh} rx={11} style={{ fill: `color-mix(in srgb, ${d.color} 26%, var(--s-solid))`, stroke: d.color }} strokeWidth={1.6} />
                <rect x={8} y={8} width={DDD_BADGES[dom[i].role].length * 5.6 + 10} height={13} rx={6.5} fill={d.color} />
                <text x={8 + (DDD_BADGES[dom[i].role].length * 5.6 + 10) / 2} y={17.6} textAnchor="middle" className="mo-badge">
                  {DDD_BADGES[dom[i].role]}
                </text>
                <text x={9} y={nh - 12} className="mo-t" style={{ fontSize: 10.5, fontWeight: 650 }}>
                  {dom[i].label}
                </text>
              </g>
            </g>
          );
        })}

        <g transform="translate(200 188)">
          <g opacity={1 - p}>
            <rect x={-96} y={-12} width={192} height={24} rx={12} className="mo-pill" />
            <text textAnchor="middle" y={4} className="mo-t2" style={{ fontSize: 10 }}>
              componentes · grupos · conexões tipadas
            </text>
          </g>
          <g opacity={p}>
            <rect x={-96} y={-12} width={192} height={24} rx={12} style={{ fill: "color-mix(in srgb, var(--ok) 14%, var(--s-solid))", stroke: "var(--ok)" }} strokeWidth={1.2} />
            <text textAnchor="middle" y={4} className="mo-t" style={{ fontSize: 10, fontWeight: 600 }}>
              ✓ validação DDD · D001–D032
            </text>
          </g>
        </g>
      </svg>
    </Frame>
  );
}

/* ───────── 2 · Linha do tempo (Event Storming) ───────── */

const LANES = ["Caso de uso", "Command", "Aggregate", "Evento", "Policy", "Read model"];
const STORM: { role: DddRole; label: string; lane: number; col: number; from: [number, number, number] }[] = [
  { role: "use-case", label: "Fazer pedido", lane: 0, col: 0, from: [40, 160, -8] },
  { role: "command", label: "criar-pedido", lane: 1, col: 0, from: [236, 22, 6] },
  { role: "aggregate-root", label: "Pedido", lane: 2, col: 0, from: [130, 104, -5] },
  { role: "domain-event", label: "pedido-criado", lane: 3, col: 0, from: [28, 62, 9] },
  { role: "policy", label: "reservar-estoque", lane: 4, col: 1, from: [244, 150, -10] },
  { role: "command", label: "reservar-itens", lane: 1, col: 1, from: [100, 14, 4] },
  { role: "read-model", label: "pedidos-abertos", lane: 5, col: 0, from: [226, 92, 8] },
];

function TimelineMotion() {
  const [ref, t] = useClock(9000, 0.75);
  const settle = 1 - ease(seg(t, 0.9, 0.98));
  const lanesOn = ease(seg(t, 0.3, 0.55)) * settle;
  const laneY = (l: number) => 14 + l * 31;
  const colX = (c: number) => 84 + c * 156;
  return (
    <Frame
      stageRef={ref}
      icon="layout"
      tag="Linha do tempo"
      title="Event Storming com um toque"
      text="No auto-layout, escolha Linha do tempo: o Archflow organiza em raias — caso de uso, command, aggregate, evento, policy, read model — e ordena as colunas pelo tempo."
      cap={lanesOn > 0.5 ? "Raias por papel · colunas = tempo" : "Elementos soltos no quadro"}
      ok={lanesOn > 0.5}
    >
      <svg viewBox={`0 0 ${VW} ${VH}`} role="img" aria-label="Post-its soltos se organizam em raias de Event Storming">
        {LANES.map((l, i) => (
          <g key={l} opacity={lanesOn}>
            <rect x={78} y={laneY(i) - 2} width={VW - 82} height={30} rx={8} className="mo-lane" />
            <text x={4} y={laneY(i) + 17} className="mo-t2" style={{ fontSize: 9.2, fontWeight: 600 }}>
              {l}
            </text>
          </g>
        ))}
        <g opacity={lanesOn}>
          <line x1={84} y1={208} x2={VW - 12} y2={208} stroke="var(--ink-3)" strokeWidth={1.4} />
          <path d={`M${VW - 12},208 l-7,-4 v8 z`} fill="var(--ink-3)" />
          <text x={84} y={223} className="mo-t2" style={{ fontSize: 9.5 }}>
            tempo
          </text>
        </g>
        {STORM.map((s, i) => {
          const g = ease(seg(t, 0.2 + i * 0.035, 0.5 + i * 0.035)) * settle;
          const o = out(seg(t, 0.01 + i * 0.02, 0.1 + i * 0.02)) * (1 - seg(t, 0.97, 1));
          return <Sticker key={i} inline w={140} h={26} role={s.role} label={s.label} x={lerp(s.from[0], colX(s.col), g)} y={lerp(s.from[1], laneY(s.lane), g)} rot={lerp(s.from[2], 0, g)} o={o} />;
        })}
      </svg>
    </Frame>
  );
}

/* ───────── 3 · Auto-layout legível ───────── */

const LNODES: { id: string; label: string; tidy: [number, number]; mess: [number, number] }[] = [
  { id: "nextjs", label: "Web", tidy: [6, 92], mess: [232, 168] },
  { id: "laravel", label: "API", tidy: [86, 92], mess: [10, 92] },
  { id: "redis", label: "Cache", tidy: [166, 20], mess: [306, 16] },
  { id: "postgresql", label: "Banco", tidy: [246, 92], mess: [90, 16] },
  { id: "aws-sqs", label: "Fila", tidy: [166, 164], mess: [310, 168] },
  { id: "aws-lambda", label: "Worker", tidy: [246, 164], mess: [160, 92] },
  { id: "anthropic-claude", label: "Claude", tidy: [326, 164], mess: [10, 168] },
];
const LEDGES: [number, number][] = [[0, 1], [1, 2], [1, 3], [1, 4], [4, 5], [5, 3], [5, 6]];
const LW = 66;
const LH = 46;

function crossings(pos: [number, number][]) {
  const c = pos.map((p) => [p[0] + LW / 2, p[1] + LH / 2]);
  const ccw = (a: number[], b: number[], d: number[]) => (d[1] - a[1]) * (b[0] - a[0]) > (b[1] - a[1]) * (d[0] - a[0]);
  let n = 0;
  for (let i = 0; i < LEDGES.length; i++)
    for (let j = i + 1; j < LEDGES.length; j++) {
      const [a, b] = LEDGES[i];
      const [d, e] = LEDGES[j];
      if (a === d || a === e || b === d || b === e) continue;
      if (ccw(c[a], c[d], c[e]) !== ccw(c[b], c[d], c[e]) && ccw(c[a], c[b], c[d]) !== ccw(c[a], c[b], c[e])) n++;
    }
  return n;
}

function LayoutMotion() {
  const [ref, t] = useClock(8000, 0.7);
  const p = clamp(ease(seg(t, 0.22, 0.52)) - ease(seg(t, 0.9, 1)));
  const pos = LNODES.map((n) => [lerp(n.mess[0], n.tidy[0], p), lerp(n.mess[1], n.tidy[1], p)] as [number, number]);
  const x = crossings(pos);
  const key = seg(t, 0.14, 0.2) * (1 - seg(t, 0.6, 0.66));
  return (
    <Frame
      stageRef={ref}
      icon="connect"
      tag="Auto-layout legível"
      title="Menos cruzamentos, fluxo em uma direção"
      text="Camadas por fluxo, minimização de cruzamentos, componentes alinhados à altura dos vizinhos e rótulos que não se sobrepõem. Um toque na tecla L."
      cap={`cruzamentos de linhas: ${x}`}
      ok={x === 0}
    >
      <svg viewBox={`0 0 ${VW} ${VH}`} role="img" aria-label="Um grafo emaranhado é reorganizado em camadas, sem cruzamentos">
        {LEDGES.map(([a, b], i) => (
          <line key={i} x1={pos[a][0] + LW / 2} y1={pos[a][1] + LH / 2} x2={pos[b][0] + LW / 2} y2={pos[b][1] + LH / 2} stroke={x === 0 ? "var(--c-stream)" : "var(--c-sync)"} strokeWidth={2} strokeLinecap="round" opacity={0.7} />
        ))}
        {LNODES.map((n, i) => {
          const a = asset(n.id);
          return (
            <g key={n.id} transform={`translate(${pos[i][0]} ${pos[i][1]})`}>
              <rect width={LW} height={LH} rx={13} className="mo-node" />
              <rect x={(LW - 24) / 2} y={5} width={24} height={24} rx={8} fill="#fff" fillOpacity={0.9} stroke={a.color} strokeOpacity={0.3} />
              <IconSvg icon={a.icon} color={a.color} name={a.name} size={15} x={(LW - 15) / 2} y={9.5} />
              <text x={LW / 2} y={LH - 8} textAnchor="middle" className="mo-t" style={{ fontSize: 9.5, fontWeight: 650 }}>
                {n.label}
              </text>
            </g>
          );
        })}
        <g transform={`translate(${VW - 34} 14) scale(${1 - key * 0.1})`} opacity={0.35 + key * 0.65}>
          <rect x={-14} y={-14} width={28} height={28} rx={8} className="mo-pill" style={key > 0.4 ? { fill: "var(--primary-600)" } : undefined} />
          <text textAnchor="middle" y={4.5} className="mo-t" style={{ fontSize: 13, fontWeight: 700, fill: key > 0.4 ? "#fff" : "var(--ink)" }}>
            L
          </text>
        </g>
      </svg>
    </Frame>
  );
}

/* ───────── 4 · Passo a passo ───────── */

const STORY: { role: DddRole; label: string; pos: [number, number]; what: string; why: string; rule?: string }[] = [
  { role: "use-case", label: "Fazer pedido", pos: [12, 38], what: "Objetivo de um ator com o sistema.", why: "É o ponto de partida: o resto existe para realizá-lo." },
  { role: "command", label: "criar-pedido", pos: [114, 38], what: "Intenção de mudar o estado, no imperativo.", why: "Realiza o caso de uso e aciona o aggregate." },
  { role: "aggregate-root", label: "Pedido", pos: [216, 38], what: "Guarda as invariantes do conjunto.", why: "Decide se o command é válido.", rule: "total maior que zero" },
  { role: "domain-event", label: "pedido-criado", pos: [216, 122], what: "Fato de negócio que já aconteceu.", why: "Avisa o resto do domínio sem acoplar." },
  { role: "policy", label: "reservar", pos: [114, 122], what: "Regra sem estado: evento vira command.", why: "Reage ao evento e dispara o próximo passo." },
  { role: "command", label: "reservar-itens", pos: [12, 122], what: "Nova intenção, agora no estoque.", why: "O fluxo segue, passo a passo, até o fim." },
];
const SW = 82;
const SH = 40;

function StoryMotion() {
  const [ref, t] = useClock(15000, 0.4);
  const n = STORY.length;
  const f = t * n;
  const i = Math.min(n - 1, Math.floor(f));
  const move = ease(seg(f - i, 0, 0.25));
  const prev = Math.max(0, i - 1);
  const cx = lerp(STORY[prev].pos[0], STORY[i].pos[0], move) + SW / 2;
  const cy = lerp(STORY[prev].pos[1], STORY[i].pos[1], move) + SH / 2;
  const cur = STORY[i];
  const center = (k: number): [number, number] => [STORY[k].pos[0] + SW / 2, STORY[k].pos[1] + SH / 2];
  const edgePts = (k: number): [number, number][] => {
    const a = center(k);
    const b = center(k + 1);
    const dx = Math.sign(b[0] - a[0]);
    const dy = Math.sign(b[1] - a[1]);
    return [
      [a[0] + (dx * SW) / 2, a[1] + (dy * SH) / 2],
      [b[0] - (dx * SW) / 2, b[1] - (dy * SH) / 2],
    ];
  };
  const c = DDD_ROLES[cur.role];
  return (
    <Frame
      stageRef={ref}
      icon="present"
      tag="Passo a passo"
      title="O modelo conta a própria história"
      text="Na apresentação, cada caso de uso vira uma narrativa: o quadro esmaece o resto, destaca o elemento, anima o caminho até ele e explica o que é e por que está ali."
      cap={`Passo ${i + 1} de ${n} · ${DDD_ROLES[cur.role].label}`}
      ok
      wide
    >
      <div className="mo-split">
        <svg viewBox="0 0 320 190" role="img" aria-label="Câmera percorrendo os elementos de um caso de uso, um a um">
          <g transform={`translate(${(160 - cx) * 0.08} ${(95 - cy) * 0.08}) translate(160 95) scale(1.03) translate(-160 -95)`}>
            {STORY.slice(0, -1).map((_, k) => (
              <Poly key={k} pts={edgePts(k)} color={k < i ? "var(--c-sync)" : "var(--ink-3)"} w={k < i ? 2.4 : 1.4} dash={k < i ? undefined : "3 4"} />
            ))}
            {STORY.map((s, k) => (
              <Sticker key={k} x={s.pos[0]} y={s.pos[1]} w={SW} h={SH} role={s.role} label={s.label} o={k === i ? 1 : k < i ? 0.7 : 0.28} s={k === i ? 1.1 : 1} hot={k === i ? 0.7 + 0.3 * Math.sin(t * 60) : 0} fs={9.8} />
            ))}
          </g>
        </svg>
        <div className="mo-panel" key={i}>
          <span className="mo-role" style={style({ "--rc": c.color })}>
            {DDD_BADGES[cur.role]} · {c.label}
          </span>
          <b>O que é</b>
          <p>{cur.what}</p>
          <b>Por que está aqui</b>
          <p>{cur.why}</p>
          {cur.rule && (
            <>
              <b>Regras que sempre valem</b>
              <p>
                <code>{cur.rule}</code>
              </p>
            </>
          )}
        </div>
      </div>
      <div className="mo-dots" aria-hidden>
        {STORY.map((_, k) => (
          <i key={k} className={k === i ? "on" : k < i ? "done" : ""} />
        ))}
        <kbd>←</kbd>
        <kbd>→</kbd>
        <kbd>▶</kbd>
      </div>
    </Frame>
  );
}

/* ───────── 5 · Propriedades ───────── */

const PROPS_JSON = ['{', '  "id": "uuid",', '  "total": "Dinheiro",', '  "itens": "Item[]",', '  "nota?": "texto"', '}'];
const PROPS_ROWS: { name: string; type: string; key?: boolean; opt?: boolean; line: number }[] = [
  { name: "id", type: "uuid", key: true, line: 1 },
  { name: "total", type: "Dinheiro", line: 2 },
  { name: "itens", type: "Item[]", line: 3 },
  { name: "nota", type: "texto", opt: true, line: 4 },
];

function PropsMotion() {
  const [ref, t] = useClock(10000, 0.9);
  const full = PROPS_JSON.join("\n");
  const total = full.length;
  const typed = Math.floor(total * seg(t, 0.1, 0.5));
  const text = full.slice(0, typed);
  const lineEnd = (ln: number) => PROPS_JSON.slice(0, ln + 1).join("\n").length;
  const press = seg(t, 0.52, 0.56) * (1 - seg(t, 0.58, 0.64));
  const tsOn = out(seg(t, 0.78, 0.86)) * (1 - seg(t, 0.96, 1));
  const fade = 1 - seg(t, 0.96, 1);
  return (
    <Frame
      stageRef={ref}
      icon="list"
      tag="Propriedades"
      title="Campos de cada elemento, sem digitar um a um"
      text="Aggregate, entity, command, evento e read model ganham uma tabela de campos. Cole JSON, JSON Schema ou texto livre e o Archflow monta tudo — e leva para o passo a passo e para o código."
      cap="Cole JSON · tabela · tipos TypeScript"
      ok={tsOn > 0.5}
    >
      <div className="mo-props" style={style({ opacity: fade })}>
        <div className="mo-code">
          <span className="mo-btn" style={style({ transform: `scale(${1 - press * 0.08})`, ...(press > 0.3 ? { background: "var(--primary-600)", color: "#fff" } : {}) })}>
            Colar JSON / texto
          </span>
          <pre>
            {text}
            {typed < total && <span className="caret" />}
          </pre>
        </div>
        <div className="mo-arrow" aria-hidden>
          <Glyph name="arrow-up" size={20} style={{ transform: "rotate(90deg)" }} />
        </div>
        <div className="mo-table">
          <div className="mo-th">
            <span>nome</span>
            <span>tipo</span>
            <span title="identificador">#</span>
            <span title="opcional">?</span>
          </div>
          {PROPS_ROWS.map((r, i) => {
            const on = out(seg(typed, lineEnd(r.line), lineEnd(r.line) + 6)) * (typed >= lineEnd(r.line) ? 1 : 0);
            return (
              <div key={r.name} className="mo-tr" style={style({ opacity: on, transform: `translateY(${(1 - on) * 8}px)` })}>
                <span>{r.name}</span>
                <em>{r.type}</em>
                <span>{r.key ? "●" : ""}</span>
                <span>{r.opt ? "●" : ""}</span>
              </div>
            );
          })}
          <p className="mo-ts" style={style({ opacity: tsOn, transform: `translateY(${(1 - tsOn) * 6}px)` })}>
            <code>id: string · total: Dinheiro · itens: Item[] · nota?: string</code>
          </p>
        </div>
      </div>
    </Frame>
  );
}

/* ───────── 6 · Validação ───────── */

const VAL_RULES = [
  { id: "D001", text: "caso de uso sem command que o realize", at: 0.62 },
  { id: "D002", text: "command que não aciona nenhum aggregate", at: 0.7 },
  { id: "D003", text: "evento sem produtor", at: 0.78 },
];

function ValidateMotion() {
  const [ref, t] = useClock(10000, 0.9);
  const errIn = (k: number) => out(seg(t, 0.12 + k * 0.07, 0.2 + k * 0.07));
  const fixed = (k: number) => seg(t, 0.46 + k * 0.1, 0.56 + k * 0.1);
  const settle = 1 - seg(t, 0.95, 1);
  const open = VAL_RULES.reduce((n, _, k) => n + (fixed(k) >= 1 ? 0 : errIn(k) > 0.5 ? 1 : 0), 0);
  const st = { uc: [10, 28], cmd: [130, 28], agg: [250, 28], evt: [250, 118] } as const;
  const w = 82;
  const h = 40;
  const badge = (k: number, x: number, y: number) => {
    const done = fixed(k) >= 1;
    return (
      <g transform={`translate(${x} ${y}) scale(${errIn(k) * settle})`}>
        <circle r={11} fill={done ? "var(--ok)" : "var(--danger)"} />
        <text textAnchor="middle" y={3.6} className="mo-badge" style={{ fill: "#fff", fontSize: 9.5 }}>
          {done ? "✓" : "!"}
        </text>
      </g>
    );
  };
  return (
    <Frame
      stageRef={ref}
      icon="check"
      tag="Validação D001–D032"
      title="O modelo aponta o que falta antes de virar código"
      text="Cada regra tem id, severidade e clique para selecionar o elemento. Ligue o que falta e os avisos somem — a meta é rastrear cada caso de uso até um evento."
      cap={open === 0 && t > 0.8 ? "0 erros · todos os casos de uso rastreados" : `${open} ${open === 1 ? "erro" : "erros"} para corrigir`}
      ok={open === 0 && t > 0.8}
    >
      <div className="mo-validate" style={style({ opacity: settle })}>
        <svg viewBox="0 0 360 176" role="img" aria-label="Elementos de domínio sem ligação recebem avisos de erro que somem ao conectá-los">
          <Poly pts={[[st.cmd[0], st.cmd[1] + h / 2], [st.uc[0] + w, st.uc[1] + h / 2]]} color="var(--c-dep)" dash="5 4" p={ease(fixed(0))} />
          <Poly pts={[[st.cmd[0] + w, st.cmd[1] + h / 2], [st.agg[0], st.agg[1] + h / 2]]} color="var(--c-dep)" p={ease(fixed(1))} />
          <Poly pts={[[st.agg[0] + w / 2, st.agg[1] + h], [st.evt[0] + w / 2, st.evt[1]]]} color="var(--c-async)" p={ease(fixed(2))} />
          <Sticker x={st.uc[0]} y={st.uc[1]} w={w} h={h} role="use-case" label="Fazer pedido" />
          <Sticker x={st.cmd[0]} y={st.cmd[1]} w={w} h={h} role="command" label="criar-pedido" />
          <Sticker x={st.agg[0]} y={st.agg[1]} w={w} h={h} role="aggregate-root" label="Pedido" />
          <Sticker x={st.evt[0]} y={st.evt[1]} w={w} h={h} role="domain-event" label="pedido-criado" fs={9.8} />
          {badge(0, st.uc[0] + w - 4, st.uc[1] - 2)}
          {badge(1, st.cmd[0] + w - 4, st.cmd[1] - 2)}
          {badge(2, st.evt[0] + w - 4, st.evt[1] - 2)}
        </svg>
        <ul className="mo-rules">
          {VAL_RULES.map((r, k) => {
            const done = fixed(k) >= 1;
            return (
              <li key={r.id} className={done ? "ok" : ""} style={style({ opacity: errIn(k), transform: `translateX(${(1 - errIn(k)) * 12}px)` })}>
                <b>{r.id}</b>
                <span>{r.text}</span>
                <i>{done ? "✓" : "erro"}</i>
              </li>
            );
          })}
        </ul>
      </div>
    </Frame>
  );
}

/* ───────── 7 · Fluxo: decisão, condição e loop ───────── */

type Pt = [number, number];
const polyAt = (pts: Pt[], u: number): Pt => {
  const lens = pts.slice(1).map((q, i) => Math.hypot(q[0] - pts[i][0], q[1] - pts[i][1]));
  let d = clamp(u) * lens.reduce((a, b) => a + b, 0);
  for (let i = 0; i < lens.length; i++) {
    if (d <= lens[i]) return [lerp(pts[i][0], pts[i + 1][0], d / lens[i]), lerp(pts[i][1], pts[i + 1][1], d / lens[i])];
    d -= lens[i];
  }
  return pts[pts.length - 1];
};

const F_EVT: Pt = [8, 48];
const F_DEC: Pt = [208, 70];
const F_RETRY: Pt = [292, 48];
const F_CANCEL: Pt = [160, 160];
const P_IN: Pt[] = [[120, 70], [178, 70]];
const P_RETRY: Pt[] = [[238, 70], [292, 70]];
const P_LOOP: Pt[] = [[340, 48], [340, 18], [64, 18], [64, 48]];
const P_ELSE: Pt[] = [[208, 100], [208, 160]];

function FlowMotion() {
  const [ref, t] = useClock(11000, 0.9);
  // sequência: evento → decisão → retry → volta (2×) → decisão → senão → cancela
  const steps: { pts: Pt[]; a: number; b: number }[] = [
    { pts: P_IN, a: 0.06, b: 0.14 },
    { pts: P_RETRY, a: 0.16, b: 0.24 },
    { pts: P_LOOP, a: 0.26, b: 0.4 },
    { pts: P_IN, a: 0.42, b: 0.48 },
    { pts: P_RETRY, a: 0.5, b: 0.56 },
    { pts: P_LOOP, a: 0.58, b: 0.68 },
    { pts: P_IN, a: 0.7, b: 0.75 },
    { pts: P_ELSE, a: 0.78, b: 0.88 },
  ];
  const active = steps.find((s) => t >= s.a && t <= s.b);
  const dot = active ? polyAt(active.pts, ease(seg(t, active.a, active.b))) : null;
  const tries = t < 0.42 ? 1 : t < 0.7 ? 2 : 3;
  const branchLit = (pts: Pt[]) => (active?.pts === pts ? 1 : 0);
  const endOn = out(seg(t, 0.88, 0.94));
  const fade = 1 - seg(t, 0.96, 1);
  return (
    <Frame
      stageRef={ref}
      icon="sparkle"
      tag="Decisões e loops"
      title="Condições, “senão”, loops e “para cada”"
      text="O fluxo do negócio mostra seus ramos: decisão exclusiva, paralela ou junção; condição em cada saída; loop com condição de parada obrigatória. É documentação validada, que vira tipos no código gerado."
      cap={t < 0.88 ? `tentativa ${tries} de 3` : "3 tentativas esgotadas · senão cancela"}
      ok={t >= 0.88}
    >
      <svg viewBox={`0 0 ${VW} ${VH}`} role="img" aria-label="Um evento passa por uma decisão; se houver tentativas, repete em loop; senão, cancela o pedido" style={{ opacity: fade }}>
        <Poly pts={P_IN} color="var(--c-dep)" w={branchLit(P_IN) ? 3 : 2} />
        <Poly pts={P_RETRY} color="var(--c-dep)" w={branchLit(P_RETRY) ? 3 : 2} />
        <Poly pts={P_LOOP} color="var(--c-async)" dash="6 4" w={branchLit(P_LOOP) ? 3 : 2} />
        <Poly pts={P_ELSE} color="var(--c-dep)" w={branchLit(P_ELSE) ? 3 : 2} />
        <Tag x={265} y={58} text="se < 3" color="var(--c-dep)" />
        <Tag x={208} y={134} text="senão" color="var(--c-dep)" />
        <Tag x={198} y={18} text={`repete até pago · máx. 3`} color="var(--c-async)" />
        <Sticker x={F_EVT[0]} y={F_EVT[1]} w={112} h={44} role="domain-event" label="pagamento-recusado" fs={9.6} />
        <g transform={`translate(${F_DEC[0]} ${F_DEC[1]})`}>
          <path d="M0,-30 L30,0 L0,30 L-30,0 z" style={{ fill: `color-mix(in srgb, ${DDD_ROLES.decision.color} 24%, var(--s-solid))`, stroke: DDD_ROLES.decision.color }} strokeWidth={1.6} />
          <text textAnchor="middle" y={-2} className="mo-badge" style={{ fill: "var(--ink)", fontSize: 8 }}>
            DEC
          </text>
          <text textAnchor="middle" y={9} className="mo-t2" style={{ fontSize: 7.6 }}>
            tentar?
          </text>
        </g>
        <Sticker x={F_RETRY[0]} y={F_RETRY[1]} w={96} h={44} role="command" label="tentar-cobrar" fs={10} />
        <Sticker x={F_CANCEL[0]} y={F_CANCEL[1]} w={96} h={44} role="command" label="cancelar-pedido" fs={10} o={0.45 + endOn * 0.55} hot={endOn} />
        {dot && (
          <g transform={`translate(${dot[0]} ${dot[1]})`}>
            <circle r={9} fill="var(--primary)" opacity={0.25} />
            <circle r={5} fill="var(--primary-600)" stroke="#fff" strokeWidth={1.5} />
          </g>
        )}
        <g transform="translate(28 140)">
          {[0, 1, 2].map((k) => (
            <g key={k} transform={`translate(${k * 22} 0)`}>
              <circle r={7} style={{ fill: k < tries ? "var(--c-async)" : "var(--s-solid)", stroke: "var(--c-async)" }} strokeWidth={1.4} />
            </g>
          ))}
          <text x={-4} y={24} className="mo-t2" style={{ fontSize: 9.5 }}>
            tentativas
          </text>
        </g>
      </svg>
    </Frame>
  );
}

/* ───────── 8 · Código gerado ───────── */

const FILES = ["pedidos/domain/events.ts", "pedidos/domain/pedido.ts", "pedidos/domain/pedido-repository.ts", "pedidos/application/commands.ts", "pedidos/application/criar-pedido-handler.ts", "pedidos/use-cases.md"];
const CODE = [
  "export class Pedido {",
  "  criar(cmd: CriarPedido): DomainEvent[] {",
  "    // invariante: total maior que zero",
  "    // TODO: regra de negócio",
  "    return [new PedidoCriado(this.id)];",
  "  }",
  "}",
];

function CodeMotion() {
  const [ref, t] = useClock(10000, 0.9);
  const files = Math.floor(seg(t, 0.06, 0.4) * (FILES.length + 0.999));
  const full = CODE.join("\n");
  const typed = Math.floor(full.length * seg(t, 0.4, 0.8));
  const shown = full.slice(0, typed).split("\n");
  const okOn = out(seg(t, 0.84, 0.9));
  const fade = 1 - seg(t, 0.96, 1);
  return (
    <Frame
      stageRef={ref}
      icon="code"
      tag="Código"
      wide
      title="Do modelo ao esqueleto TypeScript"
      text="Um clique (ou generate_code) gera aggregates, eventos, repositories, commands, handlers, policies e sagas na regra application → domain — e compila em modo estrito."
      cap={okOn > 0.5 ? "tsc --strict ✓ · lógica como TODO" : "Gerando por contexto…"}
      ok={okOn > 0.5}
    >
      <div className="mo-codegen" style={style({ opacity: fade })}>
        <ul className="mo-files">
          {FILES.map((f, i) => (
            <li key={f} className={i === 1 && typed > 0 ? "cur" : ""} style={style({ opacity: files > i ? 1 : 0, transform: `translateX(${files > i ? 0 : -8}px)` })}>
              <Glyph name="file" size={13} /> {f.split("/").slice(-1)[0]}
              <small>{f.split("/").slice(0, -1).join("/")}</small>
            </li>
          ))}
        </ul>
        <pre className="mo-ts-code" tabIndex={0} aria-label="Exemplo de código gerado (role com as setas)">
          {shown.map((l, i) => (
            <span key={i} className={l.trim().startsWith("//") ? "cm" : ""}>
              {l}
              {i < shown.length - 1 ? "\n" : typed < full.length && <span className="caret" />}
            </span>
          ))}
        </pre>
      </div>
    </Frame>
  );
}

/* ───────── 9 · Modo Logic: regra executável com exemplo ───────── */

const LSTEPS: { role: LogicRole; label: string; sub: string; preco: string }[] = [
  { role: "start", label: "Calcular preço", sub: "preço atual 9,50", preco: "9,50" },
  { role: "decision", label: "Abaixo do piso?", sub: "preço < piso", preco: "9,50" },
  { role: "rule", label: "Subir ao piso", sub: "preco := piso", preco: "10,67" },
  { role: "end", label: "Preço final", sub: "desfecho ok", preco: "10,67" },
];

function LogicMotion() {
  const [ref, t] = useClock(9000, 0.92);
  const k = Math.min(LSTEPS.length - 1, Math.floor(seg(t, 0.08, 0.8) * LSTEPS.length));
  const done = t > 0.82;
  const w = 86;
  const h = 62;
  const gap = 16;
  const x0 = (VW - (LSTEPS.length * w + (LSTEPS.length - 1) * gap)) / 2;
  const y = 40;
  return (
    <Frame
      stageRef={ref}
      icon="mode-logic"
      tag="Modo Logic"
      title="Regras de negócio que o app executa e confere"
      text="Decisões, laços e regras em ordem, com expressões curtas em português. Cada exemplo roda de verdade: o valor muda passo a passo e o ✔ só aparece se o resultado esperado bate."
      cap={done ? "✔ exemplo: 9,50 → 10,67 confere" : `passo ${k + 1} de ${LSTEPS.length} · preço ${LSTEPS[k].preco}`}
      ok={done}
    >
      <svg viewBox={`0 0 ${VW} ${VH}`} role="img" aria-label="Um fluxo com início, decisão, regra e fim calcula o preço passo a passo e confere o exemplo">
        {LSTEPS.slice(1).map((_, i) => (
          <Poly key={i} pts={[[x0 + i * (w + gap) + w, y + h / 2], [x0 + (i + 1) * (w + gap), y + h / 2]]} color="var(--c-dep)" p={ease(seg(k - i, 0, 1))} />
        ))}
        {LSTEPS.map((st, i) => {
          const c = LOGIC_ROLES[st.role].color;
          const bw = LOGIC_ROLES[st.role].badge.length * 5.6 + 10;
          const on = i === k ? 1 : 0;
          return (
            <g key={i} transform={`translate(${x0 + i * (w + gap)} ${y})`} opacity={i <= k ? 1 : 0.35}>
              {on > 0 && <rect x={-4} y={-4} width={w + 8} height={h + 8} rx={13} fill="none" stroke={c} strokeWidth={2} opacity={0.55} />}
              <rect width={w} height={h} rx={9} style={{ fill: `color-mix(in srgb, ${c} 22%, var(--s-solid))`, stroke: c }} strokeWidth={1.4} />
              <rect x={6} y={6} width={bw} height={12} rx={6} fill={c} />
              <text x={6 + bw / 2} y={15} textAnchor="middle" className="mo-badge">
                {LOGIC_ROLES[st.role].badge}
              </text>
              <text x={7} y={37} className="mo-t" style={{ fontSize: 9.6, fontWeight: 650 }}>
                {st.label}
              </text>
              <text x={7} y={52} className="mo-t2" style={{ fontSize: 8.4 }}>
                {st.sub}
              </text>
            </g>
          );
        })}
        <g transform="translate(60 138)">
          <rect width={280} height={34} rx={17} className="mo-pill" />
          <text x={16} y={21.5} className="mo-t2" style={{ fontSize: 11 }}>
            preco
          </text>
          <text x={140} y={22} textAnchor="middle" className="mo-t" style={{ fontSize: 15, fontWeight: 700 }}>
            R$ {LSTEPS[k].preco}
          </text>
          <text x={264} y={21.5} textAnchor="end" className="mo-t" style={{ fontSize: 11, fontWeight: 700, fill: done ? "var(--ok)" : "var(--ink-3)" }}>
            {done ? "✔ confere" : "executando…"}
          </text>
        </g>
        <text x={200} y={200} textAnchor="middle" className="mo-t2" style={{ fontSize: 10 }}>
          dado: custo 8,00 · margem mínima 25% → piso 10,67
        </text>
      </svg>
    </Frame>
  );
}

/* ───────── MCP: 24 ferramentas ───────── */

const TOOLS: { n: string; g: 0 | 1 | 2 | 3; d: string }[] = [
  { n: "get_schema_guide", g: 0, d: "guia do schema, no modo do diagrama aberto" },
  { n: "list_assets", g: 0, d: "catálogo de tecnologias e papéis DDD" },
  { n: "search_assets", g: 0, d: "busca pelo problema que a tecnologia resolve" },
  { n: "get_diagram", g: 0, d: "lê o diagrama como texto, Mermaid e avisos" },
  { n: "get_diagram_outline", g: 0, d: "resumo para diagramas grandes" },
  { n: "list_diagrams", g: 0, d: "lista os diagramas do cofre" },
  { n: "new_diagram", g: 2, d: "cria um diagrama de arquitetura, domínio ou lógica" },
  { n: "open_diagram", g: 2, d: "abre um diagrama do cofre no quadro" },
  { n: "set_diagram_info", g: 2, d: "título, descrição e modo (Arch, Domain ou Logic)" },
  { n: "add_groups", g: 1, d: "nuvem, rede, camadas e bounded contexts" },
  { n: "add_components", g: 1, d: "serviços, bancos, papéis DDD e passos de lógica" },
  { n: "add_endpoints", g: 1, d: "GET, POST, WebSocket e gRPC presos ao serviço" },
  { n: "add_use_cases", g: 1, d: "casos de uso e atores, sem duplicar" },
  { n: "add_note", g: 1, d: "anotações no quadro" },
  { n: "add_asset", g: 1, d: "tecnologia própria no catálogo" },
  { n: "connect", g: 1, d: "conexões tipadas, relações DDD e saídas sim/não/repete" },
  { n: "update_element", g: 1, d: "ajusta qualquer elemento" },
  { n: "remove_elements", g: 1, d: "remove elementos e conexões" },
  { n: "auto_layout", g: 2, d: "fluxo em camadas, linha do tempo ou pipeline de regras" },
  { n: "clear_diagram", g: 2, d: "limpa o quadro — só sob pedido" },
  { n: "validate_diagram", g: 3, d: "regras de arquitetura, D001–D032 e L001–L024 (roda os exemplos)" },
  { n: "trace", g: 3, d: "caso de uso → command → aggregate → evento" },
  { n: "domain_overview", g: 3, d: "visão consolidada dos contextos do cofre" },
  { n: "generate_code", g: 3, d: "esqueleto TypeScript do domínio" },
];
const TOOL_GROUPS = ["Ler", "Construir", "Organizar", "Validar e gerar"];

export function McpMotion() {
  const [ref, t] = useClock(24000, 0.99);
  const k = Math.min(TOOLS.length - 1, Math.floor(t * TOOLS.length));
  const cur = TOOLS[k];
  return (
    <div className="glass mo-mcp" ref={ref}>
      <header>
        <span className="lp-ico">
          <Glyph name="plug" size={20} />
        </span>
        <div>
          <span className="mo-tag">Servidor MCP</span>
          <h3>{TOOLS.length} ferramentas para o seu agente</h3>
        </div>
        <ul className="mo-legend" aria-hidden>
          {TOOL_GROUPS.map((g, i) => (
            <li key={g} className={`g${i}`}>
              <i /> {g}
            </li>
          ))}
        </ul>
      </header>
      <ul className="mo-chips" aria-label="Ferramentas do servidor MCP">
        {TOOLS.map((tl, i) => (
          <li key={tl.n} className={`g${tl.g}${i === k ? " on" : ""}`}>
            {tl.n}
          </li>
        ))}
      </ul>
      <p className="mo-now" aria-live="off">
        <b>{cur.n}</b> <span>→ {cur.d}</span>
      </p>
    </div>
  );
}

/* ───────── seção ───────── */

export function MotionGallery() {
  return (
    <div className="mo-grid">
      <ModeMotion />
      <TimelineMotion />
      <LayoutMotion />
      <ValidateMotion />
      <FlowMotion />
      <PropsMotion />
      <StoryMotion />
      <CodeMotion />
      <LogicMotion />
    </div>
  );
}
