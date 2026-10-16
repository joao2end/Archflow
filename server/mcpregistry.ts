/**
 * Busca no registro oficial de servidores MCP (registry.modelcontextprotocol.io), feita pelo bridge para não
 * esbarrar em CORS no navegador. O registro devolve vários resultados por servidor; pedimos só a versão mais recente
 * e convertemos cada um em entrada do catálogo (`registryServerToEntry`). Os que não têm como conectar são descartados.
 */
import { registryServerToEntry, type McpCatalogEntry } from "../src/shared/mcpcatalog";

const REGISTRY = "https://registry.modelcontextprotocol.io/v0/servers";
const TTL = 5 * 60_000;
const cache = new Map<string, { at: number; entries: McpCatalogEntry[] }>();

export function clearMcpRegistryCache() {
  cache.clear();
}

export async function searchMcpRegistry(q: unknown, fetchImpl: typeof fetch = fetch): Promise<{ entries: McpCatalogEntry[] }> {
  const query = String(q ?? "").trim().slice(0, 100);
  if (query.length < 2) return { entries: [] };
  const hit = cache.get(query.toLowerCase());
  if (hit && Date.now() - hit.at < TTL) return { entries: hit.entries };
  let res: Response;
  try {
    res = await fetchImpl(`${REGISTRY}?search=${encodeURIComponent(query)}&version=latest&limit=30`, { signal: AbortSignal.timeout(15_000), headers: { Accept: "application/json" } });
  } catch (e) {
    throw new Error(`não deu para consultar o registro MCP: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!res.ok) throw new Error(`o registro MCP respondeu ${res.status}`);
  let json: { servers?: { server?: unknown }[] };
  try {
    json = (await res.json()) as typeof json;
  } catch {
    throw new Error("o registro MCP devolveu uma resposta que não é JSON");
  }
  const seen = new Set<string>();
  const entries: McpCatalogEntry[] = [];
  for (const item of json.servers ?? []) {
    const e = registryServerToEntry(item?.server);
    if (!e) continue;
    let id = e.id;
    for (let n = 2; seen.has(id); n++) id = `${e.id}-${n}`;
    seen.add(id);
    entries.push(id === e.id ? e : { ...e, id });
  }
  cache.set(query.toLowerCase(), { at: Date.now(), entries });
  return { entries };
}
