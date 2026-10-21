/**
 * Zip mínimo, sem dependência: só o método `store` (sem compressão), que é o bastante para o harness
 * (uns poucos arquivos de markdown) e roda igual no navegador e no Node.
 *
 * Formato: para cada arquivo um local file header + conteúdo; no fim, o diretório central e o EOCD.
 * Nomes vão em UTF-8 (bit 11 do flag), como o unzip, o Explorer do Windows e o Finder esperam.
 */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Data/hora no formato MS-DOS que o zip usa (segundos com resolução de 2). */
function dosTime(d: Date): { time: number; date: number } {
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (Math.floor(d.getSeconds() / 2) & 0x1f),
    date: ((Math.max(1980, d.getFullYear()) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

class Writer {
  private parts: Uint8Array[] = [];
  length = 0;
  push(bytes: Uint8Array) {
    this.parts.push(bytes);
    this.length += bytes.length;
  }
  u16(n: number) {
    this.push(new Uint8Array([n & 0xff, (n >>> 8) & 0xff]));
  }
  u32(n: number) {
    this.push(new Uint8Array([n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff]));
  }
  concat(): Uint8Array {
    const out = new Uint8Array(this.length);
    let at = 0;
    for (const p of this.parts) {
      out.set(p, at);
      at += p.length;
    }
    return out;
  }
}

export interface ZipEntry {
  /** caminho dentro do zip, com "/" (ex.: ".claude/agents/revisor.md") */
  path: string;
  /** texto (UTF-8) ou bytes já prontos, como os de um arquivo binário */
  content: string | Uint8Array;
}

/** Monta o zip. `at` fixa a data dos arquivos (útil em teste). */
export function zip(entries: ZipEntry[], at = new Date()): Uint8Array {
  const { time, date } = dosTime(at);
  const enc = new TextEncoder();
  const body = new Writer();
  const dir = new Writer();
  for (const e of entries) {
    const name = enc.encode(e.path);
    const data = typeof e.content === "string" ? enc.encode(e.content) : e.content;
    const sum = crc32(data);
    const offset = body.length;
    for (const w of [body, dir]) {
      if (w === dir) {
        w.u32(0x02014b50); // central file header
        w.u16(0x031e); // feito em unix, zip 3.0
      } else w.u32(0x04034b50); // local file header
      w.u16(20); // versão necessária
      w.u16(0x0800); // nomes em UTF-8
      w.u16(0); // método: store
      w.u16(time);
      w.u16(date);
      w.u32(sum);
      w.u32(data.length);
      w.u32(data.length);
      w.u16(name.length);
      w.u16(0); // extra
      if (w === dir) {
        w.u16(0); // comentário
        w.u16(0); // disco
        w.u16(0); // atributos internos
        w.u32(0); // atributos externos
        w.u32(offset);
      }
      w.push(name);
    }
    body.push(data);
  }
  const out = new Writer();
  out.push(body.concat());
  const dirBytes = dir.concat();
  out.push(dirBytes);
  out.u32(0x06054b50); // EOCD
  out.u16(0);
  out.u16(0);
  out.u16(entries.length);
  out.u16(entries.length);
  out.u32(dirBytes.length);
  out.u32(body.length);
  out.u16(0);
  return out.concat();
}
