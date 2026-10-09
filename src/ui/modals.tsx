import { useEffect, useRef, useState, type ReactNode } from "react";
import { ASSET_CATEGORIES } from "../shared/catalog";
import { describe, schemaGuide, toMermaid } from "../shared/ops";
import { NODE_KINDS, type Asset, type InterfaceKind, type InterfaceOperation, type InterfaceSpec, type NodeKind } from "../shared/schema";
import { AssetBadge, Glyph } from "./icons";
import { FolderModal, QuickSwitcher, VaultsModal } from "./files";
import { DiagramViewer } from "./viewer";
import { allKnownAssets, getState, lookupAsset, newAssetId, run, saveAsset, set, toast, useStore } from "./store";

function Modal({ title, onClose, children, foot, wide }: { title: string; onClose: () => void; children: ReactNode; foot?: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>("input,textarea,select,button.primary")?.focus();
    return () => prev?.focus?.();
  }, []);
  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} className={`glass modal ${wide ? "wide" : ""}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="btn ghost icon" onClick={onClose} aria-label="Fechar">
            <Glyph name="close" size={19} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {foot && <div className="modal-foot">{foot}</div>}
      </div>
    </div>
  );
}

const close = () => set({ modal: null });

/* ───────── asset ───────── */

function resizeImage(file: File, max = 96): Promise<string> {
  return new Promise((ok, fail) => {
    const fr = new FileReader();
    fr.onerror = () => fail(new Error("leitura falhou"));
    fr.onload = () => {
      const src = String(fr.result);
      if (file.type === "image/svg+xml") return ok(src);
      const img = new Image();
      img.onload = () => {
        const k = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement("canvas");
        c.width = Math.round(img.width * k);
        c.height = Math.round(img.height * k);
        c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
        ok(c.toDataURL("image/png"));
      };
      img.onerror = () => fail(new Error("imagem inválida"));
      img.src = src;
    };
    fr.readAsDataURL(file);
  });
}

function AssetModal({ id }: { id?: string }) {
  const existing = id ? lookupAsset(id) : undefined;
  const [a, setA] = useState<Asset>(
    existing ?? { id: "", name: "", category: "Personalizados", kind: "service", icon: "", color: "#706fd3", problem: "", description: "", tags: [] },
  );
  const [tags, setTags] = useState(a.tags.join(", "));
  const [err, setErr] = useState("");
  const up = (p: Partial<Asset>) => setA((x) => ({ ...x, ...p }));
  const cats = Array.from(new Set(["Personalizados", ...ASSET_CATEGORIES, ...allKnownAssets().map((x) => x.category)]));
  const icon = a.icon || `t:${a.name.slice(0, 3).toUpperCase() || "?"}`;

  const save = () => {
    if (!a.name.trim()) return setErr("Dê um nome ao asset.");
    if (!a.problem.trim()) return setErr("Descreva o problema que ele resolve — é o que ajuda humanos e LLMs a escolher.");
    saveAsset({ ...a, id: a.id || newAssetId(a.name), name: a.name.trim(), icon, tags: tags.split(",").map((t) => t.trim()).filter(Boolean), builtin: undefined });
    toast("Asset salvo na biblioteca");
    close();
  };

  return (
    <Modal
      title={existing ? "Editar asset" : "Novo asset"}
      onClose={close}
      foot={
        <>
          <span style={{ color: "var(--danger)", marginRight: "auto", alignSelf: "center" }}>{err}</span>
          <button className="btn" onClick={close}>
            Cancelar
          </button>
          <button className="btn primary" onClick={save}>
            Salvar
          </button>
        </>
      }
    >
      <div style={{ display: "flex", gap: 16, alignItems: "center", marginBottom: 16 }}>
        <AssetBadge asset={{ icon, color: a.color, name: a.name || "?" }} size={72} />
        <div style={{ flex: 1 }}>
          <label className="field" style={{ marginBottom: 8 }}>
            <span>Ícone</span>
            <div style={{ display: "flex", gap: 8 }}>
              <label className="btn sm" style={{ cursor: "pointer" }}>
                <Glyph name="upload" size={15} /> Enviar imagem
                <input
                  type="file"
                  accept="image/*"
                  hidden
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    if (!f) return;
                    try {
                      up({ icon: await resizeImage(f) });
                    } catch (er) {
                      setErr(String(er));
                    }
                  }}
                />
              </label>
              <input className="input" placeholder="…ou cole uma URL (https://…) / texto: t:API" value={a.icon.startsWith("data:") ? "(imagem enviada)" : a.icon} onChange={(e) => up({ icon: e.target.value })} />
            </div>
          </label>
        </div>
      </div>
      <div className="grid2">
        <label className="field">
          <span>Nome *</span>
          <input className="input" value={a.name} onChange={(e) => up({ name: e.target.value })} placeholder="ex.: Billing Service" />
        </label>
        <label className="field">
          <span>Categoria</span>
          <input className="input" list="cats" value={a.category} onChange={(e) => up({ category: e.target.value })} />
          <datalist id="cats">
            {cats.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </label>
        <label className="field">
          <span>Papel padrão</span>
          <select className="input" value={a.kind} onChange={(e) => up({ kind: e.target.value as NodeKind })}>
            {Object.entries(NODE_KINDS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Cor</span>
          <input className="input" type="color" value={a.color} onChange={(e) => up({ color: e.target.value })} style={{ padding: 3, height: 38 }} />
        </label>
      </div>
      <label className="field">
        <span>Que problema resolve? *</span>
        <textarea className="input" rows={2} value={a.problem} onChange={(e) => up({ problem: e.target.value })} placeholder="ex.: Centraliza cobrança e conciliação, evitando lógica de pagamento espalhada." />
      </label>
      <label className="field">
        <span>Quando usar / detalhes</span>
        <textarea className="input" rows={2} value={a.description} onChange={(e) => up({ description: e.target.value })} />
      </label>
      <label className="field">
        <span>Tags (separadas por vírgula)</span>
        <input className="input" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="pagamentos, financeiro" />
      </label>
    </Modal>
  );
}

/* ───────── interface (contrato) ───────── */

const IFACE_KINDS: Record<InterfaceKind, string> = { rest: "REST / HTTP", graphql: "GraphQL", grpc: "gRPC", event: "Evento / mensagem", sql: "SQL / dados", websocket: "WebSocket / stream", file: "Arquivo / batch", custom: "Outro" };
const METHODS: Record<InterfaceKind, string[]> = { rest: ["GET", "POST", "PUT", "PATCH", "DELETE"], graphql: ["query", "mutation", "subscription"], grpc: ["unary", "server-stream", "client-stream", "bidi"], event: ["PUBLISH", "SUBSCRIBE"], sql: ["SELECT", "INSERT", "UPDATE", "DELETE"], websocket: ["SEND", "RECEIVE"], file: ["READ", "WRITE"], custom: [] };

function InterfaceModal({ id }: { id: string }) {
  const conn = getState().doc.connections.find((c) => c.id === id);
  const [spec, setSpec] = useState<InterfaceSpec>(
    conn?.interface ?? { name: "", kind: conn?.type === "async" ? "event" : conn?.type === "data" ? "sql" : "rest", operations: [{ name: "" }] },
  );
  if (!conn) return null;
  const upOp = (i: number, p: Partial<InterfaceOperation>) => setSpec((s) => ({ ...s, operations: s.operations.map((o, j) => (j === i ? { ...o, ...p } : o)) }));
  const from = getState().doc.nodes.find((n) => n.id === conn.from)?.label ?? conn.from;
  const to = getState().doc.nodes.find((n) => n.id === conn.to)?.label ?? conn.to;
  const placeholder = spec.kind === "rest" ? ["createOrder", "/orders", '{ items: [{ sku, qty }] }', "201 { orderId, status }"] : spec.kind === "event" ? ["OrderCreated", "order-events", "{ orderId, total }", "(sem resposta)"] : ["operação", "caminho / tópico / tabela", "entrada", "saída"];

  const save = (remove = false) => {
    const ops = spec.operations.filter((o) => o.name.trim());
    run([{ op: "update", id, patch: { interface: remove ? undefined : { ...spec, name: spec.name || `${from} → ${to}`, operations: ops } } }]);
    close();
  };

  return (
    <Modal
      wide
      title="Interface de comunicação"
      onClose={close}
      foot={
        <>
          {conn.interface && (
            <button className="btn danger" style={{ marginRight: "auto" }} onClick={() => save(true)}>
              Remover interface
            </button>
          )}
          <button className="btn" onClick={close}>
            Cancelar
          </button>
          <button className="btn primary" onClick={() => save()}>
            Salvar interface
          </button>
        </>
      }
    >
      <p style={{ color: "var(--ink-2)", marginTop: 0 }}>
        Contrato entre <b>{from}</b> e <b>{to}</b>. Quanto mais explícito, melhor um agente entende — e implementa — a integração.
      </p>
      <div className="grid2">
        <label className="field">
          <span>Nome da interface</span>
          <input className="input" value={spec.name} onChange={(e) => setSpec({ ...spec, name: e.target.value })} placeholder="Orders API v1" />
        </label>
        <label className="field">
          <span>Estilo</span>
          <select className="input" value={spec.kind} onChange={(e) => setSpec({ ...spec, kind: e.target.value as InterfaceKind })}>
            {Object.entries(IFACE_KINDS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="field">
        <span>Contrato formal (OpenAPI / AsyncAPI / .proto)</span>
        <input className="input" value={spec.contract ?? ""} onChange={(e) => setSpec({ ...spec, contract: e.target.value || undefined })} placeholder="./openapi/orders.yaml" />
      </label>
      <div className="ops-table">
        {spec.operations.map((o, i) => (
          <div className="op-card" key={i}>
            <div className="grid2">
              <label className="field">
                <span>Operação</span>
                <input className="input" value={o.name} placeholder={placeholder[0]} onChange={(e) => upOp(i, { name: e.target.value })} />
              </label>
              <div className="grid2">
                <label className="field">
                  <span>Método</span>
                  <input className="input" list={`m-${spec.kind}`} value={o.method ?? ""} onChange={(e) => upOp(i, { method: e.target.value || undefined })} />
                  <datalist id={`m-${spec.kind}`}>
                    {METHODS[spec.kind].map((m) => (
                      <option key={m} value={m} />
                    ))}
                  </datalist>
                </label>
                <label className="field">
                  <span>Caminho / tópico</span>
                  <input className="input" value={o.path ?? ""} placeholder={placeholder[1]} onChange={(e) => upOp(i, { path: e.target.value || undefined })} />
                </label>
              </div>
              <label className="field">
                <span>Entrada (payload)</span>
                <input className="input" value={o.request ?? ""} placeholder={placeholder[2]} onChange={(e) => upOp(i, { request: e.target.value || undefined })} />
              </label>
              <label className="field">
                <span>Saída</span>
                <input className="input" value={o.response ?? ""} placeholder={placeholder[3]} onChange={(e) => upOp(i, { response: e.target.value || undefined })} />
              </label>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <input className="input" value={o.description ?? ""} placeholder="Regra de negócio, erros, idempotência…" onChange={(e) => upOp(i, { description: e.target.value || undefined })} />
              <button className="btn ghost icon" aria-label="Remover operação" onClick={() => setSpec((s) => ({ ...s, operations: s.operations.filter((_, j) => j !== i) }))}>
                <Glyph name="trash" size={17} />
              </button>
            </div>
          </div>
        ))}
      </div>
      <button className="btn sm" style={{ marginTop: 10 }} onClick={() => setSpec((s) => ({ ...s, operations: [...s.operations, { name: "" }] }))}>
        <Glyph name="plus" size={15} /> Adicionar operação
      </button>
    </Modal>
  );
}

/* ───────── visão LLM ───────── */

function LlmModal() {
  const doc = useStore((s) => s.doc);
  const [tab, setTab] = useState<"md" | "mermaid" | "json" | "guide">("md");
  const text = tab === "md" ? describe(doc) : tab === "mermaid" ? toMermaid(doc) : tab === "json" ? JSON.stringify(doc, null, 2) : schemaGuide();
  const tabs: [typeof tab, string][] = [["md", "Markdown"], ["mermaid", "Mermaid"], ["json", "JSON"], ["guide", "Guia do schema"]];
  return (
    <Modal
      wide
      title="Como um LLM enxerga este diagrama"
      onClose={close}
      foot={
        <button
          className="btn primary"
          onClick={() => navigator.clipboard.writeText(text).then(() => toast("Copiado para a área de transferência"))}
        >
          <Glyph name="copy" size={16} /> Copiar
        </button>
      }
    >
      <p style={{ color: "var(--ink-2)", marginTop: 0 }}>Sem coordenadas, sem ruído visual: ids semânticos, relações explícitas e o papel de cada tecnologia. Cole no seu chat ou use o MCP.</p>
      <div className="tabs seg" role="tablist">
        {tabs.map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? "active" : ""} onClick={() => setTab(k)}>
            {l}
          </button>
        ))}
      </div>
      <pre className="code">{text}</pre>
    </Modal>
  );
}

/* ───────── MCP ───────── */

function McpModal() {
  const online = useStore((s) => s.online);
  const storage = useStore((s) => s.storage);
  const [root, setRoot] = useState("C:/caminho/do/projeto");
  const cfg = JSON.stringify({ mcpServers: { archflow: { command: "npx", args: ["tsx", `${root}/server/mcp.ts`], cwd: root } } }, null, 2);
  const cli = `claude mcp add archflow --cwd "${root}" -- npx tsx server/mcp.ts`;
  const copy = (t: string) => navigator.clipboard.writeText(t).then(() => toast("Copiado"));
  return (
    <Modal wide title="Conectar um agente (MCP)" onClose={close}>
      {storage === "local" && (
        <div className="callout warn-soft">
          <b>Indisponível no modo navegador.</b> Agentes MCP editam o diagrama pelo servidor local, que não está rodando — por isso seus dados estão na memória deste navegador. Rode <code>npm run dev</code> na pasta do projeto e recarregue a página para ativar o MCP.
        </div>
      )}
      <p className={`status ${online && storage === "server" ? "on" : ""}`} style={{ display: "inline-flex" }}>
        <span className="dot" /> {online && storage === "server" ? "Servidor ativo — as mudanças do agente aparecem aqui em tempo real" : "Servidor local desligado — será iniciado pelo servidor MCP ou por npm run dev"}
      </p>
      <ol className="steps">
        <li>
          Informe a pasta do projeto:{" "}
          <input className="input" style={{ display: "inline-block", width: 320 }} value={root} onChange={(e) => setRoot(e.target.value.replace(/\\/g, "/"))} />
        </li>
        <li>
          <b>Claude Code:</b> rode no terminal
          <pre className="code" style={{ marginTop: 6 }}>{cli}</pre>
          <button className="btn sm" onClick={() => copy(cli)}>
            <Glyph name="copy" size={14} /> Copiar
          </button>
        </li>
        <li>
          <b>Claude Desktop</b> (claude_desktop_config.json) ou outro cliente MCP:
          <pre className="code" style={{ marginTop: 6 }}>{cfg}</pre>
          <button className="btn sm" onClick={() => copy(cfg)}>
            <Glyph name="copy" size={14} /> Copiar
          </button>
        </li>
        <li>
          Mantenha esta página aberta e peça: <i>“Use o archflow para desenhar uma arquitetura de pedidos com Laravel, Postgres e SQS.”</i>
        </li>
      </ol>
      <div className="callout">
        <b>Ferramentas:</b> get_schema_guide · search_assets · get_diagram · add_components · add_groups · connect · update_element · remove_elements · add_note · add_asset · auto_layout · set_diagram_info · validate_diagram · clear_diagram. <br />
        <b>Recursos:</b> archflow://diagram · archflow://schema. O protocolo completo está em <code>docs/PROTOCOL.md</code>.
      </div>
    </Modal>
  );
}

/* ───────── ajuda ───────── */

function HelpModal() {
  const rows: [string, string][] = [
    ["V", "Selecionar"], ["H / Espaço", "Mover tela"], ["G", "Grupo"], ["C", "Conector"], ["N", "Nota"], ["B", "Biblioteca"], ["/", "Buscar asset"],
    ["L / Shift+L", "Auto-layout horizontal / vertical"], ["F", "Ajustar à tela"], ["A", "Animações on/off"], ["Ctrl+Z / Y", "Desfazer / refazer"],
    ["T", "Alternar tema (auto/claro/escuro)"], ["Ctrl+D", "Duplicar"], ["Ctrl+O", "Busca rápida de diagramas"], ["E", "Explorador de arquivos (cofre)"], ["Ctrl+A", "Selecionar tudo"], ["Del", "Excluir"], ["Duplo clique", "Renomear · editar interface"], ["Shift+clique", "Selecionar vários"], ["Ctrl+roda", "Zoom"], ["Esc", "Cancelar / fechar"],
  ];
  return (
    <Modal title="Atalhos e dicas" onClose={close}>
      <div className="help-grid">
        {rows.map(([k, v]) => (
          <div key={k}>
            <span>{v}</span>
            <span className="kbd">{k}</span>
          </div>
        ))}
      </div>
      <p className="callout" style={{ marginTop: 16 }}>
        <b>Conectar:</b> passe o mouse sobre um componente e arraste de um dos pontos “+” até outro. O tipo vem da barra inferior (assíncrona, dados, herança UML…). <b>Agrupar:</b> arraste um componente para dentro de um grupo.
      </p>
    </Modal>
  );
}

export function Modals() {
  const m = useStore((s) => s.modal);
  if (!m) return null;
  switch (m.type) {
    case "asset":
      return <AssetModal key={m.id ?? "new"} id={m.id} />;
    case "interface":
      return <InterfaceModal key={m.id} id={m.id} />;
    case "llm":
      return <LlmModal />;
    case "mcp":
      return <McpModal />;
    case "help":
      return <HelpModal />;
    case "vaults":
      return <VaultsModal />;
    case "quick":
      return <QuickSwitcher />;
    case "diagram-view":
      return <DiagramViewer key={m.diagram + (m.node ?? "")} diagram={m.diagram} node={m.node} />;
    case "folder":
      return <FolderModal key={m.purpose + (m.name ?? "")} purpose={m.purpose} name={m.name} />;
  }
}
