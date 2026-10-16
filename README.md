# Archflow

Quadro branco para **arquitetura de software**, inspirado na engenharia reversa do Excalidraw — mas com
modelo semântico (componentes, grupos, conexões tipadas e interfaces), interface *glassmorphism* e um
**servidor MCP** para que LLMs desenhem junto com você, em tempo real.

[![CI](https://github.com/joao2end/Archflow/actions/workflows/ci.yml/badge.svg)](https://github.com/joao2end/Archflow/actions/workflows/ci.yml)
![Licença MIT](https://img.shields.io/badge/licen%C3%A7a-MIT-706fd3)
![Node 22+](https://img.shields.io/badge/node-22%2B-706fd3)
![Windows · Web](https://img.shields.io/badge/plataforma-Windows%20%C2%B7%20Web-706fd3)
![MCP](https://img.shields.io/badge/MCP-26%20tools-706fd3)

> Desenvolvido pela **2.end**.
>
> **Experimente online:** [archflow.2-end.online](https://archflow.2-end.online) — a landing page fica em `/` e o app em [`/app`](https://archflow.2-end.online/app), sem instalar nada.

![Archflow — canvas com o diagrama de exemplo "Plataforma de Pedidos"](docs/screenshots/02-canvas.png)

- Tipografia: Instrument Serif + Inter Tight · Cores: `#706fd3` (primária) e `#f7f1e3` (secundária)
- Documentação técnica: [`docs/REVERSE_ENGINEERING.md`](docs/REVERSE_ENGINEERING.md) · [`docs/PROTOCOL.md`](docs/PROTOCOL.md)

## Sumário

- [Visão geral](#visão-geral)
- [Acesso online](#acesso-online)
- [Instalação e execução](#instalação-e-execução)
- [Versão para Windows (instalador)](#versão-para-windows-instalador)
- [Guia de utilização](#guia-de-utilização)
- [Conectar um agente (MCP)](#conectar-um-agente-mcp)
- [Projeto de diagramas](#projeto-de-diagramas-estilo-obsidian)
- [Endpoints e referências entre diagramas](#endpoints-e-referências-entre-diagramas)
- [Modo Domain (DDD)](#modo-domain-ddd)
- [Recursos](#recursos)
- [Atalhos de teclado](#atalhos-de-teclado)
- [Estrutura do projeto](#estrutura)
- [Contribuindo e segurança](#contribuindo-e-segurança)

## Visão geral

| Landing page (`/`) | Aplicação (`/app`) |
| --- | --- |
| ![Landing page](docs/screenshots/01-landing.png) | ![Aplicação](docs/screenshots/02-canvas.png) |

Diferente de um quadro branco livre, o Archflow guarda **o que cada coisa significa**: um serviço é um serviço,
uma fila é uma fila, e cada conexão tem tipo (síncrona, assíncrona, streaming, UML…). Isso permite que humanos e
LLMs leiam o mesmo diagrama — sem coordenadas e sem ruído visual.

Acesse online em **[archflow.2-end.online](https://archflow.2-end.online)**. Também funciona em **tema escuro** (automático, claro ou escuro):

![Tema escuro](docs/screenshots/10-dark.png)

## Acesso online

O Archflow está publicado em **[archflow.2-end.online](https://archflow.2-end.online)**:

| Endereço | O que é |
| --- | --- |
| [archflow.2-end.online](https://archflow.2-end.online) | Landing page com a demonstração animada das ferramentas e do MCP |
| [archflow.2-end.online/app](https://archflow.2-end.online/app) | O aplicativo, direto no navegador |

Como o site é estático (sem servidor local), o app abre no **modo Memória do navegador**: os projetos ficam no IndexedDB, com pastas,
referências entre diagramas, busca, modo Domain (DDD), validação, geração de código e exportação. Não há pasta em disco, Git nem MCP —
para isso use o [instalador do Windows](#versão-para-windows-instalador) ou `npm run dev`. Faça backup com **Exportar projeto atual** /
**Importar projeto…** no gerenciador de projetos.

## Instalação e execução

Requisitos: **Node.js 22+** (versão usada no desenvolvimento) e npm (ou pnpm).

```bash
npm install
npm run dev      # app em http://localhost:5173/app (a landing fica em /) — já inicia o servidor local (bridge)
```

`npm run dev` sobe tudo: o app **e** o servidor local (porta 7077) que cria projetos, grava os diagramas em disco e fala com o MCP.

**Sem o servidor local** (por exemplo, o app hospedado como site estático) ele entra sozinho no **modo Memória do navegador**:
os projetos ficam no IndexedDB do navegador, com as mesmas pastas, referências entre diagramas, busca e visualização em modal.
O indicador na barra superior fica âmbar ("Memória do navegador"). Limites: nada de pasta em disco, Git, edição externa nem MCP,
e os dados somem se você limpar os dados do site — use **Exportar projeto atual** / **Importar projeto…** (no gerenciador de projetos)
para backup e para levar o projeto a outro navegador.

Produção local:

```bash
npm run build && npm run bridge   # depois abra http://127.0.0.1:7077/app
```

| Script | O que faz |
| --- | --- |
| `npm run dev` | App (Vite) + bridge local |
| `npm run build` | Checagem de tipos + build de produção |
| `npm run bridge` | Servidor local (HTTP/SSE) servindo o build |
| `npm run examples:build` | Regrava os exemplos de DDD em `examples/` (e `-- --check` confere se estão em dia) |
| `npm run eval:domain -- <arquivos>` | Avalia diagramas de domínio contra as metas objetivas (casos de uso rastreados, erros estruturais, itens a corrigir) |
| `npm test` | Testes (modelo, regras de domínio, catálogo, regressão da arquitetura e MCP ponta a ponta) |
| `npm run mcp` | Servidor MCP (stdio) em desenvolvimento |
| `npm run mcp:bundle` | Empacota o MCP (`dist-mcp/`), levado pelo instalador em `resources/mcp/` |
| `npm run mcp:install` / `mcp:check` | Instala o MCP no Cursor, Claude Desktop e Claude Code e testa a conexão / só testa |
| `npm run mcp:smoke -- <exe>` | Testa o MCP de um pacote (`<exe> --mcp`): handshake e lista de ferramentas, sem abrir a janela |
| `npm run skill` | Embute `skills/archflow/SKILL.md` no app |
| `npm run app:pack` | Gera o app desempacotado (`release/win-unpacked`) para testes |
| `npm run icons` | Regenera os ícones do catálogo |
| `npm run typecheck` | Apenas checagem de tipos |
| `npm run app` | Abre o app desktop (Electron) sem gerar instalador |
| `npm run app:dist` | Gera o instalador do Windows em `release/` |
| `npm run app:dist:mac` / `app:dist:linux` | Gera o `.dmg` (macOS) ou o AppImage (Linux) — precisa rodar no próprio sistema |
| `npm run app:icon` | Regenera o ícone do app (`build/icon.*`) |

## Versão para Windows (instalador)

Não quer rodar via Node? Há um **instalador para Windows (x64)** com o app desktop — uma janela própria com o servidor local (bridge) embutido, sem terminal e sem navegador.

1. Baixe o `Archflow Setup <versão>.exe` na página de [**Releases**](https://github.com/joao2end/Archflow/releases/latest) (o repositório é privado: é preciso estar logado no GitHub com acesso).
2. Execute o instalador (pede permissão de administrador). Ele instala em `C:\Program Files\Archflow`, permite trocar a pasta e cria atalhos no Menu Iniciar e na Área de Trabalho.
3. Abra o **Archflow** pelo atalho.

Detalhes:

- O instalador **não é assinado digitalmente**: o SmartScreen pode avisar na primeira execução (*Mais informações → Executar assim mesmo*).
- O app usa a porta **7077**. Se já houver um bridge nela (por exemplo, `npm run dev` rodando), ele é reutilizado em vez de subir outro.
- Os projetos e a lista de projetos ficam em `~/.archflow` (compartilhados com a versão de desenvolvimento); sem configuração prévia, o projeto padrão é `Documentos\Archflow`.
- Para conectar um agente (MCP) ao app instalado, veja [Conectar um agente](#conectar-um-agente-mcp) — o bridge fica em `http://127.0.0.1:7077` e o MCP é o próprio `Archflow.exe --mcp`.

### macOS e Linux

Na mesma página de Releases:

- **macOS:** `Archflow-<versão>-mac-arm64.dmg` (Apple Silicon) ou `-mac-x64.dmg` (Intel). Abra o `.dmg` e arraste o Archflow para *Aplicativos*. O app não é notarizado pela Apple: se o macOS disser que ele "está danificado" ou não pode ser aberto, rode `xattr -cr /Applications/Archflow.app` uma vez. O MCP é `/Applications/Archflow.app/Contents/MacOS/Archflow --mcp`.
- **Linux (x64):** `Archflow-<versão>-linux-x86_64.AppImage`. Dê permissão de execução (`chmod +x Archflow-*.AppImage`) e abra; distribuições recentes podem pedir o pacote `libfuse2`. O MCP é o próprio AppImage com `--mcp`.

### Gerar o instalador

```bash
npm install
npm run app:dist   # build + bundle do Electron + instalador NSIS em release/
```

Os pacotes de macOS e Linux são gerados pelo workflow [`release.yml`](.github/workflows/release.yml) ao publicar uma tag `v*` (ou manualmente, em *Actions › Release › Run workflow*, informando a tag) e anexados à release.

Se o `electron-builder` falhar com `EPERM` ao extrair o Electron (comum com antivírus ativo), rode `node node_modules/electron/install.js` e depois
`npx electron-builder --win nsis -c.electronDist=node_modules/electron/dist`.

## Guia de utilização

### 1. Monte o diagrama com a biblioteca

Pressione **`B`** (ou clique no ícone de grade no dock) para abrir a **Biblioteca**: ~155 tecnologias organizadas por
categoria (Linguagens, Frameworks, Bancos de Dados, Mensageria, AWS, Google Cloud, Azure & IBM, IA & LLM, Modelos de IA…).
Cada item explica **o problema que resolve**. Use a busca (**`/`**) para achar rápido — por exemplo `laravel`, `fila` ou `cache` —
e **arraste** o item para o quadro. Precisa de algo que não existe? **Novo asset** cadastra uma tecnologia sua (ícone, cor, descrição).

![Biblioteca de componentes](docs/screenshots/03-library.png)

### 2. Conecte os componentes

1. Escolha o **tipo de conexão** na barra inferior: *Síncrona*, *Assíncrona*, *Streaming*, *Acesso a dados* ou uma relação UML
   (*Dependência*, *Herança*, *Implementa*, *Composição*, *Agregação*, *Associação*).
2. Passe o mouse sobre um componente e arraste de um dos pontos **"+"** até outro componente (ou use a ferramenta Conector, **`C`**).
3. Clique na conexão para dar um rótulo, definir o traçado (curva, ortogonal ou reta) e descrever a **interface**
   (operações, métodos, payloads e contrato OpenAPI/AsyncAPI).

### 3. Agrupe e organize

- **`G`** cria um **grupo** (cloud, rede, camada, *bounded context*…). Arraste um componente para dentro para agrupá-lo; grupos podem ser aninhados.
- **`N`** adiciona uma **nota** (útil para registrar decisões de arquitetura).
- **`L`** (horizontal) / **`Shift+L`** (vertical) aplica o **auto-layout**; **`F`** ajusta o zoom para caber tudo.
- **`Ctrl+Z` / `Ctrl+Y`** desfazem e refazem; **`Ctrl+D`** duplica; **`Del`** exclui.

### 4. Edite os detalhes no inspetor

Clique em um componente para abrir o **inspetor** à direita: nome, tecnologia/versão, responsabilidade (o que faz), tipo, grupo,
**endpoints e comunicação** (`+ GET`, `+ POST`, `+ GraphQL`, `+ gRPC`, `+ Webhook`, `+ SSE`, `+ Evento`…) e propriedades livres.

![Inspetor de componente](docs/screenshots/09-inspector.png)

### 5. Organize seus diagramas no projeto

Pressione **`E`** para abrir o **explorador do projeto**: árvore de pastas e diagramas, filtro, criar diagrama/pasta, renomear (`F2`),
duplicar, arrastar para mover e menu de contexto (botão direito). **`Ctrl+O`** abre a busca rápida de diagramas.

![Explorador do projeto](docs/screenshots/04-explorer.png)

### 6. Compartilhe com uma LLM

Clique em **Visão LLM** para ver o diagrama como um modelo de linguagem o enxerga — ids semânticos, relações explícitas e o papel
de cada tecnologia — em **Markdown**, **Mermaid** ou **JSON**, mais o **Guia do schema**. Cole no seu chat ou use o MCP.

![Visão LLM](docs/screenshots/05-llm.png)

### 7. Exporte

O menu **Arquivo** salva o diagrama como `.archflow.json`, importa outro diagrama e exporta em **SVG** ou **PNG (2×)**.

![Menu Arquivo](docs/screenshots/07-arquivo.png)

### 8. Peça ajuda

O botão **?** (ou a tecla `?`) mostra todos os atalhos e dicas.

![Atalhos e dicas](docs/screenshots/08-ajuda.png)

## Conectar um agente (MCP)

O servidor MCP (stdio) está **embutido no `Archflow.exe`** — sem Node, npm nem código-fonte. O botão **MCP** da barra superior
mostra os comandos já com o caminho do seu exe, e a aba **Skill para os modelos** entrega o guia de uso para o agente:

![Modal Conectar um agente (MCP)](docs/screenshots/06-mcp.png)

**Um clique:** na modal, **Instalar** grava a entrada `archflow` no Claude Desktop, Claude Code (via `claude mcp add`), Cursor ou Windsurf (preserva o resto do arquivo e faz cópia `.bak`) e **testa a conexão na hora**: o botão **Testar** inicia o servidor igual ao cliente e faz o handshake MCP; se falhar, mostra a causa real (ex.: arquivo inexistente, “Connection closed”). **Instalar em tudo e testar** faz isso nos clientes encontrados. **Abrir no Cursor** usa o deeplink de instalação. O Cursor recarrega sozinho; os outros pedem para reiniciar.

**Pelo terminal (desenvolvimento):**

```bash
npm run mcp:install              # reconstrói o bundle, instala em todos os clientes encontrados e testa
npm run mcp:install -- cursor    # só um: cursor | claude-desktop | claude-code | windsurf
npm run mcp:check                # só testa o que já está instalado (não altera nada)
```

O comando gravado usa `node` com **caminhos absolutos** (o bundle `dist-mcp/` se estiver em dia com o código, senão o `tsx` local do projeto), nunca `npx` nem a pasta atual do processo.

**Manual** (troque pelo caminho do seu exe; o padrão do instalador é `C:\Program Files\Archflow\Archflow.exe`):

```bash
claude mcp add --scope user archflow -- "C:\Program Files\Archflow\Archflow.exe" --mcp
```

```json
{ "mcpServers": { "archflow": { "command": "C:\\Program Files\\Archflow\\Archflow.exe", "args": ["--mcp"] } } }
```

No **macOS** o executável fica dentro do `.app` (com o app em *Aplicativos*):

```bash
claude mcp add --scope user archflow -- /Applications/Archflow.app/Contents/MacOS/Archflow --mcp
```

```json
{ "mcpServers": { "archflow": { "command": "/Applications/Archflow.app/Contents/MacOS/Archflow", "args": ["--mcp"] } } }
```

No **Linux** use o caminho absoluto do AppImage (ex.: `~/Applications/Archflow-<versão>-linux-x86_64.AppImage --mcp`).

Para conferir se o MCP de um pacote responde, sem abrir a janela: `npm run mcp:smoke -- <caminho do executável>`.

Quando o agente conecta, o servidor **abre o app Archflow sozinho** (se ainda não estiver aberto) e edita o diagrama pelo bridge dele — você acompanha ao vivo.
Em desenvolvimento use `npx tsx server/mcp.ts` (o botão MCP mostra o comando certo para cada modo).

### Skill para os modelos

`skills/archflow/SKILL.md` ensina o modelo a usar o Archflow (fluxo, tools, vocabulário, erros comuns). Ela fica disponível:

- por **npx**, direto do GitHub: `npx skills add joao2end/Archflow --skill archflow` (acrescente `-a claude-code -y` para instalar sem perguntas no Claude Code); o comando também está na modal MCP;
- na modal **MCP → Skill para os modelos**: instalar no Claude Code (`~/.claude/skills/archflow/`), copiar, baixar `SKILL.md` ou baixar como regra do Cursor (`.cursor/rules/archflow.mdc`);
- pelo próprio MCP: resource `archflow://skill` + `instructions` enviadas ao cliente na conexão.

O texto é editado em `skills/archflow/SKILL.md`; `npm run skill` (já parte do `npm run build`) o embute em `src/shared/skill.generated.ts`.

Com o app aberto (o indicador **MCP sincronizado** fica verde), peça: *"Use o archflow para desenhar uma arquitetura de pedidos com Laravel, Postgres e SQS"*.
Edições do agente aparecem ao vivo (`Ctrl+Z` desfaz).

## Projeto de diagramas (estilo Obsidian)

Um **projeto** é uma pasta qualquer do disco; seus diagramas são arquivos `.archflow.json` em subpastas livres e, no modo Agents, o harness exportado (`.claude/`, `.cursor/`) fica na raiz dele. A pasta oculta `.archflow/` guarda `project.json` e a lixeira — como o `.obsidian/`.

- **Explorador** (tecla `E` ou botão do projeto no dock): árvore de pastas e diagramas, filtro, criar diagrama/pasta, renomear (`F2`), duplicar, **arrastar para mover** entre pastas, menu de contexto (botão direito) e exclusão para a lixeira do projeto.
- **Vários projetos:** o nome do projeto no topo do explorador abre o gerenciador — *Criar novo projeto* (nome + local), *Abrir pasta como projeto* e a lista dos seus projetos. Na primeira execução o app oferece isso automaticamente.
- **Busca rápida** (`Ctrl+O`): encontra qualquer diagrama do projeto por título ou caminho; se não existir, cria.
- Cada pasta lembra o último diagrama aberto; a árvore lembra quais pastas estão expandidas. Edições externas (editor, git) são recarregadas ao vivo.
- **MCP:** `list_diagrams`, `open_diagram`, `new_diagram { title, folder? }`. O agente nunca troca de projeto — isso é decisão sua.
- **Exportar imagem (MCP):** `export_image { format: svg | png | both, name?, out?, background?, scale? }` grava o diagrama igual à tela, com as fontes embutidas no SVG. A janela do Archflow precisa estar aberta.
- Sem o bridge, o app segue funcionando com salvamento no navegador + importar/exportar JSON.
- Config: `~/.archflow/config.json` (projetos, ativo, último aberto). Variáveis: `ARCHFLOW_DATA` (projeto padrão), `ARCHFLOW_CONFIG`, `ARCHFLOW_PORT`, `ARCHFLOW_TERM` e `ARCHFLOW_TERM_MAX` (terminal do Claude Code, modo Agents).
- Vem de uma versão em que projetos se chamavam *cofres*? Nada a fazer: a lista e as pastas antigas (`.archflow/vault.json`) são migradas na primeira abertura.

## Endpoints e referências entre diagramas

- **Componentes de comunicação:** um serviço *expõe* endpoints — REST (GET/POST/PUT/PATCH/DELETE), GraphQL (query/mutation/subscription), WebSocket, gRPC, Webhook, SSE e Evento. Adicione pelos botões "+ GET", "+ POST"… no inspetor do serviço, ou solte um item da categoria **Comunicação** da biblioteca sobre ele. Eles ficam presos ao serviço e aceitam conexões.
- **Referência a outro diagrama:** arraste um diagrama do explorador para o quadro (ou use *Outro diagrama* na biblioteca). Clique nele para **visualizar em modal**; dentro do modal, clique em outras referências para entrar nelas e use **← →** (ou Alt+←/→) para navegar. *Editar* abre o diagrama e o botão **Voltar** retorna. O explorador mostra **Referenciado por** (backlinks) e os links são atualizados ao renomear/mover arquivos.
- MCP: `add_endpoints`, `get_diagram_outline` e `add_components` com `ref`.

## Apresentar a arquitetura

No modo **Architecture**, a tecla `P` abre a apresentação e um painel de slides. Cada slide acende no quadro só o que importa e, ao lado, conta a história: a **responsabilidade** (`description` do componente ou do grupo), a tecnologia, os **endpoints**, as **conexões** (rótulo, protocolo e descrição), o **contrato** (`interface`, com as operações) e as **notas** incluídas naquele passo.

Sem um roteiro gravado, o app monta um automático: visão geral, um slide por componente na ordem do fluxo e, no fim, as notas. Para definir a ordem, o agente usa `set_presentation` (uma lista de passos com `title`, `text` e `focus`). `steps` vazio apaga o roteiro. Ids que não existem mais aparecem como aviso na validação e somem do slide.

Teclas no painel: `→`/`←` (ou PageDown/PageUp) trocam o slide, `Home`/`End` vão às pontas, `▶` reproduz sozinho (7 s por slide) e `S` mostra ou oculta o painel.

## Modo Domain (DDD)

Todo diagrama tem um **modo**, mostrado como selo ao lado do título: **Arch** (arquitetura: serviços, bancos, filas) ou **Domain** (o negócio com DDD). Crie um diagrama de domínio pelo ícone de camadas do explorador (ou `new_diagram` com `mode: "domain"`); o selo abre a modal com a troca de modo, a **validação** e a **visão geral do projeto**.

- **Paleta própria:** categoria *Domain* com Aggregate Root, Entity, Value Object, Domain Event, Command, Policy, Repository, Domain/Application Service, Use Case, Read Model e Process Manager (nomes em inglês, explicação em pt-BR no tooltip). Cada elemento é colorido pelo papel, como os post-its de Event Storming.
- **Relações com semântica:** no inspetor da conexão, *Relação de domínio* (`emits`, `triggers`, `contains`, `references-by-id`, `realizes`, `context-relation`) e, entre contextos, o **padrão do Context Map** (ACL, Customer/Supplier, Shared Kernel…). Grupos `context` ganham **subdomain** (core, supporting, generic).
- **Validação com regras DDD** (D001–D032, incluindo conectores e fluxo), cada aviso com id, severidade e clique para selecionar o elemento: caso de uso sem command, command sem aggregate, evento sem produtor, aggregates ligados por objeto…
- **Estrutura por contexto + visão geral:** um diagrama por bounded context e um **mapa de contextos** (componentes *Outro diagrama* ligados por `context-relation`). A aba *Visão geral do projeto* consolida contextos, eventos publicados/consumidos e o rastreio dos casos de uso.
- **Casos de uso → projeto:** peça ao agente (MCP) para modelar a partir de casos de uso: `add_use_cases`, `add_components` com `ddd`, `connect` com `ddd.rel`, `validate_diagram` e `trace` (caso de uso → command → aggregate → evento). Repetir é seguro e o agente reaproveita os ids ao retomar um diagrama que você editou.
- **Linha do tempo (Event Storming):** no *Layout automático* escolha *Linha do tempo* (ou `auto_layout` com `style: "timeline"`): raias ator → caso de uso → command → aggregate → evento → policy → read model, com os commands na ordem de `ddd.step`.
- **Código:** a aba *Código (TypeScript)* da modal do selo (ou `generate_code`) gera o esqueleto por contexto na regra application → domain: aggregates com entities e value objects, eventos, repositories, commands, handlers, policies e sagas, mais `use-cases.md` com o rastreio. A lógica fica como TODO e o resultado compila em modo estrito.
- **Qualidade medida:** `npm run eval:domain -- diagrama.archflow.json` confere se ≥ 90% dos casos de uso estão rastreados, sem erros estruturais de DDD, no máximo 2 itens a corrigir e sem elementos duplicados.
- Diagramas de arquitetura **não mudam**: a saída de antes do modo domínio é preservada byte a byte (teste de regressão).

- **Regras dos conectores:** no modo Domain cada conexão é uma relação (`emits`, `triggers`, `contains`, `references-by-id`, `realizes`, `uses`, `context-relation`) que só liga os papéis certos; o tipo vem da relação e `sync`/`async`/`stream`/`data` não existem aqui. Ao ligar dois elementos, se só uma relação serve, a conexão já nasce com ela.
- **Decisões, condições, loops e iteração (só no modo Domain):** o papel *Decision* (exclusiva, paralela ou junção) com um ramo por conexão, **condição** e **senão** nas conexões `triggers`/`emits`, **loop** marcado na conexão que volta a um passo anterior (com condição de parada obrigatória) e **para cada**. As regras D024 a D032 conferem a forma do fluxo (decisão com 2+ ramos e um senão, junção com 2+ entradas, ciclo por decisão exige loop declarado) e o código gerado leva os ramos para tipos. Veja o guia em [docs/DDD.md](docs/DDD.md).
- **Switch Arch | Domain** na barra superior (sem diálogo; Ctrl+Z desfaz) e, ao lado, o atalho da validação.
- **Guia animado de DDD:** novo em DDD? O botão ▶ ao lado do selo de modo (ou **Guia de DDD** no quadro vazio e na modal do modo) abre *DDD em 8 passos*: cenas animadas de valor do negócio, bounded context, use case → command, aggregate, domain event, policy, context map e uma receita rápida do zero ao domínio.
- **Exemplos prontos** (arquitetura, domínio e lógica: do primeiro diagrama a 15 algoritmos): seção *Exemplos* do explorador → *Instalar e abrir*. Os de DDD (biblioteca, clínica, loja, banco, delivery) também estão na pasta [`examples/`](examples/README.md). O guia [docs/DDD.md](docs/DDD.md) explica DDD do zero e como cada conceito aparece no Archflow.

### Modo Logic (regras de negócio)

Um terceiro modo, **Logic**, descreve uma regra de negócio específica (precificação, elegibilidade, frete…) como um **fluxo executável**: Start → regras, decisões sim/não, escolhas, laços e paralelos → End. As condições e efeitos são expressões curtas em português (`preco := max(preco, piso)`, `travar preco`) e o app mostra a explicação em português ao lado. Cada regra e cada cenário levam **exemplos que o app executa**: o ✔ ou ✘ aparece no quadro, a validação `L001–L024` aponta o que falha e a reprodução (▶) mostra o valor mudando passo a passo. Pelo MCP: `new_diagram` com `mode: "logic"`, `add_components` com `logic`, `connect` com `logic.branch` e `auto_layout` em `pipeline`. Exemplo completo (engine de precificação, 11 regras e 30 exemplos) em [`examples/exemplos-logic/`](examples/exemplos-logic/); desenho e decisões em [docs/LOGIC_MODE_DESIGN.md](docs/LOGIC_MODE_DESIGN.md).

### Modo Agents (time de IA e harness)

O modo **Agents** desenha um time de agentes de IA: subagentes (`agent`), skills (do catálogo ou escritas no app) e as setas `uses-skill` e `delegates`. Skills no grupo **Global** valem para todos os agentes.

- **Exportar o harness:** o botão ⬇ ao lado da validação (ou a aba *Harness* da modal) gera `agents/*.md` e `skills/<nome>/SKILL.md` para **Claude Code** (`.claude/`) ou **Cursor** (`.cursor/`). Com um projeto aberto, os arquivos são gravados **dentro da pasta do projeto** — é onde as duas ferramentas procuram. No modo navegador (sem servidor local), vem um `.zip` com a mesma árvore para descompactar na raiz do seu repositório.
- **Pelo MCP:** `generate_code { target: "claude" | "cursor" }` devolve os arquivos, e `generate_code { write: true }` grava direto no projeto aberto.
- **Terminal do Claude Code:** o botão **Terminal** da barra abre o `claude` dentro do app, na pasta do projeto, para você executar prompts contra o harness que o diagrama gerou. Funciona no app desktop e no navegador com `npm run dev` (precisa do servidor local e do [Claude Code](https://docs.claude.com/en/docs/claude-code/setup) instalado e autenticado). O painel avisa se o harness está desatualizado e oferece sincronizar; no inspetor de cada agente, **▶ Testar no Claude Code** abre uma sessão com `Use o subagente <nome> para: ` já digitado (você completa e confirma com Enter). Na primeira vez numa pasta nova o Claude Code pergunta se você confia nela e pede aprovação dos servidores do `.mcp.json`; isso é feito no próprio terminal. As sessões ficam no servidor local: recolher o painel ou recarregar a página não as encerra (use o **×** da aba). O terminal só escuta em `127.0.0.1` e exige mesma origem e um token; veja [SECURITY.md](SECURITY.md). **Prompts e workflows:** são componentes do diagrama (papéis **Prompt** e **Workflow** na paleta do modo agents). No inspetor do **Prompt** você escreve o texto com `{{variáveis}}` e escolhe um subagente opcional (seta `runs-on`); o botão **Prompts** do painel lista os do diagrama e os executa numa sessão nova ou na atual (o texto é digitado, você confirma). Projetos antigos com `.archflow/prompts.json` oferecem importar a biblioteca para o diagrama. Um **Workflow** liga prompts por setas `step` (posição e modo ficam na seta, editáveis no inspetor do workflow); cada passo é **manual** (o texto é digitado numa sessão interativa; você confirma e clica em «Próximo passo») ou **automático** (`claude -p` numa aba própria, que o Archflow espera terminar; o primeiro que falhar para a execução, e dá para tentar de novo, pular ou parar). **Todos os passos continuam a mesma conversa do Claude Code** (`--session-id` no primeiro, `--resume` nos seguintes): passos manuais seguidos reaproveitam a mesma aba, e a aba interativa é encerrada antes de um passo automático, porque dois processos não podem usar a mesma conversa ao mesmo tempo (a conversa fica salva). Os passos automáticos não conseguem pedir aprovação: ferramentas que exigem permissão são negadas, a menos que você escolha «Aceitar edições» ou «Só planejar»; o Archflow nunca usa `--dangerously-skip-permissions`. Variáveis: `ARCHFLOW_TERM=0` desliga, `ARCHFLOW_TERM_MAX` limita as sessões (padrão 4). Testado no macOS; Windows e Linux dependem do `node-pty` (no Linux ele é compilado na instalação).

Detalhes de projeto, regras e decisões do modo Domain: [docs/DOMAIN_MODE.md](docs/DOMAIN_MODE.md). Para testar a UI sem tocar nos seus diagramas: `node scripts/dev-sandbox.mjs` (projeto temporário, portas próprias).

## Recursos

- **Biblioteca** com ~155 tecnologias (AWS, Google, Azure/IBM, Anthropic, OpenAI, modelos de IA (Claude Opus/Sonnet/Haiku, GPT, Gemini, Llama…), PHP/Laravel, Swagger, MySQL/MariaDB/Postgres/Mongo, mensageria, DevOps…), cada uma com *o problema que resolve*; cadastre as suas (ícone, cor, descrição).
- **Conexões**: síncrona, assíncrona, streaming, dados + UML (dependência, herança, implementação, composição, agregação, associação), animadas; traçado curva/ortogonal/reta; **interface** (operações, métodos, payloads, contrato OpenAPI/AsyncAPI).
- **Grupos** aninháveis (cloud, rede, camada, bounded context…), auto-layout, undo/redo, exportação JSON/SVG/PNG, **Visão LLM** (Markdown/Mermaid/JSON).
- Tema **claro, escuro ou automático** (botão na barra superior ou `T`; a escolha fica salva).

## Atalhos de teclado

| Ação | Atalho | Ação | Atalho |
| --- | --- | --- | --- |
| Selecionar | `V` | Mover tela | `H` / `Espaço` |
| Grupo | `G` | Conector | `C` |
| Nota | `N` | Biblioteca | `B` |
| Buscar asset | `/` | Auto-layout horizontal / vertical | `L` / `Shift+L` |
| Ajustar à tela | `F` | Animações on/off | `A` |
| Desfazer / refazer | `Ctrl+Z` / `Y` | Alternar tema | `T` |
| Duplicar | `Ctrl+D` | Busca rápida de diagramas | `Ctrl+O` |
| Explorador do projeto | `E` | Selecionar tudo | `Ctrl+A` |
| Excluir | `Del` | Renomear · editar interface | Duplo clique |
| Selecionar vários | `Shift+clique` | Zoom | `Ctrl+roda` |
| Cancelar / fechar | `Esc` | Ajuda | `?` |

## Estrutura

```
src/shared   schema, catálogo, operações semânticas, layout, describe()  (usado por UI, bridge e MCP)
src/ui       canvas SVG, painéis, modais, store, sincronização
server       bridge HTTP/SSE e servidor MCP
electron     casca desktop (Electron) que embute o bridge
build        ícones do app (icon.ico / icon.png)
scripts      build-icons.ts (extrai ícones do Iconify logos/simple-icons) · build-app-icon.ts (ícone do app)
docs         documentação técnica e screenshots usados neste README
```

## Contribuindo e segurança

Quer ajudar? Veja o [guia de contribuição](CONTRIBUTING.md) (ambiente, testes e convenções). Para reportar vulnerabilidades, siga o [SECURITY.md](SECURITY.md). Licença: [MIT](LICENSE).

Ícones: Iconify *logos* e *simple-icons* (marcas pertencem aos respectivos donos; uso para identificação em diagramas).
