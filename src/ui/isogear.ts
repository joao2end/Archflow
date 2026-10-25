/**
 * Componentes da visão 3D como arte abstrata de triângulos: uma base em bloco isométrico (hexágono baixo) e, em cima, um
 * único objeto low-poly facetado com a silhueta do papel. Tudo é gerado aqui (sem modelos externos), em poucos triângulos.
 *
 * Cada triângulo recebe um tom próprio, levemente variado e sempre o mesmo para o mesmo papel (cores de vértice que
 * multiplicam a cor do material), e as faces de cima ficam mais claras: com sombreamento chapado, o resultado lembra um
 * mosaico de triângulos. A cor vem do material (a do papel na escultura, a do corpo do tema na base).
 *
 * Unidades: 1 = UNIT px do diagrama; a base fica entre y = 0 e BASE_H, a escultura apoiada nela.
 */
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

export const BASE_H = 0.06;
/**
 * Cor da base: grafite escuro e neutro, com só um toque da cor do papel. Contrasta com qualquer camada (o amarelo de
 * Entities, o vermelho de Use Cases, o verde e o azul) nos dois temas, e deixa o objeto colorido em cima se destacar.
 */
export function baseColor(theme: "light" | "dark", roleColor: string) {
  const a = new THREE.Color(theme === "dark" ? "#1b1e25" : "#363c48").getRGB({ r: 0, g: 0, b: 0 }, THREE.SRGBColorSpace);
  const b = new THREE.Color(roleColor).getRGB({ r: 0, g: 0, b: 0 }, THREE.SRGBColorSpace);
  const k = 0.12;
  return new THREE.Color().setRGB(a.r + (b.r - a.r) * k, a.g + (b.g - a.g) * k, a.b + (b.b - a.b) * k, THREE.SRGBColorSpace);
}
const BASE_R = 0.4;
/** maior lado de um triângulo do mosaico: faces maiores são repartidas até caberem */
const TILE = 0.085;

export interface GearShape {
  base: THREE.BufferGeometry;
  sculpt: THREE.BufferGeometry;
  /** onde o ícone do papel fica (no tampo da base, no canto voltado para a vista inicial) */
  icon: { x: number; z: number; size: number };
}

/**
 * Reparte cada triângulo pelo lado mais longo até todos terem lados ≤ TILE. Os pedaços ficam no mesmo plano (a forma não
 * muda); com um tom por pedaço, cada face vira um mosaico de triângulos.
 */
function tessellate(pos: Float32Array | number[]): number[] {
  const out: number[] = [];
  const v = (i: number) => new THREE.Vector3(pos[i], pos[i + 1], pos[i + 2]);
  const split = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, depth: number) => {
    const ab = a.distanceTo(b);
    const bc = b.distanceTo(c);
    const ca = c.distanceTo(a);
    const longest = Math.max(ab, bc, ca);
    if (longest <= TILE || depth > 8) return void out.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
    // corta o lado mais longo no meio (mantém a ordem dos vértices, e com ela o lado de fora da face)
    if (longest === ab) {
      const m = a.clone().lerp(b, 0.5);
      split(a, m, c, depth + 1);
      split(m, b, c, depth + 1);
    } else if (longest === bc) {
      const m = b.clone().lerp(c, 0.5);
      split(a, b, m, depth + 1);
      split(a, m, c, depth + 1);
    } else {
      const m = c.clone().lerp(a, 0.5);
      split(a, b, m, depth + 1);
      split(m, b, c, depth + 1);
    }
  };
  for (let i = 0; i < pos.length; i += 9) split(v(i), v(i + 3), v(i + 6), 0);
  return out;
}

/** Geometria pronta para o mosaico: sem índice, só posição, normal da face e a cor (tom) de cada triângulo. */
function facet(geo: THREE.BufferGeometry, seed: number, spread = 0.3) {
  const flat = geo.index ? geo.toNonIndexed() : geo;
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(tessellate(flat.attributes.position.array as Float32Array), 3));
  g.computeVertexNormals(); // sem índice: cada triângulo fica com a normal da própria face (chapado)
  const pos = g.attributes.position;
  const nor = g.attributes.normal;
  const col = new Float32Array(pos.count * 3);
  let s = seed % 2147483647 || 1;
  const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < pos.count; i += 3) {
    // tom do triângulo: variação aleatória (determinística) e o tampo mais claro, como um bloco isométrico
    const ny = (nor.getY(i) + nor.getY(i + 1) + nor.getY(i + 2)) / 3;
    const k = (1 - spread / 2 + rnd() * spread) * (ny > 0.6 ? 1.15 : ny < -0.6 ? 0.7 : 1);
    for (let j = 0; j < 3; j++) col.set([k, k, k], (i + j) * 3);
  }
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  return g;
}

/** Junta as peças (já posicionadas) num só desenho facetado. */
function sculpt(seed: number, parts: THREE.BufferGeometry[]) {
  return mergeGeometries(
    parts.map((p, i) => facet(p, seed * 31 + i * 7919)),
    false,
  )!;
}

/** Apoia a peça no tampo da base (o ponto mais baixo encosta nele), centrada. */
function rest(g: THREE.BufferGeometry) {
  g.computeBoundingBox();
  const bb = g.boundingBox!;
  return g.translate(-(bb.min.x + bb.max.x) / 2, BASE_H - bb.min.y, -(bb.min.z + bb.max.z) / 2);
}
/** sólido de revolução com `n` lados a partir do perfil [raio, altura] (de baixo para cima, fechado no eixo) */
const lathe = (profile: [number, number][], n: number) => new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), n);
const prism = (r: number, h: number, n: number) => new THREE.CylinderGeometry(r, r, h, n);
const pyramid = (r: number, h: number, n: number) => new THREE.ConeGeometry(r, h, n);

/** Um objeto inteiro por papel, sobre a base; o tipo se reconhece pela silhueta. */
const SHAPES: Record<string, () => THREE.BufferGeometry> = {
  // aggregate root: cristal alto de seis faces (a raiz que guarda o conjunto)
  "aggregate-root": () => lathe([[0, 0], [0.13, 0.08], [0.17, 0.42], [0, 0.72]], 6),
  // entity: cubo apoiado numa face (algo com identidade e forma estável); alinhado aos eixos, a vista isométrica mostra
  // duas faces e o topo
  entity: () => new THREE.BoxGeometry(0.32, 0.32, 0.32),
  // value object: gema lapidada (valor, sem identidade)
  "value-object": () => lathe([[0, 0], [0.22, 0.24], [0.15, 0.36], [0, 0.36]], 8),
  // domain service: dodecaedro (regra pura, sem estado)
  "domain-service": () => new THREE.DodecahedronGeometry(0.22, 0),
  // domain event: estilhaço alto de três faces (um fato que aconteceu)
  "domain-event": () => pyramid(0.21, 0.72, 3),
  // use case: esfera facetada (o objetivo)
  "use-case": () => new THREE.IcosahedronGeometry(0.23, 0),
  // command: ponta de seta deitada (uma ordem que vai adiante)
  command: () => {
    const sh = new THREE.Shape([new THREE.Vector2(-0.24, -0.2), new THREE.Vector2(0.28, 0), new THREE.Vector2(-0.24, 0.2), new THREE.Vector2(-0.12, 0)]);
    return new THREE.ExtrudeGeometry(sh, { depth: 0.16, bevelEnabled: false }).rotateX(-Math.PI / 2).rotateY(Math.PI / 4);
  },
  // application service: prisma triangular em pé (orquestra os passos)
  "application-service": () => prism(0.24, 0.36, 3),
  // policy: pirâmide de cinco lados (regra que decide)
  policy: () => pyramid(0.25, 0.52, 5),
  // process manager (saga): anel de triângulos em pé (um ciclo que acompanha o processo)
  "process-manager": () => new THREE.TorusGeometry(0.17, 0.08, 3, 8).rotateY(Math.PI / 4),
  // repository: tambor hexagonal com o tampo chanfrado (o banco)
  repository: () => lathe([[0, 0], [0.22, 0], [0.22, 0.34], [0.17, 0.4], [0, 0.4]], 6),
  // read model: pirâmide invertida (uma vista que se abre para cima)
  "read-model": () => pyramid(0.25, 0.42, 4).rotateX(Math.PI).rotateY(Math.PI / 4),
  // controller: portal (um arco em Π) com a abertura voltada para a vista: a porta por onde o pedido de fora entra
  controller: () => {
    const sh = new THREE.Shape([[-0.22, 0], [-0.22, 0.42], [0.22, 0.42], [0.22, 0], [0.11, 0], [0.11, 0.27], [-0.11, 0.27], [-0.11, 0]].map(([x, y]) => new THREE.Vector2(x, y)));
    return new THREE.ExtrudeGeometry(sh, { depth: 0.16, bevelEnabled: false }).translate(0, 0, -0.08).rotateY(Math.PI / 4 + 0.5);
  },
  // ator: peão de seis faces (uma pessoa)
  actor: () => lathe([[0, 0], [0.19, 0], [0.08, 0.3], [0.13, 0.4], [0.1, 0.52], [0, 0.56]], 6),
  // sistema (outro diagrama): monólito de pé
  system: () => new THREE.BoxGeometry(0.22, 0.56, 0.3),
  // sistema externo: tetraedro apoiado numa face (algo de fora)
  external: () => new THREE.TetrahedronGeometry(0.3, 0).rotateX(Math.atan(Math.SQRT2) + Math.PI / 2).rotateY(Math.PI / 12),
};

const cache = new Map<string, GearShape>();

/** Base e escultura do papel (as geometrias são compartilhadas: quem usa não deve descartá-las). */
export function gearShape(role: string): GearShape {
  const hit = cache.get(role);
  if (hit) return hit;
  const seed = [...role].reduce((h, c) => (h * 33 + c.charCodeAt(0)) % 100003, 7);
  const base = sculpt(seed + 1, [new THREE.CylinderGeometry(BASE_R, BASE_R + 0.04, BASE_H, 6).rotateY(Math.PI / 6).translate(0, BASE_H / 2, 0)]);
  const shape: GearShape = { base, sculpt: sculpt(seed, [rest((SHAPES[role] ?? SHAPES.external)())]), icon: { x: 0.2, z: 0.2, size: 0.14 } };
  cache.set(role, shape);
  return shape;
}
