import type { Carrinho } from "./carrinho";

// #region repository
/**
 * Repository: a coleção de carrinhos, do jeito que o domínio a enxerga.
 * É só uma interface, e mora no domínio: o domínio diz o que precisa,
 * e quem implementa (memória, SQL, API) fica do lado de fora.
 * Há um repository por aggregate root, e ele guarda o aggregate inteiro (nunca um item solto).
 */
export interface CarrinhoRepository {
  buscar(id: string): Promise<Carrinho | undefined>;
  salvar(carrinho: Carrinho): Promise<void>;
}
// #endregion
