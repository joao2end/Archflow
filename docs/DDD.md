# DDD na prática, com o Archflow

Guia para quem nunca usou DDD (Domain-Driven Design) e quer entender o que ele é, para que serve e como desenhá-lo no modo **Domain** do Archflow. Todos os exemplos citados existem prontos em [`examples/`](../examples/README.md) e dentro do app (botão ✨ do explorador, *Exemplos de DDD*).

> **Em uma frase:** DDD é organizar o software em volta do **vocabulário e das regras do negócio**, dividindo o problema em partes (contextos) em que cada palavra tem um único significado, e protegendo as regras importantes dentro de objetos que não deixam o sistema entrar em estado inválido.

## 1. O problema que o DDD resolve

Sem DDD, o sistema costuma espelhar o banco de dados: tabelas, telas de cadastro, serviços que mudam campos. As regras do negócio ficam espalhadas (um `if` na tela, outro no serviço, outro numa trigger) e cada pessoa entende o sistema de um jeito. Perguntas como *"o que acontece quando um pedido é cancelado depois de pago?"* não têm um lugar único onde a resposta mora.

O DDD ataca isso em duas frentes:

- **Estratégica** (o desenho em grande escala): quais partes o negócio tem, qual delas é a que dá vantagem competitiva, e como as partes conversam. Resultado: **subdomínios**, **bounded contexts** e um **context map**.
- **Tática** (o desenho dentro de uma parte): como representar as regras no código. Resultado: **aggregates**, **entities**, **value objects**, **eventos**, **commands** e companhia.

No Archflow as duas frentes são diagramas: o **mapa de contextos** (visão geral) e um **diagrama por bounded context** (o micro). O diagrama de arquitetura (modo Arch) mostra onde cada contexto roda.

## 2. Estratégico: dividir o problema

### Domínio e subdomínios
O **domínio** é a área de negócio que o software atende (uma loja, uma clínica, um banco). Ele se divide em **subdomínios**, e nem todos valem o mesmo esforço:

| Subdomínio | Pergunta que ajuda | O que fazer | No Archflow |
|---|---|---|---|
| **Core** | "Se fizermos isto muito melhor que os concorrentes, ganhamos clientes?" | Investir: melhor time, modelo rico, código cuidadoso | `subdomain: core` |
| **Supporting** | "É necessário, mas não nos diferencia?" | Fazer simples, sob medida | `subdomain: supporting` |
| **Generic** | "Todo mundo tem esse problema e já existe solução pronta?" | Comprar ou usar pronto (auth, e-mail, pagamento) | `subdomain: generic` |

Exemplos: na **loja**, *Pedidos* é core, *Estoque* é supporting e *Pagamentos* é generic. No **banco**, *Contas* é core e *Notificações* é generic.

### Linguagem ubíqua
É o vocabulário que o time **e** o negócio usam, igual na conversa, nos diagramas e no código. Se a clínica diz "guia" e o código diz `Invoice`, há um tradutor invisível e os erros nascem nele. Regra prática: **os nomes dos elementos do diagrama são os nomes do negócio** (em português, se o negócio fala português). No Archflow, o `label` é a palavra do negócio e o `id` é o slug estável dela; a `description` registra o que a palavra significa *naquele contexto*.

### Bounded context
É a fronteira dentro da qual **cada palavra tem um significado só** e o modelo é consistente. Fora dela, a mesma palavra pode significar outra coisa, e tudo bem. Em uma clínica, "paciente" na *Agenda* é alguém que ocupa um horário; no *Prontuário* é o histórico clínico; no *Faturamento* é o pagador. Tentar um único `Paciente` gigante para os três cria um modelo que ninguém entende.

Sinais de que é hora de separar contextos: a mesma palavra com regras diferentes; equipes diferentes mexendo no mesmo conceito; velocidades de mudança diferentes; um subdomínio core misturado com um genérico.

No Archflow: um **grupo `context`** (com `subdomain`) por diagrama de domínio.

### Context map: como os contextos se relacionam
Contextos conversam, e **como** conversam é uma decisão de desenho. O Archflow registra isso com `context-relation` + `pattern` (convenção: `from` é o **upstream**, quem fornece; `to` é o downstream):

| Padrão | Quando usar | Exemplo |
|---|---|---|
| `customer-supplier` | O downstream depende do upstream e pode influenciar o plano dele | Agenda → Faturamento (clínica) |
| `partnership` | Os dois contextos têm sucesso ou falham juntos e coordenam as mudanças | Pedidos ⇄ Pagamentos (loja) |
| `shared-kernel` | Dois times compartilham, de propósito, um pedaço pequeno do modelo e mudam juntos | Identidade do paciente (clínica) |
| `published-language` | O upstream publica um formato documentado e estável para quem quiser consumir | Contas → Notificações (banco) |
| `ohs` (Open Host Service) | O upstream expõe um serviço aberto para vários consumidores, sem acordos individuais | API pública de catálogo |
| `acl` (Anticorruption Layer) | O downstream **traduz** o modelo do upstream para não se contaminar | Tradutor do gateway de pagamento (loja) |
| `conformist` | O downstream **adota** o modelo do upstream porque não tem poder de negociar | Integração com um sistema legado ou de um governo |
| `separate-ways` | A integração custa mais que o benefício: cada contexto resolve sozinho | Dois módulos que só precisam de um relatório em comum |

## 3. Tático: as peças dentro de um contexto

Cada peça tem um papel (`ddd.role`) no Archflow. A coluna "pergunta" é o teste que mais ajuda a decidir qual usar.

### Aggregate (`aggregate-root`)
Um **grupo de objetos que muda junto** e que precisa respeitar suas **invariantes** (regras que sempre valem) a cada operação. Só a **raiz** (aggregate root) é acessada de fora; ela garante as invariantes do conjunto.

- *Pergunta:* "que regra precisa ser verdadeira **ao mesmo tempo**, na mesma transação?" A resposta desenha a fronteira. Na **biblioteca**, "no máximo 3 empréstimos ativos" exige olhar todos os empréstimos do leitor juntos: por isso o **Leitor** é o aggregate e os empréstimos moram dentro dele. Na **clínica**, "dois horários de um profissional não se sobrepõem" faz da **agenda inteira** o aggregate, não a consulta isolada.
- **Pequeno é melhor.** Aggregate grande trava (todo mundo disputa o mesmo registro) e fica difícil de testar.
- **Uma transação, um aggregate.** Se uma operação parece mexer em dois, ou a fronteira está errada, ou é um fluxo entre aggregates (veja *saga* abaixo). No **banco**, debitar uma conta e creditar outra são **duas** transações.
- **Entre aggregates, só por id** (`references-by-id`), nunca com um objeto dentro do outro.

### Entity (`entity`)
Objeto com **identidade própria** que se mantém ao longo do tempo (o Empréstimo nº 123 continua o mesmo mesmo que o prazo mude). Vive dentro de um aggregate (`contains`).
*Pergunta:* "preciso acompanhar **este** objeto específico ao longo do tempo?"

### Value object (`value-object`)
Valor **imutável**, sem identidade, comparado pelo conteúdo: Dinheiro (valor + moeda), Endereço, Prazo, CPF. Trocar o valor é criar outro.
*Pergunta:* "dois com o mesmo conteúdo são intercambiáveis?" Se sim, é value object. Prefira-os: eles carregam regra (um `Dinheiro` nunca soma moedas diferentes) e eliminam números e textos soltos.

### Domain event (`domain-event`)
Um **fato que já aconteceu** no domínio, no passado: `pedido-criado`, `livro-devolvido`. É como os contextos (e as partes de um mesmo contexto) ficam sabendo do que houve sem se acoplar.
*Pergunta:* "o que o negócio quer saber depois que isto acontece?" O evento tem `payload` (os dados) e um produtor (`emits`). Evento de outro contexto vira uma cópia local com `external: "contexto.evento"`.

### Command (`command`)
Uma **intenção** de mudar o estado, no imperativo: `criar-pedido`, `devolver-livro`. Pode ser recusado (a invariante não deixou); o evento é o que sobra quando dá certo. Cada command é tratado por **um** aggregate (`triggers`) e pode `emits` eventos.
*Pergunta:* "quem pediu o quê?" Command pede, evento relata.

### Policy (`policy`)
Regra **reativa e sem estado**: "**quando** acontecer *X*, **faça** *Y*". Ex.: quando o livro é devolvido, se houve atraso, registre multa. Liga um evento a um command.
*Pergunta:* "esta regra reage a um evento e não precisa lembrar de nada?"

### Process manager / saga (`process-manager`)
Coordena um **fluxo longo** que atravessa aggregates ou contextos, **com estado**, e sabe **compensar** quando um passo falha. Ex.: no checkout, confirmar o pedido só se pagamento **e** estoque deram certo; se um falhar, cancelar e desfazer o outro.
*Pergunta:* "este fluxo tem mais de uma transação e precisa saber o que desfazer?" Isto é como o DDD vive **sem transação distribuída**: a consistência entre aggregates é **eventual**, garantida por eventos e compensações. Veja o fluxo de transferência do exemplo do **banco** (o estorno é a compensação do débito).

### Repository (`repository`)
A **coleção** de aggregates de um tipo: carrega, salva. A interface fica no domínio e a implementação na infraestrutura. É por aggregate-root, nunca por entity. Quem usa é o command/serviço de aplicação (`uses`), não o aggregate.

### Domain service (`domain-service`)
Regra de negócio que **não cabe em nenhum aggregate** (envolve vários ou depende de política externa) e é **pura**, sem I/O. Ex.: calcular multa por dias de atraso; consultar tabela de preços do convênio.

### Application service (`application-service`)
O **orquestrador** de um caso de uso: carrega o aggregate, chama o domínio, salva, publica os eventos. **Sem regra de negócio**: se aparece um `if` de negócio aqui, ele pertence ao domínio.

### Read model (`read-model`)
Uma **projeção para leitura** alimentada por eventos (CQRS): a tela "meus pedidos" lê de uma tabela montada para ela, sem carregar aggregates. Separa quem *escreve* (aggregates, regras) de quem *lê* (rápido, no formato da tela).

### Use case (`use-case`)
O objetivo de um **ator** com o sistema: "Fazer pedido". No Archflow ele liga o requisito ao command que o realiza (`realizes`), e `trace` mostra o caminho completo até o evento. Se um caso de uso não tem caminho, **falta modelo**.

### Anticorruption layer
Uma camada que **traduz** o modelo de fora para o seu. No Archflow aparece como um `domain-service` (ex.: *Tradutor do gateway*) ligado ao sistema externo. É a defesa para o vocabulário de terceiros não vazar para o seu domínio.

### Decisões, condições, loops e iteração (modo Domain)
O DDD não pensa em fluxograma: o fluxo **emerge dos eventos**. A lógica condicional mora no aggregate e na saga, e o diagrama mostra *quem reage a quê*. Mesmo assim, ramos e repetições importam para o negócio, e o Archflow os desenha **só no modo Domain**:

| Necessidade | Como representar | Exemplo |
|---|---|---|
| **Condição** (um ramo só segue se...) | `condition` na conexão `triggers` ou `emits` | `livro-devolvido` → `multar-atraso`: *se dias de atraso > 0* (biblioteca) |
| **Dois desfechos de um command** | duas conexões `emits`: uma com `condition`, outra com `otherwise` (*senão*) | `renovar-emprestimo` emite `emprestimo-renovado` *ou* `renovacao-negada` (biblioteca) |
| **Decisão** (escolher um caminho depois de um fato) | papel `decision`, `gate` exclusiva: cada saída é um ramo com condição, e há um *senão* | `ha-tentativas` depois de `pagamento-recusado` (loja) |
| **Em paralelo** | decisão `parallel`: todos os ramos seguem | notificar e faturar ao mesmo tempo |
| **Esperar vários caminhos** | decisão `join`: só segue quando todas as entradas chegaram | confirmar só com pagamento **e** estoque |
| **Loop / retentativa** | a conexão que **volta** a um passo anterior leva `loop` com `until` (parada) e/ou `max` (tentativas) | `ha-tentativas` → `cobrar`: *repete até pagamento aprovado, máx. 3* (loja) |
| **Iteração** | `foreach` na conexão | `reservar-estoque` → `item-de-estoque`: *para cada item do pedido* (loja) |

Regras que o Archflow aplica: uma decisão tem **2 ou mais ramos** (D024); numa exclusiva cada ramo tem condição ou é o *senão*, e deve haver um *senão* (D025, D026); uma junção precisa de 2+ entradas (D027); um ciclo que passa por uma decisão exige um **loop declarado** (D028) e todo loop tem **condição de parada**, para não virar laço infinito (D029).

*Quando usar o quê?* Se a regra é "quando X acontece, faça Y" sem estado, é uma **policy**. Se o fluxo tem vários passos, estado e compensação, é uma **saga**. Use **decisão** quando o caminho depende de uma condição que vale a pena enxergar no desenho, e **condição na conexão** para o caso simples de um único ramo. A condição é **documentação estruturada**: o Archflow a mostra, valida a forma do fluxo e a leva para o código gerado, mas não a executa.

## 4. Como modelar: dos casos de uso ao modelo

1. **Liste os casos de uso** (ator + objetivo): `add_use_cases` ou arraste *Use Case* da biblioteca.
2. **Descubra os eventos** (Event Storming): "o que acontece no negócio que alguém se importa?" Escreva no passado. Use o layout **linha do tempo** para vê-los em ordem.
3. **Para cada evento, ache o command** que o causa e **quem o decide** (o aggregate).
4. **Defina os aggregates pelas invariantes**, não pelos substantivos: liste as regras "sempre verdadeiras" e agrupe o que precisa mudar junto. Prefira aggregates pequenos.
5. **Ache as policies** ("quando X, então Y") e as **sagas** (fluxos com compensação).
6. **Agrupe em contextos**: onde a linguagem muda, a fronteira passa. Classifique cada contexto (core, supporting, generic).
7. **Desenhe o mapa de contextos** e escolha o padrão de cada relação (a quem pertence o evento? quem manda no modelo?).
8. **Valide e rastreie**: `validate_diagram` (erros D001 a D005 e D008 primeiro) e `trace`. Meta objetiva: `npm run eval:domain` (≥ 90% dos casos de uso rastreados, nenhum erro estrutural).
9. **Gere o esqueleto** (`generate_code`) e implemente a lógica nos TODOs.

## 5. As regras que o Archflow aplica

O modo Domain valida o seu modelo contra as regras de DDD (D001 a D032; a lista completa está em [`DOMAIN_MODE.md`](DOMAIN_MODE.md)). As que mais ensinam:

| Regra | O que o DDD diz |
|---|---|
| D001 | todo caso de uso tem um command que o realiza |
| D002 | todo command é tratado por **um** aggregate |
| D003 | todo evento tem um produtor |
| D004 | entity só existe dentro de **um** aggregate |
| D005 | aggregates se referenciam **só por id** |
| D008 | repository é de aggregate root |
| D018 | uma saga reage a eventos e dispara commands |
| D024 a D032 | decisões têm ramos e condições; loops têm parada; ciclos por decisão exigem loop declarado |

### Regras dos conectores
No modo Domain cada conexão é uma **relação** com significado, e o Archflow só aceita as que fazem sentido:

| Relação | Liga | Tipo (fixo) |
|---|---|---|
| `triggers` | command → aggregate · evento → policy / saga / read model · policy / saga → command | dependência |
| `emits` | command / aggregate / saga → evento | assíncrona |
| `contains` | aggregate / entity → entity / value object | composição |
| `references-by-id` | aggregate / entity → **outro** aggregate | associação |
| `realizes` | command / serviço → caso de uso | realização |
| `uses` | command / policy / saga / serviço → domain service / repository | dependência |
| `context-relation` | contexto → contexto (com `pattern`) | associação |

O tipo do conector **vem da relação**; tipos de infraestrutura (`sync`, `async`, `stream`, `data`) não existem aqui. Ao ligar dois elementos, se só uma relação serve, a conexão já nasce com ela; se nenhuma serve (ex.: ator → caso de uso), é um conector UML simples.

## 6. Erros comuns

| Sintoma | Problema | Correção |
|---|---|---|
| Classes só com getters/setters e a regra num "serviço" | **Modelo anêmico**: o domínio virou estrutura de dados | Mover a regra para o aggregate; ficar com um serviço só para o que não cabe em nenhum |
| Um aggregate com 15 entities | **Aggregate gigante** (modelou o substantivo, não a invariante) | Quebrar por invariantes; referenciar por id |
| Uma operação que precisa mexer em dois aggregates ao mesmo tempo | Fronteira errada, ou é um fluxo | Rever as invariantes; ou usar evento + saga com compensação |
| Eventos com nome de comando (`CriarPedido` publicado) | Confusão entre pedir e relatar | Command no imperativo, evento no passado |
| Todos os contextos no mesmo banco, lendo as tabelas uns dos outros | **Banco compartilhado** como integração | Cada contexto é dono dos seus dados; conversar por eventos ou API |
| Um contexto "Geral" ou "Core" com tudo dentro | Não é contexto, é o sistema inteiro | Procurar onde a linguagem muda |
| CRUD com nome de DDD | Nem todo subdomínio precisa de modelo rico | Em subdomínio supporting/generic, fazer simples |
| Um `Paciente` único em todos os contextos | Modelo canônico: ninguém o entende | Um modelo por contexto, ligados por id e eventos |

## 7. Glossário

| Termo (como no Archflow) | Em português |
|---|---|
| Bounded context | Contexto delimitado |
| Ubiquitous language | Linguagem ubíqua |
| Aggregate / Aggregate root | Agregado / raiz do agregado |
| Entity | Entidade |
| Value object | Objeto de valor |
| Domain event | Evento de domínio |
| Command | Comando |
| Policy | Política (reação a um evento) |
| Process manager / Saga | Gerenciador de processo / saga |
| Repository | Repositório |
| Domain service / Application service | Serviço de domínio / de aplicação |
| Read model | Modelo de leitura |
| Context map | Mapa de contextos |
| Anticorruption layer | Camada anticorrupção |
| Upstream / downstream | Montante (fornece) / jusante (consome) |

## 8. Os exemplos

| Exemplo | Nível | Para aprender |
|---|---|---|
| [Biblioteca](../examples/exemplos-ddd/biblioteca/README.md) | iniciante | aggregate definido pela invariante, entity × value object, policy, domain service, read model |
| [Clínica](../examples/exemplos-ddd/clinica/README.md) | intermediário | onde traçar a fronteira, linguagem diferente por contexto, shared kernel |
| [Loja](../examples/exemplos-ddd/loja/README.md) | intermediário | saga com compensação, anticorruption layer, eventos entre contextos, do domínio à arquitetura |
| [Banco](../examples/exemplos-ddd/banco/README.md) | avançado | um aggregate por transação, consistência eventual, saga de transferência, published language |

No app: explorador de arquivos → ✨ *Exemplos de DDD* → *Instalar e abrir*. Fora do app: copie `examples/exemplos-ddd` para dentro de um cofre. Cada pasta tem também um `modelo.md` com o modelo em texto (o que um agente de IA lê).

## 9. Para ir além

- Eric Evans, *Domain-Driven Design: Tackling Complexity in the Heart of Software* (2003): o livro que originou o termo.
- Vaughn Vernon, *Implementing Domain-Driven Design* (2013) e *Domain-Driven Design Distilled* (2016): a versão prática e a curta.
- Alberto Brandolini, *Introducing EventStorming*: a oficina em que se descobrem eventos, commands e aggregates com adesivos, que o layout *linha do tempo* do Archflow imita.
