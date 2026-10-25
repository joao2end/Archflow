/**
 * Passo a passo (narrativa) de um diagrama de domínio, para a apresentação.
 *
 * Cada caso de uso vira uma história: ator → caso de uso → command → aggregate → evento → reações (policy, saga,
 * decisão, read model) → commands seguintes… Cada passo diz O QUE é o elemento (definição do papel + o que o autor escreveu),
 * POR QUE ele está ali (motivo do papel naquele ponto) e COMO se chegou nele (a relação percorrida).
 *
 * Puro e determinístico: só lê o Doc.
 */
import { DDD_ROLES, FLOW_RELS, type ConnectionEl, type DddRel, type DddRole, type Doc, type NodeEl, type PropertySpec } from "./schema";

export interface StoryStep {
  /** id do componente em foco */
  id: string;
  role: DddRole | "actor" | "context";
  roleLabel: string;
  title: string;
  /** bounded context do componente */
  context?: string;
  /** definição geral do papel */
  what: string;
  /** o que o autor declarou sobre este elemento (descrição, intenção, payload…) */
  details: { label: string; text: string }[];
  /** motivo de o elemento existir neste ponto do fluxo */
  why: string;
  /** relação percorrida para chegar aqui, em uma frase */
  because?: string;
  /** estrutura do elemento, campo a campo (entity, VO, aggregate, command, evento, read model) */
  properties: PropertySpec[];
  /** regras que sempre valem (invariantes) */
  rules: string[];
  /** caminhos que saem deste passo quando há condição, "senão", loop ou "para cada" */
  branches: { to: string; toLabel: string; text: string }[];
  /** conexões percorridas para chegar neste passo (ficam animadas) */
  connIds: string[];
  /** elementos auxiliares destacados junto (ex.: entities do aggregate, repository usado) */
  extraIds: string[];
}

export interface Story {
  id: string;
  title: string;
  /** objetivo de negócio, quando é a história de um caso de uso */
  goal?: string;
  steps: StoryStep[];
}

const WHY: Record<string, string> = {
  entity: "Tem identidade própria, mas só existe dentro do aggregate: quem de fora precisa dela passa pela raiz, que protege as regras do conjunto.",
  "value-object": "Valor imutável, comparado pelo conteúdo. Dá nome e regras a um conceito (dinheiro, endereço) em vez de espalhar tipos primitivos pelo modelo.",
  repository: "Faz o aggregate parecer uma coleção em memória e esconde o banco. A interface fica no domínio; quem a implementa é a infraestrutura.",
  "domain-service": "Guarda uma regra de negócio que não pertence a nenhum aggregate sozinho, sem estado e sem I/O.",
  "application-service": "Orquestra o caso de uso (carrega, chama o domínio, persiste, publica) sem conter regra de negócio.",
  context: "Define uma fronteira: dentro dela cada termo tem um só significado, e o que atravessa a fronteira é negociado explicitamente (Context Map).",
  actor: "Quem inicia o fluxo. Sem um ator não há motivo de negócio para o sistema agir: é ele quem dá sentido a tudo o que vem depois.",
  "use-case": "Liga a necessidade de quem usa o sistema ao command que a atende. Tudo o que vem a seguir existe para cumprir este objetivo.",
  command: "É a intenção de mudar o estado, no imperativo. Separar o pedido (command) do resultado (evento) deixa claro quem pode aceitar ou recusar a mudança.",
  "aggregate-root": "Fica entre o command e o estado: só ele altera os próprios dados. Assim as invariantes (regras que sempre valem) nunca são violadas, não importa quem o chame.",
  "domain-event": "Registra o fato já consumado, no passado. Quem reage a ele não precisa ser conhecido por quem o produziu, o que mantém os contextos desacoplados.",
  policy: "Automatiza a regra \"quando isto acontece, faça aquilo\" sem ninguém precisar lembrar. Vive fora do aggregate para que ele não dependa de outros processos.",
  "process-manager": "Coordena um fluxo longo que passa por vários passos ou contextos e sabe compensar (desfazer) o que já foi feito se algo falhar.",
  controller: "É a porta de entrada: recebe o pedido de fora (tela, API, mensagem), traduz a entrada e aciona o caso de uso. Fica em Interface Adapters para que a regra de negócio não dependa de como o pedido chegou.",
  "read-model": "Projeção pensada para consulta. Separa a leitura da escrita, para que telas e relatórios sejam rápidos sem pesar no modelo que garante as regras.",
};

const VERB: Record<string, string> = {
  emits: "produz o fato",
  triggers: "aciona",
  realizes: "realiza",
  association: "executa",
  contains: "contém",
  uses: "usa",
  "references-by-id": "referencia por id",
  "context-relation": "se relaciona com",
};

export function buildStories(doc: Doc): Story[] {
  const nodes = new Map(doc.nodes.map((n) => [n.id, n]));
  const groups = new Map(doc.groups.map((g) => [g.id, g]));
  const label = (id: string) => nodes.get(id)?.label ?? groups.get(id)?.label ?? id;
  const role = (n: NodeEl | undefined) => n?.ddd?.role;
  const contextOf = (n: NodeEl) => {
    for (let cur = n.parent, i = 0; cur && i < 20; i++) {
      const g = groups.get(cur);
      if (!g) return undefined;
      if (g.kind === "context") return g.label;
      cur = g.parent;
    }
    return undefined;
  };
  const rel = (c: ConnectionEl): DddRel | undefined => c.ddd?.rel;
  const outConns = (id: string, ...rels: DddRel[]) => doc.connections.filter((c) => c.from === id && rels.includes(rel(c)!));
  const inConns = (id: string, ...rels: DddRel[]) => doc.connections.filter((c) => c.to === id && rels.includes(rel(c)!));
  const stepOf = (n: NodeEl) => n.ddd?.step ?? Infinity;

  let full = false; // história completa: segue também a estrutura (contains, uses, repository, relação entre contextos)
  let onlyUc: string | undefined; // o ator só leva ao caso de uso da história atual
  /** próximos elementos do fluxo a partir de `id`, com as conexões que levam até eles */
  const nexts = (id: string): { to: string; conns: ConnectionEl[] }[] => {
    const n = nodes.get(id);
    if (!n) return [];
    const acc = new Map<string, ConnectionEl[]>();
    const add = (to: string, c?: ConnectionEl) => {
      if (to === id || !nodes.has(to)) return;
      acc.set(to, [...(acc.get(to) ?? []), ...(c ? [c] : [])]);
    };
    if (role(n) === "use-case") {
      for (const c of inConns(id, "realizes")) add(c.from, c);
      for (const r of n.ddd?.realizedBy ?? []) add(r);
    } else if (n.kind === "actor" && !n.ddd) {
      for (const c of doc.connections.filter((x) => x.from === id && role(nodes.get(x.to)) === "use-case" && (!onlyUc || x.to === onlyUc))) add(c.to, c);
    } else {
      for (const c of outConns(id, ...FLOW_RELS)) add(c.to, c);
      if (full) {
        for (const c of outConns(id, "contains", "uses", "references-by-id", "context-relation")) add(c.to, c);
        for (const e of doc.nodes) if (role(e) === "repository" && e.ddd!.for === id) add(e.id);
      }
      // vínculos declarados nos campos do elemento (sem conexão desenhada)
      for (const e of doc.nodes) {
        const d = e.ddd;
        if (!d) continue;
        if (role(e) === "domain-event" && d.producedBy === id) add(e.id);
        if ((role(e) === "policy" || role(e) === "process-manager") && (d.reactsTo ?? []).includes(id)) add(e.id);
        if (role(e) === "read-model" && (d.projectsFrom ?? []).includes(id)) add(e.id);
      }
      for (const c of n.ddd?.issues ?? []) add(c);
    }
    return [...acc].map(([to, conns]) => ({ to, conns }));
  };

  const storyFrom = (starts: string[]): { order: string[]; via: Map<string, { from: string; conns: ConnectionEl[] }[]>; back: Map<string, ConnectionEl[]> } => {
    const post: string[] = [];
    const edges: { from: string; to: string; conns: ConnectionEl[] }[] = [];
    const back = new Map<string, ConnectionEl[]>();
    const state = new Map<string, number>();
    const dfs = (id: string) => {
      state.set(id, 1);
      const list = nexts(id).sort((a, b) => stepOf(nodes.get(a.to)!) - stepOf(nodes.get(b.to)!));
      for (const { to, conns } of [...list].reverse()) {
        if (state.get(to) === 1) {
          back.set(id, [...(back.get(id) ?? []), ...conns]); // volta a um passo anterior (loop)
          continue;
        }
        edges.push({ from: id, to, conns });
        if (!state.has(to)) dfs(to);
      }
      state.set(id, 2);
      post.push(id);
    };
    for (const s of [...starts].reverse()) if (!state.has(s)) dfs(s);
    // ordem topológica que segue um ramo até o fim antes de passar ao irmão (pós-ordem invertida):
    // o aggregate vem antes do evento mesmo que o command também o emita
    const sorted = post.reverse();
    const via = new Map<string, { from: string; conns: ConnectionEl[] }[]>();
    for (const e of edges) via.set(e.to, [...(via.get(e.to) ?? []), { from: e.from, conns: e.conns }]);
    return { order: sorted, via, back };
  };

  const branchText = (c: ConnectionEl): string => {
    const d = c.ddd;
    const bits: string[] = [];
    if (d?.condition) bits.push(`se ${d.condition}`);
    if (d?.otherwise) bits.push("senão (caminho padrão)");
    if (d?.foreach) bits.push(`para cada ${d.foreach}`);
    if (d?.loop) bits.push(`volta e repete${d.loop.until ? ` até ${d.loop.until}` : ""}${d.loop.max != null ? ` (no máximo ${d.loop.max}×)` : ""}`);
    return bits.join(", ");
  };

  const buildStep = (id: string, incomingEdges: { from: string; conns: ConnectionEl[] }[], back: ConnectionEl[]): StoryStep => {
    const via = incomingEdges.flatMap((e) => e.conns);
    const n = nodes.get(id)!;
    const r = role(n);
    const key = r ?? (n.kind === "actor" ? "actor" : "context");
    const spec = r ? DDD_ROLES[r] : undefined;
    const d = n.ddd;
    const details: StoryStep["details"] = [];
    const add = (l: string, t?: string) => t?.trim() && details.push({ label: l, text: t.trim() });
    add("Descrição", n.description);
    add("Objetivo", d?.goal);
    add("Ator", d?.actor);
    add("Intenção", d?.intent);
    add("Carrega", d?.payload);
    if (d?.external) add("Origem", `evento publicado por outro contexto (${d.external})`);
    if (d?.reactsTo?.length) add("Reage a", d.reactsTo.map(label).join(", "));
    if (d?.compensates?.length) add("Compensa com", d.compensates.map(label).join(", "));
    const extraIds: string[] = [];
    for (const c of outConns(id, "contains")) {
      const t = nodes.get(c.to);
      if (t) extraIds.push(t.id);
    }
    const nContains = extraIds.length;
    if (nContains) add("É composto por", extraIds.slice(0, nContains).map(label).join(", "));
    const used = outConns(id, "uses").map((c) => c.to).filter((t) => nodes.has(t));
    if (!full) for (const t of used) extraIds.push(t);
    if (used.length) add("Usa", used.map(label).join(", "));
    for (const rp of doc.nodes.filter((x) => role(x) === "repository" && x.ddd!.for === id)) {
      if (!full) extraIds.push(rp.id);
      add("Persistido por", rp.label);
    }
    const branches = [...outConns(id, ...FLOW_RELS), ...back].map((c) => ({ to: c.to, toLabel: label(c.to), text: branchText(c) })).filter((b) => b.text);
    const rule = [...(d?.invariants ?? [])];
    const incoming = via.find((c) => rel(c));
    const from = incomingEdges.find((e) => e.conns.some((c) => rel(c)))?.from ?? incomingEdges[0]?.from;
    const becauseCond = incoming ? branchText(incoming) : "";
    return {
      id,
      role: key as StoryStep["role"],
      roleLabel: spec?.label ?? (key === "actor" ? "Ator" : "Bounded Context"),
      title: n.label,
      context: contextOf(n),
      what: spec?.hint ?? (key === "actor" ? "Pessoa ou sistema externo que participa do fluxo." : "Bounded context: a fronteira dentro da qual o modelo e a linguagem têm um só significado."),
      details,
      why: WHY[key] ?? spec?.hint ?? "",
      because: incoming && from && rel(incoming) === "context-relation" ? `${label(from)} ${incoming.ddd?.pattern ? `(${incoming.ddd.pattern}) ` : ""}→ ${n.label}` : incoming && from ? `${label(from)} ${VERB[rel(incoming)!] ?? "leva a"} ${n.label}${becauseCond ? ` — ${becauseCond}` : ""}` : undefined,
      properties: d?.properties ?? [],
      rules: rule,
      branches,
      connIds: via.map((c) => c.id),
      extraIds: full ? extraIds.slice(0, 0) : extraIds,
    };
  };

  const makeStory = (id: string, title: string, starts: string[], goal?: string): Story | undefined => {
    onlyUc = role(nodes.get(id)) === "use-case" ? id : undefined;
    const g = storyFrom(starts);
    const steps = g.order.map((sid) => buildStep(sid, g.via.get(sid) ?? [], g.back.get(sid) ?? []));
    return steps.length ? { id, title, goal, steps } : undefined;
  };

  /** passa por TODOS os elementos: primeiro o que os casos de uso alcançam, depois o que sobrou, por contexto */
  const completeStory = (primary: string[]): Story | undefined => {
    full = true;
    onlyUc = undefined;
    const eligible = doc.nodes.filter((n) => !n.owner && n.kind !== "endpoint");
    const reached = new Set(storyFrom(primary).order);
    const ctxIdx = (n: NodeEl) => doc.groups.findIndex((g) => g.label === contextOf(n));
    const order = Object.keys(DDD_ROLES);
    const rest = eligible.filter((n) => !reached.has(n.id)).sort((a, b) => ctxIdx(a) - ctxIdx(b) || order.indexOf(a.ddd?.role ?? "") - order.indexOf(b.ddd?.role ?? "") || stepOf(a) - stepOf(b));
    const g = storyFrom([...primary, ...rest.map((n) => n.id)]);
    const steps = g.order.map((sid) => buildStep(sid, g.via.get(sid) ?? [], g.back.get(sid) ?? []));
    full = false;
    return steps.length ? { id: "__all", title: "Diagrama completo (todos os elementos)", steps } : undefined;
  };

  const stories: Story[] = [];
  const useCases = doc.nodes.filter((n) => role(n) === "use-case");
  for (const u of useCases) {
    const actor = doc.nodes.find((a) => a.kind === "actor" && !a.ddd && doc.connections.some((c) => c.from === a.id && c.to === u.id));
    const s = makeStory(u.id, u.label, [actor?.id ?? u.id], u.ddd?.goal);
    if (s) stories.push(s);
  }
  if (!stories.length) {
    // sem casos de uso: começa pelos commands que nenhuma policy/saga dispara
    const entries = doc.nodes.filter((n) => role(n) === "command" && !inConns(n.id, "triggers").some((c) => ["policy", "process-manager"].includes(role(nodes.get(c.from)) ?? ""))).sort((a, b) => stepOf(a) - stepOf(b));
    const s = entries.length ? makeStory("overview", "Fluxo do domínio", entries.map((e) => e.id)) : undefined;
    if (s) stories.push(s);
  }
  const entries = doc.nodes.filter((n) => role(n) === "command" && !inConns(n.id, "triggers").some((c) => ["policy", "process-manager"].includes(role(nodes.get(c.from)) ?? "")));
  const primary = [...new Set([...useCases.map((u) => doc.nodes.find((a) => a.kind === "actor" && !a.ddd && doc.connections.some((c) => c.from === a.id && c.to === u.id))?.id ?? u.id), ...entries.sort((a, b) => stepOf(a) - stepOf(b)).map((e) => e.id)])];
  const all = completeStory(primary);
  // com mais de uma história, a visão completa vem primeiro; sozinha, é a única
  if (all && !useCases.length) return [all];
  if (all && (stories.length !== 1 || all.steps.length > stories[0].steps.length)) stories.unshift(all);
  return stories;
}
