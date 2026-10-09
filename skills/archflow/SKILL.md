---
name: archflow
description: Desenha e edita diagramas de arquitetura de software no Archflow (quadro branco com MCP). Use quando o usuário pedir para desenhar, documentar, revisar ou evoluir uma arquitetura — serviços, bancos, filas, APIs, endpoints, fronteiras de nuvem/rede — ou mencionar Archflow, "diagrama de arquitetura", cofre de diagramas ou as tools add_components/connect/auto_layout.
---

# Archflow — como diagramar arquitetura via MCP

O Archflow é um quadro branco de arquitetura. O usuário vê o diagrama numa janela do app e **cada tool que você chama aparece ali em tempo real** (e ele pode desfazer com Ctrl+Z). Você trabalha com **componentes, grupos e conexões semânticos — nunca com pixels**: posições são opcionais e o app calcula o layout.

## Antes de começar

1. As tools do servidor MCP `archflow` precisam estar disponíveis (`get_schema_guide`, `add_components`, `connect`…). Se não estiverem, peça ao usuário para conectar o MCP pelo botão **MCP** do app e reiniciar o cliente.
2. O app abre sozinho quando o servidor MCP inicia. Se uma tool falhar com erro de conexão, peça para abrir o Archflow e tente de novo.
3. Todas as tools editam o **diagrama aberto** no momento. Chame `list_diagrams` para saber qual é e o que existe no cofre (vault).

## Fluxo recomendado (siga a ordem)

1. **Entender o pedido.** Se faltar contexto essencial (stack, fronteiras, escala), pergunte pouco e objetivamente; senão assuma defaults razoáveis e diga quais.
2. **Ler o estado.** `get_diagram` (markdown) — nunca desenhe por cima sem ler. Diagrama vazio é normal.
3. **Achar assets.** `list_assets` (catálogo completo por categoria) e/ou `search_assets` (ex.: `laravel`, `postgres`, `sqs`). **Sempre prefira um `asset` do catálogo** a criar um componente genérico: ele traz ícone, cor e o problema que a tecnologia resolve. Só use `add_asset` se nada servir.
4. **Estruturar.** `add_groups` para fronteiras (cloud, rede, camada, contexto, time) e depois `add_components` com `parent` = id do grupo.
5. **Expor interfaces.** `add_endpoints` para os pontos de comunicação de cada serviço (REST, GraphQL, WebSocket, gRPC, webhook, SSE, evento).
6. **Conectar.** `connect` com `type`, `label` e `protocol`; use `interface` quando o contrato importar.
7. **Organizar e revisar.** `auto_layout`, depois `validate_diagram` e `get_diagram` para ler os avisos e corrigir.
8. **Resumir** para o usuário o que foi criado e as suposições feitas.

Agrupe chamadas: cada tool aceita **listas** (`components`, `connections`…) — crie vários itens de uma vez em vez de uma chamada por item.

## Tools

| Tool | Para quê |
| --- | --- |
| `get_schema_guide` | Vocabulário completo (kinds, tipos de conexão). Leia se tiver dúvida. |
| `list_assets` / `search_assets` | Catálogo de tecnologias (AWS, GCP, Azure, Laravel, bancos, mensageria, IA, DevOps…). Retorna ids para `asset`. |
| `get_diagram` | Lê o diagrama: `markdown` (padrão, melhor p/ raciocinar), `mermaid` ou `json`. |
| `add_components` | Cria componentes. Campos: `id`, `label`, `asset`, `kind`, `technology`, `description`, `parent`, `props`, `ref`. |
| `add_endpoints` | Cria endpoints presos a um serviço (`owner`). Campos: `protocol`, `method`, `path`, `request`, `response`, `auth`. |
| `add_groups` | Cria grupos/fronteiras, aninháveis via `parent`. |
| `connect` | Cria conexões tipadas entre componentes/endpoints. |
| `update_element` | Altera campos de qualquer elemento (`id` + `patch`). |
| `remove_elements` | Remove por id (conexões ligadas somem; filhos de grupo sobem de nível). |
| `add_note` | Nota de texto livre: decisões (ADR curto), riscos, TODOs. |
| `add_asset` | Cadastra tecnologia própria/interna no diagrama (exige `problem`). |
| `auto_layout` | Reorganiza. `direction` LR (padrão) ou TB; `spacing` compact / comfortable / spacious. |
| `set_diagram_info` | Título e descrição do diagrama. |
| `validate_diagram` | Aponta referências quebradas e componentes isolados. |
| `clear_diagram` | **Destrutivo.** Só com pedido explícito do usuário. |
| `list_diagrams` · `open_diagram` · `new_diagram` · `get_diagram_outline` | Navegar o cofre: listar, abrir, criar (opcionalmente em subpasta) e resumir outro diagrama sem abri-lo. |

Resources: `archflow://diagram` (diagrama atual em markdown), `archflow://schema` (guia do schema) e `archflow://skill` (este guia).

## Vocabulário

**Componente (`kind`)**: `service` (API/backend) · `client` (web, mobile, CLI) · `actor` (pessoa/papel) · `database` · `cache` · `queue` (fila, broker, stream) · `gateway` (API gateway, proxy, LB) · `external` (SaaS de terceiros) · `ai` (modelo/serviço de IA) · `infra` (plataforma, CI/CD, observabilidade) · `library` · `endpoint` (use `add_endpoints`) · `system` (referência a outro diagrama).
Com `asset`, o `kind` já vem do catálogo — não repita.

**Grupo (`kind`)**: `cloud` · `network` · `cluster` · `layer` · `context` (bounded context) · `boundary` (fronteira de confiança) · `team`.

**Conexão (`type`)** — escolha pela semântica, não pela aparência:

| type | Use para |
| --- | --- |
| `sync` | Request/response bloqueante: REST, gRPC, GraphQL, RPC |
| `async` | Mensagem/evento fire-and-forget: SQS, Kafka, pub/sub, webhook |
| `stream` | Fluxo contínuo: WebSocket, SSE, CDC, vídeo |
| `data` | Leitura/escrita em banco, cache ou storage |
| `dependency` · `association` | Dependência de código / relação genérica (UML) |
| `inheritance` · `realization` | extends · implements (UML) |
| `composition` · `aggregation` | Parte-todo forte · fraco (UML) |

## Convenções que evitam retrabalho

- **Ids são slugs estáveis e legíveis**: `orders-api`, `orders-db`, `aws-cloud`. Reutilize-os em `parent`, `from`, `to`, `owner`. Sem `id`, o app gera um a partir do label.
- **`label` curto** (nome do componente); **`technology`** com stack e versão (`Laravel 11 / PHP 8.3`); **`description`** com a *responsabilidade* em uma frase.
- **Cada conexão precisa de `label`** dizendo o que trafega (`POST /orders`, `order.created`) e, quando útil, `protocol` (`HTTPS/REST`, `AMQP`).
- Use `interface` na conexão para registrar o contrato: `{ name, kind, contract?, operations: [{ name, method, path, request, response }] }`.
- Para conectar a um endpoint específico, passe o **id do endpoint** em `from`/`to` (o relatório da tool devolve o id criado).
- **Não informe `x`/`y`/tamanho.** Termine sempre com `auto_layout` (`spacing: "spacious"` se ficar apertado).
- Entre ~6 e ~25 componentes por diagrama é legível. Passou disso: divida em vários diagramas.

## Vários diagramas e referências

Sistemas grandes viram vários diagramas no mesmo cofre (uma visão geral + um por contexto).
1. `list_diagrams` para ver caminhos (ex.: `pagamentos/checkout.archflow.json`).
2. `get_diagram_outline` para ver componentes de outro diagrama **sem abri-lo**.
3. Na visão geral, crie um componente `kind: "system"` com `ref: { diagram: "<caminho>", node: "<id opcional>" }`.
4. `new_diagram` (com `folder`) cria e já abre; `open_diagram` troca o diagrama que as demais tools editam.

## Exemplo

Pedido: *“Desenhe o fluxo de pedidos: app web, API Laravel, Postgres, fila SQS e worker de e-mail.”*

```
search_assets   → confirme os ids: laravel, postgresql, aws-sqs
add_groups      [{ id: "backend", label: "Backend", kind: "layer" },
                 { id: "aws", label: "AWS", kind: "cloud" }]
add_components  [{ id: "web", label: "App Web", kind: "client" },
                 { id: "orders-api", label: "Orders API", asset: "laravel", technology: "Laravel 11 / PHP 8.3",
                   description: "Cria e consulta pedidos", parent: "backend" },
                 { id: "orders-db", label: "Pedidos", asset: "postgresql", parent: "backend" },
                 { id: "orders-queue", label: "order-events", asset: "aws-sqs", parent: "aws" },
                 { id: "mail-worker", label: "Mail Worker", kind: "service", description: "Envia e-mails", parent: "backend" }]
connect         [{ from: "web", to: "orders-api", type: "sync", label: "POST /orders", protocol: "HTTPS/REST" },
                 { from: "orders-api", to: "orders-db", type: "data", label: "INSERT order" },
                 { from: "orders-api", to: "orders-queue", type: "async", label: "order.created" },
                 { from: "orders-queue", to: "mail-worker", type: "async", label: "consome" }]
auto_layout     { direction: "LR", spacing: "comfortable" }
validate_diagram → "sem problemas"
```

## Erros comuns

- **Asset inexistente** → a tool devolve ids parecidos; use um deles ou `search_assets`.
- **`parent`/`from`/`to` apontando para id que ainda não existe** → crie grupos e componentes *antes* de conectar. Falhas parciais não abortam o lote: leia o relatório `#n ✓ / #n ✗` e corrija só o que falhou.
- **Componentes isolados** (aviso do `validate_diagram`) → conecte-os ou remova-os.
- **Tudo como `sync`** → fila/evento é `async`; acesso a banco é `data`.
- **Recriar do zero** quando só precisava ajustar → prefira `update_element`; nunca `clear_diagram` sem o usuário pedir.
- **Inventar componentes** que o usuário não mencionou sem avisar → registre as suposições numa `add_note` ou no resumo final.

## Ao editar um diagrama existente

Leia (`get_diagram`), preserve ids e a estrutura que o usuário montou, altere o mínimo necessário e só rode `auto_layout` se ele pedir ou se você adicionar muitos elementos — o usuário pode ter posicionado tudo à mão.
