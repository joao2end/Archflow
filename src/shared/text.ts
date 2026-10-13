/** Texto para o desenho: encurtar e quebrar nomes sem perder informação (o nome completo vai para o tooltip). */

/** Marcas de destaque (U+0001..U+0004) não ocupam largura. */
const vis = (s: string) => s.replace(/[-]/g, "").length;

export const truncate = (s: string, max: number) => (vis(s) > max ? (max <= 1 ? "…" : s.slice(0, max - 1) + "…") : s);

/**
 * Quebra um nome em até `lines` linhas de no máximo `max` caracteres, em espaços e hífens (quebra no meio da palavra só se ela
 * sozinha não couber numa linha). Se ainda não couber, só a última linha termina com "…".
 */
export function wrapLabel(text: string, max: number, lines = 2): string[] {
  const width = Math.max(4, max);
  const words = text.trim().split(/(?<=[\s-])/).filter(Boolean);
  const out: string[] = [];
  let cur = "";
  for (const w of words) {
    if (vis((cur + w).trimEnd()) <= width) cur += w;
    else {
      if (cur.trim()) out.push(cur.trimEnd());
      cur = w;
      while (vis(cur.trimEnd()) > width && out.length < lines - 1) {
        out.push(cur.slice(0, width));
        cur = cur.slice(width);
      }
    }
  }
  if (cur.trim()) out.push(cur.trimEnd());
  if (out.length > lines) return [...out.slice(0, lines - 1), truncate(out.slice(lines - 1).join(" "), width)];
  return out.length ? out.map((l, i) => (i === lines - 1 ? truncate(l, width) : l)) : [""];
}
