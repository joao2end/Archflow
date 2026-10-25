# Regras de legibilidade e auto-layout

Resumo da pesquisa e do que o Archflow aplica em `auto_layout`. Código: `src/shared/layout.ts` (núcleo em camadas), `src/shared/ops.ts` (`autoLayout`, `avoidCollisions`, `placeLabels`) e `src/shared/storm.ts` (linha do tempo do modo domínio).

## O que a literatura recomenda

- **Menos cruzamentos de arestas** é o critério que mais pesa na legibilidade (grafos em camadas, abordagem Sugiyama); depois vêm poucas dobras, arestas curtas e ângulos distintos nas pontas. Os critérios conflitam, então se otimiza uma combinação.
- **Fluxo numa direção** (esquerda→direita ou cima→baixo) e ciclos tratados como arestas de retorno.
- **Poucos elementos por vista** (C4: ~6–8 elementos e ~6 relações por diagrama); acima disso, dividir em níveis. Não misturar níveis de abstração.
- **Event Storming**: tempo da esquerda para a direita, cores/raias fixas por tipo de adesivo, eventos externos como entrada.
- **DDD / Context Map**: contextos a montante (upstream) acima ou à esquerda dos a jusante; integração entre contextos com direção explícita.

Fontes: [A Survey on Graph Drawing Beyond Planarity](https://arxiv.org/pdf/1804.07257), [Improving Layered Graph Layouts with Edge Bundling (Microsoft Research)](https://www.microsoft.com/en-us/research/publication/improving-layered-graph-layouts-with-edgebundling/), [C4 model](https://system-design.space/en/chapter/c4-model/), [Event Storming](https://xebia.com/de/blog/eventstorming-core-concepts-glossary-and-legend/).

## O que o app aplica

Arquitetura (`auto_layout`):

1. Ciclos viram arestas de retorno (DFS a partir das fontes); o fluxo segue em uma direção.
2. Camadas pelo caminho mais longo; **fontes são puxadas** para junto do destino mais próximo (arestas curtas).
3. **Minimização de cruzamentos**: varreduras de baricentro para baixo/para cima + troca de vizinhos, guardando a melhor ordem. Arestas longas ganham nós virtuais.
4. **Alinhamento**: cada componente fica na altura média dos vizinhos (regressão isotônica respeitando o espaçamento), deixando as conexões retas.
5. **Componentes sem conexão** (3 ou mais) vão para uma grade abaixo do fluxo, em vez de uma coluna interminável.
6. Grupos são medidos de dentro para fora; o vão entre camadas comporta o maior rótulo; depois `avoidCollisions` desvia conexões de componentes e `placeLabels` evita sobrepor rótulos.

Domínio, padrão (`style: "onion"`), camadas da Clean Architecture em anéis concêntricos:

1. **Entities** (aggregates, entities, value objects, domain services e eventos internos) no centro → **Use Cases** (casos de uso e commands em cima; application services, policies e sagas embaixo) → **Interface Adapters** (Gateways = repositories à esquerda, Presenters = read models à direita) → **Frameworks & Drivers** (atores em cima, sistemas com `ref` à esquerda, eventos de outros contextos à direita, sistemas externos embaixo).
2. Cada bounded context tem a sua cebola; o que está fora dos contextos forma o anel externo de Frameworks & Drivers em volta de todos. Anéis vazios não são criados.
3. Os anéis são grupos `anel-*` com `ring` (raio interno e, nos setores, ângulos): a caixa é o quadrado do círculo e o canvas desenha disco, coroa ou setor, com o nome ao longo do arco. Os componentes ficam espalhados em ângulos iguais no seu anel; o raio cresce até nenhum encostar em outro ou sair do setor. Qualquer outro estilo de layout desfaz os anéis e devolve componentes e contextos ao pai de origem.

Domínio, Event Storming (`style: "timeline"`):

1. Raias fixas por papel (ator → caso de uso → command → aggregate → evento → policy → read model → estrutura), commands na ordem de `ddd.step`.
2. **Contextos em ordem de dependência**: o que alimenta outro (conexão ou evento externo) fica acima.
3. **Faixas**: contexto com mais de `STORM_MAX_COLS` (8) colunas quebra em faixas empilhadas; colunas vazias são removidas.

## Como modelar para ficar legível

Até ~8 componentes por grupo e ~6 conexões por componente; quebre em vários diagramas (`system` + `ref`) acima disso; nomeie as conexões; evite componentes isolados; declare as conexões no sentido do fluxo.
