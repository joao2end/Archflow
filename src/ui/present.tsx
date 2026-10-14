import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EraseModes, InkOptions } from "./drawbar";
import { Glyph } from "./icons";
import { fitView } from "./keys";
import { INK_COLORS, inkPath as pathOf, strokeAttrs } from "./ink";
import { RichEditor, RichToolbar, richToHtml } from "./richeditor";
import { getState, set, useStore } from "./store";
import type { Pt } from "./geometry";
import { RecordControls, recordingGrace } from "./record";
import { StoryPanel } from "./story";
import { TourPanel } from "./tour";
import { parseRich, plainText, type BlockKind } from "../shared/richtext";
import { docMode } from "../shared/schema";

/* ───────── modo apresentação: tela limpa + caneta, marca-texto, laser e cronômetro ───────── */

export type PresentTool = "navigate" | "pen" | "highlight" | "eraser" | "text" | "list" | "laser";

interface Stroke {
  id: number;
  kind: "pen" | "highlight";
  color: string;
  /** espessura em unidades do quadro (constante na tela no momento do traço) */
  width: number;
  dash: "solid" | "dashed" | "dotted";
  opacity: number;
  pts: Pt[];
}

/** Texto ou lista efêmeros escritos sobre o quadro durante a apresentação. */
interface PNote {
  id: number;
  kind: "text" | "list";
  color: string;
  x: number;
  y: number;
  /** tamanho da fonte em unidades do quadro (≈22px na tela no momento da criação) */
  fs: number;
  text: string;
}

const LINE_H = 1.35;
const BLOCK_SCALE: Record<BlockKind, number> = { p: 1, ul: 1, ol: 1, h1: 1.4, h2: 1.18, pre: 0.95 };

function noteBounds(n: PNote) {
  const blocks = parseRich(n.text);
  let h = 0;
  let maxW = 1;
  for (const b of blocks) {
    const fs = n.fs * BLOCK_SCALE[b.kind];
    let body = b.spans.map((s) => s.t).join("");
    if (b.kind === "pre") {
      const rows = body.split("\n");
      for (const row of rows) maxW = Math.max(maxW, row.length * fs * 0.62);
      h += Math.max(1, rows.length) * fs * LINE_H + fs * 0.4;
      continue;
    }
    let prefix = "";
    if (b.kind === "ul") prefix = "• ";
    else if (b.kind === "ol") prefix = `${b.n ?? 1}. `;
    else if (n.kind === "list") {
      if (/^\[x\]/i.test(body)) (prefix = "☑ "), (body = body.replace(/^\[x\]\s?/i, ""));
      else if (/^\[ \]/.test(body)) (prefix = "☐ "), (body = body.replace(/^\[ \]\s?/, ""));
      else prefix = "• ";
    }
    maxW = Math.max(maxW, (prefix.length + body.length) * fs * 0.6);
    h += fs * LINE_H;
  }
  return { w: maxW, h: Math.max(h, n.fs * LINE_H) };
}

/** Editor rico flutuante — mesma barra/controles do quadro. */
function PresentNoteEditor({
  n,
  left,
  top,
  fs,
  toolbarTop,
  onChange,
  onCard,
  onClose,
}: {
  n: PNote;
  left: number;
  top: number;
  fs: number;
  toolbarTop: number;
  onChange: (text: string) => void;
  onCard: (patch: { fontSize?: number; fill?: string }) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  return (
    <>
      <RichToolbar
        root={ref}
        className="floating present-rich-bar"
        style={{ left: Math.min(Math.max(8, left), window.innerWidth - 320), top: toolbarTop }}
        compact
        noteCard={{ fontSize: Math.round(n.fs) }}
        onNoteCard={onCard}
        showFill={false}
      />
      <RichEditor
        innerRef={ref}
        value={n.text}
        onChange={onChange}
        onClose={onClose}
        autoFocus
        label={n.kind === "list" ? "Lista" : "Texto"}
        placeholder={n.kind === "list" ? "um item por linha" : "Escreva…"}
        className="present-note-edit present-rich-edit"
        style={{
          left,
          top,
          fontSize: fs,
          lineHeight: LINE_H,
          color: n.color,
          minWidth: 160,
          maxWidth: "70vw",
        }}
      />
    </>
  );
}

/** Renderiza o markdown da anotação como HTML (mesmo pipeline do editor). */
function PresentNoteShape({ n, onEdit }: { n: PNote; onEdit?: () => void }) {
  const html = useMemo(() => richToHtml(n.text || " "), [n.text]);
  const { w, h } = useMemo(() => noteBounds(n), [n.text, n.fs, n.kind]);
  return (
    <g transform={`translate(${n.x},${n.y})`}>
      <foreignObject width={Math.max(w, 48)} height={Math.max(h, n.fs * LINE_H)} style={{ overflow: "visible" }}>
        <div
          {...{ xmlns: "http://www.w3.org/1999/xhtml" }}
          className={`present-rich-view note-md${n.kind === "list" ? " list" : ""}`}
          style={{
            fontSize: n.fs,
            lineHeight: LINE_H,
            color: n.color,
            fontWeight: 600,
            fontFamily: "var(--sans)",
            pointerEvents: onEdit ? "auto" : "none",
            cursor: onEdit ? "text" : undefined,
            width: "max-content",
            maxWidth: "70vw",
          }}
          dangerouslySetInnerHTML={{ __html: html }}
          onPointerDown={(e) => {
            if (!onEdit) return;
            e.stopPropagation();
            onEdit();
          }}
        />
      </foreignObject>
    </g>
  );
}

const COLORS = INK_COLORS;

const GOALS = [0, 5, 10, 15, 20, 30, 45, 60]; // minutos; 0 = cronômetro progressivo

let saved: { panel: ReturnType<typeof getState>["panel"]; tool: ReturnType<typeof getState>["tool"]; view: ReturnType<typeof getState>["view"] } | null = null;

export function enterPresent() {
  const s = getState();
  if (s.present) return;
  saved = { panel: s.panel, tool: s.tool, view: s.view };
  set({ present: true, panel: null, tool: "hand", sel: [], modal: null });
  requestAnimationFrame(() => window.dispatchEvent(new Event("archflow:fit")));
  document.documentElement.requestFullscreen?.().catch(() => {});
}

export function exitPresent() {
  if (!getState().present) return;
  set({ present: false, panel: saved?.panel === "styles" ? null : saved?.panel ?? "assets", tool: saved?.tool === "hand" ? "select" : saved?.tool ?? "select", ...(saved ? { view: saved.view } : {}) });
  saved = null;
  if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
}

export const togglePresent = () => (getState().present ? exitPresent() : enterPresent());

const fmt = (sec: number) => {
  const s = Math.abs(Math.round(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const body = `${String(m).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  return `${sec < 0 ? "+" : ""}${h ? h + ":" : ""}${body}`;
};

/* ───────── cronômetro ───────── */

function Timer() {
  const [goal, setGoal] = useState(0);
  const [elapsed, setElapsed] = useState(0); // ms acumulados
  const [running, setRunning] = useState(true);
  const startedAt = useRef(Date.now());
  const base = useRef(0);

  useEffect(() => {
    if (!running) return;
    startedAt.current = Date.now();
    const id = setInterval(() => setElapsed(base.current + Date.now() - startedAt.current), 250);
    return () => {
      clearInterval(id);
      base.current += Date.now() - startedAt.current;
    };
  }, [running]);

  const reset = () => {
    base.current = 0;
    startedAt.current = Date.now();
    setElapsed(0);
  };
  const sec = elapsed / 1000;
  const remaining = goal ? goal * 60 - sec : sec;
  const state = goal ? (remaining < 0 ? "over" : remaining <= 60 ? "warn" : "") : "";
  const cycleGoal = () => {
    setGoal((g) => GOALS[(GOALS.indexOf(g) + 1) % GOALS.length]);
    reset();
  };

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.code === "Space" && !(e.target as HTMLElement)?.closest?.("button,input")) {
        e.preventDefault();
        setRunning((r) => !r);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);

  return (
    <div className={`hud glass present-timer ${state}`} role="timer" aria-label="Cronômetro">
      <Glyph name="timer" size={19} />
      <span className="time">{fmt(remaining)}</span>
      <button className="btn ghost icon" onClick={() => setRunning((r) => !r)} aria-label={running ? "Pausar" : "Continuar"} data-tip={running ? "Pausar (Espaço)" : "Continuar (Espaço)"} data-tip-pos="bottom">
        <Glyph name={running ? "pause" : "play"} size={17} />
      </button>
      <button className="btn ghost icon" onClick={reset} aria-label="Zerar" data-tip="Zerar" data-tip-pos="bottom">
        <Glyph name="reset" size={17} />
      </button>
      <button className="btn ghost sm goal" onClick={cycleGoal} data-tip={"Meta de tempo (contagem regressiva)\nClique para alternar"} data-tip-pos="bottom">
        {goal ? `${goal} min` : "Livre"}
      </button>
    </div>
  );
}

/* ───────── camada de desenho ───────── */

export function PresentMode() {
  const view = useStore((s) => s.view);
  const mode = useStore((s) => docMode(s.doc));
  const [tool, setTool] = useState<PresentTool>("navigate");
  const color = useStore((s) => s.inkColor);
  const cfg = useStore((s) => s.inkCfg);
  const dash = useStore((s) => s.inkDash);
  // as opções só abrem ao clicar numa cor; trocar de ferramenta as fecha
  const [optsFor, setOptsFor] = useState<PresentTool | null>(null);
  useEffect(() => setOptsFor((o) => (o === tool ? o : null)), [tool]);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [notes, setNotes] = useState<PNote[]>([]);
  const [editing, setEditing] = useState<number | null>(null);
  const erasing = useRef(false);
  const [trail, setTrail] = useState<{ x: number; y: number; t: number }[]>([]);
  const [cursor, setCursor] = useState<Pt | null>(null);
  const cur = useRef<Stroke | null>(null);
  const layer = useRef<SVGSVGElement>(null);
  const idc = useRef(0);

  const toWorld = useCallback((e: { clientX: number; clientY: number }): Pt => {
    const v = getState().view;
    const r = layer.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left - v.x) / v.z, y: (e.clientY - r.top - v.y) / v.z };
  }, []);

  /* a roda continua dando zoom/pan no quadro mesmo com uma ferramenta de desenho ativa */
  useEffect(() => {
    const el = layer.current!;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      document.querySelector("svg.canvas")?.dispatchEvent(new WheelEvent("wheel", e));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const undoLast = () => {
    const top = Math.max(0, ...strokes.map((s) => s.id), ...notes.map((n) => n.id));
    setStrokes((all) => all.filter((s) => s.id !== top));
    setNotes((all) => all.filter((n) => n.id !== top));
  };
  const clearAll = () => (setStrokes([]), setNotes([]), setEditing(null));

  /* atalhos */
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest?.("input,textarea,[contenteditable],.rich-editor,.rich-toolbar")) return;
      const k = e.key.toLowerCase();
      if (e.ctrlKey || e.metaKey) {
        if (k === "z") {
          e.preventDefault();
          undoLast();
        }
        return;
      }
      if (k === "escape") {
        if (tool !== "navigate") setTool("navigate");
        else exitPresent();
      } else if (k === "v") setTool("navigate");
      else if (k === "p" || k === "d") setTool("pen");
      else if (k === "h") setTool("highlight");
      else if (k === "l") setTool("laser");
      else if (k === "e") setTool("eraser");
      else if (k === "t") setTool("text");
      else if (k === "i") setTool("list");
      else if (k === "x" || k === "delete") clearAll();
      else if (k === "f") fitView();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [tool, strokes, notes]);

  /* saiu da tela cheia pelo navegador (Esc) → encerra a apresentação */
  useEffect(() => {
    let wasFull = !!document.fullscreenElement;
    const onFs = () => {
      if (document.fullscreenElement) wasFull = true;
      else if (wasFull && !recordingGrace()) exitPresent();
    };
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  /* o rastro do laser some sozinho */
  useEffect(() => {
    if (!trail.length) return;
    const id = setInterval(() => setTrail((t) => t.filter((p) => Date.now() - p.t < 450)), 60);
    return () => clearInterval(id);
  }, [trail.length > 0]);

  const down = (e: React.PointerEvent) => {
    if (e.button !== 0 || tool === "navigate" || tool === "laser") return;
    const z = getState().view.z;
    if (tool === "text" || tool === "list") {
      const p = toWorld(e);
      const id = ++idc.current;
      setNotes((all) => [...all, { id, kind: tool, color, x: p.x, y: p.y, fs: 22, text: tool === "list" ? "- " : "" }]);
      setEditing(id);
      return;
    }
    layer.current!.setPointerCapture(e.pointerId);
    if (tool === "eraser") {
      erasing.current = true;
      eraseAt(e);
      return;
    }
    const hl = tool === "highlight";
    const c = cfg[hl ? "highlight" : "pen"];
    cur.current = { id: ++idc.current, kind: hl ? "highlight" : "pen", color, width: c.width / z, dash, opacity: c.opacity, pts: [toWorld(e)] };
    setStrokes((s) => [...s, cur.current!]);
  };
  const eraseAt = (e: { clientX: number; clientY: number }) => {
    const p = toWorld(e);
    const r = 10 / getState().view.z;
    setStrokes((all) => all.filter((s) => !s.pts.some((q) => Math.hypot(q.x - p.x, q.y - p.y) < r + s.width / 2)));
    if (getState().eraseMode === "ink") return;
    setNotes((all) =>
      all.filter((n) => {
        const { w, h } = noteBounds(n);
        return !(p.x >= n.x - r && p.x <= n.x + w + r && p.y >= n.y - r && p.y <= n.y + h + r);
      }),
    );
  };
  const move = (e: React.PointerEvent) => {
    if (tool === "laser") {
      setCursor({ x: e.clientX, y: e.clientY });
      setTrail((t) => [...t.slice(-24), { x: e.clientX, y: e.clientY, t: Date.now() }]);
      return;
    }
    if (erasing.current) return eraseAt(e);
    const s = cur.current;
    if (!s) return;
    const p = toWorld(e);
    const last = s.pts[s.pts.length - 1];
    if (Math.hypot(p.x - last.x, p.y - last.y) * getState().view.z < 1.5) return;
    const next = { ...s, pts: [...s.pts, p] };
    cur.current = next;
    setStrokes((all) => all.map((x) => (x.id === next.id ? next : x)));
  };
  const up = (e: React.PointerEvent) => {
    cur.current = null;
    erasing.current = false;
    if (layer.current?.hasPointerCapture(e.pointerId)) layer.current.releasePointerCapture(e.pointerId);
  };

  const drawing = tool !== "navigate";
  const tools: { id: PresentTool; icon: string; label: string; key: string }[] = [
    { id: "navigate", icon: "hand", label: "Navegar", key: "V" },
    { id: "pen", icon: "pen", label: "Caneta", key: "P" },
    { id: "highlight", icon: "highlighter", label: "Marca-texto", key: "H" },
    { id: "eraser", icon: "eraser", label: "Borracha", key: "E" },
    { id: "text", icon: "text", label: "Texto", key: "T" },
    { id: "list", icon: "list", label: "Lista", key: "I" },
    { id: "laser", icon: "laser", label: "Laser", key: "L" },
  ];

  return (
    <>
      <svg
        ref={layer}
        className={`present-layer${drawing ? " on" : ""} t-${tool}`}
        onPointerDown={down}
        onMouseDown={(e) => (tool === "text" || tool === "list") && e.preventDefault()}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onPointerLeave={() => setCursor(null)}
      >
        <g transform={`translate(${view.x},${view.y}) scale(${view.z})`}>
          {strokes.map((s) => (
            <path key={s.id} d={pathOf(s.pts)} fill="none" {...strokeAttrs(s)} />
          ))}
          {notes.map(
            (n) =>
              n.id !== editing && (
                <PresentNoteShape
                  key={n.id}
                  n={n}
                  onEdit={tool === "text" || tool === "list" ? () => setEditing(n.id) : undefined}
                />
              ),
          )}
        </g>
        {tool === "laser" && (
          <g pointerEvents="none">
            {trail.map((p, i) => {
              const age = (Date.now() - p.t) / 450;
              return <circle key={i} cx={p.x} cy={p.y} r={4 + (i / trail.length) * 5} fill="#ff2d3d" opacity={Math.max(0, 0.55 * (1 - age))} />;
            })}
            {cursor && (
              <>
                <circle cx={cursor.x} cy={cursor.y} r={16} fill="#ff2d3d" opacity={0.28} />
                <circle cx={cursor.x} cy={cursor.y} r={7} fill="#ff2d3d" />
              </>
            )}
          </g>
        )}
      </svg>

      {notes.map((n) => {
        if (n.id !== editing) return null;
        const left = view.x + n.x * view.z;
        const top = view.y + n.y * view.z;
        const fs = n.fs * view.z;
        const above = top > 56;
        return (
          <PresentNoteEditor
            key={n.id}
            n={n}
            left={left}
            top={top}
            fs={fs}
            toolbarTop={above ? top - 44 : top + noteBounds(n).h * view.z + 6}
            onChange={(text) => setNotes((all) => all.map((x) => (x.id === n.id ? { ...x, text } : x)))}
            onCard={(patch) =>
              setNotes((all) =>
                all.map((x) => {
                  if (x.id !== n.id) return x;
                  if ("fontSize" in patch && patch.fontSize != null) return { ...x, fs: patch.fontSize };
                  return x;
                }),
              )
            }
            onClose={() => {
              setEditing(null);
              setNotes((all) => all.filter((x) => x.id !== n.id || plainText(x.text).trim()));
            }}
          />
        );
      })}

      <Timer />
      <RecordControls />
      {mode === "domain" ? <StoryPanel /> : mode === "architecture" ? <TourPanel /> : null}

      <div className="hud glass present-bar" role="toolbar" aria-label="Ferramentas de apresentação">
        {tools.map((t) => (
          <button key={t.id} className={`tool ${tool === t.id ? "active" : ""}`} onClick={() => setTool(t.id)} aria-label={t.label} aria-pressed={tool === t.id} aria-keyshortcuts={t.key} data-tip={`${t.label} (${t.key})`} data-tip-pos="top">
            <Glyph name={t.icon} size={21} />
            <kbd className="tool-key" aria-hidden>
              {t.key}
            </kbd>
          </button>
        ))}
        <div className="rule" />
        {tool === "eraser" && <EraseModes />}
        {(tool === "pen" || tool === "highlight") && optsFor === tool && <InkOptions tool={tool} color={color} onClose={() => setOptsFor(null)} />}
        <div className="swatches" role="radiogroup" aria-label="Cor">
          {COLORS.map((c) => (
            <button key={c.id} role="radio" aria-checked={color === c.id} aria-label={c.name} className={`swatch ${color === c.id ? "active" : ""}`} style={{ background: c.id }} onClick={() => {
              const t = tool === "text" || tool === "list" ? tool : tool === "highlight" ? tool : "pen";
              set({ inkColor: c.id });
              setTool(t);
              setOptsFor(t);
            }} data-tip={c.name} data-tip-pos="top" />
          ))}
        </div>
        <div className="rule" />
        <button className="tool" onClick={undoLast} disabled={!strokes.length && !notes.length} aria-label="Desfazer traço" data-tip="Desfazer último traço (Ctrl+Z)" data-tip-pos="top">
          <Glyph name="undo" size={19} />
        </button>
        <button className="tool" onClick={clearAll} disabled={!strokes.length && !notes.length} aria-label="Apagar desenhos" data-tip="Apagar todos os desenhos (X)" data-tip-pos="top">
          <Glyph name="trash" size={19} />
        </button>
        <button className="tool" onClick={() => fitView()} aria-label="Ajustar à tela" data-tip="Ajustar à tela (F)" data-tip-pos="top">
          <Glyph name="fit" size={19} />
        </button>
        <div className="rule" />
        <button className="btn sm present-exit" onClick={exitPresent} data-tip="Sair da apresentação (Esc)" data-tip-pos="top">
          <Glyph name="close" size={16} /> Sair
        </button>
      </div>
    </>
  );
}
