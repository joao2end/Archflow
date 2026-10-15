import { useEffect, useRef, useState } from "react";
import {
  CONTEXT_PATTERNS,
  CONTEXT_PATTERN_KEYS,
  DDD_RELS,
  DDD_REL_KEYS,
  DDD_ROLES,
  DDD_ROLE_KEYS,
  FLOW_RELS,
  SUBDOMAINS,
  docMode,
  type ConnectionEl,
  type DocMode,
  type ContextPattern,
  type DddConnSpec,
  type DddField,
  type DddNodeSpec,
  type DddRel,
  type DddRole,
  type GroupEl,
  type NodeEl,
  type PropertySpec,
  type Subdomain,
} from "../shared/schema";
import { cleanProperties, mergeProperties, parseProperties, propertiesToJson } from "../shared/properties";
import { composeDddLabel, dddLabelVia, reshapeDdd, suggestRels } from "../shared/domain";
import { validateDetailed } from "../shared/ops";
import { openDddGuide } from "./dddguide";
import { Glyph } from "./icons";
import { TextField } from "./panels";
import { getState, run, select, set, toast, toastError, useStore } from "./store";

type Patch = (p: Record<string, unknown>) => void;

/* ───────── rótulos dos campos (pt-BR; o termo do papel continua em inglês) ───────── */

const FIELD_LABEL: Record<DddField, [label: string, placeholder?: string]> = {
  intent: ["Intenção (o que faz)", "registrar o pedido do cliente"],
  invariants: ["Invariantes (uma por linha)", "total >= 0\npedido pago não aceita novos itens"],
  payload: ["Payload (resumo em texto; só vale sem propriedades)", "pedidoId, total, criadoEm"],
  properties: ["Propriedades"],
  producedBy: ["Produzido por"],
  external: ["Evento de outro contexto (contexto.evento)", "pagamentos.pagamento-aprovado"],
  for: ["Aggregate persistido"],
  actor: ["Ator", "Cliente"],
  goal: ["Objetivo de negócio", "comprar produtos do catálogo"],
  realizedBy: ["Realizado por (commands)"],
  reactsTo: ["Reage a (eventos)"],
  issues: ["Dispara (commands)"],
  compensates: ["Compensa com (commands)"],
  projectsFrom: ["Projeta de (eventos)"],
  step: ["Posição na linha do tempo"],
};

const TEXT_FIELDS: DddField[] = ["intent", "payload", "external", "actor", "goal"];
const LIST_TEXT_FIELDS: DddField[] = ["invariants"];
/** campo de id → papéis que ele aceita */
const REF_ONE: Partial<Record<DddField, DddRole[]>> = { producedBy: ["command", "aggregate-root", "process-manager"], for: ["aggregate-root"] };
const REF_MANY: Partial<Record<DddField, DddRole[]>> = { realizedBy: ["command"], reactsTo: ["domain-event"], issues: ["command"], compensates: ["command"], projectsFrom: ["domain-event"] };

/* ───────── nó de domínio ───────── */

function IdList({ value, candidates, onChange }: { value: string[]; candidates: NodeEl[]; onChange: (v: string[]) => void }) {
  const label = (id: string) => candidates.find((n) => n.id === id)?.label ?? id;
  const free = candidates.filter((c) => !value.includes(c.id));
  return (
    <div className="id-list">
      {value.map((id) => (
        <span key={id} className={`id-chip ${candidates.some((c) => c.id === id) ? "" : "broken"}`} title={candidates.some((c) => c.id === id) ? id : `"${id}" não existe neste diagrama`}>
          <button className="id-chip-name" onClick={() => select([id])} aria-label={`Selecionar ${label(id)}`}>
            {label(id)}
          </button>
          <button className="id-chip-x" onClick={() => onChange(value.filter((x) => x !== id))} aria-label={`Remover ${label(id)}`}>
            ×
          </button>
        </span>
      ))}
      <select className="input" value="" onChange={(e) => e.target.value && onChange([...value, e.target.value])} aria-label="Adicionar">
        <option value="">{free.length ? "+ adicionar…" : "(nenhum disponível)"}</option>
        {free.map((c) => (
          <option key={c.id} value={c.id}>
            {c.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export function DomainFields({ node, patch }: { node: NodeEl; patch: Patch }) {
  const doc = useStore((s) => s.doc);
  const ddd = node.ddd!;
  const role = DDD_ROLES[ddd.role];
  const upd = (p: Record<string, unknown>) => {
    const next: Record<string, unknown> = { ...ddd, ...p };
    for (const k of Object.keys(next)) {
      const v = next[k];
      if (v === undefined || v === "" || (Array.isArray(v) && !v.length)) delete next[k];
    }
    patch({ ddd: next });
  };
  const nodesOf = (roles: DddRole[]) => doc.nodes.filter((n) => n.id !== node.id && n.ddd && roles.includes(n.ddd.role));
  const val = (f: DddField) => (ddd as unknown as Record<string, unknown>)[f];
  return (
    <>
      <label className="field">
        <span>Papel (DDD)</span>
        <select className="input" value={ddd.role} onChange={(e) => patch({ ddd: reshapeDdd(ddd, e.target.value as DddRole), asset: undefined })}>
          {DDD_ROLE_KEYS.map((r) => (
            <option key={r} value={r}>
              {DDD_ROLES[r].label}
            </option>
          ))}
        </select>
      </label>
      <div className="callout">{role.hint}</div>
      {role.fields.map((f) => {
        const [label, ph] = FIELD_LABEL[f];
        if (TEXT_FIELDS.includes(f))
          return (
            <label className="field" key={f}>
              <span>{label}</span>
              <TextField value={(val(f) as string) ?? ""} placeholder={ph} onCommit={(v) => upd({ [f]: v.trim() || undefined })} />
            </label>
          );
        if (LIST_TEXT_FIELDS.includes(f))
          return (
            <label className="field" key={f}>
              <span>{label}</span>
              <TextField multiline value={((val(f) as string[]) ?? []).join("\n")} placeholder={ph} onCommit={(v) => upd({ [f]: v.split("\n").map((s) => s.trim()).filter(Boolean) })} />
            </label>
          );
        if (REF_ONE[f]) {
          const opts = nodesOf(REF_ONE[f]!);
          const cur = (val(f) as string) ?? "";
          return (
            <label className="field" key={f}>
              <span>{label}</span>
              <select className="input" value={cur} onChange={(e) => upd({ [f]: e.target.value || undefined })}>
                <option value="">— nenhum —</option>
                {cur && !opts.some((o) => o.id === cur) && <option value={cur}>{cur} (não encontrado)</option>}
                {opts.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
          );
        }
        if (REF_MANY[f])
          return (
            <div className="field" key={f}>
              <span className="lbl-s">{label}</span>
              <IdList value={(val(f) as string[]) ?? []} candidates={nodesOf(REF_MANY[f]!)} onChange={(v) => upd({ [f]: v })} />
            </div>
          );
        if (f === "properties") return <PropertiesEditor key={f} role={ddd.role} value={ddd.properties ?? []} onChange={(v) => upd({ properties: v })} />;
        if (f === "step")
          return (
            <label className="field" key={f}>
              <span>{label}</span>
              <input className="input" type="number" value={(val(f) as number | undefined) ?? ""} onChange={(e) => upd({ step: e.target.value === "" ? undefined : +e.target.value })} />
            </label>
          );
        return null;
      })}
    </>
  );
}

/* ───────── propriedades (campos) do elemento ───────── */

const PROP_TITLE: Partial<Record<DddRole, string>> = { command: "Parâmetros", "domain-event": "Campos do evento", "read-model": "Colunas" };
const TYPE_HINTS = ["texto", "inteiro", "número", "booleano", "data", "data e hora", "uuid", "email", "dinheiro", "lista"];
const PASTE_HELP = [
  "Aceita:",
  '• lista JSON  [{"name":"id","type":"uuid"}]',
  '• mapa  {"id":"uuid","total":"dinheiro"}',
  "• JSON Schema (properties / required)",
  '• um exemplo de objeto  {"id":"a1","total":10}',
  "• texto, uma por linha:",
  "  #id: uuid — identificador",
  "  total: dinheiro — soma dos itens",
  "  observacao?: texto",
].join("\n");

/** Tabela de propriedades + importação por JSON (lista, mapa, JSON Schema, exemplo) ou texto (uma por linha). */
function PropertiesEditor({ role, value, onChange }: { role: DddRole; value: PropertySpec[]; onChange: (v: PropertySpec[]) => void }) {
  const [paste, setPaste] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const title = PROP_TITLE[role] ?? "Propriedades";
  const edit = (i: number, p: Partial<PropertySpec>) => onChange(value.map((x, k) => (k === i ? { ...x, ...p } : x)));
  const add = () => {
    let n = value.length + 1;
    while (value.some((p) => p.name === `campo${n}`)) n++;
    onChange([...value, { name: `campo${n}` }]);
  };
  const apply = (mode: "replace" | "append") => {
    const r = parseProperties(paste ?? "");
    if (!r.ok) return setErr(r.error);
    onChange(cleanProperties(mode === "replace" ? r.properties : mergeProperties(value, r.properties)));
    toast(`${r.properties.length} propriedade(s) importada(s) (${r.format})`);
    setPaste(null);
    setErr("");
  };
  const copy = () => navigator.clipboard?.writeText(propertiesToJson(value)).then(() => toast("JSON copiado"), () => toastError("Não foi possível copiar"));
  return (
    <div className="field props-editor">
      <span className="lbl-s">
        {title} {value.length > 0 && <em>({value.length})</em>}
      </span>
      <datalist id="prop-types">
        {TYPE_HINTS.map((t) => (
          <option key={t} value={t} />
        ))}
      </datalist>
      {value.map((p, i) => (
        <div className="prop-row" key={i}>
          <TextField value={p.name} placeholder="nome" label={`Nome da propriedade ${i + 1}`} onCommit={(v) => v.trim() && !value.some((x, k) => k !== i && x.name.toLowerCase() === v.trim().toLowerCase()) && edit(i, { name: v.trim() })} />
          <TypeField value={p.type ?? ""} onCommit={(v) => edit(i, { type: v.trim() || undefined })} label={`Tipo da propriedade ${p.name}`} />
          <button className={`prop-flag${p.key ? " on" : ""}`} onClick={() => edit(i, { key: p.key ? undefined : true })} aria-pressed={!!p.key} aria-label={`${p.name}: identificador`} data-tip="Identificador (identidade do elemento)">
            #
          </button>
          <button className={`prop-flag${p.optional ? " on" : ""}`} onClick={() => edit(i, { optional: p.optional ? undefined : true })} aria-pressed={!!p.optional} aria-label={`${p.name}: opcional`} data-tip="Opcional (pode faltar)">
            ?
          </button>
          <button className="prop-x" onClick={() => onChange(value.filter((_, k) => k !== i))} aria-label={`Remover ${p.name}`}>
            ×
          </button>
          <div className="prop-desc">
            <TextField value={p.description ?? ""} placeholder="o que é e por que existe" label={`Descrição de ${p.name}`} onCommit={(v) => edit(i, { description: v.trim() || undefined })} />
          </div>
        </div>
      ))}
      {!value.length && paste === null && <div className="callout">Descreva a estrutura: nome, tipo e o significado de cada campo. Cole um JSON ou uma lista para preencher de uma vez.</div>}
      <div className="prop-actions">
        <button className="btn sm" onClick={add}>
          + Propriedade
        </button>
        <button className="btn sm ghost" onClick={() => (setPaste(paste === null ? "" : null), setErr(""))} aria-expanded={paste !== null}>
          Colar JSON / texto
        </button>
        {value.length > 0 && (
          <button className="btn sm ghost" onClick={copy} data-tip="Copia as propriedades como JSON">
            Copiar JSON
          </button>
        )}
      </div>
      {paste !== null && (
        <div className="prop-paste">
          <textarea className="input" rows={7} autoFocus value={paste} placeholder={PASTE_HELP} onChange={(e) => (setPaste(e.target.value), setErr(""))} aria-label="JSON ou texto com as propriedades" spellCheck={false} />
          {err && <div className="callout warn">{err}</div>}
          <div className="prop-actions">
            <button className="btn sm primary" onClick={() => apply("replace")} disabled={!paste.trim()}>
              Substituir
            </button>
            <button className="btn sm" onClick={() => apply("append")} disabled={!paste.trim() || !value.length} data-tip="Mantém as atuais e acrescenta (mesmo nome = atualiza)">
              Acrescentar
            </button>
            <button className="btn sm ghost" onClick={() => (setPaste(null), setErr(""))}>
              Cancelar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Campo de tipo com sugestões (texto livre: pode ser o nome de outro Value Object). */
function TypeField({ value, onCommit, label }: { value: string; onCommit: (v: string) => void; label: string }) {
  const [v, setV] = useState(value);
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setV(value);
  }, [value]);
  return (
    <input
      className="input"
      list="prop-types"
      value={v}
      placeholder="tipo"
      aria-label={label}
      onFocus={() => (focused.current = true)}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => {
        focused.current = false;
        if (v !== value) onCommit(v);
      }}
      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
    />
  );
}

/* ───────── relação de domínio numa conexão ───────── */

export function DddConnFields({ conn, patch }: { conn: ConnectionEl; patch: Patch }) {
  const doc = useStore((s) => s.doc);
  const d = conn.ddd;
  const valid = suggestRels(doc, conn.from, conn.to);
  // o texto livre do rótulo (ex.: o evento que trafega) é preservado; só a parte automática (relação/padrão) muda
  const via = dddLabelVia(d, conn.label);
  const setRel = (rel: DddRel | "") => {
    if (!rel) return patch({ ddd: null, label: via });
    const pattern = rel === "context-relation" ? d?.pattern : undefined;
    const ddd = { rel, ...(pattern ? { pattern } : {}) };
    patch({ ddd, type: DDD_RELS[rel].type, label: composeDddLabel(ddd, via) });
  };
  const setPattern = (pattern: ContextPattern | "") => {
    const ddd = { rel: "context-relation" as const, ...(pattern ? { pattern } : {}) };
    patch({ ddd, label: composeDddLabel(ddd, via) });
  };
  return (
    <>
      <label className="field">
        <span>Relação de domínio</span>
        <select className="input" value={d?.rel ?? ""} onChange={(e) => setRel(e.target.value as DddRel | "")}>
          <option value="">— sem relação de domínio —</option>
          {DDD_REL_KEYS.map((r) => (
            <option key={r} value={r} disabled={!valid.includes(r) && d?.rel !== r}>
              {DDD_RELS[r].label}
              {valid.includes(r) ? "" : d?.rel === r ? " (inválida para este par)" : " (não liga este par)"}
            </option>
          ))}
        </select>
      </label>
      {!d && <div className="callout">{valid.length ? `Sem relação de domínio. Para este par: ${valid.join(", ")}.` : "Nenhuma relação de domínio liga este par; o conector fica como um tipo UML livre (associação, dependência…)."}</div>}
      {d && <div className="callout">{DDD_RELS[d.rel].semantics}{!valid.includes(d.rel) && " Atenção: esta combinação de elementos não é válida para esta relação (regra D021)."}</div>}
      {d && FLOW_RELS.includes(d.rel) && <FlowFields conn={conn} patch={patch} />}
      {d?.rel === "context-relation" && (
        <>
          <label className="field">
            <span>Padrão do Context Map</span>
            <select className="input" value={d.pattern ?? ""} onChange={(e) => setPattern(e.target.value as ContextPattern | "")}>
              <option value="">— escolha um padrão —</option>
              {CONTEXT_PATTERN_KEYS.map((p) => (
                <option key={p} value={p}>
                  {CONTEXT_PATTERNS[p].label}
                </option>
              ))}
            </select>
          </label>
          {d.pattern && <div className="callout">{CONTEXT_PATTERNS[d.pattern].hint}</div>}
        </>
      )}
    </>
  );
}

/** Fluxo de uma conexão (triggers/emits): condição, ramo padrão, loop e iteração. O rótulo acompanha. */
function FlowFields({ conn, patch }: { conn: ConnectionEl; patch: Patch }) {
  const d = conn.ddd!;
  const via = dddLabelVia(d, conn.label);
  const set1 = (p: Partial<DddConnSpec>) => {
    const next: Record<string, unknown> = { ...d, ...p };
    for (const k of Object.keys(next)) if (next[k] === undefined || next[k] === "" || next[k] === false) delete next[k];
    patch({ ddd: next, label: composeDddLabel(next as unknown as DddConnSpec, via) });
  };
  const loop = d.loop;
  return (
    <div className="field flow-fields">
      <span className="lbl-s">Fluxo (condição, loop, iteração)</span>
      <label className="field">
        <span>Condição do ramo</span>
        <TextField value={d.condition ?? ""} placeholder="atraso > 0" onCommit={(v) => set1({ condition: v.trim() || undefined, otherwise: v.trim() ? undefined : d.otherwise })} />
      </label>
      <label className="field check-field">
        <input type="checkbox" checked={!!d.otherwise} onChange={(e) => set1({ otherwise: e.target.checked || undefined, condition: e.target.checked ? undefined : d.condition })} />
        <span>Ramo padrão (senão): vale quando nenhuma condição dos irmãos vale</span>
      </label>
      <label className="field">
        <span>Para cada</span>
        <TextField value={d.foreach ?? ""} placeholder="item do pedido" onCommit={(v) => set1({ foreach: v.trim() || undefined })} />
      </label>
      <label className="field check-field">
        <input type="checkbox" checked={!!loop} onChange={(e) => set1({ loop: e.target.checked ? { max: 3 } : undefined })} />
        <span>Esta conexão volta a um passo anterior (loop)</span>
      </label>
      {loop && (
        <div className="grid2">
          <label className="field">
            <span>Repete até</span>
            <TextField value={loop.until ?? ""} placeholder="pagamento aprovado" onCommit={(v) => set1({ loop: { ...loop, until: v.trim() || undefined } })} />
          </label>
          <label className="field">
            <span>Máximo de vezes</span>
            <input className="input" type="number" min={1} max={1000} value={loop.max ?? ""} onChange={(e) => set1({ loop: { ...loop, max: e.target.value === "" ? undefined : Math.max(1, Math.min(1000, Math.round(+e.target.value))) } })} />
          </label>
        </div>
      )}
      {loop && !loop.until && !loop.max && <div className="callout warn">Um loop precisa de condição de parada: informe «Repete até» e/ou o máximo de vezes.</div>}
    </div>
  );
}

/* ───────── subdomain de um contexto ───────── */

export function SubdomainField({ group, patch }: { group: GroupEl; patch: Patch }) {
  return (
    <>
      <label className="field">
        <span>Subdomain</span>
        <select className="input" value={group.subdomain ?? ""} onChange={(e) => patch({ subdomain: e.target.value || null })}>
          <option value="">— não classificado —</option>
          {(Object.keys(SUBDOMAINS) as Subdomain[]).map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </label>
      <div className="callout">{group.subdomain ? SUBDOMAINS[group.subdomain] : "Classifique o contexto: core (diferencial), supporting (necessário) ou generic (comum de mercado)."}</div>
    </>
  );
}

/* ───────── switch de modo na barra superior ───────── */

/**
 * Escolhe o tipo de diagrama no switch. NÃO converte o arquivo aberto: o explorador passa a mostrar só os diagramas do tipo
 * escolhido e abre a criação de um diagrama novo desse tipo. Voltar ao tipo do arquivo aberto só limpa o filtro.
 */
export function switchMode(mode: DocMode) {
  const s = getState();
  if (docMode(s.doc) === mode) return set({ modeFilter: null, newDiagramFor: null });
  set({ modeFilter: mode, panel: "files", newDiagramFor: mode });
}

const MODES: [DocMode, string, string][] = [
  ["architecture", "Arch", "Serviços, bancos, filas, nuvem e rede"],
  ["domain", "Domain", "DDD: contextos, aggregates, commands, eventos e casos de uso"],
  ["logic", "Logic", "Regras de negócio em ordem, dados e exemplos que se verificam sozinhos"],
  ["agents", "Agents", "Time de agentes de IA, skills e como se plugam; exporta harness pro Claude Code ou Cursor"],
];

/** Seletor Arch | Domain | Logic na barra superior (listbox próprio: o popup do <select> nativo não aceita o estilo do app). */
export function ModeSwitch() {
  const doc = useStore((s) => s.doc);
  const file = useStore((s) => s.file);
  const filter = useStore((s) => s.modeFilter);
  const shown = filter ?? docMode(doc);
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const wrap = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  // abrir outro diagrama devolve o seletor ao tipo dele
  useEffect(() => set({ modeFilter: null }), [file]);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => !wrap.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [open]);
  const current = MODES.find(([m]) => m === shown) ?? MODES[0];
  const show = () => (setHi(Math.max(0, MODES.findIndex(([m]) => m === shown))), setOpen(true));
  const pick = (m: DocMode) => {
    setOpen(false);
    trigger.current?.focus();
    switchMode(m);
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (!open) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") e.preventDefault(), show();
      return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setHi((i) => (i + (e.key === "ArrowDown" ? 1 : -1) + MODES.length) % MODES.length);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      pick(MODES[hi][0]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
    } else if (e.key === "Tab") setOpen(false);
  };
  return (
    <div className="mode-select-wrap" ref={wrap} onKeyDown={onKey}>
      <button
        ref={trigger}
        className={`mode-select ${shown}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Modo do diagrama: ${current[1]}`}
        aria-activedescendant={open ? `mode-opt-${MODES[hi][0]}` : undefined}
        onClick={() => (open ? setOpen(false) : show())}
        data-tip={open ? undefined : `${current[2]}\nTrocar de modo abre a criação de um diagrama novo; o aberto não é convertido.`}
        data-tip-pos="bottom"
      >
        <Glyph name={`mode-${shown}`} size={13} />
        {current[1]}
        <Glyph name="chevron" size={12} className="mode-select-chev" style={open ? { transform: "rotate(180deg)" } : undefined} />
      </button>
      {open && (
        <div className="glass menu mode-menu" role="listbox" aria-label="Modo do diagrama">
          {MODES.map(([m, label, desc], i) => (
            <button
              key={m}
              id={`mode-opt-${m}`}
              role="option"
              tabIndex={-1}
              aria-selected={m === shown}
              className={`${m}${i === hi ? " hi" : ""}${m === shown ? " cur" : ""}`}
              onPointerEnter={() => setHi(i)}
              onClick={() => pick(m)}
            >
              <span className="mode-dot">
                <Glyph name={`mode-${m}`} size={13} />
              </span>
              <span className="mode-opt-main">
                <b>{label}</b>
                <small>{desc}</small>
              </span>
              {m === shown && <Glyph name="check" size={14} className="mode-opt-check" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const ISSUE_MODAL = { logic: "logic", agents: "agents", domain: "domain" } as const;
const ISSUE_TIP = {
  logic: "Validação das regras (roda os exemplos) e texto para IA",
  agents: "Validação do time de agentes e texto para IA",
  domain: "Validação, visão geral do cofre e código",
};
const ISSUE_NAME = { logic: "fluxo", agents: "time", domain: "domínio" };

/** Ferramentas do diagrama aberto (Domain, Logic, Agents): validação com a contagem de erros/avisos e, no Domain, o guia de DDD. */
export function ModeTools() {
  const doc = useStore((s) => s.doc);
  const mode = docMode(doc);
  if (mode === "architecture") return null;
  const issues = validateDetailed(doc);
  const errors = issues.filter((i) => i.severity === "erro").length;
  const warns = issues.filter((i) => i.severity === "aviso").length;
  const state = errors ? "err" : warns ? "warn" : "ok";
  const summary = errors ? `${errors} ${errors === 1 ? "erro" : "erros"}` : warns ? `${warns} ${warns === 1 ? "aviso" : "avisos"}` : "Tudo certo";
  return (
    <div className="glass mode-tools" role="group" aria-label="Validação do diagrama">
      <button
        className={`mode-issues ${state}`}
        onClick={() => set({ modal: { type: ISSUE_MODAL[mode], tab: "issues" } })}
        data-tip={`${ISSUE_TIP[mode]}
${errors} erro(s), ${warns} aviso(s)`}
        data-tip-pos="top"
        aria-label={`Validação do ${ISSUE_NAME[mode]}: ${errors} erros, ${warns} avisos`}
      >
        <Glyph name={state === "ok" ? "check" : "alert"} size={14} />
        {summary}
      </button>
      {mode === "domain" && (
        <button className="mode-guide" onClick={openDddGuide} data-tip="Guia animado de DDD: os conceitos em 8 passos" data-tip-pos="top" aria-label="Abrir o guia de DDD">
          <Glyph name="play" size={11} />
        </button>
      )}
    </div>
  );
}

/** Usado pelo modal: contagem por severidade. */
export const severityOrder = { erro: 0, aviso: 1, dica: 2 } as const;
export const useDomainIssues = () => {
  const doc = useStore((s) => s.doc);
  return docMode(doc) !== "architecture" ? validateDetailed(doc).sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]) : [];
};
