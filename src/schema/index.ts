export { LOCATIONS, MechLocationSchema, IdSchema, NameSchema, perLocation } from './common';
export type { MechLocation } from './common';

export { FactionSchema } from './faction';
export type { Faction } from './faction';

export { ChassisSchema, ChassisClassSchema, HardpointsSchema } from './chassis';
export type { Chassis, Hardpoints } from './chassis';

export { WeaponSchema, WeaponTypeSchema, RangeBandsSchema } from './weapon';
export type { Weapon, WeaponType } from './weapon';

export { EquipmentSchema, EquipmentCategorySchema } from './equipment';
export type { Equipment, EquipmentCategory } from './equipment';

export { PilotSchema } from './pilot';
export type { Pilot } from './pilot';

export { DesignSchema } from './design';
export type { Design, WeaponMountSpec, AmmoLoadSpec } from './design';

export { TerrainMapSchema } from './map';
export type { TerrainMapData } from './map';

export { MissionSchema, LanceSchema, DeploymentSchema } from './mission';
export type { Mission, Deployment } from './mission';

export {
  CombatRulesSchema,
  DamageRulesSchema,
  HeatRulesSchema,
  MovementRulesSchema,
  SimulationRulesSchema,
  TerrainRulesSchema,
  RULE_IDS,
} from './rules';
export type {
  Rules,
  CombatRules,
  DamageRules,
  HeatRules,
  MovementRules,
  SimulationRules,
  TerrainRules,
  TerrainType,
} from './rules';

export { loadCatalog, getCatalog, ContentValidationError } from './load';
export type { Catalog, ContentIssue } from './load';
