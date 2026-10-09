import { useEffect, useState } from "react";
import { SKILL_MD } from "../shared/skill.generated";
import { Glyph } from "./icons";
import { toast, useStore } from "./store";

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
interface McpInfo {
  packaged: boolean;
  launch: Launch;
  clients: ClientInfo[];
  skill: { file: string; installed: boolean };
}

const PLACEHOLDER: McpInfo = {
  packaged: false,
  launch: { command: "npx", args: ["tsx", "C:/caminho/do/projeto/server/mcp.ts"] },
  clients: [],
  skill: { file: "~/.claude/skills/archflow/SKILL.md", installed: false },
};

const copy = (t: string, msg = "Copiado") => navigator.clipboard.writeText(t).then(() => toast(msg));
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

export function McpBody() {
  const online = useStore((s) => s.online);
  const storage = useStore((s) => s.storage);
  const live = online && storage === "server";
  const [tab, setTab] = useState<"connect" | "skill">("connect");
  const [info, setInfo] = useState<McpInfo>(PLACEHOLDER);
  const [busy, setBusy] = useState("");

  const load = () =>
    fetch("/api/mcp/info")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setInfo)
      .catch(() => undefined);
  useEffect(() => {
    if (live) void load();
  }, [live]);

  const { launch } = info;
  const json = JSON.stringify({ mcpServers: { archflow: launch } }, null, 2);
  const cliCmd = `claude mcp add --scope user archflow -- ${[launch.command, ...launch.args].map(q).join(" ")}`;
  const vscodeCmd = `code --add-mcp ${q(JSON.stringify({ name: "archflow", ...launch }))}`;
  const cursorLink = `cursor://anysphere.cursor-deeplink/mcp/install?name=archflow&config=${encodeURIComponent(b64(JSON.stringify({ command: launch.command, args: launch.args })))}`;

  const install = async (c: ClientInfo) => {
    setBusy(c.id);
    try {
      await post("/api/mcp/install", { client: c.id });
      toast(`Configurado no ${c.label}. Reinicie o ${c.label} para carregar.`);
      await load();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  };
  const installSkill = async () => {
    setBusy("skill");
    try {
      const r = await post("/api/skill/install");
      toast(`Skill instalada em ${r.file}`);
      await load();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e));
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
            {info.packaged ? (
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
              {info.clients.map((c) => (
                <div className="mcp-row" key={c.id}>
                  <div className="mcp-row-main">
                    <b>{c.label}</b>
                    <span className="mcp-path" title={c.file}>{c.file}</span>
                  </div>
                  {c.installed && <span className="mcp-ok">✓ configurado</span>}
                  <button className="btn sm" disabled={busy === c.id} onClick={() => install(c)}>
                    {c.installed ? "Reinstalar" : "Instalar"}
                  </button>
                  {c.id === "cursor" && (
                    <button className="btn sm" onClick={() => window.open(cursorLink)} data-tip="Abre o Cursor com a instalação pronta">
                      Abrir no Cursor
                    </button>
                  )}
                </div>
              ))}
              <p className="mcp-hint">“Instalar” adiciona só a entrada <code>archflow</code> ao arquivo do cliente (com cópia de segurança <code>.bak</code>). Reinicie o cliente depois.</p>
            </div>
          )}

          <ol className="steps">
            <li>
              <b>Claude Code</b> — rode no terminal:
              <pre className="code" style={{ marginTop: 6 }}>{cliCmd}</pre>
              <button className="btn sm" onClick={() => copy(cliCmd)}>
                <Glyph name="copy" size={14} /> Copiar
              </button>
            </li>
            <li>
              <b>VS Code (Copilot)</b>, via terminal:
              <pre className="code" style={{ marginTop: 6 }}>{vscodeCmd}</pre>
              <button className="btn sm" onClick={() => copy(vscodeCmd)}>
                <Glyph name="copy" size={14} /> Copiar
              </button>
            </li>
            <li>
              <b>Qualquer outro cliente MCP</b> (Claude Desktop, Cursor, Windsurf, Zed, Cline…) — adicione ao JSON de configuração:
              <pre className="code" style={{ marginTop: 6 }}>{json}</pre>
              <button className="btn sm" onClick={() => copy(json)}>
                <Glyph name="copy" size={14} /> Copiar
              </button>
            </li>
            <li>
              Instale a <a href="#skill" onClick={(e) => (e.preventDefault(), setTab("skill"))}>skill</a> para os modelos saberem usar o Archflow e peça: <i>“Use o archflow para desenhar uma arquitetura de pedidos com Laravel, Postgres e SQS.”</i>
            </li>
          </ol>
          <div className="callout">
            <b>Ferramentas:</b> get_schema_guide · list_assets · search_assets · get_diagram · add_components · add_endpoints · add_groups · connect · update_element · remove_elements · add_note · add_asset · auto_layout · set_diagram_info · validate_diagram · clear_diagram · list_diagrams · get_diagram_outline · open_diagram · new_diagram. <br />
            <b>Recursos:</b> archflow://diagram · archflow://schema · archflow://skill. O protocolo completo está em <code>docs/PROTOCOL.md</code>.
          </div>
        </>
      ) : (
        <>
          <p className="mcp-lead">
            A skill ensina o modelo a usar o Archflow: o fluxo certo (ler → assets → grupos → componentes → conexões → layout → validar), o vocabulário, convenções de ids e erros comuns. O servidor também a entrega como recurso <code>archflow://skill</code> e resumo nas instruções do MCP.
          </p>
          <div className="mcp-actions">
            {live && (
              <button className="btn primary sm" disabled={busy === "skill"} onClick={installSkill} data-tip={info.skill.file}>
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
          {info.skill.installed && <p className="mcp-hint">✓ Instalada em <code>{info.skill.file}</code> — vale para todos os projetos do Claude Code.</p>}
          <p className="mcp-hint">
            Claude Code: <code>~/.claude/skills/archflow/SKILL.md</code> (global) ou <code>.claude/skills/archflow/SKILL.md</code> (projeto). Claude.ai/Desktop: Configurações → Skills → enviar o SKILL.md. Cursor: <code>.cursor/rules/archflow.mdc</code>. Outros agentes: cole no prompt de sistema ou em AGENTS.md.
          </p>
          <pre className="code">{SKILL_MD}</pre>
        </>
      )}
    </>
  );
}
