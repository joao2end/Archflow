import { Fragment, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { BUILTIN_ASSETS } from "../shared/catalog";
import { CONNECTION_TYPES, CONNECTION_TYPE_KEYS, type ConnectionType } from "../shared/schema";
import { Glyph, IconSvg } from "../ui/icons";
import { cycleTheme, useStore } from "../ui/store";
import CursorTrail from "./CursorTrail";

const asset = (id: string) => BUILTIN_ASSETS.find((a) => a.id === id)!;
const reduced = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
const style = (v: Record<string, string | number>) => v as CSSProperties;

/* ───────── hooks de motion ───────── */

function useInView<T extends Element>(opts: IntersectionObserverInit = { threshold: 0.2 }, once = true) {
  const ref = useRef<T>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") return setInView(true);
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) {
        setInView(true);
        if (once) io.disconnect();
      } else if (!once) setInView(false);
    }, opts);
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return [ref, inView] as const;
}

/** Aparece ao rolar (fade + subida), com atraso para escalonar. */
function Reveal({ children, delay = 0, className = "", as: Tag = "div" }: { children: ReactNode; delay?: number; className?: string; as?: "div" | "section" | "li" | "article" }) {
  const [ref, on] = useInView<HTMLElement>({ threshold: 0.15 });
  const T = Tag as "div";
  return (
    <T ref={ref as never} className={`rv ${on ? "in" : ""} ${className}`} style={style({ "--d": `${delay}ms` })}>
      {children}
    </T>
  );
}

function Count({ to, suffix = "" }: { to: number; suffix?: string }) {
  const [ref, on] = useInView<HTMLSpanElement>({ threshold: 0.6 });
  const [n, setN] = useState(reduced() ? to : 0);
  useEffect(() => {
    if (!on || reduced()) return setN(to);
    let raf = 0;
    const t0 = performance.now();
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / 1400);
      setN(Math.round(to * (1 - Math.pow(1 - p, 4))));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [on, to]);
  return (
    <span ref={ref}>
      {n}
      {suffix}
    </span>
  );
}

/* ───────── nó e rótulo reutilizáveis nos diagramas SVG ───────── */

function GNode({ x, y, id, label, sub, w = 158, h = 64, delay = 0, pop = true, on = true }: { x: number; y: number; id: string; label: string; sub: string; w?: number; h?: number; delay?: number; pop?: boolean; on?: boolean }) {
  const a = asset(id);
  const t = h - 20;
  const s = h / 64;
  return (
    <g transform={`translate(${x},${y})`}>
      <g className={pop ? "lp-pop" : on ? "dm on" : "dm"} style={style({ animationDelay: `${delay}ms`, transitionDelay: `${delay}ms` })}>
        <g className="node">
          <rect className="node-body" width={w} height={h} rx={17 * s} filter="url(#lp-shadow)" />
          <rect width={w} height={h} rx={17 * s} fill="url(#lp-sheen)" pointerEvents="none" />
          <rect className="node-ring" width={w} height={h} rx={17 * s} />
          <rect x={10 * s} y={10 * s} width={t} height={t} rx={13 * s} fill="#fff" fillOpacity={0.85} stroke={a.color} strokeOpacity={0.28} />
          <IconSvg icon={a.icon} color={a.color} name={a.name} size={t * 0.62} x={10 * s + t * 0.19} y={10 * s + t * 0.19} />
          <text className="node-label" x={t + 18 * s} y={h / 2 - 3} style={{ fontSize: 14.5 * s }}>
            {label}
          </text>
          <text className="node-sub" x={t + 18 * s} y={h / 2 + 14 * s} style={{ fontSize: 12 * s }}>
            {sub}
          </text>
        </g>
      </g>
    </g>
  );
}

function Pill({ x, y, text, color, delay = 0 }: { x: number; y: number; text: string; color: string; delay?: number }) {
  const w = text.length * 6.4 + 20;
  return (
    <g transform={`translate(${x},${y})`}>
      <g className="lp-fade" style={style({ animationDelay: `${delay}ms` })}>
        <g className="edge" style={style({ "--ec": color })}>
          <g className="edge-label">
            <rect x={-w / 2} y={-12} width={w} height={24} rx={12} />
            <text className="edge-label-main">{text}</text>
          </g>
        </g>
      </g>
    </g>
  );
}

function Defs() {
  return (
    <defs>
      <filter id="lp-shadow" x="-20%" y="-20%" width="140%" height="160%">
        <feDropShadow dx="0" dy="8" stdDeviation="9" floodColor="#000000" floodOpacity="0.14" />
        <feDropShadow dx="0" dy="1" stdDeviation="1" floodColor="#000000" floodOpacity="0.1" />
      </filter>
      <linearGradient id="lp-sheen" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" style={{ stopColor: "var(--sheen)", stopOpacity: "var(--sheen-a)" }} />
        <stop offset="0.5" style={{ stopColor: "var(--sheen)", stopOpacity: "var(--sheen-b)" }} />
      </linearGradient>
      {(["sync", "data", "async", "stream"] as ConnectionType[]).map((t) => (
        <marker key={t} id={`lp-h-${t}`} viewBox="0 0 12 12" refX="10" refY="6" markerWidth="11" markerHeight="11" orient="auto" markerUnits="userSpaceOnUse">
          <path d="M1 1.5L10.5 6L1 10.5z" fill={CONNECTION_TYPES[t].color} />
        </marker>
      ))}
    </defs>
  );
}

/** Aresta com desenho progressivo + partículas conforme o tipo. */
function Edge({ id, d, type, delay = 0, drawn = true }: { id: string; d: string; type: ConnectionType; delay?: number; drawn?: boolean }) {
  const t = CONNECTION_TYPES[type];
  const motionDelay = delay + 900;
  return (
    <g>
      <path
        id={`lp-${id}`}
        d={d}
        pathLength={1}
        fill="none"
        stroke={t.color}
        strokeWidth={2}
        strokeLinecap="round"
        markerEnd={`url(#lp-h-${type})`}
        className={`lp-draw ${drawn ? "on" : ""}`}
        style={style({ animationDelay: `${delay}ms`, transitionDelay: `${delay}ms`, "--dash": t.dash ? "0.035 0.03" : "1 1" })}
      />
      {drawn && t.motion === "flow" && <path d={d} fill="none" stroke={t.color} strokeWidth={3} strokeLinecap="round" strokeDasharray="0.1 16" className="flow lp-fade" style={style({ animationDelay: `${motionDelay}ms` })} />}
      {drawn &&
        t.motion === "pulse" &&
        [0, 1].map((i) => (
          <circle key={i} r={4.5} fill={t.color} className="particle">
            <animateMotion dur="2.6s" begin={`${motionDelay / 1000 + i * 1.3}s`} repeatCount="indefinite">
              <mpath href={`#lp-${id}`} />
            </animateMotion>
          </circle>
        ))}
      {drawn &&
        t.motion === "stream" &&
        [0, 1, 2, 3, 4].map((i) => (
          <circle key={i} r={2.8} fill={t.color} className="particle">
            <animateMotion dur="2s" begin={`${motionDelay / 1000 + i * 0.4}s`} repeatCount="indefinite">
              <mpath href={`#lp-${id}`} />
            </animateMotion>
          </circle>
        ))}
    </g>
  );
}

/* ───────── hero ───────── */

function HeroDiagram() {
  return (
    <svg viewBox="0 0 640 350" className="lp-hero-svg" role="img" aria-label="Exemplo de diagrama: Loja Web chama Orders API, que grava no PostgreSQL e publica eventos no SQS, consumidos pelo Claude">
      <Defs />
      <Edge id="e1" d="M168,172 C205,172 195,62 232,62" type="sync" delay={900} />
      <Edge id="e2" d="M390,62 L452,62" type="data" delay={1300} />
      <Edge id="e3" d="M311,94 L311,246" type="async" delay={1500} />
      <Edge id="e4" d="M390,278 L452,278" type="stream" delay={1900} />
      <Pill x={198} y={118} text="POST /orders" color={CONNECTION_TYPES.sync.color} delay={1700} />
      <Pill x={421} y={62} text="SQL" color={CONNECTION_TYPES.data.color} delay={1900} />
      <Pill x={311} y={170} text="OrderCreated" color={CONNECTION_TYPES.async.color} delay={2100} />
      <Pill x={421} y={278} text="consome" color={CONNECTION_TYPES.stream.color} delay={2400} />
      <GNode x={10} y={140} id="nextjs" label="Loja Web" sub="Next.js" delay={300} />
      <GNode x={232} y={30} id="laravel" label="Orders API" sub="Laravel 11" delay={500} />
      <GNode x={452} y={30} id="postgresql" label="Orders DB" sub="PostgreSQL" delay={700} />
      <GNode x={232} y={246} id="aws-sqs" label="order-events" sub="Amazon SQS" delay={900} />
      <GNode x={452} y={246} id="anthropic-claude" label="Recomendações" sub="Claude" delay={1100} />
    </svg>
  );
}

const HEADLINE: { t: string; em?: boolean }[] = [
  { t: "Desenhe" }, { t: "a" }, { t: "arquitetura" }, { t: "junto", em: true }, { t: "com" }, { t: "a" }, { t: "sua" }, { t: "IA." },
];

function Hero() {
  const ref = useRef<HTMLElement>(null);
  const onMove = (e: React.PointerEvent) => {
    const el = ref.current;
    if (!el || reduced()) return;
    const r = el.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width;
    const y = (e.clientY - r.top) / r.height;
    el.style.setProperty("--mx", String((x - 0.5) * 2));
    el.style.setProperty("--my", String((y - 0.5) * 2));
  };
  return (
    <section className="lp-hero" ref={ref} onPointerMove={onMove} onPointerLeave={() => ref.current && (ref.current.style.setProperty("--mx", "0"), ref.current.style.setProperty("--my", "0"))}>
      <div className="lp-hero-copy">
        <span className="lp-eyebrow lp-fade" style={style({ animationDelay: "100ms" })}>
          Quadro branco para arquitetura de software
        </span>
        <h1 aria-label="Desenhe a arquitetura junto com a sua IA.">
          {HEADLINE.map((w, i) => (
            <Fragment key={i}>
              <span className="w" aria-hidden style={style({ "--i": i })}>
                <span>{w.em ? <i>{w.t}</i> : w.t}</span>
              </span>{" "}
            </Fragment>
          ))}
        </h1>
        <p className="lp-lead lp-fade" style={style({ animationDelay: "900ms" })}>
          O Archflow transforma diagramas em um modelo que humanos e LLMs entendem: componentes, grupos e conexões tipadas — com um servidor MCP para que agentes desenhem ao seu lado, em tempo real.
        </p>
        <div className="lp-cta lp-fade" style={style({ animationDelay: "1100ms" })}>
          <a className="btn primary lg shine" href="/app">
            Abrir o Archflow <Glyph name="arrow-up" size={17} style={{ transform: "rotate(45deg)" }} />
          </a>
          <a className="btn lg" href="#demo">
            Ver em ação
          </a>
        </div>
        <ul className="lp-stats lp-fade" style={style({ animationDelay: "1300ms" })} aria-label="Números">
          <li>
            <b>
              <Count to={Math.floor(BUILTIN_ASSETS.length / 5) * 5} suffix="+" />
            </b>{" "}
            tecnologias
          </li>
          <li>
            <b>
              <Count to={CONNECTION_TYPE_KEYS.length} />
            </b>{" "}
            tipos de conexão
          </li>
          <li>
            <b>
              <Count to={17} />
            </b>{" "}
            ferramentas MCP
          </li>
          <li>
            <b>
              <Count to={100} suffix="%" />
            </b>{" "}
            local
          </li>
        </ul>
      </div>
      <div className="lp-hero-stage">
        <div className="lp-hero-art glass">
          <HeroDiagram />
        </div>
        <span className="lp-chip c1" style={style({ "--depth": 1.6 })}>
          <i style={{ background: CONNECTION_TYPES.sync.color }} /> sync · REST
        </span>
        <span className="lp-chip c2" style={style({ "--depth": -1.2 })}>
          <i style={{ background: CONNECTION_TYPES.async.color }} /> async · SQS
        </span>
        <span className="lp-chip c3" style={style({ "--depth": 2.2 })}>
          <Glyph name="plug" size={14} /> MCP conectado
        </span>
      </div>
    </section>
  );
}

/* ───────── marquee de tecnologias ───────── */

const ROW1 = ["laravel", "php", "postgresql", "mysql", "mongodb", "redis", "kafka", "rabbitmq", "docker", "kubernetes", "aws-lambda", "aws-s3", "aws-sqs", "aws-dynamodb", "aws-api-gateway", "aws-cloudfront", "gcp-cloud-run", "azure", "terraform", "grafana", "prometheus", "nginx", "cloudflare", "vercel", "supabase"];
const ROW2 = ["anthropic-claude", "openai-gpt", "gemini-pro", "llama", "mistral-large", "deepseek", "qwen", "react", "nextjs", "vue", "angular", "typescript", "python", "go", "rust", "java", "nestjs", "fastapi", "spring-boot", "stripe", "github-actions", "swagger", "graphql", "grpc", "ollama"];

function MarqueeRow({ ids, reverse }: { ids: string[]; reverse?: boolean }) {
  const items = ids.map(asset).filter(Boolean);
  const list = [...items, ...items];
  return (
    <div className={`lp-marquee ${reverse ? "rev" : ""}`} aria-hidden>
      <div className="lp-track">
        {list.map((a, i) => (
          <span key={i} className="lp-logo">
            <span className="lp-logo-tile">
              <IconSvg icon={a.icon} color={a.color} name={a.name} size={22} />
            </span>
            {a.name}
          </span>
        ))}
      </div>
    </div>
  );
}

function Logos() {
  return (
    <section className="lp-logos" aria-label="Tecnologias do catálogo">
      <Reveal>
        <p className="lp-logos-title">Um catálogo com contexto: cada tecnologia explica o problema que resolve</p>
      </Reveal>
      <MarqueeRow ids={ROW1} />
      <MarqueeRow ids={ROW2} reverse />
    </section>
  );
}

/* ───────── forma × significado ───────── */

const LEFT = [
  `{ "type": "rectangle", "x": 412, "y": 96,`,
  `  "width": 184, "height": 72, "seed": 80213,`,
  `  "roughness": 1, "strokeColor": "#1e1e1e",`,
  `  "boundElements": [{ "id": "Xk3…", "type": "arrow" }] }`,
  `{ "type": "arrow", "points": [[0,0],[138,41]],`,
  `  "startBinding": { "elementId": "Xk3…", "focus": 0.1 } }`,
  `// o que essa caixa É? só a geometria sabe.`,
];
const RIGHT = [
  `{ "id": "orders-api", "kind": "service",`,
  `  "asset": "laravel", "technology": "Laravel 11",`,
  `  "description": "Cria pedidos e publica eventos",`,
  `  "parent": "orders-context" }`,
  `{ "from": "orders-api", "to": "events",`,
  `  "type": "async", "protocol": "SQS",`,
  `  "interface": { "name": "order.created" } }`,
];

function Compare() {
  const [ref, on] = useInView<HTMLDivElement>({ threshold: 0.3 });
  const block = (lines: string[], base: number) =>
    lines.map((l, i) => (
      <span key={i} className={`cl ${on ? "in" : ""}`} style={style({ "--d": `${(base + i) * 110}ms` })}>
        {l}
        {"\n"}
      </span>
    ));
  return (
    <section id="o-que-e" className="lp-section">
      <Reveal>
        <span className="lp-eyebrow">O que é</span>
        <h2>
          Um quadro branco que guarda <i>significado</i>, não só formas.
        </h2>
      </Reveal>
      <Reveal delay={100}>
        <p className="lp-sub">
          Ferramentas de quadro branco guardam retângulos e coordenadas — para um LLM, o sentido está escondido na geometria. O Archflow nasceu de uma engenharia reversa do Excalidraw e guarda o que cada caixa é, quem fala com quem, por qual protocolo e com qual contrato.
        </p>
      </Reveal>
      <div className="lp-compare" ref={ref}>
        <div className="glass lp-pane dim">
          <div className="lp-pane-head">
            <span className="dot" /> Quadro branco comum <em>formas e coordenadas</em>
          </div>
          <pre>{block(LEFT, 0)}</pre>
        </div>
        <div className={`lp-arrow ${on ? "in" : ""}`} aria-hidden>
          <Glyph name="connect" size={26} stroke={2.2} />
        </div>
        <div className="glass lp-pane hot">
          <div className="lp-pane-head">
            <span className="dot ok" /> Archflow <em>componentes e relações</em>
          </div>
          <pre>{block(RIGHT, 5)}</pre>
        </div>
      </div>
    </section>
  );
}

/* ───────── demo: agente desenhando ───────── */

const PROMPT = "Desenhe um fluxo de pedidos: loja web, API Laravel, Postgres, fila SQS e um worker.";
const CALLS: { name: string; arg: string; out?: string }[] = [
  { name: "search_assets", arg: `{ query: "fila" }`, out: "aws-sqs · rabbitmq · kafka" },
  { name: "add_groups", arg: `{ id: "aws", kind: "cloud" }`, out: "✓" },
  { name: "add_components", arg: `[ web, orders-api, orders-db, events, worker ]`, out: "✓ 5" },
  { name: "connect", arg: `sync · data · async · stream`, out: "✓ 4" },
  { name: "auto_layout", arg: `{ direction: "LR" }`, out: "✓ organizado" },
];

function Demo() {
  const [ref, inView] = useInView<HTMLDivElement>({ threshold: 0.35 }, false);
  const [typed, setTyped] = useState(0);
  const [stage, setStage] = useState(0);
  const [fade, setFade] = useState(false);

  useEffect(() => {
    if (reduced()) {
      setTyped(PROMPT.length);
      setStage(CALLS.length);
      return;
    }
    if (!inView) return;
    let dead = false;
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    (async () => {
      while (!dead) {
        setFade(false);
        setTyped(0);
        setStage(0);
        await sleep(500);
        for (let i = 1; i <= PROMPT.length && !dead; i++) {
          setTyped(i);
          await sleep(22);
        }
        await sleep(450);
        for (let s = 1; s <= CALLS.length && !dead; s++) {
          setStage(s);
          await sleep(1150);
        }
        await sleep(4200);
        setFade(true);
        await sleep(700);
      }
    })();
    return () => {
      dead = true;
    };
  }, [inView]);

  const done = stage >= CALLS.length;
  return (
    <section id="demo" className="lp-section">
      <Reveal>
        <span className="lp-eyebrow">Veja em ação</span>
        <h2>
          Você pede. O agente <i>desenha</i>.
        </h2>
      </Reveal>
      <Reveal delay={100}>
        <p className="lp-sub">Cada chamada MCP aparece no quadro na hora — e tudo pode ser ajustado à mão ou desfeito com Ctrl+Z.</p>
      </Reveal>
      <div className={`lp-demo ${fade ? "fade" : ""}`} ref={ref}>
        <div className="lp-term glass">
          <div className="lp-term-bar">
            <i /> <i /> <i /> <span>Claude · archflow (MCP)</span>
          </div>
          <div className="lp-term-body">
            <p className="lp-user">
              <b>você ▸</b> {PROMPT.slice(0, typed)}
              {typed < PROMPT.length && <span className="caret" />}
            </p>
            {CALLS.map((c, i) => (
              <p key={c.name} className={`lp-call ${stage > i ? "on" : ""}`}>
                <span className="dotc" /> <b>{c.name}</b> <span className="arg">{c.arg}</span>
                {c.out && <span className="out">→ {c.out}</span>}
              </p>
            ))}
            <p className={`lp-done ${done ? "on" : ""}`}>Pronto — o diagrama está no seu quadro.</p>
          </div>
        </div>

        <div className="glass lp-board">
          <svg viewBox="0 0 560 320" role="img" aria-label="Diagrama sendo montado pelo agente">
            <Defs />
            <rect className={`lp-group dm ${stage >= 2 ? "on" : ""}`} x={176} y={14} width={376} height={292} rx={26} />
            <g className={`dm ${stage >= 2 ? "on" : ""}`}>
              <text x={196} y={38} className="group-kind" style={{ fill: "var(--c-async)" }}>
                CLOUD
              </text>
              <text x={196} y={60} className="group-label">
                AWS · sa-east-1
              </text>
            </g>
            <Edge id="d1" d="M146,160 C170,160 180,100 206,100" type="sync" drawn={stage >= 4} delay={0} />
            <Edge id="d2" d="M354,100 L402,100" type="data" drawn={stage >= 4} delay={250} />
            <Edge id="d3" d="M280,128 L280,222" type="async" drawn={stage >= 4} delay={500} />
            <Edge id="d4" d="M354,250 L402,250" type="stream" drawn={stage >= 4} delay={750} />
            <GNode x={8} y={132} id="nextjs" label="Loja Web" sub="Next.js" w={138} h={56} pop={false} on={stage >= 3} delay={0} />
            <GNode x={206} y={72} id="laravel" label="Orders API" sub="Laravel 11" w={148} h={56} pop={false} on={stage >= 3} delay={120} />
            <GNode x={402} y={72} id="postgresql" label="Orders DB" sub="PostgreSQL" w={140} h={56} pop={false} on={stage >= 3} delay={240} />
            <GNode x={206} y={222} id="aws-sqs" label="order-events" sub="Amazon SQS" w={148} h={56} pop={false} on={stage >= 3} delay={360} />
            <GNode x={402} y={222} id="aws-lambda" label="Worker" sub="AWS Lambda" w={140} h={56} pop={false} on={stage >= 3} delay={480} />
          </svg>
          <div className={`lp-badge ${done ? "on" : ""}`}>
            <Glyph name="check" size={14} /> auto-layout aplicado
          </div>
        </div>
      </div>
    </section>
  );
}

/* ───────── conexões animadas ───────── */

function ConnLine({ type }: { type: ConnectionType }) {
  const t = CONNECTION_TYPES[type];
  const id = `cl-${type}`;
  const x1 = type === "composition" || type === "aggregation" ? 56 : 44;
  const x2 = t.head === "none" ? 216 : 206;
  return (
    <svg viewBox="0 0 260 48" className="lp-conn-svg" aria-hidden>
      <rect x={4} y={10} width={34} height={28} rx={9} className="cn" />
      <rect x={222} y={10} width={34} height={28} rx={9} className="cn" />
      {t.tail === "diamond" && <path d="M38 24l9-6 9 6-9 6z" fill={t.color} />}
      {t.tail === "diamond-open" && <path d="M38 24l9-6 9 6-9 6z" style={{ fill: "var(--s-solid)" }} stroke={t.color} strokeWidth="1.6" />}
      <path id={id} d={`M${x1},24 L${x2},24`} stroke={t.color} strokeWidth={2.2} strokeLinecap="round" strokeDasharray={t.dash ? "5 5" : undefined} fill="none" opacity={t.motion === "none" ? 1 : 0.5} />
      {t.head === "arrow" && <path d="M204 17l11 7-11 7z" fill={t.color} />}
      {t.head === "open" && <path d="M205 16l11 8-11 8" fill="none" stroke={t.color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />}
      {t.head === "triangle" && <path d="M204 15l14 9-14 9z" style={{ fill: "var(--s-solid)" }} stroke={t.color} strokeWidth="1.8" strokeLinejoin="round" />}
      {t.motion === "flow" && <path d={`M${x1},24 L${x2},24`} stroke={t.color} strokeWidth={3.2} strokeLinecap="round" strokeDasharray="0.1 14" fill="none" className="flow" />}
      {t.motion === "pulse" &&
        [0, 1].map((i) => (
          <circle key={i} r={4.5} fill={t.color} className="particle">
            <animateMotion dur="2.2s" begin={`${i * 1.1}s`} repeatCount="indefinite">
              <mpath href={`#${id}`} />
            </animateMotion>
          </circle>
        ))}
      {t.motion === "stream" &&
        [0, 1, 2, 3, 4].map((i) => (
          <circle key={i} r={2.8} fill={t.color} className="particle">
            <animateMotion dur="1.8s" begin={`${i * 0.36}s`} repeatCount="indefinite">
              <mpath href={`#${id}`} />
            </animateMotion>
          </circle>
        ))}
    </svg>
  );
}

function Connections() {
  return (
    <section className="lp-section">
      <Reveal>
        <span className="lp-eyebrow">Conexões</span>
        <h2>
          Setas que <i>significam</i> alguma coisa.
        </h2>
      </Reveal>
      <Reveal delay={100}>
        <p className="lp-sub">Dez tipos — do request síncrono ao evento assíncrono e às relações UML. As mais dinâmicas se movem, para o fluxo ficar visível.</p>
      </Reveal>
      <div className="lp-conns">
        {CONNECTION_TYPE_KEYS.map((k, i) => (
          <Reveal key={k} delay={(i % 5) * 70} className="glass lp-conn">
            <ConnLine type={k} />
            <h3>{CONNECTION_TYPES[k].label}</h3>
            <p>{CONNECTION_TYPES[k].semantics.split(".")[0]}.</p>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

/* ───────── recursos com spotlight ───────── */

const FEATURES: { icon: string; title: string; text: string }[] = [
  { icon: "library", title: "Catálogo com contexto", text: "AWS, Google, Azure, Laravel, PostgreSQL, Kafka e os principais modelos de IA — cada um explica o problema que resolve. Cadastre os seus." },
  { icon: "code", title: "Interfaces e contratos", text: "Defina operações, métodos e payloads em cada conexão e referencie OpenAPI, AsyncAPI ou .proto." },
  { icon: "plug", title: "Feito para agentes (MCP)", text: "Claude e outros clientes MCP leem e editam o diagrama em tempo real. Você vê, ajusta e desfaz com Ctrl+Z." },
  { icon: "group", title: "Grupos e auto-layout", text: "Nuvem, rede, camadas e bounded contexts aninhados, com organização automática por fluxo." },
  { icon: "sparkle", title: "Visão LLM", text: "Veja o diagrama como um modelo o enxerga: Markdown, Mermaid e JSON — pronto para colar no chat." },
  { icon: "moon", title: "Claro, escuro e vidro", text: "Interface glassmorphism limpa, com tema claro, escuro ou automático e atalhos para tudo." },
];

function Spot({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`glass lp-card spot ${className}`}
      onPointerMove={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        e.currentTarget.style.setProperty("--x", `${e.clientX - r.left}px`);
        e.currentTarget.style.setProperty("--y", `${e.clientY - r.top}px`);
      }}
    >
      {children}
    </div>
  );
}

function Features() {
  return (
    <section id="recursos" className="lp-section">
      <Reveal>
        <span className="lp-eyebrow">Recursos</span>
        <h2>
          Tudo para projetar <i>soluções</i>, sem poluir a tela.
        </h2>
      </Reveal>
      <div className="lp-grid">
        {FEATURES.map((f, i) => (
          <Reveal key={f.title} delay={(i % 3) * 90}>
            <Spot>
              <span className="lp-ico">
                <Glyph name={f.icon} size={22} />
              </span>
              <h3>{f.title}</h3>
              <p>{f.text}</p>
            </Spot>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

/* ───────── guia de uso × Excalidraw ───────── */

type Mark = "yes" | "part" | "no";
const MARKS: Record<Mark, string> = { yes: "Sim", part: "Parcial", no: "Não" };

const COMPARE_ROWS: { feat: string; ex: Mark; exNote: string; af: Mark; afNote: string }[] = [
  { feat: "Elementos com significado (tipo, tecnologia, papel)", ex: "no", exNote: "formas geométricas", af: "yes", afNote: "componente · kind · tecnologia" },
  { feat: "Catálogo de tecnologias com “o problema que resolve”", ex: "part", exNote: "bibliotecas da comunidade (ícones)", af: "yes", afNote: "~155 itens + cadastro próprio" },
  { feat: "Conexões tipadas (síncrona, assíncrona, streaming, UML)", ex: "no", exNote: "setas com estilo visual", af: "yes", afNote: "10 tipos com semântica definida" },
  { feat: "Fluxo animado nas conexões", ex: "no", exNote: "", af: "yes", afNote: "fluxo, pulsos e streaming" },
  { feat: "Interfaces e contratos (OpenAPI, eventos, gRPC)", ex: "no", exNote: "texto solto", af: "yes", afNote: "operações, payloads e contrato" },
  { feat: "Grupos hierárquicos + auto-layout por fluxo", ex: "part", exNote: "frames e posicionamento manual", af: "yes", afNote: "pai/filho real, layout em camadas" },
  { feat: "Agente de IA edita ao vivo em nível semântico (MCP)", ex: "part", exNote: "servidores de terceiros, em nível de formas", af: "yes", afNote: "MCP nativo, sem coordenadas" },
  { feat: "Visão para LLM (Markdown, Mermaid, validação)", ex: "no", exNote: "", af: "yes", afNote: "texto determinístico + avisos" },
  { feat: "Endpoints como componentes (GET/POST, WebSocket, GraphQL, gRPC)", ex: "no", exNote: "texto dentro de caixas", af: "yes", afNote: "selos por método, presos ao serviço" },
  { feat: "Referência entre diagramas, com visualização em modal", ex: "part", exNote: "links por URL, sem pré-visualização", af: "yes", afNote: "modal navegável, backlinks, links que se atualizam" },
  { feat: "Cofre de arquivos com pastas, busca e lixeira", ex: "part", exNote: "um arquivo por cena", af: "yes", afNote: "vários cofres, Git, Ctrl+O" },
  { feat: "Desenho livre e estilo “à mão”", ex: "yes", exNote: "referência no assunto", af: "no", afNote: "foco em precisão" },
  { feat: "Colaboração multiusuário em tempo real", ex: "yes", exNote: "com criptografia ponta a ponta", af: "part", afNote: "humano + agentes (multiusuário no roadmap)" },
];

const GUIDE: { id: string; icon: string; title: string; steps: string[]; keys: string[]; ex: string; af: string }[] = [
  {
    id: "assets", icon: "library", title: "Catálogo",
    steps: [
      "Abra a biblioteca (B) e busque “fila”, “laravel” ou “cache” — a busca olha nome, categoria, tags e o problema que a tecnologia resolve.",
      "Passe o mouse num item para ler *o que ele resolve* e quando usar.",
      "Arraste para o quadro (ou clique) — o componente já nasce com ícone, papel e tecnologia.",
      "Falta algo interno? “Novo asset”: nome, ícone, cor e a pergunta-chave: *que problema resolve?*",
    ],
    keys: ["B", "/"],
    ex: "Formas genéricas e bibliotecas de ícones: o desenho diz “caixa”, não “fila SQS que desacopla o checkout”.",
    af: "Cada ícone carrega contexto (papel, tags, problema resolvido). Humanos e agentes escolhem pela necessidade, não pela aparência.",
  },
  {
    id: "conn", icon: "connect", title: "Conexões",
    steps: [
      "Escolha o tipo na barra inferior: síncrona, assíncrona, streaming, dados ou uma relação UML.",
      "Passe o mouse num componente e arraste do ponto “+” até outro (ou use a ferramenta C).",
      "Clique na conexão para ajustar tipo, rótulo, protocolo e traçado (curva, ortogonal ou reta).",
      "Ligue as animações (A) e veja o fluxo: requisições contínuas, eventos pulsando, dados em streaming.",
    ],
    keys: ["C", "A"],
    ex: "Setas só mudam de estilo (tracejada, ponta). O significado fica na cabeça de quem desenhou.",
    af: "Dez tipos com semântica explícita. Ler o diagrama diz se a chamada bloqueia, se é evento ou se é herança — e a animação mostra o fluxo.",
  },
  {
    id: "iface", icon: "code", title: "Interfaces",
    steps: [
      "Selecione uma conexão (ou dê duplo clique nela).",
      "Clique em “Definir interface” e escolha o estilo: REST, GraphQL, gRPC, evento, SQL…",
      "Informe o contrato formal (OpenAPI, AsyncAPI, .proto) e as operações: método, caminho, entrada e saída.",
      "A conexão ganha um indicador e o contrato segue para a Visão LLM — pronto para virar código.",
    ],
    keys: ["2× clique"],
    ex: "Contratos viram texto solto numa caixa ao lado da seta — fácil de ficar desatualizado e impossível de validar.",
    af: "O contrato é dado estruturado ligado à seta. Um agente consegue implementar os dois lados da integração a partir do diagrama.",
  },
  {
    id: "group", icon: "group", title: "Grupos e layout",
    steps: [
      "Tecla G e arraste uma área: nuvem, VPC, camada ou bounded context.",
      "Arraste componentes para dentro — o grupo vira o “pai” deles e se ajusta ao conteúdo.",
      "Aninhe grupos (AWS › VPC › serviço) para refletir a hierarquia real.",
      "Tecla L organiza tudo por fluxo; Shift+L organiza na vertical.",
    ],
    keys: ["G", "L"],
    ex: "Frames agrupam visualmente e o alinhamento é manual — cada mudança de escopo é redesenho.",
    af: "Pertencimento é dado (parent), não coincidência de coordenadas. O auto-layout em camadas reorganiza o diagrama inteiro em um toque.",
  },
  {
    id: "mcp", icon: "plug", title: "Agente (MCP)",
    steps: [
      "Rode npm run bridge e adicione o servidor: claude mcp add archflow -- npx tsx server/mcp.ts.",
      "Com o app aberto, peça: “Desenhe um fluxo de pedidos com Laravel, Postgres e SQS”.",
      "Acompanhe o quadro sendo montado ao vivo. Não gostou? Ctrl+Z desfaz a edição do agente.",
      "Peça uma revisão: validate_diagram aponta componentes isolados e referências quebradas.",
    ],
    keys: ["Ctrl", "Z"],
    ex: "Um LLM precisa gerar elementos com coordenadas e vínculos de seta — ou texto Mermaid convertido, perdendo a edição visual.",
    af: "Operações semânticas: o agente fala em componentes e conexões; o app cuida de posição e layout. Menos erros, menos tokens.",
  },
  {
    id: "vault", icon: "vault", title: "Cofre",
    steps: [
      "Tecla E abre o explorador do cofre. Na primeira vez, crie um cofre (nome + local) ou abra uma pasta existente.",
      "Crie pastas e diagramas, arraste para mover, F2 renomeia, botão direito abre o menu.",
      "Ctrl+O busca qualquer diagrama do cofre — e cria um novo se não existir.",
      "Versione a pasta no Git: cada diagrama é um .archflow.json legível.",
    ],
    keys: ["E", "Ctrl+O"],
    ex: "Um arquivo por cena; organizar um projeto com dezenas de diagramas fica por sua conta.",
    af: "Cofres estilo Obsidian: várias pastas, subpastas, lixeira recuperável e edição externa recarregada ao vivo.",
  },
  {
    id: "endpoints", icon: "plug", title: "Endpoints",
    steps: [
      "Selecione um serviço (ex.: Orders API). No inspetor, em *Endpoints e comunicação*, clique em + GET, + POST, + PUT, + PATCH, + DELETE, + WS, + GraphQL, + gRPC, + Webhook, + SSE ou + Evento.",
      "Ou abra a biblioteca (B), categoria *Comunicação*, e solte o endpoint sobre o serviço — ele passa a pertencer a ele, empilhado logo abaixo.",
      "Edite caminho, entrada, saída e autenticação no inspetor. O selo muda de cor conforme o método (GET verde, POST azul, DELETE vermelho…).",
      "Conecte um cliente direto ao endpoint específico (POST /orders), não só ao serviço inteiro.",
    ],
    keys: ["B"],
    ex: "Um endpoint é um retângulo com texto; mover o serviço não leva os endpoints, e nada diferencia GET de POST para uma máquina.",
    af: "Endpoints são componentes tipados (protocolo, método, caminho, contrato) que acompanham o serviço e entram na Visão LLM — como os nós de gatilho e ação do n8n, mas para arquitetura.",
  },
  {
    id: "refs", icon: "layers", title: "Referências",
    steps: [
      "Desenvolva o diagrama de um sistema (ex.: Pagamentos). Em outro diagrama, arraste-o do explorador (E) para o quadro — ou use a biblioteca › *Outro diagrama*.",
      "Escolha, se quiser, um componente específico dele (ex.: Payments API) e conecte seus serviços ao nó de referência.",
      "Clique na referência: o diagrama abre num *modal de visualização*, com zoom e detalhes dos componentes.",
      "Dentro do modal, clique em outra referência para entrar nela. As setas ← → (ou Alt+←/→) voltam e avançam pelo caminho percorrido.",
      "“Editar” abre o diagrama para edição e o botão Voltar traz você de volta. Veja quem referencia o diagrama atual em *Referenciado por*.",
    ],
    keys: ["E", "Alt+←/→"],
    ex: "Cada cena é isolada; relacionar sistemas significa copiar e colar desenhos ou colar links que ficam quebrados quando algo muda.",
    af: "Referências vivas entre diagramas: pré-visualização em modal, navegação em camadas, backlinks e atualização automática dos links quando você renomeia ou move arquivos.",
  },
  {
    id: "llm", icon: "sparkle", title: "Visão LLM",
    steps: [
      "Clique em “Visão LLM” na barra superior.",
      "Escolha Markdown, Mermaid, JSON ou o guia do schema.",
      "Copie para o chat, o PR ou o README — sem coordenadas, só papéis, protocolos e contratos.",
    ],
    keys: [],
    ex: "Exportar vira imagem ou JSON de geometria: bom para ver, ruim para raciocinar ou revisar em code review.",
    af: "Texto determinístico e versionável, com avisos de inconsistência. O diagrama vira documentação que a máquina também lê.",
  },
];

const em = (s: string) => s.split(/(\*[^*]+\*)/g).map((p, i) => (p.startsWith("*") ? <em key={i}>{p.slice(1, -1)}</em> : p));

function Guide() {
  const [tab, setTab] = useState(0);
  const g = GUIDE[tab];
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowRight") setTab((t) => (t + 1) % GUIDE.length);
    if (e.key === "ArrowLeft") setTab((t) => (t - 1 + GUIDE.length) % GUIDE.length);
  };
  return (
    <section id="guia" className="lp-section">
      <Reveal>
        <span className="lp-eyebrow">Guia · Archflow × Excalidraw</span>
        <h2>
          O que o Archflow faz que o Excalidraw <i>não faz</i>.
        </h2>
      </Reveal>
      <Reveal delay={100}>
        <p className="lp-sub">O Excalidraw é excelente para esboçar. O Archflow é feito para projetar: cada elemento tem significado, e isso muda o que dá para fazer — por você e pela sua IA.</p>
      </Reveal>

      <Reveal delay={120}>
        <div className="glass lp-table" role="table" aria-label="Comparação entre Excalidraw e Archflow">
          <div className="lp-tr-head" role="row">
            <span role="columnheader">Capacidade</span>
            <span role="columnheader">Excalidraw</span>
            <span role="columnheader" className="af">Archflow</span>
          </div>
          {COMPARE_ROWS.map((r, i) => (
            <div key={r.feat} className="lp-trow" role="row" style={style({ "--i": i })}>
              <span role="cell" className="feat">{r.feat}</span>
              <span role="cell" className={`cell ${r.ex}`}>
                <b className="mk">{MARKS[r.ex]}</b>
                {r.exNote && <small>{r.exNote}</small>}
              </span>
              <span role="cell" className={`cell af ${r.af}`}>
                <b className="mk">{MARKS[r.af]}</b>
                {r.afNote && <small>{r.afNote}</small>}
              </span>
            </div>
          ))}
        </div>
        <p className="lp-foot">Comparação com os recursos nativos do Excalidraw de código aberto; extensões e serviços de terceiros podem cobrir parte das lacunas. Onde o Excalidraw é melhor, dizemos — o Archflow não tenta substituí-lo em desenho livre nem em colaboração multiusuário.</p>
      </Reveal>

      <Reveal delay={80}>
        <h3 className="lp-guide-h">Como usar, funcionalidade por funcionalidade</h3>
        <div className="lp-tabs" role="tablist" aria-label="Funcionalidades" onKeyDown={onKey}>
          {GUIDE.map((t, i) => (
            <button key={t.id} role="tab" id={`tab-${t.id}`} aria-selected={i === tab} aria-controls="guide-panel" tabIndex={i === tab ? 0 : -1} className={i === tab ? "on" : ""} onClick={() => setTab(i)}>
              <Glyph name={t.icon} size={16} /> {t.title}
            </button>
          ))}
        </div>
        <div className="glass lp-guide" id="guide-panel" role="tabpanel" aria-labelledby={`tab-${g.id}`} key={g.id}>
          <div className="lp-guide-steps">
            <h4>Passo a passo</h4>
            <ol>
              {g.steps.map((s, i) => (
                <li key={i} style={style({ "--i": i })}>
                  {em(s)}
                </li>
              ))}
            </ol>
            {g.keys.length > 0 && (
              <p className="lp-keys">
                Atalhos: {g.keys.map((k) => (
                  <kbd key={k}>{k}</kbd>
                ))}
              </p>
            )}
          </div>
          <div className="lp-vs">
            <div className="lp-vs-card ex">
              <span>No Excalidraw</span>
              <p>{g.ex}</p>
            </div>
            <div className="lp-vs-card af">
              <span>No Archflow</span>
              <p>{g.af}</p>
            </div>
          </div>
        </div>
      </Reveal>
    </section>
  );
}

/* ───────── cofre ───────── */

function Vault() {
  return (
    <section className="lp-section lp-vault-sec">
      <div>
        <Reveal>
          <span className="lp-eyebrow">Cofre de diagramas</span>
          <h2>
            Seus diagramas, na <i>sua</i> pasta.
          </h2>
        </Reveal>
        <Reveal delay={100}>
          <p className="lp-sub left">Inspirado no cofre do Obsidian: uma pasta qualquer vira um cofre, com subpastas livres. Sem nuvem obrigatória, versionável no Git e compartilhado com o seu agente via MCP.</p>
        </Reveal>
        <Reveal delay={200}>
          <ul className="lp-checks">
            <li>
              <Glyph name="check" size={16} /> Explorador com árvore, busca rápida (<kbd>Ctrl</kbd>+<kbd>O</kbd>) e arrastar para mover
            </li>
            <li>
              <Glyph name="check" size={16} /> Vários cofres e lixeira recuperável
            </li>
            <li>
              <Glyph name="check" size={16} /> Edições externas recarregam ao vivo
            </li>
          </ul>
        </Reveal>
      </div>
      <Reveal delay={150}>
        <div className="glass lp-tree" aria-label="Exemplo do explorador de arquivos">
          <div className="lp-tree-head">
            <Glyph name="vault" size={18} /> <span>Arquitetura 2end</span>
          </div>
          <div className="lp-tr" style={style({ "--i": 0 })}>
            <Glyph name="chevron" size={13} /> <Glyph name="folder" size={16} /> backend <em>3</em>
          </div>
          <div className="lp-tr f" style={style({ "--i": 1 })}>
            <Glyph name="file" size={15} /> Orders API
          </div>
          <div className="lp-tr f" style={style({ "--i": 2 })}>
            <Glyph name="file" size={15} /> Pagamentos
          </div>
          <div className="lp-tr drop" style={style({ "--i": 3 })}>
            <Glyph name="chevron" size={13} style={{ transform: "rotate(-90deg)" }} /> <Glyph name="folder" size={16} /> infra <em>2</em>
          </div>
          <div className="lp-tr" style={style({ "--i": 4 })}>
            <Glyph name="file" size={15} /> Visão geral
          </div>
          <div className="lp-dragchip">
            <Glyph name="file" size={15} /> Checkout
          </div>
        </div>
      </Reveal>
    </section>
  );
}

/* ───────── página ───────── */

function Nav({ theme }: { theme: string }) {
  return (
    <header className="lp-nav glass">
      <a className="brand" href="/" aria-label="Archflow">
        <span className="brand-mark">
          <Glyph name="connect" size={15} stroke={2.4} />
        </span>
        Arch<i>flow</i>
      </a>
      <nav className="lp-links" aria-label="Seções">
        <a href="#o-que-e">O que é</a>
        <a href="#demo">Em ação</a>
        <a href="#recursos">Recursos</a>
        <a href="#guia">Guia</a>
      </nav>
      <button className="btn ghost icon" onClick={cycleTheme} aria-label={`Tema: ${theme}`} data-tip="Alternar tema" data-tip-pos="bottom">
        <Glyph name={{ system: "monitor", light: "sun", dark: "moon" }[theme as "system"]} size={18} />
      </button>
      <a className="btn primary shine" href="/app">
        Abrir o app
      </a>
    </header>
  );
}

export default function Landing() {
  const theme = useStore((s) => s.theme);
  const root = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const onScroll = () => {
      const max = el.scrollHeight - el.clientHeight;
      bar.current?.style.setProperty("--p", String(max > 0 ? el.scrollTop / max : 0));
      el.classList.toggle("scrolled", el.scrollTop > 24);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    onScroll();

    // Scroll por seção: um gesto de roda leva à próxima seção com easing.
    // Seções mais altas que a tela rolam nativamente até a borda.
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let animating = false;
    let raf = 0;
    let cooldownUntil = 0;

    const navH = () => el.querySelector<HTMLElement>(".lp-nav")?.offsetHeight ?? 0;
    const tops = () => {
      const base = el.getBoundingClientRect().top;
      const nh = navH();
      const nodes = el.querySelectorAll<HTMLElement>("main > section, main > .lp-final-wrap, footer");
      const list = Array.from(nodes, (n) => Math.max(0, Math.round(n.getBoundingClientRect().top - base + el.scrollTop - nh)));
      list[0] = 0;
      return list;
    };

    // O alvo é reavaliado a cada quadro: o layout pode mudar durante a animação.
    const animateTo = (getTarget: () => number) => {
      const clamp = () => Math.min(Math.max(0, getTarget()), el.scrollHeight - el.clientHeight);
      const from = el.scrollTop;
      if (Math.abs(clamp() - from) < 2) return;
      const dur = Math.min(1100, 600 + Math.abs(clamp() - from) * 0.25);
      const t0 = performance.now();
      animating = true;
      el.style.scrollBehavior = "auto";
      const step = (now: number) => {
        const p = Math.min(1, (now - t0) / dur);
        const e = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
        el.scrollTop = from + (clamp() - from) * e;
        if (p < 1) raf = requestAnimationFrame(step);
        else {
          animating = false;
          cooldownUntil = performance.now() + 350;
        }
      };
      raf = requestAnimationFrame(step);
    };

    const onWheel = (e: WheelEvent) => {
      if (reduce || e.ctrlKey || Math.abs(e.deltaY) < Math.abs(e.deltaX)) return;
      if (animating || performance.now() < cooldownUntil) {
        e.preventDefault();
        return;
      }
      if (Math.abs(e.deltaY) < 4) return;
      const y = el.scrollTop;
      const vh = el.clientHeight;
      const list = tops();
      if (e.deltaY > 0) {
        const ni = list.findIndex((t) => t > y + 8);
        if (ni < 0 || list[ni] - y > vh + 8) return;
        e.preventDefault();
        animateTo(() => tops()[ni]);
      } else {
        let cur = -1;
        list.forEach((t, i) => t <= y + 8 && (cur = i));
        if (cur < 0) return;
        const off = y - list[cur];
        if (off > vh) return;
        if (off <= 8 && cur === 0) return;
        e.preventDefault();
        const ti = off > 8 ? cur : cur - 1;
        animateTo(() => tops()[ti]);
      }
    };

    const onClick = (e: MouseEvent) => {
      const a = (e.target as HTMLElement).closest<HTMLAnchorElement>('a[href^="#"]');
      const id = a?.getAttribute("href")?.slice(1);
      const dest = id ? el.querySelector<HTMLElement>(`#${CSS.escape(id)}`) : null;
      if (!dest) return;
      e.preventDefault();
      const target = () => dest.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop - navH();
      if (reduce) el.scrollTop = target();
      else {
        cancelAnimationFrame(raf);
        animateTo(target);
      }
    };

    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("click", onClick);
    return () => {
      el.removeEventListener("scroll", onScroll);
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("click", onClick);
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <>
    <div className="lp" ref={root}>
      <div className="backdrop" aria-hidden />
      <div className="lp-aurora" aria-hidden>
        <i className="a1" />
        <i className="a2" />
        <i className="a3" />
      </div>
      <div className="lp-progress" ref={bar} aria-hidden />
      <Nav theme={theme} />

      <main>
        <Hero />
        <Logos />
        <Compare />
        <Demo />
        <Connections />
        <Features />
        <Guide />
        <Vault />

        <Reveal className="lp-final-wrap">
          <section className="lp-final">
            <h2>
              Pronto para desenhar <i>junto</i>?
            </h2>
            <p>Abra o app, crie um cofre e comece com o exemplo ou com uma tela em branco.</p>
            <a className="btn primary lg shine" href="/app">
              Abrir o Archflow
            </a>
          </section>
        </Reveal>
      </main>

      <footer className="lp-footer">© 2026 2-end Software Development</footer>
    </div>
    <CursorTrail />
    </>
  );
}
