import type { ReactNode } from 'react';
import type { Catalog } from '../../schema/load';
import type { Weapon } from '../../schema/weapon';
import { weaponSize } from '../../sim/loadout';
import { weaponCategory, type WeaponCategory } from './weaponPresentation';

export interface WeaponGlyphProps {
  catalog: Catalog;
  weapon: Weapon;
  className?: string;
}

const MAX_PROJECTILE_CELLS = 12;

export function glyphProjectileCount(projectiles: number): number {
  return Math.max(1, Math.min(MAX_PROJECTILE_CELLS, Math.floor(projectiles)));
}

function MissileRack({ weapon, category }: { weapon: Weapon; category: WeaponCategory }) {
  const count = glyphProjectileCount(weapon.projectiles);
  const columns = count > 8 ? 4 : count > 3 ? 3 : count;
  const rows = Math.ceil(count / columns);
  const cellWidth = 5.2;
  const cellHeight = 5.2;
  const startX = 20 - ((columns - 1) * cellWidth) / 2;
  const startY = 20 - ((rows - 1) * cellHeight) / 2;
  const cue =
    category === 'long-range-missiles'
      ? 'M 37 27 L 45 13 L 53 27'
      : category === 'medium-range-missiles'
        ? 'M 38 13 H 52 V 27 H 38'
        : 'M 37 18 H 54 V 23 H 37';

  return (
    <>
      <rect x="5" y="8" width="31" height="24" rx="3" />
      {Array.from({ length: count }, (_, index) => (
        <circle
          key={index}
          data-projectile-cell="true"
          cx={Number((startX + (index % columns) * cellWidth).toFixed(1))}
          cy={Number((startY + Math.floor(index / columns) * cellHeight).toFixed(1))}
          r="1.7"
          fill={weapon.visual.colour}
        />
      ))}
      <path d={cue} />
    </>
  );
}

function Autocannon({ size }: { size: number }) {
  return (
    <>
      <rect x="7" y={12 - size * 0.6} width="24" height={13 + size * 1.2} rx="3" />
      <circle cx="15" cy="20" r={4 + size * 0.7} />
      <path d={`M 30 ${17 - size * 0.4} H 57 V ${23 + size * 0.4} H 30 Z`} />
      {Array.from({ length: size }, (_, index) => (
        <path key={index} d={`M ${36 + index * 5} 15 V 25`} />
      ))}
    </>
  );
}

function MachineGun() {
  return (
    <>
      <circle cx="15" cy="20" r="7" />
      <rect x="20" y="15" width="12" height="10" rx="2" />
      {[16, 20, 24].map((y) => (
        <path key={y} d={`M 31 ${y} H 57`} />
      ))}
    </>
  );
}

function Railgun({ colour }: { colour: string }) {
  return (
    <>
      <rect x="7" y="14" width="17" height="12" rx="3" />
      <path d="M 23 12 H 58 M 23 28 H 58" />
      <path d="M 20 20 H 59" stroke={colour} strokeWidth="2.5" />
      {[30, 39, 48].map((x) => (
        <path key={x} d={`M ${x} 12 V 28`} />
      ))}
    </>
  );
}

function Laser({ weapon }: { weapon: Weapon }) {
  const pulse = weapon.visual.style === 'pulse' || weapon.visual.style === 'burst';
  const lenses = pulse ? [14, 21, 28] : [21];
  return (
    <>
      <path d="M 6 12 H 34 L 45 17 V 23 L 34 28 H 6 Z" />
      {lenses.map((x) => (
        <circle key={x} cx={x} cy="20" r={pulse ? 2.6 : 5} fill={weapon.visual.colour} />
      ))}
      <path d="M 44 17 H 58 V 23 H 44" />
    </>
  );
}

function ParticleWeapon({ colour }: { colour: string }) {
  return (
    <>
      <rect x="7" y="12" width="25" height="16" rx="4" />
      <circle cx="22" cy="20" r="5" fill={colour} />
      <path d="M 31 16 L 58 10 M 31 24 L 58 30 M 34 20 H 55" />
    </>
  );
}

function Flamer({ colour }: { colour: string }) {
  return (
    <>
      <rect x="7" y="14" width="27" height="12" rx="3" />
      <path d="M 33 13 L 45 9 V 31 L 33 27 Z" />
      <path d="M 47 26 C 54 23, 49 18, 57 14 C 55 21, 62 24, 53 30 Z" fill={colour} />
    </>
  );
}

function glyphBody(category: WeaponCategory, weapon: Weapon, size: number): ReactNode {
  switch (category) {
    case 'machine-guns':
      return <MachineGun />;
    case 'flamers':
      return <Flamer colour={weapon.visual.colour} />;
    case 'autocannons':
      return <Autocannon size={size} />;
    case 'railguns':
      return <Railgun colour={weapon.visual.colour} />;
    case 'lasers':
      return <Laser weapon={weapon} />;
    case 'particle-weapons':
      return <ParticleWeapon colour={weapon.visual.colour} />;
    case 'short-range-missiles':
    case 'medium-range-missiles':
    case 'long-range-missiles':
      return <MissileRack weapon={weapon} category={category} />;
  }
}

export function WeaponGlyph({ catalog, weapon, className = '' }: WeaponGlyphProps) {
  const category = weaponCategory(catalog, weapon);
  const size = weaponSize(catalog, weapon);
  const family = category.endsWith('-missiles') ? 'missile' : category;
  return (
    <svg
      className={`weapon-glyph ${className}`.trim()}
      viewBox="0 0 64 40"
      aria-hidden="true"
      focusable="false"
      data-glyph-family={family}
      data-glyph-category={category}
      data-glyph-size={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {glyphBody(category, weapon, size)}
    </svg>
  );
}
