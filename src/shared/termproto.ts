/** Protocolo do terminal (ver server/terminal.ts): mensagens JSON em texto pelo WebSocket `/api/term`. */

export type TermServerMsg =
  | { t: "hello"; id: string; cols: number; rows: number }
  | { t: "out"; d: string }
  | { t: "exit"; code: number };
export type TermClientMsg = { t: "in"; d: string } | { t: "resize"; cols: number; rows: number };

export const encodeInput = (d: string): string => JSON.stringify({ t: "in", d } satisfies TermClientMsg);
export const encodeResize = (cols: number, rows: number): string =>
  JSON.stringify({ t: "resize", cols: Math.max(1, Math.floor(cols)), rows: Math.max(1, Math.floor(rows)) } satisfies TermClientMsg);

/** Lê uma mensagem do servidor; devolve undefined se for inválida (ignorada, nunca derruba a UI). */
export function parseServerMsg(raw: unknown): TermServerMsg | undefined {
  let m: any;
  try {
    m = JSON.parse(String(raw));
  } catch {
    return undefined;
  }
  if (!m || typeof m !== "object") return undefined;
  if (m.t === "out" && typeof m.d === "string") return { t: "out", d: m.d };
  if (m.t === "exit" && typeof m.code === "number") return { t: "exit", code: m.code };
  if (m.t === "hello" && typeof m.id === "string") return { t: "hello", id: m.id, cols: Number(m.cols) || 0, rows: Number(m.rows) || 0 };
  return undefined;
}

/** URL do WebSocket na mesma origem da página (http→ws, https→wss). */
export function termWsUrl(loc: { protocol: string; host: string }, session: string, token: string): string {
  const proto = loc.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${loc.host}/api/term?session=${encodeURIComponent(session)}&token=${encodeURIComponent(token)}`;
}

/** Atraso de reconexão (ms) com recuo exponencial, teto de 8 s. */
export const reconnectDelay = (attempt: number): number => Math.min(8000, 500 * 2 ** Math.max(0, attempt));
