# Exemplo 2: Clínica médica (intermediário)

Foco em duas perguntas que todo modelo enfrenta: **onde termina o aggregate** e **o que significa a mesma palavra em cada contexto**. Conceitos explicados em [`docs/DDD.md`](../../../docs/DDD.md).

**Como abrir:** no app, explorador de arquivos → ✨ *Exemplos de DDD* → *Clínica médica*. O modelo em texto está em [`modelo.md`](modelo.md).

## A história

Uma clínica agenda consultas, os médicos registram o atendimento no prontuário e o faturamento cobra do convênio. Três contextos:

- **Agenda** (`core`): quando cada profissional atende quem.
- **Prontuário** (`core`): o histórico clínico, sigiloso e auditável.
- **Faturamento** (`supporting`): cobrar o que foi atendido.

## Como ler

1. **Visão geral**: `agenda` e `prontuario` têm um `shared-kernel` (a identidade do paciente), e `agenda` fornece `consulta-realizada` ao `faturamento` (`customer-supplier`).
2. Em **Agenda**, os três commands (`agendar-consulta`, `cancelar-consulta`, `marcar-consulta-realizada`) acionam o mesmo aggregate, `agenda-do-profissional`, que contém os `horario`.
3. Em **Faturamento**, `consulta-realizada` é um evento da Agenda (`external`); a policy `faturar-ao-realizar` o transforma em `emitir-guia`.

## Decisões de modelagem (e por quê)

- **O aggregate é a agenda do profissional, não a consulta.** A regra "dois horários do mesmo profissional não se sobrepõem" só pode ser garantida olhando *todos* os horários dele juntos. Modelar `Consulta` como aggregate permitiria dois agendamentos simultâneos (corrida entre duas transações). O `horario` é uma entity dentro dele.
- **"Paciente" significa coisas diferentes em cada contexto.** Na Agenda é quem ocupa um horário; no Prontuário é o histórico clínico; no Faturamento seria o pagador. Cada contexto tem o seu modelo, e eles só concordam sobre a **identidade**.
- **Shared Kernel assumido de propósito.** Agenda e Prontuário compartilham o value object `paciente` (id, nome, documento) e mudam isso **juntos**. É uma exceção consciente à regra de "cada contexto com o seu modelo", válida porque as duas equipes conversam todo dia. Se um dia não conversarem mais, vira `customer-supplier` ou `acl`.
- **Prontuário nunca apaga.** A invariante "registro assinado nunca é apagado, só retificado" é por isso que existe o command `corrigir-atendimento` e o evento `atendimento-retificado`, em vez de um "editar".
- **O preço vem de um domain service** (`tabela-de-precos`): depende do convênio e da data, é regra pura, e não pertence à `guia`.
- **`guia` contém `item-da-guia`, que contém `valor`**: uma entity com um value object, ilustrando o aninhamento (`contains` pode encadear).

## Casos de uso → modelo

| Caso de uso | Command | Aggregate | Evento |
|---|---|---|---|
| Agendar consulta (`agendar-uc`) | `agendar-consulta` | `agenda-do-profissional` | `consulta-agendada` |
| Cancelar consulta (`cancelar-uc`) | `cancelar-consulta` | `agenda-do-profissional` | `consulta-cancelada` |
| Registrar atendimento realizado (`realizar-uc`) | `marcar-consulta-realizada` | `agenda-do-profissional` | `consulta-realizada` |
| Registrar atendimento (`registrar-uc`) | `registrar-atendimento` | `prontuario-do-paciente` | `atendimento-registrado` |
| Faturar consulta (`faturar-uc`) | `emitir-guia` | `guia` | `guia-emitida` |

## Experimente

1. **Rastreie uma consulta de ponta a ponta:** `agendar-consulta` → `consulta-agendada` → (mais tarde) `marcar-consulta-realizada` → `consulta-realizada` → *Faturamento* → `emitir-guia` → `guia-emitida`. Passe pelos dois contextos sem nenhuma chamada direta entre eles, só eventos.
2. **Mude o relacionamento.** Troque o `shared-kernel` por `acl` no mapa (selecione a conexão, escolha o padrão no inspetor). O que cada equipe passaria a ter que fazer?
3. **Teste a fronteira.** E se o `horario` virasse aggregate? Que regra deixaria de poder ser garantida?
4. **Gere o código** (aba *Código*) e veja o aggregate `agenda-do-profissional` com a lista de horários (`horario`).
