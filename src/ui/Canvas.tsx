import { createContext, memo, type CSSProperties, type ReactNode, useCallback, useContext, useEffect, useId, useMemo, useRef, useState } from "react";
import { RingAddMenu } from "./ringmenu";
import { ONION_PREFIX, insideGroupShape, onionPicks, orbitLook, orbits, polar } from "../shared/onion";
import { applyOps, fitGroup, isContainerOf } from "../shared/ops";
import type { Asset } from "../shared/schema";
import { DDD_BADGES, DDD_ROLES, LOGIC_ROLES, docMode, isDataRole } from "../shared/schema";
import { checkExamples } from "../shared/logic";
import { explain, parseExpr, shortValue } from "../shared/expr";
import { edgeIdsOf, dataKey, dataNames, dataNodes, logicStatus, nextExit, relatedTo } from "../shared/logic";
import { changedAt, playSteps, storyAt, valuesAfter, visitsUpTo, whyOf } from "../shared/logicdebug";
import { hiddenBy, projectStages, stageSummary, type StageSummary } from "../shared/logicstages";
import { edgeCoverage, logicSummary } from "../shared/logicoverview";
import { loopFrames } from "../shared/logiclayout";
import { coverageGaps } from "../shared/logiceval";
import { DESC_LINE_H, FACT_H, HEAD_H, LOGIC_ICON, TABLE_ROW_H, TABLE_SPLIT, tableCard, descLines, figureText, isFailureScenario, logicSize, ruleCard, scenarioTitle } from "../shared/logiccard";
import { CONNECTION_TYPES, ENDPOINT_PROTOCOLS, endpointBadge, endpointColor, type ConnectionEl, type ConnectionType, type Doc, type GroupEl, type NodeEl, type NoteEl } from "../shared/schema";
import { truncate, wrapLabel } from "../shared/text";
import { FONT_CSS, parseInline, parseRich, plainText, type BlockKind, type Span } from "../shared/richtext";
import { IconSvg } from "./icons";
import { RichEditor, RichToolbar, richToHtml, type NoteCardStyle } from "./richeditor";
import { SUMMARY_COLS, SUMMARY_PAD, contains, edgeGeoms, logicSummaryBox, summaryText, intersects, labelSize, normRect, previewGeom, projectOnPath, samplePath, sidePoint, within, type Pt, type Side } from "./geometry";
import { PresetPattern, presetById } from "./bgpresets";
import { findSkillCatalogEntry } from "../shared/skillcatalog";
import { findMcpCatalogEntry } from "../shared/mcpcatalog";
import { applyAgentTemplate } from "./agentcatalog";
import { addRefNode, beginTx, commit, endTx, getState, live, lookupAsset, placeAsset, plugSkill, plugTool, run, select, set, startPlay, toggleStage, toast, toastError, useStore, type View } from "./store";
import { requestChangeType } from "./typepicker";
import { reorderSelection, hasClipboard, pasteClipboard, copySelection, deleteSelection, duplicateSelection, exitFlow, fitView, inspectFlow, spaceHeld } from "./keys";
import { flowBoxes, flowOf, type FlowMode } from "./flow";
import { inkPath, strokeAttrs } from "./ink";
import { useEdgeRunMark, useNodeRunMark } from "./agentrun";

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
  | { kind: "move"; start: Pt; origin: Map<string, Pt>; moved: boolean; id?: string; under?: string; /** clique sem arrastar numa nota já selecionada → editar in-place */ editNote?: string }
  | { kind: "marquee"; start: Pt; cur: Pt; additive: boolean; base: string[]; /** começou num anel do layout "camadas": clique sem arrastar abre o menu de adicionar */ ring?: string }
  | { kind: "resize"; id: string; start: Pt; orig: { w: number; h: number } }
  | { kind: "waypoint"; id: string; idx: number }
  | { kind: "label"; id: string }
  | { kind: "connect"; from: string; side: Side; cur: Pt }
  | { kind: "create"; tool: "group" | "note" | "text" | "list"; start: Pt; cur: Pt }
  | { kind: "ink"; id: string; pts: Pt[] }
  | { kind: "erase" };

/* ───────────────────────── formas ───────────────────────── */

/** Até 3 linhas para o nome completo; com 3 linhas a segunda informação (tecnologia/papel) sai do desenho e fica no tooltip e no inspetor. */
const NAME_LINES = 3;
const nameLines = (text: string, chars: number) => wrapLabel(text, chars, NAME_LINES);
/** Posição vertical da linha secundária; null quando o nome ocupa as 3 linhas. */
const subY = (text: string, chars: number, h: number) => {
  const n = nameLines(text, chars).length;
  return n >= 3 ? null : n === 2 ? h / 2 + 24 : h / 2 + 15;
};

/** Nome do componente: 1 a 3 linhas, centrado na altura do nó. */
function NodeName({ text, chars, x, h, hasSub }: { text: string; chars: number; x: number; h: number; hasSub: boolean }) {
  const lines = nameLines(text, chars);
  if (lines.length === 1)
    return (
      <text className="node-label" x={x} y={hasSub ? h / 2 - 3 : h / 2 + 5} pointerEvents="none">
        {lines[0]}
      </text>
    );
  const three = lines.length >= 3;
  return (
    <text className="node-label" x={x} y={three ? h / 2 - 13 : h / 2 - 19} pointerEvents="none">
      {lines.map((l, k) => (
        <tspan key={k} x={x} dy={k === 0 ? 0 : three ? 16 : 17}>
          {l}
        </tspan>
      ))}
    </text>
  );
}

/** Componente de comunicação: selo colorido (GET, POST, WS, QUERY…) + caminho, no estilo de nós do n8n. */
const EndpointShape = memo(function EndpointShape({ n, selected, hot, hovered }: { n: NodeEl; selected: boolean; hot: boolean; hovered: boolean }) {
  const e = n.endpoint!;
  const color = endpointColor(e);
  const badge = endpointBadge(e);
  const bw = Math.max(44, badge.length * 8.4 + 18);
  const path = e.path ?? n.label;
  return (
    <g data-id={n.id} data-role="node" role="button" aria-pressed={selected} aria-label={`${ENDPOINT_PROTOCOLS[e.protocol].label} ${badge} ${path}`} transform={`translate(${n.x},${n.y})`} className={`node endpoint${selected ? " sel" : ""}${hot ? " drop-target" : ""}`}>
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

/** Elemento do modelo de domínio (DDD): selo colorido do papel (AGG, CMD, EVT…) e fundo na cor do papel, como post-its de Event Storming. */
const DomainShape = memo(function DomainShape({ n, selected, hot, hovered }: { n: NodeEl; selected: boolean; hot: boolean; hovered: boolean }) {
  const role = DDD_ROLES[n.ddd!.role];
  const badge = DDD_BADGES[n.ddd!.role];
  const bw = Math.max(46, badge.length * 8.4 + 18);
  const chars = Math.floor((n.w - bw - 40) / 7);
  const sub = n.ddd!.role === "use-case" && n.ddd!.actor ? `${role.label} · ${n.ddd!.actor}` : n.ddd!.external ? `${role.label} ← ${n.ddd!.external}` : role.label;
  return (
    <g data-id={n.id} data-role="node" role="button" aria-pressed={selected} aria-label={`${role.label}: ${n.label}`} transform={`translate(${n.x},${n.y})`} className={`node domain${selected ? " sel" : ""}${hot ? " drop-target" : ""}`}>
      <title>{`${n.label}\n${role.label} — ${role.hint}${n.description ? "\n" + n.description : ""}`}</title>
      <rect className="node-body" width={n.w} height={n.h} rx={18} filter="url(#shadow)" style={fillStyle(n) ?? { fill: role.color, fillOpacity: 0.14 }} />
      <rect className="node-sheen" width={n.w} height={n.h} rx={18} fill="url(#sheen)" pointerEvents="none" />
      <rect className="node-ring" width={n.w} height={n.h} rx={18} pointerEvents="none" />
      <rect x={8} y={8} width={bw} height={n.h - 16} rx={11} fill={role.color} pointerEvents="none" />
      <text x={8 + bw / 2} y={n.h / 2 + 0.5} className="ep-badge" pointerEvents="none">
        {badge}
      </text>
      <NodeName text={n.label} chars={chars} x={bw + 22} h={n.h} hasSub />
      {subY(n.label, chars, n.h) !== null && (
        <text className="node-sub" x={bw + 22} y={subY(n.label, chars, n.h)!} pointerEvents="none">
          {truncate(sub, chars + 2)}
        </text>
      )}
      {n.description && <circle cx={n.w - 14} cy={14} r={3} fill={role.color} opacity={0.8} pointerEvents="none" />}
      {(hovered || selected) && <Handles id={n.id} w={n.w} h={n.h} />}
    </g>
  );
});

/**
 * Elemento de domínio dentro dos anéis do layout "camadas": um círculo que orbita o centro, com o selo do papel em cima e o
 * nome embaixo. Cabe no anel igual em qualquer ângulo (um cartão largo ocupava a largura inteira nas laterais).
 */
const OrbitShape = memo(function OrbitShape({ n, selected, hot, hovered }: { n: NodeEl; selected: boolean; hot: boolean; hovered: boolean }) {
  const look = orbitLook(n);
  const role = { label: look.role, hint: look.hint, color: look.color };
  const badge = look.badge;
  const cx = n.w / 2;
  const cy = n.h / 2;
  const r = Math.min(n.w, n.h) / 2;
  const bw = Math.max(36, badge.length * 8 + 14);
  const lines = wrapLabel(n.label, Math.max(6, Math.floor((r * 1.55) / 7.4)), 3);
  const top = cy - ((lines.length - 1) * 15) / 2 + 12;
  return (
    <g data-id={n.id} data-role="node" role="button" aria-pressed={selected} aria-label={`${role.label}: ${n.label}`} transform={`translate(${n.x},${n.y})`} className={`node domain orbit${selected ? " sel" : ""}${hot ? " drop-target" : ""}`} style={{ ["--rc" as string]: role.color }}>
      <title>{`${n.label}\n${role.label} — ${role.hint}${n.description ? "\n" + n.description : ""}`}</title>
      <circle className="node-body" cx={cx} cy={cy} r={r} filter="url(#shadow)" style={fillStyle(n)} />
      <circle className="orbit-ring" cx={cx} cy={cy} r={r - 1.5} pointerEvents="none" />
      <rect x={cx - bw / 2} y={top - 36} width={bw} height={19} rx={9.5} fill={role.color} pointerEvents="none" />
      <text x={cx} y={top - 26} className="ep-badge" pointerEvents="none">
        {badge}
      </text>
      <text className="node-label orbit-label" x={cx} y={top} textAnchor="middle" pointerEvents="none">
        {lines.map((l, k) => (
          <tspan key={k} x={cx} dy={k === 0 ? 0 : 15}>
            {l}
          </tspan>
        ))}
      </text>
      {(hovered || selected) && <Handles id={n.id} w={n.w} h={n.h} />}
    </g>
  );
});

const NO_NAMES: Record<string, string> = {};

/** Estilo das setas do fluxo (modo Logic): a cor diz por qual saída a seta sai. */
const FLOW_EDGE: Record<string, { color: string; dash?: string }> = {
  n: { color: "var(--ink-3)" },
  ok: { color: "#14a38b" },
  no: { color: "#e0605a" },
  loop: { color: "#c2548b", dash: "5 5" },
  case: { color: "#706fd3" },
};
const flowKey = (c: ConnectionEl) => (c.logic?.branch === "sim" ? "ok" : c.logic?.branch === "nao" || c.logic?.branch === "erro" ? "no" : c.logic?.branch === "repete" ? "loop" : c.logic?.case !== undefined ? "case" : "n");

/** Destaque de um elemento do fluxo: passo atual da reprodução, já percorrido, apagado ou relacionado ao selecionado. */
export type Viz = "cur" | "vis" | "dim" | "rel";
/** reprodução: o valor de um dado depois do passo atual (e se foi este passo que o mudou) */
export type LiveValue = { text: string; changed: boolean };

/** Legenda de cada elemento do fluxo (a primeira linha pequena do cartão). */
const LOGIC_CAPTION: Record<string, string> = { start: "Início", end: "Fim", rule: "Ação", table: "Tabela de decisão", decision: "Decisão", switch: "Escolha", loop: "Repetição", fork: "Em paralelo", join: "Junção", call: "Chama", code: "Código", input: "Entrada", output: "Resultado", variable: "Variável", scenario: "Cenário" };

/** Ícone no azulejo colorido do cartão (viewBox 24). */
function LogicIcon({ paths, x, y, size, color, round }: { paths: string[]; x: number; y: number; size: number; color: string; round?: boolean }) {
  const s = (size * 0.54) / 24;
  const off = (size - 24 * s) / 2;
  return (
    <g transform={`translate(${x},${y})`} pointerEvents="none">
      <rect width={size} height={size} rx={round ? size / 2 : size * 0.3} fill={color} />
      {round ? <path d={`M0,${size / 2} A${size / 2},${size / 2} 0 0 1 ${size},${size / 2} Z`} fill="#fff" opacity={0.14} /> : <rect width={size} height={size / 2} rx={size * 0.3} fill="#fff" opacity={0.14} />}
      <g transform={`translate(${off},${off}) scale(${s})`} fill="none" stroke="#fff" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
        {paths.map((d, i) => (
          <path key={i} d={d} />
        ))}
      </g>
    </g>
  );
}

/**
 * Elementos do modo Logic. Linguagem visual única, no vidro do app: cartão arredondado com azulejo de ícone na cor do papel,
 * legenda pequena e título; a condição ou o efeito em português logo abaixo; dados como etiquetas; estado dos exemplos como
 * um selo redondo. Sem losangos nem caixas de fluxograma antigo: o tipo do elemento vem do ícone, da legenda e da cor.
 */
const LogicShape = memo(function LogicShape({ n, selected, hot, hovered, status, gap, names, viz, badge, visits, liveValue, row }: { n: NodeEl; selected: boolean; hot: boolean; hovered: boolean; status?: "ok" | "fail" | "none"; gap?: string[]; names: Record<string, string>; viz?: Viz; badge?: number; visits?: number; liveValue?: LiveValue; row?: string }) {
  const l = n.logic!;
  // descrição completa quando o cartão tem a altura dela (Doc.showDescriptions); vale também no visualizador e na exportação
  const fullDesc = (isDataRole(l.role) || l.role === "scenario") && n.h >= (logicSize(n, NO_NAMES, true)?.h ?? Infinity);
  const role = LOGIC_ROLES[l.role];
  const color = (l.role === "end" && l.outcome === "erro") || isFailureScenario(n) ? "#d6453d" : role.color;
  const icon = l.role === "end" ? (l.outcome === "erro" ? LOGIC_ICON["end-erro"] : LOGIC_ICON.end) : LOGIC_ICON[l.role];
  const caption = l.role === "end" && l.outcome === "erro" ? "Fim com erro" : isFailureScenario(n) ? "Cenário de falha" : LOGIC_CAPTION[l.role];
  const w = n.w;
  const h = n.h;
  const dashed = l.role === "loop" || l.role === "call" || l.role === "code";
  const R = l.role === "start" || l.role === "end" ? h / 2 : isDataRole(l.role) ? 14 : 16;
  const seal = (x: number, y: number) =>
    status !== "fail" && gap?.length ? (
      // falta cobrir: nenhum exemplo ou cenário passa por aqui (ou por um dos ramos)
      <g transform={`translate(${x},${y})`} pointerEvents="none" className="logic-seal logic-seal-gap">
        <title>{`Sem cenário: ${gap.join(" ")}`}</title>
        <circle r={9} fill="none" stroke="#c98a14" strokeWidth={2} strokeDasharray="3 2.5" />
        <path d="M-3.5,0 L3.5,0" fill="none" stroke="#c98a14" strokeWidth={2.2} strokeLinecap="round" />
      </g>
    ) : status === "ok" || status === "fail" ? (
      <g transform={`translate(${x},${y})`} pointerEvents="none" className="logic-seal">
        <title>{status === "ok" ? "Os exemplos batem" : "Algum exemplo não bate"}</title>
        <circle r={9} fill={status === "ok" ? "#2f9e6b" : "#d6453d"} />
        <path d={status === "ok" ? "M-4,0.5 L-1,3.5 L4.5,-3" : "M-3.5,-3.5 L3.5,3.5 M3.5,-3.5 L-3.5,3.5"} fill="none" stroke="#fff" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
      </g>
    ) : null;
  const g = (children: ReactNode) => (
    <g data-id={n.id} data-role="node" role="button" aria-pressed={selected} aria-label={`${role.label}: ${n.label}`} transform={`translate(${n.x},${n.y})`} className={`node domain logic logic-${l.role}${viz ? ` logic-viz-${viz}` : ""}${selected ? " sel" : ""}${hot ? " drop-target" : ""}`}>
      <title>{[n.label, `${role.label} — ${role.hint}`, l.text, n.description, n.source && `Código: ${n.source}`].filter(Boolean).join("\n")}</title>
      <rect className="node-body" width={w} height={h} rx={R} filter="url(#shadow)" style={fillStyle(n)} />
      <rect className="logic-wash" width={w} height={h} rx={R} fill={color} pointerEvents="none" />
      <rect className="node-sheen" width={w} height={h} rx={R} fill="url(#sheen)" pointerEvents="none" />
      <rect className="node-ring" width={w} height={h} rx={R} pointerEvents="none" strokeDasharray={dashed ? "6 5" : undefined} />
      {children}
      {n.source && (
        // de onde veio no código: só o arquivo e a linha, no canto (o caminho inteiro fica no tooltip e no inspetor)
        <text x={w - 12} y={h - 7} textAnchor="end" className="logic-src" pointerEvents="none">
          {"</> " + truncate(n.source.split(/[\\/]/).pop()!, 28)}
        </text>
      )}
      {badge ? (
        <g pointerEvents="none" transform="translate(-4,-4)">
          <circle r={11} fill="#706fd3" stroke="#fff" strokeWidth={2} />
          <text y={4} textAnchor="middle" className="logic-badge">
            {badge}
          </text>
          {visits ? (
            <g transform="translate(14,-1)">
              <title>{`O fluxo já passou ${visits} vezes por aqui`}</title>
              <rect x={0} y={-8} width={12 + String(visits).length * 7} height={16} rx={8} className="logic-visits" />
              <text x={6 + String(visits).length * 3.5} y={4} textAnchor="middle" className="logic-visits-t">
                ×{visits}
              </text>
            </g>
          ) : null}
        </g>
      ) : null}
      {(hovered || selected) && <Handles id={n.id} w={w} h={h} />}
    </g>
  );
  const cap = (x: number, y: number) => (
    <text x={x} y={y} className="logic-cap" fill={color} style={{ ["--cap" as string]: color }} pointerEvents="none">
      {caption}
    </text>
  );

  /* início / fim: cápsula com ícone redondo */
  if (l.role === "start" || l.role === "end") {
    return g(
      <>
        <LogicIcon paths={icon} x={10} y={h / 2 - 18} size={36} color={color} round />
        {cap(58, h / 2 - 5)}
        <text x={58} y={h / 2 + 13} className="logic-title" pointerEvents="none">
          {wrapLabel(n.label, 27, 1)[0]}
        </text>
      </>,
    );
  }

  /* fork / join: barra fina */
  if (l.role === "fork" || l.role === "join") {
    return g(
      <>
        <rect width={w} height={h} rx={h / 2} fill={color} opacity={0.88} pointerEvents="none" />
        <text x={w / 2} y={h / 2 + 3.6} textAnchor="middle" className="logic-bar" pointerEvents="none">
          {caption.toUpperCase()}
        </text>
      </>,
    );
  }

  /* dado: etiqueta compacta */
  if (isDataRole(l.role)) {
    const sub = l.key ?? n.id.replace(/-/g, "_");
    const desc = descLines(n, fullDesc);
    const mid = FACT_H / 2;
    return g(
      <>
        <circle cx={18} cy={mid} r={5.5} fill={color} pointerEvents="none" />
        <text x={32} y={mid - 3} className="logic-title" style={{ fontSize: 12.5 }} pointerEvents="none">
          {wrapLabel(n.label, Math.floor((w - 44) / 7), 1)[0]}
        </text>
        <text x={32} y={mid + 12} className="logic-mono" pointerEvents="none">
          {truncate(sub, Math.floor((w - 44) / 6) - 4)}
        </text>
        {liveValue ? (
          (() => {
            // reprodução: o valor do momento toma o lugar do selo IN/OUT/VAR; aceso quando este passo acabou de mudá-lo
            const t = truncate(liveValue.text, Math.max(6, Math.floor((w - 44) / 7) - 8));
            const pw = t.length * 6.6 + 14;
            return (
              <g transform={`translate(${w - 8 - pw},${mid - 10})`} pointerEvents="none" className={`logic-live${liveValue.changed ? " changed" : ""}`}>
                <title>{`Valor agora: ${liveValue.text}`}</title>
                <rect width={pw} height={20} rx={10} />
                <text x={pw / 2} y={14} textAnchor="middle">
                  {t}
                </text>
              </g>
            );
          })()
        ) : (
          <text x={w - 10} y={mid + 12} textAnchor="end" className="logic-mono" style={{ fontWeight: 700, fill: color }} pointerEvents="none">
            {role.badge}
          </text>
        )}
        {desc.map((t, k) => (
          <text key={k} x={32} y={FACT_H + 6 + k * DESC_LINE_H} className="logic-desc" pointerEvents="none">
            {t}
          </text>
        ))}
      </>,
    );
  }

  /* cenário: botão de reproduzir + resumo */
  if (l.role === "scenario") {
    const canPlay = (l.examples?.length ?? 0) > 0;
    const title = scenarioTitle(n);
    const desc = descLines(n, fullDesc);
    // o botão fica centrado no cabeçalho (título), não no cartão inteiro: a descrição aberta cresce para baixo
    const head = 40 + title.length * 15;
    return g(
      <>
        <g className={canPlay ? "logic-play" : undefined} role={canPlay ? "button" : undefined} aria-label={canPlay ? `Reproduzir o cenário ${n.label}` : undefined} onPointerDown={canPlay ? (e) => e.stopPropagation() : undefined} onClick={canPlay ? (e) => (e.stopPropagation(), startPlay(n.id)) : undefined} style={canPlay ? { cursor: "pointer" } : undefined}>
          <title>{canPlay ? "Reproduzir: mostra o caminho percorrido no fluxo" : "Sem exemplo para reproduzir"}</title>
          <circle className="logic-play-shadow" cx={30} cy={head / 2 + 3} r={18} fill="#000" fillOpacity={0.2} />
          <circle className="logic-play-disc" cx={30} cy={head / 2} r={18} fill={color} />
          <path d={`M${25},${head / 2 - 8} L${37},${head / 2} L${25},${head / 2 + 8} Z`} fill="#fff" />
        </g>
        {cap(58, 20)}
        {title.map((t, k) => (
          <text key={k} x={58} y={37 + k * 15} className="logic-title" style={{ fontSize: 12.5 }} pointerEvents="none">
            {t}
          </text>
        ))}
        {desc.map((t, k) => (
          <text key={`d${k}`} x={58} y={head - 2 + k * DESC_LINE_H} className="logic-desc" pointerEvents="none">
            {t}
          </text>
        ))}
        {seal(w - 22, 20)}
      </>,
    );
  }

  /* tabela de decisão: grade QUANDO | ENTÃO; na reprodução, a linha que valeu acende */
  if (l.role === "table") {
    const c = tableCard(n, names);
    const split = Math.round(w * TABLE_SPLIT);
    const cw = (px: number) => Math.floor(px / 6.4);
    return g(
      <>
        <LogicIcon paths={icon} x={12} y={12} size={32} color={color} />
        {cap(54, 22)}
        {c.title.map((t, k) => (
          <text key={k} x={54} y={39 + k * 15} className="logic-title" pointerEvents="none">
            {t}
          </text>
        ))}
        {seal(w - 22, 20)}
        <g transform={`translate(12,${c.gridY})`} pointerEvents="none" className="logic-table">
          <rect width={w - 24} height={22 + Math.max(1, c.rows.length) * TABLE_ROW_H} rx={8} className="lt-box" />
          <text x={10} y={15} className="lt-head">QUANDO</text>
          <text x={split - 2} y={15} className="lt-head">ENTÃO</text>
          <line x1={split - 12} y1={4} x2={split - 12} y2={22 + c.rows.length * TABLE_ROW_H - 4} className="lt-rule" />
          {c.rows.map((r, i) => {
            const y = 22 + i * TABLE_ROW_H;
            const on = row === r.branch;
            return (
              <g key={i} className={`lt-row${on ? " on" : ""}${r.otherwise ? " else" : ""}`}>
                <rect y={y} width={w - 24} height={TABLE_ROW_H} rx={on ? 6 : 0} className="lt-bg" />
                <text x={10} y={y + 14.5} className="lt-when">
                  {truncate(r.when, cw(split - 26))}
                </text>
                <text x={split - 2} y={y + 14.5} className="lt-then">
                  {truncate(r.then, cw(w - 24 - split - 8) - 1)}
                </text>
              </g>
            );
          })}
          {c.more > 0 && (
            <text x={10} y={22 + c.rows.length * TABLE_ROW_H + 14} className="lt-more">
              +{c.more} {c.more === 1 ? "linha" : "linhas"} no inspetor
            </text>
          )}
        </g>
      </>,
    );
  }

  /* decisão, escolha, laço, chamada: cartão com a condição em português */
  if (l.role !== "rule") {
    const f = figureText(n, names);
    const tx = 54;
    return g(
      <>
        <LogicIcon paths={icon} x={12} y={12} size={32} color={color} />
        {cap(tx, 22)}
        {f.title.map((t, k) => (
          <text key={k} x={tx} y={39 + k * 15} className="logic-title" pointerEvents="none">
            {t}
          </text>
        ))}
        {f.body.map((t, k) => (
          <text key={k} x={tx} y={39 + f.title.length * 15 + 4 + k * 14} className="logic-line" pointerEvents="none">
            {t}
          </text>
        ))}
        {seal(w - 22, 22)}
      </>,
    );
  }

  /* regra: cartão de ação */
  const card = ruleCard(n, names);
  let y = HEAD_H;
  return g(
    <>
      <LogicIcon paths={icon} x={12} y={11} size={32} color={color} />
      {cap(54, 23)}
      <text x={54} y={40} className="logic-title" style={{ fontSize: 13.5 }} pointerEvents="none">
        {wrapLabel(n.label, Math.floor((w - 54 - 46) / 7.6), 1)[0]}
      </text>
      {seal(w - 22, 24)}
      {card.sections.map((sec) => {
        const top = y;
        const pill = (
          <g pointerEvents="none">
            <rect x={12} y={top + 1} width={sec.label.length * 6.6 + 14} height={17} rx={8.5} fill={color} opacity={0.13} />
            <text x={12 + (sec.label.length * 6.6 + 14) / 2} y={top + 13} textAnchor="middle" className="logic-sec" fill={color} style={{ ["--cap" as string]: color }}>
              {sec.label}
            </text>
          </g>
        );
        let off = 0;
        const el = (
          <g key={sec.kind + top} pointerEvents="none">
            <line x1={14} x2={w - 14} y1={top - 6} y2={top - 6} className="logic-rule-line" />
            {sec.label && pill}
            {sec.items.map((it) => {
              const iy = top + off;
              off += it.h;
              if (it.block)
                return (
                  <g key={iy} transform={`translate(${card.x},${iy})`}>
                    {it.block.prims.map((p, k) =>
                      p.kind === "bar" ? (
                        <line key={k} x1={p.x} x2={p.x} y1={p.y} y2={p.y + p.h} className="logic-blk bar" />
                      ) : (
                        <g key={k} transform={`translate(${p.x},${p.y})`} className={`logic-blk ${p.kind}`}>
                          {p.kind !== "op" && <rect width={p.w} height={p.h} rx={p.kind === "mode" ? 9 : 6} />}
                          {(p.lines ?? []).map((t, i) => (
                            <text key={i} x={p.kind === "var" || p.kind === "lit" || p.kind === "expr" ? 7 : p.w / 2} y={13 + i * 13} textAnchor={p.kind === "var" || p.kind === "lit" || p.kind === "expr" ? "start" : "middle"}>
                              {t}
                            </text>
                          ))}
                        </g>
                      ),
                    )}
                  </g>
                );
              const ln = it.line!;
              return (
                <text key={iy} x={card.x + (ln.indent ? 14 : 0)} y={iy + 13} className={`logic-line${ln.cond ? " logic-cond" : ""}`}>
                  {marked(ln.text)}
                </text>
              );
            })}
          </g>
        );
        y += Math.max(15, sec.items.reduce((a, it) => a + it.h, 0)) + 14;
        return el;
      })}
    </>,
  );
});

/** Texto do cartão com dados (azul) e operadores lógicos (negrito) destacados, a partir das marcas do `explain`. */
function marked(text: string): ReactNode {
  const out: ReactNode[] = [];
  let kind = "";
  let buf = "";
  const flush = () => {
    if (buf) out.push(kind ? <tspan key={out.length} className={kind === "v" ? "logic-var" : "logic-op"}>{buf}</tspan> : buf);
    buf = "";
  };
  for (const ch of text) {
    const code = ch.charCodeAt(0);
    if (code >= 1 && code <= 4) {
      flush();
      kind = code === 1 ? "v" : code === 3 ? "o" : "";
    } else buf += ch;
  }
  flush();
  return out;
}

/** Estilo inline do fundo (cor + transparência) de nós e grupos; vazio mantém o padrão do tema. */
const fillStyle = (e: { fill?: string; fillOpacity?: number }): CSSProperties | undefined =>
  e.fill || e.fillOpacity != null ? { ...(e.fill ? { fill: e.fill } : {}), ...(e.fillOpacity != null ? { fillOpacity: e.fillOpacity } : {}) } : undefined;

const refName = (n: NodeEl) => {
  const base = (n.ref?.diagram ?? "").split("/").pop()?.replace(".archflow.json", "") ?? "";
  return `↗ ${base}${n.ref?.node ? ` › ${n.ref.node}` : ""}`;
};

/** Assets personalizados do diagrama exibido (no visualizador, o diagrama é outro). */
export const ViewerAssets = createContext<Asset[] | null>(null);

export const NodeShape = memo(function NodeShape({ n, selected, hot, hovered, status, gap, names, viz, badge, visits, liveValue, row }: { n: NodeEl; selected: boolean; hot: boolean; hovered: boolean; status?: "ok" | "fail" | "none"; gap?: string[]; names?: Record<string, string>; viz?: Viz; badge?: number; visits?: number; liveValue?: LiveValue; row?: string }) {
  const extra = useContext(ViewerAssets);
  const runMark = useNodeRunMark(n.id);
  const asset = extra?.find((a) => a.id === n.asset) ?? lookupAsset(n.asset);
  const color = asset?.color ?? "#706fd3";
  const chars = Math.floor((n.w - 78) / 7);
  if (n.kind === "endpoint" && n.endpoint) return <EndpointShape n={n} selected={selected} hot={hot} hovered={hovered} />;
  // papel de lógica desconhecido (arquivo de outra versão): cai no desenho genérico em vez de derrubar o quadro inteiro
  if (n.kind === "logic" && n.logic && LOGIC_ROLES[n.logic.role]) return <LogicShape n={n} selected={selected} hot={hot} hovered={hovered} status={status} gap={gap} names={names ?? NO_NAMES} viz={viz} badge={badge} visits={visits} liveValue={liveValue} row={row} />;
  if (orbits(n) && n.parent?.startsWith(ONION_PREFIX)) return <OrbitShape n={n} selected={selected} hot={hot} hovered={hovered} />;
  if (n.kind === "domain" && n.ddd) return <DomainShape n={n} selected={selected} hot={hot} hovered={hovered} />;
  return (
    <g data-id={n.id} data-role="node" role="button" aria-pressed={selected} aria-label={[n.label, n.ref ? refName(n) : n.technology ?? asset?.name ?? n.kind].filter(Boolean).join(", ")} transform={`translate(${n.x},${n.y})`} className={`node${n.ref ? " ref" : ""}${selected ? " sel" : ""}${hot ? " drop-target" : ""}${runMark ? ` run-${runMark}` : ""}`}>
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
      <title>{[n.label, n.ref ? refName(n) : n.technology ?? asset?.name].filter(Boolean).join("\n")}</title>
      <NodeName text={n.label} chars={chars} x={68} h={n.h} hasSub={!!(n.technology || n.kind)} />
      {subY(n.label, chars, n.h) !== null && (
        <text className="node-sub" x={68} y={subY(n.label, chars, n.h)!} pointerEvents="none">
          {truncate(n.ref ? refName(n) : n.technology ?? asset?.name ?? n.kind, chars + 2)}
        </text>
      )}
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

/** O que o cartão de uma etapa recolhida mostra (calculado uma vez por quadro) e o destaque dela na reprodução. */
export type StageView = { summary: StageSummary; viz?: Viz };

/** Botão de recolher/abrir uma etapa (tamanho fixo na tela). */
function StageToggle({ id, x, y, collapsed }: { id: string; x: number; y: number; collapsed: boolean }) {
  return (
    <g data-role="stage-toggle" data-id={id} className="stage-toggle" transform={`translate(${x},${y})`}>
      <title>{collapsed ? "Abrir a etapa: mostrar os passos" : "Recolher a etapa num cartão-resumo"}</title>
      <circle r={13} />
      <path d={collapsed ? "M-5 -1.5L0 3.5L5 -1.5" : "M-5 1.5L0 -3.5L5 1.5"} fill="none" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </g>
  );
}

const STAGE_COLOR = "#706fd3";

/** Etapa recolhida: o cartão-resumo no lugar dos passos (o que faz, o que lê, o que escreve, exemplos e cenários). */
function StageCard({ g, selected, hovered, view }: { g: GroupEl; selected: boolean; hovered: boolean; view?: StageView }) {
  const s = view?.summary;
  const w = g.w;
  const h = g.h;
  const text = wrapLabel(g.stage?.text ?? g.description ?? "", Math.floor((w - 40) / 6.4), 2);
  const io = (label: string, names: string[], room = w - 40) => `${label} ${names.length ? truncate(names.join(", "), Math.floor(room / 6.8) - label.length - 1) : "—"}`;
  return (
    <g data-id={g.id} data-role="group" role="button" aria-pressed={selected} aria-label={`Etapa ${g.label}, recolhida`} transform={`translate(${g.x},${g.y})`} className={`group stage-card${selected ? " sel" : ""}${view?.viz ? ` logic-viz-${view.viz}` : ""}`} style={{ ["--gc" as string]: STAGE_COLOR }}>
      <title>{[g.label, g.stage?.text, "Etapa recolhida: clique na seta para ver os passos"].filter(Boolean).join(" · ")}</title>
      <rect className="node-body" width={w} height={h} rx={18} filter="url(#shadow)" />
      <rect className="stage-wash" width={w} height={h} rx={18} pointerEvents="none" />
      <rect className="node-ring" width={w} height={h} rx={18} pointerEvents="none" />
      <rect className="stage-stack" x={8} y={h - 2} width={w - 16} height={6} rx={3} pointerEvents="none" />
      <g pointerEvents="none">
        <text className="logic-cap" x={20} y={24} fill={STAGE_COLOR} style={{ ["--cap" as string]: STAGE_COLOR }}>
          ETAPA{s ? ` · ${s.steps} passos${s.decisions ? ` · ${s.decisions} ${s.decisions === 1 ? "decisão" : "decisões"}` : ""}` : ""}
        </text>
        <text className="logic-title stage-title" x={20} y={44}>
          {truncate(g.label, Math.floor((w - 70) / 8.4))}
        </text>
        {text.map((t, i) => (
          <text key={i} className="logic-desc" x={20} y={64 + i * 14}>
            {t}
          </text>
        ))}
        {s && (
          <>
            <text className="logic-mono stage-io" x={20} y={h - 30}>
              {io("lê", s.reads)}
            </text>
            <text className="logic-mono stage-io" x={20} y={h - 14}>
              {io("escreve", s.writes, s.scenarios > 0 ? w - 40 - 130 : w - 40)}
            </text>
            {s.scenarios > 0 && (
              <text className="logic-mono" x={w - 20} y={h - 14} textAnchor="end">
                {s.scenarios} {s.scenarios === 1 ? "cenário passa" : "cenários passam"}
              </text>
            )}
          </>
        )}
      </g>
      {s && s.status !== "none" && (
        <g transform={`translate(${w - 50},24)`} pointerEvents="none">
          <title>{s.status === "ok" ? "Os exemplos dos passos batem" : "Algum exemplo de um passo não bate"}</title>
          <circle r={9} fill={s.status === "ok" ? "#2f9e6b" : "#d6453d"} />
          <path d={s.status === "ok" ? "M-4,0.5 L-1,3.5 L4.5,-3" : "M-3.5,-3.5 L3.5,3.5 M3.5,-3.5 L-3.5,3.5"} fill="none" stroke="#fff" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
        </g>
      )}
      <StageToggle id={g.id} x={w - 22} y={24} collapsed />
      {(hovered || selected) && <Handles id={g.id} w={w} h={h} />}
    </g>
  );
}

/** Contorno de um anel do layout "camadas": disco, coroa circular ou setor da coroa, no círculo inscrito na caixa. */
export function ringPath(w: number, h: number, inner: number, start?: number, end?: number) {
  const cx = w / 2;
  const cy = h / 2;
  const R = Math.min(w, h) / 2;
  const f = (p: { x: number; y: number }) => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`;
  if (start === undefined || end === undefined || end - start >= 359.9) {
    const circle = (r: number, sweep: 0 | 1) => `M${cx} ${cy - r}A${r} ${r} 0 1 ${sweep} ${cx} ${cy + r}A${r} ${r} 0 1 ${sweep} ${cx} ${cy - r}Z`;
    return circle(R, 1) + (inner > 0 ? circle(inner, 0) : "");
  }
  const large = end - start > 180 ? 1 : 0;
  const outer = `M${f(polar(cx, cy, R, start))}A${R} ${R} 0 ${large} 1 ${f(polar(cx, cy, R, end))}`;
  return inner > 0 ? `${outer}L${f(polar(cx, cy, inner, end))}A${inner} ${inner} 0 ${large} 0 ${f(polar(cx, cy, inner, start))}Z` : `${outer}L${cx} ${cy}Z`;
}

/** Anel (ou setor) do layout "camadas": preenchido, com o nome escrito ao longo do arco, como a figura da Clean Architecture. */
function RingShape({ g, selected, hot, hovered, color }: { g: GroupEl; selected: boolean; hot: boolean; hovered: boolean; color: string }) {
  const uid = useId().replace(/:/g, "");
  const ring = g.ring!;
  const cx = g.w / 2;
  const cy = g.h / 2;
  const R = Math.min(g.w, g.h) / 2;
  const cls = `group onion ring${selected ? " sel" : ""}${hot ? " drop-target" : ""}`;
  if (ring.frame)
    return (
      <g data-id={g.id} data-role="group" transform={`translate(${g.x},${g.y})`} className={cls} style={{ ["--gc" as string]: color }} pointerEvents="none">
        <title>{g.label}</title>
      </g>
    );
  const full = ring.start === undefined || ring.end === undefined;
  const start = ring.start ?? -180;
  const end = ring.end ?? 180;
  const mid = (start + end) / 2;
  // nome na faixa externa do anel; na metade de baixo o arco é percorrido ao contrário para o texto não ficar de ponta-cabeça
  const below = !full && Math.cos((mid * Math.PI) / 180) < 0;
  const half = Math.min((end - start) / 2 - 2, 80);
  const lr = below ? R - 10 : R - 21;
  const a = polar(cx, cy, lr, below ? mid + half : mid - half);
  const b = polar(cx, cy, lr, below ? mid - half : mid + half);
  const arc = `M${a.x.toFixed(1)} ${a.y.toFixed(1)}A${lr} ${lr} 0 0 ${below ? 0 : 1} ${b.x.toFixed(1)} ${b.y.toFixed(1)}`;
  return (
    <g data-id={g.id} data-role="group" role="button" aria-pressed={selected} aria-label={`Camada ${g.label}`} transform={`translate(${g.x},${g.y})`} className={cls} style={{ ["--gc" as string]: color }}>
      <title>{g.tag ? `${g.label} · ${g.tag}` : g.label}</title>
      <path className="ring-body" d={ringPath(g.w, g.h, ring.inner, ring.start, ring.end)} fillRule="evenodd" />
      {ring.orbits?.map((o) => {
        // trilha da órbita em que os componentes giram (no setor, só o arco dele)
        if (full) return <circle key={o} className="ring-orbit" cx={cx} cy={cy} r={o} pointerEvents="none" />;
        const p = polar(cx, cy, o, start + 2);
        const q = polar(cx, cy, o, end - 2);
        return <path key={o} className="ring-orbit" d={`M${p.x.toFixed(1)} ${p.y.toFixed(1)}A${o} ${o} 0 ${end - start > 180 ? 1 : 0} 1 ${q.x.toFixed(1)} ${q.y.toFixed(1)}`} pointerEvents="none" />;
      })}
      {ring.inner === 0 && full ? (
        <text className="ring-label" x={cx} y={cy - R + 34} textAnchor="middle" pointerEvents="none">
          {g.label}
        </text>
      ) : (
        <>
          <path id={`rl-${uid}`} d={arc} fill="none" stroke="none" />
          <text className="ring-label" pointerEvents="none">
            <textPath href={`#rl-${uid}`} startOffset="50%" textAnchor="middle">
              {g.label}
            </textPath>
          </text>
        </>
      )}
      {(hovered || selected) && <Handles id={g.id} w={g.w} h={g.h} />}
    </g>
  );
}

export const GroupShape = memo(function GroupShape({ g, selected, hot, hovered, stage }: { g: GroupEl; selected: boolean; hot: boolean; hovered: boolean; stage?: StageView }) {
  if (g.stage?.collapsed && stage) return <StageCard g={g} selected={selected} hovered={hovered} view={stage} />;
  if (g.ring) return <RingShape g={g} selected={selected} hot={hot} hovered={hovered} color={g.color ?? GROUP_COLORS[g.kind] ?? "#706fd3"} />;
  const color = g.stage ? STAGE_COLOR : g.color ?? GROUP_COLORS[g.kind] ?? "#706fd3";
  return (
    <g data-id={g.id} data-role="group" role="button" aria-pressed={selected} aria-label={`Grupo ${g.label}`} transform={`translate(${g.x},${g.y})`} className={`group${g.stage ? " stage-frame" : ""}${stage?.viz ? ` logic-viz-${stage.viz}` : ""}${selected ? " sel" : ""}${hot ? " drop-target" : ""}`} style={{ ["--gc" as string]: color }}>
      <title>{g.label}</title>
      <rect className="group-body" width={g.w} height={g.h} rx={26} style={fillStyle(g)} />
      <rect className="group-edge" width={g.w} height={g.h} rx={26} pointerEvents="none" />
      <g pointerEvents="none">
        <text className="group-kind" x={20} y={24}>
          {(g.tag ?? g.kind).toUpperCase()}
          {g.subdomain ? ` · ${g.subdomain.toUpperCase()}` : ""}
        </text>
        <text className="group-label" x={20} y={44}>
          {truncate(g.label, Math.floor((g.w - 40) / 9))}
        </text>
      </g>
      {g.stage && g.stage.text && (
        <text className="group-stage-text" x={20} y={62} pointerEvents="none">
          {truncate(g.stage.text, Math.floor((g.w - 70) / 6.4))}
        </text>
      )}
      {g.stage && <StageToggle id={g.id} x={g.w - 24} y={26} collapsed={false} />}
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

/** Escala da fonte e da altura de linha por tipo de bloco do texto rico. */
const BLOCK_SCALE: Record<BlockKind, number> = { p: 1, ul: 1, ol: 1, h1: 1.4, h2: 1.18, pre: 0.95 };
type Seg = Omit<Span, "t"> & { t: string };
interface RichLine {
  segs: Seg[];
  kind: BlockKind;
  /** marcador do primeiro item de uma lista (• ou "1.") */
  bullet?: string;
  /** deslocamento do início do texto, em unidades do quadro */
  indent: number;
}

/** Métricas do texto de uma nota: usadas para desenhar e para alinhar o editor aberto sobre ela. */
export function noteMetrics(n: Pick<NoteEl, "text" | "h" | "variant" | "color" | "fontSize" | "font">) {
  const v = n.variant === "text" ? "text" : "note";
  const color = n.color ?? (v === "note" ? undefined : "var(--ink)");
  const font = n.font;
  if (n.fontSize) {
    const fs = Math.min(120, Math.max(10, n.fontSize));
    return {
      fs,
      lh: fs * (v === "text" ? 1.3 : 1.35),
      x: v === "text" ? 10 : 14,
      top: fs * 1.05 + 4,
      cw: fs * 0.54,
      indent: 0,
      color,
      font,
    };
  }
  const paras = Math.max(1, n.text.split("\n").length);
  const tfs = Math.min(120, Math.max(12, (n.h - 10) / (paras * 1.3))); // texto livre: a fonte acompanha a altura da caixa
  const st = v === "text" ? { fs: tfs, lh: tfs * 1.3, x: 10, top: tfs * 1.05 + 4, cw: tfs * 0.54, indent: 0 } : NOTE_STYLE.note;
  return { ...st, color, font };
}

/** Quebra o texto rico em linhas desenháveis, usando a largura média de um caractere para decidir onde quebrar. */
export function layoutRich(text: string, w: number, st: ReturnType<typeof noteMetrics>, maxH: number): { lines: RichLine[]; ys: number[] } {
  const lines: RichLine[] = [];
  const ys: number[] = [];
  let acc = 0;
  for (const b of parseRich(text)) {
    const k = BLOCK_SCALE[b.kind];
    const listed = b.kind === "ul" || b.kind === "ol";
    const indent = listed ? Math.round(st.fs * 1.5) : 0;
    const per = Math.max(4, Math.floor((w - st.x * 2 - indent) / (st.cw * k)));
    // palavras e espaços, cada um com o estilo do trecho de onde veio
    const toks: Seg[] = [];
    for (const s of b.spans) s.t.split(/( +)/).forEach((t) => t && toks.push({ ...s, t }));
    const rows: Seg[][] = [[]];
    let len = 0;
    for (const t of toks) {
      const wd = t.t.length * (t.b ? 1.07 : 1);
      const space = t.t[0] === " ";
      if (!space && len + wd > per && len > 0) rows.push([]), (len = 0);
      if (space && len === 0) continue; // espaço no começo da linha quebrada
      rows[rows.length - 1].push(t);
      len += wd;
    }
    rows.forEach((segs, i) => {
      const y = st.top + acc + (k - 1) * st.fs * 0.9;
      acc += st.lh * k;
      if (y > maxH) return;
      lines.push({ segs, kind: b.kind, indent, bullet: i === 0 && listed ? (b.kind === "ul" ? "•" : `${b.n ?? 1}.`) : undefined });
      ys.push(y);
    });
  }
  return { lines, ys };
}

const NOTE_BAR_H = 220;

const PlainNote = memo(function PlainNote({
  n,
  selected,
  editing,
  onEditChange,
  onEditClose,
  onNoteCard,
}: {
  n: NoteEl;
  selected: boolean;
  editing?: boolean;
  onEditChange?: (text: string) => void;
  onEditClose?: () => void;
  onNoteCard?: (patch: NoteCardStyle) => void;
}) {
  const v = n.variant ?? "note";
  const st = noteMetrics(n);
  const ink = st.color;
  const editRef = useRef<HTMLTextAreaElement>(null);
  const html = useMemo(() => richToHtml(n.text), [n.text]);
  const pad = `${Math.max(2, st.top - st.fs * 0.95)}px ${st.x}px 8px`;
  const typeStyle = {
    fontSize: st.fs,
    lineHeight: `${st.lh}px`,
    padding: pad,
    fontFamily: st.font && st.font !== "sans" ? FONT_CSS[st.font] : undefined,
    fontWeight: v === "text" ? 600 : undefined,
    color: ink ?? undefined,
  } as const;
  return (
    <g data-id={n.id} data-role="note" role="button" aria-pressed={selected} aria-label={`${n.variant === "text" ? "Texto" : n.variant === "list" ? "Lista" : "Nota"}: ${plainText(n.title ?? n.text ?? "").slice(0, 80)}`} transform={`translate(${n.x},${n.y})`} className={`note ${v}${selected ? " sel" : ""}${editing ? " editing" : ""}`}>
      <rect className="note-body" width={n.w} height={n.h} rx={14} filter={v === "text" ? undefined : "url(#shadow)"} style={n.fill ? { fill: n.fill } : undefined} />
      {!editing && (
        <foreignObject x={0} y={0} width={n.w} height={n.h} className="note-rich-fo">
          <div {...{ xmlns: "http://www.w3.org/1999/xhtml" }} className={`note-rich-view note-md${v === "text" ? " text" : ""}`} style={{ width: n.w, height: n.h, ...typeStyle }} dangerouslySetInnerHTML={{ __html: html }} />
        </foreignObject>
      )}
      {editing && onEditChange && onEditClose && (
        <>
          {/* barra acima do card — largura própria, sem scroll dentro da nota */}
          {/* a barra quebra em mais linhas em cards estreitos: ancorada pela base, cresce para cima */}
          <foreignObject x={0} y={-(NOTE_BAR_H + 6)} width={Math.max(n.w, 340)} height={NOTE_BAR_H} className="note-rich-bar-fo" style={{ overflow: "visible" }}>
            <div {...{ xmlns: "http://www.w3.org/1999/xhtml" }} className="note-rich-bar-host" onPointerDown={(e) => e.stopPropagation()}>
              <RichToolbar root={editRef} className="in-card" compact noteCard={{ fontSize: n.fontSize ?? Math.round(st.fs), fill: n.fill, color: n.color, font: n.font }} onNoteCard={onNoteCard} />
            </div>
          </foreignObject>
          <foreignObject x={0} y={0} width={n.w} height={n.h} className="note-rich-fo">
            <div {...{ xmlns: "http://www.w3.org/1999/xhtml" }} className={`note-rich-host${v === "text" ? " text" : ""}`} style={{ width: n.w, height: n.h, color: ink ?? undefined }} onPointerDown={(e) => e.stopPropagation()}>
              <RichEditor
                innerRef={editRef}
                value={n.text}
                onChange={onEditChange}
                onClose={onEditClose}
                autoFocus
                label="Editar markdown"
                placeholder="Escreva em markdown…"
                className="in-card-editor"
                style={typeStyle}
              />
            </div>
          </foreignObject>
        </>
      )}
      {selected && !editing && <ResizeGrip w={n.w} h={n.h} />}
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
  const fontFamily = n.font && n.font !== "sans" ? FONT_CSS[n.font] : undefined;
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
    <g data-id={n.id} data-role="note" role="button" aria-pressed={selected} aria-label={`${n.variant === "text" ? "Texto" : n.variant === "list" ? "Lista" : "Nota"}: ${(n.title ?? n.text ?? "").slice(0, 80)}`} transform={`translate(${n.x},${n.y})`} className={`note list${selected ? " sel" : ""}`} style={{ ["--lc" as string]: color }}>
      <rect className="note-body" width={n.w} height={n.collapsed && title ? 46 : n.h} rx={18} filter="url(#shadow)" />
      {title && <CollapseToggle id={n.id} x={n.w - 26} y={23} collapsed={!!n.collapsed} />}
      <path d={`M18 0.8H${n.w - 18}`} stroke={color} strokeWidth={3} strokeLinecap="round" pointerEvents="none" opacity={0.9} />
      {title && (
        <text x={18} y={31} className="list-title" pointerEvents="none" style={{ fontFamily }}>
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
          <text x={40} y={17} className={`list-item${r.mark === "done" ? " done" : ""}`} pointerEvents="none" style={{ fontFamily }}>
            {parseInline(r.t).map((s, j) => (
              <tspan
                key={j}
                style={{
                  fontWeight: s.weight ?? (s.b ? 800 : undefined),
                  fontStyle: s.i ? "italic" : undefined,
                  textDecoration: s.s || r.mark === "done" ? "line-through" : undefined,
                  fontFamily: s.c ? FONT_CSS.mono : s.font ? FONT_CSS[s.font] : fontFamily,
                  fill: s.color,
                }}
              >
                {s.t}
              </tspan>
            ))}
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
    <g data-id={n.id} data-role="note" role="button" aria-pressed={selected} aria-label={`${n.variant === "text" ? "Texto" : n.variant === "list" ? "Lista" : "Nota"}: ${(n.title ?? n.text ?? "").slice(0, 80)}`} transform={`translate(${n.x},${n.y})`} className={`note list checklist${selected ? " sel" : ""}`} style={{ ["--lc" as string]: color }}>
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

export const NoteShape = memo(function NoteShape({
  n,
  selected,
  editing,
  onEditChange,
  onEditClose,
  onNoteCard,
}: {
  n: NoteEl;
  selected: boolean;
  editing?: boolean;
  onEditChange?: (text: string) => void;
  onEditClose?: () => void;
  onNoteCard?: (patch: NoteCardStyle) => void;
}) {
  if (n.variant === "list" && n.checklist) return <ChecklistShape n={n} selected={selected} />;
  return n.variant === "list" ? <ListShape n={n} selected={selected} /> : <PlainNote n={n} selected={selected} editing={editing} onEditChange={onEditChange} onEditClose={onEditClose} onNoteCard={onNoteCard} />;
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

/** Pílula do rótulo de uma conexão: texto completo (a largura vem da medida real do texto) e marca de interface. */
function LabelPill({ c, mid }: { c: ConnectionEl; mid: Pt }) {
  // uses-tool: o nó da tool já diz o nome; o rótulo cobria os nós em times com várias tools (D-12). A relação segue no inspetor.
  if (c.agent?.rel === "uses-tool") return null;
  const ls = labelSize(c);
  if (!ls) return null;
  const { text, sub, w, h } = ls;
  return (
    <g transform={`translate(${mid.x},${mid.y})`} className="edge-label" data-label-drag="1">
      <title>{[c.label, c.protocol].filter(Boolean).join(" · ")}</title>
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
        <g transform={`translate(${w / 2 - 14},0)`}>
          <circle r={4.5} fill={CONNECTION_TYPES[c.type].color} opacity={0.9} />
        </g>
      )}
    </g>
  );
}

/** Rótulo desenhado por cima dos nós e das notas, para nunca ficar escondido atrás de um componente; clicar ou arrastar seleciona a conexão como antes. */
export const EdgeLabel = memo(function EdgeLabel({ c, mid, selected, viz, flow, cover }: { c: ConnectionEl; mid: Pt; selected: boolean; viz?: Viz; flow?: boolean; cover?: number }) {
  return (
    <g data-id={c.id} data-role="conn" className={`edge${selected ? " sel" : ""}${flow ? " flow-edge" : ""}${viz ? ` play-${viz}` : ""}`} style={{ ["--ec" as string]: flow ? FLOW_EDGE[flowKey(c)].color : CONNECTION_TYPES[c.type].color }}>
      <LabelPill c={c} mid={mid} />
      {cover !== undefined && <CoverChip c={c} mid={mid} n={cover} />}
    </g>
  );
});

/** Modo Logic: quantos cenários passam por esta saída. Zero fica tracejado em âmbar: é um caminho que nenhum teste mostra. */
function CoverChip({ c, mid, n }: { c: ConnectionEl; mid: Pt; n: number }) {
  const ls = labelSize(c);
  const text = n ? `${n} ${n === 1 ? "cenário" : "cenários"}` : "sem cenário";
  const w = text.length * 5.6 + 14;
  const x = ls ? mid.x + ls.w / 2 + 4 : mid.x - w / 2;
  return (
    <g transform={`translate(${x},${mid.y - 8})`} className={`cover-chip${n ? "" : " none"}`} pointerEvents="none">
      <title>{n ? `${n} exemplo(s) de cenário passam por esta seta` : "Nenhum cenário passa por esta seta: crie um que mostre este caminho"}</title>
      <rect width={w} height={16} rx={8} />
      <text x={w / 2} y={11.5} textAnchor="middle">
        {text}
      </text>
    </g>
  );
}

export const Edge = memo(function Edge({ c, d, mid, selected, animate, fromName, toName, withLabel = true, viz, flow }: { c: ConnectionEl; d: string; mid: Pt; selected: boolean; animate: boolean; fromName?: string; toName?: string; withLabel?: boolean; viz?: Viz; flow?: boolean }) {
  const t = CONNECTION_TYPES[c.type];
  const fl = flow ? FLOW_EDGE[flowKey(c)] : undefined;
  const color = fl?.color ?? t.color;
  const pid = `p-${c.id}`;
  const motion = !fl && animate && c.animated !== false ? t.motion : "none";
  const runFlow = useEdgeRunMark(c.id);
  return (
    <g data-id={c.id} data-role="conn" role="img" aria-label={`Conexão ${t.label.toLowerCase()}${c.label ? `: ${c.label}` : ""}, de ${fromName ?? c.from} para ${toName ?? c.to}`} className={`edge${selected ? " sel" : ""}${fl ? " flow-edge" : ""}${viz ? ` play-${viz}` : ""}${runFlow ? " run-flow" : ""}`} style={{ ["--ec" as string]: color }}>
      <path d={d} fill="none" stroke="transparent" strokeWidth={16} vectorEffect="non-scaling-stroke" />
      {selected && <path d={d} className="edge-glow" fill="none" stroke={color} strokeWidth={9} strokeOpacity={0.18} strokeLinecap="round" />}
      <path
        id={pid}
        d={d}
        fill="none"
        stroke={color}
        strokeWidth={selected ? 2.6 : fl ? 1.7 : 2}
        strokeDasharray={fl ? fl.dash : t.dash}
        strokeLinecap="round"
        markerEnd={fl ? `url(#h-lg-${flowKey(c)})` : t.head !== "none" ? `url(#h-${c.type})` : undefined}
        markerStart={!fl && t.tail !== "none" ? `url(#t-${c.type})` : undefined}
        opacity={motion === "none" ? (fl ? 0.88 : 0.95) : 0.55}
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
      {c.port && <PortMark c={c} d={d} color={color} />}
      {withLabel && <LabelPill c={c} mid={mid} />}
    </g>
  );
});

/**
 * Porta da conexão (modo domain, inversão de dependência): o anel de interface da UML sobre o traçado, perto da origem
 * (a interface é da camada dela); o nome e as operações aparecem no balão ao passar o mouse.
 */
function PortMark({ c, d, color }: { c: ConnectionEl; d: string; color: string }) {
  const at = useMemo(() => {
    const pts = samplePath(d);
    return pts[Math.round((pts.length - 1) * 0.28)];
  }, [d]);
  if (!at || !c.port) return null;
  return (
    <g className="edge-port" transform={`translate(${at.x},${at.y})`} pointerEvents="visiblePainted">
      <title>{[`Porta ${c.port.name}`, ...(c.port.operations ?? []), "(a origem depende desta interface; o destino a implementa)"].join("\n")}</title>
      <circle r={7} fill="var(--node-fill)" stroke={color} strokeWidth={2.4} />
      <circle r={2.4} fill={color} />
    </g>
  );
}

export const withWaypoints = (c: ConnectionEl, wps: Pt[]): ConnectionEl => {
  const { waypoints: _drop, ...rest } = c;
  return wps.length ? { ...rest, waypoints: wps } : rest;
};

/** Puxadores de uma conexão selecionada: pontos existentes (arraste; duplo clique remove) e "+" nos trechos para criar novos. */
function EdgeHandles({ c, g, z }: { c: ConnectionEl; g: { pts?: Pt[]; mid: Pt; anchors?: Pt[] }; z: number }) {
  const pts = g.pts ?? [];
  const wps = c.waypoints ?? [];
  const r = clamp(6 / z, 4.5, 14);
  const color = CONNECTION_TYPES[c.type].color;
  return (
    <g className="edge-handles" style={{ ["--ec" as string]: color }}>
      {pts.slice(0, -1).map((a, i) => {
        const b = pts[i + 1];
        const m = g.anchors?.[i] ?? (pts.length === 2 ? g.mid : { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
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

/** Barra da inspeção de fluxo: resumo do subgrafo, sentido (tudo / a jusante / a montante) e saída. */
function FlowBar({ id, mode, flow }: { id: string; mode: FlowMode; flow: ReturnType<typeof flowOf> }) {
  const label = useStore((s) => s.doc.nodes.find((n) => n.id === id)?.label ?? id);
  const set$ = (m: FlowMode) => inspectFlow(id, m);
  const total = flow.nodes.size - 1;
  return (
    <div className="glass flow-bar" role="region" aria-label="Inspeção de fluxo">
      <div className="flow-info">
        <span className="flow-kicker">Fluxo de</span>
        <b title={label}>{label}</b>
        <span className="flow-count">
          {total} componente{total === 1 ? "" : "s"} · {flow.up} a montante · {flow.down} a jusante
        </span>
      </div>
      <div className="seg" role="radiogroup" aria-label="Sentido do fluxo">
        {([["both", "Tudo"], ["up", "← Entradas"], ["down", "Saídas →"]] as [FlowMode, string][]).map(([k, l]) => (
          <button key={k} role="radio" aria-checked={mode === k} className={mode === k ? "active" : ""} onClick={() => set$(k)}>
            {l}
          </button>
        ))}
      </div>
      <button className="btn sm" onClick={exitFlow} data-tip="Sair da inspeção (Esc)">
        Sair
      </button>
    </div>
  );
}

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
      {Object.entries(FLOW_EDGE).map(([k, v]) => (
        <marker key={k} id={`h-lg-${k}`} viewBox="0 0 12 12" refX="10" refY="6" markerWidth="10" markerHeight="10" orient="auto" markerUnits="userSpaceOnUse">
          <path d="M2 2L10 6L2 10" fill="none" stroke={v.color} strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
        </marker>
      ))}
      {(Object.keys(CONNECTION_TYPES) as ConnectionType[]).map((k) => (
        <Marker key={k} type={k} />
      ))}
    </>
  );
}

/**
 * Reprodução de um cenário: o porquê do passo atual escrito ao lado do nó, para não precisar desviar o olho para o painel.
 * Decisão e laço mostram a condição com os valores do momento e a resposta; ação mostra a conta com os valores e o que mudou.
 */
function PlayCallout({ doc }: { doc: Doc }) {
  const play = useStore((s) => s.play);
  // com o quadro afastado o balão não encolhe junto: continua legível (como um texto de interface)
  const scale = useStore((s) => Math.max(1, 0.9 / s.view.z));
  const info = useMemo(() => {
    if (!play) return null;
    const steps = playSteps(play.run);
    const st = steps[play.k];
    const real = st && doc.nodes.find((x) => x.id === st.rule);
    if (!st || !real) return null;
    const inStage = hiddenBy(doc).get(real.id);
    const n: { x: number; y: number; w: number; h: number } = (inStage && doc.groups.find((g) => g.id === inStage)) || real;
    const why = whyOf(doc, st, valuesAfter(play.run, play.k));
    const lines: { t: string; cls: string }[] = [];
    // explicar: num momento de vários passos (etapa, volta), o balão conta o saldo do momento
    const moment = play.mode === "explain" && play.story.length ? play.story[storyAt(play.story, play.k)] : undefined;
    if (moment && moment.end > moment.k) {
      for (const c of moment.changes) lines.push({ t: `${c.name} = ${shortValue(c.to)}  (era ${shortValue(c.from)})`, cls: "chg" });
      if (!lines.length) lines.push({ t: "nada mudou nos dados", cls: "code" });
      return { n, lines: lines.slice(0, 7).map((l) => ({ ...l, t: truncate(l.t, 64) })), answer: moment.title, role: st.role, branch: undefined };
    }
    if (st.error) lines.push({ t: `Erro: ${st.error}`, cls: "err" });
    for (const l of why.lines) lines.push(l.values && l.values !== l.code ? { t: l.values, cls: "val" } : { t: l.code, cls: "code" });
    for (const c of st.changes) lines.push({ t: `${c.name} = ${shortValue(c.to)}  (era ${shortValue(c.from)})`, cls: "chg" });
    if (st.blocked.length) lines.push({ t: `travado, não mudou: ${st.blocked.join(", ")}`, cls: "err" });
    if (st.role === "rule" && !st.applied) lines.push({ t: "a condição não valeu: nada mudou", cls: "code" });
    if (!lines.length && !why.answer) return null;
    const shown = lines.slice(0, 7).map((l) => ({ ...l, t: truncate(l.t, 64) }));
    if (lines.length > 7) shown.push({ t: `+${lines.length - 7} no painel`, cls: "code" });
    return { n, lines: shown, answer: why.answer, role: st.role, branch: st.branch };
  }, [doc, play]);
  if (!info) return null;
  const { n, lines, answer } = info;
  const head = answer ? 26 : 8;
  const w = Math.min(470, Math.max(170, ...lines.map((l) => l.t.length * 6.5 + 26), (answer?.length ?? 0) * 7.2 + 40));
  const h = head + lines.length * 18 + 8;
  const tone = info.branch === "sim" ? " yes" : info.branch === "nao" || info.branch === "erro" ? " no" : "";
  return (
    <g transform={`translate(${n.x + n.w + 18},${n.y + Math.min(n.h / 2, 30) - 18}) scale(${scale})`} className="play-callout" pointerEvents="none" aria-hidden>
      <path d="M0,12 L-9,18 L0,24 Z" className="pc-box" />
      <rect width={w} height={h} rx={12} className="pc-box" />
      {answer && (
        <text x={12} y={18} className={`pc-ans${tone}`}>
          → {answer}
        </text>
      )}
      {lines.map((l, i) => (
        <text key={i} x={12} y={head + 13 + i * 18} className={`pc-line ${l.cls}`}>
          {l.t}
        </text>
      ))}
    </g>
  );
}

/**
 * Modo Logic: o cartão de resumo no topo do quadro (a porta de entrada). O que o fluxo faz, o que entra, o que sai,
 * quantos passos e etapas, e se os cenários batem. Clicar abre a visão geral completa.
 */
export function SummaryCard({ doc }: { doc: Doc }) {
  const box = logicSummaryBox(doc);
  const s = useMemo(() => (box ? logicSummary(doc) : null), [doc, !!box]);
  const t = useMemo(() => summaryText(doc), [doc]);
  if (!box || !s) return null;
  const P = SUMMARY_PAD;
  const allOk = s.scenarios.total > 0 && s.scenarios.ok === s.scenarios.total;
  const score = s.scenarios.total ? `${allOk ? "✔" : "✘"} ${s.scenarios.ok}/${s.scenarios.total} cenários batem` : "sem cenários";
  const scoreW = score.length * 6.9 + 24;
  const descTop = P + 18 + 30;
  const factsTop = descTop + (t.desc.length ? 8 + t.desc.length * 19 : 0) + 22;
  const flow = [`${s.steps} passos`, s.stages.length ? `${s.stages.length} etapas` : "sem etapas"];
  const cols: { label: string; lines: string[]; mono?: boolean }[] = [
    { label: "Entra", lines: t.inputs, mono: true },
    { label: "Sai", lines: t.outputs, mono: true },
    { label: "Fluxo", lines: flow },
  ];
  let x = P;
  return (
    <g transform={`translate(${box.x},${box.y})`} className="summary-card" data-role="summary" role="button" aria-label={`Resumo: ${s.title}. Abrir a visão geral`} onClick={() => set({ modal: { type: "logic", tab: "overview" } })} onPointerDown={(e) => e.stopPropagation()}>
      <title>Resumo do fluxo: clique para a visão geral (contrato de dados e matriz de cenários)</title>
      <rect width={box.w} height={box.h} rx={22} className="sc-body" />
      <rect width={6} height={box.h - 44} x={0} y={22} rx={3} className="sc-accent" />
      <text x={P} y={P + 8} className="sc-kicker">
        RESUMO DO FLUXO
      </text>
      <g transform={`translate(${box.w - P - scoreW},${P - 6})`} className={`sc-score${s.scenarios.total ? (allOk ? " ok" : " fail") : ""}`}>
        <rect width={scoreW} height={24} rx={12} />
        <text x={scoreW / 2} y={16} textAnchor="middle">
          {score}
        </text>
      </g>
      <text x={P} y={P + 40} className="sc-title">
        {truncate(s.title, 52)}
      </text>
      {t.desc.map((line, i) => (
        <text key={i} x={P} y={descTop + 18 + i * 19} className="sc-desc">
          {line}
        </text>
      ))}
      <line x1={P} x2={box.w - P} y1={factsTop - 8} y2={factsTop - 8} className="sc-rule" />
      {cols.map((c, k) => {
        const cx = x;
        x += SUMMARY_COLS[k];
        return (
          <g key={c.label} transform={`translate(${cx},${factsTop + 10})`}>
            <text className="sc-label">{c.label.toUpperCase()}</text>
            {c.lines.map((line, i) => (
              <text key={i} y={20 + i * 18} className={c.mono ? "sc-val mono" : "sc-val"}>
                {line}
              </text>
            ))}
          </g>
        );
      })}
    </g>
  );
}

/* ───────────────────────── canvas ───────────────────────── */

export function Canvas() {
  const doc = useStore((s) => s.doc);
  const lstatus = useMemo(() => (docMode(doc) === "logic" ? logicStatus(doc) : null), [doc]);
  const lgaps = useMemo(() => (docMode(doc) === "logic" ? coverageGaps(doc) : null), [doc]);
  const lnames = useMemo(() => (docMode(doc) === "logic" ? dataNames(doc) : NO_NAMES), [doc]);
  const play = useStore((s) => s.play);
  const selId = useStore((s) => (s.sel.length === 1 ? s.sel[0] : null));
  // destaque do fluxo: reprodução de um cenário (passo atual, caminho já percorrido) ou os dados/passos ligados ao selecionado
  const viz = useMemo(() => {
    const nodes = new Map<string, Viz>();
    const edges = new Map<string, Viz>();
    const badges = new Map<string, number>();
    const visits = new Map<string, number>();
    const liveVals = new Map<string, LiveValue>();
    const stages = new Map<string, Viz>();
    const rows = new Map<string, string>();
    if (docMode(doc) !== "logic") return { nodes, edges, badges, visits, live: liveVals, stages, rows };
    if (play) {
      const steps = playSteps(play.run);
      // passos escondidos numa etapa recolhida: quem acende é o cartão da etapa
      const hid = hiddenBy(doc);
      for (const g of doc.groups) if (g.stage?.collapsed) stages.set(g.id, "dim");
      steps.slice(0, play.k + 1).forEach((st, i) => {
        const g = hid.get(st.rule);
        if (g) stages.set(g, i === play.k ? "cur" : stages.get(g) === "cur" ? "cur" : "vis");
      });
      const eids = edgeIdsOf(doc, play.run);
      for (const nd of doc.nodes) nodes.set(nd.id, "dim");
      for (const c of doc.connections) edges.set(c.id, "dim");
      // o número é o da última passagem; num laço, o selo ao lado conta quantas vezes o fluxo já passou ali
      for (const [id, v] of visitsUpTo(steps, play.k)) {
        nodes.set(id, v.last === play.k ? "cur" : "vis");
        badges.set(id, v.last + 1);
        if (v.count > 1) visits.set(id, v.count);
      }
      // o valor de cada dado depois do passo atual, escrito no próprio cartão do dado
      // explicar: os valores do fim do momento (e o que o momento mudou); depurar: os do passo atual
      const moment = play.mode === "explain" && play.story.length ? play.story[storyAt(play.story, play.k)] : undefined;
      const env = valuesAfter(play.run, moment ? moment.end : play.k);
      const changed = moment ? new Set(moment.changes.map((c) => c.name)) : changedAt(steps[play.k]);
      for (const nd of dataNodes(doc)) {
        nodes.delete(nd.id); // os dados não se apagam: são o painel de valores do quadro
        const key = dataKey(nd);
        if (key in env) liveVals.set(nd.id, { text: shortValue(env[key]), changed: changed.has(key) });
      }
      for (let i = 0; i < play.k; i++) if (eids[i]) edges.set(eids[i]!, i === play.k - 1 ? "cur" : "vis");
      // explicar: o momento inteiro (uma passagem por etapa, uma volta) acende, não só o primeiro passo dele
      if (play.mode === "explain" && play.story.length) {
        const it = play.story[storyAt(play.story, play.k)];
        for (let i = it.k; i <= it.end; i++) {
          nodes.set(steps[i].rule, "cur");
          const g = hid.get(steps[i].rule);
          if (g) stages.set(g, "cur");
          if (i < it.end && eids[i]) edges.set(eids[i]!, "cur");
        }
      }
      const cur = steps[play.k]?.rule;
      if (steps[play.k]?.role === "table" && steps[play.k].branch) rows.set(cur, steps[play.k].branch!); // a linha da tabela que valeu
      if (cur) for (const r of relatedTo(doc, cur)) nodes.set(r, "rel"); // os dados do passo atual acendem junto
      if (play.scenario) nodes.set(play.scenario, "vis");
    } else if (selId) {
      const sel = doc.nodes.find((x) => x.id === selId);
      if (sel?.logic && sel.logic.role !== "scenario") {
        const rel = relatedTo(doc, selId);
        if (rel.size) {
          const factSel = isDataRole(sel.logic.role);
          for (const nd of doc.nodes) {
            if (nd.id === selId) continue;
            const isFact = isDataRole(nd.logic?.role);
            if (rel.has(nd.id)) nodes.set(nd.id, "rel");
            else if (factSel ? !isFact : isFact) nodes.set(nd.id, "dim");
          }
        }
      }
    }
    return { nodes, edges, badges, visits, live: liveVals, stages, rows };
  }, [doc, play, selId]);
  // etapas recolhidas: o quadro desenhado é a projeção (cartão no lugar dos passos); o resumo de cada cartão sai dos exemplos
  const vdoc = useMemo(() => (docMode(doc) === "logic" ? projectStages(doc) : doc), [doc]);
  // cobertura por seta (fora da reprodução, que tem o próprio destaque): quantos cenários passam em cada saída
  const loops = useMemo(() => (docMode(doc) === "logic" ? loopFrames(vdoc) : []), [vdoc]);
  const cover = useMemo(() => (docMode(doc) === "logic" && !play && doc.nodes.some((n) => n.logic?.role === "scenario") ? edgeCoverage(doc) : null), [doc, play]);
  const stageViews = useMemo(() => {
    const m = new Map<string, StageView>();
    if (docMode(doc) !== "logic" || !doc.groups.some((g) => g.stage?.collapsed)) return m;
    const results = checkExamples(doc);
    for (const g of doc.groups) if (g.stage?.collapsed) m.set(g.id, { summary: stageSummary(doc, g.id, results, lstatus ?? undefined) });
    return m;
  }, [doc, lstatus]);
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
  const [paneMenu, setPaneMenu] = useState<{ x: number; y: number; at: Pt } | null>(null);
  /** clique numa área do layout "camadas": o que dá para adicionar ali */
  const [ringMenu, setRingMenu] = useState<{ x: number; y: number; id: string } | null>(null);
  const [nodeMenu, setNodeMenu] = useState<{ x: number; y: number; id: string } | null>(null);
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);

  // Enter com nota/texto selecionado abre a edição in-place no quadro
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Enter" || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      if (editingNoteId || getState().present) return;
      const id = getState().sel.length === 1 ? getState().sel[0] : null;
      const n = id ? getState().doc.notes.find((x) => x.id === id) : null;
      if (!n || n.variant === "list") return;
      e.preventDefault();
      setEditingNoteId(n.id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editingNoteId]);

  useEffect(() => {
    if (!menu && !nodeMenu && !paneMenu && !ringMenu) return;
    const close = () => (setMenu(null), setNodeMenu(null), setPaneMenu(null), setRingMenu(null));
    const esc = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("pointerdown", close);
    window.addEventListener("blur", close);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("blur", close);
      window.removeEventListener("keydown", esc);
    };
  }, [menu, nodeMenu, paneMenu, ringMenu]);

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
    const cands = d.groups.filter((g) => !exclude.has(g.id) && !g.ring?.frame && (g.ring ? insideGroupShape(g, p) : contains(g, p)));
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
    if (t?.role === "stage-toggle" && t.id) {
      toggleStage(t.id);
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
    if (t?.role === "conn" && t.id && e.button === 0 && !e.shiftKey && (e.target as Element).closest("[data-label-drag]")) {
      // arrastar o texto do conector reposiciona o rótulo ao longo (e ao lado) do traçado
      select([t.id]);
      beginTx();
      drag.current = { kind: "label", id: t.id };
      return;
    }
    // anel do layout "camadas": não se arrasta (sairia do centro); arrastar seleciona por área e o clique abre o menu de adicionar
    if (t?.role === "group" && t.id && s.doc.groups.find((g) => g.id === t.id)?.ring && !e.shiftKey) {
      select([]);
      drag.current = { kind: "marquee", start: p, cur: p, additive: false, base: [], ring: t.id };
      force((n) => n + 1);
      return;
    }
    if (t && t.id && (t.role === "node" || t.role === "group" || t.role === "note" || t.role === "conn")) {
      // Ctrl+clique numa skill abre a modal de edição, sem iniciar um arraste
      if (t.role === "node" && (e.ctrlKey || e.metaKey) && !e.shiftKey && s.doc.nodes.find((n) => n.id === t.id)?.agent?.role === "skill") {
        select([t.id]);
        set({ modal: { type: "skill", id: t.id, tab: "write" } });
        return;
      }
      let nextSel = s.sel;
      if (e.shiftKey) nextSel = s.sel.includes(t.id) ? s.sel.filter((x) => x !== t.id) : [...s.sel, t.id];
      else if (!s.sel.includes(t.id)) nextSel = [t.id];
      select(nextSel);
      // conjunto em movimento: selecionados + descendentes de grupos
      const startMove = (ids: string[], id: string, under?: string, editNote?: string) => {
        const moving = new Set<string>();
        const add = (x: string) => {
          if (moving.has(x)) return;
          moving.add(x);
          s.doc.nodes.filter((n) => n.parent === x || n.owner === x).forEach((n) => add(n.id));
          s.doc.groups.filter((g) => g.parent === x).forEach((g) => add(g.id));
        };
        ids.forEach(add);
        const origin = new Map<string, Pt>();
        [...s.doc.nodes, ...s.doc.groups, ...s.doc.notes].forEach((el) => moving.has(el.id) && origin.set(el.id, { x: el.x, y: el.y }));
        beginTx();
        drag.current = { kind: "move", start: p, origin, moved: false, id, under, editNote };
      };
      const reclickNote =
        t.role === "note" && !e.shiftKey && s.sel.length === 1 && s.sel[0] === t.id && s.doc.notes.find((n) => n.id === t.id)?.variant !== "list"
          ? t.id
          : undefined;
      if (t.role !== "conn" && nextSel.includes(t.id)) startMove(nextSel, t.id, undefined, reclickNote);
      else if (t.role === "conn") {
        // a conexão (traço largo e rótulo) fica por cima dos grupos: arrastar a partir dela move o que está embaixo
        for (const el of document.elementsFromPoint(e.clientX, e.clientY)) {
          const r = (el as Element).closest?.("[data-role]") as SVGElement | null;
          const role = r?.dataset.role;
          if (r?.dataset.id && (role === "node" || role === "group" || role === "note")) {
            startMove([r.dataset.id], r.dataset.id, r.dataset.id);
            break;
          }
        }
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
        const rawDx = p.x - d.start.x;
        const rawDy = p.y - d.start.y;
        if (!d.moved && Math.hypot(rawDx, rawDy) * s.view.z < 3) return;
        // o snap vale para o deslocamento (não para a posição): item fora da grade não "pula" ao começar a arrastar
        const dx = snapV(rawDx, s.snap);
        const dy = snapV(rawDy, s.snap);
        if (!d.moved && d.under) select([d.under]);
        d.moved = true;
        const nd: Doc = { ...s.doc };
        const mv = <T extends { id: string; x: number; y: number }>(arr: T[]) =>
          arr.map((el) => {
            const o = d.origin.get(el.id);
            return o ? { ...el, x: o.x + dx, y: o.y + dy } : el;
          });
        nd.nodes = mv(s.doc.nodes);
        nd.groups = s.doc.groups.map((g) => (d.origin.has(g.id) ? { ...mv([g])[0], auto: false } : g));
        nd.notes = mv(s.doc.notes);
        live(nd);
        // destaque do grupo alvo (primeiro item selecionado)
        const lead = d.under ?? s.sel[0];
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
        // estilo CAD: esquerda→direita seleciona só o que está inteiro dentro da área; direita→esquerda também o que apenas a toca
        const crossing = p.x < d.start.x;
        const groups = s.doc.groups.filter((g) => contains(r, { x: g.x + 1, y: g.y + 1 }) && contains(r, { x: g.x + g.w - 1, y: g.y + g.h - 1 }));
        const hit = [...s.doc.nodes, ...s.doc.notes, ...groups].filter((el) => (crossing ? intersects(el, r) : within(el, r))).map((el) => el.id);
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
      case "label": {
        const edge = edges.find((x) => x.c.id === d.id);
        if (!edge) break;
        const { t, offset } = projectOnPath(samplePath(edge.g.d), p);
        // perto da linha, o texto "gruda" nela; o extremo é evitado para não encostar nos componentes
        const off = Math.abs(offset) < 10 / s.view.z ? 0 : Math.round(offset);
        live({ ...s.doc, connections: s.doc.connections.map((c) => (c.id === d.id ? { ...c, labelT: clamp(t, 0.06, 0.94), labelOffset: off || undefined } : c)) });
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
        if (!d.moved && !d.under && e.button === 0 &&!e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
          // clique simples numa referência a outro diagrama → visualizar em modal
          const ref = s.doc.nodes.find((n) => n.id === d.id)?.ref;
          if (ref) set({ modal: { type: "diagram-view", diagram: ref.diagram, node: ref.node } });
        }
        // segundo clique (sem arrastar) na nota já selecionada → editar o texto no quadro
        if (!d.moved && d.editNote) setEditingNoteId(d.editNote);
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
      case "marquee":
        if (d.ring && Math.hypot(p.x - d.start.x, p.y - d.start.y) * s.view.z < 5 && onionPicks(s.doc.groups.find((g) => g.id === d.ring)?.ring?.layer).length)
          setRingMenu({ x: e.clientX, y: e.clientY, id: d.ring });
        break;
      case "resize":
      case "waypoint":
      case "label":
      case "ink":
      case "erase":
        endTx();
        break;
      case "connect": {
        const to = connectTarget(e.clientX, e.clientY, d.from);
        if (to) {
          // no modo domain o tipo vem da relação de domínio (inferida pelos dois elementos); a barra de tipos é da arquitetura
          // decisão (modo lógica): a 1ª seta nasce «sim» e a 2ª «não»; antes ficava sem saída e só a validação reclamava
          const logic = docMode(s.doc) === "logic" ? nextExit(s.doc, d.from) : undefined;
          const [r] = run([
            {
              op: "add_connection",
              from: d.from,
              to,
              ...(logic ? { logic } : {}),
              ...(docMode(s.doc) === "domain" || docMode(s.doc) === "logic" || docMode(s.doc) === "agents"
                ? {}
                : { type: s.defaults.connType, ...(s.defaults.connRouting !== "curve" ? { routing: s.defaults.connRouting } : {}) }),
            },
          ]);
          if (r.ok && r.id) {
            select([r.id]);
            if (logic?.case === undefined) set({ focusTick: getState().focusTick + 1 }); // já abre o campo "Rótulo" para nomear a conexão (a seta de um caso abre a própria condição)
          } else if (r.error) toastError(r.error);
        }
        break;
      }
      case "create": {
        const r = normRect(d.start, p);
        const big = r.w > 60 && r.h > 40;
        if (d.tool === "group") {
          const box = big ? r : { x: d.start.x - 160, y: d.start.y - 100, w: 320, h: 200 };
          const gd = s.defaults;
          const [res] = run([
            {
              op: "add_group",
              label: "Novo grupo",
              kind: gd.groupKind,
              ...(gd.groupColor ? { color: gd.groupColor } : {}),
              ...(gd.fill ? { fill: gd.fill } : {}),
              ...(gd.fillOpacity != null && gd.fillOpacity !== 1 ? { fillOpacity: gd.fillOpacity } : {}),
              x: snapV(box.x, s.snap),
              y: snapV(box.y, s.snap),
              w: snapV(box.w, s.snap),
              h: snapV(box.h, s.snap),
            },
          ]);
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
          const nd = s.defaults;
          const [res] = run([
            {
              op: "add_note",
              text: dflt.text,
              title: (dflt as { title?: string }).title,
              variant,
              x: snapV(box.x, s.snap),
              y: snapV(box.y, s.snap),
              ...(nd.noteColor ? { color: nd.noteColor } : {}),
              ...(nd.noteFont !== "sans" ? { font: nd.noteFont } : {}),
            },
          ]);
          if (res.ok && res.id) {
            commit({ ...getState().doc, notes: getState().doc.notes.map((n) => (n.id === res.id ? { ...n, w: box.w, h: box.h } : n)) });
            select([res.id]);
            if (variant === "list") set({ focusTick: getState().focusTick + 1 });
            else setEditingNoteId(res.id);
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
    if (t?.id && t.role === "node") {
      // botão direito num componente: inspecionar o fluxo ligado a ele
      e.preventDefault();
      setMenu(null);
      setPaneMenu(null);
      select([t.id]);
      setNodeMenu({ x: Math.min(e.clientX, window.innerWidth - 270), y: Math.min(e.clientY, window.innerHeight - 390), id: t.id });
      return;
    }
    if (!t?.id || (t.role !== "conn" && t.role !== "wp" && t.role !== "wp-add")) {
      setMenu(null);
      setNodeMenu(null);
      if (!t?.id && !getState().tool.match(/^(pen|highlight|eraser)$/)) {
        e.preventDefault();
        setPaneMenu({ x: Math.min(e.clientX, window.innerWidth - 230), y: Math.min(e.clientY, window.innerHeight - 140), at: toWorld(e) });
      } else setPaneMenu(null);
      return;
    }
    setPaneMenu(null);
    e.preventDefault();
    setNodeMenu(null);
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
    // o svg captura o ponteiro no mousedown (setPointerCapture), então o dblclick chega com target = svg: vale o elemento sob o ponto
    const hit = (e.target as Element).closest?.("[data-role]") ? e.target : (document.elementFromPoint(e.clientX, e.clientY) ?? e.target);
    const t = targetOf(hit);
    if (t?.role === "wp" && t.id) {
      // duplo clique num ponto de passagem o remove
      const idx = Number(((e.target as Element).closest("[data-role]") as SVGElement).dataset.idx);
      const doc = getState().doc;
      commit({ ...doc, connections: doc.connections.map((c) => (c.id === t.id ? withWaypoints(c, (c.waypoints ?? []).filter((_, i) => i !== idx)) : c)) });
      return;
    }
    if (t?.role === "wp-add") return;
    if (t?.id && t.role === "node" && getState().doc.nodes.find((n) => n.id === t.id)?.ref) return; // o clique já abriu o visualizador
    if (t?.id && t.role === "note") {
      const nt = getState().doc.notes.find((n) => n.id === t.id);
      select([t.id]);
      if (nt && nt.variant !== "list") setEditingNoteId(t.id);
      else set({ focusTick: getState().focusTick + 1 });
      return;
    }
    if (t?.id && t.role === "node" && getState().doc.nodes.find((n) => n.id === t.id)?.agent?.role === "skill") {
      select([t.id]);
      set({ modal: { type: "skill", id: t.id } });
      return;
    }
    if (t?.id && t.role === "node" && getState().doc.nodes.find((n) => n.id === t.id)?.agent?.role === "tool") {
      select([t.id]);
      set({ modal: { type: "tool", id: t.id, tab: "search" } });
      return;
    }
    if (t?.id && t.role !== "handle" && t.role !== "open-ref") {
      select([t.id]);
      set({ focusTick: getState().focusTick + 1 });
      if (t.role === "conn" && getState().doc.mode !== "agents") set({ modal: { type: "interface", id: t.id } }); // relações de agents não têm contrato de interface
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
    const skill = e.dataTransfer.getData("application/x-archflow-skill");
    const id = e.dataTransfer.getData("application/x-archflow-asset");
    const tpl = e.dataTransfer.getData("application/x-archflow-agent-template");
    if (tpl) return applyAgentTemplate(tpl, { x: snapV(p.x - 92, s.snap), y: snapV(p.y - 36, s.snap) });
    const mcp = e.dataTransfer.getData("application/x-archflow-mcp");
    if (mcp) {
      const entry = findMcpCatalogEntry(mcp);
      const under = targetOf(document.elementFromPoint(e.clientX, e.clientY));
      const agent = under?.role === "node" ? s.doc.nodes.find((n) => n.id === under.id && n.agent?.role === "agent") : undefined;
      if (entry) return plugTool({ entry, agentId: agent?.id, groupId: agent ? undefined : groupAt(p, s.doc, new Set())?.id, x: snapV(p.x - 92, s.snap), y: snapV(p.y - 36, s.snap) });
    }
    if (id === "agent-tool") {
      const under = targetOf(document.elementFromPoint(e.clientX, e.clientY));
      const agent = under?.role === "node" ? s.doc.nodes.find((n) => n.id === under.id && n.agent?.role === "agent") : undefined;
      return plugTool({ agentId: agent?.id, groupId: agent ? undefined : groupAt(p, s.doc, new Set())?.id, x: snapV(p.x - 92, s.snap), y: snapV(p.y - 36, s.snap) });
    }
    if (skill || id === "agent-skill") {
      const under = targetOf(document.elementFromPoint(e.clientX, e.clientY));
      const agent = under?.role === "node" ? s.doc.nodes.find((n) => n.id === under.id && n.agent?.role === "agent") : undefined;
      return plugSkill({ entry: skill ? findSkillCatalogEntry(skill, s.skillCatalog) : undefined, agentId: agent?.id, groupId: agent ? undefined : groupAt(p, s.doc, new Set())?.id, x: snapV(p.x - 92, s.snap), y: snapV(p.y - 36, s.snap) });
    }
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

  const focus = useStore((s) => s.focus);
  const flow = useMemo(() => (focus && doc.nodes.some((n) => n.id === focus.id) ? flowOf(doc, focus.id, focus.mode) : null), [doc, focus]);
  const edges = useMemo(() => computeEdges(vdoc).filter((e) => !flow || flow.conns.has(e.c.id)), [vdoc, flow]);
  const ownerLinks = useMemo(() => computeOwnerLinks(doc).filter((l) => !flow || (flow.nodes.has(l.id))), [doc.nodes, flow]);

  const bg = useStore((s) => s.bg);
  const bgStep = 24 * view.z;
  const bgPreset = presetById(bg.image);
  const groupsSorted = useMemo(() => sortedGroups(vdoc).filter((g) => !flow || flow.groups.has(g.id) || flow.nodes.has(g.id)), [vdoc, flow]);
  const names = useMemo(() => new Map<string, string>([...doc.groups, ...doc.nodes].map((e) => [e.id, e.label])), [doc.groups, doc.nodes]);
  const d = drag.current;
  const selSet = new Set(sel);
  const cursor = panning || tool === "hand" ? "grab" : tool === "text" ? "text" : tool === "eraser" ? ERASER_CURSOR : tool === "connect" || tool === "group" || tool === "note" || tool === "list" || tool === "pen" || tool === "highlight" ? "crosshair" : "default";

  const menuConn = menu ? doc.connections.find((c) => c.id === menu.conn) : undefined;

  return (
    <>
    <svg
      ref={svgRef}
      role="application"
      aria-label={`Quadro de ${docMode(doc) === "domain" ? "domínio" : docMode(doc) === "logic" ? "lógica de negócio" : docMode(doc) === "agents" ? "agentes de IA" : "arquitetura"}. Setas movem a seleção; ? mostra os atalhos.`}
      aria-roledescription="quadro branco"
      className={`canvas${dragOver ? " drag-over" : ""}`}
      style={{ cursor, ["--z" as string]: view.z }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={() => setHover(null)}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
      onDragOver={(e) => {
        if (["application/x-archflow-asset", "application/x-archflow-file", "application/x-archflow-skill"].some((t) => e.dataTransfer.types.includes(t))) {
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
        {docMode(doc) === "logic" && !flow && <SummaryCard doc={doc} />}
        {loops.map((f) => (
          <g key={f.id} transform={`translate(${f.x},${f.y})`} className="loop-frame" pointerEvents="none">
            <rect width={f.w} height={f.h} rx={22} />
            <text x={16} y={19}>
              ↻ {truncate(f.label, Math.floor((f.w - 40) / 6.6))}
            </text>
          </g>
        ))}
        {groupsSorted.map((g) => (
          <GroupShape key={g.id} g={g} selected={selSet.has(g.id)} hot={hotDrop === g.id} hovered={hover === g.id || (tool === "connect" && hover === g.id)} stage={g.stage ? { summary: stageViews.get(g.id)?.summary as StageSummary, viz: viz.stages.get(g.id) } : undefined} />
        ))}
        {ownerLinks.map((l) => (
          <path key={l.id} d={l.d} className="owner-link" />
        ))}
        {edges.map(({ c, g }) => (
          <Edge key={c.id} c={c} d={g.d} mid={g.label ?? g.mid} selected={selSet.has(c.id)} viz={viz.edges.get(c.id)} flow={docMode(doc) === "logic"} animate={animate} fromName={names.get(c.from)} toName={names.get(c.to)} withLabel={false} />
        ))}
        {sel.length === 1 &&
          edges
            .filter(({ c }) => c.id === sel[0])
            .map(({ c, g }) => <EdgeHandles key={c.id} c={c} g={g} z={view.z} />)}
        {vdoc.nodes.filter((n) => !flow || flow.nodes.has(n.id)).map((n) => (
          <NodeShape key={n.id} n={n} selected={selSet.has(n.id)} hot={hotDrop === n.id} hovered={hover === n.id} status={lstatus?.get(n.id)} gap={lgaps?.get(n.id)} names={lnames} viz={viz.nodes.get(n.id)} badge={viz.badges.get(n.id)} visits={viz.visits.get(n.id)} liveValue={viz.live.get(n.id)} row={viz.rows.get(n.id)} />
        ))}
        {flow &&
          doc.nodes
            .filter((n) => n.id === focus!.id)
            .map((n) => <rect key="flow-ring" x={n.x - 6} y={n.y - 6} width={n.w + 12} height={n.h + 12} rx={16} className="flow-ring" pointerEvents="none" />)}
        {(flow ? [] : doc.notes).map((n) => (
          <NoteShape
            key={n.id}
            n={n}
            selected={selSet.has(n.id)}
            editing={editingNoteId === n.id}
            onEditChange={
              editingNoteId === n.id
                ? (t) => {
                    const d = structuredClone(getState().doc);
                    const note = d.notes.find((x) => x.id === n.id);
                    if (!note) return;
                    note.text = t;
                    live(d);
                  }
                : undefined
            }
            onNoteCard={
              editingNoteId === n.id
                ? (patch) => {
                    const d = structuredClone(getState().doc);
                    const note = d.notes.find((x) => x.id === n.id);
                    if (!note) return;
                    for (const k of ["fontSize", "fill", "color", "font"] as const) {
                      if (!(k in patch)) continue;
                      if (patch[k] == null) delete note[k];
                      else Object.assign(note, { [k]: patch[k] });
                    }
                    live(d);
                  }
                : undefined
            }
            onEditClose={editingNoteId === n.id ? () => setEditingNoteId(null) : undefined}
          />
        ))}
        {edges.map(({ c, g }) => (
          <EdgeLabel key={c.id} c={c} mid={g.label ?? g.mid} selected={selSet.has(c.id)} viz={viz.edges.get(c.id)} flow={docMode(doc) === "logic"} cover={cover?.get(c.id)} />
        ))}
        {docMode(doc) === "logic" && <PlayCallout doc={doc} />}

        {(doc.ink ?? []).map((k) => (
          <path key={k.id} d={inkPath(k.pts)} fill="none" {...strokeAttrs(k)} pointerEvents="none" />
        ))}
        {(d?.kind === "marquee" || d?.kind === "create") &&
          (() => {
            const r = normRect(d.start, d.cur);
            const mode = d.kind === "marquee" ? (d.cur.x < d.start.x ? " crossing" : " window") : "";
            return <rect className={`marquee${mode}`} x={r.x} y={r.y} width={r.w} height={r.h} pointerEvents="none" />;
          })()}
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
    {nodeMenu && (() => {
      const n = doc.nodes.find((x) => x.id === nodeMenu.id);
      if (!n) return null;
      const pick = (mode: FlowMode) => (setNodeMenu(null), inspectFlow(n.id, mode));
      return (
        <div className="glass ctx-menu" style={{ left: nodeMenu.x, top: nodeMenu.y }} role="menu" onPointerDown={(e) => e.stopPropagation()} onContextMenu={(e) => e.preventDefault()}>
          <div className="ctx-title">{n.label}</div>
          <button role="menuitem" onClick={() => pick("both")}>
            Inspecionar fluxo
            <kbd>tudo ligado</kbd>
          </button>
          <button role="menuitem" onClick={() => pick("down")}>
            Só o que ele aciona
            <kbd>a jusante →</kbd>
          </button>
          <button role="menuitem" onClick={() => pick("up")}>
            Só quem depende dele
            <kbd>← a montante</kbd>
          </button>
          {n.kind !== "endpoint" && (
            <button role="menuitem" onClick={() => (setNodeMenu(null), select([n.id]), requestChangeType())}>
              Alterar tipo / tecnologia…
              <kbd>trocar ícone</kbd>
            </button>
          )}
          <hr />
          <button role="menuitem" onClick={() => (setNodeMenu(null), copySelection())}>
            Copiar
            <kbd>Ctrl+C</kbd>
          </button>
          <button role="menuitem" onClick={() => (setNodeMenu(null), duplicateSelection())}>
            Duplicar
            <kbd>Ctrl+D</kbd>
          </button>
          <button role="menuitem" onClick={() => (setNodeMenu(null), reorderSelection(true))}>
            Trazer para frente
          </button>
          <button role="menuitem" onClick={() => (setNodeMenu(null), reorderSelection(false))}>
            Enviar para trás
          </button>
          <button role="menuitem" className="danger" onClick={() => (setNodeMenu(null), deleteSelection())}>
            Excluir
            <kbd>Del</kbd>
          </button>
          {focus && (
            <>
              <hr />
              <button role="menuitem" onClick={() => (setNodeMenu(null), exitFlow())}>
                Sair da inspeção
                <kbd>Esc</kbd>
              </button>
            </>
          )}
        </div>
      );
    })()}
    {ringMenu && <RingAddMenu x={ringMenu.x} y={ringMenu.y} groupId={ringMenu.id} onClose={() => setRingMenu(null)} />}
    {paneMenu && (
      <div className="glass ctx-menu" style={{ left: paneMenu.x, top: paneMenu.y }} role="menu" onPointerDown={(e) => e.stopPropagation()} onContextMenu={(e) => e.preventDefault()}>
        <button role="menuitem" disabled={!hasClipboard()} onClick={() => (setPaneMenu(null), pasteClipboard(paneMenu.at))}>
          Colar aqui
          <kbd>Ctrl+V</kbd>
        </button>
        <button role="menuitem" onClick={() => (setPaneMenu(null), select([...doc.nodes, ...doc.groups, ...doc.notes].map((x) => x.id)))}>
          Selecionar tudo
          <kbd>Ctrl+A</kbd>
        </button>
        <button role="menuitem" onClick={() => (setPaneMenu(null), fitView())}>
          Ajustar à tela
          <kbd>F</kbd>
        </button>
      </div>
    )}
    {flow && focus && <FlowBar id={focus.id} mode={focus.mode} flow={flow} />}
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