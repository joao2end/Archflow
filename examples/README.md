# Exemplos de DDD

Modelos prontos do modo **Domain** do Archflow, para aprender DDD e para usar como ponto de partida. Antes de começar, o guia [`docs/DDD.md`](../docs/DDD.md) explica os conceitos (subdomínios, bounded contexts, aggregates, eventos, sagas...) e como cada um aparece no Archflow.

| Exemplo | Nível | Para aprender |
| --- | --- | --- |
| [Biblioteca universitária](exemplos-ddd/biblioteca/README.md) | iniciante | aggregate definido pela invariante, entity × value object, policy, domain service, read model, context map |
| [Clínica médica](exemplos-ddd/clinica/README.md) | intermediário | onde traçar a fronteira do aggregate, linguagem diferente por contexto, shared kernel |
| [Loja online](exemplos-ddd/loja/README.md) | intermediário | saga com compensação, anticorruption layer, eventos entre contextos, do domínio à arquitetura |
| [Banco digital](exemplos-ddd/banco/README.md) | avançado | um aggregate por transação, consistência eventual, saga de transferência, published language |
| [Delivery de comida (tour completo)](exemplos-ddd/delivery/README.md) | avançado | **todos os recursos**: os 8 padrões do Context Map, decisões exclusiva/paralela/junção, loop, "para cada", propriedades, saga, notas |

Sugestão de ordem: **Biblioteca → Clínica → Loja → Banco → Delivery** (o último reúne tudo o que os outros mostram separadamente).

## Como usar

**No app:** explorador de arquivos → botão ✨ *Exemplos de DDD* → *Instalar e abrir*. O exemplo vira a pasta `exemplos-ddd/<exemplo>/` no cofre aberto (nada é sobrescrito) e abre o mapa de contextos; clique em um contexto para entrar nele.

**Fora do app:** copie a pasta `examples/exemplos-ddd` para dentro de um cofre do Archflow (a pasta do cofre, a que contém seus `.archflow.json`). Os vínculos entre o mapa de contextos, os contextos e a arquitetura usam esses caminhos, então mantenha a estrutura `exemplos-ddd/<exemplo>/`.

**Cada pasta tem:**

- `visao-geral.archflow.json`: o mapa de contextos (com os padrões do Context Map);
- um `.archflow.json` por bounded context (e a arquitetura, na loja);
- `modelo.md`: o modelo em texto, exatamente o que um agente de IA lê via MCP (`get_diagram`, `domain_overview`). Gerado, não edite;
- `README.md`: a história, como ler os diagramas, as decisões de modelagem e exercícios.

## Para os agentes (MCP)

Peça: *"Leia o domínio em `exemplos-ddd/loja` com `domain_overview` e explique a saga de checkout"*, ou *"gere o esqueleto de código do contexto Pedidos"* (`generate_code`). Para medir a qualidade de um modelo: `npm run eval:domain -- examples/exemplos-ddd/loja/pedidos.archflow.json`.

## Garantias

Os exemplos são definidos em `src/shared/examples.ts` e **testados**: todos os diagramas validam sem erros nem avisos, todo caso de uso é rastreado até um evento, o esqueleto de código de cada um compila com `tsc --strict` e os arquivos desta pasta estão em dia com as definições. Para regenerar depois de mudar uma definição: `npm run examples:build`.
