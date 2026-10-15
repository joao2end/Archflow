import { useEffect, useMemo, useRef, useState } from "react";
import { AGENT_RELS, AGENT_REL_KEYS, AGENT_ROLES, AGENT_ROLE_KEYS, type AgentNodeSpec, type AgentRel, type AgentRole, type ConnectionEl, type NodeEl } from "../shared/schema";
import { reshapeAgent, suggestAgentRels } from "../shared/agents";
import { SKILL_CATALOG, catalogEntryToSource, resolveSkillSource, searchSkillCatalog, type SkillCatalogEntry } from "../shared/skillcatalog";
import { renderMarkdown } from "./markdown";
import { Glyph } from "./icons";
import { TextField } from "./panels";
import { insertBlock, RichEditor, RichToolbar } from "./richeditor";
import { run, set, toast, toastError, useStore } from "./store";

type Patch = (p: Record<string, unknown>) => void;

/** Mescla `p` no spec e descarta campos vazios (o validador recusa string/lista vazia). */
function mergeAgent(agent: AgentNodeSpec, p: Record<string, unknown>): Record<string, unknown> {
  const next: Record<string, unknown> = { ...agent, ...p };
  for (const k of Object.keys(next)) {
    const v = next[k];
    if (v === undefined || v === "" || (Array.isArray(v) && !v.length)) delete next[k];
  }
  return next;
}

export const openSkillModal = (id: string, tab?: "catalog" | "write") => set({ modal: { type: "skill", id, tab } });

/* ───────── nó agent/skill ───────── */

export function AgentFields({ node, patch }: { node: NodeEl; patch: Patch }) {
  const agent = node.agent!;
  const role = AGENT_ROLES[agent.role];
  const upd = (p: Record<string, unknown>) => patch({ agent: mergeAgent(agent, p) });
  return (
    <>
      <label className="field">
        <span>Papel</span>
        <select className="input" value={agent.role} onChange={(e) => patch({ agent: reshapeAgent(agent, e.target.value as AgentRole) })}>
          {AGENT_ROLE_KEYS.map((r) => (
            <option key={r} value={r}>
              {AGENT_ROLES[r].label}
            </option>
          ))}
        </select>
      </label>
      <div className="callout">{role.hint}</div>
      {agent.role === "agent" && <AgentRoleFields agent={agent} upd={upd} />}
      {agent.role === "skill" && <SkillRoleFields node={node} agent={agent} upd={upd} />}
    </>
  );
}

const MODEL_OPTIONS = ["inherit", "sonnet", "opus", "haiku"];

function AgentRoleFields({ agent, upd }: { agent: AgentNodeSpec; upd: (p: Record<string, unknown>) => void }) {
  return (
    <>
      <label className="field">
        <span>Description (quando o orquestrador deve delegar pra ele)</span>
        <TextField multiline value={agent.description ?? ""} placeholder="Use para revisar pull requests: aponta bugs, estilo e falhas de segurança." onCommit={(v) => upd({ description: v.trim() || undefined })} />
      </label>
      {!agent.description && <div className="callout warn">Sem description o orquestrador nunca sabe quando chamar este agente (A001).</div>}
      <label className="field">
        <span>Model</span>
        <input className="input" list="agent-models" value={agent.model ?? ""} placeholder="inherit" onChange={(e) => upd({ model: e.target.value || undefined })} />
        <datalist id="agent-models">
          {MODEL_OPTIONS.map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
      </label>
      <label className="field">
        <span>Tools (uma por linha; vazio = todas)</span>
        <TextField multiline value={(agent.tools ?? []).join("\n")} placeholder="Read\nGrep\nBash" onCommit={(v) => upd({ tools: v.split("\n").map((s) => s.trim()).filter(Boolean) })} />
      </label>
      <label className="field">
        <span>Prompt (corpo do system prompt do subagente)</span>
        <TextField multiline value={agent.prompt ?? ""} placeholder="Você é um revisor de código focado em…" onCommit={(v) => upd({ prompt: v.trim() || undefined })} />
      </label>
    </>
  );
}

/** No inspetor a skill só mostra o resumo; buscar no catálogo e escrever ficam na modal da skill. */
function SkillRoleFields({ node, agent, upd }: { node: NodeEl; agent: AgentNodeSpec; upd: (p: Record<string, unknown>) => void }) {
  const lines = agent.body ? agent.body.split("\n").length : 0;
  return (
    <>
      <div className="callout skill-summary">
        <b>{agent.source ? "Do catálogo" : agent.body ? "Própria" : "Vazia"}</b>
        {agent.source && (
          <>
            {" · "}
            <code>{agent.source.repo}</code>
            {agent.source.hash ? " · resolvida" : <span className="skill-pending"> · ainda não resolvida (A006)</span>}
          </>
        )}
        {lines > 0 && <> · {lines} linhas de SKILL.md</>}
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <button className="btn sm" onClick={() => openSkillModal(node.id, "catalog")}>
          Catálogo
        </button>
        <button className="btn sm primary" onClick={() => openSkillModal(node.id, "write")}>
          {agent.body || agent.source ? "Abrir editor" : "Escrever do zero"}
        </button>
      </div>
      <label className="field">
        <span>Description (quando o agente deve puxar esta skill)</span>
        <TextField multiline value={agent.description ?? ""} placeholder="Use quando for revisar código: estilo, testes e segurança." onCommit={(v) => upd({ description: v.trim() || undefined })} />
      </label>
      {!agent.description && <div className="callout warn">Sem description o agente não sabe quando usar esta skill (A002).</div>}
    </>
  );
}

/* ───────── modal da skill: catálogo + escrita ───────── */

const close = () => set({ modal: null });

/** Nome da skill como vai no frontmatter / pasta (`skills/<nome>/SKILL.md`). */
export const skillSlug = (label: string) =>
  label
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "skill";

const SKILL_SECTIONS: { id: string; label: string; tip: string; text: string }[] = [
  { id: "when", label: "Quando usar", tip: "Gatilhos: em que situação o agente deve puxar a skill", text: "## Quando usar\n\n- Quando o usuário pedir …\n- Quando o código tocar em …\n" },
  { id: "steps", label: "Passo a passo", tip: "O procedimento, em ordem", text: "## Passo a passo\n\n1. Leia …\n2. Verifique …\n3. Só então …\n" },
  { id: "rules", label: "Regras", tip: "O que sempre / nunca fazer", text: "## Regras\n\n- **Sempre** …\n- **Nunca** …\n" },
  { id: "examples", label: "Exemplos", tip: "Um caso concreto com entrada e saída esperada", text: "## Exemplos\n\n**Entrada:** …\n\n**Saída esperada:**\n\n```\n…\n```\n" },
  { id: "check", label: "Checklist", tip: "Verificação final antes de concluir", text: "## Checklist final\n\n- [ ] …\n- [ ] …\n" },
  { id: "refs", label: "Referências", tip: "Arquivos de apoio ou links", text: "## Referências\n\n- [Documentação](https://)\n" },
];

const skillSkeleton = (name: string) =>
  [`# ${name}`, "", "Uma frase sobre o que esta skill ensina ao agente.", "", ...SKILL_SECTIONS.filter((s) => s.id !== "refs").map((s) => s.text)].join("\n");

type Hint = { sev: "warn" | "tip"; text: string };

/** Dicas de escrita ao vivo: o que deixa uma skill fácil de ser escolhida e seguida pelo agente. */
function skillHints(agent: AgentNodeSpec): Hint[] {
  const out: Hint[] = [];
  const d = agent.description?.trim() ?? "";
  const body = agent.body ?? "";
  if (!d) out.push({ sev: "warn", text: "Sem description o agente nunca sabe quando puxar a skill (A002)." });
  else if (d.length < 40) out.push({ sev: "tip", text: "Description curta: diga o que a skill faz e em que situação usar." });
  else if (!/quando|use |use$|when/i.test(d)) out.push({ sev: "tip", text: "Inclua o gatilho na description, ex.: «Use quando…»." });
  if (!body.trim()) out.push({ sev: "warn", text: "Corpo vazio: comece pela estrutura ou por uma das seções acima." });
  else {
    if (!/^##\s/m.test(body)) out.push({ sev: "tip", text: "Divida em seções (##): o agente acha a instrução certa mais rápido." });
    if (!/^##\s+quando/im.test(body)) out.push({ sev: "tip", text: "Falta uma seção «Quando usar»." });
    if (body.split("\n").length > 500) out.push({ sev: "warn", text: "Mais de 500 linhas: mova detalhes para arquivos de referência." });
  }
  return out;
}

export function SkillModal({ id, tab: initial }: { id: string; tab?: "catalog" | "write" }) {
  const node = useStore((s) => s.doc.nodes.find((n) => n.id === id));
  const agent = node?.agent?.role === "skill" ? node.agent : undefined;
  const [tab, setTab] = useState<"catalog" | "write">(initial ?? (agent?.body || agent?.source ? "write" : "catalog"));
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    return () => prev?.focus?.();
  }, []);
  if (!node || !agent) return null;
  const patch = (p: Record<string, unknown>) => run([{ op: "update", id, patch: p }]);
  const upd = (p: Record<string, unknown>) => patch({ agent: mergeAgent(agent, p) });
  /** Prende o Tab dentro do diálogo. */
  const trap = (e: React.KeyboardEvent) => {
    if (e.key !== "Tab" || !ref.current) return;
    const items = [...ref.current.querySelectorAll<HTMLElement>('a[href],button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),summary,[tabindex]:not([tabindex="-1"])')].filter((el) => el.offsetParent !== null);
    if (!items.length) return e.preventDefault();
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && (active === first || active === ref.current)) (e.preventDefault(), last.focus());
    else if (!e.shiftKey && active === last) (e.preventDefault(), first.focus());
  };
  const origin = agent.source ? `catálogo · ${agent.source.repo}` : agent.body ? "própria" : "vazia";
  return (
    <div className="skill-scrim" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div ref={ref} className="skill-dialog" role="dialog" aria-modal="true" aria-labelledby="skill-dialog-title" tabIndex={-1} onKeyDown={trap}>
        <header className="skill-dialog-head">
          <div className="skill-dialog-title">
            <span className="skill-dialog-kicker">Skill · {origin}</span>
            <h2 id="skill-dialog-title">{node.label || "Skill"}</h2>
          </div>
          <div className="skill-dialog-tabs" role="tablist" aria-label="Como montar a skill">
            <button role="tab" aria-selected={tab === "catalog"} className={tab === "catalog" ? "active" : ""} onClick={() => setTab("catalog")}>
              Buscar no catálogo
            </button>
            <button role="tab" aria-selected={tab === "write"} className={tab === "write" ? "active" : ""} onClick={() => setTab("write")}>
              Escrever
            </button>
          </div>
          <button className="btn ghost icon" onClick={close} aria-label="Fechar">
            <Glyph name="close" size={19} />
          </button>
        </header>
        <div className="skill-dialog-body">
          {tab === "catalog" ? <SkillCatalogTab node={node} agent={agent} patch={patch} upd={upd} onWrite={() => setTab("write")} /> : <SkillWriteTab node={node} agent={agent} patch={patch} upd={upd} />}
        </div>
        <footer className="skill-dialog-foot">
          <span className="skill-dialog-note">As mudanças são salvas no diagrama enquanto você edita.</span>
          <button className="btn primary" onClick={close}>
            Concluir
          </button>
        </footer>
      </div>
    </div>
  );
}

type TabProps = { node: NodeEl; agent: AgentNodeSpec; patch: Patch; upd: (p: Record<string, unknown>) => void };

type Preview = { status: "loading" } | { status: "ok"; body: string } | { status: "error"; error: string };

function SkillCatalogTab({ node, agent, patch, upd, onWrite }: TabProps & { onWrite: () => void }) {
  const current = agent.source;
  const isCurrent = (e: SkillCatalogEntry) => current?.repo === e.repo && current.skillPath === e.skillPath;
  const [query, setQuery] = useState("");
  const [focusId, setFocusId] = useState<string | undefined>(() => SKILL_CATALOG.find(isCurrent)?.id);
  const [previews, setPreviews] = useState<Record<string, Preview>>({});
  const [resolving, setResolving] = useState(false);
  const [repo, setRepo] = useState("");
  const [path, setPath] = useState("");
  const results = query.trim() ? searchSkillCatalog(query) : SKILL_CATALOG;
  const focused = results.find((r) => r.id === focusId) ?? results[0];
  const preview = focused && isCurrent(focused) && agent.body ? ({ status: "ok", body: agent.body } as Preview) : focused ? previews[focused.id] : undefined;

  useEffect(() => {
    if (!focused || previews[focused.id] || (isCurrent(focused) && agent.body)) return;
    const id = focused.id;
    setPreviews((p) => ({ ...p, [id]: { status: "loading" } }));
    resolveSkillSource(catalogEntryToSource(focused)).then((r) => setPreviews((p) => ({ ...p, [id]: r.ok ? { status: "ok", body: r.body } : { status: "error", error: r.error } })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focused?.id]);

  const resolve = async (spec: AgentNodeSpec, label?: string) => {
    if (!spec.source) return;
    setResolving(true);
    const r = await resolveSkillSource(spec.source);
    setResolving(false);
    if (!r.ok) return toastError(r.error);
    patch({ agent: mergeAgent(spec, { body: r.body, description: r.description ?? spec.description, source: { ...spec.source, hash: r.hash } }), ...(label ? { label } : {}) });
    toast("Skill baixada do GitHub");
  };
  const fresh = node.label === "Nova Skill" || node.label === "Skill";
  const use = (source: { repo: string; skillPath: string }, name: string, description?: string) => {
    const spec: AgentNodeSpec = { role: "skill", description: description ?? agent.description, source };
    const label = fresh ? name : undefined;
    patch({ agent: mergeAgent(spec, {}), ...(label ? { label } : {}) });
    void resolve(spec, label);
  };
  const repoOk = /^[^/\s]+\/[^/\s]+$/.test(repo.trim());
  const useManual = () => {
    const p = path.trim() || "SKILL.md";
    use({ repo: repo.trim(), skillPath: p }, p.split("/").slice(-2, -1)[0] || repo.trim().split("/")[1]);
    setRepo("");
    setPath("");
  };
  /** Setas ↑/↓ na busca andam pela lista sem tirar o foco do campo. */
  const nav = (e: React.KeyboardEvent) => {
    if (!results.length || (e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== "Enter")) return;
    e.preventDefault();
    if (e.key === "Enter") return focused && use(catalogEntryToSource(focused), focused.name, focused.description);
    const i = Math.max(0, results.findIndex((r) => r.id === focused?.id));
    setFocusId(results[(i + (e.key === "ArrowDown" ? 1 : results.length - 1)) % results.length].id);
  };

  return (
    <div className="skill-cat-layout">
      <aside className="skill-cat-side">
        <input className="input skill-search" autoFocus value={query} placeholder="Buscar por nome, assunto ou repositório…" onChange={(e) => setQuery(e.target.value)} onKeyDown={nav} aria-label="Buscar skill no catálogo" aria-controls="skill-cat-list" />
        <span className="skill-cat-count">
          {results.length} de {SKILL_CATALOG.length} skills
        </span>
        <ul id="skill-cat-list" className="skill-cat-list" role="listbox" aria-label="Skills do catálogo">
          {results.map((r) => (
            <li key={r.id} role="option" aria-selected={r.id === focused?.id}>
              <button className={`skill-cat${r.id === focused?.id ? " focused" : ""}${isCurrent(r) ? " active" : ""}`} onClick={() => setFocusId(r.id)} onDoubleClick={() => use(catalogEntryToSource(r), r.name, r.description)}>
                <span className="skill-cat-name">
                  {r.name}
                  {isCurrent(r) && <span className="skill-cat-tag">em uso</span>}
                </span>
                <span className="skill-cat-repo">{r.repo}</span>
                <span className="skill-cat-desc">{r.description}</span>
              </button>
            </li>
          ))}
          {!results.length && <li className="skill-cat-none">Nada no catálogo para «{query}». Use um repositório do GitHub abaixo ou escreva do zero.</li>}
        </ul>
        <details className="skill-manual">
          <summary>Usar outro repositório do GitHub</summary>
          <label className="field">
            <span>Repositório (owner/repo)</span>
            <input className="input" value={repo} placeholder="anthropics/skills" onChange={(e) => setRepo(e.target.value)} />
          </label>
          <label className="field">
            <span>Caminho do SKILL.md</span>
            <input className="input" value={path} placeholder="skills/pdf/SKILL.md" onChange={(e) => setPath(e.target.value)} />
          </label>
          <button className="btn sm" disabled={!repoOk || resolving} onClick={useManual}>
            Usar esta fonte
          </button>
        </details>
        <div className="skill-or">
          Nenhuma serve?
          <button className="btn sm ghost" onClick={onWrite}>
            Escrever do zero
          </button>
        </div>
      </aside>

      <section className="skill-cat-detail" aria-label="Detalhes da skill">
        {current && !SKILL_CATALOG.some(isCurrent) && (
          <div className="skill-current">
            <div>
              <span className="lbl-s">Fonte atual (fora do catálogo)</span>
              <div>
                <code>{current.repo}</code> · <code>{current.skillPath}</code>
              </div>
            </div>
            <button className="btn sm" onClick={() => resolve(agent)} disabled={resolving}>
              {resolving ? "Baixando…" : current.hash ? "Atualizar do GitHub" : "Resolver do GitHub"}
            </button>
          </div>
        )}
        {focused ? (
          <>
            <div className="skill-detail-head">
              <div>
                <h3>{focused.name}</h3>
                <div className="skill-cat-repo">
                  {focused.repo} · {focused.skillPath}
                </div>
              </div>
              <div className="skill-current-actions">
                {isCurrent(focused) ? (
                  <>
                    <button className="btn sm" onClick={() => resolve(agent)} disabled={resolving}>
                      {resolving ? "Baixando…" : current?.hash ? "Atualizar do GitHub" : "Resolver do GitHub"}
                    </button>
                    <button
                      className="btn sm ghost"
                      onClick={() => {
                        upd({ source: undefined });
                        onWrite();
                      }}
                      data-tip="Remove a fonte do catálogo e abre o editor: o corpo vira seu, sem receber mais atualização"
                      data-tip-pos="bottom"
                    >
                      Tornar própria e editar
                    </button>
                  </>
                ) : (
                  <button className="btn primary" onClick={() => use(catalogEntryToSource(focused), focused.name, focused.description)} disabled={resolving}>
                    {resolving ? "Baixando…" : current ? "Trocar por esta skill" : "Usar esta skill"}
                  </button>
                )}
              </div>
            </div>
            <p className="skill-detail-desc">{focused.description}</p>
            {isCurrent(focused) && <div className={current?.hash ? "skill-ok" : "skill-pending"}>{current?.hash ? `Em uso · resolvida (hash ${current.hash})` : "Em uso · ainda não resolvida (A006): o corpo fica vazio até baixar"}</div>}
            <div className="skill-detail-body">
              {!preview || preview.status === "loading" ? (
                <div className="skill-empty">Carregando o SKILL.md do GitHub…</div>
              ) : preview.status === "error" ? (
                <div className="skill-empty">Não deu para carregar a prévia: {preview.error}</div>
              ) : (
                <div className="note-md skill-preview" dangerouslySetInnerHTML={{ __html: renderMarkdown(preview.body) }} />
              )}
            </div>
          </>
        ) : (
          <div className="skill-empty">Escolha uma skill na lista para ver o conteúdo.</div>
        )}
      </section>
    </div>
  );
}

type View = "edit" | "split" | "preview";

function SkillWriteTab({ node, agent, patch, upd }: TabProps) {
  const ta = useRef<HTMLTextAreaElement>(null);
  const [view, setView] = useState<View>("split");
  const body = agent.body ?? "";
  const html = useMemo(() => renderMarkdown(body), [body]);
  const hints = skillHints(agent);
  const locked = !!agent.source;
  const shown: View = locked ? "preview" : view;
  const name = skillSlug(node.label || "skill");
  const insert = (text: string) => (ta.current ? insertBlock(ta.current, text) : upd({ body: body ? `${body}\n\n${text}` : text }));

  return (
    <div className="skill-tab">
      <div className="grid2">
        <label className="field">
          <span>Nome</span>
          <input className="input" value={node.label} onChange={(e) => patch({ label: e.target.value })} aria-describedby="skill-slug" />
          <small id="skill-slug" className="skill-slug">
            vira <code>skills/{name}/SKILL.md</code>
          </small>
        </label>
        <label className="field">
          <span>Description (quando o agente deve usar) · {agent.description?.length ?? 0}</span>
          <textarea className="input" rows={2} value={agent.description ?? ""} placeholder="Use quando for revisar código: aponta estilo, testes faltando e falhas de segurança." onChange={(e) => upd({ description: e.target.value || undefined })} />
        </label>
      </div>

      {locked && (
        <div className="callout">
          Esta skill vem do catálogo (<code>{agent.source!.repo}</code>) e é atualizada a partir do GitHub, por isso o corpo é só leitura aqui.{" "}
          <button className="btn sm" onClick={() => upd({ source: undefined })}>
            Tornar própria e editar
          </button>
        </div>
      )}

      {!locked && (
        <div className="skill-tools">
          <RichToolbar root={ta} plain className="skill-toolbar" />
          <div className="seg skill-view" role="radiogroup" aria-label="Visualização">
            {(["edit", "split", "preview"] as View[]).map((v) => (
              <button key={v} role="radio" aria-checked={view === v} className={view === v ? "active" : ""} onClick={() => setView(v)}>
                {v === "edit" ? "Editar" : v === "split" ? "Dividir" : "Visualizar"}
              </button>
            ))}
          </div>
        </div>
      )}
      {!locked && (
        <div className="skill-snippets" aria-label="Inserir seção">
          <span className="lbl-s">Inserir seção:</span>
          {SKILL_SECTIONS.map((s) => (
            <button key={s.id} className="chip" onMouseDown={(e) => e.preventDefault()} onClick={() => insert(s.text)} data-tip={s.tip} data-tip-pos="top">
              + {s.label}
            </button>
          ))}
        </div>
      )}

      <div className={`skill-editor ${body ? shown : "edit"}`}>
        {shown !== "preview" &&
          (body ? (
            <RichEditor innerRef={ta} value={body} onChange={(v) => upd({ body: v || undefined })} className="input skill-src" label="Corpo do SKILL.md (markdown)" placeholder="Escreva em markdown…" />
          ) : (
            <div className="skill-empty">
              <p>Corpo vazio. Comece por uma estrutura pronta e preencha os «…», ou escreva livre.</p>
              <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
                <button className="btn primary sm" onClick={() => upd({ body: skillSkeleton(node.label || "Skill") })}>
                  Usar estrutura sugerida
                </button>
                <button className="btn sm" onClick={() => upd({ body: `# ${node.label || "Skill"}\n\n` })}>
                  Em branco
                </button>
              </div>
            </div>
          ))}
        {shown !== "edit" && (body ? <div className="note-md skill-preview" aria-label="Pré-visualização" dangerouslySetInnerHTML={{ __html: html }} /> : shown === "preview" && <div className="skill-empty">Nada para mostrar ainda.</div>)}
      </div>

      {hints.length > 0 && (
        <ul className="skill-hints" aria-label="Dicas de escrita">
          {hints.map((h, i) => (
            <li key={i} className={h.sev}>
              {h.text}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ───────── relação de agents numa conexão ───────── */

export function AgentConnFields({ conn, patch }: { conn: ConnectionEl; patch: Patch }) {
  const doc = useStore((s) => s.doc);
  const a = conn.agent;
  const valid = suggestAgentRels(doc, conn.from, conn.to);
  const setRel = (rel: AgentRel | "") => {
    if (!rel) return patch({ agent: null });
    patch({ agent: { rel }, type: AGENT_RELS[rel].type });
  };
  return (
    <>
      <label className="field">
        <span>Relação</span>
        <select className="input" value={a?.rel ?? ""} onChange={(e) => setRel(e.target.value as AgentRel | "")}>
          <option value="">— sem relação —</option>
          {AGENT_REL_KEYS.map((r) => (
            <option key={r} value={r} disabled={!valid.includes(r) && a?.rel !== r}>
              {AGENT_RELS[r].label}
              {valid.includes(r) ? "" : a?.rel === r ? " (inválida para este par)" : " (não liga este par)"}
            </option>
          ))}
        </select>
      </label>
      {!a && <div className="callout">{valid.length ? `Sem relação. Para este par: ${valid.join(", ")}.` : "Nenhuma relação do modo agents liga este par (precisa ser agent → skill ou agent → agent)."}</div>}
      {a && <div className="callout">{AGENT_RELS[a.rel].semantics}{!valid.includes(a.rel) && " Atenção: esta combinação não é válida para esta relação (aviso A008)."}</div>}
    </>
  );
}
