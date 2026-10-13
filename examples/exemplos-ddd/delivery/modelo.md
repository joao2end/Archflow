# Delivery de comida (tour completo): o modelo em texto

> Gerado a partir dos diagramas desta pasta (`npm run examples:build`); é exatamente o que um agente (MCP) recebe em `get_diagram` e `domain_overview`. Não edite à mão.

# Visão geral do cofre

> 7 diagrama(s) de domínio · 6 contexto(s) · 1 visão(ões) geral(is)

## Mapa de contextos
_exemplos-ddd/delivery/visao-geral.archflow.json_
- Pedidos —partnership→ Pagamentos via pedido-criado ⇄ pagamento-aprovado
- Cozinha —customer-supplier→ Pedidos via preparo-recusado
- Pedidos —conformist→ Entrega via pedido-confirmado
- Cozinha —shared-kernel→ Entrega via pedido-pronto · tempo de preparo
- Mapas —acl→ Entrega via rota-calculada
- Pagamentos —ohs→ Fidelidade via pagamento-aprovado
- Pedidos —published-language→ Fidelidade via eventos de pedido
- Cozinha —separate-ways→ Fidelidade via sem integração

## Contextos
- **Cozinha** `cozinha` (core) — `exemplos-ddd/delivery/cozinha.archflow.json`
  - aggregates: 1 · commands: 3 · eventos publicados: preparo-iniciado, preparo-recusado, comanda-impressa, pedido-pronto · consumidos: pedidos.pedido-confirmado
- **Entrega** `entrega` (core) — `exemplos-ddd/delivery/entrega.archflow.json`
  - aggregates: 2 · commands: 3 · eventos publicados: entregador-alocado, pedido-retirado, pedido-entregue · consumidos: pedidos.pedido-confirmado, cozinha.pedido-pronto, mapas.rota-calculada
- **Fidelidade** `fidelidade` (supporting) — `exemplos-ddd/delivery/fidelidade.archflow.json`
  - aggregates: 1 · commands: 1 · eventos publicados: pontos-acumulados · consumidos: pagamentos.pagamento-aprovado
- **Mapas** `mapas` (generic) — `exemplos-ddd/delivery/mapas.archflow.json`
  - aggregates: 1 · commands: 1 · eventos publicados: rota-calculada · consumidos: —
- **Pagamentos** `pagamentos` (generic) — `exemplos-ddd/delivery/pagamentos.archflow.json`
  - aggregates: 1 · commands: 4 · eventos publicados: cobranca-iniciada, pagamento-aprovado, pagamento-recusado, cobranca-desistida · consumidos: pedidos.pedido-criado
- **Pedidos** `pedidos` (core) — `exemplos-ddd/delivery/pedidos.archflow.json`
  - aggregates: 1 · commands: 6 · eventos publicados: pedido-criado, pedido-confirmado, pedido-cancelado, pedido-concluido, reembolso-concedido, atraso-registrado · consumidos: pagamentos.pagamento-aprovado, pagamentos.cobranca-desistida, cozinha.preparo-recusado, entrega.pedido-entregue

## Casos de uso
- 11 de 11 rastreados até um evento (100%)
- ✔ `preparar-uc` Preparar pedido (exemplos-ddd/delivery/cozinha.archflow.json)
- ✔ `avisar-pronto-uc` Avisar que está pronto (exemplos-ddd/delivery/cozinha.archflow.json)
- ✔ `buscar-pedido-uc` Buscar o pedido (exemplos-ddd/delivery/entrega.archflow.json)
- ✔ `entregar-uc` Entregar ao cliente (exemplos-ddd/delivery/entrega.archflow.json)
- ✔ `rastrear-uc` Rastrear entrega (exemplos-ddd/delivery/entrega.archflow.json)
- ✔ `ganhar-pontos-uc` Ganhar pontos (exemplos-ddd/delivery/fidelidade.archflow.json)
- ✔ `calcular-rota-uc` Calcular rota (exemplos-ddd/delivery/mapas.archflow.json)
- ✔ `pagar-pedido-uc` Pagar pedido (exemplos-ddd/delivery/pagamentos.archflow.json)
- ✔ `fazer-pedido-uc` Fazer pedido (exemplos-ddd/delivery/pedidos.archflow.json)
- ✔ `cancelar-pedido-uc` Cancelar pedido (exemplos-ddd/delivery/pedidos.archflow.json)
- ✔ `acompanhar-uc` Acompanhar pedido (exemplos-ddd/delivery/pedidos.archflow.json)

## Avisos
- [D011 dica] contexto `cozinha` (Cozinha) sem ligação com a arquitetura: adicione um componente "system" com ref para o diagrama de arquitetura — `exemplos-ddd/delivery/cozinha.archflow.json`
- [D011 dica] contexto `entrega` (Entrega) sem ligação com a arquitetura: adicione um componente "system" com ref para o diagrama de arquitetura — `exemplos-ddd/delivery/entrega.archflow.json`
- [D011 dica] contexto `fidelidade` (Fidelidade) sem ligação com a arquitetura: adicione um componente "system" com ref para o diagrama de arquitetura — `exemplos-ddd/delivery/fidelidade.archflow.json`
- [D011 dica] contexto `mapas` (Mapas) sem ligação com a arquitetura: adicione um componente "system" com ref para o diagrama de arquitetura — `exemplos-ddd/delivery/mapas.archflow.json`
- [D011 dica] contexto `pagamentos` (Pagamentos) sem ligação com a arquitetura: adicione um componente "system" com ref para o diagrama de arquitetura — `exemplos-ddd/delivery/pagamentos.archflow.json`
- [D030 dica] `ha-tentativas` (Há tentativas?) → `cobrar` (Cobrar) está marcada como loop, mas o diagrama não mostra o caminho de volta (de cobrar até ha-tentativas); se o retorno passa por um sistema externo está certo, senão revise a conexão — `exemplos-ddd/delivery/pagamentos.archflow.json`
- [D011 dica] contexto `pedidos` (Pedidos) sem ligação com a arquitetura: adicione um componente "system" com ref para o diagrama de arquitetura — `exemplos-ddd/delivery/pedidos.archflow.json`

---

<!-- exemplos-ddd/delivery/visao-geral.archflow.json -->
# Visão geral — domínio

Delivery de comida (tour completo): mapa de contextos. O exemplo que usa todos os recursos do modo Domain: seis contextos com os oito padrões do Context Map, saga com compensação, policy com ramos condicionais e em paralelo, saga que espera dois eventos, loop, "para cada", propriedades, eventos entre contextos, read models e anotações.

> schema archflow/1 · modo domain · 0 contexto(s) · 0 aggregate(s) · 0 caso(s) de uso

## Fora de qualquer contexto

## Relações entre contextos
- `pedidos` —partnership→ `pagamentos` via pedido-criado ⇄ pagamento-aprovado — Dois contextos evoluem juntos e coordenam entregas.
- `cozinha` —customer-supplier→ `pedidos` via preparo-recusado — Fornecedor (upstream) atende o cliente (downstream), que influencia o plano.
- `pedidos` —conformist→ `entrega` via pedido-confirmado — O downstream adota o modelo do upstream sem negociar.
- `cozinha` —shared-kernel→ `entrega` via pedido-pronto · tempo de preparo — Os contextos compartilham um subconjunto do modelo e mudam juntos.
- `mapas` —acl→ `entrega` via rota-calculada — O downstream traduz o modelo do upstream para proteger o próprio.
- `pagamentos` —ohs→ `fidelidade` via pagamento-aprovado — O upstream expõe um serviço aberto e estável para vários consumidores.
- `pedidos` —published-language→ `fidelidade` via eventos de pedido — Linguagem de troca documentada e compartilhada (ex.: JSON schema, AsyncAPI).
- `cozinha` —separate-ways→ `fidelidade` via sem integração — Sem integração: cada contexto resolve sozinho.

## Diagramas referenciados
- `pedidos` **Pedidos** → `exemplos-ddd/delivery/pedidos.archflow.json`
- `pagamentos` **Pagamentos** → `exemplos-ddd/delivery/pagamentos.archflow.json`
- `cozinha` **Cozinha** → `exemplos-ddd/delivery/cozinha.archflow.json`
- `entrega` **Entrega** → `exemplos-ddd/delivery/entrega.archflow.json`
- `mapas` **Mapas** → `exemplos-ddd/delivery/mapas.archflow.json`
- `fidelidade` **Fidelidade** → `exemplos-ddd/delivery/fidelidade.archflow.json`

## Notas
- partnership: evoluem juntos customer-supplier: o fornecedor atende o cliente conformist: o cliente aceita o modelo do fornecedor shared-kernel: núcleo compartilhado acl: o cliente traduz o modelo de fora ohs: serviço aberto para vários published-language: linguagem documentada separate-ways: sem integração

## Mermaid
```mermaid
flowchart LR
  n_pedidos[["↗ Pedidos"]]
  n_pagamentos[["↗ Pagamentos"]]
  n_cozinha[["↗ Cozinha"]]
  n_entrega[["↗ Entrega"]]
  n_mapas[["↗ Mapas"]]
  n_fidelidade[["↗ Fidelidade"]]
  n_pedidos ---|"Partnership · pedido-criado ⇄ pagamento-aprovado"| n_pagamentos
  n_cozinha ---|"Customer/Supplier · preparo-recusado"| n_pedidos
  n_pedidos ---|"Conformist · pedido-confirmado"| n_entrega
  n_cozinha ---|"Shared Kernel · pedido-pronto · tempo de preparo"| n_entrega
  n_mapas ---|"Anticorruption Layer · rota-calculada"| n_entrega
  n_pagamentos ---|"Open Host Service · pagamento-aprovado"| n_fidelidade
  n_pedidos ---|"Published Language · eventos de pedido"| n_fidelidade
  n_cozinha ---|"Separate Ways · sem integração"| n_fidelidade
```

---

<!-- exemplos-ddd/delivery/pedidos.archflow.json -->
# Pedidos — domínio

> schema archflow/1 · modo domain · 1 contexto(s) · 1 aggregate(s) · 3 caso(s) de uso

## Contexto `pedidos` (core) — Pedidos
O que o cliente pediu e em que estado está o pedido. A experiência de pedir é o diferencial do negócio.
_Diferencial competitivo do negócio; onde vale investir no melhor modelo._

### Aggregate `pedido` (root: Pedido)
O aggregate protege as regras do pedido inteiro: itens, total e estado mudam juntos, numa só transação.
- entity: `item-do-pedido`
- value-object: `endereco-de-entrega`, `dinheiro`
- invariantes: o total é a soma dos itens; pedido confirmado não aceita novos itens; pedido cancelado não volta a ser confirmado; todo item é do mesmo restaurante
- propriedades de `pedido`: id: uuid #, clienteId: uuid, status: texto, total: Dinheiro, promessaDeEntrega: data e hora, motivoCancelamento?: texto
- propriedades de `item-do-pedido`: produtoId: uuid #, quantidade: inteiro, precoUnitario: Dinheiro, observacao?: texto
- propriedades de `endereco-de-entrega`: logradouro: texto, numero: texto, complemento?: texto, cep: texto
- propriedades de `dinheiro`: valor: inteiro, moeda: texto
- command `criar-pedido` — registrar o pedido com os itens e o endereço (parâmetros: clienteId: uuid, restauranteId: uuid, itens: Item do pedido[], endereco: Endereço de entrega)
- command `confirmar-pedido` — o pagamento foi aprovado: libera o restaurante e a entrega
- command `cancelar-pedido` — encerrar o pedido (cliente desistiu ou algo falhou)
- command `concluir-pedido` — a entrega chegou no prazo
- command `conceder-reembolso` — devolver o valor quando o atraso é grave
- command `registrar-atraso` — anotar a entrega fora do prazo
- evento `pedido-criado` (payload: pedidoId: uuid #, total: Dinheiro)
- evento `pedido-confirmado` (payload: pedidoId, restauranteId, endereco, itens)
- evento `pedido-cancelado` (payload: pedidoId, motivo)
- evento `pedido-concluido` (payload: pedidoId)
- evento `reembolso-concedido` (payload: pedidoId, valor)
- evento `atraso-registrado` (payload: pedidoId, minutosDeAtraso)
- repository `pedido-repo`

### Policies
- `entregue-no-prazo` **Entregue no prazo?** — a entrega chegou no prazo? Se atrasou muito, reembolsa; senão registra o atraso → se minutos de atraso = 0: `concluir-pedido`; se atraso > 30 minutos: `conceder-reembolso`; senão: `registrar-atraso`

### Process managers (sagas)
- `fluxo-do-pedido` **Fluxo do pedido**: reage a pedido-criado, pagamento-aprovado, cobranca-desistida, preparo-recusado → dispara confirmar-pedido, cancelar-pedido · compensa com cancelar-pedido

### Application services
- `consulta-de-pedidos` **Consulta de pedidos** — responde "onde está meu pedido?" lendo a projeção

### Read models
- `pedidos-do-cliente` **Pedidos do cliente** projeta pedido-criado, pedido-confirmado, pedido-concluido, pedido-cancelado

### Eventos consumidos de outros contextos
- `pagamento-aprovado` ← pagamentos.pagamento-aprovado
- `cobranca-desistida` ← pagamentos.cobranca-desistida
- `preparo-recusado` ← cozinha.preparo-recusado
- `pedido-entregue` ← entrega.pedido-entregue

## Casos de uso e rastreio
- `fazer-pedido-uc` Fazer pedido (ator: Cliente) → criar-pedido → pedido → pedido-criado ✔
- `cancelar-pedido-uc` Cancelar pedido (ator: Cliente) → cancelar-pedido → pedido → pedido-cancelado ✔
- `acompanhar-uc` Acompanhar pedido (ator: Cliente) → consulta-de-pedidos ✔

## Fluxo condicional, loops e iterações
- `entregue-no-prazo` —[se minutos de atraso = 0]→ `concluir-pedido`
- `entregue-no-prazo` —[se atraso > 30 minutos]→ `conceder-reembolso`
- `entregue-no-prazo` —[senão]→ `registrar-atraso`

## Notas
- A saga confirma ou cancela; depois da entrega, duas decisões em sequência escolhem entre concluir, reembolsar ou só registrar o atraso.

## Avisos
- [D011 dica] contexto `pedidos` (Pedidos) sem ligação com a arquitetura: adicione um componente "system" com ref para o diagrama de arquitetura

## Mermaid
```mermaid
flowchart LR
  subgraph n_pedidos["Pedidos"]
    n_cliente(["Cliente"])
    n_fazer_pedido_uc["Fazer pedido"]
    n_cancelar_pedido_uc["Cancelar pedido"]
    n_acompanhar_uc["Acompanhar pedido"]
    n_criar_pedido(["Criar pedido"])
    n_confirmar_pedido(["Confirmar pedido"])
    n_cancelar_pedido(["Cancelar pedido"])
    n_concluir_pedido(["Concluir pedido"])
    n_conceder_reembolso(["Conceder reembolso"])
    n_registrar_atraso(["Registrar atraso"])
    n_pedido[["Pedido"]]
    n_item_do_pedido["Item do pedido"]
    n_endereco_de_entrega["Endereço de entrega"]
    n_dinheiro["Dinheiro"]
    n_pedido_criado>"Pedido criado"]
    n_pedido_confirmado>"Pedido confirmado"]
    n_pedido_cancelado>"Pedido cancelado"]
    n_pedido_concluido>"Pedido concluído"]
    n_reembolso_concedido>"Reembolso concedido"]
    n_atraso_registrado>"Atraso registrado"]
    n_pagamento_aprovado>"Pagamento aprovado"]
    n_cobranca_desistida>"Cobrança desistida"]
    n_preparo_recusado>"Preparo recusado"]
    n_pedido_entregue>"Pedido entregue"]
    n_fluxo_do_pedido["Fluxo do pedido"]
    n_entregue_no_prazo["Entregue no prazo?"]
    n_pedidos_do_cliente["Pedidos do cliente"]
    n_consulta_de_pedidos["Consulta de pedidos"]
    n_pedido_repo["Repositório de pedidos"]
  end
  n_cliente ---|"executa"| n_fazer_pedido_uc
  n_cliente ---|"executa"| n_cancelar_pedido_uc
  n_cliente ---|"executa"| n_acompanhar_uc
  n_criar_pedido -.->|"realizes"| n_fazer_pedido_uc
  n_cancelar_pedido -.->|"realizes"| n_cancelar_pedido_uc
  n_consulta_de_pedidos -.->|"realizes"| n_acompanhar_uc
  n_criar_pedido -.->|"triggers"| n_pedido
  n_criar_pedido -.->|"emits"| n_pedido_criado
  n_confirmar_pedido -.->|"triggers"| n_pedido
  n_confirmar_pedido -.->|"emits"| n_pedido_confirmado
  n_cancelar_pedido -.->|"triggers"| n_pedido
  n_cancelar_pedido -.->|"emits"| n_pedido_cancelado
  n_concluir_pedido -.->|"triggers"| n_pedido
  n_concluir_pedido -.->|"emits"| n_pedido_concluido
  n_conceder_reembolso -.->|"triggers"| n_pedido
  n_conceder_reembolso -.->|"emits"| n_reembolso_concedido
  n_registrar_atraso -.->|"triggers"| n_pedido
  n_registrar_atraso -.->|"emits"| n_atraso_registrado
  n_pedido -->|"contains"| n_item_do_pedido
  n_pedido -->|"contains"| n_endereco_de_entrega
  n_pedido -->|"contains"| n_dinheiro
  n_pedido_criado -.->|"triggers"| n_fluxo_do_pedido
  n_pagamento_aprovado -.->|"triggers"| n_fluxo_do_pedido
  n_cobranca_desistida -.->|"triggers"| n_fluxo_do_pedido
  n_preparo_recusado -.->|"triggers"| n_fluxo_do_pedido
  n_fluxo_do_pedido -.->|"triggers"| n_confirmar_pedido
  n_fluxo_do_pedido -.->|"triggers"| n_cancelar_pedido
  n_pedido_entregue -.->|"triggers"| n_entregue_no_prazo
  n_entregue_no_prazo -.->|"se minutos de atraso = 0"| n_concluir_pedido
  n_entregue_no_prazo -.->|"se atraso > 30 minutos"| n_conceder_reembolso
  n_entregue_no_prazo -.->|"senão"| n_registrar_atraso
  n_pedido_criado -.->|"triggers"| n_pedidos_do_cliente
  n_pedido_confirmado -.->|"triggers"| n_pedidos_do_cliente
  n_pedido_concluido -.->|"triggers"| n_pedidos_do_cliente
  n_pedido_cancelado -.->|"triggers"| n_pedidos_do_cliente
  n_criar_pedido -.->|"uses"| n_pedido_repo
```

---

<!-- exemplos-ddd/delivery/pagamentos.archflow.json -->
# Pagamentos — domínio

> schema archflow/1 · modo domain · 1 contexto(s) · 1 aggregate(s) · 1 caso(s) de uso

## Contexto `pagamentos` (generic) — Pagamentos
Cobrar e saber se o dinheiro entrou. Problema comum de mercado: o esforço vai para integrar o gateway, não para o modelo.
_Problema comum e resolvido no mercado (auth, e-mail, pagamento); prefira comprar ou usar pronto._

### Aggregate `pagamento` (root: Pagamento)
- value-object: `valor`
- invariantes: valor maior que zero; aprovado ou recusado uma única vez; no máximo 3 tentativas por pedido
- command `cobrar` — iniciar a cobrança no gateway
- command `registrar-aprovacao` — o gateway confirmou o pagamento
- command `registrar-recusa` — o gateway recusou o pagamento
- command `desistir-da-cobranca` — encerrar depois da última recusa
- evento `cobranca-iniciada` (payload: pedidoId, pagamentoId)
- evento `pagamento-aprovado` (payload: pedidoId, pagamentoId)
- evento `pagamento-recusado` (payload: pedidoId, pagamentoId, motivo)
- evento `cobranca-desistida` (payload: pedidoId, motivo)
- repository `pagamento-repo`

### Policies
- `cobrar-ao-criar-pedido` **Cobrar ao criar pedido** reage a pedido-criado → dispara cobrar — todo pedido criado gera uma cobrança
- `ha-tentativas` **Há tentativas?** — ainda há tentativas de cobrança para este pedido? → se tentativas < 3 · repete até pagamento aprovado, máx. 3: `cobrar` ↻; senão: `desistir-da-cobranca`

### Domain services
- `tradutor-do-gateway` **Tradutor do gateway** — converte o vocabulário do gateway no nosso

### Eventos consumidos de outros contextos
- `pedido-criado` ← pedidos.pedido-criado

## Casos de uso e rastreio
- `pagar-pedido-uc` Pagar pedido (ator: Sistema de pedidos) → cobrar → pagamento → cobranca-iniciada ✔

## Fluxo condicional, loops e iterações
- `ha-tentativas` —[se tentativas < 3 · repete até pagamento aprovado, máx. 3]→ `cobrar` (volta a um passo anterior)
- `ha-tentativas` —[senão]→ `desistir-da-cobranca`

## Avisos
- [D011 dica] contexto `pagamentos` (Pagamentos) sem ligação com a arquitetura: adicione um componente "system" com ref para o diagrama de arquitetura
- [D030 dica] `ha-tentativas` (Há tentativas?) → `cobrar` (Cobrar) está marcada como loop, mas o diagrama não mostra o caminho de volta (de cobrar até ha-tentativas); se o retorno passa por um sistema externo está certo, senão revise a conexão

## Mermaid
```mermaid
flowchart LR
  subgraph n_pagamentos["Pagamentos"]
    n_sistema_de_pedidos(["Sistema de pedidos"])
    n_pagar_pedido_uc["Pagar pedido"]
    n_pedido_criado>"Pedido criado"]
    n_cobrar_ao_criar_pedido["Cobrar ao criar pedido"]
    n_cobrar(["Cobrar"])
    n_registrar_aprovacao(["Registrar aprovação"])
    n_registrar_recusa(["Registrar recusa"])
    n_desistir_da_cobranca(["Desistir da cobrança"])
    n_pagamento[["Pagamento"]]
    n_valor["Valor"]
    n_cobranca_iniciada>"Cobrança iniciada"]
    n_pagamento_aprovado>"Pagamento aprovado"]
    n_pagamento_recusado>"Pagamento recusado"]
    n_cobranca_desistida>"Cobrança desistida"]
    n_ha_tentativas["Há tentativas?"]
    n_tradutor_do_gateway["Tradutor do gateway"]
    n_gateway_de_pagamento["Gateway de pagamento"]
    n_pagamento_repo["Repositório de pagamentos"]
  end
  n_sistema_de_pedidos ---|"executa"| n_pagar_pedido_uc
  n_cobrar -.->|"realizes"| n_pagar_pedido_uc
  n_pedido_criado -.->|"triggers"| n_cobrar_ao_criar_pedido
  n_cobrar_ao_criar_pedido -.->|"triggers"| n_cobrar
  n_cobrar -.->|"triggers"| n_pagamento
  n_cobrar -.->|"emits"| n_cobranca_iniciada
  n_registrar_aprovacao -.->|"triggers"| n_pagamento
  n_registrar_aprovacao -.->|"emits"| n_pagamento_aprovado
  n_registrar_recusa -.->|"triggers"| n_pagamento
  n_registrar_recusa -.->|"emits"| n_pagamento_recusado
  n_desistir_da_cobranca -.->|"triggers"| n_pagamento
  n_desistir_da_cobranca -.->|"emits"| n_cobranca_desistida
  n_pagamento_recusado -.->|"triggers"| n_ha_tentativas
  n_ha_tentativas -.->|"se tentativas < 3 · repete até pagamento aprovado, máx. 3"| n_cobrar
  n_ha_tentativas -.->|"senão"| n_desistir_da_cobranca
  n_pagamento -->|"contains"| n_valor
  n_registrar_aprovacao -.->|"uses"| n_tradutor_do_gateway
  n_registrar_recusa -.->|"uses"| n_tradutor_do_gateway
  n_cobrar -.->|"uses"| n_pagamento_repo
  n_tradutor_do_gateway ---|"traduz"| n_gateway_de_pagamento
```

---

<!-- exemplos-ddd/delivery/cozinha.archflow.json -->
# Cozinha — domínio

> schema archflow/1 · modo domain · 1 contexto(s) · 1 aggregate(s) · 2 caso(s) de uso

## Contexto `cozinha` (core) — Cozinha
O restaurante recebe o pedido, prepara e avisa quando está pronto. Do tempo de preparo depende a promessa de entrega.
_Diferencial competitivo do negócio; onde vale investir no melhor modelo._

### Aggregate `ticket-de-preparo` (root: Ticket de preparo)
- entity: `item-de-preparo`
- value-object: `tempo-de-preparo`
- invariantes: só vai de recebido para em preparo e depois pronto; não marca pronto sem todos os itens prontos
- propriedades de `ticket-de-preparo`: id: uuid #, pedidoId: uuid, estado: texto, prontoAs?: data e hora
- propriedades de `item-de-preparo`: prato: texto #, quantidade: inteiro, pronto: booleano
- propriedades de `tempo-de-preparo`: minutos: inteiro
- command `iniciar-preparo` — começar os pratos do pedido
- command `imprimir-comanda` — imprimir a comanda para a bancada
- command `marcar-pronto` — o pedido está embalado e pode sair
- evento `preparo-iniciado` (payload: pedidoId, tempoDePreparo)
- evento `preparo-recusado` (payload: pedidoId, motivo)
- evento `comanda-impressa` (payload: pedidoId)
- evento `pedido-pronto` (payload: pedidoId, restauranteId)
- repository `ticket-repo`

### Policies
- `ao-confirmar` **O que fazer ao confirmar?** — o que acontece assim que o pedido é confirmado?

### Domain services
- `estimador-de-preparo` **Estimador de preparo** — estima os minutos conforme os pratos e a fila da cozinha

### Eventos consumidos de outros contextos
- `pedido-confirmado` ← pedidos.pedido-confirmado

## Casos de uso e rastreio
- `preparar-uc` Preparar pedido (ator: Cozinheiro) → iniciar-preparo → ticket-de-preparo → preparo-iniciado | iniciar-preparo → ticket-de-preparo → preparo-recusado ✔
- `avisar-pronto-uc` Avisar que está pronto (ator: Cozinheiro) → marcar-pronto → ticket-de-preparo → pedido-pronto ✔

## Fluxo condicional, loops e iterações
- `iniciar-preparo` —[para cada item do pedido]→ `ticket-de-preparo`
- `iniciar-preparo` —[se há ingredientes de todos os itens]→ `preparo-iniciado`
- `iniciar-preparo` —[senão]→ `preparo-recusado`

## Notas
- Escolher decisão paralela quando os ramos são independentes Usar "para cada" quando o command age em vários itens Um command pode ter dois desfechos: condição e senão

## Avisos
- [D011 dica] contexto `cozinha` (Cozinha) sem ligação com a arquitetura: adicione um componente "system" com ref para o diagrama de arquitetura

## Mermaid
```mermaid
flowchart LR
  subgraph n_cozinha["Cozinha"]
    n_cozinheiro(["Cozinheiro"])
    n_preparar_uc["Preparar pedido"]
    n_avisar_pronto_uc["Avisar que está pronto"]
    n_pedido_confirmado>"Pedido confirmado"]
    n_ao_confirmar["O que fazer ao confirmar?"]
    n_iniciar_preparo(["Iniciar preparo"])
    n_imprimir_comanda(["Imprimir comanda"])
    n_marcar_pronto(["Marcar pronto"])
    n_ticket_de_preparo[["Ticket de preparo"]]
    n_item_de_preparo["Item de preparo"]
    n_tempo_de_preparo["Tempo de preparo"]
    n_preparo_iniciado>"Preparo iniciado"]
    n_preparo_recusado>"Preparo recusado"]
    n_comanda_impressa>"Comanda impressa"]
    n_pedido_pronto>"Pedido pronto"]
    n_estimador_de_preparo["Estimador de preparo"]
    n_ticket_repo["Repositório de tickets"]
  end
  n_cozinheiro ---|"executa"| n_preparar_uc
  n_cozinheiro ---|"executa"| n_avisar_pronto_uc
  n_iniciar_preparo -.->|"realizes"| n_preparar_uc
  n_marcar_pronto -.->|"realizes"| n_avisar_pronto_uc
  n_pedido_confirmado -.->|"triggers"| n_ao_confirmar
  n_ao_confirmar -.->|"triggers"| n_iniciar_preparo
  n_ao_confirmar -.->|"triggers"| n_imprimir_comanda
  n_iniciar_preparo -.->|"para cada item do pedido"| n_ticket_de_preparo
  n_iniciar_preparo -.->|"se há ingredientes de todos os itens"| n_preparo_iniciado
  n_iniciar_preparo -.->|"senão"| n_preparo_recusado
  n_imprimir_comanda -.->|"triggers"| n_ticket_de_preparo
  n_imprimir_comanda -.->|"emits"| n_comanda_impressa
  n_marcar_pronto -.->|"triggers"| n_ticket_de_preparo
  n_marcar_pronto -.->|"emits"| n_pedido_pronto
  n_ticket_de_preparo -->|"contains"| n_item_de_preparo
  n_ticket_de_preparo -->|"contains"| n_tempo_de_preparo
  n_iniciar_preparo -.->|"uses"| n_estimador_de_preparo
  n_iniciar_preparo -.->|"uses"| n_ticket_repo
```

---

<!-- exemplos-ddd/delivery/entrega.archflow.json -->
# Entrega — domínio

> schema archflow/1 · modo domain · 1 contexto(s) · 2 aggregate(s) · 3 caso(s) de uso

## Contexto `entrega` (core) — Entrega
Achar um entregador, buscar o pedido e levar até o cliente. Entregar rápido é parte do diferencial.
_Diferencial competitivo do negócio; onde vale investir no melhor modelo._

### Aggregate `entrega-agregado` (root: Entrega)
- entity: `parada`
- invariantes: uma entrega tem no máximo um entregador; só é retirada depois de alocada; só é entregue depois de retirada
- propriedades de `entrega-agregado`: id: uuid #, pedidoId: uuid, entregadorId?: uuid, estado: texto
- propriedades de `parada`: ordem: inteiro #, tipo: texto, endereco: texto
- command `alocar-entregador` — escolher o entregador mais próximo do restaurante
- command `retirar-pedido` — o entregador pegou o pedido no restaurante
- command `entregar-pedido` — o pedido chegou ao cliente
- evento `entregador-alocado` (payload: entregaId, entregadorId)
- evento `pedido-retirado` (payload: entregaId, pedidoId)
- evento `pedido-entregue` (payload: entregaId, pedidoId, minutosDeAtraso)
- repository `entrega-repo`

### Aggregate `entregador` (root: Entregador)
Outro aggregate, com ciclo de vida próprio: a Entrega só o conhece pelo id.
- value-object: `veiculo`
- invariantes: só leva uma entrega por vez
- propriedades de `entregador`: id: uuid #, nome: texto, disponivel: booleano
- repository `entregador-repo`

### Policies
- `alocar-ao-confirmar` **Alocar ao confirmar** reage a pedido-confirmado → dispara alocar-entregador — pedido confirmado procura um entregador

### Process managers (sagas)
- `pronto-e-alocado` **Pronto e alocado?**: reage a pedido-pronto, entregador-alocado → dispara retirar-pedido

### Domain services
- `escolhedor-de-entregador` **Escolhedor de entregador** — o entregador livre mais próximo do restaurante

### Application services
- `consulta-de-rastreamento` **Consulta de rastreamento** — mostra a etapa e o tempo restante a partir da projeção

### Read models
- `rastreamento` **Rastreamento** projeta entregador-alocado, pedido-retirado, pedido-entregue, rota-calculada

### Eventos consumidos de outros contextos
- `pedido-confirmado` ← pedidos.pedido-confirmado
- `pedido-pronto` ← cozinha.pedido-pronto
- `rota-calculada` ← mapas.rota-calculada

## Casos de uso e rastreio
- `buscar-pedido-uc` Buscar o pedido (ator: Entregador) → retirar-pedido → entrega-agregado → pedido-retirado ✔
- `entregar-uc` Entregar ao cliente (ator: Entregador) → entregar-pedido → entrega-agregado → pedido-entregue ✔
- `rastrear-uc` Rastrear entrega (ator: Cliente) → consulta-de-rastreamento ✔

## Notas
- O pedido só sai quando duas coisas já aconteceram: ficou pronto na cozinha e um entregador foi alocado. A ordem em que chegam não importa.

## Avisos
- [D011 dica] contexto `entrega` (Entrega) sem ligação com a arquitetura: adicione um componente "system" com ref para o diagrama de arquitetura

## Mermaid
```mermaid
flowchart LR
  subgraph n_entrega["Entrega"]
    n_entregador_ator(["Entregador"])
    n_cliente_ator(["Cliente"])
    n_buscar_pedido_uc["Buscar o pedido"]
    n_entregar_uc["Entregar ao cliente"]
    n_rastrear_uc["Rastrear entrega"]
    n_pedido_confirmado>"Pedido confirmado"]
    n_pedido_pronto>"Pedido pronto"]
    n_rota_calculada>"Rota calculada"]
    n_alocar_ao_confirmar["Alocar ao confirmar"]
    n_alocar_entregador(["Alocar entregador"])
    n_retirar_pedido(["Retirar pedido"])
    n_entregar_pedido(["Entregar pedido"])
    n_pronto_e_alocado["Pronto e alocado?"]
    n_entrega_agregado[["Entrega"]]
    n_parada["Parada"]
    n_entregador[["Entregador"]]
    n_veiculo["Veículo"]
    n_entregador_alocado>"Entregador alocado"]
    n_pedido_retirado>"Pedido retirado"]
    n_pedido_entregue>"Pedido entregue"]
    n_escolhedor_de_entregador["Escolhedor de entregador"]
    n_rastreamento["Rastreamento"]
    n_consulta_de_rastreamento["Consulta de rastreamento"]
    n_entrega_repo["Repositório de entregas"]
    n_entregador_repo["Repositório de entregadores"]
  end
  n_entregador_ator ---|"executa"| n_buscar_pedido_uc
  n_entregador_ator ---|"executa"| n_entregar_uc
  n_cliente_ator ---|"executa"| n_rastrear_uc
  n_retirar_pedido -.->|"realizes"| n_buscar_pedido_uc
  n_entregar_pedido -.->|"realizes"| n_entregar_uc
  n_consulta_de_rastreamento -.->|"realizes"| n_rastrear_uc
  n_pedido_confirmado -.->|"triggers"| n_alocar_ao_confirmar
  n_alocar_ao_confirmar -.->|"triggers"| n_alocar_entregador
  n_alocar_entregador -.->|"triggers"| n_entrega_agregado
  n_alocar_entregador -.->|"emits"| n_entregador_alocado
  n_retirar_pedido -.->|"triggers"| n_entrega_agregado
  n_retirar_pedido -.->|"emits"| n_pedido_retirado
  n_entregar_pedido -.->|"triggers"| n_entrega_agregado
  n_entregar_pedido -.->|"emits"| n_pedido_entregue
  n_entregador_alocado -.->|"triggers"| n_pronto_e_alocado
  n_pedido_pronto -.->|"triggers"| n_pronto_e_alocado
  n_pronto_e_alocado -.->|"triggers"| n_retirar_pedido
  n_entrega_agregado -->|"contains"| n_parada
  n_entregador -->|"contains"| n_veiculo
  n_entrega_agregado ---|"entregador por id"| n_entregador
  n_entregador_alocado -.->|"triggers"| n_rastreamento
  n_pedido_retirado -.->|"triggers"| n_rastreamento
  n_pedido_entregue -.->|"triggers"| n_rastreamento
  n_rota_calculada -.->|"triggers"| n_rastreamento
  n_alocar_entregador -.->|"uses"| n_escolhedor_de_entregador
  n_alocar_entregador -.->|"uses"| n_entrega_repo
  n_consulta_de_rastreamento -.->|"uses"| n_entregador_repo
```

---

<!-- exemplos-ddd/delivery/mapas.archflow.json -->
# Mapas — domínio

> schema archflow/1 · modo domain · 1 contexto(s) · 1 aggregate(s) · 1 caso(s) de uso

## Contexto `mapas` (generic) — Mapas
Calcular rota e tempo de viagem. Problema genérico: usamos um provedor externo e só guardamos o resultado.
_Problema comum e resolvido no mercado (auth, e-mail, pagamento); prefira comprar ou usar pronto._

### Aggregate `rota` (root: Rota)
- value-object: `distancia`
- invariantes: a distância não é negativa
- command `calcular-rota` — pedir ao provedor e guardar o resultado
- evento `rota-calculada` (payload: pedidoId, distanciaMetros, minutos)
- repository `rota-repo`

## Casos de uso e rastreio
- `calcular-rota-uc` Calcular rota (ator: Sistema de entrega) → calcular-rota → rota → rota-calculada ✔

## Avisos
- [D011 dica] contexto `mapas` (Mapas) sem ligação com a arquitetura: adicione um componente "system" com ref para o diagrama de arquitetura

## Mermaid
```mermaid
flowchart LR
  subgraph n_mapas["Mapas"]
    n_sistema_de_entrega(["Sistema de entrega"])
    n_calcular_rota_uc["Calcular rota"]
    n_calcular_rota(["Calcular rota"])
    n_rota[["Rota"]]
    n_distancia["Distância"]
    n_rota_calculada>"Rota calculada"]
    n_rota_repo["Repositório de rotas"]
    n_provedor_de_mapas["Provedor de mapas"]
  end
  n_sistema_de_entrega ---|"executa"| n_calcular_rota_uc
  n_calcular_rota -.->|"realizes"| n_calcular_rota_uc
  n_calcular_rota -.->|"triggers"| n_rota
  n_calcular_rota -.->|"emits"| n_rota_calculada
  n_rota -->|"contains"| n_distancia
  n_calcular_rota -.->|"uses"| n_rota_repo
  n_calcular_rota ---|"consulta"| n_provedor_de_mapas
```

---

<!-- exemplos-ddd/delivery/fidelidade.archflow.json -->
# Fidelidade — domínio

> schema archflow/1 · modo domain · 1 contexto(s) · 1 aggregate(s) · 1 caso(s) de uso

## Contexto `fidelidade` (supporting) — Fidelidade
Pontos por compra e recompensas. Ajuda a reter clientes, mas não é o que diferencia a operação.
_Necessário ao negócio, mas sem diferencial; costuma ser feito sob medida e simples._

### Aggregate `conta-de-pontos` (root: Conta de pontos)
- entity: `lancamento-de-pontos`
- value-object: `pontos`
- invariantes: o saldo de pontos nunca fica negativo
- propriedades de `lancamento-de-pontos`: id: uuid #, pedidoId: uuid, pontos: Pontos
- propriedades de `pontos`: quantidade: inteiro
- command `acumular-pontos` — creditar pontos na conta do cliente
- evento `pontos-acumulados` (payload: contaId, pedidoId, pontos)
- repository `conta-repo`

### Policies
- `pontuar-ao-pagar` **Pontuar ao pagar** reage a pagamento-aprovado → dispara acumular-pontos — pagamento aprovado gera pontos

### Read models
- `saldo-de-pontos` **Saldo de pontos** projeta pontos-acumulados

### Eventos consumidos de outros contextos
- `pagamento-aprovado` ← pagamentos.pagamento-aprovado

## Casos de uso e rastreio
- `ganhar-pontos-uc` Ganhar pontos (ator: Cliente) → acumular-pontos → conta-de-pontos → pontos-acumulados ✔

## Avisos
- [D011 dica] contexto `fidelidade` (Fidelidade) sem ligação com a arquitetura: adicione um componente "system" com ref para o diagrama de arquitetura

## Mermaid
```mermaid
flowchart LR
  subgraph n_fidelidade["Fidelidade"]
    n_cliente(["Cliente"])
    n_ganhar_pontos_uc["Ganhar pontos"]
    n_pagamento_aprovado>"Pagamento aprovado"]
    n_pontuar_ao_pagar["Pontuar ao pagar"]
    n_acumular_pontos(["Acumular pontos"])
    n_conta_de_pontos[["Conta de pontos"]]
    n_lancamento_de_pontos["Lançamento de pontos"]
    n_pontos["Pontos"]
    n_pontos_acumulados>"Pontos acumulados"]
    n_saldo_de_pontos["Saldo de pontos"]
    n_conta_repo["Repositório de contas de pontos"]
  end
  n_cliente ---|"executa"| n_ganhar_pontos_uc
  n_acumular_pontos -.->|"realizes"| n_ganhar_pontos_uc
  n_pagamento_aprovado -.->|"triggers"| n_pontuar_ao_pagar
  n_pontuar_ao_pagar -.->|"triggers"| n_acumular_pontos
  n_acumular_pontos -.->|"triggers"| n_conta_de_pontos
  n_acumular_pontos -.->|"emits"| n_pontos_acumulados
  n_conta_de_pontos -->|"contains"| n_lancamento_de_pontos
  n_lancamento_de_pontos -->|"contains"| n_pontos
  n_pontos_acumulados -.->|"triggers"| n_saldo_de_pontos
  n_acumular_pontos -.->|"uses"| n_conta_repo
```
