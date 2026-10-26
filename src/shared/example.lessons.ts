/**
 * Aulas dos exemplos: um roteiro de passos sobre o diagrama que o exemplo instala (Arquitetura e Domínio).
 *
 * Diferente das aulas de DDD em TypeScript (`lessons.ts`, que trazem um diagrama e um código próprios), estas explicam um
 * exemplo do catálogo: cada passo acende peças do diagrama e diz o que observar e por quê. Nos exemplos de Domínio, com
 * vários diagramas (o mapa de contextos e um por contexto), cada passo diz em qual diagrama acontece (`file`) e o painel
 * abre esse diagrama ao avançar.
 *
 * O texto é curto de propósito: o diagrama é que ensina, o passo só aponta para onde olhar. Um teste confere que toda
 * peça citada em `focus` existe no diagrama do passo.
 */

export interface ExampleLessonStep {
  title: string;
  /** a explicação (markdown curto) */
  text: string;
  /** ids das peças (componentes, grupos ou contextos) que o passo destaca */
  focus: string[];
  /** diagrama do exemplo onde o passo acontece (o `file` dele); vazio nos exemplos de um diagrama só */
  file?: string;
}

export interface ExampleLesson {
  /** chave do exemplo no catálogo (`architecture:<id>` ou `domain:<id>`) */
  example: string;
  steps: ExampleLessonStep[];
  /** para praticar depois da aula */
  exercises: string[];
}

/* ═════════════════════════════ Arquitetura ═════════════════════════════ */

const lojaOnline: ExampleLesson = {
  example: "architecture:loja-online",
  steps: [
    {
      title: "Como ler o quadro",
      text:
        "Um diagrama de arquitetura responde duas perguntas: **que peças existem** e **quem fala com quem**.\n\n" +
        "Cada cartão é um **componente** (o ícone diz o tipo) e cada seta é uma **conexão**, de quem chama para quem é chamado. Para ler, siga o caminho de um pedido a partir do cliente.",
      focus: [],
    },
    {
      title: "Quem usa e por onde entra",
      text:
        "O **Cliente** usa a **Loja web**, que chama a API sempre pelo **API Gateway**: a porta de entrada única, que autentica e encaminha.\n\n" +
        "Essas setas são **síncronas** (linha cheia): quem chama espera a resposta.",
      focus: ["cliente", "loja-web", "gateway"],
    },
    {
      title: "O serviço: onde mora a regra",
      text:
        "O **Serviço de pedidos** é quem decide: valida o pedido, grava e avisa que ele foi criado. Os outros componentes guardam, entregam ou mostram, mas não decidem.\n\n" +
        "Clique nele para ver a descrição no painel de propriedades.",
      focus: ["pedidos"],
    },
    {
      title: "Dados: banco e cache",
      text:
        "As setas de **acesso a dados** ligam o serviço ao que ele lê e grava. O **Banco de pedidos** é a fonte da verdade.\n\n" +
        "O **Cache de catálogo** é uma cópia rápida para leituras repetidas. Se ele cair, a loja fica mais lenta, mas não errada.",
      focus: ["pedidos", "banco", "cache"],
    },
    {
      title: "Assíncrono: a fila",
      text:
        "A seta **tracejada** é **assíncrona**: o serviço publica *pedido criado* na **Fila de eventos** e responde ao cliente na hora, sem esperar o e-mail.\n\n" +
        "Se o envio de e-mail estiver fora do ar, a mensagem espera na fila e ninguém perde o pedido.",
      focus: ["pedidos", "fila", "email"],
    },
    {
      title: "Dentro e fora do sistema",
      text:
        "O **Serviço de e-mail** é **externo**: um sistema que não é seu e cuja disponibilidade você não controla.\n\n" +
        "É por isso que ele fica atrás da fila: o que você não controla não deve travar o caminho do cliente.",
      focus: ["email"],
    },
  ],
  exercises: [
    "Adicione um serviço de pagamentos chamado pelo Serviço de pedidos e um sistema externo de cartão. A conexão deve ser síncrona ou ir pela fila? Por quê?",
    "Selecione uma conexão e troque o tipo no painel de propriedades: o que muda no desenho e no significado?",
  ],
};

const apiComFila: ExampleLesson = {
  example: "architecture:api-com-fila",
  steps: [
    {
      title: "O problema: trabalho lento no caminho do cliente",
      text:
        "Enviar um e-mail leva segundos e às vezes falha. Se a API esperasse o envio para responder, o cliente esperaria junto, e uma falha do provedor viraria erro na tela.\n\n" +
        "Este exemplo tira o trabalho lento do caminho de quem está esperando.",
      focus: ["usuario", "web", "api"],
    },
    {
      title: "O grupo: o que a equipe opera",
      text:
        "O grupo **Nuvem** marca a fronteira do que a sua equipe opera. Do lado de fora ficam o cliente e o provedor de e-mail.\n\n" +
        "Arrastar um componente para dentro ou para fora de um grupo muda o que o desenho afirma sobre quem cuida dele.",
      focus: ["nuvem"],
    },
    {
      title: "A API grava e responde",
      text:
        "A **API de pedidos** valida, grava no **Banco de pedidos** e lê o catálogo do **Cache**.\n\n" +
        "Os ícones já dizem a tecnologia (NestJS, PostgreSQL, Redis): são assets reais da biblioteca, não caixas genéricas.",
      focus: ["api", "banco", "cache"],
    },
    {
      title: "Publicar em vez de chamar",
      text:
        "Em vez de chamar o provedor de e-mail, a API **publica** *pedido criado* na **Fila de e-mails** (SQS) e responde ao cliente.\n\n" +
        "A seta tracejada diz isso: quem publica não espera ninguém.",
      focus: ["api", "fila"],
    },
    {
      title: "O worker consome no seu ritmo",
      text:
        "O **Worker de e-mails** lê a fila, envia por SMTP e tenta de novo se falhar. Num pico de pedidos as mensagens se acumulam na fila e o worker as consome sem pressa.\n\n" +
        "Precisa de mais vazão? Rode mais workers: a API não muda.",
      focus: ["fila", "worker", "email"],
    },
    {
      title: "De ponta a ponta",
      text:
        "O caminho tem duas metades: **síncrona** até gravar o pedido (o cliente espera) e **assíncrona** depois (ninguém espera).\n\n" +
        "Teste a ideia: se o provedor de e-mail cair, o que o cliente vê? Nada de errado. O pedido foi criado e o e-mail chega quando o provedor voltar.",
      focus: ["usuario", "web", "api", "banco", "fila", "worker", "email"],
    },
  ],
  exercises: [
    "Adicione uma fila de mensagens mortas (DLQ) para os e-mails que falharam três vezes. De onde sai a seta até ela?",
    "Tire o Cache de dentro do grupo Nuvem: o que isso passa a dizer sobre quem opera o Redis?",
  ],
};

const microsservicos: ExampleLesson = {
  example: "architecture:microsservicos",
  steps: [
    {
      title: "Muitas peças pequenas",
      text:
        "Em microsserviços cada serviço tem o seu código, o seu deploy e o seu banco. O grupo **Cluster Kubernetes** mostra onde eles rodam.\n\n" +
        "O ganho é cada equipe mudar o seu serviço sem esperar as outras. O custo é a comunicação entre eles, que é o que o resto do diagrama mostra.",
      focus: ["cluster"],
    },
    {
      title: "Login de fora e uma porta só",
      text:
        "A **Aplicação web** obtém o token no **Auth0** (um sistema externo de login) e chama a API pelo **API Gateway**.\n\n" +
        "O gateway confere o token e encaminha `/pedidos` e `/estoque` ao serviço certo. Só ele recebe tráfego de fora.",
      focus: ["app", "auth", "gateway"],
    },
    {
      title: "Um banco por serviço",
      text:
        "Cada serviço lê e grava **só o seu banco**. O grupo **Dados** reúne os bancos para mostrar a regra: ninguém lê o banco do outro.\n\n" +
        "Por isso o Estoque pode usar MongoDB enquanto os outros usam PostgreSQL, e cada um muda o seu esquema sem combinar com ninguém.",
      focus: ["dados", "pedidos", "pagamentos", "estoque", "db-pedidos", "db-pagamentos", "db-estoque"],
    },
    {
      title: "Eventos no barramento",
      text:
        "O **Serviço de pedidos** não chama o de pagamentos: ele publica *pedido criado* no **Kafka**, e o barramento entrega a quem se inscreveu.\n\n" +
        "Quem publica não conhece quem consome. As setas tracejadas mostram isso.",
      focus: ["pedidos", "bus", "pagamentos"],
    },
    {
      title: "Um sistema externo no meio",
      text:
        "Para cobrar, **Pagamentos** chama o **Stripe** de forma síncrona: precisa da resposta do cartão.\n\n" +
        "O resultado volta para o barramento como evento (*pagamento aprovado*), e o resto do sistema reage a ele.",
      focus: ["pagamentos", "stripe", "bus"],
    },
    {
      title: "A reação em cadeia",
      text:
        "Com o pagamento aprovado, o **Estoque** reserva os itens e **Avisos** fala com o cliente, cada um por conta própria.\n\n" +
        "Um consumidor novo é só uma seta nova saindo do barramento: o Serviço de pedidos nem fica sabendo.",
      focus: ["bus", "estoque", "avisos"],
    },
    {
      title: "O preço da distribuição",
      text:
        "Entre pagar e reservar há um momento em que o sistema está «no meio do caminho». E se o estoque faltar depois de cobrar? Não existe uma transação que desfaça tudo: é preciso um evento de **compensação**.\n\n" +
        "O exemplo de Domínio **Loja online** modela exatamente isso, com uma saga.",
      focus: ["pedidos", "pagamentos", "estoque"],
    },
  ],
  exercises: [
    "Adicione um serviço de recomendações que consome «pedido criado». Quais serviços existentes você precisou mudar?",
    "O estoque falhou depois do pagamento: desenhe o evento de compensação e quem reage a ele.",
  ],
};

const pipelineDeDados: ExampleLesson = {
  example: "architecture:pipeline-de-dados",
  steps: [
    {
      title: "Do clique ao gráfico",
      text:
        "Um pipeline de dados leva o que acontece na aplicação até um painel que alguém lê. O diagrama tem dois lados: a **Origem**, onde os dados nascem, e a **Plataforma de dados**, onde são tratados e guardados.",
      focus: ["origem", "plataforma"],
    },
    {
      title: "Onde os dados nascem",
      text:
        "A **Aplicação** gera eventos de uso (cliques, buscas). O **Banco da aplicação** é o banco do dia a dia: cada mudança nele também vira evento (CDC, captura de mudanças).",
      focus: ["origem", "app", "oltp"],
    },
    {
      title: "Streaming: um fluxo que não para",
      text:
        "As setas de **streaming** não são pedido e resposta: é um fluxo contínuo. O **Kafka** recebe os eventos sem parar e os guarda até serem consumidos.",
      focus: ["app", "oltp", "kafka"],
    },
    {
      title: "Processar: limpar e agregar",
      text:
        "O **Processamento** lê o fluxo, descarta lixo (bots, eventos duplicados) e junta os eventos por sessão. É aqui que dado bruto vira informação.",
      focus: ["kafka", "proc"],
    },
    {
      title: "Guardar bruto e tratado",
      text:
        "O **Data lake** guarda arquivos baratos e duráveis: se a regra de limpeza mudar, dá para reprocessar tudo.\n\n" +
        "O **Data warehouse** guarda tabelas prontas para consulta e recebe uma **carga diária** do lake (seta de acesso a dados).",
      focus: ["proc", "lake", "dw"],
    },
    {
      title: "Quem consome",
      text:
        "A **Pessoa de análise** lê os **Painéis**, que consultam o data warehouse. Ela nunca toca no banco da aplicação, e por isso a análise não deixa a loja lenta.",
      focus: ["dw", "painel", "analista"],
    },
  ],
  exercises: [
    "Uma métrica precisa aparecer em tempo real. Por onde ela passa, sem esperar a carga diária?",
    "Adicione um modelo de machine learning que treina com o data lake. Em qual grupo ele fica?",
  ],
};

/* ═════════════════════════════ Domínio ═════════════════════════════ */

const biblioteca: ExampleLesson = {
  example: "domain:biblioteca",
  steps: [
    {
      file: "visao-geral",
      title: "O mapa de contextos",
      text:
        "Este é o **mapa de contextos**: cada caixa é um **bounded context**, uma parte do negócio com a sua própria linguagem. **Empréstimos** é o coração (core); **Acervo** dá suporte.\n\n" +
        "A seta é uma relação **Customer/Supplier**: Empréstimos fornece os eventos *livro emprestado* e *livro devolvido*, e o Acervo os consome. O botão ↗ de cada contexto abre o diagrama dele.",
      focus: ["emprestimos", "acervo"],
    },
    {
      file: "emprestimos",
      title: "Como ler um contexto",
      text:
        "Dentro do contexto os cartões estão em **raias**, de cima para baixo: quem faz (ator) → o que quer (caso de uso) → o pedido (command) → quem decide (aggregate) → o que aconteceu (evento) → quem reage (policy).\n\n" +
        "Da esquerda para a direita é a ordem do tempo.",
      focus: ["leitor-ator", "emprestar-livro-uc", "renovar-uc", "devolver-uc"],
    },
    {
      file: "emprestimos",
      title: "O aggregate nasce da invariante",
      text:
        "*No máximo 3 empréstimos ativos* e *leitor com multa não empresta*: essas regras só valem olhando **todos** os empréstimos e multas do leitor ao mesmo tempo.\n\n" +
        "Por isso o **Leitor** é a raiz do aggregate e **Empréstimo** e **Multa** são entities dentro dele (setas *contém*). A fronteira vem da regra, não do substantivo.",
      focus: ["leitor", "emprestimo", "multa"],
    },
    {
      file: "emprestimos",
      title: "Entity × value object",
      text:
        "O **Empréstimo** tem identidade (o número dele): continua o mesmo quando muda. O **Prazo** é só um valor: renovar troca o prazo por outro, não altera o antigo.",
      focus: ["emprestimo", "prazo"],
    },
    {
      file: "emprestimos",
      title: "Um command, dois desfechos",
      text:
        "*Renovar empréstimo* emite **Empréstimo renovado** se houver menos de 2 renovações e o empréstimo estiver em dia, e **Renovação negada** no senão.\n\n" +
        "A condição fica escrita na seta: em DDD o resultado de uma regra é um evento, e ele aparece no desenho.",
      focus: ["renovar-emprestimo", "emprestimo-renovado", "renovacao-negada"],
    },
    {
      file: "emprestimos",
      title: "Policy: a multa reage à devolução",
      text:
        "A policy **Multar atraso** reage a *Livro devolvido* (só *se dias de atraso > 0*, como diz a seta) e dispara *Registrar multa*. Assim devolver e multar evoluem separados.\n\n" +
        "O valor sai da **Calculadora de multa**, um domain service: regra pura que não pertence nem ao leitor nem ao empréstimo.",
      focus: ["livro-devolvido", "multar-atraso", "registrar-multa", "calculadora-de-multa"],
    },
    {
      file: "emprestimos",
      title: "Quem orquestra e quem lê",
      text:
        "O **Serviço de empréstimo** só orquestra: carrega o leitor pelo repositório, aplica o command, grava e publica. Nenhuma regra mora nele.\n\n" +
        "Para a tela «meus empréstimos», o read model **Empréstimos ativos** é alimentado pelos eventos, sem carregar o aggregate.",
      focus: ["servico-de-emprestimo", "leitor-repo", "emprestimos-ativos"],
    },
    {
      file: "acervo",
      title: "O outro lado: eventos de fora",
      text:
        "No Acervo, as caixas de cima são **cópias locais** dos eventos publicados por Empréstimos (marcadas como externas).\n\n" +
        "As policies reagem a elas e marcam o exemplar como emprestado ou disponível. Os dois contextos ficam consistentes sem conhecer o código um do outro.",
      focus: ["livro-emprestado-ext", "livro-devolvido-ext", "atualizar-ao-emprestar", "atualizar-ao-devolver"],
    },
    {
      file: "acervo",
      title: "Dois aggregates ligados por id",
      text:
        "**Exemplar** e **Livro** são aggregates separados, ligados por *references-by-id*: o exemplar muda de estado o tempo todo, o livro quase nunca. Juntos, cada empréstimo travaria o cadastro do livro.\n\n" +
        "Entre aggregates, a única ligação que vale é por id.",
      focus: ["exemplar", "livro", "isbn", "localizacao"],
    },
  ],
  exercises: [
    "Tire o Empréstimo de dentro do Leitor e faça dele um aggregate. Que invariante deixa de poder ser garantida?",
    "Gere o código (selo ✓ → aba Código) e veja como o Leitor vira uma classe com os métodos dos commands.",
  ],
};

const clinica: ExampleLesson = {
  example: "domain:clinica",
  steps: [
    {
      file: "visao-geral",
      title: "Três contextos, duas relações",
      text:
        "**Agenda** e **Prontuário** dividem um **Shared Kernel**: a identidade do paciente. A **Agenda** fornece *consulta realizada* ao **Faturamento** (Customer/Supplier).\n\n" +
        "Repare que cada contexto tem o seu próprio modelo de «paciente». Eles só concordam sobre a identidade.",
      focus: ["agenda", "prontuario", "faturamento"],
    },
    {
      file: "agenda",
      title: "O aggregate é a agenda, não a consulta",
      text:
        "*Dois horários do mesmo profissional não se sobrepõem* só pode ser garantido olhando **todos** os horários dele juntos. Por isso a raiz é a **Agenda do profissional**, e o **Horário** é uma entity dentro dela.\n\n" +
        "Se cada consulta fosse um aggregate, dois agendamentos simultâneos poderiam ocupar o mesmo horário.",
      focus: ["agenda-do-profissional", "horario"],
    },
    {
      file: "agenda",
      title: "Três commands, um aggregate",
      text:
        "*Agendar*, *Cancelar* e *Marcar consulta realizada* passam todos pela mesma raiz. É ela quem confere a regra antes de emitir cada evento.",
      focus: ["agendar-consulta", "cancelar-consulta", "marcar-consulta-realizada", "agenda-do-profissional"],
    },
    {
      file: "agenda",
      title: "Shared kernel: o Paciente",
      text:
        "O value object **Paciente (identidade)** existe igual na Agenda e no Prontuário, e as duas equipes o mudam **juntas**.\n\n" +
        "É uma exceção consciente à regra «cada contexto com o seu modelo», que só funciona porque as equipes conversam todo dia.",
      focus: ["paciente"],
    },
    {
      file: "prontuario",
      title: "Paciente quer dizer outra coisa aqui",
      text:
        "No Prontuário o que importa é o histórico clínico: o **Prontuário do paciente** contém os **Atendimentos**, cada um com o seu **Diagnóstico**.\n\n" +
        "A mesma pessoa, outro modelo. É isso que o bounded context protege.",
      focus: ["prontuario-do-paciente", "atendimento", "diagnostico", "paciente"],
    },
    {
      file: "prontuario",
      title: "Nunca apagar, só corrigir",
      text:
        "A invariante *registro assinado nunca é apagado* explica por que existe **Corrigir atendimento** (que emite *Atendimento retificado*) em vez de um «editar».\n\n" +
        "Quando o negócio exige auditoria, o modelo guarda a correção como um fato novo.",
      focus: ["corrigir-atendimento", "atendimento-retificado"],
    },
    {
      file: "faturamento",
      title: "Reagir a um evento de outro contexto",
      text:
        "*Consulta realizada* chega da Agenda (cópia local, externa). A policy **Faturar ao realizar** o transforma no command *Emitir guia*.\n\n" +
        "O Faturamento não pergunta nada à Agenda: só reage ao que ela publicou.",
      focus: ["consulta-realizada", "faturar-ao-realizar", "emitir-guia"],
    },
    {
      file: "faturamento",
      title: "Aninhamento e domain service",
      text:
        "A **Guia** contém **Itens**, e cada item contém um **Valor**: as setas *contém* podem encadear.\n\n" +
        "O preço vem da **Tabela de preços**, um domain service: depende do convênio e da data, e não pertence à guia.",
      focus: ["guia", "item-da-guia", "valor", "tabela-de-precos"],
    },
  ],
  exercises: [
    "Se as equipes de Agenda e Prontuário deixarem de conversar, que padrão do Context Map substitui o Shared Kernel? Mude no mapa.",
    "Modele o atendimento particular (sem convênio) no Faturamento: muda o aggregate ou só o domain service?",
  ],
};

const loja: ExampleLesson = {
  example: "domain:loja",
  steps: [
    {
      file: "visao-geral",
      title: "Sem uma transação que atravesse tudo",
      text:
        "Fazer um pedido exige cobrar, reservar o estoque e confirmar. São três contextos com regras e equipes próprias, e **nenhuma transação de banco atravessa os três**.\n\n" +
        "**Pedidos** e **Pagamentos** são parceiros (os eventos vão e voltam); **Estoque** fornece o resultado da reserva a Pedidos.",
      focus: ["pedidos", "pagamentos", "estoque"],
    },
    {
      file: "pedidos",
      title: "O pedido e o que ele contém",
      text:
        "O **Pedido** é a raiz; **Item do pedido** é uma entity dentro dele; **Endereço de entrega** e **Dinheiro** são value objects.\n\n" +
        "Dinheiro guarda valor e moeda juntos: ninguém soma reais com dólares por engano.",
      focus: ["pedido", "item-do-pedido", "endereco-de-entrega", "dinheiro"],
    },
    {
      file: "pedidos",
      title: "A entrada pela borda",
      text:
        "O **Cliente** envia o pedido ao **Controller de pedidos**, que dispara *Criar pedido*. Nasce o evento **Pedido criado**, e os três contextos reagem a ele.",
      focus: ["cliente", "controller-de-pedidos", "criar-pedido", "pedido-criado"],
    },
    {
      file: "pedidos",
      title: "A saga do checkout",
      text:
        "Os eventos de resposta chegam dos outros contextos (faixa de cima) e alimentam o **Fluxo de checkout**, um *process manager*: ele guarda o estado («já pagou? já reservou?») e decide entre **confirmar** e **cancelar**.\n\n" +
        "Cancelar é a **compensação**: o Estoque reage a *Pedido cancelado* e libera as reservas.",
      focus: ["fluxo-de-checkout", "pagamento-aprovado", "cobranca-desistida", "estoque-reservado", "estoque-insuficiente", "confirmar-pedido", "cancelar-pedido"],
    },
    {
      file: "pagamentos",
      title: "Tentar de novo, com limite",
      text:
        "*Pagamento recusado* alimenta a policy **Há tentativas?**. Se houver menos de 3, ela volta a *Cobrar* (o **loop** está marcado na seta, com a parada escrita); no senão, segue para *Desistir da cobrança*.\n\n" +
        "Pedidos só cancela quando recebe *Cobrança desistida*: quem sabe contar tentativas é Pagamentos.",
      focus: ["pagamento-recusado", "ha-tentativas", "cobrar", "desistir-da-cobranca"],
    },
    {
      file: "pagamentos",
      title: "Anticorruption layer",
      text:
        "O **Tradutor do gateway** é o único que conhece o **Gateway de pagamento** externo: converte o vocabulário de lá no nosso.\n\n" +
        "Trocar de gateway muda só o tradutor. O resto do modelo nem fica sabendo.",
      focus: ["tradutor-do-gateway", "gateway-de-pagamento"],
    },
    {
      file: "estoque",
      title: "Para cada item, dois desfechos",
      text:
        "*Reservar estoque* age **para cada item do pedido** (escrito na seta) e emite *Estoque reservado* se todos têm saldo, ou *Estoque insuficiente* no senão.\n\n" +
        "Cada **Item de estoque** é um aggregate por produto, não um «Estoque» gigante.",
      focus: ["reservar-estoque", "item-de-estoque", "estoque-reservado", "estoque-insuficiente"],
    },
    {
      file: "estoque",
      title: "Compensar: liberar a reserva",
      text:
        "Quando o pedido é cancelado, a policy **Liberar ao cancelar pedido** devolve o que estava reservado. É o caminho de volta que a saga precisa.",
      focus: ["pedido-cancelado", "liberar-ao-cancelar-pedido", "liberar-estoque", "estoque-liberado"],
    },
    {
      file: "arquitetura",
      title: "Do domínio à arquitetura",
      text:
        "Um serviço por contexto, cada um com o seu banco, e um **barramento** carregando os mesmos eventos do modelo. Os rótulos das setas são os nomes dos eventos.\n\n" +
        "No diagrama *Pedidos*, o componente **Pedidos API** aponta para cá: é a ponte entre as duas visões.",
      focus: ["pedidos-api", "pagamentos-api", "estoque-api", "eventos"],
    },
  ],
  exercises: [
    "O pagamento foi aprovado e o estoque faltou: o pedido é cancelado, mas quem devolve o dinheiro? Modele o estorno em Pagamentos.",
    "Adicione um contexto de Entrega que só começa depois de Pedido confirmado. Que relação ele tem com Pedidos no mapa?",
  ],
};

const banco: ExampleLesson = {
  example: "domain:banco",
  steps: [
    {
      file: "visao-geral",
      title: "Três contextos",
      text:
        "**Contas** e **Antifraude** são parceiros (combinam juntos o contrato dos eventos). **Contas** publica os seus eventos num formato estável que **Notificações** consome (Published Language).",
      focus: ["contas", "antifraude", "notificacoes"],
    },
    {
      file: "contas",
      title: "A conta protege o saldo",
      text:
        "A **Conta** é o aggregate que garante *o saldo não passa do limite*. Cada débito e crédito é um **Lançamento** (entity com identidade: o extrato); o saldo é consequência.\n\n" +
        "**Dinheiro** é value object: valor e moeda, imutável.",
      focus: ["conta", "lancamento", "dinheiro"],
    },
    {
      file: "contas",
      title: "Uma transação, um aggregate",
      text:
        "Uma transferência mexe em **duas** contas, que podem estar em servidores diferentes. A regra de ouro: *Debitar origem* mexe numa conta e *Creditar destino* na outra, **nunca as duas na mesma operação**.\n\n" +
        "Quem acompanha o processo é a **Transferência**, outro aggregate, que guarda em que passo está e referencia as contas só por id.",
      focus: ["solicitar-transferencia", "transferencia", "transferencia-solicitada", "conta"],
    },
    {
      file: "contas",
      title: "A saga anda marco a marco",
      text:
        "O **Fluxo de transferência** reage a cada marco e dispara o próximo passo: liberada pelo antifraude → debitar a origem → creditar o destino → concluir.\n\n" +
        "*Transferência liberada* e *Transferência suspeita* chegam do Antifraude (faixa de cima).",
      focus: ["fluxo-de-transferencia", "transferencia-liberada", "transferencia-suspeita", "debitar-origem", "origem-debitada", "creditar-destino", "destino-creditado"],
    },
    {
      file: "contas",
      title: "Compensar em vez de desfazer",
      text:
        "Entre o débito e o crédito o dinheiro está «em trânsito». Se o crédito falhar, a saga dispara **Estornar débito** (a compensação) e **Falhar transferência**.\n\n" +
        "Não há transação distribuída: há um caminho de volta desenhado.",
      focus: ["fluxo-de-transferencia", "estornar-debito", "debito-estornado", "falhar-transferencia", "transferencia-falhou"],
    },
    {
      file: "contas",
      title: "Tarifa: um domain service",
      text:
        "A **Política de tarifa** depende do tipo de conta e não cabe num aggregate só. Por isso é um domain service: regra pura, sem estado.",
      focus: ["politica-de-tarifa"],
    },
    {
      file: "antifraude",
      title: "Antifraude: um parceiro com regras próprias",
      text:
        "O Antifraude reage a *Transferência solicitada*, analisa com as **Regras de risco** e devolve *liberada* ou *suspeita*.\n\n" +
        "Ele evolui no ritmo das fraudes, com equipe própria. Por isso é um contexto e não um pedaço de Contas.",
      focus: ["transferencia-solicitada", "analisar-ao-solicitar", "analisar-transferencia", "analise", "regras-de-risco", "transferencia-liberada", "transferencia-suspeita"],
    },
    {
      file: "notificacoes",
      title: "Consumir a linguagem publicada",
      text:
        "Notificações reage a *Transferência concluída* e *Transferência falhou* e avisa o cliente. Contas nem sabe que ele existe.\n\n" +
        "É isso que a Published Language permite: plugar consumidores novos sem mexer em quem publica.",
      focus: ["transferencia-concluida", "transferencia-falhou", "avisar-conclusao", "avisar-falha", "enviar-notificacao"],
    },
  ],
  exercises: [
    "Adicione um limite diário de transferências. Em qual aggregate mora a regra: Conta ou Transferência?",
    "Plugue um contexto de Contabilidade que lê os eventos publicados por Contas. O que muda em Contas?",
  ],
};

const delivery: ExampleLesson = {
  example: "domain:delivery",
  steps: [
    {
      file: "visao-geral",
      title: "Seis contextos, os 8 padrões",
      text:
        "Este exemplo reúne tudo. No mapa estão os seis contextos e os **8 padrões do Context Map**, um em cada seta. Nos padrões com direção, a origem da seta é o fornecedor (upstream).\n\n" +
        "Passe o mouse em cada seta para ler o padrão e o que viaja por ela.",
      focus: ["pedidos", "pagamentos", "cozinha", "entrega", "mapas", "fidelidade"],
    },
    {
      file: "visao-geral",
      title: "Quem se protege de quem",
      text:
        "**Mapas** fala outra língua: a **Entrega** se protege com uma anticorruption layer. A Entrega aceita o modelo de Pedidos como ele é (**Conformist**). **Cozinha** e **Fidelidade** não se integram (**Separate Ways**).\n\n" +
        "Cada padrão é uma decisão sobre equipes, não só sobre código.",
      focus: ["mapas", "entrega", "pedidos", "cozinha", "fidelidade"],
    },
    {
      file: "pedidos",
      title: "A saga do pedido",
      text:
        "O **Fluxo do pedido** (process manager) espera o pagamento e decide entre **confirmar** e **cancelar**. Se a cozinha recusar o preparo, ele também cancela: é a compensação.",
      focus: ["fluxo-do-pedido", "pedido-criado", "pagamento-aprovado", "cobranca-desistida", "preparo-recusado", "confirmar-pedido", "cancelar-pedido"],
    },
    {
      file: "pedidos",
      title: "Policy com três saídas",
      text:
        "Depois da entrega, **Entregue no prazo?** escolhe o primeiro ramo cuja condição vale: sem atraso → *Concluir pedido*; atraso acima de 30 minutos → *Conceder reembolso*; no senão → *Registrar atraso*.",
      focus: ["pedido-entregue", "entregue-no-prazo", "concluir-pedido", "conceder-reembolso", "registrar-atraso"],
    },
    {
      file: "pagamentos",
      title: "Loop com parada",
      text:
        "Como na Loja online: **Há tentativas?** volta a *Cobrar* até 3 vezes (o loop marcado na seta) e, esgotadas, desiste. O **Tradutor do gateway** isola o gateway externo.",
      focus: ["pagamento-recusado", "ha-tentativas", "cobrar", "desistir-da-cobranca", "tradutor-do-gateway"],
    },
    {
      file: "cozinha",
      title: "Ramos em paralelo",
      text:
        "Ao confirmar o pedido, a policy **O que fazer ao confirmar?** dispara *Iniciar preparo* **e** *Imprimir comanda* ao mesmo tempo: ramos sem condição andam juntos.",
      focus: ["pedido-confirmado", "ao-confirmar", "iniciar-preparo", "imprimir-comanda"],
    },
    {
      file: "cozinha",
      title: "Para cada item, condição e senão",
      text:
        "*Iniciar preparo* age em cada item do pedido e emite *Preparo iniciado* se há ingredientes de todos, ou *Preparo recusado* no senão. A recusa volta para a saga do Pedidos.",
      focus: ["iniciar-preparo", "ticket-de-preparo", "preparo-iniciado", "preparo-recusado"],
    },
    {
      file: "entrega",
      title: "Esperar dois eventos",
      text:
        "A retirada só pode acontecer quando o pedido está pronto **e** há entregador alocado. A saga **Pronto e alocado?** espera os dois eventos (a junção) e só então dispara *Retirar pedido*.",
      focus: ["entregador-alocado", "pedido-pronto", "pronto-e-alocado", "retirar-pedido"],
    },
    {
      file: "entrega",
      title: "Aggregates por id e um read model",
      text:
        "A **Entrega** referencia o **Entregador** por id: são aggregates separados. Quem escolhe o entregador é um domain service (**Escolhedor de entregador**).\n\n" +
        "O cliente acompanha pelo read model **Rastreamento**.",
      focus: ["entrega-agregado", "entregador", "escolhedor-de-entregador", "rastreamento"],
    },
    {
      file: "mapas",
      title: "Um provedor externo atrás da fronteira",
      text:
        "Mapas consulta o **Provedor de mapas** externo e publica *Rota calculada* na linguagem do nosso negócio. Do lado da Entrega, ninguém conhece o provedor.",
      focus: ["calcular-rota", "provedor-de-mapas", "rota-calculada"],
    },
    {
      file: "fidelidade",
      title: "Um consumidor que chega depois",
      text:
        "Fidelidade reage a *Pagamento aprovado* e acumula pontos na **Conta de pontos**. Foi plugada sem mudar Pagamentos, que expõe os eventos como um serviço aberto (Open Host Service).",
      focus: ["pagamento-aprovado", "pontuar-ao-pagar", "acumular-pontos", "conta-de-pontos", "saldo-de-pontos"],
    },
  ],
  exercises: [
    "Siga o caminho feliz, contexto por contexto: criar o pedido → pagamento aprovado → confirmar → preparo e alocação em paralelo → junção → retirar → entregar → concluir.",
    "Em Entrega, faça a saga «Pronto e alocado?» reagir a um evento só. O que pode dar errado na retirada?",
  ],
};

export const EXAMPLE_LESSONS: ExampleLesson[] = [lojaOnline, apiComFila, microsservicos, pipelineDeDados, biblioteca, clinica, loja, banco, delivery];

export const exampleLessonOf = (key: string): ExampleLesson | undefined => EXAMPLE_LESSONS.find((l) => l.example === key);
