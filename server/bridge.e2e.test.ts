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
