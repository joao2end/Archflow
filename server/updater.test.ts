import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import { UpdateError, checkUpdate, compareVersions, downloadUpdate, installUpdate, pickAsset, resetUpdater, setUpdateHooks, updateState } from "./updater";

afterEach(resetUpdater);

/** Os nomes como estão na release 0.4.1 (o GitHub troca o espaço do instalador por ponto). */
const ASSETS = ["Archflow.Setup.0.6.0.exe", "Archflow-0.6.0-mac-arm64.dmg", "Archflow-0.6.0-mac-x64.dmg", "Archflow-0.6.0-linux-x86_64.AppImage"].map((name) => ({ name }));

test("compareVersions: semver simples, com ou sem v; pré-release vem antes da final", () => {
  assert.equal(compareVersions("0.5.0", "0.4.1"), 1);
  assert.equal(compareVersions("v0.4.1", "0.4.1"), 0);
  assert.equal(compareVersions("0.4.10", "0.4.9"), 1);
  assert.equal(compareVersions("1.0", "1.0.1"), -1);
  assert.equal(compareVersions("1.0.0-beta.1", "1.0.0"), -1);
});

test("pickAsset: o pacote certo de cada sistema", () => {
  assert.equal(pickAsset(ASSETS, "win32", "x64")?.name, "Archflow.Setup.0.6.0.exe");
  assert.equal(pickAsset([{ name: "Archflow Setup 0.6.0.exe" }], "win32", "x64")?.name, "Archflow Setup 0.6.0.exe");
  assert.equal(pickAsset(ASSETS, "darwin", "arm64")?.name, "Archflow-0.6.0-mac-arm64.dmg");
  assert.equal(pickAsset(ASSETS, "darwin", "x64")?.name, "Archflow-0.6.0-mac-x64.dmg");
  assert.equal(pickAsset(ASSETS, "linux", "x64")?.name, "Archflow-0.6.0-linux-x86_64.AppImage");
  assert.equal(pickAsset(ASSETS, "freebsd", "x64"), undefined);
});

const bytes = new TextEncoder().encode("instalador de mentira ".repeat(5000));
const sha = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const NAME = pickAsset(ASSETS, process.platform, process.arch)?.name ?? "Archflow.Setup.0.6.0.exe";

function fakeFetch(release: object | number, body: Uint8Array = bytes): typeof fetch {
  return (async (url: string | URL) => {
    if (String(url).includes("api.github.com")) return typeof release === "number" ? new Response("{}", { status: release }) : Response.json(release);
    return new Response(body as unknown as BodyInit);
  }) as typeof fetch;
}
const release = (tag: string, digest: string | null = sha) => ({ tag_name: tag, body: "## Novidades\n- algo", html_url: "https://github.com/x/releases/tag/" + tag, published_at: "2026-11-06T00:00:00Z", assets: [{ name: NAME, size: bytes.byteLength, browser_download_url: "https://github.com/x/" + NAME, digest }] });

test("checkUpdate: versão nova fica disponível com notas e pacote; a mesma versão diz que está em dia", async () => {
  setUpdateHooks({ version: "0.5.0", quit: () => {}, relaunch: () => {} });
  const s = await checkUpdate({ force: true, fetchImpl: fakeFetch(release("v0.6.0")) });
  assert.equal(s.phase, "available");
  assert.equal(s.latest, "0.6.0");
  assert.equal(s.asset?.name, NAME);
  assert.match(s.notes ?? "", /Novidades/);
  assert.equal((await checkUpdate({ force: true, fetchImpl: fakeFetch(release("v0.5.0")) })).phase, "none");
});

test("checkUpdate: erros do GitHub viram mensagem clara", async () => {
  assert.match((await checkUpdate({ force: true, fetchImpl: fakeFetch(404) })).error ?? "", /nenhuma versão publicada/);
  assert.match((await checkUpdate({ force: true, fetchImpl: fakeFetch(403) })).error ?? "", /limitou/);
});

const waitPhase = async (not: string) => {
  for (let i = 0; i < 200 && updateState().phase === not; i++) await new Promise((r) => setTimeout(r, 10));
  return updateState();
};

test("downloadUpdate: baixa, confere o SHA-256 e fica pronto; arquivo adulterado é descartado", async () => {
  const dir = mkdtempSync(join(tmpdir(), "archflow-upd-"));
  try {
    setUpdateHooks({ version: "0.5.0", quit: () => {}, relaunch: () => {} });
    await checkUpdate({ force: true, fetchImpl: fakeFetch(release("v0.6.0")) });
    downloadUpdate({ dir, fetchImpl: fakeFetch(release("v0.6.0")) });
    const ok = await waitPhase("downloading");
    assert.equal(ok.phase, "ready", ok.error ?? "");
    assert.equal(readFileSync(join(dir, NAME)).byteLength, bytes.byteLength);

    resetUpdater();
    rmSync(join(dir, NAME));
    setUpdateHooks({ version: "0.5.0", quit: () => {}, relaunch: () => {} });
    await checkUpdate({ force: true, fetchImpl: fakeFetch(release("v0.6.0")) });
    downloadUpdate({ dir, fetchImpl: fakeFetch(release("v0.6.0"), new TextEncoder().encode("outra coisa")) });
    const bad = await waitPhase("downloading");
    assert.equal(bad.phase, "error");
    assert.match(bad.error ?? "", /não confere com o hash/);
    assert.deepEqual(readdirSync(dir), [], "nada sobra na pasta");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("downloadUpdate e installUpdate recusam o que não dá para fazer com segurança", async () => {
  assert.throws(() => downloadUpdate(), UpdateError, "sem verificar antes");
  setUpdateHooks({ version: "0.5.0", quit: () => {}, relaunch: () => {} });
  await checkUpdate({ force: true, fetchImpl: fakeFetch(release("v0.6.0", null)) });
  assert.throws(() => downloadUpdate(), /não publicou o hash/);
  await assert.rejects(installUpdate(), /baixe a atualização antes/);
  assert.equal(existsSync(join(tmpdir(), "archflow-update", NAME)), false);
});
