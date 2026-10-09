import { useEffect, useState } from "react";
import { ENDPOINT_PROTOCOLS, endpointBadge, endpointColor, endpointLabel, type EndpointProtocol, type EndpointSpec, type NodeEl } from "../shared/schema";
import { Glyph } from "./icons";
import { TextField } from "./panels";
import { fetchOutline, openRef, openViewer, run, select, useStore, type Outline } from "./store";

type Patch = (p: Record<string, unknown>) => void;

const PATH_LABEL: Record<EndpointProtocol, [string, string]> = {
  rest: ["Caminho", "/orders/{id}"],
  graphql: ["Operação / campo", "orders(id: ID!)"],
  websocket: ["Canal / caminho", "/ws/orders"],
  grpc: ["Serviço/Método", "OrderService/GetOrder"],
  webhook: ["Caminho que recebe", "/webhooks/stripe"],
  sse: ["Caminho do stream", "/events"],
  event: ["Tópico", "order.created"],
};

/** Pequeno selo colorido igual ao do canvas. */
export function EpBadge({ e }: { e: EndpointSpec }) {
  return (
    <span className="ep-pill" style={{ background: endpointColor(e) }}>
      {endpointBadge(e)}
    </span>
  );
}

/* ───────── formulário de um endpoint ───────── */

export function EndpointFields({ node, patch }: { node: NodeEl; patch: Patch }) {
  const doc = useStore((s) => s.doc);
  const e: EndpointSpec = node.endpoint ?? { protocol: "rest", method: "GET" };
  const cfg = ENDPOINT_PROTOCOLS[e.protocol];
  const [pl, ph] = PATH_LABEL[e.protocol];
  const upd = (p: Partial<EndpointSpec>) => {
    const ne = { ...e, ...p };
    // mantém o nome sincronizado enquanto ele ainda for o gerado automaticamente
    patch({ endpoint: ne, ...(node.label === endpointLabel(e) ? { label: endpointLabel(ne) } : {}) });
  };
  const owners = doc.nodes.filter((n) => n.kind !== "endpoint" && n.id !== node.id);
  return (
    <>
      <div className="grid2">
        <label className="field">
          <span>Protocolo</span>
          <select className="input" value={e.protocol} onChange={(ev) => upd({ protocol: ev.target.value as EndpointProtocol, method: ENDPOINT_PROTOCOLS[ev.target.value as EndpointProtocol].methods[0] })}>
            {Object.entries(ENDPOINT_PROTOCOLS).map(([k, v]) => (
              <option key={k} value={k}>
                {v.label}
              </option>
            ))}
          </select>
        </label>
        {cfg.methods.length > 0 ? (
          <label className="field">
            <span>{e.protocol === "graphql" ? "Tipo" : e.protocol === "event" ? "Direção" : "Método"}</span>
            <select className="input" value={e.method ?? cfg.methods[0]} onChange={(ev) => upd({ method: ev.target.value })}>
              {cfg.methods.map((m) => (
                <option key={m}>{m}</option>
              ))}
            </select>
          </label>
        ) : (
          <div />
        )}
      </div>
      <div className="callout">{cfg.semantics}</div>
      <label className="field">
        <span>{pl}</span>
        <TextField id="insp-first" value={e.path ?? ""} placeholder={ph} onCommit={(v) => upd({ path: v || undefined })} />
      </label>
      <label className="field">
        <span>Entrada (request / mensagem)</span>
        <TextField value={e.request ?? ""} placeholder="{ items: [{ sku, qty }] }" onCommit={(v) => upd({ request: v || undefined })} />
      </label>
      <label className="field">
        <span>Saída (response)</span>
        <TextField value={e.response ?? ""} placeholder="201 { orderId }" onCommit={(v) => upd({ response: v || undefined })} />
      </label>
      <label className="field">
        <span>Autenticação</span>
        <TextField value={e.auth ?? ""} placeholder="Bearer JWT · API key · mTLS" onCommit={(v) => upd({ auth: v || undefined })} />
      </label>
      <label className="field">
        <span>Exposto por (serviço)</span>
        <select
          className="input"
          value={node.owner ?? ""}
          onChange={(ev) => {
            const o = owners.find((n) => n.id === ev.target.value);
            patch({ owner: o?.id, ...(o ? { parent: o.parent } : {}) });
          }}
        >
          <option value="">— independente —</option>
          {owners.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
    </>
  );
}

/* ───────── endpoints de um serviço + adição rápida ───────── */

const QUICK: { label: string; spec: EndpointSpec; path: string }[] = [
  { label: "GET", spec: { protocol: "rest", method: "GET" }, path: "/resource" },
  { label: "POST", spec: { protocol: "rest", method: "POST" }, path: "/resource" },
  { label: "PUT", spec: { protocol: "rest", method: "PUT" }, path: "/resource/{id}" },
  { label: "PATCH", spec: { protocol: "rest", method: "PATCH" }, path: "/resource/{id}" },
  { label: "DELETE", spec: { protocol: "rest", method: "DELETE" }, path: "/resource/{id}" },
  { label: "WS", spec: { protocol: "websocket" }, path: "/ws" },
  { label: "GraphQL", spec: { protocol: "graphql", method: "query" }, path: "resource(id)" },
  { label: "gRPC", spec: { protocol: "grpc", method: "unary" }, path: "Service/Method" },
  { label: "Webhook", spec: { protocol: "webhook", method: "POST" }, path: "/webhooks/provider" },
  { label: "SSE", spec: { protocol: "sse" }, path: "/events" },
  { label: "Evento", spec: { protocol: "event", method: "PUBLISH" }, path: "topic.name" },
];

export function EndpointsSection({ node }: { node: NodeEl }) {
  const doc = useStore((s) => s.doc);
  const eps = doc.nodes.filter((n) => n.owner === node.id);
  const add = (q: (typeof QUICK)[number]) => {
    const [r] = run([{ op: "add_endpoint", owner: node.id, ...q.spec, path: q.path }]);
    if (r.ok && r.id) select([r.id]);
  };
  return (
    <div className="field">
      <span className="lbl-s">Endpoints e comunicação ({eps.length})</span>
      {eps.map((n) => (
        <div key={n.id} className="ep-row" onClick={() => select([n.id])} role="button" tabIndex={0} onKeyDown={(e) => e.key === "Enter" && select([n.id])}>
          {n.endpoint && <EpBadge e={n.endpoint} />}
          <span className="ep-row-path">{n.endpoint?.path ?? n.label}</span>
          <button
            className="btn ghost icon sm"
            aria-label={`Remover ${n.label}`}
            onClick={(ev) => {
              ev.stopPropagation();
              run([{ op: "remove", id: n.id }]);
            }}
          >
            <Glyph name="close" size={14} />
          </button>
        </div>
      ))}
      <div className="ep-quick" aria-label="Adicionar endpoint">
        {QUICK.map((q) => (
          <button key={q.label} className="ep-add" style={{ ["--c" as string]: endpointColor({ ...q.spec }) }} onClick={() => add(q)} data-tip={`Adicionar ${q.label} a este serviço`} data-tip-pos="top">
            + {q.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ───────── referência a outro diagrama ───────── */

export function RefPicker({ node, patch }: { node: NodeEl; patch: Patch }) {
  const ws = useStore((s) => s.workspace);
  const online = useStore((s) => s.online);
  const file = useStore((s) => s.file);
  const ref = node.ref;
  const [outline, setOutline] = useState<Outline | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    setOutline(null);
    setErr("");
    if (!ref?.diagram || !online) return;
    fetchOutline(ref.diagram).then(setOutline, (e) => setErr(e instanceof Error ? e.message : String(e)));
  }, [ref?.diagram, online]);

  if (!online || !ws) return <div className="callout">Referências entre diagramas precisam do cofre (bridge conectado).</div>;

  const files = ws.files.filter((f) => f.path !== file);
  const target = ref ? ws.files.find((f) => f.path === ref.diagram) : undefined;
  const pick = (diagram: string) => {
    const f = ws.files.find((x) => x.path === diagram);
    const wasDefault = !node.label || node.label === "Outro diagrama" || node.label === ws.files.find((x) => x.path === ref?.diagram)?.title;
    patch({ ref: diagram ? { diagram } : undefined, ...(diagram && f && wasDefault ? { label: f.title } : {}) });
  };
  return (
    <div className="field">
      <span className="lbl-s">Diagrama referenciado</span>
      <select className="input" value={ref?.diagram ?? ""} onChange={(e) => pick(e.target.value)}>
        <option value="">— escolha um diagrama —</option>
        {ref && !target && <option value={ref.diagram}>{ref.diagram} (não encontrado)</option>}
        {files.map((f) => (
          <option key={f.path} value={f.path}>
            {f.title} · {f.path}
          </option>
        ))}
      </select>
      {ref && !target && <div className="callout warn">Este diagrama não existe mais no cofre (apagado ou movido fora do app). Escolha outro ou restaure-o da lixeira (.archflow/trash).</div>}
      {ref && target && (
        <>
          <label className="field" style={{ marginTop: 10 }}>
            <span>Componente específico (opcional)</span>
            <select className="input" value={ref.node ?? ""} onChange={(e) => patch({ ref: { ...ref, node: e.target.value || undefined } })}>
              <option value="">O diagrama inteiro</option>
              {outline?.nodes.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.owner ? "↳ " : ""}
                  {n.label} ({n.kind})
                </option>
              ))}
            </select>
          </label>
          <div className="callout">
            <b>{target.title}</b> · {target.nodes} componentes · {target.connections} conexões
            {outline?.description ? <><br />{outline.description}</> : null}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn primary" style={{ flex: 1, justifyContent: "center" }} onClick={() => openViewer(ref.diagram, ref.node)}>
              <Glyph name="layers" size={16} /> Visualizar
            </button>
            <button className="btn" style={{ flex: 1, justifyContent: "center" }} onClick={() => void openRef(ref.diagram)} data-tip="Abre para edição; o botão Voltar traz você de volta" data-tip-pos="top">
              <Glyph name="edit" size={16} /> Editar
            </button>
          </div>
        </>
      )}
      {err && <div className="callout warn">{err}</div>}
    </div>
  );
}

