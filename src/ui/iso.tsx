/**
 * Visão 3D do layout "camadas" (modo domain): monta a cena three.js (iso3d.ts) sobre o canvas e liga a interação ao app.
 *
 * - Câmera (estilo Blender): botão do meio orbita; Shift + meio move; Ctrl + meio ou roda = zoom no cursor; Q/E giram 15°.
 *   Sem botão do meio (touchpad), arrastar o fundo com o esquerdo orbita e o direito move.
 * - Montar o diagrama: arrastar um tipo da paleta e soltar numa camada cria o componente ali (o layout o leva ao anel
 *   certo daquele círculo); soltar sobre um componente cria e já liga os dois. Arrastar de um componente a outro cria a
 *   conexão (a relação de domínio é inferida). Clique numa camada abre o menu de adicionar daquela camada.
 * - Ler as conexões: apontar acende as conexões do componente; selecionar deixa na cena só ele e os vizinhos (1 ou 2
 *   passos), o resto some; a legenda mostra e esconde relações; a busca acende os achados e leva a câmera até eles.
 * - Esc fecha o que estiver aberto (menu, busca, seleção) e, por fim, volta ao 2D.
 * - Transições: ao entrar, uma cortina cobre o 2D com fade e um indicador; a cena é criada e montada em etapas, os
 *   shaders compilam em paralelo (sem travar) e só então ela aparece com fade e uma entrada de câmera. Ao sair (Esc ou o
 *   botão 3D), fade antes de voltar ao 2D. A visão é montada fora do Canvas (IsoGate): ligar e desligar não redesenha o 2D.
 */
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { domainIssues, layerViolations, suggestRels } from "../shared/domain";
import { ONION_RINGS, onionPicks, onionSlot, orbitLook, orbits, type OnionPick } from "../shared/onion";
import type { GroupEl, NodeEl } from "../shared/schema";
import { IsoScene, REL_STYLE, VIOLATION_STYLE, type IsoTheme } from "./iso3d";
import { RingAddMenu } from "./ringmenu";
import { gearThumb } from "./isothumbs";
import { docMode } from "../shared/schema";
import { getState, run, select, set, toast, toastError, useStore } from "./store";

/** duração das transições de entrada e saída (ms) */
const ENTER_MS = 220;
const LEAVE_MS = 200;
const reducedMotion = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Monta a visão 3D quando ela está ligada e o diagrama tem o layout "camadas" (fica fora do Canvas: não o redesenha). */
export function IsoGate() {
  const on = useStore((s) => s.iso && docMode(s.doc) === "domain" && s.doc.groups.some((g) => g.ring));
  return on ? <IsoView /> : null;
}

let leave: (() => void) | null = null;
/** Volta ao 2D com a transição de saída (sem a visão montada, só desliga). */
export function exitIso() {
  if (leave) leave();
  else set({ iso: false });
}

/** Paleta: os tipos de cada camada, de dentro para fora (os mesmos do menu de clique). */
const PALETTE = (
  [
    ["entities", undefined],
    ["usecases", undefined],
    ["adapters", "top"],
    ["adapters", "left"],
    ["adapters", "right"],
    ["drivers", "top"],
    ["drivers", "left"],
    ["drivers", "right"],
    ["drivers", "bottom"],
  ] as const
).reduce<{ ring: keyof typeof ONION_RINGS; picks: OnionPick[] }[]>((acc, [ring, side]) => {
  const sec = acc.find((s) => s.ring === ring) ?? (acc.push({ ring, picks: [] }), acc[acc.length - 1]);
  sec.picks.push(...onionPicks(ring, side));
  return acc;
}, []);

/** Componente provisório só para perguntar em que anel um tipo da paleta mora. */
const probe = (p: OnionPick) => ({ kind: p.node.kind ?? "domain", ddd: p.node.ddd }) as NodeEl;
const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

interface PaletteDrag {
  pick: OnionPick;
  color: string;
  x: number;
  y: number;
  /** onde o arraste começou: soltar sem sair do lugar é um clique (seleciona o tipo) */
  sx: number;
  sy: number;
  /** camada que recebe o componente e, se soltar sobre um, o componente a ligar */
  tier?: string;
  node?: string;
  at?: { x: number; y: number };
}

export function IsoView() {
  const doc = useStore((s) => s.doc);
  const sel = useStore((s) => s.sel);
  /** apresentação: a interface de edição sai e o passo atual do passo a passo é destacado e animado na cena */
  const present = useStore((s) => s.present);
  const spotlight = useStore((s) => s.spotlight);
  const host = useRef<HTMLDivElement>(null);
  const scene = useRef<IsoScene | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; id: string } | null>(null);
  const [query, setQuery] = useState("");
  /** alcance da seleção: vizinhos diretos (1) ou até 2 passos */
  const [isolate, setIsolate] = useState(1);
  const [hiddenRels, setHiddenRels] = useState<string[]>([]);
  const [drag, setDrag] = useState<PaletteDrag | null>(null);
  /** tipo selecionado com um clique na paleta (sem arrastar): o próximo clique numa camada destacada o adiciona */
  const [armed, setArmed] = useState<OnionPick | null>(null);
  const armedRef = useRef<OnionPick | null>(null);
  armedRef.current = armed;
  const theme = useTheme();

  const nodes = useMemo(() => doc.nodes.filter(orbits), [doc.nodes]);
  const selNode = nodes.find((n) => sel.length === 1 && n.id === sel[0]);
  const matches = useMemo(() => {
    const q = norm(query.trim());
    if (!q) return null;
    return nodes.filter((n) => norm(n.label).includes(q) || norm(orbitLook(n).role).includes(q));
  }, [nodes, query]);
  /** conexões que ferem a regra de camadas (D034): vermelhas na cena, contadas na legenda */
  const violations = useMemo(() => layerViolations(doc).length, [doc]);
  const rels = useMemo(() => {
    const ids = new Set(nodes.map((n) => n.id));
    const count = new Map<string, number>();
    for (const c of doc.connections) if (ids.has(c.from) && ids.has(c.to)) count.set(c.ddd?.rel ?? "other", (count.get(c.ddd?.rel ?? "other") ?? 0) + 1);
    return Object.keys(REL_STYLE)
      .filter((k) => count.has(k))
      .map((k) => ({ key: k, n: count.get(k)! }));
  }, [doc.connections, nodes]);

  /**
   * Etapas da visão: "enter" (cortina com fade e indicador sobre o 2D) → "build" (cena criada e montada, shaders
   * compilando) → "ready" (cena aparece com fade e a câmera entra) → "leave" (fade e volta ao 2D).
   */
  const [phase, setPhase] = useState<"enter" | "build" | "ready" | "leave">("enter");
  /** a cena pronta: os efeitos que a alimentam (documento, seleção, filtros…) dependem dela para rodar de novo */
  const [live, setLive] = useState<IsoScene | null>(null);
  useEffect(() => {
    leave = () => {
      if (reducedMotion()) return set({ iso: false });
      setPhase("leave");
      setTimeout(() => set({ iso: false }), LEAVE_MS);
    };
    return () => {
      leave = null;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let s: IsoScene | null = null;
    const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
    void (async () => {
      // a cortina termina de cobrir o 2D antes do trabalho pesado (o indicador continua animando mesmo com a página ocupada)
      await pause(reducedMotion() ? 0 : ENTER_MS);
      if (cancelled) return;
      // saindo (Esc durante a montagem): as etapas não voltam atrás
      setPhase((p) => (p === "leave" ? p : "build"));
      s = createScene();
      scene.current = s;
      await pause(0); // devolve o controle entre criar o renderer e montar a cena
      if (cancelled) return;
      const st = getState();
      s.setTheme(readTheme());
      s.setDoc(st.doc);
      s.setSelection(st.sel);
      await s.warmup();
      if (cancelled) return;
      setLive(s);
      s.intro();
      setPhase((p) => (p === "leave" ? p : "ready"));
    })();
    return () => {
      cancelled = true;
      s?.dispose();
      scene.current = null;
    };
  }, []);

  const createScene = () =>
    new IsoScene(host.current!, {
      onNode: (id) => select([id]),
      onTier: (id, x, y) => {
        select([]);
        // tipo selecionado na paleta: o clique numa camada que o aceita adiciona ali
        const armed = armedRef.current;
        if (!armed) return setMenu({ x, y, id });
        if (!allowedTiers(armed).includes(id)) return toast(`${armed.label} não entra nesta camada: use uma das camadas destacadas`);
        setArmed(null);
        drop({ pick: armed, color: "", x, y, sx: x, sy: y, tier: id, at: scene.current?.pick(x, y).at });
      },
      onEmpty: () => select([]),
      onConnect: (from, to) => {
        const [r] = run([{ op: "add_connection", from, to }]);
        if (!r.ok) return toastError(r.error ?? "Não deu para ligar");
        const doc = getState().doc;
        const c = doc.connections.find((x) => x.id === r.id);
        // a regra de camadas não bloqueia (o diagrama pode estar documentando um problema), mas avisa na hora
        const broken = domainIssues(doc).find((i) => i.rule === "D034" && i.target === r.id);
        if (broken) toastError(`Conexão criada, mas fere a regra de camadas: uma camada interna não pode depender de uma externa`);
        else toast(`Conexão criada: ${REL_STYLE[c?.ddd?.rel ?? "other"]?.label ?? "ligação"}`);
        select([from]);
      },
    });
  useEffect(() => live?.setDoc(doc), [doc, live]);
  useEffect(() => live?.setSelection(sel), [sel, live]);
  useEffect(() => live?.setTheme(theme), [theme, live]);
  useEffect(() => live?.setFilter({ match: matches ? matches.map((n) => n.id) : null, isolate, hiddenRels }), [matches, isolate, hiddenRels, doc, live]);
  // no 3D, o cromo do 2D (ferramentas de desenho, paleta, barra lateral, minimapa, zoom do 2D) sai de cena
  useEffect(() => {
    document.documentElement.classList.add("iso-mode");
    return () => document.documentElement.classList.remove("iso-mode");
  }, []);
  // o painel lateral começa abaixo da barra de cima, que quebra em duas linhas em telas estreitas
  const view = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const bar = document.querySelector<HTMLElement>(".topbar");
    if (!bar) return;
    // a segunda linha da barra pode transbordar da caixa dela: vale o que estiver mais embaixo
    // (menus e balões soltos, posicionados por cima, não contam)
    const inFlow = (e: HTMLElement) => !!e.offsetParent && !/absolute|fixed/.test(getComputedStyle(e).position);
    const bottom = () => Math.max(bar.getBoundingClientRect().bottom, ...[...bar.querySelectorAll<HTMLElement>("*")].filter(inFlow).map((e) => e.getBoundingClientRect().bottom));
    const fit = () => view.current?.style.setProperty("--iso-top", `${Math.round(bottom()) + 12}px`);
    window.addEventListener("resize", fit);
    const ro = new ResizeObserver(fit);
    ro.observe(bar);
    fit();
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", fit);
    };
  }, []);
  const side = useRef<HTMLElement>(null);
  /** a cena se centra no espaço livre entre o painel lateral (edição) e o painel do passo a passo (apresentação) */
  const fitInsets = () => {
    const el = side.current;
    // em tela estreita o painel fica por cima, na largura toda: aí não desloca a cena
    const left = el && el.offsetWidth && el.offsetWidth < window.innerWidth * 0.6 ? el.getBoundingClientRect().right : 0;
    const story = document.querySelector<HTMLElement>(".story-panel");
    const right = story && story.offsetWidth < window.innerWidth * 0.6 ? window.innerWidth - story.getBoundingClientRect().left : 0;
    scene.current?.setInset(left, right);
  };
  useEffect(() => {
    const el = side.current;
    if (!el) return;
    const ro = new ResizeObserver(fitInsets);
    ro.observe(el);
    fitInsets();
    return () => ro.disconnect();
  }, [live]);
  useEffect(() => {
    // o painel do passo a passo entra depois desta renderização
    const id = requestAnimationFrame(fitInsets);
    scene.current?.setSpotlight(present ? spotlight : null);
    return () => cancelAnimationFrame(id);
  }, [present, spotlight, live]);
  // a dica de controles some depois do primeiro gesto (ou de alguns segundos) e volta com "?"
  const [hint, setHint] = useState(true);
  useEffect(() => {
    if (!hint) return;
    const t = setTimeout(() => setHint(false), 9000);
    return () => clearTimeout(t);
  }, [hint]);

  const focusNode = (id: string) => {
    select([id]);
    scene.current?.flyTo(id);
  };

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest("input, textarea, select, [contenteditable]")) return;
      if (getState().modal || getState().present) return; // na apresentação as teclas são dela (passos, ferramentas, Esc)
      if (e.key === "Escape") {
        if (drag) setDrag(null);
        else if (armed) setArmed(null);
        else if (menu) setMenu(null);
        else if (query) setQuery("");
        else if (getState().sel.length) select([]);
        else exitIso();
      }
      if (e.ctrlKey || e.metaKey || e.altKey) {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") (e.preventDefault(), searchRef.current?.focus());
        return;
      }
      if (e.key === "/") (e.preventDefault(), searchRef.current?.focus());
      if (e.key === "?") setHint((h) => !h);
      if (e.key === "q" || e.key === "Q") scene.current?.orbit(15);
      if (e.key === "e" || e.key === "E") scene.current?.orbit(-15);
      if ((e.key === "i" || e.key === "I") && selNode) setIsolate((v) => (v === 1 ? 2 : 1));
      if ((e.key === "f" || e.key === "F") && selNode) scene.current?.flyTo(selNode.id);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [menu, query, isolate, drag, selNode, armed]);
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [menu]);

  /* ───────── arrastar da paleta ───────── */

  /** Camada do mesmo círculo em que o tipo arrastado mora (soltar em Entities um repository vai para Gateways dali). */
  const tierFor = (groupId: string, p: OnionPick): string | undefined => {
    const groups = getState().doc.groups;
    const g = groups.find((x) => x.id === groupId);
    if (!g?.ring) return undefined;
    const slot = onionSlot(probe(p));
    const center = (x: GroupEl) => [x.x + x.w / 2, x.y + x.h / 2];
    const [cx, cy] = center(g);
    const home = groups.find((x) => {
      const [hx, hy] = center(x);
      return x.ring && !x.ring.frame && Math.abs(hx - cx) < 1 && Math.abs(hy - cy) < 1 && x.ring.layer === slot.ring && (!x.ring.side || x.ring.side === slot.side);
    });
    return home?.id ?? g.id;
  };

  const startDrag = (e: ReactPointerEvent, pick: OnionPick, color: string) => {
    if (e.button !== 0) return;
    e.preventDefault();
    setHint(false);
    setDrag({ pick, color, x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY });
  };

  /** Camadas que aceitam o tipo (pelo papel: anel e, nos anéis com setores, o lado), em todos os círculos. */
  const allowedTiers = (p: OnionPick) => {
    const slot = onionSlot(probe(p));
    return getState()
      .doc.groups.filter((g) => g.ring && !g.ring.frame && g.ring.layer === slot.ring && (!g.ring.side || g.ring.side === slot.side))
      .map((g) => g.id);
  };
  // arrastando ou com um tipo selecionado: as camadas que não o aceitam ficam translúcidas
  const active = drag?.pick ?? armed;
  useEffect(() => live?.setLayerFocus(active ? allowedTiers(active) : null), [active, live, doc]);

  const dragging = !!drag;
  useEffect(() => {
    if (!dragging) return;
    // o último alvo fica num valor local: o pointerup pode chegar antes de o React aplicar o último pointermove
    let cur = drag!;
    let raf = 0;
    let last: PointerEvent | null = null;
    const update = (e: PointerEvent) => {
      const h = scene.current?.pick(e.clientX, e.clientY) ?? {};
      const parent = h.node ? getState().doc.nodes.find((n) => n.id === h.node)?.parent : undefined;
      // sobre uma camada: só se ela aceita o tipo; sobre um componente: a camada certa daquele círculo (e liga os dois)
      const tier = h.tier ? (allowedTiers(cur.pick).includes(h.tier) ? h.tier : undefined) : parent ? tierFor(parent, cur.pick) : undefined;
      scene.current?.setDropHint(tier ?? null);
      cur = { ...cur, x: e.clientX, y: e.clientY, tier, node: h.node, at: h.at };
      setDrag(cur);
    };
    // no máximo um teste de alvo por quadro (o ponteiro dispara bem mais eventos que isso)
    const move = (e: PointerEvent) => {
      last = e;
      if (!raf)
        raf = requestAnimationFrame(() => {
          raf = 0;
          if (last) update(last);
        });
    };
    const up = (e: PointerEvent) => {
      cancelAnimationFrame(raf);
      update(e);
      scene.current?.setDropHint(null);
      setDrag(null);
      if (cur.tier) drop(cur);
      // soltou sem sair do lugar: foi um clique no cartão, que seleciona (ou desseleciona) o tipo
      else if (Math.hypot(e.clientX - cur.sx, e.clientY - cur.sy) < 5) setArmed((a) => (a?.label === cur.pick.label ? null : cur.pick));
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, [dragging]);

  const drop = (d: PaletteDrag) => {
    const [r] = run([{ op: "add_node", ...d.pick.node, parent: d.tier, ...(d.at ? { x: Math.round(d.at.x), y: Math.round(d.at.y) } : {}) }, { op: "layout", style: "onion" }]);
    if (!r.ok || !r.id) return toastError(r.error ?? "Não deu para adicionar");
    if (d.node) {
      // soltou sobre um componente: liga os dois no sentido que a relação de domínio aceita
      const doc = getState().doc;
      const [from, to] = suggestRels(doc, d.node, r.id).length ? [d.node, r.id] : suggestRels(doc, r.id, d.node).length ? [r.id, d.node] : [];
      if (from && to) run([{ op: "add_connection", from, to }]);
      else toast("Componente criado; estes dois tipos não têm relação de domínio para ligar");
    }
    set({ sel: [r.id], focusTick: getState().focusTick + 1 });
  };

  const tierLabel = drag?.tier ? doc.groups.find((g) => g.id === drag.tier)?.label : undefined;
  const nodeLabel = drag?.node ? doc.nodes.find((n) => n.id === drag.node)?.label : undefined;

  return (
    <div ref={view} className={`iso-view iso-${theme} iso-${phase}${drag ? " iso-dragging" : ""}${present ? " iso-presenting" : ""}`} data-ui aria-busy={phase !== "ready"}>
      {phase !== "ready" && phase !== "leave" && (
        <div className="iso-loading" role="status">
          <span className="iso-spinner" aria-hidden />
          Montando a cena 3D…
        </div>
      )}
      <div ref={host} className="iso3d-host" role="img" aria-label={`Visão 3D de ${doc.title}`} onPointerDown={() => setHint(false)} />

      <aside ref={side} className="iso-side glass" aria-label="Busca, componentes e conexões da visão 3D">
        <div className="iso-search">
          <input
            ref={searchRef}
            type="search"
            className="input"
            placeholder="Buscar componente…"
            aria-label="Buscar componente"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && matches?.[0]) focusNode(matches[0].id);
              if (e.key === "Escape") (setQuery(""), e.currentTarget.blur());
            }}
          />
          <kbd aria-hidden>/</kbd>
        </div>
        {matches && (
          <div className="iso-results" role="listbox" aria-label="Resultados da busca">
            <div className="iso-count" aria-live="polite">
              {matches.length ? `${matches.length} encontrado${matches.length > 1 ? "s" : ""}` : "Nada encontrado"}
            </div>
            {matches.slice(0, 8).map((n) => {
              const look = orbitLook(n);
              return (
                <button key={n.id} role="option" aria-selected={sel.includes(n.id)} className={sel.includes(n.id) ? "on" : ""} onClick={() => focusNode(n.id)}>
                  <i style={{ background: look.color }} />
                  <span>{n.label}</span>
                  <small>{look.role}</small>
                </button>
              );
            })}
          </div>
        )}

        <details open className="iso-sec">
          <summary>Componentes</summary>
          <p className="iso-tip">Arraste para uma camada. Solte sobre um componente para já ligar.</p>
          {PALETTE.map((sec) => (
            <div key={sec.ring} className="iso-pal" style={{ ["--c" as string]: ONION_RINGS[sec.ring].color }}>
              <div className="iso-pal-title">{ONION_RINGS[sec.ring].label}</div>
              <div className="iso-tiles">
                {sec.picks.map((p) => (
                  <PaletteTile key={p.label} pick={p} theme={theme} armed={armed?.label === p.label} onDrag={(e) => startDrag(e, p, ONION_RINGS[onionSlot(probe(p)).ring].color)} />
                ))}
              </div>
            </div>
          ))}
        </details>

        {rels.length > 0 && (
          <details open className="iso-sec">
            <summary>Conexões</summary>
            <p className="iso-tip">Arraste de um componente a outro para ligar. Clique para mostrar ou esconder.</p>
            <div className="iso-legend">
              {rels.map(({ key, n }) => {
                const off = hiddenRels.includes(key);
                return (
                  <button key={key} aria-pressed={!off} className={off ? "off" : ""} onClick={() => setHiddenRels((h) => (off ? h.filter((x) => x !== key) : [...h, key]))}>
                    <i style={{ background: REL_STYLE[key].color }} />
                    <span>{REL_STYLE[key].label}</span>
                    <small>{n}</small>
                  </button>
                );
              })}
              {violations > 0 && (
                <div className="iso-legend-bad" role="note">
                  <i style={{ background: VIOLATION_STYLE.color }} />
                  <span>{VIOLATION_STYLE.label}</span>
                  <small>{violations}</small>
                </div>
              )}
            </div>
          </details>
        )}
      </aside>

      {selNode && !present && (
        <div className="iso-focus glass" role="toolbar" aria-label={`Foco em ${selNode.label}`}>
          <span className="iso-focus-name" style={{ ["--rc" as string]: orbitLook(selNode).color }}>
            {selNode.label}
          </span>
          <span className="iso-focus-sep" />
          <span className="iso-focus-lbl">Mostrar</span>
          {[1, 2].map((v) => (
            <button key={v} className={`btn ghost${isolate === v ? " active" : ""}`} aria-pressed={isolate === v} onClick={() => setIsolate(v)}>
              {v === 1 ? "Vizinhos" : "2 passos"}
            </button>
          ))}
          <button className="btn ghost" onClick={() => select([])} data-tip="Mostrar tudo (Esc)" data-tip-pos="top">
            Tudo
          </button>
          <span className="iso-focus-sep" />
          <button className="btn ghost" onClick={() => scene.current?.flyTo(selNode.id)} data-tip="Centralizar (F)" data-tip-pos="top">
            Centralizar
          </button>
        </div>
      )}

      <div className={`iso-hint glass${hint ? "" : " off"}`} role="note" aria-hidden={!hint}>
        <span><kbd>Botão do meio</kbd> orbitar</span>
        <span><kbd>Shift</kbd>+<kbd>meio</kbd> mover</span>
        <span><kbd>Ctrl</kbd>+<kbd>meio</kbd> zoom</span>
        <span><kbd>Componente → componente</kbd> conecta</span>
        <span><kbd>Roda</kbd> zoom</span>
        <span><kbd>Q</kbd><kbd>E</kbd> girar</span>
        <span><kbd>/</kbd> buscar</span>
        <span><kbd>I</kbd> 1 ou 2 passos</span>
        <span><kbd>Esc</kbd> 2D</span>
      </div>
      {!hint && !present && (
        <button className="iso-hint-btn glass" onClick={() => setHint(true)} aria-label="Mostrar os controles da visão 3D" data-tip="Controles (?)" data-tip-pos="left">
          ?
        </button>
      )}
      {armed && !drag && (
        <div className="iso-armed glass" role="status">
          <GearImg pick={armed} theme={theme} />
          <span>
            Clique numa camada destacada para adicionar <b>{armed.label}</b>
          </span>
          <button className="btn ghost sm" onClick={() => setArmed(null)}>
            Cancelar (Esc)
          </button>
        </div>
      )}
      {drag && (
        <div className={`iso-ghost${drag.tier ? " ok" : ""}`} style={{ left: drag.x, top: drag.y, ["--rc" as string]: drag.color }} aria-hidden>
          <GearImg pick={drag.pick} theme={theme} />
          <b>{drag.pick.label}</b>
          <small>{drag.tier ? (nodeLabel ? `em ${tierLabel} · ligar a ${nodeLabel}` : `em ${tierLabel}`) : "solte numa camada destacada"}</small>
        </div>
      )}
      {menu && <RingAddMenu x={menu.x} y={menu.y} groupId={menu.id} onClose={() => setMenu(null)} />}
    </div>
  );
}

/** Miniatura 3D do tipo (a mesma forma e cores da cena); enquanto renderiza, um espaço vazio do mesmo tamanho. */
function GearImg({ pick, theme }: { pick: OnionPick; theme: IsoTheme }) {
  const [src, setSrc] = useState<string>();
  useEffect(() => {
    let on = true;
    void gearThumb(probe(pick), theme).then((url) => on && setSrc(url));
    return () => {
      on = false;
    };
  }, [pick, theme]);
  return src ? <img className="iso-gear" src={src} alt="" draggable={false} /> : <span className="iso-gear" aria-hidden />;
}

/** Cartão da paleta: a miniatura do componente 3D e o nome; arrastar leva o tipo para a cena. */
function PaletteTile({ pick, theme, armed, onDrag }: { pick: OnionPick; theme: IsoTheme; armed: boolean; onDrag: (e: ReactPointerEvent) => void }) {
  const look = orbitLook(probe(pick));
  return (
    <button className={`iso-tile${armed ? " on" : ""}`} onPointerDown={onDrag} aria-pressed={armed} aria-label={`${pick.label}: arraste para uma camada, ou clique e depois clique numa camada destacada`} title={`${pick.label} — ${look.hint}`}>
      <GearImg pick={pick} theme={theme} />
      <span>{pick.label}</span>
    </button>
  );
}

/** Tema efetivo do app (o atributo data-theme da raiz, que já resolve "sistema"). */
const readTheme = (): IsoTheme => (document.documentElement.dataset.theme === "dark" ? "dark" : "light");

/** Tema efetivo do app, acompanhando as trocas. */
function useTheme(): IsoTheme {
  const [theme, setTheme] = useState<IsoTheme>(readTheme);
  useEffect(() => {
    const mo = new MutationObserver(() => setTheme(readTheme()));
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => mo.disconnect();
  }, []);
  return theme;
}
