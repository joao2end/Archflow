/**
 * Menu "Adicionar em <camada>" do layout "camadas" (modo domain): aparece ao clicar numa área dos anéis, no canvas 2D e na
 * visão isométrica, com os componentes que pertencem àquela camada. O componente nasce na área clicada, o layout o encaixa
 * na órbita e o campo Nome do inspetor já vem selecionado para digitar.
 */
import { onionPicks, type OnionPick } from "../shared/onion";
import { getState, run, set, toastError, useStore } from "./store";

export function RingAddMenu({ x, y, groupId, onClose }: { x: number; y: number; groupId: string; onClose: () => void }) {
  const g = useStore((s) => s.doc.groups.find((q) => q.id === groupId));
  if (!g?.ring) return null;
  const picks = onionPicks(g.ring.layer, g.ring.side);
  const add = (node: OnionPick["node"]) => {
    onClose();
    const [r] = run([{ op: "add_node", ...node, parent: g.id }, { op: "layout", style: "onion" }]);
    if (!r.ok) return toastError(r.error ?? "Não deu para adicionar");
    if (r.id) set({ sel: [r.id], focusTick: getState().focusTick + 1 });
  };
  return (
    <div
      className="glass ctx-menu"
      data-ui
      style={{ left: Math.min(x, window.innerWidth - 250), top: Math.min(y, window.innerHeight - 260) }}
      role="menu"
      aria-label={`Adicionar em ${g.label}`}
      onPointerDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="ctx-menu-title">Adicionar em {g.label}</div>
      {picks.map((p) => (
        <button key={p.label} role="menuitem" onClick={() => add(p.node)}>
          {p.label}
        </button>
      ))}
    </div>
  );
}
