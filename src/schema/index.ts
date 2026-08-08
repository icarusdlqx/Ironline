export { LOCATIONS, MechLocationSchema, IdSchema, NameSchema, perLocation } from './common';
export type { MechLocation } from './common';

export { ChassisSchema, ChassisClassSchema, HardpointsSchema } from './chassis';
export type { Chassis, Hardpoints } from './chassis';

export { WeaponSchema, WeaponTypeSchema, RangeBandsSchema } from './weapon';
export type { Weapon, WeaponType } from './weapon';

export { EquipmentSchema, EquipmentCategorySchema } from './equipment';
export type { Equipment, EquipmentCategory } from './equipment';

export { loadCatalog, getCatalog, ContentValidationError } from './load';
export type { Catalog, ContentIssue } from './load';
