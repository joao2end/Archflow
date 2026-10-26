import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { LESSONS, codeRegion, lessonCodePath, lessonOfDoc, type Lesson } from "../shared/lessons";
import { orbitLook } from "../shared/onion";
import type { Doc } from "../shared/schema";
import { Glyph } from "./icons";
import { renderMarkdown } from "./markdown";
import { cancelCamera, moveCameraTo, spotlightCss } from "./story";
import { exampleCatalog, getState, installExample, select, set, useStore, type Spotlight3D } from "./store";
import { exitIso } from "./iso";

/* ───────── aula de DDD: cada passo acende peças do diagrama (2D e 3D) e mostra o código TypeScript delas ───────── */

/** O código das aulas (`examples/aulas-ddd/<aula>/codigo/`), como texto: pequeno, vai junto no pacote. */
const SOURCES = import.meta.glob<string>("../../examples/aulas-ddd/*/codigo/**/*.ts", { query: "?raw", import: "default", eager: true });
const source = (l: Lesson, file: string) => SOURCES[`../../examples/${lessonCodePath(l, file)}`];

/** O que o passo destaca: componentes, contextos e as conexões entre os componentes destacados. */
function stepFocus(doc: Doc, l: Lesson, at: number) {
  const ids = new Set(l.steps[at].focus);
  const nodes = doc.nodes.filter((n) => ids.has(n.id)).map((n) => n.id);
  const groups = doc.groups.filter((g) => ids.has(g.id)).map((g) => g.id);
  const inStep = new Set(nodes);
  const conns = doc.connections.filter((c) => inStep.has(c.from) && inStep.has(c.to)).map((c) => c.id);
  const seen = new Set(l.steps.slice(0, at).flatMap((s) => s.focus));
  const seenNodes = doc.nodes.filter((n) => seen.has(n.id) && !inStep.has(n.id)).map((n) => n.id);
  return { nodes, groups, conns, seenNodes };
}

export function LessonPanel() {
  const doc = useStore((s) => s.doc);
  const open = useStore((s) => s.lessonOpen);
  const iso = useStore((s) => s.iso);
  /** com seleção o inspetor ocupa a direita: a aula vira a pílula e volta quando a seleção sai (um painel por vez) */
  const yielded = useStore((s) => s.sel.length > 0);
  const lesson = lessonOfDoc(doc);
  const [at, setAt] = useState(0);
  const [busy, setBusy] = useState(false);
  /** painel largo: o código cabe sem rolar para o lado */
  const [wide, setWide] = useState(false);
  const panelRef = useRef<HTMLElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setAt(0);
  }, [lesson?.id]);
  useEffect(() => {
    bodyRef.current?.scrollTo({ top: 0 });
  }, [at, lesson?.id]);

  const idx = lesson ? Math.min(at, lesson.steps.length - 1) : 0;
  const focus = useMemo(() => (lesson ? stepFocus(doc, lesson, idx) : null), [doc, lesson, idx]);
  /** o destaque só muda quando muda o que ele mostra (editar o diagrama não faz a câmera voar de novo) */
  const focusKey = focus && JSON.stringify(focus);

  /* destaque: no 2D um CSS sobre o canvas; no 3D o mesmo passo vai para o store (só componentes: um contexto mostra tudo) */
  useEffect(() => {
    if (!open || !focus) return;
    const style = document.createElement("style");
    style.dataset.lesson = "";
    style.textContent = spotlightCss({ dim: focus.nodes.length ? ["node", "conn", "note"] : [], nodes: focus.nodes, groups: focus.groups, conns: focus.conns, seenNodes: focus.seenNodes });
    document.head.appendChild(style);
    const spot: Spotlight3D | null = focus.nodes.length ? { nodes: focus.nodes, extras: [], seenNodes: focus.seenNodes, conns: focus.conns, seenConns: [] } : null;
    set({ spotlight: spot });
    return () => {
      style.remove();
      set({ spotlight: null });
    };
  }, [open, focusKey]);

  /* no 2D a câmera vai até as peças do passo (no 3D a própria cena enquadra) */
  useEffect(() => {
    if (!open || !focus || getState().iso) return;
    const ids = new Set([...focus.nodes, ...focus.groups]);
    const d = getState().doc;
    moveCameraTo([...d.nodes, ...d.groups].filter((e) => ids.has(e.id)), panelRef.current?.offsetWidth);
  }, [open, lesson?.id, idx, iso, wide]);
  /* no 3D, a cena volta a se centrar no espaço livre quando o painel muda de largura */
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      const spot = getState().spotlight;
      if (getState().iso && spot) set({ spotlight: { ...spot } });
    });
    return () => cancelAnimationFrame(id);
  }, [wide]);
  useEffect(() => () => cancelCamera(), []);

  if (!lesson || !focus) return null;
  if (open && yielded)
    return (
      <button className="btn glass lesson-pill beside-insp" onClick={() => select([])} data-tip="Voltar para a aula (fecha as propriedades)" data-tip-pos="left">
        <Glyph name="play" size={15} /> Aula {lesson.n}
      </button>
    );
  if (!open)
    return (
      <button className="btn glass lesson-pill" onClick={() => set({ lessonOpen: true })} data-tip="Mostrar a aula" data-tip-pos="left">
        <Glyph name="play" size={15} /> Aula {lesson.n}
      </button>
    );

  const step = lesson.steps[idx];
  const last = idx === lesson.steps.length - 1;
  const next = LESSONS.find((l) => l.n === lesson.n + 1);
  const code = step.code ? codeRegion(source(lesson, step.code.file) ?? "", step.code.region) : undefined;
  const go = (n: number) => setAt(Math.max(0, Math.min(lesson.steps.length - 1, n)));
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "ArrowRight") (e.preventDefault(), e.stopPropagation(), go(idx + 1));
    else if (e.key === "ArrowLeft") (e.preventDefault(), e.stopPropagation(), go(idx - 1));
  };
  const openNext = async () => {
    const ex = next && exampleCatalog.find((e) => e.lesson === next.id);
    if (!ex) return;
    setBusy(true);
    await installExample(ex);
    setBusy(false);
  };
  const groups = doc.groups.filter((g) => focus.groups.includes(g.id));
  const nodes = focus.nodes.map((id) => doc.nodes.find((n) => n.id === id)!);

  return (
    <aside ref={panelRef} className={`glass lesson-panel${wide ? " wide" : ""}`} role="region" aria-label={`Aula ${lesson.n}: ${lesson.title}`} onKeyDown={onKey}>
      <header className="lesson-head">
        <div className="lesson-titles">
          <span className="story-kicker">
            Aula {lesson.n} de {LESSONS.length} · DDD em TypeScript
          </span>
          <b>{lesson.title}</b>
        </div>
        <button className={`btn ghost icon sm${wide ? " active" : ""}`} onClick={() => setWide((w) => !w)} aria-pressed={wide} aria-label={wide ? "Estreitar o painel" : "Alargar o painel"} data-tip={wide ? "Estreitar" : "Alargar (o código cabe inteiro)"} data-tip-pos="bottom">
          <Glyph name="code" size={14} />
        </button>
        <button className={`btn ghost sm${iso ? " active" : ""}`} onClick={() => (iso ? exitIso() : set({ iso: true }))} aria-pressed={iso} data-tip={iso ? "Ver em 2D" : "Ver nas camadas 3D"} data-tip-pos="bottom">
          {iso ? "2D" : "3D"}
        </button>
        <button className="btn ghost icon sm" onClick={() => set({ lessonOpen: false })} aria-label="Recolher a aula" data-tip="Recolher" data-tip-pos="bottom">
          <Glyph name="close" size={14} />
        </button>
      </header>

      <div className="story-progress lesson-progress" role="tablist" aria-label="Passos da aula">
        {lesson.steps.map((s, i) => (
          <button key={i} role="tab" aria-selected={i === idx} aria-label={`Passo ${i + 1}: ${s.title}`} className={i === idx ? "on" : i < idx ? "done" : ""} onClick={() => go(i)} />
        ))}
      </div>

      <div className="lesson-body" ref={bodyRef}>
        <h2>
          <small>{idx + 1}.</small> {step.title}
        </h2>
        <div className="note-md lesson-text" dangerouslySetInnerHTML={{ __html: renderMarkdown(step.text) }} />

        <div className="lesson-pieces" aria-label="Peças destacadas no diagrama">
          {groups.map((g) => (
            <span key={g.id} className="lesson-piece ctx">
              <i>CTX</i> {g.label}
            </span>
          ))}
          {nodes.map((n) => {
            const look = orbitLook(n);
            return (
              <button key={n.id} className="lesson-piece" style={{ ["--rc" as string]: look.color }} onClick={() => select([n.id])} data-tip={`${look.role}: selecionar no diagrama`} data-tip-pos="top">
                <i>{look.badge}</i> {n.label}
              </button>
            );
          })}
        </div>

        {step.code && (
          <figure className="lesson-code">
            <figcaption>
              <Glyph name="file" size={13} /> codigo/{step.code.file}
            </figcaption>
            {code !== undefined ? <div className="note-md" dangerouslySetInnerHTML={{ __html: renderMarkdown("```ts\n" + code + "\n```") }} /> : <p className="callout warn">Trecho «{step.code.region}» não encontrado.</p>}
          </figure>
        )}

        {last && (
          <section className="lesson-practice">
            <h3>Para praticar</h3>
            <ul>
              {lesson.exercises.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          </section>
        )}
      </div>

      <footer className="lesson-foot">
        <button className="btn ghost sm" onClick={() => go(idx - 1)} disabled={idx === 0}>
          ← Anterior
        </button>
        <button className="btn ghost sm" onClick={() => set({ modal: { type: "domain", tab: "code" } })} data-tip="O esqueleto que o Archflow gera deste diagrama" data-tip-pos="top">
          Esqueleto gerado
        </button>
        {!last ? (
          <button className="btn primary sm" onClick={() => go(idx + 1)}>
            Próximo →
          </button>
        ) : next ? (
          <button className="btn primary sm" onClick={() => void openNext()} disabled={busy}>
            {busy ? "Abrindo…" : `Aula ${next.n} →`}
          </button>
        ) : (
          <button className="btn primary sm" onClick={() => set({ panel: "files", examples: { open: true, tab: "domain" } })}>
            Modelos completos
          </button>
        )}
      </footer>
    </aside>
  );
}
