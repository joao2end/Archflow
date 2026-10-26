# Aula 2 · Carrinho de compras

> Gerado a partir de `src/shared/lessons.ts` (`npm run examples:build`). Não edite à mão: o código em [`codigo/`](codigo/) é a fonte, este texto só o cita.

Um aggregate com partes: entity dentro do aggregate, invariantes que só a raiz garante e o repository que guarda o conjunto.

**Você vai ver:** entity × value object · fronteira do aggregate · invariante do conjunto · repository (interface no domínio) · handler: carregar, chamar, salvar.

## Como acompanhar

- **No app:** explorador → *Exemplos* → *Domínio* → «Aula 2 · Carrinho de compras» → *Instalar e abrir*. O diagrama abre na visão 3D com o painel da aula: cada passo acende as peças do diagrama e mostra o código delas.
- **Fora do app:** o diagrama é [`../aula-2-carrinho-de-compras.archflow.json`](../aula-2-carrinho-de-compras.archflow.json) e o código está em [`codigo/`](codigo/). Para rodar: `npx tsx examples/aulas-ddd/02-carrinho/codigo/exemplo.ts`.

## Passo a passo

### 1. Dinheiro: outro value object

Começamos pelo menor pedaço. **Dinheiro** guarda centavos inteiros (nada de `0.1 + 0.2`) e é imutável: `somar` devolve outro Dinheiro.

Value objects tiram regras repetidas do resto do código: ninguém mais precisa lembrar de arredondar ou de proibir valor negativo.

**Peças destacadas:** Dinheiro.

[`codigo/domain/dinheiro.ts`](codigo/domain/dinheiro.ts)

```ts
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
```

### 2. Entity: Item do carrinho

O **Item do carrinho** é uma **entity**: tem identidade (o produto) e muda com o tempo (a quantidade). Compare com o Dinheiro: dois Dinheiros iguais são intercambiáveis, dois itens não.

A diferença para a Tarefa da aula 1: este item **não é raiz**. Ele vive dentro do Carrinho e só o Carrinho o cria e altera. No diagrama, a seta *contém* vem do Carrinho até ele.

**Peças destacadas:** Item do carrinho, Dinheiro.

[`codigo/domain/item-do-carrinho.ts`](codigo/domain/item-do-carrinho.ts)

```ts
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
```

### 3. Aggregate Root: Carrinho

*No máximo 10 produtos diferentes* é uma regra sobre o **conjunto** dos itens: nenhum item sozinho consegue garanti-la. Por isso o **Carrinho** é a raiz do aggregate: tudo passa por ele, e ele vê o conjunto inteiro.

Repare que `linhas` devolve uma **cópia**: de fora só se lê. Esse é o desenho da fronteira do aggregate, e no diagrama ela aparece como as setas *contém* (Carrinho → Item → Dinheiro).

**Peças destacadas:** Carrinho, Item do carrinho, Dinheiro.

[`codigo/domain/carrinho.ts`](codigo/domain/carrinho.ts)

```ts
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
```

### 4. Eventos do carrinho

Os eventos levam **ids e números**, nunca objetos do domínio: quem recebe *Carrinho fechado* (o faturamento, por exemplo) não precisa conhecer a classe `Carrinho`.

**Peças destacadas:** Item adicionado, Item removido, Carrinho fechado.

[`codigo/domain/eventos.ts`](codigo/domain/eventos.ts)

```ts
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
```

### 5. Repository: a coleção de carrinhos

O **repository** é a coleção dos aggregates, vista pelo domínio: `buscar` e `salvar`, e só. Há **um por aggregate root**, e ele guarda o aggregate inteiro (nunca um item solto).

A interface mora no **domínio**; a implementação fica do lado de fora (`infra/`). No diagrama, o cartão **REPO** fica no anel de *Interface Adapters* (setor *Gateways*), e os commands o **usam**.

**Peças destacadas:** Repositório de carrinhos, Carrinho.

[`codigo/domain/carrinho-repository.ts`](codigo/domain/carrinho-repository.ts)

```ts
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
```

### 6. Implementação: memória hoje, banco amanhã

Esta classe implementa a interface com um `Map`. Trocá-la por um banco de dados não muda **nenhuma linha** do domínio: é a regra de dependência funcionando (o de fora conhece o de dentro, nunca o contrário).

**Peças destacadas:** Repositório de carrinhos.

[`codigo/infra/carrinhos-em-memoria.ts`](codigo/infra/carrinhos-em-memoria.ts)

```ts
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
```

### 7. Handlers: carregar, chamar, salvar

Agora o handler tem um roteiro fixo: **carregar** o aggregate pelo repository, **chamar** um método dele, **salvar** e devolver os eventos. Ele recebe a *interface* do repository no construtor.

No diagrama, cada command tem três setas: *dispara* o Carrinho, *emite* o evento e *usa* o repositório.

**Peças destacadas:** Adicionar item, Remover item, Fechar carrinho, Repositório de carrinhos, Carrinho.

[`codigo/application/handlers.ts`](codigo/application/handlers.ts)

```ts
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
```

### 8. O caso de uso rodando

O exemplo escolhe a implementação do repository **na borda** e a entrega aos handlers. Depois monta o carrinho, fecha e tenta mexer de novo: a invariante *um carrinho fechado não muda mais* recusa.

Rode: `npx tsx exemplo.ts`.

**Peças destacadas:** Cliente, Montar o carrinho, Adicionar item, Remover item, Fechar carrinho.

[`codigo/exemplo.ts`](codigo/exemplo.ts)

```ts
/**
 * O caso de uso «Montar o carrinho». A implementação do repository é escolhida aqui,
 * na borda, e entregue aos handlers.
 */
async function main(): Promise<void> {
  const handlers = new CarrinhoHandlers(new CarrinhosEmMemoria());
  const c1 = "c1";

  await handlers.adicionarItem({ carrinhoId: c1, produtoId: "caneca", precoEmCentavos: 3990, quantidade: 2 });
  await handlers.adicionarItem({ carrinhoId: c1, produtoId: "camiseta", precoEmCentavos: 5990, quantidade: 1 });
  await handlers.removerItem({ carrinhoId: c1, produtoId: "camiseta" });

  const [fechado] = await handlers.fecharCarrinho({ carrinhoId: c1 });
  console.log(fechado); // { tipo: 'CarrinhoFechado', carrinhoId: 'c1', totalEmCentavos: 7980 }

  try {
    await handlers.adicionarItem({ carrinhoId: c1, produtoId: "boné", precoEmCentavos: 2500, quantidade: 1 });
  } catch (e) {
    console.log("recusado:", (e as Error).message); // O carrinho já foi fechado.
  }
}

void main();
```

## Para praticar

- Adicione um value object «Cupom» (código e percentual de 1 a 50) e o command «Aplicar cupom»: onde fica a regra «um cupom por carrinho»?
- Escreva um `CarrinhoRepository` que grava em arquivo JSON e troque no exemplo sem mexer em `domain/`.

Próxima: [Aula 3 · Pedido e estoque](../03-pedidos/README.md).
