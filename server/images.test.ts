import assert from "node:assert/strict";
import { test } from "node:test";
import { imageFrame, sniffImage } from "./images";

const bytes = (...parts: (number[] | string)[]) => Uint8Array.from(parts.flatMap((p) => (typeof p === "string" ? [...p].map((c) => c.charCodeAt(0)) : p)));

test("images: lê tipo e tamanho pelos bytes", () => {
  // PNG 640×480: assinatura + IHDR
  const png = bytes([0x89], "PNG", [0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13], "IHDR", [0, 0, 2, 128, 0, 0, 1, 224]);
  assert.deepEqual(sniffImage(png), { mime: "image/png", width: 640, height: 480 });
  const gif = bytes("GIF89a", [10, 0, 20, 0]);
  assert.deepEqual(sniffImage(gif), { mime: "image/gif", width: 10, height: 20 });
  // JPEG: SOI, um APP0 curto e o SOF0 com altura 300 e largura 400
  const jpg = bytes([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 17, 8, 1, 44, 1, 144, 3, 0, 0, 0]);
  assert.deepEqual(sniffImage(jpg), { mime: "image/jpeg", width: 400, height: 300 });
  const svg = new TextEncoder().encode('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 60"></svg>');
  assert.deepEqual(sniffImage(svg), { mime: "image/svg+xml", width: 120, height: 60 });
  assert.equal(sniffImage(new TextEncoder().encode("<!doctype html><html></html>")), undefined);
});

test("images: a moldura segue a proporção da foto e reserva a legenda", () => {
  assert.deepEqual(imageFrame(260, { width: 1000, height: 500 }), { w: 260, h: Math.round(248 * 0.5 + 40) });
  assert.equal(imageFrame(undefined).w, 260);
});
