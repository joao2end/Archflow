import { pricingDoc } from "../shared/logic.example";
import { docMode } from "../shared/schema";
import { openDddGuide } from "./dddguide";
import { Glyph } from "./icons";
import { replaceDoc, set, toast, useStore } from "./store";

/** Dica para quadro vazio: some assim que existir qualquer item. */
export function EmptyHint() {
  const empty = useStore((s) => !s.doc.nodes.length && !s.doc.groups.length && !s.doc.notes.length);
  const open = useStore((s) => s.panel === "assets");
  const mode = useStore((s) => docMode(s.doc));
  const domain = mode === "domain";
  const logic = mode === "logic";
  if (!empty) return null;
  return (
    <div className="empty-hint" role="note">
      <h2>{domain ? "Comece pelo domínio" : logic ? "Comece pela regra" : "Comece seu diagrama"}</h2>
      <p>
        {logic
          ? "Abra a biblioteca e arraste um Início, depois uma Regra e um Dado; ligue-os na ordem em que valem e adicione um Cenário com números reais para o quadro conferir a regra sozinho. Ou peça ao seu agente via MCP."
          : domain
          ? "Desenhe um grupo «context» (tecla G) para o bounded context e arraste da biblioteca um Use Case, um Command e um Aggregate Root. Ou peça ao seu agente via MCP (add_use_cases)."
          : "Abra a biblioteca e arraste uma tecnologia para o quadro, ou peça ao seu agente via MCP."}
      </p>
      <div className="empty-actions">
        <button className="btn primary" onClick={() => set({ panel: open ? null : "assets" })}>
          <Glyph name="library" size={17} /> {open ? "Fechar biblioteca" : "Abrir biblioteca"}
        </button>
        {domain && (
          <button className="btn" onClick={openDddGuide}>
            <Glyph name="play" size={16} /> Guia de DDD
          </button>
        )}
        {domain && (
          <button className="btn ghost" onClick={() => set({ modal: { type: "examples" } })}>
            <Glyph name="sparkle" size={17} /> Exemplos de DDD
          </button>
        )}
        {logic && (
          <button
            className="btn"
            onClick={() => {
              replaceDoc(pricingDoc());
              toast("Exemplo de precificação carregado. Ctrl+Z desfaz.");
            }}
          >
            <Glyph name="sparkle" size={17} /> Ver exemplo pronto
          </button>
        )}
        <button className="btn ghost" onClick={() => set({ modal: { type: "help" } })}>
          <Glyph name="help" size={17} /> Atalhos
        </button>
      </div>
      <p className="empty-keys">
        <kbd>B</kbd> biblioteca · {!logic && <><kbd>G</kbd> grupo · </>}<kbd>N</kbd> nota · <kbd>?</kbd> ajuda
      </p>
    </div>
  );
}
