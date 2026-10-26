import type { Estoque } from "./estoque";
import type { Pedido } from "./pedido";

// #region repositories
/** Um repository por aggregate root: cada um carrega e salva o seu aggregate inteiro. */
export interface PedidoRepository {
  buscar(id: string): Promise<Pedido | undefined>;
  salvar(pedido: Pedido): Promise<void>;
}

export interface EstoqueRepository {
  buscar(produtoId: string): Promise<Estoque | undefined>;
  salvar(estoque: Estoque): Promise<void>;
}
// #endregion
