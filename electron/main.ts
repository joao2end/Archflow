/**
 * Archflow Desktop — casca Electron: sobe o bridge embutido (projetos em disco + MCP)
 * e abre a interface numa janela própria.
 */
import { app, BrowserWindow, shell } from "electron";
import { execFileSync, spawn } from "node:child_process";
import { join } from "node:path";

/**
 * `Archflow.exe --mcp` → servidor MCP (stdio) para Claude, Cursor etc. É o mesmo exe rodando como
 * Node puro (ELECTRON_RUN_AS_NODE) sobre o bundle em resources/mcp, sem janela.
 */
function runMcp() {
  const script = join(process.resourcesPath, "mcp", "archflow-mcp.mjs");
  const child = spawn(process.execPath, [script], { stdio: "inherit", env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" } });
  child.on("exit", (code) => app.exit(code ?? 0));
  app.on("will-quit", () => child.kill());
  child.on("error", (e) => {
    console.error("[archflow --mcp]", e);
    app.exit(1);
  });
}

/**
 * No macOS, o app aberto pelo Finder/Dock herda do launchd só `/usr/bin:/bin:/usr/sbin:/sbin` — sem Homebrew, nvm nem
 * `~/.local/bin`. O bridge chama `claude` (instalar o MCP no Claude Code) e `npx` (skills), então copia o PATH do
 * shell de login do usuário. Sem efeito em dev (`npm run app`), que já herda o PATH do terminal.
 */
function useLoginShellPath() {
  if (process.platform !== "darwin" || !app.isPackaged) return;
  try {
    const out = execFileSync(process.env.SHELL || "/bin/zsh", ["-ilc", 'printf "\n__ARCHFLOW_PATH__%s" "$PATH"'], {
      encoding: "utf8",
      timeout: 5000,
      stdio: ["ignore", "pipe", "ignore"],
    });
    const shellPath = out.split("__ARCHFLOW_PATH__").pop()?.trim();
    if (shellPath) process.env.PATH = [...new Set([...shellPath.split(":"), ...(process.env.PATH ?? "").split(":")])].filter(Boolean).join(":");
  } catch {
    /* shell lento ou com erro: segue com o PATH herdado */
  }
}

// Precisam vir antes do import do bridge, que lê as variáveis no carregamento do módulo.
process.env.ARCHFLOW_DIST ??= join(__dirname, "..", "dist");
process.env.ARCHFLOW_DATA ??= join(app.getPath("documents"), "Archflow");
// o bridge informa aos clientes MCP como iniciar o servidor; no AppImage o execPath é um ponto de montagem temporário
if (app.isPackaged) process.env.ARCHFLOW_EXE = process.env.APPIMAGE ?? process.execPath;

async function createWindow() {
  const { DEFAULT_PORT, ensureBridge } = await import("../server/bridge");
  await ensureBridge(DEFAULT_PORT);
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: "Archflow",
    icon: join(__dirname, "..", "build", "icon.png"),
    autoHideMenuBar: true,
    backgroundColor: "#ffffff",
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^(https?|cursor|vscode):/.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  await win.loadURL(`http://127.0.0.1:${DEFAULT_PORT}/app`);
}

if (process.argv.includes("--mcp")) runMcp();
else if (!app.requestSingleInstanceLock()) app.quit();
else {
  useLoginShellPath();
  app.on("second-instance", () => {
    const w = BrowserWindow.getAllWindows()[0];
    if (w) (w.isMinimized() && w.restore(), w.focus());
  });
  app.whenReady().then(createWindow);
  app.on("window-all-closed", () => app.quit());
}
