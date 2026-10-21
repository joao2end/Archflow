// P — performance do workflow (uso: PW_DIR=$S/pw node scripts/review/p.mjs <P#>). Instância isolada em 5192/7092, claude = fake com FAKE_CLAUDE_DELAY_MS=1200.
// Mede: carga do app, abertura do formulário, 1ª linha do passo 1, overhead entre passos, tarefas longas, heap em 3 execuções seguidas,
// quadros do canvas (44 nós) e a aba com saída grande (20 mil caracteres). Imprime METRICA <id> <valor> e NOTA por critério.
import { pathToFileURL } from "node:url";
import { join } from "node:path";
const { chromium } = await import(pathToFileURL(join(process.env.PW_DIR ?? ".", "node_modules/playwright-core/index.mjs")).href);
const tag = process.argv[2] ?? "P1";
import { killAllSessions } from "./kill-all.mjs";
const API = "http://localhost:7092";
// BASE: use o build de produção (vite preview na 5193) para medir carga; o dev server (5192) carrega centenas de módulos e não representa o usuário
const BASE = process.env.BASE ?? "http://localhost:5192";
const b = await chromium.launch({ channel: "msedge", headless: true, args: ["--enable-precise-memory-info"] });
const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
const errs = [];
p.on("console", (m) => m.type() === "error" && errs.push(m.text()));
p.on("pageerror", (e) => errs.push(String(e)));
await p.addInitScript(() => {
  window.__long = [];
  try {
    new PerformanceObserver((l) => l.getEntries().forEach((e) => window.__long.push(Math.round(e.duration)))).observe({ entryTypes: ["longtask"] });
  } catch {}
});
const res = [];
const nota = (id, ok, ev) => (res.push({ id, ok }), console.log(`${ok ? "OK " : "FALHA"} ${id} — ${ev}`));
const met = (id, v) => console.log(`METRICA ${id} ${v}`);
const NODE = "text=/Landing page\\s*completa/ >> visible=true";
const chip = async () => (await p.locator(".wf-chip").innerText().catch(() => "")).trim();
const termText = async () => (await p.locator(".term-view:not([hidden]) .xterm-rows").innerText().catch(() => "")).replace(/ /g, " ");
const waitFor = async (fn, ms, label) => {
  const t = Date.now();
  while (Date.now() - t < ms) {
    if (await fn()) return Date.now() - t;
    await p.waitForTimeout(40);
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
const heap = () => p.evaluate(() => Math.round((performance.memory?.usedJSHeapSize ?? 0) / 1024 / 1024 * 10) / 10);
const longs = () => p.evaluate(() => window.__long.slice());
const fill = async (produto) => {
  for (const [k, v] of [["produto", produto], ["publico", "makers"], ["tom", "técnico"]]) await p.locator(".prompts-side .pane-body label.field", { hasText: new RegExp(`^${k}$`) }).locator("input").fill(v);
};
const manual = async () => {
  await waitFor(async () => /❯ \S/.test(await termText()), 20000, "texto digitado");
  await p.locator(".term-view:not([hidden]) .xterm").click({ timeout: 5000 }).catch(() => {});
  await p.keyboard.press("Enter");
  await waitFor(async () => /RESPOSTA \d+ \(fake\)/.test(await termText()), 15000, "resposta");
  await p.waitForTimeout(2600); // o fake ainda termina a rodada (2 × delay)
  await p.getByRole("button", { name: "Próximo passo" }).click({ timeout: 4000 }).catch(() => {});
};

try {
  // ───────── carga do app com o diagrama de 44 nós ─────────
  await killAll();
  const tNav = Date.now();
  await p.goto(`${BASE}/app`, { waitUntil: "load" });
  const nav = await p.evaluate(() => { const n = performance.getEntriesByType("navigation")[0]; return { dcl: Math.round(n.domContentLoadedEventEnd), load: Math.round(n.loadEventEnd) }; });
  await p.locator(NODE).first().waitFor({ timeout: 15000 });
  const tNodes = Date.now() - tNav;
  met("carga_dcl_ms", nav.dcl); met("carga_load_ms", nav.load); met("nos_visiveis_ms", tNodes);
  nota("P1 carga do app (load < 2 s; nós visíveis < 3 s)", nav.load < 2000 && tNodes < 3000, `DCL ${nav.dcl} ms · load ${nav.load} ms · nós visíveis ${tNodes} ms`);
  await p.waitForTimeout(800);

  // ───────── canvas: zoom e arrasto com 44 nós (quadros lentos) ─────────
  await p.evaluate(() => { window.__frames = []; let last = performance.now(); const f = (t) => { window.__frames.push(Math.round(t - last)); last = t; window.__raf = requestAnimationFrame(f); }; window.__raf = requestAnimationFrame(f); });
  await p.mouse.move(640, 300);
  for (let i = 0; i < 12; i++) { await p.mouse.wheel(0, i < 6 ? -120 : 120); await p.waitForTimeout(40); }
  await p.keyboard.down("Space");
  await p.mouse.down();
  for (let i = 0; i < 30; i++) await p.mouse.move(640 + i * 6, 300 + i * 3);
  await p.mouse.up();
  await p.keyboard.up("Space");
  await p.waitForTimeout(300);
  const fr = await p.evaluate(() => { cancelAnimationFrame(window.__raf); return window.__frames.slice(2); });
  const slow = fr.filter((x) => x > 50).length;
  const p95 = [...fr].sort((a, b) => a - b)[Math.floor(fr.length * 0.95)] ?? 0;
  met("canvas_quadros", fr.length); met("canvas_quadros_gt50ms", slow); met("canvas_p95_ms", p95);
  nota("P5 canvas 44 nós (zoom + arrasto): quadros > 50 ms ≤ 5% e p95 < 50 ms", slow <= Math.max(1, fr.length * 0.05) && p95 < 50, `${fr.length} quadros · ${slow} > 50 ms · p95 ${p95} ms`);

  // ───────── abertura do formulário e 1ª linha do passo 1 ─────────
  await p.reload({ waitUntil: "load" }); // zoom/arrasto do teste anterior deixaram o nó fora de vista
  await p.locator(NODE).first().waitFor({ timeout: 15000 });
  await p.waitForTimeout(800);
  await p.locator(NODE).first().click();
  const tOpen = Date.now();
  await p.getByRole("button", { name: "▶ Executar no Claude Code" }).click();
  await p.waitForSelector(".prompts-side .pane-body");
  const open = Date.now() - tOpen;
  await fill("Forja3D");
  const tRun = Date.now();
  await p.getByRole("button", { name: "Executar", exact: true }).click();
  await p.locator(".wf-steps").waitFor();
  const firstLine = await waitFor(async () => /sessão iniciada/.test(await termText()), 10000, "1ª linha");
  const cardMs = Date.now() - tRun - firstLine;
  met("abrir_formulario_ms", open); met("primeira_linha_ms", Date.now() - tRun);
  nota("P2 abertura do formulário < 1,5 s e 1ª linha do passo 1 < 1,5 s", open < 1500 && Date.now() - tRun < 1500, `formulário ${open} ms · «Executar» → 1ª linha ${Date.now() - tRun} ms`);

  // ───────── overhead entre passos: aba do passo 1 sai → aba do passo 2 existe ─────────
  const tSaiu = await p.evaluate(() => new Promise((ok) => {
    const t0 = performance.now(); let saiu = null;
    const iv = setInterval(() => {
      const tabs = [...document.querySelectorAll(".term-tab")];
      const t1 = tabs.find((t) => /1\/9/.test(t.textContent) && /saiu/.test(t.textContent));
      const t2 = tabs.find((t) => /2\/9/.test(t.textContent));
      if (t1 && saiu === null) saiu = performance.now();
      if (t2) { clearInterval(iv); ok({ overhead: Math.round(performance.now() - (saiu ?? performance.now())), total: Math.round(performance.now() - t0), sawExit: saiu !== null }); }
      if (performance.now() - t0 > 20000) { clearInterval(iv); ok({ overhead: -1, total: -1, sawExit: saiu !== null }); }
    }, 25);
  }));
  met("overhead_entre_passos_ms", tSaiu.overhead);
  nota("P3 overhead entre passos < 2,5 s (do fim do auto ao próximo passo existir)", tSaiu.overhead >= 0 && tSaiu.overhead < 2500, `${tSaiu.overhead} ms (aba do passo 1 «saiu» → aba do passo 2)${tSaiu.sawExit ? "" : " [saída não observada]"}`);

  // ───────── 3 execuções seguidas do workflow curto: heap e tarefas longas ─────────
  const heaps = [await heap()];
  for (let n = 1; n <= 3; n++) {
    await killAll();
    await p.goto(`${BASE}/app`, { waitUntil: "load" });
    await p.locator(NODE).first().waitFor({ timeout: 15000 });
    await p.waitForTimeout(800);
    await p.locator(NODE).first().click();
    await p.getByRole("button", { name: "▶ Executar no Claude Code" }).click();
    await p.waitForSelector(".prompts-side .pane-body");
    await fill("Forja3D");
    await p.getByRole("button", { name: "Executar", exact: true }).click();
    await waitFor(async () => (await chip()) === "Aguardando você", 25000, `execução ${n}: passo 2`);
    // percorre os passos manuais seguintes até concluir (limite de tempo curto: o ponto é medir, não completar)
    for (let i = 0; i < 3; i++) { await manual(); if ((await chip()) === "Concluído") break; }
    heaps.push(await heap());
  }
  met("heap_mb_por_execucao", heaps.join(" → "));
  const grew = heaps[heaps.length - 1] - heaps[1];
  nota("P4 heap JS não cresce sem parar em 3 execuções (recarregando a página, cresce < 40 MB)", heaps[0] > 0 && grew < 40, `heap (MB): ${heaps.join(" → ")}`);

  // ───────── aba com saída grande (20 mil caracteres) num shell ─────────
  await killAll();
  await p.goto(`${BASE}/app`, { waitUntil: "load" });
  await p.waitForTimeout(1500);
  await p.getByRole("button", { name: "Terminal" }).click();
  await p.locator(".term-panel").waitFor({ state: "visible" });
  await p.waitForTimeout(1500);
  await p.getByRole("button", { name: "Outros tipos de sessão" }).click();
  await p.getByText("Novo shell").click();
  await p.waitForTimeout(2500);
  await p.locator(".term-view:not([hidden]) .xterm").click();
  const before = (await longs()).length;
  const tBig = Date.now();
  await p.keyboard.type(`node -e "for(let i=0;i<400;i++)console.log(String(i).padStart(3,'0')+' '+'x'.repeat(46))" && echo FIM_GRANDE`);
  await p.keyboard.press("Enter");
  await waitFor(async () => (await termText()).includes("FIM_GRANDE"), 20000, "fim da saída grande");
  const bigMs = Date.now() - tBig;
  const tClick = Date.now();
  await p.getByRole("button", { name: "Prompts" }).click();
  await p.locator(".prompts-side").waitFor({ state: "visible" });
  const clickMs = Date.now() - tClick;
  const bigLong = (await longs()).slice(before);
  const maxLong = Math.max(0, ...bigLong);
  met("saida_20k_ms", bigMs); met("clique_apos_saida_ms", clickMs); met("tarefas_longas_na_saida", bigLong.length); met("maior_tarefa_longa_ms", maxLong);
  nota("P6 saída de ~20 mil caracteres: renderiza < 6 s, UI responde (clique < 500 ms) e nenhuma tarefa longa > 200 ms", bigMs < 6000 && clickMs < 500 && maxLong < 200, `${bigMs} ms para a saída · clique ${clickMs} ms · ${bigLong.length} tarefas longas (maior ${maxLong} ms)`);

  const all = await longs();
  met("tarefas_longas_total", `${all.length} (maior ${Math.max(0, ...all)} ms)`);
  nota("P7 tarefas longas (> 50 ms) na sessão toda: nenhuma passa de 200 ms", Math.max(0, ...all) < 200, `${all.length} no total, maior ${Math.max(0, ...all)} ms`);
} catch (e) {
  console.log("ERRO:", String(e).split("\n")[0]);
  await p.screenshot({ path: `${tag}-P-erro.png` }).catch(() => {});
  res.push({ id: "erro", ok: false });
}
nota("console sem erros", errs.length === 0, errs.slice(0, 2).join(" | ") || "0 erros");
console.log(`TOTAL P ${res.filter((r) => r.ok).length}/${res.length}`);
await b.close();
