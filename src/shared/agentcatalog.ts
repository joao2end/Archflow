/**
 * Catálogo de agentes do modo agents: PAPÉIS (um agente pronto) e TIMES (vários agentes já ligados).
 *
 * Um papel é um time de um agente só. Aplicar um modelo gera as `Op`s que criam os nós e as relações no diagrama
 * aberto, com `usage` em cada relação (aviso A018) e reaproveitando o que já existe: uma tool nativa, uma skill do
 * catálogo ou um servidor MCP do catálogo que já esteja no diagrama é só ligado, não duplicado.
 *
 * Puro: sem I/O. Skills do catálogo entram NÃO resolvidas (`source` sem `hash`, aviso A006): quem aplica resolve ao
 * abrir a skill; nada é baixado aqui. Servidores MCP vêm de `MCP_CATALOG` (só entradas conferidas na fonte).
 */
import { findMcpCatalogEntry, mcpEntryToSpec } from "./mcpcatalog";
import { applyOps, uniqueId, type Op } from "./ops";
import { NODE_SIZE, occupied } from "./placement";
import { AGENT_RELS, NATIVE_TOOL_NAMES, type Doc, type NodeEl } from "./schema";

/** Skill do catálogo (GitHub). `description` é provisória até a skill ser resolvida. */
export interface SkillRef {
  name: string;
  repo: string;
  skillPath: string;
  description: string;
}

export interface TemplateAgent {
  /** chave local para as delegações; não vira id */
  key: string;
  label: string;
  /** quando o orquestrador deve delegar para ele */
  description: string;
  prompt: string;
  model?: string;
  /** tools nativas (Read, Bash…), cada uma com o «como usa» */
  tools?: { name: string; usage: string }[];
  skills?: { ref: SkillRef; usage: string }[];
  /** servidores do `MCP_CATALOG` por id */
  mcps?: { id: string; usage: string; allow?: string[] }[];
}

export interface AgentTemplate {
  id: string;
  kind: "role" | "team";
  name: string;
  description: string;
  tags: string[];
  agents: TemplateAgent[];
  /** quem aciona quem, com o «como usa» */
  delegations?: { from: string; to: string; usage: string; label?: string }[];
}

/* ───────────────────────── skills de catálogo usadas pelos modelos ───────────────────────── */

const SKILLS = {
  copywriting: { name: "copywriting", repo: "coreyhaines31/marketingskills", skillPath: "skills/copywriting/SKILL.md", description: "Escreve e melhora copy de marketing para páginas, headlines e CTAs. Use ao redigir ou revisar textos de página." },
  frontendDesign: { name: "frontend-design", repo: "anthropics/skills", skillPath: "skills/frontend-design/SKILL.md", description: "Direção estética, tipografia e hierarquia para construir interface distintiva. Use ao desenhar ou implementar layout." },
  seo: { name: "seo", repo: "addyosmani/web-quality-skills", skillPath: "skills/seo/SKILL.md", description: "Otimiza visibilidade em busca: metadados, dados estruturados e sitemap. Use ao melhorar SEO de uma página." },
  accessibility: { name: "accessibility", repo: "addyosmani/web-quality-skills", skillPath: "skills/accessibility/SKILL.md", description: "Audita e melhora acessibilidade seguindo WCAG 2.2. Use ao revisar ou implementar interface." },
  conversionAudit: { name: "landing-page-conversion-audit", repo: "autonnel/autonnel-skills", skillPath: "landing-page-conversion-audit/SKILL.md", description: "Audita uma landing page e lista vazamentos de conversão por impacto. Use ao revisar uma página de captura." },
} satisfies Record<string, SkillRef>;

/* ───────────────────────── agentes reutilizáveis ───────────────────────── */

const orchestrator = (steps: string): TemplateAgent => ({
  key: "orquestrador",
  label: "Orquestrador",
  description: "Coordena o time: recebe o pedido, divide o trabalho entre os agentes, passa só o necessário a cada um e consolida a entrega. Use sempre como ponto de entrada.",
  prompt: `Você é o orquestrador do time.\n\nFluxo:\n1. Leia o pedido e o objetivo. Se faltar algo crítico, pergunte antes de delegar.\n2. ${steps}\n3. Passe a cada agente apenas o que ele precisa (o resultado do anterior e o contexto).\n4. Se uma etapa de revisão reprovar, devolva os apontamentos ao responsável e repita (no máximo 3 ciclos).\n5. Entregue um resumo: o que foi feito, decisões tomadas e pendências.`,
  tools: [
    { name: "Agent", usage: "Para acionar cada agente do time, uma etapa por vez." },
    { name: "Read", usage: "Para ler os artefatos produzidos antes de passar adiante." },
  ],
});

const reviewer: TemplateAgent = {
  key: "revisor",
  label: "Revisor de código",
  description: "Revisa mudanças de código: aponta bugs, riscos de segurança, problemas de estilo e testes que faltam. Use depois que uma implementação estiver pronta; não edita o código.",
  prompt: "Você revisa o diff com cuidado e sem editar nada.\n\nPara cada problema, diga: arquivo e linha, o que está errado, por que importa e a correção sugerida. Separe o que bloqueia a entrega do que é sugestão. Termine com APROVADO ou REPROVADO.",
  tools: [
    { name: "Read", usage: "Para ler os arquivos alterados e o código ao redor." },
    { name: "Grep", usage: "Para achar usos e chamadores do que mudou." },
    { name: "Glob", usage: "Para localizar testes e arquivos relacionados." },
  ],
};

const uiQa: TemplateAgent = {
  key: "qa-interface",
  label: "QA de interface",
  description: "Testa a interface pronta num navegador real: fluxos principais, formulários, responsividade e erros no console. Use depois da implementação e antes de aprovar.",
  prompt: "Você testa a interface como um usuário, em um navegador de verdade.\n\nAbra a página, percorra os fluxos principais, preencha os formulários, teste 360, 768 e 1280px e olhe o console. Reporte cada falha com o passo a passo para reproduzir e termine com APROVADO ou REPROVADO. Não edite o código.",
  tools: [{ name: "Read", usage: "Para ler o que foi pedido e comparar com o resultado." }],
  mcps: [{ id: "playwright", usage: "Para abrir a página, clicar, preencher formulários e capturar screenshots; use sempre que precisar ver o resultado de verdade." }],
};

const researcher: TemplateAgent = {
  key: "pesquisador",
  label: "Pesquisador",
  description: "Pesquisa um assunto na web e na documentação de bibliotecas e devolve fatos com fonte. Use antes de escrever ou decidir algo que depende de informação externa.",
  prompt: "Você pesquisa e devolve fatos com a fonte de cada um.\n\nSepare o que está confirmado do que é inferência, cite a URL de cada afirmação importante e diga quando não encontrou. Não invente números nem citações.",
  tools: [
    { name: "WebSearch", usage: "Para achar fontes sobre o assunto." },
    { name: "WebFetch", usage: "Para ler a página inteira da fonte antes de citá-la." },
    { name: "Read", usage: "Para ler o material que o time já tem." },
  ],
  mcps: [{ id: "context7", usage: "Para consultar a documentação atualizada de bibliotecas e frameworks em vez de confiar na memória." }],
};

const writer: TemplateAgent = {
  key: "redator",
  label: "Redator",
  description: "Escreve e revisa textos a partir do material pesquisado: estrutura, títulos, chamadas e versão final. Use depois da pesquisa.",
  prompt: "Você escreve com clareza, frases curtas e voz ativa.\n\nUse apenas fatos do material recebido; marque como PENDENTE o que não tiver fonte. Entregue o texto final e uma lista do que precisa de confirmação.",
  tools: [
    { name: "Read", usage: "Para ler a pesquisa e o briefing." },
    { name: "Write", usage: "Para gravar o texto final em arquivo." },
    { name: "Edit", usage: "Para ajustar o texto depois da revisão." },
  ],
  skills: [{ ref: SKILLS.copywriting, usage: "Puxe ao estruturar o texto e escrever títulos e chamadas." }],
};

/* ───────────────────────── modelos ───────────────────────── */

const roles: AgentTemplate[] = [
  { id: "role-orquestrador", kind: "role", name: "Orquestrador", description: "Coordena um time: divide o pedido, aciona cada agente e consolida a entrega.", tags: ["orquestrador", "coordena", "delega", "time"], agents: [orchestrator("Delegue para os agentes do time na ordem que o pedido exigir.")] },
  { id: "role-revisor-codigo", kind: "role", name: "Revisor de código", description: "Revisa diffs: bugs, segurança, estilo e testes que faltam, sem editar.", tags: ["revisão", "código", "pull request", "bugs", "segurança"], agents: [reviewer] },
  { id: "role-qa-interface", kind: "role", name: "QA de interface", description: "Testa a interface num navegador real (Playwright): fluxos, formulários e responsividade.", tags: ["qa", "teste", "navegador", "interface", "playwright"], agents: [uiQa] },
  { id: "role-pesquisador", kind: "role", name: "Pesquisador", description: "Pesquisa na web e na documentação de bibliotecas e devolve fatos com fonte.", tags: ["pesquisa", "web", "documentação", "fontes"], agents: [researcher] },
  { id: "role-redator", kind: "role", name: "Redator", description: "Escreve e revisa textos a partir de um material, com a skill de copywriting.", tags: ["texto", "copy", "redação", "conteúdo"], agents: [writer] },
];

const landing: AgentTemplate = {
  id: "team-landing-page",
  kind: "team",
  name: "Landing page",
  description: "Cria uma landing page: copy, design, código, SEO e QA, com um orquestrador. Resultado em docs/ e site/.",
  tags: ["landing page", "site", "web", "marketing", "front-end", "seo"],
  agents: [
    orchestrator("Delegue nesta ordem: estrategista de conteúdo → designer → desenvolvedor front-end → especialista em SEO → QA de interface."),
    {
      key: "conteudo",
      label: "Estrategista de conteúdo",
      description: "Define a mensagem e escreve a copy da página: proposta de valor, seções, headlines, CTAs e FAQ. Use depois do briefing e antes do design.",
      prompt: "Você é estrategista de conteúdo.\n\nEntregue docs/copy.md com proposta de valor, estrutura de seções (hero, dores, solução, prova social, como funciona, FAQ, CTA final), headlines e microcopy de botões e formulário. Não invente números, clientes ou depoimentos: use placeholders marcados como PENDENTE.",
      tools: [{ name: "Read", usage: "Para ler o briefing." }, { name: "Write", usage: "Para gravar docs/copy.md." }],
      skills: [{ ref: SKILLS.copywriting, usage: "Puxe ao estruturar as seções e escrever headlines, CTAs e FAQ; use as fórmulas para a proposta de valor, não para inflar promessas." }],
    },
    {
      key: "design",
      label: "Designer UX/UI",
      description: "Transforma a copy em layout e sistema visual: hierarquia, grid, paleta, tipografia, componentes e versão mobile. Use quando a copy estiver aprovada.",
      prompt: "Você é designer UX/UI.\n\nA partir de docs/copy.md, produza docs/design.md com wireframe textual por seção, tokens (cores, tipografia, espaçamento, raios), componentes e comportamento responsivo (mobile-first). Garanta contraste AA e CTA visível sem rolar.",
      tools: [{ name: "Read", usage: "Para ler docs/copy.md." }, { name: "Write", usage: "Para gravar docs/design.md." }],
      skills: [{ ref: SKILLS.frontendDesign, usage: "Use ao definir direção estética, tipografia e hierarquia, evitando layout genérico de template." }],
    },
    {
      key: "frontend",
      label: "Desenvolvedor front-end",
      description: "Implementa a página em HTML, CSS e JS seguindo a copy e o design, responsiva, acessível e rápida. Use quando copy e design estiverem prontos.",
      prompt: "Você é desenvolvedor front-end.\n\nImplemente em site/ fiel a docs/copy.md e docs/design.md. Priorize HTML semântico, CSS com variáveis dos tokens, JS mínimo, imagens otimizadas e formulário com validação.",
      tools: [
        { name: "Read", usage: "Para ler copy e design." },
        { name: "Write", usage: "Para criar os arquivos de site/." },
        { name: "Edit", usage: "Para ajustar o código depois da revisão." },
        { name: "Bash", usage: "Só para rodar lint e testes; nunca comandos destrutivos." },
      ],
      skills: [
        { ref: SKILLS.frontendDesign, usage: "Consulte ao implementar CSS e componentes para manter a direção visual do design." },
        { ref: SKILLS.accessibility, usage: "Aplique durante a implementação: HTML semântico, foco visível, rótulos e contraste AA já no código." },
      ],
    },
    {
      key: "seo",
      label: "Especialista em SEO",
      description: "Otimiza a página para busca e compartilhamento: title, meta, headings, dados estruturados, Open Graph e sitemap. Use depois da implementação.",
      prompt: "Você é especialista em SEO técnico e on-page.\n\nRevise site/: title e description únicos, hierarquia de headings, alt de imagens, schema.org, Open Graph, canonical, robots e sitemap. Aplique as correções direto no código e liste o que mudou.",
      tools: [{ name: "Read", usage: "Para ler o código do site." }, { name: "Edit", usage: "Para aplicar as correções de SEO." }, { name: "Grep", usage: "Para achar metadados e headings em todo o site." }],
      skills: [{ ref: SKILLS.seo, usage: "Siga como roteiro da otimização: title, description, headings, JSON-LD, Open Graph, canonical, robots e sitemap." }],
    },
    {
      ...uiQa,
      description: "Audita a página pronta: acessibilidade, responsividade, links, formulário e conversão. Aprova ou devolve apontamentos. Use como última etapa.",
      skills: [
        { ref: SKILLS.accessibility, usage: "Use como critério de auditoria WCAG: reprove o que violar contraste, teclado, rótulos ou semântica." },
        { ref: SKILLS.conversionAudit, usage: "Rode no fim da revisão para listar vazamentos de conversão (CTA, formulário, prova social) por impacto." },
      ],
    },
  ],
  delegations: [
    { from: "orquestrador", to: "conteudo", usage: "Etapa 1. Passa o briefing (objetivo, público, CTA) e recebe docs/copy.md com seções, headlines e pendências marcadas; só avança ao design depois da copy aprovada.", label: "1. copy" },
    { from: "orquestrador", to: "design", usage: "Etapa 2. Passa docs/copy.md aprovado e recebe docs/design.md (wireframe por seção, tokens e comportamento responsivo).", label: "2. design" },
    { from: "orquestrador", to: "frontend", usage: "Etapa 3. Passa copy e design e recebe a página implementada em site/, com lint limpo antes de seguir.", label: "3. código" },
    { from: "orquestrador", to: "seo", usage: "Etapa 4. Passa site/ pronto e recebe o código otimizado (metadados, dados estruturados, sitemap) com a lista do que mudou.", label: "4. SEO" },
    { from: "orquestrador", to: "qa-interface", usage: "Etapa 5, última. Passa site/ e os docs e recebe APROVADO ou REPROVADO com problemas por agente responsável; se reprovar, devolve ao responsável (máx. 3 ciclos).", label: "5. QA" },
  ],
};

const prReview: AgentTemplate = {
  id: "team-revisao-codigo",
  kind: "team",
  name: "Revisão de código",
  description: "Revisa uma mudança de código e testa a interface afetada: um revisor e um QA de interface, coordenados.",
  tags: ["revisão", "código", "pull request", "qa", "teste"],
  agents: [orchestrator("Delegue primeiro ao revisor de código; se a mudança afetar interface, depois ao QA de interface."), reviewer, uiQa],
  delegations: [
    { from: "orquestrador", to: "revisor", usage: "Etapa 1. Passa o diff e o objetivo da mudança e recebe a lista de problemas (bloqueantes e sugestões) com APROVADO ou REPROVADO.", label: "1. código" },
    { from: "orquestrador", to: "qa-interface", usage: "Etapa 2, só se a mudança afetar interface. Passa o que mudou e como abrir a página e recebe o resultado dos testes no navegador.", label: "2. interface" },
  ],
};

const research: AgentTemplate = {
  id: "team-pesquisa-relatorio",
  kind: "team",
  name: "Pesquisa e relatório",
  description: "Pesquisa um tema com fontes e escreve o relatório: pesquisador e redator, coordenados.",
  tags: ["pesquisa", "relatório", "texto", "fontes", "conteúdo"],
  agents: [orchestrator("Delegue ao pesquisador e, com a pesquisa pronta, ao redator."), researcher, writer],
  delegations: [
    { from: "orquestrador", to: "pesquisador", usage: "Etapa 1. Passa o tema e as perguntas e recebe fatos com a URL de cada fonte, separando confirmado de inferência.", label: "1. pesquisa" },
    { from: "orquestrador", to: "redator", usage: "Etapa 2. Passa a pesquisa e o briefing e recebe o relatório final, com a lista do que precisa de confirmação.", label: "2. texto" },
  ],
};

export const AGENT_TEMPLATES: AgentTemplate[] = [...roles, landing, prReview, research];

export const findAgentTemplate = (id: string): AgentTemplate | undefined => AGENT_TEMPLATES.find((t) => t.id === id);

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Busca por nome, descrição e tags (todas as palavras precisam casar); `kind` filtra papéis ou times. */
export function searchAgentTemplates(query: string, kind?: AgentTemplate["kind"]): AgentTemplate[] {
  const words = norm(query).split(/\s+/).filter(Boolean);
  return AGENT_TEMPLATES.filter((t) => (!kind || t.kind === kind) && words.every((w) => norm([t.name, t.description, t.tags.join(" "), t.agents.map((a) => a.label).join(" ")].join(" ")).includes(w)));
}

/* ───────────────────────── aplicar ───────────────────────── */

const GAP_X = 248;
const ROW_Y = 264;

export interface ApplyResult {
  ops: Op[];
  /** ids dos agentes criados, na ordem do modelo */
  agentIds: string[];
  /** quantos nós já existentes foram reaproveitados (tools, skills, MCP) */
  reused: number;
}

/**
 * Gera as ops que aplicam `tpl` no diagrama `doc`, com a ponta superior esquerda em `at`. Os ids são calculados contra
 * um documento de trabalho, então aplicar `ops` em `doc` reproduz exatamente o que foi planejado.
 */
export function applyTemplate(doc: Doc, tpl: AgentTemplate, at: { x: number; y: number }): ApplyResult {
  let work = doc;
  const ops: Op[] = [];
  let reused = 0;
  const run = (op: Op): string => {
    const r = applyOps(work, [op]);
    if (!r.results[0].ok) throw new Error(`modelo «${tpl.id}»: ${r.results[0].error}`);
    work = r.doc;
    ops.push(op);
    return r.results[0].id ?? "";
  };
  const node = (id: string) => work.nodes.find((n) => n.id === id) as NodeEl;
  const connect = (from: string, to: string, rel: "uses-skill" | "uses-tool" | "delegates", usage: string, extra: { allow?: string[]; label?: string } = {}) => {
    if (work.connections.some((c) => c.from === from && c.to === to && c.agent?.rel === rel)) return;
    run({ op: "add_connection", from, to, type: AGENT_RELS[rel].type, ...(extra.label ? { label: extra.label } : {}), agent: { rel, usage, ...(extra.allow?.length ? { allow: extra.allow } : {}) } });
  };

  // 1) agentes: orquestradores (sem delegação recebida) na linha de cima, o resto na de baixo
  const incoming = new Set((tpl.delegations ?? []).map((d) => d.to));
  const top = tpl.agents.filter((a) => !incoming.has(a.key));
  const rest = tpl.agents.filter((a) => incoming.has(a.key));
  const idOf = new Map<string, string>();
  let x = at.x;
  const place = (a: TemplateAgent, y: number, px: number) => {
    const id = uniqueId(work, a.label);
    run({ op: "add_node", id, label: a.label, asset: "agent-agent", agent: { role: "agent", description: a.description, model: a.model ?? "inherit", prompt: a.prompt }, x: Math.round(px / 8) * 8, y: Math.round(y / 8) * 8 });
    idOf.set(a.key, id);
  };
  const row = rest.length ? rest : top;
  const span = row.length * GAP_X;
  for (const a of row) {
    place(a, rest.length ? at.y + ROW_Y : at.y, x);
    x += GAP_X;
  }
  if (rest.length) {
    top.forEach((a, i) => place(a, at.y, at.x + span / 2 - GAP_X / 2 + i * GAP_X));
  }

  // 2) delegações
  for (const d of tpl.delegations ?? []) connect(idOf.get(d.from)!, idOf.get(d.to)!, "delegates", d.usage, { label: d.label });

  // 3) ferramentas, skills e MCP de cada agente (reaproveitando o que já existe no diagrama)
  for (const a of tpl.agents) {
    const agentId = idOf.get(a.key)!;
    // ferramentas e skills: em coluna sob o agente (compacto); nos agentes-raiz, ao lado, para não cruzar as setas de delegação
    const isRoot = rest.length > 0 && top.includes(a);
    const spot = () => {
      const ag = node(agentId);
      const taken = occupied(work);
      for (let k = 0; k < 60; k++) {
        const c = isRoot ? { x: ag.x + (k + 1) * GAP_X, y: ag.y } : { x: ag.x, y: Math.round((ag.y + ag.h + 56 + k * (NODE_SIZE.h + 24)) / 8) * 8 };
        if (!taken.some((r) => c.x < r.x + r.w + 12 && r.x < c.x + NODE_SIZE.w + 12 && c.y < r.y + r.h + 12 && r.y < c.y + NODE_SIZE.h + 12)) return c;
      }
      return { x: ag.x, y: ag.y + ag.h + 56 };
    };
    for (const t of a.tools ?? []) {
      if (!NATIVE_TOOL_NAMES.includes(t.name)) throw new Error(`modelo «${tpl.id}»: tool nativa desconhecida «${t.name}»`);
      let n = work.nodes.find((x2) => x2.agent?.role === "tool" && x2.agent.toolType === "native" && x2.agent.toolName === t.name);
      if (n) reused++;
      else {
        const p = spot();
        n = node(run({ op: "add_node", id: uniqueId(work, t.name), label: t.name, asset: "agent-tool", agent: { role: "tool", toolType: "native", toolName: t.name }, ...p }));
      }
      connect(agentId, n.id, "uses-tool", t.usage);
    }
    for (const s of a.skills ?? []) {
      let n = work.nodes.find((x2) => x2.agent?.role === "skill" && x2.agent.source?.repo === s.ref.repo && x2.agent.source.skillPath === s.ref.skillPath);
      if (n) reused++;
      else {
        const p = spot();
        n = node(run({ op: "add_node", id: uniqueId(work, s.ref.name), label: s.ref.name, asset: "agent-skill", agent: { role: "skill", description: s.ref.description, source: { repo: s.ref.repo, skillPath: s.ref.skillPath } }, ...p }));
      }
      connect(agentId, n.id, "uses-skill", s.usage);
    }
    for (const m of a.mcps ?? []) {
      const entry = findMcpCatalogEntry(m.id);
      if (!entry) throw new Error(`modelo «${tpl.id}»: servidor MCP «${m.id}» não existe no catálogo`);
      let n = work.nodes.find((x2) => x2.agent?.role === "tool" && x2.agent.mcpSource?.id === entry.id && x2.agent.mcpSource.catalog === entry.origin);
      if (n) reused++;
      else {
        const p = spot();
        n = node(run({ op: "add_node", id: uniqueId(work, entry.id), label: entry.name, asset: "agent-tool", agent: mcpEntryToSpec(entry), ...p }));
      }
      connect(agentId, n.id, "uses-tool", m.usage, { allow: m.allow });
    }
  }
  return { ops, agentIds: tpl.agents.map((a) => idOf.get(a.key)!), reused };
}
