# Prompt de loop — Terminal do Claude Code (Archflow, modo agents)

Uso (ritmo dinâmico; cada iteração é uma tarefa do backlog):

```
/loop Siga as instruções de docs/TERMINAL_LOOP_PROMPT.md, seção "PROMPT"
```

---

## PROMPT

Você implementa, uma tarefa por vez, o backlog de `docs/terminal-claude-plan.md` (seção «Backlog do loop»): o terminal do Claude Code dentro do Archflow. Cada execução é UMA tarefa: ler → implementar → validar → registrar → parar.

### 0. Estado (leia primeiro, nesta ordem)
1. `docs/terminal-claude-plan.md`: decisões fechadas e backlog. A primeira tarefa `[ ]` é a sua. Não reabra decisões; não faça mais de uma tarefa por iteração.
2. `git status --short`: o working tree tem mudanças do usuário e de iterações anteriores. Não reverta, não use `git stash`/`checkout`/`reset`, não formate arquivos que não são seus.
3. Se a tarefa está bloqueada, registre no plano e passe à próxima que não dependa dela. Se nenhuma puder andar, ou se todas estiverem `[x]`, PARE o loop (`ScheduleWakeup` com `stop: true`) e diga o que falta.

### 1. Antes de escrever código
- Leia os arquivos que vai tocar e os testes vizinhos (`server/terminal.ts`, `server/bridge.ts`, `src/ui/store.ts`, `src/ui/agents.tsx`). Siga o estilo existente (pt-BR nos textos, comentários curtos).
- Fatos estabelecidos: protocolo WS e segurança em `server/terminal.ts` (cabeçalho); `node-pty` carrega sob demanda e pode falhar (501); `spawn-helper` já é corrigido em runtime; o bridge só escuta loopback; PATH do shell de login no macOS já é tratado em `electron/main.ts`.

### 2. Implemente (uma tarefa, pequena e reversível)
- Lógica pura em `src/shared/*` com teste ao lado (`node:test`); I/O em `server/*`; UI em `src/ui/*`.
- Segurança é inegociável: não relaxe origem/token, não passe entrada do usuário por shell, não exponha o terminal em `PUBLIC_MODE`, nunca use `--dangerously-skip-permissions`.
- Dependências novas só se indispensáveis; use `npm install` (lockfile canônico: `package-lock.json`).

### 3. Valide
- `npx tsc --noEmit` limpo.
- `npm test`: sem NOVAS falhas. Falha conhecida e anterior: «exemplos: os arquivos em examples/ estão em dia» — não é sua.
- UI visível → confira no navegador (Playwright) em instância isolada, com screenshot e console sem erros novos.
- Se não resolver rápido, desfaça SÓ a sua mudança, registre o motivo no backlog e pare.

### Ambiente (instância isolada; o `npm run dev` do usuário NÃO é seu)
Não reinicie nem derrube o bridge do usuário (7077/5173), não use `pkill` por nome.
```
S=<scratchpad da sessão>; mkdir -p $S/iso/{cfg,data,proj}
ARCHFLOW_PORT=7090 ARCHFLOW_CONFIG=$S/iso/cfg ARCHFLOW_DATA=$S/iso/data PORT=5190 nohup npx vite --configLoader runner > $S/iso/vite.log 2>&1 &
```
Crie projeto e diagrama por `POST localhost:7090/api/projects/create` e `/api/diagrams {mode:"agents"}`. Ao terminar, encerre SÓ o que você subiu (PID pela porta: `lsof -tiTCP:5190 -sTCP:LISTEN`, idem 7090). No macOS não use `sed -i` sem `''`: edite com Python ou a ferramenta de edição. Confirme em `vite.config.ts` como o proxy `/api` encontra o bridge (porta) antes de testar a UI.

### 4. Registre e relate
Marque a tarefa em `docs/terminal-claude-plan.md` (`[x]` + 1–3 linhas) e responda:

```
TERMINAL LOOP #<n> — <T#: título>
Feito: <1–2 frases>
Arquivos: <lista curta>
Validação: tsc ok · testes <N>/<M> (novas falhas: nenhuma) · UI <conferida/não se aplica>
Pendências/riscos: <...>
Próxima tarefa: <T#: título> | Bloqueio: <qual>
```
