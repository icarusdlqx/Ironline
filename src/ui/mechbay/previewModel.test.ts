import { describe, expect, it, vi } from 'vitest';
import { LOCATIONS } from '../../schema/common';
import { catalog } from '../../../tests/support';
import { buildPreviewModel, previewModelKey, setPreviewHighlights } from './previewModel';

function sentinel() {
  const chassis = catalog.chassis.get('sentinel_snl2');
  const design = catalog.designs.get('sentinel_brawler');
  if (chassis === undefined || design === undefined) throw new Error('missing Sentinel fixture');
  return { chassis, design };
}

describe('mechbay preview model', () => {
  it('keys only chassis identity and visible weapon construction', () => {
    const { chassis, design } = sentinel();
    const cosmeticRefit = {
      ...design,
      name: 'Renamed in the bay',
      armour: { ...design.armour, head: design.armour.head - 1 },
      heatSinks: design.heatSinks + 1,
      heatSinkId: design.heatSinkId === 'heat_sink' ? 'double_heat_sink' : 'heat_sink',
    };
    const movedWeapon = {
      ...design,
      mounts: design.mounts.map((mount, index) =>
        index === 0 ? { ...mount, location: 'right_torso' as const } : mount,
      ),
    };
    const relabelledChassis = {
      ...chassis,
      name: 'Workshop nickname',
      armourMax: { ...chassis.armourMax, head: chassis.armourMax.head + 1 },
    };

    expect(previewModelKey(chassis, cosmeticRefit)).toBe(previewModelKey(chassis, design));
    expect(previewModelKey(relabelledChassis, design)).toBe(previewModelKey(chassis, design));
    expect(previewModelKey(chassis, movedWeapon)).not.toBe(previewModelKey(chassis, design));
  });

  it('shows mounted weapons, one bounded marker per usable location and powered sealed lights', () => {
    const { chassis, design } = sentinel();
    const preview = buildPreviewModel(catalog, chassis, design);
    try {
      expect(preview.model.root.userData.modelDetail).toBe('hero');
      expect(preview.model.weapons).toHaveLength(design.mounts.length);
      expect(preview.markers.map((marker) => marker.userData.hardpointLocation)).toEqual([
        'centre_torso',
        'left_torso',
        'right_torso',
        'left_arm',
        'right_arm',
      ]);
      expect(preview.markers.length).toBeLessThanOrEqual(LOCATIONS.length);
      expect(new Set(preview.markers.map((marker) => marker.geometry)).size).toBe(1);
      expect(new Set(preview.markers.map((marker) => marker.material)).size).toBe(preview.markers.length);
      expect(preview.model.startup?.lights).toHaveLength(3);
      expect(preview.model.startup?.lights.every((light) => light.visible)).toBe(true);
    } finally {
      preview.dispose();
    }
  });

  it('builds every mech design with its complete mounted loadout', () => {
    for (const design of catalog.designs.values()) {
      const chassis = catalog.chassis.get(design.chassisId);
      if (chassis === undefined || chassis.frame !== 'mech') continue;
      const preview = buildPreviewModel(catalog, chassis, design);
      try {
        expect(preview.model.weapons, design.id).toHaveLength(design.mounts.length);
        expect(preview.model.weapons.every((weapon) => weapon.slide.visible), design.id).toBe(true);
        expect(preview.markers.length, design.id).toBeLessThanOrEqual(LOCATIONS.length);
        if (chassis.faction === 'aurelian') {
          expect(preview.model.startup?.lights.every((light) => light.visible), design.id).toBe(true);
        }
      } finally {
        preview.dispose();
      }
    }
  });

  it('applies compatible, selected and hovered highlights in that priority order', () => {
    const { chassis, design } = sentinel();
    const preview = buildPreviewModel(catalog, chassis, design);
    try {
      setPreviewHighlights(preview, {
        compatible: new Set(['centre_torso', 'left_arm', 'right_arm']),
        selected: 'left_arm',
        hovered: 'right_arm',
      });
      const markers = new Map(
        preview.markers.map((marker) => [marker.userData.hardpointLocation, marker]),
      );
      expect(markers.get('centre_torso')?.material.color.getHex()).toBe(0x78c9ff);
      expect(markers.get('centre_torso')?.scale.x).toBe(1.08);
      expect(markers.get('left_arm')?.material.color.getHex()).toBe(0xffc857);
      expect(markers.get('left_arm')?.scale.x).toBe(1.22);
      expect(markers.get('right_arm')?.material.color.getHex()).toBe(0xffffff);
      expect(markers.get('right_arm')?.scale.x).toBe(1.35);
    } finally {
      preview.dispose();
    }
  });

  it('fully disposes shared marker resources only once', () => {
    const { chassis, design } = sentinel();
    const preview = buildPreviewModel(catalog, chassis, design);
    const geometry = preview.markers[0]?.geometry;
    const material = preview.markers[0]?.material;
    if (geometry === undefined || material === undefined) throw new Error('missing marker fixture');
    const disposeGeometry = vi.spyOn(geometry, 'dispose');
    const disposeMaterial = vi.spyOn(material, 'dispose');

    preview.dispose();
    preview.dispose();

    expect(disposeGeometry).toHaveBeenCalledOnce();
    expect(disposeMaterial).toHaveBeenCalledOnce();
  });
});
