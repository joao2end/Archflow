import { applyTemplate, findAgentTemplate, searchAgentTemplates, type AgentTemplate } from "../shared/agentcatalog";
import { applyOps } from "../shared/ops";
import { fitView } from "./keys";
import { commit, getState, set, toast, toastError, useStore } from "./store";

/** Onde um modelo entra quando ninguém disse: no canto de um diagrama vazio, ou abaixo de tudo que já existe. */
function defaultSpot(): { x: number; y: number } {
  const { doc } = getState();
  const all = [...doc.nodes, ...doc.groups, ...doc.notes];
  if (!all.length) return { x: 0, y: 0 };
  return { x: Math.round(Math.min(...all.map((b) => b.x)) / 8) * 8, y: Math.round((Math.max(...all.map((b) => b.y + b.h)) + 160) / 8) * 8 };
}

/**
 * Aplica um papel ou time do catálogo no diagrama aberto, num único passo de desfazer, seleciona os agentes criados e
 * enquadra o resultado na tela. Skills do catálogo entram sem baixar nada (são resolvidas quando você abre a skill).
 */
export function applyAgentTemplate(id: string, at?: { x: number; y: number }) {
  const tpl = findAgentTemplate(id);
  const state = getState();
  if (!tpl) return toastError(`Modelo «${id}» não existe`);
  if (state.doc.mode !== "agents") return toastError("Modelos de agentes só entram em diagramas do modo Agents");
  let result;
  try {
    result = applyTemplate(state.doc, tpl, at ?? defaultSpot());
  } catch (e) {
    return toastError(e instanceof Error ? e.message : String(e));
  }
  const out = applyOps(state.doc, result.ops);
  const bad = out.results.find((r) => !r.ok);
  if (bad) return toastError(`Não deu para aplicar «${tpl.name}»: ${bad.error ?? "erro desconhecido"}`);
  commit(out.doc);
  set({ sel: result.agentIds });
  const before = new Set(state.doc.nodes.map((n) => n.id));
  const added = out.doc.nodes.filter((n) => !before.has(n.id));
  setTimeout(() => fitView(null, added.map((n) => ({ x: n.x, y: n.y, w: n.w, h: n.h }))), 0);
  // o que entrou, por papel (antes, prompts e workflows do modelo eram contados como «ferramentas/skill»)
  const count = (role: string) => added.filter((n) => n.agent?.role === role).length;
  const skills = count("skill");
  const parts = ([["agent", "agente", "agentes"], ["skill", "skill", "skills"], ["tool", "ferramenta", "ferramentas"], ["prompt", "prompt", "prompts"], ["workflow", "workflow", "workflows"]] as const)
    .map(([role, one, many]) => [count(role), one, many] as const)
    .filter(([n]) => n > 0)
    .map(([n, one, many]) => `${n} ${n === 1 ? one : many}`);
  toast(
    `${tpl.name} aplicado: ${parts.join(", ") || "nada novo"}${result.reused ? ` (${result.reused} já existiam e foram reaproveitados)` : ""}.${skills ? ` ${skills === 1 ? "A skill do catálogo ainda está" : "As skills do catálogo ainda estão"} sem conteúdo: abra cada uma para baixar.` : ""}`,
  );
}

const tagOf = (t: AgentTemplate) => (t.kind === "team" ? `time · ${t.agents.length} agentes` : "papel");

/** Modo agents: papéis e times prontos para clicar ou arrastar para o canvas. */
export function CatalogAgents({ q }: { q: string }) {
  const doc = useStore((s) => s.doc);
  const list = searchAgentTemplates(q);
  const used = (t: AgentTemplate) => t.agents.filter((a) => doc.nodes.some((n) => n.agent?.role === "agent" && n.label === a.label)).length;
  return (
    <section>
      <div className="lib-cat">Agentes do catálogo</div>
      <div className="lib-hint">Clique para adicionar ao diagrama (abaixo do que já existe) ou arraste para o ponto desejado. Um passo de desfazer.</div>
      {list.map((t) => {
        const n = used(t);
        return (
          <div
            key={t.id}
            className="asset"
            draggable
            onDragStart={(ev) => {
              ev.dataTransfer.setData("application/x-archflow-agent-template", t.id);
              ev.dataTransfer.effectAllowed = "copy";
            }}
            onClick={() => applyAgentTemplate(t.id)}
            role="button"
            tabIndex={0}
            onKeyDown={(ev) => (ev.key === "Enter" || ev.key === " ") && (ev.preventDefault(), applyAgentTemplate(t.id))}
            data-tip={t.agents.map((a) => a.label).join(" · ")}
            data-tip-pos="right"
          >
            <div className="meta">
              <div className="name">
                {t.name}
                <span className="lib-used">{tagOf(t)}</span>
                {n > 0 && <span className="lib-used">{n} já no quadro</span>}
              </div>
              <div className="desc">{t.description}</div>
            </div>
          </div>
        );
      })}
      {!list.length && <div className="empty">Nenhum modelo para «{q}». Tente «landing», «revisão» ou «pesquisa».</div>}
    </section>
  );
}
