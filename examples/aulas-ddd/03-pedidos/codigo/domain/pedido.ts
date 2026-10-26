import type { PedidoConfirmado, PedidoRegistrado } from "./eventos";

// #region Pedido
/**
 * Aggregate root Pedido. Repare no `produtoId`: o Pedido aponta para o Estoque só pelo id
 * (references-by-id), nunca guarda o objeto Estoque. Cada aggregate é salvo sozinho,
 * e um não muda o outro na mesma transação.
 */
export class Pedido {
  private constructor(
    readonly id: string,
    readonly clienteId: string,
    readonly produtoId: string,
    readonly quantidade: number,
    private situacao: "registrado" | "confirmado",
  ) {}

  static registrar(
    id: string,
    clienteId: string,
    produtoId: string,
    quantidade: number,
  ): { pedido: Pedido; evento: PedidoRegistrado } {
    if (!Number.isInteger(quantidade) || quantidade < 1) {
      throw new Error("Um pedido tem ao menos uma unidade.");
    }
    const pedido = new Pedido(id, clienteId, produtoId, quantidade, "registrado");
    const evento: PedidoRegistrado = { tipo: "PedidoRegistrado", pedidoId: id, clienteId, produtoId, quantidade };
    return { pedido, evento };
  }

  get estado(): "registrado" | "confirmado" {
    return this.situacao;
  }

  /** Só confirma o que foi registrado e ainda não confirmado (vem depois da reserva do estoque). */
  confirmar(): PedidoConfirmado {
    if (this.situacao !== "registrado") throw new Error("Este pedido já foi confirmado.");
    this.situacao = "confirmado";
    return { tipo: "PedidoConfirmado", pedidoId: this.id };
  }
}
// #endregion
