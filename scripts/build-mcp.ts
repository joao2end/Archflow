/**
 * Empacota o servidor MCP (server/mcp.ts + bridge + SDK) num único arquivo, que o instalador leva em
 * resources/mcp/. O exe o executa como Node (ELECTRON_RUN_AS_NODE) quando iniciado com `--mcp`.
 */
import { build } from "esbuild";

await build({
  entryPoints: ["server/mcp.ts"],
  outfile: "dist-mcp/archflow-mcp.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  minify: false,
  legalComments: "none",
  // dependências CJS do SDK usam require() dinâmico; no ESM é preciso fornecê-lo.
  banner: { js: "import { createRequire as __archflowRequire } from 'node:module'; const require = __archflowRequire(import.meta.url);" },
  logLevel: "info",
});
