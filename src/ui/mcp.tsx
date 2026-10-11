import { useEffect, useState } from "react";
import { SKILL_MD } from "../shared/skill.generated";
import { Glyph } from "./icons";
import { toast, toastError, useStore } from "./store";

interface Launch {
  command: string;
  args: string[];
  cwd?: string;
}
interface ClientInfo {
  id: string;
  label: string;
  file: string;
  exists: boolean;
  installed: boolean;
}
interface Check {
  ok: boolean;
  problems: string[];
  tools?: number;
  ms?: number;
  stderr?: string;
}
interface McpInfo {
  packaged: boolean;
  launch: Launch;
  clients: ClientInfo[];
  skill: { file: string; installed: boolean };
}

/** Sem acesso ao servidor local (site hospedado / navegador): o MCP vive no app instalado, no caminho padrão do instalador. */
const PLACEHOLDER: McpInfo = {
  packaged: true,
  launch: { command: "C:\\Program Files\\Archflow\\Archflow.exe", args: ["--mcp"] },
  clients: [],
  skill: { file: "~/.claude/skills/archflow/SKILL.md", installed: false },
};

const copy = (t: string, msg = "Copiado") => navigator.clipboard.writeText(t).then(() => toast(msg));
/** Instalação da skill pelo CLI `skills` (lê skills/archflow/SKILL.md do repositório no GitHub). */
const SKILL_NPX = "npx skills add joao2end/Archflow --skill archflow";
const SKILL_NPX_CC = "npx skills add joao2end/Archflow --skill archflow -a claude-code -y";

const q = (s: string) => (/[\s"]/.test(s) ? `"${s.replace(/"/g, '\\"')}"` : s);
const b64 = (s: string) => btoa(unescape(encodeURIComponent(s)));

function saveFile(name: string, text: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: "text/markdown" }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/** Skill no formato de regra do Cursor (.cursor/rules/*.mdc): troca o frontmatter da skill pelo da regra. */
function cursorRule() {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(SKILL_MD);
  const desc = /^description:\s*(.*)$/m.exec(m?.[1] ?? "")?.[1] ?? "Como usar o Archflow";
  return `---\ndescription: ${desc}\nalwaysApply: false\n---\n${SKILL_MD.slice(m?.[0].length ?? 0)}`;
}

async function post(path: string, body?: unknown) {
  const r = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error ?? `erro ${r.status}`);
  return j;
}

/** Bloco de código com o botão de copiar embutido no canto superior direito. */
function CodeBox({ text }: { text: string }) {
  return (
    <div className="codebox">
      <pre className="code">{text}</pre>
      <button className="btn sm codebox-copy" onClick={() => copy(text, "Comando copiado")} aria-label="Copiar" data-tip="Copiar">
        <Glyph name="copy" size={14} /> Copiar
      </button>
    </div>
  );
}

export function McpBody() {
  const online = useStore((s) => s.online);
  const storage = useStore((s) => s.storage);
  const live = online && storage === "server";
  const [tab, setTab] = useState<"connect" | "skill">("connect");
  const [info, setInfo] = useState<McpInfo>(PLACEHOLDER);
  const [detected, setDetected] = useState(false);
  const [busy, setBusy] = useState("");
  const [checks, setChecks] = useState<Record<string, Check | "busy">>({});

  const load = () =>
    fetch("/api/mcp/info")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((i) => (setInfo(i), setDetected(true)))
      .catch(() => undefined);
  useEffect(() => {
    if (live) void load();
  }, [live]);

  const { launch } = info;
  const json = JSON.stringify({ mcpServers: { archflow: launch } }, null, 2);
  const cliCmd = `claude mcp add --scope user archflow -- ${[launch.command, ...launch.args].map(q).join(" ")}`;
  const vscodeCmd = `code --add-mcp ${q(JSON.stringify({ name: "archflow", ...launch }))}`;
  const cursorLink = `cursor://anysphere.cursor-deeplink/mcp/install?name=archflow&config=${encodeURIComponent(b64(JSON.stringify({ command: launch.command, args: launch.args })))}`;

  /** Inicia o comando gravado no cliente e faz o handshake MCP: o mesmo caminho que o cliente segue ao conectar. */
  const test = async (c: ClientInfo): Promise<Check> => {
    setChecks((x) => ({ ...x, [c.id]: "busy" }));
    let r: Check;
    try {
      r = await post("/api/mcp/check", { client: c.id });
    } catch (e) {
      r = { ok: false, problems: [e instanceof Error ? e.message : String(e)] };
    }
    setChecks((x) => ({ ...x, [c.id]: r }));
    return r;
  };
  const install = async (c: ClientInfo, quiet = false) => {
    setBusy(c.id);
    try {
      await post("/api/mcp/install", { client: c.id });
      if (!quiet) toast(`Configurado no ${c.label}. Testando a conexão…`);
      await load();
      await test(c);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setChecks((x) => ({ ...x, [c.id]: { ok: false, problems: [msg] } }));
      if (!quiet) toast(msg);
    } finally {
      setBusy("");
    }
  };
  const installAll = async () => {
    for (const c of info.clients.filter((x) => x.exists)) await install(c, true);
    toast("Instalação concluída — veja o resultado de cada cliente");
  };
  const installSkill = async () => {
    setBusy("skill");
    try {
      const r = await post("/api/skill/install");
      toast(`Skill instalada em ${r.file}`);
      await load();
    } catch (e) {
      toastError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  };

  return (
    <>
      {storage === "local" && (
        <div className="callout warn-soft">
          <b>Indisponível no modo navegador.</b> Agentes MCP editam o diagrama pelo servidor local, que não está rodando — por isso seus dados estão na memória deste navegador. Instale o app Archflow (ou rode <code>npm run dev</code>) e abra por lá para ativar o MCP.
        </div>
      )}
      <p className={`status ${live ? "on" : ""}`} style={{ display: "inline-flex" }}>
        <span className="dot" /> {live ? "Servidor ativo — as mudanças do agente aparecem aqui em tempo real" : "Servidor local desligado — o servidor MCP abre o app quando o agente conectar"}
      </p>

      <div className="tabs seg" role="tablist">
        <button role="tab" aria-selected={tab === "connect"} className={tab === "connect" ? "active" : ""} onClick={() => setTab("connect")}>
          Conectar
        </button>
        <button role="tab" aria-selected={tab === "skill"} className={tab === "skill" ? "active" : ""} onClick={() => setTab("skill")}>
          Skill para os modelos
        </button>
      </div>

      {tab === "connect" ? (
        <>
          <p className="mcp-lead">
            {!detected ? (
              <>
                O MCP <b>não roda no site</b>: ele fica no app instalado. <a href="https://github.com/joao2end/Archflow/releases/latest" target="_blank" rel="noreferrer">Baixe o Archflow para Windows</a>, instale e use o caminho abaixo (é o padrão do instalador; se você escolheu outra pasta, ajuste). Abrindo o MCP <b>dentro do app instalado</b>, o caminho e os botões “Instalar” já vêm preenchidos.
              </>
            ) : info.packaged ? (
              <>
                O servidor MCP já está <b>dentro do Archflow.exe</b> (<code>Archflow.exe --mcp</code>): não precisa de Node, npm nem do código-fonte. Quando o agente conecta, o app abre sozinho.
              </>
            ) : (
              <>
                Modo desenvolvimento: o servidor roda via <code>tsx</code> a partir do projeto. No app instalado (.exe) basta apontar o cliente para <code>Archflow.exe --mcp</code>.
              </>
            )}
          </p>

          {info.clients.length > 0 && (
            <div className="mcp-clients">
              {info.clients.map((c) => {
                const chk = checks[c.id];
                return (
                  <div key={c.id}>
                    <div className="mcp-row">
                      <div className="mcp-row-main">
                        <b>{c.label}</b>
                        <span className="mcp-path" title={c.file}>{c.file}</span>
                      </div>
                      {c.installed && !chk && <span className="mcp-ok">✓ configurado</span>}
                      <button className="btn sm" disabled={busy === c.id} onClick={() => install(c)}>
                        {busy === c.id ? "Instalando…" : c.installed ? "Reinstalar" : "Instalar"}
                      </button>
                      <button className="btn sm" disabled={!c.installed || chk === "busy"} onClick={() => test(c)} data-tip="Inicia o servidor como o cliente faz e confere se ele responde">
                        {chk === "busy" ? "Testando…" : "Testar"}
                      </button>
                      {c.id === "cursor" && (
                        <button className="btn sm" onClick={() => window.open(cursorLink)} data-tip="Abre o Cursor com a instalação pronta">
                          Abrir no Cursor
                        </button>
                      )}
                    </div>
                    {chk && chk !== "busy" && (
                      <div className={`mcp-check ${chk.ok ? "ok" : "bad"}`} role="status">
                        {chk.ok ? (
                          <>✓ Conectou em {chk.ms} ms · {chk.tools} ferramentas disponíveis. {c.id === "cursor" ? "O Cursor recarrega sozinho; se não aparecer, ligue o servidor em Settings → MCP." : "Reinicie o cliente se ele já estava aberto."}</>
                        ) : (
                          <>
                            <b>✗ Não conectou.</b> {chk.problems.join(" ")}
                            {chk.stderr && <pre className="code">{chk.stderr}</pre>}
                          </>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
              <div className="mcp-actions">
                <button className="btn primary sm" disabled={!!busy} onClick={installAll}>
                  Instalar em tudo e testar
                </button>
              </div>
              <p className="mcp-hint">“Instalar” adiciona só a entrada <code>archflow</code> ao arquivo do cliente (com cópia de segurança <code>.bak</code>) e já testa a conexão. No Claude Code usa o comando <code>claude mcp add</code>.</p>
            </div>
          )}

          <details className="mcp-more" open={info.clients.length === 0}>
            <summary>Configuração manual</summary>
            <ol className="steps">
              <li>
                <b>Claude Code</b> — rode no terminal:
                <CodeBox text={cliCmd} />
              </li>
              <li>
                <b>VS Code (Copilot)</b>, via terminal:
                <CodeBox text={vscodeCmd} />
              </li>
              <li>
                <b>Qualquer outro cliente MCP</b> (Claude Desktop, Cursor, Windsurf, Zed, Cline…) — adicione ao JSON de configuração:
                <CodeBox text={json} />
              </li>
              <li>
                Instale a <a href="#skill" onClick={(e) => (e.preventDefault(), setTab("skill"))}>skill</a> para os modelos saberem usar o Archflow e peça: <i>“Use o archflow para desenhar uma arquitetura de pedidos com Laravel, Postgres e SQS.”</i>
              </li>
            </ol>
          </details>
          <details className="mcp-more">
            <summary>Ferramentas e recursos</summary>
            <p className="mcp-hint">
            <b>Ferramentas:</b> get_schema_guide · list_assets · search_assets · get_diagram · add_components · add_endpoints · add_groups · connect · update_element · remove_elements · add_note · add_asset · auto_layout · set_diagram_info · validate_diagram · clear_diagram · list_diagrams · get_diagram_outline · open_diagram · new_diagram · add_use_cases · trace · domain_overview · generate_code (modo domain). No modo logic use <code>add_components</code> com <code>logic</code>, <code>connect</code> com <code>logic.branch</code> e <code>auto_layout</code> em <code>pipeline</code>. <br />
            <b>Recursos:</b> archflow://diagram · archflow://schema · archflow://skill. O protocolo completo está em <code>docs/PROTOCOL.md</code>.
          </p>
          </details>
        </>
      ) : (
        <>
          <p className="mcp-lead">A skill ensina o modelo a usar o Archflow nos três modos: arquitetura, domínio (DDD) e lógica.</p>
          <div className="mcp-cmd">
            <code>{SKILL_NPX}</code>
            <button className="btn primary sm" onClick={() => copy(SKILL_NPX, "Comando copiado")}>
              <Glyph name="copy" size={14} /> Copiar
            </button>
          </div>
          <p className="mcp-hint">Rode no terminal. O CLI pergunta em qual agente instalar (Claude Code, Cursor, Codex…).</p>
          {info.skill.installed && <p className="mcp-hint">✓ Também instalada no Claude Code em <code>{info.skill.file}</code>.</p>}

          <details className="mcp-more">
            <summary>Outras formas de instalar</summary>
            <div className="mcp-actions">
              {live && (
                <button className="btn sm" disabled={busy === "skill"} onClick={installSkill} data-tip={info.skill.file}>
                  {info.skill.installed ? "Reinstalar no Claude Code" : "Instalar no Claude Code"}
                </button>
              )}
              <button className="btn sm" onClick={() => copy(SKILL_MD, "Skill copiada")}>
                <Glyph name="copy" size={14} /> Copiar SKILL.md
              </button>
              <button className="btn sm" onClick={() => saveFile("SKILL.md", SKILL_MD)}>
                Baixar SKILL.md
              </button>
              <button className="btn sm" onClick={() => saveFile("archflow.mdc", cursorRule())} data-tip="Salve em .cursor/rules/ do seu projeto">
                Baixar regra do Cursor
              </button>
            </div>
            <p className="mcp-hint">
              Só no Claude Code, sem perguntas: <code>{SKILL_NPX_CC}</code>
            </p>
            <p className="mcp-hint">
              Manual — Claude Code: <code>~/.claude/skills/archflow/SKILL.md</code> (global) ou <code>.claude/skills/archflow/SKILL.md</code> (projeto). Claude.ai/Desktop: Configurações → Skills → enviar o SKILL.md. Cursor: <code>.cursor/rules/archflow.mdc</code>. Outros agentes: cole em AGENTS.md.
            </p>
          </details>
          <details className="mcp-more">
            <summary>Ver o conteúdo da skill</summary>
            <pre className="code">{SKILL_MD}</pre>
          </details>
        </>
      )}
    </>
  );
}
