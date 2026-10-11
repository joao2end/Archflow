# Exemplo 1: Biblioteca universitária (iniciante)

O exemplo mais simples para entender o essencial: **dois contextos**, **um aggregate desenhado pela invariante** e **um evento** que atravessa de um contexto para o outro. Se é a sua primeira vez com DDD, comece por aqui. Conceitos explicados em [`docs/DDD.md`](../../../docs/DDD.md).

**Como abrir:** no app, explorador de arquivos → ✨ *Exemplos de DDD* → *Biblioteca universitária*. Fora do app, copie a pasta `examples/exemplos-ddd` para dentro de um cofre. O modelo em texto (o que um agente de IA lê) está em [`modelo.md`](modelo.md).

## A história

Uma biblioteca empresta livros a leitores. O negócio se preocupa com duas coisas bem diferentes:

- **Empréstimos**: quem pode levar o quê, por quanto tempo, e o que acontece quando atrasa. É o que faz a biblioteca funcionar bem (subdomínio `core`).
- **Acervo**: o catálogo, quais livros existem e onde estão os exemplares. É necessário, mas não é o diferencial (subdomínio `supporting`).

Cada uma dessas áreas é um **bounded context**, com o seu diagrama.

## Como ler

1. Abra **Visão geral** (`visao-geral`): é o **mapa de contextos**. `emprestimos` é o fornecedor (upstream) e `acervo` o cliente (downstream): relação `customer-supplier`, e o que viaja entre eles são os eventos `livro-emprestado` e `livro-devolvido`. Clique no botão ↗ de um contexto para entrar nele.
2. Em **Empréstimos** os elementos estão em **raias** (de cima para baixo): quem faz (ator) → o que quer (caso de uso) → o pedido (`command`) → quem decide (o aggregate) → o que aconteceu (evento) → quem reage (policy). Da esquerda para a direita é a ordem do tempo (`ddd.step` dos commands).
3. Em **Acervo** as duas caixas de cima (eventos `livro-emprestado-ext` e `livro-devolvido-ext`) vêm do outro contexto: são **cópias locais** de eventos publicados por `emprestimos`, marcadas com `external`. O Acervo reage a elas com as policies `atualizar-ao-emprestar` e `atualizar-ao-devolver`.

## Decisões de modelagem (e por quê)

- **O `leitor` é o aggregate, não o empréstimo.** As regras "no máximo 3 empréstimos ativos", "leitor com multa não empresta" e "no máximo 2 renovações" só podem ser garantidas olhando *todos* os empréstimos e multas do leitor ao mesmo tempo, na mesma transação. Por isso `emprestimo` e `multa` são **entities dentro do aggregate** (`contains`). A fronteira vem da invariante, não do substantivo.
- **`emprestimo` é entity; `prazo` é value object.** O empréstimo tem identidade (o número dele). O prazo é só um valor: renovar troca o prazo por outro, não o altera.
- **`exemplar` e `livro` são aggregates separados**, ligados por `references-by-id`: um exemplar muda de estado (disponível/emprestado) o tempo todo, o livro quase nunca. Misturá-los faria cada empréstimo travar o cadastro do livro.
- **A multa é uma policy, não código no command.** `multar-atraso` reage a `livro-devolvido` e dispara `registrar-multa`. Assim "devolver" e "multar" evoluem separados. Repare na conexão `livro-devolvido` → `multar-atraso`: ela carrega a **condição** `se dias de atraso > 0`. Devolução em dia não gera multa, e isso aparece no desenho em vez de ficar escondido no código.
- **Um command, dois desfechos.** `renovar-emprestimo` emite `emprestimo-renovado` "se menos de 2 renovações e empréstimo em dia" e `renovacao-negada` no **senão**. Em DDD o resultado de uma regra é um evento, e a condição fica na conexão que o emite.
- **O cálculo da multa fica num domain service** (`calculadora-de-multa`): é regra de negócio pura que não pertence nem ao leitor nem ao empréstimo.
- **`servico-de-emprestimo` é um application service**: só orquestra (carrega o leitor via `leitor-repo`, aplica o command, grava, publica os eventos). Nenhuma regra de negócio mora nele.
- **`emprestimos-ativos` é um read model**: a tela "meus empréstimos" lê de uma projeção, sem carregar o aggregate.

## Casos de uso → modelo

| Caso de uso | Command | Aggregate | Evento |
|---|---|---|---|
| Emprestar livro (`emprestar-livro-uc`) | `emprestar-livro` | `leitor` | `livro-emprestado` |
| Renovar empréstimo (`renovar-uc`) | `renovar-emprestimo` | `leitor` | `emprestimo-renovado` |
| Devolver livro (`devolver-uc`) | `devolver-livro` | `leitor` | `livro-devolvido` |
| Cadastrar livro (`cadastrar-livro-uc`) | `cadastrar-livro` | `livro` | `livro-cadastrado` |
| Cadastrar exemplar (`cadastrar-exemplar-uc`) | `cadastrar-exemplar` | `exemplar` | `exemplar-cadastrado` |

No app, `trace` (MCP) ou a aba de validação confirmam que todos têm caminho até um evento.

## Experimente

1. **Siga um evento.** Em *Empréstimos*, selecione `livro-devolvido` e veja quem reage a ele (`multar-atraso`, o read model, e no *Acervo* `atualizar-ao-devolver`). É assim que o sistema fica consistente sem os contextos conhecerem o código um do outro.
2. **Tente ligar dois aggregates.** Em *Acervo*, use o conector para ligar `livro` a `exemplar`: o Archflow cria `references-by-id` (a única relação que serve entre aggregates) e recusa tipos de infraestrutura como `sync`. Repare na dica de ciclo na validação (`exemplar` já referencia `livro`): é um sinal para rever o desenho.
3. **Gere o código.** No app: selo ✓ → aba *Código (TypeScript)*. Veja como `leitor` vira uma classe com os métodos dos commands, `livro-emprestado` vira uma interface e `leitor-repo` uma interface de repositório.
4. **Mude a fronteira.** Tire o `emprestimo` de dentro do `leitor` e faça dele um aggregate. Que invariante deixa de poder ser garantida? (Pista: o limite de 3 empréstimos.)
