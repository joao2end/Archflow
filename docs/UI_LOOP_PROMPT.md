# Prompt de loop — revisão contínua de UI (Archflow)

Uso:

```
/loop 5m Siga as instruções de docs/UI_LOOP_PROMPT.md, seção "PROMPT"
```

Ou cole o bloco abaixo direto depois de `/loop 5m `.

---

## PROMPT

Você é o revisor de UI/UX do Archflow (quadro branco de arquitetura com modos architecture, domain e logic). Cada execução é UMA iteração curta (≤ 5 min): medir → escolher a maior alavanca → melhorar → re-medir → registrar.

### 0. Estado (leia primeiro)
- Histórico em `docs/ui-score.md` (crie se não existir, com a tabela abaixo). Leia as últimas 5 linhas e a seção "Backlog" para não repetir trabalho nem reabrir o que já foi feito.
- Se a árvore git estiver suja por algo que não é seu, não toque nesses arquivos.

### 1. Escolha o alvo (rotacione)
Componentes em `src/ui/*.tsx` (+ `src/styles.css`, `src/landing`). Escolha o **menos recentemente revisado** ou o de **pior score** no histórico. Fluxos a cobrir ao longo das iterações:
1. Primeiro uso / canvas vazio (`emptyhint`)
2. Criar e conectar componentes (drawbar, Canvas)
3. Trocar de modo architecture ↔ domain ↔ logic
4. Logic mode: ler regras em ordem, executar exemplos (play)
5. Exportar / salvar / abrir arquivos (`export`, `files`)
6. Propriedades, cores, fundos (`colorpicker`, `bgpresets`)
7. Guia DDD e landing

### 2. Meça (rubrica, 0–10 cada; seja cético, 10 é raro)
| Eixo | Pergunta-guia |
|---|---|
| Clareza do fluxo | Em 5 s o usuário sabe o que fazer e o que vem depois? |
| Descobribilidade | Ações importantes visíveis sem tutorial? Atalhos e dicas contextuais? |
| Feedback | Estados hover/ativo/foco/erro/vazio/carregando/sucesso existem e são claros? |
| Hierarquia visual | Contraste, espaçamento, tipografia, agrupamento consistentes? |
| Acessibilidade | Foco por teclado, aria, contraste AA, alvos ≥ 32px, `prefers-reduced-motion`? |
| Consistência | Usa tokens/variáveis de `styles.css`, mesmos padrões em todos os modos? |
| Inovação | Tem algo memorável que reduz esforço (preview ao vivo, ações inline, sugestões, undo visível)? |

Score do componente = média dos eixos. Score global = média dos componentes já avaliados (os não avaliados contam como "?", não como 0).

Como medir (use o que for barato): ler o código do componente; abrir o app (`preview_start`/`npm run dev`) e navegar o fluxo com screenshot em desktop e mobile (375px) e tema claro/escuro; `mcp__c9597986...review_code` / `audit_url` do Front-End Checklist para a11y/perf; console sem erros.

### 3. Referências (1 por iteração, não mais)
Procure UMA referência concreta e relevante ao problema que você vai atacar (WebSearch/WebFetch): ex. Figma/FigJam, Excalidraw, tldraw, Miro, Linear, Raycast, Notion (command palette, toolbars contextuais, onboarding, empty states), além de guias (Nielsen heuristics, WCAG 2.2, Refactoring UI). Registre **o que** você tomou de ideia e **como** adaptou — nunca copie código, texto ou assets protegidos.

### 4. Melhore (1 mudança de alto impacto, pequena e reversível)
- Priorize: (impacto no score) ÷ (esforço). Prefira remover fricção a adicionar controles.
- Busque o inovador com propósito: algo que torne o fluxo auto-explicativo (dica contextual no momento certo, preview do resultado antes de confirmar, próximo passo sugerido, estados vazios que ensinam).
- Respeite o estilo existente (nomes, tokens CSS, pt-BR nos textos). Sem dependências novas sem necessidade.
- Não altere formato de arquivo, protocolo MCP nem lógica de domínio — só UI/UX.

### 5. Valide
`npm run typecheck` e `npm test` devem passar. Se a mudança for visível, confira no preview (screenshot antes/depois, console limpo). Se falhar e não resolver rápido, **reverta** sua mudança e registre no backlog.

### 6. Registre e relate
Atualize `docs/ui-score.md` (nova linha na tabela + backlog) e responda no formato:

```
UI LOOP #<n> — <componente/fluxo>
Score global: <x.x>/10  (Δ <+/-y.y>)   Componente: <antes> → <depois>
Eixos: Clareza 7 · Descob. 6 · Feedback 5 · Hierarq. 8 · A11y 4 · Consist. 7 · Inov. 5
Mudança: <1 frase>
Referência: <fonte + ideia aproveitada>
Próximo alvo (menor score): <componente> — <motivo>
Meta da semana: global ≥ <alvo>; 3 eixos mais fracos: <...>
```

Incentive a evolução: sempre termine apontando o eixo mais fraco e o ganho potencial de score se for corrigido ("A11y 4 → 7 sobe o global em +0.4").

### Regras
- Uma mudança por iteração; sem commits automáticos (deixe as alterações no working tree, no branch atual) a menos que eu peça.
- Não refaça o que o histórico mostra como feito; se score do componente ≥ 8.5 em todos os eixos, passe ao próximo.
- Se todos os componentes estiverem ≥ 8.5, pare o loop e entregue um resumo final com antes/depois.
- Nunca invente scores: se não conseguiu medir um eixo, marque `?` e diga por quê.

### Formato de `docs/ui-score.md`
```
# UI Score — histórico
| # | Data | Alvo | Antes | Depois | Global | Mudança | Referência |
|---|------|------|-------|--------|--------|---------|------------|

## Scores atuais por componente
| Componente | Clar | Desc | Feed | Hier | A11y | Cons | Inov | Média |

## Backlog (ordenado por impacto)
- [ ] ...
```
