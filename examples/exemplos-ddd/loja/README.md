# Exemplo 3: Loja online (intermediário)

Três contextos que conversam por eventos e uma **saga** que coordena o checkout. É o exemplo que também mostra como o **domínio (micro)** se liga à **arquitetura (macro)**. Conceitos explicados em [`docs/DDD.md`](../../../docs/DDD.md).

**Como abrir:** no app, explorador de arquivos → ✨ *Exemplos de DDD* → *Loja online*. O modelo em texto está em [`modelo.md`](modelo.md).

## A história

Quando o cliente faz um pedido, três coisas precisam acontecer: cobrar o pagamento, reservar o estoque e confirmar o pedido. Cada uma pertence a uma parte diferente do negócio, com regras e equipes próprias, e **não existe uma transação de banco que atravesse as três**.

- **Pedidos** (`core`): o que o cliente comprou e em que estado está. É a experiência de compra.
- **Pagamentos** (`generic`): cobrar. Problema comum de mercado, o esforço vai para a integração com o gateway.
- **Estoque** (`supporting`): quanto temos e o que está reservado.

## Como ler

1. **Visão geral**: `pedidos` e `pagamentos` são parceiros (`partnership`: os eventos vão e voltam); `estoque` fornece o resultado da reserva a `pedidos` (`customer-supplier`).
2. **Pedidos**: ao criar um pedido (`criar-pedido`) nasce `pedido-criado`. Os três contextos reagem. Os eventos de resposta (`pagamento-aprovado`, `cobranca-desistida`, `estoque-reservado`, `estoque-insuficiente`) chegam do outro lado, ficam na faixa de cima e alimentam a saga `fluxo-de-checkout`, que decide entre `confirmar-pedido` e `cancelar-pedido`.
3. **Pagamentos** e **Estoque** mostram o lado de quem reage: uma policy transforma `pedido-criado` em `cobrar` ou `reservar-estoque`. Em *Pagamentos* repare no losango `ha-tentativas` (uma **decisão**): a recusa de um pagamento volta a `cobrar` enquanto houver tentativas (o **loop**, marcado na conexão) e, esgotadas, vai para `desistir-da-cobranca`.
4. **Arquitetura**: um serviço por contexto, com seu banco e um barramento de eventos. No diagrama **Pedidos**, o componente `pedidos-api` aponta para o serviço correspondente: é a ponte entre as duas visões.

## Decisões de modelagem (e por quê)

- **A saga (`fluxo-de-checkout`) é um process manager.** Ela tem estado ("já pagou? já reservou?") e sabe **compensar**: se o pagamento falhar depois de o estoque ter sido reservado, o cancelamento do pedido gera `pedido-cancelado`, e o Estoque reage liberando as reservas (`liberar-ao-cancelar-pedido`). Sem saga, alguém teria de chamar os dois serviços em sequência e torcer para nada cair no meio.
- **Consistência eventual.** Entre pedido, pagamento e estoque há momentos em que o sistema está "no meio do caminho". O DDD aceita isso e o torna **explícito** (eventos e compensações) em vez de esconder atrás de uma transação distribuída.
- **`item-de-estoque` é um aggregate por produto**, não um "Estoque" gigante. Reservar um pedido inteiro mexe em vários aggregates; é a saga quem cuida da consistência entre eles.
- **Anticorruption layer no gateway.** O `tradutor-do-gateway` (um domain service) converte o vocabulário do gateway no nosso e é o único que conhece o sistema externo `gateway-de-pagamento`. Se trocarmos de gateway, só ele muda.
- **`pagamento` tem uma invariante simples** (só é aprovado ou recusado uma vez) mas é essencial: os eventos de aprovação nunca duplicam o dinheiro.
- **Read model `pedidos-do-cliente`** e o application service `consulta-de-pedidos`: a tela de acompanhamento lê da projeção, não dos aggregates.
- **A retentativa é uma decisão com loop, só no domínio.** `pagamento-recusado` alimenta a decisão `ha-tentativas` (exclusiva). O ramo "se tentativas < 3" **volta** a `cobrar` e é marcado como loop, com a parada explícita (`até pagamento aprovado, máx. 3`); o ramo "senão" segue para `desistir-da-cobranca`. A saga do Pedidos só cancela quando recebe `cobranca-desistida`, e não a cada recusa: a decisão fica no contexto que sabe contar tentativas.
- **Iteração e condição na reserva.** `reservar-estoque` aciona o aggregate "para cada item do pedido" (a conexão carrega `para cada item do pedido`), e emite `estoque-reservado` se todos os itens têm saldo ou `estoque-insuficiente` no "senão": o mesmo command com dois desfechos possíveis.
- **`dinheiro` é value object.** Valor e moeda juntos; ninguém soma reais com dólares por engano.

## Casos de uso → modelo

| Caso de uso | Command | Aggregate | Evento |
|---|---|---|---|
| Fazer pedido (`fazer-pedido-uc`) | `criar-pedido` | `pedido` | `pedido-criado` |
| Cancelar pedido (`cancelar-pedido-uc`) | `cancelar-pedido` | `pedido` | `pedido-cancelado` |
| Acompanhar pedido (`acompanhar-uc`) | `consulta-de-pedidos` (serviço de leitura) | — | — |
| Pagar pedido (`pagar-pedido-uc`) | `cobrar` | `pagamento` | `cobranca-iniciada` |
| Reservar itens (`reservar-itens-uc`) | `reservar-estoque` | `item-de-estoque` | `estoque-reservado` |

## Experimente

1. **Faça o caminho feliz:** `criar-pedido` → `pedido-criado` → (em paralelo) `cobrar` e `reservar-estoque` → `pagamento-aprovado` e `estoque-reservado` → saga → `confirmar-pedido`.
2. **Faça o caminho triste:** o gateway recusa três vezes. Siga `pagamento-recusado` → `ha-tentativas` → `cobrar` (volta duas vezes) → na terceira, `desistir-da-cobranca` → `cobranca-desistida`. Depois de `estoque-reservado`, o que a saga faz? Quem libera o estoque? (`cancelar-pedido` → `pedido-cancelado` → `liberar-ao-cancelar-pedido`.)
3. **Veja a ponte macro ↔ micro:** em *Pedidos*, selecione `pedidos-api` e use *Visualizar* no inspetor para abrir o diagrama de arquitetura no serviço certo.
4. **Layout:** em *Pedidos*, abra o *Layout automático* e alterne entre *Linha do tempo* e *Fluxo*.
5. **Gere o código** (aba *Código*) e veja `FluxoDeCheckout` com o método `compensate()`.
