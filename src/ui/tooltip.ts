/** Tooltip único no <body>: fica acima de modais e de qualquer stacking context (hud, glass). */
export function initTooltips() {
  const tip = document.createElement("div");
  tip.className = "tip-pop";
  tip.setAttribute("role", "tooltip");
  document.body.appendChild(tip);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let cur: HTMLElement | null = null;

  const hide = () => {
    clearTimeout(timer);
    cur = null;
    tip.classList.remove("show");
  };
  const show = (el: HTMLElement) => {
    if (!el.isConnected) return;
    tip.textContent = el.dataset.tip ?? "";
    tip.style.left = "0px";
    tip.style.top = "0px";
    const r = el.getBoundingClientRect();
    const t = tip.getBoundingClientRect();
    const gap = 10;
    let x: number, y: number;
    switch (el.dataset.tipPos) {
      case "right": x = r.right + gap; y = r.top + r.height / 2 - t.height / 2; break;
      case "left": x = r.left - gap - t.width; y = r.top + r.height / 2 - t.height / 2; break;
      case "top": x = r.left + r.width / 2 - t.width / 2; y = r.top - gap - t.height; break;
      default: x = r.right - t.width; y = r.bottom + gap;
    }
    x = Math.max(8, Math.min(x, innerWidth - t.width - 8));
    y = Math.max(8, Math.min(y, innerHeight - t.height - 8));
    tip.style.left = `${x}px`;
    tip.style.top = `${y}px`;
    tip.classList.add("show");
  };
  const enter = (e: Event) => {
    const el = (e.target as Element | null)?.closest?.("[data-tip]") as HTMLElement | null;
    if (el === cur) return;
    hide();
    if (!el) return;
    cur = el;
    timer = setTimeout(() => show(el), 350);
  };

  document.addEventListener("pointerover", enter);
  document.addEventListener("focusin", (e) => (e.target as Element).matches?.(":focus-visible") && enter(e));
  document.addEventListener("focusout", hide);
  document.addEventListener("pointerdown", hide, true);
  document.addEventListener("keydown", hide, true);
  addEventListener("blur", hide);
  addEventListener("scroll", hide, true);
}
