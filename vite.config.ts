import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { DEFAULT_PORT, ensureBridge } from "./server/bridge";

/**
 * Sobe o bridge (projetos em disco + MCP) junto com o servidor de desenvolvimento,
 * para `npm run dev` ser suficiente: criar projetos, salvar arquivos e conectar agentes.
 * Se a porta já estiver em uso por outro bridge, apenas reutiliza.
 */
function archflowBridge(): Plugin {
  return {
    name: "archflow-bridge",
    apply: "serve",
    async configureServer(server) {
      try {
        const r = await ensureBridge(DEFAULT_PORT);
        server.config.logger.info(`  \x1b[32m➜\x1b[0m  Bridge Archflow: ${r === "started" ? "iniciado" : "já em execução"} em http://127.0.0.1:${DEFAULT_PORT}`);
      } catch (e) {
        server.config.logger.warn(`  Bridge Archflow não iniciou (${e instanceof Error ? e.message : e}). Projetos ficam indisponíveis.`);
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), archflowBridge()],
  server: {
    port: Number(process.env.PORT) || 5173,
    // ws: o terminal usa WebSocket em /api/term. changeOrigin ligado trocaria o Host e o bridge (que exige Origin == Host) recusaria
    proxy: { "/api": { target: `http://127.0.0.1:${DEFAULT_PORT}`, ws: true } },
    // no Windows, um diretório observado não pode ser renomeado, e o electron-builder renomeia release/win-unpacked.tmp
    watch: { ignored: ["**/release/**", "**/release-test/**", "**/dist/**", "**/dist-electron/**", "**/dist-mcp/**"] },
  },
});
