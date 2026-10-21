/**
 * Arquivos do modo agents: nós `file` (referências lidas pelos agentes) e `output` (componente de saída, como o
 * nó de response do n8n, com o formato e o arquivo que um agente entrega; opcionalmente traz um modelo).
 *
 * Sem I/O: o conteúdo já vem no nó (texto, ou base64 para planilha e imagem). Quem grava no disco é o harness.
 */
import { AGENT_FILE_KINDS, type AgentFileKind, type AgentNodeSpec } from "./schema";

const EXT_KIND: Record<string, AgentFileKind> = {
  json: "json",
  csv: "csv",
  xlsx: "xlsx",
  md: "md",
  markdown: "md",
  html: "html",
  htm: "html",
  png: "image",
  jpg: "image",
  jpeg: "image",
  gif: "image",
  webp: "image",
  svg: "image",
  bmp: "image",
};
const IMAGE_EXTS = Object.keys(EXT_KIND).filter((e) => EXT_KIND[e] === "image");
const MIME: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml", bmp: "image/bmp" };

/** Extensão do nome, em minúsculas (sem o ponto). Vazia quando não há. */
export const extOf = (name: string | undefined) => (name && name.includes(".") ? name.slice(name.lastIndexOf(".") + 1).trim().toLowerCase() : "");

/** Formato pelo nome do arquivo; undefined quando a extensão não é suportada. */
export const kindOfFileName = (name: string) => EXT_KIND[extOf(name)];

/** Extensão que o arquivo leva no harness: a do formato (imagem mantém a sua, se for de imagem). */
export function fileExt(spec: Pick<AgentNodeSpec, "fileKind" | "fileName">): string {
  const kind = spec.fileKind ?? "json";
  if (kind === "image") {
    const e = extOf(spec.fileName);
    return IMAGE_EXTS.includes(e) ? e : AGENT_FILE_KINDS.image.ext;
  }
  return AGENT_FILE_KINDS[kind].ext;
}

/** MIME para exibir o conteúdo de uma imagem no formulário (data URL). */
export const imageMime = (name: string | undefined) => MIME[extOf(name)] ?? "image/png";

/** Caminho de saída seguro: relativo à raiz do projeto, sem `..`, sem barra inicial nem unidade de disco. Mensagem de erro ou undefined. */
export function outputPathError(path: string): string | undefined {
  if (!path.trim()) return "fileName vazio: diga o nome do arquivo de saída (ex.: relatorio.md)";
  if (path.startsWith("/") || path.startsWith("\\") || /^[A-Za-z]:/.test(path)) return `fileName "${path}" deve ser relativo à raiz do projeto (sem / inicial nem unidade de disco)`;
  if (path.split(/[\/]/).includes("..")) return `fileName "${path}" não pode subir de pasta com ".."`;
  return undefined;
}
