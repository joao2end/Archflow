import { Dinheiro } from "./dinheiro";
import type { CarrinhoFechado, ItemAdicionado, ItemRemovido } from "./eventos";
import { ItemDoCarrinho } from "./item-do-carrinho";

// #region Carrinho
/**
 * Aggregate root: o Carrinho é a única porta para os itens. As regras sobre o conjunto
 * (limite de produtos, carrinho fechado não muda) só podem ser garantidas aqui,
 * porque só aqui se vê tudo.
 */
export class Carrinho {
  static readonly MAX_PRODUTOS = 10;
  private readonly itens = new Map<string, ItemDoCarrinho>();
  private fechado = false;

  constructor(readonly id: string) {}

  adicionar(produtoId: string, preco: Dinheiro, quantidade: number): ItemAdicionado {
    this.exigirAberto();
    const atual = this.itens.get(produtoId);
    if (atual) atual.mudarQuantidade(atual.quantidade + quantidade);
    else {
      if (this.itens.size >= Carrinho.MAX_PRODUTOS) {
        throw new Error(`O carrinho aceita no máximo ${Carrinho.MAX_PRODUTOS} produtos diferentes.`);
      }
      this.itens.set(produtoId, new ItemDoCarrinho(produtoId, preco, quantidade));
    }
    return { tipo: "ItemAdicionado", carrinhoId: this.id, produtoId, quantidade };
  }

  remover(produtoId: string): ItemRemovido {
    this.exigirAberto();
    if (!this.itens.delete(produtoId)) throw new Error("Este produto não está no carrinho.");
    return { tipo: "ItemRemovido", carrinhoId: this.id, produtoId };
  }

  fechar(): CarrinhoFechado {
    this.exigirAberto();
    if (!this.itens.size) throw new Error("Não dá para fechar um carrinho vazio.");
    this.fechado = true;
    return { tipo: "CarrinhoFechado", carrinhoId: this.id, totalEmCentavos: this.total.centavos };
  }

  get total(): Dinheiro {
    let total = Dinheiro.zero;
    for (const item of this.itens.values()) total = total.somar(item.subtotal);
    return total;
  }

  /** De fora só se lê, e uma cópia: ninguém mexe num item sem passar pelo Carrinho. */
  get linhas(): readonly { produtoId: string; quantidade: number; subtotal: Dinheiro }[] {
    return [...this.itens.values()].map((i) => ({
      produtoId: i.produtoId,
      quantidade: i.quantidade,
      subtotal: i.subtotal,
    }));
  }

  private exigirAberto(): void {
    if (this.fechado) throw new Error("O carrinho já foi fechado.");
  }
}
// #endregion
