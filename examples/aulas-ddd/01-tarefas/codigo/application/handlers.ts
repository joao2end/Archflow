import type { EventoDeTarefa } from "../domain/eventos";
import { Tarefa } from "../domain/tarefa";
import { Titulo } from "../domain/titulo";
import type { ConcluirTarefa, CriarTarefa } from "./commands";

// #region handlers
/**
 * Command → aggregate → evento. O handler só traduz a intenção em chamadas ao aggregate:
 * nenhuma regra de negócio mora aqui (as regras estão no Titulo e na Tarefa).
 */
export function criarTarefa(
  cmd: CriarTarefa,
  novoId: () => string,
): { tarefa: Tarefa; eventos: EventoDeTarefa[] } {
  const { tarefa, evento } = Tarefa.criar(novoId(), Titulo.de(cmd.titulo));
  return { tarefa, eventos: [evento] };
}

/** Nesta aula quem chama entrega a tarefa; na aula 2 um repository passa a buscá-la. */
export function concluirTarefa(cmd: ConcluirTarefa, tarefa: Tarefa, agora = new Date()): EventoDeTarefa[] {
  if (tarefa.id !== cmd.tarefaId) throw new Error("O command é de outra tarefa.");
  return [tarefa.concluir(agora)];
}
// #endregion
