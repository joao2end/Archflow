/**
 * Aulas do diagrama lógico: como usar o modo Logic montando o diagrama do zero, do simples ao complexo.
 *
 * A Aula 1 é o tutorial interativo (`logictour.ts`): a pessoa monta a primeira regra na própria interface. As aulas
 * seguintes instalam um diagrama **vazio** e um roteiro de passos. Cada passo traz as peças que ensina (`ops`): ao chegar
 * nele, o painel da aula as acrescenta ao diagrama (com desfazer) e as acende, e o texto diz o que foi criado, como criar
 * igual no app (Biblioteca, Conector, Inspetor) e o que observar. O diagrama cresce passo a passo até a regra completa:
 *  1. Tutorial (simples): Biblioteca, Inspetor, Conector, Início, Entrada, Resultado, Decisão, Ação, Fim, exemplos, cenário,
 *     teste e debug 3D, feitos pela pessoa.
 *  2. Pontos de fidelidade (médio): Loop «para cada», Variável, Tabela de decisão, Escolha (switch), fim com erro e etapas.
 *  3. Aprovação de crédito (complexo): gatilho webhook, Chamada HTTP com resposta simulada e seta «erro», Paralelo e
 *     Junção, travar/destravar, vários fins, etapas e um cenário por caminho.
 *
 * Um teste confere que o diagrama completo valida sem erro (os exemplos e os cenários batem), que montar passo a passo
 * chega ao mesmo diagrama e que toda peça citada existe no passo em que é citada.
 */
import { applyOps, type Op } from "./ops";
import { hasFlow, recordPaths } from "./logic";
import { emptyDoc, type Doc, type LogicBranch, type LogicExample, type LogicValue } from "./schema";
import type { ExampleLevel } from "./examples.catalog";

export interface LogicLessonStep {
  title: string;
  /** a explicação (markdown curto): o que o passo cria, como criar no app e o que observar */
  text: string;
  /** ids das peças (passos, dados ou etapas) que o passo destaca */
  focus: string[];
  /** as peças que o passo acrescenta ao diagrama (ou completa, com `update`); o painel aplica ao chegar no passo */
  ops?: Op[];
}

export interface LogicLesson {
  /** sufixo do id do diagrama e da chave no catálogo (`logic:aula-<id>`) */
  id: string;
  n: number;
  title: string;
  level: ExampleLevel;
  summary: string;
  teaches: string[];
  /** descrição do diagrama (a regra que a aula monta) */
  description: string;
  steps: LogicLessonStep[];
  /** para praticar depois da aula */
  exercises: string[];
}

export const LOGIC_LESSONS_DIR = "exemplos-logic/aulas";
export const logicLessonDocId = (id: string) => `aula-logic-${id}`;
const docTitle = (l: LogicLesson) => `Aula ${l.n} · ${l.title}`;

/* ───────── atalhos para montar os diagramas ───────── */

const ex = (name: string, given: Record<string, LogicValue>, expect: Record<string, LogicValue>): LogicExample => ({ name, given, expect });
const node = (id: string, label: string, logic: Record<string, unknown>): Op => ({ op: "add_node", id, label, logic: logic as never });
/** completa um passo já criado (troca o `logic` inteiro: o patch leva o papel e todos os campos) */
const upd = (id: string, logic: Record<string, unknown>): Op => ({ op: "update", id, patch: { logic } });
const input = (id: string, label: string, key: string, type: string, text: string) => node(id, label, { role: "input", key, type, text });
const output = (id: string, label: string, key: string, type: string, text: string) => node(id, label, { role: "output", key, type, text });
const variable = (id: string, label: string, key: string, type: string, text: string, value?: LogicValue) => node(id, label, { role: "variable", key, type, text, ...(value !== undefined ? { value } : {}) });
const action = (id: string, label: string, text: string, then: string[], examples?: LogicExample[]) => node(id, label, { role: "rule", text, then, ...(examples ? { examples } : {}) });
const decision = (id: string, label: string, text: string, when: string, examples?: LogicExample[]) => node(id, label, { role: "decision", text, when, ...(examples ? { examples } : {}) });
const edge = (from: string, to: string, branch?: LogicBranch, kase?: string): Op => ({ op: "add_connection", from, to, ...(branch || kase ? { logic: branch ? { branch } : { case: kase! } } : {}) });
/** uma etapa e os passos que entram nela */
const stage = (id: string, label: string, text: string, steps: string[]): Op[] => [{ op: "add_group", id, label, stage: { text } }, ...steps.map((s): Op => ({ op: "update", id: s, patch: { parent: id } }))];

/* ═════════════════════════════ Aula 2 · Pontos de fidelidade (médio) ═════════════════════════════ */

const pontos: LogicLesson = {
  id: "02-pontos-de-fidelidade",
  n: 2,
  title: "Pontos de fidelidade",
  level: "intermediário",
  summary: "Montada do zero: um laço sobre as compras, uma tabela de multiplicadores, uma escolha pelo nível, um fim com erro e etapas.",
  teaches: ["Loop «para cada»", "Variável acumulada", "Tabela de decisão", "Escolha (switch) por valor", "fim com erro e etapas"],
  description: "Cada compra dá pontos conforme a categoria; clientes ouro dobram; o total define a faixa do cliente. Cliente bloqueado não pontua.",
  steps: [
    {
      title: "A regra e os dados",
      text:
        "A regra: *cada compra do mês dá pontos conforme a categoria; cliente ouro dobra; o total define a faixa; cliente bloqueado não pontua*.\n\n" +
        "Começamos pelo Início e pelos dados. Além de **entradas** (`compras`, `nivel`) e **resultados** (`total`, `faixa`), aparecem duas **Variáveis**: dados intermediários, criados e reescritos dentro do fluxo. `pontos` nasce com o valor inicial `0`; `mult` será escrita a cada compra.\n\n" +
        "Repare nos **tipos**: `compras` é uma lista de objetos (`{ valor: number; categoria: string }[]`) e `nivel` aceita só quatro textos.",
      focus: ["inicio", "in-compras", "in-nivel", "v-pontos", "v-mult", "out-total", "out-faixa"],
      ops: [
        node("inicio", "Fechar o mês", { role: "start", text: "Fim do mês: calcula os pontos de cada cliente" }),
        input("in-compras", "Compras", "compras", "{ valor: number; categoria: string }[]", "Compras do mês"),
        input("in-nivel", "Nível do cliente", "nivel", '"bronze" | "prata" | "ouro" | "bloqueado"', "Nível no programa de fidelidade"),
        variable("v-pontos", "Pontos", "pontos", "int", "Soma dos pontos, volta a volta", 0),
        variable("v-mult", "Multiplicador", "mult", "number", "Pontos por real da categoria da compra"),
        output("out-total", "Total de pontos", "total", "int", "Pontos do mês"),
        output("out-faixa", "Faixa", "faixa", "string", "comum, ouro, diamante ou bloqueado"),
      ],
    },
    {
      title: "O Loop: uma volta por compra",
      text:
        "Criamos o **Loop** com **para cada** (`foreach: compras`, `as: compra`): uma volta por item, e em cada volta o item fica no dado `compra`.\n\n" +
        "O loop precisa de duas saídas: **repete** (o corpo da volta) e **segue** (quando acabam os itens). A validação avisa que elas faltam: o corpo vem no próximo passo.",
      focus: ["inicio", "l-compras"],
      ops: [node("l-compras", "Para cada compra", { role: "loop", text: "Uma volta por compra do mês", foreach: "compras", as: "compra" }), edge("inicio", "l-compras")],
    },
    {
      title: "A Tabela de decisão e o acumulado",
      text:
        "O corpo da volta: uma **Tabela** dá o multiplicador pela categoria e uma **Ação** soma os pontos da compra: `pontos := pontos + piso(compra.valor * mult)`.\n\n" +
        "A tabela tem linhas em ordem; vale a **primeira** verdadeira, e o **senão** cobre o resto. Use-a sempre que cada caminho só **atribui um valor**: a regra inteira cabe numa grade.\n\n" +
        "A seta **repete** sai do loop para a tabela, e a ação volta ao loop: é assim que se fecha uma volta.",
      focus: ["l-compras", "t-mult", "a-somar", "v-pontos", "v-mult"],
      ops: [
        node("t-mult", "Pontos por real", {
          role: "table",
          text: "Quanto cada categoria rende por real gasto",
          rows: [
            { label: "Farmácia", when: 'compra.categoria = "farmacia"', then: ["mult := 2"] },
            { label: "Mercado e padaria", when: 'compra.categoria em ["mercado", "padaria"]', then: ["mult := 1.5"] },
          ],
          otherwise: ["mult := 1"],
          examples: [ex("farmácia", { compra: { valor: 10, categoria: "farmacia" } }, { mult: 2 }), ex("padaria", { compra: { valor: 10, categoria: "padaria" } }, { mult: 1.5 }), ex("roupa", { compra: { valor: 10, categoria: "roupa" } }, { mult: 1 })],
        }),
        action("a-somar", "Somar a compra", "Pontos da compra, sem fração, entram no acumulado", ["pontos := pontos + piso(compra.valor * mult)"], [ex("50 × 1,5", { pontos: 10, compra: { valor: 50, categoria: "mercado" }, mult: 1.5 }, { pontos: 85 })]),
        edge("l-compras", "t-mult", "repete"),
        edge("t-mult", "a-somar"),
        edge("a-somar", "l-compras"),
      ],
    },
    {
      title: "A Escolha: caminhos diferentes por nível",
      text:
        "Quando as compras acabam, a seta **segue** leva a uma **Escolha** (`switch`) pelo `nivel`. Ela serve quando os caminhos **fazem coisas diferentes**: ouro dobra os pontos; bloqueado não pontua e sai por um **Fim com erro**; o resto segue direto.\n\n" +
        "Cada seta da escolha tem um **caso** (`\"ouro\"`, `\"bloqueado\"`), preenchido no Inspetor da seta, e sempre há uma seta **outros**. Ela vem no próximo passo.\n\n" +
        "O Fim com desfecho **erro** é um caminho de negócio previsto, não um defeito.",
      focus: ["sw-nivel", "a-dobrar", "a-bloquear", "fim-bloqueado"],
      ops: [
        node("sw-nivel", "Qual o nível?", {
          role: "switch",
          text: "Cada nível segue um caminho",
          on: "nivel",
          examples: [ex("ouro", { nivel: "ouro" }, { caminho: "ouro" }), ex("bloqueado", { nivel: "bloqueado" }, { caminho: "bloqueado" }), ex("prata", { nivel: "prata" }, { caminho: "outros" })],
        }),
        action("a-dobrar", "Dobrar pontos", "Cliente ouro ganha o dobro", ["pontos := pontos * 2"], [ex("dobra", { pontos: 300 }, { pontos: 600 })]),
        action("a-bloquear", "Não pontuar", "Cliente bloqueado não acumula pontos", ["total := 0", 'faixa := "bloqueado"'], [ex("zera", {}, { total: 0, faixa: "bloqueado" })]),
        node("fim-bloqueado", "Cliente bloqueado", { role: "end", outcome: "erro", text: "Não lança pontos" }),
        edge("l-compras", "sw-nivel", "segue"),
        edge("sw-nivel", "a-dobrar", undefined, '"ouro"'),
        edge("sw-nivel", "a-bloquear", undefined, '"bloqueado"'),
        edge("a-bloquear", "fim-bloqueado"),
      ],
    },
    {
      title: "Classificar e fechar",
      text:
        "Mais uma **Tabela**, agora pela faixa: `>= 1000` diamante, `>= 300` ouro, senão comum. A **ordem importa**: a linha de 1000 vem antes da de 300.\n\n" +
        "Ligamos a seta **outros** da escolha e a saída de *Dobrar pontos* à tabela; depois, `total := pontos` e o **Fim**. O fluxo está completo e a validação fica limpa.",
      focus: ["t-faixa", "a-fechar", "fim", "sw-nivel"],
      ops: [
        node("t-faixa", "Faixa do cliente", {
          role: "table",
          text: "A faixa pelo total de pontos",
          rows: [
            { label: "1000 ou mais", when: "pontos >= 1000", then: ['faixa := "diamante"'] },
            { label: "300 ou mais", when: "pontos >= 300", then: ['faixa := "ouro"'] },
          ],
          otherwise: ['faixa := "comum"'],
          examples: [ex("1200", { pontos: 1200 }, { faixa: "diamante" }), ex("300", { pontos: 300 }, { faixa: "ouro" }), ex("299", { pontos: 299 }, { faixa: "comum" })],
        }),
        action("a-fechar", "Fechar o total", "O total do mês é o acumulado", ["total := pontos"], [ex("copia", { pontos: 305 }, { total: 305 })]),
        node("fim", "Pontos lançados", { role: "end", outcome: "ok" }),
        edge("sw-nivel", "t-faixa", "outros"),
        edge("a-dobrar", "t-faixa"),
        edge("t-faixa", "a-fechar"),
        edge("a-fechar", "fim"),
      ],
    },
    {
      title: "Etapas: organizar o que cresceu",
      text:
        "Com quase dez passos, o fluxo se lê melhor em **etapas**: trechos com um objetivo (*Somar pontos*, *Aplicar o nível*, *Classificar*). Cada etapa tem uma entrada e poucos passos.\n\n" +
        "No app: selecione os passos e use **Criar etapa com a seleção** na barra de baixo. O botão **Visão geral** recolhe as etapas em cartões-resumo: o que cada uma lê, escreve e quantos passos tem.",
      focus: ["st-somar", "st-nivel", "st-faixa"],
      ops: [
        ...stage("st-somar", "Somar pontos", "Percorre as compras e soma os pontos de cada uma pela categoria", ["l-compras", "t-mult", "a-somar"]),
        ...stage("st-nivel", "Aplicar o nível", "Bloqueado não pontua; ouro dobra os pontos", ["sw-nivel", "a-dobrar", "a-bloquear"]),
        ...stage("st-faixa", "Classificar", "A faixa sai do total de pontos", ["t-faixa", "a-fechar"]),
      ],
    },
    {
      title: "Cenários: um por caminho",
      text:
        "Bons cenários **cobrem os caminhos**: um cliente bronze (três voltas na tabela), um ouro (dobra), um sem compras (zero voltas) e um bloqueado (fim com erro).\n\n" +
        "Abra **Cenários e visão geral** na barra de baixo para ver cada cenário numa linha: o que entra, o que sai e por onde passa. Uma seta pela qual nenhum cenário passa é um caminho sem teste. No 3D, teste o cliente bronze e acompanhe as voltas do loop.",
      focus: ["sc-pontos"],
      ops: [
        node("sc-pontos", "Clientes de exemplo", {
          role: "scenario",
          text: "Um cliente por caminho: bronze, ouro, sem compras e bloqueado",
          examples: [
            ex("bronze com três compras", { nivel: "bronze", compras: [{ valor: 100, categoria: "farmacia" }, { valor: 50, categoria: "mercado" }, { valor: 30, categoria: "roupa" }] }, { total: 305, faixa: "ouro", desfecho: "ok" }),
            ex("ouro dobra e vira diamante", { nivel: "ouro", compras: [{ valor: 300, categoria: "farmacia" }] }, { total: 1200, faixa: "diamante", desfecho: "ok" }),
            ex("sem compras", { nivel: "prata", compras: [] }, { total: 0, faixa: "comum", desfecho: "ok" }),
            ex("bloqueado", { nivel: "bloqueado", compras: [{ valor: 100, categoria: "farmacia" }] }, { total: 0, faixa: "bloqueado", desfecho: "erro" }),
          ],
        }),
      ],
    },
  ],
  exercises: [
    "Acrescente a categoria «combustível» rendendo 0,5 ponto por real. Em qual linha da tabela ela entra e por quê?",
    "Crie o nível «prata» com 50% a mais de pontos: um caso novo na escolha e uma ação. Escreva um cenário que passe por ele.",
    "Faça um cenário com uma compra de R$ 0,99 em farmácia. Quantos pontos dá? Que função garante isso?",
  ],
};

/* ═════════════════════════════ Aula 3 · Aprovação de crédito (complexo) ═════════════════════════════ */

const credito: LogicLesson = {
  id: "03-aprovacao-de-credito",
  n: 3,
  title: "Aprovação de crédito",
  level: "avançado",
  summary: "Um fluxo de verdade, montado do zero: webhook, chamada HTTP com falha, caminhos paralelos, trava de status, etapas e um cenário por desfecho.",
  teaches: ["gatilho webhook", "Chamada HTTP, resposta simulada e seta «erro»", "Paralelo e Junção", "travar e destravar", "vários fins, etapas e cenários por caminho"],
  description: "Valida o pedido, consulta o score num bureau, calcula taxa e limite em paralelo e decide: aprovado, em revisão ou recusado.",
  steps: [
    {
      title: "O gatilho e os dados",
      text:
        "A regra: *valida o pedido, consulta o score do CPF num bureau, calcula taxa e limite e decide entre aprovado, em revisão ou recusado*.\n\n" +
        "Começamos pelo **Início** com gatilho **webhook** (`POST /credito`): o corpo JSON do pedido vira as entradas. Os outros gatilhos são **manual** e **agenda** (cron), escolhidos no Inspetor do Início.\n\n" +
        "Criamos também as **entradas** do pedido e os **resultados** (`status` e `motivo`).",
      focus: ["inicio", "in-cpf", "in-renda", "in-valor", "in-parcelas", "in-negativado", "out-status", "out-motivo"],
      ops: [
        node("inicio", "Pedido de crédito", { role: "start", text: "O app do banco envia o pedido", trigger: { kind: "webhook", method: "POST", path: "/credito" } }),
        input("in-cpf", "CPF", "cpf", "string", "CPF do cliente, só números"),
        input("in-renda", "Renda", "renda", "number", "Renda mensal comprovada"),
        input("in-valor", "Valor pedido", "valor", "number", "Quanto o cliente quer emprestado"),
        input("in-parcelas", "Parcelas", "parcelas", "int", "Prazo em meses: 6, 12 ou 24"),
        input("in-negativado", "Negativado", "negativado", "boolean", "O cadastro interno tem restrição para o CPF"),
        output("out-status", "Status", "status", '"aprovado" | "revisao" | "recusado"', "A decisão"),
        output("out-motivo", "Motivo", "motivo", "string", "Por que não foi aprovado"),
      ],
    },
    {
      title: "Validar antes de gastar",
      text:
        "A primeira **Decisão** barra o que não pode seguir: `valor > 0 e parcelas em [6, 12, 24]`. Pedido inválido é recusado e sai por um **Fim com erro**.\n\n" +
        "Validar cedo evita chamar o bureau (que custa) com um pedido que seria recusado de qualquer jeito. No debug do 3D a condição aparece em TypeScript: `valor > 0 && [6, 12, 24].includes(parcelas)`, com ✔ ou ✘ em cada parte.",
      focus: ["d-valido", "a-invalido", "fim-recusado"],
      ops: [
        decision("d-valido", "Pedido válido?", "Valor positivo e prazo de 6, 12 ou 24 meses?", "valor > 0 e parcelas em [6, 12, 24]", [ex("ok", { valor: 1000, parcelas: 12 }, { caminho: "sim" }), ex("prazo 7", { valor: 1000, parcelas: 7 }, { caminho: "nao" }), ex("valor zero", { valor: 0, parcelas: 12 }, { caminho: "nao" })]),
        action("a-invalido", "Recusar pedido inválido", "Fora das regras do produto", ['status := "recusado"', 'motivo := "valor ou prazo inválido"'], [ex("recusa", {}, { status: "recusado" })]),
        node("fim-recusado", "Recusado", { role: "end", outcome: "erro" }),
        edge("inicio", "d-valido"),
        edge("d-valido", "a-invalido", "nao"),
        edge("a-invalido", "fim-recusado"),
      ],
    },
    {
      title: "Chamada HTTP: o que está fora",
      text:
        "Pedido válido segue (**sim**) para uma **Chamada** (`call`) com `request`: no código gerado, uma requisição de verdade. Método, endereço e cabeçalhos são **expressões** (texto fixo leva aspas). A credencial vem de `segredo(\"BUREAU_TOKEN\")`: o valor nunca fica no diagrama.\n\n" +
        "O app não acessa a rede: os exemplos usam o **mock** (a resposta simulada, aqui `{ score: 720 }`). O **devolve** copia da resposta o que o fluxo precisa, `score := resposta.score`, numa **Variável**.",
      focus: ["d-valido", "c-bureau", "v-score"],
      ops: [
        variable("v-score", "Score", "score", "int", "Score do bureau, de 0 a 1000"),
        node("c-bureau", "Consultar score", {
          role: "call",
          text: "Pergunta o score do CPF ao bureau de crédito",
          request: { method: "GET", url: '"https://bureau.exemplo.com/score/" + cpf', headers: { Authorization: '"Bearer " + segredo("BUREAU_TOKEN")' } },
          mock: { score: 720 },
          falha: 'cpf = "00000000000"',
          devolve: ["score := resposta.score"],
        }),
        edge("d-valido", "c-bureau", "sim"),
      ],
    },
    {
      title: "Quando a chamada falha: a seta «erro»",
      text:
        "Toda chamada pode falhar. A **falha simulada** (`cpf = \"00000000000\"`) faz o exemplo seguir pela seta **erro**, para testar esse caminho sem derrubar nada de verdade. Aqui, sem score, o pedido vai para **revisão manual**: outro Fim, com desfecho ok.\n\n" +
        "No app: ligue uma segunda seta saindo da chamada; ela nasce como **erro**. No código gerado, resposta fora de 2xx ou sem rede segue pela mesma seta.",
      focus: ["c-bureau", "a-sem-bureau", "fim-revisao"],
      ops: [
        action("a-sem-bureau", "Mandar para revisão", "Sem score, um analista decide", ['status := "revisao"', 'motivo := "bureau indisponível"'], [ex("revisão", {}, { status: "revisao" })]),
        node("fim-revisao", "Revisão manual", { role: "end", outcome: "ok", text: "Fila do analista" }),
        edge("c-bureau", "a-sem-bureau", "erro"),
        edge("a-sem-bureau", "fim-revisao"),
      ],
    },
    {
      title: "Paralelo e Junção",
      text:
        "Taxa (pelo score, numa **Tabela**) e limite (30% da renda) **não dependem um do outro**: o **Paralelo** (`fork`) abre um ramo para cada e a **Junção** (`join`) espera os dois. Depois dela, a parcela, que usa os dois.\n\n" +
        "A regra dos ramos: um não escreve o que o outro lê ou escreve; o app avisa (L027) se isso acontecer. Taxa, limite e parcela são **Variáveis**: intermediárias, não o resultado.",
      focus: ["c-bureau", "f-calc", "t-taxa", "a-limite", "j-calc", "a-parcela"],
      ops: [
        variable("v-taxa", "Taxa ao mês", "taxa", "number", "Juros simples ao mês"),
        variable("v-limite", "Limite da parcela", "limite", "number", "Até 30% da renda"),
        variable("v-parcela", "Parcela", "parcela", "number", "Valor de cada parcela"),
        node("f-calc", "Taxa e limite", { role: "fork", text: "A taxa e o limite não dependem um do outro" }),
        node("t-taxa", "Taxa pelo score", {
          role: "table",
          text: "Quanto melhor o score, menor a taxa",
          rows: [
            { label: "800 ou mais", when: "score >= 800", then: ["taxa := 1.5%"] },
            { label: "650 a 799", when: "score >= 650", then: ["taxa := 2.5%"] },
          ],
          otherwise: ["taxa := 4%"],
          examples: [ex("850", { score: 850 }, { taxa: 0.015 }), ex("720", { score: 720 }, { taxa: 0.025 }), ex("500", { score: 500 }, { taxa: 0.04 })],
        }),
        action("a-limite", "Limite da parcela", "A parcela não passa de 30% da renda", ["limite := arredondar(renda * 30%, 2)"], [ex("30% de 5000", { renda: 5000 }, { limite: 1500 })]),
        node("j-calc", "Juntar", { role: "join" }),
        action("a-parcela", "Calcular a parcela", "Juros simples sobre o valor, dividido pelo prazo", ["parcela := arredondar(valor * (1 + taxa * parcelas) / parcelas, 2)"], [ex("6000 em 12x a 2,5%", { valor: 6000, taxa: 0.025, parcelas: 12 }, { parcela: 650 })]),
        edge("c-bureau", "f-calc"),
        edge("f-calc", "t-taxa"),
        edge("f-calc", "a-limite"),
        edge("t-taxa", "j-calc"),
        edge("a-limite", "j-calc"),
        edge("j-calc", "a-parcela"),
      ],
    },
    {
      title: "Travar: um valor que nada adiante muda",
      text:
        "A decisão final: cliente **negativado** vai para revisão, **mesmo que a parcela caiba**. Em vez de outra decisão no fim, a ação usa `travar status` e `travar motivo`: daí em diante, `status := \"aprovado\"` **não muda o valor** (o debug mostra a escrita barrada).\n\n" +
        "Depois, `parcela <= limite` decide: cabe → **Aprovar** e o Fim *Decidido*; não cabe → **Recusar**, que vence tudo: começa destravando os dois. Travar e destravar deixam a prioridade explícita no próprio passo.",
      focus: ["d-negativado", "a-revisao", "d-cabe", "a-aprovar", "a-recusar", "fim-ok"],
      ops: [
        decision("d-negativado", "Negativado?", "O cadastro interno tem restrição?", "negativado", [ex("sim", { negativado: true }, { caminho: "sim" }), ex("não", { negativado: false }, { caminho: "nao" })]),
        action("a-revisao", "Prender em revisão", "Com restrição, o status fica em revisão: nada adiante o muda", ['status := "revisao"', 'motivo := "restrição no cadastro"', "travar status", "travar motivo"], [ex("trava", {}, { status: "revisao" })]),
        decision("d-cabe", "A parcela cabe?", "A parcela fica dentro do limite?", "parcela <= limite", [ex("cabe", { parcela: 650, limite: 1500 }, { caminho: "sim" }), ex("não cabe", { parcela: 650, limite: 450 }, { caminho: "nao" })]),
        action("a-aprovar", "Aprovar", "Tenta aprovar (se o status estiver travado em revisão, continua revisão)", ['status := "aprovado"', 'motivo := ""'], [ex("aprova", {}, { status: "aprovado" })]),
        action("a-recusar", "Recusar", "Parcela acima do limite recusa, mesmo em revisão", ["destravar status", "destravar motivo", 'status := "recusado"', 'motivo := "parcela acima de 30% da renda"'], [ex("recusa", {}, { status: "recusado" })]),
        node("fim-ok", "Decidido", { role: "end", outcome: "ok", text: "Aprovado ou em revisão" }),
        edge("a-parcela", "d-negativado"),
        edge("d-negativado", "a-revisao", "sim"),
        edge("d-negativado", "d-cabe", "nao"),
        edge("a-revisao", "d-cabe"),
        edge("d-cabe", "a-aprovar", "sim"),
        edge("d-cabe", "a-recusar", "nao"),
        edge("a-aprovar", "fim-ok"),
        edge("a-recusar", "fim-recusado"),
      ],
    },
    {
      title: "Quatro etapas, uma visão geral",
      text:
        "Com quase vinte passos, o fluxo se lê pelas **etapas**: validar, consultar, calcular e decidir. Use **Visão geral** na barra de baixo para recolhê-las e ver só o roteiro; abra a etapa que interessa com dois cliques.",
      focus: ["st-validar", "st-consultar", "st-calcular", "st-decidir"],
      ops: [
        ...stage("st-validar", "Validar o pedido", "Recusa valor ou prazo fora do permitido", ["d-valido", "a-invalido"]),
        ...stage("st-consultar", "Consultar o bureau", "Busca o score do CPF; sem resposta, o pedido vai para revisão", ["c-bureau", "a-sem-bureau"]),
        ...stage("st-calcular", "Taxa e limite", "Taxa pelo score e limite pela renda, ao mesmo tempo; depois a parcela", ["f-calc", "t-taxa", "a-limite", "j-calc", "a-parcela"]),
        ...stage("st-decidir", "Decidir", "Negativado fica em revisão; a parcela cabendo no limite, aprova", ["d-negativado", "a-revisao", "d-cabe", "a-aprovar", "a-recusar"]),
      ],
    },
    {
      title: "Um cenário por desfecho",
      text:
        "Três fins: **Decidido** e **Revisão manual** (ok) e **Recusado** (erro). Os cinco exemplos do cenário passam por todos os caminhos, inclusive o da falha do bureau e o da trava.\n\n" +
        "Teste no **3D**: escolha um pedido em **Testar** e ande com ← →. O cartão de cada passo mostra a condição, o cálculo, o que leu e o que mudou.\n\n" +
        "Para levar ao código: peça ao assistente pelo MCP do Archflow (`generate_code`). Sai um TypeScript executável com `run(input)`, o `handler` do webhook, o `fetch` do bureau e **um teste por exemplo do cenário**.",
      focus: ["sc-credito", "fim-ok", "fim-revisao", "fim-recusado"],
      ops: [
        node("sc-credito", "Pedidos de exemplo", {
          role: "scenario",
          text: "Um pedido por desfecho",
          examples: [
            ex("aprovado", { cpf: "12345678900", renda: 5000, valor: 6000, parcelas: 12, negativado: false }, { parcela: 650, status: "aprovado", desfecho: "ok" }),
            ex("negativado fica em revisão", { cpf: "12345678900", renda: 5000, valor: 6000, parcelas: 12, negativado: true }, { status: "revisao", motivo: "restrição no cadastro", desfecho: "ok" }),
            ex("parcela não cabe", { cpf: "12345678900", renda: 1500, valor: 6000, parcelas: 12, negativado: false }, { status: "recusado", desfecho: "erro" }),
            ex("prazo inválido", { cpf: "12345678900", renda: 5000, valor: 6000, parcelas: 7, negativado: false }, { status: "recusado", motivo: "valor ou prazo inválido", desfecho: "erro" }),
            ex("bureau fora do ar", { cpf: "00000000000", renda: 5000, valor: 6000, parcelas: 12, negativado: false }, { status: "revisao", motivo: "bureau indisponível", desfecho: "ok" }),
          ],
        }),
      ],
    },
  ],
  exercises: [
    "O bureau também devolve `restricoes` (número). Leia o campo no `devolve`, ajuste o mock e mande para revisão quem tiver alguma restrição, com um cenário novo.",
    "Troque os juros simples por uma tabela de prazos: 6x a taxa da tabela, 12x mais 0,5% e 24x mais 1%. Onde entra a tabela nova: dentro do paralelo ou depois da junção?",
    "Crie o desfecho «aprovado com valor menor»: se a parcela não couber, ofereça o maior valor cuja parcela cabe no limite, em vez de recusar.",
  ],
};

export const LOGIC_LESSONS: LogicLesson[] = [pontos, credito];

/* ───────── a Aula 1 é o tutorial interativo (`logictour.ts`): a pessoa monta o diagrama na interface ───────── */

export const LOGIC_TOUR_KEY = "logic:aula-tutorial";
export const LOGIC_TOUR_DOC_ID = logicLessonDocId("tutorial");
export const logicTourPath = `${LOGIC_LESSONS_DIR}/aula-1-seu-primeiro-diagrama-logico.archflow.json`;
/** O diagrama com que o tutorial começa: vazio, no modo Logic. */
export function logicTourStart(): Doc {
  const doc = emptyDoc("Aula 1 · Seu primeiro diagrama lógico", "logic");
  doc.id = LOGIC_TOUR_DOC_ID;
  doc.description = "Compras a partir de R$ 200 não pagam frete; abaixo disso o frete é R$ 25.";
  return doc;
}

export const logicLessonPath = (l: LogicLesson) => `${LOGIC_LESSONS_DIR}/aula-${l.n}-${l.id.replace(/^\d+-/, "")}.archflow.json`;
export const logicLessonOfDoc = (docId: string) => LOGIC_LESSONS.find((l) => logicLessonDocId(l.id) === docId);

/* ───────── montar passo a passo ───────── */

/** O diagrama com que a aula começa: vazio, só com o título e a regra na descrição. */
export function logicLessonStart(l: LogicLesson): Doc {
  const doc = emptyDoc(docTitle(l), "logic");
  doc.id = logicLessonDocId(l.id);
  doc.description = l.description;
  return doc;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** A peça (ou a mudança) desta op já está no diagrama? Peças pelo id; setas pelo par e pela saída; `update` pelos campos do patch. */
export function opDone(doc: Doc, op: Op): boolean {
  switch (op.op) {
    case "add_node":
      return doc.nodes.some((n) => n.id === op.id);
    case "add_group":
      return doc.groups.some((g) => g.id === op.id);
    case "add_connection": {
      const want = (op as { logic?: { branch?: string; case?: string } }).logic;
      return doc.connections.some((c) => c.from === op.from && c.to === op.to && (c.logic?.branch ?? undefined) === want?.branch && (c.logic?.case ?? undefined) === want?.case);
    }
    case "update": {
      const el = [...doc.nodes, ...doc.groups, ...doc.connections].find((e) => e.id === op.id) as Record<string, unknown> | undefined;
      if (!el) return false;
      return Object.entries(op.patch).every(([k, v]) => (k === "logic" && v && typeof v === "object" ? Object.entries(v).every(([f, x]) => same((el.logic as Record<string, unknown> | undefined)?.[f], x)) : same(el[k], v)));
    }
    default:
      return true;
  }
}

/** Até que passo (índice) o diagrama já está montado, contando do começo: −1 se nem o primeiro passo com peças está. */
export function builtUpTo(doc: Doc, steps: LogicLessonStep[]): number {
  let at = -1;
  for (const [i, s] of steps.entries()) {
    if (!(s.ops ?? []).every((op) => opDone(doc, op))) break;
    at = i;
  }
  return at;
}

/**
 * As ops que faltam para montar os passos `from`..`to` (o que já existe fica de fora), mais a arrumação do fluxo. Enquanto
 * o fluxo ainda não tem setas, a arrumação é a genérica: a do modo logic liga sozinha Início → Fim quando não há setas,
 * e a aula ainda não chegou na parte de ligar.
 */
export function opsToBuild(doc: Doc, steps: LogicLessonStep[], from: number, to: number): Op[] {
  const ops = steps.slice(Math.max(0, from), to + 1).flatMap((s) => s.ops ?? []).filter((op) => !opDone(doc, op));
  if (!ops.length) return [];
  const wired = hasFlow(applyOps(doc, ops).doc);
  return [...ops, wired ? { op: "layout" } : { op: "layout", style: "flow", direction: "TB" }];
}

/** O diagrama completo da aula (todos os passos montados), com o caminho de cada cenário gravado. */
export function logicLessonDoc(l: LogicLesson): Doc {
  const start = logicLessonStart(l);
  const r = applyOps(start, opsToBuild(start, l.steps, 0, l.steps.length - 1));
  const bad = r.results.filter((x) => !x.ok);
  if (bad.length) throw new Error(`aula de lógica «${l.title}» inválida: ${JSON.stringify(bad)}`);
  return recordPaths(r.doc);
}
