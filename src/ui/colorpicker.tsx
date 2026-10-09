import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as RPointerEvent } from "react";
import { createPortal } from "react-dom";
import { Glyph } from "./icons";

/* ───────── conversões ───────── */

type HSV = { h: number; s: number; v: number };

const clamp = (n: number, a = 0, b = 1) => Math.min(b, Math.max(a, n));

function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const h = m[1].length === 3 ? m[1].replace(/./g, (c) => c + c) : m[1];
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function rgbToHsv([r, g, b]: [number, number, number]): HSV {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  let h = 0;
  if (d) h = max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: h * 60, s: max ? d / max : 0, v: max };
}

function hsvToHex({ h, s, v }: HSV): string {
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
  };
  return "#" + [f(5), f(3), f(1)].map((x) => Math.round(x * 255).toString(16).padStart(2, "0")).join("");
}

const toHsv = (hex: string): HSV => {
  const rgb = hexToRgb(hex);
  return rgb ? rgbToHsv(rgb) : { h: 0, s: 0, v: 1 };
};

/* ───────── seletor ───────── */

declare global {
  interface Window {
    EyeDropper?: new () => { open: () => Promise<{ sRGBHex: string }> };
  }
}

const POP_W = 232;

/** Arrasto 2D/1D com ponteiro capturado; entrega posições normalizadas (0–1). */
function useDrag(onMove: (x: number, y: number) => void) {
  const move = useRef(onMove);
  move.current = onMove;
  return {
    onPointerDown: (e: RPointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      const r = e.currentTarget.getBoundingClientRect();
      move.current(clamp((e.clientX - r.left) / r.width), clamp((e.clientY - r.top) / r.height));
    },
    onPointerMove: (e: RPointerEvent<HTMLDivElement>) => {
      if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
      const r = e.currentTarget.getBoundingClientRect();
      move.current(clamp((e.clientX - r.left) / r.width), clamp((e.clientY - r.top) / r.height));
    },
  };
}

/**
 * Seletor de cor próprio (substitui o `<input type="color">` nativo): área de saturação/brilho,
 * matiz, campo hex e conta-gotas. O botão exibe `swatchColor`; sem ele, mostra o degradê de “cor personalizada”.
 */
export function ColorPicker({ value, onChange, swatchColor, label = "Cor personalizada", className = "" }: { value: string; onChange: (hex: string) => void; swatchColor?: string; label?: string; className?: string }) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const [hsv, setHsv] = useState<HSV>(() => toHsv(value));
  const [hexText, setHexText] = useState(value);

  // sincroniza com mudanças externas, preservando o matiz quando a cor é cinza/preta
  useEffect(() => {
    setHexText(value);
    setHsv((cur) => {
      if (hsvToHex(cur).toLowerCase() === value.toLowerCase()) return cur;
      const n = toHsv(value);
      return n.s === 0 || n.v === 0 ? { ...n, h: cur.h } : n;
    });
  }, [value]);

  const place = useCallback(() => {
    const b = btn.current?.getBoundingClientRect();
    if (!b) return;
    const h = pop.current?.offsetHeight ?? 260;
    const left = clamp(b.left + b.width / 2 - POP_W / 2, 8, window.innerWidth - POP_W - 8) ;
    const below = b.bottom + 8 + h <= window.innerHeight - 8;
    setPos({ left, top: below ? b.bottom + 8 : Math.max(8, b.top - 8 - h) });
  }, []);

  useLayoutEffect(() => {
    if (open) place();
    else setPos(null);
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!pop.current?.contains(t) && !btn.current?.contains(t)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      setOpen(false);
      btn.current?.focus();
    };
    window.addEventListener("pointerdown", down);
    window.addEventListener("keydown", key, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("pointerdown", down);
      window.removeEventListener("keydown", key, true);
      window.removeEventListener("resize", place);
    };
  }, [open, place]);

  const apply = (n: HSV) => {
    setHsv(n);
    const hex = hsvToHex(n);
    setHexText(hex);
    onChange(hex);
  };
  const sv = useDrag((x, y) => apply({ ...hsv, s: x, v: 1 - y }));
  const hue = useDrag((x) => apply({ ...hsv, h: x * 360 }));
  const hex = hsvToHex(hsv);

  const commitHex = (t: string) => {
    const rgb = hexToRgb(t);
    if (!rgb) return setHexText(hex);
    apply(rgbToHsv(rgb).s === 0 ? { ...rgbToHsv(rgb), h: hsv.h } : rgbToHsv(rgb));
  };
  const pick = async () => {
    try {
      const r = await new window.EyeDropper!().open();
      commitHex(r.sRGBHex);
    } catch {
      /* cancelado */
    }
  };

  return (
    <>
      <button ref={btn} type="button" className={`swatch custom cpick-trigger ${open ? "active" : ""} ${className}`} style={swatchColor ? { background: swatchColor } : undefined} aria-label={label} aria-haspopup="dialog" aria-expanded={open} data-tip={label} data-tip-pos="top" onClick={() => setOpen((o) => !o)} />
      {open &&
        createPortal(
          <div ref={pop} className="glass cpick-pop" role="dialog" aria-label={label} style={{ left: pos?.left ?? 0, top: pos?.top ?? 0, width: POP_W, visibility: pos ? "visible" : "hidden", background: "var(--glass-strong)" }}>
            <div className="ink-head">
              <span className="ink-lbl">Cor</span>
              <button type="button" className="btn ghost icon" onClick={() => (setOpen(false), btn.current?.focus())} aria-label="Fechar seletor de cor" data-tip="Fechar" data-tip-pos="top">
                <Glyph name="close" size={15} />
              </button>
            </div>
            <div className="cpick-sv" style={{ backgroundColor: `hsl(${hsv.h}, 100%, 50%)` }} {...sv}>
              <i className="cpick-knob" style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`, background: hex }} />
            </div>
            <div className="cpick-hue" {...hue}>
              <i className="cpick-knob" style={{ left: `${(hsv.h / 360) * 100}%`, top: "50%", background: `hsl(${hsv.h}, 100%, 50%)` }} />
            </div>
            <div className="cpick-row">
              <i className="cpick-prev" style={{ background: hex }} />
              <input className="input cpick-hex" value={hexText} spellCheck={false} maxLength={7} aria-label="Valor hexadecimal" onChange={(e) => setHexText(e.target.value)} onBlur={(e) => commitHex(e.target.value)} onKeyDown={(e) => e.key === "Enter" && commitHex(e.currentTarget.value)} />
              {window.EyeDropper && (
                <button type="button" className="btn ghost icon" onClick={pick} aria-label="Conta-gotas" data-tip="Capturar cor da tela" data-tip-pos="top">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="m2 22 1-1h3l9-9M3 21v-3l9-9" />
                    <path d="m15 6 3.4-3.4a2.1 2.1 0 1 1 3 3L18 9l.4.4a2.1 2.1 0 1 1-3 3l-3.8-3.8a2.1 2.1 0 1 1 3-3z" />
                  </svg>
                </button>
              )}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
