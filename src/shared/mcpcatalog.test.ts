import assert from "node:assert/strict";
import { test } from "node:test";
import { checkAgentNode, looksLikeSecret } from "./agents";
import { MCP_CATALOG, findMcpCatalogEntry, mcpVars, mcpEntryToSpec, parseMcpInput, registryServerToEntry, searchMcpCatalog, shellSplit } from "./mcpcatalog";

test("catálogo curado: ids únicos, spec válida, sem segredo literal e com a fonte conferida", () => {
  assert.equal(new Set(MCP_CATALOG.map((e) => e.id)).size, MCP_CATALOG.length);
  for (const e of MCP_CATALOG) {
    assert.equal(checkAgentNode(mcpEntryToSpec(e)), undefined, e.id);
    assert.ok(e.homepage?.startsWith("https://"), `${e.id} precisa de homepage (fonte)`);
    for (const [k, v] of [...Object.entries(e.env ?? {}), ...Object.entries(e.headers ?? {})]) assert.equal(looksLikeSecret(k, v), false, `${e.id}.${k}`);
    if (e.transport === "stdio") assert.ok(e.command, e.id);
    else assert.ok(e.url?.startsWith("https://"), e.id);
    for (const v of e.requiredVars ?? []) assert.match(v.name, /^[A-Z][A-Z0-9_]*$/);
  }
});

test("mcpEntryToSpec: vira tool MCP com a origem registrada", () => {
  const spec = mcpEntryToSpec(findMcpCatalogEntry("playwright")!);
  assert.deepEqual({ role: spec.role, toolType: spec.toolType, transport: spec.transport, command: spec.command, args: spec.args }, { role: "tool", toolType: "mcp", transport: "stdio", command: "npx", args: ["-y", "@playwright/mcp@latest"] });
  assert.deepEqual(spec.mcpSource, { catalog: "curated", id: "playwright" });
});

test("searchMcpCatalog: nome, tag e descrição, sem acento, todas as palavras", () => {
  assert.deepEqual(searchMcpCatalog("navegador").map((e) => e.id), ["playwright"]);
  assert.deepEqual(searchMcpCatalog("documentacao").map((e) => e.id), ["context7"]);
  assert.deepEqual(searchMcpCatalog("GITHUB issues").map((e) => e.id), ["github"]);
  assert.equal(searchMcpCatalog("").length, MCP_CATALOG.length);
  assert.deepEqual(searchMcpCatalog("zzz"), []);
  const extra = [{ ...MCP_CATALOG[0], id: "outro", name: "Outro", tags: ["navegador"] }];
  assert.deepEqual(searchMcpCatalog("navegador", extra).map((e) => e.id), ["playwright", "outro"]);
});

test("registro: prefere o servidor remoto; cabeçalho secreto vira ${VAR}; URL-modelo vira variável", () => {
  const e = registryServerToEntry({
    name: "com.exemplo/api-mcp",
    description: "Uma API.",
    version: "2.1.0",
    packages: [{ registryType: "npm", identifier: "@exemplo/api-mcp", version: "2.1.0", transport: { type: "stdio" } }],
    remotes: [{ type: "streamable-http", url: "https://{tenant}.exemplo.com/mcp", headers: [{ name: "Authorization", isSecret: true, description: "Token" }, { name: "X-Region", value: "br" }] }],
  })!;
  assert.equal(e.transport, "http");
  assert.equal(e.url, "https://${TENANT}.exemplo.com/mcp");
  assert.deepEqual(e.headers, { Authorization: "Bearer ${API_MCP_TOKEN}", "X-Region": "br" });
  assert.deepEqual(e.requiredVars?.map((v) => v.name), ["TENANT", "API_MCP_TOKEN"]);
  assert.equal(e.origin, "registry");
  assert.equal(e.version, "2.1.0");
});

test("registro: pacote npm/pypi/oci vira comando; variáveis secretas e com padrão", () => {
  const npm = registryServerToEntry({ name: "io.github.upstash/context7", packages: [{ registryType: "npm", identifier: "@upstash/context7-mcp", version: "4.4.2", transport: { type: "stdio" }, environmentVariables: [{ name: "API_KEY", isSecret: true, isRequired: true }, { name: "REGION", default: "us" }] }] })!;
  assert.equal(npm.command, "npx");
  assert.deepEqual(npm.args, ["-y", "@upstash/context7-mcp@4.4.2"]);
  assert.deepEqual(npm.env, { API_KEY: "${API_KEY}", REGION: "${REGION:-us}" });
  assert.deepEqual(npm.requiredVars?.map((v) => v.name), ["API_KEY"]);
  assert.deepEqual(registryServerToEntry({ name: "a/b", packages: [{ registryType: "pypi", identifier: "pkg", version: "1.0", transport: { type: "stdio" } }] })!.args, ["pkg==1.0"]);
  const oci = registryServerToEntry({ name: "a/c", packages: [{ registryType: "oci", identifier: "ghcr.io/x/y:1", transport: { type: "stdio" }, environmentVariables: [{ name: "TOKEN", isSecret: true }] }] })!;
  assert.deepEqual([oci.command, oci.args], ["docker", ["run", "-i", "--rm", "-e", "TOKEN", "ghcr.io/x/y:1"]]);
  assert.equal(registryServerToEntry({ name: "a/d", packages: [{ registryType: "nuget", identifier: "X" }] }), undefined, "sem como conectar");
  assert.equal(registryServerToEntry(null), undefined);
});

test("shellSplit respeita aspas", () => {
  assert.deepEqual(shellSplit(`a "b c" 'd e' f\\ g ""`), ["a", "b c", "d e", "f\\", "g", ""]);
});

test("colar .mcp.json: mapa completo, fragmento e config solta; segredo em texto puro é trocado por variável", () => {
  const r = parseMcpInput(JSON.stringify({ mcpServers: { "local-db": { type: "stdio", command: "npx", args: ["-y", "@bytebase/dbhub"], env: { DATABASE_URL: "${DATABASE_URL}", API_TOKEN: "abc123xyz" } }, remoto: { type: "http", url: "https://x.com/mcp", headers: { Authorization: "Bearer sk-livre1234567890" } } } }));
  assert.equal(r.error, undefined);
  assert.deepEqual(r.entries.map((e) => e.id), ["local-db", "remoto"]);
  assert.equal(r.entries[0].env?.API_TOKEN, "${API_TOKEN}");
  assert.deepEqual(r.entries[0].replacedSecrets, ["API_TOKEN"]);
  assert.deepEqual(r.entries[0].requiredVars?.map((v) => v.name).sort(), ["API_TOKEN", "DATABASE_URL"]);
  assert.equal(r.entries[1].headers?.Authorization, "Bearer ${REMOTO_TOKEN}");
  assert.ok(!JSON.stringify(r).includes("sk-livre") && !JSON.stringify(r).includes("abc123xyz"), "o segredo não sobrevive");
  assert.equal(parseMcpInput(`"pw": { "command": "npx", "args": ["x"] },`).entries[0].id, "pw");
  assert.equal(parseMcpInput(`{ "url": "https://a.com/mcp" }`).entries[0].transport, "http");
});

test("colar `claude mcp add`: http com cabeçalho, stdio com --env e add-json", () => {
  const http = parseMcpInput(`claude mcp add --transport http --scope project secure-api https://api.example.com/mcp --header "Authorization: Bearer meutokenlongo123"`).entries[0];
  assert.deepEqual([http.id, http.transport, http.url], ["secure-api", "http", "https://api.example.com/mcp"]);
  assert.equal(http.headers?.Authorization, "Bearer ${SECURE_API_TOKEN}");
  const stdio = parseMcpInput("claude mcp add --transport stdio --env AIRTABLE_API_KEY=pat123 airtable -- npx -y airtable-mcp-server").entries[0];
  assert.deepEqual([stdio.transport, stdio.command, stdio.args], ["stdio", "npx", ["-y", "airtable-mcp-server"]]);
  assert.equal(stdio.env?.AIRTABLE_API_KEY, "${AIRTABLE_API_KEY}");
  const json = parseMcpInput(`claude mcp add-json weather-api '{"type":"http","url":"https://api.weather.com/mcp"}'`).entries[0];
  assert.deepEqual([json.id, json.transport, json.url], ["weather-api", "http", "https://api.weather.com/mcp"]);
});

test("colar: erros acionáveis", () => {
  assert.match(parseMcpInput("").error ?? "", /cole um/);
  assert.match(parseMcpInput("isto não é nada").error ?? "", /não é um JSON válido/);
  assert.match(parseMcpInput(`{"mcpServers":{"x":{"type":"stdio"}}}`).error ?? "", /sem "command"/);
  assert.match(parseMcpInput(`{"mcpServers":{"x":{"type":"http"}}}`).error ?? "", /sem "url"/);
  assert.match(parseMcpInput("claude mcp add").error ?? "", /faltou o nome/);
  assert.match(parseMcpInput("claude mcp add x --").error ?? "", /faltou o comando/);
});

test("mcpVars: acha ${VAR} em command, args, env, url e headers, com e sem padrão, sem repetir", () => {
  assert.deepEqual(
    mcpVars({ command: "${RUNNER}", args: ["--dsn", "${DATABASE_URL}"], env: { LOG: "${LOG_LEVEL:-info}", X: "literal" }, url: "${API_BASE:-https://a.com}/mcp", headers: { Authorization: "Bearer ${DATABASE_URL}" } }),
    [{ name: "RUNNER", hasDefault: false }, { name: "DATABASE_URL", hasDefault: false }, { name: "API_BASE", hasDefault: true }, { name: "LOG_LEVEL", hasDefault: true }],
  );
  assert.deepEqual(mcpVars({}), []);
  assert.deepEqual(mcpVars({ args: ["$NAO", "${1ruim}", "${OK}"] }), [{ name: "OK", hasDefault: false }]);
});
