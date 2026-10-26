// #region commands
/**
 * Os pedidos do Cliente. Chegam com tipos simples (texto, número):
 * é o handler que os transforma em objetos do domínio.
 */
export interface AdicionarItem {
  readonly carrinhoId: string;
  readonly produtoId: string;
  readonly precoEmCentavos: number;
  readonly quantidade: number;
}

export interface RemoverItem {
  readonly carrinhoId: string;
  readonly produtoId: string;
}

export interface FecharCarrinho {
  readonly carrinhoId: string;
}
// #endregion
