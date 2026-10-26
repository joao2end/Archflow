import type { TarefaConcluida, TarefaCriada } from "./eventos";
import { Titulo } from "./titulo";

// #region Tarefa
/**
 * Aggregate root: tem identidade (o id) e guarda as regras do conjunto. Ninguém de fora muda o estado
 * sem passar por um método dele, e cada método que muda o estado devolve o fato que aconteceu.
 */
export class Tarefa {
  private constructor(
    readonly id: string,
    readonly titulo: Titulo,
    private concluida: boolean,
  ) {}

  /** Criar também é regra de negócio: devolve a tarefa nova e o evento. */
  static criar(id: string, titulo: Titulo): { tarefa: Tarefa; evento: TarefaCriada } {
    const tarefa = new Tarefa(id, titulo, false);
    return { tarefa, evento: { tipo: "TarefaCriada", tarefaId: id, titulo: titulo.texto } };
  }

  get estaConcluida(): boolean {
    return this.concluida;
  }

  /** Invariante: uma tarefa concluída não volta a ser concluída. */
  concluir(agora: Date): TarefaConcluida {
    if (this.concluida) throw new Error("Esta tarefa já foi concluída.");
    this.concluida = true;
    return { tipo: "TarefaConcluida", tarefaId: this.id, em: agora };
  }
}
// #endregion
