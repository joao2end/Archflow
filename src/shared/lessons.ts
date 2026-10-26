/**
 * Aulas de DDD em TypeScript: aprender o domínio pelo diagrama.
 *
 * Cada aula é um diagrama de modo domain no layout "camadas" (abre na visão 3D) e uma pasta de código TypeScript de verdade
 * (`examples/aulas-ddd/<aula>/codigo/`, compila com `tsc --strict` e roda com `npx tsx exemplo.ts`). Os passos ligam os
 * dois lados: cada passo destaca componentes no diagrama e mostra o trecho do código que os implementa
 * (`// #region <nome>` … `// #endregion`).
 *
 * As aulas vêm em ordem e cada uma acrescenta pouco à anterior:
 *  1. Tarefas: value object, aggregate root, command e evento.
 *  2. Carrinho: entity dentro do aggregate, invariantes do conjunto e repository.
 *  3. Pedidos: dois aggregates ligados por eventos, policy, controller e read model.
 *
 * Puro: o código das aulas chega de fora (o app usa `import.meta.glob`; os testes e o build leem do disco).
 */
import { actor, ctx, dn, handle, rel, runs, when, type ExampleFile } from "./examples";
import { applyOps, slug, type Op } from "./ops";
import { emptyDoc, type Doc } from "./schema";

export const LESSONS_DIR = "aulas-ddd";

export interface LessonStep {
  title: string;
  /** a explicação (markdown curto): o conceito, por que existe e onde vê-lo no diagrama */
  text: string;
  /** ids dos componentes (ou do contexto) que o passo destaca no diagrama */
  focus: string[];
  /** trecho do código: arquivo (relativo a `codigo/`) e o nome da região */
  code?: { file: string; region: string };
}

export interface Lesson {
  /** pasta em `examples/aulas-ddd/` e sufixo do id do diagrama */
  id: string;
  n: number;
  title: string;
  summary: string;
  teaches: string[];
  diagram: ExampleFile;
  steps: LessonStep[];
  /** para praticar depois da aula */
  exercises: string[];
}

/** «usa» passando pela porta (a interface que o domínio define e o repository implementa), com o mesmo nome do código. */
const viaPort = (from: string, to: string, name: string, operations: string[]): Op => ({ op: "add_connection", from, to, ddd: { rel: "uses" }, port: { name, operations } });

/* ═════════════════════════════ Aula 1 · Tarefas ═════════════════════════════ */

const tarefas: Lesson = {
  id: "01-tarefas",
  n: 1,
  title: "Lista de tarefas",
  summary: "O mínimo do DDD: um value object, um aggregate root, dois commands e os eventos que eles produzem.",
  teaches: ["bounded context", "value object", "aggregate root e invariante", "command → evento", "caso de uso"],
  diagram: {
    file: "aula-1-lista-de-tarefas",
    title: "Aula 1 · Lista de tarefas",
    mode: "domain",
    layout: "onion",
    ops: [
      ctx("tarefas", "Tarefas", "core", "Tudo sobre registrar o que precisa ser feito e marcar o que já foi."),
      actor("tarefas", "usuario", "Usuário"),
      dn("tarefas", "organizar-tarefas", "Organizar tarefas", { role: "use-case", actor: "Usuário", goal: "Registrar o que precisa fazer e marcar o que já fez" }),
      dn("tarefas", "tarefa", "Tarefa", {
        role: "aggregate-root",
        invariants: ["o título é sempre válido (é um Título)", "uma tarefa concluída não volta a ser concluída"],
        properties: [
          { name: "id", type: "texto", key: true },
          { name: "titulo", type: "Título" },
          { name: "concluida", type: "boolean" },
        ],
      }),
      dn("tarefas", "titulo", "Título", { role: "value-object", invariants: ["tem de 1 a 80 caracteres, sem espaços nas pontas"], properties: [{ name: "texto", type: "texto" }] }),
      dn("tarefas", "criar-tarefa", "Criar tarefa", { role: "command", intent: "Registrar uma tarefa nova com um título", properties: [{ name: "titulo", type: "texto" }] }),
      dn("tarefas", "concluir-tarefa", "Concluir tarefa", { role: "command", intent: "Marcar uma tarefa como feita", properties: [{ name: "tarefaId", type: "texto" }] }),
      dn("tarefas", "tarefa-criada", "Tarefa criada", { role: "domain-event", properties: [{ name: "tarefaId", type: "texto" }, { name: "titulo", type: "texto" }] }),
      dn("tarefas", "tarefa-concluida", "Tarefa concluída", { role: "domain-event", properties: [{ name: "tarefaId", type: "texto" }, { name: "em", type: "data" }] }),
      rel("tarefa", "titulo", "contains"),
      ...handle("criar-tarefa", "tarefa", "tarefa-criada"),
      ...handle("concluir-tarefa", "tarefa", "tarefa-concluida"),
      rel("criar-tarefa", "organizar-tarefas", "realizes"),
      rel("concluir-tarefa", "organizar-tarefas", "realizes"),
      runs("usuario", "organizar-tarefas"),
    ],
  },
  steps: [
    {
      title: "O contexto: onde as palavras têm um só sentido",
      text:
        "Todo modelo de DDD vive dentro de um **bounded context**: a fronteira onde cada palavra tem um significado só. Aqui, *Tarefa* é algo a fazer com um título, e nada mais.\n\n" +
        "No diagrama o contexto é o círculo inteiro. As camadas vão **de dentro para fora**, como na Clean Architecture: no miolo ficam as regras de negócio (*Entities*), em volta os casos de uso (*Use Cases*) e por fora quem usa o sistema. Na visão 3D, quanto mais para dentro, mais alto o degrau.\n\n" +
        "Em código, o contexto vira uma pasta: `domain/` (o miolo) e `application/` (o anel em volta). A regra de dependência é a mesma do desenho: `application` importa `domain`, nunca o contrário.",
      focus: ["tarefas"],
    },
    {
      title: "Value Object: Título",
      text:
        "Um **value object** é um valor sem identidade: dois títulos com o mesmo texto são o mesmo título. Ele é **imutável** e se **autovalida**: o construtor é privado e a única entrada, `Titulo.de`, confere a invariante.\n\n" +
        "Ganho: em nenhum outro lugar do código alguém precisa perguntar se o título está vazio. Se existe um `Titulo`, ele é válido.\n\n" +
        "No diagrama: o cartão **VO** no miolo, com a invariante no inspetor (clique nele no 2D para ver os campos).",
      focus: ["titulo"],
      code: { file: "domain/titulo.ts", region: "Titulo" },
    },
    {
      title: "Aggregate Root: Tarefa",
      text:
        "A **Tarefa** tem identidade (o `id`): ela continua sendo a mesma tarefa quando o estado muda. É o **aggregate root**, a única porta para mudar o estado, e por isso o lugar das regras: *uma tarefa concluída não volta a ser concluída*.\n\n" +
        "Repare em duas coisas no código: o estado é `private`, e cada método que muda o estado **devolve o evento** do que aconteceu.\n\n" +
        "No diagrama: o cartão **AGG** no miolo. A seta *contém* até o Título diz que o Título faz parte deste aggregate.",
      focus: ["tarefa", "titulo"],
      code: { file: "domain/tarefa.ts", region: "Tarefa" },
    },
    {
      title: "Domain Events: o que aconteceu",
      text:
        "Um **evento de domínio** é um fato no passado: *Tarefa criada*, *Tarefa concluída*. Só dados, nunca muda e serve para avisar quem tiver interesse (outras partes do sistema, relatórios, notificações).\n\n" +
        "Em TypeScript, uma *union* com o campo `tipo` (`EventoDeTarefa`) deixa o compilador conferir se todo `switch` trata todos os eventos.\n\n" +
        "No diagrama: os cartões **EVT**, e as setas *emite evento* chegando neles.",
      focus: ["tarefa-criada", "tarefa-concluida"],
      code: { file: "domain/eventos.ts", region: "eventos" },
    },
    {
      title: "Commands: a intenção de quem usa",
      text:
        "Um **command** é um pedido no imperativo: *Criar tarefa*, *Concluir tarefa*. Ao contrário do evento, ele **pode ser recusado** (se a regra não deixar).\n\n" +
        "No código, um command é só a mensagem: os dados que o usuário mandou, com tipos simples.\n\n" +
        "No diagrama: os cartões **CMD** no anel de *Use Cases*, um degrau abaixo do miolo.",
      focus: ["criar-tarefa", "concluir-tarefa"],
      code: { file: "application/commands.ts", region: "commands" },
    },
    {
      title: "Command → Aggregate → Evento",
      text:
        "Este é o fluxo central do DDD, e está desenhado nas setas: o command **dispara** o aggregate, e o resultado **emite** o evento.\n\n" +
        "O handler é só o tradutor: transforma o texto em `Titulo`, chama o método da `Tarefa` e devolve os eventos. **Nenhuma regra de negócio mora aqui.** Se um dia você escrever um `if` de negócio num handler, ele provavelmente pertence ao aggregate.",
      focus: ["criar-tarefa", "concluir-tarefa", "tarefa", "tarefa-criada", "tarefa-concluida"],
      code: { file: "application/handlers.ts", region: "handlers" },
    },
    {
      title: "Caso de uso: juntando tudo",
      text:
        "O **caso de uso** é o objetivo de um ator: o *Usuário* quer *Organizar tarefas*. Os commands **realizam** o caso de uso.\n\n" +
        "Rode o exemplo: `npx tsx exemplo.ts`. Ele cria uma tarefa, conclui, e tenta concluir de novo para ver a invariante recusar.\n\n" +
        "No rodapé deste painel, **Esqueleto gerado** mostra o código que o Archflow gera sozinho a partir deste mesmo diagrama: compare com o que você acabou de ler.",
      focus: ["usuario", "organizar-tarefas", "criar-tarefa", "concluir-tarefa"],
      code: { file: "exemplo.ts", region: "uso" },
    },
  ],
  exercises: [
    "Adicione o command «Renomear tarefa» no diagrama (o novo título é um Título) e o evento «Tarefa renomeada»; depois o método `renomear` na Tarefa.",
    "Crie a invariante «uma tarefa concluída não pode ser renomeada» e teste no exemplo.",
  ],
};

/* ═════════════════════════════ Aula 2 · Carrinho ═════════════════════════════ */

const carrinho: Lesson = {
  id: "02-carrinho",
  n: 2,
  title: "Carrinho de compras",
  summary: "Um aggregate com partes: entity dentro do aggregate, invariantes que só a raiz garante e o repository que guarda o conjunto.",
  teaches: ["entity × value object", "fronteira do aggregate", "invariante do conjunto", "repository (interface no domínio)", "handler: carregar, chamar, salvar"],
  diagram: {
    file: "aula-2-carrinho-de-compras",
    title: "Aula 2 · Carrinho de compras",
    mode: "domain",
    layout: "onion",
    ops: [
      ctx("compras", "Compras", "core", "O cliente escolhe produtos e quantidades até fechar o carrinho."),
      actor("compras", "cliente", "Cliente"),
      dn("compras", "montar-carrinho", "Montar o carrinho", { role: "use-case", actor: "Cliente", goal: "Escolher produtos e quantidades e fechar a compra" }),
      dn("compras", "carrinho", "Carrinho", {
        role: "aggregate-root",
        invariants: ["no máximo 10 produtos diferentes", "um carrinho fechado não muda mais", "não se fecha um carrinho vazio"],
        properties: [
          { name: "id", type: "texto", key: true },
          { name: "itens", type: "Item do carrinho[]" },
          { name: "fechado", type: "boolean" },
        ],
      }),
      dn("compras", "item-do-carrinho", "Item do carrinho", {
        role: "entity",
        invariants: ["a quantidade fica entre 1 e 99"],
        properties: [
          { name: "produtoId", type: "texto", key: true, description: "a identidade do item dentro do carrinho" },
          { name: "precoUnitario", type: "Dinheiro" },
          { name: "quantidade", type: "inteiro" },
        ],
      }),
      dn("compras", "dinheiro", "Dinheiro", { role: "value-object", invariants: ["centavos inteiros, nunca negativos"], properties: [{ name: "centavos", type: "inteiro" }] }),
      dn("compras", "carrinhos", "Repositório de carrinhos", { role: "repository", for: "carrinho" }),
      dn("compras", "adicionar-item", "Adicionar item", { role: "command", intent: "Pôr um produto no carrinho (ou somar à quantidade)" }),
      dn("compras", "remover-item", "Remover item", { role: "command", intent: "Tirar um produto do carrinho" }),
      dn("compras", "fechar-carrinho", "Fechar carrinho", { role: "command", intent: "Encerrar a escolha e fixar o total" }),
      dn("compras", "item-adicionado", "Item adicionado", { role: "domain-event" }),
      dn("compras", "item-removido", "Item removido", { role: "domain-event" }),
      dn("compras", "carrinho-fechado", "Carrinho fechado", { role: "domain-event", properties: [{ name: "totalEmCentavos", type: "inteiro" }] }),
      rel("carrinho", "item-do-carrinho", "contains"),
      rel("item-do-carrinho", "dinheiro", "contains", "preço"),
      ...handle("adicionar-item", "carrinho", "item-adicionado"),
      ...handle("remover-item", "carrinho", "item-removido"),
      ...handle("fechar-carrinho", "carrinho", "carrinho-fechado"),
      viaPort("adicionar-item", "carrinhos", "CarrinhoRepository", ["buscar(id)", "salvar(carrinho)"]),
      viaPort("remover-item", "carrinhos", "CarrinhoRepository", ["buscar(id)", "salvar(carrinho)"]),
      viaPort("fechar-carrinho", "carrinhos", "CarrinhoRepository", ["buscar(id)", "salvar(carrinho)"]),
      rel("adicionar-item", "montar-carrinho", "realizes"),
      rel("remover-item", "montar-carrinho", "realizes"),
      rel("fechar-carrinho", "montar-carrinho", "realizes"),
      runs("cliente", "montar-carrinho"),
    ],
  },
  steps: [
    {
      title: "Dinheiro: outro value object",
      text:
        "Começamos pelo menor pedaço. **Dinheiro** guarda centavos inteiros (nada de `0.1 + 0.2`) e é imutável: `somar` devolve outro Dinheiro.\n\n" +
        "Value objects tiram regras repetidas do resto do código: ninguém mais precisa lembrar de arredondar ou de proibir valor negativo.",
      focus: ["dinheiro"],
      code: { file: "domain/dinheiro.ts", region: "Dinheiro" },
    },
    {
      title: "Entity: Item do carrinho",
      text:
        "O **Item do carrinho** é uma **entity**: tem identidade (o produto) e muda com o tempo (a quantidade). Compare com o Dinheiro: dois Dinheiros iguais são intercambiáveis, dois itens não.\n\n" +
        "A diferença para a Tarefa da aula 1: este item **não é raiz**. Ele vive dentro do Carrinho e só o Carrinho o cria e altera. No diagrama, a seta *contém* vem do Carrinho até ele.",
      focus: ["item-do-carrinho", "dinheiro"],
      code: { file: "domain/item-do-carrinho.ts", region: "ItemDoCarrinho" },
    },
    {
      title: "Aggregate Root: Carrinho",
      text:
        "*No máximo 10 produtos diferentes* é uma regra sobre o **conjunto** dos itens: nenhum item sozinho consegue garanti-la. Por isso o **Carrinho** é a raiz do aggregate: tudo passa por ele, e ele vê o conjunto inteiro.\n\n" +
        "Repare que `linhas` devolve uma **cópia**: de fora só se lê. Esse é o desenho da fronteira do aggregate, e no diagrama ela aparece como as setas *contém* (Carrinho → Item → Dinheiro).",
      focus: ["carrinho", "item-do-carrinho", "dinheiro"],
      code: { file: "domain/carrinho.ts", region: "Carrinho" },
    },
    {
      title: "Eventos do carrinho",
      text:
        "Os eventos levam **ids e números**, nunca objetos do domínio: quem recebe *Carrinho fechado* (o faturamento, por exemplo) não precisa conhecer a classe `Carrinho`.",
      focus: ["item-adicionado", "item-removido", "carrinho-fechado"],
      code: { file: "domain/eventos.ts", region: "eventos" },
    },
    {
      title: "Repository: a coleção de carrinhos",
      text:
        "O **repository** é a coleção dos aggregates, vista pelo domínio: `buscar` e `salvar`, e só. Há **um por aggregate root**, e ele guarda o aggregate inteiro (nunca um item solto).\n\n" +
        "A interface mora no **domínio**; a implementação fica do lado de fora (`infra/`). No diagrama, o cartão **REPO** fica no anel de *Interface Adapters* (setor *Gateways*), e os commands o **usam**.",
      focus: ["carrinhos", "carrinho"],
      code: { file: "domain/carrinho-repository.ts", region: "repository" },
    },
    {
      title: "Implementação: memória hoje, banco amanhã",
      text:
        "Esta classe implementa a interface com um `Map`. Trocá-la por um banco de dados não muda **nenhuma linha** do domínio: é a regra de dependência funcionando (o de fora conhece o de dentro, nunca o contrário).",
      focus: ["carrinhos"],
      code: { file: "infra/carrinhos-em-memoria.ts", region: "memoria" },
    },
    {
      title: "Handlers: carregar, chamar, salvar",
      text:
        "Agora o handler tem um roteiro fixo: **carregar** o aggregate pelo repository, **chamar** um método dele, **salvar** e devolver os eventos. Ele recebe a *interface* do repository no construtor.\n\n" +
        "No diagrama, cada command tem três setas: *dispara* o Carrinho, *emite* o evento e *usa* o repositório.",
      focus: ["adicionar-item", "remover-item", "fechar-carrinho", "carrinhos", "carrinho"],
      code: { file: "application/handlers.ts", region: "handlers" },
    },
    {
      title: "O caso de uso rodando",
      text:
        "O exemplo escolhe a implementação do repository **na borda** e a entrega aos handlers. Depois monta o carrinho, fecha e tenta mexer de novo: a invariante *um carrinho fechado não muda mais* recusa.\n\n" +
        "Rode: `npx tsx exemplo.ts`.",
      focus: ["cliente", "montar-carrinho", "adicionar-item", "remover-item", "fechar-carrinho"],
      code: { file: "exemplo.ts", region: "uso" },
    },
  ],
  exercises: [
    "Adicione um value object «Cupom» (código e percentual de 1 a 50) e o command «Aplicar cupom»: onde fica a regra «um cupom por carrinho»?",
    "Escreva um `CarrinhoRepository` que grava em arquivo JSON e troque no exemplo sem mexer em `domain/`.",
  ],
};

/* ═════════════════════════════ Aula 3 · Pedidos ═════════════════════════════ */

const pedidos: Lesson = {
  id: "03-pedidos",
  n: 3,
  title: "Pedido e estoque",
  summary: "Dois aggregates que não se tocam: o Pedido anuncia, uma policy reage e o Estoque reserva. Com controller na entrada e read model para a consulta.",
  teaches: ["dois aggregates, um por transação", "referência por id", "policy (evento → command)", "controller", "read model (CQRS)"],
  diagram: {
    file: "aula-3-pedido-e-estoque",
    title: "Aula 3 · Pedido e estoque",
    mode: "domain",
    layout: "onion",
    ops: [
      ctx("vendas", "Vendas", "core", "Pedidos de clientes e a reserva do estoque que os atende."),
      actor("vendas", "cliente", "Cliente"),
      dn("vendas", "fazer-pedido", "Fazer pedido", { role: "use-case", actor: "Cliente", goal: "Comprar um produto e acompanhar até a confirmação" }),
      dn("vendas", "pedidos-controller", "Controller de pedidos", {
        role: "controller",
        intent: "POST /pedidos despacha Registrar pedido; GET /clientes/:id/pedidos lê Meus pedidos",
        properties: [
          { name: "clienteId", type: "texto" },
          { name: "produtoId", type: "texto" },
          { name: "quantidade", type: "inteiro" },
        ],
      }),
      dn("vendas", "registrar-pedido", "Registrar pedido", { role: "command", intent: "Abrir um pedido de um produto" }),
      dn("vendas", "pedido", "Pedido", {
        role: "aggregate-root",
        invariants: ["tem ao menos uma unidade", "só é confirmado uma vez, e depois de registrado"],
        properties: [
          { name: "id", type: "texto", key: true },
          { name: "produtoId", type: "texto", description: "aponta o Estoque só pelo id" },
          { name: "quantidade", type: "inteiro" },
        ],
      }),
      dn("vendas", "pedido-registrado", "Pedido registrado", { role: "domain-event" }),
      dn("vendas", "reservar-ao-registrar", "Ao registrar, reservar estoque", { role: "policy", intent: "Todo pedido novo pede a reserva do produto" }),
      dn("vendas", "reservar-estoque", "Reservar estoque", { role: "command", intent: "Separar as unidades do pedido" }),
      dn("vendas", "estoque", "Estoque", { role: "aggregate-root", invariants: ["o saldo nunca fica negativo"], properties: [{ name: "produtoId", type: "texto", key: true }, { name: "saldo", type: "inteiro" }] }),
      dn("vendas", "estoque-reservado", "Estoque reservado", { role: "domain-event" }),
      dn("vendas", "confirmar-ao-reservar", "Ao reservar, confirmar pedido", { role: "policy", intent: "Com o estoque garantido, o pedido é confirmado" }),
      dn("vendas", "confirmar-pedido", "Confirmar pedido", { role: "command", intent: "Marcar o pedido como confirmado" }),
      dn("vendas", "pedido-confirmado", "Pedido confirmado", { role: "domain-event" }),
      dn("vendas", "meus-pedidos", "Meus pedidos", { role: "read-model", properties: [{ name: "pedidoId", type: "texto" }, { name: "situacao", type: "texto" }] }),
      dn("vendas", "pedidos-repo", "Repositório de pedidos", { role: "repository", for: "pedido" }),
      dn("vendas", "estoques-repo", "Repositório de estoques", { role: "repository", for: "estoque" }),
      runs("cliente", "fazer-pedido"),
      rel("pedidos-controller", "registrar-pedido", "triggers", "POST /pedidos"),
      rel("pedidos-controller", "meus-pedidos", "uses", "GET"),
      ...handle("registrar-pedido", "pedido", "pedido-registrado"),
      ...when("pedido-registrado", "reservar-ao-registrar", "reservar-estoque"),
      ...handle("reservar-estoque", "estoque", "estoque-reservado"),
      ...when("estoque-reservado", "confirmar-ao-reservar", "confirmar-pedido"),
      ...handle("confirmar-pedido", "pedido", "pedido-confirmado"),
      rel("pedido", "estoque", "references-by-id", "produtoId"),
      rel("pedido-registrado", "meus-pedidos", "triggers"),
      rel("pedido-confirmado", "meus-pedidos", "triggers"),
      viaPort("registrar-pedido", "pedidos-repo", "PedidoRepository", ["buscar(id)", "salvar(pedido)"]),
      viaPort("confirmar-pedido", "pedidos-repo", "PedidoRepository", ["buscar(id)", "salvar(pedido)"]),
      viaPort("reservar-estoque", "estoques-repo", "EstoqueRepository", ["buscar(produtoId)", "salvar(estoque)"]),
      rel("registrar-pedido", "fazer-pedido", "realizes"),
      rel("reservar-estoque", "fazer-pedido", "realizes"),
      rel("confirmar-pedido", "fazer-pedido", "realizes"),
    ],
  },
  steps: [
    {
      title: "Controller: a porta de entrada",
      text:
        "O **controller** recebe o pedido de fora (HTTP, tela, fila), confere o **formato** da entrada e despacha o command. Para ler, consulta o read model. Ele está no anel de *Interface Adapters* (setor *Controllers*): um degrau abaixo dos casos de uso.\n\n" +
        "Repare na diferença entre os erros: **400** é entrada malformada (barrada aqui); **422** é uma regra do domínio que recusou (vem lá de dentro).",
      focus: ["pedidos-controller"],
      code: { file: "interface/pedidos-controller.ts", region: "controller" },
    },
    {
      title: "Pedido: o primeiro aggregate",
      text:
        "O **Pedido** guarda `produtoId`, não o objeto Estoque. É a **referência por id** (a seta azul *referencia (id)* no diagrama): cada aggregate é salvo sozinho, e um não muda o outro na mesma transação.\n\n" +
        "Se o Pedido guardasse o Estoque, salvar um pedido poderia alterar o saldo sem passar pelas regras do Estoque.",
      focus: ["pedido", "estoque"],
      code: { file: "domain/pedido.ts", region: "Pedido" },
    },
    {
      title: "Estoque: o segundo aggregate",
      text:
        "O **Estoque** tem a própria regra (*o saldo nunca fica negativo*) e o próprio repository. Ele não sabe que pedidos existem: só sabe reservar.",
      focus: ["estoque"],
      code: { file: "domain/estoque.ts", region: "Estoque" },
    },
    {
      title: "Eventos ligam os aggregates",
      text:
        "Em vez de o Pedido chamar o Estoque, ele **anuncia**: *Pedido registrado*. Quem tiver interesse reage. É assim que dois aggregates conversam sem se acoplar.",
      focus: ["pedido-registrado", "estoque-reservado", "pedido-confirmado"],
      code: { file: "domain/eventos.ts", region: "eventos" },
    },
    {
      title: "Policy: quando X, faça Y",
      text:
        "Uma **policy** reage a um evento e emite o próximo command: *ao registrar, reservar estoque*; *ao reservar, confirmar pedido*. Sem estado e sem regra de negócio: é uma função de evento para command.\n\n" +
        "Siga as setas laranja no diagrama: evento → policy → command → aggregate → evento… é a corrente inteira do caso de uso.",
      focus: ["pedido-registrado", "reservar-ao-registrar", "reservar-estoque", "estoque-reservado", "confirmar-ao-reservar", "confirmar-pedido"],
      code: { file: "application/policies.ts", region: "policies" },
    },
    {
      title: "Handlers: um aggregate por vez",
      text:
        "Cada handler mexe em **um só aggregate**: carrega, chama, salva e publica. O `registrarPedido` não reserva estoque; ele só publica o evento, e a policy faz o resto.",
      focus: ["registrar-pedido", "reservar-estoque", "confirmar-pedido", "pedidos-repo", "estoques-repo"],
      code: { file: "application/handlers.ts", region: "handlers" },
    },
    {
      title: "Read model: a tela «Meus pedidos»",
      text:
        "Para **ler** não se passa pelos aggregates. O **read model** é uma tabela pronta para a tela, alimentada pelos eventos (CQRS: um lado para mudar, outro para consultar).\n\n" +
        "No diagrama: o cartão **READ** no setor *Presenters*, recebendo *Pedido registrado* e *Pedido confirmado*, e o controller o usando no GET.",
      focus: ["meus-pedidos", "pedido-registrado", "pedido-confirmado", "pedidos-controller"],
      code: { file: "application/meus-pedidos.ts", region: "readmodel" },
    },
    {
      title: "A borda: montar as peças",
      text:
        "Na camada de fora (*Frameworks & Drivers*) escolhem-se as implementações e liga-se tudo: os repositories em memória e um barramento que entrega cada evento ao read model e à policy certa.\n\n" +
        "É o único lugar que conhece todo mundo, e por isso o único que precisa mudar ao trocar de tecnologia.",
      focus: ["pedidos-repo", "estoques-repo", "reservar-ao-registrar", "confirmar-ao-reservar", "meus-pedidos"],
      code: { file: "infra/montar.ts", region: "montar" },
    },
    {
      title: "O caso de uso de ponta a ponta",
      text:
        "Rode `npx tsx exemplo.ts`: o primeiro pedido percorre a corrente inteira e chega a *confirmado*; o segundo pede mais do que há e o Estoque recusa (422); o terceiro chega incompleto e o controller barra (400).\n\n" +
        "Na apresentação (botão **Apresentar**), o passo a passo do caso de uso *Fazer pedido* anda pela mesma corrente, peça por peça.",
      focus: ["cliente", "fazer-pedido", "pedidos-controller", "registrar-pedido", "pedido", "pedido-confirmado"],
      code: { file: "exemplo.ts", region: "uso" },
    },
  ],
  exercises: [
    "Quando falta estoque, o pedido fica «aguardando» para sempre. Modele o evento «Estoque insuficiente» e uma policy que cancela o pedido (command «Cancelar pedido»).",
    "Troque o pedido de um produto por vários itens: quantos `Reservar estoque` passam a existir, e quem espera todos? (dica: process-manager)",
  ],
};

export const LESSONS: Lesson[] = [tarefas, carrinho, pedidos];

/* ───────── construção ───────── */

/** Id estável do diagrama de uma aula: é por ele que o app reconhece que o diagrama aberto é uma aula. */
export const lessonDocId = (l: Pick<Lesson, "id">) => `aula-ddd-${l.id}`;
/** Caminho do diagrama dentro do projeto (no app e em `examples/`). */
export const lessonPath = (l: Lesson) => `${LESSONS_DIR}/${l.diagram.file}.archflow.json`;
/** Caminho de um arquivo de código da aula, relativo a `examples/`. */
export const lessonCodePath = (l: Pick<Lesson, "id">, file: string) => `${LESSONS_DIR}/${l.id}/codigo/${file}`;
export const lessonOfDoc = (doc: Pick<Doc, "id">): Lesson | undefined => LESSONS.find((l) => lessonDocId(l) === doc.id);

export function buildLessonDoc(l: Lesson): Doc {
  const { doc, results } = applyOps(emptyDoc(l.diagram.title, "domain"), [...l.diagram.ops, { op: "layout", style: "onion" }]);
  const failed = results.map((r, i) => ({ r, i })).filter((x) => !x.r.ok);
  if (failed.length) throw new Error(`aula "${l.title}": ${failed.map((x) => `op #${x.i}: ${x.r.error}`).join("; ")}`);
  doc.id = lessonDocId(l);
  doc.description = `Aula ${l.n} de ${LESSONS.length} de DDD em TypeScript: ${l.summary}`;
  return doc;
}

/** O título do arquivo da aula tem de virar o nome previsto (o app cria o arquivo a partir do título). */
export const lessonSlugOk = (l: Lesson) => slug(l.diagram.title) === l.diagram.file;

/**
 * Trecho entre `// #region <nome>` e `// #endregion` (sem as duas linhas), sem a indentação comum.
 * Devolve undefined se a região não existir.
 */
export function codeRegion(source: string, region: string): string | undefined {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const start = lines.findIndex((l) => l.trim() === `// #region ${region}`);
  if (start < 0) return undefined;
  const end = lines.findIndex((l, i) => i > start && l.trim() === "// #endregion");
  if (end < 0) return undefined;
  const body = lines.slice(start + 1, end);
  const indent = Math.min(...body.filter((l) => l.trim()).map((l) => l.match(/^ */)![0].length));
  return body.map((l) => l.slice(Number.isFinite(indent) ? indent : 0)).join("\n").replace(/^\n+|\n+$/g, "");
}
