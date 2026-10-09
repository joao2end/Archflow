/**
 * Archflow Desktop — casca Electron: sobe o bridge embutido (cofres em disco + MCP)
 * e abre a interface numa janela própria.
 */
import { app, BrowserWindow, shell } from "electron";
import { join } from "node:path";

// Precisa vir antes do import do bridge, que lê as variáveis no carregamento do módulo.
process.env.ARCHFLOW_DIST ??= join(__dirname, "..", "dist");
process.env.ARCHFLOW_DATA ??= join(app.getPath("documents"), "Archflow");

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
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  await win.loadURL(`http://127.0.0.1:${DEFAULT_PORT}/app`);
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", () => {
    const w = BrowserWindow.getAllWindows()[0];
    if (w) (w.isMinimized() && w.restore(), w.focus());
  });
  app.whenReady().then(createWindow);
  app.on("window-all-closed", () => app.quit());
}
