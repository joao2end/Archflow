/**
 * Traduz a saída `--output-format stream-json --verbose` do `claude -p` (uma linha JSON por evento) em texto legível para o
 * terminal. Sem isso um passo automático de workflow fica mudo até o fim: o `-p` em texto só imprime a resposta final.
 *
 * Puro e sem I/O: `createStreamFormatter()` devolve uma função que recebe pedaços do PTY (que podem cortar uma linha ao meio)
 * e devolve o texto a exibir, com `\r\n` e cores ANSI. Linha que não é JSON passa direto (avisos e erros do próprio claude).
 */

const DIM = "\x1b[2m";
const RESET = "\x1b[0m";
const CYAN = "\x1b[36m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";

const KEYS = ["file_path", "path", "command", "pattern", "url", "query", "description", "prompt", "subagent_type", "skill"];

const clip = (s: string, n: number) => {
  const one = s.replace(/\s+/g, " ").trim();
  return one.length > n ? `${one.slice(0, n - 1)}…` : one;
};

/** Resumo de uma linha dos argumentos de uma tool: o primeiro campo conhecido, senão o JSON cortado. */
export function summarizeInput(input: unknown): string {
  if (!input || typeof input !== "object") return "";
  const o = input as Record<string, unknown>;
  for (const k of KEYS) if (typeof o[k] === "string" && o[k]) return clip(o[k] as string, 100);
  const j = JSON.stringify(o);
  return j === "{}" ? "" : clip(j, 100);
}

const crlf = (s: string) => s.replace(/\r?\n/g, "\r\n");

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((c) => (c && typeof c === "object" && typeof (c as { text?: unknown }).text === "string" ? (c as { text: string }).text : "")).join(" ");
  return "";
}

/** Uma linha de evento já parseada → texto (vazio quando o evento não interessa). */
export function formatEvent(ev: Record<string, unknown>): string {
  const type = ev.type;
  if (type === "system" && ev.subtype === "init") return `${DIM}sessão iniciada${typeof ev.model === "string" ? ` · ${ev.model}` : ""}${RESET}\r\n`;
  if (type === "assistant" || type === "user") {
    const content = (ev.message as { content?: unknown } | undefined)?.content;
    if (!Array.isArray(content)) return "";
    let out = "";
    for (const b of content as Record<string, unknown>[]) {
      if (b.type === "text" && typeof b.text === "string" && b.text.trim()) out += `${crlf(b.text.trim())}\r\n`;
      else if (b.type === "tool_use") out += `${CYAN}● ${String(b.name)}${RESET}${DIM}(${summarizeInput(b.input)})${RESET}\r\n`;
      else if (b.type === "tool_result") {
        const t = clip(textOf(b.content), 140);
        const bad = b.is_error === true;
        out += `${bad ? RED : DIM}  ⎿ ${bad ? "erro: " : ""}${t || "(sem saída)"}${RESET}\r\n`;
      }
    }
    return out;
  }
  if (type === "result") {
    const secs = typeof ev.duration_ms === "number" ? ` em ${Math.round(ev.duration_ms / 1000)}s` : "";
    const cost = typeof ev.total_cost_usd === "number" ? ` · US$ ${ev.total_cost_usd.toFixed(2)}` : "";
    const bad = ev.is_error === true || (typeof ev.subtype === "string" && ev.subtype !== "success");
    const head = bad ? `${RED}✗ falhou${secs}${cost}${RESET}` : `${GREEN}✓ concluído${secs}${cost}${RESET}`;
    return `${head}\r\n${bad && typeof ev.result === "string" ? `${RED}${crlf(ev.result)}${RESET}\r\n` : ""}`;
  }
  return "";
}

export function createStreamFormatter(): (chunk: string) => string {
  let buf = "";
  const line = (raw: string): string => {
    const l = raw.replace(/\r$/, "");
    if (!l.trim()) return "";
    if (l.startsWith("{")) {
      try {
        const ev = JSON.parse(l);
        if (ev && typeof ev === "object") return formatEvent(ev as Record<string, unknown>);
      } catch {
        /* não era JSON inteiro: mostra como veio */
      }
    }
    return `${l}\r\n`;
  };
  return (chunk) => {
    buf += chunk;
    const parts = buf.split("\n");
    buf = parts.pop() ?? "";
    // linha gigante sem quebra (não deveria acontecer): não deixa o buffer crescer sem limite
    if (buf.length > 1_000_000) {
      const out = parts.map(line).join("") + buf + "\r\n";
      buf = "";
      return out;
    }
    return parts.map(line).join("");
  };
}
