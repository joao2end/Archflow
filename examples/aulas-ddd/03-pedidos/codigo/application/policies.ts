import type { EstoqueReservado, PedidoRegistrado } from "../domain/eventos";
import type { ConfirmarPedido, ReservarEstoque } from "./commands";

// #region policies
/**
 * Policies: «quando acontecer X, faça Y». Recebem um evento e devolvem o próximo command.
 * Não guardam estado e não têm regra de negócio: a regra continua dentro dos aggregates.
 */
export function reservarAoRegistrar(e: PedidoRegistrado): ReservarEstoque {
  return { produtoId: e.produtoId, pedidoId: e.pedidoId, quantidade: e.quantidade };
}

export function confirmarAoReservar(e: EstoqueReservado): ConfirmarPedido {
  return { pedidoId: e.pedidoId };
}
// #endregion
