/**
 * Cena three.js da visão 3D do modo logic: o fluxo numa placa que lembra um circuito (sem imitar uma placa eletrônica).
 *
 * - Placa: base no tom do tema com uma grade fina; grupos são contornos tracejados com o nome.
 * - Peças: módulos modelados no Blender (logicparts.ts), um por papel, com a silhueta do fluxograma e o símbolo da
 *   função aceso na cor do papel; nome embaixo. Dados e cenários só entram com `showData` (por padrão o quadro mostra só o
 *   fluxo). Ficam onde o
 *   cartão está no 2D (o layout de cima para baixo do fluxo, logiclayout.ts): início no alto, fins embaixo, entradas à
 *   esquerda e resultados e cenários à direita. Etapa recolhida vira uma pilha de pastas (duplo clique abre).
 * - Setas: trilhas ortogonais com cantos a 45°, um ponto na saída e nas dobras; as saídas nomeadas (sim, não, repete,
 *   segue, outros, erro) ficam na cor delas e levam o nome no começo; pulsos andam no sentido do fluxo e a ponta
 *   mostra a chegada.
 * - Foco: apontar acende as setas da peça; selecionar destaca ela e os vizinhos; a busca acende os achados.
 * - Reprodução de um cenário (store.play): o caminho percorrido acende, o resto apaga; a peça do passo atual brilha e
 *   sobe, uma bolinha corre pela seta que levou até ela e o que o passo mudou flutua sobre ela. A câmera acompanha
 *   quando o passo sai da tela.
 * - Câmera ortográfica isométrica (45° em volta, 35° acima) com a navegação estilo Blender (blenderControls).
 *
 * Quadro (x, y) → mundo three (x, altura, y).
 */
import * as THREE from "three";
import { CSS2DObject, CSS2DRenderer } from "three/addons/renderers/CSS2DRenderer.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { LOGIC_BRANCHES, LOGIC_ROLES, isDataRole, type ConnectionEl, type Doc, type GroupEl, type LogicRole, type NodeEl } from "../shared/schema";
import { layoutView } from "../shared/logicstages";
import type { DebugCard } from "../shared/logicdebug";
import { codeHtml } from "../shared/codefmt";
import { truncate, wrapLabel } from "../shared/text";
import type { Pt } from "../shared/archboard";
import { BODY, instancePart } from "./archparts";
import { pathLength, ribbon, roundRect, trimEnd } from "./arch3dscene";
import { blenderControls, declutterLabels, esc, fade, mixSRGB, PROXY_MAT, reducedMotion, visibleUp, type IsoTheme } from "./iso3d";
import { loadLogicParts, type LogicPart } from "./logicparts";

const THEMES: Record<IsoTheme, { base: string; wall: string; zone: string; grid: string; halo: string; wire: string; hemi: number; key: number }> = {
  light: { base: "#e2e6ec", wall: "#c3c9d3", zone: "#d6dbe3", grid: "rgba(40, 52, 72, 0.13)", halo: "#ffffff", wire: "#7f8b9c", hemi: 0.9, key: 1.2 },
  dark: { base: "#171c24", wall: "#0d1117", zone: "#1c222c", grid: "rgba(150, 170, 200, 0.09)", halo: "#07090d", wire: "#66758a", hemi: 0.6, key: 1.3 },
};
/** brilho de base do símbolo e do aro das peças (fração da cor do papel) */
const GLOW = 0.35;
/** cor de cada saída (a seta sem saída nomeada usa a cor neutra do tema) */
/** abaixo da peça, o cartão do passo atual desce isto (px) para não cobrir a peça nem o nome dela */
const BELOW_GAP = 96;
/** a ponta do cartão (px): a distância entre a âncora e a borda de baixo dele */
const TIP = 7;

export const BRANCH_COLOR: Record<string, string> = { sim: "#3aa76d", nao: "#d6453d", repete: "#c2548b", segue: "#0e9aa7", outros: "#8f97a6", erro: "#e0663a", caso: "#0e9aa7" };
const END_ERROR = "#d6453d";

/** tamanho das peças (px do quadro por unidade do Blender): passos do fluxo e dados (cartões menores, em coluna) */
const FLOW_UNIT = 112;
const DATA_UNIT = 70;
const SLAB = 16;
const ZONE_Y = (depth: number) => 0.3 + Math.min(depth, 5) * 0.3;
const TRACE_Y = 2;
const TRACE_W = 6;
const HALO_W = 12;
const ARROW = 16;
const PULSE_TILE = 40;
const FLOW_SPEED = 70;
const CHAMFER = 16;

export interface LogicEvents {
  onNode: (id: string) => void;
  /** duplo clique numa etapa recolhida */
  onOpenStage: (id: string) => void;
  onEmpty: () => void;
  /** clique no cartão de debug de um passo já percorrido: a reprodução volta a ele */
  onStep?: (k: number) => void;
}
export interface LogicFilter {
  match: string[] | null;
}
/** Os dados e os cenários entram no quadro? (por padrão, só o fluxo) */
export interface LogicOptions {
  showData: boolean;
}
/** O que a reprodução do cenário mostra: passos e setas já percorridos, o passo atual e a seta que levou até ele. */
export interface LogicPlay3D {
  cur?: string;
  visited: string[];
  edges: string[];
  curEdge?: string;
  /** cartões de debug flutuando sobre as peças: o do passo atual completo, os dos já percorridos resumidos */
  cards?: DebugCard[];
}

interface Piece {
  id: string;
  part: LogicPart;
  objs: THREE.Object3D[];
  model: THREE.Object3D;
  mats: THREE.Material[];
  glow: THREE.MeshStandardMaterial[];
  label: CSS2DObject;
  pos: THREE.Vector3;
  radius: number;
  top: number;
}
interface Wire {
  id: string;
  a: string;
  b: string;
  group: THREE.Group;
  mats: THREE.Material[];
  label?: CSS2DObject;
  pulses: THREE.Texture;
  path: THREE.Vector3[];
}

export class LogicScene {
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
  private parts: Map<LogicPart, THREE.Object3D> | null = null;
  private pieces = new Map<string, Piece>();
  private wires: Wire[] = [];
  private pickables: THREE.Object3D[] = [];
  private trash: { dispose(): void }[] = [];
  private selRing: THREE.Group;
  private hoverRing: THREE.Mesh;
  private curRing: THREE.Mesh;
  private token: THREE.Mesh;
  private sel: string[] = [];
  private hoverId: string | undefined;
  private hoverAt = 0;
  private filter: LogicFilter = { match: null };
  private play: LogicPlay3D | null = null;
  private opts: LogicOptions = { showData: false };
  /** cartões de debug: um por vez. O do passo atual fica sempre; o de outra peça percorrida aparece com o mouse sobre ela */
  private cardData = new Map<string, DebugCard>();
  private curCard: CSS2DObject | null = null;
  private hoverCard: CSS2DObject | null = null;
  private hoverCardId: string | undefined;
  private overCard = false;
  private hideCard = 0;
  private playAt = 0;
  private down: { x: number; y: number } | null = null;
  private lastClick: { id: string; t: number } | null = null;
  private fly: { t0: number; target0: THREE.Vector3; target1: THREE.Vector3; pos0: THREE.Vector3; zoom0: number; zoom1: number } | null = null;
  private introAnim: { t0: number; offset: THREE.Vector3; zoom: number } | null = null;
  private extent = 600;
  private inset = 0;
  private insetRight = 0;
  private insetBottom = 0;
  /** onde termina o que flutua em cima da tela (barra de teste): o cartão do passo atual não passa daí */
  private insetTop = 0;
  /** passo novo na reprodução: assim que o cartão dele estiver medido (e a câmera parada), centraliza a tela nele */
  private centerCard = false;
  private frame = 0;
  private ro: ResizeObserver;
  private disposed = false;

  constructor(private host: HTMLElement, private events: LogicEvents) {
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
    this.scene.add(this.hemi, this.key, rim, this.content);

    // seleção: anel na cor de destaque do app com contorno escuro; hover: anel fino e claro; passo atual: anel âmbar
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
    this.curRing = new THREE.Mesh(new THREE.TorusGeometry(1, 0.05, 8, 64), new THREE.MeshBasicMaterial({ color: new THREE.Color("#f2994a"), transparent: true, depthWrite: false }));
    this.curRing.rotation.x = Math.PI / 2;
    this.curRing.visible = false;
    this.token = new THREE.Mesh(new THREE.SphereGeometry(9, 20, 12), new THREE.MeshStandardMaterial({ color: new THREE.Color("#f2994a"), emissive: new THREE.Color("#f2994a"), emissiveIntensity: 0.8 }));
    this.token.visible = false;
    this.scene.add(this.selRing, this.hoverRing, this.curRing, this.token);

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
      if (this.play) this.stepPlay();
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
      this.labels.render(this.scene, this.camera);
      // um cartão por vez: o aberto pelo mouse toma o lugar do atual enquanto estiver aberto
      if (this.curCard) (this.curCard.element.classList.toggle("l3-dbg-off", !!this.hoverCard), this.placeCard(this.curCard, true));
      if (this.hoverCard) this.placeCard(this.hoverCard, false);
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
    this.parts = await loadLogicParts();
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
    const shiftX = (this.insetRight - this.inset) / 2;
    const shiftY = this.insetBottom / 2;
    if ((shiftX || shiftY) && this.inset + this.insetRight < w && this.insetBottom < h) this.camera.setViewOffset(w, h, shiftX, shiftY, w, h);
    else this.camera.clearViewOffset();
    this.camera.updateProjectionMatrix();
  }

  /** Largura (px) coberta por painéis na esquerda, na direita e embaixo; a cena se centra no espaço que sobra. */
  setInset(left: number, right = 0, bottom = 0, top = 0) {
    this.insetTop = top;
    if (Math.abs(left - this.inset) < 1 && Math.abs(right - this.insetRight) < 1 && Math.abs(bottom - this.insetBottom) < 1) return;
    this.inset = left;
    this.insetRight = right;
    this.insetBottom = bottom;
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
    const p = this.pieces.get(id);
    if (p) this.flyToPoint(p.pos.clone().setY(p.top / 2), Math.max(this.camera.zoom, 1.6));
  }

  /** Enquadra o fluxo inteiro de novo. */
  frameAll() {
    const ps = [...this.pieces.values()];
    if (!ps.length) return;
    const box = new THREE.Box3();
    for (const p of ps) box.expandByPoint(p.pos);
    this.flyToPoint(box.getCenter(new THREE.Vector3()), 1);
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

  /* ───────── reprodução de um cenário ───────── */

  setPlay(p: LogicPlay3D | null) {
    const prev = this.play?.cur;
    this.play = p;
    this.fast.clear();
    for (const piece of this.pieces.values()) for (const m of piece.glow) m.emissive.copy(m.userData.glow ?? m.emissive);
    this.token.visible = false;
    this.curRing.visible = false;
    this.dropCard(this.curCard);
    this.curCard = null;
    this.cardData = new Map((p?.cards ?? []).map((c) => [c.at, c]));
    if (p) {
      const now = (p.cards ?? []).find((c) => c.cur);
      if (now) this.curCard = this.mountCard(now);
      // o cartão aberto pelo mouse acompanha o passo (ou some, se a peça ainda não foi percorrida)
      const hov = this.hoverCardId;
      this.closeHoverCard();
      if (hov) this.openHoverCard(hov);
      const w = this.wires.find((x) => x.id === p.curEdge);
      if (w) this.fast.add(w.pulses);
      if (p.cur !== prev) this.playAt = performance.now();
      const cur = p.cur ? this.pieces.get(p.cur) : undefined;
      // no começo do teste a câmera chega perto do primeiro passo; a cada passo novo, centraliza o cartão de debug dele
      if (cur && !prev) this.flyToPoint(cur.pos.clone(), Math.max(this.camera.zoom, 1.5));
      if (cur && p.cur !== prev) this.centerCard = true;
    } else for (const piece of this.pieces.values()) piece.model.position.y = 0;
    this.applyFocus();
  }

  /** Passo atual: a peça brilha e sobe um pouco; a bolinha corre pela seta que levou até ela. */
  private stepPlay() {
    const p = this.play!;
    const t = this.clock.elapsedTime;
    const pulse = reducedMotion() ? 0.6 : 0.5 + 0.5 * Math.sin(t * 4);
    const cur = p.cur ? this.pieces.get(p.cur) : undefined;
    for (const piece of this.pieces.values()) {
      const on = piece === cur;
      piece.model.position.y = on && !reducedMotion() ? 10 * Math.min(1, (performance.now() - this.playAt) / 220) : 0;
      if (on) for (const m of piece.glow) m.emissive.copy(m.color).multiplyScalar(GLOW + 0.15 + 0.45 * pulse);
    }
    this.curRing.visible = !!cur;
    if (cur) {
      this.curRing.position.copy(cur.pos).setY(2.5);
      this.curRing.scale.setScalar(cur.radius * (1.12 + 0.08 * pulse));
      (this.curRing.material as THREE.MeshBasicMaterial).opacity = 0.95 - 0.45 * pulse;
    }
    const w = p.curEdge ? this.wires.find((x) => x.id === p.curEdge) : undefined;
    this.token.visible = !!w && !reducedMotion();
    if (w && this.token.visible) {
      const k = ((performance.now() - this.playAt) / 900) % 1;
      this.token.position.copy(along(w.path, k)).setY(TRACE_Y + 9);
    }
  }

  /* ───────── interação ───────── */

  private onDown = (e: PointerEvent) => {
    this.down = { x: e.clientX, y: e.clientY };
    this.introAnim = null;
    this.controls.mouseButtons.MIDDLE = e.button === 1 && (e.ctrlKey || e.metaKey) ? THREE.MOUSE.DOLLY : THREE.MOUSE.ROTATE;
    this.fly = null;
  };

  private hit(clientX: number, clientY: number): string | undefined {
    const r = this.renderer.domElement.getBoundingClientRect();
    if (clientX < r.left || clientX > r.right || clientY < r.top || clientY > r.bottom) return undefined;
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1), this.camera);
    for (const h of ray.intersectObjects(this.pickables, false)) if (visibleUp(h.object) && h.object.userData.nodeId) return h.object.userData.nodeId as string;
    return undefined;
  }

  private onMove = (e: PointerEvent) => {
    if (e.buttons) return;
    const now = performance.now();
    if (now - this.hoverAt < 40) return;
    this.hoverAt = now;
    const id = this.hit(e.clientX, e.clientY);
    this.renderer.domElement.style.cursor = id ? "pointer" : "";
    this.hover(id);
  };

  /* ───────── cartões de debug ───────── */

  private mountCard(c: DebugCard) {
    const at = this.pieces.get(c.at);
    if (!at) return null;
    const o = new CSS2DObject(this.debugCard(c));
    o.position.copy(at.pos).setY(at.top + 30);
    this.scene.add(o);
    return o;
  }

  private dropCard(o: CSS2DObject | null) {
    if (!o) return;
    o.element.remove();
    this.scene.remove(o);
  }

  /** Mouse sobre uma peça já percorrida (que não é o passo atual): o cartão dela aparece por cima de tudo. */
  private openHoverCard(id: string) {
    window.clearTimeout(this.hideCard);
    if (id === this.hoverCardId && this.hoverCard) return;
    this.closeHoverCard();
    const c = this.play ? this.cardData.get(id) : undefined;
    if (!c || c.cur) return;
    this.hoverCardId = id;
    this.hoverCard = this.mountCard(c);
  }

  private closeHoverCard() {
    window.clearTimeout(this.hideCard);
    this.dropCard(this.hoverCard);
    this.hoverCard = null;
    this.hoverCardId = undefined;
    this.overCard = false;
  }

  /** Some pouco depois que o mouse sai da peça, para dar tempo de ir até o cartão (clicar nele volta àquele passo). */
  private leaveHoverCard() {
    window.clearTimeout(this.hideCard);
    this.hideCard = window.setTimeout(() => !this.overCard && this.closeHoverCard(), 220);
  }

  private hover(id: string | undefined) {
    if (id && this.cardData.has(id)) this.openHoverCard(id);
    else if (this.hoverCard) this.leaveHoverCard();
    const p = id && !this.sel.includes(id) ? this.pieces.get(id) : undefined;
    this.hoverRing.visible = !!p;
    if (p) {
      this.hoverRing.position.copy(p.pos).setY(1.5);
      this.hoverRing.scale.setScalar(p.radius);
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
    if (!d || e.button !== 0 || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 4) return;
    const id = this.hit(e.clientX, e.clientY);
    if (!id) return this.events.onEmpty();
    const now = performance.now();
    const dbl = this.lastClick?.id === id && now - this.lastClick.t < 380;
    this.lastClick = { id, t: now };
    if (dbl && this.pieces.get(id)?.part === "stage") return this.events.onOpenStage(id);
    this.events.onNode(id);
  };

  setSelection(sel: string[]) {
    this.sel = sel;
    for (const [id, p] of this.pieces) p.label.element.dataset.sel = sel.includes(id) ? "1" : "";
    this.declutter = true;
    const hit = sel.map((id) => this.pieces.get(id)).find(Boolean);
    this.selRing.visible = !!hit;
    if (hit) {
      this.selRing.position.copy(hit.pos).setY(2);
      this.selRing.scale.setScalar(hit.radius);
    }
    this.applyFocus();
  }

  setFilter(f: LogicFilter) {
    this.filter = f;
    this.applyFocus();
  }

  /** Reprodução, seleção, apontar e busca: o que fica aceso e o que apaga. */
  private applyFocus() {
    if (this.play) return this.applyPlay(this.play);
    const sel = this.sel.filter((id) => this.pieces.has(id));
    const anchor = this.hoverId && this.pieces.has(this.hoverId) ? [this.hoverId, ...sel] : sel;
    const near = new Set(anchor);
    for (const w of this.wires) if (anchor.includes(w.a) || anchor.includes(w.b)) (near.add(w.a), near.add(w.b));
    const match = this.filter.match ? new Set(this.filter.match) : null;
    const lit = match && anchor.length ? new Set([...match, ...near]) : (match ?? (anchor.length ? near : null));
    for (const [id, p] of this.pieces) {
      const dim = !!lit && !lit.has(id);
      fade(p.mats, dim ? 0.18 : 1);
      p.label.element.classList.toggle("iso3d-dim", dim);
    }
    for (const w of this.wires) {
      const on = anchor.length ? anchor.includes(w.a) || anchor.includes(w.b) : !!match && match.has(w.a) && match.has(w.b);
      const dim = (anchor.length > 0 || !!match) && !on;
      fade(w.mats, dim ? 0.12 : 1);
      if (w.label) w.label.element.classList.toggle("iso3d-dim", dim);
      if (on) this.fast.add(w.pulses);
      else this.fast.delete(w.pulses);
    }
    this.declutter = true;
  }

  private applyPlay(p: LogicPlay3D) {
    const seen = new Set(p.visited);
    for (const [id, piece] of this.pieces) {
      const k = id === p.cur ? 1 : seen.has(id) ? 0.9 : 0.42;
      fade(piece.mats, k);
      piece.label.element.classList.toggle("iso3d-dim", k < 0.6);
      piece.label.element.dataset.sel = id === p.cur ? "1" : "";
    }
    const edges = new Set(p.edges);
    for (const w of this.wires) {
      const k = w.id === p.curEdge ? 1 : edges.has(w.id) ? 0.85 : 0.3;
      fade(w.mats, k);
      if (w.label) w.label.element.classList.toggle("iso3d-dim", k < 0.5);
    }
    this.declutter = true;
  }

  /* ───────── cena ───────── */

  /** Documento: só remonta quando o desenho muda (posições, papéis, setas, etapas). */
  setDoc(doc: Doc) {
    const first = !this.doc;
    this.doc = doc;
    const sig = JSON.stringify([
      doc.groups.map((g) => [g.id, g.x, g.y, g.w, g.h, g.parent, g.label, g.color, g.stage?.collapsed]),
      doc.nodes.map((n) => [n.id, n.x, n.y, n.w, n.h, n.parent, n.label, n.logic?.role, n.logic?.outcome, n.logic?.key, n.logic?.type]),
      doc.connections.map((c) => [c.id, c.from, c.to, c.label, c.logic?.branch, c.logic?.case, c.waypoints]),
    ]);
    if (!first && sig === this.signature) return;
    this.signature = sig;
    this.build(doc, first);
  }

  setOptions(o: LogicOptions) {
    if (o.showData === this.opts.showData) return;
    this.opts = o;
    if (this.doc) this.build(this.doc, false);
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
    this.fast.clear();
    this.pickables = [];
    this.pieces.clear();
    this.wires = [];
  }

  private build(input: Doc, frame: boolean) {
    if (!this.parts) return;
    this.clearContent();
    // etapas recolhidas entram como uma peça (a pilha de pastas); os passos delas saem, e as setas passam a ligar a etapa
    const { doc, stageIds } = layoutView(input);
    const nodes = doc.nodes.filter((n) => n.logic && (this.opts.showData || !(isDataRole(n.logic.role) || n.logic.role === "scenario")));
    const box = new THREE.Box2();
    for (const n of nodes) box.expandByPoint(new THREE.Vector2(n.x, n.y)).expandByPoint(new THREE.Vector2(n.x + n.w, n.y + n.h));
    const zones = doc.groups.filter((g) => !stageIds.has(g.id) && nodes.some((n) => n.parent === g.id));
    for (const g of zones) box.expandByPoint(new THREE.Vector2(g.x, g.y)).expandByPoint(new THREE.Vector2(g.x + g.w, g.y + g.h));
    if (box.isEmpty()) box.set(new THREE.Vector2(0, 0), new THREE.Vector2(400, 300));
    const b = { x: box.min.x - 70, y: box.min.y - 70, w: box.max.x - box.min.x + 140, h: box.max.y - box.min.y + 140 };
    this.addBase(b);
    const depth = (g: GroupEl) => {
      let d = 0;
      for (let p = g.parent; p; p = doc.groups.find((x) => x.id === p)?.parent) d++;
      return d;
    };
    for (const g of zones) this.addZone(g, depth(g));
    for (const n of nodes) this.addPiece(n, stageIds.has(n.id) ? "stage" : n.logic!.role);
    const at = new Map(nodes.map((n) => [n.id, n]));
    const conns = doc.connections.filter((c) => at.has(c.from) && at.has(c.to) && c.from !== c.to);
    // voltas pelo lado de fora: cada uma na sua faixa, para não correrem por cima uma da outra
    let lane = 0;
    for (const c of conns) this.addWire(c, at.get(c.from)!, at.get(c.to)!, () => lane++);
    this.setSelection(this.sel);
    if (this.play) this.setPlay(this.play);
    this.declutter = true;

    if (frame) {
      // vista inicial isométrica (45° em volta, 35° acima), enquadrando o fluxo inteiro
      const cx = b.x + b.w / 2;
      const cy = b.y + b.h / 2;
      const radius = Math.max(300, Math.hypot(b.w, b.h) / 2);
      this.extent = radius * 0.7;
      this.controls.target.set(cx, 0, cy);
      const dist = radius * 3;
      const el = THREE.MathUtils.degToRad(35);
      this.camera.position.set(cx + dist * Math.cos(el) * Math.SQRT1_2, dist * Math.sin(el), cy + dist * Math.cos(el) * Math.SQRT1_2);
      this.camera.zoom = 1;
      this.camera.lookAt(this.controls.target);
      this.resize();
    }
  }

  /** Placa: PCB de cantos arredondados (máscara de solda verde, borda de fibra mais escura) com a grade fina. */
  private addBase(b: { x: number; y: number; w: number; h: number }) {
    const t = THEMES[this.theme];
    const shape = roundRect(b.x, b.y, b.w, b.h, 28);
    const geo = new THREE.ExtrudeGeometry(shape, { depth: SLAB, bevelEnabled: true, bevelThickness: 2, bevelSize: 2, bevelSegments: 1, curveSegments: 8 });
    geo.rotateX(-Math.PI / 2);
    geo.translate(0, -SLAB - 2, 0);
    const top = new THREE.MeshStandardMaterial({ color: new THREE.Color(t.base), roughness: 0.6, metalness: 0.05 });
    const wall = new THREE.MeshStandardMaterial({ color: new THREE.Color(t.wall), roughness: 0.8 });
    this.content.add(new THREE.Mesh(geo, [top, wall]));
    // grade fina (passo de 40 px), com um ponto em cada cruzamento
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    const g = c.getContext("2d")!;
    g.strokeStyle = t.grid;
    g.lineWidth = 1.5;
    g.strokeRect(0, 0, 64, 64);
    g.fillStyle = t.grid;
    for (const [x, y] of [[0, 0], [64, 0], [0, 64], [64, 64]]) g.fillRect(x - 3, y - 3, 6, 6);
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.anisotropy = 8;
    tex.repeat.set((b.w - 60) / 40, (b.h - 60) / 40);
    const grid = new THREE.Mesh(new THREE.PlaneGeometry(b.w - 60, b.h - 60), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
    grid.rotation.x = -Math.PI / 2;
    grid.position.set(b.x + b.w / 2, 0.2, b.y + b.h / 2);
    this.content.add(grid);
    this.trash.push(tex);
  }

  /** Grupo (etapa aberta ou coluna de dados): contorno de serigrafia, a máscara um tom abaixo e o nome no canto. */
  private addZone(g: GroupEl, depth: number) {
    const t = THEMES[this.theme];
    const y = ZONE_Y(depth);
    const shape = roundRect(g.x, g.y, g.w, g.h, 14);
    const geo = new THREE.ShapeGeometry(shape, 8);
    geo.rotateX(-Math.PI / 2);
    const plate = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: new THREE.Color(t.zone), roughness: 0.5 }));
    plate.position.y = y;
    this.content.add(plate);
    const pts = shape.getPoints(8).map((p) => new THREE.Vector3(p.x, y + 0.15, -p.y));
    pts.push(pts[0].clone());
    const color = new THREE.Color(t.wire);
    const mat = g.stage ? new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.7 }) : new THREE.LineDashedMaterial({ color, dashSize: 10, gapSize: 8, transparent: true, opacity: 0.55 });
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), mat);
    if (!g.stage) line.computeLineDistances();
    this.content.add(line);
    this.label(`<span class="iso3d-context logic3d-silk">${esc(g.label.toUpperCase())}</span>`, new THREE.Vector3(g.x + 14, y + 2, g.y + 18), "left");
  }

  /** Peça: o modelo do papel no centro do cartão, na cor do papel (fim com erro em vermelho); nome e papel embaixo. */
  private addPiece(n: NodeEl, part: LogicPart) {
    const role = n.logic!.role;
    const data = isDataRole(role) || role === "scenario";
    const tpl = this.parts!.get(part) ?? this.parts!.get("rule")!;
    const color = part === "stage" ? "#706fd3" : role === "end" && n.logic!.outcome === "erro" ? END_ERROR : LOGIC_ROLES[role].color;
    const inst = instancePart(tpl, { body: BODY.dark, accent: color });
    // o símbolo e o aro brilham de leve na cor do papel (a reprodução acende mais o passo atual)
    for (const m of inst.glow) {
      m.emissive.copy(m.color).multiplyScalar(GLOW);
      m.userData.glow = m.emissive.clone();
    }
    const unit = data ? Math.min(DATA_UNIT, n.h + 8) : FLOW_UNIT;
    inst.obj.scale.setScalar(unit);
    const x = n.x + n.w / 2;
    const y = n.y + n.h / 2;
    const holder = new THREE.Group();
    holder.position.set(x, 0, y);
    holder.add(inst.obj);
    this.content.add(holder);
    // a caixa é medida no mundo: sem atualizar a matriz do holder antes, ela sai na origem e a área de clique da peça
    // (o proxy) fica longe da peça, e nem clique nem hover acertam
    holder.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(inst.obj);
    const size = box.getSize(new THREE.Vector3());
    const radius = Math.max(size.x, size.z) * 0.6;
    const proxy = new THREE.Mesh(new THREE.BoxGeometry(size.x, size.y + 12, size.z), PROXY_MAT);
    proxy.position.copy(box.getCenter(new THREE.Vector3()));
    proxy.userData.nodeId = n.id;
    this.content.add(proxy);
    this.pickables.push(proxy);
    const sub = part === "stage" ? "etapa · duplo clique abre" : data && n.logic!.key ? n.logic!.key : "";
    const name = wrapLabel(n.label, 26, 2).map((l) => esc(truncate(l, 30))).join("<br>");
    const label = this.label(`<span class="iso3d-name logic3d-name" style="--rc:${color}">${name}${sub ? `<small>${esc(truncate(sub, 32))}</small>` : ""}</span>`, new THREE.Vector3(x, 0, y + size.z / 2 + 4), "top", n.id);
    this.pieces.set(n.id, { id: n.id, part, objs: [holder, proxy], model: inst.obj, mats: inst.mats, glow: inst.glow, label, pos: new THREE.Vector3(x, 0, y), radius, top: box.max.y });
  }

  /** Seta: trilha ortogonal na cor da saída, com contorno, pulsos andando no sentido do fluxo e a ponta na chegada. */
  private addWire(c: ConnectionEl, a: NodeEl, b: NodeEl, nextLane: () => number) {
    const pa = this.pieces.get(a.id);
    const pb = this.pieces.get(b.id);
    if (!pa || !pb) return;
    const t = THEMES[this.theme];
    const branch = c.logic?.branch ?? (c.logic?.case ? "caso" : undefined);
    const hex = branch ? BRANCH_COLOR[branch] : t.wire;
    const color = new THREE.Color(hex);
    let pts = route(a, b, c.waypoints, nextLane);
    pts = trimStart(pts, pa.radius * 0.8);
    pts = trimEnd(pts, pb.radius * 0.8 + 2);
    if (pathLength(pts) < ARROW + 6) return;
    pts = chamfer(pts, CHAMFER);
    const g = new THREE.Group();
    const mats: THREE.Material[] = [];
    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, order = 0) => {
      const m = new THREE.Mesh(geo, mat);
      m.renderOrder = order;
      g.add(m);
      if (!mats.includes(mat)) mats.push(mat);
      return m;
    };
    const body = trimEnd(pts, ARROW - 2);
    const pulses = this.pulseTexture();
    const copper = new THREE.MeshStandardMaterial({ color, emissive: color.clone().multiplyScalar(branch ? 0.35 : 0.15), metalness: 0.3, roughness: 0.45 });
    const hole = new THREE.MeshBasicMaterial({ color: new THREE.Color(t.base) });
    add(ribbon(body, HALO_W, TRACE_Y - 0.4, 1 / PULSE_TILE), new THREE.MeshBasicMaterial({ color: new THREE.Color(t.halo), transparent: true, opacity: 0.55, depthWrite: false }));
    add(ribbon(body, TRACE_W, TRACE_Y, 1 / PULSE_TILE), copper);
    add(ribbon(body, TRACE_W, TRACE_Y + 0.3, 1 / PULSE_TILE), new THREE.MeshBasicMaterial({ color: new THREE.Color(branch ? hex : "#ffffff"), map: pulses, transparent: true, opacity: this.theme === "dark" ? 0.45 : 0.6, depthWrite: false, blending: THREE.AdditiveBlending }), 1);
    // um ponto na saída e em cada dobra (cada par de pontos do chanfro é uma dobra): o toque de circuito
    const via = (x: number, y: number, r: number) => {
      const ring = add(new THREE.RingGeometry(r * 0.45, r, 20), copper);
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(x, TRACE_Y + 0.2, y);
      const h = add(new THREE.CircleGeometry(r * 0.45, 16), hole);
      h.rotation.x = -Math.PI / 2;
      h.position.set(x, TRACE_Y + 0.25, y);
    };
    via(pts[0].x, pts[0].y, 7);
    for (let i = 1; i + 1 < pts.length - 1; i += 2) via((pts[i].x + pts[i + 1].x) / 2, (pts[i].y + pts[i + 1].y) / 2, 5);
    const E = pts[pts.length - 1];
    const P = pts[pts.length - 2];
    const dir = new THREE.Vector2(E.x - P.x, E.y - P.y).normalize();
    const tri = new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(-ARROW, 8), new THREE.Vector2(-ARROW, -8)]);
    const arrow = add(new THREE.ShapeGeometry(tri), new THREE.MeshStandardMaterial({ color: new THREE.Color(hex), emissive: new THREE.Color(hex).multiplyScalar(0.3), metalness: 0.5, roughness: 0.4, side: THREE.DoubleSide }));
    arrow.rotation.set(-Math.PI / 2, 0, -Math.atan2(dir.y, dir.x));
    arrow.position.set(E.x, TRACE_Y + 0.4, E.y);
    this.content.add(g);
    // nome da saída (sim, não, o caso…) logo depois da peça de onde sai
    const text = c.label?.trim() || (c.logic?.branch ? LOGIC_BRANCHES[c.logic.branch].label : c.logic?.case ?? "");
    let label: CSS2DObject | undefined;
    if (text) {
      const at = along(pts.map((p) => new THREE.Vector3(p.x, 0, p.y)), Math.min(0.5, 34 / Math.max(1, pathLength(pts))));
      label = this.label(`<span class="iso3d-edge" style="--c:${hex}">${esc(truncate(text, 24))}</span>`, at.setY(12));
    }
    this.wires.push({ id: c.id, a: a.id, b: b.id, group: g, mats, label, pulses, path: pts.map((p) => new THREE.Vector3(p.x, 0, p.y)) });
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

  /**
   * Cartão sempre inteiro na parte livre da tela: acima da peça quando cabe, abaixo dela quando não cabe, e deslizando
   * para o lado perto das bordas (a ponta continua apontando para a peça). O do passo atual, num passo novo, ainda
   * centraliza a tela nele.
   */
  private placeCard(o: CSS2DObject, current: boolean) {
    const box = o.element.firstElementChild as HTMLElement | null;
    if (!box) return;
    o.element.style.zIndex = current ? "100000" : "200000";
    const v = o.position.clone().project(this.camera);
    const W = this.host.clientWidth;
    const H = this.host.clientHeight;
    const x = ((v.x + 1) / 2) * W;
    const y = ((1 - v.y) / 2) * H;
    const w = box.offsetWidth;
    const h = box.offsetHeight;
    const m = 10;
    const top = Math.max(this.insetTop, 0) + m;
    const bottom = H - this.insetBottom - m;
    const left = this.inset + m;
    const right = W - this.insetRight - m;
    if (current && this.centerCard && !this.fly && h) {
      this.centerCard = false;
      // o cartão em cima da peça (a posição normal): o centro dele vai para o centro da área livre; se não couber na
      // altura, o topo dele encosta no topo da área livre
      const cx = x;
      const cy = y - TIP - h / 2;
      const fx = (left + right) / 2;
      const fy = h > bottom - top ? top + h / 2 : (top + bottom) / 2;
      if (Math.abs(cx - fx) > 3 || Math.abs(cy - fy) > 3) {
        const a = this.ground(cx, cy);
        const b = this.ground(fx, fy);
        if (a && b) this.flyToPoint(this.controls.target.clone().add(a.sub(b)), this.camera.zoom);
      }
    }
    // vira para baixo só quando em cima não cabe e embaixo cabe (com folga para a peça e o nome dela)
    const below = y - h - 14 < top && y + BELOW_GAP + h < bottom;
    const dx = Math.round(right - left < w ? 0 : Math.min(Math.max(x - w / 2, left), right - w) - (x - w / 2));
    o.element.classList.toggle("below", below);
    if (o.userData.dx !== dx) {
      o.userData.dx = dx;
      o.element.style.setProperty("--dx", `${dx}px`);
    }
  }

  /** O ponto do plano da câmera (altura do alvo da órbita) que aparece no pixel (x, y) do host. */
  private ground(x: number, y: number): THREE.Vector3 | null {
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2((x / this.host.clientWidth) * 2 - 1, -(y / this.host.clientHeight) * 2 + 1), this.camera);
    return ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -this.controls.target.y), new THREE.Vector3());
  }

  /**
   * O cartão de debug de uma peça, sem abreviar nada: passo, papel, volta do laço, resposta, porquê (com os valores), o
   * que mudou (de → para), o que a trava fez, o que o passo leu e, no fim, os resultados. O de um passo já percorrido
   * (aberto pelo mouse) é igual e, clicado, volta a reprodução àquele passo. Fica fora da arrumação de rótulos.
   */
  private debugCard(c: DebugCard): HTMLElement {
    const el = document.createElement("div");
    el.className = `l3-dbg-wrap${c.cur ? " cur" : ""}`;
    const role = LOGIC_ROLES[c.role];
    const roleName = c.role === "start" ? "Início" : c.role === "end" ? "Fim" : role?.label ?? c.role;
    const visits = c.visits > 1 ? `<i title="passou ${c.visits} vezes por aqui">×${c.visits}</i>` : "";
    // código e valores com realce e formatados na largura do cartão (quebra antes de e/ou, listas e objetos abertos)
    // largura em colunas do código (a do cartão largo)
    const cols = { why: 62, value: 56, read: 54 };
    const code = (src: string, cls = "", width = cols.why) => `<code class="hl${cls}">${codeHtml(src, width)}</code>`;
    const row = (l: DebugCard["lines"][number]) => {
      if (l.kind === "why" || l.kind === "cond")
        return `<li class="why">${l.label ? `<small>${esc(l.label)}</small>` : ""}${code(l.name)}${l.value !== undefined && l.value !== l.name ? `<span class="arrow">↳</span>${code(l.value, " v")}` : ""}</li>`;
      if (l.kind === "chg") return `<li class="chg"><span class="nm">${esc(l.name)}</span>${l.from !== undefined ? `${code(l.from, " old", cols.value)}<em>→</em>` : `<em>=</em>`}${code(l.value ?? "", " new", cols.value)}</li>`;
      if (l.kind === "lock") return `<li class="lock"><span class="nm">${esc(l.name)}</span><em>${l.value === "travou" ? "🔒 travou" : "🔒 travado: não mudou"}</em></li>`;
      return `<li class="${l.kind}"><span class="nm">${esc(l.name)}</span><em>=</em>${code(l.value ?? "", "", cols.read)}</li>`;
    };
    const sec = (title: string, kinds: DebugCard["lines"][number]["kind"][], cls = "") => {
      const ls = c.lines.filter((l) => kinds.includes(l.kind));
      return ls.length ? `<div class="sec${cls}"><h6>${title}</h6><ul>${ls.map(row).join("")}</ul></div>` : "";
    };
    const head = `<header><b>#${c.step + 1}</b><small>${esc(roleName)}</small>${visits}</header>`;
    const turn = c.turn ? `<p class="turn">↻ ${esc(c.turn)}</p>` : "";
    const answer = c.error ? `<p class="err">${esc(c.error)}</p>` : c.answer ? `<p class="ans">→ ${esc(c.answer)}</p>` : "";
    // a condição decide o caminho (decisão, tabela, escolha, laço, falha da chamada); o cálculo são os efeitos que rodaram
    const body = `${sec("Condição", ["cond"])}${sec("Cálculo", ["why"])}${sec("Leu", ["read"])}${sec("Mudou", ["chg", "lock"])}${sec("Resultado", ["out"])}`;
    const foot = c.cur ? "" : `<footer>Clique para ir a este passo</footer>`;
    el.innerHTML = `<span class="l3-dbg ${c.cur ? "cur" : "past"}${c.error ? " bad" : ""}" style="--rc:${role?.color ?? "#8f97a6"}" ${c.cur ? 'role="status"' : `role="button" tabindex="0" title="Ir ao passo ${c.step + 1}"`}>${head}<div class="body"><strong>${esc(c.label)}</strong>${turn}${answer}${body}</div>${foot}</span>`;
    if (!c.cur) {
      const go = () => (this.closeHoverCard(), this.events.onStep?.(c.step));
      const box = el.firstElementChild as HTMLElement;
      box.addEventListener("click", go);
      box.addEventListener("keydown", (e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), go()));
      // o mouse no cartão o mantém aberto; ao sair, some
      box.addEventListener("pointerenter", () => ((this.overCard = true), window.clearTimeout(this.hideCard)));
      box.addEventListener("pointerleave", () => ((this.overCard = false), this.leaveHoverCard()));
    }
    return el;
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

/* ───────── traçado das setas ───────── */

const center = (n: NodeEl): Pt => ({ x: n.x + n.w / 2, y: n.y + n.h / 2 });

/**
 * Caminho ortogonal de centro a centro, como o fluxograma de cima para baixo: para baixo, desce, anda no meio do vão e
 * desce de novo; para o lado, anda no meio do vão horizontal; para cima (a volta de um laço), contorna por fora, pela
 * direita. Com pontos de passagem desenhados no 2D, passa por eles.
 */
export function route(a: NodeEl, b: NodeEl, waypoints: Pt[] | undefined, nextLane: () => number): Pt[] {
  const A = center(a);
  const B = center(b);
  if (waypoints?.length) return orthogonal([A, ...waypoints, B]);
  const gapY = b.y - (a.y + a.h);
  if (gapY > 8) {
    if (Math.abs(A.x - B.x) < 2) return [A, B];
    const mid = a.y + a.h + gapY / 2;
    return [A, { x: A.x, y: mid }, { x: B.x, y: mid }, B];
  }
  const gapX = Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w));
  if (gapX > 8) {
    if (Math.abs(A.y - B.y) < 2) return [A, B];
    const mid = (A.x + B.x) / 2;
    return [A, { x: mid, y: A.y }, { x: mid, y: B.y }, B];
  }
  const lane = Math.max(a.x + a.w, b.x + b.w) + 46 + nextLane() * 18;
  return [A, { x: lane, y: A.y }, { x: lane, y: B.y }, B];
}

/** Entre dois pontos que não se alinham, um canto (primeiro na vertical). */
function orthogonal(pts: Pt[]): Pt[] {
  const out: Pt[] = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const p = out[out.length - 1];
    const q = pts[i];
    if (Math.abs(p.x - q.x) > 1 && Math.abs(p.y - q.y) > 1) out.push({ x: p.x, y: q.y });
    out.push(q);
  }
  return out;
}

/** Encurta a polilinha em `d` px no começo (a seta sai da borda da peça, não do centro). */
function trimStart(pts: Pt[], d: number): Pt[] {
  return trimEnd([...pts].reverse(), d).reverse();
}

/** Corta os cantos a 45° (`r` px de cada lado, no máximo metade dos trechos vizinhos). */
function chamfer(pts: Pt[], r: number): Pt[] {
  if (pts.length < 3) return pts;
  const out: Pt[] = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i - 1];
    const q = pts[i];
    const n = pts[i + 1];
    const l0 = Math.hypot(q.x - p.x, q.y - p.y);
    const l1 = Math.hypot(n.x - q.x, n.y - q.y);
    const k = Math.min(r, l0 / 2, l1 / 2);
    if (k < 1) {
      out.push(q);
      continue;
    }
    out.push({ x: q.x + ((p.x - q.x) / l0) * k, y: q.y + ((p.y - q.y) / l0) * k }, { x: q.x + ((n.x - q.x) / l1) * k, y: q.y + ((n.y - q.y) / l1) * k });
  }
  out.push(pts[pts.length - 1]);
  return out;
}

/** Ponto a uma fração `k` (0 a 1) do comprimento do caminho. */
function along(path: THREE.Vector3[], k: number): THREE.Vector3 {
  const lens = path.slice(1).map((p, i) => p.distanceTo(path[i]));
  let d = lens.reduce((s, l) => s + l, 0) * k;
  for (let i = 0; i < lens.length; i++) {
    if (d <= lens[i] || i === lens.length - 1) return path[i].clone().lerp(path[i + 1], lens[i] ? Math.min(1, d / lens[i]) : 0);
    d -= lens[i];
  }
  return path[0].clone();
}

/** Papel de cada peça (para a legenda): o mesmo da cena. */
export const partOf = (n: NodeEl, stageIds: Set<string>): LogicPart => (stageIds.has(n.id) ? "stage" : (n.logic!.role as LogicRole));
