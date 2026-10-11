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
| 7 | 2026-10-11 | Canvas (parcial: só a11y da raiz; resto não medido) | ? | ? | ? | ? | 7 | ? | ? | 7.0 |
| Ajuda (atalhos) | 7 | 8 | 6 | 8 | 7 | 7 | 6 | 7.0 |
| Landing (parcial: hero e nav mobile, tema claro, a11y/SEO) | 8 | 8 | ? | 8 | 8 | 8 | ? | 8.0 |
| Dock (lateral) | 7 | 8 | 6 | 7 | 7 | 8 | 6 | 7.0 |
| Busca rápida | 8 | 8 | 8 | 7 | 8 | 7 | 7 | 7.6 |
| Toast | 7 | 7 | 9 | 8 | 8 | 7 | 7 | 7.6 |
| Present (barra) | 7 | 8 | 6 | 7 | 7 | 8 | 6 | 7.0 |
| Minimap | 7 | 7 | 6 | 7 | 7 | 7 | 6 | 6.7 |
| Files (árvore e filtro) | 7 | 8 | 7 | 7 | 8 | 7 | 6 | 7.1 |
| ColorPicker | 6 | 7 | 7 | 7 | 8 | 7 | 8 | 7.1 |
| Logic PlayPanel | 7.0 | 7.4 | 7.0 | Ícones Unicode (⏮ ◀ ▶ ⏸ ×) trocados por Glyph SVG (4 novos: step-back/fwd, skip-start/end); dica "← → passo a passo" visível | Consistência com o resto do app; Nielsen #6 (reconhecer em vez de lembrar) |
| 8 | 2026-10-11 | Canvas (raiz SVG) | ? | 7.2 | 7.0 | aria-label do quadro segue o modo (antes dizia "arquitetura" em Domain/Logic); prefers-reduced-motion cobre barra/play/ferramentas | WCAG 2.2 (4.1.2, 2.3.3) |
| 9 | 2026-10-11 | ColorPicker | 5.6 | 6.9 | 7.0 | Área de cor e matiz operáveis por teclado (role=slider, setas, Shift = passo grande), foco entra na área ao abrir, aria-valuetext legível | WAI-ARIA APG slider; WCAG 2.1.1 |
| — | 2026-10-11 | Canvas / play (fora do loop) | | | | Sombra do botão play em SVG em vez de CSS drop-shadow (artefato elíptico relatado) | — |
| 10 | 2026-10-11 | Files (árvore de diagramas) | 5.9 | 6.8 | 7.0 | Árvore navegável por teclado: ↑↓ Home End, →/← abrem e fecham pasta, Espaço abre arquivo; aria-label na árvore | WAI-ARIA APG tree view; VS Code explorer |
| 11 | 2026-10-11 | ColorPicker | 6.7 | 7.3 | 7.0 | Cores recentes (até 8, localStorage com fallback silencioso); foco inicial na área de cor corrigido (visibility:hidden impedia) | Figma/Excalidraw: cores recentes; verificado no navegador (chips + foco) |
| 12 | 2026-10-11 | Minimap | 5.7 | 6.9 | 7.0 | Setas movem a vista com o foco no minimapa (20%, Shift 60%), cursor grab/grabbing, foco visível, pointercancel, role group em vez de img | WAI-ARIA APG; mapas do Figma/Google Maps; verificado no navegador (204px = 20% de 1024) |
| 13 | 2026-10-11 | Ajuda (atalhos) + emptyhint | 5.5 | 7.0 | 7.1 | Atalhos agrupados por tarefa (Montar, Editar, Navegar, Desenhar, Aparência, Apresentar) com seção "Modo Lógica" primeiro quando aplicável; chips de tecla sem quebra; dica do quadro vazio sai de baixo do painel lateral aberto | Nielsen #6/#10; agrupamento de atalhos do VS Code/Figma; Ajuda verificada no navegador |
| 14 | 2026-10-11 | emptyhint (modo Arquitetura) | 6.6 | 7.4 | 7.2 | "Ver exemplo pronto" também em Arquitetura: loja online com 8 componentes e 7 conexões (síncrona, dados, assíncrona), gerada por ops e coberta por teste; texto da dica explica o motivo | Linear/Notion: empty state com conteúdo de exemplo; mesmo padrão do modo Lógica |
| 15 | 2026-10-11 | Present (barra de apresentação) | 6.4 | 6.9 | 7.0 | Letra do atalho no canto de cada ferramenta + aria-keyshortcuts (mesmo padrão da DrawBar); verificado no navegador | Consistência com a DrawBar; Excalidraw/Figma |
| 16 | 2026-10-11 | Landing + index.html | ? | 7.0 (parcial) | 7.0 | Foco visível em links/botões da landing; meta description e Open Graph (título, descrição, url) | WCAG 2.4.7 (foco visível); boas práticas de compartilhamento; lido por código, não visto no navegador |
| 17 | 2026-10-11 | Landing (hero, celular 375px) | ? | 7.2 (parcial) | 7.0 | Botões do hero empilham com a mesma largura no celular; verificado no navegador: sem rolagem horizontal, nav cabe em 375px | Refactoring UI (CTA primário vs secundário); verificado ao vivo |
| 18 | 2026-10-11 | Landing (navegação no celular) | 7.2 | 7.9 | 7.1 | Menu hambúrguer ≤960px com links de seção, aria-expanded/aria-controls, Esc e clique no link fecham; botão de download da barra some ≤560px (o hero já tem); novo glifo `menu`; verificado a 375px (mesma linha, link rola até Guia) | Padrão de menu disclosure (WAI-ARIA APG); verificado ao vivo |
| 19 | 2026-10-11 | Landing (barra, telas ≤360px, tema claro) | 7.9 | 8.1 | 7.1 | A 321px o botão do menu quebrava de linha: gaps, padding, botões de ícone (32px) e marca (22px) ajustados ≤360px; barra de 54px numa linha; tema claro conferido (hero legível, CTA primário claro) | Verificado ao vivo em 321px (largura real do painel) |
| 20 | 2026-10-11 | Landing (seção Ferramentas, código de exemplo, 321px) | 7.9 | 8.2 | 7.1 | Varredura de overflow em todas as seções a 321px achou só 1 problema: o bloco de código gerado era cortado (overflow hidden); agora rola na horizontal (305px de conteúdo em 200px) e é focável por teclado com rótulo | Verificado ao vivo: página sem rolagem horizontal (321px); WCAG 2.1.1 (região rolável alcançável) |
| 21 | 2026-10-11 | Files (árvore) | 6.8 | 7.3 | 7.1 | Roving tabindex: um único tab stop na árvore (item com foco, o aberto ou o primeiro), setas percorrem o resto; efeito reaplica após cada render e onFocus atualiza | WAI-ARIA APG tree view; verificado ao vivo só com 1 item no cofre (1 tab stop), a ramificação -1 não foi exercitada |
| 22 | 2026-10-11 | Toast (avisos do app) | 5.6 | 7.0 | 7.1 | Botão «Desfazer» nos avisos que mudam o quadro (exemplo carregado, atualização do agente MCP) com 7 s em vez de 2,6 s; região viva `role=status` sempre montada (antes montava junto com o aviso e leitores de tela podiam não anunciar) | Material/Gmail: ação «Desfazer» no snackbar; WAI-ARIA live regions; verificado ao vivo só o aviso comum (dentro da região viva, sem botão) |
| 23 | 2026-10-11 | Toast (severidade) | 7.1 | 7.7 | 7.2 | `toastError()`: aviso de erro com contorno vermelho + ícone de alerta, role=alert/aria-live=assertive, 6 s; aplicado em 8 falhas reais (importar, imagem, copiar, armazenamento, ops do canvas, MCP, exemplo). Também fechou a verificação da iteração 22: o botão «Desfazer» aparece e o aviso comum fica em role=status | Gmail/Material (erro distinto de info); WAI-ARIA alert; verificado ao vivo (importando o store pela URL já carregada) |
| 24 | 2026-10-11 | Busca rápida (Ctrl+O) | 6.0 | 7.1 | 7.2 | Padrão combobox completo: role=combobox, aria-expanded/controls/activedescendant, opções com id e tabindex=-1, região viva com a contagem ("41 resultados"/"Nenhum resultado"), classe .sr-only | WAI-ARIA APG combobox (list autocomplete); verificado ao vivo (41 resultados, activedescendant aponta para opção existente) |
| 25 | 2026-10-11 | Busca rápida | 7.1 | 7.7 | 7.2 | Destaque do trecho encontrado em título e caminho (`<mark>`, regex escapada) e legenda «Mais recentes» quando o campo está vazio (a ordenação por data já existia, só não era dita) | Raycast/VS Code quick open; verificado ao vivo (40 recentes sem marca; «arq» marca 4 trechos, 3 resultados) |
| 26 | 2026-10-11 | Logic PlayPanel (layout) | 7.4 | 7.7 | 7.3 | Com Arquivos/biblioteca aberto, o painel de reprodução invadia o de Arquivos em 51px (medido a 1482×960: play 361–1121 × arquivos 82–412); agora ocupa só a área livre entre os painéis (445–1127; inspetor começa em ~1142) | Medição com getBoundingClientRect; verificado ao vivo iniciando uma reprodução pelo store (estado restaurado depois) |
| 27 | 2026-10-11 | Dock (barra lateral de ferramentas) | 6.3 | 7.0 | 7.3 | Letra do atalho no canto dos 8 botões (E B H G C N L A) + aria-keyshortcuts, igual à DrawBar e à barra de apresentação; verificado ao vivo (8 badges, 44px) | Consistência entre as três barras; Figma/Excalidraw |
| 28 | 2026-10-11 | Files (filtro) | 7.0 | 7.5 | 7.4 | O filtro respeitava o modo aberto e escondia achados de outros modos sem aviso ("Nada encontrado" mesmo existindo o arquivo). Agora lista à parte «Em outros modos (N)» e, se o modo atual não tiver nada, diz «Nada de {modo} com “texto”» | Nielsen #1 (visibilidade do estado) e #9 (ajudar a se recuperar); verificado ao vivo («arq» no modo Arch: 2 resultados + 1 em outros modos) |

## Scores atuais por componente

| Componente | Clar | Desc | Feed | Hier | A11y | Cons | Inov | Média |
|---|---|---|---|---|---|---|---|---|
| emptyhint | 8 | 8 | 6 | 6 | 6 | 8 | 7 | 7.0 |
| ModeSwitch | 8 | 6 | 8 | 7 | 7 | 6 | 5 | 6.7 |
| DrawBar | 7 | 8 | 6 | 7 | 7 | 7 | 6 | 6.9 |
| Canvas (parcial: só a11y da raiz; resto não medido) | ? | ? | ? | ? | 7 | ? | ? | 7.0 |
| Logic PlayPanel | 7 | 8 | 8 | 8 | 7 | 8 | 7 | 7.6 |

## Backlog (ordenado por impacto)
- [x] emptyhint: botão de exemplo no modo Logic (feito na iteração 2; só typecheck + testes, sem verificação visual)
- [ ] Ambiente de verificação: o app em /app conecta ao bridge/cofre real mesmo no sandbox (porta 5188 mostrou o mesmo quadro). Descobrir como isolar antes de testar estados vazios, para não tocar nos diagramas do usuário
- [ ] emptyhint: confirmar com screenshot (desktop/mobile, claro/escuro); medir contraste de `--ink-3` no `.empty-keys`
- [x] ModeSwitch: explicar por que o painel abre (iteração 4; sem verificação visual)
- [ ] ModeSwitch: oferecer "converter/copiar o quadro atual para este modo" em vez de só criar vazio → Inov +2
- [ ] ModeSwitch: valores de contraste calculados à mão, conferir com ferramenta; sem verificação visual
- [ ] DrawBar: swatches (radiogroup) sem setas; trocar de cor muda a ferramenta para caneta sem avisar → Feed +1, A11y +1
- [x] PlayPanel: ícones Glyph e dica de teclado (iteração 7)
- [ ] ColorPicker: sugerir cores já usadas no diagrama; checagem de contraste do texto sobre a cor
- [x] Files: roving tabindex (iteração 21)
- [ ] Files: ação de menu (Delete/Shift+F10) por teclado; testar com cofre de vários itens
- [ ] App em largura estreita (321px): DrawBar empilha na vertical e o cabeçalho trunca (marca/modos cortados) → decidir se o app suporta tablets/janelas pequenas
- [ ] emptyhint: botão de exemplo do modo Arquitetura não verificado no navegador (quadro estava ocupado pelo agente MCP); Domain ainda só tem os exemplos de DDD (modal)
- [ ] emptyhint: correção do deslocamento ao lado do painel aberto não verificada visualmente (o agente MCP preencheu o quadro durante o teste)
- [ ] Ajuda: sem busca; atalhos do modo Domain não têm seção própria
- [x] Landing mobile: menu hambúrguer (iteração 18)
- [ ] Landing: seções abaixo do hero sem overflow a 321px (varredura feita); falta avaliar hierarquia visual e densidade delas, e o desktop largo (a emulação 1280px renderiza errado no painel; testar fora dele) e as seções abaixo do hero; sem og:image; sem avaliação visual (hierarquia, CTA, mobile); 10 títulos h1/h2 a revisar
- [ ] Toast: truque de teste: `import(<URL do store já carregada em performance.getEntriesByType(\"resource\")>)` dá a mesma instância; clicar em «Desfazer» não foi testado (altera o quadro); avisos de sucesso ainda sem ícone; fila de avisos simultâneos
- [ ] Busca rápida: filtro por modo (Arch/Domain/Logic) e ações além de abrir (ex.: criar na pasta atual)
- [ ] Ambiente: Ctrl+O não chega à página no painel do navegador (abrir o modal via store)
- [ ] PlayPanel: com inspetor E arquivos abertos em telas <1100px a área livre fica menor que o mínimo (360px) e ainda sobrepõe; desligar o inspetor ou empilhar
- [ ] Canvas (1760 linhas): hierarquia, feedback de drag/conexão, zoom e estados; nós têm role=button mas sem tabIndex (só setas no quadro)
- [ ] logic.tsx (play de cenários), export/files, colorpicker, landing: ainda não avaliados
