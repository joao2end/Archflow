// F — funcionalidade do workflow «Landing page completa» (uso: node f.mjs <produto> <publico> <tom> [prefixo-screenshot])
process.on("uncaughtException", async (e) => { console.log("ERRO:", String(e).split("\n")[0]); try { await globalThis.__p?.screenshot({ path: `${process.argv[5] ?? "P"}-F-erro.png` }); console.log("CARD:", (await globalThis.__p.locator(".prompts-side").innerText()).replace(/\n+/g, " | ").slice(0, 700)); } catch {} process.exit(2); });
import { pathToFileURL } from "node:url";
import { join } from "node:path";
const { chromium } = await import(pathToFileURL(join(process.env.PW_DIR ?? ".", "node_modules/playwright-core/index.mjs")).href);
const [produto = "Forja3D", publico = "makers", tom = "técnico", tag = "P1"] = process.argv.slice(2);
const BASE = "http://localhost:5192";
const b = await chromium.launch({ channel: "msedge", headless: true });
const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
globalThis.__p = p;
const errs = [];
p.on("console", (m) => m.type() === "error" && errs.push(m.text()));
p.on("pageerror", (e) => errs.push(String(e)));
const res = [];
const ok = (id, pass, note = "") => (res.push({ id, pass, note }), console.log(`${pass ? "OK " : "FALHA"} ${id} ${note}`));
const T = Date.now();
const shot = (n) => p.screenshot({ path: `${tag}-F-${n}.png` });
const termText = async () => (await p.locator(".term-view:not([hidden]) .xterm-rows").innerText().catch(() => "")).replace(/\u00a0/g, " ");
let seen = "";
const snap = async () => { const x = await termText(); if (x && !seen.includes(x)) seen += "\n" + x; return x; };
const chip = async () => (await p.locator(".wf-chip").innerText().catch(() => "")).trim();
const waitFor = async (fn, ms, label) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return Date.now() - t; await p.waitForTimeout(200); } await p.screenshot({ path: `${tag}-F-timeout.png` }); console.log("VISTO:", JSON.stringify(seen.slice(-900)), "CHIP:", await chip(), "ABAS:", await p.locator(".term-tab").allInnerTexts()); throw new Error("timeout: " + label); };

// começa limpo: encerra sessões de execuções anteriores (o limite é de 4 abertas)
const info0 = await (await fetch("http://localhost:7092/api/term/info")).json();
for (const s0 of info0.sessions) await fetch("http://localhost:7092/api/term/kill", { method: "POST", headers: { "Content-Type": "application/json", "x-archflow-term": info0.token }, body: JSON.stringify({ id: s0.id }) });
await p.goto(`${BASE}/app`, { waitUntil: "load" });
await p.waitForTimeout(1500);
await p.locator("text=/Landing page\s*completa/").first().click();
let t = Date.now();
await p.getByRole("button", { name: "▶ Executar no Claude Code" }).click();
await p.locator(".prompts-side").getByText("Landing page completa").waitFor({ timeout: 8000 });
// workflows: o painel abre na aba Workflows e no formulário do nó pedido
await p.waitForSelector(".prompts-side .pane-body, .prompts-side .prompts-list", { timeout: 8000 });
const abertura = Date.now() - t;
ok("abertura do formulário", abertura < 3000, `${abertura} ms`);
// o clique no nó pede o formulário: se só a lista abriu, entra pelo nome
if (!(await p.locator(".prompts-side .pane-body").count())) { await p.locator(".prompts-side .prompts-item", { hasText: "Landing page completa" }).click(); await p.waitForSelector(".prompts-side .pane-body"); }
const labels = (await p.locator(".prompts-side .pane-body label.field > span").allInnerTexts()).map((s) => s.trim());
ok("F1 variáveis pedidas", ["produto", "publico", "tom"].every((v) => labels.includes(v)) && !labels.some((l) => /anterior|resultado/.test(l)), labels.join(", "));
for (const [k, v] of [["produto", produto], ["publico", publico], ["tom", tom]]) await p.locator(".prompts-side .pane-body label.field", { hasText: new RegExp(`^${k}$`) }).locator("input").fill(v);
await p.locator(".prompts-side details.pane-more summary").first().click();
const tools = (await p.locator(".prompts-side details.pane-more label").allInnerTexts()).map((s) => s.replace(/\s+/g, " ").trim());
ok("F2 permissões listam as tools", tools.some((x) => x.startsWith("WebSearch")) && tools.some((x) => x.startsWith("WebFetch")), tools.join(" | ").slice(0, 120));
for (const n of ["WebSearch", "WebFetch"]) await p.locator(".prompts-side details.pane-more label", { hasText: new RegExp(`^${n}`) }).locator("input").check();
await shot("1-form");
t = Date.now();
await p.getByRole("button", { name: "Executar", exact: true }).click();
await p.locator(".wf-steps").waitFor({ timeout: 8000 });
// passo 1 (auto): saída legível na aba
const ms1 = await waitFor(async () => (await snap()).includes("● WebSearch("), 20000, "primeira linha do passo 1");
ok("F2 stream legível no passo 1", true, `primeira linha em ${ms1 + (Date.now() - t - ms1)} ms`);
// F4: memória do passo 1 e {{anterior}} no passo 2
await waitFor(async () => (await p.locator(".wf-s").nth(0).locator(".wf-res summary").count()) > 0, 8000, "memória do passo 1");
ok("F4 memória do passo 1", true, (await p.locator(".wf-s").nth(0).locator(".wf-res summary").innerText()));
// a aba do passo 1 fica «saiu»: lê o que ela mostra (o passo seguinte já ativou outra aba)
await p.locator(".term-tab", { hasText: "1/9" }).click();
await p.waitForTimeout(500);
const t1 = await termText();
ok("F2 passo 1: stream legível, concluído e sem JSON cru", t1.includes("● WebSearch(") && t1.includes("✓ concluído") && !/{"type"|session_id/.test(t1), t1.replace(/\s+/g, " ").slice(0, 160));
await shot("2-passo1");
await p.locator(".term-tab", { hasText: "2/9" }).click();
await waitFor(async () => (await chip()) === "Aguardando você", 15000, "passo 2 aguardando");
await p.waitForTimeout(2500); // o prefill espera a saída ficar parada
const t2 = await termText();
ok("F4 {{anterior}} chegou no passo 2", /RESPOSTA 1 \(fake\)/.test(t2), t2.replace(/\s+/g, " ").slice(0, 160));
await shot("3-passo2");
// F5: confirma no terminal (Enter) e avança
const manual = async () => { if (!(await p.getByRole("button", { name: "Próximo passo" }).count())) return; await waitFor(async () => /❯ \S/.test(await termText()), 20000, "texto do passo digitado no terminal"); await p.locator(".term-view:not([hidden]) .xterm").click({ timeout: 5000 }).catch(() => {}); await p.keyboard.press("Enter"); await waitFor(async () => /RESPOSTA \d+ \(fake\)[^\n]*\n?[\s\S]*❯/.test(await termText()), 10000, "resposta do fake no manual"); await p.getByRole("button", { name: "Próximo passo" }).click({ timeout: 4000 }).catch(() => {}); };
await manual();
ok("F5 passo manual → próximo", true);
// passo 3 (auto)
await waitFor(async () => (await p.locator(".wf-s").nth(2).locator(".wf-res summary").count()) > 0, 20000, "memória do passo 3");
await waitFor(async () => (await chip()) === "Aguardando você", 15000, "passo 4 aguardando");
const sidBefore = (await (await fetch(`http://localhost:7092/api/term/info`)).json()).sessions.map((s) => s.cmd);
// F6: voltar
await p.getByRole("button", { name: "← Voltar" }).click();
await waitFor(async () => (await p.locator(".wf-s").nth(2).getAttribute("class")).includes("cur") || (await chip()) === "Rodando" || (await chip()) === "Aguardando você", 8000, "voltar iniciou o passo 3");
await waitFor(async () => (await chip()) === "Aguardando você" && (await p.locator(".wf-s").nth(3).getAttribute("class")).includes("cur"), 20000, "voltou e chegou de novo no passo 4");
const cmds = (await (await fetch(`http://localhost:7092/api/term/info`)).json()).sessions.map((s) => s.cmd);
const resumes = cmds.filter((c) => /--resume|--session-id/.test(c)).map((c) => /(--resume|--session-id) ([0-9a-f-]{36})/.exec(c)?.[2]);
ok("F6 voltar mantém a conversa", new Set(resumes).size === 1, `${resumes.length} sessões, ${new Set(resumes).size} id(s)`);
await shot("4-voltou");
const titles = (await p.locator(".term-tab .term-tab-t").allInnerTexts()).map((t) => t.trim());
ok("W6 abas sem título repetido depois de «Voltar»", new Set(titles).size === titles.length, titles.join(" | "));
// termina os passos restantes
for (let i = 0; i < 12 && (await chip()) !== "Concluído"; i++) {
  if ((await chip()) === "Aguardando você") await manual(); else await p.waitForTimeout(1200);
}
await waitFor(async () => (await chip()) === "Concluído", 60000, "workflow concluído");
const done = await p.locator(".wf-s.done").count();
const mem = await p.locator(".wf-res summary").count();
ok("F9 concluído", done === 9, `${done}/9 com ✓, ${mem} com memória`);
await p.locator(".wf-res summary").first().click();
await p.getByRole("button", { name: "Copiar" }).first().click();
ok("F9 copiar sem erro", true);
await shot("5-fim");
await p.waitForTimeout(21000); // 20 s depois da última sessão com texto digitado
ok("W6 aviso «Primeira vez nesta pasta?» some sozinho (20 s)", (await p.locator(".term-note").count()) === 0, `${await p.locator(".term-note").count()} avisos na tela: ${(await p.locator(".term-note").allInnerTexts()).join(" | ").slice(0, 80)}`);
ok("console sem erros", errs.length === 0, errs.slice(0, 3).join(" | "));
console.log("TOTAL", Math.round((Date.now() - T) / 1000), "s");
await b.close();
process.exit(res.some((r) => !r.pass) ? 1 : 0);
