# Loop — montar diagramas Logic à mão (sem IA)

Uso:

```
/loop Melhorar a expressividade dos diagramas lógicos (modo logic) e a facilidade de criá-los manualmente na UI do Archflow — hoje só é viável criar via IA. A cada iteração: identificar o maior atrito na criação manual (ou lacuna de expressividade), implementar uma melhoria pequena e coesa, rodar testes/typecheck, e registrar o progresso em docs/LOGIC_MANUAL_UX_LOOP.md (backlog + feito).
```

Complementa `docs/LOGIC_NODES_LOOP_PROMPT.md` (configurar **um** nó, tarefas U1–U8). Este loop mede o **diagrama inteiro**: quanto custa sair do quadro vazio até um fluxo que roda e tem cenário.

## Regras de cada iteração

1. Ler este arquivo; não repetir o que está feito.
2. Escolher **o maior atrito** da tarefa de referência (abaixo) ou uma lacuna de expressividade que impeça um caso real.
3. Lógica nova em `src/shared/` (pura e testada); a UI só liga botões a ela.
4. `npx tsc --noEmit` e `npm test` verdes. Se der, conferir no sandbox (`node scripts/dev-sandbox.mjs`, porta 5188; nunca no cofre `diagrams/` do usuário).
5. Registrar aqui: o que mudou, a contagem de ações antes → depois (medida no navegador ou **estimada pelo código**, dizendo qual) e o que ficou pendente.
6. Árvore suja pelo usuário: não tocar no que não é desta iteração. Sem commits automáticos.

## Tarefa de referência (M1): o frete, do zero

> Pedido de R$ 200 ou mais tem frete grátis; abaixo disso, R$ 15. Com 2 cenários (250 → 0; 100 → 15).

```
Início → [total >= 200?] ─ sim → [frete := 0]  → Fim
                         └ não → [frete := 15] ─┘
dados: total (IN, number), frete (OUT, number)
```

Contamos ações (clique, campo preenchido = focar + digitar + Tab conta 3, arrasto = 1).

| Trecho | Antes do loop (estimado pelo código) | Agora |
|---|---|---|
| Declarar 2 dados (biblioteca → nó → renomear → key → tipo) | ≈ 2 × 8 = **16** | **2** (um clique «Criar…» no aviso de cada nome; papel e tipo inferidos) — iteração 1 |
| 5 passos + 5 setas (biblioteca põe o passo embaixo, mas **não liga**; a seta é arrastada à parte) | ≈ 5 + 5 arrastos + posicionar o ramo «não» | ? |
| Decisão + 2 efeitos | 3 campos = 9 | 9 |
| 2 cenários | ≈ 2 × 7 | ? |

## Backlog (ordenado por ganho esperado)

- [x] **Criar dado a partir do nome digitado** (iteração 1)
- [ ] **Próximo passo já ligado**: com um passo selecionado, clicar um item da biblioteca cria o passo **e a seta** (saída certa: sim → não, repete → segue, caso N); o ramo «não»/2º caso nasce ao lado, não embaixo do «sim»
- [ ] **Soltar a seta no vazio** abre um menu rápido «Ação / Decisão / Escolha / Laço / Fim» que cria o passo ali, já ligado (como o n8n)
- [ ] **Fluxo inicial**: diagrama Logic vazio oferece «Começar com Início → Fim» (ou já nasce assim), para nunca começar do zero absoluto
- [ ] Atalhos de teclado no modo Logic: com um passo selecionado, `A` (ação), `D` (decisão), `E` (escolha), `L` (laço), `F` (fim) criam o próximo passo ligado
- [ ] **Cenário a partir do ▶**: depois de rodar um exemplo, «Salvar como cenário» com o Dado e a saída obtida como Esperado
- [ ] Inferir tipo de Input pelo valor usado nos exemplos (`total = 250` → number) quando o dado ainda está sem tipo
- [ ] Mesmo «Criar dado» no Dado/Esperado dos exemplos e nas condições das setas do Switch
- [ ] Expressividade: «senão se» na Decisão (cadeia de faixas sem uma Escolha) — escrever o caso antes
- [ ] Medir M1 no navegador de ponta a ponta (o Playwright desta máquina está sem Chrome: `npx playwright install chrome`)

## Feito

| # | Data | Atrito | Mudança | Ações (M1) | Verificação |
|---|------|--------|---------|------------|-------------|
| 1 | 2026-10-22 | Usar um nome novo (`frete := 0`, `total >= 200`) só gerava «Declare um dado com esse nome…», sem botão: era preciso ir à biblioteca, criar o Input/Output, renomear, escrever o key e o tipo | `src/shared/logicquick.ts`: `missingData` acha os nomes não declarados do texto, com **papel** (escrito → Output; só lido → Input) e **tipo** quando há certeza (valor atribuído; comparação/conta com valor de tipo conhecido; `e`/`ou`/`nao` → boolean; `x em lista`). `declareDataOp` põe o dado embaixo do último dado (ou à esquerda do fluxo). No inspetor, o aviso ganhou «Criar entrada (IN · number)», «Criar saída (OUT · number)» / «Criar variável (VAR)», ao lado do «Trocar por…» que já existia; vale em todos os campos que usavam o aviso (efeitos, condição, parada, lista…). Desfazer pelo toast | declarar 2 dados: ≈ 16 → **2** (estimado pelo código) | 4 testes novos (`logicquick.test.ts`, inclui: o L007 some depois de criar) · typecheck · `npm test` · navegador **não verificado** (Playwright sem Chrome) |
