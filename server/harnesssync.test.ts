import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { MANIFEST, harnessDiff, readManifest, syncHarness } from "./harnesssync";

const dir = mkdtempSync(join(tmpdir(), "archflow-sync-"));
after(() => rmSync(dir, { recursive: true, force: true }));
const f = (path: string, content: string) => ({ path, content });
const read = (p: string) => readFileSync(join(dir, p), "utf8");

test("primeira gravação cria os arquivos e o manifesto", () => {
  const r = syncHarness(dir, [f(".claude/agents/a.md", "A1"), f(".claude/skills/s/SKILL.md", "S1")], [".claude"], "time.archflow.json");
  assert.deepEqual(r.written, [".claude/agents/a.md", ".claude/skills/s/SKILL.md"]);
  assert.equal(read(".claude/agents/a.md"), "A1");
  const m = readManifest(dir);
  assert.equal(m.diagram, "time.archflow.json");
  assert.deepEqual(Object.keys(m.files), [".claude/agents/a.md", ".claude/skills/s/SKILL.md"]);
});

test("sem mudança nada é regravado", () => {
  const r = syncHarness(dir, [f(".claude/agents/a.md", "A1"), f(".claude/skills/s/SKILL.md", "S1")], [".claude"], "time.archflow.json");
  assert.deepEqual(r.written, []);
  assert.equal(r.unchanged.length, 2);
});

test("atualiza o que o Archflow gravou e apaga o que saiu do diagrama (e a pasta vazia)", () => {
  const r = syncHarness(dir, [f(".claude/agents/a.md", "A2")], [".claude"], "time.archflow.json");
  assert.deepEqual(r.written, [".claude/agents/a.md"]);
  assert.deepEqual(r.removed, [".claude/skills/s/SKILL.md"]);
  assert.ok(!existsSync(join(dir, ".claude/skills")), "pasta da skill removida");
  assert.ok(!(".claude/skills/s/SKILL.md" in readManifest(dir).files));
});

test("edição manual é protegida: não sobrescreve nem apaga", () => {
  writeFileSync(join(dir, ".claude/agents/a.md"), "EDITADO");
  let r = syncHarness(dir, [f(".claude/agents/a.md", "A3")], [".claude"], "time.archflow.json");
  assert.deepEqual(r.conflicts, [".claude/agents/a.md"]);
  assert.equal(read(".claude/agents/a.md"), "EDITADO");
  r = syncHarness(dir, [], [".claude"], "time.archflow.json");
  assert.deepEqual(r.conflicts, [".claude/agents/a.md"]);
  assert.ok(existsSync(join(dir, ".claude/agents/a.md")));
});

test("force deixa o diagrama mandar", () => {
  const r = syncHarness(dir, [f(".claude/agents/a.md", "A3")], [".claude"], "time.archflow.json", true);
  assert.deepEqual(r.written, [".claude/agents/a.md"]);
  assert.equal(read(".claude/agents/a.md"), "A3");
});

test("arquivo que já existia fora do Archflow só é adotado se for idêntico", () => {
  writeFileSync(join(dir, ".claude/agents/b.md"), "B");
  const r = syncHarness(dir, [f(".claude/agents/a.md", "A3"), f(".claude/agents/b.md", "B")], [".claude"], "time.archflow.json");
  assert.deepEqual(r.unchanged.sort(), [".claude/agents/a.md", ".claude/agents/b.md"]);
  writeFileSync(join(dir, ".claude/agents/c.md"), "meu");
  const c = syncHarness(dir, [f(".claude/agents/c.md", "do diagrama")], [".claude"], "time.archflow.json");
  assert.deepEqual(c.conflicts, [".claude/agents/c.md"]);
  assert.equal(read(".claude/agents/c.md"), "meu");
});

test("só mexe nas pastas administradas: o outro alvo fica intacto", () => {
  syncHarness(dir, [f(".cursor/agents/a.md", "CA")], [".cursor"], "time.archflow.json");
  syncHarness(dir, [], [".claude"], "time.archflow.json", true);
  assert.equal(read(".cursor/agents/a.md"), "CA");
  assert.ok(".cursor/agents/a.md" in readManifest(dir).files);
  assert.ok(existsSync(join(dir, MANIFEST)));
});

/* ───────── .mcp.json: arquivo compartilhado, mesclado por servidor ───────── */

const mcp = (servers: Record<string, unknown>) => ({ path: ".mcp.json", content: `${JSON.stringify({ mcpServers: servers }, null, 2)}\n` });
const readMcp = (d: string) => JSON.parse(readFileSync(join(d, ".mcp.json"), "utf8"));

test("mcp: cria o arquivo, atualiza e remove só o servidor gerenciado, preservando o que o usuário pôs", () => {
  const d = mkdtempSync(join(tmpdir(), "archflow-mcp-"));
  try {
    const roots = [".claude", ".mcp.json"];
    let r = syncHarness(d, [mcp({ playwright: { type: "stdio", command: "npx" } })], roots, "t.archflow.json");
    assert.deepEqual(r.written, [".mcp.json#playwright"]);
    // o usuário adiciona o próprio servidor e uma chave que não é de servidor
    const user = readMcp(d);
    user.mcpServers.meu = { type: "http", url: "https://meu" };
    user.outra = 1;
    writeFileSync(join(d, ".mcp.json"), JSON.stringify(user));
    r = syncHarness(d, [mcp({ playwright: { type: "stdio", command: "npx", args: ["-y"] } })], roots, "t.archflow.json");
    assert.deepEqual(r.written, [".mcp.json#playwright"]);
    assert.deepEqual(readMcp(d).mcpServers.playwright.args, ["-y"]);
    assert.ok(readMcp(d).mcpServers.meu && readMcp(d).outra === 1);
    r = syncHarness(d, [], roots, "t.archflow.json");
    assert.deepEqual(r.removed, [".mcp.json#playwright"]);
    assert.deepEqual(Object.keys(readMcp(d).mcpServers), ["meu"]);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("mcp: servidor editado à mão é conflito (não sobrescreve nem apaga); force manda o diagrama", () => {
  const d = mkdtempSync(join(tmpdir(), "archflow-mcp-"));
  try {
    const roots = [".claude", ".mcp.json"];
    syncHarness(d, [mcp({ s: { type: "stdio", command: "a" } })], roots, "t.archflow.json");
    const edited = readMcp(d);
    edited.mcpServers.s.command = "manual";
    writeFileSync(join(d, ".mcp.json"), JSON.stringify(edited));
    let r = syncHarness(d, [mcp({ s: { type: "stdio", command: "b" } })], roots, "t.archflow.json");
    assert.deepEqual(r.conflicts, [".mcp.json#s"]);
    assert.equal(readMcp(d).mcpServers.s.command, "manual");
    r = syncHarness(d, [], roots, "t.archflow.json");
    assert.deepEqual(r.conflicts, [".mcp.json#s"]);
    r = syncHarness(d, [mcp({ s: { type: "stdio", command: "b" } })], roots, "t.archflow.json", true);
    assert.equal(readMcp(d).mcpServers.s.command, "b");
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("mcp: arquivo que só tinha servidores gerenciados some junto; servidor igual já existente é adotado", () => {
  const d = mkdtempSync(join(tmpdir(), "archflow-mcp-"));
  try {
    const roots = [".claude", ".mcp.json"];
    writeFileSync(join(d, ".mcp.json"), JSON.stringify({ mcpServers: { s: { type: "stdio", command: "a" } } }));
    let r = syncHarness(d, [mcp({ s: { type: "stdio", command: "a" } })], roots, "t.archflow.json");
    assert.deepEqual(r.unchanged, [".mcp.json#s"]);
    r = syncHarness(d, [], roots, "t.archflow.json");
    assert.deepEqual(r.removed, [".mcp.json#s"]);
    assert.ok(!existsSync(join(d, ".mcp.json")));
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("harnessDiff: só leitura; aponta ausente, alterado e sobra do diagrama", () => {
  const d = mkdtempSync(join(tmpdir(), "archflow-diff-"));
  try {
    const files = [f(".claude/agents/a.md", "A"), f(".claude/agents/b.md", "B"), f(".mcp.json", JSON.stringify({ mcpServers: { x: { command: "x" } } }))];
    assert.deepEqual(harnessDiff(d, files, [".claude", ".mcp.json"]).sort(), [".claude/agents/a.md", ".claude/agents/b.md", ".mcp.json#x"]);
    assert.ok(!existsSync(join(d, ".claude")), "não grava nada");
    syncHarness(d, files, [".claude", ".mcp.json"], "t.archflow.json");
    assert.deepEqual(harnessDiff(d, files, [".claude", ".mcp.json"]), []);
    writeFileSync(join(d, ".claude/agents/a.md"), "EDITADO");
    assert.deepEqual(harnessDiff(d, files, [".claude", ".mcp.json"]), [".claude/agents/a.md"]);
    // b saiu do diagrama mas ainda está no disco; o servidor x mudou
    const next = [f(".claude/agents/a.md", "EDITADO"), f(".mcp.json", JSON.stringify({ mcpServers: { x: { command: "y" } } }))];
    assert.deepEqual(harnessDiff(d, next, [".claude", ".mcp.json"]).sort(), [".claude/agents/b.md", ".mcp.json#x"]);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});
