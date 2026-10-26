// #region Titulo
/**
 * Value object: um valor sem identidade. Dois títulos com o mesmo texto são o mesmo título,
 * e um título nunca muda (para "mudar", cria-se outro).
 */
export class Titulo {
  private constructor(readonly texto: string) {}

  /** A única porta de entrada: a invariante é conferida aqui, uma vez, e nunca mais. */
  static de(texto: string): Titulo {
    const limpo = texto.trim();
    if (limpo.length < 1 || limpo.length > 80) {
      throw new Error("O título precisa ter de 1 a 80 caracteres.");
    }
    return new Titulo(limpo);
  }

  /** Compara pelo conteúdo, não pela referência. */
  igual(outro: Titulo): boolean {
    return this.texto === outro.texto;
  }
}
// #endregion
