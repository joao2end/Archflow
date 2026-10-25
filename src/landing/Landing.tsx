import { Fragment, useEffect, useRef, useState, type CSSProperties } from "react";
import { BUILTIN_ASSETS } from "../shared/catalog";
import { Glyph } from "../ui/icons";
import { cycleTheme, useStore } from "../ui/store";
import CursorTrail from "./CursorTrail";

const reduced = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
const style = (v: Record<string, string | number>) => v as CSSProperties;

const WIN_VERSION = "0.3.0";
const WIN_DOWNLOAD = `https://github.com/joao2end/Archflow/releases/download/v${WIN_VERSION}/Archflow.Setup.${WIN_VERSION}.exe`;
const RELEASE_PAGE = `https://github.com/joao2end/Archflow/releases/tag/v${WIN_VERSION}`;
const TECHS = Math.floor(BUILTIN_ASSETS.length / 10) * 10;
const MCP_CMD = `claude mcp add --scope user archflow -- "C:\\Program Files\\Archflow\\Archflow.exe" --mcp`;

/* ───────── vídeo: toca só quando está na tela ───────── */

/** Gravações reais do app (public/landing, geradas por docs/promo/record-landing.mjs). Sem som, em loop; com "reduzir movimento" fica parado no pôster e ganha controles. */
function Clip({ name, label }: { name: string; label: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [still] = useState(reduced);
  useEffect(() => {
    const v = ref.current;
    if (!v || still || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => (e.isIntersecting ? v.play().catch(() => {}) : v.pause()), { threshold: 0.35 });
    io.observe(v);
    return () => io.disconnect();
  }, [still]);
  return (
    <div className="lp-clip glass">
      <div className="lp-clip-bar" aria-hidden>
        <i />
        <i />
        <i />
        <span>{label}</span>
      </div>
      <video ref={ref} muted loop playsInline preload="metadata" poster={`/landing/${name}.jpg`} controls={still} aria-label={label} width={1280} height={800}>
        <source src={`/landing/${name}.webm`} type="video/webm" />
        <source src={`/landing/${name}.mp4`} type="video/mp4" />
      </video>
    </div>
  );
}

/* ───────── hero ───────── */

const HEADLINE: { t: string; em?: boolean }[] = [{ t: "Desenhe" }, { t: "a" }, { t: "arquitetura" }, { t: "junto", em: true }, { t: "com" }, { t: "a" }, { t: "sua" }, { t: "IA." }];

function Hero() {
  return (
    <section className="lp-hero">
      <span className="lp-eyebrow lp-fade" style={style({ animationDelay: "100ms" })}>
        Quadro branco para software · com MCP
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
      <p className="lp-lead lp-fade" style={style({ animationDelay: "800ms" })}>
        Você pede, o agente desenha no quadro pelo MCP e você vê cada passo. Arquitetura, domínio, regras de negócio e times de agentes no mesmo lugar.
      </p>
      <div className="lp-cta lp-cta-center lp-fade" style={style({ animationDelay: "950ms" })}>
        <a className="btn primary lg shine" href="/app">
          Abrir no navegador <Glyph name="arrow-up" size={17} style={{ transform: "rotate(45deg)" }} />
        </a>
        <a className="btn lg" href={WIN_DOWNLOAD} download>
          <Glyph name="download" size={17} /> Baixar para Windows
        </a>
      </div>
      <p className="lp-dl-note lp-fade" style={style({ animationDelay: "1050ms" })}>
        v{WIN_VERSION} · grátis · o instalador já traz o servidor MCP · <a href={RELEASE_PAGE}>macOS e Linux</a>
      </p>
      <div className="lp-hero-video lp-fade" style={style({ animationDelay: "1150ms" })}>
        <Clip name="mcp" label="O agente desenha o checkout pelo MCP, ao vivo" />
      </div>
    </section>
  );
}

/* ───────── recursos, um vídeo cada ───────── */

const FEATURES: { id: string; video: string; icon: string; tag: string; title: string; text: string; points: string[] }[] = [
  {
    id: "arquitetura",
    video: "library",
    icon: "mode-architecture",
    tag: "Arquitetura",
    title: "Monte à mão, com significado",
    text: "Cada caixa sabe o que é e cada seta diz como os sistemas conversam.",
    points: [`${TECHS}+ tecnologias na biblioteca, cada uma com o problema que resolve`, "Conexões síncrona, assíncrona, streaming, dados e UML", "Endpoints, contratos e referências entre diagramas"],
  },
  {
    id: "domain",
    video: "domain",
    icon: "mode-domain",
    tag: "Domain · DDD",
    title: "O domínio em camadas, também em 3D",
    text: "Aggregates, commands e eventos nos anéis da Clean Architecture. Um clique e a mesma visão vira 3D.",
    points: ["Validação DDD que aponta o que falta (D001–D036)", "Regra de dependência entre camadas e portas", "Gera o esqueleto em TypeScript por contexto"],
  },
  {
    id: "logic",
    video: "logic",
    icon: "mode-logic",
    tag: "Logic",
    title: "Regras de negócio que rodam",
    text: "O fluxo é executável: cada cenário roda com dados reais e mostra o valor mudando a cada passo.",
    points: ["Exemplos que só ficam ✔ quando o resultado bate", "Modos Explicar e Depurar na reprodução", "Etapas, tabelas de decisão e exportação em PDF"],
  },
  {
    id: "agents",
    video: "agents",
    icon: "mode-agents",
    tag: "Agents",
    title: "Desenhe o time de agentes e exporte o harness",
    text: "Subagentes, skills, tools e workflows viram os arquivos que o Claude Code e o Cursor leem.",
    points: ["Grava .claude/ ou .cursor/ direto na pasta do projeto", "Workflows rodam no terminal do Claude Code dentro do app", "Catálogo de skills e servidores MCP"],
  },
  {
    id: "apresentar",
    video: "present",
    icon: "present",
    tag: "Apresentação",
    title: "Apresente a arquitetura passo a passo",
    text: "A tecla P monta os slides a partir do diagrama: cada passo acende o que importa e conta a história ao lado.",
    points: ["Roteiro automático ou definido pelo agente", "Grave a tela com a sua voz", "Exporte em SVG, PNG ou JSON"],
  },
];

function Features() {
  return (
    <section id="recursos" className="lp-section">
      <span className="lp-eyebrow">Recursos</span>
      <h2>
        Quatro modos, <i>um</i> quadro.
      </h2>
      <div className="lp-feats">
        {FEATURES.map((f, i) => (
          <article key={f.id} id={f.id} className={`lp-feat${i % 2 ? " flip" : ""}`}>
            <div className="lp-feat-copy">
              <span className="lp-tag">
                <Glyph name={f.icon} size={15} /> {f.tag}
              </span>
              <h3>{f.title}</h3>
              <p>{f.text}</p>
              <ul>
                {f.points.map((p) => (
                  <li key={p}>
                    <Glyph name="check" size={15} /> {p}
                  </li>
                ))}
              </ul>
            </div>
            <Clip name={f.video} label={`${f.tag}: ${f.title}`} />
          </article>
        ))}
      </div>
    </section>
  );
}

/* ───────── MCP ───────── */

function Connect() {
  const [copied, setCopied] = useState(false);
  const copy = () =>
    navigator.clipboard?.writeText(MCP_CMD).then(
      () => (setCopied(true), setTimeout(() => setCopied(false), 1600)),
      () => {},
    );
  return (
    <section id="mcp" className="lp-section lp-connect">
      <div>
        <span className="lp-eyebrow">MCP</span>
        <h2>
          Conecte o seu agente em <i>um</i> comando.
        </h2>
        <p className="lp-sub">Funciona com Claude Code, Claude Desktop, Cursor e Windsurf. No app, o botão MCP instala e testa a conexão para você.</p>
      </div>
      <div className="lp-cmd glass">
        <code>{MCP_CMD}</code>
        <button className="btn" onClick={copy} aria-live="polite">
          <Glyph name={copied ? "check" : "copy"} size={16} /> {copied ? "Copiado" : "Copiar"}
        </button>
      </div>
      <ul className="lp-facts" aria-label="Números">
        <li>
          <b>27</b> ferramentas MCP
        </li>
        <li>
          <b>{TECHS}+</b> tecnologias
        </li>
        <li>
          <b>4</b> modos de diagrama
        </li>
        <li>
          <b>100%</b> local, em arquivos .json
        </li>
      </ul>
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
        <a href="#arquitetura">Arquitetura</a>
        <a href="#domain">Domain</a>
        <a href="#logic">Logic</a>
        <a href="#agents">Agents</a>
        <a href="#mcp">MCP</a>
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
    // âncoras descontam a barra fixa do topo
    const onClick = (e: MouseEvent) => {
      const id = (e.target as HTMLElement).closest<HTMLAnchorElement>('a[href^="#"]')?.getAttribute("href")?.slice(1);
      const dest = id ? el.querySelector<HTMLElement>(`#${CSS.escape(id)}`) : null;
      if (!dest) return;
      e.preventDefault();
      const nav = el.querySelector<HTMLElement>(".lp-nav")?.offsetHeight ?? 0;
      el.scrollTo({ top: dest.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop - nav - 24, behavior: reduced() ? "auto" : "smooth" });
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    el.addEventListener("click", onClick);
    onScroll();
    return () => {
      el.removeEventListener("scroll", onScroll);
      el.removeEventListener("click", onClick);
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
          <Features />
          <Connect />

          <div className="lp-final-wrap">
            <section className="lp-final">
              <h2>
                Pronto para desenhar <i>junto</i>?
              </h2>
              <p>Abra no navegador, sem instalar nada, ou baixe o app com o MCP embutido.</p>
              <div className="lp-cta lp-cta-center">
                <a className="btn primary lg shine" href="/app">
                  Abrir o Archflow
                </a>
                <a className="btn lg" href={WIN_DOWNLOAD} download>
                  <Glyph name="download" size={17} /> Baixar para Windows
                </a>
              </div>
            </section>
          </div>
        </main>

        <footer className="lp-footer">
          © 2026 2-end Software Development
        </footer>
      </div>
      <CursorTrail />
    </>
  );
}
