import type { Doc } from "../shared/schema";
import { contentBounds } from "./geometry";
import { presetById } from "./bgpresets";
import { getState, replaceDoc, resolvedTheme, toast, toastError } from "./store";
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
      toastError("Falha ao importar: " + (e instanceof Error ? e.message : e));
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

/** `interactive`: mantém a classe `.canvas` (para os seletores `.canvas …` valerem), tira a seleção e deixa o fundo para o HTML. */
export function buildSvg(interactive = false): { svg: string; w: number; h: number; x: number; y: number } | null {
  const { doc, bg: board } = getState();
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
  if (interactive) {
    clone.setAttribute("class", "canvas");
    clone.setAttribute("style", "--z:1;position:absolute;inset:0;width:100%;height:100%");
    clone.querySelectorAll(".sel").forEach((n) => n.classList.remove("sel"));
  } else clone.removeAttribute("class");
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("viewBox", `${b.x - pad} ${b.y - pad} ${w} ${h}`);
  clone.setAttribute("width", interactive ? "100%" : String(w));
  clone.setAttribute("height", interactive ? "100%" : String(h));
  const style = document.createElementNS("http://www.w3.org/2000/svg", "style");
  style.textContent = canvasCss();
  if (!interactive) {
    const bg = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    for (const [k, v] of Object.entries({ x: b.x - pad, y: b.y - pad, width: w, height: h, fill: board.color ?? "#f7f1e3" })) bg.setAttribute(k, String(v));
    clone.insertBefore(bg, clone.firstChild);
  }
  clone.insertBefore(style, clone.firstChild);
  return { svg: new XMLSerializer().serializeToString(clone), w, h, x: b.x - pad, y: b.y - pad };
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

/* ───────── HTML autônomo ───────── */

const toDataUrl = (blob: Blob) =>
  new Promise<string>((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result));
    r.onerror = () => rej(r.error);
    r.readAsDataURL(blob);
  });

/** @font-face do app (só o subconjunto latino, woff2) com o arquivo embutido em base64. */
async function embeddedFonts(): Promise<string> {
  const out: string[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      continue;
    }
    for (const r of Array.from(rules)) {
      if (!(r instanceof CSSFontFaceRule)) continue;
      const range = r.style.getPropertyValue("unicode-range");
      if (range && !/U\+0(000)?-(00)?FF\b/i.test(range)) continue;
      const m = r.style.getPropertyValue("src").match(/url\(["']?([^"')]+\.woff2)["']?\)/);
      if (!m) continue;
      try {
        const data = await toDataUrl(await (await fetch(new URL(m[1], sheet.href ?? location.href))).blob());
        out.push(r.cssText.replace(/src:[^;]+;/, `src: url(${data}) format("woff2");`));
      } catch {
        /* sem a fonte, cai no fallback */
      }
    }
  }
  return out.join("\n");
}

/** Textura de fundo (modelo pronto ou imagem enviada) como camada sobreposta, igual ao canvas. */
async function textureLayer(): Promise<string> {
  const { bg } = getState();
  const preset = presetById(bg.image);
  if (!bg.image) return "";
  try {
    const url = preset ? await toDataUrl(await (await fetch(`/bg/${preset.file}`)).blob()) : bg.image;
    const fill = preset ? `repeat;background-size:${preset.tile[0]}px ${preset.tile[1]}px` : "center/cover no-repeat";
    return `<div id="tex" style="background:url(${url}) ${fill};opacity:${bg.imageOpacity ?? 1}"></div>`;
  } catch {
    return "";
  }
}

/**
 * Exporta o diagrama como um único .html (SVG + CSS + fontes embutidos), com o mesmo tema e fundo
 * do app e zoom/arrastar para navegar. Não depende do Archflow nem de rede para abrir.
 */
export async function exportHtml() {
  const r = buildSvg(true);
  if (!r) return toast("Nada para exportar");
  const { doc, bg } = getState();
  const [fonts, texture] = await Promise.all([embeddedFonts(), textureLayer()]);
  const title = doc.title.replace(/[<>&"]/g, "") || "Diagrama";
  const ink = "rgba(112,111,211,";
  const layers =
    bg.pattern === "dots"
      ? [`radial-gradient(circle at 1px 1px, ${ink}0.22) var(--dot), transparent calc(var(--dot) + 0.5px))`]
      : bg.pattern === "grid"
        ? [`linear-gradient(to right, ${ink}0.16) 1px, transparent 1px)`, `linear-gradient(to bottom, ${ink}0.16) 1px, transparent 1px)`]
        : bg.pattern === "lines"
          ? [`linear-gradient(to bottom, ${ink}0.16) 1px, transparent 1px)`]
          : [];
  const html = `<!doctype html>
<html lang="pt-BR" data-theme="${resolvedTheme()}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<style>
${fonts}
html,body{height:100%;margin:0;overflow:hidden}
body{font-family:var(--sans);color:var(--ink);background:${bg.color ?? "var(--secondary)"};-webkit-font-smoothing:antialiased}
#stage{position:fixed;inset:0;cursor:grab;touch-action:none;user-select:none;overflow:hidden}
#stage.drag{cursor:grabbing}
#tex{position:absolute;inset:0;mix-blend-mode:overlay;pointer-events:none}
#bar{position:fixed;left:16px;top:16px;z-index:5;display:flex;gap:8px;align-items:center;padding:8px 8px 8px 18px;border-radius:999px;background:var(--glass-strong);border:1px solid var(--glass-border);box-shadow:var(--shadow);backdrop-filter:blur(16px)}
#bar h1{margin:0 6px 0 0;font:400 20px var(--serif);color:var(--ink)}
#bar button{border:1px solid var(--hairline);background:var(--s-strong);color:var(--ink);border-radius:999px;padding:6px 12px;font:500 13px var(--sans);cursor:pointer}
#bar button:hover{background:var(--primary-100)}
#pct{font-size:12px;color:var(--ink-3);min-width:40px;text-align:right}
@media(max-width:560px){#bar h1{display:none}}
${canvasCss()}
</style>
</head>
<body>
<div id="stage">${texture}${r.svg}</div>
<div id="bar"><h1>${title}</h1><button id="fit" title="Ajustar à tela (F)">Ajustar</button><button id="in" aria-label="Aproximar">+</button><button id="out" aria-label="Afastar">−</button><span id="pct"></span></div>
<script>
(function () {
  var W = ${r.w}, H = ${r.h}, X0 = ${r.x}, Y0 = ${r.y};
  var pattern = ${JSON.stringify(bg.pattern)}, layers = ${JSON.stringify(layers)};
  var stage = document.getElementById("stage"), svg = stage.querySelector("svg"), pct = document.getElementById("pct");
  var world = svg.querySelector("g[transform]");
  var v = { x: 0, y: 0, z: 1 };
  function paint() {
    world.setAttribute("transform", "translate(" + v.x + "," + v.y + ") scale(" + v.z + ")");
    svg.style.setProperty("--z", v.z);
    pct.textContent = Math.round(v.z * 100) + "%";
    if (pattern !== "none") {
      var s = 24 * v.z + "px";
      stage.style.setProperty("--dot", Math.max(0.9, 1.1 * v.z) + "px");
      stage.style.backgroundImage = layers.join(",");
      stage.style.backgroundSize = s + " " + s;
      stage.style.backgroundPosition = v.x + "px " + v.y + "px";
    }
  }
  function fit() {
    var r = stage.getBoundingClientRect(), z = Math.min((r.width - 96) / W, (r.height - 96) / H, 1.5);
    v.z = z; v.x = (r.width - W * z) / 2 - X0 * z; v.y = (r.height - H * z) / 2 - Y0 * z; paint();
  }
  function zoomAt(f, cx, cy) {
    var r = stage.getBoundingClientRect(), nz = Math.min(4, Math.max(0.1, v.z * f)), mx = cx - r.left, my = cy - r.top;
    v.x = mx - (mx - v.x) / v.z * nz; v.y = my - (my - v.y) / v.z * nz; v.z = nz; paint();
  }
  function center(f) { var r = stage.getBoundingClientRect(); zoomAt(f, r.left + r.width / 2, r.top + r.height / 2); }
  stage.addEventListener("wheel", function (e) { e.preventDefault(); zoomAt(Math.exp(-e.deltaY * 0.0016), e.clientX, e.clientY); }, { passive: false });
  var d = null;
  stage.addEventListener("pointerdown", function (e) { d = { x: e.clientX, y: e.clientY, vx: v.x, vy: v.y }; stage.setPointerCapture(e.pointerId); stage.classList.add("drag"); });
  stage.addEventListener("pointermove", function (e) { if (d) { v.x = d.vx + e.clientX - d.x; v.y = d.vy + e.clientY - d.y; paint(); } });
  function up() { d = null; stage.classList.remove("drag"); }
  stage.addEventListener("pointerup", up);
  stage.addEventListener("pointercancel", up);
  document.getElementById("fit").onclick = fit;
  document.getElementById("in").onclick = function () { center(1.25); };
  document.getElementById("out").onclick = function () { center(0.8); };
  addEventListener("keydown", function (e) {
    if (e.key === "f" || e.key === "F") fit();
    if (e.key === "+" || e.key === "=") center(1.25);
    if (e.key === "-") center(0.8);
  });
  addEventListener("resize", fit);
  fit();
})();
</script>
</body>
</html>`;
  download(`${fileBase(doc)}.html`, new Blob([html], { type: "text/html" }));
  toast("HTML exportado");
}
