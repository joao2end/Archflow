# Exemplo 4: Banco digital (avançado)

Dinheiro exige rigor. Este exemplo mostra o que muda quando errar custa caro: **um aggregate por transação**, **consistência eventual entre contas** e uma **saga que desfaz** o que já foi feito. Conceitos explicados em [`docs/DDD.md`](../../../docs/DDD.md); leia antes o exemplo da [Loja](../loja/README.md), que apresenta a saga.

**Como abrir:** no app, explorador de arquivos → ✨ *Exemplos de DDD* → *Banco digital*. O modelo em texto está em [`modelo.md`](modelo.md).

## A história

Um correntista transfere dinheiro para outra conta. Parece uma operação só, mas são **duas contas** (dois aggregates), que podem estar em servidores diferentes, e uma análise antifraude no meio. Se o crédito falhar depois do débito, o dinheiro não pode sumir.

- **Contas** (`core`): saldo, depósito, saque e transferência.
- **Antifraude** (`supporting`): decide se a transferência parece legítima.
- **Notificações** (`generic`): avisa o cliente.

## Como ler

1. **Visão geral**: `contas` e `antifraude` são parceiros (`partnership`); `contas` publica seus eventos num formato estável para `notificacoes` (`published-language`).
2. **Contas**: começa em `solicitar-transferencia` (cria o aggregate `transferencia`, que **acompanha o processo**). A saga `fluxo-de-transferencia` reage a cada marco (`transferencia-solicitada`, `transferencia-liberada`, `origem-debitada`, `destino-creditado`...) e dispara o próximo command. Os eventos `transferencia-liberada` e `transferencia-suspeita` vêm do Antifraude (faixa de cima).
3. **Antifraude** e **Notificações** reagem por policies: `analisar-ao-solicitar` e `avisar-conclusao` / `avisar-falha`.

## Decisões de modelagem (e por quê)

- **Uma transação, um aggregate.** `debitar-origem` mexe na `conta` de origem; `creditar-destino`, na de destino. **Nunca as duas na mesma operação.** Cada `conta` protege a sua invariante (o saldo não passa do limite) e usa controle de versão para duas operações simultâneas não se atropelarem.
- **Consistência eventual com compensação.** Entre o débito e o crédito o dinheiro está "em trânsito". Se o crédito falhar, a saga dispara `estornar-debito` (a **compensação**) e `falhar-transferencia`. Não há transação distribuída: há um caminho de volta modelado.
- **`transferencia` é um aggregate para acompanhar o processo.** A saga não segura o estado só na memória: o aggregate `transferencia` registra em que passo está (solicitada → concluída ou falhou), e a invariante "só vai de solicitada para concluída ou falhou" impede estados impossíveis. Ele referencia as contas **por id** (`references-by-id`), nunca por objeto.
- **`lancamento` é uma entity da `conta`**: o extrato. Cada débito e crédito é um lançamento com identidade; o saldo é consequência.
- **`dinheiro` é value object**: valor + moeda, imutável. Aparece em `conta` e `transferencia`.
- **A tarifa é um domain service** (`politica-de-tarifa`): depende do tipo de conta, e não cabe em um aggregate só.
- **Published language.** Contas não conhece o Notificações: publica eventos em um formato estável (`transferencia-concluida`, `transferencia-falhou`) e quem quiser consome. Isso permite plugar novos consumidores sem mexer em Contas.
- **Antifraude como parceiro, não como parte de Contas.** Evolui no ritmo das fraudes, com equipe e regras próprias. Os dois combinam o contrato dos eventos (`partnership`).

## Casos de uso → modelo

| Caso de uso | Command | Aggregate | Evento |
|---|---|---|---|
| Transferir dinheiro (`transferir-uc`) | `solicitar-transferencia` | `transferencia` | `transferencia-solicitada` |
| Depositar (`depositar-uc`) | `depositar` | `conta` | `valor-depositado` |
| Analisar transferência (`analisar-uc`) | `analisar-transferencia` | `analise` | `transferencia-liberada` |
| Ser avisado de movimentações (`ser-avisado-uc`) | `enviar-notificacao` | `notificacao` | `notificacao-enviada` |

## Experimente

1. **Caminho feliz:** `solicitar-transferencia` → `transferencia-solicitada` → (Antifraude) `transferencia-liberada` → `debitar-origem` → `origem-debitada` → `creditar-destino` → `destino-creditado` → `concluir-transferencia` → `transferencia-concluida` → (Notificações) `enviar-notificacao`.
2. **Caminho com falha:** `transferencia-suspeita` chega antes de debitar. O que a saga faz? E se a falha vier depois de `origem-debitada`? Quais commands entram? (`estornar-debito`, `falhar-transferencia`.)
3. **Tente "otimizar":** faça um único command que debite e credite. Que invariante você perde, e o que acontece com as contas em servidores diferentes?
4. **Gere o código** (aba *Código*): `FluxoDeTransferencia` tem `compensate()`, e `Conta` tem um método por command e eventos tipados.
