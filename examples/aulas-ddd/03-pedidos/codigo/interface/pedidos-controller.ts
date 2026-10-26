import type { VendasHandlers } from "../application/handlers";
import type { LinhaDePedido, MeusPedidos } from "../application/meus-pedidos";

// #region controller
export interface Resposta<T> {
  status: number;
  corpo: T;
}

/**
 * Controller (Interface Adapters): recebe o pedido de fora (aqui, algo como HTTP),
 * confere o formato da entrada, transforma em command e despacha.
 * Para ler, consulta o read model. Nenhuma regra de negócio mora aqui.
 */
export class PedidosController {
  private seq = 0;

  constructor(
    private readonly handlers: VendasHandlers,
    private readonly meusPedidos: MeusPedidos,
  ) {}

  /** POST /pedidos */
  async post(corpo: unknown): Promise<Resposta<{ pedidoId: string } | { erro: string }>> {
    const c = (corpo ?? {}) as { clienteId?: unknown; produtoId?: unknown; quantidade?: unknown };
    const { clienteId, produtoId, quantidade } = c;
    if (typeof clienteId !== "string" || typeof produtoId !== "string" || typeof quantidade !== "number") {
      return { status: 400, corpo: { erro: "Informe clienteId, produtoId e quantidade." } };
    }
    const pedidoId = `p${++this.seq}`;
    try {
      await this.handlers.registrarPedido({ pedidoId, clienteId, produtoId, quantidade });
      return { status: 201, corpo: { pedidoId } };
    } catch (e) {
      return { status: 422, corpo: { erro: (e as Error).message } }; // uma regra do domínio recusou
    }
  }

  /** GET /clientes/:id/pedidos */
  get(clienteId: string): Resposta<LinhaDePedido[]> {
    return { status: 200, corpo: this.meusPedidos.doCliente(clienteId) };
  }
}
// #endregion
