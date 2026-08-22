import { Group, Object3D } from 'three';
import { describe, expect, it } from 'vitest';
import type { Faction } from '../schema/faction';
import { advanceWeaponRecoil, triggerWeaponRecoil } from './weaponModels';
import { createWeaponRig } from './weaponMotion';

function rig(nativeFaction: Faction = 'linewrought') {
  const slide = new Group();
  const muzzle = new Object3D();
  const breech = new Object3D();
  const feed = new Object3D();
  const aperture = new Object3D();
  feed.position.x = -2;
  return createWeaponRig(
    'test_cannon',
    nativeFaction,
    { style: 'tracer', colour: '#ffffff', width: 2, arc: 0 },
    slide,
    muzzle,
    breech,
    0.8,
    {
      breechX: -2,
      muzzleX: 3,
      feed,
      feedTravel: 0.25,
      aperture,
      apertureTravel: 0.5,
    },
  );
}

describe('weapon motion', () => {
  it('cycles prebuilt slide, feed and aperture transforms without replacing them', () => {
    const weapon = rig();
    const slidePosition = weapon.slide.position;
    const feedPosition = weapon.feed?.position;
    const apertureScale = weapon.aperture?.scale;

    triggerWeaponRecoil(weapon);

    expect(weapon.slide.position.x).toBe(-0.8);
    expect(weapon.feed?.position.x).toBe(-2.25);
    expect(weapon.aperture?.scale.toArray()).toEqual([1, 0.5, 0.5]);
    for (let frame = 0; frame < 240; frame += 1) advanceWeaponRecoil(weapon, 1 / 60);
    expect(weapon.slide.position).toBe(slidePosition);
    expect(weapon.feed?.position).toBe(feedPosition);
    expect(weapon.aperture?.scale).toBe(apertureScale);
    expect(weapon.kick).toBe(0);
    expect(weapon.cycle).toBe(0);
    expect(weapon.slide.position.x).toBe(0);
    expect(weapon.feed?.position.x).toBe(-2);
    expect(weapon.aperture?.scale.toArray()).toEqual([1, 1, 1]);
  });

  it('retains the stronger in-flight kick and ignores negative time', () => {
    const weapon = rig();
    triggerWeaponRecoil(weapon);
    weapon.kick = 1.2;
    const before = weapon.kick;
    triggerWeaponRecoil(weapon);
    expect(weapon.kick).toBe(before);
    advanceWeaponRecoil(weapon, -1);
    expect(weapon.kick).toBe(before);
    advanceWeaponRecoil(weapon, Number.NaN);
    expect(weapon.kick).toBe(before);
    expect(Number.isFinite(weapon.slide.position.x)).toBe(true);
  });

  it('opens a sealed aperture without translating the emitter housing', () => {
    const weapon = rig('aurelian');

    triggerWeaponRecoil(weapon);

    expect(weapon.kick).toBe(0);
    expect(weapon.slide.position.x).toBe(0);
    expect(weapon.cycle).toBe(1);
    expect(weapon.aperture?.scale.y).toBe(0.5);
    advanceWeaponRecoil(weapon, 1, false, true);
    expect(weapon.cycle).toBe(0);
    expect(weapon.aperture?.scale.y).toBe(1);
  });

  it('cycles a prebuilt barrel bank around its firing axis', () => {
    const weapon = rig();
    weapon.feedKind = 'spin';
    weapon.feedTravel = Math.PI * 2;
    const feed = weapon.feed;
    expect(feed).not.toBeNull();
    if (feed === null) return;

    triggerWeaponRecoil(weapon);
    expect(feed.rotation.x).toBeCloseTo(Math.PI * 2);
    for (let frame = 0; frame < 240; frame += 1) advanceWeaponRecoil(weapon, 1 / 60);
    expect(feed.rotation.x).toBeCloseTo(weapon.feedRestTurn);
  });
});
