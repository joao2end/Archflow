# Contribuindo com o Archflow

Obrigado pelo interesse! Este guia resume como rodar o projeto e o que esperamos de uma contribuição.

## Ambiente

Requisitos: **Node.js 22+** e npm.

```bash
npm install
npm run dev        # app em http://localhost:5173/app + bridge local (porta 7077)
```

## Antes de abrir um PR

```bash
npm run typecheck
npm test
npm run examples:build -- --check   # exemplos de DDD em dia
```

O CI roda esses mesmos passos mais o build de produção.

## Convenções

- **Estrutura:** `src/shared` é compartilhado por UI, bridge e MCP (sem dependência de React); veja o mapa no [README](README.md#estrutura).
- **Mudou o schema ou uma tool do MCP?** Atualize `skills/archflow/SKILL.md` (`npm run skill`) e [`docs/PROTOCOL.md`](docs/PROTOCOL.md).
- **Diagramas de arquitetura não podem mudar** com mudanças no modo Domain — há um teste de regressão para isso.
- Commits curtos e no imperativo, com o motivo no corpo quando não for óbvio.
- Textos da interface e da documentação em português do Brasil.

## Reportando problemas

Abra uma issue com passos para reproduzir, versão (online ou instalador) e navegador/sistema. Para falhas de segurança, veja [SECURITY.md](SECURITY.md).
