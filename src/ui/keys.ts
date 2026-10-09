import { useEffect } from "react";
import { applyOps, fitGroup, uniqueId } from "../shared/ops";
import { enterPresent } from "./present";
import { commit, cycleTheme, getState, redo, run, select, set, setPrefs, toast, undo, type Tool } from "./store";

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

export function layout(direction: "LR" | "TB" = "LR") {
  run([{ op: "layout", direction }]);
  toast("Layout automático aplicado");
}

export function fitView(svg?: SVGSVGElement | null) {
  const el = svg ?? (document.querySelector("svg.canvas") as SVGSVGElement | null);
  const { doc } = getState();
  if (!el || !(doc.nodes.length + doc.groups.length + doc.notes.length)) return;
  const r = el.getBoundingClientRect();
  const all = [...doc.nodes, ...doc.groups, ...doc.notes];
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
      } else if (mod && e.key.toLowerCase() === "a") {
        e.preventDefault();
        select([...s.doc.nodes, ...s.doc.groups, ...s.doc.notes].map((x) => x.id));
      } else if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        deleteSelection();
      } else if (e.key === "Escape") {
        if (s.modal) set({ modal: null });
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
