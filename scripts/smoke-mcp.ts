/**
 * Smoke test do MCP empacotado: inicia `<exe> --mcp` como um cliente faria, faz o handshake (initialize + tools/list)
 * e falha se o servidor não responder ou não expuser ferramentas. Roda no release antes de publicar os pacotes.
 *
 *   npm run mcp:smoke -- release/mac-arm64/Archflow.app/Contents/MacOS/Archflow
 *
 * Com ARCHFLOW_NO_APP=1 o servidor hospeda o bridge no próprio processo, sem abrir a janela do app.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

const exe = process.argv[2];
if (!exe || !existsSync(exe)) {
  console.error(`Uso: npm run mcp:smoke -- <caminho do executável> (recebido: ${exe ?? "nada"})`);
  process.exit(2);
}

const t0 = Date.now();
const child = spawn(exe, ["--mcp"], { stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, ARCHFLOW_NO_APP: "1" } });
let stderr = "";
let out = "";
child.stderr.on("data", (d) => (stderr = (stderr + d).slice(-2000)));
const send = (m: object) => child.stdin.write(JSON.stringify(m) + "\n");

const finish = (ok: boolean, msg: string) => {
  clearTimeout(timer);
  child.removeAllListeners("exit");
  child.kill();
  console.log(`${ok ? "✓" : "✗"} ${msg} (${Date.now() - t0} ms)`);
  if (!ok && stderr.trim()) console.log(stderr.trim());
  process.exit(ok ? 0 : 1);
};
const timer = setTimeout(() => finish(false, "o servidor não respondeu em 60 s"), 60000);
child.on("error", (e) => finish(false, `não foi possível iniciar: ${e.message}`));
child.on("exit", (code) => finish(false, `o servidor encerrou ao iniciar (código ${code})`));
child.stdout.on("data", (d) => {
  out += d;
  let i: number;
  while ((i = out.indexOf("\n")) >= 0) {
    const line = out.slice(0, i).trim();
    out = out.slice(i + 1);
    if (!line) continue;
    let m: any;
    try {
      m = JSON.parse(line);
    } catch {
      continue; // log que não é JSON-RPC
    }
    if (m.error) finish(false, `erro do servidor: ${m.error.message ?? JSON.stringify(m.error)}`);
    else if (m.id === 1) {
      console.log(`servidor ${m.result.serverInfo?.name} ${m.result.serverInfo?.version}`);
      send({ jsonrpc: "2.0", method: "notifications/initialized" });
      send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
    } else if (m.id === 2) {
      const tools = (m.result.tools ?? []).length;
      finish(tools > 0, `MCP respondeu com ${tools} ferramentas`);
    }
  }
});
send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "archflow-smoke", version: "1" } } });
