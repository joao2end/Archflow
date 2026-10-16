/**
 * Biblioteca de prompts do projeto (modo agents): prompts cadastrados e workflows (listas ordenadas de prompts) que o
 * terminal do Claude Code executa. Fica em `.archflow/prompts.json`. Lógica pura: validação, variáveis `{{nome}}` e render.
 */

export const PROMPTS_SCHEMA = "archflow-prompts/1" as const;

export const LIMITS = { prompts: 200, workflows: 50, steps: 50, name: 80, text: 20_000, notes: 2_000, vars: 20 } as const;

export interface SavedPrompt {
  id: string;
  name: string;
  text: string;
  /** subagente do diagrama (id do nó) que deve executar: o texto sai prefixado por «Use o subagente <agent> para: » */
  agent?: string;
  notes?: string;
}

export type StepMode = "manual" | "auto";
export interface WorkflowStep {
  promptId: string;
  /** manual (padrão): o texto é digitado e o usuário confirma; auto: roda `claude -p` e espera terminar */
  mode: StepMode;
}
export interface Workflow {
  id: string;
  name: string;
  steps: WorkflowStep[];
}

export interface PromptLibrary {
  schema: typeof PROMPTS_SCHEMA;
  prompts: SavedPrompt[];
  workflows: Workflow[];
}

export const emptyLibrary = (): PromptLibrary => ({ schema: PROMPTS_SCHEMA, prompts: [], workflows: [] });

const ID_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;
const str = (v: unknown, max: number): string | undefined => (typeof v === "string" ? v.slice(0, max) : undefined);

/** «Revisar PR» → «revisar-pr» (sem acento), pronto para ser id. */
export const slugId = (name: string): string =>
  name.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "prompt";

/** Primeiro id livre: «base», «base-2», «base-3»… */
export function uniqueId(base: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  if (!used.has(base)) return base;
  for (let n = 2; ; n++) if (!used.has(`${base}-${n}`)) return `${base}-${n}`;
}

/**
 * Lê o que veio do disco ou da UI sem confiar nele: descarta o que não tem forma de prompt/workflow, corta textos
 * longos, resolve ids repetidos e tira de cada workflow os passos que apontam para um prompt que não existe.
 * Nunca lança: o pior caso é uma biblioteca vazia. `dropped` diz o que foi descartado (para avisar o usuário).
 */
export function normalizeLibrary(raw: unknown): { library: PromptLibrary; dropped: string[] } {
  const dropped: string[] = [];
  const lib = emptyLibrary();
  const src = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const ids = new Set<string>();
  for (const p of Array.isArray(src.prompts) ? src.prompts : []) {
    if (lib.prompts.length >= LIMITS.prompts) {
      dropped.push(`prompts além de ${LIMITS.prompts}`);
      break;
    }
    const o = p && typeof p === "object" ? (p as Record<string, unknown>) : {};
    const name = str(o.name, LIMITS.name)?.trim();
    const text = str(o.text, LIMITS.text);
    if (!name || text === undefined) {
      dropped.push(`prompt sem nome ou texto${name ? ` («${name}»)` : ""}`);
      continue;
    }
    const wanted = typeof o.id === "string" && ID_RE.test(o.id) ? o.id : slugId(name);
    const id = uniqueId(wanted, ids);
    ids.add(id);
    const agent = typeof o.agent === "string" && ID_RE.test(o.agent) ? o.agent : undefined;
    const notes = str(o.notes, LIMITS.notes)?.trim() || undefined;
    lib.prompts.push({ id, name, text, ...(agent ? { agent } : {}), ...(notes ? { notes } : {}) });
  }
  const wfIds = new Set<string>();
  for (const w of Array.isArray(src.workflows) ? src.workflows : []) {
    if (lib.workflows.length >= LIMITS.workflows) {
      dropped.push(`workflows além de ${LIMITS.workflows}`);
      break;
    }
    const o = w && typeof w === "object" ? (w as Record<string, unknown>) : {};
    const name = str(o.name, LIMITS.name)?.trim();
    if (!name) {
      dropped.push("workflow sem nome");
      continue;
    }
    const id = uniqueId(typeof o.id === "string" && ID_RE.test(o.id) ? o.id : slugId(name), wfIds);
    wfIds.add(id);
    const steps: WorkflowStep[] = [];
    for (const s of Array.isArray(o.steps) ? o.steps : []) {
      if (steps.length >= LIMITS.steps) {
        dropped.push(`passos além de ${LIMITS.steps} em «${name}»`);
        break;
      }
      const so = s && typeof s === "object" ? (s as Record<string, unknown>) : {};
      if (typeof so.promptId !== "string" || !ids.has(so.promptId)) {
        dropped.push(`passo de «${name}» aponta para um prompt que não existe`);
        continue;
      }
      steps.push({ promptId: so.promptId, mode: so.mode === "auto" ? "auto" : "manual" });
    }
    lib.workflows.push({ id, name, steps });
  }
  return { library: lib, dropped };
}

/**
 * Variáveis «de memória», preenchidas pelo workflow com o que os agentes responderam nos passos anteriores (não são pedidas
 * ao usuário): `{{anterior}}` = resposta do passo imediatamente anterior que teve resposta; `{{resultado.<id-do-prompt>}}` =
 * resposta do passo desse prompt (a mais recente).
 */
export const isMemoryVar = (name: string): boolean => name === "anterior" || name.startsWith("resultado.");

/** Nomes das variáveis `{{nome}}` do texto que o usuário preenche, na ordem em que aparecem, sem repetir (as de memória ficam de fora). */
export function promptVars(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/\{\{\s*([\p{L}_][\p{L}\p{N}_-]{0,39}(?:\.[a-z0-9][a-z0-9-]{0,61})?)\s*\}\}/gu)) if (!isMemoryVar(m[1]) && !out.includes(m[1]) && out.length < LIMITS.vars) out.push(m[1]);
  return out;
}

export interface Rendered {
  /** texto final, com o prefixo do agente quando há `agent` */
  text: string;
  /** variáveis sem valor (ficam vazias no texto) */
  missing: string[];
}

/** Preenche `{{var}}` com `values` e acrescenta o prefixo do subagente. Variável sem valor vira vazio e entra em `missing`. */
export function renderPrompt(p: Pick<SavedPrompt, "text" | "agent">, values: Record<string, string> = {}): Rendered {
  const missing: string[] = [];
  const body = p.text.replace(/\{\{\s*([\p{L}_][\p{L}\p{N}_-]{0,39}(?:\.[a-z0-9][a-z0-9-]{0,61})?)\s*\}\}/gu, (_, name: string) => {
    const v = values[name];
    if (v === undefined || v === "") {
      if (!isMemoryVar(name) && !missing.includes(name)) missing.push(name);
      return "";
    }
    return v;
  });
  return { text: p.agent ? `Use o subagente ${p.agent} para: ${body}` : body, missing };
}

/** Envolve em «bracketed paste»: um texto com várias linhas entra no prompt do Claude Code sem que cada quebra envie a mensagem. */
export const asBracketedPaste = (text: string): string => (text.includes("\n") ? `\x1b[200~${text}\x1b[201~` : text);

/** Avisos da biblioteca para a UI (não bloqueiam nada). */
export function libraryIssues(lib: PromptLibrary, agentIds: ReadonlySet<string> = new Set()): string[] {
  const out: string[] = [];
  for (const p of lib.prompts) if (p.agent && agentIds.size && !agentIds.has(p.agent)) out.push(`«${p.name}»: o subagente «${p.agent}» não existe no diagrama aberto`);
  for (const w of lib.workflows) if (!w.steps.length) out.push(`workflow «${w.name}» está sem passos`);
  return out;
}
