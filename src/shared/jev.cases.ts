/**
 * Três algoritmos de referência para o modelo JEV (ver logiceval.ts): simples, médio e complexo.
 *
 * Cada caso traz o ENUNCIADO (o problema em palavras de negócio), o ORÁCULO (casos tirados do enunciado, escritos sem olhar
 * o desenho) e o diagrama Logic que o representa. O Verificador roda o oráculo no diagrama; o Executor lista as perguntas
 * que alguém que só vê o diagrama teria de fazer.
 */
import { emptyDoc, type Doc, type LogicBranch, type LogicExample, type LogicValue } from "./schema";
import { applyOps, type Op } from "./ops";
import { migrateFacts } from "./logic";
import type { OracleCase } from "./logiceval";

export interface JevCase {
  nivel: "simples" | "médio" | "complexo";
  enunciado: string;
  oraculo: OracleCase[];
  doc: Doc;
}

type V = Record<string, LogicValue>;
const fact = (id: string, label: string, key: string, type: string, text: string, value?: LogicValue): Op => ({ op: "add_node", id, label, logic: { role: "input", key, type, text, ...(value !== undefined ? { value } : {}) } });
const ex = (name: string, given: V, expect: V): LogicExample => ({ name, given, expect });
const start = (id: string, label: string, text: string): Op => ({ op: "add_node", id, label, logic: { role: "start", text } });
const end = (id: string, label: string, text: string, outcome: "ok" | "erro"): Op => ({ op: "add_node", id, label, logic: { role: "end", outcome, text } });
const rule = (id: string, label: string, text: string, then: string[], examples: LogicExample[]): Op => ({ op: "add_node", id, label, logic: { role: "rule", text, then, examples } });
const decision = (id: string, label: string, when: string, text: string, examples: LogicExample[]): Op => ({ op: "add_node", id, label, logic: { role: "decision", when, text, examples } });
const scenario = (id: string, label: string, text: string, examples: LogicExample[]): Op => ({ op: "add_node", id, label, logic: { role: "scenario", text, examples } });
const edge = (from: string, to: string, branch?: LogicBranch, kase?: string): Op => ({ op: "add_connection", from, to, ...(branch || kase ? { logic: branch ? { branch } : { case: kase! } } : {}) });

function build(title: string, description: string, ops: Op[]): Doc {
  // com o layout automático aplicado, como o app deixa o diagrama quando alguém usa "Organizar"
  const built = applyOps(emptyDoc(title, "logic"), ops);
  built.doc.nodes = migrateFacts(built.doc.nodes, built.doc.connections, true); // Input, Output ou Variable pelo uso no fluxo
  const r = applyOps(built.doc, [{ op: "layout" } as Op]);
  r.results.unshift(...built.results);
  const bad = r.results.filter((x) => !x.ok);
  if (bad.length) throw new Error(`${title}: ${JSON.stringify(bad)}`);
  r.doc.description = description;
  return r.doc;
}

/* ───────────────────────── 1. simples: frete ───────────────────────── */

const frete = (): JevCase => ({
  nivel: "simples",
  enunciado: "Pedidos de R$ 200 ou mais têm frete grátis. Abaixo disso, o frete é fixo em R$ 15.",
  oraculo: [
    { name: "acima do mínimo", given: { total: 250 }, expect: { frete: 0, desfecho: "ok" } },
    { name: "exatamente no mínimo", given: { total: 200 }, expect: { frete: 0 } },
    { name: "um centavo abaixo", given: { total: 199.99 }, expect: { frete: 15 } },
    { name: "pedido pequeno", given: { total: 50 }, expect: { frete: 15 } },
  ],
  doc: build("Frete do pedido", "Define o frete de um pedido: grátis a partir de R$ 200, senão fixo em R$ 15.", [
    fact("total", "Total do pedido", "total", "dinheiro", "Soma dos itens, sem frete."),
    fact("frete", "Frete", "frete", "dinheiro", "Valor do frete que o cliente paga."),
    start("inicio", "Calcular o frete", "Entra o total do pedido."),
    decision("gratis", "O pedido tem R$ 200 ou mais?", "total >= 200", "Pedidos a partir de R$ 200 não pagam frete.", [ex("200", { total: 200 }, { caminho: "sim" }), ex("199,99", { total: 199.99 }, { caminho: "nao" })]),
    rule("frete-gratis", "Frete grátis", "O cliente não paga frete.", ["frete := 0"], [ex("zera", { total: 300 }, { frete: 0 })]),
    rule("frete-fixo", "Frete fixo de R$ 15", "Abaixo de R$ 200 o frete é fixo.", ["frete := 15"], [ex("cobra", { total: 80 }, { frete: 15 })]),
    end("fim", "Frete definido", "Devolve o valor do frete.", "ok"),
    scenario("caso-grande", "Pedido grande", "R$ 250 não paga frete.", [ex("250", { total: 250 }, { frete: 0, desfecho: "ok" })]),
    scenario("caso-pequeno", "Pedido pequeno", "R$ 80 paga o frete fixo.", [ex("80", { total: 80 }, { frete: 15, desfecho: "ok" })]),
    edge("inicio", "gratis"),
    edge("gratis", "frete-gratis", "sim"),
    edge("gratis", "frete-fixo", "nao"),
    edge("frete-gratis", "fim"),
    edge("frete-fixo", "fim"),
  ]),
});

/* ───────────────────────── 2. médio: reembolso ───────────────────────── */

const reembolso = (): JevCase => ({
  nivel: "médio",
  enunciado:
    "Uma compra pode ser devolvida em até 7 dias. Com defeito, o prazo vai a 90 dias. Fora do prazo, o pedido é recusado. " +
    "Aprovado, o reembolso é o valor da compra e quem aprova depende do valor: até R$ 100 é automático, até R$ 1.000 o gerente, acima disso a diretoria.",
  oraculo: [
    { name: "dentro de 7 dias, valor baixo", given: { dias: 3, tem_defeito: false, valor: 50 }, expect: { aprovador: "automático", reembolso: 50, desfecho: "ok" } },
    { name: "R$ 100 ainda é automático", given: { dias: 7, tem_defeito: false, valor: 100 }, expect: { aprovador: "automático" } },
    { name: "valor médio vai ao gerente", given: { dias: 7, tem_defeito: false, valor: 500 }, expect: { aprovador: "gerente", reembolso: 500 } },
    { name: "valor alto vai à diretoria", given: { dias: 5, tem_defeito: false, valor: 5000 }, expect: { aprovador: "diretoria" } },
    { name: "defeito amplia o prazo", given: { dias: 30, tem_defeito: true, valor: 200 }, expect: { aprovador: "gerente", desfecho: "ok" } },
    { name: "defeito fora de 90 dias", given: { dias: 91, tem_defeito: true, valor: 200 }, expect: { desfecho: "erro" } },
    { name: "sem defeito fora de 7 dias", given: { dias: 10, tem_defeito: false, valor: 200 }, expect: { desfecho: "erro" } },
  ],
  doc: build("Reembolso de compra", "Decide se uma devolução é aceita, quanto volta ao cliente e quem precisa aprovar.", [
    fact("dias", "Dias desde a compra", "dias", "número", "Quantos dias se passaram entre a compra e o pedido de devolução."),
    fact("defeito", "Veio com defeito", "tem_defeito", "lógico", "O cliente informou defeito no produto."),
    fact("valor", "Valor da compra", "valor", "dinheiro", "Quanto o cliente pagou pelo item."),
    fact("aprovador", "Quem aprova", "aprovador", "texto", '"automático", "gerente" ou "diretoria".'),
    fact("reembolso", "Reembolso", "reembolso", "dinheiro", "Valor devolvido ao cliente."),
    start("inicio", "Pedido de devolução", "Entra a compra devolvida: dias, defeito e valor."),
    decision("prazo-normal", "A devolução é de até 7 dias?", "dias <= 7", "O prazo normal de arrependimento é de 7 dias.", [ex("7 dias", { dias: 7 }, { caminho: "sim" }), ex("8 dias", { dias: 8 }, { caminho: "nao" })]),
    decision("prazo-defeito", "Tem defeito e até 90 dias?", "tem_defeito e dias <= 90", "Produto com defeito pode ser devolvido por até 90 dias.", [ex("defeito 90", { tem_defeito: true, dias: 90 }, { caminho: "sim" }), ex("sem defeito", { tem_defeito: false, dias: 20 }, { caminho: "nao" })]),
    { op: "add_node", id: "faixa", label: "Quem aprova pelo valor?", logic: { role: "switch", text: "Até R$ 100 é automático; até R$ 1.000, o gerente; acima, a diretoria.", examples: [ex("baixo", { valor: 100 }, { caminho: "valor <= 100" })] } },
    rule("auto", "Aprovação automática", "Valores pequenos não precisam de pessoa.", ['aprovador := "automático"'], [ex("auto", { valor: 50 }, { aprovador: "automático" })]),
    rule("gerente", "Aprovação do gerente", "Valores médios passam pelo gerente.", ['aprovador := "gerente"'], [ex("gerente", { valor: 500 }, { aprovador: "gerente" })]),
    rule("diretoria", "Aprovação da diretoria", "Valores altos exigem a diretoria.", ['aprovador := "diretoria"'], [ex("diretoria", { valor: 5000 }, { aprovador: "diretoria" })]),
    rule("devolver", "Devolver o valor pago", "O reembolso é o valor da compra.", ["reembolso := valor"], [ex("integral", { valor: 120 }, { reembolso: 120 })]),
    end("aceito", "Devolução aceita", "A compra volta ao cliente com o aprovador definido.", "ok"),
    end("recusado", "Fora do prazo", "A devolução é recusada: passou do prazo.", "erro"),
    scenario("caso-auto", "Dentro do prazo, valor baixo", "3 dias, R$ 50: automático.", [ex("auto", { dias: 3, tem_defeito: false, valor: 50 }, { aprovador: "automático", reembolso: 50, desfecho: "ok" })]),
    scenario("caso-gerente", "Defeito amplia o prazo", "30 dias com defeito, R$ 200: gerente.", [ex("gerente", { dias: 30, tem_defeito: true, valor: 200 }, { aprovador: "gerente", desfecho: "ok" })]),
    scenario("caso-diretoria", "Valor alto", "5 dias, R$ 5.000: diretoria.", [ex("diretoria", { dias: 5, tem_defeito: false, valor: 5000 }, { aprovador: "diretoria", desfecho: "ok" })]),
    scenario("caso-recusa", "Fora do prazo", "10 dias sem defeito: recusado.", [ex("recusa", { dias: 10, tem_defeito: false, valor: 200 }, { desfecho: "erro" })]),
    edge("inicio", "prazo-normal"),
    edge("prazo-normal", "faixa", "sim"),
    edge("prazo-normal", "prazo-defeito", "nao"),
    edge("prazo-defeito", "faixa", "sim"),
    edge("prazo-defeito", "recusado", "nao"),
    edge("faixa", "auto", undefined, "valor <= 100"),
    edge("faixa", "gerente", undefined, "valor <= 1000"),
    edge("faixa", "diretoria", "outros"),
    edge("auto", "devolver"),
    edge("gerente", "devolver"),
    edge("diretoria", "devolver"),
    edge("devolver", "aceito"),
  ]),
});

/* ───────────────────────── 3. complexo: crédito pessoal ───────────────────────── */

const credito = (): JevCase => ({
  nivel: "complexo",
  enunciado:
    "Para conceder crédito pessoal: renda e valor pedido precisam ser positivos. Somam-se as parcelas das dívidas atuais; se elas passam de 40% da renda, o crédito é recusado. " +
    "O score define taxa e fator: 700 ou mais, taxa de 1,5% ao mês e fator 8; de 500 a 699, taxa de 3% e fator 5; abaixo de 500, recusado. " +
    "O limite é renda × fator × (1 − parcela comprometida). Pedido acima do limite é recusado. Aprovado, o total a pagar é o valor × (1 + taxa × 12).",
  oraculo: [
    { name: "score alto, uma dívida", given: { renda: 5000, score: 750, dividas: [{ parcela: 500 }], valor_pedido: 10000 }, expect: { limite: 36000, taxa: 0.015, total_a_pagar: 11800, desfecho: "ok" } },
    { name: "score médio, sem dívidas", given: { renda: 3000, score: 600, dividas: [], valor_pedido: 10000 }, expect: { limite: 15000, taxa: 0.03, total_a_pagar: 13600, desfecho: "ok" } },
    { name: "score 700 é faixa alta", given: { renda: 3000, score: 700, dividas: [], valor_pedido: 1000 }, expect: { taxa: 0.015 } },
    { name: "dívidas acima de 40% da renda", given: { renda: 5000, score: 800, dividas: [{ parcela: 1500 }, { parcela: 1000 }], valor_pedido: 1000 }, expect: { desfecho: "erro" } },
    { name: "dívidas em exatamente 40%", given: { renda: 5000, score: 800, dividas: [{ parcela: 2000 }], valor_pedido: 1000 }, expect: { desfecho: "ok" } },
    { name: "score baixo", given: { renda: 5000, score: 400, dividas: [], valor_pedido: 1000 }, expect: { desfecho: "erro" } },
    { name: "pedido acima do limite", given: { renda: 3000, score: 800, dividas: [], valor_pedido: 50000 }, expect: { desfecho: "erro" } },
    { name: "renda zerada", given: { renda: 0, score: 800, dividas: [], valor_pedido: 1000 }, expect: { desfecho: "erro" } },
  ],
  doc: build("Concessão de crédito pessoal", "Decide se um pedido de crédito pessoal é aprovado, com que taxa e limite, a partir de renda, score e dívidas.", [
    fact("renda", "Renda mensal", "renda", "dinheiro", "Renda líquida mensal comprovada."),
    fact("score", "Score de crédito", "score", "número", "Pontuação de 0 a 1000."),
    fact("dividas", "Dívidas atuais", "dividas", "lista", "Lista de dívidas; cada uma tem a parcela mensal (parcela)."),
    fact("pedido", "Valor pedido", "valor_pedido", "dinheiro", "Quanto o cliente quer de crédito."),
    fact("comprometido", "Parcelas somadas", "comprometido", "dinheiro", "Soma das parcelas das dívidas atuais, calculada no laço.", 0),
    fact("comprometimento", "Renda comprometida", "comprometimento", "percentual", "Parcelas somadas ÷ renda."),
    fact("taxa", "Taxa ao mês", "taxa", "percentual", "Taxa de juros mensal, definida pelo score."),
    fact("fator", "Fator de renda", "fator", "número", "Quantas rendas o score permite emprestar, antes de descontar as dívidas."),
    fact("limite", "Limite de crédito", "limite", "dinheiro", "Máximo que o cliente pode pegar."),
    fact("total", "Total a pagar", "total_a_pagar", "dinheiro", "Valor pedido mais 12 meses de juros simples."),
    start("inicio", "Analisar pedido de crédito", "Entram renda, score, dívidas e o valor pedido."),
    decision("dados-ok", "Renda e valor pedido são positivos?", "renda > 0 e valor_pedido > 0", "Sem renda ou sem valor não há o que analisar.", [ex("válidos", { renda: 1000, valor_pedido: 500 }, { caminho: "sim" }), ex("renda zero", { renda: 0, valor_pedido: 500 }, { caminho: "nao" })]),
    { op: "add_node", id: "cada-divida", label: "Para cada dívida atual", logic: { role: "loop", foreach: "dividas", as: "divida", text: "Percorre as dívidas para somar as parcelas." } },
    rule("somar", "Somar a parcela da dívida", "Acrescenta a parcela da dívida da vez ao total comprometido.", ["comprometido := comprometido + divida.parcela"], [ex("soma", { comprometido: 100, divida: { parcela: 50 } }, { comprometido: 150 })]),
    rule("calcular-comprometimento", "Calcular a renda comprometida", "Divide as parcelas somadas pela renda.", ["comprometimento := comprometido / renda"], [ex("20%", { comprometido: 1000, renda: 5000 }, { comprometimento: 0.2 })]),
    decision("muito-comprometida", "Mais de 40% da renda comprometida?", "comprometimento > 0.4", "Acima de 40% o cliente não suporta uma nova parcela.", [ex("50%", { comprometimento: 0.5 }, { caminho: "sim" }), ex("40%", { comprometimento: 0.4 }, { caminho: "nao" })]),
    { op: "add_node", id: "faixa-score", label: "Em que faixa está o score?", logic: { role: "switch", text: "700 ou mais: faixa alta. De 500 a 699: faixa média. Abaixo de 500: recusado.", examples: [ex("alto", { score: 750 }, { caminho: "score >= 700" })] } },
    rule("faixa-alta", "Faixa alta: taxa 1,5% e fator 8", "Bom pagador: taxa menor e mais renda emprestável.", ["taxa := 0.015", "fator := 8"], [ex("alta", {}, { taxa: 0.015, fator: 8 })]),
    rule("faixa-media", "Faixa média: taxa 3% e fator 5", "Risco médio: taxa maior e menos renda emprestável.", ["taxa := 0.03", "fator := 5"], [ex("média", {}, { taxa: 0.03, fator: 5 })]),
    rule("limite-calc", "Calcular o limite", "Renda × fator, descontada a parte já comprometida.", ["limite := renda * fator * (1 - comprometimento)"], [ex("limite", { renda: 5000, fator: 8, comprometimento: 0.1 }, { limite: 36000 })]),
    decision("dentro-limite", "O pedido cabe no limite?", "valor_pedido <= limite", "Pedido acima do limite é recusado.", [ex("cabe", { valor_pedido: 100, limite: 200 }, { caminho: "sim" }), ex("estoura", { valor_pedido: 300, limite: 200 }, { caminho: "nao" })]),
    rule("total-calc", "Calcular o total a pagar", "Valor pedido com 12 meses de juros simples.", ["total_a_pagar := valor_pedido * (1 + taxa * 12)"], [ex("total", { valor_pedido: 10000, taxa: 0.015 }, { total_a_pagar: 11800 })]),
    end("aprovado", "Crédito aprovado", "Devolve taxa, limite e total a pagar.", "ok"),
    end("dados-ruins", "Dados insuficientes", "Faltou renda ou valor: não dá para analisar.", "erro"),
    end("renda-alta", "Recusado: renda comprometida", "Parcelas atuais passam de 40% da renda.", "erro"),
    end("score-baixo", "Recusado: score baixo", "Score abaixo de 500.", "erro"),
    end("acima-limite", "Recusado: acima do limite", "O valor pedido passa do limite do cliente.", "erro"),
    scenario("caso-alto", "Bom pagador aprovado", "Renda 5.000, score 750, dívida de 500, pede 10.000: aprovado a 1,5%.", [ex("alto", { renda: 5000, score: 750, dividas: [{ parcela: 500 }], valor_pedido: 10000 }, { limite: 36000, total_a_pagar: 11800, desfecho: "ok" })]),
    scenario("caso-medio", "Risco médio aprovado", "Renda 3.000, score 600, sem dívidas, pede 10.000: aprovado a 3%.", [ex("médio", { renda: 3000, score: 600, dividas: [], valor_pedido: 10000 }, { limite: 15000, total_a_pagar: 13600, desfecho: "ok" })]),
    scenario("caso-dados", "Sem renda", "Renda zero: nem analisa.", [ex("sem renda", { renda: 0, score: 800, dividas: [], valor_pedido: 1000 }, { desfecho: "erro" })]),
    scenario("caso-endividado", "Endividado", "Parcelas de 2.500 numa renda de 5.000: recusado.", [ex("endividado", { renda: 5000, score: 800, dividas: [{ parcela: 1500 }, { parcela: 1000 }], valor_pedido: 1000 }, { desfecho: "erro" })]),
    scenario("caso-score", "Score baixo", "Score 400: recusado.", [ex("score baixo", { renda: 5000, score: 400, dividas: [], valor_pedido: 1000 }, { desfecho: "erro" })]),
    scenario("caso-limite", "Pede mais que o limite", "Renda 3.000, score 800, pede 50.000 (limite 24.000): recusado.", [ex("acima", { renda: 3000, score: 800, dividas: [], valor_pedido: 50000 }, { desfecho: "erro" })]),
    edge("inicio", "dados-ok"),
    edge("dados-ok", "cada-divida", "sim"),
    edge("dados-ok", "dados-ruins", "nao"),
    edge("cada-divida", "somar", "repete"),
    edge("somar", "cada-divida"),
    edge("cada-divida", "calcular-comprometimento", "segue"),
    edge("calcular-comprometimento", "muito-comprometida"),
    edge("muito-comprometida", "renda-alta", "sim"),
    edge("muito-comprometida", "faixa-score", "nao"),
    edge("faixa-score", "faixa-alta", undefined, "score >= 700"),
    edge("faixa-score", "faixa-media", undefined, "score >= 500"),
    edge("faixa-score", "score-baixo", "outros"),
    edge("faixa-alta", "limite-calc"),
    edge("faixa-media", "limite-calc"),
    edge("limite-calc", "dentro-limite"),
    edge("dentro-limite", "total-calc", "sim"),
    edge("dentro-limite", "acima-limite", "nao"),
    edge("total-calc", "aprovado"),
  ]),
});

export const jevCases = (): JevCase[] => [frete(), reembolso(), credito()];
