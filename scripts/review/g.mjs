// F3 (NEGAR/permissões), F7 (FALHAR → tentar de novo / pular) e F8 (Parar) do workflow «Landing page completa».
// Uso: PW_DIR=$S/pw node scripts/review/g.mjs <P#>   (instância isolada em 5192/7092, claude = fake; veja docs/WORKFLOW_REVIEW_LOOP_PROMPT.md)
import { pathToFileURL } from "node:url";
import { join } from "node:path";
const { chromium } = await import(pathToFileURL(join(process.env.PW_DIR ?? ".", "node_modules/playwright-core/index.mjs")).href);
const tag = process.argv[2] ?? "P1";
const API = "http://localhost:7092";
const b = await chromium.launch({ channel: "msedge", headless: true });
const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
const errs = [];
p.on("console", (m) => m.type() === "error" && errs.push(m.text()));
p.on("pageerror", (e) => errs.push(String(e)));
const res = [];
const ok = (id, pass, note = "") => (res.push({ id, pass, note }), console.log(`${pass ? "OK " : "FALHA"} ${id} ${note}`));
const chip = async () => (await p.locator(".wf-chip").innerText().catch(() => "")).trim();
const termText = async () => (await p.locator(".term-view:not([hidden]) .xterm-rows").innerText().catch(() => "")).replace(/ /g, " ");
const waitFor = async (fn, ms, label) => {
  const t = Date.now();
  while (Date.now() - t < ms) {
    if (await fn()) return Date.now() - t;
    await p.waitForTimeout(150);
  }
  throw new Error("timeout: " + label);
};
const killAll = async () => {
  const i = await (await fetch(`${API}/api/term/info`)).json();
  for (const s of i.sessions) await fetch(`${API}/api/term/kill`, { method: "POST", headers: { "Content-Type": "application/json", "x-archflow-term": i.token }, body: JSON.stringify({ id: s.id }) });
};
/** Abre o formulário, preenche e (opcional) libera ferramentas; devolve depois de clicar em Executar. */
async function start(produto, { allow = [] } = {}) {
  await p.goto("about:blank"); // sai do app antes de matar as sessões: senão a página aberta tenta reconectar e loga erro de WebSocket
  await killAll();
  await p.goto("http://localhost:5192/app", { waitUntil: "load" });
  await p.locator("text=/Landing page\\s*completa/ >> visible=true").first().waitFor({ timeout: 10000 });
  await p.waitForTimeout(1500);
  await p.locator("text=/Landing page\\s*completa/ >> visible=true").first().click({ timeout: 8000 });
  await p.getByRole("button", { name: "▶ Executar no Claude Code" }).click();
  await p.waitForSelector(".prompts-side .pane-body");
  for (const [k, v] of [["produto", produto], ["publico", "makers"], ["tom", "técnico"]]) await p.locator(".prompts-side .pane-body label.field", { hasText: new RegExp(`^${k}$`) }).locator("input").fill(v);
  await p.locator(".prompts-side details.pane-more summary").first().click();
  for (const n of ["WebSearch", "WebFetch"]) {
    const box = p.locator(".prompts-side details.pane-more label", { hasText: new RegExp(`^${n}`) }).locator("input");
    if (allow.includes(n)) await box.check();
    else await box.uncheck();
  }
  await p.getByRole("button", { name: "Executar", exact: true }).click();
  await p.locator(".wf-steps").waitFor({ timeout: 8000 });
}
const tab1 = async () => {
  await p.locator(".term-tab", { hasText: "1/9" }).click({ timeout: 8000 });
  await waitFor(async () => /concluído|falhou/.test(await termText()), 8000, "fim do passo 1").catch(() => {});
  return termText();
};

try {
  // F3 — sem liberar WebSearch, com NEGAR: a aba mostra o erro de permissão; liberando, não mostra
  await start("NEGAR Forja3D", { allow: [] });
  await waitFor(async () => (await p.locator(".wf-s").nth(0).locator(".wf-res summary").count()) > 0 || /Aguardando|Falhou/.test(await chip()), 20000, "passo 1 terminou (sem liberar)");
  const semLiberar = await tab1();
  ok("F3 sem liberar: erro de permissão visível na aba", /erro: permission denied: WebSearch/.test(semLiberar), semLiberar.replace(/\s+/g, " ").slice(0, 150));
  await start("NEGAR Forja3D", { allow: ["WebSearch"] });
  await waitFor(async () => (await p.locator(".wf-s").nth(0).locator(".wf-res summary").count()) > 0 || /Aguardando|Falhou/.test(await chip()), 20000, "passo 1 terminou (liberado)");
  const liberado = await tab1();
  ok("F3 liberando WebSearch: sem erro de permissão", !/permission denied/.test(liberado) && /✓ concluído/.test(liberado), liberado.replace(/\s+/g, " ").slice(0, 150));

  // F7 — FALHAR: passo fica «Falhou»; «Tentar de novo» falha de novo; «Pular» segue
  await start("FALHAR Forja3D", { allow: ["WebSearch"] });
  await waitFor(async () => (await chip()) === "Falhou", 20000, "chip Falhou");
  ok("F7 passo que falha vira «Falhou»", true, await p.locator(".wf-steps li").first().innerText().then((t) => t.replace(/\s+/g, " ")));
  await p.getByRole("button", { name: "Tentar de novo" }).click();
  await waitFor(async () => (await chip()) === "Rodando", 5000, "tentar de novo volta a rodar").catch(() => {});
  await waitFor(async () => (await chip()) === "Falhou", 20000, "falha de novo");
  ok("F7 «Tentar de novo» roda e falha de novo, sem travar", true);
  await p.getByRole("button", { name: "Pular" }).click();
  await waitFor(async () => (await chip()) === "Aguardando você", 15000, "pular segue para o passo 2");
  ok("F7 «Pular» segue para o passo 2", true);

  // F8 — Parar durante um passo automático
  await start("Forja3D", { allow: ["WebSearch"] });
  await waitFor(async () => (await chip()) === "Rodando", 8000, "rodando");
  const t0 = Date.now();
  await p.getByRole("button", { name: "Parar" }).click();
  await waitFor(async () => (await chip()) === "Parado", 5000, "chip Parado");
  ok("F8 «Parar» muda para «Parado»", true, `${Date.now() - t0} ms`);
  const liveCount = async () => (await (await fetch(`${API}/api/term/info`)).json()).sessions.filter((s) => s.exited === undefined && / -p /.test(s.cmd)).length; // só passos automáticos (-p): um passo manual de outra execução pode ter nascido depois do killAll
  const tKill = Date.now();
  let live = await liveCount();
  while (live > 0 && Date.now() - tKill < 4000) {
    await p.waitForTimeout(250);
    live = await liveCount();
  }
  ok("F8 nenhum processo vivo depois de parar", live === 0, `${live} vivos após ${Date.now() - tKill} ms`);
  ok("F8 «Rodar de novo» disponível", (await p.getByRole("button", { name: "Rodar de novo" }).count()) > 0);
} catch (e) {
  console.log("ERRO:", String(e).split("\n")[0]);
  await p.screenshot({ path: `${tag}-G-erro.png` });
  console.log("CARD:", (await p.locator(".prompts-side").innerText().catch(() => "")).replace(/\n+/g, " | ").slice(0, 500));
  res.push({ id: "erro", pass: false });
}
ok("console sem erros", errs.length === 0, errs.slice(0, 3).join(" | "));
await b.close();
process.exit(res.some((r) => !r.pass) ? 1 : 0);
