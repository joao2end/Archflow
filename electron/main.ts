/**
 * Archflow Desktop — casca Electron: sobe o bridge embutido (cofres em disco + MCP)
 * e abre a interface numa janela própria.
 */
import { app, BrowserWindow, shell } from "electron";
import { spawn } from "node:child_process";
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

// Precisam vir antes do import do bridge, que lê as variáveis no carregamento do módulo.
process.env.ARCHFLOW_DIST ??= join(__dirname, "..", "dist");
process.env.ARCHFLOW_DATA ??= join(app.getPath("documents"), "Archflow");
if (app.isPackaged) process.env.ARCHFLOW_EXE = process.execPath; // o bridge informa aos clientes MCP como iniciar o servidor

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
  app.on("second-instance", () => {
    const w = BrowserWindow.getAllWindows()[0];
    if (w) (w.isMinimized() && w.restore(), w.focus());
  });
  app.whenReady().then(createWindow);
  app.on("window-all-closed", () => app.quit());
}
