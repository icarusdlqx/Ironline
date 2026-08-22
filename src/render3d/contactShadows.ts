import {
  CircleGeometry,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  Quaternion,
  ShaderMaterial,
  Vector3,
} from 'three';
import type { Vec2 } from '../sim/types';
import { disposeObjectResources } from './sceneResources';

const UP = new Vector3(0, 1, 0);
const NORMAL = new Vector3();
const AT = new Vector3();
const SIZE = new Vector3();
const ALIGN = new Quaternion();
const YAW = new Quaternion();
const TURN = new Quaternion();
const MATRIX = new Matrix4();

const VERTEX_SHADER = `
  attribute float shadowStrength;
  varying vec2 shadowUv;
  varying float strength;

  void main() {
    shadowUv = uv;
    strength = shadowStrength;
    gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
  }
`;

const FRAGMENT_SHADER = `
  varying vec2 shadowUv;
  varying float strength;

  void main() {
    float fromCentre = length((shadowUv - vec2(0.5)) * 2.0);
    float feather = 1.0 - smoothstep(0.08, 1.0, fromCentre);
    float opacity = feather * feather * 0.34 * strength;
    if (opacity < 0.004) discard;
    gl_FragColor = vec4(0.015, 0.018, 0.02, opacity);
  }
`;

export function contactShadowStrength(lift: number, radius: number): number {
  const jump = Math.max(0, Math.min(1, lift / Math.max(1, radius * 2.2)));
  return 1 - jump * 0.86;
}

/** Low FX drops the shadow map, so this fixed pool keeps the machines planted. */
export class ContactShadowLayer {
  readonly mesh: InstancedMesh;

  private readonly strength: InstancedBufferAttribute;
  private used = 0;
  private disposed = false;

  constructor(
    private readonly heightAt: (x: number, y: number) => number,
    private readonly capacity = 96,
  ) {
    const geometry = new CircleGeometry(1, 24);
    geometry.rotateX(-Math.PI / 2);
    this.strength = new InstancedBufferAttribute(new Float32Array(capacity), 1);
    geometry.setAttribute('shadowStrength', this.strength);

    const material = new ShaderMaterial({
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      transparent: true,
      depthWrite: false,
    });
    this.mesh = new InstancedMesh(geometry, material, capacity);
    this.mesh.name = 'contact-shadows';
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
  }

  begin(): void {
    if (this.disposed) return;
    this.used = 0;
  }

  place(at: Vec2, radius: number, facing: number, lift: number): void {
    if (this.disposed || this.used >= this.capacity) return;

    const reach = Math.max(3, radius * 0.4);
    const east = this.heightAt(at.x + reach, at.y);
    const west = this.heightAt(at.x - reach, at.y);
    const south = this.heightAt(at.x, at.y + reach);
    const north = this.heightAt(at.x, at.y - reach);
    NORMAL.set(-(east - west) / (reach * 2), 1, -(south - north) / (reach * 2)).normalize();
    ALIGN.setFromUnitVectors(UP, NORMAL);
    YAW.setFromAxisAngle(UP, -facing);
    TURN.copy(ALIGN).multiply(YAW);

    const jump = 1 - contactShadowStrength(lift, radius);
    AT.set(at.x, this.heightAt(at.x, at.y) + 0.42, at.y);
    SIZE.set(radius * (1.12 + jump * 0.22), 1, radius * (0.76 + jump * 0.16));
    this.mesh.setMatrixAt(this.used, MATRIX.compose(AT, TURN, SIZE));
    this.strength.setX(this.used, contactShadowStrength(lift, radius));
    this.used += 1;
  }

  commit(): void {
    if (this.disposed) return;
    this.mesh.count = this.used;
    if (this.used === 0) return;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.strength.needsUpdate = true;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    disposeObjectResources(this.mesh);
    this.used = 0;
    this.mesh.count = 0;
  }
}
