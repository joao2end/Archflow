import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { generateCode } from "./codegen";
import { domainOverview, evaluateDomain, traceUseCase } from "./domain";
import { DDD_EXAMPLES, EXAMPLES_DIR, buildExample, fileSlug } from "./examples";
import { renderAllExamples } from "./examples.render";
import { normalizeDoc, validateDetailed } from "./ops";
import { CONTEXT_PATTERN_KEYS, DDD_REL_KEYS, DDD_ROLE_KEYS, docMode, type Doc } from "./schema";

const built = DDD_EXAMPLES.map((ex) => ({ ex, files: buildExample(ex) }));
const serious = (doc: Doc, exists: (p: string) => boolean) => validateDetailed(doc, { exists }).filter((i) => i.severity !== "dica");

test("exemplos: ids únicos, caminhos coerentes com o título (o app cria o arquivo pelo título) e visão geral primeiro", () => {
  assert.equal(new Set(DDD_EXAMPLES.map((e) => e.id)).size, DDD_EXAMPLES.length);
  for (const { ex, files } of built) {
    assert.equal(ex.files[0].file, "visao-geral", `${ex.id}: o mapa de contextos vem primeiro`);
    assert.equal(new Set(files.map((f) => f.path)).size, files.length, `${ex.id}: caminhos únicos`);
    for (const f of ex.files) assert.equal(fileSlug(f), f.file, `${ex.id}/${f.file}: slug do título "${f.title}"`);
    for (const f of files) assert.ok(f.path.startsWith(`${EXAMPLES_DIR}/${ex.id}/`) && f.path.endsWith(".archflow.json"));
    assert.ok(ex.summary.length > 40 && ex.teaches.length >= 5, `${ex.id}: resumo e conceitos`);
  }
});

test("exemplos: todo diagrama aplica sem erro de op e valida sem erros nem avisos (dicas são permitidas)", () => {
  for (const { ex, files } of built) {
    const exists = (p: string) => files.some((f) => f.path === p);
    for (const f of files) assert.deepEqual(serious(f.doc, exists).map((i) => `${i.rule} ${i.message}`), [], `${ex.id}/${f.path}`);
  }
});

test("exemplos: todo caso de uso é rastreado até um evento e cada modelo atinge as metas de qualidade", () => {
  for (const { ex, files } of built) {
    const exists = (p: string) => files.some((f) => f.path === p);
    let ucs = 0;
    for (const f of files.filter((x) => docMode(x.doc) === "domain")) {
      const ev = evaluateDomain(f.doc, { exists });
      assert.equal(ev.ok, true, `${ex.id}/${f.path}: ${JSON.stringify(ev)}`);
      for (const u of f.doc.nodes.filter((n) => n.ddd?.role === "use-case")) {
        ucs++;
        const t = traceUseCase(f.doc, u.id)!;
        assert.equal(t.ok, true, `${ex.id}: ${u.id} → ${t.problems.join("; ")}`);
      }
    }
    assert.ok(ucs >= 3, `${ex.id}: pelo menos 3 casos de uso (tem ${ucs})`);
  }
});

test("exemplos: a visão geral do cofre de cada exemplo não tem avisos nem erros, só dicas", () => {
  for (const { ex, files } of built) {
    const text = domainOverview(files);
    const avisos = (text.split("## Avisos")[1] ?? "").split("\n").filter((l) => /\[D\d+ (erro|aviso)\]/.test(l));
    assert.deepEqual(avisos, [], ex.id);
    assert.match(text, /rastreados até um evento \(100%\)/, ex.id);
  }
});

test("exemplos: juntos cobrem todos os papéis, todas as relações e vários padrões do Context Map", () => {
  const roles = new Set<string>();
  const rels = new Set<string>();
  const patterns = new Set<string>();
  const subdomains = new Set<string>();
  for (const { files } of built)
    for (const f of files) {
      f.doc.nodes.forEach((n) => n.ddd && roles.add(n.ddd.role));
      f.doc.connections.forEach((c) => c.ddd && (rels.add(c.ddd.rel), c.ddd.pattern && patterns.add(c.ddd.pattern)));
      f.doc.groups.forEach((g) => g.subdomain && subdomains.add(g.subdomain));
    }
  assert.deepEqual(DDD_ROLE_KEYS.filter((r) => !roles.has(r)), [], "papéis não ilustrados");
  assert.deepEqual(DDD_REL_KEYS.filter((r) => !rels.has(r)), [], "relações não ilustradas");
  assert.deepEqual([...subdomains].sort(), ["core", "generic", "supporting"]);
  assert.ok(patterns.size >= 4, `padrões do Context Map ilustrados: ${[...patterns].join(", ")}`);
  assert.ok([...patterns].every((p) => (CONTEXT_PATTERN_KEYS as string[]).includes(p)));
});

test("exemplos: ilustram decisão com loop, ramos condicionais (senão) e iteração", () => {
  const conns = built.flatMap((b) => b.files.flatMap((f) => f.doc.connections.map((c) => ({ ex: b.ex.id, c }))));
  assert.ok(conns.some((x) => x.c.ddd?.loop), "algum loop");
  assert.ok(conns.some((x) => x.c.ddd?.condition), "alguma condição");
  assert.ok(conns.some((x) => x.c.ddd?.otherwise), "algum senão");
  assert.ok(conns.some((x) => x.c.ddd?.foreach), "alguma iteração");
  const decisions = built.flatMap((b) => b.files.flatMap((f) => f.doc.nodes.filter((n) => n.ddd?.role === "decision")));
  assert.ok(decisions.length >= 1);
  for (const d of decisions) assert.ok(d.ddd!.question, "a decisão diz a pergunta que responde");
});

test("exemplos: eventos entre contextos têm produtor e consumidor reais (o nome contexto.evento existe no outro diagrama)", () => {
  for (const { ex, files } of built) {
    const published = new Map<string, Set<string>>();
    for (const f of files.filter((x) => docMode(x.doc) === "domain"))
      for (const g of f.doc.groups.filter((x) => x.kind === "context")) published.set(g.id, new Set(f.doc.nodes.filter((n) => n.ddd?.role === "domain-event" && !n.ddd.external).map((n) => n.id)));
    for (const f of files)
      for (const n of f.doc.nodes.filter((x) => x.ddd?.external)) {
        const [c, e] = n.ddd!.external!.split(".");
        assert.ok(published.get(c)?.has(e), `${ex.id}: ${n.id} consome ${n.ddd!.external}, que ninguém publica`);
      }
  }
});

test("exemplos: o diagrama de arquitetura da loja implementa os contextos e os contextos apontam para ele", () => {
  const loja = built.find((b) => b.ex.id === "loja")!;
  const arq = loja.files.find((f) => f.path.endsWith("/arquitetura.archflow.json"))!;
  assert.equal(docMode(arq.doc), "architecture");
  assert.ok(["pedidos-api", "pagamentos-api", "estoque-api", "eventos"].every((id) => arq.doc.nodes.some((n) => n.id === id)));
  const pedidos = loja.files.find((f) => f.path.endsWith("/pedidos.archflow.json"))!;
  const ref = pedidos.doc.nodes.find((n) => n.kind === "system")!;
  assert.deepEqual(ref.ref, { diagram: arq.path, node: "pedidos-api" });
  assert.ok(arq.doc.nodes.some((n) => n.id === ref.ref!.node));
});

test("exemplos: os arquivos em examples/ estão em dia com as definições (rode npm run examples:build)", () => {
  const root = join(process.cwd(), "examples");
  for (const f of renderAllExamples()) {
    const target = join(root, f.path);
    assert.ok(existsSync(target), `faltando: examples/${f.path}`);
    assert.equal(readFileSync(target, "utf8").replace(/\r\n/g, "\n"), f.content, `desatualizado: examples/${f.path}`);
  }
});

test("exemplos: os JSON gravados carregam como diagramas válidos (normalizeDoc) e preservam o modo", () => {
  for (const f of renderAllExamples().filter((x) => x.path.endsWith(".archflow.json"))) {
    const doc = normalizeDoc(JSON.parse(f.content));
    assert.equal(doc.schema, "archflow/1");
    assert.ok(doc.nodes.length > 0 && doc.title.length > 0);
  }
});

test("documentação dos exemplos: todo `código` que parece um id existe no exemplo (a prosa não desatualiza sem o teste avisar)", () => {
  const generic = new Set<string>([...DDD_ROLE_KEYS, ...DDD_REL_KEYS, ...CONTEXT_PATTERN_KEYS, "core", "supporting", "generic", "external", "step", "payload", "invariants", "intent", "context", "sync", "async", "stream", "data", "uc", "src", "visao-geral", "tsc", "npm", "mcp", "get-diagram", "domain-overview", "generate-code", "validate-diagram", "trace", "add-use-cases", "eval-domain", "examples-build"]);
  for (const { ex, files } of built) {
    const known = new Set<string>(generic);
    for (const f of files) {
      f.doc.nodes.forEach((n) => known.add(n.id));
      f.doc.groups.forEach((g) => known.add(g.id));
    }
    const readme = readFileSync(join(process.cwd(), "examples", EXAMPLES_DIR, ex.id, "README.md"), "utf8");
    const unknown = [...readme.matchAll(/`([a-z][a-z0-9-]*)`/g)].map((m) => m[1]).filter((t) => !known.has(t));
    assert.deepEqual([...new Set(unknown)], [], `${ex.id}/README.md cita ids que não existem`);
  }
});

test("documentação: os links relativos dos guias e dos exemplos apontam para arquivos que existem", () => {
  const docs = ["docs/DDD.md", "docs/DOMAIN_MODE.md", "examples/README.md", ...DDD_EXAMPLES.map((e) => `examples/${EXAMPLES_DIR}/${e.id}/README.md`)];
  for (const d of docs) {
    const text = readFileSync(join(process.cwd(), d), "utf8");
    for (const m of text.matchAll(/\]\(([^)\s]+)\)/g)) {
      const href = m[1].split("#")[0];
      if (!href || /^(https?:|mailto:)/.test(href)) continue;
      assert.ok(existsSync(join(process.cwd(), dirname(d), href)), `${d}: link quebrado → ${m[1]}`);
    }
  }
});

test("exemplos: o esqueleto de código de cada exemplo compila com tsc --strict", () => {
  for (const { ex, files } of built) {
    const dir = mkdtempSync(join(tmpdir(), `archflow-ex-${ex.id}-`));
    try {
      let n = 0;
      for (const f of files.filter((x) => docMode(x.doc) === "domain"))
        for (const g of generateCode(f.doc).filter((x) => x.path.endsWith(".ts"))) {
          mkdirSync(dirname(join(dir, g.path)), { recursive: true });
          writeFileSync(join(dir, g.path), g.content);
          n++;
        }
      assert.ok(n >= 8, `${ex.id}: gerou ${n} arquivos`);
      writeFileSync(join(dir, "tsconfig.json"), JSON.stringify({ compilerOptions: { target: "ES2022", module: "ESNext", moduleResolution: "Bundler", strict: true, noEmit: true, skipLibCheck: true, types: [], lib: ["ES2022"] }, include: ["**/*.ts"] }));
      const r = spawnSync("npx", ["tsc", "-p", dir], { cwd: process.cwd(), encoding: "utf8", shell: true });
      assert.equal(r.status, 0, `${ex.id}: ${r.stdout}${r.stderr}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});
