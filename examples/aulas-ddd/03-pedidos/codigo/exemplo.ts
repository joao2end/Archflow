import { montar } from "./infra/montar";

// #region uso
/**
 * O caso de uso «Fazer pedido», de ponta a ponta:
 * controller → command → Pedido → evento → policy → Estoque → evento → policy → Pedido.
 */
async function main(): Promise<void> {
  const { controller } = await montar({ caneca: 3 });

  console.log(await controller.post({ clienteId: "ana", produtoId: "caneca", quantidade: 2 }));
  // { status: 201, corpo: { pedidoId: 'p1' } }
  console.log(controller.get("ana").corpo);
  // [ { pedidoId: 'p1', produtoId: 'caneca', quantidade: 2, situacao: 'confirmado' } ]

  console.log(await controller.post({ clienteId: "ana", produtoId: "caneca", quantidade: 5 }));
  // 422: saldo insuficiente (o Estoque recusou)
  console.log(await controller.post({ clienteId: "ana" }));
  // 400: entrada incompleta (barrada no controller)
}

void main();
// #endregion
