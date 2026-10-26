// #region eventos
/**
 * Os fatos do carrinho. Levam ids e números, nunca objetos do domínio:
 * quem recebe não precisa conhecer as classes.
 */
export interface ItemAdicionado {
  readonly tipo: "ItemAdicionado";
  readonly carrinhoId: string;
  readonly produtoId: string;
  readonly quantidade: number;
}

export interface ItemRemovido {
  readonly tipo: "ItemRemovido";
  readonly carrinhoId: string;
  readonly produtoId: string;
}

export interface CarrinhoFechado {
  readonly tipo: "CarrinhoFechado";
  readonly carrinhoId: string;
  readonly totalEmCentavos: number;
}

export type EventoDoCarrinho = ItemAdicionado | ItemRemovido | CarrinhoFechado;
// #endregion
