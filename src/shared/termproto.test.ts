import assert from "node:assert/strict";
import { test } from "node:test";
import { encodeInput, encodeResize, parseServerMsg, reconnectDelay, termWsUrl } from "./termproto";

test("parseServerMsg aceita as mensagens válidas e ignora o resto", () => {
  assert.deepEqual(parseServerMsg('{"t":"out","d":"oi"}'), { t: "out", d: "oi" });
  assert.deepEqual(parseServerMsg('{"t":"exit","code":0}'), { t: "exit", code: 0 });
  assert.deepEqual(parseServerMsg('{"t":"hello","id":"a","cols":80,"rows":24}'), { t: "hello", id: "a", cols: 80, rows: 24 });
  for (const bad of ["", "nao-json", "null", '{"t":"out"}', '{"t":"exit","code":"x"}', '{"t":"x"}']) assert.equal(parseServerMsg(bad), undefined, bad);
});

test("encode* gera o formato do servidor", () => {
  assert.deepEqual(JSON.parse(encodeInput("ls\r")), { t: "in", d: "ls\r" });
  assert.deepEqual(JSON.parse(encodeResize(80.7, 0)), { t: "resize", cols: 80, rows: 1 });
});

test("termWsUrl usa ws/wss conforme a página e escapa a query", () => {
  assert.equal(termWsUrl({ protocol: "http:", host: "localhost:5173" }, "ab", "t k"), "ws://localhost:5173/api/term?session=ab&token=t%20k");
  assert.match(termWsUrl({ protocol: "https:", host: "x.y" }, "a", "b"), /^wss:\/\/x\.y\//);
});

test("reconnectDelay cresce e tem teto", () => {
  assert.deepEqual([0, 1, 2, 3, 10].map(reconnectDelay), [500, 1000, 2000, 4000, 8000]);
});
