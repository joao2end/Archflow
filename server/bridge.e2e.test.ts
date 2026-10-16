/**
 * Bridge por HTTP: projetos em disco (inclusive a migração dos antigos «cofres») e a gravação do harness
 * dentro do projeto aberto. Tudo em pastas temporárias — nada toca o projeto nem a configuração do usuário.
 */
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { applyOps, type Op } from "../src/shared/ops";
import { emptyDoc, type AgentNodeSpec, type Doc } from "../src/shared/schema";

const tmp = mkdtempSync(join(tmpdir(), "archflow-bridge-"));
const cfgDir = join(tmp, "cfg");
const legacy = join(tmp, "antigo-cofre");

const freePort = () =>
  new Promise<number>((ok, fail) => {
    const s = createServer();
    s.once("error", fail);
    s.listen(0, "127.0.0.1", () => {
      const p = (s.address() as { port: number }).port;
      s.close(() => ok(p));
    });
  });

// a configuração de um usuário da versão «cofre»: lista em `vaults` e a pasta já com o `.archflow/vault.json`
mkdirSync(join(legacy, ".archflow"), { recursive: true });
writeFileSync(join(legacy, ".archflow", "vault.json"), JSON.stringify({ name: "Antigo", schema: "archflow-vault/1" }));
mkdirSync(cfgDir, { recursive: true });
writeFileSync(join(cfgDir, "config.json"), JSON.stringify({ vaults: [{ id: "antigo-1234", name: "Antigo", path: legacy }], active: "antigo-1234" }));

const port = await freePort();
process.env.ARCHFLOW_PORT = String(port);
process.env.ARCHFLOW_CONFIG = cfgDir;
process.env.ARCHFLOW_DATA = join(tmp, "data");
const { ensureBridge, stopBridge } = await import("./bridge");
await ensureBridge(port);

const BASE = `http://127.0.0.1:${port}`;
async function api<T = any>(path: string, body?: unknown): Promise<{ status: number; json: T }> {
  const r = await fetch(BASE + path, {
    method: body === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, json: (await r.json()) as T };
}
const put = (body: unknown) => fetch(`${BASE}/api/doc`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

after(() => {
  stopBridge();
  rmSync(tmp, { recursive: true, force: true });
});

test("o projeto antigo (cofre) abre normalmente e a configuração migra para `projects`", async () => {
  const { json: ws } = await api<{ project: { name: string; path: string }; projects: { id: string }[]; configured: boolean }>("/api/workspace");
  assert.equal(ws.project.path, legacy);
  assert.equal(ws.project.name, "Antigo");
  assert.ok(ws.configured);
  assert.deepEqual(ws.projects.map((p) => p.id), ["antigo-1234"]);

  const cfg = JSON.parse(readFileSync(join(cfgDir, "config.json"), "utf8"));
  assert.deepEqual(cfg.projects.map((p: { id: string }) => p.id), ["antigo-1234"]);
  assert.equal(cfg.vaults, undefined, "a lista antiga sai do arquivo");
  assert.ok(existsSync(join(legacy, ".archflow", "project.json")), "vault.json vira project.json");
});

test("criar e trocar de projeto", async () => {
  const created = await api<{ project: { name: string } }>("/api/projects/create", { name: "Novo", parent: tmp });
  assert.equal(created.status, 200);
  assert.equal(created.json.project.name, "Novo");
  assert.ok(existsSync(join(tmp, "Novo", ".archflow", "project.json")));

  const back = await api<{ project: { path: string } }>("/api/projects/switch", { id: "antigo-1234" });
  assert.equal(back.json.project.path, legacy);
});

const agentDoc = (): Doc => {
  const an = (id: string, agent: AgentNodeSpec): Op => ({ op: "add_node", id, label: id, kind: "agent", agent });
  const { doc, results } = applyOps(emptyDoc("Time", "agents"), [
    an("revisor", { role: "agent", description: "Revisa pull requests: bugs, estilo e segurança." }),
    an("checklist", { role: "skill", description: "Checklist de revisão: estilo, testes e segurança.", body: "# Checklist\n" }),
    { op: "add_connection", from: "revisor", to: "checklist", agent: { rel: "uses-skill" } },
  ]);
  assert.ok(results.every((r) => r.ok), results.find((r) => !r.ok)?.error ?? "op falhou");
  return doc;
};

test("o harness do diagrama agents é gravado na pasta do projeto aberto", async () => {
  assert.equal((await put({ doc: agentDoc(), source: "test" })).status, 200);

  const claude = await api<{ root: string; files: string[] }>("/api/harness", { target: "claude" });
  assert.equal(claude.status, 200);
  assert.equal(claude.json.root, legacy);
  assert.deepEqual(claude.json.files, [".claude/agents/revisor.md", ".claude/skills/checklist/SKILL.md"]);
  assert.match(readFileSync(join(legacy, ".claude", "agents", "revisor.md"), "utf8"), /^name: revisor$/m);
  assert.match(readFileSync(join(legacy, ".claude", "skills", "checklist", "SKILL.md"), "utf8"), /# Checklist/);

  const cursor = await api<{ files: string[] }>("/api/harness", { target: "cursor" });
  assert.deepEqual(cursor.json.files, [".cursor/agents/revisor.md", ".cursor/skills/checklist/SKILL.md"]);
  assert.ok(existsSync(join(legacy, ".cursor", "agents", "revisor.md")));
});

test("harness: target inválido e diagrama que não é modo agents voltam com erro explicativo", async () => {
  const bad = await api<{ error: string }>("/api/harness", { target: "copilot" });
  assert.equal(bad.status, 400);
  assert.match(bad.json.error, /target inválido/);

  assert.equal((await put({ doc: emptyDoc("Arquitetura"), source: "test" })).status, 200);
  const wrong = await api<{ error: string }>("/api/harness", { target: "claude" });
  assert.equal(wrong.status, 422);
  assert.match(wrong.json.error, /modo "architecture"/);
});

const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));
const until = async (cond: () => boolean, ms = 4000) => {
  for (let t = 0; t < ms && !cond(); t += 100) await sleep(100);
  return cond();
};

test("o harness é regravado sozinho a cada edição do diagrama agents (alvo por projeto, órfãos limpos)", async () => {
  const created = await api<{ project: { path: string } }>("/api/projects/create", { name: "Auto", parent: tmp });
  const root = created.json.project.path;
  await api("/api/diagrams", { title: "Time", mode: "agents" });
  const { json: ws } = await api<{ current: string }>("/api/workspace");
  assert.equal((await put({ doc: agentDoc(), file: ws.current, source: "test" })).status, 200);

  assert.ok(await until(() => existsSync(join(root, ".claude", "agents", "revisor.md"))), "grava .claude/ sem ninguém pedir");
  assert.ok(existsSync(join(root, ".claude", "skills", "checklist", "SKILL.md")));
  assert.ok(!existsSync(join(root, ".cursor")), "o padrão é só Claude Code");
  assert.ok(existsSync(join(root, "archflow.agents.json")));

  const set = await api<{ targets: string[] }>("/api/harness/settings", { targets: ["claude", "cursor"] });
  assert.deepEqual(set.json.targets, ["claude", "cursor"]);
  assert.ok(await until(() => existsSync(join(root, ".cursor", "agents", "revisor.md"))), "ligar o Cursor grava .cursor/");
  assert.equal((await api("/api/harness/settings", { targets: ["vscode"] })).status, 400);

  // a skill sai do diagrama: o arquivo gerado some junto
  const { doc } = applyOps(agentDoc(), [{ op: "remove", id: "checklist" }]);
  assert.equal((await put({ doc, file: ws.current, source: "test" })).status, 200);
  assert.ok(await until(() => !existsSync(join(root, ".claude", "skills", "checklist"))), "órfão apagado");
  assert.ok(existsSync(join(root, ".claude", "agents", "revisor.md")));

  // edição manual no .md não é sobrescrita pela sincronização automática
  writeFileSync(join(root, ".claude", "agents", "revisor.md"), "meu texto");
  const edited = applyOps(doc, [{ op: "update", id: "revisor", patch: { agent: { role: "agent", description: "Revisa pull requests com outra descrição bem completa." } } }]).doc;
  assert.equal((await put({ doc: edited, file: ws.current, source: "test" })).status, 200);
  await sleep(1500);
  assert.equal(readFileSync(join(root, ".claude", "agents", "revisor.md"), "utf8"), "meu texto");
  assert.match(readFileSync(join(root, ".cursor", "agents", "revisor.md"), "utf8"), /outra descrição/);
});

test("env-check: só diz se a variável existe, nunca o valor", async () => {
  process.env.ARCHFLOW_TESTE_DEFINIDA = "valor-secreto";
  delete process.env.ARCHFLOW_TESTE_AUSENTE;
  const r = await api<Record<string, boolean>>("/api/mcp/env-check?names=ARCHFLOW_TESTE_DEFINIDA,ARCHFLOW_TESTE_AUSENTE,1invalida,ruim-nome");
  assert.equal(r.status, 200);
  assert.deepEqual(r.json, { ARCHFLOW_TESTE_DEFINIDA: true, ARCHFLOW_TESTE_AUSENTE: false });
  assert.ok(!JSON.stringify(r.json).includes("valor-secreto"));
  assert.deepEqual((await api("/api/mcp/env-check")).json, {});
});

test("probe: exige confirmação explícita e devolve as tools do servidor", async () => {
  const fixture = join(process.cwd(), "server", "fixtures", "fake-mcp-server.mjs");
  const spec = { transport: "stdio", command: process.execPath, args: [fixture] };
  const sem = await api<{ error: string }>("/api/mcp/probe", spec);
  assert.equal(sem.status, 400);
  assert.match(sem.json.error, /confirm: true/);
  assert.equal((await api("/api/mcp/probe", { ...spec, confirm: "sim" })).status, 400, "só o booleano true vale");
  const ok = await api<{ tools: { name: string }[]; server: { name: string } }>("/api/mcp/probe", { ...spec, confirm: true });
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.json.tools.map((t) => t.name), ["browser_navigate", "browser_click", "browser_snapshot"]);
  assert.equal(ok.json.server.name, "fake-mcp");
  const quebrado = await api<{ error: string }>("/api/mcp/probe", { transport: "stdio", command: "comando-que-nao-existe-archflow", confirm: true });
  assert.equal(quebrado.status, 502);
  assert.match(quebrado.json.error, /não deu para executar/);
  assert.equal((await api("/api/mcp/probe", { command: 5, confirm: true })).status, 400);
});

test("harness com Tools: tools nativas, MCP inline e compartilhado, .mcp.json e .cursor/mcp.json, variáveis por alvo", async () => {
  const created = await api<{ project: { path: string } }>("/api/projects/create", { name: "ComTools", parent: tmp });
  const root = created.json.project.path;
  await api("/api/diagrams", { title: "Time", mode: "agents" });
  const { json: ws } = await api<{ current: string }>("/api/workspace");
  const tool = (id: string, agent: Record<string, unknown>): Op => ({ op: "add_node", id, kind: "agent", agent: { role: "tool", ...agent } as AgentNodeSpec });
  const uses = (from: string, to: string, extra: Record<string, unknown> = {}): Op => ({ op: "add_connection", from, to, agent: { rel: "uses-tool", usage: "Usa quando a tarefa pede essa ferramenta.", ...extra } as never });
  const { doc, results } = applyOps(emptyDoc("Time", "agents"), [
    { op: "add_node", id: "dev", kind: "agent", agent: { role: "agent", description: "Implementa as mudanças pedidas no código do projeto." } },
    { op: "add_node", id: "qa", kind: "agent", agent: { role: "agent", description: "Testa a entrega no navegador e confere o resultado." } },
    tool("bash", { toolType: "native", toolName: "Bash" }),
    tool("pw", { toolType: "mcp", transport: "stdio", command: "npx", args: ["-y", "@playwright/mcp@latest"], description: "Controla um navegador." }),
    tool("gh", { toolType: "mcp", transport: "http", url: "https://api.githubcopilot.com/mcp/", headers: { Authorization: "Bearer ${GITHUB_TOKEN}" }, description: "GitHub." }),
    uses("dev", "bash"), uses("dev", "pw"), uses("qa", "pw"), uses("dev", "gh", { allow: ["create_issue"] }),
  ]);
  assert.ok(results.every((r) => r.ok), results.find((r) => !r.ok)?.error ?? "op falhou");
  assert.equal((await put({ doc, file: ws.current, source: "test" })).status, 200);
  await api("/api/harness/settings", { targets: [] }); // sem sincronização automática: só o pedido explícito grava

  const claude = await api<{ files: string[]; conflicts: string[] }>("/api/harness", { target: "claude" });
  assert.equal(claude.status, 200);
  assert.ok(claude.json.files.includes(".mcp.json"));
  const dev = readFileSync(join(root, ".claude", "agents", "dev.md"), "utf8");
  assert.match(dev, /tools:\n  - Bash\n  - mcp__gh__create_issue\n  - mcp__pw\n/);
  // gh é de um só agente: definição inline (com a variável ${GITHUB_TOKEN} intacta); pw é de 2: referência por nome
  assert.match(dev, /mcpServers:\n  - \{"gh":\{"type":"http","url":"https:\/\/api\.githubcopilot\.com\/mcp\/","headers":\{"Authorization":"Bearer \$\{GITHUB_TOKEN\}"\}\}\}\n  - pw\n/);
  assert.match(readFileSync(join(root, ".claude", "agents", "qa.md"), "utf8"), /mcpServers:\n  - pw\n/);
  assert.deepEqual(Object.keys(JSON.parse(readFileSync(join(root, ".mcp.json"), "utf8")).mcpServers), ["pw"]);

  const cursor = await api<{ files: string[] }>("/api/harness", { target: "cursor" });
  assert.ok(cursor.json.files.includes(".cursor/mcp.json"));
  const cmcp = JSON.parse(readFileSync(join(root, ".cursor", "mcp.json"), "utf8")).mcpServers;
  assert.deepEqual(Object.keys(cmcp), ["gh", "pw"]);
  assert.equal(cmcp.gh.headers.Authorization, "Bearer ${env:GITHUB_TOKEN}", "o Cursor usa a sintaxe ${env:VAR}");
  assert.doesNotMatch(readFileSync(join(root, ".cursor", "agents", "dev.md"), "utf8"), /mcpServers/);

  // uma edição do usuário no .mcp.json (servidor próprio) sobrevive à regravação
  const mcpPath = join(root, ".mcp.json");
  const j = JSON.parse(readFileSync(mcpPath, "utf8"));
  j.mcpServers.meu = { type: "http", url: "https://meu.example/mcp" };
  writeFileSync(mcpPath, JSON.stringify(j));
  await api("/api/harness", { target: "claude" });
  assert.deepEqual(Object.keys(JSON.parse(readFileSync(mcpPath, "utf8")).mcpServers).sort(), ["meu", "pw"]);

  // status: em dia logo depois de gravar; edição manual de um agente deixa «desatualizado» (só leitura, não grava)
  type Status = { applicable: boolean; stale: string[]; foreign?: boolean };
  const em = await api<Status>("/api/harness/status?target=claude");
  assert.equal(em.json.applicable, true);
  assert.deepEqual(em.json.stale, []);
  assert.equal(em.json.foreign, false);
  writeFileSync(join(root, ".claude", "agents", "qa.md"), "editado à mão");
  const velho = await api<Status>("/api/harness/status?target=claude");
  assert.deepEqual(velho.json.stale, [".claude/agents/qa.md"]);
  assert.equal(readFileSync(join(root, ".claude", "agents", "qa.md"), "utf8"), "editado à mão", "o status não grava nada");
});

test("prompts: biblioteca por projeto, normalizada, em .archflow/prompts.json", async () => {
  const created = await api<{ project: { path: string } }>("/api/projects/create", { name: "ComPrompts", parent: tmp });
  const root = created.json.project.path;
  type Lib = { library: { prompts: { id: string; name: string; text: string }[]; workflows: { id: string; steps: { promptId: string; mode: string }[] }[] }; dropped: string[] };
  const vazio = await api<Lib>("/api/prompts");
  assert.equal(vazio.status, 200);
  assert.deepEqual(vazio.json.library.prompts, []);
  const putJson = (body: unknown) => fetch(`${BASE}/api/prompts`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  assert.equal((await putJson({})).status, 400);
  const ok = await putJson({
    library: {
      prompts: [{ name: "Revisar PR", text: "Revise {{arquivo}}", agent: "dev" }, { name: "", text: "x" }],
      workflows: [{ name: "Entrega", steps: [{ promptId: "revisar-pr", mode: "auto" }, { promptId: "nao-existe" }] }],
    },
  });
  assert.equal(ok.status, 200);
  const out = (await ok.json()) as Lib;
  assert.deepEqual(out.library.prompts.map((p) => p.id), ["revisar-pr"]);
  assert.deepEqual(out.library.workflows[0].steps, [{ promptId: "revisar-pr", mode: "auto" }]);
  assert.equal(out.dropped.length, 2);
  // gravou no disco, e uma nova leitura devolve o mesmo
  assert.deepEqual(JSON.parse(readFileSync(join(root, ".archflow", "prompts.json"), "utf8")), out.library);
  assert.deepEqual((await api<Lib>("/api/prompts")).json.library, out.library);
  // arquivo corrompido não derruba: volta vazio
  writeFileSync(join(root, ".archflow", "prompts.json"), "{ nao e json");
  assert.deepEqual((await api<Lib>("/api/prompts")).json.library.prompts, []);
});
