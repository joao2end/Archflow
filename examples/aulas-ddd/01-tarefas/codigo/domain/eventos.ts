// #region eventos
/**
 * Eventos de domínio: fatos que já aconteceram, nomeados no passado.
 * Só dados, sem comportamento, e nunca mudam.
 */
export interface TarefaCriada {
  readonly tipo: "TarefaCriada";
  readonly tarefaId: string;
  readonly titulo: string;
}

export interface TarefaConcluida {
  readonly tipo: "TarefaConcluida";
  readonly tarefaId: string;
  readonly em: Date;
}

/**
 * Todos os fatos deste contexto. Quem reage a eles faz um `switch (evento.tipo)`
 * e o TypeScript confere se todos os casos foram tratados.
 */
export type EventoDeTarefa = TarefaCriada | TarefaConcluida;
// #endregion
