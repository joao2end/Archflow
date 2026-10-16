# Prompt de loop — Tools/MCP e catálogo de agentes (Archflow, modo agents)

Uso (ritmo dinâmico; cada iteração é uma tarefa do backlog):

```
/loop Siga as instruções de docs/AGENTS_TOOLS_LOOP_PROMPT.md, seção "PROMPT"
```

Ou com intervalo fixo: `/loop 20m Siga as instruções de docs/AGENTS_TOOLS_LOOP_PROMPT.md, seção "PROMPT"`.

---

## PROMPT

Você implementa, uma tarefa por vez, o backlog de `docs/mcp-agents-plan.md` (seção «Backlog do loop») do Archflow: componente **Tool** (nativa e MCP), catálogo de agentes e teste de servidor MCP. Cada execução é UMA tarefa: ler → implementar → validar → registrar → parar.

### 0. Estado (leia primeiro, nesta ordem)
1. `docs/mcp-agents-plan.md`: decisões, «Decisão tomada na implementação» e «Backlog do loop». A primeira tarefa `[ ]` do backlog é a sua. Não reabra decisões já fechadas; não faça mais de uma tarefa por iteração.
2. `git status --short`: há mudanças do usuário e de iterações anteriores no working tree (inclusive arquivos que você não criou). Não reverta, não faça `git stash`/`checkout`/`reset`, não formate arquivos que não são seus.
3. Se a tarefa depende de algo que não existe (ex.: bridge do usuário na versão antiga), registre o bloqueio no plano e passe à próxima tarefa que não dependa disso. Se nenhuma puder andar, PARE o loop e diga o que falta.

### 1. Antes de escrever código
- Leia os arquivos que vai tocar e os testes vizinhos. Siga o estilo existente (pt-BR nos textos, comentários curtos, nomes e idiomas do entorno).
- Fatos já estabelecidos (não redescubra):
  - Papel `tool` (`toolType: native|mcp`), relação `uses-tool` com `usage` e `allow`; `agentgen` gera `tools:`/`mcpServers`/`.mcp.json`; `harnesssync` faz merge por servidor; o gerador de harness sem nenhuma tool nativa OMITE `tools:`.
  - `looksLikeSecret` (agents.ts) é a regra única de segredo em texto puro; segredo vira `${VAR}`, nunca entra no diagrama.
  - Catálogo curado de MCP só aceita entradas conferidas na fonte (README oficial ou registro) com `homepage`; nunca invente nome de pacote.
  - A UI do diálogo da Tool segue o da Skill (`src/ui/mcpcatalog.tsx`, classes `skill-*`).

### 2. Implemente (uma tarefa, pequena e reversível)
- Lógica pura em `src/shared/*` com teste ao lado (`node:test`, `npx tsx --test <arquivo>`); I/O só em `server/*` com `fetch`/processos injetáveis para teste.
- UI em `src/ui/*`. Mudança no schema/ops/guia exige atualizar `schemaGuideAgents`, `describeAgents` e o schema Zod de `server/mcp.ts`.
- Segurança: nada que execute comando do usuário/catálogo sem `confirm` explícito vindo de um clique; o bridge só escuta loopback; nunca devolva valores de variáveis de ambiente; nunca grave segredo.

### 3. Valide
- `npx tsc --noEmit` limpo.
- `npm test`: sem NOVAS falhas. Falha conhecida e anterior: «exemplos: os arquivos em examples/ estão em dia» — não é sua, não a "conserte".
- UI visível → confira no navegador (Playwright) em instância isolada (seção «Ambiente»), com screenshot e console sem erros novos.
- Se não resolver rápido, desfaça SÓ a sua mudança (edição manual dos seus arquivos), registre o motivo no backlog e pare.

### Ambiente (instância isolada; o `npm run dev` do usuário NÃO é seu)
O bridge do usuário (porta 7077, Vite 5173) pode estar rodando código antigo ou nem estar de pé: não o reinicie, não o derrube, não use `pkill` por nome. Para testar:

```
S=<scratchpad da sessão>; mkdir -p $S/iso/{cfg,data,proj}
ARCHFLOW_PORT=7090 ARCHFLOW_CONFIG=$S/iso/cfg ARCHFLOW_DATA=$S/iso/data PORT=5190 nohup npx vite --configLoader runner > $S/iso/vite.log 2>&1 &
```
Crie projeto e diagrama por `POST localhost:7090/api/projects/create` e `/api/diagrams {mode:"agents"}`. Ao terminar, encerre SÓ o que você subiu, achando o PID pela porta (`lsof -tiTCP:5190 -sTCP:LISTEN`, idem 7090). Em macOS não use `sed -i` sem `''` — edite com Python ou com a ferramenta de edição. Editar um módulo compartilhado recarrega o Vite de teste e fecha diálogos abertos: refaça o passo.

### 4. Registre e relate
Marque a tarefa em `docs/mcp-agents-plan.md` (`[x]` + 1–3 linhas: o que foi feito, arquivos, testes, o que ficou de fora) e responda:

```
AGENTS/TOOLS LOOP #<n> — <T#: título>
Feito: <1–2 frases>
Arquivos: <lista curta>
Validação: tsc ok · testes <N>/<M> (novas falhas: nenhuma) · UI <conferida/não se aplica>
Pendências/riscos: <o que ficou de fora e por quê>
Próxima tarefa: <T#: título> | Bloqueio: <qual>
```

### Regras
- Sem commits, sem push, sem alterar o `package.json`/dependências, a menos que o usuário peça. Deixe tudo no working tree, no branch atual.
- Uma tarefa por iteração. Não "aproveite" para refatorar o que não é da tarefa.
- Não toque em `~/Projetos/FarmarcasLandingPage` exceto na tarefa T3, e só se o bridge do usuário estiver na versão nova.
- Não invente resultado: se não rodou o teste ou não abriu a UI, diga que não rodou.
- Ao concluir T8 (ou se todas as tarefas restantes estiverem bloqueadas), **pare o loop** (não rearme) e entregue o resumo final: o que existe, o que ficou fora, o que o usuário precisa fazer (reiniciar `npm run dev`, etc.).
