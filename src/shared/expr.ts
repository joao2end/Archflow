/**
 * Expressões do modo Logic: uma sintaxe pequena, em português, que negócio lê e a máquina verifica.
 *
 *   condição:  categoria.tipo em ["imagem", "trafego"] e preco_atual < piso
 *   cálculo:   custo / (1 - margem_minima)
 *   efeito:    preco := max(preco, piso)        travar preco
 *
 * Sem efeitos colaterais, sem laços, sem acesso a nada fora do ambiente recebido: só dá para ler dados e calcular.
 * Funções puras e sem dependências do app (roda no MCP, no navegador e nos testes).
 */

export type Value = number | string | boolean | null | Value[];

export type Expr =
  | { t: "num"; v: number; pct?: boolean }
  | { t: "str"; v: string }
  | { t: "bool"; v: boolean }
  | { t: "nul" }
  | { t: "id"; name: string }
  | { t: "list"; items: Expr[] }
  | { t: "idx"; x: Expr; i: Expr }
  | { t: "field"; x: Expr; name: string }
  | { t: "call"; fn: string; args: Expr[] }
  | { t: "un"; op: "-" | "nao"; x: Expr }
  | { t: "bin"; op: BinOp; l: Expr; r: Expr }
  | { t: "if"; c: Expr; a: Expr; b: Expr };

export type BinOp = "+" | "-" | "*" | "/" | "%" | "=" | "!=" | "<" | "<=" | ">" | ">=" | "em" | "nao-em" | "e" | "ou";

export type Statement = { t: "assign"; name: string; value: Expr } | { t: "lock"; name: string } | { t: "unlock"; name: string };

/** A expressão tem `se … entao … senao` dentro (em qualquer nível)? */
export function hasConditional(e: Expr): boolean {
  switch (e.t) {
    case "if": return true;
    case "list": return e.items.some(hasConditional);
    case "idx": return hasConditional(e.x) || hasConditional(e.i);
    case "field": return hasConditional(e.x);
    case "call": return e.args.some(hasConditional);
    case "un": return hasConditional(e.x);
    case "bin": return hasConditional(e.l) || hasConditional(e.r);
    default: return false;
  }
}

/**
 * Separa o primeiro `se` da expressão (de fora para dentro, da esquerda para a direita): a condição e a expressão inteira
 * com esse `se` trocado pelo ramo «entao» (sim) ou pelo ramo «senao» (nao).
 */
export function firstConditional(e: Expr): { c: Expr; sim: Expr; nao: Expr } | undefined {
  const within = (children: Expr[], rebuild: (next: Expr[]) => Expr) => {
    for (let i = 0; i < children.length; i++) {
      const r = firstConditional(children[i]);
      if (r) {
        const swap = (x: Expr) => rebuild(children.map((c, j) => (j === i ? x : c)));
        return { c: r.c, sim: swap(r.sim), nao: swap(r.nao) };
      }
    }
    return undefined;
  };
  switch (e.t) {
    case "if": return { c: e.c, sim: e.a, nao: e.b };
    case "list": return within(e.items, (items) => ({ ...e, items }));
    case "idx": return within([e.x, e.i], ([x, i]) => ({ ...e, x, i }));
    case "field": return within([e.x], ([x]) => ({ ...e, x }));
    case "call": return within(e.args, (args) => ({ ...e, args }));
    case "un": return within([e.x], ([x]) => ({ ...e, x }));
    case "bin": return within([e.l, e.r], ([l, r]) => ({ ...e, l, r }));
    default: return undefined;
  }
}

export class ExprError extends Error {
  constructor(message: string, readonly pos = 0) {
    super(message);
  }
}

/* ───────────── funções permitidas (fonte única: parser, avaliador, explicação e guia da IA) ───────────── */

export type FnCategory = "Números" | "Texto" | "Listas" | "Datas" | "Lógica";

/** `ex` é um exemplo completo, só com valores literais: o app o executa para mostrar o resultado ao lado (e um teste confere que roda). */
export const FUNCTIONS: Record<string, { sig: string; doc: string; arity: [number, number]; cat: FnCategory; ex: string }> = {
  min: { sig: "min(a, b, …)", doc: "o menor dos valores", arity: [1, 99], cat: "Números", ex: "min(4, 9, 2)" },
  max: { sig: "max(a, b, …)", doc: "o maior dos valores", arity: [1, 99], cat: "Números", ex: "max(4, 9, 2)" },
  abs: { sig: "abs(x)", doc: "valor sem sinal", arity: [1, 1], cat: "Números", ex: "abs(-7)" },
  piso: { sig: "piso(x)", doc: "arredonda para baixo, ao inteiro", arity: [1, 1], cat: "Números", ex: "piso(3.8)" },
  teto: { sig: "teto(x)", doc: "arredonda para cima, ao inteiro", arity: [1, 1], cat: "Números", ex: "teto(3.2)" },
  arredondar: { sig: "arredondar(x, casas)", doc: "arredonda para o número de casas decimais (padrão 0)", arity: [1, 2], cat: "Números", ex: "arredondar(3.14159, 2)" },
  entre: { sig: "entre(x, minimo, maximo)", doc: "verdadeiro se x está na faixa, inclusive nas pontas", arity: [3, 3], cat: "Lógica", ex: "entre(5, 1, 10)" },
  vazio: { sig: "vazio(x)", doc: "verdadeiro se x não tem valor", arity: [1, 1], cat: "Lógica", ex: "vazio(nulo)" },
  contem: { sig: "contem(lista, x)", doc: "verdadeiro se a lista tem x", arity: [2, 2], cat: "Listas", ex: "contem([\"a\", \"b\"], \"b\")" },
  tamanho: { sig: "tamanho(lista)", doc: "quantidade de itens (ou de letras, em texto)", arity: [1, 1], cat: "Listas", ex: "tamanho([\"a\", \"b\", \"c\"])" },
  texto: { sig: "texto(x)", doc: "converte número, lógico ou vazio em texto (12 vira \"12\")", arity: [1, 1], cat: "Texto", ex: "texto(12)" },
  numero: { sig: "numero(texto)", doc: "converte texto em número (\"12.5\" vira 12.5); dá erro se não for número", arity: [1, 1], cat: "Texto", ex: "numero(\"12,5\")" },
  aparar: { sig: "aparar(texto)", doc: "tira os espaços do começo e do fim", arity: [1, 1], cat: "Texto", ex: "aparar(\"  oi  \")" },
  maiusculas: { sig: "maiusculas(texto)", doc: "tudo em letras maiúsculas", arity: [1, 1], cat: "Texto", ex: "maiusculas(\"ana\")" },
  minusculas: { sig: "minusculas(texto)", doc: "tudo em letras minúsculas", arity: [1, 1], cat: "Texto", ex: "minusculas(\"ANA\")" },
  trocar: { sig: "trocar(texto, de, para)", doc: "troca todas as ocorrências de um trecho por outro", arity: [3, 3], cat: "Texto", ex: "trocar(\"a b c\", \" \", \"-\")" },
  juntar: { sig: "juntar(lista, separador)", doc: "junta os itens da lista num texto, com o separador entre eles", arity: [2, 2], cat: "Texto", ex: "juntar([\"a\", \"b\"], \", \")" },
  filtrar: { sig: "filtrar(lista, condição)", doc: "os itens em que a condição vale; dentro dela os campos do item são nomes soltos (preco > 10) e `item` é o próprio item", arity: [2, 2], cat: "Listas", ex: "filtrar([1, 2, 3, 4], item > 2)" },
  mapear: { sig: "mapear(lista, conta)", doc: "uma lista nova com a conta feita em cada item; dentro dela os campos do item são nomes soltos (preco * qtd) e `item` é o próprio item", arity: [2, 2], cat: "Listas", ex: "mapear([1, 2, 3], item * 2)" },
  dias_entre: { sig: "dias_entre(de, ate)", doc: "quantos dias vão de uma data à outra (negativo se `ate` vem antes); datas em texto AAAA-MM-DD", arity: [2, 2], cat: "Datas", ex: "dias_entre(\"2026-09-12\", \"2026-10-12\")" },
  somar_dias: { sig: "somar_dias(data, dias)", doc: "a data daqui a N dias (N negativo volta no tempo), em texto AAAA-MM-DD", arity: [2, 2], cat: "Datas", ex: "somar_dias(\"2026-01-15\", 30)" },
  soma: { sig: "soma(lista)", doc: "soma dos números da lista (lista vazia dá 0)", arity: [1, 1], cat: "Listas", ex: "soma([10, 20, 5])" },
  media: { sig: "media(lista)", doc: "média dos números da lista; dá erro se a lista é vazia", arity: [1, 1], cat: "Listas", ex: "media([2, 4, 9])" },
  primeiro: { sig: "primeiro(lista)", doc: "o primeiro item (vazio se a lista é vazia)", arity: [1, 1], cat: "Listas", ex: "primeiro([7, 8, 9])" },
  ultimo: { sig: "ultimo(lista)", doc: "o último item (vazio se a lista é vazia)", arity: [1, 1], cat: "Listas", ex: "ultimo([7, 8, 9])" },
  ordenar: { sig: "ordenar(lista)", doc: "a lista em ordem crescente (números ou textos)", arity: [1, 1], cat: "Listas", ex: "ordenar([3, 1, 2])" },
  unicos: { sig: "unicos(lista)", doc: "a lista sem itens repetidos, na ordem em que aparecem", arity: [1, 1], cat: "Listas", ex: "unicos([1, 2, 2, 3])" },
  adicionar: { sig: "adicionar(lista, x)", doc: "nova lista com x no fim (a original não muda)", arity: [2, 2], cat: "Listas", ex: "adicionar([1, 2], 3)" },
  segredo: { sig: "segredo(nome)", doc: "o valor de uma credencial guardada fora do diagrama (token, chave de API); no código gerado vem de deps.secrets ou da variável de ambiente de mesmo nome. O app nunca vê o valor: aqui vale um texto de mentira", arity: [1, 1], cat: "Texto", ex: "segredo(\"API_TOKEN\")" },
  partir: { sig: "partir(texto, separador)", doc: "parte o texto numa lista, em cada separador", arity: [2, 2], cat: "Texto", ex: "partir(\"a,b,c\", \",\")" },
};

/** Busca de funções por nome, assunto ou descrição, sem acento. Aceita o verbo («somar» acha `soma`). Vazio devolve todas. */
export function findFunctions(query: string): string[] {
  const norm = (x: string) => x.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  const words = norm(query).split(/\s+/).filter(Boolean);
  return Object.entries(FUNCTIONS)
    .filter(([k, f]) => {
      const hay = norm(`${k} ${f.sig} ${f.doc} ${f.cat}`);
      return words.every((w) => hay.includes(w) || (w.length > 4 && hay.includes(w.replace(/(ar|er|ir|s)$/, ""))));
    })
    .map(([k]) => k);
}

/** Documentação da sintaxe para a IA e para o guia do app. */
export const SYNTAX_GUIDE = [
  "Números: `10`, `0.09` (ponto decimal), `5%` (= 0.05). Texto: `\"imagem\"`. Lógicos: `verdadeiro`, `falso`. Sem valor: `nulo`.",
  "Dados: nomes com letras, números e `_`, podendo ter pontos: `preco_atual`, `categoria.margem`. Listas: `[\"a\", \"b\"]`.",
  "Contas: `+ - * / %` (`%` é o resto da divisão; `5%` com o símbolo colado ao FIM de um número literal é o número 0.05; `x%5` e `10 %5` são resto, e `10% 5` é erro) e parênteses. Comparações: `= != < <= > >=`, `em [...]`, `nao em [...]`.",
  "Lógica: `e`, `ou`, `nao` (também `and`, `or`, `not`). Escolha de valor: `se condição entao A senao B` (vale em condições, como `when`, `until`, `on`, `foreach`, `falha`; NÃO dentro dos efeitos `then` de uma Ação nem `devolve` de uma Chamada: lá a escolha é uma Decisão).",
  "Funções: " + Object.values(FUNCTIONS).map((f) => `\`${f.sig}\``).join(", ") + ". Em `filtrar` e `mapear`, dentro da condição/conta os campos do item são nomes soltos (`preco > 10`) e `item` é o próprio item (`filtrar([1, 2, 3], item > 1)`); se o item tiver um campo chamado `item`, o nome `item` continua sendo o item inteiro (leia o campo com `item.item`).",
  "Bordas (o que o app faz de verdade): `arredondar(x, casas)` arredonda o meio para cima (`arredondar(2.5, 0)` = 3, `arredondar(-2.5, 0)` = -2) e aceita casas negativas (`arredondar(1234, -2)` = 1200); `piso` vai para o menor inteiro e `teto` para o maior (`piso(-1.5)` = -2); `entre(x, min, max)` inclui as duas pontas e dá falso se min > max; `min` e `max` só aceitam números (nem lista, nem vazio); dividir por zero é erro; `%` é o resto com o sinal do dividendo (`-7 % 3` = -1).",
  "Comparações: `=` exige o mesmo tipo e diferencia maiúsculas (`\"A\" = \"a\"` e `1 = \"1\"` dão falso); listas e objetos comparam pelo conteúdo; `<` e `>` em texto seguem a ordem dos caracteres (maiúsculas antes das minúsculas). `vazio(x)` é verdadeiro para `nulo`, `\"\"` e `[]`, e falso para `\"  \"`, `0` e `falso`.",
  "Listas e texto: `soma([])` = 0; `media([])` é erro; `primeiro([])` e `ultimo([])` dão `nulo`; `tamanho` também mede texto; `ordenar` é crescente e só aceita lista só de números ou só de textos; `unicos` mantém a ordem; `contem` só vale para lista (para texto, não); `trocar` troca todas as ocorrências (sem regex); `juntar([], \"-\")` = `\"\"`. Conversão: `numero(\"0,5\")` e `numero(\"0.5\")` valem 0.5, e texto que não é número (ou vazio) é erro; `texto(nulo)` = `\"\"` e `texto` de lista é erro (use `juntar`).",
  "Datas: não há tipo data; vale texto `AAAA-MM-DD`. `dias_entre(de, ate)` é ate - de (negativo se `ate` vem antes), `somar_dias` aceita dias negativos, e qualquer outro formato é erro.",
  "Mais bordas: `nao` vale antes de `e`, e `e` antes de `ou` (`falso e falso ou verdadeiro` é verdadeiro); `e`/`ou`/`nao` e `and`/`or`/`not` valem e podem se misturar. `+` soma números ou junta DOIS textos (`\"a\" + \"b\"` = `\"ab\"`); texto com número é erro (use `texto(x)`). `texto(1.50)` = `\"1.5\"` e `texto(verdadeiro)` = `\"true\"`; `tamanho(nulo)` e `numero(nulo)` são erro. `em` pede uma lista do outro lado (com texto é erro de sintaxe) e compara como `=`. `adicionar(lista, x)` devolve uma lista NOVA, sem alterar a original; `partir(\"a,,b\", \",\")` mantém o vazio do meio, `partir(\"\", \",\")` dá `[\"\"]` e um separador vazio parte em letras; `unicos` compara listas e objetos pelo conteúdo. `x = 3` NÃO é um efeito (é recusado: use `x := 3`).",
  "Efeitos (campo `then`, uma LISTA com um efeito por item): `preco := expressão` (passa a valer), `travar preco` (daí em diante `preco := ...` não muda o valor nem dá erro; a tentativa fica anotada como bloqueada) e `destravar preco` (volta a poder ser reescrito; use em ações que \"vencem tudo\").",
].join("\n");

/* ───────────── léxico ───────────── */

type Tok = { k: "num" | "str" | "id" | "op" | "kw" | "end"; v: string; pos: number; pct?: boolean };

const KEYWORDS: Record<string, string> = {
  e: "e", and: "e", ou: "ou", or: "ou", nao: "nao", não: "nao", not: "nao", em: "em", in: "em",
  se: "se", if: "se", entao: "entao", então: "entao", then: "entao", senao: "senao", senão: "senao", else: "senao",
  verdadeiro: "true", true: "true", falso: "false", false: "false", nulo: "null", null: "null", travar: "travar", destravar: "destravar",
};

const isIdStart = (c: string) => /[\p{L}_]/u.test(c);
const isIdPart = (c: string) => /[\p{L}\p{N}_]/u.test(c);

function lex(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (/[0-9]/.test(c)) {
      let j = i;
      while (j < src.length && /[0-9]/.test(src[j])) j++;
      if (src[j] === "." && /[0-9]/.test(src[j + 1] ?? "")) { j++; while (j < src.length && /[0-9]/.test(src[j])) j++; }
      const raw = src.slice(i, j);
      if (src[j] === "%") { out.push({ k: "num", v: raw, pos: i, pct: true }); j++; } else out.push({ k: "num", v: raw, pos: i });
      i = j;
      continue;
    }
    if (c === '"') {
      let j = i + 1;
      let s = "";
      while (j < src.length && src[j] !== '"') { if (src[j] === "\\" && j + 1 < src.length) j++; s += src[j++]; }
      if (src[j] !== '"') throw new ExprError("texto sem aspas de fechamento", i);
      out.push({ k: "str", v: s, pos: i });
      i = j + 1;
      continue;
    }
    if (isIdStart(c)) {
      let j = i;
      while (j < src.length && (isIdPart(src[j]) || (src[j] === "." && j + 1 < src.length && isIdStart(src[j + 1])))) j++;
      const word = src.slice(i, j);
      const kw = KEYWORDS[word.toLowerCase()];
      out.push(kw && !word.includes(".") ? { k: "kw", v: kw, pos: i } : { k: "id", v: word, pos: i });
      i = j;
      continue;
    }
    if (c === "." && isIdStart(src[i + 1] ?? "") && /[\])]/.test(out[out.length - 1]?.v ?? "") && out[out.length - 1].k === "op") { out.push({ k: "op", v: ".", pos: i }); i++; continue; }
    const two = src.slice(i, i + 2);
    if (["==", "!=", "<>", "<=", ">=", "&&", "||", ":="].includes(two)) { out.push({ k: "op", v: two, pos: i }); i += 2; continue; }
    if ("+-*/%()[],<>=!".includes(c)) { out.push({ k: "op", v: c, pos: i }); i++; continue; }
    throw new ExprError(`caractere inesperado "${c}"`, i);
  }
  out.push({ k: "end", v: "", pos: src.length });
  return out;
}

/* ───────────── sintaxe ───────────── */

class Parser {
  private p = 0;
  constructor(private toks: Tok[]) {}
  private get cur() { return this.toks[this.p]; }
  private isOp(v: string) { return this.cur.k === "op" && this.cur.v === v; }
  private isKw(v: string) { return this.cur.k === "kw" && this.cur.v === v; }
  private fail(msg: string): never { throw new ExprError(msg, this.cur.pos); }
  private describe(t: Tok) { return t.k === "end" ? "o fim do texto" : `"${t.k === "kw" ? t.v : t.v}"`; }

  atEnd() { return this.cur.k === "end"; }
  expectEnd() { if (!this.atEnd()) this.fail(`sobrou ${this.describe(this.cur)} depois do fim da expressão`); }
  private eatOp(v: string) { if (!this.isOp(v)) this.fail(`esperava "${v}" mas veio ${this.describe(this.cur)}`); this.p++; }

  statement(): Statement {
    if (this.isKw("travar") || this.isKw("destravar")) {
      const t = this.cur.v === "travar" ? "lock" : "unlock";
      this.p++;
      if (this.cur.k !== "id") this.fail(`depois de "${t === "lock" ? "travar" : "destravar"}" vem o nome do dado (ex.: ${t === "lock" ? "travar" : "destravar"} preco)`);
      const name = this.cur.v;
      this.p++;
      return { t, name };
    }
    if (this.cur.k === "id" && this.toks[this.p + 1]?.k === "op" && this.toks[this.p + 1].v === ":=") {
      const name = this.cur.v;
      this.p += 2;
      return { t: "assign", name, value: this.expr() };
    }
    return this.fail('um efeito é "dado := expressão", "travar dado" ou "destravar dado"');
  }

  expr(): Expr {
    if (this.isKw("se")) {
      this.p++;
      const c = this.expr();
      if (!this.isKw("entao")) this.fail('faltou "entao" depois da condição do "se"');
      this.p++;
      const a = this.expr();
      if (!this.isKw("senao")) this.fail('faltou "senao" (todo "se" precisa dos dois caminhos)');
      this.p++;
      return { t: "if", c, a, b: this.expr() };
    }
    return this.or();
  }
  private or(): Expr {
    let l = this.and();
    while (this.isKw("ou") || this.isOp("||")) { this.p++; l = { t: "bin", op: "ou", l, r: this.and() }; }
    return l;
  }
  private and(): Expr {
    let l = this.not();
    while (this.isKw("e") || this.isOp("&&")) { this.p++; l = { t: "bin", op: "e", l, r: this.not() }; }
    return l;
  }
  private not(): Expr {
    if (this.isKw("nao") && !(this.toks[this.p + 1]?.k === "kw" && this.toks[this.p + 1].v === "em")) { this.p++; return { t: "un", op: "nao", x: this.not() }; }
    if (this.isOp("!") ) { this.p++; return { t: "un", op: "nao", x: this.not() }; }
    return this.cmp();
  }
  private cmp(): Expr {
    const l = this.add();
    const ops: Record<string, BinOp> = { "=": "=", "==": "=", "!=": "!=", "<>": "!=", "<": "<", "<=": "<=", ">": ">", ">=": ">=" };
    if (this.cur.k === "op" && ops[this.cur.v]) { const op = ops[this.cur.v]; this.p++; return { t: "bin", op, l, r: this.add() }; }
    if (this.isKw("em")) { this.p++; return { t: "bin", op: "em", l, r: this.add() }; }
    if (this.isKw("nao") && this.toks[this.p + 1]?.k === "kw" && this.toks[this.p + 1].v === "em") { this.p += 2; return { t: "bin", op: "nao-em", l, r: this.add() }; }
    return l;
  }
  private add(): Expr {
    let l = this.mul();
    while (this.isOp("+") || this.isOp("-")) { const op = this.cur.v as "+" | "-"; this.p++; l = { t: "bin", op, l, r: this.mul() }; }
    return l;
  }
  private mul(): Expr {
    let l = this.unary();
    while (this.isOp("*") || this.isOp("/") || this.isOp("%")) { const op = this.cur.v as "*" | "/" | "%"; this.p++; l = { t: "bin", op, l, r: this.unary() }; }
    return l;
  }
  private unary(): Expr {
    if (this.isOp("-")) { this.p++; return { t: "un", op: "-", x: this.unary() }; }
    return this.primary();
  }
  /** Depois de um valor: `[posição]` (a primeira é 0) e `.campo`, quantas vezes vierem: `itens[0].preco`. */
  private postfix(e: Expr): Expr {
    for (;;) {
      if (this.isOp("[")) { this.p++; const i = this.expr(); this.eatOp("]"); e = { t: "idx", x: e, i }; }
      else if (this.isOp(".") && this.toks[this.p + 1]?.k === "id") { this.p++; e = { t: "field", x: e, name: this.cur.v }; this.p++; }
      else return e;
    }
  }
  private primary(): Expr {
    return this.postfix(this.atom());
  }
  private atom(): Expr {
    const t = this.cur;
    if (t.k === "num") { this.p++; const n = Number(t.v); return t.pct ? { t: "num", v: n / 100, pct: true } : { t: "num", v: n }; }
    if (t.k === "str") { this.p++; return { t: "str", v: t.v }; }
    if (t.k === "kw" && (t.v === "true" || t.v === "false")) { this.p++; return { t: "bool", v: t.v === "true" }; }
    if (t.k === "kw" && t.v === "null") { this.p++; return { t: "nul" }; }
    if (this.isOp("(")) { this.p++; const e = this.expr(); this.eatOp(")"); return e; }
    if (this.isOp("[")) {
      this.p++;
      const items: Expr[] = [];
      if (!this.isOp("]")) { items.push(this.expr()); while (this.isOp(",")) { this.p++; items.push(this.expr()); } }
      this.eatOp("]");
      return { t: "list", items };
    }
    if (t.k === "id") {
      this.p++;
      if (this.isOp("(")) {
        const spec = FUNCTIONS[t.v.toLowerCase()];
        if (!spec) throw new ExprError(`função desconhecida "${t.v}". Disponíveis: ${Object.keys(FUNCTIONS).join(", ")}`, t.pos);
        this.p++;
        const args: Expr[] = [];
        if (!this.isOp(")")) { args.push(this.expr()); while (this.isOp(",")) { this.p++; args.push(this.expr()); } }
        this.eatOp(")");
        if (args.length < spec.arity[0] || args.length > spec.arity[1]) throw new ExprError(`${spec.sig} recebe ${spec.arity[0] === spec.arity[1] ? spec.arity[0] : `${spec.arity[0]} a ${spec.arity[1]}`} valor(es), mas recebeu ${args.length}`, t.pos);
        return { t: "call", fn: t.v.toLowerCase(), args };
      }
      return { t: "id", name: t.v };
    }
    return this.fail(`esperava um valor mas veio ${this.describe(t)}`);
  }
}

export function parseExpr(src: string): Expr {
  const p = new Parser(lex(src));
  const e = p.expr();
  p.expectEnd();
  return e;
}

export function parseStatement(src: string): Statement {
  const p = new Parser(lex(src));
  const s = p.statement();
  p.expectEnd();
  return s;
}

/** Texto -> mensagem de erro (ou undefined se estiver correto), com a posição para a UI marcar. */
export function checkExpr(src: string, kind: "expr" | "statement" = "expr"): { message: string; pos: number } | undefined {
  try {
    if (kind === "expr") parseExpr(src); else parseStatement(src);
    return undefined;
  } catch (e) {
    if (e instanceof ExprError) return { message: e.message, pos: e.pos };
    throw e;
  }
}

/* ───────────── análise estática ───────────── */

/** Dados lidos por uma expressão (nomes completos, ex.: "categoria.margem"). */
export function readsOf(e: Expr, acc = new Set<string>()): Set<string> {
  switch (e.t) {
    case "id": acc.add(e.name); break;
    case "list": e.items.forEach((x) => readsOf(x, acc)); break;
    case "idx": readsOf(e.x, acc); readsOf(e.i, acc); break;
    case "field": readsOf(e.x, acc); break;
    case "call": (e.fn === "filtrar" || e.fn === "mapear" ? e.args.slice(0, 1) : e.args).forEach((x) => readsOf(x, acc)); break; // dentro de filtrar/mapear os nomes são campos do item, não dados do diagrama
    case "un": readsOf(e.x, acc); break;
    case "bin": readsOf(e.l, acc); readsOf(e.r, acc); break;
    case "if": readsOf(e.c, acc); readsOf(e.a, acc); readsOf(e.b, acc); break;
  }
  return acc;
}

/* ───────────── avaliação ───────────── */

export type Env = Record<string, unknown>;

export class EvalError extends Error {}

function lookup(env: Env, name: string): Value {
  if (name in env) return env[name] as Value;
  let cur: unknown = env;
  for (const part of name.split(".")) {
    if (cur && typeof cur === "object" && part in (cur as object)) cur = (cur as Record<string, unknown>)[part];
    else throw new EvalError(`"${name}" não tem valor neste exemplo`);
  }
  return cur as Value;
}

const num = (v: Value, what: string): number => {
  if (typeof v !== "number" || Number.isNaN(v)) throw new EvalError(`${what} precisa ser número, mas é ${v === null ? "vazio" : JSON.stringify(v)}`);
  return v;
};

const list = (v: Value, what: string): Value[] => {
  if (!Array.isArray(v)) throw new EvalError(`${what}(lista) precisa de uma lista, mas recebeu ${v === null ? "vazio" : JSON.stringify(v)}`);
  return v;
};

const DAY = 86400000;
/** Texto AAAA-MM-DD -> dia (UTC, sem fuso nem horário de verão). Recusa datas que não existem (2026-02-30). */
const dayOf = (v: Value, what: string): number => {
  const m = typeof v === "string" ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(v) : null;
  if (!m) throw new EvalError(`${what} precisa de uma data em texto AAAA-MM-DD (ex.: "2026-10-12"), mas recebeu ${v === null ? "vazio" : JSON.stringify(v)}`);
  const t = Date.UTC(+m[1], +m[2] - 1, +m[3]);
  const d = new Date(t);
  if (d.getUTCFullYear() !== +m[1] || d.getUTCMonth() !== +m[2] - 1 || d.getUTCDate() !== +m[3]) throw new EvalError(`${what}: a data ${JSON.stringify(v)} não existe no calendário`);
  return Math.round(t / DAY);
};

const str = (v: Value, what: string): string => {
  if (typeof v !== "string") throw new EvalError(`${what} precisa de texto, mas recebeu ${v === null ? "vazio" : JSON.stringify(v)}`);
  return v;
};

/** Igualdade pelo conteúdo: listas e objetos comparam campo a campo (a ordem dos campos não importa). */
const same = (a: Value, b: Value): boolean => {
  if (a === b) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object" || Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a), kb = Object.keys(b);
  return ka.length === kb.length && ka.every((k) => k in b && same((a as unknown as Env)[k] as Value, (b as unknown as Env)[k] as Value));
};

export function evaluate(e: Expr, env: Env): Value {
  switch (e.t) {
    case "num": return e.v;
    case "str": return e.v;
    case "bool": return e.v;
    case "nul": return null;
    case "id": return lookup(env, e.name);
    case "list": return e.items.map((x) => evaluate(x, env));
    case "idx": {
      const base = evaluate(e.x, env);
      const i = evaluate(e.i, env);
      if (typeof i !== "number" || !Number.isInteger(i)) throw new EvalError(`a posição entre [ ] precisa ser um número inteiro (a primeira é 0), mas é ${JSON.stringify(i)}`);
      if (!Array.isArray(base) && typeof base !== "string") throw new EvalError(`[${i}] só vale para lista ou texto, mas o valor é ${base === null ? "vazio" : JSON.stringify(base)}`);
      if (i < 0 || i >= base.length) throw new EvalError(`a posição ${i} não existe: a lista tem ${base.length} ${base.length === 1 ? "item" : "itens"} (posições de 0 a ${Math.max(base.length - 1, 0)})`);
      return base[i] as Value;
    }
    case "field": {
      const base = evaluate(e.x, env) as unknown;
      if (!base || typeof base !== "object" || Array.isArray(base)) throw new EvalError(`.${e.name} só vale para um objeto, mas o valor é ${base === null ? "vazio" : JSON.stringify(base)}`);
      return lookup(base as Env, e.name);
    }
    case "un": return e.op === "-" ? -num(evaluate(e.x, env), "o valor depois do sinal -") : !truthy(evaluate(e.x, env));
    case "if": return truthy(evaluate(e.c, env)) ? evaluate(e.a, env) : evaluate(e.b, env);
    case "bin": {
      if (e.op === "e") return truthy(evaluate(e.l, env)) && truthy(evaluate(e.r, env));
      if (e.op === "ou") return truthy(evaluate(e.l, env)) || truthy(evaluate(e.r, env));
      const l = evaluate(e.l, env);
      const r = evaluate(e.r, env);
      switch (e.op) {
        case "+": return typeof l === "string" && typeof r === "string" ? l + r : num(l, "o lado esquerdo do +") + num(r, "o lado direito do +");
        case "-": return num(l, "o lado esquerdo do -") - num(r, "o lado direito do -");
        case "*": return num(l, "o lado esquerdo do *") * num(r, "o lado direito do *");
        case "/": { const d = num(r, "o divisor"); if (d === 0) throw new EvalError("divisão por zero"); return num(l, "o dividendo") / d; }
        case "%": { const d = num(r, "o divisor"); if (d === 0) throw new EvalError("divisão por zero"); return num(l, "o dividendo") % d; }
        case "=": return same(l, r);
        case "!=": return !same(l, r);
        case "<": case "<=": case ">": case ">=": {
          if (l === null || r === null) return false;
          const a = typeof l === "string" && typeof r === "string" ? l : num(l, "o lado esquerdo da comparação");
          const b = typeof l === "string" && typeof r === "string" ? r : num(r, "o lado direito da comparação");
          return e.op === "<" ? a < b : e.op === "<=" ? a <= b : e.op === ">" ? a > b : a >= b;
        }
        case "em": case "nao-em": {
          if (!Array.isArray(r)) throw new EvalError('depois de "em" vem uma lista, ex.: em ["a", "b"]');
          const has = r.some((x) => same(x, l));
          return e.op === "em" ? has : !has;
        }
      }
      return null;
    }
    case "call": {
      if (e.fn === "filtrar" || e.fn === "mapear") {
        const items = list(evaluate(e.args[0], env), e.fn);
        const each = (item: Value): Env => ({ ...env, ...(item && typeof item === "object" && !Array.isArray(item) ? (item as Env) : {}), item });
        if (e.fn === "mapear") return items.map((it) => evaluate(e.args[1], each(it)));
        return items.filter((it) => {
          const w = evaluate(e.args[1], each(it));
          if (typeof w !== "boolean") throw new EvalError(`a condição de filtrar precisa dar verdadeiro ou falso para cada item, mas deu ${JSON.stringify(w)}`);
          return w;
        });
      }
      const a = e.args.map((x) => evaluate(x, env));
      switch (e.fn) {
        case "min": return Math.min(...a.map((v) => num(v, "min")));
        case "max": return Math.max(...a.map((v) => num(v, "max")));
        case "abs": return Math.abs(num(a[0], "abs"));
        case "piso": return Math.floor(num(a[0], "piso"));
        case "teto": return Math.ceil(num(a[0], "teto"));
        case "arredondar": { const f = 10 ** (a[1] === undefined ? 0 : num(a[1], "casas")); return Math.round((num(a[0], "arredondar") + Number.EPSILON) * f) / f; }
        case "entre": return num(a[0], "entre") >= num(a[1], "entre") && num(a[0], "entre") <= num(a[2], "entre");
        case "vazio": return a[0] === null || a[0] === "" || (Array.isArray(a[0]) && a[0].length === 0);
        case "contem": { if (!Array.isArray(a[0])) throw new EvalError("contem(lista, x) precisa de uma lista"); return a[0].some((x) => same(x, a[1])); }
        case "tamanho": return Array.isArray(a[0]) || typeof a[0] === "string" ? a[0].length : (() => { throw new EvalError("tamanho precisa de lista ou texto"); })();
        case "texto": return a[0] === null ? "" : typeof a[0] === "string" ? a[0] : typeof a[0] === "number" || typeof a[0] === "boolean" ? String(a[0]) : (() => { throw new EvalError("texto(x) converte número, lógico ou vazio; uma lista não vira texto (use juntar)"); })();
        case "numero": { const t = str(a[0], "numero").trim().replace(",", "."); if (t === "" || !Number.isFinite(Number(t))) throw new EvalError(`numero("${a[0]}"): isso não é um número`); return Number(t); }
        case "aparar": return str(a[0], "aparar").trim();
        case "maiusculas": return str(a[0], "maiusculas").toUpperCase();
        case "minusculas": return str(a[0], "minusculas").toLowerCase();
        case "trocar": return str(a[0], "trocar").split(str(a[1], "trocar")).join(str(a[2], "trocar"));
        case "juntar": { if (!Array.isArray(a[0])) throw new EvalError("juntar(lista, separador) precisa de uma lista"); return a[0].map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(str(a[1], "juntar")); }
        case "partir": return str(a[0], "partir").split(str(a[1], "partir"));
        case "dias_entre": return dayOf(a[1], "dias_entre") - dayOf(a[0], "dias_entre");
        case "somar_dias": { const n = num(a[1], "somar_dias"); if (!Number.isInteger(n)) throw new EvalError("somar_dias: o número de dias precisa ser inteiro"); return new Date((dayOf(a[0], "somar_dias") + n) * DAY).toISOString().slice(0, 10); }
        case "soma": return list(a[0], "soma").reduce<number>((t, x) => t + num(x, "cada item de soma"), 0);
        case "media": { const l = list(a[0], "media"); if (!l.length) throw new EvalError("media(lista): a lista está vazia"); return l.reduce<number>((t, x) => t + num(x, "cada item de media"), 0) / l.length; }
        case "primeiro": return list(a[0], "primeiro")[0] ?? null;
        case "ultimo": { const l = list(a[0], "ultimo"); return l[l.length - 1] ?? null; }
        case "ordenar": { const l = [...list(a[0], "ordenar")]; if (l.every((x) => typeof x === "number")) return l.sort((x, y) => (x as number) - (y as number)); if (l.every((x) => typeof x === "string")) return l.sort((x, y) => ((x as string) < (y as string) ? -1 : x === y ? 0 : 1)); throw new EvalError("ordenar(lista) precisa de uma lista só de números ou só de textos"); }
        case "unicos": return list(a[0], "unicos").filter((x, i, l) => l.findIndex((y) => same(x, y)) === i);
        case "adicionar": return [...list(a[0], "adicionar"), a[1]];
        case "segredo": return "‹segredo " + str(a[0], "segredo") + "›";
      }
      throw new EvalError(`função "${e.fn}" sem implementação`);
    }
  }
}

function truthy(v: Value): boolean {
  if (typeof v !== "boolean") throw new EvalError(`esperava verdadeiro ou falso, mas veio ${v === null ? "vazio" : JSON.stringify(v)}`);
  return v;
}

/* ───────────── explicação em português ───────────── */

const PREC: Partial<Record<BinOp, number>> = { ou: 1, e: 2, "=": 3, "!=": 3, "<": 3, "<=": 3, ">": 3, ">=": 3, em: 3, "nao-em": 3, "+": 5, "-": 5, "*": 6, "/": 6, "%": 6 };
const CMP_TEXT: Record<string, string> = { "=": "é igual a", "!=": "é diferente de", "<": "é menor que", "<=": "é menor ou igual a", ">": "é maior que", ">=": "é maior ou igual a", em: "está em", "nao-em": "não está em" };
const ARITH_TEXT: Record<string, string> = { "+": "mais", "-": "menos", "*": "vezes", "/": "dividido por", "%": "resto da divisão por" };
/** Forma curta (rótulos de seta): símbolos em vez de palavras. */
const CMP_SHORT: Record<string, string> = { "=": "=", "!=": "≠", "<": "<", "<=": "≤", ">": ">", ">=": "≥", em: "em", "nao-em": "fora de" };
const ARITH_SHORT: Record<string, string> = { "+": "+", "-": "−", "*": "×", "/": "÷", "%": "resto de" };

const fmtNum = (v: number) => String(Math.round(v * 1e9) / 1e9).replace(".", ",");

/** Marcas (invisíveis) em volta de dados e operadores lógicos, para o desenho destacá-los; `stripMarks` tira. */
export const MARK_VAR = ["", ""] as const;
export const MARK_OP = ["", ""] as const;
export const stripMarks = (t: string) => t.replace(/[-]/g, "");

/** Traduz uma expressão para uma frase em português. `names` troca o nome técnico de um dado pelo nome de negócio. */
export function explain(e: Expr, names: Record<string, string> = {}, short = false, mark = false): string {
  const CMP = short ? CMP_SHORT : CMP_TEXT;
  const ARITH = short ? ARITH_SHORT : ARITH_TEXT;
  const plain = (n: string) => names[n] ?? (n.includes(".") ? n : n.replace(/_/g, " "));
  const nm = (n: string) => (mark ? `${MARK_VAR[0]}${plain(n)}${MARK_VAR[1]}` : plain(n));
  const op = (w: string) => (mark ? `${MARK_OP[0]}${w}${MARK_OP[1]}` : w);
  const wrap = (x: Expr, parent: number) => (x.t === "bin" && (PREC[x.op] ?? 0) < parent ? `(${go(x)})` : go(x));
  const go = (x: Expr): string => {
    switch (x.t) {
      case "num": return x.pct ? `${fmtNum(x.v * 100)}%` : fmtNum(x.v);
      case "str": return `"${x.v}"`;
      case "bool": return x.v ? "verdadeiro" : "falso";
      case "nul": return "vazio";
      case "id": return nm(x.name);
      case "list": return `[${x.items.map(go).join(", ")}]`;
      case "idx": return short ? `${go(x.x)}[${go(x.i)}]` : `item ${go(x.i)} de ${go(x.x)}`;
      case "field": return short ? `${go(x.x)}.${x.name}` : `${x.name.replace(/_/g, " ")} de ${go(x.x)}`;
      case "un": return x.op === "-" ? `-${wrap(x.x, 7)}` : `${op("não")} (${go(x.x)})`;
      case "if": return `se ${go(x.c)}, então ${go(x.a)}; senão ${go(x.b)}`;
      case "bin": {
        if (x.op === "e") return `${wrap(x.l, 2)} ${op("e")} ${wrap(x.r, 3)}`;
        // «a ou b e c» lê-se de dois jeitos em português: um «e» dentro de um «ou» ganha parênteses (o texto salvo já é inequívoco pela precedência)
        if (x.op === "ou") {
          const side = (c: Expr, p: number) => (c.t === "bin" && c.op === "e" ? `(${go(c)})` : wrap(c, p));
          return `${side(x.l, 1)} ${op("ou")} ${side(x.r, 2)}`;
        }
        if (CMP[x.op]) return `${go(x.l)} ${CMP[x.op]} ${go(x.r)}`;
        const p = PREC[x.op]!;
        return `${wrap(x.l, p)} ${ARITH[x.op]} ${wrap(x.r, p + 1)}`;
      }
      case "call": {
        const a = x.args.map(go);
        switch (x.fn) {
          case "min": return `o menor entre ${a.join(", ")}`;
          case "max": return `o maior entre ${a.join(", ")}`;
          case "abs": return `o valor de ${a[0]} sem sinal`;
          case "piso": return short ? `piso(${a[0]})` : `${a[0]} arredondado para baixo`;
          case "teto": return short ? `teto(${a[0]})` : `${a[0]} arredondado para cima`;
          case "arredondar": return a[1] ? `${a[0]} arredondado a ${a[1]} casa(s) decimais` : `${a[0]} arredondado ao inteiro`;
          case "entre": return `${a[0]} está entre ${a[1]} e ${a[2]}`;
          case "vazio": return `${a[0]} está vazio`;
          case "contem": return `${a[0]} contém ${a[1]}`;
          case "tamanho": return `a quantidade de ${a[0]}`;
          case "texto": return `${a[0]} como texto`;
          case "numero": return `${a[0]} como número`;
          case "aparar": return `${a[0]} sem espaços nas pontas`;
          case "maiusculas": return `${a[0]} em maiúsculas`;
          case "minusculas": return `${a[0]} em minúsculas`;
          case "trocar": return `${a[0]} trocando ${a[1]} por ${a[2]}`;
          case "juntar": return `os itens de ${a[0]} unidos por ${a[1]}`;
          case "partir": return `${a[0]} partido em cada ${a[1]}`;
          case "dias_entre": return `os dias de ${a[0]} até ${a[1]}`;
          case "somar_dias": return `${a[0]} mais ${a[1]} dia(s)`;
          case "filtrar": return `${a[0]} em que ${a[1]}`;
          case "mapear": return `${a[1]} de cada item de ${a[0]}`;
          case "soma": return `a soma de ${a[0]}`;
          case "media": return `a média de ${a[0]}`;
          case "primeiro": return `o primeiro de ${a[0]}`;
          case "ultimo": return `o último de ${a[0]}`;
          case "ordenar": return `${a[0]} em ordem crescente`;
          case "unicos": return `${a[0]} sem repetidos`;
          case "adicionar": return `${a[0]} com ${a[1]} no fim`;
          case "segredo": return `a credencial ${a[0]}`;
        }
        return a.join(", ");
      }
    }
  };
  const s = go(e);
  return s;
}

export function explainStatement(s: Statement, names: Record<string, string> = {}, mark = false): string {
  const plain = (n: string) => names[n] ?? (n.includes(".") ? n : n.replace(/_/g, " "));
  const nm = (n: string) => (mark ? `${MARK_VAR[0]}${plain(n)}${MARK_VAR[1]}` : plain(n));
  if (s.t === "unlock") return `libera ${nm(s.name)}: volta a poder ser reescrito`;
  return s.t === "lock" ? `trava ${nm(s.name)}: as ações seguintes não o reescrevem` : `${nm(s.name)} passa a ser ${explain(s.value, names, false, mark)}`;
}

/**
 * Uma escolha "se … entao … senao se … senao …" vira uma lista de ramos (um por linha no quadro).
 * Devolve undefined quando a expressão não é uma escolha. O último ramo, sem condição, é o "senão".
 */
export function branchesOf(e: Expr, names: Record<string, string> = {}, mark = false): { cond?: string; then: string }[] | undefined {
  if (e.t !== "if") return undefined;
  const out: { cond?: string; then: string }[] = [];
  let cur: Expr = e;
  while (cur.t === "if") {
    out.push({ cond: explain(cur.c, names, false, mark), then: explain(cur.a, names, false, mark) });
    cur = cur.b;
  }
  out.push({ then: explain(cur, names, false, mark) });
  return out;
}

/* ───────────── texto canônico de uma expressão ───────────── */

const OP_TEXT: Record<BinOp, string> = { "+": "+", "-": "-", "*": "*", "/": "/", "%": "%", "=": "=", "!=": "!=", "<": "<", "<=": "<=", ">": ">", ">=": ">=", em: "em", "nao-em": "nao em", e: "e", ou: "ou" };

/** Os operadores como no TypeScript (para mostrar o código a quem programa): `=` é `==`, `e` é `&&`, `ou` é `||`. */
const OP_TS: Record<BinOp, string> = { ...OP_TEXT, "=": "==", "!=": "!=", e: "&&", ou: "||" };

/**
 * Expressão -> texto na mesma sintaxe que o parser lê (parênteses só onde a precedência exige). Com `ts`, na sintaxe
 * do TypeScript: `==`, `&&`, `||`, `!x`, `c ? a : b`, `[..].includes(x)`, `true`/`false`/`null` e `5%` como `0.05`
 * (só para mostrar: o app continua lendo a sintaxe dele).
 */
export function print(e: Expr, ts = false): string {
  const go = (x: Expr, parent: number): string => {
    switch (x.t) {
      case "num": return x.pct ? (ts ? String(Math.round(x.v * 1e9) / 1e9) : `${Math.round(x.v * 1e11) / 1e9}%`) : String(x.v);
      case "str": return JSON.stringify(x.v);
      case "bool": return ts ? String(x.v) : x.v ? "verdadeiro" : "falso";
      case "nul": return ts ? "null" : "nulo";
      case "id": return x.name;
      case "list": return `[${x.items.map((i) => go(i, 0)).join(", ")}]`;
      case "idx": return `${go(x.x, 9)}[${go(x.i, 0)}]`;
      case "field": return `${go(x.x, 9)}.${x.name}`;
      case "call": return `${x.fn}(${x.args.map((i) => go(i, 0)).join(", ")})`;
      case "un":
        if (x.op === "-") return `-${go(x.x, 7)}`;
        if (ts) return `!${go(x.x, 9)}`;
        return parent > 2 ? `(nao ${go(x.x, 3)})` : `nao ${go(x.x, 3)}`;
      case "if": { const t = ts ? `${go(x.c, 1)} ? ${go(x.a, 1)} : ${go(x.b, 1)}` : `se ${go(x.c, 0)} entao ${go(x.a, 0)} senao ${go(x.b, 0)}`; return parent > 0 ? `(${t})` : t; }
      case "bin": {
        const p = PREC[x.op] ?? 0;
        if (ts && (x.op === "em" || x.op === "nao-em")) {
          const t = `${x.op === "nao-em" ? "!" : ""}${go(x.r, 9)}.includes(${go(x.l, 0)})`;
          return x.op === "nao-em" && parent > 8 ? `(${t})` : t;
        }
        const cmp = p === 3;
        // no TypeScript, && dentro de || (e vice-versa) leva parênteses, para a leitura não depender da precedência
        const mixed = (y: Expr) => ts && (x.op === "e" || x.op === "ou") && y.t === "bin" && (y.op === "e" || y.op === "ou") && y.op !== x.op;
        const side = (y: Expr, pp: number) => (mixed(y) ? `(${go(y, 0)})` : go(y, pp));
        const t = `${side(x.l, cmp ? p + 1 : p)} ${(ts ? OP_TS : OP_TEXT)[x.op]} ${side(x.r, p + 1)}`;
        return p < parent ? `(${t})` : t;
      }
    }
  };
  return go(e, 0);
}

/** Valor curto para aparecer dentro de uma expressão: listas longas e objetos resumidos, números sem ruído de ponto flutuante. */
export function shortValue(v: unknown): string {
  if (v === undefined) return "sem valor";
  if (typeof v === "number") return String(Math.round(v * 1e6) / 1e6);
  if (Array.isArray(v)) return v.length > 6 ? `[${v.slice(0, 5).map(shortValue).join(", ")}, … (${v.length} itens)]` : `[${v.map(shortValue).join(", ")}]`;
  if (v !== null && typeof v === "object") return "{…}";
  if (typeof v === "string") return JSON.stringify(v.length > 40 ? v.slice(0, 39) + "…" : v);
  return v === null ? "nulo" : v ? "verdadeiro" : "falso";
}

/** O valor inteiro, sem abreviar listas, objetos nem textos longos (para quem precisa ver tudo, como o debug do 3D). */
export function fullValue(v: unknown, ts = false): string {
  if (v === undefined) return "sem valor";
  if (typeof v === "number") return String(Math.round(v * 1e6) / 1e6);
  if (Array.isArray(v)) return `[${v.map((x) => fullValue(x, ts)).join(", ")}]`;
  if (v !== null && typeof v === "object") return `{ ${Object.entries(v).map(([k, x]) => `${k}: ${fullValue(x, ts)}`).join(", ")} }`;
  if (typeof v === "string") return JSON.stringify(v);
  return v === null ? (ts ? "null" : "nulo") : ts ? String(v) : v ? "verdadeiro" : "falso";
}

/**
 * A expressão com os dados trocados pelos valores do momento (`v[meio] < x` → `3 < 4`), na mesma sintaxe do `print`.
 * Dentro de um E/OU, cada comparação ganha ✔ ou ✘, para ver qual parte decidiu. Partes que não dá para calcular ficam `?`.
 */
export function withValues(e: Expr, env: Env, show: (v: unknown) => string = shortValue, ts = false): string {
  const root = (x: Expr): string | undefined => (x.t === "id" ? x.name : x.t === "field" || x.t === "idx" ? root(x.x) : undefined);
  const val = (x: Expr) => {
    try {
      return show(evaluate(x, env));
    } catch {
      const r = root(x);
      return r !== undefined && !(r in env) ? "sem valor" : "?";
    }
  };
  const truth = (x: Expr) => {
    try {
      const v = evaluate(x, env);
      return v === true ? " ✔" : v === false ? " ✘" : "";
    } catch {
      return "";
    }
  };
  const isAccess = (x: Expr): boolean => x.t === "id" || ((x.t === "field" || x.t === "idx") && isAccess(x.x));
  const go = (x: Expr, parent: number, logical = false): string => {
    switch (x.t) {
      case "id":
      case "field":
      case "idx":
        // o caminho inteiro (lista[i], pedido.total) vira um valor só; um índice calculado sobre outra coisa também
        return isAccess(x) ? val(x) + (logical ? truth(x) : "") : val(x);
      case "list": return `[${x.items.map((i) => go(i, 0)).join(", ")}]`;
      case "call": return `${x.fn}(${x.args.map((i) => go(i, 0)).join(", ")})`;
      case "un": return x.op === "-" ? `-${go(x.x, 7)}` : ts ? `!${go(x.x, 9)}${logical ? truth(x) : ""}` : `nao ${go(x.x, 3)}${logical ? truth(x) : ""}`;
      case "if": { const t = ts ? `${go(x.c, 1)} ? ${go(x.a, 1)} : ${go(x.b, 1)}` : `se ${go(x.c, 0)} entao ${go(x.a, 0)} senao ${go(x.b, 0)}`; return parent > 0 ? `(${t})` : t; }
      case "bin": {
        const p = PREC[x.op] ?? 0;
        const OPS = ts ? OP_TS : OP_TEXT;
        if (x.op === "e" || x.op === "ou") {
          const mixed = (y: Expr) => ts && y.t === "bin" && (y.op === "e" || y.op === "ou") && y.op !== x.op;
          const side = (y: Expr, pp: number) => (mixed(y) ? `(${go(y, 0, true)})` : go(y, pp, true));
          const t = `${side(x.l, p)} ${OPS[x.op]} ${side(x.r, p + 1)}`;
          return p < parent ? `(${t})` : t;
        }
        if (ts && (x.op === "em" || x.op === "nao-em")) {
          const t = `${x.op === "nao-em" ? "!" : ""}${go(x.r, 9)}.includes(${go(x.l, 0)})`;
          return logical ? `${t}${truth(x)}` : t;
        }
        const cmp = p === 3;
        const t = `${go(x.l, cmp ? p + 1 : p)} ${OPS[x.op]} ${go(x.r, p + 1)}`;
        const s = p < parent ? `(${t})` : t;
        return cmp && logical ? `${s}${truth(x)}` : s;
      }
      default: return print(x, ts);
    }
  };
  return go(e, 0);
}

/**
 * A mensagem de erro de sintaxe com o ONDE: no fim do texto («depois de «preco <»») ou no meio, com ▸ marcando o ponto
 * («em «a + ▸* b»»). Uma dica curta quando falta um valor.
 */
export function explainError(src: string, e: { message: string; pos: number }): string {
  const end = src.trimEnd().length;
  let where: string | undefined;
  if (e.pos >= end) {
    const tail = src.trimEnd().slice(-24);
    // texto curto já está à vista no campo: basta dizer «no fim»; só o longo precisa citar o trecho
    where = !tail ? "o texto está vazio" : src.trimEnd().length <= 24 ? undefined : `no fim, depois de «…${tail}»`;
  } else {
    const before = src.slice(Math.max(0, e.pos - 10), e.pos);
    const after = src.slice(e.pos, e.pos + 10);
    where = `em «${e.pos > 10 ? "…" : ""}${before}▸${after}${e.pos + 10 < src.length ? "…" : ""}»`;
  }
  const hint = e.message.startsWith("esperava um valor") ? " (falta um dado, número, texto ou conta; ex.: total > 100)" : "";
  return `${e.message}${where ? `, ${where}` : ""}${hint}`;
}
