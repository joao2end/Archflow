// #region Dinheiro
/**
 * Value object: dinheiro em centavos inteiros (nada de 0,1 + 0,2 = 0,30000000000000004).
 * Imutável: somar ou multiplicar devolve outro Dinheiro e deixa este como estava.
 */
export class Dinheiro {
  private constructor(readonly centavos: number) {}

  static readonly zero = new Dinheiro(0);

  static centavos(valor: number): Dinheiro {
    if (!Number.isInteger(valor) || valor < 0) {
      throw new Error("Dinheiro é um número inteiro de centavos, nunca negativo.");
    }
    return new Dinheiro(valor);
  }

  somar(outro: Dinheiro): Dinheiro {
    return new Dinheiro(this.centavos + outro.centavos);
  }

  vezes(quantidade: number): Dinheiro {
    return Dinheiro.centavos(this.centavos * quantidade);
  }

  toString(): string {
    return `R$ ${(this.centavos / 100).toFixed(2).replace(".", ",")}`;
  }
}
// #endregion
