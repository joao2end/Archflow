/**
 * Exemplo do modo Logic: a engine de precificação como fluxograma.
 *
 * Para cada produto do grupo (maior receita primeiro; o primeiro é a referência) o fluxo carrega o produto, escolhe o preço de
 * partida pelo tipo do grupo e passa por onze regras em ordem; cada regra pode reescrever o preço da anterior. Os desvios são
 * decisões sim/não, o "para cada produto" é um laço e um tipo de grupo desconhecido termina em erro.
 *
 * Os números dos exemplos são ilustrativos; as interpretações que o texto original deixa em aberto estão marcadas como
 * "A confirmar" na descrição das regras.
 */
import { emptyDoc, type Doc, type LogicBranch, type LogicExample, type LogicValue } from "./schema";
import { applyOps, describe, type Op } from "./ops";
import { recordPaths } from "./logic";

export const LOGIC_EXAMPLE_PATH = "exemplos-logic/precificacao.archflow.json";

const fact = (id: string, label: string, key: string, type: string, text: string, value?: LogicValue): Op => ({ op: "add_node", id, label, logic: { role: "fact", key, type, text, ...(value !== undefined ? { value } : {}) } });
const ex = (name: string, given: Record<string, LogicValue>, expect: Record<string, LogicValue>): LogicExample => ({ name, given, expect });
const rule = (id: string, label: string, text: string, then: string[], examples: LogicExample[], description?: string): Op => ({ op: "add_node", id, label, ...(description ? { description } : {}), logic: { role: "rule", text, then, examples } });
const decision = (id: string, label: string, when: string, text: string, examples: LogicExample[]): Op => ({ op: "add_node", id, label, logic: { role: "decision", when, text, examples } });
const edge = (from: string, to: string, branch?: LogicBranch, kase?: string): Op => ({ op: "add_connection", from, to, ...(branch || kase ? { logic: branch ? { branch } : { case: kase! } } : {}) });

/** Um produto do grupo, com os valores padrão de um produto de lucro que é a referência. */
const P = (o: Record<string, LogicValue> = {}): Record<string, LogicValue> => ({
  tipo_grupo: "lucro", custo: 60, margem_objetivo: 0.4, preco_concorrente: 0, indice_notabilidade: 1, margem_minima: 0.3, preco_atual: 90,
  grupo_remarcacao: false, pmc: 0, ancora: false, eh_referencia: true, preco_fixo: 0, ...o,
});
const FIELDS = ["tipo_grupo", "custo", "margem_objetivo", "preco_concorrente", "indice_notabilidade", "margem_minima", "preco_atual", "grupo_remarcacao", "pmc", "ancora", "eh_referencia", "preco_fixo"];

const OPS: Op[] = [
  // ── dados ─────────────────────────────────────────────────────────────
  fact("grupo", "Produtos do grupo", "grupo", "lista", "Os produtos do grupo, da maior receita de 1 mês para a menor (empate: maior custo). O primeiro é a referência."),
  fact("tipo-grupo", "Tipo do grupo", "tipo_grupo", "texto", 'Estratégia do produto: "lucro", "imagem" ou "trafego".'),
  fact("custo", "Custo", "custo", "dinheiro", "Custo do produto."),
  fact("margem-objetivo", "Margem objetivo", "margem_objetivo", "percentual", "Margem objetivo da categoria (herdada da árvore divisão → departamento → categoria)."),
  fact("preco-concorrente", "Preço do concorrente", "preco_concorrente", "dinheiro", "Preço de referência do concorrente (mínimo, médio ou máximo, conforme a configuração)."),
  fact("indice-notabilidade", "Índice da notabilidade", "indice_notabilidade", "número", "Multiplica o preço do concorrente em imagem e tráfego."),
  fact("margem-minima", "Margem mínima", "margem_minima", "percentual", "Margem mínima da notabilidade (piso de imagem e tráfego)."),
  fact("preco-atual", "Preço atual", "preco_atual", "dinheiro", "Preço praticado hoje."),
  fact("variacao-minima", "Variação mínima", "variacao_minima", "percentual", "Diferença abaixo da qual o preço atual é mantido.", 0.02),
  fact("aumento-maximo", "Aumento máximo", "aumento_maximo", "percentual", "Teto de aumento sobre o preço atual.", 0.2),
  fact("reducao-maxima", "Redução máxima", "reducao_maxima", "percentual", "Piso de redução sobre o preço atual.", 0.2),
  fact("grupo-remarcacao", "Grupo de remarcação", "grupo_remarcacao", "lógico", "O produto está num grupo de remarcação (vale o menor PMC)."),
  fact("pmc", "Menor PMC do grupo", "pmc", "dinheiro", "Menor preço máximo ao consumidor do grupo de remarcação (0 = sem PMC)."),
  fact("ancora", "Âncora no preço atual", "ancora", "lógico", "PBM, farmácia popular ou marca própria."),
  fact("eh-referencia", "É a referência do grupo", "eh_referencia", "lógico", "Primeiro do grupo no cluster."),
  fact("preco-referencia-grupo", "Preço da referência do grupo", "preco_referencia_grupo", "dinheiro", "Preço final já calculado da referência do grupo."),
  fact("preco-fixo", "Preço fixo", "preco_fixo", "dinheiro", "Preço fixo cadastrado; vale quando maior que zero."),
  fact("reaplicar", "Reaplicar ajustes", "reaplicar_ajustes", "lógico", "Restaura o preço digitado gravado, sem propagar de novo.", false),
  fact("preco-digitado", "Preço digitado", "preco_digitado", "dinheiro", "Preço digitado pelo usuário e gravado.", 0),
  fact("preco", "Preço", "preco", "dinheiro", "O preço que o fluxo vai calculando: cada regra pode reescrevê-lo."),
  fact("recomendacao", "Recomendação", "recomendacao", "texto", 'Resultado: "keep", "raise" ou "reduce".'),
  fact("alerta", "Alerta pendente", "alerta_pendente", "lógico", "Há alerta pendente quando o preço muda."),

  // ── fluxo ─────────────────────────────────────────────────────────────
  { op: "add_node", id: "inicio", label: "Calcular preços do grupo", logic: { role: "start", text: "Entra o grupo de produtos de um cluster, com as configurações de margem, variação e PMC." } },
  { op: "add_node", id: "para-cada-produto", label: "Para cada produto do grupo", logic: { role: "loop", foreach: "grupo", as: "produto", text: "Da maior receita para a menor; o primeiro é a referência." } },
  rule("carregar", "Carregar o produto", "Copia os dados do produto da vez e solta qualquer trava do produto anterior.", ["destravar preco", ...FIELDS.map((f) => `${f} := produto.${f}`)],
    [ex("copia os dados", { produto: P({ custo: 33, ancora: true }) }, { custo: 33, ancora: true, tipo_grupo: "lucro" })]),
  decision("custo-valido", "O custo é válido?", "custo > 0", "Sem um custo positivo não há como calcular o preço.", [ex("válido", { custo: 60 }, { caminho: "sim" }), ex("zerado", { custo: 0 }, { caminho: "nao" })]),
  decision("margem-valida", "A margem objetivo é válida?", "margem_objetivo >= 0 e margem_objetivo < 1", "A margem fica entre 0% e 100%: com 100% ou mais, custo ÷ (1 − margem) perde o sentido.", [ex("40%", { margem_objetivo: 0.4 }, { caminho: "sim" }), ex("120%", { margem_objetivo: 1.2 }, { caminho: "nao" })]),
  { op: "add_node", id: "dados-invalidos", label: "Dados do produto inválidos", logic: { role: "end", outcome: "erro", text: "O produto tem um dado que impede o cálculo: o fluxo para e avisa." } },
  { op: "add_node", id: "tipo-do-grupo", label: "Qual o tipo do grupo?", logic: { role: "switch", on: "tipo_grupo", text: "Lucro parte do custo; imagem e tráfego partem do concorrente.", examples: [ex("lucro", { tipo_grupo: "lucro" }, { caminho: "lucro" }), ex("imagem", { tipo_grupo: "imagem" }, { caminho: "imagem" }), ex("tipo desconhecido", { tipo_grupo: "outro" }, { caminho: "outros" })] } },
  rule("partida-lucro", "Partida: custo e margem", "Lucro: custo ÷ (1 − margem objetivo da categoria).", ["preco := custo / (1 - margem_objetivo)"], [ex("custo 60, margem 40%", { custo: 60, margem_objetivo: 0.4 }, { preco: 100 })]),
  rule("partida-concorrente", "Partida: concorrente × índice", "Imagem e tráfego: preço do concorrente × índice da notabilidade.", ["preco := preco_concorrente * indice_notabilidade"], [ex("80 × 0,95", { preco_concorrente: 80, indice_notabilidade: 0.95 }, { preco: 76 })]),
  { op: "add_node", id: "grupo-desconhecido", label: "Tipo de grupo desconhecido", logic: { role: "end", outcome: "erro", text: "Não há como partir o preço: a engine para e avisa." } },
  decision("partida-zerou", "O preço de partida deu zero?", "preco <= 0", "Se o produto der zero, fica o preço atual.", [ex("zero", { preco: 0 }, { caminho: "sim" }), ex("positivo", { preco: 76 }, { caminho: "nao" })]),
  rule("manter-atual", "Manter o preço atual", "Sem preço de partida, fica o preço atual.", ["preco := preco_atual"], [ex("volta ao atual", { preco: 0, preco_atual: 70 }, { preco: 70 })]),

  decision("abaixo-do-piso", "Imagem ou tráfego abaixo do piso?", 'tipo_grupo em ["imagem", "trafego"] e preco < custo / (1 - margem_minima)', "Margem mínima: só imagem e tráfego; lucro não passa aqui.",
    [ex("imagem abaixo", { tipo_grupo: "imagem", preco: 60, custo: 50, margem_minima: 0.3 }, { caminho: "sim" }), ex("lucro não passa", { tipo_grupo: "lucro", preco: 60, custo: 50, margem_minima: 0.3 }, { caminho: "nao" })]),
  rule("subir-ao-piso", "Subir até o piso", "O piso é custo ÷ (1 − margem mínima da notabilidade).", ["preco := custo / (1 - margem_minima)"], [ex("sobe ao piso", { custo: 50, margem_minima: 0.3 }, { preco: 71.42857142857143 })]),

  decision("diferenca-pequena", "A diferença é menor que a mínima?", "preco_atual > 0 e abs(preco / preco_atual - 1) < variacao_minima", "Diferença menor que o mínimo configurado mantém o preço atual.",
    [ex("1% < 2%", { preco: 99, preco_atual: 100 }, { caminho: "sim" }), ex("11% ≥ 2%", { preco: 100, preco_atual: 90 }, { caminho: "nao" })]),
  rule("manter-por-variacao", "Manter o preço atual", "A diferença é pequena demais para valer a troca.", ["preco := preco_atual"], [ex("mantém", { preco: 99, preco_atual: 100 }, { preco: 100 })]),
  decision("tem-preco-atual", "Já existe preço atual?", "preco_atual > 0", "Sem preço atual não há o que comparar nem cortar.", [ex("tem", { preco_atual: 70 }, { caminho: "sim" }), ex("novo produto", { preco_atual: 0 }, { caminho: "nao" })]),
  rule("cortar-variacao", "Cortar no teto e no piso", "Aumento ou redução acima do máximo é cortado no teto ou no piso.", ["preco := min(preco, preco_atual * (1 + aumento_maximo))", "preco := max(preco, preco_atual * (1 - reducao_maxima))"],
    [ex("aumento cortado", { preco: 100, preco_atual: 70 }, { preco: 84 }), ex("redução cortada", { preco: 40, preco_atual: 70 }, { preco: 56 })]),

  decision("preco-mudou", "O preço mudou?", "preco != preco_atual", "O arredondamento só vale quando o preço mudou.", [ex("mudou", { preco: 100, preco_atual: 90 }, { caminho: "sim" }), ex("igual", { preco: 90, preco_atual: 90 }, { caminho: "nao" })]),
  { op: "add_node", id: "faixa-do-preco", label: "Em que faixa está o preço?", description: "A confirmar: \"Até R$ 1, centavos até 9 recuam para ,99\" não foi modelado à parte (vale a regra de até R$ 10); \"termina em 49 ou 99\" até R$ 50 escolhe o mais próximo abaixo; \"acima termina em 99\" foi entendido como inteiro + 0,99.", logic: { role: "switch", text: "Arredondamento por faixa: vale a primeira que se encaixar, de cima para baixo.", examples: [ex("faixa de 100", { preco: 100 }, { caminho: "entre(preco, 100, 101)" }), ex("acima de 202", { preco: 250.4 }, { caminho: "preco > 202.01" }), ex("de 50 a 100", { preco: 84 }, { caminho: "outros" })] } },
  rule("faixa-minima", "Abaixo de R$ 0,10", "Vira R$ 0,09.", ["preco := 0.09"], [ex("0,05", { preco: 0.05 }, { preco: 0.09 })]),
  rule("faixa-alta", "Acima de R$ 202,01", "Vai ao inteiro anterior menos um centavo.", ["preco := piso(preco) - 0.01"], [ex("250,40", { preco: 250.4 }, { preco: 249.99 })]),
  rule("faixa-200", "De R$ 200 a R$ 202", "Vira R$ 199,99.", ["preco := 199.99"], [ex("201", { preco: 201 }, { preco: 199.99 })]),
  rule("faixa-100", "De R$ 100 a R$ 101", "Vira R$ 99,99.", ["preco := 99.99"], [ex("100", { preco: 100 }, { preco: 99.99 })]),
  rule("faixa-ate-10", "Até R$ 10", "Termina em 9.", ["preco := piso(preco * 10) / 10 - 0.01"], [ex("7,34", { preco: 7.34 }, { preco: 7.29 })]),
  rule("faixa-ate-50-cima", "Até R$ 50, com 50 centavos ou mais", "Termina em 49.", ["preco := piso(preco) + 0.49"], [ex("23,70", { preco: 23.7 }, { preco: 23.49 })]),
  rule("faixa-ate-50-baixo", "Até R$ 50, com menos de 50 centavos", "Termina em 99, do real anterior.", ["preco := piso(preco) - 0.01"], [ex("23,20", { preco: 23.2 }, { preco: 22.99 })]),
  rule("faixa-resto", "Acima disso", "Termina em 99.", ["preco := piso(preco) + 0.99"], [ex("84", { preco: 84 }, { preco: 84.99 })]),

  decision("passou-do-pmc", "Passou do PMC do grupo?", "grupo_remarcacao e pmc > 0 e preco > pmc", "No grupo de remarcação vale o menor PMC.", [ex("passou", { grupo_remarcacao: true, pmc: 12.34, preco: 12.49 }, { caminho: "sim" }), ex("sem PMC", { grupo_remarcacao: true, pmc: 0, preco: 12.49 }, { caminho: "nao" })]),
  rule("descer-ao-pmc", "Descer para o PMC", "Desce um centavo além do último dígito de centavo do PMC.", ["preco := pmc - 0.01"], [ex("12,34 → 12,33", { pmc: 12.34 }, { preco: 12.33 })], 'A confirmar: "desce um centavo além do último dígito de centavo do PMC" foi entendido como PMC menos R$ 0,01.'),

  decision("segue-a-referencia", "Imagem ou tráfego que segue a referência?", 'tipo_grupo em ["imagem", "trafego"] e nao eh_referencia e nao ancora', "A referência é o primeiro do grupo; PBM, farmácia popular e marca própria ancoram no preço atual.",
    [ex("segue", { tipo_grupo: "imagem", eh_referencia: false, ancora: false }, { caminho: "sim" }), ex("é a referência", { tipo_grupo: "imagem", eh_referencia: true, ancora: false }, { caminho: "nao" })]),
  rule("igualar-referencia", "Igualar à referência", "Os demais do grupo igualam o preço da referência.", ["preco := preco_referencia_grupo"], [ex("acompanha", { preco: 76.99, preco_referencia_grupo: 74.99 }, { preco: 74.99 })]),

  decision("e-ancora", "É PBM, popular ou marca própria?", "ancora", "Esses produtos ficam no preço atual.", [ex("âncora", { ancora: true }, { caminho: "sim" }), ex("comum", { ancora: false }, { caminho: "nao" })]),
  rule("ancorar", "Voltar ao preço atual e travar", "O preço volta ao atual e as regras seguintes não o reescrevem.", ["preco := preco_atual", "travar preco"], [ex("volta e trava", { preco: 80, preco_atual: 70 }, { preco: 70 })]),

  decision("tem-preco-fixo", "Existe preço fixo?", "preco_fixo > 0", "Se for maior que zero, vence tudo o que veio antes.", [ex("fixo", { preco_fixo: 55 }, { caminho: "sim" }), ex("sem fixo", { preco_fixo: 0 }, { caminho: "nao" })]),
  rule("aplicar-preco-fixo", "Aplicar o preço fixo", "Vence tudo o que veio antes, inclusive a trava da âncora.", ["destravar preco", "preco := preco_fixo", "travar preco"], [ex("vence a âncora", { preco: 70, preco_fixo: 55 }, { preco: 55 })]),

  decision("segue-referencia-lucro", "Lucro que não é a referência?", 'tipo_grupo = "lucro" e nao eh_referencia', "A referência é a de maior receita no grupo; quem já ficou travado não é reescrito.", [ex("seguidor", { tipo_grupo: "lucro", eh_referencia: false }, { caminho: "sim" }), ex("referência", { tipo_grupo: "lucro", eh_referencia: true }, { caminho: "nao" })]),
  rule("igualar-referencia-lucro", "Igualar à referência", "Quem já ficou travado na âncora ou no preço fixo não é reescrito (a trava impede).", ["preco := preco_referencia_grupo"], [ex("segue", { preco: 105.99, preco_referencia_grupo: 99.99 }, { preco: 99.99 })]),

  rule("recomendar", "Recomendar", "Keep se os preços coincidem nos centavos; senão raise ou reduce. O alerta fica pendente quando o preço muda.",
    ['recomendacao := se arredondar(preco, 2) = arredondar(preco_atual, 2) entao "keep" senao (se preco > preco_atual entao "raise" senao "reduce")', "alerta_pendente := arredondar(preco, 2) != arredondar(preco_atual, 2)"],
    [ex("sobe", { preco: 99.99, preco_atual: 90 }, { recomendacao: "raise", alerta_pendente: true }), ex("cai", { preco: 80, preco_atual: 90 }, { recomendacao: "reduce", alerta_pendente: true }), ex("igual", { preco: 90, preco_atual: 90 }, { recomendacao: "keep", alerta_pendente: false })]),
  decision("reaplicar-ajustes", "Reaplicar ajustes gravados?", "reaplicar_ajustes e preco_digitado > 0", "Depois do cálculo, restaura o preço digitado, sem propagar de novo.", [ex("reaplica", { reaplicar_ajustes: true, preco_digitado: 88.5 }, { caminho: "sim" }), ex("não", { reaplicar_ajustes: false, preco_digitado: 88.5 }, { caminho: "nao" })]),
  rule("restaurar-digitado", "Restaurar o preço digitado", "Volta o preço que o usuário digitou.", ["preco := preco_digitado"], [ex("restaura", { preco_digitado: 88.5, preco: 99.99 }, { preco: 88.5 })]),
  decision("e-a-referencia", "É a referência do grupo?", "eh_referencia", "A referência guarda o preço final para os demais seguirem.", [ex("sim", { eh_referencia: true }, { caminho: "sim" }), ex("não", { eh_referencia: false }, { caminho: "nao" })]),
  rule("guardar-referencia", "Guardar o preço da referência", "Os próximos produtos do grupo usam este preço.", ["preco_referencia_grupo := preco"], [ex("guarda", { preco: 99.99 }, { preco_referencia_grupo: 99.99 })]),
  { op: "add_node", id: "fim", label: "Decisão de preço pronta", logic: { role: "end", outcome: "ok", text: "Cada produto sai com preço, recomendação (keep, raise, reduce) e alerta." } },

  // ── cenários: o fluxo inteiro ─────────────────────────────────────────
  { op: "add_node", id: "caso-lucro", label: "Lucro: a referência abre e o seguidor acompanha", logic: { role: "scenario", text: "A referência (custo 60) sai em 99,99; o seguidor, que sozinho iria a 64,99, iguala a referência.", examples: [ex("lucro", { grupo: [P(), P({ custo: 30, preco_atual: 80, eh_referencia: false })] }, { preco_referencia_grupo: 99.99, preco: 99.99, recomendacao: "raise", alerta_pendente: true, desfecho: "ok" })] } },
  { op: "add_node", id: "caso-ancora", label: "Marca própria ancora", logic: { role: "scenario", text: "O seguidor é marca própria: volta ao preço atual e a igualação à referência não o reescreve.", examples: [ex("ancorado", { grupo: [P(), P({ eh_referencia: false, ancora: true, preco_atual: 85 })] }, { preco: 85, recomendacao: "keep", alerta_pendente: false })] } },
  { op: "add_node", id: "caso-fixo", label: "Preço fixo vence a âncora", logic: { role: "scenario", text: "A âncora travou o preço, mas o preço fixo destrava e vence.", examples: [ex("fixo", { grupo: [P(), P({ eh_referencia: false, ancora: true, preco_atual: 85, preco_fixo: 55 })] }, { preco: 55, recomendacao: "reduce" })] } },
  { op: "add_node", id: "caso-imagem", label: "Imagem acompanha a referência", logic: { role: "scenario", text: "Em imagem, a referência parte do concorrente (76,99); o seguidor iria a 85,99 e iguala a referência.", examples: [ex("imagem", { grupo: [P({ tipo_grupo: "imagem", preco_concorrente: 80, indice_notabilidade: 0.95, custo: 50, preco_atual: 70 }), P({ tipo_grupo: "imagem", preco_concorrente: 90, indice_notabilidade: 0.95, custo: 50, preco_atual: 75, eh_referencia: false })] }, { preco_referencia_grupo: 76.99, preco: 76.99, recomendacao: "raise" })] } },
  { op: "add_node", id: "caso-variacao-minima", label: "Diferença pequena", logic: { role: "scenario", text: "O novo preço difere menos que o mínimo: fica o preço atual, sem alerta.", examples: [ex("mantém", { grupo: [P({ preco_atual: 99 })] }, { preco: 99, recomendacao: "keep", alerta_pendente: false })] } },
  { op: "add_node", id: "caso-teto", label: "Aumento cortado no teto", logic: { role: "scenario", text: "A partida pede +43%, mas o teto é +20%: sobe até 84 e arredonda para 84,99.", examples: [ex("teto de 20%", { grupo: [P({ preco_atual: 70 })] }, { preco: 84.99, recomendacao: "raise" })] } },
  { op: "add_node", id: "caso-pmc", label: "Remarcação passa do PMC", logic: { role: "scenario", text: "Calculou 12,50, arredondou para 12,49 e o PMC de 12,34 puxa para 12,33.", examples: [ex("PMC", { grupo: [P({ custo: 10, margem_objetivo: 0.2, preco_atual: 12, grupo_remarcacao: true, pmc: 12.34 })] }, { preco: 12.33 })] } },
  { op: "add_node", id: "caso-erro", label: "Tipo de grupo desconhecido", logic: { role: "scenario", text: "Um tipo que a engine não conhece termina em erro, sem calcular nada.", examples: [ex("erro", { grupo: [P({ tipo_grupo: "outro" })] }, { desfecho: "erro" })] } },

  { op: "add_node", id: "caso-custo-invalido", label: "Custo zerado interrompe o cálculo", logic: { role: "scenario", text: "Sem custo positivo o fluxo para no primeiro produto, com erro.", examples: [ex("custo zerado", { grupo: [P({ custo: 0 })] }, { desfecho: "erro" })] } },
  { op: "add_node", id: "caso-margem-invalida", label: "Margem de 100% ou mais é recusada", logic: { role: "scenario", text: "Uma margem objetivo fora de 0% a 100% termina em erro antes de calcular o preço.", examples: [ex("margem de 120%", { grupo: [P({ margem_objetivo: 1.2 })] }, { desfecho: "erro" })] } },
  { op: "add_node", id: "caso-falha-no-meio", label: "Um produto inválido para o grupo no meio", logic: { role: "scenario", text: "A referência já foi calculada (99,99); o segundo produto tem custo negativo e o fluxo termina em erro.", examples: [ex("falha no segundo", { grupo: [P(), P({ custo: -5, eh_referencia: false })] }, { desfecho: "erro", preco_referencia_grupo: 99.99 })] } },
  { op: "add_node", id: "caso-grupo-vazio", label: "Grupo sem produtos", logic: { role: "scenario", text: "Sem produtos, o laço não repete nenhuma vez e o fluxo termina bem, sem calcular nada.", examples: [ex("vazio", { grupo: [] }, { desfecho: "ok" })] } },

  // ── setas ─────────────────────────────────────────────────────────────
  edge("inicio", "para-cada-produto"),
  edge("para-cada-produto", "carregar", "repete"),
  edge("carregar", "custo-valido"),
  edge("custo-valido", "margem-valida", "sim"),
  edge("custo-valido", "dados-invalidos", "nao"),
  edge("margem-valida", "tipo-do-grupo", "sim"),
  edge("margem-valida", "dados-invalidos", "nao"),
  edge("tipo-do-grupo", "partida-lucro", undefined, '"lucro"'),
  edge("tipo-do-grupo", "partida-concorrente", undefined, '"imagem"'),
  edge("tipo-do-grupo", "partida-concorrente", undefined, '"trafego"'),
  edge("tipo-do-grupo", "grupo-desconhecido", "outros"),
  edge("partida-lucro", "partida-zerou"),
  edge("partida-concorrente", "partida-zerou"),
  edge("partida-zerou", "manter-atual", "sim"),
  edge("partida-zerou", "abaixo-do-piso", "nao"),
  edge("manter-atual", "abaixo-do-piso"),
  edge("abaixo-do-piso", "subir-ao-piso", "sim"),
  edge("abaixo-do-piso", "diferenca-pequena", "nao"),
  edge("subir-ao-piso", "diferenca-pequena"),
  edge("diferenca-pequena", "manter-por-variacao", "sim"),
  edge("diferenca-pequena", "tem-preco-atual", "nao"),
  edge("manter-por-variacao", "preco-mudou"),
  edge("tem-preco-atual", "cortar-variacao", "sim"),
  edge("tem-preco-atual", "preco-mudou", "nao"),
  edge("cortar-variacao", "preco-mudou"),
  edge("preco-mudou", "faixa-do-preco", "sim"),
  edge("preco-mudou", "passou-do-pmc", "nao"),
  edge("faixa-do-preco", "faixa-minima", undefined, "preco < 0.1"),
  edge("faixa-do-preco", "faixa-alta", undefined, "preco > 202.01"),
  edge("faixa-do-preco", "faixa-200", undefined, "entre(preco, 200, 202)"),
  edge("faixa-do-preco", "faixa-100", undefined, "entre(preco, 100, 101)"),
  edge("faixa-do-preco", "faixa-ate-10", undefined, "preco < 10"),
  edge("faixa-do-preco", "faixa-ate-50-cima", undefined, "preco < 50 e preco - piso(preco) >= 0.5"),
  edge("faixa-do-preco", "faixa-ate-50-baixo", undefined, "preco < 50"),
  edge("faixa-do-preco", "faixa-resto", "outros"),
  edge("faixa-minima", "passou-do-pmc"),
  edge("faixa-alta", "passou-do-pmc"),
  edge("faixa-200", "passou-do-pmc"),
  edge("faixa-100", "passou-do-pmc"),
  edge("faixa-ate-10", "passou-do-pmc"),
  edge("faixa-ate-50-cima", "passou-do-pmc"),
  edge("faixa-ate-50-baixo", "passou-do-pmc"),
  edge("faixa-resto", "passou-do-pmc"),
  edge("passou-do-pmc", "descer-ao-pmc", "sim"),
  edge("passou-do-pmc", "segue-a-referencia", "nao"),
  edge("descer-ao-pmc", "segue-a-referencia"),
  edge("segue-a-referencia", "igualar-referencia", "sim"),
  edge("segue-a-referencia", "e-ancora", "nao"),
  edge("igualar-referencia", "e-ancora"),
  edge("e-ancora", "ancorar", "sim"),
  edge("e-ancora", "tem-preco-fixo", "nao"),
  edge("ancorar", "tem-preco-fixo"),
  edge("tem-preco-fixo", "aplicar-preco-fixo", "sim"),
  edge("tem-preco-fixo", "segue-referencia-lucro", "nao"),
  edge("aplicar-preco-fixo", "segue-referencia-lucro"),
  edge("segue-referencia-lucro", "igualar-referencia-lucro", "sim"),
  edge("segue-referencia-lucro", "recomendar", "nao"),
  edge("igualar-referencia-lucro", "recomendar"),
  edge("recomendar", "reaplicar-ajustes"),
  edge("reaplicar-ajustes", "restaurar-digitado", "sim"),
  edge("reaplicar-ajustes", "e-a-referencia", "nao"),
  edge("restaurar-digitado", "e-a-referencia"),
  edge("e-a-referencia", "guardar-referencia", "sim"),
  edge("e-a-referencia", "para-cada-produto", "nao"),
  edge("guardar-referencia", "para-cada-produto"),
  edge("para-cada-produto", "fim", "segue"),
];

export function pricingDoc(): Doc {
  const doc = emptyDoc("Engine de precificação", "logic");
  doc.id = "engine-de-precificacao";
  doc.description = "Para cada produto do grupo, o fluxo escolhe o preço de partida pelo tipo do grupo e passa por onze regras em ordem; cada uma pode reescrever o preço da anterior. Desvios são decisões sim/não, o grupo é um laço e um tipo desconhecido termina em erro. Cada regra e decisão tem exemplos que o app executa, e os cenários rodam o fluxo inteiro.";
  const r = applyOps(doc, [...OPS, { op: "layout" }]);
  const bad = r.results.filter((x) => !x.ok);
  if (bad.length) throw new Error("exemplo de precificação inválido: " + JSON.stringify(bad));
  return recordPaths(r.doc); // cada cenário guarda o caminho que o fluxo percorre; se o fluxo mudar, o exemplo avisa
}

/** Arquivos do exemplo, como gravados em `examples/`: o diagrama e o modelo em texto. */
export function renderLogicExample(): { path: string; content: string }[] {
  const doc = pricingDoc();
  return [
    { path: LOGIC_EXAMPLE_PATH, content: JSON.stringify(doc, null, 2) + "\n" },
    { path: "exemplos-logic/modelo.md", content: describe(doc).replace(/\r\n/g, "\n") + "\n" },
  ];
}
