import { useEffect, useMemo, useRef, useState } from "react";
import { normalizeDoc } from "../shared/ops";
import { CONNECTION_TYPES, ENDPOINT_PROTOCOLS, endpointBadge, endpointColor, type Doc } from "../shared/schema";
import { DiagramDefs, Edge, GroupShape, NodeShape, NoteShape, ViewerAssets, computeEdges, computeOwnerLinks, sortedGroups } from "./Canvas";
import { contentBounds } from "./geometry";
import { Glyph } from "./icons";
import { fetchDiagram, openRef, set } from "./store";

type Step = { diagram: string; node?: string };
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const nameOf = (p: string) => p.split("/").pop()?.replace(".archflow.json", "") ?? p;

/**
 * Visualizador (somente leitura) de outro diagrama do cofre, em modal.
 * Clicar numa referência dentro dele carrega o diagrama seguinte no próprio modal;
 * as setas ← → percorrem o histórico de navegação do modal.
 */
export function DiagramViewer({ diagram, node }: { diagram: string; node?: string }) {
  const [hist, setHist] = useState<Step[]>([{ diagram, node }]);
  const [idx, setIdx] = useState(0);
  const cur = hist[idx];
  const [doc, setDoc] = useState<Doc | null>(null);
  const [err, setErr] = useState("");
  const [sel, setSel] = useState<string | null>(null);
  const [view, setView] = useState({ x: 0, y: 0, z: 1 });
  const stage = useRef<HTMLDivElement>(null);
  const drag = useRef<{ sx: number; sy: number; vx: number; vy: number; moved: boolean } | null>(null);

  const fit = (d: Doc) => {
    const el = stage.current;
    if (!el) return;
    const b = contentBounds(d);
    if (!b) return setView({ x: 0, y: 0, z: 1 });
    const r = el.getBoundingClientRect();
    const pad = 44;
    const z = clamp(Math.min((r.width - pad * 2) / b.w, (r.height - pad * 2) / b.h), 0.15, 1.2);
    setView({ z, x: (r.width - b.w * z) / 2 - b.x * z, y: (r.height - b.h * z) / 2 - b.y * z });
  };

  // carrega o diagrama do passo atual
  useEffect(() => {
    let dead = false;
    setDoc(null);
    setErr("");
    setSel(null);
    fetchDiagram(cur.diagram).then(
      (r) => {
        if (dead) return;
        const d = normalizeDoc(r.doc);
        setDoc(d);
        requestAnimationFrame(() => fit(d));
      },
      (e) => !dead && setErr(e instanceof Error ? e.message : String(e)),
    );
    return () => {
      dead = true;
    };
  }, [cur.diagram]);

  const canBack = idx > 0;
  const canFwd = idx < hist.length - 1;
  const go = (d: -1 | 1) => setIdx((i) => clamp(i + d, 0, hist.length - 1));
  const enter = (ref: Step) => {
    if (ref.diagram === cur.diagram) return;
    setHist((h) => [...h.slice(0, idx + 1), ref]);
    setIdx((i) => i + 1);
  };

  // Alt+← / Alt+→ navegam no histórico do modal
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (!e.altKey) return;
      if (e.key === "ArrowLeft") (e.preventDefault(), go(-1));
      if (e.key === "ArrowRight") (e.preventDefault(), go(1));
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  });

  // zoom com a roda, no cursor
  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      setView((v) => {
        const z = clamp(v.z * Math.exp(-e.deltaY * 0.0016), 0.1, 3);
        const mx = e.clientX - r.left;
        const my = e.clientY - r.top;
        return { z, x: mx - ((mx - v.x) / v.z) * z, y: my - ((my - v.y) / v.z) * z };
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const edges = useMemo(() => (doc ? computeEdges(doc) : []), [doc]);
  const links = useMemo(() => (doc ? computeOwnerLinks(doc) : []), [doc]);
  const groups = useMemo(() => (doc ? sortedGroups(doc) : []), [doc]);
  const picked = doc?.nodes.find((n) => n.id === sel);

  const onDown = (e: React.PointerEvent) => {
    drag.current = { sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y, moved: false };
    stage.current?.setPointerCapture(e.pointerId);
  };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.sx;
    const dy = e.clientY - d.sy;
    if (!d.moved && Math.hypot(dx, dy) < 4) return;
    d.moved = true;
    setView((v) => ({ ...v, x: d.vx + dx, y: d.vy + dy }));
  };
  const onUp = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (stage.current?.hasPointerCapture(e.pointerId)) stage.current.releasePointerCapture(e.pointerId);
    if (!d || d.moved || !doc) return;
    const el = (document.elementFromPoint(e.clientX, e.clientY) as Element | null)?.closest("[data-role]") as SVGElement | null;
    const n = el?.dataset.id ? doc.nodes.find((x) => x.id === el.dataset.id) : undefined;
    if (n?.ref && (el?.dataset.role === "open-ref" || el?.dataset.role === "node")) return enter({ diagram: n.ref.diagram, node: n.ref.node });
    setSel(el?.dataset.role === "node" && n ? n.id : null);
  };

  const close = () => set({ modal: null });
  const edit = () => {
    close();
    void openRef(cur.diagram);
  };

  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="glass modal viewer" role="dialog" aria-modal="true" aria-label="Visualizador de diagrama">
        <div className="viewer-head">
          <div className="viewer-nav">
            <button className="btn icon" onClick={() => go(-1)} disabled={!canBack} aria-label="Diagrama anterior" data-tip={canBack ? `Voltar para ${nameOf(hist[idx - 1].diagram)} (Alt+←)` : "Sem diagrama anterior"} data-tip-pos="bottom">
              <Glyph name="arrow-up" size={18} style={{ transform: "rotate(-90deg)" }} />
            </button>
            <button className="btn icon" onClick={() => go(1)} disabled={!canFwd} aria-label="Próximo diagrama" data-tip={canFwd ? `Avançar para ${nameOf(hist[idx + 1].diagram)} (Alt+→)` : "Sem diagrama à frente"} data-tip-pos="bottom">
              <Glyph name="arrow-up" size={18} style={{ transform: "rotate(90deg)" }} />
            </button>
            {hist.length > 1 && (
              <span className="viewer-count" aria-label={`Passo ${idx + 1} de ${hist.length}`}>
                {idx + 1}/{hist.length}
              </span>
            )}
          </div>
          <div className="viewer-title">
            <h2>{doc?.title ?? nameOf(cur.diagram)}</h2>
            <code>{cur.diagram}</code>
          </div>
          <div className="viewer-actions">
            <button className="btn" onClick={() => doc && fit(doc)} disabled={!doc} data-tip="Ajustar à janela" data-tip-pos="bottom">
              <Glyph name="fit" size={16} />
            </button>
            <button className="btn" onClick={edit} data-tip="Abre para edição; use “Voltar” para retornar a este diagrama" data-tip-pos="bottom">
              <Glyph name="edit" size={16} /> Editar
            </button>
            <button className="btn ghost icon" onClick={close} aria-label="Fechar">
              <Glyph name="close" size={19} />
            </button>
          </div>
        </div>

        {hist.length > 1 && (
          <div className="viewer-trail" aria-label="Caminho percorrido">
            {hist.map((h, i) => (
              <button key={i} className={i === idx ? "on" : ""} onClick={() => setIdx(i)}>
                {nameOf(h.diagram)}
              </button>
            ))}
          </div>
        )}

        <div className="viewer-stage" ref={stage} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp}>
          {!doc && !err && <div className="viewer-msg">Carregando diagrama…</div>}
          {err && (
            <div className="viewer-msg warn">
              <b>Não foi possível abrir este diagrama.</b>
              <span>{err}</span>
            </div>
          )}
          {doc && (
            <ViewerAssets.Provider value={doc.customAssets}>
              <svg className="viewer-svg canvas-like" style={{ ["--z" as string]: view.z }}>
                <defs>
                  <DiagramDefs />
                </defs>
                <g transform={`translate(${view.x},${view.y}) scale(${view.z})`}>
                  {groups.map((g) => (
                    <GroupShape key={g.id} g={g} selected={false} hot={false} hovered={false} />
                  ))}
                  {links.map((l) => (
                    <path key={l.id} d={l.d} className="owner-link" />
                  ))}
                  {edges.map(({ c, g }) => (
                    <Edge key={c.id} c={c} d={g.d} mid={g.label ?? g.mid} selected={false} animate />
                  ))}
                  {doc.nodes.map((n) => (
                    <NodeShape key={n.id} n={n} selected={false} hot={cur.node === n.id || sel === n.id} hovered={false} />
                  ))}
                  {doc.notes.map((n) => (
                    <NoteShape key={n.id} n={n} selected={false} />
                  ))}
                </g>
              </svg>
            </ViewerAssets.Provider>
          )}

          {doc && !doc.nodes.length && <div className="viewer-msg">Este diagrama ainda está vazio.</div>}

          {picked && (
            <div className="glass viewer-card" onPointerDown={(e) => e.stopPropagation()} onPointerUp={(e) => e.stopPropagation()}>
              <button className="btn ghost icon sm" style={{ float: "right" }} onClick={() => setSel(null)} aria-label="Fechar detalhes">
                <Glyph name="close" size={14} />
              </button>
              <div className="kicker">{picked.kind}</div>
              <h3>{picked.label}</h3>
              {picked.technology && <p className="muted">{picked.technology}</p>}
              {picked.endpoint && (
                <p>
                  <span className="ep-pill" style={{ background: endpointColor(picked.endpoint) }}>
                    {endpointBadge(picked.endpoint)}
                  </span>{" "}
                  <code>{picked.endpoint.path}</code> <span className="muted">· {ENDPOINT_PROTOCOLS[picked.endpoint.protocol].label}</span>
                </p>
              )}
              {picked.description && <p>{picked.description}</p>}
              {picked.endpoint?.request && (
                <p className="muted">
                  entrada: <code>{picked.endpoint.request}</code>
                </p>
              )}
              {picked.endpoint?.response && (
                <p className="muted">
                  saída: <code>{picked.endpoint.response}</code>
                </p>
              )}
              {doc && (
                <p className="muted">
                  {doc.connections
                    .filter((c) => c.from === picked.id || c.to === picked.id)
                    .map((c) => `${CONNECTION_TYPES[c.type].label}: ${c.from === picked.id ? "→ " + c.to : c.from + " →"}`)
                    .join(" · ")}
                </p>
              )}
            </div>
          )}
        </div>

        <div className="viewer-foot">
          <span>Arraste para mover · roda do mouse para zoom · clique numa referência para entrar nela · <b>Alt+←/→</b> navega no histórico</span>
        </div>
      </div>
    </div>
  );
}
