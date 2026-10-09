import { createContext, memo, type CSSProperties, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { applyOps, fitGroup, isContainerOf } from "../shared/ops";
import type { Asset } from "../shared/schema";
import { CONNECTION_TYPES, ENDPOINT_PROTOCOLS, endpointBadge, endpointColor, type ConnectionEl, type ConnectionType, type Doc, type GroupEl, type NodeEl, type NoteEl } from "../shared/schema";
import { IconSvg } from "./icons";
import { contains, edgeGeoms, intersects, normRect, previewGeom, sidePoint, type Pt, type Side } from "./geometry";
import { PresetPattern, presetById } from "./bgpresets";
import { addRefNode, beginTx, commit, endTx, getState, live, lookupAsset, placeAsset, run, select, set, useStore, type View } from "./store";
import { fitView, spaceHeld } from "./keys";
import { inkPath, strokeAttrs } from "./ink";

const GROUP_COLORS: Record<string, string> = {
  boundary: "#706fd3",
  layer: "#2f80ed",
  cloud: "#e08a1e",
  network: "#14a38b",
  context: "#c2410c",
  cluster: "#7a5af8",
  team: "#d6453d",
};

/** Cursor em forma de borracha (SVG embutido); o ponto ativo fica na ponta inferior esquerda. */
const ERASER_CURSOR = `url("data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke-linejoin="round" stroke-linecap="round"><g transform="rotate(-35 12 12)"><rect x="3" y="8" width="18" height="9" rx="2.5" fill="#fff" stroke="#25244a" stroke-width="1.6"/><path d="M11 8v9" stroke="#25244a" stroke-width="1.6"/><rect x="3.8" y="8.8" width="7.2" height="7.4" rx="1.8" fill="#f2a1b3"/></g></svg>',
)}") 5 22, cell`;

function distToSegment(p: Pt, a: Pt, b: Pt) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const t = dx || dy ? clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy), 0, 1) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const snapV = (v: number, on: boolean) => (on ? Math.round(v / 8) * 8 : v);

type Drag =
  | { kind: "pan"; sx: number; sy: number; vx: number; vy: number }
  | { kind: "move"; start: Pt; origin: Map<string, Pt>; moved: boolean; id?: string }
  | { kind: "marquee"; start: Pt; cur: Pt; additive: boolean; base: string[] }
  | { kind: "resize"; id: string; start: Pt; orig: { w: number; h: number } }
  | { kind: "waypoint"; id: string; idx: number }
  | { kind: "connect"; from: string; side: Side; cur: Pt }
  | { kind: "create"; tool: "group" | "note" | "text" | "list"; start: Pt; cur: Pt }
  | { kind: "ink"; id: string; pts: Pt[] }
  | { kind: "erase" };

/* ───────────────────────── formas ───────────────────────── */

const truncate = (s: string, max: number) => (s.length > max ? s.slice(0, max - 1) + "…" : s);

/** Componente de comunicação: selo colorido (GET, POST, WS, QUERY…) + caminho, no estilo de nós do n8n. */
const EndpointShape = memo(function EndpointShape({ n, selected, hot, hovered }: { n: NodeEl; selected: boolean; hot: boolean; hovered: boolean }) {
  const e = n.endpoint!;
  const color = endpointColor(e);
  const badge = endpointBadge(e);
  const bw = Math.max(44, badge.length * 8.4 + 18);
  const path = e.path ?? n.label;
  return (
    <g data-id={n.id} data-role="node" transform={`translate(${n.x},${n.y})`} className={`node endpoint${selected ? " sel" : ""}${hot ? " drop-target" : ""}`}>
      <title>{`${ENDPOINT_PROTOCOLS[e.protocol].label} · ${badge} ${path}${n.description ? "\n" + n.description : ""}`}</title>
      <rect className="node-body" width={n.w} height={n.h} rx={14} filter="url(#shadow)" style={fillStyle(n)} />
      <rect className="node-ring" width={n.w} height={n.h} rx={14} pointerEvents="none" />
      <rect x={6} y={6} width={bw} height={n.h - 12} rx={9} fill={color} pointerEvents="none" />
      <text x={6 + bw / 2} y={n.h / 2 + 0.5} className="ep-badge" pointerEvents="none">
        {badge}
      </text>
      <text x={bw + 16} y={n.h / 2 + 4.5} className="ep-path" pointerEvents="none">
        {truncate(path, Math.floor((n.w - bw - 28) / 7.2))}
      </text>
      {n.description && <circle cx={n.w - 11} cy={11} r={2.8} fill={color} opacity={0.8} pointerEvents="none" />}
      {(hovered || selected) && <Handles id={n.id} w={n.w} h={n.h} />}
    </g>
  );
});

/** Estilo inline do fundo (cor + transparência) de nós e grupos; vazio mantém o padrão do tema. */
const fillStyle = (e: { fill?: string; fillOpacity?: number }): CSSProperties | undefined =>
  e.fill || e.fillOpacity != null ? { ...(e.fill ? { fill: e.fill } : {}), ...(e.fillOpacity != null ? { fillOpacity: e.fillOpacity } : {}) } : undefined;

const refName = (n: NodeEl) => {
  const base = (n.ref?.diagram ?? "").split("/").pop()?.replace(".archflow.json", "") ?? "";
  return `↗ ${base}${n.ref?.node ? ` › ${n.ref.node}` : ""}`;
};

/** Assets personalizados do diagrama exibido (no visualizador, o diagrama é outro). */
export const ViewerAssets = createContext<Asset[] | null>(null);

export const NodeShape = memo(function NodeShape({ n, selected, hot, hovered }: { n: NodeEl; selected: boolean; hot: boolean; hovered: boolean }) {
  const extra = useContext(ViewerAssets);
  const asset = extra?.find((a) => a.id === n.asset) ?? lookupAsset(n.asset);
  const color = asset?.color ?? "#706fd3";
  const chars = Math.floor((n.w - 78) / 7);
  if (n.kind === "endpoint" && n.endpoint) return <EndpointShape n={n} selected={selected} hot={hot} hovered={hovered} />;
  return (
    <g data-id={n.id} data-role="node" transform={`translate(${n.x},${n.y})`} className={`node${n.ref ? " ref" : ""}${selected ? " sel" : ""}${hot ? " drop-target" : ""}`}>
      {n.ref && (
        <>
          <rect className="ref-page" x={14} y={-12} width={n.w - 28} height={n.h} rx={16} pointerEvents="none" opacity={0.45} />
          <rect className="ref-page" x={7} y={-6} width={n.w - 14} height={n.h} rx={17} pointerEvents="none" opacity={0.75} />
        </>
      )}
      <rect className="node-body" width={n.w} height={n.h} rx={18} filter="url(#shadow)" style={fillStyle(n)} />
      <rect className="node-sheen" width={n.w} height={n.h} rx={18} fill="url(#sheen)" pointerEvents="none" />
      <rect className="node-ring" width={n.w} height={n.h} rx={18} pointerEvents="none" />
      <rect x={14} y={(n.h - 44) / 2} width={44} height={44} rx={13} fill="#fff" fillOpacity={0.85} stroke={color} strokeOpacity={0.28} pointerEvents="none" />
      <IconSvg icon={asset?.icon ?? `t:${n.label.slice(0, 2).toUpperCase()}`} color={color} name={asset?.name ?? n.label} size={28} x={22} y={(n.h - 28) / 2} />
      <text className="node-label" x={68} y={n.technology || n.kind ? n.h / 2 - 3 : n.h / 2 + 5} pointerEvents="none">
        {truncate(n.label, chars)}
      </text>
      <text className="node-sub" x={68} y={n.h / 2 + 15} pointerEvents="none">
        {truncate(n.ref ? refName(n) : n.technology ?? asset?.name ?? n.kind, chars + 2)}
      </text>
      {n.description && !n.ref && <circle cx={n.w - 14} cy={14} r={3} fill={color} opacity={0.7} pointerEvents="none" />}
      {n.ref && (
        <g data-role="open-ref" data-id={n.id} className="open-ref" transform={`translate(${n.w - 24},${n.h / 2 - 10})`}>
          <title>Abrir o diagrama referenciado</title>
          <circle cx={10} cy={10} r={13} fill="transparent" />
          <circle cx={10} cy={10} r={10} />
          <path d="M6.5 13.5L13.5 6.5M8 6.5h5.5V12" />
        </g>
      )}
      {(hovered || selected) && <Handles id={n.id} w={n.w} h={n.h} />}
    </g>
  );
});

export const GroupShape = memo(function GroupShape({ g, selected, hot, hovered }: { g: GroupEl; selected: boolean; hot: boolean; hovered: boolean }) {
  const color = g.color ?? GROUP_COLORS[g.kind] ?? "#706fd3";
  return (
    <g data-id={g.id} data-role="group" transform={`translate(${g.x},${g.y})`} className={`group${selected ? " sel" : ""}${hot ? " drop-target" : ""}`} style={{ ["--gc" as string]: color }}>
      <rect className="group-body" width={g.w} height={g.h} rx={26} style={fillStyle(g)} />
      <rect className="group-edge" width={g.w} height={g.h} rx={26} pointerEvents="none" />
      <g pointerEvents="none">
        <text className="group-kind" x={20} y={24}>
          {g.kind.toUpperCase()}
        </text>
        <text className="group-label" x={20} y={44}>
          {truncate(g.label, Math.floor((g.w - 40) / 9))}
        </text>
      </g>
      {(hovered || selected) && <Handles id={g.id} w={g.w} h={g.h} />}
      {selected && <ResizeGrip w={g.w} h={g.h} />}
    </g>
  );
});

function Handles({ id, w, h }: { id: string; w: number; h: number }) {
  return (
    <>
      {(["left", "right", "top", "bottom"] as Side[]).map((s) => {
        const p = sidePoint({ x: 0, y: 0, w, h }, s);
        const o = { left: [-16, 0], right: [16, 0], top: [0, -16], bottom: [0, 16] }[s];
        // tamanho constante na tela, independente do zoom
        return (
          <g key={s} data-role="handle" data-id={id} data-side={s} className="handle" style={{ transform: `translate(${p.x}px,${p.y}px) scale(calc(1 / var(--z))) translate(${o[0]}px,${o[1]}px)` }}>
            <circle r={13} fill="transparent" />
            <circle r={7} />
            <path d="M-3 0h6M0 -3v6" />
          </g>
        );
      })}
    </>
  );
}

function ResizeGrip({ w, h }: { w: number; h: number }) {
  return (
    <g data-role="resize" transform={`translate(${w - 4},${h - 4})`} className="grip">
      <circle r={12} fill="transparent" />
      <path d="M-8 2L2 -8M-8 8L8 -8" />
    </g>
  );
}

const NOTE_STYLE = {
  note: { fs: 13, lh: 17, x: 14, top: 28, cw: 6.8, indent: 0 },
  text: { fs: 19, lh: 26, x: 10, top: 28, cw: 10.2, indent: 0 },
  list: { fs: 15, lh: 23, x: 16, top: 30, cw: 8, indent: 20 },
};

const PlainNote = memo(function PlainNote({ n, selected }: { n: NoteEl; selected: boolean }) {
  const v = n.variant ?? "note";
  // texto livre: a fonte acompanha a altura da caixa (arrastar uma caixa maior gera texto maior)
  const paras = Math.max(1, n.text.split("\n").length);
  const tfs = Math.min(120, Math.max(12, (n.h - 10) / (paras * 1.3)));
  const st = v === "text" ? { fs: tfs, lh: tfs * 1.3, x: 10, top: tfs * 1.05 + 4, cw: tfs * 0.54, indent: 0 } : NOTE_STYLE[v];
  const lines = useMemo(() => {
    const out: { t: string; bullet?: string }[] = [];
    const per = Math.max(4, Math.floor((n.w - st.x * 2 - st.indent) / st.cw));
    for (const raw of n.text.split("\n")) {
      let para = raw;
      let bullet: string | undefined;
      if (v === "list") {
        const box = /^\s*(?:[-*]\s*)?\[( |x|X)\]\s?/.exec(para);
        if (box) bullet = box[1] === " " ? "☐" : "☑";
        para = para.replace(/^\s*(?:[-*]\s+|(?:[-*]\s*)?\[( |x|X)\]\s?)/, "");
        bullet ??= "•";
      }
      let cur = "";
      let first = true;
      const flush = () => {
        out.push({ t: cur, bullet: first ? bullet : undefined });
        first = false;
      };
      for (const w of para.split(" ")) {
        if ((cur + " " + w).trim().length > per) {
          flush();
          cur = w;
        } else cur = (cur + " " + w).trim();
      }
      flush();
    }
    return out.slice(0, Math.max(1, Math.floor((n.h - 12) / st.lh)));
  }, [n.text, n.w, n.h, v, st.fs]);
  const fill = n.color ?? (v === "note" ? undefined : "var(--ink)");
  return (
    <g data-id={n.id} data-role="note" transform={`translate(${n.x},${n.y})`} className={`note ${v}${selected ? " sel" : ""}`}>
      <rect className="note-body" width={n.w} height={n.h} rx={14} filter={v === "text" ? undefined : "url(#shadow)"} />
      {v === "list" && <rect x={0} y={10} width={4} height={n.h - 20} rx={2} fill={n.color ?? "var(--primary-600)"} pointerEvents="none" />}
      {lines.map((l, i) => (
        <g key={i} pointerEvents="none">
          {l.bullet && (
            <text x={st.x} y={st.top + i * st.lh} className="note-text" style={{ fontSize: st.fs, fill }}>
              {l.bullet}
            </text>
          )}
          <text x={st.x + st.indent} y={st.top + i * st.lh} className="note-text" style={{ fontSize: st.fs, fontWeight: v === "text" ? 600 : undefined, fill }}>
            {l.t}
          </text>
        </g>
      ))}
      {selected && <ResizeGrip w={n.w} h={n.h} />}
    </g>
  );
});

const LIST_LH = 24;
const LIST_COLOR = "#706fd3";
const BOX_RE = /^(\s*(?:[-*]\s*)?)\[( |x|X)\]\s?/;

/** Alterna o estado "feito" de uma linha de lista ("[ ] " ↔ "[x] "); sem prefixo, marca como feita. */
export const toggleListLine = (line: string) => {
  const m = BOX_RE.exec(line);
  return m ? line.replace(BOX_RE, m[2] === " " ? "[x] " : "[ ] ") : "[x] " + line.replace(/^\s*[-*]\s+/, "");
};

/** Lista estilizada: título, itens separados por linhas finas e, opcionalmente, checklist com caixas clicáveis. */
const ListShape = memo(function ListShape({ n, selected }: { n: NoteEl; selected: boolean }) {
  const color = n.color ?? LIST_COLOR;
  const { title, rows, seps } = useMemo(() => {
    const all = n.text.split("\n");
    let title = n.title;
    let from = 0;
    if (title === undefined) {
      const m = /^#\s+(.*)$/.exec(all[0] ?? "");
      if (m) (title = m[1]), (from = 1); // formato antigo: "# Título" na primeira linha
    }
    const rows: { y: number; t: string; mark: "dot" | "todo" | "done" | null; para: number }[] = [];
    const seps: number[] = [];
    const per = Math.max(4, Math.floor((n.w - 34 - 46) / 7.6));
    let top = title ? 44 : 8;
    if (title) seps.push(top - 4);
    all.forEach((raw, para) => {
      if (para < from) return;
      const box = BOX_RE.exec(raw);
      const asCheck = n.checklist ?? !!box;
      const body = box ? raw.replace(BOX_RE, "") : raw.replace(/^\s*[-*]\s+/, "");
      const mark = asCheck ? (box && box[2] !== " " ? "done" : "todo") : "dot";
      const wrapped: string[] = [];
      let cur = "";
      for (const w of body.split(" ")) {
        if ((cur + " " + w).trim().length > per) {
          wrapped.push(cur);
          cur = w;
        } else cur = (cur + " " + w).trim();
      }
      wrapped.push(cur);
      if (para > from) seps.push(top);
      wrapped.forEach((t, i) => rows.push({ y: top + 6 + 17 + i * LIST_LH, t, mark: i === 0 ? mark : null, para }));
      top += 12 + wrapped.length * LIST_LH;
    });
    return { title, rows: rows.filter((r) => r.y + 10 <= n.h), seps: seps.filter((y) => y < n.h - 8) };
  }, [n.text, n.title, n.checklist, n.w, n.h]);
  return (
    <g data-id={n.id} data-role="note" transform={`translate(${n.x},${n.y})`} className={`note list${selected ? " sel" : ""}`} style={{ ["--lc" as string]: color }}>
      <rect className="note-body" width={n.w} height={n.collapsed && title ? 46 : n.h} rx={18} filter="url(#shadow)" />
      {title && <CollapseToggle id={n.id} x={n.w - 26} y={23} collapsed={!!n.collapsed} />}
      <path d={`M18 0.8H${n.w - 18}`} stroke={color} strokeWidth={3} strokeLinecap="round" pointerEvents="none" opacity={0.9} />
      {title && (
        <text x={18} y={31} className="list-title" pointerEvents="none">
          {truncate(title, Math.floor((n.w - 70) / 9))}
        </text>
      )}
      {!(n.collapsed && title) && seps.map((y, i) => (
        <path key={i} d={`M${i === 0 && title ? 14 : 38} ${y}H${n.w - 14}`} className="list-sep" pointerEvents="none" />
      ))}
      {!(n.collapsed && title) && rows.map((r, i) => (
        <g key={i} transform={`translate(0,${r.y - 17})`}>
          {r.mark === "dot" && <circle cx={22} cy={12.5} r={3.6} fill={color} pointerEvents="none" />}
          {(r.mark === "todo" || r.mark === "done") && (
            <g data-role="check" data-id={n.id} data-para={r.para} className="list-check">
              <rect x={13} y={3} width={19} height={19} fill="transparent" />
              <rect x={14.5} y={4.5} width={16} height={16} rx={5} fill={r.mark === "done" ? color : "none"} stroke={color} strokeWidth={1.8} />
              {r.mark === "done" && <path d="M18.4 12.8l3.1 3.1 5.2-6" fill="none" stroke="#fff" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />}
            </g>
          )}
          <text x={40} y={17} className={`list-item${r.mark === "done" ? " done" : ""}`} pointerEvents="none">
            {r.t}
          </text>
        </g>
      ))}
      {selected && !(n.collapsed && title) && <ResizeGrip w={n.w} h={n.h} />}
    </g>
  );
});

/** Layout do checklist (cartão com título, progresso e lista de tarefas em caixa). Também calcula a altura total. */
export function checklistLayout(n: Pick<NoteEl, "text" | "title" | "w">&{ subtitle?: string }) {
  const all = n.text.split("\n");
  let title = n.title;
  let from = 0;
  if (title === undefined) {
    const m = /^#\s+(.*)$/.exec(all[0] ?? "");
    if (m) (title = m[1]), (from = 1);
  }
  const wrap = (txt: string, per: number) => {
    const out: string[] = [];
    let cur = "";
    for (const w of txt.split(" ")) {
      if ((cur + " " + w).trim().length > per) {
        out.push(cur);
        cur = w;
      } else cur = (cur + " " + w).trim();
    }
    out.push(cur);
    return out;
  };
  const sub = n.subtitle ? n.subtitle.split("\n").flatMap((l) => wrap(l, Math.floor((n.w - 36) / 7.2))) : [];
  let y = title ? 52 : 20;
  const subY = y;
  y += sub.length ? sub.length * 19 + 6 : 0;
  const pctY = y + 16;
  const barY = y + 26;
  y = barY + 6 + 18;
  const boxY = y;
  const per = Math.max(4, Math.floor((n.w - 24 - 28 - 44) / 7.4));
  const rows: { y: number; h: number; lines: string[]; para: number; done: boolean }[] = [];
  let ry = boxY;
  all.forEach((raw, para) => {
    if (para < from) return;
    const box = BOX_RE.exec(raw);
    const body = (box ? raw.replace(BOX_RE, "") : raw.replace(/^\s*[-*]\s+/, "")) || " ";
    const lines = wrap(body, per);
    const h = Math.max(46, lines.length * 20 + 26);
    rows.push({ y: ry, h, lines, para, done: !!box && box[2] !== " " });
    ry += h;
  });
  const done = rows.filter((r) => r.done).length;
  return { title, sub, subY, pctY, barY, headH: barY + 6 + 18, boxY, boxH: ry - boxY, rows, done, total: Math.round(ry + 18) };
}

/** Checklist no estilo "cartão de progresso": título, % concluído, barra e tarefas com indicador à direita. */
/** Seta de expandir/retrair no canto do cabeçalho (clicável; tratada em onPointerDown). */
function CollapseToggle({ id, x, y, collapsed }: { id: string; x: number; y: number; collapsed: boolean }) {
  return (
    <g data-role="collapse" data-id={id} className="cl-collapse" transform={`translate(${x},${y})`}>
      <title>{collapsed ? "Expandir" : "Retrair"}</title>
      <circle r={13} fill="transparent" />
      <path d="M-5 2.5L0 -2.5L5 2.5" fill="none" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" style={{ transform: collapsed ? "rotate(180deg)" : undefined }} />
    </g>
  );
}

const ChecklistShape = memo(function ChecklistShape({ n, selected }: { n: NoteEl; selected: boolean }) {
  const color = n.color ?? LIST_COLOR;
  const L = useMemo(() => checklistLayout(n), [n.text, n.title, n.subtitle, n.w]);
  const pct = L.rows.length ? Math.round((L.done / L.rows.length) * 100) : 0;
  const inner = n.w - 24;
  const cid = `cl-${n.id}`;
  const H = n.collapsed ? L.headH : n.h;
  return (
    <g data-id={n.id} data-role="note" transform={`translate(${n.x},${n.y})`} className={`note list checklist${selected ? " sel" : ""}`} style={{ ["--lc" as string]: color }}>
      <clipPath id={cid}>
        <rect width={n.w} height={H} rx={20} />
      </clipPath>
      <rect className="note-body" width={n.w} height={H} rx={20} filter="url(#shadow)" />
      <CollapseToggle id={n.id} x={n.w - 28} y={24} collapsed={!!n.collapsed} />
      <g clipPath={`url(#${cid})`}>
        {L.title && (
          <text x={18} y={34} className="cl-title" pointerEvents="none">
            {truncate(L.title, Math.floor((n.w - 70) / 9.5))}
          </text>
        )}
        {L.sub.map((t, i) => (
          <text key={i} x={18} y={L.subY + 13 + i * 19} className="cl-sub" pointerEvents="none">
            {t}
          </text>
        ))}
        <text x={18} y={L.pctY} className="cl-pct" pointerEvents="none">
          {pct}%
        </text>
        <text x={n.w - 18} y={L.pctY} textAnchor="end" className="cl-count" pointerEvents="none">
          {L.done} de {L.rows.length} concluídas
        </text>
        <rect x={18} y={L.barY} width={n.w - 36} height={6} rx={3} className="cl-track" pointerEvents="none" />
        {pct > 0 && <rect x={18} y={L.barY} width={((n.w - 36) * pct) / 100} height={6} rx={3} fill={color} pointerEvents="none" />}
        {!n.collapsed && <rect x={12} y={L.boxY} width={inner} height={L.boxH} rx={14} className="cl-box" pointerEvents="none" />}
        {!n.collapsed && L.rows.map((r, i) => (
          <g key={i} data-role="check" data-id={n.id} data-para={r.para} className="list-check cl-row">
            <rect x={12} y={r.y} width={inner} height={r.h} fill="transparent" />
            {i > 0 && <path d={`M12 ${r.y}H${12 + inner}`} className="cl-sep" pointerEvents="none" />}
            {r.lines.map((t, k) => (
              <text key={k} x={26} y={r.y + r.h / 2 + 5 - ((r.lines.length - 1) * 10) + k * 20} className={`cl-item${r.done ? " done" : ""}`} pointerEvents="none">
                {t}
              </text>
            ))}
            <g transform={`translate(${12 + inner - 28},${r.y + r.h / 2})`} pointerEvents="none">
              {r.done ? (
                <>
                  <circle r={11} fill={color} />
                  <path d="M-4.2 0.3l2.8 2.8 5.6-6" fill="none" stroke="#fff" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
                </>
              ) : (
                <>
                  <circle r={11} className="cl-dot" />
                  <path d="M-4.2 0.3l2.8 2.8 5.6-6" fill="none" className="cl-chev" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
                </>
              )}
            </g>
          </g>
        ))}
      </g>
      {selected && !n.collapsed && <ResizeGrip w={n.w} h={n.h} />}
    </g>
  );
});

export const NoteShape = memo(function NoteShape({ n, selected }: { n: NoteEl; selected: boolean }) {
  if (n.variant === "list" && n.checklist) return <ChecklistShape n={n} selected={selected} />;
  return n.variant === "list" ? <ListShape n={n} selected={selected} /> : <PlainNote n={n} selected={selected} />;
});

function Marker({ type }: { type: ConnectionType }) {
  const t = CONNECTION_TYPES[type];
  const c = t.color;
  return (
    <>
      {t.head === "arrow" && (
        <marker id={`h-${type}`} viewBox="0 0 12 12" refX="10" refY="6" markerWidth="11" markerHeight="11" orient="auto" markerUnits="userSpaceOnUse">
          <path d="M1 1.5L10.5 6L1 10.5z" fill={c} />
        </marker>
      )}
      {t.head === "open" && (
        <marker id={`h-${type}`} viewBox="0 0 12 12" refX="10" refY="6" markerWidth="12" markerHeight="12" orient="auto" markerUnits="userSpaceOnUse">
          <path d="M2 1.5L10.5 6L2 10.5" fill="none" stroke={c} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </marker>
      )}
      {t.head === "triangle" && (
        <marker id={`h-${type}`} viewBox="0 0 14 14" refX="12.5" refY="7" markerWidth="14" markerHeight="14" orient="auto" markerUnits="userSpaceOnUse">
          <path d="M1.5 1.5L12.5 7L1.5 12.5z" style={{ fill: "var(--s-solid)" }} stroke={c} strokeWidth="1.6" strokeLinejoin="round" />
        </marker>
      )}
      {t.tail === "diamond" && (
        <marker id={`t-${type}`} viewBox="0 0 16 12" refX="1" refY="6" markerWidth="16" markerHeight="12" orient="auto" markerUnits="userSpaceOnUse">
          <path d="M1 6L8 1.5L15 6L8 10.5z" fill={c} />
        </marker>
      )}
      {t.tail === "diamond-open" && (
        <marker id={`t-${type}`} viewBox="0 0 16 12" refX="1" refY="6" markerWidth="16" markerHeight="12" orient="auto" markerUnits="userSpaceOnUse">
          <path d="M1 6L8 1.5L15 6L8 10.5z" style={{ fill: "var(--s-solid)" }} stroke={c} strokeWidth="1.5" strokeLinejoin="round" />
        </marker>
      )}
    </>
  );
}

export const Edge = memo(function Edge({ c, d, mid, selected, animate }: { c: ConnectionEl; d: string; mid: Pt; selected: boolean; animate: boolean }) {
  const t = CONNECTION_TYPES[c.type];
  const pid = `p-${c.id}`;
  const motion = animate && c.animated !== false ? t.motion : "none";
  const text = c.label ?? (c.protocol ? "" : t.label);
  const sub = c.label ? c.protocol : c.protocol;
  const w = Math.max(text.length * 6.8, (sub?.length ?? 0) * 5.8) + 22 + (c.interface ? 16 : 0);
  const showLabel = !!(text || sub || c.interface);
  const h = sub && text ? 36 : 26;
  return (
    <g data-id={c.id} data-role="conn" className={`edge${selected ? " sel" : ""}`} style={{ ["--ec" as string]: t.color }}>
      <path d={d} fill="none" stroke="transparent" strokeWidth={18} />
      {selected && <path d={d} className="edge-glow" fill="none" stroke={t.color} strokeWidth={9} strokeOpacity={0.18} strokeLinecap="round" />}
      <path
        id={pid}
        d={d}
        fill="none"
        stroke={t.color}
        strokeWidth={selected ? 2.6 : 2}
        strokeDasharray={t.dash}
        strokeLinecap="round"
        markerEnd={t.head !== "none" ? `url(#h-${c.type})` : undefined}
        markerStart={t.tail !== "none" ? `url(#t-${c.type})` : undefined}
        opacity={motion === "none" ? 0.95 : 0.55}
      />
      {motion === "flow" && <path d={d} fill="none" stroke={t.color} strokeWidth={3} strokeLinecap="round" strokeDasharray="0.1 16" className="flow" />}
      {motion === "pulse" &&
        [0, 1].map((i) => (
          <circle key={i} r={4.5} fill={t.color} className="particle">
            <animateMotion dur="2.6s" begin={`${i * 1.3}s`} repeatCount="indefinite" rotate="auto">
              <mpath href={`#${pid}`} />
            </animateMotion>
            <animate attributeName="opacity" values="0;1;1;0" keyTimes="0;0.1;0.85;1" dur="2.6s" begin={`${i * 1.3}s`} repeatCount="indefinite" />
          </circle>
        ))}
      {motion === "stream" &&
        [0, 1, 2, 3, 4].map((i) => (
          <circle key={i} r={2.8} fill={t.color}>
            <animateMotion dur="2s" begin={`${i * 0.4}s`} repeatCount="indefinite">
              <mpath href={`#${pid}`} />
            </animateMotion>
          </circle>
        ))}
      {showLabel && (
        <g transform={`translate(${mid.x},${mid.y})`} className="edge-label">
          <rect x={-w / 2} y={-h / 2} width={w} height={h} rx={h / 2.4} />
          <text y={sub && text ? -4 : 0} className="edge-label-main">
            {text}
          </text>
          {sub && (
            <text y={text ? 10 : 0} className="edge-label-sub">
              {sub}
            </text>
          )}
          {c.interface && (
            <g transform={`translate(${w / 2 - 14},${sub && text ? 0 : 0})`}>
              <circle r={4.5} fill={t.color} opacity={0.9} />
            </g>
          )}
        </g>
      )}
    </g>
  );
});

export const withWaypoints = (c: ConnectionEl, wps: Pt[]): ConnectionEl => {
  const { waypoints: _drop, ...rest } = c;
  return wps.length ? { ...rest, waypoints: wps } : rest;
};

/** Puxadores de uma conexão selecionada: pontos existentes (arraste; duplo clique remove) e "+" nos trechos para criar novos. */
function EdgeHandles({ c, g, z }: { c: ConnectionEl; g: { pts?: Pt[]; mid: Pt }; z: number }) {
  const pts = g.pts ?? [];
  const wps = c.waypoints ?? [];
  const r = clamp(6 / z, 4.5, 14);
  const color = CONNECTION_TYPES[c.type].color;
  return (
    <g className="edge-handles" style={{ ["--ec" as string]: color }}>
      {pts.slice(0, -1).map((a, i) => {
        const b = pts[i + 1];
        const m = pts.length === 2 ? g.mid : { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        return (
          <g key={`add-${i}`} data-role="wp-add" data-id={c.id} data-idx={i} className="wp-add" transform={`translate(${m.x},${m.y})`}>
            <title>Arraste para curvar o conector</title>
            <circle r={r * 1.9} fill="transparent" />
            <circle r={r * 0.75} />
          </g>
        );
      })}
      {wps.map((w, i) => (
        <g key={`wp-${i}`} data-role="wp" data-id={c.id} data-idx={i} className="wp" transform={`translate(${w.x},${w.y})`}>
          <title>Arraste para mover · duplo clique remove</title>
          <circle r={r * 1.7} fill="transparent" />
          <circle r={r} />
        </g>
      ))}
    </g>
  );
}

/* ───────────────────────── helpers de desenho (usados também pelo visualizador) ───────────────────────── */

/** Geometria das conexões, com "lanes" para pares repetidos. */
export const computeEdges = (doc: Doc) => edgeGeoms(doc);

/** Linhas pontilhadas "expõe" do serviço até cada endpoint. */
export function computeOwnerLinks(doc: Doc) {
  return doc.nodes.flatMap((e) => {
    const o = e.owner ? doc.nodes.find((n) => n.id === e.owner) : undefined;
    if (!o) return [];
    const sx = o.x + 22;
    const sy = o.y + o.h;
    const ey = e.y + e.h / 2;
    const r = Math.min(10, Math.max(0, ey - sy - 1), Math.max(0, e.x - sx));
    return [{ id: e.id, d: `M${sx},${sy} V${ey - r} Q${sx},${ey} ${sx + r},${ey} H${e.x}` }];
  });
}

/** Grupos do mais externo para o mais interno (para o desenho). */
export function sortedGroups(doc: Doc) {
  const depth = (g: GroupEl) => {
    let d = 0;
    let cur = g.parent;
    while (cur && d < 20) {
      d++;
      cur = doc.groups.find((x) => x.id === cur)?.parent;
    }
    return d;
  };
  return [...doc.groups].sort((a, b) => depth(a) - depth(b));
}

/** Filtros, gradientes e marcadores compartilhados pelos desenhos SVG. */
export function DiagramDefs() {
  return (
    <>
      <filter id="shadow" x="-20%" y="-20%" width="140%" height="160%">
        <feDropShadow dx="0" dy="8" stdDeviation="9" floodColor="#000000" floodOpacity="0.14" />
        <feDropShadow dx="0" dy="1" stdDeviation="1" floodColor="#000000" floodOpacity="0.1" />
      </filter>
      <linearGradient id="sheen" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" style={{ stopColor: "var(--sheen)", stopOpacity: "var(--sheen-a)" }} />
        <stop offset="0.5" style={{ stopColor: "var(--sheen)", stopOpacity: "var(--sheen-b)" }} />
      </linearGradient>
      {(Object.keys(CONNECTION_TYPES) as ConnectionType[]).map((k) => (
        <Marker key={k} type={k} />
      ))}
    </>
  );
}

/* ───────────────────────── canvas ───────────────────────── */

export function Canvas() {
  const doc = useStore((s) => s.doc);
  const sel = useStore((s) => s.sel);
  const tool = useStore((s) => s.tool);
  const view = useStore((s) => s.view);
  const animate = useStore((s) => s.animate);
  const snap = useStore((s) => s.snap);
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<Drag | null>(null);
  const [, force] = useState(0);
  const [hover, setHover] = useState<string | null>(null);
  const [hotDrop, setHotDrop] = useState<string | null>(null);
  const [panning, setPanning] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number; conn: string; at: Pt; idx: number; onPoint: boolean } | null>(null);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("pointerdown", close);
    window.addEventListener("blur", close);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("blur", close);
      window.removeEventListener("keydown", esc);
    };
  }, [menu]);

  const toWorld = useCallback((e: { clientX: number; clientY: number }): Pt => {
    const r = svgRef.current!.getBoundingClientRect();
    const v = getState().view;
    return { x: (e.clientX - r.left - v.x) / v.z, y: (e.clientY - r.top - v.y) / v.z };
  }, []);

  /* zoom/pan com a roda */
  useEffect(() => {
    const el = svgRef.current!;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const v = getState().view;
      const r = el.getBoundingClientRect();
      const mouseWheel = e.deltaX === 0 && Number.isInteger(e.deltaY) && Math.abs(e.deltaY) >= 50;
      if (e.ctrlKey || e.metaKey || mouseWheel) {
        const f = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0016));
        const z = clamp(v.z * f, 0.15, 3);
        const mx = e.clientX - r.left;
        const my = e.clientY - r.top;
        set({ view: { z, x: mx - ((mx - v.x) / v.z) * z, y: my - ((my - v.y) / v.z) * z } });
      } else {
        set({ view: { ...v, x: v.x - e.deltaX, y: v.y - e.deltaY } });
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  useEffect(() => {
    const fit = () => fitView(svgRef.current);
    fit();
    window.addEventListener("archflow:fit", fit);
    return () => window.removeEventListener("archflow:fit", fit);
  }, []);

  /**
   * Componente/grupo sob o cursor durante o arrasto de uma conexão. Percorre TODOS os elementos empilhados
   * no ponto (não só o do topo) e aceita também os pontos "+" e o botão ↗ de um componente como parte dele,
   * ignorando a própria origem — assim soltar em qualquer ponto do componente conecta.
   */
  const connectTarget = (x: number, y: number, from: string): string | null => {
    for (const el of document.elementsFromPoint(x, y)) {
      const r = (el as Element).closest?.("[data-role]") as SVGElement | null;
      const role = r?.dataset.role;
      const id = r?.dataset.id;
      if (id && id !== from && (role === "node" || role === "group" || role === "handle" || role === "open-ref")) return id;
    }
    return null;
  };

  const targetOf = (t: EventTarget | null) => {
    const el = (t as Element | null)?.closest?.("[data-role]") as SVGElement | null;
    return el ? { role: el.dataset.role!, id: el.dataset.id, side: el.dataset.side as Side | undefined } : null;
  };

  const groupAt = (p: Pt, d: Doc, exclude: Set<string>): GroupEl | undefined => {
    const cands = d.groups.filter((g) => !exclude.has(g.id) && contains(g, p));
    return cands.sort((a, b) => a.w * a.h - b.w * b.h)[0];
  };

  /** Borracha: no modo "tudo" remove o que o cursor toca — desenhos, componentes, textos, listas, notas, conexões e (pela borda) grupos. */
  const eraseAt = (p: Pt, e: { clientX: number; clientY: number }) => {
    const s = getState();
    let doc = s.doc;
    const ink = doc.ink ?? [];
    const r = 12 / s.view.z;
    const hit = (k: (typeof ink)[number]) => k.pts.some((q, i) => Math.hypot(q.x - p.x, q.y - p.y) <= r + k.width / 2 || (i > 0 && distToSegment(p, k.pts[i - 1], q) <= r + k.width / 2));
    const keep = ink.filter((k) => !hit(k));
    if (keep.length !== ink.length) doc = { ...doc, ink: keep };
    if (s.eraseMode === "ink") {
      if (doc !== s.doc) live(doc);
      return;
    }
    const ids = new Set<string>();
    for (const el of document.elementsFromPoint(e.clientX, e.clientY)) {
      const t = (el as Element).closest?.("[data-role]") as SVGElement | null;
      if (t?.dataset.id && (t.dataset.role === "node" || t.dataset.role === "note" || t.dataset.role === "conn")) ids.add(t.dataset.id);
    }
    // grupos só pela borda, para não apagar a fronteira inteira ao passar por dentro dela
    for (const g of doc.groups) {
      if (contains({ x: g.x - r, y: g.y - r, w: g.w + 2 * r, h: g.h + 2 * r }, p) && !contains({ x: g.x + r, y: g.y + r, w: g.w - 2 * r, h: g.h - 2 * r }, p)) ids.add(g.id);
    }
    if (ids.size) {
      doc = applyOps(doc, [...ids].map((id) => ({ op: "remove" as const, id }))).doc;
      set({ sel: [] });
    }
    if (doc !== s.doc) live(doc);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    const svg = svgRef.current!;
    const s = getState();
    const p = toWorld(e);
    const t = targetOf(e.target);
    if ((e.target as Element).closest("[data-ui]")) return;
    if (e.button === 2) return; // botão direito abre o menu de contexto (onContextMenu)
    svg.setPointerCapture(e.pointerId);

    if (e.button === 1 || s.tool === "hand" || spaceHeld()) {
      drag.current = { kind: "pan", sx: e.clientX, sy: e.clientY, vx: s.view.x, vy: s.view.y };
      setPanning(true);
      return;
    }
    if (s.tool === "pen" || s.tool === "highlight") {
      const hl = s.tool === "highlight";
      const id = "ink-" + Math.random().toString(36).slice(2, 8);
      beginTx();
      live({ ...s.doc, ink: [...(s.doc.ink ?? []), { id, kind: hl ? "highlight" : "pen", color: s.inkColor, width: s.inkCfg[hl ? "highlight" : "pen"].width / s.view.z, opacity: s.inkCfg[hl ? "highlight" : "pen"].opacity, dash: s.inkDash, pts: [p] }] });
      drag.current = { kind: "ink", id, pts: [p] };
      return;
    }
    if (s.tool === "eraser") {
      beginTx();
      drag.current = { kind: "erase" };
      eraseAt(p, e);
      return;
    }
    if (t?.role === "collapse" && t.id) {
      const doc = getState().doc;
      commit({ ...doc, notes: doc.notes.map((nt) => (nt.id === t.id ? { ...nt, collapsed: nt.collapsed ? undefined : true } : nt)) });
      return;
    }
    if (t?.role === "check" && t.id) {
      const para = Number((e.target as Element).closest("[data-role]")!.getAttribute("data-para"));
      const doc = getState().doc;
      commit({
        ...doc,
        notes: doc.notes.map((nt) => (nt.id === t.id ? { ...nt, text: nt.text.split("\n").map((l, i) => (i === para ? toggleListLine(l) : l)).join("\n") } : nt)),
      });
      return;
    }
    if (s.tool === "text" || s.tool === "list") {
      drag.current = { kind: "create", tool: s.tool, start: p, cur: p };
      force((n) => n + 1);
      return;
    }
    if (t?.role === "open-ref" && t.id) {
      const ref = s.doc.nodes.find((n) => n.id === t.id)?.ref;
      if (ref) set({ modal: { type: "diagram-view", diagram: ref.diagram, node: ref.node } });
      return;
    }
    if ((t?.role === "wp" || t?.role === "wp-add") && t.id) {
      const el = (e.target as Element).closest("[data-role]") as SVGElement;
      let idx = Number(el.dataset.idx);
      beginTx();
      if (t.role === "wp-add") {
        // nova curva: insere o ponto na posição do clique e já passa a arrastá-lo
        live({ ...s.doc, connections: s.doc.connections.map((c) => (c.id === t.id ? { ...c, waypoints: [...(c.waypoints ?? []).slice(0, idx), { x: snapV(p.x, s.snap), y: snapV(p.y, s.snap) }, ...(c.waypoints ?? []).slice(idx)] } : c)) });
      }
      drag.current = { kind: "waypoint", id: t.id, idx };
      return;
    }
    if (t?.role === "handle" && t.id) {
      drag.current = { kind: "connect", from: t.id, side: t.side!, cur: p };
      force((n) => n + 1);
      return;
    }
    if (t?.role === "resize") {
      const id = s.sel[0];
      const el = [...s.doc.groups, ...s.doc.notes].find((x) => x.id === id);
      if (el) {
        beginTx();
        drag.current = { kind: "resize", id, start: p, orig: { w: el.w, h: el.h } };
        return;
      }
    }
    if (s.tool === "connect" && (t?.role === "node" || t?.role === "group") && t.id) {
      drag.current = { kind: "connect", from: t.id, side: "right", cur: p };
      force((n) => n + 1);
      return;
    }
    if (s.tool === "group" || s.tool === "note") {
      drag.current = { kind: "create", tool: s.tool, start: p, cur: p };
      force((n) => n + 1);
      return;
    }
    if (t && t.id && (t.role === "node" || t.role === "group" || t.role === "note" || t.role === "conn")) {
      let nextSel = s.sel;
      if (e.shiftKey) nextSel = s.sel.includes(t.id) ? s.sel.filter((x) => x !== t.id) : [...s.sel, t.id];
      else if (!s.sel.includes(t.id)) nextSel = [t.id];
      select(nextSel);
      if (t.role !== "conn" && nextSel.includes(t.id)) {
        // conjunto em movimento: selecionados + descendentes de grupos
        const moving = new Set<string>();
        const add = (id: string) => {
          if (moving.has(id)) return;
          moving.add(id);
          s.doc.nodes.filter((n) => n.parent === id || n.owner === id).forEach((n) => add(n.id));
          s.doc.groups.filter((g) => g.parent === id).forEach((g) => add(g.id));
        };
        nextSel.forEach(add);
        const origin = new Map<string, Pt>();
        [...s.doc.nodes, ...s.doc.groups, ...s.doc.notes].forEach((el) => moving.has(el.id) && origin.set(el.id, { x: el.x, y: el.y }));
        beginTx();
        drag.current = { kind: "move", start: p, origin, moved: false, id: t.id };
      }
      return;
    }
    // vazio → marquee
    const base = e.shiftKey ? s.sel : [];
    if (!e.shiftKey) select([]);
    drag.current = { kind: "marquee", start: p, cur: p, additive: e.shiftKey, base };
    force((n) => n + 1);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    const p = toWorld(e);
    const s = getState();
    if (!d) {
      if (getState().present) return;
      const t = targetOf(e.target);
      const id = t && (t.role === "node" || t.role === "group" || t.role === "handle") ? t.id ?? null : null;
      if (id !== hover) setHover(id);
      return;
    }
    switch (d.kind) {
      case "pan":
        set({ view: { ...s.view, x: d.vx + e.clientX - d.sx, y: d.vy + e.clientY - d.sy } });
        break;
      case "move": {
        const dx = p.x - d.start.x;
        const dy = p.y - d.start.y;
        if (!d.moved && Math.hypot(dx, dy) * s.view.z < 3) return;
        d.moved = true;
        const nd: Doc = { ...s.doc };
        const mv = <T extends { id: string; x: number; y: number }>(arr: T[]) =>
          arr.map((el) => {
            const o = d.origin.get(el.id);
            return o ? { ...el, x: snapV(o.x + dx, s.snap), y: snapV(o.y + dy, s.snap) } : el;
          });
        nd.nodes = mv(s.doc.nodes);
        nd.groups = s.doc.groups.map((g) => (d.origin.has(g.id) ? { ...mv([g])[0], auto: false } : g));
        nd.notes = mv(s.doc.notes);
        live(nd);
        // destaque do grupo alvo (primeiro item selecionado)
        const lead = s.sel[0];
        const el = [...nd.nodes, ...nd.groups].find((x) => x.id === lead);
        if (el) {
          const exclude = new Set([...d.origin.keys()]);
          setHotDrop(groupAt({ x: el.x + el.w / 2, y: el.y + el.h / 2 }, nd, exclude)?.id ?? null);
        }
        break;
      }
      case "marquee": {
        d.cur = p;
        const r = normRect(d.start, p);
        const hit = [...s.doc.nodes, ...s.doc.notes, ...s.doc.groups.filter((g) => contains(r, { x: g.x + 1, y: g.y + 1 }) && contains(r, { x: g.x + g.w - 1, y: g.y + g.h - 1 }))].filter((el) => intersects(el, r)).map((el) => el.id);
        select(Array.from(new Set([...d.base, ...hit])));
        force((n) => n + 1);
        break;
      }
      case "resize": {
        const w = Math.max(120, snapV(d.orig.w + p.x - d.start.x, s.snap));
        const h = Math.max(70, snapV(d.orig.h + p.y - d.start.y, s.snap));
        live({
          ...s.doc,
          groups: s.doc.groups.map((g) => (g.id === d.id ? { ...g, w, h, auto: false } : g)),
          notes: s.doc.notes.map((n) => (n.id === d.id ? { ...n, w, h } : n)),
        });
        break;
      }
      case "waypoint": {
        const pt = { x: snapV(p.x, s.snap), y: snapV(p.y, s.snap) };
        live({ ...s.doc, connections: s.doc.connections.map((c) => (c.id === d.id ? { ...c, waypoints: (c.waypoints ?? []).map((w, i) => (i === d.idx ? pt : w)) } : c)) });
        break;
      }
      case "connect": {
        d.cur = p;
        setHotDrop(connectTarget(e.clientX, e.clientY, d.from));
        force((n) => n + 1);
        break;
      }
      case "create":
        d.cur = p;
        force((n) => n + 1);
        break;
      case "ink": {
        const last = d.pts[d.pts.length - 1];
        if (Math.hypot(p.x - last.x, p.y - last.y) * s.view.z < 1.5) return;
        d.pts = [...d.pts, p];
        live({ ...s.doc, ink: (s.doc.ink ?? []).map((k) => (k.id === d.id ? { ...k, pts: d.pts } : k)) });
        break;
      }
      case "erase":
        eraseAt(p, e);
        break;
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    setPanning(false);
    setHotDrop(null);
    if (svgRef.current?.hasPointerCapture(e.pointerId)) svgRef.current.releasePointerCapture(e.pointerId);
    if (!d) return;
    const s = getState();
    const p = toWorld(e);
    switch (d.kind) {
      case "move": {
        if (!d.moved && e.button === 0 && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
          // clique simples numa referência a outro diagrama → visualizar em modal
          const ref = s.doc.nodes.find((n) => n.id === d.id)?.ref;
          if (ref) set({ modal: { type: "diagram-view", diagram: ref.diagram, node: ref.node } });
        }
        if (d.moved) {
          // reparent: topo da seleção cai no menor grupo que contém seu centro
          const doc = structuredClone(s.doc);
          const movedIds = new Set(d.origin.keys());
          const tops = [...doc.nodes, ...doc.groups].filter((el) => movedIds.has(el.id) && (!el.parent || !movedIds.has(el.parent)) && !("owner" in el && el.owner));
          const touched = new Set<string>();
          for (const el of tops) {
            const c = { x: el.x + el.w / 2, y: el.y + el.h / 2 };
            const target = groupAt(c, doc, movedIds.has(el.id) ? new Set([...movedIds]) : new Set())?.id;
            if (target && isContainerOf(doc, el.id, target)) continue;
            if (el.parent !== target) {
              if (el.parent) touched.add(el.parent);
              el.parent = target;
            }
            if (target) touched.add(target);
          }
          for (const n of doc.nodes) {
            const o = n.owner ? doc.nodes.find((x) => x.id === n.owner) : undefined;
            if (o && n.parent !== o.parent) {
              if (n.parent) touched.add(n.parent);
              n.parent = o.parent;
              if (o.parent) touched.add(o.parent);
            }
          }
          touched.forEach((g) => fitGroup(doc, g));
          live(doc);
        }
        endTx();
        break;
      }
      case "resize":
      case "waypoint":
      case "ink":
      case "erase":
        endTx();
        break;
      case "connect": {
        const to = connectTarget(e.clientX, e.clientY, d.from);
        if (to) {
          const [r] = run([{ op: "add_connection", from: d.from, to, type: s.connType }]);
          if (r.ok && r.id) select([r.id]);
        }
        break;
      }
      case "create": {
        const r = normRect(d.start, p);
        const big = r.w > 60 && r.h > 40;
        if (d.tool === "group") {
          const box = big ? r : { x: d.start.x - 160, y: d.start.y - 100, w: 320, h: 200 };
          const [res] = run([{ op: "add_group", label: "Novo grupo", kind: "boundary", x: snapV(box.x, s.snap), y: snapV(box.y, s.snap), w: snapV(box.w, s.snap), h: snapV(box.h, s.snap) }]);
          if (res.ok && res.id) {
            const doc = structuredClone(getState().doc);
            const g = doc.groups.find((x) => x.id === res.id)!;
            for (const n of doc.nodes) if (!n.parent && contains(g, { x: n.x + n.w / 2, y: n.y + n.h / 2 })) n.parent = g.id;
            commit(doc);
            select([res.id]);
            set({ focusTick: getState().focusTick + 1 });
          }
        } else {
          const variant = d.tool === "text" || d.tool === "list" ? d.tool : undefined;
          const k = 1 / Math.min(1, Math.max(0.2, s.view.z)); // tamanho padrão legível em qualquer zoom
          const base = variant === "text" ? { w: 220, h: 48, text: "Texto" } : variant === "list" ? { w: 270, h: 190, text: "Primeiro item\nSegundo item\nTerceiro item", title: "Minha lista" } : { w: 200, h: 110, text: "Nova nota" };
          const dflt = { ...base, w: Math.round(base.w * k), h: Math.round(base.h * k) };
          const box = variant ? (r.w > 60 && r.h > 30 ? r : { x: d.start.x, y: d.start.y, w: dflt.w, h: dflt.h }) : big ? r : { x: d.start.x - 100, y: d.start.y - 55, w: 200, h: 110 };
          const [res] = run([{ op: "add_note", text: dflt.text, title: (dflt as { title?: string }).title, variant, x: snapV(box.x, s.snap), y: snapV(box.y, s.snap) }]);
          if (res.ok && res.id) {
            commit({ ...getState().doc, notes: getState().doc.notes.map((n) => (n.id === res.id ? { ...n, w: box.w, h: box.h } : n)) });
            select([res.id]);
            set({ focusTick: getState().focusTick + 1 });
          }
        }
        set({ tool: "select" });
        break;
      }
    }
    force((n) => n + 1);
  };

  /** Botão direito sobre uma conexão: adicionar ponto de passagem ali ou remover o ponto sob o cursor. */
  const onContextMenu = (e: React.MouseEvent) => {
    if (getState().present) return e.preventDefault();
    const t = targetOf(e.target);
    if (!t?.id || (t.role !== "conn" && t.role !== "wp" && t.role !== "wp-add")) {
      setMenu(null);
      return;
    }
    e.preventDefault();
    const at = toWorld(e);
    const edge = edges.find((x) => x.c.id === t.id);
    if (!edge) return;
    const dataset = ((e.target as Element).closest("[data-role]") as SVGElement).dataset;
    const pts = edge.g.pts ?? [edge.g.start, edge.g.end];
    // trecho mais próximo do clique → índice de inserção
    let idx = 0;
    let best = Infinity;
    for (let i = 0; i < pts.length - 1; i++) {
      const dd = distToSegment(at, pts[i], pts[i + 1]);
      if (dd < best) (best = dd), (idx = i);
    }
    select([t.id]);
    setMenu({
      x: Math.min(e.clientX, window.innerWidth - 230),
      y: Math.min(e.clientY, window.innerHeight - 130),
      conn: t.id,
      at,
      idx: t.role === "wp" ? Number(dataset.idx) : idx,
      onPoint: t.role === "wp",
    });
  };

  const editWaypoints = (id: string, fn: (w: Pt[]) => Pt[]) => {
    const doc = getState().doc;
    commit({ ...doc, connections: doc.connections.map((c) => (c.id === id ? withWaypoints(c, fn(c.waypoints ?? [])) : c)) });
    setMenu(null);
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    if (getState().present) return;
    const t = targetOf(e.target);
    if (t?.role === "wp" && t.id) {
      // duplo clique num ponto de passagem o remove
      const idx = Number(((e.target as Element).closest("[data-role]") as SVGElement).dataset.idx);
      const doc = getState().doc;
      commit({ ...doc, connections: doc.connections.map((c) => (c.id === t.id ? withWaypoints(c, (c.waypoints ?? []).filter((_, i) => i !== idx)) : c)) });
      return;
    }
    if (t?.role === "wp-add") return;
    if (t?.id && t.role === "node" && getState().doc.nodes.find((n) => n.id === t.id)?.ref) return; // o clique já abriu o visualizador
    if (t?.id && t.role !== "handle" && t.role !== "open-ref") {
      select([t.id]);
      set({ focusTick: getState().focusTick + 1 });
      if (t.role === "conn") set({ modal: { type: "interface", id: t.id } });
    }
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const p = toWorld(e);
    const s = getState();
    const file = e.dataTransfer.getData("application/x-archflow-file");
    if (file) {
      const info = s.workspace?.files.find((f) => f.path === file);
      addRefNode(file, info?.title ?? file, snapV(p.x - 92, s.snap), snapV(p.y - 36, s.snap));
      return;
    }
    const id = e.dataTransfer.getData("application/x-archflow-asset");
    if (!id) return;
    const target = groupAt(p, s.doc, new Set());
    // endpoint solto sobre um serviço passa a pertencer a ele (empilhado abaixo)
    const asset = lookupAsset(id);
    if (asset?.kind === "endpoint") {
      const under = targetOf(document.elementFromPoint(e.clientX, e.clientY));
      const host = under?.role === "node" ? s.doc.nodes.find((n) => n.id === under.id) : undefined;
      if (host && host.kind !== "endpoint") return placeAsset(id, 0, 0, undefined, host.id);
      if (host?.owner) return placeAsset(id, 0, 0, undefined, host.owner);
    }
    placeAsset(id, snapV(p.x - 92, s.snap), snapV(p.y - 36, s.snap), target?.id);
  };

  const edges = useMemo(() => computeEdges(doc), [doc]);
  const ownerLinks = useMemo(() => computeOwnerLinks(doc), [doc.nodes]);

  const bg = useStore((s) => s.bg);
  const bgStep = 24 * view.z;
  const bgPreset = presetById(bg.image);
  const groupsSorted = useMemo(() => sortedGroups(doc), [doc.groups]);
  const d = drag.current;
  const selSet = new Set(sel);
  const cursor = panning || tool === "hand" ? "grab" : tool === "text" ? "text" : tool === "eraser" ? ERASER_CURSOR : tool === "connect" || tool === "group" || tool === "note" || tool === "list" || tool === "pen" || tool === "highlight" ? "crosshair" : "default";

  const menuConn = menu ? doc.connections.find((c) => c.id === menu.conn) : undefined;

  return (
    <>
    <svg
      ref={svgRef}
      className={`canvas${dragOver ? " drag-over" : ""}`}
      style={{ cursor, ["--z" as string]: view.z }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={() => setHover(null)}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("application/x-archflow-asset") || e.dataTransfer.types.includes("application/x-archflow-file")) {
          e.preventDefault();
          setDragOver(true);
        }
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
    >
      <defs>
        <pattern id="bgpat" width={bgStep} height={bgStep} patternUnits="userSpaceOnUse" x={view.x} y={view.y}>
          {bg.pattern === "dots" && <circle cx={1} cy={1} r={Math.max(0.9, 1.1 * view.z)} fill="#706fd3" fillOpacity={0.22} />}
          {bg.pattern === "grid" && <path d={`M${bgStep} 0H0V${bgStep}`} fill="none" stroke="#706fd3" strokeOpacity={0.16} strokeWidth={1} />}
          {bg.pattern === "lines" && <path d={`M0 ${bgStep}H${bgStep}`} fill="none" stroke="#706fd3" strokeOpacity={0.16} strokeWidth={1} />}
        </pattern>
        {bgPreset && <PresetPattern id="bgimg" preset={bgPreset} x={view.x} y={view.y} />}
        <DiagramDefs />
      </defs>
      {(bg.color || bg.image) && <rect width="100%" height="100%" fill={bg.color ?? "var(--secondary)"} data-bg="color" />}
      {bgPreset && <rect width="100%" height="100%" fill="url(#bgimg)" opacity={bg.imageOpacity ?? 1} style={{ mixBlendMode: "overlay" }} data-bg />}
      {bg.image && !bgPreset && <image href={bg.image} width="100%" height="100%" preserveAspectRatio="xMidYMid slice" opacity={bg.imageOpacity ?? 1} style={{ mixBlendMode: "overlay" }} data-bg />}
      {bg.pattern !== "none" && <rect width="100%" height="100%" fill="url(#bgpat)" data-bg />}
      <g transform={`translate(${view.x},${view.y}) scale(${view.z})`}>
        {groupsSorted.map((g) => (
          <GroupShape key={g.id} g={g} selected={selSet.has(g.id)} hot={hotDrop === g.id} hovered={hover === g.id || (tool === "connect" && hover === g.id)} />
        ))}
        {ownerLinks.map((l) => (
          <path key={l.id} d={l.d} className="owner-link" />
        ))}
        {edges.map(({ c, g }) => (
          <Edge key={c.id} c={c} d={g.d} mid={g.mid} selected={selSet.has(c.id)} animate={animate} />
        ))}
        {sel.length === 1 &&
          edges
            .filter(({ c }) => c.id === sel[0])
            .map(({ c, g }) => <EdgeHandles key={c.id} c={c} g={g} z={view.z} />)}
        {doc.nodes.map((n) => (
          <NodeShape key={n.id} n={n} selected={selSet.has(n.id)} hot={hotDrop === n.id} hovered={hover === n.id} />
        ))}
        {doc.notes.map((n) => (
          <NoteShape key={n.id} n={n} selected={selSet.has(n.id)} />
        ))}

        {(doc.ink ?? []).map((k) => (
          <path key={k.id} d={inkPath(k.pts)} fill="none" {...strokeAttrs(k)} pointerEvents="none" />
        ))}
        {d?.kind === "marquee" && <rect className="marquee" {...normRect(d.start, d.cur)} />}
        {d?.kind === "create" && <rect className="marquee" {...normRect(d.start, d.cur)} />}
        {d?.kind === "connect" &&
          (() => {
            const from = doc.nodes.find((n) => n.id === d.from) ?? doc.groups.find((g) => g.id === d.from);
            if (!from) return null;
            const side: Side = tool === "connect" ? "right" : d.side;
            const g = previewGeom(from, side, d.cur);
            const col = CONNECTION_TYPES[getState().connType].color;
            return <path d={g.d} fill="none" stroke={col} strokeWidth={2.4} strokeDasharray="6 6" strokeLinecap="round" className="flow-preview" pointerEvents="none" />;
          })()}
      </g>
    </svg>
    {menu && menuConn && (
      <div className="glass ctx-menu" style={{ left: menu.x, top: menu.y }} role="menu" onPointerDown={(e) => e.stopPropagation()} onContextMenu={(e) => e.preventDefault()}>
        {menu.onPoint ? (
          <button role="menuitem" className="danger" onClick={() => editWaypoints(menu.conn, (w) => w.filter((_, i) => i !== menu.idx))}>
            Remover este ponto
          </button>
        ) : (
          <button role="menuitem" onClick={() => editWaypoints(menu.conn, (w) => [...w.slice(0, menu.idx), { x: snapV(menu.at.x, snap), y: snapV(menu.at.y, snap) }, ...w.slice(menu.idx)])}>
            Adicionar ponto aqui
          </button>
        )}
        {!!menuConn.waypoints?.length && (
          <>
            <hr />
            <button role="menuitem" onClick={() => editWaypoints(menu.conn, () => [])}>
              Resetar curva ({menuConn.waypoints.length} ponto{menuConn.waypoints.length > 1 ? "s" : ""})
            </button>
          </>
        )}
      </div>
    )}
    </>
  );
}