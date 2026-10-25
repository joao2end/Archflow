import { useMemo, useRef } from "react";
import { docMode } from "../shared/schema";
import { validateDetailed } from "../shared/ops";
import { set, useStore } from "./store";

const W = 176;
const H = 112;
const PAD = 6;

/** Minimapa: mostra o diagrama inteiro e a área visível; clicar ou arrastar leva a tela até ali. */
export function Minimap() {
  const doc = useStore((s) => s.doc);
  const view = useStore((s) => s.view);
  const sel = useStore((s) => s.sel);
  const dragging = useRef(false);
  // nós com problema de validação (Domain/Logic) aparecem em vermelho/âmbar: o mapa mostra ONDE olhar, não só onde a tela está
  const flagged = useMemo(() => {
    const m = new Map<string, "erro" | "aviso">();
    if (docMode(doc) === "architecture") return m;
    for (const i of validateDetailed(doc)) {
      if (!i.target) continue;
      if (i.severity === "erro" || !m.has(i.target)) m.set(i.target, i.severity === "erro" ? "erro" : "aviso");
    }
    return m;
  }, [doc]);
  const boxes = [...doc.groups, ...doc.nodes, ...doc.notes];
  if (!boxes.length || sel.length) return null; // com seleção, o inspetor ocupa este canto

  const x1 = Math.min(...boxes.map((b) => b.x));
  const y1 = Math.min(...boxes.map((b) => b.y));
  const x2 = Math.max(...boxes.map((b) => b.x + b.w));
  const y2 = Math.max(...boxes.map((b) => b.y + b.h));
  // área visível em coordenadas do quadro
  const vx = -view.x / view.z;
  const vy = -view.y / view.z;
  const vw = window.innerWidth / view.z;
  const vh = window.innerHeight / view.z;
  const fits = vx <= x1 && vy <= y1 && vx + vw >= x2 && vy + vh >= y2;
  if (fits) return null; // tudo já está à vista

  // o mapa cobre o diagrama e a janela atual, para o retângulo da vista nunca sair dele
  const mx1 = Math.min(x1, vx);
  const my1 = Math.min(y1, vy);
  const mx2 = Math.max(x2, vx + vw);
  const my2 = Math.max(y2, vy + vh);
  const k = Math.min((W - PAD * 2) / (mx2 - mx1), (H - PAD * 2) / (my2 - my1));
  const ox = (W - (mx2 - mx1) * k) / 2 - mx1 * k;
  const oy = (H - (my2 - my1) * k) / 2 - my1 * k;

  const goTo = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const wx = (e.clientX - r.left - ox) / k;
    const wy = (e.clientY - r.top - oy) / k;
    set({ view: { z: view.z, x: window.innerWidth / 2 - wx * view.z, y: window.innerHeight / 2 - wy * view.z } });
  };

  return (
    <div className="glass minimap" role="group" aria-label={`Minimapa do diagrama${flagged.size ? ` (${flagged.size} ${flagged.size === 1 ? "componente com problema marcado" : "componentes com problema marcados"})` : ""}. Clique ou arraste para ir até uma região; com o foco aqui, as setas movem a vista.`}>
      <svg
        width={W}
        height={H}
        tabIndex={0}
        aria-label="Área visível do diagrama"
        onKeyDown={(e) => {
          // setas movem a vista em passos de 20% da tela (Shift = 60%); o mouse não é o único jeito de navegar
          const dx = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
          const dy = e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : 0;
          if (!dx && !dy) return;
          e.preventDefault();
          e.stopPropagation(); // o atalho global das setas empurraria o item selecionado
          const f = e.shiftKey ? 0.6 : 0.2;
          set({ view: { z: view.z, x: view.x - dx * window.innerWidth * f, y: view.y - dy * window.innerHeight * f } });
        }}
        onPointerDown={(e) => {
          dragging.current = true;
          e.currentTarget.setPointerCapture(e.pointerId);
          goTo(e);
        }}
        onPointerMove={(e) => dragging.current && goTo(e)}
        onPointerUp={() => (dragging.current = false)}
        onPointerCancel={() => (dragging.current = false)}
      >
        {doc.groups.map((g) =>
          g.ring ? (
            g.ring.frame ? null : <circle key={g.id} cx={(g.x + g.w / 2) * k + ox} cy={(g.y + g.h / 2) * k + oy} r={(Math.min(g.w, g.h) / 2) * k} className="mm-group" />
          ) : (
            <rect key={g.id} x={g.x * k + ox} y={g.y * k + oy} width={g.w * k} height={g.h * k} rx={2} className="mm-group" />
          ),
        )}
        {doc.nodes.map((n) => (
          <rect key={n.id} x={n.x * k + ox} y={n.y * k + oy} width={Math.max(flagged.has(n.id) ? 4 : 2, n.w * k)} height={Math.max(flagged.has(n.id) ? 4 : 2, n.h * k)} rx={1} className={`mm-node${flagged.get(n.id) === "erro" ? " err" : flagged.get(n.id) === "aviso" ? " warn" : ""}`} />
        ))}
        {doc.notes.map((n) => (
          <rect key={n.id} x={n.x * k + ox} y={n.y * k + oy} width={Math.max(2, n.w * k)} height={Math.max(2, n.h * k)} rx={1} className="mm-note" />
        ))}
        <rect x={vx * k + ox} y={vy * k + oy} width={vw * k} height={vh * k} rx={2} className="mm-view" />
      </svg>
    </div>
  );
}
