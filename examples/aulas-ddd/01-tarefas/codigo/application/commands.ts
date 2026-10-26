// #region commands
/**
 * Commands: a intenção de quem usa o sistema, no imperativo.
 * Carregam só o que foi pedido e podem ser recusados.
 */
export interface CriarTarefa {
  readonly titulo: string;
}

export interface ConcluirTarefa {
  readonly tarefaId: string;
}
// #endregion
