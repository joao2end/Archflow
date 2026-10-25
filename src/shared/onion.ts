/**
 * Layout "camadas" (Clean Architecture) para diagramas de modo `domain`: círculos concêntricos, como a figura clássica.
 *
 * De dentro para fora:
 *  - Entities (regras corporativas): aggregates, entities, value objects, domain services e eventos internos, no miolo;
 *  - Use Cases (regras da aplicação): casos de uso, commands, application services, policies e sagas, num anel inteiro;
 *  - Interface Adapters, em setores: Gateways (repositories) à esquerda, Presenters (read models) à direita;
 *  - Frameworks & Drivers, em setores: atores em cima, sistemas (referências) à esquerda, eventos de outros contextos à
 *    direita, sistemas externos embaixo.
 *
 * A estrutura existe sempre, mesmo vazia: um diagrama de domínio novo já nasce com os quatro anéis (e os setores), e o
 * usuário clica numa área para adicionar ali os componentes daquela camada (`ONION_PICKS`). Cada bounded context ganha o
 * seu círculo (Entities, Use Cases e Interface Adapters; Drivers só se tiver atores ou sistemas dentro); o que está fora dos
 * contextos forma o anel de Frameworks & Drivers em volta de todos eles.
 *
 * Os grupos ficam com a caixa do círculo (quadrado) e `ring` diz o que desenhar dentro dela: raio interno e, nos setores,
 * os ângulos (graus, 0 = topo, sentido horário). Determinístico e sem efeitos: quem aplica (ops.ts) cria os grupos.
 */
import { DDD_BADGES, DDD_ROLES, type DddNodeSpec, type Doc, type GroupEl, type GroupRing, type NodeEl, type NodeKind } from "./schema";

export const ONION_PREFIX = "anel-";
const PAD = 28;
const TOP = 54;
/** folga entre componentes vizinhos no anel */
const GAP = 18;
/** folga entre o componente e a borda interna do anel */
const INSET = 14;
/** faixa externa do anel reservada ao nome (escrito ao longo do arco) */
const LABEL = 34;
/** vão entre um anel e o de dentro */
const RING_GAP = 12;
/** vão (graus) entre setores vizinhos */
const SECTOR_GAP = 3;
const BLOCK_GAP = 90;
/** raio do miolo vazio e espessura mínima de um anel (cabe um componente com folga) */
const MIN_CORE = 150;
const MIN_BAND = 150;
/** diâmetro do componente de domínio dentro dos anéis (um círculo que orbita o centro) */
export const ORBIT_D = 140;
const MAX_WIDTH = 2400;

type Ring = NonNullable<GroupRing["layer"]>;
type Side = NonNullable<GroupRing["side"]>;

export const ONION_RINGS: Record<Ring, { label: string; tag: string; color: string }> = {
  entities: { label: "Entities", tag: "Regras de negócio corporativas", color: "#e3c84a" },
  usecases: { label: "Use Cases", tag: "Regras de negócio da aplicação", color: "#ec6f78" },
  adapters: { label: "Interface Adapters", tag: "Adaptadores de interface", color: "#3fbf7f" },
  drivers: { label: "Frameworks & Drivers", tag: "Frameworks e drivers", color: "#4aa8e8" },
};

/** Nome dos setores dos anéis externos (como Gateways / Presenters na figura clássica). */
const SEGMENTS: Partial<Record<Ring, Partial<Record<Side, string>>>> = {
  adapters: { top: "Controllers", left: "Gateways", right: "Presenters" },
  drivers: { top: "Atores", left: "Sistemas", right: "Eventos externos", bottom: "Interfaces externas" },
};
/** ângulo em que cada lado fica centrado */
const SIDE_ANGLE: Record<Side, number> = { top: 0, right: 90, bottom: 180, left: 270 };

/** Aparência de um componente nos anéis (2D e 3D): nome do papel, cor e selo. Atores e sistemas também orbitam. */
export function orbitLook(n: NodeEl): { role: string; hint: string; color: string; badge: string } {
  if (n.ddd) return { role: DDD_ROLES[n.ddd.role].label, hint: DDD_ROLES[n.ddd.role].hint, color: DDD_ROLES[n.ddd.role].color, badge: DDD_BADGES[n.ddd.role] };
  if (n.kind === "actor") return { role: "Ator", hint: "Pessoa ou papel que usa o sistema", color: "#8e6fd1", badge: "ATOR" };
  if (n.kind === "system") return { role: "Sistema", hint: "Outro diagrama (bounded context ou sistema)", color: "#5b6ee1", badge: "SIS" };
  return { role: "Sistema externo", hint: "Sistema de terceiros", color: "#6c7a89", badge: "EXT" };
}
/** Fica no anel como círculo (tudo, menos endpoints presos a um serviço). */
export const orbits = (n: NodeEl) => !n.owner && n.kind !== "endpoint";

/** O que se adiciona ao clicar numa área: o rótulo do menu e o componente criado. */
export interface OnionPick {
  label: string;
  node: { label: string; kind?: NodeKind; ddd?: DddNodeSpec };
}
const dd = (label: string, menu: string, ddd: DddNodeSpec): OnionPick => ({ label: menu, node: { label, ddd } });
export function onionPicks(layer: Ring | undefined, side?: Side): OnionPick[] {
  switch (layer) {
    case "entities":
      return [
        dd("Novo aggregate", "Aggregate Root", { role: "aggregate-root" }),
        dd("Nova entity", "Entity", { role: "entity" }),
        dd("Novo value object", "Value Object", { role: "value-object" }),
        dd("Novo domain service", "Domain Service", { role: "domain-service" }),
        dd("Novo evento", "Domain Event", { role: "domain-event" }),
      ];
    case "usecases":
      return [
        dd("Novo caso de uso", "Use Case", { role: "use-case" }),
        dd("Novo command", "Command", { role: "command" }),
        dd("Novo application service", "Application Service", { role: "application-service" }),
        dd("Nova policy", "Policy", { role: "policy" }),
        dd("Nova saga", "Process Manager (saga)", { role: "process-manager" }),
      ];
    case "adapters":
      if (side === "top") return [dd("Novo controller", "Controller", { role: "controller" })];
      return side === "right" ? [dd("Novo read model", "Read Model", { role: "read-model" })] : [dd("Novo repository", "Repository", { role: "repository" })];
    case "drivers":
      if (side === "left") return [{ label: "Sistema (outro diagrama)", node: { label: "Novo sistema", kind: "system" } }];
      if (side === "right") return [dd("Evento externo", "Evento de outro contexto", { role: "domain-event", external: "outro contexto" })];
      if (side === "bottom") return [{ label: "Sistema externo", node: { label: "Novo sistema externo", kind: "external" } }];
      return [{ label: "Ator", node: { label: "Novo ator", kind: "actor" } }];
  }
  return [];
}

/** Ordem de leitura dentro de um anel (aggregate antes de entity, caso de uso antes de command…). */
const ORDER = ["aggregate-root", "entity", "value-object", "domain-service", "domain-event", "use-case", "command", "application-service", "policy", "process-manager", "controller", "repository", "read-model"];
const rank = (n: NodeEl) => {
  const i = ORDER.indexOf(n.ddd?.role ?? "");
  return i < 0 ? ORDER.length : i;
};

/** Anel e lado de um componente. No modo domain só existem nós domain, actor, system e external. */
export function onionSlot(n: NodeEl): { ring: Ring; side: Side } {
  switch (n.ddd?.role) {
    case "aggregate-root":
    case "entity":
    case "value-object":
    case "domain-service":
      return { ring: "entities", side: "top" };
    case "domain-event":
      return n.ddd?.external ? { ring: "drivers", side: "right" } : { ring: "entities", side: "top" };
    case "use-case":
    case "command":
    case "application-service":
    case "policy":
    case "process-manager":
      return { ring: "usecases", side: "top" };
    case "repository":
      return { ring: "adapters", side: "left" };
    case "controller":
      return { ring: "adapters", side: "top" };
    case "read-model":
      return { ring: "adapters", side: "right" };
  }
  if (n.kind === "actor") return { ring: "drivers", side: "top" };
  if (n.kind === "system") return { ring: "drivers", side: "left" };
  return { ring: "drivers", side: "bottom" };
}

/* ───────── geometria ───────── */

const rad = (deg: number) => (deg * Math.PI) / 180;
/** ponto no ângulo `a` (graus, 0 = topo, horário) e raio `r`, a partir do centro */
export const polar = (cx: number, cy: number, r: number, a: number) => ({ x: cx + r * Math.sin(rad(a)), y: cy - r * Math.cos(rad(a)) });
/** ângulo (graus, 0..360) de um ponto em relação ao centro */
const angleOf = (dx: number, dy: number) => ((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360;
/** `a` está no setor [s, e] (graus, e > s, pode passar de 360)? */
const inSector = (a: number, s: number, e: number) => {
  const t = (((a - s) % 360) + 360) % 360;
  return t <= e - s;
};

/** O ponto `p` está dentro do desenho do grupo? Anéis e setores usam a forma; os outros grupos, o retângulo. */
export function insideGroupShape(g: { x: number; y: number; w: number; h: number; ring?: GroupRing }, p: { x: number; y: number }): boolean {
  if (p.x < g.x || p.y < g.y || p.x > g.x + g.w || p.y > g.y + g.h) return false;
  if (!g.ring) return true;
  const cx = g.x + g.w / 2;
  const cy = g.y + g.h / 2;
  const d = Math.hypot(p.x - cx, p.y - cy);
  if (d > Math.min(g.w, g.h) / 2 || d < g.ring.inner) return false;
  return g.ring.start === undefined || g.ring.end === undefined || inSector(angleOf(p.x - cx, p.y - cy), g.ring.start, g.ring.end);
}

interface Sector {
  start: number;
  end: number;
  full: boolean;
  items: NodeEl[];
  side?: Side;
}

/**
 * Posiciona os componentes de um anel de raio interno `ri` (centro na origem). Cada setor espalha os seus componentes em
 * ângulos iguais; o raio cresce até nenhum componente encostar em outro, sair do setor ou invadir o anel de dentro.
 * Setor cheio demais ganha uma segunda volta (trilha), alternando os componentes. Devolve o centro de cada componente e o raio externo.
 */
function placeRing(sectors: Sector[], ri: number): { at: Map<string, { x: number; y: number }>; ro: number; orbits: number[] } {
  type Slot = { n: NodeEl; a: number; track: number; sector: Sector };
  const slotsFor = (tracks: number): Slot[] =>
    sectors.flatMap((s) => {
      const k = s.items.length;
      if (!k) return [];
      const step = (s.end - s.start) / k;
      return s.items.map((n, i) => ({ n, a: s.start + (i + 0.5) * step, track: tracks > 1 && k >= 4 ? i % 2 : 0, sector: s }));
    });
  const rectAt = (sl: Slot, r: number) => {
    const c = polar(0, 0, r, sl.a);
    return { x: c.x - sl.n.w / 2, y: c.y - sl.n.h / 2, w: sl.n.w, h: sl.n.h };
  };
  if (!sectors.some((s) => s.items.length)) return { at: new Map(), ro: ri + MIN_BAND, orbits: [] };
  const solve = (tracks: number) => {
    const slots = slotsFor(tracks);
    const maxH = Math.max(...slots.map((s) => s.n.h));
    let r = ri + INSET + maxH / 2;
    let d = tracks > 1 ? maxH + GAP : 0;
    for (let it = 0; it < 400; it++) {
      const rects = slots.map((s) => rectAt(s, r + s.track * d));
      let bad: "r" | "d" | undefined;
      // não invade o anel de dentro e não sai do setor
      for (let i = 0; i < slots.length && !bad; i++) {
        const q = rects[i];
        const nx = Math.max(q.x, Math.min(0, q.x + q.w));
        const ny = Math.max(q.y, Math.min(0, q.y + q.h));
        if (Math.hypot(nx, ny) < ri + INSET) bad = "r";
        const s = slots[i].sector;
        if (!s.full)
          for (const [px, py] of [[q.x, q.y], [q.x + q.w, q.y], [q.x, q.y + q.h], [q.x + q.w, q.y + q.h]])
            if (!inSector(angleOf(px, py), s.start + 1, s.end - 1)) bad = "r";
      }
      // não encosta em outro componente do anel
      for (let i = 0; i < slots.length && !bad; i++)
        for (let j = i + 1; j < slots.length && !bad; j++) {
          const a = rects[i];
          const b = rects[j];
          if (a.x < b.x + b.w + GAP && b.x < a.x + a.w + GAP && a.y < b.y + b.h + GAP && b.y < a.y + a.h + GAP) bad = slots[i].track !== slots[j].track ? "d" : "r";
        }
      if (!bad) break;
      if (bad === "d") d += 8;
      else r += 8;
    }
    const at = new Map<string, { x: number; y: number }>();
    let far = ri + INSET;
    for (const s of slots) {
      const q = rectAt(s, r + s.track * d);
      at.set(s.n.id, { x: q.x, y: q.y });
      for (const [px, py] of [[q.x, q.y], [q.x + q.w, q.y], [q.x, q.y + q.h], [q.x + q.w, q.y + q.h]]) far = Math.max(far, Math.hypot(px, py));
    }
    const orbits = [...new Set(slots.map((s) => Math.round(r + s.track * d)))].sort((a, b) => a - b);
    return { at, ro: Math.max(ri + MIN_BAND, Math.ceil(far + LABEL)), orbits };
  };
  const one = solve(1);
  if (!sectors.some((s) => s.items.length >= 4)) return one;
  const two = solve(2);
  return two.ro < one.ro ? two : one;
}

/** Divide a volta entre os setores do anel (todos, mesmo vazios): cada um centrado no seu ângulo, com largura proporcional ao número de componentes. */
function sectorsOf(r: Ring, items: NodeEl[]): Sector[] {
  const sides = (Object.keys(SEGMENTS[r]!) as Side[]).sort((a, b) => SIDE_ANGLE[a] - SIDE_ANGLE[b]);
  const by = new Map<Side, NodeEl[]>(sides.map((s) => [s, []]));
  for (const n of items) by.get(onionSlot(n).side)?.push(n);
  if (sides.length === 1) return [{ start: 0, end: 360, full: true, items: by.get(sides[0])!, side: sides[0] }];
  const weight = sides.map((s) => by.get(s)!.length + 1);
  const total = weight.reduce((a, b) => a + b, 0);
  const spans = weight.map((w) => (360 * w) / total);
  let at = SIDE_ANGLE[sides[0]] - spans[0] / 2;
  return sides.map((s, i) => {
    const sec = { start: at + SECTOR_GAP / 2, end: at + spans[i] - SECTOR_GAP / 2, full: false, items: by.get(s)!, side: s };
    at += spans[i];
    return sec;
  });
}

/* ───────── montagem ───────── */

export interface OnionGroup {
  id: string;
  label: string;
  tag: string;
  color: string;
  parent?: string;
  ring: GroupRing;
  rect: { x: number; y: number; w: number; h: number };
}

export interface OnionResult {
  nodes: Map<string, { x: number; y: number }>;
  /** novo pai de cada componente (anel ou setor) */
  parentOf: Map<string, string>;
  groups: OnionGroup[];
  /** contextos: novo retângulo e, se houver anel geral, o novo pai */
  contexts: Map<string, { rect: { x: number; y: number; w: number; h: number }; parent?: string }>;
}

/** Algo com tamanho que sabe se posicionar; `parent` é o grupo que o contém. */
interface Piece {
  w: number;
  h: number;
  place(x: number, y: number, parent: string | undefined): void;
}
/** Um círculo (com o que há dentro dele): `ro` é o raio externo. */
interface Disc extends Piece {
  ro: number;
}

export function onionLayout(doc: Doc): OnionResult {
  const out: OnionResult = { nodes: new Map(), parentOf: new Map(), groups: [], contexts: new Map() };
  const groups = new Map(doc.groups.map((g) => [g.id, g]));
  const contextOf = (n: NodeEl): GroupEl | undefined => {
    let cur = n.parent;
    const seen = new Set<string>();
    while (cur && !seen.has(cur)) {
      seen.add(cur);
      const g = groups.get(cur);
      if (!g) return undefined;
      if (g.kind === "context") return g;
      cur = g.parent;
    }
    return undefined;
  };
  const setNode = (n: NodeEl, x: number, y: number, parent: string) => {
    out.nodes.set(n.id, { x: Math.round(x), y: Math.round(y) });
    out.parentOf.set(n.id, parent);
  };
  const addGroup = (id: string, label: string, r: Ring, ring: GroupRing, cx: number, cy: number, ro: number, parent: string | undefined) => {
    const { tag, color } = ONION_RINGS[r];
    out.groups.push({ id, label, tag, color, ring, ...(parent ? { parent } : {}), rect: { x: Math.round(cx - ro), y: Math.round(cy - ro), w: ro * 2, h: ro * 2 } });
  };

  /**
   * Miolo: o primeiro aggregate root fica no centro e os demais componentes orbitam em volta dele (sem aggregate, todos
   * orbitam; um componente só fica no centro). Órbitas cheias abrem outra mais larga.
   */
  const core = (id: string, items: NodeEl[]): Disc => {
    const sorted = items.map((n, i) => ({ n, i })).sort((a, b) => rank(a.n) - rank(b.n) || a.i - b.i).map((x) => x.n);
    const center = sorted.length === 1 || sorted[0]?.ddd?.role === "aggregate-root" ? sorted[0] : undefined;
    const rest = center ? sorted.slice(1) : sorted;
    const D = Math.max(0, ...sorted.map((n) => Math.max(n.w, n.h)));
    // órbitas concêntricas: cada uma cabe tantos componentes quanto o perímetro permite
    const rings: { r: number; items: NodeEl[] }[] = [];
    let r = center ? D + GAP : rest.length ? D / 2 + GAP : 0;
    for (let left = rest; left.length; ) {
      const fit = Math.max(1, Math.floor((2 * Math.PI * r) / (D + GAP)));
      if (fit < Math.min(left.length, 3) && left.length > 1) {
        r += 12;
        continue;
      }
      rings.push({ r, items: left.slice(0, fit) });
      left = left.slice(fit);
      r += D + GAP;
    }
    const outer = rings.length ? rings[rings.length - 1].r + D / 2 : center ? D / 2 : 0;
    const ro = Math.max(MIN_CORE, Math.ceil(outer + LABEL + 8));
    return {
      ro,
      w: ro * 2,
      h: ro * 2,
      place: (x, y, parent) => {
        const cx = x + ro;
        const cy = y + ro;
        addGroup(id, ONION_RINGS.entities.label, "entities", { inner: 0, layer: "entities", ...(rings.length ? { orbits: rings.map((o) => Math.round(o.r)) } : {}) }, cx, cy, ro, parent);
        if (center) setNode(center, cx - center.w / 2, cy - center.h / 2, id);
        rings.forEach((o, j) =>
          o.items.forEach((n, i) => {
            // meio passo de giro: nada no topo, onde fica o nome do anel; órbitas alternadas giram ao contrário
            const p = polar(cx, cy, o.r, ((i + 0.5) * 360) / o.items.length + (j % 2 ? 180 / o.items.length : 0));
            setNode(n, p.x - n.w / 2, p.y - n.h / 2, id);
          }),
        );
      },
    };
  };

  /** Anel em volta de `inner` (um círculo, ou uma área retangular de raio `innerR`). */
  const ring = (key: string, r: Ring, items: NodeEl[], inner: Piece | undefined, innerR: number): Disc => {
    const id = `${key}-${r}`;
    const sorted = items.map((n, i) => ({ n, i })).sort((a, b) => rank(a.n) - rank(b.n) || a.i - b.i).map((x) => x.n);
    const secs = SEGMENTS[r] ? sectorsOf(r, sorted) : [{ start: 0, end: 360, full: true, items: sorted }];
    const ri = inner ? innerR + RING_GAP : 0;
    const { at, ro, orbits } = placeRing(secs, ri);
    const split = secs.length > 1;
    return {
      ro,
      w: ro * 2,
      h: ro * 2,
      place: (x, y, parent) => {
        const cx = x + ro;
        const cy = y + ro;
        // anel com setores: o grupo do anel só agrupa (não se desenha); cada setor é um grupo com o seu nome
        addGroup(id, ONION_RINGS[r].label, r, { inner: ri, layer: r, ...(split ? { frame: true } : {}), ...(orbits.length ? { orbits } : {}) }, cx, cy, ro, parent);
        for (const s of secs) {
          const owner = split ? `${id}-${s.side}` : id;
          if (split) addGroup(owner, SEGMENTS[r]![s.side!]!, r, { inner: ri, layer: r, side: s.side, ...(orbits.length ? { orbits } : {}), start: Math.round(s.start * 10) / 10, end: Math.round(s.end * 10) / 10 }, cx, cy, ro, id);
          for (const n of s.items) {
            const p = at.get(n.id)!;
            setNode(n, cx + p.x, cy + p.y, owner);
          }
        }
        inner?.place(cx - inner.w / 2, cy - inner.h / 2, id);
      },
    };
  };

  /** A estrutura inteira (miolo e anéis pedidos), mesmo vazia. */
  const onion = (key: string, list: NodeEl[], rings: Ring[]): Disc => {
    const of = (r: Ring) => list.filter((n) => onionSlot(n).ring === r);
    let p = core(`${key}-entities`, of("entities"));
    for (const r of rings.slice(1)) p = ring(key, r, of(r), p, p.ro);
    return p;
  };

  // blocos: um por contexto (com todos os anéis); o que está solto fica num círculo sem contexto, e os drivers soltos no anel geral
  const ctxs = doc.groups.filter((g) => g.kind === "context");
  const lists = new Map<string, NodeEl[]>(ctxs.map((g) => [g.id, []]));
  const loose: NodeEl[] = [];
  for (const n of doc.nodes) {
    if (n.owner || n.kind === "endpoint") continue;
    const c = contextOf(n);
    (c ? lists.get(c.id)! : loose).push(n);
  }
  const inside: Ring[] = ["entities", "usecases", "adapters"];
  const block = (g: GroupEl, list: NodeEl[], rings: Ring[]): Piece => {
    const inner = onion(`${ONION_PREFIX}${g.id}`, list, rings);
    const w = inner.w + PAD * 2;
    const h = inner.h + TOP + PAD;
    return {
      w,
      h,
      place: (x, y, parent) => {
        out.contexts.set(g.id, { rect: { x: Math.round(x), y: Math.round(y), w, h }, ...(parent ? { parent } : {}) });
        inner.place(x + PAD, y + TOP, g.id);
      },
    };
  };
  // um contexto só (o caso comum: um diagrama por bounded context): o anel geral de drivers encosta nos anéis do
  // contexto, em vez de envolver o retângulo dele pela meia diagonal (o que abria um vão entre as camadas), e o
  // retângulo do contexto vira a moldura do desenho inteiro. Com os drivers já dentro do contexto e nenhum solto, o
  // anel geral (vazio) nem existe: seriam duas camadas de Frameworks & Drivers. Os pais não mudam: o que é do
  // contexto continua no contexto e os atores soltos continuam soltos.
  if (ctxs.length === 1 && loose.every((n) => onionSlot(n).ring === "drivers")) {
    const g = ctxs[0];
    const list = lists.get(g.id)!;
    const own = list.some((n) => onionSlot(n).ring === "drivers");
    const inner = onion(`${ONION_PREFIX}${g.id}`, list, own ? [...inside, "drivers"] : inside);
    const mine: Disc = { ...inner, place: (x, y) => inner.place(x, y, g.id) };
    const frame = own && !loose.length ? mine : ring(`${ONION_PREFIX}geral`, "drivers", loose, mine, mine.ro);
    out.contexts.set(g.id, { rect: { x: 0, y: 0, w: frame.w + PAD * 2, h: frame.h + TOP + PAD } });
    frame.place(PAD, TOP, undefined);
    return out;
  }
  const blocks: Piece[] = [];
  // sem contextos, o miolo geral é o círculo do diagrama; com contextos, só aparece se houver componentes soltos fora dos drivers
  if (!ctxs.length || loose.some((n) => onionSlot(n).ring !== "drivers")) blocks.push(onion(`${ONION_PREFIX}geral`, loose, inside));
  for (const g of ctxs) {
    const list = lists.get(g.id)!;
    blocks.push(block(g, list, list.some((n) => onionSlot(n).ring === "drivers") ? [...inside, "drivers"] : inside));
  }

  // blocos lado a lado, quebrando linha ao passar da largura máxima
  let area: Piece | undefined;
  if (blocks.length === 1) area = blocks[0];
  else if (blocks.length) {
    const at: { p: Piece; x: number; y: number }[] = [];
    let x = 0;
    let y = 0;
    let rowH = 0;
    let w = 0;
    for (const p of blocks) {
      if (x > 0 && x + p.w > MAX_WIDTH) {
        x = 0;
        y += rowH + BLOCK_GAP;
        rowH = 0;
      }
      at.push({ p, x, y });
      x += p.w + BLOCK_GAP;
      rowH = Math.max(rowH, p.h);
      w = Math.max(w, x - BLOCK_GAP);
    }
    area = { w, h: y + rowH, place: (ox, oy, parent) => at.forEach((a) => a.p.place(ox + a.x, oy + a.y, parent)) };
  }
  // o anel geral envolve um círculo pelo raio dele; um contexto (retângulo) ou vários, pela meia diagonal
  const areaR = area ? ((area as Disc).ro ?? Math.ceil(Math.hypot(area.w / 2, area.h / 2))) : 0;
  const outer = ring(`${ONION_PREFIX}geral`, "drivers", loose.filter((n) => onionSlot(n).ring === "drivers"), area, areaR);
  outer.place(0, 0, undefined);
  return out;
}
