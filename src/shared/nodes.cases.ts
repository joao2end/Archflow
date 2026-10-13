/**
 * Problemas de referência para o loop dos nós lógicos (ver docs/LOGIC_NODES_LOOP_PROMPT.md).
 *
 * Cada problema é um ALGORITMO ou uma REGRA DE NEGÓCIO escrita em palavras (enunciado) com o ORÁCULO tirado do enunciado.
 * `build()` monta o diagrama IDEAL com os nós que o problema pede. Se o app ainda não tem o nó ou a função, o `build`
 * falha (a op é recusada) e o problema fica BLOQUEADO com a mensagem do próprio motor; quando a capacidade é
 * implementada, ele passa a construir e o oráculo decide se o diagrama representa o problema.
 *
 * Regra do loop: não troque a sintaxe de um problema bloqueado para fazê-lo passar. Implemente a capacidade.
 */
import { emptyDoc, type Doc, type LogicBranch, type LogicExample, type LogicValue } from "./schema";
import { applyOps, type Op } from "./ops";
import type { OracleCase } from "./logiceval";

type V = Record<string, LogicValue>;

export interface NodeCase {
  id: string;
  tipo: "algoritmo" | "regra de negócio";
  /** capacidade que o problema exercita (a coluna da matriz em docs/logic-nodes-score.md) */
  exercita: string;
  enunciado: string;
  oraculo: OracleCase[];
  build: () => Doc;
}

const fact = (id: string, key: string, type: string): Op => ({ op: "add_node", id, label: key, logic: { role: "input", key, type, text: key } });
const start = (id = "inicio"): Op => ({ op: "add_node", id, label: "Início", logic: { role: "start", text: "Entrada" } });
const end = (id = "fim", outcome: "ok" | "erro" = "ok"): Op => ({ op: "add_node", id, label: outcome === "ok" ? "Fim" : "Fim com erro", logic: { role: "end", outcome, text: "Saída" } });
const rule = (id: string, label: string, then: string[]): Op => ({ op: "add_node", id, label, logic: { role: "rule", text: label, then } });
const edge = (from: string, to: string, branch?: LogicBranch, kase?: string): Op => ({ op: "add_connection", from, to, ...(branch || kase ? { logic: branch ? { branch } : { case: kase! } } : {}) });
const o = (name: string, given: V, expect: V): OracleCase => ({ name, given, expect });

function build(title: string, ops: Op[]): Doc {
  const r = applyOps(emptyDoc(title, "logic"), ops);
  const bad = r.results.find((x) => !x.ok);
  if (bad) throw new Error(`${bad.error ?? "op recusada"}`);
  return r.doc;
}

export const nodeCases = (): NodeCase[] => [
  {
    id: "soma-da-lista",
    tipo: "algoritmo",
    exercita: "laço sobre lista + acumulador",
    enunciado: "Dada uma lista de números, devolver a soma deles. Lista vazia soma zero.",
    oraculo: [o("três números", { numeros: [2, 3, 5] }, { soma: 10 }), o("um número", { numeros: [7] }, { soma: 7 }), o("vazia", { numeros: [] }, { soma: 0 }), o("negativos", { numeros: [-1, 1, -4] }, { soma: -4 })],
    build: () =>
      build("Soma da lista", [
        fact("numeros", "numeros", "lista"), fact("soma", "soma", "número"),
        start(), rule("zera", "Começar em zero", ["soma := 0"]),
        { op: "add_node", id: "cada", label: "Para cada número", logic: { role: "loop", foreach: "numeros", as: "n", text: "Percorre a lista" } },
        rule("acumula", "Somar o número", ["soma := soma + n"]), end(),
        edge("inicio", "zera"), edge("zera", "cada"), edge("cada", "acumula", "repete"), edge("acumula", "cada"), edge("cada", "fim", "segue"),
      ]),
  },
  {
    id: "fatorial",
    tipo: "algoritmo",
    exercita: "laço com condição de parada",
    enunciado: "Calcular n! (fatorial) para n inteiro de 0 a 10. 0! vale 1.",
    oraculo: [o("5!", { n: 5 }, { resultado: 120 }), o("0!", { n: 0 }, { resultado: 1 }), o("1!", { n: 1 }, { resultado: 1 }), o("10!", { n: 10 }, { resultado: 3628800 })],
    build: () =>
      build("Fatorial", [
        fact("n", "n", "número"), fact("resultado", "resultado", "número"), fact("i", "i", "número"),
        start(), rule("prepara", "Preparar", ["resultado := 1", "i := 1"]),
        { op: "add_node", id: "volta", label: "Chegou em n?", logic: { role: "loop", until: "i > n", max: 100, text: "Multiplica até passar de n" } },
        rule("multiplica", "Multiplicar", ["resultado := resultado * i", "i := i + 1"]), end(),
        edge("inicio", "prepara"), edge("prepara", "volta"), edge("volta", "multiplica", "repete"), edge("multiplica", "volta"), edge("volta", "fim", "segue"),
      ]),
  },
  {
    id: "fizzbuzz",
    tipo: "algoritmo",
    exercita: "escolha por condições (faixas)",
    enunciado: 'Para um número: múltiplo de 15 devolve "FizzBuzz"; múltiplo de 3, "Fizz"; múltiplo de 5, "Buzz"; senão o próprio número como texto.',
    oraculo: [o("15", { n: 15 }, { saida: "FizzBuzz" }), o("9", { n: 9 }, { saida: "Fizz" }), o("10", { n: 10 }, { saida: "Buzz" }), o("30", { n: 30 }, { saida: "FizzBuzz" }), o("7", { n: 7 }, { saida: "7" })],
    build: () =>
      build("FizzBuzz", [
        fact("n", "n", "número"), fact("saida", "saida", "texto"),
        start(), { op: "add_node", id: "qual", label: "Qual é o múltiplo?", logic: { role: "switch", text: "Primeiro caso que valer" } },
        rule("fb", "FizzBuzz", ['saida := "FizzBuzz"']), rule("f", "Fizz", ['saida := "Fizz"']), rule("b", "Buzz", ['saida := "Buzz"']),
        rule("num", "O próprio número", ["saida := texto(n)"]), end(),
        edge("inicio", "qual"), edge("qual", "fb", undefined, "n % 15 = 0"), edge("qual", "f", undefined, "n % 3 = 0"), edge("qual", "b", undefined, "n % 5 = 0"), edge("qual", "num", "outros"),
        edge("fb", "fim"), edge("f", "fim"), edge("b", "fim"), edge("num", "fim"),
      ]),
  },
  {
    id: "aprovacao-paralela",
    tipo: "regra de negócio",
    exercita: "caminhos paralelos (fork/join)",
    enunciado: "Uma compra é aprovada se o financeiro E o jurídico aprovarem, avaliados em paralelo. Se qualquer um recusar, a compra é recusada.",
    oraculo: [o("ambos aprovam", { financeiro_ok: true, juridico_ok: true }, { aprovada: true, desfecho: "ok" }), o("financeiro recusa", { financeiro_ok: false, juridico_ok: true }, { aprovada: false }), o("jurídico recusa", { financeiro_ok: true, juridico_ok: false }, { aprovada: false }), o("ambos recusam", { financeiro_ok: false, juridico_ok: false }, { aprovada: false })],
    build: () =>
      build("Aprovação paralela", [
        fact("financeiro_ok", "financeiro_ok", "lógico"), fact("juridico_ok", "juridico_ok", "lógico"), fact("aprovada", "aprovada", "lógico"),
        start(), { op: "add_node", id: "para", label: "Avaliar em paralelo", logic: { role: "fork", text: "Financeiro e jurídico" } },
        rule("fin", "Parecer do financeiro", ["fin := financeiro_ok"]), rule("jur", "Parecer do jurídico", ["jur := juridico_ok"]),
        { op: "add_node", id: "junta", label: "Esperar os dois", logic: { role: "join", text: "Os dois pareceres" } },
        rule("decide", "Decidir", ["aprovada := fin e jur"]), end(),
        edge("inicio", "para"), edge("para", "fin"), edge("para", "jur"), edge("fin", "junta"), edge("jur", "junta"), edge("junta", "decide"), edge("decide", "fim"),
      ]),
  },
  {
    id: "soma-dos-precos",
    tipo: "regra de negócio",
    exercita: "funções de lista (soma, filtro, mapa) numa só regra",
    enunciado: "O total do pedido é a soma dos preços dos itens. Quem pede só a soma não deveria precisar desenhar um laço.",
    oraculo: [o("três itens", { precos: [10, 20, 5] }, { total: 35 }), o("vazio", { precos: [] }, { total: 0 }), o("um item", { precos: [99.9] }, { total: 99.9 })],
    build: () => build("Total do pedido", [fact("precos", "precos", "lista"), fact("total", "total", "dinheiro"), start(), rule("soma", "Somar os preços", ["total := soma(precos)"]), end(), edge("inicio", "soma"), edge("soma", "fim")]),
  },
  {
    id: "normalizar-texto",
    tipo: "regra de negócio",
    exercita: "funções de texto (aparar, maiúsculas, junção)",
    enunciado: 'O código do cliente é o nome sem espaços nas pontas, em maiúsculas, com os espaços internos trocados por "-". "  ana souza " vira "ANA-SOUZA".',
    oraculo: [o("com espaços", { nome: "  ana souza " }, { codigo: "ANA-SOUZA" }), o("já normal", { nome: "JOAO" }, { codigo: "JOAO" }), o("três palavras", { nome: "maria da silva" }, { codigo: "MARIA-DA-SILVA" })],
    build: () => build("Código do cliente", [fact("nome", "nome", "texto"), fact("codigo", "codigo", "texto"), start(), rule("normaliza", "Normalizar o nome", ['codigo := trocar(maiusculas(aparar(nome)), " ", "-")']), end(), edge("inicio", "normaliza"), edge("normaliza", "fim")]),
  },
  {
    id: "cobranca-com-falha",
    tipo: "regra de negócio",
    exercita: "caminho de erro / tratamento de falha de um passo",
    enunciado: 'Cobrar o cartão no gateway. Se o gateway falhar, a cobrança fica "pendente" e o cliente é avisado; se funcionar, fica "paga". O fluxo termina bem nos dois casos.',
    oraculo: [o("gateway ok", { gateway_falha: false }, { status: "paga", desfecho: "ok" }), o("gateway falha", { gateway_falha: true }, { status: "pendente", avisado: true, desfecho: "ok" })],
    build: () =>
      build("Cobrança com falha", [
        fact("gateway_falha", "gateway_falha", "lógico"), fact("status", "status", "texto"), fact("avisado", "avisado", "lógico"),
        start(),
        { op: "add_node", id: "cobra", label: "Cobrar no gateway", logic: { role: "call", text: "Chama o gateway de pagamento", falha: "gateway_falha" } } as Op,
        rule("paga", "Marcar como paga", ['status := "paga"']), rule("pendente", "Marcar como pendente", ['status := "pendente"', "avisado := verdadeiro"]), end(),
        edge("inicio", "cobra"), edge("cobra", "paga"), edge("cobra", "pendente", "erro" as LogicBranch), edge("paga", "fim"), edge("pendente", "fim"),
      ]),
  },
  {
    id: "indice-da-lista",
    tipo: "algoritmo",
    exercita: "acesso por posição e por campo em lista de objetos",
    enunciado: "Dada a lista de itens do pedido (cada um com nome e preço), devolver o nome e o preço do primeiro item.",
    oraculo: [o("dois itens", { itens: [{ nome: "caneta", preco: 3 }, { nome: "caderno", preco: 12 }] }, { primeiro_nome: "caneta", primeiro_preco: 3 }), o("um item", { itens: [{ nome: "lápis", preco: 1.5 }] }, { primeiro_nome: "lápis", primeiro_preco: 1.5 })],
    build: () => build("Primeiro item", [fact("itens", "itens", "lista"), start(), rule("pega", "Pegar o primeiro", ["primeiro_nome := itens[0].nome", "primeiro_preco := itens[0].preco"]), end(), edge("inicio", "pega"), edge("pega", "fim")]),
  },
  {
    id: "soma-dos-itens-caros",
    tipo: "regra de negócio",
    exercita: "filtrar e mapear listas de objetos (condição e conta por item)",
    enunciado: "O imposto incide só sobre os itens com preço acima de R$ 10. A base de cálculo é a soma de preço × quantidade desses itens.",
    oraculo: [
      o("um item caro e um barato", { itens: [{ preco: 20, qtd: 2 }, { preco: 5, qtd: 10 }] }, { base: 40 }),
      o("preço igual a 10 não entra", { itens: [{ preco: 10, qtd: 3 }] }, { base: 0 }),
      o("todos caros", { itens: [{ preco: 11, qtd: 1 }, { preco: 30, qtd: 2 }] }, { base: 71 }),
      o("lista vazia", { itens: [] }, { base: 0 }),
    ],
    build: () => build("Base do imposto", [fact("itens", "itens", "{ preco: number; qtd: number }[]"), fact("base", "base", "number"), start(), rule("calcula", "Calcular a base", ["base := soma(mapear(filtrar(itens, preco > 10), preco * qtd))"]), end(), edge("inicio", "calcula"), edge("calcula", "fim")]),
  },
  {
    id: "contar-atrasados",
    tipo: "regra de negócio",
    exercita: "filtrar e contar sem desenhar laço",
    enunciado: "Um pedido está atrasado quando passou de 5 dias sem entrega. Devolver quantos pedidos da lista estão atrasados e se há algum atraso.",
    oraculo: [o("dois atrasados", { pedidos: [{ dias: 2 }, { dias: 6 }, { dias: 9 }] }, { atrasados: 2, ha_atraso: true }), o("exatamente 5 dias não é atraso", { pedidos: [{ dias: 5 }] }, { atrasados: 0, ha_atraso: false }), o("sem pedidos", { pedidos: [] }, { atrasados: 0, ha_atraso: false })],
    build: () => build("Pedidos atrasados", [fact("pedidos", "pedidos", "{ dias: number }[]"), fact("atrasados", "atrasados", "number"), start(), rule("conta", "Contar os atrasados", ["atrasados := tamanho(filtrar(pedidos, dias > 5))", "ha_atraso := atrasados > 0"]), end(), edge("inicio", "conta"), edge("conta", "fim")]),
  },
  {
    id: "prazo-de-devolucao",
    tipo: "regra de negócio",
    exercita: "datas: diferença em dias entre duas datas",
    enunciado: "A devolução é aceita se a compra tem até 30 dias, contados da data da compra até a data do pedido de devolução (inclusive o 30º dia). Datas no formato AAAA-MM-DD.",
    oraculo: [o("22 dias", { compra: "2026-09-20", pedido: "2026-10-12" }, { aceita: true }), o("exatamente 30 dias", { compra: "2026-09-12", pedido: "2026-10-12" }, { aceita: true }), o("31 dias", { compra: "2026-09-11", pedido: "2026-10-12" }, { aceita: false }), o("atravessa o ano", { compra: "2025-12-25", pedido: "2026-01-10" }, { aceita: true }), o("ano bissexto: fevereiro tem 29 dias, então são 31", { compra: "2028-02-01", pedido: "2028-03-03" }, { aceita: false })],
    build: () => build("Prazo de devolução", [fact("compra", "compra", "string"), fact("pedido", "pedido", "string"), fact("aceita", "aceita", "boolean"), start(), rule("confere", "Conferir o prazo", ["aceita := dias_entre(compra, pedido) <= 30"]), end(), edge("inicio", "confere"), edge("confere", "fim")]),
  },
  {
    id: "vencimento-da-fatura",
    tipo: "regra de negócio",
    exercita: "datas: somar dias a uma data",
    enunciado: "A fatura vence 30 dias depois da emissão. Datas no formato AAAA-MM-DD, com meses de tamanhos diferentes e ano novo.",
    oraculo: [o("mesmo mês e ano", { emissao: "2026-01-15" }, { vencimento: "2026-02-14" }), o("vira o ano", { emissao: "2025-12-20" }, { vencimento: "2026-01-19" }), o("fevereiro bissexto", { emissao: "2028-02-10" }, { vencimento: "2028-03-11" }), o("fim de mês", { emissao: "2026-10-31" }, { vencimento: "2026-11-30" })],
    build: () => build("Vencimento da fatura", [fact("emissao", "emissao", "string"), fact("vencimento", "vencimento", "string"), start(), rule("vence", "Calcular o vencimento", ["vencimento := somar_dias(emissao, 30)"]), end(), edge("inicio", "vence"), edge("vence", "fim")]),
  },
  {
    id: "consulta-de-cep",
    tipo: "regra de negócio",
    exercita: "chamada externa que devolve dados quando dá certo",
    enunciado: 'Consultar a cidade de um CEP em um serviço externo. Se o serviço responde, a cidade é a que ele devolveu. Se falha, a cidade fica "desconhecida" e o fluxo continua.',
    oraculo: [o("serviço responde", { servico_falha: false, cidade_do_servico: "Recife" }, { cidade: "Recife", desfecho: "ok" }), o("serviço falha", { servico_falha: true, cidade_do_servico: "Recife" }, { cidade: "desconhecida", desfecho: "ok" })],
    build: () =>
      build("Consulta de CEP", [
        fact("servico_falha", "servico_falha", "boolean"), fact("cidade_do_servico", "cidade_do_servico", "string"), fact("cidade", "cidade", "string"),
        start(),
        { op: "add_node", id: "consulta", label: "Consultar o CEP", logic: { role: "call", text: "Serviço de CEP", falha: "servico_falha", devolve: ["cidade := cidade_do_servico"] } } as Op,
        rule("desconhecida", "Cidade desconhecida", ['cidade := "desconhecida"']), end(),
        edge("inicio", "consulta"), edge("consulta", "fim"), edge("consulta", "desconhecida", "erro" as LogicBranch), edge("desconhecida", "fim"),
      ]),
  },
];

/** Exemplo (para os testes do próprio módulo). */
export const exampleOf = (name: string, given: V, expect: V): LogicExample => ({ name, given, expect });
