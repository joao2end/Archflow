import { pricingDoc } from "../shared/logic.example";
import { lojaOnline } from "../shared/arch.examples";
import { docMode } from "../shared/schema";
import { openDddGuide } from "./dddguide";
import { Glyph } from "./icons";
import { fitView } from "./keys";
import { openExamples, replaceDoc, set, toast, useStore } from "./store";

/** Dica para quadro vazio: some assim que existir qualquer item. */
export function EmptyHint() {
  const empty = useStore((s) => !s.doc.nodes.length && !s.doc.groups.length && !s.doc.notes.length);
  const open = useStore((s) => s.panel === "assets");
  const panel = useStore((s) => s.panel !== null);
  const mode = useStore((s) => docMode(s.doc));
  const domain = mode === "domain";
  const logic = mode === "logic";
  const agents = mode === "agents";
  if (!empty) return null;
  return (
    <div className={`empty-hint${panel ? " beside-panel" : ""}`} role="note">
      <h2>{domain ? "Comece pelo domínio" : logic ? "Comece pela regra" : agents ? "Comece pelo time" : "Comece seu diagrama"}</h2>
      <p>
        {logic
          ? "Abra a biblioteca e arraste um Início, depois uma Ação e um Dado; ligue-os na ordem em que valem e adicione um Cenário com números reais para o quadro conferir o fluxo sozinho. Ou peça ao seu agente via MCP."
          : domain
          ? "Desenhe um grupo «context» (tecla G) para o bounded context e arraste da biblioteca um Use Case, um Command e um Aggregate Root. Ou peça ao seu agente via MCP (add_use_cases)."
          : agents
          ? "Arraste da biblioteca um Agent e escreva a description (quando o orquestrador deve chamá-lo); depois uma Skill e ligue com uma seta uses-skill, ou solte-a dentro de um grupo «global» (tecla G) para valer para todos os agentes."
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
        <button className="btn ghost" onClick={() => openExamples(mode)}>
          <Glyph name="sparkle" size={17} /> Exemplos
        </button>
        {!domain && !agents && (
          <button
            className="btn"
            onClick={() => {
              replaceDoc(logic ? pricingDoc() : lojaOnline());
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
