import { useEffect, useRef } from "react";

/**
 * Rastro do mouse no estilo de um conector do Archflow: uma linha que afina e esmaece,
 * com pontos de "fluxo" correndo por ela, seta na ponta e um anel de porta que cresce
 * sobre elementos clicáveis. Canvas fixo, acima de tudo (z-index máximo), sem capturar eventos.
 */
const LIFE = 900; // ms de vida de cada ponto do rastro
const MAX_POINTS = 90;

const PALETTE = {
  light: ["#14a38b", "#e08a1e", "#706fd3"], // streaming → assíncrono → síncrono (cores das conexões)
  dark: ["#a9dc76", "#fc9867", "#ab9df2"],
};

const hex = (h: string): [number, number, number] => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
function mix(colors: string[], t: number): [number, number, number] {
  const k = Math.min(colors.length - 1, Math.max(0, t) * (colors.length - 1));
  const i = Math.min(colors.length - 2, Math.floor(k));
  const f = k - i;
  const a = hex(colors[i]);
  const b = hex(colors[i + 1]);
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}

interface Pt {
  x: number;
  y: number;
  t: number;
}
interface Ripple {
  x: number;
  y: number;
  t: number;
}

export default function CursorTrail() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const cv = ref.current;
    if (!cv || typeof matchMedia !== "function") return;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches || matchMedia("(pointer: coarse)").matches) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;

    let w = 0;
    let h = 0;
    const resize = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      w = window.innerWidth;
      h = window.innerHeight;
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();

    const pts: Pt[] = [];
    const ripples: Ripple[] = [];
    let tx = -200; // alvo (mouse real)
    let ty = -200;
    let hx = -200; // cabeça suavizada
    let hy = -200;
    let seen = false;
    let lastMove = 0;
    let ring = 8; // raio do anel de porta (anima)
    let snap = false;
    let raf = 0;
    let running = false;

    const start = () => {
      if (!running && !document.hidden) {
        running = true;
        raf = requestAnimationFrame(frame);
      }
    };

    const onMove = (e: PointerEvent) => {
      tx = e.clientX;
      ty = e.clientY;
      lastMove = performance.now();
      if (!seen) {
        hx = tx;
        hy = ty;
        seen = true;
      }
      snap = !!(e.target as Element | null)?.closest?.("a,button,[role=tab],input,summary");
      start();
    };
    const onDown = (e: PointerEvent) => {
      ripples.push({ x: e.clientX, y: e.clientY, t: performance.now() });
      start();
    };
    const onLeave = () => {
      seen = false;
    };

    function frame(now: number) {
      const dark = document.documentElement.dataset.theme === "dark";
      const colors = PALETTE[dark ? "dark" : "light"];
      ctx!.clearRect(0, 0, w, h);

      // cabeça acompanha o mouse com leve atraso (linha mais fluida)
      hx += (tx - hx) * 0.38;
      hy += (ty - hy) * 0.38;
      const last = pts[pts.length - 1];
      if (seen && (!last || Math.hypot(hx - last.x, hy - last.y) > 2.5)) pts.push({ x: hx, y: hy, t: now });
      while (pts.length && (now - pts[0].t > LIFE || pts.length > MAX_POINTS)) pts.shift();

      // ── linha do conector ──
      if (pts.length > 2) {
        const n = pts.length;
        let cum = 0;
        for (let i = 1; i < n; i++) {
          const a = pts[i - 1];
          const b = pts[i];
          const seg = Math.hypot(b.x - a.x, b.y - a.y);
          cum += seg;
          const age = (now - b.t) / LIFE;
          const life = Math.max(0, 1 - age);
          const alpha = Math.pow(life, 1.4);
          const [r, g, bl] = mix(colors, i / n);
          const mx = (a.x + b.x) / 2;
          const my = (a.y + b.y) / 2;
          const p0 = i > 1 ? { x: (pts[i - 2].x + a.x) / 2, y: (pts[i - 2].y + a.y) / 2 } : a;
          // curva suave (pontos médios) — como o traçado "curva" dos conectores
          ctx!.beginPath();
          ctx!.moveTo(p0.x, p0.y);
          ctx!.quadraticCurveTo(a.x, a.y, mx, my);
          ctx!.lineCap = "round";
          ctx!.setLineDash([]);
          ctx!.strokeStyle = `rgba(${r | 0},${g | 0},${bl | 0},${alpha * 0.55})`;
          ctx!.lineWidth = 1.2 + 2.6 * life;
          ctx!.stroke();
          // pontos de fluxo correndo pela linha (como as conexões animadas)
          ctx!.beginPath();
          ctx!.moveTo(p0.x, p0.y);
          ctx!.quadraticCurveTo(a.x, a.y, mx, my);
          ctx!.setLineDash([0.1, 11]);
          ctx!.lineDashOffset = -(now / 22) + cum;
          ctx!.strokeStyle = `rgba(${r | 0},${g | 0},${bl | 0},${Math.min(1, alpha * 1.25)})`;
          ctx!.lineWidth = 2.2 + 2.2 * life;
          ctx!.stroke();
        }
        ctx!.setLineDash([]);
      }

      // ── cabeça: seta orientada + anel de porta ──
      const idle = now - lastMove;
      const headAlpha = seen ? Math.max(0, Math.min(1, 1 - (idle - 1400) / 600)) : 0;
      if (headAlpha > 0.01) {
        const ref2 = pts[Math.max(0, pts.length - 6)];
        const ang = ref2 && Math.hypot(hx - ref2.x, hy - ref2.y) > 3 ? Math.atan2(hy - ref2.y, hx - ref2.x) : -Math.PI / 4;
        const head = colors[2];
        const [hr, hg, hb] = hex(head);
        ring += ((snap ? 17 : 8) - ring) * 0.22;
        ctx!.save();
        ctx!.translate(hx, hy);
        // anel (porta do componente)
        ctx!.beginPath();
        ctx!.arc(0, 0, ring + Math.sin(now / 260) * (snap ? 0.8 : 0.4), 0, Math.PI * 2);
        ctx!.fillStyle = `rgba(${hr},${hg},${hb},${(snap ? 0.14 : 0.06) * headAlpha})`;
        ctx!.fill();
        ctx!.lineWidth = 1.6;
        ctx!.strokeStyle = `rgba(${hr},${hg},${hb},${(snap ? 0.85 : 0.5) * headAlpha})`;
        ctx!.stroke();
        // seta (marcador de destino do conector)
        ctx!.rotate(ang);
        ctx!.beginPath();
        ctx!.moveTo(6.5, 0);
        ctx!.lineTo(-4.5, -4.6);
        ctx!.lineTo(-4.5, 4.6);
        ctx!.closePath();
        ctx!.fillStyle = `rgba(${hr},${hg},${hb},${headAlpha})`;
        ctx!.fill();
        ctx!.restore();
      }

      // ── clique: pulso expansivo (como o evento assíncrono) ──
      for (let i = ripples.length - 1; i >= 0; i--) {
        const r = ripples[i];
        const p = (now - r.t) / 650;
        if (p >= 1) {
          ripples.splice(i, 1);
          continue;
        }
        const [rr, rg, rb] = hex(colors[1]);
        ctx!.beginPath();
        ctx!.arc(r.x, r.y, 6 + 38 * (1 - Math.pow(1 - p, 3)), 0, Math.PI * 2);
        ctx!.strokeStyle = `rgba(${rr},${rg},${rb},${0.7 * (1 - p)})`;
        ctx!.lineWidth = 2 * (1 - p) + 0.5;
        ctx!.stroke();
      }

      // pausa o laço quando não há nada para desenhar
      if (pts.length > 2 || ripples.length || headAlpha > 0.01) raf = requestAnimationFrame(frame);
      else {
        running = false;
        ctx!.clearRect(0, 0, w, h);
      }
    }

    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerdown", onDown, { passive: true });
    document.addEventListener("pointerleave", onLeave);
    window.addEventListener("resize", resize);
    const vis = () => (document.hidden ? ((running = false), cancelAnimationFrame(raf)) : start());
    document.addEventListener("visibilitychange", vis);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerdown", onDown);
      document.removeEventListener("pointerleave", onLeave);
      window.removeEventListener("resize", resize);
      document.removeEventListener("visibilitychange", vis);
    };
  }, []);

  return <canvas ref={ref} className="lp-trail" aria-hidden />;
}
