/**
 * Tutoriais interativos do diagrama lógico, na própria interface (as aulas estão em `src/shared/logictours.ts`).
 *
 * Por cima do app: um anel destaca o elemento do passo (botão, peça da Biblioteca, campo do Inspetor, nó ou seta do
 * quadro) e um balão ao lado diz o que fazer. O passo termina sozinho quando o app mostra que a ação foi feita. **Fazer
 * por mim**: um cursor fantasma vai até o alvo e clica, ou arrasta (levando uma etiqueta com a peça) até o lugar no
 * quadro, e o passo é aplicado. A sobreposição não bloqueia nada: dá para clicar e arrastar normalmente com ela na tela.
 *
 * A aula é a do diagrama aberto: abri-lo (pelo explorador, ao reabrir o app) começa o tutorial no primeiro passo que
 * falta; fechado, o botão ▶ no canto o reabre.
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ROLE_WIDTH, pickNode, slotFor, targetsNow, tourNode, type TourCtx, type TourStep } from "../shared/logictour";
import { tourByKey, tourOfDoc, type LogicTourDef } from "../shared/logictours";
import type { Doc, LogicRole } from "../shared/schema";
import { renderMarkdown } from "./markdown";
import { fitView } from "./keys";
import { exampleCatalog, getState, installExample, openExamples, run, set, startPlay, useStore } from "./store";

const reduced = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

const ctxOf = (): TourCtx => {
  const s = getState();
  return { doc: s.doc, sel: s.sel, panel: s.panel, tool: s.tool, play: !!s.play, iso: s.iso };
};

const nodeEl = (id: string) => document.querySelector(`g[data-id="${CSS.escape(id)}"][data-role="node"]`);

/** O elemento de um alvo: seletor CSS, `@node:<papel>`, `@node` ou `@conn` (do passo); só conta se estiver visível na tela. */
function resolve(target: string, step: TourStep): Element | null {
  const s = getState();
  let el: Element | null;
  if (target.startsWith("@node") || target === "@conn") {
    if (s.iso) return null;
    if (target === "@conn") {
      const c = step.conn?.(s.doc);
      el = c ? document.querySelector(`g[data-id="${CSS.escape(c.id)}"][data-role="conn"]`) : null;
    } else {
      const n = target === "@node" ? step.node?.(s.doc) : tourNode(s.doc, target.slice(6) as LogicRole);
      el = n ? nodeEl(n.id) : null;
    }
  } else el = document.querySelector(target);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 ? el : null;
}

/** Os alvos do passo agora, e o botão da Biblioteca como reserva quando a peça a arrastar está nela e ela está fechada. */
function targetsOf(s: TourStep): string[] {
  const t = targetsNow(s, ctxOf());
  return [...t, ...(t.some((x) => x.startsWith("[data-asset")) ? ['[aria-label="Biblioteca"]'] : [])];
}

function findTarget(s: TourStep): { el: Element; target: string } | null {
  for (const t of targetsOf(s)) {
    const el = resolve(t, s);
    if (el) return { el, target: t };
  }
  return null;
}

const center = (r: DOMRect) => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 });

/* ───────── lugar marcado: cada peça que o passo pede tem um lugar na grade da aula ───────── */

/** altura com que cada papel nasce (para o contorno do lugar ter o tamanho da peça) */
const ROLE_HEIGHT: Partial<Record<LogicRole, number>> = { decision: 87, rule: 93, table: 154, call: 115, loop: 87, switch: 87, fork: 26, join: 26, start: 60, end: 60, scenario: 73 };
const roleOfAsset = (t: string) => /data-asset="logic-([a-z]+)"/.exec(t)?.[1] as LogicRole | undefined;
/** O papel da peça que o passo pede agora: a da Biblioteca apontada, ou a do nó a mover. */
function wantedRole(s: TourStep): LogicRole | undefined {
  const t = targetsNow(s, ctxOf());
  const asset = t.map(roleOfAsset).find(Boolean);
  if (asset) return asset;
  const moving = s.motion?.kind === "drag" && "world" in s.motion.to ? t.find((x) => x.startsWith("@node:")) : undefined;
  return moving ? (moving.slice(6) as LogicRole) : undefined;
}
/** Os papéis que o passo pode criar (para encaixar no lugar a peça solta em qualquer ponto). */
const rolesOf = (s: TourStep): Set<LogicRole> => new Set([...targetsNow(s, ctxOf()).map(roleOfAsset).filter((r): r is LogicRole => !!r), ...(Object.keys(s.places ?? {}) as LogicRole[])]);
const without = (doc: Doc, id: string): Doc => ({ ...doc, nodes: doc.nodes.filter((n) => n.id !== id) });

/** Onde retomar: o primeiro passo que espera uma ação e ainda não está feito (diagrama vazio: a abertura). */
function resumeAt(def: LogicTourDef): number {
  const c = ctxOf();
  if (!c.doc.nodes.length) return 0;
  const i = def.steps.findIndex((s) => s.check && !s.check(c));
  return i < 0 ? def.steps.length - 1 : i;
}

/** Começa (ou continua) a aula do diagrama aberto. */
export function startLogicTour() {
  const def = tourOfDoc(getState().doc.id);
  if (def) set({ tour: { key: def.key, step: resumeAt(def) }, lessonOpen: false, iso: false });
}

/** quem fechou a aula nesta sessão não a vê abrir sozinha de novo (o botão ▶ no canto continua lá) */
const dismissed = new Set<string>();

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
  const view = useStore((s) => s.view);
  const iso = useStore((s) => s.iso);

  const def = tourOfDoc(docId);
  const steps = def?.steps ?? [];
  const active = !!tour && !!def && tour.key === def.key;
  const idx = tour && active ? Math.min(tour.step, steps.length - 1) : 0;
  const step: TourStep | undefined = steps[idx];
  const done = active && !!step?.check?.(ctxOf());

  /* o alvo se move (rolagem, zoom, painel abrindo): acompanha a cada quadro */
  useEffect(() => {
    if (!active || !step) return;
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
  }, [active, idx, def?.key]);

  /* passo feito: mostra o ✓ e segue. Ao voltar para um passo que já estava feito, não pula sozinho (só depois que
     ele deixar de estar feito e for feito de novo) */
  const skipAuto = useRef(false);
  useEffect(() => {
    skipAuto.current = !!step?.check?.(ctxOf());
  }, [idx, def?.key]);
  useEffect(() => {
    if (!active || !def) return;
    if (!done) {
      skipAuto.current = false;
      return;
    }
    if (skipAuto.current) return;
    const t = setTimeout(() => set({ tour: { key: def.key, step: Math.min(idx + 1, steps.length - 1) } }), 900);
    return () => clearTimeout(t);
  }, [done, active, idx, def?.key]);

  /* o lugar da peça pedida agora, em coordenadas do quadro */
  const role = active && step && !done ? wantedRole(step) : undefined;
  const slot = role && step ? slotFor(step, getState().doc, role) : undefined;
  const ghost = slot && role && !iso ? { left: slot.x * view.z + view.x, top: slot.y * view.z + view.y, width: (ROLE_WIDTH[role] ?? 300) * view.z, height: (ROLE_HEIGHT[role] ?? 64) * view.z } : null;

  /* a peça solta em qualquer ponto encaixa no lugar dela (só quando nasce: depois, mover é com a pessoa) */
  const known = useRef<Set<string>>(new Set());
  useEffect(() => {
    known.current = new Set(getState().doc.nodes.map((n) => n.id));
  }, [idx, def?.key, active]);
  useEffect(() => {
    if (!active || !step) return;
    const d = getState().doc;
    const fresh = d.nodes.filter((n) => !known.current.has(n.id));
    if (!fresh.length) return;
    const roles = rolesOf(step);
    const moves = [];
    for (const n of fresh) {
      known.current.add(n.id);
      const r = n.logic?.role;
      if (!r || !roles.has(r)) continue;
      const p = slotFor(step, without(d, n.id), r);
      if (p && (Math.abs(n.x - p.x) > 24 || Math.abs(n.y - p.y) > 24)) moves.push({ op: "update" as const, id: n.id, patch: { x: p.x, y: p.y } });
    }
    if (moves.length) run(moves);
  });

  /* o lugar fora da tela: a tela rola até ele (uma vez por passo) */
  const shown = useRef("");
  useEffect(() => {
    if (!slot || !role || iso) return;
    const k = `${def?.key}:${idx}:${role}`;
    if (shown.current === k) return;
    shown.current = k;
    const v = getState().view;
    const x = slot.x * v.z + v.x;
    const y = slot.y * v.z + v.y;
    const W = window.innerWidth;
    const H = window.innerHeight;
    if (x < 100 || y < 90 || x + (ROLE_WIDTH[role] ?? 300) * v.z > W - 400 || y + 120 * v.z > H - 110) set({ view: { ...v, x: W * 0.42 - slot.x * v.z, y: H * 0.42 - slot.y * v.z } });
  }, [slot?.x, slot?.y, role, idx, iso]);

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

  /* abrir o diagrama de uma aula (pelo explorador, ao reabrir o app) começa a aula onde parou */
  useEffect(() => {
    if (def && getState().tour?.key !== def.key && !dismissed.has(def.key)) startLogicTour();
  }, [def?.key]);

  if (!def) return null;
  if (!active || !step)
    return (
      <button className="btn glass lesson-pill tour-pill" onClick={startLogicTour} data-tip="Começar ou continuar a aula: ela mostra onde clicar e espera você fazer" data-tip-pos="left">
        ▶ Aula {def.n}
      </button>
    );

  const go = (n: number) => set({ tour: { key: def.key, step: Math.max(0, Math.min(steps.length - 1, n)) } });
  const quit = () => {
    dismissed.add(def.key);
    set({ tour: null });
  };
  /** apaga o que foi montado e volta à abertura (Ctrl+Z desfaz) */
  const restart = () => {
    run([{ op: "clear" }]);
    set({ tour: { key: def.key, step: 0 }, sel: [], play: null, iso: false, tool: "select" });
  };
  const last = idx === steps.length - 1;
  const next = def.next ? tourByKey(def.next) : undefined;
  const usingFallback = where === '[aria-label="Biblioteca"]' && targetsNow(step, ctxOf()).some((t) => t.startsWith("[data-asset"));
  const nodeFallback = (where.startsWith("@node") || where === "@conn") && targetsNow(step, ctxOf())[0] !== where;

  /** «Fazer por mim»: o cursor fantasma mostra o gesto e o passo é aplicado */
  const demo = async () => {
    if (busy) return;
    setBusy(true);
    const anim = !reduced();
    const ui = step.ui ?? {};
    const motion = step.motion;
    // pré-condições do gesto: a Biblioteca aberta para arrastar dela, a ferramenta certa, a peça ou a seta selecionada
    if (motion?.kind === "drag" && ui.panel !== undefined) set({ panel: ui.panel });
    if (motion?.kind === "drag" && ui.tool) set({ tool: ui.tool });
    if (ui.select) {
      const n = pickNode(getState().doc, ui.select);
      if (n) set({ sel: [n.id] });
    }
    if (ui.selectConn) {
      const c = step.conn?.(getState().doc);
      if (c) set({ sel: [c.id] });
    }
    await wait(anim ? 250 : 0);
    const from = findTarget(step);
    // arrastar da Biblioteca só vale quando o alvo é a peça; num campo do Inspetor, o gesto é clicar
    const drag = motion?.kind === "drag" && !!from && (from.target.startsWith("[data-asset") || !("world" in motion.to));
    const start = cursor ?? { x: window.innerWidth / 2, y: window.innerHeight - 120 };
    if (anim && from) {
      const a = center(from.el.getBoundingClientRect());
      setCursor({ ...start, down: false });
      await wait(30);
      setCursor({ x: a.x, y: a.y, down: false });
      await wait(650);
      setCursor({ x: a.x, y: a.y, down: true });
      await wait(180);
      if (drag && motion?.kind === "drag") {
        const to = motion.to;
        const v = getState().view;
        let b = { x: a.x, y: a.y };
        if ("world" in to) {
          const p = to.world(getState().doc);
          b = { x: (p.x + 90) * v.z + v.x, y: (p.y + 30) * v.z + v.y };
        } else {
          const n = pickNode(getState().doc, to.node);
          const el = n ? nodeEl(n.id) : null;
          if (el) b = center(el.getBoundingClientRect());
        }
        const chip = from.target.startsWith("[data-asset") ? (from.el.querySelector(".name")?.textContent ?? "") : "";
        setCursor({ x: a.x, y: a.y, down: true, chip: chip || undefined });
        await wait(30);
        setCursor({ x: b.x, y: b.y, down: true, chip: chip || undefined });
        await wait(800);
      }
      setCursor((c) => c && { ...c, down: false, chip: undefined });
    }
    // o resultado: o diagrama muda, e a tela também (painel, ferramenta, teste, 3D)
    if (motion?.kind !== "drag" && ui.panel !== undefined) set({ panel: ui.panel });
    if (motion?.kind !== "drag" && ui.tool) set({ tool: ui.tool });
    const ops = step.ops?.(getState().doc) ?? [];
    if (ops.length) {
      const results = run(ops);
      const added = results.map((r) => r.id).filter((id): id is string => !!id && getState().doc.nodes.some((n) => n.id === id));
      if (added.length && ops.some((o) => o.op === "add_node")) set({ sel: [added[added.length - 1]] });
      requestAnimationFrame(() => {
        const el = added.length ? nodeEl(added[added.length - 1]) : null;
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
    const ex = next && exampleCatalog.find((e) => e.key === next.key);
    quit();
    if (ex) await installExample(ex);
    else openExamples("logic");
  };

  return (
    <>
      {ghost && (
        <div className="tour-slot" style={ghost} aria-hidden>
          <span>Solte aqui</span>
        </div>
      )}
      {rect && (
        <div
          className={`tour-ring${done ? " done" : ""}`}
          style={{ left: rect.left - 6, top: rect.top - 6, width: rect.width + 12, height: rect.height + 12 }}
          aria-hidden
        />
      )}
      <div ref={bubble} className={`glass tour-bubble${done ? " done" : ""}`} style={pos ? { left: pos.left, top: pos.top } : { visibility: "hidden" }} role="dialog" aria-label={`Aula ${def.n}: ${step.title}`}>
        <header>
          <span className="tour-kicker">
            Aula {def.n} · passo {idx + 1} de {steps.length}
          </span>
          <span className="tour-head-btns">
            <button className="btn ghost icon sm" onClick={restart} aria-label="Recomeçar do zero" data-tip="Recomeçar do zero: apaga o diagrama e volta ao começo (Ctrl+Z desfaz)" data-tip-pos="left">
              ↺
            </button>
            <button className="btn ghost icon sm" onClick={quit} aria-label="Fechar a aula" data-tip={`Fechar (o botão ▶ Aula ${def.n} no canto reabre)`} data-tip-pos="left">
              ✕
            </button>
          </span>
        </header>
        <div className="tour-progress" aria-hidden>
          <i style={{ width: `${((idx + (done ? 1 : 0)) / steps.length) * 100}%` }} />
        </div>
        <h3>{done ? "✓ Feito!" : step.title}</h3>
        {!done && <div className="note-md tour-text" dangerouslySetInnerHTML={{ __html: renderMarkdown(step.text) }} />}
        {!done && usingFallback && <p className="tour-hint">Primeiro abra a <b>Biblioteca</b>: a peça está nela.</p>}
        {!done && nodeFallback && <p className="tour-hint">Clique no item destacado para abrir o <b>Inspetor</b>.</p>}
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
                {next ? `Aula ${next.n} →` : "Outros exemplos"}
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
