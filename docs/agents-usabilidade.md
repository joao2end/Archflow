# Modo agents: pontos de melhoria de usabilidade

Levantamento feito durante os testes E2E (navegador, app isolado). Cada item diz **o que acontece**, **por que
importa para quem usa** e **como verifiquei**. Ordenado do mais grave para o menos grave.

## Graves: o usuário pode perder trabalho

**1. (Revisado) Texto do corpo da skill: não é perda.** O teste inicial digitou na descrição. Com o campo certo, o corpo salva e sobrevive ao recarregamento. Ver D-16 fechado.

**1b. Atrito:** o editor do corpo só aparece depois de clicar em «Em branco» (D-19).
- O que acontece: escrevo o corpo de uma skill no diálogo «Escrever». O texto fica na tela e no navegador,
  mas o diagrama no servidor continua vazio, mesmo 2 segundos depois. Ao recarregar a página, o texto some.
- Por que importa: o rodapé do diálogo diz «As mudanças são salvas no diagrama enquanto você edita». Isso
  não é verdade para o corpo da skill. Quem escreve um guia longo pode perdê-lo.
- Como verifiquei: `ux5` (preenche, espera, recarrega) e `ux6` (confirma que o texto está no localStorage e não
  no servidor). Operações de título, agente e tool pelo canvas chegam ao servidor normalmente.
- Causa provável (não confirmada): a sincronização só envia o diagrama quando a origem é «local». Preciso
  investigar `startSync` e o campo `docSource` em `src/ui/store.ts` antes de corrigir.

**2. Sessão do Claude Code termina sem aviso claro.**
- O que acontece: ao abrir uma sessão nova no terminal, o Claude Code pergunta se confio na pasta. A opção
  marcada por padrão é «No, exit». Apertar Enter fecha a sessão. A aba fica com a palavra «saiu» e a mensagem
  `[processo saiu com código 1]`, sem explicar o que aconteceu.
- Por que importa: o usuário perde a sessão e não sabe por quê.
- Como verifiquei: `runterm`, `runterm2`, `runterm4`.

## Repetição de passos (atrito)

**3. O prompt é digitado, mas não é enviado.**
- O botão «Executar» do painel Prompts digita o texto no terminal sem apertar Enter (o próprio tooltip diz
  isso). Quem clica espera que o prompt rode, e precisa ir ao terminal e apertar Enter.
- Sugestão: enviar com Enter por padrão, ou mostrar um botão «Enviar» logo ao lado do texto digitado.

**4. Confiar na pasta é pedido de novo a cada sessão.**
- A cada nova sessão aparece a pergunta de confiança do Claude Code. Para o projeto do próprio usuário isso
  tende a ser uma vez só, mas o app não explica nem guarda a escolha.

**5. Importar e exportar são coisas diferentes na mesma aba.**
- O botão «Importar do projeto» fica ao lado de «Gravar no projeto», sem distinção visual de sentido. Vale
  um rótulo mais claro: «Trazer do projeto» e «Levar ao projeto».

## Confusão visual

**6. Setas de ferramenta não mostram o nome da relação.**
- Resolvido nesta rodada (D-12): a pílula «uses-tool» saiu do canvas para não cobrir os nós. Quem quiser ver a
  relação precisa abrir o inspetor. Se isso incomodar, dá para mostrar a relação só quando o nó é selecionado.

**7. Subtítulo de skill criada por operação.**
- Resolvido (D-13): skills criadas pela API apareciam como «agent». Agora aparecem como «Skill».

## O que já funciona bem (verificado)

- Modelo pronto pela biblioteca (time de revisão) cria agente e tools com as setas certas.
- Cards avulsos (AGENT, SKILL, PROMPT, FLOW) criam o nó do tipo certo.
- Arrastar uma skill sobre um agente cria a skill e a seta de uma vez.
- Ligar agente a skill com a ferramenta de seta cria a relação certa.
- Duplo clique na skill abre o diálogo (corrigido em D-11).
- Ao importar o harness, um aviso diz o primeiro item que não volta (D-14).
- O modal de validação mostra os avisos com o código da regra (ex.: A003).

## Não verificado

- Se o Esc fecha o diálogo da skill de forma consistente: em um teste ficou aberto, em outro fechou.
- Execução real de «Use o subagente…»: a sessão caiu antes de o prompt ser enviado (ver item 2 e 3).
