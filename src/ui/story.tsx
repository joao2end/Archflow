import { useEffect, useMemo, useRef, useState } from "react";
import { DDD_ROLES } from "../shared/schema";
import { buildStories, type Story } from "../shared/story";
import { Glyph } from "./icons";
import { getState, set, useStore } from "./store";
import { fitView } from "./keys";

/* ───────── passo a passo do fluxo de um diagrama de domínio (modo apresentação) ───────── */

const PANEL_W = 400;
const reduced = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
const attr = (id: string) => id.replace(/["\\]/g, "\\$&");
const sel = (role: string, ids: string[]) => ids.map((i) => `svg.canvas [data-role="${role}"][data-id="${attr(i)}"]`).join(",\n");

/** O que fica visível a cada passo: o já percorrido esmaece, o passo atual brilha e as conexões que levaram a ele se animam. */
function storyCss(story: Story, at: number): string {
  const seen = story.steps.slice(0, at);
  const cur = story.steps[at];
  const curNodes = [cur.id, ...cur.extraIds];
  const seenConns = story.steps.slice(0, at + 1).flatMap((s) => s.connIds);
  const rules = [
    `svg.canvas [data-role="node"], svg.canvas [data-role="conn"], svg.canvas [data-role="note"] { opacity: .09; transition: opacity .35s ease, filter .35s ease; }`,
    seen.length ? `${sel("node", seen.map((s) => s.id))} { opacity: .55; }` : "",
    seenConns.length ? `${sel("conn", seenConns)} { opacity: .5; }` : "",
    `${sel("node", curNodes)} { opacity: 1; filter: drop-shadow(0 0 14px var(--story-glow)); }`,
    cur.extraIds.length ? `${sel("node", cur.extraIds)} { filter: none; opacity: .85; }` : "",
    cur.connIds.length ? `${sel("conn", cur.connIds)} { opacity: 1; }` : "",
    cur.connIds.length && !reduced() ? `${cur.connIds.map((i) => `svg.canvas [data-role="conn"][data-id="${attr(i)}"] path[id]`).join(",\n")} { stroke-dasharray: 9 7 !important; stroke-width: 3.4px !important; opacity: 1 !important; animation: story-dash .7s linear infinite; }` : "",
  ];
  return rules.filter(Boolean).join("\n");
}

let raf = 0;
/** Leva a câmera até as caixas, deixando livre a faixa do painel. */
function moveCameraTo(boxes: { x: number; y: number; w: number; h: number }[]) {
  const el = document.querySelector("svg.canvas") as SVGSVGElement | null;
  if (!el || !boxes.length) return;
  const r = el.getBoundingClientRect();
  const x1 = Math.min(...boxes.map((b) => b.x));
  const y1 = Math.min(...boxes.map((b) => b.y));
  const x2 = Math.max(...boxes.map((b) => b.x + b.w));
  const y2 = Math.max(...boxes.map((b) => b.y + b.h));
  const left = 70;
  const right = r.width < 760 ? 40 : PANEL_W + 56;
  const aw = Math.max(240, r.width - left - right);
  const ah = Math.max(200, r.height - 150 - 110);
  const z = Math.min(1.15, Math.max(0.25, Math.min(aw / (x2 - x1), ah / (y2 - y1))));
  const to = { z, x: left + (aw - (x2 - x1) * z) / 2 - x1 * z, y: 150 + (ah - (y2 - y1) * z) / 2 - y1 * z };
  const from = getState().view;
  cancelAnimationFrame(raf);
  if (reduced()) return set({ view: to });
  const t0 = performance.now();
  const tick = (t: number) => {
    const k = Math.min(1, (t - t0) / 520);
    const e = 1 - Math.pow(1 - k, 3);
    set({ view: { z: from.z + (to.z - from.z) * e, x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e } });
    if (k < 1) raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
}

export function StoryPanel() {
  const doc = useStore((s) => s.doc);
  const stories = useMemo(() => buildStories(doc), [doc]);
  const [open, setOpen] = useState(true);
  const [si, setSi] = useState(0);
  const [at, setAt] = useState(0);
  const [playing, setPlaying] = useState(false);
  const story: Story | undefined = stories[Math.min(si, stories.length - 1)];
  const idx = story ? Math.min(at, story.steps.length - 1) : 0;
  const step = story?.steps[idx];
  const bodyRef = useRef<HTMLDivElement>(null);

  const go = (n: number) => story && setAt(Math.max(0, Math.min(story.steps.length - 1, n)));

  /* destaque no quadro */
  useEffect(() => {
    if (!open || !story || !step) return;
    const style = document.createElement("style");
    style.dataset.story = "";
    style.textContent = storyCss(story, idx);
    document.head.appendChild(style);
    return () => style.remove();
  }, [open, story, idx]);

  /* a câmera acompanha o passo; o anterior entra no quadro para dar contexto */
  useEffect(() => {
    if (!open || !story || !step) return;
    const ids = new Set([step.id, ...step.extraIds, ...(idx > 0 ? [story.steps[idx - 1].id] : [])]);
    moveCameraTo(getState().doc.nodes.filter((n) => ids.has(n.id)));
  }, [open, story?.id, idx]);
  useEffect(() => () => cancelAnimationFrame(raf), []);
  useEffect(() => {
    if (!open) fitView();
  }, [open]);

  useEffect(() => {
    setAt(0);
    setPlaying(false);
  }, [story?.id]);
  useEffect(() => {
    bodyRef.current?.scrollTo({ top: 0 });
  }, [idx, story?.id]);

  /* reprodução automática */
  useEffect(() => {
    if (!playing || !story) return;
    if (idx >= story.steps.length - 1) return setPlaying(false);
    const id = setTimeout(() => go(idx + 1), 7000);
    return () => clearTimeout(id);
  }, [playing, idx, story?.id]);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest?.("input,textarea,select") || e.ctrlKey || e.metaKey) return;
      const k = e.key;
      if (k === "s" || k === "S") return setOpen((o) => !o);
      if (!open) return;
      if (k === "ArrowRight" || k === "ArrowDown" || k === "PageDown") (e.preventDefault(), setPlaying(false), go(idx + 1));
      else if (k === "ArrowLeft" || k === "ArrowUp" || k === "PageUp") (e.preventDefault(), setPlaying(false), go(idx - 1));
      else if (k === "Home") (e.preventDefault(), go(0));
      else if (k === "End") (e.preventDefault(), story && go(story.steps.length - 1));
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });

  if (!story || !step) return null;
  const color = step.role === "actor" ? "#6c7a89" : step.role === "context" ? "#706fd3" : DDD_ROLES[step.role].color;
  const last = idx >= story.steps.length - 1;

  if (!open)
    return (
      <button className="btn glass story-pill" onClick={() => setOpen(true)} data-tip="Mostrar o passo a passo (S)" data-tip-pos="left">
        <Glyph name="play" size={16} /> Passo a passo
      </button>
    );

  return (
    <aside className="glass story-panel" style={{ ["--story-color" as string]: color }} role="region" aria-label="Passo a passo do fluxo">
      <header className="story-head">
        <div className="story-pick">
          <span className="story-kicker">Fluxo{stories.length > 1 ? ` · ${stories.length} casos de uso` : ""}</span>
          {stories.length > 1 ? (
            <select value={story.id} onChange={(e) => setSi(stories.findIndex((s) => s.id === e.target.value))} aria-label="Escolher o caso de uso">
              {stories.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title}
                </option>
              ))}
            </select>
          ) : (
            <b>{story.title}</b>
          )}
        </div>
        <button className="btn ghost icon" onClick={() => setOpen(false)} aria-label="Ocultar o passo a passo" data-tip="Ocultar (S)" data-tip-pos="left">
          <Glyph name="close" size={16} />
        </button>
      </header>
      {story.goal && <p className="story-goal">Objetivo: {story.goal}</p>}

      <div className="story-progress" role="group" aria-label={`Passo ${idx + 1} de ${story.steps.length}`}>
        {story.steps.map((s, i) => (
          <button key={s.id} className={i === idx ? "on" : i < idx ? "done" : ""} onClick={() => (setPlaying(false), go(i))} aria-label={`Ir ao passo ${i + 1}: ${s.title}`} aria-current={i === idx ? "step" : undefined} title={`${i + 1}. ${s.title}`} />
        ))}
      </div>

      <div className="story-body" ref={bodyRef} aria-live="polite">
        <div className="story-title">
          <span className="story-badge">{step.roleLabel}</span>
          {step.context && <span className="story-ctx">{step.context}</span>}
          <span className="story-n">
            {idx + 1}/{story.steps.length}
          </span>
        </div>
        <h2>{step.title}</h2>
        {step.because && <p className="story-because">↳ {step.because}</p>}

        <section>
          <h3>O que é</h3>
          <p>{step.what}</p>
          {step.details.length > 0 && (
            <dl>
              {step.details.map((d) => (
                <div key={d.label}>
                  <dt>{d.label}</dt>
                  <dd>{d.text}</dd>
                </div>
              ))}
            </dl>
          )}
        </section>
        {step.properties.length > 0 && (
          <section>
            <h3>{step.role === "command" ? "Parâmetros" : step.role === "domain-event" ? "Campos do evento" : step.role === "read-model" ? "Colunas" : "Propriedades"}</h3>
            <table className="story-props">
              <tbody>
                {step.properties.map((p) => (
                  <tr key={p.name}>
                    <th scope="row">
                      {p.name}
                      {p.key && <span className="sp-key" title="identificador"> #</span>}
                      {p.optional && <span className="sp-opt" title="opcional">?</span>}
                    </th>
                    <td className="sp-type">{p.type ?? ""}</td>
                    <td>
                      {p.description}
                      {p.example && <em className="sp-ex"> ex.: {p.example}</em>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}
        <section>
          <h3>Por que está aqui</h3>
          <p>{step.why}</p>
        </section>
        {step.rules.length > 0 && (
          <section>
            <h3>Regras que sempre valem</h3>
            <ul>
              {step.rules.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </section>
        )}
        {step.branches.length > 0 && (
          <section>
            <h3>Caminhos a seguir</h3>
            <ul>
              {step.branches.map((b, i) => (
                <li key={i}>
                  <b>{b.text}</b> → {b.toLabel}
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      <footer className="story-nav">
        <button className="btn sm" onClick={() => (setPlaying(false), go(idx - 1))} disabled={idx === 0} aria-label="Passo anterior" data-tip="Anterior (←)" data-tip-pos="top">
          ← Anterior
        </button>
        <button className="btn ghost icon" onClick={() => setPlaying((p) => !p)} disabled={last} aria-label={playing ? "Pausar a reprodução" : "Reproduzir automaticamente"} aria-pressed={playing} data-tip={playing ? "Pausar" : "Reproduzir sozinho (7 s por passo)"} data-tip-pos="top">
          <Glyph name={playing ? "pause" : "play"} size={17} />
        </button>
        <button className="btn sm primary" onClick={() => (setPlaying(false), last ? go(0) : go(idx + 1))} aria-label={last ? "Recomeçar" : "Próximo passo"} data-tip={last ? "Recomeçar" : "Próximo (→)"} data-tip-pos="top">
          {last ? "↺ Recomeçar" : "Próximo →"}
        </button>
      </footer>
    </aside>
  );
}
