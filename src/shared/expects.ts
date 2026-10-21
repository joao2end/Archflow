/**
 * Saídas esperadas de um passo de workflow (`expects` da seta step): padrões de caminho relativos à raiz do projeto, com
 * glob simples (`*` e `?` dentro de um segmento; nada de `**`). Depois que o passo termina com código 0, cada padrão precisa
 * casar com ao menos um arquivo modificado desde o início do passo; senão o passo falha com «não gerou: …».
 * Tudo aqui é puro: quem lista as pastas (o bridge) passa uma função `list`.
 */

/** Quantos padrões um passo aceita e o tamanho de cada um. */
export const EXPECTS_MAX = 20;
export const EXPECT_MAX_CHARS = 200;

/** Erro do padrão (texto para o usuário) ou undefined se ele é válido. */
export function checkExpectPattern(p: unknown): string | undefined {
  if (typeof p !== "string" || !p.trim()) return "cada saída esperada deve ser um caminho não vazio (ex.: post/copy.md)";
  if (p.length > EXPECT_MAX_CHARS) return `saída esperada com mais de ${EXPECT_MAX_CHARS} caracteres`;
  if (p.includes("\\")) return `«${p}»: use / nos caminhos`;
  if (p.startsWith("/") || /^[a-zA-Z]:/.test(p)) return `«${p}»: o caminho é relativo à raiz do projeto (sem / ou C: no início)`;
  const segs = p.split("/");
  if (segs.some((s) => s === "" || s === "." || s === "..")) return `«${p}»: caminho com segmento vazio, «.» ou «..»`;
  if (segs.some((s) => s.includes("**"))) return `«${p}»: ** não é aceito; use * dentro de uma pasta (ex.: post/slides/*.png)`;
  if (/[[\]{}]/.test(p)) return `«${p}»: só * e ? são curingas`;
  return undefined;
}

/** Valida a lista inteira (`agent.expects`). */
export function checkExpects(v: unknown): string | undefined {
  if (!Array.isArray(v)) return "agent.expects deve ser uma lista de caminhos relativos ao projeto (ex.: [\"post/copy.md\", \"post/slides/*.png\"])";
  if (v.length > EXPECTS_MAX) return `agent.expects aceita no máximo ${EXPECTS_MAX} caminhos`;
  for (const p of v) {
    const e = checkExpectPattern(p);
    if (e) return `agent.expects: ${e}`;
  }
  return undefined;
}

const hasGlob = (seg: string) => /[*?]/.test(seg);

/** Um segmento com curinga vira uma RegExp que casa o nome inteiro. */
export function segmentRegExp(seg: string): RegExp {
  const src = seg.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*").replace(/\?/g, "[^/]");
  return new RegExp(`^${src}$`);
}

/** O caminho (relativo, com /) casa com o padrão? Mesmo número de segmentos; cada segmento casa o seu. */
export function matchesPattern(pattern: string, path: string): boolean {
  const ps = pattern.split("/");
  const fs = path.split("/");
  return ps.length === fs.length && ps.every((p, i) => (hasGlob(p) ? segmentRegExp(p).test(fs[i]) : p === fs[i]));
}

export interface FsEntry {
  name: string;
  dir: boolean;
  /** instante da última modificação (ms) */
  mtime: number;
}

/**
 * Arquivos que casam com o padrão, descendo segmento a segmento: só lista as pastas que o padrão pede.
 * `list(relDir)` devolve o conteúdo da pasta ("" = raiz do projeto) ou [] se ela não existe.
 */
export function expandPattern(pattern: string, list: (relDir: string) => FsEntry[]): { path: string; mtime: number }[] {
  const segs = pattern.split("/");
  let dirs = [""];
  for (let i = 0; i < segs.length; i++) {
    const last = i === segs.length - 1;
    const seg = segs[i];
    const re = hasGlob(seg) ? segmentRegExp(seg) : undefined;
    const next: string[] = [];
    const files: { path: string; mtime: number }[] = [];
    for (const d of dirs) {
      for (const e of list(d)) {
        if (re ? !re.test(e.name) : e.name !== seg) continue;
        const p = d ? `${d}/${e.name}` : e.name;
        if (last && !e.dir) files.push({ path: p, mtime: e.mtime });
        if (!last && e.dir) next.push(p);
      }
    }
    if (last) return files;
    dirs = next;
    if (!dirs.length) return [];
  }
  return [];
}

/** Padrões sem nenhum arquivo modificado em `since` ou depois (na ordem em que vieram). */
export function missingOutputs(patterns: string[], list: (relDir: string) => FsEntry[], since: number): string[] {
  return patterns.filter((p) => !expandPattern(p, list).some((f) => f.mtime >= since));
}
