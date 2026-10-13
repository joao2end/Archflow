import { pricingDoc } from "../shared/logic.example";
import { starterDoc } from "../shared/starter.example";
import { docMode } from "../shared/schema";
import { openDddGuide } from "./dddguide";
import { Glyph } from "./icons";
import { fitView } from "./keys";
import { replaceDoc, set, toast, useStore } from "./store";

/** Dica para quadro vazio: some assim que existir qualquer item. */
export function EmptyHint() {
  const empty = useStore((s) => !s.doc.nodes.length && !s.doc.groups.length && !s.doc.notes.length);
  const open = useStore((s) => s.panel === "assets");
  const panel = useStore((s) => s.panel !== null);
  const mode = useStore((s) => docMode(s.doc));
  const domain = mode === "domain";
  const logic = mode === "logic";
  if (!empty) return null;
  return (
    <div className={`empty-hint${panel ? " beside-panel" : ""}`} role="note">
      <h2>{domain ? "Comece pelo domínio" : logic ? "Comece pela regra" : "Comece seu diagrama"}</h2>
      <p>
        {logic
          ? "Abra a biblioteca e arraste um Início, depois uma Ação e um Dado; ligue-os na ordem em que valem e adicione um Cenário com números reais para o quadro conferir o fluxo sozinho. Ou peça ao seu agente via MCP."
          : domain
          ? "Desenhe um grupo «context» (tecla G) para o bounded context e arraste da biblioteca um Use Case, um Command e um Aggregate Root. Ou peça ao seu agente via MCP (add_use_cases)."
          : "Abra a biblioteca e arraste uma tecnologia para o quadro, ou veja um exemplo pronto para entender como o quadro lê. Também dá para pedir ao seu agente via MCP."}
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
        {!domain && (
          <button
            className="btn"
            onClick={() => {
              replaceDoc(logic ? pricingDoc() : starterDoc());
              fitView(); // sem isso a vista continuava onde estava e o exemplo carregava fora da tela
              toast(`Exemplo ${logic ? "de precificação" : "da loja online"} carregado.`, true);
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
