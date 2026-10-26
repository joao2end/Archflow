import { VendasHandlers } from "../application/handlers";
import { MeusPedidos } from "../application/meus-pedidos";
import { confirmarAoReservar, reservarAoRegistrar } from "../application/policies";
import type { EventoDeVendas } from "../domain/eventos";
import { Estoque } from "../domain/estoque";
import type { Pedido } from "../domain/pedido";
import type { EstoqueRepository, PedidoRepository } from "../domain/repositories";
import { PedidosController } from "../interface/pedidos-controller";

// #region montar
class PedidosEmMemoria implements PedidoRepository {
  private readonly dados = new Map<string, Pedido>();
  async buscar(id: string) {
    return this.dados.get(id);
  }
  async salvar(p: Pedido) {
    this.dados.set(p.id, p);
  }
}

class EstoquesEmMemoria implements EstoqueRepository {
  private readonly dados = new Map<string, Estoque>();
  async buscar(produtoId: string) {
    return this.dados.get(produtoId);
  }
  async salvar(e: Estoque) {
    this.dados.set(e.produtoId, e);
  }
}

/**
 * A borda de tudo (Frameworks & Drivers): escolhe as implementações e liga as peças.
 * O barramento entrega cada evento ao read model e à policy que reage a ele;
 * a policy devolve o command seguinte, que vai para o handler.
 */
export async function montar(saldoInicial: Record<string, number>) {
  const pedidos = new PedidosEmMemoria();
  const estoques = new EstoquesEmMemoria();
  for (const [produtoId, saldo] of Object.entries(saldoInicial)) {
    await estoques.salvar(new Estoque(produtoId, saldo));
  }

  const meusPedidos = new MeusPedidos();
  const publicar = async (eventos: EventoDeVendas[]): Promise<void> => {
    for (const e of eventos) {
      meusPedidos.aplicar(e);
      if (e.tipo === "PedidoRegistrado") await handlers.reservarEstoque(reservarAoRegistrar(e));
      if (e.tipo === "EstoqueReservado") await handlers.confirmarPedido(confirmarAoReservar(e));
    }
  };
  const handlers = new VendasHandlers(pedidos, estoques, publicar);
  return { controller: new PedidosController(handlers, meusPedidos), estoques };
}
// #endregion
