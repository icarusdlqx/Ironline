import { describe, expect, it } from 'vitest';
import { catalog } from '../../tests/support';
import type { Mission } from '../schema/mission';
import { availableNodes, campaignNodes, startCampaign } from './campaign';
import { deserialiseCampaign, serialiseCampaign } from './save';

const CAMPAIGN_ID = 'border_dispute';
const LEAF_IDS = ['cutbank_register', 'blackglass_receipt'] as const;
const LEGACY_COMPANY_PILOTS = [
  'kessa_vale',
  'dorn_hess',
  'marek_sud',
  'ilse_brant',
  'nadia_ostrow',
  'cato_ferrin',
  'juno_reyes',
  'willem_torrance',
] as const;
const LEGACY_REQUIRES = {
  militia_raid: [],
  pass_skirmish: ['militia_raid'],
  supply_line: ['militia_raid'],
  ridge_hold: ['shale_overwatch_node'],
  causeway_push: ['supply_line'],
  foundry_sweep_node: ['pass_skirmish'],
  shale_overwatch_node: ['foundry_sweep_node'],
  depot_burn: ['ridge_hold'],
  depot_take: ['ridge_hold'],
} as const;

const campaign = catalog.campaigns.get(CAMPAIGN_ID);
if (campaign === undefined) throw new Error('missing Border Dispute campaign');

function mission(id: string): Mission {
  const data = catalog.missions.get(id);
  if (data === undefined) throw new Error(`missing mission "${id}"`);
  return data;
}

function hostilePilotIds(data: Mission): string[] {
  const deployed = data.lances
    .filter((lance) => lance.team !== 0)
    .flatMap((lance) => lance.units.map((unit) => unit.pilotId));
  const delayed = data.triggers.flatMap((trigger) =>
    trigger.effects.flatMap((effect) =>
      effect.type === 'spawn' && effect.team !== 0
        ? effect.units.map((unit) => unit.pilotId)
        : [],
    ),
  );
  return [...deployed, ...delayed];
}

function unitLedger(data: Mission, team: number): string[] {
  return data.lances
    .find((lance) => lance.team === team)
    ?.units.map(
      (unit) =>
        `${unit.designId}/${unit.pilotId}@${unit.spawn.x},${unit.spawn.y}/${unit.facingDegrees}`,
    ) ?? [];
}

describe('large battlefield mission contracts', () => {
  it('authors the Cutbank register recovery exactly', () => {
    const data = mission('exchange_register');
    expect(data).toMatchObject({
      name: 'Recovery — Cutbank Exchange',
      type: 'base_capture',
      mapId: 'cutbank_exchange',
      maxDurationSeconds: 540,
      startingResourcePoints: 600,
      dropTonnage: 225,
      reserves: [],
    });
    expect(data.briefing).toBe(
      'Cutbank Exchange is three route cabinets and a kilometre of sidings compressed into one yard. Kestrel locked the registers and left a guard on the raised line. Key south, sorting and north; expect relief through the east gate.',
    );
    expect(data.lances.map((lance) => lance.name)).toEqual([
      'Halloran Register Lance',
      'Kestrel Exchange Guard',
    ]);
    expect(unitLedger(data, 0)).toEqual([
      'hornet_spotter/kessa_vale@84,1260/-45',
      'bulwark_assault/dorn_hess@156,1260/-45',
      'hornet_spotter/marek_sud@84,1188/-45',
      'cairn_battery/ilse_brant@156,1188/-45',
    ]);
    expect(unitLedger(data, 1)).toEqual([
      'redoubt_emplacement/corin_dast@780,660/135',
      'drover_carrier/dario_senn@1260,156/135',
      'courser_patrol/leda_morcant@1260,84/135',
      'hornet_spotter/bram_nyen@1188,84/135',
    ]);
    expect(
      data.zones.map(({ id, x, y, radius, owner, captureSeconds, resourcePoints }) => ({
        id,
        x,
        y,
        radius,
        owner,
        captureSeconds,
        resourcePoints,
      })),
    ).toEqual([
      { id: 'south_register', x: 276, y: 996, radius: 68, owner: 1, captureSeconds: 9, resourcePoints: 100 },
      { id: 'sorting_register', x: 636, y: 636, radius: 68, owner: 1, captureSeconds: 9, resourcePoints: 100 },
      { id: 'north_register', x: 996, y: 276, radius: 68, owner: 1, captureSeconds: 9, resourcePoints: 100 },
    ]);
    expect(data.objectives.map((objective) => objective.id)).toEqual([
      'key_registers',
      'clear_exchange',
      'lance_survives',
    ]);
    expect(data.objectives[0]).toMatchObject({
      type: 'capture_zones',
      required: true,
      resourcePoints: 250,
      zoneIds: ['south_register', 'sorting_register', 'north_register'],
    });
    expect(data.triggers.map((trigger) => [trigger.id, trigger.when])).toEqual([
      ['opening_register', { type: 'elapsed', seconds: 3 }],
      ['east_gate_relief', { type: 'elapsed', seconds: 0 }],
      ['register_green', { type: 'objective_complete', objectiveId: 'key_registers' }],
    ]);
    expect(data.triggers[0]?.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'message',
          text: 'Command: south register, sorting register, north register. Key all three and clear the exchange.',
        }),
        expect.objectContaining({ type: 'reveal', x: 636, y: 636, radius: 260, seconds: 24 }),
      ]),
    );
    expect(data.triggers[1]?.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'spawn',
          team: 1,
          units: [
            expect.objectContaining({
              designId: 'rampart_breaker',
              pilotId: 'tomas_arvel',
              spawn: { x: 1308, y: 636 },
              facingDegrees: 180,
            }),
          ],
        }),
        expect.objectContaining({ type: 'reveal', x: 1308, y: 636, radius: 190, seconds: 22 }),
      ]),
    );
  });

  it('authors the Blackglass receipt recovery exactly', () => {
    const data = mission('quarry_brakes');
    expect(data).toMatchObject({
      name: 'Recovery — Blackglass Quarry',
      type: 'base_capture',
      mapId: 'blackglass_quarry',
      maxDurationSeconds: 600,
      startingResourcePoints: 700,
      dropTonnage: 240,
      reserves: [],
    });
    expect(data.briefing).toBe(
      'Sarn’s lift register shows Kestrel moved a bone-white wreck through Blackglass under a plate number assigned to slag. Take the west brake, lift table and east brake, then hold all three for thirty seconds while the receipt copies. The rim has the sightlines; the floor has the controls.',
    );
    expect(data.lances.map((lance) => lance.name)).toEqual([
      'Sarn Receipt Lance',
      'Kestrel Lift Section',
    ]);
    expect(unitLedger(data, 0)).toEqual([
      'hornet_spotter/kessa_vale@84,1260/-45',
      'bulwark_assault/dorn_hess@156,1260/-45',
      'hornet_spotter/marek_sud@84,1188/-45',
      'cairn_battery/ilse_brant@156,1188/-45',
    ]);
    expect(unitLedger(data, 1)).toEqual([
      'sentinel_brawler/anja_verrin@708,636/135',
      'falchion_duellist/suri_kell@1092,516/135',
      'warden_lancer/corin_dast@1164,156/135',
    ]);
    expect(
      data.zones.map(({ id, x, y, radius, owner, captureSeconds, resourcePoints }) => ({
        id,
        x,
        y,
        radius,
        owner,
        captureSeconds,
        resourcePoints,
      })),
    ).toEqual([
      { id: 'west_brake', x: 252, y: 828, radius: 68, owner: 1, captureSeconds: 8, resourcePoints: 75 },
      { id: 'lift_table', x: 684, y: 684, radius: 76, owner: 1, captureSeconds: 12, resourcePoints: 100 },
      { id: 'east_brake', x: 1116, y: 540, radius: 68, owner: 1, captureSeconds: 8, resourcePoints: 75 },
    ]);
    expect(data.objectives.map((objective) => objective.id)).toEqual([
      'stop_hoist',
      'copy_receipt',
      'lance_survives',
    ]);
    expect(data.objectives[0]).toMatchObject({
      type: 'capture_zones',
      required: true,
      resourcePoints: 250,
      zoneIds: ['west_brake', 'lift_table', 'east_brake'],
    });
    expect(data.objectives[1]).toMatchObject({
      type: 'hold_zones',
      required: true,
      holdSeconds: 30,
      resourcePoints: 200,
      zoneIds: ['west_brake', 'lift_table', 'east_brake'],
    });
    expect(data.triggers.map((trigger) => [trigger.id, trigger.when])).toEqual([
      ['receipt_order', { type: 'elapsed', seconds: 3 }],
      ['relief_on_register', { type: 'objective_complete', objectiveId: 'stop_hoist' }],
      ['receipt_copied', { type: 'objective_complete', objectiveId: 'copy_receipt' }],
    ]);
    expect(data.triggers[0]?.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'reveal', x: 684, y: 684, radius: 280, seconds: 28 }),
      ]),
    );
    expect(data.triggers[1]?.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'spawn',
          team: 1,
          units: [
            expect.objectContaining({
              designId: 'halberd_prime',
              pilotId: 'tomas_arvel',
              spawn: { x: 1260, y: 84 },
              facingDegrees: 135,
            }),
            expect.objectContaining({
              designId: 'votive_picket',
              pilotId: 'oksana_valev',
              spawn: { x: 1188, y: 84 },
              facingDegrees: 135,
            }),
          ],
        }),
        expect.objectContaining({ type: 'reveal', x: 1224, y: 84, radius: 220, seconds: 24 }),
      ]),
    );
  });
});

describe('large battlefield campaign compatibility', () => {
  it('adds only two optional leaves without rewriting the existing graph', () => {
    expect(campaign.victoryNodeId).toBe('depot_burn');
    expect(campaign.alternateVictoryNodeIds).toEqual(['depot_take']);
    expect(campaign.sideWork).toEqual({
      missionIds: [
        'raid_ridge',
        'base_capture_ridge',
        'causeway_crossing',
        'causeway_night',
        'switchyard_watch',
        'relay_chain',
      ],
      employerIds: [
        'halloran_combine',
        'vasi_reclamation',
        'ferrous_guild',
        'kestrel_freight',
        'harrow_compact',
        'ostrow_holdings',
      ],
    });
    expect(
      Object.fromEntries(
        campaign.nodes
          .filter((node) => node.id in LEGACY_REQUIRES)
          .map((node) => [node.id, node.requires]),
      ),
    ).toEqual(LEGACY_REQUIRES);
    expect(campaign.nodes.slice(-2).map((node) => node.id)).toEqual(LEAF_IDS);
    expect(campaign.nodes.slice(0, -2).map((node) => node.id)).toEqual(
      Object.keys(LEGACY_REQUIRES),
    );
    expect(campaign.nodes.slice(-2)).toMatchObject([
      {
        id: 'cutbank_register',
        missionId: 'exchange_register',
        employerId: 'halloran_freight',
        requires: ['supply_line'],
        basePayout: 1150000,
        maxSalvageShare: 0.7,
        deadlineDays: 26,
        position: { x: 0.25, y: 0.91 },
      },
      {
        id: 'blackglass_receipt',
        missionId: 'quarry_brakes',
        employerId: 'sarn_foundry',
        requires: ['foundry_sweep_node'],
        basePayout: 1650000,
        maxSalvageShare: 0.9,
        deadlineDays: 28,
        position: { x: 0.52, y: 0.12 },
      },
    ]);
    expect(
      campaign.nodes.filter((node) =>
        node.requires.some((required) => LEAF_IDS.includes(required as (typeof LEAF_IDS)[number])),
      ),
    ).toEqual([]);
  });

  it('round-trips an unfinished old-shaped save and discovers both new leaves', () => {
    const state = startCampaign(catalog, CAMPAIGN_ID, 'large-fields-legacy');
    state.completedNodes.push(
      'militia_raid',
      'supply_line',
      'pass_skirmish',
      'foundry_sweep_node',
    );

    const restored = deserialiseCampaign(serialiseCampaign(state), catalog).state;
    expect(restored).not.toBeNull();
    if (restored === null) return;
    expect(availableNodes(catalog, restored).map((node) => node.id)).toEqual(
      expect.arrayContaining([...LEAF_IDS]),
    );

    restored.completedNodes.push(...LEAF_IDS);
    const oldSpine = campaignNodes(catalog, restored).map((node) => node.id);
    expect(oldSpine).toEqual(expect.arrayContaining(['causeway_push', 'shale_overwatch_node']));
    expect(oldSpine).not.toEqual(expect.arrayContaining([...LEAF_IDS]));
  });

  it('keeps a completed depot save closed even when optional leaves remain', () => {
    const state = startCampaign(catalog, CAMPAIGN_ID, 'large-fields-finished');
    state.completedNodes.push(
      'militia_raid',
      'pass_skirmish',
      'foundry_sweep_node',
      'shale_overwatch_node',
      'ridge_hold',
      'depot_burn',
    );
    state.finished = true;
    state.won = true;

    const restored = deserialiseCampaign(serialiseCampaign(state), catalog).state;
    expect(restored).not.toBeNull();
    if (restored === null) return;
    expect(restored.completedNodes).not.toEqual(expect.arrayContaining([...LEAF_IDS]));
    expect(availableNodes(catalog, restored)).toEqual([]);
  });

  it('keeps every new hostile unique per mission and off the company register', () => {
    expect([...campaign.startingPilotIds, ...campaign.hiringPoolPilotIds]).toEqual(
      LEGACY_COMPANY_PILOTS,
    );
    const company = new Set<string>(LEGACY_COMPANY_PILOTS);

    for (const missionId of ['exchange_register', 'quarry_brakes']) {
      const hostiles = hostilePilotIds(mission(missionId));
      expect(new Set(hostiles).size, missionId).toBe(hostiles.length);
      expect(hostiles.some((pilotId) => company.has(pilotId)), missionId).toBe(false);
    }
  });
});
