/**
 * Painel do terminal do Claude Code (modo agents): abas de sessões PTY do bridge, desenhadas com xterm.js.
 * As sessões vivem no bridge; fechar o painel NÃO as mata (reabrir reconecta e recebe o scrollback). Só a aba «×» mata.
 */
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { Terminal, type ITheme } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { fetchHarnessStatus, fetchTermInfo, killTermSession, syncHarnessNow, type ClaudeStatus, type HarnessStatus, startTermSession, TermApiError, TermConnection, type StartOptions, type TermSessionInfo } from "./termclient";
import { Glyph } from "./icons";
import { MoreMenu } from "./panekit";
import { PromptsSidebar, type RunTarget } from "./prompts";
import { emitTermExit } from "./termevents";
import type { TermApi } from "./workflow";
import { getState, runInTerminal, set as setStore, useStore } from "./store";

const HEIGHT_KEY = "archflow.term.height";
const loadHeight = () => {
  try {
    const n = Number(localStorage.getItem(HEIGHT_KEY));
    return n >= 160 ? n : 400;
  } catch {
    return 400;
  }
};

const themeFor = (dark: boolean): ITheme =>
  dark
    ? { background: "#221f22", foreground: "#fcfcfa", cursor: "#ab9df2", selectionBackground: "rgba(171,157,242,0.35)" }
    : { background: "#fbfaff", foreground: "#25244a", cursor: "#5a59c4", selectionBackground: "rgba(112,111,211,0.25)" };
const isDark = () => document.documentElement.dataset.theme === "dark";

/** Quem digita numa sessão aberta (preenchido pelo TermView): permite mandar um prompt para a aba ativa. */
const termSenders = new Map<string, (d: string) => void>();

/** Uma sessão desenhada. Fica montada (escondida) quando a aba não está ativa, para o xterm não perder o estado. */
function TermView({ session, active, onExit }: { session: string; active: boolean; onExit: (id: string, code: number) => void }) {
  const host = useRef<HTMLDivElement>(null);
  const fit = useRef<FitAddon | null>(null);
  const term = useRef<Terminal | null>(null);
  const [state, setState] = useState<"connecting" | "open" | "closed">("connecting");

  useEffect(() => {
    const el = host.current!;
    const t = new Terminal({ fontFamily: "ui-monospace, 'SF Mono', Menlo, Consolas, monospace", fontSize: 13, cursorBlink: true, scrollback: 5000, theme: themeFor(isDark()), allowProposedApi: true });
    const f = new FitAddon();
    t.loadAddon(f);
    t.loadAddon(new WebLinksAddon());
    t.open(el);
    term.current = t;
    fit.current = f;
    const conn = new TermConnection(session, {
      onReset: () => t.reset(),
      onData: (d) => t.write(d),
      onExit: (code) => {
        t.write(`\r\n\x1b[2m[processo saiu com código ${code}]\x1b[0m\r\n`);
        onExit(session, code);
      },
      onState: setState,
    });
    const send = t.onData((d) => conn.send(d));
    termSenders.set(session, (d) => (conn.send(d), t.focus()));
    const resize = t.onResize(({ cols, rows }) => conn.resize(cols, rows));
    const doFit = () => {
      if (el.offsetParent === null) return; // escondido: fit daria 0×0
      try {
        f.fit();
        conn.resize(t.cols, t.rows);
      } catch {
        /* ainda sem layout */
      }
    };
    const ro = new ResizeObserver(doFit);
    ro.observe(el);
    const mo = new MutationObserver(() => (t.options.theme = themeFor(isDark())));
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    doFit();
    return () => {
      ro.disconnect();
      mo.disconnect();
      send.dispose();
      termSenders.delete(session);
      resize.dispose();
      conn.close();
      t.dispose();
    };
  }, [session, onExit]);

  useEffect(() => {
    if (!active) return;
    requestAnimationFrame(() => {
      try {
        fit.current?.fit();
      } catch {
        /* sem layout */
      }
      // não rouba o foco de quem está digitando num formulário (ex.: as variáveis do workflow): o texto iria parar no Claude
      const a = document.activeElement;
      const typing = a instanceof HTMLElement && a.matches("input, textarea, select, summary") && !a.closest(".term-view");
      if (!typing) term.current?.focus();
    });
  }, [active]);

  return (
    <div className="term-view" hidden={!active} data-state={state}>
      <div className="term-host" ref={host} />
    </div>
  );
}

const explain = (e: unknown): string => {
  if (e instanceof TermApiError) {
    if (e.status === 404) return "O terminal está desabilitado neste bridge (ARCHFLOW_TERM=0, host fora do loopback ou modo público).";
    if (e.status === 409) return "Abra um projeto antes de iniciar o terminal.";
    return e.message;
  }
  return e instanceof Error ? e.message : String(e);
};

/** `onApi`: entrega uma API estável do terminal a quem roda workflows fora deste painel (a execução no canvas). */
export function TerminalPanel({ onApi }: { onApi?: (api: TermApi) => void } = {}) {
  const open = useStore((s) => s.termOpen);
  const [sessions, setSessions] = useState<(TermSessionInfo & { code?: number })[]>([]);
  const [activeId, setActiveId] = useState<string>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [height, setHeight] = useState(loadHeight);
  const [max, setMax] = useState(4);
  const [claude, setClaude] = useState<ClaudeStatus>({ found: true });
  const [harness, setHarness] = useState<HarnessStatus>();
  const [syncMsg, setSyncMsg] = useState<string>();
  const doc = useStore((s) => s.doc);
  const [ready, setReady] = useState(false);
  const [hintOff, setHintOff] = useState(() => {
    try {
      return localStorage.getItem("archflow.term.trust-hint") === "off";
    } catch {
      return false;
    }
  });
  const dismissHint = () => {
    setHintOff(true);
    try {
      localStorage.setItem("archflow.term.trust-hint", "off");
    } catch {
      /* sem storage */
    }
  };
  /** sessões abertas com texto a digitar: só nelas a dica do «trust» faz sentido */
  const [prefillIds, setPrefillIds] = useState<ReadonlySet<string>>(new Set());
  /** a dica do «trust» só serve no começo da sessão: some sozinha 20 s depois (sem gravar «não mostrar mais») */
  const [hintGone, setHintGone] = useState<ReadonlySet<string>>(new Set());
  const hintTimers = useRef(new Set<string>());
  useEffect(() => {
    for (const id of prefillIds) {
      if (hintTimers.current.has(id)) continue;
      hintTimers.current.add(id);
      setTimeout(() => setHintGone((g) => new Set(g).add(id)), 20_000);
    }
  }, [prefillIds]);
  const [promptsOpen, setPromptsOpen] = useState(() => {
    try {
      return localStorage.getItem("archflow.term.prompts") === "1";
    } catch {
      return false;
    }
  });
  const togglePrompts = () =>
    setPromptsOpen((v) => {
      try {
        localStorage.setItem("archflow.term.prompts", v ? "0" : "1");
      } catch {
        /* sem storage */
      }
      return !v;
    });
  const request = useStore((s) => s.termRequest);
  // «Executar» do inspetor de um prompt/workflow: abre a barra lateral, que mostra o formulário do nó
  const runNodeReq = useStore((s) => s.runNodeRequest);
  useEffect(() => {
    if (runNodeReq) setPromptsOpen(true);
  }, [runNodeReq]);
  const booted = useRef(false);
  const projectId = useStore((s) => s.workspace?.project.id);
  // outro projeto: as sessões são da pasta anterior (continuam vivas no bridge); recomeça pela lista do novo projeto
  const lastProject = useRef(projectId);
  useEffect(() => {
    if (lastProject.current === projectId) return;
    lastProject.current = projectId;
    booted.current = false;
    setSessions([]);
    setActiveId(undefined);
    setError(undefined);
    setReady(false);
  }, [projectId]);

  const checkHarness = useCallback(() => fetchHarnessStatus().then(setHarness, () => setHarness(undefined)), []);
  // aberto: confere o harness ao abrir e ~1,2 s depois de cada edição do diagrama (o sync automático tem 0,8 s)
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(checkHarness, 1200);
    return () => clearTimeout(t);
  }, [open, doc, checkHarness]);
  const sync = async () => {
    setSyncMsg(undefined);
    try {
      const r = await syncHarnessNow();
      setSyncMsg(r.conflicts.length ? `${r.conflicts.length} arquivo(s) editado(s) à mão foram preservados (${r.conflicts.slice(0, 2).join(", ")}${r.conflicts.length > 2 ? "…" : ""}). Use o botão de exportar do harness para sobrescrever.` : `Harness atualizado (${r.written.length + r.removed.length} arquivo(s)). Sessões já abertas do claude precisam ser reiniciadas para enxergar os agentes novos.`);
    } catch (e) {
      setSyncMsg(explain(e));
    }
    await checkHarness();
  };
  const recheckClaude = () =>
    fetchTermInfo(true).then(
      (info) => {
        setClaude(info.claude);
        if (info.claude.found) setError(undefined);
      },
      (e) => setError(explain(e)),
    );

  const start = useCallback(async (o: StartOptions = {}): Promise<TermSessionInfo | undefined> => {
    setBusy(true);
    setError(undefined);
    try {
      const s = await startTermSession(o);
      setSessions((l) => [...l, s]);
      setActiveId(s.id);
      return s;
    } catch (e) {
      setError(explain(e));
    } finally {
      setBusy(false);
    }
  }, []);

  // ao abrir pela primeira vez: reconecta nas sessões que o bridge já tem; se não houver nenhuma, inicia o claude
  useEffect(() => {
    if (!open || booted.current) return;
    booted.current = true;
    fetchTermInfo()
      .then((info) => {
        setMax(info.max);
        setClaude(info.claude);
        if (info.sessions.length) {
          setSessions(info.sessions.map((s) => ({ ...s, code: s.exited })));
          setActiveId(info.sessions[0].id);
        } else if (info.claude.found && !getState().termRequest) void start(); // com um pedido pendente, ele abre a sessão
        setReady(true);
      })
      .catch((e) => {
        booted.current = false;
        setError(explain(e));
        setReady(true);
      });
  }, [open, start, ready]); // `ready` volta a false na troca de projeto: refaz a leitura das sessões

  /** Abre uma sessão do claude depois de sincronizar o harness, se estiver velho (não se for de outro diagrama). */
  const startSynced = useCallback(
    async (o: StartOptions) => {
      try {
        const h = await fetchHarnessStatus();
        if (h.applicable && h.stale.length && !h.foreign) await syncHarnessNow();
      } catch {
        /* sem status: abre a sessão mesmo assim */
      }
      const s = await start(o);
      if (s && o.prefill) setPrefillIds((ids) => new Set(ids).add(s.id));
      void checkHarness();
      return s;
    },
    [start, checkHarness],
  );

  // «Testar no Claude Code»: sincroniza o harness se estiver velho e abre uma sessão com o texto já digitado
  const lastReq = useRef(0);
  useEffect(() => {
    if (!open || !ready || !request || request.n === lastReq.current) return;
    lastReq.current = request.n;
    setStore({ termRequest: null });
    if (request.target === "active") {
      const send = activeId ? termSenders.get(activeId) : undefined;
      if (send) send(request.prefill);
      else setError("Selecione uma aba do Claude Code que esteja rodando.");
      return;
    }
    if (!claude.found) return;
    void startSynced({ prefill: request.prefill, title: request.title });
  }, [open, ready, request, claude.found, startSynced, activeId]);

  const onExit = useCallback((id: string, code: number) => {
    setSessions((l) => l.map((s) => (s.id === id ? { ...s, code } : s)));
    emitTermExit(id, code);
  }, []);
  const close = async (id: string) => {
    if (sessions.find((s) => s.id === id)?.code === undefined) emitTermExit(id, -1); // fechada antes de terminar: quem esperava (workflow) é avisado
    setSessions((l) => {
      const rest = l.filter((s) => s.id !== id);
      setActiveId((a) => (a === id ? rest[rest.length - 1]?.id : a));
      return rest;
    });
    await killTermSession(id).catch(() => {});
  };

  const drag = (e: React.PointerEvent) => {
    e.preventDefault();
    const y0 = e.clientY;
    const h0 = height;
    let h = h0;
    const move = (ev: PointerEvent) => {
      h = Math.max(160, Math.min(window.innerHeight - 140, h0 + (y0 - ev.clientY)));
      setHeight(h);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      try {
        localStorage.setItem(HEIGHT_KEY, String(Math.round(h)));
      } catch {
        /* sem storage */
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const live = sessions.filter((s) => s.code === undefined).length;
  const activeSession = sessions.find((s) => s.id === activeId);
  const hasActiveClaude = !!activeSession && activeSession.code === undefined && /^claude\b/.test(activeSession.cmd);
  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;
  const termApi = {
    startExec: async (args: string[], title: string) => start({ args, title }),
    /** sessão interativa do claude (passo manual de workflow); `prefill` entra digitado, sem Enter */
    startInteractive: async (args: string[], prefill: string, title: string) => startSynced({ args, prefill, title }),
    isAlive: (id: string) => sessionsRef.current.some((s) => s.id === id && s.code === undefined),
    sendText: (id: string, text: string) => {
      const send = termSenders.get(id);
      send?.(text);
      return !!send;
    },
    activate: (id: string) => setActiveId(id),
    closeSession: (id: string) => close(id),
  };
  // o objeto acima nasce a cada render; quem está fora do painel recebe um que sempre delega para o mais recente
  const apiRef = useRef(termApi);
  apiRef.current = termApi;
  const stableApi = useMemo<TermApi>(
    () => ({
      startExec: (args, title) => apiRef.current.startExec(args, title),
      startInteractive: (args, prefill, title) => apiRef.current.startInteractive(args, prefill, title),
      isAlive: (id) => apiRef.current.isAlive(id),
      sendText: (id, text) => apiRef.current.sendText(id, text),
      activate: (id) => apiRef.current.activate(id),
      closeSession: (id) => apiRef.current.closeSession(id),
    }),
    [],
  );
  useEffect(() => onApi?.(stableApi), [onApi, stableApi]);
  // um aviso por vez, pelo que mais atrapalha: erro > claude ausente > harness velho > resultado da sincronização > dica do trust
  const trustHint = !hintOff && sessions.some((s) => prefillIds.has(s.id) && !hintGone.has(s.id) && s.code === undefined);
  const staleHarness = harness?.applicable && (harness.stale.length > 0 || harness.foreign);
  const notice: Notice | undefined = error
    ? { tone: "error", text: error, dismiss: () => setError(undefined) }
    : !claude.found
      ? { tone: "warn", text: <>O <code>claude</code> não foi encontrado. Instale com <code>npm install -g @anthropic-ai/claude-code</code> e rode <code>claude login</code>.</>, action: { label: "Verificar de novo", run: () => void recheckClaude() } }
      : staleHarness && harness
        ? { tone: "warn", text: harness.foreign ? <>O harness do projeto é do diagrama «{harness.owner}».</> : <>Harness desatualizado ({harness.stale.length} {harness.stale.length === 1 ? "arquivo" : "arquivos"}): o Claude Code ainda vê o time antigo.</>, action: { label: "Sincronizar", run: () => void sync() } }
        : syncMsg
          ? { tone: "info", text: syncMsg, dismiss: () => setSyncMsg(undefined) }
          : trustHint
            ? { tone: "info", text: "Primeira vez nesta pasta? Responda ao pedido de confiança do Claude Code: o texto é digitado depois, sem Enter.", dismiss: dismissHint }
            : undefined;

  return (
    <div className="glass term-panel" style={{ height }} hidden={!open} role="region" aria-label="Terminal do Claude Code">
      <div className="term-grip" onPointerDown={drag} role="separator" aria-orientation="horizontal" aria-label="Redimensionar o terminal" />
      <div className="term-head">
        <div className="term-tabs" role="tablist">
          {sessions.map((s) => (
            <div key={s.id} role="tab" aria-selected={s.id === activeId} tabIndex={0} className={`term-tab${s.id === activeId ? " on" : ""}${s.code !== undefined ? " dead" : ""}`} onClick={() => setActiveId(s.id)} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && setActiveId(s.id)}>
              <span className="term-tab-t">{s.title}</span>
              {s.code !== undefined && <small>saiu</small>}
              <button className="term-x" aria-label={`Fechar ${s.title}`} title="Encerrar esta sessão" onClick={(e) => (e.stopPropagation(), void close(s.id))}>×</button>
            </div>
          ))}
          <div className="term-new-wrap">
            <button className="btn ghost icon sm" disabled={busy || live >= max || !claude.found} aria-label="Nova sessão do Claude Code" title={!claude.found ? "claude não encontrado no PATH" : live >= max ? `Máximo de ${max} sessões abertas: feche alguma com ×` : `Nova sessão do Claude Code${claude.version ? ` (${claude.version})` : ""}`} onClick={() => void start()}>+</button>
            <MoreMenu glyph="▾" label="Outros tipos de sessão" items={[{ label: "Novo shell", onClick: () => void start({ program: "shell" }), disabled: busy || live >= max }]} />
          </div>
        </div>
        {live >= max - 1 && <small className="term-count" title="Sessões abertas / máximo (somando todos os projetos)">{live}/{max}</small>}
        <button className={`btn ghost sm${promptsOpen ? " active" : ""}`} aria-pressed={promptsOpen} onClick={togglePrompts} title="Prompts e workflows do diagrama">Prompts</button>
        <button className="btn ghost icon sm" aria-label="Recolher o terminal" title="Recolher (as sessões continuam rodando)" onClick={() => setStore({ termOpen: false })}>⌄</button>
      </div>
      {notice && (
        <div className={`term-note ${notice.tone}`} role={notice.tone === "error" ? "alert" : "status"}>
          <span>{notice.text}</span>
          {notice.action && <button className="btn sm" onClick={notice.action.run}>{notice.action.label}</button>}
          {notice.dismiss && <button className="term-x" aria-label="Dispensar o aviso" onClick={notice.dismiss}>×</button>}
        </div>
      )}
      <div className="term-main">
        {promptsOpen && <PromptsSidebar projectId={projectId} canRunActive={hasActiveClaude} onRun={(text, title, target: RunTarget) => runInTerminal(text, title, target)} term={termApi} />}
        <div className="term-body">
          {sessions.map((s) => (
            <TermView key={s.id} session={s.id} active={open && s.id === activeId} onExit={onExit} />
          ))}
          {!sessions.length && <div className="term-empty">{busy ? "Iniciando…" : claude.found ? "Use + para abrir o Claude Code." : "Use ▾ para abrir um shell e instalar o claude."}</div>}
        </div>
      </div>
    </div>
  );
}

interface Notice {
  tone: "error" | "warn" | "info";
  text: ReactNode;
  action?: { label: string; run: () => void };
  dismiss?: () => void;
}

type Avail = { s: "checking" } | { s: "ok" } | { s: "off"; why: string };

/** Botão «Terminal» da barra (só no modo agents): liga o painel e explica por que não dá, se o bridge não tiver terminal. */
export function TerminalButton() {
  const agents = useStore((s) => s.doc.mode === "agents");
  const storage = useStore((s) => s.storage);
  const open = useStore((s) => s.termOpen);
  const [avail, setAvail] = useState<Avail>({ s: "checking" });
  useEffect(() => {
    if (!agents) return;
    if (storage === "local") return (setStore({ termAvail: false }), setAvail({ s: "off", why: "O terminal precisa do servidor local (npm run dev ou o app desktop); a memória do navegador não tem terminal." }));
    if (storage !== "server") return setAvail({ s: "checking" });
    let dead = false;
    fetchTermInfo().then(
      () => !dead && (setStore({ termAvail: true }), setAvail({ s: "ok" })),
      (e) => !dead && (setStore({ termAvail: false }), setAvail({ s: "off", why: explain(e) })),
    );
    return () => {
      dead = true;
    };
  }, [agents, storage]);
  if (!agents) return null;
  const ok = avail.s === "ok";
  const tip = ok ? "Terminal do Claude Code na pasta do projeto: execute prompts no harness gerado" : avail.s === "off" ? avail.why : "Verificando o terminal…";
  return (
    <button className={`btn ghost${open && ok ? " active" : ""}`} disabled={!ok} aria-pressed={open && ok} onClick={() => setStore({ termOpen: !open })} data-tip={tip} data-tip-pos="bottom">
      <Glyph name="terminal" size={17} /> Terminal
    </button>
  );
}
