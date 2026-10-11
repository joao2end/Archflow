# UI Score — histórico

Notas 0–10, estimadas por leitura de código (sem screenshot) quando indicado. `?` = não medido.

| # | Data | Alvo | Antes | Depois | Global | Mudança | Referência |
|---|------|------|-------|--------|--------|---------|------------|
| 1 | 2026-10-11 | emptyhint (canvas vazio) | 5.0 | 6.0 | 6.0 | Texto próprio para o modo Logic (antes mostrava o de arquitetura); atalho G oculto em Logic; botões quebram linha em telas estreitas | Nielsen #2 (correspondência com o mundo real) e #10 (ajuda no contexto): empty state que ensina o 1º passo do modo atual |
| 2 | 2026-10-11 | emptyhint (modo Logic) | 6.0 | 6.7 | 6.7 | Botão "Ver exemplo pronto" carrega o exemplo de precificação no quadro vazio (Ctrl+Z desfaz) | Empty states que mostram o resultado final (Linear/Notion): o usuário aprende vendo algo pronto |
| 3 | 2026-10-11 | ModeSwitch (Arch/Domain/Logic) | 5.4 | 6.3 | 6.5 | Contraste AA nos pills ativos (Domain 3,6→5:1, Logic 3,9→5:1, Arch escuro 3,1→5,7:1), altura 24→28px, foco visível, setas movem o foco (roving tabindex) | WAI-ARIA APG radiogroup; WCAG 2.2 1.4.3 e 2.5.8 |
| 4 | 2026-10-11 | ModeSwitch → painel Arquivos | 6.3 | 6.8 | 6.8 | Aviso "Mostrando diagramas de X; o aberto é de Y e não foi alterado" quando o seletor difere do diagrama aberto | Nielsen #1 (visibilidade do estado do sistema) e #5 (prevenção de erro) |
| 5 | 2026-10-11 | DrawBar (ferramentas de desenho) | 6.3 | 7.0 | 6.9 | Letra do atalho visível no canto de cada ferramenta + aria-keyshortcuts; swatches 22→24px | Excalidraw/Figma: atalho no botão; WCAG 2.5.8 |
| 6 | 2026-10-11 | Logic PlayPanel (reprodução de cenário) | 5.9 | 6.9 | 6.9 | ←/→ passam os passos (sem mover o nó selecionado), lista de passos navegável por teclado, progressbar e aria-live no passo atual, linha ativa rola para a vista | WAI-ARIA APG (progressbar, live region); players de vídeo/debuggers (step com setas) |
| 7 | 2026-10-11 | Logic PlayPanel | 7.0 | 7.4 | 7.0 | Ícones Unicode (⏮ ◀ ▶ ⏸ ×) trocados por Glyph SVG (4 novos: step-back/fwd, skip-start/end); dica "← → passo a passo" visível | Consistência com o resto do app; Nielsen #6 (reconhecer em vez de lembrar) |

## Scores atuais por componente

| Componente | Clar | Desc | Feed | Hier | A11y | Cons | Inov | Média |
|---|---|---|---|---|---|---|---|---|
| emptyhint | 8 | 7 | 6 | 6 | 6 | 7 | 6 | 6.6 |
| ModeSwitch | 8 | 6 | 8 | 7 | 7 | 6 | 5 | 6.7 |
| DrawBar | 7 | 8 | 6 | 7 | 7 | 7 | 6 | 6.9 |
| Logic PlayPanel | 7 | 8 | 8 | 7 | 7 | 8 | 7 | 7.4 |

## Backlog (ordenado por impacto)
- [x] emptyhint: botão de exemplo no modo Logic (feito na iteração 2; só typecheck + testes, sem verificação visual)
- [ ] Ambiente de verificação: o app em /app conecta ao bridge/cofre real mesmo no sandbox (porta 5188 mostrou o mesmo quadro). Descobrir como isolar antes de testar estados vazios, para não tocar nos diagramas do usuário
- [ ] emptyhint: confirmar com screenshot (desktop/mobile, claro/escuro); medir contraste de `--ink-3` no `.empty-keys`
- [x] ModeSwitch: explicar por que o painel abre (iteração 4; sem verificação visual)
- [ ] ModeSwitch: oferecer "converter/copiar o quadro atual para este modo" em vez de só criar vazio → Inov +2
- [ ] ModeSwitch: valores de contraste calculados à mão, conferir com ferramenta; sem verificação visual
- [ ] DrawBar: swatches (radiogroup) sem setas; trocar de cor muda a ferramenta para caneta sem avisar → Feed +1, A11y +1
- [x] PlayPanel: ícones Glyph e dica de teclado (iteração 7)
- [ ] Canvas, logic.tsx (play de cenários), export/files, colorpicker, landing: ainda não avaliados
