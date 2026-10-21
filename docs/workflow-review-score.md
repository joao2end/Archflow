# Revisão dos workflows — placar

Loop: `docs/WORKFLOW_REVIEW_LOOP_PROMPT.md` (a cada 5 min). Preenchido pelo próprio loop.

- iteração: 10
- real: não  <!-- troque para «autorizado» para liberar a Fase R (claude real, gasta tokens) -->
- instância isolada: app http://localhost:5192 · bridge 7092 (subida pelo loop)

## Produtos

| id | produto | público | tom |
|---|---|---|---|
| P1 | Forja3D — impressora 3D de resina para makers | makers e pequenos estúdios | técnico e direto |
| P2 | Poupa+ — app de finanças para autônomos | freelancers e MEIs | leve e confiável |
| P3 | Brisa — purificador de ar inteligente | famílias em apartamento | acolhedor |

## Matriz (F = funcionalidade · U = usabilidade · P = performance)

| célula | status | resultado / números |
|---|---|---|
| P1 · F | [x] passou (com 2 correções) | F1–F9 ok: formulário 0,3 s · 1ª linha do passo 1 0,3 s · voltar mantém 1 sessionId · 9/9 ✓ · F3 (NEGAR) ok · F7 (FALHAR → tentar de novo/pular) ok · F8 (Parar) 80 ms, 0 processos -p vivos · console sem erros. Scripts: scripts/review/f.mjs e g.mjs. |
| P2 · F | [x] passou | f.mjs: F1,F2,F4,F5,F6,F9 ok (formulário 0,33 s · 1ª linha 0,28 s · 1 sessionId · 9/9 ✓) · g.mjs: F3,F7,F8 ok (Parar 81 ms, 0 -p vivos). Único «FALHA»: erro de WebSocket no console por matar sessões com a página aberta (teste; corrigido em g.mjs). |
| P3 · F | [x] passou | f.mjs: F1,F2,F4,F5,F6,F9 ok (1 sessionId · 9/9 ✓) · g.mjs: F3,F7,F8 ok (Parar 78 ms, 0 -p vivos) · console sem erros. Matriz F completa (P1–P3). |
| P1 · U | [x] passou com ressalvas — 12/14 | U1 2 (3 cliques + 3 campos, 0,6 s) · U2 2 (4/4 estados com ajuda, barra progressbar) · U3 1 (foco visível 2px, 0 controles sem nome; falta provar o caminho só por teclado até o formulário) · U4 1 (390px: ficou legível depois do W9, mas só ~1 passo visível e o aviso «Primeira vez…» come ~60px) · U5 2 (↺ e memória com title) · U6 2 (contraste ≥ 4,8:1 em 4 seletores, claro e escuro). Script: scripts/review/u.mjs. |
| P2 · U | [x] passou com ressalvas — 17/18 | U1 2 · U2 2 · U3 2 · U3b 2 (12 Tabs: campos → Permissões → 7 caixas → modo → Executar, Enter inicia) · U3c 2 (foco fica no formulário) · U4 1 (390px legível mas apertado, como no P1) · U5 2 · U6 2 · console 0 erros. 3 achados reais de acessibilidade/usabilidade corrigidos (W10–W12). |
| P3 · U | [x] passou com ressalvas — 19/20 | W10–W12 seguem corrigidos (U3b 12 Tabs ok, U3c foco no formulário ok). U1 2 · U2 2 · U3 2 · U4 1 (390px apertado, igual P1/P2) · U5 2 · U6 2 · U7 2 (novo: painel 280px estável com a memória aberta) · console 0 erros. Achado novo W13 corrigido. |
| P1 · P | [x] passou (depois de corrigir W14) | build de produção (vite preview) com o `claude` de mentira: carga 344 ms (era ~10 s) · nós visíveis 412 ms · canvas 44 nós p95 33 ms (1 quadro > 50 ms em 109) · formulário 295 ms · 1ª linha do passo 1 301 ms · overhead entre passos 77 ms · heap 21→14 MB em 3 execuções (sem crescer) · saída de ~20 mil caracteres em 138 ms, clique 51 ms · 0 tarefas longas. Script: scripts/review/p.mjs. |
| P2 · P | [x] passou 8/8 | carga 268 ms · nós visíveis 383 ms · canvas p95 17 ms (1 quadro > 50 ms em 110) · formulário 306 ms · 1ª linha 248 ms · overhead entre passos 72 ms · heap 20,7→14,6 MB em 3 execuções · saída de ~20 mil caracteres em 148 ms (clique 59 ms) · 0 tarefas longas · console 0 erros. Sem regressão em relação ao P1. |
| P3 · P | [x] passou 8/8 | carga 228 ms · nós visíveis 325 ms · canvas p95 33 ms · formulário 315 ms · 1ª linha 238 ms · overhead entre passos 69 ms · heap 20,7→14,6 MB · saída de ~20 mil caracteres em 145 ms (clique 61 ms) · 0 tarefas longas · console 0 erros. |
| Fase R (claude real) | [ ] pulada | exige `real: autorizado` |

## Achados

| id | sev. | estado | descrição / como reproduzir | evidência |
|---|---|---|---|---|
| W1 | média | corrigido e conferido (w1.png: nomes inteiros no inspetor) | Inspetor do workflow: nomes dos passos truncados a 4–5 letras porque Manual/Auto/↑/↓/× ocupam a linha. Fix: `.wf-step-edit` (controles passam para a linha de baixo). | P1-F-timeout.png (antes) |
| W2 | baixa | corrigido | `fake-claude.mjs` usava `process.exit` e perdia as últimas linhas no pipe (Windows) → `✓ concluído` nunca aparecia. | teste |
| W3 | média | corrigido | Com o `claude` real no PATH (`.localinclaude.exe`) o bridge isolado abria o Claude de verdade. Novo `ARCHFLOW_CLAUDE_BIN` (caminho absoluto) força o executável. | P1-F form.png |
| W4 | média | aberto (inconclusivo) | Prompt multilinha digitado no terminal perde as quebras (`…asset vis
ual.Pesquisa do passo anterior:`). O fake não implementa bracketed paste: confirmar com o `claude` real (Fase R) ou fazer o fake tratar `ESC[200~`. | P1-F-erro.png |
| W5 | baixa | corrigido (teste) | `scripts/review/f.mjs`: no fim, `manual()` pode ver «Aguardando você» obsoleto e clicar em «Próximo passo» que já sumiu (timeout 30 s). Trocar o laço final por checagem do botão + timeout curto. | P1-F-erro.png |
| W7 | alta | corrigido | «▶ Executar no Claude Code» do inspetor abria a LISTA de workflows em vez do formulário do nó (só no dev/StrictMode: os efeitos rodam 2x, o reset de «outro projeto» fechava o formulário e a guarda `lastFocus`/`lastReq` impedia reabrir). Efeitos agora dependem só do pedido e o pedido é limpo depois. Vale também para prompts. | h2.mjs (DBG reset ×2) |
| W8 | baixa | corrigido (defensivo) | «Parar»/«Voltar» logo ao iniciar: a sessão nascia depois do aborto e ficava viva. Agora `workflow.tsx` fecha a sessão recém-aberta se o passo já não está ativo. Não reproduzido de forma isolada (o 1 vivo observado era outra execução), mas a corrida existe no código. | g.mjs F8 |
| W9 | média | corrigido | Em ≤ 720px a barra de prompts/workflows (280px fixos) espremia o terminal a ~70px de largura (texto ilegível). Agora empilha acima do terminal (`@media (max-width: 720px)` em styles.css): terminal 352×139 em 390px. A métrica automática antiga (largura da barra) dava 2/2: o screenshot é que mostrou. | P1-U-card-390.png |
| W10 | média | corrigido | **Espaço não ativava botões nem `summary`** em todo o app: `keys.ts` fazia `preventDefault` no Espaço (atalho de mover a tela) mesmo com foco em controle. Agora o Espaço é do controle quando o alvo é button/summary/a/select/role=button·radio·checkbox·tab·menuitem. | k3.mjs (open=false → true) |
| W11 | média | corrigido | **O terminal roubava o foco** do formulário do workflow ~1 s depois de «Executar» no inspetor: quem começava a digitar mandava o texto para o Claude, e o Tab ficava preso no xterm. `TermView` não rouba o foco de input/textarea/select/summary fora do terminal, e o formulário agora foca o primeiro campo ao abrir. | k3.mjs, u.mjs U3c |
| W12 | baixa | corrigido | Linha de passo do cartão quebrava em duas (nome comprido empurrava «auto · código · pulado» e ↺ para baixo): nome agora corta com «…» (title com o nome inteiro). | P2-U-aguardando-1280.png |
| W13 | média | corrigido | Ao abrir «memória» no cartão, o painel crescia de 280 para 521px (empurrava e reflowava o terminal) e o texto da resposta/da dica `{{resultado.id}}` ficava cortado. Causas: `.prompts-side` com `min-width:auto`, grade `.wf-steps` sem `minmax(0,1fr)` e linhas sem quebra. Corrigido em styles.css (min-width:0, `grid-template-columns: minmax(0,1fr)`, `overflow-wrap:anywhere`). Medido: li 276px, pre 254px, painel 280px. | P3-U-tema-light.png, m.mjs |
| W14 | **alta** | corrigido | **O app travava ~10 s ao abrir** (tarefa longa de 9,7 s na carga, no build de produção e no dev, na landing e no /app): `exampleCatalog = buildCatalog(...)` em `store.ts` montava, na carga do módulo, todos os diagramas de exemplo do modo Domain (`buildExample` → `applyOps` + layout + roteamento: 9,4 s, quase tudo em `geometry.ts`). Corrigido: o catálogo guarda só os caminhos e cada diagrama é montado (e memorizado) quando o exemplo é aberto (`buildExampleFile` em examples.ts + `examples.catalog.ts`). Carga 10,2 s → 0,34 s. Preexistente (commit 9ea4433), não veio desta branch. | perfil CDP; p.mjs |
| W6 | baixa | corrigido e conferido | Abas repetidas («· 3/9» duas vezes após «Voltar») agora levam «(2ª vez)»; o aviso «Primeira vez nesta pasta?» some sozinho 20 s depois de cada sessão com texto digitado (sem gravar «não mostrar mais»). Verificado em f.mjs (títulos únicos; 0 avisos após 20 s). | f.mjs |
| W15 | média | aberto (decisão de produto) | O limite de 4 terminais vivos é GLOBAL (somando projetos) e a lista de abas só mostra os do projeto aberto: com sessões esquecidas em outro projeto o app devolve 429 «feche algum» sem como fechá-lo. Opções: limite por projeto, ou um botão «ver/encerrar sessões de outros projetos». Hoje só reabrindo o outro projeto. | 429 nos testes P3 | Abas de terminal repetem o título «· 3/9» após «Voltar» (duas abas iguais, uma «saiu»); e o aviso «Primeira vez nesta pasta?» fica fixo durante toda a execução. | P1-F-erro.png |

## Histórico

- #10 (P3 · P) — 8/8. **Matriz completa (9/9 células).** W6 corrigido; W15 registrado (429 por sessões de outros projetos); `kill-all.mjs` criado (o killAll antigo só limpava o projeto aberto). LOOP ENCERRADO (cron 45d63912 removido, instância isolada derrubada): restam só W4 (precisa do `claude` real: Fase R, exige `real: autorizado`) e W15 (decisão de produto).

## Resultado final

- F 3/3 · U 3/3 (19, 17 e 19 de 20 por produto; U4 sempre 1: 390px apertado) · P 3/3 (8/8).
- Corrigidos: W1, W2, W3, W5, W6, W7, W8, W9, W10, W11, W12, W13, W14. Abertos: W4, W15.
- Maior ganho: W14 (app abria em ~10 s; agora ~0,3 s). Mais perigosos: W7 (formulário não abria), W10/W11 (Espaço não ativava botões; terminal roubava o foco do formulário).
- #9 (P2 · P) — 8/8, sem regressão. Conferi também o que ficou sem prova no #8: painel «Exemplos» abre em ~50 ms (25 exemplos: 4/5/16), a aba Domínio lista em < 0,5 s e «Instalar e abrir» do exemplo da Biblioteca abre «Visão geral» em ~60 ms; sem erros no console. Próximo: P3 · P (última célula da matriz).
- #8 (P1 · P) — performance. W14 (alta) achado por perfil de CPU: 9,4 s de startup montando exemplos. Corrigido (carga 10,2 s → 0,34 s); 437 testes de src/shared passam. As 2 fontes woff2 «lentas» eram sintoma do mesmo travamento, não do servidor. Próximo: P2 · P e P3 · P (rodar `BASE=<vite preview> p.mjs` por produto; basta confirmar que não regride).
- #7 (P3 · U) — 19/20. W13 achado e corrigido pela comparação screenshot × medida (a métrica só media a largura com a memória fechada; criei U7). Matriz F e U completas. Próximo: P1 · P (performance; `performance.now` via Playwright, heap, tarefas longas, canvas de 44 nós, saída de 20 mil caracteres).
- #6 (P2 · U) — 17/18. Três achados reais, todos de teclado/foco/linha (W10–W12), vistos só porque abri os screenshots e testei o Tab de verdade; o u.mjs ganhou U3b (caminho só por teclado) e U3c (foco após «Executar»). Próximo: P3 · U (rodar `u.mjs P3` no projeto Brisa; conferir se W10–W12 seguem corrigidos).
- #5 (P1 · U) — U 12/14. W9 (média) corrigido: terminal espremido em tela estreita. Lição: conferir SEMPRE o screenshot, a métrica sozinha deu 14/14. Próximo: P2 · U (repetir `u.mjs` no projeto Poupa+; aprofundar U3: Tab do cartão até Executar sem mouse).
- #4 (P3 · F) — Brisa: tudo ok. O log do f.mjs parecia comer todo «s» do texto do terminal: era regex sem a barra (`/s+/g`) no próprio script, não o app (corrigido). Próximo: P1 · U (usabilidade).
- #3 (P2 · F) — Poupa+: tudo ok, sem achados novos de produto. Próximo: P3 · F (Brisa).
- #2 (P1 · F, fechamento) — F3/F7/F8/F9 ok. W7 (alta) e W8 corrigidos; W1 conferido. Próximo: P2 · F (`PW_DIR=$S/pw node scripts/review/f.mjs Poupa+ "freelancers e MEIs" "leve e confiável" P2`; antes `npx tsx scripts/review-mkdoc.ts "Landing Poupa+" 7092` num projeto novo).
- #1 (P1 · F) — instância isolada 5192/7092 com `ARCHFLOW_CLAUDE_BIN` (fake). F1/F2/F4/F5/F6 ok; W1–W3 corrigidos; W4–W6 abertos. Playwright via `playwright-core` + Edge (o MCP exige Chrome, ausente).
