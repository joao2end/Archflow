/**
 * Imagens para o modo brainstorm (tools `search_images` e `add_image` do MCP).
 *
 *  - Busca: Google Imagens (Custom Search JSON API) quando GOOGLE_API_KEY e GOOGLE_CSE_ID estão definidos;
 *    senão Openverse (api.openverse.org, sem chave, só imagens de licença aberta).
 *  - Download: baixa a URL, confere que é imagem (pelos bytes, não só pelo content-type), lê largura e altura
 *    e devolve um data URI para embutir no diagrama (o quadro não depende do site continuar no ar).
 */

export interface ImageHit {
  url: string;
  thumbnail?: string;
  title: string;
  /** página onde a imagem aparece */
  source?: string;
  width?: number;
  height?: number;
  /** licença e autor (Openverse); no Google, os direitos são do site de origem */
  license?: string;
  creator?: string;
}

export interface ImageSearch {
  provider: "google" | "openverse";
  hits: ImageHit[];
}

const UA = "Archflow (+https://archflow.2-end.online)";

export async function searchImages(query: string, limit = 8, env = process.env): Promise<ImageSearch> {
  const n = Math.max(1, Math.min(10, Math.floor(limit)));
  const key = env.GOOGLE_API_KEY ?? env.ARCHFLOW_GOOGLE_API_KEY;
  const cx = env.GOOGLE_CSE_ID ?? env.ARCHFLOW_GOOGLE_CSE_ID;
  if (key && cx) {
    const u = new URL("https://www.googleapis.com/customsearch/v1");
    Object.entries({ key, cx, q: query, searchType: "image", num: String(n), safe: "active" }).forEach(([k, v]) => u.searchParams.set(k, v));
    const r = await fetch(u, { signal: AbortSignal.timeout(12_000) });
    if (!r.ok) throw new Error(`Google Imagens respondeu ${r.status}: ${(await r.text()).slice(0, 300)}`);
    const j = (await r.json()) as { items?: { link: string; title: string; image?: { contextLink?: string; thumbnailLink?: string; width?: number; height?: number } }[] };
    return {
      provider: "google",
      hits: (j.items ?? []).map((i) => ({ url: i.link, title: i.title, thumbnail: i.image?.thumbnailLink, source: i.image?.contextLink, width: i.image?.width, height: i.image?.height })),
    };
  }
  const u = new URL("https://api.openverse.org/v1/images/");
  u.searchParams.set("q", query);
  u.searchParams.set("page_size", String(n));
  u.searchParams.set("mature", "false");
  const r = await fetch(u, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(12_000) });
  if (!r.ok) throw new Error(`Openverse respondeu ${r.status}: ${(await r.text()).slice(0, 300)}`);
  const j = (await r.json()) as { results?: { url: string; title?: string; thumbnail?: string; foreign_landing_url?: string; width?: number; height?: number; license?: string; license_version?: string; creator?: string }[] };
  return {
    provider: "openverse",
    hits: (j.results ?? []).map((i) => ({
      url: i.url,
      title: i.title || "(sem título)",
      thumbnail: i.thumbnail,
      source: i.foreign_landing_url,
      width: i.width,
      height: i.height,
      license: i.license ? `CC ${i.license.toUpperCase()}${i.license_version ? ` ${i.license_version}` : ""}`.replace("CC PDM", "domínio público").replace("CC CC0", "CC0") : undefined,
      creator: i.creator,
    })),
  };
}

/* ───────── tipo e tamanho pelos bytes ───────── */

export function sniffImage(b: Uint8Array): { mime: string; width?: number; height?: number } | undefined {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const ascii = (o: number, n: number) => String.fromCharCode(...b.subarray(o, o + n));
  if (b.length >= 24 && b[0] === 0x89 && ascii(1, 3) === "PNG") return { mime: "image/png", width: dv.getUint32(16), height: dv.getUint32(20) };
  if (b.length >= 10 && ascii(0, 3) === "GIF") return { mime: "image/gif", width: dv.getUint16(6, true), height: dv.getUint16(8, true) };
  if (b.length >= 30 && ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP") {
    const kind = ascii(12, 4);
    if (kind === "VP8 ") return { mime: "image/webp", width: dv.getUint16(26, true) & 0x3fff, height: dv.getUint16(28, true) & 0x3fff };
    if (kind === "VP8L") {
      const v = dv.getUint32(21, true);
      return { mime: "image/webp", width: (v & 0x3fff) + 1, height: ((v >> 14) & 0x3fff) + 1 };
    }
    if (kind === "VP8X") return { mime: "image/webp", width: 1 + (b[24] | (b[25] << 8) | (b[26] << 16)), height: 1 + (b[27] | (b[28] << 8) | (b[29] << 16)) };
    return { mime: "image/webp" };
  }
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) {
    // percorre os segmentos até o SOF (C0–CF, menos C4/C8/CC), onde ficam altura e largura
    let o = 2;
    while (o + 9 < b.length) {
      if (b[o] !== 0xff) return { mime: "image/jpeg" };
      const m = b[o + 1];
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { mime: "image/jpeg", height: dv.getUint16(o + 5), width: dv.getUint16(o + 7) };
      o += 2 + dv.getUint16(o + 2);
    }
    return { mime: "image/jpeg" };
  }
  if (b.length >= 2 && ascii(0, 2) === "BM") return { mime: "image/bmp", width: dv.getInt32(18, true), height: Math.abs(dv.getInt32(22, true)) };
  const head = new TextDecoder().decode(b.subarray(0, 2048));
  if (/<svg[\s>]/i.test(head)) {
    const tag = head.slice(head.search(/<svg[\s>]/i)).split(">")[0];
    const num = (a: string) => Number(new RegExp(`\\s${a}\\s*=\\s*["']?([\\d.]+)(px)?["'\\s]`, "i").exec(tag)?.[1]) || undefined;
    const vb = /viewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(tag);
    return { mime: "image/svg+xml", width: num("width") ?? (vb ? Number(vb[1]) : undefined), height: num("height") ?? (vb ? Number(vb[2]) : undefined) };
  }
  return undefined;
}

export const MAX_IMAGE_BYTES = 8e6;

/** Baixa a imagem e devolve o data URI com o tamanho em pixels (quando se consegue ler). */
export async function fetchImage(url: string): Promise<{ dataUri: string; mime: string; bytes: number; width?: number; height?: number }> {
  if (!/^https?:\/\//i.test(url)) throw new Error("url deve começar com http:// ou https://");
  const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "image/*,*/*;q=0.5" }, redirect: "follow", signal: AbortSignal.timeout(20_000) });
  if (!r.ok) throw new Error(`o site respondeu ${r.status} ao baixar a imagem`);
  const len = Number(r.headers.get("content-length") ?? 0);
  if (len > MAX_IMAGE_BYTES) throw new Error(`imagem grande demais (${(len / 1e6).toFixed(1)} MB; limite ${MAX_IMAGE_BYTES / 1e6} MB)`);
  const buf = new Uint8Array(await r.arrayBuffer());
  if (buf.length > MAX_IMAGE_BYTES) throw new Error(`imagem grande demais (${(buf.length / 1e6).toFixed(1)} MB; limite ${MAX_IMAGE_BYTES / 1e6} MB)`);
  const info = sniffImage(buf);
  if (!info) throw new Error(`a URL não devolveu uma imagem (content-type ${r.headers.get("content-type") ?? "?"}); use a URL direta do arquivo, não a da página`);
  return { dataUri: `data:${info.mime};base64,${Buffer.from(buf).toString("base64")}`, mime: info.mime, bytes: buf.length, width: info.width, height: info.height };
}

/** Tamanho da forma no quadro: a largura pedida (padrão 260) e a altura pela proporção da foto, mais a faixa da legenda (como em `brainGeometry`). */
export function imageFrame(width: number | undefined, px?: { width?: number; height?: number }) {
  const w = Math.round(Math.max(60, Math.min(1200, width ?? 260)));
  const ratio = px?.width && px?.height ? px.height / px.width : 0.72;
  const photoH = (w - 12) * Math.max(0.15, Math.min(4, ratio));
  return { w, h: Math.round(photoH + 6 + 34) };
}
