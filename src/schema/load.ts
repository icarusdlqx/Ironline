import type { ZodType } from 'zod';
import { LoreEntrySchema, type LoreEntry } from './lore';
import { CampaignSchema, type Campaign } from './campaign';
import { ChassisSchema, type Chassis } from './chassis';
import { DesignSchema, type Design } from './design';
import { EquipmentSchema, type Equipment } from './equipment';
import { checkIntegrity } from './integrity';
import { AtmosphereSchema, type Atmosphere } from './atmosphere';
import { TerrainMapSchema, type TerrainMapData } from './map';
import { MissionSchema, type Mission } from './mission';
import { PilotSchema, type Pilot } from './pilot';
import {
  AiRulesSchema,
  BalanceRulesSchema,
  PilotTraitRulesSchema,
  AbilityRulesSchema,
  TraitRulesSchema,
  CombatRulesSchema,
  ConstructionRulesSchema,
  DifficultyRulesSchema,
  FrameRulesSchema,
  DamageRulesSchema,
  StabilityRulesSchema,
  EconomyRulesSchema,
  HeatRulesSchema,
  MovementRulesSchema,
  RULE_IDS,
  SalvageRulesSchema,
  SensorRulesSchema,
  SimulationRulesSchema,
  SupportRulesSchema,
  TerrainRulesSchema,
  type Rules,
} from './rules';
import { WeaponSchema, type Weapon } from './weapon';

export interface ContentIssue {
  readonly file: string;
  readonly path: string;
  readonly message: string;
}

export class ContentValidationError extends Error {
  readonly issues: readonly ContentIssue[];

  constructor(issues: readonly ContentIssue[]) {
    const detail = issues.map((issue) => `  ${issue.file} → ${issue.path}: ${issue.message}`);
    super(`${issues.length} content validation issue(s):\n${detail.join('\n')}`);
    this.name = 'ContentValidationError';
    this.issues = issues;
  }
}

export interface Catalog {
  readonly rules: Rules;
  readonly chassis: ReadonlyMap<string, Chassis>;
  readonly weapons: ReadonlyMap<string, Weapon>;
  readonly equipment: ReadonlyMap<string, Equipment>;
  readonly pilots: ReadonlyMap<string, Pilot>;
  readonly designs: ReadonlyMap<string, Design>;
  readonly maps: ReadonlyMap<string, TerrainMapData>;
  readonly atmospheres: ReadonlyMap<string, Atmosphere>;
  readonly missions: ReadonlyMap<string, Mission>;
  readonly campaigns: ReadonlyMap<string, Campaign>;
  readonly lore: ReadonlyMap<string, LoreEntry>;
}

type RawFiles = Record<string, unknown>;

const chassisFiles = import.meta.glob('../data/chassis/*.json', {
  eager: true,
  import: 'default',
}) as RawFiles;
const weaponFiles = import.meta.glob('../data/weapons/*.json', {
  eager: true,
  import: 'default',
}) as RawFiles;
const equipmentFiles = import.meta.glob('../data/equipment/*.json', {
  eager: true,
  import: 'default',
}) as RawFiles;
const pilotFiles = import.meta.glob('../data/pilots/*.json', {
  eager: true,
  import: 'default',
}) as RawFiles;
const designFiles = import.meta.glob('../data/designs/*.json', {
  eager: true,
  import: 'default',
}) as RawFiles;
const atmosphereFiles = import.meta.glob('../data/atmospheres/*.json', {
  eager: true,
  import: 'default',
}) as RawFiles;

const mapFiles = import.meta.glob('../data/maps/*.json', {
  eager: true,
  import: 'default',
}) as RawFiles;
const missionFiles = import.meta.glob('../data/missions/*.json', {
  eager: true,
  import: 'default',
}) as RawFiles;
const campaignFiles = import.meta.glob('../data/campaigns/*.json', {
  eager: true,
  import: 'default',
}) as RawFiles;
const loreFiles = import.meta.glob('../data/lore/*.json', {
  eager: true,
  import: 'default',
}) as RawFiles;
const ruleFiles = import.meta.glob('../data/rules/*.json', {
  eager: true,
  import: 'default',
}) as RawFiles;

function fileStem(filePath: string): string {
  const segments = filePath.split('/');
  return (segments[segments.length - 1] ?? '').replace(/\.json$/, '');
}

function recordIssues(
  file: string,
  error: { issues: readonly { path: PropertyKey[]; message: string }[] },
  issues: ContentIssue[],
): void {
  for (const issue of error.issues) {
    issues.push({
      file,
      path: issue.path.map(String).join('.') || '(root)',
      message: issue.message,
    });
  }
}

function parseCollection<T extends { id: string }>(
  label: string,
  files: RawFiles,
  schema: ZodType<T>,
  issues: ContentIssue[],
): Map<string, T> {
  const parsed = new Map<string, T>();

  for (const filePath of Object.keys(files).sort()) {
    const result = schema.safeParse(files[filePath]);

    if (!result.success) {
      recordIssues(filePath, result.error, issues);
      continue;
    }

    const stem = fileStem(filePath);
    if (stem !== result.data.id) {
      issues.push({
        file: filePath,
        path: 'id',
        message: `${label} id "${result.data.id}" must match its filename "${stem}"`,
      });
      continue;
    }

    if (parsed.has(result.data.id)) {
      issues.push({
        file: filePath,
        path: 'id',
        message: `duplicate ${label} id "${result.data.id}"`,
      });
      continue;
    }

    parsed.set(result.data.id, result.data);
  }

  return parsed;
}

function parseRule<T>(
  ruleId: string,
  schema: ZodType<T>,
  files: Map<string, { path: string; value: unknown }>,
  issues: ContentIssue[],
): T | null {
  const entry = files.get(ruleId);
  if (entry === undefined) {
    issues.push({
      file: `../data/rules/${ruleId}.json`,
      path: '(file)',
      message: 'required rules file is missing',
    });
    return null;
  }

  const result = schema.safeParse(entry.value);
  if (!result.success) {
    recordIssues(entry.path, result.error, issues);
    return null;
  }
  return result.data;
}

function parseRules(files: RawFiles, issues: ContentIssue[]): Rules | null {
  const byStem = new Map<string, { path: string; value: unknown }>();
  for (const filePath of Object.keys(files).sort()) {
    const stem = fileStem(filePath);
    if (!RULE_IDS.includes(stem as (typeof RULE_IDS)[number])) {
      issues.push({ file: filePath, path: '(file)', message: `unknown rules document "${stem}"` });
      continue;
    }
    byStem.set(stem, { path: filePath, value: files[filePath] });
  }

  const simulation = parseRule('simulation', SimulationRulesSchema, byStem, issues);
  const movement = parseRule('movement', MovementRulesSchema, byStem, issues);
  const combat = parseRule('combat', CombatRulesSchema, byStem, issues);
  const heat = parseRule('heat', HeatRulesSchema, byStem, issues);
  const damage = parseRule('damage', DamageRulesSchema, byStem, issues);
  const stability = parseRule('stability', StabilityRulesSchema, byStem, issues);
  const terrain = parseRule('terrain', TerrainRulesSchema, byStem, issues);
  const sensors = parseRule('sensors', SensorRulesSchema, byStem, issues);
  const construction = parseRule('construction', ConstructionRulesSchema, byStem, issues);
  const salvage = parseRule('salvage', SalvageRulesSchema, byStem, issues);
  const economy = parseRule('economy', EconomyRulesSchema, byStem, issues);
  const support = parseRule('support', SupportRulesSchema, byStem, issues);
  const ai = parseRule('ai', AiRulesSchema, byStem, issues);
  const balance = parseRule('balance', BalanceRulesSchema, byStem, issues);
  const traits = parseRule('traits', TraitRulesSchema, byStem, issues);
  const pilotTraits = parseRule('pilotTraits', PilotTraitRulesSchema, byStem, issues);
  const abilities = parseRule('abilities', AbilityRulesSchema, byStem, issues);
  const frames = parseRule('frames', FrameRulesSchema, byStem, issues);
  const difficulty = parseRule('difficulty', DifficultyRulesSchema, byStem, issues);

  if (
    simulation === null ||
    movement === null ||
    combat === null ||
    heat === null ||
    damage === null ||
    stability === null ||
    terrain === null ||
    sensors === null ||
    construction === null ||
    salvage === null ||
    economy === null ||
    support === null ||
    ai === null ||
    balance === null ||
    traits === null ||
    pilotTraits === null ||
    abilities === null ||
    frames === null ||
    difficulty === null
  ) {
    return null;
  }

  return {
    simulation,
    movement,
    combat,
    heat,
    damage,
    stability,
    terrain,
    sensors,
    construction,
    salvage,
    economy,
    support,
    ai,
    balance,
    traits,
    pilotTraits,
    abilities,
    frames,
    difficulty,
  };
}

export function loadCatalog(): Catalog {
  const issues: ContentIssue[] = [];

  const rules = parseRules(ruleFiles, issues);
  const partial = {
    chassis: parseCollection('chassis', chassisFiles, ChassisSchema, issues),
    weapons: parseCollection('weapon', weaponFiles, WeaponSchema, issues),
    equipment: parseCollection('equipment', equipmentFiles, EquipmentSchema, issues),
    pilots: parseCollection('pilot', pilotFiles, PilotSchema, issues),
    designs: parseCollection('design', designFiles, DesignSchema, issues),
    maps: parseCollection('map', mapFiles, TerrainMapSchema, issues),
    atmospheres: parseCollection('atmosphere', atmosphereFiles, AtmosphereSchema, issues),
    missions: parseCollection('mission', missionFiles, MissionSchema, issues),
    campaigns: parseCollection('campaign', campaignFiles, CampaignSchema, issues),
    lore: parseCollection('lore', loreFiles, LoreEntrySchema, issues),
  };

  if (rules === null || issues.length > 0) throw new ContentValidationError(issues);

  const catalog: Catalog = { rules, ...partial };
  checkIntegrity(catalog, issues);
  if (issues.length > 0) throw new ContentValidationError(issues);

  return catalog;
}

let cached: Catalog | undefined;

export function getCatalog(): Catalog {
  cached ??= loadCatalog();
  return cached;
}
