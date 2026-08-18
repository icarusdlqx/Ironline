import { dropTonnageFor } from '../campaign/campaign';
import type { Catalog } from '../schema/load';
import type { BriefingLance } from './Briefing';
import { berthDesign, lanceTonnage, type SkirmishBerth } from './lance';
import { listStoredDesigns, loadFromStorage } from './mechbay/editor';

export function briefingLanceFor(
  catalog: Catalog,
  missionId: string,
  lance: SkirmishBerth[],
  onLance: (next: SkirmishBerth[]) => void,
  onCustomise: (index: number) => void,
): BriefingLance {
  return {
    berths: lance.map((berth, index) => ({
      index,
      designValue: berth.empty === true ? 'empty' : (berth.designId ?? 'custom'),
      customLabel: berth.designId === null ? (berth.design?.name ?? 'Custom build') : null,
      pilotId: berth.pilotId,
      tonnage: catalog.chassis.get(berthDesign(catalog, berth)?.chassisId ?? '')?.tonnage ?? 0,
      pilot: catalog.pilots.get(berth.pilotId) ?? null,
    })),
    // A dropship berth is for something that walks; vehicles and emplacements
    // remain opposition even when their cards share the design catalogue.
    designs: [...catalog.designs.values()]
      .filter((design) => catalog.chassis.get(design.chassisId)?.frame === 'mech')
      .map((design) => ({
        value: design.id,
        label: design.name,
        tonnage: catalog.chassis.get(design.chassisId)?.tonnage ?? 0,
      })),
    saved: listStoredDesigns().map((id) => ({ value: `saved:${id}`, label: id })),
    pilots: [...catalog.pilots.values()].map((pilot) => ({ id: pilot.id, name: pilot.name })),
    total: lanceTonnage(catalog, lance),
    allowance: dropTonnageFor(catalog, missionId),
    onDesign: (index, value) => {
      const next = lance.map((berth) => ({ ...berth }));
      const target = next[index];
      if (target === undefined) return;
      if (value === 'empty') {
        target.empty = true;
        target.designId = null;
        delete target.design;
      } else if (value.startsWith('saved:')) {
        const stored = loadFromStorage(value.slice('saved:'.length));
        if (stored.design === null) return;
        delete target.empty;
        target.designId = null;
        target.design = stored.design;
      } else if (value !== 'custom') {
        delete target.empty;
        target.designId = value;
        delete target.design;
      }
      onLance(next);
    },
    onPilot: (index, pilotId) => {
      const next = lance.map((berth) => ({ ...berth }));
      const target = next[index];
      if (target === undefined) return;
      target.pilotId = pilotId;
      onLance(next);
    },
    onCustomise,
  };
}
