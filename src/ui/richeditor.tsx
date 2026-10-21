import { useEffect, useRef, type CSSProperties } from "react";
import { nearestRichSize, NOTE_FILLS, RICH_FONTS, RICH_SIZES, type RichFont } from "../shared/richtext";
import { ColorPicker } from "./colorpicker";
import { INK_COLORS } from "./ink";
import { renderMarkdown } from "./markdown";
import { beginTyping, endTyping } from "./store";

/** Estilo do card inteiro: guardado no elemento, nunca como marcação dentro do markdown. */
export type NoteCardStyle = { fontSize?: number; fill?: string; color?: string; font?: RichFont };

/** Mesmo pipeline das notas: markdown cru → HTML com realce de código. */
export const richToHtml = renderMarkdown;

/** Ícone “A” com sublinhado — cor do texto. */
function RtTextIco() {
  return (
    <svg className="rt-ico-svg" width="14" height="14" viewBox="0 0 16 16" aria-hidden>
      <path d="M4.2 11.2 8 3l3.8 8.2M5.4 8.4h5.2" fill="none" stroke="currentColor" strokeWidth="1.55" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M3 13.6h10" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" opacity="0.85" />
    </svg>
  );
}

/** Ícone de cartão preenchido — fundo do card. */
function RtFillIco() {
  return (
    <svg className="rt-ico-svg" width="14" height="14" viewBox="0 0 16 16" aria-hidden>
      <rect x="2.2" y="2.2" width="11.6" height="11.6" rx="2.6" fill="currentColor" opacity="0.2" stroke="currentColor" strokeWidth="1.5" />
      <path d="M4.2 12.2h7.6V8.4a2.2 2.2 0 0 0-4.1-1.1" fill="currentColor" opacity="0.55" />
    </svg>
  );
}

/* ───────── edição do markdown cru no textarea ───────── */

type Ta = HTMLTextAreaElement;

/** Troca [start, end) por `text` mantendo o desfazer nativo do textarea, e seleciona [selStart, selEnd). */
function replaceRange(el: Ta, start: number, end: number, text: string, selStart: number, selEnd: number) {
  el.focus();
  el.setSelectionRange(start, end);
  if (!document.execCommand("insertText", false, text)) {
    el.setRangeText(text, start, end, "end");
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }
  el.setSelectionRange(selStart, selEnd);
}

/** Insere um bloco no cursor, em linha própria (com o desfazer nativo do textarea). */
export function insertBlock(el: Ta, text: string) {
  const { selectionStart: s, selectionEnd: e, value: v } = el;
  const lead = s === 0 ? "" : v.slice(0, s).endsWith("\n\n") ? "" : v.slice(0, s).endsWith("\n") ? "\n" : "\n\n";
  const ins = lead + text;
  replaceRange(el, s, e, ins, s + ins.length, s + ins.length);
}

/** Envolve a seleção com marcadores (ou os remove, se já estiverem em volta). */
function wrap(el: Ta, before: string, after = before, placeholder = "texto") {
  const { selectionStart: s, selectionEnd: e, value: v } = el;
  if (v.slice(s - before.length, s) === before && v.slice(e, e + after.length) === after) {
    replaceRange(el, s - before.length, e + after.length, v.slice(s, e), s - before.length, e - before.length);
    return;
  }
  const inner = v.slice(s, e) || placeholder;
  replaceRange(el, s, e, before + inner + after, s + before.length, s + before.length + inner.length);
}

/** Alterna um prefixo de linha (título, lista, citação) em todas as linhas tocadas pela seleção. */
function linePrefix(el: Ta, prefix: string | ((i: number) => string), strip: RegExp) {
  const { selectionStart: s, selectionEnd: e, value: v } = el;
  const ls = v.lastIndexOf("\n", s - 1) + 1;
  const le = v.indexOf("\n", e) < 0 ? v.length : v.indexOf("\n", e);
  const lines = v.slice(ls, le).split("\n");
  const pre = (i: number) => (typeof prefix === "string" ? prefix : prefix(i));
  const all = lines.every((l, i) => l.startsWith(pre(i)));
  const out = lines.map((l, i) => (all ? l.slice(pre(i).length) : pre(i) + l.replace(strip, ""))).join("\n");
  replaceRange(el, ls, le, out, ls, ls + out.length);
}

function codeBlock(el: Ta) {
  const { selectionStart: s, selectionEnd: e, value: v } = el;
  const body = v.slice(s, e) || "código";
  const lead = s > 0 && v[s - 1] !== "\n" ? "\n" : "";
  const open = `${lead}\`\`\`\n`;
  replaceRange(el, s, e, `${open}${body}\n\`\`\``, s + open.length, s + open.length + body.length);
}

function link(el: Ta) {
  const { selectionStart: s, selectionEnd: e, value: v } = el;
  const label = v.slice(s, e) || "link";
  const text = `[${label}](https://)`;
  replaceRange(el, s, e, text, s + label.length + 3, s + text.length - 1);
}

/** Tira do texto as marcas `{@…}` / `{/}` do formato antigo (cor/fonte/peso por trecho). */
function clearLegacyStyle(el: Ta) {
  const v = el.value;
  const out = v.replace(/\{@[^}\n]*\}|\{\/\}/g, "");
  if (out !== v) replaceRange(el, 0, v.length, out, 0, 0);
}

const HEADING = /^#{1,6}\s+/;
const LISTED = /^(\s*)([-*+]\s+(\[[ xX]\]\s+)?|\d+[.)]\s+|>\s?)/;

type Tool = { id: string; label: string; tip: string; run: (el: Ta) => void; compact?: boolean };

const TOOLS: Tool[] = [
  { id: "b", label: "B", tip: "Negrito (Ctrl+B)", run: (el) => wrap(el, "**"), compact: true },
  { id: "i", label: "I", tip: "Itálico (Ctrl+I)", run: (el) => wrap(el, "*"), compact: true },
  { id: "s", label: "S", tip: "Riscado", run: (el) => wrap(el, "~~"), compact: true },
  { id: "c", label: "</>", tip: "Código (Ctrl+E)", run: (el) => wrap(el, "`", "`", "código"), compact: true },
  { id: "pre", label: "{ }", tip: "Bloco de código", run: codeBlock, compact: true },
  { id: "h1", label: "H1", tip: "Título", run: (el) => linePrefix(el, "# ", HEADING), compact: true },
  { id: "h2", label: "H2", tip: "Subtítulo", run: (el) => linePrefix(el, "## ", HEADING) },
  { id: "ul", label: "•", tip: "Lista com marcadores", run: (el) => linePrefix(el, "- ", LISTED), compact: true },
  { id: "ol", label: "1.", tip: "Lista numerada", run: (el) => linePrefix(el, (i) => `${i + 1}. `, LISTED) },
  { id: "task", label: "☐", tip: "Checklist", run: (el) => linePrefix(el, "- [ ] ", LISTED), compact: true },
  { id: "q", label: "❝", tip: "Citação", run: (el) => linePrefix(el, "> ", LISTED) },
  { id: "a", label: "🔗", tip: "Link (Ctrl+K)", run: link, compact: true },
];

/** Barra de formatação: insere a sintaxe markdown na seleção. Os botões não roubam o foco (mousedown cancelado). */
export function RichToolbar({
  root,
  className,
  style,
  compact,
  noteCard,
  onNoteCard,
  showFill = true,
  plain,
}: {
  root: React.RefObject<Ta | null>;
  className?: string;
  style?: CSSProperties;
  /** menos botões — cabe acima do card */
  compact?: boolean;
  /** só markdown padrão, sem os controles do card (ex.: SKILL.md) */
  plain?: boolean;
  /** tamanho, fonte, cor do texto e fundo do card da nota: ficam no elemento, fora do markdown */
  noteCard?: NoteCardStyle;
  onNoteCard?: (patch: NoteCardStyle) => void;
  /** cor de fundo do card (desligado na apresentação, onde não há card) */
  showFill?: boolean;
}) {
  const tools = compact ? TOOLS.filter((t) => t.compact) : TOOLS;
  const sizePx = nearestRichSize(noteCard?.fontSize ?? 16).px;
  const fill = noteCard?.fill;
  const color = noteCard?.color;
  const card = !plain && onNoteCard;
  const run = (fn: (el: Ta) => void) => {
    const el = root.current;
    if (el) fn(el);
  };
  const keep = (e: React.MouseEvent) => e.preventDefault();

  return (
    <div className={`rich-toolbar stacked${className ? " " + className : ""}${compact ? " compact" : ""}`} style={style} role="toolbar" aria-label="Formatação markdown" onPointerDown={(e) => e.stopPropagation()}>
      <div className="rt-row">
        {tools.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`rt-${t.id}`}
            aria-label={t.tip}
            data-tip={t.tip}
            data-tip-pos="top"
            onMouseDown={(e) => {
              keep(e);
              run(t.run);
            }}
          >
            {t.label}
          </button>
        ))}
        {card && (
          <>
            <span className="rt-sep" aria-hidden />
            <select
              className="rt-select"
              aria-label="Fonte do card"
              data-tip="Fonte do card"
              data-tip-pos="top"
              value={noteCard?.font ?? "sans"}
              onMouseDown={(e) => e.stopPropagation()}
              onChange={(e) => {
                const v = e.target.value as RichFont;
                card({ font: v === "sans" ? undefined : v });
                root.current?.focus();
              }}
            >
              {RICH_FONTS.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
            <select
              className="rt-select rt-size"
              aria-label="Tamanho"
              data-tip="Tamanho da fonte"
              data-tip-pos="top"
              value={sizePx}
              onMouseDown={(e) => e.stopPropagation()}
              onChange={(e) => {
                card({ fontSize: e.target.value ? Number(e.target.value) : undefined });
                root.current?.focus();
              }}
            >
              {RICH_SIZES.map((s) => (
                <option key={s.id} value={s.px}>
                  {s.id}
                </option>
              ))}
            </select>
          </>
        )}
      </div>
      {card && (
        <div className="rt-row">
          <span className="rt-ico" aria-hidden data-tip="Cor do texto" data-tip-pos="top">
            <RtTextIco />
          </span>
          <div className="rt-colors" role="group" aria-label="Cor do texto">
            <button
              type="button"
              className={`rt-swatch auto${!color ? " on" : ""}`}
              aria-label="Cor padrão do texto"
              data-tip="Cor padrão"
              data-tip-pos="top"
              onMouseDown={(e) => {
                keep(e);
                card({ color: undefined });
                run(clearLegacyStyle);
              }}
            />
            {INK_COLORS.map((c) => (
              <button
                key={c.id}
                type="button"
                className={`rt-swatch${color === c.id ? " on" : ""}`}
                style={{ background: c.id }}
                aria-label={c.name}
                data-tip={c.name}
                data-tip-pos="top"
                onMouseDown={(e) => {
                  keep(e);
                  card({ color: c.id });
                }}
              />
            ))}
            <ColorPicker
              value={color ?? "#706fd3"}
              swatchColor={color && !INK_COLORS.some((c) => c.id === color) ? color : undefined}
              label="Cor do texto"
              onChange={(hex) => card({ color: hex.toLowerCase() })}
            />
          </div>
          {showFill && (
            <>
              <span className="rt-sep" aria-hidden />
              <span className="rt-ico" aria-hidden data-tip="Fundo do card" data-tip-pos="top">
                <RtFillIco />
              </span>
              <div className="rt-colors rt-fills" role="group" aria-label="Cor de fundo do card">
                <button
                  type="button"
                  className={`rt-swatch fill-auto${!fill ? " on" : ""}`}
                  aria-label="Fundo padrão"
                  data-tip="Fundo do card"
                  data-tip-pos="top"
                  onMouseDown={(e) => {
                    keep(e);
                    card({ fill: undefined });
                  }}
                />
                {NOTE_FILLS.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    className={`rt-swatch${fill === c.id ? " on" : ""}`}
                    style={{ background: c.id }}
                    aria-label={`Fundo ${c.name}`}
                    data-tip={`Fundo · ${c.name}`}
                    data-tip-pos="top"
                    onMouseDown={(e) => {
                      keep(e);
                      card({ fill: c.id });
                    }}
                  />
                ))}
                <ColorPicker
                  value={fill ?? "#ffeeba"}
                  swatchColor={fill && !NOTE_FILLS.some((c) => c.id === fill) ? fill : undefined}
                  label="Fundo do card"
                  onChange={(hex) => card({ fill: hex })}
                />
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/* ───────── editor ───────── */

/** Dentro de um bloco ``` aberto antes do cursor? */
const inFence = (v: string, at: number) => (v.slice(0, at).match(/^```/gm)?.length ?? 0) % 2 === 1;

/** Enter numa linha de lista/citação continua o marcador; numa linha só com o marcador, encerra a lista. */
function continueList(el: Ta): boolean {
  const { selectionStart: s, selectionEnd: e, value: v } = el;
  if (s !== e || inFence(v, s)) return false;
  const ls = v.lastIndexOf("\n", s - 1) + 1;
  const line = v.slice(ls, s);
  const m = /^(\s*)([-*+] \[[ xX]\] |[-*+] |(\d+)([.)]) |> )/.exec(line);
  if (!m) return false;
  if (line.length === m[0].length) {
    replaceRange(el, ls, s, "", ls, ls);
    return true;
  }
  const next = m[3] ? `${Number(m[3]) + 1}${m[4]} ` : m[2].replace(/\[[xX]\]/, "[ ]");
  const ins = `\n${m[1]}${next}`;
  replaceRange(el, s, s, ins, s + ins.length, s + ins.length);
  return true;
}

/** Editor de markdown cru (como as notas do n8n): o texto é guardado exatamente como digitado. */
export function RichEditor({
  value,
  onChange,
  onClose,
  innerRef,
  className,
  style,
  autoFocus,
  placeholder,
  label,
}: {
  value: string;
  onChange: (text: string) => void;
  /** Esc ou perda de foco */
  onClose?: () => void;
  innerRef?: React.RefObject<Ta | null>;
  className?: string;
  style?: CSSProperties;
  /** foca ao montar e seleciona tudo (texto padrão de uma nota recém-criada) */
  autoFocus?: boolean;
  placeholder?: string;
  label?: string;
}) {
  const own = useRef<Ta>(null);
  const ref = innerRef ?? own;

  useEffect(() => {
    const el = ref.current;
    if (!el || !autoFocus) return;
    el.focus();
    el.select();
  }, [autoFocus, ref]);

  return (
    <textarea
      ref={ref}
      className={`rich-editor md-src${className ? " " + className : ""}`}
      style={style}
      value={value}
      aria-label={label}
      placeholder={placeholder}
      spellCheck={false}
      onChange={(e) => onChange(e.target.value)}
      onFocus={beginTyping}
      onBlur={() => {
        endTyping();
        // barra e seletor de cor ficam fora do textarea — não fecha se o foco foi pra lá
        requestAnimationFrame(() => {
          const a = document.activeElement;
          if (a === ref.current || a?.closest(".rich-toolbar") || a?.closest(".cpick-pop")) {
            if (a !== ref.current) beginTyping();
            return;
          }
          onClose?.();
        });
      }}
      onKeyDown={(e) => {
        e.stopPropagation(); // Del, setas e letras são do texto, não atalhos do quadro
        const el = e.currentTarget;
        const mod = e.ctrlKey || e.metaKey;
        if (e.key === "Escape") {
          e.preventDefault();
          el.blur();
        } else if (mod && !e.shiftKey && !e.altKey && (e.key === "b" || e.key === "i" || e.key === "e" || e.key === "k")) {
          e.preventDefault();
          if (e.key === "b") wrap(el, "**");
          else if (e.key === "i") wrap(el, "*");
          else if (e.key === "e") wrap(el, "`", "`", "código");
          else link(el);
        } else if (e.key === "Tab" && !mod) {
          e.preventDefault();
          const { selectionStart: s, selectionEnd: end } = el;
          replaceRange(el, s, end, "  ", s + 2, s + 2);
        } else if (e.key === "Enter" && !e.shiftKey && !mod && continueList(el)) e.preventDefault();
      }}
    />
  );
}

/* ───────── campo do inspetor ───────── */

/** Campo "Texto" do inspetor: barra de formatação + markdown cru, gravando ao vivo. */
export function RichField({ value, onChange, label }: { value: string; onChange: (text: string) => void; label?: string }) {
  const ref = useRef<Ta>(null);
  return (
    <div className="rich-field" id="insp-first">
      <RichToolbar root={ref} />
      <RichEditor innerRef={ref} value={value} onChange={onChange} className="input" label={label} placeholder="Escreva em markdown…" />
    </div>
  );
}
