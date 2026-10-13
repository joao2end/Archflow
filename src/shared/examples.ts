/**
 * Exemplos de DDD (modo Domain) para aprender e para partir de um modelo pronto.
 *
 * Cada exemplo é um conjunto de diagramas de um cofre: um mapa de contextos (visão geral) e um diagrama por bounded context
 * (mais, em um deles, a arquitetura que implementa os contextos). Tudo é definido como lista de ops, a mesma linguagem que a UI
 * e o MCP usam, então:
 *   - o app instala os exemplos no cofre do usuário (`exemplos-ddd/<exemplo>/…`);
 *   - `scripts/build-examples.ts` grava os mesmos diagramas em `examples/` (arquivos .archflow.json + o texto que a IA lê);
 *   - os testes garantem que todos validam sem erros nem avisos, rastreiam todos os casos de uso e não ficam desatualizados.
 */
import { applyOps, slug, type Op } from "./ops";
import { emptyDoc, type ContextPattern, type DddConnSpec, type DddNodeSpec, type DddRel, type Doc, type DocMode, type Subdomain } from "./schema";

export const EXAMPLES_DIR = "exemplos-ddd";

export interface ExampleFile {
  /** nome do arquivo sem extensão; é também o slug do título (o app cria o arquivo a partir do título) */
  file: string;
  title: string;
  mode: DocMode;
  ops: Op[];
  /** layout aplicado ao final */
  layout: "timeline" | "flow";
}
export interface DddExample {
  id: string;
  title: string;
  level: "iniciante" | "intermediário" | "avançado";
  summary: string;
  /** conceitos de DDD que o exemplo ilustra */
  teaches: string[];
  files: ExampleFile[];
}

/** Caminho do diagrama dentro do cofre (o mesmo no app e na pasta `examples/`). */
export const examplePath = (ex: Pick<DddExample, "id">, file: string) => `${EXAMPLES_DIR}/${ex.id}/${file}.archflow.json`;

/* ───────── helpers de autoria ───────── */

const ctx = (id: string, label: string, subdomain: Subdomain, description: string): Op => ({ op: "add_group", id, label, kind: "context", subdomain, description });
const dn = (ctxId: string, id: string, label: string, ddd: DddNodeSpec, description?: string): Op => ({ op: "add_node", id, label, parent: ctxId, ddd, ...(description ? { description } : {}) });
const actor = (ctxId: string, id: string, label: string): Op => ({ op: "add_node", id, label, kind: "actor", parent: ctxId });
const rel = (from: string, to: string, r: DddRel, label?: string): Op => ({ op: "add_connection", from, to, ddd: { rel: r }, ...(label ? { label } : {}) });
const runs = (actorId: string, useCase: string): Op => ({ op: "add_connection", from: actorId, to: useCase, type: "association", label: "executa" });
/** Evento publicado por outro contexto, consumido aqui (cópia local; o produtor está em `external`). */
const ext = (ctxId: string, id: string, label: string, from: string, payload?: string): Op => dn(ctxId, id, label, { role: "domain-event", external: from, ...(payload ? { payload } : {}) }, `Publicado por ${from.split(".")[0]}; aqui só reagimos a ele.`);
/** Atalho: command que aciona um aggregate e emite eventos. */
const handle = (cmd: string, aggregate: string, ...events: string[]): Op[] => [rel(cmd, aggregate, "triggers"), ...events.map((e) => rel(cmd, e, "emits"))];
/** Atalho: policy "quando <evento> então <command>". */
const when = (event: string, policy: string, cmd: string): Op[] => [rel(event, policy, "triggers"), rel(policy, cmd, "triggers")];

/** Conexão de fluxo (triggers/emits) com condição, senão, loop ou "para cada". */
const flow = (from: string, to: string, r: "triggers" | "emits", extra: Omit<DddConnSpec, "rel">): Op => ({ op: "add_connection", from, to, ddd: { rel: r, ...extra } });

const relation = (from: string, to: string, pattern: ContextPattern, via: string): Op => ({ op: "add_connection", from, to, label: via, ddd: { rel: "context-relation", pattern } });

/** Mapa de contextos: um componente "Outro diagrama" por contexto, ligados por context-relation. */
const overview = (ex: Pick<DddExample, "id">, contexts: { id: string; label: string; file: string }[], relations: Op[]): ExampleFile => ({
  file: "visao-geral",
  title: "Visão geral",
  mode: "domain",
  layout: "flow",
  ops: [
    ...contexts.map((c): Op => ({ op: "add_node", id: c.id, label: c.label, kind: "system", ref: { diagram: examplePath(ex, c.file) } })),
    ...relations,
  ],
});

/* ═════════════════════════════ 1. Biblioteca (iniciante) ═════════════════════════════ */

const biblioteca: DddExample = {
  id: "biblioteca",
  title: "Biblioteca universitária",
  level: "iniciante",
  summary: "O exemplo mais simples: duas áreas do negócio, um aggregate bem delimitado pelas suas invariantes e um evento atravessando de um contexto para o outro.",
  teaches: ["bounded context e linguagem ubíqua", "aggregate definido pela invariante (o Leitor guarda os empréstimos)", "entity × value object", "command → evento", "policy", "domain service", "read model", "context map (customer-supplier)"],
  files: [
    overview({ id: "biblioteca" }, [{ id: "emprestimos", label: "Empréstimos", file: "emprestimos" }, { id: "acervo", label: "Acervo", file: "acervo" }], [relation("emprestimos", "acervo", "customer-supplier", "livro-emprestado · livro-devolvido")]),
    {
      file: "emprestimos",
      title: "Empréstimos",
      mode: "domain",
      layout: "timeline",
      ops: [
        ctx("emprestimos", "Empréstimos", "core", "Quem pode levar o quê, por quanto tempo e o que acontece quando atrasa. É o coração do negócio da biblioteca."),
        actor("emprestimos", "leitor-ator", "Leitor"),
        dn("emprestimos", "emprestar-livro-uc", "Emprestar livro", { role: "use-case", actor: "Leitor", goal: "levar um exemplar para casa" }),
        dn("emprestimos", "renovar-uc", "Renovar empréstimo", { role: "use-case", actor: "Leitor", goal: "ficar mais tempo com o livro" }),
        dn("emprestimos", "devolver-uc", "Devolver livro", { role: "use-case", actor: "Leitor", goal: "devolver o exemplar" }),
        dn("emprestimos", "emprestar-livro", "Emprestar livro", { role: "command", step: 1, intent: "abrir um empréstimo de um exemplar para o leitor" }),
        dn("emprestimos", "renovar-emprestimo", "Renovar empréstimo", { role: "command", step: 2, intent: "estender o prazo de um empréstimo ativo" }),
        dn("emprestimos", "devolver-livro", "Devolver livro", { role: "command", step: 3, intent: "encerrar o empréstimo e liberar o exemplar" }),
        dn("emprestimos", "registrar-multa", "Registrar multa", { role: "command", step: 4, intent: "cobrar o atraso na devolução" }),
        dn("emprestimos", "leitor", "Leitor", { role: "aggregate-root", invariants: ["no máximo 3 empréstimos ativos", "leitor com multa em aberto não pode emprestar", "empréstimo devolvido não pode ser renovado", "no máximo 2 renovações por empréstimo"] }, "O Leitor é o aggregate porque as regras acima precisam ser garantidas juntas, na mesma transação: por isso os empréstimos e as multas moram dentro dele."),
        dn("emprestimos", "emprestimo", "Empréstimo", { role: "entity" }, "Tem identidade (número do empréstimo), mas só existe dentro de um Leitor."),
        dn("emprestimos", "multa", "Multa", { role: "entity" }),
        dn("emprestimos", "prazo", "Prazo", { role: "value-object" }, "Imutável: renovar não altera o prazo, troca por outro."),
        dn("emprestimos", "livro-emprestado", "Livro emprestado", { role: "domain-event", payload: "leitorId, exemplarId, prazo" }),
        dn("emprestimos", "emprestimo-renovado", "Empréstimo renovado", { role: "domain-event", payload: "leitorId, exemplarId, prazo" }),
        dn("emprestimos", "renovacao-negada", "Renovação negada", { role: "domain-event", payload: "leitorId, exemplarId, motivo" }, "O mesmo command pode ter dois desfechos: renovou ou foi negado. Cada desfecho é um evento, e a condição está na conexão."),
        dn("emprestimos", "livro-devolvido", "Livro devolvido", { role: "domain-event", payload: "leitorId, exemplarId, diasDeAtraso" }),
        dn("emprestimos", "multa-registrada", "Multa registrada", { role: "domain-event", payload: "leitorId, valor" }),
        dn("emprestimos", "multar-atraso", "Multar atraso", { role: "policy", intent: "se o livro volta depois do prazo, registra a multa", reactsTo: ["livro-devolvido"], issues: ["registrar-multa"] }),
        dn("emprestimos", "calculadora-de-multa", "Calculadora de multa", { role: "domain-service", intent: "valor da multa a partir dos dias de atraso" }, "Regra de negócio que não pertence ao Leitor nem ao Empréstimo: fica num serviço de domínio puro, sem I/O."),
        dn("emprestimos", "leitor-repo", "Repositório de leitores", { role: "repository", for: "leitor" }),
        dn("emprestimos", "servico-de-emprestimo", "Serviço de empréstimo", { role: "application-service", intent: "carrega o Leitor, aplica o command, grava e publica os eventos" }),
        dn("emprestimos", "emprestimos-ativos", "Empréstimos ativos", { role: "read-model", projectsFrom: ["livro-emprestado", "livro-devolvido"] }, "Tela \"meus empréstimos\": lê só desta projeção, sem carregar o aggregate."),
        runs("leitor-ator", "emprestar-livro-uc"),
        runs("leitor-ator", "renovar-uc"),
        runs("leitor-ator", "devolver-uc"),
        rel("emprestar-livro", "emprestar-livro-uc", "realizes"),
        rel("renovar-emprestimo", "renovar-uc", "realizes"),
        rel("devolver-livro", "devolver-uc", "realizes"),
        ...handle("emprestar-livro", "leitor", "livro-emprestado"),
        rel("renovar-emprestimo", "leitor", "triggers"),
        flow("renovar-emprestimo", "emprestimo-renovado", "emits", { condition: "menos de 2 renovações e empréstimo em dia" }),
        flow("renovar-emprestimo", "renovacao-negada", "emits", { otherwise: true }),
        ...handle("devolver-livro", "leitor", "livro-devolvido"),
        ...handle("registrar-multa", "leitor", "multa-registrada"),
        rel("leitor", "emprestimo", "contains"),
        rel("leitor", "multa", "contains"),
        rel("emprestimo", "prazo", "contains"),
        flow("livro-devolvido", "multar-atraso", "triggers", { condition: "dias de atraso > 0" }),
        rel("multar-atraso", "registrar-multa", "triggers"),
        rel("livro-emprestado", "emprestimos-ativos", "triggers"),
        rel("livro-devolvido", "emprestimos-ativos", "triggers"),
        rel("registrar-multa", "calculadora-de-multa", "uses"),
        rel("servico-de-emprestimo", "leitor-repo", "uses"),
      ],
    },
    {
      file: "acervo",
      title: "Acervo",
      mode: "domain",
      layout: "timeline",
      ops: [
        ctx("acervo", "Acervo", "supporting", "O catálogo: quais livros existem e onde estão os exemplares. Necessário, mas não é o diferencial da biblioteca."),
        actor("acervo", "bibliotecario", "Bibliotecário"),
        dn("acervo", "cadastrar-livro-uc", "Cadastrar livro", { role: "use-case", actor: "Bibliotecário", goal: "incluir um título no catálogo" }),
        dn("acervo", "cadastrar-exemplar-uc", "Cadastrar exemplar", { role: "use-case", actor: "Bibliotecário", goal: "registrar uma cópia física de um título" }),
        dn("acervo", "cadastrar-livro", "Cadastrar livro", { role: "command", step: 1, intent: "incluir um título no catálogo" }),
        dn("acervo", "cadastrar-exemplar", "Cadastrar exemplar", { role: "command", step: 2, intent: "registrar uma cópia física" }),
        dn("acervo", "marcar-emprestado", "Marcar exemplar emprestado", { role: "command", step: 3, intent: "o exemplar saiu da estante" }),
        dn("acervo", "marcar-disponivel", "Marcar exemplar disponível", { role: "command", step: 4, intent: "o exemplar voltou para a estante" }),
        dn("acervo", "livro", "Livro", { role: "aggregate-root", invariants: ["o ISBN é único no catálogo"] }),
        dn("acervo", "isbn", "ISBN", { role: "value-object" }),
        dn("acervo", "exemplar", "Exemplar", { role: "aggregate-root", invariants: ["um exemplar está disponível ou emprestado, nunca os dois"] }, "Um exemplar muda de estado por conta própria; por isso é um aggregate separado do Livro e o referencia só pelo id."),
        dn("acervo", "localizacao", "Localização", { role: "value-object" }),
        dn("acervo", "livro-cadastrado", "Livro cadastrado", { role: "domain-event", payload: "livroId, isbn" }),
        dn("acervo", "exemplar-cadastrado", "Exemplar cadastrado", { role: "domain-event", payload: "exemplarId, livroId" }),
        dn("acervo", "exemplar-emprestado", "Exemplar marcado como emprestado", { role: "domain-event", payload: "exemplarId" }),
        dn("acervo", "exemplar-disponivel", "Exemplar marcado como disponível", { role: "domain-event", payload: "exemplarId" }),
        ext("acervo", "livro-emprestado-ext", "Livro emprestado", "emprestimos.livro-emprestado", "leitorId, exemplarId, prazo"),
        ext("acervo", "livro-devolvido-ext", "Livro devolvido", "emprestimos.livro-devolvido", "leitorId, exemplarId, diasDeAtraso"),
        dn("acervo", "atualizar-ao-emprestar", "Atualizar ao emprestar", { role: "policy", intent: "quando um livro é emprestado, o exemplar sai do acervo", reactsTo: ["livro-emprestado-ext"], issues: ["marcar-emprestado"] }),
        dn("acervo", "atualizar-ao-devolver", "Atualizar ao devolver", { role: "policy", intent: "quando um livro volta, o exemplar fica disponível", reactsTo: ["livro-devolvido-ext"], issues: ["marcar-disponivel"] }),
        dn("acervo", "disponibilidade", "Disponibilidade", { role: "read-model", projectsFrom: ["exemplar-cadastrado", "exemplar-emprestado", "exemplar-disponivel"] }, "Resposta rápida para \"tem esse livro agora?\"."),
        dn("acervo", "livro-repo", "Repositório de livros", { role: "repository", for: "livro" }),
        dn("acervo", "exemplar-repo", "Repositório de exemplares", { role: "repository", for: "exemplar" }),
        runs("bibliotecario", "cadastrar-livro-uc"),
        runs("bibliotecario", "cadastrar-exemplar-uc"),
        rel("cadastrar-livro", "cadastrar-livro-uc", "realizes"),
        rel("cadastrar-exemplar", "cadastrar-exemplar-uc", "realizes"),
        ...handle("cadastrar-livro", "livro", "livro-cadastrado"),
        ...handle("cadastrar-exemplar", "exemplar", "exemplar-cadastrado"),
        ...handle("marcar-emprestado", "exemplar", "exemplar-emprestado"),
        ...handle("marcar-disponivel", "exemplar", "exemplar-disponivel"),
        rel("livro", "isbn", "contains"),
        rel("exemplar", "localizacao", "contains"),
        rel("exemplar", "livro", "references-by-id"),
        ...when("livro-emprestado-ext", "atualizar-ao-emprestar", "marcar-emprestado"),
        ...when("livro-devolvido-ext", "atualizar-ao-devolver", "marcar-disponivel"),
        rel("exemplar-cadastrado", "disponibilidade", "triggers"),
        rel("exemplar-emprestado", "disponibilidade", "triggers"),
        rel("exemplar-disponivel", "disponibilidade", "triggers"),
        rel("cadastrar-livro", "livro-repo", "uses"),
        rel("marcar-emprestado", "exemplar-repo", "uses"),
      ],
    },
  ],
};

/* ═════════════════════════════ 2. Loja online (intermediário) ═════════════════════════════ */

const lojaFiles = (): ExampleFile[] => {
  const ex = { id: "loja" };
  return [
    overview(ex, [{ id: "pedidos", label: "Pedidos", file: "pedidos" }, { id: "pagamentos", label: "Pagamentos", file: "pagamentos" }, { id: "estoque", label: "Estoque", file: "estoque" }], [
      relation("pedidos", "pagamentos", "partnership", "pedido-criado ⇄ pagamento-aprovado / cobranca-desistida"),
      relation("estoque", "pedidos", "customer-supplier", "estoque-reservado · estoque-insuficiente"),
    ]),
    {
      file: "pedidos",
      title: "Pedidos",
      mode: "domain",
      layout: "timeline",
      ops: [
        ctx("pedidos", "Pedidos", "core", "O que o cliente comprou e em que estado está o pedido. É onde a loja se diferencia: a experiência de comprar."),
        actor("pedidos", "cliente", "Cliente"),
        dn("pedidos", "fazer-pedido-uc", "Fazer pedido", { role: "use-case", actor: "Cliente", goal: "comprar os itens do carrinho" }),
        dn("pedidos", "cancelar-pedido-uc", "Cancelar pedido", { role: "use-case", actor: "Cliente", goal: "desistir da compra antes do envio" }),
        dn("pedidos", "acompanhar-uc", "Acompanhar pedido", { role: "use-case", actor: "Cliente", goal: "saber em que etapa está o pedido", realizedBy: ["consulta-de-pedidos"] }),
        dn("pedidos", "criar-pedido", "Criar pedido", { role: "command", step: 1, intent: "registrar o pedido com os itens e o endereço", properties: [{ name: "clienteId", type: "uuid", description: "quem está comprando" }, { name: "itens", type: "Item do pedido[]", description: "o que foi escolhido no carrinho, com a quantidade" }, { name: "endereco", type: "Endereço de entrega", description: "para onde enviar" }] }),
        dn("pedidos", "confirmar-pedido", "Confirmar pedido", { role: "command", step: 2, intent: "pagamento e estoque deram certo" }),
        dn("pedidos", "cancelar-pedido", "Cancelar pedido", { role: "command", step: 3, intent: "encerrar o pedido (a pedido do cliente ou por falha)" }),
        dn("pedidos", "pedido", "Pedido", { role: "aggregate-root", invariants: ["o total é a soma dos itens", "pedido confirmado não aceita novos itens", "pedido cancelado não volta a ser confirmado"], properties: [{ name: "id", type: "uuid", key: true, description: "identifica o pedido em todo o sistema" }, { name: "clienteId", type: "uuid", description: "referência por id ao cliente (outro aggregate)" }, { name: "status", type: "texto", description: "criado, confirmado ou cancelado" }, { name: "total", type: "Dinheiro", description: "soma dos itens; recalculado a cada mudança" }, { name: "criadoEm", type: "data e hora" }, { name: "motivoCancelamento", type: "texto", optional: true, description: "só existe se o pedido foi cancelado" }] }),
        dn("pedidos", "item-do-pedido", "Item do pedido", { role: "entity", invariants: ["quantidade maior que zero"], properties: [{ name: "produtoId", type: "uuid", key: true, description: "o produto comprado; um pedido não repete produto" }, { name: "quantidade", type: "inteiro", description: "quantas unidades" }, { name: "precoUnitario", type: "Dinheiro", description: "preço no momento da compra (não muda se o catálogo mudar)" }] }),
        dn("pedidos", "endereco-de-entrega", "Endereço de entrega", { role: "value-object", properties: [{ name: "logradouro", type: "texto" }, { name: "numero", type: "texto" }, { name: "complemento", type: "texto", optional: true }, { name: "cidade", type: "texto" }, { name: "cep", type: "texto", description: "8 dígitos, validado na criação" }] }),
        dn("pedidos", "dinheiro", "Dinheiro", { role: "value-object", properties: [{ name: "valor", type: "inteiro", description: "em centavos, para evitar erro de arredondamento", example: "1999" }, { name: "moeda", type: "texto", description: "código ISO 4217", example: "BRL" }] }, "Valor + moeda: nunca um número solto."),
        dn("pedidos", "pedido-criado", "Pedido criado", { role: "domain-event", properties: [{ name: "pedidoId", type: "uuid", key: true }, { name: "itens", type: "Item do pedido[]", description: "para o estoque saber o que reservar" }, { name: "total", type: "Dinheiro", description: "para o pagamento saber quanto cobrar" }] }),
        dn("pedidos", "pedido-confirmado", "Pedido confirmado", { role: "domain-event", payload: "pedidoId" }),
        dn("pedidos", "pedido-cancelado", "Pedido cancelado", { role: "domain-event", payload: "pedidoId, motivo" }),
        ext("pedidos", "pagamento-aprovado", "Pagamento aprovado", "pagamentos.pagamento-aprovado", "pedidoId"),
        ext("pedidos", "cobranca-desistida", "Cobrança desistida", "pagamentos.cobranca-desistida", "pedidoId, motivo"),
        ext("pedidos", "estoque-reservado", "Estoque reservado", "estoque.estoque-reservado", "pedidoId"),
        ext("pedidos", "estoque-insuficiente", "Estoque insuficiente", "estoque.estoque-insuficiente", "pedidoId, sku"),
        dn("pedidos", "fluxo-de-checkout", "Fluxo de checkout", { role: "process-manager", intent: "coordena pagamento e estoque: confirma quando os dois dão certo, cancela se algum falhar", reactsTo: ["pedido-criado", "pagamento-aprovado", "cobranca-desistida", "estoque-reservado", "estoque-insuficiente"], issues: ["confirmar-pedido", "cancelar-pedido"], compensates: ["cancelar-pedido"] }, "Saga: uma transação de negócio que atravessa três contextos, sem transação de banco entre eles. Se o pagamento falhar depois de reservar o estoque, o cancelamento dispara a compensação (liberar o estoque)."),
        dn("pedidos", "pedidos-do-cliente", "Pedidos do cliente", { role: "read-model", projectsFrom: ["pedido-criado", "pedido-confirmado", "pedido-cancelado"] }),
        dn("pedidos", "consulta-de-pedidos", "Consulta de pedidos", { role: "application-service", intent: "responde \"como está meu pedido?\" lendo a projeção" }),
        dn("pedidos", "pedido-repo", "Repositório de pedidos", { role: "repository", for: "pedido" }),
        { op: "add_node", id: "pedidos-api", label: "Pedidos API", kind: "system", parent: "pedidos", ref: { diagram: examplePath(ex, "arquitetura"), node: "pedidos-api" }, description: "Onde este contexto roda na arquitetura (ver o diagrama de arquitetura)." },
        runs("cliente", "fazer-pedido-uc"),
        runs("cliente", "cancelar-pedido-uc"),
        runs("cliente", "acompanhar-uc"),
        rel("criar-pedido", "fazer-pedido-uc", "realizes"),
        rel("cancelar-pedido", "cancelar-pedido-uc", "realizes"),
        rel("consulta-de-pedidos", "acompanhar-uc", "realizes"),
        ...handle("criar-pedido", "pedido", "pedido-criado"),
        ...handle("confirmar-pedido", "pedido", "pedido-confirmado"),
        ...handle("cancelar-pedido", "pedido", "pedido-cancelado"),
        rel("pedido", "item-do-pedido", "contains"),
        rel("pedido", "endereco-de-entrega", "contains"),
        rel("pedido", "dinheiro", "contains"),
        ...["pedido-criado", "pagamento-aprovado", "cobranca-desistida", "estoque-reservado", "estoque-insuficiente"].map((e) => rel(e, "fluxo-de-checkout", "triggers")),
        rel("fluxo-de-checkout", "confirmar-pedido", "triggers"),
        rel("fluxo-de-checkout", "cancelar-pedido", "triggers"),
        rel("pedido-criado", "pedidos-do-cliente", "triggers"),
        rel("pedido-confirmado", "pedidos-do-cliente", "triggers"),
        rel("pedido-cancelado", "pedidos-do-cliente", "triggers"),
        rel("criar-pedido", "pedido-repo", "uses"),
        { op: "add_connection", from: "pedidos-api", to: "pedido", type: "association", label: "implementado por" },
      ],
    },
    {
      file: "pagamentos",
      title: "Pagamentos",
      mode: "domain",
      layout: "timeline",
      ops: [
        ctx("pagamentos", "Pagamentos", "generic", "Cobrar e saber se o dinheiro entrou. É um problema comum de mercado: o modelo é simples e o esforço vai para a integração com o gateway."),
        actor("pagamentos", "sistema-de-pedidos", "Sistema de pedidos"),
        dn("pagamentos", "pagar-pedido-uc", "Pagar pedido", { role: "use-case", actor: "Sistema de pedidos", goal: "receber o valor de um pedido criado" }),
        ext("pagamentos", "pedido-criado", "Pedido criado", "pedidos.pedido-criado", "pedidoId, total"),
        dn("pagamentos", "cobrar-ao-criar-pedido", "Cobrar ao criar pedido", { role: "policy", intent: "todo pedido criado gera uma cobrança", reactsTo: ["pedido-criado"], issues: ["cobrar"] }),
        dn("pagamentos", "cobrar", "Cobrar", { role: "command", step: 1, intent: "iniciar a cobrança no gateway" }),
        dn("pagamentos", "registrar-aprovacao", "Registrar aprovação", { role: "command", step: 2, intent: "o gateway confirmou o pagamento" }),
        dn("pagamentos", "registrar-recusa", "Registrar recusa", { role: "command", step: 3, intent: "o gateway recusou o pagamento" }),
        dn("pagamentos", "pagamento", "Pagamento", { role: "aggregate-root", invariants: ["valor maior que zero", "um pagamento só é aprovado ou recusado uma vez", "no máximo 3 tentativas de cobrança por pedido"] }),
        dn("pagamentos", "valor", "Valor", { role: "value-object" }),
        dn("pagamentos", "cobranca-iniciada", "Cobrança iniciada", { role: "domain-event", payload: "pedidoId, pagamentoId" }),
        dn("pagamentos", "pagamento-aprovado", "Pagamento aprovado", { role: "domain-event", payload: "pedidoId, pagamentoId" }),
        dn("pagamentos", "pagamento-recusado", "Pagamento recusado", { role: "domain-event", payload: "pedidoId, pagamentoId, motivo" }),
        dn("pagamentos", "desistir-da-cobranca", "Desistir da cobrança", { role: "command", step: 4, intent: "encerrar a cobrança depois da última recusa" }),
        dn("pagamentos", "cobranca-desistida", "Cobrança desistida", { role: "domain-event", payload: "pedidoId, pagamentoId, motivo" }),
        dn("pagamentos", "ha-tentativas", "Há tentativas?", { role: "policy", intent: "ainda há tentativas de cobrança para este pedido?" }, "Retentativa: enquanto houver tentativas, cobra de novo (o loop volta ao command Cobrar); esgotadas, desiste e avisa o contexto Pedidos, que cancela o pedido."),
        dn("pagamentos", "tradutor-do-gateway", "Tradutor do gateway", { role: "domain-service", intent: "converte o vocabulário do gateway no nosso" }, "Anticorruption Layer: o modelo do gateway (status, códigos) não entra no nosso domínio, é traduzido aqui."),
        { op: "add_node", id: "gateway-de-pagamento", label: "Gateway de pagamento", kind: "external", parent: "pagamentos", description: "Sistema de terceiros (ex.: Stripe). Não controlamos o modelo dele." },
        dn("pagamentos", "pagamento-repo", "Repositório de pagamentos", { role: "repository", for: "pagamento" }),
        runs("sistema-de-pedidos", "pagar-pedido-uc"),
        rel("cobrar", "pagar-pedido-uc", "realizes"),
        ...when("pedido-criado", "cobrar-ao-criar-pedido", "cobrar"),
        ...handle("cobrar", "pagamento", "cobranca-iniciada"),
        ...handle("registrar-aprovacao", "pagamento", "pagamento-aprovado"),
        ...handle("registrar-recusa", "pagamento", "pagamento-recusado"),
        ...handle("desistir-da-cobranca", "pagamento", "cobranca-desistida"),
        rel("pagamento-recusado", "ha-tentativas", "triggers"),
        flow("ha-tentativas", "cobrar", "triggers", { condition: "tentativas < 3", loop: { until: "pagamento aprovado", max: 3 } }),
        flow("ha-tentativas", "desistir-da-cobranca", "triggers", { otherwise: true }),
        rel("pagamento", "valor", "contains"),
        rel("registrar-aprovacao", "tradutor-do-gateway", "uses"),
        rel("registrar-recusa", "tradutor-do-gateway", "uses"),
        rel("cobrar", "pagamento-repo", "uses"),
        { op: "add_connection", from: "tradutor-do-gateway", to: "gateway-de-pagamento", type: "association", label: "traduz" },
      ],
    },
    {
      file: "estoque",
      title: "Estoque",
      mode: "domain",
      layout: "timeline",
      ops: [
        ctx("estoque", "Estoque", "supporting", "Quanto temos de cada produto e o que já está reservado."),
        actor("estoque", "sistema-de-pedidos", "Sistema de pedidos"),
        dn("estoque", "reservar-itens-uc", "Reservar itens", { role: "use-case", actor: "Sistema de pedidos", goal: "garantir os produtos de um pedido" }),
        ext("estoque", "pedido-criado", "Pedido criado", "pedidos.pedido-criado", "pedidoId, itens"),
        ext("estoque", "pedido-cancelado", "Pedido cancelado", "pedidos.pedido-cancelado", "pedidoId"),
        dn("estoque", "reservar-ao-criar-pedido", "Reservar ao criar pedido", { role: "policy", intent: "pedido criado reserva os itens", reactsTo: ["pedido-criado"], issues: ["reservar-estoque"] }),
        dn("estoque", "liberar-ao-cancelar-pedido", "Liberar ao cancelar pedido", { role: "policy", intent: "pedido cancelado devolve as reservas (compensação da saga)", reactsTo: ["pedido-cancelado"], issues: ["liberar-estoque"] }),
        dn("estoque", "reservar-estoque", "Reservar estoque", { role: "command", step: 1, intent: "separar a quantidade pedida de cada item" }),
        dn("estoque", "liberar-estoque", "Liberar estoque", { role: "command", step: 2, intent: "devolver as reservas de um pedido" }),
        dn("estoque", "item-de-estoque", "Item de estoque", { role: "aggregate-root", invariants: ["a quantidade disponível nunca fica negativa"] }, "Um aggregate por produto (SKU): reservar o pedido inteiro mexe em vários, e é a saga quem cuida da consistência entre eles."),
        dn("estoque", "sku", "SKU", { role: "value-object" }),
        dn("estoque", "estoque-reservado", "Estoque reservado", { role: "domain-event", payload: "pedidoId" }),
        dn("estoque", "estoque-insuficiente", "Estoque insuficiente", { role: "domain-event", payload: "pedidoId, sku" }),
        dn("estoque", "estoque-liberado", "Estoque liberado", { role: "domain-event", payload: "pedidoId" }),
        dn("estoque", "item-de-estoque-repo", "Repositório de estoque", { role: "repository", for: "item-de-estoque" }),
        runs("sistema-de-pedidos", "reservar-itens-uc"),
        rel("reservar-estoque", "reservar-itens-uc", "realizes"),
        ...when("pedido-criado", "reservar-ao-criar-pedido", "reservar-estoque"),
        ...when("pedido-cancelado", "liberar-ao-cancelar-pedido", "liberar-estoque"),
        flow("reservar-estoque", "item-de-estoque", "triggers", { foreach: "item do pedido" }),
        flow("reservar-estoque", "estoque-reservado", "emits", { condition: "todos os itens têm saldo" }),
        flow("reservar-estoque", "estoque-insuficiente", "emits", { otherwise: true }),
        ...handle("liberar-estoque", "item-de-estoque", "estoque-liberado"),
        rel("item-de-estoque", "sku", "contains"),
        rel("reservar-estoque", "item-de-estoque-repo", "uses"),
      ],
    },
    {
      file: "arquitetura",
      title: "Arquitetura",
      mode: "architecture",
      layout: "flow",
      ops: [
        { op: "set_meta", description: "Como os bounded contexts da loja são implementados: um serviço por contexto, cada um com o seu banco, conversando por eventos." },
        { op: "add_group", id: "plataforma", label: "Plataforma da loja", kind: "boundary" },
        { op: "add_node", id: "loja-web", label: "Loja web", asset: "react", description: "Vitrine e checkout" },
        { op: "add_node", id: "pedidos-api", label: "Pedidos API", asset: "nestjs", parent: "plataforma", description: "Implementa o bounded context Pedidos (aggregate Pedido, saga de checkout)" },
        { op: "add_node", id: "pedidos-db", label: "Banco de pedidos", asset: "postgresql", parent: "plataforma" },
        { op: "add_node", id: "pagamentos-api", label: "Pagamentos API", asset: "fastapi", parent: "plataforma", description: "Implementa o bounded context Pagamentos (inclui o tradutor do gateway)" },
        { op: "add_node", id: "pagamentos-db", label: "Banco de pagamentos", asset: "postgresql", parent: "plataforma" },
        { op: "add_node", id: "estoque-api", label: "Estoque API", asset: "spring-boot", parent: "plataforma", description: "Implementa o bounded context Estoque" },
        { op: "add_node", id: "estoque-db", label: "Banco de estoque", asset: "postgresql", parent: "plataforma" },
        { op: "add_node", id: "eventos", label: "Barramento de eventos", asset: "kafka", parent: "plataforma", description: "Os eventos de domínio viajam aqui: pedido-criado, pagamento-aprovado, estoque-reservado…" },
        { op: "add_node", id: "stripe", label: "Stripe", asset: "stripe" },
        { op: "add_connection", from: "loja-web", to: "pedidos-api", type: "sync", label: "POST /pedidos", protocol: "HTTPS/REST" },
        { op: "add_connection", from: "pedidos-api", to: "pedidos-db", type: "data", label: "Pedido (aggregate)" },
        { op: "add_connection", from: "pagamentos-api", to: "pagamentos-db", type: "data", label: "Pagamento (aggregate)" },
        { op: "add_connection", from: "estoque-api", to: "estoque-db", type: "data", label: "Item de estoque (aggregate)" },
        { op: "add_connection", from: "pedidos-api", to: "eventos", type: "async", label: "pedido-criado · pedido-cancelado" },
        { op: "add_connection", from: "eventos", to: "pagamentos-api", type: "async", label: "pedido-criado" },
        { op: "add_connection", from: "eventos", to: "estoque-api", type: "async", label: "pedido-criado · pedido-cancelado" },
        { op: "add_connection", from: "pagamentos-api", to: "eventos", type: "async", label: "pagamento-aprovado · cobranca-desistida" },
        { op: "add_connection", from: "estoque-api", to: "eventos", type: "async", label: "estoque-reservado · estoque-insuficiente" },
        { op: "add_connection", from: "eventos", to: "pedidos-api", type: "async", label: "eventos de pagamento e estoque (saga)" },
        { op: "add_connection", from: "pagamentos-api", to: "stripe", type: "sync", label: "cobrança (via tradutor)", protocol: "HTTPS" },
      ],
    },
  ];
};

const loja: DddExample = {
  id: "loja",
  title: "Loja online",
  level: "intermediário",
  summary: "Três contextos que conversam por eventos: uma saga coordena pagamento e estoque, o gateway de pagamento fica atrás de uma camada anticorrupção e o diagrama de arquitetura mostra onde cada contexto roda.",
  teaches: ["context map (partnership, customer-supplier)", "saga / process manager com compensação", "decisão com loop (retentativa) e condição nos ramos", "iteração (para cada item)", "anticorruption layer", "eventos entre contextos", "subdomínios core, supporting e generic", "read model (CQRS)", "do domínio (micro) à arquitetura (macro)"],
  files: lojaFiles(),
};

/* ═════════════════════════════ 3. Banco (avançado) ═════════════════════════════ */

const bancoFiles = (): ExampleFile[] => {
  const ex = { id: "banco" };
  return [
    overview(ex, [{ id: "contas", label: "Contas", file: "contas" }, { id: "antifraude", label: "Antifraude", file: "antifraude" }, { id: "notificacoes", label: "Notificações", file: "notificacoes" }], [
      relation("contas", "antifraude", "partnership", "transferencia-solicitada ⇄ transferencia-liberada/suspeita"),
      relation("contas", "notificacoes", "published-language", "eventos de conta em formato publicado"),
    ]),
    {
      file: "contas",
      title: "Contas",
      mode: "domain",
      layout: "timeline",
      ops: [
        ctx("contas", "Contas", "core", "Saldo, depósitos, saques e transferências. Errar aqui é perder dinheiro de cliente."),
        actor("contas", "correntista", "Correntista"),
        dn("contas", "transferir-uc", "Transferir dinheiro", { role: "use-case", actor: "Correntista", goal: "enviar dinheiro para outra conta" }),
        dn("contas", "depositar-uc", "Depositar", { role: "use-case", actor: "Correntista", goal: "colocar dinheiro na conta" }),
        dn("contas", "solicitar-transferencia", "Solicitar transferência", { role: "command", step: 1, intent: "registrar o pedido de transferência" }),
        dn("contas", "debitar-origem", "Debitar origem", { role: "command", step: 2, intent: "tirar o valor da conta de origem" }),
        dn("contas", "creditar-destino", "Creditar destino", { role: "command", step: 3, intent: "colocar o valor na conta de destino" }),
        dn("contas", "estornar-debito", "Estornar débito", { role: "command", step: 4, intent: "devolver o valor à origem (compensação)" }),
        dn("contas", "concluir-transferencia", "Concluir transferência", { role: "command", step: 5, intent: "marcar a transferência como feita" }),
        dn("contas", "falhar-transferencia", "Falhar transferência", { role: "command", step: 6, intent: "marcar a transferência como não realizada" }),
        dn("contas", "depositar", "Depositar", { role: "command", step: 7, intent: "creditar um depósito" }),
        dn("contas", "conta", "Conta", { role: "aggregate-root", invariants: ["o saldo nunca fica abaixo de menos o limite", "cada lançamento tem valor diferente de zero", "uma operação por vez por conta (controle de versão)"] }, "Uma transação de banco mexe em UMA conta. Mover dinheiro entre duas contas são duas transações, coordenadas pela saga."),
        dn("contas", "lancamento", "Lançamento", { role: "entity" }, "O extrato: cada débito ou crédito é um lançamento da conta."),
        dn("contas", "dinheiro", "Dinheiro", { role: "value-object" }),
        dn("contas", "transferencia", "Transferência", { role: "aggregate-root", invariants: ["origem e destino são contas diferentes", "valor maior que zero", "só vai de solicitada para concluída ou falhou"] }, "O acompanhamento da transferência é um aggregate próprio: a saga o consulta e o altera, em vez de segurar o estado na memória."),
        dn("contas", "transferencia-solicitada", "Transferência solicitada", { role: "domain-event", payload: "transferenciaId, origem, destino, valor" }),
        dn("contas", "origem-debitada", "Origem debitada", { role: "domain-event", payload: "transferenciaId, origem, valor" }),
        dn("contas", "destino-creditado", "Destino creditado", { role: "domain-event", payload: "transferenciaId, destino, valor" }),
        dn("contas", "debito-estornado", "Débito estornado", { role: "domain-event", payload: "transferenciaId, origem, valor" }),
        dn("contas", "transferencia-concluida", "Transferência concluída", { role: "domain-event", payload: "transferenciaId" }),
        dn("contas", "transferencia-falhou", "Transferência falhou", { role: "domain-event", payload: "transferenciaId, motivo" }),
        dn("contas", "valor-depositado", "Valor depositado", { role: "domain-event", payload: "contaId, valor" }),
        ext("contas", "transferencia-liberada", "Transferência liberada", "antifraude.transferencia-liberada", "transferenciaId"),
        ext("contas", "transferencia-suspeita", "Transferência suspeita", "antifraude.transferencia-suspeita", "transferenciaId, motivo"),
        dn("contas", "fluxo-de-transferencia", "Fluxo de transferência", { role: "process-manager", intent: "solicitada → análise → débito → crédito → conclusão; em qualquer falha, estorna e falha", reactsTo: ["transferencia-solicitada", "transferencia-liberada", "transferencia-suspeita", "origem-debitada", "destino-creditado"], issues: ["debitar-origem", "creditar-destino", "estornar-debito", "concluir-transferencia", "falhar-transferencia"], compensates: ["estornar-debito"] }, "Saga: o débito e o crédito são transações separadas. Se o crédito falhar depois do débito, a compensação (estorno) devolve o dinheiro: consistência eventual, sem transação distribuída."),
        dn("contas", "politica-de-tarifa", "Política de tarifa", { role: "domain-service", intent: "tarifa de uma transferência conforme o tipo de conta" }),
        dn("contas", "conta-repo", "Repositório de contas", { role: "repository", for: "conta" }),
        dn("contas", "transferencia-repo", "Repositório de transferências", { role: "repository", for: "transferencia" }),
        runs("correntista", "transferir-uc"),
        runs("correntista", "depositar-uc"),
        rel("solicitar-transferencia", "transferir-uc", "realizes"),
        rel("depositar", "depositar-uc", "realizes"),
        ...handle("solicitar-transferencia", "transferencia", "transferencia-solicitada"),
        ...handle("debitar-origem", "conta", "origem-debitada"),
        ...handle("creditar-destino", "conta", "destino-creditado"),
        ...handle("estornar-debito", "conta", "debito-estornado"),
        ...handle("concluir-transferencia", "transferencia", "transferencia-concluida"),
        ...handle("falhar-transferencia", "transferencia", "transferencia-falhou"),
        ...handle("depositar", "conta", "valor-depositado"),
        rel("conta", "lancamento", "contains"),
        rel("conta", "dinheiro", "contains"),
        rel("transferencia", "dinheiro", "contains"),
        rel("transferencia", "conta", "references-by-id", "origem e destino por id"),
        ...["transferencia-solicitada", "transferencia-liberada", "transferencia-suspeita", "origem-debitada", "destino-creditado"].map((e) => rel(e, "fluxo-de-transferencia", "triggers")),
        ...["debitar-origem", "creditar-destino", "estornar-debito", "concluir-transferencia", "falhar-transferencia"].map((c) => rel("fluxo-de-transferencia", c, "triggers")),
        rel("solicitar-transferencia", "politica-de-tarifa", "uses"),
        rel("debitar-origem", "conta-repo", "uses"),
        rel("solicitar-transferencia", "transferencia-repo", "uses"),
      ],
    },
    {
      file: "antifraude",
      title: "Antifraude",
      mode: "domain",
      layout: "timeline",
      ops: [
        ctx("antifraude", "Antifraude", "supporting", "Decide se uma transferência parece legítima. Evolui no ritmo das fraudes, não do produto."),
        actor("antifraude", "analista", "Analista de risco"),
        dn("antifraude", "analisar-uc", "Analisar transferência", { role: "use-case", actor: "Analista de risco", goal: "liberar ou suspender uma transferência" }),
        ext("antifraude", "transferencia-solicitada", "Transferência solicitada", "contas.transferencia-solicitada", "transferenciaId, origem, destino, valor"),
        dn("antifraude", "analisar-ao-solicitar", "Analisar ao solicitar", { role: "policy", intent: "toda transferência solicitada passa pela análise", reactsTo: ["transferencia-solicitada"], issues: ["analisar-transferencia"] }),
        dn("antifraude", "analisar-transferencia", "Analisar transferência", { role: "command", step: 1, intent: "aplicar as regras de risco" }),
        dn("antifraude", "analise", "Análise", { role: "aggregate-root", invariants: ["uma transferência tem uma única análise", "decisão tomada não muda"] }),
        dn("antifraude", "pontuacao-de-risco", "Pontuação de risco", { role: "value-object" }),
        dn("antifraude", "transferencia-liberada", "Transferência liberada", { role: "domain-event", payload: "transferenciaId" }),
        dn("antifraude", "transferencia-suspeita", "Transferência suspeita", { role: "domain-event", payload: "transferenciaId, motivo" }),
        dn("antifraude", "regras-de-risco", "Regras de risco", { role: "domain-service", intent: "calcula a pontuação a partir do histórico e do valor" }),
        dn("antifraude", "analise-repo", "Repositório de análises", { role: "repository", for: "analise" }),
        runs("analista", "analisar-uc"),
        rel("analisar-transferencia", "analisar-uc", "realizes"),
        ...when("transferencia-solicitada", "analisar-ao-solicitar", "analisar-transferencia"),
        ...handle("analisar-transferencia", "analise", "transferencia-liberada", "transferencia-suspeita"),
        rel("analise", "pontuacao-de-risco", "contains"),
        rel("analisar-transferencia", "regras-de-risco", "uses"),
        rel("analisar-transferencia", "analise-repo", "uses"),
      ],
    },
    {
      file: "notificacoes",
      title: "Notificações",
      mode: "domain",
      layout: "timeline",
      ops: [
        ctx("notificacoes", "Notificações", "generic", "Avisar o cliente por e-mail ou push. Problema genérico: poderia ser um serviço de mercado."),
        actor("notificacoes", "cliente", "Cliente"),
        dn("notificacoes", "ser-avisado-uc", "Ser avisado de movimentações", { role: "use-case", actor: "Cliente", goal: "saber o que aconteceu na conta" }),
        ext("notificacoes", "transferencia-concluida", "Transferência concluída", "contas.transferencia-concluida", "transferenciaId"),
        ext("notificacoes", "transferencia-falhou", "Transferência falhou", "contas.transferencia-falhou", "transferenciaId, motivo"),
        dn("notificacoes", "avisar-conclusao", "Avisar conclusão", { role: "policy", intent: "transferência concluída gera aviso", reactsTo: ["transferencia-concluida"], issues: ["enviar-notificacao"] }),
        dn("notificacoes", "avisar-falha", "Avisar falha", { role: "policy", intent: "transferência que falhou gera aviso", reactsTo: ["transferencia-falhou"], issues: ["enviar-notificacao"] }),
        dn("notificacoes", "enviar-notificacao", "Enviar notificação", { role: "command", step: 1, intent: "mandar a mensagem pelo canal do cliente" }),
        dn("notificacoes", "notificacao", "Notificação", { role: "aggregate-root", invariants: ["uma notificação é enviada no máximo uma vez"] }),
        dn("notificacoes", "canal", "Canal", { role: "value-object" }),
        dn("notificacoes", "notificacao-enviada", "Notificação enviada", { role: "domain-event", payload: "notificacaoId, canal" }),
        dn("notificacoes", "notificacao-repo", "Repositório de notificações", { role: "repository", for: "notificacao" }),
        runs("cliente", "ser-avisado-uc"),
        rel("enviar-notificacao", "ser-avisado-uc", "realizes"),
        ...when("transferencia-concluida", "avisar-conclusao", "enviar-notificacao"),
        ...when("transferencia-falhou", "avisar-falha", "enviar-notificacao"),
        ...handle("enviar-notificacao", "notificacao", "notificacao-enviada"),
        rel("notificacao", "canal", "contains"),
        rel("enviar-notificacao", "notificacao-repo", "uses"),
      ],
    },
  ];
};

const banco: DddExample = {
  id: "banco",
  title: "Banco digital",
  level: "avançado",
  summary: "Dinheiro exige rigor: um aggregate por transação, consistência eventual entre contas e uma saga que desfaz o que já foi feito quando algo falha no meio do caminho.",
  teaches: ["um aggregate por transação", "consistência eventual", "saga com compensação (estorno)", "aggregate para acompanhar um processo (Transferência)", "referência entre aggregates só por id", "published language e partnership no context map", "domain service"],
  files: bancoFiles(),
};

/* ═════════════════════════════ 4. Clínica (intermediário) ═════════════════════════════ */

const clinicaFiles = (): ExampleFile[] => {
  const ex = { id: "clinica" };
  return [
    overview(ex, [{ id: "agenda", label: "Agenda", file: "agenda" }, { id: "prontuario", label: "Prontuário", file: "prontuario" }, { id: "faturamento", label: "Faturamento", file: "faturamento" }], [
      relation("agenda", "prontuario", "shared-kernel", "identidade do paciente"),
      relation("agenda", "faturamento", "customer-supplier", "consulta-realizada"),
    ]),
    {
      file: "agenda",
      title: "Agenda",
      mode: "domain",
      layout: "timeline",
      ops: [
        ctx("agenda", "Agenda", "core", "Quando cada profissional atende quem. Evitar horário duplicado é a regra que mais pesa."),
        actor("agenda", "paciente-ator", "Paciente"),
        actor("agenda", "recepcionista", "Recepcionista"),
        dn("agenda", "agendar-uc", "Agendar consulta", { role: "use-case", actor: "Paciente", goal: "marcar um horário com um profissional" }),
        dn("agenda", "cancelar-uc", "Cancelar consulta", { role: "use-case", actor: "Paciente", goal: "liberar o horário" }),
        dn("agenda", "realizar-uc", "Registrar atendimento realizado", { role: "use-case", actor: "Recepcionista", goal: "confirmar que a consulta aconteceu" }),
        dn("agenda", "agendar-consulta", "Agendar consulta", { role: "command", step: 1, intent: "reservar um horário livre da agenda" }),
        dn("agenda", "cancelar-consulta", "Cancelar consulta", { role: "command", step: 2, intent: "liberar o horário reservado" }),
        dn("agenda", "marcar-consulta-realizada", "Marcar consulta realizada", { role: "command", step: 3, intent: "a consulta aconteceu" }),
        dn("agenda", "agenda-do-profissional", "Agenda do profissional", { role: "aggregate-root", invariants: ["dois horários de um profissional não se sobrepõem", "consulta realizada não pode ser cancelada"] }, "O aggregate é a agenda inteira de um profissional, não a consulta isolada: a regra \"sem sobreposição\" só pode ser garantida olhando todos os horários juntos."),
        dn("agenda", "horario", "Horário", { role: "entity", invariants: ["tem início e fim", "está livre, reservado ou realizado"] }),
        dn("agenda", "paciente", "Paciente (identidade)", { role: "value-object" }, "Shared Kernel com Prontuário: as duas equipes concordam sobre quem é o paciente (id, nome, documento) e mudam isso juntas."),
        dn("agenda", "consulta-agendada", "Consulta agendada", { role: "domain-event", payload: "agendaId, horarioId, pacienteId" }),
        dn("agenda", "consulta-cancelada", "Consulta cancelada", { role: "domain-event", payload: "agendaId, horarioId" }),
        dn("agenda", "consulta-realizada", "Consulta realizada", { role: "domain-event", payload: "agendaId, horarioId, pacienteId, procedimento" }),
        dn("agenda", "agenda-repo", "Repositório de agendas", { role: "repository", for: "agenda-do-profissional" }),
        dn("agenda", "servico-de-agendamento", "Serviço de agendamento", { role: "application-service", intent: "carrega a agenda, aplica o command e publica os eventos" }),
        runs("paciente-ator", "agendar-uc"),
        runs("paciente-ator", "cancelar-uc"),
        runs("recepcionista", "realizar-uc"),
        rel("agendar-consulta", "agendar-uc", "realizes"),
        rel("cancelar-consulta", "cancelar-uc", "realizes"),
        rel("marcar-consulta-realizada", "realizar-uc", "realizes"),
        ...handle("agendar-consulta", "agenda-do-profissional", "consulta-agendada"),
        ...handle("cancelar-consulta", "agenda-do-profissional", "consulta-cancelada"),
        ...handle("marcar-consulta-realizada", "agenda-do-profissional", "consulta-realizada"),
        rel("agenda-do-profissional", "horario", "contains"),
        rel("horario", "paciente", "contains"),
        rel("servico-de-agendamento", "agenda-repo", "uses"),
      ],
    },
    {
      file: "prontuario",
      title: "Prontuário",
      mode: "domain",
      layout: "timeline",
      ops: [
        ctx("prontuario", "Prontuário", "core", "O histórico clínico do paciente. Sigiloso, auditável e com vocabulário próprio da medicina."),
        actor("prontuario", "medico", "Médico"),
        dn("prontuario", "registrar-uc", "Registrar atendimento", { role: "use-case", actor: "Médico", goal: "anotar diagnóstico e conduta" }),
        dn("prontuario", "registrar-atendimento", "Registrar atendimento", { role: "command", step: 1, intent: "incluir um atendimento no prontuário" }),
        dn("prontuario", "corrigir-atendimento", "Corrigir atendimento", { role: "command", step: 2, intent: "retificar um registro (sem apagar o original)" }),
        dn("prontuario", "prontuario-do-paciente", "Prontuário do paciente", { role: "aggregate-root", invariants: ["registro assinado nunca é apagado, só retificado", "todo atendimento tem profissional e data"] }),
        dn("prontuario", "atendimento", "Atendimento", { role: "entity" }),
        dn("prontuario", "diagnostico", "Diagnóstico", { role: "value-object" }),
        dn("prontuario", "paciente", "Paciente (identidade)", { role: "value-object" }, "O mesmo conceito do Shared Kernel com a Agenda."),
        dn("prontuario", "atendimento-registrado", "Atendimento registrado", { role: "domain-event", payload: "prontuarioId, atendimentoId" }),
        dn("prontuario", "atendimento-retificado", "Atendimento retificado", { role: "domain-event", payload: "prontuarioId, atendimentoId" }),
        dn("prontuario", "prontuario-repo", "Repositório de prontuários", { role: "repository", for: "prontuario-do-paciente" }),
        runs("medico", "registrar-uc"),
        rel("registrar-atendimento", "registrar-uc", "realizes"),
        ...handle("registrar-atendimento", "prontuario-do-paciente", "atendimento-registrado"),
        ...handle("corrigir-atendimento", "prontuario-do-paciente", "atendimento-retificado"),
        rel("prontuario-do-paciente", "atendimento", "contains"),
        rel("prontuario-do-paciente", "paciente", "contains"),
        rel("atendimento", "diagnostico", "contains"),
        rel("registrar-atendimento", "prontuario-repo", "uses"),
      ],
    },
    {
      file: "faturamento",
      title: "Faturamento",
      mode: "domain",
      layout: "timeline",
      ops: [
        ctx("faturamento", "Faturamento", "supporting", "Cobrar do convênio ou do paciente o que foi atendido. Linguagem de contabilidade, não de clínica."),
        actor("faturamento", "faturista", "Faturista"),
        dn("faturamento", "faturar-uc", "Faturar consulta", { role: "use-case", actor: "Faturista", goal: "gerar a cobrança de uma consulta realizada" }),
        ext("faturamento", "consulta-realizada", "Consulta realizada", "agenda.consulta-realizada", "agendaId, horarioId, pacienteId, procedimento"),
        dn("faturamento", "faturar-ao-realizar", "Faturar ao realizar", { role: "policy", intent: "toda consulta realizada gera uma guia", reactsTo: ["consulta-realizada"], issues: ["emitir-guia"] }),
        dn("faturamento", "emitir-guia", "Emitir guia", { role: "command", step: 1, intent: "gerar a guia de cobrança do procedimento" }),
        dn("faturamento", "enviar-guia", "Enviar guia", { role: "command", step: 2, intent: "mandar a guia ao convênio" }),
        dn("faturamento", "guia", "Guia", { role: "aggregate-root", invariants: ["valor vem da tabela do convênio na data do atendimento", "guia enviada não pode ser alterada"] }),
        dn("faturamento", "item-da-guia", "Item da guia", { role: "entity" }),
        dn("faturamento", "valor", "Valor", { role: "value-object" }),
        dn("faturamento", "guia-emitida", "Guia emitida", { role: "domain-event", payload: "guiaId, consultaId, valor" }),
        dn("faturamento", "guia-enviada", "Guia enviada", { role: "domain-event", payload: "guiaId, convenio" }),
        dn("faturamento", "tabela-de-precos", "Tabela de preços", { role: "domain-service", intent: "preço de um procedimento conforme o convênio e a data" }),
        dn("faturamento", "guia-repo", "Repositório de guias", { role: "repository", for: "guia" }),
        runs("faturista", "faturar-uc"),
        rel("emitir-guia", "faturar-uc", "realizes"),
        ...when("consulta-realizada", "faturar-ao-realizar", "emitir-guia"),
        ...handle("emitir-guia", "guia", "guia-emitida"),
        ...handle("enviar-guia", "guia", "guia-enviada"),
        rel("guia", "item-da-guia", "contains"),
        rel("item-da-guia", "valor", "contains"),
        rel("emitir-guia", "tabela-de-precos", "uses"),
        rel("emitir-guia", "guia-repo", "uses"),
      ],
    },
  ];
};

const clinica: DddExample = {
  id: "clinica",
  title: "Clínica médica",
  level: "intermediário",
  summary: "Onde traçar a fronteira do aggregate (a agenda, não a consulta), vocabulários diferentes para a mesma pessoa em cada contexto e um Shared Kernel assumido de propósito.",
  teaches: ["escolher o limite do aggregate pela regra de negócio", "linguagem ubíqua diferente em cada contexto (paciente, atendimento, guia)", "shared kernel", "customer-supplier", "entity aninhada", "domain service para regra de preço"],
  files: clinicaFiles(),
};

/* ═════════════════════════════ 5. Delivery de comida (tour completo) ═════════════════════════════ */

/** Propriedade de um campo do modelo (atalho para `properties`). */
const prop = (name: string, type: string, description?: string, extra: { key?: boolean; optional?: boolean; example?: string } = {}): NonNullable<DddNodeSpec["properties"]>[number] => ({ name, type, ...(description ? { description } : {}), ...extra });
const note = (title: string, text: string, variant?: "note" | "text" | "list"): Op => ({ op: "add_note", title, text, x: 0, y: -190, ...(variant ? { variant } : {}) });
/** Ramo de decisão sem condição (usado nas paralelas e nas junções). */
const next = (from: string, to: string): Op => rel(from, to, "triggers");

const deliveryFiles = (): ExampleFile[] => {
  const ex = { id: "delivery" };
  const base = overview(
    ex,
    [
      { id: "pedidos", label: "Pedidos", file: "pedidos" },
      { id: "pagamentos", label: "Pagamentos", file: "pagamentos" },
      { id: "cozinha", label: "Cozinha", file: "cozinha" },
      { id: "entrega", label: "Entrega", file: "entrega" },
      { id: "mapas", label: "Mapas", file: "mapas" },
      { id: "fidelidade", label: "Fidelidade", file: "fidelidade" },
    ],
    [
      relation("pedidos", "pagamentos", "partnership", "pedido-criado ⇄ pagamento-aprovado"),
      relation("cozinha", "pedidos", "customer-supplier", "preparo-recusado"),
      relation("pedidos", "entrega", "conformist", "pedido-confirmado"),
      relation("cozinha", "entrega", "shared-kernel", "pedido-pronto · tempo de preparo"),
      relation("mapas", "entrega", "acl", "rota-calculada"),
      relation("pagamentos", "fidelidade", "ohs", "pagamento-aprovado"),
      relation("pedidos", "fidelidade", "published-language", "eventos de pedido"),
      relation("cozinha", "fidelidade", "separate-ways", "sem integração"),
    ],
  );
  const mapa: ExampleFile = {
    ...base,
    ops: [...base.ops, note("Mapa com os 8 padrões", "partnership: evoluem juntos\ncustomer-supplier: o fornecedor atende o cliente\nconformist: o cliente aceita o modelo do fornecedor\nshared-kernel: núcleo compartilhado\nacl: o cliente traduz o modelo de fora\nohs: serviço aberto para vários\npublished-language: linguagem documentada\nseparate-ways: sem integração", "list")],
  };
  return [
    mapa,
    {
      file: "pedidos",
      title: "Pedidos",
      mode: "domain",
      layout: "timeline",
      ops: [
        ctx("pedidos", "Pedidos", "core", "O que o cliente pediu e em que estado está o pedido. A experiência de pedir é o diferencial do negócio."),
        actor("pedidos", "cliente", "Cliente"),
        dn("pedidos", "fazer-pedido-uc", "Fazer pedido", { role: "use-case", actor: "Cliente", goal: "pedir comida de um restaurante" }),
        dn("pedidos", "cancelar-pedido-uc", "Cancelar pedido", { role: "use-case", actor: "Cliente", goal: "desistir antes do preparo" }),
        dn("pedidos", "acompanhar-uc", "Acompanhar pedido", { role: "use-case", actor: "Cliente", goal: "saber em que etapa está o pedido" }),
        dn("pedidos", "criar-pedido", "Criar pedido", { role: "command", step: 1, intent: "registrar o pedido com os itens e o endereço", properties: [prop("clienteId", "uuid", "quem está pedindo"), prop("restauranteId", "uuid", "de onde vem a comida"), prop("itens", "Item do pedido[]", "o que foi escolhido, com a quantidade"), prop("endereco", "Endereço de entrega", "para onde levar")] }),
        dn("pedidos", "confirmar-pedido", "Confirmar pedido", { role: "command", step: 2, intent: "o pagamento foi aprovado: libera o restaurante e a entrega" }),
        dn("pedidos", "cancelar-pedido", "Cancelar pedido", { role: "command", step: 3, intent: "encerrar o pedido (cliente desistiu ou algo falhou)" }),
        dn("pedidos", "concluir-pedido", "Concluir pedido", { role: "command", step: 4, intent: "a entrega chegou no prazo" }),
        dn("pedidos", "conceder-reembolso", "Conceder reembolso", { role: "command", step: 5, intent: "devolver o valor quando o atraso é grave" }),
        dn("pedidos", "registrar-atraso", "Registrar atraso", { role: "command", step: 6, intent: "anotar a entrega fora do prazo" }),
        dn("pedidos", "pedido", "Pedido", { role: "aggregate-root", invariants: ["o total é a soma dos itens", "pedido confirmado não aceita novos itens", "pedido cancelado não volta a ser confirmado", "todo item é do mesmo restaurante"], properties: [prop("id", "uuid", "identifica o pedido", { key: true }), prop("clienteId", "uuid", "referência por id ao cliente"), prop("status", "texto", "criado, confirmado, concluído ou cancelado"), prop("total", "Dinheiro", "soma dos itens"), prop("promessaDeEntrega", "data e hora", "o prazo combinado com o cliente"), prop("motivoCancelamento", "texto", "só existe se foi cancelado", { optional: true })] }, "O aggregate protege as regras do pedido inteiro: itens, total e estado mudam juntos, numa só transação."),
        dn("pedidos", "item-do-pedido", "Item do pedido", { role: "entity", invariants: ["quantidade maior que zero"], properties: [prop("produtoId", "uuid", "o prato escolhido", { key: true }), prop("quantidade", "inteiro", "quantas unidades"), prop("precoUnitario", "Dinheiro", "preço no momento do pedido"), prop("observacao", "texto", "ex.: sem cebola", { optional: true, example: "sem cebola" })] }),
        dn("pedidos", "endereco-de-entrega", "Endereço de entrega", { role: "value-object", invariants: ["CEP com 8 dígitos"], properties: [prop("logradouro", "texto"), prop("numero", "texto"), prop("complemento", "texto", undefined, { optional: true }), prop("cep", "texto", "8 dígitos", { example: "01310100" })] }),
        dn("pedidos", "dinheiro", "Dinheiro", { role: "value-object", properties: [prop("valor", "inteiro", "em centavos", { example: "4590" }), prop("moeda", "texto", "ISO 4217", { example: "BRL" })] }),
        dn("pedidos", "pedido-criado", "Pedido criado", { role: "domain-event", properties: [prop("pedidoId", "uuid", undefined, { key: true }), prop("total", "Dinheiro", "para o pagamento saber quanto cobrar")] }),
        dn("pedidos", "pedido-confirmado", "Pedido confirmado", { role: "domain-event", payload: "pedidoId, restauranteId, endereco, itens" }),
        dn("pedidos", "pedido-cancelado", "Pedido cancelado", { role: "domain-event", payload: "pedidoId, motivo" }),
        dn("pedidos", "pedido-concluido", "Pedido concluído", { role: "domain-event", payload: "pedidoId" }),
        dn("pedidos", "reembolso-concedido", "Reembolso concedido", { role: "domain-event", payload: "pedidoId, valor" }),
        dn("pedidos", "atraso-registrado", "Atraso registrado", { role: "domain-event", payload: "pedidoId, minutosDeAtraso" }),
        ext("pedidos", "pagamento-aprovado", "Pagamento aprovado", "pagamentos.pagamento-aprovado", "pedidoId"),
        ext("pedidos", "cobranca-desistida", "Cobrança desistida", "pagamentos.cobranca-desistida", "pedidoId, motivo"),
        ext("pedidos", "preparo-recusado", "Preparo recusado", "cozinha.preparo-recusado", "pedidoId, motivo"),
        ext("pedidos", "pedido-entregue", "Pedido entregue", "entrega.pedido-entregue", "pedidoId, minutosDeAtraso"),
        dn("pedidos", "fluxo-do-pedido", "Fluxo do pedido", { role: "process-manager", intent: "confirma quando o pagamento é aprovado; cancela se o pagamento ou o restaurante falharem", reactsTo: ["pedido-criado", "pagamento-aprovado", "cobranca-desistida", "preparo-recusado"], issues: ["confirmar-pedido", "cancelar-pedido"], compensates: ["cancelar-pedido"] }, "Saga: uma transação de negócio que atravessa Pagamentos, Cozinha e Entrega, sem transação de banco entre eles."),
        dn("pedidos", "entregue-no-prazo", "Entregue no prazo?", { role: "policy", intent: "a entrega chegou no prazo? Se atrasou muito, reembolsa; senão registra o atraso" }, "Policy com ramos condicionais: segue um único ramo, o primeiro cuja condição vale; o \"senão\" cobre o resto (aqui, três saídas)."),
        dn("pedidos", "pedidos-do-cliente", "Pedidos do cliente", { role: "read-model", projectsFrom: ["pedido-criado", "pedido-confirmado", "pedido-concluido", "pedido-cancelado"], properties: [prop("pedidoId", "uuid", undefined, { key: true }), prop("restaurante", "texto", "nome, já resolvido para a tela"), prop("status", "texto"), prop("previsao", "data e hora", "quando deve chegar", { optional: true })] }, "Tela \"meus pedidos\": lê só desta projeção, sem carregar o aggregate."),
        dn("pedidos", "consulta-de-pedidos", "Consulta de pedidos", { role: "application-service", intent: "responde \"onde está meu pedido?\" lendo a projeção" }),
        dn("pedidos", "pedido-repo", "Repositório de pedidos", { role: "repository", for: "pedido" }),
        note("Como ler", "A saga confirma ou cancela; depois da entrega, duas decisões em sequência escolhem entre concluir, reembolsar ou só registrar o atraso.", "note"),
        runs("cliente", "fazer-pedido-uc"),
        runs("cliente", "cancelar-pedido-uc"),
        runs("cliente", "acompanhar-uc"),
        rel("criar-pedido", "fazer-pedido-uc", "realizes"),
        rel("cancelar-pedido", "cancelar-pedido-uc", "realizes"),
        rel("consulta-de-pedidos", "acompanhar-uc", "realizes"),
        ...handle("criar-pedido", "pedido", "pedido-criado"),
        ...handle("confirmar-pedido", "pedido", "pedido-confirmado"),
        ...handle("cancelar-pedido", "pedido", "pedido-cancelado"),
        ...handle("concluir-pedido", "pedido", "pedido-concluido"),
        ...handle("conceder-reembolso", "pedido", "reembolso-concedido"),
        ...handle("registrar-atraso", "pedido", "atraso-registrado"),
        rel("pedido", "item-do-pedido", "contains"),
        rel("pedido", "endereco-de-entrega", "contains"),
        rel("pedido", "dinheiro", "contains"),
        ...["pedido-criado", "pagamento-aprovado", "cobranca-desistida", "preparo-recusado"].map((e) => rel(e, "fluxo-do-pedido", "triggers")),
        rel("fluxo-do-pedido", "confirmar-pedido", "triggers"),
        rel("fluxo-do-pedido", "cancelar-pedido", "triggers"),
        rel("pedido-entregue", "entregue-no-prazo", "triggers"),
        flow("entregue-no-prazo", "concluir-pedido", "triggers", { condition: "minutos de atraso = 0" }),
        flow("entregue-no-prazo", "conceder-reembolso", "triggers", { condition: "atraso > 30 minutos" }),
        flow("entregue-no-prazo", "registrar-atraso", "triggers", { otherwise: true }),
        ...["pedido-criado", "pedido-confirmado", "pedido-concluido", "pedido-cancelado"].map((e) => rel(e, "pedidos-do-cliente", "triggers")),
        rel("criar-pedido", "pedido-repo", "uses"),
      ],
    },
    {
      file: "pagamentos",
      title: "Pagamentos",
      mode: "domain",
      layout: "timeline",
      ops: [
        ctx("pagamentos", "Pagamentos", "generic", "Cobrar e saber se o dinheiro entrou. Problema comum de mercado: o esforço vai para integrar o gateway, não para o modelo."),
        actor("pagamentos", "sistema-de-pedidos", "Sistema de pedidos"),
        dn("pagamentos", "pagar-pedido-uc", "Pagar pedido", { role: "use-case", actor: "Sistema de pedidos", goal: "receber o valor de um pedido criado" }),
        ext("pagamentos", "pedido-criado", "Pedido criado", "pedidos.pedido-criado", "pedidoId, total"),
        dn("pagamentos", "cobrar-ao-criar-pedido", "Cobrar ao criar pedido", { role: "policy", intent: "todo pedido criado gera uma cobrança", reactsTo: ["pedido-criado"], issues: ["cobrar"] }),
        dn("pagamentos", "cobrar", "Cobrar", { role: "command", step: 1, intent: "iniciar a cobrança no gateway" }),
        dn("pagamentos", "registrar-aprovacao", "Registrar aprovação", { role: "command", step: 2, intent: "o gateway confirmou o pagamento" }),
        dn("pagamentos", "registrar-recusa", "Registrar recusa", { role: "command", step: 3, intent: "o gateway recusou o pagamento" }),
        dn("pagamentos", "desistir-da-cobranca", "Desistir da cobrança", { role: "command", step: 4, intent: "encerrar depois da última recusa" }),
        dn("pagamentos", "pagamento", "Pagamento", { role: "aggregate-root", invariants: ["valor maior que zero", "aprovado ou recusado uma única vez", "no máximo 3 tentativas por pedido"] }),
        dn("pagamentos", "valor", "Valor", { role: "value-object" }),
        dn("pagamentos", "cobranca-iniciada", "Cobrança iniciada", { role: "domain-event", payload: "pedidoId, pagamentoId" }),
        dn("pagamentos", "pagamento-aprovado", "Pagamento aprovado", { role: "domain-event", payload: "pedidoId, pagamentoId" }),
        dn("pagamentos", "pagamento-recusado", "Pagamento recusado", { role: "domain-event", payload: "pedidoId, pagamentoId, motivo" }),
        dn("pagamentos", "cobranca-desistida", "Cobrança desistida", { role: "domain-event", payload: "pedidoId, motivo" }),
        dn("pagamentos", "ha-tentativas", "Há tentativas?", { role: "policy", intent: "ainda há tentativas de cobrança para este pedido?" }, "Retentativa: o ramo que volta a Cobrar é marcado como loop, com a condição de parada."),
        dn("pagamentos", "tradutor-do-gateway", "Tradutor do gateway", { role: "domain-service", intent: "converte o vocabulário do gateway no nosso" }, "Anticorruption Layer dentro do contexto: o modelo do gateway não entra no domínio."),
        { op: "add_node", id: "gateway-de-pagamento", label: "Gateway de pagamento", kind: "external", parent: "pagamentos", description: "Sistema de terceiros (ex.: Stripe). Não controlamos o modelo dele." },
        dn("pagamentos", "pagamento-repo", "Repositório de pagamentos", { role: "repository", for: "pagamento" }),
        runs("sistema-de-pedidos", "pagar-pedido-uc"),
        rel("cobrar", "pagar-pedido-uc", "realizes"),
        ...when("pedido-criado", "cobrar-ao-criar-pedido", "cobrar"),
        ...handle("cobrar", "pagamento", "cobranca-iniciada"),
        ...handle("registrar-aprovacao", "pagamento", "pagamento-aprovado"),
        ...handle("registrar-recusa", "pagamento", "pagamento-recusado"),
        ...handle("desistir-da-cobranca", "pagamento", "cobranca-desistida"),
        rel("pagamento-recusado", "ha-tentativas", "triggers"),
        flow("ha-tentativas", "cobrar", "triggers", { condition: "tentativas < 3", loop: { until: "pagamento aprovado", max: 3 } }),
        flow("ha-tentativas", "desistir-da-cobranca", "triggers", { otherwise: true }),
        rel("pagamento", "valor", "contains"),
        rel("registrar-aprovacao", "tradutor-do-gateway", "uses"),
        rel("registrar-recusa", "tradutor-do-gateway", "uses"),
        rel("cobrar", "pagamento-repo", "uses"),
        { op: "add_connection", from: "tradutor-do-gateway", to: "gateway-de-pagamento", type: "association", label: "traduz" },
      ],
    },
    {
      file: "cozinha",
      title: "Cozinha",
      mode: "domain",
      layout: "timeline",
      ops: [
        ctx("cozinha", "Cozinha", "core", "O restaurante recebe o pedido, prepara e avisa quando está pronto. Do tempo de preparo depende a promessa de entrega."),
        actor("cozinha", "cozinheiro", "Cozinheiro"),
        dn("cozinha", "preparar-uc", "Preparar pedido", { role: "use-case", actor: "Cozinheiro", goal: "fazer os pratos de um pedido confirmado" }),
        dn("cozinha", "avisar-pronto-uc", "Avisar que está pronto", { role: "use-case", actor: "Cozinheiro", goal: "liberar o pedido para o entregador" }),
        ext("cozinha", "pedido-confirmado", "Pedido confirmado", "pedidos.pedido-confirmado", "pedidoId, itens"),
        dn("cozinha", "ao-confirmar", "O que fazer ao confirmar?", { role: "policy", intent: "o que acontece assim que o pedido é confirmado?" }, "Policy sem condições nos ramos: segue TODOS (aqui, preparar e imprimir a comanda)."),
        dn("cozinha", "iniciar-preparo", "Iniciar preparo", { role: "command", step: 1, intent: "começar os pratos do pedido" }),
        dn("cozinha", "imprimir-comanda", "Imprimir comanda", { role: "command", step: 1, intent: "imprimir a comanda para a bancada" }),
        dn("cozinha", "marcar-pronto", "Marcar pronto", { role: "command", step: 2, intent: "o pedido está embalado e pode sair" }),
        dn("cozinha", "ticket-de-preparo", "Ticket de preparo", { role: "aggregate-root", invariants: ["só vai de recebido para em preparo e depois pronto", "não marca pronto sem todos os itens prontos"], properties: [prop("id", "uuid", undefined, { key: true }), prop("pedidoId", "uuid", "o pedido que originou o ticket"), prop("estado", "texto", "recebido, em preparo ou pronto"), prop("prontoAs", "data e hora", undefined, { optional: true })] }),
        dn("cozinha", "item-de-preparo", "Item de preparo", { role: "entity", properties: [prop("prato", "texto", undefined, { key: true }), prop("quantidade", "inteiro"), prop("pronto", "booleano")] }),
        dn("cozinha", "tempo-de-preparo", "Tempo de preparo", { role: "value-object", properties: [prop("minutos", "inteiro", "estimativa; vira a promessa de entrega", { example: "25" })] }, "Compartilhado com Entrega (Shared Kernel): as duas equipes concordam sobre o que é esse valor e mudam juntas."),
        dn("cozinha", "preparo-iniciado", "Preparo iniciado", { role: "domain-event", payload: "pedidoId, tempoDePreparo" }),
        dn("cozinha", "preparo-recusado", "Preparo recusado", { role: "domain-event", payload: "pedidoId, motivo" }),
        dn("cozinha", "comanda-impressa", "Comanda impressa", { role: "domain-event", payload: "pedidoId" }),
        dn("cozinha", "pedido-pronto", "Pedido pronto", { role: "domain-event", payload: "pedidoId, restauranteId" }),
        dn("cozinha", "estimador-de-preparo", "Estimador de preparo", { role: "domain-service", intent: "estima os minutos conforme os pratos e a fila da cozinha" }),
        dn("cozinha", "ticket-repo", "Repositório de tickets", { role: "repository", for: "ticket-de-preparo" }),
        note("Para fazer", "Escolher decisão paralela quando os ramos são independentes\nUsar \"para cada\" quando o command age em vários itens\nUm command pode ter dois desfechos: condição e senão", "list"),
        runs("cozinheiro", "preparar-uc"),
        runs("cozinheiro", "avisar-pronto-uc"),
        rel("iniciar-preparo", "preparar-uc", "realizes"),
        rel("marcar-pronto", "avisar-pronto-uc", "realizes"),
        rel("pedido-confirmado", "ao-confirmar", "triggers"),
        next("ao-confirmar", "iniciar-preparo"),
        next("ao-confirmar", "imprimir-comanda"),
        flow("iniciar-preparo", "ticket-de-preparo", "triggers", { foreach: "item do pedido" }),
        flow("iniciar-preparo", "preparo-iniciado", "emits", { condition: "há ingredientes de todos os itens" }),
        flow("iniciar-preparo", "preparo-recusado", "emits", { otherwise: true }),
        ...handle("imprimir-comanda", "ticket-de-preparo", "comanda-impressa"),
        ...handle("marcar-pronto", "ticket-de-preparo", "pedido-pronto"),
        rel("ticket-de-preparo", "item-de-preparo", "contains"),
        rel("ticket-de-preparo", "tempo-de-preparo", "contains"),
        rel("iniciar-preparo", "estimador-de-preparo", "uses"),
        rel("iniciar-preparo", "ticket-repo", "uses"),
      ],
    },
    {
      file: "entrega",
      title: "Entrega",
      mode: "domain",
      layout: "timeline",
      ops: [
        ctx("entrega", "Entrega", "core", "Achar um entregador, buscar o pedido e levar até o cliente. Entregar rápido é parte do diferencial."),
        actor("entrega", "entregador-ator", "Entregador"),
        actor("entrega", "cliente-ator", "Cliente"),
        dn("entrega", "buscar-pedido-uc", "Buscar o pedido", { role: "use-case", actor: "Entregador", goal: "retirar o pedido pronto no restaurante" }),
        dn("entrega", "entregar-uc", "Entregar ao cliente", { role: "use-case", actor: "Entregador", goal: "levar o pedido até o endereço" }),
        dn("entrega", "rastrear-uc", "Rastrear entrega", { role: "use-case", actor: "Cliente", goal: "ver onde está o entregador" }),
        ext("entrega", "pedido-confirmado", "Pedido confirmado", "pedidos.pedido-confirmado", "pedidoId, restauranteId, endereco"),
        ext("entrega", "pedido-pronto", "Pedido pronto", "cozinha.pedido-pronto", "pedidoId, restauranteId"),
        ext("entrega", "rota-calculada", "Rota calculada", "mapas.rota-calculada", "pedidoId, distanciaMetros, minutos"),
        dn("entrega", "alocar-ao-confirmar", "Alocar ao confirmar", { role: "policy", intent: "pedido confirmado procura um entregador", reactsTo: ["pedido-confirmado"], issues: ["alocar-entregador"] }),
        dn("entrega", "alocar-entregador", "Alocar entregador", { role: "command", step: 1, intent: "escolher o entregador mais próximo do restaurante" }),
        dn("entrega", "retirar-pedido", "Retirar pedido", { role: "command", step: 2, intent: "o entregador pegou o pedido no restaurante" }),
        dn("entrega", "entregar-pedido", "Entregar pedido", { role: "command", step: 3, intent: "o pedido chegou ao cliente" }),
        dn("entrega", "pronto-e-alocado", "Pronto e alocado?", { role: "process-manager", intent: "o pedido está pronto E há um entregador alocado?", reactsTo: ["pedido-pronto", "entregador-alocado"], issues: ["retirar-pedido"] }, "Saga: espera os DOIS eventos (pedido pronto e entregador alocado) antes de liberar a retirada."),
        dn("entrega", "entrega-agregado", "Entrega", { role: "aggregate-root", invariants: ["uma entrega tem no máximo um entregador", "só é retirada depois de alocada", "só é entregue depois de retirada"], properties: [prop("id", "uuid", undefined, { key: true }), prop("pedidoId", "uuid", "o pedido a entregar"), prop("entregadorId", "uuid", "quem leva (outro aggregate, por id)", { optional: true }), prop("estado", "texto", "aguardando, alocada, retirada ou entregue")] }),
        dn("entrega", "parada", "Parada", { role: "entity", properties: [prop("ordem", "inteiro", undefined, { key: true }), prop("tipo", "texto", "retirada ou entrega"), prop("endereco", "texto")] }),
        dn("entrega", "entregador", "Entregador", { role: "aggregate-root", invariants: ["só leva uma entrega por vez"], properties: [prop("id", "uuid", undefined, { key: true }), prop("nome", "texto"), prop("disponivel", "booleano")] }, "Outro aggregate, com ciclo de vida próprio: a Entrega só o conhece pelo id."),
        dn("entrega", "veiculo", "Veículo", { role: "value-object" }),
        dn("entrega", "entregador-alocado", "Entregador alocado", { role: "domain-event", payload: "entregaId, entregadorId" }),
        dn("entrega", "pedido-retirado", "Pedido retirado", { role: "domain-event", payload: "entregaId, pedidoId" }),
        dn("entrega", "pedido-entregue", "Pedido entregue", { role: "domain-event", payload: "entregaId, pedidoId, minutosDeAtraso" }),
        dn("entrega", "escolhedor-de-entregador", "Escolhedor de entregador", { role: "domain-service", intent: "o entregador livre mais próximo do restaurante" }),
        dn("entrega", "rastreamento", "Rastreamento", { role: "read-model", projectsFrom: ["entregador-alocado", "pedido-retirado", "pedido-entregue", "rota-calculada"], properties: [prop("pedidoId", "uuid", undefined, { key: true }), prop("etapa", "texto", "aguardando, a caminho do restaurante, a caminho do cliente"), prop("minutosRestantes", "inteiro", "vem da rota calculada em Mapas", { optional: true })] }),
        dn("entrega", "consulta-de-rastreamento", "Consulta de rastreamento", { role: "application-service", intent: "mostra a etapa e o tempo restante a partir da projeção" }),
        dn("entrega", "entrega-repo", "Repositório de entregas", { role: "repository", for: "entrega-agregado" }),
        dn("entrega", "entregador-repo", "Repositório de entregadores", { role: "repository", for: "entregador" }),
        note("Junção", "O pedido só sai quando duas coisas já aconteceram: ficou pronto na cozinha e um entregador foi alocado. A ordem em que chegam não importa.", "note"),
        runs("entregador-ator", "buscar-pedido-uc"),
        runs("entregador-ator", "entregar-uc"),
        runs("cliente-ator", "rastrear-uc"),
        rel("retirar-pedido", "buscar-pedido-uc", "realizes"),
        rel("entregar-pedido", "entregar-uc", "realizes"),
        rel("consulta-de-rastreamento", "rastrear-uc", "realizes"),
        ...when("pedido-confirmado", "alocar-ao-confirmar", "alocar-entregador"),
        ...handle("alocar-entregador", "entrega-agregado", "entregador-alocado"),
        ...handle("retirar-pedido", "entrega-agregado", "pedido-retirado"),
        ...handle("entregar-pedido", "entrega-agregado", "pedido-entregue"),
        rel("entregador-alocado", "pronto-e-alocado", "triggers"),
        rel("pedido-pronto", "pronto-e-alocado", "triggers"),
        next("pronto-e-alocado", "retirar-pedido"),
        rel("entrega-agregado", "parada", "contains"),
        rel("entregador", "veiculo", "contains"),
        rel("entrega-agregado", "entregador", "references-by-id", "entregador por id"),
        ...["entregador-alocado", "pedido-retirado", "pedido-entregue", "rota-calculada"].map((e) => rel(e, "rastreamento", "triggers")),
        rel("alocar-entregador", "escolhedor-de-entregador", "uses"),
        rel("alocar-entregador", "entrega-repo", "uses"),
        rel("consulta-de-rastreamento", "entregador-repo", "uses"),
      ],
    },
    {
      file: "mapas",
      title: "Mapas",
      mode: "domain",
      layout: "timeline",
      ops: [
        ctx("mapas", "Mapas", "generic", "Calcular rota e tempo de viagem. Problema genérico: usamos um provedor externo e só guardamos o resultado."),
        actor("mapas", "sistema-de-entrega", "Sistema de entrega"),
        dn("mapas", "calcular-rota-uc", "Calcular rota", { role: "use-case", actor: "Sistema de entrega", goal: "saber distância e tempo entre dois endereços" }),
        dn("mapas", "calcular-rota", "Calcular rota", { role: "command", step: 1, intent: "pedir ao provedor e guardar o resultado" }),
        dn("mapas", "rota", "Rota", { role: "aggregate-root", invariants: ["a distância não é negativa"] }),
        dn("mapas", "distancia", "Distância", { role: "value-object" }),
        dn("mapas", "rota-calculada", "Rota calculada", { role: "domain-event", payload: "pedidoId, distanciaMetros, minutos" }),
        dn("mapas", "rota-repo", "Repositório de rotas", { role: "repository", for: "rota" }),
        { op: "add_node", id: "provedor-de-mapas", label: "Provedor de mapas", kind: "external", parent: "mapas", description: "Serviço de terceiros. O modelo dele é traduzido na fronteira (ACL no mapa de contextos)." },
        runs("sistema-de-entrega", "calcular-rota-uc"),
        rel("calcular-rota", "calcular-rota-uc", "realizes"),
        ...handle("calcular-rota", "rota", "rota-calculada"),
        rel("rota", "distancia", "contains"),
        rel("calcular-rota", "rota-repo", "uses"),
        { op: "add_connection", from: "calcular-rota", to: "provedor-de-mapas", type: "association", label: "consulta" },
      ],
    },
    {
      file: "fidelidade",
      title: "Fidelidade",
      mode: "domain",
      layout: "timeline",
      ops: [
        ctx("fidelidade", "Fidelidade", "supporting", "Pontos por compra e recompensas. Ajuda a reter clientes, mas não é o que diferencia a operação."),
        actor("fidelidade", "cliente", "Cliente"),
        dn("fidelidade", "ganhar-pontos-uc", "Ganhar pontos", { role: "use-case", actor: "Cliente", goal: "acumular pontos a cada pedido pago" }),
        ext("fidelidade", "pagamento-aprovado", "Pagamento aprovado", "pagamentos.pagamento-aprovado", "pedidoId, pagamentoId"),
        dn("fidelidade", "pontuar-ao-pagar", "Pontuar ao pagar", { role: "policy", intent: "pagamento aprovado gera pontos", reactsTo: ["pagamento-aprovado"], issues: ["acumular-pontos"] }),
        dn("fidelidade", "acumular-pontos", "Acumular pontos", { role: "command", step: 1, intent: "creditar pontos na conta do cliente" }),
        dn("fidelidade", "conta-de-pontos", "Conta de pontos", { role: "aggregate-root", invariants: ["o saldo de pontos nunca fica negativo"] }),
        dn("fidelidade", "lancamento-de-pontos", "Lançamento de pontos", { role: "entity", properties: [prop("id", "uuid", undefined, { key: true }), prop("pedidoId", "uuid", "o pedido que gerou os pontos"), prop("pontos", "Pontos")] }),
        dn("fidelidade", "pontos", "Pontos", { role: "value-object", properties: [prop("quantidade", "inteiro", "sempre maior que zero", { example: "46" })] }),
        dn("fidelidade", "pontos-acumulados", "Pontos acumulados", { role: "domain-event", payload: "contaId, pedidoId, pontos" }),
        dn("fidelidade", "saldo-de-pontos", "Saldo de pontos", { role: "read-model", projectsFrom: ["pontos-acumulados"], properties: [prop("clienteId", "uuid", undefined, { key: true }), prop("saldo", "inteiro")] }),
        dn("fidelidade", "conta-repo", "Repositório de contas de pontos", { role: "repository", for: "conta-de-pontos" }),
        runs("cliente", "ganhar-pontos-uc"),
        rel("acumular-pontos", "ganhar-pontos-uc", "realizes"),
        ...when("pagamento-aprovado", "pontuar-ao-pagar", "acumular-pontos"),
        ...handle("acumular-pontos", "conta-de-pontos", "pontos-acumulados"),
        rel("conta-de-pontos", "lancamento-de-pontos", "contains"),
        rel("lancamento-de-pontos", "pontos", "contains"),
        rel("pontos-acumulados", "saldo-de-pontos", "triggers"),
        rel("acumular-pontos", "conta-repo", "uses"),
      ],
    },
  ];
};

const delivery: DddExample = {
  id: "delivery",
  title: "Delivery de comida (tour completo)",
  level: "avançado",
  summary: "O exemplo que usa todos os recursos do modo Domain: seis contextos com os oito padrões do Context Map, saga com compensação, policy com ramos condicionais e em paralelo, saga que espera dois eventos, loop, \"para cada\", propriedades, eventos entre contextos, read models e anotações.",
  teaches: ["os 8 padrões do Context Map", "os 12 papéis do DDD", "policy com ramos condicionais, em paralelo, e saga que espera eventos", "loop com condição de parada", "iteração (para cada) e condição/senão", "saga com compensação", "propriedades de commands, aggregates, entities, value objects, eventos e read models", "aggregates ligados por id", "eventos publicados e consumidos entre contextos", "notas no diagrama"],
  files: deliveryFiles(),
};

export const DDD_EXAMPLES: DddExample[] = [biblioteca, loja, clinica, banco, delivery];

/* ───────── construção ───────── */

/** Documento pronto de um arquivo de exemplo (ops aplicadas + layout). */
export function buildExampleDoc(f: ExampleFile, description?: string): Doc {
  const { doc, results } = applyOps(emptyDoc(f.title, f.mode), [...f.ops, { op: "layout", ...(f.layout === "timeline" ? { style: "timeline" as const } : { direction: "LR" as const, spacing: "spacious" as const }) }]);
  const failed = results.map((r, i) => ({ r, i })).filter((x) => !x.r.ok);
  if (failed.length) throw new Error(`exemplo "${f.title}": ${failed.map((x) => `op #${x.i}: ${x.r.error}`).join("; ")}`);
  if (description && !doc.description) doc.description = description;
  doc.id = `ddd-${slug(f.title)}`;
  return doc;
}

/** Todos os diagramas de um exemplo, com o caminho que terão no cofre. */
export function buildExample(ex: DddExample): { path: string; doc: Doc }[] {
  return ex.files.map((f) => {
    const doc = buildExampleDoc(f, f.file === "visao-geral" ? `${ex.title}: mapa de contextos. ${ex.summary}` : undefined);
    doc.id = `ddd-${ex.id}-${f.file}`; // estável: o mesmo exemplo gera sempre o mesmo arquivo
    return { path: examplePath(ex, f.file), doc };
  });
}

/** Slug do título de um arquivo: o app cria o arquivo a partir do título, então precisa coincidir com `file`. */
export const fileSlug = (f: ExampleFile) => slug(f.title);
