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
      text="Um clique troca entre Arch e Domain, sem apagar nada."
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

/* ───────── 2 · Auto-layout legível ───────── */

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
      text="A tecla L organiza o diagrama inteiro em camadas."
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

/* ───────── 3 · Validação ───────── */

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
      text="Ligue o que falta e os avisos somem."
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

/* ───────── 4 · Modo Logic: regra executável com exemplo ───────── */

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
      text="Cada exemplo roda de verdade e só ganha ✔ se o resultado bate."
      cap={done ? "✔ exemplo: 9,50 → 10,67 confere" : `passo ${k + 1} de ${LSTEPS.length} · preço ${LSTEPS[k].preco}`}
      ok={done}
    >
      <svg viewBox={`0 0 ${VW} ${VH}`} role="img" aria-label="Um fluxo com início, decisão, ação e fim calcula o preço passo a passo e confere o exemplo">
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

/* ───────── seção ───────── */

export function MotionGallery() {
  return (
    <div className="mo-grid">
      <ModeMotion />
      <LogicMotion />
      <LayoutMotion />
      <ValidateMotion />
    </div>
  );
}
