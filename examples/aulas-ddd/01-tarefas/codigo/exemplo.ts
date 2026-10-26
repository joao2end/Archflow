import { concluirTarefa, criarTarefa } from "./application/handlers";
import type { EventoDeTarefa } from "./domain/eventos";

// #region uso
/** O caso de uso «Organizar tarefas», como o Usuário o vive: criar uma tarefa e concluí-la. */
let n = 0;
const novoId = () => `t${++n}`;

const { tarefa, eventos } = criarTarefa({ titulo: "  Estudar DDD  " }, novoId);
const historico: EventoDeTarefa[] = [
  ...eventos,
  ...concluirTarefa({ tarefaId: tarefa.id }, tarefa),
];

for (const e of historico) console.log(e.tipo, e.tarefaId);
// TarefaCriada t1
// TarefaConcluida t1

try {
  concluirTarefa({ tarefaId: tarefa.id }, tarefa); // de novo: a invariante do aggregate recusa
} catch (e) {
  console.log("recusado:", (e as Error).message);
}
// #endregion
