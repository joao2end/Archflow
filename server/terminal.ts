/**
 * Terminal do Claude Code no navegador: sessões PTY na pasta do projeto, ligadas por WebSocket ao xterm.js da UI.
 *
 * Segurança (um WebSocket que abre shell em localhost é RCE para qualquer página aberta no navegador):
 *  - o upgrade só passa se `Origin` for o MESMO host da requisição (mesma origem) e o token do boot vier na query;
 *  - o token só é entregue por `GET /api/term/info` (sem CORS: página de outra origem não consegue ler);
 *  - o comando é sempre `claude` (ou o shell do usuário), em array de argumentos, nunca interpolado em shell.
 *
 * Protocolo (JSON em texto): cliente → { t:"in", d } | { t:"resize", cols, rows };
 * servidor → { t:"out", d } | { t:"exit", code } | { t:"hello", id, cols, rows }.
 */
import { execFile } from "node:child_process";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { chmodSync, existsSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import type { IncomingMessage } from "node:http";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import type { Duplex } from "node:stream";
import { WebSocketServer, type WebSocket } from "ws";

/** Subconjunto de `node-pty` que usamos (o módulo é nativo e carregado sob demanda). */
interface Pty {
  onData(cb: (d: string) => void): void;
  onExit(cb: (e: { exitCode: number }) => void): void;
  write(d: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
  pid: number;
}
type PtyModule = { spawn(file: string, args: string[], opts: Record<string, unknown>): Pty };

export interface TermSession {
  id: string;
  title: string;
  cwd: string;
  cmd: string;
  startedAt: number;
  exited?: number;
}
interface Live extends TermSession {
  pty: Pty;
  scrollback: string;
  clients: Set<WebSocket>;
  cols: number;
  rows: number;
  exitedAt?: number;
}

export const MAX_SESSIONS = Number(process.env.ARCHFLOW_TERM_MAX ?? 4);
const SCROLLBACK_MAX = 200_000;
const TOKEN = randomBytes(24).toString("hex");
const sessions = new Map<string, Live>();
let ptyMod: PtyModule | undefined;
let ptyError: string | undefined;

export class TermError extends Error {
  constructor(public status: number, msg: string) {
    super(msg);
  }
}

/**
 * `require` que funciona em ESM (tsx, Vite) e no bundle CJS do Electron, onde `import.meta.url` vira vazio: nele o
 * `__filename` aponta para dentro do app.asar, e é dali que o `node-pty` (external do bundle) é resolvido.
 */
const nodeRequire = () => createRequire(typeof __filename === "string" ? __filename : import.meta.url);

/**
 * O npm às vezes instala o `spawn-helper` do node-pty sem o bit de execução (→ «posix_spawnp failed» no macOS/Linux).
 * No app empacotado o módulo fica em `app.asar.unpacked` (asarUnpack): é lá que o helper roda, então é o primeiro a tentar.
 */
function fixSpawnHelper() {
  if (process.platform === "win32") return;
  let root: string;
  try {
    root = dirname(nodeRequire().resolve("node-pty/package.json"));
  } catch {
    return; // sem node-pty: o require() abaixo reporta
  }
  for (const base of [...new Set([root.replace("app.asar", "app.asar.unpacked"), root])]) {
    for (const f of [join(base, "prebuilds", `${process.platform}-${process.arch}`, "spawn-helper"), join(base, "build", "Release", "spawn-helper")]) {
      try {
        if (existsSync(f) && !(statSync(f).mode & 0o111)) chmodSync(f, 0o755);
      } catch {
        /* dentro do asar não dá para chmod: o unpacked já foi tratado */
      }
    }
  }
}

async function loadPty(): Promise<PtyModule> {
  if (ptyMod) return ptyMod;
  if (ptyError) throw new TermError(501, ptyError);
  fixSpawnHelper();
  try {
    // require (não import()): dentro do Vite o bridge roda no module runner do config, que já está fechado quando o terminal é aberto
    ptyMod = nodeRequire()("node-pty") as PtyModule;
    return ptyMod;
  } catch (e) {
    ptyError = `terminal indisponível neste ambiente (node-pty não carregou: ${e instanceof Error ? e.message : String(e)})`;
    throw new TermError(501, ptyError);
  }
}

/** Terminal habilitado? Só em loopback, a menos que o usuário assuma o risco com ARCHFLOW_TERM=1. */
export function terminalEnabled(host: string): boolean {
  if (process.env.ARCHFLOW_TERM === "0") return false;
  if (process.env.ARCHFLOW_TERM === "1") return true;
  return host === "127.0.0.1" || host === "localhost" || host === "::1";
}

export interface ClaudeStatus {
  found: boolean;
  /** ex.: «2.1.0»; ausente se o `--version` respondeu algo que não parece versão */
  version?: string;
  /** por que não achou (mensagem do sistema), só quando `found` é false */
  error?: string;
}
type RunVersion = () => Promise<{ stdout: string } | { error: string }>;

/** Extrai «2.1.0» de «2.1.0 (Claude Code)». */
export const parseClaudeVersion = (out: string): string | undefined => /\b(\d+\.\d+\.\d+[\w.-]*)/.exec(out)?.[1];

const runClaudeVersion: RunVersion = () =>
  new Promise((ok) => {
    // fixo, sem entrada do usuário; no Windows o `claude` é um .cmd e precisa de shell
    execFile("claude", ["--version"], { timeout: 8000, shell: process.platform === "win32", windowsHide: true }, (err, stdout) =>
      ok(err ? { error: err.message.split("\n")[0] } : { stdout: String(stdout) }),
    );
  });

let claudeCache: { at: number; status: ClaudeStatus } | undefined;
const CLAUDE_TTL = 30_000;

/** O `claude` está no PATH deste processo? Cacheado por 30 s (o botão da barra consulta várias vezes); `refresh` ignora o cache. */
export async function detectClaude(o: { refresh?: boolean; run?: RunVersion; now?: number } = {}): Promise<ClaudeStatus> {
  const now = o.now ?? Date.now();
  if (!o.refresh && claudeCache && now - claudeCache.at < CLAUDE_TTL) return claudeCache.status;
  const r = await (o.run ?? runClaudeVersion)();
  const status: ClaudeStatus = "error" in r ? { found: false, error: r.error } : { found: true, version: parseClaudeVersion(r.stdout) };
  claudeCache = { at: now, status };
  return status;
}

/** `cwd`: só as sessões deste projeto. As de outros projetos continuam rodando e voltam a aparecer ao reabrir aquele projeto. */
export function termInfo(cwd?: string) {
  return { token: TOKEN, max: MAX_SESSIONS, sessions: listSessions(cwd) };
}

export function listSessions(cwd?: string): TermSession[] {
  return [...sessions.values()].filter((s) => cwd === undefined || s.cwd === cwd).map(({ id, title, cwd, cmd, startedAt, exited }) => ({ id, title, cwd, cmd, startedAt, exited }));
}

const tokenOk = (t: string | null) => {
  if (!t) return false;
  const a = Buffer.from(t);
  const b = Buffer.from(TOKEN);
  return a.length === b.length && timingSafeEqual(a, b);
};

/** Mesma origem: o `Origin` precisa ter o mesmo host da requisição (navegador sempre manda `Origin` no WebSocket). */
function sameOrigin(req: IncomingMessage): boolean {
  const o = req.headers.origin;
  if (!o) return false;
  try {
    return new URL(o).host === req.headers.host;
  } catch {
    return false;
  }
}

/** Valida o token de uma chamada HTTP (POST /api/term/*), enviado no header `x-archflow-term`. */
export function assertToken(req: IncomingMessage) {
  const t = req.headers["x-archflow-term"];
  if (!tokenOk(typeof t === "string" ? t : null)) throw new TermError(403, "token do terminal inválido");
}

export interface StartOpts {
  cwd: string;
  /** Padrão: `claude`. Só aceita `claude` ou `shell` (shell de login do usuário). */
  program?: "claude" | "shell";
  /** Argumentos extras do `claude` (cada item é um argv, sem shell). */
  args?: string[];
  title?: string;
  cols?: number;
  rows?: number;
  /** Texto digitado no terminal logo que ele abre (sem Enter): p. ex. «Use o subagente x para: ». */
  prefill?: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Modos de permissão que o Archflow aceita passar ao `claude`: nunca `bypassPermissions`/`dontAsk`/`auto`. */
export const SAFE_PERMISSION_MODES = ["acceptEdits", "plan", "manual"] as const;
export const MAX_PROMPT_ARG = 40_000;

/**
 * Argumentos aceitos para o `claude` dos workflows (todos os passos compartilham uma conversa), só nestes dois formatos:
 *   passo automático:   -p (--session-id|--resume) <uuid> [--permission-mode <modo seguro>] -- <texto>
 *   passo manual:       (--session-id|--resume) <uuid> [--permission-mode <modo seguro>]     (sessão interativa; o texto vai por `prefill`)
 * (o `--` impede que um texto começando com «-» seja lido como opção). Lista vazia = sessão interativa comum.
 * Qualquer outra coisa é recusada: o cliente nunca consegue passar `--dangerously-skip-permissions`, `--mcp-config` etc.
 */
export function sanitizeClaudeArgs(args: string[] | undefined): string[] {
  if (!args?.length) return [];
  const bad = () => new TermError(400, "argumentos do claude não permitidos");
  const a = [...args];
  const print = a[0] === "-p";
  if (print) a.shift();
  const flag = a.shift();
  const id = a.shift();
  if ((flag !== "--session-id" && flag !== "--resume") || !id || !UUID_RE.test(id)) throw bad();
  const out = [...(print ? ["-p"] : []), flag, id];
  if (a[0] === "--permission-mode") {
    a.shift();
    const mode = a.shift();
    if (!SAFE_PERMISSION_MODES.includes(mode as (typeof SAFE_PERMISSION_MODES)[number])) throw bad();
    out.push("--permission-mode", mode!);
  }
  if (!print) {
    if (a.length) throw bad();
    return out;
  }
  if (a.shift() !== "--") throw bad();
  const text = a.shift();
  if (typeof text !== "string" || !text.trim() || text.length > MAX_PROMPT_ARG || a.length) throw bad();
  return [...out, "--", text];
}

/**
 * A conversa `id` já existe no disco? O Claude Code grava cada conversa em `<config>/projects/<pasta codificada>/<id>.jsonl`
 * e só cria o arquivo depois da primeira mensagem: um `--resume` de uma conversa que nunca recebeu mensagem falha, então
 * o workflow confere antes e usa `--session-id` quando ela ainda não existe.
 */
export function conversationExists(id: string, configDir = process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude")): boolean {
  if (!UUID_RE.test(id)) return false;
  try {
    const root = join(configDir, "projects");
    return readdirSync(root).some((d) => existsSync(join(root, d, `${id}.jsonl`)));
  } catch {
    return false;
  }
}

const clampDim = (n: unknown, d: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.floor(Number(n)) || d));

const EXITED_TTL = 30 * 60_000;
/** Sessões que já saíram e ninguém fechou ficam só para ler o scrollback; some a que passou de 30 min. */
function pruneExited(now = Date.now()) {
  for (const [id, s] of sessions) if (s.exitedAt !== undefined && now - s.exitedAt > EXITED_TTL && !s.clients.size) sessions.delete(id);
}

export async function startSession(o: StartOpts): Promise<TermSession> {
  pruneExited();
  if ([...sessions.values()].filter((s) => s.exited === undefined).length >= MAX_SESSIONS) {
    throw new TermError(429, `no máximo ${MAX_SESSIONS} terminais abertos (somando todos os projetos); feche algum`);
  }
  const pty = await loadPty();
  const win = process.platform === "win32";
  const program = o.program === "shell" ? "shell" : "claude";
  // o node-pty não falha quando o executável não existe (o erro ocorre no helper e a sessão sai na hora): confere antes
  if (program === "claude" && !(await detectClaude()).found) throw new TermError(424, "não encontrei o `claude` no PATH. Ele está instalado e no PATH?");
  const file = program === "claude" ? (win ? "claude.cmd" : "claude") : win ? (process.env.COMSPEC ?? "cmd.exe") : (process.env.SHELL ?? "/bin/zsh");
  const args = program === "claude" ? sanitizeClaudeArgs(o.args) : win ? [] : ["-l"];
  const cols = clampDim(o.cols, 100, 20, 400);
  const rows = clampDim(o.rows, 28, 5, 200);
  let p: Pty;
  try {
    p = pty.spawn(file, args, {
      name: "xterm-256color",
      cols,
      rows,
      cwd: o.cwd,
      env: { ...process.env, TERM: "xterm-256color", COLORTERM: "truecolor" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new TermError(program === "claude" ? 424 : 500, program === "claude" ? `não consegui iniciar o \`claude\` (${msg}). Ele está instalado e no PATH?` : msg);
  }
  const id = randomBytes(6).toString("hex");
  const s: Live = {
    id, title: o.title?.slice(0, 60) || (program === "claude" ? "Claude Code" : "Shell"), cwd: o.cwd,
    cmd: [file, ...args].join(" "), startedAt: Date.now(), pty: p, scrollback: "", clients: new Set(), cols, rows,
  };
  sessions.set(id, s);
  p.onData((d) => {
    s.scrollback = (s.scrollback + d).slice(-SCROLLBACK_MAX);
    const msg = JSON.stringify({ t: "out", d });
    for (const c of s.clients) if (c.readyState === c.OPEN) c.send(msg);
  });
  p.onExit(({ exitCode }) => {
    s.exited = exitCode;
    s.exitedAt = Date.now();
    const msg = JSON.stringify({ t: "exit", code: exitCode });
    for (const c of s.clients) if (c.readyState === c.OPEN) c.send(msg);
  });
  if (o.prefill) sendPrefill(s, o.prefill);
  return { id, title: s.title, cwd: s.cwd, cmd: s.cmd, startedAt: s.startedAt };
}

/** Telas em que digitar atrapalha: o claude pergunta se confia na pasta / aprova servidor do .mcp.json (menu de seleção). */
const BLOCKING_DIALOG = /trust this folder|New MCP server|Use this and all future MCP servers/i;

/** O prefill já pode ser digitado? Saída parada há um tempo e nenhum diálogo de confiança/aprovação na tela. */
export const prefillReady = (tail: string, idleMs: number, minIdle = 900): boolean => idleMs >= minIdle && !BLOCKING_DIALOG.test(tail);

/** Digita o texto (SEM Enter) quando o claude já mostra o prompt; espera o usuário resolver os diálogos (até 2 min). */
function sendPrefill(s: Live, text: string) {
  let lastData = Date.now();
  s.pty.onData(() => (lastData = Date.now()));
  const started = Date.now();
  const tick = setInterval(() => {
    if (s.exited !== undefined || Date.now() - started > 120_000) return clearInterval(tick);
    if (Date.now() - started < 1200 || !prefillReady(s.scrollback.slice(-3000), Date.now() - lastData)) return;
    clearInterval(tick);
    s.pty.write(text);
  }, 300);
}

export function killSession(id: string): boolean {
  const s = sessions.get(id);
  if (!s) return false;
  try {
    if (s.exited === undefined) s.pty.kill();
  } catch {
    /* já terminou */
  }
  s.clients.forEach((c) => c.close());
  sessions.delete(id);
  return true;
}

export function killAll() {
  for (const id of [...sessions.keys()]) killSession(id);
}

const wss = new WebSocketServer({ noServer: true, maxPayload: 1e6 });

/** Trata o `upgrade` de `/api/term?session=…&token=…`. Devolve false se a rota não for do terminal. */
export function handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer, enabled: boolean): boolean {
  const url = new URL(req.url ?? "/", "http://x");
  if (url.pathname !== "/api/term") return false;
  const deny = (code: number, why: string) => {
    socket.write(`HTTP/1.1 ${code} ${why}\r\nConnection: close\r\n\r\n`);
    socket.destroy();
  };
  if (!enabled) return deny(404, "Not Found"), true;
  if (!sameOrigin(req)) return deny(403, "Forbidden"), true;
  if (!tokenOk(url.searchParams.get("token"))) return deny(403, "Forbidden"), true;
  const s = sessions.get(url.searchParams.get("session") ?? "");
  if (!s) return deny(404, "Not Found"), true;
  wss.handleUpgrade(req, socket, head, (ws) => {
    s.clients.add(ws);
    ws.send(JSON.stringify({ t: "hello", id: s.id, cols: s.cols, rows: s.rows }));
    if (s.scrollback) ws.send(JSON.stringify({ t: "out", d: s.scrollback }));
    if (s.exited !== undefined) ws.send(JSON.stringify({ t: "exit", code: s.exited }));
    ws.on("message", (raw) => {
      let m: { t?: string; d?: unknown; cols?: unknown; rows?: unknown };
      try {
        m = JSON.parse(String(raw));
      } catch {
        return;
      }
      if (s.exited !== undefined) return;
      if (m.t === "in" && typeof m.d === "string") s.pty.write(m.d);
      else if (m.t === "resize") {
        s.cols = clampDim(m.cols, s.cols, 20, 400);
        s.rows = clampDim(m.rows, s.rows, 5, 200);
        try {
          s.pty.resize(s.cols, s.rows);
        } catch {
          /* pty já fechado */
        }
      }
    });
    ws.on("close", () => s.clients.delete(ws));
  });
  return true;
}
