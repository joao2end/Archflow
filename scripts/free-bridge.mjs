/**
 * Roda antes do `pnpm run dev`: encerra o bridge Archflow antigo que ainda segura a porta (7077 ou ARCHFLOW_PORT).
 * Sem isso o Vite novo só «reaproveita» o bridge velho, com o código velho (o bridge vive dentro do processo do Vite).
 *
 * Só mata o que é seguro: um processo `node` cuja linha de comando aponta para ESTA pasta do projeto (um `vite` ou
 * `tsx server/bridge.ts` deste repositório). O app desktop e qualquer outro programa na porta são deixados em paz, com aviso.
 * `ARCHFLOW_KEEP_BRIDGE=1` desliga. Nunca falha o `dev`: qualquer problema aqui vira só um aviso.
 */
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

const port = Number(process.env.ARCHFLOW_PORT ?? 7077);
const root = resolve(import.meta.dirname, "..");
const win = process.platform === "win32";
const norm = (s) => s.replaceAll("\\", "/").toLowerCase();
const log = (m) => console.log(`[dev] ${m}`);

const run = (cmd, args) => execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 10_000 });

/** PIDs ouvindo em `port` (só loopback/qualquer interface local). */
function listeners() {
  if (win) {
    const out = run("netstat", ["-ano", "-p", "tcp"]);
    const pids = new Set();
    for (const line of out.split(/\r?\n/)) {
      const c = line.trim().split(/\s+/);
      if (c[3] === "LISTENING" && /[:.]\d+$/.test(c[1]) && Number(c[1].split(":").pop()) === port) pids.add(Number(c[4]));
    }
    return [...pids];
  }
  return run("lsof", ["-ti", `tcp:${port}`, "-sTCP:LISTEN"]).split(/\s+/).filter(Boolean).map(Number);
}

function info(pid) {
  if (win) {
    const out = run("powershell", ["-NoProfile", "-Command", `$p=Get-CimInstance Win32_Process -Filter "ProcessId=${pid}"; "$($p.Name)|$($p.CommandLine)"`]).trim();
    const i = out.indexOf("|");
    return { name: out.slice(0, i), cmd: out.slice(i + 1) };
  }
  const cmd = run("ps", ["-o", "command=", "-p", String(pid)]).trim();
  return { name: cmd.split(/\s+/)[0].split("/").pop(), cmd };
}

function kill(pid) {
  if (win) run("taskkill", ["/PID", String(pid), "/T", "/F"]);
  else process.kill(pid, "SIGTERM");
}

try {
  if (process.env.ARCHFLOW_KEEP_BRIDGE === "1") process.exit(0);
  const mine = new Set([process.pid, process.ppid]);
  for (const pid of listeners()) {
    if (mine.has(pid)) continue;
    const { name, cmd } = info(pid);
    const ours = /^node(\.exe)?$/i.test(name) && norm(cmd).includes(norm(root));
    if (!ours) {
      log(`a porta ${port} está com "${name || pid}" (PID ${pid}), que não é um dev server deste projeto: não encerrei. Se for um bridge antigo, feche-o.`);
      continue;
    }
    kill(pid);
    log(`bridge antigo na porta ${port} encerrado (PID ${pid}).`);
  }
} catch (e) {
  log(`não consegui checar a porta ${port} (${e instanceof Error ? e.message : e}); seguindo.`);
}
