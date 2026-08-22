import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { catalog } from '../../tests/support';
import { isOperational } from '../sim/types';
import { createWorld, stepWorld } from '../sim/world';
import {
  advanceTrainingStep,
  completeTraining,
  initialSkirmishMission,
  skipTraining,
  startTraining,
  STANDARD_MISSION_ID,
  storeTrainingStep,
  TRAINING_MISSION_ID,
} from './trainingProgress';

describe('the first training offer', () => {
  const real = globalThis.localStorage;

  beforeEach(() => {
    const entries = new Map<string, string>();
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        get length() {
          return entries.size;
        },
        key: (index: number) => [...entries.keys()][index] ?? null,
        getItem: (key: string) => entries.get(key) ?? null,
        setItem: (key: string, value: string) => entries.set(key, value),
      },
    });
  });

  afterEach(() => {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: real });
  });

  it('starts an empty profile on the range', () => {
    expect(initialSkirmishMission()).toBe(TRAINING_MISSION_ID);
  });

  it('leaves a profile with prior game data on its usual mission', () => {
    localStorage.setItem('ironline.difficulty', 'regular');
    expect(initialSkirmishMission()).toBe(STANDARD_MISSION_ID);
  });

  it('does not mistake playtest bookkeeping for prior play', () => {
    localStorage.setItem('ironline.playtest.v1', '{"opened":1}');
    expect(initialSkirmishMission()).toBe(TRAINING_MISSION_ID);
  });

  it('resumes an active lesson but respects a skip or completion', () => {
    storeTrainingStep(2);
    expect(initialSkirmishMission()).toBe(TRAINING_MISSION_ID);

    skipTraining();
    expect(initialSkirmishMission()).toBe(STANDARD_MISSION_ID);

    storeTrainingStep(4);
    completeTraining();
    expect(initialSkirmishMission()).toBe(STANDARD_MISSION_ID);
  });

  it('does not downgrade completed training when another route is opened', () => {
    completeTraining();
    skipTraining();

    expect(JSON.parse(localStorage.getItem('ironline.training') ?? '{}')).toMatchObject({
      step: 4,
      status: 'complete',
    });
  });

  it('resumes active progress and starts skipped or completed lessons from the beginning', () => {
    storeTrainingStep(3);
    startTraining();
    expect(JSON.parse(localStorage.getItem('ironline.training') ?? '{}')).toMatchObject({
      step: 3,
      status: 'active',
    });

    skipTraining();
    startTraining();
    expect(JSON.parse(localStorage.getItem('ironline.training') ?? '{}')).toMatchObject({
      step: 0,
      status: 'active',
    });

    completeTraining();
    startTraining();
    expect(JSON.parse(localStorage.getItem('ironline.training') ?? '{}')).toMatchObject({
      step: 0,
      status: 'active',
    });
  });
});

describe('training steps', () => {
  it('waits for the action named by the current lesson', () => {
    expect(
      advanceTrainingStep(0, { selected: false, moved: true, engaged: true, heated: true }),
    ).toBe(0);
    expect(
      advanceTrainingStep(0, { selected: true, moved: false, engaged: true, heated: true }),
    ).toBe(1);
  });

  it('catches up when the player has already performed later actions', () => {
    expect(
      advanceTrainingStep(1, { selected: true, moved: true, engaged: true, heated: true }),
    ).toBe(4);
  });
});

describe('the range mission', () => {
  it('fields every target before destroy-all can settle', () => {
    const mission = catalog.missions.get(TRAINING_MISSION_ID);
    expect(mission?.lances.find((lance) => lance.team === 1)?.units).toHaveLength(3);
    expect(
      mission?.triggers.flatMap((trigger) => trigger.effects).some((effect) => effect.type === 'spawn'),
    ).toBe(false);
  });

  it('keeps the drill running after the first target falls', () => {
    const world = createWorld(catalog, {
      missionId: TRAINING_MISSION_ID,
      playerTeam: 0,
      seed: 'training-regression',
    });
    const firstTarget = world.entities.find((entity) => entity.team === 1);
    if (firstTarget === undefined) throw new Error('training mission has no target');
    firstTarget.destroyed = true;

    stepWorld(world, catalog.rules.simulation.maxBattleTicks);

    expect(world.finished).toBe(false);
    expect(world.missionStatus).toBe('active');
    expect(world.entities.filter((entity) => entity.team === 1 && isOperational(entity))).toHaveLength(
      2,
    );
  });
});
