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

export async function exportSvg() {
  try {
    const r = await renderSvg();
    if (!r) return toast("Nada para exportar");
    download(`${fileBase(getState().doc)}.svg`, new Blob([r.svg], { type: "image/svg+xml" }));
  } catch (e) {
    toastError("Falha ao exportar SVG: " + (e instanceof Error ? e.message : e));
  }
}

export async function exportPng() {
  try {
    const r = await renderPng();
    if (!r) return toast("Nada para exportar");
    download(`${fileBase(getState().doc)}.png`, r.blob);
  } catch (e) {
    toastError("Falha ao exportar PNG: " + (e instanceof Error ? e.message : e));
  }
}

const toDataUrl = (blob: Blob) =>
  new Promise<string>((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result));
    r.onerror = () => rej(r.error);
    r.readAsDataURL(blob);
  });

/* ───────── SVG/PNG fiéis à tela ─────────
 * Um SVG solto não tem o CSS do app, o tema nem as fontes. O canvas é clonado fora da tela (no mesmo lugar do DOM,
 * para o tema valer), cada elemento recebe o estilo computado e as fontes, imagens e animações usadas vão embutidas. */

export type ExportBackground = "board" | "solid" | "transparent";
export interface ImageExportOptions {
  /** board: cor + trama do quadro · solid: só a cor · transparent: sem fundo */
  background?: ExportBackground;
  /** PNG: pixels por unidade do diagrama */
  scale?: number;
  padding?: number;
}

const SVG_NS = "http://www.w3.org/2000/svg";
const HTML_NS = "http://www.w3.org/1999/xhtml";

/** Propriedades herdadas: só vão inline quando diferem do pai. */
const INHERITED = new Set([
  "border-collapse", "border-spacing", "caption-side", "clip-rule", "color", "color-interpolation", "color-interpolation-filters", "color-rendering",
  "color-scheme", "direction", "dominant-baseline", "empty-cells", "fill", "fill-opacity", "fill-rule", "font-family", "font-feature-settings",
  "font-kerning", "font-optical-sizing", "font-palette", "font-size", "font-size-adjust", "font-stretch", "font-style", "font-synthesis",
  "font-synthesis-small-caps", "font-synthesis-style", "font-synthesis-weight", "font-variant", "font-variant-alternates", "font-variant-caps",
  "font-variant-east-asian", "font-variant-emoji", "font-variant-ligatures", "font-variant-numeric", "font-variant-position",
  "font-variation-settings", "font-weight", "hyphens", "image-rendering", "letter-spacing", "line-break", "line-height", "list-style-image",
  "list-style-position", "list-style-type", "marker-end", "marker-mid", "marker-start", "orphans", "overflow-wrap", "paint-order", "quotes",
  "ruby-position", "shape-rendering", "stroke", "stroke-dasharray", "stroke-dashoffset", "stroke-linecap", "stroke-linejoin", "stroke-miterlimit",
  "stroke-opacity", "stroke-width", "tab-size", "text-align", "text-align-last", "text-anchor", "text-decoration-skip-ink", "text-emphasis-color",
  "text-emphasis-position", "text-emphasis-style", "text-indent", "text-rendering", "text-shadow", "text-size-adjust", "text-transform",
  "text-underline-position", "text-wrap", "text-wrap-mode", "text-wrap-style", "visibility", "white-space", "white-space-collapse", "widows",
  "word-break", "word-spacing", "writing-mode", "-webkit-font-smoothing", "-webkit-text-fill-color", "-webkit-text-stroke-color",
  "-webkit-text-stroke-width", "-webkit-hyphenate-character", "-webkit-line-break", "-webkit-locale",
]);

/** Estado de interação, layout lógico duplicado e comportamento: nada disso muda a imagem. */
const SKIP_PROP =
  /^(transition|cursor|pointer-events|user-select|-webkit-user-|touch-action|will-change|caret-color|-webkit-tap-highlight|outline|content-visibility|contain-intrinsic|view-transition|interactivity|interpolate-size|anchor-|position-anchor|position-try|position-visibility|scroll-|overscroll-|overflow-anchor|-webkit-app-region|app-region|field-sizing|reading-)|(^|-)(block|inline)(-|$)/;
/** Em elementos SVG a geometria já está nos atributos. */
const SVG_GEOMETRY = new Set(["d", "x", "y", "cx", "cy", "r", "rx", "ry", "width", "height", "transform", "transform-origin", "perspective-origin"]);
/** Itens só de edição: alças, seleção em andamento, barra de formatação da nota. */
const EDITOR_ONLY = ".handle,.grip,.marquee,.flow-preview,.note-rich-bar-fo,[data-bg],[data-role='wp'],[data-role='wp-add']";

type Sandbox = { host: HTMLElement; svg: SVGSVGElement; html: HTMLElement; defaults: Map<string, CSSStyleDeclaration> };

/** Elementos “virgens” num contêiner `all: initial`: o estilo-base de cada tag, sem herança do app. */
function makeSandbox(): Sandbox {
  const host = document.createElement("div");
  host.setAttribute("aria-hidden", "true");
  host.style.cssText = "all:initial;position:fixed;left:-100000px;top:0;width:10px;height:10px;overflow:hidden;pointer-events:none";
  const svg = document.createElementNS(SVG_NS, "svg");
  const fo = document.createElementNS(SVG_NS, "foreignObject");
  const html = document.createElementNS(HTML_NS, "div") as HTMLElement;
  fo.appendChild(html);
  svg.appendChild(fo);
  host.appendChild(svg);
  document.body.appendChild(host);
  return { host, svg, html, defaults: new Map() };
}

function defaultStyle(sb: Sandbox, el: Element): CSSStyleDeclaration {
  const key = `${el.namespaceURI}|${el.localName}`;
  let cs = sb.defaults.get(key);
  if (!cs) {
    const isSvg = el.namespaceURI === SVG_NS;
    const probe = document.createElementNS(el.namespaceURI ?? HTML_NS, el.localName);
    (isSvg ? sb.svg : sb.html).appendChild(probe);
    cs = getComputedStyle(probe);
    sb.defaults.set(key, cs);
  }
  return cs;
}

function styleDiff(el: Element, cs: CSSStyleDeclaration, parent: CSSStyleDeclaration, base: CSSStyleDeclaration, names: string[], isRoot: boolean): string {
  const isSvg = el.namespaceURI === SVG_NS;
  const transformed = cs.getPropertyValue("transform") !== "none";
  let out = "";
  for (const p of names) {
    if (p.startsWith("--") || SKIP_PROP.test(p)) continue;
    if (isSvg && SVG_GEOMETRY.has(p)) continue;
    if (!isSvg && !transformed && (p === "transform-origin" || p === "perspective-origin")) continue;
    const inherited = INHERITED.has(p);
    if (isRoot && !inherited) continue;
    const v = cs.getPropertyValue(p);
    if (!v || v === (inherited ? parent : base).getPropertyValue(p)) continue;
    out += `${p}:${v};`;
  }
  return out;
}

function parseRanges(range: string): [number, number][] {
  return range.split(",").flatMap((part) => {
    const m = /U\+([0-9a-f?]+)(?:-([0-9a-f]+))?/i.exec(part.trim());
    if (!m) return [];
    if (m[1].includes("?")) return [[parseInt(m[1].replace(/\?/g, "0"), 16), parseInt(m[1].replace(/\?/g, "f"), 16)] as [number, number]];
    const a = parseInt(m[1], 16);
    return [[a, m[2] ? parseInt(m[2], 16) : a] as [number, number]];
  });
}

const familyNames = (v: string) => v.split(",").map((f) => f.trim().replace(/^["']|["']$/g, "").toLowerCase()).filter(Boolean);

/** @font-face das famílias usadas, só dos subconjuntos que cobrem o texto exportado, com o arquivo em base64. */
async function fontFaces(families: Set<string>, text: string): Promise<string> {
  const chars = new Set<number>();
  for (const ch of text) chars.add(ch.codePointAt(0)!);
  if (!chars.size) return "";
  const covers = (range: string) => !range || parseRanges(range).some(([a, b]) => [...chars].some((c) => c >= a && c <= b));
  const jobs: Promise<string>[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      continue;
    }
    for (const r of Array.from(rules)) {
      if (!(r instanceof CSSFontFaceRule)) continue;
      const fam = familyNames(r.style.getPropertyValue("font-family"))[0];
      if (!fam || !families.has(fam) || !covers(r.style.getPropertyValue("unicode-range"))) continue;
      const src = r.style.getPropertyValue("src");
      const m = src.match(/url\(["']?([^"')]+\.woff2)["']?\)/) ?? src.match(/url\(["']?([^"')]+\.woff)["']?\)/);
      if (!m) continue;
      const format = m[1].endsWith(".woff2") ? "woff2" : "woff";
      jobs.push(
        fetch(new URL(m[1], sheet.href ?? location.href))
          .then((res) => res.blob())
          .then(toDataUrl)
          .then((data) => r.cssText.replace(/src:[^;]+;/, `src: url(${data}) format("${format}");`))
          .catch(() => ""),
      );
    }
  }
  return (await Promise.all(jobs)).filter(Boolean).join("\n");
}

function keyframes(names: Set<string>): string {
  if (!names.size) return "";
  const out: string[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      for (const r of Array.from(sheet.cssRules)) if (r instanceof CSSKeyframesRule && names.has(r.name)) out.push(r.cssText);
    } catch {
      /* folha de outra origem */
    }
  }
  return out.join("\n");
}

const URL_IN_STYLE = /url\((["']?)([^"')]+)\1\)/g;

/** Imagens externas viram data: e `url(<página>#id)` volta a `url(#id)`. */
async function inlineResources(root: SVGSVGElement): Promise<void> {
  const page = location.href.split("#")[0];
  const cache = new Map<string, Promise<string | null>>();
  const load = (u: string) => {
    let p = cache.get(u);
    if (!p) {
      p = fetch(new URL(u, location.href))
        .then((r) => (r.ok ? r.blob() : null))
        .then((b) => (b ? toDataUrl(b) : null))
        .catch(() => null);
      cache.set(u, p);
    }
    return p;
  };
  const jobs: Promise<void>[] = [];
  for (const img of Array.from(root.querySelectorAll("image"))) {
    for (const attr of ["href", "xlink:href"]) {
      const u = img.getAttribute(attr);
      if (!u || u.startsWith("data:") || u.startsWith("#")) continue;
      jobs.push(load(u).then((data) => void (data && img.setAttribute(attr, data))));
    }
  }
  for (const el of Array.from(root.querySelectorAll("[style]"))) {
    const style = el.getAttribute("style")!;
    if (!style.includes("url(")) continue;
    const found = new Set<string>();
    for (const m of style.matchAll(URL_IN_STYLE)) {
      const u = m[2];
      if (!u.startsWith("data:") && !u.startsWith("#") && !u.startsWith(page + "#")) found.add(u);
    }
    jobs.push(
      Promise.all([...found].map(async (u) => [u, await load(u)] as const)).then((pairs) => {
        const map = new Map(pairs);
        el.setAttribute(
          "style",
          style.replace(URL_IN_STYLE, (all, q: string, u: string) => {
            if (u.startsWith(page + "#")) return `url(${q}${u.slice(page.length)}${q})`;
            const data = map.get(u);
            return data ? `url(${q}${data}${q})` : all;
          }),
        );
      }),
    );
  }
  await Promise.all(jobs);
}

function boardBackground(x: number, y: number, w: number, h: number, mode: ExportBackground): SVGElement | null {
  if (mode === "transparent") return null;
  const { bg } = getState();
  const g = document.createElementNS(SVG_NS, "g");
  const color = bg.color || getComputedStyle(document.documentElement).getPropertyValue("--secondary").trim() || "#f7f1e3";
  const rect = (fill: string) => {
    const r = document.createElementNS(SVG_NS, "rect");
    for (const [k, v] of Object.entries({ x, y, width: w, height: h, fill })) r.setAttribute(k, String(v));
    return r;
  };
  g.appendChild(rect(color));
  if (mode === "board" && bg.pattern !== "none") {
    const step = 24;
    const pat = document.createElementNS(SVG_NS, "pattern");
    for (const [k, v] of Object.entries({ id: "archflow-export-bg", width: step, height: step, patternUnits: "userSpaceOnUse" })) pat.setAttribute(k, String(v));
    pat.innerHTML =
      bg.pattern === "dots"
        ? `<circle cx="1" cy="1" r="1.1" fill="#706fd3" fill-opacity="0.22"/>`
        : bg.pattern === "grid"
          ? `<path d="M${step} 0H0V${step}" fill="none" stroke="#706fd3" stroke-opacity="0.16" stroke-width="1"/>`
          : `<path d="M0 ${step}H${step}" fill="none" stroke="#706fd3" stroke-opacity="0.16" stroke-width="1"/>`;
    g.appendChild(pat);
    g.appendChild(rect("url(#archflow-export-bg)"));
  }
  return g;
}

/** SVG autônomo, igual ao que o canvas mostra (sem seleção, alças nem zoom). */
export async function renderSvg(opts: ImageExportOptions = {}): Promise<{ svg: string; w: number; h: number } | null> {
  const { doc } = getState();
  const src = document.querySelector("svg.canvas") as SVGSVGElement | null;
  const content = contentBounds(doc);
  if (!src || (!content && !(doc.ink ?? []).length && !doc.connections.length)) return null;
  await document.fonts.ready;

  const clone = src.cloneNode(true) as SVGSVGElement;
  clone.querySelectorAll(EDITOR_ONLY).forEach((n) => n.remove());
  clone.querySelectorAll(".sel,.drop-target").forEach((n) => n.classList.remove("sel", "drop-target"));
  const world = clone.querySelector(":scope > g[transform]") as SVGGElement | null;
  if (!world) return null;
  world.removeAttribute("transform");
  clone.style.setProperty("--z", "1");
  clone.style.setProperty("position", "fixed");
  clone.style.setProperty("left", "-100000px");
  clone.style.setProperty("top", "0");
  clone.style.setProperty("pointer-events", "none");
  clone.setAttribute("aria-hidden", "true");

  const sb = makeSandbox();
  (src.parentNode ?? document.body).insertBefore(clone, src.nextSibling);
  try {
    let box = world.getBBox();
    if (content) {
      const x1 = Math.min(box.width ? box.x : content.x, content.x);
      const y1 = Math.min(box.height ? box.y : content.y, content.y);
      const x2 = Math.max(box.width ? box.x + box.width : content.x + content.w, content.x + content.w);
      const y2 = Math.max(box.height ? box.y + box.height : content.y + content.h, content.y + content.h);
      box = new DOMRect(x1, y1, x2 - x1, y2 - y1);
    }
    if (!box.width || !box.height) return null;
    const pad = opts.padding ?? 48;
    const x = Math.floor(box.x - pad);
    const y = Math.floor(box.y - pad);
    const w = Math.ceil(box.width + pad * 2);
    const h = Math.ceil(box.height + pad * 2);

    const all = [clone, ...Array.from(clone.querySelectorAll("*"))];
    const computed = new Map<Element, CSSStyleDeclaration>(all.map((el) => [el, getComputedStyle(el)]));
    const names = Array.from(computed.get(clone)!);
    const rootParent = getComputedStyle(sb.host);
    const families = new Set<string>();
    const animations = new Set<string>();
    const styles = all.map((el) => {
      const cs = computed.get(el)!;
      if (el.localName === "style" || el.localName === "defs" || (el.closest("defs") && !el.closest("marker"))) return null;
      const parent = el === clone ? rootParent : computed.get(el.parentElement!) ?? rootParent;
      for (const f of familyNames(cs.getPropertyValue("font-family"))) families.add(f);
      const anim = cs.getPropertyValue("animation-name");
      if (anim && anim !== "none") for (const a of anim.split(",")) animations.add(a.trim());
      return styleDiff(el, cs, parent, defaultStyle(sb, el), names, el === clone);
    });
    all.forEach((el, i) => {
      const s = styles[i];
      if (s === null) return;
      if (s) el.setAttribute("style", s);
      else el.removeAttribute("style");
      el.removeAttribute("class");
      for (const a of Array.from(el.attributes)) if (a.name.startsWith("data-")) el.removeAttribute(a.name);
    });

    for (const a of ["role", "aria-label", "aria-roledescription", "aria-hidden", "tabindex"]) clone.removeAttribute(a);
    clone.setAttribute("xmlns", SVG_NS);
    clone.setAttribute("xmlns:xlink", "http://www.w3.org/1999/xlink");
    clone.setAttribute("viewBox", `${x} ${y} ${w} ${h}`);
    clone.setAttribute("width", String(w));
    clone.setAttribute("height", String(h));
    const title = document.createElementNS(SVG_NS, "title");
    title.textContent = doc.title || "Diagrama";
    const bg = boardBackground(x, y, w, h, opts.background ?? "board");
    if (bg) clone.insertBefore(bg, world);

    const css = [await fontFaces(families, clone.textContent ?? ""), keyframes(animations)].filter(Boolean).join("\n");
    if (css) {
      const style = document.createElementNS(SVG_NS, "style");
      style.textContent = css;
      clone.insertBefore(style, clone.firstChild);
    }
    clone.insertBefore(title, clone.firstChild);
    clone.remove();
    await inlineResources(clone);
    return { svg: `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(clone)}`, w, h };
  } finally {
    clone.remove();
    sb.host.remove();
  }
}

const MAX_SIDE = 16384;
const MAX_AREA = 120e6;

export async function renderPng(opts: ImageExportOptions = {}): Promise<{ blob: Blob; w: number; h: number } | null> {
  const r = await renderSvg(opts);
  if (!r) return null;
  let scale = Math.min(Math.max(opts.scale ?? 2, 0.25), 4);
  scale = Math.min(scale, MAX_SIDE / r.w, MAX_SIDE / r.h, Math.sqrt(MAX_AREA / (r.w * r.h)));
  const img = new Image();
  img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(r.svg);
  await img.decode();
  const c = document.createElement("canvas");
  c.width = Math.round(r.w * scale);
  c.height = Math.round(r.h * scale);
  const ctx = c.getContext("2d")!;
  ctx.scale(scale, scale);
  ctx.drawImage(img, 0, 0, r.w, r.h);
  const blob = await new Promise<Blob | null>((ok) => c.toBlob(ok, "image/png"));
  if (!blob) throw new Error("o navegador não gerou o PNG");
  return { blob, w: c.width, h: c.height };
}

/** Pedido de exportação vindo do MCP (pelo bridge): renderiza aqui e devolve o arquivo. */
export interface ExportRequest extends ImageExportOptions {
  id: string;
  format: "svg" | "png";
  file?: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function answerExport(req: ExportRequest) {
  const reply = (body: object) =>
    fetch("/api/export/result", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: req.id, ...body }) }).catch(() => undefined);
  try {
    for (let i = 0; req.file && getState().file !== req.file && i < 100; i++) await sleep(100);
    if (req.file && getState().file !== req.file) throw new Error(`a janela não abriu ${req.file}`);
    await sleep(300);
    if (req.format === "png") {
      const r = await renderPng(req);
      if (!r) throw new Error("o diagrama está vazio");
      const data = (await toDataUrl(r.blob)).split(",")[1];
      await reply({ data, encoding: "base64", w: r.w, h: r.h });
    } else {
      const r = await renderSvg(req);
      if (!r) throw new Error("o diagrama está vazio");
      await reply({ data: r.svg, encoding: "utf8", w: r.w, h: r.h });
    }
  } catch (e) {
    await reply({ error: e instanceof Error ? e.message : String(e) });
  }
}

/* ───────── HTML autônomo ───────── */

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
