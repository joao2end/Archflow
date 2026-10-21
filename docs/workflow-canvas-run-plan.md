# Execução de workflow no canvas (plano)

Pedido: o workflow deve rodar **no canvas**, com animação dos agentes, uso das skills e passo a passo dos dados,
inspirado no n8n (ponto de entrada + execução passo a passo). Hoje a execução acontece só no terminal, e o
canvas é só desenho.

## O que já existe

- Nó `workflow` com passos (`step`, `order`, `mode` manual/auto), em `src/shared/workflow.ts` e `src/ui/workflow.tsx`.
- Passos `auto` rodam com `claude -p` em `server/terminal.ts` (stream-json traduzido por `server/streamfmt.ts`).
- Passos `manual` digitam o texto no terminal interativo; quem confirma é o usuário.
- Relações `runs-on` (prompt → agente) e `uses-skill` (agente → skill) já existem no modelo.

## Modelo de execução proposto

1. **Ponto de entrada.** Um nó `entrypoint` (ícone de play, como o gatilho do n8n) no workflow. Tem um campo
   de entrada (texto que vira `{{entrada}}` nos prompts). Só um entrypoint por workflow.
2. **Execução por passos.** Ao clicar em Executar, o canvas percorre os passos em ordem. Cada passo é um prompt.
   - Botões: **Próximo passo**, **Executar até o fim**, **Pausar**, **Parar**.
   - Passo `manual` espera confirmação; `auto` roda sozinho e segue.
3. **Animação.**
   - Nó do agente que está trabalhando acende com pulso.
   - Seta `runs-on` percorrida pelo prompt em execução ganha um fluxo animado.
   - Skills ligadas ao agente ativo acendem quando ele as usa (sinal: o stream mostra a leitura do SKILL.md).
   - Passo concluído fica verde; falha fica vermelha com o motivo.
4. **Dados passo a passo.** Painel lateral com, para cada passo: entrada recebida, prompt renderizado, saída
   (texto do Claude), tempo e status. A saída de um passo vira `{{saida_anterior}}` no seguinte.
5. **Estado persistente.** Cada execução fica salva (ex.: `.archflow/runs/<id>.json`) para reabrir e ver o resultado
   sem rodar de novo. Nada disso entra no `.archflow.json` do diagrama.

## O que precisa ser decidido antes de codar

- **Saída dos passos manuais.** No modo manual o texto vai para o terminal interativo; capturar a resposta
  exige ler o terminal. Sugestão: só passos `auto` devolvem saída estruturada; manual mostra «veja no terminal».
- **Sinais de skill e agente.** Vêm do stream-json (`--output-format stream-json`). Confirmar quais eventos
  indicam uso de skill e de subagente antes de prometer o destaque.
- **Escopo da primeira versão.** Sugestão: entrypoint + execução `auto` do início ao fim com animação e painel
  de dados. Passos manuais e pausa entram na segunda versão.

## Critérios de pronto (para a primeira versão)

- Um workflow com 3 passos roda do entrypoint ao fim, com os 3 nós de agente acendendo na ordem certa.
- O painel mostra entrada e saída de cada passo, e a saída de um vira entrada do seguinte.
- Uma falha em um passo para a execução e marca o passo em vermelho com o motivo.
- Testes: lógica de ordem, substituição de `{{saida_anterior}}` e transições de estado em `src/shared` com
  `node:test`; a animação é verificada no navegador.
