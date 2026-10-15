import assert from "node:assert/strict";
import { test } from "node:test";
import { zip } from "./zip";

const u16 = (b: Uint8Array, at: number) => b[at] | (b[at + 1] << 8);
const u32 = (b: Uint8Array, at: number) => (b[at] | (b[at + 1] << 8) | (b[at + 2] << 16) | (b[at + 3] << 24)) >>> 0;

/** Lê o zip como um descompactador faria: do EOCD para o diretório central, e dele para cada arquivo. */
function unzip(b: Uint8Array): { path: string; content: string; crc: number }[] {
  const eocd = b.length - 22;
  assert.equal(u32(b, eocd), 0x06054b50, "EOCD no fim do arquivo");
  const count = u16(b, eocd + 10);
  let at = u32(b, eocd + 16);
  const dec = new TextDecoder();
  const out = [];
  for (let i = 0; i < count; i++) {
    assert.equal(u32(b, at), 0x02014b50, "cabeçalho do diretório central");
    const size = u32(b, at + 24);
    const nameLen = u16(b, at + 28);
    const crc = u32(b, at + 16);
    const path = dec.decode(b.subarray(at + 46, at + 46 + nameLen));
    const local = u32(b, at + 42);
    assert.equal(u32(b, local), 0x04034b50, "cabeçalho local apontado pelo diretório");
    assert.equal(dec.decode(b.subarray(local + 30, local + 30 + u16(b, local + 26))), path, "nome igual nos dois cabeçalhos");
    const data = local + 30 + u16(b, local + 26) + u16(b, local + 28);
    out.push({ path, content: dec.decode(b.subarray(data, data + size)), crc });
    at += 46 + nameLen + u16(b, at + 30) + u16(b, at + 32);
  }
  return out;
}

test("zip: a árvore volta inteira, com os caminhos preservados", () => {
  const entries = [
    { path: ".claude/agents/revisor.md", content: "---\nname: revisor\n---\n\nRevise o diff.\n" },
    { path: ".claude/skills/checklist/SKILL.md", content: "# Checklist\n\n- estilo\n" },
  ];
  assert.deepEqual(unzip(zip(entries)).map(({ path, content }) => ({ path, content })), entries);
});

test("zip: CRC-32 confere e acentos sobrevivem ao UTF-8", () => {
  const [entry] = unzip(zip([{ path: "acentuação.md", content: "hello" }]));
  assert.equal(entry.crc, 0x3610a686, "CRC-32 de «hello»");
  assert.equal(entry.path, "acentuação.md");
  assert.equal(entry.content, "hello");
});

test("zip: sem arquivos continua sendo um zip válido (vazio)", () => {
  assert.deepEqual(unzip(zip([])), []);
});
