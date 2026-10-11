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
| 7 | 2026-10-11 | Canvas (parcial: a11y da raiz + contraste de todo o texto) | ? | ? | ? | ? | 8 | ? | ? | 8.0 |
| Ajuda (atalhos) | 7 | 8 | 6 | 8 | 7 | 7 | 7 | 7.1 |
| Landing (parcial: hero e nav mobile, desktop, contraste total, SEO) | 8 | 8 | ? | 8 | 9 | 8 | ? | 8.2 |
| ZoomBar | 8 | 7 | 8 | 7 | 8 | 7 | 7 | 7.4 |
| Inspetor | 7 | 7 | 7 | 7 | 8 | 7 | 7 | 7.1 |
| Dock (lateral) | 7 | 8 | 6 | 7 | 7 | 8 | 6 | 7.0 |
| Busca rápida | 8 | 8 | 8 | 7 | 8 | 7 | 7 | 7.6 |
| Toast | 7 | 7 | 9 | 8 | 8 | 7 | 7 | 7.6 |
| Present (barra) | 7 | 8 | 6 | 7 | 7 | 8 | 6 | 7.0 |
| Minimap | 7 | 7 | 7 | 7 | 7 | 7 | 7 | 7.0 |
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
| 29 | 2026-10-11 | Toast (bug de timer) | 7.6 | 7.8 | 7.3 | A mesma mensagem repetida (típico nas atualizações do agente MCP) era fechada cedo pelo timer da anterior; agora cada aviso só é fechado pelo próprio timer (contador). Também vi ao vivo o aviso real «Diagrama atualizado pelo agente (MCP) · Desfazer» quando o agente editou o quadro | Verificado ao vivo: 2ª mensagem visível aos 3,2 s (1º timer vence aos 2,6 s) e some aos 4,6 s |
| 30 | 2026-10-11 | ZoomBar | 6.9 | 7.5 | 7.3 | «−» desabilita em 15% e «+» em 300% (os limites reais de `zoomTo`); o botão da porcentagem agora anuncia o zoom atual («Zoom 35%. Redefinir para 100%») em vez de só a ação, com aria-keyshortcuts | Nielsen #1 (estado visível) e #5; verificado ao vivo nos três estados (15%, 300%, 35%) |
| 31 | 2026-10-11 | Letras de atalho (Dock, DrawBar, Present) | 6.6 (A11y) | 7.5 (A11y) | 7.3 | Contraste medido no navegador: a letra do atalho (9px, `--ink-3` a 75% de opacidade) dava ~3,1:1 no tema claro e 4,6:1 no escuro; sem a opacidade: 5,2:1 (claro) e 6,9:1 (escuro). Corrigi um defeito meu das iterações 5, 15 e 27 | WCAG 1.4.3; medido com fórmula de luminância relativa sobre cores computadas (fundo claro/escuro estimado) |
| — | 2026-10-11 | Canvas / handles de conexão (só medição) | | | | Alças «+» têm 26×26px e cursor crosshair nos 4 lados (OK para 2.5.8); nenhuma mudança | — |
| 32 | 2026-10-11 | Contraste do app (medição, sem mudança de código) | ? | 8.0 (A11y, parcial) | 7.3 | Varredura de contraste WCAG nos dois temas com o painel de Arquivos aberto: 37 textos visíveis em cada tema, 0 abaixo do AA (4,5:1; 3:1 para texto grande). Armadilha: com transições ativas o painel do navegador congela os estilos (um falso 2,38:1 no botão «Arquivo»); medir com `transition:none` | WCAG 1.4.3; script de varredura com fórmula de luminância e mistura de fundos translúcidos |
| 33 | 2026-10-11 | Campos de texto (placeholder) | 6.4 (A11y) | 7.9 (A11y) | 7.3 | Varredura de contraste com inspetor (16 textos) e Ajuda (53 textos): 0 falhas nos dois temas. Mas o `placeholder` não tinha regra própria e usava o cinza do navegador: 2,34:1 no escuro (reprova). Regra global `::placeholder { color: var(--ink-3); opacity: 1 }`: 4,99:1 (escuro) e 5,47:1 (claro) | WCAG 1.4.3; medido com `getComputedStyle(el, '::placeholder')` e transições desligadas |
| 34 | 2026-10-11 | Canvas (rótulos pequenos dos nós de lógica) | ? | 7.6 (A11y, parcial) | 7.3 | Texto dentro do SVG: os rótulos de 9–9,5px (REGRA, ENTÃO, DADOS, CENÁRIO…) usavam a cor pura do papel e davam 2,3–3,9:1. Agora `fill: color-mix(papel 55%, tinta do tema)`: mínimo 4,54:1 (escuro) e 5,16:1 (claro) em 47 rótulos, mantendo o matiz de cada papel | WCAG 1.4.3; duas rodadas de método: 1) ignorar a opacidade das camadas do nó dava ratio 1,0 (falso); 2) `getComputedStyle().fill` devolve `color(srgb 0–1)` e precisa ×255 |
| 35 | 2026-10-11 | Canvas (todo o texto do SVG) | 7.6 (A11y, parcial) | 8.2 (A11y) | 7.4 | Método melhor (compõe todos os retângulos atrás de cada texto, na ordem de desenho; 166 textos por tema): sobraram 3 falhas marginais (4,2–4,4:1): rótulo de grupo (claro), chaves em mono dos nós (escuro) e os 9px de ENTÃO/DADOS (escuro). Ajustes: grupo 80→66% cor; mono `--ink-3`→`--ink-2`; sec 55→45% cor. Resultado: 0 falhas, mínimo 4,54:1 (escuro) e 5,11:1 (claro) | WCAG 1.4.3; medido ao vivo em modo Lógica (doc do agente) |
| 36 | 2026-10-11 | Inspetor (estrutura) | 6.9 | 7.3 | 7.4 | O título do inspetor (nome do nó, grupo, nota ou «N elementos») era um `div` sem papel; agora `role="heading" aria-level=2` nos 5 pontos, para leitores de tela navegarem por títulos. O eco do nome no cabeçalho foi mantido: funciona como título, o campo «Nome» é o editor | WAI-ARIA heading; verificado ao vivo em nó e grupo (nível 2 com o texto certo) |
| 37 | 2026-10-11 | Landing (desktop, contraste) | 8.0 (A11y) | 8.3 (A11y) | 7.4 | Hierarquia do desktop avaliada (eyebrow verde, título serifado com destaque, parágrafo e cartões de comparação: forte). Varredura de contraste (388 textos por tema): causa raiz de 5 falhas no escuro: `a.btn` sem cor própria usava a cor de link do navegador (lilás #9e9eff: 3,9:1). `a.btn:not(.primary){color:var(--ink)}` → 9,4:1 (escuro) e 14,4:1 (claro); chip «MCP conectado» no escuro 3:1 → tinta | WCAG 1.4.3; medido com transições desligadas; o painel congela transições e as animações de revelar deixam o texto semi-transparente |
| 38 | 2026-10-11 | Landing (tema claro) | 8.3 (A11y) | 8.8 (A11y) | 7.5 | Causa raiz das ~8 falhas em 3:1 no claro: `--ok` (#14a38b) usado como cor de TEXTO (saídas «✓ 5», «Sim», etc.). Novo token `--ok-text` (#0b7a68 no claro; igual ao `--ok` no escuro) aplicado nos 6 usos de texto; `--ok` segue como fundo dos ícones. Varredura final: 372 textos por tema, 0 falhas | WCAG 1.4.3; elementos com opacidade <0,5 (animações de entrada) excluídos da varredura |
| 39 | 2026-10-11 | Landing (desempenho da seção Ferramentas) | ? | 7.6 (Feedback/Perf, parcial) | 7.5 | A seção tem 9 demos animadas (~3,5 mil px, 9 cartões de 522–601px). `content-visibility: auto` + `contain-intrinsic-block-size: auto 520px` nos cartões: o navegador pula layout e pintura dos que estão longe da vista e lembra o tamanho real depois de renderizar. Verificado ao vivo: com a página no topo os 9 ficam como estimativa; ao chegar perto, os 7 primeiros assumem a altura real (554–601px) e as demos aparecem; sem rolagem horizontal | web.dev content-visibility; o `contain-intrinsic-size` com um valor só vale para largura E altura (errei na 1ª versão), e o padding de 40px soma à estimativa |
| 40 | 2026-10-11 | Ajuda (atalhos) | 7.0 | 7.1 | 7.1 | Filtro «Filtrar atalhos…» com foco automático: casa descrição, tecla ou seção, sem acento nem maiúsculas; seções vazias somem; anuncia «N atalho(s) encontrado(s)»; aviso «Nenhum atalho com “x”» | Command palettes (VS Code, Raycast); verificado ao vivo («zoom» → 2, «ctrl+z» → 1, «aparencia» → seção Aparência com 3, termo inexistente → aviso) |
| 41 | 2026-10-11 | ModeSwitch → painel de Arquivos | 6.7 | 6.9 | 7.1 | Ao escolher outro modo, o aviso ganha o botão «Abrir o mais recente: {título}» (diagrama mais recente daquele modo): menos uma busca na lista | Atalhos de «continuar de onde parei» (Figma/Notion recentes); verificado ao vivo em Arquitetura e Domínio; o clique não foi testado (troca o arquivo ativo do agente MCP) |
| 42 | 2026-10-11 | ZoomBar (ajustar à seleção) | 7.3 | 7.4 | 7.2 | O botão de enquadrar vira «Ajustar à seleção» quando há algo selecionado (e `Shift+F` faz o mesmo; `F` continua enquadrando tudo); novo `fitSelection()` reaproveitando `fitView(only)`; Ajuda atualizada | Figma «zoom to selection» (Shift+2); verificado ao vivo: rótulo muda com a seleção, clicar enquadra o nó (zoom 0,75 → 1,1, nó inteiro na tela), vista restaurada |
| 43 | 2026-10-11 | Minimap (marcas de validação) | 6.7 | 7.0 | 7.2 | Em Domain/Logic, os nós com erro (vermelho) ou aviso (âmbar) aparecem marcados no minimapa, com mínimo de 4px e contagem no rótulo acessível: mostra ONDE olhar, não só onde a tela está. Novo teste (`flagged.test.ts`) garante que a validação do modo Logic devolve o id do nó em `target` | VS Code (marcas de erro na barra de rolagem); verificado ao vivo no sandbox isolado (cofre temporário): 78 nós, 0 marcas → após adicionar uma regra sem corpo, 1 marca vermelha e rótulo «1 componente com problema marcado» |
| 45 | 2026-10-11 | emptyhint (exemplos) | 7.0 | 7.4 | 7.2 | Verificado no sandbox isolado, com cliques reais: o exemplo carrega (Arquitetura: 8 nós/7 conexões; Lógica: 78 nós) e o «Desfazer» do aviso funciona (0 → 8 → 0 nós, a dica volta, «Refazer» disponível). **Bug achado e corrigido**: o exemplo carregava fora da tela (vista parada, zoom 15%); agora `fitView()` roda logo após carregar: Arquitetura fica com os 8 nós inteiros na tela (zoom 0,6); Lógica (6 mil px de altura) bate no zoom mínimo, 49 de 78 nós inteiros | Verificação com viewport real (1280×720); testes numa aba em segundo plano medem viewport 0×0 e dão resultados falsos |

## Scores atuais por componente

| Componente | Clar | Desc | Feed | Hier | A11y | Cons | Inov | Média |
|---|---|---|---|---|---|---|---|---|
| emptyhint | 8 | 8 | 7 | 6 | 6 | 8 | 7 | 7.1 |
| ModeSwitch | 8 | 6 | 8 | 7 | 7 | 6 | 6 | 6.9 |
| DrawBar | 7 | 8 | 6 | 7 | 7 | 7 | 6 | 6.9 |
| Logic PlayPanel | 7 | 8 | 8 | 8 | 7 | 8 | 7 | 7.6 |
| ColorPicker | 6 | 7 | 7 | 7 | 8 | 7 | 8 | 7.1 |
| Minimap | 7 | 7 | 6 | 7 | 7 | 7 | 6 | 6.7 |
| Files (árvore e filtro) | 7 | 8 | 7 | 7 | 8 | 7 | 6 | 7.1 |
| Ajuda (atalhos) | 7 | 8 | 6 | 8 | 7 | 7 | 6 | 7.0 |
| Toast | 7 | 7 | 9 | 8 | 8 | 7 | 7 | 7.6 |
| Busca rápida | 8 | 8 | 8 | 7 | 8 | 7 | 7 | 7.6 |
| Dock (lateral) | 7 | 8 | 6 | 7 | 7 | 8 | 6 | 7.0 |
| ZoomBar | 8 | 7 | 8 | 7 | 8 | 7 | 6 | 7.3 |
| Present (barra) | 7 | 8 | 6 | 7 | 7 | 8 | 6 | 7.0 |
| Inspetor | 7 | 7 | 7 | 7 | 8 | 7 | 7 | 7.1 |
| Canvas (parcial: A11y da raiz e contraste de todo o texto) | ? | ? | ? | ? | 8 | ? | ? | 8.0 |
| Landing (parcial: hero e nav mobile, desktop, contraste total, SEO) | 8 | 8 | ? | 8 | 9 | 8 | ? | 8.2 |

**Global (14 componentes completos): 7.18/10.** Média por eixo: Clar 7.21 · Desc 7.50 · Feed 7.14 · Hier 7.14 · A11y 7.36 · Cons 7.21 · Inov 6.71. Os parciais (Canvas, Landing) não entram na média. Nota: os «globais» reportados nas iterações 5–39 eram uma conta corrente aproximada e ficaram ~0,2 acima; esta tabela é a fonte (na iteração 40 achei que as linhas inseridas nas rodadas anteriores falharam em silêncio por usarem âncoras inexistentes; a tabela foi reconstruída).

## Backlog (ordenado por impacto)
- [x] emptyhint: botão de exemplo no modo Logic (feito na iteração 2; só typecheck + testes, sem verificação visual)
- [ ] Ambiente de verificação: o app em /app conecta ao bridge/cofre real mesmo no sandbox (porta 5188 mostrou o mesmo quadro). Descobrir como isolar antes de testar estados vazios, para não tocar nos diagramas do usuário
- [ ] emptyhint: confirmar com screenshot (desktop/mobile, claro/escuro); medir contraste de `--ink-3` no `.empty-keys`
- [x] ModeSwitch: explicar por que o painel abre (iteração 4; sem verificação visual)
- [x] ModeSwitch: atalho «Abrir o mais recente» (iteração 41)
- [ ] «Abrir o mais recente» (iteração 41): o clique ainda não foi testado (testar no sandbox: modeFilter lógico + abrir)
- [ ] ModeSwitch: oferecer "converter/copiar o quadro atual para este modo" em vez de só criar vazio → Inov +2
- [ ] ModeSwitch: valores de contraste calculados à mão, conferir com ferramenta; sem verificação visual
- [ ] DrawBar: swatches (radiogroup) sem setas; trocar de cor muda a ferramenta para caneta sem avisar → Feed +1, A11y +1
- [x] PlayPanel: ícones Glyph e dica de teclado (iteração 7)
- [ ] ColorPicker: sugerir cores já usadas no diagrama; checagem de contraste do texto sobre a cor
- [x] Files: roving tabindex (iteração 21)
- [ ] Files: ação de menu (Delete/Shift+F10) por teclado; testar com cofre de vários itens
- [ ] App em largura estreita (321px): DrawBar empilha na vertical e o cabeçalho trunca (marca/modos cortados) → decidir se o app suporta tablets/janelas pequenas
- [x] emptyhint: exemplo de Arquitetura verificado (iteração 45)
- [ ] emptyhint: Domain ainda só tem os exemplos de DDD (modal)
- [ ] emptyhint: correção do deslocamento ao lado do painel aberto não verificada visualmente (o agente MCP preencheu o quadro durante o teste)
- [x] Ajuda: busca (iteração 40)
- [ ] Ajuda: atalhos do modo Domain não têm seção própria
- [x] Landing mobile: menu hambúrguer (iteração 18)
- [x] Landing: contraste de 100% dos textos medidos (iteração 38)
- [x] Landing: seção «Ferramentas» com content-visibility (iteração 39). Conteúdo mantido: 9 demos legítimas. Falta medir ganho real de tempo de carga fora do painel do navegador (a emulação 1280px renderiza errado no painel; testar fora dele) e as seções abaixo do hero; sem og:image; sem avaliação visual (hierarquia, CTA, mobile); 10 títulos h1/h2 a revisar
- [ ] Toast: truque de teste: `import(<URL do store já carregada em performance.getEntriesByType(\"resource\")>)` dá a mesma instância; clicar em «Desfazer» não foi testado (altera o quadro); avisos de sucesso ainda sem ícone; fila de avisos simultâneos
- [ ] Busca rápida: filtro por modo (Arch/Domain/Logic) e ações além de abrir (ex.: criar na pasta atual)
- [ ] Ambiente: Ctrl+O não chega à página no painel do navegador (abrir o modal via store)
- [x] Ambiente de teste que altera o quadro: `vite-sandbox` (porta 5188) usa cofre temporário (`AppData\Local\Temprchflow-sandbox-*`) e é isolado do cofre real e do agente MCP; a suspeita das iterações 2–5 de que ele mostrava o quadro real estava errada (era o mesmo `/app` na porta normal). Usar para testar Desfazer, estados vazios, trocar de arquivo e injetar erros de validação
- [ ] PlayPanel: com inspetor E arquivos abertos em telas <1100px a área livre fica menor que o mínimo (360px) e ainda sobrepõe; desligar o inspetor ou empilhar
- [x] Inspetor: nomes acessíveis (checado) e títulos como heading (iteração 36)
- [ ] Contraste nos modos Arquitetura e Domínio: precisa de um diagrama desses modos aberto; trocar o arquivo ativo mexe na sessão do agente MCP, então adiar até haver um quadro livre
- [x] Contraste do app (iterações 32-33: painel de Arquivos, inspetor e Ajuda sem falhas; placeholders corrigidos); falta medir texto dentro do SVG do canvas e demais modais
- [x] Contraste de todo o texto do canvas (iteração 35, 166 textos, 0 falhas); falta repetir nos modos Arquitetura e Domínio
- [ ] Método de medição: converter `color(srgb …)` ×255 e somar fill-opacity × opacity das camadas; desligar transições antes de ler cores computadas (painel oculto congela estilos)
- [ ] Canvas (1760 linhas): hierarquia, feedback de drag/conexão, zoom e estados; nós têm role=button mas sem tabIndex (só setas no quadro)
- [ ] logic.tsx (play de cenários), export/files, colorpicker, landing: ainda não avaliados
