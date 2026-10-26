import type { EstoqueReservado } from "./eventos";

// #region Estoque
/** Aggregate root Estoque: um por produto (o id é o produtoId). A regra do saldo só existe aqui. */
export class Estoque {
  constructor(
    readonly produtoId: string,
    private saldo: number,
  ) {}

  get disponivel(): number {
    return this.saldo;
  }

  /** Invariante: o saldo nunca fica negativo. */
  reservar(pedidoId: string, quantidade: number): EstoqueReservado {
    if (quantidade > this.saldo) {
      throw new Error(`Saldo insuficiente de ${this.produtoId}: ${this.saldo} disponível(is).`);
    }
    this.saldo -= quantidade;
    return { tipo: "EstoqueReservado", produtoId: this.produtoId, pedidoId, quantidade };
  }
}
// #endregion
