import { brainColor, reshapeBrain } from "../shared/brainstorm";
import { BRAIN_COLORS, BRAIN_LINE_KEYS, BRAIN_LINES, BRAIN_SHAPE_KEYS, BRAIN_SHAPES, type BrainConnSpec, type BrainLine, type BrainNodeSpec, type BrainShape, type ConnectionEl, type NodeEl } from "../shared/schema";

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
  /** passo numerado: o círculo do número */
  num?: { cx: number; cy: number; r: number };
}

const f = (v: number) => Math.round(v * 10) / 10;

/** Contorno de cada forma para a caixa w × h; o texto vai no retângulo `text`. */
export function brainGeometry(shape: BrainShape, w: number, h: number): BrainGeometry {
  const full = { x: 10, y: 6, w: w - 20, h: h - 12 };
  switch (shape) {
    case "box":
      return { body: `M10 0H${f(w - 10)}A10 10 0 0 1 ${w} 10V${f(h - 10)}A10 10 0 0 1 ${f(w - 10)} ${h}H10A10 10 0 0 1 0 ${f(h - 10)}V10A10 10 0 0 1 10 0Z`, text: full };
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
    case "step": {
      // o círculo do número não cresce além de ~64 px: o espaço que sobra é do texto
      const r = Math.max(8, Math.min(h / 2 - 2, w * 0.3, 32));
      return { body: "", num: { cx: r + 2, cy: h / 2, r }, text: { x: r * 2 + 14, y: 4, w: w - r * 2 - 16, h: h - 8, align: "left" } };
    }
  }
}

/** Linhas do texto da forma (nome e, se couber, a descrição), quebradas na largura disponível. */
export function brainText(label: string, description: string | undefined, box: { w: number; h: number }, wrap: (t: string, chars: number, lines: number) => string[]) {
  const maxLines = Math.max(1, Math.floor(box.h / 18));
  const main = label.trim() ? wrap(label, Math.max(3, Math.floor(box.w / 7.8)), Math.min(4, maxLines)) : [];
  const room = maxLines - main.length;
  const desc = description?.trim() && room > 0 ? wrap(description, Math.max(3, Math.floor(box.w / 6.4)), Math.min(2, room)) : [];
  return { main, desc };
}

/* ───────── Inspetor: forma, cor e número do passo ───────── */

/** Miniatura da forma (botões do Inspetor). */
export function BrainMini({ shape, color }: { shape: BrainShape; color: string }) {
  const g = brainGeometry(shape, shape === "step" ? 22 : 30, 22);
  return (
    <svg viewBox="-2 -2 34 26" aria-hidden="true" style={{ ["--bc" as string]: color }}>
      {g.body && <path d={g.body} fill={`color-mix(in srgb, ${color} 14%, transparent)`} stroke={color} strokeWidth={1.6} strokeLinejoin="round" />}
      {g.extra && <path d={g.extra} fill={`color-mix(in srgb, ${color} 14%, transparent)`} stroke={color} strokeWidth={1.6} />}
      {g.detail && <path d={g.detail} fill="none" stroke={color} strokeWidth={1.6} />}
      {g.fold && <path d={g.fold} fill={color} opacity={0.5} />}
      {g.num && (
        <>
          <circle cx={g.num.cx} cy={g.num.cy} r={g.num.r} fill={color} />
          <text x={g.num.cx} y={g.num.cy + 4} textAnchor="middle" fontSize={11} fontWeight={700} fill="#fff">
            1
          </text>
        </>
      )}
    </svg>
  );
}

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

export function BrainFields({ node, patch }: { node: NodeEl; patch: Patch }) {
  const brain = node.brain!;
  const color = brainColor(brain);
  const set = (b: BrainNodeSpec) => patch({ brain: b });
  return (
    <>
      <div className="field">
        <span>Forma</span>
        <div className="brain-shapes" role="radiogroup" aria-label="Forma">
          {BRAIN_SHAPE_KEYS.map((s) => (
            <button
              key={s}
              type="button"
              role="radio"
              aria-checked={brain.shape === s}
              className={brain.shape === s ? "active" : ""}
              onClick={() => {
                if (s === brain.shape) return;
                // o nome padrão da forma acompanha a troca; um texto escrito à mão fica
                const auto = node.label === BRAIN_SHAPES[brain.shape].label || /^Passo \d+$/.test(node.label);
                patch({ brain: reshapeBrain(brain, s), ...(auto ? { label: s === "step" ? `Passo ${brain.step ?? 1}` : BRAIN_SHAPES[s].label } : {}) });
              }}
              data-tip={BRAIN_SHAPES[s].hint}
              data-tip-pos="left"
            >
              <BrainMini shape={s} color={brain.shape === s ? color : "var(--ink-2)"} />
              {BRAIN_SHAPES[s].label.split(" /")[0]}
            </button>
          ))}
        </div>
      </div>
      <div className="callout">{BRAIN_SHAPES[brain.shape].hint}</div>
      {brain.shape === "step" && (
        <label className="field">
          <span>Número do passo</span>
          <input className="input mono" type="number" min={0} max={999} step={1} value={brain.step ?? 1} onChange={(e) => set({ ...brain, step: Math.max(0, Math.min(999, Math.floor(Number(e.target.value) || 0))) })} />
        </label>
      )}
      <Swatches label="Cor" value={brain.color} fallback={BRAIN_SHAPES[brain.shape].color} onPick={(c) => set({ shape: brain.shape, ...(brain.step != null ? { step: brain.step } : {}), ...(c ? { color: c } : {}) })} />
    </>
  );
}

/* ───────── Inspetor: estilo do traço ───────── */

export const BRAIN_LINE_INK = "#55606e";

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
            const c = b.line === l ? b.color ?? "var(--ink)" : "var(--ink-2)";
            return (
              <button key={l} type="button" role="radio" aria-checked={b.line === l} className={b.line === l ? "active" : ""} onClick={() => set({ ...b, line: l })} data-tip={ln.hint} data-tip-pos="left">
                <svg viewBox="0 0 34 22" aria-hidden="true">
                  <path d="M5 11H29" stroke={c} strokeWidth={2} strokeDasharray={ln.dash ? (l === "dotted" ? "1.5 4" : "5 4") : undefined} strokeLinecap="round" fill="none" />
                  {ln.head && <path d="M24 6.5L30 11L24 15.5z" fill={c} />}
                  {ln.tail && <path d="M10 6.5L4 11L10 15.5z" fill={c} />}
                </svg>
                {ln.label}
              </button>
            );
          })}
        </div>
      </div>
      <Swatches label="Cor do traço" value={b.color} fallback={BRAIN_LINE_INK} onPick={(c) => set({ line: b.line, ...(c ? { color: c } : {}) })} />
    </>
  );
}
