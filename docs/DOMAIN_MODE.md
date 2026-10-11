# Modo Domain (DDD) no Archflow

Este documento descreve o modo Domain **como ele é hoje**: o que o código faz e como verificar. Quando o código muda, este arquivo muda junto (há testes que cobrem cada afirmação marcada com ✔ na seção 12).

## 1. Objetivo

Modelar o **domínio** de uma aplicação com DDD, de modo que:

1. uma IA **leia e escreva** o modelo sem ambiguidade (papéis, campos e relações explícitos, validação com regras nomeadas);
2. **casos de uso** virem um projeto DDD com rastreio (caso de uso → command → aggregate → evento);
3. o domínio conviva com o diagrama de **arquitetura** (macro) sem se misturar com ele;
4. o modelo possa virar **código** (esqueleto) e ser **medido** objetivamente.

## 2. Estrutura

### Modo do diagrama
`Doc.mode` é `"architecture"` (padrão; o campo não é gravado) ou `"domain"`. É aditivo: diagramas anteriores continuam válidos e geram **exatamente** a mesma saída ✔. Troca-se o modo em `set_diagram_info`/`set_meta` (nada é apagado) ou na modal do selo ao lado do título.

### Dois campos novos no schema (`archflow/1` não mudou de versão)
- `NodeKind "domain"` (único kind novo) + `NodeEl.ddd = { role, ...campos do papel }`.
- `ConnectionEl.ddd = { rel, pattern? }` e `GroupEl.subdomain` (só em grupos `context`).
- Ids continuam slugs estáveis. Um nó `domain` sem `ddd.role`, ou `ddd` num nó de outro kind, é reportado como aviso estrutural.

### Estrutura no cofre
Um diagrama por bounded context e um **mapa de contextos** (visão geral), por convenção em `dominio/`:

```
dominio/visao-geral.archflow.json   mapa de contextos: um componente system (ref) por contexto, ligados por context-relation
dominio/pedidos.archflow.json       um bounded context completo (aggregates, commands, eventos, casos de uso)
dominio/pagamentos.archflow.json
arquitetura/macro.archflow.json     modo architecture (inalterado)
```
O vínculo macro ↔ domínio é o `ref` dos componentes `system` (a navegação, o botão Voltar e a reescrita de caminhos ao renomear/mover já existiam).

## 3. Papéis (`ddd.role`) e campos

Fonte única: `DDD_ROLES` em `src/shared/schema.ts` (catálogo, validador, UI e guia da IA derivam dela). Campo fora do papel é **rejeitado** pela op, com a lista dos campos válidos.

| Papel | Selo | Campos | Para quê |
|---|---|---|---|
| `aggregate-root` | AGG | `invariants` | ponto de entrada do aggregate |
| `entity` | ENT | `invariants` | identidade própria dentro de um aggregate |
| `value-object` | VO | `invariants` | valor imutável, sem identidade |
| `domain-event` | EVT | `payload`, `producedBy`, `external`, `step` | fato no passado; `external: "contexto.evento"` = cópia local de evento de outro contexto |
| `command` | CMD | `intent`, `invariants`, `step` | intenção no imperativo; `step` ordena a linha do tempo |
| `policy` | POL | `intent`, `reactsTo`, `issues` | evento → command, sem estado |
| `repository` | REPO | `for` | coleção persistente de um aggregate-root |
| `domain-service` | DS | `intent` | regra que não cabe em um aggregate; pura |
| `application-service` | APP | `intent` | orquestra um caso de uso; sem regra de negócio |
| `use-case` | UC | `actor`, `goal`, `realizedBy` | objetivo de um ator |
| `read-model` | READ | `projectsFrom` | projeção para consulta (CQRS) |
| `process-manager` | SAGA | `intent`, `reactsTo`, `issues`, `compensates` | saga com estado e compensação |
| `decision` | DEC | `question`, `gate` | ponto de decisão do fluxo: `exclusive` (um ramo), `parallel` (todos) ou `join` (espera todas as entradas) |

Nomes em inglês (termos da área); a explicação em pt-BR vai no tooltip e no callout do inspetor. Grupos `context` recebem `subdomain`: `core`, `supporting` ou `generic`.

## 4. Relações, conectores e Context Map

No modo domain cada conexão é uma **relação** com significado. `connect` aceita `ddd: { rel }`, o `type` visual **vem da relação e é fixo**, e cada relação só liga os papéis certos (matriz `DDD_REL_PAIRS`, fonte única da validação, da inferência, do seletor do inspetor e do guia da IA):

| `rel` | `type` | Liga (de → para) |
|---|---|---|
| `emits` | async | command, aggregate-root ou process-manager → domain-event |
| `triggers` | dependency | command → aggregate-root; domain-event → policy / process-manager / read-model; policy / process-manager → command; **fluxo condicional:** domain-event / policy / process-manager / decision → decision; decision → command / policy / process-manager |
| `contains` | composition | aggregate-root / entity → entity / value-object |
| `references-by-id` | association | aggregate-root / entity → aggregate-root **de outro aggregate**; nunca por objeto |
| `realizes` | realization | command / domain-service / application-service → use-case |
| `uses` | dependency | command / policy / process-manager / application-service / domain-service → domain-service / repository (quem orquestra usa; o aggregate nunca depende de repository) |
| `context-relation` | association | bounded context ↔ bounded context (grupo `context` ou componente `system` com `ref` **fora** de um contexto), com `pattern` |

### Fluxo: decisões, condições, loops e iteração (só no modo Domain)

Em DDD o fluxo emerge dos eventos; a lógica condicional vive no aggregate e na saga. O Archflow mostra os ramos e as repetições que importam ao negócio com construções **estruturadas** (documentação validada, não execução):

| Construção | Representação | Rótulo na conexão |
|---|---|---|
| Condição de um ramo | `ddd.condition` em `triggers`/`emits` | `se atraso > 0` |
| Ramo padrão | `ddd.otherwise: true` (não combina com `condition`) | `senão` |
| Decisão | nó `decision` (`question`, `gate`); cada saída é uma conexão `triggers` | losango no canvas, `Decision · exclusiva` |
| Paralelo / junção | `gate: "parallel"` (todos os ramos) / `"join"` (espera todas as entradas) | |
| Loop | `ddd.loop { until?, max? }` na conexão que **volta** a um passo anterior (ao menos um dos dois) | `repete até pago, máx. 3` |
| Iteração | `ddd.foreach` | `para cada item do pedido` |

Os campos se combinam no rótulo (`para cada item · se x · repete máx. 2`) e o texto livre vem depois; o rótulo acompanha ao editar e preserva o texto livre ✔. **Só valem em `triggers` e `emits`** e **só no modo Domain**: as ops recusam em diagramas de arquitetura e em outras relações ✔. Regras D024–D032 na seção 5. No **código gerado**, cada decisão vira uma classe (`decide(event)` devolve a união dos ramos; paralela devolve a lista; junção tem `canContinue(arrived)`), e loops e iterações entram na documentação do handler ✔. O `describe` traz as seções *Decisões* e *Fluxo condicional, loops e iterações*.

### Regras dos conectores
- **O tipo vem da relação.** `sync`, `async`, `stream` e `data` (infraestrutura) **não existem** no modo domain: as ops os recusam com mensagem acionável; o `async` de `emits` é inferido. Um `type` que contradiz a relação também é recusado ✔.
- **Sem `ddd`, a relação é inferida** quando só uma serve para o par (command → evento = `emits`; aggregate → aggregate = `references-by-id`…) ✔. Quando nenhuma serve (ator → caso de uso), o conector é um **tipo UML livre** (`association` por padrão; também `dependency`, `inheritance`, `realization`, `composition`, `aggregation`).
- **`update`:** definir `ddd` sem dizer o `type` ajusta o tipo; trocar o `type` de uma conexão com relação é recusado; remover a relação (`ddd: null`) libera os tipos UML ✔.
- **Na UI:** o conector da barra não pede tipo (a relação é inferida); no inspetor a grade de tipos mostra só os tipos UML e some quando há relação (o tipo é definido por ela); o seletor *Relação de domínio* desabilita as relações que não ligam aquele par e diz quais servem.
- **Validação (arquivos importados ou editados fora do app):** D021 (combinação de papéis inválida, com a sugestão), D022 (infraestrutura ou elementos de domínio ligados sem relação) e D023 (tipo contradiz a relação).

`pattern`: `shared-kernel`, `customer-supplier`, `conformist`, `acl`, `ohs`, `published-language`, `partnership`, `separate-ways`. Nos padrões assimétricos (customer-supplier, conformist, acl, ohs) **`from` é o upstream** e `to` o downstream.

**Rótulo:** entre contextos o padrão sempre aparece e o texto livre vem depois (`Customer/Supplier · pedido-criado`); nas demais relações o texto livre substitui o automático. O inspetor preserva o texto livre ao trocar relação ou padrão ✔.

## 5. Regras de validação

`validateDetailed` devolve `{ rule, severity, target, message }`; `validate` devolve texto (`[D002 erro] …`). Em `architecture` nenhuma regra D* roda ✔. No modo domain, a regra de "componente isolado" da arquitetura é **substituída** por D012.

| Id | Sev. | Regra |
|---|---|---|
| D001 | erro | `use-case` sem realização (`realizedBy` válido ou `realizes` de entrada) |
| D002 | erro | `command` sem **exatamente um** `triggers` para um `aggregate-root` |
| D003 | erro | `domain-event` sem produtor (`producedBy` válido ou `emits` de entrada); eventos `external` são isentos |
| D004 | erro | `entity` fora de qualquer aggregate (sem caminho de `contains` até uma raiz) ou em mais de um; `aggregate-root` contido em outro |
| D005 | erro | conexão entre membros de aggregates diferentes que não seja `references-by-id` |
| D006 | aviso | conexão que cruza contextos sem `context-relation`; `external` fora do formato `contexto.evento`. No cofre (`domain_overview`): evento externo cujo contexto/evento não existe ou sem relação entre os contextos na visão geral |
| D007 | aviso | `value-object` com `references-by-id` (entrada ou saída): teria identidade |
| D008 | erro | `repository` sem `for` ou com `for` que não é `aggregate-root` |
| D009 | aviso | contexto sem nenhum `aggregate-root` · dica: diagrama de domínio sem elementos DDD (um mapa de contextos não conta como vazio) |
| D010 | dica | nomes (heurística): command que parece passado; evento que parece imperativo |
| D011 | dica | contexto sem componente `system` com `ref` (ligação com a arquitetura) |
| D012 | aviso | isolado e sem referência: aggregate-root, policy, domain-service, application-service, ator, system, external |
| D013 | aviso | `application-service` com invariantes (só chegam por arquivo importado) ou que emite eventos |
| D014 | dica | contexto sem `subdomain` |
| D015 | dica | contexto `generic` com mais de 5 aggregates |
| D016 | dica | ciclo de `references-by-id` entre aggregates |
| D017 | aviso | `system` com `ref` para diagrama inexistente (precisa do cofre); no cofre, quando existe uma visão geral: contexto que não aparece nela |
| D018 | erro | `process-manager` sem evento de entrada ou sem command de saída |
| D019 | erro | `read-model` sem evento de origem (`projectsFrom` ou `triggers` de um evento), ou que emite eventos |
| D020 | erro | campo `ddd` (`realizedBy`, `producedBy`, `for`, `reactsTo`, `issues`, `compensates`, `projectsFrom`) aponta para id inexistente |
| D021 | aviso | combinação de papéis inválida para a relação (matriz de §4), com a sugestão do que serve; `context-relation` sem `pattern` |
| D022 | aviso | conector de infraestrutura (`sync`/`async`/`stream`/`data`) sem relação, ou conexão entre dois elementos de domínio sem relação (sugere as que servem) |
| D023 | aviso | o tipo da conexão contradiz a relação (ex.: `emits` como `sync`) |
| D024 | erro | decisão (exclusiva ou paralela) com menos de 2 ramos; junção sem saída |
| D025 | aviso | ramo de decisão exclusiva sem condição e sem ser o senão; mais de um ramo senão |
| D026 | aviso | decisão exclusiva sem ramo senão (se nenhuma condição valer o fluxo para) |
| D027 | erro / aviso | junção com menos de 2 entradas (erro); decisão sem entrada (aviso) |
| D028 | aviso | decisão dentro de um ciclo sem nenhuma conexão marcada como loop |
| D029 | erro | loop sem condição de parada (nem `until` nem `max`; só chega por arquivo importado) |
| D030 | dica | loop que o diagrama não mostra voltando a um passo anterior (o retorno pode passar por um sistema externo) |
| D031 | aviso | condição ou senão em ramo de decisão paralela (todos os ramos seguem) |
| D032 | aviso | condição, senão, loop ou para cada em relação que não é de fluxo (arquivo importado) |

Casos de borda: evento sem consumidor é válido; um use-case pode ser realizado por commands de vários aggregates (D002 vale por command); entity aninhada alcança a raiz por `contains` encadeado.

## 6. O que a IA lê

- **`describe`** (`get_diagram`): contextos → aggregates (entities, value objects, invariantes, commands, eventos, repository) → policies, sagas, serviços, read models → casos de uso com rastreio (`→ criar-pedido → pedido → pedido-criado ✔` ou `✘ sem realização (D001)`) → relações entre contextos → avisos com id de regra → Mermaid. Determinístico ✔.
- **`trace`**: caminho de um caso de uso até o evento, com os problemas.
- **`domain_overview`**: todos os diagramas de domínio do cofre: mapa de contextos, aggregates/commands/eventos publicados e consumidos por contexto, % de casos de uso rastreados e avisos (inclui D006/D017 entre diagramas).
- **`get_schema_guide`** responde pelo modo do diagrama aberto e traz papéis, campos, relações, padrões, convenções e o fluxo recomendado; `list_assets`/`search_assets` também respeitam o modo.

## 7. Ferramentas

| Tool (MCP) | Modo domain |
|---|---|
| `new_diagram` | `mode: "domain"` |
| `set_diagram_info` | `mode` |
| `add_groups` | `subdomain` (kind context) |
| `add_components` | `ddd: { role, ... }` (kind vira `domain`) ou um asset `ddd-*` |
| `connect` | `ddd: { rel, pattern? }`, `type` inferido |
| `add_use_cases` | casos de uso + ator (reaproveitado pelo nome); ids existentes são ignorados (idempotente) |
| `validate_diagram` | regras D001–D032 |
| `trace` | caso de uso → command → aggregate → evento |
| `domain_overview` | visão consolidada do cofre |
| `auto_layout` | `style: "timeline"` |
| `generate_code` | esqueleto TypeScript |

HTTP (bridge e cofre do navegador): `POST /api/diagrams { title, folder?, mode? }`, `GET /api/vault/docs`, `GET /api/schema?mode=`.

## 8. Interface

- **Switch Arch | Domain** na barra superior, ao lado do título: troca o modo na hora, sem diálogo (nada é apagado; Ctrl+Z desfaz) ✔. Ao lado, no modo Domain, o atalho da validação com a contagem de erros/avisos; ele abre a modal **Domínio (DDD)** com três abas: **Validação** (clicável, seleciona o elemento), **Visão geral do cofre** e **Código (TypeScript)**, e o botão *Novo mapa de contextos*. A posição do switch não muda ao alternar ✔.
- Explorador: ícone de camadas (e item do menu de contexto) cria diagrama de domínio; ✨ abre os **Exemplos de DDD** (também no estado vazio do modo Domain).
- Biblioteca: no modo domain mostra a categoria *Domain* (um asset por papel), o ator e *Outro diagrama*; "Mostrar também as tecnologias" libera o resto. Em architecture a categoria Domain não aparece.
- Canvas: elementos coloridos pelo papel com selo (AGG, CMD, EVT…); grupos mostram `CONTEXT · CORE`.
- **Nomes e rótulos completos** ✔: o rótulo de uma conexão é desenhado **acima** dos nós (nunca fica escondido atrás de um componente) e a largura da pílula é a do texto medido no navegador; o nome de um componente quebra em até 3 linhas (a linha secundária, tecnologia ou papel, sai do desenho quando o nome usa as 3) e o nome inteiro está no tooltip e no campo *Nome* do inspetor. Só um nome maior que 3 linhas termina em "…".
- Inspetor: papel e campos do papel (selects de id, listas, invariantes uma por linha), relação de domínio (só as que ligam o par) e padrão do Context Map, subdomain.
- Layout automático: estilo **Linha do tempo** ou **Fluxo**.

## 9. Layout "linha do tempo" (Event Storming)

`layout` com `style: "timeline"` (só no modo domain). Cada contexto vira um bloco; as raias (de cima para baixo, vazias são comprimidas) são **evento externo → ator → caso de uso → command → aggregate → evento → policy/saga → read model → estrutura** (entity, value object, repository, serviços). Colunas = tempo: commands ordenados por `ddd.step` e depois pela ordem do documento; caso de uso e ator na coluna do command que os realiza, aggregate na do primeiro command que o aciona, evento na de quem o produz, policy/saga uma coluna depois do evento (ou na do command que dispara, se só reage a eventos externos), read model na do evento que o alimenta, entities/value objects/repository na primeira coluna livre a partir da do aggregate. **Eventos de outros contextos** (`external`) ficam na raia de entrada, na coluna de quem reage a eles, e por isso não alargam o diagrama ✔. Determinístico e idempotente ✔; blocos de contextos ficam empilhados sem se tocar.

## 10. Geração de código

`generate_code` (MCP) e a aba *Código* geram, por contexto e na regra de dependência application → domain:

```
<contexto>/domain/event-publisher.ts   DomainEvent, EventPublisher
<contexto>/domain/events.ts            um interface por evento (payload como campos opcionais `unknown`)
<contexto>/domain/<aggregate>.ts       aggregate-root + entities + value objects; um método por command (retorna os eventos)
<contexto>/domain/<repository>.ts      interface do repository (nome do nó, ou <Aggregate>Repository)
<contexto>/domain/services.ts          domain services
<contexto>/application/commands.ts     um interface por command
<contexto>/application/<command>-handler.ts
<contexto>/application/reactions.ts    policies, sagas (com compensate), decisões (classes tipadas pelos ramos), read models, application services
<contexto>/use-cases.md                rastreio dos casos de uso (✔/✘)
```
A lógica fica como TODO (o modelo sabe nomes, invariantes, intenção, eventos e quem aciona quem, não o comportamento). Nomes são sanitizados (acentos, dígitos iniciais, globais como `Date`/`Error`, colisões) e o resultado **compila em modo estrito** ✔. Só TypeScript hoje; outra linguagem é recusada com mensagem clara.

## 11. Fluxo com IA (casos de uso → projeto)

1. `new_diagram` (`mode: "domain"`) por contexto + um mapa de contextos; a IA confirma contextos e subdomain com o usuário.
2. `add_groups` (context + subdomain) e `add_use_cases`.
3. `add_components` com `ddd`, `connect` com `ddd.rel`.
4. `validate_diagram` e `trace`; corrigir D001–D005/D008 antes de responder.
5. `auto_layout` com `style: "timeline"`; opcionalmente `generate_code`.
6. Round-trip: ao retomar um diagrama editado, ler com `get_diagram` e **reaproveitar os ids**; `add_use_cases` ignora ids existentes.

### Metas mensuráveis
`npm run eval:domain -- <arquivos>` (e `evaluateDomain` em `src/shared/domain.ts`) avalia um modelo produzido sem revisão humana: **≥ 90%** dos casos de uso rastreados até um evento, **0** erros estruturais (D004, D005, D008, D018, D019), **≤ 2** itens a corrigir (erros + avisos) e **nenhum elemento duplicado** (mesmo papel e nome). Sai com código 1 se alguma meta falhar ✔.

## 12. Verificação

`npm test` (node:test via tsx) e `npm run typecheck`:

| Arquivo | Cobre |
|---|---|
| `src/shared/domain.test.ts` | schema/ops (rejeições com mensagem acionável), as regras D001–D021 com caso positivo e negativo, rastreio, `describe`, visão geral do cofre, rótulos, `reshapeDdd`, `evaluateDomain` |
| `src/shared/connectors.test.ts` | a matriz de relações, a inferência (`suggestRels`), o tipo fixo pela relação, recusa de infraestrutura nas ops (`add_connection` e `update`), D021, D022, D023 |
| `src/shared/arch.golden.test.ts` | **regressão**: a saída de arquitetura é idêntica byte a byte à do commit anterior ao modo domínio (`fixtures/arch-golden.json`) |
| `src/shared/catalog.test.ts` | categoria Domain derivada de `DDD_ROLES`, paleta por modo, `add_node` por asset |
| `src/shared/flow.test.ts` | decisões, condição/senão, loop, para cada: validação de entrada, só no modo domain, rótulos, D024–D032, descrição, layout e código gerado que compila |
| `src/shared/storm.test.ts` | raias, ordem por `step`, colunas, eventos externos na raia de entrada, sem sobreposição, blocos de contextos, idempotência |
| `src/shared/text.test.ts` | quebra de nomes em linhas sem perder palavras (`wrapLabel`) |
| `src/shared/codegen.test.ts` | estrutura e conteúdo; **compila com `tsc --strict`**, inclusive com nomes difíceis |
| `src/shared/examples.test.ts` | os 4 exemplos: validam sem erros nem avisos, todo caso de uso rastreado, metas de qualidade, cobrem todos os papéis e relações, eventos entre contextos existem dos dois lados, arquivos de `examples/` em dia, esqueleto compila, ids citados nos README existem, links relativos da documentação resolvem |
| `src/shared/evalscript.test.ts` | `eval:domain` (exit 0/1/2) |
| `server/mcp.e2e.test.ts` | sobe o MCP real com bridge e cofre temporários: casos de uso → modelo → validação → rastreio → timeline → código → visão geral; regras dos conectores via MCP; a skill documenta todas as tools |

A UI foi verificada no navegador com `node scripts/dev-sandbox.mjs` (cofre temporário, portas próprias; configuração `vite-sandbox` em `.claude/launch.json`): criação de diagrama de domínio, paleta, inspetor, troca de relação/padrão, undo, validação clicável, visão geral com dois contextos, layout em linha do tempo, aba de código, switch de modo (posição estável), rótulos completos e a instalação de um exemplo pelo diálogo (mapa de contextos → contexto → backlinks). Não há teste automatizado de UI.

## 13. Limites conhecidos

- A geração de código cobre só TypeScript e não grava em disco (devolve os arquivos; quem chama decide onde salvar).
- D010 é heurística (português e inglês) e por isso só gera dica.
- A visão geral consolida diagramas do cofre aberto; não há geração de código nem avaliação para o cofre inteiro de uma vez (rode por diagrama).
- Modelos grandes ficam largos na linha do tempo (uma coluna por command).
- O arquivo `.archflow.json` guarda `ddd` livremente: validação estrita acontece nas ops e no `validate`, não na leitura de arquivos importados.

## 14. Exemplos e guia de DDD

- [`docs/DDD.md`](DDD.md): guia para quem nunca usou DDD (subdomínios, linguagem ubíqua, bounded context, os 8 padrões do Context Map, cada peça tática com a pergunta que ajuda a decidir, método dos casos de uso ao modelo, regras dos conectores, erros comuns e glossário).
- [`examples/`](../examples/README.md): 4 exemplos completos em ordem de dificuldade, cada um com mapa de contextos, um diagrama por contexto, o modelo em texto (`modelo.md`, gerado) e um README com a história, como ler, as decisões de modelagem e exercícios: **Biblioteca** (iniciante), **Clínica** e **Loja** (intermediário; a loja inclui o diagrama de arquitetura ligado aos contextos) e **Banco** (avançado, com saga de compensação).
- **No app:** explorador → ✨ *Exemplos de DDD* → *Instalar e abrir* cria `exemplos-ddd/<exemplo>/` no cofre aberto, sem sobrescrever nada (se a pasta já existir, só abre). Os exemplos são definidos como ops em `src/shared/examples.ts`; `npm run examples:build` grava os arquivos de `examples/` (e `-- --check` confere).
- Juntos os exemplos usam os 13 papéis, as 7 relações, os 3 subdomínios e as construções de fluxo (a retentativa da loja é uma decisão com loop; a biblioteca tem condição e senão; a reserva de estoque itera "para cada item"); padrões do Context Map ilustrados: `customer-supplier`, `partnership`, `shared-kernel` e `published-language` (o `acl` aparece na loja como o tradutor do gateway; `conformist`, `ohs` e `separate-ways` estão explicados em `docs/DDD.md`).

## Passo a passo na apresentação

Em diagramas `domain`, o modo apresentação abre o painel **Passo a passo** (tecla `S` mostra/oculta). Cada caso de uso vira uma história: ator → caso de uso → command → aggregate → evento → reações (policy, saga, decisão, read model) → commands seguintes. Ordem causal garantida (o aggregate vem antes do evento que ele emite); ciclos são mostrados como "volta e repete".

A cada passo o quadro esmaece o resto, destaca o elemento atual, anima as conexões que levaram até ele e move a câmera. O painel mostra **O que é** (definição do papel + o que o autor escreveu: descrição, intenção, payload, objetivo…), **Por que está aqui**, **Regras que sempre valem** (invariantes) e **Caminhos a seguir** (condição, "senão", loop, "para cada"). Preencha `description`, `intent`, `payload` e `invariants` para a narrativa ficar rica.

Teclas: `→`/`↓`/PageDown avança, `←`/`↑`/PageUp volta, `Home`/`End`, botão ▶ reproduz sozinho (7 s por passo). Código: `src/shared/story.ts` (narrativa, pura e testada) e `src/ui/story.tsx` (painel).

O seletor tem sempre a história **Diagrama completo**, que passa por todos os elementos (entities, value objects, repositories, serviços e contextos do mapa inclusive), além de uma história por caso de uso. Quando não há caso de uso, ela é a única.

## Propriedades (campos) dos elementos

Aggregate root, entity, value object, command (parâmetros), domain event (campos do payload) e read model (colunas) aceitam `ddd.properties`: uma lista de `{ name, type?, optional?, key?, description?, example? }` que explica a estrutura campo a campo.

- **Interface**: no inspetor, a seção *Propriedades* é uma tabela (nome, tipo com sugestões, `#` identificador, `?` opcional, descrição). *Colar JSON / texto* importa de uma vez e aceita lista JSON, mapa `{ "id": "uuid" }`, JSON Schema (`properties`/`required`), um exemplo de objeto ou texto (`#id: uuid — chave`, `nota?: texto`, um por linha ou separados por vírgula). *Substituir* troca tudo; *Acrescentar* mantém as atuais (mesmo nome = atualiza). *Copiar JSON* exporta.
- **MCP / ops**: `ddd.properties` em `add_components` (validado: nomes únicos, tipos de campo).
- **Onde aparece**: tabela no passo a passo da apresentação, `get_diagram`/descrição do modelo (`propriedades de x: id: uuid #, total: Dinheiro`) e o código gerado (classes de Entity e Value Object com construtor tipado, campos do aggregate, interfaces de comando e de evento). O `type` vira tipo TypeScript: primitivos conhecidos (`texto`, `inteiro`, `data`, `uuid`…), listas (`Item[]`, `lista de Item`) e o nome de outro elemento do mesmo aggregate; qualquer outro vira `unknown` com o tipo original num comentário.
