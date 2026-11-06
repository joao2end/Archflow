import { useEffect, useState } from "react";
import { brainColor, brainMood, isImageSrc, reshapeBrain } from "../shared/brainstorm";
import { BRAIN_COLORS, BRAIN_GROUPS, BRAIN_LINE_KEYS, BRAIN_LINES, BRAIN_MOOD_KEYS, BRAIN_MOODS, BRAIN_SHAPE_KEYS, BRAIN_SHAPES, brainGroup, type BrainConnSpec, type BrainLine, type BrainMood, type BrainNodeSpec, type BrainShape, type ConnectionEl, type NodeEl } from "../shared/schema";
import { Glyph } from "./icons";

type Patch = (p: Record<string, unknown>) => void;

/* ───────── geometria das formas (coordenadas locais: 0..w × 0..h) ───────── */

export interface BrainGeometry {
  /** contorno principal (preenchido e com traço) */
  body: string;
  /** partes extras preenchidas como o corpo (cabeça da pessoa) */
  extra?: string;
  /** só traço (a borda de cima do cilindro) */
  detail?: string;
  /** dobra do post-it */
  fold?: string;
  /** onde o texto cabe */
  text: { x: number; y: number; w: number; h: number; align?: "left" };
  /** passo numerado / custo: o círculo cheio com o número ou o símbolo */
  num?: { cx: number; cy: number; r: number; text?: string };
  /** selo pequeno na cor da forma (?, !, +, −) */
  badge?: { cx: number; cy: number; r: number; text: string };
  /** imagem: onde a foto é desenhada */
  photo?: { x: number; y: number; w: number; h: number };
}

const f = (v: number) => Math.round(v * 10) / 10;

/** Contorno de cada forma para a caixa w × h; o texto vai no retângulo `text`. */
export function brainGeometry(shape: BrainShape, w: number, h: number, mood: BrainMood = "sad"): BrainGeometry {
  const full = { x: 10, y: 6, w: w - 20, h: h - 12 };
  const box = `M10 0H${f(w - 10)}A10 10 0 0 1 ${w} 10V${f(h - 10)}A10 10 0 0 1 ${f(w - 10)} ${h}H10A10 10 0 0 1 0 ${f(h - 10)}V10A10 10 0 0 1 10 0Z`;
  // ícone redondo à esquerda e o texto ao lado (passo, meta, prazo, custo); o ícone não cresce além de ~64 px
  const r = Math.max(8, Math.min(h / 2 - 2, w * 0.3, 32));
  const icon = { cx: r + 2, cy: h / 2, r };
  const beside = { x: r * 2 + 14, y: 4, w: w - r * 2 - 16, h: h - 8, align: "left" as const };
  // selo à esquerda dentro de uma caixa (dúvida, prós e contras)
  const br = Math.max(8, Math.min(12, h / 2 - 6));
  const badged = (text: string): BrainGeometry => ({ body: box, badge: { cx: br + 9, cy: h / 2, r: br, text }, text: { x: br * 2 + 16, y: 4, w: w - br * 2 - 24, h: h - 8, align: "left" } });
  switch (shape) {
    case "box":
      return { body: box, text: full };
    case "round": {
      const r = Math.min(h, w) / 2;
      return { body: `M${f(r)} 0H${f(w - r)}A${f(r)} ${f(r)} 0 0 1 ${f(w - r)} ${h}H${f(r)}A${f(r)} ${f(r)} 0 0 1 ${f(r)} 0Z`, text: { x: r * 0.6, y: 4, w: w - r * 1.2, h: h - 8 } };
    }
    case "circle":
      return { body: `M0 ${f(h / 2)}A${f(w / 2)} ${f(h / 2)} 0 1 1 ${w} ${f(h / 2)}A${f(w / 2)} ${f(h / 2)} 0 1 1 0 ${f(h / 2)}Z`, text: { x: w * 0.15, y: h * 0.15, w: w * 0.7, h: h * 0.7 } };
    case "diamond":
      return { body: `M${f(w / 2)} 0L${w} ${f(h / 2)}L${f(w / 2)} ${h}L0 ${f(h / 2)}Z`, text: { x: w * 0.2, y: h * 0.22, w: w * 0.6, h: h * 0.56 } };
    case "sticky": {
      const k = Math.min(22, w * 0.18, h * 0.18);
      return {
        body: `M0 0H${w}V${f(h - k)}L${f(w - k)} ${h}H0Z`,
        fold: `M${f(w - k)} ${h}L${f(w - k)} ${f(h - k)}L${w} ${f(h - k)}Z`,
        text: { x: 12, y: 10, w: w - 24, h: h - 20 - k / 2 },
      };
    }
    case "cloud": {
      const P = (x: number, y: number) => `${f(x * w)} ${f(y * h)}`;
      return {
        body: `M${P(0.25, 0.9)}C${P(0.06, 0.9)} ${P(0.0, 0.68)} ${P(0.13, 0.57)}C${P(0.03, 0.4)} ${P(0.16, 0.2)} ${P(0.33, 0.27)}C${P(0.37, 0.06)} ${P(0.63, 0.02)} ${P(0.7, 0.21)}C${P(0.85, 0.12)} ${P(1.0, 0.3)} ${P(0.92, 0.48)}C${P(1.03, 0.62)} ${P(0.95, 0.9)} ${P(0.76, 0.88)}C${P(0.68, 0.99)} ${P(0.4, 0.99)} ${P(0.25, 0.9)}Z`,
        text: { x: w * 0.17, y: h * 0.3, w: w * 0.66, h: h * 0.56 },
      };
    }
    case "person": {
      const fig = Math.max(40, h - 36); // a figura ocupa o alto; o nome vai embaixo
      const r = Math.min(w * 0.2, fig * 0.22);
      const cx = w / 2;
      const s = Math.min(w * 0.42, fig * 0.42); // meia largura dos ombros
      const fb = fig;
      const top = r * 2 + 6;
      return {
        extra: `M${f(cx - r)} ${f(r + 2)}A${f(r)} ${f(r)} 0 1 1 ${f(cx + r)} ${f(r + 2)}A${f(r)} ${f(r)} 0 1 1 ${f(cx - r)} ${f(r + 2)}Z`,
        body: `M${f(cx - s)} ${f(fb)}V${f(Math.max(top + s * 0.6, fb - 4))}A${f(s)} ${f(Math.max(4, fb - top))} 0 0 1 ${f(cx + s)} ${f(Math.max(top + s * 0.6, fb - 4))}V${f(fb)}Z`,
        text: { x: 0, y: fb + 2, w, h: h - fb - 2 },
      };
    }
    case "doc": {
      const wv = Math.min(14, h * 0.16);
      return { body: `M0 0H${w}V${f(h - wv)}C${f(w * 0.75)} ${f(h - wv * 2.4)} ${f(w * 0.3)} ${f(h + wv * 0.6)} 0 ${f(h - wv)}Z`, text: { x: 12, y: 6, w: w - 24, h: h - wv - 10 } };
    }
    case "data": {
      const k = Math.min(24, w * 0.15);
      return { body: `M${f(k)} 0H${w}L${f(w - k)} ${h}H0Z`, text: { x: k + 4, y: 6, w: w - 2 * k - 8, h: h - 12 } };
    }
    case "cylinder": {
      const ry = Math.min(14, h * 0.14);
      return {
        body: `M0 ${f(ry)}A${f(w / 2)} ${f(ry)} 0 0 1 ${w} ${f(ry)}V${f(h - ry)}A${f(w / 2)} ${f(ry)} 0 0 1 0 ${f(h - ry)}Z`,
        detail: `M0 ${f(ry)}A${f(w / 2)} ${f(ry)} 0 0 0 ${w} ${f(ry)}`,
        text: { x: 10, y: ry * 2 + 4, w: w - 20, h: h - ry * 3 - 8 },
      };
    }
    case "star": {
      const cx = w / 2;
      const cy = h * 0.53;
      const pts: string[] = [];
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        const k = i % 2 ? 0.48 : 1;
        pts.push(`${f(cx + Math.cos(a) * (w / 2) * k)} ${f(cy + Math.sin(a) * (h * 0.53) * k)}`);
      }
      return { body: `M${pts.join("L")}Z`, text: { x: w * 0.25, y: h * 0.36, w: w * 0.5, h: h * 0.4 } };
    }
    case "image": {
      // moldura com a foto em cima e a legenda numa faixa embaixo
      const cap = Math.min(34, h * 0.3);
      return { body: box, photo: { x: 6, y: 6, w: w - 12, h: h - cap - 6 }, text: { x: 8, y: h - cap, w: w - 16, h: cap } };
    }
    case "step":
      return { body: "", num: icon, text: beside };
    case "problem": {
      // explosão: pontas irregulares em volta do centro
      const pts: string[] = [];
      for (let i = 0; i < 24; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 12;
        const k = i % 2 ? (i % 4 === 1 ? 0.8 : 0.74) : 1;
        pts.push(`${f(w / 2 + Math.cos(a) * (w / 2) * k)} ${f(h / 2 + Math.sin(a) * (h / 2) * k)}`);
      }
      return { body: `M${pts.join("L")}Z`, text: { x: w * 0.2, y: h * 0.25, w: w * 0.6, h: h * 0.5 } };
    }
    case "warning": {
      const br2 = Math.max(7, Math.min(12, h * 0.09));
      return { body: `M${f(w / 2)} 2L${w} ${h}H0Z`, badge: { cx: w / 2, cy: h * 0.33, r: br2, text: "!" }, text: { x: w * 0.25, y: h * 0.5, w: w * 0.5, h: h * 0.46 } };
    }
    case "stop": {
      const k = Math.min(w, h) * 0.29;
      return { body: `M${f(k)} 0H${f(w - k)}L${w} ${f(k)}V${f(h - k)}L${f(w - k)} ${h}H${f(k)}L0 ${f(h - k)}V${f(k)}Z`, text: { x: 10, y: k * 0.55, w: w - 20, h: h - k * 1.1 } };
    }
    case "question":
      return badged("?");
    case "pro":
      return badged("+");
    case "con":
      return badged("−");
    case "idea": {
      const R = Math.max(10, Math.min(w / 2 - 2, (h - 24) / 1.83));
      const cx = w / 2;
      const cy = R + 1;
      const y1 = cy + R * 0.83;
      return {
        body: `M${f(cx - R * 0.55)} ${f(y1)}A${f(R)} ${f(R)} 0 1 1 ${f(cx + R * 0.55)} ${f(y1)}V${f(y1 + 9)}H${f(cx - R * 0.55)}Z`,
        detail: `M${f(cx - R * 0.42)} ${f(y1 + 15)}H${f(cx + R * 0.42)}M${f(cx - R * 0.26)} ${f(y1 + 20)}H${f(cx + R * 0.26)}`,
        text: { x: cx - R * 0.74, y: cy - R * 0.64, w: R * 1.48, h: R * 1.28 },
      };
    }
    case "target":
      return { body: circ(icon.cx, icon.cy, r), detail: `${circ(icon.cx, icon.cy, r * 0.62)}${circ(icon.cx, icon.cy, r * 0.24)}`, text: beside };
    case "clock":
      return { body: circ(icon.cx, icon.cy, r), detail: `M${f(icon.cx)} ${f(icon.cy - r * 0.62)}V${f(icon.cy)}L${f(icon.cx + r * 0.42)} ${f(icon.cy + r * 0.26)}`, text: beside };
    case "money":
      return { body: "", num: { ...icon, text: "$" }, text: beside };
    case "speech": {
      const hb = h - 16;
      return {
        body: `M14 0H${f(w - 14)}A14 14 0 0 1 ${w} 14V${f(hb - 14)}A14 14 0 0 1 ${f(w - 14)} ${f(hb)}H${f(w * 0.34)}L${f(w * 0.13)} ${h}L${f(w * 0.2)} ${f(hb)}H14A14 14 0 0 1 0 ${f(hb - 14)}V14A14 14 0 0 1 14 0Z`,
        text: { x: 12, y: 4, w: w - 24, h: hb - 8 },
      };
    }
    case "screen": {
      const hs = h - 20;
      return {
        body: `M8 0H${f(w - 8)}A8 8 0 0 1 ${w} 8V${f(hs - 8)}A8 8 0 0 1 ${f(w - 8)} ${f(hs)}H8A8 8 0 0 1 0 ${f(hs - 8)}V8A8 8 0 0 1 8 0Z`,
        detail: `M${f(w / 2)} ${f(hs)}V${f(h - 3)}M${f(w * 0.3)} ${f(h - 2)}H${f(w * 0.7)}`,
        text: { x: 10, y: 6, w: w - 20, h: hs - 12 },
      };
    }
    case "feeling": {
      const R = Math.max(10, Math.min(w / 2 - 2, (h - 28) / 2));
      const cx = w / 2;
      const cy = R + 1;
      const eyes = `M${f(cx - R * 0.34)} ${f(cy - R * 0.3)}V${f(cy - R * 0.1)}M${f(cx + R * 0.34)} ${f(cy - R * 0.3)}V${f(cy - R * 0.1)}`;
      const frown = `M${f(cx - R * 0.42)} ${f(cy + R * 0.52)}Q${f(cx)} ${f(cy + R * 0.1)} ${f(cx + R * 0.42)} ${f(cy + R * 0.52)}`;
      const mouth = {
        happy: `M${f(cx - R * 0.42)} ${f(cy + R * 0.18)}Q${f(cx)} ${f(cy + R * 0.66)} ${f(cx + R * 0.42)} ${f(cy + R * 0.18)}`,
        neutral: `M${f(cx - R * 0.36)} ${f(cy + R * 0.38)}H${f(cx + R * 0.36)}`,
        sad: frown,
        angry: `${frown}M${f(cx - R * 0.58)} ${f(cy - R * 0.5)}L${f(cx - R * 0.16)} ${f(cy - R * 0.32)}M${f(cx + R * 0.58)} ${f(cy - R * 0.5)}L${f(cx + R * 0.16)} ${f(cy - R * 0.32)}`,
      }[mood];
      return { body: circ(cx, cy, R), detail: eyes + mouth, text: { x: 0, y: R * 2 + 4, w, h: h - R * 2 - 4 } };
    }
  }
}

const circ = (cx: number, cy: number, r: number) => `M${f(cx - r)} ${f(cy)}a${f(r)} ${f(r)} 0 1 0 ${f(2 * r)} 0a${f(r)} ${f(r)} 0 1 0 ${f(-2 * r)} 0Z`;

/** Linhas do texto da forma (nome e, se couber, a descrição), quebradas na largura disponível. */
export function brainText(label: string, description: string | undefined, box: { w: number; h: number }, wrap: (t: string, chars: number, lines: number) => string[]) {
  const maxLines = Math.max(1, Math.floor(box.h / 18));
  const main = label.trim() ? wrap(label, Math.max(3, Math.floor(box.w / 7.8)), Math.min(4, maxLines)) : [];
  const room = maxLines - main.length;
  const desc = description?.trim() && room > 0 ? wrap(description, Math.max(3, Math.floor(box.w / 6.4)), Math.min(2, room)) : [];
  return { main, desc };
}

/* ───────── Inspetor: forma, cor e número do passo ───────── */

function Swatches({ value, fallback, onPick, label }: { value?: string; fallback: string; onPick: (c: string | undefined) => void; label: string }) {
  const cur = value ?? fallback;
  return (
    <div className="field">
      <span>{label}</span>
      <div className="brain-swatches" role="radiogroup" aria-label={label}>
        {BRAIN_COLORS.map((c) => (
          <button key={c.id} type="button" role="radio" aria-checked={cur.toLowerCase() === c.id} aria-label={c.name} className={`swatch ${cur.toLowerCase() === c.id ? "active" : ""}`} style={{ background: c.id }} onClick={() => onPick(c.id === fallback ? undefined : c.id)} data-tip={c.name} data-tip-pos="top" />
        ))}
      </div>
    </div>
  );
}

/** Imagem: colar uma URL ou escolher um arquivo do computador (embutido no diagrama). */
function ImageSrcField({ brain, set }: { brain: BrainNodeSpec; set: (b: BrainNodeSpec) => void }) {
  const embedded = brain.src?.startsWith("data:");
  const [draft, setDraft] = useState(embedded ? "" : brain.src ?? "");
  const [err, setErr] = useState("");
  useEffect(() => setDraft(brain.src?.startsWith("data:") ? "" : brain.src ?? ""), [brain.src]);
  const apply = (v: string) => {
    const t = v.trim();
    if (!t) return;
    if (!isImageSrc(t)) return setErr("Use uma URL http(s) de imagem");
    setErr("");
    set({ ...brain, src: t });
  };
  const pick = (f: File | undefined) => {
    if (!f) return;
    if (f.size > 8e6) return setErr("Imagem acima de 8 MB");
    const r = new FileReader();
    r.onload = () => (setErr(""), set({ ...brain, src: String(r.result) }));
    r.readAsDataURL(f);
  };
  return (
    <div className="field">
      <span>Imagem{embedded ? " (embutida no diagrama)" : ""}</span>
      <input className="input" type="url" placeholder="https://… (cole a URL e Enter)" value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={() => draft !== (brain.src ?? "") && apply(draft)} onKeyDown={(e) => e.key === "Enter" && apply(draft)} aria-invalid={!!err} />
      <input className="input" type="file" accept="image/*" aria-label="Escolher arquivo de imagem" onChange={(e) => pick(e.target.files?.[0])} />
      {err && <div className="callout">{err}</div>}
    </div>
  );
}

export function BrainFields({ node, patch }: { node: NodeEl; patch: Patch }) {
  const brain = node.brain!;
  const color = brainColor(brain);
  const set = (b: BrainNodeSpec) => patch({ brain: b });
  const pick = (s: BrainShape) => {
    if (s === brain.shape) return;
    // o nome padrão da forma acompanha a troca; um texto escrito à mão fica
    const auto = node.label === BRAIN_SHAPES[brain.shape].label || /^Passo \d+$/.test(node.label);
    patch({ brain: reshapeBrain(brain, s), ...(auto ? { label: s === "step" ? `Passo ${brain.step ?? 1}` : BRAIN_SHAPES[s].label } : {}) });
  };
  return (
    <>
      {(["process", "problem"] as const).map((g) => (
        <div className="field" key={g}>
          <span>{BRAIN_GROUPS[g].replace("Brain Storm · ", "")}</span>
          <div className="brain-shapes" role="radiogroup" aria-label={`Forma: ${BRAIN_GROUPS[g]}`}>
            {BRAIN_SHAPE_KEYS.filter((s) => brainGroup(s) === g).map((s) => (
              <button key={s} type="button" role="radio" aria-checked={brain.shape === s} className={brain.shape === s ? "active" : ""} onClick={() => pick(s)} data-tip={BRAIN_SHAPES[s].hint} data-tip-pos="left">
                <Glyph name={`bs-${s}`} size={22} style={{ color: brain.shape === s ? color : "var(--ink-2)" }} />
                {BRAIN_SHAPES[s].label.split(" /")[0]}
              </button>
            ))}
          </div>
        </div>
      ))}
      <div className="callout">{BRAIN_SHAPES[brain.shape].hint}</div>
      {brain.shape === "step" && (
        <label className="field">
          <span>Número do passo</span>
          <input className="input mono" type="number" min={0} max={999} step={1} value={brain.step ?? 1} onChange={(e) => set({ ...brain, step: Math.max(0, Math.min(999, Math.floor(Number(e.target.value) || 0))) })} />
        </label>
      )}
      {brain.shape === "feeling" && (
        <div className="field">
          <span>Rosto</span>
          <div className="seg" role="radiogroup" aria-label="Rosto">
            {BRAIN_MOOD_KEYS.map((m: BrainMood) => (
              <button key={m} type="button" role="radio" aria-checked={brainMood(brain) === m} className={brainMood(brain) === m ? "active" : ""} onClick={() => set({ ...brain, mood: m })}>
                {BRAIN_MOODS[m]}
              </button>
            ))}
          </div>
        </div>
      )}
      {brain.shape === "image" && <ImageSrcField brain={brain} set={set} />}
      <Swatches label="Cor" value={brain.color} fallback={BRAIN_SHAPES[brain.shape].color} onPick={(c) => set({ shape: brain.shape, ...(brain.step != null ? { step: brain.step } : {}), ...(brain.mood ? { mood: brain.mood } : {}), ...(brain.src ? { src: brain.src } : {}), ...(c ? { color: c } : {}) })} />
    </>
  );
}

/* ───────── Inspetor: estilo do traço ───────── */

export const BRAIN_LINE_INK = "#55606e";

/** Cor efetiva do traço: a escolhida, a do estilo (Bloqueia é vermelho) ou grafite. */
export const brainLineColor = (b: BrainConnSpec) => b.color ?? BRAIN_LINES[b.line].color ?? BRAIN_LINE_INK;

export function BrainConnFields({ conn, patch }: { conn: ConnectionEl; patch: Patch }) {
  const b: BrainConnSpec = conn.brain ?? { line: "arrow" };
  const set = (next: BrainConnSpec) => patch({ brain: next });
  return (
    <>
      <div className="field">
        <span>Traço</span>
        <div className="brain-shapes" role="radiogroup" aria-label="Traço">
          {BRAIN_LINE_KEYS.map((l: BrainLine) => {
            const ln = BRAIN_LINES[l];
            const c = b.line === l ? brainLineColor(b) : "var(--ink-2)";
            return (
              <button key={l} type="button" role="radio" aria-checked={b.line === l} className={b.line === l ? "active" : ""} onClick={() => set({ ...b, line: l })} data-tip={ln.hint} data-tip-pos="left">
                <svg viewBox="0 0 34 22" aria-hidden="true">
                  <path d={ln.bar ? "M5 11H28" : "M5 11H29"} stroke={c} strokeWidth={2} strokeDasharray={ln.dash ? (l === "dotted" ? "1.5 4" : "5 4") : undefined} strokeLinecap="round" fill="none" />
                  {ln.bar ? <path d="M29 5V17" stroke={c} strokeWidth={2.6} strokeLinecap="round" /> : ln.head && <path d="M24 6.5L30 11L24 15.5z" fill={c} />}
                  {ln.tail && <path d="M10 6.5L4 11L10 15.5z" fill={c} />}
                </svg>
                {ln.label}
              </button>
            );
          })}
        </div>
      </div>
      <Swatches label="Cor do traço" value={b.color} fallback={BRAIN_LINES[b.line].color ?? BRAIN_LINE_INK} onPick={(c) => set({ line: b.line, ...(c ? { color: c } : {}) })} />
    </>
  );
}
