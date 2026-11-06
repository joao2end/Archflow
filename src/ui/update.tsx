/**
 * Atualização do app desktop: o estado vem do bridge (`/api/update`, ver server/updater.ts). Verifica sozinho ao abrir
 * e a cada 6 h; quando há versão nova, um botão na barra de ações abre a janela com as novidades e o «Instalar».
 * No navegador o bridge responde `desktop: false` e nada aparece.
 */
import { useEffect, useSyncExternalStore } from "react";
import type { UpdateState } from "../../server/updater";
import { Glyph } from "./icons";
import { set } from "./store";

let state: UpdateState | null = null;
const subs = new Set<() => void>();
const emit = (s: UpdateState | null) => ((state = s), subs.forEach((f) => f()));
export const useUpdate = () => useSyncExternalStore((f) => (subs.add(f), () => subs.delete(f)), () => state);

async function call(path: string, body?: object): Promise<UpdateState> {
  const r = await fetch(path, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {});
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error ?? `erro ${r.status}`);
  return j as UpdateState;
}

let polling: ReturnType<typeof setInterval> | undefined;
/** Durante o download e a instalação, acompanha o progresso. */
function follow() {
  if (polling) return;
  polling = setInterval(async () => {
    try {
      const s = await call("/api/update");
      emit(s);
      if (s.phase !== "downloading" && s.phase !== "checking") (clearInterval(polling), (polling = undefined));
    } catch {
      /* o app pode estar fechando para instalar */
    }
  }, 400);
}

export async function checkForUpdate(force = false) {
  try {
    emit(await call("/api/update/check", { force }));
  } catch (e) {
    if (state) emit({ ...state, phase: "error", error: e instanceof Error ? e.message : String(e) });
  }
}

export async function startDownload() {
  try {
    emit(await call("/api/update/download", {}));
    follow();
  } catch (e) {
    if (state) emit({ ...state, phase: "error", error: e instanceof Error ? e.message : String(e) });
  }
}

export async function installNow() {
  try {
    emit(await call("/api/update/install", { confirm: true }));
  } catch (e) {
    if (state) emit({ ...state, error: e instanceof Error ? e.message : String(e) });
  }
}

const SKIP_KEY = "archflow.update.skip";
export const skippedVersion = () => {
  try {
    return localStorage.getItem(SKIP_KEY);
  } catch {
    return null;
  }
};
export const skipVersion = (v: string) => {
  try {
    localStorage.setItem(SKIP_KEY, v);
  } catch {
    /* sem storage: só não lembra */
  }
};

/** Carrega o estado e agenda as verificações automáticas (uma vez, no topo do app). */
export function useUpdateBoot() {
  useEffect(() => {
    let alive = true;
    call("/api/update")
      .then((s) => {
        if (!alive) return;
        emit(s);
        if (s.phase === "downloading") follow();
      })
      .catch(() => {});
    const first = setTimeout(() => state?.desktop && void checkForUpdate(), 5000);
    const every = setInterval(() => state?.desktop && void checkForUpdate(), 6 * 3600 * 1000);
    return () => ((alive = false), clearTimeout(first), clearInterval(every));
  }, []);
}

/** Botão na barra de ações: só aparece no app desktop quando há versão nova (ou o download dela está em andamento). */
export function UpdateButton() {
  useUpdateBoot();
  const s = useUpdate();
  if (!s?.desktop || !s.latest) return null;
  const busy = s.phase === "downloading" || s.phase === "installing";
  const ready = s.phase === "ready";
  if (!busy && !ready && (s.phase !== "available" || skippedVersion() === s.latest)) return null;
  const pct = s.phase === "downloading" && s.asset?.size ? Math.floor(((s.received ?? 0) / s.asset.size) * 100) : undefined;
  return (
    <button className="btn update-btn" onClick={() => set({ modal: { type: "update" } })} data-tip={`Archflow ${s.latest} disponível: ver as novidades e atualizar`} data-tip-pos="bottom">
      <Glyph name={ready ? "check" : "download"} size={16} />
      {pct !== undefined ? `Baixando ${pct}%` : ready ? "Instalar atualização" : `Atualizar para ${s.latest}`}
    </button>
  );
}
