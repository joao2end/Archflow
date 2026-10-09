import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Glyph } from "./icons";
import { exportJson, importJson } from "./export";
import {
  addRefNode, createFolder, exportLocalVault, importLocalVault, deleteDiagram, deleteFolder, duplicateDiagram, fsList, fsMkdir, isExpanded, moveDiagram, newDiagram, openDiagram, renameDiagram, renameFolder,
  set, toggleFolder, vaultCreate, vaultOpen, vaultRemove, vaultSwitch, useStore, type FileNode, type FolderNode,
} from "./store";

/* ───────── casco de modal ───────── */

function Sheet({ title, onClose, children, foot, wide }: { title: string; onClose: () => void; children: ReactNode; foot?: ReactNode; wide?: boolean }) {
  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`glass modal ${wide ? "wide" : ""}`} role="dialog" aria-modal="true" aria-label={title}>
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
const closeModal = () => set({ modal: null });

const rtf = new Intl.RelativeTimeFormat("pt-BR", { numeric: "auto" });
function ago(ms: number) {
  const s = Math.round((ms - Date.now()) / 1000);
  const abs = Math.abs(s);
  if (abs < 45) return "agora";
  if (abs < 3600) return rtf.format(Math.round(s / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(s / 3600), "hour");
  return rtf.format(Math.round(s / 86400), "day");
}
const parentOf = (p: string) => p.split("/").slice(0, -1).join("/");
const join = (a: string, b: string) => (a ? `${a}/${b}` : b);

/** Explica por que não dá para criar cofres (o servidor local não está ativo) e como resolver. */
function OfflineHelp() {
  return (
    <div className="callout">
      <b>Não foi possível conectar ao servidor local do Archflow.</b> É ele que cria a pasta do cofre e grava os diagramas no disco (e conversa com o MCP).
      <ol className="offline-steps">
        <li>
          No terminal, na pasta do projeto, rode <code>npm run dev</code> — ele já inicia o servidor local junto com o app.
        </li>
        <li>
          Já está rodando? Veja se a porta <code>7077</code> está livre ou ocupada por outro programa.
        </li>
        <li>Depois clique em “Tentar novamente”.</li>
      </ol>
      <button className="btn primary" onClick={() => location.reload()}>
        Tentar novamente
      </button>
      <div style={{ marginTop: 8 }}>Enquanto isso, o diagrama fica salvo no navegador.</div>
    </div>
  );
}

/* ───────── painel lateral: explorador do cofre ───────── */

type Menu = { x: number; y: number; kind: "file" | "folder" | "root"; path: string; title?: string };
type Editing = { kind: "rename-file" | "rename-folder" | "new-file" | "new-folder"; path: string };

export function FilesPanel() {
  const ws = useStore((s) => s.workspace);
  const online = useStore((s) => s.online);
  const expandedMap = useStore((s) => s.expanded);
  const [q, setQ] = useState("");
  const [menu, setMenu] = useState<Menu | null>(null);
  const [edit, setEdit] = useState<Editing | null>(null);
  const [confirm, setConfirm] = useState<{ kind: "file" | "folder"; path: string; label: string } | null>(null);
  const [dropOn, setDropOn] = useState<string | null>(null);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener("pointerdown", close);
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("blur", close);
    };
  }, [menu]);

  const matches = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t || !ws) return [];
    return ws.files.filter((f) => `${f.title} ${f.path}`.toLowerCase().includes(t));
  }, [q, ws]);

  if (!online || !ws) {
    return (
      <aside className="hud glass library" aria-label="Arquivos">
        <div className="lib-head">
          <h2>Arquivos</h2>
        </div>
        <div className="lib-list" style={{ padding: 16 }}>
          <OfflineHelp />
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button className="btn" onClick={exportJson}>
              <Glyph name="download" size={16} /> Baixar JSON
            </button>
            <label className="btn" style={{ cursor: "pointer" }}>
              <Glyph name="upload" size={16} /> Importar…
              <input type="file" accept=".json,application/json" hidden onChange={(e) => e.target.files?.[0] && importJson(e.target.files[0])} />
            </label>
          </div>
        </div>
      </aside>
    );
  }

  const openMenu = (e: React.MouseEvent, m: Omit<Menu, "x" | "y">) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ ...m, x: Math.min(e.clientX, window.innerWidth - 220), y: Math.min(e.clientY, window.innerHeight - 260) });
  };

  const startNew = (kind: "new-file" | "new-folder", folder: string) => {
    if (folder) toggleFolder(folder, true);
    setEdit({ kind, path: folder });
  };

  const commitEdit = (value: string) => {
    const v = value.trim();
    const e = edit;
    setEdit(null);
    if (!e || !v) return;
    if (e.kind === "new-file") void newDiagram(v, e.path);
    else if (e.kind === "new-folder") void createFolder(join(e.path, v)).then(() => e.path && toggleFolder(e.path, true));
    else if (e.kind === "rename-file") void renameDiagram(e.path, v);
    else void renameFolder(e.path, v);
  };

  const onDropTo = (e: React.DragEvent, folder: string) => {
    e.preventDefault();
    e.stopPropagation();
    setDropOn(null);
    const p = e.dataTransfer.getData("application/x-archflow-file");
    if (p && parentOf(p) !== folder) void moveDiagram(p, folder);
  };

  const inlineInput = (initial: string, placeholder: string) => (
    <input
      key="inline"
      className="input tree-input"
      autoFocus
      defaultValue={initial}
      placeholder={placeholder}
      onFocus={(e) => e.currentTarget.select()}
      onBlur={(e) => commitEdit(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") {
          e.stopPropagation();
          setEdit(null);
        }
      }}
    />
  );

  const fileRow = (f: FileNode, depth: number) => {
    const active = f.path === ws.current;
    const renaming = edit?.kind === "rename-file" && edit.path === f.path;
    return (
      <div
        key={f.path}
        className={`tree-row ${active ? "active" : ""}`}
        style={{ paddingLeft: 10 + depth * 16 }}
        draggable={!renaming}
        onDragStart={(e) => {
          e.dataTransfer.setData("application/x-archflow-file", f.path);
          e.dataTransfer.effectAllowed = "move";
        }}
        onClick={() => !active && void openDiagram(f.path)}
        onContextMenu={(e) => openMenu(e, { kind: "file", path: f.path, title: f.title })}
        title={renaming ? undefined : `${f.path}\n${f.nodes} componentes · ${f.connections} conexões · ${ago(f.updatedAt)}`}
        role="treeitem"
        aria-selected={active}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter") void openDiagram(f.path);
          if (e.key === "F2") setEdit({ kind: "rename-file", path: f.path });
        }}
      >
        <Glyph name="file" size={16} className="tree-ico" />
        {renaming ? inlineInput(f.title, "Título") : <span className="tree-name">{f.title}</span>}
        {!renaming && (
          <button className="tree-more" aria-label="Mais ações" onClick={(e) => openMenu(e, { kind: "file", path: f.path, title: f.title })}>
            <Glyph name="dots" size={16} />
          </button>
        )}
      </div>
    );
  };

  const folderRow = (n: FolderNode, depth: number) => {
    const open = isExpanded(n.path, expandedMap);
    const renaming = edit?.kind === "rename-folder" && edit.path === n.path;
    return (
      <div role="group" key={n.path}>
        <div
          className={`tree-row folder ${dropOn === n.path ? "drop" : ""}`}
          style={{ paddingLeft: 10 + depth * 16 }}
          onClick={() => !renaming && toggleFolder(n.path)}
          onContextMenu={(e) => openMenu(e, { kind: "folder", path: n.path })}
          onDragOver={(e) => {
            if (e.dataTransfer.types.includes("application/x-archflow-file")) {
              e.preventDefault();
              setDropOn(n.path);
            }
          }}
          onDragLeave={() => setDropOn((d) => (d === n.path ? null : d))}
          onDrop={(e) => onDropTo(e, n.path)}
          role="treeitem"
          aria-expanded={open}
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") toggleFolder(n.path);
            if (e.key === "F2") setEdit({ kind: "rename-folder", path: n.path });
          }}
        >
          <Glyph name="chevron" size={14} className="tree-chev" style={{ transform: open ? "none" : "rotate(-90deg)" }} />
          <Glyph name="folder" size={16} className="tree-ico" />
          {renaming ? inlineInput(n.name, "Nome da pasta") : <span className="tree-name">{n.name}</span>}
          {!renaming && <span className="tree-count">{countFiles(n)}</span>}
          {!renaming && (
            <button className="tree-more" aria-label="Mais ações" onClick={(e) => openMenu(e, { kind: "folder", path: n.path })}>
              <Glyph name="dots" size={16} />
            </button>
          )}
        </div>
        {open && childrenOf(n, depth + 1)}
      </div>
    );
  };

  const childrenOf = (n: FolderNode, depth: number) => (
    <>
      {edit && (edit.kind === "new-file" || edit.kind === "new-folder") && edit.path === n.path && (
        <div key="new-row" className="tree-row" style={{ paddingLeft: 10 + depth * 16 }}>
          <Glyph name={edit.kind === "new-file" ? "file" : "folder"} size={16} className="tree-ico" />
          {inlineInput("", edit.kind === "new-file" ? "Título do diagrama" : "Nome da pasta")}
        </div>
      )}
      {n.children.map((c) => (c.type === "folder" ? folderRow(c, depth) : fileRow(c, depth)))}
    </>
  );

  const total = ws.files.length;

  return (
    <aside className="hud glass library files-panel" aria-label="Arquivos do cofre">
      <div className="lib-head">
        <button className="vault-btn" onClick={() => set({ modal: { type: "vaults" } })} data-tip={`Cofre: ${ws.vault.path}\nClique para trocar ou criar cofres`} data-tip-pos="bottom">
          <Glyph name="vault" size={19} />
          <span className="vault-name">{ws.vault.name}</span>
          <Glyph name="chevron" size={15} />
        </button>
        <div className="tree-actions">
          <button className="btn ghost icon sm" onClick={() => startNew("new-file", "")} aria-label="Novo diagrama" data-tip="Novo diagrama" data-tip-pos="bottom">
            <Glyph name="file-plus" size={17} />
          </button>
          <button className="btn ghost icon sm" onClick={() => startNew("new-folder", "")} aria-label="Nova pasta" data-tip="Nova pasta" data-tip-pos="bottom">
            <Glyph name="folder-plus" size={17} />
          </button>
          <button className="btn ghost icon sm" onClick={() => set({ modal: { type: "quick" } })} aria-label="Busca rápida" data-tip="Busca rápida (Ctrl+O)" data-tip-pos="bottom">
            <Glyph name="search" size={17} />
          </button>
        </div>
        <label className="search" style={{ marginTop: 8 }}>
          <Glyph name="search" size={16} />
          <input placeholder="Filtrar diagramas…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Filtrar diagramas" />
        </label>
      </div>

      <div
        className={`lib-list tree ${dropOn === "" ? "drop" : ""}`}
        role="tree"
        onContextMenu={(e) => openMenu(e, { kind: "root", path: "" })}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes("application/x-archflow-file")) {
            e.preventDefault();
            setDropOn("");
          }
        }}
        onDragLeave={(e) => e.currentTarget === e.target && setDropOn(null)}
        onDrop={(e) => onDropTo(e, "")}
      >
        {q.trim() ? (
          matches.length ? (
            matches.map((f) => fileRow(f, 0))
          ) : (
            <div className="empty">Nada encontrado.</div>
          )
        ) : (
          <>
            {childrenOf(ws.tree, 0)}
            {!total && !edit && <div className="empty">Cofre vazio. Crie seu primeiro diagrama com o botão acima.</div>}
          </>
        )}
      </div>

      {ws.files.some((f) => f.refs?.includes(ws.current)) && (
        <div className="backlinks" aria-label="Diagramas que referenciam este">
          <h4>Referenciado por</h4>
          {ws.files
            .filter((f) => f.refs?.includes(ws.current))
            .map((f) => (
              <button key={f.path} onClick={() => void openDiagram(f.path)}>
                <Glyph name="layers" size={14} /> {f.title}
              </button>
            ))}
        </div>
      )}

      {confirm && (
        <div className="confirm-bar" role="alertdialog">
          <span>
            Mover <b>{confirm.label}</b> para a lixeira do cofre?
          </span>
          <div>
            <button className="btn sm" onClick={() => setConfirm(null)}>
              Cancelar
            </button>
            <button
              className="btn sm danger"
              onClick={() => {
                void (confirm.kind === "file" ? deleteDiagram(confirm.path) : deleteFolder(confirm.path));
                setConfirm(null);
              }}
            >
              Excluir
            </button>
          </div>
        </div>
      )}

      <div className="lib-foot files-foot">
        <span>
          {total} diagrama(s)
        </span>
        <button className="btn ghost sm" onClick={() => set({ modal: { type: "vaults" } })}>
          <Glyph name="vault" size={15} /> Cofres
        </button>
      </div>

      {menu && (
        <div className="glass ctx-menu" style={{ left: menu.x, top: menu.y }} role="menu" onPointerDown={(e) => e.stopPropagation()}>
          {menu.kind === "file" && (
            <>
              <button onClick={() => (void openDiagram(menu.path), setMenu(null))}>
                <Glyph name="file" size={16} /> Abrir
              </button>
              {menu.path !== ws.current && (
                <button onClick={() => (addRefNode(menu.path, menu.title ?? menu.path), setMenu(null))}>
                  <Glyph name="layers" size={16} /> Inserir como referência aqui
                </button>
              )}
              <button onClick={() => (setEdit({ kind: "rename-file", path: menu.path }), setMenu(null))}>
                <Glyph name="edit" size={16} /> Renomear <kbd>F2</kbd>
              </button>
              <button onClick={() => (void duplicateDiagram(menu.path), setMenu(null))}>
                <Glyph name="copy" size={16} /> Duplicar
              </button>
              {menu.path.includes("/") && (
                <button onClick={() => (void moveDiagram(menu.path, ""), setMenu(null))}>
                  <Glyph name="arrow-up" size={16} /> Mover para a raiz
                </button>
              )}
              <hr />
              <button className="danger" onClick={() => (setConfirm({ kind: "file", path: menu.path, label: menu.title ?? menu.path }), setMenu(null))}>
                <Glyph name="trash" size={16} /> Excluir
              </button>
            </>
          )}
          {(menu.kind === "folder" || menu.kind === "root") && (
            <>
              <button onClick={() => (startNew("new-file", menu.path), setMenu(null))}>
                <Glyph name="file-plus" size={16} /> Novo diagrama {menu.kind === "folder" ? "aqui" : ""}
              </button>
              <button onClick={() => (startNew("new-folder", menu.path), setMenu(null))}>
                <Glyph name="folder-plus" size={16} /> Nova pasta {menu.kind === "folder" ? "aqui" : ""}
              </button>
              {menu.kind === "folder" && (
                <>
                  <button onClick={() => (setEdit({ kind: "rename-folder", path: menu.path }), setMenu(null))}>
                    <Glyph name="edit" size={16} /> Renomear <kbd>F2</kbd>
                  </button>
                  <hr />
                  <button className="danger" onClick={() => (setConfirm({ kind: "folder", path: menu.path, label: menu.path }), setMenu(null))}>
                    <Glyph name="trash" size={16} /> Excluir pasta
                  </button>
                </>
              )}
            </>
          )}
        </div>
      )}
    </aside>
  );
}

const countFiles = (n: FolderNode): number => n.children.reduce((s, c) => s + (c.type === "file" ? 1 : countFiles(c)), 0);

/* ───────── gerenciador de cofres ───────── */

export function VaultsModal() {
  const ws = useStore((s) => s.workspace);
  const online = useStore((s) => s.online);
  const storage = useStore((s) => s.storage);
  const local = storage === "local";
  const [name, setName] = useState("");
  const [confirmDel, setConfirmDel] = useState<string | null>(null);

  if (!online || !ws) {
    return (
      <Sheet title="Cofres" onClose={closeModal}>
        <OfflineHelp />
      </Sheet>
    );
  }

  return (
    <Sheet
      wide
      title={ws.configured ? "Cofres" : "Bem-vindo ao Archflow"}
      onClose={closeModal}
      foot={
        local ? (
          <>
            <span style={{ color: "var(--ink-3)", marginRight: "auto" }}>Cofre guardado neste navegador.</span>
            <button className="btn" onClick={() => void exportLocalVault()}>
              <Glyph name="download" size={16} /> Exportar cofre atual
            </button>
            <label className="btn" style={{ cursor: "pointer" }}>
              <Glyph name="upload" size={16} /> Importar cofre…
              <input
                type="file"
                accept=".json,application/json"
                hidden
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (f && (await importLocalVault(f))) closeModal();
                }}
              />
            </label>
          </>
        ) : (
          <span style={{ color: "var(--ink-3)", marginRight: "auto" }}>Um cofre é só uma pasta com seus diagramas <code>.archflow.json</code> — versionável no Git.</span>
        )
      }
    >
      {local && (
        <div className="callout warn-soft">
          <b>Modo navegador.</b> O servidor local não está rodando, então seus cofres ficam guardados <b>neste navegador</b> (IndexedDB). Funcionam normalmente — pastas, referências entre diagramas, busca e visualização —, mas:
          <ul className="offline-steps" style={{ marginBottom: 6 }}>
            <li>os dados somem se você limpar os dados do site; <b>exporte o cofre</b> de vez em quando;</li>
            <li>não há pasta no disco, Git, edição externa nem agentes MCP.</li>
          </ul>
          Quer cofres em disco e MCP? Rode <code>npm run dev</code> na pasta do projeto e recarregue a página.
        </div>
      )}
      {!ws.configured && (
        <div className="callout">
          Escolha onde seus diagramas ficam. Você está usando o <b>cofre padrão</b> em <code>{ws.vault.path}</code>; crie um cofre próprio ou abra uma pasta existente.
        </div>
      )}
      <div className="vault-actions">
        <div className="vault-card">
          <Glyph name="folder-plus" size={22} />
          <div>
            <h3>Criar novo cofre</h3>
            <p>{local ? "Cria um cofre guardado neste navegador." : "Cria uma pasta nova e a abre como cofre."}</p>
            <form
              className="vault-form"
              onSubmit={async (e) => {
                e.preventDefault();
                if (!name.trim()) return;
                if (!local) return set({ modal: { type: "folder", purpose: "create", name: name.trim() } });
                if (await vaultCreate(name.trim(), "")) closeModal();
              }}
            >
              <input className="input" placeholder="Nome do cofre" value={name} onChange={(e) => setName(e.target.value)} aria-label="Nome do cofre" />
              <button className="btn primary" type="submit" disabled={!name.trim()}>
                {local ? "Criar cofre" : "Escolher local…"}
              </button>
            </form>
          </div>
        </div>
        {!local && (
          <div className="vault-card">
            <Glyph name="vault" size={22} />
            <div>
              <h3>Abrir pasta como cofre</h3>
              <p>Use uma pasta que já existe (com ou sem diagramas).</p>
              <button className="btn" onClick={() => set({ modal: { type: "folder", purpose: "open" } })}>
                Escolher pasta…
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="files-head" style={{ marginTop: 18 }}>
        <span className="lbl-s" style={{ margin: 0 }}>
          Seus cofres
        </span>
      </div>
      <div className="file-list">
        {ws.vaults.map((v) => {
          const active = v.id === ws.vault.id && ws.configured;
          return (
            <div key={v.id} className={`file-row ${active ? "current" : ""}`}>
              <Glyph name="vault" size={20} className="file-ico" />
              <button
                className="file-main file-open"
                disabled={v.exists === false}
                onClick={() => {
                  if (!active) void vaultSwitch(v.id);
                  closeModal();
                }}
              >
                <span className="file-title">
                  {v.name} {active && <span className="pill">aberto</span>} {v.exists === false && <span className="pill warn">pasta não encontrada</span>}
                </span>
                <span className="file-meta">{v.path}</span>
              </button>
              {!active &&
                (local && confirmDel === v.id ? (
                  <div className="file-actions on">
                    <span style={{ fontSize: 12.5, color: "var(--ink-2)" }}>Apagar os dados?</span>
                    <button
                      className="btn sm danger"
                      onClick={() => {
                        setConfirmDel(null);
                        void vaultRemove(v.id);
                      }}
                    >
                      Excluir
                    </button>
                    <button className="btn sm" onClick={() => setConfirmDel(null)}>
                      Cancelar
                    </button>
                  </div>
                ) : (
                  <div className="file-actions">
                    <button
                      className="btn ghost icon sm"
                      aria-label={local ? "Excluir cofre" : "Remover da lista"}
                      data-tip={local ? "Excluir este cofre do navegador (apaga os diagramas)" : "Remover da lista (não apaga a pasta)"}
                      data-tip-pos="top"
                      onClick={() => (local ? setConfirmDel(v.id) : void vaultRemove(v.id))}
                    >
                      <Glyph name={local ? "trash" : "close"} size={15} />
                    </button>
                  </div>
                ))}
            </div>
          );
        })}
        {!ws.vaults.length && <div className="empty">Nenhum cofre ainda. Crie ou abra um acima.</div>}
      </div>
    </Sheet>
  );
}

/* ───────── busca rápida (Ctrl+O) ───────── */

export function QuickSwitcher() {
  const ws = useStore((s) => s.workspace);
  const [q, setQ] = useState("");
  const [i, setI] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const results = useMemo(() => {
    if (!ws) return [];
    const toks = q.toLowerCase().split(/\s+/).filter(Boolean);
    const score = (f: FileNode) => {
      const hay = `${f.title} ${f.path}`.toLowerCase();
      if (!toks.every((t) => hay.includes(t))) return -1;
      return (f.title.toLowerCase().startsWith(toks[0] ?? "") ? 2 : 0) + (f.path === ws.current ? -1 : 0);
    };
    return ws.files
      .map((f) => [f, score(f)] as const)
      .filter(([, s]) => s >= 0)
      .sort((a, b) => b[1] - a[1] || b[0].updatedAt - a[0].updatedAt)
      .map(([f]) => f)
      .slice(0, 40);
  }, [q, ws]);

  const canCreate = !!q.trim() && !results.some((f) => f.title.toLowerCase() === q.trim().toLowerCase());
  const total = results.length + (canCreate ? 1 : 0);

  useEffect(() => setI(0), [q]);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-i="${i}"]`)?.scrollIntoView({ block: "nearest" });
  }, [i]);

  const pick = (idx: number) => {
    closeModal();
    if (idx < results.length) void openDiagram(results[idx].path);
    else if (canCreate) void newDiagram(q.trim());
  };

  return (
    <div className="scrim top" onMouseDown={(e) => e.target === e.currentTarget && closeModal()}>
      <div className="glass modal quick" role="dialog" aria-modal="true" aria-label="Busca rápida">
        <label className="search quick-input">
          <Glyph name="search" size={19} />
          <input
            autoFocus
            placeholder={ws ? `Abrir diagrama em ${ws.vault.name}…` : "Conecte o bridge para buscar"}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") (e.preventDefault(), setI((x) => Math.min(total - 1, x + 1)));
              else if (e.key === "ArrowUp") (e.preventDefault(), setI((x) => Math.max(0, x - 1)));
              else if (e.key === "Enter" && total) pick(i);
            }}
            aria-label="Buscar diagrama"
          />
        </label>
        <div className="quick-list" ref={listRef} role="listbox">
          {results.map((f, idx) => (
            <button key={f.path} data-i={idx} role="option" aria-selected={idx === i} className={`quick-row ${idx === i ? "sel" : ""}`} onMouseMove={() => setI(idx)} onClick={() => pick(idx)}>
              <Glyph name="file" size={17} className="tree-ico" />
              <span className="quick-title">{f.title}</span>
              <span className="quick-path">{f.path}</span>
              {f.path === ws?.current && <span className="pill">aberto</span>}
            </button>
          ))}
          {canCreate && (
            <button data-i={results.length} className={`quick-row ${i === results.length ? "sel" : ""}`} onMouseMove={() => setI(results.length)} onClick={() => pick(results.length)}>
              <Glyph name="plus" size={17} className="tree-ico" />
              <span className="quick-title">
                Criar diagrama “{q.trim()}”
              </span>
            </button>
          )}
          {!total && <div className="empty">Digite para buscar diagramas do cofre.</div>}
        </div>
        <div className="quick-foot">
          <span><span className="kbd">↑↓</span> navegar</span>
          <span><span className="kbd">Enter</span> abrir</span>
          <span><span className="kbd">Esc</span> fechar</span>
        </div>
      </div>
    </div>
  );
}

/* ───────── seletor de pasta (abrir/criar cofre) ───────── */

interface Listing {
  path: string;
  parent: string | null;
  home: string;
  dirs: { name: string; path: string; archflow: number; vault: boolean }[];
  files?: number;
  vault?: boolean;
}

export function FolderModal({ purpose, name }: { purpose: "open" | "create"; name?: string }) {
  const ws = useStore((s) => s.workspace);
  const [ls, setLs] = useState<Listing | null>(null);
  const [typed, setTyped] = useState("");
  const [err, setErr] = useState("");
  const [newName, setNewName] = useState<string | null>(null);

  const go = async (p?: string) => {
    try {
      let l = await fsList(p);
      if (!p && !l.path && purpose === "create") l = await fsList(l.home); // começa na pasta pessoal
      setLs(l);
      setTyped(l.path);
      setErr("");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };
  useEffect(() => {
    void go(purpose === "open" ? ws?.vault.path : undefined);
  }, []);

  const sep = ls?.path.includes("\\") ? "\\" : "/";
  const back = () => set({ modal: { type: "vaults" } });
  const choose = async () => {
    if (!ls?.path) return;
    const ok = purpose === "create" ? await vaultCreate(name!, ls.path) : await vaultOpen(ls.path);
    if (ok) closeModal();
  };
  const mkdir = async () => {
    if (!ls?.path || !newName?.trim()) return;
    try {
      const target = ls.path.replace(/[\\/]+$/, "") + sep + newName.trim();
      await fsMkdir(target);
      setNewName(null);
      await go(target);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <Sheet
      title={purpose === "create" ? `Onde criar «${name}»?` : "Abrir pasta como cofre"}
      onClose={back}
      foot={
        <>
          <span className="folder-sel" title={ls?.path}>
            {ls?.path ? (
              purpose === "create" ? (
                <>
                  Será criado em <b>{ls.path.replace(/[\\/]+$/, "") + sep + name}</b>
                </>
              ) : (
                <>
                  <b>{ls.files ?? 0}</b> diagrama(s) nesta pasta{ls.vault ? " · já é um cofre" : ""}
                </>
              )
            ) : (
              "Escolha um disco"
            )}
          </span>
          <button className="btn" onClick={back}>
            Cancelar
          </button>
          <button className="btn primary" disabled={!ls?.path} onClick={choose}>
            <Glyph name="check" size={16} /> {purpose === "create" ? "Criar cofre aqui" : "Abrir como cofre"}
          </button>
        </>
      }
    >
      <form
        className="path-bar"
        onSubmit={(e) => {
          e.preventDefault();
          void go(typed);
        }}
      >
        <button type="button" className="btn icon" aria-label="Pasta acima" data-tip="Subir um nível" data-tip-pos="top" disabled={ls?.parent == null} onClick={() => go(ls!.parent || undefined)}>
          <Glyph name="arrow-up" size={17} />
        </button>
        <button type="button" className="btn icon" aria-label="Pasta pessoal" data-tip="Pasta pessoal" data-tip-pos="top" onClick={() => go(ls?.home)}>
          <Glyph name="home" size={17} />
        </button>
        <input className="input" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Cole um caminho e tecle Enter" aria-label="Caminho" spellCheck={false} />
        <button type="button" className="btn icon" aria-label="Nova pasta" data-tip="Nova pasta aqui" data-tip-pos="top" disabled={!ls?.path} onClick={() => setNewName("")}>
          <Glyph name="folder-plus" size={18} />
        </button>
      </form>
      {newName !== null && (
        <form
          style={{ display: "flex", gap: 6, marginBottom: 10 }}
          onSubmit={(e) => {
            e.preventDefault();
            void mkdir();
          }}
        >
          <input className="input" autoFocus placeholder="Nome da nova pasta" value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => e.key === "Escape" && setNewName(null)} />
          <button className="btn primary" type="submit" disabled={!newName.trim()}>
            Criar
          </button>
        </form>
      )}
      {err && <div className="callout" style={{ color: "var(--danger)" }}>{err}</div>}
      <div className="dir-list" role="listbox" aria-label="Pastas">
        {ls?.dirs.map((d) => (
          <button key={d.path} className="dir-row" onClick={() => go(d.path)}>
            <Glyph name={d.vault ? "vault" : "folder"} size={18} />
            <span className="dir-name">{d.name}</span>
            {d.vault && <span className="pill">cofre</span>}
            {!d.vault && d.archflow > 0 && <span className="pill">{d.archflow} diagrama(s)</span>}
          </button>
        ))}
        {ls && !ls.dirs.length && <div className="empty">Nenhuma subpasta aqui.</div>}
      </div>
    </Sheet>
  );
}
