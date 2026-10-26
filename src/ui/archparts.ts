/**
 * Objetos 3D da visão do modo architecture: os modelos feitos no Blender (assets-src/arch-parts.blend, exportados em
 * public/models/arch/<kind>.glb), um por tipo de componente.
 *
 * Cada modelo usa materiais com nome fixo, que o app troca por instância:
 * - "body": corpo do objeto, na cor do tema;
 * - "accent": detalhes na cor do asset (a mesma do 2D);
 * - "logo": plano com UV de canto a canto, que recebe o logo do asset (iconMarkup) sobre uma plaquinha clara;
 * - os outros ("dark", "light", "trim") ficam como vieram do Blender.
 *
 * As miniaturas da paleta usam o mesmo modelo, cores e logo, renderizados num WebGL pequeno e guardados como imagem.
 */
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { FOOTPRINT } from "../shared/archboard";
import { iconMarkup } from "./icons";
import type { IsoTheme } from "./iso3d";

/** corpo dos objetos por tema (o resto da cena vem de arch3dscene.ts) */
export const BODY: Record<IsoTheme, string> = { light: "#e6e9ef", dark: "#4a505c" };

let loading: Promise<Map<string, THREE.Object3D>> | null = null;
/** Carrega os modelos uma vez (todos juntos: são pequenos); uma falha deixa tentar de novo. */
export function loadParts(): Promise<Map<string, THREE.Object3D>> {
  loading ??= Promise.all(
    Object.keys(FOOTPRINT).map(async (kind) => {
      const gltf = await new GLTFLoader().loadAsync(`/models/arch/${kind}.glb`);
      return [kind, gltf.scene] as const;
    }),
  )
    .then((list) => new Map(list))
    .catch((e) => {
      loading = null;
      throw e;
    });
  return loading;
}

interface Logo {
  tex: THREE.CanvasTexture;
  ready: Promise<void>;
}
const logos = new Map<string, Logo>();

/**
 * Logo do asset numa textura: plaquinha clara de cantos arredondados (o logo fica legível sobre qualquer corpo, nos dois
 * temas) e o ícone no meio. A textura existe na hora; a imagem entra quando terminar de carregar.
 */
export function logoTexture(icon: string, color: string, name: string): Logo {
  const key = `${icon}|${color}|${name}`;
  const hit = logos.get(key);
  if (hit) return hit;
  const S = 256;
  const c = document.createElement("canvas");
  c.width = c.height = S;
  const g = c.getContext("2d")!;
  const plate = () => {
    g.clearRect(0, 0, S, S);
    g.fillStyle = "#f7f8fa";
    g.beginPath();
    g.roundRect(4, 4, S - 8, S - 8, 46);
    g.fill();
    g.strokeStyle = "rgba(20, 24, 32, 0.12)";
    g.lineWidth = 4;
    g.stroke();
  };
  plate();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  // UV do glTF: v = 0 no alto da imagem (o three não inverte as texturas dos modelos glTF)
  tex.flipY = false;
  // logo por URL (imagem própria do asset) entra direto; os do catálogo viram SVG
  const direct = /^(https?:|data:|\/)/.test(icon);
  const src = direct ? icon : URL.createObjectURL(new Blob([iconMarkup(icon, color, name)], { type: "image/svg+xml" }));
  const ready = new Promise<void>((resolve) => {
    const img = new Image();
    if (direct) img.crossOrigin = "anonymous";
    img.onload = () => {
      plate();
      const pad = S * 0.17;
      const k = Math.min((S - 2 * pad) / (img.naturalWidth || S), (S - 2 * pad) / (img.naturalHeight || S));
      const w = (img.naturalWidth || S) * k;
      const h = (img.naturalHeight || S) * k;
      try {
        g.drawImage(img, (S - w) / 2, (S - h) / 2, w, h);
      } catch {
        /* imagem de outra origem sem CORS: fica só a plaquinha */
      }
      tex.needsUpdate = true;
      if (!direct) URL.revokeObjectURL(src);
      resolve();
    };
    img.onerror = () => resolve();
    img.src = src;
  });
  const logo = { tex, ready };
  logos.set(key, logo);
  return logo;
}

export interface PartLook {
  body: THREE.ColorRepresentation;
  accent: THREE.ColorRepresentation;
  /** sem logo (endpoint), o plano do logo some */
  logo?: THREE.Texture;
}

export interface PartInstance {
  obj: THREE.Object3D;
  /** todos os materiais da instância (para apagar e acender) */
  mats: THREE.Material[];
  /** materiais que brilham no passo atual da apresentação */
  glow: THREE.MeshStandardMaterial[];
}

/** Cópia do modelo com materiais próprios: corpo, destaque e logo da instância. */
export function instancePart(tpl: THREE.Object3D, look: PartLook): PartInstance {
  const obj = tpl.clone(true);
  const mine = new Map<THREE.Material, THREE.Material>();
  const glow: THREE.MeshStandardMaterial[] = [];
  obj.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    m.userData.sharedGeometry = true; // a geometria é do modelo carregado, compartilhada entre as instâncias
    const src = m.material as THREE.MeshStandardMaterial;
    let mat = mine.get(src);
    if (!mat) {
      if (src.name === "logo") {
        mat = new THREE.MeshBasicMaterial({ map: look.logo ?? null, transparent: true, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2 });
        if (!look.logo) mat.visible = false;
      } else {
        const c = src.clone();
        if (src.name === "body") c.color.set(look.body);
        if (src.name === "accent") c.color.set(look.accent);
        if (src.name === "body" || src.name === "accent") glow.push(c);
        mat = c;
      }
      mine.set(src, mat);
    }
    m.material = mat;
  });
  return { obj, mats: [...mine.values()], glow };
}

/* ───────── miniaturas da paleta ───────── */

const SIZE = 128;
const thumbs = new Map<string, Promise<string>>();
let renderer: THREE.WebGLRenderer | null = null;
let idle: ReturnType<typeof setTimeout> | undefined;
let queue = Promise.resolve();

/** Miniatura (data URL) do objeto de um asset: o mesmo modelo, cores e logo da cena, no ângulo isométrico. */
export function partThumb(kind: string, look: { icon?: string; color: string; name: string }, theme: IsoTheme): Promise<string> {
  const key = `${theme}|${kind}|${look.icon}|${look.color}`;
  const hit = thumbs.get(key);
  if (hit) return hit;
  // uma por vez, em fila: o contexto WebGL é um só
  const job = queue.then(async () => {
    const parts = await loadParts();
    const logo = look.icon ? logoTexture(look.icon, look.color, look.name) : undefined;
    await logo?.ready;
    return draw(parts.get(kind) ?? parts.get("service")!, { body: BODY[theme], accent: look.color, logo: logo?.tex }, theme);
  });
  queue = job.then(
    () => undefined,
    () => undefined,
  );
  thumbs.set(key, job);
  job.catch(() => thumbs.delete(key));
  return job;
}

function draw(tpl: THREE.Object3D, look: PartLook, theme: IsoTheme): string {
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
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xeef2f7, 0x3a3f48, 1.2));
  const key = new THREE.DirectionalLight(0xffffff, theme === "dark" ? 2.0 : 1.6);
  key.position.set(-0.8, 1.6, 0.9);
  const rim = new THREE.DirectionalLight(0xffffff, 0.45);
  rim.position.set(1, 0.6, -1);
  scene.add(key, rim);
  const inst = instancePart(tpl, look);
  scene.add(inst.obj);
  // mesmo ângulo da vista inicial (45° em volta, 35° acima), enquadrando o objeto com folga
  const box = new THREE.Box3().setFromObject(inst.obj);
  const c = box.getCenter(new THREE.Vector3());
  const r = box.getBoundingSphere(new THREE.Sphere()).radius;
  const cam = new THREE.OrthographicCamera(-r, r, r, -r, -10, 10);
  const el = THREE.MathUtils.degToRad(35);
  cam.position.set(c.x + Math.cos(el) * Math.SQRT1_2 * 3, c.y + Math.sin(el) * 3, c.z + Math.cos(el) * Math.SQRT1_2 * 3);
  cam.lookAt(c);
  cam.zoom = 1.12;
  cam.updateProjectionMatrix();
  renderer.render(scene, cam);
  const url = renderer.domElement.toDataURL("image/png");
  for (const m of inst.mats) m.dispose();
  return url;
}
