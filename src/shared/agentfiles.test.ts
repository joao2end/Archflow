import assert from "node:assert/strict";
import { test } from "node:test";
import { agentIssues, checkAgentNode } from "./agents";
import { fileExt, kindOfFileName, outputPathError } from "./agentfiles";
import { applyOps, type Op } from "./ops";
import { emptyDoc, AGENT_FILE_MAX_CHARS, type AgentNodeSpec, type AgentRel, type Doc } from "./schema";
import { generateHarness } from "./agentgen";

const LONG = "Descrição suficientemente longa para o agente decidir quando usar este arquivo.";
const an = (id: string, agent: AgentNodeSpec): Op => ({ op: "add_node", id, label: id, kind: "agent", agent });
const rel = (from: string, to: string, r: AgentRel, usage?: string): Op => ({ op: "add_connection", from, to, agent: { rel: r, ...(usage ? { usage } : {}) } });

function build(ops: Op[]): Doc {
  const { doc, results } = applyOps(emptyDoc("t", "agents"), ops);
  assert.ok(results.every((r) => r.ok), results.find((r) => !r.ok)?.error ?? "op falhou");
  return doc;
}
const rules = (doc: Doc) => agentIssues(doc).map((i) => i.rule);
const fileOf = (files: { path: string; content: string; encoding?: string }[], path: string) => files.find((f) => f.path === path);

const base64 = Buffer.from("PNGDATA").toString("base64");
const team = (): Op[] => [
  an("revisor", { role: "agent", description: "Revisa mudanças e aponta o que falta.", tools: ["Bash"], prompt: "Revise." }),
  an("schema", { role: "file", description: "Schema dos dados de entrada.", fileKind: "json", fileName: "schema.json", fileContent: '{"type":"object"}' }),
  an("planilha", { role: "file", fileKind: "xlsx", fileName: "vendas.xlsx", fileContent: base64 }),
  an("logo", { role: "file", fileKind: "image", fileName: "logo.webp", fileContent: base64 }),
  an("relatorio", { role: "output", description: "Riscos encontrados.", fileKind: "md", fileName: "docs/riscos.md", fileContent: "# Modelo" }),
  rel("revisor", "schema", "uses-file", "Valida o formato dos dados antes de sugerir mudança."),
  rel("revisor", "planilha", "uses-file", "Confere os totais da planilha."),
  rel("revisor", "logo", "uses-file"),
  rel("revisor", "relatorio", "produces"),
];

test("checkAgentNode aceita file e output bem formados e recusa formato, caminho e tamanho inválidos", () => {
  assert.equal(checkAgentNode({ role: "file", fileKind: "csv", fileName: "a.csv", fileContent: "a,b" }), undefined);
  assert.match(checkAgentNode({ role: "file", fileKind: "pdf" }) ?? "", /fileKind inválido "pdf"/);
  assert.match(checkAgentNode({ role: "output", fileKind: "json", fileName: "../fora.json" }) ?? "", /não pode subir/);
  assert.match(checkAgentNode({ role: "output", fileKind: "json", fileName: "/etc/x.json" }) ?? "", /relativo à raiz/);
  assert.match(checkAgentNode({ role: "file", fileKind: "json", fileContent: "x".repeat(AGENT_FILE_MAX_CHARS + 1) }) ?? "", /passa de/);
  assert.match(checkAgentNode({ role: "agent", description: LONG, fileKind: "json" }) ?? "", /campo "fileKind" não existe/);
});

test("outputPathError e kindOfFileName: caminhos e extensões", () => {
  assert.equal(outputPathError("docs/riscos.md"), undefined);
  assert.ok(outputPathError("C:/x.md"));
  assert.equal(kindOfFileName("Planilha.XLSX"), "xlsx");
  assert.equal(kindOfFileName("notas.docx"), undefined);
  assert.equal(fileExt({ fileKind: "image", fileName: "a.JPG" }), "jpg");
  assert.equal(fileExt({ fileKind: "image", fileName: "a.txt" }), "png");
  assert.equal(fileExt({ fileKind: "md", fileName: "x.markdown" }), "md");
});

test("harness: arquivos vão para .claude/files, binários em base64, e o agente ganha Read e Write", () => {
  const files = generateHarness(build(team()), "claude");
  assert.deepEqual(
    files.map((f) => f.path),
    [
      ".claude/agents/revisor.md",
      ".claude/files/logo.webp",
      ".claude/files/planilha.xlsx",
      ".claude/files/relatorio.md",
      ".claude/files/schema.json",
    ],
  );
  assert.equal(fileOf(files, ".claude/files/schema.json")?.encoding, undefined);
  assert.equal(fileOf(files, ".claude/files/schema.json")?.content, '{"type":"object"}');
  assert.equal(fileOf(files, ".claude/files/logo.webp")?.encoding, "base64");
  const agent = fileOf(files, ".claude/agents/revisor.md")!.content;
  assert.match(agent, /tools:\n {2}- "?Bash"?\n {2}- Read\n {2}- Write/);
  assert.match(agent, /## Arquivos de referência/);
  assert.match(agent, /`\.claude\/files\/schema\.json` \(JSON, schema\.json\): Valida o formato/);
  assert.match(agent, /`\.claude\/files\/vendas\.xlsx`|`\.claude\/files\/planilha\.xlsx`/);
  assert.match(agent, /## Saída\n\nEntregue o resultado exatamente neste arquivo e formato:\n\n- Grave em `docs\/riscos\.md` no formato Markdown\. Siga o modelo em `\.claude\/files\/relatorio\.md`\./);
});

test("harness: arquivo sem seta não é exportado; cursor usa .cursor/files", () => {
  const doc = build([...team(), an("solto", { role: "file", fileKind: "csv", fileName: "solto.csv", fileContent: "a" })]);
  const claude = generateHarness(doc, "claude");
  assert.equal(fileOf(claude, ".claude/files/solto.csv"), undefined);
  const cursor = generateHarness(doc, "cursor");
  assert.ok(fileOf(cursor, ".cursor/files/schema.json"));
  assert.match(fileOf(cursor, ".cursor/agents/revisor.md")!.content, /`\.cursor\/files\/schema\.json`/);
});

test("regras A025–A030 apontam conteúdo vazio, arquivo sem leitor, saída sem entregador, duplicata e extensão", () => {
  const doc = build([
    an("vazio", { role: "file", fileKind: "json", fileName: "v.json" }),
    an("sem-uso", { role: "file", fileKind: "json", fileName: "s.json", fileContent: "{}" }),
    an("saida-solta", { role: "output", fileKind: "json", fileName: "x.json" }),
    an("dup-a", { role: "output", fileKind: "md", fileName: "rel.md" }),
    an("dup-b", { role: "output", fileKind: "md", fileName: "rel.md" }),
    an("sem-ext", { role: "output", fileKind: "csv", fileName: "dados" }),
    an("ag", { role: "agent", description: LONG }),
    rel("ag", "dup-a", "produces"),
    rel("ag", "dup-b", "produces"),
    rel("ag", "vazio", "uses-file", "Lê o rascunho para completar."),
  ]);
  const r = rules(doc);
  for (const code of ["A025", "A026", "A027", "A028", "A029"]) assert.ok(r.includes(code), `faltou ${code}: ${r.join(",")}`);
  assert.ok(!r.includes("A030"));
  assert.ok(agentIssues(doc).some((i) => i.rule === "A026" && i.target === "sem-uso"));
});

test("regra A018 não cobra usage em produces, mas cobra em uses-file", () => {
  const doc = build([
    an("ag", { role: "agent", description: LONG }),
    an("arq", { role: "file", fileKind: "json", fileName: "a.json", fileContent: "{}" }),
    an("out", { role: "output", fileKind: "json", fileName: "b.json" }),
    rel("ag", "arq", "uses-file"),
    rel("ag", "out", "produces"),
  ]);
  const a018 = agentIssues(doc).filter((i) => i.rule === "A018");
  assert.equal(a018.length, 1);
  assert.match(a018[0].message, /o arquivo/);
});
