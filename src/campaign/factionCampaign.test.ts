import { describe, expect, it } from 'vitest';
import { catalog } from '../../tests/support';
import type { Mission } from '../schema/mission';
import type { BattleResult } from '../sim/world';
import {
  acceptContract,
  availableNodes,
  campaignNodes,
  resolveMission,
  startCampaign,
} from './campaign';
import { designMarketAvailable } from './market';
import { deserialiseCampaign, serialiseCampaign } from './save';

const campaign = (() => {
  const data = catalog.campaigns.get('border_dispute');
  if (data === undefined) throw new Error('missing Border Dispute campaign');
  return data;
})();

const KESTREL_PILOT_IDS = new Set([
  'anja_verrin',
  'bram_nyen',
  'corin_dast',
  'dario_senn',
  'leda_morcant',
  'oksana_valev',
  'suri_kell',
  'tomas_arvel',
]);

function node(id: string) {
  const match = campaign.nodes.find((entry) => entry.id === id);
  if (match === undefined) throw new Error(`missing campaign node "${id}"`);
  return match;
}

function mission(id: string): Mission {
  const match = catalog.missions.get(id);
  if (match === undefined) throw new Error(`missing mission "${id}"`);
  return match;
}

function hostileDesignIds(data: Mission): string[] {
  const initial = data.lances
    .filter((lance) => lance.team !== 0)
    .flatMap((lance) => lance.units.map((unit) => unit.designId));
  const delayed = data.triggers.flatMap((trigger) =>
    trigger.effects.flatMap((effect) =>
      effect.type === 'spawn' && effect.team !== 0
        ? effect.units.map((unit) => unit.designId)
        : [],
    ),
  );
  return [...initial, ...delayed];
}

function hostilePilotIds(data: Mission): string[] {
  const initial = data.lances
    .filter((lance) => lance.team !== 0)
    .flatMap((lance) => lance.units.map((unit) => unit.pilotId));
  const delayed = data.triggers.flatMap((trigger) =>
    trigger.effects.flatMap((effect) =>
      effect.type === 'spawn' && effect.team !== 0
        ? effect.units.map((unit) => unit.pilotId)
        : [],
    ),
  );
  return [...initial, ...delayed];
}

function factionOf(designId: string): string | undefined {
  const design = catalog.designs.get(designId);
  return catalog.chassis.get(design?.chassisId ?? '')?.faction;
}

function missionCopy(data: Mission): string {
  const messages = data.triggers.flatMap((trigger) =>
    trigger.effects.flatMap((effect) => (effect.type === 'message' ? [effect.text] : [])),
  );
  return [data.briefing, ...messages].join(' ').toLocaleLowerCase('en-GB');
}

describe('faction campaign story', () => {
  it('starts with four Linewrought mechs and keeps day-zero opposition Linewrought', () => {
    expect(campaign.startingDesignIds).toHaveLength(4);
    expect(campaign.startingDesignIds.every((designId) => factionOf(designId) === 'linewrought'))
      .toBe(true);
    expect(campaign.startingDesignIds.every((designId) => {
      const design = catalog.designs.get(designId);
      return design !== undefined && catalog.chassis.get(design.chassisId)?.frame === 'mech';
    })).toBe(true);
    expect(
      [...new Set(campaign.startingDesignIds)].filter((designId) => {
        const design = catalog.designs.get(designId);
        return design !== undefined && !designMarketAvailable(catalog, design);
      }),
    ).toEqual(['bulwark_assault']);

    const dayZeroMissionIds = new Set([
      node('militia_raid').missionId,
      node('supply_line').missionId,
      node('causeway_push').missionId,
      ...campaign.sideWork.missionIds,
    ]);
    for (const missionId of dayZeroMissionIds) {
      const designs = hostileDesignIds(mission(missionId));
      expect(designs.length, `${missionId} has no opposition`).toBeGreaterThan(0);
      expect(
        designs.every((designId) => factionOf(designId) === 'linewrought'),
        `${missionId} reveals Aurelian Stock before Cold Contact`,
      ).toBe(true);
      expect(
        designs.every((designId) => {
          const design = catalog.designs.get(designId);
          return design !== undefined && designMarketAvailable(catalog, design);
        }),
        `${missionId} yields Sealed parts before Cold Contact`,
      ).toBe(true);
    }

    expect(catalog.lore.get('the_welded')?.body.join(' ')).toContain(
      'No town makes one and no yard stocks a replacement.',
    );
  });

  it('does not offer a named hostile for hire', () => {
    const missionIds = [
      ...campaign.nodes.map((entry) => entry.missionId),
      ...campaign.sideWork.missionIds,
    ];
    const hostilePilots = new Set(missionIds.flatMap((missionId) => hostilePilotIds(mission(missionId))));
    const reservePilots = new Set(
      missionIds.flatMap((missionId) => mission(missionId).reserves.map((unit) => unit.pilotId)),
    );

    expect([...hostilePilots].every((pilotId) => KESTREL_PILOT_IDS.has(pilotId))).toBe(true);
    expect(campaign.startingPilotIds.some((pilotId) => hostilePilots.has(pilotId))).toBe(false);
    expect(campaign.hiringPoolPilotIds.some((pilotId) => hostilePilots.has(pilotId))).toBe(false);
    expect([...reservePilots].some((pilotId) => hostilePilots.has(pilotId))).toBe(false);
    expect(campaign.startingPilotIds.some((pilotId) => reservePilots.has(pilotId))).toBe(false);
    expect(campaign.hiringPoolPilotIds.some((pilotId) => reservePilots.has(pilotId))).toBe(false);
  });

  it('makes hostile Sealed parts come from Aurelian machines', () => {
    const missionIds = new Set([
      ...campaign.nodes.map((entry) => entry.missionId),
      ...campaign.sideWork.missionIds,
    ]);

    for (const missionId of missionIds) {
      for (const designId of hostileDesignIds(mission(missionId))) {
        const design = catalog.designs.get(designId);
        expect(design, `${missionId} names missing design ${designId}`).toBeDefined();
        if (design === undefined || factionOf(designId) === 'aurelian') continue;
        expect(
          designMarketAvailable(catalog, design),
          `${missionId} puts Sealed parts on hostile Linewrought ${designId}`,
        ).toBe(true);
      }
    }
  });

  it('authors the four acts as one required spine', () => {
    const spine = [
      ['militia_raid', 'line_maintenance'],
      ['pass_skirmish', 'sealed_contact'],
      ['foundry_sweep_node', 'rules_break'],
      ['shale_overwatch_node', 'conduit_breach'],
      ['ridge_hold', 'depot_road'],
    ] as const;

    expect(spine.map(([nodeId]) => nodeId)).toEqual([
      'militia_raid',
      'pass_skirmish',
      'foundry_sweep_node',
      'shale_overwatch_node',
      'ridge_hold',
    ]);
    spine.forEach(([nodeId, missionId], index) => {
      expect(node(nodeId).missionId).toBe(missionId);
      expect(node(nodeId).requires).toEqual(index === 0 ? [] : [spine[index - 1]?.[0]]);
    });

    const contact = node('pass_skirmish');
    expect(contact.maxSalvageShare).toBe(1);
    expect(hostileDesignIds(mission(contact.missionId))).toContain('votive_picket');
    expect(missionCopy(mission('rules_break'))).toContain('ejection seat');
    expect(missionCopy(mission('conduit_breach'))).toContain('conduit');
  });

  it('offers equivalent, mutually terminal depot dispositions', () => {
    const burn = node('depot_burn');
    const take = node('depot_take');
    expect(burn.requires).toEqual(['ridge_hold']);
    expect(take.requires).toEqual(['ridge_hold']);
    expect(burn.employerId).toBe('halloran_freight');
    expect(take.employerId).toBe('halloran_freight');
    expect(campaign.victoryNodeId).toBe(burn.id);
    expect(campaign.alternateVictoryNodeIds).toContain(take.id);

    const burnMission = mission(burn.missionId);
    const takeMission = mission(take.missionId);
    expect(hostileDesignIds(burnMission)).toEqual(hostileDesignIds(takeMission));
    expect(burnMission.dropTonnage).toBe(takeMission.dropTonnage);
    expect(burnMission.maxDurationSeconds).toBe(takeMission.maxDurationSeconds);
    expect(burnMission.objectives.map((objective) => objective.id)).toContain('arm_purge_train');
    expect(takeMission.objectives.map((objective) => objective.id)).toContain('take_command_key');
  });

  it.each(['depot_burn', 'depot_take'])(
    'finishes through the %s ending and closes its sibling',
    (nodeId) => {
      const state = startCampaign(catalog, campaign.id, 'ending-choice');
      state.completedNodes.push(
        'militia_raid',
        'pass_skirmish',
        'foundry_sweep_node',
        'shale_overwatch_node',
        'ridge_hold',
      );
      expect(campaignNodes(catalog, state).map((entry) => entry.id)).toEqual(
        expect.arrayContaining(['depot_burn', 'depot_take']),
      );
      expect(acceptContract(catalog, state, nodeId, 'fee_first').ok).toBe(true);
      const missionId = state.contract?.missionId;
      if (missionId === undefined) throw new Error('ending contract was not signed');

      const battle: BattleResult = {
        seed: 'ending-choice',
        missionId,
        missionStatus: 'success',
        missionReason: 'objectives-complete',
        objectives: [],
        ticks: 1,
        durationSeconds: 0.05,
        winner: 0,
        decided: true,
        units: [],
        weapons: [],
      };
      resolveMission(catalog, state, battle, []);

      expect(state).toMatchObject({ finished: true, won: true });
      expect(state.completedNodes).toContain(nodeId);
      expect(availableNodes(catalog, state)).toEqual([]);

      const restored = deserialiseCampaign(serialiseCampaign(state), catalog).state;
      expect(restored).toMatchObject({ finished: true, won: true });
      expect(restored?.completedNodes).toContain(nodeId);
    },
  );

  it('keeps the Aurelian article behind the first-contact completion', () => {
    const welded = catalog.lore.get('the_welded');
    const sealed = catalog.lore.get('the_sealed');
    expect(welded?.unlockNodeId).toBeUndefined();
    expect(welded?.body.join(' ')).toContain('Linewrought');
    expect(sealed?.unlockNodeId).toBe('pass_skirmish');
    expect(sealed?.body.join(' ')).toContain('Aurelian Stock');
  });
});
