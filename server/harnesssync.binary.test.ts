import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { harnessDiff, syncHarness } from "./harnesssync";

test("arquivo binário (base64) vai para o disco como bytes e é reconhecido na sincronização seguinte", () => {
  const dir = mkdtempSync(join(tmpdir(), "harness-bin-"));
  const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 255, 10, 13]);
  const files = [{ path: ".claude/files/logo.png", content: bytes.toString("base64"), encoding: "base64" as const }];

  const first = syncHarness(dir, files, [".claude"], "teste");
  assert.deepEqual(first.written, [".claude/files/logo.png"]);
  assert.ok(readFileSync(join(dir, ".claude", "files", "logo.png")).equals(bytes));
  assert.deepEqual(harnessDiff(dir, files, [".claude"]), []);

  const second = syncHarness(dir, files, [".claude"], "teste");
  assert.deepEqual(second.unchanged, [".claude/files/logo.png"]);
  assert.deepEqual(second.conflicts, []);

  const third = syncHarness(dir, [], [".claude"], "teste");
  assert.deepEqual(third.removed, [".claude/files/logo.png"]);
  assert.equal(existsSync(join(dir, ".claude", "files", "logo.png")), false);
});
