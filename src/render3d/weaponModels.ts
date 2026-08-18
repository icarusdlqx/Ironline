import {
  BoxGeometry,
  CylinderGeometry,
  Group,
  InstancedMesh,
  Mesh,
  MeshStandardMaterial,
  Object3D,
} from 'three';
import type { MechLocation } from '../schema/common';
import type { Weapon, WeaponType } from '../schema/weapon';
import { chamferedBox } from './panels';

export interface MountArt {
  weaponId: string;
  location: MechLocation;
  type: WeaponType;
  tonnage: number;
  projectiles: number;
  recoil: number;
  visual: Weapon['visual'];
}

export type WeaponModelFamily =
  | 'beam'
  | 'pulse'
  | 'projector'
  | 'flame'
  | 'cannon'
  | 'rapid-cannon'
  | 'rotary-cannon'
  | 'scatter-cannon'
  | 'rail'
  | 'missile-flat'
  | 'missile-loft'
  | 'missile-seeker'
  | 'missile-heavy';

export interface WeaponRig {
  weaponId: string;
  visual: Weapon['visual'];
  slide: Group;
  muzzle: Object3D;
  kick: number;
  travel: number;
}

export interface WeaponModel {
  root: Group;
  rig: WeaponRig;
}

const INSTANCE = new Object3D();

/** Catalogue prose may change; ids and authored shot style are the stable construction cues. */
export function weaponModelFamily(
  mount: Pick<MountArt, 'weaponId' | 'type' | 'projectiles' | 'visual'>,
): WeaponModelFamily {
  if (mount.type === 'energy') {
    if (mount.visual.style === 'pulse' || mount.weaponId.includes('pulse')) return 'pulse';
    if (mount.visual.style === 'bolt' || mount.weaponId.includes('ppc')) return 'projector';
    if (mount.visual.style === 'flame' || mount.weaponId.includes('flamer')) return 'flame';
    return 'beam';
  }

  if (mount.type === 'ballistic') {
    if (mount.visual.style === 'slug' || mount.weaponId.includes('gauss')) return 'rail';
    if (mount.weaponId.startsWith('rotary_') || mount.weaponId === 'machine_gun') {
      return 'rotary-cannon';
    }
    if (mount.weaponId.startsWith('ultra_')) return 'rapid-cannon';
    if (mount.weaponId.startsWith('lbx_')) return 'scatter-cannon';
    return 'cannon';
  }

  if (mount.projectiles === 1 || mount.weaponId.startsWith('thunderbolt')) return 'missile-heavy';
  if (mount.weaponId.startsWith('streak_')) return 'missile-seeker';
  if (mount.visual.arc >= 30 || mount.weaponId.startsWith('lrm')) return 'missile-loft';
  return 'missile-flat';
}

export function buildWeaponModel(
  mount: MountArt,
  heft: number,
  scale: number,
  material: MeshStandardMaterial,
  boreMaterial: MeshStandardMaterial,
): WeaponModel {
  const root = new Group();
  const family = weaponModelFamily(mount);
  let muzzleX: number;

  if (family.startsWith('missile-')) {
    muzzleX = missileRack(root, mount, family, heft, scale, material, boreMaterial);
  } else if (mount.type === 'energy') {
    muzzleX = energyWeapon(root, mount, family, heft, scale, material, boreMaterial);
  } else {
    muzzleX = ballisticWeapon(root, mount, family, heft, scale, material, boreMaterial);
  }

  const muzzle = new Object3D();
  muzzle.name = `muzzle:${mount.weaponId}`;
  muzzle.position.x = muzzleX;
  root.add(muzzle);

  return {
    root,
    rig: {
      weaponId: mount.weaponId,
      visual: mount.visual,
      slide: root,
      muzzle,
      kick: 0,
      travel: scale * mount.recoil * 0.28,
    },
  };
}

export function triggerWeaponRecoil(rig: WeaponRig): void {
  rig.kick = Math.max(rig.kick, rig.travel);
  rig.slide.position.x = -rig.kick;
}

/** Recoil owns one scalar and the existing transform; a firefight creates no animation garbage. */
export function advanceWeaponRecoil(rig: WeaponRig, deltaSeconds: number): void {
  rig.kick *= Math.exp(-Math.max(0, deltaSeconds) * 13);
  if (rig.kick < 0.005) rig.kick = 0;
  rig.slide.position.x = -rig.kick;
}

function energyWeapon(
  root: Group,
  mount: MountArt,
  family: WeaponModelFamily,
  heft: number,
  scale: number,
  material: MeshStandardMaterial,
  boreMaterial: MeshStandardMaterial,
): number {
  const bore = 0.055 * heft * scale;
  const length = 0.8 * heft * scale;
  const housing = new Mesh(chamferedBox(length * 0.38, bore * 3.6, bore * 3.6), material);
  housing.position.x = -length * 0.2;
  root.add(housing);

  if (family === 'pulse') {
    const barrels = barrelCluster(
      3,
      bore * 0.72,
      length * 0.5,
      boreMaterial,
      bore * 1.35,
      bore * 1.35,
    );
    barrels.position.x = length * 0.18;
    root.add(barrels);
    addMuzzleRing(root, length * 0.48, bore * 1.55, boreMaterial);
    return length * 0.5;
  }

  if (family === 'projector') {
    const coil = new Mesh(
      new CylinderGeometry(bore * 1.7, bore * 1.7, length * 0.5, 12),
      glowMaterial(mount.visual),
    );
    coil.rotation.z = -Math.PI / 2;
    coil.position.x = length * 0.12;
    root.add(coil);
    const prongs = boxPair(length * 0.42, bore * 0.65, bore * 0.85, material, bore * 2.3);
    prongs.position.x = length * 0.34;
    root.add(prongs);
    return length * 0.58;
  }

  if (family === 'flame') {
    const nozzle = new Mesh(
      new CylinderGeometry(bore * 1.8, bore * 0.85, length * 0.5, 12),
      boreMaterial,
    );
    nozzle.rotation.z = -Math.PI / 2;
    nozzle.position.x = length * 0.22;
    root.add(nozzle);
    addMuzzleRing(root, length * 0.49, bore * 2, material);
    return length * 0.52;
  }

  const emitter = new Mesh(
    new CylinderGeometry(bore * 0.72, bore, length * 0.72, 12),
    glowMaterial(mount.visual),
  );
  emitter.rotation.z = -Math.PI / 2;
  emitter.position.x = length * 0.22;
  root.add(emitter);
  addMuzzleRing(root, length * 0.59, bore * 1.25, boreMaterial);
  return length * 0.62;
}

function ballisticWeapon(
  root: Group,
  mount: MountArt,
  family: WeaponModelFamily,
  heft: number,
  scale: number,
  material: MeshStandardMaterial,
  boreMaterial: MeshStandardMaterial,
): number {
  const bore = 0.085 * heft * scale;
  const length = 0.95 * heft * scale;
  const housing = new Mesh(chamferedBox(length * 0.42, bore * 3.5, bore * 3.7), material);
  housing.position.x = -length * 0.22;
  root.add(housing);

  if (family === 'rail') {
    const rails = boxPair(length * 0.72, bore * 0.52, bore * 0.7, material, bore * 2.4);
    rails.position.x = length * 0.24;
    root.add(rails);
    const core = new Mesh(
      new CylinderGeometry(bore * 0.35, bore * 0.35, length * 0.68, 8),
      glowMaterial(mount.visual),
    );
    core.rotation.z = -Math.PI / 2;
    core.position.x = length * 0.25;
    root.add(core);
    return length * 0.62;
  }

  if (family === 'rotary-cannon' || family === 'rapid-cannon') {
    const count = family === 'rotary-cannon' ? 3 : 2;
    const barrels = barrelCluster(count, bore * 0.5, length * 0.72, material, bore * 1.15, bore * 1.15);
    barrels.position.x = length * 0.22;
    root.add(barrels);
    addMuzzleRing(root, length * 0.59, bore * 1.7, boreMaterial);
    return length * 0.62;
  }

  const barrel = new Mesh(new CylinderGeometry(bore * 0.82, bore, length * 0.74, 12), material);
  barrel.rotation.z = -Math.PI / 2;
  barrel.position.x = length * 0.23;
  root.add(barrel);

  if (family === 'scatter-cannon') {
    const ports = barrelCluster(4, bore * 0.28, bore * 0.8, boreMaterial, bore * 0.85, bore * 0.85);
    ports.position.x = length * 0.61;
    root.add(ports);
    return length * 0.66;
  }

  addMuzzleRing(root, length * 0.61, bore * 1.25, boreMaterial);
  return length * 0.65;
}

function missileRack(
  root: Group,
  mount: MountArt,
  family: WeaponModelFamily,
  heft: number,
  scale: number,
  material: MeshStandardMaterial,
  boreMaterial: MeshStandardMaterial,
): number {
  const count = Math.max(1, Math.min(40, mount.projectiles));
  const columns = Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / columns);
  const cell = family === 'missile-heavy' ? 0.25 : 0.15;
  const height = Math.max(0.28, rows * cell) * scale;
  const width = Math.max(0.28, columns * cell) * scale;
  const depth = (family === 'missile-loft' ? 0.46 : 0.34) * heft * scale;
  root.add(new Mesh(chamferedBox(depth, height, width), material));

  const bore = Math.min(height / rows, width / columns) * 0.31;
  const geometry = new CylinderGeometry(bore, bore, 0.08 * scale, 6);
  const tubes = new InstancedMesh(geometry, boreMaterial, count);
  tubes.name = 'missile-tubes';
  for (let index = 0; index < count; index += 1) {
    const row = Math.floor(index / columns);
    const column = index % columns;
    const y = rows === 1 ? 0 : (row / (rows - 1) - 0.5) * height * 0.68;
    const z = columns === 1 ? 0 : (column / (columns - 1) - 0.5) * width * 0.68;
    INSTANCE.position.set(depth * 0.53, y, z);
    INSTANCE.rotation.set(0, 0, -Math.PI / 2);
    INSTANCE.scale.set(1, 1, 1);
    INSTANCE.updateMatrix();
    tubes.setMatrixAt(index, INSTANCE.matrix);
  }
  tubes.instanceMatrix.needsUpdate = true;
  root.add(tubes);

  if (family === 'missile-seeker') {
    const seeker = new Mesh(chamferedBox(depth * 0.16, height * 0.2, width * 0.72), material);
    seeker.position.set(-depth * 0.42, height * 0.42, 0);
    root.add(seeker);
  }
  return depth * 0.58;
}

function barrelCluster(
  count: number,
  radius: number,
  length: number,
  material: MeshStandardMaterial,
  yRadius: number,
  zRadius: number,
): InstancedMesh {
  const cluster = new InstancedMesh(
    new CylinderGeometry(radius, radius, length, 10),
    material,
    count,
  );
  for (let index = 0; index < count; index += 1) {
    const angle = (index / count) * Math.PI * 2;
    INSTANCE.position.set(0, Math.sin(angle) * yRadius, Math.cos(angle) * zRadius);
    INSTANCE.rotation.set(0, 0, -Math.PI / 2);
    INSTANCE.scale.set(1, 1, 1);
    INSTANCE.updateMatrix();
    cluster.setMatrixAt(index, INSTANCE.matrix);
  }
  cluster.instanceMatrix.needsUpdate = true;
  return cluster;
}

function boxPair(
  length: number,
  height: number,
  depth: number,
  material: MeshStandardMaterial,
  separation: number,
): InstancedMesh {
  const pair = new InstancedMesh(new BoxGeometry(length, height, depth), material, 2);
  for (let index = 0; index < 2; index += 1) {
    INSTANCE.position.set(0, 0, (index === 0 ? -1 : 1) * separation * 0.5);
    INSTANCE.rotation.set(0, 0, 0);
    INSTANCE.scale.set(1, 1, 1);
    INSTANCE.updateMatrix();
    pair.setMatrixAt(index, INSTANCE.matrix);
  }
  pair.instanceMatrix.needsUpdate = true;
  return pair;
}

function addMuzzleRing(
  root: Group,
  x: number,
  radius: number,
  material: MeshStandardMaterial,
): void {
  const ring = new Mesh(new CylinderGeometry(radius, radius, radius * 0.8, 12), material);
  ring.rotation.z = -Math.PI / 2;
  ring.position.x = x;
  root.add(ring);
}

function glowMaterial(visual: Weapon['visual']): MeshStandardMaterial {
  const colour = parseInt(visual.colour.slice(1), 16);
  return new MeshStandardMaterial({
    color: colour,
    emissive: colour,
    emissiveIntensity: 0.7,
    roughness: 0.28,
    metalness: 0.36,
  });
}
