/**
 * Geração de esqueleto de código (TypeScript) a partir de um diagrama de domínio.
 *
 * Um diretório por bounded context, na regra de dependência da Clean Architecture (application → domain, nunca o inverso):
 *   <contexto>/domain/        aggregates (com entities e value objects), eventos, interfaces de repository, serviços de domínio
 *   <contexto>/application/   commands, handlers, policies, sagas, read models, serviços de aplicação
 *   <contexto>/use-cases.md   rastreio caso de uso → command → aggregate → evento
 *
 * É um ponto de partida determinístico: o que o modelo sabe (nomes, invariantes, intenção, eventos, quem aciona quem) vira
 * tipos, assinaturas e comentários; a lógica fica como TODO. Sem I/O: devolve os arquivos, quem chama decide onde gravá-los.
 */
import { flowText, traceUseCase } from "./domain";
import { docMode, type Doc, type DddRole, type GroupEl, type NodeEl, type PropertySpec } from "./schema";

export interface GeneratedFile {
  path: string;
  content: string;
}

/** Linguagens suportadas. Hoje só TypeScript; a lista existe para o MCP/UI recusarem o resto com uma mensagem clara. */
export const CODEGEN_LANGUAGES = ["typescript"] as const;
export type CodegenLanguage = (typeof CODEGEN_LANGUAGES)[number];

/* ───────── nomes ───────── */

const RESERVED = new Set(["Date", "Error", "Promise", "Object", "Array", "String", "Number", "Boolean", "Map", "Set", "JSON", "Symbol", "Function", "Math", "DomainEvent", "EventPublisher", "Record", "Partial", "Readonly"]);
const words = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);
const pascal = (s: string) => {
  const p = words(s).map((w) => w[0].toUpperCase() + w.slice(1)).join("");
  return !p ? "Item" : /^\d/.test(p) ? `_${p}` : p;
};
const camel = (s: string) => {
  const p = pascal(s);
  return p[0].toLowerCase() + p.slice(1);
};
const kebab = (s: string) => words(s).map((w) => w.toLowerCase()).join("-") || "item";
const ident = (s: string) => {
  const t = s.replace(/[^A-Za-z0-9_$]/g, "");
  return !t ? "" : /^\d/.test(t) ? `_${t}` : t;
};
const oneLine = (s: string) => s.replace(/\s*\n\s*/g, " ").replace(/\*\//g, "* /").trim();

const plain = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();

/**
 * Tipo TypeScript de uma propriedade a partir do texto livre do modelo: primitivos conhecidos, listas ("Item[]", "lista de Item"),
 * outro elemento do contexto (pelo nome ou id) ou `unknown` com o tipo original num comentário.
 */
function tsType(raw: string | undefined, resolve: (name: string) => string | undefined): { ts: string; note?: string } {
  const t = (raw ?? "").trim();
  if (!t) return { ts: "unknown" };
  const list = t.match(/^(?:lista|array|list|conjunto)\s*(?:de|of|<)\s*(.+?)>?$/i) ?? t.match(/^(.+?)\s*\[\]$/);
  if (list) {
    const inner = tsType(list[1], resolve);
    return { ts: `${inner.ts.includes(" ") ? `(${inner.ts})` : inner.ts}[]`, note: inner.note };
  }
  const k = plain(t);
  if (/^(texto|string|text|uuid|id|email|url|cpf|cnpj|telefone|slug|enum)$/.test(k)) return { ts: "string" };
  if (/^(inteiro|int|integer|numero|number|decimal|float|double|long|dinheiro|money|valor)$/.test(k)) {
    const own = resolve(t);
    return own ? { ts: own } : { ts: "number" };
  }
  if (/^(booleano|boolean|bool|sim\/nao)$/.test(k)) return { ts: "boolean" };
  if (/^(data|date|data e hora|datetime|timestamp|instante)$/.test(k)) return { ts: "Date" };
  const own = resolve(t);
  return own ? { ts: own } : { ts: "unknown", note: t };
}

/** Linhas `readonly nome[?]: tipo;` (com JSDoc da descrição) para uma lista de propriedades. */
function propLines(props: PropertySpec[] | undefined, resolve: (name: string) => string | undefined, indent = "  ", skip: string[] = [], readonly = true): string[] {
  const out: string[] = [];
  for (const p of props ?? []) {
    const name = ident(p.name);
    if (!name || skip.includes(name)) continue;
    const { ts, note } = tsType(p.type, resolve);
    const doc = [p.description ? oneLine(p.description) : "", p.example ? `ex.: ${oneLine(p.example)}` : "", note ? `tipo no modelo: ${oneLine(note)}` : ""].filter(Boolean).join(" — ");
    if (doc) out.push(`${indent}/** ${doc} */`);
    out.push(`${indent}${readonly ? "readonly " : ""}${name}${p.optional ? "?" : ""}: ${ts};`);
  }
  return out;
}

/** Aloca um nome de tipo único (e fora dos globais) por contexto. */
class Names {
  private used = new Set<string>(RESERVED);
  private byKey = new Map<string, string>();
  of(key: string, wanted: string): string {
    const hit = this.byKey.get(key);
    if (hit) return hit;
    let name = RESERVED.has(wanted) ? `${wanted}Type` : wanted;
    for (let i = 2; this.used.has(name); i++) name = `${wanted}${i}`;
    this.used.add(name);
    this.byKey.set(key, name);
    return name;
  }
}

const HEADER = (doc: Doc) => `// Gerado pelo Archflow a partir de "${oneLine(doc.title)}". Esqueleto: complete os TODOs; o que o modelo não sabe fica explícito.\n`;
const doc1 = (lines: (string | undefined)[], indent = "") => {
  const l = lines.filter((x): x is string => !!x);
  return l.length ? `${indent}/**\n${l.map((x) => `${indent} * ${oneLine(x)}`).join("\n")}\n${indent} */\n` : "";
};

/* ───────── geração ───────── */

export function generateTypeScript(doc: Doc): GeneratedFile[] {
  if (docMode(doc) !== "domain") return [];
  const byId = new Map(doc.nodes.map((n) => [n.id, n]));
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
  const outs = (id: string, rel: string) => doc.connections.filter((c) => c.from === id && c.ddd?.rel === rel).map((c) => byId.get(c.to)).filter((n): n is NodeEl => !!n);
  const ins = (id: string, rel: string) => doc.connections.filter((c) => c.to === id && c.ddd?.rel === rel).map((c) => byId.get(c.from)).filter((n): n is NodeEl => !!n);
  const role = (n: NodeEl | undefined, ...r: DddRole[]) => !!n?.ddd && r.includes(n.ddd.role);

  const files: GeneratedFile[] = [];
  const blocks: { dir: string; ctx?: GroupEl; nodes: NodeEl[] }[] = doc.groups.filter((g) => g.kind === "context").map((g) => ({ dir: kebab(g.id), ctx: g, nodes: [] as NodeEl[] }));
  const loose: NodeEl[] = [];
  for (const n of doc.nodes) {
    if (!n.ddd) continue;
    const c = contextOf(n);
    (c ? blocks.find((b) => b.ctx === c)!.nodes : loose).push(n);
  }
  if (loose.length) blocks.push({ dir: "app", nodes: loose });

  for (const b of blocks) {
    const nodes = b.nodes;
    if (!nodes.some((n) => !role(n, "use-case"))) {
      if (nodes.some((n) => role(n, "use-case"))) files.push(useCasesDoc(doc, b.dir, b.ctx, nodes));
      continue;
    }
    const names = new Names();
    const N = (n: NodeEl, suffix = "") => names.of(n.id + suffix, pascal(n.id + (suffix ? `-${suffix}` : "")));
    const of = (...r: DddRole[]) => nodes.filter((n) => role(n, ...r));
    const out = (path: string, content: string) => files.push({ path: `${b.dir}/${path}`, content });
    // tipo de uma propriedade que cita outro elemento do contexto pelo nome ou id (ex.: "Dinheiro")
    // só aggregates, entities e value objects de um aggregate viram classe; o arquivo de cada um é o do aggregate
    const home = new Map<string, string>();
    for (const a of of("aggregate-root")) {
      home.set(a.id, kebab(a.id));
      const seen = new Set<string>([a.id]);
      const walk = (id: string) => {
        for (const m of outs(id, "contains")) if (!seen.has(m.id)) (seen.add(m.id), home.set(m.id, kebab(a.id)), walk(m.id));
      };
      walk(a.id);
    }
    let usedNow = new Set<string>();
    const resolveType = (name: string) => {
      const k = plain(name);
      const hit = nodes.find((n) => home.has(n.id) && (plain(n.label) === k || plain(n.id) === k));
      if (hit) usedNow.add(hit.id);
      return hit ? N(hit) : undefined;
    };
    /** imports dos tipos usados (agrupados por arquivo), exceto os do próprio arquivo */
    const typeImports = (from: "domain" | "application", self?: string) => {
      const byFile = new Map<string, string[]>();
      for (const id of usedNow) {
        const file = home.get(id)!;
        if (file !== self) byFile.set(file, [...(byFile.get(file) ?? []), N(byId.get(id)!)]);
      }
      return [...byFile].sort(([x], [y]) => x.localeCompare(y)).map(([file, ns]) => `import type { ${ns.sort().join(", ")} } from "${from === "domain" ? "." : "../domain"}/${file}";`);
    };

    // ── domain/event-publisher.ts
    out(
      "domain/event-publisher.ts",
      `${HEADER(doc)}
/** Fato que já aconteceu no domínio. Os eventos específicos estendem esta interface. */
export interface DomainEvent {
  readonly type: string;
  readonly occurredAt: Date;
}

/** Porta de saída para publicar eventos (broker, outbox...). A implementação fica na infraestrutura. */
export interface EventPublisher {
  publish(event: DomainEvent): Promise<void>;
}
`,
    );

    // ── domain/events.ts
    const events = of("domain-event");
    if (events.length) {
      usedNow = new Set();
      const body = events
        .map((e) => {
          const props = propLines(e.ddd!.properties, resolveType, "  ", ["type", "occurredAt"]);
          const fields = props.length ? [] : [...new Set((e.ddd!.payload ?? "").split(/[,;\n]/).map((f) => ident(f.trim().split(/[:\s]/)[0])).filter((f) => f && f !== "type" && f !== "occurredAt"))];
          return (
            doc1([e.label !== e.id ? e.label : undefined, e.description, e.ddd!.external ? `Vem de outro contexto: ${e.ddd!.external}.` : undefined, fields.length ? "Payload: complete os tipos dos campos." : undefined]) +
            `export interface ${N(e)} extends DomainEvent {\n  readonly type: ${JSON.stringify(e.id)};\n${props.join("\n")}${props.length ? "\n" : ""}${fields.map((f) => `  readonly ${f}?: unknown;`).join("\n")}${fields.length ? "\n" : ""}}\n`
          );
        })
        .join("\n");
      out("domain/events.ts", `${HEADER(doc)}${['import type { DomainEvent } from "./event-publisher";', ...typeImports("domain")].join("\n")}\n\n${body}`);
    }

    // eventos produzidos por um command ou aggregate
    const eventsOf = (producer: NodeEl) => [...new Set([...outs(producer.id, "emits"), ...events.filter((e) => e.ddd!.producedBy === producer.id)])].filter((e) => role(e, "domain-event"));

    // ── aggregates (+ entities, value objects) e repositories
    const aggregates = of("aggregate-root");
    const commandsOf = (agg: NodeEl) => of("command").filter((c) => outs(c.id, "triggers").some((t) => t.id === agg.id));
    const members = (root: NodeEl) => {
      const seen = new Set<string>();
      const walk = (id: string): NodeEl[] => outs(id, "contains").flatMap((m) => (seen.has(m.id) ? [] : (seen.add(m.id), [m, ...walk(m.id)])));
      return walk(root.id);
    };
    for (const a of aggregates) {
      const aName = N(a);
      const mem = members(a);
      const ents = mem.filter((m) => role(m, "entity"));
      const vos = mem.filter((m) => role(m, "value-object"));
      const refs = outs(a.id, "references-by-id").filter((r) => role(r, "aggregate-root"));
      const cmds = commandsOf(a);
      const usedEvents = new Set<string>();
      const methods = new Set<string>();
      const methodSrc = cmds
        .map((c) => {
          let m = camel(c.id);
          for (let i = 2; methods.has(m); i++) m = `${camel(c.id)}${i}`;
          methods.add(m);
          const evs = eventsOf(c);
          evs.forEach((e) => usedEvents.add(e.id));
          const todo = (e: NodeEl) => (e.ddd!.properties ?? []).filter((p) => !p.optional && ident(p.name) && !["type", "occurredAt"].includes(ident(p.name))).map((p) => `${ident(p.name)}: undefined as never /* TODO */`);
          const lit = evs.map((e) => `      { ${[`type: ${JSON.stringify(e.id)}`, "occurredAt: new Date()", ...todo(e)].join(", ")} } ${todo(e).length ? "as" : "satisfies"} ${N(e)},`).join("\n");
          return (
            doc1([`Comando ${c.id}${c.ddd!.intent ? `: ${c.ddd!.intent}` : ""}.`, ...(c.ddd!.invariants ?? []).map((i) => `Invariante: ${i}`), "TODO: parâmetros, validação das invariantes e mudança de estado."], "  ") +
            `  ${m}(): DomainEvent[] {\n    return [${lit ? `\n${lit}\n    ` : ""}];\n  }\n`
          );
        })
        .join("\n");
      usedNow = new Set();
      const imports = [
        `import type { DomainEvent } from "./event-publisher";`,
        usedEvents.size ? `import type { ${[...usedEvents].map((id) => N(byId.get(id)!)).sort().join(", ")} } from "./events";` : "",
      ].filter(Boolean);
      // com propriedades declaradas, o construtor recebe os campos (obrigatórios antes dos opcionais); sem elas, o esqueleto de antes
      const ordered = (n: NodeEl) => [...(n.ddd!.properties ?? [])].sort((x, y) => Number(!!x.optional) - Number(!!y.optional));
      const ctorParams = (n: NodeEl, skip: string[]) => ordered(n).flatMap((p) => propLines([p], resolveType, "", skip)).filter((l) => !l.startsWith("/**")).map((l) => l.replace(/;$/, ""));
      const voBody = (n: NodeEl) => {
        const ps = ctorParams(n, []);
        if (!ps.length) return `export class ${N(n)} {\n  constructor(readonly value: unknown) {} // TODO: modele os campos\n\n  equals(other: ${N(n)}): boolean {\n    return JSON.stringify(this.value) === JSON.stringify(other.value);\n  }\n}\n`;
        const names = ordered(n).map((p) => ident(p.name)).filter(Boolean);
        return `export class ${N(n)} {\n  constructor(\n${ps.map((l) => `    ${l},`).join("\n")}\n  ) {}\n\n  equals(other: ${N(n)}): boolean {\n    return ${names.map((f) => `JSON.stringify(this.${f}) === JSON.stringify(other.${f})`).join(" && ")};\n  }\n}\n`;
      };
      const entityBody = (n: NodeEl) => {
        const key = (n.ddd!.properties ?? []).find((p) => p.key);
        const idName = ident(key?.name ?? "") || "id";
        const idType = key ? tsType(key.type, resolveType).ts : "string";
        const ps = ctorParams(n, [idName]);
        if (!key && !ps.length) return `export class ${N(n)} {\n  constructor(readonly id: string) {}\n}\n`;
        return `export class ${N(n)} {\n  constructor(\n    readonly ${idName}: ${idType === "unknown" ? "string" : idType},${ps.map((l) => `\n    ${l},`).join("")}\n  ) {}\n}\n`;
      };
      const classOf = (n: NodeEl, kind: "entity" | "vo") =>
        kind === "vo"
          ? doc1([n.description, "Value Object: imutável, igualdade pelo conteúdo.", ...(n.ddd!.invariants ?? []).map((i) => `Invariante: ${i}`)]) +
            voBody(n)
          : doc1([n.description, "Entity: identidade própria dentro do aggregate.", ...(n.ddd!.invariants ?? []).map((i) => `Invariante: ${i}`)]) + entityBody(n);
      const fieldNames = new Set<string>(["id"]);
      const field = (base: string) => {
        let f = base;
        for (let i = 2; fieldNames.has(f); i++) f = `${base}${i}`;
        fieldNames.add(f);
        return f;
      };
      const own = propLines(a.ddd!.properties, resolveType, "  ", ["id"], false).map((l) => (l.trim().startsWith("/**") ? l : l.replace(/^(\s*)(\w+)(\??): /, (_m, sp, nm, q) => `${sp}${nm}${q || "!"}: `)));
      for (const p of a.ddd!.properties ?? []) fieldNames.add(ident(p.name));
      const fields = [
        ...own,
        ...ents.map((e) => `  readonly ${field(camel(e.id) + "s")}: ${N(e)}[] = [];`),
        ...vos.map((v) => `  ${field(camel(v.id))}?: ${N(v)};`),
        ...refs.map((r) => `  ${field(camel(r.id) + "Id")}?: string; // referência por id ao aggregate ${r.id}`),
      ];
      const classSrc = [...vos.map((v) => classOf(v, "vo")), ...ents.map((e) => classOf(e, "entity"))].join("\n");
      out(
        `domain/${kebab(a.id)}.ts`,
        `${HEADER(doc)}${[...imports, ...typeImports("domain", kebab(a.id))].join("\n")}\n\n${classSrc}${vos.length + ents.length ? "\n" : ""}` +
          doc1([a.description, "Aggregate Root: único ponto de entrada do aggregate; garante as invariantes do conjunto.", ...(a.ddd!.invariants ?? []).map((i) => `Invariante: ${i}`)]) +
          `export class ${aName} {\n${fields.join("\n")}${fields.length ? "\n\n" : ""}  constructor(readonly id: string) {}\n${methodSrc ? `\n${methodSrc}` : ""}}\n`,
      );
      const repoNode = of("repository").find((r) => r.ddd!.for === a.id);
      const rName = repoNode ? N(repoNode) : names.of(`${a.id}-repository`, `${aName}Repository`);
      out(
        `domain/${kebab(repoNode ? repoNode.id : `${a.id}-repository`)}.ts`,
        `${HEADER(doc)}import type { ${aName} } from "./${kebab(a.id)}";\n\n${doc1([repoNode?.description, "Repository: coleção persistente do aggregate. A implementação fica na infraestrutura."])}export interface ${rName} {\n  findById(id: string): Promise<${aName} | undefined>;\n  save(aggregate: ${aName}): Promise<void>;\n}\n`,
      );
    }

    // ── domain/services.ts
    const dsvc = of("domain-service");
    if (dsvc.length)
      out(
        "domain/services.ts",
        `${HEADER(doc)}${dsvc.map((s) => doc1([s.description, s.ddd!.intent, "Domain Service: regra de negócio que não cabe em um aggregate; pura, sem I/O."]) + `export class ${N(s)} {\n  // TODO\n}\n`).join("\n")}`,
      );

    // ── application/commands.ts e handlers
    const cmds = of("command");
    if (cmds.length) {
      usedNow = new Set();
      const cmdBody = cmds
          .map((c) => doc1([c.description, c.ddd!.intent ? `Intenção: ${c.ddd!.intent}` : undefined, ...(c.ddd!.invariants ?? []).map((i) => `Invariante: ${i}`)]) + `export interface ${N(c)} {\n  readonly type: ${JSON.stringify(c.id)};\n${c.ddd!.properties?.length ? propLines(c.ddd!.properties, resolveType, "  ", ["type"]).join("\n") : "  // TODO: dados do comando"}\n}\n`)
          .join("\n");
      const cmdImports = typeImports("application");
      out("application/commands.ts", `${HEADER(doc)}${cmdImports.length ? `${cmdImports.join("\n")}\n\n` : ""}${cmdBody}`);
      for (const c of cmds) {
        const agg = outs(c.id, "triggers").find((t) => role(t, "aggregate-root"));
        const aName = agg ? N(agg) : undefined;
        const repoNode = agg ? of("repository").find((r) => r.ddd!.for === agg.id) : undefined;
        const rName = agg ? (repoNode ? N(repoNode) : names.of(`${agg.id}-repository`, `${aName}Repository`)) : undefined;
        const hName = names.of(`${c.id}-handler`, pascal(`${c.id}-handler`));
        const evs = eventsOf(c);
        const loops = doc.connections.filter((x) => x.to === c.id && x.ddd?.loop).map((x) => `Pode ser repetido (${flowText(x.ddd)}), disparado por ${x.from}.`);
        const iterates = doc.connections.filter((x) => (x.from === c.id || x.to === c.id) && x.ddd?.foreach).map((x) => `Itera: para cada ${x.ddd!.foreach}.`);
        out(
          `application/${kebab(c.id)}-handler.ts`,
          `${HEADER(doc)}import type { ${N(c)} } from "./commands";\nimport type { EventPublisher } from "../domain/event-publisher";\n` +
            (agg ? `import type { ${rName} } from "../domain/${kebab(repoNode ? repoNode.id : `${agg.id}-repository`)}";\n` : "") +
            `\n${doc1([`Caso de uso: ${c.ddd!.intent ?? c.label}.`, agg ? `Carrega o aggregate ${aName}, aplica o comando e persiste.` : "ATENÇÃO: este command não aciona nenhum aggregate no modelo.", evs.length ? `Eventos: ${evs.map((e) => e.id).join(", ")}.` : undefined, ...loops, ...[...new Set(iterates)], "Application Service: orquestra; a regra de negócio vive no domínio."])}` +
            `export class ${hName} {\n  constructor(\n${agg ? `    private readonly repository: ${rName},\n` : ""}    private readonly events: EventPublisher,\n  ) {}\n\n  async handle(command: ${N(c)}): Promise<void> {\n    // TODO: ${oneLine(c.ddd!.intent ?? c.label)}\n${agg ? `    // 1. carregar (ou criar) o aggregate ${aName} via this.repository\n    // 2. chamar o método de domínio ${camel(c.id)}()\n    // 3. this.repository.save(aggregate)\n    // 4. this.events.publish(...) para cada evento retornado\n` : `    // 1. aplicar a regra e publicar os eventos via this.events\n`}    void command;\n    void this.events;${agg ? "\n    void this.repository;" : ""}\n    throw new Error("not implemented");\n  }\n}\n`,
        );
      }
    }

    // ── application/policies.ts, sagas, read models, serviços
    const policies = of("policy");
    const sagas = of("process-manager");
    const reads = of("read-model");
    const asvc = of("application-service");
    const reactions = [
      ...policies.map((p) => ({ n: p, kind: "Policy: regra sem estado (evento → command).", extra: "" })),
      ...sagas.map((p) => ({ n: p, kind: "Process Manager (saga): coordena um fluxo longo, com estado e compensação.", extra: `\n\n  /** Desfaz o que já foi feito${p.ddd!.compensates?.length ? ` (${p.ddd!.compensates.join(", ")})` : ""}. */\n  async compensate(): Promise<void> {\n    throw new Error("not implemented");\n  }` })),
    ];
    if (reactions.length || reads.length || asvc.length) {
      const parts = [
        ...reactions.map(({ n, kind, extra }) => {
          const when = [...(n.ddd!.reactsTo ?? []), ...ins(n.id, "triggers").map((e) => e.id)];
          const then = [...(n.ddd!.issues ?? []), ...outs(n.id, "triggers").map((e) => e.id)];
          const branches = doc.connections.filter((c) => c.from === n.id && c.ddd?.rel === "triggers" && flowText(c.ddd)).map((c) => `Ramo: ${flowText(c.ddd)} → ${c.to}${c.ddd?.loop ? " (volta a um passo anterior)" : ""}`);
          return doc1([n.description, n.ddd!.intent, kind, when.length ? `Reage a: ${[...new Set(when)].join(", ")}.` : undefined, then.length ? `Dispara: ${[...new Set(then)].join(", ")}.` : undefined, ...branches]) + `export class ${N(n)} {\n  async on(event: DomainEvent): Promise<void> {\n    void event;\n    throw new Error("not implemented");\n  }${extra}\n}\n`;
        }),
        ...reads.map((r) => {
          const from = [...(r.ddd!.projectsFrom ?? []), ...ins(r.id, "triggers").map((e) => e.id)];
          return doc1([r.description, "Read Model (CQRS): projeção para consulta.", from.length ? `Alimentado por: ${[...new Set(from)].join(", ")}.` : undefined]) + `export class ${N(r)} {\n  async on(event: DomainEvent): Promise<void> {\n    void event;\n    throw new Error("not implemented");\n  }\n}\n`;
        }),
        ...asvc.map((s) => doc1([s.description, s.ddd!.intent, "Application Service: orquestra casos de uso; sem regra de negócio."]) + `export class ${N(s)} {\n  // TODO\n}\n`),
      ];
      out("application/reactions.ts", `${HEADER(doc)}import type { DomainEvent } from "../domain/event-publisher";\n\n${parts.join("\n")}`);
    }

    if (nodes.some((n) => role(n, "use-case"))) files.push(useCasesDoc(doc, b.dir, b.ctx, nodes));
  }
  return files;
}

/** Rastreio dos casos de uso do contexto em Markdown, para acompanhar o código gerado. */
function useCasesDoc(doc: Doc, dir: string, ctx: GroupEl | undefined, nodes: NodeEl[]): GeneratedFile {
  const ucs = nodes.filter((n) => n.ddd?.role === "use-case");
  const L = [`# Casos de uso${ctx ? ` — ${ctx.label}` : ""}`, "", `Gerado pelo Archflow a partir de "${oneLine(doc.title)}".`, "", "| Caso de uso | Ator | Rastreio | Situação |", "| --- | --- | --- | --- |"];
  for (const u of ucs) {
    const t = traceUseCase(doc, u.id)!;
    const path = t.paths.map((p) => p.slice(1).map((s) => s.id).join(" → ")).join("; ");
    L.push(`| ${oneLine(u.label)} (\`${u.id}\`) | ${u.ddd!.actor ?? "—"} | ${path || "—"} | ${t.ok ? "✔" : `✘ ${t.problems.join("; ") || "sem caminho até um evento"}`} |`);
  }
  return { path: `${dir}/use-cases.md`, content: L.join("\n") + "\n" };
}

export function generateCode(doc: Doc, language: CodegenLanguage = "typescript"): GeneratedFile[] {
  if (language === "typescript") return generateTypeScript(doc);
  throw new Error(`linguagem "${language}" não suportada. Disponíveis: ${CODEGEN_LANGUAGES.join(", ")}`);
}

/** Formato para ler/copiar: um bloco por arquivo, com o caminho no título. */
export function filesToMarkdown(files: GeneratedFile[]): string {
  return files.map((f) => `### ${f.path}\n\`\`\`${f.path.endsWith(".md") ? "md" : "ts"}\n${f.content.trimEnd()}\n\`\`\``).join("\n\n");
}
