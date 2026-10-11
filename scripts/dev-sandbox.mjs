/**
 * Servidor de desenvolvimento com cofre descartável: o app abre vazio, em portas próprias, sem tocar
 * no cofre nem na configuração (~/.archflow) do usuário. Útil para testar a UI sem sujar os diagramas reais.
 *
 *   node scripts/dev-sandbox.mjs        (app em http://localhost:5188, bridge em 7098)
 */
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tmp = mkdtempSync(join(tmpdir(), "archflow-sandbox-"));
const env = {
  ...process.env,
  ARCHFLOW_PORT: process.env.ARCHFLOW_PORT ?? "7098",
  ARCHFLOW_CONFIG: join(tmp, "cfg"),
  ARCHFLOW_DATA: join(tmp, "data"),
  PORT: process.env.PORT ?? "5188",
};
console.log(`[sandbox] cofre temporário em ${tmp}`);

const child = spawn(process.execPath, [join("node_modules", "vite", "bin", "vite.js"), "--configLoader", "runner"], { env, stdio: "inherit" });
const stop = () => {
  child.kill();
  rmSync(tmp, { recursive: true, force: true });
};
child.on("exit", (code) => {
  rmSync(tmp, { recursive: true, force: true });
  process.exit(code ?? 0);
});
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
