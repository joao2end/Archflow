/** Prompts prontos para testar um agente do diagrama no Claude Code (o terminal digita, o usuário confirma). */
import type { Doc } from "./schema";

/** Agente que delega a outros subagentes (tem seta `delegates` saindo dele): o «orquestrador». */
export const isOrchestrator = (doc: Doc, id: string): boolean => doc.connections.some((c) => c.from === id && c.agent?.rel === "delegates");

/** O nome do subagente no harness é o id do nó (`.claude/agents/<id>.md`, `name:`). */
export const testPrompt = (id: string): string => `Use o subagente ${id} para: `;
