# Tutorial do modo Logic: como usar cada componente

O modo **Logic** desenha uma regra de negócio ou um algoritmo como um **fluxo que roda de verdade**: você monta os passos, escreve exemplos com números reais e o app executa o fluxo e diz se o resultado bate.

Cada capítulo abaixo segue o mesmo roteiro: **para que serve**, **quando usar**, **passo a passo no app**, **como ler o resultado**, **erros comuns** e **como pedir à IA (MCP)**.

| # | Componente | Para que serve | Capítulo |
|---|---|---|---|
| 1 | **Scenario** (TESTE) | Um cenário completo: dados de entrada → resultado esperado | [Scenario](#1-scenario) ✅ |
| 2 | Start | Onde o fluxo começa e o que entra | a escrever |
| 3 | End | Onde termina; desfecho `ok` ou `erro` | a escrever |
| 4 | Input / Output / Variable (IN, OUT, VAR) | Um dado do fluxo, com nome e tipo: o que entra, o que sai e o que o fluxo usa no meio | a escrever |
| 5 | **Ação** (AÇÃO) | O que muda nos dados (`frete := 0`) | a escrever |
| 6 | Decision (IF) | Pergunta sim/não | a escrever |
| 7 | Switch (CASE?) | Vários caminhos: por valor ou por faixas | a escrever |
| 8 | Loop (LOOP) | Repetir: para cada item, até uma condição, no máximo N vezes | a escrever |
| 9 | Fork / Join | Caminhos em paralelo e a junção | a escrever |
| 10 | Call (CALL) | Chamada a algo de fora que pode falhar | a escrever |

## Ação × Decisão (a dúvida mais comum)

O modo tem só **dois** tipos de passo de lógica: a **Ação** (muda dados) e a **Decisão** (escolhe o caminho). Uma «regra de negócio» é o desenho inteiro: decisões e ações juntas.

As duas têm uma caixa de condição parecida, mas fazem coisas **opostas**:

| | **Ação** (AÇÃO) | **Decisão** (IF) |
|---|---|---|
| O que faz | **Muda dados** (`frete := 0`) | **Só pergunta** (sim ou não) |
| Setas que saem | **uma** (o fluxo segue) | **duas**: «sim» e «não» |
| A condição serve para | **não tem condição**: roda sempre que o fluxo chega nela (a condição é da Decisão, colocada antes) | escolher **por qual seta** o fluxo sai |
| Muda dados? | sim | **não** |

**Na prática:** precisa seguir por caminhos diferentes? Use uma **Decisão** e ligue uma **Ação** em cada saída. Precisa só aplicar uma conta, talvez condicionada? Use uma **Ação**.

```
Errado (esconde o desvio na ação; foi removido, e «se … entao … senao» dentro do efeito também é recusado):   [Ação «Frete» · só roda se total < 200 · frete := 15] → Fim
Certo (o desvio aparece no quadro):   [Decisão: total >= 200?] ─ sim → [Ação: frete := 0 ] → Fim
                                                              └ não → [Ação: frete := 15] → Fim
```

Na condição das duas há **E**, **OU** e **NÃO**: o seletor do grupo oferece *Todas (E)*, *Qualquer (OU)*, *Nenhuma delas (NÃO … OU)* e *Nem todas (NÃO … E)*; para um dado sim/não, escolha o operador **é verdadeiro (sim)** ou **é falso (não)**. «Escolha» (Switch) é uma Decisão com vários caminhos.

> Comece pelo **Scenario**: é ele que prova que o resto está certo. Depois de ler os capítulos dos outros componentes, volte aqui para escrever os cenários do seu fluxo.

---

## 1. Scenario

### Para que serve
Um Scenario é **um caso de uso com números reais**: "um pedido de R$ 250 não paga frete". Você diz **o que entra** (Dado) e **o que deve sair** (Esperado). O app roda o fluxo **inteiro**, do Start ao End, com aqueles dados e compara.

Ele faz três coisas ao mesmo tempo:

1. **Documenta**: quem lê o quadro vê exemplos concretos, não só regras abstratas.
2. **Testa**: se alguém mudar o fluxo e o resultado deixar de bater, o cenário acende ✘ e a validação acusa o erro (L004).
3. **Mostra o caminho**: o botão ▶ reproduz o fluxo passo a passo, com o valor de cada variável depois de cada passo.

### Quando usar (e quando não)
| Você quer conferir… | Use |
|---|---|
| Uma ação **sozinha** (só o que ela escreve) | os **exemplos da própria Ação** |
| Uma decisão sozinha (por qual seta sai) | os exemplos da **Decision** ou do **Switch** (`caminho = "sim"`) |
| O fluxo **de ponta a ponta**, do começo ao fim | um **Scenario** ✅ |
| Que o fluxo termina em erro quando deveria | um **Scenario de falha** (`desfecho = "erro"`) |

Na prática: **cada ramo do fluxo deve ter pelo menos um Scenario**. O app ajuda (veja "Cobertura").

### Anatomia
Um Scenario tem:

- **Nome** (o rótulo no quadro): curto, diz o caso. Ex.: *Pedido grande*.
- **Cenário em uma frase**: o que entra e o que se espera, em palavras de negócio. Ex.: *R$ 250 não paga frete*.
- **Exemplos** (um ou mais). Cada exemplo tem:
  - **Nome do exemplo** (ex.: `250`);
  - **Dado**: os valores que entram, uma linha por dado: `dado = valor`;
  - **Esperado**: os valores que devem existir **no final**, uma linha por dado: `dado = valor`.

Além dos dados, o Esperado aceita um nome especial:

| Linha do Esperado | O que confere |
|---|---|
| `frete = 0` | o valor final do dado `frete` |
| `desfecho = "ok"` | que o fluxo terminou num **End** com desfecho `ok` |
| `desfecho = "erro"` | que terminou num **End** com desfecho `erro` |

> `caminho = "sim"` **não** vale no Scenario. Ele só existe em exemplos de Decision e Switch. No Scenario, para conferir por onde o fluxo passou, use **Gravar caminho** (veja o passo 6).

### Como escrever os valores
Os valores usam a mesma sintaxe das expressões:

| Tipo | Escreva | Exemplo |
|---|---|---|
| Número | `250`, `0.4` (ponto decimal), `5%` (= 0.05) | `total = 250` |
| Texto | entre aspas | `aprovador = "gerente"` |
| Lógico | `verdadeiro` ou `falso` | `tem_defeito = verdadeiro` |
| Sem valor | `nulo` | `cupom = nulo` |
| Lista | entre colchetes | `numeros = [2, 3, 5]` |

Números são comparados com tolerância mínima (`1e-9`), então `0.1 + 0.2` contra `0.3` não dá falso erro.

---

### Passo a passo: o cenário do frete
Vamos provar este fluxo: **pedido de R$ 200 ou mais tem frete grátis; abaixo disso, frete fixo de R$ 15.**

#### Antes: o fluxo precisa existir
Um Scenario roda o fluxo, então monte (ou abra) este fluxo no modo **Logic**:

```
Início → [O pedido tem R$ 200 ou mais?] ─ sim → [Frete grátis: frete := 0]  → Fim
                                         └ não → [Frete fixo:  frete := 15] → Fim
```

Com dois dados: `total` (um **Input**, o que entra) e `frete` (um **Output**, o que sai). Os capítulos de Start, dados (Input, Output e Variable), Ação, Decision e End mostram como montar cada peça.

> **Sem setas?** O Scenario também funciona no modo simples: sem setas entre os passos, o app roda as ações na ordem do campo "Ordem na fila".

#### Passo 1. Criar o Scenario
1. Abra a biblioteca (tecla **B**) e clique em **Scenario**. O novo cartão aparece no quadro e já fica selecionado.
2. No painel à direita, confira que o **Papel (Logic)** é **Scenario**.

#### Passo 2. Dar nome e frase
1. **Nome**: `Pedido grande`.
2. **Cenário em uma frase**: `R$ 250 não paga frete.`

#### Passo 3. Criar o exemplo
1. Em **Exemplos**, clique em **+ Exemplo**. O app já sugere as linhas com os dados do **seu** diagrama (por exemplo `total = `), em vez de um texto genérico.
2. **Nome do exemplo**: `250`.
3. **Dado**: `total = 250`
4. **Esperado**, duas linhas:
   ```
   frete = 0
   desfecho = "ok"
   ```
5. Clique fora do campo (ou tecle **Tab**) para salvar.

Se uma linha estiver errada (por exemplo `total 250`, sem o `=`), o app avisa **enquanto você digita**: *"Ainda não salvo: linha 1: use "dado = valor"…"*. Ao confirmar, um aviso de erro diz o motivo, e **o valor antigo é mantido**. Nada é perdido em silêncio.

#### Passo 4. Ver o resultado
Assim que o exemplo é salvo, o app o executa:

- **✓ verde** no cartão e ao lado do exemplo: o fluxo deu `frete = 0` e terminou em `ok`. Bateu.
- **✘ vermelho**: não bateu. Selecione o cenário: o painel mostra a diferença, como *"frete: esperava 15, deu 0"*.

O contador no topo (✓ ou um número laranja) é a **validação do diagrama**. Clique nele para ver tudo: cada exemplo que não bate aparece como **L004**.

#### Passo 5. Descobrir quem produziu o valor errado
Quando dá ✘, a mensagem diz **o quê**, mas o que você quer saber é **onde**. No painel do cenário, logo abaixo da diferença, há um botão do tipo:

> **«frete» foi escrito por «Frete grátis»**

Clique nele: o app seleciona o passo responsável. Para o desfecho, o botão é **O fluxo terminou em «…»**. Em 3 ações você vai do ✘ ao passo culpado.

#### Passo 6. Reproduzir o caminho (▶)
No painel do cenário, em **Reproduzir o caminho**, clique no botão com o nome do exemplo (`▶ 250`). Abre o painel de reprodução:

| Controle | O que faz |
|---|---|
| ▶ / ⏸ | reproduz sozinho, na velocidade escolhida (0,25x a 4x) |
| ← → (teclado) ou os botões de passo | volta e avança um passo |
| clique numa linha da lista | pula até aquele passo |
| **Gravar caminho** | grava os passos percorridos no exemplo |

Em cada passo o painel diz o que aconteceu (*"Respondeu sim: o fluxo segue pela seta "sim""*) e mostra as variáveis que mudaram (`frete: sem valor → 0`).

**Aba Variáveis.** Ao lado de *Passos*, a aba **Variáveis** mostra, para cada variável, a **linha do tempo completa**: valor inicial, cada alteração (de quanto para quanto, em qual passo, por qual nó, em qual volta do laço) e o valor final, com um gráfico para números. Clicar numa alteração pula para o passo.

**Gravar caminho.** Depois de gravar, o exemplo passa a conferir **também o caminho**: se alguém mudar o fluxo e ele passar a seguir por outro lugar, o exemplo acende ✘ com *"caminho diferente no passo 3: esperava «Frete grátis», foi por «Frete fixo»"*. É a forma de testar "por onde passou" num Scenario.

#### Passo 7. O segundo ramo
Um cenário só prova um ramo. Crie outro para o "não":

- Nome: `Pedido pequeno`, frase: `R$ 80 paga o frete fixo.`
- Exemplo `80`: Dado `total = 80`; Esperado `frete = 15` e `desfecho = "ok"`.

Dois cenários, um por ramo.

#### Passo 8. O cenário de falha
Se o fluxo tem um **End com desfecho erro** (por exemplo, "pedido inválido"), escreva um cenário que **chegue** a ele:

- Nome: `Total negativo`
- Exemplo: Dado `total = -10`; Esperado `desfecho = "erro"`

Cenários que esperam `desfecho = "erro"` são tratados como **cenários de falha**: ao usar **Organizar**, ficam no grupo **Cenários que falham**; os outros, em **Cenários que dão certo**. Se o diagrama tem um End de erro e nenhum cenário chega a ele, o app pergunta: *"O que acontece quando dá errado?"*.

---

### Como saber o que falta cobrir
O app marca no quadro, com um **"–" âmbar tracejado**, os passos que **nenhum exemplo ou cenário exercita**: uma ação que nunca roda, uma decisão com um ramo sem cenário, um fim que ninguém alcança. Passe o mouse sobre a marca para ler o motivo, por exemplo:

> *Sem cenário: O que acontece quando a resposta de «O pedido tem R$ 200 ou mais?» é «não»?*

Crie o cenário que falta e a marca some sozinha.

### Como escolher bons exemplos
Escreva os casos **olhando para o enunciado, não para o fluxo**. Cubra sempre:

1. **Um caso por ramo** (um por seta de cada decisão).
2. **As fronteiras**: *exatamente* o limite (`total = 200`), *um pouco abaixo* (`199.99`) e *um pouco acima*. É nas fronteiras que `>` e `>=` se confundem.
3. **O vazio e o extremo**: lista vazia, zero, valor negativo, texto vazio.
4. **A falha**: o caso em que o fluxo deve terminar em erro.

Exemplo de fronteira para o frete:

| Nome | Dado | Esperado |
|---|---|---|
| exatamente no mínimo | `total = 200` | `frete = 0` |
| um centavo abaixo | `total = 199.99` | `frete = 15` |

### Erros comuns
| Sintoma | Causa provável | Como resolver |
|---|---|---|
| ✘ *frete: esperava 0, deu sem valor* | nenhuma ação escreveu `frete` nesse caminho | use o botão **«frete» foi escrito por…**; talvez falte uma seta ou o fluxo não passou pela ação (a decisão antes dela saiu por «não») |
| ✘ *erro em "Frete grátis": "total" não tem valor neste exemplo* | o Dado não traz um dado que o fluxo lê | acrescente a linha no **Dado** (`total = 250`) |
| ✘ *desfecho: esperava "ok", deu "erro"* | o fluxo chegou num End de erro | veja o passo final no ▶; o cenário deveria esperar `erro`, ou o Dado cai num ramo inesperado |
| Aviso *"linha 1: use "dado = valor""* | falta o `=` ou aspas no texto | `aprovador = "gerente"` (texto entre aspas) |
| ✘ *caminho diferente no passo N: esperava "…", foi por "…"* | o exemplo tem caminho gravado e o fluxo mudou | se a mudança é intencional, abra o ▶ e clique **Gravar caminho** de novo |
| O cenário parece ignorado | o exemplo está sem **Esperado** | um exemplo sem Esperado roda, mas não confere nada; acrescente ao menos uma linha |
| Valores decimais "não batem" | vírgula em vez de ponto | use ponto: `0.4`, não `0,4` |

### Pedir à IA (MCP)
A IA cria o mesmo cenário com `add_node` (o formato é igual ao do arquivo):

```json
{
  "op": "add_node",
  "id": "pedido-grande",
  "label": "Pedido grande",
  "logic": {
    "role": "scenario",
    "text": "R$ 250 não paga frete.",
    "examples": [
      { "name": "250", "given": { "total": 250 }, "expect": { "frete": 0, "desfecho": "ok" } },
      { "name": "exatamente 200", "given": { "total": 200 }, "expect": { "frete": 0 } }
    ]
  }
}
```

Depois `validate_diagram` **roda os exemplos de verdade**: cada um que não bate volta como **L004** com a diferença. Um bom pedido à IA:

> *"Crie um cenário por ramo do fluxo, mais as fronteiras (igual, um abaixo, um acima) e um cenário de falha. Rode `validate_diagram` e me mostre os que não batem."*

### Checklist do Scenario
- [ ] Há um cenário para **cada ramo** do fluxo.
- [ ] As **fronteiras** (igual, um abaixo, um acima) estão cobertas.
- [ ] Existe um cenário de **falha** se o fluxo tem End de erro.
- [ ] Todos mostram **✓** (nenhum L004 na validação).
- [ ] Nenhum passo do quadro tem a marca **"–"** de não coberto.
- [ ] Cada Esperado traz pelo menos o **resultado** e o `desfecho`.
- [ ] O nome diz o caso (*Pedido grande*), não o número (*Teste 1*).

---

## Próximos capítulos
A ordem sugerida para ler e para montar um fluxo é: **Start → Input/Output/Variable → Ação → Decision → End**, depois **Switch**, **Loop**, **Fork/Join** e **Call**. O capítulo dos **dados** vem antes da Ação porque é nele que se declaram os **tipos** (`number`, `int`, `string[]`, `{ preco: number }[]`…) que o app confere nos exemplos do Scenario.
