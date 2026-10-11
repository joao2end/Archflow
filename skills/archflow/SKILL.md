---
name: archflow
description: Desenha e edita diagramas de arquitetura de software no Archflow (quadro branco com MCP). Use quando o usuário pedir para desenhar, documentar, revisar ou evoluir uma arquitetura — serviços, bancos, filas, APIs, endpoints, fronteiras de nuvem/rede — ou mencionar Archflow, "diagrama de arquitetura", cofre de diagramas ou as tools add_components/connect/auto_layout. Também modela o DOMÍNIO com DDD (bounded contexts, aggregates, commands, eventos, casos de uso, context map): use quando o usuário falar de DDD, domínio, casos de uso, event storming ou pedir para transformar requisitos em modelo.
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
| `auto_layout` | Reorganiza. `direction` LR (padrão) ou TB; `spacing` compact / comfortable / spacious. No modo domain, `style: "timeline"` posiciona em raias de Event Storming. |
| `set_diagram_info` | Título e descrição do diagrama. |
| `validate_diagram` | Aponta referências quebradas e componentes isolados. |
| `clear_diagram` | **Destrutivo.** Só com pedido explícito do usuário. |
| `list_diagrams` · `open_diagram` · `new_diagram` · `get_diagram_outline` | Navegar o cofre: listar, abrir, criar (opcionalmente em subpasta, com `mode`) e resumir outro diagrama sem abri-lo. |
| `add_use_cases` · `trace` · `domain_overview` · `generate_code` | **Modo domain**: criar casos de uso, rastreá-los até o evento, ver o domínio inteiro do cofre e gerar o esqueleto de código. Ver a seção abaixo. |

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

## Modo domain (DDD): do caso de uso ao modelo

Todo diagrama tem um **modo**: `architecture` (padrão; serviços, bancos, filas) ou `domain` (o negócio). `new_diagram` aceita `mode: "domain"`; `set_diagram_info` troca o modo. **No modo domain o vocabulário é outro: chame `get_schema_guide` antes de começar** (ele devolve o guia do modo do diagrama aberto) e não use assets de tecnologia.

Estrutura no cofre: **um diagrama por bounded context** + um **mapa de contextos** (visão geral), tudo em `dominio/`.

Fluxo (casos de uso → projeto DDD):
1. `new_diagram` com `mode: "domain"` por contexto (e um `Visão geral`). **Confirme com o usuário os contextos e o subdomain** (core, supporting, generic) antes de criar: é decisão dele, a heurística é só sugestão.
2. `add_groups` com `kind: "context"` e `subdomain`; `add_use_cases` com os casos de uso (ator + objetivo). Repetir é seguro: ids existentes são ignorados.
3. `add_components` com `ddd: { role, ... }` (kind vira `domain`): `aggregate-root`, `entity`, `value-object`, `command`, `domain-event`, `policy`, `repository`, `domain-service`, `application-service`, `read-model`, `process-manager`. Cada papel aceita só os seus campos (a tool recusa o resto e diz quais valem).
4. `connect` com `ddd: { rel }` — **sem `type`**: ele vem da relação (sync/async/stream/data não existem no modo domain). Relações e quem elas ligam: `contains` (aggregate/entity → entity/value-object), `triggers` (command → aggregate-root; evento → policy/saga/read-model; policy/saga → command), `emits` (command/aggregate/saga → evento), `realizes` (command/serviço → use-case), `uses` (command/policy/saga/serviço → domain-service/repository), `references-by-id` (aggregate → OUTRO aggregate, nunca por objeto) e `context-relation` + `pattern` entre contextos (`from` = upstream). Se você omitir `ddd` e só uma relação servir para o par, a conexão já nasce com ela; ator → caso de uso é `association`. Combinação inválida = aviso D021/D022 com a sugestão do que serve.
5. `validate_diagram` e `trace`: corrija os **erros** (D001 caso de uso sem command, D002 command sem aggregate, D003 evento sem produtor, D004/D005 aggregates, D008 repository) antes de responder; `aviso` e `dica` informam. Diga ao usuário o que você inferiu e o que ficou sem resolver.
6. `auto_layout` com `style: "timeline"` (raias: ator → caso de uso → command → aggregate → evento → policy → read model → estrutura; commands na ordem de `ddd.step`). Num mapa de contextos use `kind: "system"` + `ref` para cada contexto e `context-relation` entre eles; `domain_overview` consolida o cofre.
7. Se o usuário quiser código: `validate_diagram` limpo e então `generate_code` (TypeScript): devolve os arquivos em Markdown (um diretório por contexto, application → domain, lógica como TODO) para você gravar no projeto dele. Não invente a lógica: o que o modelo não sabe fica como TODO.

Heurísticas (sempre como sugestão, marque em `description`): verbo no imperativo = command; fato no passado = evento; substantivo com identidade = entity; sem identidade = value-object. Commands e eventos têm nomes diferentes (`criar-pedido` / `pedido-criado`). Ao retomar um diagrama que o usuário editou, **releia com `get_diagram` e reutilize os ids**; não recrie o que existe.

**Decisões, condições e loops (só modo domain):** use o papel `decision` (`question`, `gate`: exclusive | parallel | join) entre um evento/policy/saga e os commands que seguem; cada saída é uma conexão `triggers` com `ddd.condition` (ou `ddd.otherwise` para o *senão*). Command com dois desfechos: duas conexões `emits`, uma com `condition` e outra com `otherwise`. **Loop**: a conexão que VOLTA a um passo anterior leva `ddd.loop: { until, max }` (sem parada é erro D029). **Iteração**: `ddd.foreach`. Regras D024 a D032 (decisão com 2+ ramos e um senão, junção com 2+ entradas, ciclo por decisão exige loop). Nada disso existe no modo architecture.

Exemplos prontos para consultar ou instalar: pasta `exemplos-ddd/` do cofre do usuário (botão ✨ do explorador) ou `examples/` do projeto (biblioteca, clínica, loja, banco); o guia conceitual é `docs/DDD.md`. Ao explicar DDD ao usuário, use um deles como referência concreta.

## Convenções que evitam retrabalho

- **Ids são slugs estáveis e legíveis**: `orders-api`, `orders-db`, `aws-cloud`. Reutilize-os em `parent`, `from`, `to`, `owner`. Sem `id`, o app gera um a partir do label.
- **`label` curto** (nome do componente); **`technology`** com stack e versão (`Laravel 11 / PHP 8.3`); **`description`** com a *responsabilidade* em uma frase.
- **Cada conexão precisa de `label`** dizendo o que trafega (`POST /orders`, `order.created`) e, quando útil, `protocol` (`HTTPS/REST`, `AMQP`).
- Use `interface` na conexão para registrar o contrato: `{ name, kind, contract?, operations: [{ name, method, path, request, response }] }`.
- Para conectar a um endpoint específico, passe o **id do endpoint** em `from`/`to` (o relatório da tool devolve o id criado).
- **Descreva a estrutura (modo domain).** Em `ddd.properties` liste os campos de aggregate, entity, value object, command (parâmetros), evento (payload) e read model: `{ name, type, optional?, key?, description? }`. O app mostra isso no passo a passo da apresentação e gera os campos no código.
- **Não informe `x`/`y`/tamanho.** Termine sempre com `auto_layout` (`spacing: "spacious"` se ficar apertado).
- **Modele para ser legível** (o layout só organiza, não conserta excesso): até ~8 componentes por grupo/contexto e ~6 conexões por componente; divida em vários diagramas ou use `kind: "system"` + `ref` quando passar disso; nomeie cada conexão com o que trafega; evite componentes sem conexão; declare a conexão no sentido do fluxo (quem chama → quem responde). Detalhes em `docs/LAYOUT.md`.
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
- **Usar tecnologia (asset) no modo domain**, ou `ddd` num diagrama `architecture` → a tool recusa; crie o diagrama com `mode: "domain"`.
- **Inventar componentes** que o usuário não mencionou sem avisar → registre as suposições numa `add_note` ou no resumo final.

## Ao editar um diagrama existente

Leia (`get_diagram`), preserve ids e a estrutura que o usuário montou, altere o mínimo necessário e só rode `auto_layout` se ele pedir ou se você adicionar muitos elementos — o usuário pode ter posicionado tudo à mão.
