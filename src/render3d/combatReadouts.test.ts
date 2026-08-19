import { describe, expect, it } from 'vitest';
import { playerWorld, testWorld, unitOf } from '../../tests/support';
import type { SimEvent } from '../sim/events';
import { canPresentEntity, CombatReadouts } from './combatReadouts';

class FakeStyle {
  left = '';
  top = '';
}

class FakeElement {
  className = '';
  hidden = false;
  textContent: string | null = null;
  readonly style = new FakeStyle();
  readonly children: FakeElement[] = [];
  parent: FakeElement | null = null;
  readonly offsetWidth = 1;

  appendChild(child: FakeElement): FakeElement {
    child.parent = this;
    this.children.push(child);
    return child;
  }

  setAttribute(): void {}

  remove(): void {
    if (this.parent === null) return;
    const index = this.parent.children.indexOf(this);
    if (index >= 0) this.parent.children.splice(index, 1);
    this.parent = null;
  }
}

describe('combat readouts', () => {
  it('does not publish live positions outside the player sensor picture', () => {
    const world = playerWorld('hidden-combat-readout');
    const enemy = world.entities.find((entity) => entity.team !== world.playerTeam);
    expect(enemy).toBeDefined();
    expect(world.vision).not.toBeNull();
    if (enemy === undefined || world.vision === null) return;
    world.vision.visible.delete(enemy.id);

    expect(canPresentEntity(world, enemy.id)).toBe(false);
    const friendly = world.entities.find((entity) => entity.team === world.playerTeam);
    expect(friendly === undefined ? false : canPresentEntity(world, friendly.id)).toBe(true);
  });

  it('lets the terminal consequence replace lesser facts on the same target', () => {
    const world = testWorld('combat-readout-cues');
    const target = unitOf(world, 'sentinel_brawler');
    target.locations.left_arm.armour = 3;
    const host = new FakeElement();
    const dom = { createElement: () => new FakeElement() as unknown as HTMLElement };
    const readouts = new CombatReadouts(
      host as unknown as HTMLElement,
      world,
      false,
      (_id, _location, out) => {
        out.set(100, 20, 80);
        return true;
      },
      (at) => ({ x: at.x, y: at.z }),
      dom,
    );
    const events: SimEvent[] = [
      {
        type: 'critical_hit',
        tick: 10,
        entityId: target.id,
        shooterId: 99,
        location: 'left_arm',
        component: 'actuator',
      },
      {
        type: 'location_destroyed',
        tick: 10,
        entityId: target.id,
        location: 'left_arm',
      },
      {
        type: 'projectile_hit',
        tick: 10,
        shooterId: 99,
        targetId: target.id,
        weaponId: 'medium_laser',
        location: 'left_arm',
        damage: 7,
        arc: 'front',
      },
      {
        type: 'projectile_miss',
        tick: 11,
        shooterId: 99,
        targetId: target.id,
        weaponId: 'medium_laser',
      },
      {
        type: 'ammo_explosion',
        tick: 12,
        entityId: target.id,
        location: 'centre_torso',
        damage: 25,
      },
      {
        type: 'mech_destroyed',
        tick: 12,
        entityId: target.id,
        method: 'ammo_explosion',
      },
      {
        type: 'support_resolved',
        tick: 13,
        team: 1,
        call: 'artillery',
        x: 100,
        y: 80,
      },
    ];

    readouts.consume(world, events);
    const labels = host.children[0]?.children
      .map((child) => child.textContent)
      .filter((label) => label !== null && label !== '') ?? [];
    expect(labels).toEqual(['DESTROYED']);
    readouts.destroy();
    expect(host.children).toHaveLength(0);
  });

  it('aggregates one tick across locations and omits misses when the volley lands', () => {
    const world = testWorld('combat-readout-volley');
    const target = unitOf(world, 'sentinel_brawler');
    const host = new FakeElement();
    const dom = { createElement: () => new FakeElement() as unknown as HTMLElement };
    const locations: string[] = [];
    const readouts = new CombatReadouts(
      host as unknown as HTMLElement,
      world,
      false,
      (_id, location, out) => {
        locations.push(location);
        out.set(100, 20, 80);
        return true;
      },
      (at) => ({ x: at.x, y: at.z }),
      dom,
    );

    readouts.consume(world, [
      {
        type: 'projectile_hit',
        tick: 10,
        shooterId: 99,
        targetId: target.id,
        weaponId: 'medium_laser',
        location: 'left_arm',
        damage: 2,
        arc: 'front',
      },
      {
        type: 'projectile_hit',
        tick: 10,
        shooterId: 99,
        targetId: target.id,
        weaponId: 'medium_laser',
        location: 'right_arm',
        damage: 3,
        arc: 'front',
      },
      {
        type: 'projectile_miss',
        tick: 10,
        shooterId: 99,
        targetId: target.id,
        weaponId: 'medium_laser',
      },
    ]);

    const labels = host.children[0]?.children
      .map((child) => child.textContent)
      .filter((label) => label !== null && label !== '') ?? [];
    expect(labels).toEqual(['-5 ARMOUR']);
    expect(locations).toEqual(['centre_torso']);
  });

  it('measures once per event batch and clamps a phone projection above its dock', () => {
    const world = testWorld('combat-readout-mobile-clamp');
    const target = unitOf(world, 'sentinel_brawler');
    const host = new FakeElement();
    const dom = { createElement: () => new FakeElement() as unknown as HTMLElement };
    let measures = 0;
    const readouts = new CombatReadouts(
      host as unknown as HTMLElement,
      world,
      false,
      (_id, _location, out) => {
        out.set(100, 20, 80);
        return true;
      },
      () => ({ x: 195, y: 730 }),
      dom,
      () => {
        measures += 1;
        return {
          width: 390,
          height: 844,
          obstacles: [{ left: 8, top: 626, right: 382, bottom: 836 }],
        };
      },
    );

    readouts.consume(world, [
      {
        type: 'projectile_miss',
        tick: 20,
        shooterId: 99,
        targetId: target.id,
        weaponId: 'medium_laser',
      },
      {
        type: 'projectile_miss',
        tick: 21,
        shooterId: 99,
        targetId: target.id,
        weaponId: 'medium_laser',
      },
    ]);

    expect(measures).toBe(1);
    const visible = host.children[0]?.children.filter((child) => !child.hidden) ?? [];
    expect(visible).toHaveLength(1);
    expect(visible[0]?.textContent).toBe('MISS x2');
    expect(Number.parseInt(visible[0]?.style.top ?? '', 10)).toBeLessThan(626);
  });
});
