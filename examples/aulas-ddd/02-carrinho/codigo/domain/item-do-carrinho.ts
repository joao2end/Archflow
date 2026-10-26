import type { Dinheiro } from "./dinheiro";

// #region ItemDoCarrinho
/**
 * Entity: tem identidade (o produto) dentro do carrinho. O item continua sendo o mesmo
 * quando a quantidade muda, e itens de produtos diferentes nunca são o mesmo item.
 * Só o Carrinho cria e altera itens: de fora do aggregate ninguém chega aqui.
 */
export class ItemDoCarrinho {
  constructor(
    readonly produtoId: string,
    readonly precoUnitario: Dinheiro,
    private qtd: number,
  ) {
    ItemDoCarrinho.conferir(qtd);
  }

  get quantidade(): number {
    return this.qtd;
  }

  get subtotal(): Dinheiro {
    return this.precoUnitario.vezes(this.qtd);
  }

  /** Chamado só pelo Carrinho (a raiz do aggregate). */
  mudarQuantidade(qtd: number): void {
    ItemDoCarrinho.conferir(qtd);
    this.qtd = qtd;
  }

  /** Invariante da entity: a quantidade fica entre 1 e 99. */
  private static conferir(qtd: number): void {
    if (!Number.isInteger(qtd) || qtd < 1 || qtd > 99) {
      throw new Error("A quantidade de um item fica entre 1 e 99.");
    }
  }
}
// #endregion
