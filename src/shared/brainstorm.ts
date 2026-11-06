/**
 * Modo brainstorm (explicar processos de forma simples, com formas e traços): validação de entrada das ops, regras
 * leves (B001+), descrição para LLMs e o guia do modo.
 *
 * Só depende de `schema.ts` (`ops.ts` importa este módulo, nunca o contrário). Determinístico.
 */
import { BRAIN_LINE_KEYS, BRAIN_LINES, BRAIN_SHAPE_KEYS, BRAIN_SHAPES, SCHEMA_VERSION, type BrainConnSpec, type BrainNodeSpec, type BrainShape, type Doc, type NodeEl } from "./schema";
import type { Issue } from "./domain";

const COLOR = /^#[0-9a-f]{3}([0-9a-f]{3})?$/i;

/** Valida o objeto `brain` de um nó. Devolve a mensagem de erro (acionável) ou undefined. */
export function checkBrainNode(brain: unknown): string | undefined {
  if (!brain || typeof brain !== "object") return "brain deve ser um objeto { shape, color?, step? }";
  const a = brain as Record<string, unknown>;
  for (const k of Object.keys(a)) if (a[k] !== undefined && !["shape", "color", "step"].includes(k)) return `forma do brainstorm não tem o campo "${k}". Campos: shape, color, step`;
  if (!BRAIN_SHAPE_KEYS.includes(a.shape as never)) return `brain.shape inválido "${a.shape}". Válidos: ${BRAIN_SHAPE_KEYS.join(", ")}`;
  if (a.color !== undefined && (typeof a.color !== "string" || !COLOR.test(a.color))) return `brain.color deve ser uma cor hexadecimal (ex.: "#4a63c8")`;
  if (a.step !== undefined && (typeof a.step !== "number" || !Number.isInteger(a.step) || a.step < 0 || a.step > 999)) return "brain.step deve ser um inteiro de 0 a 999";
  if (a.step !== undefined && a.shape !== "step") return `brain.step só vale na forma "step" (passo numerado)`;
  return undefined;
}

/** Valida o objeto `brain` (`BrainConnSpec`) de uma conexão. */
export function checkBrainConn(brain: unknown): string | undefined {
  if (!brain || typeof brain !== "object") return "brain deve ser um objeto { line, color? }";
  const a = brain as Record<string, unknown>;
  for (const k of Object.keys(a)) if (a[k] !== undefined && !["line", "color"].includes(k)) return `traço do brainstorm não tem o campo "${k}". Campos: line, color`;
  if (!BRAIN_LINE_KEYS.includes(a.line as never)) return `brain.line inválido "${a.line}". Válidos: ${BRAIN_LINE_KEYS.join(", ")}`;
  if (a.color !== undefined && (typeof a.color !== "string" || !COLOR.test(a.color))) return `brain.color deve ser uma cor hexadecimal (ex.: "#55606e")`;
  return undefined;
}

/** Tamanho inicial de cada forma (depois o usuário redimensiona à vontade). */
export const brainSize = (shape: BrainShape) => ({ w: BRAIN_SHAPES[shape].w, h: BRAIN_SHAPES[shape].h });

/** Cor efetiva da forma (a escolhida ou a padrão do desenho). */
export const brainColor = (spec: BrainNodeSpec) => spec.color ?? BRAIN_SHAPES[spec.shape].color;

/** Troca a forma mantendo a cor; o número do passo só sobrevive no passo numerado. */
export function reshapeBrain(old: BrainNodeSpec, shape: BrainShape): BrainNodeSpec {
  return { shape, ...(old.color ? { color: old.color } : {}), ...(shape === "step" ? { step: old.step ?? 1 } : {}) };
}

/** Próximo número livre para um passo numerado novo. */
export function nextStep(doc: Doc): number {
  return doc.nodes.reduce((m, n) => (n.brain?.shape === "step" ? Math.max(m, n.brain.step ?? 0) : m), 0) + 1;
}

/** Traço padrão quando a conexão não diz nada: uma seta (a ordem do processo). */
export const defaultBrainConn = (): BrainConnSpec => ({ line: "arrow" });

/* ───────────────────────── regras leves (B001+) ───────────────────────── */

/** Só o que atrapalha a leitura: o modo é livre de propósito. */
export function brainIssues(doc: Doc): Issue[] {
  const issues: Issue[] = [];
  const add = (rule: string, severity: Issue["severity"], message: string, target?: string) => issues.push({ rule, severity, message, target });
  const shapes = doc.nodes.filter((n) => n.brain && BRAIN_SHAPES[n.brain.shape]);
  const quote = (n: NodeEl) => `"${n.label}" (${n.id})`;
  for (const n of shapes) {
    if (!n.label.trim() && n.brain!.shape !== "step") add("B001", "dica", `${BRAIN_SHAPES[n.brain!.shape].label} ${n.id} sem texto: escreva o que ela representa`, n.id);
    if (n.brain!.shape === "diamond") {
      const outs = doc.connections.filter((c) => c.from === n.id);
      if (outs.length && outs.length < 2) add("B002", "dica", `${quote(n)}: decisão com uma saída só; uma pergunta costuma ter pelo menos dois caminhos (sim / não)`, n.id);
      for (const c of outs) if (outs.length > 1 && !c.label?.trim()) add("B003", "dica", `${quote(n)}: rotule as saídas da decisão (ex.: sim / não) para quem lê saber qual caminho é qual`, c.id);
    }
  }
  const steps = shapes.filter((n) => n.brain!.shape === "step");
  const seen = new Map<number, NodeEl>();
  for (const n of steps) {
    const k = n.brain!.step ?? 0;
    if (seen.has(k)) add("B004", "aviso", `os passos ${quote(seen.get(k)!)} e ${quote(n)} têm o mesmo número ${k}`, n.id);
    else seen.set(k, n);
  }
  return issues;
}

/* ───────────────────────── descrição e guia ───────────────────────── */

/** Ordem de leitura: passos numerados primeiro; depois quem não recebe seta (os começos), seguindo as setas. */
function readingOrder(doc: Doc): NodeEl[] {
  const shapes = doc.nodes.filter((n) => n.brain);
  const steps = shapes.filter((n) => n.brain!.shape === "step").sort((a, b) => (a.brain!.step ?? 0) - (b.brain!.step ?? 0));
  const out: NodeEl[] = [...steps];
  const done = new Set(out.map((n) => n.id));
  const incoming = new Set(doc.connections.filter((c) => BRAIN_LINES[c.brain?.line ?? "arrow"].head).map((c) => c.to));
  const starts = shapes.filter((n) => !done.has(n.id) && !incoming.has(n.id)).sort((a, b) => a.y - b.y || a.x - b.x);
  const visit = (n: NodeEl) => {
    if (done.has(n.id)) return;
    done.add(n.id);
    out.push(n);
    for (const c of doc.connections.filter((x) => x.from === n.id)) {
      const t = shapes.find((s) => s.id === c.to);
      if (t) visit(t);
    }
  };
  for (const s of starts) visit(s);
  for (const n of [...shapes].sort((a, b) => a.y - b.y || a.x - b.x)) visit(n);
  return out;
}

export function describeBrain(doc: Doc, issues: Issue[]): string {
  const L: string[] = [`# ${doc.title}`];
  if (doc.description) L.push("", doc.description);
  const byId = new Map(doc.nodes.map((n) => [n.id, n]));
  const name = (id: string) => byId.get(id)?.label || doc.groups.find((g) => g.id === id)?.label || id;
  const order = readingOrder(doc);
  L.push("", "## Formas (na ordem de leitura)");
  if (!order.length) L.push("(nenhuma)");
  for (const n of order) {
    const b = n.brain!;
    const kind = b.shape === "step" ? `Passo ${b.step ?? "?"}` : BRAIN_SHAPES[b.shape].label;
    L.push(`- [${kind}] **${n.label || "(sem texto)"}** (${n.id})${n.description ? ` — ${n.description}` : ""}`);
  }
  const lines = doc.connections.filter((c) => byId.get(c.from)?.brain || byId.get(c.to)?.brain);
  L.push("", "## Ligações");
  if (!lines.length) L.push("(nenhuma)");
  for (const c of lines) {
    const ln = BRAIN_LINES[c.brain?.line ?? "arrow"];
    const arrow = ln.head && ln.tail ? "↔" : ln.head ? "→" : "—";
    L.push(`- ${name(c.from)} ${arrow} ${name(c.to)}${c.label ? ` («${c.label}»)` : ""}${c.brain?.line && c.brain.line !== "arrow" ? ` [${ln.label.toLowerCase()}]` : ""}`);
  }
  if (doc.groups.length) {
    L.push("", "## Áreas");
    for (const g of doc.groups) L.push(`- **${g.label}**: ${doc.nodes.filter((n) => n.parent === g.id).map((n) => n.label).join(", ") || "(vazia)"}`);
  }
  const notes = doc.notes.filter((n) => n.text?.trim());
  if (notes.length) L.push("", "## Anotações", ...notes.map((n) => `- ${n.text.replace(/\s+/g, " ").trim()}`));
  if (issues.length) L.push("", "## Dicas", ...issues.map((i) => `- [${i.rule} ${i.severity}] ${i.message}`));
  return L.join("\n");
}

export function schemaGuideBrain(): string {
  return [
    `# Archflow ${SCHEMA_VERSION} — modo brainstorm (Brain Storm)`,
    "",
    "Quadro livre para EXPLICAR UM PROCESSO de forma simples, como num quadro branco: formas, traços, textos e desenhos à mão. Não há regras de negócio nem tecnologia: o significado está no texto de cada forma e nos rótulos das setas.",
    "Todo nó é `kind: \"shape\"` com `brain.shape`. Use `label` curto (o que acontece), `description` para o detalhe.",
    "",
    "## Formas (`brain.shape`)",
    ...BRAIN_SHAPE_KEYS.map((s) => `- \`${s}\` (${BRAIN_SHAPES[s].label}): ${BRAIN_SHAPES[s].hint}`),
    "- `brain.color` (opcional): cor hexadecimal do traço; `brain.step`: o número no passo numerado.",
    "",
    "## Traços (`brain.line` na conexão; o `type` vem do traço — não informe)",
    ...BRAIN_LINE_KEYS.map((l) => `- \`${l}\` (${BRAIN_LINES[l].label}): ${BRAIN_LINES[l].hint}`),
    "- Omitindo `brain` no connect, o traço é uma seta. `label` na seta diz o porquê (ex.: «sim», «aprova», «se faltar estoque»).",
    "",
    "## Fluxo recomendado",
    "1. `add_components` com um `round` de início, uma `box` por etapa, `diamond` para cada pergunta e um `round` de fim; `person` para quem participa, `doc`/`data`/`cylinder` para o que circula ou fica guardado.",
    "2. `connect` na ordem do processo (seta); rotule as saídas de cada `diamond`.",
    "3. Ideias soltas e observações: `sticky` ou `add_note`. Agrupe etapas por área/pessoa com `add_groups` (kind `boundary`).",
    "4. `auto_layout` e `validate_diagram` (só dicas leves: decisão sem duas saídas, passos com número repetido).",
  ].join("\n");
}
