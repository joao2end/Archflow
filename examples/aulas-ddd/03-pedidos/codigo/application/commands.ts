// #region commands
export interface RegistrarPedido {
  readonly pedidoId: string;
  readonly clienteId: string;
  readonly produtoId: string;
  readonly quantidade: number;
}

export interface ReservarEstoque {
  readonly produtoId: string;
  readonly pedidoId: string;
  readonly quantidade: number;
}

export interface ConfirmarPedido {
  readonly pedidoId: string;
}
// #endregion
