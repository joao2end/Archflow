/**
 * Tutorial interativo do diagrama lógico, na própria interface (os passos estão em `src/shared/logictour.ts`).
 *
 * Por cima do app: um anel destaca o elemento do passo (botão, peça da Biblioteca, campo do Inspetor, nó do quadro) e um
 * balão ao lado diz o que fazer. O passo termina sozinho quando o app mostra que a ação foi feita. **Fazer por mim**: um
 * cursor fantasma vai até o alvo e clica, ou arrasta (levando uma etiqueta com a peça) até o lugar no quadro, e o passo é
 * aplicado. A sobreposição não bloqueia nada: dá para clicar e arrastar normalmente com ela na tela.
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { LOGIC_TOUR, tourNode, type TourCtx, type TourStep } from "../shared/logictour";
import { LOGIC_TOUR_DOC_ID } from "../shared/logic.lessons";
import type { LogicRole } from "../shared/schema";
import { renderMarkdown } from "./markdown";
import { fitView } from "./keys";
import { exampleCatalog, getState, installExample, run, set, startPlay, useStore } from "./store";

const NEXT_LESSON = "logic:aula-02-pontos-de-fidelidade";
const reduced = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

const ctxOf = (): TourCtx => {
  const s = getState();
  return { doc: s.doc, sel: s.sel, panel: s.panel, tool: s.tool, play: !!s.play, iso: s.iso };
};

/** O elemento de um alvo: seletor CSS ou `@node:<papel>` (o nó do quadro); só conta se estiver visível na tela. */
function resolve(target: string): Element | null {
  let el: Element | null;
  if (target.startsWith("@node:")) {
    if (getState().iso) return null;
    const n = tourNode(getState().doc, target.slice(6) as LogicRole);
    el = n ? document.querySelector(`g[data-id="${CSS.escape(n.id)}"]`) : null;
  } else el = document.querySelector(target);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 ? el : null;
}

/** Os alvos do passo, e o botão da Biblioteca como reserva quando a peça a arrastar está nela e ela está fechada. */
const targetsOf = (s: TourStep) => [...(s.target ?? []), ...(s.target?.some((t) => t.startsWith("[data-asset")) ? ['[aria-label="Biblioteca"]'] : [])];

function findTarget(s: TourStep): { el: Element; target: string } | null {
  for (const t of targetsOf(s)) {
    const el = resolve(t);
    if (el) return { el, target: t };
  }
  return null;
}

const center = (r: DOMRect) => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 });

/** Onde retomar: o primeiro passo que espera uma ação e ainda não está feito (diagrama vazio: a abertura). */
function resumeAt(): number {
  const c = ctxOf();
  if (!c.doc.nodes.length) return 0;
  const i = LOGIC_TOUR.findIndex((s) => s.check && !s.check(c));
  return i < 0 ? LOGIC_TOUR.length - 1 : i;
}

/** Começa (ou continua) o tutorial no diagrama dele. */
export const startLogicTour = () => set({ tour: { step: resumeAt() }, lessonOpen: false, iso: false });

/** quem fechou o tutorial nesta sessão não o vê abrir sozinho de novo (o botão ▶ Tutorial continua no canto) */
let dismissed = false;

export function LogicTour() {
  const tour = useStore((s) => s.tour);
  const docId = useStore((s) => s.doc.id);
  // o passo é refeito a cada mudança do que as condições olham (diagrama, seleção, painel, ferramenta, teste, 3D)
  useStore((s) => s.doc);
  useStore((s) => s.sel);
  useStore((s) => s.panel);
  useStore((s) => s.tool);
  useStore((s) => s.play);
  useStore((s) => s.iso);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [where, setWhere] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [cursor, setCursor] = useState<{ x: number; y: number; down: boolean; chip?: string } | null>(null);
  const bubble = useRef<HTMLDivElement>(null);
  /** sem posição ainda (primeiro quadro), o balão fica invisível: assim não desliza do canto da tela */
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  const active = !!tour && docId === LOGIC_TOUR_DOC_ID;
  const idx = tour ? Math.min(tour.step, LOGIC_TOUR.length - 1) : 0;
  const step = LOGIC_TOUR[idx];
  const done = active && !!step.check?.(ctxOf());

  /* o alvo se move (rolagem, zoom, painel abrindo): acompanha a cada quadro */
  useEffect(() => {
    if (!active) return;
    let frame = 0;
    let scrolled = "";
    const tick = () => {
      const f = findTarget(step);
      if (f && f.target.startsWith("[data-asset") && scrolled !== f.target) {
        scrolled = f.target;
        f.el.scrollIntoView({ block: "nearest" });
      }
      const r = f?.el.getBoundingClientRect() ?? null;
      setRect((old) => (old && r && old.x === r.x && old.y === r.y && old.width === r.width && old.height === r.height ? old : r));
      setWhere(f?.target ?? "");
      frame = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(frame);
  }, [active, idx]);

  /* passo feito: mostra o ✓ e segue. Ao voltar para um passo que já estava feito, não pula sozinho (só depois que
     ele deixar de estar feito e for feito de novo) */
  const skipAuto = useRef(false);
  useEffect(() => {
    skipAuto.current = !!step.check?.(ctxOf());
  }, [idx]);
  useEffect(() => {
    if (!active) return;
    if (!done) {
      skipAuto.current = false;
      return;
    }
    if (skipAuto.current) return;
    const t = setTimeout(() => set({ tour: { step: Math.min(idx + 1, LOGIC_TOUR.length - 1) } }), 900);
    return () => clearTimeout(t);
  }, [done, active, idx]);

  /* o balão fica ao lado do alvo, dentro da tela */
  useLayoutEffect(() => {
    const b = bubble.current;
    if (!b) return;
    const w = b.offsetWidth;
    const h = b.offsetHeight;
    const m = 14;
    const W = window.innerWidth;
    const H = window.innerHeight;
    // sem alvo: no começo, no meio da tela; depois, no canto de baixo à direita, sem cobrir o quadro
    if (!rect) return setPos(idx === 0 ? { left: (W - w) / 2, top: Math.max(m, (H - h) / 2) } : { left: W - w - 24, top: Math.max(m, H - h - 110) });
    let left = rect.right + 18;
    let top = rect.top + rect.height / 2 - h / 2;
    if (left + w > W - m) left = rect.left - 18 - w;
    if (left < m) {
      left = Math.min(Math.max(m, rect.left + rect.width / 2 - w / 2), W - w - m);
      top = rect.bottom + 18 + h < H - m ? rect.bottom + 18 : rect.top - 18 - h;
    }
    setPos({ left, top: Math.min(Math.max(m, top), H - h - m) });
  }, [rect, idx, done, busy]);

  /* abrir o diagrama do tutorial (pelo explorador, ao reabrir o app) começa o tutorial onde parou */
  const onTourDoc = docId === LOGIC_TOUR_DOC_ID;
  useEffect(() => {
    if (onTourDoc && !getState().tour && !dismissed) startLogicTour();
  }, [onTourDoc]);

  if (!active)
    return onTourDoc ? (
      <button className="btn glass lesson-pill tour-pill" onClick={startLogicTour} data-tip="Começar ou continuar o tutorial: ele mostra onde clicar e espera você fazer" data-tip-pos="left">
        ▶ Tutorial
      </button>
    ) : null;

  const go = (n: number) => set({ tour: { step: Math.max(0, Math.min(LOGIC_TOUR.length - 1, n)) } });
  const quit = () => {
    dismissed = true;
    set({ tour: null });
  };
  /** apaga o que foi montado e volta à abertura (Ctrl+Z desfaz) */
  const restart = () => {
    run([{ op: "clear" }]);
    set({ tour: { step: 0 }, sel: [], play: null, iso: false, tool: "select" });
  };
  const last = idx === LOGIC_TOUR.length - 1;
  const usingFallback = where === '[aria-label="Biblioteca"]' && !!step.target?.some((t) => t.startsWith("[data-asset"));
  const nodeFallback = where.startsWith("@node:") && step.target?.[0] !== where;

  /** «Fazer por mim»: o cursor fantasma mostra o gesto e o passo é aplicado */
  const demo = async () => {
    if (busy) return;
    setBusy(true);
    const anim = !reduced();
    const ui = step.ui ?? {};
    const drag = step.motion?.kind === "drag";
    // pré-condições do gesto: a Biblioteca aberta para arrastar dela, a ferramenta certa, a peça selecionada (Inspetor)
    if (drag && ui.panel !== undefined) set({ panel: ui.panel });
    if (drag && ui.tool) set({ tool: ui.tool });
    if (ui.select) {
      const n = tourNode(getState().doc, ui.select);
      if (n) set({ sel: [n.id] });
    }
    await wait(anim ? 250 : 0);
    const from = findTarget(step);
    const start = cursor ?? { x: window.innerWidth / 2, y: window.innerHeight - 120 };
    if (anim && from) {
      const a = center(from.el.getBoundingClientRect());
      setCursor({ ...start, down: false });
      await wait(30);
      setCursor({ x: a.x, y: a.y, down: false });
      await wait(650);
      setCursor({ x: a.x, y: a.y, down: true });
      await wait(180);
      if (drag && step.motion?.kind === "drag") {
        const to = step.motion.to;
        const v = getState().view;
        let b = { x: a.x, y: a.y };
        if ("world" in to) {
          const p = to.world(getState().doc);
          b = { x: (p.x + 90) * v.z + v.x, y: (p.y + 30) * v.z + v.y };
        } else {
          const n = tourNode(getState().doc, to.node);
          const el = n ? document.querySelector(`g[data-id="${CSS.escape(n.id)}"]`) : null;
          if (el) b = center(el.getBoundingClientRect());
        }
        const chip = from.target.startsWith("[data-asset") ? (from.el.querySelector(".name")?.textContent ?? "") : from.target.startsWith("@node:") && ui.tool !== "connect" ? "" : undefined;
        setCursor({ x: a.x, y: a.y, down: true, chip: chip || undefined });
        await wait(30);
        setCursor({ x: b.x, y: b.y, down: true, chip: chip || undefined });
        await wait(800);
      }
      setCursor((c) => c && { ...c, down: false, chip: undefined });
    }
    // o resultado: o diagrama muda, e a tela também (painel, ferramenta, teste, 3D)
    if (!drag && ui.panel !== undefined) set({ panel: ui.panel });
    if (!drag && ui.tool) set({ tool: ui.tool });
    const ops = step.ops?.(getState().doc) ?? [];
    if (ops.length) {
      const results = run(ops);
      const added = results.map((r) => r.id).filter((id): id is string => !!id && getState().doc.nodes.some((n) => n.id === id));
      if (added.length && ops.some((o) => o.op === "add_node")) set({ sel: [added[added.length - 1]] });
      requestAnimationFrame(() => {
        const el = added.length ? document.querySelector(`g[data-id="${CSS.escape(added[added.length - 1])}"]`) : null;
        const r = el?.getBoundingClientRect();
        if (r && (r.right > window.innerWidth - 380 || r.bottom > window.innerHeight - 90 || r.left < 90 || r.top < 70)) fitView();
      });
    }
    if (ui.play) {
      const sc = getState().doc.nodes.find((n) => n.logic?.role === "scenario");
      if (sc) startPlay(sc.id, 0);
    }
    if (ui.iso) set({ iso: true });
    await wait(anim ? 450 : 0);
    setCursor(null);
    setBusy(false);
  };

  const nextLesson = async () => {
    const ex = exampleCatalog.find((e) => e.key === NEXT_LESSON);
    quit();
    if (ex) await installExample(ex);
  };

  return (
    <>
      {rect && (
        <div
          className={`tour-ring${done ? " done" : ""}`}
          style={{ left: rect.left - 6, top: rect.top - 6, width: rect.width + 12, height: rect.height + 12 }}
          aria-hidden
        />
      )}
      <div ref={bubble} className={`glass tour-bubble${done ? " done" : ""}`} style={pos ? { left: pos.left, top: pos.top } : { visibility: "hidden" }} role="dialog" aria-label={`Tutorial: ${step.title}`}>
        <header>
          <span className="tour-kicker">
            Tutorial · passo {idx + 1} de {LOGIC_TOUR.length}
          </span>
          <span className="tour-head-btns">
            <button className="btn ghost icon sm" onClick={restart} aria-label="Recomeçar do zero" data-tip="Recomeçar do zero: apaga o diagrama e volta ao começo (Ctrl+Z desfaz)" data-tip-pos="left">
              ↺
            </button>
            <button className="btn ghost icon sm" onClick={quit} aria-label="Fechar o tutorial" data-tip="Fechar (o botão ▶ Tutorial no canto reabre)" data-tip-pos="left">
              ✕
            </button>
          </span>
        </header>
        <div className="tour-progress" aria-hidden>
          <i style={{ width: `${((idx + (done ? 1 : 0)) / LOGIC_TOUR.length) * 100}%` }} />
        </div>
        <h3>{done ? "✓ Feito!" : step.title}</h3>
        {!done && <div className="note-md tour-text" dangerouslySetInnerHTML={{ __html: renderMarkdown(step.text) }} />}
        {!done && usingFallback && <p className="tour-hint">Primeiro abra a <b>Biblioteca</b>: a peça está nela.</p>}
        {!done && nodeFallback && <p className="tour-hint">Clique na peça destacada para abrir o <b>Inspetor</b>.</p>}
        <footer>
          <button className="btn ghost sm" onClick={() => go(idx - 1)} disabled={idx === 0 || busy}>
            ← Voltar
          </button>
          {step.check && !done && (
            <>
              <button className="btn ghost sm" onClick={() => go(idx + 1)} disabled={busy} data-tip="Pular este passo" data-tip-pos="top">
                Pular
              </button>
              <button className="btn primary sm" onClick={() => void demo()} disabled={busy}>
                {busy ? "Fazendo…" : "Fazer por mim"}
              </button>
            </>
          )}
          {!step.check && !last && (
            <button className="btn primary sm" onClick={() => go(idx + 1)}>
              {idx === 0 ? "Começar" : "Próximo →"}
            </button>
          )}
          {last && (
            <>
              <button className="btn ghost sm" onClick={quit}>
                Concluir
              </button>
              <button className="btn primary sm" onClick={() => void nextLesson()}>
                Aula 2 →
              </button>
            </>
          )}
        </footer>
      </div>
      {cursor && (
        <div className={`tour-cursor${cursor.down ? " down" : ""}`} style={{ transform: `translate(${cursor.x}px, ${cursor.y}px)` }} aria-hidden>
          <svg width="22" height="22" viewBox="0 0 24 24">
            <path d="M4 2l15 9-6.5 1.5L9 19z" fill="#fff" stroke="#1f2430" strokeWidth="1.6" strokeLinejoin="round" />
          </svg>
          {cursor.chip && <span className="tour-chip">{cursor.chip}</span>}
        </div>
      )}
    </>
  );
}
