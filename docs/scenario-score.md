# Scenario score — histórico

Medido com `npm run eval:scenario` (JEV: atritos de criação/leitura/posição, exemplos verificados) + conferência no navegador.

| # | Data | Frente | Facilidade | Esforço (campos/cenário) | Mudança | Verificação |
|---|------|--------|-----------|---------------------------|---------|-------------|
| 0 | 2026-10-13 | linha de base | 42 atritos em 187 cenários (41 criação, 1 leitura) | 9,7 | — | — |
| 1 | 2026-10-13 | tela de reprodução | sem mudança no script (só visual) | 9,7 | A câmera centraliza o passo atual na área livre acima do painel (altura real), não mais em 36% fixo | Navegador 1024×768: passo 2 centralizado acima do painel, sem ser coberto; console limpo; typecheck ok |
| 2 | 2026-10-13 | criação | script não mede o fluxo da UI (41 atritos, igual) | 9,7 → ~2 a digitar na UI (só ajustar números) | «+ Exemplo» agora nasce com as entradas do fluxo já preenchidas (padrão do dado ou neutro pelo tipo: 0, falso, "") e `desfecho = "ok"` no cenário; o botão «Usar como esperado» completa o resto | Navegador: cenário de Pressão competitiva ganhou 6 entradas + desfecho; Ctrl+Z desfez; typecheck ok; `npm test` 257 ok (1 falha pré-existente em examples) |
| 3 | 2026-10-13 | criação | script não mede a UI (igual) | — | Ao adicionar um Cenário ao quadro ele já nasce com o 1º exemplo (entradas do fluxo + `desfecho = "ok"`); lógica única em `starterExample` (shared/logic.ts, com teste) usada também por «+ Exemplo» | Navegador: Cenário novo veio com 6 entradas + desfecho; Ctrl+Z desfez e o arquivo do cofre ficou sem sobras; typecheck ok; testes 257 ok (1 falha pré-existente em examples) |
| 4 | 2026-10-13 | criação | igual (41 atritos; o script só lê diagramas prontos) | — | O Cenário novo nasce chamado «Caso N» (N = nº de cenários + 1) em vez de «Scenario» | Navegador: «Caso 12» num diagrama com 11 cenários; Ctrl+Z desfez e o arquivo do cofre ficou limpo; typecheck ok; testes 257 ok (1 falha pré-existente em examples) |
| 5 | 2026-10-13 | medição (eval) | 41 → 0 atritos nos 187 cenários do cofre/exemplos | 9,7 | `eval:scenario` só acusa «não informa <entrada>» quando o exemplo FALHA (se passa, o caminho não lê a entrada); «nova»/«novo» sozinhos deixam de ser nome genérico. Conferido com um cenário vazio sintético: 7 atritos, nota 0, exit 1 | typecheck ok; sem mudança de UI |
| 6 | 2026-10-13 | tela de reprodução | 0 atritos (igual) | — | O painel agora respeita o inspetor (classe `with-inspector`) e o dock: ocupa só a área livre (variáveis CSS `--pl`/`--pr`); em painel estreito (≤720px) o título ganha a 1ª linha e o rótulo «Velocidade» some | Navegador 1024×768: painel 96–702px, inspetor 728–1018px, dock até 78px, sem sobreposição; título inteiro; console limpo; typecheck ok |
| 7 | 2026-10-13 | tela de reprodução | 0 atritos (igual) | — | Painel recolhível: botão chevron (aria-expanded) deixa só controles, barra e o passo atual (399 → 142px) para ver o desenho inteiro; a câmera recentraliza o passo na área livre | Navegador 1024×768: 399→142px, passo visível acima do painel, botão 36px dentro do painel; typecheck ok. Console: só erros antigos de HMR de uma edição anterior (página recarregada funciona) |
| 8 | 2026-10-13 | tela de reprodução | 0 atritos (igual) | — | CSS consolidado: a raiz de `.logic-play-panel` tinha 4 blocos com width/height/max-height conflitantes (44vh vs 52vh); agora é 1 bloco com os valores que já valiam (sem mudança visual) | Navegador 1024×768: antes e depois idênticos (96–702px, 399px de altura, bottom 84px, container-type inline-size); typecheck ok |
| 9 | 2026-10-13 | criação | 0 atritos (igual) | — | Ao adicionar um Cenário, o campo Nome do inspetor já abre selecionado (reaproveita `focusTick`): criar um caso vira «adicionar → digitar o nome → ajustar números» | Navegador: foco em `#insp-first` com «Caso 12» todo selecionado; Ctrl+Z desfez e o cofre ficou limpo; typecheck ok; testes 260 ok, 0 falhas |
| 10 | 2026-10-13 | medição final | 0 atritos em 187 cenários; JEV de referência 3/3 adequados | 9,7 | Sem mudança de código: critério de parada atingido (script limpo, nada de severidade alta; a «média» restante é nota de processo). Loop encerrado | typecheck ok; `npm test` 260 ok, 0 falhas |

## Backlog (severidade)
- [info] Eval agora limpo (0 atritos): próximas notas só vêm de novos cenários; considerar medir também clareza do texto (frase com ≥ 5 palavras) e o cenário de falha.
- [média] Processo: testes no navegador são autosalvos no cofre real (diagrams/); usar sempre Ctrl+Z e conferir o arquivo, ou testar num diagrama descartável.
- [baixa] Eval: o script não simula a UI; medir esforço pelo `hint.blank` (campos preenchidos automaticamente) em vez de contar linhas.
- [baixa] Visual: com biblioteca/arquivos E inspetor abertos juntos em <1200px sobra < 360px; hoje o painel sobrepõe um deles (considerar fechar o inspetor durante o play).
- [baixa] Recolher: lembrar a escolha entre sessões (localStorage) e atalho de teclado.
- [baixa] Eval: «não informa» pode ser falso positivo quando a entrada só é lida em ramo não exercitado.
- [info] `npm test` está verde (260/0) desde a iteração 9.
