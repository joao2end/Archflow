import { Carrinho } from "../domain/carrinho";
import type { CarrinhoRepository } from "../domain/carrinho-repository";
import { Dinheiro } from "../domain/dinheiro";
import type { EventoDoCarrinho } from "../domain/eventos";
import type { AdicionarItem, FecharCarrinho, RemoverItem } from "./commands";

// #region handlers
/**
 * Todo handler segue o mesmo roteiro: carregar o aggregate pelo repository, chamar um método dele,
 * salvar e devolver os eventos. O handler recebe a interface do repository, não a implementação.
 */
export class CarrinhoHandlers {
  constructor(private readonly carrinhos: CarrinhoRepository) {}

  async adicionarItem(cmd: AdicionarItem): Promise<EventoDoCarrinho[]> {
    const carrinho = (await this.carrinhos.buscar(cmd.carrinhoId)) ?? new Carrinho(cmd.carrinhoId);
    const evento = carrinho.adicionar(cmd.produtoId, Dinheiro.centavos(cmd.precoEmCentavos), cmd.quantidade);
    await this.carrinhos.salvar(carrinho);
    return [evento];
  }

  async removerItem(cmd: RemoverItem): Promise<EventoDoCarrinho[]> {
    const carrinho = await this.carregar(cmd.carrinhoId);
    const evento = carrinho.remover(cmd.produtoId);
    await this.carrinhos.salvar(carrinho);
    return [evento];
  }

  async fecharCarrinho(cmd: FecharCarrinho): Promise<EventoDoCarrinho[]> {
    const carrinho = await this.carregar(cmd.carrinhoId);
    const evento = carrinho.fechar();
    await this.carrinhos.salvar(carrinho);
    return [evento];
  }

  private async carregar(id: string): Promise<Carrinho> {
    const carrinho = await this.carrinhos.buscar(id);
    if (!carrinho) throw new Error(`O carrinho ${id} não existe.`);
    return carrinho;
  }
}
// #endregion
