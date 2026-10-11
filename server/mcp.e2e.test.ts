/**
 * Ponta a ponta: sobe o MCP de verdade (stdio) com um bridge e um cofre temporários e exercita o fluxo do modo domínio
 * como uma IA faria. Nada toca no cofre/configuração do usuário (portas, config e dados isolados por variáveis de ambiente).
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

let client: Client;
let tmp: string;

const freePort = () =>
  new Promise<number>((res, rej) => {
    const s = createServer();
    s.once("error", rej);
    s.listen(0, "127.0.0.1", () => {
      const p = (s.address() as { port: number }).port;
      s.close(() => res(p));
    });
  });

async function call(name: string, args: Record<string, unknown> = {}) {
  const r = (await client.callTool({ name, arguments: args })) as { content: { type: string; text: string }[]; isError?: boolean };
  return { text: r.content.map((c) => c.text).join("\n"), isError: !!r.isError };
}

before(async () => {
  tmp = mkdtempSync(join(tmpdir(), "archflow-e2e-"));
  const port = await freePort();
  client = new Client({ name: "e2e", version: "0.0.0" });
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: ["--import", "tsx", "server/mcp.ts"],
      cwd: process.cwd(),
      stderr: "pipe",
      env: { ...(process.env as Record<string, string>), ARCHFLOW_PORT: String(port), ARCHFLOW_CONFIG: join(tmp, "cfg"), ARCHFLOW_DATA: join(tmp, "data"), ARCHFLOW_NO_APP: "1" },
    }),
  );
});

after(async () => {
  await client?.close();
  rmSync(tmp, { recursive: true, force: true });
});

test("o MCP expõe as tools do modo domínio", async () => {
  const names = (await client.listTools()).tools.map((t) => t.name);
  for (const n of ["add_use_cases", "trace", "domain_overview", "generate_code", "new_diagram", "connect", "add_components", "add_groups", "validate_diagram"]) assert.ok(names.includes(n), n);
});

test("a skill documenta todas as tools do MCP (nenhuma tool fica sem instrução para a IA)", async () => {
  const { SKILL_MD } = await import("../src/shared/skill.generated");
  const names = (await client.listTools()).tools.map((t) => t.name);
  const missing = names.filter((n) => !SKILL_MD.includes(`\`${n}\``));
  assert.deepEqual(missing, []);
  const guide = (await client.readResource({ uri: "archflow://skill" })).contents[0] as { text: string };
  assert.equal(guide.text, SKILL_MD, "o resource archflow://skill serve a skill gerada");
});

test("fluxo completo: casos de uso → modelo → validação → rastreio → visão geral", async () => {
  // 1. diagrama de domínio do contexto Pedidos
  const created = await call("new_diagram", { title: "Pedidos", folder: "dominio", mode: "domain" });
  assert.equal(created.isError, false);
  assert.match(created.text, /dominio\/pedidos\.archflow\.json/);
  assert.match((await call("get_schema_guide")).text, /modo DOMAIN/);

  // 2. contexto, caso de uso e modelo
  assert.equal((await call("add_groups", { groups: [{ id: "pedidos", label: "Pedidos", kind: "context", subdomain: "core" }] })).isError, false);
  const uc = await call("add_use_cases", { useCases: [{ id: "fazer-pedido", actor: "Cliente", goal: "Fazer um pedido", context: "pedidos" }] });
  assert.match(uc.text, /ok: 3\/3/, "ator + caso de uso + conexão");
  assert.match((await call("add_use_cases", { useCases: [{ id: "fazer-pedido", actor: "Cliente", goal: "Fazer um pedido" }] })).text, /nada a criar/, "idempotente");

  const comps = await call("add_components", {
    components: [
      { id: "pedido", label: "Pedido", parent: "pedidos", ddd: { role: "aggregate-root", invariants: ["total >= 0"] } },
      { id: "item-pedido", label: "Item do Pedido", parent: "pedidos", ddd: { role: "entity" } },
      { id: "criar-pedido", label: "Criar Pedido", parent: "pedidos", ddd: { role: "command", intent: "registrar pedido" } },
      { id: "pedido-criado", label: "Pedido Criado", parent: "pedidos", ddd: { role: "domain-event", payload: "id, total" } },
    ],
  });
  assert.match(comps.text, /ok: 4\/4/);

  // sem realização: o validador e o trace apontam o que falta
  const before = await call("validate_diagram");
  assert.match(before.text, /\[D001 erro\]/);
  assert.match(before.text, /\[D002 erro\]/);
  assert.match((await call("trace")).text, /0 de 1 rastreados/);

  const links = await call("connect", {
    connections: [
      { from: "pedido", to: "item-pedido", ddd: { rel: "contains" } },
      { from: "criar-pedido", to: "pedido", ddd: { rel: "triggers" } },
      { from: "criar-pedido", to: "pedido-criado", ddd: { rel: "emits" } },
      { from: "criar-pedido", to: "fazer-pedido", ddd: { rel: "realizes" } },
    ],
  });
  assert.match(links.text, /ok: 4\/4/);

  // 3. validação limpa (só dicas) e rastreio completo
  const after = await call("validate_diagram");
  assert.doesNotMatch(after.text, /\berro\]|\baviso\]/, after.text);
  const trace = await call("trace", { id: "fazer-pedido" });
  assert.match(trace.text, /1 de 1 rastreados/);
  assert.match(trace.text, /fazer-pedido \[use-case\] → criar-pedido \[command\] → pedido \[aggregate-root\] → pedido-criado \[domain-event\]/);
  assert.equal((await call("auto_layout", { style: "timeline" })).isError, false);
  const doc = JSON.parse((await call("get_diagram", { format: "json" })).text) as { nodes: { id: string; x: number; y: number }[] };
  const y = (id: string) => doc.nodes.find((n) => n.id === id)!.y;
  assert.ok(y("fazer-pedido") < y("criar-pedido") && y("criar-pedido") < y("pedido") && y("pedido") < y("pedido-criado"), "raias de Event Storming via MCP");

  // 3b. esqueleto de código a partir do modelo validado
  const gen = (await call("generate_code")).text;
  assert.match(gen, /### pedidos\/domain\/pedido\.ts/);
  assert.match(gen, /export class CriarPedidoHandler/);
  assert.match(gen, /\{ type: "pedido-criado", occurredAt: new Date\(\) \} satisfies PedidoCriado/);
  assert.match(gen, /Fazer um pedido \(`fazer-pedido`\) \| Cliente \| criar-pedido → pedido → pedido-criado \| ✔/);

  // 4. leitura pela IA
  const md = (await call("get_diagram")).text;
  assert.match(md, /# Pedidos — domínio/);
  assert.match(md, /fazer-pedido` Fazer um pedido \(ator: Cliente\) → criar-pedido → pedido → pedido-criado ✔/);

  // 5. segundo contexto + visão geral
  await call("new_diagram", { title: "Pagamentos", folder: "dominio", mode: "domain" });
  await call("add_groups", { groups: [{ id: "pagamentos", label: "Pagamentos", kind: "context", subdomain: "generic" }] });
  await call("add_components", {
    components: [
      { id: "pagamento", label: "Pagamento", parent: "pagamentos", ddd: { role: "aggregate-root" } },
      { id: "pagar", label: "Pagar", parent: "pagamentos", ddd: { role: "command" } },
      { id: "pagamento-aprovado", label: "Pagamento Aprovado", parent: "pagamentos", ddd: { role: "domain-event" } },
    ],
  });
  await call("connect", { connections: [{ from: "pagar", to: "pagamento", ddd: { rel: "triggers" } }, { from: "pagar", to: "pagamento-aprovado", ddd: { rel: "emits" } }] });

  await call("new_diagram", { title: "Visão geral", folder: "dominio", mode: "domain" });
  await call("add_components", {
    components: [
      { id: "pedidos", label: "Pedidos", kind: "system", ref: { diagram: "dominio/pedidos.archflow.json" } },
      { id: "pagamentos", label: "Pagamentos", kind: "system", ref: { diagram: "dominio/pagamentos.archflow.json" } },
    ],
  });
  const rel = await call("connect", { connections: [{ from: "pedidos", to: "pagamentos", ddd: { rel: "context-relation", pattern: "customer-supplier" } }] });
  assert.match(rel.text, /ok: 1\/1/);

  const overview = (await call("domain_overview")).text;
  assert.match(overview, /3 diagrama\(s\) de domínio · 2 contexto\(s\) · 1 visão\(ões\) geral\(is\)/);
  assert.match(overview, /Pedidos —customer-supplier→ Pagamentos/);
  assert.match(overview, /1 de 1 rastreados até um evento \(100%\)/);
  assert.match(overview, /\*\*Pagamentos\*\* `pagamentos` \(generic\)/);
});

test("erros acionáveis para a IA e isolamento entre os modos", async () => {
  await call("new_diagram", { title: "Macro" });
  const arch = await call("get_schema_guide");
  assert.doesNotMatch(arch.text, /modo DOMAIN/);
  assert.doesNotMatch(arch.text, /aggregate-root/);

  assert.match((await call("generate_code")).text, /modo "architecture"/);
  assert.equal((await call("auto_layout", { style: "timeline" })).isError, true, "timeline só no modo domain");
  const wrongMode = await call("add_components", { components: [{ id: "x", label: "X", ddd: { role: "aggregate-root" } }] });
  assert.equal(wrongMode.isError, true);
  assert.match(wrongMode.text, /modo "domain"/);
  assert.match((await call("add_use_cases", { useCases: [{ actor: "A", goal: "g" }] })).text, /modo "architecture"/);

  // volta ao diagrama de domínio e testa rejeições de campo
  await call("open_diagram", { name: "dominio/pedidos.archflow.json" });
  const badField = await call("add_components", { components: [{ id: "k", label: "K", ddd: { role: "command", payload: "x" } }] });
  assert.match(badField.text, /campo "payload" não existe no papel "command"/);
  const badRel = await call("connect", { connections: [{ from: "pedido", to: "item-pedido", ddd: { rel: "contains", pattern: "acl" } }] });
  assert.match(badRel.text, /pattern/);
  // regras dos conectores: infraestrutura recusada, tipo fixo pela relação, e o guia explica as regras
  const infra = await call("connect", { connections: [{ from: "criar-pedido", to: "pedido-criado", type: "sync" }] });
  assert.equal(infra.isError, true);
  assert.match(infra.text, /de infraestrutura/);
  assert.match((await call("connect", { connections: [{ from: "criar-pedido", to: "pedido-criado", type: "sync", ddd: { rel: "emits" } }] })).text, /fixa o type em "async"/);
  assert.match((await call("get_schema_guide")).text, /Regras dos conectores[\s\S]*emits`: command\|aggregate-root\|process-manager → domain-event/);

  // trocar o modo não apaga nada
  await call("open_diagram", { name: "macro.archflow.json" });
  assert.equal((await call("set_diagram_info", { mode: "domain" })).isError, false);
  assert.match((await call("get_schema_guide")).text, /modo DOMAIN/);
  assert.equal((await call("set_diagram_info", { mode: "architecture" })).isError, false);
  assert.doesNotMatch((await call("get_schema_guide")).text, /modo DOMAIN/);
});

test("fluxo pelo MCP: decisão, condição, senão, loop e para cada; recusado fora do modo domain", async () => {
  await call("new_diagram", { title: "Fluxo", mode: "domain" });
  await call("add_groups", { groups: [{ id: "fluxo", label: "Fluxo", kind: "context", subdomain: "core" }] });
  const comps = await call("add_components", {
    components: [
      { id: "pag", label: "Pagamento", parent: "fluxo", ddd: { role: "aggregate-root" } },
      { id: "cobrar", label: "Cobrar", parent: "fluxo", ddd: { role: "command" } },
      { id: "desistir", label: "Desistir", parent: "fluxo", ddd: { role: "command" } },
      { id: "recusado", label: "Pagamento recusado", parent: "fluxo", ddd: { role: "domain-event", external: "pagamentos.recusado" } },
      { id: "ha-tentativas", label: "Há tentativas?", parent: "fluxo", ddd: { role: "decision", question: "ainda há tentativas?", gate: "exclusive" } },
    ],
  });
  assert.match(comps.text, /ok: 5\/5/);
  const links = await call("connect", {
    connections: [
      { from: "cobrar", to: "pag", ddd: { rel: "triggers" } },
      { from: "desistir", to: "pag", ddd: { rel: "triggers" } },
      { from: "recusado", to: "ha-tentativas" },
      { from: "ha-tentativas", to: "cobrar", ddd: { rel: "triggers", condition: "tentativas < 3", loop: { until: "pagamento aprovado", max: 3 } } },
      { from: "ha-tentativas", to: "desistir", ddd: { rel: "triggers", otherwise: true } },
    ],
  });
  assert.match(links.text, /ok: 5\/5/);

  // validação limpa de erros e avisos de fluxo; a descrição mostra a decisão e o loop
  const val = (await call("validate_diagram")).text;
  assert.doesNotMatch(val, /\[D02[4-9] |\[D03[1-2] /, val);
  const md = (await call("get_diagram")).text;
  assert.match(md, /### Decisões\n- `ha-tentativas` \*\*Há tentativas\?\*\* \(exclusiva\): ainda há tentativas\? → se tentativas < 3 · repete até pagamento aprovado, máx. 3: `cobrar` ↻; senão: `desistir`/);
  assert.match(md, /## Fluxo condicional, loops e iterações/);
  assert.match((await call("generate_code")).text, /export class HaTentativas \{[\s\S]*decide\(event: DomainEvent\): "cobrar" \| "desistir"/);

  // entradas inválidas voltam com mensagem acionável
  assert.match((await call("connect", { connections: [{ from: "ha-tentativas", to: "cobrar", ddd: { rel: "triggers", loop: {} } }] })).text, /condição de parada/);
  assert.match((await call("connect", { connections: [{ from: "ha-tentativas", to: "cobrar", ddd: { rel: "triggers", condition: "x", otherwise: true } }] })).text, /OU otherwise/);
  assert.match((await call("connect", { connections: [{ from: "pag", to: "cobrar", ddd: { rel: "uses", condition: "x" } }] })).text, /só valem em relações de fluxo/);

  // decisão sem senão e com um só ramo: a validação aponta
  await call("add_components", { components: [{ id: "d2", label: "Segunda decisão", parent: "fluxo", ddd: { role: "decision" } }] });
  await call("connect", { connections: [{ from: "recusado", to: "d2" }, { from: "d2", to: "cobrar", ddd: { rel: "triggers", condition: "x" } }] });
  const after = (await call("validate_diagram")).text;
  assert.match(after, /\[D024 erro\] decisão `d2`/);

  // fora do modo domain nada disso existe
  await call("new_diagram", { title: "Arq" });
  const arch = await call("add_components", { components: [{ id: "x", label: "X", ddd: { role: "decision" } }] });
  assert.equal(arch.isError, true);
  assert.match(arch.text, /modo "domain"/);
  assert.doesNotMatch((await call("get_schema_guide")).text, /Decisões, condições/);
});
