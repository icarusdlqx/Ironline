import {
  Mesh,
  MeshBasicMaterial,
  SphereGeometry,
} from 'three';
import { chassisBlueprint } from '../../render/blueprint';
import { radiusFor } from '../../render/shape';
import { LOCATIONS, type MechLocation } from '../../schema/common';
import type { Chassis } from '../../schema/chassis';
import type { Design } from '../../schema/design';
import type { Catalog } from '../../schema/load';
import {
  buildMechModel,
  disposeModel,
  type MechModel,
  type MountArt,
} from '../../render3d/mechModel';
import { advanceStartupSequence, setStartupPowered } from '../../render3d/startupLights';

const BAY_COLOUR = 0x78c9ff;
const MARKER_COLOUR = 0x60727e;
const COMPATIBLE_COLOUR = 0x78c9ff;
const SELECTED_COLOUR = 0xffc857;
const HOVERED_COLOUR = 0xffffff;

export interface PreviewHighlights {
  selected: MechLocation | null;
  hovered: MechLocation | null;
  compatible: ReadonlySet<MechLocation>;
}

export type PreviewMarker = Mesh<SphereGeometry, MeshBasicMaterial> & {
  userData: { hardpointLocation: MechLocation };
};

export interface PreviewModel {
  readonly key: string;
  readonly model: MechModel;
  readonly markers: readonly PreviewMarker[];
  dispose(): void;
}

/** Cosmetic refits do not rebuild geometry; only visible construction does. */
export function previewModelKey(chassis: Chassis, design: Design): string {
  return JSON.stringify([
    chassis.id,
    design.mounts.map((mount) => [mount.weaponId, mount.location]),
  ]);
}

function mountArt(catalog: Catalog, design: Design): MountArt[] {
  return design.mounts.map((mount) => {
    const weapon = catalog.weapons.get(mount.weaponId);
    if (weapon === undefined) throw new Error(`unknown preview weapon "${mount.weaponId}"`);
    return {
      weaponId: weapon.id,
      location: mount.location,
      type: weapon.type,
      tonnage: weapon.tonnage,
      projectiles: weapon.projectiles,
      recoil: weapon.recoil,
      visual: weapon.visual,
    };
  });
}

function hasWeaponHardpoint(chassis: Chassis, location: MechLocation): boolean {
  const hardpoint = chassis.hardpoints[location];
  return hardpoint.energy + hardpoint.ballistic + hardpoint.missile > 0;
}

function markerMaterial(): MeshBasicMaterial {
  return new MeshBasicMaterial({
    color: MARKER_COLOUR,
    depthTest: false,
    depthWrite: false,
    opacity: 0.34,
    transparent: true,
  });
}

/** Builds the battlefield machine once, then adds at most one marker per location. */
export function buildPreviewModel(catalog: Catalog, chassis: Chassis, design: Design): PreviewModel {
  const model = buildMechModel(
    chassis.silhouette,
    chassis.traits,
    chassis.tonnage,
    BAY_COLOUR,
    false,
    mountArt(catalog, design),
    new Set(),
    chassis.hardpoints,
    chassis.id,
    {},
    chassis.faction,
  );

  if (model.startup !== null) {
    setStartupPowered(model, true);
    advanceStartupSequence(model, 0, true);
  }

  const plan = chassisBlueprint(
    chassis.silhouette,
    chassis.traits,
    chassis.hardpoints,
    chassis.id,
  );
  const scale = radiusFor(chassis.tonnage);
  const geometry = new SphereGeometry(scale * 0.095, 10, 7);
  const markers: PreviewMarker[] = [];

  for (const location of LOCATIONS) {
    const anchor = plan.hardpoints[location];
    if (anchor === undefined || !hasWeaponHardpoint(chassis, location)) continue;
    const marker = new Mesh(geometry, markerMaterial()) as PreviewMarker;
    marker.position.set(anchor[0] * scale, anchor[1] * scale, anchor[2] * scale);
    marker.renderOrder = 20;
    marker.userData.hardpointLocation = location;
    model.torso.add(marker);
    markers.push(marker);
  }

  let disposed = false;
  return {
    key: previewModelKey(chassis, design),
    model,
    markers,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      disposeModel(model.root);
    },
  };
}

function paintMarker(
  marker: PreviewMarker,
  colour: number,
  opacity: number,
  scale: number,
): void {
  marker.material.color.setHex(colour);
  marker.material.opacity = opacity;
  marker.scale.setScalar(scale);
}

export function setPreviewHighlights(model: PreviewModel, highlights: PreviewHighlights): void {
  for (const marker of model.markers) {
    const location = marker.userData.hardpointLocation;
    if (location === highlights.hovered) paintMarker(marker, HOVERED_COLOUR, 1, 1.35);
    else if (location === highlights.selected) paintMarker(marker, SELECTED_COLOUR, 0.96, 1.22);
    else if (highlights.compatible.has(location)) {
      paintMarker(marker, COMPATIBLE_COLOUR, 0.76, 1.08);
    } else paintMarker(marker, MARKER_COLOUR, 0.34, 1);
  }
}
