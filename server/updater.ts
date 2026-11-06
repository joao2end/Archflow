/**
 * Atualização do app desktop pelo próprio app: consulta a última release do GitHub, baixa o pacote do sistema
 * (instalador no Windows, AppImage no Linux, DMG no macOS), confere o SHA-256 que o GitHub publica para o arquivo e
 * instala.
 *
 * - Windows: roda o instalador NSIS em silêncio, elevado (um pedido de administrador), e ele reabre o app.
 * - Linux (AppImage): troca o arquivo do AppImage pelo novo e reabre.
 * - macOS: o app não é assinado pela Apple, então não dá para se trocar sozinho; o DMG é baixado e aberto.
 *
 * O que roda é sempre o arquivo da release oficial com o hash conferido: o cliente só diz «verificar», «baixar» e
 * «instalar», nunca a URL ou o caminho. Fora do app desktop (navegador, dev), só a verificação funciona.
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, createWriteStream, mkdirSync, renameSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import pkg from "../package.json" with { type: "json" };

export const UPDATE_REPO = "joao2end/Archflow";
const API = `https://api.github.com/repos/${UPDATE_REPO}/releases/latest`;
/** Uma verificação automática por meia hora basta; «Verificar agora» força. */
const CHECK_TTL = 30 * 60 * 1000;

export type UpdatePhase = "idle" | "checking" | "none" | "available" | "downloading" | "ready" | "installing" | "error";

export interface UpdateAsset {
  name: string;
  size: number;
  url: string;
  /** "sha256:<hex>" publicado pelo GitHub */
  digest?: string;
}

export interface UpdateState {
  phase: UpdatePhase;
  current: string;
  /** dentro do app desktop empacotado (só nele dá para instalar) */
  desktop: boolean;
  platform: NodeJS.Platform;
  latest?: string;
  notes?: string;
  publishedAt?: string;
  page?: string;
  asset?: { name: string; size: number };
  received?: number;
  error?: string;
  checkedAt?: number;
  /** como a instalação acontece neste sistema */
  install?: "silent" | "replace" | "open";
}

export interface UpdateHooks {
  /** versão do app em execução (app.getVersion()) */
  version: string;
  /** fecha o app para o instalador poder trocar os arquivos */
  quit: () => void;
  /** reabre o app a partir de outro executável (AppImage novo) */
  relaunch: (exe: string) => void;
}

let hooks: UpdateHooks | undefined;
/** O processo do Electron registra como fechar e reabrir o app; sem isso (navegador, dev), só verifica. */
export function setUpdateHooks(h: UpdateHooks) {
  hooks = h;
  state = { ...state, current: h.version, desktop: true, install: installKind() };
}

const installKind = (): UpdateState["install"] => (process.platform === "win32" ? "silent" : process.platform === "linux" ? (process.env.APPIMAGE ? "replace" : undefined) : process.platform === "darwin" ? "open" : undefined);

let state: UpdateState = { phase: "idle", current: pkg.version, desktop: false, platform: process.platform };
let asset: UpdateAsset | undefined;
let file: string | undefined;

export const updateState = (): UpdateState => ({ ...state });

/* ───────── versões e pacotes ───────── */

/** Compara versões semver simples (1.2.3, com ou sem «v»); pré-releases contam como anteriores à versão final. */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string) => {
    const [core, pre] = v.trim().replace(/^v/i, "").split("-", 2);
    return { nums: core.split(".").map((n) => Number.parseInt(n, 10) || 0), pre };
  };
  const x = parse(a);
  const y = parse(b);
  for (let i = 0; i < Math.max(x.nums.length, y.nums.length, 3); i++) {
    const d = (x.nums[i] ?? 0) - (y.nums[i] ?? 0);
    if (d) return Math.sign(d);
  }
  if (x.pre && !y.pre) return -1;
  if (!x.pre && y.pre) return 1;
  return (x.pre ?? "").localeCompare(y.pre ?? "");
}

/** O pacote desta plataforma entre os arquivos da release (nomes como o electron-builder e o GitHub os publicam). */
export function pickAsset<A extends { name: string }>(assets: A[], platform: NodeJS.Platform, arch: string): A | undefined {
  const by = (re: RegExp) => assets.find((a) => re.test(a.name));
  if (platform === "win32") return by(/^Archflow[ .]Setup[ .][\d.]+\.exe$/i);
  if (platform === "linux") return by(/-linux-x86_64\.AppImage$/i);
  if (platform === "darwin") return by(arch === "arm64" ? /-mac-arm64\.dmg$/i : /-mac-x64\.dmg$/i);
  return undefined;
}

/* ───────── verificar ───────── */

type Fetch = typeof fetch;

export async function checkUpdate(opts: { force?: boolean; fetchImpl?: Fetch } = {}): Promise<UpdateState> {
  if (state.phase === "downloading" || state.phase === "installing") return updateState();
  if (!opts.force && state.checkedAt && Date.now() - state.checkedAt < CHECK_TTL && state.phase !== "error") return updateState();
  const prev = { phase: state.phase, latest: state.latest };
  state = { ...state, phase: "checking", error: undefined };
  try {
    const r = await (opts.fetchImpl ?? fetch)(API, { headers: { Accept: "application/vnd.github+json", "User-Agent": `Archflow/${state.current}` } });
    if (r.status === 404) throw new Error("ainda não há nenhuma versão publicada");
    if (r.status === 403 || r.status === 429) throw new Error("o GitHub limitou as consultas por agora; tente de novo em alguns minutos");
    if (!r.ok) throw new Error(`o GitHub respondeu ${r.status}`);
    const rel = (await r.json()) as { tag_name?: string; body?: string; html_url?: string; published_at?: string; draft?: boolean; prerelease?: boolean; assets?: { name: string; size: number; browser_download_url: string; digest?: string | null }[] };
    const latest = String(rel.tag_name ?? "").replace(/^v/i, "");
    if (!latest) throw new Error("a resposta do GitHub não traz a versão");
    const found = pickAsset(rel.assets ?? [], process.platform, process.arch);
    asset = found ? { name: found.name, size: found.size, url: found.browser_download_url, digest: found.digest ?? undefined } : undefined;
    const newer = compareVersions(latest, state.current) > 0;
    // a mesma versão já baixada continua pronta para instalar
    const kept = newer && prev.phase === "ready" && prev.latest === latest && !!file;
    state = {
      ...state,
      phase: kept ? "ready" : newer ? "available" : "none",
      latest,
      notes: rel.body ?? "",
      publishedAt: rel.published_at,
      page: rel.html_url,
      asset: asset ? { name: asset.name, size: asset.size } : undefined,
      received: kept ? state.received : undefined,
      checkedAt: Date.now(),
    };
    if (file && !kept) discard();
  } catch (e) {
    state = { ...state, phase: "error", error: `não consegui verificar atualizações: ${e instanceof Error ? e.message : String(e)}`, checkedAt: Date.now() };
  }
  return updateState();
}

/* ───────── baixar ───────── */

const updateDir = () => join(tmpdir(), "archflow-update");

function discard() {
  if (file) rmSync(file, { force: true });
  file = undefined;
}

/** Baixa o pacote em segundo plano; o progresso aparece em `updateState().received`. */
export function downloadUpdate(opts: { fetchImpl?: Fetch; dir?: string } = {}): UpdateState {
  if (state.phase === "downloading" || state.phase === "ready") return updateState();
  if (state.phase !== "available") throw new UpdateError("nenhuma versão nova para baixar: verifique as atualizações antes");
  if (!asset) throw new UpdateError(`a versão ${state.latest} não tem pacote para este sistema; baixe pela página da versão`);
  if (!asset.digest?.startsWith("sha256:")) throw new UpdateError("o GitHub não publicou o hash deste arquivo, então o app não o instala sozinho; baixe pela página da versão");
  const target = asset;
  state = { ...state, phase: "downloading", received: 0, error: undefined };
  void fetchTo(target, opts.dir ?? (process.platform === "darwin" ? join(homedir(), "Downloads") : updateDir()), opts.fetchImpl ?? fetch)
    .then((path) => {
      file = path;
      state = { ...state, phase: "ready", received: target.size };
    })
    .catch((e) => {
      state = { ...state, phase: "error", error: `o download falhou: ${e instanceof Error ? e.message : String(e)}` };
    });
  return updateState();
}

async function fetchTo(a: UpdateAsset, dir: string, fetchImpl: Fetch): Promise<string> {
  mkdirSync(dir, { recursive: true });
  const dest = join(dir, a.name);
  const part = `${dest}.part`;
  const r = await fetchImpl(a.url, { headers: { "User-Agent": `Archflow/${state.current}` } });
  if (!r.ok || !r.body) throw new Error(`o GitHub respondeu ${r.status}`);
  const hash = createHash("sha256");
  const out = createWriteStream(part);
  let got = 0;
  try {
    const reader = r.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      hash.update(value);
      got += value.byteLength;
      state = { ...state, received: got };
      if (!out.write(value)) await new Promise((ok) => out.once("drain", ok));
    }
    await new Promise<void>((ok, fail) => out.end((e?: Error | null) => (e ? fail(e) : ok())));
  } catch (e) {
    out.destroy();
    rmSync(part, { force: true });
    throw e;
  }
  const sum = `sha256:${hash.digest("hex")}`;
  if (sum !== a.digest) {
    rmSync(part, { force: true });
    throw new Error("o arquivo baixado não confere com o hash publicado no GitHub e foi descartado");
  }
  rmSync(dest, { force: true });
  renameSync(part, dest);
  return dest;
}

/* ───────── instalar ───────── */

export class UpdateError extends Error {}

/** PowerShell com aspas simples: o caminho vai literal. */
const psQuote = (s: string) => `'${s.replace(/'/g, "''")}'`;

/** Instala o pacote baixado. No Windows e no Linux o app fecha e reabre já atualizado. */
export async function installUpdate(): Promise<UpdateState> {
  if (state.phase !== "ready" || !file) throw new UpdateError("baixe a atualização antes de instalar");
  if (!hooks) throw new UpdateError("a instalação automática só funciona no app desktop");
  const path = file;
  if (process.platform === "win32") {
    // um pedido de administrador (o app é instalado para todos os usuários); /S instala em silêncio na mesma pasta e
    // --force-run reabre o app no fim. Recusar o pedido não fecha o app.
    const cmd = `Start-Process -FilePath ${psQuote(path)} -ArgumentList '/S','--updated','--force-run' -Verb RunAs`;
    const code = await new Promise<number>((ok) => {
      const p = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", cmd], { windowsHide: true });
      p.on("exit", (c) => ok(c ?? 1));
      p.on("error", () => ok(1));
    });
    if (code !== 0) {
      state = { ...state, phase: "ready", error: "a instalação foi cancelada (o Windows precisa da permissão de administrador)" };
      return updateState();
    }
    state = { ...state, phase: "installing", error: undefined };
    setTimeout(() => hooks!.quit(), 400);
    return updateState();
  }
  if (process.platform === "linux") {
    const exe = process.env.APPIMAGE;
    if (!exe) throw new UpdateError("só o AppImage se atualiza sozinho; neste formato, baixe pela página da versão");
    const next = `${exe}.update`;
    rmSync(next, { force: true });
    renameSync(path, next);
    chmodSync(next, 0o755);
    renameSync(next, exe);
    file = undefined;
    state = { ...state, phase: "installing", error: undefined };
    setTimeout(() => hooks!.relaunch(exe), 400);
    return updateState();
  }
  if (process.platform === "darwin") {
    spawn("open", [path], { detached: true, stdio: "ignore" }).unref();
    state = { ...state, error: undefined };
    return updateState();
  }
  throw new UpdateError("este sistema não tem atualização automática");
}

/** Só para os testes: volta ao estado inicial. */
export function resetUpdater() {
  hooks = undefined;
  asset = undefined;
  file = undefined;
  state = { phase: "idle", current: pkg.version, desktop: false, platform: process.platform };
}
