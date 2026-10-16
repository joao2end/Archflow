/** Peças pequenas das barras laterais do terminal (prompts e workflows). */
import { useEffect, useRef, useState, type ReactNode } from "react";

/** Menu «⋯» para as ações raras (duplicar, apagar…): fecha ao clicar fora ou com Esc. */
export function MoreMenu({ items, label = "Mais ações", glyph = "⋯" }: { items: { label: string; onClick: () => void; danger?: boolean; disabled?: boolean }[]; label?: string; glyph?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("pointerdown", away);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("pointerdown", away);
      window.removeEventListener("keydown", esc);
    };
  }, [open]);
  return (
    <div className="more-wrap" ref={ref}>
      <button className="btn ghost icon sm" aria-haspopup="menu" aria-expanded={open} aria-label={label} title={label} onClick={() => setOpen((o) => !o)}>{glyph}</button>
      {open && (
        <div className="glass more-menu" role="menu">
          {items.map((it) => (
            <button key={it.label} role="menuitem" className={it.danger ? "danger" : ""} disabled={it.disabled} onClick={() => (setOpen(false), it.onClick())}>{it.label}</button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Cabeçalho de uma tela interna: seta de volta + título + ações opcionais. */
export function PaneHead({ title, onBack, children }: { title: string; onBack: () => void; children?: ReactNode }) {
  return (
    <div className="pane-head">
      <button className="btn ghost icon sm" aria-label="Voltar para a lista" title="Voltar" onClick={onBack}>←</button>
      <b title={title}>{title}</b>
      {children}
    </div>
  );
}
