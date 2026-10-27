import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { firstStepIn, guideOfDoc, type GuideStep } from "../shared/guides";
import { LESSONS, codeRegion, lessonCodePath, type Lesson } from "../shared/lessons";
import { orbitLook } from "../shared/onion";
import { LOGIC_ROLES, docMode, type Doc, type NodeEl } from "../shared/schema";
import { builtUpTo, opsToBuild } from "../shared/logic.lessons";
import { Glyph } from "./icons";
import { renderMarkdown } from "./markdown";
import { cancelCamera, moveCameraTo, spotlightCss } from "./story";
import { exampleCatalog, getState, installExample, openDiagram, openExamples, run, select, set, useStore, type Spotlight3D } from "./store";
import { exitIso } from "./iso";

/* ───────── painel de aula: cada passo acende peças do diagrama (2D e 3D) e explica; nas aulas de DDD em TypeScript, mostra também o código ───────── */

/** O código das aulas (`examples/aulas-ddd/<aula>/codigo/`), como texto: pequeno, vai junto no pacote. */
const SOURCES = import.meta.glob<string>("../../examples/aulas-ddd/*/codigo/**/*.ts", { query: "?raw", import: "default", eager: true });
const source = (l: Lesson, file: string) => SOURCES[`../../examples/${lessonCodePath(l, file)}`];

/** O que o passo destaca: componentes, grupos e as conexões entre os componentes destacados (os passos anteriores ficam «vistos»). */
function stepFocus(doc: Doc, steps: GuideStep[], at: number) {
  const ids = new Set(steps[at].focus);
  const nodes = doc.nodes.filter((n) => ids.has(n.id)).map((n) => n.id);
  const groups = doc.groups.filter((g) => ids.has(g.id)).map((g) => g.id);
  const inStep = new Set(nodes);
  const conns = doc.connections.filter((c) => inStep.has(c.from) && inStep.has(c.to)).map((c) => c.id);
  const sameDoc = (s: GuideStep) => !s.doc || s.doc.id === doc.id;
  const seen = new Set(steps.slice(0, at).filter(sameDoc).flatMap((s) => s.focus));
  const seenNodes = doc.nodes.filter((n) => seen.has(n.id) && !inStep.has(n.id)).map((n) => n.id);
  return { nodes, groups, conns, seenNodes };
}

/** Selo e cor de uma peça na lista do passo: papel de DDD no modo domain, papel do fluxo no logic, nada no de arquitetura (o ícone já está no quadro). */
const pieceLook = (doc: Doc, n: NodeEl) => {
  if (docMode(doc) === "domain") return orbitLook(n);
  const r = n.logic && LOGIC_ROLES[n.logic.role];
  return r ? { role: r.label, color: r.color, badge: r.badge } : { role: n.label, color: "var(--primary-600)", badge: "" };
};

export function LessonPanel() {
  const doc = useStore((s) => s.doc);
  const open = useStore((s) => s.lessonOpen);
  const iso = useStore((s) => s.iso);
  /** com seleção o inspetor ocupa a direita: a aula vira a pílula e volta quando a seleção sai (um painel por vez) */
  const yielded = useStore((s) => s.sel.length > 0);
  /** o painel lateral (arquivos ou biblioteca) aberto durante a aula: a aula recolhe e volta quando ele fecha */
  const sidePanel = useStore((s) => s.panel !== null);
  const guide = guideOfDoc(doc.id);
  const course = guide?.course;
  const [at, setAt] = useState(0);
  const [busy, setBusy] = useState(false);
  /** painel largo: o código cabe sem rolar para o lado */
  const [wide, setWide] = useState(false);
  const panelRef = useRef<HTMLElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  // outra aula: começa no primeiro passo deste diagrama; outro diagrama da mesma aula (aberto pela árvore): idem, se o passo atual não é dele
  useEffect(() => {
    setAt(guide ? firstStepIn(guide, doc.id) : 0);
  }, [guide?.key]);
  useEffect(() => {
    const s = guide?.steps[at];
    if (guide && s?.doc && s.doc.id !== doc.id) setAt(firstStepIn(guide, doc.id));
  }, [doc.id]);
  useEffect(() => {
    bodyRef.current?.scrollTo({ top: 0 });
  }, [at, guide?.key]);

  const idx = guide ? Math.min(at, guide.steps.length - 1) : 0;
  const step = guide?.steps[idx];

  /* aulas que montam o diagrama do zero: ao chegar num passo, as peças dele (e as dos passos anteriores que faltarem)
     entram no diagrama, com desfazer. Voltar não apaga nada; o «até onde já montou» fica guardado por diagrama, para que
     revisitar um passo não desfaça o que a pessoa mudou depois */
  const built = useRef(new Map<string, number>());
  useEffect(() => {
    if (!open || !guide?.build) return;
    const d = getState().doc;
    const known = built.current.get(d.id) ?? builtUpTo(d, guide.steps);
    if (idx > known) {
      const ops = opsToBuild(d, guide.steps, known + 1, idx);
      if (ops.length) run(ops);
    }
    built.current.set(d.id, Math.max(known, idx));
  }, [open, guide?.key, idx, doc.id]);
  /** recomeça a aula com o diagrama vazio (Ctrl+Z traz de volta) */
  const restart = () => {
    run([{ op: "clear" }]);
    built.current.set(getState().doc.id, -1);
    if (idx === 0) set({ sel: [] });
    else setAt(0);
  };
  /** o passo acontece no diagrama aberto (nos exemplos de Domínio ele pode estar em outro) */
  const here = !!step && (!step.doc || step.doc.id === doc.id);
  const focus = useMemo(() => (guide && here ? stepFocus(doc, guide.steps, idx) : null), [doc, guide, idx, here]);
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
    const all = [...d.nodes, ...d.groups];
    moveCameraTo(ids.size ? all.filter((e) => ids.has(e.id)) : all, panelRef.current?.offsetWidth); // passo sem destaque: o diagrama inteiro
  }, [open, guide?.key, doc.id, idx, iso, wide]);
  /* no 3D, a cena volta a se centrar no espaço livre quando o painel muda de largura */
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      const spot = getState().spotlight;
      if (getState().iso && spot) set({ spotlight: { ...spot } });
    });
    return () => cancelAnimationFrame(id);
  }, [wide]);
  useEffect(() => () => cancelCamera(), []);
  // a aula aparece sozinha na tela: o painel de arquivos ou da biblioteca fecha (abri-lo depois recolhe a aula)
  useEffect(() => {
    if (open && guide) set({ panel: null });
  }, [open, guide?.key]);
  /* com a aula na tela, a paleta lateral da visão 3D some (como na apresentação); volta quando a aula recolhe ou fecha */
  const showing = open && !!step && !yielded && !sidePanel;
  useEffect(() => {
    document.documentElement.classList.toggle("lesson-on", showing);
    return () => document.documentElement.classList.remove("lesson-on");
  }, [showing]);

  if (!guide || !step) return null;
  const pill = course ? `Aula ${course.n}` : "Aula";
  if (open && yielded)
    return (
      <button className="btn glass lesson-pill beside-insp" onClick={() => select([])} data-tip="Voltar para a aula (fecha as propriedades)" data-tip-pos="left">
        <Glyph name="play" size={15} /> {pill}
      </button>
    );
  if (open && sidePanel)
    return (
      <button className="btn glass lesson-pill" onClick={() => set({ panel: null })} data-tip="Voltar para a aula (fecha o painel lateral)" data-tip-pos="left">
        <Glyph name="play" size={15} /> {pill}
      </button>
    );
  if (!open)
    return (
      <button className="btn glass lesson-pill" onClick={() => set({ lessonOpen: true })} data-tip="Mostrar a aula" data-tip-pos="left">
        <Glyph name="play" size={15} /> {pill}
      </button>
    );

  const last = idx === guide.steps.length - 1;
  const next = course && LESSONS.find((l) => l.n === course.n + 1);
  const code = course && step.code ? codeRegion(source(course, step.code.file) ?? "", step.code.region) : undefined;
  /** vai ao passo e, se ele está em outro diagrama do exemplo, abre esse diagrama */
  const go = (n: number) => {
    const to = Math.max(0, Math.min(guide.steps.length - 1, n));
    setAt(to);
    const d = guide.steps[to].doc;
    if (d && d.id !== getState().doc.id) void openDiagram(d.path);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "ArrowRight") (e.preventDefault(), e.stopPropagation(), go(idx + 1));
    else if (e.key === "ArrowLeft") (e.preventDefault(), e.stopPropagation(), go(idx - 1));
  };
  const openNext = async () => {
    const ex = next ? exampleCatalog.find((e) => e.lesson === next.id) : guide.next && exampleCatalog.find((e) => e.key === guide.next!.key);
    if (!ex) return;
    setBusy(true);
    await installExample(ex);
    setBusy(false);
  };
  const groups = focus ? doc.groups.filter((g) => focus.groups.includes(g.id)) : [];
  const nodes = focus ? focus.nodes.map((id) => doc.nodes.find((n) => n.id === id)!) : [];
  const domain = docMode(doc) === "domain";

  return (
    <aside ref={panelRef} className={`glass lesson-panel${wide ? " wide" : ""}`} role="region" aria-label={`${guide.kicker}: ${guide.title}`} onKeyDown={onKey}>
      <header className="lesson-head">
        <div className="lesson-titles">
          <span className="story-kicker">{guide.kicker}</span>
          <b>{guide.title}</b>
        </div>
        {guide.build && (
          <button className="btn ghost icon sm" onClick={restart} aria-label="Recomeçar a aula do zero" data-tip="Recomeçar do zero: apaga o diagrama e volta ao primeiro passo (Ctrl+Z desfaz)" data-tip-pos="bottom">
            <Glyph name="undo" size={14} />
          </button>
        )}
        {course && (
          <button className={`btn ghost icon sm${wide ? " active" : ""}`} onClick={() => setWide((w) => !w)} aria-pressed={wide} aria-label={wide ? "Estreitar o painel" : "Alargar o painel"} data-tip={wide ? "Estreitar" : "Alargar (o código cabe inteiro)"} data-tip-pos="bottom">
            <Glyph name="code" size={14} />
          </button>
        )}
        <button className={`btn ghost sm${iso ? " active" : ""}`} onClick={() => (iso ? exitIso() : set({ iso: true }))} aria-pressed={iso} data-tip={iso ? "Ver em 2D" : "Ver em 3D"} data-tip-pos="bottom">
          {iso ? "2D" : "3D"}
        </button>
        <button className="btn ghost icon sm" onClick={() => set({ lessonOpen: false })} aria-label="Recolher a aula" data-tip="Recolher" data-tip-pos="bottom">
          <Glyph name="close" size={14} />
        </button>
      </header>

      <div className="story-progress lesson-progress" role="tablist" aria-label="Passos da aula">
        {guide.steps.map((s, i) => (
          <button key={i} role="tab" aria-selected={i === idx} aria-label={`Passo ${i + 1}: ${s.title}`} className={i === idx ? "on" : i < idx ? "done" : ""} onClick={() => go(i)} />
        ))}
      </div>

      <div className="lesson-body" ref={bodyRef}>
        {step.doc && guide.steps.some((s) => s.doc?.id !== step.doc!.id) && (
          <span className="lesson-where">
            <Glyph name="file" size={12} /> {step.doc.title}
          </span>
        )}
        <h2>
          <small>{idx + 1}.</small> {step.title}
        </h2>

        {here ? (
          <>
            <div className="note-md lesson-text" dangerouslySetInnerHTML={{ __html: renderMarkdown(step.text) }} />

            {guide.build && step.ops?.length ? <span className="lesson-built">Criado neste passo</span> : null}
            {(groups.length > 0 || nodes.length > 0) && (
              <div className="lesson-pieces" aria-label="Peças destacadas no diagrama">
                {groups.map((g) => (
                  <span key={g.id} className="lesson-piece ctx">
                    <i>{domain ? "CTX" : g.stage ? "ETAPA" : "GRUPO"}</i> {g.label}
                  </span>
                ))}
                {nodes.map((n) => {
                  const look = pieceLook(doc, n);
                  return (
                    <button key={n.id} className="lesson-piece" style={{ ["--rc" as string]: look.color }} onClick={() => select([n.id])} data-tip={`${look.role}: selecionar no diagrama`} data-tip-pos="top">
                      {look.badge && <i>{look.badge}</i>} {n.label}
                    </button>
                  );
                })}
              </div>
            )}

            {course && step.code && (
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
                  {guide.exercises.map((e) => (
                    <li key={e}>{e}</li>
                  ))}
                </ul>
              </section>
            )}
          </>
        ) : (
          <div className="callout lesson-elsewhere">
            <p>
              Este passo acontece no diagrama <b>{step.doc!.title}</b>.
            </p>
            <button className="btn sm primary" onClick={() => void openDiagram(step.doc!.path)}>
              <Glyph name="file" size={14} /> Abrir «{step.doc!.title}»
            </button>
          </div>
        )}
      </div>

      <footer className="lesson-foot">
        <button className="btn ghost sm" onClick={() => go(idx - 1)} disabled={idx === 0}>
          ← Anterior
        </button>
        {domain && (
          <button className="btn ghost sm" onClick={() => set({ modal: { type: "domain", tab: "code" } })} data-tip="O esqueleto que o Archflow gera deste diagrama" data-tip-pos="top">
            Esqueleto gerado
          </button>
        )}
        {!last ? (
          <button className="btn primary sm" onClick={() => go(idx + 1)}>
            Próximo →
          </button>
        ) : next || guide.next ? (
          <button className="btn primary sm" onClick={() => void openNext()} disabled={busy}>
            {busy ? "Abrindo…" : `${next ? `Aula ${next.n}` : guide.next!.label} →`}
          </button>
        ) : (
          <button className="btn primary sm" onClick={() => openExamples(docMode(doc))}>
            Outros exemplos
          </button>
        )}
      </footer>
    </aside>
  );
}
