import type { Doc } from "../shared/schema";
import { contentBounds } from "./geometry";
import { getState, replaceDoc, toast } from "./store";
import { normalizeDoc } from "../shared/ops";

function download(name: string, blob: Blob) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

const fileBase = (doc: Doc) => doc.title.replace(/[^\w\-]+/g, "_").slice(0, 40) || "diagrama";

export function exportJson() {
  const { doc } = getState();
  download(`${fileBase(doc)}.archflow.json`, new Blob([JSON.stringify(doc, null, 2)], { type: "application/json" }));
}

export function importJson(file: File) {
  file.text().then((t) => {
    try {
      const raw = JSON.parse(t);
      if (!raw || (!raw.nodes && !raw.elements)) throw new Error("Arquivo não parece um diagrama Archflow");
      replaceDoc(normalizeDoc(raw));
      toast("Diagrama importado");
    } catch (e) {
      toast("Falha ao importar: " + (e instanceof Error ? e.message : e));
    }
  });
}

/** CSS das classes do canvas, embutido no SVG exportado (fontes caem para fallback fora do app). */
function canvasCss(): string {
  const out: string[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      continue;
    }
    for (const r of Array.from(rules)) {
      if (r instanceof CSSStyleRule && /(^|[ ,])(\.node|\.group|\.edge|\.note|\.flow|:root)/.test(r.selectorText)) out.push(r.cssText);
      if (r instanceof CSSKeyframesRule) out.push(r.cssText);
    }
  }
  return out.join("\n");
}

export function buildSvg(): { svg: string; w: number; h: number } | null {
  const { doc } = getState();
  const b = contentBounds(doc);
  const src = document.querySelector("svg.canvas") as SVGSVGElement | null;
  if (!b || !src) return null;
  const pad = 48;
  const clone = src.cloneNode(true) as SVGSVGElement;
  clone.querySelectorAll(".handle,.grip,.marquee,[data-bg]").forEach((n) => n.remove());
  const g = clone.querySelector("g[transform]") as SVGGElement;
  g.setAttribute("transform", "");
  const w = Math.ceil(b.w + pad * 2);
  const h = Math.ceil(b.h + pad * 2);
  clone.removeAttribute("style");
  clone.removeAttribute("class");
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("viewBox", `${b.x - pad} ${b.y - pad} ${w} ${h}`);
  clone.setAttribute("width", String(w));
  clone.setAttribute("height", String(h));
  const style = document.createElementNS("http://www.w3.org/2000/svg", "style");
  style.textContent = canvasCss();
  const bg = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  for (const [k, v] of Object.entries({ x: b.x - pad, y: b.y - pad, width: w, height: h, fill: "#f7f1e3" })) bg.setAttribute(k, String(v));
  clone.insertBefore(bg, clone.firstChild);
  clone.insertBefore(style, clone.firstChild);
  return { svg: new XMLSerializer().serializeToString(clone), w, h };
}

export function exportSvg() {
  const r = buildSvg();
  if (!r) return toast("Nada para exportar");
  download(`${fileBase(getState().doc)}.svg`, new Blob([r.svg], { type: "image/svg+xml" }));
}

export function exportPng() {
  const r = buildSvg();
  if (!r) return toast("Nada para exportar");
  const img = new Image();
  const scale = 2;
  img.onload = () => {
    const c = document.createElement("canvas");
    c.width = r.w * scale;
    c.height = r.h * scale;
    const ctx = c.getContext("2d")!;
    ctx.scale(scale, scale);
    ctx.drawImage(img, 0, 0, r.w, r.h);
    c.toBlob((b) => b && download(`${fileBase(getState().doc)}.png`, b), "image/png");
  };
  img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(r.svg);
}
