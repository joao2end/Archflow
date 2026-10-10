import { Glyph } from "./icons";
import { set, useStore } from "./store";

/** Dica para quadro vazio: some assim que existir qualquer item. */
export function EmptyHint() {
  const empty = useStore((s) => !s.doc.nodes.length && !s.doc.groups.length && !s.doc.notes.length);
  const open = useStore((s) => s.panel === "assets");
  if (!empty) return null;
  return (
    <div className="empty-hint" role="note">
      <h2>Comece seu diagrama</h2>
      <p>Abra a biblioteca e arraste uma tecnologia para o quadro, ou peça ao seu agente via MCP.</p>
      <div className="empty-actions">
        <button className="btn primary" onClick={() => set({ panel: open ? null : "assets" })}>
          <Glyph name="library" size={17} /> {open ? "Fechar biblioteca" : "Abrir biblioteca"}
        </button>
        <button className="btn ghost" onClick={() => set({ modal: { type: "help" } })}>
          <Glyph name="help" size={17} /> Atalhos
        </button>
      </div>
      <p className="empty-keys">
        <kbd>B</kbd> biblioteca · <kbd>G</kbd> grupo · <kbd>N</kbd> nota · <kbd>?</kbd> ajuda
      </p>
    </div>
  );
}
