/**
 * Visão 3D do modo architecture: os componentes como objetos 3D (modelos do Blender, com o logo do asset) organizados
 * como numa placa de circuito, com as conexões em trilhas pelos canais entre eles (arch3dscene.ts).
 *
 * Mesma interação da visão das camadas (iso.tsx):
 * - Câmera estilo Blender: botão do meio orbita; Shift + meio move; Ctrl + meio ou roda = zoom no cursor; Q/E giram 15°.
 * - Painel lateral: busca, paleta de componentes (arrastar para uma zona ou para a placa; soltar sobre um componente cria
 *   e liga os dois; um endpoint solto sobre um componente passa a ser dele) e a legenda dos tipos de conexão.
 * - Arrastar um componente o leva para outra célula (o 2D acompanha; célula ocupada troca os dois de lugar); Shift +
 *   arrastar de um componente a outro cria a conexão; apontar acende as trilhas; selecionar isola os vizinhos (I: 1 ou
 *   2 passos); F centraliza; Esc fecha o que estiver aberto e, por fim, volta ao 2D.
 * - Apresentação: o passo do roteiro (tour.tsx) chega pelo store (spotlight) e a cena destaca, anima e enquadra.
 */
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { boardLayout, modelOf, moveOps } from "../shared/archboard";
import { ASSET_CATEGORIES, assetsForMode, searchAssets } from "../shared/catalog";
import { allAssets, fitGroup } from "../shared/ops";
import type { Asset, ConnectionType } from "../shared/schema";
import { partThumb } from "./archparts";
import { ArchScene, connStyle, type ArchPick } from "./arch3dscene";
import { reducedMotion, type IsoTheme } from "./iso3d";
import { ENTER_MS, LEAVE_MS, exitIso, readTheme, registerLeave, useIsoChrome, useTheme } from "./isoshell";
import { commit, getState, lookupAsset, run, select, set, toast, toastError, useStore } from "./store";

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

interface PaletteDrag {
  asset: Asset;
  x: number;
  y: number;
  sx: number;
  sy: number;
  target: ArchPick;
}

/** Onde o componente solto vai parar, para o fantasma e o destaque. */
function dropTarget(p: ArchPick, asset: Asset): ArchPick {
  if (asset.kind === "endpoint") return p.node ? { node: p.node } : {};
  return p.node ? { node: p.node } : p.zone ? { zone: p.zone } : p.board ? { board: true } : {};
}

export function ArchView() {
  const doc = useStore((s) => s.doc);
  const sel = useStore((s) => s.sel);
  const present = useStore((s) => s.present);
  const spotlight = useStore((s) => s.spotlight);
  const library = useStore((s) => s.library);
  const host = useRef<HTMLDivElement>(null);
  const scene = useRef<ArchScene | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const view = useRef<HTMLDivElement>(null);
  const side = useRef<HTMLElement>(null);
  const [query, setQuery] = useState("");
  const [catalogQuery, setCatalogQuery] = useState("");
  const [isolate, setIsolate] = useState(1);
  const [hiddenTypes, setHiddenTypes] = useState<string[]>([]);
  const [drag, setDrag] = useState<PaletteDrag | null>(null);
  const [armed, setArmed] = useState<Asset | null>(null);
  const armedRef = useRef<Asset | null>(null);
  armedRef.current = armed;
  const theme = useTheme();
  useIsoChrome(view);

  const selNode = doc.nodes.find((n) => sel.length === 1 && n.id === sel[0]);
  const matches = useMemo(() => {
    const q = norm(query.trim());
    if (!q) return null;
    return doc.nodes.filter((n) => [n.label, n.technology ?? "", lookupAsset(n.asset)?.name ?? ""].some((t) => norm(t).includes(q)));
  }, [doc.nodes, query]);
  const types = useMemo(() => {
    const count = new Map<ConnectionType, number>();
    const ids = new Set(doc.nodes.map((n) => n.id));
    for (const c of doc.connections) if (ids.has(c.from) && ids.has(c.to) && c.from !== c.to) count.set(c.type, (count.get(c.type) ?? 0) + 1);
    return [...count].map(([key, n]) => ({ key, n, ...connStyle(key) }));
  }, [doc.connections, doc.nodes, theme]);

  // paleta: a biblioteca inteira do modo (personalizados, biblioteca do usuário e catálogo), por categoria, na ordem do
  // 2D; a busca filtra tudo.
  const palette = useMemo(() => {
    const assets = assetsForMode([...doc.customAssets, ...library.filter((a) => !doc.customAssets.some((c) => c.id === a.id)), ...allAssets({ ...doc, customAssets: [] })], "architecture");
    const unique = [...new Map(assets.map((a) => [a.id, a])).values()];
    const q = catalogQuery.trim();
    const list = q ? searchAssets(unique, q) : unique;
    const cat = (a: Asset) => (a.builtin ? a.category : "Personalizados");
    const order = ["Personalizados", ...ASSET_CATEGORIES];
    const groups = new Map<string, Asset[]>();
    for (const a of list) groups.set(cat(a), [...(groups.get(cat(a)) ?? []), a]);
    return [...groups].sort(([a], [b]) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99)).map(([name, items]) => ({ name, items }));
  }, [catalogQuery, doc, library]);
  const paletteCount = palette.reduce((n, g) => n + g.items.length, 0);

  const [phase, setPhase] = useState<"enter" | "build" | "ready" | "leave">("enter");
  const [live, setLive] = useState<ArchScene | null>(null);
  useEffect(() => {
    registerLeave(() => {
      if (reducedMotion()) return set({ iso: false });
      setPhase("leave");
      setTimeout(() => set({ iso: false }), LEAVE_MS);
    });
    return () => registerLeave(null);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let s: ArchScene | null = null;
    const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
    void (async () => {
      await pause(reducedMotion() ? 0 : ENTER_MS);
      if (cancelled) return;
      setPhase((p) => (p === "leave" ? p : "build"));
      s = createScene();
      scene.current = s;
      try {
        await s.load();
      } catch {
        toastError("Não deu para carregar os objetos 3D");
        return exitIso();
      }
      if (cancelled) return;
      const st = getState();
      s.setTheme(readTheme());
      s.setDoc(st.doc, lookupAsset);
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
    new ArchScene(host.current!, {
      onNode: (id) => select([id]),
      onZone: (zone) => {
        select([]);
        const a = armedRef.current;
        if (!a) return;
        if (a.kind === "endpoint") return toast(`${a.name}: clique no componente que expõe o endpoint`);
        setArmed(null);
        drop(a, zone ? { zone } : { board: true });
      },
      onEmpty: () => select([]),
      onMoveNode: (id, col, row) => {
        const doc = getState().doc;
        const ops = moveOps(doc, boardLayout(doc), id, col, row);
        if (!ops.length) return;
        const r = run(ops);
        const bad = r.find((x) => !x.ok);
        if (bad) return toastError(bad.error ?? "Não deu para mover");
        select([id]);
      },
      onConnect: (from, to) => {
        const [r] = run([{ op: "add_connection", from, to }]);
        if (!r.ok) return toastError(r.error ?? "Não deu para ligar");
        toast("Conexão criada");
        select([from]);
      },
    });
  useEffect(() => live?.setDoc(doc, lookupAsset), [doc, live, library]);
  useEffect(() => live?.setSelection(sel), [sel, live]);
  useEffect(() => live?.setTheme(theme), [theme, live]);
  useEffect(() => live?.setFilter({ match: matches ? matches.map((n) => n.id) : null, isolate, hiddenTypes }), [matches, isolate, hiddenTypes, doc, live]);

  /** a cena se centra no espaço livre entre o painel lateral e o painel do passo a passo */
  const fitInsets = () => {
    const el = side.current;
    const left = el && el.offsetWidth && el.offsetWidth < window.innerWidth * 0.6 ? el.getBoundingClientRect().right : 0;
    const story = document.querySelector<HTMLElement>(".story-panel, .lesson-panel");
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
    const id = requestAnimationFrame(fitInsets);
    scene.current?.setSpotlight(spotlight);
    return () => cancelAnimationFrame(id);
  }, [spotlight, live]);

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
      if (getState().modal || getState().present) return;
      if (e.key === "Escape") {
        if (drag) setDrag(null);
        else if (armed) setArmed(null);
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
  }, [query, drag, selNode, armed]);

  /* ───────── arrastar da paleta ───────── */

  const startDrag = (e: ReactPointerEvent, asset: Asset) => {
    if (e.button !== 0) return;
    e.preventDefault();
    setHint(false);
    setDrag({ asset, x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, target: {} });
  };

  const dragging = !!drag;
  useEffect(() => {
    if (!dragging) return;
    // o último alvo fica num valor local: o pointerup pode chegar antes de o React aplicar o último pointermove
    let cur = drag!;
    let raf = 0;
    let last: PointerEvent | null = null;
    const update = (e: PointerEvent) => {
      const target = dropTarget(scene.current?.pick(e.clientX, e.clientY) ?? {}, cur.asset);
      scene.current?.setDropHint(target.node ?? target.zone ?? null);
      cur = { ...cur, x: e.clientX, y: e.clientY, target };
      setDrag(cur);
    };
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
      const t = cur.target;
      if (t.node || t.zone || t.board) drop(cur.asset, t);
      // soltou sem sair do lugar: foi um clique no cartão, que seleciona (ou desseleciona) o tipo
      else if (Math.hypot(e.clientX - cur.sx, e.clientY - cur.sy) < 5) setArmed((a) => (a?.id === cur.asset.id ? null : cur.asset));
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, [dragging]);

  /** Cria o componente no alvo: numa zona (grupo), na placa, ou junto de um componente (e liga os dois). */
  const drop = (asset: Asset, t: ArchPick) => {
    const doc = getState().doc;
    const on = t.node ? doc.nodes.find((n) => n.id === t.node) : undefined;
    // sobre um endpoint vale o componente dono dele
    const near = on?.owner ? doc.nodes.find((n) => n.id === on.owner) : on;
    if (asset.kind === "endpoint") {
      if (!near) return toast(`${asset.name}: solte sobre o componente que expõe o endpoint`);
      const [r] = run([{ op: "add_node", asset: asset.id, owner: near.id }]);
      if (!r.ok || !r.id) return toastError(r.error ?? "Não deu para adicionar");
      return set({ sel: [r.id] });
    }
    const parent = near ? near.parent : t.zone;
    const [r] = run([{ op: "add_node", asset: asset.id, ...(parent ? { parent } : {}) }]);
    if (!r.ok || !r.id) return toastError(r.error ?? "Não deu para adicionar");
    if (near) run([{ op: "add_connection", from: near.id, to: r.id }]);
    // como no 2D: o grupo cresce para caber o componente novo
    if (parent) {
      const next = structuredClone(getState().doc);
      fitGroup(next, parent);
      commit(next);
    }
    set({ sel: [r.id] });
  };

  const targetText = (t: ArchPick) => {
    if (t.node) {
      const n = doc.nodes.find((x) => x.id === t.node);
      return drag?.asset.kind === "endpoint" ? `em ${n?.label}` : `ligar a ${n?.label}`;
    }
    if (t.zone) return `em ${doc.groups.find((g) => g.id === t.zone)?.label}`;
    if (t.board) return "na placa";
    return drag?.asset.kind === "endpoint" ? "solte sobre um componente" : "solte na placa";
  };

  return (
    <div ref={view} className={`iso-view iso-${theme} iso-${phase}${drag ? " iso-dragging" : ""}${present ? " iso-presenting" : ""}`} data-ui aria-busy={phase !== "ready"}>
      {phase !== "ready" && phase !== "leave" && (
        <div className="iso-loading" role="status">
          <span className="iso-spinner" aria-hidden />
          Montando a placa 3D…
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
              const a = lookupAsset(n.asset);
              return (
                <button key={n.id} role="option" aria-selected={sel.includes(n.id)} className={sel.includes(n.id) ? "on" : ""} onClick={() => focusNode(n.id)}>
                  <i style={{ background: a?.color ?? "#706fd3" }} />
                  <span>{n.label}</span>
                  <small>{n.technology ?? a?.name ?? n.kind}</small>
                </button>
              );
            })}
          </div>
        )}

        <details open className="iso-sec">
          <summary>Componentes</summary>
          <p className="iso-tip">Toda a biblioteca, por categoria. Arraste para uma zona ou para a placa; solte sobre um componente para já ligar.</p>
          <input type="search" className="input arch3d-cat" placeholder="Buscar no catálogo…" aria-label="Buscar no catálogo de componentes" value={catalogQuery} onChange={(e) => setCatalogQuery(e.target.value)} onKeyDown={(e) => e.key === "Escape" && (setCatalogQuery(""), e.currentTarget.blur())} />
          {catalogQuery.trim() && <div className="iso-count" aria-live="polite">{paletteCount ? `${paletteCount} no catálogo` : `Nada no catálogo com «${catalogQuery.trim()}»`}</div>}
          {palette.map((g) => (
            // com busca, todas as categorias com resultado abrem; sem busca, só os genéricos (e os personalizados)
            <details key={`${g.name}|${catalogQuery.trim() ? "q" : ""}`} className="arch3d-cat-sec" open={!!catalogQuery.trim() || g.name === "Genéricos" || g.name === "Personalizados"}>
              <summary>
                <span>{g.name}</span>
                <small>{g.items.length}</small>
              </summary>
              <div className="iso-tiles">
                {g.items.map((a) => (
                  <button key={a.id} className={`iso-tile${armed?.id === a.id ? " on" : ""}`} style={{ ["--c" as string]: a.color }} onPointerDown={(e) => startDrag(e, a)} aria-pressed={armed?.id === a.id} aria-label={`${a.name}: arraste para a placa, ou clique e depois clique numa zona`} title={`${a.name} — ${a.problem}`}>
                    <PartImg asset={a} theme={theme} lazy />
                    <span>{a.name}</span>
                  </button>
                ))}
              </div>
            </details>
          ))}
        </details>

        {types.length > 0 && (
          <details open className="iso-sec">
            <summary>Conexões</summary>
            <p className="iso-tip">Shift + arraste de um componente a outro para ligar. Clique para mostrar ou esconder.</p>
            <div className="iso-legend">
              {types.map(({ key, n, label, color }) => {
                const off = hiddenTypes.includes(key);
                return (
                  <button key={key} aria-pressed={!off} className={off ? "off" : ""} onClick={() => setHiddenTypes((h) => (off ? h.filter((x) => x !== key) : [...h, key]))}>
                    <i style={{ background: color }} />
                    <span>{label}</span>
                    <small>{n}</small>
                  </button>
                );
              })}
            </div>
          </details>
        )}
      </aside>

      {selNode && !present && (
        <div className="iso-focus glass" role="toolbar" aria-label={`Foco em ${selNode.label}`}>
          <span className="iso-focus-name" style={{ ["--rc" as string]: lookupAsset(selNode.asset)?.color ?? "#706fd3" }}>
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
        <span><kbd>Arrastar</kbd> move</span>
        <span><kbd>Shift</kbd>+<kbd>arrastar</kbd> conecta</span>
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
          <PartImg asset={armed} theme={theme} />
          <span>
            {armed.kind === "endpoint" ? "Arraste " : "Clique numa zona ou na placa para adicionar "}
            <b>{armed.name}</b>
            {armed.kind === "endpoint" ? " até o componente que o expõe" : ""}
          </span>
          <button className="btn ghost sm" onClick={() => setArmed(null)}>
            Cancelar (Esc)
          </button>
        </div>
      )}
      {drag && (
        <div className={`iso-ghost${drag.target.node || drag.target.zone || drag.target.board ? " ok" : ""}`} style={{ left: drag.x, top: drag.y, ["--rc" as string]: drag.asset.color }} aria-hidden>
          <PartImg asset={drag.asset} theme={theme} />
          <b>{drag.asset.name}</b>
          <small>{targetText(drag.target)}</small>
        </div>
      )}
    </div>
  );
}

/**
 * Miniatura do objeto 3D do asset (o mesmo modelo, cor e logo da cena); enquanto renderiza, um espaço do mesmo tamanho.
 * `lazy`: só renderiza quando o cartão aparece (categoria aberta e rolada até ele): a biblioteca tem perto de 200 itens.
 */
function PartImg({ asset, theme, lazy }: { asset: Asset; theme: IsoTheme; lazy?: boolean }) {
  const [src, setSrc] = useState<string>();
  const [seen, setSeen] = useState(!lazy);
  const box = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (seen || !box.current) return;
    const io = new IntersectionObserver((es) => es.some((e) => e.isIntersecting) && setSeen(true), { rootMargin: "120px" });
    io.observe(box.current);
    return () => io.disconnect();
  }, [seen]);
  useEffect(() => {
    if (!seen) return;
    let on = true;
    void partThumb(modelOf(asset), { icon: asset.kind === "endpoint" ? undefined : asset.icon, color: asset.color, name: asset.name }, theme)
      .then((url) => on && setSrc(url))
      .catch(() => undefined);
    return () => {
      on = false;
    };
  }, [asset.id, asset.icon, asset.color, theme, seen]);
  return src ? <img className="iso-gear" src={src} alt="" draggable={false} /> : <span ref={box} className="iso-gear" aria-hidden />;
}
