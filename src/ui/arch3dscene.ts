/**
 * Cena three.js da visão 3D do modo architecture: os componentes organizados como numa placa de circuito.
 *
 * - Plataforma: uma base única, com a grade das células marcada de leve; cada grupo é uma zona tingida com contorno e
 *   nome (os de dentro sobre os de fora).
 * - Componentes: os modelos do Blender (archparts.ts), um por tipo, com o logo do asset e o destaque na cor dele; nome
 *   embaixo. Endpoints ficam em fila atrás do componente dono.
 * - Conexões: trilhas ortogonais com cantos a 45° que correm pelos canais entre as células (archboard.ts), na cor do tipo
 *   de conexão, com contorno, pulsos andando no sentido da conexão e seta na chegada.
 * - Foco (como na visão das camadas): apontar acende as trilhas do componente; selecionar deixa só ele e os vizinhos (1 ou
 *   2 passos); a busca acende os achados; a legenda esconde tipos de conexão. A apresentação destaca o passo atual.
 * - Câmera ortográfica isométrica com a navegação estilo Blender (blenderControls). Arrastar um componente o move para
 *   outra célula (moveOps, archboard.ts); Shift + arrastar até outro cria a conexão. Na apresentação, as trilhas do passo
 *   crescem da origem ao destino.
 *
 * Placa (x, y) → mundo three (x, altura, y).
 */
import * as THREE from "three";
import { CSS2DObject, CSS2DRenderer } from "three/addons/renderers/CSS2DRenderer.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { boardLayout, modelOf, PITCH_X, PITCH_Y, UNIT, type BoardLayout, type Pt } from "../shared/archboard";
import { CONNECTION_TYPES, endpointColor, endpointLabel, NODE_KINDS, type Asset, type ConnectionType, type Doc, type GroupKind, type NodeEl } from "../shared/schema";
import { truncate, wrapLabel } from "../shared/text";
import { BODY, instancePart, loadParts, logoTexture } from "./archparts";
import { blenderControls, declutterLabels, esc, fade, mixSRGB, PROXY_MAT, reducedMotion, visibleUp, type IsoTheme } from "./iso3d";
import type { Spotlight3D } from "./store";

const THEMES: Record<IsoTheme, { base: string; wall: string; grid: string; zoneMix: number; halo: string; pulse: string; hemi: number; key: number }> = {
  light: { base: "#dfe3ea", wall: "#c3c9d3", grid: "rgba(40, 48, 64, 0.16)", zoneMix: 0.1, halo: "#ffffff", pulse: "#ffffff", hemi: 0.7, key: 1.1 },
  dark: { base: "#262a31", wall: "#1a1d22", grid: "rgba(220, 228, 240, 0.12)", zoneMix: 0.11, halo: "#0b0d11", pulse: "#e8f6ff", hemi: 0.55, key: 1.3 },
};
/** cor das zonas sem cor própria, pelo tipo do grupo */
const ZONE_COLOR: Record<GroupKind, string> = { boundary: "#706fd3", layer: "#e08a1e", cloud: "#2f80ed", network: "#14a38b", context: "#c2410c", cluster: "#7a5af8", team: "#d6453d", global: "#7a7a8c" };
/**
 * Espessura da plataforma, alturas e larguras (px). Tudo no plano fica em alturas próprias (zonas, grade, contorno e
 * trilha), sem polygonOffset: com a câmera ortográfica a profundidade é linear e sobra precisão.
 */
const SLAB = 26;
const ZONE_Y = (depth: number) => 0.3 + Math.min(depth, 5) * 0.3;
const GRID_Y = 2.1;
const TRACE_Y = 3;
const TRACE_W = 7;
const HALO_W = 12;
const ARROW = 18;
const PULSE_TILE = 44;
const FLOW_SPEED = 80;

/** Tipo de conexão: nome e cor (a cor vem das variáveis do tema, as mesmas do 2D). */
export const connStyle = (type: ConnectionType) => {
  const info = CONNECTION_TYPES[type] ?? CONNECTION_TYPES.sync;
  const m = /var\((--[\w-]+)\)/.exec(info.color);
  const color = (m && getComputedStyle(document.documentElement).getPropertyValue(m[1]).trim()) || info.color || "#8f97a6";
  return { label: info.label, color };
};

export interface ArchEvents {
  onNode: (id: string) => void;
  /** clique numa zona (grupo) ou na plataforma vazia (zone undefined) */
  onZone: (zone: string | undefined, clientX: number, clientY: number) => void;
  onEmpty: () => void;
  onConnect: (from: string, to: string) => void;
  /** arrastou o componente para a célula (col, row) da placa */
  onMoveNode: (id: string, col: number, row: number) => void;
}
export interface ArchFilter {
  match: string[] | null;
  isolate: number;
  hiddenTypes: string[];
}
export interface ArchPick {
  node?: string;
  zone?: string;
  /** sobre a plataforma (fora de qualquer zona) */
  board?: boolean;
}

interface Part {
  objs: THREE.Object3D[];
  mats: THREE.Material[];
  glow: THREE.MeshStandardMaterial[];
  label: CSS2DObject;
}
interface Trace {
  id: string;
  /** componentes ligados (um endpoint conta pelo dono) */
  a: string;
  b: string;
  type: string;
  group: THREE.Group;
  mats: THREE.Material[];
  label: CSS2DObject;
  pulses: THREE.Texture;
  /** fitas (contorno, corpo, pulsos) e seta: a apresentação as desenha do início ao fim */
  ribbons: THREE.Mesh[];
  arrow: THREE.Mesh;
}

export class ArchScene {
  private renderer: THREE.WebGLRenderer;
  private labels: CSS2DRenderer;
  private theme: IsoTheme = "dark";
  private hemi: THREE.HemisphereLight;
  private key: THREE.DirectionalLight;
  private scene = new THREE.Scene();
  private camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -20000, 20000);
  private controls: ReturnType<typeof blenderControls>;
  private content = new THREE.Group();
  private clock = new THREE.Clock();
  private flows: THREE.Texture[] = [];
  private fast = new Set<THREE.Texture>();
  private pulseImage: HTMLCanvasElement | null = null;
  private declutter = true;
  private signature = "";
  private doc: Doc | null = null;
  private assets: (id?: string) => Asset | undefined = () => undefined;
  private parts: Map<string, THREE.Object3D> | null = null;
  private nodeAt = new Map<string, { pos: THREE.Vector3; radius: number; top: number }>();
  /** componente de cada endpoint (o foco e o isolamento contam pelo dono) */
  private ownerOf = new Map<string, string>();
  private items = new Map<string, Part>();
  private traces: Trace[] = [];
  private zones = new Map<string, { plate: THREE.Mesh; mat: THREE.MeshStandardMaterial; color: THREE.Color }>();
  private pickables: THREE.Object3D[] = [];
  private trash: { dispose(): void }[] = [];
  private selRing: THREE.Group;
  private hoverRing: THREE.Mesh;
  private spotRings = new THREE.Group();
  private sel: string[] = [];
  private hoverId: string | undefined;
  private hoverAt = 0;
  private dropHint: string | null = null;
  private filter: ArchFilter = { match: null, isolate: 1, hiddenTypes: [] };
  private adj = new Map<string, Set<string>>();
  private spot: Spotlight3D | null = null;
  private linking: { from: string; x: number; y: number; on: boolean; to?: string } | null = null;
  /** arrasto de um componente para outra célula: deslocamento do ponteiro ao centro e a célula de destino */
  private moving: { id: string; x: number; y: number; on: boolean; grab: THREE.Vector3; base: THREE.Vector3[]; cell?: [number, number] } | null = null;
  private cellMark: THREE.Group | null = null;
  private layout: BoardLayout | null = null;
  /** trilhas do passo atual da apresentação sendo desenhadas do início ao fim */
  private grow: { t0: number; traces: Trace[] } | null = null;
  private guide: THREE.Mesh | null = null;
  private down: { x: number; y: number } | null = null;
  private fly: { t0: number; target0: THREE.Vector3; target1: THREE.Vector3; pos0: THREE.Vector3; zoom0: number; zoom1: number } | null = null;
  private introAnim: { t0: number; offset: THREE.Vector3; zoom: number } | null = null;
  private extent = 600;
  private inset = 0;
  private insetRight = 0;
  private frame = 0;
  private ro: ResizeObserver;
  private disposed = false;

  constructor(private host: HTMLElement, private events: ArchEvents) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    host.appendChild(this.renderer.domElement);
    this.renderer.domElement.className = "iso3d-canvas";
    this.labels = new CSS2DRenderer();
    this.labels.domElement.className = "iso3d-labels";
    host.appendChild(this.labels.domElement);

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.3;
    this.hemi = new THREE.HemisphereLight(0xdfe6ee, 0x30343c, 0.6);
    this.key = new THREE.DirectionalLight(0xffffff, 1.2);
    this.key.position.set(-0.8, 1.6, 0.9);
    const rim = new THREE.DirectionalLight(0xffffff, 0.35);
    rim.position.set(1, 0.6, -1);
    this.scene.add(this.hemi, this.key, rim, this.content, this.spotRings);

    // seleção: anel na cor de destaque do app com contorno escuro; hover: anel fino e claro
    this.selRing = new THREE.Group();
    const outer = new THREE.Mesh(new THREE.TorusGeometry(1, 0.06, 10, 72), new THREE.MeshBasicMaterial({ color: new THREE.Color("#1f2430") }));
    const inner = new THREE.Mesh(new THREE.TorusGeometry(1, 0.04, 10, 72), new THREE.MeshBasicMaterial({ color: new THREE.Color("#8b87ff") }));
    inner.position.y = 0.02;
    this.selRing.add(outer, inner);
    this.selRing.rotation.x = Math.PI / 2;
    this.selRing.visible = false;
    this.hoverRing = new THREE.Mesh(new THREE.TorusGeometry(1, 0.025, 8, 64), new THREE.MeshBasicMaterial({ color: new THREE.Color("#ffffff"), transparent: true, opacity: 0.75 }));
    this.hoverRing.rotation.x = Math.PI / 2;
    this.hoverRing.visible = false;
    this.scene.add(this.selRing, this.hoverRing);

    this.controls = blenderControls(this.camera, this.renderer.domElement);
    const el = this.renderer.domElement;
    host.addEventListener("pointerdown", this.onDown, true);
    el.addEventListener("pointerup", this.onUp);
    el.addEventListener("pointermove", this.onMove);
    el.addEventListener("pointerleave", () => this.hover(undefined));
    el.addEventListener("contextmenu", (e) => e.preventDefault());
    el.addEventListener("mousedown", (e) => e.button === 1 && e.preventDefault());
    this.controls.addEventListener("change", () => (this.declutter = true));
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(host);
    this.resize();
    const tick = () => {
      if (this.disposed) return;
      this.frame = requestAnimationFrame(tick);
      const dt = Math.min(0.1, this.clock.getDelta());
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
        declutterLabels(this.labels.domElement, this.camera.zoom);
      }
    };
    tick();
  }

  /* ───────── ciclo de vida ───────── */

  /** Modelos do Blender: precisam estar carregados antes da primeira montagem. */
  async load() {
    this.parts = await loadParts();
  }

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
    const aspect = w / h;
    this.camera.left = -this.extent * aspect;
    this.camera.right = this.extent * aspect;
    this.camera.top = this.extent;
    this.camera.bottom = -this.extent;
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

  async warmup() {
    try {
      await this.renderer.compileAsync(this.scene, this.camera);
    } catch {
      /* sem compilação assíncrona: compila no primeiro quadro */
    }
  }

  intro() {
    if (reducedMotion()) return;
    this.introAnim = { t0: performance.now(), offset: this.camera.position.clone().sub(this.controls.target), zoom: this.camera.zoom };
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

  /* ───────── câmera ───────── */

  orbit(deg: number) {
    const off = this.camera.position.clone().sub(this.controls.target);
    off.applyAxisAngle(new THREE.Vector3(0, 1, 0), THREE.MathUtils.degToRad(deg));
    this.camera.position.copy(this.controls.target).add(off);
    this.camera.lookAt(this.controls.target);
  }

  flyTo(id: string) {
    const at = this.nodeAt.get(id);
    if (at) this.flyToPoint(at.pos.clone().setY(at.top / 2), Math.max(this.camera.zoom, 1.8));
  }

  private flyToPoint(target: THREE.Vector3, zoom: number) {
    this.fly = { t0: performance.now(), target0: this.controls.target.clone(), target1: target, pos0: this.camera.position.clone(), zoom0: this.camera.zoom, zoom1: zoom };
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

  /** Enquadra um grupo de componentes. */
  private frameNodes(ids: string[]) {
    const pts = ids.map((id) => this.nodeAt.get(id)).filter((p): p is NonNullable<typeof p> => !!p);
    if (!pts.length) return;
    const c = pts.reduce((acc, p) => acc.add(p.pos), new THREE.Vector3()).divideScalar(pts.length);
    const r = Math.max(...pts.map((p) => Math.hypot(p.pos.x - c.x, p.pos.z - c.z) + p.radius)) + 80;
    const h = Math.max(1, this.host.clientHeight);
    const free = Math.max(200, Math.min(this.host.clientWidth - this.inset - this.insetRight, h));
    // um componente sozinho não ocupa a tela toda: o zoom do voo para em 1,7
    this.flyToPoint(c, THREE.MathUtils.clamp((0.42 * free * 2 * this.extent) / (h * r), 0.4, 1.7));
  }

  /* ───────── apresentação ───────── */

  setSpotlight(s: Spotlight3D | null) {
    const prev = this.spot;
    this.spot = s;
    for (const p of this.items.values()) for (const m of p.glow) m.emissive.setRGB(0, 0, 0);
    this.spotRings.clear();
    this.fast.clear();
    this.finishGrow();
    if (s) {
      for (const id of s.nodes) {
        const at = this.nodeAt.get(id);
        if (!at || s.extras.includes(id)) continue;
        const ring = new THREE.Mesh(SPOT_RING, new THREE.MeshBasicMaterial({ color: new THREE.Color("#8b87ff"), transparent: true, depthWrite: false }));
        ring.rotation.x = Math.PI / 2;
        ring.position.copy(at.pos).setY(2);
        ring.userData.radius = at.radius * 1.12;
        this.spotRings.add(ring);
      }
      const cur = this.traces.filter((t) => s.conns.includes(t.id));
      for (const t of cur) this.fast.add(t.pulses);
      if (cur.length && !reducedMotion()) this.grow = { t0: performance.now(), traces: cur };
      this.introAnim = null;
      this.frameNodes([...s.nodes, ...cur.flatMap((t) => [t.a, t.b])]);
    } else if (prev) this.frameNodes([...this.items.keys()]);
    this.applyFocus();
  }

  /** As trilhas do passo crescem da origem até o destino; a seta aparece no fim. */
  private stepGrow() {
    const g = this.grow!;
    const k = Math.min(1, (performance.now() - g.t0) / 800);
    const e = 1 - (1 - k) ** 2;
    for (const t of g.traces) {
      for (const m of t.ribbons) m.geometry.setDrawRange(0, Math.floor((m.geometry.index!.count * e) / 6) * 6);
      t.arrow.visible = k >= 1;
    }
    if (k >= 1) this.finishGrow();
  }

  private finishGrow() {
    if (!this.grow) return;
    for (const t of this.grow.traces) {
      for (const m of t.ribbons) m.geometry.setDrawRange(0, Infinity);
      t.arrow.visible = true;
    }
    this.grow = null;
  }

  private stepSpot() {
    const s = this.spot!;
    const pulse = reducedMotion() ? 0.6 : 0.5 + 0.5 * Math.sin(this.clock.elapsedTime * 3.6);
    for (const id of s.nodes) {
      if (s.extras.includes(id)) continue;
      for (const m of this.items.get(id)?.glow ?? []) m.emissive.copy(m.color).multiplyScalar(0.1 + 0.25 * pulse);
    }
    for (const r of this.spotRings.children as THREE.Mesh[]) {
      r.scale.setScalar(r.userData.radius * (1 + 0.1 * pulse));
      (r.material as THREE.MeshBasicMaterial).opacity = 0.9 - 0.5 * pulse;
    }
  }

  /* ───────── interação ───────── */

  private onDown = (e: PointerEvent) => {
    this.down = { x: e.clientX, y: e.clientY };
    this.introAnim = null;
    this.controls.mouseButtons.MIDDLE = e.button === 1 && (e.ctrlKey || e.metaKey) ? THREE.MOUSE.DOLLY : THREE.MOUSE.ROTATE;
    this.fly = null;
    if (e.button !== 0 || e.target !== this.renderer.domElement) return;
    const h = this.hit(e.clientX, e.clientY);
    if (!h.node) return;
    // num componente a câmera fica parada: arrastar move o componente; com Shift (ou num endpoint, que vai junto com
    // o dono) liga a outro componente; sem sair do lugar, é um clique. Na apresentação, nada se move.
    this.controls.enabled = false;
    this.renderer.domElement.setPointerCapture(e.pointerId);
    const item = this.items.get(h.node);
    const at = this.nodeAt.get(h.node);
    const grab = this.planePoint(e.clientX, e.clientY);
    if (e.shiftKey || this.ownerOf.has(h.node) || !item || !at || !grab || this.spot) this.linking = { from: h.node, x: e.clientX, y: e.clientY, on: false };
    else this.moving = { id: h.node, x: e.clientX, y: e.clientY, on: false, grab: grab.sub(at.pos), base: [...item.objs.map((o) => o.position.clone()), item.label.position.clone()] };
  };

  /** Ponto do plano da placa (altura 0) sob o ponteiro. */
  private planePoint(clientX: number, clientY: number) {
    const r = this.renderer.domElement.getBoundingClientRect();
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1), this.camera);
    return ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), new THREE.Vector3());
  }

  /** Arrastando um componente: ele acompanha o ponteiro (um pouco acima da placa) e a célula de destino acende. */
  private dragMove(e: PointerEvent) {
    const m = this.moving!;
    if (!m.on && Math.hypot(e.clientX - m.x, e.clientY - m.y) < 5) return;
    if (!m.on) {
      m.on = true;
      this.hover(undefined);
      this.selRing.visible = false;
      // as trilhas dele ficam para trás: apagadas enquanto ele anda
      for (const t of this.traces) if (t.a === m.id || t.b === m.id) fade(t.mats, 0.15);
    }
    const p = this.planePoint(e.clientX, e.clientY);
    const at = this.nodeAt.get(m.id);
    const item = this.items.get(m.id);
    if (!p || !at || !item) return;
    const d = p.sub(m.grab).sub(at.pos);
    item.objs.forEach((o, i) => o.position.copy(m.base[i]).add(d).setY(m.base[i].y + 18));
    item.label.position.copy(m.base[m.base.length - 1]).add(d);
    const col = Math.round((at.pos.x + d.x) / PITCH_X);
    const row = Math.round((at.pos.z + d.z) / PITCH_Y);
    m.cell = [col, row];
    const here = this.layout?.nodes.get(m.id);
    const taken = [...(this.layout?.nodes.values() ?? [])].some((b) => b.id !== m.id && b.col === col && b.row === row);
    this.markCell(here && here.col === col && here.row === row ? null : { col, row, swap: taken });
    this.renderer.domElement.style.cursor = "grabbing";
    this.declutter = true;
  }

  /** Marcador da célula de destino: contorno arredondado (troca de lugar: âmbar). */
  private markCell(c: { col: number; row: number; swap: boolean } | null) {
    if (this.cellMark) {
      this.cellMark.traverse((o) => {
        const m = o as THREE.Mesh;
        m.geometry?.dispose();
        (m.material as THREE.Material | undefined)?.dispose();
      });
      this.scene.remove(this.cellMark);
      this.cellMark = null;
    }
    if (!c) return;
    const color = new THREE.Color(c.swap ? "#f2a33a" : "#8b87ff");
    const w = PITCH_X - 70;
    const h = PITCH_Y - 70;
    const shape = roundRect(c.col * PITCH_X - w / 2, c.row * PITCH_Y - h / 2, w, h, 26);
    const g = new THREE.Group();
    const fill = new THREE.Mesh(new THREE.ShapeGeometry(shape, 8), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.16, depthWrite: false }));
    fill.rotation.x = -Math.PI / 2;
    const pts = shape.getPoints(8).map((p) => new THREE.Vector3(p.x, 0, -p.y));
    pts.push(pts[0].clone());
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color }));
    g.add(fill, line);
    g.position.y = TRACE_Y + 0.8;
    this.cellMark = g;
    this.scene.add(g);
  }

  /** Solta o componente: na célula nova o documento muda (e a cena é refeita); senão, ele volta para o lugar. */
  private endMove() {
    const m = this.moving!;
    this.moving = null;
    this.markCell(null);
    const item = this.items.get(m.id);
    if (item) {
      item.objs.forEach((o, i) => o.position.copy(m.base[i]));
      item.label.position.copy(m.base[m.base.length - 1]);
    }
    this.applyFocus();
    this.setSelection(this.sel);
    const here = this.layout?.nodes.get(m.id);
    if (m.cell && here && (here.col !== m.cell[0] || here.row !== m.cell[1])) this.events.onMoveNode(m.id, m.cell[0], m.cell[1]);
  }

  /** O que está sob o ponteiro: componente, zona, plataforma ou nada. */
  pick(clientX: number, clientY: number): ArchPick {
    return this.hit(clientX, clientY);
  }

  private hit(clientX: number, clientY: number): ArchPick {
    const r = this.renderer.domElement.getBoundingClientRect();
    if (clientX < r.left || clientX > r.right || clientY < r.top || clientY > r.bottom) return {};
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1), this.camera);
    for (const h of ray.intersectObjects(this.pickables, false)) {
      if (!visibleUp(h.object)) continue;
      const u = h.object.userData;
      if (u.nodeId) return { node: u.nodeId };
      if (u.zoneId) return { zone: u.zoneId };
      if (u.board) return { board: true };
    }
    return {};
  }

  private onMove = (e: PointerEvent) => {
    if (this.moving) return this.dragMove(e);
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
    if (e.buttons) return;
    const now = performance.now();
    if (now - this.hoverAt < 40) return;
    this.hoverAt = now;
    const h = this.hit(e.clientX, e.clientY);
    this.renderer.domElement.style.cursor = h.node ? (this.ownerOf.has(h.node) || this.spot ? "pointer" : "grab") : "";
    this.hover(h.node);
  };

  private hover(id: string | undefined) {
    const at = id && !this.sel.includes(id) ? this.nodeAt.get(id) : undefined;
    this.hoverRing.visible = !!at;
    if (at) {
      this.hoverRing.position.copy(at.pos).setY(1.5);
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
    const mv = this.moving;
    if (mv) {
      this.controls.enabled = true;
      if (mv.on) return this.endMove();
      this.moving = null;
    }
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
    if (h.zone || h.board) return this.events.onZone(h.zone, e.clientX, e.clientY);
    this.events.onEmpty();
  };

  /** Linha-guia do arrasto de conexão: do componente até o ponteiro (ou até o componente de destino). */
  private drawGuide(from: string, to: string | undefined, clientX: number, clientY: number) {
    const a = this.nodeAt.get(from);
    if (!a) return;
    const A = a.pos.clone().setY(a.top + 6);
    const b = to ? this.nodeAt.get(to) : undefined;
    let B: THREE.Vector3;
    if (b) B = b.pos.clone().setY(b.top + 6);
    else {
      const r = this.renderer.domElement.getBoundingClientRect();
      const ray = new THREE.Raycaster();
      ray.setFromCamera(new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1), this.camera);
      B = ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -A.y), new THREE.Vector3()) ?? A.clone();
    }
    this.clearGuide();
    if (A.distanceTo(B) < 2) return;
    const lift = A.clone().lerp(B, 0.5).setY(Math.max(A.y, B.y) + 40 + A.distanceTo(B) * 0.15);
    const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(b ? "#8b87ff" : this.theme === "light" ? "#3a4150" : "#a9b1bf"), transparent: true, opacity: 0.9, depthTest: false });
    this.guide = new THREE.Mesh(new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(A, lift, B), 40, 2.4, 6, false), mat);
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

  /** Destaque do alvo ao soltar da paleta: a zona que recebe o componente, ou o componente apontado. */
  setDropHint(id: string | null) {
    if (id === this.dropHint) return;
    const prev = this.dropHint ? this.zones.get(this.dropHint) : undefined;
    if (prev) prev.mat.emissive.setRGB(0, 0, 0);
    this.dropHint = id;
    const z = id ? this.zones.get(id) : undefined;
    if (z) z.mat.emissive.copy(z.color).multiplyScalar(0.35);
    this.hover(id && this.nodeAt.has(id) ? id : undefined);
  }

  setSelection(sel: string[]) {
    this.sel = sel;
    for (const [id, p] of this.items) p.label.element.dataset.sel = sel.includes(id) ? "1" : "";
    this.declutter = true;
    const hit = sel.map((id) => this.nodeAt.get(id)).find(Boolean);
    this.selRing.visible = !!hit;
    if (hit) {
      this.selRing.position.copy(hit.pos).setY(2);
      this.selRing.scale.setScalar(hit.radius);
    }
    this.applyFocus();
  }

  setFilter(f: ArchFilter) {
    this.filter = f;
    this.applyFocus();
  }

  private comp = (id: string) => this.ownerOf.get(id) ?? id;

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

  /** Foco, busca, isolamento e filtro de tipos: o que fica normal, apagado ou escondido (como na visão das camadas). */
  private applyFocus() {
    const hidden = new Set(this.filter.hiddenTypes);
    this.adj.clear();
    for (const t of this.traces) {
      if (hidden.has(t.type)) continue;
      if (!this.adj.has(t.a)) this.adj.set(t.a, new Set());
      if (!this.adj.has(t.b)) this.adj.set(t.b, new Set());
      this.adj.get(t.a)!.add(t.b);
      this.adj.get(t.b)!.add(t.a);
    }
    if (this.spot) return this.applySpot(hidden);
    const sel = [...new Set(this.sel.filter((id) => this.items.has(id)).map(this.comp))];
    const hov = this.hoverId && this.items.has(this.hoverId) ? this.comp(this.hoverId) : undefined;
    const anchor = hov ? [hov, ...sel] : sel;
    const shown = sel.length ? this.reach(sel, Math.max(1, this.filter.isolate)) : null;
    const match = this.filter.match ? new Set(this.filter.match.map(this.comp)) : null;
    const near = anchor.length ? this.reach(anchor, 1) : null;
    const lit = match && near ? new Set([...match, ...near]) : (match ?? near);
    for (const [id, p] of this.items) {
      const c = this.comp(id);
      const visible = !shown || shown.has(c);
      for (const o of p.objs) o.visible = visible;
      p.label.visible = visible;
      const dim = visible && !!lit && !lit.has(c);
      fade(p.mats, dim ? 0.16 : 1);
      p.label.element.classList.toggle("iso3d-dim", dim);
    }
    for (const t of this.traces) {
      const visible = !hidden.has(t.type) && (!shown || (shown.has(t.a) && shown.has(t.b)));
      t.group.visible = visible;
      t.label.visible = visible;
      const on = anchor.length ? anchor.includes(t.a) || anchor.includes(t.b) : !!match && match.has(t.a) && match.has(t.b);
      const dim = (anchor.length > 0 || !!match) && !on;
      fade(t.mats, dim ? 0.12 : 1);
      t.label.element.dataset.on = visible && (on || !!shown) ? "1" : "";
    }
    this.declutter = true;
  }

  private applySpot(hidden: Set<string>) {
    const s = this.spot!;
    const cur = new Set(s.nodes.map(this.comp));
    const seen = new Set(s.seenNodes.map(this.comp));
    for (const [id, p] of this.items) {
      const c = this.comp(id);
      const k = cur.has(c) ? 1 : seen.has(c) ? 0.5 : 0.07;
      for (const o of p.objs) o.visible = true;
      fade(p.mats, k);
      p.label.visible = k >= 0.5;
      p.label.element.classList.toggle("iso3d-dim", k < 1);
      p.label.element.dataset.sel = s.nodes.includes(id) && !s.extras.includes(id) ? "1" : "";
    }
    const conns = new Set(s.conns);
    const seenC = new Set(s.seenConns);
    for (const t of this.traces) {
      t.group.visible = !hidden.has(t.type);
      t.label.visible = t.group.visible;
      fade(t.mats, conns.has(t.id) ? 1 : seenC.has(t.id) ? 0.45 : 0.05);
      t.label.element.dataset.on = conns.has(t.id) ? "1" : "";
    }
    this.declutter = true;
  }

  /* ───────── cena ───────── */

  /** Documento e o catálogo para achar o asset (logo e cor) de cada componente. Só remonta quando o desenho muda. */
  setDoc(doc: Doc, assets: (id?: string) => Asset | undefined) {
    const first = !this.doc;
    this.doc = doc;
    this.assets = assets;
    const sig = JSON.stringify([
      doc.groups.map((g) => [g.id, g.x, g.y, g.w, g.h, g.parent, g.label, g.color, g.kind]),
      doc.nodes.map((n) => [n.id, n.x, n.y, n.parent, n.owner, n.label, n.kind, n.asset, n.technology, n.endpoint]),
      doc.connections.map((c) => [c.id, c.from, c.to, c.type, c.label, c.protocol]),
      doc.customAssets.map((a) => [a.id, a.icon, a.color]),
    ]);
    if (!first && sig === this.signature) return;
    this.signature = sig;
    this.build(doc, first);
  }

  setTheme(theme: IsoTheme) {
    if (theme === this.theme) return;
    this.theme = theme;
    this.hemi.intensity = THEMES[theme].hemi;
    this.key.intensity = THEMES[theme].key;
    if (this.doc) this.build(this.doc, false);
  }

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
    this.ownerOf.clear();
    this.items.clear();
    this.traces = [];
    this.zones.clear();
    this.dropHint = null;
  }

  private build(doc: Doc, frame: boolean) {
    if (!this.parts) return;
    this.clearContent();
    const L = boardLayout(doc);
    this.layout = L;
    this.addPlatform(L);
    for (const z of L.zones) this.addZone(z);
    const byId = new Map(doc.nodes.map((n) => [n.id, n]));
    for (const b of L.nodes.values()) this.addComponent(byId.get(b.id)!, b.x, b.y);
    for (const e of L.endpoints) this.addEndpoint(byId.get(e.id)!, e.owner, e.x, e.y);
    const conns = new Map(doc.connections.map((c) => [c.id, c]));
    for (const t of L.traces) this.addTrace(t.id, this.comp(t.from), this.comp(t.to), conns.get(t.id)!, t.pts);
    this.setSelection(this.sel);
    if (this.spot) this.setSpotlight(this.spot);
    this.declutter = true;

    if (frame) {
      // vista inicial isométrica (45° em volta, 35° acima), enquadrando a placa inteira
      const b = L.bounds;
      const cx = b.x + b.w / 2;
      const cy = b.y + b.h / 2;
      const radius = Math.max(300, Math.hypot(b.w, b.h) / 2);
      this.extent = radius * 0.72;
      this.controls.target.set(cx, 0, cy);
      const dist = radius * 3;
      const el = THREE.MathUtils.degToRad(35);
      this.camera.position.set(cx + dist * Math.cos(el) * Math.SQRT1_2, dist * Math.sin(el), cy + dist * Math.cos(el) * Math.SQRT1_2);
      this.camera.zoom = 1;
      this.camera.lookAt(this.controls.target);
      this.resize();
    }
  }

  /** Base da placa: bloco de cantos arredondados com a grade das células marcada de leve no tampo. */
  private addPlatform(L: BoardLayout) {
    const t = THEMES[this.theme];
    const b = L.bounds;
    const shape = roundRect(b.x, b.y, b.w, b.h, 36);
    const geo = new THREE.ExtrudeGeometry(shape, { depth: SLAB, bevelEnabled: true, bevelThickness: 3, bevelSize: 3, bevelSegments: 2, curveSegments: 8 });
    geo.rotateX(-Math.PI / 2);
    geo.translate(0, -SLAB - 3, 0); // o chanfro passa 3 px do tampo: o tampo fica em 0
    const top = new THREE.MeshStandardMaterial({ color: new THREE.Color(t.base), roughness: 0.85, metalness: 0.02 });
    const wall = new THREE.MeshStandardMaterial({ color: new THREE.Color(t.wall), roughness: 0.9, metalness: 0.02 });
    const slab = new THREE.Mesh(geo, [top, wall]);
    slab.userData.board = true;
    this.content.add(slab);
    this.pickables.push(slab);

    // grade: linhas finas no meio dos canais e uma cruz em cada cruzamento (a "furação" da placa)
    const c = document.createElement("canvas");
    c.width = c.height = 128;
    const g = c.getContext("2d")!;
    g.strokeStyle = t.grid;
    g.globalAlpha = 0.45;
    g.lineWidth = 2;
    g.setLineDash([6, 10]);
    g.strokeRect(0, 0, 128, 128);
    g.globalAlpha = 1;
    g.setLineDash([]);
    g.lineWidth = 3;
    for (const [x, y] of [[0, 0], [128, 0], [0, 128], [128, 128]]) {
      g.beginPath();
      g.moveTo(x - 9, y);
      g.lineTo(x + 9, y);
      g.moveTo(x, y - 9);
      g.lineTo(x, y + 9);
      g.stroke();
    }
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.anisotropy = 8;
    const frac = (v: number) => v - Math.floor(v);
    const grid = new THREE.Mesh(new THREE.PlaneGeometry(b.w - 40, b.h - 40), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
    // um ladrilho por célula, com os cruzamentos nos meios dos canais: x = (c + ½)·passo
    tex.repeat.set((b.w - 40) / PITCH_X, (b.h - 40) / PITCH_Y);
    tex.offset.set(frac((b.x + 20) / PITCH_X - 0.5), frac(0.5 - (b.y + b.h - 20) / PITCH_Y));
    grid.rotation.x = -Math.PI / 2;
    grid.position.set(b.x + b.w / 2, GRID_Y, b.y + b.h / 2);
    this.content.add(grid);
    this.trash.push(tex);
  }

  /** Zona de um grupo: placa tingida rente à base, contorno (tracejado nas redes e nuvens) e o nome no canto. */
  private addZone(z: BoardLayout["zones"][number]) {
    const t = THEMES[this.theme];
    const color = new THREE.Color(z.color ?? ZONE_COLOR[z.kind] ?? "#7a7a8c");
    const y = ZONE_Y(z.depth);
    const shape = roundRect(z.x, z.y, z.w, z.h, 22);
    const geo = new THREE.ShapeGeometry(shape, 8);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshStandardMaterial({ color: mixSRGB(t.base, color, t.zoneMix + z.depth * 0.03), roughness: 0.85 });
    const plate = new THREE.Mesh(geo, mat);
    plate.position.y = y;
    plate.userData.zoneId = z.id;
    this.content.add(plate);
    this.pickables.push(plate);
    const pts = shape.getPoints(8).map((p) => new THREE.Vector3(p.x, y + 0.15, -p.y));
    pts.push(pts[0].clone());
    const dashed = z.kind === "network" || z.kind === "cloud";
    const lineMat = dashed ? new THREE.LineDashedMaterial({ color, dashSize: 14, gapSize: 9 }) : new THREE.LineBasicMaterial({ color });
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), lineMat);
    if (dashed) line.computeLineDistances();
    this.content.add(line);
    this.label(`<span class="iso3d-context" style="--c:#${color.getHexString()}">${esc(z.label.toUpperCase())}</span>`, new THREE.Vector3(z.x + 18, y + 2, z.y + 22), "left");
    this.zones.set(z.id, { plate, mat, color });
  }

  /** Componente: o modelo do tipo, com o logo e a cor do asset; nome e tecnologia embaixo. */
  private addComponent(n: NodeEl, x: number, y: number) {
    const tpl = this.parts!.get(modelOf(n)) ?? this.parts!.get("service")!;
    const asset = this.assets(n.asset);
    const color = asset?.color ?? "#706fd3";
    const icon = asset?.icon ?? `t:${n.label.slice(0, 2).toUpperCase()}`;
    const inst = instancePart(tpl, { body: BODY[this.theme], accent: color, logo: logoTexture(icon, color, asset?.name ?? n.label).tex });
    inst.obj.scale.setScalar(UNIT);
    inst.obj.position.set(x, 0, y);
    this.content.add(inst.obj);
    const box = new THREE.Box3().setFromObject(inst.obj);
    const size = box.getSize(new THREE.Vector3());
    const radius = Math.max(size.x, size.z) * 0.62;
    this.nodeAt.set(n.id, { pos: new THREE.Vector3(x, 0, y), radius, top: box.max.y });
    const proxy = new THREE.Mesh(new THREE.BoxGeometry(size.x, size.y, size.z), PROXY_MAT);
    proxy.position.copy(box.getCenter(new THREE.Vector3()));
    proxy.userData.nodeId = n.id;
    this.content.add(proxy);
    this.pickables.push(proxy);
    const sub = n.ref ? n.ref.diagram.split("/").pop()!.replace(/\.archflow\.json$/, "") : (n.technology ?? asset?.name ?? NODE_KINDS[n.kind]?.split(/[ (/,]/)[0] ?? n.kind);
    const name = wrapLabel(n.label.toUpperCase(), 20, 2).map((l) => esc(truncate(l, 24))).join("<br>");
    const label = this.label(`<span class="iso3d-name">${name}<small>${esc(truncate(sub, 28).toUpperCase())}</small></span>`, new THREE.Vector3(x, 0, y + size.z / 2 + 8), "top", n.id);
    this.items.set(n.id, { objs: [inst.obj, proxy], mats: inst.mats, glow: inst.glow, label });
  }

  /** Endpoint: tomada pequena na cor do protocolo, atrás do dono, com o método e o caminho. */
  private addEndpoint(n: NodeEl, owner: string, x: number, y: number) {
    this.ownerOf.set(n.id, owner);
    const color = n.endpoint ? endpointColor(n.endpoint) : "#7a7a8c";
    const inst = instancePart(this.parts!.get("endpoint")!, { body: BODY[this.theme], accent: color });
    inst.obj.scale.setScalar(UNIT);
    inst.obj.position.set(x, 0, y);
    this.content.add(inst.obj);
    const box = new THREE.Box3().setFromObject(inst.obj);
    const size = box.getSize(new THREE.Vector3());
    this.nodeAt.set(n.id, { pos: new THREE.Vector3(x, 0, y), radius: Math.max(size.x, size.z) * 0.7, top: box.max.y });
    const proxy = new THREE.Mesh(new THREE.BoxGeometry(size.x + 8, size.y + 8, size.z + 8), PROXY_MAT);
    proxy.position.copy(box.getCenter(new THREE.Vector3()));
    proxy.userData.nodeId = n.id;
    this.content.add(proxy);
    this.pickables.push(proxy);
    const text = n.endpoint ? endpointLabel(n.endpoint) : n.label;
    const label = this.label(`<span class="arch3d-ep" style="--c:${color}">${esc(truncate(text, 26))}</span>`, new THREE.Vector3(x, box.max.y + 4, y - 4), "center", n.id);
    label.element.dataset.ep = "1";
    this.items.set(n.id, { objs: [inst.obj, proxy], mats: inst.mats, glow: inst.glow, label });
  }

  /** Trilha: fita na cor do tipo com contorno, pulsos andando no sentido da conexão, pino na saída e seta na chegada. */
  private addTrace(id: string, a: string, b: string, c: NonNullable<Doc["connections"][number]>, pts: Pt[]) {
    const style = connStyle(c.type);
    const color = new THREE.Color(style.color);
    const t = THEMES[this.theme];
    const g = new THREE.Group();
    const mats: THREE.Material[] = [];
    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, order = 0) => {
      const m = new THREE.Mesh(geo, mat);
      m.renderOrder = order;
      g.add(m);
      mats.push(mat);
      return m;
    };
    // a fita para antes da ponta, onde fica a seta
    const body = trimEnd(pts, ARROW - 2);
    const len = pathLength(body);
    const pulses = this.pulseTexture();
    const ribbons = [
      add(ribbon(body, HALO_W, TRACE_Y - 0.4), new THREE.MeshBasicMaterial({ color: new THREE.Color(t.halo), transparent: true, opacity: this.theme === "dark" ? 0.75 : 0.9, depthWrite: false })),
      add(ribbon(body, TRACE_W, TRACE_Y), new THREE.MeshStandardMaterial({ color, emissive: color.clone().multiplyScalar(0.35), metalness: 0.25, roughness: 0.4 })),
      add(ribbon(body, TRACE_W, TRACE_Y + 0.3), new THREE.MeshBasicMaterial({ color: new THREE.Color(t.pulse), map: pulses, transparent: true, opacity: this.theme === "dark" ? 0.7 : 0.55, depthWrite: false }), 1),
    ];
    // pino na saída e seta na chegada (no plano, na direção do último trecho)
    const S = pts[0];
    const pad = add(new THREE.CircleGeometry(7, 20), new THREE.MeshStandardMaterial({ color, emissive: color.clone().multiplyScalar(0.35), metalness: 0.3, roughness: 0.4 }));
    pad.rotation.x = -Math.PI / 2;
    pad.position.set(S.x, TRACE_Y + 0.2, S.y);
    const E = pts[pts.length - 1];
    const P = pts[pts.length - 2];
    const dir = new THREE.Vector2(E.x - P.x, E.y - P.y).normalize();
    const tri = new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(-ARROW, 8), new THREE.Vector2(-ARROW, -8)]);
    const arrow = add(new THREE.ShapeGeometry(tri), new THREE.MeshStandardMaterial({ color, emissive: color.clone().multiplyScalar(0.35), side: THREE.DoubleSide }));
    arrow.rotation.set(-Math.PI / 2, 0, -Math.atan2(dir.y, dir.x));
    arrow.position.set(E.x, TRACE_Y + 0.4, E.y);
    this.content.add(g);
    // rótulo: no meio do trecho mais longo; só aparece com foco
    let best = 1;
    for (let i = 1; i < pts.length; i++) if (seg(pts, i) > seg(pts, best)) best = i;
    const mid = { x: (pts[best - 1].x + pts[best].x) / 2, y: (pts[best - 1].y + pts[best].y) / 2 };
    const text = c.label?.trim() || c.protocol?.trim() || style.label;
    const label = this.label(`<span class="iso3d-edge" style="--c:${style.color}">${esc(truncate(text, 32))}</span>`, new THREE.Vector3(mid.x, 14, mid.y));
    label.element.dataset.conn = "1";
    this.traces.push({ id, a, b, type: c.type, group: g, mats, label, pulses, ribbons, arrow });
  }

  /** Padrão de pulsos (traços que andam); a fita já mede u em ciclos (PULSE_TILE px). */
  private pulseTexture() {
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
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
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
}

/** Anel do passo atual da apresentação (geometria única, escalada por componente). */
const SPOT_RING = new THREE.TorusGeometry(1, 0.04, 8, 64);

/** Retângulo de cantos arredondados no plano da forma (y invertido: girada −90° em X, o y da placa vira z). */
export function roundRect(x: number, y: number, w: number, h: number, r: number) {
  const s = new THREE.Shape();
  const [x0, y0, x1, y1] = [x, -y - h, x + w, -y];
  s.moveTo(x0 + r, y0);
  s.lineTo(x1 - r, y0);
  s.quadraticCurveTo(x1, y0, x1, y0 + r);
  s.lineTo(x1, y1 - r);
  s.quadraticCurveTo(x1, y1, x1 - r, y1);
  s.lineTo(x0 + r, y1);
  s.quadraticCurveTo(x0, y1, x0, y1 - r);
  s.lineTo(x0, y0 + r);
  s.quadraticCurveTo(x0, y0, x0 + r, y0);
  return s;
}

const seg = (pts: Pt[], i: number) => Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
export const pathLength = (pts: Pt[]) => pts.reduce((s, _, i) => (i ? s + seg(pts, i) : 0), 0);

/** Encurta a polilinha em `d` px no fim (onde entra a seta). */
export function trimEnd(pts: Pt[], d: number): Pt[] {
  const out = pts.map((p) => ({ ...p }));
  while (out.length > 2 && seg(out, out.length - 1) <= d) {
    d -= seg(out, out.length - 1);
    out.pop();
  }
  const i = out.length - 1;
  const L = seg(out, i);
  const k = L > 0 ? Math.max(0, (L - d) / L) : 0;
  out[i] = { x: out[i - 1].x + (out[i].x - out[i - 1].x) * k, y: out[i - 1].y + (out[i].y - out[i - 1].y) * k };
  return out;
}

/**
 * Fita plana ao longo da polilinha, com as juntas em meia-esquadria (os cantos de 45° não abrem nem sobrepõem);
 * u acompanha o comprimento (× uScale), para os pulsos andarem ao longo dela.
 */
export function ribbon(pts: Pt[], width: number, y: number, uScale = 1 / PULSE_TILE): THREE.BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  let u = 0;
  for (let i = 0; i < pts.length; i++) {
    if (i) u += seg(pts, i);
    const prev = pts[Math.max(0, i - 1)];
    const next = pts[Math.min(pts.length - 1, i + 1)];
    const d0 = new THREE.Vector2(pts[i].x - prev.x, pts[i].y - prev.y).normalize();
    const d1 = new THREE.Vector2(next.x - pts[i].x, next.y - pts[i].y).normalize();
    if (i === 0) d0.copy(d1);
    if (i === pts.length - 1) d1.copy(d0);
    const n0 = new THREE.Vector2(-d0.y, d0.x);
    const miter = new THREE.Vector2(-(d0.y + d1.y), d0.x + d1.x).normalize();
    const k = (width / 2) / Math.max(0.3, miter.dot(n0));
    for (const s of [1, -1]) {
      pos.push(pts[i].x + miter.x * k * s, y, pts[i].y + miter.y * k * s);
      uv.push(u * uScale, s > 0 ? 1 : 0);
    }
    // virados para cima (normal +y)
    if (i) idx.push(2 * i - 2, 2 * i, 2 * i - 1, 2 * i - 1, 2 * i, 2 * i + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
