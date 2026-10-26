# Aula 3 · Pedido e estoque

> Gerado a partir de `src/shared/lessons.ts` (`npm run examples:build`). Não edite à mão: o código em [`codigo/`](codigo/) é a fonte, este texto só o cita.

Dois aggregates que não se tocam: o Pedido anuncia, uma policy reage e o Estoque reserva. Com controller na entrada e read model para a consulta.

**Você vai ver:** dois aggregates, um por transação · referência por id · policy (evento → command) · controller · read model (CQRS).

## Como acompanhar

- **No app:** explorador → *Exemplos* → *Domínio* → «Aula 3 · Pedido e estoque» → *Instalar e abrir*. O diagrama abre na visão 3D com o painel da aula: cada passo acende as peças do diagrama e mostra o código delas.
- **Fora do app:** o diagrama é [`../aula-3-pedido-e-estoque.archflow.json`](../aula-3-pedido-e-estoque.archflow.json) e o código está em [`codigo/`](codigo/). Para rodar: `npx tsx examples/aulas-ddd/03-pedidos/codigo/exemplo.ts`.

## Passo a passo

### 1. Controller: a porta de entrada

O **controller** recebe o pedido de fora (HTTP, tela, fila), confere o **formato** da entrada e despacha o command. Para ler, consulta o read model. Ele está no anel de *Interface Adapters* (setor *Controllers*): um degrau abaixo dos casos de uso.

Repare na diferença entre os erros: **400** é entrada malformada (barrada aqui); **422** é uma regra do domínio que recusou (vem lá de dentro).

**Peças destacadas:** Controller de pedidos.

[`codigo/interface/pedidos-controller.ts`](codigo/interface/pedidos-controller.ts)

```ts
export interface Resposta<T> {
  status: number;
  corpo: T;
}

/**
 * Controller (Interface Adapters): recebe o pedido de fora (aqui, algo como HTTP),
 * confere o formato da entrada, transforma em command e despacha.
 * Para ler, consulta o read model. Nenhuma regra de negócio mora aqui.
 */
export class PedidosController {
  private seq = 0;

  constructor(
    private readonly handlers: VendasHandlers,
    private readonly meusPedidos: MeusPedidos,
  ) {}

  /** POST /pedidos */
  async post(corpo: unknown): Promise<Resposta<{ pedidoId: string } | { erro: string }>> {
    const c = (corpo ?? {}) as { clienteId?: unknown; produtoId?: unknown; quantidade?: unknown };
    const { clienteId, produtoId, quantidade } = c;
    if (typeof clienteId !== "string" || typeof produtoId !== "string" || typeof quantidade !== "number") {
      return { status: 400, corpo: { erro: "Informe clienteId, produtoId e quantidade." } };
    }
    const pedidoId = `p${++this.seq}`;
    try {
      await this.handlers.registrarPedido({ pedidoId, clienteId, produtoId, quantidade });
      return { status: 201, corpo: { pedidoId } };
    } catch (e) {
      return { status: 422, corpo: { erro: (e as Error).message } }; // uma regra do domínio recusou
    }
  }

  /** GET /clientes/:id/pedidos */
  get(clienteId: string): Resposta<LinhaDePedido[]> {
    return { status: 200, corpo: this.meusPedidos.doCliente(clienteId) };
  }
}
```

### 2. Pedido: o primeiro aggregate

O **Pedido** guarda `produtoId`, não o objeto Estoque. É a **referência por id** (a seta azul *referencia (id)* no diagrama): cada aggregate é salvo sozinho, e um não muda o outro na mesma transação.

Se o Pedido guardasse o Estoque, salvar um pedido poderia alterar o saldo sem passar pelas regras do Estoque.

**Peças destacadas:** Pedido, Estoque.

[`codigo/domain/pedido.ts`](codigo/domain/pedido.ts)

```ts
/**
 * Aggregate root Pedido. Repare no `produtoId`: o Pedido aponta para o Estoque só pelo id
 * (references-by-id), nunca guarda o objeto Estoque. Cada aggregate é salvo sozinho,
 * e um não muda o outro na mesma transação.
 */
export class Pedido {
  private constructor(
    readonly id: string,
    readonly clienteId: string,
    readonly produtoId: string,
    readonly quantidade: number,
    private situacao: "registrado" | "confirmado",
  ) {}

  static registrar(
    id: string,
    clienteId: string,
    produtoId: string,
    quantidade: number,
  ): { pedido: Pedido; evento: PedidoRegistrado } {
    if (!Number.isInteger(quantidade) || quantidade < 1) {
      throw new Error("Um pedido tem ao menos uma unidade.");
    }
    const pedido = new Pedido(id, clienteId, produtoId, quantidade, "registrado");
    const evento: PedidoRegistrado = { tipo: "PedidoRegistrado", pedidoId: id, clienteId, produtoId, quantidade };
    return { pedido, evento };
  }

  get estado(): "registrado" | "confirmado" {
    return this.situacao;
  }

  /** Só confirma o que foi registrado e ainda não confirmado (vem depois da reserva do estoque). */
  confirmar(): PedidoConfirmado {
    if (this.situacao !== "registrado") throw new Error("Este pedido já foi confirmado.");
    this.situacao = "confirmado";
    return { tipo: "PedidoConfirmado", pedidoId: this.id };
  }
}
```

### 3. Estoque: o segundo aggregate

O **Estoque** tem a própria regra (*o saldo nunca fica negativo*) e o próprio repository. Ele não sabe que pedidos existem: só sabe reservar.

**Peças destacadas:** Estoque.

[`codigo/domain/estoque.ts`](codigo/domain/estoque.ts)

```ts
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
```

### 4. Eventos ligam os aggregates

Em vez de o Pedido chamar o Estoque, ele **anuncia**: *Pedido registrado*. Quem tiver interesse reage. É assim que dois aggregates conversam sem se acoplar.

**Peças destacadas:** Pedido registrado, Estoque reservado, Pedido confirmado.

[`codigo/domain/eventos.ts`](codigo/domain/eventos.ts)

```ts
/** Os fatos que ligam os dois aggregates: o Pedido não chama o Estoque, ele anuncia o que aconteceu. */
export interface PedidoRegistrado {
  readonly tipo: "PedidoRegistrado";
  readonly pedidoId: string;
  readonly clienteId: string;
  readonly produtoId: string;
  readonly quantidade: number;
}

export interface EstoqueReservado {
  readonly tipo: "EstoqueReservado";
  readonly produtoId: string;
  readonly pedidoId: string;
  readonly quantidade: number;
}

export interface PedidoConfirmado {
  readonly tipo: "PedidoConfirmado";
  readonly pedidoId: string;
}

export type EventoDeVendas = PedidoRegistrado | EstoqueReservado | PedidoConfirmado;
```

### 5. Policy: quando X, faça Y

Uma **policy** reage a um evento e emite o próximo command: *ao registrar, reservar estoque*; *ao reservar, confirmar pedido*. Sem estado e sem regra de negócio: é uma função de evento para command.

Siga as setas laranja no diagrama: evento → policy → command → aggregate → evento… é a corrente inteira do caso de uso.

**Peças destacadas:** Pedido registrado, Ao registrar, reservar estoque, Reservar estoque, Estoque reservado, Ao reservar, confirmar pedido, Confirmar pedido.

[`codigo/application/policies.ts`](codigo/application/policies.ts)

```ts
/**
 * Policies: «quando acontecer X, faça Y». Recebem um evento e devolvem o próximo command.
 * Não guardam estado e não têm regra de negócio: a regra continua dentro dos aggregates.
 */
export function reservarAoRegistrar(e: PedidoRegistrado): ReservarEstoque {
  return { produtoId: e.produtoId, pedidoId: e.pedidoId, quantidade: e.quantidade };
}

export function confirmarAoReservar(e: EstoqueReservado): ConfirmarPedido {
  return { pedidoId: e.pedidoId };
}
```

### 6. Handlers: um aggregate por vez

Cada handler mexe em **um só aggregate**: carrega, chama, salva e publica. O `registrarPedido` não reserva estoque; ele só publica o evento, e a policy faz o resto.

**Peças destacadas:** Registrar pedido, Reservar estoque, Confirmar pedido, Repositório de pedidos, Repositório de estoques.

[`codigo/application/handlers.ts`](codigo/application/handlers.ts)

```ts
/** Quem recebe os eventos que os handlers produzem (na borda, um barramento: ver infra/montar.ts). */
export type Publicar = (eventos: EventoDeVendas[]) => Promise<void>;

/** Um handler por command, e cada um mexe em um só aggregate: carregar, chamar, salvar, publicar. */
export class VendasHandlers {
  constructor(
    private readonly pedidos: PedidoRepository,
    private readonly estoques: EstoqueRepository,
    private readonly publicar: Publicar,
  ) {}

  async registrarPedido(cmd: RegistrarPedido): Promise<void> {
    const { pedido, evento } = Pedido.registrar(cmd.pedidoId, cmd.clienteId, cmd.produtoId, cmd.quantidade);
    await this.pedidos.salvar(pedido);
    await this.publicar([evento]);
  }

  async reservarEstoque(cmd: ReservarEstoque): Promise<void> {
    const estoque = await this.estoques.buscar(cmd.produtoId);
    if (!estoque) throw new Error(`Produto ${cmd.produtoId} sem estoque cadastrado.`);
    const evento = estoque.reservar(cmd.pedidoId, cmd.quantidade);
    await this.estoques.salvar(estoque);
    await this.publicar([evento]);
  }

  async confirmarPedido(cmd: ConfirmarPedido): Promise<void> {
    const pedido = await this.pedidos.buscar(cmd.pedidoId);
    if (!pedido) throw new Error(`Pedido ${cmd.pedidoId} não existe.`);
    const evento = pedido.confirmar();
    await this.pedidos.salvar(pedido);
    await this.publicar([evento]);
  }
}
```

### 7. Read model: a tela «Meus pedidos»

Para **ler** não se passa pelos aggregates. O **read model** é uma tabela pronta para a tela, alimentada pelos eventos (CQRS: um lado para mudar, outro para consultar).

No diagrama: o cartão **READ** no setor *Presenters*, recebendo *Pedido registrado* e *Pedido confirmado*, e o controller o usando no GET.

**Peças destacadas:** Meus pedidos, Pedido registrado, Pedido confirmado, Controller de pedidos.

[`codigo/application/meus-pedidos.ts`](codigo/application/meus-pedidos.ts)

```ts
export interface LinhaDePedido {
  pedidoId: string;
  produtoId: string;
  quantidade: number;
  situacao: "aguardando estoque" | "confirmado";
}

/**
 * Read model (CQRS): uma tabela pronta para a tela «Meus pedidos», montada a partir dos eventos.
 * Ler não passa pelos aggregates: eles servem para mudar o estado com segurança,
 * e isto serve para consultar rápido.
 */
export class MeusPedidos {
  private readonly porCliente = new Map<string, LinhaDePedido[]>();
  private readonly donoDoPedido = new Map<string, string>();

  aplicar(e: EventoDeVendas): void {
    switch (e.tipo) {
      case "PedidoRegistrado": {
        const linha: LinhaDePedido = {
          pedidoId: e.pedidoId,
          produtoId: e.produtoId,
          quantidade: e.quantidade,
          situacao: "aguardando estoque",
        };
        this.donoDoPedido.set(e.pedidoId, e.clienteId);
        this.porCliente.set(e.clienteId, [...this.doCliente(e.clienteId), linha]);
        break;
      }
      case "PedidoConfirmado": {
        const cliente = this.donoDoPedido.get(e.pedidoId);
        if (!cliente) break;
        const linhas = this.doCliente(cliente).map((l) =>
          l.pedidoId === e.pedidoId ? { ...l, situacao: "confirmado" as const } : l,
        );
        this.porCliente.set(cliente, linhas);
        break;
      }
      case "EstoqueReservado":
        break; // não muda o que o cliente vê
    }
  }

  doCliente(clienteId: string): LinhaDePedido[] {
    return this.porCliente.get(clienteId) ?? [];
  }
}
```

### 8. A borda: montar as peças

Na camada de fora (*Frameworks & Drivers*) escolhem-se as implementações e liga-se tudo: os repositories em memória e um barramento que entrega cada evento ao read model e à policy certa.

É o único lugar que conhece todo mundo, e por isso o único que precisa mudar ao trocar de tecnologia.

**Peças destacadas:** Repositório de pedidos, Repositório de estoques, Ao registrar, reservar estoque, Ao reservar, confirmar pedido, Meus pedidos.

[`codigo/infra/montar.ts`](codigo/infra/montar.ts)

```ts
class PedidosEmMemoria implements PedidoRepository {
  private readonly dados = new Map<string, Pedido>();
  async buscar(id: string) {
    return this.dados.get(id);
  }
  async salvar(p: Pedido) {
    this.dados.set(p.id, p);
  }
}

class EstoquesEmMemoria implements EstoqueRepository {
  private readonly dados = new Map<string, Estoque>();
  async buscar(produtoId: string) {
    return this.dados.get(produtoId);
  }
  async salvar(e: Estoque) {
    this.dados.set(e.produtoId, e);
  }
}

/**
 * A borda de tudo (Frameworks & Drivers): escolhe as implementações e liga as peças.
 * O barramento entrega cada evento ao read model e à policy que reage a ele;
 * a policy devolve o command seguinte, que vai para o handler.
 */
export async function montar(saldoInicial: Record<string, number>) {
  const pedidos = new PedidosEmMemoria();
  const estoques = new EstoquesEmMemoria();
  for (const [produtoId, saldo] of Object.entries(saldoInicial)) {
    await estoques.salvar(new Estoque(produtoId, saldo));
  }

  const meusPedidos = new MeusPedidos();
  const publicar = async (eventos: EventoDeVendas[]): Promise<void> => {
    for (const e of eventos) {
      meusPedidos.aplicar(e);
      if (e.tipo === "PedidoRegistrado") await handlers.reservarEstoque(reservarAoRegistrar(e));
      if (e.tipo === "EstoqueReservado") await handlers.confirmarPedido(confirmarAoReservar(e));
    }
  };
  const handlers = new VendasHandlers(pedidos, estoques, publicar);
  return { controller: new PedidosController(handlers, meusPedidos), estoques };
}
```

### 9. O caso de uso de ponta a ponta

Rode `npx tsx exemplo.ts`: o primeiro pedido percorre a corrente inteira e chega a *confirmado*; o segundo pede mais do que há e o Estoque recusa (422); o terceiro chega incompleto e o controller barra (400).

Na apresentação (botão **Apresentar**), o passo a passo do caso de uso *Fazer pedido* anda pela mesma corrente, peça por peça.

**Peças destacadas:** Cliente, Fazer pedido, Controller de pedidos, Registrar pedido, Pedido, Pedido confirmado.

[`codigo/exemplo.ts`](codigo/exemplo.ts)

```ts
/**
 * O caso de uso «Fazer pedido», de ponta a ponta:
 * controller → command → Pedido → evento → policy → Estoque → evento → policy → Pedido.
 */
async function main(): Promise<void> {
  const { controller } = await montar({ caneca: 3 });

  console.log(await controller.post({ clienteId: "ana", produtoId: "caneca", quantidade: 2 }));
  // { status: 201, corpo: { pedidoId: 'p1' } }
  console.log(controller.get("ana").corpo);
  // [ { pedidoId: 'p1', produtoId: 'caneca', quantidade: 2, situacao: 'confirmado' } ]

  console.log(await controller.post({ clienteId: "ana", produtoId: "caneca", quantidade: 5 }));
  // 422: saldo insuficiente (o Estoque recusou)
  console.log(await controller.post({ clienteId: "ana" }));
  // 400: entrada incompleta (barrada no controller)
}

void main();
```

## Para praticar

- Quando falta estoque, o pedido fica «aguardando» para sempre. Modele o evento «Estoque insuficiente» e uma policy que cancela o pedido (command «Cancelar pedido»).
- Troque o pedido de um produto por vários itens: quantos `Reservar estoque` passam a existir, e quem espera todos? (dica: process-manager)
