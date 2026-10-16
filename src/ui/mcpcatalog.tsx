import { useEffect, useMemo, useRef, useState } from "react";
import { MCP_CATALOG, parseMcpInput, searchMcpCatalog, type McpCatalogEntry } from "../shared/mcpcatalog";
import { NATIVE_TOOLS } from "../shared/schema";
import { ToolEditor } from "./agents";
import { Glyph } from "./icons";
import { applyMcpEntry, applyNativeTool, getState, plugTool, searchMcpRegistryApi, set, useStore } from "./store";

/** Uma linha resumindo como o servidor conecta. */
export const mcpSummary = (e: McpCatalogEntry) => (e.transport === "stdio" ? [e.command, ...(e.args ?? [])].filter(Boolean).join(" ") : e.url ?? "");

const ORIGIN: Record<McpCatalogEntry["origin"], string> = { curated: "curado", registry: "registro oficial", pasted: "colado" };

function McpCard({ e, current, onUse, onAdd }: { e: McpCatalogEntry; current: boolean; onUse: () => void; onAdd?: () => void }) {
  return (
    <li className={`skill-card${current ? " active" : ""}`}>
      <div className="skill-card-main" style={{ cursor: "default" }}>
        <span className="skill-cat-name">
          {e.name}
          <span className="skill-cat-tag">{ORIGIN[e.origin]}</span>
          {current && <span className="skill-cat-tag">em uso</span>}
        </span>
        <span className="skill-cat-repo">{mcpSummary(e)}</span>
        <span className="skill-cat-desc">{e.description}</span>
        {!!e.requiredVars?.length && (
          <span className="skill-cat-desc" style={{ opacity: 0.85 }}>
            Variáveis: {e.requiredVars.map((v) => <code key={v.name} title={v.hint} style={{ marginRight: 6 }}>{v.name}</code>)}
          </span>
        )}
        {e.note && <span className="skill-cat-desc" style={{ opacity: 0.85 }}>{e.note}</span>}
        {!!e.replacedSecrets?.length && <span className="skill-cat-desc" style={{ color: "var(--danger, #c0392b)" }}>Segredo em texto puro em {e.replacedSecrets.join(", ")}: trocado por variável de ambiente.</span>}
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button className="btn sm primary" disabled={current} onClick={onUse}>
          {current ? "Em uso" : "Usar neste servidor"}
        </button>
        {onAdd && (
          <button className="btn sm" onClick={onAdd}>
            Adicionar como novo
          </button>
        )}
      </div>
    </li>
  );
}

/**
 * Diálogo da Tool (mesmo esquema da Skill): buscar entre as tools nativas, o catálogo curado de servidores MCP e o
 * registro oficial; colar um `.mcp.json` / `claude mcp add`; ou configurar à mão. Aplica no nó Tool `id`.
 */
export function ToolModal({ id, tab: initial }: { id: string; tab?: "search" | "paste" | "manual" }) {
  const node = useStore((s) => s.doc.nodes.find((n) => n.id === id));
  const online = useStore((s) => s.storage === "server" && s.online);
  const [tab, setTab] = useState<"search" | "paste" | "manual">(initial ?? "search");
  const [query, setQuery] = useState("");
  const [remote, setRemote] = useState<McpCatalogEntry[]>([]);
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");
  const [err, setErr] = useState("");
  const [paste, setPaste] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const close = () => set({ modal: null });
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    return () => prev?.focus?.();
  }, []);

  const q = query.trim();
  useEffect(() => {
    if (!online || q.length < 2) return void (setRemote([]), setState("idle"));
    let stale = false;
    setState("loading");
    const t = setTimeout(() => {
      searchMcpRegistryApi(q).then(
        (r) => !stale && (setRemote(r.entries), setState("idle")),
        (e) => !stale && (setRemote([]), setErr(e instanceof Error ? e.message : String(e)), setState("error")),
      );
    }, 350);
    return () => ((stale = true), clearTimeout(t));
  }, [q, online]);

  const local = useMemo(() => searchMcpCatalog(query), [query]);
  const natives = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    return Object.entries(NATIVE_TOOLS).filter(([n, d]) => words.every((w) => `${n} ${d} nativa tool`.toLowerCase().includes(w)));
  }, [query]);
  const remoteOnly = remote.filter((r) => !MCP_CATALOG.some((c) => c.id === r.id || (c.url && c.url === r.url)));
  const parsed = useMemo(() => (paste.trim() ? parseMcpInput(paste) : undefined), [paste]);
  if (!node?.agent) return null;
  const current = (e: McpCatalogEntry) => node.agent?.mcpSource?.id === e.id && node.agent.mcpSource.catalog === e.origin;
  const use = (e: McpCatalogEntry) => {
    applyMcpEntry(id, e);
  };

  return (
    <div className="skill-scrim" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div ref={ref} className="skill-dialog" role="dialog" aria-modal="true" aria-labelledby="mcp-dialog-title" tabIndex={-1} onKeyDown={(e) => e.key === "Escape" && close()}>
        <header className="skill-dialog-head">
          <div className="skill-dialog-title">
            <span className="skill-dialog-kicker">Tool · {node.agent.toolType === "mcp" ? `MCP${node.agent.mcpSource ? ` · ${ORIGIN[node.agent.mcpSource.catalog]}` : ""}` : node.agent.toolType === "native" ? "nativa" : "vazia"}</span>
            <h2 id="mcp-dialog-title">{node.label || "Tool"}</h2>
          </div>
          <div className="skill-dialog-tabs" role="tablist" aria-label="Como escolher o servidor">
            <button role="tab" aria-selected={tab === "search"} className={tab === "search" ? "active" : ""} onClick={() => setTab("search")}>
              Buscar no catálogo
            </button>
            <button role="tab" aria-selected={tab === "paste"} className={tab === "paste" ? "active" : ""} onClick={() => setTab("paste")}>
              Colar config
            </button>
            <button role="tab" aria-selected={tab === "manual"} className={tab === "manual" ? "active" : ""} onClick={() => setTab("manual")}>
              Configurar
            </button>
          </div>
          <button className="btn ghost icon" onClick={close} aria-label="Fechar">
            <Glyph name="close" size={19} />
          </button>
        </header>
        <div className="skill-dialog-body">
          {tab === "search" ? (
            <div className="skill-cat-layout">
              <aside className="skill-cat-side">
                <input className="input skill-search" autoFocus value={query} placeholder="Buscar tool: bash, ler arquivos, navegador, github, banco de dados…" onChange={(e) => setQuery(e.target.value)} aria-label="Buscar tool ou servidor MCP" />
                <span className="skill-cat-count">
                  {natives.length} nativas · {local.length} do catálogo curado
                  {online ? (q.length < 2 ? " · digite 2+ letras para buscar também no registro oficial" : state === "loading" ? " · buscando no registro oficial…" : state === "error" ? ` · registro indisponível (${err})` : ` · ${remoteOnly.length} do registro oficial`) : " · registro oficial só com o servidor local (npm run dev)"}
                </span>
                {remoteOnly.length > 0 && <div className="callout warn">Os servidores do registro oficial são publicados por terceiros e o Archflow não os audita. Confira a origem antes de usar, principalmente os que pedem token.</div>}
                <ul className="skill-grid" aria-label="Tools e servidores MCP">
                  {natives.map(([name, desc]) => {
                    const here = node.agent?.toolType === "native" && node.agent.toolName === name;
                    return (
                      <li key={`n-${name}`} className={`skill-card${here ? " active" : ""}`}>
                        <div className="skill-card-main" style={{ cursor: "default" }}>
                          <span className="skill-cat-name">
                            {name}
                            <span className="skill-cat-tag">nativa</span>
                            {here && <span className="skill-cat-tag">em uso</span>}
                          </span>
                          <span className="skill-cat-desc">{desc}</span>
                        </div>
                        <button className="btn sm primary" disabled={here} onClick={() => applyNativeTool(id, name)}>
                          {here ? "Em uso" : "Usar esta tool"}
                        </button>
                      </li>
                    );
                  })}
                  {local.map((e) => (
                    <McpCard key={`c-${e.id}`} e={e} current={current(e)} onUse={() => use(e)} onAdd={() => plugTool({ entry: e })} />
                  ))}
                  {remoteOnly.map((e) => (
                    <McpCard key={`r-${e.id}`} e={e} current={current(e)} onUse={() => use(e)} onAdd={() => plugTool({ entry: e })} />
                  ))}
                </ul>
                {!natives.length && !local.length && !remoteOnly.length && state !== "loading" && <div className="callout">Nada encontrado para «{query}». Cole a config do servidor na aba «Colar config».</div>}
              </aside>
            </div>
          ) : tab === "manual" ? (
            <div className="skill-cat-layout" style={{ overflow: "auto" }}>
              <ToolEditor node={node} />
            </div>
          ) : (
            <div className="skill-cat-layout">
              <label className="field" style={{ flex: "0 0 auto" }}>
                <span>Cole um <code>.mcp.json</code>, um trecho <code>{'"nome": { … }'}</code> ou um comando <code>claude mcp add …</code></span>
                <textarea className="input" rows={8} autoFocus value={paste} onChange={(e) => setPaste(e.target.value)} placeholder={'claude mcp add --transport http github https://api.githubcopilot.com/mcp/\n\nou\n\n{ "mcpServers": { "pw": { "command": "npx", "args": ["-y", "@playwright/mcp@latest"] } } }'} style={{ fontFamily: "ui-monospace, Consolas, monospace" }} />
              </label>
              {parsed?.error && <div className="callout warn">{parsed.error}</div>}
              {!!parsed?.entries.length && (
                <ul className="skill-grid" aria-label="Servidores reconhecidos">
                  {parsed.entries.map((e, i) => (
                    <McpCard key={e.id} e={e} current={false} onUse={() => use(e)} onAdd={i === 0 && parsed.entries.length === 1 ? undefined : () => plugTool({ entry: e })} />
                  ))}
                </ul>
              )}
              <div className="callout">Segredos em texto puro (token, chave, senha) são trocados por <code>{"${VARIÁVEL}"}</code> antes de entrar no diagrama.</div>
            </div>
          )}
        </div>
        <footer className="skill-dialog-foot">
          <span className="skill-dialog-note">As mudanças são salvas no diagrama. O servidor MCP é gravado no <code>.mcp.json</code> do projeto quando a Tool está ligada a um agente (ou no Global). Na primeira vez, o Claude Code pede para você <b>aprovar</b> o servidor (e, se ele ficar inline num agente, para <b>confiar na pasta</b>); o pacote é baixado na primeira execução.</span>
          <button className="btn primary" onClick={close}>
            Concluir
          </button>
        </footer>
      </div>
    </div>
  );
}

/** Modo agents: servidores MCP curados prontos para arrastar sobre um agent (ou clicar com o agent selecionado). */
export function CatalogMcp({ q }: { q: string }) {
  const doc = useStore((s) => s.doc);
  const sel = useStore((s) => s.sel);
  const agent = sel.length === 1 ? doc.nodes.find((n) => n.id === sel[0] && n.agent?.role === "agent") : undefined;
  const list = searchMcpCatalog(q);
  const usedBy = (e: McpCatalogEntry) => {
    const node = doc.nodes.find((n) => n.agent?.mcpSource?.id === e.id);
    return node ? doc.connections.filter((c) => c.to === node.id && c.agent?.rel === "uses-tool").length : -1;
  };
  const add = (e: McpCatalogEntry) => {
    if (agent) return plugTool({ entry: e, agentId: agent.id });
    const st = getState();
    plugTool({ entry: e, x: (window.innerWidth / 2 - st.view.x) / st.view.z - 92, y: (window.innerHeight / 2 - st.view.y) / st.view.z - 36 });
  };
  return (
    <section>
      <div className="lib-cat">Servidores MCP do catálogo</div>
      <div className="lib-hint">{agent ? `Clique para plugar em ${agent.label}, ou arraste sobre outro agent.` : "Arraste sobre um agent para plugar, ou sobre o grupo global para todos."}</div>
      {list.map((e) => {
        const n = usedBy(e);
        return (
          <div
            key={e.id}
            className="asset"
            draggable
            onDragStart={(ev) => {
              ev.dataTransfer.setData("application/x-archflow-mcp", e.id);
              ev.dataTransfer.effectAllowed = "copy";
            }}
            onClick={() => add(e)}
            role="button"
            tabIndex={0}
            onKeyDown={(ev) => ev.key === "Enter" && add(e)}
            data-tip={mcpSummary(e)}
            data-tip-pos="right"
          >
            <div className="meta">
              <div className="name">
                {e.name}
                {n >= 0 && <span className="lib-used">{n ? `${n} agent${n > 1 ? "s" : ""}` : "no quadro"}</span>}
              </div>
              <div className="desc">{e.description}</div>
            </div>
          </div>
        );
      })}
      {!list.length && <div className="empty">Nenhum servidor curado para «{q}». Adicione uma Tool MCP e use «Buscar no catálogo» para procurar no registro oficial.</div>}
    </section>
  );
}
