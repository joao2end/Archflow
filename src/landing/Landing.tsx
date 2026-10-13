import { Fragment, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { BUILTIN_ASSETS } from "../shared/catalog";
import { CONNECTION_TYPES, CONNECTION_TYPE_KEYS, type ConnectionType } from "../shared/schema";
import { Glyph, IconSvg } from "../ui/icons";
import { cycleTheme, useStore } from "../ui/store";
import CursorTrail from "./CursorTrail";
import { MotionGallery } from "./Motion";

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

const WIN_VERSION = "0.2.0";
const WIN_DOWNLOAD = `https://github.com/joao2end/Archflow/releases/download/v${WIN_VERSION}/Archflow.Setup.${WIN_VERSION}.exe`;

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
          Diagramas que humanos e LLMs entendem — e um servidor MCP para o seu agente desenhar ao seu lado, em tempo real.
        </p>
        <div className="lp-cta lp-fade" style={style({ animationDelay: "1100ms" })}>
          <a className="btn primary lg shine" href="/app">
            Abrir o Archflow <Glyph name="arrow-up" size={17} style={{ transform: "rotate(45deg)" }} />
          </a>
          <a className="btn lg" href={WIN_DOWNLOAD} download>
            <Glyph name="download" size={17} /> Baixar para Windows
          </a>
          <a className="btn lg" href="#demo">
            Ver em ação
          </a>
        </div>
        <p className="lp-dl-note lp-fade" style={style({ animationDelay: "1200ms" })}>
          Instalador v{WIN_VERSION} · Windows 10/11 (x64) · já inclui o servidor MCP
        </p>
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
              <Count to={24} />
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
        <p className="lp-sub">Outros quadros guardam retângulos e coordenadas. O Archflow guarda o que cada caixa é, quem fala com quem e por qual protocolo.</p>
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
        <p className="lp-sub">Cada chamada MCP aparece no quadro na hora — e Ctrl+Z desfaz.</p>
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

/* ───────── ferramentas em movimento ───────── */

function Tools() {
  return (
    <section id="ferramentas" className="lp-section">
      <Reveal>
        <span className="lp-eyebrow">Ferramentas</span>
        <h2>
          Da infraestrutura às <i>regras de negócio</i>.
        </h2>
      </Reveal>
      <Reveal delay={120}>
        <MotionGallery />
      </Reveal>
    </section>
  );
}

/* ───────── recursos com spotlight ───────── */

const FEATURES: { icon: string; title: string; text: string }[] = [
  { icon: "library", title: "Catálogo com contexto", text: "Nuvens, bancos, filas e modelos de IA — cada item explica o problema que resolve." },
  { icon: "connect", title: "Conexões tipadas", text: "Síncrona, assíncrona, streaming e UML, com contrato em cada seta." },
  { icon: "plug", title: "Feito para agentes", text: "Clientes MCP leem e editam o diagrama ao vivo. Você ajusta ou desfaz." },
  { icon: "layers", title: "Modos Domain e Logic", text: "Modele DDD com validação e regras de negócio que o app executa." },
  { icon: "sparkle", title: "Visão LLM e código", text: "Markdown, Mermaid ou JSON para o chat, e esqueleto TypeScript do domínio." },
  { icon: "vault", title: "Cofre local", text: "Seus diagramas numa pasta sua, versionável no Git. Sem nuvem obrigatória." },
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
  { feat: "Conexões tipadas (síncrona, assíncrona, streaming, UML)", ex: "no", exNote: "setas com estilo visual", af: "yes", afNote: "10 tipos com semântica definida" },
  { feat: "Agente de IA edita ao vivo em nível semântico (MCP)", ex: "part", exNote: "servidores de terceiros, em nível de formas", af: "yes", afNote: "MCP nativo, sem coordenadas" },
  { feat: "Modelagem DDD com validação", ex: "no", exNote: "só formas e texto", af: "yes", afNote: "13 papéis, regras D001–D032" },
  { feat: "Regras de negócio executáveis, com exemplos", ex: "no", exNote: "caixas e texto, sem execução", af: "yes", afNote: "modo Logic, regras L001–L024" },
  { feat: "Código TypeScript gerado a partir do modelo", ex: "no", exNote: "", af: "yes", afNote: "aggregates, eventos, handlers" },
  { feat: "Desenho livre e estilo “à mão”", ex: "yes", exNote: "referência no assunto", af: "no", afNote: "foco em precisão" },
  { feat: "Colaboração multiusuário em tempo real", ex: "yes", exNote: "com criptografia ponta a ponta", af: "part", afNote: "humano + agentes (multiusuário no roadmap)" },
];

function Guide() {
  return (
    <section id="guia" className="lp-section">
      <Reveal>
        <span className="lp-eyebrow">Archflow × Excalidraw</span>
        <h2>
          O Excalidraw esboça. O Archflow <i>projeta</i>.
        </h2>
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
        <p className="lp-foot">Comparação com os recursos nativos do Excalidraw de código aberto; extensões de terceiros podem cobrir parte das lacunas.</p>
      </Reveal>
    </section>
  );
}

/* ───────── página ───────── */

function Nav({ theme }: { theme: string }) {
  const [menu, setMenu] = useState(false); // links de seção no celular (no desktop ficam sempre visíveis)
  useEffect(() => {
    if (!menu) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setMenu(false);
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [menu]);
  return (
    <header className={`lp-nav glass${menu ? " menu-open" : ""}`}>
      <a className="brand" href="/" aria-label="Archflow">
        <span className="brand-mark">
          <Glyph name="connect" size={15} stroke={2.4} />
        </span>
        Arch<i>flow</i>
      </a>
      <nav id="lp-links" className="lp-links" aria-label="Seções" onClick={(e) => (e.target as HTMLElement).closest("a") && setMenu(false)}>
        <a href="#o-que-e">O que é</a>
        <a href="#demo">Em ação</a>
        <a href="#ferramentas">Ferramentas</a>
        <a href="#recursos">Recursos</a>
        <a href="#guia">Comparação</a>
      </nav>
      <button className="btn ghost icon" onClick={cycleTheme} aria-label={`Tema: ${theme}`} data-tip="Alternar tema" data-tip-pos="bottom">
        <Glyph name={{ system: "monitor", light: "sun", dark: "moon" }[theme as "system"]} size={18} />
      </button>
      <a className="btn shine lp-nav-dl" href={WIN_DOWNLOAD} download data-tip="Baixar para Windows" data-tip-pos="bottom">
        <Glyph name="download" size={16} /> <span>Windows</span>
      </a>
      <a className="btn primary shine" href="/app">
        Abrir o app
      </a>
      <button className="btn ghost icon lp-menu-btn" onClick={() => setMenu((m) => !m)} aria-label={menu ? "Fechar o menu" : "Abrir o menu de seções"} aria-expanded={menu} aria-controls="lp-links">
        <Glyph name={menu ? "close" : "menu"} size={18} />
      </button>
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
        <Tools />
        <Features />
        <Guide />

        <Reveal className="lp-final-wrap">
          <section className="lp-final">
            <h2>
              Pronto para desenhar <i>junto</i>?
            </h2>
            <p>Abra o app, crie um cofre e comece com o exemplo ou com uma tela em branco.</p>
            <div className="lp-cta lp-cta-center">
              <a className="btn primary lg shine" href="/app">
                Abrir o Archflow
              </a>
              <a className="btn lg" href={WIN_DOWNLOAD} download>
                <Glyph name="download" size={17} /> Baixar para Windows
              </a>
            </div>
          </section>
        </Reveal>
      </main>

      <footer className="lp-footer">© 2026 2-end Software Development</footer>
    </div>
    <CursorTrail />
    </>
  );
}
