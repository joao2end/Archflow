/**
 * Arquivos derivados dos exemplos: os diagramas em JSON e o texto do modelo (o que uma IA lê).
 * Usado por `scripts/build-examples.ts` (grava) e pelos testes (conferem que o que está em disco não ficou desatualizado).
 */
import { domainOverview } from "./domain";
import { DDD_EXAMPLES, EXAMPLES_DIR, buildExample, type DddExample } from "./examples";
import { describe } from "./ops";
import { docMode } from "./schema";

export interface RenderedFile {
  /** relativo à pasta `examples/` */
  path: string;
  content: string;
}

export function renderExample(ex: DddExample): RenderedFile[] {
  const docs = buildExample(ex);
  const exists = (p: string) => docs.some((d) => d.path === p);
  const out: RenderedFile[] = docs.map((d) => ({ path: d.path, content: JSON.stringify(d.doc, null, 2) + "\n" }));
  const model = [
    `# ${ex.title}: o modelo em texto`,
    "",
    `> Gerado a partir dos diagramas desta pasta (\`npm run examples:build\`); é exatamente o que um agente (MCP) recebe em \`get_diagram\` e \`domain_overview\`. Não edite à mão.`,
    "",
    "# Visão geral do cofre",
    "",
    domainOverview(docs).replace(/^# Visão geral do domínio\n\n?/, ""),
    ...docs.flatMap((d) => ["", "---", "", `<!-- ${d.path} -->`, describe(d.doc, docMode(d.doc) === "domain" ? { exists } : {})]),
  ].join("\n");
  out.push({ path: `${EXAMPLES_DIR}/${ex.id}/modelo.md`, content: model.replace(/\n{3,}/g, "\n\n") + "\n" });
  return out;
}

export const renderAllExamples = (): RenderedFile[] => DDD_EXAMPLES.flatMap(renderExample);
