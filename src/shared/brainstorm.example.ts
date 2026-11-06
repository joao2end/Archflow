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

/**
 * Exemplo de mapa de problema: o que dói no centro, as causas à esquerda (uma delas trava a meta), quem sofre e o que
 * diz em cima, e as ideias de solução à direita, cada uma com os prós e contras.
 */
export function atrasoDoc(): Doc {
  const doc: Doc = { ...emptyDoc("Entregas atrasadas", "brainstorm"), description: "Por que as entregas atrasam e o que dá para fazer." };
  const ops: Op[] = [
    { op: "add_node", id: "atraso", brain: { shape: "problem" }, label: "Entregas atrasam", x: 330, y: 150 },
    { op: "add_node", id: "cliente", brain: { shape: "person" }, label: "Cliente", x: 250, y: -40 },
    { op: "add_node", id: "humor", brain: { shape: "feeling", mood: "angry" }, label: "Irritado", x: 360, y: -46 },
    { op: "add_node", id: "fala", brain: { shape: "speech" }, label: "Cadê meu pedido?!", x: 490, y: -40 },
    { op: "add_node", id: "estoque", brain: { shape: "box" }, label: "Estoque desatualizado no site", x: 0, y: 40 },
    { op: "add_node", id: "separacao", brain: { shape: "clock" }, label: "Separação leva 2 dias", x: 0, y: 160 },
    { op: "add_node", id: "motorista", brain: { shape: "stop" }, label: "Falta motorista", x: 30, y: 260 },
    { op: "add_node", id: "black", brain: { shape: "warning" }, label: "Black Friday chegando", x: 300, y: 330 },
    { op: "add_node", id: "quantos", brain: { shape: "question" }, label: "Quantos pedidos atrasam por semana?", x: 520, y: 360 },
    { op: "add_node", id: "meta", brain: { shape: "target" }, label: "Entregar em até 2 dias", x: 30, y: 440 },
    { op: "add_node", id: "integrar", brain: { shape: "idea" }, label: "Integrar estoque ao site", x: 640, y: 40 },
    { op: "add_node", id: "rotas", brain: { shape: "idea" }, label: "Rotas por bairro", x: 640, y: 220 },
    { op: "add_node", id: "pro1", brain: { shape: "pro" }, label: "Para de vender sem ter", x: 840, y: 40 },
    { op: "add_node", id: "con1", brain: { shape: "con" }, label: "Um mês de TI", x: 840, y: 120 },
    { op: "add_node", id: "pro2", brain: { shape: "pro" }, label: "Mais entregas por viagem", x: 840, y: 230 },
    { op: "add_node", id: "custo2", brain: { shape: "money" }, label: "R$ 2 mil de sistema", x: 840, y: 310 },
    { op: "add_connection", from: "estoque", to: "atraso", label: "causa" },
    { op: "add_connection", from: "separacao", to: "atraso", label: "causa" },
    { op: "add_connection", from: "motorista", to: "atraso", label: "causa" },
    { op: "add_connection", from: "motorista", to: "meta", brain: { line: "blocks" }, label: "trava" },
    { op: "add_connection", from: "black", to: "atraso", brain: { line: "dashed" }, label: "piora" },
    { op: "add_connection", from: "cliente", to: "humor", brain: { line: "line" } },
    { op: "add_connection", from: "fala", to: "atraso", brain: { line: "dotted" } },
    { op: "add_connection", from: "quantos", to: "atraso", brain: { line: "dotted" } },
    { op: "add_connection", from: "atraso", to: "integrar", label: "solução" },
    { op: "add_connection", from: "atraso", to: "rotas", label: "solução" },
    { op: "add_connection", from: "integrar", to: "pro1", brain: { line: "line" } },
    { op: "add_connection", from: "integrar", to: "con1", brain: { line: "line" } },
    { op: "add_connection", from: "rotas", to: "pro2", brain: { line: "line" } },
    { op: "add_connection", from: "rotas", to: "custo2", brain: { line: "line" } },
  ];
  return applyOps(doc, ops).doc;
}
