/**
 * Modo brainstorm (explicar processos de forma simples, com formas e traços): validação de entrada das ops, regras
 * leves (B001+), descrição para LLMs e o guia do modo.
 *
 * Só depende de `schema.ts` (`ops.ts` importa este módulo, nunca o contrário). Determinístico.
 */
import { BRAIN_DATA_HEAD, BRAIN_GROUPS, BRAIN_GROUP_KEYS, CONN_SIDES, BRAIN_LINE_KEYS, BRAIN_LINES, BRAIN_MOOD_KEYS, BRAIN_MOODS, BRAIN_SHAPE_KEYS, BRAIN_SHAPES, SCHEMA_VERSION, brainGroup, isBrainData, type BrainConnSpec, type BrainNodeSpec, type BrainShape, type Doc, type NodeEl } from "./schema";
import type { Issue } from "./domain";

const COLOR = /^#[0-9a-f]{3}([0-9a-f]{3})?$/i;

/** Valida o objeto `brain` de um nó. Devolve a mensagem de erro (acionável) ou undefined. */
export function checkBrainNode(brain: unknown): string | undefined {
  if (!brain || typeof brain !== "object") return "brain deve ser um objeto { shape, color?, step?, mood?, src?, content? }";
  const a = brain as Record<string, unknown>;
  for (const k of Object.keys(a)) if (a[k] !== undefined && !["shape", "color", "step", "mood", "src", "content", "folded", "openH"].includes(k)) return `forma do brainstorm não tem o campo "${k}". Campos: shape, color, step, mood, src, content, folded, openH`;
  if (!BRAIN_SHAPE_KEYS.includes(a.shape as never)) return `brain.shape inválido "${a.shape}". Válidos: ${BRAIN_SHAPE_KEYS.join(", ")}`;
  if (a.color !== undefined && (typeof a.color !== "string" || !COLOR.test(a.color))) return `brain.color deve ser uma cor hexadecimal (ex.: "#4a63c8")`;
  if (a.step !== undefined && (typeof a.step !== "number" || !Number.isInteger(a.step) || a.step < 0 || a.step > 999)) return "brain.step deve ser um inteiro de 0 a 999";
  if (a.step !== undefined && a.shape !== "step") return `brain.step só vale na forma "step" (passo numerado)`;
  if (a.mood !== undefined && !BRAIN_MOOD_KEYS.includes(a.mood as never)) return `brain.mood inválido "${a.mood}". Válidos: ${BRAIN_MOOD_KEYS.join(", ")}`;
  if (a.mood !== undefined && a.shape !== "feeling") return `brain.mood só vale na forma "feeling" (sentimento)`;
  if (a.src !== undefined && a.shape !== "image") return `brain.src só vale na forma "image" (imagem)`;
  if (a.content !== undefined && (typeof a.content !== "string" || a.content.length > 20_000)) return "brain.content deve ser um texto de até 20 000 caracteres";
  if (a.content !== undefined && !isBrainData(a.shape as BrainShape)) return `brain.content só vale nas formas de dados (json, list, tree, table)`;
  if (a.folded !== undefined && (!Array.isArray(a.folded) || a.folded.length > 2000 || a.folded.some((x) => typeof x !== "string"))) return "brain.folded deve ser uma lista de caminhos (texto)";
  if (a.folded !== undefined && a.shape !== "json" && a.shape !== "tree") return `brain.folded só vale nas formas "json" e "tree"`;
  if (a.openH !== undefined && (typeof a.openH !== "number" || !(a.openH > 0) || a.openH > 20_000)) return "brain.openH deve ser a altura (px) da forma aberta";
  if (a.openH !== undefined && !isBrainData(a.shape as BrainShape)) return `brain.openH só vale nas formas de dados (json, list, tree, table)`;
  if (a.src !== undefined && !isImageSrc(a.src)) return "brain.src deve ser uma URL http(s) ou um data URI de imagem (data:image/png;base64,...)";
  return undefined;
}

/**
 * `brain.collapsed` (entrada do MCP / das ops, nunca gravado): recolher o card de dados até o cabeçalho guarda a altura
 * aberta em `openH`; expandir volta a ela. Sem `collapsed`, um card já recolhido continua recolhido (o patch de `brain`
 * substitui o objeto inteiro, e esquecer `openH` perderia a altura). Devolve o brain e a altura a gravar, ou o erro.
 */
export function resolveBrainCollapse(brain: BrainNodeSpec & { collapsed?: unknown }, h: number, prev?: BrainNodeSpec): { brain: BrainNodeSpec; h: number } | { error: string } {
  const { collapsed, ...b } = brain;
  const open = b.openH ?? (prev && prev.shape === b.shape ? prev.openH : undefined);
  if (collapsed === undefined) return { brain: open && isBrainData(b.shape) ? { ...b, openH: open } : b, h };
  if (typeof collapsed !== "boolean") return { error: "brain.collapsed deve ser true (recolher o card) ou false (expandir)" };
  if (!isBrainData(b.shape)) return { error: `brain.collapsed só vale nas formas de dados (json, list, tree, table)` };
  if (collapsed) return { brain: { ...b, openH: open ?? h }, h: BRAIN_DATA_HEAD };
  const { openH: _, ...rest } = b;
  return { brain: rest, h: open ?? h };
}

/** Valida `fromSide` / `toSide` de uma conexão. */
export function checkConnSide(field: string, v: unknown): string | undefined {
  if (v === undefined || v === null || CONN_SIDES.includes(v as never)) return undefined;
  return `${field} inválido "${v}". Válidos: ${CONN_SIDES.join(", ")}`;
}

/** Endereço aceito numa forma imagem: URL http(s) ou data URI de imagem em base64 (até ~8 MB). */
export const isImageSrc = (v: unknown): v is string =>
  typeof v === "string" && v.length <= 12_000_000 && (/^https?:\/\/\S+$/i.test(v) || /^data:image\/[a-z0-9.+-]+(;[a-z0-9=.-]+)*;base64,[a-z0-9+/=]+$/i.test(v));

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

/** Troca a forma mantendo a cor; o número do passo, o rosto, a imagem e o conteúdo só sobrevivem nas formas que os usam. */
export function reshapeBrain(old: BrainNodeSpec, shape: BrainShape): BrainNodeSpec {
  return { shape, ...(old.color ? { color: old.color } : {}), ...(shape === "step" ? { step: old.step ?? 1 } : {}), ...(shape === "feeling" && old.mood ? { mood: old.mood } : {}), ...(shape === "image" && old.src ? { src: old.src } : {}), ...(isBrainData(shape) && old.content ? { content: old.content } : {}) };
}

/** Rosto do sentimento (padrão: triste — a forma costuma marcar uma dor). */
export const brainMood = (spec: BrainNodeSpec) => spec.mood ?? "sad";

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
    if (n.brain!.shape === "image" && !n.brain!.src) add("B006", "dica", `imagem ${quote(n)} sem arquivo: use add_image (ou cole a URL no Inspetor)`, n.id);
    if (!n.label.trim() && n.brain!.shape !== "step" && n.brain!.shape !== "image") add("B001", "dica", `${BRAIN_SHAPES[n.brain!.shape].label} ${n.id} sem texto: escreva o que ela representa`, n.id);
    if (n.brain!.shape === "diamond") {
      const outs = doc.connections.filter((c) => c.from === n.id);
      if (outs.length && outs.length < 2) add("B002", "dica", `${quote(n)}: decisão com uma saída só; uma pergunta costuma ter pelo menos dois caminhos (sim / não)`, n.id);
      for (const c of outs) if (outs.length > 1 && !c.label?.trim()) add("B003", "dica", `${quote(n)}: rotule as saídas da decisão (ex.: sim / não) para quem lê saber qual caminho é qual`, c.id);
    }
  }
  for (const n of shapes.filter((x) => x.brain!.shape === "problem")) {
    if (!doc.connections.some((c) => c.from === n.id || c.to === n.id)) add("B005", "dica", `${quote(n)}: problema solto; ligue as causas a ele e ele às ideias de solução para o quadro contar a história`, n.id);
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
    const kind = (b.shape === "step" ? `Passo ${b.step ?? "?"}` : b.shape === "feeling" ? `Sentimento: ${BRAIN_MOODS[brainMood(b)].toLowerCase()}` : BRAIN_SHAPES[b.shape].label) + (b.openH ? ", recolhido" : "");
    L.push(`- [${kind}] **${n.label || "(sem texto)"}** (${n.id})${n.description ? ` — ${n.description}` : ""}`);
    if (b.content?.trim()) L.push(...b.content.trim().split("\n").slice(0, 20).map((l) => `    ${l}`));
  }
  const lines = doc.connections.filter((c) => byId.get(c.from)?.brain || byId.get(c.to)?.brain);
  L.push("", "## Ligações");
  if (!lines.length) L.push("(nenhuma)");
  for (const c of lines) {
    const ln = BRAIN_LINES[c.brain?.line ?? "arrow"];
    const arrow = ln.bar ? "⊣" : ln.head && ln.tail ? "↔" : ln.head ? "→" : "—";
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
    "Quadro livre para EXPLICAR UM PROCESSO ou MAPEAR UM PROBLEMA de forma simples, como num quadro branco: formas, traços, textos e desenhos à mão. Não há regras de negócio nem tecnologia: o significado está no texto de cada forma e nos rótulos das setas.",
    "Todo nó é `kind: \"shape\"` com `brain.shape`. Use `label` curto (o que acontece), `description` para o detalhe.",
    "",
    "## Formas (`brain.shape`)",
    ...BRAIN_GROUP_KEYS.flatMap((g) => [`### ${BRAIN_GROUPS[g]}`, ...BRAIN_SHAPE_KEYS.filter((s) => brainGroup(s) === g).map((s) => `- \`${s}\` (${BRAIN_SHAPES[s].label}): ${BRAIN_SHAPES[s].hint}`)]),
    `- \`brain.color\` (opcional): cor hexadecimal do traço; \`brain.step\`: o número no passo numerado; \`brain.mood\` (só em feeling): ${BRAIN_MOOD_KEYS.join(" | ")}.`,
    "- `brain.collapsed: true` (formas de dados): o card fica só com o título (a altura aberta é guardada; `false` reabre). `brain.folded` (json/tree): trechos recolhidos — caminhos do JSON (`$.itens`, `$.itens[0]`, `$.cliente.endereco`) ou linhas da árvore (`t0`, `t3`: índice da linha não vazia).",
    "- `brain.content` (só em json, list, tree, table): o dado em texto. json: o JSON (é formatado no quadro); list: um item por linha (`1.` numera); tree: um nó por linha, indentado com 2 espaços por nível; table: uma linha por registro, colunas separadas por `|` (ou `,` `;` tab), a 1ª linha é o cabeçalho. O `label` vira o título no cabeçalho da forma.",
    "",
    "## Traços (`brain.line` na conexão; o `type` vem do traço — não informe)",
    ...BRAIN_LINE_KEYS.map((l) => `- \`${l}\` (${BRAIN_LINES[l].label}): ${BRAIN_LINES[l].hint}`),
    "- Omitindo `brain` no connect, o traço é uma seta. `label` na seta diz o porquê (ex.: «sim», «aprova», «se faltar estoque»).",
    "- `fromSide` / `toSide` (left | right | top | bottom) fixam o lado onde a seta sai e entra (ex.: a volta de um laço saindo por baixo e entrando por cima; a saída «não» da decisão pela direita). Sem eles, o lado voltado para o outro elemento. `auto_layout` limpa os lados: fixe-os depois do layout.",
    "",
    "## Fluxo recomendado",
    "1. `add_components` com um `round` de início, uma `box` por etapa, `diamond` para cada pergunta e um `round` de fim; `person` para quem participa, `doc`/`data`/`cylinder` para o que circula ou fica guardado.",
    "2. `connect` na ordem do processo (seta); rotule as saídas de cada `diamond`.",
    "3. Ideias soltas e observações: `sticky` ou `add_note`. Agrupe etapas por área/pessoa com `add_groups` (kind `boundary`).",
    "4. `auto_layout` e `validate_diagram` (só dicas leves: decisão sem duas saídas, passos com número repetido, problema solto).",
    "",
    "## Mostrar os dados do processo",
    "- Use as formas de dados para o que CIRCULA entre as etapas: `json` (o payload de uma API, um registro), `table` (o arquivo/planilha, com 2–5 linhas de exemplo), `list` (os campos, os itens, os passos de um checklist), `tree` (pastas, categorias, a estrutura de um documento).",
    "- Ligue o dado à etapa que o produz (etapa → dado) e à que o consome (dado → etapa), com `dashed` quando for só ilustração. O `label` do dado é o nome (ex.: «pedido.json», «produtos.csv»).",
    "- Exemplos curtos e reais valem mais que o esquema completo: 3–10 linhas. JSON grande: recolha os trechos que não importam (`folded`) ou o card inteiro (`collapsed`) e deixe aberto só o que explica a etapa.",
    "",
    "## Mapear um problema",
    "1. Um `problem` no centro com o que dói (curto). `speech` com a reclamação de quem sofre e um `feeling` (mood sad/angry) ao lado da `person`.",
    "2. Causas (`box`, `stop`, `clock`, `money`) ligadas ao problema com `arrow` (causa → problema); o que trava use `brain: { line: \"blocks\" }`.",
    "3. `question` para o que ainda não se sabe; `warning` para riscos.",
    "4. `idea` para cada solução (problema → ideia), com `pro`/`con` ligados por `line`; um `target` com a meta medível.",
    "",
    "## Imagens",
    "- `search_images` busca fotos e ilustrações (Google Imagens quando GOOGLE_API_KEY e GOOGLE_CSE_ID estão definidos; senão Openverse, só imagens de licença aberta) e devolve URLs.",
    "- `add_image` baixa a imagem, embute no diagrama e cria uma forma `image` (o `label` vira a legenda). Ligue-a às outras formas com `connect` como qualquer forma.",
    "- Imagem ilustra (o produto, a tela, a pessoa, o lugar), não enfeita: uma ou duas por quadro costumam bastar.",
    "",
    "## Desenhar à mão (`draw`)",
    "- `draw` faz traços livres por cima do quadro: `line`, `arrow`, `rect`, `ellipse`, `polygon`, `freehand` (pontos) e `underline`. `around: \"<id>\"` circula, emoldura ou sublinha um elemento sem calcular coordenadas.",
    "- Serve para chamar atenção (circular o gargalo, sublinhar a meta, uma seta solta apontando um detalhe). O que tem significado (etapas, ligações) continua sendo forma + connect: o desenho não entra na descrição nem na validação.",
    "- `highlight: true` vira marca-texto (largo e translúcido). Os traços recebem id `ink-…`; apague com `remove_elements`.",
  ].join("\n");
}
