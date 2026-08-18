import { createCampaignSeed } from '../campaign/freshness';
import type { BattleResult } from '../sim/world';
import { TRAINING_MISSION_ID } from './trainingProgress';

const MAX_BATTLE_CODE_LENGTH = 48;
export const TRAINING_BATTLE_CODE = 'skirmish';

export type BattleCodeCheck =
  | { ok: true; code: string; reason: null }
  | { ok: false; code: string; reason: string };

export function checkBattleCode(input: string): BattleCodeCheck {
  const code = input.trim().toLowerCase().replace(/[\s_]+/g, '-').replace(/-{2,}/g, '-');
  if (code.length < 3) {
    return { ok: false, code, reason: 'Use at least three letters or numbers.' };
  }
  if (code.length > MAX_BATTLE_CODE_LENGTH) {
    return { ok: false, code, reason: `Keep the code under ${MAX_BATTLE_CODE_LENGTH + 1} characters.` };
  }
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(code)) {
    return { ok: false, code, reason: 'Use letters, numbers, spaces, or hyphens.' };
  }
  return { ok: true, code, reason: null };
}

export function createBattleCode(makeCode: () => string = createCampaignSeed): string {
  const checked = checkBattleCode(makeCode());
  if (!checked.ok) throw new Error(`generated an invalid battle code: ${checked.reason}`);
  return checked.code;
}

export function createNewBattleCode(
  current: string,
  makeCode: () => string = createCampaignSeed,
): string {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const next = createBattleCode(makeCode);
    if (next !== current) return next;
  }
  throw new Error('could not generate a different battle code');
}

export function initialBattleCode(
  missionId: string,
  makeCode: () => string = createBattleCode,
): string {
  return missionId === TRAINING_MISSION_ID ? TRAINING_BATTLE_CODE : makeCode();
}

export function resultWithBattleCode(result: BattleResult, battleCode: string): BattleResult {
  return { ...result, seed: battleCode };
}
