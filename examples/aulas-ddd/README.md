# Aulas de DDD em TypeScript

> Gerado a partir de `src/shared/lessons.ts` (`npm run examples:build`).

Três aulas curtas para aprender DDD **pelo diagrama**: cada passo destaca as peças do modelo (no 2D e na visão 3D das camadas) e mostra o código TypeScript que as implementa. O código de cada aula compila com `tsc --strict` e roda com `npx tsx`.

| Aula | O que acrescenta |
| --- | --- |
| [1 · Lista de tarefas](01-tarefas/README.md) | bounded context, value object, aggregate root e invariante, command → evento, caso de uso |
| [2 · Carrinho de compras](02-carrinho/README.md) | entity × value object, fronteira do aggregate, invariante do conjunto, repository (interface no domínio), handler: carregar, chamar, salvar |
| [3 · Pedido e estoque](03-pedidos/README.md) | dois aggregates, um por transação, referência por id, policy (evento → command), controller, read model (CQRS) |

Depois das aulas, siga para os modelos completos em [`../exemplos-ddd`](../exemplos-ddd/) (Biblioteca → Clínica → Loja → Banco → Delivery).
