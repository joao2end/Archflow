# Exemplos

Os exemplos do Archflow, por modo. A seção *Exemplos* do explorador instala qualquer um deles no projeto aberto.

**Todo exemplo de Arquitetura e de Domínio tem uma aula guiada** (`src/shared/example.lessons.ts`): ao instalar ou abrir o exemplo, o painel da aula aparece à direita e cada passo acende as peças do diagrama e explica o porquê. Nos exemplos de Domínio a aula começa pelo mapa de contextos e o botão *Próximo* abre sozinho o diagrama de cada contexto.

- **Arquitetura**: loja online, API com fila, microsserviços e pipeline de dados (definidos em `src/shared/arch.examples.ts`; instalam em `exemplos-arquitetura/`).
- **Domínio (DDD)**: três aulas para começar ([`aulas-ddd/`](aulas-ddd/README.md)) e os cinco modelos abaixo, na pasta `exemplos-ddd/`.
- **Lógica**: três aulas do diagrama lógico (abaixo), o motor de precificação (`exemplos-logic/`) e 15 algoritmos, de busca binária a fluxo máximo, em [`exemplos-algoritmos/`](exemplos-algoritmos/) (gerados por `scripts/build-algorithms.ts`, com oráculos em `src/shared/fixtures/oracles/`; histórico e resultados em [`docs/algorithm-score.md`](../docs/algorithm-score.md)).

## Aulas do diagrama lógico

Para aprender o modo **Logic** (regras de negócio como fluxo que o app executa e confere), do simples ao complexo:

| Aula | Nível | Como é | O que ensina |
| --- | --- | --- | --- |
| 1 · Seu primeiro diagrama lógico | simples | **tutorial interativo**: você monta a regra do frete grátis na própria interface; o tutorial destaca o botão, a peça da Biblioteca ou o campo do Inspetor de cada passo e espera você fazer (**Fazer por mim** demonstra com um cursor animado) | Biblioteca e Inspetor, Início, Entrada, Resultado, Decisão, Ação, Fim, Conector e setas sim/não, mover peças, exemplos, cenário, teste e debug 3D |
| 2 · Pontos de fidelidade | médio | aula guiada que monta o diagrama do zero, passo a passo | Loop «para cada», Variável acumulada, Tabela de decisão, Escolha (switch), fim com erro, etapas |
| 3 · Aprovação de crédito | complexo | aula guiada que monta o diagrama do zero, passo a passo | gatilho webhook, Chamada HTTP com resposta simulada e seta «erro», Paralelo e Junção, travar/destravar, vários fins, um cenário por caminho |

As aulas instalam o diagrama vazio em `exemplos-logic/aulas/`. O tutorial está em `src/shared/logictour.ts` (passos, alvos e condições) e `src/ui/logictour.tsx` (destaque, balão e cursor); as aulas 2 e 3 em `src/shared/logic.lessons.ts`. Os testes conferem que o «Fazer por mim» de cada passo conclui o passo, que montar passo a passo chega a um diagrama que valida sem erros e com todos os exemplos e cenários batendo, e que cada passo aponta peças que existem.

## Aulas de DDD em TypeScript

Para quem está começando: três aulas curtas que ensinam DDD **pelo diagrama**. Cada aula é um diagrama em camadas (abre na visão 3D) e uma pasta de código TypeScript que compila e roda. No app, o painel da aula anda passo a passo: cada passo acende as peças do diagrama e mostra o trecho de código que as implementa.

| Aula | O que acrescenta |
| --- | --- |
| [1 · Lista de tarefas](aulas-ddd/01-tarefas/README.md) | value object, aggregate root e invariante, command → evento, caso de uso |
| [2 · Carrinho de compras](aulas-ddd/02-carrinho/README.md) | entity dentro do aggregate, invariante do conjunto, repository |
| [3 · Pedido e estoque](aulas-ddd/03-pedidos/README.md) | dois aggregates ligados por eventos, policy, controller, read model |

## Exemplos de DDD

Modelos prontos do modo **Domain** do Archflow, para aprender DDD e para usar como ponto de partida. Antes de começar, o guia [`docs/DDD.md`](../docs/DDD.md) explica os conceitos (subdomínios, bounded contexts, aggregates, eventos, sagas...) e como cada um aparece no Archflow.

| Exemplo | Nível | Para aprender |
| --- | --- | --- |
| [Biblioteca universitária](exemplos-ddd/biblioteca/README.md) | iniciante | aggregate definido pela invariante, entity × value object, policy, domain service, read model, context map |
| [Clínica médica](exemplos-ddd/clinica/README.md) | intermediário | onde traçar a fronteira do aggregate, linguagem diferente por contexto, shared kernel |
| [Loja online](exemplos-ddd/loja/README.md) | intermediário | saga com compensação, anticorruption layer, eventos entre contextos, do domínio à arquitetura |
| [Banco digital](exemplos-ddd/banco/README.md) | avançado | um aggregate por transação, consistência eventual, saga de transferência, published language |
| [Delivery de comida (tour completo)](exemplos-ddd/delivery/README.md) | avançado | **todos os recursos**: os 8 padrões do Context Map, decisões exclusiva/paralela/junção, loop, "para cada", propriedades, saga, notas |

Sugestão de ordem: **Biblioteca → Clínica → Loja → Banco → Delivery** (o último reúne tudo o que os outros mostram separadamente).

## Como usar

**No app:** explorador de arquivos → seção *Exemplos* (abas *Arquitetura*, *Domínio* e *Lógica*) → *Instalar e abrir*. O exemplo vira a pasta `exemplos-ddd/<exemplo>/` no projeto aberto (nada é sobrescrito) e abre o mapa de contextos; clique em um contexto para entrar nele.

**Fora do app:** copie a pasta `examples/exemplos-ddd` para dentro de um projeto do Archflow (a pasta do projeto, a que contém seus `.archflow.json`). Os vínculos entre o mapa de contextos, os contextos e a arquitetura usam esses caminhos, então mantenha a estrutura `exemplos-ddd/<exemplo>/`.

**Cada pasta tem:**

- `visao-geral.archflow.json`: o mapa de contextos (com os padrões do Context Map);
- um `.archflow.json` por bounded context (e a arquitetura, na loja);
- `modelo.md`: o modelo em texto, exatamente o que um agente de IA lê via MCP (`get_diagram`, `domain_overview`). Gerado, não edite;
- `README.md`: a história, como ler os diagramas, as decisões de modelagem e exercícios.

## Para os agentes (MCP)

Peça: *"Leia o domínio em `exemplos-ddd/loja` com `domain_overview` e explique a saga de checkout"*, ou *"gere o esqueleto de código do contexto Pedidos"* (`generate_code`). Para medir a qualidade de um modelo: `npm run eval:domain -- examples/exemplos-ddd/loja/pedidos.archflow.json`.

## Garantias

Os exemplos são definidos em `src/shared/examples.ts` e **testados**: todos os diagramas validam sem erros nem avisos, todo caso de uso é rastreado até um evento, o esqueleto de código de cada um compila com `tsc --strict` e os arquivos desta pasta estão em dia com as definições. As aulas (`src/shared/lessons.ts`) também: cada passo aponta peças que existem no diagrama, todo componente é explicado em algum passo, o código de cada aula compila com `tsc --strict` e o `exemplo.ts` roda e imprime o que o texto promete. Para regenerar depois de mudar uma definição: `npm run examples:build`.
