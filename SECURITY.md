# Segurança

Se você encontrou uma vulnerabilidade, **não abra uma issue pública**. Use o recurso *Report a vulnerability* da aba
Security do repositório no GitHub (ou escreva para a 2.end) com os passos para reproduzir. Respondemos o mais rápido possível.

Pontos úteis para quem avalia o projeto:

- No acesso online ([archflow.2-end.online](https://archflow.2-end.online)) o servidor roda em modo público e **não guarda dados**: os projetos ficam só no navegador de cada visitante.
- O bridge local escuta em `127.0.0.1`; o instalador do Windows não é assinado digitalmente (veja o README).
- **Terminal do Claude Code (modo Agents):** abrir um shell a partir de uma página web é um risco clássico (qualquer site aberto no navegador poderia tentar falar com `localhost`). O Archflow o trata assim: o terminal só existe com o bridge local em `127.0.0.1` (fora do loopback só com `ARCHFLOW_TERM=1`) e **nunca** no modo público; o WebSocket só aceita `Origin` igual ao `Host` e um token aleatório gerado a cada inicialização, comparado em tempo constante; os comandos de criar e encerrar sessão exigem o mesmo token num header customizado (o que força preflight de CORS, que o bridge não responde). O programa executado é fixo (`claude` ou o shell do próprio usuário), sem interpolar entrada em shell, e o Archflow nunca passa `--dangerously-skip-permissions`: as permissões e a aprovação de servidores MCP seguem o modelo normal do Claude Code. Quem já executa código na sua conta (outro processo local) não é coberto por esse modelo, assim como não é pelo restante do bridge, cujas rotas não têm autenticação. Desligue com `ARCHFLOW_TERM=0`.
