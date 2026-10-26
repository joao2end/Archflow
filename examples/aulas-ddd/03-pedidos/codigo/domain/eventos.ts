// #region eventos
/** Os fatos que ligam os dois aggregates: o Pedido não chama o Estoque, ele anuncia o que aconteceu. */
export interface PedidoRegistrado {
  readonly tipo: "PedidoRegistrado";
  readonly pedidoId: string;
  readonly clienteId: string;
  readonly produtoId: string;
  readonly quantidade: number;
}

export interface EstoqueReservado {
  readonly tipo: "EstoqueReservado";
  readonly produtoId: string;
  readonly pedidoId: string;
  readonly quantidade: number;
}

export interface PedidoConfirmado {
  readonly tipo: "PedidoConfirmado";
  readonly pedidoId: string;
}

export type EventoDeVendas = PedidoRegistrado | EstoqueReservado | PedidoConfirmado;
// #endregion
