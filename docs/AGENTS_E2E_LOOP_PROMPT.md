# Loop de testes — modo agents (intervalo de 5 min, para em 100%)

Acionado com `ScheduleWakeup` de 300 s. Cada tick faz UMA rodada de verificação e registra o resultado.

## Critério de parada (100%)

Pare o loop (não rearme) somente quando TODOS forem verdade:

1. `npx tsx --test` dos arquivos de agents (`src/shared/agents*.test.ts`, `skillcatalog.test.ts`, `zip.test.ts`) passa 100%.
2. `npx tsc --noEmit` limpo.
3. Toda linha de `docs/agents-scenarios.md` tem cobertura **U** ou **E** verificada nesta rodada, ou foi marcada como descartada pelo usuário.
4. Todos os roteiros E2E da seção 6 do mapa foram executados no navegador e passaram.
5. Zero defeitos abertos em `docs/agents-defects.md` (defeito fechado = corrigido com teste de regressão, ou aceito pelo usuário).

Se faltar qualquer item e não houver mais nada que você possa fazer sem o usuário, pare e diga exatamente o que falta.

## Cada tick

1. Leia `docs/agents-scenarios.md` e `docs/agents-defects.md`. Escolha a primeira linha pendente.
2. Rode a suíte unitária e o `tsc`. Se algo falhar, corrija o que é seu (teste novo ou correção comprovada) e registre.
3. Para cenários de UI, suba o Vite isolado (porta 5190, bridge 7090, dados no scratchpad) e rode o roteiro com `playwright-core` (`channel: "msedge"`). Nunca mate processos por nome; encerre só o PID que você subiu.
4. Registre o resultado: marque a linha em `agents-scenarios.md` com U/E e a data; abra defeito em `agents-defects.md` para cada divergência (sintoma, arquivo, severidade, reprodução).
5. Não corrija comportamento do app sem teste de regressão. Não altere `package.json`. Não faça commit.
6. Termine o tick com: `AGENTS E2E LOOP #<n>`, o que foi verificado, o que falhou, e a próxima linha. Se o critério de parada foi atingido, pare; senão rearme em 300 s.
