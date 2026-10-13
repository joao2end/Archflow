/**
 * Texto rico das notas e do texto livre.
 *
 * O formato guardado continua sendo uma string (`NoteEl.text`) num subconjunto de Markdown, então
 * notas antigas, o MCP e a visão LLM seguem funcionando sem migração:
 *
 *   **negrito**  *itálico*  ~~riscado~~  `código`
 *   # título   ## subtítulo   - item   1. item numerado
 *   ```lang … ```  — bloco de código (fence)
 *   {@c=#e5484d;f=serif;w=700}trecho{/}   — cor, fonte e peso
 *
 * `\*`, `\~`, `` \` ``, `\#`, `\-`, `\.`, `\{@`, `\{/` e `\\` escrevem o caractere literal.
 */

export type RichFont = "sans" | "serif" | "mono";
export type RichWeight = 400 | 500 | 600 | 700 | 800;

export interface Span {
  t: string;
  b?: boolean;
  i?: boolean;
  s?: boolean;
  c?: boolean;
  color?: string;
  font?: RichFont;
  weight?: RichWeight;
}

export type BlockKind = "p" | "h1" | "h2" | "ul" | "ol" | "pre";

export interface Block {
  kind: BlockKind;
  /** número exibido de um item de lista numerada */
  n?: number;
  /** linguagem do bloco de código (fence), ex.: "json", "ts" */
  lang?: string;
  spans: Span[];
}

export const RICH_FONTS: { id: RichFont; name: string }[] = [
  { id: "sans", name: "Sans" },
  { id: "serif", name: "Serif" },
  { id: "mono", name: "Mono" },
];

export const RICH_WEIGHTS: { id: RichWeight; name: string }[] = [
  { id: 400, name: "Regular" },
  { id: 500, name: "Medium" },
  { id: 600, name: "Semibold" },
  { id: 700, name: "Bold" },
  { id: 800, name: "Extra" },
];

/** Escala tipográfica da nota/texto (rótulo → px no quadro). */
export const RICH_SIZES = [
  { id: "xs", px: 12 },
  { id: "sm", px: 14 },
  { id: "md", px: 16 },
  { id: "lg", px: 18 },
  { id: "xl", px: 20 },
  { id: "2xl", px: 24 },
  { id: "3xl", px: 28 },
  { id: "4xl", px: 32 },
  { id: "5xl", px: 40 },
] as const;

export type RichSizeId = (typeof RICH_SIZES)[number]["id"];

/** px → token mais próximo da escala (para o select). */
export function nearestRichSize(px: number): (typeof RICH_SIZES)[number] {
  let best: (typeof RICH_SIZES)[number] = RICH_SIZES[0];
  let dist = Math.abs(px - best.px);
  for (const s of RICH_SIZES) {
    const d = Math.abs(px - s.px);
    if (d < dist) (best = s), (dist = d);
  }
  return best;
}

/** Cores de fundo sugeridas para o card da nota. */
export const NOTE_FILLS: { id: string; name: string }[] = [
  { id: "#ffeeba", name: "Amarelo" },
  { id: "#ffd6a5", name: "Pêssego" },
  { id: "#ffadad", name: "Rosa" },
  { id: "#caffbf", name: "Verde" },
  { id: "#9bf6ff", name: "Ciano" },
  { id: "#bdb2ff", name: "Lilás" },
  { id: "#ffffff", name: "Branco" },
  { id: "#eef2f7", name: "Cinza" },
];

export const FONT_CSS: Record<RichFont, string> = {
  sans: "var(--sans)",
  serif: "var(--serif)",
  mono: 'ui-monospace, "JetBrains Mono", Consolas, monospace',
};

const ESCAPABLE = "\\*~`#.-"; // cada um vira um caractere privado (U+E000 + posição) enquanto os marcadores são lidos
const PH_OPEN = "\uE010"; // \{@
const PH_CLOSE = "\uE011"; // \{/
const INLINE = /\*\*\*(.+?)\*\*\*|\*\*(.+?)\*\*|~~(.+?)~~|`([^`]+)`|\*([^*\s](?:[^*]*[^*\s])?)\*/;

const WEIGHTS = new Set([400, 500, 600, 700, 800]);
const FONTS = new Set<string>(["sans", "serif", "mono"]);

export function parseAttrs(raw: string): Omit<Span, "t"> {
  const st: Omit<Span, "t"> = {};
  for (const part of raw.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const k = part.slice(0, eq).trim();
    const v = part.slice(eq + 1).trim();
    if (k === "c" && /^#[0-9a-fA-F]{3,8}$/.test(v)) st.color = v.toLowerCase();
    else if (k === "f" && FONTS.has(v)) st.font = v as RichFont;
    else if (k === "w") {
      const n = Number(v);
      if (WEIGHTS.has(n)) st.weight = n as RichWeight;
    }
  }
  return st;
}

function formatAttrs(s: Omit<Span, "t">): string {
  const parts: string[] = [];
  if (s.color) parts.push(`c=${s.color}`);
  if (s.font) parts.push(`f=${s.font}`);
  if (s.weight) parts.push(`w=${s.weight}`);
  return parts.join(";");
}

function hasStyle(s: Omit<Span, "t">) {
  return !!(s.color || s.font || s.weight);
}

/** índice de `{/}` que fecha o wrapper aberto em `from` (após o `}` do open). */
function findStyleClose(src: string, from: number): number {
  let depth = 1;
  let i = from;
  while (i < src.length) {
    if (src.startsWith("{@", i)) {
      const end = src.indexOf("}", i + 2);
      if (end < 0) return -1;
      depth++;
      i = end + 1;
    } else if (src.startsWith("{/}", i)) {
      depth--;
      if (depth === 0) return i;
      i += 3;
    } else i++;
  }
  return -1;
}

function inline(src: string, st: Omit<Span, "t">, out: Span[]) {
  let rest = src;
  while (rest) {
    const styleAt = rest.indexOf("{@");
    const m = INLINE.exec(rest);
    const mdAt = m ? m.index : Infinity;
    const stAt = styleAt >= 0 ? styleAt : Infinity;

    if (stAt === Infinity && mdAt === Infinity) {
      out.push({ t: rest, ...st });
      break;
    }

    if (stAt <= mdAt) {
      if (stAt > 0) out.push({ t: rest.slice(0, stAt), ...st });
      const openEnd = rest.indexOf("}", stAt + 2);
      if (openEnd < 0) {
        out.push({ t: rest.slice(stAt), ...st });
        break;
      }
      const close = findStyleClose(rest, openEnd + 1);
      if (close < 0) {
        out.push({ t: rest.slice(stAt), ...st });
        break;
      }
      const attrs = parseAttrs(rest.slice(stAt + 2, openEnd));
      inline(rest.slice(openEnd + 1, close), { ...st, ...attrs }, out);
      rest = rest.slice(close + 3);
      continue;
    }

    if (m!.index) out.push({ t: rest.slice(0, m!.index), ...st });
    if (m![1] !== undefined) inline(m![1], { ...st, b: true, i: true }, out);
    else if (m![2] !== undefined) inline(m![2], { ...st, b: true }, out);
    else if (m![3] !== undefined) inline(m![3], { ...st, s: true }, out);
    else if (m![4] !== undefined) out.push({ t: m![4], ...st, c: true });
    else inline(m![5], { ...st, i: true }, out);
    rest = rest.slice(m!.index + m![0].length);
  }
}

const unescape = (s: string) =>
  s
    .replace(/[-]/g, (c) => ESCAPABLE[c.charCodeAt(0) - 0xe000])
    .replaceAll(PH_OPEN, "{@")
    .replaceAll(PH_CLOSE, "{/");

/** Quebra um trecho em spans estilizados (sem blocos). */
export function parseInline(src: string): Span[] {
  const out: Span[] = [];
  const prepared = src
    .replace(/\\\{@/g, PH_OPEN)
    .replace(/\\\{\//g, PH_CLOSE)
    .replace(/\\([\\*~`#.-])/g, (_, c: string) => String.fromCharCode(0xe000 + ESCAPABLE.indexOf(c)));
  inline(prepared, {}, out);
  return out.map((s) => ({ ...s, t: unescape(s.t) })).filter((s) => s.t);
}

const FENCE_OPEN = /^```([\w+-]*)[ \t]*$/;
const FENCE_CLOSE = /^```[ \t]*$/;
/** Fence numa só linha: ```json { "a": 1 }``` ou ```teste``` */
const FENCE_SAME = /^```([\w+-]*)[ \t]+([\s\S]*?)```[ \t]*$/;

function preBlock(body: string, lang?: string): Block {
  return { kind: "pre", ...(lang ? { lang } : {}), spans: [{ t: body, c: true }] };
}

/** Interpreta o texto de uma nota: uma linha vira um bloco (exceto fences ``` … ```). */
export function parseRich(text: string): Block[] {
  const lines = text.split("\n");
  const out: Block[] = [];
  let num = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const open = FENCE_OPEN.exec(line);
    if (open) {
      const lang = open[1] || undefined;
      const body: string[] = [];
      i++;
      while (i < lines.length && !FENCE_CLOSE.test(lines[i])) {
        body.push(lines[i]);
        i++;
      }
      out.push(preBlock(body.join("\n"), lang));
      num = 0;
      continue;
    }
    const same = FENCE_SAME.exec(line);
    if (same) {
      out.push(preBlock(same[2], same[1] || undefined));
      num = 0;
      continue;
    }
    let m: RegExpExecArray | null;
    if ((m = /^(#{1,3}) (.*)$/.exec(line))) {
      num = 0;
      out.push({ kind: m[1].length === 1 ? "h1" : "h2", spans: parseInline(m[2]) });
      continue;
    }
    if ((m = /^\s*[-*] (.*)$/.exec(line))) {
      num = 0;
      out.push({ kind: "ul", spans: parseInline(m[1]) });
      continue;
    }
    if ((m = /^\s*(\d+)\. (.*)$/.exec(line))) {
      num = num ? num + 1 : Number(m[1]);
      out.push({ kind: "ol", n: num, spans: parseInline(m[2]) });
      continue;
    }
    num = 0;
    out.push({ kind: "p", spans: parseInline(line) });
  }
  return out;
}

/** O texto sem marcações (rótulos de acessibilidade, buscas). */
export function plainText(text: string): string {
  return parseRich(text)
    .map((b) => b.spans.map((s) => s.t).join(""))
    .join("\n");
}

const spanIsRich = (s: Span) => !!(s.b || s.i || s.s || s.c || s.color || s.font || s.weight);

/** Há alguma marcação além de texto corrido? */
export const isRich = (text: string) => parseRich(text).some((b) => b.kind !== "p" || b.spans.some(spanIsRich));

/** Escapa o que o analisador leria como marcação. */
export const escapeText = (s: string) =>
  s
    .replace(/[\\*~`]/g, (c) => "\\" + c)
    .replace(/\{@/g, "\\{@")
    .replace(/\{\//g, "\\{/");

/** Aplica os marcadores a um trecho já serializado, deixando espaços das pontas do lado de fora. */
export function wrapMarks(inner: string, mark: string): string {
  const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(inner)!;
  return m[2] ? `${m[1]}${mark}${m[2]}${mark}${m[3]}` : inner;
}

function styleKey(s: Span) {
  return `${s.color ?? ""}|${s.font ?? ""}|${s.weight ?? ""}`;
}

/** Junta spans vizinhos de mesmo estilo (o editor gera um por trecho digitado). */
export function mergeSpans(spans: Span[]): Span[] {
  const out: Span[] = [];
  for (const s of spans) {
    const p = out[out.length - 1];
    if (p && !!p.b === !!s.b && !!p.i === !!s.i && !!p.s === !!s.s && !!p.c === !!s.c && styleKey(p) === styleKey(s)) p.t += s.t;
    else out.push({ ...s });
  }
  return out;
}

const MARKS = [["b", "**"], ["s", "~~"], ["i", "*"], ["c", "`"]] as const;

/** Estilos viram marcadores aninhados: spans vizinhos com o mesmo estilo dividem um único par de marcadores. */
function ser(spans: Span[], k: number): string {
  if (k === MARKS.length) return spans.map((s) => escapeText(s.t)).join("");
  const [f, mark] = MARKS[k];
  let out = "";
  for (let i = 0; i < spans.length; ) {
    const on = !!spans[i][f];
    let j = i;
    while (j < spans.length && !!spans[j][f] === on) j++;
    const grp = spans.slice(i, j);
    if (!on) out += ser(grp, k + 1);
    else if (f === "c") out += wrapMarks(grp.map((s) => s.t).join(""), mark); // dentro do código nada é escapado
    else out += wrapMarks(ser(grp.map((s) => ({ ...s, [f]: false })), k + 1), mark);
    i = j;
  }
  return out;
}

function serStyled(spans: Span[]): string {
  let out = "";
  for (let i = 0; i < spans.length; ) {
    let j = i + 1;
    while (j < spans.length && styleKey(spans[i]) === styleKey(spans[j])) j++;
    const grp = spans.slice(i, j);
    const attrs = formatAttrs(grp[0]);
    const inner = ser(
      grp.map((s) => {
        const { color: _c, font: _f, weight: _w, ...rest } = s;
        return rest;
      }),
      0,
    );
    out += attrs ? `{@${attrs}}${inner}{/}` : inner;
    i = j;
  }
  return out;
}

/** Serializa blocos de volta para o texto guardado. */
export function serializeRich(blocks: Block[]): string {
  const inl = (spans: Span[]) => serStyled(mergeSpans(spans));
  return blocks
    .map((b) => {
      if (b.kind === "pre") {
        const body = b.spans.map((s) => s.t).join("");
        const lang = b.lang ?? "";
        return `\`\`\`${lang}\n${body}\n\`\`\``;
      }
      const body = inl(b.spans);
      if (b.kind === "h1") return "# " + body;
      if (b.kind === "h2") return "## " + body;
      if (b.kind === "ul") return "- " + body;
      if (b.kind === "ol") return `${b.n ?? 1}. ` + body;
      // um parágrafo que parece título, lista ou fence não pode virar um
      if (/^(#{1,3} |\s*[-*] |```)/.test(body)) return "\\" + body;
      return body.replace(/^(\s*\d+)\. /, "$1\\. ");
    })
    .join("\n");
}
