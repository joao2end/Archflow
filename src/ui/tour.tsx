import { useEffect, useMemo, useRef, useState } from "react";
import type { Doc } from "../shared/schema";
import { buildTour, type Tour, type TourCard, type TourSlide } from "../shared/tour";
import { Glyph } from "./icons";
import { moveCameraTo, spotlightCss, cancelCamera } from "./story";
import { getState, set, useStore, type Spotlight3D } from "./store";

/* ───────── roteiro de apresentação de um diagrama de arquitetura ───────── */

const reduced = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

function slideCss(slide: TourSlide): string {
  return spotlightCss({
    dim: ["node", "group", "note", "conn"],
    nodes: slide.spotlight.nodes,
    groups: slide.spotlight.groups,
    notes: slide.spotlight.notes,
    conns: slide.spotlight.conns,
  });
}

/**
 * O passo para a visão 3D: os componentes do passo (um grupo em foco conta pelos componentes de dentro), as conexões e
 * o que os passos anteriores já mostraram. A visão geral não destaca nada.
 */
function tourSpotlight(doc: Doc, tour: Tour, idx: number): Spotlight3D | null {
  const slide = tour.slides[idx];
  if (!slide || slide.overview) return null;
  const parents = new Map(doc.groups.map((g) => [g.id, g.parent]));
  const inGroup = (parent: string | undefined, groups: Set<string>) => {
    for (let p = parent, k = 0; p && k < 20; p = parents.get(p), k++) if (groups.has(p)) return true;
    return false;
  };
  const nodesOf = (s: TourSlide) => {
    const groups = new Set(s.spotlight.groups);
    return [...new Set([...s.spotlight.nodes, ...doc.nodes.filter((n) => inGroup(n.parent, groups)).map((n) => n.id)])];
  };
  const before = tour.slides.slice(0, idx);
  const nodes = nodesOf(slide);
  // passo só de notas: no 3D não há o que destacar, fica a cena inteira
  if (!nodes.length && !slide.spotlight.conns.length) return null;
  return {
    nodes,
    extras: [],
    seenNodes: before.flatMap(nodesOf),
    conns: slide.spotlight.conns,
    seenConns: before.flatMap((s) => s.spotlight.conns),
  };
}

export function TourPanel() {
  const doc = useStore((s) => s.doc);
  const tour = useMemo(() => buildTour(doc), [doc]);
  /** o painel com o texto do slide: oculto ao apresentar (o roteiro continua andando e destacando); S ou a pílula mostram */
  const [shown, setShown] = useState(false);
  const [at, setAt] = useState(0);
  const [playing, setPlaying] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const sig = tour.slides.map((s) => s.id).join("|");
  const slide = tour.slides[Math.min(at, tour.slides.length - 1)];
  const idx = slide ? tour.slides.indexOf(slide) : 0;

  const go = (n: number) => setAt(Math.max(0, Math.min(tour.slides.length - 1, n)));

  useEffect(() => {
    setAt(0);
    setPlaying(false);
  }, [sig]);

  useEffect(() => {
    if (!slide || slide.overview) return;
    const style = document.createElement("style");
    style.dataset.story = "";
    style.textContent = slideCss(slide);
    document.head.appendChild(style);
    return () => style.remove();
  }, [slide, idx]);

  /* na visão 3D o passo vai para o store: a cena destaca, desenha as conexões do passo e leva a câmera até ele */
  useEffect(() => {
    if (!slide) return;
    set({ spotlight: tourSpotlight(getState().doc, tour, idx) });
    return () => set({ spotlight: null });
  }, [sig, idx]);

  useEffect(() => {
    if (!slide?.boxes.length || getState().iso) return;
    moveCameraTo(slide.boxes);
  }, [sig, idx]);

  useEffect(() => () => cancelCamera(), []);
  useEffect(() => {
    bodyRef.current?.scrollTo({ top: 0 });
  }, [idx, sig]);

  useEffect(() => {
    if (!playing || !slide) return;
    if (idx >= tour.slides.length - 1) return setPlaying(false);
    const id = setTimeout(() => go(idx + 1), 7000);
    return () => clearTimeout(id);
  }, [playing, idx, sig]);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest?.("input,textarea,select,[contenteditable]") || e.ctrlKey || e.metaKey) return;
      const k = e.key;
      if (k === "s" || k === "S") return setShown((o) => !o);
      if (k === "ArrowRight" || k === "ArrowDown" || k === "PageDown") (e.preventDefault(), setPlaying(false), go(idx + 1));
      else if (k === "ArrowLeft" || k === "ArrowUp" || k === "PageUp") (e.preventDefault(), setPlaying(false), go(idx - 1));
      else if (k === "Home") (e.preventDefault(), setPlaying(false), go(0));
      else if (k === "End") (e.preventDefault(), setPlaying(false), go(tour.slides.length - 1));
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });

  if (!slide) return null;
  const last = idx >= tour.slides.length - 1;

  if (!shown)
    return (
      <button className="btn glass story-pill" onClick={() => setShown(true)} data-tip="Mostrar o texto do roteiro (S) · setas avançam" data-tip-pos="left">
        <Glyph name="play" size={16} /> Roteiro {idx + 1}/{tour.slides.length}
      </button>
    );

  return (
    <aside className="glass story-panel" style={{ ["--story-color" as string]: "#706fd3" }} role="region" aria-label="Roteiro de apresentação">
      <header className="story-head">
        <div className="story-pick">
          <span className="story-kicker">{tour.auto ? "Roteiro automático" : "Apresentação"}</span>
          <b>{tour.title}</b>
        </div>
        <button className="btn ghost icon" onClick={() => setShown(false)} aria-label="Ocultar o roteiro" data-tip="Ocultar (S)" data-tip-pos="left">
          <Glyph name="close" size={16} />
        </button>
      </header>

      <div className="story-progress" role="group" aria-label={`Passo ${idx + 1} de ${tour.slides.length}`}>
        {tour.slides.map((s, i) => (
          <button key={s.id} className={i === idx ? "on" : i < idx ? "done" : ""} onClick={() => (setPlaying(false), go(i))} aria-label={`Ir ao passo ${i + 1}: ${s.title}`} aria-current={i === idx ? "step" : undefined} title={`${i + 1}. ${s.title}`} />
        ))}
      </div>

      <div className="story-body" ref={bodyRef} aria-live="polite">
        <div className="story-title">
          <span className="story-n">
            {idx + 1}/{tour.slides.length}
          </span>
        </div>
        <h2>{slide.title}</h2>
        {slide.text && <p>{slide.text}</p>}
        {slide.cards.map((card) => (
          <TourCardView key={card.id} card={card} narrative={slide.text} slideTitle={slide.title} />
        ))}
      </div>

      <footer className="story-nav">
        <button className="btn sm" onClick={() => (setPlaying(false), go(idx - 1))} disabled={idx === 0} aria-label="Passo anterior" data-tip="Anterior (←)" data-tip-pos="top">
          ← Anterior
        </button>
        <button className="btn ghost icon" onClick={() => setPlaying((p) => !p)} disabled={last} aria-label={playing ? "Pausar a reprodução" : "Reproduzir automaticamente"} aria-pressed={playing} data-tip={playing ? "Pausar" : reduced() ? "Reproduzir" : "Reproduzir sozinho (7 s por passo)"} data-tip-pos="top">
          <Glyph name={playing ? "pause" : "play"} size={17} />
        </button>
        <button className="btn sm primary" onClick={() => (setPlaying(false), last ? go(0) : go(idx + 1))} aria-label={last ? "Recomeçar" : "Próximo passo"} data-tip={last ? "Recomeçar" : "Próximo (→)"} data-tip-pos="top">
          {last ? "↺ Recomeçar" : "Próximo →"}
        </button>
      </footer>
    </aside>
  );
}

function TourCardView({ card, narrative, slideTitle }: { card: TourCard; narrative?: string; slideTitle: string }) {
  const responsibility = card.role !== "connection" && card.responsibility && card.responsibility !== narrative ? card.responsibility : undefined;
  const noteBody = card.noteText && card.noteText !== card.title ? card.noteText : undefined;
  return (
    <article className="tour-card">
      <div className="story-title">
        <span className="story-badge">{card.roleLabel}</span>
        {card.context && <span className="story-ctx">{card.context}</span>}
      </div>
      {card.title !== slideTitle && <h2>{card.title}</h2>}
      {card.technology && (
        <p className="tour-meta">
          <b>Tecnologia.</b> {card.technology}
        </p>
      )}
      {responsibility && (
        <section>
          <h3>Responsabilidade</h3>
          <p>{responsibility}</p>
        </section>
      )}
      {card.endpoints.length > 0 && (
        <section>
          <h3>Interfaces expostas</h3>
          <ul>
            {card.endpoints.map((e) => (
              <li key={e.id}>
                <b>{e.label}</b> · {e.protocol}
                {e.auth ? ` · auth: ${e.auth}` : ""}
                {e.request ? ` · entrada: ${e.request}` : ""}
                {e.response ? ` · saída: ${e.response}` : ""}
                {e.description ? ` — ${e.description}` : ""}
              </li>
            ))}
          </ul>
        </section>
      )}
      {card.role === "connection" && (
        <section>
          <h3>Conexão</h3>
          <p className="tour-route">{card.route}</p>
          {card.protocol && (
            <p>
              <b>Protocolo.</b> {card.protocol}
            </p>
          )}
          {card.responsibility && card.responsibility !== narrative && <p>{card.responsibility}</p>}
          {card.iface && (
            <div>
              <h3>Contrato</h3>
              <p>
                <b>{card.iface.name}</b> ({card.iface.kind})
                {card.iface.contract ? ` · ${card.iface.contract}` : ""}
              </p>
              {card.iface.operations.length > 0 && (
                <ul>
                  {card.iface.operations.map((o) => (
                    <li key={o.name}>
                      <b>{o.name}</b>
                      {o.signature ? ` — ${o.signature}` : ""}
                      {o.request ? ` · req: ${o.request}` : ""}
                      {o.response ? ` · res: ${o.response}` : ""}
                      {o.description ? ` · ${o.description}` : ""}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </section>
      )}
      {card.role === "note" && noteBody && (
        <section>
          <h3>Nota</h3>
          <p className="tour-note">{noteBody}</p>
        </section>
      )}
      {card.props.length > 0 && (
        <section>
          <h3>Propriedades</h3>
          <table className="story-props">
            <tbody>
              {card.props.map((p) => (
                <tr key={p.key}>
                  <th scope="row">{p.key}</th>
                  <td>{p.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </article>
  );
}
