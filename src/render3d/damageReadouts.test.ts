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
  offsetReads = 0;

  get offsetWidth(): number {
    this.offsetReads += 1;
    return 1;
  }

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
    const envelope = readoutEnvelope(slot.textContent ?? '', layout.width, false, layout.height);
    const overlaps = occupied.some((obstacle) => readoutOverlaps(point, envelope, obstacle));
    expect(overlaps, JSON.stringify({ label: slot.textContent, point, envelope, occupied })).toBe(
      false,
    );
    occupied.push(readoutBounds(point, envelope));
  }
}

describe('damage readout pool', () => {
  it('keeps one target summary and lets consequences replace projectile noise', () => {
    const { host, pool } = harness();
    const base = { tick: 12, targetId: 4, location: 'left_arm' as const, screen: { x: 80, y: 60 } };
    pool.offer({ ...base, armour: 7 });
    pool.offer({ ...base, tick: 13, location: 'right_arm', structure: 3, misses: 4 });

    const root = host.children[0];
    expect(pool.activeCount).toBe(1);
    expect(root?.children[0]?.textContent).toBe('-3 STRUCTURE');

    pool.offer({ ...base, tick: 14, critical: 'actuator' });
    expect(root?.children[0]?.textContent).toBe('-3 STRUCTURE · CRITICAL: ACTUATOR');

    pool.offer({ ...base, tick: 15, locationLost: true });

    expect(pool.activeCount).toBe(1);
    expect(root?.children[0]?.textContent).toBe('LEFT ARM LOST');
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

    expect(pool.nodeCount).toBe(17);
    expect(host.children[0]?.children).toHaveLength(16);
    expect(pool.activeCount).toBe(8);
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

  it('suppresses phone chip damage until the burst becomes worth reading', () => {
    const layout: ReadoutLayout = { width: 390, height: 844, obstacles: [] };
    const { host, pool } = harness(8, false, layout);
    pool.refreshLayout();
    const base = { targetId: 2, location: 'left_arm' as const, screen: { x: 80, y: 60 } };

    pool.offer({ ...base, tick: 1, armour: 2.5 });
    expect(pool.activeCount).toBe(0);
    pool.advance(0.3);

    pool.offer({ ...base, tick: 2, location: 'right_arm', armour: 2.5 });
    expect(pool.activeCount).toBe(1);
    expect(host.children[0]?.children[0]?.textContent).toBe('-5 ARMOUR');
    pool.advance(0.69);
    expect(pool.activeCount).toBe(1);
    pool.advance(0.04);
    expect(pool.activeCount).toBe(0);
  });

  it('caps phone summaries at four and lets destruction displace armour', () => {
    const layout: ReadoutLayout = { width: 390, height: 844, obstacles: [] };
    const { host, pool } = harness(8, false, layout);
    pool.refreshLayout();
    for (let targetId = 1; targetId <= 6; targetId += 1) {
      pool.offer({
        tick: targetId,
        targetId,
        location: 'centre_torso',
        screen: { x: 50 + targetId * 20, y: 200 },
        armour: 8,
      });
    }

    expect(pool.activeCount).toBe(4);
    pool.offer({
      tick: 9,
      targetId: 20,
      location: 'centre_torso',
      screen: { x: 195, y: 300 },
      destroyed: true,
    });

    const labels = host.children[0]?.children
      .filter((child) => !child.hidden)
      .map((child) => child.textContent) ?? [];
    expect(pool.activeCount).toBe(4);
    expect(labels).toContain('DESTROYED');
    expect(labels.filter((label) => label?.includes('ARMOUR'))).toHaveLength(3);
  });

  it('keeps only the strongest four consequences on a phone', () => {
    const layout: ReadoutLayout = { width: 390, height: 844, obstacles: [] };
    const { host, pool } = harness(8, false, layout);
    pool.refreshLayout();
    for (let targetId = 1; targetId <= 4; targetId += 1) {
      pool.offer({
        tick: 1,
        targetId,
        location: 'centre_torso',
        screen: { x: 40 + targetId * 55, y: 240 },
        destroyed: true,
      });
    }
    pool.offer({
      tick: 2,
      targetId: 8,
      location: 'left_arm',
      screen: { x: 195, y: 360 },
      critical: 'weapon',
    });

    const labels = host.children[0]?.children
      .filter((child) => !child.hidden)
      .map((child) => child.textContent) ?? [];
    expect(labels).toEqual(['DESTROYED', 'DESTROYED', 'DESTROYED', 'DESTROYED']);
  });

  it('updates a routine burst without restarting its animation', () => {
    const { host, pool } = harness();
    const base = { targetId: 4, location: 'left_arm' as const, screen: { x: 80, y: 60 } };
    pool.offer({ ...base, tick: 1, armour: 5 });
    const slot = host.children[0]?.children[0];
    expect(slot?.offsetReads).toBe(1);

    pool.offer({ ...base, tick: 2, armour: 4 });
    expect(slot?.offsetReads).toBe(1);
    expect(slot?.textContent).toBe('-9 ARMOUR');

    pool.offer({ ...base, tick: 3, critical: 'weapon' });
    expect(slot?.offsetReads).toBe(2);
  });

  it('separates three target summaries on desktop and phone layouts', () => {
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
      const base = { tick: 1, screen };
      pool.offer({ ...base, targetId: 4, location: 'left_arm', armour: 12 });
      pool.offer({ ...base, targetId: 5, location: 'right_arm', structure: 7 });
      pool.offer({ ...base, targetId: 6, location: 'centre_torso', destroyed: true });

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
    const base = { tick: 1, screen: { x: 195, y: 830 }, armour: 5 };
    pool.offer({ ...base, targetId: 4, location: 'left_arm' });
    pool.offer({ ...base, targetId: 5, location: 'right_arm' });
    pool.offer({ ...base, targetId: 6, location: 'centre_torso' });

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
