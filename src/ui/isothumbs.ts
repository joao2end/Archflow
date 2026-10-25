/**
 * Miniaturas dos componentes da visão 3D para a paleta: cada tipo desenhado com a mesma forma (isogear.ts), as mesmas
 * cores (objeto na cor da camada, base na cor do corpo do tema) e a mesma luz da cena, vistos do mesmo ângulo
 * isométrico. Renderizadas uma vez por tema num WebGL pequeno e guardadas como imagem (data URL); um tipo por tarefa,
 * para não travar a página.
 */
import * as THREE from "three";
import { ONION_RINGS, onionSlot, orbitLook } from "../shared/onion";
import type { NodeEl } from "../shared/schema";
import { baseColor, gearShape } from "./isogear";

export type ThumbTheme = "light" | "dark";
const SIZE = 128;

const cache = new Map<string, string>();
const pending = new Map<string, Promise<string>>();
let renderer: THREE.WebGLRenderer | null = null;
let idle: ReturnType<typeof setTimeout> | undefined;

/** Papel da forma 3D de um componente (o mesmo critério da cena). */
export const gearRole = (n: Pick<NodeEl, "kind" | "ddd">) => (n.ddd?.role ?? (n.kind === "actor" || n.kind === "system" ? n.kind : "external")) as string;

/** Miniatura (data URL) do componente; a chave inclui o tema e a camada, que mudam as cores. */
export function gearThumb(n: Pick<NodeEl, "kind" | "ddd">, theme: ThumbTheme): Promise<string> {
  const ring = onionSlot(n as NodeEl).ring;
  const key = `${theme}|${gearRole(n)}|${ring}|${n.ddd?.external ? "ext" : ""}`;
  const hit = cache.get(key);
  if (hit) return Promise.resolve(hit);
  const wait = pending.get(key);
  if (wait) return wait;
  // um por tarefa: a fila anda entre quadros
  const job = new Promise<string>((resolve) => setTimeout(() => resolve(draw(n, ring, theme)), pending.size * 16));
  pending.set(key, job);
  void job.then((url) => (cache.set(key, url), pending.delete(key)));
  return job;
}

function draw(n: Pick<NodeEl, "kind" | "ddd">, ring: keyof typeof ONION_RINGS, theme: ThumbTheme): string {
  if (!renderer) {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(1);
    renderer.setSize(SIZE, SIZE);
    renderer.toneMapping = THREE.NeutralToneMapping;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
  }
  // terminou a fila: solta o contexto WebGL (a cena principal já tem o dela)
  clearTimeout(idle);
  idle = setTimeout(() => {
    renderer?.dispose();
    renderer?.forceContextLoss();
    renderer = null;
  }, 1500);

  const shape = gearShape(gearRole(n));
  const ground = new THREE.Color(ONION_RINGS[ring].color);
  const top = theme === "dark" ? ground : ground.clone().lerp(new THREE.Color("#ffffff"), 0.38);
  const base = baseColor(theme, orbitLook(n as NodeEl).color);
  const mat = (c: THREE.Color) => new THREE.MeshStandardMaterial({ color: c, vertexColors: true, flatShading: true, roughness: 0.82, metalness: 0 });
  const scene = new THREE.Scene();
  // um pouco mais de luz que a cena: sem o ambiente refletido, a miniatura ficaria apagada num cartão pequeno
  scene.add(new THREE.HemisphereLight(0xeef2f7, 0x3a3f48, 1.15));
  const key = new THREE.DirectionalLight(0xffffff, theme === "dark" ? 2.1 : 1.7);
  key.position.set(-0.8, 1.6, 0.9);
  const rim = new THREE.DirectionalLight(0xffffff, 0.45);
  rim.position.set(1, 0.6, -1);
  scene.add(key, rim);
  const meshes = [new THREE.Mesh(shape.base, mat(base)), new THREE.Mesh(shape.sculpt, mat(top))];
  scene.add(...meshes);

  // mesmo ângulo da vista inicial (45° em volta, 35° acima), enquadrando base e objeto com folga
  const box = new THREE.Box3().setFromObject(scene);
  const c = box.getCenter(new THREE.Vector3());
  const r = box.getBoundingSphere(new THREE.Sphere()).radius;
  const cam = new THREE.OrthographicCamera(-r, r, r, -r, -10, 10);
  const el = THREE.MathUtils.degToRad(35);
  cam.position.set(c.x + Math.cos(el) * Math.SQRT1_2 * 3, c.y + Math.sin(el) * 3, c.z + Math.cos(el) * Math.SQRT1_2 * 3);
  cam.lookAt(c);
  cam.zoom = 1.55;
  cam.updateProjectionMatrix();
  renderer.render(scene, cam);
  const url = renderer.domElement.toDataURL("image/png");
  for (const m of meshes) (m.material as THREE.Material).dispose(); // as geometrias são do cache de isogear.ts
  return url;
}
