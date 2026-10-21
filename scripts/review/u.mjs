// U — usabilidade do workflow «Landing page completa» (uso: PW_DIR=$S/pw node scripts/review/u.mjs <P#>)
// Mede: cliques até rodar, estados legíveis, teclado/foco/aria, responsivo (1280/768/390), descobribilidade, contraste claro/escuro.
// Instância isolada em 5192/7092 com o claude de mentira (docs/WORKFLOW_REVIEW_LOOP_PROMPT.md). Nota 0–2 por critério.
import { pathToFileURL } from "node:url";
import { join } from "node:path";
const { chromium } = await import(pathToFileURL(join(process.env.PW_DIR ?? ".", "node_modules/playwright-core/index.mjs")).href);
const tag = process.argv[2] ?? "P1";
import { killAllSessions } from "./kill-all.mjs";
const API = "http://localhost:7092";
const b = await chromium.launch({ channel: "msedge", headless: true });
const ctx = await b.newContext({ viewport: { width: 1280, height: 800 }, colorScheme: "light" });
const p = await ctx.newPage();
const errs = [];
p.on("console", (m) => m.type() === "error" && errs.push(m.text()));
p.on("pageerror", (e) => errs.push(String(e)));
const score = [];
const note = (id, n, ev) => (score.push({ id, n }), console.log(`NOTA ${n}/2 ${id} — ${ev}`));
const chip = async () => (await p.locator(".wf-chip").innerText().catch(() => "")).trim();
const termText = async () => (await p.locator(".term-view:not([hidden]) .xterm-rows").innerText().catch(() => "")).replace(/ /g, " ");
const waitFor = async (fn, ms, label) => {
  const t = Date.now();
  while (Date.now() - t < ms) {
    if (await fn()) return;
    await p.waitForTimeout(150);
  }
  throw new Error("timeout: " + label);
};
const killAll = async () => {
  await p.goto("about:blank"); // sai do app antes: senão a página tenta reconectar e loga erro de WebSocket
  await p.waitForTimeout(1200); // sessões que a página ainda estava abrindo nascem logo depois de ela sair
  await killAllSessions(API);
  await p.waitForTimeout(400);
  await killAllSessions(API);
};
const NODE = "text=/Landing page\\s*completa/ >> visible=true";
const help = async () => (await p.locator(".prompts-side .pane-body p.hint").first().innerText().catch(() => "")).replace(/\s+/g, " ").trim();
let clicks = 0;
const click = async (loc) => (clicks++, loc.click({ timeout: 8000 }));

/** contraste WCAG entre o texto e o fundo efetivo (mistura os fundos translúcidos dos ancestrais sobre branco/preto da página) */
const contrastOf = (sel) =>
  p.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return null;
    const parse = (c) => (c.match(/[\d.]+/g) ?? []).map(Number);
    const lum = ([r, g, b]) => 0.2126 * ((r /= 255) <= 0.03928 ? r / 12.92 : ((r + 0.055) / 1.055) ** 2.4) + 0.7152 * ((g /= 255) <= 0.03928 ? g / 12.92 : ((g + 0.055) / 1.055) ** 2.4) + 0.0722 * ((b /= 255) <= 0.03928 ? b / 12.92 : ((b + 0.055) / 1.055) ** 2.4);
    const chain = [];
    for (let e = el; e; e = e.parentElement) chain.push(getComputedStyle(e).backgroundColor);
    let bg = document.documentElement.dataset.theme === "dark" || matchMedia("(prefers-color-scheme: dark)").matches ? [20, 20, 24] : [255, 255, 255];
    for (const c of chain.reverse()) {
      const v = parse(c);
      if (v.length >= 3) {
        const a = v[3] ?? 1;
        bg = bg.map((x, i) => Math.round(v[i] * a + x * (1 - a)));
      }
    }
    const fg = parse(getComputedStyle(el).color).slice(0, 3);
    const [l1, l2] = [lum(fg), lum(bg)].sort((a, b) => b - a);
    return Math.round(((l1 + 0.05) / (l2 + 0.05)) * 10) / 10;
  }, sel);

try {
  // ───────── 1. cliques até o passo 1 rodando ─────────
  await killAll();
  await p.goto("http://localhost:5192/app", { waitUntil: "load" });
  await p.locator(NODE).first().waitFor({ timeout: 10000 });
  await p.waitForTimeout(1500);
  const t0 = Date.now();
  await click(p.locator(NODE).first());
  await click(p.getByRole("button", { name: "▶ Executar no Claude Code" }));
  await p.waitForSelector(".prompts-side .pane-body");
  for (const [k, v] of [["produto", "FALHAR Forja3D"], ["publico", "makers"], ["tom", "técnico"]]) await p.locator(".prompts-side .pane-body label.field", { hasText: new RegExp(`^${k}$`) }).locator("input").fill(v);
  await click(p.getByRole("button", { name: "Executar", exact: true }));
  await p.locator(".wf-steps").waitFor();
  note("U1 cliques até rodar", clicks <= 4 ? 2 : clicks <= 6 ? 1 : 0, `${clicks} cliques + 3 campos, ${Date.now() - t0} ms (meta ≤ 4)`);

  // ───────── 2. estados legíveis (chip + texto de ajuda) ─────────
  const states = {};
  const grab = async (k) => (states[k] = { chip: await chip(), help: await help() });
  await waitFor(async () => (await chip()) === "Rodando", 5000, "rodando");
  await grab("rodando");
  await waitFor(async () => (await chip()) === "Falhou", 20000, "falhou");
  await grab("falhou");
  await p.screenshot({ path: `${tag}-U-falhou.png` });
  await p.getByRole("button", { name: "Pular" }).click();
  await waitFor(async () => (await chip()) === "Aguardando você", 15000, "aguardando");
  await p.waitForTimeout(800);
  await grab("aguardando");
  await p.screenshot({ path: `${tag}-U-aguardando-1280.png` });
  const prog = await p.locator(".wf-bar").getAttribute("role");
  // responsivo com o cartão de execução aberto
  const resp = [];
  for (const [w, h] of [[1280, 800], [768, 900], [390, 844]]) {
    await p.setViewportSize({ width: w, height: h });
    await p.waitForTimeout(500);
    const m = await p.evaluate(() => {
      const side = document.querySelector(".prompts-side");
      const r = side?.getBoundingClientRect();
      const cut = [...document.querySelectorAll(".prompts-side button, .prompts-side .wf-sname")].filter((e) => e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).overflow !== "visible" && !e.classList.contains("wf-sname")).length;
      const tb = document.querySelector(".term-body")?.getBoundingClientRect();
      return { termW: Math.round(tb?.width ?? 0), termH: Math.round(tb?.height ?? 0), docOverflow: document.documentElement.scrollWidth > innerWidth + 1, sideW: Math.round(r?.width ?? 0), sideRight: Math.round(r?.right ?? 0), vw: innerWidth, cutButtons: cut, sideOverflowX: side ? side.scrollWidth > side.clientWidth + 1 : false };
    });
    resp.push({ w, ...m });
    await p.screenshot({ path: `${tag}-U-card-${w}.png` });
  }
  await p.setViewportSize({ width: 1280, height: 800 });
  console.log("RESPONSIVO", JSON.stringify(resp));
  const respBad = resp.filter((r) => r.termW < 240 || r.termH < 100 || r.docOverflow || r.sideOverflowX || r.sideRight > r.vw + 1 || r.cutButtons > 0).length;
  note("U4 responsivo 1280/768/390", respBad === 0 ? 2 : respBad === 1 ? 1 : 0, resp.map((r) => `${r.w}px: painel ${r.sideW}px, terminal ${r.termW}×${r.termH}${r.termW < 240 ? " ESPREMIDO" : ""}${r.docOverflow ? " ROLAGEM-H" : ""}${r.sideOverflowX ? " painel-corta" : ""}${r.cutButtons ? ` ${r.cutButtons}-botões-cortados` : ""}`).join(" · "));

  await p.getByRole("button", { name: "Parar" }).click();
  await waitFor(async () => (await chip()) === "Parado", 5000, "parado");
  await grab("parado");
  const withHelp = Object.values(states).filter((s) => s.help.length > 15).length;
  console.log("ESTADOS", JSON.stringify(states));
  note("U2 estados legíveis (chip + ajuda + progresso)", withHelp === 4 && prog === "progressbar" ? 2 : withHelp >= 3 ? 1 : 0, `${withHelp}/4 estados com texto de ajuda; barra role=${prog}; falhou: «${states.falhou?.help}»`);

  // ───────── 3. teclado, foco e aria ─────────
  const ctrl = await p.evaluate(() => {
    const btns = [...document.querySelectorAll(".prompts-side button, .prompts-side summary, .prompts-side input")];
    const unnamed = btns.filter((e) => !(e.getAttribute("aria-label") || e.textContent?.trim() || e.getAttribute("title") || e.labels?.[0]?.textContent?.trim())).length;
    return { total: btns.length, unnamed, radiogroups: document.querySelectorAll(".prompts-side [role=radiogroup], .inspector [role=radiogroup]").length };
  });
  await p.getByRole("button", { name: "Rodar de novo" }).focus();
  await p.keyboard.press("Tab");
  const focusStyle = await p.evaluate(() => {
    const e = document.activeElement;
    const cs = e ? getComputedStyle(e) : null;
    return { tag: e?.tagName, label: e?.getAttribute("aria-label") || e?.textContent?.trim().slice(0, 20), outline: cs?.outlineStyle, outlineW: cs?.outlineWidth, shadow: cs?.boxShadow };
  });
  const visibleFocus = focusStyle.outline !== "none" || (focusStyle.shadow && focusStyle.shadow !== "none");
  // alcançar o formulário só pelo teclado: Rodar de novo → Executar do workflow (Enter) → campos por Tab
  note("U3 teclado/foco/aria", ctrl.unnamed === 0 && visibleFocus ? 2 : ctrl.unnamed <= 1 ? 1 : 0, `${ctrl.total} controles, ${ctrl.unnamed} sem nome acessível; foco em «${focusStyle.label}» ${visibleFocus ? "com" : "SEM"} indicador (${focusStyle.outline} ${focusStyle.outlineW})`);

  // ───────── 3b. caminho só por teclado: do formulário do workflow até a execução ─────────
  await killAll();
  await p.goto("http://localhost:5192/app", { waitUntil: "load" });
  await p.locator(NODE).first().waitFor({ timeout: 10000 });
  await p.waitForTimeout(1500);
  await p.locator(NODE).first().click();
  await p.getByRole("button", { name: "▶ Executar no Claude Code" }).click();
  await p.waitForSelector(".prompts-side .pane-body");
  await p.waitForTimeout(3500); // dá tempo de o terminal subir e (se for o caso) roubar o foco
  const focusAfterOpen = await p.evaluate(() => {
    const e = document.activeElement;
    return { inForm: !!e?.closest(".prompts-side .pane-body"), tag: e?.tagName, inTerm: !!e?.closest(".term-view") };
  });
  note("U3c foco depois de «Executar» do inspetor fica no formulário (não vai para o terminal)", focusAfterOpen.inForm && !focusAfterOpen.inTerm ? 2 : 0, JSON.stringify(focusAfterOpen));
  const trail = [];
  const label = () => p.evaluate(() => {
    const e = document.activeElement;
    return e ? `${e.tagName.toLowerCase()}:${(e.getAttribute("aria-label") || e.textContent || e.getAttribute("placeholder") || "").trim().replace(/\s+/g, " ").slice(0, 24)}` : "";
  });
  const typed = { produto: "Forja3D", publico: "makers", tom: "técnico" };
  let reachedExec = false;
  let kbOk = true;
  await p.keyboard.type(typed.produto); // o foco já está no primeiro campo (produto)
  for (let i = 0; i < 30 && !reachedExec; i++) {
    await p.keyboard.press("Tab");
    const l = await label();
    trail.push(l);
    const lab = await p.evaluate(() => document.activeElement?.closest("label.field")?.querySelector("span")?.textContent?.trim() ?? "");
    if (typed[lab] && l.startsWith("input")) await p.keyboard.type(typed[lab]);
    if (l.startsWith("summary:Permissões")) { await p.keyboard.press("Space"); await p.waitForTimeout(150); if (!(await p.locator(".prompts-side details.pane-more").first().evaluate((d) => d.open))) await p.keyboard.press("Space"); }
    if (l.startsWith("button:Executar")) reachedExec = true;
  }
  if (reachedExec) {
    const filled = await p.locator(".prompts-side .pane-body input.input").evaluateAll((els) => els.filter((e) => e.type !== "checkbox").map((e) => e.value));
    kbOk = filled.every(Boolean);
    await p.keyboard.press("Enter");
    await p.locator(".wf-steps").waitFor({ timeout: 6000 }).catch(() => (kbOk = false));
  }
  console.log("TECLADO", trail.join(" → "));
  note("U3b só por teclado: Tab até campos, Permissões e «Executar» (Enter inicia)", reachedExec && kbOk ? 2 : reachedExec ? 1 : 0, `${trail.length} Tabs; executar alcançado: ${reachedExec}; campos preenchidos e execução iniciada: ${kbOk}`);
  // (sem killAll aqui: o cartão de execução precisa seguir aberto para a checagem U5)

  // ───────── 5. descobribilidade: tooltips dos controles novos ─────────
  await p.getByRole("button", { name: "Fechar" }).click().catch(() => {});
  const tips = await p.evaluate(() => ({
    goto: !!document.querySelector('.prompts-side [aria-label^="Voltar para o passo"][title]'),
    mem: !!document.querySelector(".prompts-side .wf-res summary[title]") || !document.querySelector(".prompts-side .wf-res"),
    stop: !!document.querySelector('.prompts-side button[title*="parar" i], .prompts-side .pane-actions button'),
  }));
  console.log("DICAS", JSON.stringify(tips));
  note("U5 descobribilidade (tooltips: voltar ↺, memória, permissões)", tips.goto ? 2 : 1, `↺ com title: ${tips.goto}; memória com title: ${tips.mem}`);

  // ───────── 6. tema claro e escuro: contraste ─────────
  await killAll();
  const sels = [".wf-chip", ".wf-s small", ".prompts-tabs button", ".prompts-item", ".hint", ".wf-sname"];
  const themes = {};
  for (const scheme of ["light", "dark"]) {
    await p.emulateMedia({ colorScheme: scheme });
    await p.goto("http://localhost:5192/app", { waitUntil: "load" });
    await p.locator(NODE).first().waitFor({ timeout: 10000 });
    await p.waitForTimeout(1200);
    await p.locator(NODE).first().click();
    await p.getByRole("button", { name: "▶ Executar no Claude Code" }).click();
    await p.waitForSelector(".prompts-side .pane-body");
    await p.locator(".prompts-side .pane-body label.field", { hasText: /^produto$/ }).locator("input").fill("Forja3D");
    await p.locator(".prompts-side .pane-body label.field", { hasText: /^publico$/ }).locator("input").fill("makers");
    await p.locator(".prompts-side .pane-body label.field", { hasText: /^tom$/ }).locator("input").fill("técnico");
    await p.getByRole("button", { name: "Executar", exact: true }).click();
    await waitFor(async () => (await chip()) === "Aguardando você", 20000, "aguardando (tema)");
    await p.waitForTimeout(600);
    await p.locator(".wf-res summary").first().click().catch(() => {});
    themes[scheme] = {};
    for (const s of sels) themes[scheme][s] = await contrastOf(s);
    themes[scheme].sideW = await p.locator(".prompts-side").evaluate((e) => Math.round(e.getBoundingClientRect().width)); // com a memória aberta
    await p.screenshot({ path: `${tag}-U-tema-${scheme}.png` });
    await killAll();
  }
  console.log("CONTRASTE", JSON.stringify(themes));
  const low = Object.entries(themes).flatMap(([t, o]) => Object.entries(o).filter(([k, v]) => k !== "sideW" && v !== null && v < 4.5).map(([s, v]) => `${t} ${s}=${v}`));
  const wide = Object.entries(themes).filter(([, o]) => o.sideW > 300).map(([t, o]) => `${t} ${o.sideW}px`);
  note("U7 largura do painel estável ao abrir a memória (280px)", wide.length === 0 ? 2 : 0, wide.length ? `cresceu: ${wide.join(", ")} (empurra e remonta o terminal)` : "280px nos dois temas");
  note("U6 contraste claro/escuro (AA 4,5:1)", low.length === 0 ? 2 : low.length <= 2 ? 1 : 0, low.length ? `abaixo de 4,5: ${low.join("; ")}` : "todos ≥ 4,5:1");
} catch (e) {
  console.log("ERRO:", String(e).split("\n")[0]);
  await p.screenshot({ path: `${tag}-U-erro.png` }).catch(() => {});
}
note("console sem erros", errs.length === 0 ? 2 : 1, errs.slice(0, 2).join(" | ") || "0 erros");
const total = score.reduce((a, s) => a + s.n, 0);
console.log(`TOTAL U ${total}/${score.length * 2}`);
await b.close();
