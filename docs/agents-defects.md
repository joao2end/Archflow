# Modo agents — defeitos e pontos desatualizados

Registro do loop (`docs/AGENTS_E2E_LOOP_PROMPT.md`). Cada item: sintoma, onde, severidade, situação.

## Abertos

| ID | Tipo | Onde | Descrição | Severidade | Situação |
|---|---|---|---|---|---|
| D-01 | Desatualizado | `docs/agents-mode-plan.md`, Fase 8 | Lista «testes (agents.test.ts, agentgen.test.ts, zip.test.ts, golden, e2e)» como pendente. Os unitários existem e passam (121 nos arquivos de agents); só o E2E falta. | baixa | fechado: fase 8 marcada como feita, com a matriz de cenários |
| D-02 | Desatualizado | `docs/agents-mode-plan.md`, «Instrução para o próximo tick» | Cita o mecanismo de loop antigo (`AGENT_LOOP_WAKE_agents_mode`, `notify_on_output`). Hoje o loop é `ScheduleWakeup`. | baixa | fechado: seção de instrução reescrita para o loop atual |
| D-03 | Incompleto | Fase 7: `import_harness` | Manifesto e drift já existiam (`server/harnesssync.ts`, 11 testes). Faltava a volta do harness para o diagrama: agora `src/shared/agentimport.ts` (`harnessToOps`, 7 testes). Ligado ao bridge (`POST /api/harness/import`) e ao MCP (`import_harness`), com teste. Falta só a UI. | baixa | parcial: falta a UI |
| D-08 | Teste dependente de SO | `server/bridge.e2e.test.ts`, teste «probe» | Esperava «não deu para executar», que só sai em POSIX; no Windows a mensagem é outra. Corrigido para aceitar as duas. | baixa | fechado |
| D-09 | Documentação desatualizada | `skills/archflow/SKILL.md` | Não citava `import_harness`; `mcp.e2e` acusou. Corrigido e `skill.generated.ts` regenerado. | baixa | fechado |
| D-07 | Correção de registro | Matriz (antes deste tick) | Eu havia marcado manifesto e drift como «não implementado»; estavam implementados e testados. Corrigido em `agents-scenarios.md`. | — | fechado |
| D-04 | Inconsistência | Códigos de regra A007, A019, A023 | Não existem no código. Documentado em `agents-scenarios.md`; renumerar fica com o usuário (quebra quem já cita o código). | baixa | documentado |
| D-05 | Lacuna de teste | A002 para tool (`agents.ts`) | Sem caso de teste para tool MCP sem description. Teste adicionado. | baixa | fechado |
| D-06 | Ambiente | Playwright MCP do ambiente | Espera o Chrome em `C:\Users\…\Google\Chrome\Application\chrome.exe`, que não existe. O Edge existe. Os roteiros rodam com `playwright-core` + `channel: "msedge"`. | média (ferramenta) | contornado no loop; configuração do MCP fica com o usuário |
| D-10 | Comportamento enganoso | UI, modal Agents › Harness, «Sincronizar automaticamente» | A caixa Claude Code aparece marcada, mas num projeto que não foi configurado o bridge não grava nada (`configured` falso em `scheduleHarnessSync`). Sem aviso na tela. | média | fechado: o GET de settings devolve `configured`; a caixa fica desabilitada com aviso em projeto não configurado (r8 + bridge.e2e) |

| D-11 | Interação | canvas, duplo clique no nó skill | canvas, duplo clique no nó skill | O roteiro esperava o diálogo da skill; o duplo clique só seleciona e abre o inspetor. Pode ser o gesto do Playwright e não o app: confirmado no navegador (r9): dois cliques de mouse não abrem o diálogo; um evento dblclick disparado no nó abre. Hipótese: o primeiro clique re-renderiza o nó e o segundo cai em outro elemento. A investigar. | média | fechado: o `svg` captura o ponteiro no mousedown, então o dblclick chega com target = svg; `onDoubleClick` agora usa `elementFromPoint` (d11) |
| D-12 | Visual | canvas, setas uses-tool de um agente com 3 tools | Os rótulos «uses-tool» se sobrepõem e cobrem o nó «Read». | baixa | fechado: a pílula de `uses-tool` não é mais desenhada no canvas (`LabelPill`); a relação segue na seta e no inspetor. Verificado: 0 pílulas com 2 tools (d12). |
| D-13 | Visual / dados | `src/shared/ops.ts`, add_node de agente | Skill criada por op aparecia com subtítulo «agent» (usava o kind). Agora `technology` padrão é o nome do papel (Agent/Skill/Tool/Prompt/Workflow); teste em agents.scenarios. | baixa | fechado |

| D-14 | Texto enganoso | `src/ui/store.ts`, `importHarness` | O aviso dizia «veja o modal de validação», mas o modal não mostra o que não volta. Trocado pelo primeiro item que não volta. | baixa | fechado |
| D-15 | Erro cru na UI | `importHarness` sem bridge atualizado | Sem a rota nova, o toast mostrava «rota não encontrada». Causa: processo do bridge antigo; reiniciar o dev resolve. Não é bug do código, mas a mensagem não ajuda. | baixa | fechado: o toast diz para reiniciar o npm run dev |

| D-16 | Perda de dados | `src/ui/store.ts` (sincronização) + diálogo da skill | Corpo digitado no diálogo «Escrever» não chega ao servidor e some ao recarregar; o rodapé promete salvar. Ver `agents-usabilidade.md` item 1. | — | fechado como falso positivo: o corpo salva e sobrevive ao reload (ux12). O teste anterior escrevia na descrição. |
| D-17 | Sessão | terminal, sessão nova do Claude Code | Enter na pergunta de confiança sai do Claude Code (opção padrão «No, exit»); a aba mostra só «saiu» e código 1. | média | aberto |
| D-18 | Atrito | painel Prompts, botão Executar | Digita o prompt sem Enter; o usuário precisa ir ao terminal. | média | aberto |

| D-19 | Atrito | diálogo da skill, «Escrever do zero» | O editor do corpo só aparece depois de clicar em «Em branco» (ou em uma estrutura sugerida). Um passo a mais sem motivo claro. | baixa | aberto |

## Verificados e descartados

- «Arraste» cortado sobre o canvas vazio (flow1, 1366 px): falso positivo. O corte é o dropdown de modo aberto
  por cima da dica; com o dropdown fechado a dica (x 517–849) fica inteira.
- Rótulo «Tir» na barra superior: não reproduzido com o dropdown fechado; pendente de checagem no próximo E2E.
