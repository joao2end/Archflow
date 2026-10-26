/**
 * Cena three.js da visão 3D do layout "camadas" (modo domain).
 *
 * - Camadas: cada anel (ou setor) é uma geometria extrudada de verdade, mais alta quanto mais para dentro (Entities no topo),
 *   na cor da camada.
 * - Componentes: arte abstrata de triângulos (isogear.ts): base em bloco isométrico e escultura low-poly facetada com a
 *   silhueta do papel, na cor dele; o ícone do papel fica no tampo da base.
 * - Degraus e canais: cada camada é um terraço mais alto que o de fora; no pé de cada degrau corre um canal rebaixado.
 * - Conectores: arco 3D de um equipamento ao outro, na cor da relação (REL_STYLE), com contorno escuro, seta e pulsos que
 *   andam no sentido da conexão. Uma cópia "raio-x" fraca, desenhada por cima de tudo, mostra o trecho escondido atrás das
 *   camadas. Pares com mais de uma conexão abrem os arcos para os lados.
 * - Foco: apontar um componente acende as conexões dele (com o nome da relação) e apaga o resto; selecionar esconde tudo
 *   o que não é vizinho da seleção (1 ou 2 passos); a busca acende os achados. A legenda esconde relações.
 * - Apresentação (setSpotlight): o passo atual do passo a passo brilha pulsando com um anel em volta, os já vistos
 *   ficam meio apagados e o resto quase some; as conexões do passo se desenham do início ao fim com pulsos mais rápidos e
 *   a câmera voa até o passo.
 * - Criação: arrastar de um componente a outro cria a conexão (linha-guia segue o ponteiro); a paleta (iso.tsx) usa
 *   pick() e setDropHint() para soltar componentes nas camadas.
 * - Tema claro e escuro (setTheme): fundo, cor das camadas, corpo dos equipamentos, conectores e rótulos.
 * - Rótulos: HTML (CSS2DRenderer), sempre de frente para a tela.
 * - Câmera ortográfica com OrbitControls, navegação estilo Blender: botão do meio orbita, Shift + meio move, Ctrl + meio
 *   e roda dão zoom (no cursor); clique e arraste testam caixas simples dos componentes.
 *
 * Plano 2D do diagrama (x, y) → mundo three (x, altura, y): o eixo Y do three é a altura.
 */
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { CSS2DObject, CSS2DRenderer } from "three/addons/renderers/CSS2DRenderer.js";
import { dddConnLabel, layerViolations } from "../shared/domain";
import { orbitLook, polar } from "../shared/onion";
import type { Doc, GroupEl, NodeEl } from "../shared/schema";
import type { Spotlight3D } from "./store";
import { truncate, wrapLabel } from "../shared/text";
import { BASE_H, baseColor, gearShape } from "./isogear";

/** altura de cada degrau (uma camada sobre a outra): Entities no alto, cada camada de fora um degrau abaixo */
const STEP = 140;
/** tamanho do componente: 1 unidade da forma (isogear.ts) = UNIT px do diagrama */
const UNIT = 140;
export type IsoTheme = "light" | "dark";
/** Cores de cada tema: base das camadas, corpo dos equipamentos, conectores e contexto. */
const THEMES: Record<IsoTheme, { tierBase: string; tierMix: number; body: string; conn: string; context: string; hemi: number; key: number; channel: string; fluid: string; pulse: string }> = {
  light: { tierBase: "#cfd5de", tierMix: 0.8, body: "#aeb5c1", conn: "#3a4150", context: "#c2410c", hemi: 0.65, key: 1.05, channel: "#9aa3b2", fluid: "#3f8fb8", pulse: "#e8f6ff" },
  dark: { tierBase: "#23262d", tierMix: 0.3, body: "#3a3f48", conn: "#a9b1bf", context: "#f0874f", hemi: 0.55, key: 1.3, channel: "#16191e", fluid: "#2f7fa6", pulse: "#cfeeff" },
};
/** canal entre camadas: quanto ele entra no degrau de fora, profundidade e raio da tubulação */
const CARVE = 22;
const DEPTH = 12;
const PIPE = 3.2;
/** Cor e nome de cada relação nos conectores (a legenda usa a mesma tabela). "other": conexão sem relação de domínio. */
export const REL_STYLE: Record<string, { label: string; color: string }> = {
  emits: { label: "emite evento", color: "#a46cf2" },
  triggers: { label: "dispara", color: "#f2902f" },
  contains: { label: "contém", color: "#ec5b93" },
  "references-by-id": { label: "referencia (id)", color: "#6c9cff" },
  realizes: { label: "realiza", color: "#2fbf71" },
  uses: { label: "usa", color: "#1fb8d0" },
  "context-relation": { label: "entre contextos", color: "#ff6a3d" },
  other: { label: "outra", color: "#8f97a6" },
};
/** Conexão que fere a regra de camadas (camada interna dependendo de uma externa, D034). */
export const VIOLATION_STYLE = { label: "fere a regra de camadas", color: "#e5484d" };
/** comprimento (px) de um ciclo do padrão de pulsos e velocidade do fluxo (px/s) */
const PULSE_TILE = 44;
const FLOW_SPEED = 70;

/** Um círculo de camadas (o diagrama todo, ou um contexto): camadas de dentro para fora e os canais entre elas. */
interface Onion {
  cx: number;
  cy: number;
  layers: { R: number; ri: number; top: number }[];
  /** channels[k] fica entre a camada k−1 (dentro) e a k (fora) */
  channels: ({ rIn: number; rOut: number; floor: number } | undefined)[];
}

/** Ícones do tampo (caixa 24×24, traço), desenhados num canvas e acesos sobre o equipamento. */
const ICONS: Record<string, string> = {
  "aggregate-root": "M12 3l8 4.5v9L12 21l-8-4.5v-9z M12 12l8-4.5 M12 12v9 M12 12L4 7.5",
  entity: "M4 6h16v12H4z M8 10h5 M8 14h8",
  "value-object": "M12 4l8 8-8 8-8-8z",
  "domain-event": "M13 3L5 14h6l-1 7 8-11h-6z",
  command: "M8 5l11 7-11 7z",
  "use-case": "M4 12a8 8 0 1 0 16 0a8 8 0 1 0-16 0 M9 12a3 3 0 1 0 6 0a3 3 0 1 0-6 0",
  policy: "M12 3l7 3v5c0 5-3 8-7 10-4-2-7-5-7-10V6z",
  "process-manager": "M5 12a7 7 0 0 1 12-5 M19 4v4h-4 M19 12a7 7 0 0 1-12 5 M5 20v-4h4",
  repository: "M5 6c0-2.5 14-2.5 14 0v12c0 2.5-14 2.5-14 0z M5 6c0 2.5 14 2.5 14 0 M5 12c0 2.5 14 2.5 14 0",
  controller: "M3 12h11 M10 8l4 4-4 4 M15 4h5v16h-5",
  "read-model": "M2 12c3-5 7-7 10-7s7 2 10 7c-3 5-7 7-10 7s-7-2-10-7z M9 12a3 3 0 1 0 6 0a3 3 0 1 0-6 0",
  "domain-service": "M8 12a4 4 0 1 0 8 0a4 4 0 1 0-8 0 M12 3v4 M12 17v4 M3 12h4 M17 12h4 M5.6 5.6l2.8 2.8 M15.6 15.6l2.8 2.8 M5.6 18.4l2.8-2.8 M15.6 8.4l2.8-2.8",
  "application-service": "M12 3l9 5-9 5-9-5z M3 13l9 5 9-5",
  system: "M5 5h6v6H5z M13 13h6v6h-6z M11 8h5v5",
};

const roleOf = (n: NodeEl) => (n.ddd?.role ?? (n.kind === "actor" || n.kind === "system" ? n.kind : "external")) as string;

export interface IsoEvents {
  onNode: (id: string) => void;
  onTier: (groupId: string, clientX: number, clientY: number) => void;
  onEmpty: () => void;
  /** arrastou de um componente e soltou em outro */
  onConnect: (from: string, to: string) => void;
}

/** O que a cena mostra além do diagrama: busca, isolamento e relações escondidas pela legenda. */
export interface IsoFilter {
  /** ids achados pela busca (null = sem busca) */
  match: string[] | null;
  /** com seleção, só ela e os vizinhos até N passos ficam na cena (o resto some); N ≥ 1 */
  isolate: number;
  hiddenRels: string[];
}

/** O que está sob o ponteiro: componente, camada (e o ponto no plano do diagrama) ou nada. */
export interface IsoPick {
  node?: string;
  tier?: string;
  at?: { x: number; y: number };
}

interface Gear {
  objs: THREE.Object3D[];
  mats: THREE.Material[];
  label: CSS2DObject;
  /** material do objeto de cima: brilha (emissive) quando é o passo atual da apresentação */
  glow: THREE.MeshStandardMaterial;
}
interface Link {
  id: string;
  /** marcador da porta (HTML), se a ligação passa por uma: apaga e mostra o nome junto com a ligação */
  port?: HTMLElement;
  /** tubos (contorno, corpo, pulsos), linha raio-x e seta: o desenho progressivo da apresentação mexe em cada um */
  tubes: THREE.Mesh[];
  xray: THREE.Line;
  cone: THREE.Mesh;
  pulses: THREE.Texture;
  from: string;
  to: string;
  rel: string;
  group: THREE.Group;
  mats: THREE.Material[];
  label: CSS2DObject;
}

export class IsoScene {
  private renderer: THREE.WebGLRenderer;
  private labels: CSS2DRenderer;
  private theme: IsoTheme = "dark";
  private hemi: THREE.HemisphereLight;
  private key: THREE.DirectionalLight;
  private signature = "";
  private flows: THREE.Texture[] = [];
  private clock = new THREE.Clock();
  private pulseImage: HTMLCanvasElement | null = null;
  /** rótulos precisam ser reavaliados (câmera mexeu ou a cena mudou) */
  private declutter = true;
  private scene = new THREE.Scene();
  private camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -20000, 20000);
  private controls: OrbitControls;
  private content = new THREE.Group();
  private iconCache = new Map<string, THREE.Texture>();
  private selRing: THREE.Group;
  private hoverRing: THREE.Mesh;
  private hoverAt = 0;
  private nodeAt = new Map<string, { pos: THREE.Vector3; radius: number; top: number }>();
  private gears = new Map<string, Gear>();
  private links: Link[] = [];
  private tiers = new Map<string, THREE.Mesh>();
  /** materiais e nome de cada camada: apagam quando o tipo escolhido na paleta não pode entrar nela */
  private tierParts = new Map<string, { mats: THREE.Material[]; label: CSS2DObject }>();
  /** camadas que aceitam o tipo escolhido na paleta (null = nenhum tipo escolhido) */
  private layerFocus: string[] | null = null;
  /** canais entre as camadas (fundo e lâmina): apagam junto quando um tipo da paleta está escolhido */
  private channelMats: THREE.Material[] = [];
  private adj = new Map<string, Set<string>>();
  private filter: IsoFilter = { match: null, isolate: 1, hiddenRels: [] };
  private hoverId: string | undefined;
  private dropHint: string | null = null;
  /** arrasto de conexão: componente de origem e a linha-guia */
  private linking: { from: string; x: number; y: number; on: boolean; to?: string } | null = null;
  private guide: THREE.Mesh | null = null;
  private fly: { t0: number; target0: THREE.Vector3; target1: THREE.Vector3; pos0: THREE.Vector3; zoom0: number; zoom1: number } | null = null;
  /** entrada da câmera ao abrir a visão: gira e aproxima até a vista isométrica */
  private introAnim: { t0: number; offset: THREE.Vector3; zoom: number } | null = null;
  private pickables: THREE.Object3D[] = [];
  private doc: Doc | null = null;
  private sel: string[] = [];
  private frame = 0;
  private extent = 600;
  /** recursos da cena anterior, descartados depois do primeiro quadro da nova (ver clearContent) */
  private trash: { dispose(): void }[] = [];
  private inset = 0;
  private insetRight = 0;
  /** passo atual da apresentação (null = fora dela) */
  private spot: Spotlight3D | null = null;
  private spotRings = new THREE.Group();
  /** conexões do passo sendo desenhadas do início ao fim */
  private grow: { t0: number; links: Link[] } | null = null;
  /** pulsos que andam mais rápido (conexões do passo atual) */
  private fast = new Set<THREE.Texture>();
  private down: { x: number; y: number } | null = null;
  private ro: ResizeObserver;
  private disposed = false;

  constructor(private host: HTMLElement, private events: IsoEvents) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    this.renderer.toneMapping = THREE.NeutralToneMapping; // preserva o matiz (o ACES desbotava as camadas no tema claro)
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    host.appendChild(this.renderer.domElement);
    this.renderer.domElement.className = "iso3d-canvas";

    this.labels = new CSS2DRenderer();
    this.labels.domElement.className = "iso3d-labels";
    host.appendChild(this.labels.domElement);

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.22;
    this.hemi = new THREE.HemisphereLight(0xdfe6ee, 0x30343c, 0.55);
    this.scene.add(this.hemi);
    this.key = new THREE.DirectionalLight(0xffffff, 1.3);
    this.key.position.set(-0.8, 1.6, 0.9);
    this.scene.add(this.key);
    const rim = new THREE.DirectionalLight(0xffffff, 0.35);
    rim.position.set(1, 0.6, -1);
    this.scene.add(rim);
    this.scene.add(this.content);

    // seleção: anel grosso na cor de destaque do app com um contorno escuro (não depende só da cor da camada embaixo)
    this.selRing = new THREE.Group();
    const ringOuter = new THREE.Mesh(new THREE.TorusGeometry(1, 0.11, 10, 72), new THREE.MeshBasicMaterial({ color: new THREE.Color("#1f2430") }));
    const ringInner = new THREE.Mesh(new THREE.TorusGeometry(1, 0.075, 10, 72), new THREE.MeshBasicMaterial({ color: new THREE.Color("#8b87ff") }));
    ringInner.position.y = 0.02;
    this.selRing.add(ringOuter, ringInner);
    this.selRing.rotation.x = Math.PI / 2;
    this.selRing.visible = false;
    this.scene.add(this.selRing);
    // hover: anel fino e claro sob o equipamento apontado
    this.hoverRing = new THREE.Mesh(new THREE.TorusGeometry(1, 0.045, 8, 64), new THREE.MeshBasicMaterial({ color: new THREE.Color("#ffffff"), transparent: true, opacity: 0.7 }));
    this.hoverRing.rotation.x = Math.PI / 2;
    this.hoverRing.visible = false;
    this.scene.add(this.hoverRing);
    this.scene.add(this.spotRings);


    this.controls = blenderControls(this.camera, this.renderer.domElement);

    const el = this.renderer.domElement;
    // na captura (antes do OrbitControls): começar num componente é arrastar uma conexão, não girar a câmera
    host.addEventListener("pointerdown", this.onDown, true);
    el.addEventListener("pointerup", this.onUp);
    el.addEventListener("pointermove", this.onMove);
    el.addEventListener("pointerleave", () => this.hover(undefined));
    el.addEventListener("contextmenu", (e) => e.preventDefault());
    // sem a rolagem automática do navegador ao apertar o botão do meio
    el.addEventListener("mousedown", (e) => e.button === 1 && e.preventDefault());
    this.controls.addEventListener("change", () => (this.declutter = true));
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(host);
    this.resize();
    const tick = () => {
      if (this.disposed) return;
      this.frame = requestAnimationFrame(tick);
      const dt = Math.min(0.1, this.clock.getDelta());
      // fluxo: os pulsos andam ao longo dos canais e tubos (u cresce do início para o fim)
      for (const t of this.flows) t.offset.x -= (dt * FLOW_SPEED * (this.fast.has(t) ? 2.6 : 1)) / PULSE_TILE;
      if (this.fly) this.stepFly();
      if (this.introAnim) this.stepIntro();
      if (this.spot) this.stepSpot();
      if (this.grow) this.stepGrow();
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
      this.labels.render(this.scene, this.camera);
      if (this.trash.length) this.emptyTrash();
      if (this.declutter) {
        this.declutter = false;
        this.fitLabels();
      }
    };
    tick();
  }

  /* ───────── ciclo de vida ───────── */

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    this.ro.disconnect();
    this.host.removeEventListener("pointerdown", this.onDown, true);
    this.controls.dispose();
    this.clearContent();
    this.emptyTrash();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.labels.domElement.remove();
  }

  private emptyTrash() {
    for (const x of this.trash) x.dispose();
    this.trash = [];
  }

  private resize() {
    const w = Math.max(1, this.host.clientWidth);
    const h = Math.max(1, this.host.clientHeight);
    this.renderer.setSize(w, h);
    this.labels.setSize(w, h);
    const half = this.extent;
    const aspect = w / h;
    this.camera.left = -half * aspect;
    this.camera.right = half * aspect;
    this.camera.top = half;
    this.camera.bottom = -half;
    // painéis por cima da cena (esquerda e direita): o centro da vista vai para o meio do espaço que sobra
    const shift = (this.insetRight - this.inset) / 2;
    if (shift && this.inset + this.insetRight < w) this.camera.setViewOffset(w, h, shift, 0, w, h);
    else this.camera.clearViewOffset();
    this.camera.updateProjectionMatrix();
  }

  /** Largura (px) coberta por painéis na esquerda e na direita; a cena se centra no espaço que sobra. */
  setInset(px: number, right = 0) {
    if (Math.abs(px - this.inset) < 1 && Math.abs(right - this.insetRight) < 1) return;
    this.inset = px;
    this.insetRight = right;
    this.resize();
    this.declutter = true;
  }

  /**
   * Compila os shaders da cena sem travar a página (o navegador compila em paralelo quando pode). Chamado antes de mostrar
   * a cena: sem isso, o primeiro quadro compilava tudo de uma vez.
   */
  async warmup() {
    try {
      await this.renderer.compileAsync(this.scene, this.camera);
    } catch {
      /* sem compilação assíncrona: compila no primeiro quadro, como antes */
    }
  }

  /** Entrada da câmera: começa um pouco girada e afastada e chega na vista isométrica (sem animação se o sistema pedir). */
  intro() {
    if (reducedMotion()) return;
    const offset = this.camera.position.clone().sub(this.controls.target);
    this.introAnim = { t0: performance.now(), offset, zoom: this.camera.zoom };
    this.stepIntro();
  }

  private stepIntro() {
    const a = this.introAnim!;
    const k = Math.min(1, (performance.now() - a.t0) / 900);
    const e = 1 - (1 - k) ** 3;
    const off = a.offset.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), -0.55 * (1 - e));
    this.camera.position.copy(this.controls.target).add(off);
    this.camera.zoom = a.zoom * (0.78 + 0.22 * e);
    this.camera.updateProjectionMatrix();
    this.camera.lookAt(this.controls.target);
    this.declutter = true;
    if (k >= 1) this.introAnim = null;
  }

  /* ───────── interação ───────── */

  /** Gira a câmera em volta do centro (graus, no eixo vertical). */
  orbit(deg: number) {
    const off = this.camera.position.clone().sub(this.controls.target);
    off.applyAxisAngle(new THREE.Vector3(0, 1, 0), THREE.MathUtils.degToRad(deg));
    this.camera.position.copy(this.controls.target).add(off);
    this.camera.lookAt(this.controls.target);
  }

  /** Leva a câmera até o componente (mantém o ângulo de visão e aproxima). */
  flyTo(id: string) {
    const at = this.nodeAt.get(id);
    if (!at) return;
    this.flyToPoint(at.pos.clone().setY(at.top), Math.max(this.camera.zoom, 1.8));
  }

  private flyToPoint(target: THREE.Vector3, zoom: number) {
    this.fly = { t0: performance.now(), target0: this.controls.target.clone(), target1: target, pos0: this.camera.position.clone(), zoom0: this.camera.zoom, zoom1: zoom };
  }

  /** Enquadra um grupo de componentes (centro e zoom para caberem com folga). */
  private frameNodes(ids: string[]) {
    const pts = ids.map((id) => this.nodeAt.get(id)).filter((p): p is NonNullable<typeof p> => !!p);
    if (!pts.length) return;
    const c = pts.reduce((acc, p) => acc.add(p.pos.clone().setY(p.top)), new THREE.Vector3()).divideScalar(pts.length);
    const r = Math.max(...pts.map((p) => Math.hypot(p.pos.x - c.x, p.pos.z - c.z) + p.radius)) + 60;
    // cabe no espaço livre entre os painéis: px por unidade do mundo = altura / (2 × extent) × zoom
    const h = Math.max(1, this.host.clientHeight);
    const free = Math.max(200, Math.min(this.host.clientWidth - this.inset - this.insetRight, h));
    this.flyToPoint(c, THREE.MathUtils.clamp((0.42 * free * 2 * this.extent) / (h * r), 0.4, 2.4));
  }

  /* ───────── apresentação ───────── */

  /**
   * Passo atual do passo a passo (ou null ao sair): destaca, desenha as conexões do passo e leva a câmera até ele.
   */
  setSpotlight(s: Spotlight3D | null) {
    const prev = this.spot;
    this.spot = s;
    this.finishGrow();
    for (const g of this.gears.values()) g.glow.emissive.setRGB(0, 0, 0);
    this.spotRings.clear();
    this.fast.clear();
    if (s) {
      for (const id of s.nodes) {
        const at = this.nodeAt.get(id);
        if (!at || s.extras.includes(id)) continue;
        const ring = new THREE.Mesh(SPOT_RING, new THREE.MeshBasicMaterial({ color: new THREE.Color("#8b87ff"), transparent: true, depthWrite: false }));
        ring.rotation.x = Math.PI / 2;
        ring.position.copy(at.pos).setY(at.pos.y + 2);
        ring.userData.radius = at.radius * 1.15;
        this.spotRings.add(ring);
      }
      const cur = this.links.filter((l) => s.conns.includes(l.id));
      for (const l of cur) this.fast.add(l.pulses);
      if (cur.length && !reducedMotion()) this.grow = { t0: performance.now(), links: cur };
      // só o passo (e os de apoio): nos anéis o passo anterior costuma ficar longe e o enquadramento ficaria pequeno.
      // A entrada da câmera (visão recém-montada) para aqui: senão ela termina por cima do voo até o passo.
      this.introAnim = null;
      this.frameNodes(s.nodes);
    } else if (prev) this.frameNodes([...this.gears.keys()]);
    this.applyFocus();
  }

  /** Brilho pulsante do passo atual e o anel em volta, respirando. */
  private stepSpot() {
    const s = this.spot!;
    const t = this.clock.elapsedTime;
    const pulse = reducedMotion() ? 0.6 : 0.5 + 0.5 * Math.sin(t * 3.6);
    for (const id of s.nodes) {
      if (s.extras.includes(id)) continue;
      const g = this.gears.get(id);
      if (g) g.glow.emissive.copy(g.glow.color).multiplyScalar(0.12 + 0.3 * pulse);
    }
    for (const r of this.spotRings.children as THREE.Mesh[]) {
      r.scale.setScalar(r.userData.radius * (1 + 0.12 * pulse));
      (r.material as THREE.MeshBasicMaterial).opacity = 0.9 - 0.5 * pulse;
    }
  }

  /** As conexões do passo crescem do componente de origem até o destino; a seta aparece no fim. */
  private stepGrow() {
    const g = this.grow!;
    const k = Math.min(1, (performance.now() - g.t0) / 750);
    const e = 1 - (1 - k) ** 2;
    for (const l of g.links) {
      for (const m of l.tubes) m.geometry.setDrawRange(0, Math.floor((m.geometry.index!.count * e) / 3) * 3);
      l.xray.geometry.setDrawRange(0, Math.max(2, Math.ceil(l.xray.geometry.attributes.position.count * e)));
      l.cone.visible = k >= 1;
    }
    if (k >= 1) this.finishGrow();
  }

  private finishGrow() {
    if (!this.grow) return;
    for (const l of this.grow.links) {
      for (const m of l.tubes) m.geometry.setDrawRange(0, Infinity);
      l.xray.geometry.setDrawRange(0, Infinity);
      l.cone.visible = true;
    }
    this.grow = null;
  }

  /** Tipo da paleta escolhido: componentes, ligações e anéis de seleção somem (as camadas mostram onde ele entra). */
  private hideForPlacement() {
    for (const g of this.gears.values()) {
      for (const o of g.objs) o.visible = false;
      g.label.visible = false;
    }
    for (const l of this.links) {
      l.group.visible = false;
      l.label.visible = false;
    }
    this.selRing.visible = false;
    this.hoverRing.visible = false;
    this.declutter = true;
  }

  /** Destaque da apresentação: passo atual inteiro, já vistos meio apagados, o resto quase some (como no 2D). */
  private applySpot(hidden: Set<string>) {
    const s = this.spot!;
    const cur = new Set(s.nodes);
    const extra = new Set(s.extras);
    const seen = new Set(s.seenNodes);
    for (const [id, g] of this.gears) {
      const k = cur.has(id) ? (extra.has(id) ? 0.85 : 1) : seen.has(id) ? 0.5 : 0.07;
      for (const o of g.objs) o.visible = true;
      fade(g.mats, k);
      g.label.visible = k >= 0.5;
      g.label.element.classList.toggle("iso3d-dim", k < 1 && !cur.has(id));
      g.label.element.dataset.sel = cur.has(id) && !extra.has(id) ? "1" : "";
    }
    const conns = new Set(s.conns);
    const seenC = new Set(s.seenConns);
    for (const l of this.links) {
      const on = conns.has(l.id);
      l.group.visible = !hidden.has(l.rel);
      l.label.visible = l.group.visible;
      const k = on ? 1 : seenC.has(l.id) ? 0.45 : 0.05;
      fade(l.mats, k);
      l.label.element.dataset.on = on ? "1" : "";
      markPort(l, k, on);
    }
    this.declutter = true;
  }

  private stepFly() {
    const f = this.fly!;
    const k = Math.min(1, (performance.now() - f.t0) / 450);
    const e = 1 - (1 - k) ** 3;
    const target = f.target0.clone().lerp(f.target1, e);
    this.camera.position.copy(f.pos0).add(target.clone().sub(f.target0));
    this.controls.target.copy(target);
    this.camera.zoom = f.zoom0 + (f.zoom1 - f.zoom0) * e;
    this.camera.updateProjectionMatrix();
    this.declutter = true;
    if (k >= 1) this.fly = null;
  }

  private onDown = (e: PointerEvent) => {
    this.down = { x: e.clientX, y: e.clientY };
    this.introAnim = null; // mexeu na câmera durante a entrada: ela para onde está
    // Ctrl + botão do meio = zoom arrastando (como no Blender); decidido aqui, antes do OrbitControls ler o botão
    this.controls.mouseButtons.MIDDLE = e.button === 1 && (e.ctrlKey || e.metaKey) ? THREE.MOUSE.DOLLY : THREE.MOUSE.ROTATE;
    this.fly = null;
    if (e.button !== 0 || e.target !== this.renderer.domElement) return;
    const h = this.hit(e.clientX, e.clientY);
    if (!h.node) return;
    // num componente: o gesto é de conexão (ou um clique); a câmera fica parada
    this.controls.enabled = false;
    this.linking = { from: h.node, x: e.clientX, y: e.clientY, on: false };
    this.renderer.domElement.setPointerCapture(e.pointerId);
  };

  /** O que está sob o ponteiro: componente, camada ou nada (com o ponto no plano do diagrama). */
  pick(clientX: number, clientY: number): IsoPick {
    return this.hit(clientX, clientY);
  }

  private hit(clientX: number, clientY: number): IsoPick {
    const r = this.renderer.domElement.getBoundingClientRect();
    if (clientX < r.left || clientX > r.right || clientY < r.top || clientY > r.bottom) return {};
    const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    for (const h of ray.intersectObjects(this.pickables, true)) {
      let o: THREE.Object3D | null = h.object;
      if (!visibleUp(o)) continue;
      while (o && !o.userData.nodeId && !o.userData.groupId) o = o.parent;
      const at = { x: h.point.x, y: h.point.z };
      if (o?.userData.nodeId) return { node: o.userData.nodeId, at };
      if (o?.userData.groupId) return { tier: o.userData.groupId, at };
    }
    return {};
  }

  /** Hover: cursor de clique, anel claro sob o componente e as conexões dele acesas; no arrasto de conexão, a linha-guia. */
  private onMove = (e: PointerEvent) => {
    const l = this.linking;
    if (l) {
      if (!l.on && Math.hypot(e.clientX - l.x, e.clientY - l.y) < 5) return;
      l.on = true;
      const h = this.hit(e.clientX, e.clientY);
      l.to = h.node && h.node !== l.from ? h.node : undefined;
      this.drawGuide(l.from, l.to, e.clientX, e.clientY);
      this.hover(l.to);
      this.renderer.domElement.style.cursor = l.to ? "copy" : "crosshair";
      return;
    }
    if (e.buttons) return; // arrastando: a câmera manda
    const now = performance.now();
    if (now - this.hoverAt < 40) return;
    this.hoverAt = now;
    const h = this.hit(e.clientX, e.clientY);
    this.renderer.domElement.style.cursor = h.node ? "pointer" : h.tier ? "cell" : "";
    this.hover(h.node);
  };

  private hover(id: string | undefined) {
    const at = id && !this.sel.includes(id) ? this.nodeAt.get(id) : undefined;
    this.hoverRing.visible = !!at;
    if (at) {
      this.hoverRing.position.copy(at.pos).setY(at.pos.y + 1.5);
      this.hoverRing.scale.setScalar(at.radius);
    }
    if (!id) this.renderer.domElement.style.cursor = "";
    if (id !== this.hoverId) {
      this.hoverId = id;
      this.applyFocus();
    }
  }

  private onUp = (e: PointerEvent) => {
    const d = this.down;
    this.down = null;
    const l = this.linking;
    if (l) {
      this.linking = null;
      this.controls.enabled = true;
      this.clearGuide();
      if (l.on) {
        this.hover(undefined);
        if (l.to) this.events.onConnect(l.from, l.to);
        return;
      }
    }
    if (!d || e.button !== 0 || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 4) return;
    const h = this.hit(e.clientX, e.clientY);
    if (h.node) return this.events.onNode(h.node);
    if (h.tier) return this.events.onTier(h.tier, e.clientX, e.clientY);
    this.events.onEmpty();
  };

  /** Linha-guia do arrasto de conexão: do componente até o ponteiro (ou até o componente de destino). */
  private drawGuide(from: string, to: string | undefined, clientX: number, clientY: number) {
    const a = this.nodeAt.get(from);
    if (!a) return;
    const A = a.pos.clone().setY(a.top + 6);
    let B: THREE.Vector3;
    const b = to ? this.nodeAt.get(to) : undefined;
    if (b) B = b.pos.clone().setY(b.top + 6);
    else {
      // ponteiro no plano horizontal na altura do topo do componente de origem
      const r = this.renderer.domElement.getBoundingClientRect();
      const ray = new THREE.Raycaster();
      ray.setFromCamera(new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1), this.camera);
      B = ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -A.y), new THREE.Vector3()) ?? A.clone();
    }
    this.clearGuide();
    if (A.distanceTo(B) < 2) return;
    const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(b ? "#8b87ff" : THEMES[this.theme].conn), transparent: true, opacity: 0.9, depthTest: false });
    this.guide = new THREE.Mesh(new THREE.TubeGeometry(arcCurve(A, B, 0), 40, 2.4, 6, false), mat);
    this.guide.renderOrder = 10;
    this.scene.add(this.guide);
  }

  private clearGuide() {
    if (!this.guide) return;
    this.guide.geometry.dispose();
    (this.guide.material as THREE.Material).dispose();
    this.scene.remove(this.guide);
    this.guide = null;
  }

  /** Destaque de alvo durante o arrasto da paleta: a camada que vai receber o componente (ou o componente apontado). */
  setDropHint(id: string | null) {
    if (id === this.dropHint) return;
    const prev = this.dropHint ? this.tiers.get(this.dropHint) : undefined;
    if (prev) (prev.userData.top as THREE.MeshStandardMaterial).emissive.setRGB(0, 0, 0);
    this.dropHint = id;
    const tier = id ? this.tiers.get(id) : undefined;
    if (tier) (tier.userData.top as THREE.MeshStandardMaterial).emissive.copy(new THREE.Color(tier.userData.color)).multiplyScalar(0.45);
    this.hover(id && this.nodeAt.has(id) ? id : undefined);
  }

  /**
   * Tipo escolhido na paleta: as camadas que não aceitam aquele tipo ficam translúcidas (com o nome apagado); as que
   * aceitam ficam inteiras. null volta tudo ao normal.
   */
  setLayerFocus(allowed: string[] | null) {
    this.layerFocus = allowed;
    const ok = allowed ? new Set(allowed) : null;
    for (const [id, part] of this.tierParts) {
      const on = !ok || ok.has(id);
      fade(part.mats, on ? 1 : 0.18);
      part.label.element.classList.toggle("iso3d-dim", !on);
    }
    // os canais entre as camadas nunca recebem componentes: com um tipo escolhido, somem junto com as camadas apagadas
    fade(this.channelMats, ok ? 0.12 : 1);
    // componentes e ligações saem de cena (applyFocus): só as camadas importam para escolher onde o tipo entra; ao
    // cancelar, a seleção (e o anel dela) volta como estava
    if (ok) this.applyFocus();
    else this.setSelection(this.sel);
  }

  setSelection(sel: string[]) {
    this.sel = sel;
    // pelos objetos, não pelo DOM: um rótulo recém-criado só entra no DOM no próximo quadro
    for (const [id, g] of this.gears) g.label.element.dataset.sel = sel.includes(id) ? "1" : "";
    this.declutter = true;
    const hit = sel.map((id) => this.nodeAt.get(id)).find(Boolean);
    this.selRing.visible = !!hit;
    if (hit) {
      this.selRing.position.copy(hit.pos).setY(hit.pos.y + 2);
      this.selRing.scale.setScalar(hit.radius);
    }
    this.applyFocus();
  }

  setFilter(f: IsoFilter) {
    this.filter = f;
    this.applyFocus();
  }

  /** Componentes a até `depth` passos dos de `from` (conexões nos dois sentidos, só as relações visíveis). */
  private reach(from: string[], depth: number) {
    const out = new Set(from);
    let edge = [...from];
    for (let i = 0; i < depth; i++) {
      const next: string[] = [];
      for (const id of edge) for (const n of this.adj.get(id) ?? []) if (!out.has(n)) (out.add(n), next.push(n));
      edge = next;
    }
    return out;
  }

  /**
   * Aplica foco, busca, isolamento e filtro de relações: o que fica normal, apagado (transparente) ou escondido. As
   * conexões do componente apontado (ou selecionado) acendem com o nome da relação; as outras apagam.
   */
  private applyFocus() {
    const hidden = new Set(this.filter.hiddenRels);
    this.adj.clear();
    for (const l of this.links) {
      if (hidden.has(l.rel)) continue;
      if (!this.adj.has(l.from)) this.adj.set(l.from, new Set());
      if (!this.adj.has(l.to)) this.adj.set(l.to, new Set());
      this.adj.get(l.from)!.add(l.to);
      this.adj.get(l.to)!.add(l.from);
    }
    if (this.layerFocus) return this.hideForPlacement();
    if (this.spot) return this.applySpot(hidden);
    const sel = this.sel.filter((id) => this.gears.has(id));
    const anchor = this.hoverId && this.gears.has(this.hoverId) ? [this.hoverId, ...sel] : sel;
    // selecionar isola: o que não está ligado à seleção some (componentes, conexões e rótulos)
    const shown = sel.length ? this.reach(sel, Math.max(1, this.filter.isolate)) : null;
    const match = this.filter.match ? new Set(this.filter.match) : null;
    // acesos: os vizinhos do foco e os achados da busca (os dois juntos, quando há busca e seleção)
    const near = anchor.length ? this.reach(anchor, 1) : null;
    const lit = match && near ? new Set([...match, ...near]) : (match ?? near);
    for (const [id, g] of this.gears) {
      const visible = !shown || shown.has(id);
      for (const o of g.objs) o.visible = visible;
      g.label.visible = visible;
      const dim = visible && !!lit && !lit.has(id);
      fade(g.mats, dim ? 0.16 : 1);
      g.label.element.classList.toggle("iso3d-dim", dim);
    }
    for (const l of this.links) {
      const visible = !hidden.has(l.rel) && (!shown || (shown.has(l.from) && shown.has(l.to)));
      l.group.visible = visible;
      l.label.visible = visible;
      const on = anchor.length ? anchor.includes(l.from) || anchor.includes(l.to) : !!match && match.has(l.from) && match.has(l.to);
      const dim = (anchor.length > 0 || !!match) && !on;
      fade(l.mats, dim ? 0.1 : 1);
      l.label.element.dataset.on = visible && (on || !!shown) ? "1" : "";
      markPort(l, dim ? 0.1 : 1, visible && (on || !!shown));
    }
    this.declutter = true;
  }

  /* ───────── cena ───────── */

  /** Reconstrói a cena só quando o que aparece nela muda (a sincronização troca o documento sem mudar o desenho). */
  setDoc(doc: Doc) {
    const first = !this.doc;
    this.doc = doc;
    const sig = JSON.stringify([
      doc.groups.map((g) => [g.id, g.x, g.y, g.w, g.h, g.parent, g.label, g.color, g.ring]),
      doc.nodes.map((n) => [n.id, n.x, n.y, n.w, n.h, n.parent, n.owner, n.label, n.kind, n.ddd?.role]),
      doc.connections.map((c) => [c.id, c.from, c.to, c.label, c.type, c.ddd?.rel, c.port?.name]),
    ]);
    if (!first && sig === this.signature) return;
    this.signature = sig;
    this.build(doc, first);
  }

  /** Tema claro ou escuro: luzes e cores da cena (o fundo e os rótulos vêm do CSS). */
  setTheme(theme: IsoTheme) {
    if (theme === this.theme) return;
    this.theme = theme;
    const t = THEMES[theme];
    this.hemi.intensity = t.hemi;
    this.key.intensity = t.key;
    if (this.doc) this.build(this.doc, false);
  }

  /**
   * Tira a cena atual. Geometrias, materiais e texturas só são descartados depois que a cena nova é desenhada: descartar
   * antes zera o uso dos shaders, o three os destrói e a cena nova recompila tudo (um engasgo a cada mudança).
   */
  private clearContent() {
    this.content.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry && !m.userData.sharedGeometry) this.trash.push(m.geometry);
      if (m.material && m.material !== PROXY_MAT) this.trash.push(...(Array.isArray(m.material) ? m.material : [m.material]));
      if (o instanceof CSS2DObject) o.element.remove();
    });
    this.content.clear();
    this.trash.push(...this.flows);
    this.flows = [];
    this.pickables = [];
    this.nodeAt.clear();
    this.gears.clear();
    this.links = [];
    this.tiers.clear();
    this.tierParts.clear();
    this.channelMats = [];
    this.dropHint = null;
  }

  private build(doc: Doc, frame: boolean) {
    this.clearContent();
    const groups = new Map(doc.groups.map((g) => [g.id, g]));
    const topCache = new Map<string, number>();
    const zBase = (g: GroupEl | undefined): number => {
      if (!g?.parent) return 0;
      const p = groups.get(g.parent);
      if (!p) return 0;
      // anel com setores: a moldura não tem altura; os setores dela formam o degrau e o que está dentro (o anel de
      // dentro, ou um contexto) fica em cima desse degrau
      if (p.ring?.frame) return g.ring?.layer === p.ring.layer ? zBase(p) : zBase(p) + STEP;
      return zTop(p);
    };
    const zTop = (g: GroupEl): number => {
      if (topCache.has(g.id)) return topCache.get(g.id)!;
      const z = zBase(g) + (g.ring && !g.ring.frame ? STEP : 0);
      topCache.set(g.id, z);
      return z;
    };
    const nodes = doc.nodes.filter((n) => !n.owner && n.kind !== "endpoint");
    const nodeZ = (n: NodeEl) => (n.parent && groups.get(n.parent) ? zTop(groups.get(n.parent)!) : 0);

    // centro e tamanho da cena
    const all = [...doc.groups, ...nodes];
    const minX = Math.min(0, ...all.map((e) => e.x));
    const minY = Math.min(0, ...all.map((e) => e.y));
    const maxX = Math.max(0, ...all.map((e) => e.x + e.w));
    const maxY = Math.max(0, ...all.map((e) => e.y + e.h));
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const radius = Math.max(300, Math.hypot(maxX - minX, maxY - minY) / 2);

    // círculos de camadas: anéis com o mesmo centro, agrupados pelo raio (setores de uma camada têm o mesmo raio)
    const onions: Onion[] = [];
    const rings = doc.groups.filter((g) => g.ring && !g.ring.frame);
    for (const g of rings) {
      const ccx = g.x + g.w / 2;
      const ccy = g.y + g.h / 2;
      let o = onions.find((x) => Math.abs(x.cx - ccx) < 1 && Math.abs(x.cy - ccy) < 1);
      if (!o) onions.push((o = { cx: ccx, cy: ccy, layers: [], channels: [] }));
      const R = Math.min(g.w, g.h) / 2;
      if (!o.layers.some((l) => Math.abs(l.R - R) < 1)) o.layers.push({ R, ri: g.ring!.inner, top: zTop(g) });
    }
    const carve = new Map<string, number>();
    for (const o of onions) {
      o.layers.sort((a, b) => a.R - b.R);
      o.layers.forEach((l, k) => {
        if (k === 0 || l.top - DEPTH < 4) return;
        // o canal entra CARVE px no degrau de fora; o fundo fica DEPTH abaixo do tampo dele
        o.channels[k] = { rIn: o.layers[k - 1].R, rOut: l.ri + CARVE, floor: l.top - DEPTH };
      });
    }
    for (const g of rings) {
      const R = Math.min(g.w, g.h) / 2;
      const o = onions.find((x) => Math.abs(x.cx - (g.x + g.w / 2)) < 1 && Math.abs(x.cy - (g.y + g.h / 2)) < 1)!;
      const k = o.layers.findIndex((l) => Math.abs(l.R - R) < 1);
      if (o.channels[k]) carve.set(g.id, g.ring!.inner + CARVE);
    }

    for (const g of doc.groups) {
      if (g.ring && !g.ring.frame) this.addTier(g, zBase(g), zTop(g), carve.get(g.id));
      else if (!g.ring) this.addContext(g, zTop(g));
    }
    for (const o of onions) o.channels.forEach((c) => c && this.addChannel(o, c));
    // cor do terreno: a da camada (anel ou setor) onde o componente está
    for (const n of nodes) this.addGear(n, nodeZ(n), n.parent ? groups.get(n.parent)?.color : undefined);
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const conns = doc.connections.filter((c) => byId.has(c.from) && byId.has(c.to) && c.from !== c.to);
    // pares com mais de uma conexão (nos dois sentidos): os arcos se abrem para os lados em vez de se sobrepor
    const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
    const pairs = new Map<string, number>();
    for (const c of conns) pairs.set(pairKey(c.from, c.to), (pairs.get(pairKey(c.from, c.to)) ?? 0) + 1);
    const seen = new Map<string, number>();
    const bad = new Set(layerViolations(doc).map((v) => v.conn));
    for (const c of conns) {
      const key = pairKey(c.from, c.to);
      const i = seen.get(key) ?? 0;
      seen.set(key, i + 1);
      // o lado é medido no sentido a→b ordenado, para A→B e B→A não caírem no mesmo arco
      const side = (i - ((pairs.get(key) ?? 1) - 1) / 2) * 34 * (c.from < c.to ? 1 : -1);
      const rel = c.ddd?.rel ?? "other";
      const auto = c.ddd ? dddConnLabel(c.ddd) : undefined;
      const own = c.label?.trim() && c.label.trim() !== auto ? c.label.trim() : undefined;
      // porta: marcada onde a ligação sai da camada da origem (a borda do anel ou setor em que ela está)
      const home = c.port ? groups.get(byId.get(c.from)!.parent ?? "") : undefined;
      const port = c.port ? { name: c.port.name, ring: home?.ring ? { cx: home.x + home.w / 2, cy: home.y + home.h / 2, R: Math.min(home.w, home.h) / 2 } : undefined } : undefined;
      this.addConnector(c.id, c.from, c.to, rel, own, side, bad.has(c.id), port);
    }
    this.setSelection(this.sel);
    // a cena foi refeita durante a apresentação: refaz o destaque do passo (anéis e conexões são da cena nova)
    if (this.spot) this.setSpotlight(this.spot);
    if (this.layerFocus) this.setLayerFocus(this.layerFocus);
    this.declutter = true;

    if (frame) {
      // vista inicial: isométrica (45° em volta, ~35° acima do plano), enquadrando o diagrama inteiro
      this.extent = radius * 0.78;
      this.controls.target.set(cx, STEP * 2, cy);
      const dist = radius * 3;
      const el = THREE.MathUtils.degToRad(35);
      this.camera.position.set(cx + dist * Math.cos(el) * Math.SQRT1_2, STEP * 2 + dist * Math.sin(el), cy + dist * Math.cos(el) * Math.SQRT1_2);
      this.camera.zoom = 1;
      this.camera.lookAt(this.controls.target);
      this.resize();
    }
  }

  /** Anel (ou setor) extrudado do chão até a altura do degrau, com a borda de cima acesa. */
  private addTier(g: GroupEl, base: number, top: number, innerOverride?: number) {
    const ring = { ...g.ring!, inner: innerOverride ?? g.ring!.inner };
    const color = new THREE.Color(g.color ?? "#888");
    const ccx = g.x + g.w / 2;
    const ccy = g.y + g.h / 2;
    const R = Math.min(g.w, g.h) / 2;
    const full = ring.start === undefined || ring.end === undefined;
    const start = ring.start ?? 0;
    const end = ring.end ?? 360;
    const steps = Math.max(24, Math.ceil(((end - start) / 360) * 160));
    const arcPts = (r: number, a: number, b: number) => Array.from({ length: steps + 1 }, (_, i) => polar(ccx, ccy, r, a + ((b - a) * i) / steps));
    // forma no plano XY com y invertido; girada −90° em X, a extrusão sobe no Y do mundo e o y do diagrama vira z
    const v2 = (p: { x: number; y: number }) => new THREE.Vector2(p.x, -p.y);
    let shape: THREE.Shape;
    if (full) {
      shape = new THREE.Shape(arcPts(R, 0, 360).slice(0, -1).map(v2));
      if (ring.inner > 0) shape.holes.push(new THREE.Path(arcPts(ring.inner, 0, 360).slice(0, -1).reverse().map(v2)));
    } else {
      const outer = arcPts(R, start, end);
      const inner = ring.inner > 0 ? arcPts(ring.inner, start, end).reverse() : [{ x: ccx, y: ccy }];
      shape = new THREE.Shape([...outer, ...inner].map(v2));
    }
    const height = Math.max(4, top);
    const geo = new THREE.ExtrudeGeometry(shape, { depth: height, bevelEnabled: true, bevelThickness: 2, bevelSize: 2, bevelSegments: 2, curveSegments: 4 });
    geo.rotateX(-Math.PI / 2);
    const t = THEMES[this.theme];
    const tone = mixSRGB(t.tierBase, color, t.tierMix);
    // tampo na cor da camada e paredes mais escuras: o desnível entre uma camada e a de fora fica evidente
    const topMat = new THREE.MeshStandardMaterial({ color: tone, metalness: 0.05, roughness: 0.75 });
    const wallMat = new THREE.MeshStandardMaterial({ color: tone.clone().multiplyScalar(this.theme === "dark" ? 0.62 : 0.72), metalness: 0.05, roughness: 0.85 });
    // grupos do ExtrudeGeometry: 0 = tampas (em cima e embaixo), 1 = paredes e chanfro
    const mesh = new THREE.Mesh(geo, [topMat, wallMat]);
    mesh.userData.top = topMat;
    mesh.userData.groupId = g.id;
    mesh.userData.color = g.color ?? "#888";
    this.content.add(mesh);
    this.pickables.push(mesh);
    this.tiers.set(g.id, mesh);

    // contorno da borda de cima, na cor da camada (linha fina, sem brilho)
    const edge = arcPts(R + 0.5, full ? 0 : start, full ? 360 : end).map((p) => new THREE.Vector3(p.x, height + 2.2, p.y));
    const edgeMat = new THREE.LineBasicMaterial({ color: color.clone().multiplyScalar(0.75) });
    this.content.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(edge), edgeMat));
    const mats: THREE.Material[] = [topMat, wallMat, edgeMat];
    // órbitas (trilhas tracejadas no tampo)
    for (const o of full ? ring.orbits ?? [] : []) {
      const pts = arcPts(o, 0, 360).map((p) => new THREE.Vector3(p.x, height + 2.5, p.y));
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineDashedMaterial({ color, dashSize: 6, gapSize: 12, transparent: true, opacity: 0.45 }));
      line.computeLineDistances();
      this.content.add(line);
      mats.push(line.material);
    }
    // nome da camada, na borda (frente do anel inteiro; meio do setor)
    const at = polar(ccx, ccy, R - 26, full ? 180 : (start + end) / 2);
    const label = this.label(`<span class="iso3d-tier" style="--c:${g.color}">${esc(g.label.toUpperCase())}</span>`, new THREE.Vector3(at.x, height + 4, at.y));
    this.tierParts.set(g.id, { mats, label });
    void base;
  }

  /** Contexto: placa fina com borda tracejada e o nome. */
  private addContext(g: GroupEl, z: number) {
    const geo = new THREE.BoxGeometry(g.w, 3, g.h);
    const mat = new THREE.MeshStandardMaterial({ color: new THREE.Color(THEMES[this.theme].tierBase), metalness: 0.05, roughness: 0.8, transparent: true, opacity: 0.85 });
    const m = new THREE.Mesh(geo, mat);
    m.position.set(g.x + g.w / 2, z + 1.5, g.y + g.h / 2);
    this.content.add(m);
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: new THREE.Color(THEMES[this.theme].context), transparent: true, opacity: 0.7 }));
    edges.position.copy(m.position);
    this.content.add(edges);
    this.label(`<span class="iso3d-context" style="--c:${THEMES[this.theme].context}">${esc(g.label.toUpperCase())}</span>`, new THREE.Vector3(g.x + 30, z + 6, g.y + 30), "left");
  }

  /**
   * Componente: base em bloco (grafite neutro, baseColor) e um objeto de triângulos com a silhueta do papel (isogear.ts), na cor
   * da camada em que está (o papel se lê pela forma e pelo ícone); nome embaixo.
   */
  private addGear(n: NodeEl, z: number, terrain: string | undefined) {
    const look = orbitLook(n);
    const role = roleOf(n);
    const cx = n.x + n.w / 2;
    const cy = n.y + n.h / 2;
    const shape = gearShape(role);
    const t = THEMES[this.theme];
    const ground = new THREE.Color(terrain ?? look.color);
    // a escultura destaca do terreno da mesma cor: viva no escuro (o terreno é apagado), mais clara no claro
    const tone = this.theme === "dark" ? ground.clone() : mixSRGB(ground, "#ffffff", 0.38);
    // chapado e fosco: o mosaico de tons vem das cores de cada triângulo (vertexColors) sobre a cor do material
    const material = (c: THREE.Color) => new THREE.MeshStandardMaterial({ color: c, vertexColors: true, flatShading: true, roughness: 0.82, metalness: 0 });
    // base em grafite neutro (contrasta com qualquer camada); só o objeto de cima leva a cor do terreno
    const baseMat = material(baseColor(this.theme, look.color));
    const sculptMat = material(tone);
    const obj = new THREE.Group();
    for (const [geo, mat] of [[shape.base, baseMat], [shape.sculpt, sculptMat]] as const) {
      const mesh = new THREE.Mesh(geo, mat);
      mesh.userData.sharedGeometry = true; // geometria de cache (isogear.ts), compartilhada entre componentes do mesmo papel
      obj.add(mesh);
    }
    const mats: THREE.Material[] = [baseMat, sculptMat];
    obj.scale.setScalar(UNIT);
    obj.position.set(cx, z, cy);
    this.content.add(obj);

    const box = new THREE.Box3().setFromObject(obj);
    const top = box.max.y;
    const footprint = Math.max(box.max.x - box.min.x, box.max.z - box.min.z);
    this.nodeAt.set(n.id, { pos: new THREE.Vector3(cx, z, cy), radius: footprint * 0.62, top });
    // clique e arraste testam uma caixa invisível, não a escultura
    const size = box.getSize(new THREE.Vector3());
    const proxy = new THREE.Mesh(new THREE.BoxGeometry(size.x, size.y, size.z), PROXY_MAT);
    proxy.position.copy(box.getCenter(new THREE.Vector3()));
    proxy.userData.nodeId = n.id;
    this.content.add(proxy);
    this.pickables.push(proxy);
    const objs: THREE.Object3D[] = [obj, proxy];
    if (ICONS[role]) {
      const s = shape.icon.size * UNIT;
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(s, s), new THREE.MeshBasicMaterial({ map: this.iconTexture(role, this.theme === "dark" ? "#e6e9ef" : "#1f2430"), transparent: true, depthWrite: false }));
      plane.rotation.x = -Math.PI / 2;
      plane.position.set(cx + shape.icon.x * UNIT, z + BASE_H * UNIT + 0.8, cy + shape.icon.z * UNIT);
      this.content.add(plane);
      objs.push(plane);
      mats.push(plane.material);
    }
    const name = wrapLabel(n.label.toUpperCase(), 20, 2).map((l) => esc(truncate(l, 24))).join("<br>");
    const label = this.label(`<span class="iso3d-name">${name}<small>(${esc(look.role.toUpperCase())})</small></span>`, new THREE.Vector3(cx, z, cy + footprint * 0.5 + 6), "top", n.id);
    this.gears.set(n.id, { objs, mats, label, glow: sculptMat });
  }

  /**
   * Conector: arco 3D do topo de um equipamento ao topo do outro, na cor da relação. Contorno (halo) para destacar do
   * terreno, pulsos andando no sentido da conexão, seta no destino e uma cópia fraca "raio-x" por cima de tudo, para o
   * trecho escondido atrás das camadas continuar legível. O rótulo (relação ou texto próprio) só aparece com foco.
   */
  private addConnector(id: string, from: string, to: string, rel: string, own: string | undefined, side: number, bad: boolean, port?: { name: string; ring?: { cx: number; cy: number; R: number } }) {
    const pa = this.nodeAt.get(from);
    const pb = this.nodeAt.get(to);
    if (!pa || !pb) return;
    // fere a regra de camadas: vermelha e com o aviso sempre à vista
    const style = bad ? VIOLATION_STYLE : (REL_STYLE[rel] ?? REL_STYLE.other);
    const color = new THREE.Color(style.color);
    const A = pa.pos.clone().setY(pa.top + 4);
    const B = pb.pos.clone().setY(pb.top + 4);
    const curve = arcCurve(A, B, side);
    // a ponta para antes do equipamento, onde fica a seta
    // o tubo termina na base da seta (20 px antes do fim, medidos ao longo do arco) com 2 px de sobreposição: cortar por
    // fração do arco deixava um buraco entre o tubo e a seta nas ligações longas
    const total = curve.getLength();
    const uEnd = Math.max(0.5, 1 - (ARROW_LEN - 2) / total);
    const body = new THREE.CatmullRomCurve3(Array.from({ length: 73 }, (_, i) => curve.getPointAt((uEnd * i) / 72)));
    const len = body.getLength();
    const segs = THREE.MathUtils.clamp(Math.ceil(len / 22), 16, 56);
    const g = new THREE.Group();
    const mats: THREE.Material[] = [];
    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, order = 0) => {
      const m = new THREE.Mesh(geo, mat);
      m.renderOrder = order;
      g.add(m);
      mats.push(mat);
      return m;
    };
    const halo = this.theme === "dark" ? "#0b0d11" : "#ffffff";
    const pulses = this.pulseTexture(len / PULSE_TILE);
    const tubes = [
      add(new THREE.TubeGeometry(body, segs, 3.6, 6, false), new THREE.MeshBasicMaterial({ color: new THREE.Color(halo), side: THREE.BackSide })),
      add(new THREE.TubeGeometry(body, segs, 2.3, 6, false), new THREE.MeshStandardMaterial({ color, emissive: color.clone().multiplyScalar(0.45), metalness: 0.1, roughness: 0.45 })),
      add(new THREE.TubeGeometry(body, segs, 2.6, 6, false), new THREE.MeshBasicMaterial({ color: new THREE.Color(THEMES[this.theme].pulse), map: pulses, transparent: true, opacity: this.theme === "dark" ? 0.75 : 0.45, depthWrite: false }), 1),
    ];
    // raio-x: uma linha simples (poucos vértices) por cima de tudo
    const xray = new THREE.Line(new THREE.BufferGeometry().setFromPoints(body.getPoints(segs)), new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.45, depthTest: false, depthWrite: false }));
    xray.renderOrder = 5;
    g.add(xray);
    mats.push(xray.material);
    // seta: base no fim do tubo, ponta no fim da curva, na direção do arco nesse trecho
    const arrowBase = curve.getPointAt(Math.max(0.5, 1 - ARROW_LEN / total));
    const tip = curve.getPoint(1);
    const dir = tip.clone().sub(arrowBase).normalize();
    const cone = add(new THREE.ConeGeometry(7.5, ARROW_LEN, 10), new THREE.MeshStandardMaterial({ color, emissive: color.clone().multiplyScalar(0.45), metalness: 0.1, roughness: 0.45 }));
    cone.position.copy(arrowBase).addScaledVector(dir, ARROW_LEN / 2);
    cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    let portMark: CSS2DObject | undefined;
    if (port) {
      // porta (inversão de dependência): marcada sobre a ligação no ponto em que ela deixa a camada da origem
      let t = 0.3;
      if (port.ring) {
        const r = port.ring;
        for (let k = 1; k <= 60; k++) {
          const p = curve.getPoint(k / 60);
          if (Math.hypot(p.x - r.cx, p.z - r.cy) > r.R) {
            t = k / 60;
            break;
          }
        }
      }
      // o marcador é HTML (sempre de frente para a tela, nítido em qualquer ângulo): o símbolo de interface da UML, igual
      // ao do 2D; o nome aparece ao lado quando a ligação está em foco. Fica dentro do grupo da ligação: some com ela
      const el = document.createElement("div");
      el.className = "iso3d-port";
      el.style.setProperty("--c", style.color);
      el.innerHTML = `<i></i><b>${esc(port.name)}</b>`;
      portMark = new CSS2DObject(el);
      portMark.position.copy(curve.getPoint(t));
      g.add(portMark);
    }
    this.content.add(g);
    const base = bad ? `⚠ ${VIOLATION_STYLE.label}` : (own ?? style.label);
    const label = this.label(`<span class="iso3d-edge" style="--c:${style.color}">${esc(truncate(base, 32))}</span>`, curve.getPoint(0.5).add(new THREE.Vector3(0, 8, 0)));
    label.element.dataset.conn = "1";
    if (bad) label.element.dataset.bad = "1";
    this.links.push({ id, from, to, rel, group: g, mats, label, tubes, xray, cone, pulses, port: portMark?.element });
  }
  /** Rótulos pelo zoom e sem sobreposição (declutterLabels). */
  private fitLabels() {
    declutterLabels(this.labels.domElement, this.camera.zoom);
  }

  /** Canal no pé do degrau: fundo rebaixado e uma lâmina de fluido em volta do anel. */
  private addChannel(o: Onion, c: { rIn: number; rOut: number; floor: number }) {
    const t = THEMES[this.theme];
    const circle = (r: number) => Array.from({ length: 160 }, (_, i) => polar(o.cx, o.cy, r, (360 * i) / 160)).map((p) => new THREE.Vector2(p.x, -p.y));
    const shape = new THREE.Shape(circle(c.rOut));
    shape.holes.push(new THREE.Path(circle(c.rIn).reverse()));
    const geo = new THREE.ExtrudeGeometry(shape, { depth: c.floor, bevelEnabled: false, curveSegments: 4 });
    geo.rotateX(-Math.PI / 2);
    const floor = new THREE.MeshStandardMaterial({ color: new THREE.Color(t.channel), metalness: 0.1, roughness: 0.9 });
    this.content.add(new THREE.Mesh(geo, floor));
    // lâmina de fluido (uma fita em volta do anel; u acompanha a circunferência, para os pulsos andarem em volta)
    const r1 = c.rIn + 3;
    const r2 = c.rOut - 3;
    const n = 200;
    const pos: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];
    const len = 2 * Math.PI * ((r1 + r2) / 2);
    for (let i = 0; i <= n; i++) {
      const a = (360 * i) / n;
      for (const [r, v] of [[r1, 0], [r2, 1]] as const) {
        const p = polar(o.cx, o.cy, r, a);
        pos.push(p.x, c.floor + 0.6, p.y);
        uv.push(((i / n) * len) / PULSE_TILE, v);
      }
      if (i < n) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
    }
    const ribbon = new THREE.BufferGeometry();
    ribbon.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    ribbon.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    ribbon.setIndex(idx);
    // lâmina parada: o que anda na cena são só as conexões (antes os pulsos no canal pareciam mais conectores)
    const fluid = new THREE.MeshStandardMaterial({ color: new THREE.Color(t.fluid), metalness: 0.2, roughness: 0.25, side: THREE.DoubleSide });
    this.content.add(new THREE.Mesh(ribbon, fluid));
    this.channelMats.push(floor, fluid);
  }

  /** Padrão de pulsos (traços que andam), repetido `repeat` vezes ao longo do comprimento. */
  private pulseTexture(repeat: number) {
    if (!this.pulseImage) {
      const c = document.createElement("canvas");
      c.width = 64;
      c.height = 8;
      const g = c.getContext("2d")!;
      const grad = g.createLinearGradient(0, 0, 64, 0);
      grad.addColorStop(0, "rgba(255,255,255,0)");
      grad.addColorStop(0.18, "rgba(255,255,255,1)");
      grad.addColorStop(0.32, "rgba(255,255,255,0)");
      grad.addColorStop(1, "rgba(255,255,255,0)");
      g.fillStyle = grad;
      g.fillRect(0, 0, 64, 8);
      this.pulseImage = c;
    }
    const t = new THREE.CanvasTexture(this.pulseImage);
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(Math.max(1, repeat), 1);
    this.flows.push(t);
    return t;
  }

  private label(html: string, at: THREE.Vector3, anchor: "center" | "top" | "left" = "center", node?: string) {
    const el = document.createElement("div");
    el.className = `iso3d-label iso3d-${anchor}`;
    if (node) el.dataset.node = node;
    el.innerHTML = html;
    const o = new CSS2DObject(el);
    o.position.copy(at);
    this.content.add(o);
    return o;
  }

  private iconTexture(role: string, color: string) {
    const key = `${role}|${color}`;
    const hit = this.iconCache.get(key);
    if (hit) return hit;
    const c = document.createElement("canvas");
    c.width = c.height = 128;
    const g = c.getContext("2d")!;
    g.scale(128 / 24, 128 / 24);
    g.strokeStyle = color;
    g.lineWidth = 1.8;
    g.lineCap = "round";
    g.lineJoin = "round";
    g.stroke(new Path2D(ICONS[role]));
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    this.iconCache.set(key, t);
    return t;
  }
}

/**
 * Câmera ortográfica com navegação estilo Blender: botão do meio orbita, Shift + meio move (o OrbitControls troca para
 * pan com Shift), Ctrl + meio dá zoom (decidido no pointerdown de quem usa); a roda dá zoom na direção do cursor.
 * Esquerdo no fundo também orbita (touchpad) e o direito move.
 */
export function blenderControls(camera: THREE.OrthographicCamera, el: HTMLElement) {
  const c = new OrbitControls(camera, el);
  c.enableDamping = true;
  c.dampingFactor = 0.08;
  c.screenSpacePanning = true;
  c.minPolarAngle = 0.12;
  c.maxPolarAngle = 1.48;
  c.minZoom = 0.15;
  c.maxZoom = 6;
  // navegação estilo Blender: botão do meio orbita, Shift + meio move (o OrbitControls troca para pan com Shift),
  // Ctrl + meio dá zoom (onDown); a roda dá zoom na direção do cursor. Esquerdo no fundo também orbita (touchpad) e o
  // direito move.
  c.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.ROTATE, RIGHT: THREE.MOUSE.PAN };
  c.zoomToCursor = true;
  return c;
}

/**
 * Rótulos pela proximidade: o tamanho acompanha o zoom (de longe, menores; de perto, normais) e, de longe, saem o papel
 * entre parênteses e os rótulos das conexões. Depois, os que se encostam na tela são escondidos, mantendo os de maior
 * prioridade: o componente selecionado, os nomes dos componentes, as conexões em foco e, por fim, os nomes das camadas
 * (os maiores primeiro).
 */
export function declutterLabels(root: HTMLElement, zoom: number) {
  const scale = THREE.MathUtils.clamp(0.55 + (zoom - 1) * 0.5, 0.5, 1.25);
  root.style.setProperty("--iso-ls", scale.toFixed(3));
  root.classList.toggle("iso3d-far", scale < 0.72);
  const items = [...root.querySelectorAll<HTMLElement>(".iso3d-label")];
  for (const el of items) el.classList.remove("iso3d-hidden");
  // o nome do componente vence: o da camada (que a cor do anel e os outros setores já indicam) só aparece onde sobra
  // espaço; apagados por último, para um nome fora do foco não esconder o de um vizinho aceso
  const rank = (el: HTMLElement) => (el.dataset.sel === "1" ? 0 : el.classList.contains("iso3d-dim") ? 5 : el.querySelector(".iso3d-name") ? 1 : el.dataset.on === "1" ? 2 : el.querySelector(".iso3d-tier") ? 3 : 4);
  const boxes = items
    .filter((el) => el.offsetParent !== null && getComputedStyle(el.firstElementChild as Element).display !== "none")
    .map((el) => ({ el, r: (el.firstElementChild as HTMLElement).getBoundingClientRect(), k: rank(el) }))
    .filter((x) => x.r.width > 0)
    .sort((a, b) => a.k - b.k || b.r.width * b.r.height - a.r.width * a.r.height);
  const kept: DOMRect[] = [];
  const pad = 3;
  const hits = (r: DOMRect) => kept.some((k) => r.left < k.right + pad && r.right > k.left - pad && r.top < k.bottom + pad && r.bottom > k.top - pad);
  for (const x of boxes) {
    x.el.classList.remove("iso3d-alt");
    if (!hits(x.r)) {
      kept.push(x.r);
      continue;
    }
    // nome de componente encostando em outro: tenta acima do componente antes de esconder
    if (x.el.querySelector(".iso3d-name")) {
      x.el.classList.add("iso3d-alt");
      const r = (x.el.firstElementChild as HTMLElement).getBoundingClientRect();
      if (!hits(r)) {
        kept.push(r);
        continue;
      }
      x.el.classList.remove("iso3d-alt");
    }
    x.el.classList.add("iso3d-hidden");
  }
}

/** Mistura duas cores no espaço sRGB (como o olho e o CSS), não no linear. */
export function mixSRGB(a: string | THREE.Color, b: string | THREE.Color, k: number) {
  const ca = new THREE.Color(a).getRGB({ r: 0, g: 0, b: 0 }, THREE.SRGBColorSpace);
  const cb = new THREE.Color(b).getRGB({ r: 0, g: 0, b: 0 }, THREE.SRGBColorSpace);
  return new THREE.Color().setRGB(ca.r + (cb.r - ca.r) * k, ca.g + (cb.g - ca.g) * k, ca.b + (cb.b - ca.b) * k, THREE.SRGBColorSpace);
}


/** Marcador da porta acompanha a ligação: a mesma opacidade e, com a ligação em foco, o nome da interface ao lado. */
function markPort(l: Link, k: number, on: boolean) {
  if (!l.port) return;
  l.port.style.opacity = String(Math.max(k, 0.12));
  l.port.dataset.on = on ? "1" : "";
}

/** comprimento da seta na ponta das ligações (px) */
const ARROW_LEN = 20;

/** Anel do passo atual da apresentação (geometria única, escalada por componente). */
const SPOT_RING = new THREE.TorusGeometry(1, 0.06, 8, 64);
export const reducedMotion = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Material da caixa invisível de clique dos componentes (o raycast não olha `visible` do material; o render pula). */
export const PROXY_MAT = new THREE.MeshBasicMaterial({ visible: false });


/** Arco de Bézier de A a B, acima do terreno (mais alto quanto mais longe), aberto `side` px para o lado. */
function arcCurve(A: THREE.Vector3, B: THREE.Vector3, side: number) {
  const dx = B.x - A.x;
  const dz = B.z - A.z;
  const dist = Math.hypot(dx, dz);
  const lift = Math.max(A.y, B.y) + 30 + dist * 0.3;
  const perp = dist > 0 ? new THREE.Vector3(-dz / dist, 0, dx / dist).multiplyScalar(side) : new THREE.Vector3();
  const c1 = A.clone().lerp(B, 0.15).setY(lift).add(perp);
  const c2 = A.clone().lerp(B, 0.85).setY(lift).add(perp);
  return new THREE.CubicBezierCurve3(A, c1, c2, B);
}

/** Apaga (k < 1) ou devolve (k = 1) a opacidade original dos materiais. */
export function fade(mats: THREE.Material[], k: number) {
  for (const m of mats) {
    const base = (m.userData.base ??= { opacity: m.opacity, transparent: m.transparent, depthWrite: m.depthWrite });
    const transparent = base.transparent || k < 1;
    if (m.transparent !== transparent) m.needsUpdate = true;
    m.transparent = transparent;
    m.opacity = base.opacity * k;
    m.depthWrite = k < 1 ? false : base.depthWrite;
  }
}

/** O objeto e todos os pais estão visíveis (o raycast do three não olha `visible`). */
export function visibleUp(o: THREE.Object3D | null) {
  for (let x = o; x; x = x.parent) if (!x.visible) return false;
  return true;
}

export const esc = (s: string) => s.replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]!);
