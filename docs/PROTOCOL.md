# Archflow Protocol (AFP/1)

Protocolo para um humano desenhar num quadro branco e um LLM/agente ler e editar o **mesmo diagrama**
de arquitetura de software, em tempo real. Estruturado conforme o template de especificação da
skill *protocol-reverse-engineering*.

## 1. Pesquisa e decisões de design

| Alternativa | Observação | Decisão |
| --- | --- | --- |
| **MCP** (Model Context Protocol, JSON-RPC 2.0 sobre stdio/HTTP) | Padrão para dar *tools* e *resources* a LLMs; Claude Desktop/Code, Cursor, VS Code já falam MCP. | **Camada agente ↔ app** |
| Servidores "Excalidraw MCP" existentes | Expõem o formato visual do Excalidraw (retângulos, setas, coordenadas). Os melhores movem a matemática espacial para o servidor para que o LLM opere em nível semântico. | Seguimos a ideia, mas com **modelo semântico nativo** (não há geometria para o LLM) |
| C4 Model / Structurizr DSL | Vocabulário excelente (pessoa, sistema, container, componente, relação). | Inspirou `kind` de nós, grupos como fronteiras e relações com tecnologia |
| Mermaid / PlantUML | Texto compacto que LLMs escrevem bem, mas sem metadados ricos nem edição ao vivo. | Mantido como **formato de leitura** (`toMermaid`) |
| OpenAPI / AsyncAPI / protobuf | Contratos formais de interface. | Referenciados via `interface.contract`; operações resumidas inline |
| UML (relações) | dependency, association, aggregation, composition, generalization, realization. | Tipos de conexão `dependency … realization` com marcadores UML |

Princípios:
1. **Semântica antes de geometria** — o LLM fala em componentes, grupos e conexões; `x/y/w/h` são opcionais e calculados por auto-layout.
2. **Ids estáveis e legíveis** (`orders-api`) — reutilizados em `parent`, `from`, `to`.
3. **Vocabulário fechado** (`kind`, `type`) com a semântica escrita no schema e nas descrições das tools.
4. **Erros acionáveis** — ex.: asset inexistente devolve ids parecidos.
5. **Leitura em Markdown** — `get_diagram` devolve texto determinístico + Mermaid, e não JSON gigante.

## 2. Arquitetura / transporte

```
 Claude / agente ──MCP (JSON-RPC, stdio)──▶ server/mcp.ts ──HTTP──▶ ┌──────────────┐
                                                                     │ server/bridge │  doc canônico (rev N)
 Navegador (UI) ◀──SSE /api/events──────────────────────────────────▶│  + data/*.json │
                 ──PUT /api/doc, GET /api/doc────────────────────────▶└──────────────┘
```

- **MCP** (stdio): processo iniciado pelo cliente MCP. Ao subir, garante o bridge em `127.0.0.1:7077`
  (`ARCHFLOW_PORT`); se já houver um, reutiliza.
- **Bridge** (HTTP + SSE, somente loopback): guarda o documento e a revisão `rev`, persiste em
  `data/diagram.archflow.json` e notifica as UIs.
- **UI**: `GET /api/doc` ao abrir; `PUT /api/doc` (debounce 300 ms) ao editar; `EventSource /api/events` para receber edições do agente.
  Mudanças do agente entram no histórico → **Ctrl+Z desfaz**.
- Segurança: apenas loopback, CORS aberto só para conveniência local. Sem autenticação — não exponha a porta.

## 3. Modelo de dados — `archflow/1`

```jsonc
{
  "schema": "archflow/1",
  "id": "diagram-ab12cd", "title": "Plataforma de Pedidos", "description": "…",
  "groups": [ { "id":"aws", "label":"AWS", "kind":"cloud", "parent?":"…", "description?":"…", "color?":"#…", "x":0,"y":0,"w":0,"h":0, "auto?":true } ],
  "nodes":  [ { "id":"orders-api", "label":"Orders API", "kind":"service", "asset?":"laravel",
                "technology?":"Laravel 11 / PHP 8.3", "description?":"…", "parent?":"backend",
                "props?":{ "sla":"99.95%" }, "x":0,"y":0,"w":184,"h":72 } ],
  "connections": [ { "id":"web-to-api", "from":"web", "to":"orders-api", "type":"sync",
                     "label?":"POST /orders", "protocol?":"HTTPS/REST", "description?":"…",
                     "routing?":"curve|elbow|straight", "animated?":true,
                     "interface?": { "name":"Orders API v1", "kind":"rest", "contract?":"openapi: ./orders.yaml",
                                     "operations":[ { "name":"createOrder", "method":"POST", "path":"/orders",
                                                     "request":"{items:[{sku,qty}]}", "response":"201 {orderId}", "description?":"…" } ] } } ],
  "notes": [ { "id":"note", "text":"Decisão: …", "x":0,"y":0,"w":200,"h":110 } ],
  "customAssets": [ /* Asset[] cadastrados pelo usuário */ ]
}
```

### Endpoints e referências (extensão de `NodeEl`)
```jsonc
{ "id": "orders-api-post-orders", "kind": "endpoint", "owner": "orders-api",          // endpoint preso ao serviço
  "endpoint": { "protocol": "rest|graphql|websocket|grpc|webhook|sse|event",
                "method": "POST", "path": "/orders", "request": "…", "response": "…", "auth": "Bearer JWT" } }
{ "id": "pagamentos", "kind": "system", "label": "Pagamentos",                          // referência a outro diagrama do cofre
  "ref": { "diagram": "pagamentos/checkout.archflow.json", "node": "pay-api" } }          // node é opcional
```
Operações novas: `add_endpoint { owner, protocol?, method?, path?, … }`; `add_node` aceita `endpoint`, `owner` e `ref`. Remover o serviço remove seus endpoints; o layout os empilha sob o dono.
Rotas novas: `GET /api/diagrams/read?name=` (documento completo) e `GET /api/diagrams/outline?name=` (resumo). Os arquivos do cofre listam `refs[]`; ao renomear/mover diagramas ou pastas o bridge reescreve `ref.diagram` nos demais arquivos.
MCP: `add_endpoints`, `get_diagram_outline`, `list_diagrams` (mostra referências).

### Vocabulário
**`node.kind`**: `service client actor database cache queue gateway external ai infra library`  
**`group.kind`**: `boundary layer cloud network context cluster team`  
**`connection.type`** (animação / UML):

| type | Semântica | Visual |
| --- | --- | --- |
| `sync` | request/response bloqueante (REST, gRPC, GraphQL) | fluxo contínuo |
| `async` | mensagem/evento fire-and-forget (SQS, Kafka, webhook) | partículas pulsantes, tracejado |
| `stream` | fluxo contínuo (WebSocket, CDC, SSE) | rastro de pontos |
| `data` | leitura/escrita em banco/cache/storage | fluxo contínuo (azul) |
| `dependency` | UML dependency | tracejado + seta aberta |
| `inheritance` | UML generalization (extends) | triângulo vazado |
| `realization` | UML realization (implements) | tracejado + triângulo vazado |
| `composition` | UML composition | losango cheio na origem |
| `aggregation` | UML aggregation | losango vazado na origem |
| `association` | relação genérica | linha simples |

### Assets
Cada asset: `{ id, name, category, vendor?, kind, icon, color, problem, description, tags[] }`.
`problem` responde **"que problema esta tecnologia resolve?"** e aparece na UI, no `describe()` e em `search_assets`.
`icon`: `l:<id>` (Iconify *logos*), `s:<id>` (Simple Icons), `g:<glifo>`, `t:<TEXTO>`, URL ou data-URI.
Catálogo embutido: ~155 tecnologias (AWS, Google Cloud, Azure/IBM, IA/LLM, Laravel/PHP, bancos, mensageria, DevOps, observabilidade…).
Usuários cadastram novos pelo modal *Novo asset* (salvo em `localStorage` e embutido em `doc.customAssets`) ou via tool `add_asset`.

## 4. Operações semânticas (`Op`)

Usadas pela UI (`run([...])`), pelo bridge (`POST /api/ops`) e pelo MCP. Falhas parciais não abortam o lote.

| op | campos |
| --- | --- |
| `add_node` | `id? asset? label? kind? technology? description? parent? props? x? y?` |
| `add_group` | `id? label kind? description? parent? color? x? y? w? h?` (sem tamanho ⇒ `auto` ajusta aos filhos) |
| `add_connection` | `from to type? label? protocol? description? interface? routing? animated?` |
| `add_note` | `text x? y?` |
| `update` | `id patch` |
| `remove` | `id` (apaga conexões ligadas; filhos de grupo sobem de nível) |
| `add_asset` | `asset{ name problem … }` |
| `layout` | `direction: LR｜TB` (camadas por fluxo; grupos aninhados dimensionados) |
| `set_meta` / `clear` | título/descrição · esvaziar |

## 5. Mensagens

### 5.1 HTTP (bridge)
| Método | Rota | Corpo → Resposta |
| --- | --- | --- |
| GET | `/api/health` | → `{ ok, rev, title }` |
| GET | `/api/doc` | → `{ rev, doc }` |
| PUT | `/api/doc` | `{ doc, source }` → `{ rev }` |
| POST | `/api/ops` | `{ ops: Op[], source }` → `{ rev, results: [{ ok, id?, error? }] }` |
| GET | `/api/describe` | → `text/markdown` |
| GET | `/api/schema` | → guia do schema (markdown) |
| GET | `/api/events` | → SSE |

### 5.2 SSE
```
event: hello   data: {"rev":12}
event: doc     data: {"rev":13,"doc":{…},"source":"mcp"}
```
`source` identifica o emissor (`ui-xxxxxx` ou `mcp`); a UI ignora eventos próprios e `rev ≤` o último conhecido.

### 5.3 MCP — tools
`get_schema_guide`, `search_assets`, `get_diagram(format: markdown|json|mermaid)`, `add_components`, `add_groups`,
`connect`, `update_element`, `remove_elements`, `add_note`, `add_asset`, `auto_layout`, `set_diagram_info`,
`clear_diagram`, `validate_diagram`. **Resources:** `archflow://diagram`, `archflow://schema`.

### 5.3b Integração MCP
MCP no exe: `Archflow.exe --mcp` (Electron como Node sobre `resources/mcp/archflow-mcp.mjs`); abre o app se o bridge não responder. Resource extra: `archflow://skill`.

| Método | Rota | Resposta |
| --- | --- | --- |
| GET | `/api/mcp/info` | `{ packaged, launch{command,args,cwd?}, clients[{id,label,file,exists,installed}], skill{file,installed} }` |
| POST | `/api/mcp/install` | `{ client: claude-desktop｜cursor｜windsurf }` → mescla `mcpServers.archflow` no arquivo do cliente (com `.bak`) |
| GET | `/api/skill` | `SKILL.md` (markdown) |
| POST | `/api/skill/install` | grava em `~/.claude/skills/archflow/SKILL.md` |

### 5.4 Cofres (vaults) e arquivos
Cofre = pasta; diagramas = `*.archflow.json` em subpastas; `.archflow/` (oculta) = `vault.json` + `trash/`. Caminhos de diagrama são **relativos ao cofre, com "/"** (ex.: `backend/orders.archflow.json`).

| Método | Rota | Corpo → Resposta |
| --- | --- | --- |
| GET | `/api/workspace` | → `{ vault{id,name,path}, configured, vaults[], current, tree, files[] }` (`tree` = pastas/arquivos aninhados; `files` = lista plana) |
| POST | `/api/vaults/create` | `{ name, parent }` → cria a pasta (409 se existir) e abre |
| POST | `/api/vaults/open` · `/switch` · `/remove` | `{ path }` · `{ id }` · `{ id }` (remove só da lista; não apaga a pasta) |
| POST | `/api/diagrams` | `{ title, folder? }` |
| POST | `/api/diagrams/open` · `/rename` · `/duplicate` · `/delete` · `/move` | `{ name }` · `{ name, title }` · `{ name }` · `{ name }` · `{ name, folder }` |
| POST | `/api/folders` · `/rename` · `/delete` | `{ path }` · `{ path, name }` · `{ path }` |
| GET/POST | `/api/fs/list?path=` · `/api/fs/mkdir` | navegador de pastas (marca pastas que já são cofres) |

SSE ganha `event: workspace` (mesmo payload de `GET /api/workspace`). `PUT /api/doc` envia `file` e recebe **409** se o diagrama ativo mudou. `pristine:true` indica cofre recém-criado, que a UI semeia com o rascunho local.
Segurança: o bridge recusa (403) requisições cujo `Host`/`Origin` não sejam localhost; valida cada segmento de caminho (sem `..`, sem nomes iniciados por `.`, sem caracteres inválidos); exclusões movem para `.archflow/trash/`.
MCP: `list_diagrams`, `open_diagram { name }`, `new_diagram { title, folder? }` — sem ferramenta para trocar de cofre (decisão do usuário).

### 5.5 Backend em memória do navegador (sem bridge)
Se `GET /api/workspace` falha (ou devolve algo que não seja um workspace — ex.: `index.html` de hospedagem estática), a UI troca `fetch` por `localFetch` (`src/ui/localVault.ts`), que implementa as MESMAS rotas `/api/doc`, `/api/workspace`, `/api/vaults/*`, `/api/diagrams/*` e `/api/folders/*` sobre o IndexedDB (`archflow-local`: chave `meta` + `vault:<id>`), emitindo localmente os eventos `doc` e `workspace`. Rotas de disco (`/api/fs/*`, `/api/vaults/open`) retornam 400. Extra: `POST /api/vaults/import { bundle }` (pacote `archflow-vault/1`). Sem EventSource, MCP ou edição externa. Uma vez em modo local na sessão, não há troca automática para servidor (evita divergência de dados).

## 6. Máquina de estados (UI ↔ bridge)

```
[BOOT] --GET /api/doc ok--> [ONLINE]
   │                          │ edição local  → PUT (debounce) → rev++
   │ falha                    │ SSE doc (source≠eu) → adota + histórico + toast
   ▼                          │ SSE erro → [OFFLINE] --retry 3s--> [BOOT]
[OFFLINE] (localStorage)
```
Regra de arranque: bridge com conteúdo (`rev>0`) é a fonte de verdade; bridge vazio recebe o documento local.
Concorrência: *last-writer-wins por documento* (suficiente para 1 humano + agentes; para multiusuário use `rev` otimista ou CRDT por elemento como o Excalidraw faz com `version/versionNonce`).

## 7. Exemplo de sessão

```
Agente → search_assets {query:"fila"}                → "- aws-sqs | Amazon SQS | AWS | queue | Fila gerenciada…"
Agente → add_groups   {groups:[{id:"aws",label:"AWS",kind:"cloud"}]}
Agente → add_components {components:[
          {id:"orders-api",asset:"laravel",label:"Orders API",parent:"aws",description:"Cria pedidos"},
          {id:"events",asset:"aws-sqs",parent:"aws"} ]}
Agente → connect {connections:[{from:"orders-api",to:"events",type:"async",label:"OrderCreated",
          interface:{name:"order.created",kind:"event",operations:[{name:"OrderCreated",method:"PUBLISH",path:"order-events"}]}}]}
Agente → auto_layout {direction:"LR"}
Agente → get_diagram {}                              → markdown + Mermaid (revisar "Avisos")
UI     ← SSE doc (source: mcp)                       → toast "Diagrama atualizado pelo agente — Ctrl+Z desfaz"
```

## 8. Extensões futuras
- Fallback offline com File System Access API (pasta escolhida direto no navegador)
- Autenticação por token no bridge e modo remoto (WebSocket + criptografia fim-a-fim como o Excalidraw).
- Reconciliação por elemento (`version`) para vários humanos.
- Importação de OpenAPI/AsyncAPI → conexões com `interface` preenchida; exportação C4/Structurizr.
