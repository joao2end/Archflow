/**
 * Prepara o diagrama de um produto na instância isolada do loop de revisão (docs/WORKFLOW_REVIEW_LOOP_PROMPT.md):
 * aplica o modelo «Landing page Vue 3 com assets e motion» num diagrama agents novo e grava no bridge aberto.
 * Faz o prompt «Escrever a copy» usar {{anterior}} (a pesquisa do passo 1), para a memória ser exercitada.
 *
 *   npx tsx scripts/review-mkdoc.ts <titulo> [porta-do-bridge=7092]
 */
import { applyOps } from "../src/shared/ops";
import { applyTemplate, findAgentTemplate } from "../src/shared/agentcatalog";
import { emptyDoc } from "../src/shared/schema";

const [title = "Landing", port = "7092"] = process.argv.slice(2);
const base = emptyDoc(title, "agents");
const out = applyOps(base, applyTemplate(base, findAgentTemplate("team-landing-vue-motion")!, { x: 0, y: 0 }).ops);
const failed = out.results.filter((r) => !r.ok);
if (failed.length) throw new Error(`modelo não aplicou: ${JSON.stringify(failed)}`);
for (const n of out.doc.nodes) if (n.agent?.role === "prompt" && n.label === "Escrever a copy") n.agent.text += "\n\nPesquisa do passo anterior:\n{{anterior}}";
const res = await fetch(`http://localhost:${port}/api/doc`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ doc: out.doc }) });
if (!res.ok) throw new Error(`PUT /api/doc ${res.status}: ${await res.text()}`);
console.log(`ok: «${title}» com ${out.doc.nodes.length} nós no bridge ${port}`);
