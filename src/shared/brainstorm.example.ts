/**
 * Exemplo pronto do modo brainstorm: um processo do dia a dia (o pedido numa padaria) explicado com formas e traços —
 * início e fim, etapas, uma decisão com as duas saídas rotuladas, quem participa, uma ideia num post-it e a meta em
 * destaque.
 */
import { applyOps, type Op } from "./ops";
import { emptyDoc, type Doc } from "./schema";

export function padariaDoc(): Doc {
  const doc: Doc = { ...emptyDoc("Pedido na padaria", "brainstorm"), description: "Como um pedido acontece, do balcão até o cliente sair com o pão." };
  const ops: Op[] = [
    { op: "add_node", id: "chega", brain: { shape: "round" }, label: "Cliente chega", x: 0, y: 40 },
    { op: "add_node", id: "cliente", brain: { shape: "person" }, label: "Cliente", x: 35, y: 150 },
    { op: "add_node", id: "pede", brain: { shape: "box" }, label: "Faz o pedido no balcão", x: 230, y: 30 },
    { op: "add_node", id: "tem", brain: { shape: "diamond" }, label: "Tem o pão?", x: 470, y: 15 },
    { op: "add_node", id: "embala", brain: { shape: "box" }, label: "Separa e embala", description: "pão quentinho, no saco de papel", x: 700, y: 30 },
    { op: "add_node", id: "outro", brain: { shape: "cloud" }, label: "Oferece outro sabor", x: 455, y: 200 },
    { op: "add_node", id: "paga", brain: { shape: "box" }, label: "Paga no caixa", x: 940, y: 30 },
    { op: "add_node", id: "sai", brain: { shape: "round" }, label: "Sai feliz", x: 1180, y: 40 },
    { op: "add_node", id: "ideia", brain: { shape: "sticky" }, label: "Ideia: aceitar pedido pelo WhatsApp", x: 700, y: 190 },
    { op: "add_node", id: "meta", brain: { shape: "star", color: "#d0532c" }, label: "Atender em 3 min", x: 950, y: 170 },
    { op: "add_connection", from: "chega", to: "pede" },
    { op: "add_connection", from: "cliente", to: "chega", brain: { line: "dotted" } },
    { op: "add_connection", from: "pede", to: "tem" },
    { op: "add_connection", from: "tem", to: "embala", label: "sim" },
    { op: "add_connection", from: "tem", to: "outro", label: "não" },
    { op: "add_connection", from: "outro", to: "pede", label: "aceita", brain: { line: "dashed" } },
    { op: "add_connection", from: "embala", to: "paga" },
    { op: "add_connection", from: "paga", to: "sai" },
  ];
  const r = applyOps(doc, ops);
  return r.doc;
}
