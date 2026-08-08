import type { ZodType } from 'zod';
import { ChassisSchema, type Chassis } from './chassis';
import { EquipmentSchema, type Equipment } from './equipment';
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
  readonly chassis: ReadonlyMap<string, Chassis>;
  readonly weapons: ReadonlyMap<string, Weapon>;
  readonly equipment: ReadonlyMap<string, Equipment>;
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

function fileStem(filePath: string): string {
  const segments = filePath.split('/');
  return (segments[segments.length - 1] ?? '').replace(/\.json$/, '');
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
      for (const issue of result.error.issues) {
        issues.push({
          file: filePath,
          path: issue.path.map(String).join('.') || '(root)',
          message: issue.message,
        });
      }
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
      issues.push({ file: filePath, path: 'id', message: `duplicate ${label} id "${result.data.id}"` });
      continue;
    }

    parsed.set(result.data.id, result.data);
  }

  return parsed;
}

export function loadCatalog(): Catalog {
  const issues: ContentIssue[] = [];

  const catalog: Catalog = {
    chassis: parseCollection('chassis', chassisFiles, ChassisSchema, issues),
    weapons: parseCollection('weapon', weaponFiles, WeaponSchema, issues),
    equipment: parseCollection('equipment', equipmentFiles, EquipmentSchema, issues),
  };

  if (issues.length > 0) throw new ContentValidationError(issues);
  return catalog;
}

let cached: Catalog | undefined;

export function getCatalog(): Catalog {
  cached ??= loadCatalog();
  return cached;
}
