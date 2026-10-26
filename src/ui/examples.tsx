import { useMemo, useState } from "react";
import { EXAMPLE_MODES } from "../shared/examples.catalog";
import { docMode, type DocMode } from "../shared/schema";
import { Glyph } from "./icons";
import { exampleCatalog, installExample, set, useStore } from "./store";

/**
 * Seção «Exemplos» do explorador: exemplos prontos de Arquitetura, Domínio e Lógica, do mais simples ao mais difícil.
 * Instalar cria os arquivos no projeto aberto (sem sobrescrever nada) e abre o principal; os que têm aula guiada abrem
 * com o painel da aula. Aberta, a seção ocupa o painel inteiro e o cabeçalho volta para os arquivos.
 */
export function ExamplesSection() {
  const files = useStore((s) => s.workspace?.files);
  const online = useStore((s) => s.online);
  const { open, tab: chosen } = useStore((s) => s.examples);
  const explorerMode = useStore((s) => s.modeFilter ?? docMode(s.doc));
  const [busy, setBusy] = useState<string | null>(null);
  const tab: DocMode = chosen ?? explorerMode;
  const have = useMemo(() => new Set(files?.map((f) => f.path) ?? []), [files]);
  const list = useMemo(() => exampleCatalog.filter((e) => e.mode === tab), [tab]);
  const hint = EXAMPLE_MODES.find((m) => m.mode === tab)?.hint;
  /** todos os exemplos da aba têm aula: avisa uma vez, no topo, em vez de um selo em cada card */
  const guided = list.length > 0 && list.every((e) => e.guided);

  const install = async (key: string) => {
    const ex = exampleCatalog.find((e) => e.key === key);
    if (!ex) return;
    setBusy(key);
    await installExample(ex);
    setBusy(null);
  };

  return (
    <section className={`ex-section${open ? " open" : ""}`} aria-label="Exemplos">
      <button className="ex-head" aria-expanded={open} aria-controls="ex-body" onClick={() => set({ examples: { open: !open, tab: chosen } })} data-tip={open ? "Voltar para os arquivos" : undefined} data-tip-pos="right">
        {open ? <Glyph name="arrow-up" size={16} style={{ transform: "rotate(-90deg)" }} /> : <Glyph name="sparkle" size={16} />}
        <b>Exemplos</b>
        <span className="ex-count">{exampleCatalog.length}</span>
        {open ? <span className="ex-back">Arquivos</span> : <Glyph name="chevron" size={15} className="ex-chev" />}
      </button>
      {open && (
        <div className="ex-body" id="ex-body">
          <div className="ex-tabs" role="tablist" aria-label="Tipo de exemplo">
            {EXAMPLE_MODES.map((m) => (
              <button key={m.mode} role="tab" aria-selected={tab === m.mode} className={tab === m.mode ? "on" : ""} onClick={() => set({ examples: { open: true, tab: m.mode } })}>
                {m.label}
                <small>{exampleCatalog.filter((e) => e.mode === m.mode).length}</small>
              </button>
            ))}
          </div>
          {hint && <p className="ex-hint">{hint}</p>}
          {guided && (
            <p className="ex-guided">
              <Glyph name="play" size={12} /> Cada exemplo abre com uma aula guiada: os passos acendem as peças e explicam o porquê.
            </p>
          )}
          {!online && <div className="callout warn">Sem armazenamento disponível: abra ou crie um projeto para instalar os exemplos.</div>}
          <ul className="ex-list" role="list">
            {list.map((ex) => {
              const installed = ex.files.some((f) => have.has(f.path));
              return (
                <li key={ex.key} className="ex-item">
                  <div className="ex-title">
                    <h4>{ex.title}</h4>
                    <span className={`chip level ${ex.level}`}>{ex.level}</span>
                  </div>
                  <p>{ex.summary}</p>
                  <div className="ex-tags">
                    {ex.teaches.map((t) => (
                      <i key={t}>{t}</i>
                    ))}
                  </div>
                  <div className="ex-foot">
                    <small>{ex.files.length > 1 ? `${ex.files.length} diagramas` : "1 diagrama"}</small>
                    <button className="btn sm primary" disabled={!online || busy !== null} onClick={() => void install(ex.key)}>
                      <Glyph name={installed ? "folder" : "download"} size={14} /> {busy === ex.key ? "Instalando…" : installed ? "Abrir" : "Instalar e abrir"}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}
