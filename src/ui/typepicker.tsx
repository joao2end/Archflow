import { useEffect, useMemo, useRef, useState } from "react";
import { searchAssets } from "../shared/catalog";
import { NODE_KINDS, type Asset, type NodeEl, type NodeKind } from "../shared/schema";
import { AssetBadge, Glyph } from "./icons";
import { allKnownAssets, getState, lookupAsset, saveAsset, toast, useStore } from "./store";

const CHANGE_TYPE_EVENT = "archflow:change-type";
let pending = false;
const takePending = () => {
  const p = pending;
  pending = false;
  return p;
};

/**
 * Pede para abrir o seletor (menu de contexto do componente). Se o inspetor ainda não está montado (o componente acabou
 * de ser selecionado), o pedido fica pendente e o campo o consome ao montar; se já está, o evento abre na hora.
 */
export function requestChangeType() {
  pending = true;
  window.dispatchEvent(new Event(CHANGE_TYPE_EVENT));
  setTimeout(takePending, 1500); // ninguém consumiu: descarta para não abrir sozinho mais tarde
}

const same = (a?: string, b?: string) => !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * O que muda ao trocar a tecnologia de um componente. Nome e tecnologia só acompanham o novo asset se a pessoa
 * não os personalizou (iguais ao nome do asset antigo) — o que ela escreveu é preservado.
 */
export function swapPatch(n: NodeEl, old: Asset | undefined, next: Asset): Record<string, unknown> {
  const patch: Record<string, unknown> = { asset: next.id };
  if (n.kind !== "endpoint" && n.kind !== "system") patch.kind = next.kind;
  const label = old && same(n.label, old.name) ? next.name : n.label;
  if (label !== n.label) patch.label = label;
  const techFollows = !n.technology || (old && same(n.technology, old.name));
  if (techFollows) patch.technology = next.name !== label && next.category !== "Genéricos" ? next.name : undefined;
  return patch;
}

/** Tecnologia / ícone do componente, com troca por busca. Endpoints têm editor próprio (protocolo, método, caminho). */
export function TechPicker({ node, patch }: { node: NodeEl; patch: (p: Record<string, unknown>) => void }) {
  const [open, setOpen] = useState(takePending);
  const [q, setQ] = useState("");
  const [idx, setIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const library = useStore((s) => s.library);
  const asset = lookupAsset(node.asset);

  useEffect(() => {
    const h = () => (takePending(), setOpen(true));
    window.addEventListener(CHANGE_TYPE_EVENT, h);
    return () => window.removeEventListener(CHANGE_TYPE_EVENT, h);
  }, []);
  const shownFor = useRef(node.id);
  useEffect(() => {
    if (shownFor.current !== node.id) {
      shownFor.current = node.id; // outro componente selecionado: fecha (na montagem não: o pedido pendente já abriu)
      setOpen(false);
    }
  }, [node.id]);
  useEffect(() => {
    if (!open) return;
    // o botão do menu de contexto some do DOM e leva o foco embora: tenta de novo logo depois
    const focus = () => inputRef.current && document.activeElement !== inputRef.current && inputRef.current.focus();
    const raf = requestAnimationFrame(focus);
    const t = setTimeout(focus, 80);
    return () => (cancelAnimationFrame(raf), clearTimeout(t));
  }, [open]);

  const results = useMemo(() => (open ? searchAssets(allKnownAssets(), q).filter((a) => !a.endpoint).slice(0, 60) : []), [open, q, library]);
  useEffect(() => setIdx(0), [q]);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-i="${idx}"]`)?.scrollIntoView({ block: "nearest" });
  }, [idx]);

  if (node.kind === "endpoint") return null;

  const close = () => (setOpen(false), setQ(""));
  const pick = (a: Asset) => {
    if (a.id === node.asset) return close();
    if (!a.builtin && !getState().doc.customAssets.some((x) => x.id === a.id)) saveAsset(a); // asset do usuário vai junto no diagrama
    patch(swapPatch(node, asset, a));
    toast(`Trocado para ${a.name}`);
    close();
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      close();
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setIdx((i) => Math.max(0, Math.min(results.length - 1, i + (e.key === "ArrowDown" ? 1 : -1))));
    } else if (e.key === "Enter" && results[idx]) {
      e.preventDefault();
      pick(results[idx]);
    }
  };

  return (
    <div className="field tech-picker">
      <span>Tecnologia / ícone</span>
      <button type="button" className="tech-current" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="listbox" data-tip="Troca o ícone e o tipo do componente por outra tecnologia">
        {asset ? <AssetBadge asset={asset} size={30} /> : <AssetBadge asset={{ icon: `t:${node.label.slice(0, 2).toUpperCase()}`, color: "#706fd3", name: node.label }} size={30} />}
        <span className="tech-name">{asset?.name ?? "Sem tecnologia"}</span>
        <span className="tech-action">{open ? "Fechar" : "Trocar"}</span>
      </button>
      {open && (
        <div className="tech-pop" onKeyDown={onKey}>
          <input ref={inputRef} className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar: laravel, fila, cache…" aria-label="Buscar tecnologia" role="combobox" aria-expanded aria-controls="tech-list" />
          <div id="tech-list" className="tech-list" role="listbox" ref={listRef}>
            {results.map((a, i) => (
              <button key={a.id} type="button" role="option" aria-selected={a.id === node.asset} data-i={i} className={`tech-opt${i === idx ? " hi" : ""}${a.id === node.asset ? " cur" : ""}`} onMouseEnter={() => setIdx(i)} onClick={() => pick(a)}>
                <AssetBadge asset={a} size={26} />
                <span className="tech-opt-main">
                  <b>{a.name}</b>
                  <small>{a.category} · {NODE_KINDS[a.kind as NodeKind]?.split(" / ")[0].split(",")[0]}</small>
                </span>
                {a.id === node.asset && <Glyph name="check" size={14} />}
              </button>
            ))}
            {!results.length && <div className="empty">Nada encontrado. Cadastre a tecnologia na biblioteca (“Novo asset”).</div>}
          </div>
        </div>
      )}
    </div>
  );
}
