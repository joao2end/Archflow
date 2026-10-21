# Prompt de loop — Revisão dos workflows (Archflow, modo agents)

Valida, a cada 5 minutos, os workflows que geram a landing page de 3 produtos: **usabilidade, funcionalidade e performance**,
com Playwright. Cada iteração confere UMA célula da matriz (produto × dimensão), registra e corrige no máximo UM achado.

Uso:

```
/loop 5m Siga as instruções de docs/WORKFLOW_REVIEW_LOOP_PROMPT.md, seção "PROMPT"
```

---

## PROMPT

Você revisa, uma célula por vez, a matriz de `docs/workflow-review-score.md`. Cada execução: ler → testar no navegador → registrar → (corrigir UM achado) → parar. Cabe em ~4 minutos: se uma checagem estourar o tempo, registre «incompleta» e siga.

### 0. Estado (leia primeiro, nesta ordem)
1. `docs/workflow-review-score.md`: produtos, matriz, achados abertos e o contador de iterações. A primeira célula `[ ]` (percorrendo P1→P2→P3 dentro de cada dimensão: F, depois U, depois P) é a sua. Sem célula `[ ]` e sem achado `aberto`: PARE o loop (`ScheduleWakeup` com `stop: true`) e relate o resultado final.
2. `git status --short`: o working tree tem mudanças do usuário. Não reverta, não use `git stash`/`checkout`/`reset`, não formate arquivos que não são seus.
3. Achado `aberto` de severidade alta tem prioridade sobre células novas: corrija-o antes (veja §4).

### 1. Ambiente (instância isolada; o `pnpm run dev` do usuário NÃO é seu)
Não derrube nem reinicie o bridge/vite do usuário (7077 e as portas 51xx de outros vites: **5191/7091 já são de outra instância**) e não use `Stop-Process`/`pkill` por nome. Suba a sua uma vez (confira antes: `Get-NetTCPConnection -LocalPort 5192`) e reaproveite nas iterações seguintes. Se o app do usuário estiver rodando workflows, os `claude.exe` dele NÃO são seus.

- **Navegador:** o MCP do Playwright exige o Chrome (não instalado aqui). Use `playwright-core` com o Edge: `mkdir -p $S/pw && cd $S/pw && npm init -y && npm i playwright-core@1.49.1` e `chromium.launch({ channel: "msedge", headless: true })`. Os scripts de teste ficam em `scripts/review/*.mjs` e leem `PW_DIR=$S/pw`.
- **Subir a instância** (Windows, Git Bash):

```
S=<scratchpad da sessão>; mkdir -p $S/iso/{cfg,data,claude,bin,proj}
# claude de mentira (sem custo, determinístico): scripts/fake-claude.mjs. Aponte para um wrapper .cmd (Windows) ou script executável:
#   $S/iso/bin/claude.cmd  =  @node "<repo>\scripts\fake-claude.mjs" %*
# NÃO dependa do PATH (o claude.exe real do usuário ganhou): use ARCHFLOW_CLAUDE_BIN (caminho absoluto) — o bridge usa só esse.
CLAUDE_CONFIG_DIR=$S/iso/claude ARCHFLOW_PORT=7092 ARCHFLOW_CONFIG=$S/iso/cfg ARCHFLOW_DATA=$S/iso/data PORT=5192 FAKE_CLAUDE_DELAY_MS=1200 ARCHFLOW_CLAUDE_BIN=<caminho do claude.cmd> nohup npx vite --configLoader runner > $S/iso/vite.log 2>&1 &
```
- Use `npx vite` direto, não `pnpm run dev` (o `dev` encerra o bridge da porta). Confira em `curl localhost:7092/api/term/info?refresh=1` que `claude.version` é `9.9.9` (o fake). Se aparecer uma versão real, PARE: o teste abriria o Claude de verdade.
- `FAKE_CLAUDE_DELAY_MS` (aqui 1200; padrão 300) controla a lentidão; `FALHAR` no texto faz o passo falhar; `NEGAR` faz o `WebSearch` voltar «permission denied» se não estiver liberado em «Permissões».
- **Projeto e diagrama por produto:** `POST localhost:7092/api/projects/create {name, parent:$S/iso/proj}` e depois `npx tsx scripts/review-mkdoc.ts "Landing <Produto>" 7092` (aplica o modelo **«Landing page Vue 3 com assets e motion»** e grava via `PUT /api/doc {doc}` — o corpo é `{doc}`, não o doc solto). O app fica em `http://localhost:5192/app` (a raiz é a landing do Archflow).
- Antes de cada teste encerre as sessões antigas (`POST /api/term/kill` com o token de `/api/term/info`): o limite é de 4 terminais vivos. O `scripts/review/f.mjs` já faz isso.
- Ao terminar a iteração, deixe a instância no ar. Só encerre quando o loop parar: PID pela porta, nunca por nome.

### 2. Os 3 produtos (variáveis do formulário do workflow)
Use exatamente estes valores (estão na tabela do score doc):
- **P1 Forja3D** — impressora 3D de resina para makers · público: makers e pequenos estúdios · tom: técnico e direto
- **P2 Poupa+** — app de finanças para autônomos · público: freelancers e MEIs · tom: leve e confiável
- **P3 Brisa** — purificador de ar inteligente · público: famílias em apartamento · tom: acolhedor

### 3. Testar com Playwright (a célula da vez)
Abra `http://localhost:5192`, projeto do produto, selecione o nó «Landing page completa» → «▶ Executar no Claude Code». Tire screenshot (viewport 1280×800) de cada estado relevante e salve em `docs/screenshots/workflow-review/<P#>-<dimensão>-<n>.png`. Console sem erros novos é critério de todas as dimensões.

**F — Funcionalidade** (passa só se TODOS valerem; anote o que falhar). O script `PW_DIR=$S/pw node scripts/review/f.mjs <produto> <público> <tom> <P#>` cobre F1, F2, F4, F5, F6 e F9 (leva ~3–4 min com delay 1200: rode em background e leia o log). F3, F7 e F8 são variantes: rode de novo com `NEGAR` ou `FALHAR` no produto e, para «Parar», clique no botão durante um passo auto.
1. O formulário pede `produto`, `publico`, `tom` e NÃO pede `anterior` nem `resultado.*`.
2. «Permissões» lista as ferramentas do diagrama; marcar `WebSearch` e `WebFetch` e executar → o passo 1 (auto) mostra na aba `sessão iniciada`, `● WebSearch(...)`, a resposta e `✓ concluído` (texto legível, sem JSON cru).
3. Sem marcar `WebSearch` e com `NEGAR` na variável `tema`/`produto` → a aba mostra `erro: permission denied`; marcando, não mostra.
4. A resposta do passo 1 aparece em «memória · N caracteres» no cartão; o passo 2 (manual) chega ao terminal com o texto do `{{anterior}}` preenchido (procure `RESPOSTA 1 (fake)` no texto digitado).
5. Passo manual: pressione Enter na aba, clique «Próximo passo» → o passo seguinte começa; a memória do passo manual é guardada.
6. **Voltar**: no passo 4, «← Voltar» refaz o 3; o botão ↺ de um passo anterior refaz dele em diante, a conversa continua a mesma (`--resume`, mesma `sessionId`) e as respostas dos passos refeitos somem da memória.
7. Falha: `FALHAR` no texto → o passo fica «Falhou», «Tentar de novo» e «Pular» funcionam, a execução não trava.
8. «Parar» durante um passo auto encerra o processo (a aba some/indica saída) e permite «Rodar de novo».
9. Fim: estado «Concluído», todos os passos com ✓, memória de cada um disponível e «Copiar» funciona.
Variante curta (use quando só precisa re-testar algo): workflow «Só assets e motion» (3 passos).

**U — Usabilidade** (0 = falha, 1 = aceitável, 2 = bom; registre a nota e a evidência). O script `PW_DIR=$S/pw node scripts/review/u.mjs <P#>` mede cliques, estados, foco/aria, responsivo e contraste e salva screenshots; **abra os screenshots antes de dar nota** (as métricas sozinhas já deram 14/14 com o terminal ilegível em 390px).
- Cliques do nó selecionado até o passo 1 rodando (meta ≤ 4).
- Estados sempre legíveis: chip («Rodando», «Aguardando você», «Falhou», «Concluído»), texto de ajuda do estado, progresso.
- Navegação por teclado: Tab alcança formulário, permissões, Executar, ↺ e Voltar; foco visível; `aria-label` nos botões de ícone; os grupos Manual/Auto têm `role=radiogroup`.
- Responsivo: 1280, 768 e 390 de largura sem rolagem horizontal nem texto cortado no painel (screenshot de cada).
- Descobribilidade: dá para entender o que é «memória», «Voltar» e as permissões sem ler docs? Mensagens de erro dizem o que fazer?
- Tema claro e escuro: contraste do cartão, chips e do bloco de memória.

**P — Performance** (meça com `performance.now()`/`PerformanceObserver` via `page.evaluate`; registre os números)
- Script: `BASE=<vite preview de um build> PW_DIR=$S/pw node scripts/review/p.mjs <P#>` (build: `ARCHFLOW_PORT=7092 npx vite build --configLoader runner --outDir $S/dist` e `npx vite preview --port 5193 --outDir $S/dist` com o mesmo env). **Meça carga no build de produção**, não no dev server; se algo passar de 1 s, tire um perfil de CPU (CDP `Profiler`) em vez de achar que é ambiente — o «Edge lento» era um travamento de 9,7 s do próprio app.
- Abertura: `load` da página, tempo do clique no nó até o formulário visível, tempo do «Executar» até a primeira linha na aba (meta < 1,5 s com delay 300).
- Overhead entre passos: do fim de um passo auto ao início do seguinte (meta < 2 s além dos 700 ms de espera da aba interativa).
- Tarefas longas (> 50 ms) durante a execução; heap JS (`performance.memory.usedJSHeapSize`) antes/depois de uma execução completa e de 3 execuções seguidas (não pode crescer sem parar).
- Canvas com o modelo aplicado (~44 nós): arrastar/zoom sem queda de quadros perceptível (frames > 50 ms).
- Saída grande: `FAKE_CLAUDE_DELAY_MS=0` e um texto de 20 mil caracteres → a aba e o cartão continuam responsivos.
- Fase R (**só com `real: autorizado` no score doc**, padrão `não`): rodar o workflow com o `claude` real em UM produto e medir a landing gerada em `site/` (`vite build` + servir): LCP, CLS, peso total, nº de requisições, nota de acessibilidade. Sem autorização, registre «R: pulada».

### 4. Corrija UM achado (pequeno e reversível)
- Achado = comportamento que viola um critério acima. Registre com id `W<n>`, severidade (alta/média/baixa), passos para reproduzir e a evidência (screenshot/número).
- Corrija no máximo UM por iteração, o de maior severidade que caiba em poucas linhas. Lógica pura em `src/shared/*` com teste ao lado; UI em `src/ui/*`; I/O em `server/*`. Siga o estilo existente (pt-BR, comentários curtos).
- Segurança é inegociável: não relaxe origem/token, não passe entrada do usuário por shell, nunca `--dangerously-skip-permissions`, não libere `Bash`/`Write`/`Edit` no `--allowedTools`.
- Depois de corrigir: `npx tsc --noEmit` limpo, os testes do que tocou (`npx tsx --test <arquivo>`), e refaça a checagem que falhou no navegador. Falha conhecida e anterior: «exemplos: os arquivos em examples/ estão em dia» e o `server/terminal.e2e.test.ts` lento: não são seus.
- Se não resolver rápido, desfaça SÓ a sua mudança, deixe o achado `aberto` com a causa provável e siga.
- Não faça commit: o usuário decide.

### 5. Registre e relate
Atualize `docs/workflow-review-score.md`: marque a célula (`[x]` com nota/números), inclua os achados e incremente o contador. Responda:

```
WORKFLOW REVIEW #<n> — <P# produto> · <F|U|P>
Resultado: <passou | passou com ressalvas | falhou> — <1–2 frases>
Números: <tempos/notas medidos>
Achados: <W# novos / corrigidos / abertos>
Arquivos: <lista curta, se corrigiu algo>
Validação: tsc ok · testes <o que rodou> · navegador <conferido>
Próxima célula: <P# · dimensão> | Fim: <motivo>
```
