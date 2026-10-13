import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";
import { emptyDoc, type Doc, type LogicBranch, type LogicNodeSpec } from "./schema";
import { applyOps, normalizeDoc, validateDetailed, type Op } from "./ops";
import { parseExpr, evaluate, FUNCTIONS } from "./expr";
import { runFlow, runPipeline } from "./logic";
import { exprToTs, generateLogicTypeScript, typeToTs } from "./logicgen";
import { parseType } from "./types";

const node = (id: string, logic: LogicNodeSpec, label = id): Op => ({ op: "add_node", id, label, logic });
const edge = (from: string, to: string, branch?: LogicBranch, kase?: string): Op => ({ op: "add_connection", from, to, ...(branch || kase ? { logic: branch ? { branch } : { case: kase! } } : {}) });
const build = (title: string, ops: Op[]): Doc => {
  const r = applyOps(emptyDoc(title, "logic"), ops);
  assert.deepEqual(r.results.filter((x) => !x.ok), []);
  return r.doc;
};

/** Grava os arquivos gerados numa pasta temporária (dentro do projeto, para o TS achar os tipos do Node). */
const ROOT = mkdtempSync(join(tmpdir(), "archflow-gen-"));
process.on("exit", () => rmSync(ROOT, { recursive: true, force: true }));
function emit(doc: Doc, name: string) {
  const files = generateLogicTypeScript(doc);
  assert.ok(files.length >= 2, `${name}: nada gerado`);
  const dir = join(ROOT, name);
  for (const f of files) {
    const target = join(dir, f.path.split("/").slice(1).join("/"));
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, f.content);
  }
  const main = files.find((f) => !f.path.endsWith("runtime.ts") && !f.path.endsWith(".test.ts"))!;
  return { dir, main: join(dir, basename(main.path)), files };
}

const near = (a: unknown, b: unknown): boolean => {
  if (typeof a === "number" && typeof b === "number") return Math.abs(a - b) < 1e-9;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => near(x, b[i]));
  if (a && b && typeof a === "object" && typeof b === "object") return Object.keys(a).length === Object.keys(b).length && Object.keys(a).every((k) => near((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
  return a === b;
};

/* ───────── expressões: o código compilado dá o mesmo que o interpretador ───────── */

test("expressões compiladas dão o mesmo valor que o interpretador", async () => {
  const doc = build("expressoes", [node("i", { role: "start" }), node("a", { role: "rule", then: ["x := 1"] }), node("f", { role: "end" }), edge("i", "a"), edge("a", "f")]);
  const { dir } = emit(doc, "expressoes");
  const R = (await import(pathToFileURL(join(dir, "runtime.ts")).href)) as typeof import("./logicgen") & Record<string, any>;
  const env = { a: 7, b: 2.5, s: "Ana", l: [3, 1, 2], o: { k: 5, nome: "x" }, v: null, itens: [{ preco: 10, qtd: 2 }, { preco: 30, qtd: 1 }], nome: "  João " };
  const srcs = [
    "a + b * 2", "(a - 1) / b", "a % 4", "-a + 1", "5% * 200", "a > b e s = \"Ana\"", "a < 3 ou nao (b >= 2.5)", "a em [1, 7]", "a nao em [1, 7]",
    "se a > 5 entao \"alto\" senao \"baixo\"", "l[1]", "o.k + 1", "s + \"!\"", "v = nulo", "l = [3, 1, 2]",
    "filtrar(itens, preco > 5)", "mapear(itens, preco * qtd)", "soma(mapear(itens, preco * qtd))", "mapear(l, item * 2)", "filtrar(l, item > 1)",
    "min(a, b)", "max(l[0], l[1], l[2])", "arredondar(b, 0)", "arredondar(-2.5, 0)", "arredondar(3.14159, 2)", "piso(-1.5)", "aparar(nome)", "maiusculas(aparar(nome))",
    "tamanho(l)", "contem(l, 2)", "entre(a, 1, 10)", "vazio(v)", "ordenar(l)", "unicos([1, 2, 2])", "adicionar(l, 9)", "primeiro(l)", "ultimo(l)", "media(l)", "juntar(l, \"-\")",
    "partir(\"a,b\", \",\")", "trocar(\"a b\", \" \", \"_\")", "texto(a) + \"x\"", "numero(\"12,5\")", "dias_entre(\"2026-09-12\", \"2026-10-12\")", "somar_dias(\"2026-01-15\", 30)",
    ...Object.entries(FUNCTIONS).filter(([k]) => k !== "segredo").map(([, f]) => f.ex),
    // erros: os dois lados precisam falhar
    "a / 0", "a % 0", "s + 1", "l[9]", "o.zzz", "nao a", "soma([1, \"a\"])", "se a entao 1 senao 2",
  ];
  for (const src of srcs) {
    let want: unknown;
    let wantErr = false;
    try {
      want = evaluate(parseExpr(src), env);
    } catch {
      wantErr = true;
    }
    const code = exprToTs(parseExpr(src), "env");
    // eslint-disable-next-line no-new-func
    const fn = new Function("R", "env", `return ${code};`);
    if (wantErr) assert.throws(() => fn(R, env), /./s, `«${src}» deveria falhar também no código gerado`);
    else assert.ok(near(fn(R, env), want), `«${src}»: interpretador ${JSON.stringify(want)}, código gerado ${JSON.stringify(fn(R, env))}`);
  }
});

test("tipos do modo viram tipos do TypeScript", () => {
  const ts = (s: string) => typeToTs(parseType(s));
  assert.equal(ts("int"), "number");
  assert.equal(ts("float"), "number");
  assert.equal(ts("string[]"), "string[]");
  assert.equal(ts('"ouro" | "prata"'), '"ouro" | "prata"');
  assert.equal(ts("{ preco: number; cupom?: string }[]"), "{ preco: number; cupom?: string }[]");
  assert.equal(ts("(string | number)[]"), "(string | number)[]");
});

/* ───────── fluxo: todos os recursos, rodando de verdade ───────── */

function bigFlow(): Doc {
  return build("Pedido completo", [
    node("total", { role: "input", key: "total", type: "number" }),
    node("itens", { role: "input", key: "itens", type: "{ preco: number; qtd: number }[]" }),
    node("cep", { role: "input", key: "cep", type: "string", value: "01001000" }),
    node("frete", { role: "output", key: "frete", type: "number" }),
    node("soma", { role: "variable", key: "soma", type: "number", value: 0 }),
    node("cidade", { role: "output", key: "cidade", type: "string | null" }),
    node("i", { role: "start" }),
    node("loop", { role: "loop", foreach: "itens", as: "it" }),
    node("acc", { role: "rule", then: ["soma := soma + it.preco * it.qtd"] }),
    node("d", { role: "decision", when: "soma >= 200" }),
    node("gratis", { role: "rule", then: ["frete := 0", "travar frete"] }),
    node("pago", { role: "rule", then: ["frete := 15"] }),
    node("fork", { role: "fork" }),
    node("rb1", { role: "rule", then: ["a1 := soma * 2"] }),
    node("rb2", { role: "rule", then: ["a2 := soma + 1"] }),
    node("join", { role: "join" }),
    node("viacep", {
      role: "call",
      request: { method: "GET", url: '"https://viacep.com.br/ws/" + cep + "/json"', headers: { Accept: '"application/json"' } },
      mock: { localidade: "São Paulo", uf: "SP" },
      falha: "status_http = 404",
      devolve: ["cidade := resposta.localidade"],
    }),
    node("post", {
      role: "call",
      request: { method: "POST", url: '"https://api.exemplo.com/pedidos"', body: { valor: "soma", cidade: "cidade" } },
      mock: { id: 9 },
    }),
    node("fim", { role: "end" }),
    node("erro", { role: "end", outcome: "erro" }),
    node("c1", { role: "scenario", examples: [{ name: "grande", given: { total: 0, itens: [{ preco: 100, qtd: 2 }, { preco: 50, qtd: 1 }] }, expect: { soma: 250, frete: 0, cidade: "São Paulo", desfecho: "ok" } }, { name: "pequeno", given: { total: 0, itens: [{ preco: 10, qtd: 3 }] }, expect: { soma: 30, frete: 15, a1: 60, a2: 31, desfecho: "ok" } }] }),
    edge("i", "loop"),
    edge("loop", "acc", "repete"),
    edge("acc", "loop"),
    edge("loop", "d", "segue"),
    edge("d", "gratis", "sim"),
    edge("d", "pago", "nao"),
    edge("gratis", "fork"),
    edge("pago", "fork"),
    edge("fork", "rb1"),
    edge("fork", "rb2"),
    edge("rb1", "join"),
    edge("rb2", "join"),
    edge("join", "viacep"),
    edge("viacep", "post"),
    edge("viacep", "erro", "erro"),
    edge("post", "fim"),
  ]);
}

test("fluxo completo: o código gerado dá o mesmo resultado que o interpretador do app (e usa a resposta HTTP)", async () => {
  const doc = bigFlow();
  assert.deepEqual(validateDetailed(doc).filter((i) => i.severity === "erro"), []);
  const { main, files } = emit(doc, "pedido");
  const mod = await import(pathToFileURL(main).href);
  assert.ok(files.some((f) => f.path.endsWith(".test.ts")));
  const calls: string[] = [];
  for (const given of [
    { itens: [{ preco: 100, qtd: 2 }, { preco: 50, qtd: 1 }], total: 0 },
    { itens: [{ preco: 10, qtd: 3 }], total: 0 },
    { itens: [], total: 0 },
  ]) {
    const want = runFlow(doc, given);
    assert.equal(want.steps.find((s) => s.error), undefined);
    const got = await mod.run(given, {
      fetch: async (url: string, init: { method: string; body?: string }) => {
        calls.push(`${init.method} ${url} ${init.body ?? ""}`);
        return new Response(JSON.stringify(String(url).includes("viacep") ? { localidade: "São Paulo", uf: "SP" } : { id: 9 }), { status: 200 });
      },
    });
    assert.equal(got.outcome, want.outcome);
    for (const k of Object.keys(want.env)) if (k !== "it") assert.ok(near(got.data[k], want.env[k]), `${k}: app ${JSON.stringify(want.env[k])}, código ${JSON.stringify(got.data[k])}`);
    assert.deepEqual(got.locked, want.locked);
  }
  // a chamada HTTP de verdade: método, endereço montado por expressão e corpo JSON
  assert.equal(calls[0], "GET https://viacep.com.br/ws/01001000/json ");
  assert.equal(calls[1], 'POST https://api.exemplo.com/pedidos {"valor":250,"cidade":"São Paulo"}');
});

test("chamada HTTP: status fora de 2xx e erro de rede seguem pela seta erro; sem a seta, é erro", async () => {
  const doc = bigFlow();
  const { main } = emit(doc, "pedido-erro");
  const mod = await import(pathToFileURL(main).href);
  const given = { itens: [{ preco: 10, qtd: 1 }], total: 0 };
  const r500 = await mod.run(given, { fetch: async () => new Response("oops", { status: 500 }) });
  assert.equal(r500.outcome, "erro");
  const rNet = await mod.run(given, { fetch: async () => { throw new Error("sem rede"); } });
  assert.equal(rNet.outcome, "erro");
  // a condição `falha` também vale com a resposta real
  const r404 = await mod.run(given, { fetch: async () => new Response("{}", { status: 404 }) });
  assert.equal(r404.outcome, "erro");
  // post (segunda chamada) não tem seta erro: falhar lá é erro
  await assert.rejects(
    mod.run(given, { fetch: async (url: string) => (String(url).includes("viacep") ? new Response('{"localidade":"X"}', { status: 200 }) : new Response("", { status: 500 })) }),
    /falta a seta "erro"/,
  );
  // troca por nó (deps.http) sem tocar no fetch
  const swapped = await mod.run(given, { http: { viacep: () => ({ status: 200, ok: true, body: { localidade: "Rio" } }), post: () => ({ status: 200, ok: true, body: {} }) } });
  assert.equal(swapped.data.cidade, "Rio");
});

test("decisão, escolha e laço (until/max): mesmos resultados do interpretador", async () => {
  const doc = build("Classificar", [
    node("n", { role: "input", key: "n", type: "int" }),
    node("tipo", { role: "input", key: "tipo", type: '"a" | "b" | "c"' }),
    node("i", { role: "start" }),
    node("c0", { role: "rule", then: ["k := 0", "r := 0"] }),
    node("lp", { role: "loop", until: "k >= n", max: 50 }),
    node("inc", { role: "rule", then: ["k := k + 1", "r := r + k"] }),
    node("sw", { role: "switch", on: "tipo" }),
    node("fa", { role: "rule", then: ["cls := \"A\""] }),
    node("fb", { role: "rule", then: ["cls := \"B\""] }),
    node("sf", { role: "end", outcome: "erro" }),
    node("fim", { role: "end" }),
    node("sw2", { role: "switch" }),
    node("g1", { role: "rule", then: ["faixa := 1"] }),
    node("g2", { role: "rule", then: ["faixa := 2"] }),
    edge("i", "c0"),
    edge("c0", "lp"),
    edge("lp", "inc", "repete"),
    edge("inc", "lp"),
    edge("lp", "sw", "segue"),
    edge("sw", "fa", undefined, '"a"'),
    edge("sw", "fb", undefined, '"b"'),
    edge("sw", "sf", "outros"),
    edge("fa", "sw2"),
    edge("fb", "sw2"),
    edge("sw2", "g1", undefined, "r <= 10"),
    edge("sw2", "g2", "outros"),
    edge("g1", "fim"),
    edge("g2", "fim"),
  ]);
  const { main } = emit(doc, "classificar");
  const mod = await import(pathToFileURL(main).href);
  for (const given of [{ n: 3, tipo: "a" }, { n: 6, tipo: "b" }, { n: 0, tipo: "a" }, { n: 100, tipo: "b" }, { n: 2, tipo: "c" }]) {
    const want = runFlow(doc, given);
    const got = await mod.run(given);
    assert.equal(got.outcome, want.outcome, JSON.stringify(given));
    for (const k of Object.keys(want.env)) assert.ok(near(got.data[k], want.env[k]), `${JSON.stringify(given)} ${k}: app ${JSON.stringify(want.env[k])}, código ${JSON.stringify(got.data[k])}`);
  }
});

test("erros de dados viram FlowError (divisão por zero, dado ausente)", async () => {
  const doc = build("Divide", [node("a", { role: "input", key: "a", type: "number" }), node("i", { role: "start" }), node("r", { role: "rule", then: ["x := 10 / a"] }), node("f", { role: "end" }), edge("i", "r"), edge("r", "f")]);
  const { main } = emit(doc, "divide");
  const mod = await import(pathToFileURL(main).href);
  assert.equal((await mod.run({ a: 5 })).data.x, 2);
  await assert.rejects(mod.run({ a: 0 }), /divisão por zero/);
  await assert.rejects(mod.run({}), /não tem valor/);
});

test("fila simples (sem setas) gera uma função sequencial, travas incluídas", async () => {
  const doc = build("Preço", [
    node("preco", { role: "input", key: "preco", type: "number" }),
    node("fixo", { role: "input", key: "fixo", type: "number", value: 0 }),
    node("r1", { role: "rule", order: 1, then: ["preco := preco * 1.1"] }),
    node("r2", { role: "rule", order: 2, then: ["preco := fixo", "travar preco"] }),
    node("r3", { role: "rule", order: 3, then: ["preco := 1"] }),
  ]);
  assert.ok(runPipeline(doc, { preco: 100, fixo: 55 }).locked.includes("preco"));
  const { main } = emit(doc, "preco");
  const mod = await import(pathToFileURL(main).href);
  const got = await mod.run({ preco: 100, fixo: 55 });
  assert.equal(got.data.preco, 55);
  assert.deepEqual(got.locked, ["preco"]);
});

/* ───────── nó Code, gatilhos e credenciais ───────── */

function codeFlow(trigger?: LogicNodeSpec["trigger"]): Doc {
  return build("Soma com código", [
    node("itens", { role: "input", key: "itens", type: "{ preco: number }[]" }),
    node("soma", { role: "output", key: "soma", type: "number" }),
    node("auth", { role: "variable", key: "auth", type: "string" }),
    node("i", { role: "start", ...(trigger ? { trigger } : {}) }),
    node("calc", {
      role: "code",
      text: "Soma os preços com TypeScript",
      code: "const total = (data.itens as { preco: number }[]).reduce((t, it) => t + it.preco, 0);\nif (total < 0) throw new Error('negativo');\nreturn { total };",
      mock: { total: 60 },
      falha: "falso",
      devolve: ["soma := resultado.total"],
    }),
    node("tok", { role: "rule", then: ['auth := "Bearer " + segredo("TOKEN")'] }),
    node("fim", { role: "end" }),
    node("erro", { role: "end", outcome: "erro" }),
    node("c1", { role: "scenario", examples: [{ name: "soma", given: { itens: [{ preco: 10 }, { preco: 50 }] }, expect: { soma: 60, desfecho: "ok" } }] }),
    edge("i", "calc"),
    edge("calc", "tok"),
    edge("calc", "erro", "erro"),
    edge("tok", "fim"),
  ]);
}

test("nó Code: o app usa o mock; o código gerado roda o TypeScript de verdade e erro vai pela seta erro", async () => {
  const doc = codeFlow();
  assert.deepEqual(validateDetailed(doc).filter((i) => i.severity === "erro"), []);
  const app = runFlow(doc, { itens: [{ preco: 1 }] });
  assert.equal(app.env.soma, 60, "no app, resultado = mock");
  assert.equal("resultado" in app.env, false);
  const { main, dir } = emit(doc, "codigo");
  const mod = await import(pathToFileURL(main).href);
  const ok = await mod.run({ itens: [{ preco: 10 }, { preco: 50 }] }, { secrets: { TOKEN: "abc" } });
  assert.equal(ok.data.soma, 60);
  assert.equal(ok.data.auth, "Bearer abc");
  assert.equal("resultado" in ok.data, false);
  const bad = await mod.run({ itens: [{ preco: -5 }] }, { secrets: { TOKEN: "abc" } });
  assert.equal(bad.outcome, "erro");
  // credencial ausente é erro claro (nem deps.secrets nem variável de ambiente)
  delete process.env.TOKEN;
  const { secrets } = await import(pathToFileURL(join(dir, "runtime.ts")).href);
  for (const k of Object.keys(secrets)) delete secrets[k];
  await assert.rejects(mod.run({ itens: [{ preco: 1 }] }), /credencial TOKEN não encontrada/);
  // sem a seta erro, o erro do código sobe como ele é
  const semErro = build("sem erro", [node("i", { role: "start" }), node("c", { role: "code", code: "throw new Error('boom');", mock: {} }), node("f", { role: "end" }), edge("i", "c"), edge("c", "f")]);
  const m2 = await import(pathToFileURL(emit(semErro, "codigo-sem-erro").main).href);
  await assert.rejects(m2.run({}), /boom/);
});

test("gatilho webhook gera handler (Fetch API); agenda gera onSchedule; manual só declara", async () => {
  const hook = codeFlow({ kind: "webhook", method: "POST", path: "/somar" });
  const mod = await import(pathToFileURL(emit(hook, "webhook").main).href);
  assert.deepEqual(mod.trigger, { kind: "webhook", method: "POST", path: "/somar" });
  const call = (method: string, body?: unknown) => mod.handler(new Request("http://x/somar", { method, ...(body !== undefined ? { body: typeof body === "string" ? body : JSON.stringify(body), headers: { "content-type": "application/json" } } : {}) }), { secrets: { TOKEN: "t" } });
  const ok = await call("POST", { itens: [{ preco: 7 }, { preco: 3 }] });
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), { outcome: "ok", output: { soma: 10 } });
  assert.equal((await call("GET")).status, 405);
  assert.equal((await call("POST", "{nao-json")).status, 400);
  assert.equal((await call("POST", { itens: [{ preco: -1 }] })).status, 422);

  const cron = codeFlow({ kind: "agenda", cron: "0 8 * * 1-5" });
  const m2 = await import(pathToFileURL(emit(cron, "agenda").main).href);
  assert.equal(m2.schedule, "0 8 * * 1-5");
  assert.equal(typeof m2.onSchedule, "function");
  const m3 = await import(pathToFileURL(emit(codeFlow(), "manual").main).href);
  assert.deepEqual(m3.trigger, { kind: "manual" });
});

test("gatilho e Code: validação das ops", () => {
  const add = (logic: unknown) => applyOps(emptyDoc("x", "logic"), [node("n", logic as never)]).results[0];
  assert.equal(add({ role: "start", trigger: { kind: "webhook", path: "/a", method: "GET" } }).ok, true);
  assert.equal(add({ role: "start", trigger: { kind: "agenda", cron: "*/5 * * * *" } }).ok, true);
  assert.match(String(add({ role: "start", trigger: { kind: "webhook" } }).error), /path/);
  assert.match(String(add({ role: "start", trigger: { kind: "webhook", path: "pedidos" } }).error), /path/);
  assert.match(String(add({ role: "start", trigger: { kind: "agenda", cron: "toda hora" } }).error), /cron/);
  assert.match(String(add({ role: "start", trigger: { kind: "agenda", cron: "* * * * *", path: "/x" } }).error), /webhook/);
  assert.match(String(add({ role: "start", trigger: { kind: "voz" } }).error), /kind inválido/);
  assert.match(String(add({ role: "end", trigger: { kind: "manual" } }).error), /trigger/);
  assert.match(String(add({ role: "code" }).error), /precisa de logic\.code/);
  assert.match(String(add({ role: "call", code: "return 1;" }).error), /code/);
  assert.equal(add({ role: "code", code: "return { a: 1 };" }).ok, true);
  const semMock = build("sm", [node("i", { role: "start" }), node("c", { role: "code", code: "return {};" }), node("f", { role: "end" }), edge("i", "c"), edge("c", "f")]);
  assert.ok(validateDetailed(semMock).some((i) => i.rule === "L033"));
});

/* ───────── todos os exemplos do repositório + tsc estrito + testes gerados ───────── */

const collect = (p: string): string[] => (statSync(p).isDirectory() ? readdirSync(p).flatMap((f) => collect(join(p, f))) : p.endsWith(".archflow.json") ? [p] : []);

test("exemplos de lógica do repositório: código gerado = interpretador, compila em modo estrito e os testes gerados passam", async () => {
  const roots = ["examples/exemplos-algoritmos", "examples/exemplos-logic"].filter(existsSync);
  const emitted: string[] = [];
  let compared = 0;
  for (const f of roots.flatMap(collect)) {
    const doc = normalizeDoc(JSON.parse(readFileSync(f, "utf8")));
    if (doc.mode !== "logic" || !doc.nodes.some((n) => n.logic?.role === "start" || n.logic?.role === "rule")) continue;
    const name = basename(f).replace(/\.archflow\.json$/, "");
    const { main, dir } = emit(doc, name);
    emitted.push(dir);
    const mod = await import(pathToFileURL(main).href);
    const oracle = join("src", "shared", "fixtures", "oracles", `${name}.json`);
    const givens = [
      ...doc.nodes.filter((n) => n.logic?.role === "scenario").flatMap((n) => n.logic!.examples ?? []).map((e) => e.given),
      ...(existsSync(oracle) ? (JSON.parse(readFileSync(oracle, "utf8")).cases ?? []).map((c: { given: Record<string, never> }) => c.given) : []),
    ];
    const flow = doc.nodes.some((n) => n.logic?.role === "start");
    for (const given of givens) {
      const want = flow ? runFlow(doc, given) : runPipeline(doc, given);
      if (want.steps.some((s) => s.error)) continue;
      const got = await mod.run(structuredClone(given));
      if (flow) assert.equal(got.outcome, want.outcome, `${name} ${JSON.stringify(given)}`);
      for (const k of Object.keys(want.env)) assert.ok(near(got.data[k], want.env[k]), `${name} ${JSON.stringify(given)} ${k}: app ${JSON.stringify(want.env[k])}, código ${JSON.stringify(got.data[k])}`);
      compared++;
    }
  }
  assert.ok(emitted.length >= 10 && compared >= 30, `poucos exemplos comparados (${emitted.length} diagramas, ${compared} casos)`);

  // o código gerado compila em modo estrito
  writeFileSync(join(ROOT, "tsconfig.json"), JSON.stringify({ compilerOptions: { target: "ES2022", module: "ESNext", moduleResolution: "Bundler", strict: true, noEmit: true, skipLibCheck: true, types: ["node"], typeRoots: [join(process.cwd(), "node_modules", "@types")], lib: ["ES2023", "DOM"] }, include: ["./**/*.ts"] }));
  const tsc = join(process.cwd(), "node_modules", "typescript", "bin", "tsc");
  try {
    execFileSync(process.execPath, [tsc, "-p", ROOT], { encoding: "utf8", stdio: "pipe" });
  } catch (e) {
    assert.fail("o código gerado não compila:\n" + String((e as { stdout?: string }).stdout ?? e).slice(0, 3000));
  }

  // e os testes gerados passam (inclui o fluxo HTTP com as respostas simuladas)
  const { dir: pedidoDir } = emit(bigFlow(), "pedido-testes");
  const tests = [...emitted, pedidoDir].flatMap((d) => readdirSync(d).filter((x) => x.endsWith(".test.ts")).map((x) => join(d, x)));
  assert.ok(tests.length >= 5);
  const tsx = join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs");
  try {
    execFileSync(process.execPath, [tsx, "--test", ...tests], { encoding: "utf8", stdio: "pipe" });
  } catch (e) {
    assert.fail("os testes gerados falharam:\n" + String((e as { stdout?: string }).stdout ?? e).slice(0, 4000));
  }
});

/* ───────── Call com request: validação e simulação no app ───────── */

test("Call com request: o app simula com `mock`, valida a sintaxe e avisa quando falta o mock", () => {
  const doc = bigFlow();
  const r = runFlow(doc, { itens: [{ preco: 10, qtd: 3 }], total: 0 });
  assert.equal(r.steps.find((s) => s.error), undefined);
  assert.equal(r.env.cidade, "São Paulo");
  assert.equal("resposta" in r.env, false, "resposta e status_http não vazam para os dados finais");
  const bad = (request: unknown) => applyOps(emptyDoc("x", "logic"), [node("c", { role: "call", request: request as never })]).results[0];
  assert.equal(bad({ method: "GET", url: '"https://a.com"' }).ok, true);
  assert.match(String(bad({ method: "FETCH", url: '"x"' }).error), /method inválido/);
  assert.match(String(bad({ method: "GET", url: "" }).error), /url/);
  assert.match(String(bad({ method: "GET", url: "a +" }).error), /logic\.request\.url/);
  assert.match(String(bad({ method: "GET", url: '"x"', body: { a: "1" } }).error), /não leva corpo/);
  assert.match(String(bad({ method: "POST", url: '"x"', body: { a: "1 +" } }).error), /body\.a/);
  const semMock = build("sem mock", [node("i", { role: "start" }), node("c", { role: "call", request: { method: "GET", url: '"https://a.com"' } }), node("f", { role: "end" }), edge("i", "c"), edge("c", "f")]);
  assert.ok(validateDetailed(semMock).some((i) => i.rule === "L032"));
  assert.ok(!validateDetailed(doc).some((i) => i.rule === "L032"));
  // `resposta` e `status_http` não geram aviso de «dado não declarado»
  assert.deepEqual(validateDetailed(doc).filter((i) => i.rule === "L002" && /resposta|status_http/.test(i.message)).map((i) => i.message), []);
});
