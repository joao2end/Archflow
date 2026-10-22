# Modo Logic: pesquisa, brainstorm e proposta

> **Nota (2026-10-12):** o papel `rule` descrito aqui passou a se chamar **Ação** (`action`; o nome `rule` continua valendo nos arquivos). Só existem **Ação** (muda dados) e **Decisão** (escolhe o caminho); «regra de negócio» é o desenho inteiro. O texto abaixo mantém o vocabulário original.


Status: **etapas 1 e 2 implementadas** (motor de expressões; modo Logic com papéis `rule`, `input`/`output`/`variable` (antes `fact`) e `scenario`, validação L001–L011 que roda os exemplos, layout em fila, inspetor, MCP e o exemplo de precificação em `examples/exemplos-logic/`). Faltam tabela de decisão, estados e a integração com o modo Domain (§5). Escopo: um terceiro modo do Archflow, ao lado de *Architecture* e *Domain*, para representar **regras de negócio específicas** de forma que pessoas de negócio e desenvolvedores leiam o mesmo quadro, e que uma IA consiga ler e escrever sem ambiguidade.

## 1. Onde o projeto está hoje

| Modo | Responde | Lógica que já cabe nele |
|---|---|---|
| Architecture | *Onde* as coisas rodam e como conversam | nenhuma |
| Domain (DDD) | *O que* existe no negócio e *quem reage a quê* | `invariants` (texto livre), `decision` (losango), `condition` / `otherwise` / `loop` / `foreach` em `triggers` e `emits` |

O que falta, concretamente (`src/shared/schema.ts`, `docs/DOMAIN_MODE.md`):

1. **Regras são frases soltas.** `invariants: string[]` e `condition: "atraso > 0"` não têm estrutura: não dá para validar, reaproveitar, testar nem gerar código a partir delas.
2. **O corpo de uma regra não tem lugar.** A `decision` diz *"existe uma bifurcação aqui"*; não diz *"cliente VIP com pedido acima de R$ 500 e entrega em até 2 km ganha frete grátis"*. Isso hoje vira uma `description`.
3. **Não há ciclo de vida.** "Pedido: criado → pago → enviado → entregue / cancelado" é a pergunta mais comum do negócio e não tem representação (só dá para inferir pela cadeia de eventos).
4. **Não há exemplos.** Regra boa vem com casos concretos; hoje a pessoa de negócio não consegue conferir se a regra "está certa" olhando para números reais.
5. **Regra e fluxo estão misturados.** A condição fica pendurada na seta do fluxo. Se a mesma regra vale em três fluxos, é copiada três vezes.

## 2. O que a literatura diz (e o que aproveitamos)

| Fonte | Ideia central | Aproveitamos |
|---|---|---|
| **Business Rules Manifesto** (Business Rules Group) | Regras *não são processo nem procedimento*: ficam **separadas** do fluxo e valem em vários processos; um corpo coeso de regras, aplicado de forma consistente | Regra é um **elemento próprio**, ligado a quem a usa, nunca embutida na seta |
| **DMN** (OMG, *Decision Model and Notation*) | Decisões em **tabelas de decisão** legíveis por analistas; um diagrama de dependências (DRD) mostra qual decisão alimenta qual; verificação automática de **completude e consistência** | Tabela de decisão como peça central + checagem de buracos e sobreposições |
| **UML State Machine** | Estados e transições com *evento [guarda] / ação* modelam o **ciclo de vida** de um objeto | Estado + transição com guarda, só com esses três campos (sem sub-estados, regiões ou histórico) |
| **UML Activity** | Fluxo de controle de um caso de uso | **Já existe** em Domain (decision/loop/foreach). Não duplicar |
| **Event Storming** | Policy = lilás, "sempre que X, faça Y"; depois da oficina, sessões de **Example Mapping** detalham as regras de cada policy | Regra ancorada a uma policy/command; exemplos como parte da regra |
| **Specification by Example / Gherkin** (Given-When-Then) | Exemplos concretos viram documentação viva, legível por não técnicos | Cada regra e cada linha de tabela vira um **exemplo verificável** |
| **DDD tático** (invariantes, Specification pattern, Policy) | Invariantes protegem o aggregate; regras compostas viram objetos nomeados | Regra nomeada, com escopo (aggregate / command / policy), reaproveitável |

Conclusão da pesquisa: **não existe uma notação única** que sirva a negócio e a dev. O que funciona na prática é um conjunto pequeno de três peças complementares: *tabela de decisão* (combinações), *máquina de estados* (ciclo de vida) e *regra com exemplos* (frase + casos). Nenhuma pede conhecimento de programação para ler.

## 3. Brainstorm e validação em rodadas

Critérios usados para pontuar cada candidato (0 a 2 cada, máx. 10):

- **N**: uma pessoa de negócio lê sem treino?
- **D**: um dev tira especificação suficiente para implementar e testar?
- **IA**: uma IA lê e escreve sem ambiguidade (estrutura validável)?
- **Q**: funciona num quadro branco, com poucos elementos e legível de relance?
- **C**: combina com o que já existe (cores, nós, inspetor, ops, validação D\*, passo a passo, código gerado)?

### Rodada 1: candidatos soltos

| # | Ideia | N | D | IA | Q | C | Total | Veredito |
|---|---|:-:|:-:|:-:|:-:|:-:|:-:|---|
| A | Fluxograma / BPMN de lógica | 1 | 1 | 1 | 1 | 0 | 4 | **Descartar.** Duplica `decision`/`loop` e enterra a regra no fluxo (contraria o Manifesto) |
| B | Pseudocódigo em caixas (Nassi, "if/else" visual) | 0 | 2 | 1 | 0 | 1 | 4 | **Descartar.** Negócio não lê |
| C | UML completo (classe + sequência + OCL) | 0 | 2 | 2 | 0 | 1 | 5 | **Descartar.** OCL é inacessível; pesa no quadro |
| D | Tabela de decisão (DMN) | 2 | 2 | 2 | 1 | 1 | 8 | **Manter.** Falta um jeito de caber no quadro |
| E | Máquina de estados | 2 | 2 | 2 | 2 | 2 | 10 | **Manter.** Reaproveita seta com rótulo |
| F | Regra "SE / ENTÃO" com exemplos (Gherkin) | 2 | 1 | 1 | 2 | 2 | 8 | **Manter.** Falta rigor para a IA e para dev |
| G | Linguagem natural controlada (SBVR / Gherkin puro) como texto livre | 2 | 1 | 0 | 1 | 1 | 5 | **Descartar como base.** Sem estrutura, não valida |

Problema levantado na rodada 1: **D, E e F juntos podem virar 3 modos dentro de 1**. Pergunta para a rodada 2: como manter só um vocabulário?

### Rodada 2: o ponto de equilíbrio entre negócio e dev

Descoberta principal: o conflito "legível para negócio" × "preciso para dev" se resolve com **duas camadas no mesmo elemento**, não com dois modos:

- **Camada de negócio** (`text`): frase em português ("cliente VIP, pedido acima de R$ 500, entrega até 2 km"). É o que aparece no quadro por padrão.
- **Camada técnica** (`expr`, opcional): a mesma condição formal (`cliente.nivel == "VIP" && pedido.total > 500 && entrega.km <= 2`). Aparece com o botão **Ver técnico** (e é o que a IA e o gerador de código usam; se faltar, a IA sugere e o humano confirma).

Isso é o "meio-termo" pedido: quem não programa nunca precisa abrir a camada técnica; quem programa nunca precisa adivinhar a frase.

Outra descoberta: o vocabulário (`cliente.nivel`, `pedido.total`) **já existe** no modo Domain como `ddd.properties`. Regras devem **referenciar campos reais do modelo** (com validação), em vez de inventar nomes. Isso também liga os dois modos: mudar o nome de um campo no Domain acende um aviso na regra.

Outra: regra e exemplo andam juntos. Em tabela de decisão cada linha **já é** um exemplo; em regra de frase, os exemplos ("Dado… Quando… Então…") entram como uma mini-tabela. Um só conceito: **exemplo = entradas + resultado esperado**.

Reavaliação com as ideias combinadas:

| # | Ideia | N | D | IA | Q | C | Total |
|---|---|:-:|:-:|:-:|:-:|:-:|:-:|
| D′ | Tabela de decisão com `text` + `expr` + checagem de completude | 2 | 2 | 2 | 2 | 2 | **10** |
| E′ | Estados + transições `evento [guarda] / efeito`, guarda referencia uma regra | 2 | 2 | 2 | 2 | 2 | **10** |
| F′ | Regra estruturada (quando / então / senão) + exemplos + campos do modelo | 2 | 2 | 2 | 2 | 2 | **10** |

### Rodada 3: ataque às propostas (o que pode dar errado)

| Risco | Resposta |
|---|---|
| Tabela de decisão grande não cabe no quadro | Nó mostra **resumo** (nome, nº de regras, política de acerto, status "completa ✔ / 2 buracos"); abrir a tabela inteira é no inspetor ou no zoom. Limite de 12 linhas × 6 colunas na tabela do nó |
| DMN completo (FEEL, BKM, DRD) é pesado | Só o que importa: colunas de entrada, colunas de saída, **hit policy** reduzida a `única` (sem sobreposição) e `primeira` (a ordem decide). Sem FEEL; `expr` é texto livre validado por quem gera código |
| Estado + regra + tabela = muitos tipos novos | Exatamente **4 papéis** (ver §4) |
| Pessoa de negócio escreve regra ambígua ("cliente importante") | Validação L-xx: condição sem `expr` e sem exemplo vira **dica**; regra sem exemplo é aviso. A IA pergunta o limite concreto |
| Duplicar o fluxo do modo Domain | **Regra não conduz fluxo.** O fluxo continua em `decision`/`loop`. A `decision` ganha um vínculo opcional "quem decide: tabela X" (a bifurcação referencia a regra; a seta mostra só o nome) |
| Código gerado vira promessa que o app não cumpre | Gera função pura por tabela/regra (`decidirFrete(input): Output`) **e** os testes a partir dos exemplos; corpo vem de `expr`. Sem `expr`, `TODO` + exemplo como teste que falha |
| Modo novo vira "mais uma coisa para aprender" | Barra de modos fica **Arch · Domain · Logic**, mesma mecânica de troca (nada apagado, Ctrl+Z desfaz); exemplo pronto (Delivery) abre em 1 clique |

Nenhum risco ficou sem resposta. A proposta passa para o desenho final.

## 4. Proposta final

### 4.1 O quadro responde a uma pergunta: *"por que o sistema decidiu isso?"*

Um diagrama Logic por **aggregate** ou por **caso de uso**, no projeto em `logica/`. Lê-se da esquerda para a direita: **o que entra → qual regra / tabela decide → o que sai ou para qual estado vai**.

### 4.2 Quatro papéis (`logic.role`), mesma mecânica do `ddd.role`

| Papel | Selo | Para quem / o quê | Cor (da paleta atual) | Campos principais |
|---|---|---|---|---|
| `rule` | REGRA | Uma regra de negócio em frase | verde-azulado (família do `decision`) | `when[]`, `then[]`, `else[]`, `examples[]`, `severity` (impede / alerta / calcula) |
| `table` | TAB | Combinações de condições → resultado (DMN reduzido) | roxo (família da `policy`) | `inputs[]`, `outputs[]`, `rows[]`, `hit` (`unique` / `first`), `default` |
| `state` | ESTADO | Fase do ciclo de vida | âmbar (família do aggregate) | `initial?`, `final?`, `entry?` (o que vale ao entrar) |
| `input` | IN | Dado que entra no fluxo e só é lido (nenhuma ação o escreve) | azul-claro (família do read-model) | `key`, `type`, `value` (constante) |
| `output` | OUT | Resultado que o fluxo devolve; é o que os cenários conferem em `expect` | verde | `key`, `type` |
| `variable` | VAR | Dado intermediário: escrito e lido dentro do fluxo para calcular outra coisa | lilás | `key`, `type`, `value` (valor inicial) |

> **Divisão do `fact` (2026-10-13).** O papel único `fact` foi dividido em `input`, `output` e `variable`. Arquivos antigos são convertidos ao abrir (`migrateFacts` em `logic.ts`): nunca escrito → `input`; escrito e conferido no `expect` de um cenário (ou que ninguém lê depois) → `output`; escrito e lido no meio do fluxo → `variable`. Novas regras: **L029** (entrada escrita por uma ação), **L030** (resultado que nenhuma ação escreve) e **L031** (variável que nunca recebe valor). O layout põe as entradas à esquerda e resultados, variáveis e cenários à direita. `scripts/migrate-data-roles.ts` converte pastas de diagramas em disco.

Conexões (nova família `LOGIC_RELS`, mesmo padrão de `DDD_RELS`, o `type` visual é fixo pela relação):

| `rel` | Liga | Leitura |
|---|---|---|
| `reads` | fact → rule/table | "usa este dado" |
| `yields` | rule/table → fact | "produz este dado" |
| `guards` | rule → transição (state → state) | "só passa se a regra valer" |
| `transitions` | state → state, com `event` e `effect` | "quando X acontece, vai para Y" |
| `applies-to` | rule/table → elemento do modelo de domínio (command, policy, aggregate, decision) | âncora de rastreio |

Regras, tabelas e estados **não duplicam** command/event/aggregate: apontam para eles (`ref` entre diagramas, mecanismo que já existe para `system`).

### 4.3 Como cada peça aparece no quadro

- **Regra**: cartão estilo post-it com três faixas: `QUANDO` (linhas), `ENTÃO`, `SENÃO`. Rodapé: *2 exemplos ✔*. O botão **Ver técnico** troca `text` por `expr`.
- **Tabela**: cartão com cabeçalho (nome + selo de status: *completa*, *2 buracos*, *1 sobreposição*) e as primeiras linhas em miniatura; clique abre a tabela cheia no inspetor.
- **Estado**: pílula arredondada (início = ponto cheio, fim = anel); a seta carrega `evento [regra] / efeito`. Para negócio, a leitura é "Pago —(entregar)→ Entregue".
- **Dado**: etiqueta pequena com ícone de campo, para ligar regras às propriedades do Domain.

Tudo seguindo o que já existe: `DomainShape` como base, `ep-badge` para o selo, cores via `DDD_ROLES`-like (`LOGIC_ROLES`, fonte única), tooltips em pt-BR, inspetor com seções por papel, tabela de campos como a de *Propriedades*.

### 4.4 Validação (regras `L001…`, mesmo formato `{ rule, severity, target, message }`)

| Id | Sev. | Regra |
|---|---|---|
| L001 | erro | tabela com **buraco** (combinação de entradas sem linha e sem `default`) |
| L002 | erro | tabela `unique` com **sobreposição** (duas linhas valem juntas) |
| L003 | erro | `ref` de dado/âncora aponta para campo ou elemento inexistente |
| L004 | erro | máquina de estados sem estado inicial, ou com mais de um |
| L005 | aviso | estado inalcançável a partir do inicial |
| L006 | aviso | estado sem saída que não é final (beco sem saída) |
| L007 | aviso | duas transições do mesmo estado com o mesmo evento e guardas que se sobrepõem |
| L008 | aviso | regra sem exemplo |
| L009 | aviso | exemplo que **contradiz** a tabela/regra (calculado quando há `expr` simples) |
| L010 | dica | condição só com `text`, sem `expr` (negócio ok; dev e IA ficam sem precisão) |
| L011 | dica | regra sem âncora (`applies-to`): ninguém a usa |
| L012 | aviso | `expr` cita campo que não está entre os dados da regra |

### 4.5 O que a IA lê e escreve

- Mesma receita do Domain: `get_schema_guide` responde pelo modo; `describe` ganha seções **Regras**, **Tabelas** (renderizadas em Markdown), **Ciclos de vida** (inclui Mermaid `stateDiagram-v2`) e avisos com id.
- Tools novas mínimas: `add_rules`, `add_table`, `add_states` (transições incluídas); o resto reaproveita `connect`, `validate_diagram`, `trace` (de um caso de uso até a regra que decide) e `generate_code`.
- Fluxo recomendado: a IA lê o Domain, lista as **regras prováveis** (em `text`), pergunta os limites numéricos ao usuário e só depois preenche `expr` e exemplos. Isso ataca a ambiguidade na raiz.

### 4.6 Integração com o que existe

- **Domain → Logic**: `decision` e `policy` ganham a âncora "quem decide: *tabela X*", mostrada no Passo a passo ("Por que está aqui" → "Regra aplicada").
- **Passo a passo (apresentação)**: ao chegar no elemento ancorado, o painel mostra a regra em frase e **um exemplo animado** ("pedido de R$ 620, VIP, 1,5 km → frete grátis").
- **Código**: `generate_code` produz `<contexto>/domain/rules/<regra>.ts` (função pura) e `<regra>.test.ts` com os exemplos, compilando em modo estrito, como já é garantido hoje.
- **Layout**: estilo `logic` (entradas à esquerda, regra no centro, saídas à direita; estados em linha do tempo).

### 4.7 Ordem de entrega sugerida (cada etapa utilizável sozinha)

1. **Fundação**: `DocMode "logic"`, `LOGIC_ROLES`, `logic` em `NodeEl`, switch de 3 modos, paleta, `describe`.
2. **Estados** (maior ganho para o negócio, menor esforço): papel `state`, `transitions`, L004–L007, Mermaid.
3. **Regra com exemplos**: papel `rule`, `input`/`output`/`variable`, L003/L008/L010–L012, Ver técnico.
4. **Tabela de decisão**: papel `table`, L001/L002/L009, editor de grade no inspetor.
5. **Integração**: âncora em `decision`/`policy`, passo a passo, `generate_code` + testes, exemplo *Delivery · Lógica* e guia `docs/LOGIC.md`.

## 5. Rodada 4: validação contra um caso real (engine de precificação)

Caso trazido pelo time: 11 regras que rodam **em ordem**, cada uma reescrevendo o preço da anterior (preço de partida, margem mínima, variação, arredondamento, PMC, grupos, PBM, preço fixo, recomendação), mais eventos fora da fila (ajuste manual, manter, aceitar sugestão).

| Trecho do caso | Cabia no desenho anterior? | Ajuste |
|---|---|---|
| Fila de 11 regras, cada uma reescreve o valor da anterior | Não | Novo conceito: **pipeline** (regras com `order` sobre um dado corrente, ex.: `preco`) |
| "Quem ficou travado no passo 7 ou 8 não é reescrito" | Não | Efeito **`travar dado`**: regras seguintes são puladas para esse dado |
| "Preço fixo vence tudo o que veio antes" | Parcial | Regra posterior que atribui e trava (sem prioridade mágica; a ordem + trava dizem tudo) |
| Faixas de arredondamento | Sim | Tabela de decisão `first` |
| Margem por divisão → departamento → categoria | Sim | dado com herança (`ref` para o dado) |
| Ajuste manual / manter / aceitar sugestão (fora da fila) | Não | Eventos do papel `state` (ciclo de vida do alerta e do preço) |

Consequência: **a ordem de entrega muda** (§4.7 fica assim):

1. **Motor de expressões** (`src/shared/expr.ts`): feito. Sintaxe pequena em português (`custo / (1 - margem)`, `tipo em ["imagem","trafego"] e preco < 10`, `preco := max(preco, piso)`, `travar preco`), avaliador, análise dos dados lidos e **explicação automática em português** (a camada de negócio nasce da camada técnica, nunca divergem).
2. **Fundação do modo + papéis `rule` e `fact`** com `order`, efeitos (`:=`, `travar`) e exemplos executáveis.
3. **Execução dos exemplos** (rodar o pipeline: passo a passo com o valor depois de cada regra, como o "histórico guarda cada passo" do caso).
4. **Tabela de decisão**.
5. **Estados** (ciclo de vida).
6. Integração (âncoras no Domain, apresentação, código gerado).

## 5.1 O que a implementação já provou (e o que ela revelou)

- **Provou:** o caso de precificação inteiro (11 regras, 7 cenários e 30 exemplos) roda e passa; mudar um número esperado acende ✘ na regra, no quadro e na validação (L004).
- **Revelou 1:** "preço fixo vence tudo" + "quem ficou travado não é reescrito" exigiam **`destravar`**; foi acrescentado à sintaxe.
- **Revelou 2:** o arredondamento em `se … senão se …` encadeado é correto, mas **difícil de ler** mesmo com a explicação em português. É o argumento para a próxima etapa: **tabela de decisão** (faixa → resultado), que o negócio lê como grade.
- **Revelou 3:** o texto original deixa pontos em aberto (faixas de R$ 100 e R$ 200; "em 99" entre 50 e 202; "um centavo além do último dígito do PMC"). O exemplo os marca como *A confirmar* na descrição das regras 4 e 5.

## 6. Decisões

1. **Nome**: `Logic` (decidido).
2. **Ponto de partida**: pipeline de regras + expressões (decidido pelo caso real; estados ficam para a etapa 5).
3. **`expr`**: sintaxe pequena **e** explicação automática em português (decidido; implementada no passo 1).
4. **Caso real**: engine de precificação, usado como exemplo-guia (*Precificação*) e como teste de aceitação do modo.

## Fontes

- [Business Rules Manifesto (Business Rules Group)](https://www.brcommunity.com/brg/BRManifesto.pdf) · [Separate From Processes, Not Contained In Them](https://www.brcommunity.com/articles.php?id=s016)
- [DMN: visão geral e tabelas de decisão (Trisotech)](https://www.trisotech.com/what-is-dmn/) · [DMN 101](https://www.trisotech.com/dmn-101/) · [Red Hat: DMN](https://docs.redhat.com/en/documentation/red_hat_decision_manager/7.4/html/getting_started_with_decision_services/dmn-con_decision-service-getting-started)
- [Máquina de estados × diagrama de atividade (Visual Paradigm)](https://visual-paradigm.com/guide/uml-unified-modeling-language/state-machine-diagram-vs-activity-diagram)
- [Event Storming (Wikipedia)](https://en.wikipedia.org/wiki/Event_storming) · [Event Storming: legenda e conceitos (Xebia)](https://xebia.com/blog/eventstorming-core-concepts-glossary-and-legend/)
- [Specification by Example](https://fourweekmba.com/specification-by-example/) · [Given-When-Then](https://concepts.dsebastien.net/concept/given-when-then/)

## 7. Legibilidade de código complexo (2026-10-22)

Revisão do modo com um caso real (a engine de precificação tinha 83 cartões num quadro de 3700 × 5700 px; a reprodução de N-rainhas tinha 402 passos a 8 s cada). O diagnóstico: o quadro traduzia o código linha a linha, sem uma camada acima que dissesse o que o algoritmo faz, e a reprodução era um depurador, não uma explicação. O que entrou:

| Peça | O que resolve | Onde |
|---|---|---|
| **Etapas** (`GroupEl.stage`) | Trechos nomeados do fluxo; recolhidos, viram um cartão-resumo (o que lê, o que escreve, passos, exemplos). Todas recolhidas = **visão geral**. Não mudam a execução | `logicstages.ts`, L034–L036 |
| **Tabela de decisão** (`table`) | Escolha cujos caminhos só atribuem valores vira uma grade num cartão (o arredondamento da precificação: 9 cartões → 1) | `runTable`, `tableCard`, L038–L039 |
| **Cartão de resumo** e aba **Visão geral** | A porta de entrada: propósito, o que entra e sai, etapas, placar dos cenários e o contrato de dados | `logicoverview.ts` |
| **Matriz de cenários** e **cobertura nas setas** | Cada cenário numa linha (entra, espera, saiu, por onde passou); cada saída de decisão diz quantos cenários passam por ela | `scenarioMatrix`, `edgeCoverage` |
| **Espinha e molduras de laço** | O caminho principal numa coluna reta; exceções ao lado; o corpo do laço emoldurado quando não cobre outros passos | `logiclayout.ts` |
| **Origem no código** (`NodeEl.source`) | «arquivo:linha» em cada passo, no cartão e no inspetor | L037 |
| **Reprodução Explicar / Depurar** | Explicar anda por momentos (etapas, voltas) com as frases de negócio e o saldo dos dados; Depurar mostra o porquê de cada passo com os valores (`v[meio] < x → 2 < 2`), saltos (mudança, volta, sair do laço), voltas agrupadas e os valores nos cartões de dados | `logicdebug.ts` |
| **Exportação em seções** | PDF pelo motor de impressão do navegador (diagramas em SVG vetorial, tabelas em HTML, sem sombras para não haver nada rasterizado) ou ZIP com SVG e PNG por seção + README.md: resumo, visão geral, uma seção por etapa (só ela aberta), cenários e dados | `logicsections.ts`, `ui/sectionexport.tsx` |

O guia da IA (`get_schema_guide` e a skill) ganhou as regras de granularidade: uma ação por intenção (não por linha), escolha que só atribui é tabela, mais de ~12 passos pede etapas com uma entrada cada, `source` em cada passo e um cenário por caminho importante.
