import { useEffect } from "react";
import { applyOps, fitGroup, uniqueId } from "../shared/ops";
import type { Doc } from "../shared/schema";
import { flowBoxes, flowOf, type FlowMode } from "./flow";
import { enterPresent } from "./present";
import { commit, cycleTheme, getState, live, redo, run, select, set, setPrefs, toast, undo, type Tool } from "./store";

let space = false;
export const spaceHeld = () => space;

const isTyping = (t: EventTarget | null) => {
  const el = t as HTMLElement | null;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
};

export function deleteSelection() {
  const { sel } = getState();
  if (!sel.length) return;
  run(sel.map((id) => ({ op: "remove" as const, id })));
  select([]);
}

export function duplicateSelection() {
  const s = getState();
  const doc = structuredClone(s.doc);
  const map = new Map<string, string>();
  const created: string[] = [];
  for (const id of s.sel) {
    const n = doc.nodes.find((x) => x.id === id);
    if (n) {
      const nid = uniqueId(doc, n.id);
      map.set(id, nid);
      doc.nodes.push({ ...structuredClone(n), id: nid, x: n.x + 32, y: n.y + 32 });
      created.push(nid);
      continue;
    }
    const nt = doc.notes.find((x) => x.id === id);
    if (nt) {
      const nid = uniqueId(doc, nt.id);
      doc.notes.push({ ...nt, id: nid, x: nt.x + 32, y: nt.y + 32 });
      created.push(nid);
    }
  }
  // conexões internas à seleção também são duplicadas
  for (const c of s.doc.connections) {
    if (map.has(c.from) && map.has(c.to)) {
      const nid = uniqueId(doc, c.id);
      doc.connections.push({ ...structuredClone(c), id: nid, from: map.get(c.from)!, to: map.get(c.to)! });
    }
  }
  doc.nodes.forEach((n) => n.parent && fitGroup(doc, n.parent));
  commit(doc);
  select(created);
}


type Clip = { nodes: Doc["nodes"]; notes: Doc["notes"]; connections: Doc["connections"]; pastes: number };
let clip: Clip | null = null;

/** Copia nós e notas selecionados (e as conexões internas à seleção) para a área de transferência do quadro. */
export function copySelection(): boolean {
  const { doc, sel } = getState();
  const nodes = doc.nodes.filter((n) => sel.includes(n.id));
  const notes = doc.notes.filter((n) => sel.includes(n.id));
  if (!nodes.length && !notes.length) return false;
  const ids = new Set(nodes.map((n) => n.id));
  clip = { nodes: structuredClone(nodes), notes: structuredClone(notes), connections: structuredClone(doc.connections.filter((c) => ids.has(c.from) && ids.has(c.to))), pastes: 0 };
  const n = nodes.length + notes.length;
  toast(n === 1 ? "1 item copiado" : `${n} itens copiados`);
  return true;
}

export function pasteClipboard() {
  if (!clip) return;
  const s = getState();
  const doc = structuredClone(s.doc);
  const off = 32 * ++clip.pastes;
  const map = new Map<string, string>();
  const created: string[] = [];
  for (const n of clip.nodes) {
    const nid = uniqueId(doc, n.id);
    map.set(n.id, nid);
    doc.nodes.push({ ...structuredClone(n), id: nid, x: n.x + off, y: n.y + off, parent: doc.groups.some((g) => g.id === n.parent) ? n.parent : undefined });
    created.push(nid);
  }
  for (const nt of clip.notes) {
    const nid = uniqueId(doc, nt.id);
    doc.notes.push({ ...structuredClone(nt), id: nid, x: nt.x + off, y: nt.y + off });
    created.push(nid);
  }
  for (const c of clip.connections) {
    doc.connections.push({ ...structuredClone(c), id: uniqueId(doc, c.id), from: map.get(c.from)!, to: map.get(c.to)! });
  }
  doc.nodes.forEach((n) => n.parent && fitGroup(doc, n.parent));
  commit(doc);
  select(created);
}

let lastNudge = 0;
/** Move a seleção com as setas (Shift = 10×). Toques seguidos viram um único passo de desfazer. */
export function nudgeSelection(dx: number, dy: number) {
  const s = getState();
  if (!s.sel.length) return false;
  const doc = structuredClone(s.doc);
  const moved = new Set(s.sel);
  doc.groups.filter((g) => moved.has(g.id)).forEach((g) => doc.nodes.forEach((n) => n.parent === g.id && moved.add(n.id)));
  let any = false;
  for (const b of [...doc.nodes, ...doc.groups, ...doc.notes]) {
    if (moved.has(b.id)) (b.x += dx), (b.y += dy), (any = true);
  }
  if (!any) return false;
  doc.nodes.forEach((n) => n.parent && !s.sel.includes(n.parent) && fitGroup(doc, n.parent));
  const now = Date.now();
  now - lastNudge < 600 ? live(doc) : commit(doc);
  lastNudge = now;
  return true;
}

export function zoomTo(factor: number | "reset") {
  const v = getState().view;
  const nz = factor === "reset" ? 1 : Math.min(3, Math.max(0.15, v.z * factor));
  const cx = window.innerWidth / 2;
  const cy = window.innerHeight / 2;
  set({ view: { z: nz, x: cx - ((cx - v.x) / v.z) * nz, y: cy - ((cy - v.y) / v.z) * nz } });
}

/** Abre a janela de configuração do auto-layout (direção, espaçamento e traçado dos conectores). */
export function layout(direction: "LR" | "TB" = "LR") {
  set({ modal: { type: "layout", direction } });
}

export function fitView(svg?: SVGSVGElement | null, only?: { x: number; y: number; w: number; h: number }[]) {
  const el = svg ?? (document.querySelector("svg.canvas") as SVGSVGElement | null);
  const { doc } = getState();
  if (!el || !(doc.nodes.length + doc.groups.length + doc.notes.length)) return;
  const r = el.getBoundingClientRect();
  const all = only?.length ? only : [...doc.nodes, ...doc.groups, ...doc.notes];
  const x1 = Math.min(...all.map((b) => b.x));
  const y1 = Math.min(...all.map((b) => b.y));
  const x2 = Math.max(...all.map((b) => b.x + b.w));
  const y2 = Math.max(...all.map((b) => b.y + b.h));
  const w = x2 - x1;
  const h = y2 - y1;
  const st = getState();
  const left = 100 + (st.panel === "assets" || st.panel === "files" ? 340 : 0);
  const right = st.sel.length ? 360 : 32;
  const top = 90;
  const bottom = 100;
  const aw = Math.max(200, r.width - left - right);
  const ah = Math.max(150, r.height - top - bottom);
  const z = Math.min(1.1, Math.max(0.15, Math.min(aw / w, ah / h)));
  set({ view: { z, x: left + (aw - w * z) / 2 - x1 * z, y: top + (ah - h * z) / 2 - y1 * z } });
}

/** Mostra só o fluxo ligado ao componente (a jusante, a montante ou ambos) e enquadra a tela nele. */
export function inspectFlow(id: string, mode: FlowMode = "both") {
  const { doc } = getState();
  set({ focus: { id, mode }, sel: [], tool: "select" });
  requestAnimationFrame(() => fitView(undefined, flowBoxes(doc, flowOf(doc, id, mode))));
}

export function exitFlow() {
  set({ focus: null });
}

export function useHotkeys() {
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (isTyping(e.target)) {
        if (e.key === "Escape") (e.target as HTMLElement).blur();
        return;
      }
      if (getState().present) return; // o modo apresentação trata as próprias teclas
      const mod = e.ctrlKey || e.metaKey;
      const s = getState();
      if (e.code === "Space") {
        space = true;
        e.preventDefault();
        return;
      }
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        e.shiftKey ? redo() : undo();
      } else if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        redo();
      } else if (mod && e.key.toLowerCase() === "o") {
        e.preventDefault();
        set({ modal: { type: "quick" } });
      } else if (mod && e.key.toLowerCase() === "d") {
        e.preventDefault();
        duplicateSelection();
      } else if (mod && e.key.toLowerCase() === "c") {
        if (copySelection()) e.preventDefault();
      } else if (mod && e.key.toLowerCase() === "x") {
        if (copySelection()) (e.preventDefault(), deleteSelection());
      } else if (mod && e.key.toLowerCase() === "v") {
        if (clip) (e.preventDefault(), pasteClipboard());
      } else if (!mod && e.key.startsWith("Arrow") && s.sel.length) {
        const st = e.shiftKey ? 10 : 1;
        const d: Record<string, [number, number]> = { ArrowLeft: [-st, 0], ArrowRight: [st, 0], ArrowUp: [0, -st], ArrowDown: [0, st] };
        e.preventDefault();
        nudgeSelection(...d[e.key]);
      } else if (mod && e.key === "0") {
        e.preventDefault();
        zoomTo("reset");
      } else if (mod && (e.key === "=" || e.key === "+")) {
        e.preventDefault();
        zoomTo(1.2);
      } else if (mod && e.key === "-") {
        e.preventDefault();
        zoomTo(1 / 1.2);
      } else if (mod && e.key.toLowerCase() === "a") {
        e.preventDefault();
        select([...s.doc.nodes, ...s.doc.groups, ...s.doc.notes].map((x) => x.id));
      } else if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        deleteSelection();
      } else if (e.key === "Escape") {
        if (s.modal) set({ modal: null });
        else if (s.focus) exitFlow();
        else if (s.tool !== "select") set({ tool: "select" });
        else select([]);
      } else if (!mod) {
        const map: Record<string, Tool> = { v: "select", h: "hand", g: "group", n: "note", c: "connect", d: "pen", m: "highlight", x: "eraser", w: "text", i: "list" };
        const k = e.key.toLowerCase();
        if (map[k]) set({ tool: map[k] });
        else if (k === "l") layout(e.shiftKey ? "TB" : "LR");
        else if (k === "f") fitView();
        else if (k === "b") set({ panel: s.panel === "assets" ? null : "assets" });
        else if (k === "e") set({ panel: s.panel === "files" ? null : "files" });
        else if (k === "p") enterPresent();
        else if (k === "t") cycleTheme();
        else if (k === "a") setPrefs({ animate: !s.animate });
        else if (e.key === "?") set({ modal: { type: "help" } });
        else if (e.key === "/") {
          e.preventDefault();
          set({ panel: "assets" });
          requestAnimationFrame(() => (document.getElementById("asset-search") as HTMLInputElement | null)?.focus());
        }
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === "Space") space = false;
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);
}

export { applyOps };
