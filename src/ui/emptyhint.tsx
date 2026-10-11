import { docMode } from "../shared/schema";
import { Glyph } from "./icons";
import { set, useStore } from "./store";

/** Dica para quadro vazio: some assim que existir qualquer item. */
export function EmptyHint() {
  const empty = useStore((s) => !s.doc.nodes.length && !s.doc.groups.length && !s.doc.notes.length);
  const open = useStore((s) => s.panel === "assets");
  const domain = useStore((s) => docMode(s.doc) === "domain");
  if (!empty) return null;
  return (
    <div className="empty-hint" role="note">
      <h2>{domain ? "Comece pelo domínio" : "Comece seu diagrama"}</h2>
      <p>
        {domain
          ? "Desenhe um grupo «context» (tecla G) para o bounded context e arraste da biblioteca um Use Case, um Command e um Aggregate Root. Ou peça ao seu agente via MCP (add_use_cases)."
          : "Abra a biblioteca e arraste uma tecnologia para o quadro, ou peça ao seu agente via MCP."}
      </p>
      <div className="empty-actions">
        <button className="btn primary" onClick={() => set({ panel: open ? null : "assets" })}>
          <Glyph name="library" size={17} /> {open ? "Fechar biblioteca" : "Abrir biblioteca"}
        </button>
        {domain && (
          <button className="btn ghost" onClick={() => set({ modal: { type: "examples" } })}>
            <Glyph name="sparkle" size={17} /> Exemplos de DDD
          </button>
        )}
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
