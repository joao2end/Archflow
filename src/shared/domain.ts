/**
 * Modo domínio (DDD): regras de validação, descrição para LLMs, rastreio e visão geral.
 *
 * Só depende de `schema.ts` (ops.ts importa este módulo, nunca o contrário). Tudo aqui é determinístico:
 * a mesma entrada produz sempre a mesma saída, que é o que uma LLM precisa para ler o modelo.
 */
import {
  CONTEXT_PATTERNS,
  CONTEXT_PATTERN_KEYS,
  DDD_REL_PAIRS,
  DDD_RELS,
  FLOW_RELS,
  DDD_REL_KEYS,
  DDD_ROLES,
  DDD_ROLE_KEYS,
  SCHEMA_VERSION,
  INFRA_CONNECTION_TYPES,
  SUBDOMAINS,
  docMode,
  type ConnectionEl,
  type ConnectionType,
  type DddConnSpec,
  type DddField,
  type DddNodeSpec,
  type DddRel,
  type Doc,
  type GroupEl,
  type NodeEl,
  type RelEnd,
} from "./schema";
import { checkProperties, propertiesSummary } from "./properties";
import { ONION_RINGS, onionSlot } from "./onion";

export type Severity = "erro" | "aviso" | "dica";
export interface Issue {
  /** id estável da regra: "D001"... (ou "BASE" para as checagens estruturais) */
  rule: string;
  severity: Severity;
  /** id do elemento afetado, quando houver (a UI seleciona o nó ao clicar) */
  target?: string;
  message: string;
}

export const issueText = (i: Issue) => `[${i.rule} ${i.severity}] ${i.message}`;

/* ───────────────────────── validação de entrada das ops ───────────────────────── */

const LIST_FIELDS: DddField[] = ["invariants", "realizedBy", "reactsTo", "issues", "compensates", "projectsFrom"];

/**
 * Arquivos antigos tinham o papel `decision` no modo domain; agora ele só existe no modo logic. Ao abrir:
 *  - decisão encadeada em outra decisão vira uma só (os ramos da segunda passam para a primeira, na mesma ordem);
 *  - decisão que recebe só eventos vira `policy` (a pergunta vira `intent`), ou `process-manager` se era uma junção
 *    (espera todos os eventos: ficam em `reactsTo`); as conexões e as condições dos ramos continuam as mesmas;
 *  - decisão que recebe de policy/saga é desfeita: a origem liga direto aos destinos, com as condições dos ramos.
 */
export function migrateDddDecisions(nodes: NodeEl[], connections: ConnectionEl[]): { nodes: NodeEl[]; connections: ConnectionEl[] } {
  const isDec = (n?: NodeEl) => (n?.ddd as { role?: string } | undefined)?.role === "decision";
  if (!nodes.some(isDec)) return { nodes, connections };
  let ns = nodes.map((n) => ({ ...n }));
  let cs = connections.map((c) => ({ ...c }));
  const ids = new Set<string>([...ns.map((n) => n.id), ...cs.map((c) => c.id)]);
  const fresh = (base: string) => {
    let id = base,
      i = 2;
    while (ids.has(id)) id = `${base}-${i++}`;
    ids.add(id);
    return id;
  };
  const byId = () => new Map(ns.map((n) => [n.id, n]));
  const and = (a?: string, b?: string) => (a && b ? `(${a}) e (${b})` : a ?? b);
  const flowOf = (c: ConnectionEl) => c.ddd?.rel === "triggers";

  // 1. decisão → decisão: os ramos da segunda passam para a primeira
  for (let guard = 0; guard < 100; guard++) {
    const m = byId();
    const link = cs.find((c) => flowOf(c) && isDec(m.get(c.from)) && isDec(m.get(c.to)));
    if (!link) break;
    const branches = cs.filter((c) => c.from === link.to && flowOf(c));
    const merged = branches.map((b) => {
      const cond = and(link.ddd?.condition, b.ddd?.condition);
      const otherwise = b.ddd?.otherwise && !link.ddd?.condition ? true : undefined;
      const { condition: _c, otherwise: _o, ...rest } = b.ddd!;
      return { ...b, id: fresh(`${link.from}-to-${b.to}`), from: link.from, ddd: { ...rest, ...(cond ? { condition: cond } : {}), ...(otherwise ? { otherwise } : {}) } } as ConnectionEl;
    });
    const at = cs.indexOf(link);
    cs = [...cs.slice(0, at), ...merged, ...cs.slice(at + 1)];
    if (!cs.some((c) => c.to === link.to)) {
      cs = cs.filter((c) => c.from !== link.to);
      ns = ns.filter((n) => n.id !== link.to);
    }
  }

  // 2. as decisões que sobraram
  for (const d of ns.filter(isDec)) {
    const spec = d.ddd as unknown as { question?: string; gate?: string };
    const m = byId();
    const incoming = cs.filter((c) => c.to === d.id && flowOf(c));
    const outgoing = cs.filter((c) => c.from === d.id && flowOf(c));
    const fromEvents = incoming.every((c) => (m.get(c.from)?.ddd?.role as string | undefined) === "domain-event");
    if (fromEvents) {
      const reaction = spec.gate === "join";
      const issues = outgoing.map((c) => c.to).filter((id) => m.get(id)?.ddd?.role === "command");
      d.ddd = reaction
        ? { role: "process-manager", ...(spec.question ? { intent: spec.question } : {}), reactsTo: incoming.map((c) => c.from), ...(issues.length ? { issues } : {}) }
        : { role: "policy", ...(spec.question ? { intent: spec.question } : {}) };
      if (spec.gate === "parallel") cs = cs.map((c) => (c.from === d.id && c.ddd ? { ...c, ddd: { ...c.ddd, condition: undefined, otherwise: undefined } } : c));
      continue;
    }
    // vem de policy/saga: desfaz a decisão, a origem liga direto aos destinos
    const made: ConnectionEl[] = [];
    for (const i of incoming)
      for (const o of outgoing) {
        const cond = and(i.ddd?.condition, o.ddd?.condition);
        const { condition: _c, otherwise: _o, ...rest } = o.ddd!;
        made.push({ ...o, id: fresh(`${i.from}-to-${o.to}`), from: i.from, ddd: { ...rest, ...(cond ? { condition: cond } : {}), ...(o.ddd?.otherwise && !i.ddd?.condition ? { otherwise: true } : {}) } } as ConnectionEl);
      }
    cs = [...cs.filter((c) => c.from !== d.id && c.to !== d.id), ...made];
    ns = ns.filter((n) => n.id !== d.id);
  }
  return { nodes: ns, connections: cs };
}

/** Os dados de um evento para a descrição: `properties` vence o `payload` (texto legado), que só vale sozinho. */
const eventPayload = (e: NodeEl) => (e.ddd!.properties?.length ? ` (payload: ${propertiesSummary(e.ddd!.properties)})` : e.ddd!.payload ? ` (payload: ${e.ddd!.payload})` : "");

/** Valida o objeto `ddd` de um nó. Devolve a mensagem de erro (acionável) ou undefined. */
export function checkDddNode(ddd: unknown): string | undefined {
  if (!ddd || typeof ddd !== "object") return "ddd deve ser um objeto { role, ... }";
  const d = ddd as Record<string, unknown>;
  const role = d.role as string;
  if (!DDD_ROLE_KEYS.includes(role as never)) return `ddd.role inválido "${role}". Válidos: ${DDD_ROLE_KEYS.join(", ")}`;
  const allowed = new Set<string>(["role", ...DDD_ROLES[role as keyof typeof DDD_ROLES].fields]);
  for (const k of Object.keys(d)) {
    if (d[k] === undefined) continue;
    if (k === "step" && role === "domain-event") continue; // legado: já foi aceito em evento, sem efeito
    if (!allowed.has(k)) return `campo "${k}" não existe no papel "${role}". Campos do papel: ${[...allowed].filter((f) => f !== "role").join(", ") || "(nenhum)"}`;
  }
  for (const f of LIST_FIELDS) {
    const v = d[f];
    if (v !== undefined && (!Array.isArray(v) || v.some((x) => typeof x !== "string"))) return `ddd.${f} deve ser uma lista de textos`;
  }
  if (d.step !== undefined && (typeof d.step !== "number" || !Number.isFinite(d.step))) return "ddd.step deve ser um número";
  for (const f of ["intent", "payload", "producedBy", "external", "for", "actor", "goal"]) {
    if (d[f] !== undefined && typeof d[f] !== "string") return `ddd.${f} deve ser texto`;
  }
  if (d.properties !== undefined) {
    const e = checkProperties(d.properties);
    if (e) return e;
  }
  return undefined;
}

export function checkDddConn(ddd: unknown): string | undefined {
  if (!ddd || typeof ddd !== "object") return "ddd deve ser um objeto { rel, pattern?, condition?, otherwise?, loop?, foreach? }";
  const d = ddd as { rel?: string; pattern?: string; condition?: unknown; otherwise?: unknown; loop?: unknown; foreach?: unknown };
  if (!DDD_REL_KEYS.includes(d.rel as never)) return `ddd.rel inválido "${d.rel}". Válidos: ${DDD_REL_KEYS.join(", ")}`;
  if (d.pattern !== undefined) {
    if (d.rel !== "context-relation") return `"pattern" só vale com rel "context-relation"`;
    if (!CONTEXT_PATTERN_KEYS.includes(d.pattern as never)) return `pattern inválido "${d.pattern}". Válidos: ${CONTEXT_PATTERN_KEYS.join(", ")}`;
  }
  const hasFlow = d.condition !== undefined || d.otherwise !== undefined || d.loop !== undefined || d.foreach !== undefined;
  if (hasFlow && !FLOW_RELS.includes(d.rel as never)) return `condition, otherwise, loop e foreach só valem em relações de fluxo (${FLOW_RELS.join(", ")}); recebeu rel "${d.rel}"`;
  if (d.condition !== undefined && (typeof d.condition !== "string" || !d.condition.trim())) return "ddd.condition deve ser um texto não vazio (ex.: \"atraso > 0\")";
  if (d.otherwise !== undefined && typeof d.otherwise !== "boolean") return "ddd.otherwise deve ser true ou false";
  if (d.condition !== undefined && d.otherwise === true) return "um ramo tem condition OU otherwise (senão), não os dois";
  if (d.foreach !== undefined && (typeof d.foreach !== "string" || !d.foreach.trim())) return "ddd.foreach deve ser um texto não vazio (ex.: \"item do pedido\")";
  if (d.loop !== undefined) {
    const l = d.loop as { until?: unknown; max?: unknown };
    if (!l || typeof l !== "object" || Array.isArray(l)) return "ddd.loop deve ser um objeto { until?, max? }";
    for (const k of Object.keys(l)) if (k !== "until" && k !== "max") return `ddd.loop não tem o campo "${k}". Campos: until, max`;
    if (l.until !== undefined && (typeof l.until !== "string" || !l.until.trim())) return "ddd.loop.until deve ser um texto não vazio (a condição de parada)";
    if (l.max !== undefined && (typeof l.max !== "number" || !Number.isInteger(l.max) || l.max < 1 || l.max > 1000)) return "ddd.loop.max deve ser um inteiro entre 1 e 1000";
    if (l.until === undefined && l.max === undefined) return "um loop precisa de uma condição de parada: informe ddd.loop.until e/ou ddd.loop.max";
  }
  return undefined;
}

/** Troca o papel de um nó mantendo só os campos que o novo papel aceita (não deixa lixo de campos de outro papel). */
export function reshapeDdd(old: DddNodeSpec | undefined, role: DddNodeSpec["role"]): DddNodeSpec {
  const next: Record<string, unknown> = { role };
  for (const f of DDD_ROLES[role].fields) {
    const v = (old as unknown as Record<string, unknown> | undefined)?.[f];
    if (v !== undefined) next[f] = v;
  }
  return next as unknown as DddNodeSpec;
}

/** Rótulo automático de uma relação (o usuário/IA pode sobrescrever com `label`). */
export function dddConnLabel(d: { rel: DddRel; pattern?: keyof typeof CONTEXT_PATTERNS }): string {
  return d.rel === "context-relation" ? (d.pattern ? CONTEXT_PATTERNS[d.pattern].label : "context") : DDD_RELS[d.rel].label;
}

type LabelSpec = { rel: DddRel; pattern?: keyof typeof CONTEXT_PATTERNS } & Partial<Pick<DddConnSpec, "condition" | "otherwise" | "loop" | "foreach">>;

/** O fluxo de uma conexão em texto: "para cada item do pedido · se atraso > 0 · repete até pago, máx. 3". Vazio se não há fluxo. */
export function flowText(d: Partial<Pick<DddConnSpec, "condition" | "otherwise" | "loop" | "foreach">> | undefined): string {
  if (!d) return "";
  const parts: string[] = [];
  if (d.foreach?.trim()) parts.push(`para cada ${d.foreach.trim()}`);
  if (d.condition?.trim()) parts.push(`se ${d.condition.trim()}`);
  else if (d.otherwise) parts.push("senão");
  if (d.loop) parts.push(`repete${d.loop.until ? ` até ${d.loop.until}` : ""}${d.loop.max ? `${d.loop.until ? "," : ""} máx. ${d.loop.max}` : ""}`);
  return parts.join(" · ");
}

/**
 * Rótulo exibido numa conexão de domínio. Entre contextos o padrão do Context Map sempre aparece, e o texto livre
 * (ex.: o evento que trafega) vem depois: "Customer/Supplier · pedido-criado". Nas demais relações o texto livre substitui o automático.
 * Se a conexão tem fluxo (condição, senão, loop, para cada), ele abre o rótulo e substitui a palavra automática: "se atraso > 0 · multar".
 */
export function composeDddLabel(d: LabelSpec, via?: string): string {
  const auto = dddConnLabel(d);
  const v = via?.trim();
  const flow = d.rel === "context-relation" ? "" : flowText(d);
  if (flow) return v && v !== auto && v !== flow ? (v.startsWith(flow + " · ") ? v : `${flow} · ${v}`) : flow;
  if (!v || v === auto) return auto;
  if (d.rel !== "context-relation") return v;
  return v.startsWith(auto + " · ") ? v : `${auto} · ${v}`;
}

/** Inverso de `composeDddLabel`: o texto livre de um rótulo (sem o prefixo automático nem o fluxo), ou undefined se for só o automático. */
export function dddLabelVia(d: LabelSpec | undefined, label?: string): string | undefined {
  const l = label?.trim();
  if (!l) return undefined;
  if (!d) return l;
  const flow = d.rel === "context-relation" ? "" : flowText(d);
  if (flow) {
    if (l === flow) return undefined;
    return l.startsWith(flow + " · ") ? l.slice(flow.length + 3) || undefined : l;
  }
  const auto = dddConnLabel(d);
  if (l === auto) return undefined;
  return l.startsWith(auto + " · ") ? l.slice(auto.length + 3) || undefined : l;
}

/* ───────────────────────── tipos de conector no modo domain ───────────────────────── */

/** Ponta de uma conexão para fins de relação: papel DDD, "context" (grupo context ou system com ref) ou undefined (ator, serviço, nota...). */
export function relEnd(doc: Doc, id: string): RelEnd | undefined {
  const g = doc.groups.find((x) => x.id === id);
  if (g) return g.kind === "context" ? "context" : undefined;
  const n = doc.nodes.find((x) => x.id === id);
  if (!n) return undefined;
  if (n.ddd) return n.ddd.role;
  if (n.kind !== "system" || !n.ref) return undefined;
  // uma referência dentro de um contexto aponta para a arquitetura (implementação), não é um contexto do mapa
  const inside = (pid: string | undefined): boolean => {
    for (let cur = pid, i = 0; cur && i < 50; i++) {
      const g = doc.groups.find((x) => x.id === cur);
      if (!g) return false;
      if (g.kind === "context") return true;
      cur = g.parent;
    }
    return false;
  };
  return inside(n.parent) ? undefined : "context";
}

export const relAllows = (rel: DddRel, from: RelEnd | undefined, to: RelEnd | undefined) => !!from && !!to && DDD_REL_PAIRS[rel].some((p) => p.from.includes(from) && p.to.includes(to));

/** Relações de domínio válidas entre dois elementos (vazio quando um deles não é um elemento de domínio). */
export function suggestRels(doc: Doc, fromId: string, toId: string): DddRel[] {
  const f = relEnd(doc, fromId);
  const t = relEnd(doc, toId);
  return DDD_REL_KEYS.filter((r) => relAllows(r, f, t));
}

/** Combinações válidas de uma relação em texto, para mensagens ("command|aggregate-root|process-manager → domain-event"). */
export const relPairsText = (rel: DddRel) => DDD_REL_PAIRS[rel].map((p) => `${p.from.join("|")} → ${p.to.join("|")}`).join(" ; ");

/** Erro de um conector que o modo domain não aceita (infraestrutura sem relação, ou tipo que contradiz a relação); undefined se estiver ok. */
export function connectionTypeError(rel: DddRel | undefined, type: ConnectionType | undefined): string | undefined {
  if (!type) return undefined;
  if (rel) {
    const want = DDD_RELS[rel].type;
    return type === want ? undefined : `a relação "${rel}" fixa o type em "${want}" (recebeu "${type}"); omita type ou remova a relação (ddd: null) para escolher outro tipo UML`;
  }
  return INFRA_CONNECTION_TYPES.includes(type)
    ? `o tipo "${type}" é de infraestrutura e não existe no modo domain: use uma relação de domínio (ddd.rel: ${DDD_REL_KEYS.join(", ")}) ou um tipo UML (association, dependency, inheritance, realization, composition, aggregation)`
    : undefined;
}

/* ───────────────────────── índice do modelo ───────────────────────── */

const isRole = (n: NodeEl | undefined, ...roles: DddNodeSpec["role"][]) => !!n?.ddd && roles.includes(n.ddd.role);

class Model {
  nodes = new Map<string, NodeEl>();
  groups = new Map<string, GroupEl>();
  out = new Map<string, ConnectionEl[]>();
  inn = new Map<string, ConnectionEl[]>();

  constructor(readonly doc: Doc) {
    doc.nodes.forEach((n) => this.nodes.set(n.id, n));
    doc.groups.forEach((g) => this.groups.set(g.id, g));
    for (const c of doc.connections) {
      (this.out.get(c.from) ?? this.out.set(c.from, []).get(c.from)!).push(c);
      (this.inn.get(c.to) ?? this.inn.set(c.to, []).get(c.to)!).push(c);
    }
  }
  outOf = (id: string, rel?: DddRel) => (this.out.get(id) ?? []).filter((c) => !rel || c.ddd?.rel === rel);
  inOf = (id: string, rel?: DddRel) => (this.inn.get(id) ?? []).filter((c) => !rel || c.ddd?.rel === rel);
  /** nós de domínio com um papel específico, na ordem do documento */
  byRole = (...roles: DddNodeSpec["role"][]) => this.doc.nodes.filter((n) => isRole(n, ...roles));
  /** contexto (grupo kind "context") que contém o elemento, subindo pelos pais */
  contextOf(id: string): GroupEl | undefined {
    let cur: string | undefined = this.nodes.get(id)?.parent ?? this.groups.get(id)?.parent;
    const seen = new Set<string>();
    while (cur && !seen.has(cur)) {
      seen.add(cur);
      const g = this.groups.get(cur);
      if (!g) return undefined;
      if (g.kind === "context") return g;
      cur = g.parent;
    }
    return undefined;
  }
  /** raízes de aggregate a que um membro (root/entity) pertence, seguindo `contains` para trás */
  rootsOf(id: string): Set<string> {
    const roots = new Set<string>();
    const seen = new Set<string>();
    const walk = (x: string) => {
      if (seen.has(x)) return;
      seen.add(x);
      const n = this.nodes.get(x);
      if (isRole(n, "aggregate-root")) return void roots.add(x);
      for (const c of this.inOf(x, "contains")) walk(c.from);
    };
    walk(id);
    return roots;
  }
  /** aggregate (id da raiz) de um membro; a própria raiz pertence a si mesma */
  aggregatesOf(id: string): Set<string> {
    return isRole(this.nodes.get(id), "aggregate-root") ? new Set([id]) : isRole(this.nodes.get(id), "entity") ? this.rootsOf(id) : new Set();
  }
}

const label = (m: Model, id: string) => m.nodes.get(id)?.label ?? m.groups.get(id)?.label ?? id;
const quote = (m: Model, id: string) => `\`${id}\` (${label(m, id)})`;

/* ───────────────────────── regras ───────────────────────── */

const ROLE_NEEDS_LINK: DddNodeSpec["role"][] = ["aggregate-root", "policy", "domain-service", "application-service"];
const REF_FIELDS: { field: DddField; list: boolean; roles?: DddNodeSpec["role"][] }[] = [
  { field: "realizedBy", list: true },
  { field: "producedBy", list: false },
  { field: "for", list: false },
  { field: "reactsTo", list: true },
  { field: "issues", list: true },
  { field: "compensates", list: true },
  { field: "projectsFrom", list: true },
];

const IMPERATIVE_VERB = /^(criar|cadastrar|registrar|pagar|cancelar|aprovar|enviar|adicionar|remover|atualizar|confirmar|iniciar|finalizar|emitir|reservar|liberar|alterar|excluir|solicitar|fazer|create|add|register|pay|cancel|approve|send|remove|update|confirm|start|finish|issue|reserve|release|change|delete|request|make|place)\b/i;
const PAST_PARTICIPLE = /(ad[oa]s?|id[oa]s?|íd[oa]s?|ed|[a-z]{2}t[oa]s?|[a-z]{2}s[oa]s?|[a-z]{2}rt[oa]s?)$/i;
/** "Agendar", "Estornar", "Corrigir": verbo no infinitivo, a forma natural de nomear um command em português. */
const INFINITIVE = /^[a-zA-ZÀ-ú]{3,}(ar|er|ir|or)$/;
const words = (s: string) => s.trim().split(/[\s_-]+/).filter(Boolean);

/** Todas as regras de domínio (D001–D020) para um diagrama de modo `domain`. */
/** Camadas da Clean Architecture, de dentro (0) para fora (3). */
const LAYER_RANK: Record<keyof typeof ONION_RINGS, number> = { entities: 0, usecases: 1, adapters: 2, drivers: 3 };

/** Nome sugerido para a porta de um destino: "Repositorio…" para repository, "Gateway…" para sistemas. */
export function portName(target: Pick<NodeEl, "label" | "ddd">): string {
  const words = target.label
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\(.*?\)/g, "")
    .split(/[^A-Za-z0-9]+/)
    .filter((w) => w && !/^(repo|repositorio|de|da|do|das|dos)$/i.test(w))
    .map((w) => w[0].toUpperCase() + w.slice(1));
  const repo = target.ddd?.role === "repository";
  return (repo ? "Repositorio" : "Gateway") + (words.join("") || (repo ? "" : "Externo"));
}

export interface LayerViolation {
  conn: string;
  /** quem depende (está mais para dentro) e de quem (mais para fora): a origem e o destino da conexão */
  dependent: string;
  dependee: string;
}

/**
 * Conexões que ferem a regra de dependência: uma camada interna (Entities → Use Cases → Interface Adapters → Frameworks &
 * Drivers) não pode depender de uma externa; só o contrário. A camada de cada componente vem do papel dele (onionSlot) e
 * quem depende é a origem da conexão.
 *
 * Não contam:
 * - conexão com porta (`port`): a origem depende de uma interface da própria camada, que o destino implementa
 *   (inversão de dependência explícita);
 * - evento que dispara (`triggers`) uma reação: um evento interno não depende de quem o assina (o assinante é que depende
 *   dele) e um evento de outro contexto chega de fora, como um driver que aciona a camada interna;
 * - Use Cases chamando um repository ou um sistema (externo ou outro diagrama): a interface (porta) pertence à aplicação
 *   e só a implementação fica do lado de fora (inversão de dependência). Entities não tem essa saída: o domínio não
 *   conhece nada de fora;
 * - relação entre contextos (Context Map).
 */
/** Use Cases chamando repository ou sistema (externo ou outro diagrama): aceito como porta mesmo sem `port` declarada. */
const impliedPort = (a: NodeEl, b: NodeEl) => onionSlot(a).ring === "usecases" && (b.ddd?.role === "repository" || b.kind === "external" || b.kind === "system");

export function layerViolations(doc: Doc): LayerViolation[] {
  const nodes = new Map(doc.nodes.filter((n) => !n.owner && n.kind !== "endpoint").map((n) => [n.id, n]));
  const out: LayerViolation[] = [];
  for (const c of doc.connections) {
    const a = nodes.get(c.from);
    const b = nodes.get(c.to);
    if (!a || !b || c.port || c.ddd?.rel === "context-relation") continue;
    if (c.ddd?.rel === "triggers" && a.ddd?.role === "domain-event") continue;
    if (impliedPort(a, b)) continue;
    if (LAYER_RANK[onionSlot(a).ring] < LAYER_RANK[onionSlot(b).ring]) out.push({ conn: c.id, dependent: a.id, dependee: b.id });
  }
  return out;
}

export function domainIssues(doc: Doc, opts: { exists?: (path: string) => boolean } = {}): Issue[] {
  const m = new Model(doc);
  const out: Issue[] = [];
  const add = (rule: string, severity: Severity, message: string, target?: string) => out.push({ rule, severity, message, target });
  const contexts = doc.groups.filter((g) => g.kind === "context");

  for (const n of doc.nodes) {
    if (n.kind === "domain" && !n.ddd) add("BASE", "erro", `${n.id}: nó "domain" sem ddd.role`, n.id);
    if (n.ddd && n.kind !== "domain") add("BASE", "aviso", `${n.id}: ddd só tem efeito em nós kind "domain"`, n.id);
  }

  // D020 integridade de referências em campos ddd
  for (const n of m.byRole(...DDD_ROLE_KEYS)) {
    for (const { field, list } of REF_FIELDS) {
      const raw = (n.ddd as unknown as Record<string, unknown>)[field];
      if (raw === undefined) continue;
      for (const id of list ? (raw as string[]) : [raw as string]) {
        if (!m.nodes.has(id)) add("D020", "erro", `${quote(m, n.id)}: ddd.${field} aponta para "${id}", que não existe`, n.id);
      }
    }
  }

  // D001 use-case sem realização
  for (const u of m.byRole("use-case")) {
    const listed = (u.ddd!.realizedBy ?? []).filter((id) => m.nodes.has(id));
    const linked = m.inOf(u.id, "realizes");
    if (!listed.length && !linked.length) add("D001", "erro", `caso de uso ${quote(m, u.id)} sem realização: ligue um command (rel "realizes") ou preencha ddd.realizedBy`, u.id);
  }

  // D002 command → exatamente um aggregate-root via "triggers"
  for (const c of m.byRole("command")) {
    const targets = m.outOf(c.id, "triggers").filter((x) => isRole(m.nodes.get(x.to), "aggregate-root"));
    if (targets.length === 0) add("D002", "erro", `command ${quote(m, c.id)} não pertence a nenhum aggregate: ligue-o a um aggregate-root com rel "triggers"`, c.id);
    else if (targets.length > 1) add("D002", "erro", `command ${quote(m, c.id)} aponta para ${targets.length} aggregates (${targets.map((t) => t.to).join(", ")}); um command pertence a exatamente um`, c.id);
  }

  // D003 evento sem produtor (cópia externa de outro contexto é isenta)
  for (const e of m.byRole("domain-event")) {
    if (e.ddd!.external) continue;
    const by = e.ddd!.producedBy && m.nodes.has(e.ddd!.producedBy);
    if (!by && !m.inOf(e.id, "emits").length) add("D003", "erro", `evento ${quote(m, e.id)} sem produtor: ligue um command/aggregate-root (rel "emits") ou preencha ddd.producedBy`, e.id);
  }

  // D004 entity só dentro de um aggregate (exatamente um)
  for (const e of m.byRole("entity")) {
    const roots = m.rootsOf(e.id);
    if (roots.size === 0) add("D004", "erro", `entity ${quote(m, e.id)} fora de qualquer aggregate: ligue-a a um aggregate-root (ou a outra entity) com rel "contains"`, e.id);
    else if (roots.size > 1) add("D004", "erro", `entity ${quote(m, e.id)} pertence a ${roots.size} aggregates (${[...roots].join(", ")}); uma entity pertence a um só`, e.id);
  }
  // D004: um aggregate-root não pode estar contido em outro aggregate
  for (const r of m.byRole("aggregate-root")) {
    const parents = m.inOf(r.id, "contains");
    if (parents.length) add("D004", "erro", `aggregate-root ${quote(m, r.id)} está contido em ${parents.map((p) => p.from).join(", ")}; uma raiz não pertence a outro aggregate`, r.id);
  }

  // D005 aggregates só se referenciam por id
  for (const c of doc.connections) {
    const a = m.aggregatesOf(c.from);
    const b = m.aggregatesOf(c.to);
    if (!a.size || !b.size) continue;
    const same = [...a].every((x) => b.has(x));
    if (same) continue;
    if (c.ddd?.rel !== "references-by-id") add("D005", "erro", `${quote(m, c.from)} → ${quote(m, c.to)} liga aggregates diferentes por objeto; use rel "references-by-id"`, c.id);
  }

  // D006 relação entre contextos exige context-relation
  for (const c of doc.connections) {
    if (c.ddd?.rel === "context-relation") continue;
    const ca = m.contextOf(c.from)?.id;
    const cb = m.contextOf(c.to)?.id;
    if (ca && cb && ca !== cb) add("D006", "aviso", `${quote(m, c.from)} (contexto ${ca}) → ${quote(m, c.to)} (contexto ${cb}) cruza contextos; use uma relação "context-relation" com pattern entre os contextos`, c.id);
  }
  for (const e of m.byRole("domain-event")) {
    const ext = e.ddd!.external;
    if (ext && !/^[^.\s]+\.[^.\s]+$/.test(ext)) add("D006", "aviso", `evento ${quote(m, e.id)}: ddd.external deve ter o formato "contexto.evento"`, e.id);
  }

  // D007 value-object não tem identidade
  for (const v of m.byRole("value-object")) {
    if (m.inOf(v.id, "references-by-id").length) add("D007", "aviso", `value-object ${quote(m, v.id)} é referenciado por id, mas não tem identidade; torne-o entity ou embuta-o via "contains"`, v.id);
    if (m.outOf(v.id, "references-by-id").length) add("D007", "aviso", `value-object ${quote(m, v.id)} referencia por id, o que implica identidade; torne-o entity`, v.id);
  }

  // D008 repository só para aggregate-root
  for (const r of m.byRole("repository")) {
    const target = r.ddd!.for;
    if (!target) add("D008", "erro", `repository ${quote(m, r.id)} sem ddd.for: informe o aggregate-root que ele persiste`, r.id);
    else if (m.nodes.has(target) && !isRole(m.nodes.get(target), "aggregate-root")) add("D008", "erro", `repository ${quote(m, r.id)} aponta para ${quote(m, target)}, que não é aggregate-root`, r.id);
  }

  // D009 contexto vazio · D014 subdomain · D015 generic grande
  for (const g of contexts) {
    const inside = doc.nodes.filter((n) => m.contextOf(n.id)?.id === g.id);
    const roots = inside.filter((n) => isRole(n, "aggregate-root"));
    if (!roots.length) add("D009", "aviso", `contexto ${quote(m, g.id)} sem nenhum aggregate-root`, g.id);
    if (!g.subdomain) add("D014", "dica", `contexto ${quote(m, g.id)} sem subdomain (core, supporting ou generic)`, g.id);
    if (g.subdomain === "generic" && roots.length > 5) add("D015", "dica", `contexto generic ${quote(m, g.id)} tem ${roots.length} aggregates; considere usar uma solução pronta`, g.id);
    // D011 contexto sem correspondência na arquitetura
    if (!inside.some((n) => n.kind === "system" && n.ref)) add("D011", "dica", `contexto ${quote(m, g.id)} sem ligação com a arquitetura: adicione um componente "system" com ref para o diagrama de arquitetura`, g.id);
  }

  // D010 nomes (heurística; só dica)
  for (const c of m.byRole("command")) {
    const ws = words(c.label);
    if (ws.length > 1 && PAST_PARTICIPLE.test(ws[ws.length - 1]) && !IMPERATIVE_VERB.test(ws[0]) && !INFINITIVE.test(ws[0])) add("D010", "dica", `command ${quote(m, c.id)} parece estar no passado; commands são imperativos (ex.: criar-pedido)`, c.id);
  }
  for (const e of m.byRole("domain-event")) {
    const ws = words(e.label);
    if (ws.length && IMPERATIVE_VERB.test(ws[0]) && !PAST_PARTICIPLE.test(ws[ws.length - 1])) add("D010", "dica", `evento ${quote(m, e.id)} parece imperativo; eventos descrevem fatos no passado (ex.: pedido-criado)`, e.id);
  }

  // D012 isolamento (por modo)
  const touched = new Set(doc.connections.flatMap((c) => [c.from, c.to]));
  const referenced = new Set<string>();
  for (const n of doc.nodes) for (const { field } of REF_FIELDS) {
    const v = (n.ddd as unknown as Record<string, unknown> | undefined)?.[field];
    for (const id of Array.isArray(v) ? v : v ? [v] : []) referenced.add(id as string);
  }
  for (const n of doc.nodes) {
    if (n.owner || n.kind === "endpoint") continue;
    const must = isRole(n, ...ROLE_NEEDS_LINK) || n.kind === "actor" || n.kind === "system" || n.kind === "external";
    const refsOthers = REF_FIELDS.some(({ field }) => {
      const v = (n.ddd as unknown as Record<string, unknown> | undefined)?.[field];
      return Array.isArray(v) ? v.length > 0 : !!v;
    }); // um campo de id (reactsTo, issues…) liga tanto quanto uma conexão
    if (must && !touched.has(n.id) && !referenced.has(n.id) && !refsOthers) add("D012", "aviso", `${quote(m, n.id)} está isolado (sem conexão nem referência)`, n.id);
  }

  // D013 application-service sem regra de negócio
  for (const a of m.byRole("application-service")) {
    if ((a.ddd as { invariants?: string[] }).invariants?.length) add("D013", "aviso", `application-service ${quote(m, a.id)} não deve ter invariantes (regra de negócio vive no domínio)`, a.id);
    if (m.outOf(a.id, "emits").length) add("D013", "aviso", `application-service ${quote(m, a.id)} não emite eventos; quem emite é o aggregate ou o command`, a.id);
  }

  // D033 domain-service é puro: quem busca no repository é o command/application-service
  for (const s of m.byRole("domain-service"))
    for (const c of m.outOf(s.id, "uses"))
      if (isRole(m.nodes.get(c.to), "repository")) add("D033", "dica", `domain-service ${quote(m, s.id)} usa o repository ${quote(m, c.to)}, mas um domain-service é puro (sem I/O): prefira que o command ou o application-service busque no repository e passe os dados ao serviço`, s.id);

  // D034 regra de dependência das camadas: só de fora para dentro
  for (const v of layerViolations(doc)) {
    const [dep, on] = [m.nodes.get(v.dependent)!, m.nodes.get(v.dependee)!];
    const where = (n: NodeEl) => ONION_RINGS[onionSlot(n).ring].label;
    add("D034", "erro", `${quote(m, dep.id)} (${where(dep)}) depende de ${quote(m, on.id)} (${where(on)}): uma camada interna não pode depender de uma externa; declare uma porta na conexão (port: a interface fica na camada de ${where(dep)} e ${quote(m, on.id)} a implementa), inverta o sentido ou passe por um adapter em Interface Adapters`, v.conn);
  }
  // D035 inversão implícita: Use Cases chamando repository/sistema sem porta declarada (aceito, mas o diagrama não mostra a interface)
  // D036 porta onde não há inversão (de fora para dentro ou na mesma camada)
  for (const c of doc.connections) {
    const a = m.nodes.get(c.from);
    const b = m.nodes.get(c.to);
    if (!a || !b || a.owner || b.owner) continue;
    const outward = LAYER_RANK[onionSlot(a).ring] < LAYER_RANK[onionSlot(b).ring];
    if (!c.port && impliedPort(a, b) && outward) add("D035", "dica", `${quote(m, a.id)} depende de ${quote(m, b.id)} por uma porta implícita: declare a porta na conexão (port, ex.: "${portName(b)}") para o diagrama mostrar a interface que a camada de dentro define`, c.id);
    if (c.port && !outward) add("D036", "dica", `${quote(m, a.id)} → ${quote(m, b.id)} tem a porta "${c.port.name}", mas a conexão não sai para uma camada mais externa: a porta só faz sentido na inversão de dependência (de dentro para fora)`, c.id);
  }

  // D016 ciclo de references-by-id entre aggregates
  const refEdges = new Map<string, string[]>();
  for (const c of doc.connections) {
    if (c.ddd?.rel !== "references-by-id") continue;
    for (const a of m.aggregatesOf(c.from)) for (const b of m.aggregatesOf(c.to)) if (a !== b) refEdges.set(a, [...(refEdges.get(a) ?? []), b]);
  }
  const reported = new Set<string>();
  const dfs = (start: string, cur: string, path: string[], seen: Set<string>) => {
    for (const nxt of refEdges.get(cur) ?? []) {
      if (nxt === start) {
        const key = [...path].sort().join(">");
        if (!reported.has(key)) {
          reported.add(key);
          add("D016", "dica", `ciclo de references-by-id entre aggregates: ${[...path, start].join(" → ")}`, start);
        }
      } else if (!seen.has(nxt)) dfs(start, nxt, [...path, nxt], new Set([...seen, nxt]));
    }
  };
  for (const start of refEdges.keys()) dfs(start, start, [start], new Set([start]));

  // D017 consistência da visão geral (precisa saber quais diagramas existem)
  if (opts.exists) {
    for (const n of doc.nodes) {
      if (n.kind === "system" && n.ref?.diagram && !opts.exists(n.ref.diagram)) add("D017", "aviso", `${quote(m, n.id)} referencia o diagrama "${n.ref.diagram}", que não existe no projeto`, n.id);
    }
  }

  // D018 process-manager
  for (const p of m.byRole("process-manager")) {
    const events = [...(p.ddd!.reactsTo ?? []), ...m.inOf(p.id, "triggers").map((c) => c.from)].filter((id) => isRole(m.nodes.get(id), "domain-event"));
    const cmds = [...(p.ddd!.issues ?? []), ...m.outOf(p.id, "triggers").map((c) => c.to)].filter((id) => isRole(m.nodes.get(id), "command"));
    if (!events.length) add("D018", "erro", `process-manager ${quote(m, p.id)} sem evento de entrada: preencha ddd.reactsTo ou ligue um evento com rel "triggers"`, p.id);
    if (!cmds.length) add("D018", "erro", `process-manager ${quote(m, p.id)} sem command de saída: preencha ddd.issues ou ligue-o a um command com rel "triggers"`, p.id);
  }

  // D019 read-model
  for (const r of m.byRole("read-model")) {
    const feeds = [...(r.ddd!.projectsFrom ?? []), ...m.inOf(r.id, "triggers").map((c) => c.from)].filter((id) => isRole(m.nodes.get(id), "domain-event"));
    if (!feeds.length) add("D019", "erro", `read-model ${quote(m, r.id)} sem evento de origem: preencha ddd.projectsFrom ou ligue um evento com rel "triggers"`, r.id);
    if (m.outOf(r.id, "emits").length) add("D019", "erro", `read-model ${quote(m, r.id)} não emite eventos (é só leitura)`, r.id);
  }

  // D025–D032 fluxo: condições, loops e iteração
  const flowOut = new Map<string, ConnectionEl[]>();
  const flowIn = new Map<string, ConnectionEl[]>();
  for (const c of doc.connections) {
    if (!c.ddd || !FLOW_RELS.includes(c.ddd.rel)) continue;
    (flowOut.get(c.from) ?? flowOut.set(c.from, []).get(c.from)!).push(c);
    (flowIn.get(c.to) ?? flowIn.set(c.to, []).get(c.to)!).push(c);
  }
  /** existe caminho de fluxo de `from` a `goal` sem passar por conexões de loop (nem por `skip`)? */
  const flowReaches = (from: string, goal: string, skip?: ConnectionEl): boolean => {
    const seen = new Set<string>();
    const stack = [from];
    while (stack.length) {
      const x = stack.pop()!;
      if (x === goal) return true;
      if (seen.has(x)) continue;
      seen.add(x);
      for (const c of flowOut.get(x) ?? []) if (c !== skip && !c.ddd?.loop) stack.push(c.to);
    }
    return false;
  };
  // ramos condicionais: quem despacha vários ramos e põe condição em algum deles (policy, saga, command, evento)
  for (const [from, outs] of flowOut) {
    for (const rel of FLOW_RELS) {
      // só são alternativas (e não consumidores independentes) os ramos que uma policy/saga dispara (`triggers`) e os desfechos de um command/aggregate (`emits`)
      if (rel === "triggers" && !["policy", "process-manager"].includes(m.nodes.get(from)?.ddd?.role ?? "")) continue;
      const branches = outs.filter((c) => c.ddd!.rel === rel);
      if (!branches.some((b) => b.ddd!.condition || b.ddd!.otherwise)) continue;
      for (const b of branches) if (!b.ddd!.condition && !b.ddd!.otherwise) add("D025", "aviso", `ramo ${quote(m, from)} → ${quote(m, b.to)} sem condição, mas os irmãos têm: cada ramo tem uma condição ou é o padrão (senão)`, b.id);
      const others = branches.filter((b) => b.ddd!.otherwise);
      if (others.length > 1) add("D025", "aviso", `${quote(m, from)} com ${others.length} ramos "senão"; só um pode ser o padrão`, from);
      if (branches.length >= 2 && !others.length) add("D026", "aviso", `${quote(m, from)} tem ramos com condição mas nenhum "senão": se nenhuma condição valer, o fluxo para`, from);
      // ciclo que passa por ela sem nenhum loop declarado
      if (branches.some((b) => !b.ddd!.loop && flowReaches(b.to, from))) add("D028", "aviso", `${quote(m, from)} está num ciclo sem loop declarado: marque a conexão de retorno com loop (until e/ou max) ou elimine o ciclo`, from);
    }
  }
  for (const c of doc.connections) {
    const d = c.ddd;
    if (!d) continue;
    if (!FLOW_RELS.includes(d.rel) && (d.condition || d.otherwise || d.loop || d.foreach)) add("D032", "aviso", `${quote(m, c.from)} —${d.rel}→ ${quote(m, c.to)}: condição, senão, loop e para cada só valem em ${FLOW_RELS.join(" e ")}`, c.id);
    if (d.loop) {
      if (d.loop.until === undefined && d.loop.max === undefined) add("D029", "erro", `loop ${quote(m, c.from)} → ${quote(m, c.to)} sem condição de parada: informe loop.until e/ou loop.max`, c.id);
      if (!flowReaches(c.to, c.from, c)) add("D030", "dica", `${quote(m, c.from)} → ${quote(m, c.to)} está marcada como loop, mas o diagrama não mostra o caminho de volta (de ${c.to} até ${c.from}); se o retorno passa por um sistema externo está certo, senão revise a conexão`, c.id);
    }
  }

  // D021 extremos coerentes com a relação (matriz DDD_REL_PAIRS) · D022 conector sem relação · D023 tipo que contradiz a relação
  for (const c of doc.connections) {
    const r = c.ddd?.rel;
    const f = relEnd(doc, c.from);
    const t = relEnd(doc, c.to);
    if (r) {
      if (f && t && !relAllows(r, f, t)) add("D021", "aviso", `${quote(m, c.from)} (${f}) —${r}→ ${quote(m, c.to)} (${t}): combinação inválida; ${r} liga ${relPairsText(r)}${suggestRels(doc, c.from, c.to).length ? `. Para este par use: ${suggestRels(doc, c.from, c.to).join(", ")}` : ""}`, c.id);
      if (r === "context-relation" && !c.ddd?.pattern) add("D021", "aviso", `${quote(m, c.from)} —context-relation→ ${quote(m, c.to)}: informe o pattern do Context Map`, c.id);
      const want = DDD_RELS[r].type;
      if (c.type !== want) add("D023", "aviso", `${quote(m, c.from)} —${r}→ ${quote(m, c.to)}: a relação ${r} usa o tipo "${want}", mas a conexão está como "${c.type}"`, c.id);
    } else {
      if (INFRA_CONNECTION_TYPES.includes(c.type)) add("D022", "aviso", `${quote(m, c.from)} → ${quote(m, c.to)}: o tipo "${c.type}" é de infraestrutura; no modo domain use uma relação de domínio${suggestRels(doc, c.from, c.to).length ? ` (para este par: ${suggestRels(doc, c.from, c.to).join(", ")})` : ""}`, c.id);
      else if (f && t) add("D022", "aviso", `${quote(m, c.from)} (${f}) → ${quote(m, c.to)} (${t}): conexão entre elementos de domínio sem relação${suggestRels(doc, c.from, c.to).length ? `; use: ${suggestRels(doc, c.from, c.to).join(", ")}` : "; nenhuma relação de domínio liga este par"}`, c.id);
    }
  }

  // um mapa de contextos (só referências e relações entre contextos) não tem elementos DDD e está certo assim
  const isContextMap = doc.connections.some((c) => c.ddd?.rel === "context-relation");
  if (doc.nodes.every((n) => !n.ddd) && !contexts.length && !isContextMap) add("D009", "dica", "diagrama de domínio sem nenhum elemento DDD ainda");
  return out;
}

/* ───────────────────────── rastreio ───────────────────────── */

export interface TraceStep {
  id: string;
  label: string;
  role: string;
}
export interface TraceResult {
  useCase: string;
  ok: boolean;
  /** cada caminho: use-case ← command → aggregate → eventos */
  paths: TraceStep[][];
  problems: string[];
}

/** Caminho caso de uso → command → aggregate → evento, com falhas explícitas (✔/✘ no describe). */
export function traceUseCase(doc: Doc, id: string): TraceResult | undefined {
  const m = new Model(doc);
  const u = m.nodes.get(id);
  if (!u || !isRole(u, "use-case")) return undefined;
  const step = (n: NodeEl): TraceStep => ({ id: n.id, label: n.label, role: n.ddd?.role ?? n.kind });
  const realizers = new Set<string>([...(u.ddd!.realizedBy ?? []), ...m.inOf(u.id, "realizes").map((c) => c.from)]);
  const problems: string[] = [];
  const paths: TraceStep[][] = [];
  if (!realizers.size) problems.push("sem realização (D001)");
  for (const rid of realizers) {
    const r = m.nodes.get(rid);
    if (!r) {
      problems.push(`realizador "${rid}" não existe (D020)`);
      continue;
    }
    if (!isRole(r, "command")) {
      paths.push([step(u), step(r)]);
      continue;
    }
    const aggs = m.outOf(r.id, "triggers").map((c) => m.nodes.get(c.to)).filter((n): n is NodeEl => isRole(n, "aggregate-root"));
    if (!aggs.length) problems.push(`command "${r.id}" sem aggregate (D002)`);
    const events = new Set<string>([
      ...m.outOf(r.id, "emits").map((c) => c.to),
      ...aggs.flatMap((a) => m.outOf(a.id, "emits").map((c) => c.to)),
      ...doc.nodes.filter((e) => isRole(e, "domain-event") && (e.ddd!.producedBy === r.id || aggs.some((a) => a.id === e.ddd!.producedBy))).map((e) => e.id),
    ]);
    const evs = [...events].map((x) => m.nodes.get(x)).filter((n): n is NodeEl => isRole(n, "domain-event"));
    if (!evs.length) problems.push(`command "${r.id}" não produz nenhum evento`);
    if (!aggs.length) paths.push([step(u), step(r)]);
    for (const a of aggs.length ? aggs : [undefined]) {
      if (!a) continue;
      if (!evs.length) paths.push([step(u), step(r), step(a)]);
      for (const e of evs) paths.push([step(u), step(r), step(a), step(e)]);
    }
  }
  return { useCase: id, ok: problems.length === 0 && paths.length > 0, paths, problems };
}

/* ───────────────────────── descrição para LLMs ───────────────────────── */

const bullet = (s: string, indent = "") => `${indent}- ${s}`;

export function describeDomain(doc: Doc, issues: Issue[]): string {
  const m = new Model(doc);
  const L: string[] = [];
  const contexts = doc.groups.filter((g) => g.kind === "context");
  const roots = doc.nodes.filter((n) => isRole(n, "aggregate-root"));
  const ucs = doc.nodes.filter((n) => isRole(n, "use-case"));
  L.push(`# ${doc.title} — domínio`);
  if (doc.description) L.push("", doc.description);
  L.push("", `> schema ${SCHEMA_VERSION} · modo domain · ${contexts.length} contexto(s) · ${roots.length} aggregate(s) · ${ucs.length} caso(s) de uso`);

  const inCtx = (g: GroupEl | undefined) => doc.nodes.filter((n) => m.contextOf(n.id)?.id === g?.id && !(g === undefined && m.contextOf(n.id)));
  const renderContext = (g: GroupEl | undefined) => {
    const nodes = g ? inCtx(g) : doc.nodes.filter((n) => !m.contextOf(n.id));
    if (!nodes.length) return;
    L.push("", g ? `## Contexto \`${g.id}\`${g.subdomain ? ` (${g.subdomain})` : ""} — ${g.label}` : "## Fora de qualquer contexto");
    if (g?.description) L.push(g.description);
    if (g?.subdomain) L.push(`_${SUBDOMAINS[g.subdomain]}_`);
    const rootsHere = nodes.filter((n) => isRole(n, "aggregate-root"));
    for (const r of rootsHere) {
      L.push("", `### Aggregate \`${r.id}\` (root: ${r.label})`);
      if (r.description) L.push(r.description);
      const members = (id: string, seen = new Set<string>()): NodeEl[] =>
        m.outOf(id, "contains").flatMap((c) => {
          const t = m.nodes.get(c.to);
          if (!t || seen.has(t.id)) return [];
          seen.add(t.id);
          return [t, ...members(t.id, seen)];
        });
      const mem = members(r.id);
      for (const role of ["entity", "value-object"] as const) {
        const list = mem.filter((n) => isRole(n, role));
        if (list.length) L.push(bullet(`${role}: ${list.map((n) => `\`${n.id}\``).join(", ")}`));
      }
      const inv = [...(r.ddd!.invariants ?? [])];
      if (inv.length) L.push(bullet(`invariantes: ${inv.join("; ")}`));
      for (const x of [r, ...mem]) if (x.ddd?.properties?.length) L.push(bullet(`propriedades de \`${x.id}\`: ${propertiesSummary(x.ddd.properties)}`));
      const cmds = nodes.filter((n) => isRole(n, "command") && m.outOf(n.id, "triggers").some((c) => c.to === r.id));
      for (const c of cmds) L.push(bullet(`command \`${c.id}\`${c.ddd!.intent ? ` — ${c.ddd!.intent}` : ""}${c.ddd!.properties?.length ? ` (parâmetros: ${propertiesSummary(c.ddd!.properties)})` : ""}${c.ddd!.invariants?.length ? ` (invariantes: ${c.ddd!.invariants.join("; ")})` : ""}`));
      const evs = nodes.filter((n) => isRole(n, "domain-event") && !n.ddd!.external && (n.ddd!.producedBy === r.id || m.inOf(n.id, "emits").some((c) => c.from === r.id || cmds.some((k) => k.id === c.from)) || cmds.some((k) => n.ddd!.producedBy === k.id)));
      for (const e of evs) L.push(bullet(`evento \`${e.id}\`${eventPayload(e)}`));
      const repos = nodes.filter((n) => isRole(n, "repository") && n.ddd!.for === r.id);
      for (const rp of repos) L.push(bullet(`repository \`${rp.id}\``));
    }
    const rest = (roles: DddNodeSpec["role"][], title: string, fmt: (n: NodeEl) => string) => {
      const list = nodes.filter((n) => isRole(n, ...roles));
      if (!list.length) return;
      L.push("", `### ${title}`);
      list.forEach((n) => L.push(bullet(fmt(n))));
    };
    /** Ramos com condição, loop ou iteração que saem de um nó por `triggers`: "se x: `a` ↻; senão: `b`". */
    const branchesOf = (id: string) => {
      const bs = doc.connections.filter((c) => c.from === id && c.ddd?.rel === "triggers" && flowText(c.ddd));
      return bs.length ? ` → ${bs.map((b) => `${flowText(b.ddd)}: \`${b.to}\`${b.ddd!.loop ? " ↻" : ""}`).join("; ")}` : "";
    };
    rest(["policy"], "Policies", (n) => `\`${n.id}\` **${n.label}**${n.ddd!.reactsTo?.length ? ` reage a ${n.ddd!.reactsTo.join(", ")}` : ""}${n.ddd!.issues?.length ? ` → dispara ${n.ddd!.issues.join(", ")}` : ""}${n.ddd!.intent ? ` — ${n.ddd!.intent}` : ""}${branchesOf(n.id)}`);
    rest(["process-manager"], "Process managers (sagas)", (n) => `\`${n.id}\` **${n.label}**: reage a ${(n.ddd!.reactsTo ?? []).join(", ") || "—"} → dispara ${(n.ddd!.issues ?? []).join(", ") || "—"}${n.ddd!.compensates?.length ? ` · compensa com ${n.ddd!.compensates.join(", ")}` : ""}`);
    rest(["domain-service"], "Domain services", (n) => `\`${n.id}\` **${n.label}**${n.ddd!.intent ? ` — ${n.ddd!.intent}` : ""}`);
    rest(["application-service"], "Application services", (n) => `\`${n.id}\` **${n.label}**${n.ddd!.intent ? ` — ${n.ddd!.intent}` : ""}`);
    rest(["controller"], "Controllers", (n) => `\`${n.id}\` **${n.label}**${n.ddd!.intent ? ` — ${n.ddd!.intent}` : ""}`);
    rest(["read-model"], "Read models", (n) => `\`${n.id}\` **${n.label}** projeta ${(n.ddd!.projectsFrom ?? []).join(", ") || "—"}`);
    const ext = nodes.filter((n) => isRole(n, "domain-event") && n.ddd!.external);
    if (ext.length) {
      L.push("", "### Eventos consumidos de outros contextos");
      ext.forEach((e) => L.push(bullet(`\`${e.id}\` ← ${e.ddd!.external}`)));
    }
    const orphanEvents = nodes.filter((n) => isRole(n, "domain-event") && !n.ddd!.external && !rootsHere.some((r) => n.ddd!.producedBy === r.id || m.inOf(n.id, "emits").some((c) => c.from === r.id)));
    const orphanCmdEvents = orphanEvents.filter((e) => !rootsHere.some((r) => nodes.some((c) => isRole(c, "command") && m.outOf(c.id, "triggers").some((t) => t.to === r.id) && (e.ddd!.producedBy === c.id || m.inOf(e.id, "emits").some((x) => x.from === c.id)))));
    if (orphanCmdEvents.length) {
      L.push("", "### Eventos sem aggregate");
      orphanCmdEvents.forEach((e) => L.push(bullet(`\`${e.id}\` **${e.label}**${eventPayload(e)}`)));
    }
    const strayCmds = nodes.filter((n) => isRole(n, "command") && !m.outOf(n.id, "triggers").some((c) => isRole(m.nodes.get(c.to), "aggregate-root")));
    if (strayCmds.length) {
      L.push("", "### Commands sem aggregate");
      strayCmds.forEach((c) => L.push(bullet(`\`${c.id}\` **${c.label}**${c.ddd!.intent ? ` — ${c.ddd!.intent}` : ""}`)));
    }
  };
  contexts.forEach(renderContext);
  renderContext(undefined);

  if (ucs.length) {
    L.push("", "## Casos de uso e rastreio");
    for (const u of ucs) {
      const t = traceUseCase(doc, u.id)!;
      const who = u.ddd!.actor ? ` (ator: ${u.ddd!.actor})` : "";
      if (t.ok) {
        const p = t.paths.map((p) => p.slice(1).map((s) => s.id).join(" → ")).join(" | ");
        L.push(bullet(`\`${u.id}\` ${u.label}${who} → ${p} ✔`));
      } else L.push(bullet(`\`${u.id}\` ${u.label}${who} ✘ ${t.problems.join("; ") || "sem caminho até um evento"}`));
    }
  }

  const flows = doc.connections.filter((c) => c.ddd && FLOW_RELS.includes(c.ddd.rel) && flowText(c.ddd));
  if (flows.length) {
    L.push("", "## Fluxo condicional, loops e iterações");
    for (const c of flows) L.push(bullet(`\`${c.from}\` —[${flowText(c.ddd)}]→ \`${c.to}\`${c.ddd!.loop ? " (volta a um passo anterior)" : ""}`));
  }

  const rels = doc.connections.filter((c) => c.ddd?.rel === "context-relation");
  if (rels.length) {
    L.push("", "## Relações entre contextos");
    for (const c of rels) {
      const p = c.ddd!.pattern;
      const via = dddLabelVia(c.ddd, c.label);
      L.push(bullet(`\`${c.from}\` —${p ?? "context-relation"}→ \`${c.to}\`${via ? ` via ${via}` : ""}${p ? ` — ${CONTEXT_PATTERNS[p].hint}` : ""}`));
    }
  }
  const refs = doc.nodes.filter((n) => n.kind === "system" && n.ref);
  if (refs.length) {
    L.push("", "## Diagramas referenciados");
    refs.forEach((n) => L.push(bullet(`\`${n.id}\` **${n.label}** → \`${n.ref!.diagram}\`${n.ref!.node ? ` (componente \`${n.ref!.node}\`)` : ""}`)));
  }
  if (doc.notes.length) {
    L.push("", "## Notas");
    doc.notes.forEach((n) => L.push(bullet(n.text.replace(/\n/g, " "))));
  }
  if (issues.length) {
    L.push("", "## Avisos");
    issues.forEach((i) => L.push(bullet(issueText(i))));
  }
  return L.join("\n");
}

/* ───────────────────────── visão geral do projeto ───────────────────────── */

export interface ProjectDomainFile {
  path: string;
  doc: Doc;
}

/** Resumo consolidado de todos os diagramas `domain` do projeto. Somente leitura; nada é gravado. */
export function domainOverview(files: ProjectDomainFile[]): string {
  const domain = files.filter((f) => docMode(f.doc) === "domain").sort((a, b) => a.path.localeCompare(b.path));
  const exists = (p: string) => files.some((f) => f.path === p);
  const L: string[] = ["# Visão geral do domínio", ""];
  if (!domain.length) return L.concat("Nenhum diagrama de modo `domain` neste projeto. Crie um com `new_diagram` (mode: domain).").join("\n");

  const overviewFiles = domain.filter((f) => f.doc.connections.some((c) => c.ddd?.rel === "context-relation"));
  const ctxFiles = domain.filter((f) => f.doc.groups.some((g) => g.kind === "context"));
  const referencedByOverview = new Set(overviewFiles.flatMap((f) => f.doc.nodes.filter((n) => n.kind === "system" && n.ref).map((n) => n.ref!.diagram)));
  const allIssues: { path: string; issue: Issue }[] = [];
  for (const f of domain) for (const i of domainIssues(f.doc, { exists })) allIssues.push({ path: f.path, issue: i });

  // D017 (projeto): contextos × visão geral
  if (overviewFiles.length) {
    for (const f of ctxFiles) if (!overviewFiles.includes(f) && !referencedByOverview.has(f.path)) allIssues.push({ path: f.path, issue: { rule: "D017", severity: "aviso", message: `diagrama de contexto "${f.path}" não aparece na visão geral` } });
  }
  // D006 (projeto): evento externo exige relação entre os contextos
  const ctxIdOf = (f: ProjectDomainFile) => f.doc.groups.find((g) => g.kind === "context")?.id;
  const relPairs = new Set<string>();
  for (const f of overviewFiles) {
    for (const c of f.doc.connections) {
      if (c.ddd?.rel !== "context-relation") continue;
      const a = f.doc.nodes.find((n) => n.id === c.from)?.ref?.diagram ?? c.from;
      const b = f.doc.nodes.find((n) => n.id === c.to)?.ref?.diagram ?? c.to;
      relPairs.add(`${a}|${b}`);
      relPairs.add(`${b}|${a}`);
      const ca = ctxFiles.find((x) => x.path === a);
      const cb = ctxFiles.find((x) => x.path === b);
      if (ca && cb) {
        const ia = ctxIdOf(ca);
        const ib = ctxIdOf(cb);
        if (ia && ib) {
          relPairs.add(`${ia}|${ib}`);
          relPairs.add(`${ib}|${ia}`);
        }
      }
      relPairs.add(`${c.from}|${c.to}`);
      relPairs.add(`${c.to}|${c.from}`);
    }
  }
  for (const f of ctxFiles) {
    const me = ctxIdOf(f);
    for (const n of f.doc.nodes) {
      const ext = n.ddd?.external;
      if (!ext || !/^[^.\s]+\.[^.\s]+$/.test(ext)) continue;
      const other = ext.split(".")[0];
      const producer = ctxFiles.find((x) => ctxIdOf(x) === other);
      if (!producer) allIssues.push({ path: f.path, issue: { rule: "D006", severity: "aviso", message: `evento externo "${ext}": o contexto "${other}" não existe no projeto`, target: n.id } });
      else if (!producer.doc.nodes.some((e) => e.id === ext.split(".")[1] && e.ddd?.role === "domain-event")) allIssues.push({ path: f.path, issue: { rule: "D006", severity: "aviso", message: `evento externo "${ext}": o contexto "${other}" não publica o evento "${ext.split(".")[1]}"`, target: n.id } });
      else if (me && !relPairs.has(`${me}|${other}`)) allIssues.push({ path: f.path, issue: { rule: "D006", severity: "aviso", message: `evento externo "${ext}" consumido sem relação entre os contextos "${me}" e "${other}" na visão geral`, target: n.id } });
    }
  }

  L.push(`> ${domain.length} diagrama(s) de domínio · ${ctxFiles.length} contexto(s) · ${overviewFiles.length} visão(ões) geral(is)`);
  if (overviewFiles.length) {
    L.push("", "## Mapa de contextos");
    for (const f of overviewFiles) {
      L.push(`_${f.path}_`);
      for (const c of f.doc.connections.filter((x) => x.ddd?.rel === "context-relation")) {
        const lab = (id: string) => f.doc.nodes.find((n) => n.id === id)?.label ?? f.doc.groups.find((g) => g.id === id)?.label ?? id;
        const via = dddLabelVia(c.ddd, c.label);
        L.push(bullet(`${lab(c.from)} —${c.ddd!.pattern ?? "context-relation"}→ ${lab(c.to)}${via ? ` via ${via}` : ""}`));
      }
    }
  }

  L.push("", "## Contextos");
  if (!ctxFiles.length) L.push(bullet("nenhum: crie um grupo kind context (com subdomain) em um diagrama de domínio"));
  let ucTotal = 0;
  let ucOk = 0;
  for (const f of ctxFiles) {
    const d = f.doc;
    for (const g of d.groups.filter((x) => x.kind === "context")) {
      const inside = (n: NodeEl) => new Model(d).contextOf(n.id)?.id === g.id;
      const nodes = d.nodes.filter(inside);
      const count = (r: DddNodeSpec["role"]) => nodes.filter((n) => isRole(n, r)).length;
      const published = nodes.filter((n) => isRole(n, "domain-event") && !n.ddd!.external).map((n) => n.id);
      const consumed = nodes.filter((n) => isRole(n, "domain-event") && n.ddd!.external).map((n) => n.ddd!.external!);
      L.push(bullet(`**${g.label}** \`${g.id}\` (${g.subdomain ?? "sem subdomain"}) — \`${f.path}\``));
      L.push(bullet(`aggregates: ${count("aggregate-root")} · commands: ${count("command")} · eventos publicados: ${published.length ? published.join(", ") : "—"} · consumidos: ${consumed.length ? consumed.join(", ") : "—"}`, "  "));
    }
    for (const u of d.nodes.filter((n) => isRole(n, "use-case"))) {
      const t = traceUseCase(d, u.id)!;
      ucTotal++;
      if (t.ok) ucOk++;
    }
  }
  if (ucTotal) {
    L.push("", "## Casos de uso", bullet(`${ucOk} de ${ucTotal} rastreados até um evento (${Math.round((ucOk / ucTotal) * 100)}%)`));
    for (const f of ctxFiles) for (const u of f.doc.nodes.filter((n) => isRole(n, "use-case"))) {
      const t = traceUseCase(f.doc, u.id)!;
      L.push(bullet(`${t.ok ? "✔" : "✘"} \`${u.id}\` ${u.label} (${f.path})${t.ok ? "" : ` — ${t.problems.join("; ") || "sem caminho"}`}`));
    }
  }
  const rank: Record<Severity, number> = { erro: 0, aviso: 1, dica: 2 };
  allIssues.sort((a, b) => rank[a.issue.severity] - rank[b.issue.severity] || a.path.localeCompare(b.path) || a.issue.rule.localeCompare(b.issue.rule));
  L.push("", "## Avisos");
  if (!allIssues.length) L.push(bullet("nenhum"));
  else allIssues.forEach(({ path, issue }) => L.push(bullet(`${issueText(issue)} — \`${path}\``)));
  return L.join("\n");
}

/* ───────────────────────── guia para LLMs (modo domain) ───────────────────────── */

export function schemaGuideDomain(): string {
  const f = (r: keyof typeof DDD_ROLES) => DDD_ROLES[r].fields.join(", ") || "—";
  return [
    `# Archflow ${SCHEMA_VERSION} — guia do modo DOMAIN (DDD) para LLMs`,
    "",
    "Você modela o **domínio** (não a infraestrutura). Pense em contextos, aggregates, commands, eventos e casos de uso; o app calcula posições (`auto_layout`).",
    "Cada elemento de domínio é um componente `kind: \"domain\"` com `ddd: { role, ...campos do papel }`. Contextos são grupos `kind: \"context\"` (com `subdomain`).",
    "",
    "## Papéis (`ddd.role`) e seus campos",
    ...DDD_ROLE_KEYS.map((r) => `- \`${r}\` (${DDD_ROLES[r].label}): ${DDD_ROLES[r].hint} Campos: ${f(r)}`),
    "",
    "## Campos de texto, em uma frase",
    "- `intent` (command, policy, process-manager, domain-service, application-service): o que o elemento faz, em uma frase de negócio (command: a mudança que ele pede; policy: a reação; serviços: o que o serviço faz).",
    "- `invariants` (aggregate-root, entity, value-object, command): lista de textos livres, um por item, só DOCUMENTAL: o app não executa nem confere. Em aggregate, entity e value-object são as regras que sempre valem; no command, as condições para ele ser aceito. Viram comentário no código gerado e aparecem na história do caso de uso.",
    "- `step` (só command): número que ordena os commands no `auto_layout` `timeline` (menor primeiro; sem `step`, vai para o fim na ordem de criação). Não tem outro efeito e não existe em evento.",
    "- `actor` (use-case): TEXTO livre com quem executa (o nome do papel). Aparece no cartão, na descrição e na tabela do código. Não é uma ligação: para desenhar o ator, crie um componente `kind: \"actor\"` e ligue-o ao use-case por `association`; os dois são independentes (o app não confere se combinam).",
    "- `external` (domain-event): `\"contexto.evento\"` = o id do grupo `context` do OUTRO diagrama + o id do evento nele; a visão geral do projeto confere se os dois existem (D006).",
    "- `subdomain` (grupo context): `core`, `supporting` ou `generic`. É informativo: aparece na descrição, falta dá a dica D014 e um `generic` com mais de 5 aggregates dá a dica D015.",
    "",
    "## Qual elemento usar (quando dois parecem servir)",
    "- `use-case`: o OBJETIVO de um ator, em linguagem de negócio (\"Fazer pedido\"). Não faz nada sozinho: precisa de pelo menos um realizador, ligado por `realizes` ou `ddd.realizedBy` (D001).",
    "- `command`: a mudança concreta pedida a UM aggregate (aponta por `triggers` para exatamente um aggregate-root, D002) e quem emite o evento. Se o caso de uso muda um aggregate só, o command realiza o use-case direto, sem application-service.",
    "- `application-service`: só quando o caso de uso atravessa vários passos (mais de um aggregate, serviço ou repository). Orquestra (carrega, chama o domínio, persiste), mas não tem regra (sem `invariants`) nem emite evento (D013): quem emite é o aggregate ou o command que ele chama. Realiza o use-case (`realizes`) e usa (`uses`) domain-service e repository.",
    "- `policy`: reação simples e SEM estado: quando um evento acontece, dispara um command. `process-manager` (saga): o fluxo tem vários passos no tempo, guarda estado e pode compensar (`compensates`); precisa de um evento de entrada e de um command de saída (D018).",
    "- `reactsTo` (policy e process-manager) é só a lista de eventos a que o elemento reage, igual nos dois papéis: o app não distingue «qualquer um» de «todos». Por convenção, a policy reage a cada evento por si; a saga é quem pode juntar vários (espera) e compensar.",
    "- `description` (qualquer componente, de qualquer papel): texto livre sobre o componente; não é um campo do papel, por isso não aparece nas listas de campos. É onde se registra o que foi inferido ou assumido.",
    "- **Quem emite um evento** (`emits`): o `command` (o normal), o `aggregate-root` ou o `process-manager` (marcos do processo). O `application-service` nunca emite (D013): ele só entrega ao publicador os eventos que o aggregate produziu.",
    "",
    "## Subdomain (grupo context)",
    ...Object.entries(SUBDOMAINS).map(([k, v]) => `- \`${k}\`: ${v}`),
    "",
    "## Relações (`connect` com `ddd: { rel, pattern? }`; o `type` é inferido)",
    ...DDD_REL_KEYS.map((k) => `- \`${k}\` (${DDD_RELS[k].type}): ${DDD_RELS[k].semantics}`),
    "",
    "## Condições, loops e iteração (só no modo domain)",
    "- **Condição num ramo**: `ddd.condition` (texto: \"atraso > 0\") em conexões `triggers`/`emits`; `ddd.otherwise: true` é o ramo padrão (senão). Os dois não se combinam.",
    "- **Nomes do modo logic que NÃO existem aqui como nós**: `decision`, `switch`, `fork`, `join` e `loop`. No domain a condição é um atributo da conexão, o laço é `ddd.loop` na conexão que volta (o app não executa nada disso) e a espera por vários eventos é um `process-manager`.",
    "- **Não existe `decision` no modo domain** (ela é só do modo logic). Para escolher um caminho, a `policy` (ou a saga) que reage ao evento liga-se por `triggers` a mais de um command, cada ramo com `condition` (por convenção de leitura, segue o primeiro ramo cuja condição é verdadeira, na ordem das conexões; o app não executa isso) ou `otherwise` (o padrão); ramos sem condição seguem todos (paralelo). Para modelar uma espera por vários eventos (agir só quando todos chegaram), use um `process-manager` com todos eles em `reactsTo`: o app só documenta isso, não executa nem confere a espera.",
    "- `condition`, `loop.until` e `foreach` são TEXTO livre em linguagem de negócio (`atraso > 0`, `pagamento aprovado`, `item do pedido`): NÃO são as expressões do modo logic. O app não as interpreta nem executa; só as mostra no rótulo da conexão, na descrição e no código gerado. A ordem dos ramos é a ordem em que as conexões foram criadas, só para leitura. `condition` e `otherwise` não se combinam; `foreach`, `condition` e `loop` podem aparecer juntos na mesma conexão. `loop.max` é um inteiro de 1 a 1000 (sem padrão) e a conexão com `loop` deve voltar a um passo anterior (senão, dica D030).",
    "- Quando algum ramo de um nó tem condição, todos os irmãos têm `condition` ou `otherwise`, só um é `otherwise`, e é bom ter um (senão, se nenhuma condição valer o fluxo para): avisos D025 e D026.",
    "- **Loop**: marque a conexão que VOLTA a um passo anterior com `ddd.loop: { until, max }` (pelo menos um dos dois: sem condição de parada é erro). Ciclo que passa por um nó com ramos condicionais sem loop declarado é aviso (D028).",
    "- **Iteração**: `ddd.foreach` (\"item do pedido\") em `triggers`/`emits` = repete para cada elemento.",
    "- Exemplo (retentativa de cobrança): `pagamento-recusado` —triggers→ policy `ha-tentativas`; `ha-tentativas` —triggers [condition: \"tentativas < 3\", loop: { until: \"pagamento aprovado\", max: 3 }]→ command `cobrar`; `ha-tentativas` —triggers [otherwise]→ command `desistir-da-cobranca`.",
    "- Isto NÃO existe no modo architecture: lá o fluxo é só o tipo da conexão.",
    "",
    "## Regras dos conectores (modo domain)",
    "- Cada relação só liga certos papéis (violação = aviso D021, com a sugestão do que serve):",
    ...DDD_REL_KEYS.map((k) => `  - \`${k}\`: ${relPairsText(k)}`),
    "- O **type vem da relação** e não pode contradizê-la (D023): omita `type` em `connect`.",
    "- **sync, async, stream e data não existem** no modo domain (o `async` de `emits` é inferido). Sem relação use um tipo UML: association, dependency, inheritance, realization, composition ou aggregation.",
    "- Se você omitir `ddd` e só uma relação servir para o par (ex.: command → evento = emits), a conexão **já nasce com ela**. Ator → caso de uso não tem relação: use association.",
    "- Conexão entre dois elementos de domínio sem relação é aviso D022.",
    "",
    "## Regra de camadas e portas (inversão de dependência)",
    "- Camadas, de dentro para fora: Entities → Use Cases → Interface Adapters → Frameworks & Drivers (a camada vem do papel). Uma camada interna NÃO depende de uma externa (erro D034); de fora para dentro é livre. Evento que dispara uma reação não conta (quem depende é o assinante).",
    "- **Porta** (`port: { name, operations? }` na conexão, em `connect` ou `update_element`): a origem depende de uma interface da PRÓPRIA camada (`name`, ex.: \"RepositorioDePedidos\") e o destino, mais externo, a implementa. Com porta, depender de fora é válido. Ex.: command `criar-pedido` —uses→ repository `pedidos-repo` com `port: { name: \"RepositorioDePedidos\", operations: [\"salvar(pedido)\"] }`.",
    "- Use Cases chamando repository ou sistema sem `port` é aceito (porta implícita), mas gera a dica D035: declare a porta para documentar a interface. Porta numa conexão que não sai para uma camada mais externa é a dica D036.",
    "",
    "## Padrões do Context Map (`pattern`, só com `context-relation`)",
    ...CONTEXT_PATTERN_KEYS.map((k) => `- \`${k}\` (${CONTEXT_PATTERNS[k].label}): ${CONTEXT_PATTERNS[k].hint}`),
    "",
    "## Convenções que o validador exige",
    "- Cada campo de id equivale a uma conexão: `reactsTo` (policy, saga) = `triggers` de um evento para o elemento; `issues` (policy, saga) = `triggers` do elemento para um command; `realizedBy` (use-case) = `realizes`; `producedBy` (evento) = `emits` do produtor; `projectsFrom` (read-model) = `triggers` de um evento para o read-model.",
    "- **Campos que repetem conexões** (`realizedBy`, `producedBy`, `reactsTo`, `issues`, `projectsFrom`): guardam **ids de nós** (nunca rótulos) e valem **junto** com a conexão equivalente (`realizes`, `emits`, `triggers`): o app une os dois, então se divergirem vale tudo o que aparece em qualquer um. Id que não existe é erro D020. Prefira a conexão (aparece no quadro); o campo serve a quem importa dados sem desenhar as setas. `compensates` (process-manager) são os ids dos commands que DESFAZEM o que a saga já fez (os compensadores, não os compensados; id inexistente é D020; o código gerado lista o método `compensate`) e, como `for`, não têm conexão equivalente (`for` guarda um só id, o aggregate-root do repository).",
    "- Todo `use-case` precisa de pelo menos um realizador (D001): um `command` (o rastreio segue command → aggregate → evento) ou, para um caso de uso que só consulta ou que atravessa vários passos, um `application-service` ou `domain-service` (o rastreio termina nele). Ligue por `realizes` ou liste o id em `ddd.realizedBy`; o app só confere que o id existe (D020), não o papel.",
    "- Todo `command` aponta (rel `triggers`) para exatamente UM `aggregate-root`.",
    "- Todo `domain-event` tem produtor: rel `emits` de um command/aggregate-root, ou `ddd.producedBy`. Cópia de evento de outro contexto usa `ddd.external: \"contexto.evento\"`.",
    "- `entity` e `value-object` ficam dentro de um aggregate: `aggregate-root` —contains→ entity/value-object.",
    "- Aggregates só se referenciam por id: rel `references-by-id`. Nunca ligue dois aggregates por objeto.",
    "- `repository` tem `ddd.for` = id de um `aggregate-root`.",
    "- Commands no imperativo (`criar-pedido`), eventos no passado (`pedido-criado`).",
    "",
    "## Propriedades (estrutura de entity, value-object, aggregate-root, command, domain-event e read-model)",
    "- `ddd.properties`: lista de `{ name, type?, optional?, key?, description?, example? }`. Descreve a estrutura campo a campo: `type` é texto livre (`uuid`, `texto`, `inteiro`, `data`, `Item[]` ou o nome de outro value-object do contexto), `key: true` marca o identificador (só muda o código gerado da entity: nome e tipo do id; no value-object não vale, porque ele não tem identidade), `optional: true` o que pode faltar (sem ele o campo é obrigatório), `description` diz o que o campo significa e por que existe, e `example` é texto livre que vira um `ex.:` no comentário do código.",
    "- Em command são os parâmetros; em domain-event, os campos do evento; em read-model, as colunas.",
    "- `payload` (só domain-event) é um resumo em TEXTO LIVRE, herdado de versões antigas: serve só quando o evento não tem `properties`. Se os dois existirem, vale `properties` (a descrição do modelo e o código gerado ignoram o `payload`); a história do caso de uso mostra os dois. Prefira sempre `properties`.",
    "- Preencha ao menos as propriedades do aggregate-root, das entities e dos value objects: elas aparecem no passo a passo da apresentação, na descrição do modelo e viram campos tipados no código gerado.",
    "",
    "## Fluxo recomendado",
    "1. `new_diagram` com `mode: \"domain\"` (um diagrama por bounded context + um de visão geral).",
    "2. `add_groups` (um `context` com `subdomain`) e `add_use_cases` com os casos de uso do usuário.",
    "3. `add_components` (aggregates, entities, value objects, commands, eventos) e `connect` com `ddd.rel`.",
    "4. `validate_diagram` e `trace`: corrija os erros D001–D005 antes de responder; relate o que não soube inferir.",
    "5. `auto_layout`. Ao retomar um diagrama editado pelo usuário, leia com `get_diagram` e **reutilize os ids**, sem recriar.",
    "",
    "Heurísticas são SUGESTÃO: verbo = command, particípio passado = evento, substantivo com identidade = entity, sem identidade = value-object. Marque em `description` o que você inferiu.",
    "Ids são slugs estáveis (`pedido`, `criar-pedido`, `pedido-criado`).",
  ].join("\n");
}

/* ───────────────────────── avaliação objetiva de um modelo ───────────────────────── */

/** Metas para considerar um modelo (gerado por uma IA, sem revisão humana) aceitável. */
export const EVAL_TARGETS = { tracedPct: 90, structuralErrors: 0, issuesToFix: 2 } as const;
const STRUCTURAL_RULES = new Set(["D004", "D005", "D008", "D018", "D019"]);

export interface DomainEval {
  useCases: number;
  /** casos de uso rastreados até um evento */
  traced: number;
  /** 0–100; 100 quando não há casos de uso */
  tracedPct: number;
  /** erros estruturais (D004, D005, D008, D018, D019): o modelo viola o próprio DDD */
  structuralErrors: number;
  /** erros + avisos que uma pessoa teria de corrigir (dicas não contam) */
  issuesToFix: number;
  /** elementos de domínio repetidos (mesmo papel e nome): sinal de que a IA recriou em vez de reaproveitar ids */
  duplicates: string[];
  ok: boolean;
}

export function evaluateDomain(doc: Doc, opts: { exists?: (path: string) => boolean } = {}): DomainEval {
  const issues = domainIssues(doc, opts);
  const ucs = doc.nodes.filter((n) => n.ddd?.role === "use-case");
  const traced = ucs.filter((u) => traceUseCase(doc, u.id)?.ok).length;
  const tracedPct = ucs.length ? Math.round((traced / ucs.length) * 100) : 100;
  const seen = new Map<string, string>();
  const duplicates: string[] = [];
  for (const n of doc.nodes) {
    if (!n.ddd) continue;
    const key = `${n.ddd.role}:${n.label.trim().toLowerCase()}`;
    if (seen.has(key)) duplicates.push(`${n.id} repete ${seen.get(key)}`);
    else seen.set(key, n.id);
  }
  const structuralErrors = issues.filter((i) => i.severity === "erro" && STRUCTURAL_RULES.has(i.rule)).length;
  const issuesToFix = issues.filter((i) => i.severity !== "dica").length;
  return {
    useCases: ucs.length,
    traced,
    tracedPct,
    structuralErrors,
    issuesToFix,
    duplicates,
    ok: tracedPct >= EVAL_TARGETS.tracedPct && structuralErrors <= EVAL_TARGETS.structuralErrors && issuesToFix <= EVAL_TARGETS.issuesToFix && !duplicates.length,
  };
}
