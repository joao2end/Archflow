/**
 * Exportação do modo Logic em seções: PDF (uma página por seção, diagramas em vetor) ou ZIP (SVG e PNG por seção + README.md).
 *
 * Cada diagrama é desenhado fora da tela com os mesmos componentes do quadro (sem tocar no documento aberto) e serializado
 * como na exportação de imagem. No PDF, cada SVG entra inteiro num documento de impressão (vetor: nítido em qualquer zoom,
 * texto selecionável) e as tabelas são HTML; no ZIP, capa, cenários e dados viram páginas PNG desenhadas num canvas.
 * Para sair legível em papel, a exportação usa sempre o tema claro.
 */
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { checkExamples, dataNames, logicStatus } from "../shared/logic";
import { loopFrames } from "../shared/logiclayout";
import { dataContract, edgeCoverage, logicSummary, pairs, scenarioMatrix } from "../shared/logicoverview";
import { logicSections, sectionsIndex, type Section } from "../shared/logicsections";
import { projectStages, stageGroups, stageSummary } from "../shared/logicstages";
import { slug } from "../shared/ops";
import type { Doc } from "../shared/schema";
import { truncate } from "../shared/text";
import { zip, type ZipEntry } from "../shared/zip";
import { DiagramDefs, Edge, EdgeLabel, GroupShape, NodeShape, NoteShape, SummaryCard, ViewerAssets, computeEdges, sortedGroups, type StageView } from "./Canvas";
import { download, embeddedFonts, rasterize, serializeSvg } from "./export";
import { contentBounds } from "./geometry";
import { getState, toast, toastError } from "./store";

/* ───────── o diagrama de uma seção, desenhado fora da tela ───────── */

function ExportDiagram({ doc }: { doc: Doc }) {
  const view = projectStages(doc);
  const results = checkExamples(doc);
  const status = logicStatus(doc);
  const names = dataNames(doc);
  const cover = doc.nodes.some((n) => n.logic?.role === "scenario") ? edgeCoverage(doc, results) : undefined;
  const stages = new Map<string, StageView>(stageGroups(doc).filter((g) => g.stage?.collapsed).map((g) => [g.id, { summary: stageSummary(doc, g.id, results, status) }]));
  const edges = computeEdges(view);
  return (
    <ViewerAssets.Provider value={doc.customAssets}>
      <svg className="canvas export-canvas" style={{ ["--z" as string]: 1 }}>
        <defs>
          <DiagramDefs />
        </defs>
        <g transform="translate(0,0)">
          <SummaryCard doc={doc} />
          {loopFrames(view).map((f) => (
            <g key={f.id} transform={`translate(${f.x},${f.y})`} className="loop-frame">
              <rect width={f.w} height={f.h} rx={22} />
              <text x={16} y={19}>
                ↻ {truncate(f.label, Math.floor((f.w - 40) / 6.6))}
              </text>
            </g>
          ))}
          {sortedGroups(view).map((g) => (
            <GroupShape key={g.id} g={g} selected={false} hot={false} hovered={false} stage={g.stage ? stages.get(g.id) ?? { summary: stageSummary(doc, g.id, results, status) } : undefined} />
          ))}
          {edges.map(({ c, g }) => (
            <Edge key={c.id} c={c} d={g.d} mid={g.label ?? g.mid} selected={false} animate={false} flow withLabel={false} />
          ))}
          {view.nodes.map((n) => (
            <NodeShape key={n.id} n={n} selected={false} hot={false} hovered={false} status={status.get(n.id)} names={names} />
          ))}
          {view.notes.map((n) => (
            <NoteShape key={n.id} n={n} selected={false} />
          ))}
          {edges.map(({ c, g }) => (
            <EdgeLabel key={c.id} c={c} mid={g.label ?? g.mid} selected={false} flow cover={cover?.get(c.id)} />
          ))}
        </g>
      </svg>
    </ViewerAssets.Provider>
  );
}

/** O SVG de uma seção: o diagrama inteiro, ou só a moldura da etapa em foco. */
export async function sectionSvg(s: Section): Promise<{ svg: string; w: number; h: number } | null> {
  if (!s.doc) return null;
  const host = document.createElement("div");
  host.style.cssText = "position:fixed;left:-100000px;top:0;width:4000px;height:4000px;pointer-events:none";
  document.body.appendChild(host);
  const root = createRoot(host);
  try {
    flushSync(() => root.render(<ExportDiagram doc={s.doc!} />));
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const src = host.querySelector("svg") as SVGSVGElement;
    const g = s.focus ? s.doc.groups.find((x) => x.id === s.focus) : undefined;
    // a etapa: a moldura dela e um pouco de folga para as setas que entram e saem
    const box = g ? { x: g.x - 60, y: g.y - 60, w: g.w + 120, h: g.h + 120 } : contentBounds(s.doc);
    return await serializeSvg(src, box, `${s.doc.title} · ${s.title}`, { background: "solid", padding: g ? 0 : 40, crop: !!g });
  } finally {
    root.unmount();
    host.remove();
  }
}

/* ───────── páginas (A4 deitado, 2×) ───────── */

const PW = 1684;
const PH = 1190;
const M = 72;
const FONT = '"Inter Tight", "Segoe UI", Arial, sans-serif';
const INK = "#25244a";
const INK2 = "#5a5883";
const INK3 = "#7a789e";
const PRIMARY = "#706fd3";

function page(): { c: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const c = document.createElement("canvas");
  c.width = PW;
  c.height = PH;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, PW, PH);
  ctx.textBaseline = "alphabetic";
  return { c, ctx };
}

/** Quebra o texto em linhas que cabem em `w` (no máximo `max` linhas, com «…» na última). */
function wrap(ctx: CanvasRenderingContext2D, text: string, w: number, max = 99): string[] {
  const out: string[] = [];
  for (const para of text.split("\n")) {
    let line = "";
    for (const word of para.split(/\s+/)) {
      const t = line ? `${line} ${word}` : word;
      if (ctx.measureText(t).width <= w || !line) line = t;
      else (out.push(line), (line = word));
    }
    out.push(line);
  }
  if (out.length > max) {
    const cut = out.slice(0, max);
    cut[max - 1] = cut[max - 1].replace(/\s*\S*$/, "") + "…";
    return cut;
  }
  return out;
}

function text(ctx: CanvasRenderingContext2D, t: string, x: number, y: number, font: string, color = INK) {
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.fillText(t, x, y);
}

/** Cabeçalho comum: seção (kicker), título, subtítulo e fatos. Devolve onde o conteúdo começa. */
function header(ctx: CanvasRenderingContext2D, s: Section, n: number, total: number, docTitle: string): number {
  text(ctx, `${docTitle.toUpperCase()} · ${n}/${total}`, M, M, `700 17px ${FONT}`, PRIMARY);
  text(ctx, s.title, M, M + 46, `650 38px ${FONT}`);
  let y = M + 46;
  if (s.subtitle) {
    ctx.font = `450 20px ${FONT}`;
    for (const l of wrap(ctx, s.subtitle, PW - 2 * M, 2)) text(ctx, l, M, (y += 32), `450 20px ${FONT}`, INK2);
  }
  if (s.facts?.length) {
    ctx.font = `600 17px ${FONT}`;
    for (const l of wrap(ctx, s.facts.join("   ·   "), PW - 2 * M, 2)) text(ctx, l, M, (y += 30), `600 17px ${FONT}`, INK);
  }
  ctx.fillStyle = "#e6e5f3";
  ctx.fillRect(M, y + 22, PW - 2 * M, 2);
  return y + 46;
}

function footer(ctx: CanvasRenderingContext2D) {
  text(ctx, `Archflow · ${new Date().toLocaleDateString("pt-BR")}`, M, PH - 34, `500 14px ${FONT}`, INK3);
}

async function drawImage(ctx: CanvasRenderingContext2D, svg: { svg: string; w: number; h: number }, top: number) {
  const c = await rasterize(svg, 2);
  const aw = PW - 2 * M;
  const ah = PH - top - 64;
  const k = Math.min(aw / c.width, ah / c.height, 1.4);
  const w = c.width * k;
  const h = c.height * k;
  ctx.drawImage(c, M + (aw - w) / 2, top, w, h);
}

function coverPage(doc: Doc, s: Section, total: number): HTMLCanvasElement {
  const { c, ctx } = page();
  const sum = logicSummary(doc);
  text(ctx, "RESUMO", M, M + 10, `800 18px ${FONT}`, PRIMARY);
  ctx.font = `650 56px ${FONT}`;
  let y = M + 30;
  for (const l of wrap(ctx, doc.title, PW - 2 * M, 2)) text(ctx, l, M, (y += 66), `650 56px ${FONT}`);
  if (doc.description) {
    ctx.font = `450 24px ${FONT}`;
    y += 12;
    for (const l of wrap(ctx, doc.description, PW - 2 * M, 5)) text(ctx, l, M, (y += 36), `450 24px ${FONT}`, INK2);
  }
  y += 24;
  ctx.font = `600 21px ${FONT}`;
  for (const f of s.facts ?? []) for (const [i, l] of wrap(ctx, f, PW - 2 * M - 30, 3).entries()) text(ctx, i ? l : `•  ${l}`, i ? M + 26 : M, (y += 32), `600 21px ${FONT}`);
  if (sum.stages.length) {
    y += 30;
    text(ctx, "ETAPAS, NA ORDEM DO FLUXO", M, (y += 20), `800 16px ${FONT}`, INK3);
    sum.stages.forEach((st, i) => {
      ctx.font = `450 19px ${FONT}`;
      const line = wrap(ctx, `${i + 1}. ${st.label}${st.text ? ` — ${st.text}` : ""}`, PW - 2 * M, 1)[0];
      text(ctx, line, M, (y += 31), `500 19px ${FONT}`);
    });
  }
  text(ctx, `${total} seções`, PW - M - 120, PH - 34, `500 14px ${FONT}`, INK3);
  footer(ctx);
  return c;
}

type Col = { title: string; w: number; mono?: boolean };

/** Tabela paginada: devolve as páginas desenhadas (cabeçalho da seção em cada uma). */
function tablePages(s: Section, n: number, total: number, docTitle: string, cols: Col[], rows: { cells: string[]; tone?: "ok" | "fail" }[]): HTMLCanvasElement[] {
  const pages: HTMLCanvasElement[] = [];
  let i = 0;
  const totalW = cols.reduce((a, c) => a + c.w, 0);
  const scale = (PW - 2 * M) / totalW;
  do {
    const { c, ctx } = page();
    let y = header(ctx, { ...s, title: pages.length ? `${s.title} (continuação)` : s.title }, n, total, docTitle);
    // cabeçalho das colunas
    let x = M;
    for (const col of cols) (text(ctx, col.title.toUpperCase(), x, y, `800 13px ${FONT}`, INK3), (x += col.w * scale));
    y += 14;
    while (i < rows.length) {
      const r = rows[i];
      const lines = r.cells.map((t, k) => {
        ctx.font = `${cols[k].mono ? "500 14px ui-monospace, Consolas, monospace" : `500 15px ${FONT}`}`;
        return wrap(ctx, t, cols[k].w * scale - 14, 4);
      });
      const h = Math.max(...lines.map((l) => l.length)) * 20 + 14;
      if (y + h > PH - 70 && i > 0 && y > 300) break;
      ctx.fillStyle = r.tone === "fail" ? "#fdeceb" : i % 2 ? "#f7f7fc" : "#ffffff";
      ctx.fillRect(M - 8, y, PW - 2 * M + 16, h);
      x = M;
      lines.forEach((ls, k) => {
        ls.forEach((l, j) => text(ctx, l, x, y + 22 + j * 20, cols[k].mono ? "500 14px ui-monospace, Consolas, monospace" : `500 15px ${FONT}`, k === 0 && r.tone ? (r.tone === "ok" ? "#2f9e6b" : "#d6453d") : INK));
        x += cols[k].w * scale;
      });
      y += h;
      i++;
    }
    footer(ctx);
    pages.push(c);
  } while (i < rows.length);
  return pages;
}

function scenarioPages(doc: Doc, s: Section, n: number, total: number): HTMLCanvasElement[] {
  const rows = scenarioMatrix(doc).map((r) => ({
    tone: (r.ok ? "ok" : "fail") as "ok" | "fail",
    cells: [r.ok ? "✔" : "✘", `${r.label}${r.failure ? " (falha esperada)" : ""}`, pairs(r.given) || "—", pairs(r.expect), r.ok ? "igual ao esperado" : pairs(r.got), `${r.stages.join(" → ") || `${r.steps} passos`}${r.rounds > 1 ? ` (${r.rounds} voltas)` : ""}`],
  }));
  return tablePages(s, n, total, doc.title, [{ title: "", w: 3 }, { title: "Cenário", w: 18 }, { title: "Entra", w: 20, mono: true }, { title: "Espera", w: 20, mono: true }, { title: "Saiu", w: 14, mono: true }, { title: "Passa por", w: 25 }], rows);
}

function dataPages(doc: Doc, s: Section, n: number, total: number): HTMLCanvasElement[] {
  const c = dataContract(doc);
  const rows = [
    ...c.inputs.map((d) => ({ cells: ["Entrada", d.key, d.label, d.type ?? "", d.text ?? ""] })),
    ...c.outputs.map((d) => ({ cells: ["Resultado", d.key, d.label, d.type ?? "", d.text ?? ""] })),
    ...c.variables.map((d) => ({ cells: ["Variável", d.key, d.label, d.type ?? "", d.text ?? ""] })),
  ];
  return tablePages(s, n, total, doc.title, [{ title: "Papel", w: 10 }, { title: "Nome", w: 16, mono: true }, { title: "Dado", w: 18 }, { title: "Tipo", w: 14, mono: true }, { title: "Significado", w: 42 }], rows);
}

/* ───────── empacotar ───────── */

const toBytes = async (c: HTMLCanvasElement, type: "image/png" | "image/jpeg") => {
  const b = await new Promise<Blob | null>((ok) => c.toBlob(ok, type, 0.9));
  if (!b) throw new Error("o navegador não gerou a imagem");
  return new Uint8Array(await b.arrayBuffer());
};

/** Roda com o tema claro (papel) e devolve o tema anterior no fim. */
async function lightTheme<T>(fn: () => Promise<T>): Promise<T> {
  const root = document.documentElement;
  const prev = root.getAttribute("data-theme");
  root.setAttribute("data-theme", "light");
  try {
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    return await fn();
  } finally {
    if (prev === null) root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", prev);
  }
}

const fileBase = (doc: Doc) => slug(doc.title).slice(0, 40) || "diagrama";

type Rendered = { section: Section; pages: HTMLCanvasElement[]; image?: HTMLCanvasElement; svg?: string };

/** As páginas de cada seção, já desenhadas (o diagrama de uma seção também volta solto, em PNG e em SVG, para o ZIP). */
async function renderSections(doc: Doc, sections: Section[]): Promise<Rendered[]> {
  const out: Rendered[] = [];
  const total = sections.length;
  for (const [i, s] of sections.entries()) {
    const n = i + 1;
    if (s.kind === "cover") out.push({ section: s, pages: [coverPage(doc, s, total)] });
    else if (s.kind === "scenarios") out.push({ section: s, pages: scenarioPages(doc, s, n, total) });
    else if (s.kind === "data") out.push({ section: s, pages: dataPages(doc, s, n, total) });
    else {
      const svg = await sectionSvg(s);
      if (!svg) continue;
      const { c, ctx } = page();
      const top = header(ctx, s, n, total, doc.title);
      await drawImage(ctx, svg, top);
      footer(ctx);
      out.push({ section: s, pages: [c], image: await rasterize(svg, 2), svg: svg.svg });
    }
  }
  return out;
}

/* ───────── PDF: documento de impressão com os diagramas em vetor ───────── */

const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * O SVG serializado pronto para entrar no HTML: sem o cabeçalho XML, esticando para caber na página (o viewBox mantém a
 * proporção) e sem sombras: na impressão, todo elemento com filtro vira imagem rasterizada, e o PDF deixaria de ser vetor.
 */
const inlineSvg = (svg: string, id: string) => {
  const body = svg
    .replace(/^<\?xml[^>]*>\s*/, "")
    .replace(/\sfilter="url\([^"]*\)"/g, "")
    .replace(/filter:\s*(?:url\((?:&quot;|")?#[\w-]+(?:&quot;|")?\)|drop-shadow\([^;"]*\))[^;"]*;?/g, "")
    .replace(/<svg([^>]*?)\swidth="[\d.]+"/, "<svg$1")
    .replace(/<svg([^>]*?)\sheight="[\d.]+"/, '<svg$1 preserveAspectRatio="xMidYMid meet"');
  // a caixa do SVG na página é maior que o viewBox (a proporção é mantida): recorta o desenho no viewBox,
  // senão o que ficou fora do enquadramento (as colunas de dados ao lado de uma etapa) aparece nas laterais
  const vb = /viewBox="([-\d.]+) ([-\d.]+) ([\d.]+) ([\d.]+)"/.exec(body);
  if (!vb) return body;
  const open = body.indexOf(">", body.indexOf("<svg")) + 1;
  const close = body.lastIndexOf("</svg>");
  const clip = `<defs><clipPath id="${id}"><rect x="${vb[1]}" y="${vb[2]}" width="${vb[3]}" height="${vb[4]}"/></clipPath></defs><g clip-path="url(#${id})">`;
  return body.slice(0, open) + clip + body.slice(open, close) + "</g>" + body.slice(close);
};

function headHtml(s: Section, n: number, total: number, docTitle: string): string {
  return `<header><div class="kicker">${esc(docTitle)} · ${n}/${total}</div><h1>${esc(s.title)}</h1>${s.subtitle ? `<p class="sub">${esc(s.subtitle)}</p>` : ""}${s.facts?.length ? `<p class="facts">${s.facts.map(esc).join(" &nbsp;·&nbsp; ")}</p>` : ""}</header>`;
}

function tableHtml(cols: { title: string; mono?: boolean; w: number }[], rows: { cells: string[]; tone?: "ok" | "fail" }[]): string {
  return `<table><colgroup>${cols.map((c) => `<col style="width:${c.w}%">`).join("")}</colgroup><thead><tr>${cols.map((c) => `<th>${esc(c.title)}</th>`).join("")}</tr></thead><tbody>${rows
    .map((r) => `<tr class="${r.tone ?? ""}">${r.cells.map((t, k) => `<td class="${cols[k].mono ? "mono" : ""}">${esc(t)}</td>`).join("")}</tr>`)
    .join("")}</tbody></table>`;
}

/** O documento inteiro: capa, uma página por diagrama (SVG vetorial, nítido em qualquer zoom) e as tabelas, que continuam na página seguinte quando longas. */
export async function sectionsPrintHtml(doc: Doc, sections: Section[]): Promise<string> {
  const total = sections.length;
  const sum = logicSummary(doc);
  const pages: string[] = [];
  for (const [i, s] of sections.entries()) {
    const n = i + 1;
    if (s.kind === "cover") {
      pages.push(
        `<section class="page cover"><div class="kicker">Resumo</div><h1 class="big">${esc(doc.title)}</h1>${doc.description ? `<p class="lead">${esc(doc.description)}</p>` : ""}<ul class="facts-list">${(s.facts ?? []).map((f) => `<li>${esc(f)}</li>`).join("")}</ul>${
          sum.stages.length ? `<h2>Etapas, na ordem do fluxo</h2><ol class="stages">${sum.stages.map((st) => `<li><b>${esc(st.label)}</b>${st.text ? ` — ${esc(st.text)}` : ""}</li>`).join("")}</ol>` : ""
        }<footer>Archflow · ${new Date().toLocaleDateString("pt-BR")} · ${total} seções</footer></section>`,
      );
    } else if (s.kind === "scenarios") {
      const rows = scenarioMatrix(doc).map((r) => ({
        tone: (r.ok ? "ok" : "fail") as "ok" | "fail",
        cells: [r.ok ? "✔" : "✘", `${r.label}${r.failure ? " (falha esperada)" : ""}`, pairs(r.given) || "—", pairs(r.expect), r.ok ? "igual ao esperado" : pairs(r.got), `${r.stages.join(" → ") || `${r.steps} passos`}${r.rounds > 1 ? ` (${r.rounds} voltas)` : ""}`],
      }));
      pages.push(`<section class="page text">${headHtml(s, n, total, doc.title)}${tableHtml([{ title: "", w: 3 }, { title: "Cenário", w: 17 }, { title: "Entra", w: 20, mono: true }, { title: "Espera", w: 20, mono: true }, { title: "Saiu", w: 14, mono: true }, { title: "Passa por", w: 26 }], rows)}</section>`);
    } else if (s.kind === "data") {
      const c = dataContract(doc);
      const rows = [
        ...c.inputs.map((d) => ({ cells: ["Entrada", d.key, d.label, d.type ?? "", d.text ?? ""] })),
        ...c.outputs.map((d) => ({ cells: ["Resultado", d.key, d.label, d.type ?? "", d.text ?? ""] })),
        ...c.variables.map((d) => ({ cells: ["Variável", d.key, d.label, d.type ?? "", d.text ?? ""] })),
      ];
      pages.push(`<section class="page text">${headHtml(s, n, total, doc.title)}${tableHtml([{ title: "Papel", w: 10 }, { title: "Nome", w: 16, mono: true }, { title: "Dado", w: 18 }, { title: "Tipo", w: 14, mono: true }, { title: "Significado", w: 42 }], rows)}</section>`);
    } else {
      const svg = await sectionSvg(s);
      if (svg) pages.push(`<section class="page fig">${headHtml(s, n, total, doc.title)}<div class="figure">${inlineSvg(svg.svg, `recorte-${n}`)}</div></section>`);
    }
  }
  const fonts = await embeddedFonts();
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${esc(doc.title)}</title><style>
${fonts}
@page { size: A4 landscape; margin: 12mm; }
* { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
html, body { margin: 0; background: #fff; }
body { font-family: "Inter Tight", "Segoe UI", Arial, sans-serif; color: #25244a; }
.page { break-after: page; page-break-after: always; }
.page:last-child { break-after: auto; page-break-after: auto; }
.page.fig, .page.cover { height: 185mm; display: flex; flex-direction: column; overflow: hidden; }
.kicker { font: 700 9pt/1.2 inherit; font-family: inherit; letter-spacing: 0.08em; text-transform: uppercase; color: #706fd3; }
h1 { margin: 2mm 0 1mm; font-size: 20pt; font-weight: 650; }
h1.big { font-size: 30pt; margin-top: 4mm; }
h2 { margin: 6mm 0 2mm; font-size: 9pt; letter-spacing: 0.08em; text-transform: uppercase; color: #7a789e; }
.sub, .lead { margin: 0 0 1mm; color: #5a5883; font-size: 11pt; line-height: 1.45; }
.lead { font-size: 13pt; }
.facts { margin: 1mm 0 0; font-size: 9.5pt; font-weight: 600; }
header { padding-bottom: 3mm; border-bottom: 0.4mm solid #e6e5f3; margin-bottom: 4mm; }
.figure { flex: 1; min-height: 0; display: flex; }
.figure svg { width: 100%; height: 100%; overflow: hidden !important; }
.facts-list { margin: 4mm 0 0; padding-left: 5mm; font-size: 12pt; font-weight: 600; line-height: 1.7; }
.stages { margin: 0; padding-left: 6mm; font-size: 11pt; line-height: 1.6; }
.cover footer { margin-top: auto; font-size: 8pt; color: #7a789e; }
table { width: 100%; border-collapse: collapse; font-size: 8.5pt; table-layout: fixed; }
thead { display: table-header-group; }
th { text-align: left; font-size: 7.5pt; letter-spacing: 0.06em; text-transform: uppercase; color: #7a789e; padding: 1.5mm 2mm; border-bottom: 0.3mm solid #d9d8ee; }
td { padding: 1.6mm 2mm; border-bottom: 0.2mm solid #ecebf6; vertical-align: top; overflow-wrap: anywhere; }
tr { break-inside: avoid; }
td.mono { font-family: ui-monospace, Consolas, monospace; font-size: 7.8pt; }
tr.ok td:first-child { color: #2f9e6b; font-weight: 800; }
tr.fail td { background: #fdeceb; }
tr.fail td:first-child { color: #d6453d; font-weight: 800; }
</style></head><body>${pages.join("\n")}</body></html>`;
}

/** Abre o diálogo de impressão do navegador com o documento (destino «Salvar como PDF»): o PDF sai em vetor, com texto selecionável. */
async function printHtml(html: string) {
  const frame = document.createElement("iframe");
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:1123px;height:794px;border:0;opacity:0;pointer-events:none";
  frame.setAttribute("aria-hidden", "true");
  document.body.appendChild(frame);
  await new Promise<void>((ok) => {
    frame.onload = () => ok();
    frame.srcdoc = html;
  });
  const win = frame.contentWindow!;
  await win.document.fonts.ready;
  const done = () => setTimeout(() => frame.remove(), 1000);
  win.addEventListener("afterprint", done, { once: true });
  win.focus();
  win.print();
  setTimeout(done, 120_000); // se o navegador não avisar o fim da impressão
}

/** PDF: uma página por seção, com os diagramas em vetor (as tabelas longas continuam na página seguinte). */
export async function exportSectionsPdf() {
  const doc = getState().doc;
  const sections = logicSections(doc);
  toast(`Montando o PDF: ${sections.length} seções… No diálogo, escolha «Salvar como PDF».`);
  try {
    const html = await lightTheme(() => sectionsPrintHtml(doc, sections));
    await printHtml(html);
  } catch (e) {
    toastError(e instanceof Error ? e.message : String(e));
  }
}

/** ZIP: cada diagrama em SVG (vetor) e PNG; capa, cenários e dados como página PNG; e um README.md com tudo em texto. */
export async function exportSectionsZip() {
  const doc = getState().doc;
  const sections = logicSections(doc);
  toast(`Montando o ZIP: ${sections.length} seções…`);
  try {
    const done = await lightTheme(() => renderSections(doc, sections));
    const entries: ZipEntry[] = [{ path: "README.md", content: sectionsIndex(doc, sections, "svg") }];
    for (const r of done) {
      if (r.image) {
        entries.push({ path: `${r.section.file}.svg`, content: r.svg! });
        entries.push({ path: `${r.section.file}.png`, content: await toBytes(r.image, "image/png") });
      } else for (const [k, c] of r.pages.entries()) entries.push({ path: `${r.section.file}${r.pages.length > 1 ? `-${k + 1}` : ""}.png`, content: await toBytes(c, "image/png") });
    }
    download(`${fileBase(doc)}-secoes.zip`, new Blob([zip(entries) as unknown as BlobPart], { type: "application/zip" }));
    toast(`ZIP com ${entries.length - 1} arquivos e o README.md baixado`);
  } catch (e) {
    toastError(e instanceof Error ? e.message : String(e));
  }
}
