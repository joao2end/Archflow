/**
 * O que as visões 3D (camadas do modo domain, iso.tsx; placa do modo architecture, arch3d.tsx) compartilham: a saída com
 * transição, o tema efetivo do app e o encaixe dos painéis abaixo da barra de cima.
 */
import { useEffect, useState, type RefObject } from "react";
import { set } from "./store";
import type { IsoTheme } from "./iso3d";

/** duração das transições de entrada e saída (ms) */
export const ENTER_MS = 220;
export const LEAVE_MS = 200;

let leave: (() => void) | null = null;
/** A visão montada registra a saída com transição (null ao desmontar). */
export function registerLeave(fn: (() => void) | null) {
  leave = fn;
}
/** Volta ao 2D com a transição de saída (sem a visão montada, só desliga). */
export function exitIso() {
  if (leave) leave();
  else set({ iso: false });
}

/** Tema efetivo do app (o atributo data-theme da raiz, que já resolve "sistema"). */
export const readTheme = (): IsoTheme => (document.documentElement.dataset.theme === "dark" ? "dark" : "light");

/** Tema efetivo do app, acompanhando as trocas. */
export function useTheme(): IsoTheme {
  const [theme, setTheme] = useState<IsoTheme>(readTheme);
  useEffect(() => {
    const mo = new MutationObserver(() => setTheme(readTheme()));
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => mo.disconnect();
  }, []);
  return theme;
}

/**
 * No 3D, o cromo do 2D (ferramentas de desenho, paleta, barra lateral, minimapa, zoom do 2D) sai de cena, e o painel
 * lateral começa abaixo da barra de cima (que quebra em duas linhas em telas estreitas): `--iso-top` na visão.
 */
export function useIsoChrome(view: RefObject<HTMLElement | null>) {
  useEffect(() => {
    document.documentElement.classList.add("iso-mode");
    return () => document.documentElement.classList.remove("iso-mode");
  }, []);
  useEffect(() => {
    const bar = document.querySelector<HTMLElement>(".topbar");
    if (!bar) return;
    // a segunda linha da barra pode transbordar da caixa dela: vale o que estiver mais embaixo
    // (menus e balões soltos, posicionados por cima, não contam)
    const inFlow = (e: HTMLElement) => !!e.offsetParent && !/absolute|fixed/.test(getComputedStyle(e).position);
    const bottom = () => Math.max(bar.getBoundingClientRect().bottom, ...[...bar.querySelectorAll<HTMLElement>("*")].filter(inFlow).map((e) => e.getBoundingClientRect().bottom));
    const fit = () => view.current?.style.setProperty("--iso-top", `${Math.round(bottom()) + 12}px`);
    window.addEventListener("resize", fit);
    const ro = new ResizeObserver(fit);
    ro.observe(bar);
    fit();
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", fit);
    };
  }, []);
}
