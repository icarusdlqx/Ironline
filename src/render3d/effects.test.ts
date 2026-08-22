import { describe, expect, it, vi } from 'vitest';
import { Color, Vector3, type Mesh, type MeshBasicMaterial } from 'three';
import { JetLayer, ScarLayer, SmokeLayer } from './effects';

/** How many plumes are actually lit right now. */
function burning(jets: JetLayer): number {
  return jets.group.children.filter((child) => child.visible).length;
}

/** The opacity of the first lit plume, which is the throttle made visible. */
function brightest(jets: JetLayer): number {
  for (const child of jets.group.children) {
    if (!child.visible) continue;
    return ((child as Mesh).material as MeshBasicMaterial).opacity;
  }
  return 0;
}

function flameHeight(jets: JetLayer): number {
  return jets.group.children.find((child) => child.visible)?.scale.y ?? 0;
}

describe('jet exhaust', () => {
  it('lights only the nozzles asked for, and puts the rest out', () => {
    const jets = new JetLayer();
    expect(burning(jets)).toBe(0);

    jets.begin();
    jets.plume(0, new Vector3(10, 20, 30), 1, 0);
    jets.plume(1, new Vector3(14, 20, 30), 1, 0);
    jets.commit();
    expect(burning(jets)).toBe(2);

    // The mech landed: nobody lit anything this frame, so nothing burns.
    jets.begin();
    jets.commit();
    expect(burning(jets)).toBe(0);
  });

  it('burns brighter at full throttle, and not at all at idle', () => {
    const jets = new JetLayer();

    jets.begin();
    jets.plume(0, new Vector3(), 1, 0);
    jets.commit();
    const full = brightest(jets);

    jets.begin();
    jets.plume(0, new Vector3(), 0.3, 0);
    jets.commit();
    const easing = brightest(jets);

    expect(full).toBeGreaterThan(easing);
    expect(easing).toBeGreaterThan(0);

    // Below the floor the jet is off rather than invisibly on, so a mech
    // coasting over the top of its arc is not paying for a draw.
    jets.begin();
    jets.plume(0, new Vector3(), 0.01, 0);
    jets.commit();
    expect(burning(jets)).toBe(0);
  });

  it('never allocates past its slot budget, however many mechs jump', () => {
    const jets = new JetLayer(4);
    const before = jets.group.children.length;

    jets.begin();
    for (let key = 0; key < 50; key += 1) jets.plume(key, new Vector3(), 1, 0);
    jets.commit();

    expect(jets.group.children.length).toBe(before);
    expect(burning(jets)).toBeLessThanOrEqual(4);
  });

  it('bounds low FX exhaust to one nozzle per unit', () => {
    const jets = new JetLayer(8);

    jets.begin();
    for (let key = 10; key < 14; key += 1) jets.plume(key, new Vector3(), 1, 0);
    jets.commit();
    expect(burning(jets)).toBe(4);

    jets.setPresentationMode(true, false);
    jets.begin();
    for (let key = 10; key < 14; key += 1) jets.plume(key, new Vector3(), 1, 0);
    jets.commit();
    expect(burning(jets)).toBe(2);
  });

  it('removes exhaust flicker under reduced motion', () => {
    const jets = new JetLayer();

    jets.setPresentationMode(false, false);
    jets.begin();
    jets.plume(0, new Vector3(), 1, 0);
    jets.commit();
    const movingStart = flameHeight(jets);
    jets.begin();
    jets.plume(0, new Vector3(), 1, 0.025);
    jets.commit();
    expect(flameHeight(jets)).not.toBeCloseTo(movingStart);

    jets.setPresentationMode(false, true);
    jets.begin();
    jets.plume(0, new Vector3(), 1, 0);
    jets.commit();
    const stillStart = flameHeight(jets);
    jets.begin();
    jets.plume(0, new Vector3(), 1, 0.025);
    jets.commit();
    expect(flameHeight(jets)).toBe(stillStart);
  });
});

describe('wreck smoke', () => {
  it('draws nothing until something is wrecked', () => {
    const smoke = new SmokeLayer(new Color(0x161c1f));
    expect(smoke.mesh.count).toBe(0);
  });

  it('opens a column per wreck and holds its size for the rest of the battle', () => {
    const smoke = new SmokeLayer(new Color(0x161c1f));
    smoke.start({ x: 100, y: 100 }, 0);
    const opened = smoke.mesh.count;
    expect(opened).toBeGreaterThan(0);

    // Ten minutes of battle. A spawner would have grown without bound; this
    // cycles the same puffs, so the cost is flat in how long the fight ran.
    for (let step = 0; step < 12_000; step += 1) smoke.update(1 / 20);
    expect(smoke.mesh.count).toBe(opened);

    smoke.start({ x: 300, y: 300 }, 0);
    expect(smoke.mesh.count).toBe(opened * 2);
  });

  it('refuses more columns than it budgeted for', () => {
    const smoke = new SmokeLayer(new Color(0x161c1f), { x: 0, y: 0 }, 2);
    for (let wreck = 0; wreck < 20; wreck += 1) smoke.start({ x: wreck * 40, y: 0 }, 0);
    expect(smoke.mesh.count).toBeLessThanOrEqual(smoke.mesh.instanceMatrix.count);
  });
});

describe('impact scars', () => {
  it('accumulates marks up to its budget and then reuses the oldest', () => {
    const scars = new ScarLayer(8);
    expect(scars.mesh.count).toBe(0);

    for (let shot = 0; shot < 5; shot += 1) scars.mark({ x: shot * 10, y: 0 }, 0, 4, 1);
    expect(scars.mesh.count).toBe(5);

    // Far past the budget: the ground keeps telling the story, at a fixed cost.
    for (let shot = 0; shot < 500; shot += 1) scars.mark({ x: shot, y: 0 }, 0, 4, 0);
    expect(scars.mesh.count).toBe(8);
  });
});

describe('fixed instance attributes', () => {
  it('preallocates colour buffers and reuses colour scratch during events', () => {
    const smoke = new SmokeLayer(new Color(0x161c1f));
    const scars = new ScarLayer(4);
    expect(smoke.mesh.instanceColor).not.toBeNull();
    expect(scars.mesh.instanceColor).not.toBeNull();
    const clone = vi.spyOn(Color.prototype, 'clone');

    smoke.start({ x: 20, y: 30 }, 0);
    smoke.update(1 / 60);
    scars.mark({ x: 20, y: 30 }, 0, 4, 0.5);

    expect(clone).not.toHaveBeenCalled();
    smoke.dispose();
    scars.dispose();
  });
});
