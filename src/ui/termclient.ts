/**
 * Cliente do terminal do Claude Code: fala com `/api/term/*` do bridge e mantém o WebSocket de uma sessão.
 * Usa `fetch` direto (não o `apiFetch` do store): o terminal só existe com o bridge em disco, nunca no armazenamento local.
 */
import { encodeInput, encodeResize, parseServerMsg, reconnectDelay, termWsUrl } from "../shared/termproto";

export interface ClaudeStatus {
  found: boolean;
  version?: string;
  error?: string;
}
export interface TermInfo {
  token: string;
  claude: ClaudeStatus;
  max: number;
  cwd: string;
  sessions: TermSessionInfo[];
}
export interface TermSessionInfo {
  id: string;
  title: string;
  cwd: string;
  cmd: string;
  startedAt: number;
  exited?: number;
}
export interface StartOptions {
  program?: "claude" | "shell";
  args?: string[];
  title?: string;
  cols?: number;
  rows?: number;
  prefill?: string;
}

/** Erro do terminal com o status HTTP (404 desabilitado, 424 sem `claude`, 429 limite, 501 sem node-pty). */
export class TermApiError extends Error {
  constructor(public status: number, msg: string) {
    super(msg);
  }
}

let cachedToken: string | undefined;

/** Consulta o bridge; falha com `TermApiError` quando o terminal não está disponível. */
export async function fetchTermInfo(refreshClaude = false): Promise<TermInfo> {
  const r = await fetch(`/api/term/info${refreshClaude ? "?refresh=1" : ""}`);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new TermApiError(r.status, j.error ?? `erro ${r.status}`);
  cachedToken = (j as TermInfo).token;
  return j as TermInfo;
}

export interface HarnessStatus {
  applicable: boolean;
  /** arquivos (ou `.mcp.json#servidor`) que diferem do que o diagrama geraria */
  stale: string[];
  owner?: string;
  current?: string;
  /** o harness do projeto pertence a outro diagrama agents */
  foreign?: boolean;
}

/** O harness gravado no projeto está em dia com o diagrama aberto? */
export async function fetchHarnessStatus(): Promise<HarnessStatus> {
  const r = await fetch("/api/harness/status?target=claude");
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new TermApiError(r.status, j.error ?? `erro ${r.status}`);
  return j as HarnessStatus;
}

/** Regrava o harness do Claude Code SEM sobrescrever edições manuais; devolve o que ficou como conflito. */
export async function syncHarnessNow(): Promise<{ written: string[]; removed: string[]; conflicts: string[] }> {
  const r = await fetch("/api/harness", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ target: "claude", force: false }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new TermApiError(r.status, j.error ?? `erro ${r.status}`);
  return j;
}

async function post<T>(path: string, body: unknown): Promise<T> {
  if (!cachedToken) await fetchTermInfo();
  const send = () => fetch(path, { method: "POST", headers: { "Content-Type": "application/json", "x-archflow-term": cachedToken! }, body: JSON.stringify(body) });
  let r = await send();
  if (r.status === 403) {
    await fetchTermInfo(); // o bridge reiniciou: token novo
    r = await send();
  }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new TermApiError(r.status, j.error ?? `erro ${r.status}`);
  return j as T;
}

/** A conversa do Claude Code já foi gravada? (um `--resume` de conversa inexistente falha) */
export const conversationExists = (id: string) => fetch(`/api/term/conversation?id=${encodeURIComponent(id)}`).then((r) => r.json()).then((j) => !!j.exists, () => false);

/**
 * Ferramentas negadas por permissão na conversa desde `since` (ms), contando os subagentes: `denials` deixaram trabalho por
 * fazer (o passo falha); `warnings` o agente contornou. Vazio se não der para ler.
 */
export const conversationDenials = (id: string, since: number): Promise<{ denials: string[]; warnings: string[] }> => {
  const strs = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  return post<{ denials?: unknown; warnings?: unknown }>("/api/term/conversation/denials", { id, since }).then(
    (j) => ({ denials: strs(j.denials), warnings: strs(j.warnings) }),
    () => ({ denials: [], warnings: [] }),
  );
};
/**
 * Saídas esperadas (`expects`) sem arquivo modificado desde `since` (ms), lidas do projeto aberto.
 * undefined se não deu para conferir (bridge antigo, projeto fechado, erro).
 */
export const missingOutputs = (patterns: string[], since: number): Promise<string[] | undefined> =>
  fetch("/api/project/outputs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ patterns, since }) })
    .then((r) => (r.ok ? r.json() : undefined))
    .then((j: { missing?: unknown } | undefined) => (Array.isArray(j?.missing) ? j.missing.filter((x): x is string => typeof x === "string") : undefined), () => undefined);
/** Última resposta do agente principal na conversa (a memória do workflow); undefined se não houver. */
export const lastConversationText = (id: string) =>
  post<{ text: string | null }>("/api/term/conversation/last", { id }).then((j) => (typeof j.text === "string" ? j.text : undefined), () => undefined);

export const startTermSession = (o: StartOptions = {}) => post<TermSessionInfo>("/api/term/start", o);
export const killTermSession = (id: string) => post<{ ok: boolean }>("/api/term/kill", { id });

export interface TermConnectionHandlers {
  /** Servidor vai reenviar o scrollback: limpe o terminal antes de escrever de novo. */
  onReset(): void;
  onData(d: string): void;
  onExit(code: number): void;
  onState(s: "connecting" | "open" | "closed"): void;
}

/** Conexão de uma sessão, com reconexão automática (o servidor reenvia o scrollback) até `close()` ou o processo sair. */
export class TermConnection {
  private ws?: WebSocket;
  private attempt = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private done = false;
  private lastSize?: { cols: number; rows: number };

  constructor(private session: string, private h: TermConnectionHandlers) {
    this.connect();
  }

  private async connect() {
    if (this.done) return;
    this.h.onState("connecting");
    try {
      if (!cachedToken) await fetchTermInfo();
    } catch {
      return this.retry();
    }
    if (this.done) return;
    const ws = new WebSocket(termWsUrl(location, this.session, cachedToken!));
    this.ws = ws;
    ws.onopen = () => {
      this.attempt = 0;
      this.h.onState("open");
      if (this.lastSize) ws.send(encodeResize(this.lastSize.cols, this.lastSize.rows));
    };
    ws.onmessage = (ev) => {
      const m = parseServerMsg(ev.data);
      if (!m) return;
      if (m.t === "hello") this.h.onReset();
      else if (m.t === "out") this.h.onData(m.d);
      else {
        this.done = true; // processo terminou: não reconecta
        this.h.onExit(m.code);
      }
    };
    ws.onclose = () => {
      this.h.onState("closed");
      this.retry();
    };
    ws.onerror = () => ws.close();
  }

  private async retry() {
    if (this.done) return;
    // token pode ter mudado (bridge reiniciou): busca de novo; se a sessão não existe mais (404 no upgrade), para de insistir
    cachedToken = undefined;
    try {
      const info = await fetchTermInfo();
      if (this.done) return;
      if (!info.sessions.some((s) => s.id === this.session)) {
        this.done = true;
        this.h.onExit(-1);
        return;
      }
    } catch {
      /* bridge fora do ar: tenta de novo adiante */
    }
    this.timer = setTimeout(() => this.connect(), reconnectDelay(this.attempt++));
  }

  send(d: string) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(encodeInput(d));
  }
  resize(cols: number, rows: number) {
    this.lastSize = { cols, rows };
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(encodeResize(cols, rows));
  }
  close() {
    this.done = true;
    clearTimeout(this.timer);
    this.ws?.close();
  }
}
