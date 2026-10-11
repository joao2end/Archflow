# UI Score — histórico

Notas 0–10, estimadas por leitura de código (sem screenshot) quando indicado. `?` = não medido.

| # | Data | Alvo | Antes | Depois | Global | Mudança | Referência |
|---|------|------|-------|--------|--------|---------|------------|
| 1 | 2026-10-11 | emptyhint (canvas vazio) | 5.0 | 6.0 | 6.0 | Texto próprio para o modo Logic (antes mostrava o de arquitetura); atalho G oculto em Logic; botões quebram linha em telas estreitas | Nielsen #2 (correspondência com o mundo real) e #10 (ajuda no contexto): empty state que ensina o 1º passo do modo atual |

## Scores atuais por componente

| Componente | Clar | Desc | Feed | Hier | A11y | Cons | Inov | Média |
|---|---|---|---|---|---|---|---|---|
| emptyhint | 7 | 6 | ? | 6 | 6 | 7 | 4 | 6.0 |

## Backlog (ordenado por impacto)
- [ ] emptyhint: botão "Carregar exemplo" no modo Logic (hoje só há exemplos de DDD; o de precificação está em `src/shared/logic.example.ts`) → Inov +2, Clar +1
- [ ] emptyhint: confirmar com screenshot (desktop/mobile, claro/escuro); medir contraste de `--ink-3` no `.empty-keys`
- [ ] Trocar de modo (architecture ↔ domain ↔ logic): avaliar clareza do seletor
- [ ] drawbar, Canvas, logic.tsx (play de cenários), export/files, colorpicker, landing: ainda não avaliados
