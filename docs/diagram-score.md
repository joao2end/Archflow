# Diagram score — histórico (modelo JEV)

Critério de aceite: ≤ 2 perguntas em aberto · clareza ≥ 8 · representatividade ≥ 8 · 0 erros. Ver `docs/DIAGRAM_LOOP_PROMPT.md`.

| # | Data | Alvo | Veredito | Perguntas | Clareza | Repres. | Mudança |
|---|------|------|----------|-----------|---------|---------|---------|
| 0 | 2026-10-11 | Referência: simples (frete) | ADEQUADO | 0 | 10 | 10 (4/4) | Linha de base |
| 0 | 2026-10-11 | Referência: médio (reembolso) | ADEQUADO | 0 | 9,5 | 10 (7/7) | Linha de base (1 cruzamento de setas) |
| 0 | 2026-10-11 | Referência: complexo (crédito) | ADEQUADO | 0 | 10 | 10 (8/8) | Linha de base |
| 0 | 2026-10-11 | Cofre (37 diagramas Logic, sem oráculo) | 30 adequados · 7 não | 28 no total | — | `?` | Linha de base. Perguntas: 16 de leitura, 11 de cobertura, 1 de contexto |
| 1 | 2026-10-11 | Cofre: `importacao-worker/aceitar-upload` (Executor de contexto zero, sem mudança de código) | INADEQUADO (auto) | 6 auto · 23 subagente | 0,5 (auto) · entendimento 8/10 (subagente) | `?` | Primeira medição real com leitor independente. O subagente resumiu certo o que o diagrama decide, mas fez 23 perguntas e se deu 8/10 |
| 2 | 2026-10-11 | Layout do fluxo Logic (alvo: `simulacao/quem-vem-primeiro`) | 30 → 31 adequados de 37 | — | `quem-vem-primeiro` 5 → 6,5 | `?` | Causa raiz: a camada era ordenada só pelo rótulo da seta (sim/não/outros), então filhos do mesmo pai se separavam e as setas se cruzavam. Agora ordena pela posição do pai antes do rótulo (`logiclayout.ts`). **Correção na iteração 3: os «34 → 22» eram de um relayout hipotético, não do que está desenhado.** |
| 3 | 2026-10-11 | Verificação no navegador (sandbox) da iteração 2 | — | — | — | — | Abri antes × depois no app. **O app desenha as posições gravadas no arquivo; `logicLayout` só roda no «Organizar».** A mudança da iteração 2 não altera nenhum diagrama existente: só os próximos relayouts. O Juiz passou a medir as posições gravadas (cofre: 33 cruzamentos, `quem-vem-primeiro` segue com 7) |
| 4 | 2026-10-11 | Layout automático: quadros de grupo (visto no sandbox) | — | — | — | — | Causa raiz: «Organizar» só reajustava grupos `auto`; os gravados sem `auto` (agente MCP, versões antigas) ficavam com o quadro velho, vazio, enquanto os cartões se moviam. Agora o layout marca como `auto` os grupos que ele posiciona e os reajusta (`ops.ts`). Teste novo em `logicflow.test.ts` (falha sem a correção) · 192 testes ok · **verificado no navegador**: «Dados de entrada» envolve os 5 cartões; console sem erros |
| 5 | 2026-10-11 | Authoring T1 (Início → Decisão → 2 Regras → Fim), no sandbox | `?` | — | — | — | **Primeira medição da parte B.** T1 **não concluída** (parei ao achar o bloqueio): 1 ação para abrir a biblioteca (a dica do quadro vazio manda isso) e 1 por nó. **Bloqueio 1 corrigido:** adicionar Decision ou Loop pela biblioteca falhava em silêncio (o validador exige condição/parada e `placeAsset` descartava o erro). Agora nascem com a condição provisória `condicao` (o inspetor mostra, o L002 acusa) e qualquer falha de adição mostra aviso de erro (`store.ts`). 193 testes ok · verificado no navegador |
| 6 | 2026-10-11 | Authoring T1+T2 (nós, conexões e rótulos sim/não) | `?` | — | — | — | **T1 concluída:** 6 ações (B + 1 clique por nó), 0 bloqueios. **Bloqueio 2 corrigido:** o novo nó entra abaixo do selecionado, em coluna e sem sobreposição (`panels.tsx`). **T2:** cada arrasto = 1 conexão; a seta que sai de uma Decision agora nasce «sim» e a seguinte «não», com rótulo (`Canvas.tsx`; antes ficava sem saída e só a validação reclamava). 193 testes ok · verificado no navegador (API e imagem) |
| 7 | 2026-10-11 | Authoring T3 (escrever a condição de uma Decision; erro de sintaxe) | `?` | — | — | — | **T3 medida:** 4 ações (selecionar, focar o campo, digitar, Enter). **Bloqueio 4 corrigido:** uma condição inválida (`preco <`) era recusada em silêncio: o campo seguia mostrando o texto digitado, o valor salvo continuava o antigo e não havia mensagem. Agora o erro aparece enquanto se digita («Ainda não salvo: …», `role=alert`) e, ao confirmar, um aviso de erro diz o motivo e qual valor ficou (`logic.tsx`, `panels.tsx`). 193 testes ok · verificado no navegador (inválida: erro ao vivo + aviso, valor salvo intacto; válida: salva e explica em português) |
| 8 | 2026-10-11 | Authoring T4 (criar um cenário: entradas e esperado) | `?` | — | — | — | **T4 medida: ≈ 9 ações** (B, clique em Scenario, selecionar, «+ Exemplo», Dado: focar+digitar+Tab, Esperado: digitar+Tab), meta ≤ 12. **Bloqueio 5 corrigido:** `ValueLines` (campos Dado e Esperado) ignorava em silêncio uma linha inválida (`total 250`); agora mostra «Ainda não salvo: linha 1: use "dado = valor"…» ao digitar e aviso de erro ao confirmar. **Descobribilidade:** o texto de exemplo do cenário usa os dados do próprio diagrama (`total = `; `frete = / desfecho = "ok"`) em vez do genérico de precificação (`logic.tsx`). 193 testes ok · verificado na UI (erro ao vivo; caso válido salvo com ✔) |
| 9 | 2026-10-11 | Authoring T3 para o efeito de uma Rule (`Então`) e o «Quando vale» da Rule | `?` | — | — | — | **Bloqueio 6 corrigido:** o campo «Quando vale» da Rule era um `TextField` cru (descarte silencioso) e o «Então» recusava o **bloco inteiro** se uma linha fosse inválida, sem dizer qual. Agora «Quando vale» usa o `ExprField` e o «Então» valida linha a linha ao digitar («linha 1 «frete = 0»: um efeito é "dado := expressão", "travar dado" ou "destravar dado"»). Ao confirmar, aviso de erro; **o erro fica embaixo do campo** até corrigir (conferido 8 s depois, com o aviso já fechado). Os campos Dado/Esperado ganharam o mesmo comportamento. 193 testes ok · verificado na UI |
| 10 | 2026-10-11 | Authoring T6 (do ✘ ao nó responsável) e T5 (ramo que falta cobrir) | `?` | — | — | — | **T6 medida: 3 ações** (selecionar o cenário ✘, rolar o inspetor, clicar no botão). Antes a mensagem («frete: esperava 15, deu 0») não dizia que passo produziu o valor; agora um botão «**«frete» foi escrito por «Frete grátis»**» seleciona o nó (e «O fluxo terminou em «…»» para o desfecho) (`logic.tsx`, só UI: lê os passos da execução). **T5: sem suporte na UI.** 193 testes ok · verificado na UI (mensagem, botão e seleção do nó) |
| 11 | 2026-10-11 | Authoring T5 (ver o que nenhum cenário cobre) | `?` | — | — | — | **T5 ganhou apoio no quadro:** regra, decisão, escolha e fim que nenhum exemplo ou cenário exercita (ou decisão/escolha com ramo sem cenário) recebem uma marca âmbar tracejada «–», com o motivo no tooltip («Sem cenário: O que acontece quando a resposta de «…» é «não»?…»). Reaproveita a conta do avaliador (`coverageGaps` em `logiceval.ts`; marca em `Canvas.tsx`). Teste novo em `jev.test.ts` · 194 testes ok · **verificado no navegador** em ciclo completo: com 1 cenário, a Decision e «Frete fixo» marcadas; com o cenário do «não», as marcas somem e o cenário fica ✓ |
| 12 | 2026-10-11 | Cofre (parte A): regra do Executor «decisão sem texto» | 29 → 31 adequados de 37 | 28 → 17 | — | `?` | **Correção de uma conclusão minha.** As 12 «decisões sem texto» tinham rótulos que já são a pergunta («Grupo ausente?», «Redis configurado?»); a regra do Executor (`logiceval.ts`) exigia o campo `text` mesmo assim. Era falso positivo do avaliador, **não defeito dos diagramas**: o item de backlog «causa comum: decisões sem `text`; avisar no inspetor» estava errado e foi removido. Agora só pergunta quando o rótulo não pergunta nada. 194 testes ok |
| 13 | 2026-10-11 | Authoring: textos de exemplo do inspetor Logic (descobribilidade) | `?` | — | — | — | **Vazamento de domínio corrigido:** os textos de exemplo do inspetor (frase da regra, pergunta da decisão, condição, escolha, laço, cenário, efeitos, mensagem de erro) eram da engine de precificação e apareciam em qualquer diagrama. Agora são neutros e, onde dá, **derivados do próprio diagrama**: a condição usa um dado declarado (`total <= 0`) e os campos Dado/Esperado de um exemplo de Rule/Decision/Switch sugerem o que **aquele passo** lê e escreve (`total = `, `caminho = "sim"`). Só UI (`logic.tsx`). 194 testes ok · verificado na UI (Decision: pergunta, condição, Dado e Esperado) |
| 14 | 2026-10-11 | Cofre: `pesquisa/registrar-coleta-de-preco` (Executor de contexto zero, calibração do avaliador) | avaliador: ADEQUADO (0 perguntas, clareza 10) · leitor independente: 7/10 | 0 auto · 5 bloqueiam + 7 de borda (subagente) | 10 (auto) · entendimento 7/10 | `?` | **O avaliador está condescendente com a coerência entre prosa e lógica.** O leitor de contexto zero apontou 5 dúvidas que bloqueiam; 2 se **confirmaram como contradições reais** no diagrama (abaixo). Nenhuma mudança de código; o passo 2 do prompt agora pede a classificação bloqueia/borda e a confirmação de cada dúvida antes de chamá-la de defeito |
| 15 | 2026-10-11 | Cofre: Executor de contexto zero em `simulacao/margem-minima` e `clusterizacao/validar-nome-e-tipo-do-cluster` (calibração, 2 leitores em paralelo) | ambos ADEQUADO (auto) | 0 auto · 6 e 5 «bloqueia» (leitores) → **0–1 e 1 confirmadas** | 10 (auto) · entendimento 8/10 e 8/10 | `?` | Sem mudança de código. Confirmei cada dúvida «bloqueia» no texto: `margem-minima` 0–1 (a de margem ≥ 100%, que o próprio texto cita sem dizer o resultado); `validar-cluster` 1, pequena (o Start diz que o tipo é normalizado «na troca do seletor» e o fluxo o modela como 1º passo da validação) |
| 16 | 2026-10-11 | Cofre: **primeiro oráculo de um diagrama real** (`simulacao/margem-minima`) | ADEQUADO | 0 | 10 | **10 (5/5)** | O `eval:jev` agora procura `src/shared/fixtures/oracles/<nome-do-arquivo>.json` (casos escritos a partir da descrição, sem olhar o fluxo) e usa o oráculo ao avaliar diagramas do cofre. 5 casos: imagem e tráfego abaixo do piso, preço **igual** ao piso (estritamente menor), preço acima, lucro. O diagrama reproduz a prosa |

### Achados da iteração 16 (representatividade de um diagrama real)
- **Controle negativo feito:** numa cópia, troquei `<` por `<=` na condição «O preço está abaixo do piso?». O oráculo reprovou o caso do limite («preço igual ao piso não é marcado»: esperava `abaixo = false`, deu `true`), representatividade 10 → 8 (4/5). Portanto o oráculo discrimina, e foi o caso de fronteira que o pegou: **sempre incluir os limites** (igual, um abaixo, um acima).
- **Fragilidade do critério:** com 5 casos, **uma falha dá 8,0, que ainda cumpre a meta «≥ 8»**. Nesta mutação o veredito foi reprovado só porque os exemplos do próprio nó também falharam; num diagrama em que o autor ajustasse o exemplo junto, o oráculo falharia sozinho e o veredito passaria. Recomendação: exigir **100% do oráculo** (qualquer falha reprova), já que cada caso do oráculo vem do enunciado. Não alterei a meta (o prompt proíbe mudar metas para fazer algo passar; aqui seria endurecer, mas é decisão do dono do critério).
- Um diagrama pequeno e bem descrito (uma regra, uma frase de enunciado) é o caso fácil para escrever oráculo. Os diagramas com muitas regras (`simulacao.archflow.json`, precificação) exigem enunciado numérico; o texto original da engine está nas descrições das regras.
- O caso «lucro» do oráculo passa `abaixo = false` como entrada para poder esperar `abaixo = false`; sem isso o dado não existe no ambiente e a conferência de «não mexe no flag» não é possível. Limite do formato do oráculo: não há `expect` para «sem valor».

### Achados da iteração 15 (calibração do avaliador)
- **Placar das 3 leituras independentes até agora** (avaliador automático × leitor de contexto zero):

| Diagrama | Avaliador | Leitor (nota) | Dúvidas «bloqueia» do leitor | Confirmadas |
|---|---|---|---|---|
| `aceitar-upload` (it. 1; ainda sem classificação) | 6 perguntas | 8 | 23 no total | ≈ 4 de leitura |
| `registrar-coleta-de-preco` | 0 | 7 | 5 | **2 contradições reais** |
| `margem-minima` | 0 | 8 | 6 | 0–1 |
| `validar-nome-e-tipo-do-cluster` | 0 | 8 | 5 | 1 pequena |

- **Leitura do placar:** o avaliador acertou (0 ou ~1 dúvida real) em 2 de 3 diagramas «adequados» e foi condescendente em 1 (contradições entre prosa e fluxo). Amostra de 3: não generaliza.
- **Os leitores LLM também erram para o lado oposto:** das 16 dúvidas marcadas «bloqueia» nos 3 diagramas classificados, só 4 se confirmaram. As outras já tinham resposta no texto, eram inferíveis dos exemplos (`0,30` mostra que o percentual é fração) ou eram de borda. **Uma dúvida «bloqueia» sem confirmação não pode contar**; a regra de confirmar do prompt é necessária.
- **A nota 0–10 do leitor quase não discrimina:** 7, 8, 8, 8 para diagramas com 0 a 2 defeitos reais. Serve de piso (≥ 7), não de medidor fino. O número que informa é o de dúvidas **confirmadas**.
- O que o leitor encontrou e o avaliador não pode ver sempre foi **inconsistência entre texto e fluxo**. Os tipos de dúvida que se confirmaram: contradição prosa × fluxo, promessa da prosa que a lógica não cumpre, origem de dados não dita, negação na condição.

### Achados da iteração 14 (parte A)
- **Defeito 1 (confirmado):** o cenário «não localizado» diz «O resumo é recontado, mas nada muda», mas o fluxo vai de «O produto existe na pesquisa?» → «não» → «Nada gravado» sem passar por «Recontar o resumo». Ou o texto está errado, ou falta uma seta.
- **Defeito 2 (confirmado):** «Recontar o resumo» e os dados `coletados`/`nao_encontrados` dizem «contado/recontado **no banco**», mas o efeito calcula por soma e subtração a partir de `coletados_antes` e `nao_encontrados_antes`. O diagrama modela uma aritmética; a prosa promete uma contagem real.
- **Dúvida 3 (provável, não confirmada):** a origem dos dados `produto_localizado`, `tinha_coleta`, `*_antes` não está dita (entrada ou lida do banco?). Os dados têm texto, mas não dizem de onde vêm.
- Dúvidas 4 e 5 (`[BLOQUEIA]` do leitor): preço quando está marcado «não encontrado» e origem gravada nesse caso. Não confirmei; podem estar no diagrama sem ficar claras.
- 7 dúvidas de borda (valor vazio, `modifiedCount`, maiúsculas, concorrência, pesquisa inexistente, campos antigos, validação de preço): ficam como backlog.
- **O que o avaliador automático não vê, e um leitor LLM vê:** contradição entre texto e fluxo, e promessa da prosa que a lógica não cumpre. Um verificador mecânico disso exigiria entender linguagem natural; por isso o passo do Executor LLM continua necessário e não dá para substituí-lo pelas regras de `questionsFor`.
- **Não corrigi o diagrama** (é do seu cofre).

### Achados da iteração 13 (authoring)
- Restam textos de precificação **no motor** (mensagens de `logic.ts`/`expr.ts`, p. ex. `ex.: "preco < piso"` ao criar uma decisão sem condição) e no exemplo de precificação em si, que é legítimo. Não alterei: o prompt do loop proíbe mexer na lógica do motor.
- A sugestão do Esperado de Rule vem dos dados que ela **escreve**; uma Rule que só trava (`travar x`) fica com «dado = valor». Não verificado na UI para Rule; só para Decision.
- Falha do meu método, sem efeito no resultado: três tentativas de editar com script Python falharam por escape de `
`; a troca foi feita campo a campo com o `Edit`.

### Achados da iteração 12 (parte A)
- Restam 6 inadequados, todos com causa real: 3 por **layout gravado** (cruzamentos de setas: `janela-do-preco-coletado` 8, `quem-vem-primeiro` 7, `linha-da-submissao-vira-coleta` 5; só mudam com «Organizar», decisão sua) e 2 pelo exemplo grande de precificação (`simulacao.archflow.json` e `examples/exemplos-logic/precificacao.archflow.json`): cinco faixas do switch «Em que faixa está o preço?» e o caso «trafego» sem exemplo, a regra «Carregar o produto» com 13 efeitos e um rótulo com mais de 40 caracteres. Mais `pressao-competitiva` (rótulo longo) e a descrição que falta em `simulacao.archflow.json`.
- **Lição do método:** o avaliador também precisa ser validado contra o cofre. Eu o tinha validado com os 3 casos que escrevi e com mutações, mas não com diagramas feitos por outras mãos; foi o cofre que expôs a regra errada. Cada nova regra do Executor deve ser rodada no cofre antes de virar conclusão.
- Pendente (parte A): o Executor de contexto zero só foi rodado em 1 diagrama; o oráculo de `simulacao/*` não existe, então a representatividade segue `?`.

### Achados da iteração 11 (authoring)
- **Ciclo T5 medido:** ver a falta (0 ações, já está no quadro) → criar o caso que falta (≈ 6 ações, como na T4) → a marca some. Antes não havia como saber sem rodar o avaliador por fora.
- Decisão de desenho a confirmar com você: a marca de cobertura **tem prioridade sobre o ✓** do próprio nó (decisão com exemplo só do «sim» mostra «–», não ✓), mas nunca sobre o ✘. Em diagramas grandes sem cenários, quase todo cartão vai ficar marcado (ruído). Alternativa: marcar só quando o diagrama já tem pelo menos 1 cenário.
- O cenário que passa agora tem ✓ e o inspetor lista os dois casos; o ✘ de antes sumiu sozinho ao corrigir o esperado.

### Achados da iteração 10 (authoring)
- **T5 (cobrir o ramo que ficou de fora) não tem apoio no app:** nenhum lugar da UI mostra quais ramos de decisão, regras ou fins nenhum cenário exercita; só o avaliador JEV (`questionsFor`) sabe. Candidato de maior ganho de descobribilidade: marca no cartão (decisão/regra/fim) «sem cenário» ou «cobre N», reaproveitando a mesma conta.
- O cenário que falha fica isolado no canto, longe do fluxo, e o fluxo não mostra onde divergiu. O botão «Reproduzir o caminho» do inspetor já faz isso (conferido que existe; reprodução não exercitada nesta iteração).
- As animações de entrada do inspetor deixam o painel translúcido por ~1 s com o conteúdo do quadro aparecendo por trás: não é defeito permanente, mas confunde capturas e leitura imediata.
- Recontagem do que foi medido (nós T1, conexões T2, condição T3, efeito T3, cenário T4, falha T6): fluxo completo de criação ≈ 6 + 10 + 4 + 4 + 9 ≈ 33 ações; sozinho cada passo cumpre a meta de ≤ 12.

### Achados da iteração 9 (authoring)
- Todos os campos de expressão e efeito do inspetor Logic agora validam o rascunho: `when`, `on`, `until`, `foreach`, `then`, Dado e Esperado. Restam sem verificar o nome do dado (`key`) e o valor fixo.
- **Falha minha no método, corrigida:** num teste anterior o clique por referência errou o campo e o texto digitado virou atalhos do quadro (abriu o painel de Arquivos); o diagrama não foi alterado. Daí em diante só uso coordenadas de uma captura recente e confirmo o foco.
- **Vazamento de domínio persiste nos exemplos de Rule:** Dado «preco = 80 / marca_propria = verdadeiro» e Esperado «preco = 70» aparecem em qualquer regra. Só o cenário usa os dados do próprio diagrama.
- **Rótulo acessível errado no modo Logic:** as setas são anunciadas como «Conexão acesso a dados» (leitor de tela).
- Não medido: T5 e T6.

### Achados da iteração 8 (authoring)
- Mesmo padrão de falha silenciosa da iteração 7, agora em outro campo. Restam `then` (efeitos), `until`, `foreach` e o nome do dado (`key`).
- A mensagem do motor para um cenário vazio já é boa: `"total" não tem valor neste exemplo`.
- **Vazamento de domínio nos textos de exemplo do inspetor:** «Marca própria trava o preço antes do preço fixo.» (frase do cenário), «O preço de partida deu zero?» (pergunta da decisão) e «preco <= 0» (condição) são da engine de precificação e aparecem em qualquer diagrama. Backlog.
- **Limite do método:** o painel do navegador ficou estreito (365 px), as capturas saíram distorcidas e o clique por coordenada falhou; usei árvore de acessibilidade, digitação real e `click()` no DOM para exercitar a lógica. A aparência do inspetor nessa largura não foi avaliada.
- Não medido: T5 (cobrir o ramo que falta) e T6 (do ✘ ao nó culpado).

### Achados da iteração 7 (authoring)
- **Bloqueio 4 (corrigido): edição inválida descartada sem aviso e com o campo mentindo.** O mesmo padrão pode existir nos outros campos que passam pelo `patch` e são recusados pelo `ops` (efeitos `then`, exemplos, `until`, `foreach`). Não verificado: só o campo de expressão foi coberto.
- A mensagem de sintaxe vem do motor em português («esperava um valor mas veio o fim do texto»). Útil, mas sem exemplo do que escrever; a «Sintaxe das expressões» está recolhida logo abaixo.
- O botão de validação do topo diz «Validação do **domínio**» mesmo em Logic (rótulo acessível). Backlog.
- **Não medido ainda:** T4 (criar cenário), T5, T6; e T3 para o efeito de uma Rule (`preco := …`).

### Achados da iteração 6 (authoring)
- **Total T1+T2 medido: 16 ações** no pior caso (6 de nós + 5 conexões × 2: selecionar a origem e arrastar). Meta ≤ 12. Se os nós forem criados na ordem do fluxo, o recém-criado já está selecionado e cada conexão custa 1 arrasto (≈ 11). Melhoria possível: a alça «+» aparecer ao passar o mouse, sem selecionar antes.
- **Aberto (confuso para quem monta lógica):** o inspetor de uma conexão no modo Logic continua com título «CONEXÃO · ACESSO A DADOS», texto «Leitura/escrita em banco, cache ou storage (SQL…)» e campos Protocolo e Traçado, que são de arquitetura. O seletor «Saída de Decision» existe mas fica abaixo desse texto.
- **Não medido:** T3 (escrever condição/efeito: mensagem de erro de sintaxe), T4 (criar cenário), T5, T6.
- Os dois nós «Rule» nascem sem frase de negócio; o Executor automático vai perguntar por eles (esperado: pergunta legítima).

### Achados da iteração 5 (authoring)
- **Bloqueio 1 (corrigido): Decision e Loop da biblioteca não entravam e não diziam por quê.** A dica do quadro vazio fala de Início, Regra e Dado, não de Decisão, e é justo a decisão que não entrava.
- **Bloqueio 2 (aberto): os nós novos entram no centro da tela com ±40 px de sorteio e se sobrepõem** (o Start ficou escondido atrás da Rule). Quem monta um fluxo precisa arrastar cada nó antes de conectar. Ideia: posicionar o novo nó abaixo do selecionado, ou pós-processar com «Organizar» ao primeiro avaliar.
- **Não medido ainda:** T1 até o fim (conectar, rotular sim/não), T2–T6. Cliques em sequência rápida no painel às vezes não registraram; não reproduzi, não conto como defeito.
- Um aviso de método: o painel do navegador às vezes estoura o tempo da captura; repetir a captura resolve.

### Achados da iteração 4
- Efeito colateral deliberado: um relayout passa a gravar `auto: true` nesses grupos. Só vale para quem aciona «Organizar»; nenhum arquivo do cofre foi alterado.
- Ainda visíveis no relayout de `quem-vem-primeiro`: cruzamentos entre os filhos do switch e «Os custos são iguais?» (as setas que pulam camadas). É o próximo alvo de layout.

### Achados da iteração 3 (verificação visual)
- Relayout de `quem-vem-primeiro`, antes × depois, visto no app: no depois os dois filhos de «A tem receita maior?» ficam lado a lado e some a linha longa que atravessava o quadro. **Ainda sobram cruzamentos no meio** (filhos do switch e «Os custos são iguais?»); melhorou, não resolveu.
- **Defeito novo, visível nos dois prints:** após o layout automático, o quadro «Dados de entrada» fica vazio à direita e os cartões de entrada ficam soltos à esquerda (o quadro não os envolve). Backlog.
- A 36% de zoom o texto dos cartões fica ilegível: o diagrama é largo demais para caber legível num quadro de 1400 px.
- **Lição do método:** um número do avaliador não vale sem olhar a imagem. O passo «abrir no navegador» foi incluído no prompt (seção 3).

### Achados da iteração 2
- Os 7 cruzamentos de `quem-vem-primeiro` eram reais: `B vem primeiro pela receita` ficava em x=1200 separado do irmão por dois filhos do switch. Agora 4.
- Sobram 4 nele e 7 em `janela-do-preco-coletado` (clareza 6,5): setas que pulam camadas (o «não») atravessam a camada do meio. Próxima causa a atacar no layout, não nos diagramas.
- **Não verificado no navegador**: abrir esses diagramas no app troca o arquivo ativo do agente MCP. A medição é a mesma aproximação em linha reta; confirmar visualmente no sandbox (porta 5188).

### Achados da iteração 1
- **Contagem de perguntas e nota divergem.** 23 perguntas com entendimento 8/10: o leitor entendeu o caminho principal e perguntou pelas bordas. A meta «≤ 2 perguntas» é rígida demais para um diagrama real com 15+ passos; para o Executor LLM, separar **perguntas que bloqueiam** (não dá para seguir) das **de borda** (valor malformado, concorrência) e contar só as que bloqueiam. Proposta, não aplicada: depende da sua decisão sobre a meta.
- **O Executor automático pegou 6 de 23.** Só viu «decisão sem texto». Perguntas que ele não vê e são defeito de leitura do diagrama: negação na condição («não (usuário está vazio)», pergunta 4), dois nós levando à mesma regra sem dizer que é de propósito (2), termos de domínio sem definição, como «status» × «fase» (11 e 23).
- **Muitas das 23 perguntas são sobre o código real, não sobre o desenho** (concorrência, limpeza do blob, contrato das mensagens). Isso é escopo do diagrama, não clareza; não entram como defeito.

## Ressalvas da linha de base
- **Os três algoritmos de referência foram escritos junto com o avaliador**, então passar neles prova que o avaliador funciona, não que o app gere diagramas claros. Os controles negativos (`jev.test.ts`) são a prova de que ele reprova.
- **Executor com subagente de contexto zero rodado em 1 diagrama** (iteração 1); os outros 36 só têm o Executor automático.
- **Representatividade do cofre é `?`**: não há enunciado/oráculo para os diagramas reais. Escrever o oráculo é o primeiro passo da próxima iteração.
- **Cruzamentos de setas são uma aproximação** (linha reta entre centros dos cartões); confirmar visualmente.
- **Authoring (T1–T6) não medido.**

## Backlog (ordenado por impacto)
- [ ] Cofre: 7 diagramas inadequados (ver `npm run eval:jev -- diagrams --verbose`); começar por `importacao-worker/aceitar-upload` e `converter-arquivo` (decisões sem texto de pergunta) e `simulacao/quem-vem-primeiro` (7 cruzamentos de setas, clareza 5)
- [ ] Switch com ramo `outros` sem exemplo: sugerir o exemplo ao criar o switch
- [x] Executor com subagente de contexto zero em 1 diagrama (iteração 1)
- [x] Meta de perguntas do Executor LLM: classificar bloqueia × borda e confirmar cada uma (prompt, iteração 14)
- [ ] Cofre `registrar-coleta-de-preco`: corrigir a prosa do cenário «não localizado» (ou ligar a recontagem) e a de «contado no banco» × soma
- [x] Executor LLM em mais diagramas «adequados» (iteração 15): condescendente em 1 de 3; ver placar
- [ ] Cofre `validar-nome-e-tipo-do-cluster`: o Start diz que o tipo é normalizado «na troca do seletor» e o fluxo o modela dentro da validação; alinhar
- [ ] `margem-minima`: o resultado com margem ≥ 100% não é dito (o texto só diz que «não é recusada»)
- [ ] Nova regra automática candidata: condição de decisão escrita com negação («não …»)
- [x] Layout automático: quadro «Dados de entrada» vazio (iteração 4)
- [ ] Layout: setas que pulam camadas atravessam a camada do meio (`janela-do-preco-coletado`, `quem-vem-primeiro`)
- [ ] Aplicar «Organizar» nos diagramas do cofre é decisão sua (muda posições de arquivos reais); a mudança de layout só vale para eles depois disso
- [ ] Oráculo para os demais `simulacao/*` (feito: `margem-minima`); começar pelos pequenos (`teto-de-pmc`, `arredondar-preco`, `variacao-de-preco`)
- [ ] Decidir: exigir 100% do oráculo (hoje uma falha em 5 casos ainda dá 8,0 e cumpre a meta ≥ 8)
- [x] Authoring T5: marca «sem cenário» no quadro (iteração 11)
- [ ] Marca de cobertura: avaliar ruído em diagramas grandes sem cenários (marcar só se já houver 1 cenário?)
- [x] Authoring T1–T4 e T6 medidas; T3 para Rule feita (iteração 9)
- [x] Textos de exemplo do inspetor vazavam a precificação (iteração 13)
- [ ] Mensagens do motor citam `preco`/`piso` (p. ex. ao criar uma decisão sem condição); proibido mexer no motor neste loop, decidir se vale uma exceção
- [ ] Authoring: campos recusados em silêncio que restam: `key` do dado e valor fixo (condição, `then`, `until`, `foreach`, Dado/Esperado já cobertos)
- [ ] Rótulo acessível das setas em Logic diz «Conexão acesso a dados»
- [ ] Rótulo acessível do botão de validação diz «domínio» em modo Logic
- [x] Authoring: novos nós se sobrepõem (iteração 6)
- [ ] Authoring: inspetor da conexão em Logic mostra texto/campos de arquitetura («Acesso a dados», Protocolo)
- [ ] Authoring: alça «+» ao passar o mouse (hoje exige selecionar antes: 16 ações em T1+T2, meta 12)
- [ ] Authoring: a dica do quadro vazio (Logic) não cita a Decisão
