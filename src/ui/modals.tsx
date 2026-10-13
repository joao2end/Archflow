import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ASSET_CATEGORIES } from "../shared/catalog";
import { SPACING_GAP, describe, schemaGuide, toMermaid, validateDetailed } from "../shared/ops";
import { filesToMarkdown, generateCode } from "../shared/codegen";
import { domainOverview, issueText, type Issue } from "../shared/domain";
import { NODE_KINDS, docMode, type Asset, type InterfaceKind, type InterfaceOperation, type InterfaceSpec, type NodeKind, type Routing } from "../shared/schema";
import { ColorPicker } from "./colorpicker";
import { AssetBadge, Glyph } from "./icons";
import { FolderModal, QuickSwitcher, VaultsModal } from "./files";
import { McpBody } from "./mcp";
import { DddGuide, openDddGuide } from "./dddguide";
import { DiagramViewer } from "./viewer";
import { severityOrder, useDomainIssues } from "./domain";
import { allKnownAssets, fetchVaultDocs, getState, lookupAsset, newAssetId, newDiagram, run, saveAsset, select, set, toast, useStore } from "./store";

function Modal({ title, onClose, children, foot, wide }: { title: string; onClose: () => void; children: ReactNode; foot?: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    // sem campo ou botão principal, o foco vai para o próprio diálogo (atalhos do quadro ficam suspensos)
    (ref.current?.querySelector<HTMLElement>("input,textarea,select,button.primary") ?? ref.current)?.focus();
    return () => prev?.focus?.();
  }, []);
  /** Prende o Tab dentro do diálogo. */
  const trap = (e: React.KeyboardEvent) => {
    if (e.key !== "Tab" || !ref.current) return;
    const items = [...ref.current.querySelectorAll<HTMLElement>('a[href],button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),[tabindex]:not([tabindex="-1"])')].filter((el) => el.offsetParent !== null);
    if (!items.length) return e.preventDefault();
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && (active === first || active === ref.current)) (e.preventDefault(), last.focus());
    else if (!e.shiftKey && active === last) (e.preventDefault(), first.focus());
  };
  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} className={`glass modal ${wide ? "wide" : ""}`} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} onKeyDown={trap}>
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

  const build = (): Asset => ({ ...a, id: a.id || newAssetId(a.name), name: a.name.trim(), icon, tags: tags.split(",").map((t) => t.trim()).filter(Boolean), builtin: undefined });
  const snapshot = JSON.stringify([a, tags]);
  const initial = useRef(snapshot);
  const latest = useRef({ snapshot, valid: false, build });
  latest.current = { snapshot, valid: !!a.name.trim() && !!a.problem.trim(), build };
  const done = useRef(false);

  const save = () => {
    if (!a.name.trim()) return setErr("Dê um nome ao asset.");
    if (!a.problem.trim()) return setErr("Descreva o problema que ele resolve — é o que ajuda humanos e LLMs a escolher.");
    done.current = true;
    saveAsset(build());
    toast("Asset salvo na biblioteca");
    close();
  };

  /* fechar a modal (X, fora, Esc, Cancelar) salva as alterações, se o asset estiver completo */
  useEffect(
    () => () => {
      const l = latest.current;
      if (done.current || l.snapshot === initial.current || !l.valid) return;
      saveAsset(l.build());
      toast("Alterações do asset salvas");
    },
    [],
  );

  return (
    <Modal
      title={existing ? "Editar asset" : "Novo asset"}
      onClose={close}
      foot={
        <>
          <span style={{ color: "var(--danger)", marginRight: "auto", alignSelf: "center" }}>{err}</span>
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
          <div><ColorPicker value={a.color} swatchColor={a.color} onChange={(c) => up({ color: c })} label="Cor do asset" /></div>
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
  const initial = useRef(JSON.stringify(spec));
  const latest = useRef({ spec, from: "", to: "" });
  const done = useRef(false);
  const fromLabel = getState().doc.nodes.find((n) => n.id === conn?.from)?.label ?? conn?.from ?? "";
  const toLabel = getState().doc.nodes.find((n) => n.id === conn?.to)?.label ?? conn?.to ?? "";
  latest.current = { spec, from: fromLabel, to: toLabel };

  /* fechar a modal (X, fora, Esc, Cancelar) salva as alterações da interface */
  useEffect(
    () => () => {
      const l = latest.current;
      if (done.current || JSON.stringify(l.spec) === initial.current || !getState().doc.connections.some((c) => c.id === id)) return;
      run([{ op: "update", id, patch: { interface: { ...l.spec, name: l.spec.name || `${l.from} → ${l.to}`, operations: l.spec.operations.filter((o) => o.name.trim()) } } }]);
      toast("Interface salva");
    },
    [],
  );
  if (!conn) return null;
  const upOp = (i: number, p: Partial<InterfaceOperation>) => setSpec((s) => ({ ...s, operations: s.operations.map((o, j) => (j === i ? { ...o, ...p } : o)) }));
  const from = getState().doc.nodes.find((n) => n.id === conn.from)?.label ?? conn.from;
  const to = getState().doc.nodes.find((n) => n.id === conn.to)?.label ?? conn.to;
  const placeholder = spec.kind === "rest" ? ["createOrder", "/orders", '{ items: [{ sku, qty }] }', "201 { orderId, status }"] : spec.kind === "event" ? ["OrderCreated", "order-events", "{ orderId, total }", "(sem resposta)"] : ["operação", "caminho / tópico / tabela", "entrada", "saída"];

  const save = (remove = false) => {
    done.current = true;
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
  const text = tab === "md" ? describe(doc) : tab === "mermaid" ? toMermaid(doc) : tab === "json" ? JSON.stringify(doc, null, 2) : schemaGuide(docMode(doc));
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

/* ───────── domínio (DDD): modo, validação e visão geral ───────── */

function DomainModal({ tab: initial }: { tab?: "issues" | "overview" | "code" }) {
  const doc = useStore((s) => s.doc);
  const mode = docMode(doc);
  const [tab, setTab] = useState<"issues" | "overview" | "code">(initial ?? "issues");
  const issues = useDomainIssues();
  const [overview, setOverview] = useState<string | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (tab !== "overview" || mode !== "domain") return;
    setErr("");
    fetchVaultDocs().then(
      (files) => {
        const s = getState();
        setOverview(domainOverview(files.map((f) => (f.path === s.file ? { ...f, doc: s.doc } : f))));
      },
      (e) => setErr(e instanceof Error ? e.message : String(e)),
    );
  }, [tab, mode, doc]);

  const count = (s: Issue["severity"]) => issues.filter((i) => i.severity === s).length;
  const code = useMemo(() => (tab === "code" && mode === "domain" ? generateCode(doc) : []), [tab, mode, doc]);
  const text = tab === "overview" ? overview ?? "" : tab === "code" ? filesToMarkdown(code) : issues.map(issueText).join("\n");

  return (
    <Modal
      wide
      title="Domínio (DDD)"
      onClose={close}
      foot={
        mode === "domain" ? (
          <>
            <button
              className="btn"
              onClick={() => {
                void newDiagram("Visão geral", "dominio", "domain");
                close();
              }}
              data-tip="Cria um diagrama de mapa de contextos em dominio/. Arraste os diagramas de contexto para ele (componente «Outro diagrama») e ligue-os com context-relation."
            >
              <Glyph name="file-plus" size={16} /> Novo mapa de contextos
            </button>
            <button className="btn primary" onClick={() => navigator.clipboard.writeText(text).then(() => toast("Copiado para a área de transferência"))}>
              <Glyph name="copy" size={16} /> Copiar
            </button>
          </>
        ) : undefined
      }
    >
      <p style={{ color: "var(--ink-2)", marginTop: 0 }}>Validação das regras de DDD, visão geral dos contextos do cofre e esqueleto de código. O modo (Arch | Domain) é trocado no switch da barra superior.</p>
      {mode === "domain" && (
        <>
          <div className="tabs seg" role="tablist">
            <button role="tab" aria-selected={tab === "issues"} className={tab === "issues" ? "active" : ""} onClick={() => setTab("issues")}>
              Validação ({count("erro")} erros · {count("aviso")} avisos · {count("dica")} dicas)
            </button>
            <button role="tab" aria-selected={tab === "overview"} className={tab === "overview" ? "active" : ""} onClick={() => setTab("overview")}>
              Visão geral do cofre
            </button>
            <button role="tab" aria-selected={tab === "code"} className={tab === "code" ? "active" : ""} onClick={() => setTab("code")}>
              Código (TypeScript)
            </button>
          </div>
          {tab === "issues" &&
            (issues.length ? (
              <ul className="issue-list" aria-label="Avisos de validação">
                {issues.map((i, k) => (
                  <li key={k}>
                    <button className={`issue ${i.severity}`} disabled={!i.target} onClick={() => i.target && (select([i.target]), close())} data-tip={i.target ? "Selecionar no quadro" : undefined} data-tip-pos="left">
                      <span className="issue-rule">{i.rule}</span>
                      <span className="issue-sev">{i.severity}</span>
                      <span className="issue-msg">{i.message}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="callout">Nenhum problema encontrado neste diagrama.</div>
            ))}
          {tab === "code" &&
            (code.length ? (
              <>
                <div className="callout">
                  Esqueleto de {code.length} arquivo(s), um diretório por contexto (application → domain). A lógica fica como TODO; copie e grave no seu projeto, ou peça ao agente (MCP) a tool <b>generate_code</b>.
                </div>
                <pre className="code">{text}</pre>
              </>
            ) : (
              <div className="callout">Nada a gerar ainda: adicione aggregates, commands e eventos ao diagrama.</div>
            ))}
          {tab === "overview" && (err ? <div className="callout warn">{err}</div> : <pre className="code">{overview ?? "Carregando…"}</pre>)}
        </>
      )}
    </Modal>
  );
}

/* ───────── lógica: validação (com os exemplos rodando) e descrição ───────── */

function LogicModal({ tab: initial }: { tab?: "issues" | "text" }) {
  const doc = useStore((s) => s.doc);
  const [tab, setTab] = useState<"issues" | "text">(initial ?? "issues");
  const issues = useMemo(() => (docMode(doc) === "logic" ? validateDetailed(doc).sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]) : []), [doc]);
  const text = tab === "text" ? describe(doc) : issues.map(issueText).join("\n");
  const count = (s: Issue["severity"]) => issues.filter((i) => i.severity === s).length;
  return (
    <Modal
      wide
      title="Lógica de negócio"
      onClose={close}
      foot={
        <button className="btn primary" onClick={() => navigator.clipboard.writeText(text).then(() => toast("Copiado para a área de transferência"))}>
          <Glyph name="copy" size={16} /> Copiar
        </button>
      }
    >
      <p style={{ color: "var(--ink-2)", marginTop: 0 }}>Validação: cada exemplo é executado de verdade e comparado com o esperado. A aba Texto é o que uma IA lê (o fluxo com a explicação em português).</p>
      <div className="tabs seg" role="tablist">
        <button role="tab" aria-selected={tab === "issues"} className={tab === "issues" ? "active" : ""} onClick={() => setTab("issues")}>
          Validação ({count("erro")} erros · {count("aviso")} avisos · {count("dica")} dicas)
        </button>
        <button role="tab" aria-selected={tab === "text"} className={tab === "text" ? "active" : ""} onClick={() => setTab("text")}>
          Texto (para IA)
        </button>
      </div>
      {tab === "issues" &&
        (issues.length ? (
          <ul className="issue-list" aria-label="Avisos de validação">
            {issues.map((i, k) => (
              <li key={k}>
                <button className={`issue ${i.severity}`} disabled={!i.target} onClick={() => i.target && (select([i.target]), close())} data-tip={i.target ? "Selecionar no quadro" : undefined} data-tip-pos="left">
                  <span className="issue-rule">{i.rule}</span>
                  <span className="issue-sev">{i.severity}</span>
                  <span className="issue-msg">{i.message}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <div className="callout">Nenhum problema: todas as ações têm exemplos e todos os exemplos batem.</div>
        ))}
      {tab === "text" && <pre className="code">{text}</pre>}
    </Modal>
  );
}

/* ───────── MCP ───────── */

function McpModal() {
  return (
    <Modal wide title="Conectar um agente (MCP)" onClose={close}>
      <McpBody />
    </Modal>
  );
}

/* ───────── guia de DDD ───────── */

function DddGuideModal() {
  return (
    <Modal wide title="DDD em 8 passos" onClose={close}>
      <DddGuide onClose={close} />
    </Modal>
  );
}

/* ───────── ajuda ───────── */

function HelpModal() {
  const mode = useStore((st) => docMode(st.doc));
  // agrupados pelo que a pessoa está tentando fazer; a seção do modo aberto vem primeiro
  const groups: [string, [string, string][]][] = [
    ["Montar o diagrama", [["B", "Biblioteca"], ["/", "Buscar asset"], ["G", "Grupo"], ["C", "Conector"], ["N", "Nota"], ["Duplo clique", "Renomear · editar interface"], ["Shift+clique", "Selecionar vários"]]],
    ["Editar", [["Ctrl+Z / Y", "Desfazer / refazer"], ["Ctrl+D", "Duplicar"], ["Ctrl+C / X / V", "Copiar · recortar · colar componentes e notas"], ["Ctrl+A", "Selecionar tudo"], ["Del", "Excluir"], ["Setas", "Mover seleção (Shift = 10×)"], ["Tab / Shift+Tab", "Selecionar próximo / anterior componente"]]],
    ["Navegar", [["V", "Selecionar"], ["H / Espaço", "Mover tela"], ["F / Shift+F", "Ajustar à tela / ajustar à seleção"], ["Ctrl + / − / 0", "Zoom: aproximar · afastar · 100%"], ["Ctrl+roda", "Zoom"], ["Ctrl+O", "Busca rápida de diagramas"], ["E", "Explorador de arquivos (cofre)"], ["Botão direito", "Em um componente: inspecionar o fluxo ligado a ele (Esc sai)"], ["Esc", "Cancelar / fechar"]]],
    ["Desenhar e anotar", [["D · M · X · W · I", "Caneta · marca-texto · borracha · texto · lista"]]],
    ["Aparência", [["L / Shift+L", "Auto-layout: abre a configuração (horizontal / vertical)"], ["T", "Alternar tema (auto/claro/escuro)"], ["A", "Animações on/off"]]],
    ["Apresentar", [["P", "Modo apresentação (V navegar · P caneta · H marca-texto · L laser · X limpar · Espaço pausa o cronômetro)"]]],
  ];
  if (mode === "logic") groups.unshift(["Modo Lógica", [["▶ no cenário", "Reproduz o caminho que o fluxo percorre"], ["← →", "Passo anterior / próximo durante a reprodução"], ["✓ no topo", "Validação: roda todos os exemplos e mostra o que não bate"]]]);
  const [q, setQ] = useState("");
  const norm = (t: string) => t.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const needle = norm(q.trim());
  // filtra por descrição, tecla ou nome da seção; seções sem resultado somem
  const shown = groups
    .map(([title, rows]) => [title, needle ? rows.filter(([k, v]) => norm(`${k} ${v} ${title}`).includes(needle)) : rows] as [string, [string, string][]])
    .filter(([, rows]) => rows.length);
  return (
    <Modal title="Atalhos e dicas" onClose={close}>
      <label className="search help-search">
        <Glyph name="search" size={16} />
        <input placeholder="Filtrar atalhos… (ex.: zoom, Ctrl+Z, grupo)" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Filtrar atalhos" />
      </label>
      <div role="status" aria-live="polite" className="sr-only">
        {needle ? (shown.length ? (() => { const n = shown.reduce((c, [, r]) => c + r.length, 0); return `${n} ${n === 1 ? "atalho encontrado" : "atalhos encontrados"}`; })() : "Nenhum atalho encontrado") : ""}
      </div>
      {needle && !shown.length && <div className="empty">Nenhum atalho com “{q.trim()}”.</div>}
      {shown.map(([title, rows]) => (
        <section key={title} className="help-sec" aria-label={title}>
          <h3>{title}</h3>
          <div className="help-grid">
            {rows.map(([k, v]) => (
              <div key={k}>
                <span>{v}</span>
                <span className="kbd">{k}</span>
              </div>
            ))}
          </div>
        </section>
      ))}
      <p className="callout" style={{ marginTop: 16 }}>
        <b>Novo em DDD?</b> <button className="btn" style={{ marginLeft: 6 }} onClick={openDddGuide}>Abrir o guia animado</button>
      </p>
      <p className="callout" style={{ marginTop: 0 }}>
        <b>Conectar:</b> passe o mouse sobre um componente e arraste de um dos pontos “+” até outro. O tipo vem da barra inferior (assíncrona, dados, herança UML…). <b>Agrupar:</b> arraste um componente para dentro de um grupo.
      </p>
    </Modal>
  );
}

/* ───────── auto-layout ───────── */

const LS_LAYOUT = "archflow.layout.v2";
type RoutingChoice = Routing | "keep";
type LayoutCfg = { gapX: number; gapY: number; routing: RoutingChoice };
const GAP_MIN = 16;
const GAP_MAX = 400;
const DEFAULT_CFG: LayoutCfg = { gapX: SPACING_GAP.comfortable * 2, gapY: SPACING_GAP.comfortable, routing: "keep" };
const SPACING_PRESETS: [string, number, number][] = [
  ["Compacto", SPACING_GAP.compact * 2, SPACING_GAP.compact],
  ["Confortável", SPACING_GAP.comfortable * 2, SPACING_GAP.comfortable],
  ["Amplo", SPACING_GAP.spacious * 2, SPACING_GAP.spacious],
];
const ROUTING_OPTIONS: [RoutingChoice, string, string][] = [
  ["keep", "Manter", "Preserva o traçado de cada conexão"],
  ["curve", "Curva", "Linhas suaves"],
  ["elbow", "Ortogonal", "Ângulos retos"],
  ["straight", "Reta", "Linha direta"],
];
const ROUTING_PATH: Record<RoutingChoice, string> = {
  keep: "M4 20 C14 20 12 8 22 8 S30 14 40 6",
  curve: "M4 20 C20 20 24 6 40 6",
  elbow: "M4 20 H22 V6 H40",
  straight: "M4 20 L40 6",
};

const clampGap = (n: number) => Math.min(GAP_MAX, Math.max(GAP_MIN, Math.round(n) || GAP_MIN));

function readLayoutCfg(): LayoutCfg {
  try {
    const v = JSON.parse(localStorage.getItem(LS_LAYOUT) ?? "null") as Partial<LayoutCfg> | null;
    return {
      gapX: clampGap(Number(v?.gapX) || DEFAULT_CFG.gapX),
      gapY: clampGap(Number(v?.gapY) || DEFAULT_CFG.gapY),
      routing: ROUTING_OPTIONS.some(([k]) => k === v?.routing) ? v!.routing! : DEFAULT_CFG.routing,
    };
  } catch {
    return DEFAULT_CFG;
  }
}

function GapRow({ label, axis, value, onChange }: { label: string; axis: "x" | "y"; value: number; onChange: (n: number) => void }) {
  return (
    <div className="lay-gap">
      <span className="lay-gap-lbl">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          {axis === "x" ? <path d="M2 8h12M5 5 2 8l3 3M11 5l3 3-3 3" /> : <path d="M8 2v12M5 5l3-3 3 3M5 11l3 3 3-3" />}
        </svg>
        {label}
      </span>
      <input type="range" aria-label={`Espaçamento ${label.toLowerCase()}`} min={GAP_MIN} max={GAP_MAX} step={4} value={value} onChange={(e) => onChange(Number(e.target.value))} />
      <span className="lay-num">
        <input type="number" aria-label={`${label} (px)`} min={GAP_MIN} max={GAP_MAX} value={value} onChange={(e) => onChange(clampGap(Number(e.target.value)))} />
        px
      </span>
    </div>
  );
}

/** Miniatura da grade: mostra como os dois espaçamentos afetam a distribuição. */
function GapPreview({ gapX, gapY }: { gapX: number; gapY: number }) {
  const k = 0.2;
  const w = 34;
  const h = 20;
  const cols = 3;
  const rows = 2;
  const dx = w + gapX * k;
  const dy = h + gapY * k;
  const W = cols * w + (cols - 1) * gapX * k;
  const H = rows * h + (rows - 1) * gapY * k;
  return (
    <svg className="lay-preview" viewBox={`-6 -6 ${W + 12} ${H + 12}`} role="img" aria-label="Pré-visualização do espaçamento">
      {Array.from({ length: cols * rows }, (_, i) => (
        <rect key={i} x={(i % cols) * dx} y={Math.floor(i / cols) * dy} width={w} height={h} rx={4} />
      ))}
    </svg>
  );
}

function LayoutModal({ direction: initial }: { direction: "LR" | "TB" }) {
  const [cfg] = useState(readLayoutCfg);
  const [direction, setDirection] = useState(initial);
  const [gapX, setGapX] = useState(cfg.gapX);
  const [gapY, setGapY] = useState(cfg.gapY);
  const [routing, setRouting] = useState(cfg.routing);
  const domain = useStore((s) => docMode(s.doc) === "domain");
  const [style, setStyle] = useState<"flow" | "timeline" | "grouped">(domain ? "timeline" : "flow");
  const apply = () => {
    try {
      localStorage.setItem(LS_LAYOUT, JSON.stringify({ gapX, gapY, routing }));
    } catch {
      /* preferência opcional */
    }
    const r = run([{ op: "layout", style, direction, gapX, gapY, routing: routing === "keep" ? undefined : routing }]);
    close();
    toast(r[0]?.ok === false ? r[0].error ?? "Não foi possível aplicar o layout" : style === "timeline" ? "Linha do tempo aplicada" : style === "grouped" ? "Agrupado por tipo" : "Layout automático aplicado");
  };
  return (
    <Modal
      title="Layout automático"
      onClose={close}
      foot={
        <>
          <button className="btn" onClick={close}>Cancelar</button>
          <button className="btn primary" onClick={apply}>Aplicar layout</button>
        </>
      }
    >
      <div
        className="lay"
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.target as HTMLElement).tagName !== "BUTTON") apply();
        }}
      >
        {domain && (
          <section className="lay-sec">
            <h3>Estilo</h3>
            <div className="lay-opts" role="radiogroup" aria-label="Estilo do layout">
              {([["timeline", "Linha do tempo", "Event Storming: ator → caso de uso → command → aggregate → evento"], ["grouped", "Agrupar por tipo", "Um quadro por tipo de componente, ligados por conectores"], ["flow", "Fluxo", "Camadas pelo fluxo das conexões"]] as const).map(([k, l, d]) => (
                <button key={k} role="radio" aria-checked={style === k} className={`lay-opt ${style === k ? "active" : ""}`} onClick={() => setStyle(k)}>
                  <b>{l}</b>
                  <small>{d}</small>
                </button>
              ))}
            </div>
          </section>
        )}
        <section className="lay-sec" style={style === "timeline" || style === "grouped" ? { display: "none" } : undefined}>
          <h3>Direção do fluxo</h3>
          <div className="lay-opts two" role="radiogroup" aria-label="Direção do fluxo">
            {([["LR", "Horizontal", "Da esquerda para a direita", "M4 12h16M14 6l6 6-6 6"], ["TB", "Vertical", "De cima para baixo", "M12 4v16M6 14l6 6 6-6"]] as const).map(([k, l, d, icon]) => (
              <button key={k} role="radio" aria-checked={direction === k} className={`lay-opt ${direction === k ? "active" : ""}`} onClick={() => setDirection(k)}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={icon} /></svg>
                <b>{l}</b>
                <small>{d}</small>
              </button>
            ))}
          </div>
        </section>

        <section className="lay-sec" style={style === "timeline" || style === "grouped" ? { display: "none" } : undefined}>
          <h3>Espaçamento</h3>
          <div className="seg" role="radiogroup" aria-label="Presets de espaçamento">
            {SPACING_PRESETS.map(([l, x, y]) => {
              const on = gapX === x && gapY === y;
              return (
                <button key={l} role="radio" aria-checked={on} className={on ? "active" : ""} onClick={() => (setGapX(x), setGapY(y))}>{l}</button>
              );
            })}
          </div>
          <div className="lay-spacing">
            <div className="lay-gaps">
              <GapRow label="Horizontal" axis="x" value={gapX} onChange={setGapX} />
              <GapRow label="Vertical" axis="y" value={gapY} onChange={setGapY} />
            </div>
            <GapPreview gapX={gapX} gapY={gapY} />
          </div>
        </section>

        <section className="lay-sec">
          <h3>Tipo de conector</h3>
          <div className="lay-opts four" role="radiogroup" aria-label="Tipo de conector">
            {ROUTING_OPTIONS.map(([k, l, d]) => (
              <button key={k} role="radio" aria-checked={routing === k} className={`lay-opt ${routing === k ? "active" : ""}`} onClick={() => setRouting(k)} title={d}>
                <svg width="44" height="26" viewBox="0 0 44 26" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d={ROUTING_PATH[k]} strokeDasharray={k === "keep" ? "3 3" : undefined} />
                </svg>
                <b>{l}</b>
              </button>
            ))}
          </div>
          <p className="lay-hint">{routing === "keep" ? "Cada conexão mantém o traçado atual." : "O traçado escolhido vale para todas as conexões do diagrama."}</p>
        </section>
      </div>
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
    case "domain":
      return <DomainModal tab={m.tab} />;
    case "logic":
      return <LogicModal tab={m.tab} />;
    case "mcp":
      return <McpModal />;
    case "help":
      return <HelpModal />;
    case "ddd-guide":
      return <DddGuideModal />;
    case "layout":
      return <LayoutModal key={m.direction} direction={m.direction} />;
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
