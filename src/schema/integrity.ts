import { LOCATIONS, type MechLocation } from './common';
import type { Catalog, ContentIssue } from './load';

type Push = (file: string, path: string, message: string) => void;

function checkDesigns(catalog: Catalog, push: Push): void {
  for (const design of catalog.designs.values()) {
    const file = `designs/${design.id}.json`;
    const chassis = catalog.chassis.get(design.chassisId);

    if (chassis === undefined) {
      push(file, 'chassisId', `unknown chassis "${design.chassisId}"`);
      continue;
    }

    if (design.heatSinks < chassis.internalHeatSinks) {
      push(
        file,
        'heatSinks',
        `${chassis.name} carries ${chassis.internalHeatSinks} internal heat sinks; a design cannot fit fewer`,
      );
    }

    if (catalog.equipment.get(design.heatSinkId)?.category !== 'heat_sink') {
      push(file, 'heatSinkId', `"${design.heatSinkId}" is not a heat sink`);
    }

    for (const location of LOCATIONS) {
      if (design.armour[location] > chassis.armourMax[location]) {
        push(
          file,
          `armour.${location}`,
          `${design.armour[location]} exceeds the chassis maximum of ${chassis.armourMax[location]}`,
        );
      }
    }

    const used = new Map<MechLocation, { energy: number; ballistic: number; missile: number }>();
    for (const mount of design.mounts) {
      const weapon = catalog.weapons.get(mount.weaponId);
      if (weapon === undefined) {
        push(file, 'mounts', `unknown weapon "${mount.weaponId}"`);
        continue;
      }
      const counts = used.get(mount.location) ?? { energy: 0, ballistic: 0, missile: 0 };
      counts[weapon.type] += 1;
      used.set(mount.location, counts);
    }

    for (const [location, counts] of used) {
      const available = chassis.hardpoints[location];
      for (const type of ['energy', 'ballistic', 'missile'] as const) {
        if (counts[type] > available[type]) {
          push(
            file,
            `mounts.${location}`,
            `${counts[type]} ${type} weapons need ${counts[type]} hardpoints, chassis has ${available[type]}`,
          );
        }
      }
    }

    const mountedWeapons = new Set(design.mounts.map((mount) => mount.weaponId));
    for (const load of design.ammo) {
      const weapon = catalog.weapons.get(load.weaponId);
      if (weapon === undefined) {
        push(file, 'ammo', `unknown weapon "${load.weaponId}"`);
        continue;
      }
      if (weapon.ammoPerTon === null) {
        push(file, 'ammo', `${weapon.name} uses no ammo`);
      }
      if (!mountedWeapons.has(load.weaponId)) {
        push(file, 'ammo', `${weapon.name} ammo carried but the weapon is not mounted`);
      }
    }

    for (const mount of design.mounts) {
      const weapon = catalog.weapons.get(mount.weaponId);
      if (weapon === undefined || weapon.ammoPerTon === null) continue;
      if (!design.ammo.some((load) => load.weaponId === mount.weaponId)) {
        push(file, 'mounts', `${weapon.name} is mounted with no ammo allocated`);
      }
    }

    for (const fit of design.equipment) {
      if (!catalog.equipment.has(fit.equipmentId)) {
        push(file, 'equipment', `unknown equipment "${fit.equipmentId}"`);
      }
    }
  }
}

function checkMissions(catalog: Catalog, push: Push): void {
  for (const mission of catalog.missions.values()) {
    const file = `missions/${mission.id}.json`;
    const map = catalog.maps.get(mission.mapId);

    if (map === undefined) {
      push(file, 'mapId', `unknown map "${mission.mapId}"`);
      continue;
    }

    const extentX = map.width * map.tileSize;
    const extentY = map.height * map.tileSize;

    for (const lance of mission.lances) {
      for (const unit of lance.units) {
        if (!catalog.designs.has(unit.designId)) {
          push(file, `lances.${lance.team}`, `unknown design "${unit.designId}"`);
        }
        if (!catalog.pilots.has(unit.pilotId)) {
          push(file, `lances.${lance.team}`, `unknown pilot "${unit.pilotId}"`);
        }
        if (unit.spawn.x >= extentX || unit.spawn.y >= extentY) {
          push(
            file,
            `lances.${lance.team}`,
            `spawn (${unit.spawn.x}, ${unit.spawn.y}) is outside the ${extentX}×${extentY}m map`,
          );
          continue;
        }

        const column = Math.floor(unit.spawn.x / map.tileSize);
        const row = Math.floor(unit.spawn.y / map.tileSize);
        const symbol = map.tiles[row]?.[column];
        const terrainId = symbol === undefined ? undefined : map.legend[symbol];
        const terrain = terrainId === undefined ? undefined : catalog.rules.terrain.types[terrainId];

        if (terrain === undefined || !terrain.passable) {
          push(
            file,
            `lances.${lance.team}`,
            `spawn (${unit.spawn.x}, ${unit.spawn.y}) is on impassable terrain "${terrainId ?? '?'}"`,
          );
        }
      }
    }
  }
}

function checkMaps(catalog: Catalog, push: Push): void {
  for (const map of catalog.maps.values()) {
    const file = `maps/${map.id}.json`;
    for (const [symbol, terrainId] of Object.entries(map.legend)) {
      if (catalog.rules.terrain.types[terrainId] === undefined) {
        push(file, `legend.${symbol}`, `unknown terrain type "${terrainId}"`);
      }
    }
  }
}

function checkCampaigns(catalog: Catalog, push: Push): void {
  for (const campaign of catalog.campaigns.values()) {
    const file = `campaigns/${campaign.id}.json`;

    for (const node of campaign.nodes) {
      if (!catalog.missions.has(node.missionId)) {
        push(file, `nodes.${node.id}`, `unknown mission "${node.missionId}"`);
      }
    }

    for (const designId of campaign.startingDesignIds) {
      if (!catalog.designs.has(designId)) {
        push(file, 'startingDesignIds', `unknown design "${designId}"`);
      }
    }

    for (const pilotId of [...campaign.startingPilotIds, ...campaign.hiringPoolPilotIds]) {
      if (!catalog.pilots.has(pilotId)) {
        push(file, 'startingPilotIds', `unknown pilot "${pilotId}"`);
      }
    }
  }
}

export function checkIntegrity(catalog: Catalog, issues: ContentIssue[]): void {
  const push: Push = (file, path, message) => issues.push({ file, path, message });
  checkMaps(catalog, push);
  checkDesigns(catalog, push);
  checkMissions(catalog, push);
  checkCampaigns(catalog, push);
}
