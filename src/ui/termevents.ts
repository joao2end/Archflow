/** Avisos de «esta sessão do terminal terminou»: o painel emite, o runner de workflow escuta (módulo à parte para não gerar import circular). */
const listeners = new Set<(sessionId: string, code: number) => void>();

/** Escuta o fim de qualquer sessão; devolve a função que cancela. */
export function onTermExit(fn: (sessionId: string, code: number) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** `code`: o do processo; -1 quando o usuário fechou a aba antes de terminar. */
export const emitTermExit = (sessionId: string, code: number) => listeners.forEach((fn) => fn(sessionId, code));
