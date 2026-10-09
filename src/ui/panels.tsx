import { ColorPicker } from "./colorpicker";
import { BG_PRESETS, PresetPattern } from "./bgpresets";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { searchAssets } from "../shared/catalog";
import { ASSET_CATEGORIES } from "../shared/catalog";
import { CONNECTION_TYPES, CONNECTION_TYPE_KEYS, GROUP_KINDS, NODE_KINDS, type ConnectionType, type GroupKind, type NodeKind, type Routing } from "../shared/schema";
import { exportJson, exportPng, exportSvg, importJson } from "./export";
import { Glyph, AssetBadge } from "./icons";
import { EndpointFields, EndpointsSection, RefPicker } from "./inspectorExtras";
import { enterPresent } from "./present";
import { INK_COLORS } from "./ink";
import { checklistLayout } from "./Canvas";
import { deleteSelection, duplicateSelection, fitView, layout } from "./keys";
import type { Asset } from "../shared/schema";
import { allKnownAssets, deleteAsset, getState, goBack, lookupAsset, placeAsset, toast, cycleTheme, redo, run, set, setPrefs, setTitle, undo, useStore, DEFAULT_BG, type BgPattern, type Tool } from "./store";

/* ───────── helpers ───────── */

function Tip({ tip, pos = "right", children }: { tip: string; pos?: "right" | "top" | "bottom" | "left"; children: ReactNode }) {
  return (
    <span data-tip={tip} data-tip-pos={pos} style={{ display: "contents" }}>
      {children}
    </span>
  );
}

export function ConnSample({ type }: { type: ConnectionType }) {
  const t = CONNECTION_TYPES[type];
  return (
    <svg className="conn-sample" viewBox="0 0 26 14" fill="none">
      {t.tail === "diamond" && <path d="M1 7l4-3 4 3-4 3z" fill={t.color} />}
      {t.tail === "diamond-open" && <path d="M1 7l4-3 4 3-4 3z" style={{ fill: "var(--s-solid)" }} stroke={t.color} strokeWidth="1.3" />}
      <path d={`M${t.tail !== "none" ? 9 : 1} 7H${t.head !== "none" ? 20 : 25}`} stroke={t.color} strokeWidth="2" strokeDasharray={t.dash ? "3 3" : undefined} strokeLinecap="round" />
      {t.head === "arrow" && <path d="M19 3l6 4-6 4z" fill={t.color} />}
      {t.head === "open" && <path d="M19 3l5.5 4-5.5 4" stroke={t.color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />}
      {t.head === "triangle" && <path d="M19 2.5l6 4.5-6 4.5z" style={{ fill: "var(--s-solid)" }} stroke={t.color} strokeWidth="1.5" strokeLinejoin="round" />}
    </svg>
  );
}

export function TextField({ value, onCommit, multiline, id, placeholder }: { value: string; onCommit: (v: string) => void; multiline?: boolean; id?: string; placeholder?: string }) {
  const [v, setV] = useState(value);
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setV(value);
  }, [value]);
  const common = {
    id,
    className: "input",
    value: v,
    placeholder,
    onFocus: () => (focused.current = true),
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setV(e.target.value),
    onBlur: () => {
      focused.current = false;
      if (v !== value) onCommit(v);
    },
  };
  return multiline ? (
    <textarea {...common} rows={3} />
  ) : (
    <input
      {...common}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
    />
  );
}

/* ───────── barra superior ───────── */

export function TopBar() {
  const title = useStore((s) => s.doc.title);
  const online = useStore((s) => s.online);
  const theme = useStore((s) => s.theme);
  const navBack = useStore((s) => s.navBack);
  const storage = useStore((s) => s.storage);
  const back = navBack.length ? navBack[navBack.length - 1].split("/").pop()?.replace(".archflow.json", "") : undefined;
  const ws = useStore((s) => s.workspace);
  const folderTip = online && ws ? `Arquivos (E)\nCofre: ${ws.vault.name}\n${ws.vault.path}` : "Arquivos do cofre (E)";
  const [menu, setMenu] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => !(e.target as Element).closest(".menu-wrap") && setMenu(false);
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [menu]);

  return (
    <div className="hud topbar">
      <div className="glass brand-pill">
        <a className="brand" href="/" data-tip="Sobre o Archflow (página inicial)" data-tip-pos="bottom" style={{ textDecoration: "none", color: "inherit" }}>
          <span className="brand-mark">
            <Glyph name="connect" size={15} stroke={2.4} />
          </span>
          Arch<i>flow</i>
        </a>
        <div className="sep" />
        {back && (
          <button className="btn ghost sm back-btn" onClick={() => void goBack()} data-tip={`Voltar para ${back}`} data-tip-pos="bottom">
            <Glyph name="arrow-up" size={15} style={{ transform: "rotate(-90deg)" }} /> Voltar
          </button>
        )}
        <TextField value={title} onCommit={setTitle} id="doc-title" />
        <button className="btn ghost icon" onClick={() => set({ panel: getState().panel === "files" ? null : "files" })} aria-label="Arquivos do cofre" data-tip={folderTip} data-tip-pos="bottom">
          <Glyph name="folder" size={19} />
        </button>
      </div>
      <div className="glass actions-pill">
        <span
          className={`status ${online ? (storage === "local" ? "local" : "on") : ""}`}
          data-tip={
            !online
              ? "Sem armazenamento. Rode `npm run dev` para usar cofres em disco."
              : storage === "local"
                ? "Salvando na memória deste navegador (sem servidor local). Exporte o cofre para fazer backup. Rode `npm run dev` para cofres em disco e MCP."
                : "Servidor local ativo: cofres em disco e agentes MCP editando este diagrama em tempo real."
          }
          data-tip-pos="bottom"
          role="button"
          tabIndex={0}
          onClick={() => set({ modal: { type: "vaults" } })}
          onKeyDown={(e) => e.key === "Enter" && set({ modal: { type: "vaults" } })}
        >
          <span className="dot" />
          {!online ? "Offline" : storage === "local" ? "Memória do navegador" : "MCP sincronizado"}
        </span>
        <div className="sep" />
        <button className="btn ghost" onClick={enterPresent} data-tip="Modo apresentação: caneta, marca-texto, laser e cronômetro (P)" data-tip-pos="bottom">
          <Glyph name="present" size={17} /> Apresentar
        </button>
        <button className="btn ghost" onClick={() => set({ modal: { type: "llm" } })} data-tip="Veja o diagrama como um LLM o enxerga (Markdown, Mermaid, JSON)." data-tip-pos="bottom">
          <Glyph name="sparkle" size={17} /> Visão LLM
        </button>
        <button className="btn ghost" onClick={() => set({ modal: { type: "mcp" } })} data-tip="Conectar Claude / agentes via MCP" data-tip-pos="bottom">
          <Glyph name="plug" size={17} /> MCP
        </button>
        <div className="menu-wrap">
          <button className="btn primary" onClick={() => setMenu((m) => !m)} aria-haspopup="menu" aria-expanded={menu}>
            <Glyph name="download" size={17} /> Arquivo
          </button>
          {menu && (
            <div className="glass menu" role="menu" style={{ background: "var(--glass-strong)" }}>
              <button onClick={() => (exportJson(), setMenu(false))}>
                <Glyph name="download" size={17} /> Salvar .archflow.json
              </button>
              <button onClick={() => fileRef.current?.click()}>
                <Glyph name="upload" size={17} /> Importar diagrama…
              </button>
              <button onClick={() => (exportSvg(), setMenu(false))}>
                <Glyph name="code" size={17} /> Exportar SVG
              </button>
              <button onClick={() => (exportPng(), setMenu(false))}>
                <Glyph name="grid" size={17} /> Exportar PNG (2×)
              </button>
            </div>
          )}
          <input
            ref={fileRef}
            type="file"
            accept=".json,application/json"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) importJson(f);
              e.target.value = "";
              setMenu(false);
            }}
          />
        </div>
        <button className="btn ghost icon" onClick={cycleTheme} aria-label={`Tema: ${theme}`} data-tip={`Tema: ${{ system: "automático", light: "claro", dark: "escuro" }[theme]} (T)\nClique para alternar`} data-tip-pos="bottom">
          <Glyph name={{ system: "monitor", light: "sun", dark: "moon" }[theme]} size={18} />
        </button>
        <button className="btn ghost icon" onClick={() => set({ modal: { type: "help" } })} aria-label="Ajuda e atalhos" data-tip="Atalhos (?)" data-tip-pos="bottom">
          <Glyph name="help" size={18} />
        </button>
      </div>
    </div>
  );
}

/* ───────── dock de ferramentas ───────── */

const TOOLS: { id: Tool; icon: string; label: string; key: string; tip: string }[] = [
  { id: "hand", icon: "hand", label: "Mover tela", key: "H", tip: "Arraste para navegar. Dica: segure Espaço em qualquer ferramenta." },
  { id: "group", icon: "group", label: "Grupo", key: "G", tip: "Desenhe uma fronteira (VPC, camada, bounded context). Componentes dentro entram no grupo." },
  { id: "connect", icon: "connect", label: "Conector", key: "C", tip: "Arraste de um componente a outro. O tipo vem da barra inferior." },
  { id: "note", icon: "note", label: "Nota", key: "N", tip: "Registre decisões, riscos e premissas." },
];

const BG_PATTERNS: { id: BgPattern; label: string }[] = [
  { id: "dots", label: "Pontos" },
  { id: "grid", label: "Grade" },
  { id: "lines", label: "Linhas" },
  { id: "none", label: "Liso" },
];
const BG_COLORS = ["#ffffff", "#f7f1e3", "#eef2f7", "#e8f3ec", "#fdf0f0", "#2d2a2e", "#14161c"];

/** reduz a imagem (máx. 1920px, JPEG) para caber no localStorage */
function fileToBackground(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, 1920 / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * k);
      c.height = Math.round(img.height * k);
      c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL("image/jpeg", 0.82));
    };
    img.onerror = () => (URL.revokeObjectURL(url), reject(new Error("imagem inválida")));
    img.src = url;
  });
}

function BackgroundPopover() {
  const bg = useStore((s) => s.bg);
  const imgRef = useRef<HTMLInputElement>(null);
  const open = useStore((s) => s.panel === "bg");
  const setOpen = (v: boolean | ((o: boolean) => boolean)) => {
    const next = typeof v === "function" ? v(getState().panel === "bg") : v;
    set({ panel: next ? "bg" : getState().panel === "bg" ? null : getState().panel });
  };
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => !(e.target as Element).closest(".bg-wrap, .cpick-pop") && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", esc);
    };
  }, [open]);
  const patch = (p: Partial<typeof bg>) => setPrefs({ bg: { ...bg, ...p } });
  return (
    <div className="bg-wrap">
      <button className={`tool ${open ? "active" : ""}`} onClick={() => setOpen((o) => !o)} data-tip="Fundo do quadro" data-tip-pos="right" aria-label="Fundo do quadro" aria-haspopup="dialog" aria-expanded={open}>
        <Glyph name="grid" size={19} />
      </button>
      {open && (
        <div className="glass bg-pop" role="dialog" aria-label="Fundo do quadro" style={{ background: "var(--glass-strong)" }}>
          <div className="field">
            <span>Padrão</span>
            <div className="bg-patterns" role="radiogroup" aria-label="Padrão do fundo">
              {BG_PATTERNS.map((p) => (
                <button key={p.id} role="radio" aria-checked={bg.pattern === p.id} className={`bg-pat ${bg.pattern === p.id ? "active" : ""}`} onClick={() => patch({ pattern: p.id })}>
                  <i className={`bg-prev ${p.id}`} />
                  {p.label}
                </button>
              ))}
            </div>
          </div>
          <div className="field">
            <span>Cor</span>
            <div className="swatches insp-swatches">
              <button className={`swatch auto ${!bg.color ? "active" : ""}`} aria-label="Cor padrão do tema" onClick={() => patch({ color: undefined })} data-tip="Padrão do tema" data-tip-pos="top" />
              <ColorPicker value={bg.color ?? "#f7f1e3"} swatchColor={bg.color && !BG_COLORS.includes(bg.color) ? bg.color : undefined} onChange={(c) => patch({ color: c })} />
              {BG_COLORS.map((c) => (
                <button key={c} className={`swatch ${bg.color === c ? "active" : ""}`} style={{ background: c }} aria-label={`Fundo ${c}`} onClick={() => patch({ color: c })} />
              ))}
            </div>
          </div>
          <div className="field">
            <span>Imagem</span>
            <div className="bg-patterns five" role="radiogroup" aria-label="Modelos de imagem">
              {BG_PRESETS.map((p) => (
                <button key={p.id} role="radio" aria-checked={bg.image === `preset:${p.id}`} className={`bg-pat ${bg.image === `preset:${p.id}` ? "active" : ""}`} onClick={() => patch({ image: `preset:${p.id}`, pattern: "none" })}>
                  <svg className="bg-prev" width="48" height="34" aria-hidden>
                    <defs>
                      <PresetPattern id={`pv-${p.id}`} preset={p} scale={0.2} />
                    </defs>
                    <rect width="100%" height="100%" fill={`url(#pv-${p.id})`} />
                  </svg>
                  {p.label}
                </button>
              ))}
            </div>
            <div className="bg-img-actions">
              <button className="btn ghost" onClick={() => imgRef.current?.click()}>
                <Glyph name="upload" size={16} /> Enviar imagem…
              </button>
              {bg.image && (
                <button className="btn ghost" onClick={() => patch({ image: undefined })}>
                  Remover
                </button>
              )}
            </div>
            {bg.image && (
              <label className="field">
                <span>Transparência da imagem · {Math.round((1 - (bg.imageOpacity ?? 1)) * 100)}%</span>
                <input type="range" min={0} max={90} value={Math.round((1 - (bg.imageOpacity ?? 1)) * 100)} onChange={(e) => patch({ imageOpacity: +e.target.value === 0 ? undefined : 1 - +e.target.value / 100 })} aria-label="Transparência da imagem" />
              </label>
            )}
            <input
              ref={imgRef}
              type="file"
              accept="image/*"
              hidden
              onChange={async (e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (!f) return;
                try {
                  patch({ image: await fileToBackground(f), pattern: "none" });
                } catch {
                  toast("Não foi possível ler essa imagem");
                }
              }}
            />
          </div>
          <button className="btn ghost" onClick={() => setPrefs({ bg: { ...DEFAULT_BG } })}>
            Restaurar padrão
          </button>
        </div>
      )}
    </div>
  );
}

export function Dock() {
  const tool = useStore((s) => s.tool);
  const panel = useStore((s) => s.panel);
  const animate = useStore((s) => s.animate);
  return (
    <div className="hud glass dock" role="toolbar" aria-label="Ferramentas">
      <button className={`tool ${panel === "files" ? "active" : ""}`} onClick={() => set({ panel: panel === "files" ? null : "files" })} data-tip={"Arquivos do cofre (E)\nSeus diagramas em pastas."} data-tip-pos="right" aria-label="Arquivos" aria-pressed={panel === "files"}>
        <Glyph name="vault" size={21} />
      </button>
      <button className={`tool ${panel === "assets" ? "active" : ""}`} onClick={() => set({ panel: panel === "assets" ? null : "assets" })} data-tip={"Biblioteca de tecnologias (B)\nArraste para o quadro."} data-tip-pos="right" aria-label="Biblioteca" aria-pressed={panel === "assets"}>
        <Glyph name="library" size={21} />
      </button>
      <div className="rule" />
      {TOOLS.map((t) => (
        <button key={t.id} className={`tool ${tool === t.id ? "active" : ""}`} onClick={() => set({ tool: t.id })} data-tip={`${t.label} (${t.key})\n${t.tip}`} data-tip-pos="right" aria-label={t.label} aria-pressed={tool === t.id}>
          <Glyph name={t.icon} size={21} />
        </button>
      ))}
      <div className="rule" />
      <button className="tool" onClick={() => layout("LR")} data-tip={"Auto-layout (L)\nConfigura espaçamento e conectores. Shift+L: vertical."} data-tip-pos="right" aria-label="Auto layout">
        <Glyph name="layout" size={21} />
      </button>
      <button className={`tool ${animate ? "active" : ""}`} onClick={() => setPrefs({ animate: !animate })} data-tip={`Animações das conexões (A): ${animate ? "ligadas" : "desligadas"}`} data-tip-pos="right" aria-label="Alternar animações" aria-pressed={animate}>
        <Glyph name={animate ? "play" : "pause"} size={19} />
      </button>
      <BackgroundPopover />
    </div>
  );
}

/* ───────── barra de zoom + tipos de conexão ───────── */

export function ZoomBar() {
  const z = useStore((s) => s.view.z);
  const canUndo = useStore((s) => s.past.length > 0);
  const canRedo = useStore((s) => s.future.length > 0);
  const zoomBy = (f: number) => {
    const v = getState().view;
    const nz = Math.min(3, Math.max(0.15, v.z * f));
    const cx = window.innerWidth / 2;
    const cy = window.innerHeight / 2;
    set({ view: { z: nz, x: cx - ((cx - v.x) / v.z) * nz, y: cy - ((cy - v.y) / v.z) * nz } });
  };
  return (
    <div className="hud glass zoombar">
      <button className="btn ghost icon" onClick={undo} disabled={!canUndo} aria-label="Desfazer" data-tip="Desfazer (Ctrl+Z)" data-tip-pos="top">
        <Glyph name="undo" size={18} />
      </button>
      <button className="btn ghost icon" onClick={redo} disabled={!canRedo} aria-label="Refazer" data-tip="Refazer (Ctrl+Shift+Z)" data-tip-pos="top">
        <Glyph name="redo" size={18} />
      </button>
      <div className="sep" style={{ margin: "6px 4px" }} />
      <button className="btn ghost icon" onClick={() => zoomBy(1 / 1.2)} aria-label="Diminuir zoom">
        <Glyph name="minus" size={17} />
      </button>
      <span className="pct">{Math.round(z * 100)}%</span>
      <button className="btn ghost icon" onClick={() => zoomBy(1.2)} aria-label="Aumentar zoom">
        <Glyph name="plus" size={17} />
      </button>
      <button className="btn ghost icon" onClick={() => fitView()} aria-label="Ajustar à tela" data-tip="Ajustar à tela (F)" data-tip-pos="top">
        <Glyph name="fit" size={17} />
      </button>
    </div>
  );
}

/* ───────── carrossel de categorias (sem rolagem horizontal visível; setas controlam) ───────── */

function CategoryCarousel({ cats, value, onChange }: { cats: string[]; value?: string; onChange: (c?: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [edge, setEdge] = useState({ left: false, right: false });

  const measure = () => {
    const el = ref.current;
    if (!el) return;
    setEdge({ left: el.scrollLeft > 2, right: el.scrollLeft + el.clientWidth < el.scrollWidth - 2 });
  };
  useEffect(() => {
    measure();
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [cats.length]);

  // a categoria ativa sempre fica visível
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>(".chip.active")?.scrollIntoView({ inline: "nearest", block: "nearest", behavior: "smooth" });
  }, [value]);

  const go = (dir: -1 | 1) => ref.current?.scrollBy({ left: dir * Math.max(120, ref.current.clientWidth * 0.7), behavior: "smooth" });

  return (
    <div className="chips-wrap">
      <button className="chips-arrow left" onClick={() => go(-1)} disabled={!edge.left} aria-label="Categorias anteriores" tabIndex={edge.left ? 0 : -1}>
        <Glyph name="chevron" size={16} style={{ transform: "rotate(90deg)" }} />
      </button>
      <div
        className={`chips ${edge.left ? "fade-l" : ""} ${edge.right ? "fade-r" : ""}`}
        ref={ref}
        onScroll={measure}
        onWheel={(e) => {
          if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) ref.current?.scrollBy({ left: e.deltaY });
        }}
        role="tablist"
        aria-label="Categorias"
      >
        <button role="tab" aria-selected={!value} className={`chip ${!value ? "active" : ""}`} onClick={() => onChange(undefined)}>
          Todos
        </button>
        {cats.map((c) => (
          <button key={c} role="tab" aria-selected={value === c} className={`chip ${value === c ? "active" : ""}`} onClick={() => onChange(value === c ? undefined : c)}>
            {c}
          </button>
        ))}
      </div>
      <button className="chips-arrow right" onClick={() => go(1)} disabled={!edge.right} aria-label="Próximas categorias" tabIndex={edge.right ? 0 : -1}>
        <Glyph name="chevron" size={16} style={{ transform: "rotate(-90deg)" }} />
      </button>
    </div>
  );
}

/* ───────── biblioteca de assets ───────── */

export function Library() {
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<string | undefined>();
  useStore((s) => s.library);
  const customDoc = useStore((s) => s.doc.customAssets);
  const all = allKnownAssets();
  const list = useMemo(() => searchAssets(all, q, cat), [q, cat, all.length, customDoc]);
  const cats = useMemo(() => ["Personalizados", ...ASSET_CATEGORIES], []);

  const grouped = useMemo(() => {
    const m = new Map<string, typeof list>();
    for (const a of list) m.set(a.category, [...(m.get(a.category) ?? []), a]);
    return [...m.entries()];
  }, [list]);

  // cartão de detalhes fora do contêiner rolável (um tooltip dentro dele seria cortado)
  const [tip, setTip] = useState<{ a: Asset; x: number; y: number } | null>(null);
  const asideRef = useRef<HTMLElement>(null);
  const showTip = (a: Asset, el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    const right = asideRef.current?.getBoundingClientRect().right ?? r.right;
    setTip({ a, x: Math.max(8, Math.min(right + 12, window.innerWidth - 292)), y: Math.min(r.top, window.innerHeight - 190) });
  };

  const addAtCenter = (id: string) => {
    const s = getState();
    const asset = allKnownAssets().find((a) => a.id === id);
    if (asset?.kind === "endpoint" && s.sel.length === 1) {
      const sel = s.doc.nodes.find((n) => n.id === s.sel[0]);
      const host = sel?.kind === "endpoint" ? s.doc.nodes.find((n) => n.id === sel.owner) : sel;
      if (host && host.kind !== "endpoint") return placeAsset(id, 0, 0, undefined, host.id); // vira endpoint do serviço selecionado
    }
    const x = (window.innerWidth / 2 - s.view.x) / s.view.z - 92 + Math.random() * 80 - 40;
    const y = (window.innerHeight / 2 - s.view.y) / s.view.z - 36 + Math.random() * 80 - 40;
    placeAsset(id, Math.round(x / 8) * 8, Math.round(y / 8) * 8);
  };

  return (
    <aside className="hud glass library" aria-label="Biblioteca de tecnologias" ref={asideRef}>
      <div className="lib-head">
        <h2>Biblioteca</h2>
        <label className="search">
          <Glyph name="search" size={17} />
          <input id="asset-search" placeholder="Buscar: laravel, fila, cache…  ( / )" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
      </div>
      <CategoryCarousel cats={cats} value={cat} onChange={setCat} />
      <div className="lib-list">
        {grouped.map(([c, items]) => (
          <section key={c}>
            <div className="lib-cat">{c}</div>
            {items.map((a) => (
              <div
                key={a.id}
                className="asset"
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData("application/x-archflow-asset", a.id);
                  e.dataTransfer.effectAllowed = "copy";
                }}
                onClick={() => addAtCenter(a.id)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => e.key === "Enter" && addAtCenter(a.id)}
                onMouseEnter={(e) => showTip(a, e.currentTarget)}
                onFocus={(e) => showTip(a, e.currentTarget)}
                onMouseLeave={() => setTip(null)}
                onBlur={() => setTip(null)}
              >
                <AssetBadge asset={a} size={40} />
                <div className="meta">
                  <div className="name">{a.name}</div>
                  <div className="desc">{a.problem}</div>
                </div>
                {!a.builtin && (
                  <div className="row-actions">
                    <button className="btn ghost icon sm" aria-label="Editar asset" onClick={(e) => (e.stopPropagation(), set({ modal: { type: "asset", id: a.id } }))}>
                      <Glyph name="edit" size={15} />
                    </button>
                    <button className="btn ghost icon sm" aria-label="Remover da biblioteca" onClick={(e) => (e.stopPropagation(), deleteAsset(a.id))}>
                      <Glyph name="trash" size={15} />
                    </button>
                  </div>
                )}
              </div>
            ))}
          </section>
        ))}
        {!list.length && <div className="empty">Nada encontrado. Cadastre este asset abaixo e descreva o problema que ele resolve.</div>}
      </div>
      <div className="lib-foot">
        <button className="btn primary" style={{ flex: 1, justifyContent: "center" }} onClick={() => set({ modal: { type: "asset" } })}>
          <Glyph name="plus" size={17} /> Novo asset
        </button>
      </div>
      {tip &&
        createPortal(
          <div className="glass asset-card" style={{ left: tip.x, top: tip.y }} role="tooltip">
            <div className="asset-card-head">
              <AssetBadge asset={tip.a} size={34} />
              <div>
                <b>{tip.a.name}</b>
                <small>
                  {tip.a.category}
                  {tip.a.vendor ? " · " + tip.a.vendor : ""}
                </small>
              </div>
            </div>
            <p>
              <span>Resolve:</span> {tip.a.problem}
            </p>
            {tip.a.description && tip.a.description !== tip.a.problem && <p className="muted">{tip.a.description}</p>}
            {tip.a.tags.length > 0 && <div className="asset-card-tags">{tip.a.tags.slice(0, 6).map((t) => <i key={t}>{t}</i>)}</div>}
          </div>,
          document.body,
        )}
    </aside>
  );
}

/* ───────── inspector ───────── */

const PALETTE = ["#706fd3", "#2f80ed", "#14a38b", "#e08a1e", "#c2410c", "#d6453d", "#7a5af8", "#7a7a8c"];

const FILL_COLORS = ["#ffffff", "#f7f1e3", "#eef2f7", "#e8f3ec", "#fdf0f0", "#2d2a2e", "#14161c"];

/** Cor de fundo + transparência do corpo de um componente ou grupo. */
function FillControls({ el, patch }: { el: { fill?: string; fillOpacity?: number }; patch: (p: Record<string, unknown>) => void }) {
  const transp = Math.round((1 - (el.fillOpacity ?? 1)) * 100);
  return (
    <>
      <span className="lbl-s">Cor de fundo</span>
      <div className="swatches insp-swatches">
        <button className={`swatch auto ${!el.fill ? "active" : ""}`} aria-label="Fundo padrão do tema" onClick={() => patch({ fill: undefined })} data-tip="Padrão do tema" data-tip-pos="top" />
        <ColorPicker value={el.fill ?? "#ffffff"} swatchColor={el.fill && !FILL_COLORS.includes(el.fill) ? el.fill : undefined} onChange={(c) => patch({ fill: c })} label="Cor de fundo personalizada" />
        {FILL_COLORS.map((c) => (
          <button key={c} className={`swatch ${el.fill === c ? "active" : ""}`} style={{ background: c }} aria-label={`Fundo ${c}`} onClick={() => patch({ fill: c })} />
        ))}
      </div>
      <label className="field">
        <span>Transparência do fundo · {transp}%</span>
        <input type="range" min={0} max={100} value={transp} onChange={(e) => patch({ fillOpacity: +e.target.value === 0 ? undefined : 1 - +e.target.value / 100 })} aria-label="Transparência do fundo" />
      </label>
    </>
  );
}

export function Inspector() {
  const sel = useStore((s) => s.sel);
  const doc = useStore((s) => s.doc);
  const focusTick = useStore((s) => s.focusTick);
  useStore((s) => s.library);
  useEffect(() => {
    if (focusTick) requestAnimationFrame(() => (document.getElementById("insp-first") as HTMLInputElement | null)?.select());
  }, [focusTick]);
  if (!sel.length) return null;

  if (sel.length > 1) {
    return (
      <aside className="hud glass inspector">
        <div className="insp-head">
          <div>
            <div className="kicker">Seleção múltipla</div>
            <div className="ttl">{sel.length} elementos</div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn" onClick={duplicateSelection}>
            <Glyph name="copy" size={16} /> Duplicar
          </button>
          <button className="btn danger" onClick={deleteSelection}>
            <Glyph name="trash" size={16} /> Excluir
          </button>
        </div>
      </aside>
    );
  }

  const id = sel[0];
  const patch = (p: Record<string, unknown>) => run([{ op: "update", id, patch: p }]);
  const node = doc.nodes.find((n) => n.id === id);
  const group = doc.groups.find((g) => g.id === id);
  const note = doc.notes.find((n) => n.id === id);
  const conn = doc.connections.find((c) => c.id === id);
  const actions = (
    <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
      {!conn && (
        <button className="btn" onClick={duplicateSelection}>
          <Glyph name="copy" size={16} /> Duplicar
        </button>
      )}
      <button className="btn danger" onClick={deleteSelection}>
        <Glyph name="trash" size={16} /> Excluir
      </button>
    </div>
  );

  if (node) {
    const asset = lookupAsset(node.asset);
    const groups = doc.groups;
    return (
      <aside className="hud glass inspector" aria-label="Propriedades do componente">
        <div className="insp-head">
          {asset ? <AssetBadge asset={asset} size={46} /> : <AssetBadge asset={{ icon: `t:${node.label.slice(0, 2).toUpperCase()}`, color: "#706fd3", name: node.label }} size={46} />}
          <div>
            <div className="kicker">{NODE_KINDS[node.kind].split(" / ")[0]}</div>
            <div className="ttl">{node.label}</div>
          </div>
        </div>
        {asset?.problem && (
          <div className="callout">
            <b>{asset.name}</b> resolve: {asset.problem}
          </div>
        )}
        <label className="field">
          <span>Nome</span>
          <TextField id="insp-first" value={node.label} onCommit={(v) => patch({ label: v || node.label })} />
        </label>
        {node.kind === "endpoint" ? (
          <EndpointFields node={node} patch={patch} />
        ) : (
          <label className="field">
            <span>Tecnologia / versão</span>
            <TextField value={node.technology ?? ""} placeholder="ex.: Laravel 11 · PHP 8.3" onCommit={(v) => patch({ technology: v || undefined })} />
          </label>
        )}
        <label className="field">
          <span>Responsabilidade (o que faz)</span>
          <TextField multiline value={node.description ?? ""} placeholder="Descreva em 1–2 frases — LLMs leem isto." onCommit={(v) => patch({ description: v || undefined })} />
        </label>
        <div className="grid2">
          <label className="field">
            <span>Tipo</span>
            <select className="input" value={node.kind} onChange={(e) => patch({ kind: e.target.value as NodeKind })}>
              {Object.entries(NODE_KINDS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v.split(" / ")[0].split(",")[0]}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Grupo</span>
            <select className="input" value={node.parent ?? ""} onChange={(e) => patch({ parent: e.target.value || undefined })}>
              <option value="">— nenhum —</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <FillControls el={node} patch={patch} />
        {(node.kind === "system" || node.ref) && <RefPicker node={node} patch={patch} />}
        {node.kind !== "endpoint" && node.kind !== "system" && !node.ref && <EndpointsSection node={node} />}
        <Props value={node.props ?? {}} onChange={(p) => patch({ props: Object.keys(p).length ? p : undefined })} />
        <div className="callout" style={{ fontFamily: "ui-monospace,Consolas,monospace", fontSize: 11.5 }}>
          id: {node.id}
        </div>
        {actions}
      </aside>
    );
  }

  if (conn) {
    const t = CONNECTION_TYPES[conn.type];
    const name = (x: string) => doc.nodes.find((n) => n.id === x)?.label ?? doc.groups.find((g) => g.id === x)?.label ?? x;
    return (
      <aside className="hud glass inspector" aria-label="Propriedades da conexão">
        <div className="insp-head">
          <div>
            <div className="kicker">Conexão · {t.label}</div>
            <div className="ttl">
              {name(conn.from)} → {name(conn.to)}
            </div>
          </div>
        </div>
        <div className="type-grid" role="radiogroup" aria-label="Tipo">
          {CONNECTION_TYPE_KEYS.map((k) => (
            <button key={k} role="radio" aria-checked={conn.type === k} className={`type-btn ${conn.type === k ? "active" : ""}`} style={{ ["--tc" as string]: CONNECTION_TYPES[k].color }} onClick={() => (patch({ type: k }), set({ connType: k }))} data-tip={CONNECTION_TYPES[k].semantics} data-tip-pos="left">
              <ConnSample type={k} />
              {CONNECTION_TYPES[k].label}
            </button>
          ))}
        </div>
        <div className="callout">{t.semantics}</div>
        <label className="field">
          <span>Rótulo</span>
          <TextField id="insp-first" value={conn.label ?? ""} placeholder="ex.: cria pedido" onCommit={(v) => patch({ label: v || undefined })} />
        </label>
        <label className="field">
          <span>Protocolo</span>
          <TextField value={conn.protocol ?? ""} placeholder="HTTPS/REST · gRPC · AMQP · TCP/5432" onCommit={(v) => patch({ protocol: v || undefined })} />
        </label>
        <div className="field">
          <span className="lbl-s">Traçado</span>
          <div className="seg" role="radiogroup">
            {(["curve", "elbow", "straight"] as Routing[]).map((r) => (
              <button key={r} role="radio" aria-checked={(conn.routing ?? "curve") === r} className={(conn.routing ?? "curve") === r ? "active" : ""} onClick={() => patch({ routing: r })}>
                {{ curve: "Curva", elbow: "Ortogonal", straight: "Reta" }[r]}
              </button>
            ))}
          </div>
        </div>
        <div className="field">
          <span className="lbl-s">Curva</span>
          <button className="btn" disabled={!conn.waypoints?.length} onClick={() => patch({ waypoints: undefined })}>
            Resetar curva{conn.waypoints?.length ? ` (${conn.waypoints.length} ponto${conn.waypoints.length > 1 ? "s" : ""})` : ""}
          </button>
          <div className="callout">Com a conexão selecionada, arraste o “•” no meio do traçado para curvá-la; arraste os círculos para ajustar; duplo clique num círculo o remove.</div>
        </div>
        {t.motion !== "none" && (
          <div className="toggle">
            Animar fluxo
            <button className="switch" role="switch" aria-checked={conn.animated !== false} aria-label="Animar fluxo" onClick={() => patch({ animated: conn.animated === false })} />
          </div>
        )}
        <div className="callout">
          {conn.interface ? (
            <>
              <b>{conn.interface.name}</b> · {conn.interface.kind}
              <br />
              {conn.interface.operations.length} operação(ões)
              {conn.interface.contract ? ` · ${conn.interface.contract}` : ""}
            </>
          ) : (
            "Sem contrato de interface. Defina operações, métodos e payloads para humanos e LLMs."
          )}
        </div>
        <button className="btn primary" style={{ width: "100%", justifyContent: "center", marginBottom: 10 }} onClick={() => set({ modal: { type: "interface", id } })}>
          <Glyph name="code" size={17} /> {conn.interface ? "Editar interface" : "Definir interface"}
        </button>
        {actions}
      </aside>
    );
  }

  if (group) {
    return (
      <aside className="hud glass inspector" aria-label="Propriedades do grupo">
        <div className="insp-head">
          <div>
            <div className="kicker">Grupo · {group.kind}</div>
            <div className="ttl">{group.label}</div>
          </div>
        </div>
        <label className="field">
          <span>Nome</span>
          <TextField id="insp-first" value={group.label} onCommit={(v) => patch({ label: v || group.label })} />
        </label>
        <label className="field">
          <span>Tipo de fronteira</span>
          <select className="input" value={group.kind} onChange={(e) => patch({ kind: e.target.value as GroupKind })}>
            {Object.entries(GROUP_KINDS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <span className="lbl-s">Cor</span>
        <div className="swatches">
          {PALETTE.map((c) => (
            <button key={c} className={`swatch ${group.color === c ? "active" : ""}`} style={{ background: c }} aria-label={`Cor ${c}`} onClick={() => patch({ color: c })} />
          ))}
        </div>
        <FillControls el={group} patch={patch} />
        <label className="field">
          <span>Descrição</span>
          <TextField multiline value={group.description ?? ""} placeholder="Propósito desta fronteira" onCommit={(v) => patch({ description: v || undefined })} />
        </label>
        <div className="toggle">
          Ajustar ao conteúdo
          <button className="switch" role="switch" aria-checked={!!group.auto} aria-label="Ajustar ao conteúdo" onClick={() => patch({ auto: !group.auto })} />
        </div>
        {actions}
      </aside>
    );
  }

  if (note) {
    return (
      <aside className="hud glass inspector">
        <div className="insp-head">
          <div>
            <div className="kicker">{note.variant === "text" ? "Texto" : note.variant === "list" ? "Lista" : "Nota"}</div>
            <div className="ttl">{note.variant === "text" ? "Texto livre" : note.variant === "list" ? "Itens, um por linha" : "Decisão ou premissa"}</div>
          </div>
        </div>
        {note.variant === "list" && (
          <>
            <label className="field">
              <span>Título</span>
              <TextField value={note.title ?? ""} placeholder="Sem título" onCommit={(v) => patch({ title: v.trim() || undefined })} />
            </label>
            {note.checklist && (
              <label className="field">
                <span>Descrição</span>
                <TextField multiline value={note.subtitle ?? ""} placeholder="Texto de apoio sob o título" onCommit={(v) => patch({ subtitle: v.trim() || undefined, h: checklistLayout({ ...note, subtitle: v.trim() }).total })} />
              </label>
            )}
            <label className="field check-field">
              <input type="checkbox" checked={!!note.checklist} onChange={(e) => patch({ checklist: e.target.checked, ...(e.target.checked ? { h: checklistLayout({ ...note, w: Math.max(note.w, 300) }).total, w: Math.max(note.w, 300) } : {}) })} />
              <span>Transformar em checklist (caixas de seleção clicáveis no quadro)</span>
            </label>
          </>
        )}
        <label className="field">
          <span>{note.variant === "list" ? "Itens (um por linha)" : "Texto"}</span>
          <TextField id="insp-first" multiline value={note.text} onCommit={(v) => patch({ text: v, ...(note.checklist ? { h: checklistLayout({ ...note, text: v }).total } : {}) })} />
        </label>
        {note.variant && note.variant !== "note" && (
          <div className="field">
            <span>Cor</span>
            <div className="swatches insp-swatches">
              <button className={`swatch auto ${!note.color ? "active" : ""}`} aria-label="Cor padrão" onClick={() => patch({ color: undefined })} data-tip="Padrão do tema" data-tip-pos="top" />
              <ColorPicker value={note.color ?? "#706fd3"} swatchColor={note.color && !INK_COLORS.some((c) => c.id === note.color) ? note.color : undefined} onChange={(c) => patch({ color: c })} />
              {INK_COLORS.map((c) => (
                <button key={c.id} className={`swatch ${note.color === c.id ? "active" : ""}`} style={{ background: c.id }} aria-label={c.name} onClick={() => patch({ color: c.id })} data-tip={c.name} data-tip-pos="top" />
              ))}
            </div>
          </div>
        )}
        {actions}
      </aside>
    );
  }
  return null;
}

function Props({ value, onChange }: { value: Record<string, string>; onChange: (v: Record<string, string>) => void }) {
  const entries = Object.entries(value);
  return (
    <div className="field">
      <span className="lbl-s">Propriedades</span>
      {entries.map(([k, v]) => (
        <div className="kv" key={k}>
          <input className="input" defaultValue={k} aria-label="Chave" onBlur={(e) => e.target.value !== k && onChange(Object.fromEntries(entries.map(([a, b]) => (a === k ? [e.target.value, b] : [a, b]))))} />
          <input className="input" defaultValue={v} aria-label="Valor" onBlur={(e) => e.target.value !== v && onChange({ ...value, [k]: e.target.value })} />
          <button className="btn ghost icon sm" aria-label="Remover propriedade" onClick={() => onChange(Object.fromEntries(entries.filter(([a]) => a !== k)))}>
            <Glyph name="close" size={14} />
          </button>
        </div>
      ))}
      <button className="btn sm" onClick={() => onChange({ ...value, [`chave${entries.length + 1}`]: "valor" })}>
        <Glyph name="plus" size={14} /> Propriedade
      </button>
    </div>
  );
}

export function Toast() {
  const t = useStore((s) => s.toast);
  return t ? (
    <div className="hud glass toast" role="status">
      {t}
    </div>
  ) : null;
}
