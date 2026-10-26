import type { EventoDeVendas } from "../domain/eventos";

// #region readmodel
export interface LinhaDePedido {
  pedidoId: string;
  produtoId: string;
  quantidade: number;
  situacao: "aguardando estoque" | "confirmado";
}

/**
 * Read model (CQRS): uma tabela pronta para a tela «Meus pedidos», montada a partir dos eventos.
 * Ler não passa pelos aggregates: eles servem para mudar o estado com segurança,
 * e isto serve para consultar rápido.
 */
export class MeusPedidos {
  private readonly porCliente = new Map<string, LinhaDePedido[]>();
  private readonly donoDoPedido = new Map<string, string>();

  aplicar(e: EventoDeVendas): void {
    switch (e.tipo) {
      case "PedidoRegistrado": {
        const linha: LinhaDePedido = {
          pedidoId: e.pedidoId,
          produtoId: e.produtoId,
          quantidade: e.quantidade,
          situacao: "aguardando estoque",
        };
        this.donoDoPedido.set(e.pedidoId, e.clienteId);
        this.porCliente.set(e.clienteId, [...this.doCliente(e.clienteId), linha]);
        break;
      }
      case "PedidoConfirmado": {
        const cliente = this.donoDoPedido.get(e.pedidoId);
        if (!cliente) break;
        const linhas = this.doCliente(cliente).map((l) =>
          l.pedidoId === e.pedidoId ? { ...l, situacao: "confirmado" as const } : l,
        );
        this.porCliente.set(cliente, linhas);
        break;
      }
      case "EstoqueReservado":
        break; // não muda o que o cliente vê
    }
  }

  doCliente(clienteId: string): LinhaDePedido[] {
    return this.porCliente.get(clienteId) ?? [];
  }
}
// #endregion
