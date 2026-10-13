/**
 * Avaliação dos nós lógicos (loop em docs/LOGIC_NODES_LOOP_PROMPT.md).
 *
 *   npm run eval:nodes           # problemas de referência + ponto de partida de cada nó
 *   npm run eval:nodes -- --json # saída em JSON (para o histórico)
 *
 * Parte 1 — CAPACIDADE: cada problema (algoritmo ou regra de negócio) tem um oráculo tirado do enunciado.
 *   REPRESENTADO = o diagrama ideal se constrói e passa em 100% do oráculo.
 *   FALHA        = constrói, mas o oráculo não bate (o desenho não representa o problema).
 *   BLOQUEADO    = o app não tem o nó/função: a op é recusada (a mensagem é a do próprio motor).
 * Parte 2 — PONTO DE PARTIDA: o que acontece com cada nó recém-criado pela biblioteca (nasce válido? quantos avisos?).
 *
 * Sai com 1 se algum problema não for REPRESENTADO.
 */
import { nodeCases } from "../src/shared/nodes.cases";
import { runOracle } from "../src/shared/logiceval";
import { checkLogicNode, logicIssues } from "../src/shared/logic";
import { applyOps, type Op } from "../src/shared/ops";
import { LOGIC_ROLE_KEYS, LOGIC_ROLES, emptyDoc, type LogicNodeSpec } from "../src/shared/schema";

const json = process.argv.includes("--json");
type Row = { id: string; exercita: string; status: "REPRESENTADO" | "FALHA" | "BLOQUEADO"; detalhe: string; nos: number; setas: number };
const rows: Row[] = [];

for (const c of nodeCases()) {
  try {
    const doc = c.build();
    const v = runOracle(doc, c.oraculo);
    const ok = v.passed === v.total;
    rows.push({ id: c.id, exercita: c.exercita, status: ok ? "REPRESENTADO" : "FALHA", detalhe: ok ? `${v.passed}/${v.total}` : `${v.passed}/${v.total} · ${v.failed[0]}`, nos: doc.nodes.length, setas: doc.connections.length });
  } catch (e) {
    rows.push({ id: c.id, exercita: c.exercita, status: "BLOQUEADO", detalhe: (e as Error).message.slice(0, 160), nos: 0, setas: 0 });
  }
}

// ponto de partida: o que a biblioteca cria (mesmos valores provisórios de store.ts) e o que o validador diz logo em seguida
const PLACEHOLDER: Partial<Record<string, LogicNodeSpec>> = { decision: { role: "decision", when: "condicao" }, loop: { role: "loop", until: "condicao" } };
const start = LOGIC_ROLE_KEYS.map((role) => {
  const spec = PLACEHOLDER[role] ?? ({ role } as LogicNodeSpec);
  const invalid = checkLogicNode(spec);
  let avisos = 0;
  if (!invalid) {
    const base: Op[] = [{ op: "add_node", id: "no", label: LOGIC_ROLES[role].label, logic: spec }];
    const r = applyOps(emptyDoc("t", "logic"), base);
    avisos = logicIssues(r.doc).filter((i) => i.severity !== "dica").length;
  }
  return { role, campos: LOGIC_ROLES[role].fields.length, nasceValido: !invalid, avisos, motivo: invalid };
});

if (json) {
  console.log(JSON.stringify({ capacidade: rows, pontoDePartida: start }, null, 2));
} else {
  const n = rows.filter((r) => r.status === "REPRESENTADO").length;
  console.log(`CAPACIDADE: ${n}/${rows.length} problemas representados\n`);
  for (const r of rows) console.log(`${r.status === "REPRESENTADO" ? "✔" : r.status === "FALHA" ? "✘" : "⛔"} ${r.status.padEnd(12)} ${r.id.padEnd(22)} ${r.exercita}${r.status === "REPRESENTADO" ? `  [${r.nos} nós, ${r.setas} setas, oráculo ${r.detalhe}]` : `\n               ${r.detalhe}`}`);
  console.log(`\nPONTO DE PARTIDA (nó recém-criado): ${start.filter((s) => s.nasceValido).length}/${start.length} nascem válidos\n`);
  for (const s of start) console.log(`${s.nasceValido ? "✔" : "✘"} ${s.role.padEnd(9)} ${s.campos} campos${s.nasceValido ? ` · ${s.avisos} aviso(s) logo ao criar` : ` · ${s.motivo}`}`);
}
process.exit(rows.every((r) => r.status === "REPRESENTADO") ? 0 : 1);
