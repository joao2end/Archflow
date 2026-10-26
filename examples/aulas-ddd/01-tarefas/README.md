# Aula 1 · Lista de tarefas

> Gerado a partir de `src/shared/lessons.ts` (`npm run examples:build`). Não edite à mão: o código em [`codigo/`](codigo/) é a fonte, este texto só o cita.

O mínimo do DDD: um value object, um aggregate root, dois commands e os eventos que eles produzem.

**Você vai ver:** bounded context · value object · aggregate root e invariante · command → evento · caso de uso.

## Como acompanhar

- **No app:** explorador → *Exemplos* → *Domínio* → «Aula 1 · Lista de tarefas» → *Instalar e abrir*. O diagrama abre na visão 3D com o painel da aula: cada passo acende as peças do diagrama e mostra o código delas.
- **Fora do app:** o diagrama é [`../aula-1-lista-de-tarefas.archflow.json`](../aula-1-lista-de-tarefas.archflow.json) e o código está em [`codigo/`](codigo/). Para rodar: `npx tsx examples/aulas-ddd/01-tarefas/codigo/exemplo.ts`.

## Passo a passo

### 1. O contexto: onde as palavras têm um só sentido

Todo modelo de DDD vive dentro de um **bounded context**: a fronteira onde cada palavra tem um significado só. Aqui, *Tarefa* é algo a fazer com um título, e nada mais.

No diagrama o contexto é o círculo inteiro. As camadas vão **de dentro para fora**, como na Clean Architecture: no miolo ficam as regras de negócio (*Entities*), em volta os casos de uso (*Use Cases*) e por fora quem usa o sistema. Na visão 3D, quanto mais para dentro, mais alto o degrau.

Em código, o contexto vira uma pasta: `domain/` (o miolo) e `application/` (o anel em volta). A regra de dependência é a mesma do desenho: `application` importa `domain`, nunca o contrário.

**Peças destacadas:** Tarefas.

### 2. Value Object: Título

Um **value object** é um valor sem identidade: dois títulos com o mesmo texto são o mesmo título. Ele é **imutável** e se **autovalida**: o construtor é privado e a única entrada, `Titulo.de`, confere a invariante.

Ganho: em nenhum outro lugar do código alguém precisa perguntar se o título está vazio. Se existe um `Titulo`, ele é válido.

No diagrama: o cartão **VO** no miolo, com a invariante no inspetor (clique nele no 2D para ver os campos).

**Peças destacadas:** Título.

[`codigo/domain/titulo.ts`](codigo/domain/titulo.ts)

```ts
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
```

### 3. Aggregate Root: Tarefa

A **Tarefa** tem identidade (o `id`): ela continua sendo a mesma tarefa quando o estado muda. É o **aggregate root**, a única porta para mudar o estado, e por isso o lugar das regras: *uma tarefa concluída não volta a ser concluída*.

Repare em duas coisas no código: o estado é `private`, e cada método que muda o estado **devolve o evento** do que aconteceu.

No diagrama: o cartão **AGG** no miolo. A seta *contém* até o Título diz que o Título faz parte deste aggregate.

**Peças destacadas:** Tarefa, Título.

[`codigo/domain/tarefa.ts`](codigo/domain/tarefa.ts)

```ts
/**
 * Aggregate root: tem identidade (o id) e guarda as regras do conjunto. Ninguém de fora muda o estado
 * sem passar por um método dele, e cada método que muda o estado devolve o fato que aconteceu.
 */
export class Tarefa {
  private constructor(
    readonly id: string,
    readonly titulo: Titulo,
    private concluida: boolean,
  ) {}

  /** Criar também é regra de negócio: devolve a tarefa nova e o evento. */
  static criar(id: string, titulo: Titulo): { tarefa: Tarefa; evento: TarefaCriada } {
    const tarefa = new Tarefa(id, titulo, false);
    return { tarefa, evento: { tipo: "TarefaCriada", tarefaId: id, titulo: titulo.texto } };
  }

  get estaConcluida(): boolean {
    return this.concluida;
  }

  /** Invariante: uma tarefa concluída não volta a ser concluída. */
  concluir(agora: Date): TarefaConcluida {
    if (this.concluida) throw new Error("Esta tarefa já foi concluída.");
    this.concluida = true;
    return { tipo: "TarefaConcluida", tarefaId: this.id, em: agora };
  }
}
```

### 4. Domain Events: o que aconteceu

Um **evento de domínio** é um fato no passado: *Tarefa criada*, *Tarefa concluída*. Só dados, nunca muda e serve para avisar quem tiver interesse (outras partes do sistema, relatórios, notificações).

Em TypeScript, uma *union* com o campo `tipo` (`EventoDeTarefa`) deixa o compilador conferir se todo `switch` trata todos os eventos.

No diagrama: os cartões **EVT**, e as setas *emite evento* chegando neles.

**Peças destacadas:** Tarefa criada, Tarefa concluída.

[`codigo/domain/eventos.ts`](codigo/domain/eventos.ts)

```ts
/**
 * Eventos de domínio: fatos que já aconteceram, nomeados no passado.
 * Só dados, sem comportamento, e nunca mudam.
 */
export interface TarefaCriada {
  readonly tipo: "TarefaCriada";
  readonly tarefaId: string;
  readonly titulo: string;
}

export interface TarefaConcluida {
  readonly tipo: "TarefaConcluida";
  readonly tarefaId: string;
  readonly em: Date;
}

/**
 * Todos os fatos deste contexto. Quem reage a eles faz um `switch (evento.tipo)`
 * e o TypeScript confere se todos os casos foram tratados.
 */
export type EventoDeTarefa = TarefaCriada | TarefaConcluida;
```

### 5. Commands: a intenção de quem usa

Um **command** é um pedido no imperativo: *Criar tarefa*, *Concluir tarefa*. Ao contrário do evento, ele **pode ser recusado** (se a regra não deixar).

No código, um command é só a mensagem: os dados que o usuário mandou, com tipos simples.

No diagrama: os cartões **CMD** no anel de *Use Cases*, um degrau abaixo do miolo.

**Peças destacadas:** Criar tarefa, Concluir tarefa.

[`codigo/application/commands.ts`](codigo/application/commands.ts)

```ts
/**
 * Commands: a intenção de quem usa o sistema, no imperativo.
 * Carregam só o que foi pedido e podem ser recusados.
 */
export interface CriarTarefa {
  readonly titulo: string;
}

export interface ConcluirTarefa {
  readonly tarefaId: string;
}
```

### 6. Command → Aggregate → Evento

Este é o fluxo central do DDD, e está desenhado nas setas: o command **dispara** o aggregate, e o resultado **emite** o evento.

O handler é só o tradutor: transforma o texto em `Titulo`, chama o método da `Tarefa` e devolve os eventos. **Nenhuma regra de negócio mora aqui.** Se um dia você escrever um `if` de negócio num handler, ele provavelmente pertence ao aggregate.

**Peças destacadas:** Criar tarefa, Concluir tarefa, Tarefa, Tarefa criada, Tarefa concluída.

[`codigo/application/handlers.ts`](codigo/application/handlers.ts)

```ts
/**
 * Command → aggregate → evento. O handler só traduz a intenção em chamadas ao aggregate:
 * nenhuma regra de negócio mora aqui (as regras estão no Titulo e na Tarefa).
 */
export function criarTarefa(
  cmd: CriarTarefa,
  novoId: () => string,
): { tarefa: Tarefa; eventos: EventoDeTarefa[] } {
  const { tarefa, evento } = Tarefa.criar(novoId(), Titulo.de(cmd.titulo));
  return { tarefa, eventos: [evento] };
}

/** Nesta aula quem chama entrega a tarefa; na aula 2 um repository passa a buscá-la. */
export function concluirTarefa(cmd: ConcluirTarefa, tarefa: Tarefa, agora = new Date()): EventoDeTarefa[] {
  if (tarefa.id !== cmd.tarefaId) throw new Error("O command é de outra tarefa.");
  return [tarefa.concluir(agora)];
}
```

### 7. Caso de uso: juntando tudo

O **caso de uso** é o objetivo de um ator: o *Usuário* quer *Organizar tarefas*. Os commands **realizam** o caso de uso.

Rode o exemplo: `npx tsx exemplo.ts`. Ele cria uma tarefa, conclui, e tenta concluir de novo para ver a invariante recusar.

No rodapé deste painel, **Esqueleto gerado** mostra o código que o Archflow gera sozinho a partir deste mesmo diagrama: compare com o que você acabou de ler.

**Peças destacadas:** Usuário, Organizar tarefas, Criar tarefa, Concluir tarefa.

[`codigo/exemplo.ts`](codigo/exemplo.ts)

```ts
/** O caso de uso «Organizar tarefas», como o Usuário o vive: criar uma tarefa e concluí-la. */
let n = 0;
const novoId = () => `t${++n}`;

const { tarefa, eventos } = criarTarefa({ titulo: "  Estudar DDD  " }, novoId);
const historico: EventoDeTarefa[] = [
  ...eventos,
  ...concluirTarefa({ tarefaId: tarefa.id }, tarefa),
];

for (const e of historico) console.log(e.tipo, e.tarefaId);
// TarefaCriada t1
// TarefaConcluida t1

try {
  concluirTarefa({ tarefaId: tarefa.id }, tarefa); // de novo: a invariante do aggregate recusa
} catch (e) {
  console.log("recusado:", (e as Error).message);
}
```

## Para praticar

- Adicione o command «Renomear tarefa» no diagrama (o novo título é um Título) e o evento «Tarefa renomeada»; depois o método `renomear` na Tarefa.
- Crie a invariante «uma tarefa concluída não pode ser renomeada» e teste no exemplo.

Próxima: [Aula 2 · Carrinho de compras](../02-carrinho/README.md).
