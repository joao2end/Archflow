// Trilha calma e harmônica do vídeo Logic (30 s, loop perfeito), sincronizada com a timeline de logic-video.html.
// Pad suave em dó maior (C – Am – F – G) + notas de pentatônica (dó, ré, mi, sol, lá) nos eventos. Sem ruído, sem cliques.
// Uso: node make-audio.mjs [saida.wav]   — sem dependências.
import { writeFileSync } from 'node:fs';

const SR = 44100, DUR = 30, TAIL = 4;           // TAIL: cauda dobrada sobre o início (loop)
const N = (DUR + TAIL) * SR;
const L = new Float32Array(N), R = new Float32Array(N);
const TAU = Math.PI * 2;
const mtof = m => 440 * Math.pow(2, (m - 69) / 12);
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const add = (i, v, pan) => { if (i < 0 || i >= N) return; L[i] += v * (pan <= 0 ? 1 : 1 - pan * .6); R[i] += v * (pan >= 0 ? 1 : 1 + pan * .6); };

// ease = cubic-bezier(.65,0,.35,1), igual ao vídeo
const bez = (x1, y1, x2, y2) => x => {
  if (x <= 0) return 0; if (x >= 1) return 1;
  let lo = 0, hi = 1, m = .5;
  for (let i = 0; i < 40; i++) { m = (lo + hi) / 2; const cx = 3*(1-m)*(1-m)*m*x1 + 3*(1-m)*m*m*x2 + m*m*m; cx < x ? lo = m : hi = m; }
  return 3*(1-m)*(1-m)*m*y1 + 3*(1-m)*m*m*y2 + m*m*m;
};
const ease = bez(.65, 0, .35, 1);
const at = (a, b, k) => { let lo = 0, hi = 1; for (let i = 0; i < 30; i++) { const m = (lo + hi) / 2; ease(m) < k ? lo = m : hi = m; } return a + (b - a) * lo; }; // instante em que o ease cruza k

/* nota suave: senóide + 2º harmônico fraco, ataque curto, queda longa (estilo kalimba/vibrafone macio) */
function note(t0, midi, o = {}) {
  const { vol = .07, dur = 2.4, a = .012, pan = 0, h2 = .22, h3 = .06 } = o;
  const f = mtof(midi), n = Math.floor((dur + .1) * SR), s0 = Math.floor(t0 * SR);
  for (let i = 0; i < n; i++) {
    const t = i / SR, ph = f * t;
    const env = Math.min(1, t / a) * Math.exp(-2.6 * t / dur) * clamp((dur - t) / .2 + 1);
    const v = Math.sin(TAU * ph) + h2 * Math.sin(TAU * ph * 2) * Math.exp(-4 * t) + h3 * Math.sin(TAU * ph * 3) * Math.exp(-7 * t);
    add(s0 + i, v * env * vol, pan);
  }
}
/* nota sustentada (pad): ataque e saída lentos, dois osciladores levemente desafinados e filtro passa-baixa */
function pad(t0, dur, midi, o = {}) {
  const { vol = .02, att = 2, rel = 2.2, pan = 0, tri = .35 } = o;
  const f = mtof(midi), n = Math.floor(dur * SR), s0 = Math.floor(t0 * SR);
  for (const det of [-.05, .05]) {
    const fd = f * Math.pow(2, det / 12); let ph = det > 0 ? .3 : 0, y = 0;
    for (let i = 0; i < n; i++) {
      const t = i / SR; ph += fd / SR;
      const env = Math.min(1, t / att) * Math.min(1, (dur - t) / rel);
      const w = Math.sin(TAU * ph) * (1 - tri) + (4 * Math.abs(ph - Math.floor(ph) - .5) - 1) * tri;
      y += .09 * (w - y);
      add(s0 + i, y * Math.max(0, env) ** 1.5 * vol, pan);
    }
  }
}
const chord = (t0, dur, notes, o = {}) => notes.forEach((m, k) => pad(t0, dur, m, { ...o, pan: (k - (notes.length - 1) / 2) * .22 }));

/* ===== cama harmônica: C – Am – F – G, 7,5 s cada, com sobreposição suave ===== */
const PROG = [[36, 48, 55, 64, 71], [33, 45, 52, 60, 67], [29, 41, 48, 57, 64], [31, 43, 50, 59, 64]]; // Cmaj7, Am7, Fmaj9, G6
PROG.forEach((c, i) => {
  const t0 = i * 7.5 - 1.2, dur = 10.2;
  chord(t0, dur, c, { vol: i === 3 ? .017 : .02 });
});
// sub grave bem baixo, só para dar corpo
[[36, 0], [33, 7.5], [29, 15], [31, 22.5]].forEach(([m, t]) => pad(t - 1, 9.5, m, { vol: .022, att: 2.4, rel: 2.4, tri: 0 }));

/* ===== notas (pentatônica de dó): C D E G A = 0 2 4 7 9 ===== */
const C5 = 72, D5 = 74, E5 = 76, G5 = 79, A5 = 81, C6 = 84, E6 = 88, G6 = 91, A4 = 69, G4 = 67, E4 = 64, C4 = 60;

// 00–05 · abertura
note(0.45, C5, { vol: .045, dur: 3 }); note(1.0, G5, { vol: .035, dur: 3, pan: .2 });            // a linha se desenha
note(2.0, E5, { vol: .06, dur: 3.2, pan: -.2 });                                                // START nasce
note(2.5, C6, { vol: .035, dur: 3.2, pan: .25 });
// 05–15 · morphing
note(5.9, C5, { vol: .04, dur: 2.6 }); note(6.3, E5, { vol: .035, dur: 2.6, pan: .2 });          // valor entra (9,50)
note(7.3, G5, { vol: .06, dur: 3, pan: .1 });                                                   // IF nasce
[7.2, 7.4, 7.6].forEach((t, i) => note(t + .15, [E5, G5, A5][i], { vol: .04, dur: 2.4, pan: .4 - i * .3 })); // dados deslizam
note(9.5, D5, { vol: .04, dur: 2.2, pan: -.3 });                                                // "não" some
note(10.3, A5, { vol: .06, dur: 3, pan: -.1 });                                                 // RULE nasce
[C5, E5, G5, A5, C6].forEach((m, i) => note(at(11.2, 12.6, (i + .5) / 5), m, { vol: .04, dur: 2.2, pan: -.4 + i * .2 })); // 9,50 → 10,67
note(14.0, G5, { vol: .06, dur: 3.2 }); note(14.0, E5, { vol: .04, dur: 3.2, pan: .3 });          // END nasce
// 15–24 · o momento ✔
note(15.7, C6, { vol: .055, dur: 3, pan: .2 });                                                  // CASE nasce
chord(16.4, 2.2, [55, 62, 67], { vol: .012, att: .9, rel: .9 });                                // valores se aproximam
note(17.95, C6, { vol: .075, dur: 4.2 }); note(18.0, E6, { vol: .06, dur: 4.2, pan: .2 }); note(18.05, G6, { vol: .05, dur: 4.2, pan: -.2 }); // ✔ confere
[C5, D5, E5, G5, A5].forEach((m, i) => note(at(19.1, 20.7, i / 4) + .05, m, { vol: .042, dur: 2.2, pan: -.5 + i * .25 })); // luz percorre o fluxo
note(21.1, A4, { vol: .06, dur: 3, pan: -.1 }); note(21.45, G4, { vol: .05, dur: 3.2, pan: .1 }); // ✕ diverge: dois tons que descem, suaves
// 24–30 · CTA
[C5, D5, E5, G5, A5, C6, D5 + 12, E5 + 12, G5 + 12, A5 + 12, C6 + 12].forEach((m, i) => note(24.1 + i * .11, m, { vol: .03, dur: 2.2, pan: -.6 + i * .12 })); // paleta
chord(25.9, 3.6, [48, 55, 64, 67, 72], { vol: .022, att: .8, rel: 1.8 });                       // lockup: dó maior aberto
note(26.0, E6, { vol: .04, dur: 3.4, pan: .2 }); note(26.1, C6, { vol: .04, dur: 3.4, pan: -.2 });

/* ===== mix: reverb ampla e suave, loop (dobra a cauda), normalização ===== */
function reverb(buf, mix, seed) {
  const out = new Float32Array(N), dl = [.0297, .0371, .0411, .0437, .0533, .0679, .0793].map(d => Math.floor((d + seed) * SR)), g = .76;
  for (const d of dl) { const line = new Float32Array(N); let lp = 0;
    for (let i = d; i < N; i++) { lp += .35 * (buf[i - d] + g * line[i - d] - lp); line[i] = lp; }
    for (let i = 0; i < N; i++) out[i] += line[i] * mix / dl.length; }
  for (let i = 0; i < N; i++) buf[i] += out[i];
}
reverb(L, 2.2, 0); reverb(R, 2.2, .0043);
const M = DUR * SR;
for (let i = 0; i < TAIL * SR; i++) { L[i] += L[M + i]; R[i] += R[M + i]; }
let peak = 0; for (let i = 0; i < M; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
const gain = .55 / peak;
const out = Buffer.alloc(44 + M * 4);
out.write('RIFF', 0); out.writeUInt32LE(36 + M * 4, 4); out.write('WAVEfmt ', 8); out.writeUInt32LE(16, 16);
out.writeUInt16LE(1, 20); out.writeUInt16LE(2, 22); out.writeUInt32LE(SR, 24); out.writeUInt32LE(SR * 4, 28);
out.writeUInt16LE(4, 32); out.writeUInt16LE(16, 34); out.write('data', 36); out.writeUInt32LE(M * 4, 40);
for (let i = 0; i < M; i++) {
  out.writeInt16LE(Math.round(Math.tanh(L[i] * gain) * 32000), 44 + i * 4);
  out.writeInt16LE(Math.round(Math.tanh(R[i] * gain) * 32000), 46 + i * 4);
}
writeFileSync(process.argv[2] || 'logic-audio.wav', out);
console.log('ok', (M / SR).toFixed(1) + 's', 'pico antes do ganho', peak.toFixed(3));
