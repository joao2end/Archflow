import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { CODEGEN_LANGUAGES, filesToMarkdown, generateCode, generateTypeScript, type GeneratedFile } from "./codegen";
import { applyOps, type Op } from "./ops";
import { emptyDoc, type DddNodeSpec, type DddRel, type Doc } from "./schema";

const ctx = (id: string): Op => ({ op: "add_group", id, label: id, kind: "context", subdomain: "core" });
const dn = (id: string, ddd: DddNodeSpec, parent?: string, extra: Partial<Extract<Op, { op: "add_node" }>> = {}): Op => ({ op: "add_node", id, label: id, ddd, ...(parent ? { parent } : {}), ...extra });
const rel = (from: string, to: string, r: DddRel): Op => ({ op: "add_connection", from, to, ddd: { rel: r } });
const build = (ops: Op[]): Doc => {
  const r = applyOps(emptyDoc("Loja & \"Pedidos\"", "domain"), ops);
  assert.deepEqual(r.results.filter((x) => !x.ok), []);
  return r.doc;
};

const pedidos = (): Op[] => [
  ctx("pedidos"),
  dn("pedido", { role: "aggregate-root", invariants: ["total >= 0", "pedido pago não aceita itens"] }, "pedidos", { description: "O pedido do cliente" }),
  dn("item-pedido", { role: "entity", invariants: ["quantidade > 0"] }, "pedidos"),
  dn("endereco", { role: "value-object" }, "pedidos"),
  dn("pagamento", { role: "aggregate-root" }, "pedidos"),
  dn("criar-pedido", { role: "command", intent: "registrar o pedido do cliente", invariants: ["carrinho não vazio"] }, "pedidos"),
  dn("pedido-criado", { role: "domain-event", payload: "id, total: number; criadoEm" }, "pedidos"),
  dn("pagamento-aprovado", { role: "domain-event", external: "pagamentos.pagamento-aprovado", payload: "id" }, "pedidos"),
  dn("pedido-repo", { role: "repository", for: "pedido" }, "pedidos"),
  dn("fazer-pedido", { role: "use-case", actor: "Cliente", goal: "comprar" }, "pedidos"),
  dn("cancelar-pedido", { role: "use-case", actor: "Cliente", goal: "cancelar" }, "pedidos"),
  dn("avisar-cliente", { role: "policy", intent: "avisar por e-mail", reactsTo: ["pedido-criado"], issues: [] }, "pedidos"),
  dn("fluxo-pagamento", { role: "process-manager", reactsTo: ["pedido-criado"], issues: ["criar-pedido"], compensates: ["criar-pedido"] }, "pedidos"),
  dn("pedidos-abertos", { role: "read-model", projectsFrom: ["pedido-criado"] }, "pedidos"),
  dn("calculo-frete", { role: "domain-service", intent: "calcular frete" }, "pedidos"),
  dn("checkout", { role: "application-service", intent: "orquestra o checkout" }, "pedidos"),
  rel("pedido", "item-pedido", "contains"),
  rel("pedido", "endereco", "contains"),
  rel("pedido", "pagamento", "references-by-id"),
  rel("criar-pedido", "pedido", "triggers"),
  rel("criar-pedido", "pedido-criado", "emits"),
  rel("criar-pedido", "fazer-pedido", "realizes"),
];

const byPath = (files: GeneratedFile[]) => new Map(files.map((f) => [f.path, f.content]));

/** Compila os arquivos gerados com o TypeScript do projeto, em modo estrito: o esqueleto precisa ser válido. */
function compiles(files: GeneratedFile[]): string {
  const dir = mkdtempSync(join(tmpdir(), "archflow-gen-"));
  try {
    for (const f of files.filter((x) => x.path.endsWith(".ts"))) {
      mkdirSync(dirname(join(dir, f.path)), { recursive: true });
      writeFileSync(join(dir, f.path), f.content);
    }
    writeFileSync(join(dir, "tsconfig.json"), JSON.stringify({ compilerOptions: { target: "ES2022", module: "ESNext", moduleResolution: "Bundler", strict: true, noEmit: true, skipLibCheck: true, types: [], lib: ["ES2022"] }, include: ["**/*.ts"] }));
    const r = spawnSync("npx", ["tsc", "-p", dir], { cwd: process.cwd(), encoding: "utf8", shell: true });
    return r.status === 0 ? "" : `${r.stdout}${r.stderr}`;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("codegen: estrutura por contexto, seguindo a regra de dependência (application → domain)", () => {
  const files = generateTypeScript(build(pedidos()));
  const paths = files.map((f) => f.path).sort();
  assert.deepEqual(paths, [
    "pedidos/application/commands.ts",
    "pedidos/application/criar-pedido-handler.ts",
    "pedidos/application/reactions.ts",
    "pedidos/domain/event-publisher.ts",
    "pedidos/domain/events.ts",
    "pedidos/domain/pagamento-repository.ts",
    "pedidos/domain/pagamento.ts",
    "pedidos/domain/pedido-repo.ts",
    "pedidos/domain/pedido.ts",
    "pedidos/domain/services.ts",
    "pedidos/use-cases.md",
  ]);
  for (const f of files.filter((x) => x.path.includes("/domain/"))) assert.doesNotMatch(f.content, /application\//, `${f.path} não depende de application`);
});

test("codegen: o conteúdo carrega o que o modelo sabe", () => {
  const f = byPath(generateTypeScript(build(pedidos())));
  const pedido = f.get("pedidos/domain/pedido.ts")!;
  assert.match(pedido, /export class Pedido \{/);
  assert.match(pedido, /Invariante: total >= 0/);
  assert.match(pedido, /Invariante: pedido pago não aceita itens/);
  assert.match(pedido, /export class ItemPedido \{\n {2}constructor\(readonly id: string\) \{\}/);
  assert.match(pedido, /Invariante: quantidade > 0/);
  assert.match(pedido, /export class Endereco \{/);
  assert.match(pedido, /readonly itemPedidos: ItemPedido\[\] = \[\];/);
  assert.match(pedido, /endereco\?: Endereco;/);
  assert.match(pedido, /pagamentoId\?: string; \/\/ referência por id ao aggregate pagamento/);
  assert.match(pedido, /criarPedido\(\): DomainEvent\[\] \{/);
  assert.match(pedido, /\{ type: "pedido-criado", occurredAt: new Date\(\) \} satisfies PedidoCriado/);
  assert.match(pedido, /Invariante: carrinho não vazio/);
  const events = f.get("pedidos/domain/events.ts")!;
  assert.match(events, /export interface PedidoCriado extends DomainEvent \{\n {2}readonly type: "pedido-criado";\n {2}readonly id\?: unknown;\n {2}readonly total\?: unknown;\n {2}readonly criadoEm\?: unknown;/);
  assert.match(events, /Vem de outro contexto: pagamentos\.pagamento-aprovado\./);
  assert.match(f.get("pedidos/domain/pedido-repo.ts")!, /export interface PedidoRepo \{\n {2}findById\(id: string\): Promise<Pedido \| undefined>;/);
  assert.match(f.get("pedidos/domain/pagamento-repository.ts")!, /export interface PagamentoRepository/, "aggregate sem repository no modelo ganha um nome padrão");
  const handler = f.get("pedidos/application/criar-pedido-handler.ts")!;
  assert.match(handler, /export class CriarPedidoHandler \{/);
  assert.match(handler, /private readonly repository: PedidoRepo,/);
  assert.match(handler, /import type \{ PedidoRepo \} from "\.\.\/domain\/pedido-repo";/);
  assert.match(handler, /registrar o pedido do cliente/);
  assert.match(handler, /chamar o método de domínio criarPedido\(\)/);
  const reactions = f.get("pedidos/application/reactions.ts")!;
  assert.match(reactions, /export class AvisarCliente \{/);
  assert.match(reactions, /Reage a: pedido-criado\./);
  assert.match(reactions, /export class FluxoPagamento \{[\s\S]*async compensate\(\)/);
  assert.match(reactions, /Desfaz o que já foi feito \(criar-pedido\)/);
  assert.match(reactions, /export class PedidosAbertos \{/);
  assert.match(reactions, /export class Checkout \{/);
  assert.match(f.get("pedidos/domain/services.ts")!, /export class CalculoFrete \{/);
  const uc = f.get("pedidos/use-cases.md")!;
  assert.match(uc, /\| Fazer Pedido|\| fazer-pedido \(`fazer-pedido`\) \| Cliente \| criar-pedido → pedido → pedido-criado \| ✔ \|/);
  assert.match(uc, /\| cancelar-pedido \(`cancelar-pedido`\) \| Cliente \| — \| ✘ sem realização \(D001\) \|/);
});

test("codegen: o esqueleto gerado compila em modo estrito", () => {
  assert.equal(compiles(generateTypeScript(build(pedidos()))), "");
});

test("codegen: nomes difíceis (acentos, dígitos, globais, colisões) continuam gerando código válido", () => {
  const doc = build([
    { op: "add_group", label: "Gestão de Pedidos", kind: "context", subdomain: "core" },
    dn("date", { role: "aggregate-root" }, "gestao-de-pedidos"),
    dn("1-item", { role: "entity" }, "gestao-de-pedidos"),
    dn("error", { role: "domain-event", payload: "type, occurredAt, class, 9x, ação" }, "gestao-de-pedidos"),
    dn("criar-date", { role: "command", intent: "uma */ quebra\nde linha" }, "gestao-de-pedidos"),
    dn("x-1", { role: "entity" }, "gestao-de-pedidos"),
    dn("x1", { role: "value-object" }, "gestao-de-pedidos"),
    dn("date-criada", { role: "domain-event" }, "gestao-de-pedidos"),
    rel("date", "1-item", "contains"),
    rel("criar-date", "date", "triggers"),
    rel("date", "x-1", "contains"),
    rel("date", "x1", "contains"),
    rel("criar-date", "date-criada", "emits"),
    rel("criar-date", "error", "emits"),
  ]);
  const files = generateTypeScript(doc);
  assert.ok(files.every((f) => /^gestao-de-pedidos\//.test(f.path)), "pasta em kebab sem acento");
  const all = files.map((f) => f.content).join("\n");
  assert.match(all, /export class DateType \{/, "global reservado ganha sufixo");
  assert.match(all, /export class _1Item \{/, "dígito inicial vira prefixo");
  assert.match(all, /export interface ErrorType extends DomainEvent/);
  assert.match(all, /export class X1 {/);
  assert.match(all, /export class X12 {/, "dois ids com o mesmo PascalCase ganham nomes distintos");
  assert.doesNotMatch(all, /readonly type\?: unknown|readonly occurredAt\?: unknown/, "campos reservados do evento não são duplicados");
  assert.match(all, /readonly _9x\?: unknown;/);
  assert.doesNotMatch(all, /\*\/ quebra/, "comentário não é fechado pelo texto do modelo");
  assert.equal(new Set(files.map((f) => f.path)).size, files.length, "caminhos únicos");
  assert.equal(compiles(files), "");
});

test("codegen: sem aggregate no command, sem contexto, só casos de uso e diagrama vazio", () => {
  const noAgg = generateTypeScript(build([ctx("c"), dn("fazer", { role: "command", intent: "algo" }, "c")]));
  const h = byPath(noAgg).get("c/application/fazer-handler.ts")!;
  assert.match(h, /ATENÇÃO: este command não aciona nenhum aggregate/);
  assert.doesNotMatch(h, /repository/);
  assert.equal(compiles(noAgg), "");
  const loose = generateTypeScript(build([dn("a", { role: "aggregate-root" }), dn("c", { role: "command" }), rel("c", "a", "triggers")]));
  assert.ok(loose.every((f) => f.path.startsWith("app/")), "sem contexto vai para app/");
  assert.equal(compiles(loose), "");
  const onlyUc = generateTypeScript(build([ctx("c"), dn("u", { role: "use-case", actor: "X" }, "c")]));
  assert.deepEqual(onlyUc.map((f) => f.path), ["c/use-cases.md"]);
  assert.deepEqual(generateTypeScript(build([])), []);
});

test("codegen: determinístico, só no modo domain e com linguagens validadas", () => {
  const doc = build(pedidos());
  assert.deepEqual(generateTypeScript(doc), generateTypeScript(doc));
  assert.deepEqual(generateTypeScript(emptyDoc("arq")), []);
  assert.deepEqual(CODEGEN_LANGUAGES, ["typescript"]);
  assert.throws(() => generateCode(doc, "cobol" as never), /não suportada/);
  const md = filesToMarkdown(generateCode(doc));
  assert.match(md, /### pedidos\/domain\/pedido\.ts\n```ts\n/);
  assert.match(md, /### pedidos\/use-cases\.md\n```md\n/);
  assert.match(generateTypeScript(doc)[0].content, /Gerado pelo Archflow a partir de "Loja & "Pedidos""/);
});
