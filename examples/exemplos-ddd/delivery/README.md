# Exemplo 5: Delivery de comida (tour completo)

O exemplo que usa **todos os recursos do modo Domain**. Se você quer ver, em um só lugar, "o que dá para fazer" no Archflow, abra este. Conceitos explicados em [`docs/DDD.md`](../../../docs/DDD.md).

**Como abrir:** no app, explorador de arquivos → ✨ *Exemplos de DDD* → *Delivery de comida*. O modelo em texto está em [`modelo.md`](modelo.md).

## A história

O cliente pede comida de um restaurante. É preciso cobrar, o restaurante prepara, um entregador busca e leva, e o cliente acompanha. Seis áreas do negócio, seis **bounded contexts**:

| Contexto | Subdomínio | O que resolve |
|---|---|---|
| `pedidos` | `core` | o pedido e o seu estado; coordena tudo por uma saga |
| `cozinha` | `core` | preparar e avisar que está pronto |
| `entrega` | `core` | alocar entregador, retirar, entregar, rastrear |
| `pagamentos` | `generic` | cobrar (gateway externo atrás de um tradutor) |
| `mapas` | `generic` | rota e tempo (provedor externo) |
| `fidelidade` | `supporting` | pontos por pedido pago |

## Onde está cada recurso

| Recurso | Onde ver |
|---|---|
| **Os 8 padrões do Context Map** | `visao-geral`: `partnership`, `customer-supplier`, `conformist`, `shared-kernel`, `acl`, `ohs`, `published-language`, `separate-ways` (a origem da seta é o upstream) |
| **Decisão exclusiva** | `entregue-no-prazo` em `pedidos`: segue o primeiro ramo cuja condição vale; o "senão" cobre o resto |
| **Decisões encadeadas** | o "senão" de `entregue-no-prazo` leva a `atraso-grave` |
| **Decisão paralela** | `ao-confirmar` em `cozinha`: preparar e imprimir a comanda acontecem juntos |
| **Decisão de junção** | `pronto-e-alocado` em `entrega`: espera o pedido ficar pronto **e** o entregador ser alocado |
| **Loop com parada** | `ha-tentativas` em `pagamentos`: volta a `cobrar` até 3 vezes |
| **"Para cada" e condição/senão** | `iniciar-preparo` em `cozinha`: age em cada item e tem dois desfechos |
| **Saga com compensação** | `fluxo-do-pedido` em `pedidos` (`process-manager`) |
| **Propriedades** | `criar-pedido`, `pedido`, `item-do-pedido`, `endereco-de-entrega`, `dinheiro`, `pedido-criado` e os read models; clique no elemento e veja a tabela de campos |
| **Aggregates ligados por id** | `entrega-agregado` → `entregador` (`references-by-id`) |
| **Eventos entre contextos** | as caixas de eventos `external` (cópias locais) em cada contexto |
| **Read model** e **application service** | `pedidos-do-cliente`, `rastreamento`, `saldo-de-pontos` e as consultas |
| **Domain service e ACL** | `tradutor-do-gateway` em `pagamentos`; `escolhedor-de-entregador` em `entrega` |
| **Sistemas externos** | `gateway-de-pagamento` e `provedor-de-mapas` |
| **Notas** | em `visao-geral`, `pedidos`, `cozinha` e `entrega` |
| **Todos os 13 papéis** | procure um de cada: use case, command, aggregate root, entity, value object, evento, policy, process manager, decision, read model, repository, domain service e application service |

## Como ler

1. **Visão geral**: veja quem fornece e quem consome. Entre em um contexto pelo botão ↗.
2. **Pedidos**: da esquerda para a direita é o tempo. O `fluxo-do-pedido` confirma ou cancela; depois da entrega, as duas decisões escolhem entre `concluir-pedido`, `conceder-reembolso` e `registrar-atraso`.
3. **Cozinha** e **Entrega**: as decisões paralela e de junção mostram fluxos que andam juntos e esperam uns pelos outros.
4. Use o **Apresentar (P)** em qualquer contexto: o passo a passo conta a história de cada caso de uso e a história completa.

## Experimente

1. Siga o caminho feliz: `criar-pedido` → `pagamento-aprovado` → `confirmar-pedido` → (em paralelo) `iniciar-preparo` e `alocar-entregador` → junção → `retirar-pedido` → `entregar-pedido` → `concluir-pedido`.
2. Siga o triste: o gateway recusa três vezes → `cobranca-desistida` → a saga cancela. E se a cozinha recusar o preparo? (`preparo-recusado`.)
3. Em *Entrega*, selecione a decisão `pronto-e-alocado` e troque o **tipo de decisão** no Inspetor para ver o que muda (a validação avisa).
4. Gere o código (aba *Código*) e compare as propriedades de `pedido` com o tipo gerado.
