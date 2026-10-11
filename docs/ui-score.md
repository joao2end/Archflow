# UI Score — histórico

Notas 0–10, estimadas por leitura de código (sem screenshot) quando indicado. `?` = não medido.

| # | Data | Alvo | Antes | Depois | Global | Mudança | Referência |
|---|------|------|-------|--------|--------|---------|------------|
| 1 | 2026-10-11 | emptyhint (canvas vazio) | 5.0 | 6.0 | 6.0 | Texto próprio para o modo Logic (antes mostrava o de arquitetura); atalho G oculto em Logic; botões quebram linha em telas estreitas | Nielsen #2 (correspondência com o mundo real) e #10 (ajuda no contexto): empty state que ensina o 1º passo do modo atual |
| 2 | 2026-10-11 | emptyhint (modo Logic) | 6.0 | 6.7 | 6.7 | Botão "Ver exemplo pronto" carrega o exemplo de precificação no quadro vazio (Ctrl+Z desfaz) | Empty states que mostram o resultado final (Linear/Notion): o usuário aprende vendo algo pronto |

## Scores atuais por componente

| Componente | Clar | Desc | Feed | Hier | A11y | Cons | Inov | Média |
|---|---|---|---|---|---|---|---|---|
| emptyhint | 8 | 7 | 6 | 6 | 6 | 7 | 6 | 6.6 |

## Backlog (ordenado por impacto)
- [x] emptyhint: botão de exemplo no modo Logic (feito na iteração 2; só typecheck + testes, sem verificação visual)
- [ ] Ambiente de verificação: o app em /app conecta ao bridge/cofre real mesmo no sandbox (porta 5188 mostrou o mesmo quadro). Descobrir como isolar antes de testar estados vazios, para não tocar nos diagramas do usuário
- [ ] emptyhint: confirmar com screenshot (desktop/mobile, claro/escuro); medir contraste de `--ink-3` no `.empty-keys`
- [ ] Trocar de modo (architecture ↔ domain ↔ logic): avaliar clareza do seletor
- [ ] drawbar, Canvas, logic.tsx (play de cenários), export/files, colorpicker, landing: ainda não avaliados
