import { useEffect, useMemo, useRef, useState } from "react";
import { AGENT_FILE_KINDS, AGENT_FILE_KIND_KEYS, AGENT_FILE_MAX_CHARS, AGENT_RELS, AGENT_REL_KEYS, AGENT_ROLES, AGENT_ROLE_KEYS, MCP_TRANSPORTS, NATIVE_TOOLS, NATIVE_TOOL_NAMES, type AgentFileKind, type McpTransport, type AgentNodeSpec, type AgentRel, type AgentRole, type ConnectionEl, type NodeEl } from "../shared/schema";
import { imageMime, kindOfFileName } from "../shared/agentfiles";
import { mcpVars } from "../shared/mcpcatalog";
import { isOrchestrator, testPrompt } from "../shared/agentprompt";
import { inGlobalGroup, looksLikeSecret, reshapeAgent, suggestAgentRels, workflowSteps } from "../shared/agents";
import { checkExpects } from "../shared/expects";
import { promptVars } from "../shared/prompts";
import { SKILL_CATALOG, catalogEntryToSource, mergeSkillCatalog, parseSkillGithubUrl, resolveSkillSource, searchSkillCatalog, skillInstallSlug, type SkillCatalogEntry } from "../shared/skillcatalog";
import { renderMarkdown } from "./markdown";
import { Glyph } from "./icons";
import { TextField } from "./panels";
import { insertBlock, RichEditor, RichToolbar } from "./richeditor";
import { installGithubSkills, searchSkillsHub, topSkillsHub, listSkillSources, addSkillSource, refreshSkillSources, removeSkillSource, indexedSkills, loadDownloadedSkills, renameNode, checkMcpEnv, probeMcpServer, plugTool, convertLegacyTools, runInTerminal, runNodeInTerminal, setPromptAgent, addWorkflowStep, reorderWorkflowSteps, type SkillSourceInfo, run, set, toast, toastError, useStore } from "./store";

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
      {agent.role === "agent" && <AgentRoleFields node={node} agent={agent} upd={upd} />}
      {agent.role === "skill" && <SkillRoleFields node={node} agent={agent} upd={upd} />}
      {agent.role === "tool" && <ToolRoleFields node={node} agent={agent} upd={upd} patch={patch} />}
      {agent.role === "prompt" && <PromptRoleFields node={node} agent={agent} upd={upd} />}
      {agent.role === "workflow" && <WorkflowRoleFields node={node} agent={agent} upd={upd} />}
      {(agent.role === "file" || agent.role === "output") && <FileRoleFields agent={agent} upd={upd} />}
    </>
  );
}

/* ───────── nó file / output ───────── */

/** Lê o arquivo escolhido: texto como está (UTF-8); planilha e imagem em base64, sem o prefixo do data URL. */
function readUpload(file: File, binary: boolean): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const s = String(r.result);
      resolve(binary ? s.slice(s.indexOf(",") + 1) : s);
    };
    r.onerror = () => reject(r.error);
    if (binary) r.readAsDataURL(file);
    else r.readAsText(file, "utf-8");
  });
}

const ALL_FILE_ACCEPT = AGENT_FILE_KIND_KEYS.map((k) => AGENT_FILE_KINDS[k].accept).join(",");

/**
 * Nó `file` (referência que o agente lê) e `output` (componente de saída, como o nó de response do n8n).
 * Em `output` o arquivo anexado é o modelo da saída (a especificação); o nome é o caminho que o agente grava.
 */
function FileRoleFields({ agent, upd }: { agent: AgentNodeSpec; upd: (p: Record<string, unknown>) => void }) {
  const isOutput = agent.role === "output";
  const kind: AgentFileKind = agent.fileKind ?? "json";
  const hasContent = !!agent.fileContent;
  const sizeKb = hasContent ? Math.max(1, Math.round(((agent.fileContent!.length * (AGENT_FILE_KINDS[kind].binary ? 3 : 4)) / 4) / 1024)) : 0;

  const changeKind = (next: AgentFileKind) => {
    if (next === agent.fileKind) return;
    // trocar entre texto e binário invalida o conteúdo já anexado (a codificação muda)
    const crossed = AGENT_FILE_KINDS[next].binary !== AGENT_FILE_KINDS[kind].binary;
    upd({ fileKind: next, ...(crossed && hasContent ? { fileContent: undefined } : {}) });
  };

  const attach = async (file: File | undefined) => {
    if (!file) return;
    const fromName = kindOfFileName(file.name);
    if (!fromName) return toastError(`Formato sem suporte: ${file.name}. Aceitos: JSON, CSV, Excel (.xlsx), Markdown, HTML e imagens.`);
    const binary = AGENT_FILE_KINDS[fromName].binary;
    const content = await readUpload(file, binary).catch(() => undefined);
    if (content === undefined) return toastError(`Não consegui ler ${file.name}.`);
    if (content.length > AGENT_FILE_MAX_CHARS) return toastError(`${file.name} é grande demais para o diagrama (teto de ${AGENT_FILE_MAX_CHARS.toLocaleString("pt-BR")} caracteres depois de codificado).`);
    // no output o nome é o caminho de saída: anexar o modelo não o troca
    upd(isOutput ? { fileKind: fromName, fileContent: content } : { fileKind: fromName, fileName: file.name, fileContent: content });
  };

  return (
    <>
      <label className="field">
        <span>{isOutput ? "Formato entregue" : "Formato do arquivo"}</span>
        <select className="input" value={agent.fileKind ?? ""} onChange={(e) => changeKind(e.target.value as AgentFileKind)}>
          {!agent.fileKind && <option value="">{isOutput ? "JSON (padrão)" : "Escolha o formato…"}</option>}
          {AGENT_FILE_KIND_KEYS.map((k) => (
            <option key={k} value={k}>
              {AGENT_FILE_KINDS[k].label}
            </option>
          ))}
        </select>
      </label>
      {isOutput && (
        <label className="field">
          <span>Arquivo de saída <small className="opt">caminho relativo à raiz do projeto</small></span>
          <TextField value={agent.fileName ?? ""} placeholder="relatorio.md" onCommit={(v) => upd({ fileName: v.trim() || undefined })} />
        </label>
      )}
      <div className="field">
        <span>{isOutput ? "Modelo da saída" : "Arquivo"} <small className="opt">{isOutput ? "opcional: a especificação que o agente segue" : "JSON, CSV, Excel, Markdown, HTML ou imagem"}</small></span>
        {hasContent && (
          <>
            {kind === "image" && <img alt={agent.fileName ?? "imagem"} src={`data:${imageMime(agent.fileName)};base64,${agent.fileContent}`} style={{ maxWidth: "100%", maxHeight: 160, borderRadius: 8, alignSelf: "flex-start" }} />}
            <div className="callout" style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {agent.fileName ?? (isOutput ? "modelo" : "arquivo")} · {AGENT_FILE_KINDS[kind].label} · ~{sizeKb} KB
              </span>
              <button className="btn ghost sm" onClick={() => upd(isOutput ? { fileContent: undefined } : { fileContent: undefined, fileName: undefined })}>Remover</button>
            </div>
          </>
        )}
        <input className="input" type="file" accept={ALL_FILE_ACCEPT} aria-label={isOutput ? "Anexar modelo da saída" : "Anexar arquivo"} onChange={(e) => { void attach(e.target.files?.[0]); e.target.value = ""; }} />
      </div>
      {kind === "xlsx" && hasContent && <div className="callout">Planilhas vão como estão: a tool Read do Claude Code não abre .xlsx, então o agente precisa de uma tool que a leia (ex.: Bash com Python).</div>}
      {!isOutput && !hasContent && <div className="callout warn">Sem arquivo anexado ele não entra no harness (aviso A025).</div>}
      <label className="field">
        <span>{isOutput ? "O que entrega" : "Quando usar"} <small className="opt">opcional</small></span>
        <TextField multiline value={agent.description ?? ""} placeholder={isOutput ? "Relatório de riscos, um item por linha" : "Schema de validação dos dados de entrada"} onCommit={(v) => upd({ description: v.trim() || undefined })} />
      </label>
    </>
  );
}

/* ───────── nó prompt / workflow ───────── */

function RunButton({ id, what }: { id: string; what: string }) {
  const avail = useStore((s) => s.termAvail);
  return (
    <button className="btn sm" style={{ marginBottom: 10 }} disabled={avail === false} onClick={() => runNodeInTerminal(id)} data-tip={avail === false ? "O terminal não está disponível (veja o botão «Terminal» da barra)." : `Abre o terminal do Claude Code com ${what}. O harness é sincronizado antes.`} data-tip-pos="left">
      ▶ Executar no Claude Code
    </button>
  );
}

function PromptRoleFields({ node, agent, upd }: { node: NodeEl; agent: AgentNodeSpec; upd: (p: Record<string, unknown>) => void }) {
  const doc = useStore((s) => s.doc);
  const agents = doc.nodes.filter((n) => n.agent?.role === "agent");
  const host = doc.connections.find((c) => c.from === node.id && c.agent?.rel === "runs-on")?.to ?? "";
  const vars = promptVars(agent.text ?? "");
  return (
    <>
      <RunButton id={node.id} what="o texto digitado (sem Enter)" />
      <label className="field">
        <span>Texto do prompt</span>
        <TextField multiline value={agent.text ?? ""} placeholder="Revise {{arquivo}} e liste os riscos de segurança." onCommit={(v) => upd({ text: v.trim() ? v : undefined })} />
        <small className="hint">Use {"{{variável}}"} para o que muda a cada execução.{vars.length > 0 && ` Variáveis: ${vars.join(", ")}.`} Em um workflow, <code>{"{{anterior}}"}</code> traz a resposta do passo anterior e <code>{"{{resultado.id-do-prompt}}"}</code> a de um passo específico.</small>
      </label>
      {!agent.text?.trim() && <div className="callout warn">Sem texto não há o que executar (A020).</div>}
      <label className="field">
        <span>Subagente <small className="opt">opcional (seta runs-on)</small></span>
        <select className="input" value={host} onChange={(e) => setPromptAgent(node.id, e.target.value)}>
          <option value="">Conversa normal</option>
          {agents.map((a) => (
            <option key={a.id} value={a.id}>
              {a.label}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Notas <small className="opt">opcional</small></span>
        <TextField multiline value={agent.description ?? ""} placeholder="Só para você" onCommit={(v) => upd({ description: v.trim() || undefined })} />
      </label>
    </>
  );
}

function WorkflowRoleFields({ node, agent, upd }: { node: NodeEl; agent: AgentNodeSpec; upd: (p: Record<string, unknown>) => void }) {
  const doc = useStore((s) => s.doc);
  const steps = workflowSteps(doc, node.id);
  const free = doc.nodes.filter((n) => n.agent?.role === "prompt");
  const move = (i: number, d: -1 | 1) => {
    const ids = steps.map((s) => s.conn);
    const j = i + d;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    reorderWorkflowSteps(node.id, ids);
  };
  const setMode = (conn: string, mode: "manual" | "auto") => {
    const c = doc.connections.find((x) => x.id === conn);
    if (!c?.agent) return;
    const { mode: _drop, ...rest } = c.agent;
    run([{ op: "update", id: conn, patch: { agent: mode === "auto" ? { ...rest, mode } : rest } }]);
  };
  return (
    <>
      <RunButton id={node.id} what="o formulário do workflow" />
      <div className="field">
        <span>Passos <small className="opt">(setas step)</small></span>
        {!steps.length && <div className="callout">Sem passos. Adicione prompts abaixo ou ligue o workflow a um prompt no canvas (A022).</div>}
        {steps.map((s, i) => (
          <div key={s.conn} className="wf-step wf-step-edit">
            <span className="wf-n">{i + 1}</span>
            <span className="wf-name" title={s.prompt.agent?.text}>{s.prompt.label}</span>
            <div className="tseg sm" role="radiogroup" aria-label={`Modo do passo ${i + 1}`}>
              <button role="radio" aria-checked={s.mode === "manual"} className={s.mode === "manual" ? "on" : ""} title="Você confirma cada passo no terminal" onClick={() => setMode(s.conn, "manual")}>Manual</button>
              <button role="radio" aria-checked={s.mode === "auto"} className={s.mode === "auto" ? "on" : ""} title="Roda sozinho (claude -p) e segue ao terminar" onClick={() => setMode(s.conn, "auto")}>Auto</button>
            </div>
            <button className="btn ghost icon sm" aria-label="Mover para cima" disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
            <button className="btn ghost icon sm" aria-label="Mover para baixo" disabled={i === steps.length - 1} onClick={() => move(i, 1)}>↓</button>
            <button className="btn ghost icon sm" aria-label="Remover passo" onClick={() => { run([{ op: "remove", id: s.conn }]); reorderWorkflowSteps(node.id, steps.filter((x) => x.conn !== s.conn).map((x) => x.conn)); }}>×</button>
          </div>
        ))}
        <select className="input" aria-label="Adicionar passo" value="" disabled={!free.length} onChange={(e) => e.target.value && addWorkflowStep(node.id, e.target.value)}>
          <option value="">{free.length ? "+ Adicionar passo" : "Crie prompts no diagrama primeiro"}</option>
          {free.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
      </div>
      <label className="field">
        <span>Notas <small className="opt">opcional</small></span>
        <TextField multiline value={agent.description ?? ""} placeholder="O que este workflow entrega" onCommit={(v) => upd({ description: v.trim() || undefined })} />
      </label>
    </>
  );
}

const MODEL_OPTIONS = ["inherit", "sonnet", "opus", "haiku"];

function AgentRoleFields({ node, agent, upd }: { node: NodeEl; agent: AgentNodeSpec; upd: (p: Record<string, unknown>) => void }) {
  const doc = useStore((s) => s.doc);
  const avail = useStore((s) => s.termAvail);
  const orch = isOrchestrator(doc, node.id);
  return (
    <>
      <button className="btn sm" style={{ marginBottom: 10 }} disabled={avail === false} onClick={() => runInTerminal(testPrompt(node.id), `Testar ${node.id}`)} data-tip={avail === false ? "O terminal não está disponível (veja o botão «Terminal» da barra)." : `Abre o Claude Code na pasta do projeto com «${testPrompt(node.id).trim()}» já digitado. O harness é sincronizado antes.`} data-tip-pos="left">
        ▶ {orch ? "Testar orquestrador no Claude Code" : "Testar no Claude Code"}
      </button>
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
      <AgentToolsSection node={node} agent={agent} />
      <label className="field">
        <span>Prompt (corpo do system prompt do subagente)</span>
        <TextField multiline value={agent.prompt ?? ""} placeholder="Você é um revisor de código focado em…" onCommit={(v) => upd({ prompt: v.trim() || undefined })} />
      </label>
    </>
  );
}


/** Ferramentas ligadas a um agent (e o atalho para plugar mais). Substitui o antigo campo de texto «tools». */
function AgentToolsSection({ node, agent }: { node: NodeEl; agent: AgentNodeSpec }) {
  const doc = useStore((s) => s.doc);
  const linked = doc.connections.filter((c) => c.from === node.id && c.agent?.rel === "uses-tool").map((c) => doc.nodes.find((n) => n.id === c.to)).filter((n): n is NodeEl => !!n);
  const global = doc.nodes.filter((n) => n.agent?.role === "tool" && !linked.some((l) => l.id === n.id) && inGlobalGroup(doc, n.id));
  return (
    <div className="field">
      <span className="lbl-s">Ferramentas</span>
      {linked.length || global.length ? (
        <div className="callout">
          {linked.map((t) => (
            <div key={t.id}>
              <b>{t.label}</b> <small style={{ opacity: 0.7 }}>{t.agent?.toolType === "mcp" ? "MCP" : "nativa"}</small>
            </div>
          ))}
          {global.map((t) => (
            <div key={t.id}>
              <b>{t.label}</b> <small style={{ opacity: 0.7 }}>{t.agent?.toolType === "mcp" ? "MCP" : "nativa"} · global</small>
            </div>
          ))}
        </div>
      ) : (
        <div className="callout">Sem ferramentas ligadas: o agente herda todas as tools disponíveis.</div>
      )}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <select
          className="input"
          style={{ flex: 1, minWidth: 140 }}
          value=""
          aria-label="Adicionar tool nativa"
          onChange={(e) => e.target.value && plugTool({ agentId: node.id, toolType: "native", toolName: e.target.value })}
        >
          <option value="">+ Tool nativa…</option>
          {NATIVE_TOOL_NAMES.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
        <button className="btn sm" onClick={() => plugTool({ agentId: node.id })}>
          + Buscar tool / MCP
        </button>
      </div>
      {!!agent.tools?.length && (
        <div className="callout warn" style={{ marginTop: 8 }}>
          Lista de texto antiga: <code>{agent.tools.join(", ")}</code> (A014).{" "}
          <button className="btn sm" onClick={() => convertLegacyTools(node.id)}>
            Converter em componentes
          </button>
        </div>
      )}
    </div>
  );
}

const linesToMap = (text: string, sep: RegExp): Record<string, string> =>
  Object.fromEntries(
    text
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => {
        const m = sep.exec(l);
        return m ? [l.slice(0, m.index).trim(), l.slice(m.index + m[0].length).trim()] : [l, ""];
      })
      .filter(([k]) => k),
  );
const mapToLines = (m: Record<string, string> | undefined, sep: string) => Object.entries(m ?? {}).map(([k, v]) => `${k}${sep}${v}`).join("\n");

/** Variáveis `${VAR}` do servidor e se cada uma existe no ambiente do Archflow (só sim/não; o valor nunca aparece). */
function McpVarsStatus({ agent }: { agent: AgentNodeSpec }) {
  const online = useStore((s) => s.storage === "server" && s.online);
  const vars = mcpVars(agent);
  const key = vars.map((v) => v.name).join(",");
  const [status, setStatus] = useState<Record<string, boolean>>({});
  useEffect(() => {
    if (!online || !key) return void setStatus({});
    let stale = false;
    checkMcpEnv(key.split(",")).then((r) => !stale && setStatus(r), () => !stale && setStatus({}));
    return () => void (stale = true);
  }, [key, online]);
  if (!vars.length) return null;
  return (
    <div className="callout">
      <b>Variáveis de ambiente</b>
      {vars.map((v) => {
        const known = v.name in status;
        const ok = status[v.name];
        return (
          <div key={v.name}>
            <code>{v.name}</code> {!known ? "" : ok ? "· definida" : v.hasDefault ? "· não definida (usa o padrão)" : "· faltando"}
          </div>
        );
      })}
      <small style={{ opacity: 0.75 }}>{online ? "Conferido no ambiente do Archflow; o Claude Code lê o ambiente dele." : "Sem servidor local não dá para conferir."}</small>
    </div>
  );
}

/**
 * «Testar servidor»: faz o handshake MCP e lista as tools que o servidor expõe. Isso EXECUTA o comando (stdio) ou
 * conecta na URL, então só acontece depois de o usuário ver exatamente o que será executado e confirmar.
 */
function McpProbe({ agent, upd }: { agent: AgentNodeSpec; upd: (p: Record<string, unknown>) => void }) {
  const online = useStore((s) => s.storage === "server" && s.online);
  const [phase, setPhase] = useState<"idle" | "confirm" | "running" | "done" | "error">("idle");
  const [result, setResult] = useState<{ tools: { name: string; description?: string }[]; server?: { name?: string; version?: string } }>();
  const [error, setError] = useState("");
  const transport = agent.transport ?? (agent.url ? "http" : "stdio");
  const target = transport === "stdio" ? [agent.command, ...(agent.args ?? [])].filter(Boolean).join(" ") : agent.url ?? "";
  const ready = !!target;
  const run = async () => {
    setPhase("running");
    try {
      setResult(await probeMcpServer({ transport, command: agent.command, args: agent.args, url: agent.url, env: agent.env, headers: agent.headers }));
      setPhase("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase("error");
    }
  };
  const known = (agent.mcpTools ?? []).join("\n");
  const found = (result?.tools ?? []).map((t) => t.name).join("\n");
  return (
    <div className="field">
      <span className="lbl-s">Testar servidor</span>
      {phase === "idle" && (
        <button className="btn sm" disabled={!online || !ready} onClick={() => setPhase("confirm")} data-tip={online ? "Conecta e lista as tools do servidor" : "Precisa do servidor local (npm run dev)"} data-tip-pos="left">
          Testar servidor…
        </button>
      )}
      {phase === "confirm" && (
        <div className="callout warn" role="alertdialog" aria-label="Confirmar execução">
          {transport === "stdio" ? "Isto vai EXECUTAR no seu computador:" : "Isto vai CONECTAR em:"}
          <pre className="code" style={{ margin: "6px 0", whiteSpace: "pre-wrap" }}>{target}</pre>
          <small style={{ opacity: 0.8 }}>As variáveis {"${VAR}"} são lidas do ambiente do Archflow e nunca aparecem no resultado. Só continue se você confia neste servidor.</small>
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <button className="btn sm primary" onClick={run}>
              Executar e listar tools
            </button>
            <button className="btn sm" onClick={() => setPhase("idle")}>
              Cancelar
            </button>
          </div>
        </div>
      )}
      {phase === "running" && <div className="callout">Conectando… (até 10 s)</div>}
      {phase === "error" && (
        <div className="callout warn">
          {error}{" "}
          <button className="btn sm" onClick={() => setPhase("confirm")}>
            Tentar de novo
          </button>
        </div>
      )}
      {phase === "done" && result && (
        <div className="callout">
          <b>{result.server?.name ?? "Servidor"}</b>
          {result.server?.version ? ` ${result.server.version}` : ""}: {result.tools.length} tool{result.tools.length === 1 ? "" : "s"}
          <div style={{ marginTop: 4 }}>
            {result.tools.map((t) => (
              <div key={t.name} title={t.description}>
                <code>{t.name}</code>
                {t.description ? <small style={{ opacity: 0.75 }}> — {t.description}</small> : null}
              </div>
            ))}
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <button className="btn sm primary" disabled={!result.tools.length || known === found} onClick={() => upd({ mcpTools: result.tools.map((t) => t.name) })}>
              {known === found && found ? "Já são as tools conhecidas" : "Usar como tools conhecidas"}
            </button>
            <button className="btn sm" onClick={() => setPhase("idle")}>
              Fechar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** O mesmo formulário do inspetor, para a aba «Configurar» do diálogo da Tool. */
export function ToolEditor({ node }: { node: NodeEl }) {
  const agent = node.agent!;
  const patch = (p: Record<string, unknown>) => run([{ op: "update", id: node.id, patch: p }]);
  return <ToolRoleFields node={node} agent={agent} upd={(p) => patch({ agent: mergeAgent(agent, p) })} patch={patch} />;
}

/** Tool: nativa (nome da lista) ou servidor MCP (nome, transporte, comando/URL, variáveis, tools). */
function ToolRoleFields({ node, agent, upd, patch }: { node: NodeEl; agent: AgentNodeSpec; upd: (p: Record<string, unknown>) => void; patch: Patch }) {
  const type = agent.toolType ?? "native";
  const transport: McpTransport = agent.transport ?? (agent.url ? "http" : "stdio");
  const setType = (t: "native" | "mcp") => t !== type && patch({ agent: t === "native" ? { role: "tool", toolType: "native" } : { role: "tool", toolType: "mcp", transport: "stdio", ...(agent.description ? { description: agent.description } : {}) } });
  const leaks = [...Object.entries(agent.env ?? {}), ...Object.entries(agent.headers ?? {})].filter(([k, v]) => looksLikeSecret(k, v)).map(([k]) => k);
  return (
    <>
      <div className="field">
        <span className="lbl-s">Tipo</span>
        <div className="seg" role="radiogroup" aria-label="Tipo de ferramenta">
          {([["native", "Nativa"], ["mcp", "Servidor MCP"]] as const).map(([k, l]) => (
            <button key={k} role="radio" aria-checked={type === k} className={type === k ? "active" : ""} onClick={() => setType(k)}>
              {l}
            </button>
          ))}
        </div>
      </div>
      <div className="field">
        <div className="callout skill-summary">
          <b>{agent.mcpSource ? `Do catálogo (${{ curated: "curado", registry: "registro oficial", pasted: "colado" }[agent.mcpSource.catalog]})` : type === "mcp" || agent.toolName ? "Configurada à mão" : "Ainda não escolhida"}</b>
          {agent.mcpSource?.version && <> · versão {agent.mcpSource.version}</>}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn sm" onClick={() => set({ modal: { type: "tool", id: node.id, tab: "search" } })}>
            Buscar no catálogo
          </button>
          <button className="btn sm" onClick={() => set({ modal: { type: "tool", id: node.id, tab: "paste" } })}>
            Colar config
          </button>
        </div>
      </div>
      {type === "native" ? (
        <>
          <label className="field">
            <span>Tool</span>
            <select className="input" value={agent.toolName ?? ""} onChange={(e) => patch({ label: e.target.value || node.label, agent: mergeAgent(agent, { toolName: e.target.value || undefined }) })}>
              <option value="">— escolha —</option>
              {NATIVE_TOOL_NAMES.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
              {agent.toolName && !NATIVE_TOOL_NAMES.includes(agent.toolName) && <option value={agent.toolName}>{agent.toolName} (desconhecida)</option>}
            </select>
          </label>
          {agent.toolName && NATIVE_TOOLS[agent.toolName] && <div className="callout">{NATIVE_TOOLS[agent.toolName]}</div>}
          {!agent.toolName && <div className="callout warn">Escolha a tool: sem nome ela não entra no harness (A013).</div>}
        </>
      ) : (
        <>
          <label className="field">
            <span>Nome do servidor (vira <code>mcp__nome__tool</code>)</span>
            <TextField
              value={node.label}
              placeholder="playwright"
              onCommit={(v) => {
                if (!v.trim()) return;
                patch({ label: v.trim() });
                renameNode(node.id, v.trim());
              }}
            />
          </label>
          <label className="field">
            <span>Description (o que o servidor faz)</span>
            <TextField multiline value={agent.description ?? ""} placeholder="Controla um navegador real para testar a interface." onCommit={(v) => upd({ description: v.trim() || undefined })} />
          </label>
          <label className="field">
            <span>Transporte</span>
            <select className="input" value={transport} onChange={(e) => upd({ transport: e.target.value })}>
              {Object.entries(MCP_TRANSPORTS).map(([k, l]) => (
                <option key={k} value={k}>
                  {k} — {l}
                </option>
              ))}
            </select>
          </label>
          {transport === "stdio" ? (
            <>
              <label className="field">
                <span>Comando</span>
                <TextField value={agent.command ?? ""} placeholder="npx" onCommit={(v) => upd({ command: v.trim() || undefined })} />
              </label>
              <label className="field">
                <span>Argumentos (um por linha)</span>
                <TextField multiline value={(agent.args ?? []).join("\n")} placeholder={"-y\n@playwright/mcp@latest"} onCommit={(v) => upd({ args: v.split("\n").map((s) => s.trim()).filter(Boolean) })} />
              </label>
              <label className="field">
                <span>Variáveis de ambiente (NOME=valor; segredo sempre como {"${VAR}"})</span>
                <TextField multiline value={mapToLines(agent.env, "=")} placeholder={"API_KEY=${MINHA_API_KEY}"} onCommit={(v) => upd({ env: linesToMap(v, /=/) })} />
              </label>
            </>
          ) : (
            <>
              <label className="field">
                <span>URL</span>
                <TextField value={agent.url ?? ""} placeholder="https://exemplo.com/mcp" onCommit={(v) => upd({ url: v.trim() || undefined })} />
              </label>
              <label className="field">
                <span>Cabeçalhos (Nome: valor; segredo sempre como {"${VAR}"})</span>
                <TextField multiline value={mapToLines(agent.headers, ": ")} placeholder={"Authorization: Bearer ${MEU_TOKEN}"} onCommit={(v) => upd({ headers: linesToMap(v, /:\s*/) })} />
              </label>
            </>
          )}
          <McpVarsStatus agent={agent} />
          <McpProbe agent={agent} upd={upd} />
          {leaks.length > 0 && <div className="callout warn">{leaks.join(", ")}: parece um segredo em texto puro. Use uma variável de ambiente, como <code>{"${NOME}"}</code> (A011); o valor nunca deve ir para o diagrama nem para o <code>.mcp.json</code>.</div>}
          <label className="field">
            <span>Tools que o servidor expõe (uma por linha; opcional — alimenta a lista de permitidas por agente)</span>
            <TextField multiline value={(agent.mcpTools ?? []).join("\n")} placeholder={"browser_navigate\nbrowser_click"} onCommit={(v) => upd({ mcpTools: v.split("\n").map((s) => s.trim()).filter(Boolean) })} />
          </label>
        </>
      )}
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
  // skill nova nasce como «skill», «skill-2»…; ao receber o nome do catálogo o id acompanha (é o nome no harness)
  const generic = /^skill(-\d+)?$/.test(id) && !!node?.agent?.source && !/^(skill|nova skill)$/i.test(node.label ?? "skill");
  useEffect(() => {
    if (generic && node) renameNode(id, node.label);
  }, [generic, id, node?.label]); // eslint-disable-line react-hooks/exhaustive-deps
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

/** Áreas de desenvolvimento: cada uma vira uma busca no skills.sh, ordenada pelas mais instaladas. */
const SKILL_AREAS = [
  { label: "Front-end", q: "frontend react" },
  { label: "Back-end", q: "backend api" },
  { label: "Requisitos", q: "requirements prd" },
  { label: "UI", q: "ui design" },
  { label: "UX", q: "ux" },
  { label: "Motion graphics", q: "motion animation" },
  { label: "Banco de dados", q: "database postgres" },
  { label: "Arquitetura", q: "architecture" },
];

type Preview = { status: "loading" } | { status: "ok"; body: string } | { status: "error"; error: string };

function SkillCatalogTab({ node, agent, patch, upd, onWrite }: TabProps & { onWrite: () => void }) {
  const custom = useStore((s) => s.skillCatalog);
  const catalog = useMemo(() => mergeSkillCatalog(custom), [custom]);
  const current = agent.source;
  const isCurrent = (e: SkillCatalogEntry) => current?.repo === e.repo && current.skillPath === e.skillPath;
  const [query, setQuery] = useState("");
  const [focusId, setFocusId] = useState<string | undefined>(() => catalog.find(isCurrent)?.id);
  const [previews, setPreviews] = useState<Record<string, Preview>>({});
  const [resolving, setResolving] = useState(false);
  const [installing, setInstalling] = useState(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => void (alive.current = false);
  }, []);
  const [hub, setHub] = useState<SkillCatalogEntry[]>([]);
  const [hubState, setHubState] = useState<"idle" | "loading" | "error">("idle");
  const [area, setArea] = useState(-1);
  const ghLink = /github\.com|githubusercontent\.com/i.test(query) ? parseSkillGithubUrl(query) : undefined;
  const typed = query.trim().length >= 2 && !ghLink;
  useEffect(() => {
    const q = typed ? query.trim() : area >= 0 ? SKILL_AREAS[area].q : "";
    let stale = false;
    setHubState("loading");
    const t = setTimeout(() => {
      (q ? searchSkillsHub(q) : topSkillsHub())
        .then((list) => {
          if (stale) return;
          setHub((q ? [...list].sort((a, b) => b.installs - a.installs) : list).map((h) => ({ id: `hub:${h.repo}/${h.skillId}`, name: h.name, repo: h.repo, skillPath: `skills/${h.skillId}/SKILL.md`, description: `${h.installs.toLocaleString("pt-BR")} instalações · catálogo skills.sh`, tags: "skills.sh", remote: true })));
          setHubState("idle");
        })
        .catch(() => !stale && (setHub([]), setHubState("error")));
    }, 350);
    return () => ((stale = true), clearTimeout(t));
  }, [query, area]);
  const [sources, setSources] = useState<SkillSourceInfo[]>([]);
  const [indexed, setIndexed] = useState<SkillCatalogEntry[]>([]);
  const [srcBusy, setSrcBusy] = useState(false);
  const [srcInput, setSrcInput] = useState("");
  const loadIndexed = () => indexedSkills().then((l) => alive.current && setIndexed(l.map((k) => ({ id: `src:${k.repo}/${k.skillPath}`, name: k.name, repo: k.repo, skillPath: k.skillPath, description: k.description || "Sem description no SKILL.md.", tags: "fonte", remote: true })))).catch(() => undefined);
  const srcRun = async (fn: () => Promise<SkillSourceInfo[]>) => {
    setSrcBusy(true);
    try {
      const list = await fn();
      if (alive.current) setSources(list);
      await loadIndexed();
    } catch (e) {
      toastError(e instanceof Error ? e.message : String(e));
    } finally {
      if (alive.current) setSrcBusy(false);
    }
  };
  useEffect(() => void loadDownloadedSkills(), []);
  useEffect(() => {
    // Fontes novas (nunca indexadas) são indexadas na primeira abertura, em segundo plano.
    listSkillSources()
      .then((list) => {
        setSources(list);
        void loadIndexed();
        if (list.some((s) => !s.indexedAt && !s.error)) void srcRun(() => refreshSkillSources());
      })
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const local = query.trim() ? searchSkillCatalog(query, custom) : catalog;
  const results = useMemo(() => {
    const have = new Set(local.map((e) => `${e.repo.toLowerCase()}/${skillInstallSlug(e.skillPath) ?? e.id}`.toLowerCase()));
    const fromSources = typed ? searchSkillCatalog(query, indexed) .filter((e) => e.remote) : indexed;
    const extra = [...hub, ...fromSources].filter((e) => {
      const k = `${e.repo}/${skillInstallSlug(e.skillPath) ?? e.id}`.toLowerCase();
      if (have.has(k)) return false;
      have.add(k);
      return true;
    });
    return [...local, ...extra];
  }, [local, hub, indexed, typed, query]);
  const [detail, setDetail] = useState(false);
  const focused = detail ? results.find((r) => r.id === focusId) ?? results[0] : undefined;
  const preview = focused && isCurrent(focused) && agent.body ? ({ status: "ok", body: agent.body } as Preview) : focused?.body ? ({ status: "ok", body: focused.body } as Preview) : focused ? previews[focused.id] : undefined;
  const manualSource = !!current && !SKILL_CATALOG.some((e) => e.repo === current.repo && e.skillPath === current.skillPath);

  useEffect(() => {
    if (!focused || focused.remote || focused.body || previews[focused.id] || (isCurrent(focused) && agent.body)) return;
    const id = focused.id;
    setPreviews((p) => ({ ...p, [id]: { status: "loading" } }));
    resolveSkillSource(catalogEntryToSource(focused)).then((r) => setPreviews((p) => ({ ...p, [id]: r.ok ? { status: "ok", body: r.body } : { status: "error", error: r.error } })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focused?.id]);

  const fresh = node.label === "Nova Skill" || node.label === "Skill";
  const resolve = async (spec: AgentNodeSpec, label?: string, force = false): Promise<boolean> => {
    if (!spec.source) return false;
    const curated = SKILL_CATALOG.some((e) => e.repo === spec.source!.repo && e.skillPath === spec.source!.skillPath);
    setResolving(true);
    if (!curated) setInstalling(true);
    try {
      if (!curated) {
        const { installed, project } = await installGithubSkills(spec.source.repo, spec.source.skillPath, force);
        const slug = skillInstallSlug(spec.source.skillPath);
        const match = (slug && installed.find((s) => s.id.toLowerCase() === slug.toLowerCase())) || installed.find((s) => s.skillPath === spec.source!.skillPath) || installed[0];
        if (!match?.body) {
          toastError("O npx skills add não devolveu o conteúdo da skill");
          return false;
        }
        const repoName = spec.source.repo.split("/")[1];
        const rename = fresh || node.label === repoName || node.label === slug;
        patch({
          agent: mergeAgent(spec, { body: match.body, description: match.description || spec.description, source: { repo: match.repo, skillPath: match.skillPath, hash: match.hash } }),
          ...(rename ? { label: match.name } : {}),
        });
        if (alive.current) setFocusId(match.id);
        const where = project ? ` no projeto «${project}»` : "";
        toast(installed.length > 1 ? `${installed.length} skills instaladas com npx${where} e salvas no catálogo. Este nó usa ${match.name}.` : `${match.name} instalada com npx${where} e salva no catálogo`);
        return true;
      }
      const r = await resolveSkillSource(spec.source);
      if (!r.ok) {
        toastError(r.error);
        return false;
      }
      patch({ agent: mergeAgent(spec, { body: r.body, description: r.description ?? spec.description, source: { ...spec.source, hash: r.hash } }), ...(label ? { label } : {}) });
      toast("Skill baixada do GitHub");
      return true;
    } catch (e) {
      toastError(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      if (alive.current) (setResolving(false), setInstalling(false));
    }
  };
  const take = (e: SkillCatalogEntry) => {
    const source = catalogEntryToSource(e);
    const label = fresh ? e.name : undefined;
    if (e.body && e.hash) {
      patch({ agent: mergeAgent({ role: "skill", description: e.description || agent.description, body: e.body, source: { ...source, hash: e.hash } }, {}), ...(label ? { label } : {}) });
      toast(`${e.name} aplicada a partir do catálogo`);
      return;
    }
    void resolve({ role: "skill", description: e.description || agent.description, source }, label);
  };
  const ghSlug = ghLink ? skillInstallSlug(ghLink.skillPath) : undefined;
  const downloadLink = async () => {
    if (!ghLink || resolving) return;
    const ok = await resolve({ role: "skill", description: agent.description, source: ghLink });
    if (ok && alive.current) setQuery("");
  };
  const refreshLabel = () => {
    if (resolving) return manualSource || installing ? "Instalando…" : "Baixando…";
    if (manualSource) return current?.hash ? "Atualizar com npx" : "Instalar com npx";
    return current?.hash ? "Atualizar do GitHub" : "Resolver do GitHub";
  };
  return (
    <div className="skill-cat-layout">
      {!detail && (
      <aside className="skill-cat-side">
        <div style={{ display: "flex", gap: 8 }}>
          <input className="input skill-search" style={{ flex: 1 }} autoFocus value={query} placeholder="Buscar por nome, assunto ou repositório, ou colar um link do GitHub…" onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === "Enter" && ghLink && (e.preventDefault(), downloadLink())} aria-label="Buscar skill no catálogo ou colar link do GitHub" />
          {ghLink && (
            <button className="btn primary" disabled={resolving} onClick={downloadLink}>
              {installing ? "Baixando…" : "Baixar skill"}
            </button>
          )}
        </div>
        {ghLink && (
          <span className="skill-ok">
            Link do GitHub reconhecido: {ghLink.repo}
            {ghSlug ? ` · ${ghSlug}` : " · todas as skills do repositório"}. Baixa com npx skills add e guarda no banco local.
            {installing && " A primeira vez clona o repositório e pode levar um minuto."}
          </span>
        )}
        <div className="skill-areas" role="group" aria-label="Áreas de desenvolvimento" style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
          <button className={`btn sm${!typed && area < 0 ? " primary" : " ghost"}`} aria-pressed={!typed && area < 0} onClick={() => (setQuery(""), setArea(-1))}>
            Top geral
          </button>
          {SKILL_AREAS.map((a, i) => (
            <button key={a.label} className={`btn sm${!typed && i === area ? " primary" : " ghost"}`} aria-pressed={!typed && i === area} onClick={() => (setQuery(""), setArea(i))}>
              {a.label}
            </button>
          ))}
        </div>
        <span className="skill-cat-count">
          {results.length} skills{hubState === "loading" && " · buscando no skills.sh…"}{hubState === "error" && " · skills.sh indisponível, mostrando as fontes locais"}
        </span>
        <ul id="skill-cat-list" className="skill-grid" aria-label="Skills do catálogo">
          {results.map((r) => (
            <li key={r.id} className={`skill-card${isCurrent(r) ? " active" : ""}`}>
              <button className="skill-card-main" onClick={() => (setFocusId(r.id), setDetail(true))}>
                <span className="skill-cat-name">
                  {r.name}
                  {isCurrent(r) && <span className="skill-cat-tag">em uso</span>}
                  {!isCurrent(r) && r.body && <span className="skill-cat-tag">instalada</span>}
                </span>
                <span className="skill-cat-repo">{r.repo}</span>
                <span className="skill-cat-desc">{r.description}</span>
              </button>
              <button className="btn sm primary" onClick={() => take(r)} disabled={resolving || isCurrent(r)}>
                {isCurrent(r) ? "Em uso" : resolving ? "Baixando…" : r.body ? "Usar" : "Instalar e usar"}
              </button>
            </li>
          ))}
          {!results.length && <li className="skill-cat-none">{hubState === "loading" ? "Buscando no skills.sh…" : `Nada encontrado${query.trim() ? ` para «${query}»` : ""}. Use um repositório do GitHub abaixo ou escreva do zero.`}</li>}
        </ul>
        <details className="skill-manual">
          <summary>Fontes de skills ({sources.length})</summary>
          <span className="skill-slug">Repositórios do GitHub indexados no banco local. Valem mesmo sem o skills.sh.</span>
          {sources.map((src) => (
            <div key={src.repo} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <code>{src.repo}</code>
              <span className={src.error ? "skill-pending" : "skill-slug"}>{src.error ?? `${src.count} skills`}</span>
              <button className="btn sm ghost" disabled={srcBusy} onClick={() => srcRun(() => refreshSkillSources(src.repo))}>
                Atualizar
              </button>
              <button className="btn sm ghost" disabled={srcBusy} onClick={() => srcRun(() => removeSkillSource(src.repo))}>
                Remover
              </button>
            </div>
          ))}
          <label className="field">
            <span>Adicionar fonte (owner/repo ou URL do repositório)</span>
            <input className="input" value={srcInput} placeholder="anthropics/skills" onChange={(e) => setSrcInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && srcInput.trim() && !srcBusy && (e.preventDefault(), srcRun(() => addSkillSource(srcInput)).then(() => setSrcInput("")))} />
          </label>
          <button className="btn sm" disabled={!srcInput.trim() || srcBusy} onClick={() => srcRun(() => addSkillSource(srcInput)).then(() => setSrcInput(""))}>
            {srcBusy ? "Indexando…" : "Adicionar e indexar"}
          </button>
        </details>
        <div className="skill-or">
          Nenhuma serve?
          <button className="btn sm ghost" onClick={onWrite}>
            Escrever do zero
          </button>
        </div>
      </aside>
      )}

      {detail && (
      <section className="skill-cat-detail" aria-label="Detalhes da skill">
        <button className="btn sm ghost" style={{ alignSelf: "flex-start" }} onClick={() => setDetail(false)}>
          ← Voltar ao catálogo
        </button>
        {current && !catalog.some(isCurrent) && (
          <div className="skill-current">
            <div>
              <span className="lbl-s">Fonte atual (fora do catálogo)</span>
              <div>
                <code>{current.repo}</code> · <code>{current.skillPath}</code>
              </div>
            </div>
            <button className="btn sm" onClick={() => resolve(agent, undefined, true)} disabled={resolving}>
              {refreshLabel()}
            </button>
          </div>
        )}
        {focused ? (
          <>
            <div className="skill-detail-head">
              <div>
                <h3>{focused.name}</h3>
                <div className="skill-cat-repo">
                  {focused.repo}{!focused.remote && ` · ${focused.skillPath}`}
                </div>
              </div>
              <div className="skill-current-actions">
                {isCurrent(focused) ? (
                  <>
                    <button className="btn sm" onClick={() => resolve(agent, undefined, true)} disabled={resolving}>
                      {refreshLabel()}
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
                  <button className="btn primary" onClick={() => take(focused)} disabled={resolving}>
                    {resolving ? "Baixando…" : current ? "Trocar por esta skill" : "Usar esta skill"}
                  </button>
                )}
              </div>
            </div>
            <p className="skill-detail-desc">{focused.description}</p>
            {isCurrent(focused) && <div className={current?.hash ? "skill-ok" : "skill-pending"}>{current?.hash ? `Em uso · resolvida (hash ${current.hash})` : "Em uso · ainda não resolvida (A006): o corpo fica vazio até baixar"}</div>}
            <div className="skill-detail-body">
              {focused.remote ? (
                <div className="skill-empty">Skill do catálogo público skills.sh. «Usar esta skill» baixa com npx skills add no projeto aberto e mostra o conteúdo aqui.</div>
              ) : !preview || preview.status === "loading" ? (
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
      )}
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
  /** erro do campo «Saídas esperadas» (o valor inválido não é gravado) */
  const [expectsErr, setExpectsErr] = useState<string>();
  /** Regrava o `agent` da conexão mantendo o que já tinha (usage, allow, order, mode, expects) e descartando vazios. */
  const upd = (p: Record<string, unknown>) => {
    const next: Record<string, unknown> = { ...a, ...p };
    for (const k of Object.keys(next)) {
      const v = next[k];
      if (v === undefined || v === "" || (Array.isArray(v) && !v.length)) delete next[k];
    }
    patch({ agent: next });
  };
  const setRel = (rel: AgentRel | "") => {
    if (!rel) return patch({ agent: null });
    patch({ agent: { rel, ...(a?.usage ? { usage: a.usage } : {}), ...(rel === "uses-tool" && a?.allow?.length ? { allow: a.allow } : {}), ...(rel === "step" && a?.order ? { order: a.order } : {}), ...(rel === "step" && a?.mode ? { mode: a.mode } : {}), ...(rel === "step" && a?.expects?.length ? { expects: a.expects } : {}) }, type: AGENT_RELS[rel].type });
  };
  const needsUsage = a?.rel === "uses-skill" || a?.rel === "delegates" || a?.rel === "uses-tool" || a?.rel === "uses-file";
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
      {a && (
        <label className="field">
          <span>{needsUsage ? "Como usa" : "Nota"} <small style={{ opacity: 0.7 }}>{needsUsage ? "(vai para o corpo do agente no harness)" : "(opcional)"}</small></span>
          <textarea className="input" rows={needsUsage ? 4 : 2} value={a.usage ?? ""} placeholder={AGENT_RELS[a.rel].usageHint} onChange={(e) => upd({ usage: e.target.value })} />
        </label>
      )}
      {a?.rel === "step" && (
        <>
          <label className="field">
            <span>Posição no workflow <small style={{ opacity: 0.7 }}>(1, 2, 3…; vazio = ordem das setas)</small></span>
            <input className="input" type="number" min={1} step={1} value={a.order ?? ""} onChange={(e) => upd({ order: e.target.value ? Math.max(1, Math.round(Number(e.target.value))) : undefined })} />
          </label>
          <div className="field">
            <span>Modo</span>
            <div className="tseg sm" role="radiogroup" aria-label="Modo do passo">
              <button role="radio" aria-checked={(a.mode ?? "manual") === "manual"} className={(a.mode ?? "manual") === "manual" ? "on" : ""} title="Você confirma cada passo no terminal" onClick={() => upd({ mode: undefined })}>Manual</button>
              <button role="radio" aria-checked={a.mode === "auto"} className={a.mode === "auto" ? "on" : ""} title="Roda sozinho (claude -p) e segue ao terminar" onClick={() => upd({ mode: "auto" })}>Auto</button>
            </div>
          </div>
          <label className="field">
            <span>Saídas esperadas <small style={{ opacity: 0.7 }}>(uma por linha, relativas ao projeto; * e ? valem dentro de uma pasta)</small></span>
            <TextField
              multiline
              mono
              deferred
              value={(a.expects ?? []).join("\n")}
              placeholder={"post/copy.md\npost/slides/slide-*.png"}
              onDraft={() => setExpectsErr(undefined)}
              onCommit={(v) => {
                const list = v.split("\n").map((s) => s.trim()).filter(Boolean);
                const err = checkExpects(list);
                setExpectsErr(err);
                if (!err) upd({ expects: list });
              }}
            />
            <small className="hint">Na execução do canvas, o passo que terminar sem ter gravado um destes arquivos falha com «não gerou: …».</small>
          </label>
          {expectsErr && <div className="callout warn" role="alert">{expectsErr} (não gravado)</div>}
        </>
      )}
      {a?.rel === "uses-tool" && doc.nodes.find((n) => n.id === conn.to)?.agent?.toolType === "mcp" && (
        <label className="field">
          <span>Tools permitidas deste servidor <small style={{ opacity: 0.7 }}>(uma por linha; vazio = todas)</small></span>
          <TextField
            multiline
            value={(a.allow ?? []).join("\n")}
            placeholder={(doc.nodes.find((n) => n.id === conn.to)?.agent?.mcpTools ?? ["create_issue"]).slice(0, 3).join("\n")}
            onCommit={(v) => upd({ allow: v.split("\n").map((s) => s.trim()).filter(Boolean) })}
          />
        </label>
      )}
      {a && needsUsage && !a.usage?.trim() && <div className="callout warn">Sem «como usa»: o agente só saberá o que o destino faz, não como ele próprio deve usá-lo (aviso A018).</div>}
      {!a && <div className="callout">{valid.length ? `Sem relação. Para este par: ${valid.join(", ")}.` : "Nenhuma relação do modo agents liga este par (ex.: agent → skill, agent → agent, prompt → agent, workflow → prompt)."}</div>}
      {a && <div className="callout">{AGENT_RELS[a.rel].semantics}{!valid.includes(a.rel) && " Atenção: esta combinação não é válida para esta relação (aviso A008)."}</div>}
    </>
  );
}
