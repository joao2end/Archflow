import type { EventoDeVendas } from "../domain/eventos";
import { Pedido } from "../domain/pedido";
import type { EstoqueRepository, PedidoRepository } from "../domain/repositories";
import type { ConfirmarPedido, RegistrarPedido, ReservarEstoque } from "./commands";

// #region handlers
/** Quem recebe os eventos que os handlers produzem (na borda, um barramento: ver infra/montar.ts). */
export type Publicar = (eventos: EventoDeVendas[]) => Promise<void>;

/** Um handler por command, e cada um mexe em um só aggregate: carregar, chamar, salvar, publicar. */
export class VendasHandlers {
  constructor(
    private readonly pedidos: PedidoRepository,
    private readonly estoques: EstoqueRepository,
    private readonly publicar: Publicar,
  ) {}

  async registrarPedido(cmd: RegistrarPedido): Promise<void> {
    const { pedido, evento } = Pedido.registrar(cmd.pedidoId, cmd.clienteId, cmd.produtoId, cmd.quantidade);
    await this.pedidos.salvar(pedido);
    await this.publicar([evento]);
  }

  async reservarEstoque(cmd: ReservarEstoque): Promise<void> {
    const estoque = await this.estoques.buscar(cmd.produtoId);
    if (!estoque) throw new Error(`Produto ${cmd.produtoId} sem estoque cadastrado.`);
    const evento = estoque.reservar(cmd.pedidoId, cmd.quantidade);
    await this.estoques.salvar(estoque);
    await this.publicar([evento]);
  }

  async confirmarPedido(cmd: ConfirmarPedido): Promise<void> {
    const pedido = await this.pedidos.buscar(cmd.pedidoId);
    if (!pedido) throw new Error(`Pedido ${cmd.pedidoId} não existe.`);
    const evento = pedido.confirmar();
    await this.pedidos.salvar(pedido);
    await this.publicar([evento]);
  }
}
// #endregion
