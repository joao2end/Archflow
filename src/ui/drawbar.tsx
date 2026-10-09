import { useEffect, useState } from "react";
import { ColorPicker } from "./colorpicker";
import { Glyph } from "./icons";
import { DASHES, HL_WIDTHS, INK_COLORS, PEN_WIDTHS } from "./ink";
import { set, useStore, type Tool } from "./store";

const TOOLS: { id: Tool; icon: string; label: string; key: string; tip: string }[] = [
  { id: "select", icon: "select", label: "Selecionar", key: "V", tip: "Mover, selecionar e editar. Arraste dos pontos “+” de um componente para conectá-lo." },
  { id: "pen", icon: "pen", label: "Caneta", key: "D", tip: "Desenho à mão livre." },
  { id: "highlight", icon: "highlighter", label: "Marca-texto", key: "M", tip: "Destaca trechos do diagrama." },
  { id: "eraser", icon: "eraser", label: "Borracha", key: "X", tip: "Apaga o que o cursor tocar: desenhos, textos, listas, componentes e conexões. Ctrl+Z desfaz." },
  { id: "text", icon: "text", label: "Texto", key: "W", tip: "Clique (ou arraste) para escrever um texto solto." },
  { id: "list", icon: "list", label: "Lista", key: "I", tip: "Clique (ou arraste) para criar uma lista. Use “[ ] item” para caixas de seleção." },
];

/** Ferramentas de desenho e anotação — centro inferior do quadro. */
export function DrawBar() {
  const tool = useStore((s) => s.tool);
  const color = useStore((s) => s.inkColor);
  const inkTool = tool === "pen" || tool === "highlight";
  // opções recolhidas pelo usuário; reabrem ao trocar de ferramenta
  // as opções só abrem ao clicar numa cor; trocar de ferramenta as fecha
  const [optsFor, setOptsFor] = useState<Tool | null>(null);
  useEffect(() => setOptsFor((o) => (o === tool ? o : null)), [tool]);
  return (
    <div className="hud glass draw-bar" role="toolbar" aria-label="Desenho e anotações">
      {tool === "eraser" && <EraseModes />}
      {inkTool && optsFor === tool && <InkOptions tool={tool as "pen" | "highlight"} color={color} onClose={() => setOptsFor(null)} />}
      {TOOLS.slice(0, 4).map((t) => (
        <ToolBtn key={t.id} t={t} active={tool === t.id} />
      ))}
      <div className="rule" />
      {TOOLS.slice(4).map((t) => (
        <ToolBtn key={t.id} t={t} active={tool === t.id} />
      ))}
      <div className="rule" />
      <div className={`swatches${inkTool ? "" : " dim"}`} role="radiogroup" aria-label="Cor do desenho">
        {INK_COLORS.map((c) => (
          <button key={c.id} role="radio" aria-checked={color === c.id} aria-label={c.name} className={`swatch ${color === c.id ? "active" : ""}`} style={{ background: c.id }} onClick={() => (set({ inkColor: c.id, ...(inkTool ? {} : { tool: "pen" as Tool }) }), setOptsFor(inkTool ? tool : "pen"))} data-tip={c.name} data-tip-pos="top" />
        ))}
      </div>
    </div>
  );
}

/** Modo da borracha: só desenhos à mão livre ou tudo (componentes, textos, notas, conexões). */
export function EraseModes() {
  const mode = useStore((s) => s.eraseMode);
  const opts = [
    { id: "ink" as const, label: "Só desenho", tip: "Apaga apenas os traços de caneta e marca-texto." },
    { id: "all" as const, label: "Tudo", tip: "Apaga também componentes, textos, listas, notas e conexões." },
  ];
  return (
    <div className="glass ink-opts erase-modes" role="radiogroup" aria-label="Modo da borracha">
      {opts.map((o) => (
        <button key={o.id} type="button" role="radio" aria-checked={mode === o.id} className={`erase-mode ${mode === o.id ? "active" : ""}`} onClick={() => set({ eraseMode: o.id })} data-tip={o.tip} data-tip-pos="top">
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Espessura, opacidade, traçado e cor personalizada da caneta / marca-texto. */
export function InkOptions({ tool, color, onClose }: { tool: "pen" | "highlight"; color: string; onClose: () => void }) {
  const cfg = useStore((s) => s.inkCfg);
  const dash = useStore((s) => s.inkDash);
  const { width, opacity } = cfg[tool];
  const widths = tool === "pen" ? PEN_WIDTHS : HL_WIDTHS;
  const patch = (p: Partial<{ width: number; opacity: number }>) => set({ inkCfg: { ...cfg, [tool]: { ...cfg[tool], ...p } } });
  return (
    <div className="glass ink-opts" role="group" aria-label="Opções do traço">
      <div className="ink-head">
        <span className="ink-lbl">{tool === "pen" ? "Caneta" : "Marca-texto"}</span>
        <button type="button" className="btn ghost icon" onClick={onClose} aria-label="Fechar opções do traço" data-tip="Fechar" data-tip-pos="top">
          <Glyph name="close" size={15} />
        </button>
      </div>
      <div className="ink-row" role="radiogroup" aria-label="Espessura">
        {widths.map((w) => (
          <button key={w} role="radio" aria-checked={width === w} className={`ink-w ${width === w ? "active" : ""}`} onClick={() => patch({ width: w })} data-tip={`Espessura ${w}`} data-tip-pos="top" aria-label={`Espessura ${w}`}>
            <i style={{ width: Math.min(w, 22), height: Math.min(w, 22) }} />
          </button>
        ))}
        <input type="range" min={1} max={48} value={width} onChange={(e) => patch({ width: +e.target.value })} aria-label="Espessura personalizada" />
      </div>
      <div className="ink-row" role="radiogroup" aria-label="Traçado">
        {DASHES.map((d) => (
          <button key={d.id} role="radio" aria-checked={dash === d.id} className={`ink-d ${dash === d.id ? "active" : ""}`} onClick={() => set({ inkDash: d.id })} data-tip={d.name} data-tip-pos="top" aria-label={d.name}>
            <svg width="34" height="10" aria-hidden>
              <line x1="3" y1="5" x2="31" y2="5" stroke="currentColor" strokeWidth="3" strokeLinecap={d.id === "dotted" ? "round" : "butt"} strokeDasharray={d.id === "dashed" ? "7 5" : d.id === "dotted" ? "0.01 6" : undefined} />
            </svg>
          </button>
        ))}
      </div>
      <div className="ink-row">
        <span className="ink-lbl">Opacidade</span>
        <input type="range" min={10} max={100} value={Math.round(opacity * 100)} onChange={(e) => patch({ opacity: +e.target.value / 100 })} aria-label="Opacidade" />
        <ColorPicker value={color} swatchColor={INK_COLORS.some((c) => c.id === color) ? undefined : color} onChange={(c) => set({ inkColor: c })} />
      </div>
    </div>
  );
}

function ToolBtn({ t, active }: { t: (typeof TOOLS)[number]; active: boolean }) {
  return (
    <button className={`tool ${active ? "active" : ""}`} onClick={() => set({ tool: active ? "select" : t.id })} data-tip={`${t.label} (${t.key})\n${t.tip}`} data-tip-pos="top" aria-label={t.label} aria-pressed={active}>
      <Glyph name={t.icon} size={20} />
    </button>
  );
}

