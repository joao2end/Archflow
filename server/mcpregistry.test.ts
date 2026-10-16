import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { clearMcpRegistryCache, searchMcpRegistry } from "./mcpregistry";

const reply = (body: unknown, status = 200) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
beforeEach(clearMcpRegistryCache);

test("busca curta não consulta a rede", async () => {
  let calls = 0;
  const f = (async () => (calls++, new Response("{}"))) as unknown as typeof fetch;
  assert.deepEqual(await searchMcpRegistry("a", f), { entries: [] });
  assert.equal(calls, 0);
});

test("converte, descarta o que não conecta, desambigua ids e usa cache", async () => {
  let calls = 0;
  let url = "";
  const body = { servers: [
    { server: { name: "io.x/mcp", description: "A", remotes: [{ type: "streamable-http", url: "https://a.com/mcp" }] } },
    { server: { name: "io.y/mcp", description: "B", packages: [{ registryType: "npm", identifier: "pkg-b", version: "1.0.0", transport: { type: "stdio" } }] } },
    { server: { name: "io.z/sem-conexao", description: "C", packages: [{ registryType: "nuget", identifier: "N" }] } },
  ] };
  const f = (async (u: string) => (calls++, (url = u), new Response(JSON.stringify(body)))) as unknown as typeof fetch;
  const r = await searchMcpRegistry("mcp", f);
  assert.match(url, /search=mcp&version=latest&limit=30/);
  assert.deepEqual(r.entries.map((e) => e.id), ["mcp", "mcp-2"]);
  assert.equal(r.entries[0].url, "https://a.com/mcp");
  assert.equal(r.entries[1].args?.[1], "pkg-b@1.0.0");
  await searchMcpRegistry("MCP", f);
  assert.equal(calls, 1, "cache por consulta");
});

test("erros de rede, status e corpo inválido viram mensagens claras", async () => {
  await assert.rejects(searchMcpRegistry("abc", (async () => { throw new Error("offline"); }) as unknown as typeof fetch), /não deu para consultar o registro MCP: offline/);
  await assert.rejects(searchMcpRegistry("abd", reply({}, 503)), /respondeu 503/);
  await assert.rejects(searchMcpRegistry("abe", (async () => new Response("<html>")) as unknown as typeof fetch), /não é JSON/);
});
