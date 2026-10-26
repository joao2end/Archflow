import type { Carrinho } from "../domain/carrinho";
import type { CarrinhoRepository } from "../domain/carrinho-repository";

// #region memoria
/**
 * Uma implementação do repository (camada de fora).
 * Trocar por um banco não muda uma linha do domínio.
 */
export class CarrinhosEmMemoria implements CarrinhoRepository {
  private readonly dados = new Map<string, Carrinho>();

  async buscar(id: string): Promise<Carrinho | undefined> {
    return this.dados.get(id);
  }

  async salvar(carrinho: Carrinho): Promise<void> {
    this.dados.set(carrinho.id, carrinho);
  }
}
// #endregion
