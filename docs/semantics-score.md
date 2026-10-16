# Matriz semântica — componentes e propriedades

Mantida por `docs/SEMANTICS_LOOP_PROMPT.md`. Status: `CLARO` (verificado, com evidência) · `ABERTO` (ambiguidade confirmada) · `DECISÃO` (depende do usuário) · `?` (ainda não auditado). O teste `src/shared/semantics.test.ts` falha se um papel ou campo sair desta tabela.

## Papéis DDD (`ddd.role`)

| Item | Status | Nota |
|---|---|---|
| `aggregate-root` | CLARO | dica + guia «Qual elemento usar» + D004/D005; testes de domain (iteração 26) |
| `entity` | CLARO | dica + D004 + `key` só na entity (iteração 17) |
| `value-object` | CLARO | dica + D007; sem identidade, `key` ignorado (iteração 17) |
| `domain-event` | CLARO | dica + `payload`×`properties` (16), quem emite (19), `external` (17) |
| `command` | CLARO | dica + D002 + `step` (1/13) + «Qual elemento usar» (15) |
| `policy` | CLARO | dica + `reactsTo`/`issues` (12/19) + ramos condicionais D025/D026/D028 (15) |
| `repository` | CLARO | dica + D008 (`for`) (12) |
| `domain-service` | CLARO | pura, recebe os dados prontos; `uses` → repository aceito com dica D033 (iteração 11) |
| `application-service` | CLARO | dica + D013 + «Qual elemento usar» (15) + quem emite (19) |
| `use-case` | CLARO | dica + D001 + quem realiza (20) + `actor` (17) |
| `read-model` | CLARO | dica + D019 + `projectsFrom` (12) |
| `process-manager` | CLARO | dica + D018 + `reactsTo` igual à policy (19) + `compensates` (21) |

## Papéis Logic (`logic.role`)

| Item | Status | Nota |
|---|---|---|
| `rule` | CLARO | rótulo «Ação»; chave `rule` no arquivo, `action` aceito na entrada; sem condição (nem `when`, nem «se…entao…senao» nos efeitos, erro L028) desde as iterações 2 e 14 |
| `input` | CLARO | dica + L029; só lido, `value` constante, `given` vence (23, 26) |
| `output` | CLARO | dica + L030; resultado que alguma ação escreve; sem `value` (26) |
| `variable` | CLARO | dica + L031; intermediário com `value` inicial reescrevível (26) |
| `scenario` | CLARO | dica + `expect.desfecho` (8) + `given` do fluxo todo (10, 23) |
| `start` | CLARO | dica + L014 (dois start); `text` sem efeito é lacuna (26) |
| `end` | CLARO | `text` rótulo; `outcome` ok/erro (padrão ok); vários fins (iteração 8) |
| `decision` | CLARO | só existe no modo logic (sim/não); sem o papel no domain desde a iteração 15 |
| `switch` | CLARO | dica + faixas (5) + L016 (`outros`) |
| `loop` | CLARO | dica + `until`/`max`/`foreach` (4) + bordas (24) |
| `fork` | CLARO | ramos independentes, simulados na ordem das setas; L027 avisa conflito (iteração 6) |
| `join` | CLARO | dica + só deixa passar sem fork; ramo em `end` termina o fluxo (25) |
| `call` | CLARO | simulação: `falha` → seta erro; senão `devolve` e seta normal; a chamada real não roda (iteração 8) |
| `code` | CLARO | TypeScript livre (corpo de `async (data) => {}`); o `return` vira `resultado`, lido por `devolve`; erro lançado segue pela seta erro; o app usa `mock` no lugar de executar; o código gerado roda de verdade (logicgen.test.ts) |

## Papéis Agents (`agent.role`)

| Item | Status | Nota |
|---|---|---|
| `agent` | CLARO | subagente de IA; `description`/`model`/`tools`/`prompt`; exporta `skills:` nativo no Claude Code, nota no corpo no Cursor |
| `skill` | CLARO | conhecimento reutilizável (SKILL.md); `source` ausente = própria, presente = do catálogo (hash para detectar atualização) |
| `tool` | CLARO | ferramenta: `toolType` `native` (`toolName` da lista `NATIVE_TOOLS`) ou `mcp` (`transport`, `command`/`args` ou `url`, `env`/`headers` com `${VAR}`, `mcpTools`, `mcpSource`); gera `tools:` / `mcpServers` / `.mcp.json`; sem nenhuma nativa o `tools:` é omitido (herda tudo) |

## Relações do modo agents (`AgentRel`)

| Item | Status | Nota |
|---|---|---|
| `uses-skill` | CLARO | `semantics` em `AGENT_RELS` e pares em `AGENT_REL_PAIRS`: agent → skill |
| `delegates` | CLARO | `semantics` em `AGENT_RELS` e pares em `AGENT_REL_PAIRS`: agent → agent |
| `uses-tool` | CLARO | `semantics` em `AGENT_RELS` e pares em `AGENT_REL_PAIRS`: agent → tool; `allow` limita as tools de um servidor MCP |
| `usage` (campo da relação) | CLARO | COMO o agente usa o destino; vai para o corpo do agente; sem ele, A018 |

## Campos DDD

| Item | Status | Nota |
|---|---|---|
| `ddd.intent` | CLARO | ver guia «Campos de texto, em uma frase» (iteração 13) |
| `ddd.invariants` | CLARO | ver guia «Campos de texto, em uma frase» (iteração 13) |
| `ddd.payload` | CLARO | legado: só vale sem `properties` (iteração 16) |
| `ddd.properties` | CLARO | guia: `type`, `key`, `optional`, `example` (17) |
| `ddd.producedBy` | CLARO | id(s) de nó; vale junto com a conexão equivalente; inexistente = D020 (iteração 12) |
| `ddd.external` | CLARO | `contexto.evento`: id do grupo context do outro diagrama + id do evento (iteração 17) |
| `ddd.for` | CLARO | id(s) de nó; vale junto com a conexão equivalente; inexistente = D020 (iteração 12) |
| `ddd.actor` | CLARO | texto livre; não é ligação (iteração 17) |
| `ddd.goal` | CLARO | texto livre do objetivo do ator; mostrado na história (lacuna: não duplica o nome) |
| `ddd.realizedBy` | CLARO | id(s) de nó; vale junto com a conexão equivalente; inexistente = D020 (iteração 12) |
| `ddd.reactsTo` | CLARO | id(s) de nó; vale junto com a conexão equivalente; inexistente = D020 (iteração 12) |
| `ddd.issues` | CLARO | id(s) de nó; vale junto com a conexão equivalente; inexistente = D020 (iteração 12) |
| `ddd.compensates` | CLARO | ids dos commands compensadores; D020; `compensate` no código (21) |
| `ddd.projectsFrom` | CLARO | id(s) de nó; vale junto com a conexão equivalente; inexistente = D020 (iteração 12) |
| `ddd.step` | CLARO | só `command` o lê (ordena a timeline); em `domain-event` virou legado aceito ao abrir (iteração 1) |

## Campos Logic

| Item | Status | Nota |
|---|---|---|
| `logic.order` | CLARO | só sem setas; crescente; sem valor no fim; empate = criação; L005 avisa (iteração 7) |
| `logic.text` | ABERTO | A2: na `decision` é a pergunta; confirmar se o cartão e o guia tratam igual (o `ddd.question` deixou de existir) |
| `logic.when` | CLARO | só a `decision` tem condição; a guarda da `rule` foi removida (iteração 2); arquivo antigo é migrado ao abrir |
| `logic.then` | CLARO | lista de efeitos, um por item; sem `se…entao…senao` (10, 14) |
| `logic.on` | CLARO | valor da expressão escolhe a seta cujo `case` é igual; sem caso, `outros` (iteração 5) |
| `logic.until` | CLARO | conferida antes de cada volta; vale junto com `max` e `foreach` (iteração 4) |
| `logic.falha` | CLARO | ver ponto 6b (iteração 8) |
| `logic.devolve` | CLARO | efeitos só quando a chamada dá certo; escreve dados; coberto por teste (iteração 8) |
| `logic.request` | CLARO | chamada HTTP real do Call (método, endereço, cabeçalhos e corpo como expressões); o código gerado faz o fetch; coberto por logicgen.test.ts |
| `logic.mock` | CLARO | resposta simulada (corpo, status 200) que os exemplos do app usam no lugar da rede; só vale com request (L032 avisa se falta) |
| `logic.code` | CLARO | só no papel code; obrigatório; é o corpo da função TypeScript |
| `logic.trigger` | CLARO | só no start: manual, webhook (método e caminho) ou agenda (cron de 5 campos); o código gerado exporta trigger e handler/onSchedule |
| `logic.max` | CLARO | conta voltas (1–1000), sem padrão; vale junto com `until` e `foreach` (iteração 4) |
| `logic.foreach` | CLARO | uma volta por item; `until` e `max` também podem cortar antes (iteração 4) |
| `logic.as` | CLARO | nome do item do `foreach`, padrão `item`, fica com o último valor (24) |
| `logic.outcome` | CLARO | ok/erro, padrão ok; o cartão do Canvas mostra «Fim com erro»; `expect.desfecho` no cenário (iteração 8) |
| `logic.examples` | CLARO | `given`/`expect`/`caminho`/`desfecho` (10); `expect` só chaves listadas |
| `logic.key` | CLARO | nome nas expressões; ponto = campo de objeto ou campo solto (24) |
| `logic.type` | CLARO | ver ponto 7 (iteração 9) |
| `logic.value` | CLARO | `given` vence; input constante, variable inicial (23, 26) |

## Famílias de vocabulário (arquitetura e relações)

Cada valor tem rótulo e uma frase de significado no schema (única fonte: UI, guia e MCP derivam dela); o teste `semantics.test.ts` falha se um valor novo ficar sem frase ou sem linha aqui. Valor de `interface.kind` (`rest`, `graphql`, `grpc`, `event`, `sql`, `websocket`, `file`, `custom`) não tem frase própria: vale o nome do tipo de contrato (lacuna, não contradição).

### Modos do diagrama (`DocMode`)

| Item | Status | Nota |
|---|---|---|
| `architecture` | CLARO | `hint` do modo no schema (iteração 26) |
| `domain` | CLARO | `hint` do modo no schema (iteração 26) |
| `logic` | CLARO | `hint` do modo no schema (iteração 26) |
| `agents` | CLARO | `hint` do modo no schema (modo agents) |

### Tipos de componente (`NodeKind`)

| Item | Status | Nota |
|---|---|---|
| `service` | CLARO | frase em `NODE_KINDS` (iteração 26) |
| `client` | CLARO | frase em `NODE_KINDS` (iteração 26) |
| `actor` | CLARO | frase em `NODE_KINDS` (iteração 26) |
| `database` | CLARO | frase em `NODE_KINDS` (iteração 26) |
| `cache` | CLARO | frase em `NODE_KINDS` (iteração 26) |
| `queue` | CLARO | frase em `NODE_KINDS` (iteração 26) |
| `gateway` | CLARO | frase em `NODE_KINDS` (iteração 26) |
| `external` | CLARO | frase em `NODE_KINDS` (iteração 26) |
| `ai` | CLARO | frase em `NODE_KINDS` (iteração 26) |
| `infra` | CLARO | frase em `NODE_KINDS` (iteração 26) |
| `library` | CLARO | frase em `NODE_KINDS` (iteração 26) |
| `endpoint` | CLARO | frase em `NODE_KINDS` (iteração 26) |
| `system` | CLARO | frase em `NODE_KINDS` (iteração 26) |
| `domain` | CLARO | frase em `NODE_KINDS` (iteração 26) |
| `logic` | CLARO | frase em `NODE_KINDS` (iteração 26) |
| `agent` | CLARO | frase em `NODE_KINDS` (modo agents) |

### Tipos de grupo (`GroupKind`)

| Item | Status | Nota |
|---|---|---|
| `boundary` | CLARO | frase em `GROUP_KINDS` (iteração 26) |
| `layer` | CLARO | frase em `GROUP_KINDS` (iteração 26) |
| `cloud` | CLARO | frase em `GROUP_KINDS` (iteração 26) |
| `network` | CLARO | frase em `GROUP_KINDS` (iteração 26) |
| `context` | CLARO | frase em `GROUP_KINDS` (iteração 26) |
| `cluster` | CLARO | frase em `GROUP_KINDS` (iteração 26) |
| `team` | CLARO | frase em `GROUP_KINDS` (iteração 26) |
| `global` | CLARO | frase em `GROUP_KINDS`: skill dentro do grupo global vale para todos os agentes (modo agents) |

### Tipos de conexão (`ConnectionType`)

| Item | Status | Nota |
|---|---|---|
| `sync` | CLARO | `semantics` em `CONNECTION_TYPES` (iteração 26) |
| `async` | CLARO | `semantics` em `CONNECTION_TYPES` (iteração 26) |
| `stream` | CLARO | `semantics` em `CONNECTION_TYPES` (iteração 26) |
| `data` | CLARO | `semantics` em `CONNECTION_TYPES` (iteração 26) |
| `dependency` | CLARO | `semantics` em `CONNECTION_TYPES` (iteração 26) |
| `inheritance` | CLARO | `semantics` em `CONNECTION_TYPES` (iteração 26) |
| `realization` | CLARO | `semantics` em `CONNECTION_TYPES` (iteração 26) |
| `composition` | CLARO | `semantics` em `CONNECTION_TYPES` (iteração 26) |
| `aggregation` | CLARO | `semantics` em `CONNECTION_TYPES` (iteração 26) |
| `association` | CLARO | `semantics` em `CONNECTION_TYPES` (iteração 26) |

### Protocolos de endpoint (`EndpointProtocol`)

| Item | Status | Nota |
|---|---|---|
| `rest` | CLARO | `semantics` em `ENDPOINT_PROTOCOLS` (iteração 26) |
| `graphql` | CLARO | `semantics` em `ENDPOINT_PROTOCOLS` (iteração 26) |
| `websocket` | CLARO | `semantics` em `ENDPOINT_PROTOCOLS` (iteração 26) |
| `grpc` | CLARO | `semantics` em `ENDPOINT_PROTOCOLS` (iteração 26) |
| `webhook` | CLARO | `semantics` em `ENDPOINT_PROTOCOLS` (iteração 26) |
| `sse` | CLARO | `semantics` em `ENDPOINT_PROTOCOLS` (iteração 26) |
| `event` | CLARO | `semantics` em `ENDPOINT_PROTOCOLS` (iteração 26) |

### Relações de domínio (`DddRel`)

| Item | Status | Nota |
|---|---|---|
| `emits` | CLARO | `semantics` em `DDD_RELS` e pares em `DDD_REL_PAIRS` (iteração 26) |
| `triggers` | CLARO | `semantics` em `DDD_RELS` e pares em `DDD_REL_PAIRS` (iteração 26) |
| `contains` | CLARO | `semantics` em `DDD_RELS` e pares em `DDD_REL_PAIRS` (iteração 26) |
| `references-by-id` | CLARO | `semantics` em `DDD_RELS` e pares em `DDD_REL_PAIRS` (iteração 26) |
| `realizes` | CLARO | `semantics` em `DDD_RELS` e pares em `DDD_REL_PAIRS` (iteração 26) |
| `uses` | CLARO | `semantics` em `DDD_RELS` e pares em `DDD_REL_PAIRS` (iteração 26) |
| `context-relation` | CLARO | `semantics` em `DDD_RELS` e pares em `DDD_REL_PAIRS` (iteração 26) |

### Padrões do Context Map (`ContextPattern`)

| Item | Status | Nota |
|---|---|---|
| `shared-kernel` | CLARO | `hint` em `CONTEXT_PATTERNS` (iteração 26) |
| `customer-supplier` | CLARO | `hint` em `CONTEXT_PATTERNS` (iteração 26) |
| `conformist` | CLARO | `hint` em `CONTEXT_PATTERNS` (iteração 26) |
| `acl` | CLARO | `hint` em `CONTEXT_PATTERNS` (iteração 26) |
| `ohs` | CLARO | `hint` em `CONTEXT_PATTERNS` (iteração 26) |
| `published-language` | CLARO | `hint` em `CONTEXT_PATTERNS` (iteração 26) |
| `partnership` | CLARO | `hint` em `CONTEXT_PATTERNS` (iteração 26) |
| `separate-ways` | CLARO | `hint` em `CONTEXT_PATTERNS` (iteração 26) |

### Saídas de seta do logic (`LogicBranch`)

| Item | Status | Nota |
|---|---|---|
| `sim` | CLARO | `hint` e papéis de origem em `LOGIC_BRANCHES` (iteração 26) |
| `nao` | CLARO | `hint` e papéis de origem em `LOGIC_BRANCHES` (iteração 26) |
| `repete` | CLARO | `hint` e papéis de origem em `LOGIC_BRANCHES` (iteração 26) |
| `segue` | CLARO | `hint` e papéis de origem em `LOGIC_BRANCHES` (iteração 26) |
| `outros` | CLARO | `hint` e papéis de origem em `LOGIC_BRANCHES` (iteração 26) |
| `erro` | CLARO | `hint` e papéis de origem em `LOGIC_BRANCHES` (iteração 26) |

## Decisões do usuário

- `ddd.payload` legado, com `properties` vencendo, nada removido: **confirmado** (iteração 25).
- `domain-service → repository` aceito com a dica D033: **confirmado** (iteração 25).
- `decision` só no modo logic (iteração 15), Ação sem condição e proibir `se…entao…senao` no efeito (iteração 14), critério de parada só com contradições e efeitos escondidos (iteração 24).
- **Nenhuma `DECISÃO` pendente.**

## Classificação dos `ABERTO` restantes

Nenhum `ABERTO` restante foi reproduzido como contradição: são **lacunas** (padrão/borda não dito) ou candidatos ainda não reproduzidos, tratados como lacuna provisória até a próxima auditoria independente (que só conta os bloqueantes).

## Histórico

| # | Ponto | Tipo | Mudança |
|---|---|---|---|
| 1 | `ddd.step` em `domain-event` | A5 | removido dos campos do evento (UI, MCP, guia); arquivos antigos seguem abrindo; teste de consistência criado |
| 2 | `logic.when` na Ação (decisão do usuário: remover) | A1/A2 | removido do papel `rule` (UI, MCP, guia, tutorial); `normalizeDoc` converte a guarda em uma `decision` antes da ação; 0 dos 188 `rule` dos exemplos/cofre usavam; `then` mantido |
| 3 | rótulo «Então»→«Efeitos», texto «trava» do inspetor, «Rule» no `call`, frase do guia; auditor independente (27 pontos) | A1/A3/A11 | ver seção da auditoria |
| 4 | `logic.loop`: `until`/`max` ignorados com `foreach` | A5 | motor combina os três; hint, guia e teste (com controle negativo) |
| 5 | `logic.switch` por faixas sem regra de ordem/local da condição | A4 | só documentação + teste do comportamento existente (sem mudança de motor, logo sem controle negativo) |
| 6 | `fork`: «ao mesmo tempo» dito, execução sequencial feita | A1 | texto honesto (dica, guia) + validação L027 (ramos que se tocam); 0 forks nos exemplos/cofre, sem regressão |
| 7 | `logic.order` e `travar` sem semântica escrita | A4/A6 | só texto (guia, SYNTAX_GUIDE, comentário do schema) + teste do comportamento existente |
| 8 | `call.falha` não-booleano passava como «não falhou» | A8 | agora é erro (como na decisão); texto de `falha`/`outcome`/`desfecho`; teste com controle negativo; 0 `falha` nos exemplos/cofre |
| 9 | selos `CASE?` × `CASE`; `logic.type` já documentado | A2/A3 | selo do switch → SWITCH; teste de selos únicos (sem pontuação) |
| 9b | auditor independente #2 rodado: 39 novos candidatos (#28–#45) | — | ver seção da auditoria #2 |
| 10 | guia sem como citar o item em `filtrar`/`mapear`, `%` × `5%`, `then` como lista, `caminho`/`given`/`expect`, `given` × `value` | A4/A9 | só texto (SYNTAX_GUIDE e guia do logic) + teste do comportamento e das frases do guia |
| 11 | `domain-service` «sem I/O» × `uses` → repository | A7/A11 | decisão conservadora: segue aceito (1 uso real no cofre); dica D033 e textos alinhados; teste |
| 12 | campos de id × conexões sem regra dita | A2/A11 | texto no guia do domínio (união, ids, D020) + teste (campo, seta e misto equivalem; id inexistente dá D020); comportamento já era assim |
| 13 | guia do domínio sem descrição de `intent`, `invariants` e `step` | A4/A5 | seção nova no guia + teste das frases; comportamento já era assim (invariants só documental, step só ordena a timeline) |
| 14 | `se … entao … senao` dentro do efeito da Ação (pedido do usuário, decisão: proibir + refatorar o cofre) | A1/A6 | erro ao criar (checkLogicNode) e L028 ao abrir; `liftRuleConditionals` converte em Decisão + ações (cadeias, condição dentro de conta, efeitos antes/depois, exemplos refeitos e conferidos); `scripts/refactor-conditionals.ts` aplicado a 12 arquivos do cofre (backup `diagrams-backup-2026-10-13-antes-condicional-na-acao/`) e ao exemplo de precificação (gerador); 36 diagramas, 0 erros, 774 exemplos passando |
| 15 | `decision` só no modo logic (pedido do usuário) + sobreposição command/application-service/use-case/policy/saga (#23/#42) | A2/A3 | papel, `gate`, `question`, D024/D027/D031 removidos do domain; D025/D026/D028 valem para policy/saga (`triggers`) e command (`emits`); `migrateDddDecisions` converte arquivos antigos ao abrir; 5 exemplos do domain reescritos (loja, delivery); guia ganhou «Qual elemento usar»; 257 testes |
| 16 | `payload` × `properties` | A2/A11 | texto + `eventPayload` único na descrição (havia um caminho que ignorava `properties`); teste |
| 17 | `actor`, `external`, `subdomain`, `properties.key/optional/example`, pattern simétrico sem texto no guia | A4/A8 | só texto (guia, schema) + teste do comportamento (key só na entity) |
| 18 | `call.devolve` com `se…entao…senao`; auditor independente #3 (25 candidatos) | A1/A11 | recusado como na Ação (L028); ver seção da auditoria #3 |
| 19 | `reactsTo` «qualquer»/«todos» e quem emite | A2/A11 | texto honesto (espera só documentada) + D012 passa a contar campos de id como ligação (policy com `reactsTo`/`issues` não é mais «isolada»); teste |
| 20 | guia do logic generalizava «toda condição é decision»; guia do domínio não dizia quem realiza um use-case | A11 | só texto (guias, SKILL) + teste do comportamento (serviço realiza, rastreio termina nele) |
| 21 | `condition`/`foreach`/`loop`/`compensates` do domínio sem texto no guia; auditor independente #4 (42 candidatos) | A4/A9 | só texto (guia) + teste do comportamento (texto livre, combináveis, max 1–1000, compensates no código); #111 corrigido |
| 22 | bordas das funções e das comparações sem texto no guia (auditor #4, #82–#91) | A9 | levantei por execução o que o motor faz e documentei no `SYNTAX_GUIDE`; teste executa cada exemplo (31 valores e 10 erros) |
| 23 | origem do valor de um dado sem texto no guia (auditor #4, #72–#75) | A8 | levantei por execução (11 casos) e documentei no item 5a do guia do logic; teste executa os casos e confere as frases |
| 24 | tipos do `fact` (item 5b) + bordas de expressão, laço, decisão e trava (item 4a, «Mais bordas»); auditor independente #5 (50 candidatos) | A8/A9 | levantado por execução e testado; ver seção da auditoria #5 |
| 25 | decisões `payload` e D033 confirmadas pelo usuário; triagem de candidatos (#127, #128, #139–#141, #148, `description`, equivalência campo de id × conexão) | A4/A8 | todos eram lacunas (nenhuma contradição reproduzida); documentadas e testadas |
| 26 | divisão `fact` → `input`/`output`/`variable` (outra sessão) deixou meu item 5a contraditório (`value` reescrito «sem aviso» × L029 no input); inventário fechado (famílias, linhas `?` → CLARO); auditor #6 só de bloqueantes: 2 achados (Loop escreve o item do `foreach`; «caso» do scenario × `case` do switch) | A11/A2 | texto do 5a e do guia corrigidos; scenario virou «Cenário completo» com selo TESTE; testes |
| 27 | auditores #7 e #8 só de bloqueantes: #7 achou 3 fracos (join × `end` no ramo, nomes do logic no domain, `reactsTo`), 2 corrigidos em texto; #8 sobre os guias corrigidos: **nenhuma ambiguidade bloqueante encontrada** | A11/A2 | dica do `join` e guia do domain ajustados; `intent` do process-manager incluído; critério de parada atendido |

## Auditoria independente #1 (iteração 3)

Subagente sem acesso a docs/código, lendo só os guias de `logic` e `domain` que a IA recebe. 27 pontos; **nenhum está confirmado no código ainda** (cada um precisa ser reproduzido antes de virar defeito). Corrigidos nesta iteração: #6 (texto «Rule» no `call`) e #11 (frase «só existem Ação e Decisão»).

| # | Ponto | Tipo | Status |
|---|---|---|---|
| 1 | `logic.loop`: `until`/`max`, corpo roda 0 vezes?, padrão de `max` | A5/A8 | CLARO (iteração 4: com `foreach` o motor ignorava `until`/`max`; agora valem os três, a primeira que acontecer; guia e dica dizem pré-teste, zero voltas, `max` sem padrão) |
| 2 | `logic.switch` por faixas: onde fica a condição de cada seta e a ordem | A4 | CLARO (iteração 5: condição no `case` da seta; vale a primeira verdadeira na ordem de criação das setas; texto em schema, guia e inspetor; teste trava a ordem) |
| 3 | `logic.fork`: «ao mesmo tempo» × execução sequencial; dois ramos escrevendo o mesmo dado | A1 | CLARO (iteração 6: dica e guia dizem que os ramos são independentes e simulados em sequência sobre os mesmos dados; novo aviso L027 para ramos que escrevem/leem o mesmo dado; teste) |
| 4 | `logic.order`: crescente? desempate? ignorado com setas? | A8 | CLARO (iteração 7: crescente; sem `order` no fim; empate pela ordem de criação; ignorado com setas; texto e teste) |
| 5 | `travar`: onde a tentativa é registrada | A6 | CLARO (iteração 7: tentativa anotada em `step.blocked` e na linha do tempo do dado, sem erro; vale até o fim ou `destravar`; guia, SYNTAX_GUIDE e teste) |
| 6 | `logic.call`: citava «Rule» | A3 | CLARO (corrigido) |
| 6b | `logic.falha`: sobre quais dados é avaliada; sem seta «erro» | A4/A8 | CLARO (iteração 8: dados do fluxo naquele ponto; precisa dar verdadeiro/falso, senão erro; sem seta erro é erro de execução; sem `falha` nunca falha; texto e teste com controle negativo) |
| 7 | `logic.type`: `texto` aceita nulo, `string` não; rótulo desconhecido sem aviso | A2/A8 | CLARO (iteração 9: já estava escrito no guia — sinônimos em português aceitam «sem valor», nomes em inglês são estritos, texto que não é tipo vale só como rótulo; o inspetor mostra o aviso «vale só como rótulo»; sem código novo porque um aviso para todo rótulo antigo seria ruído em 331 dados) |
| 8 | `logic.outcome` (end) × `expect.desfecho` (scenario): dois nomes, padrão não dito | A2/A8 | CLARO (iteração 8: `outcome` é ok/erro, padrão ok; `expect.desfecho` confere o desfecho do fim alcançado; dito no schema, na dica e no teste) |
| 9 | expressões: `=`/`:=`, `%`, formatos de data, `entre` inclusivo, `vazio` | A9 | ABERTO |
| 10 | rótulos «CASE?» (switch) × «CASE» (scenario) | A2/A3 | CLARO (iteração 9: selo do switch virou SWITCH; teste de selos únicos) |
| 11 | guia dizia «só existem Ação e Decisão» listando outros papéis | A11 | CLARO (corrigido) |
| 12 | `logic.fact`: «lê ou escreve» sem setas | A6 | ABERTO |
| 13 | `examples`: «Dado/Esperado» × `given`/`expect`; valores de `caminho` em loop/call | A3/A4 | ABERTO |
| 14 | `ddd.step`: guia do command não descreve o efeito | A4 | CLARO (iteração 13: seção «Campos de texto, em uma frase» do guia; só command, ordena a timeline) |
| 15 | `ddd.payload` × `properties`: os dois preenchidos | A2/A11 | CLARO (iteração 16, recomendação aplicada sem remover nada: `properties` vence, `payload` é texto legado que só vale sozinho; guia, dica do campo, MCP e UI dizem isso; a descrição tinha um caminho que mostrava o payload mesmo com properties: unificado; teste). Aguarda sua confirmação |
| 16 | `ddd.invariants`: formato e se o validador confere | A4/A5 | CLARO (iteração 13: lista de textos, só documental; vira comentário no código gerado e aparece na história; D013 só proíbe no application-service) |
| 17 | `ddd.reactsTo/issues/projectsFrom/producedBy/realizedBy` × relações `triggers/emits/realizes`: precedência | A2/A11 | CLARO (iteração 12: não há precedência, é UNIÃO; ids de nós; inexistente = D020; guia e teste) |
| 18 | `ddd.actor`: texto, não nó | A4 | CLARO (iteração 17: texto livre; não é ligação; o ator desenhado é um componente `actor` + `association`, independente; guia e teste) |
| 19 | `ddd.intent` com sentidos diferentes por papel | A2 | CLARO (iteração 13: um sentido só, «o que faz, em uma frase», com exemplo por papel no guia) |
| 20 | `ddd.properties`: parâmetros/payload/colunas; `key` em value-object | A2/A7 | ABERTO |
| 21 | `ddd.gate`: padrão e condições no `parallel` | A8 | CLARO (iteração 15: o papel `decision` e o `gate` deixaram de existir no domain) |
| 22 | `decision` em `logic` × `domain` | A2/A3 | CLARO (iteração 15, decisão do usuário: `decision` só existe no modo logic; no domain, exclusiva e paralela viram policy com ramos, junção vira process-manager; arquivos antigos migram ao abrir) |
| 23 | `application-service` × `use-case` × `process-manager`: sobreposição | A2 | ABERTO |
| 24 | guia de domain: `triggers`/`uses` sem `decision` e com origens diferentes nas duas seções | A11 | ABERTO (a parte `decision` sumiu com a remoção; falta alinhar as origens de `uses`) |
| 25 | `entity` → `entity` aninhado | A7 | ABERTO |
| 26 | `ddd.loop`/`foreach`: sintaxe e `max` 0 | A4/A8 | ABERTO |
| 27 | `description` pedida pelo guia mas fora dos campos dos papéis | A11 | ABERTO |

Resolvido além do auditor: o rótulo «Então» do inspetor virou «Efeitos»; o inspetor dizia que a condição da Ação «pula a ação» (falso desde a iteração 2).


## Auditoria independente #2 (iteração 9)

Segundo subagente, mesma regra (só os guias de `logic` e `domain`), pedido para não repetir os pontos já tratados. **39 novos candidatos**; os marcados «confirmado» foram conferidos no `schema.ts`, o resto ainda precisa ser reproduzido antes de virar defeito.

| # | Ponto | Tipo | Status |
|---|---|---|---|
| 28 | `filtrar`/`mapear`: como citar o item dentro da condição | A4 | CLARO (iteração 10: o guia agora traz «campos do item são nomes soltos e `item` é o próprio item»; antes só estava na ajuda da função, que o guia não imprime) |
| 29 | `5%` × `%` (módulo) e `vazio(x)` × dado sem valor: o que é «vazio» | A9/A8 | CLARO (iterações 10 e 22: `%` resto com sinal do dividendo; `vazio` = nulo, "" e []; teste) |
| 30 | `then`: vários efeitos (lista, um por item; sem `;`) | A4 | CLARO (iteração 10: guia diz «uma LISTA com um efeito por item») |
| 31 | `expect.caminho`: `"sim"`/`"nao"` × `"não"`; `given`/`expect` por nó ou fluxo; `expect` confere só as chaves listadas? | A3/A4 | CLARO (iteração 10: `"nao"` sem acento; `given` entra no passo (cenário: fluxo todo); `expect` só as chaves listadas, depois dos efeitos; teste) |
| 32 | `fact.value` × `given` (qual vence), dado sem `fact`, `fact.type` vazio | A8 | CLARO (iteração 23: `given` vence `value`; sem os dois, ler dá erro; nulo informado é valor; ação cria dado sem fact com L007; `type` só avisa (L026); falta só `fact.type` vazio) |
| 33 | `end`/`start`/`fact`.`text` sem efeito descrito; o que o `end` devolve | A6 | ABERTO |
| 34 | `arredondar`/`piso`/`teto`/`entre`, `dias_entre`/`somar_dias` (formato de data), `=` entre tipos, `senao` opcional | A9 | ABERTO |
| 35 | «modo simples»: nenhuma seta ou só algumas? misto? | A8 | ABERTO |
| 36 | `join` com ramo que termina em `end` ou só um ramo chega | A8 | ABERTO |
| 37 | códigos L0xx e D001–D005 citados sem explicação; passo 5 (exemplos numéricos) × passo 7 (não inventar números) | A11 | ABERTO |
| 38 | `ddd.step` sem descrição no guia do command | A4 | CLARO (ver #14) |
| 39 | `ddd.invariants`: texto/lista, executável?, pré-condição ou invariante | A4/A5 | CLARO (ver #16) |
| 40 | `reactsTo`/`issues`/`compensates`/`realizedBy`/`producedBy`/`projectsFrom`/`for` × conexões: precedência, id ou texto | A2/A11 | CLARO (iteração 12, exceto `compensates`: sem conexão equivalente e a semântica de compensação ainda por documentar) |
| 41 | `domain-service` «pura, sem I/O» × `uses` domain-service → repository | A7/A11 | CLARO (iteração 11: continua aceito, porque 1 diagrama do cofre usa, mas a dica do papel e a relação `uses` dizem que o serviço é puro e a validação ganhou a dica D033; teste) |
| 42 | `command` × `application-service` × `use-case`: quem orquestra | A2 | ABERTO |
| 43 | `emits` com dois produtores; `ddd.condition` sem sintaxe e ordem; `ddd.loop` (unidade, antes/depois, junto de `condition`) | A8/A9 | ABERTO |
| 44 | `properties.type/key/optional/example`; `subdomain`; `context-relation.pattern` simétrico; `external` (id ou nome) | A4/A8 | CLARO (iteração 17: `key` só muda o código da entity, `optional` padrão é obrigatório, `example` vira comentário; `subdomain` informativo com D014/D015; `external` = id do context do outro diagrama + id do evento; pattern simétrico/assimétrico; guia, schema e teste) |
| 45 | `description` pedida pelo guia mas fora dos campos dos papéis (repete o #27) | A11 | ABERTO |

## Auditoria independente #3 (iteração 18)

Terceiro subagente, só com os guias de `logic` e `domain`, sem repetir os pontos já tratados: **25 novos candidatos** (#46–#70, na ordem do relatório). Só o #47 foi confirmado e corrigido; o resto precisa ser reproduzido no código antes de virar defeito.

| # | Ponto | Tipo | Status |
|---|---|---|---|
| 46 | guia do logic: «toda condição é `decision`» × `switch`/`loop`/`call` (regras absolutas que contradizem outras seções) | A11 | CLARO (iteração 20: «uma condição sim/não é uma `decision`; 3+ saídas é `switch`; repetição é `loop`»; SKILL alinhado; teste) |
| 47 | `call.devolve` aceitava `se…entao…senao`, que a Ação proíbe, mas o guia diz «efeitos como os da Ação» | A1/A11 | CLARO (iteração 18: recusado como na Ação, L028 para arquivo antigo; 0 usos no cofre; texto do `SYNTAX_GUIDE`; teste) |
| 48 | `travar` vale «em todos os ramos» × ramos do `fork` independentes | A6 | ABERTO |
| 49 | `call.text` fala em «outro diagrama», sem campo que aponte para ele | A4 | ABERTO |
| 50 | `join`: qual `fork` fecha; aninhado; sem fork; ramo que termina em `end` | A8 | ABERTO (repete o #36) |
| 51 | `fact.value` × ação que o reescreve | A8 | CLARO (iteração 23: `value` é só o valor inicial; a ação reescreve sem aviso; teste) |
| 52 | `then` com variável sem `fact`: cria ou dá erro? `type` após `:=` é conferido? | A8 | CLARO (iteração 23: cria o dado (L007); tipo incompatível só avisa (L026); teste) |
| 53 | `fact.type`: «sinônimos» em português aceitam nulo e os ingleses não | A2 | ABERTO |
| 54 | `fact.type` vazio e rótulo com erro de digitação | A8 | ABERTO (repete o #32/#7) |
| 55 | funções de data: formato, sinal, pontas | A9 | CLARO (iteração 22: texto AAAA-MM-DD, `dias_entre` = ate − de, `somar_dias` aceita negativo, outro formato é erro; teste) |
| 56 | `arredondar`, `entre`, `vazio`, `media`, `primeiro`: modo, negativos, pontas, lista vazia | A9 | CLARO (iteração 22: meio para cima, casas negativas, `entre` inclusivo, `soma([])` 0, `media([])` erro, `primeiro([])` nulo; teste) |
| 57 | `contem` × `em [...]`; ordem de `ordenar` com objetos; decimais | A9 | ABERTO (parte CLARO na iteração 22: `contem` só lista, `ordenar` só números ou só textos; falta decimais e objetos) |
| 58 | `switch` sem «outros»: obrigatório? `case` repetido | A8 | ABERTO |
| 59 | `text` de `start`/`end`/`fork`/`join`, `decision.when` vazio, dois `start` | A6/A8 | ABERTO (repete o #33) |
| 60 | modo simples × fluxo com setas parciais | A8 | ABERTO (repete o #35) |
| 61 | `scenario`: qual `start` usa, efeito de `name` | A4 | ABERTO |
| 62 | `reactsTo`: «qualquer um» na policy × «todos» no process-manager | A2/A11 | CLARO (iteração 19: o app trata igual nos dois papéis, é só a lista de eventos; a «espera por todos» é só documentação, e o meu texto anterior insinuava o contrário: corrigido em guia, SKILL, DOMAIN_MODE e DDD; D012 ignorava os campos de id da policy, corrigido; teste com controle negativo) |
| 63 | quem emite evento: command, aggregate, process-manager × application-service «publica» | A2 | CLARO (iteração 19: `emits` só de command/aggregate-root/process-manager; application-service nunca emite (D013), só entrega ao publicador; guia, dica do papel e teste) |
| 64 | `realizes`/`realizedBy`: D001 aceita qualquer realizador, a convenção diz command; consulta (read-model) | A7/A11 | CLARO (iteração 20: command = rastreio completo; application/domain-service = rastreio termina nele; consulta usa application-service; o app só confere que o id existe, D020; guia e teste) |
| 65 | `use-case.goal` listado e nunca descrito | A4 | ABERTO |
| 66 | `condition`/`foreach`/`loop` no domain: sintaxe, ordem do «primeiro», combinações | A4/A9 | CLARO (iteração 21: texto livre, não é o logic; combináveis; max 1–1000; ordem só de leitura; guia e teste) |
| 67 | `process-manager.compensates`: ids compensadores ou compensados | A4 | CLARO (iteração 21: ids dos commands que desfazem; D020; vira `compensate` no código; guia e teste) |
| 68 | `properties.type` × `contains`; formato de `name` | A4/A2 | ABERTO |
| 69 | «exige» × «SUGESTÃO» (imperativo/passado); falta tabela de códigos e severidades | A11 | ABERTO (repete o #37) |
| 70 | `description` pedida pelo guia e fora dos campos (repete o #27/#45) | A11 | ABERTO |

## Auditoria independente #4 (iteração 21)

Quarto subagente, só com os guias, sem repetir os pontos tratados: **42 candidatos** (#71–#112, na ordem do relatório). Só o #111 (o auditor #41) era uma contradição criada na própria iteração e foi corrigido; os demais precisam ser reproduzidos antes de virar defeito. Agrupados:

| Grupo | Pontos | Status |
|---|---|---|
| `text` dos papéis do logic sem efeito descrito (#1) | #71 | ABERTO (repete #33/#59) |
| origem do valor de um dado: `fact.value`, `given` parcial ou total, dado sem `fact`, ação que escreve dado inexistente, tipo conferido só nos exemplos? (#2, #19, #21, #22) | #72–#75 | CLARO (iteração 23: item 5a do guia do logic + teste que executa cada caso; falta só o merge de `given` parcial em decisão/switch, que vale igual ao do passo) |
| `fact.type`: `int`/`inteiro`, `float`/`decimal`/`number`, nulo (#3); fact objeto × key com ponto (#5); `fact` × `start` (#4) | #76–#78 | CLARO (iteração 24: item 5b do guia, executado por teste; falta só `fact` × `start`) |
| nomes `caminho`/`branch`, `case` com dois sentidos, `switch` sem «outros» (#6–#8) | #79–#81 | ABERTO (repete #58) |
| expressões: tokenização `%`, igualdade de texto/listas, arredondamento, `entre` inclusivo, datas, `vazio`, listas vazias/erros de função, `ordenar`, `partir/juntar/trocar`, `numero/texto` (#9–#18) | #82–#91 | CLARO (iteração 22: seção «Bordas» no SYNTAX_GUIDE, cada comportamento executado por teste; falta só `senao` opcional e decimais) |
| ação sem efeitos, `expect: {}`, tolerância numérica, `scenario` sem `desfecho` (#20, #23, #24) | #92–#94 | ABERTO |
| gravidade das regras L0xx: «recusado» × «avisa» sem tabela (#25) | #95 | ABERTO (repete #37/#69) |
| `travar` num ramo do `fork` vale no seguinte? (#26) | #96 | ABERTO (repete #48) |
| domain: `invariants` × `properties`, entity sem `key`, `properties.type` de outro contexto/entity, `key`+`optional`, `description` do componente × do campo, `external` × produtor, `projectsFrom` × colunas, `repository.for` vazio/2 repositories, `goal` × nome, `step`, D015 por contexto, `issues` × conexão, `pattern` vazio, tipos UML × `emits` async (#27–#40) | #97–#110 | ABERTO |
| «vale o primeiro ramo cuja condição é verdadeira» × «ordem só para leitura» (#41) | #111 | CLARO (iteração 21: o guia diz «por convenção de leitura, segue o primeiro ramo… o app não executa isso») |
| `switch` também não existe no domain; escolher caminho no logic × domain (#42) | #112 | ABERTO |

## Auditoria independente #5 (iteração 24)

Quinto subagente, só com os guias, sem repetir os pontos tratados: **50 candidatos** (#113–#162, na ordem do relatório). Levantei por execução os mais citados e documentei no guia (item 4a do logic e «Mais bordas» do `SYNTAX_GUIDE`); o resto precisa ser reproduzido antes de virar defeito.

| Grupo | Pontos | Status |
|---|---|---|
| `decision.when` vazio ou não lógico (#5, #6) | #117, #118 | CLARO (obrigatório, recusado ao criar; número/nulo é erro de execução, não falso; teste) |
| `=` × `:=`, `+` com texto, precedência `e`/`ou`/`nao`, `and`/`or`, `em`, `adicionar`, `partir`, `texto`, `tamanho(nulo)`, `unicos` (#17, #18, #19, #26–#32) | #129–#144 | CLARO (execução + «Mais bordas»; falta só `ordenar`/`unicos` de objetos com tipos mistos) |
| `foreach` vazio, nulo, objeto, texto, sem `as` (#33–#35) | #145–#147 | CLARO (zero voltas; erro; `item` fica com o último valor; teste) |
| `destravar` sem `travar`, `travar` de dado inexistente (#24, #25) | #136, #137 | CLARO (não faz nada, sem aviso; bloqueia a escrita; teste) |
| `text` dos papéis, `end` «devolve», 0/2 `start`, `action.then` vazio, `examples` exigido? (#1–#4) | #113–#116 | ABERTO (repete #33/#59/#71) |
| `switch` sem `case` num valor, ordem no modo por valor, `case` como string (#7, #8) | #119, #120 | ABERTO |
| `fact.value` literal ou expressão, `fact.text`, chave `a.b.c`/repetida (#9–#11) | #121–#123 | ABERTO |
| `scenario` sem `expect`, sem start, modo simples; vários `end`/`start` (#12–#14) | #124–#126 | ABERTO |
| `join` com ramo que termina em `end` ou erro (#15) | #127 | CLARO (iteração 25: o ramo que chega a um `end` termina o fluxo com o desfecho dele; join sem fork só deixa passar; teste) |
| `%` colado com espaço (#16), «condições» que incluem `on`/`foreach` (#20) | #128, #138 | CLARO (iteração 25: `%` colado ao fim de número literal é percentual, senão resto; teste) / ABERTO o #20 (lacuna) |
| exemplo de passo só recebe o `given`, `expect` em dado travado, `travar` × fork (#21–#23) | #139–#141 | CLARO (iteração 25: `expect` confere o valor de fato (travado); teste) / ABERTO o #21 e o #23 (lacunas) |
| `filtrar` com campo chamado `item` (#36) | #148 | CLARO (iteração 25: `item` é sempre o item inteiro; o campo se lê com `item.item`; teste) |
| domain: `invariants` de aggregate × command, `description` de componente × campo, `producedBy` × `external`, `goal`, `projectsFrom` vazio, `repository.for` ausente, `issues` sem explicação, `step` unidade, `loop.max` voltas, `condition`+`foreach`, `subdomain` inválido, `rel` omitido entre command e domain-service, `example` não conferido, lista de `realizes` (#37–#50) | #149–#162 | ABERTO |

## Backlog

- `logic.then` se chama «então» mas é a lista de efeitos: avaliar rótulo na UI («Efeitos»), mantendo a chave.
- Varredura mecânica camada × campo (grep indica `ddd.goal` sem leitura em `domain.ts`/`codegen.ts`, só `story.ts` e UI: confirmar se é só descritivo).
- Auditar `NodeKind`, `GroupKind`, `ConnectionType`, `DddRel`, `ContextPattern`, `EndpointProtocol`, `InterfaceKind`, `DecisionGate` (ainda fora da matriz).
