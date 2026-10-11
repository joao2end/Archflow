import { boxOf, edgeGeoms, labelPoint, labelSize, samplePath, segmentHitsRect } from "../ui/geometry";
import { BUILTIN_ASSETS, searchAssets } from "./catalog";
import {
  CONNECTION_TYPES,
  ENDPOINT_H,
  ENDPOINT_W,
  GROUP_KINDS,
  NODE_H,
  ENDPOINT_PROTOCOLS,
  NODE_KINDS,
  NODE_W,
  DDD_RELS,
  DDD_ROLES,
  LOGIC_ROLES,
  SCHEMA_VERSION,
  SUBDOMAINS,
  docMode,
  emptyDoc,
  endpointBadge,
  endpointLabel,
  type Asset,
  type ConnectionEl,
  type ConnectionType,
  type DddConnSpec,
  type DddNodeSpec,
  type LogicConnSpec,
  type LogicNodeSpec,
  type DddRel,
  type DiagramRef,
  type Doc,
  type DocMode,
  type Subdomain,
  type EndpointProtocol,
  type EndpointSpec,
  type GroupEl,
  type GroupKind,
  type InterfaceSpec,
  type NodeEl,
  type NodeKind,
  type Routing,
} from "./schema";
import { layeredLayout, shelfPack } from "./layout";
import { stormLayout } from "./storm";
import { logicLayout } from "./logiclayout";
import { pipelineSequence, branchLabel, caseLabel, checkLogicConn, checkLogicNode, describeLogic, factNames, hasFlow, logicIssues, schemaGuideLogic } from "./logic";
import { logicSize } from "./logiccard";
import { checkDddConn, checkDddNode, composeDddLabel, connectionTypeError, dddLabelVia, describeDomain, domainIssues, issueText, schemaGuideDomain, suggestRels, type Issue } from "./domain";

/** Tipos de componente aceitos em cada modo (arquitetura aceita todos). Domain e Logic só carregam o que é compatível com o modo. */
export const MODE_KINDS: Partial<Record<DocMode, NodeKind[]>> = {
  domain: ["domain", "actor", "system", "external"],
  logic: ["logic", "system"],
};

/* ───────────────────────── operações semânticas (UI e MCP usam as mesmas) ───────────────────────── */

export type Op =
  | { op: "add_node"; id?: string; asset?: string; label?: string; kind?: NodeKind; description?: string; technology?: string; parent?: string; props?: Record<string, string>; endpoint?: EndpointSpec; owner?: string; ref?: DiagramRef; ddd?: DddNodeSpec; logic?: LogicNodeSpec; x?: number; y?: number }
  | { op: "add_endpoint"; id?: string; owner: string; protocol?: EndpointProtocol; method?: string; path?: string; request?: string; response?: string; auth?: string; label?: string; description?: string }
  | { op: "add_group"; id?: string; label: string; kind?: GroupKind; description?: string; parent?: string; color?: string; subdomain?: Subdomain; x?: number; y?: number; w?: number; h?: number }
  | { op: "add_note"; id?: string; text: string; x?: number; y?: number; variant?: "note" | "text" | "list"; title?: string; checklist?: boolean }
  | { op: "add_connection"; id?: string; from: string; to: string; type?: ConnectionType; label?: string; protocol?: string; description?: string; interface?: InterfaceSpec; routing?: Routing; waypoints?: { x: number; y: number }[]; animated?: boolean; ddd?: DddConnSpec; logic?: LogicConnSpec }
  | { op: "update"; id: string; patch: Record<string, unknown> }
  | { op: "remove"; id: string }
  | { op: "add_asset"; asset: Partial<Asset> & { name: string } }
  | { op: "layout"; style?: "flow" | "timeline" | "pipeline"; direction?: "LR" | "TB"; spacing?: Spacing; minGap?: number; gapX?: number; gapY?: number; routing?: Routing }
  | { op: "set_meta"; title?: string; description?: string; mode?: DocMode }
  | { op: "clear" };

export interface OpResult {
  ok: boolean;
  id?: string;
  error?: string;
}

export function allAssets(doc: Doc): Asset[] {
  const custom = new Map(doc.customAssets.map((a) => [a.id, a]));
  return [...custom.values(), ...BUILTIN_ASSETS.filter((a) => !custom.has(a.id))];
}

export function findAsset(doc: Doc, id?: string): Asset | undefined {
  return id ? allAssets(doc).find((a) => a.id === id) : undefined;
}

export function slug(s: string): string {
  return (
    s
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "item"
  );
}

export function allIds(doc: Doc): Set<string> {
  return new Set([
    ...doc.nodes.map((n) => n.id),
    ...doc.groups.map((n) => n.id),
    ...doc.notes.map((n) => n.id),
    ...doc.connections.map((n) => n.id),
  ]);
}

export function uniqueId(doc: Doc, wanted: string): string {
  const ids = allIds(doc);
  const base = slug(wanted);
  if (!ids.has(base)) return base;
  let i = 2;
  while (ids.has(`${base}-${i}`)) i++;
  return `${base}-${i}`;
}

type Rect = { x: number; y: number; w: number; h: number };
const overlaps = (a: Rect, b: Rect, gap = 24) =>
  a.x < b.x + b.w + gap && a.x + a.w + gap > b.x && a.y < b.y + b.h + gap && a.y + a.h + gap > b.y;

function findFreeSpot(doc: Doc, w: number, h: number, origin = { x: 0, y: 0 }, cols = 4): { x: number; y: number } {
  const taken: Rect[] = [...doc.nodes, ...doc.notes, ...doc.groups.filter((g) => !g.parent)];
  const sx = NODE_W + 56;
  const sy = NODE_H + 56;
  for (let i = 0; i < 400; i++) {
    const c = { x: origin.x + (i % cols) * sx, y: origin.y + Math.floor(i / cols) * sy, w, h };
    if (!taken.some((t) => overlaps(c, t))) return { x: c.x, y: c.y };
  }
  return origin;
}

const PAD = 28;
const TOP = 54;
const EP_GAP = 8;
const EP_INDENT = 28;

/** Endpoints de um serviço, na ordem em que aparecem empilhados abaixo dele. */
export const endpointsOf = (doc: Doc, ownerId: string) => doc.nodes.filter((n) => n.owner === ownerId);
/** Altura extra que a pilha de endpoints ocupa abaixo do serviço. */
export const stackHeight = (doc: Doc, ownerId: string) => {
  const k = endpointsOf(doc, ownerId).length;
  return k ? 10 + k * (ENDPOINT_H + EP_GAP) : 0;
};
function stackPos(doc: Doc, owner: NodeEl): { x: number; y: number } {
  const k = endpointsOf(doc, owner.id).length;
  return { x: owner.x + EP_INDENT, y: owner.y + owner.h + 10 + k * (ENDPOINT_H + EP_GAP) };
}
/** Reposiciona os endpoints de um serviço (usado por layout e ao mover). */
export function restack(doc: Doc, owner: NodeEl) {
  endpointsOf(doc, owner.id).forEach((e, i) => {
    e.x = owner.x + EP_INDENT;
    e.y = owner.y + owner.h + 10 + i * (ENDPOINT_H + EP_GAP);
  });
}

/** Recalcula o retângulo de um grupo `auto` para conter os filhos (e propaga para os ancestrais). */
export function fitGroup(doc: Doc, id: string | undefined) {
  while (id) {
    const g = doc.groups.find((x) => x.id === id);
    if (!g) return;
    const kids: Rect[] = [
      ...doc.nodes.filter((n) => n.parent === id),
      ...doc.groups.filter((n) => n.parent === id),
    ];
    if (g.auto && kids.length) {
      const x1 = Math.min(...kids.map((k) => k.x)) - PAD;
      const y1 = Math.min(...kids.map((k) => k.y)) - TOP;
      const x2 = Math.max(...kids.map((k) => k.x + k.w)) + PAD;
      const y2 = Math.max(...kids.map((k) => k.y + k.h)) + PAD;
      g.x = x1;
      g.y = y1;
      g.w = Math.max(240, x2 - x1);
      g.h = Math.max(140, y2 - y1);
    }
    id = g.parent;
  }
}

export function isContainerOf(doc: Doc, ancestor: string, id: string): boolean {
  let cur = doc.nodes.find((n) => n.id === id)?.parent ?? doc.groups.find((n) => n.id === id)?.parent;
  const guard = new Set<string>();
  while (cur && !guard.has(cur)) {
    if (cur === ancestor) return true;
    guard.add(cur);
    cur = doc.groups.find((n) => n.id === cur)?.parent;
  }
  return false;
}

export function applyOps(input: Doc, ops: Op[]): { doc: Doc; results: OpResult[] } {
  const doc: Doc = structuredClone(input);
  const results: OpResult[] = [];
  const touched = new Set<string>();

  for (const op of ops) {
    try {
      results.push(applyOne(doc, op, touched));
    } catch (e) {
      results.push({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  }
  touched.forEach((g) => fitGroup(doc, g));
  return { doc, results };
}

function applyOne(doc: Doc, op: Op, touched: Set<string>): OpResult {
  switch (op.op) {
    case "add_node": {
      const asset = findAsset(doc, op.asset);
      if (op.asset && !asset) {
        const hint = searchAssets(allAssets(doc), op.asset).slice(0, 5).map((a) => a.id).join(", ");
        return { ok: false, error: `asset "${op.asset}" não existe.${hint ? ` Parecidos: ${hint}.` : ""} Use search_assets ou omita "asset".` };
      }
      if (op.parent && !doc.groups.some((g) => g.id === op.parent)) return { ok: false, error: `parent "${op.parent}" não é um grupo existente` };
      const endpoint: EndpointSpec | undefined = op.endpoint ?? (asset?.endpoint ? { ...asset.endpoint } : undefined);
      const owner = op.owner ? doc.nodes.find((n) => n.id === op.owner) : undefined;
      if (op.owner && !owner) return { ok: false, error: `owner "${op.owner}" não é um componente existente` };
      if (owner && owner.kind === "endpoint") return { ok: false, error: "um endpoint não pode ser dono de outro endpoint" };
      if (op.ref && !op.ref.diagram) return { ok: false, error: "ref.diagram é obrigatório (caminho relativo ao cofre)" };
      const ddd: DddNodeSpec | undefined = op.ddd ?? (asset?.ddd ? { ...asset.ddd } : undefined);
      if (ddd !== undefined || op.kind === "domain") {
        if (docMode(doc) !== "domain") return { ok: false, error: `papéis de domínio (kind "domain" / ddd) só existem em diagramas de modo "domain"; crie o diagrama com new_diagram mode "domain" ou troque o modo em set_diagram_info` };
        const bad = checkDddNode(ddd);
        if (bad) return { ok: false, error: bad };
        if (op.kind && op.kind !== "domain") return { ok: false, error: `um nó com ddd tem kind "domain" (recebeu "${op.kind}")` };
      }
      const logic: LogicNodeSpec | undefined = op.logic ?? (asset?.logic ? { ...asset.logic } : undefined);
      if (logic !== undefined || op.kind === "logic") {
        if (docMode(doc) !== "logic") return { ok: false, error: `papéis de lógica (kind "logic" / logic) só existem em diagramas de modo "logic"; crie o diagrama com new_diagram mode "logic" ou troque o modo em set_diagram_info` };
        const bad = checkLogicNode(logic);
        if (bad) return { ok: false, error: bad };
        if (op.kind && op.kind !== "logic") return { ok: false, error: `um nó com logic tem kind "logic" (recebeu "${op.kind}")` };
        if (ddd) return { ok: false, error: "um nó tem ddd OU logic, não os dois" };
      }
      const label = op.label ?? (endpoint ? endpointLabel(endpoint) : ddd ? DDD_ROLES[ddd.role].label : logic ? LOGIC_ROLES[logic.role].label : asset?.name) ?? "Componente";
      const id = uniqueId(doc, op.id ?? (endpoint && owner ? `${owner.id}-${label}` : label));
      const parent = owner ? owner.parent : op.parent && doc.groups.some((g) => g.id === op.parent) ? op.parent : undefined;
      const kind: NodeKind = op.kind ?? (ddd ? "domain" : logic ? "logic" : endpoint ? "endpoint" : op.ref ? "system" : asset?.kind ?? "service");
      const allowed = MODE_KINDS[docMode(doc)];
      if (allowed && !allowed.includes(kind)) return { ok: false, error: `componente "${kind}"${asset ? ` (asset "${asset.id}")` : ""} não existe no modo ${docMode(doc)}. Neste modo só entram: ${allowed.join(", ")}. Crie um diagrama de arquitetura para componentes de infraestrutura.` };
      const isEp = kind === "endpoint";
      const lsize = logic ? logicSize({ id, label, kind, x: 0, y: 0, w: 0, h: 0, logic } as NodeEl, factNames(doc)) : undefined;
      const w = lsize?.w ?? (isEp ? ENDPOINT_W : NODE_W);
      const h = lsize?.h ?? (isEp ? ENDPOINT_H : NODE_H);
      let pos = op.x != null && op.y != null ? { x: op.x, y: op.y } : undefined;
      if (!pos && owner && isEp) pos = stackPos(doc, owner);
      if (!pos) {
        const pg = doc.groups.find((g) => g.id === parent);
        pos = findFreeSpot(doc, w, h, pg ? { x: pg.x + PAD, y: pg.y + TOP } : { x: 0, y: 0 }, pg ? 3 : 4);
      }
      const node: NodeEl = {
        id,
        label,
        kind,
        asset: asset?.id,
        technology: op.technology ?? (!isEp && asset && asset.name !== label && asset.category !== "Genéricos" ? asset.name : undefined),
        description: op.description,
        parent,
        props: op.props,
        endpoint: isEp ? endpoint ?? { protocol: "rest", method: "GET", path: "/resource" } : undefined,
        owner: owner?.id,
        ref: op.ref,
        ...(ddd ? { ddd } : {}),
        ...(logic ? { logic } : {}),
        x: pos.x,
        y: pos.y,
        w,
        h,
      };
      doc.nodes.push(node);
      if (parent) touched.add(parent);
      return { ok: true, id };
    }
    case "add_endpoint": {
      const { op: _o, owner, protocol, method, path, request, response, auth, ...rest } = op;
      return applyOne(doc, { op: "add_node", owner, kind: "endpoint", endpoint: { protocol: protocol ?? "rest", method, path, request, response, auth }, ...rest }, touched);
    }
    case "add_group": {
      if (op.parent && !doc.groups.some((g) => g.id === op.parent)) return { ok: false, error: `parent "${op.parent}" não é um grupo existente` };
      if (op.subdomain !== undefined) {
        if (op.kind !== "context") return { ok: false, error: `subdomain só vale em grupos kind "context"` };
        if (!(op.subdomain in SUBDOMAINS)) return { ok: false, error: `subdomain inválido "${op.subdomain}". Válidos: ${Object.keys(SUBDOMAINS).join(", ")}` };
      }
      const id = uniqueId(doc, op.id ?? op.label);
      const sized = op.w != null && op.h != null;
      const pos = op.x != null && op.y != null ? { x: op.x, y: op.y } : findFreeSpot(doc, 320, 200, { x: 0, y: 0 }, 3);
      const g: GroupEl = {
        id,
        label: op.label,
        kind: op.kind ?? "boundary",
        description: op.description,
        parent: op.parent,
        color: op.color,
        ...(op.subdomain ? { subdomain: op.subdomain } : {}),
        x: pos.x,
        y: pos.y,
        w: op.w ?? 320,
        h: op.h ?? 200,
        auto: !sized,
      };
      doc.groups.push(g);
      if (op.parent) touched.add(op.parent);
      return { ok: true, id };
    }
    case "add_note": {
      const id = uniqueId(doc, op.id ?? "note");
      const pos = op.x != null && op.y != null ? { x: op.x, y: op.y } : findFreeSpot(doc, 200, 110);
      doc.notes.push({ id, ...(op.variant && op.variant !== "note" ? { variant: op.variant } : {}), ...(op.title ? { title: op.title } : {}), ...(op.checklist != null ? { checklist: op.checklist } : {}), text: op.text, x: pos.x, y: pos.y, w: 200, h: 110 });
      return { ok: true, id };
    }
    case "add_connection": {
      const exists = (id: string) => doc.nodes.some((n) => n.id === id) || doc.groups.some((g) => g.id === id);
      if (!exists(op.from)) return { ok: false, error: `"from" ${op.from} não existe` };
      if (!exists(op.to)) return { ok: false, error: `"to" ${op.to} não existe` };
      if (op.ddd !== undefined) {
        if (docMode(doc) !== "domain") return { ok: false, error: `ddd.rel só existe em diagramas de modo "domain"` };
        const bad = checkDddConn(op.ddd);
        if (bad) return { ok: false, error: bad };
      }
      if (op.logic !== undefined) {
        if (docMode(doc) !== "logic") return { ok: false, error: `logic (saída da decisão, escolha ou laço) só existe em diagramas de modo "logic"` };
        const bad = checkLogicConn(op.logic);
        if (bad) return { ok: false, error: bad };
      }
      // modo domain: o tipo do conector vem da relação de domínio; infraestrutura (sync/async/stream/data) não existe aqui
      let ddd = op.ddd;
      const domainMode = docMode(doc) === "domain";
      if (domainMode) {
        const typeBad = connectionTypeError(ddd?.rel, op.type);
        if (typeBad) return { ok: false, error: typeBad };
        if (!ddd) {
          const only = suggestRels(doc, op.from, op.to);
          if (only.length === 1) ddd = { rel: only[0] }; // um par de elementos de domínio com uma única relação possível: já nasce com ela
        }
      }
      const type = op.type ?? (ddd ? DDD_RELS[ddd.rel].type : domainMode ? "association" : docMode(doc) === "logic" ? "data" : "sync");
      if (!CONNECTION_TYPES[type]) return { ok: false, error: `type inválido "${type}". Válidos: ${Object.keys(CONNECTION_TYPES).join(", ")}` };
      const id = uniqueId(doc, op.id ?? `${op.from}-to-${op.to}`);
      const c: ConnectionEl = {
        id,
        from: op.from,
        to: op.to,
        type,
        label: ddd ? composeDddLabel(ddd, op.label) : docMode(doc) === "logic" ? op.label ?? (op.logic?.case !== undefined ? caseLabel(doc, op.from, op.logic.case) : branchLabel(op.logic)) ?? "" : op.label,
        protocol: op.protocol,
        description: op.description,
        interface: op.interface,
        routing: op.routing ?? "curve",
        ...(op.waypoints?.length ? { waypoints: op.waypoints } : {}),
        animated: op.animated ?? true,
        ...(ddd ? { ddd } : {}),
        ...(op.logic ? { logic: op.logic } : {}),
      };
      doc.connections.push(c);
      return { ok: true, id };
    }
    case "update": {
      const el: any = [...doc.nodes, ...doc.groups, ...doc.notes, ...doc.connections].find((e) => e.id === op.id);
      if (!el) return { ok: false, error: `elemento "${op.id}" não existe` };
      const { id: _ignore, ...patch } = op.patch as Record<string, unknown>;
      const isNode = doc.nodes.includes(el);
      const isConn = doc.connections.includes(el);
      if ("ddd" in patch && patch.ddd != null) {
        if (docMode(doc) !== "domain") return { ok: false, error: `ddd só existe em diagramas de modo "domain"` };
        const bad = isConn ? checkDddConn(patch.ddd) : isNode ? checkDddNode(patch.ddd) : "ddd não se aplica a grupos (use subdomain em contextos)";
        if (bad) return { ok: false, error: bad };
        if (isNode && (patch.kind ?? el.kind) !== "domain") return { ok: false, error: `um nó com ddd tem kind "domain"; inclua kind: "domain" no patch` };
      }
      if (isConn && docMode(doc) === "domain") {
        const rel = ("ddd" in patch ? (patch.ddd as { rel?: DddRel } | null)?.rel : el.ddd?.rel) as DddRel | undefined;
        const typeBad = connectionTypeError(rel, patch.type as ConnectionType | undefined);
        if (typeBad) return { ok: false, error: typeBad };
        // ao definir a relação sem dizer o tipo, o tipo acompanha a relação
        if (rel && "ddd" in patch && patch.ddd != null && patch.type === undefined) patch.type = DDD_RELS[rel].type;
      }
      if (!isConn && "logic" in patch && patch.logic != null) {
        if (docMode(doc) !== "logic") return { ok: false, error: `logic só existe em diagramas de modo "logic"` };
        const bad = isNode ? checkLogicNode(patch.logic) : "logic só se aplica a componentes";
        if (bad) return { ok: false, error: bad };
        if (isNode && (patch.kind ?? el.kind) !== "logic") return { ok: false, error: `um nó com logic tem kind "logic"; inclua kind: "logic" no patch` };
      }
      if (isConn && "logic" in patch && patch.logic != null) {
        if (docMode(doc) !== "logic") return { ok: false, error: `logic só existe em diagramas de modo "logic"` };
        const bad = checkLogicConn(patch.logic);
        if (bad) return { ok: false, error: bad };
        if (patch.label === undefined) patch.label = (patch.logic as LogicConnSpec).case !== undefined ? caseLabel(doc, el.from, (patch.logic as LogicConnSpec).case!) : branchLabel(patch.logic as LogicConnSpec) ?? "";
      }
      if (isNode && patch.kind === "logic" && !(patch.logic ?? el.logic)) return { ok: false, error: `kind "logic" exige logic.role` };
      if (isNode && patch.kind === "domain" && !(patch.ddd ?? el.ddd)) return { ok: false, error: `kind "domain" exige ddd.role` };
      if ("subdomain" in patch && patch.subdomain != null) {
        if (!doc.groups.includes(el) || el.kind !== "context") return { ok: false, error: `subdomain só vale em grupos kind "context"` };
        if (!(patch.subdomain as string in SUBDOMAINS)) return { ok: false, error: `subdomain inválido "${patch.subdomain}". Válidos: ${Object.keys(SUBDOMAINS).join(", ")}` };
      }
      const before = el.parent;
      const prevDdd = isConn ? (el.ddd as DddConnSpec | undefined) : undefined;
      const prevLabel = el.label as string | undefined;
      Object.assign(el, patch);
      // trocar a relação/fluxo (ddd) sem dizer o rótulo: o rótulo automático acompanha, preservando o texto livre
      if (isConn && "ddd" in patch && patch.ddd != null && patch.label === undefined && docMode(doc) === "domain") el.label = composeDddLabel(el.ddd as DddConnSpec, dddLabelVia(prevDdd, prevLabel));
      if ("ddd" in patch && patch.ddd == null) delete el.ddd;
      if ("logic" in patch && patch.logic == null) delete el.logic;
      if (isNode && "logic" in patch && el.logic) Object.assign(el, logicSize(el, factNames(doc))); // o cartão acompanha o texto
      if ("subdomain" in patch && patch.subdomain == null) delete el.subdomain;
      if ("parent" in patch) {
        if (el.parent && (!doc.groups.some((g) => g.id === el.parent) || el.parent === el.id || isContainerOf(doc, el.id, el.parent))) {
          el.parent = before;
          return { ok: false, error: "parent inválido" };
        }
        touched.add(el.parent);
        touched.add(before);
      }
      return { ok: true, id: op.id };
    }
    case "remove": {
      const has = allIds(doc).has(op.id);
      if (!has) return { ok: false, error: `elemento "${op.id}" não existe` };
      const gone = new Set([op.id]);
      // endpoints pertencem ao serviço: somem junto com ele
      doc.nodes.filter((n) => n.owner === op.id).forEach((n) => gone.add(n.id));
      const grp = doc.groups.find((g) => g.id === op.id);
      // remover grupo: filhos sobem para o pai do grupo (não apaga conteúdo)
      if (grp) {
        doc.nodes.forEach((n) => n.parent === op.id && (n.parent = grp.parent));
        doc.groups.forEach((g) => g.parent === op.id && (g.parent = grp.parent));
        touched.add(grp.parent as string);
      }
      doc.nodes = doc.nodes.filter((n) => !gone.has(n.id));
      doc.groups = doc.groups.filter((n) => !gone.has(n.id));
      doc.notes = doc.notes.filter((n) => !gone.has(n.id));
      doc.connections = doc.connections.filter((c) => !gone.has(c.id) && !gone.has(c.from) && !gone.has(c.to));
      return { ok: true, id: op.id };
    }
    case "add_asset": {
      const a = op.asset;
      const id = a.id ? slug(a.id) : uniqueId(doc, a.name);
      const asset: Asset = {
        id,
        name: a.name,
        category: a.category ?? "Personalizados",
        vendor: a.vendor,
        kind: a.kind ?? "service",
        icon: a.icon ?? `t:${a.name.slice(0, 3).toUpperCase()}`,
        color: a.color ?? "#706fd3",
        problem: a.problem ?? "",
        description: a.description ?? "",
        tags: a.tags ?? [],
      };
      doc.customAssets = [...doc.customAssets.filter((x) => x.id !== id), asset];
      return { ok: true, id };
    }
    case "layout":
      if (op.style === "pipeline" || (docMode(doc) === "logic" && op.style === undefined)) {
        if (docMode(doc) !== "logic") return { ok: false, error: `o layout "pipeline" (fila de regras) só existe em diagramas de modo "logic"` };
        if (!hasFlow(doc)) {
          // sem setas: o layout liga início → regras (na ordem) → fim, para o fluxo ficar explícito
          const seq = pipelineSequence(doc);
          for (let i = 0; i + 1 < seq.length; i++) applyOne(doc, { op: "add_connection", from: seq[i].id, to: seq[i + 1].id }, touched);
        }
        const plan = logicLayout(doc);
        for (const n of doc.nodes) {
          const p = plan.pos.get(n.id);
          if (p) Object.assign(n, p, plan.size.get(n.id) ?? {});
        }
        // dados e cenários ficam agrupados (um grupo por tipo), em vez de soltos
        for (const g of plan.groups) {
          if (!doc.groups.some((x) => x.id === g.id)) doc.groups.push({ id: g.id, label: g.label, kind: "layer", tag: g.tag, x: 0, y: 0, w: 200, h: 120, auto: true });
          for (const m of g.members) doc.nodes.find((n) => n.id === m)!.parent = g.id;
        }
        for (const g of doc.groups) if (g.auto && plan.groups.some((x) => x.id === g.id)) fitGroup(doc, g.id);
        for (const c of doc.connections) {
          delete c.labelT;
          delete c.labelOffset;
          const wp = plan.waypoints.get(c.id);
          if (wp) {
            c.waypoints = wp;
            c.routing = "elbow";
          } else if (plan.pos.has(c.from) && plan.pos.has(c.to)) {
            delete c.waypoints;
            c.routing = op.routing ?? (doc.nodes.find((n) => n.id === c.from)?.logic?.role === "switch" ? "elbow" : "straight"); // o leque da escolha sai em ângulos retos
          }
        }
        placeLabels(doc);
        return { ok: true };
      }
      if (op.style === "timeline") {
        if (docMode(doc) !== "domain") return { ok: false, error: `o layout "timeline" (Event Storming) só existe em diagramas de modo "domain"` };
        timelineLayout(doc, op.routing);
        return { ok: true };
      }
      autoLayout(doc, op.direction ?? "LR", { spacing: op.spacing, minGap: op.minGap, gapX: op.gapX, gapY: op.gapY, routing: op.routing });
      return { ok: true };
    case "set_meta":
      if (op.title != null) doc.title = op.title;
      if (op.description != null) doc.description = op.description;
      if (op.mode != null) {
        if (op.mode !== "architecture" && op.mode !== "domain" && op.mode !== "logic") return { ok: false, error: `mode inválido "${op.mode}". Válidos: architecture, domain, logic` };
        if (op.mode === "domain" || op.mode === "logic") doc.mode = op.mode;
        else delete doc.mode;
      }
      return { ok: true };
    case "clear": {
      const fresh = emptyDoc(doc.title);
      doc.groups = fresh.groups;
      doc.nodes = fresh.nodes;
      doc.notes = fresh.notes;
      doc.connections = fresh.connections;
      return { ok: true };
    }
  }
}

/* ───────────────────────── casos de uso (modo domain) ───────────────────────── */

export interface UseCaseInput {
  /** slug estável; se já existir um use-case com esse id, o item é ignorado (idempotente no round-trip) */
  id?: string;
  /** quem executa; um nó `actor` é criado (ou reaproveitado pelo nome) e ligado ao caso de uso */
  actor: string;
  /** objetivo de negócio, em uma frase */
  goal: string;
  label?: string;
  /** id do grupo (bounded context) que contém o caso de uso */
  context?: string;
  steps?: string[];
}

/** Converte casos de uso em ops: nó `use-case`, ator reaproveitado por nome e conexão ator → caso de uso. */
export function useCaseOps(doc: Doc, list: UseCaseInput[]): Op[] {
  const out: Op[] = [];
  const taken = allIds(doc);
  const fresh = (want: string) => {
    const base = slug(want);
    let id = base;
    for (let i = 2; taken.has(id); i++) id = `${base}-${i}`;
    taken.add(id);
    return id;
  };
  const actors = new Map<string, string>();
  for (const n of doc.nodes) if (n.kind === "actor") actors.set(n.label.trim().toLowerCase(), n.id);
  for (const uc of list) {
    if (uc.id && doc.nodes.some((n) => n.id === slug(uc.id!) && n.ddd?.role === "use-case")) continue;
    const key = uc.actor.trim().toLowerCase();
    let actorId = actors.get(key);
    if (!actorId) {
      actorId = fresh(uc.actor);
      actors.set(key, actorId);
      out.push({ op: "add_node", id: actorId, label: uc.actor.trim(), kind: "actor", ...(uc.context ? { parent: uc.context } : {}) });
    }
    const id = fresh(uc.id ?? uc.label ?? uc.goal);
    out.push({
      op: "add_node",
      id,
      label: uc.label ?? uc.goal,
      ddd: { role: "use-case", actor: uc.actor.trim(), goal: uc.goal },
      ...(uc.context ? { parent: uc.context } : {}),
      ...(uc.steps?.length ? { description: uc.steps.map((s, i) => `${i + 1}. ${s}`).join("\n") } : {}),
    });
    out.push({ op: "add_connection", from: actorId, to: id, type: "association", label: "executa" });
  }
  return out;
}

/* ───────────────────────── layout linha do tempo (Event Storming) ───────────────────────── */

/** Reposiciona um diagrama de domínio em raias (ator → caso de uso → command → aggregate → evento → …); ver storm.ts. */
export function timelineLayout(doc: Doc, routing?: Routing) {
  const r = stormLayout(doc);
  for (const n of doc.nodes) {
    const pos = r.nodes.get(n.id);
    if (pos) Object.assign(n, pos);
  }
  for (const g of doc.groups) {
    const rect = r.contexts.get(g.id);
    if (rect) Object.assign(g, rect);
  }
  for (const g of doc.groups) if (g.kind !== "context" && g.auto) fitGroup(doc, g.id);
  if (routing) for (const c of doc.connections) c.routing = routing;
  for (const c of doc.connections) {
    delete c.labelT;
    delete c.labelOffset;
  }
  placeLabels(doc);
}

/* ───────────────────────── auto-layout em camadas ───────────────────────── */

export type Spacing = "compact" | "comfortable" | "spacious";
/** Distância mínima (px) entre componentes vizinhos da mesma camada; entre camadas é o dobro. */
export const SPACING_GAP: Record<Spacing, number> = { compact: 44, comfortable: 80, spacious: 120 };

export function autoLayout(doc: Doc, dir: "LR" | "TB" = "LR", opts: { spacing?: Spacing; minGap?: number; gapX?: number; gapY?: number; routing?: Routing } = {}) {
  // o traçado dos conectores (curva, ortogonal = "elbow" ou reta) vale para todas as conexões e precede o desvio de colisões
  if (opts.routing) for (const c of doc.connections) c.routing = opts.routing;
  for (const c of doc.connections) {
    delete c.labelT;
    delete c.labelOffset;
  }
  // gapX/gapY (px, eixos da tela) têm precedência; sem eles vale o preset: vizinhos na camada = gap, entre camadas = 2×gap
  const base = Math.max(16, opts.minGap ?? SPACING_GAP[opts.spacing ?? "comfortable"]);
  const gapX = Math.max(16, opts.gapX ?? (dir === "LR" ? base * 2 : base));
  const gapY = Math.max(16, opts.gapY ?? (dir === "LR" ? base : base * 2));
  const GAP_ITEM = dir === "LR" ? gapY : gapX;
  const GAP_RANK = dir === "LR" ? gapX : gapY;
  const parentOf = (id: string) => doc.nodes.find((n) => n.id === id)?.parent ?? doc.groups.find((g) => g.id === id)?.parent;
  const rel = new Map<string, { x: number; y: number }>();
  const size = new Map<string, { w: number; h: number }>();

  const members = (pid?: string) => [
    ...doc.groups.filter((g) => g.parent === pid).map((g) => g.id),
    ...doc.nodes.filter((n) => n.parent === pid && !n.owner).map((n) => n.id), // endpoints seguem o serviço dono
  ];
  const ancestorAt = (id: string, level: Set<string>): string | undefined => {
    let cur: string | undefined = doc.nodes.find((n) => n.id === id)?.owner ?? id; // endpoint → serviço dono
    const guard = new Set<string>();
    while (cur && !guard.has(cur)) {
      if (level.has(cur)) return cur;
      guard.add(cur);
      cur = parentOf(cur);
    }
    return undefined;
  };

  function measure(pid?: string): { w: number; h: number } {
    const ids = members(pid);
    for (const id of ids) {
      const g = doc.groups.find((x) => x.id === id);
      if (g) {
        const s = measure(g.id);
        size.set(id, { w: Math.max(240, s.w + PAD * 2), h: Math.max(140, s.h + PAD + TOP) });
      } else {
        const n = doc.nodes.find((x) => x.id === id)!;
        size.set(id, { w: n.w, h: n.h + stackHeight(doc, id) });
      }
    }
    if (!ids.length) return { w: 0, h: 0 };
    const level = new Set(ids);
    const edges: Array<[string, string]> = [];
    for (const c of doc.connections) {
      const a = ancestorAt(c.from, level);
      const b = ancestorAt(c.to, level);
      if (a && b && a !== b) edges.push([a, b]);
    }
    // componentes sem nenhuma conexão neste nível vão para uma grade própria (3 ou mais), em vez de uma coluna interminável
    const touched = new Set(edges.flat());
    const loose = ids.filter((i) => !touched.has(i));
    const packLoose = loose.length >= 3;
    const flow = packLoose ? ids.filter((i) => touched.has(i)) : ids;

    const horizontal = dir === "LR";
    const main = (id: string) => (horizontal ? size.get(id)!.w : size.get(id)!.h);
    const cross = (id: string) => (horizontal ? size.get(id)!.h : size.get(id)!.w);
    const lay = layeredLayout(flow, edges, cross, GAP_ITEM);
    const cols = lay.layers;
    // o vão entre camadas vizinhas precisa comportar o maior rótulo das conexões que o atravessam
    const need = new Map<number, number>();
    for (const c of doc.connections) {
      const sz = labelSize(c);
      const a = ancestorAt(c.from, level);
      const b = ancestorAt(c.to, level);
      if (!sz || !a || !b || a === b || !lay.rank.has(a) || !lay.rank.has(b)) continue;
      if (Math.abs(lay.rank.get(a)! - lay.rank.get(b)!) !== 1) continue;
      const lo = Math.min(lay.rank.get(a)!, lay.rank.get(b)!);
      need.set(lo, Math.max(need.get(lo) ?? 0, (horizontal ? sz.w : sz.h) + 56));
    }
    let m = 0;
    cols.forEach((col, r) => {
      const colMain = col.length ? Math.max(...col.map(main)) : 0;
      for (const id of col) {
        const c = lay.cross.get(id)!;
        rel.set(id, horizontal ? { x: m + (colMain - main(id)) / 2, y: c } : { x: c, y: m + (colMain - main(id)) / 2 });
      }
      m += colMain + (r < cols.length - 1 ? Math.max(GAP_RANK, need.get(r) ?? 0) : 0);
    });
    let outMain = flow.length ? m : 0;
    let outCross = flow.length ? lay.extent : 0;
    if (packLoose) {
      const items = loose.map((id) => ({ id, w: main(id), h: cross(id) }));
      const area = items.reduce((s, i) => s + (i.w + GAP_RANK) * (i.h + GAP_ITEM), 0);
      const pack = shelfPack(items, Math.max(outMain, Math.sqrt(area) * 1.6), GAP_ITEM);
      const top = outCross ? outCross + Math.max(GAP_ITEM, GAP_RANK) : 0;
      for (const [id, p] of pack.at) rel.set(id, horizontal ? { x: p.x, y: top + p.y } : { x: top + p.y, y: p.x });
      outMain = Math.max(outMain, pack.w);
      outCross = top + pack.h;
    }
    return horizontal ? { w: outMain, h: outCross } : { w: outCross, h: outMain };
  }

  function assign(pid: string | undefined, ox: number, oy: number) {
    for (const id of members(pid)) {
      const r = rel.get(id)!;
      const s = size.get(id)!;
      const x = Math.round(ox + r.x);
      const y = Math.round(oy + r.y);
      const g = doc.groups.find((q) => q.id === id);
      if (g) {
        Object.assign(g, { x, y, w: s.w, h: s.h, auto: true });
        assign(id, x + PAD, y + TOP);
      } else {
        const n = doc.nodes.find((q) => q.id === id)!;
        n.x = x;
        n.y = y;
        restack(doc, n);
      }
    }
  }

  measure(undefined);
  assign(undefined, 0, 0);
  avoidCollisions(doc);
  placeLabels(doc);
}

type Pt = { x: number; y: number };

/**
 * Garante que nenhuma conexão atravesse componentes ou notas que não sejam suas pontas.
 * Pontos de passagem manuais ficam obsoletos após reorganizar, então são recalculados: a rota
 * padrão é mantida quando já está livre; senão procura o menor desvio com 1 ou 2 waypoints.
 */
export function avoidCollisions(doc: Doc, margin = 14) {
  for (const c of doc.connections) delete c.waypoints;
  const isInside = (id: string, ancestor: string) => {
    let cur: string | undefined = id;
    for (let i = 0; cur && i < 30; i++) {
      if (cur === ancestor) return true;
      cur = doc.nodes.find((n) => n.id === cur)?.parent ?? doc.groups.find((g) => g.id === cur)?.parent;
    }
    return false;
  };
  const grow = (r: Rect, m: number): Rect => ({ x: r.x - m, y: r.y - m, w: r.w + m * 2, h: r.h + m * 2 });
  const lengthOf = (pts: Pt[]) => pts.reduce((s, p, i) => (i ? s + Math.hypot(p.x - pts[i - 1].x, p.y - pts[i - 1].y) : 0), 0);

  for (const c of doc.connections) {
    const a = boxOf(doc, c.from);
    const b = boxOf(doc, c.to);
    if (!a || !b) continue;
    const obstacles: Rect[] = [...doc.nodes.filter((n) => n.id !== c.from && n.id !== c.to && !isInside(n.id, c.from) && !isInside(n.id, c.to)), ...doc.notes].map((o) => grow(o, margin));
    if (!obstacles.length) continue;
    const probe = (wps?: Pt[]) => {
      c.waypoints = wps;
      const g = edgeGeoms(doc).find((e) => e.c.id === c.id)!.g; // inclui as lanes de pares repetidos
      c.waypoints = undefined;
      const pts = samplePath(g.d);
      return { hits: obstacles.filter((o) => pts.some((p, i) => i > 0 && segmentHitsRect(pts[i - 1], p, o))), len: lengthOf(pts) };
    };
    const base = probe();
    if (!base.hits.length) continue;

    const ca = { x: a.x + a.w / 2, y: a.y + a.h / 2 };
    const cb = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
    const detour = (p: Pt) => Math.hypot(p.x - ca.x, p.y - ca.y) + Math.hypot(p.x - cb.x, p.y - cb.y);
    const free = (p: Pt) => !obstacles.some((o) => p.x > o.x && p.x < o.x + o.w && p.y > o.y && p.y < o.y + o.h);
    const near = (os: Rect[], limit: number) =>
      os
        .flatMap((o) => {
          const m = 28;
          return [
            { x: o.x - m, y: o.y - m },
            { x: o.x + o.w + m, y: o.y - m },
            { x: o.x - m, y: o.y + o.h + m },
            { x: o.x + o.w + m, y: o.y + o.h + m },
          ];
        })
        .filter(free)
        .sort((p, q) => detour(p) - detour(q))
        .slice(0, limit);

    let best: { wps: Pt[]; len: number } | undefined;
    const consider = (wps: Pt[]) => {
      const r = probe(wps);
      if (!r.hits.length && (!best || r.len < best.len)) best = { wps, len: r.len };
    };
    // 1 waypoint nos cantos dos obstáculos que bloqueiam → 2 waypoints → amplia a busca a todos os obstáculos
    for (const pool of [near(base.hits, 12), near(obstacles, 24)]) {
      for (const p of pool) consider([p]);
      if (best) break;
      for (const p of pool) for (const q of pool) if (p !== q) consider([p, q]);
      if (best) break;
    }
    if (best) c.waypoints = (best as { wps: Pt[] }).wps.map((p) => ({ x: Math.round(p.x), y: Math.round(p.y) }));
  }
}

/**
 * Escolhe, para cada conexão, a posição do rótulo ao longo do traçado que não cubra componentes,
 * notas, títulos de grupo nem outros rótulos (o mais próximo do meio; sem opção livre, o de menor sobreposição).
 */
export function placeLabels(doc: Doc) {
  const overlap = (a: Rect, b: Rect) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  const fixed: Rect[] = [...doc.nodes, ...doc.notes, ...doc.groups.map((g) => ({ x: g.x, y: g.y, w: Math.min(g.w, 320), h: TOP - 8 }))];
  const placed: Rect[] = [];
  const items = edgeGeoms(doc)
    .map(({ c, g }) => ({ c, pts: samplePath(g.d, 24), sz: labelSize(c) }))
    .filter((i): i is typeof i & { sz: NonNullable<typeof i.sz> } => !!i.sz)
    .sort((a, b) => b.sz.w - a.sz.w); // rótulos largos primeiro: são os mais difíceis de encaixar
  // candidatos do meio para as pontas, em passos de 4%
  const ts = Array.from({ length: 21 }, (_, i) => (i === 0 ? 0 : Math.ceil(i / 2) * (i % 2 ? -1 : 1)) * 0.04 + 0.5).filter((t) => t > 0.06 && t < 0.94);
  for (const { c, pts, sz } of items) {
    let best = { t: 0.5, off: 0, cost: Infinity, rect: { x: 0, y: 0, w: 0, h: 0 } as Rect };
    // sobre o traçado primeiro; sem vaga, ao lado dele (deslocamento perpendicular)
    const side = sz.h / 2 + 12;
    search: for (const off of [0, side, -side, side * 2, -side * 2]) {
      for (const t of ts) {
        const p = labelPoint(pts, t, off);
        const rect = { x: p.x - sz.w / 2 - 4, y: p.y - sz.h / 2 - 4, w: sz.w + 8, h: sz.h + 8 };
        const cost = fixed.reduce((s, o) => s + overlap(rect, o) * 4, 0) + placed.reduce((s, o) => s + overlap(rect, o) * 4, 0) + Math.abs(t - 0.5) + Math.abs(off) * 0.05;
        if (cost < best.cost) best = { t, off, cost, rect };
        if (cost < 1) break search;
      }
    }
    c.labelT = best.t;
    if (best.off) c.labelOffset = Math.round(best.off);
    placed.push(best.rect);
  }
}

/* ───────────────────────── validação e descrição para LLMs ───────────────────────── */

/** Avisos estruturados (regra, severidade, alvo). Em modo `architecture` são exatamente as checagens de sempre. */
export function validateDetailed(doc: Doc, opts: { exists?: (path: string) => boolean } = {}): Issue[] {
  const issues: Issue[] = [];
  const base = (message: string, target?: string) => issues.push({ rule: "BASE", severity: "aviso", message, target });
  const domain = docMode(doc) === "domain";
  const logicMode = docMode(doc) === "logic";
  const endpoints = new Set([...doc.nodes.map((n) => n.id), ...doc.groups.map((g) => g.id)]);
  const groups = new Set(doc.groups.map((g) => g.id));
  for (const c of doc.connections) {
    if (!endpoints.has(c.from)) base(`connection ${c.id}: "from" ${c.from} não existe`, c.id);
    if (!endpoints.has(c.to)) base(`connection ${c.id}: "to" ${c.to} não existe`, c.id);
  }
  for (const e of [...doc.nodes, ...doc.groups]) if (e.parent && !groups.has(e.parent)) base(`${e.id}: parent ${e.parent} não existe`, e.id);
  const connected = new Set(doc.connections.flatMap((c) => [c.from, c.to]));
  const ids = new Set(doc.nodes.map((n) => n.id));
  for (const n of doc.nodes) {
    if (n.owner && !ids.has(n.owner)) base(`${n.id}: owner ${n.owner} não existe`, n.id);
    if (n.kind === "endpoint" && !n.endpoint) base(`${n.id}: endpoint sem definição (protocol/method/path)`, n.id);
    if (n.kind === "system" && !n.ref) base(`${n.id}: componente "system" sem ref (aponte para outro diagrama)`, n.id);
    if (n.owner || n.kind === "endpoint") continue; // endpoints são expostos pelo serviço dono
    if (!domain && !logicMode && !connected.has(n.id)) base(`${n.id}: componente sem nenhuma conexão (isolado)`, n.id);
  }
  if (domain) issues.push(...domainIssues(doc, opts));
  if (logicMode) issues.push(...logicIssues(doc));
  return issues;
}

export function validate(doc: Doc, opts: { exists?: (path: string) => boolean } = {}): string[] {
  return validateDetailed(doc, opts).map((i) => (i.rule === "BASE" ? i.message : issueText(i)));
}

const q = (s: string) => s.replace(/"/g, "'");

export function toMermaid(doc: Doc): string {
  const mid = (id: string) => "n_" + id.replace(/[^a-zA-Z0-9]/g, "_");
  const lines = ["flowchart LR"];
  const emit = (pid: string | undefined, indent: string) => {
    for (const g of doc.groups.filter((x) => x.parent === pid)) {
      lines.push(`${indent}subgraph ${mid(g.id)}["${q(g.label)}"]`);
      emit(g.id, indent + "  ");
      lines.push(`${indent}end`);
    }
    for (const n of doc.nodes.filter((x) => x.parent === pid)) {
      const t = n.technology ? `<br/><i>${q(n.technology)}</i>` : "";
      const shape = n.kind === "domain" ? (n.ddd?.role === "domain-event" ? [">", "]"] : n.ddd?.role === "command" ? ["([", "])"] : n.ddd?.role === "aggregate-root" ? ["[[", "]]"] : ["[", "]"]) : n.kind === "database" || n.kind === "cache" ? ["[(", ")]"] : n.kind === "queue" || n.kind === "system" ? ["[[", "]]"] : n.kind === "actor" || n.kind === "endpoint" ? ["([", "])"] : ["[", "]"];
      const name = n.kind === "system" && n.ref ? `↗ ${n.label}` : n.label;
      lines.push(`${indent}${mid(n.id)}${shape[0]}"${q(name)}${t}"${shape[1]}`);
    }
  };
  emit(undefined, "  ");
  for (const n of doc.nodes) if (n.owner) lines.push(`  ${mid(n.owner)} -.- ${mid(n.id)}`);
  for (const c of doc.connections) {
    const txt = q([c.label, c.protocol].filter(Boolean).join(" · ") || CONNECTION_TYPES[c.type].label);
    const arrow = c.type === "async" || c.type === "dependency" || c.type === "realization" ? "-.->" : c.type === "stream" ? "==>" : c.type === "association" ? "---" : "-->";
    lines.push(`  ${mid(c.from)} ${arrow}|"${txt}"| ${mid(c.to)}`);
  }
  return lines.join("\n");
}

/** Descrição textual determinística do diagrama — o formato que um LLM deve ler. */
export function describe(doc: Doc, opts: { exists?: (path: string) => boolean } = {}): string {
  if (docMode(doc) === "logic") return describeLogic(doc, validateDetailed(doc, opts)) + "\n\n## Mermaid\n```mermaid\n" + toMermaid(doc) + "\n```";
  if (docMode(doc) === "domain") return describeDomain(doc, validateDetailed(doc, opts)) + "\n\n## Mermaid\n```mermaid\n" + toMermaid(doc) + "\n```";
  const L: string[] = [];
  L.push(`# ${doc.title}`);
  if (doc.description) L.push("", doc.description);
  L.push("", `> schema ${SCHEMA_VERSION} · ${doc.nodes.length} componentes · ${doc.groups.length} grupos · ${doc.connections.length} conexões`);

  const label = (id: string) => doc.nodes.find((n) => n.id === id)?.label ?? doc.groups.find((g) => g.id === id)?.label ?? id;

  if (doc.groups.length) {
    L.push("", "## Grupos");
    for (const g of doc.groups) {
      L.push(`- \`${g.id}\` **${g.label}** (${g.kind}: ${GROUP_KINDS[g.kind]})${g.parent ? ` dentro de \`${g.parent}\`` : ""}${g.description ? ` — ${g.description}` : ""}`);
    }
  }
  L.push("", "## Componentes");
  const epLine = (n: NodeEl, indent: string) => {
    const e = n.endpoint;
    if (!e) return;
    const bits = [`${indent}- endpoint \`${endpointLabel(e)}\` (${e.protocol}) id: \`${n.id}\``];
    if (n.description) bits.push(n.description);
    if (e.request) bits.push(`entrada: ${e.request}`);
    if (e.response) bits.push(`saída: ${e.response}`);
    if (e.auth) bits.push(`auth: ${e.auth}`);
    L.push(bits.join(" · "));
  };
  for (const n of doc.nodes) {
    if (n.owner && doc.nodes.some((o) => o.id === n.owner)) continue; // listado sob o dono
    const a = findAsset(doc, n.asset);
    const bits = [`\`${n.id}\` **${n.label}**`, `[${n.kind}]`];
    if (n.technology) bits.push(`tecnologia: ${n.technology}`);
    if (n.parent) bits.push(`em \`${n.parent}\``);
    if (n.ref) bits.push(`REFERENCIA o diagrama \`${n.ref.diagram}\`${n.ref.node ? ` (componente \`${n.ref.node}\`)` : ""}`);
    L.push(`- ${bits.join(" · ")}${n.description ? ` — ${n.description}` : ""}`);
    if (n.kind === "endpoint") epLine(n, "  ");
    if (a?.problem && n.kind !== "endpoint") L.push(`  - papel da tecnologia: ${a.problem}`);
    if (n.props) for (const [k, v] of Object.entries(n.props)) L.push(`  - ${k}: ${v}`);
    doc.nodes.filter((e) => e.owner === n.id).forEach((e) => epLine(e, "  "));
  }
  if (doc.notes.length) {
    L.push("", "## Notas");
    doc.notes.forEach((n) => L.push(`- ${n.text.replace(/\n/g, " ")}`));
  }
  L.push("", "## Conexões");
  for (const c of doc.connections) {
    const t = CONNECTION_TYPES[c.type];
    L.push(`- \`${c.from}\` (${label(c.from)}) **—${c.type}→** \`${c.to}\` (${label(c.to)})${c.label ? ` : "${c.label}"` : ""}${c.protocol ? ` · protocolo ${c.protocol}` : ""}`);
    L.push(`  - semântica: ${t.semantics}`);
    if (c.description) L.push(`  - ${c.description}`);
    if (c.interface) {
      L.push(`  - interface \`${c.interface.name}\` (${c.interface.kind})${c.interface.contract ? ` contrato: ${c.interface.contract}` : ""}`);
      for (const o of c.interface.operations) {
        const sig = [o.method, o.path].filter(Boolean).join(" ");
        L.push(`    - ${o.name}${sig ? ` — \`${sig}\`` : ""}${o.request ? ` · req: ${o.request}` : ""}${o.response ? ` · res: ${o.response}` : ""}${o.description ? ` · ${o.description}` : ""}`);
      }
    }
  }
  const issues = validate(doc);
  if (issues.length) L.push("", "## Avisos", ...issues.map((i) => `- ${i}`));
  L.push("", "## Mermaid", "```mermaid", toMermaid(doc), "```");
  return L.join("\n");
}

export function schemaGuide(mode: DocMode = "architecture"): string {
  if (mode === "domain") return schemaGuideDomain();
  if (mode === "logic") return schemaGuideLogic();
  return [
    `# Archflow ${SCHEMA_VERSION} — guia para LLMs`,
    "",
    "Você edita diagramas de arquitetura de software. Pense em **componentes, grupos e conexões**, nunca em pixels:",
    "o app calcula posições (use a operação `layout`).",
    "",
    "## Tipos de componente (`kind`)",
    ...Object.entries(NODE_KINDS).filter(([k]) => k !== "domain" && k !== "logic").map(([k, v]) => `- \`${k}\`: ${v}`),
    "",
    "## Tipos de grupo (`kind`)",
    ...Object.entries(GROUP_KINDS).map(([k, v]) => `- \`${k}\`: ${v}`),
    "",
    "## Tipos de conexão (`type`)",
    ...Object.entries(CONNECTION_TYPES).map(([k, v]) => `- \`${k}\` (${v.label}): ${v.semantics}`),
    "",
    "## Endpoints (componentes de comunicação)",
    "Um serviço EXPÕE endpoints. Use `add_endpoints` com `owner` = id do serviço (o endpoint fica preso a ele):",
    ...Object.entries(ENDPOINT_PROTOCOLS).map(([k, v]) => `- \`${k}\`: ${v.semantics}${v.methods.length ? ` method: ${v.methods.join("|")}` : ""}`),
    "`connect` aceita o id de um endpoint em from/to — conecte clientes ao endpoint específico.",
    "",
    "## Referências entre diagramas",
    'Um componente `kind: "system"` com `ref: { diagram, node? }` aponta para OUTRO diagrama do cofre (e opcionalmente para um componente dele).',
    "Use `list_diagrams` e `get_diagram_outline` para descobrir caminhos e ids antes de referenciar.",
    "",
    "## Fluxo recomendado",
    "1. `list_assets` (catálogo completo agrupado por categoria) e/ou `search_assets` para achar o `asset` certo (ex.: `laravel`, `postgresql`, `aws-sqs`). SEMPRE prefira um asset do catálogo a criar o componente do zero; só use `add_asset` se nada servir.",
    "2. `add_groups` (fronteiras/camadas) e `add_components` (use `parent` = id do grupo).",
    "3. `connect` com `type`, `label`, `protocol` e, quando relevante, `interface` (operações, payloads).",
    "4. `auto_layout`, depois `get_diagram` (markdown) para revisar os avisos.",
    "",
    "Ids são slugs estáveis (`orders-api`). Reutilize-os em `parent`, `from` e `to`.",
  ].join("\n");
}

export function normalizeDoc(raw: any): Doc {
  const d = emptyDoc(raw?.title ?? "Importado");
  const { mode: _mode, ...rest } = raw ?? {};
  const out = {
    ...d,
    ...rest,
    ...(raw?.mode === "domain" || raw?.mode === "logic" ? { mode: raw.mode as "domain" | "logic" } : {}),
    schema: SCHEMA_VERSION,
    groups: Array.isArray(raw?.groups) ? raw.groups : [],
    nodes: Array.isArray(raw?.nodes) ? raw.nodes : [],
    notes: Array.isArray(raw?.notes) ? raw.notes : [],
    connections: Array.isArray(raw?.connections) ? raw.connections : [],
    ink: Array.isArray(raw?.ink) ? raw.ink : [],
    customAssets: Array.isArray(raw?.customAssets) ? raw.customAssets : [],
  };
  // modo Logic: o tamanho dos elementos vem do conteúdo; arquivos gravados por versões anteriores são ajustados ao abrir
  if (out.mode === "logic" && out.nodes.some((n: NodeEl) => n.logic)) {
    const names = factNames(out);
    for (const n of out.nodes as NodeEl[]) {
      const s = n.logic ? logicSize(n, names) : undefined;
      if (s) Object.assign(n, s);
    }
  }
  return out;
}
