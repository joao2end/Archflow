import assert from "node:assert/strict";
import { test } from "node:test";
import { win32 } from "node:path";

const { delimiter, join } = win32; // o resolvedor só procura no PATH do Windows
import { resolveClaudeCommand } from "./terminal";

test("fora do Windows o comando é claude", () => {
  assert.equal(resolveClaudeCommand({ platform: "linux", path: "" }), "claude");
});

test("no Windows usa o primeiro claude do PATH, com .exe antes de .cmd", () => {
  const native = join("C:", "Users", "a", ".local", "bin");
  const npm = join("C:", "npm");
  const path = [npm, native].join(delimiter);
  const files = new Set([join(npm, "claude.cmd"), join(native, "claude.exe")]);
  assert.equal(resolveClaudeCommand({ platform: "win32", path, exists: (f) => files.has(f) }), join(npm, "claude.cmd"));
  const onlyExe = new Set([join(native, "claude.exe")]);
  assert.equal(resolveClaudeCommand({ platform: "win32", path: native, exists: (f) => onlyExe.has(f) }), join(native, "claude.exe"));
});

test("sem claude no PATH cai em claude.exe", () => {
  assert.equal(resolveClaudeCommand({ platform: "win32", path: join("C:", "vazio"), exists: () => false }), "claude.exe");
});
