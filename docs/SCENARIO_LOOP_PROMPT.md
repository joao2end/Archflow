# Prompt de loop — cenário: criação e tela de reprodução (Archflow)

Uso (a cada 10 min):

```
/loop 10m Siga docs/SCENARIO_LOOP_PROMPT.md, seção "PROMPT"
```

## PROMPT

Você melhora DUAS coisas do modo Logic, uma por iteração (≤ 8 min): **(A) como um cenário é criado** e **(B) onde/como a tela de reprodução do cenário aparece** (`PlayPanel` em `src/ui/logic.tsx`, CSS `.logic-play-panel` em `src/styles.css`, câmera no `useEffect` do painel). Regra de ouro: **simples, direto, fácil de entender**. Menos campos, menos cliques, textos curtos em pt-BR.

### 1. Meça (JEV)
- `npm run eval:scenario` (script `scripts/eval-scenario.ts`): Executor lista atritos de criação/leitura/posição, Verificador roda os exemplos, Juiz dá a facilidade 0–10 e o esforço médio (campos digitados por cenário). Rode também `npm run eval:jev` e `npm run typecheck`.
- Estado em `docs/scenario-score.md` (crie se faltar: tabela `# | Data | Frente | Facilidade antes→depois | Esforço | Mudança | Backlog`). Leia as últimas 5 linhas antes de escolher, para não repetir.
- Para (B), abra o app (`preview_start` "vite"), carregue `examples/exemplos-logic/precificacao.archflow.json`, toque um cenário e confira em desktop (1280), 800px e 375px, com e sem painel lateral e em apresentação (F5/Present): o painel cobre o passo atual? A câmera centraliza o passo acima do painel (hoje fixa em 36% da altura, sem considerar a altura real do painel)? Sobrepõe a barra de zoom/minimapa/dock? Cabe sem rolagem horizontal?

### 2. Procure inconsistências (visuais e lógicas)
- Visuais: `.logic-play-panel` definido em vários blocos do CSS com valores conflitantes (width/height/max-height repetidos); `present` vs `beside-panel`; textos que quebram; foco/contraste.
- Lógicas: cenário criado vazio; entradas que o hint sugere mas o exemplo não preenche; `Usar como esperado` desabilitado sem motivo; caminho gravado desatualizado; velocidade/estado de `play` que sobra ao trocar de diagrama ou modo; botão ▶ do cartão sem exemplo.
- Cada achado vai para o backlog em `docs/scenario-score.md` com severidade.

### 3. Melhore (UMA mudança pequena e reversível)
Prioridade: (impacto ÷ esforço). Ideias já mapeadas:
- (A) Criar cenário em um passo: ao soltar/adicionar um Cenário, já nasce com 1 exemplo pré-preenchido com as entradas do fluxo (`ins` do hint de `ExamplesEditor`, com valores de exemplo/padrão), nome sugerido e botão «Rodar e usar o resultado como esperado» — o usuário só ajusta números. Botão «Duplicar exemplo». Cenário de falha em 1 clique quando há fim com erro.
- (B) Posicionar o painel sem cobrir o passo atual: calcular a câmera pela área livre acima do painel (altura real via `getBoundingClientRect`), em vez de 36% fixo; painel recolhível (só barra de controles) para ver o desenho inteiro; no celular, painel como folha inferior ocupando ≤ 45% da altura.
- Consolidar as regras duplicadas de `.logic-play-panel` num único bloco.

Respeite estilo, tokens CSS e pt-BR. Não altere formato de arquivo nem protocolo MCP. Sem dependência nova.

### 4. Valide e registre
`npm run typecheck`, `npm test`, `npm run eval:scenario` (a facilidade não pode cair) e, se for visual, screenshot no preview (console limpo). Se falhar e não resolver rápido, reverta só o que você mudou. Atualize `docs/scenario-score.md` e responda:

```
CENÁRIO LOOP #<n> — <criação | tela de reprodução>
Facilidade: <antes> → <depois> · esforço médio: <x> campos
Mudança: <1 frase>
Inconsistências achadas: <n> (visuais <a>, lógicas <b>) — maior: <...>
Próximo alvo: <...>
```

### Regras
- Uma mudança por iteração; sem commit a menos que o usuário peça. A árvore já tem mudanças de outras pessoas: não toque no que não é seu.
- Não invente notas; se não mediu, escreva `?` e diga por quê.
- Pare o loop (e entregue resumo antes/depois) quando `eval:scenario` estiver ≥ 8 em todos os diagramas e o backlog de severidade alta zerado.
