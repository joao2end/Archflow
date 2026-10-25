// Grava os vídeos da landing (public/landing/*.webm|mp4|jpg) usando o app de verdade.
// Cada cena dirige a UI com o Playwright e/ou manda operações pelo bridge (POST /api/ops, como o MCP),
// captura a tela por CDP screencast e gera WebM (VP9), MP4 (H.264) e o pôster (último quadro).
//
// Requer: playwright-core, ffmpeg-static e o Microsoft Edge instalado (npm i --no-save playwright-core ffmpeg-static).
// Uso:
//   node scripts/dev-sandbox.mjs                       (outro terminal: app vazio em :5188, sem tocar nos seus projetos)
//   node docs/promo/record-landing.mjs [cena ...]      (cenas: mcp library domain logic agents present; sem argumento = todas)
import { chromium } from "playwright-core";
import ffmpegPath from "ffmpeg-static";
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const BASE = process.env.BASE || "http://localhost:5188";
const OUT = process.env.OUT || join(dirname(fileURLToPath(import.meta.url)), "..", "..", "public", "landing");
const W = 1280;
const H = 800;
const FPS = 30;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(path, body) {
  const r = await fetch(BASE + path, body === undefined ? {} : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const t = await r.text();
  try {
    return JSON.parse(t);
  } catch {
    return t;
  }
}
const ops = (list, source = "mcp") => api("/api/ops", { ops: list, source });
const files = async () => (await api("/api/workspace")).files.map((f) => f.path);

async function open() {
  const browser = await chromium.launch({ channel: "msedge", args: ["--force-device-scale-factor=1", "--hide-scrollbars"] });
  const page = await (await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, colorScheme: "light" })).newPage();
  page.on("pageerror", (e) => console.log("pageerror", e.message));
  await page.goto(BASE + "/app");
  await sleep(2500);
  return { browser, page };
}

/* ───────── captura ───────── */

async function record(page, name, fn) {
  const cdp = await page.context().newCDPSession(page);
  const frames = [];
  cdp.on("Page.screencastFrame", async (f) => {
    frames.push({ t: f.metadata.timestamp, data: Buffer.from(f.data, "base64") });
    await cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {});
  });
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: 92, maxWidth: W, maxHeight: H, everyNthFrame: 1 });
  await fn();
  await sleep(200);
  await cdp.send("Page.stopScreencast");
  if (!frames.length) throw new Error(`${name}: nenhum quadro capturado`);
  // o screencast só manda quadro quando a tela muda: reamostra para fps constante repetindo o último
  const t0 = frames[0].t;
  const n = Math.floor((frames[frames.length - 1].t - t0) * FPS);
  const seq = [];
  for (let i = 0, k = 0; i < n; i++) {
    while (k + 1 < frames.length && frames[k + 1].t <= t0 + i / FPS) k++;
    seq.push(frames[k].data);
  }
  console.log(`${name}: ${(n / FPS).toFixed(1)} s`);
  const out = join(OUT, name);
  const enc = (args) =>
    new Promise((res, rej) => {
      const ff = spawn(ffmpegPath, ["-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", String(FPS), "-c:v", "mjpeg", "-i", "pipe:0", ...args], { stdio: ["pipe", "inherit", "inherit"] });
      ff.on("close", (c) => (c ? rej(new Error(`ffmpeg saiu com ${c}`)) : res()));
      (async () => {
        for (const b of seq) if (!ff.stdin.write(b)) await new Promise((r) => ff.stdin.once("drain", r));
        ff.stdin.end();
      })();
    });
  await enc(["-c:v", "libx264", "-preset", "slow", "-crf", "26", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-an", out + ".mp4"]);
  await enc(["-c:v", "libvpx-vp9", "-b:v", "0", "-crf", "40", "-row-mt", "1", "-deadline", "good", "-cpu-used", "2", "-an", out + ".webm"]);
  await enc(["-vf", `select=eq(n\\,${seq.length - 1})`, "-frames:v", "1", "-q:v", "4", out + ".jpg"]);
}

/* ───────── ponteiro e legenda (o screencast não mostra o cursor do sistema) ───────── */

async function cursor(page) {
  await page.addStyleTag({
    content: `#__cur{position:fixed;left:0;top:0;z-index:2147483647;pointer-events:none;transform:translate(-3px,-2px)}
#__cur svg{filter:drop-shadow(0 2px 3px rgba(0,0,0,.35))}
#__cur.down::after{content:"";position:absolute;left:-10px;top:-10px;width:24px;height:24px;border-radius:50%;background:rgba(112,111,211,.35);animation:__p .35s ease-out}
@keyframes __p{from{transform:scale(.4);opacity:1}to{transform:scale(1.4);opacity:0}}`,
  });
  await page.evaluate(() => {
    const d = document.createElement("div");
    d.id = "__cur";
    d.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24"><path d="M4 2l16 9-7 2-3 7z" fill="#fff" stroke="#25244a" stroke-width="1.6" stroke-linejoin="round"/></svg>';
    document.body.appendChild(d);
    addEventListener("mousemove", (e) => ((d.style.left = e.clientX + "px"), (d.style.top = e.clientY + "px")), true);
    addEventListener("mousedown", () => (d.classList.remove("down"), void d.offsetWidth, d.classList.add("down")), true);
  });
}
const glide = (page, x, y, ms = 600) => page.mouse.move(x, y, { steps: Math.max(8, Math.round(ms / 16)) });
async function clickAt(page, x, y, ms = 600) {
  await glide(page, x, y, ms);
  await sleep(120);
  await page.mouse.down();
  await sleep(60);
  await page.mouse.up();
}
async function clickEl(page, locator, ms = 600) {
  const b = await locator.boundingBox();
  if (!b) throw new Error(`elemento fora da tela: ${locator}`);
  await clickAt(page, b.x + b.width / 2, b.y + b.height / 2, ms);
}

/** Legenda no rodapé: o pedido do usuário ou a tool MCP que o agente está chamando. Vazio = esconde. */
async function hud(page, html) {
  await page.evaluate((html) => {
    let d = document.getElementById("__hud");
    if (!d) {
      const s = document.createElement("style");
      s.textContent = `#__hud{position:fixed;left:50%;bottom:96px;z-index:2147483646;transform:translateX(-50%);display:flex;align-items:center;gap:12px;padding:12px 18px 12px 14px;border-radius:16px;
        background:rgba(37,36,74,.92);color:#fcfcfa;font:500 15px/1.3 "Inter Tight",system-ui,sans-serif;box-shadow:0 18px 40px -12px rgba(37,36,74,.55);pointer-events:none;transition:opacity .3s;white-space:nowrap}
        #__hud .ag{display:inline-flex;align-items:center;gap:8px;font-weight:650;color:#c9c6ff;padding-right:12px;border-right:1px solid rgba(255,255,255,.18)}
        #__hud .ag i{width:9px;height:9px;border-radius:50%;background:#a9dc76;box-shadow:0 0 0 4px rgba(169,220,118,.2);animation:__hb 1s infinite}
        #__hud .ag.you{color:#ffd58a}#__hud .ag.you i{background:#ffd58a;box-shadow:0 0 0 4px rgba(255,213,138,.2)}
        #__hud code{font:600 14px ui-monospace,"Cascadia Mono",Consolas,monospace;color:#ffd58a}
        @keyframes __hb{50%{opacity:.4}}`;
      document.head.appendChild(s);
      d = document.createElement("div");
      d.id = "__hud";
      document.body.appendChild(d);
    }
    d.style.opacity = html ? "1" : "0";
    if (html) d.innerHTML = html;
  }, html);
}
const said = (text) => `<span class="ag you"><i></i>Você</span><span>${text}</span>`;
const calls = (tool, rest = "") => `<span class="ag"><i></i>Claude · MCP</span><code>${tool}</code><span>${rest}</span>`;

/** O agente monta o diagrama passo a passo: cada passo mostra a tool, aplica as operações, reorganiza e enquadra. */
async function agentBuilds(page, ask, steps) {
  await hud(page, said(ask));
  await sleep(2100);
  for (const [tool, text, list] of steps) {
    await hud(page, calls(tool, text));
    if (list.length) {
      const bad = (await ops(list)).results.filter((r) => !r.ok);
      if (bad.length) console.log(tool, bad);
    }
    await ops([{ op: "layout", direction: "LR" }]);
    await sleep(250);
    await page.keyboard.press("f");
    await sleep(950);
  }
}

/* ───────── preparação: projeto e exemplos ───────── */

async function installExample(tab, title) {
  const { browser, page } = await open();
  await page.keyboard.press("Escape");
  await page.keyboard.press("e");
  await sleep(600);
  await page.getByText("Exemplos", { exact: true }).first().click();
  await sleep(400);
  await page.getByRole("tab", { name: new RegExp(tab) }).click();
  await sleep(400);
  await page.locator(".ex-item", { hasText: title }).first().getByRole("button", { name: /Instalar e abrir|Abrir/ }).click();
  await sleep(2500);
  await browser.close();
}

async function setup() {
  const ws = await api("/api/workspace");
  if (!ws.configured) {
    const parent = ws.project.path.replace(/[\\/][^\\/]+$/, "");
    await api("/api/projects/create", { name: "Demo", parent });
  }
  const have = await files();
  if (!have.includes(LOGIC_FILE)) await installExample("Lógica", "Busca binária");
}
const LOGIC_FILE = "exemplos-logic/algoritmos/busca-binaria-primeira-ocorrencia.archflow.json";

/* ───────── cenas ───────── */

const SCENES = {
  /** Hero: o agente desenha o checkout pelo MCP. */
  async mcp() {
    await api("/api/diagrams", { title: "Checkout", mode: "architecture", blank: true });
    const { browser, page } = await open();
    await record(page, "mcp", async () => {
      await agentBuilds(page, "“Desenhe o checkout: Next.js, Laravel, Postgres, Redis, SQS e Stripe”", [
        ["add_components", "Loja Web · Next.js", [{ op: "add_node", id: "web", asset: "nextjs", label: "Loja Web", technology: "Next.js" }]],
        ["add_groups", "AWS · sa-east-1", [{ op: "add_group", id: "aws", label: "AWS · sa-east-1", kind: "cloud" }, { op: "add_node", id: "api", asset: "laravel", label: "Orders API", technology: "Laravel 11", parent: "aws" }]],
        ["connect", "Loja Web → Orders API · POST /orders", [{ op: "add_connection", from: "web", to: "api", type: "sync", protocol: "HTTPS", label: "POST /orders" }]],
        ["add_components", "Orders DB · PostgreSQL", [{ op: "add_node", id: "db", asset: "postgresql", label: "Orders DB", parent: "aws" }, { op: "add_connection", from: "api", to: "db", type: "data", protocol: "SQL" }]],
        ["add_components", "Cache · Redis", [{ op: "add_node", id: "cache", asset: "redis", label: "Cache", parent: "aws" }, { op: "add_connection", from: "api", to: "cache", type: "data" }]],
        ["connect", "Orders API → SQS · OrderCreated (async)", [{ op: "add_node", id: "q", asset: "aws-sqs", label: "order-events", parent: "aws" }, { op: "add_connection", from: "api", to: "q", type: "async", label: "OrderCreated" }]],
        ["add_components", "Recomendações · Claude", [{ op: "add_node", id: "ai", asset: "anthropic-claude", label: "Recomendações", parent: "aws" }, { op: "add_connection", from: "q", to: "ai", type: "async", label: "consome" }]],
        ["add_components", "Stripe", [{ op: "add_node", id: "pay", asset: "stripe", label: "Stripe" }, { op: "add_connection", from: "api", to: "pay", type: "sync", protocol: "HTTPS", label: "cobra" }]],
        ["auto_layout", "camadas por fluxo", []],
        ["validate_diagram", "✓ 0 erros", []],
      ]);
      await sleep(1400);
      await hud(page, "");
      await sleep(1200);
    });
    await browser.close();
  },

  /** Arquitetura à mão: biblioteca, arrastar, ligar pelo "+" e escolher o tipo da conexão. */
  async library() {
    await api("/api/diagrams", { title: "Pedidos", mode: "architecture", blank: true });
    await ops(
      [
        { op: "add_node", id: "web", asset: "nextjs", label: "Loja Web", technology: "Next.js", x: 0, y: 0 },
        { op: "add_node", id: "api", asset: "laravel", label: "Orders API", technology: "Laravel 11", x: 300, y: 0 },
        { op: "add_node", id: "db", asset: "postgresql", label: "Orders DB", x: 600, y: -110 },
        { op: "add_connection", from: "web", to: "api", type: "sync", protocol: "HTTPS", label: "POST /orders" },
        { op: "add_connection", from: "api", to: "db", type: "data", protocol: "SQL" },
      ],
      "file",
    );
    const { browser, page } = await open();
    await page.keyboard.press("f");
    await sleep(600);
    await page.locator("[aria-label='Diminuir zoom']").click();
    await sleep(600);
    await cursor(page);
    await page.mouse.move(W / 2, H - 200);
    const box = (sel) => page.locator(sel).first().boundingBox();
    await record(page, "library", async () => {
      await sleep(1000);
      await page.keyboard.press("b");
      await sleep(900);
      await clickEl(page, page.locator("#asset-search"), 700);
      await page.keyboard.type("cache", { delay: 110 });
      await sleep(700);
      const ib = await page.locator(".library .asset", { hasText: "Redis" }).first().boundingBox();
      await glide(page, ib.x + ib.width / 2, ib.y + ib.height / 2, 700);
      await sleep(1600);
      const db = await box("[data-id='db'][data-role='node']");
      await page.mouse.down();
      await page.mouse.move(db.x + db.width / 2, db.y + db.height * 2.6, { steps: 40 });
      await page.mouse.up();
      await sleep(700);
      await page.keyboard.press("Escape");
      await page.keyboard.press("b");
      await sleep(800);
      const apiB = await box("[data-id='api'][data-role='node']");
      await glide(page, apiB.x + apiB.width / 2, apiB.y + apiB.height / 2, 700);
      await sleep(500);
      const hb = await box("[data-role='handle'][data-id='api'][data-side='right']");
      await glide(page, hb.x + hb.width / 2, hb.y + hb.height / 2, 400);
      await page.mouse.down();
      const ids = await page.locator("[data-role='node']").evaluateAll((els) => els.map((e) => e.getAttribute("data-id")));
      const rb = await box(`[data-id='${ids.find((i) => !["web", "api", "db"].includes(i))}'][data-role='node']`);
      await page.mouse.move(rb.x + rb.width / 2, rb.y + rb.height / 2, { steps: 45 });
      await page.mouse.up();
      await sleep(900);
      const lb = await page.locator("text=Síncrona").last().boundingBox().catch(() => null);
      if (lb) await clickAt(page, lb.x + lb.width / 2, lb.y + lb.height / 2, 600);
      await sleep(1300);
      await clickEl(page, page.locator("button", { hasText: "Acesso a" }).first(), 700);
      await sleep(1300);
      await page.keyboard.press("Escape");
      await sleep(1400);
    });
    await browser.close();
  },

  /** Domain: anéis da Clean Architecture em 2D, a visão 3D, órbita e busca. Atores e sistemas ficam fora do contexto: uma só camada externa. */
  async domain() {
    await api("/api/diagrams", { title: "Agenda", mode: "domain", blank: true });
    const N = (id, label, ddd, parent = "agenda") => ({ op: "add_node", id, label, ddd, parent });
    const C = (from, to, rel) => ({ op: "add_connection", from, to, ddd: { rel } });
    const bad = (
      await ops(
        [
          { op: "add_group", id: "agenda", label: "Agenda", kind: "context", subdomain: "core" },
          N("consulta", "Consulta", { role: "aggregate-root", invariants: ["um horário só tem uma consulta"] }),
          N("horario", "Horário", { role: "entity" }),
          N("periodo", "Período", { role: "value-object" }),
          N("agendada", "consulta-agendada", { role: "domain-event" }),
          N("cancelada", "consulta-cancelada", { role: "domain-event" }),
          N("uc-agendar", "Agendar consulta", { role: "use-case", actor: "Paciente", goal: "marcar um horário com um profissional" }),
          N("uc-cancelar", "Cancelar consulta", { role: "use-case", actor: "Paciente", goal: "liberar o horário" }),
          N("agendar", "agendar-consulta", { role: "command" }),
          N("cancelar", "cancelar-consulta", { role: "command" }),
          N("lembrete", "enviar-lembrete", { role: "policy" }),
          N("ctrl", "AgendaController", { role: "controller" }),
          N("repo", "ConsultaRepository", { role: "repository", for: "consulta" }),
          N("rm", "Agenda do dia", { role: "read-model" }),
          { op: "add_node", id: "paciente", label: "Paciente", kind: "actor" },
          { op: "add_node", id: "whats", label: "WhatsApp", kind: "external" },
          C("consulta", "horario", "contains"),
          C("horario", "periodo", "contains"),
          C("agendar", "uc-agendar", "realizes"),
          C("cancelar", "uc-cancelar", "realizes"),
          C("ctrl", "agendar", "triggers"),
          C("ctrl", "cancelar", "triggers"),
          C("agendar", "consulta", "triggers"),
          C("cancelar", "consulta", "triggers"),
          C("consulta", "agendada", "emits"),
          C("consulta", "cancelada", "emits"),
          C("agendada", "lembrete", "triggers"),
          C("agendada", "rm", "triggers"),
          C("agendar", "repo", "uses"),
          { op: "add_connection", from: "paciente", to: "ctrl", type: "association", label: "agenda" },
          { op: "add_connection", from: "lembrete", to: "whats", type: "dependency", label: "envia" },
          { op: "layout", style: "onion" },
        ],
        "file",
      )
    ).results.filter((r) => !r.ok);
    if (bad.length) console.log("domain", bad);
    const { browser, page } = await open();
    await page.keyboard.press("f");
    await sleep(800);
    await cursor(page);
    await page.mouse.move(W / 2 + 200, H / 2 + 150);
    await record(page, "domain", async () => {
      await sleep(1500);
      await clickEl(page, page.locator(".iso-toggle"), 900);
      await sleep(3800);
      await glide(page, W / 2 + 120, H / 2 + 60, 400);
      await page.mouse.down({ button: "middle" });
      await page.mouse.move(W / 2 - 240, H / 2 + 60, { steps: 90 });
      await page.mouse.up({ button: "middle" });
      await sleep(900);
      await page.keyboard.press("/");
      await sleep(300);
      await page.keyboard.type("Consulta", { delay: 90 });
      await sleep(500);
      await page.keyboard.press("Enter");
      await sleep(3500);
    });
    await browser.close();
  },

  /** Logic: reprodução de um cenário, passo a passo, e o modo Depurar. */
  async logic() {
    await api("/api/diagrams/open", { name: LOGIC_FILE });
    const { browser, page } = await open();
    await page.keyboard.press("f");
    await sleep(900);
    await page.locator("[aria-label='Aumentar zoom']").click();
    await sleep(500);
    await cursor(page);
    await page.mouse.move(W - 420, H - 160);
    await record(page, "logic", async () => {
      await sleep(1300);
      await clickEl(page, page.locator("[aria-label='Reproduzir o cenário x aparece repetido']"), 900);
      await sleep(500);
      await clickEl(page, page.locator(".lp-min"), 500); // painel recolhido: o desenho fica à vista
      await page.keyboard.press("Escape"); // fecha o inspetor; a reprodução continua
      await sleep(300);
      await page.selectOption("[aria-label='Velocidade da reprodução']", "2").catch(() => {});
      await glide(page, W / 2 + 260, H / 2 - 60, 700);
      await sleep(8500);
      await clickEl(page, page.locator(".logic-play-panel").getByText("Depurar", { exact: true }), 700);
      await sleep(3800);
    });
    await browser.close();
  },

  /** Agents: o agente monta o time pelo MCP e o harness do Claude Code aparece pronto. */
  async agents() {
    await api("/api/diagrams", { title: "Time de conteúdo", mode: "agents", blank: true });
    const A = (id, agent, label = id) => ({ op: "add_node", id, kind: "agent", label, agent });
    const R = (from, to, agent) => ({ op: "add_connection", from, to, agent });
    const { browser, page } = await open();
    await cursor(page);
    await page.mouse.move(W - 200, H - 180);
    await record(page, "agents", async () => {
      await agentBuilds(page, "“Monte um time que pesquisa, escreve e publica artigos”", [
        ["add_components", "agent · editor-chefe", [A("editor-chefe", { role: "agent", description: "Coordena o time: recebe a pauta, delega pesquisa e redação e revisa o texto final antes de publicar.", model: "opus" })]],
        ["add_components", "agent · pesquisador", [A("pesquisador", { role: "agent", description: "Levanta fontes confiáveis e dados sobre o tema da pauta e entrega um resumo com links.", model: "sonnet" }), R("editor-chefe", "pesquisador", { rel: "delegates", usage: "passa a pauta e recebe docs/pesquisa.md" })]],
        ["add_components", "tool · WebSearch", [A("web-search", { role: "tool", toolType: "native", toolName: "WebSearch" }, "WebSearch"), R("pesquisador", "web-search", { rel: "uses-tool", usage: "para achar fontes recentes" })]],
        ["add_components", "agent · redator", [A("redator", { role: "agent", description: "Escreve o artigo a partir da pesquisa, no tom da marca, com títulos e chamadas.", model: "sonnet" }), R("editor-chefe", "redator", { rel: "delegates", usage: "passa a pesquisa aprovada e recebe o rascunho" })]],
        ["connect", "redator → tom-da-marca · uses-skill", [A("tom-da-marca", { role: "skill", description: "Guia de voz da marca: vocabulário, frases proibidas e exemplos de títulos aprovados para manter o mesmo tom." }), R("redator", "tom-da-marca", { rel: "uses-skill", usage: "ao escrever títulos e chamadas" })]],
        ["connect", "redator → artigo.md · produces", [A("artigo", { role: "output", fileKind: "md", fileName: "artigo.md" }, "artigo.md"), R("redator", "artigo", { rel: "produces" })]],
        [
          "add_components",
          "workflow · Publicar artigo (2 passos)",
          [
            A("publicar", { role: "workflow" }, "Publicar artigo"),
            A("pesquisar-pauta", { role: "prompt", text: "Pesquise o tema {{entrada}} e salve docs/pesquisa.md" }, "Pesquisar pauta"),
            A("escrever", { role: "prompt", text: "Escreva o artigo a partir de docs/pesquisa.md e revise antes de entregar" }, "Escrever e revisar"),
            R("publicar", "pesquisar-pauta", { rel: "step", order: 1, mode: "auto" }),
            R("publicar", "escrever", { rel: "step", order: 2, mode: "auto" }),
            R("pesquisar-pauta", "pesquisador", { rel: "runs-on" }),
            R("escrever", "editor-chefe", { rel: "runs-on" }),
          ],
        ],
        ["validate_diagram", "✓ 0 erros · 0 avisos", []],
      ]);
      await sleep(800);
      await hud(page, "");
      await clickEl(page, page.getByLabel("Exportar o harness"), 900);
      await sleep(1600);
      await glide(page, W / 2 + 200, H / 2 + 120, 800);
      await page.mouse.wheel(0, 500);
      await sleep(1800);
    });
    await browser.close();
  },

  /** Apresentação (tecla P) com o roteiro automático: o mesmo exemplo "Plataforma de Pedidos" do primeiro uso do app. */
  async present() {
    await api("/api/diagrams", { title: "Plataforma de Pedidos", mode: "architecture", blank: true });
    await ops(
      [
        { op: "set_meta", description: "Exemplo: e-commerce com API Laravel, fila de eventos e IA para recomendações. Peça ao seu agente (via MCP) para evoluir este diagrama." },
        { op: "add_node", id: "customer", asset: "user", label: "Cliente" },
        { op: "add_node", id: "storefront", asset: "nextjs", label: "Loja Web", description: "Catálogo, carrinho e checkout (SSR)." },
        { op: "add_group", id: "aws", label: "AWS · sa-east-1", kind: "cloud" },
        { op: "add_group", id: "backend", label: "Orders Context", kind: "context", parent: "aws", description: "Bounded context de pedidos." },
        { op: "add_node", id: "api-gw", asset: "aws-api-gateway", label: "API Gateway", parent: "aws" },
        { op: "add_node", id: "orders-api", asset: "laravel", label: "Orders API", technology: "Laravel 11 / PHP 8.3", description: "Cria e consulta pedidos; publica eventos de domínio.", parent: "backend" },
        { op: "add_node", id: "orders-db", asset: "postgresql", label: "Orders DB", parent: "backend", props: { engine: "PostgreSQL 16", sla: "99.95%" } },
        { op: "add_node", id: "events", asset: "aws-sqs", label: "order-events", parent: "aws" },
        { op: "add_node", id: "recommender", asset: "anthropic-claude", label: "Recomendações", description: "Gera sugestões a partir do histórico do pedido.", parent: "aws" },
        { op: "add_node", id: "payments", asset: "stripe", label: "Stripe" },
        { op: "add_connection", from: "customer", to: "storefront", type: "sync", protocol: "HTTPS", label: "navega" },
        {
          op: "add_connection", from: "storefront", to: "api-gw", type: "sync", protocol: "HTTPS/REST", label: "POST /orders",
          interface: { name: "Orders API v1", kind: "rest", contract: "openapi: ./openapi/orders.yaml", operations: [{ name: "createOrder", method: "POST", path: "/orders", request: "{ items: [{sku, qty}], customerId }", response: "201 { orderId, status }" }, { name: "getOrder", method: "GET", path: "/orders/{id}", response: "200 Order" }] },
        },
        { op: "add_connection", from: "api-gw", to: "orders-api", type: "sync", protocol: "HTTP", label: "proxy" },
        { op: "add_connection", from: "orders-api", to: "orders-db", type: "data", protocol: "TCP/5432", label: "SQL" },
        { op: "add_connection", from: "orders-api", to: "events", type: "async", label: "OrderCreated", protocol: "SQS" },
        { op: "add_connection", from: "events", to: "recommender", type: "stream", label: "consome" },
        { op: "add_connection", from: "orders-api", to: "payments", type: "sync", protocol: "HTTPS", label: "cobra" },
        { op: "layout", direction: "LR" },
      ],
      "file",
    );
    const { browser, page } = await open();
    await page.keyboard.press("f");
    await sleep(800);
    await record(page, "present", async () => {
      await sleep(1200);
      await page.keyboard.press("p");
      await sleep(2600);
      for (let i = 0; i < 5; i++) {
        await page.keyboard.press("ArrowRight");
        await sleep(2300);
      }
    });
    await browser.close();
  },
};

const want = process.argv.slice(2);
for (const n of want) if (!SCENES[n]) throw new Error(`cena desconhecida: ${n} (use ${Object.keys(SCENES).join(", ")})`);
mkdirSync(OUT, { recursive: true });
await setup();
for (const n of want.length ? want : Object.keys(SCENES)) await SCENES[n]();
