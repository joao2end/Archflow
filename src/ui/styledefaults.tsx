import { useRef } from "react";
import { CONNECTION_TYPES, CONNECTION_TYPE_KEYS, GROUP_KINDS, INFRA_CONNECTION_TYPES, NODE_KINDS, docMode, type ConnectionType, type GroupKind, type NodeKind, type Routing } from "../shared/schema";
import { RICH_FONTS, type RichFont } from "../shared/richtext";
import { BG_PRESETS, PresetPattern } from "./bgpresets";
import { ColorPicker } from "./colorpicker";
import { Glyph } from "./icons";
import { INK_COLORS } from "./ink";
import { applyStyleToSelection, DEFAULT_BG, setPrefs, setStyleDefaults, toastError, useStore, type BgPattern, type ElementDefaults } from "./store";

export const FILL_COLORS = ["#ffffff", "#f7f1e3", "#eef2f7", "#e8f3ec", "#fdf0f0", "#2d2a2e", "#14161c"];
export const PALETTE = ["#706fd3", "#2f80ed", "#14a38b", "#e08a1e", "#c2410c", "#d6453d", "#7a5af8", "#7a7a8c"];

const ARCH_NODE_KINDS = (Object.keys(NODE_KINDS) as NodeKind[]).filter((k) => k !== "endpoint" && k !== "domain" && k !== "logic");
const BG_PATTERNS: { id: BgPattern; label: string }[] = [
  { id: "dots", label: "Pontos" },
  { id: "grid", label: "Grade" },
  { id: "lines", label: "Linhas" },
  { id: "none", label: "Liso" },
];
const BG_COLORS = ["#ffffff", "#f7f1e3", "#eef2f7", "#e8f3ec", "#fdf0f0", "#2d2a2e", "#14161c"];

function ConnSample({ type }: { type: ConnectionType }) {
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

/** Cor de fundo + transparência do corpo de um componente ou grupo. */
export function FillControls({ el, patch }: { el: { fill?: string; fillOpacity?: number }; patch: (p: Record<string, unknown>) => void }) {
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

function patchDefaults(p: Partial<ElementDefaults>) {
  applyStyleToSelection(p);
}

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

function BackgroundFields() {
  const bg = useStore((s) => s.bg);
  const imgRef = useRef<HTMLInputElement>(null);
  const patch = (p: Partial<typeof bg>) => setPrefs({ bg: { ...bg, ...p } });
  return (
    <>
      <div className="styles-sec">Fundo do quadro</div>
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
              toastError("Não foi possível ler essa imagem");
            }
          }}
        />
      </div>
      <button className="btn ghost" style={{ width: "100%", justifyContent: "center" }} onClick={() => setPrefs({ bg: { ...DEFAULT_BG } })}>
        Restaurar fundo padrão
      </button>
    </>
  );
}

/** Conteúdo das configurações globais de estilo (popover do dock). */
export function DefaultsPanel() {
  const d = useStore((s) => s.defaults);
  const mode = useStore((s) => docMode(s.doc));
  const domainConn = mode === "domain";
  return (
    <div className="styles-body">
      <div className="insp-head">
        <div>
          <div className="kicker">Configurações</div>
          <div className="ttl" role="heading" aria-level={2}>
            Estilos padrão
          </div>
        </div>
      </div>
      <div className="callout">Define o estilo dos novos elementos. Com algo selecionado, aplica e atualiza este padrão.</div>

      <div className="styles-sec">Elementos</div>

      {mode === "architecture" && (
        <label className="field">
          <span>Tipo de nó</span>
          <select className="input" value={d.nodeKind} onChange={(e) => patchDefaults({ nodeKind: e.target.value as NodeKind })}>
            {ARCH_NODE_KINDS.map((k) => (
              <option key={k} value={k}>
                {NODE_KINDS[k].split(" / ")[0].split(",")[0]}
              </option>
            ))}
          </select>
        </label>
      )}

      <FillControls
        el={{ fill: d.fill, fillOpacity: d.fillOpacity }}
        patch={(p) =>
          patchDefaults({
            ...("fill" in p ? { fill: p.fill as string | undefined } : {}),
            ...("fillOpacity" in p ? { fillOpacity: p.fillOpacity as number | undefined } : {}),
          })
        }
      />

      <label className="field">
        <span>Tipo de grupo</span>
        <select className="input" value={d.groupKind} onChange={(e) => patchDefaults({ groupKind: e.target.value as GroupKind })}>
          {Object.entries(GROUP_KINDS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </label>

      <span className="lbl-s">Cor do grupo</span>
      <div className="swatches">
        <button className={`swatch auto ${!d.groupColor ? "active" : ""}`} aria-label="Sem cor" onClick={() => patchDefaults({ groupColor: undefined })} data-tip="Sem cor" data-tip-pos="top" />
        {PALETTE.map((c) => (
          <button key={c} className={`swatch ${d.groupColor === c ? "active" : ""}`} style={{ background: c }} aria-label={`Cor ${c}`} onClick={() => patchDefaults({ groupColor: c })} />
        ))}
      </div>

      <span className="lbl-s">Estilo de fonte</span>
      <div className="seg" role="radiogroup" aria-label="Fonte">
        {RICH_FONTS.map((f) => (
          <button key={f.id} role="radio" aria-checked={d.noteFont === f.id} className={d.noteFont === f.id ? "active" : ""} onClick={() => patchDefaults({ noteFont: f.id as RichFont })}>
            {f.name}
          </button>
        ))}
      </div>

      <span className="lbl-s">Cor do texto / nota</span>
      <div className="swatches insp-swatches">
        <button className={`swatch auto ${!d.noteColor ? "active" : ""}`} aria-label="Cor padrão" onClick={() => patchDefaults({ noteColor: undefined })} data-tip="Padrão do tema" data-tip-pos="top" />
        <ColorPicker value={d.noteColor ?? "#706fd3"} swatchColor={d.noteColor && !INK_COLORS.some((c) => c.id === d.noteColor) ? d.noteColor : undefined} onChange={(c) => patchDefaults({ noteColor: c })} />
        {INK_COLORS.map((c) => (
          <button key={c.id} className={`swatch ${d.noteColor === c.id ? "active" : ""}`} style={{ background: c.id }} aria-label={c.name} onClick={() => patchDefaults({ noteColor: c.id })} data-tip={c.name} data-tip-pos="top" />
        ))}
      </div>

      {mode !== "logic" && (
        <>
          <span className="lbl-s">Tipo de conexão</span>
          <div className="type-grid" role="radiogroup" aria-label="Tipo de conexão" style={domainConn ? { opacity: 0.55 } : undefined}>
            {CONNECTION_TYPE_KEYS.filter((k) => !domainConn || !INFRA_CONNECTION_TYPES.includes(k)).map((k) => (
              <button
                key={k}
                role="radio"
                aria-checked={d.connType === k}
                className={`type-btn ${d.connType === k ? "active" : ""}`}
                style={{ ["--tc" as string]: CONNECTION_TYPES[k].color }}
                onClick={() => patchDefaults({ connType: k })}
                data-tip={CONNECTION_TYPES[k].semantics}
                data-tip-pos="left"
                disabled={domainConn}
              >
                <ConnSample type={k} />
                {CONNECTION_TYPES[k].label}
              </button>
            ))}
          </div>
        </>
      )}

      <div className="field">
        <span className="lbl-s">Traçado</span>
        <div className="seg" role="radiogroup">
          {(["curve", "elbow", "straight"] as Routing[]).map((r) => (
            <button key={r} role="radio" aria-checked={d.connRouting === r} className={d.connRouting === r ? "active" : ""} onClick={() => patchDefaults({ connRouting: r })}>
              {{ curve: "Curva", elbow: "Ortogonal", straight: "Reta" }[r]}
            </button>
          ))}
        </div>
      </div>

      <button
        className="btn ghost"
        style={{ width: "100%", justifyContent: "center" }}
        onClick={() => {
          setStyleDefaults({
            nodeKind: "service",
            fill: undefined,
            fillOpacity: undefined,
            groupKind: "boundary",
            groupColor: undefined,
            noteColor: undefined,
            noteFont: "sans",
            connType: "sync",
            connRouting: "curve",
          });
        }}
      >
        Restaurar estilos padrão
      </button>

      <BackgroundFields />
    </div>
  );
}

/** Sincroniza um patch de estilo do inspetor com os defaults globais. */
export function syncStyleDefaults(kind: "node" | "group" | "note" | "conn", p: Record<string, unknown>) {
  const d: Partial<ElementDefaults> = {};
  if (kind === "node") {
    if ("fill" in p) d.fill = p.fill as string | undefined;
    if ("fillOpacity" in p) d.fillOpacity = p.fillOpacity as number | undefined;
    if (typeof p.kind === "string" && (ARCH_NODE_KINDS as readonly string[]).includes(p.kind)) d.nodeKind = p.kind as NodeKind;
  } else if (kind === "group") {
    if ("fill" in p) d.fill = p.fill as string | undefined;
    if ("fillOpacity" in p) d.fillOpacity = p.fillOpacity as number | undefined;
    if (typeof p.kind === "string") d.groupKind = p.kind as GroupKind;
    if ("color" in p) d.groupColor = p.color as string | undefined;
  } else if (kind === "note") {
    if ("color" in p) d.noteColor = p.color as string | undefined;
    if ("font" in p) d.noteFont = ((p.font as RichFont | undefined) ?? "sans") as RichFont;
  } else if (kind === "conn") {
    if (typeof p.type === "string") d.connType = p.type as ConnectionType;
    if ("routing" in p) d.connRouting = ((p.routing as Routing | undefined) ?? "curve") as Routing;
  }
  if (Object.keys(d).length) setStyleDefaults(d);
}
