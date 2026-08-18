import { describe, expect, it } from 'vitest';
import { DamageReadoutPool } from './damageReadouts';
import {
  readoutBounds,
  readoutEnvelope,
  readoutOverlaps,
  type ReadoutLayout,
} from './readoutSafeArea';

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

function harness(
  capacity = 4,
  reducedMotion = false,
  layout: ReadoutLayout | null = null,
): {
  host: FakeElement;
  pool: DamageReadoutPool;
} {
  const host = new FakeElement();
  const dom = { createElement: () => new FakeElement() as unknown as HTMLElement };
  const pool = new DamageReadoutPool(
    host as unknown as HTMLElement,
    reducedMotion,
    capacity,
    dom,
    layout === null ? null : () => layout,
  );
  return { host, pool };
}

function expectSeparated(slots: readonly FakeElement[], layout: ReadoutLayout): void {
  const occupied = [];
  for (const slot of slots) {
    const point = {
      x: Number.parseFloat(slot.style.left),
      y: Number.parseFloat(slot.style.top),
    };
    const envelope = readoutEnvelope(slot.textContent ?? '', layout.width, false);
    const overlaps = occupied.some((obstacle) => readoutOverlaps(point, envelope, obstacle));
    expect(overlaps, JSON.stringify({ label: slot.textContent, point, envelope, occupied })).toBe(
      false,
    );
    occupied.push(readoutBounds(point, envelope));
  }
}

describe('damage readout pool', () => {
  it('coalesces the same tick, target and location into one readout', () => {
    const { host, pool } = harness();
    const base = { tick: 12, targetId: 4, location: 'left_arm' as const, screen: { x: 80, y: 60 } };
    pool.offer({ ...base, armour: 7 });
    pool.offer({ ...base, structure: 3 });
    pool.offer({ ...base, critical: 'actuator', locationLost: true });

    const root = host.children[0];
    expect(pool.activeCount).toBe(1);
    expect(root?.children[0]?.textContent).toBe(
      '-7 ARMOUR · -3 STRUCTURE · CRITICAL: ACTUATOR · LOCATION LOST: LEFT ARM',
    );
  });

  it('never grows its DOM budget under sustained fire', () => {
    const { host, pool } = harness(200);
    for (let index = 0; index < 500; index += 1) {
      pool.offer({
        tick: index,
        targetId: index,
        location: 'centre_torso',
        screen: { x: index, y: index },
        armour: 1,
      });
    }

    expect(pool.nodeCount).toBe(48);
    expect(host.children[0]?.children).toHaveLength(47);
    expect(pool.activeCount).toBe(47);
  });

  it('keeps every critical fact coalesced on one plate', () => {
    const { host, pool } = harness();
    const base = { tick: 18, targetId: 7, location: 'right_torso' as const, screen: { x: 50, y: 40 } };
    pool.offer({ ...base, critical: 'weapon' });
    pool.offer({ ...base, critical: 'ammunition' });
    pool.offer({ ...base, critical: '' });

    expect(pool.activeCount).toBe(1);
    expect(host.children[0]?.children[0]?.textContent).toBe(
      'CRITICAL x3: WEAPON / AMMUNITION',
    );
  });

  it('expires slots, marks reduced motion and removes its overlay', () => {
    const { host, pool } = harness(4, true);
    pool.offer({
      tick: 1,
      targetId: 2,
      location: null,
      screen: { x: 10, y: 20 },
      misses: 1,
    });

    expect(host.children[0]?.className).toContain('reduced-motion');
    pool.advance(2);
    expect(pool.activeCount).toBe(0);
    pool.destroy();
    expect(host.children).toHaveLength(0);
  });

  it('separates three different-location plates on desktop and phone layouts', () => {
    const cases = [
      {
        layout: {
          width: 1280,
          height: 800,
          obstacles: [{ left: 12, top: 578, right: 980, bottom: 788 }],
        },
        screen: { x: 640, y: 755 },
      },
      {
        layout: {
          width: 390,
          height: 844,
          obstacles: [{ left: 8, top: 626, right: 382, bottom: 836 }],
        },
        screen: { x: 195, y: 830 },
      },
    ] satisfies Array<{ layout: ReadoutLayout; screen: { x: number; y: number } }>;

    for (const { layout, screen } of cases) {
      const { host, pool } = harness(3, false, layout);
      pool.refreshLayout();
      const base = { tick: 1, targetId: 4, screen };
      pool.offer({ ...base, location: 'left_arm', armour: 12 });
      pool.offer({ ...base, location: 'right_arm', structure: 7 });
      pool.offer({ ...base, location: 'centre_torso', ammo: 25, destroyed: true });

      expectSeparated(host.children[0]?.children ?? [], layout);
    }
  });

  it('reclaims the nearest lane after plates expire and a slot is reused', () => {
    const layout: ReadoutLayout = {
      width: 390,
      height: 844,
      obstacles: [{ left: 8, top: 626, right: 382, bottom: 836 }],
    };
    const { host, pool } = harness(3, false, layout);
    pool.refreshLayout();
    const base = { tick: 1, targetId: 4, screen: { x: 195, y: 830 }, armour: 1 };
    pool.offer({ ...base, location: 'left_arm' });
    pool.offer({ ...base, location: 'right_arm' });
    pool.offer({ ...base, location: 'centre_torso' });

    const slots = host.children[0]?.children ?? [];
    const firstLeft = slots[0]?.style.left;
    const firstTop = slots[0]?.style.top;
    expectSeparated(slots, layout);

    pool.advance(2);
    pool.offer({ ...base, tick: 2, targetId: 8, location: 'head' });

    expect(pool.activeCount).toBe(1);
    expect(slots[0]?.hidden).toBe(false);
    expect(slots[0]?.style.left).toBe(firstLeft);
    expect(slots[0]?.style.top).toBe(firstTop);
  });
});
