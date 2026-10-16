/**
 * Catálogo curado de skills (estilo `catalog.ts`/`BUILTIN_ASSETS`, mas para o modo agents) +
 * resolver que baixa o `SKILL.md` do GitHub (compatível com o formato do `skills-lock.json` que
 * o `npx skills` da vercel-labs já usa neste projeto: `source` = "owner/repo", `skillPath`).
 *
 * Só depende de `schema.ts` (tipos). Determinístico, exceto `resolveSkillSource` (I/O de rede,
 * por isso recebe `fetchImpl` injetável — testável sem rede e reaproveitável em qualquer ambiente
 * com `fetch` global, browser ou Node 18+).
 */
import type { AgentSkillSource } from "./schema";

export interface SkillCatalogEntry {
  id: string;
  name: string;
  repo: string; // "owner/repo"
  skillPath: string;
  description: string;
  tags?: string;
  /** Corpo e hash quando a skill foi instalada com `npx skills add` e gravada no catálogo local. */
  body?: string;
  hash?: string;
  /** Veio da busca no skills.sh e ainda não foi instalada (skillPath é só uma dica; o lock traz o real). */
  remote?: boolean;
}

/** Sem skills embutidas: o catálogo vem da busca no skills.sh e das skills que o usuário instalou. */
export const SKILL_CATALOG: SkillCatalogEntry[] = [];

/** Catálogo curado mais as skills instaladas pelo usuário. As instaladas vêm primeiro e vencem no mesmo repo + caminho. */
export function mergeSkillCatalog(extra: SkillCatalogEntry[] = []): SkillCatalogEntry[] {
  const key = (e: SkillCatalogEntry) => `${e.repo.toLowerCase()} ${e.skillPath}`;
  const seen = new Set<string>();
  const out: SkillCatalogEntry[] = [];
  for (const e of [...extra, ...SKILL_CATALOG]) {
    const k = key(e);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(e);
  }
  return out;
}

/** Busca por texto livre no id, nome, descrição ou tags (case-insensitive, sem acento). `extra` são skills instaladas. */
export function searchSkillCatalog(query: string, extra: SkillCatalogEntry[] = []): SkillCatalogEntry[] {
  const all = mergeSkillCatalog(extra);
  const q = norm(query);
  if (!q) return all;
  return all.filter((e) => norm(`${e.id} ${e.name} ${e.repo} ${e.description} ${e.tags ?? ""}`).includes(q));
}

export function findSkillCatalogEntry(id: string, extra: SkillCatalogEntry[] = []): SkillCatalogEntry | undefined {
  return extra.find((e) => e.id === id) ?? SKILL_CATALOG.find((e) => e.id === id);
}

/** Pasta que contém o SKILL.md: slug do `npx skills add -s`. Sem pasta (URL do repositório), devolve undefined. */
export function skillInstallSlug(skillPath: string): string | undefined {
  const parts = skillPath.split("/").filter(Boolean);
  if (parts.length >= 2 && /^skill\.md$/i.test(parts[parts.length - 1])) return parts[parts.length - 2];
  return undefined;
}

const norm = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

export const catalogEntryToSource = (entry: SkillCatalogEntry): AgentSkillSource => ({ repo: entry.repo, skillPath: entry.skillPath });

/**
 * Lê uma URL do GitHub e devolve a fonte da skill. Aceita a página do arquivo
 * (`github.com/…/blob/<ref>/…/SKILL.md`), a da pasta (`…/tree/<ref>/skills/pdf`),
 * o raw (`raw.githubusercontent.com/…`) e também só `owner/repo`.
 * Uma pasta vira `…/SKILL.md`. A ref (branch) é descartada: a resolução usa HEAD.
 */
export function parseSkillGithubUrl(input: string): { repo: string; skillPath: string } | undefined {
  let s = input.trim().replace(/[?#].*$/, "").replace(/\/+$/, "");
  if (!s) return undefined;
  s = s.replace(/^https?:\/\//i, "").replace(/^www\./i, "");
  const parts = s.split("/").filter(Boolean);
  let owner: string | undefined;
  let repo: string | undefined;
  let path: string[] = [];
  if (/^raw\.githubusercontent\.com$/i.test(parts[0]) && parts.length >= 4) {
    [, owner, repo] = parts;
    path = parts.slice(4); // pula a ref
  } else if (/^github\.com$/i.test(parts[0]) && parts.length >= 3) {
    [, owner, repo] = parts;
    if (parts.length === 3) path = [];
    else if (/^(blob|tree|raw)$/i.test(parts[3]) && parts.length >= 5) path = parts.slice(5);
    else return undefined; // issues, pulls, releases… não apontam para um arquivo
  } else if (parts.length >= 2 && !parts[0].includes(".")) {
    [owner, repo] = parts;
    path = parts.slice(2);
  } else return undefined;
  repo = repo.replace(/\.git$/i, "");
  if (!owner || !repo || /[\s]/.test(owner) || /[\s]/.test(repo)) return undefined;
  let skillPath = path.map(decode).join("/");
  if (!skillPath) skillPath = "SKILL.md";
  else if (!/\.md$/i.test(skillPath)) skillPath = `${skillPath}/SKILL.md`;
  return { repo: `${owner}/${repo}`, skillPath };
}

const decode = (s: string) => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};

/* ───────────────────────── resolver (GitHub) ───────────────────────── */

/** URL raw do GitHub para o `SKILL.md` da fonte, numa ref (branch, tag ou commit). */
export function skillRawUrl(source: AgentSkillSource, ref = "HEAD"): string {
  return `https://raw.githubusercontent.com/${source.repo}/${ref}/${source.skillPath}`;
}

/**
 * Hash determinístico (não criptográfico) do conteúdo — FNV-1a 32-bit, 8 chars hex. Serve só pra
 * detectar que o `SKILL.md` do catálogo mudou desde a última resolução (drift), não pra
 * segurança; por isso evita `node:crypto` e funciona em qualquer ambiente (browser ou Node) sem
 * depender de API nativa de hashing.
 */
export function hashSkillContent(content: string): string {
  const normalized = content.replace(/\r\n/g, "\n");
  let h = 0x811c9dc5;
  for (let i = 0; i < normalized.length; i++) {
    h ^= normalized.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/** Resultado de dividir um `SKILL.md`: frontmatter YAML simples (name/description) + corpo. */
export interface ParsedSkillMarkdown {
  name?: string;
  description?: string;
  body: string;
}

/**
 * Separa o frontmatter YAML (`---\nname: ...\ndescription: ...\n---`) do corpo de um `SKILL.md`.
 * Só lê `name`/`description` de nível raiz, sem libs de YAML (o formato das skills é sempre
 * plano nesses dois campos); valores entre aspas são aceitos e desaspeados.
 */
export function parseSkillMarkdown(raw: string): ParsedSkillMarkdown {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(raw);
  if (!m) return { body: raw.trim() };
  const [, front, rest] = m;
  const unquote = (v: string) => v.trim().replace(/^["']|["']$/g, "");
  const field = (name: string) => {
    const f = new RegExp(`^${name}:\\s*(.*)$`, "m").exec(front);
    return f ? unquote(f[1]) : undefined;
  };
  return { name: field("name"), description: field("description"), body: rest.trim() };
}

/** Assinatura mínima de `fetch` que o resolver precisa — permite injetar um mock nos testes. */
export type SkillFetcher = (url: string) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>;

export type ResolveSkillResult = { ok: true; raw: string; body: string; hash: string; name?: string; description?: string } | { ok: false; error: string };

/**
 * Resolve uma fonte de catálogo baixando o `SKILL.md` do GitHub. `fetchImpl` é injetável (testes,
 * ou ambiente sem `fetch` global); por padrão usa o `fetch` global do runtime.
 */
export async function resolveSkillSource(source: AgentSkillSource, fetchImpl?: SkillFetcher, ref = "HEAD"): Promise<ResolveSkillResult> {
  const doFetch = fetchImpl ?? (globalThis.fetch as SkillFetcher | undefined);
  if (!doFetch) return { ok: false, error: "fetch não está disponível neste ambiente; passe fetchImpl" };
  const url = skillRawUrl(source, ref);
  let res: Awaited<ReturnType<SkillFetcher>>;
  try {
    res = await doFetch(url);
  } catch (e) {
    return { ok: false, error: `falha ao buscar ${url}: ${e instanceof Error ? e.message : String(e)}` };
  }
  if (!res.ok) return { ok: false, error: `GitHub respondeu ${res.status} para ${url}` };
  const raw = await res.text();
  const { name, description, body } = parseSkillMarkdown(raw);
  return { ok: true, raw, body, hash: hashSkillContent(raw), name, description };
}

/** true quando o hash atual (`source.hash`) difere do hash recém-calculado — a skill mudou na origem. */
export const skillSourceDrifted = (source: AgentSkillSource | undefined, newHash: string): boolean => !!source?.hash && source.hash !== newHash;
