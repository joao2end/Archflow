/**
 * Menu "Adicionar em <camada>" do layout "camadas" (modo domain): aparece ao clicar numa área dos anéis, no canvas 2D e na
 * visão isométrica, com os componentes que pertencem àquela camada. O componente nasce na área clicada, o layout o encaixa
 * na órbita e o campo Nome do inspetor já vem selecionado para digitar.
 */
import { onionPicks, type OnionPick } from "../shared/onion";
import { getState, run, set, toastError, useStore } from "./store";

/** `ref` de um menu de contexto aberto no ponto do clique: perto da borda direita ou de baixo, empurra o menu para dentro
 * da tela. Mede o menu montado e de novo a cada mudança de tamanho (os itens podem mudar logo depois de abrir). */
export function keepInView(el: HTMLElement | null) {
  if (!el) return;
  const x = el.offsetLeft;
  const y = el.offsetTop;
  const fit = () => {
    // mede no canto, com espaço: colado na borda o texto quebraria e o menu pareceria mais estreito do que é. O tamanho
    // é o de layout (offset*), não o da caixa na tela: a animação de abertura ainda está em escala reduzida
    el.style.left = el.style.top = "0px";
    const m = 8;
    el.style.left = `${Math.max(m, Math.min(x, window.innerWidth - el.offsetWidth - m))}px`;
    el.style.top = `${Math.max(m, Math.min(y, window.innerHeight - el.offsetHeight - m))}px`;
  };
  fit();
  const ro = new ResizeObserver(fit);
  ro.observe(el);
  return () => ro.disconnect();
}

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
      ref={keepInView}
      className="glass ctx-menu"
      data-ui
      style={{ left: x, top: y }}
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
