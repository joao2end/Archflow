import { CarrinhoHandlers } from "./application/handlers";
import { CarrinhosEmMemoria } from "./infra/carrinhos-em-memoria";

// #region uso
/**
 * O caso de uso «Montar o carrinho». A implementação do repository é escolhida aqui,
 * na borda, e entregue aos handlers.
 */
async function main(): Promise<void> {
  const handlers = new CarrinhoHandlers(new CarrinhosEmMemoria());
  const c1 = "c1";

  await handlers.adicionarItem({ carrinhoId: c1, produtoId: "caneca", precoEmCentavos: 3990, quantidade: 2 });
  await handlers.adicionarItem({ carrinhoId: c1, produtoId: "camiseta", precoEmCentavos: 5990, quantidade: 1 });
  await handlers.removerItem({ carrinhoId: c1, produtoId: "camiseta" });

  const [fechado] = await handlers.fecharCarrinho({ carrinhoId: c1 });
  console.log(fechado); // { tipo: 'CarrinhoFechado', carrinhoId: 'c1', totalEmCentavos: 7980 }

  try {
    await handlers.adicionarItem({ carrinhoId: c1, produtoId: "boné", precoEmCentavos: 2500, quantidade: 1 });
  } catch (e) {
    console.log("recusado:", (e as Error).message); // O carrinho já foi fechado.
  }
}

void main();
// #endregion
