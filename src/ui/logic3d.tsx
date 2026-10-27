/**
 * Visão 3D do modo logic: o fluxo (Start → passos → End) numa placa que lembra um circuito, com módulos feitos no Blender
 * (logicparts.ts) que mostram a função de cada passo, e as setas em trilhas (logic3dscene.ts).
 *
 * A tela fica para o diagrama; cada coisa tem o seu lugar e só aparece quando serve:
 * - Esquerda (recolhível): busca, as peças por papel (clicar acende as daquele papel), as saídas e a chave «Dados e
 *   cenários no quadro» (por padrão o quadro mostra só o fluxo).
 * - Em cima: «Testar cenário» — escolher o exemplo e rodar; ao terminar, se o resultado confere.
 * - Durante o teste, embaixo: a barra de reprodução (passos, tocar/pausar, velocidade) com o passo atual numa linha; na
 *   cena, o caminho percorrido acende e o passo atual ganha um cartão de debug sobre a peça (a tela se centraliza
 *   nele): a condição ou o cálculo em TypeScript com os valores, o que mudou, o que a trava barrou, os dados lidos e a
 *   volta do laço. Passar o mouse numa peça já percorrida abre o cartão dela; clicar no cartão volta àquele passo. O
 *   painel de debug do 2D (inclusive em tela cheia) não aparece no 3D: os cartões explicam cada passo.
 * - O inspetor e o painel de reprodução do 2D saem de cena no 3D (o 3D tem os seus).
 *
 * Câmera estilo Blender: botão do meio orbita; Shift + meio move; roda = zoom no cursor; Q/E giram 15°. Clicar seleciona e
 * acende os vizinhos; duplo clique numa etapa recolhida a abre; ← → andam os passos do teste; F centraliza; Esc fecha o
 * que estiver aberto e, por fim, volta ao 2D.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { LOGIC_BRANCHES, LOGIC_ROLES, isDataRole, type LogicBranch, type NodeEl } from "../shared/schema";
import { layoutView, hiddenBy } from "../shared/logicstages";
import { debugCards, playSteps, valuesAfter, whyOf } from "../shared/logicdebug";
import { checkExamples } from "../shared/logic";
import { LogicScene, BRANCH_COLOR, partOf, type LogicPlay3D } from "./logic3dscene";
import { logicThumb, type LogicPart } from "./logicparts";
import { reducedMotion, type IsoTheme } from "./iso3d";
import { ENTER_MS, LEAVE_MS, exitIso, readTheme, registerLeave, useIsoChrome, useTheme } from "./isoshell";
import { PLAY_SPEEDS, getState, playGo, playToggle, select, set, setPlaySpeed, startPlay, stopPlay, toastError, toggleStage, useStore } from "./store";

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

const partLabel = (p: LogicPart) => (p === "stage" ? "Etapa" : LOGIC_ROLES[p].label);
const partColor = (p: LogicPart) => (p === "stage" ? "#706fd3" : LOGIC_ROLES[p].color);
const isData = (n: NodeEl) => !!n.logic && (isDataRole(n.logic.role) || n.logic.role === "scenario");

export function LogicView() {
  const doc = useStore((s) => s.doc);
  const sel = useStore((s) => s.sel);
  const play = useStore((s) => s.play);
  const host = useRef<HTMLDivElement>(null);
  const scene = useRef<LogicScene | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const view = useRef<HTMLDivElement>(null);
  const side = useRef<HTMLElement>(null);
  const [query, setQuery] = useState("");
  const [role, setRole] = useState<LogicPart | null>(null);
  const [showData, setShowData] = useState(false);
  const [railOpen, setRailOpen] = useState(true);
  const theme = useTheme();
  useIsoChrome(view);
  // o inspetor e o painel de reprodução do 2D saem de cena enquanto o 3D do fluxo está aberto
  useEffect(() => {
    document.documentElement.classList.add("logic3d-on");
    if (getState().playFull) set({ playFull: false });
    return () => document.documentElement.classList.remove("logic3d-on");
  }, []);

  // o quadro como se vê: etapas recolhidas no lugar dos passos delas
  const shown = useMemo(() => layoutView(doc), [doc]);
  const pieces = useMemo(() => shown.doc.nodes.filter((n) => n.logic && (showData || !isData(n))), [shown, showData]);
  const selNode = pieces.find((n) => sel.length === 1 && n.id === sel[0]);
  const matches = useMemo(() => {
    const q = norm(query.trim());
    if (!q) return null;
    return pieces.filter((n) => [n.label, n.logic?.key ?? "", n.logic?.text ?? ""].some((t) => norm(t).includes(q)));
  }, [pieces, query]);
  const roles = useMemo(() => {
    const count = new Map<LogicPart, number>();
    for (const n of pieces) count.set(partOf(n, shown.stageIds), (count.get(partOf(n, shown.stageIds)) ?? 0) + 1);
    const order: LogicPart[] = ["start", "rule", "table", "decision", "switch", "loop", "fork", "join", "code", "call", "stage", "end", "input", "output", "variable", "scenario"];
    return order.filter((p) => count.has(p)).map((p) => ({ part: p, n: count.get(p)! }));
  }, [pieces, shown]);
  const branches = useMemo(() => {
    const ids = new Set(pieces.map((n) => n.id));
    const count = new Map<string, number>();
    for (const c of shown.doc.connections) {
      if (!ids.has(c.from) || !ids.has(c.to) || !(c.logic?.branch || c.logic?.case)) continue;
      const k = c.logic.branch ?? "caso";
      count.set(k, (count.get(k) ?? 0) + 1);
    }
    return [...count].map(([key, n]) => ({ key, n }));
  }, [pieces, shown]);
  const cases = useMemo(
    () => doc.nodes.filter((n) => n.logic?.role === "scenario").flatMap((s) => (s.logic!.examples ?? []).map((ex, i) => ({ id: s.id, i, label: (s.logic!.examples!.length > 1 ? `${s.label} · ${ex.name}` : s.label) }))),
    [doc.nodes],
  );

  // a reprodução: o caminho até o passo atual, a seta que levou até ele e o que ele mudou (passos de uma etapa recolhida contam por ela)
  const steps = useMemo(() => (play ? playSteps(play.run) : []), [play?.run]);
  const cur = play ? steps[play.k] : undefined;
  const play3d = useMemo<LogicPlay3D | null>(() => {
    if (!play) return null;
    const hid = hiddenBy(doc);
    const at = (id: string) => hid.get(id) ?? id;
    const upto = steps.slice(0, play.k + 1);
    const conns = shown.doc.connections;
    const edges: string[] = [];
    let curEdge: string | undefined;
    for (let i = 1; i < upto.length; i++) {
      const from = at(upto[i - 1].rule);
      const to = at(upto[i].rule);
      if (from === to) continue;
      const out = conns.filter((c) => c.from === from && c.to === to);
      // entre as setas do mesmo par, a da saída que o passo tomou
      const c = out.find((x) => x.logic?.branch === upto[i - 1].branch || x.logic?.case === upto[i - 1].branch) ?? out[0];
      if (!c) continue;
      edges.push(c.id);
      if (i === upto.length - 1) curEdge = c.id;
    }
    const last = upto[upto.length - 1];
    const cards = debugCards(doc, play.run, play.k, at);
    return { cur: last ? at(last.rule) : undefined, visited: [...new Set(upto.map((s) => at(s.rule)))], edges, curEdge, cards };
  }, [play, steps, doc, shown]);

  const [phase, setPhase] = useState<"enter" | "build" | "ready" | "leave">("enter");
  const [live, setLive] = useState<LogicScene | null>(null);
  useEffect(() => {
    registerLeave(() => {
      if (reducedMotion()) return set({ iso: false });
      setPhase("leave");
      setTimeout(() => set({ iso: false }), LEAVE_MS);
    });
    return () => registerLeave(null);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let s: LogicScene | null = null;
    const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
    void (async () => {
      await pause(reducedMotion() ? 0 : ENTER_MS);
      if (cancelled) return;
      setPhase((p) => (p === "leave" ? p : "build"));
      s = new LogicScene(host.current!, {
        onNode: (id) => select([id]),
        onOpenStage: (id) => toggleStage(id, false),
        onEmpty: () => select([]),
        onStep: (k) => playGo(k),
      });
      scene.current = s;
      try {
        await s.load();
      } catch {
        toastError("Não deu para carregar os objetos 3D");
        return exitIso();
      }
      if (cancelled) return;
      const st = getState();
      s.setTheme(readTheme());
      s.setDoc(st.doc);
      s.setSelection(st.sel);
      await s.warmup();
      if (cancelled) return;
      setLive(s);
      s.intro();
      setPhase((p) => (p === "leave" ? p : "ready"));
    })();
    return () => {
      cancelled = true;
      s?.dispose();
      scene.current = null;
    };
  }, []);

  useEffect(() => live?.setOptions({ showData }), [showData, live]);
  useEffect(() => live?.setDoc(doc), [doc, live]);
  useEffect(() => live?.setSelection(sel), [sel, live]);
  useEffect(() => live?.setTheme(theme), [theme, live]);
  useEffect(() => live?.setPlay(play3d), [play3d, live]);
  useEffect(() => {
    const ids = matches ? matches.map((n) => n.id) : role ? pieces.filter((n) => partOf(n, shown.stageIds) === role).map((n) => n.id) : null;
    live?.setFilter({ match: ids });
  }, [matches, role, pieces, shown, live]);

  /** a cena se centra no espaço livre entre o painel da esquerda, o da aula (se houver) e a barra de reprodução */
  useEffect(() => {
    if (!live) return;
    const fit = () => {
      const el = side.current;
      const left = el && el.offsetWidth && el.offsetWidth < window.innerWidth * 0.6 ? el.getBoundingClientRect().right : 0;
      const data = document.querySelector<HTMLElement>(".story-panel, .lesson-panel");
      const right = data && data.offsetWidth && data.offsetWidth < window.innerWidth * 0.6 ? window.innerWidth - data.getBoundingClientRect().left : 0;
      const bar = document.querySelector<HTMLElement>(".l3-bar");
      const bottom = bar ? window.innerHeight - bar.getBoundingClientRect().top : 0;
      const test = document.querySelector<HTMLElement>(".l3-test, .topbar");
      live.setInset(left, right, bottom, test ? test.getBoundingClientRect().bottom : 0);
    };
    const id = requestAnimationFrame(fit);
    const ro = new ResizeObserver(fit);
    if (side.current) ro.observe(side.current);
    window.addEventListener("resize", fit);
    return () => (cancelAnimationFrame(id), ro.disconnect(), window.removeEventListener("resize", fit));
  }, [live, !!play, railOpen]);

  const [hint, setHint] = useState(true);
  useEffect(() => {
    if (!hint) return;
    const t = setTimeout(() => setHint(false), 7000);
    return () => clearTimeout(t);
  }, [hint]);

  const focusNode = (id: string) => {
    select([id]);
    scene.current?.flyTo(id);
  };

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest("input, textarea, select, [contenteditable]")) return;
      if (getState().modal || getState().present) return;
      if (e.key === "Escape") {
        if (query) setQuery("");
        else if (role) setRole(null);
        else if (getState().play) stopPlay();
        else if (getState().sel.length) select([]);
        else exitIso();
      }
      if (e.ctrlKey || e.metaKey || e.altKey) {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") (e.preventDefault(), searchRef.current?.focus());
        return;
      }
      if (e.key === "/") (e.preventDefault(), searchRef.current?.focus());
      if (e.key === "?") setHint((h) => !h);
      if (e.key === " " && getState().play) (e.preventDefault(), playToggle());
      if (e.key === "q" || e.key === "Q") scene.current?.orbit(15);
      if (e.key === "e" || e.key === "E") scene.current?.orbit(-15);
      if (e.key === "f" || e.key === "F") (selNode ? scene.current?.flyTo(selNode.id) : scene.current?.frameAll());
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [query, role, selNode]);

  const branchText = (k: string) => (k === "caso" ? "caso do switch" : LOGIC_BRANCHES[k as LogicBranch]?.label ?? k);
  const [pick, setPick] = useState(0);
  const chosen = cases[Math.min(pick, cases.length - 1)];
  const playing = play ? cases.findIndex((c) => c.id === play.scenario && c.i === play.example) : -1;

  return (
    <div ref={view} className={`iso-view logic3d iso-${theme} iso-${phase}`} data-ui aria-busy={phase !== "ready"}>
      {phase !== "ready" && phase !== "leave" && (
        <div className="iso-loading" role="status">
          <span className="iso-spinner" aria-hidden />
          Montando o fluxo 3D…
        </div>
      )}
      <div ref={host} className="iso3d-host" role="img" aria-label={`Visão 3D do fluxo de ${doc.title}`} onPointerDown={() => setHint(false)} />

      {railOpen ? (
        <aside ref={side} className="iso-side glass l3-rail" aria-label="Busca e legenda da placa">
          <div className="l3-rail-head">
            <div className="iso-search">
              <input
                ref={searchRef}
                type="search"
                className="input"
                placeholder="Buscar passo…"
                aria-label="Buscar passo ou dado"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && matches?.[0]) focusNode(matches[0].id);
                  if (e.key === "Escape") (setQuery(""), e.currentTarget.blur());
                }}
              />
              <kbd aria-hidden>/</kbd>
            </div>
            <button className="btn ghost icon sm" onClick={() => setRailOpen(false)} aria-label="Recolher o painel" data-tip="Recolher" data-tip-pos="right">
              ‹
            </button>
          </div>
          {matches && (
            <div className="iso-results" role="listbox" aria-label="Resultados da busca">
              <div className="iso-count" aria-live="polite">
                {matches.length ? `${matches.length} encontrado${matches.length > 1 ? "s" : ""}` : "Nada encontrado"}
              </div>
              {matches.slice(0, 8).map((n) => (
                <button key={n.id} role="option" aria-selected={sel.includes(n.id)} className={sel.includes(n.id) ? "on" : ""} onClick={() => focusNode(n.id)}>
                  <i style={{ background: partColor(partOf(n, shown.stageIds)) }} />
                  <span>{n.label}</span>
                  <small>{partLabel(partOf(n, shown.stageIds))}</small>
                </button>
              ))}
            </div>
          )}

          <div className="l3-sec">
            <div className="l3-sec-title">Peças</div>
            <div className="l3-parts">
              {roles.map(({ part, n }) => (
                <button key={part} className={role === part ? "on" : ""} aria-pressed={role === part} onClick={() => setRole((r) => (r === part ? null : part))} title={part === "stage" ? "Etapa recolhida (duplo clique na peça abre)" : LOGIC_ROLES[part].hint}>
                  <PieceImg part={part} theme={theme} />
                  <span>{partLabel(part)}</span>
                  <small>{n}</small>
                </button>
              ))}
            </div>
          </div>

          {branches.length > 0 && (
            <div className="l3-sec">
              <div className="l3-sec-title">Saídas</div>
              <div className="l3-chips">
                {branches.map(({ key }) => (
                  <span key={key} style={{ ["--c" as string]: BRANCH_COLOR[key] ?? "#8f97a6" }}>
                    {branchText(key)}
                  </span>
                ))}
              </div>
            </div>
          )}

          <label className="l3-switch">
            <input type="checkbox" checked={showData} onChange={(e) => setShowData(e.target.checked)} />
            <span>Dados e cenários no quadro</span>
          </label>
        </aside>
      ) : (
        <button className="iso-side glass l3-rail-open" onClick={() => setRailOpen(true)} aria-label="Abrir o painel de busca e legenda" data-tip="Busca e legenda" data-tip-pos="right">
          ☰
        </button>
      )}

      {cases.length > 0 && (
        <div className="l3-test glass" role="group" aria-label="Testar um cenário">
          <span className="l3-test-lbl">Testar</span>
          <select className="input" value={playing >= 0 ? playing : pick} onChange={(e) => (setPick(Number(e.target.value)), play && startPlay(cases[Number(e.target.value)].id, cases[Number(e.target.value)].i))} aria-label="Cenário a testar">
            {cases.map((c, i) => (
              <option key={`${c.id}-${c.i}`} value={i}>
                {c.label}
              </option>
            ))}
          </select>
          {play ? (
            <button className="btn ghost sm" onClick={stopPlay}>
              Parar
            </button>
          ) : (
            <button className="btn primary sm" onClick={() => chosen && startPlay(chosen.id, chosen.i)}>
              ▶ Rodar
            </button>
          )}
          {play && <Verdict />}
        </div>
      )}

      {play && cur && <PlayBar steps={steps} />}

      {selNode && !play && (
        <div className="iso-focus glass" role="toolbar" aria-label={`Foco em ${selNode.label}`}>
          <span className="iso-focus-name" style={{ ["--rc" as string]: partColor(partOf(selNode, shown.stageIds)) }}>
            {selNode.label}
          </span>
          <span className="iso-focus-sep" />
          {shown.stageIds.has(selNode.id) && (
            <button className="btn ghost" onClick={() => toggleStage(selNode.id, false)}>
              Abrir etapa
            </button>
          )}
          <button className="btn ghost" onClick={() => select([])} data-tip="Mostrar tudo (Esc)" data-tip-pos="top">
            Tudo
          </button>
          <button className="btn ghost" onClick={() => scene.current?.flyTo(selNode.id)} data-tip="Centralizar (F)" data-tip-pos="top">
            Centralizar
          </button>
        </div>
      )}

      {!play && (
        <div className={`iso-hint glass${hint ? "" : " off"}`} role="note" aria-hidden={!hint}>
          <span><kbd>Botão do meio</kbd> orbitar</span>
          <span><kbd>Shift</kbd>+<kbd>meio</kbd> mover</span>
          <span><kbd>Roda</kbd> zoom</span>
          <span><kbd>Q</kbd><kbd>E</kbd> girar</span>
          <span><kbd>F</kbd> enquadrar</span>
          <span><kbd>Esc</kbd> 2D</span>
        </div>
      )}
      {!hint && !play && (
        <button className="iso-hint-btn glass" onClick={() => setHint(true)} aria-label="Mostrar os controles da visão 3D" data-tip="Controles (?)" data-tip-pos="left">
          ?
        </button>
      )}
    </div>
  );
}

/** O resultado do teste: confere com o esperado ou não (e quantas diferenças). */
function Verdict() {
  const play = useStore((s) => s.play)!;
  const doc = useStore((s) => s.doc);
  const ex = doc.nodes.find((n) => n.id === play.scenario)?.logic?.examples?.[play.example];
  const result = useMemo(() => checkExamples(doc).find((r) => r.node === play.scenario && r.example === ex?.name), [doc, play.scenario, ex?.name]);
  if (!result) return null;
  return result.ok ? (
    <span className="l3-verdict ok" title="O fluxo devolve o que o cenário espera">✓ confere</span>
  ) : (
    <span className="l3-verdict bad" title={result.problems.join("\n")}>
      ✗ {result.problems.length} diferença{result.problems.length > 1 ? "s" : ""}
    </span>
  );
}

/** Barra de reprodução: os passos como uma régua clicável, os controles e o passo atual numa linha. */
function PlayBar({ steps }: { steps: ReturnType<typeof playSteps> }) {
  const play = useStore((s) => s.play)!;
  const speed = useStore((s) => s.playSpeed);
  const doc = useStore((s) => s.doc);
  const k = play.k;
  const last = steps.length - 1;
  const cur = steps[k];
  const why = whyOf(doc, cur, valuesAfter(play.run, k));
  const answer = cur.error ? `erro: ${cur.error}` : (why.answer ?? (cur.branch ? (LOGIC_BRANCHES[cur.branch as LogicBranch]?.label ?? cur.branch) : ""));
  const role = cur.role === "start" ? "Início" : cur.role === "end" ? "Fim" : LOGIC_ROLES[cur.role]?.label;
  return (
    <div className="l3-bar glass" role="toolbar" aria-label="Reprodução do cenário">
      <div className="l3-ruler" role="slider" aria-label="Passo" aria-valuemin={1} aria-valuemax={steps.length} aria-valuenow={k + 1}>
        {steps.map((s, i) => (
          <button key={i} className={`${i < k ? "seen" : ""}${i === k ? " on" : ""}${s.changes.length ? " chg" : ""}${s.error ? " err" : ""}`} onClick={() => playGo(i)} aria-label={`Passo ${i + 1}: ${s.label}`} title={`${i + 1}. ${s.label}`} />
        ))}
      </div>
      <div className="l3-bar-row">
        <button className="btn ghost icon sm" onClick={() => playGo(0)} disabled={k === 0} aria-label="Primeiro passo">⏮</button>
        <button className="btn ghost icon sm" onClick={() => playGo(k - 1)} disabled={k === 0} aria-label="Passo anterior (←)">◀</button>
        <button className="btn primary icon sm" onClick={playToggle} aria-label={play.playing ? "Pausar (espaço)" : "Tocar (espaço)"}>{play.playing ? "❚❚" : "▶"}</button>
        <button className="btn ghost icon sm" onClick={() => playGo(k + 1)} disabled={k >= last} aria-label="Próximo passo (→)">▶</button>
        <button className="btn ghost icon sm" onClick={() => playGo(last)} disabled={k >= last} aria-label="Último passo">⏭</button>
        <span className="l3-step">
          <b>{k + 1}/{steps.length}</b>
          <small>{role}</small>
          <span className="l3-step-name">{cur.label}</span>
          {answer && <em className={cur.error ? "err" : ""}>→ {answer}</em>}
        </span>
        <select className="input l3-speed" value={speed} onChange={(e) => setPlaySpeed(Number(e.target.value))} aria-label="Velocidade">
          {PLAY_SPEEDS.map((v) => (
            <option key={v} value={v}>
              {v}x
            </option>
          ))}
        </select>
        <button className="btn ghost icon sm" onClick={stopPlay} aria-label="Fechar o teste (Esc)">✕</button>
      </div>
    </div>
  );
}

/** Miniatura do componente do papel (o mesmo modelo e cor da cena); enquanto renderiza, um espaço do mesmo tamanho. */
function PieceImg({ part, theme }: { part: LogicPart; theme: IsoTheme }) {
  const [src, setSrc] = useState<string>();
  useEffect(() => {
    let on = true;
    void logicThumb(part, partColor(part), theme)
      .then((url) => on && setSrc(url))
      .catch(() => undefined);
    return () => {
      on = false;
    };
  }, [part, theme]);
  return src ? <img src={src} alt="" draggable={false} /> : <span aria-hidden />;
}

/** Há fluxo para mostrar em 3D (algum passo do modo logic)? */
export const hasLogic3d = (nodes: NodeEl[]) => nodes.some((n) => n.logic);
