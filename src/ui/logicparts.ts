/**
 * Objetos 3D da visão do modo logic: os modelos feitos no Blender (scripts/blender/build-logic-parts.py, que exporta
 * public/models/logic/<papel>.glb e salva a vitrine em assets-src/logic-parts.blend), um por papel do fluxo e mais o da
 * etapa recolhida ("stage").
 *
 * Mesmas convenções das peças da placa (archparts.ts): "body" no tom do tema, "accent" na cor do papel (a mesma do 2D),
 * o resto como veio do Blender. As miniaturas da legenda usam o mesmo modelo e cor.
 */
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { LOGIC_ROLE_KEYS, type LogicRole } from "../shared/schema";
import { BODY, thumbOf } from "./archparts";
import type { IsoTheme } from "./iso3d";

export type LogicPart = LogicRole | "stage";
export const LOGIC_PARTS: LogicPart[] = [...LOGIC_ROLE_KEYS, "stage"];

let loading: Promise<Map<LogicPart, THREE.Object3D>> | null = null;
/** Carrega os modelos uma vez (todos juntos: são pequenos); uma falha deixa tentar de novo. */
export function loadLogicParts(): Promise<Map<LogicPart, THREE.Object3D>> {
  loading ??= Promise.all(
    LOGIC_PARTS.map(async (part) => {
      const gltf = await new GLTFLoader().loadAsync(`/models/logic/${part}.glb`);
      return [part, gltf.scene] as const;
    }),
  )
    .then((list) => new Map(list))
    .catch((e) => {
      loading = null;
      throw e;
    });
  return loading;
}

/** Miniatura (data URL) do objeto de um papel, na cor dele, no ângulo isométrico. */
export function logicThumb(part: LogicPart, color: string, theme: IsoTheme): Promise<string> {
  return thumbOf(`logic|${theme}|${part}|${color}`, theme, async () => {
    const parts = await loadLogicParts();
    return { tpl: parts.get(part) ?? parts.get("rule")!, look: { body: BODY[theme], accent: color } };
  });
}
